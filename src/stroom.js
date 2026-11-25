// The flow of goods: every grower's truck, through Jan's loods, forking to each customer it feeds.
// Per order: where it probably is now, how far along it is, and whether a delivery is in danger.
// Vandaag and the workflow both use the truck states below, so they always tell the same story.
import { rows, one } from './db.js';
import { offerCards } from './offers.js';
import { loodsNow } from './loods.js';

const MIN = 6e4;
const RANK = { bad: 0, wait: 1, ok: 2, done: 3 };
const worst = list => list.reduce((w, x) => (RANK[x] < RANK[w] ? x : w), 'done');
export const dur = m => { m = Math.round(Math.abs(m)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} u${m % 60 ? ` ${m % 60} min` : ''}`; };
const uniq = a => [...new Set(a)];
// risk titles that start with a generic word read on lowercase after a colon; names keep their capital
const GENERIC = /^(Komt|Levert|Kwaliteit|Factuurprijs|Nieuwe|Lange|Regel|Twijfel|Verlies|Te|Hele|Extra|Kort|Seizoen|Geen|Eén|Dunne|Smalle|Aanbod|Beslis|Bij|Betrouwbare|Goede)\b/;
const lcTitle = s => (s && GENERIC.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s || '');

// ---------------------------------------------------------------- where a truck is, as of now
export function latestEta(events, now) {
  const withEta = events.filter(e => e.eta && new Date(e.tijd) <= now).sort((a, b) => new Date(b.tijd) - new Date(a.tijd));
  return withEta[0] ? new Date(withEta[0].eta) : null;
}

// a grower's truck on its way to Nootdorp
export function zendingState(z, events, now) {
  const arrived = z.aankomst_werkelijk && new Date(z.aankomst_werkelijk) <= now;
  const departed = z.vertrek_werkelijk && new Date(z.vertrek_werkelijk) <= now;
  const loading = events.some(e => e.soort === 'geladen' && new Date(e.tijd) <= now);
  const plan = new Date(z.aankomst_gepland);
  let eta = arrived ? new Date(z.aankomst_werkelijk) : (latestEta(events, now) || (z.aankomst_verwacht && !arrived ? new Date(z.aankomst_verwacht) : null) || plan);
  const silentLate = !arrived && now > new Date(eta.getTime() + 10 * MIN);
  if (silentLate) eta = new Date(now.getTime() + 15 * MIN);
  const delay = Math.round((eta - plan) / MIN);
  const state = arrived ? 'binnen' : departed ? 'onderweg' : loading ? 'laden' : 'gepland';
  const dep = departed ? new Date(z.vertrek_werkelijk) : z.vertrek_gepland ? new Date(z.vertrek_gepland) : new Date(plan.getTime() - 60 * MIN);
  const progress = arrived ? 1 : departed ? Math.max(0.03, Math.min(0.97, (now - dep) / Math.max(MIN, eta - dep))) : 0;
  return { state, eta: eta.toISOString(), delay, silentLate, progress, vertrek: dep.toISOString() };
}

// a truck from Nootdorp to a customer: it leaves later when it has to wait for a grower's truck
export function leveringState(l, events, waits, now) {
  const arrived = l.aankomst_werkelijk && new Date(l.aankomst_werkelijk) <= now;
  const departed = l.vertrek_werkelijk && new Date(l.vertrek_werkelijk) <= now;
  const pending = waits.filter(z => z.state !== 'binnen');
  const lastIn = pending.reduce((m, z) => Math.max(m, +new Date(z.eta)), 0);
  let dep = departed ? new Date(l.vertrek_werkelijk) : new Date(Math.max(+new Date(l.vertrek_gepland), lastIn ? lastIn + 45 * MIN : 0));
  if (!departed && dep < now) dep = new Date(now.getTime() + 10 * MIN);
  const shift = departed ? (new Date(l.vertrek_werkelijk) - new Date(l.vertrek_gepland)) : (dep - new Date(l.vertrek_gepland));
  const eta = arrived ? new Date(l.aankomst_werkelijk) : (latestEta(events, now) || new Date(+new Date(l.aankomst_gepland) + Math.max(0, shift)));
  const delay = Math.round((eta - new Date(l.aankomst_gepland)) / MIN);
  const state = arrived ? 'afgeleverd' : departed ? 'onderweg' : pending.length ? 'wacht' : 'klaar';
  const progress = arrived ? 1 : departed ? Math.max(0.03, Math.min(0.97, (now - dep) / Math.max(MIN, eta - dep))) : 0;
  return { state, vertrek: dep.toISOString(), eta: eta.toISOString(), delay, progress, krap: !departed && shift > 10 * MIN, uitstel: Math.round(shift / MIN) };
}

export async function eventsFor(col, ids, now) {
  if (!ids.length) return {};
  const r = await rows(`SELECT id, ${col} AS ref, tijd, soort, plaats, eta, tekst, bron FROM gebeurtenissen WHERE ${col} = ANY($1) AND tijd <= $2 ORDER BY tijd`, [ids, now]);
  const out = {};
  for (const e of r) (out[e.ref] = out[e.ref] || []).push(e);
  return out;
}

// ---------------------------------------------------------------- is a delivery in danger?
// the last hour of a delivery window such as "ma–za 05:00–07:00"
function windowEnd(lv) {
  const m = String(lv || '').match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  return m ? Number(m[3]) + Number(m[4]) / 60 : null;
}
const hourOf = d => d.getHours() + d.getMinutes() / 60;

function inboundTone(z) {
  if (z.state === 'binnen') return { toon: 'done', reden: null };
  if (z.silentLate) return { toon: 'bad', reden: `${z.kweker} is te laat en liet niets horen` };
  if (z.delay >= 30) return { toon: 'wait', reden: `${z.kweker} komt ${dur(z.delay)} later in Nootdorp` };
  return { toon: 'ok', reden: null };
}

function deliveryTone(b, waits) {
  if (b.state === 'afgeleverd') return { toon: 'done', reden: b.delay >= 15 ? `kwam ${dur(b.delay)} later aan` : null };
  const silent = waits.find(z => z.state !== 'binnen' && z.silentLate);
  if (silent) return { toon: 'bad', reden: `wacht op ${silent.kweker}, die te laat is en niets liet horen` };
  const late = waits.filter(z => z.state !== 'binnen' && z.delay >= 10).map(z => z.kweker);
  const why = b.krap && late.length ? `wacht op ${late.join(' en ')}` : null;
  const end = windowEnd(b.levervenster), eta = new Date(b.eta), plan = new Date(b.gepland);
  const over = end != null && b.delay > 0 && hourOf(plan) <= end && hourOf(eta) > end ? Math.round((hourOf(eta) - end) * 60) : 0;
  if (b.delay >= 60) return { toon: 'bad', reden: `komt waarschijnlijk ${dur(b.delay)} te laat${why ? ` (${why})` : ''}` };
  if (over >= 30) return { toon: 'bad', reden: `komt waarschijnlijk ${dur(over)} na het levervenster (${b.levervenster})` };
  if (b.delay >= 15 || over > 0) return { toon: 'wait', reden: `komt waarschijnlijk ${dur(b.delay)} later${why ? ` (${why})` : ''}` };
  if (b.krap) return { toon: 'wait', reden: why ? `vertrekt later: ${why}` : `vertrekt ${dur(b.uitstel)} later dan gepland` };
  return { toon: 'ok', reden: null };
}

// ---------------------------------------------------------------- which grower's truck feeds which customer's truck
// One row per plant per (grower truck, customer truck): from the invoice once it is there, from the placed offer before that.
async function allocations(zids, lids) {
  return rows(`
    WITH a AS (
      SELECT z.id AS zending_id, t.klant_id, t.levering_id, kor.order_id, fr.plant_id, t.aantal, t.verkoopprijs, t.status
        FROM zendingen z JOIN factuur_regels fr ON fr.factuur_id = z.factuur_id
        JOIN toewijzingen t ON t.regel_id = fr.id AND t.status <> 'afgewezen' AND t.bestemming = 'klant'
        LEFT JOIN klant_order_regels kor ON kor.id = t.order_regel_id
      UNION ALL
      SELECT z.id, ak.klant_id, NULL, coalesce(kor.order_id, o.id), ar.plant_id, ak.aantal, ak.verkoopprijs, 'bevestigd'
        FROM zendingen z JOIN aanbod_regels ar ON ar.aanbod_id = z.aanbod_id
        JOIN aanbod_klanten ak ON ak.regel_id = ar.id AND ak.status = 'akkoord'
        LEFT JOIN klant_order_regels kor ON kor.id = ak.order_regel_id
        LEFT JOIN klant_orders o ON o.aanbod_id = z.aanbod_id AND o.klant_id = ak.klant_id
       WHERE z.factuur_id IS NULL
    )
    SELECT a.zending_id, l.id AS levering_id, p.id AS plant_id, p.naam, p.potmaat, p.hoogte, p.eenheid,
           sum(a.aantal)::int AS aantal, sum(a.aantal * coalesce(a.verkoopprijs, 0)) AS waarde, bool_or(a.status = 'voorstel') AS voorstel
      FROM a JOIN leveringen l ON l.klant_id = a.klant_id AND (l.id = a.levering_id OR l.order_id = a.order_id)
      JOIN planten p ON p.id = a.plant_id
     WHERE a.zending_id = ANY($1) OR l.id = ANY($2)
     GROUP BY a.zending_id, l.id, p.id
     ORDER BY p.naam`, [zids, lids]);
}

// ---------------------------------------------------------------- one lane per grower's truck
async function assemble(zids, lids, al, now) {
  if (!zids.length) return [];
  const zs = await rows(`
    SELECT z.*, g.naam AS kweker, g.plaats AS kweker_plaats, g.land AS kweker_land, g.telefoon AS kweker_telefoon, g.whatsapp AS kweker_whatsapp,
           f.nummer AS factuur_nummer, a.bestelnummer,
           coalesce((SELECT sum(aantal) FROM factuur_regels WHERE factuur_id = z.factuur_id), (SELECT sum(coalesce(bestellen, 0)) FROM aanbod_regels WHERE aanbod_id = z.aanbod_id), 0)::int AS stuks,
           CASE WHEN z.factuur_id IS NOT NULL THEN (SELECT count(*) FROM factuur_regels WHERE factuur_id = z.factuur_id)
                ELSE (SELECT count(*) FROM aanbod_regels WHERE aanbod_id = z.aanbod_id AND coalesce(bestellen, 0) > 0) END::int AS soorten,
           CASE WHEN z.factuur_id IS NOT NULL THEN coalesce((SELECT sum(t.aantal) FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id WHERE fr.factuur_id = z.factuur_id AND t.status <> 'afgewezen' AND t.bestemming = 'klant'), 0)
                ELSE coalesce((SELECT sum(ak.aantal) FROM aanbod_klanten ak JOIN aanbod_regels ar ON ar.id = ak.regel_id WHERE ar.aanbod_id = z.aanbod_id AND ak.status = 'akkoord'), 0) END::int AS voor_klanten
      FROM zendingen z JOIN kwekers g ON g.id = z.kweker_id LEFT JOIN facturen f ON f.id = z.factuur_id LEFT JOIN aanbiedingen a ON a.id = z.aanbod_id
     WHERE z.id = ANY($1)`, [zids]);
  const ls = lids.length ? await rows(`
    SELECT l.*, k.naam AS klant, k.plaats, k.land, k.levervenster, k.contact, k.telefoon, k.whatsapp, o.nummer AS order_nummer
      FROM leveringen l JOIN klanten k ON k.id = l.klant_id LEFT JOIN klant_orders o ON o.id = l.order_id WHERE l.id = ANY($1)`, [lids]) : [];
  const zEv = await eventsFor('zending_id', zids, now);
  const lEv = await eventsFor('levering_id', lids, now);

  const zState = new Map();
  for (const z of zs) zState.set(z.id, { id: z.id, kweker: z.kweker, ...zendingState(z, zEv[z.id] || [], now) });
  const feeders = new Map();
  for (const a of al) { if (!feeders.has(a.levering_id)) feeders.set(a.levering_id, new Set()); feeders.get(a.levering_id).add(a.zending_id); }

  const lState = new Map();
  for (const l of ls) {
    const waits = [...(feeders.get(l.id) || [])].map(id => zState.get(id)).filter(Boolean);
    const st = leveringState(l, lEv[l.id] || [], waits, now);
    const b = { levering_id: l.id, klant_id: l.klant_id, klant: l.klant, plaats: l.plaats, land: l.land, levervenster: l.levervenster, contact: l.contact, telefoon: l.telefoon, whatsapp: l.whatsapp,
      order: l.order_nummer, order_id: l.order_id, vervoerder: l.vervoerder, vertrek_gepland: l.vertrek_gepland, gepland: l.aankomst_gepland, ...st };
    Object.assign(b, deliveryTone(b, waits));
    b.wacht_op = waits.map(z => ({ id: z.id, kweker: z.kweker, state: z.state, eta: z.eta, delay: z.delay }));
    lState.set(l.id, b);
  }

  return zs.map(z => {
    const zin = zState.get(z.id);
    const tin = inboundTone(zin);
    const mine = al.filter(a => a.zending_id === z.id && lState.has(a.levering_id));
    const klanten = uniq(mine.map(a => a.levering_id)).map(lid => {
      const b = lState.get(lid), goods = mine.filter(a => a.levering_id === lid);
      return { ...b, stuks: goods.reduce((s, g) => s + g.aantal, 0), waarde: Math.round(goods.reduce((s, g) => s + Number(g.waarde), 0)),
        planten: goods.map(g => ({ plant_id: g.plant_id, naam: g.naam, maat: [g.potmaat, g.hoogte].filter(Boolean).join(' '), eenheid: g.eenheid, aantal: g.aantal, voorstel: g.voorstel })),
        ook_van: b.wacht_op.filter(w => w.id !== z.id) };
    }).sort((a, b) => new Date(a.vertrek) - new Date(b.vertrek) || a.klant.localeCompare(b.klant, 'nl'));
    const pend = klanten.filter(k => k.state !== 'afgeleverd');
    const toon = worst([tin.toon, ...klanten.map(k => k.toon)]);
    const reden = toon === 'done' ? null
      : [tin.toon === toon ? tin.reden : null, ...klanten.filter(k => k.toon === toon && k.reden).map(k => `${k.klant} ${k.reden}`)].find(Boolean) || null;
    // how far along, as the route is drawn: a third to Nootdorp, a bit in the loods, the rest to the customers
    const voortgang = zin.state !== 'binnen' ? 0.4 * zin.progress
      : !klanten.length ? 0.5
      : 0.45 + 0.55 * klanten.reduce((s, k) => s + k.progress, 0) / klanten.length;
    const stap = zin.state === 'gepland' || zin.state === 'laden' ? 'kweker' : zin.state === 'onderweg' ? 'naar-campo'
      : !pend.length ? (klanten.length ? 'klaar' : 'loods') : pend.some(k => k.state === 'onderweg') || klanten.some(k => k.state === 'afgeleverd') ? 'naar-klant' : 'loods';
    const etas = klanten.map(k => +new Date(k.eta));
    const volgende = zin.state !== 'binnen' ? zin.eta : pend.length ? new Date(Math.min(...pend.map(k => +new Date(k.state === 'onderweg' ? k.eta : k.vertrek)))).toISOString() : null;
    return {
      id: z.id, kweker_id: z.kweker_id, kweker: z.kweker, plaats: z.kweker_plaats, land: z.kweker_land, telefoon: z.kweker_telefoon, whatsapp: z.kweker_whatsapp,
      nummer: z.factuur_nummer || z.bestelnummer || null, factuur_id: z.factuur_id, aanbod_id: z.aanbod_id, vervoerder: z.vervoerder, karren: z.karren == null ? null : Number(z.karren),
      stuks: z.stuks, soorten: z.soorten, vrij: Math.max(0, z.stuks - z.voor_klanten),
      in: { ...zin, gepland: z.aankomst_gepland, vertrek_gepland: z.vertrek_gepland, ...tin },
      klanten, toon, reden, stap, voortgang: Math.round(Math.max(0, Math.min(1, voortgang)) * 100),
      eind: etas.length ? new Date(Math.max(...etas)).toISOString() : zin.eta, volgende,
      actief: zin.state !== 'binnen' || pend.length > 0,
    };
  });
}

// ---------------------------------------------------------------- the workflow page
export async function flowNow() {
  const now = new Date();
  // customer trucks still on their way, or delivered today
  const lids = (await rows(`
    SELECT id FROM leveringen
     WHERE ((aankomst_werkelijk IS NULL OR aankomst_werkelijk > now()) AND vertrek_gepland > now() - interval '3 days' AND vertrek_gepland < now() + interval '3 days')
        OR (aankomst_werkelijk <= now() AND aankomst_werkelijk >= date_trunc('day', now()))`)).map(r => r.id);
  const al = await allocations([], lids);
  // grower trucks still to come, or in today
  const zOwn = (await rows(`
    SELECT id FROM zendingen
     WHERE ((aankomst_werkelijk IS NULL OR aankomst_werkelijk > now()) AND aankomst_gepland > now() - interval '2 days' AND aankomst_gepland < now() + interval '3 days')
        OR (aankomst_werkelijk <= now() AND aankomst_werkelijk >= date_trunc('day', now()))`)).map(r => r.id);
  const zids = uniq([...al.map(a => a.zending_id), ...zOwn]);
  const lanes = await assemble(zids, lids, al, now);
  const banen = lanes.filter(x => x.actief).sort((a, b) => RANK[a.toon] - RANK[b.toon] || new Date(a.volgende || a.eind) - new Date(b.volgende || b.eind));
  const klaar = lanes.filter(x => !x.actief).sort((a, b) => new Date(b.eind) - new Date(a.eind));

  // baskets from growers that are worked out: every plant has a customer and nothing stands in the way
  const cards = (await offerCards()).filter(c => ['aanbod', 'bellen', 'verlopen'].includes(c.stap));
  const sure = c => c.stap !== 'verlopen' && !c.onbekend && c.gekoppeld_pct >= 100 && !(c.risico && c.risico.niveau === 'hoog');
  const card = c => ({
    id: c.id, kweker: c.kweker, plaats: c.plaats, stap: c.stap, levering: c.levering, geldig_tot: c.geldig_tot, ontvangen: c.ontvangen,
    stuks: c.stuks, soorten: c.regels, planten: c.planten, gekoppeld_pct: c.gekoppeld_pct, marge: c.marge, marge_pct: c.marge_pct,
    klanten: c.klanten.filter(k => k.status !== 'nee').length, al_besteld: c.al_besteld, akkoord: c.akkoord, bellen: c.bellen,
    risico: c.risico ? { niveau: c.risico.niveau, kop: (c.risico.kop || [])[0] || null } : null,
  });
  const direct = cards.filter(sure).map(card).sort((a, b) => (a.risico?.niveau === 'middel') - (b.risico?.niveau === 'middel') || b.marge - a.marge);
  const uitzoeken = cards.filter(c => !sure(c)).map(c => ({
    ...card(c),
    waarom: c.stap === 'verlopen' ? 'verlopen' : c.onbekend ? `${c.onbekend} ${c.onbekend === 1 ? 'regel' : 'regels'} niet herkend`
      : c.gekoppeld_pct < 100 ? `${c.gekoppeld_pct}% heeft een klant` : `hoog risico${c.risico && c.risico.kop && c.risico.kop[0] ? `: ${lcTitle(c.risico.kop[0])}` : ''}`,
  })).sort((a, b) => (a.stap === 'verlopen') - (b.stap === 'verlopen') || b.gekoppeld_pct - a.gekoppeld_pct);

  // what is in the loods without a customer
  const loods = await loodsNow();
  const free = loods.partijen.filter(p => p.vrij > 0)
    .sort((a, b) => RANK[a.leeftijd === 'ok' ? 'ok' : a.leeftijd] - RANK[b.leeftijd === 'ok' ? 'ok' : b.leeftijd] || b.vrij * b.prijs - a.vrij * a.prijs)
    .map(p => ({ regel_id: p.regel_id, plant_id: p.plant_id, plant: p.plant, maat: p.maat, eenheid: p.eenheid, kweker: p.kweker, binnen_om: p.binnen_om, uren: p.uren, vrij: p.vrij, waarde: Math.round(p.vrij * p.prijs), leeftijd: p.leeftijd }));

  return {
    nu: now.toISOString(),
    direct, uitzoeken,
    vrij: { stuks: loods.kpi.vrij, waarde: loods.kpi.vrij_waarde, te_lang: loods.kpi.te_lang, partijen: free },
    banen, klaar,
    telling: { bad: banen.filter(x => x.toon === 'bad').length, wait: banen.filter(x => x.toon === 'wait').length, ok: banen.filter(x => x.toon === 'ok').length, klaar: klaar.length },
  };
}

// ---------------------------------------------------------------- one order, for its own tab
export async function orderNow(zendingId) {
  const now = new Date();
  const z = await one('SELECT id, factuur_id, aanbod_id, kweker_id FROM zendingen WHERE id = $1', [zendingId]);
  if (!z) return null;
  const own = await allocations([z.id], []);
  const lids = uniq(own.map(a => a.levering_id));
  const al = lids.length ? await allocations([], lids) : [];
  const zids = uniq([z.id, ...al.map(a => a.zending_id)]);
  const lane = (await assemble(zids, lids, al, now)).find(x => x.id === z.id);

  const kweker = await one('SELECT id, naam, plaats, land, contact, telefoon, whatsapp, email, vervoer FROM kwekers WHERE id = $1', [z.kweker_id]);
  const factuur = z.factuur_id ? await one(`SELECT f.id, f.nummer, f.datum, f.totaal, f.bestand_id, b.naam AS bestand_naam FROM facturen f LEFT JOIN bestanden b ON b.id = f.bestand_id WHERE f.id = $1`, [z.factuur_id]) : null;
  const aanbod = z.aanbod_id ? await one('SELECT id, nummer, bestelnummer, besteld_op FROM aanbiedingen WHERE id = $1', [z.aanbod_id]) : null;

  // what is on the truck, and where every part goes
  const regels = z.factuur_id ? await rows(`
    SELECT fr.id, fr.plant_id, fr.omschrijving, fr.aantal, fr.prijs, p.naam, p.potmaat, p.hoogte, p.eenheid,
           coalesce((SELECT json_agg(json_build_object('klant_id', t.klant_id, 'klant', k.naam, 'bestemming', t.bestemming, 'aantal', t.aantal, 'status', t.status) ORDER BY t.aantal DESC)
             FROM toewijzingen t LEFT JOIN klanten k ON k.id = t.klant_id WHERE t.regel_id = fr.id AND t.status <> 'afgewezen'), '[]') AS naar
      FROM factuur_regels fr LEFT JOIN planten p ON p.id = fr.plant_id WHERE fr.factuur_id = $1 ORDER BY fr.regelnr`, [z.factuur_id])
    : await rows(`
    SELECT ar.id, ar.plant_id, ar.omschrijving, coalesce(ar.bestellen, 0) AS aantal, ar.prijs, p.naam, p.potmaat, p.hoogte, p.eenheid,
           coalesce((SELECT json_agg(json_build_object('klant_id', ak.klant_id, 'klant', k.naam, 'bestemming', 'klant', 'aantal', ak.aantal, 'status', 'bevestigd') ORDER BY ak.aantal DESC)
             FROM aanbod_klanten ak JOIN klanten k ON k.id = ak.klant_id WHERE ak.regel_id = ar.id AND ak.status = 'akkoord'), '[]') AS naar
      FROM aanbod_regels ar LEFT JOIN planten p ON p.id = ar.plant_id WHERE ar.aanbod_id = $1 AND coalesce(ar.bestellen, 0) > 0 ORDER BY ar.regelnr`, [z.aanbod_id]);
  for (const r of regels) {
    const klant = r.naar.filter(n => n.bestemming === 'klant').reduce((s, n) => s + n.aantal, 0);
    const retour = r.naar.filter(n => n.bestemming === 'retour').reduce((s, n) => s + n.aantal, 0);
    r.prijs = Number(r.prijs); r.vrij = Math.max(0, r.aantal - klant - retour); r.retour = retour;
    r.naar = r.naar.filter(n => n.bestemming === 'klant');
    r.maat = [r.potmaat, r.hoogte].filter(Boolean).join(' ');
  }

  // everything that was heard about these trucks, newest first
  const ev = await rows(`
    SELECT e.tijd, e.soort, e.plaats, e.eta, e.tekst, e.bron, e.zending_id, e.levering_id, k.naam AS klant
      FROM gebeurtenissen e LEFT JOIN leveringen l ON l.id = e.levering_id LEFT JOIN klanten k ON k.id = l.klant_id
     WHERE (e.zending_id = $1 OR e.levering_id = ANY($2)) AND e.tijd <= now() ORDER BY e.tijd DESC LIMIT 40`, [z.id, lids]);

  return { nu: now.toISOString(), baan: lane, kweker, factuur, aanbod, regels, gebeurtenissen: ev };
}
