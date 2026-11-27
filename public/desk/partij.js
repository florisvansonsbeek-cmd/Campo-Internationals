// One shipment, the same on Inkoop and on the supplier's page: does it arrive (the route with its light and the reasons),
// the stream from what the supplier delivers to the customers and the hall, the full list, the papers and the purchase
// order for Exact. The stream is drawn from real numbers: one ribbon per box count, nothing made up.
import { api, h, icon, fNum, toast, copy, dialog, field } from './core.js';
import { dayTime, dShort, zn, regio, stageChip, delta, fUsd, fUsdUnit, readFile } from './wk.js';

export const DOC = { bestelling: 'Jans bestelling', bevestiging: 'Bevestiging', verzendbewijs: 'Verzendpapieren', awb: 'AWB', fyto: 'Fytosanitair', overig: 'Document' };
const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const pad = n => String(n).padStart(2, '0');
// a moment for a datetime-local field, in the time of the person filling it in
const localInput = v => { if (!v) return ''; const d = new Date(v); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const iso = v => (v ? new Date(v).toISOString() : null);
const INK = '#4d5750';
// on a phone the names get two lines, so every node a little more room
const narrow = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width:560px)').matches;

// ---------------------------------------------------------------- the light: green, orange, red
const LICHT = { groen: 'Op schema', oranje: 'Let op', rood: 'Probleem', binnen: 'Binnen' };
export const lightWord = l => LICHT[l] || 'Nog niet besteld';
export const stoplicht = l => `<span class="sl" data-l="${h(l || '')}" role="img" aria-label="${h(lightWord(l))}"><i></i><i></i><i></i></span>`;
export const lightChip = l => `<span class="lgt" data-l="${h(l || '')}"><i aria-hidden="true"></i>${h(lightWord(l))}</span>`;

const BRON = { demo: 'Voorbeeld', jan: 'Melding van Jan', desk: 'De desk', 'met.no': 'Weerbericht MET Norway', nhc: 'Orkaancentrum NHC', kalender: 'Kalender' };
// the doubt on the papers has its own box with the answers, so a card can leave it out here
export function reasons(r, { info = true, actions = true, doubt = true } = {}) {
  const list = (r?.redenen || []).filter(x => (info || x.ernst !== 'info') && (doubt || !x.twijfel));
  if (!list.length) return '';
  return `<ul class="rsn">${list.map(x => `<li class="e-${h(x.ernst)}">
      <i aria-hidden="true"></i><div><b>${h(x.tekst)}</b>${x.uitleg ? `<p>${h(x.uitleg)}</p>` : ''}
      <small>${h(BRON[x.bron] || 'De desk')}${x.plek ? ` · ${h(x.plek)}` : ''}${x.tot ? ` · tot ${h(dayTime(x.tot))}` : ''}${actions && x.id && x.bron === 'jan' ? ` · <button type="button" class="lnk small" data-act="melding-weg" data-id="${x.id}">Opgelost</button>` : ''}</small></div></li>`).join('')}</ul>`;
}

// farm, airports, the truck, the hall: each stop with its own light
export function routeStrip(r) {
  if (!r || !r.stops) return '';
  const leg = (a, b) => {
    const truck = a.soort === 'herkomst' || b.soort === 'loods';
    return `<li class="hleg ${b.voorbij || (a.voorbij && b.soort === 'vertrek') ? 'done' : ''}" aria-hidden="true">${icon(truck ? 'truck' : 'plane')}</li>`;
  };
  const out = [];
  r.stops.forEach((s, i) => {
    if (i) out.push(leg(r.stops[i - 1], s));
    const title = s.soort === 'herkomst' ? s.stad || s.naam : s.soort === 'loods' ? 'Nootdorp' : s.code;
    const sub = s.soort === 'herkomst' ? 'kwekerij' : s.soort === 'loods' ? 'de loods' : s.stad;
    const when = s.soort === 'loods' ? dayTime(r.binnen || r.verwacht) : dShort(s.dag);
    out.push(`<li class="hop${s.voorbij ? ' done' : ''}" data-l="${h(s.licht)}"><span class="hd" aria-hidden="true">${s.voorbij ? icon('check') : ''}</span>
      <b>${h(title)}</b><small>${h(sub || '')}</small><small class="t">${h(when)}</small></li>`);
  });
  return `<ol class="rte" aria-label="Route">${out.join('')}</ol>`;
}

