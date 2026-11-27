// How good are the partners really, and where can Jan earn more without hassle.
//   Leveranciers  on time, confirms what was ordered, ships what was confirmed, the count in the hall, damage, papers, price
//   Klanten       loyal, growing, turnover, margin, how they pay, how broad they buy; and where we could serve them more
//   Deals         offers from suppliers and boxes already on their way, matched to regular buyers so nothing is left over
//   Kansen        new customers and suppliers: where the data says to look, and the leads Jan keeps
// Everything comes from what really happened in the desk (ordered, confirmed, shipped, counted, invoiced, paid).
// The desk proposes; Jan calls, decides and orders.
import { rows } from '../db.js';
import { addDays, focusMonday, isoWeek, today, r2, sum, groupBy, passed } from './util.js';
import { routeOf, routeText } from './risk.js';

const W = 26;   // half a year of finished weeks
const at = (d, h, m = 0) => { const x = new Date(`${String(d).slice(0, 10)}T00:00:00`); x.setHours(h, m, 0, 0); return x; };
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
const grade = (v, good, bad) => (v == null || !Number.isFinite(v) ? null : Math.max(0, Math.min(100, ((v - bad) / (good - bad)) * 100)));
const days = (a, b) => Math.round((new Date(`${String(b).slice(0, 10)}T12:00:00`) - new Date(`${String(a).slice(0, 10)}T12:00:00`)) / 864e5);
const eur = v => `€ ${Math.round(Number(v) || 0).toLocaleString('nl-NL')}`;
const pctTxt = v => `${Math.round(v * 100)}%`;
const name = p => `${p.naam} ${p.maat}`;
const SOORT_EEN = { kwekerij: 'kwekerij', groothandel: 'groothandel', tuincentrum: 'tuincentrum', interieur: 'interieurbedrijf', bloemist: 'bloemist', overig: 'klant' };
const SOORT_MV = { kwekerij: 'Kwekerijen', groothandel: 'Groothandels', tuincentrum: 'Tuincentra', interieur: 'Interieurbedrijven', bloemist: 'Bloemisten', overig: 'Overige klanten' };
const LANDNAAM = { NL: 'Nederland', BE: 'België', DE: 'Duitsland', AT: 'Oostenrijk', FR: 'Frankrijk', DK: 'Denemarken', SE: 'Zweden', PL: 'Polen', IT: 'Italië', ES: 'Spanje', GB: 'Verenigd Koninkrijk', CZ: 'Tsjechië', CH: 'Zwitserland', CR: 'Costa Rica', GT: 'Guatemala' };

// ---------------------------------------------------------------- everything the analysis needs, read once a minute
let memo = null;
export function forget() { memo = null; }
async function load() {
  const focus = focusMonday();
  if (memo && memo.focus === focus && Date.now() - memo.at < 60e3) return memo.D;
  const now = new Date(), from = addDays(focus, -7 * 60);
  const [lev, prod, kl, part, regels, slips, sregels, orders, weken, afspraken] = await Promise.all([
    rows(`SELECT l.*, g.naam AS regio_naam, g.land AS herkomst FROM leveranciers l LEFT JOIN regios g ON g.code = l.regio ORDER BY l.naam`),
    rows('SELECT id, code, naam, soort, maat, per_doos, prijs_usd, inkoop_usd, leverancier_id, volgorde, actief FROM producten ORDER BY volgorde, code'),
    rows('SELECT id, naam, soort, plaats, land, taal, telefoon, contact, email, factuur_email, betaaltermijn, klant_sinds, actief FROM klanten ORDER BY naam'),
    rows('SELECT id, nummer, regio, leverancier_id, maandag, besteld_op, bevestigd_op, verzonden_op, binnen_op, exact, route FROM partijen WHERE maandag >= $1 ORDER BY maandag, nummer', [from]),
    rows(`SELECT r.id, r.partij_id, r.product_id, r.besteld, r.bevestigd, r.verzonden, r.geteld, r.uitval, r.per_doos, r.prijs_usd
      FROM partij_regels r JOIN partijen p ON p.id = r.partij_id WHERE p.maandag >= $1`, [from]),
    rows(`SELECT id, nummer, maandag, klant_id, datum, vervaldatum, betaald_op, totaal, koers, btw_pct FROM pakbonnen WHERE status = 'akkoord' AND maandag >= $1`, [from]),
    rows(`SELECT r.pakbon_id, r.regel_id, r.product_id, r.partij, r.dozen, r.stuks, r.prijs_usd, r.bedrag FROM pakbon_regels r JOIN pakbonnen s ON s.id = r.pakbon_id
      WHERE s.status = 'akkoord' AND s.maandag >= $1`, [from]),
    rows('SELECT maandag, klant_id, product_id, dozen FROM weekorders WHERE maandag >= $1 AND aangemaakt <= $2', [from, now]),
    rows('SELECT maandag, koers, geteld_op FROM weken WHERE maandag >= $1 ORDER BY maandag', [from]),
    rows('SELECT klant_id, product_id, prijs_usd FROM prijsafspraken'),
  ]);
  const P = new Map(prod.map(p => [p.id, p])), K = new Map(kl.map(k => [k.id, k])), L = new Map(lev.map(l => [l.id, l]));
  const partBy = new Map(part.map(p => [p.id, p])), regelBy = new Map(regels.map(r => [r.id, r]));
  for (const r of regels) r.partij = partBy.get(r.partij_id);
  const slipBy = new Map(slips.map(s => [s.id, s]));
  for (const x of sregels) { x.slip = slipBy.get(x.pakbon_id); x.regel = regelBy.get(x.regel_id) || null; }
  const deal = new Map(afspraken.map(a => [`${a.klant_id}:${a.product_id}`, Number(a.prijs_usd)]));
  const koersen = weken.filter(w => w.koers);
  const D = {
    now, focus, today: today(), from13: addDays(focus, -7 * 13), from26: addDays(focus, -7 * W), from52: addDays(focus, -7 * 2 * W),
    lev, prod, kl, part, regels, slips, sregels, orders, weken, P, K, L, deal,
    priceFor: (kid, pid) => deal.get(`${kid}:${pid}`) ?? Number(P.get(pid)?.prijs_usd || 0),
    koers: koersen.length ? Number(koersen[koersen.length - 1].koers) : 1.15,
    hasPay: slips.some(s => s.betaald_op),
  };
  D.cost = x => x.stuks * Number(x.regel ? x.regel.prijs_usd : D.P.get(x.product_id)?.inkoop_usd || 0) / Number(x.slip.koers || D.koers);
  // asked on the phone against what came on the packing slip, per week, customer and product
  const got = new Map();
  for (const x of sregels) { const k = `${x.slip.maandag}:${x.slip.klant_id}:${x.product_id}`; got.set(k, (got.get(k) || 0) + x.dozen); }
  D.short = orders.filter(o => o.maandag >= D.from26 && o.maandag < focus).map(o => ({ ...o, kreeg: got.get(`${o.maandag}:${o.klant_id}:${o.product_id}`) || 0 }))
    .map(o => ({ ...o, tekort: Math.max(0, o.dozen - o.kreeg) }));
  memo = { at: Date.now(), focus, D };
  return D;
}

