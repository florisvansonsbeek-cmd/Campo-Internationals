// The desk's API. Everything under /api needs a signed-in session (see server.js).
import express from 'express';
import crypto from 'node:crypto';
import { pool, rows, one, q, log, setting } from './db.js';
import { growerList, growerDetail, customerList, customerDetail, plantList, plantDetail } from './analytics.js';
import { restSuggestions, proposeForInvoice } from './allocate.js';
import { processMessage } from './ingest/process.js';
import { deliveryMessage, offerMessage, delayMessage, LANG_NAME } from './messages.js';
import { aiStatus, aiCheck } from './ingest/ai.js';
import { mailStatus, pollMail } from './ingest/mail.js';
import { whatsappStatus } from './ingest/whatsapp.js';
import { removeWeekDemo } from './week/demo.js';
import { week } from './week/routes.js';
import { offerCards, offerDetail, callOutcome, placeOrder, declineOffer, receiveOrder, proposeOffer, customerStats, dropCaches } from './offers.js';
import { conceptPdf, conceptEml } from './drafts.js';
import { pushOffer, pushConcept, sendConcept, outlookStatus, disconnect, removeFromOutlook, syncSent, authStart, authBack, target } from './outlook.js';
import { afterChange, afterOffer } from './pipeline.js';
import { loodsNow } from './loods.js';
import { zendingState, leveringState, eventsFor, flowNow, orderNow } from './stroom.js';
import { agenda, trucksOn, wagenNow, ymd } from './agenda.js';
import { giveFromLoods } from './erbij.js';

export const api = express.Router();
// the weekly rhythm: ordering, shipments, Monday, packing slips, customers and the year
api.use('/week', week);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const who = req => (req.user && req.user.naam) || 'Jan';
const int = v => { const n = Number(v); return Number.isInteger(n) ? n : null; };
const MIN = 6e4;

// ---------------------------------------------------------------- validation
const CC = /^[A-Z]{2}$/, EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function phone(v) {
  if (v == null || v === '') return null;
  let s = String(v).replace(/[\s()-]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^0[1-9]\d{8}$/.test(s)) s = '+31' + s.slice(1);
  return /^\+\d{8,15}$/.test(s) ? s : undefined;
}
class Invalid extends Error { constructor(fields) { super('Niet alles is goed ingevuld.'); this.fields = fields; } }
function clean(body, spec, { partial = false } = {}) {
  const out = {}, bad = {};
  for (const [k, s] of Object.entries(spec)) {
    if (!(k in body)) { if (!partial && s.required) bad[k] = 'Vul dit in.'; continue; }
    let v = body[k];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v == null) { if (s.required) bad[k] = 'Vul dit in.'; else out[k] = null; continue; }
    switch (s.type) {
      case 'text': if (String(v).length > (s.max || 500)) bad[k] = `Maximaal ${s.max || 500} tekens.`; else out[k] = String(v); break;
      case 'email': if (!EMAIL.test(v)) bad[k] = 'Dit is geen geldig e-mailadres.'; else out[k] = String(v).toLowerCase(); break;
      case 'phone': { const p = phone(v); if (p === undefined) bad[k] = 'Gebruik een nummer met landcode, bijvoorbeeld +31 6 1234 5678.'; else out[k] = p; break; }
      case 'cc': if (!CC.test(String(v).toUpperCase())) bad[k] = 'Twee letters, bijvoorbeeld NL.'; else out[k] = String(v).toUpperCase(); break;
      case 'int': { const n = Number(v); if (!Number.isInteger(n) || (s.min != null && n < s.min) || (s.max != null && n > s.max)) bad[k] = `Een heel getal${s.min != null ? ` van ${s.min}` : ''}${s.max != null ? ` tot ${s.max}` : ''}.`; else out[k] = n; break; }
      case 'num': { const n = Number(String(v).replace(',', '.')); if (!Number.isFinite(n) || (s.min != null && n < s.min)) bad[k] = 'Een getal.'; else out[k] = n; break; }
      case 'enum': if (!s.values.includes(v)) bad[k] = `Kies uit: ${s.values.join(', ')}.`; else out[k] = v; break;
      case 'bool': out[k] = v === true || v === 'true' || v === 1; break;
      case 'days': { const a = Array.isArray(v) ? v.map(Number) : String(v).split(/[ ,]+/).map(Number); if (a.some(d => !Number.isInteger(d) || d < 1 || d > 7)) bad[k] = 'Dagen 1 (ma) tot 7 (zo).'; else out[k] = [...new Set(a)].sort(); break; }
      case 'time': if (!/^\d{1,2}:\d{2}$/.test(v)) bad[k] = 'Tijd als 06:30.'; else out[k] = v; break;
      default: out[k] = v;
    }
  }
  if (Object.keys(bad).length) throw new Invalid(bad);
  return out;
}