// ---------------------------------------------------------------- the stream picture
const PAL = ['#2b7a4b', '#2f6db0', '#c0792a', '#b4446c', '#6a55c9', '#3d8a8a', '#8a6d3b', '#5a7d2a'];
const TONE = { wait: '#c0792a', bad: '#b23a2a', muted: '#9aa39c' };
const ribbon = (y0a, y0b, y1a, y1b) => `M0,${y0a.toFixed(1)} C50,${y0a.toFixed(1)} 50,${y1a.toFixed(1)} 100,${y1a.toFixed(1)} L100,${y1b.toFixed(1)} C50,${y1b.toFixed(1)} 50,${y0b.toFixed(1)} 0,${y0b.toFixed(1)} Z`;
function place(nodes, k, minH, gap) {
  let y = 0;
  return nodes.map(n => { const t = n.dozen * k, hh = Math.max(minH, t); const o = { ...n, y, h: hh, t }; y += hh + gap; return o; });
}
const colHeight = ns => (ns.length ? ns[ns.length - 1].y + ns[ns.length - 1].h : 0);
const shift = (ns, dy) => ns.forEach(n => { n.y += dy; });
function scaleFor(total, n, { min = 150, max = 460, per = 31, gap = 6 } = {}) {
  const target = Math.max(min, Math.min(max, n * per));
  return Math.max(0.12, Math.min(3.2, (target - gap * Math.max(0, n - 1)) / Math.max(1, total)));
}
// bands leave a node stacked in the order of where they go, and arrive stacked in the order of where they come from
function stack(nodes, links, side, other) {
  const pos = new Map();
  for (const n of nodes) {
    const mine = links.filter(l => l[side] === n.id).sort((a, b) => other.get(a[side === 'van' ? 'naar' : 'van']) - other.get(b[side === 'van' ? 'naar' : 'van']));
    let y = n.y + (n.h - sum(mine, l => l.t)) / 2;
    for (const l of mine) { pos.set(l, [y, y + l.t]); y += l.t; }
  }
  return pos;
}
// a node: its bar against the ribbons, the name, the number of boxes
const label = (n, side) => {
  const bar = `<i class="nbar" style="height:${Math.max(2, n.t).toFixed(1)}px;background:${n.color || TONE[n.tone] || '#9aa39c'}" aria-hidden="true"></i>`;
  const txt = `<span class="ntx">${n.href ? `<a href="${h(n.href)}">${h(n.label)}</a>` : `<b>${h(n.label)}</b>`}${n.sub ? `<small>${h(n.sub)}</small>` : ''}</span><em>${fNum(n.dozen)}</em>`;
  return `<span class="nd ${side}${n.tone ? ` t-${n.tone}` : ''}" style="top:${n.y.toFixed(1)}px;height:${n.h.toFixed(1)}px">${side === 'l' ? `${txt}${bar}` : `${bar}${txt}`}</span>`;
};

