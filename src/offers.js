// Offers from growers: who takes what, what it earns, what could go wrong, and what Jan orders.
// The desk proposes and warns; Jan calls the customers, decides and sends. Nothing is ordered by itself.
import { pool, rows, one, log } from './db.js';
import { familyKey, colorOf } from './allocate.js';
import { growerList, customerList } from './analytics.js';

const DAY = 864e5, MIN = 6e4;
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateOf = s => new Date(`${String(s).slice(0, 10)}T00:00:00`);
const dow = d => ((d.getDay() + 6) % 7) + 1;
const dag = s => (s ? new Date(`${String(s).slice(0, 10)}T12:00:00`).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'short' }) : '');
const hm = d => new Date(d).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
const eur = v => `€ ${Math.round(Number(v) || 0).toLocaleString('nl-NL')}`;
const eur2 = v => `€ ${(Number(v) || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nl = v => Math.round(Number(v) || 0).toLocaleString('nl-NL');
const r2 = v => Math.round(Number(v) * 100) / 100;
const plantName = p => [p.naam, p.potmaat, p.hoogte].filter(Boolean).join(' ');

// ---------------------------------------------------------------- shared, slow numbers: two minutes is fresh enough
const cache = {};
async function cached(key, fn, ms = 120000) {
  const c = cache[key];
  if (c && Date.now() - c.at < ms) return c.v;
  const v = await fn();
  cache[key] = { v, at: Date.now() };
  return v;
}
export const growerStats = () => cached('growers', growerList);
export const customerStats = () => cached('customers', customerList);
export function dropCaches() { for (const k of Object.keys(cache)) delete cache[k]; }

// how often each customer said yes to an offer in the last half year
async function acceptance(db = pool) {
  const r = (await db.query(`
    SELECT ak.klant_id, count(DISTINCT a.id) FILTER (WHERE ak.status = 'akkoord') AS ja, count(DISTINCT a.id) FILTER (WHERE ak.status = 'nee') AS nee
      FROM aanbod_klanten ak JOIN aanbod_regels ar ON ar.id = ak.regel_id JOIN aanbiedingen a ON a.id = ar.aanbod_id
     WHERE ak.bron = 'aanbod' AND a.ontvangen > now() - interval '180 days' AND ak.status IN ('akkoord', 'nee')
     GROUP BY ak.klant_id`)).rows;
  return new Map(r.map(x => [x.klant_id, { ja: Number(x.ja), nee: Number(x.nee) }]));
}

// ---------------------------------------------------------------- when goods reach a customer
export function windowStart(lv) {
  const m = String(lv || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return 9;
  let h = Number(m[1]) + Number(m[2]) / 60;
  if (/vóór|voor/.test(lv)) h = Math.max(5, h - 2);
  return h;
}
// the first day the customer can receive, leaving Nootdorp at least 45 minutes after the grower's truck is in
export function planDelivery(k, goodsIn) {
  const travel = Number(k.reistijd_min || 60);
  const days = Array.isArray(k.leverdagen) && k.leverdagen.length ? k.leverdagen.map(Number) : [1, 2, 3, 4, 5];
  const earliest = new Date(goodsIn.getTime() + 45 * MIN);
  const start = new Date(goodsIn); start.setHours(0, 0, 0, 0);
  for (let i = 0; i < 10; i++) {
    const d = new Date(start.getTime() + i * DAY);
    if (!days.includes(dow(d))) continue;
    const arrive = new Date(d); arrive.setMinutes(Math.round(windowStart(k.levervenster) * 60));
    const vertrek = new Date(arrive.getTime() - (travel + 30) * MIN);
    if (vertrek >= earliest) return { vertrek, aankomst: arrive };
  }
  const vertrek = new Date(earliest.getTime() + 15 * MIN);
  return { vertrek, aankomst: new Date(vertrek.getTime() + (travel + 30) * MIN) };
}
// when a grower's truck usually reaches Nootdorp on a given day
export function growerArrival(g, levering) {
  const d = dateOf(levering);
  if (g.laadtijd && g.reistijd_min != null) {
    const [h, m] = String(g.laadtijd).split(':').map(Number);
    const x = new Date(d); x.setHours(h, m, 0, 0);
    let arr = new Date(x.getTime() + Number(g.reistijd_min) * MIN);
    // overnight trucks (Denmark, Kenya by plane) arrive early in the morning of the delivery day
    if (arr.getDate() !== d.getDate() || Number(g.reistijd_min) > 600) { arr = new Date(d); arr.setHours(6, 0, 0, 0); }
    return new Date(Math.round(arr / (5 * MIN)) * 5 * MIN);
  }
  const x = new Date(d); x.setHours(8, 0, 0, 0);
  return x;
}

// ---------------------------------------------------------------- the proposal: every plant in the basket to the customers who will take it
async function openDemand(db, plantId, levering, aanbodId) {
  const { rows: r } = await db.query(`
    SELECT kor.id AS order_regel_id, ko.id AS order_id, ko.nummer, ko.klant_id, ko.gewenst_op, kor.prijs,
           kor.aantal
             - coalesce((SELECT sum(t.aantal) FROM toewijzingen t WHERE t.order_regel_id = kor.id AND t.status <> 'afgewezen'), 0)
             - coalesce((SELECT sum(ak.aantal) FROM aanbod_klanten ak JOIN aanbod_regels ar ON ar.id = ak.regel_id JOIN aanbiedingen a ON a.id = ar.aanbod_id
                          WHERE ak.order_regel_id = kor.id AND ak.status <> 'nee' AND a.status <> 'afgewezen' AND a.id <> $3), 0) AS open
      FROM klant_order_regels kor JOIN klant_orders ko ON ko.id = kor.order_id JOIN klanten k ON k.id = ko.klant_id
     WHERE kor.plant_id = $1 AND ko.status = 'open' AND ko.aanbod_id IS DISTINCT FROM $3 AND k.actief
       AND ko.gewenst_op BETWEEN $2::date AND $2::date + 3
     ORDER BY ko.gewenst_op, ko.besteld_op`, [plantId, levering, aanbodId]);
  return r.filter(x => Number(x.open) > 0);
}

async function buyers(db, line, levering, aanbodId, ctx) {
  const famIds = ctx.plants.filter(p => familyKey(p) === familyKey(line)).map(p => p.id);
  const hist = (await db.query(`
    SELECT t.klant_id, count(DISTINCT f.datum) AS keer, max(f.datum) AS laatst, sum(t.aantal)::numeric / nullif(count(DISTINCT f.datum), 0) AS gem,
           count(DISTINCT f.datum) FILTER (WHERE fr.plant_id = $2) AS keer_exact,
           avg(t.verkoopprijs) FILTER (WHERE fr.plant_id = $2 AND f.datum > current_date - 120) AS prijs_exact
      FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id
     WHERE t.bestemming = 'klant' AND t.status IN ('bevestigd', 'geleverd') AND f.datum > current_date - 365 AND fr.plant_id = ANY($1)
     GROUP BY t.klant_id`, [famIds, line.plant_id])).rows;
  const busy = new Set((await db.query(`
    SELECT DISTINCT ak.klant_id FROM aanbod_klanten ak JOIN aanbod_regels ar ON ar.id = ak.regel_id JOIN aanbiedingen a ON a.id = ar.aanbod_id
     WHERE ar.plant_id = ANY($1) AND a.id <> $2 AND a.status IN ('nieuw', 'bellen') AND ak.status <> 'nee' AND a.ontvangen > now() - interval '3 days'`, [famIds, aanbodId])).rows.map(x => x.klant_id));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const lev = dateOf(levering);
  const until = Math.max(0, Math.round((lev - today) / DAY));
  const col = colorOf(line);
  const per = line.per_laag || 1;
  const out = [];
  for (const h of hist) {
    const k = ctx.klanten.get(h.klant_id);
    if (!k || !k.actief || k.segment === 'gestopt') continue;
    const keer = Number(h.keer), exact = Number(h.keer_exact);
    const dagen = h.laatst ? Math.round((today - dateOf(h.laatst)) / DAY) : null;
    const ritme = keer > 1 ? Math.max(4, Math.round(365 / keer)) : null;
    const due = ritme && dagen != null ? Math.min(1.3, (dagen + until) / ritme) : 0.4;
    const others = keer - exact;
    const colorFit = !col ? 1 : exact > 0 ? 1 : others >= 3 ? 0.15 : 0.6;
    const acc = ctx.accept.get(h.klant_id) || { ja: 0, nee: 0 };
    const rate = (acc.ja + 1) / (acc.ja + acc.nee + 2);
    const days = Array.isArray(k.leverdagen) && k.leverdagen.length ? k.leverdagen.map(Number) : [1, 2, 3, 4, 5];
    const dayFit = days.includes(dow(lev)) || days.includes(dow(new Date(lev.getTime() + DAY))) ? 1 : 0.4;
    const gem = Number(h.gem) || per * 2;
    let pen = 0;
    if (k.over_tijd > 750) pen += Math.min(15, k.over_tijd / 400);
    if (k.kredietlimiet && k.open_bedrag > k.kredietlimiet) pen += 25;
    if (k.segment === 'slapend') pen += 6;
    if (busy.has(h.klant_id)) pen += 18;
    const score = Math.max(1, Math.min(99, Math.round(30 * Math.min(1, keer / 8) + 22 * Math.min(1, due) + 14 * rate + 12 * colorFit + 10 * dayFit + 6 * Math.min(1, keer / 3) - pen)));
    const aantal = Math.max(per, Math.round(gem / per) * per);
    const ratio = ctx.ratio.get(h.klant_id) || 1;
    const prijs = r2(h.prijs_exact ? Number(h.prijs_exact) : line.lijstprijs ? Number(line.lijstprijs) * ratio : Number(line.prijs) * 1.35);
    const why = [];
    why.push(`Kocht ${line.naam.replace(/\s(wit|roze|paars|blauw|geel|oranje|rood)$/i, '')} ${keer}× dit jaar${ritme ? `, ongeveer elke ${ritme} dagen` : ''}${dagen != null ? `; laatst ${dagen === 0 ? 'vandaag' : dagen === 1 ? 'gisteren' : `${dagen} dagen geleden`}` : ''}`);
    if (col && exact >= 2) why.push(`neemt ${col} vaker`);
    if (acc.ja + acc.nee >= 2) why.push(`zei ja op ${acc.ja} van ${acc.ja + acc.nee} aanbiedingen`);
    if (busy.has(h.klant_id)) why.push('heeft al een ander aanbod voor deze plant openstaan');
    if (k.over_tijd > 750) why.push(`${eur(k.over_tijd)} over tijd open`);
    out.push({ klant_id: h.klant_id, score, aantal, prijs, reden: why.join('; ') });
  }
  return out.sort((a, b) => b.score - a.score);
}

export async function proposeOffer(db, aanbodId) {
  const a = (await db.query('SELECT * FROM aanbiedingen WHERE id = $1', [aanbodId])).rows[0];
  if (!a) return 0;
  const levering = a.levering || ymd(new Date(Date.now() + DAY));
  const lines = (await db.query(`SELECT r.*, p.naam, p.potmaat, p.hoogte, p.per_laag, p.eenheid, p.verkoopprijs AS lijstprijs
      FROM aanbod_regels r JOIN planten p ON p.id = r.plant_id WHERE r.aanbod_id = $1 ORDER BY r.regelnr`, [aanbodId])).rows;
  // proposals the desk made and nobody touched are made again; Jan's own choices and every yes or no stay
  await db.query(`DELETE FROM aanbod_klanten ak USING aanbod_regels ar WHERE ak.regel_id = ar.id AND ar.aanbod_id = $1 AND ak.door = 'ai' AND ak.status = 'voorstel'`, [aanbodId]);
  const ctx = {
    plants: (await db.query('SELECT id, naam, potmaat, hoogte FROM planten')).rows,
    klanten: new Map((await customerStats()).map(k => [k.id, k])),
    accept: await acceptance(db),
    ratio: new Map((await db.query(`SELECT t.klant_id, avg(t.verkoopprijs / nullif(p.verkoopprijs, 0)) AS r
        FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id JOIN planten p ON p.id = fr.plant_id
       WHERE t.bestemming = 'klant' AND t.verkoopprijs > 0 AND f.datum > current_date - 180 GROUP BY 1`)).rows.map(x => [x.klant_id, Number(x.r) || 1])),
  };
  let made = 0;
  for (const line of lines) {
    const existing = (await db.query('SELECT * FROM aanbod_klanten WHERE regel_id = $1', [line.id])).rows;
    let left = line.aantal - existing.filter(e => e.status !== 'nee').reduce((s, e) => s + e.aantal, 0);
    const taken = new Set(existing.map(e => e.klant_id));
    for (const o of await openDemand(db, line.plant_id, levering, aanbodId)) {
      if (left <= 0) break;
      if (taken.has(o.klant_id)) continue;
      const n = Math.min(left, Number(o.open));
      const prijs = o.prijs != null ? Number(o.prijs) : r2(Number(line.lijstprijs || line.prijs * 1.35));
      await db.query(`INSERT INTO aanbod_klanten (regel_id, klant_id, order_regel_id, bron, aantal, verkoopprijs, score, reden, status, door)
        VALUES ($1, $2, $3, 'order', $4, $5, 97, $6, 'akkoord', 'ai')`, [line.id, o.klant_id, o.order_regel_id, n, prijs, `Heeft al besteld: ${o.nummer}, wil het ${dag(o.gewenst_op)}`]);
      taken.add(o.klant_id); left -= n; made++;
    }
    let count = 0;
    for (const c of await buyers(db, line, levering, aanbodId, ctx)) {
      if (left <= 0 || count >= 4) break;
      if (taken.has(c.klant_id) || c.score < 42) continue;
      const n = Math.min(left, c.aantal);
      if (n <= 0) continue;
      await db.query(`INSERT INTO aanbod_klanten (regel_id, klant_id, bron, aantal, verkoopprijs, score, reden, status, door)
        VALUES ($1, $2, 'aanbod', $3, $4, $5, $6, 'voorstel', 'ai')`, [line.id, c.klant_id, n, c.prijs, c.score, c.reden]);
      taken.add(c.klant_id); left -= n; count++; made++;
    }
  }
  return made;
}

// ---------------------------------------------------------------- one offer, everything about it
const STAGE_NAME = { aanbod: 'Aanbod', bellen: 'Bellen', besteld: 'Besteld', loods: 'In de loods', afgewezen: 'Afgewezen', verlopen: 'Verlopen' };

export async function offerDetail(id, { withRisk = true } = {}) {
  const a = await one(`
    SELECT a.*, k.naam AS kweker, k.code AS kweker_code, k.plaats AS kweker_plaats, k.land AS kweker_land, k.contact AS kweker_contact, k.email AS kweker_email,
           k.whatsapp AS kweker_whatsapp, k.telefoon AS kweker_telefoon, k.laadtijd, k.reistijd_min, k.vervoer,
           b.kanaal, b.van, b.van_naam, b.onderwerp, b.tekst AS bericht_tekst, bs.naam AS bestand_naam
      FROM aanbiedingen a JOIN kwekers k ON k.id = a.kweker_id LEFT JOIN berichten_in b ON b.id = a.bericht_id LEFT JOIN bestanden bs ON bs.id = a.bestand_id
     WHERE a.id = $1`, [id]);
  if (!a) return null;
  const now = new Date();
  const regels = await rows(`
    SELECT r.*, p.naam, p.potmaat, p.hoogte, p.eenheid, p.per_laag, p.groep, p.seizoen, p.verkoopprijs AS lijstprijs,
           (SELECT avg(fr.prijs) FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id WHERE fr.plant_id = r.plant_id AND f.kweker_id = $2 AND f.datum > current_date - 120) AS normaal,
           (SELECT avg(fr.prijs) FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id WHERE fr.plant_id = r.plant_id AND f.datum > current_date - 60) AS markt,
           (SELECT coalesce(sum(t.aantal), 0) / 90.0 FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id
             WHERE fr.plant_id = r.plant_id AND t.bestemming = 'klant' AND f.datum > current_date - 90) AS per_dag
      FROM aanbod_regels r LEFT JOIN planten p ON p.id = r.plant_id WHERE r.aanbod_id = $1 ORDER BY r.regelnr`, [id, a.kweker_id]);
  const links = await rows(`
    SELECT ak.*, k.naam AS klant, k.plaats, k.land, ko.nummer AS order_nummer, ko.gewenst_op
      FROM aanbod_klanten ak JOIN aanbod_regels ar ON ar.id = ak.regel_id JOIN klanten k ON k.id = ak.klant_id
      LEFT JOIN klant_order_regels kor ON kor.id = ak.order_regel_id LEFT JOIN klant_orders ko ON ko.id = kor.order_id
     WHERE ar.aanbod_id = $1 ORDER BY ak.bron, ak.score DESC NULLS LAST, ak.id`, [id]);
  const concepten = await rows(`SELECT id, soort, kweker_id, klant_id, nummer, aan, taal, onderwerp, status, waar, extern_link, gesprek, gesprek_notitie, gebeld_op, gezet_op, verstuurd_op, bijgewerkt
      FROM concepten WHERE aanbod_id = $1 AND status <> 'vervallen' ORDER BY soort, id`, [id]);
  const zending = await one('SELECT * FROM zendingen WHERE aanbod_id = $1', [id]);
  const klantStats = new Map((await customerStats()).map(k => [k.id, k]));
  const accept = await acceptance();
  const g = (await growerStats()).find(x => x.id === a.kweker_id) || null;

  const per = new Map();
  for (const r of regels) {
    const mine = links.filter(l => l.regel_id === r.id);
    const live = mine.filter(l => l.status !== 'nee');
    r.klanten = mine.map(l => ({ id: l.id, klant_id: l.klant_id, klant: l.klant, plaats: l.plaats, land: l.land, bron: l.bron, aantal: l.aantal, verkoopprijs: Number(l.verkoopprijs), score: l.score, reden: l.reden, status: l.status, door: l.door, order: l.order_nummer, gewenst_op: l.gewenst_op }));
    r.voorgesteld = live.reduce((s, l) => s + l.aantal, 0);
    r.akkoord = mine.filter(l => l.status === 'akkoord').reduce((s, l) => s + l.aantal, 0);
    r.nee = mine.filter(l => l.status === 'nee').reduce((s, l) => s + l.aantal, 0);
    r.rest = Math.max(0, r.aantal - r.voorgesteld);
    const step = r.per_laag || 1;
    const need = r.voorgesteld + (r.extra || 0);
    r.voorstel_bestellen = a.hele_partij ? r.aantal : Math.min(r.aantal, Math.ceil(need / step) * step);
    r.te_bestellen = r.bestellen != null ? r.bestellen : r.voorstel_bestellen;
    r.zonder_klant = Math.max(0, r.te_bestellen - r.voorgesteld);
    r.normaal = r.normaal == null ? null : Number(r.normaal);
    r.markt = r.markt == null ? null : Number(r.markt);
    r.prijs = Number(r.prijs);
    r.verschil = r.normaal ? Math.round((r.prijs / r.normaal - 1) * 1000) / 10 : null;
    r.per_dag = Number(r.per_dag) || 0;
    r.marge = live.reduce((s, l) => s + l.aantal * (Number(l.verkoopprijs) - r.prijs), 0);
    r.omzet = live.reduce((s, l) => s + l.aantal * Number(l.verkoopprijs), 0);
    r.rest_advies = !r.plant_id ? 'Plant niet herkend: eerst nakijken.'
      : r.rest <= 0 ? null
      : a.hele_partij ? `Hele partij: ${nl(r.rest)} ${r.eenheid || 'stuks'} gaan zonder klant de loods in.`
      : r.per_dag > 0 && r.rest / r.per_dag <= 4 ? `${nl(r.rest)} zonder klant. Gaat normaal in ${Math.max(1, Math.round(r.rest / r.per_dag))} ${Math.round(r.rest / r.per_dag) <= 1 ? 'dag' : 'dagen'} weg: kan de loods in.`
      : `${nl(r.rest)} zonder klant: niet bestellen.`;
    for (const l of mine) {
      if (!per.has(l.klant_id)) per.set(l.klant_id, { klant_id: l.klant_id, regels: [] });
      per.get(l.klant_id).regels.push({ id: l.id, regel_id: r.id, plant: plantName(r), plant_id: r.plant_id, eenheid: r.eenheid, aantal: l.aantal, verkoopprijs: Number(l.verkoopprijs), inkoop: r.prijs, status: l.status, bron: l.bron, order: l.order_nummer, gewenst_op: l.gewenst_op, reden: l.reden, score: l.score });
    }
  }

  const klantRows = await rows(`SELECT id, naam, plaats, land, taal, kanaal, contact, telefoon, whatsapp, email, levervenster, leverdagen, reistijd_min FROM klanten WHERE id = ANY($1)`, [[...per.keys()]]);
  const klanten = [];
  for (const k of klantRows) {
    const p = per.get(k.id), s = klantStats.get(k.id) || {};
    const live = p.regels.filter(x => x.status !== 'nee');
    const bron = p.regels.every(x => x.bron === 'order') ? 'order' : p.regels.some(x => x.bron === 'order') ? 'beide' : 'aanbod';
    const c = concepten.find(x => x.soort === 'offerte' && x.klant_id === k.id) || null;
    const allNo = p.regels.filter(x => x.bron === 'aanbod').every(x => x.status === 'nee') && p.regels.some(x => x.bron === 'aanbod');
    const allYes = p.regels.filter(x => x.bron === 'aanbod').every(x => x.status === 'akkoord');
    const acc = accept.get(k.id) || { ja: 0, nee: 0 };
    klanten.push({
      ...k, klant_id: k.id, bron, regels: p.regels,
      waarde: live.reduce((x, l) => x + l.aantal * l.verkoopprijs, 0),
      marge: live.reduce((x, l) => x + l.aantal * (l.verkoopprijs - l.inkoop), 0),
      score: Math.max(...p.regels.map(x => x.score || 0)),
      status: bron === 'order' ? 'akkoord' : allNo ? 'nee' : allYes ? 'akkoord' : c && c.gesprek === 'terugbellen' ? 'terugbellen' : 'open',
      concept: c, gesprek_notitie: c ? c.gesprek_notitie : null,
      segment: s.segment, over_tijd: s.over_tijd || 0, open_bedrag: s.open_bedrag || 0, kredietlimiet: s.kredietlimiet, betaal_dagen: s.betaal_dagen, trend: s.trend,
      ja: acc.ja, nee: acc.nee,
    });
  }
  klanten.sort((x, y) => (x.bron === 'order') - (y.bron === 'order') || y.waarde - x.waarde);

  const stuks = regels.reduce((s, r) => s + r.aantal, 0);
  const gekoppeld = regels.reduce((s, r) => s + Math.min(r.aantal, r.voorgesteld), 0);
  const inkoop = regels.reduce((s, r) => s + r.te_bestellen * r.prijs, 0);
  const omzet = regels.reduce((s, r) => s + r.omzet, 0);
  const marge = regels.reduce((s, r) => s + r.marge, 0);
  const totalen = {
    stuks, gekoppeld, gekoppeld_pct: stuks ? Math.round(gekoppeld / stuks * 100) : 0,
    te_bestellen: regels.reduce((s, r) => s + r.te_bestellen, 0), inkoop: r2(inkoop), omzet: r2(omzet), marge: r2(marge), marge_pct: omzet ? Math.round(marge / omzet * 1000) / 10 : null,
    zonder_klant: regels.reduce((s, r) => s + r.zonder_klant * r.prijs, 0),
    klanten: klanten.length, bellen: klanten.filter(k => k.bron !== 'order' && k.status !== 'akkoord' && k.status !== 'nee').length,
    akkoord: klanten.filter(k => k.bron !== 'order' && k.status === 'akkoord').length, afgewezen: klanten.filter(k => k.status === 'nee').length,
    al_besteld: klanten.filter(k => k.bron === 'order').length,
  };

  let zendingOut = null;
  if (zending) {
    const binnen = zending.aankomst_werkelijk && new Date(zending.aankomst_werkelijk) <= now;
    zendingOut = { ...zending, binnen, eta: binnen ? zending.aankomst_werkelijk : zending.aankomst_verwacht || zending.aankomst_gepland };
  }
  const verlopen = ['nieuw', 'bellen'].includes(a.status) && a.geldig_tot && new Date(a.geldig_tot) < now;
  const stap = a.status === 'afgewezen' ? 'afgewezen' : verlopen ? 'verlopen' : a.status === 'besteld' ? (zendingOut && zendingOut.binnen ? 'loods' : 'besteld') : a.status === 'bellen' ? 'bellen' : 'aanbod';
  const out = {
    aanbod: { ...a, stap, stap_naam: STAGE_NAME[stap], verlopen },
    kweker: g,
    regels, klanten, totalen, concepten, zending: zendingOut,
  };
  if (withRisk) out.risico = computeRisk(out, now);
  return out;
}

// ---------------------------------------------------------------- what could go wrong with this order
export function computeRisk(d, now = new Date()) {
  const f = [];
  const add = (toon, gewicht, titel, tekst, soort) => f.push({ toon, gewicht, titel, tekst, soort });
  const a = d.aanbod, g = d.kweker;
  // the grower
  if (!g || g.facturen < 3) add('wait', 15, 'Nieuwe kweker', `Nog ${g ? g.facturen : 0} leveringen in de desk: weinig bekend over stiptheid en kwaliteit. Spreek prijs en tijd duidelijk af.`, 'kweker');
  else {
    if (g.op_tijd != null && g.op_tijd < 80) add(g.op_tijd < 74 ? 'bad' : 'wait', g.op_tijd < 74 ? 30 : 14, 'Komt vaak te laat', `${g.op_tijd}% van de leveringen op tijd; als het misgaat gemiddeld ${g.gem_te_laat || '?'} minuten later. Klanten met een vroege wagen lopen risico.`, 'kweker');
    if (g.compleet != null && g.compleet < 97) add(g.compleet < 94 ? 'bad' : 'wait', g.compleet < 94 ? 28 : 12, 'Levert vaak minder', `${String(Math.round((100 - g.compleet) * 10) / 10).replace('.', ',')}% van de bestelde stuks kwam niet. Reken niet op de laatste laag; check de pakbon direct.`, 'kweker');
    if (g.kwaliteit >= 3 && g.kwaliteit / g.facturen >= 0.05) add('wait', 10, 'Kwaliteit wisselt', `Bij ${g.kwaliteit} van de ${g.facturen} leveringen schade of slechte planten. Even nakijken bij binnenkomst.`, 'kweker');
    if (g.prijsafwijking >= 3 && g.prijsafwijking / g.facturen >= 0.07) add('wait', 8, 'Factuurprijs wijkt soms af', `${g.prijsafwijking} van de ${g.facturen} facturen hadden een andere prijs dan afgesproken. Leg deze prijzen vast in de bestelling.`, 'kweker');
    if (g.score >= 88 && !(g.op_tijd < 80)) add('ok', 0, 'Betrouwbare kweker', `${g.op_tijd}% op tijd, ${String(g.compleet).replace('.', ',')}% compleet geleverd, score ${g.score}.`, 'kweker');
  }
  if (Number(a.reistijd_min) > 300) add('wait', 8, 'Lange reis', `De wagen is ${Math.round(Number(a.reistijd_min) / 60)} uur onderweg; vertraging raakt de wagens naar de klanten direct.`, 'tijd');
  // prices
  for (const r of d.regels) {
    if (!r.plant_id) { add('wait', 12, 'Regel niet herkend', `"${r.omschrijving}" is nog niet aan een plant gekoppeld. Kies de plant, dan zoekt de desk klanten.`, 'lezen'); continue; }
    if (r.match_zekerheid != null && r.match_zekerheid < 75) add('wait', 8, 'Twijfel bij het lezen', `"${r.omschrijving}" is gelezen als ${plantName(r)} (${r.match_zekerheid}% zeker). Klopt dat?`, 'lezen');
    if (r.verschil != null && r.verschil > 8) add(r.verschil > 15 ? 'bad' : 'wait', r.verschil > 15 ? 22 : 10, `${r.naam} duurder dan normaal`, `${eur2(r.prijs)} per ${r.eenheid === 'stelen' ? 'steel' : 'stuk'}, normaal ${eur2(r.normaal)} bij deze kweker (+${String(r.verschil).replace('.', ',')}%).`, 'prijs');
    else if (r.markt && r.prijs < r.markt * 0.8) add('wait', 8, `${r.naam} opvallend goedkoop`, `${eur2(r.prijs)} tegen ${eur2(r.markt)} gemiddeld bij andere kwekers. Let op maat en kwaliteit.`, 'prijs');
    else if (r.normaal && r.verschil != null && r.verschil < -5) add('ok', 0, `${r.naam} scherp geprijsd`, `${String(Math.abs(r.verschil)).replace('.', ',')}% onder de normale prijs van deze kweker.`, 'prijs');
    const lowMargin = r.klanten.filter(k => k.status !== 'nee' && k.verkoopprijs < r.prijs);
    for (const k of lowMargin) add('bad', 20, 'Verlies op een regel', `${k.klant} betaalt ${eur2(k.verkoopprijs)} voor ${r.naam}; inkoop is ${eur2(r.prijs)}.`, 'marge');
    for (const k of r.klanten.filter(k => k.bron === 'order' && k.gewenst_op && a.levering && k.gewenst_op < a.levering)) add('bad', 24, 'Te laat voor een klant', `${k.klant} wil het ${dag(k.gewenst_op)}; deze kweker levert pas ${dag(a.levering)}.`, 'tijd');
  }
  // selling it
  const unsold = d.regels.reduce((s, r) => s + r.zonder_klant * r.prijs, 0);
  if (a.hele_partij && unsold > 0) add(unsold > 800 ? 'bad' : 'wait', unsold > 800 ? 26 : 12, 'Hele partij afnemen', `De kweker verkoopt alleen alles samen: ${eur(unsold)} gaat zonder klant de loods in.`, 'afzet');
  else if (unsold > 0) add('wait', unsold > 600 ? 12 : 6, 'Extra voor de loods', `${eur(unsold)} wordt besteld zonder klant (afronden op hele lagen of extra voor de loods).`, 'afzet');
  const perishable = d.regels.filter(r => r.groep === 'snijbloem' && r.zonder_klant > 0);
  if (perishable.length) add('wait', 10, 'Kort houdbaar', `${perishable.map(r => r.naam).join(', ')}: snijbloemen zonder klant moeten binnen drie dagen weg.`, 'afzet');
  const month = now.getMonth() + 1;
  const ending = d.regels.filter(r => Array.isArray(r.seizoen) && r.seizoen.length < 12 && r.seizoen.includes(month) && !r.seizoen.includes(month === 12 ? 1 : month + 1) && r.zonder_klant > 0);
  if (ending.length) add('wait', 8, 'Seizoen loopt af', `${ending.map(r => r.naam).join(', ')}: na deze maand gaat het niet meer weg.`, 'afzet');
  const notLinked = d.regels.filter(r => r.plant_id && r.voorgesteld === 0);
  if (notLinked.length) add('info', 0, 'Geen klant gevonden', `${notLinked.map(r => plantName(r)).join(', ')}: niemand koopt dit nu. Niet bestellen, of zelf een klant kiezen.`, 'afzet');
  // the customers
  for (const k of d.klanten.filter(k => k.status !== 'nee')) {
    if (k.over_tijd > 750) add(k.over_tijd > 3000 ? 'bad' : 'wait', k.over_tijd > 3000 ? 18 : 6, `${k.naam} heeft achterstand`, `${eur(k.over_tijd)} staat over tijd open.${k.over_tijd > 3000 ? ' Eerst laten betalen, of vooruit laten betalen.' : ''}`, 'klant');
    if (k.kredietlimiet && k.open_bedrag + k.waarde > k.kredietlimiet) add('bad', 22, `${k.naam} boven de kredietlimiet`, `${eur(k.open_bedrag)} open plus ${eur(k.waarde)} uit dit aanbod is meer dan de limiet van ${eur(k.kredietlimiet)}.`, 'klant');
    else if (k.betaal_dagen != null && k.betaal_dagen > 10 && !(k.over_tijd > 750)) add('wait', 6, `${k.naam} betaalt laat`, `Gemiddeld ${Math.round(k.betaal_dagen)} dagen na de vervaldatum.`, 'klant');
    if (k.bron !== 'order' && k.ja + k.nee >= 4 && k.ja / (k.ja + k.nee) < 0.35) add('info', 3, `${k.naam} zegt vaak nee`, `Ja op ${k.ja} van de ${k.ja + k.nee} aanbiedingen. Reken er niet vast op.`, 'klant');
    if (k.segment === 'dalend') add('info', 3, `${k.naam} koopt minder`, `Omzet ${k.trend}% ten opzichte van vorig jaar.`, 'klant');
  }
  const live = d.klanten.filter(k => k.status !== 'nee');
  const total = live.reduce((s, k) => s + k.waarde, 0);
  const top = live.slice().sort((x, y) => y.waarde - x.waarde)[0];
  if (top && total > 0 && live.length >= 1 && top.waarde / total > 0.65 && total > 400) add('wait', 10, 'Eén grote afnemer', `${top.naam} neemt ${Math.round(top.waarde / total * 100)}% van de waarde. Zegt die nee, dan blijft er veel over.`, 'klant');
  // money and time
  const m = d.totalen.marge_pct;
  if (m != null && d.totalen.omzet > 0) {
    if (m < 10) add('bad', 20, 'Dunne marge', `${String(m).replace('.', ',')}% over het geheel (${eur(d.totalen.marge)}).`, 'marge');
    else if (m < 16) add('wait', 8, 'Smalle marge', `${String(m).replace('.', ',')}% over het geheel (${eur(d.totalen.marge)}).`, 'marge');
    else if (m >= 25) add('ok', 0, 'Goede marge', `${String(m).replace('.', ',')}% over het geheel (${eur(d.totalen.marge)}).`, 'marge');
  }
  if (['aanbod', 'bellen'].includes(a.stap) && a.geldig_tot) {
    const left = (new Date(a.geldig_tot) - now) / MIN;
    if (left <= 0) add('bad', 30, 'Aanbod verlopen', `Het aanbod gold tot ${hm(a.geldig_tot)}. Bel de kweker of het nog kan.`, 'tijd');
    else if (left <= 180) add('wait', 10, 'Beslis snel', `Het aanbod geldt tot ${hm(a.geldig_tot)} (nog ${left < 60 ? `${Math.round(left)} min` : `${Math.floor(left / 60)} u ${Math.round(left % 60)} min`}).`, 'tijd');
  }
  if (a.waarschuwing) add('wait', 10, 'Bij het lezen opgevallen', a.waarschuwing, 'lezen');
  const score = Math.min(100, f.reduce((s, x) => s + x.gewicht, 0));
  const niveau = f.some(x => x.toon === 'bad' && x.gewicht >= 24) || score >= 55 ? 'hoog' : score >= 22 ? 'middel' : 'laag';
  const order = { bad: 0, wait: 1, info: 2, ok: 3 };
  f.sort((x, y) => order[x.toon] - order[y.toon] || y.gewicht - x.gewicht);
  return { niveau, score, factoren: f, berekend: now.toISOString() };
}

export async function refreshRisk(id) {
  const d = await offerDetail(id);
  if (!d) return null;
  await pool.query('UPDATE aanbiedingen SET risico = $2, bijgewerkt = now() WHERE id = $1', [id, JSON.stringify({ niveau: d.risico.niveau, score: d.risico.score, kop: d.risico.factoren.filter(x => x.toon === 'bad' || x.toon === 'wait').slice(0, 3).map(x => x.titel) })]);
  return d;
}

// ---------------------------------------------------------------- the board: every offer and order that is still moving
export async function offerCards() {
  const now = new Date();
  const list = await rows(`
    SELECT a.id, a.kweker_id, a.nummer, a.bestelnummer, a.ontvangen, a.geldig_tot, a.levering, a.status, a.hele_partij, a.risico, a.gelezen_door, a.besteld_op,
           k.naam AS kweker, k.plaats, b.kanaal,
           z.id AS zending_id, z.aankomst_gepland, z.aankomst_verwacht, CASE WHEN z.aankomst_werkelijk <= now() THEN z.aankomst_werkelijk END AS binnen_om,
           CASE WHEN z.vertrek_werkelijk <= now() THEN z.vertrek_werkelijk END AS vertrokken_om
      FROM aanbiedingen a JOIN kwekers k ON k.id = a.kweker_id LEFT JOIN berichten_in b ON b.id = a.bericht_id LEFT JOIN zendingen z ON z.aanbod_id = a.id
     WHERE a.ontvangen <= now() AND (
           (a.status IN ('nieuw', 'bellen') AND a.ontvangen > now() - interval '4 days' AND (a.geldig_tot IS NULL OR a.geldig_tot > now() - interval '30 hours'))
        OR (a.status = 'besteld' AND z.id IS NOT NULL AND (z.aankomst_werkelijk IS NULL OR z.aankomst_werkelijk > now() - interval '30 hours') AND a.besteld_op > now() - interval '12 days'))
     ORDER BY a.ontvangen DESC`);
  if (!list.length) return [];
  const ids = list.map(a => a.id);
  const lines = await rows(`
    SELECT r.aanbod_id, r.id, r.aantal, r.prijs, r.extra, r.bestellen, r.plant_id, p.naam, p.potmaat, p.per_laag
      FROM aanbod_regels r LEFT JOIN planten p ON p.id = r.plant_id WHERE r.aanbod_id = ANY($1) ORDER BY r.regelnr`, [ids]);
  const links = await rows(`
    SELECT ar.aanbod_id, ak.regel_id, ak.klant_id, k.naam AS klant, ak.bron, ak.aantal, ak.verkoopprijs, ak.status
      FROM aanbod_klanten ak JOIN aanbod_regels ar ON ar.id = ak.regel_id JOIN klanten k ON k.id = ak.klant_id WHERE ar.aanbod_id = ANY($1)`, [ids]);
  const concepts = await rows(`SELECT aanbod_id, soort, klant_id, status, gesprek FROM concepten WHERE aanbod_id = ANY($1) AND status <> 'vervallen'`, [ids]);
  return list.map(a => {
    const ls = lines.filter(l => l.aanbod_id === a.id);
    const lk = links.filter(l => l.aanbod_id === a.id);
    const live = lk.filter(l => l.status !== 'nee');
    const custs = new Map();
    for (const l of lk) {
      const c = custs.get(l.klant_id) || { naam: l.klant, bron: new Set(), status: new Set() };
      c.bron.add(l.bron); c.status.add(l.status); custs.set(l.klant_id, c);
    }
    const klanten = [...custs.entries()].map(([id, c]) => ({
      id, naam: c.naam, bron: c.bron.has('aanbod') ? 'aanbod' : 'order',
      status: c.bron.has('aanbod') ? (c.status.has('akkoord') && !c.status.has('voorstel') ? 'akkoord' : [...c.status].every(s => s === 'nee') ? 'nee' : 'open') : 'akkoord',
    }));
    const stuks = ls.reduce((s, l) => s + l.aantal, 0);
    const gekoppeld = ls.reduce((s, l) => s + Math.min(l.aantal, live.filter(x => x.regel_id === l.id).reduce((t, x) => t + x.aantal, 0)), 0);
    const omzet = live.reduce((s, l) => s + l.aantal * Number(l.verkoopprijs), 0);
    const marge = live.reduce((s, l) => s + l.aantal * (Number(l.verkoopprijs) - Number(ls.find(x => x.id === l.regel_id)?.prijs || 0)), 0);
    const verlopen = ['nieuw', 'bellen'].includes(a.status) && a.geldig_tot && new Date(a.geldig_tot) < now;
    const stap = a.status === 'besteld' ? (a.binnen_om ? 'loods' : 'besteld') : verlopen ? 'verlopen' : a.status === 'bellen' ? 'bellen' : 'aanbod';
    const cs = concepts.filter(c => c.aanbod_id === a.id);
    const planten = [...new Set(ls.filter(l => l.naam).map(l => l.naam.replace(/\s(wit|roze|paars|blauw|geel|oranje|rood)$/i, '')))];
    return {
      id: a.id, kweker_id: a.kweker_id, kweker: a.kweker, plaats: a.plaats, kanaal: a.kanaal, nummer: a.nummer, bestelnummer: a.bestelnummer,
      ontvangen: a.ontvangen, geldig_tot: a.geldig_tot, levering: a.levering, status: a.status, stap, hele_partij: a.hele_partij, risico: a.risico,
      regels: ls.length, stuks, gekoppeld, gekoppeld_pct: stuks ? Math.round(gekoppeld / stuks * 100) : 0, planten,
      onbekend: ls.filter(l => !l.plant_id).length,
      klanten, bellen: klanten.filter(k => k.bron === 'aanbod' && k.status === 'open').length, akkoord: klanten.filter(k => k.bron === 'aanbod' && k.status === 'akkoord').length,
      al_besteld: klanten.filter(k => k.bron === 'order').length, nee: klanten.filter(k => k.status === 'nee').length,
      omzet: r2(omzet), marge: r2(marge), marge_pct: omzet ? Math.round(marge / omzet * 100) : null,
      concepten: { totaal: cs.length, outlook: cs.filter(c => c.status === 'in_outlook').length, verstuurd: cs.filter(c => c.status === 'verstuurd').length, bestelling: cs.find(c => c.soort === 'bestelling')?.status || null },
      zending: a.zending_id ? { id: a.zending_id, gepland: a.aankomst_gepland, verwacht: a.aankomst_verwacht, binnen_om: a.binnen_om, vertrokken_om: a.vertrokken_om } : null,
    };
  });
}

// ---------------------------------------------------------------- Jan's decisions
async function touch(db, aanbodId) {
  await db.query(`UPDATE aanbiedingen SET status = CASE WHEN status = 'nieuw' THEN 'bellen' ELSE status END, bijgewerkt = now() WHERE id = $1`, [aanbodId]);
}

// after a call: the customer says yes, no, or call back later
export async function callOutcome(aanbodId, klantId, uitkomst, notitie, wie) {
  const status = uitkomst === 'akkoord' ? 'akkoord' : uitkomst === 'nee' ? 'nee' : 'voorstel';
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const a = (await c.query('SELECT status FROM aanbiedingen WHERE id = $1 FOR UPDATE', [aanbodId])).rows[0];
    if (!a) throw Object.assign(new Error('Dit aanbod bestaat niet (meer).'), { status: 404 });
    if (a.status === 'afgewezen') throw Object.assign(new Error('Dit aanbod is afgewezen.'), { status: 409 });
    if (a.status === 'besteld') throw Object.assign(new Error('Deze bestelling is al geplaatst. Pas het aan bij de kweker en de klant zelf.'), { status: 409 });
    const r = await c.query(`UPDATE aanbod_klanten ak SET status = $3, door = 'jan' FROM aanbod_regels ar
      WHERE ak.regel_id = ar.id AND ar.aanbod_id = $1 AND ak.klant_id = $2 AND ak.bron = 'aanbod'`, [aanbodId, klantId, status]);
    if (!r.rowCount) throw Object.assign(new Error('Deze klant staat niet in dit aanbod.'), { status: 404 });
    await c.query(`UPDATE concepten SET gesprek = $3, gesprek_notitie = coalesce($4, gesprek_notitie), gebeld_op = now(), bijgewerkt = now()
      WHERE aanbod_id = $1 AND klant_id = $2 AND soort = 'offerte' AND status <> 'vervallen'`, [aanbodId, klantId, uitkomst, notitie || null]);
    await touch(c, aanbodId);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  const k = await one('SELECT naam FROM klanten WHERE id = $1', [klantId]);
  await log(wie, uitkomst === 'akkoord' ? 'Klant akkoord' : uitkomst === 'nee' ? 'Klant zegt nee' : uitkomst === 'terugbellen' ? 'Klant terugbellen' : 'Gesprek heropend', 'aanbod', aanbodId, { klant: k?.naam, notitie: notitie || null });
}

// the order goes to the grower: quantities fixed, customers' orders made, trucks planned
export async function placeOrder(aanbodId, { regels = [] } = {}, wie) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const a = (await c.query(`SELECT a.*, k.naam AS kweker, k.laadtijd, k.reistijd_min, k.vervoer FROM aanbiedingen a JOIN kwekers k ON k.id = a.kweker_id WHERE a.id = $1 FOR UPDATE OF a`, [aanbodId])).rows[0];
    if (!a) throw Object.assign(new Error('Dit aanbod bestaat niet (meer).'), { status: 404 });
    if (a.status === 'besteld') throw Object.assign(new Error(`Al besteld (${a.bestelnummer}).`), { status: 409 });
    if (a.status === 'afgewezen') throw Object.assign(new Error('Dit aanbod is afgewezen.'), { status: 409 });
    const d = await offerDetail(aanbodId, { withRisk: false });
    const want = new Map(regels.map(r => [Number(r.id), Math.max(0, Math.round(Number(r.bestellen) || 0))]));
    let total = 0;
    for (const r of d.regels) {
      let n = want.has(r.id) ? want.get(r.id) : r.te_bestellen;
      if (!r.plant_id) n = 0;
      if (a.hele_partij && n > 0) n = r.aantal;
      n = Math.min(n, r.aantal);
      if (r.minimum && n > 0 && n < r.minimum) throw Object.assign(new Error(`${plantName(r)}: de kweker levert minimaal ${r.minimum}.`), { status: 400 });
      const committed = r.klanten.filter(k => k.status === 'akkoord').reduce((s, k) => s + k.aantal, 0);
      if (n < committed) throw Object.assign(new Error(`${plantName(r)}: klanten zeiden al ja op ${committed}; bestel er niet minder.`), { status: 400 });
      await c.query('UPDATE aanbod_regels SET bestellen = $2 WHERE id = $1', [r.id, n]);
      total += n;
    }
    if (!total) throw Object.assign(new Error('Er staat niets om te bestellen.'), { status: 400 });
    // open proposals nobody answered do not go with the order
    await c.query(`UPDATE aanbod_klanten ak SET status = 'nee' FROM aanbod_regels ar WHERE ak.regel_id = ar.id AND ar.aanbod_id = $1 AND ak.status = 'voorstel'`, [aanbodId]);
    const yy = String(new Date().getFullYear()).slice(2);
    const bestelnummer = a.bestelnummer || `CI-B-${yy}-${String((await c.query(`SELECT nextval('bestelnummer_seq') AS n`)).rows[0].n).padStart(4, '0')}`;
    const levering = a.levering || ymd(new Date(Date.now() + DAY));
    const arr = growerArrival(a, levering);
    let z = (await c.query('SELECT * FROM zendingen WHERE aanbod_id = $1', [aanbodId])).rows[0];
    if (!z) z = (await c.query(`INSERT INTO zendingen (kweker_id, aanbod_id, vervoerder, vertrek_gepland, aankomst_gepland) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [a.kweker_id, aanbodId, a.vervoer || null, a.reistijd_min != null ? new Date(arr.getTime() - Number(a.reistijd_min) * MIN) : null, arr])).rows[0];
    // customers who said yes get an order; customers who had ordered already get a truck if they had none
    const yes = (await c.query(`SELECT ak.*, ar.plant_id FROM aanbod_klanten ak JOIN aanbod_regels ar ON ar.id = ak.regel_id WHERE ar.aanbod_id = $1 AND ak.status = 'akkoord'`, [aanbodId])).rows;
    const byKlant = new Map();
    for (const y of yes) { if (!byKlant.has(y.klant_id)) byKlant.set(y.klant_id, []); byKlant.get(y.klant_id).push(y); }
    let orders = 0;
    const maxNr = (await c.query(`SELECT coalesce(max(substring(nummer from '^CI-${yy}-(\\d+)$')::int), 100) AS n FROM klant_orders WHERE nummer ~ '^CI-${yy}-\\d+$'`)).rows[0].n;
    let next = Number(maxNr);
    for (const [kid, ys] of byKlant) {
      const k = (await c.query('SELECT * FROM klanten WHERE id = $1', [kid])).rows[0];
      const plan = planDelivery(k, new Date(z.aankomst_gepland));
      const fresh = ys.filter(y => y.bron === 'aanbod');
      let orderId = null;
      if (fresh.length) {
        next += 1;
        const o = (await c.query(`INSERT INTO klant_orders (nummer, klant_id, besteld_op, gewenst_op, kanaal, status, opmerking, aanbod_id)
            VALUES ($1, $2, now(), $3, 'telefoon', 'open', $4, $5) RETURNING id`,
          [`CI-${yy}-${String(next).padStart(4, '0')}`, kid, ymd(plan.aankomst), `Uit aanbod van ${a.kweker}`, aanbodId])).rows[0];
        orderId = o.id;
        for (const y of fresh) await c.query('INSERT INTO klant_order_regels (order_id, plant_id, aantal, prijs) VALUES ($1, $2, $3, $4)', [o.id, y.plant_id, y.aantal, y.verkoopprijs]);
        orders++;
      }
      const old = ys.filter(y => y.bron === 'order' && y.order_regel_id);
      const oldOrders = old.length ? (await c.query('SELECT DISTINCT kor.order_id FROM klant_order_regels kor WHERE kor.id = ANY($1)', [old.map(y => y.order_regel_id)])).rows.map(x => x.order_id) : [];
      for (const oid of [orderId, ...oldOrders].filter(Boolean)) {
        const has = (await c.query('SELECT id FROM leveringen WHERE order_id = $1', [oid])).rows[0];
        if (!has) await c.query(`INSERT INTO leveringen (klant_id, order_id, vervoerder, vertrek_gepland, aankomst_gepland) VALUES ($1, $2, $3, $4, $5)`,
          [kid, oid, Number(k.reistijd_min) < 120 ? 'Eigen bus Campo' : Number(k.reistijd_min) < 700 ? 'Koeltransport Vos' : 'Euro Cool Logistics', plan.vertrek, plan.aankomst]);
      }
    }
    await c.query(`UPDATE aanbiedingen SET status = 'besteld', besteld_op = now(), bestelnummer = $2, levering = $3, bijgewerkt = now() WHERE id = $1`, [aanbodId, bestelnummer, levering]);
    // offers to customers who did not say yes are no longer needed
    await c.query(`UPDATE concepten SET status = 'vervallen', bijgewerkt = now() WHERE aanbod_id = $1 AND soort = 'offerte' AND status IN ('concept', 'in_outlook') AND gesprek <> 'akkoord'`, [aanbodId]);
    await c.query('COMMIT');
    await log(wie, 'Bestelling geplaatst', 'aanbod', aanbodId, { bestelnummer, stuks: total, klantorders: orders, aankomst: arr.toISOString() });
    dropCaches();
    return { bestelnummer, stuks: total, klantorders: orders, aankomst: arr.toISOString() };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function declineOffer(aanbodId, reden, wie) {
  const a = await one(`UPDATE aanbiedingen SET status = 'afgewezen', afgewezen_om = $2, bijgewerkt = now() WHERE id = $1 AND status IN ('nieuw', 'bellen') RETURNING id`, [aanbodId, reden || null]);
  if (!a) throw Object.assign(new Error('Dit aanbod kan niet meer worden afgewezen.'), { status: 409 });
  await pool.query(`UPDATE concepten SET status = 'vervallen', bijgewerkt = now() WHERE aanbod_id = $1 AND status IN ('concept', 'in_outlook')`, [aanbodId]);
  await log(wie, 'Aanbod afgewezen', 'aanbod', aanbodId, { reden: reden || null });
}

