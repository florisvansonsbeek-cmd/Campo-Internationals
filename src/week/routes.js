// The API of the weekly rhythm, under /api/week. Everything here needs a signed-in session (see server.js).
import express from 'express';
import crypto from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { pool, rows, one, q, log, setting, setSetting } from '../db.js';
import { addDays, focusMonday, isMonday, isoWeek, mondayOf, today, passed, r2, sum, isDay, groupBy } from './util.js';
import {
  weekData, syncProposal, setAllocation, resetAllocation, setRate, countBoxes, uncount, approveSlips, reopenSlip, markSlipsExact, markPartijExact,
  orderBook, addOrder, copyPrevious, placeOrders, updateLine, setStage, updatePartij, overview, badges, company, DEFAULT_COMPANY, weekTasks, deviations, proposeBatchNumber, markArrived, excludeCustomer, markChecked } from './model.js';
import { slipDoc, slipPdfById, slipConcept } from './mail.js';
import { customerList, customerDetail, yearData } from './stats.js';
import { yearWorkbook, sheetRows } from './excel.js';
import { readShipping, matchProduct } from './read.js';
import { assess, lateHistory, riskJson, routeOf, parseRoute, PLEKKEN } from './risk.js';
import { streams, customerStreams } from './flow.js';
import { relations, customerAnalysis, supplierStat, supplierHistory, deals, onTheWay, leads, forget, plantStats } from './partners.js';

export const week = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const who = req => (req.user && req.user.naam) || 'Jan';
const int = v => { const n = Number(v); return Number.isInteger(n) ? n : null; };
const bad = (res, msg) => res.status(400).json({ fout: msg });

// which Monday a page opens on when none is asked for
async function workMonday() {
  const t = today(), m0 = mondayOf(t), focus = focusMonday(t);
  if (m0 === focus) return focus;
  const o = await one(`SELECT (SELECT count(*) FROM partijen WHERE maandag = $1) AS partijen, w.koers, w.geteld_op,
      (SELECT count(*) FROM pakbonnen WHERE maandag = $1 AND status = 'akkoord') AS akkoord,
      (SELECT count(DISTINCT v.klant_id) FROM verdeling v JOIN partij_regels r ON r.id = v.regel_id JOIN partijen p ON p.id = r.partij_id WHERE p.maandag = $1 AND v.dozen > 0) AS klanten
    FROM (SELECT $1::date AS m) x LEFT JOIN weken w ON w.maandag = x.m`, [m0]);
  return o.partijen && (!o.koers || !o.geteld_op || o.akkoord < o.klanten) ? m0 : focus;
}
async function orderMonday() {
  const f = focusMonday();
  const p = await one(`SELECT count(*) AS n FROM partijen WHERE maandag = $1 AND besteld_op <= now()`, [f]);
  return p.n ? addDays(f, 7) : f;
}
async function buyMonday() {
  const f = focusMonday();
  const p = await one('SELECT count(*) AS n FROM partijen WHERE maandag = $1 AND besteld_op <= now()', [f]);
  if (p.n) return f;
  const prev = await one(`SELECT count(*) AS n FROM partijen WHERE maandag = $1 AND exact = 'open'`, [addDays(f, -7)]);
  return prev.n ? addDays(f, -7) : f;
}
const pickMonday = async (req, fallback) => (isMonday(req.query.maandag) ? req.query.maandag : fallback());

// ---------------------------------------------------------------- Deze week
week.get('/overzicht', wrap(async (req, res) => {
  const m = await pickMonday(req, async () => focusMonday());
  const o = await overview(m);
  const risk = await risksOf(await weekData(m)).catch(() => null);
  if (risk) for (const p of o.partijen) { const v = riskJson(risk.per.get(p.id)); p.risico = v ? { licht: v.licht, kop: v.kop, aankomst: v.aankomst, route: v.route } : null; }
  res.json(o);
}));
week.get('/badges', wrap(async (req, res) => res.json(await badges())));

// ---------------------------------------------------------------- Bestellen (Tuesday)
week.get('/bestellen', wrap(async (req, res) => {
  const m = await pickMonday(req, orderMonday);
  const d = await orderBook(m);
  const byKlant = new Map();
  for (const o of d.orders) {
    if (!byKlant.has(o.klant_id)) byKlant.set(o.klant_id, { klant_id: o.klant_id, klant: o.klant, land: o.land, regels: [] });
    byKlant.get(o.klant_id).regels.push({ id: o.id, product_id: o.product_id, product: o.product?.naam, maat: o.product?.maat, dozen: o.dozen, notitie: o.notitie, via: o.via, aangemaakt: o.aangemaakt });
  }
  const levOf = id => d.leveranciers.find(l => l.id === id);
  const regionOf = id => levOf(id)?.regio;
  const nextNr = {};
  for (const g of [...new Set(d.leveranciers.map(l => l.regio))]) nextNr[g] = await proposeBatchNumber(g, m);
  res.json({
    maandag: m, week: d.week, jaar: d.jaar, bestellen: addDays(m, -6), vandaag: today(), besteld: d.besteld,
    klanten: [...byKlant.values()].sort((a, b) => a.klant.localeCompare(b.klant, 'nl')),
    totaal: { klanten: byKlant.size, dozen: sum(d.orders, o => o.dozen), regels: d.orders.length },
    producten: d.totals.map(p => ({ id: p.id, code: p.code, naam: p.naam, maat: p.maat, soort: p.soort, per_doos: p.per_doos, gevraagd: p.gevraagd, klanten: p.klanten, besteld: p.besteld, leverancier_id: p.leverancier_id, leveranciers: p.leveranciers })),
    leveranciers: d.leveranciers, volgendNummer: nextNr,
    partijen: d.partijen.map(p => ({ id: p.id, nummer: p.nummer, leverancier: p.leverancier, leverancier_id: p.leverancier_id, regio: p.regio, besteld_op: p.besteld_op, stage: p.stage, regels: p.regels.map(r => ({ product_id: r.product_id, product: r.product, maat: r.maat, besteld: r.besteld })) })),
    nogNiet: d.regular, alleKlanten: d.klanten, regioVan: Object.fromEntries(d.leveranciers.map(l => [l.id, regionOf(l.id)])),
  });
}));
week.post('/bestellen/regel', wrap(async (req, res) => {
  const b = req.body || {};
  const m = b.maandag, k = int(b.klant_id), p = int(b.product_id), dz = int(b.dozen);
  if (!isMonday(m) || !k || !p || dz == null || dz < 0 || dz > 9999) return bad(res, 'Kies een klant, een product en een aantal dozen.');
  const placed = await one(`SELECT count(*) AS n FROM pakbonnen WHERE maandag = $1 AND klant_id = $2 AND status = 'akkoord'`, [m, k]);
  if (placed.n) return bad(res, 'De pakbon van deze klant voor die week is al akkoord.');
  await addOrder({ maandag: m, klant_id: k, product_id: p, dozen: dz, notitie: b.notitie ? String(b.notitie).slice(0, 300) : null }, who(req));
  res.json({ ok: true });
}));
week.post('/bestellen/vorige', wrap(async (req, res) => {
  const m = req.body?.maandag, k = int(req.body?.klant_id);
  if (!isMonday(m) || !k) return bad(res, 'Kies een klant.');
  res.json({ ok: true, regels: await copyPrevious(m, k, who(req)) });
}));
week.post('/bestellen/plaatsen', wrap(async (req, res) => {
  const m = req.body?.maandag;
  if (!isMonday(m)) return bad(res, 'Kies de week.');
  res.json({ ok: true, partijen: await placeOrders(m, req.body.regels, who(req)) });
}));