const label = (s, kind) => (s == null ? { naam: 'Nog te weinig gegevens', toon: '' }
  : kind === 'lev' ? (s >= 85 ? { naam: 'Sterk', toon: 'ok' } : s >= 70 ? { naam: 'Goed', toon: 'ok' } : s >= 55 ? { naam: 'Let op', toon: 'wait' } : { naam: 'Zwak', toon: 'bad' })
    : (s >= 75 ? { naam: 'Topklant', toon: 'ok' } : s >= 60 ? { naam: 'Goede klant', toon: 'ok' } : s >= 40 ? { naam: 'Gewone klant', toon: '' } : { naam: 'Kleine klant', toon: '' }));
const total = parts => { const has = parts.filter(p => p.score != null); const w = sum(has, p => p.gewicht); return w ? Math.round(sum(has, p => p.score * p.gewicht) / w) : null; };

// ---------------------------------------------------------------- suppliers
function supplierBasics(D, l) {
  const mine = D.part.filter(p => p.leverancier_id === l.id && p.maandag < D.focus);
  const recent = mine.filter(p => p.maandag >= D.from26);
  const ids = new Set(recent.map(p => p.id));
  const rs = D.regels.filter(r => ids.has(r.partij_id));
  // shortfall only: confirming more is usually Jan's own last-minute change
  const short = (a, b) => { const x = rs.filter(r => r[a] != null && r[b] != null); const base = sum(x, r => r[b]); return base ? 1 - sum(x, r => Math.max(0, r[b] - r[a])) / base : null; };
  const bevestigt = short('bevestigd', 'besteld'), levert = short('verzonden', 'bevestigd');
  const tl = rs.filter(r => r.geteld != null && r.verzonden != null), tb = sum(tl, r => r.verzonden);
  const telling = tb ? 1 - sum(tl, r => Math.abs(r.geteld - r.verzonden)) / tb : null;
  const gt = rs.filter(r => r.geteld != null), gtn = sum(gt, r => r.geteld);
  const uitval = gtn ? sum(gt, r => r.uitval || 0) / gtn : null;
  const arrived = recent.filter(p => p.binnen_op && new Date(p.binnen_op) <= D.now);
  const late = arrived.filter(p => new Date(p.binnen_op) > at(p.maandag, 12));
  const flown = recent.filter(p => p.verzonden_op && new Date(p.verzonden_op) <= D.now);
  const papersOk = flown.filter(p => new Date(p.verzonden_op) <= at(addDays(p.maandag, -2), 12));
  const pr = rs.filter(r => r.verzonden != null);
  const usd = sum(pr, r => r.verzonden * r.per_doos * Number(r.prijs_usd));
  const std = sum(pr, r => r.verzonden * r.per_doos * Number(D.P.get(r.product_id)?.inkoop_usd || r.prijs_usd));
  const prijs = std ? usd / std : null;
  // what his boxes brought in on the packing slips
  const sold = D.sregels.filter(x => x.regel && ids.has(x.regel.partij_id));
  const omzet = sum(sold, x => Number(x.bedrag)), kost = sum(sold, x => D.cost(x));
  // per product: price per piece and how much of the order he confirmed
  const perProduct = [...groupBy(rs, r => r.product_id)].map(([pid, x]) => {
    const v = x.filter(r => r.verzonden != null), st = sum(v, r => r.verzonden * r.per_doos);
    const b = x.filter(r => r.bevestigd != null && r.besteld != null), bb = sum(b, r => r.besteld);
    return { product_id: pid, product: D.P.get(pid), dozen: sum(v, r => r.verzonden), stuks: st, prijs: st ? sum(v, r => r.verzonden * r.per_doos * Number(r.prijs_usd)) / st : null,
      bevestigt: bb ? 1 - sum(b, r => Math.max(0, r.besteld - r.bevestigd)) / bb : null, besteld: bb, weken: new Set(x.map(r => r.partij.maandag)).size };
  }).sort((a, b) => (a.product?.volgorde || 0) - (b.product?.volgorde || 0));
  const parts = [
    { key: 'optijd', naam: 'Op tijd binnen', waarde: arrived.length ? 1 - late.length / arrived.length : null, score: grade(arrived.length ? 1 - late.length / arrived.length : null, 0.98, 0.7), gewicht: 30,
      uitleg: arrived.length ? `${arrived.length - late.length} van ${arrived.length} keer maandagochtend in de loods` : '' },
    { key: 'bevestigt', naam: 'Bevestigt wat je bestelt', waarde: bevestigt, score: grade(bevestigt, 0.99, 0.85), gewicht: 15, uitleg: bevestigt != null ? `${pctTxt(1 - bevestigt)} minder bevestigd dan besteld` : '' },
    { key: 'levert', naam: 'Stuurt wat hij bevestigt', waarde: levert, score: grade(levert, 0.995, 0.92), gewicht: 15, uitleg: levert != null ? (levert >= 0.9995 ? 'altijd wat bevestigd was' : `${(100 * (1 - levert)).toFixed(1).replace('.', ',')}% minder verzonden dan bevestigd`) : '' },
    { key: 'telling', naam: 'Telling klopt met de papieren', waarde: telling, score: grade(telling, 0.998, 0.97), gewicht: 10, uitleg: telling != null ? `${(100 * telling).toFixed(1).replace('.', ',')}% klopt in de hal` : '' },
    { key: 'uitval', naam: 'Weinig uitval', waarde: uitval, score: grade(uitval, 0.002, 0.02), gewicht: 10, uitleg: uitval != null ? `${(100 * uitval).toFixed(1).replace('.', ',')}% van de dozen beschadigd` : '' },
    { key: 'papieren', naam: 'Papieren op tijd', waarde: flown.length ? papersOk.length / flown.length : null, score: grade(flown.length ? papersOk.length / flown.length : null, 0.98, 0.7), gewicht: 10,
      uitleg: flown.length ? `${papersOk.length} van ${flown.length} keer voor zaterdagmiddag` : '' },
    { key: 'prijs', naam: 'Prijs tegen de standaard', waarde: prijs, score: grade(prijs, 0.98, 1.1), gewicht: 10, uitleg: prijs != null ? `${prijs >= 1 ? '+' : '−'}${(Math.abs(prijs - 1) * 100).toFixed(1).replace('.', ',')}% tegen de standaard inkoopprijs` : '' },
  ];
  const score = recent.length >= 4 ? total(parts) : null;
  return {
    id: l.id, code: l.code, naam: l.naam, regio: l.regio, regio_naam: l.regio_naam, plaats: l.plaats, contact: l.contact, email: l.email, telefoon: l.telefoon, whatsapp: l.whatsapp, taal: l.taal,
    exact_code: l.exact_code, route: routeOf({ route: l.route, regio: l.regio }), route_tekst: routeText(routeOf({ route: l.route, regio: l.regio })),
    score, label: label(score, 'lev'), parts, zendingen: recent.length, dozen: sum(pr, r => r.verzonden), inkoop_usd: r2(usd),
    omzet: r2(omzet), marge: r2(omzet - kost), marge_pct: omzet ? (omzet - kost) / omzet : null, laat: late.length, binnen: arrived.length,
    producten: perProduct, laatst: mine.length ? mine[mine.length - 1].maandag : null,
    trend: (() => { // the last thirteen against the thirteen before
      const a = mine.filter(p => p.maandag >= D.from13), b = mine.filter(p => p.maandag >= D.from26 && p.maandag < D.from13);
      const lateIn = x => x.filter(p => p.binnen_op && new Date(p.binnen_op) <= D.now && new Date(p.binnen_op) > at(p.maandag, 12)).length;
      return { laat_nu: lateIn(a), laat_voor: lateIn(b), n_nu: a.length, n_voor: b.length };
    })(),
  };
}