// what one supplier delivers, product by product, to which customers and what is left in the hall
export function flowPartij(st, { max = 8, id = null } = {}) {
  if (!st || !st.regels.length) return '<p class="empty">Nog geen regels.</p>';
  const L = st.regels.map((r, i) => ({ id: `r${r.id}`, label: `${r.naam} ${r.maat}`, dozen: r.dozen, color: PAL[i % PAL.length] })).filter(n => n.dozen > 0);
  const top = st.klanten.slice(0, max), restK = st.klanten.slice(max), topIds = new Set(top.map(k => k.id));
  let links = st.links.map(l => ({ van: `r${l.van}`, naar: topIds.has(l.naar) ? `k${l.naar}` : 'andere', dozen: l.dozen }));
  for (const r of st.regels) {
    if (r.rest > 0) links.push({ van: `r${r.id}`, naar: 'rest', dozen: r.rest });
    if (r.uitval > 0) links.push({ van: `r${r.id}`, naar: 'uitval', dozen: r.uitval });
  }
  const agg = new Map();
  for (const l of links) { const k = `${l.van}|${l.naar}`; agg.set(k, { ...l, dozen: (agg.get(k)?.dozen || 0) + l.dozen }); }
  links = [...agg.values()].filter(l => l.dozen > 0);
  const li = new Map(L.map((n, i) => [n.id, i]));
  let R = top.map(k => ({ id: `k${k.id}`, label: k.naam, sub: k.plaats, dozen: k.dozen, href: `#/klant/${k.id}`, color: INK }));
  // customers in the order of the products they take, so the ribbons cross as little as possible
  const bary = n => { const ls = links.filter(l => l.naar === n.id); const t = sum(ls, l => l.dozen); return t ? sum(ls, l => li.get(l.van) * l.dozen) / t : 0; };
  R.sort((a, b) => bary(a) - bary(b));
  if (restK.length) R.push({ id: 'andere', label: `${restK.length} andere ${restK.length === 1 ? 'klant' : 'klanten'}`, dozen: sum(links.filter(l => l.naar === 'andere'), l => l.dozen), tone: 'muted' });
  const rest = sum(links.filter(l => l.naar === 'rest'), l => l.dozen), uitval = sum(links.filter(l => l.naar === 'uitval'), l => l.dozen);
  if (rest) R.push({ id: 'rest', label: 'Over in de loods', dozen: rest, tone: 'wait' });
  if (uitval) R.push({ id: 'uitval', label: 'Uitval', dozen: uitval, tone: 'bad' });
  for (const n of L) n.dozen = Math.max(n.dozen, sum(links.filter(l => l.van === n.id), l => l.dozen));
  const total = Math.max(sum(L, n => n.dozen), sum(R, n => n.dozen)), n = Math.max(L.length, R.length);
  const k = scaleFor(total, n), gap = 6, minH = narrow() ? 32 : 28;
  const Lp = place(L, k, minH, gap), Rp = place(R, k, minH, gap);
  const H = Math.max(colHeight(Lp), colHeight(Rp));
  shift(Lp, (H - colHeight(Lp)) / 2); shift(Rp, (H - colHeight(Rp)) / 2);
  for (const l of links) l.t = l.dozen * k;
  const ri = new Map(Rp.map((x, i) => [x.id, i]));
  const out = stack(Lp, links, 'van', ri), inn = stack(Rp, links, 'naar', li);
  const color = new Map(Lp.map(x => [x.id, x.color]));
  const nameOf = new Map([...Lp, ...Rp].map(x => [x.id, x.label]));
  const paths = links.map(l => {
    const [a0, a1] = out.get(l), [b0, b1] = inn.get(l);
    const c = l.naar === 'rest' ? TONE.wait : l.naar === 'uitval' ? TONE.bad : color.get(l.van);
    return `<path d="${ribbon(a0, a1, b0, b1)}" fill="${c}" class="${l.naar === 'rest' || l.naar === 'uitval' ? 'hl' : ''}"><title>${h(nameOf.get(l.van))} → ${h(nameOf.get(l.naar))}: ${fNum(l.dozen)} ${l.dozen === 1 ? 'doos' : 'dozen'}</title></path>`;
  }).join('');
  const sumTxt = `${fNum(st.dozen)} dozen in ${L.length} ${L.length === 1 ? 'variant' : 'varianten'} naar ${st.klanten.length} ${st.klanten.length === 1 ? 'klant' : 'klanten'}${rest ? `, ${fNum(rest)} over in de loods` : ', niets over'}`;
  return `<div class="strm f2"${id ? ` data-act="flow" data-p="${id}"` : ''} role="img" aria-label="${h(sumTxt)}" style="--fh:${Math.ceil(H)}px">
    <div class="scol l">${Lp.map(x => label(x, 'l')).join('')}</div>
    <svg class="rib" viewBox="0 0 100 ${H.toFixed(1)}" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>
    <div class="scol r">${Rp.map(x => label(x, 'r')).join('')}</div>
  </div>`;
}