// ---------------------------------------------------------------- Vandaag: where everything is, and when it arrives where
api.get('/vandaag', wrap(async (req, res) => {
  const now = new Date();
  const zs = await rows(`
    SELECT z.*, k.naam AS kweker, k.plaats AS kweker_plaats, k.land AS kweker_land, k.whatsapp AS kweker_whatsapp, k.telefoon AS kweker_telefoon,
           f.nummer, f.id AS factuur_id, s.stap, s.regels, s.stuks, s.rest, s.klanten
      FROM zendingen z JOIN kwekers k ON k.id = z.kweker_id LEFT JOIN facturen f ON f.id = z.factuur_id LEFT JOIN factuur_stap s ON s.factuur_id = f.id
     WHERE z.aankomst_gepland::date = current_date
        OR (z.vertrek_werkelijk <= now() AND (z.aankomst_werkelijk IS NULL OR z.aankomst_werkelijk > now()) AND z.aankomst_gepland > now() - interval '2 days')
        OR (z.aankomst_gepland::date = current_date + 1 AND z.aankomst_gepland < (current_date + 1) + time '08:00')
     ORDER BY z.aankomst_gepland`);
  const zEv = await eventsFor('zending_id', zs.map(z => z.id), now);
  const lines = zs.length ? await rows(`
    SELECT fr.factuur_id, fr.id, fr.aantal, p.naam, p.potmaat, p.hoogte, p.eenheid,
           (SELECT json_agg(json_build_object('klant_id', t.klant_id, 'klant', k.naam, 'aantal', t.aantal, 'status', t.status, 'soort', t.soort, 'levering_id', t.levering_id))
              FROM toewijzingen t JOIN klanten k ON k.id = t.klant_id WHERE t.regel_id = fr.id AND t.status <> 'afgewezen' AND t.bestemming = 'klant') AS naar
      FROM factuur_regels fr LEFT JOIN planten p ON p.id = fr.plant_id WHERE fr.factuur_id = ANY($1) ORDER BY fr.regelnr`, [zs.map(z => z.factuur_id).filter(Boolean)]) : [];
  const byF = {};
  for (const l of lines) (byF[l.factuur_id] = byF[l.factuur_id] || []).push(l);

  const ls = await rows(`
    SELECT l.*, k.naam AS klant, k.plaats, k.land, k.kanaal, k.taal, k.contact, k.whatsapp, k.email, k.levervenster, o.nummer AS order_nummer
      FROM leveringen l JOIN klanten k ON k.id = l.klant_id LEFT JOIN klant_orders o ON o.id = l.order_id
     WHERE l.vertrek_gepland::date = current_date
        OR (l.vertrek_werkelijk <= now() AND (l.aankomst_werkelijk IS NULL OR l.aankomst_werkelijk > now()) AND l.vertrek_gepland > now() - interval '3 days')
        OR l.aankomst_gepland::date = current_date
     ORDER BY l.vertrek_gepland`);
  const lEv = await eventsFor('levering_id', ls.map(l => l.id), now);
  // which inbound trucks each delivery waits for
  const feeds = ls.length ? await rows(`
    SELECT DISTINCT t.levering_id, z.id AS zending_id
      FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN zendingen z ON z.factuur_id = fr.factuur_id
     WHERE t.levering_id = ANY($1) AND t.status <> 'afgewezen'
    UNION
    SELECT DISTINCT l.id, z.id
      FROM leveringen l JOIN klant_order_regels kor ON kor.order_id = l.order_id
      JOIN toewijzingen t ON t.order_regel_id = kor.id AND t.status <> 'afgewezen'
      JOIN factuur_regels fr ON fr.id = t.regel_id JOIN zendingen z ON z.factuur_id = fr.factuur_id
     WHERE l.id = ANY($1)`, [ls.map(l => l.id)]) : [];
  const goods = ls.length ? await rows(`
    SELECT l.id AS levering_id, p.naam, p.potmaat, p.hoogte, p.eenheid, sum(t.aantal) AS aantal, max(g.naam) AS kweker
      FROM leveringen l
      JOIN toewijzingen t ON (t.levering_id = l.id OR t.order_regel_id IN (SELECT id FROM klant_order_regels WHERE order_id = l.order_id)) AND t.status <> 'afgewezen' AND t.klant_id = l.klant_id
      JOIN factuur_regels fr ON fr.id = t.regel_id JOIN planten p ON p.id = fr.plant_id JOIN facturen f ON f.id = fr.factuur_id JOIN kwekers g ON g.id = f.kweker_id
     WHERE l.id = ANY($1) GROUP BY l.id, p.id ORDER BY p.naam`, [ls.map(l => l.id)]) : [];
  const orderGoods = ls.length ? await rows(`
    SELECT l.id AS levering_id, p.naam, p.potmaat, p.hoogte, p.eenheid, kor.aantal
      FROM leveringen l JOIN klant_order_regels kor ON kor.order_id = l.order_id JOIN planten p ON p.id = kor.plant_id WHERE l.id = ANY($1)`, [ls.map(l => l.id)]) : [];

  const zOut = zs.map(z => {
    const ev = zEv[z.id] || [];
    const st = zendingState(z, ev, now);
    return {
      id: z.id, factuur_id: z.factuur_id, nummer: z.nummer, kweker_id: z.kweker_id, kweker: z.kweker, van: z.kweker_plaats, land: z.kweker_land, whatsapp: z.kweker_whatsapp,
      vervoerder: z.vervoerder, karren: z.karren, gepland: z.aankomst_gepland, vertrek_gepland: z.vertrek_gepland, ...st,
      stap: z.stap, regels: (byF[z.factuur_id] || []).map(l => ({ id: l.id, aantal: l.aantal, plant: l.naam, maat: [l.potmaat, l.hoogte].filter(Boolean).join(' '), eenheid: l.eenheid, naar: l.naar || [] })),
      stuks: z.stuks, rest: z.rest, klanten: z.klanten,
      gebeurtenissen: ev.slice(-6),
    };
  });
  const zById = Object.fromEntries(zOut.map(z => [z.id, z]));
  const lOut = ls.map(l => {
    const ev = lEv[l.id] || [];
    const waits = feeds.filter(f => f.levering_id === l.id).map(f => zById[f.zending_id]).filter(Boolean);
    const st = leveringState(l, ev, waits, now);
    const g = goods.filter(x => x.levering_id === l.id);
    const lijst = (g.length ? g : orderGoods.filter(x => x.levering_id === l.id)).map(x => ({ plant: x.naam, maat: [x.potmaat, x.hoogte].filter(Boolean).join(' '), aantal: Number(x.aantal), eenheid: x.eenheid, kweker: x.kweker || null }));
    return {
      id: l.id, klant_id: l.klant_id, klant: l.klant, plaats: l.plaats, land: l.land, kanaal: l.kanaal, order: l.order_nummer, vervoerder: l.vervoerder, levervenster: l.levervenster,
      vertrek_gepland: l.vertrek_gepland, vertrek: st.vertrek, aankomst_gepland: l.aankomst_gepland, eta: st.eta, delay: st.delay, state: st.state, progress: st.progress,
      wacht_op: waits.filter(z => z.state !== 'binnen').map(z => ({ id: z.id, kweker: z.kweker, eta: z.eta, delay: z.delay })), van: waits.map(z => z.kweker),
      krap: st.krap, goederen: lijst, gebeurtenissen: ev.slice(-4),
    };
  });

  // work in the flow
  const stappen = await rows(`SELECT s.stap, count(*) AS n, sum(s.rest) AS rest FROM factuur_stap s JOIN facturen f ON f.id = s.factuur_id
     WHERE NOT f.afgerond AND (s.stap <> 'klaar' OR f.datum >= current_date - 1) GROUP BY s.stap`);
  const inbox = await one(`SELECT count(*) FILTER (WHERE status IN ('nieuw', 'bezig')) AS nieuw, count(*) FILTER (WHERE status = 'fout') AS fout FROM berichten_in WHERE ontvangen <= now() AND ontvangen > now() - interval '14 days'`);

  // what needs Jan, most urgent first
  const aandacht = [];
  for (const b of await rows(`SELECT id, van, van_naam, onderwerp, fout FROM berichten_in WHERE status = 'fout' AND fout LIKE 'Verdacht%' AND ontvangen <= now() ORDER BY ontvangen DESC LIMIT 3`))
    aandacht.push({ toon: 'bad', soort: 'verdacht', titel: `Verdachte factuur van ${b.van_naam || b.van}`, tekst: b.fout, link: `#/inbox/${b.id}`, knop: 'Bekijken' });
  for (const z of zOut.filter(z => z.state !== 'binnen' && (z.silentLate || z.delay >= 15))) {
    const hit = lOut.filter(l => l.wacht_op.some(w => w.id === z.id) && l.krap);
    aandacht.push({ toon: z.silentLate || hit.length ? 'bad' : 'wait', soort: 'laat', titel: `${z.kweker} ${z.silentLate ? 'is te laat en liet niets horen' : `loopt ${z.delay} min achter`}`,
      tekst: `${z.silentLate ? `Gepland ${hm(z.gepland)}; nu geen bericht.` : `Verwacht ${hm(z.eta)} in plaats van ${hm(z.gepland)}.`}${hit.length ? ` Raakt ${hit.map(l => `${l.klant} (wagen ${hm(l.vertrek_gepland)})`).join(', ')}.` : ''}`,
      link: z.factuur_id ? `#/factuur/${z.factuur_id}` : null, knop: 'Openen', bellen: z.whatsapp });
  }
  for (const f of await rows(`SELECT f.id, f.nummer, k.naam, s.stap, s.rest, s.twijfel, s.voorstel, s.klanten, s.verstuurd FROM facturen f JOIN kwekers k ON k.id = f.kweker_id JOIN factuur_stap s ON s.factuur_id = f.id
      WHERE NOT f.afgerond AND s.stap IN ('nakijken', 'koppelen', 'rest', 'informeren') ORDER BY array_position(ARRAY['nakijken','koppelen','rest','informeren'], s.stap), f.datum, f.id`)) {
    const t = {
      nakijken: { toon: 'wait', titel: `Nakijken: ${f.naam} ${f.nummer}`, tekst: `${f.twijfel} ${f.twijfel === 1 ? 'regel is' : 'regels zijn'} niet zeker gelezen.` },
      koppelen: { toon: 'info', titel: `Koppeling bevestigen: ${f.naam} ${f.nummer}`, tekst: 'De desk heeft de planten al aan klanten gekoppeld. Even nalopen en bevestigen.' },
      rest: { toon: 'info', titel: `Vrij in de loods: ${f.naam} ${f.nummer}`, tekst: `${Number(f.rest).toLocaleString('nl-NL')} stuks hebben nog geen klant. Bied ze aan vanuit de loods.` },
      informeren: { toon: 'info', titel: `Klanten informeren: ${f.naam} ${f.nummer}`, tekst: `${f.klanten - f.verstuurd} ${f.klanten - f.verstuurd === 1 ? 'klant wacht' : 'klanten wachten'} op een bericht.` },
    }[f.stap];
    aandacht.push({ ...t, soort: f.stap, link: `#/factuur/${f.id}`, knop: 'Openen' });
  }
  if (Number(inbox.nieuw)) aandacht.push({ toon: 'info', soort: 'inbox', titel: `${inbox.nieuw} ${Number(inbox.nieuw) === 1 ? 'nieuw bericht' : 'nieuwe berichten'} om te lezen`, tekst: 'Facturen en tijden die via mail of WhatsApp binnenkwamen.', link: '#/inbox', knop: 'Naar inbox' });
  const slapers = (await cachedCustomers()).filter(c => c.segment === 'slapend' && c.actief).slice(0, 3);
  if (slapers.length) aandacht.push({ toon: 'info', soort: 'klanten', titel: `${slapers.length} ${slapers.length === 1 ? 'klant bestelt' : 'klanten bestellen'} later dan normaal`, tekst: slapers.map(c => `${c.naam} (${c.dagen_sinds} dagen, normaal ${c.ritme})`).join(', '), link: '#/klanten?segment=slapend', knop: 'Bekijken' });

  // offers: what Jan can order now, and who to call
  const cards = await offerCards();
  const offerItems = [];
  for (const c of cards.filter(c => c.stap === 'aanbod' || c.stap === 'bellen')) {
    const left = c.geldig_tot ? (new Date(c.geldig_tot) - now) / MIN : null;
    const soon = left != null && left > 0 && left <= 120;
    const titel = c.stap === 'aanbod' ? `Klaar om te bestellen: ${c.kweker}` : `${c.bellen ? `Nog ${c.bellen} ${c.bellen === 1 ? 'klant' : 'klanten'} bellen` : 'Bestelling plaatsen'}: ${c.kweker}`;
    const parts = [`${c.stuks.toLocaleString('nl-NL')} stuks, ${c.gekoppeld_pct}% heeft een klant`];
    if (c.akkoord) parts.push(`${c.akkoord} akkoord`);
    if (c.marge) parts.push(`marge € ${Math.round(c.marge).toLocaleString('nl-NL')}`);
    if (soon) parts.push(`aanbod verloopt ${hm(c.geldig_tot)}`);
    offerItems.push({ toon: soon || (c.risico && c.risico.niveau === 'hoog') ? 'wait' : 'info', soort: 'aanbod', titel, tekst: parts.join(' · ') + '.', link: `#/aanbod/${c.id}`, knop: c.stap === 'aanbod' ? 'Voorstel bekijken' : c.bellen ? 'Verder bellen' : 'Bestelling plaatsen', risico: c.risico ? c.risico.niveau : null });
  }
  const loods = await loodsNow();
  if (loods.kpi.te_lang) aandacht.push({ toon: 'wait', soort: 'loods', titel: `${loods.kpi.te_lang} ${loods.kpi.te_lang === 1 ? 'partij staat' : 'partijen staan'} te lang in de loods`, tekst: 'Vrije planten die al dagen staan. Bied ze aan of schrijf ze af.', link: '#/loods', knop: 'Naar de loods' });
  aandacht.unshift(...offerItems);
  const order = ['bad', 'wait', 'info'];
  aandacht.sort((a, b) => order.indexOf(a.toon) - order.indexOf(b.toon) || (b.soort === 'aanbod') - (a.soort === 'aanbod'));
  res.json({
    nu: now.toISOString(),
    kpi: {
      onderweg: zOut.filter(z => z.state === 'onderweg').length, binnen: zOut.filter(z => z.state === 'binnen' && new Date(z.gepland).toDateString() === now.toDateString()).length,
      vandaag: zOut.filter(z => new Date(z.gepland).toDateString() === now.toDateString()).length, achter: zOut.filter(z => z.state !== 'binnen' && (z.delay >= 15 || z.silentLate)).length,
      uit: lOut.filter(l => l.state === 'onderweg').length, afgeleverd: lOut.filter(l => l.state === 'afgeleverd').length, leveringen: lOut.length, krap: lOut.filter(l => l.krap).length,
      aanbod: cards.filter(c => c.stap === 'aanbod').length, bellen: cards.filter(c => c.stap === 'aanbod' || c.stap === 'bellen').reduce((s, c) => s + c.bellen, 0),
      bellen_aanbod: cards.filter(c => c.stap === 'bellen').length, besteld: cards.filter(c => c.stap === 'besteld').length,
      marge: Math.round(cards.filter(c => c.stap === 'aanbod' || c.stap === 'bellen').reduce((s, c) => s + c.marge, 0)),
      loods: loods.kpi.stuks, loods_vrij: loods.kpi.vrij, loods_klanten: loods.kpi.klanten, loods_te_lang: loods.kpi.te_lang,
    },
    stappen: Object.fromEntries(stappen.map(s => [s.stap, { n: Number(s.n), rest: Number(s.rest || 0) }])),
    inbox: { nieuw: Number(inbox.nieuw), fout: Number(inbox.fout) },
    zendingen: zOut, leveringen: lOut, aandacht,
  });
}));
const hm = d => new Date(d).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
const cachedCustomers = customerStats;