export async function supplierStats() {
  const D = await load();
  const list = D.lev.map(l => supplierBasics(D, l));
  const totalUsd = sum(list, s => s.inkoop_usd);
  // who else delivers the same product, and at what price
  const byProduct = new Map();
  for (const s of list) for (const p of s.producten) { if (!byProduct.has(p.product_id)) byProduct.set(p.product_id, []); byProduct.get(p.product_id).push({ lev: s, ...p }); }
  const shortBy = new Map(), askedBy = new Map();
  for (const o of D.short) { shortBy.set(o.product_id, (shortBy.get(o.product_id) || 0) + o.tekort); askedBy.set(o.product_id, (askedBy.get(o.product_id) || 0) + o.dozen); }
  for (const s of list) {
    s.aandeel = totalUsd ? s.inkoop_usd / totalUsd : null;
    const k = [];
    const opTijd = s.parts.find(p => p.key === 'optijd').waarde;
    // customers wanted more of what he grows
    for (const p of s.producten) {
      const t = shortBy.get(p.product_id) || 0, a = askedBy.get(p.product_id) || 0, main = p.product?.leverancier_id === s.id;
      if (main && t >= 10 && a && t / a >= 0.04 && (s.score ?? 0) >= 65) k.push({ soort: 'meer', tekst: `Klanten vroegen een half jaar lang ${t} dozen ${name(p.product)} meer dan er kwam (${pctTxt(t / a)} van wat ze vroegen). ${s.naam} levert betrouwbaar: vraag of hij er structureel meer van kan leveren.`, waarde: t });
    }
    for (const p of s.producten) if (p.bevestigt != null && p.bevestigt < 0.95 && p.besteld >= 40) k.push({ soort: 'let_op', tekst: `Bevestigt van ${name(p.product)} gemiddeld ${pctTxt(1 - p.bevestigt)} minder dan besteld. Bestel ruimer, spreek een vaste hoeveelheid af, of zoek er een tweede leverancier bij.`, waarde: Math.round((1 - p.bevestigt) * 100) });
    // the same product from someone else: one line per other supplier, cheaper or dearer
    const cmp = new Map();
    for (const p of s.producten) {
      if (!p.prijs || p.stuks < 1000) continue;
      for (const o of (byProduct.get(p.product_id) || []).filter(x => x.lev.id !== s.id && x.prijs && x.stuks > 1000)) {
        const d = p.prijs / o.prijs - 1;
        if (Math.abs(d) < 0.02) continue;
        const key = `${o.lev.id}:${d < 0 ? 'min' : 'plus'}`;
        if (!cmp.has(key)) cmp.set(key, { o: o.lev, d: [], names: [] });
        cmp.get(key).d.push(d); cmp.get(key).names.push(name(p.product));
      }
    }
    for (const [key, x] of cmp) {
      const d = x.d.reduce((t, v) => t + v, 0) / x.d.length, oTijd = x.o.parts.find(y => y.key === 'optijd').waarde;
      const what = x.names.length > 1 ? `${x.names.slice(0, -1).join(', ')} en ${x.names[x.names.length - 1]}` : x.names[0];
      if (key.endsWith('min')) k.push({ soort: 'prijs', tekst: `${pctTxt(-d)} goedkoper dan ${x.o.naam} op ${what}${opTijd != null && oTijd != null && opTijd < oTijd - 0.05 ? `, maar vaker te laat (${pctTxt(opTijd)} op tijd tegen ${pctTxt(oTijd)})` : ''}.${opTijd != null && opTijd >= 0.9 ? ' Meer volume hierheen schuiven levert direct marge op.' : ''}`, waarde: Math.round(-d * 100) });
      else k.push({ soort: 'prijs', tekst: `${pctTxt(d)} duurder dan ${x.o.naam} op ${what}${opTijd != null && oTijd != null && opTijd > oTijd + 0.05 ? `, maar betrouwbaarder (${pctTxt(opTijd)} op tijd tegen ${pctTxt(oTijd)})` : ''}. Vraag of hij de prijs kan volgen.`, waarde: Math.round(d * 100) });
    }
    if (s.aandeel != null && s.aandeel >= 0.55) k.push({ soort: 'risico', tekst: `${pctTxt(s.aandeel)} van je inkoop komt van ${s.naam}. Valt hij een week uit, dan mis je het grootste deel. Een tweede leverancier voor zijn belangrijkste producten geeft zekerheid.`, waarde: Math.round(s.aandeel * 100) });
    const only = s.producten.filter(p => (byProduct.get(p.product_id) || []).length === 1 && p.weken >= 4);
    if (only.length) k.push({ soort: 'risico', tekst: `Enige leverancier van ${only.map(p => name(p.product)).join(', ')}.`, waarde: only.length });
    if (s.trend.laat_nu >= 2 && s.trend.laat_nu > s.trend.laat_voor) k.push({ soort: 'let_op', tekst: `Kwam de laatste ${s.trend.n_nu} weken ${s.trend.laat_nu} keer te laat (de ${s.trend.n_voor} weken daarvoor ${s.trend.laat_voor} keer). Vraag hoe dat komt.`, waarde: s.trend.laat_nu });
    if ((s.score ?? 0) >= 85) k.push({ soort: 'meer', tekst: 'Sterke partner: geef hem de groei en vraag naar nieuwe maten of soorten.', waarde: 0 });
    const order = { meer: 0, prijs: 1, let_op: 2, risico: 3 };
    s.kansen = k.sort((a, b) => order[a.soort] - order[b.soort] || b.waarde - a.waarde);
  }
  return list;
}