// the week: every supplier, through the hall in Nootdorp, to every customer
export function flowWeek(w, partijen, { max = 10, maandag = '' } = {}) {
  const ps = partijen.filter(p => p.stroom && p.stroom.dozen > 0);
  if (!ps.length) return '<p class="empty">Nog niets onderweg.</p>';
  const col = new Map(ps.map((p, i) => [p.id, PAL[i % PAL.length]]));
  const L = ps.map(p => ({ id: `p${p.id}`, pid: p.id, label: p.leverancier.replace(/ (S\.A\.|B\.V\.|GmbH)$/, ''), sub: `${p.nummer}${p.risico?.licht ? ` · ${lightWord(p.risico.licht).toLowerCase()}` : ''}`, dozen: p.stroom.dozen, color: col.get(p.id), href: `#/leverancier/${p.leverancier_id}?maandag=${maandag}` }));
  const top = w.klanten.filter(k => k.dozen > 0).slice(0, max), others = w.klanten.filter(k => k.dozen > 0).slice(max);
  const R = top.map(k => ({ id: `k${k.id}`, label: k.naam, sub: k.tekort ? `kreeg ${fNum(k.dozen)} van ${fNum(k.gevraagd)}` : k.plaats, dozen: k.dozen, per: k.per, href: `#/klant/${k.id}`, tone: k.tekort ? 'short' : '', color: INK }));
  if (others.length) { const per = {}; for (const k of others) for (const [pid, n] of Object.entries(k.per)) per[pid] = (per[pid] || 0) + n; R.push({ id: 'andere', label: `${others.length} andere klanten`, dozen: sum(others, k => k.dozen), per, tone: 'muted' }); }
  if (w.rest) { const per = {}; for (const p of ps) if (p.stroom.rest) per[p.id] = p.stroom.rest; R.push({ id: 'rest', label: 'Over in de loods', dozen: w.rest, per, tone: 'wait' }); }
  if (w.uitval) { const per = {}; for (const p of ps) if (p.stroom.uitval) per[p.id] = p.stroom.uitval; R.push({ id: 'uitval', label: 'Uitval', dozen: w.uitval, per, tone: 'bad' }); }
  const total = Math.max(sum(L, n => n.dozen), sum(R, n => n.dozen)), n = Math.max(L.length, R.length);
  const k = scaleFor(total, n, { max: 480 }), gap = 6;
  const Lp = place(L, k, narrow() ? 40 : 34, 10), Rp = place(R, k, narrow() ? 32 : 28, gap);
  const loodsH = total * k, H = Math.max(colHeight(Lp), colHeight(Rp), loodsH);
  shift(Lp, (H - colHeight(Lp)) / 2); shift(Rp, (H - colHeight(Rp)) / 2);
  const y0 = (H - loodsH) / 2;
  // supplier → hall, stacked in supplier order
  let y = y0;
  const p1 = Lp.map(x => { const t = x.dozen * k, a = x.y + (x.h - t) / 2, d = ribbon(a, a + t, y, y + t); y += t; return `<path d="${d}" fill="${x.color}"><title>${h(x.label)}: ${fNum(x.dozen)} dozen naar de loods</title></path>`; }).join('');
  // hall → customer, every customer's band split by where its boxes come from
  y = y0;
  const p2 = Rp.map(x => {
    let ya = x.y + (x.h - x.dozen * k) / 2;
    return ps.filter(p => x.per[p.id]).map(p => {
      const t = x.per[p.id] * k, d = ribbon(y, y + t, ya, ya + t); y += t; ya += t;
      return `<path d="${d}" fill="${x.id === 'rest' ? TONE.wait : x.id === 'uitval' ? TONE.bad : col.get(p.id)}" class="${x.id === 'rest' || x.id === 'uitval' ? 'hl' : ''}"><title>${h(p.nummer)} → ${h(x.label)}: ${fNum(x.per[p.id])} dozen</title></path>`;
    }).join('');
  }).join('');
  const sumTxt = `${fNum(w.in)} dozen van ${ps.length} leveranciers naar ${w.klanten.filter(k => k.dozen > 0).length} klanten${w.rest ? `, ${fNum(w.rest)} over in de loods` : ', netto nul'}`;
  return `<div class="strm f3" data-act="flow-all" role="img" aria-label="${h(sumTxt)}" style="--fh:${Math.ceil(H)}px">
    <div class="scol l">${Lp.map(x => label(x, 'l')).join('')}</div>
    <svg class="rib" viewBox="0 0 100 ${H.toFixed(1)}" preserveAspectRatio="none" aria-hidden="true">${p1}</svg>
    <div class="smid"><span class="loods" style="top:${y0.toFixed(1)}px;height:${Math.max(40, loodsH).toFixed(1)}px"><b>Loods Nootdorp</b><em>${fNum(w.in)}</em></span></div>
    <svg class="rib" viewBox="0 0 100 ${H.toFixed(1)}" preserveAspectRatio="none" aria-hidden="true">${p2}</svg>
    <div class="scol r">${Rp.map(x => label(x, 'r')).join('')}</div>
  </div>`;
}

// ---------------------------------------------------------------- the full list
export function timeline(p) {
  const st = [
    ['Besteld', p.besteld_op, null],
    ['Bevestigd', p.bevestigd_op, p.verwacht?.bevestiging],
    ['Verzonden', p.verzonden_op, p.verwacht?.verzonden, p.verzonden_op ? [p.awb ? `AWB ${p.awb}` : '', p.vlucht].filter(Boolean).join(' · ') : ''],
    ['In Exact', p.exact === 'in_exact' ? p.exact_op : null, null, p.exact_nummer ? `nr. ${p.exact_nummer}` : ''],
  ];
  return `<ol class="tl">${st.map(([t, at, exp, sub]) => `<li class="${at ? 'done' : ''}"><b>${t}</b><span>${at ? h(dayTime(at)) : exp ? `verwacht ${h(dayTime(exp))}` : '–'}</span>${sub ? `<small>${h(sub)}</small>` : ''}</li>`).join('')}</ol>`;
}