// ---------------------------------------------------------------- the flow: grower, loods, customers, on one page
api.get('/stroom', wrap(async (req, res) => res.json(await flowNow())));
api.get('/bestelling/:id', wrap(async (req, res) => {
  const id = int(req.params.id);
  const d = id ? await orderNow(id) : null;
  if (!d) return res.status(404).json({ fout: 'Deze bestelling bestaat niet (meer).' });
  res.json(d);
}));

// ---------------------------------------------------------------- the agenda, the trucks of a day, one customer's truck
const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T12:00:00`).getTime());
api.get('/agenda', wrap(async (req, res) => {
  const van = isDay(req.query.van) ? req.query.van : ymd(new Date());
  const tot = isDay(req.query.tot) ? req.query.tot : van;
  if (tot < van || (new Date(`${tot}T12:00:00`) - new Date(`${van}T12:00:00`)) / 864e5 > 45) throw new Invalid({ tot: 'Kies hoogstens zes weken.' });
  res.json(await agenda(van, tot));
}));
api.get('/wagens', wrap(async (req, res) => res.json(await trucksOn(isDay(req.query.dag) ? req.query.dag : ymd(new Date())))));
api.get('/wagen/:id', wrap(async (req, res) => {
  const id = int(req.params.id);
  const d = id ? await wagenNow(id) : null;
  if (!d) return res.status(404).json({ fout: 'Deze wagen bestaat niet (meer).' });
  res.json(d);
}));
// put something from the loods on a truck that leaves anyway
api.post('/wagen/:id/erbij', wrap(async (req, res) => {
  const id = int(req.params.id);
  const v = clean(req.body || {}, { regel_id: { type: 'int', required: true, min: 1 }, aantal: { type: 'int', required: true, min: 1, max: 999999 }, verkoopprijs: { type: 'num', min: 0 } });
  const r = await giveFromLoods(v.regel_id, { levering_id: id, aantal: v.aantal, verkoopprijs: v.verkoopprijs ?? null });
  await log(who(req), 'Uit de loods erbij op een wagen', 'factuur', r.partij.factuur_id, { levering_id: id, klant_id: r.klant_id, aantal: v.aantal, plant: r.partij.plant });
  res.json({ ok: true, levering_id: r.levering_id });
}));

// ---------------------------------------------------------------- the workflow: from a grower's offer to the loods
api.get('/workflow', wrap(async (req, res) => {
  const inbox = await rows(`
    SELECT b.id, b.kanaal, b.van, b.van_naam, b.onderwerp, left(b.tekst, 160) AS tekst, b.ontvangen, b.status, b.fout, b.soort, k.naam AS kweker,
           (SELECT json_agg(naam) FROM bestanden WHERE bericht_id = b.id) AS bestanden
      FROM berichten_in b LEFT JOIN kwekers k ON k.id = b.kweker_id
     WHERE b.status IN ('nieuw', 'bezig', 'fout') AND b.ontvangen <= now() AND b.ontvangen > now() - interval '21 days' ORDER BY b.ontvangen DESC`);
  const aanbod = await offerCards();
  // trucks on their way that did not come from an offer (ordered by phone, invoice already in)
  const komt = await rows(`
    SELECT z.id, z.factuur_id, f.nummer, g.id AS kweker_id, g.naam AS kweker, z.aankomst_gepland, z.aankomst_verwacht,
           CASE WHEN z.vertrek_werkelijk <= now() THEN z.vertrek_werkelijk END AS vertrokken,
           (SELECT sum(fr.aantal) FROM factuur_regels fr WHERE fr.factuur_id = z.factuur_id) AS stuks,
           (SELECT count(DISTINCT t.klant_id) FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id WHERE fr.factuur_id = z.factuur_id AND t.bestemming = 'klant' AND t.status <> 'afgewezen') AS klanten,
           s.stap
      FROM zendingen z JOIN kwekers g ON g.id = z.kweker_id LEFT JOIN facturen f ON f.id = z.factuur_id LEFT JOIN factuur_stap s ON s.factuur_id = z.factuur_id
     WHERE z.aanbod_id IS NULL AND (z.aankomst_werkelijk IS NULL OR z.aankomst_werkelijk > now()) AND z.aankomst_gepland BETWEEN now() - interval '6 hours' AND now() + interval '40 hours'
     ORDER BY z.aankomst_gepland`);
  const l = await loodsNow();
  const per = new Map();
  for (const p of l.partijen) {
    const x = per.get(p.factuur_id) || { factuur_id: p.factuur_id, nummer: p.nummer, kweker: p.kweker, binnen_om: p.binnen_om, hier: 0, gereserveerd: 0, vrij: 0, planten: new Set(), klanten: new Set(), leeftijd: 'ok', aanbod_id: null };
    x.hier += p.hier; x.gereserveerd += p.gereserveerd; x.vrij += p.vrij; x.planten.add(p.plant);
    for (const c of p.klanten) x.klanten.add(c.klant);
    if (p.leeftijd === 'bad' || (p.leeftijd === 'wait' && x.leeftijd === 'ok')) x.leeftijd = p.leeftijd;
    per.set(p.factuur_id, x);
  }
  const fromOffer = new Map((await rows('SELECT id, factuur_id FROM aanbiedingen WHERE factuur_id = ANY($1)', [[...per.keys()]])).map(a => [a.factuur_id, a.id]));
  const loods = [...per.values()].map(x => ({ ...x, planten: [...x.planten], klanten: [...x.klanten], aanbod_id: fromOffer.get(x.factuur_id) || null })).sort((a, b) => new Date(b.binnen_om) - new Date(a.binnen_om));
  const facturen = await rows(`SELECT f.id, f.nummer, k.naam AS kweker, s.twijfel, s.zonder_plant FROM facturen f JOIN kwekers k ON k.id = f.kweker_id JOIN factuur_stap s ON s.factuur_id = f.id
     WHERE NOT f.afgerond AND s.stap = 'nakijken' ORDER BY f.datum DESC LIMIT 10`);
  res.json({ inbox, aanbod, komt: komt.map(z => ({ ...z, stuks: Number(z.stuks || 0), klanten: Number(z.klanten || 0) })), loods, loods_kpi: l.kpi, facturen });
}));

// ---------------------------------------------------------------- one invoice: the dossier
async function dossier(id) {
  const now = new Date();
  const f = await one(`SELECT f.*, k.naam AS kweker, k.plaats AS kweker_plaats, k.land AS kweker_land, k.email AS kweker_email, k.whatsapp AS kweker_whatsapp, k.contact AS kweker_contact,
      b.kanaal, b.van, b.van_naam, b.onderwerp, b.tekst AS bericht_tekst, b.ontvangen, bs.naam AS bestand_naam, bs.mime AS bestand_mime
      FROM facturen f JOIN kwekers k ON k.id = f.kweker_id LEFT JOIN berichten_in b ON b.id = f.bericht_id LEFT JOIN bestanden bs ON bs.id = f.bestand_id WHERE f.id = $1`, [id]);
  if (!f) return null;
  const stap = await one('SELECT * FROM factuur_stap WHERE factuur_id = $1', [id]);
  const regels = await rows(`
    SELECT fr.*, p.naam AS plant, p.potmaat, p.hoogte, p.eenheid, p.per_laag, p.verkoopprijs AS lijstprijs,
      coalesce((SELECT json_agg(json_build_object('id', t.id, 'bestemming', t.bestemming, 'klant_id', t.klant_id, 'klant', k.naam, 'plaats', k.plaats, 'land', k.land,
          'aantal', t.aantal, 'verkoopprijs', t.verkoopprijs, 'soort', t.soort, 'status', t.status, 'reden', t.reden, 'score', t.score, 'door', t.door,
          'order', ko.nummer, 'levering_id', t.levering_id) ORDER BY t.id)
         FROM toewijzingen t LEFT JOIN klanten k ON k.id = t.klant_id LEFT JOIN klant_order_regels kor ON kor.id = t.order_regel_id LEFT JOIN klant_orders ko ON ko.id = kor.order_id
        WHERE t.regel_id = fr.id AND t.status <> 'afgewezen'), '[]') AS toewijzingen
      FROM factuur_regels fr LEFT JOIN planten p ON p.id = fr.plant_id WHERE fr.factuur_id = $1 ORDER BY fr.regelnr`, [id]);
  for (const r of regels) r.rest = r.aantal - r.toewijzingen.reduce((s, t) => s + t.aantal, 0);
  const z = await one('SELECT * FROM zendingen WHERE factuur_id = $1', [id]);
  let zending = null;
  if (z) {
    const ev = (await eventsFor('zending_id', [z.id], now))[z.id] || [];
    zending = { ...z, aankomst_werkelijk: z.aankomst_werkelijk && new Date(z.aankomst_werkelijk) <= now ? z.aankomst_werkelijk : null, vertrek_werkelijk: z.vertrek_werkelijk && new Date(z.vertrek_werkelijk) <= now ? z.vertrek_werkelijk : null, ...zendingState(z, ev, now), gebeurtenissen: ev };
  }
  const klantIds = [...new Set(regels.flatMap(r => r.toewijzingen.filter(t => t.klant_id).map(t => t.klant_id)))];
  const klanten = klantIds.length ? await rows(`SELECT k.id, k.naam, k.plaats, k.land, k.taal, k.kanaal, k.contact, k.whatsapp, k.email, k.levervenster,
      (SELECT json_build_object('id', l.id, 'vertrek', l.vertrek_gepland, 'aankomst', l.aankomst_gepland, 'vervoerder', l.vervoerder)
         FROM leveringen l WHERE l.klant_id = k.id AND l.vertrek_gepland BETWEEN $2::date - 1 AND $2::date + 5 ORDER BY l.vertrek_gepland LIMIT 1) AS levering
      FROM klanten k WHERE k.id = ANY($1) ORDER BY k.naam`, [klantIds, f.datum]) : [];
  const berichten = await rows(`SELECT * FROM berichten_uit WHERE factuur_id = $1 AND status <> 'geannuleerd' ORDER BY klant_id`, [id]);
  const afwijkingen = await rows('SELECT * FROM afwijkingen WHERE factuur_id = $1 ORDER BY gemeld_op', [id]);
  const logboek = await rows(`SELECT tijd, wie, actie, details FROM logboek WHERE object = 'factuur' AND object_id = $1 ORDER BY tijd DESC LIMIT 30`, [id]);
  const restLines = regels.filter(r => r.rest > 0 && r.plant_id);
  const rest = {};
  for (const r of restLines) rest[r.id] = await restSuggestions(r.id);
  return { factuur: f, stap, regels, zending, klanten, berichten, afwijkingen, logboek, rest };
}
api.get('/facturen/:id', wrap(async (req, res) => {
  const d = await dossier(int(req.params.id));
  if (!d) return res.status(404).json({ fout: 'Deze factuur bestaat niet (meer).' });
  res.json(d);
}));

// line checked by Jan: the plant he picked is learned for this grower
api.post('/facturen/:id/nagekeken', wrap(async (req, res) => {
  const id = int(req.params.id);
  const items = Array.isArray(req.body?.regels) ? req.body.regels : [];
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const f = (await c.query('SELECT * FROM facturen WHERE id = $1', [id])).rows[0];
    if (!f) { await c.query('ROLLBACK'); return res.status(404).json({ fout: 'Factuur niet gevonden.' }); }
    for (const it of items) {
      const rid = int(it.id), pid = int(it.plant_id);
      if (!rid || !pid) continue;
      const r = (await c.query('SELECT * FROM factuur_regels WHERE id = $1 AND factuur_id = $2', [rid, id])).rows[0];
      if (!r) continue;
      if (r.plant_id !== pid) await c.query('DELETE FROM toewijzingen WHERE regel_id = $1 AND status = \'voorstel\'', [rid]);
      await c.query('UPDATE factuur_regels SET plant_id = $2, match_zekerheid = 100 WHERE id = $1', [rid, pid]);
      await c.query(`INSERT INTO plant_namen (plant_id, kweker_id, tekst, door) VALUES ($1, $2, $3, 'jan') ON CONFLICT ((coalesce(kweker_id, 0)), (lower(tekst))) DO UPDATE SET plant_id = EXCLUDED.plant_id, geleerd = now(), door = 'jan'`, [pid, f.kweker_id, r.omschrijving]);
    }
    await c.query('UPDATE factuur_regels SET match_zekerheid = 100 WHERE factuur_id = $1 AND plant_id IS NOT NULL', [id]);
    await c.query('UPDATE facturen SET nagekeken = true, bijgewerkt = now() WHERE id = $1', [id]);
    const made = await proposeForInvoice(c, id);
    await c.query('COMMIT');
    await log(who(req), 'Factuur nagekeken', 'factuur', id, { regels: items.length, voorstellen: made });
    res.json(await dossier(id));
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}));

api.post('/facturen/:id/bevestig', wrap(async (req, res) => {
  const id = int(req.params.id);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(int).filter(Boolean) : null;
  const r = await q(`UPDATE toewijzingen t SET status = 'bevestigd'
      FROM factuur_regels fr WHERE fr.id = t.regel_id AND fr.factuur_id = $1 AND t.status = 'voorstel' ${ids ? 'AND t.id = ANY($2)' : ''} RETURNING t.id`, ids ? [id, ids] : [id]);
  await q(`UPDATE klant_orders ko SET status = 'toegewezen' WHERE ko.status = 'open' AND EXISTS (
      SELECT 1 FROM klant_order_regels kor JOIN toewijzingen t ON t.order_regel_id = kor.id JOIN factuur_regels fr ON fr.id = t.regel_id
       WHERE kor.order_id = ko.id AND fr.factuur_id = $1 AND t.status = 'bevestigd')`, [id]);
  await log(who(req), 'Koppeling bevestigd', 'factuur', id, { toewijzingen: r.rowCount });
  res.json(await dossier(id));
}));

const ALLOC = { regel_id: { type: 'int', required: true, min: 1 }, bestemming: { type: 'enum', values: ['klant', 'voorraad', 'retour'], required: true }, klant_id: { type: 'int', min: 1 },
  aantal: { type: 'int', required: true, min: 1, max: 999999 }, verkoopprijs: { type: 'num', min: 0 }, soort: { type: 'enum', values: ['order', 'aanbod', 'voorraad', 'retour'] }, reden: { type: 'text', max: 300 } };
api.post('/toewijzingen', wrap(async (req, res) => {
  const v = clean(req.body || {}, ALLOC);
  if (v.bestemming === 'klant' && !v.klant_id) throw new Invalid({ klant_id: 'Kies een klant.' });
  if (v.bestemming !== 'klant') v.klant_id = null;
  const line = await one('SELECT fr.*, f.datum FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id WHERE fr.id = $1', [v.regel_id]);
  if (!line) return res.status(404).json({ fout: 'Regel niet gevonden.' });
  let levering = null;
  if (v.klant_id) levering = await one(`SELECT id FROM leveringen WHERE klant_id = $1 AND vertrek_gepland BETWEEN now() - interval '2 hours' AND now() + interval '48 hours' AND (vertrek_werkelijk IS NULL OR vertrek_werkelijk > now()) ORDER BY vertrek_gepland LIMIT 1`, [v.klant_id]);
  const soort = v.soort || (v.bestemming === 'voorraad' ? 'voorraad' : v.bestemming === 'retour' ? 'retour' : 'aanbod');
  const reden = v.reden || (soort === 'aanbod' ? 'Rest aangeboden door Jan' : soort === 'voorraad' ? 'Op voorraad gezet' : soort === 'retour' ? 'Terug naar de kweker' : 'Toegewezen door Jan');
  const t = await one(`INSERT INTO toewijzingen (regel_id, bestemming, klant_id, levering_id, aantal, verkoopprijs, soort, status, reden, door) VALUES ($1, $2, $3, $4, $5, $6, $7, 'bevestigd', $8, 'jan') RETURNING *`,
    [v.regel_id, v.bestemming, v.klant_id, levering ? levering.id : null, v.aantal, v.verkoopprijs ?? null, soort, reden]);
  await log(who(req), soort === 'aanbod' ? 'Rest aangeboden' : soort === 'voorraad' ? 'Op voorraad gezet' : soort === 'retour' ? 'Retour gezet' : 'Toegewezen', 'factuur', line.factuur_id, { regel: line.regelnr, aantal: v.aantal, klant_id: v.klant_id });
  res.json(await dossier(line.factuur_id));
}));
api.patch('/toewijzingen/:id', wrap(async (req, res) => {
  const v = clean(req.body || {}, { aantal: { type: 'int', min: 1, max: 999999 }, status: { type: 'enum', values: ['voorstel', 'bevestigd', 'afgewezen'] }, verkoopprijs: { type: 'num', min: 0 } }, { partial: true });
  const t = await one(`SELECT t.*, fr.factuur_id FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id WHERE t.id = $1`, [int(req.params.id)]);
  if (!t) return res.status(404).json({ fout: 'Niet gevonden.' });
  const sets = [], vals = [t.id];
  for (const [k, val] of Object.entries(v)) { vals.push(val); sets.push(`${k} = $${vals.length}`); }
  if (sets.length) await q(`UPDATE toewijzingen SET ${sets.join(', ')}, door = 'jan' WHERE id = $1`, vals);
  await log(who(req), v.status === 'afgewezen' ? 'Toewijzing weggehaald' : 'Toewijzing aangepast', 'factuur', t.factuur_id, v);
  res.json(await dossier(t.factuur_id));
}));
api.delete('/toewijzingen/:id', wrap(async (req, res) => {
  const t = await one(`SELECT t.*, fr.factuur_id FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id WHERE t.id = $1`, [int(req.params.id)]);
  if (!t) return res.status(404).json({ fout: 'Niet gevonden.' });
  if (t.status === 'geleverd') return res.status(409).json({ fout: 'Dit is al geleverd en blijft staan.' });
  await q('DELETE FROM toewijzingen WHERE id = $1', [t.id]);
  await log(who(req), 'Toewijzing weggehaald', 'factuur', t.factuur_id, { aantal: t.aantal, klant_id: t.klant_id });
  res.json(await dossier(t.factuur_id));
}));

// customer messages for one invoice: drafted in the customer's language
api.post('/facturen/:id/berichten', wrap(async (req, res) => {
  const id = int(req.params.id);
  const d = await dossier(id);
  if (!d) return res.status(404).json({ fout: 'Factuur niet gevonden.' });
  const per = new Map();
  for (const r of d.regels) for (const t of r.toewijzingen) if (t.bestemming === 'klant' && t.status !== 'voorstel') {
    if (!per.has(t.klant_id)) per.set(t.klant_id, []);
    per.get(t.klant_id).push({ ...t, plant: { naam: r.plant, potmaat: r.potmaat, hoogte: r.hoogte, en: null }, lijstprijs: r.lijstprijs });
  }
  let made = 0;
  for (const [kid, ts] of per) {
    const k = d.klanten.find(x => x.id === kid);
    if (!k) continue;
    const exists = d.berichten.find(b => b.klant_id === kid);
    if (exists && exists.status === 'verstuurd') continue;
    const offer = ts.every(t => t.soort === 'aanbod');
    const eta = k.levering ? k.levering.aankomst : null;
    const m = offer
      ? offerMessage({ klant: k, lines: ts.map(t => ({ plant: t.plant, aantal: t.aantal, prijs: t.verkoopprijs, normaal: t.lijstprijs })) })
      : deliveryMessage({ klant: k, lines: ts.map(t => ({ plant: t.plant, aantal: t.aantal })), eta, order: ts.find(t => t.order)?.order || null });
    if (exists) await q('UPDATE berichten_uit SET tekst = $2, onderwerp = $3, soort = $4, aangemaakt = now() WHERE id = $1', [exists.id, m.tekst, m.onderwerp, offer ? 'aanbod' : 'levering']);
    else await q(`INSERT INTO berichten_uit (klant_id, factuur_id, soort, kanaal, taal, onderwerp, tekst) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [kid, id, offer ? 'aanbod' : 'levering', k.kanaal, k.taal, m.onderwerp, m.tekst]);
    made++;
  }
  await log(who(req), 'Berichten klaargezet', 'factuur', id, { berichten: made });
  res.json(await dossier(id));
}));
api.patch('/berichten/:id', wrap(async (req, res) => {
  const v = clean(req.body || {}, { tekst: { type: 'text', max: 4000 }, status: { type: 'enum', values: ['concept', 'verstuurd', 'geannuleerd'] } }, { partial: true });
  const b = await one('SELECT * FROM berichten_uit WHERE id = $1', [int(req.params.id)]);
  if (!b) return res.status(404).json({ fout: 'Bericht niet gevonden.' });
  await q(`UPDATE berichten_uit SET tekst = coalesce($2, tekst), status = coalesce($3, status), verstuurd_op = CASE WHEN $3 = 'verstuurd' THEN now() ELSE verstuurd_op END WHERE id = $1`, [b.id, v.tekst ?? null, v.status ?? null]);
  if (v.status === 'verstuurd') await log(who(req), 'Bericht verstuurd', 'factuur', b.factuur_id, { klant_id: b.klant_id, kanaal: b.kanaal });
  res.json(b.factuur_id ? await dossier(b.factuur_id) : { ok: true });
}));
api.post('/facturen/:id/afronden', wrap(async (req, res) => {
  const id = int(req.params.id), open = req.body?.open === true;
  await q('UPDATE facturen SET afgerond = $2, bijgewerkt = now() WHERE id = $1', [id, !open]);
  await log(who(req), open ? 'Factuur heropend' : 'Factuur afgerond', 'factuur', id);
  res.json(await dossier(id));
}));
api.post('/facturen/:id/afwijking', wrap(async (req, res) => {
  const id = int(req.params.id);
  const v = clean(req.body || {}, { regel_id: { type: 'int', min: 1 }, soort: { type: 'enum', required: true, values: ['minder', 'meer', 'maat', 'kwaliteit', 'schade', 'te_laat', 'prijs', 'dubbel'] }, aantal: { type: 'int', min: 1 }, bedrag: { type: 'num' }, tekst: { type: 'text', required: true, max: 400 } });
  await q('INSERT INTO afwijkingen (factuur_id, regel_id, soort, aantal, bedrag, tekst) VALUES ($1, $2, $3, $4, $5, $6)', [id, v.regel_id ?? null, v.soort, v.aantal ?? null, v.bedrag ?? null, v.tekst]);
  await log(who(req), 'Afwijking gemeld', 'factuur', id, v);
  res.json(await dossier(id));
}));
api.patch('/afwijkingen/:id', wrap(async (req, res) => {
  const v = clean(req.body || {}, { opgelost: { type: 'bool' }, oplossing: { type: 'enum', values: ['credit', 'nalevering', 'geaccepteerd', 'retour'] } }, { partial: true });
  const a = await one('UPDATE afwijkingen SET opgelost = coalesce($2, opgelost), oplossing = coalesce($3, oplossing) WHERE id = $1 RETURNING factuur_id', [int(req.params.id), v.opgelost ?? null, v.oplossing ?? null]);
  if (!a) return res.status(404).json({ fout: 'Niet gevonden.' });
  res.json(await dossier(a.factuur_id));
}));