// ---------------------------------------------------------------- customers
export async function customerStats() {
  const D = await load();
  const activeWeeks = new Set(D.slips.filter(s => s.maandag >= D.from26 && s.maandag < D.focus).map(s => s.maandag));
  const nW = activeWeeks.size || 1;
  const slipsBy = groupBy(D.slips, s => s.klant_id);
  const linesBy = groupBy(D.sregels, x => x.slip.klant_id);
  const shortBy = groupBy(D.short, o => o.klant_id);
  const out = D.kl.map(k => {
    const ss = slipsBy.get(k.id) || [], ls = linesBy.get(k.id) || [];
    const rec = ls.filter(x => x.slip.maandag >= D.from26 && x.slip.maandag < D.focus), prev = ls.filter(x => x.slip.maandag >= D.from52 && x.slip.maandag < D.from26);
    const omzet = sum(rec, x => Number(x.bedrag)), omzetPrev = sum(prev, x => Number(x.bedrag)), kost = sum(rec, x => D.cost(x));
    const weeks = new Set(rec.map(x => x.slip.maandag));
    const products = new Set(rec.map(x => x.product_id));
    const sh = shortBy.get(k.id) || [], asked = sum(sh, o => o.dozen), missed = sum(sh, o => o.tekort);
    const last = ss.length ? ss.reduce((m, s) => (s.maandag > m ? s.maandag : m), '') : null;
    const first = ss.length ? ss.reduce((m, s) => (s.maandag < m ? s.maandag : m), '9999') : null;
    // paying: what was due, when it came in, what is still open
    const due = ss.filter(s => s.vervaldatum < D.today && s.maandag >= D.from52);
    const paid = due.filter(s => s.betaald_op), open = due.filter(s => !s.betaald_op);
    const lateDays = paid.map(s => Math.max(0, days(s.vervaldatum, s.betaald_op)));
    const pay = D.hasPay && due.length ? {
      opTijd: (paid.filter(s => days(s.vervaldatum, s.betaald_op) <= 2).length) / due.length, gemDagen: lateDays.length ? sum(lateDays, d => d) / lateDays.length : 0,
      open: open.length, openBedrag: r2(sum(open, s => Number(s.totaal) * (1 + Number(s.btw_pct || 0) / 100))), oudste: open.length ? Math.max(...open.map(s => days(s.vervaldatum, D.today))) : 0,
    } : null;
    // weeks in a row before the last order, to tell a sleeper from a once-in-a-while buyer
    const before = last ? new Set(ls.filter(x => x.slip.maandag <= last && x.slip.maandag > addDays(last, -7 * 13)).map(x => x.slip.maandag)).size : 0;
    const sinceLast = last ? Math.round(days(last, D.focus) / 7) : null;
    return {
      id: k.id, naam: k.naam, soort: k.soort, plaats: k.plaats, land: k.land, telefoon: k.telefoon, contact: k.contact, taal: k.taal,
      omzet: r2(omzet), omzetPrev: r2(omzetPrev), marge: r2(omzet - kost), marge_pct: omzet ? (omzet - kost) / omzet : null,
      weken: weeks.size, trouw: weeks.size / nW, groei: null, breedte: products.size, producten: [...products],
      levergraad: asked ? 1 - missed / asked : null, tekort: missed, tekortWeken: new Set(sh.filter(o => o.tekort > 0).map(o => o.maandag)).size,
      betalen: pay, laatst: last, sindsLaatst: sinceLast, eerste: first, regelmaatVoor: before,
      perWeek: weeks.size ? omzet / weeks.size : 0,
    };
  });
  // growth with the season taken out: a customer's share of all turnover, now against the half year before
  const tot26 = sum(out, c => c.omzet), totPrev = sum(out, c => c.omzetPrev);
  for (const c of out) c.groei = c.omzetPrev >= 500 && tot26 && totPrev ? (c.omzet / tot26) / (c.omzetPrev / totPrev) - 1 : null;
  // turnover counts as a rank among the customers who bought
  const buyers = out.filter(c => c.omzet > 0).sort((a, b) => a.omzet - b.omzet);
  buyers.forEach((c, i) => { c.rang = buyers.length > 1 ? i / (buyers.length - 1) : 1; c.positie = buyers.length - i; });
  const avgMarge = (() => { const t = sum(out, c => c.omzet); return t ? sum(out, c => c.marge) / t : 0.3; })();
  // what customers like this one usually take
  const segBuyers = groupBy(out.filter(c => c.weken >= 4), c => c.soort);
  const pen = new Map();
  for (const [soort, cs] of segBuyers) {
    const m = new Map();
    for (const c of cs) for (const p of c.producten) m.set(p, (m.get(p) || 0) + 1);
    pen.set(soort, { n: cs.length, per: m, cs });
  }
  const monthly = new Map(); // product -> median boxes per month among its regular buyers
  for (const [pid, xs] of groupBy(D.sregels.filter(x => x.slip.maandag >= D.from26 && x.slip.maandag < D.focus), x => x.product_id)) {
    const per = [...groupBy(xs, x => x.slip.klant_id).values()].map(v => sum(v, x => x.dozen) / 6);
    monthly.set(pid, median(per));
  }
  const nextWeeks = [0, 1, 2, 3].map(i => addDays(D.focus, 7 * i));
  for (const c of out) {
    const parts = [
      { key: 'trouw', naam: 'Trouw', waarde: c.trouw, score: c.omzet ? grade(c.trouw, 0.85, 0.15) : null, gewicht: 25, uitleg: `${c.weken} van de ${nW} weken besteld` },
      { key: 'omzet', naam: 'Omzet', waarde: c.omzet, score: c.omzet ? Math.round((c.rang ?? 0) * 100) : null, gewicht: 20, uitleg: c.omzet ? `nummer ${c.positie} van ${buyers.length} · ${eur(c.omzet)} in een half jaar` : 'een half jaar niets' },
      { key: 'groei', naam: 'Groei', waarde: c.groei, score: grade(c.groei, 0.15, -0.35), gewicht: 15, uitleg: c.groei == null ? 'te nieuw om te vergelijken' : `${c.groei >= 0 ? '+' : '−'}${pctTxt(Math.abs(c.groei))} tegen het halfjaar ervoor, seizoen eruit gehaald` },
      { key: 'marge', naam: 'Marge', waarde: c.marge_pct, score: c.omzet ? grade(c.marge_pct, avgMarge + 0.04, avgMarge - 0.14) : null, gewicht: 15, uitleg: c.marge_pct != null ? `${pctTxt(c.marge_pct)} brutomarge (gemiddeld ${pctTxt(avgMarge)})` : '' },
      { key: 'betalen', naam: 'Betaalt op tijd', waarde: c.betalen?.opTijd ?? null, score: c.betalen ? Math.max(0, (grade(c.betalen.opTijd, 0.95, 0.5) ?? 0) - (c.betalen.oudste > 30 ? 25 : 0)) : null, gewicht: 15,
        uitleg: c.betalen ? `${pctTxt(c.betalen.opTijd)} op tijd${c.betalen.gemDagen >= 1 ? `, gemiddeld ${Math.round(c.betalen.gemDagen)} dagen te laat` : ''}${c.betalen.open ? ` · ${c.betalen.open} open (${eur(c.betalen.openBedrag)})` : ''}` : 'nog geen betaalgegevens' },
      { key: 'breedte', naam: 'Neemt meerdere producten', waarde: c.breedte, score: c.omzet ? grade(c.breedte, 5, 1) : null, gewicht: 10, uitleg: `${c.breedte} ${c.breedte === 1 ? 'product' : 'producten'}` },
    ];
    c.parts = parts;
    c.score = c.omzet ? total(parts) : null;
    c.label = c.omzet ? label(c.score, 'klant') : { naam: c.laatst ? 'Slapend' : 'Nog geen omzet', toon: c.laatst ? 'wait' : '' };
    const tags = [];
    const sleeping = c.sindsLaatst != null && c.sindsLaatst >= 4 && c.regelmaatVoor >= 6;
    if (sleeping) tags.push({ naam: 'slapend', toon: 'wait' });
    if (c.groei != null && c.groei >= 0.25 && c.omzetPrev >= 2000) tags.push({ naam: 'groeit', toon: 'ok' });
    if (c.groei != null && c.groei <= -0.25 && c.omzetPrev >= 2000) tags.push({ naam: 'krimpt', toon: 'wait' });
    if (c.betalen && (c.betalen.gemDagen >= 7 || c.betalen.oudste > 14)) tags.push({ naam: 'betaalt laat', toon: 'bad' });
    if (c.eerste && c.eerste >= D.from13) tags.push({ naam: 'nieuw', toon: 'info' });
    c.tags = tags;
    // ---- where we could serve them more
    const k = [];
    const seg = pen.get(c.soort);
    if (seg && seg.n >= 4 && c.weken >= 3) {
      const miss = [...seg.per.entries()].filter(([pid, n]) => n / seg.n >= 0.4 && !c.producten.includes(pid) && D.P.get(pid)?.actief !== false)
        .map(([pid, n]) => ({ p: D.P.get(pid), n, waarde: (monthly.get(pid) || 0) * (D.P.get(pid)?.per_doos || 0) * Number(D.P.get(pid)?.prijs_usd || 0) / D.koers }))
        .sort((a, b) => b.waarde - a.waarde).slice(0, 2);
      for (const m of miss) k.push({ soort: 'erbij', tekst: `${SOORT_MV[c.soort] || 'Klanten'} zoals deze nemen ook ${name(m.p)} (${m.n} van de ${seg.n}). Bied het aan bij het volgende telefoontje.`, waarde: m.waarde, product_id: m.p.id });
    }
    if (c.levergraad != null && c.levergraad < 0.95 && c.tekort >= 5) {
      const perBox = c.omzet && rec(c) ? c.omzet / rec(c) : 0;
      k.push({ soort: 'tekort', tekst: `Kreeg in ${c.tekortWeken} ${c.tekortWeken === 1 ? 'week' : 'weken'} minder dan hij vroeg, samen ${c.tekort} dozen${perBox ? ` (± ${eur(c.tekort * perBox)} omzet)` : ''}. Bestel voor hem wat ruimer.`, waarde: c.tekort * perBox / 6 });
    }
    if (sleeping) k.push({ soort: 'bellen', tekst: `Bestelde bijna elke week, nu ${c.sindsLaatst} weken niets. Bel even hoe het gaat.`, waarde: c.perWeek * 4 });
    if (c.groei != null && c.groei >= 0.25 && c.omzet >= 2000) k.push({ soort: 'groei', tekst: `Groeit: ${pctTxt(c.groei)} meer dan het halfjaar ervoor, het seizoen eruit gehaald. Stel een vaste weekhoeveelheid voor, dan plan je de inkoop zonder rest.`, waarde: c.omzet * c.groei / 6 });
    // last year around this time
    const ly = D.sregels.filter(x => x.slip.klant_id === c.id && nextWeeks.some(m => x.slip.maandag === addDays(m, -364)));
    const lyBoxes = sum(ly, x => x.dozen);
    const nowAsked = D.orders.filter(o => o.klant_id === c.id && nextWeeks.includes(o.maandag));
    if (lyBoxes >= 8 && !nowAsked.length) {
      const top = [...groupBy(ly, x => x.product_id)].map(([pid, xs]) => ({ p: D.P.get(pid), n: sum(xs, x => x.dozen) })).sort((a, b) => b.n - a.n)[0];
      k.push({ soort: 'seizoen', tekst: `Vorig jaar in week ${isoWeek(nextWeeks[0]).week}–${isoWeek(nextWeeks[3]).week}: ${lyBoxes} dozen${top ? `, vooral ${name(top.p)}` : ''}. Voor die weken staat nog niets genoteerd.`, waarde: sum(ly, x => Number(x.bedrag)) });
    }
    if (c.betalen && (c.betalen.gemDagen >= 7 || c.betalen.oudste > 14)) k.push({ soort: 'risico', tekst: `Betaalt gemiddeld ${Math.round(c.betalen.gemDagen)} dagen na de vervaldatum${c.betalen.open ? `; ${c.betalen.open} ${c.betalen.open === 1 ? 'factuur staat' : 'facturen staan'} open (${eur(c.betalen.openBedrag)})` : ''}. Let op bij grote deals.`, waarde: -1 });
    if (c.groei != null && c.groei <= -0.25 && c.omzetPrev >= 2000) k.push({ soort: 'risico', tekst: `Neemt ${pctTxt(-c.groei)} minder dan het halfjaar ervoor, het seizoen eruit gehaald. Vraag waarom: prijs, kwaliteit of een andere leverancier?`, waarde: -1 });
    const order = { bellen: 0, seizoen: 1, tekort: 2, erbij: 3, groei: 4, risico: 9 };
    c.kansen = k.sort((a, b) => order[a.soort] - order[b.soort] || b.waarde - a.waarde);
    c.waarde = sum(c.kansen.filter(x => x.waarde > 0), x => x.waarde);
    delete c.producten;
  }
  function rec(c) { return sum(D.sregels.filter(x => x.slip.klant_id === c.id && x.slip.maandag >= D.from26 && x.slip.maandag < D.focus), x => x.dozen); }
  return { klanten: out, weken: nW, gemMarge: avgMarge, D };
}

