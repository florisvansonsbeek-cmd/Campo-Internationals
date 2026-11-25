// Demo offers: four months of baskets growers offered and what came of them, and today's baskets in every step.
// Everything is fictional. The current offers are read by the same rules and proposed by the same engine as real ones.
import { pool, rows, one } from '../db.js';
import { PLANTS, GROWERS, COLOR_EN, growerName } from './catalog.js';
import { offerFromMessage } from '../ingest/process.js';
import { callOutcome, placeOrder, receiveOrder, declineOffer, dropCaches } from '../offers.js';
import { afterChange } from '../pipeline.js';

const DAY = 864e5, MIN = 6e4;
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const euro = v => (v < 1 ? v.toFixed(3) : v.toFixed(2)).replace('.', ',');
const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export async function seedOffers({ now = new Date(), seed = 4811 } = {}) {
  const r = rng(seed);
  const RI = (a, b) => Math.floor(a + r() * (b - a + 1));
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const at = (dayOffset, h, m = 0) => { const d = new Date(today.getTime() + dayOffset * DAY); d.setHours(h, m, 0, 0); return d; };

  // the catalogue as the demo knows it, with each grower's way of writing a plant
  const variants = [];
  for (const b of PLANTS) {
    if (b.kleuren) for (const k of b.kleuren) variants.push({ ...b, code: `${b.code}-${k}`, base: b.code, kleur: k, basenaam: b.naam, naam: `${b.naam} ${k}`, en: `${b.en} ${COLOR_EN[k]}` });
    else variants.push({ ...b, base: b.code });
  }
  const db = await rows('SELECT id, code, per_laag, verkoopprijs, seizoen, groep FROM planten');
  const P = Object.fromEntries(variants.map(v => [v.code, { ...v, ...(db.find(x => x.code === v.code) || {}) }]));
  const G = Object.fromEntries((await rows('SELECT * FROM kwekers')).map(g => [g.code, { ...g, ...GROWERS.find(x => x.code === g.code) }]));
  const K = await rows(`SELECT id, code, naam, actief FROM klanten`);
  const CAT = Object.fromEntries((await import('./catalog.js')).CUSTOMERS.map(c => [c.code, c]));
  const normal = async (g, p) => {
    const x = await one(`SELECT avg(fr.prijs) AS p FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id WHERE fr.plant_id = $1 AND f.kweker_id = $2 AND f.datum > current_date - 120`, [p.id, g.id]);
    return Number(x?.p) || Number(p.verkoopprijs) * (g.assort[p.base] || 0.68);
  };
  const inSeason = (p, d) => !p.seizoen || !p.seizoen.length || p.seizoen.includes(d.getMonth() + 1);

  // credit limits as a wholesaler sets them: about six weeks of sales, and two customers who are at their limit
  await pool.query(`UPDATE klanten k SET kredietlimiet = greatest(5000, round(coalesce((SELECT sum(v.bedrag) FROM verkoopfacturen v WHERE v.klant_id = k.id AND v.datum > current_date - 90), 0) / 2 / 1000) * 1000)`);
  await pool.query(`UPDATE klanten k SET kredietlimiet = greatest(2000, round(coalesce((SELECT sum(v.bedrag) FROM verkoopfacturen v WHERE v.klant_id = k.id AND v.betaald_op IS NULL), 0) * 0.9 / 1000) * 1000) WHERE code IN ('wisla', 'verdemilano')`);

  // ---------- history: what was offered, ordered, turned down or let go, and who said yes
  const propensity = k => 0.35 + (hash(k.code) % 50) / 100;
  const buyersOf = p => K.filter(k => k.actief && CAT[k.code] && CAT[k.code].mix.includes(p.base) && (!p.kleur || !CAT[k.code].kleur || !CAT[k.code].kleur[p.base] || CAT[k.code].kleur[p.base].includes(p.kleur)));
  const growerCodes = Object.keys(G).filter(c => G[c].assort);
  let hist = 0;
  for (let d = 120; d >= 3; d--) {
    const day = new Date(today.getTime() - d * DAY);
    const dw = ((day.getDay() + 6) % 7) + 1;
    if (dw > 5 || r() < 0.45) continue;
    const g = G[growerCodes[Math.floor(r() * growerCodes.length)]];
    const fams = Object.keys(g.assort);
    const lines = [];
    for (const fam of fams.sort(() => r() - 0.5).slice(0, RI(2, Math.min(4, fams.length)))) {
      const opts = variants.filter(v => v.base === fam && P[v.code].id && inSeason(P[v.code], day));
      if (!opts.length) continue;
      const p = P[opts[Math.floor(r() * opts.length)].code];
      const per = p.per_laag || 1;
      lines.push({ p, aantal: per * RI(2, 8) * (per >= 200 ? 2 : 1), prijs: Math.round((await normal(g, p)) * (0.9 + r() * 0.22) * 1000) / 1000 });
    }
    if (!lines.length) continue;
    const ont = new Date(day); ont.setHours(RI(6, 10), RI(0, 59));
    const roll = r();
    const status = roll < 0.55 ? 'besteld' : roll < 0.8 ? 'afgewezen' : 'nieuw';
    const a = await one(`INSERT INTO aanbiedingen (kweker_id, nummer, ontvangen, geldig_tot, levering, gelezen_door, zekerheid, status, besteld_op, afgewezen_om, bestelnummer, aangemaakt, bijgewerkt)
        VALUES ($1, $2, $3, $4, $5, 'demo', 96, $6, $7, $8, $9, $3, $3) RETURNING id`,
      [g.id, r() < 0.4 ? `week ${Math.ceil((day - new Date(day.getFullYear(), 0, 1)) / (7 * DAY))}` : null, ont, new Date(ont.getTime() + RI(4, 8) * 36e5), ymd(new Date(day.getTime() + DAY)), status,
        status === 'besteld' ? new Date(ont.getTime() + RI(40, 200) * MIN) : null,
        status === 'afgewezen' ? ['Te duur', 'Al genoeg op voorraad', 'Klanten hadden geen interesse', 'Levering te laat'][Math.floor(r() * 4)] : null,
        status === 'besteld' ? `CI-B-${String(day.getFullYear()).slice(2)}-H${String(++hist).padStart(3, '0')}` : null]);
    let nr = 0;
    for (const l of lines) {
      const ar = await one(`INSERT INTO aanbod_regels (aanbod_id, regelnr, omschrijving, plant_id, match_zekerheid, aantal, prijs) VALUES ($1, $2, $3, $4, 100, $5, $6) RETURNING id`,
        [a.id, ++nr, growerName(g.style, l.p), l.p.id, l.aantal, l.prijs]);
      let left = l.aantal, taken = 0;
      for (const k of buyersOf(l.p).sort(() => r() - 0.5).slice(0, 3)) {
        const n = Math.min(left, (l.p.per_laag || 1) * RI(1, 4));
        if (n <= 0) break;
        const st = status === 'nieuw' ? 'voorstel' : r() < propensity(k) * (status === 'besteld' ? 1.15 : 0.55) ? 'akkoord' : 'nee';
        await pool.query(`INSERT INTO aanbod_klanten (regel_id, klant_id, bron, aantal, verkoopprijs, score, reden, status, door, aangemaakt) VALUES ($1, $2, 'aanbod', $3, $4, $5, 'Voorstel van de desk', $6, 'demo', $7)`,
          [ar.id, k.id, n, Math.round(l.prijs * (1.32 + r() * 0.16) * 100) / 100, RI(48, 92), st, ont]);
        left -= n; if (st === 'akkoord') taken += n;
      }
      if (status === 'besteld') await pool.query('UPDATE aanbod_regels SET bestellen = $2 WHERE id = $1', [ar.id, Math.min(l.aantal, Math.ceil(Math.max(taken, l.p.per_laag || 1) / (l.p.per_laag || 1)) * (l.p.per_laag || 1))]);
    }
  }

  // ---------- today's baskets: real messages, read by the rules, proposed by the engine
  const until = (h, m = 0, d = 0) => at(d, h, m);
  // this morning's messages; before seven in the morning they came in yesterday afternoon
  const early = now.getHours() < 7;
  const ago = (hours, fallbackHour) => (early ? at(-1, fallbackHour, 10) : new Date(now.getTime() - hours * 36e5));
  const late = now.getHours() >= 20 || now.getHours() < 5;
  const soon = late ? until(10, 0, 1) : new Date(Math.ceil((now.getTime() + 105 * MIN) / (15 * MIN)) * 15 * MIN);
  const plan = [
    { key: 'westland', g: 'westland', kanaal: 'whatsapp', ont: () => ago(1.2, 16), lines: [['mons-p21', 24, 0.98], ['cala-p14', 6, 1.0], ['strel-p21', 8, 0.97], ['zz-p17', 8, 1.02]], end: () => until(16, 0, now.getHours() >= 16 ? 1 : 0), lev: 'morgen', state: 'nieuw' },
    { key: 'leeuwen', g: 'leeuwen', kanaal: 'mail', ont: () => ago(2.3, 14), subject: 'Aanbod week', lines: [['phal-2t-p12-wit', 8, 0.97], ['phal-2t-p12-roze', 6, 0.96], ['phal-mini-p9', 6, 0.95]], end: () => until(10, 0, 1), lev: 'overmorgen', state: 'nieuw' },
    { key: 'verhoeven', g: 'verhoeven', kanaal: 'whatsapp', ont: () => at(-1, 16, 20), lines: [['cycl-p12-rood', 8, 1.13], ['cycl-p12-wit', 4, 1.1], ['kala-p10', 12, 1.04]], end: () => soon, lev: 'overmorgen', whole: true, state: 'nieuw' },
    { key: 'lindner', g: 'lindner', kanaal: 'mail', ont: () => ago(3.1, 13), subject: 'Angebot', lines: [['phal-2t-p12-paars', 5, 0.98], ['cycl-p12-roze', 6, 1.0], ['bolchry-p19-geel', 6, 1.01], ['cycl-p12-wit', 4, 0.99]], end: () => until(17, 0, now.getHours() >= 17 ? 1 : 0), lev: 'morgen', state: 'bellen', calls: ['akkoord', 'terugbellen'] },
    { key: 'zonnehoek', g: 'zonnehoek', kanaal: 'whatsapp', ont: () => ago(1.9, 15), lines: [['kerstster-p13-rood', 20, 0.99], ['kerstster-p13-wit', 10, 0.98], ['kala-p10', 10, 0.97], ['brom-p12', 6, 1.0]], end: () => until(9, 0, 1), lev: 'overmorgen', state: 'bellen', calls: ['akkoord', 'nee', 'akkoord'] },
    { key: 'pijnacker', g: 'pijnacker', kanaal: 'mail', ont: () => at(-1, 9, 5), subject: 'Aanbod Anthurium', lines: [['anth-rood-p12', 6, 0.98], ['spath-p17', 6, 1.0]], end: () => until(12, 0, 0), lev: 'overmorgen', state: 'besteld' },
    { key: 'delier', g: 'delier', kanaal: 'whatsapp', ont: () => at(-1, 15, 40), lines: [['roos-rood-60', 8, 0.97], ['alstro-70', 10, 1.0], ['chry-tros-70', 6, 0.98]], end: () => until(17, 0, -1), lev: 'morgen', state: 'binnen' },
    { key: 'groenhuis', g: 'groenhuis', kanaal: 'mail', ont: () => at(-1, 10, 25), subject: 'Aanbieding', lines: [['zz-p17', 12, 1.19], ['sans-p14', 6, 1.12]], end: () => until(18, 0, -1), lev: 'morgen', state: 'afgewezen' },
    { key: 'varenhof', g: 'varenhof', kanaal: 'whatsapp', ont: () => (early ? at(-1, 17, 45) : new Date(now.getTime() - 24 * MIN)), lines: [['varen-p17', 6, 0.96], ['cala-p14', 2, 0.97], ['pothos-p15', 3, 1.0]], end: () => until(15, 0, now.getHours() >= 15 ? 1 : 0), lev: 'morgen', state: 'ongelezen' },
  ];
  const made = {};
  let ext = 0;
  for (const o of plan) {
    const g = G[o.g];
    if (!g) continue;
    const ont = o.ont();
    const items = [];
    for (const [code, layers, factor] of o.lines) {
      const p = P[code];
      if (!p || !p.id || !inSeason(p, today)) continue;
      const prijs = Math.round((await normal(g, p)) * factor * (p.verkoopprijs < 1 ? 1000 : 100)) / (p.verkoopprijs < 1 ? 1000 : 100);
      items.push({ p, n: (p.per_laag || 1) * layers, prijs });
    }
    if (items.length < 2) continue;
    const first = (g.contact || '').split(' ')[0];
    const end = o.end();
    const endTxt = ymd(end) === ymd(ont) ? `vandaag tot ${hhmm(end)}` : ymd(end) === ymd(new Date(ont.getTime() + DAY)) ? `tot morgen ${hhmm(end)}` : `tot ${hhmm(end)}`;
    let tekst, onderwerp = null;
    if (o.g === 'lindner') {
      onderwerp = `${o.subject} KW ${Math.ceil((today - new Date(today.getFullYear(), 0, 1)) / (7 * DAY)) + 1}`;
      tekst = `Guten Morgen Jan,\n\nfür ${o.lev === 'morgen' ? 'morgen' : 'übermorgen'} haben wir noch verfügbar:\n\n${items.map(i => `${i.n}x ${growerName(g.style, i.p)} à ${euro(i.prijs)} €`).join('\n')}\n\nLieferung ${o.lev === 'morgen' ? 'morgen' : 'übermorgen'} früh. Angebot gültig bis ${hhmm(end)} Uhr.\n\nMit freundlichen Grüßen\n${g.contact}\n${g.naam}`;
    } else if (o.kanaal === 'mail') {
      onderwerp = o.subject === 'Aanbod week' ? `Aanbod week ${Math.ceil((today - new Date(today.getFullYear(), 0, 1)) / (7 * DAY)) + 1}` : o.subject;
      tekst = `Beste Jan,\n\nDeze week kunnen we je het volgende aanbieden:\n\n${items.map(i => `${i.n}x ${growerName(g.style, i.p)} à €${euro(i.prijs)}`).join('\n')}\n\nLevering ${o.lev}. Het aanbod is geldig ${endTxt}.\n\nMet vriendelijke groet,\n${g.contact}\n${g.naam}`;
    } else {
      tekst = `${o.key === 'verhoeven' ? 'Hoi Jan, heb nog een mooie partij' : o.key === 'delier' ? 'Morgen Jan! Voor morgen beschikbaar' : 'Goedemorgen Jan, heb nog over'}:\n${items.map(i => `${i.n}x ${growerName(g.style, i.p)} à €${euro(i.prijs)}`).join('\n')}\nLevering ${o.lev}. ${o.whole ? 'Alleen hele partij. ' : ''}Geldig ${endTxt}. Gr ${first}`;
    }
    const b = await one(`INSERT INTO berichten_in (kanaal, extern_id, van, van_naam, onderwerp, tekst, ontvangen, kweker_id, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'nieuw') RETURNING id`,
      [o.kanaal, `demo-aanbod-${++ext}`, o.kanaal === 'mail' ? g.email : g.whatsapp, g.naam, onderwerp, tekst, ont, g.id]);
    if (o.state === 'ongelezen') continue;
    const res = await offerFromMessage(b.id, { door: 'demo', notify: false });
    made[o.key] = { id: res.aanbod_id, o };
  }

  // ---------- what Jan already did with them today
  dropCaches();
  const yes = (id, n = 99) => rows(`SELECT DISTINCT ak.klant_id, max(ak.score) AS s FROM aanbod_klanten ak JOIN aanbod_regels ar ON ar.id = ak.regel_id WHERE ar.aanbod_id = $1 AND ak.bron = 'aanbod' GROUP BY ak.klant_id ORDER BY s DESC NULLS LAST LIMIT $2`, [id, n]);
  const notes = { terugbellen: 'Belt na de lunch terug', nee: 'Heeft nog genoeg staan' };
  for (const key of ['lindner', 'zonnehoek']) {
    const m = made[key]; if (!m) continue;
    const ks = await yes(m.id, m.o.calls.length);
    for (let i = 0; i < ks.length; i++) await callOutcome(m.id, ks[i].klant_id, m.o.calls[i], notes[m.o.calls[i]] || null, 'Jan');
    await afterChange(m.id);
    // the ones who said yes got their offer already
    await pool.query(`UPDATE concepten SET status = 'verstuurd', verstuurd_op = gebeld_op + interval '4 minutes' WHERE aanbod_id = $1 AND soort = 'offerte' AND gesprek = 'akkoord'`, [m.id]);
  }
  for (const key of ['pijnacker', 'delier']) {
    const m = made[key]; if (!m) continue;
    for (const k of await yes(m.id)) await callOutcome(m.id, k.klant_id, 'akkoord', null, 'Jan');
    await afterChange(m.id);
    await placeOrder(m.id, {}, 'Jan');
    await afterChange(m.id);
    const placedAt = new Date(m.o.ont().getTime() + 95 * MIN);
    await pool.query(`UPDATE aanbiedingen SET besteld_op = $2, bijgewerkt = $2 WHERE id = $1`, [m.id, placedAt]);
    await pool.query(`UPDATE concepten SET status = 'verstuurd', verstuurd_op = $2 WHERE aanbod_id = $1 AND status IN ('concept', 'in_outlook')`, [m.id, placedAt]);
    await pool.query(`UPDATE klant_orders SET besteld_op = $2 WHERE aanbod_id = $1`, [m.id, placedAt]);
  }
  // Snijbloemen De Lier came in this morning: booked into the loods from the order
  if (made.delier) {
    const z = await one('SELECT * FROM zendingen WHERE aanbod_id = $1', [made.delier.id]);
    if (z) {
      const arr = new Date(Math.min(now.getTime() - 25 * MIN, new Date(z.aankomst_gepland).getTime() + 9 * MIN));
      const dep = new Date(arr.getTime() - (Number(G.delier.reistijd_min) || 20) * MIN);
      await pool.query('UPDATE zendingen SET vertrek_gepland = least(vertrek_gepland, $2), aankomst_gepland = least(aankomst_gepland, $3), vertrek_werkelijk = $2, aankomst_werkelijk = $3, aankomst_verwacht = $3 WHERE id = $1', [z.id, dep, arr]);
      await pool.query(`INSERT INTO gebeurtenissen (zending_id, tijd, soort, plaats, eta, tekst, bron) VALUES ($1, $2, 'vertrokken', 'De Lier', $3, 'Onderweg', 'whatsapp'), ($1, $3, 'aangekomen', 'Campo, Nootdorp', NULL, 'Binnen bij Campo', 'jan')`, [z.id, dep, arr]);
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const fid = await receiveOrder(c, z.id);
        if (fid) await c.query(`UPDATE facturen SET aangemaakt = $2 WHERE id = $1`, [fid, arr]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    }
  }
  if (made.groenhuis) await declineOffer(made.groenhuis.id, 'Te duur: Westland Groen levert Zamioculcas voor minder', 'Jan');
  dropCaches();
  return { geschiedenis: hist, vandaag: Object.keys(made).length };
}