// ---------------------------------------------------------------- Inkoop (Thursday and Friday)
function exactLines(p) {
  return p.regels.map(r => {
    const stuks = (r.verzonden ?? r.bevestigd ?? r.besteld ?? 0) * r.per_doos;
    return { artikel: r.product_exact || r.product_code, omschrijving: `${r.product} ${r.maat} (${r.soort})`, dozen: r.verzonden ?? r.bevestigd ?? r.besteld, stuks, prijs_usd: Number(r.prijs_usd), bedrag_usd: r2(stuks * Number(r.prijs_usd)), kostendrager: p.nummer };
  });
}
// a shipment as the pages show it: the papers only once they came in
function partijJson(p, m) {
  return {
    id: p.id, nummer: p.nummer, maandag: m, regio: p.regio, regio_naam: p.regio_naam, herkomst: p.herkomst, leverancier: p.leverancier, leverancier_id: p.leverancier_id, lev_email: p.lev_email, lev_contact: p.lev_contact,
    lev_plaats: p.lev_plaats, lev_whatsapp: p.lev_whatsapp, lev_telefoon: p.lev_telefoon, route: routeOf(p), verwacht_op: p.verwacht_op,
    stage: p.stage, besteld_op: p.besteld_op, bevestigd_op: passed(p.bevestigd_op) ? p.bevestigd_op : null, verzonden_op: passed(p.verzonden_op) ? p.verzonden_op : null, binnen_op: passed(p.binnen_op) ? p.binnen_op : null,
    verwacht: { bevestiging: !passed(p.bevestigd_op) ? (p.bevestigd_op || addDays(m, -4)) : null, verzonden: !passed(p.verzonden_op) ? (p.verzonden_op || addDays(m, -3)) : null },
    awb: passed(p.verzonden_op) ? p.awb : null, vlucht: passed(p.verzonden_op) ? p.vlucht : null, fyto: passed(p.verzonden_op) ? p.fyto : null,
    exact: p.exact, exact_op: p.exact_op, exact_nummer: p.exact_nummer, exact_door: p.exact_door, twijfels: p.twijfels, dozen: p.dozen,
    docs: p.docs.map(x => ({ id: x.id, soort: x.soort, titel: x.titel, bestand_id: x.bestand_id, mime: x.mime || null, tekst: x.tekst, ontvangen: x.ontvangen, gelezen_door: x.gelezen_door })),
    regels: p.regels.map(r => ({ id: r.id, product_id: r.product_id, product: r.product, maat: r.maat, soort: r.soort, product_code: r.product_code, per_doos: r.per_doos, besteld: r.besteld, bevestigd: r.bevestigd, verzonden: r.verzonden, geteld: r.geteld, uitval: r.uitval, prijs_usd: Number(r.prijs_usd), zekerheid: r.zekerheid, twijfel: r.twijfel, gelezen: r.gelezen, dozen: r.dozen, rest: r.rest })),
    exactRegels: exactLines(p), totaal_usd: r2(sum(exactLines(p), l => l.bedrag_usd)),
  };
}
const forRisk = p => { const t = p.regels.find(r => r.twijfel); return { ...p, twijfel: t ? t.twijfel : null, twijfelProduct: t ? `${t.product} ${t.maat}` : null }; };
async function risksOf(d) {
  const hist = await lateHistory(d.maandag);
  return assess(d.partijen.map(forRisk), { hist });
}
week.get('/inkoop', wrap(async (req, res) => {
  const m = await pickMonday(req, buyMonday);
  await syncProposal(m).catch(() => 0);
  const d = await weekData(m);
  const dev = deviations(d);
  const [prev, risk] = await Promise.all([weekData(addDays(m, -7)), risksOf(d)]);
  const flow = streams(d);
  res.json({
    maandag: m, week: d.week, jaar: d.jaar, vandaag: today(), dagen: { bevestiging: addDays(m, -4), verzonden: addDays(m, -3) }, geteld: d.counted,
    partijen: d.partijen.map(p => ({ ...partijJson(p, m), risico: riskJson(risk.per.get(p.id)), stroom: flow.partijen.find(x => x.partij_id === p.id) || null })),
    stroom: flow.week, klanten: customerStreams(d), regios: await rows('SELECT code, naam, land, nummer FROM regios ORDER BY nummer NULLS LAST, code'),
    koers: d.koers, bronnen: risk.bronnen, plekken: PLEKKEN,
    afwijkingen: dev,
    vorige: prev.partijen.filter(p => p.exact === 'open' && p.stage !== 'gepland').map(p => ({ id: p.id, nummer: p.nummer, leverancier: p.leverancier, maandag: prev.maandag, week: prev.week })),
  });
}));
week.patch('/partijen/:id', wrap(async (req, res) => {
  const id = int(req.params.id), b = { ...(req.body || {}) };
  if ('route' in b) {
    const r = b.route ? parseRoute(Array.isArray(b.route) ? b.route.join(' ') : b.route) : null;
    if (b.route && !r) return bad(res, 'Een route is een rij luchthavencodes, bijvoorbeeld SJO AMS of GUA MIA AMS.');
    await q('UPDATE partijen SET route = $2 WHERE id = $1', [id, r]);
    await log(who(req), 'Route aangepast', 'partij', id, { route: r });
    delete b.route;
  }
  if ('verwacht_op' in b) {
    const t = b.verwacht_op ? new Date(b.verwacht_op) : null;
    if (b.verwacht_op && Number.isNaN(t.getTime())) return bad(res, 'Kies een dag en een tijd.');
    await q('UPDATE partijen SET verwacht_op = $2 WHERE id = $1', [id, t]);
    await log(who(req), t ? 'Verwachte aankomst aangepast' : 'Verwachte aankomst terug naar maandagochtend', 'partij', id, { verwacht_op: t });
    delete b.verwacht_op;
  }
  res.json({ ok: true, partij: Object.keys(b).length ? await updatePartij(id, b, who(req)) : await one('SELECT * FROM partijen WHERE id = $1', [id]) });
}));
week.patch('/regels/:id', wrap(async (req, res) => { await updateLine(int(req.params.id), req.body || {}, who(req)); res.json({ ok: true }); }));
week.post('/partijen/:id/stap', wrap(async (req, res) => { await setStage(int(req.params.id), req.body?.stap, who(req)); res.json({ ok: true }); }));
week.post('/partijen/:id/exact', wrap(async (req, res) => {
  await markPartijExact(int(req.params.id), who(req), { nummer: req.body?.nummer ? String(req.body.nummer).slice(0, 40) : null, terug: !!req.body?.terug });
  res.json({ ok: true });
}));