// ---------------------------------------------------------------- where to look for new customers and suppliers
function insights(D, klanten, leveranciers) {
  const k = [], l = [];
  const act = klanten.filter(c => c.omzet > 0);
  const tot = sum(act, c => c.omzet), totPrev = sum(klanten, c => c.omzetPrev);
  const seg = [...groupBy(act, c => c.soort)].map(([soort, cs]) => ({ soort, n: cs.length, omzet: sum(cs, c => c.omzet), marge: sum(cs, c => c.marge), prev: sum(klanten.filter(c => c.soort === soort), c => c.omzetPrev) }))
    .map(s => ({ ...s, pct: s.omzet ? s.marge / s.omzet : 0, perKlant: s.omzet / s.n, groei: s.prev >= 1000 ? s.omzet / s.prev - 1 : null }));
  const avg = tot ? sum(act, c => c.marge) / tot : 0;
  const bestM = seg.filter(s => s.n >= 3).sort((a, b) => b.pct - a.pct)[0];
  if (bestM && bestM.pct > avg + 0.01) k.push({ titel: `${SOORT_MV[bestM.soort]}: de hoogste marge`, tekst: `${pctTxt(bestM.pct)} brutomarge tegen ${pctTxt(avg)} gemiddeld. Je hebt er ${bestM.n}. ${['tuincentrum', 'interieur'].includes(bestM.soort) ? 'Elk' : 'Elke'} ${SOORT_EEN[bestM.soort] || 'klant'} erbij verdient meer per doos.`, segment: bestM.soort });
  const main = seg.filter(s => s.n >= 3).sort((a, b) => b.n - a.n)[0], big = seg.filter(s => s.n >= 3).sort((a, b) => b.perKlant - a.perKlant)[0];
  if (big && main && big !== main && big.perKlant > main.perKlant * 1.5) k.push({ titel: `${SOORT_MV[big.soort]} nemen het meest per klant`, tekst: `Gemiddeld ${eur(big.perKlant / W)} per week tegen ${eur(main.perKlant / W)} bij ${(SOORT_MV[main.soort] || '').toLowerCase()}. Eén ${SOORT_EEN[big.soort] || big.soort} erbij brengt evenveel als ${Math.round(big.perKlant / main.perKlant)} ${(SOORT_MV[main.soort] || 'klanten').toLowerCase()}.`, segment: big.soort });
  // a country's share of the turnover, now against the half year before (the season is the same for all)
  const land = [...groupBy(act, c => c.land)].map(([code, cs]) => ({ code, n: cs.length, omzet: sum(cs, c => c.omzet), prev: sum(klanten.filter(c => c.land === code), c => c.omzetPrev) }))
    .map(x => ({ ...x, aandeel: tot ? x.omzet / tot : 0, groei: x.prev >= 1000 && totPrev && tot ? (x.omzet / tot) / (x.prev / totPrev) - 1 : null }));
  const grow = land.filter(x => x.n >= 2 && x.groei != null && x.code !== 'NL').sort((a, b) => b.groei - a.groei)[0];
  if (grow && grow.groei > 0.08) k.push({ titel: `${LANDNAAM[grow.code] || grow.code} groeit het hardst`, tekst: `Het aandeel in je omzet groeide ${pctTxt(grow.groei)} tegen het halfjaar ervoor, met ${grow.n} klanten (nu ${pctTxt(grow.aandeel)} van de omzet). Daar is ruimte voor meer.`, land: grow.code });
  const thin = land.filter(x => x.n >= 2 && x.aandeel < 0.05 && x.code !== 'NL' && x !== grow).sort((a, b) => b.omzet / b.n - a.omzet / a.n)[0];
  if (thin) k.push({ titel: `Weinig klanten in ${LANDNAAM[thin.code] || thin.code}`, tekst: `${thin.n} klanten, ${pctTxt(thin.aandeel)} van de omzet. De factuur in hun taal en de verlegde btw staan al klaar: een nieuwe klant daar kost geen extra werk.`, land: thin.code });
  const top = act.filter(c => c.label?.naam === 'Topklant');
  if (top.length && tot) k.push({ titel: `${top.length} topklanten doen ${pctTxt(sum(top, c => c.omzet) / tot)} van de omzet`, tekst: `${top.slice(0, 4).map(c => c.naam).join(', ')}. Klanten die op hen lijken zijn de beste nieuwe klanten.`, meta: true });
  // suppliers: one source, shortages, one region
  const byProduct = new Map();
  for (const s of leveranciers) for (const p of s.producten) if (p.weken >= 4) { if (!byProduct.has(p.product_id)) byProduct.set(p.product_id, []); byProduct.get(p.product_id).push(s); }
  const single = groupBy([...byProduct].filter(([, ss]) => ss.length === 1), ([, ss]) => ss[0].id);
  for (const [lid, ps] of single) {
    const s = leveranciers.find(x => x.id === lid);
    const weak = s.producten.filter(p => ps.some(([pid]) => pid === p.product_id) && p.bevestigt != null && p.bevestigt < 0.96);
    l.push({ titel: `Alleen ${s.naam} levert ${[...new Set(ps.map(([pid]) => D.P.get(pid)?.naam))].join(', ').toLowerCase()}`, tekst: `${ps.map(([pid]) => name(D.P.get(pid))).join(', ')}.${weak.length ? ` Hij bevestigt daarvan ${pctTxt(1 - Math.min(...weak.map(p => p.bevestigt)))} minder dan besteld.` : ''} Een tweede leverancier in ${s.regio_naam || s.regio} maakt je minder afhankelijk${weak.length ? ' en haalt het tekort weg' : ''}.`, leverancier_id: lid });
  }
  const sh = [...groupBy(D.short, o => o.product_id)].map(([pid, os]) => ({ p: D.P.get(pid), tekort: sum(os, o => o.tekort), gevraagd: sum(os, o => o.dozen) })).filter(x => x.tekort >= 15 && x.tekort / x.gevraagd >= 0.04).sort((a, b) => b.tekort - a.tekort)[0];
  if (sh) l.push({ titel: `Er kwam te weinig ${sh.p.naam.toLowerCase()} ${sh.p.maat}`, tekst: `Klanten vroegen een half jaar lang ${sh.tekort} dozen meer dan er kwam (${pctTxt(sh.tekort / sh.gevraagd)} van wat ze vroegen). Een leverancier die dit kan bijleveren verkoopt zichzelf.`, product_id: sh.p.id });
  const reg = [...groupBy(leveranciers, s => s.regio)].map(([code, ss]) => ({ code, naam: ss[0].regio_naam, dozen: sum(ss, s => s.dozen) }));
  const allBoxes = sum(reg, r => r.dozen), topReg = reg.sort((a, b) => b.dozen - a.dozen)[0];
  if (topReg && allBoxes && topReg.dozen / allBoxes >= 0.75) l.push({ titel: `${pctTxt(topReg.dozen / allBoxes)} komt uit ${topReg.naam || topReg.code}`, tekst: 'Eén regio, één vlucht naar Schiphol. Een aswolk, een staking of een storm daar raakt bijna alles. Een tweede regio spreidt het risico van de route.' });
  return { klanten: k, leveranciers: l };
}