// goods of an order are in, and no invoice yet: book them from the order, so they are in the loods and go to the right customers
export async function receiveOrder(db, zendingId) {
  const z = (await db.query('SELECT * FROM zendingen WHERE id = $1', [zendingId])).rows[0];
  if (!z || !z.aanbod_id || z.factuur_id) return null;
  const a = (await db.query('SELECT * FROM aanbiedingen WHERE id = $1', [z.aanbod_id])).rows[0];
  const lines = (await db.query('SELECT * FROM aanbod_regels WHERE aanbod_id = $1 AND bestellen > 0 AND plant_id IS NOT NULL ORDER BY regelnr', [a.id])).rows;
  if (!lines.length) return null;
  const nummer = a.bestelnummer || `CI-B-${a.id}`;
  const f = (await db.query(`INSERT INTO facturen (kweker_id, nummer, datum, totaal, zekerheid, gelezen_door, waarschuwing, nagekeken)
      VALUES ($1, $2, $3, $4, 100, 'jan', $5, true) ON CONFLICT (kweker_id, nummer) DO UPDATE SET bijgewerkt = now() RETURNING *`,
    [a.kweker_id, nummer, ymd(new Date(z.aankomst_werkelijk || z.aankomst_gepland)), r2(lines.reduce((s, l) => s + l.bestellen * Number(l.prijs), 0)),
      `Nog geen factuur van de kweker: binnengeboekt volgens bestelling ${nummer}. Vergelijk de factuur straks met deze aantallen.`])).rows[0];
  let nr = 0;
  for (const l of lines) await db.query(`INSERT INTO factuur_regels (factuur_id, regelnr, omschrijving, plant_id, match_zekerheid, aantal, besteld, prijs, afgesproken)
      VALUES ($1, $2, $3, $4, 100, $5, $5, $6, $6) ON CONFLICT (factuur_id, regelnr) DO NOTHING`, [f.id, ++nr, l.omschrijving, l.plant_id, l.bestellen, l.prijs]);
  await db.query('UPDATE zendingen SET factuur_id = $2 WHERE id = $1', [z.id, f.id]);
  await db.query('UPDATE aanbiedingen SET factuur_id = $2, bijgewerkt = now() WHERE id = $1', [a.id, f.id]);
  await allocateFromOffer(db, f.id, a.id);
  // what nobody ordered stays in the loods, free to sell
  await db.query(`INSERT INTO toewijzingen (regel_id, bestemming, aantal, soort, status, reden, door)
      SELECT fr.id, 'voorraad', fr.aantal - coalesce((SELECT sum(t.aantal) FROM toewijzingen t WHERE t.regel_id = fr.id AND t.status <> 'afgewezen'), 0), 'voorraad', 'bevestigd', 'Extra voor de loods', 'jan'
        FROM factuur_regels fr WHERE fr.factuur_id = $1 AND fr.aantal > coalesce((SELECT sum(t.aantal) FROM toewijzingen t WHERE t.regel_id = fr.id AND t.status <> 'afgewezen'), 0)`, [f.id]);
  return f.id;
}