export function lines(p) {
  return `<div class="tbwrap"><table class="tb lines"><thead><tr><th>Product</th><th class="r">Besteld</th><th class="r">Bevestigd</th><th class="r">Verzonden</th><th class="r">Per doos</th><th class="r">Stuks</th><th class="r">Prijs</th><th class="r">Bedrag</th><th></th></tr></thead><tbody>
    ${p.regels.map(r => {
      const stuks = (r.verzonden ?? r.bevestigd ?? r.besteld ?? 0) * r.per_doos;
      return `<tr class="${r.twijfel ? 'doubt' : ''}" id="r${r.id}">
        <td><b>${h(r.product)} ${h(r.maat)}</b><small class="faint" style="display:block">${h(r.soort)}</small>${r.twijfel ? `<p class="why-d">${icon('warn')}${h(r.twijfel)}</p>` : ''}</td>
        <td class="r num">${r.besteld == null ? '–' : fNum(r.besteld)}</td>
        <td class="r num">${r.bevestigd == null ? '–' : fNum(r.bevestigd)} ${delta(r.besteld, r.bevestigd)}</td>
        <td class="r num">${r.verzonden == null ? '–' : `<b>${fNum(r.verzonden)}</b>`} ${delta(r.bevestigd ?? r.besteld, r.verzonden)}${r.zekerheid != null && r.verzonden != null ? `<small class="conf ${r.zekerheid >= 90 ? 'hi' : r.zekerheid >= 75 ? 'mid' : 'lo'}" title="Hoe zeker de desk het las">${r.zekerheid}%</small>` : ''}</td>
        <td class="r num">${fNum(r.per_doos)}</td><td class="r num">${fNum(stuks)}</td><td class="r num">${fUsdUnit(r.prijs_usd)}</td><td class="r num">${fUsd(stuks * r.prijs_usd)}</td>
        <td class="r nowrap">${r.twijfel ? `<button type="button" class="btn btn-sm btn-leaf" data-act="line-ok" data-id="${r.id}">${fNum(r.verzonden)} klopt</button> ` : ''}<button type="button" class="btn btn-sm btn-ghost" data-act="line-edit" data-id="${r.id}" data-p="${p.id}" aria-label="Aanpassen">${icon('edit')}</button></td>
      </tr>`;
    }).join('')}
  </tbody><tfoot><tr><td><b>Samen</b></td><td class="r num">${fNum(sum(p.regels, r => r.besteld || 0))}</td><td class="r num">${p.bevestigd_op ? fNum(sum(p.regels, r => r.bevestigd || 0)) : '–'}</td><td class="r num">${p.verzonden_op ? `<b>${fNum(sum(p.regels, r => r.verzonden || 0))}</b>` : '–'}</td>
    <td></td><td class="r num">${fNum(sum(p.regels, r => (r.verzonden ?? r.bevestigd ?? r.besteld ?? 0) * r.per_doos))}</td><td></td><td class="r num">${fUsd(p.totaal_usd)}</td><td></td></tr></tfoot></table></div>`;
}

// to whom every line goes: the stream as a list
export function toWhom(p) {
  const st = p.stroom;
  if (!st || !st.links.length) return '<p class="small faint">Nog niet verdeeld: de desk legt de telefoonbestellingen erover zodra er besteld is.</p>';
  const name = new Map(st.regels.map(r => [r.id, `${r.naam} ${r.maat}`]));
  const by = new Map();
  for (const l of st.links) { if (!by.has(l.naar)) by.set(l.naar, []); by.get(l.naar).push(l); }
  const rows = st.klanten.map(k => `<li><a href="#/klant/${k.id}"><b>${h(k.naam)}</b></a><span>${(by.get(k.id) || []).map(l => `${fNum(l.dozen)} × ${h(name.get(l.van))}`).join(' · ')}</span><em>${fNum(k.dozen)}</em></li>`);
  const rest = st.regels.filter(r => r.rest > 0);
  if (rest.length) rows.push(`<li class="t-wait"><b>Over in de loods</b><span>${rest.map(r => `${fNum(r.rest)} × ${h(r.naam)} ${h(r.maat)}`).join(' · ')}</span><em>${fNum(st.rest)}</em></li>`);
  return `<ul class="whom">${rows.join('')}</ul><p class="small faint">${st.basis === 'geteld' ? 'Zoals Jan het maandag verdeelde.' : 'Voorstel van de desk uit de telefoonbestellingen. Maandag na het tellen verdeel je het echt.'}</p>`;
}