export async function relations() {
  const [leveranciers, c] = await Promise.all([supplierStats(), customerStats()]);
  const tot = sum(c.klanten, x => x.omzet);
  const top = c.klanten.filter(x => x.label.naam === 'Topklant');
  return {
    focus: c.D.focus, week: isoWeek(c.D.focus).week, weken: c.weken, gemMarge: c.gemMarge, betaalGegevens: c.D.hasPay,
    klanten: c.klanten.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.omzet - a.omzet),
    leveranciers: leveranciers.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    samen: {
      omzet: r2(tot), marge: r2(sum(c.klanten, x => x.marge)), top: top.length, topAandeel: tot ? sum(top, x => x.omzet) / tot : 0,
      groeiers: c.klanten.filter(x => x.tags.some(t => t.naam === 'groeit')).length, slapend: c.klanten.filter(x => x.tags.some(t => t.naam === 'slapend')).length,
      laat: c.klanten.filter(x => x.tags.some(t => t.naam === 'betaalt laat')).length, kansen: c.klanten.filter(x => x.kansen.some(k => k.soort !== 'risico')).length,
    },
    inzichten: insights(c.D, c.klanten, leveranciers),
  };
}

export async function customerAnalysis(id) {
  const c = await customerStats();
  return c.klanten.find(x => x.id === id) || null;
}

