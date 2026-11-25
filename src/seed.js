// Demo data: fifteen months of a plant wholesaler, ending today, generated the same way every time.
// Every row the seed makes is fictional. Growers, plants and customers are marked bron = 'demo',
// so "Demo-data verwijderen" removes all of it in one go (everything else cascades).
import crypto from 'node:crypto';
import { pool } from './db.js';
import { PLANTS, GROWERS, CUSTOMERS, growerName, COLOR_EN } from './demo/catalog.js';
import { deliveryMessage, offerMessage } from './messages.js';
import { invoicePdf } from './pdf.js';

const DAY = 864e5;
const MIN = 6e4;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export async function seedDemo({ days = 450, seed = 20261125, now = new Date() } = {}) {
  const r = rng(seed);
  const R = (a, b) => a + (b - a) * r();
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const pick = arr => arr[Math.floor(r() * arr.length)];
  const wpick = (items, w) => { const s = w.reduce((x, y) => x + y, 0); let v = r() * s; for (let i = 0; i < items.length; i++) { v -= w[i]; if (v <= 0) return items[i]; } return items[items.length - 1]; };
  const expo = mean => -Math.log(1 - r()) * mean;
  const gauss = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  const midnight = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const TODAY = midnight(now);
  const dayN = n => { const x = new Date(TODAY); x.setDate(x.getDate() + n); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setMinutes(Math.round(h * 60 + m)); return x; };
  const addMin = (d, m) => new Date(d.getTime() + Math.round(m) * MIN);
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dow = d => ((d.getDay() + 6) % 7) + 1;
  const dayDiff = (a, b) => Math.round((midnight(b) - midnight(a)) / DAY);
  const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const round2 = v => Math.round(v * 100) / 100;
  const round3 = v => Math.round(v * 1000) / 1000;
  const yy = d => String(d.getFullYear()).slice(2);

  // ---------- catalogue with ids
  // colour variants are plants of their own: an invoice line is always one colour
  const plants = [];
  for (const b of PLANTS) {
    if (b.kleuren) for (const k of b.kleuren) plants.push({ ...b, code: `${b.code}-${k}`, base: b.code, kleur: k, basenaam: b.naam, naam: `${b.naam} ${k}`, en: `${b.en} ${COLOR_EN[k]}` });
    else plants.push({ ...b, base: b.code });
  }
  plants.forEach((p, i) => { p.id = i + 1; p.eenheid = p.eenheid || 'stuks'; });
  const P = Object.fromEntries(plants.map(p => [p.code, p]));
  const FAM = {};
  for (const p of plants) (FAM[p.base] = FAM[p.base] || []).push(p);
  const growers = GROWERS.map((g, i) => ({ ...g, id: i + 1, seq: 1000 + i * 137 }));
  const G = Object.fromEntries(growers.map(g => [g.code, g]));
  const customers = CUSTOMERS.map((c, i) => ({ ...c, id: i + 1 }));
  const inSeason = (p, d) => !p.seizoen || p.seizoen.includes(d.getMonth() + 1);
  const growersFor = code => growers.filter(g => g.assort[P[code] ? P[code].base : code] != null);

  const windowStart = c => {
    const m = String(c.levervenster || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) return 9;
    let h = Number(m[1]) + Number(m[2]) / 60;
    if (/vóór|voor/.test(c.levervenster)) h = Math.max(5, h - 2);
    return h;
  };

  // ---------- customer orders
  const orders = [];
  const START = dayN(-days);
  const lead = c => (c.reistijd < 120 ? RI(1, 2) : c.reistijd < 700 ? RI(2, 3) : RI(3, 4));
  function nextDeliveryDay(c, d) {
    let x = new Date(d);
    for (let i = 0; i < 7; i++) { if (!c.leverdagen || c.leverdagen.includes(dow(x))) return x; x = addDays(x, 1); }
    return x;
  }
  function planOrder(c, gewenst) {
    // when it has to leave Nootdorp to arrive at the start of the customer's window
    const arrive = at(gewenst, windowStart(c));
    const vertrek = addMin(arrive, -(c.reistijd + 30));
    // goods come in from the growers in the morning; an early departure means they came in the day before
    let V = midnight(addDays(vertrek, vertrek.getHours() < 11 ? -1 : 0));
    // Jan buys in on Monday, Tuesday, Thursday and Friday; the cooler bridges the other days
    while ([3, 6, 7].includes(dow(V))) V = addDays(V, -1);
    return { arrive, vertrek, V };
  }
  function makeLines(c, gewenst, n) {
    const yearsAgo = dayDiff(gewenst, TODAY) / 365;
    const growth = Math.max(0.35, 1 - c.trend * yearsAgo);
    const pool_ = c.mix.filter(code => inSeason(FAM[code][0], gewenst));
    const use = (pool_.length ? pool_ : c.mix.filter(code => !FAM[code][0].seizoen)).slice();
    const out = [];
    const k = Math.min(use.length, n || 2 + Math.floor(r() * 3) + (r() < 0.3 ? 1 : 0));
    for (let i = 0; i < k && use.length; i++) {
      const fam = use.splice(Math.floor(r() * use.length), 1)[0], b = FAM[fam][0];
      const peak = b.piek && b.piek.includes(gewenst.getMonth() + 1) ? 1.45 : 1;
      const total = (b.qty[0] + r() * (b.qty[1] - b.qty[0])) * c.vol * growth * peak;
      const allowed = FAM[fam].filter(p => !p.kleur || !c.kleur || !c.kleur[fam] || c.kleur[fam].includes(p.kleur));
      const colours = allowed.slice().sort(() => r() - 0.5).slice(0, Math.max(1, Math.min(allowed.length, 1 + Math.floor(r() * 3))));
      for (const p of colours) {
        const q = Math.max(p.per_laag, Math.round(total / colours.length / p.per_laag) * p.per_laag);
        const prijs = round2(p.verkoopprijs * (1 + c.adj) * (peak > 1 ? 1.12 : 1) * (1 + R(-0.02, 0.02)));
        out.push({ plant: p, aantal: q, prijs });
      }
    }
    return out;
  }
  for (const c of customers) {
    const since = new Date(c.sinds, 0, 1);
    let t = addDays(since > START ? since : START, Math.floor(r() * c.every));
    const end = c.stopped ? dayN(-c.stopped) : c.pauze ? dayN(-c.pauze) : dayN(2);
    while (t <= end) {
      const dec = t.getMonth() === 11 && ['bloemist', 'tuincentrum', 'groothandel'].includes(c.soort) ? 0.8 : 1;
      const gewenst = nextDeliveryDay(c, addDays(t, lead(c)));
      const plan = planOrder(c, gewenst);
      if (plan.V >= START) {
        // orders come in on working days; a weekend order is placed on the Friday before
        let od = new Date(t); while (dow(od) > 5) od = addDays(od, -1);
        orders.push({ klant: c, besteld_op: at(od, R(7, 17.5)), gewenst, ...plan, lines: makeLines(c, gewenst), kanaal: c.kanaal === 'telefoon' ? 'telefoon' : c.kanaal });
      }
      t = addDays(t, Math.max(3, Math.round(c.every * dec * (0.75 + r() * 0.5))));
    }
  }
  // a full board today and tomorrow, whatever the weekday
  const active = customers.filter(c => !c.stopped && !c.pauze);
  for (const [d, want] of [[0, 12], [1, 9]]) {
    const V = dayN(d);
    let have = orders.filter(o => +o.V === +V).length;
    const shuffled = active.slice().sort(() => r() - 0.5);
    for (const c of shuffled) {
      if (have >= want) break;
      if (orders.some(o => o.klant === c && +o.V === +V)) continue;
      // work back from the day it has to leave
      const vert = at(V, c.reistijd > 400 ? R(16.5, 19) : R(11.5, 15.5));
      const arrive = addMin(vert, c.reistijd + 30);
      orders.push({ klant: c, besteld_op: at(addDays(V, -RI(1, 3)), R(8, 17)), gewenst: midnight(arrive), arrive, vertrek: vert, V, lines: makeLines(c, midnight(arrive), RI(2, 4)), kanaal: c.kanaal === 'telefoon' ? 'telefoon' : c.kanaal });
      have++;
    }
  }
  // orders further ahead than tomorrow are not bought yet
  const bought = orders.filter(o => o.V <= dayN(1));
  const later = orders.filter(o => o.V > dayN(1));
  orders.sort((a, b) => a.besteld_op - b.besteld_op);
  const perYear = {};
  orders.forEach((o, i) => {
    o.id = i + 1;
    const y = yy(o.besteld_op); perYear[y] = (perYear[y] || 0) + 1;
    o.nummer = `CI-${y}-${String(perYear[y] + 100).padStart(4, '0')}`;
  });
  let olId = 0;
  orders.forEach(o => o.lines.forEach(l => { l.id = ++olId; l.order = o; }));

  // ---------- buying: one invoice per grower per day, lines per plant, often for several customers
  const invoices = [];
  const byDay = new Map();
  for (const o of bought) { const k = +o.V; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(o); }
  const days_ = [...byDay.keys()].sort((a, b) => a - b);
  const stickyGrower = {};
  for (const k of days_) {
    const V = new Date(k);
    const need = new Map(); // grower -> plant code -> [order lines]
    for (const o of byDay.get(k)) for (const l of o.lines) {
      const cands = growersFor(l.plant.code);
      const deliver = cands.filter(g => g.levert.includes(dow(V)));
      const use = deliver.length ? deliver : cands;
      const prev = stickyGrower[l.plant.base];
      const g = prev && use.includes(prev) && r() < 0.88 ? prev : wpick(use, use.map(g => Math.pow(1 / g.assort[l.plant.base], 6) * g.profile.onTime));
      stickyGrower[l.plant.base] = g;
      if (!need.has(g)) need.set(g, new Map());
      const m = need.get(g); if (!m.has(l.plant.code)) m.set(l.plant.code, []); m.get(l.plant.code).push(l);
    }
    for (const [g, m] of need) {
      g.seq += 1 + (r() < 0.3 ? RI(1, 4) : 0);
      const nummer = ['ZH-', 'HH-', 'GL-', 'NSF-'].includes(g.prefix) ? `${g.prefix}${g.seq}` : ['WG-', 'KV-'].includes(g.prefix) ? `${g.prefix}${80000 + g.seq * 3}` : `${g.prefix}${yy(V)}-${String(g.seq).padStart(4, '0')}`;
      const inv = { id: invoices.length + 1, kweker: g, nummer, datum: V, regels: [], verval: addDays(V, g.land === 'NL' ? 14 : 30) };
      let nr = 0;
      for (const [code, ls] of m) {
        const p = P[code];
        const total = ls.reduce((s, l) => s + l.aantal, 0);
        let besteld = Math.ceil(total / p.per_laag) * p.per_laag;
        if (r() < 0.32) besteld += p.per_laag * (p.per_laag <= 8 ? RI(1, 3) : 1);
        let aantal = besteld;
        let short = 0;
        if (r() < g.profile.short) { short = Math.min(besteld - p.per_laag, Math.max(p.per_laag, Math.round(besteld * R(0.05, 0.25) / p.per_laag) * p.per_laag)); if (short > 0) aantal = besteld - short; else short = 0; }
        const yearsAgo = dayDiff(V, TODAY) / 365;
        const peak = p.piek && p.piek.includes(V.getMonth() + 1) ? 1.14 : 1;
        const afgesproken = round3(p.verkoopprijs * g.assort[p.base] * (1 - g.profile.drift * yearsAgo) * peak * (1 + R(-0.025, 0.025)));
        const over = r() < 0.04;
        const prijs = over ? round3(afgesproken * R(1.04, 1.09)) : afgesproken;
        const refs = [...new Set(ls.map(l => l.order.klant.naam.split(' ').slice(-1)[0]))];
        const ref = ['leeuwen', 'westland', 'pater'].includes(g.code) && ls.length === 1 && r() < 0.7 ? `${ls[0].order.nummer} ${refs[0]}` : null;
        inv.regels.push({ regelnr: ++nr, plant: p, omschrijving: growerName(g.style, p), aantal, besteld, prijs, afgesproken, klant_ref: ref, lines: ls, short, over });
      }
      invoices.push(inv);
    }
  }

  // ---------- inbound trucks: when they left, when they should arrive, when they did
  const zendingen = [], events = [], afwijkingen = [];
  const LATE_WHY = ['file op de A4', 'file op de A13', 'later geladen door een extra kar', 'wachten bij de keuring', 'omgereden door een afsluiting', 'chauffeur later begonnen', 'koelwagen even nagekeken'];
  for (const inv of invoices) {
    const g = inv.kweker, V = inv.datum;
    let arrPlan;
    if (g.code === 'naivasha') arrPlan = at(V, R(9.5, 12.5));
    else if (g.reistijd > 600) arrPlan = at(V, R(5.75, 7.25));
    else { const [lh, lm] = g.laadtijd.split(':').map(Number); arrPlan = addMin(at(V, lh, lm), g.reistijd + R(15, 330)); }
    arrPlan = new Date(Math.round(arrPlan / (5 * MIN)) * 5 * MIN);
    const depPlan = addMin(arrPlan, -g.reistijd);
    const onTime = r() < g.profile.onTime;
    const delay = onTime ? Math.max(-10, Math.min(12, Math.round(gauss() * 6))) : Math.round(15 + expo(g.profile.late));
    const depReal = addMin(depPlan, Math.max(-10, delay * R(0.2, 0.7) + R(-5, 8)));
    let arrReal = addMin(arrPlan, delay);
    if (arrReal < addMin(depReal, g.reistijd * 0.85)) arrReal = addMin(depReal, Math.round(g.reistijd * R(0.9, 1.05)));
    const delayReal = Math.round((arrReal - arrPlan) / MIN);
    const z = { id: zendingen.length + 1, inv, kweker: g, vervoerder: g.vervoer, karren: Math.max(0.5, Math.round(inv.regels.reduce((s, x) => s + x.aantal / (x.plant.per_kar || 200), 0) * 2) / 2), vertrek_gepland: depPlan, vertrek_werkelijk: depReal, aankomst_gepland: arrPlan, aankomst_werkelijk: arrReal, delay: delayReal };
    zendingen.push(z); inv.zending = z;
    const src = g.code === 'naivasha' ? 'vervoerder' : 'whatsapp';
    events.push({ z, tijd: addMin(depReal, -RI(12, 30)), soort: 'geladen', plaats: g.plaats, tekst: `Geladen bij ${g.naam}`, bron: src });
    const firstEta = addMin(arrPlan, Math.min(delayReal, 8));
    events.push({ z, tijd: depReal, soort: 'vertrokken', plaats: g.plaats, eta: firstEta, tekst: g.code === 'naivasha' ? 'Vlucht vertrokken uit Nairobi' : `Onderweg, verwacht ${hhmm(firstEta)}`, bron: src, whatsapp: g.code !== 'naivasha' });
    if (delayReal >= 20) {
      const why = g.code === 'naivasha' ? 'afhandeling op Schiphol duurt langer' : pick(LATE_WHY);
      events.push({ z, tijd: addMin(arrPlan, -RI(20, 45)), soort: 'vertraging', plaats: g.code === 'naivasha' ? 'Schiphol' : 'onderweg', eta: arrReal, tekst: `Vertraging: ${why}. Nieuwe tijd ${hhmm(arrReal)}.`, bron: src, whatsapp: g.code !== 'naivasha', why });
    }
    events.push({ z, tijd: arrReal, soort: 'aangekomen', plaats: 'Campo, Nootdorp', tekst: 'Binnen bij Campo', bron: 'jan' });
    if (delayReal > 30) afwijkingen.push({ inv, soort: 'te_laat', tekst: `${delayReal} minuten later dan afgesproken binnen`, gemeld_op: arrReal });
  }

  // ---------- outbound: one delivery per customer order
  const leveringen = [];
  const ordersById = new Map(bought.map(o => [o.id, o]));
  for (const o of bought) {
    const supplying = invoices.filter(inv => +inv.datum === +o.V && inv.regels.some(rg => rg.lines.some(l => l.order === o)));
    const latestIn = supplying.reduce((m, inv) => Math.max(m, +inv.zending.aankomst_werkelijk), 0);
    let depReal = addMin(o.vertrek, RI(0, 25));
    if (latestIn && depReal < addMin(new Date(latestIn), 45)) depReal = addMin(new Date(latestIn), RI(45, 75));
    const extra = r() < (o.klant.reistijd > 600 ? 0.12 : 0.05) ? R(40, 180) : R(-15, 25);
    const arrReal = addMin(o.arrive, (depReal - o.vertrek) / MIN + extra);
    const L = { id: leveringen.length + 1, order: o, klant: o.klant, vervoerder: o.klant.reistijd < 120 ? 'Eigen bus Campo' : o.klant.reistijd < 700 ? 'Koeltransport Vos' : 'Euro Cool Logistics', vertrek_gepland: o.vertrek, vertrek_werkelijk: depReal, aankomst_gepland: o.arrive, aankomst_werkelijk: arrReal };
    leveringen.push(L); o.levering = L;
    events.push({ L, tijd: depReal, soort: 'vertrokken', plaats: 'Campo, Nootdorp', tekst: `Vertrokken naar ${o.klant.plaats}`, bron: 'jan' });
    if (arrReal - o.arrive > 30 * MIN) events.push({ L, tijd: addMin(o.arrive, -40), soort: 'vertraging', plaats: 'onderweg', eta: arrReal, tekst: `Later bij ${o.klant.naam}, nieuwe tijd ${hhmm(arrReal)}`, bron: 'vervoerder' });
    events.push({ L, tijd: arrReal, soort: 'afgeleverd', plaats: o.klant.plaats, tekst: `Afgeleverd bij ${o.klant.naam}`, bron: 'vervoerder' });
  }

  // ---------- allocations: every line to the customers it was bought for; the rest to stock or offered
  const allocs = [];
  const buyersOf = p => customers.filter(c => !c.stopped && c.mix.includes(p.base) && (!p.kleur || !c.kleur || !c.kleur[p.base] || c.kleur[p.base].includes(p.kleur)));
  for (const inv of invoices) {
    for (const rg of inv.regels) {
      let left = rg.aantal;
      const ls = rg.lines.slice().sort((a, b) => a.order.besteld_op - b.order.besteld_op);
      for (const l of ls) {
        const n = Math.min(left, l.aantal);
        if (n <= 0) { l.short = (l.short || 0) + l.aantal; continue; }
        allocs.push({ rg, bestemming: 'klant', klant: l.order.klant, order_regel: l, levering: l.order.levering, aantal: n, verkoopprijs: l.prijs, soort: 'order', reden: `Bestelling ${l.order.nummer}`, score: 100 });
        if (n < l.aantal) l.short = l.aantal - n;
        left -= n;
      }
      if (rg.short > 0) afwijkingen.push({ inv, rg, soort: 'minder', aantal: rg.short, bedrag: round2(rg.short * rg.afgesproken), tekst: `${rg.short} minder geleverd dan besteld (${rg.besteld})`, gemeld_op: inv.zending.aankomst_werkelijk });
      if (rg.over) afwijkingen.push({ inv, rg, soort: 'prijs', bedrag: round2((rg.prijs - rg.afgesproken) * rg.aantal), tekst: `Prijs ${rg.prijs.toFixed(3)} in plaats van afgesproken ${rg.afgesproken.toFixed(3)}`, gemeld_op: inv.zending.aankomst_werkelijk });
      rg.rest = left;
      if (left > 0) {
        const fans = buyersOf(rg.plant).filter(c => !ls.some(l => l.order.klant === c));
        if (fans.length && r() < 0.55) {
          const c = wpick(fans, fans.map(f => (f.code === 'wisla' || f.code === 'versfris' ? 3 : 1) / f.every * 10));
          const sameDay = bought.find(o => o.klant === c && +o.V === +inv.datum);
          allocs.push({ rg, bestemming: 'klant', klant: c, levering: sameDay ? sameDay.levering : null, aantal: left, verkoopprijs: round2(rg.plant.verkoopprijs * (1 + c.adj) * 0.9), soort: 'aanbod', reden: `Rest aangeboden; ${c.naam} koopt ${rg.plant.naam} gemiddeld elke ${c.every} dagen`, score: RI(62, 88) });
        } else {
          allocs.push({ rg, bestemming: 'voorraad', aantal: left, soort: 'voorraad', reden: 'Op voorraad in de koelcel', score: null });
        }
      }
    }
    // quality, now and then
    if (r() < inv.kweker.profile.quality) {
      const rg = pick(inv.regels), n = Math.max(1, Math.round(rg.aantal * R(0.02, 0.08)));
      afwijkingen.push({ inv, rg, soort: r() < 0.6 ? 'schade' : 'kwaliteit', aantal: n, bedrag: round2(n * rg.prijs), tekst: r() < 0.6 ? `${n} ${rg.plant.eenheid === 'stelen' ? 'stelen' : 'potten'} beschadigd binnengekomen` : `${n} ${rg.plant.eenheid === 'stelen' ? 'stelen' : 'planten'} met slap blad of te weinig knop`, gemeld_op: addMin(inv.zending.aankomst_werkelijk, RI(20, 90)) });
    }
  }

  // ---------- the state of today's and tomorrow's work
  const now_ = +now;
  const todayInv = invoices.filter(i => +i.datum === +TODAY).sort((a, b) => a.zending.aankomst_gepland - b.zending.aankomst_gepland);
  const tomorrowInv = invoices.filter(i => +i.datum === +dayN(1));
  const unread = [];
  // two of tomorrow's invoices have just come in and are not read yet: one by mail (pdf), one by WhatsApp (text)
  const cands = tomorrowInv.filter(i => i.regels.length >= 2).sort((a, b) => b.regels.length - a.regels.length);
  const mailInv = cands.find(i => !['naivasha'].includes(i.kweker.code));
  const waInv = cands.find(i => i !== mailInv && i.kweker.land === 'NL');
  for (const inv of [mailInv, waInv].filter(Boolean)) { inv.unread = inv === mailInv ? 'mail' : 'whatsapp'; unread.push(inv); }
  const stageOf = new Map();
  const todayPlan = ['klaar', 'klaar', 'informeren', 'rest', 'koppelen', 'nakijken', 'klaar', 'koppelen', 'rest', 'informeren', 'klaar', 'klaar'];
  todayInv.forEach((inv, i) => stageOf.set(inv, todayPlan[i % todayPlan.length]));
  tomorrowInv.filter(i => !i.unread).forEach((inv, i) => stageOf.set(inv, ['koppelen', 'informeren', 'klaar', 'koppelen'][i % 4]));
  // a "rest" invoice needs something left over
  for (const [inv, st] of stageOf) {
    if (st === 'rest' && !inv.regels.some(rg => rg.rest > 0)) {
      const rg = inv.regels[0]; rg.aantal += rg.plant.per_laag; rg.besteld += rg.plant.per_laag; rg.rest = rg.plant.per_laag;
    }
  }
  const allocState = (a) => {
    const inv = a.rg.inv;
    const st = stageOf.get(inv);
    if (!st) return a.levering && +a.levering.aankomst_werkelijk <= now_ ? 'geleverd' : 'bevestigd';
    if (st === 'koppelen' || st === 'nakijken') return a.soort === 'order' ? 'voorstel' : null;
    if (st === 'rest') return a.soort === 'order' ? 'bevestigd' : null;
    return a.levering && +a.levering.aankomst_werkelijk <= now_ ? 'geleverd' : 'bevestigd';
  };
  for (const inv of invoices) for (const rg of inv.regels) rg.inv = inv;
  const keepAllocs = [];
  for (const a of allocs) {
    if (a.rg.inv.unread) continue;
    const s = allocState(a);
    if (!s) continue;
    a.status = s;
    if (s === 'voorstel') { a.door = 'ai'; a.reden = `Open bestelling ${a.order_regel.order.nummer} van ${a.klant.naam}`; a.score = RI(86, 99); }
    else a.door = 'demo';
    keepAllocs.push(a);
  }

  // ---------- messages to customers for every invoice that is done
  const msgs = [];
  for (const inv of invoices) {
    if (inv.unread) continue;
    const st = stageOf.get(inv);
    if (st && st !== 'klaar' && st !== 'informeren') continue;
    const per = new Map();
    for (const a of keepAllocs) if (a.rg.inv === inv && a.bestemming === 'klant') { if (!per.has(a.klant)) per.set(a.klant, []); per.get(a.klant).push(a); }
    for (const [c, as] of per) {
      const isOffer = as.every(a => a.soort === 'aanbod');
      const L = as.find(a => a.levering)?.levering;
      const m = isOffer
        ? offerMessage({ klant: c, lines: as.map(a => ({ plant: a.rg.plant, aantal: a.aantal, prijs: a.verkoopprijs, normaal: a.rg.plant.verkoopprijs })) })
        : deliveryMessage({ klant: c, lines: as.map(a => ({ plant: a.rg.plant, aantal: a.aantal })), eta: L ? L.aankomst_gepland : null, order: as[0].order_regel ? as[0].order_regel.order.nummer : null });
      const sentAt = addMin(inv.zending.aankomst_werkelijk, RI(15, 70));
      const sent = st === 'klaar' || (!st && +sentAt <= now_);
      if (st === 'klaar' && +sentAt > now_) sentAt.setTime(Math.max(+inv.zending.aankomst_gepland - 90 * MIN, now_ - RI(5, 40) * MIN));
      msgs.push({ klant: c, inv, soort: isOffer ? 'aanbod' : 'levering', kanaal: c.kanaal === 'telefoon' ? 'telefoon' : c.kanaal, taal: c.taal, onderwerp: m.onderwerp, tekst: m.tekst, status: sent ? 'verstuurd' : 'concept', aangemaakt: addMin(inv.zending.aankomst_werkelijk, 5) < now ? addMin(inv.zending.aankomst_werkelijk, 5) : now, verstuurd_op: sent ? sentAt : null });
    }
  }

  // ---------- order status and sales invoices
  const verkoop = [];
  let vfSeq = {};
  for (const o of orders) {
    if (o.V > dayN(1)) { o.status = 'open'; continue; }
    const L = o.levering;
    const invs = invoices.filter(i => i.regels.some(rg => rg.lines.some(l => l.order === o)));
    if (invs.some(i => i.unread)) { o.status = 'open'; continue; }
    const states = keepAllocs.filter(a => a.order_regel && a.order_regel.order === o).map(a => a.status);
    if (L && +L.aankomst_werkelijk <= now_) o.status = 'geleverd';
    else if (L && +L.vertrek_werkelijk <= now_) o.status = 'onderweg';
    else if (states.length && states.every(s => s !== 'voorstel')) o.status = 'toegewezen';
    else o.status = 'open';
    if (o.status === 'geleverd') {
      const y = yy(L.aankomst_werkelijk); vfSeq[y] = (vfSeq[y] || 0) + 1;
      const bedrag = round2(o.lines.reduce((s, l) => s + (l.aantal - (l.short || 0)) * l.prijs, 0));
      const datum = midnight(L.aankomst_werkelijk), verval = addDays(datum, o.klant.betaaltermijn);
      const late = Math.round(o.klant.pay + gauss() * 4);
      const paid = addDays(verval, Math.max(-8, late));
      verkoop.push({ klant: o.klant, order: o, nummer: `CV-${y}-${String(vfSeq[y]).padStart(5, '0')}`, datum, verval, bedrag, betaald: paid <= TODAY ? paid : null });
    }
  }

  // ---------- what came in: messages with the invoices (recent ones keep their pdf)
  const inbound = [], files = [];
  const recentFrom = dayN(-14);
  for (const inv of invoices) {
    const g = inv.kweker;
    const z = inv.zending;
    if (inv.datum < recentFrom && !inv.unread) continue;
    const kanaal = inv.unread ? inv.unread : (r() < 0.75 ? 'mail' : 'whatsapp');
    // invoices for tomorrow come in during today, the rest some hours before the truck
    const dayStart = +at(TODAY, 7);
    const recv = inv.unread ? new Date(now_ - RI(4, 50) * MIN)
      : inv.datum > TODAY ? new Date(now_ > dayStart + 30 * MIN ? dayStart + r() * (now_ - dayStart - 20 * MIN) : now_ - RI(30, 120) * MIN)
      : addMin(z.aankomst_gepland, -RI(60, 600));
    const m = { id: inbound.length + 1, kanaal, extern_id: `demo-${inv.id}`, van: kanaal === 'mail' ? g.email : g.whatsapp, van_naam: g.naam, onderwerp: kanaal === 'mail' ? `Factuur ${inv.nummer}` : null, ontvangen: recv > now ? new Date(now_ - 30 * MIN) : recv, kweker: g, soort: inv.unread ? null : 'factuur', status: inv.unread ? 'nieuw' : 'gelezen', inv };
    if (kanaal === 'whatsapp') {
      const tot = inv.regels.reduce((s, x) => s + x.aantal * x.prijs, 0);
      m.tekst = `Hoi Jan, factuur ${inv.nummer} voor ${inv.datum > TODAY ? 'morgen' : 'vandaag'}:\n` + inv.regels.map(x => `${x.aantal}x ${x.omschrijving} à €${x.prijs.toFixed(2).replace('.', ',')}`).join('\n') + `\nTotaal €${new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(tot)} excl. btw\nLevering ${inv.datum > TODAY ? 'morgen' : 'vandaag'} rond ${hhmm(z.aankomst_gepland)}. Gr ${g.contact.split(' ')[0]}`;
    } else {
      m.tekst = `Beste Jan,\n\nIn de bijlage de factuur ${inv.nummer}.\n\nMet vriendelijke groet,\n${g.contact}\n${g.naam}`;
      const pdf = await invoicePdf({ kweker: g, nummer: inv.nummer, datum: ymd(inv.datum), vervaldatum: ymd(inv.verval), regels: inv.regels.map(x => ({ aantal: x.aantal, omschrijving: x.omschrijving, prijs: x.prijs, ref: x.klant_ref })), iban: `NL${String(10 + g.id).padStart(2, '0')}RABO0${String(300000000 + g.id * 7311).slice(0, 9)}` });
      files.push({ id: files.length + 1, bericht: m, naam: `Factuur_${inv.nummer}.pdf`, mime: 'application/pdf', data: pdf });
      inv.file = files[files.length - 1];
    }
    inv.bericht = m;
    inbound.push(m);
  }
  // a fake invoice from a look-alike address
  {
    const g = G.zonnehoek;
    const fake = { id: inbound.length + 1, kanaal: 'mail', extern_id: 'demo-lookalike', van: 'facturen@zonnenhoek-kwekerij.com', van_naam: 'Kwekerij De Zonnenhoek', onderwerp: 'SPOED: openstaande factuur 2026-0412', tekst: 'Beste Jan,\n\nOnze bankgegevens zijn gewijzigd. Graag vandaag nog betalen op het nieuwe rekeningnummer in de bijlage, anders stoppen de leveringen.\n\nMet vriendelijke groet,\nAdministratie De Zonnenhoek', ontvangen: new Date(now_ - RI(20, 140) * MIN), kweker: null, soort: null, status: 'nieuw' };
    const pdf = await invoicePdf({ kweker: { naam: 'Kwekerij De Zonnenhoek', plaats: 'Honselersdijk', land: 'NL', email: 'facturen@zonnenhoek-kwekerij.com', id: 99 }, nummer: '2026-0412', datum: ymd(TODAY), vervaldatum: ymd(TODAY), regels: [{ aantal: 1200, omschrijving: 'Kalanchoe bl. P10 mix', prijs: 1.95 }, { aantal: 960, omschrijving: 'Cyclaam P12 mix', prijs: 2.6 }], iban: 'NL02ABNA0123456789', note: 'Let op: nieuw rekeningnummer. Betaling vandaag vereist.', lookalike: true });
    files.push({ id: files.length + 1, bericht: fake, naam: 'Factuur_2026-0412.pdf', mime: 'application/pdf', data: pdf });
    inbound.push(fake);
  }
  // WhatsApp messages about times today: they become the eta and delay events
  for (const e of events) {
    if (!e.z || !e.whatsapp || +e.z.inv.datum < +dayN(-2)) continue;
    const g = e.z.kweker, first = g.contact.split(' ')[0];
    const tekst = e.soort === 'vertrokken'
      ? pick([`Goedemorgen Jan, we zijn om ${hhmm(e.tijd)} vertrokken. Rond ${hhmm(e.eta)} bij jullie.`, `Morgen Jan! Wagen is weg om ${hhmm(e.tijd)}, verwacht ${hhmm(e.eta)} in Nootdorp. Gr ${first}`, `Jan, alles geladen en onderweg. ETA ${hhmm(e.eta)}.`])
      : `Jan, ${e.why}. Wordt ongeveer ${hhmm(e.eta)}. Sorry! ${first}`;
    const m = { id: inbound.length + 1, kanaal: 'whatsapp', extern_id: `demo-eta-${events.indexOf(e)}`, van: g.whatsapp, van_naam: g.naam, onderwerp: null, tekst, ontvangen: addMin(e.tijd, 1), kweker: g, soort: 'tijd', status: 'gelezen' };
    inbound.push(m); e.bericht = m;
  }

  // ---------- write it all
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL search_path TO campo, public');
    const ins = async (table, cols, data) => {
      const per = Math.max(1, Math.floor(60000 / cols.length));
      for (let i = 0; i < data.length; i += per) {
        const chunk = data.slice(i, i + per), vals = [], ph = [];
        chunk.forEach((row, j) => { ph.push('(' + cols.map((_, k) => `$${j * cols.length + k + 1}`).join(',') + ')'); vals.push(...row); });
        if (chunk.length) await c.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${ph.join(',')}`, vals);
      }
      if (cols[0] === 'id' && data.length) await c.query(`SELECT setval(pg_get_serial_sequence('campo.${table}', 'id'), (SELECT max(id) FROM campo.${table}))`);
    };
    await ins('planten', ['id', 'code', 'naam', 'latijn', 'groep', 'potmaat', 'hoogte', 'eenheid', 'per_laag', 'per_kar', 'seizoen', 'verkoopprijs', 'bron'],
      plants.map(p => [p.id, p.code, p.naam, p.latijn, p.groep, p.potmaat, p.hoogte, p.eenheid, p.per_laag, p.per_kar, p.seizoen || null, p.verkoopprijs, 'demo']));
    await ins('kwekers', ['id', 'code', 'naam', 'plaats', 'land', 'contact', 'email', 'maildomein', 'whatsapp', 'vervoer', 'laadtijd', 'reistijd_min', 'levert_op', 'specialiteit', 'bron'],
      growers.map(g => [g.id, g.code, g.naam, g.plaats, g.land, g.contact, g.email, g.email.split('@')[1], g.whatsapp, g.vervoer, g.laadtijd, g.reistijd, g.levert, g.spec, 'demo']));
    const names = [];
    for (const g of growers) for (const base of Object.keys(g.assort)) for (const p of FAM[base]) names.push([p.id, g.id, growerName(g.style, p), 'demo']);
    const seenNames = new Set();
    await ins('plant_namen', ['plant_id', 'kweker_id', 'tekst', 'door'], names.filter(n => { const k = n[1] + '|' + n[2].toLowerCase(); if (seenNames.has(k)) return false; seenNames.add(k); return true; }));
    await ins('klanten', ['id', 'code', 'naam', 'soort', 'contact', 'email', 'whatsapp', 'adres', 'postcode', 'plaats', 'land', 'taal', 'kanaal', 'levervenster', 'leverdagen', 'reistijd_min', 'betaaltermijn', 'kredietlimiet', 'wensen', 'klant_sinds', 'actief', 'bron'],
      customers.map(k => [k.id, k.code, k.naam, k.soort, k.contact, k.email, k.whatsapp, k.adres, k.postcode, k.plaats, k.land, k.taal, k.kanaal, k.levervenster, k.leverdagen, k.reistijd, k.betaaltermijn, Math.round(k.vol * 15000 / 1000) * 1000, k.wensen, k.sinds, !k.stopped, 'demo']));
    await ins('klant_orders', ['id', 'nummer', 'klant_id', 'besteld_op', 'gewenst_op', 'kanaal', 'status'],
      orders.map(o => [o.id, o.nummer, o.klant.id, o.besteld_op, ymd(o.gewenst), o.kanaal === 'telefoon' ? 'telefoon' : o.kanaal, o.status || 'open']));
    await ins('klant_order_regels', ['id', 'order_id', 'plant_id', 'aantal', 'prijs'],
      orders.flatMap(o => o.lines.map(l => [l.id, o.id, l.plant.id, l.aantal, l.prijs])));
    await ins('berichten_in', ['id', 'kanaal', 'extern_id', 'van', 'van_naam', 'onderwerp', 'tekst', 'ontvangen', 'kweker_id', 'soort', 'status'],
      inbound.map(m => [m.id, m.kanaal, m.extern_id, m.van, m.van_naam, m.onderwerp, m.tekst, m.ontvangen, m.kweker ? m.kweker.id : null, m.soort, m.status]));
    await ins('bestanden', ['id', 'bericht_id', 'naam', 'mime', 'grootte', 'sha256', 'data'],
      files.map(f => [f.id, f.bericht.id, f.naam, f.mime, f.data.length, crypto.createHash('sha256').update(f.data).digest('hex'), f.data]));
    const live = invoices.filter(i => !i.unread);
    live.forEach((inv, i) => { inv.dbId = i + 1; });
    await ins('facturen', ['id', 'kweker_id', 'nummer', 'datum', 'vervaldatum', 'bericht_id', 'bestand_id', 'totaal', 'zekerheid', 'gelezen_door', 'nagekeken', 'afgerond', 'aangemaakt'],
      live.map(inv => {
        const st = stageOf.get(inv);
        return [inv.dbId, inv.kweker.id, inv.nummer, ymd(inv.datum), ymd(inv.verval), inv.bericht ? inv.bericht.id : null, inv.file ? inv.file.id : null, round2(inv.regels.reduce((s, x) => s + x.aantal * x.prijs, 0)),
          st === 'nakijken' ? 71 : RI(93, 99), 'demo', !st || st === 'klaar', !st && inv.datum < dayN(-3), inv.bericht ? addMin(inv.bericht.ontvangen, 2) : addMin(inv.zending.aankomst_gepland, -120)];
      }));
    let regelId = 0;
    for (const inv of live) for (const rg of inv.regels) rg.dbId = ++regelId;
    const twijfel = new Set();
    for (const inv of live) if (stageOf.get(inv) === 'nakijken') twijfel.add(inv.regels[inv.regels.length - 1]);
    await ins('factuur_regels', ['id', 'factuur_id', 'regelnr', 'omschrijving', 'plant_id', 'match_zekerheid', 'aantal', 'besteld', 'prijs', 'afgesproken', 'klant_ref'],
      live.flatMap(inv => inv.regels.map(rg => [rg.dbId, inv.dbId, rg.regelnr, twijfel.has(rg) ? `${rg.plant.naam.split(' ')[0].slice(0, 5)}. ${rg.plant.potmaat ? rg.plant.potmaat.replace('P', '') + 'cm ' : ''}'Sunset' nw` : rg.omschrijving, rg.plant.id, twijfel.has(rg) ? 58 : RI(90, 100), rg.aantal, rg.besteld, rg.prijs, rg.afgesproken, rg.klant_ref])));
    const zLive = zendingen.filter(z => !z.inv.unread);
    zLive.forEach((z, i) => { z.dbId = i + 1; });
    const isPast = d => +d <= now_;
    await ins('zendingen', ['id', 'factuur_id', 'kweker_id', 'vervoerder', 'karren', 'vertrek_gepland', 'vertrek_werkelijk', 'aankomst_gepland', 'aankomst_verwacht', 'aankomst_werkelijk'],
      zLive.map(z => [z.dbId, z.inv.dbId, z.kweker.id, z.vervoerder, z.karren, z.vertrek_gepland, z.vertrek_werkelijk, z.aankomst_gepland, isPast(z.aankomst_werkelijk) ? z.aankomst_werkelijk : null, z.aankomst_werkelijk]));
    await ins('leveringen', ['id', 'klant_id', 'order_id', 'vervoerder', 'vertrek_gepland', 'vertrek_werkelijk', 'aankomst_gepland', 'aankomst_verwacht', 'aankomst_werkelijk'],
      leveringen.map(L => [L.id, L.klant.id, L.order.id, L.vervoerder, L.vertrek_gepland, L.vertrek_werkelijk, L.aankomst_gepland, isPast(L.aankomst_werkelijk) ? L.aankomst_werkelijk : null, L.aankomst_werkelijk]));
    await ins('toewijzingen', ['regel_id', 'bestemming', 'klant_id', 'order_regel_id', 'levering_id', 'aantal', 'verkoopprijs', 'soort', 'status', 'reden', 'score', 'door', 'aangemaakt'],
      keepAllocs.map(a => [a.rg.dbId, a.bestemming, a.klant ? a.klant.id : null, a.order_regel ? a.order_regel.id : null, a.levering ? a.levering.id : null, a.aantal, a.verkoopprijs ?? null, a.soort, a.status, a.reden, a.score ?? null, a.door,
        new Date(Math.min(now_, +addMin(a.rg.inv.zending.aankomst_gepland, -90)))]));
    await ins('gebeurtenissen', ['zending_id', 'levering_id', 'bericht_id', 'tijd', 'soort', 'plaats', 'eta', 'tekst', 'bron'],
      events.filter(e => (e.z ? !e.z.inv.unread : true)).map(e => [e.z ? e.z.dbId : null, e.L ? e.L.id : null, e.bericht ? e.bericht.id : null, e.tijd, e.soort, e.plaats, e.eta || null, e.tekst, e.bron]));
    await ins('afwijkingen', ['factuur_id', 'regel_id', 'soort', 'aantal', 'bedrag', 'tekst', 'opgelost', 'oplossing', 'gemeld_op'],
      afwijkingen.filter(a => !a.inv.unread).map(a => {
        const old = a.gemeld_op < dayN(-2);
        const oplossing = !old ? null : a.soort === 'minder' ? pick(['nalevering', 'credit']) : a.soort === 'te_laat' ? 'geaccepteerd' : a.soort === 'prijs' ? pick(['credit', 'geaccepteerd']) : pick(['credit', 'credit', 'retour']);
        return [a.inv.dbId, a.rg ? a.rg.dbId : null, a.soort, a.aantal ?? null, a.bedrag ?? null, a.tekst, old, oplossing, a.gemeld_op];
      }));
    await ins('berichten_uit', ['klant_id', 'factuur_id', 'soort', 'kanaal', 'taal', 'onderwerp', 'tekst', 'status', 'aangemaakt', 'verstuurd_op'],
      msgs.map(m => [m.klant.id, m.inv.dbId, m.soort, m.kanaal, m.taal, m.onderwerp, m.tekst, m.status, m.aangemaakt, m.verstuurd_op]));
    await ins('verkoopfacturen', ['klant_id', 'order_id', 'nummer', 'datum', 'vervaldatum', 'bedrag', 'betaald_op'],
      verkoop.map(v => [v.klant.id, v.order.id, v.nummer, ymd(v.datum), ymd(v.verval), v.bedrag, v.betaald ? ymd(v.betaald) : null]));
    await c.query(`INSERT INTO instellingen (sleutel, waarde) VALUES ('demo', $1) ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde`, [JSON.stringify({ anker: ymd(TODAY), gemaakt: now.toISOString() })]);
    await c.query(`INSERT INTO logboek (wie, actie, details) VALUES ('desk', 'Demo-data aangemaakt', $1)`, [JSON.stringify({ kwekers: growers.length, klanten: customers.length, facturen: live.length, orders: orders.length })]);
    await c.query('COMMIT');
    return { kwekers: growers.length, klanten: customers.length, planten: plants.length, orders: orders.length, facturen: live.length, toewijzingen: keepAllocs.length, gebeurtenissen: events.length, berichten: msgs.length, inbox: inbound.length };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

// Keep the demo on "today": when the calendar moved on, shift every demo date by whole days.
// Only while all data is demo data; as soon as real data comes in, the demo stays where it is.
export async function keepDemoCurrent() {
  const c = await pool.connect();
  try {
    await c.query('SET search_path TO campo, public');
    const s = (await c.query(`SELECT waarde FROM instellingen WHERE sleutel = 'demo'`)).rows[0];
    if (!s) return 0;
    const real = (await c.query(`SELECT (SELECT count(*) FROM kwekers WHERE bron <> 'demo') + (SELECT count(*) FROM klanten WHERE bron <> 'demo') + (SELECT count(*) FROM berichten_in WHERE kanaal <> 'demo' AND extern_id NOT LIKE 'demo-%') AS n`)).rows[0].n;
    if (Number(real) > 0) return 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const anchor = new Date(`${s.waarde.anker}T00:00:00`);
    const shift = Math.round((today - anchor) / DAY);
    if (shift <= 0) return 0;
    const iv = `${shift} days`;
    await c.query('BEGIN');
    const cols = {
      klant_orders: ['besteld_op', 'gewenst_op'], berichten_in: ['ontvangen'], facturen: ['datum', 'vervaldatum', 'aangemaakt', 'bijgewerkt'],
      zendingen: ['vertrek_gepland', 'vertrek_werkelijk', 'aankomst_gepland', 'aankomst_verwacht', 'aankomst_werkelijk'],
      leveringen: ['vertrek_gepland', 'vertrek_werkelijk', 'aankomst_gepland', 'aankomst_verwacht', 'aankomst_werkelijk'],
      toewijzingen: ['aangemaakt'], gebeurtenissen: ['tijd', 'eta'], afwijkingen: ['gemeld_op'], berichten_uit: ['aangemaakt', 'verstuurd_op'],
      verkoopfacturen: ['datum', 'vervaldatum', 'betaald_op'],
    };
    for (const [t, cs] of Object.entries(cols)) {
      await c.query(`UPDATE ${t} SET ${cs.map(x => `${x} = ${x} + interval '${iv}'`).join(', ')}`);
    }
    await c.query(`UPDATE instellingen SET waarde = jsonb_set(waarde, '{anker}', to_jsonb($1::text)) WHERE sleutel = 'demo'`, [`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`]);
    await c.query('COMMIT');
    return shift;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function removeDemo() {
  const c = await pool.connect();
  try {
    await c.query('SET search_path TO campo, public');
    await c.query('BEGIN');
    await c.query(`DELETE FROM berichten_in WHERE extern_id LIKE 'demo-%' OR kanaal = 'demo'`);
    await c.query(`DELETE FROM kwekers WHERE bron = 'demo'`);
    await c.query(`DELETE FROM klanten WHERE bron = 'demo'`);
    await c.query(`DELETE FROM planten p WHERE bron = 'demo' AND NOT EXISTS (SELECT 1 FROM factuur_regels r WHERE r.plant_id = p.id) AND NOT EXISTS (SELECT 1 FROM klant_order_regels k WHERE k.plant_id = p.id)`);
    await c.query(`DELETE FROM instellingen WHERE sleutel = 'demo'`);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