export function exactBox(p) {
  const ready = p.verzonden_op && !p.twijfels;
  return `<div class="exact ${p.exact === 'in_exact' ? 'is-in' : ''}">
    <div class="exact-h"><b>Inkooporder voor Exact</b><span class="small muted">${h(p.leverancier)} · valuta USD · kostendrager <b>${h(p.nummer)}</b> · ${fUsd(p.totaal_usd)}</span></div>
    <details><summary>De ${p.exactRegels.length} regels zoals ze in Exact komen</summary>
      <div class="tbwrap"><table class="tb"><thead><tr><th>Artikel</th><th>Omschrijving</th><th class="r">Aantal</th><th class="r">Prijs $</th><th class="r">Bedrag $</th><th>Kostendrager</th></tr></thead><tbody>
      ${p.exactRegels.map(l => `<tr><td>${h(l.artikel)}</td><td>${h(l.omschrijving)}</td><td class="r num">${fNum(l.stuks)}</td><td class="r num">${fUsdUnit(l.prijs_usd)}</td><td class="r num">${fUsd(l.bedrag_usd)}</td><td>${h(l.kostendrager)}</td></tr>`).join('')}
      </tbody></table></div></details>
    <div class="exact-a">
      <button type="button" class="btn btn-sm btn-line" data-act="exact-copy" data-id="${p.id}">${icon('copy')}Kopieer regels</button>
      ${p.exact === 'in_exact' ? `<span class="chip ok">${icon('check')}Staat in Exact${p.exact_op ? ` sinds ${h(dayTime(p.exact_op))}` : ''}</span><button type="button" class="lnk small" data-act="exact-back" data-id="${p.id}">Terugzetten</button>`
        : `<button type="button" class="btn btn-sm btn-leaf" data-act="exact-in" data-id="${p.id}"${ready ? '' : ' disabled'} title="${ready ? '' : p.verzonden_op ? 'Kijk eerst de twijfels na' : 'Wacht op het verzendbewijs'}">${icon('check')}Staat in Exact</button>
           ${ready ? '' : `<span class="small faint">${p.verzonden_op ? 'Eerst de regels nakijken waar de desk over twijfelt.' : 'De inkooporder komt uit het verzendbewijs.'}</span>`}`}
    </div>
  </div>`;
}

export function docsRow(p, { add = true } = {}) {
  return `<div class="docs">${p.docs.map(x => `<button type="button" class="doc" data-act="doc" data-p="${p.id}" data-d="${x.id}">${icon(x.bestand_id ? 'file' : 'mail')}<span><b>${h(x.titel || DOC[x.soort])}</b><small>${h(DOC[x.soort])} · ${h(dayTime(x.ontvangen))}${x.gelezen_door === 'ai' ? ' · gelezen door de desk' : ''}</small></span></button>`).join('')}
    ${add ? `<button type="button" class="doc add" data-act="doc-add" data-p="${p.id}">${icon('upload')}<span><b>Papier toevoegen</b><small>pdf, foto of geplakte mail</small></span></button>` : ''}</div>`;
}

// the lines the desk doubts, with the two answers right there
export function doubts(p) {
  const d = p.regels.filter(r => r.twijfel);
  if (!d.length) return '';
  return `<div class="warnbox wait doubts">${icon('warn')}<div>${d.map(r => `<p><b>${h(r.product)} ${h(r.maat)}:</b> ${h(r.twijfel)}</p>
    <p class="acts"><button type="button" class="btn btn-sm btn-leaf" data-act="line-ok" data-id="${r.id}">${fNum(r.verzonden)} klopt</button><button type="button" class="btn btn-sm btn-line" data-act="line-edit" data-id="${r.id}" data-p="${p.id}">Aanpassen</button>
    <button type="button" class="btn btn-sm btn-ghost" data-act="doc" data-p="${p.id}" data-d="${(p.docs.find(x => x.soort === 'verzendbewijs') || p.docs[p.docs.length - 1] || {}).id || ''}">Bekijk het origineel</button></p>`).join('')}</div></div>`;
}

// ---------------------------------------------------------------- the original next to what the desk read from it
export function showDoc(p, doc) {
  if (!doc) return;
  const dlg = document.getElementById('dlg');
  const f = { bestelling: 'besteld', bevestiging: 'bevestigd', verzendbewijs: 'verzonden' }[doc.soort];
  const read = f ? `<table class="tb"><thead><tr><th>Wat de desk las</th><th class="r">Dozen</th>${f === 'verzonden' ? '<th class="r">Prijs</th><th class="r">Zeker</th>' : ''}</tr></thead><tbody>
      ${p.regels.map(r => `<tr class="${r.twijfel && f === 'verzonden' ? 'doubt' : ''}"><td>${h(r.product)} ${h(r.maat)}</td><td class="r num"><b>${r[f] == null ? '–' : fNum(r[f])}</b></td>${f === 'verzonden' ? `<td class="r num">${fUsdUnit(r.prijs_usd)}</td><td class="r">${r.zekerheid != null ? `<span class="conf ${r.zekerheid >= 90 ? 'hi' : r.zekerheid >= 75 ? 'mid' : 'lo'}">${r.zekerheid}%</span>` : ''}</td>` : ''}</tr>`).join('')}
    </tbody></table>${f === 'verzonden' ? `<dl class="kv small" style="margin-top:10px"><dt>AWB</dt><dd>${h(p.awb || '–')}</dd><dt>Vlucht</dt><dd>${h(p.vlucht || '–')}</dd><dt>Fytosanitair</dt><dd>${h(p.fyto || '–')}</dd></dl>` : ''}` : '';
  dlg.classList.add('dlg-wide');
  dlg.innerHTML = `<form method="dialog"><header><h2>${h(doc.titel || DOC[doc.soort])} · ${h(p.nummer)}</h2></header>
    <div class="body docview"><div class="orig">${doc.bestand_id ? `<iframe src="/api/bestanden/${doc.bestand_id}" title="Origineel"></iframe><a class="lnk small" href="/api/bestanden/${doc.bestand_id}" target="_blank" rel="noopener">Open het origineel apart</a>` : `<pre class="mailtxt" style="max-height:none">${h(doc.tekst || '')}</pre>`}</div>
      <div>${read || '<p class="muted">Dit papier hoort bij de zending; er zijn geen aantallen uit gelezen.</p>'}<p class="small faint" style="margin-top:10px">${doc.gelezen_door === 'ai' ? 'Gelezen door de desk.' : doc.gelezen_door === 'regels' ? 'Gelezen met vaste regels.' : 'Door Jan ingevoerd.'} Ontvangen ${h(dayTime(doc.ontvangen))}.</p></div></div>
    <footer><button class="btn btn-leaf" value="cancel" type="submit">Sluiten</button></footer></form>`;
  dlg.addEventListener('close', () => dlg.classList.remove('dlg-wide'), { once: true });
  dlg.showModal();
}