// ---------------------------------------------------------------- deals: one to one, nothing left in the hall
async function regularBuyers(D, productId, { exclude = new Set(), weeksBack = 13 } = {}) {
  const from = addDays(D.focus, -7 * weeksBack);
  const xs = D.sregels.filter(x => x.product_id === productId && x.slip.maandag >= from && x.slip.maandag < D.focus);
  return [...groupBy(xs, x => x.slip.klant_id)].map(([kid, ls]) => {
    const perWeek = [...groupBy(ls, x => x.slip.maandag).values()].map(v => sum(v, x => x.dozen));
    return { klant_id: kid, weken: perWeek.length, gewoon: Math.max(1, Math.round(median(perWeek))), laatst: ls.reduce((m, x) => (x.slip.maandag > m ? x.slip.maandag : m), '') };
  }).filter(b => b.weken >= 3 && !exclude.has(b.klant_id));
}

export async function deals(maandag, { now = new Date() } = {}) {
  const [c, sup] = await Promise.all([customerStats(), supplierStats()]);
  const D = c.D, C = new Map(c.klanten.map(x => [x.id, x]));
  const S = new Map(sup.map(s => [s.id, s]));
  const reliable = x => !x || !x.tags.some(t => t.naam === 'betaalt laat');
  const rank = (a, b) => (reliable(C.get(b.klant_id)) - reliable(C.get(a.klant_id))) || ((C.get(b.klant_id)?.score ?? 0) - (C.get(a.klant_id)?.score ?? 0)) || b.gewoon - a.gewoon;
  const offers = await rows(`SELECT a.*, l.naam AS leverancier, l.regio, l.contact AS lev_contact, l.email AS lev_email, l.whatsapp AS lev_whatsapp
    FROM leverancier_aanbod a JOIN leveranciers l ON l.id = a.leverancier_id WHERE a.maandag = $1 AND a.ontvangen <= $2 ORDER BY a.ontvangen`, [maandag, now]);
  const sold = offers.length ? await rows('SELECT aanbod_id, klant_id, dozen, op FROM aanbod_verkoop WHERE aanbod_id = ANY($1)', [offers.map(o => o.id)]) : [];
  const ordersNow = await rows('SELECT klant_id, product_id, dozen FROM weekorders WHERE maandag = $1 AND aangemaakt <= $2', [maandag, now]);
  const lockedNow = new Set((await rows(`SELECT klant_id FROM pakbonnen WHERE maandag = $1 AND status = 'akkoord'`, [maandag])).map(r => r.klant_id));
  const orderOf = (kid, pid) => ordersNow.find(o => o.klant_id === kid && o.product_id === pid)?.dozen || 0;
  const out = [];
  for (const a of offers) {
    const p = D.P.get(a.product_id);
    if (!p) continue;
    const mine = sold.filter(s => s.aanbod_id === a.id).map(s => ({ ...s, dozen: Math.min(s.dozen, orderOf(s.klant_id, a.product_id)) })).filter(s => s.dozen > 0);
    const taken = sum(mine, s => s.dozen);
    let left = Math.max(0, a.dozen - taken);
    const buyers = mine.map(s => ({ klant_id: s.klant_id, dozen: s.dozen, genoteerd: true }));
    const cands = (await regularBuyers(D, a.product_id, { exclude: new Set([...mine.map(s => s.klant_id), ...lockedNow]) })).sort(rank);
    for (const b of cands) {
      if (left <= 0) break;
      const n = Math.min(b.gewoon, left);
      buyers.push({ klant_id: b.klant_id, dozen: n, gewoon: b.gewoon, weken: b.weken, laatst: b.laatst, al: orderOf(b.klant_id, a.product_id) });
      left -= n;
    }
    const lines = buyers.map(b => {
      const k = C.get(b.klant_id), pu = D.priceFor(b.klant_id, a.product_id), stuks = b.dozen * p.per_doos;
      return { ...b, klant: k?.naam, plaats: k?.plaats, land: k?.land, telefoon: k?.telefoon, contact: k?.contact, score: k?.score ?? null, label: k?.label, betaaltLaat: k ? !reliable(k) : false,
        prijs_usd: pu, omzet_usd: r2(stuks * pu), marge_usd: r2(stuks * (pu - Number(a.prijs_usd))) };
    });
    const omzet = sum(lines, l => l.omzet_usd), marge = sum(lines, l => l.marge_usd);
    const normaal = Number(p.inkoop_usd || 0), voordeel = r2(a.dozen * p.per_doos * Math.max(0, normaal - Number(a.prijs_usd)));
    const s = S.get(a.leverancier_id);
    const checks = [
      { ok: left === 0, tekst: left === 0 ? 'Alles heeft een koper' : `${left} ${left === 1 ? 'doos' : 'dozen'} nog zonder koper` },
      { ok: omzet > 0 && marge / omzet >= 0.25, tekst: omzet ? `${pctTxt(marge / omzet)} marge` : 'Nog geen koper' },
      { ok: lines.every(l => !l.betaaltLaat), tekst: lines.some(l => l.betaaltLaat) ? `${lines.filter(l => l.betaaltLaat).length} koper betaalt laat` : 'Kopers betalen op tijd' },
      { ok: (s?.score ?? 0) >= 70, tekst: s ? `${s.naam.split(' ').slice(0, 2).join(' ')}: ${s.label.naam.toLowerCase()} (${s.score ?? '–'})` : 'Leverancier onbekend' },
    ];
    out.push({
      soort: 'aanbod', id: a.id, status: a.status, leverancier_id: a.leverancier_id, leverancier: a.leverancier, regio: a.regio, lev_contact: a.lev_contact, lev_email: a.lev_email, lev_whatsapp: a.lev_whatsapp,
      product_id: p.id, product: p.naam, maat: p.maat, soort_plant: p.soort, per_doos: p.per_doos, dozen: a.dozen, prijs_usd: Number(a.prijs_usd), normaal_usd: normaal, lijst_usd: Number(p.prijs_usd),
      notitie: a.notitie, ontvangen: a.ontvangen, geldig_tot: a.geldig_tot, genomen_dozen: a.genomen_dozen,
      kopers: lines, rest: left, genoteerd: taken, omzet_usd: r2(omzet), marge_usd: r2(marge), marge_eur: r2(marge / D.koers), voordeel_usd: voordeel, marge_pct: omzet ? marge / omzet : null,
      checks, goed: checks.every(x => x.ok), koers: D.koers,
    });
  }
  out.sort((a, b) => (a.status === 'afgewezen') - (b.status === 'afgewezen') || b.marge_eur - a.marge_eur);
  return { maandag, week: isoWeek(maandag).week, koers: D.koers, deals: out };
}