// ---------------------------------------------------------------- trucks and deliveries: Jan sets what happened
const EV = { soort: { type: 'enum', required: true, values: ['geladen', 'vertrokken', 'eta', 'aangekomen', 'vertraging', 'uitgeleverd', 'afgeleverd', 'opmerking'] }, tijd: { type: 'text', max: 40 }, eta: { type: 'text', max: 40 }, tekst: { type: 'text', max: 400 } };
const atTime = (s, base = new Date()) => { if (!s) return null; const m = String(s).match(/^(\d{1,2}):(\d{2})$/); if (m) { const d = new Date(base); d.setHours(+m[1], +m[2], 0, 0); return d; } const d = new Date(s); return Number.isNaN(+d) ? null : d; };
api.post('/zendingen/:id/gebeurtenis', wrap(async (req, res) => {
  const v = clean(req.body || {}, EV);
  const z = await one('SELECT * FROM zendingen WHERE id = $1', [int(req.params.id)]);
  if (!z) return res.status(404).json({ fout: 'Zending niet gevonden.' });
  const tijd = atTime(v.tijd, new Date(z.aankomst_gepland)) || new Date();
  const eta = atTime(v.eta, new Date(z.aankomst_gepland));
  await q(`INSERT INTO gebeurtenissen (zending_id, tijd, soort, plaats, eta, tekst, bron) VALUES ($1, $2, $3, $4, $5, $6, 'jan')`, [z.id, tijd, v.soort, v.soort === 'aangekomen' ? 'Campo, Nootdorp' : null, eta, v.tekst || null]);
  if (v.soort === 'aangekomen') {
    await q('UPDATE zendingen SET aankomst_werkelijk = $2, aankomst_verwacht = $2 WHERE id = $1', [z.id, tijd]);
    if (z.aanbod_id && !z.factuur_id) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await receiveOrder(c, z.id);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    }
  }
  if (v.soort === 'vertrokken') await q('UPDATE zendingen SET vertrek_werkelijk = $2 WHERE id = $1', [z.id, tijd]);
  if (eta) await q('UPDATE zendingen SET aankomst_verwacht = $2 WHERE id = $1', [z.id, eta]);
  await log(who(req), `Zending: ${v.soort}`, 'factuur', z.factuur_id, { tijd, eta });
  res.json({ ok: true });
}));
api.post('/leveringen/:id/gebeurtenis', wrap(async (req, res) => {
  const v = clean(req.body || {}, EV);
  const l = await one('SELECT * FROM leveringen WHERE id = $1', [int(req.params.id)]);
  if (!l) return res.status(404).json({ fout: 'Levering niet gevonden.' });
  const tijd = atTime(v.tijd, new Date(l.vertrek_gepland)) || new Date();
  const eta = atTime(v.eta, new Date(l.aankomst_gepland));
  await q(`INSERT INTO gebeurtenissen (levering_id, tijd, soort, plaats, eta, tekst, bron) VALUES ($1, $2, $3, $4, $5, $6, 'jan')`, [l.id, tijd, v.soort, v.soort === 'vertrokken' ? 'Campo, Nootdorp' : null, eta, v.tekst || null]);
  if (v.soort === 'vertrokken') await q('UPDATE leveringen SET vertrek_werkelijk = $2 WHERE id = $1', [l.id, tijd]);
  if (v.soort === 'afgeleverd') { await q('UPDATE leveringen SET aankomst_werkelijk = $2 WHERE id = $1', [l.id, tijd]); if (l.order_id) await q(`UPDATE klant_orders SET status = 'geleverd' WHERE id = $1`, [l.order_id]); }
  if (eta) await q('UPDATE leveringen SET aankomst_verwacht = $2 WHERE id = $1', [l.id, eta]);
  await log(who(req), `Levering: ${v.soort}`, 'levering', l.id, { tijd, eta });
  res.json({ ok: true });
}));
api.post('/leveringen/:id/vertraging-bericht', wrap(async (req, res) => {
  const l = await one(`SELECT l.*, k.naam, k.contact, k.taal, k.kanaal, k.whatsapp, k.email FROM leveringen l JOIN klanten k ON k.id = l.klant_id WHERE l.id = $1`, [int(req.params.id)]);
  if (!l) return res.status(404).json({ fout: 'Levering niet gevonden.' });
  const eta = req.body?.eta ? new Date(req.body.eta) : new Date(l.aankomst_gepland);
  const min = Math.max(5, Math.round((eta - new Date(l.aankomst_gepland)) / MIN));
  const m = delayMessage({ klant: l, minutes: min, eta });
  res.json({ klant: l.naam, kanaal: l.kanaal, whatsapp: l.whatsapp, email: l.email, ...m });
}));