// a confirmation or shipping papers that Jan forwards, uploads or pastes: stored, read, and put on the lines (Jan checks)
week.post('/partijen/:id/document', wrap(async (req, res) => {
  const id = int(req.params.id);
  const p = await one('SELECT * FROM partijen WHERE id = $1', [id]);
  if (!p) return res.status(404).json({ fout: 'Deze zending bestaat niet.' });
  const b = req.body || {};
  const soort = ['bevestiging', 'verzendbewijs', 'awb', 'fyto', 'overig'].includes(b.soort) ? b.soort : 'verzendbewijs';
  let bestandId = null, pdf = null, image = null;
  if (b.data) {
    if (!/pdf|^image\/(png|jpe?g|webp)/i.test(b.mime || '')) return bad(res, 'Alleen pdf of een foto (jpg, png, webp).');
    const data = Buffer.from(String(b.data), 'base64');
    if (!data.length || data.length > 25 * 1024 * 1024) return bad(res, 'Het bestand is leeg of groter dan 25 MB.');
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    bestandId = (await one(`INSERT INTO bestanden (naam, mime, grootte, sha256, data) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [String(b.naam || 'document').slice(0, 200), b.mime, data.length, sha, data])).id;
    if (/pdf/i.test(b.mime)) pdf = data; else image = data;
  }
  const tekst = b.tekst ? String(b.tekst).slice(0, 20000) : '';
  if (!bestandId && !tekst) return bad(res, 'Voeg een bestand toe of plak de tekst.');
  const producten = await rows('SELECT id, code, naam, soort, maat, per_doos FROM producten WHERE actief');
  const read = soort === 'bevestiging' || soort === 'verzendbewijs' ? await readShipping({ tekst, pdf, image, mime: b.mime }, producten) : null;
  await q(`INSERT INTO partij_documenten (partij_id, soort, titel, bestand_id, tekst, gelezen_door) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, soort, b.naam || (soort === 'bevestiging' ? 'Bevestiging' : 'Verzendpapieren'), bestandId, tekst || null, read ? read.door : 'jan']);
  const out = { gelezen: 0, twijfel: 0, onbekend: [] };
  if (read) {
    const lines = await rows('SELECT r.*, d.naam, d.maat FROM partij_regels r JOIN producten d ON d.id = r.product_id WHERE r.partij_id = $1', [id]);
    const field = soort === 'bevestiging' ? 'bevestigd' : 'verzonden';
    for (const x of read.regels) {
      const m = x.match;
      if (!m || x.dozen == null) { out.onbekend.push(x.omschrijving); continue; }
      let line = lines.find(l => l.product_id === m.product.id);
      if (!line) {
        line = (await one(`INSERT INTO partij_regels (partij_id, product_id, besteld, per_doos, prijs_usd) VALUES ($1, $2, NULL, $3, $4) RETURNING *`, [id, m.product.id, m.product.per_doos, x.prijs_usd || 0]));
        lines.push(line);
      }
      const zeker = Math.min(m.zekerheid, read.door === 'ai' ? 99 : 85);
      const twijfel = zeker < 75 ? `De desk weet niet zeker of "${x.omschrijving}" ${m.product.naam} ${m.product.maat} is.` : x.opmerking ? `Opmerking op het papier: ${x.opmerking}` : null;
      await q(`UPDATE partij_regels SET ${field} = $2, prijs_usd = coalesce($3, prijs_usd), zekerheid = $4, twijfel = $5, gelezen = $6 WHERE id = $1`,
        [line.id, Math.round(x.dozen), x.prijs_usd || null, zeker, twijfel, JSON.stringify({ bron: b.naam || soort, door: read.door, omschrijving: x.omschrijving, zekerheid: zeker })]);
      out.gelezen++; if (twijfel) out.twijfel++;
    }
    if (read.waarschuwingen?.length) out.waarschuwingen = read.waarschuwingen;
    if (soort === 'verzendbewijs') await q(`UPDATE partijen SET awb = coalesce($2, awb), vlucht = coalesce($3, vlucht), fyto = coalesce($4, fyto), verzonden_op = coalesce(verzonden_op, now()), bevestigd_op = coalesce(bevestigd_op, now()) WHERE id = $1`, [id, read.awb, read.vlucht, read.fyto]);
    else await q(`UPDATE partijen SET bevestigd_op = coalesce(bevestigd_op, now()) WHERE id = $1`, [id]);
    out.door = read.door;
  }
  await log(who(req), soort === 'bevestiging' ? `Bevestiging ${p.nummer} gelezen` : `Verzendpapieren ${p.nummer} gelezen`, 'partij', id, out);
  await syncProposal(p.maandag);
  res.json({ ok: true, ...out });
}));

// ---------------------------------------------------------------- Maandag: rate, count, hand out
week.get('/maandag', wrap(async (req, res) => {
  const m = await pickMonday(req, workMonday);
  await syncProposal(m);
  const d = await weekData(m);
  const lastRates = await rows(`SELECT maandag, koers FROM weken WHERE koers IS NOT NULL AND maandag < $1 ORDER BY maandag DESC LIMIT 8`, [m]);
  // per product: what was asked and what each customer got
  const asked = new Map();
  for (const o of d.orders) asked.set(`${o.klant_id}:${o.product_id}`, o.dozen);
  const got = new Map();
  for (const r of d.regels) for (const v of r.verdeling) got.set(`${v.klant_id}:${r.product_id}`, (got.get(`${v.klant_id}:${r.product_id}`) || 0) + v.dozen);
  const productsIn = new Set(d.regels.map(r => r.product_id));
  const tekort = d.orders.filter(o => productsIn.has(o.product_id) && (got.get(`${o.klant_id}:${o.product_id}`) || 0) < o.dozen)
    .map(o => ({ klant_id: o.klant_id, klant: o.klant, product: `${o.product?.naam} ${o.product?.maat}`, gevraagd: o.dozen, krijgt: got.get(`${o.klant_id}:${o.product_id}`) || 0 }));
  const nietIn = d.orders.filter(o => !productsIn.has(o.product_id)).map(o => ({ klant: o.klant, product: `${o.product?.naam} ${o.product?.maat}`, dozen: o.dozen }));
  // who could take what is left: who asked for it this week first, then who buys it most
  const fans = d.regels.some(r => r.rest > 0) ? await rows(`SELECT r.product_id, p.klant_id, k.naam, sum(r.dozen) AS dozen FROM pakbon_regels r JOIN pakbonnen p ON p.id = r.pakbon_id JOIN klanten k ON k.id = p.klant_id
      WHERE p.maandag >= $1::date - 70 AND p.maandag < $1 AND r.product_id = ANY($2) GROUP BY r.product_id, p.klant_id, k.naam ORDER BY sum(r.dozen) DESC`, [m, [...productsIn]]) : [];
  const over = d.regels.filter(r => r.rest > 0).map(r => {
    const here = d.orders.filter(o => o.product_id === r.product_id).sort((a, b) => b.dozen - a.dozen).slice(0, 3).map(o => ({ klant_id: o.klant_id, klant: o.klant, reden: `vroeg ${o.dozen}` }));
    const more = fans.filter(f => f.product_id === r.product_id && !here.some(h => h.klant_id === f.klant_id)).slice(0, 3).map(f => ({ klant_id: f.klant_id, klant: f.naam, reden: `${f.dozen} dozen in 10 weken` }));
    return { regel_id: r.id, nummer: r.nummer, product: `${r.product} ${r.maat}`, rest: r.rest, suggesties: [...here, ...more].slice(0, 4) };
  });
  const perKlant = new Map();
  for (const r of d.regels) for (const v of r.verdeling) {
    if (v.dozen <= 0) continue;
    if (!perKlant.has(v.klant_id)) { const k = d.K.get(v.klant_id); perKlant.set(v.klant_id, { klant_id: v.klant_id, klant: v.klant, plaats: k?.plaats, land: k?.land, dozen: 0, regels: [] }); }
    const x = perKlant.get(v.klant_id); x.dozen += v.dozen; x.regels.push({ product: `${r.product} ${r.maat}`, partij: r.nummer, dozen: v.dozen });
  }
  const slipsDone = d.slips.filter(s => s.pakbon && s.pakbon.status === 'akkoord').map(s => s.klant_id);
  res.json({
    maandag: m, week: d.week, jaar: d.jaar, vandaag: today(), koers: d.koers, koers_op: d.wk.koers_op, koers_door: d.wk.koers_door, koersen: lastRates.reverse(),
    geteld: d.counted, geteld_op: d.wk.geteld_op, geteld_door: d.wk.geteld_door, nagekeken: !!d.wk.nagekeken_op, nagekeken_op: d.wk.nagekeken_op, akkoord: slipsDone,
    regios: await rows('SELECT code, naam, land, nummer FROM regios ORDER BY nummer NULLS LAST, code'),
    gevraagd: Object.fromEntries([...groupBy(d.orders, o => o.klant_id)].map(([k, os]) => [k, sum(os, o => o.dozen)])),
    eruit: [...groupBy(d.orders, o => o.klant_id)].filter(([k]) => {
      const vs = d.regels.flatMap(r => r.verdeling.filter(v => v.klant_id === k));
      return vs.length && vs.every(v => v.door === 'jan' && v.dozen === 0);
    }).map(([k, os]) => ({ klant_id: k, klant: d.K.get(k)?.naam || '?', plaats: d.K.get(k)?.plaats || '', gevraagd: sum(os, o => o.dozen) })),
    partijen: d.partijen.map(p => ({ id: p.id, nummer: p.nummer, regio: p.regio, leverancier: p.leverancier, plaats: p.lev_plaats, binnen_op: p.binnen_op, stage: p.stage, docsIn: passed(p.verzonden_op),
      regels: p.regels.map(r => ({ id: r.id, product_id: r.product_id, product: r.product, maat: r.maat, soort: r.soort, per_doos: r.per_doos, besteld: r.besteld, bevestigd: r.bevestigd, verzonden: r.verzonden, geteld: r.geteld, uitval: r.uitval,
        dozen: r.dozen, basis: r.basis, avail: r.avail, gegeven: r.gegeven, rest: r.rest, verdeling: r.verdeling.filter(v => v.dozen > 0 || v.door !== 'desk') })) })),
    tekort, nietIn, over, klanten: [...perKlant.values()].sort((a, b) => a.klant.localeCompare(b.klant, 'nl')),
    taken: weekTasks(d).filter(t => t.stap === 'maandag'),
  });
}));
week.post('/weken/:maandag/koers', wrap(async (req, res) => {
  if (!isMonday(req.params.maandag)) return bad(res, 'Geen maandag.');
  res.json({ ok: true, koers: await setRate(req.params.maandag, req.body?.koers, who(req)) });
}));
week.post('/weken/:maandag/tellen', wrap(async (req, res) => {
  if (!isMonday(req.params.maandag)) return bad(res, 'Geen maandag.');
  await countBoxes(req.params.maandag, Array.isArray(req.body?.regels) ? req.body.regels : [], who(req));
  res.json({ ok: true });
}));
week.post('/weken/:maandag/telling-terug', wrap(async (req, res) => { await uncount(req.params.maandag, who(req)); res.json({ ok: true }); }));
week.post('/partijen/:id/binnen', wrap(async (req, res) => {
  await markArrived(int(req.params.id), { binnen: req.body?.binnen !== false, regels: Array.isArray(req.body?.regels) ? req.body.regels : [] }, who(req));
  res.json({ ok: true });
}));
week.post('/weken/:maandag/nagekeken', wrap(async (req, res) => {
  if (!isMonday(req.params.maandag)) return bad(res, 'Geen maandag.');
  await markChecked(req.params.maandag, !!req.body?.terug, who(req));
  res.json({ ok: true });
}));
week.post('/weken/:maandag/klant-eruit', wrap(async (req, res) => {
  if (!isMonday(req.params.maandag)) return bad(res, 'Geen maandag.');
  const k = int(req.body?.klant_id);
  if (!k) return bad(res, 'Welke klant?');
  await excludeCustomer(req.params.maandag, k, who(req));
  res.json({ ok: true });
}));
// the Excel for Exact: per sales line the plant, the size, how many, the price per piece, the plant passport number,
// the customer and the plant passport number again (as cost unit)
week.get('/weken/:maandag/exact.xlsx', wrap(async (req, res) => {
  if (!isMonday(req.params.maandag)) return bad(res, 'Geen maandag.');
  const { exactWorkbook } = await import('./excel.js');
  const { wb, naam } = await exactWorkbook(req.params.maandag);
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${naam}"`);
  await wb.xlsx.write(res);
  res.end();
}));
week.put('/verdeling', wrap(async (req, res) => {
  const r = int(req.body?.regel_id), k = int(req.body?.klant_id), dz = int(req.body?.dozen);
  if (!r || !k || dz == null || dz < 0 || dz > 9999) return bad(res, 'Een heel aantal dozen.');
  await setAllocation({ regel_id: r, klant_id: k, dozen: dz }, who(req));
  res.json({ ok: true });
}));
week.post('/weken/:maandag/voorstel', wrap(async (req, res) => {
  if (!isMonday(req.params.maandag)) return bad(res, 'Geen maandag.');
  await resetAllocation(req.params.maandag, { klant_id: int(req.body?.klant_id), product_id: int(req.body?.product_id) }, who(req));
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- Pakbonnen: one per customer, also the invoice
async function outlookState() {
  const { outlookStatus } = await import('../outlook.js');
  const o = await outlookStatus();
  return { doel: o.doel, account: o.account };
}
week.get('/pakbonnen', wrap(async (req, res) => {
  const m = await pickMonday(req, workMonday);
  await syncProposal(m);
  const d = await weekData(m);
  const co = await company();
  const slips = d.slips.map(s => ({ ...s, regels: s.regels.map(l => ({ product: l.product, maat: l.maat, soort: l.soort, partij: l.partij, dozen: l.dozen, stuks: l.stuks, prijs_usd: Number(l.prijs_usd), prijs_eur: l.prijs_eur == null ? null : Number(l.prijs_eur), bedrag: l.bedrag == null ? null : Number(l.bedrag), herkomst: l.herkomst, product_exact: l.product_exact || l.product_code })) }));
  const done = slips.filter(s => s.status === 'akkoord');
  res.json({
    maandag: m, week: d.week, jaar: d.jaar, vandaag: today(), koers: d.koers, geteld: d.counted, outlook: await outlookState(),
    bedrijf: { iban: co.iban, pp_b: co.pp_b, pp_b_voorbeeld: co.pp_b_voorbeeld, naam: co.naam },
    slips,
    totalen: { klanten: slips.length, dozen: sum(slips, s => s.dozen), omzet: r2(sum(slips, s => s.totaal)), klaar: slips.filter(s => s.status === 'klaar').length, akkoord: done.length,
      over: sum(d.regels.filter(r => r.rest > 0), r => r.rest), teVeel: sum(d.regels.filter(r => r.rest < 0), r => -r.rest),
      exact: done.filter(s => s.pakbon.exact === 'in_exact').length, outlook: done.filter(s => s.concept && s.concept.status === 'in_outlook').length, verstuurd: done.filter(s => s.concept && s.concept.status === 'verstuurd').length },
    taken: weekTasks(d).filter(t => t.stap === 'pakbonnen'),
  });
}));
// one slip as the customer will see it: the fixed one after approval, otherwise how it stands now
week.get('/pakbonnen/klant/:klant', wrap(async (req, res) => {
  const m = await pickMonday(req, workMonday);
  const kid = int(req.params.klant);
  const d = await weekData(m);
  const s = d.slips.find(x => x.klant_id === kid);
  if (!s) return res.status(404).json({ fout: 'Deze klant krijgt deze week niets.' });
  const co = await company();
  if (s.pakbon && s.pakbon.status === 'akkoord') {
    const doc = await slipDoc(s.pakbon.id);
    return res.json({ ...doc, L: undefined, ppLocal: doc.L.ppLocal, status: s.status, gewijzigd: s.gewijzigd, pakbon: s.pakbon, concept: s.concept, email: s.email, klant_id: kid, live: false, outlook: await outlookState() });
  }
  const k = d.K.get(kid);
  const pass = new Map();
  for (const l of s.regels) { const key = `${l.soort}|${l.partij}`; if (!pass.has(key)) pass.set(key, { a: l.soort, b: co.pp_b, c: l.partij, d: l.herkomst || '' }); }
  res.json({
    live: true, status: s.status, reden: s.reden, klant_id: kid, nummer: s.pakbon ? s.pakbon.nummer : null, datum: today() < m ? m : today(), maandag: m, week: d.week, koers: d.koers, bedrijf: co,
    klant: { naam: k.naam, contact: k.contact, adres: k.adres, postcode: k.postcode, plaats: k.plaats, land: k.land, btw_nummer: k.btw_nummer, exact_code: k.exact_code, email: k.factuur_email || k.email },
    regels: s.regels.map(l => ({ dozen: l.dozen, stuks: l.stuks, omschrijving: `${l.product} ${l.maat}`, sub: l.soort, partij: l.partij, prijs_usd: l.prijs_usd, prijs_eur: l.prijs_eur, bedrag: l.bedrag, door: l.door })),
    dozen: s.dozen, stuks: s.stuks, totaal: s.totaal, btw_pct: s.btw.pct, btw_bedrag: s.btw_bedrag, totaal_incl: r2(s.totaal + s.btw_bedrag), btw_soort: s.btw.soort, paspoorten: [...pass.values()],
    betaaltermijn: k.betaaltermijn, email: s.email, outlook: await outlookState(),
  });
}));
week.post('/pakbonnen/akkoord', wrap(async (req, res) => {
  const m = req.body?.maandag;
  if (!isMonday(m)) return bad(res, 'Kies de week.');
  const ids = Array.isArray(req.body?.klant_ids) ? req.body.klant_ids.map(int).filter(Boolean) : null;
  const made = await approveSlips(m, ids, who(req));
  const o = await outlookState();
  let inOutlook = 0;
  if (o.doel) inOutlook = (await one(`SELECT count(*) AS n FROM concepten WHERE pakbon_id = ANY($1) AND status = 'in_outlook'`, [made.map(x => x.id)])).n;
  res.json({ ok: true, akkoord: made.length, nummers: made.map(x => x.nummer), outlook: o.doel, inOutlook });
}));
week.post('/pakbonnen/:id/heropen', wrap(async (req, res) => { await reopenSlip(int(req.params.id), who(req)); res.json({ ok: true }); }));
week.post('/pakbonnen/exact', wrap(async (req, res) => {
  let ids = Array.isArray(req.body?.ids) ? req.body.ids.map(int).filter(Boolean) : [];
  if (!ids.length && isMonday(req.body?.maandag)) ids = (await rows(`SELECT id FROM pakbonnen WHERE maandag = $1 AND status = 'akkoord' AND exact = ${req.body?.terug ? `'in_exact'` : `'open'`}`, [req.body.maandag])).map(r => r.id);
  res.json({ ok: true, aantal: await markSlipsExact(ids, who(req), { terug: !!req.body?.terug, nummer: req.body?.nummer ? String(req.body.nummer).slice(0, 40) : null }) });
}));
week.get('/pakbonnen/:id/pdf', wrap(async (req, res) => {
  const out = await slipPdfById(int(req.params.id));
  if (!out) return res.status(404).send('Niet gevonden');
  res.removeHeader('Content-Security-Policy');
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="Pakbon ${out.doc.nummer}.pdf"`);
  res.send(out.pdf);
}));
// every approved slip of the week in one pdf, to print on Monday morning
week.get('/weken/:maandag/pakbonnen.pdf', wrap(async (req, res) => {
  if (!isMonday(req.params.maandag)) return res.status(400).send('Geen maandag');
  const ids = (await rows(`SELECT p.id FROM pakbonnen p JOIN klanten k ON k.id = p.klant_id WHERE p.maandag = $1 AND p.status = 'akkoord' ORDER BY k.naam`, [req.params.maandag])).map(r => r.id);
  if (!ids.length) return res.status(404).send('Er zijn deze week nog geen pakbonnen akkoord.');
  const all = await PDFDocument.create();
  for (const id of ids) {
    const one_ = await slipPdfById(id);
    const src = await PDFDocument.load(one_.pdf);
    for (const pg of await all.copyPages(src, src.getPageIndices())) all.addPage(pg);
  }
  await q('UPDATE pakbonnen SET gedrukt_op = now() WHERE id = ANY($1)', [ids]);
  res.removeHeader('Content-Security-Policy');
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="Pakbonnen week ${isoWeek(req.params.maandag).week}.pdf"`);
  res.send(Buffer.from(await all.save()));
}));
async function conceptOf(pakbonId) {
  return one(`SELECT * FROM concepten WHERE pakbon_id = $1 AND status <> 'vervallen'`, [pakbonId]);
}
week.post('/pakbonnen/outlook', wrap(async (req, res) => {
  const { pushConcept, target } = await import('../outlook.js');
  if (!await target()) return bad(res, 'Outlook is nog niet gekoppeld. Koppel het bij Koppelingen, of open elke mail met "Open in Outlook".');
  let ids = Array.isArray(req.body?.ids) ? req.body.ids.map(int).filter(Boolean) : [];
  if (!ids.length && isMonday(req.body?.maandag)) ids = (await rows(`SELECT p.id FROM pakbonnen p JOIN concepten c ON c.pakbon_id = p.id AND c.status = 'concept' WHERE p.maandag = $1 AND p.status = 'akkoord'`, [req.body.maandag])).map(r => r.id);
  let gezet = 0; const fouten = [];
  for (const id of ids) {
    const c = await conceptOf(id) || await one('SELECT * FROM concepten WHERE id = $1', [await slipConcept(id, { push: false })]);
    if (!c || !c.aan) { fouten.push('Een klant heeft geen mailadres.'); continue; }
    const r = await pushConcept(c.id);
    if (r.ok) gezet++; else fouten.push(r.reden);
  }
  await log(who(req), `${gezet} facturen in Outlook gezet`, 'week', null, { ids });
  res.json({ ok: !fouten.length, gezet, fouten: [...new Set(fouten)] });
}));
week.get('/pakbonnen/:id/eml', wrap(async (req, res) => {
  const id = int(req.params.id);
  const c = await conceptOf(id) || await one('SELECT * FROM concepten WHERE id = $1', [await slipConcept(id, { push: false })]);
  if (!c) return res.status(404).send('Niet gevonden');
  const { conceptEml } = await import('../drafts.js');
  const raw = await conceptEml(c);
  res.set('Content-Type', 'message/rfc822');
  res.set('Content-Disposition', `attachment; filename="Factuur ${c.nummer}.eml"`);
  res.send(raw);
}));
week.post('/pakbonnen/:id/verstuur', wrap(async (req, res) => {
  const c = await conceptOf(int(req.params.id));
  if (!c) return res.status(404).json({ fout: 'Er is geen concept voor deze pakbon.' });
  const { sendConcept } = await import('../outlook.js');
  await sendConcept(c.id, who(req));
  res.json({ ok: true });
}));
// paper only: Jan gave the slip with the goods and does not want a mail
week.post('/pakbonnen/:id/papier', wrap(async (req, res) => {
  const c = await conceptOf(int(req.params.id));
  if (!c) return res.status(404).json({ fout: 'Er is geen concept voor deze pakbon.' });
  if (c.extern_id) { const { removeFromOutlook } = await import('../outlook.js'); await removeFromOutlook(c); }
  await q(`UPDATE concepten SET status = 'verstuurd', verstuurd_op = now(), extern_id = NULL, gesprek_notitie = 'met de goederen meegegeven', bijgewerkt = now() WHERE id = $1`, [c.id]);
  await log(who(req), `Factuur ${c.nummer} met de goederen meegegeven`, 'pakbon', int(req.params.id));
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- Klanten
week.get('/klanten', wrap(async (req, res) => res.json(await customerList({ jaar: int(req.query.jaar) || Number(today().slice(0, 4)) }))));
week.get('/klanten/:id', wrap(async (req, res) => {
  const d = await customerDetail(int(req.params.id), { jaar: int(req.query.jaar) || Number(today().slice(0, 4)) });
  if (!d) return res.status(404).json({ fout: 'Klant niet gevonden.' });
  const prods = await rows('SELECT id, code, naam, maat FROM producten WHERE actief ORDER BY volgorde');
  res.json({ ...d, producten: prods, bestelWeek: await orderMonday(), analyse: await customerAnalysis(d.klant.id).catch(() => null) });
}));
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
week.post('/klanten', wrap(async (req, res) => saveCustomer(req, res, null)));
week.patch('/klanten/:id', wrap(async (req, res) => saveCustomer(req, res, int(req.params.id))));
async function saveCustomer(req, res, id) {
  const b = req.body || {}, v = {}, err = {};
  const text = (k, max = 160, req_ = false) => { if (!(k in b)) { if (req_ && !id) err[k] = 'Vul dit in.'; return; } const s = String(b[k] ?? '').trim(); if (!s) { if (req_) err[k] = 'Vul dit in.'; else v[k] = null; return; } if (s.length > max) err[k] = `Maximaal ${max} tekens.`; else v[k] = s; };
  text('naam', 120, true); text('contact', 80); text('telefoon', 40); text('adres', 160); text('postcode', 20); text('plaats', 80, true); text('btw_nummer', 40); text('exact_code', 30);
  for (const k of ['email', 'factuur_email']) if (k in b) { const s = String(b[k] || '').trim().toLowerCase(); if (s && !EMAIL.test(s)) err[k] = 'Dit is geen geldig e-mailadres.'; else v[k] = s || null; }
  if ('land' in b) { const s = String(b.land || '').trim().toUpperCase(); if (!/^[A-Z]{2}$/.test(s)) err.land = 'Twee letters, bijvoorbeeld NL.'; else v.land = s; } else if (!id) err.land = 'Vul dit in.';
  if ('taal' in b) { if (!['nl', 'en', 'de', 'fr', 'it', 'pl', 'sv', 'da', 'es', 'no'].includes(b.taal)) err.taal = 'Kies een taal.'; else v.taal = b.taal; }
  if ('betaaltermijn' in b) { const n = Number(b.betaaltermijn); if (!Number.isInteger(n) || n < 0 || n > 120) err.betaaltermijn = 'Dagen, 0 tot 120.'; else v.betaaltermijn = n; }
  if ('soort' in b) { if (!['kwekerij', 'groothandel', 'tuincentrum', 'interieur', 'bloemist', 'overig'].includes(b.soort)) err.soort = 'Kies een soort.'; else v.soort = b.soort; }
  if (Object.keys(err).length) return res.status(400).json({ fout: 'Niet alles is goed ingevuld.', velden: err });
  if (id) {
    const keys = Object.keys(v);
    if (keys.length) await q(`UPDATE klanten SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...keys.map(k => v[k])]);
    await log(who(req), 'Klant aangepast', 'klant', id, v);
    return res.json({ ok: true, id });
  }
  let code = v.naam.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'klant', n = 1;
  while (await one('SELECT 1 FROM klanten WHERE code = $1', [code])) code = `${code.slice(0, 32)}-${++n}`;
  const keys = Object.keys(v);
  const r = await one(`INSERT INTO klanten (code, bron, kanaal, ${keys.join(', ')}) VALUES ($1, 'handmatig', 'telefoon', ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`, [code, ...keys.map(k => v[k])]);
  await log(who(req), 'Klant toegevoegd', 'klant', r.id, { naam: v.naam });
  res.json({ ok: true, id: r.id });
}
week.put('/klanten/:id/prijs', wrap(async (req, res) => {
  const id = int(req.params.id), p = int(req.body?.product_id), raw = req.body?.prijs_usd;
  if (!id || !p) return bad(res, 'Kies een product.');
  if (raw === null || raw === '') await q('DELETE FROM prijsafspraken WHERE klant_id = $1 AND product_id = $2', [id, p]);
  else {
    const n = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 1000) return bad(res, 'Een prijs in dollars per stuk, bijvoorbeeld 0,54.');
    await q(`INSERT INTO prijsafspraken (klant_id, product_id, prijs_usd) VALUES ($1, $2, $3) ON CONFLICT (klant_id, product_id) DO UPDATE SET prijs_usd = EXCLUDED.prijs_usd`, [id, p, n]);
  }
  await log(who(req), 'Prijsafspraak aangepast', 'klant', id, { product_id: p, prijs_usd: raw });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- Jaar and the live Excel
week.get('/jaar', wrap(async (req, res) => res.json(await yearData(int(req.query.jaar) || Number(today().slice(0, 4))))));
week.get('/excel', wrap(async (req, res) => {
  const jaar = int(req.query.jaar) || Number(today().slice(0, 4));
  const buf = await yearWorkbook(jaar);
  await log(who(req), `Jaaroverzicht ${jaar} gedownload`, 'excel');
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="Campo jaaroverzicht ${jaar}.xlsx"`);
  res.send(buf);
}));

// ---------------------------------------------------------------- what is printed on the slip and invoice
week.get('/instellingen', wrap(async (req, res) => {
  const regios = await rows('SELECT * FROM regios ORDER BY nummer NULLS LAST, code');
  const leveranciers = await rows(`SELECT l.*, (SELECT count(*) FROM partijen p WHERE p.leverancier_id = l.id) AS zendingen FROM leveranciers l ORDER BY regio, naam`);
  const producten = await rows('SELECT d.*, l.naam AS leverancier FROM producten d LEFT JOIN leveranciers l ON l.id = d.leverancier_id ORDER BY d.volgorde, d.code');
  res.json({ bedrijf: await company(), standaard: DEFAULT_COMPANY, regios, leveranciers, producten });
}));
week.patch('/instellingen', wrap(async (req, res) => {
  const b = req.body || {}, cur = await setting('bedrijf', {}), out = { ...cur };
  for (const k of ['naam', 'straat', 'postcode', 'plaats', 'land', 'telefoon', 'email', 'kvk', 'btw', 'iban', 'bic', 'pp_b']) if (k in b) out[k] = String(b[k] ?? '').trim().slice(0, 120);
  if (out.pp_b && !/^[A-Z]{2}-?[A-Z0-9]{3,20}$/i.test(out.pp_b)) return res.status(400).json({ fout: 'Het registratienummer (B) begint met de landcode, bijvoorbeeld NL-1234567.', velden: { pp_b: 'Bijvoorbeeld NL-1234567.' } });
  if (out.iban && !/^[A-Z]{2}\d{2}[A-Z0-9 ]{10,30}$/i.test(out.iban)) return res.status(400).json({ fout: 'Dit lijkt geen IBAN.', velden: { iban: 'Bijvoorbeeld NL12 RABO 0123 4567 89.' } });
  if ('betaaltermijn' in b) { const n = Number(b.betaaltermijn); if (Number.isInteger(n) && n >= 0 && n <= 120) out.betaaltermijn = n; }
  for (const k of Object.keys(out)) if (out[k] === '') delete out[k];
  await setSetting('bedrijf', out);
  await log(who(req), 'Gegevens op pakbon en factuur aangepast', null, null, b);
  res.json({ ok: true, bedrijf: await company() });
}));
week.post('/regios', wrap(async (req, res) => {
  const b = req.body || {}, code = String(b.code || '').trim().toUpperCase(), land = String(b.land || '').trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(code) || !/^[A-Z]{2}$/.test(land) || !String(b.naam || '').trim()) return bad(res, 'Een code van 2 of 3 letters, een naam en het land van herkomst.');
  // the two digits of the region in the batch number (264901: region 01). Empty keeps the number, or takes the next free one.
  const raw = String(b.nummer ?? '').trim(), nr = raw === '' ? null : Number(raw);
  if (nr != null && (!Number.isInteger(nr) || nr < 1 || nr > 99)) return bad(res, 'Het regionummer is 1 tot 99, zoals 01 tot 04.');
  if (nr != null) {
    const taken = await one('SELECT code FROM regios WHERE nummer = $1 AND code <> $2', [nr, code]);
    if (taken) return bad(res, `Nummer ${String(nr).padStart(2, '0')} hoort al bij regio ${taken.code}.`);
  }
  await q(`INSERT INTO regios (code, naam, land, valuta, vervoer, nummer) VALUES ($1, $2, $3, $4, $5, coalesce($6, (SELECT coalesce(max(nummer), 0) + 1 FROM regios)))
    ON CONFLICT (code) DO UPDATE SET naam = EXCLUDED.naam, land = EXCLUDED.land, valuta = EXCLUDED.valuta, vervoer = EXCLUDED.vervoer, nummer = coalesce($6, regios.nummer)`,
    [code, String(b.naam).trim().slice(0, 60), land, /^[A-Z]{3}$/.test(b.valuta || '') ? b.valuta : 'USD', b.vervoer ? String(b.vervoer).slice(0, 120) : null, nr]);
  await log(who(req), `Regio ${code} opgeslagen`);
  res.json({ ok: true });
}));
week.get('/producten', wrap(async (req, res) => res.json(await rows('SELECT id, code, naam, maat, soort, per_doos, prijs_usd FROM producten WHERE actief ORDER BY volgorde, code'))));
week.get('/zoek', wrap(async (req, res) => {
  const t = String(req.query.q || '').trim();
  if (t.length < 2) return res.json([]);
  const like = `%${t.replace(/[%_]/g, '')}%`;
  res.json(await rows(`
    (SELECT 'klant' AS soort, id::text AS id, naam AS titel, concat_ws(', ', plaats, land) AS sub FROM klanten WHERE naam ILIKE $1 OR plaats ILIKE $1 OR contact ILIKE $1 ORDER BY naam LIMIT 6)
    UNION ALL (SELECT 'partij', maandag::text || '#p' || id, concat(nummer, ' · ', (SELECT naam FROM leveranciers l WHERE l.id = p.leverancier_id)), to_char(maandag, 'DD-MM-YYYY') FROM partijen p WHERE nummer ILIKE $1 OR awb ILIKE $1 ORDER BY maandag DESC LIMIT 6)
    UNION ALL (SELECT 'pakbon', maandag::text || ':' || klant_id, concat(nummer, ' · ', (SELECT naam FROM klanten k WHERE k.id = s.klant_id)), to_char(maandag, 'DD-MM-YYYY') FROM pakbonnen s WHERE nummer ILIKE $1 ORDER BY maandag DESC LIMIT 6)
    UNION ALL (SELECT 'leverancier', id::text, naam, concat_ws(', ', plaats, regio) FROM leveranciers WHERE naam ILIKE $1 OR plaats ILIKE $1 OR contact ILIKE $1 ORDER BY naam LIMIT 4)
    UNION ALL (SELECT 'product', id::text, concat(naam, ' ', maat), soort FROM producten WHERE naam ILIKE $1 OR soort ILIKE $1 OR code ILIKE $1 ORDER BY volgorde LIMIT 6)`, [like]));
}));

// ---------------------------------------------------------------- one supplier: his shipment, the papers from his mail, the Excel
const fmtD = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const range = list => (!list.length ? '' : list.length === 1 ? `rij ${list[0]}` : list.every((x, i) => !i || x === list[i - 1] + 1) ? `rij ${list[0]}–${list[list.length - 1]}` : `rijen ${list.join(', ')}`);
function processing(p, d, logs, xl) {
  const steps = [], doc = soort => p.docs.find(x => x.soort === soort) || null;
  const usd = n => `$ ${Number(n).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (passed(p.besteld_op)) steps.push({ op: p.besteld_op, wie: 'Jan', tekst: `Besteld: ${sum(p.regels, r => r.besteld || 0)} dozen in ${p.regels.length} regels.`, doc: doc('bestelling')?.id || null });
  if (passed(p.bevestigd_op)) {
    const anders = p.regels.filter(r => r.bevestigd != null && r.bevestigd !== r.besteld).length, c = doc('bevestiging');
    steps.push({ op: p.bevestigd_op, wie: c && c.gelezen_door === 'ai' ? 'desk' : 'Jan', tekst: `Bevestiging ${c && c.gelezen_door === 'ai' ? 'gelezen door de desk' : 'verwerkt'}: ${anders ? `${anders} ${anders === 1 ? 'regel' : 'regels'} anders dan besteld` : 'alles zoals besteld'}.`, doc: c?.id || null });
  }
  if (passed(p.verzonden_op)) {
    const z = p.regels.filter(r => r.zekerheid != null), v = doc('verzendbewijs');
    const avg = z.length ? Math.round(sum(z, r => r.zekerheid) / z.length) : null;
    steps.push({ op: v ? v.ontvangen : p.verzonden_op, wie: v && v.gelezen_door === 'ai' ? 'desk' : 'Jan', tekst: `Verzendpapieren ${v && v.gelezen_door === 'ai' ? 'gelezen door de desk' : 'verwerkt'}: ${p.regels.length} regels, ${sum(p.regels, r => r.verzonden || 0)} dozen, ${usd(sum(exactLines(p), l => l.bedrag_usd))}${avg ? `, ${avg}% zeker` : ''}.${p.twijfels ? ` ${p.twijfels === 1 ? 'Eén regel' : `${p.twijfels} regels`} om na te kijken.` : ''}`, doc: v?.id || null });
  }
  for (const l of logs) if (!/^Inkooporder/.test(l.actie) && !/gelezen$/.test(l.actie)) steps.push({ op: l.tijd, wie: l.wie, tekst: `${l.actie}.` });
  if (p.exact === 'in_exact') steps.push({ op: p.exact_op, wie: p.exact_door || 'Jan', tekst: `Inkooporder in Exact${p.exact_nummer ? ` (${p.exact_nummer})` : ''}, met ${p.nummer} als kostendrager.` });
  if (d.counted && passed(d.wk.geteld_op)) steps.push({ op: d.wk.geteld_op, wie: d.wk.geteld_door || 'Jan', tekst: `Geteld in de hal: ${sum(p.regels, r => r.geteld ?? 0)} dozen${sum(p.regels, r => r.uitval || 0) ? `, ${sum(p.regels, r => r.uitval || 0)} uitval` : ''}.` });
  if (xl && xl.verkoop.length) steps.push({ op: null, wie: 'Jan', tekst: `Naar ${new Set(xl.verkoop.map(v => v.klant)).size} klanten op ${new Set(xl.verkoop.map(v => v.factuur)).size} pakbonnen, ${sum(xl.verkoop, v => v.dozen)} dozen.` });
  steps.sort((a, b) => (a.op ? new Date(a.op) : Infinity) - (b.op ? new Date(b.op) : Infinity));
  return steps.map(x => ({ ...x, wanneer: x.op ? fmtD.format(new Date(x.op)).replace('.', '') : null }));
}
week.get('/leveranciers', wrap(async (req, res) => res.json(await rows(`SELECT l.id, l.naam, l.regio, l.plaats, l.route FROM leveranciers l WHERE l.actief ORDER BY l.naam`))));
week.get('/leveranciers/:id', wrap(async (req, res) => {
  const id = int(req.params.id);
  const l = await one('SELECT l.*, g.naam AS regio_naam, g.land AS herkomst FROM leveranciers l LEFT JOIN regios g ON g.code = l.regio WHERE l.id = $1', [id]);
  if (!l) return res.status(404).json({ fout: 'Leverancier niet gevonden.' });
  let m = isMonday(req.query.maandag) ? req.query.maandag : null;
  if (!m) {
    const buy = await buyMonday();
    const x = await one('SELECT maandag FROM partijen WHERE leverancier_id = $1 AND besteld_op <= now() ORDER BY (maandag = $2) DESC, (maandag <= $2) DESC, maandag DESC LIMIT 1', [id, buy]);
    m = x ? x.maandag : buy;
  }
  const d = await weekData(m);
  const p = d.partijen.find(x => x.leverancier_id === id && passed(x.besteld_op)) || null;
  const [stat, history, xl, risk, logs, weeks] = await Promise.all([
    supplierStat(id), supplierHistory(id), p ? sheetRows(p.id) : null, p ? assess([forRisk(p)], { hist: await lateHistory(m) }) : null,
    p ? rows(`SELECT tijd, wie, actie FROM logboek WHERE object = 'partij' AND object_id = $1 ORDER BY tijd`, [p.id]) : [],
    rows('SELECT maandag FROM partijen WHERE leverancier_id = $1 AND besteld_op <= now() ORDER BY maandag', [id]),
  ]);
  const ms = weeks.map(w => w.maandag), i = ms.indexOf(m);
  const flow = p ? streams({ ...d, partijen: [p] }).partijen[0] : null;
  res.json({
    leverancier: { id: l.id, naam: l.naam, code: l.code, regio: l.regio, regio_naam: l.regio_naam, herkomst: l.herkomst, plaats: l.plaats, contact: l.contact, email: l.email, telefoon: l.telefoon, whatsapp: l.whatsapp, taal: l.taal, exact_code: l.exact_code, route: routeOf({ route: l.route, regio: l.regio }), eigenRoute: !!(l.route && l.route.length) },
    maandag: m, week: isoWeek(m).week, geteld: d.counted, vorige: i > 0 ? ms[i - 1] : ms.filter(x => x < m).pop() || null, volgende: i >= 0 && i < ms.length - 1 ? ms[i + 1] : ms.find(x => x > m) || null,
    partij: p ? { ...partijJson(p, m), risico: riskJson(risk?.per.get(p.id)), stroom: flow } : null,
    verwerking: p ? processing(p, d, logs, xl) : [], excel: xl ? { ...xl, inkoopRange: range(xl.inkoop) } : null,
    stat, geschiedenis: history, bronnen: risk ? risk.bronnen : null, plekken: PLEKKEN,
  });
}));
week.patch('/leveranciers/:id', wrap(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, set = [], vals = [id];
  if ('route' in b) {
    const r = b.route ? parseRoute(Array.isArray(b.route) ? b.route.join(' ') : b.route) : null;
    if (b.route && !r) return bad(res, 'Een route is een rij luchthavencodes, bijvoorbeeld SJO AMS of GUA MIA AMS.');
    vals.push(r); set.push(`route = $${vals.length}`);
  }
  for (const k of ['contact', 'telefoon', 'whatsapp']) if (k in b) { vals.push(b[k] ? String(b[k]).trim().slice(0, 80) : null); set.push(`${k} = $${vals.length}`); }
  if ('email' in b) { const e = String(b.email || '').trim().toLowerCase(); if (e && !EMAIL.test(e)) return bad(res, 'Dit is geen geldig e-mailadres.'); vals.push(e || null); set.push(`email = $${vals.length}`); }
  if (!set.length) return res.json({ ok: true });
  await q(`UPDATE leveranciers SET ${set.join(', ')} WHERE id = $1`, vals);
  // the shipments that have not flown yet follow a new route
  if ('route' in b) await q(`UPDATE partijen SET route = (SELECT route FROM leveranciers WHERE id = $1) WHERE leverancier_id = $1 AND (verzonden_op IS NULL OR verzonden_op > now()) AND (binnen_op IS NULL OR binnen_op > now())`, [id]);
  await log(who(req), 'Leverancier aangepast', 'leverancier', id, b);
  forget();
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- what Jan hears about the world
const SOORTEN = ['weer', 'storm', 'vulkaan', 'staking', 'douane', 'capaciteit', 'vertraging', 'overig'];
week.post('/meldingen', wrap(async (req, res) => {
  const b = req.body || {};
  const titel = String(b.titel || '').trim(), soort = SOORTEN.includes(b.soort) ? b.soort : 'overig', ernst = b.ernst === 'probleem' ? 'probleem' : 'let_op';
  if (titel.length < 3 || titel.length > 140) return bad(res, 'Schrijf in een paar woorden wat er is, bijvoorbeeld: staking grondpersoneel Schiphol.');
  const plek = b.plek ? String(b.plek).trim().toUpperCase() : null;
  if (plek && !/^[A-Z]{2,3}$/.test(plek)) return bad(res, 'Plek is een luchthavencode (MIA), een regio (GT) of NL voor de weg naar Nootdorp.');
  const van = b.van ? new Date(b.van) : new Date(), tot = b.tot ? new Date(b.tot) : null;
  if (Number.isNaN(van.getTime()) || (tot && (Number.isNaN(tot.getTime()) || tot <= van))) return bad(res, 'Kies een begin en een eind, het eind na het begin.');
  const uren = b.vertraging_uren === '' || b.vertraging_uren == null ? null : Number(b.vertraging_uren);
  if (uren != null && (!Number.isInteger(uren) || uren < 0 || uren > 240)) return bad(res, 'Vertraging in hele uren, 0 tot 240.');
  const r = await one(`INSERT INTO risico_meldingen (soort, ernst, titel, tekst, plek, partij_id, vertraging_uren, van, tot, bron, door) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'jan',$10) RETURNING id`,
    [soort, ernst, titel, b.tekst ? String(b.tekst).slice(0, 800) : null, plek, int(b.partij_id), uren, van, tot, who(req)]);
  await log(who(req), `Melding: ${titel}`, 'melding', r.id, { plek, ernst });
  res.json({ ok: true, id: r.id });
}));
week.post('/meldingen/:id/opgelost', wrap(async (req, res) => {
  await q('UPDATE risico_meldingen SET opgelost_op = CASE WHEN $2 THEN NULL ELSE now() END WHERE id = $1', [int(req.params.id), !!req.body?.terug]);
  await log(who(req), req.body?.terug ? 'Melding weer open' : 'Melding opgelost', 'melding', int(req.params.id));
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- Relaties: how good the partners really are
week.get('/relaties', wrap(async (req, res) => res.json(await relations())));
week.get('/planten', wrap(async (req, res) => res.json(await plantStats())));

// ---------------------------------------------------------------- good deals: offers and boxes on their way, sold one to one
week.get('/deals', wrap(async (req, res) => {
  const m = await pickMonday(req, orderMonday);
  const out = await deals(m);
  const f = focusMonday();
  // boxes on their way for the coming Monday that still have no buyer
  let onderweg = [];
  await syncProposal(f).catch(() => 0);
  const fd = await weekData(f);
  if (fd.regels.length) onderweg = await onTheWay(fd);
  res.json({ ...out, onderweg: { maandag: f, week: isoWeek(f).week, lijst: onderweg } });
}));
week.post('/aanbod', wrap(async (req, res) => {
  const b = req.body || {};
  const lid = int(b.leverancier_id), pid = int(b.product_id), dz = int(b.dozen), prijs = Number(String(b.prijs_usd ?? '').replace(',', '.'));
  if (!lid || !pid || !isMonday(b.maandag)) return bad(res, 'Kies de leverancier, het product en de week.');
  if (!dz || dz < 1 || dz > 9999) return bad(res, 'Hoeveel dozen biedt hij aan?');
  if (!Number.isFinite(prijs) || prijs <= 0 || prijs > 1000) return bad(res, 'De prijs in dollars per stuk, bijvoorbeeld 0,55.');
  const r = await one(`INSERT INTO leverancier_aanbod (leverancier_id, product_id, maandag, dozen, prijs_usd, notitie, geldig_tot, door) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [lid, pid, b.maandag, dz, prijs, b.notitie ? String(b.notitie).slice(0, 600) : null, isDay(b.geldig_tot) ? `${b.geldig_tot}T23:59:00` : null, who(req)]);
  await log(who(req), 'Aanbod genoteerd', 'aanbod', r.id, { leverancier_id: lid, product_id: pid, dozen: dz, prijs_usd: prijs });
  res.json({ ok: true, id: r.id });
}));
week.post('/aanbod/:id/status', wrap(async (req, res) => {
  const id = int(req.params.id), st = req.body?.status;
  if (!['open', 'genomen', 'afgewezen'].includes(st)) return bad(res, 'Onbekende stand.');
  const a = await one('SELECT * FROM leverancier_aanbod WHERE id = $1', [id]);
  if (!a) return res.status(404).json({ fout: 'Dit aanbod bestaat niet meer.' });
  const sold = await one('SELECT coalesce(sum(dozen), 0) AS n FROM aanbod_verkoop WHERE aanbod_id = $1', [id]);
  const n = st === 'genomen' ? Math.min(a.dozen, int(req.body?.dozen) || Number(sold.n) || a.dozen) : null;
  await q('UPDATE leverancier_aanbod SET status = $2, genomen_dozen = $3, status_op = now(), door = $4 WHERE id = $1', [id, st, n, who(req)]);
  await log(who(req), st === 'genomen' ? `Aanbod aangenomen (${n} dozen)` : st === 'afgewezen' ? 'Aanbod afgewezen' : 'Aanbod weer open', 'aanbod', id);
  res.json({ ok: true });
}));
// a customer said yes on the phone: his order for that week grows by these boxes
week.post('/aanbod/:id/verkoop', wrap(async (req, res) => {
  const id = int(req.params.id), k = int(req.body?.klant_id), dz = int(req.body?.dozen);
  const a = await one('SELECT a.*, l.naam AS leverancier FROM leverancier_aanbod a JOIN leveranciers l ON l.id = a.leverancier_id WHERE a.id = $1', [id]);
  if (!a || !k || dz == null || dz < 0 || dz > 9999) return bad(res, 'Kies een klant en een aantal dozen.');
  const placed = await one(`SELECT 1 FROM pakbonnen WHERE maandag = $1 AND klant_id = $2 AND status = 'akkoord'`, [a.maandag, k]);
  if (placed) return bad(res, 'De pakbon van deze klant voor die week is al akkoord.');
  const cur = (await one('SELECT dozen FROM weekorders WHERE maandag = $1 AND klant_id = $2 AND product_id = $3', [a.maandag, k, a.product_id]))?.dozen || 0;
  const before = (await one('SELECT dozen FROM aanbod_verkoop WHERE aanbod_id = $1 AND klant_id = $2', [id, k]))?.dozen || 0;
  const next = Math.max(0, cur - Math.min(before, cur) + dz);
  await addOrder({ maandag: a.maandag, klant_id: k, product_id: a.product_id, dozen: next, notitie: dz ? `Uit het aanbod van ${a.leverancier}` : null }, who(req));
  if (dz) await q(`INSERT INTO aanbod_verkoop (aanbod_id, klant_id, dozen, door) VALUES ($1,$2,$3,$4) ON CONFLICT (aanbod_id, klant_id) DO UPDATE SET dozen = EXCLUDED.dozen, door = EXCLUDED.door, op = now()`, [id, k, dz, who(req)]);
  else await q('DELETE FROM aanbod_verkoop WHERE aanbod_id = $1 AND klant_id = $2', [id, k]);
  res.json({ ok: true, dozen: next });
}));
// boxes already on their way that had no buyer: this customer takes them
week.post('/deals/onderweg', wrap(async (req, res) => {
  const k = int(req.body?.klant_id), p = int(req.body?.product_id), dz = int(req.body?.dozen), m = focusMonday();
  if (!k || !p || !dz || dz < 1 || dz > 9999) return bad(res, 'Kies een klant en een aantal dozen.');
  const placed = await one(`SELECT 1 FROM pakbonnen WHERE maandag = $1 AND klant_id = $2 AND status = 'akkoord'`, [m, k]);
  if (placed) return bad(res, 'De pakbon van deze klant voor die week is al akkoord.');
  const cur = (await one('SELECT dozen FROM weekorders WHERE maandag = $1 AND klant_id = $2 AND product_id = $3', [m, k, p]))?.dozen || 0;
  await addOrder({ maandag: m, klant_id: k, product_id: p, dozen: cur + dz, notitie: 'Extra uit de zending, die nog geen koper had' }, who(req));
  res.json({ ok: true, dozen: cur + dz });
}));

// ---------------------------------------------------------------- new customers and suppliers
week.get('/kansen', wrap(async (req, res) => res.json(await leads())));
const KANS = ['nieuw', 'benaderd', 'in_gesprek', 'klant', 'afgewezen'];
week.post('/kansen', wrap(async (req, res) => {
  const b = req.body || {};
  if (!['klant', 'leverancier'].includes(b.soort)) return bad(res, 'Een klant of een leverancier?');
  const naam = String(b.naam || '').trim();
  if (naam.length < 2) return bad(res, 'Vul de naam in.');
  const t = (k, n = 200) => (b[k] ? String(b[k]).trim().slice(0, n) : null);
  const email = t('email', 120);
  if (email && !EMAIL.test(email)) return bad(res, 'Dit is geen geldig e-mailadres.');
  const r = await one(`INSERT INTO kansen (soort, naam, plaats, land, segment, contact, telefoon, email, wat, waarom, notitie, bron) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'jan') RETURNING id`,
    [b.soort, naam.slice(0, 120), t('plaats', 80), t('land', 2)?.toUpperCase() || null, t('segment', 60), t('contact', 80), t('telefoon', 40), email, t('wat', 300), t('waarom', 400), t('notitie', 600)]);
  await log(who(req), `Kans toegevoegd: ${naam}`, 'kans', r.id);
  res.json({ ok: true, id: r.id });
}));
week.patch('/kansen/:id', wrap(async (req, res) => {
  const id = int(req.params.id), b = req.body || {}, set = [], vals = [id];
  if ('status' in b) { if (!KANS.includes(b.status)) return bad(res, 'Onbekende stand.'); vals.push(b.status); set.push(`status = $${vals.length}`); }
  if ('notitie' in b) { vals.push(b.notitie ? String(b.notitie).slice(0, 600) : null); set.push(`notitie = $${vals.length}`); }
  if (!set.length) return res.json({ ok: true });
  await q(`UPDATE kansen SET ${set.join(', ')}, bijgewerkt = now() WHERE id = $1`, vals);
  await log(who(req), 'Kans bijgewerkt', 'kans', id, b);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- paid (until Exact tells the desk itself)
week.post('/pakbonnen/:id/betaald', wrap(async (req, res) => {
  const id = int(req.params.id), d = req.body?.datum;
  if (d != null && d !== '' && !isDay(d)) return bad(res, 'Kies de dag van betaling.');
  await q('UPDATE pakbonnen SET betaald_op = $2 WHERE id = $1', [id, d || null]);
  await log(who(req), d ? 'Factuur betaald' : 'Betaling teruggezet', 'pakbon', id, { datum: d || null });
  forget();
  res.json({ ok: true });
}));