// boxes already on their way for the coming Monday that have no buyer yet (Jan ordered a little extra, the supplier sent more)
export async function onTheWay(d) {
  const c = await customerStats();
  const D = c.D, C = new Map(c.klanten.map(x => [x.id, x]));
  const locked = new Set(d.slips.filter(s => s.status === 'akkoord').map(s => s.klant_id));
  const byProduct = groupBy(d.regels.filter(r => r.rest > 0), r => r.product_id);
  const out = [];
  for (const [pid, lines] of byProduct) {
    const p = D.P.get(pid);
    if (!p) continue;
    let left = sum(lines, r => r.rest);
    const total_ = left;
    const asked = new Map(d.orders.filter(o => o.product_id === pid).map(o => [o.klant_id, o.dozen]));
    const cands = (await regularBuyers(D, pid, { exclude: locked }))
      .map(b => ({ ...b, al: asked.get(b.klant_id) || 0 })).filter(b => b.al < b.gewoon)
      .sort((a, b) => ((C.get(b.klant_id)?.score ?? 0) - (C.get(a.klant_id)?.score ?? 0)) || b.gewoon - a.gewoon);
    const kopers = [];
    for (const b of cands) {
      if (left <= 0) break;
      const n = Math.min(b.gewoon - b.al, left);
      const k = C.get(b.klant_id), pu = D.priceFor(b.klant_id, pid);
      kopers.push({ klant_id: b.klant_id, klant: k?.naam, plaats: k?.plaats, land: k?.land, telefoon: k?.telefoon, contact: k?.contact, dozen: n, al: b.al, gewoon: b.gewoon, weken: b.weken,
        score: k?.score ?? null, label: k?.label, betaaltLaat: k ? k.tags.some(t => t.naam === 'betaalt laat') : false, prijs_usd: pu, omzet_usd: r2(n * p.per_doos * pu) });
      left -= n;
    }
    const prijsIn = sum(lines, r => r.rest * Number(r.prijs_usd)) / total_;
    const omzet = sum(kopers, k => k.omzet_usd);
    out.push({
      soort: 'onderweg', product_id: pid, product: p.naam, maat: p.maat, per_doos: p.per_doos, dozen: total_, rest: left, partijen: lines.map(r => ({ nummer: r.nummer, rest: r.rest, regio: r.regio })),
      kopers, omzet_usd: r2(omzet), omzet_eur: r2(omzet / (d.koers || D.koers)), marge_usd: r2(omzet - sum(kopers, k => k.dozen * p.per_doos) * prijsIn), koers: d.koers || D.koers,
    });
  }
  return out.sort((a, b) => b.omzet_eur - a.omzet_eur);
}

// ---------------------------------------------------------------- leads
export async function leads() {
  const [lev, c, list] = await Promise.all([supplierStats(), customerStats(), rows(`SELECT * FROM kansen ORDER BY CASE status WHEN 'nieuw' THEN 0 WHEN 'benaderd' THEN 1 WHEN 'in_gesprek' THEN 2 WHEN 'klant' THEN 3 ELSE 4 END, bijgewerkt DESC`)]);
  return { kansen: list, inzichten: insights(c.D, c.klanten, lev) };
}

// ---------------------------------------------------------------- one supplier, for his page
export async function supplierStat(id) {
  const all = await supplierStats();
  return all.find(s => s.id === id) || null;
}

// the shipments of one supplier, newest first, as Jan would check them
export async function supplierHistory(id, { limit = 26, now = new Date() } = {}) {
  const ps = await rows(`SELECT p.id, p.nummer, p.maandag, p.regio, p.besteld_op, p.bevestigd_op, p.verzonden_op, p.binnen_op, p.exact, p.exact_nummer,
      sum(r.besteld) AS besteld, sum(r.bevestigd) AS bevestigd, sum(r.verzonden) AS verzonden, sum(r.geteld) AS geteld, sum(r.uitval) AS uitval,
      sum(coalesce(r.verzonden, r.bevestigd, r.besteld, 0) * r.per_doos * r.prijs_usd) AS usd
    FROM partijen p JOIN partij_regels r ON r.partij_id = p.id WHERE p.leverancier_id = $1 AND p.besteld_op <= $3 GROUP BY p.id ORDER BY p.maandag DESC LIMIT $2`, [id, limit, now]);
  return ps.map(p => {
    const bev = passed(p.bevestigd_op, now), verz = passed(p.verzonden_op, now), binnen = passed(p.binnen_op, now);
    return { ...p, week: isoWeek(p.maandag).week, bevestigd: bev ? p.bevestigd : null, verzonden: verz ? p.verzonden : null, binnen_op: binnen ? p.binnen_op : null,
      geteld: binnen ? p.geteld : null, op_tijd: binnen ? new Date(p.binnen_op) <= at(p.maandag, 12) : null, usd: r2(p.usd) };
  });
}