// ---------------------------------------------------------------- inbox
api.get('/inbox', wrap(async (req, res) => {
  const r = await rows(`
    SELECT b.id, b.kanaal, b.van, b.van_naam, b.onderwerp, b.tekst, b.ontvangen, b.status, b.soort, b.fout, k.naam AS kweker, k.id AS kweker_id,
           (SELECT json_agg(json_build_object('id', bs.id, 'naam', bs.naam, 'mime', bs.mime, 'grootte', bs.grootte)) FROM bestanden bs WHERE bs.bericht_id = b.id) AS bestanden,
           (SELECT json_build_object('id', f.id, 'nummer', f.nummer) FROM facturen f WHERE f.bericht_id = b.id LIMIT 1) AS factuur,
           (SELECT a.id FROM aanbiedingen a WHERE a.bericht_id = b.id LIMIT 1) AS aanbod_id
      FROM berichten_in b LEFT JOIN kwekers k ON k.id = b.kweker_id
     WHERE b.ontvangen <= now() ORDER BY b.ontvangen DESC LIMIT 150`);
  res.json(r);
}));
api.post('/inbox/:id/lees', wrap(async (req, res) => {
  const out = await processMessage(int(req.params.id), { wie: who(req) });
  res.status(out.ok ? 200 : 422).json(out);
}));
api.post('/inbox/:id/negeer', wrap(async (req, res) => {
  await q(`UPDATE berichten_in SET status = 'genegeerd' WHERE id = $1`, [int(req.params.id)]);
  await log(who(req), 'Bericht genegeerd', 'bericht', int(req.params.id));
  res.json({ ok: true });
}));
api.post('/inbox/upload', wrap(async (req, res) => {
  const v = clean(req.body || {}, { naam: { type: 'text', required: true, max: 200 }, mime: { type: 'text', required: true, max: 100 }, data: { type: 'text', required: true, max: 36000000 }, tekst: { type: 'text', max: 20000 } });
  if (!/pdf|^image\/(png|jpe?g|webp)/i.test(v.mime)) throw new Invalid({ mime: 'Alleen pdf of een foto (jpg, png, webp).' });
  const data = Buffer.from(v.data, 'base64');
  if (!data.length || data.length > 25 * 1024 * 1024) throw new Invalid({ data: 'Het bestand is leeg of groter dan 25 MB.' });
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  const dup = await one('SELECT b.id, f.id AS factuur_id FROM bestanden bs JOIN berichten_in b ON b.id = bs.bericht_id LEFT JOIN facturen f ON f.bericht_id = b.id WHERE bs.sha256 = $1 LIMIT 1', [sha]);
  if (dup) return res.json({ ok: true, soort: 'dubbel', factuur_id: dup.factuur_id, bericht_id: dup.id, reden: 'Dit bestand is al eerder ingelezen.' });
  const b = await one(`INSERT INTO berichten_in (kanaal, extern_id, van, van_naam, onderwerp, tekst) VALUES ('upload', $1, NULL, $2, $3, $4) RETURNING id`, [`upload-${sha.slice(0, 24)}`, who(req), v.naam, v.tekst || null]);
  await q('INSERT INTO bestanden (bericht_id, naam, mime, grootte, sha256, data) VALUES ($1, $2, $3, $4, $5, $6)', [b.id, v.naam, v.mime, data.length, sha, data]);
  const out = await processMessage(b.id, { wie: who(req) });
  res.status(out.ok ? 200 : 422).json({ ...out, bericht_id: b.id });
}));
api.post('/inbox/plakken', wrap(async (req, res) => {
  const v = clean(req.body || {}, { tekst: { type: 'text', required: true, max: 20000 }, van: { type: 'text', max: 200 }, kanaal: { type: 'enum', values: ['whatsapp', 'mail', 'plakken'] }, kweker_id: { type: 'int', min: 1 } });
  const van = v.van ? (phone(v.van) || v.van) : null;
  const g = v.kweker_id ? await one('SELECT id, naam FROM kwekers WHERE id = $1', [v.kweker_id]) : null;
  const b = await one(`INSERT INTO berichten_in (kanaal, extern_id, van, van_naam, tekst, kweker_id) VALUES ('plakken', $1, $2, $3, $4, $5) RETURNING id`, [`plak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, van, g ? g.naam : null, v.tekst, g ? g.id : null]);
  const out = await processMessage(b.id, { wie: who(req) });
  res.status(out.ok ? 200 : 422).json({ ...out, bericht_id: b.id });
}));
api.get('/bestanden/:id', wrap(async (req, res) => {
  const f = await one('SELECT naam, mime, data FROM bestanden WHERE id = $1', [int(req.params.id)]);
  if (!f) return res.status(404).send('Niet gevonden');
  res.removeHeader('Content-Security-Policy'); // let the browser's own pdf viewer run inside the frame
  res.set('Content-Type', f.mime);
  res.set('Content-Disposition', `inline; filename="${String(f.naam).replace(/[^\w.\- ]/g, '_')}"`);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(f.data);
}));

// ---------------------------------------------------------------- the databases
const KWEKER = { naam: { type: 'text', required: true, max: 120 }, plaats: { type: 'text', max: 80 }, land: { type: 'cc' }, contact: { type: 'text', max: 80 }, email: { type: 'email' }, telefoon: { type: 'text', max: 40 },
  whatsapp: { type: 'phone' }, vervoer: { type: 'text', max: 80 }, laadtijd: { type: 'time' }, reistijd_min: { type: 'int', min: 0, max: 4320 }, levert_op: { type: 'days' }, specialiteit: { type: 'text', max: 200 }, notities: { type: 'text', max: 4000 }, actief: { type: 'bool' } };
const KLANT = { naam: { type: 'text', required: true, max: 120 }, soort: { type: 'enum', values: ['bloemist', 'tuincentrum', 'groothandel', 'interieur', 'supermarkt', 'evenementen', 'overig'] }, contact: { type: 'text', max: 80 }, email: { type: 'email' },
  telefoon: { type: 'text', max: 40 }, whatsapp: { type: 'phone' }, adres: { type: 'text', max: 160 }, postcode: { type: 'text', max: 20 }, plaats: { type: 'text', required: true, max: 80 }, land: { type: 'cc', required: true },
  taal: { type: 'enum', values: ['nl', 'en', 'de', 'fr', 'it', 'pl', 'sv', 'da', 'es', 'no'] }, kanaal: { type: 'enum', values: ['whatsapp', 'mail', 'telefoon'] }, levervenster: { type: 'text', max: 80 }, leverdagen: { type: 'days' },
  reistijd_min: { type: 'int', min: 0, max: 4320 }, betaaltermijn: { type: 'int', min: 0, max: 120 }, kredietlimiet: { type: 'num', min: 0 }, wensen: { type: 'text', max: 2000 }, klant_sinds: { type: 'int', min: 1950, max: 2100 }, actief: { type: 'bool' } };
const PLANT = { naam: { type: 'text', required: true, max: 120 }, latijn: { type: 'text', max: 120 }, groep: { type: 'enum', required: true, values: ['orchidee', 'bloeiend', 'groen', 'snijbloem', 'buiten', 'seizoen'] }, potmaat: { type: 'text', max: 20 }, hoogte: { type: 'text', max: 20 },
  eenheid: { type: 'enum', values: ['stuks', 'stelen'] }, per_laag: { type: 'int', min: 1 }, per_kar: { type: 'int', min: 1 }, verkoopprijs: { type: 'num', min: 0 }, actief: { type: 'bool' } };
const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'x';
async function upsert(table, spec, req, res, extra = {}) {
  const id = req.params.id ? int(req.params.id) : null;
  const v = clean(req.body || {}, spec, { partial: !!id });
  if (id) {
    const keys = Object.keys(v);
    if (!keys.length) return res.json({ ok: true });
    await q(`UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...keys.map(k => v[k])]);
    await log(who(req), `${table === 'kwekers' ? 'Kweker' : table === 'klanten' ? 'Klant' : 'Plant'} aangepast`, table, id, v);
    return res.json({ ok: true, id });
  }
  let code = slug(v.naam + (extra.suffix ? '-' + extra.suffix(v) : '')), n = 1;
  while (await one(`SELECT 1 FROM ${table} WHERE code = $1`, [code])) code = `${slug(v.naam).slice(0, 30)}-${++n}`;
  const keys = Object.keys(v);
  const r = await one(`INSERT INTO ${table} (code, bron, ${keys.join(', ')}) VALUES ($1, 'handmatig', ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`, [code, ...keys.map(k => v[k])]);
  await log(who(req), `${table === 'kwekers' ? 'Kweker' : table === 'klanten' ? 'Klant' : 'Plant'} toegevoegd`, table, r.id, { naam: v.naam });
  res.json({ ok: true, id: r.id });
}
api.get('/kwekers', wrap(async (req, res) => res.json(await growerList())));
api.get('/kwekers/namen', wrap(async (req, res) => res.json(await rows('SELECT id, naam, plaats FROM kwekers WHERE actief ORDER BY naam'))));
api.get('/klanten/namen', wrap(async (req, res) => res.json(await rows('SELECT id, naam, plaats, land FROM klanten WHERE actief ORDER BY naam'))));
api.get('/planten/namen', wrap(async (req, res) => res.json(await rows(`SELECT id, concat_ws(' ', naam, potmaat, hoogte) AS naam, verkoopprijs FROM planten WHERE actief ORDER BY naam, potmaat`))));
api.get('/kwekers/:id', wrap(async (req, res) => { const d = await growerDetail(int(req.params.id)); if (!d) return res.status(404).json({ fout: 'Kweker niet gevonden.' }); res.json(d); }));
api.post('/kwekers', wrap((req, res) => upsert('kwekers', KWEKER, req, res)));
api.patch('/kwekers/:id', wrap((req, res) => upsert('kwekers', KWEKER, req, res)));
api.get('/klanten', wrap(async (req, res) => res.json(await customerList())));
api.get('/klanten/:id', wrap(async (req, res) => { const d = await customerDetail(int(req.params.id)); if (!d) return res.status(404).json({ fout: 'Klant niet gevonden.' }); res.json(d); }));
api.post('/klanten', wrap((req, res) => upsert('klanten', KLANT, req, res)));
api.patch('/klanten/:id', wrap((req, res) => upsert('klanten', KLANT, req, res)));
api.get('/planten', wrap(async (req, res) => res.json(await plantList())));
api.get('/planten/:id', wrap(async (req, res) => { const d = await plantDetail(int(req.params.id)); if (!d) return res.status(404).json({ fout: 'Plant niet gevonden.' }); res.json(d); }));
api.post('/planten', wrap((req, res) => upsert('planten', PLANT, req, res, { suffix: v => [v.potmaat, v.hoogte].filter(Boolean).join('-') })));
api.patch('/planten/:id', wrap((req, res) => upsert('planten', PLANT, req, res)));

api.get('/zoek', wrap(async (req, res) => {
  const t = String(req.query.q || '').trim();
  if (t.length < 2) return res.json([]);
  const like = `%${t.replace(/[%_]/g, '')}%`;
  const out = await rows(`
    (SELECT 'kweker' AS soort, id, naam AS titel, concat_ws(', ', plaats, land) AS sub FROM kwekers WHERE naam ILIKE $1 OR plaats ILIKE $1 LIMIT 6)
    UNION ALL (SELECT 'klant', id, naam, concat_ws(', ', plaats, land) FROM klanten WHERE naam ILIKE $1 OR plaats ILIKE $1 OR contact ILIKE $1 LIMIT 6)
    UNION ALL (SELECT 'plant', id, concat_ws(' ', naam, potmaat, hoogte), groep FROM planten WHERE naam ILIKE $1 OR latijn ILIKE $1 LIMIT 6)
    UNION ALL (SELECT 'factuur', f.id, concat(k.naam, ' ', f.nummer), to_char(f.datum, 'DD-MM-YYYY') FROM facturen f JOIN kwekers k ON k.id = f.kweker_id WHERE f.nummer ILIKE $1 LIMIT 6)
    UNION ALL (SELECT 'order', ko.klant_id, concat(ko.nummer, ' · ', k.naam), to_char(ko.besteld_op, 'DD-MM-YYYY') FROM klant_orders ko JOIN klanten k ON k.id = ko.klant_id WHERE ko.nummer ILIKE $1 LIMIT 6)
    UNION ALL (SELECT 'aanbod', a.id, concat(k.naam, ' · ', coalesce(a.bestelnummer, a.nummer, 'aanbod')), to_char(a.ontvangen, 'DD-MM-YYYY') FROM aanbiedingen a JOIN kwekers k ON k.id = a.kweker_id
                WHERE a.bestelnummer ILIKE $1 OR a.nummer ILIKE $1 OR (k.naam ILIKE $1 AND a.ontvangen > now() - interval '7 days') ORDER BY a.ontvangen DESC LIMIT 6)`, [like]);
  res.json(out);
}));

// ---------------------------------------------------------------- connections and the demo
api.get('/koppelingen', wrap(async (req, res) => {
  const demo = await setting('demo', null);
  const counts = await one(`SELECT (SELECT count(*) FROM kwekers) AS kwekers, (SELECT count(*) FROM klanten) AS klanten, (SELECT count(*) FROM planten) AS planten,
     (SELECT count(*) FROM facturen) AS facturen, (SELECT count(*) FROM factuur_regels) AS regels, (SELECT count(*) FROM toewijzingen) AS toewijzingen,
     (SELECT count(*) FROM zendingen) AS zendingen, (SELECT count(*) FROM gebeurtenissen) AS gebeurtenissen, (SELECT count(*) FROM berichten_in) AS berichten_in,
     (SELECT count(*) FROM klant_orders) AS orders, (SELECT count(*) FROM plant_namen) AS plantnamen,
     (SELECT pg_size_pretty(sum(pg_total_relation_size(c.oid))) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'campo' AND c.relkind = 'r') AS grootte`);
  const host = `${req.protocol}://${req.get('host')}`;
  const extra = await one(`SELECT (SELECT count(*) FROM concepten) AS concepten, (SELECT count(*) FROM partijen) AS partijen, (SELECT count(*) FROM partij_regels) AS partijregels,
     (SELECT count(*) FROM pakbonnen WHERE status = 'akkoord') AS pakbonnen, (SELECT count(*) FROM pakbon_regels) AS pakbonregels, (SELECT count(*) FROM weekorders) AS weekorders,
     (SELECT count(*) FROM leveranciers) AS leveranciers, (SELECT count(*) FROM producten) AS producten, (SELECT count(*) FROM weken WHERE koers IS NOT NULL) AS koersen`);
  res.json({ ai: aiStatus(), mail: mailStatus(), whatsapp: { ...whatsappStatus(), webhook: `${host}/api/whatsapp/webhook` }, outlook: { ...(await outlookStatus()), terug: `${host}/api/outlook/terug` }, demo, database: { ...counts, ...extra }, talen: LANG_NAME });
}));
api.post('/koppelingen/ai-test', wrap(async (req, res) => res.json(await aiCheck())));
api.post('/koppelingen/mail-nu', wrap(async (req, res) => res.json(await pollMail())));
api.post('/demo/verwijderen', wrap(async (req, res) => {
  if (req.body?.bevestig !== 'VERWIJDER') return res.status(400).json({ fout: 'Typ VERWIJDER om te bevestigen.' });
  await removeWeekDemo();
  await log(who(req), 'Demo-data verwijderd');
  res.json({ ok: true });
}));
api.get('/logboek', wrap(async (req, res) => res.json(await rows('SELECT * FROM logboek ORDER BY tijd DESC LIMIT 250'))));
api.get('/me', (req, res) => res.json({ naam: req.user.naam }));

// ---------------------------------------------------------------- offers from growers: the proposal, the calls, the order
api.get('/aanbod', wrap(async (req, res) => res.json(await offerCards())));
api.get('/aanbod/:id', wrap(async (req, res) => {
  const id = int(req.params.id);
  const d = await offerDetail(id);
  if (!d) return res.status(404).json({ fout: 'Dit aanbod bestaat niet (meer).' });
  d.logboek = await rows(`SELECT tijd, wie, actie, details FROM logboek WHERE object = 'aanbod' AND object_id = $1 ORDER BY tijd DESC LIMIT 40`, [id]);
  d.outlook = await target();
  res.json(d);
}));
async function fresh(res, id, extra = {}) {
  const d = await offerDetail(id);
  d.logboek = await rows(`SELECT tijd, wie, actie, details FROM logboek WHERE object = 'aanbod' AND object_id = $1 ORDER BY tijd DESC LIMIT 40`, [id]);
  d.outlook = await target();
  res.json({ ...d, ...extra });
}
const editable = async id => {
  const a = await one('SELECT status FROM aanbiedingen WHERE id = $1', [id]);
  if (!a) throw Object.assign(new Error('Dit aanbod bestaat niet (meer).'), { status: 404 });
  if (a.status === 'besteld') throw Object.assign(new Error('Deze bestelling is al geplaatst; aanpassen gaat nu bij de kweker en de klant zelf.'), { status: 409 });
  if (a.status === 'afgewezen') throw Object.assign(new Error('Dit aanbod is afgewezen.'), { status: 409 });
};

api.post('/aanbod/:id/gesprek', wrap(async (req, res) => {
  const id = int(req.params.id);
  const v = clean(req.body || {}, { klant_id: { type: 'int', required: true, min: 1 }, uitkomst: { type: 'enum', required: true, values: ['akkoord', 'nee', 'terugbellen', 'open'] }, notitie: { type: 'text', max: 500 } });
  await callOutcome(id, v.klant_id, v.uitkomst, v.notitie, who(req));
  const after = await afterChange(id);
  await fresh(res, id, { outlook_gezet: after.outlook });
}));
api.patch('/aanbod/:id', wrap(async (req, res) => {
  const id = int(req.params.id);
  await editable(id);
  const v = clean(req.body || {}, { levering: { type: 'text', max: 10 }, geldig_tot: { type: 'text', max: 40 }, hele_partij: { type: 'bool' }, notitie: { type: 'text', max: 2000 } }, { partial: true });
  if (v.levering && !/^\d{4}-\d{2}-\d{2}$/.test(v.levering)) throw new Invalid({ levering: 'Kies een datum.' });
  if (v.geldig_tot && Number.isNaN(+new Date(v.geldig_tot))) throw new Invalid({ geldig_tot: 'Kies een tijd.' });
  const keys = Object.keys(v);
  if (keys.length) await q(`UPDATE aanbiedingen SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, bijgewerkt = now() WHERE id = $1`, [id, ...keys.map(k => (k === 'geldig_tot' && v[k] ? new Date(v[k]) : v[k]))]);
  await log(who(req), 'Aanbod aangepast', 'aanbod', id, v);
  await afterChange(id);
  await fresh(res, id);
}));
api.patch('/aanbod-regels/:id', wrap(async (req, res) => {
  const r = await one('SELECT * FROM aanbod_regels WHERE id = $1', [int(req.params.id)]);
  if (!r) return res.status(404).json({ fout: 'Regel niet gevonden.' });
  await editable(r.aanbod_id);
  const v = clean(req.body || {}, { extra: { type: 'int', min: 0, max: 999999 }, plant_id: { type: 'int', min: 1 }, prijs: { type: 'num', min: 0 } }, { partial: true });
  if (v.extra != null && v.extra > r.aantal) throw new Invalid({ extra: `Maximaal ${r.aantal}.` });
  if (v.plant_id) {
    const a = await one('SELECT kweker_id FROM aanbiedingen WHERE id = $1', [r.aanbod_id]);
    await q(`DELETE FROM aanbod_klanten WHERE regel_id = $1 AND status = 'voorstel'`, [r.id]);
    await q(`INSERT INTO plant_namen (plant_id, kweker_id, tekst, door) VALUES ($1, $2, $3, 'jan') ON CONFLICT ((coalesce(kweker_id, 0)), (lower(tekst))) DO UPDATE SET plant_id = EXCLUDED.plant_id, geleerd = now(), door = 'jan'`, [v.plant_id, a.kweker_id, r.omschrijving]);
  }
  await q(`UPDATE aanbod_regels SET extra = coalesce($2, extra), plant_id = coalesce($3, plant_id), match_zekerheid = CASE WHEN $3 IS NULL THEN match_zekerheid ELSE 100 END, prijs = coalesce($4, prijs) WHERE id = $1`,
    [r.id, v.extra ?? null, v.plant_id ?? null, v.prijs ?? null]);
  if (v.plant_id) { const c = await pool.connect(); try { await c.query('BEGIN'); await proposeOffer(c, r.aanbod_id); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } }
  await log(who(req), v.plant_id ? 'Plant gekozen voor aanbodregel' : 'Aanbodregel aangepast', 'aanbod', r.aanbod_id, { regel: r.regelnr, ...v });
  await afterChange(r.aanbod_id);
  await fresh(res, r.aanbod_id);
}));
api.post('/aanbod/:id/klanten', wrap(async (req, res) => {
  const id = int(req.params.id);
  await editable(id);
  const v = clean(req.body || {}, { regel_id: { type: 'int', required: true, min: 1 }, klant_id: { type: 'int', required: true, min: 1 }, aantal: { type: 'int', required: true, min: 1, max: 999999 }, verkoopprijs: { type: 'num', required: true, min: 0 } });
  const r = await one('SELECT * FROM aanbod_regels WHERE id = $1 AND aanbod_id = $2', [v.regel_id, id]);
  if (!r) return res.status(404).json({ fout: 'Regel niet gevonden.' });
  await q(`INSERT INTO aanbod_klanten (regel_id, klant_id, bron, aantal, verkoopprijs, score, reden, status, door) VALUES ($1, $2, 'aanbod', $3, $4, NULL, 'Door Jan toegevoegd', 'voorstel', 'jan')
    ON CONFLICT (regel_id, klant_id) DO UPDATE SET aantal = EXCLUDED.aantal, verkoopprijs = EXCLUDED.verkoopprijs, status = 'voorstel', door = 'jan'`, [r.id, v.klant_id, v.aantal, v.verkoopprijs]);
  await q(`UPDATE aanbiedingen SET status = CASE WHEN status = 'nieuw' THEN 'bellen' ELSE status END WHERE id = $1`, [id]);
  await log(who(req), 'Klant toegevoegd aan aanbod', 'aanbod', id, v);
  await afterChange(id);
  await fresh(res, id);
}));
api.patch('/aanbod-klanten/:id', wrap(async (req, res) => {
  const k = await one('SELECT ak.*, ar.aanbod_id FROM aanbod_klanten ak JOIN aanbod_regels ar ON ar.id = ak.regel_id WHERE ak.id = $1', [int(req.params.id)]);
  if (!k) return res.status(404).json({ fout: 'Niet gevonden.' });
  await editable(k.aanbod_id);
  const v = clean(req.body || {}, { aantal: { type: 'int', min: 1, max: 999999 }, verkoopprijs: { type: 'num', min: 0 }, status: { type: 'enum', values: ['voorstel', 'akkoord', 'nee'] } }, { partial: true });
  await q(`UPDATE aanbod_klanten SET aantal = coalesce($2, aantal), verkoopprijs = coalesce($3, verkoopprijs), status = coalesce($4, status), door = 'jan' WHERE id = $1`, [k.id, v.aantal ?? null, v.verkoopprijs ?? null, v.status ?? null]);
  await log(who(req), 'Voorstel aangepast', 'aanbod', k.aanbod_id, { klant_id: k.klant_id, ...v });
  await afterChange(k.aanbod_id);
  await fresh(res, k.aanbod_id);
}));
api.delete('/aanbod-klanten/:id', wrap(async (req, res) => {
  const k = await one('SELECT ak.*, ar.aanbod_id FROM aanbod_klanten ak JOIN aanbod_regels ar ON ar.id = ak.regel_id WHERE ak.id = $1', [int(req.params.id)]);
  if (!k) return res.status(404).json({ fout: 'Niet gevonden.' });
  await editable(k.aanbod_id);
  if (k.bron === 'order') return res.status(409).json({ fout: 'Deze klant heeft het al besteld; haal het weg bij de klantorder.' });
  await q('DELETE FROM aanbod_klanten WHERE id = $1', [k.id]);
  await log(who(req), 'Klant uit aanbod gehaald', 'aanbod', k.aanbod_id, { klant_id: k.klant_id });
  await afterChange(k.aanbod_id);
  await fresh(res, k.aanbod_id);
}));
api.post('/aanbod/:id/opnieuw', wrap(async (req, res) => {
  const id = int(req.params.id);
  await editable(id);
  dropCaches();
  const c = await pool.connect();
  let made = 0;
  try { await c.query('BEGIN'); made = await proposeOffer(c, id); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await log(who(req), 'Voorstel opnieuw gemaakt', 'aanbod', id, { voorstellen: made });
  await afterChange(id);
  await fresh(res, id);
}));
api.post('/aanbod/:id/concepten', wrap(async (req, res) => {
  const id = int(req.params.id);
  const after = await afterChange(id);
  await log(who(req), after.outlook && after.outlook.gezet ? 'Concepten in Outlook gezet' : 'Concepten bijgewerkt', 'aanbod', id, after.outlook ? { gezet: after.outlook.gezet, waar: after.outlook.waar } : null);
  await fresh(res, id, { outlook_gezet: after.outlook });
}));
api.post('/aanbod/:id/bestellen', wrap(async (req, res) => {
  const id = int(req.params.id);
  const regels = Array.isArray(req.body?.regels) ? req.body.regels.map(r => ({ id: int(r.id), bestellen: int(r.bestellen) })).filter(r => r.id && r.bestellen != null && r.bestellen >= 0) : [];
  const out = await placeOrder(id, { regels }, who(req));
  const after = await afterChange(id);
  await fresh(res, id, { geplaatst: out, outlook_gezet: after.outlook });
}));
api.post('/aanbod/:id/afwijzen', wrap(async (req, res) => {
  const id = int(req.params.id);
  const v = clean(req.body || {}, { reden: { type: 'text', max: 300 } });
  await declineOffer(id, v.reden, who(req));
  for (const c of await rows(`SELECT * FROM concepten WHERE aanbod_id = $1 AND status = 'vervallen' AND extern_id IS NOT NULL`, [id])) { await removeFromOutlook(c); await q('UPDATE concepten SET extern_id = NULL WHERE id = $1', [c.id]); }
  await fresh(res, id);
}));

// ---------------------------------------------------------------- draft mails
api.get('/concepten/:id', wrap(async (req, res) => {
  const c = await one('SELECT * FROM concepten WHERE id = $1', [int(req.params.id)]);
  if (!c) return res.status(404).json({ fout: 'Concept niet gevonden.' });
  res.json(c);
}));
api.get('/concepten/:id/pdf', wrap(async (req, res) => {
  const c = await one('SELECT * FROM concepten WHERE id = $1', [int(req.params.id)]);
  if (!c) return res.status(404).send('Niet gevonden');
  const pdf = await conceptPdf(c);
  res.removeHeader('Content-Security-Policy');
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="${String(c.bijlage_naam || c.nummer + '.pdf').replace(/[^\w.\- ]/g, '_')}"`);
  res.send(pdf);
}));
api.get('/concepten/:id/eml', wrap(async (req, res) => {
  const c = await one('SELECT * FROM concepten WHERE id = $1', [int(req.params.id)]);
  if (!c) return res.status(404).send('Niet gevonden');
  const raw = await conceptEml(c);
  res.set('Content-Type', 'message/rfc822');
  res.set('Content-Disposition', `attachment; filename="${String(c.nummer || 'concept').replace(/[^\w.\- ]/g, '_')}.eml"`);
  res.send(raw);
}));
api.post('/concepten/:id/outlook', wrap(async (req, res) => {
  const id = int(req.params.id);
  const r = await pushConcept(id);
  if (!r.ok) return res.status(502).json({ fout: r.reden });
  const c = await one('SELECT aanbod_id FROM concepten WHERE id = $1', [id]);
  await log(who(req), 'Concept in Outlook gezet', 'aanbod', c.aanbod_id, { concept: id });
  await fresh(res, c.aanbod_id);
}));
api.post('/concepten/:id/verstuur', wrap(async (req, res) => {
  const c = await sendConcept(int(req.params.id), who(req));
  await fresh(res, c.aanbod_id);
}));
api.patch('/concepten/:id', wrap(async (req, res) => {
  const v = clean(req.body || {}, { status: { type: 'enum', values: ['verstuurd', 'concept'] }, aan: { type: 'email' } }, { partial: true });
  const c = await one('SELECT * FROM concepten WHERE id = $1', [int(req.params.id)]);
  if (!c) return res.status(404).json({ fout: 'Concept niet gevonden.' });
  await q(`UPDATE concepten SET status = coalesce($2, status), aan = coalesce($3, aan), verstuurd_op = CASE WHEN $2 = 'verstuurd' THEN now() ELSE verstuurd_op END, bijgewerkt = now() WHERE id = $1`, [c.id, v.status ?? null, v.aan ?? null]);
  if (v.aan && c.status === 'in_outlook') await q(`UPDATE concepten SET status = 'concept' WHERE id = $1`, [c.id]);
  if (v.status === 'verstuurd') await log(who(req), c.soort === 'bestelling' ? 'Bestelling verstuurd' : 'Offerte verstuurd', 'aanbod', c.aanbod_id, { aan: c.aan, nummer: c.nummer, door: 'Jan (zelf gemeld)' });
  await fresh(res, c.aanbod_id);
}));

// ---------------------------------------------------------------- Outlook
api.get('/outlook/start', wrap(authStart));
api.get('/outlook/terug', wrap(authBack));
api.post('/outlook/los', wrap(async (req, res) => { await disconnect(who(req)); res.json(await outlookStatus()); }));
api.post('/outlook/sync', wrap(async (req, res) => res.json({ verstuurd: await syncSent() })));
api.patch('/instellingen/meldingen', wrap(async (req, res) => {
  const v = clean(req.body || {}, { mail: { type: 'bool', required: true } });
  await q(`INSERT INTO instellingen (sleutel, waarde) VALUES ('meldingen', $1) ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, bijgewerkt = now()`, [JSON.stringify(v)]);
  res.json(await outlookStatus());
}));

// ---------------------------------------------------------------- the loods
api.get('/loods', wrap(async (req, res) => res.json(await loodsNow())));
api.get('/loods/regel/:id/kandidaten', wrap(async (req, res) => {
  const id = int(req.params.id);
  const l = (await loodsNow()).partijen.find(p => p.regel_id === id);
  if (!l) return res.status(404).json({ fout: 'Deze partij staat niet (meer) in de loods.' });
  res.json({ partij: l, ...(await restSuggestions(id, { vrij: l.vrij })) });
}));
api.post('/loods/regel/:id/klant', wrap(async (req, res) => {
  const id = int(req.params.id);
  const v = clean(req.body || {}, { klant_id: { type: 'int', required: true, min: 1 }, aantal: { type: 'int', required: true, min: 1, max: 999999 }, verkoopprijs: { type: 'num', min: 0 }, levering_id: { type: 'int', min: 1 } });
  const r = await giveFromLoods(id, { klant_id: v.klant_id, aantal: v.aantal, verkoopprijs: v.verkoopprijs ?? null, levering_id: v.levering_id || null });
  await log(who(req), 'Uit de loods aan klant', 'factuur', r.partij.factuur_id, { klant_id: r.klant_id, levering_id: r.levering_id, aantal: v.aantal, plant: r.partij.plant });
  res.json(await loodsNow());
}));

// errors in Dutch, without stack traces
api.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof Invalid) return res.status(400).json({ fout: err.message, velden: err.fields });
  if (err && err.status && err.status < 500) return res.status(err.status).json({ fout: err.message });
  if (err && err.code === '23505') return res.status(409).json({ fout: 'Dit bestaat al (zelfde naam of nummer).' });
  if (err && err.code === '23514') return res.status(400).json({ fout: /^(Er staan|De kweker biedt)/.test(err.message) ? err.message : 'Deze waarde past niet (controle in de database).' });
  if (err && err.code === '23503') return res.status(400).json({ fout: 'Dit verwijst naar iets dat niet (meer) bestaat.' });
  console.error('[api]', req.method, req.path, err);
  res.status(500).json({ fout: 'Er ging iets mis aan de kant van de server.' });
});