// a notice about the world, from Jan
export function noticeDialog(ctx, { partij = null, plekken = {} } = {}) {
  const codes = Object.keys(plekken).filter(c => c !== 'NTD');
  dialog({
    title: 'Melding over de route', ok: 'Opslaan',
    body: `<div class="form">${field('titel', 'Wat is er', '', { wide: true, required: true, hint: 'Bijvoorbeeld: staking grondpersoneel Schiphol zondag.' })}
      ${field('ernst', 'Hoe erg', 'let_op', { opts: [['let_op', 'Let op (oranje)'], ['probleem', 'Echt een probleem (rood)']] })}
      ${field('soort', 'Soort', 'staking', { opts: [['staking', 'Staking'], ['weer', 'Weer'], ['storm', 'Storm'], ['vulkaan', 'Vulkaan of as'], ['douane', 'Douane of keuring'], ['capaciteit', 'Geen vrachtruimte'], ['vertraging', 'Vertraging'], ['overig', 'Iets anders']] })}
      ${field('plek', 'Waar', partij ? '' : 'AMS', { opts: [['', 'Elke route'], ...codes.map(c => [c, `${c} · ${plekken[c].stad}`]), ['CR', 'Heel Costa Rica'], ['GT', 'Heel Guatemala'], ['NL', 'De weg naar Nootdorp']] })}
      ${field('vertraging_uren', 'Hoeveel uur later (mag leeg)', '', { type: 'number' })}
      ${field('tot', 'Tot wanneer (mag leeg)', '', { type: 'datetime-local' })}
      ${field('tekst', 'Meer uitleg (mag leeg)', '', { type: 'textarea', wide: true })}</div>
      <p class="small faint">De melding telt mee voor elke zending die over die plek komt, tot de eindtijd of tot je hem op opgelost zet.</p>`,
    onOk: async v => { await api('/week/meldingen', { method: 'POST', body: { ...v, tot: iso(v.tot), partij_id: partij } }); toast('Melding opgeslagen.'); ctx.refresh(); },
  });
}