// the goods of an order placed from an offer go to exactly the customers who said yes, on their own truck
export async function allocateFromOffer(db, factuurId, aanbodId) {
  const lines = (await db.query('SELECT id, plant_id, aantal FROM factuur_regels WHERE factuur_id = $1 AND plant_id IS NOT NULL ORDER BY regelnr', [factuurId])).rows;
  const yes = (await db.query(`
    SELECT ak.klant_id, ar.plant_id, ak.aantal, ak.verkoopprijs, a.bestelnummer,
           coalesce(ak.order_regel_id, (SELECT kor.id FROM klant_order_regels kor JOIN klant_orders ko ON ko.id = kor.order_id
                                         WHERE ko.aanbod_id = a.id AND ko.klant_id = ak.klant_id AND kor.plant_id = ar.plant_id ORDER BY kor.id LIMIT 1)) AS order_regel_id
      FROM aanbod_klanten ak JOIN aanbod_regels ar ON ar.id = ak.regel_id JOIN aanbiedingen a ON a.id = ar.aanbod_id
     WHERE ar.aanbod_id = $1 AND ak.status = 'akkoord' ORDER BY ak.bron, ak.id`, [aanbodId])).rows;
  let made = 0;
  for (const y of yes) {
    for (const l of lines.filter(x => x.plant_id === y.plant_id)) {
      const used = Number((await db.query(`SELECT coalesce(sum(aantal), 0) AS n FROM toewijzingen WHERE regel_id = $1 AND status <> 'afgewezen'`, [l.id])).rows[0].n);
      const n = Math.min(y.aantal, l.aantal - used);
      if (n <= 0) continue;
      const lev = y.order_regel_id ? (await db.query(`SELECT l.id FROM klant_order_regels kor JOIN leveringen l ON l.order_id = kor.order_id WHERE kor.id = $1 ORDER BY l.vertrek_gepland LIMIT 1`, [y.order_regel_id])).rows[0] : null;
      await db.query(`INSERT INTO toewijzingen (regel_id, bestemming, klant_id, order_regel_id, levering_id, aantal, verkoopprijs, soort, status, reden, score, door)
          VALUES ($1, 'klant', $2, $3, $4, $5, $6, 'order', 'bevestigd', $7, 100, 'ai')`, [l.id, y.klant_id, y.order_regel_id, lev ? lev.id : null, n, y.verkoopprijs, `Akkoord via aanbod, bestelling ${y.bestelnummer || ''}`.trim()]);
      y.aantal -= n; made++;
      if (y.aantal <= 0) break;
    }
  }
  if (made) await db.query(`UPDATE klant_orders SET status = 'toegewezen' WHERE status = 'open' AND (aanbod_id = $1 OR id IN (SELECT kor.order_id FROM klant_order_regels kor JOIN aanbod_klanten ak ON ak.order_regel_id = kor.id JOIN aanbod_regels ar ON ar.id = ak.regel_id WHERE ar.aanbod_id = $1 AND ak.status = 'akkoord'))`, [aanbodId]);
  return made;
}