// ---------------------------------------------------------------- the buttons of a shipment (find gives the shipment by id)
export function partijActions(find) {
  return {
    doc: el => { const p = find(el.dataset.p); if (p) showDoc(p, p.docs.find(x => x.id === Number(el.dataset.d))); },
    'doc-add': (el, ctx) => {
      const p = find(el.dataset.p);
      dialog({
        title: `Papier bij ${p.nummer}`, ok: 'Lezen en toevoegen',
        body: `<div class="form">${field('soort', 'Wat is het', p.stage === 'besteld' ? 'bevestiging' : 'verzendbewijs', { opts: [['bevestiging', 'Bevestiging van de leverancier'], ['verzendbewijs', 'Verzendpapieren (factura, packing list)'], ['awb', 'AWB'], ['fyto', 'Fytosanitair certificaat'], ['overig', 'Iets anders']] })}
          <label class="f wide">Pdf of foto<input type="file" name="bestand" accept="application/pdf,image/png,image/jpeg,image/webp"></label>
          ${field('tekst', 'Of plak de mail of het appje', '', { type: 'textarea', wide: true })}</div>
          <p class="small faint">De desk leest de dozen en prijzen en zet ze bij de regels. Twijfelt hij, dan zie je dat hier en kies jij.</p>`,
        onOk: async (v, dlg) => {
          const file = dlg.querySelector('input[type=file]').files[0];
          const body = { soort: v.soort, tekst: v.tekst || '' };
          if (file) Object.assign(body, { naam: file.name, mime: file.type, data: await readFile(file) });
          const r = await api(`/week/partijen/${p.id}/document`, { method: 'POST', body });
          toast(r.gelezen != null ? `${r.gelezen} regels gelezen${r.twijfel ? `, ${r.twijfel} om na te kijken` : ''}${r.onbekend?.length ? `; niet herkend: ${r.onbekend.slice(0, 2).join(', ')}` : ''}.` : 'Toegevoegd.');
          ctx.refresh();
        },
      });
    },
    'line-ok': async (el, ctx) => { await api(`/week/regels/${el.dataset.id}`, { method: 'PATCH', body: { nagekeken: true } }); toast('Nagekeken.'); ctx.refresh(); },
    'line-edit': (el, ctx) => {
      const p = find(el.dataset.p), r = p.regels.find(x => x.id === Number(el.dataset.id));
      dialog({
        title: `${r.product} ${r.maat} · ${p.nummer}`, ok: 'Opslaan',
        body: `<div class="form">${field('besteld', 'Besteld (dozen)', r.besteld ?? '', { type: 'number' })}${field('bevestigd', 'Bevestigd', r.bevestigd ?? '', { type: 'number' })}
          ${field('verzonden', 'Verzonden (verzendbewijs)', r.verzonden ?? '', { type: 'number' })}${field('prijs_usd', 'Inkoopprijs $ per stuk', String(r.prijs_usd).replace('.', ','))}</div>
          ${r.twijfel ? `<p class="small" style="color:var(--wait);margin-top:10px">${h(r.twijfel)}</p>` : ''}`,
        onOk: async v => { await api(`/week/regels/${r.id}`, { method: 'PATCH', body: { ...v, nagekeken: true } }); toast('Opgeslagen.'); ctx.refresh(); },
      });
    },
    stage: async (el, ctx) => { await api(`/week/partijen/${el.dataset.id}/stap`, { method: 'POST', body: { stap: el.dataset.stap } }); toast('Verwerkt.'); ctx.refresh(); },
    nummer: (el, ctx) => dialog({
      title: 'Zendnummer', ok: 'Opslaan',
      body: `${field('nummer', 'Zendnummer (C op het plantenpaspoort, kostendrager in Exact)', el.dataset.nr)}<p class="small faint" style="margin-top:8px">Regiocode vooraan, daarna jaar en volgnummer, bijvoorbeeld CR26-048. Elk nummer is uniek.</p>`,
      onOk: async v => { await api(`/week/partijen/${el.dataset.id}`, { method: 'PATCH', body: { nummer: v.nummer } }); toast('Zendnummer opgeslagen.'); ctx.refresh(); },
    }),
    route: (el, ctx) => {
      const p = find(el.dataset.p);
      dialog({
        title: `Route van ${p.nummer}`, ok: 'Opslaan',
        body: `${field('route', 'Luchthavens, van vertrek tot aankomst', (p.route || []).join(' '), { hint: 'Bijvoorbeeld SJO AMS, of GUA MIA AMS met een overstap in Miami. Daarna rijdt de vrachtwagen naar Nootdorp.' })}
          ${field('verwacht_op', 'In de loods verwacht (mag leeg: maandag 07:00)', localInput(p.verwacht_op), { type: 'datetime-local' })}`,
        onOk: async v => { await api(`/week/partijen/${p.id}`, { method: 'PATCH', body: { route: v.route, verwacht_op: iso(v.verwacht_op) } }); toast('Route opgeslagen.'); ctx.refresh(); },
      });
    },
    'exact-copy': async el => {
      const p = find(el.dataset.id);
      await copy(['Artikel\tOmschrijving\tAantal\tPrijs USD\tBedrag USD\tKostendrager', ...p.exactRegels.map(l => [l.artikel, l.omschrijving, l.stuks, String(l.prijs_usd).replace('.', ','), String(l.bedrag_usd).replace('.', ','), l.kostendrager].join('\t'))].join('\n'));
    },
    'exact-in': (el, ctx) => dialog({
      title: 'Staat in Exact', ok: 'Staat in Exact',
      body: `${field('nummer', 'Nummer van de inkooporder in Exact (mag leeg)', '')}`,
      onOk: async v => { await api(`/week/partijen/${el.dataset.id}/exact`, { method: 'POST', body: { nummer: v.nummer || null } }); toast('Inkooporder staat in Exact.'); ctx.refresh(); },
    }),
    'exact-back': async (el, ctx) => { await api(`/week/partijen/${el.dataset.id}/exact`, { method: 'POST', body: { terug: true } }); toast('Teruggezet.'); ctx.refresh(); },
    'melding-weg': async (el, ctx) => { await api(`/week/meldingen/${el.dataset.id}/opgelost`, { method: 'POST', body: {} }); toast('Melding op opgelost gezet.'); ctx.refresh(); },
  };
}

export { regio, zn, stageChip };
