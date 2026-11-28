// Bestellen en relaties: everything around ordering and the people Campo trades with, in one tab. The slider on top
// picks the part, each card already saying how it stands: ordering on Tuesday, good one-to-one deals to seal, possible
// new customers, what threatens the transport, the suppliers and the customers under a magnifying glass, and what the
// plants cost and fetch. Every part is its own small page below the slider.
import { api, h, icon, fNum, fEur } from '../core.js';
import { dShort, dayTime } from '../wk.js';
import * as bestellen from './bestellen.js';
import * as relaties from './relaties.js';
import * as vervoer from './vervoer.js';

export const PARTS = [
  ['bestellen', 'Bestellen', 'phone'], ['deals', 'Deals', 'tag'], ['kansen', 'Nieuwe klanten', 'star'], ['vervoer', 'Vervoer', 'plane'],
  ['leveranciers', 'Leveranciers', 'grower'], ['klanten', 'Klanten', 'customer'], ['planten', 'Planten', 'plant'],
];
const pctTxt = v => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v * 100).toFixed(1).replace('.', ',')}%`);

// one card: what the part is and, in a few words, how it stands now
function lineOf(k, s) {
  if (!s) return { a: '', b: '', t: '' };
  if (k === 'bestellen') {
    const b = s.bestellen;
    const when = b.besteld ? `besteld ${dShort(String(b.besteld).slice(0, 10))}` : b.vandaag === b.bestellen ? 'vandaag bestellen' : `${b.vandaag > b.bestellen ? 'was' : 'bestellen'} ${dShort(b.bestellen)}`;
    return { a: `${fNum(b.klanten)} ${b.klanten === 1 ? 'klant' : 'klanten'} · ${fNum(b.dozen)} dz`, b: when, t: !b.besteld && b.vandaag >= b.bestellen ? 'wait' : '' };
  }
  if (k === 'deals') { const d = s.deals; return { a: d.open ? `${fNum(d.open)} ${d.open === 1 ? 'deal' : 'deals'} · ${fEur(d.marge)}` : 'geen open aanbod', b: d.vrij ? `${fNum(d.vrij)} dz zonder koper` : 'alles heeft een koper', t: d.open || d.vrij ? 'brass' : '' }; }
  if (k === 'kansen') { const n = s.kansen.open - s.kansen.klanten; return { a: `${fNum(s.kansen.klanten)} ${s.kansen.klanten === 1 ? 'kans' : 'kansen'}`, b: n ? `+ ${n} ${n === 1 ? 'leverancier' : 'leveranciers'}` : 'om te bellen', t: s.kansen.klanten ? 'brass' : '' }; }
  if (k === 'vervoer') { const v = s.vervoer; return { a: v.rood ? `${fNum(v.rood)} in gevaar` : v.oranje ? `${fNum(v.oranje)} let op` : 'alles op schema', b: v.meldingen ? `${fNum(v.meldingen)} ${v.meldingen === 1 ? 'melding' : 'meldingen'} open` : `${fNum(v.zendingen)} ${v.zendingen === 1 ? 'zending' : 'zendingen'}`, t: v.rood ? 'bad' : v.oranje ? 'wait' : 'ok' }; }
  if (k === 'leveranciers') { const l = s.leveranciers; return { a: `${fNum(l.aantal)} leveranciers`, b: l.letop ? `${fNum(l.letop)} om op te letten` : l.gem != null ? `score gem. ${l.gem}` : '', t: l.letop ? 'wait' : '' }; }
  if (k === 'klanten') { const c = s.klanten; return { a: `${fNum(c.aantal)} klanten`, b: [c.top ? `${c.top} top` : '', c.slapend ? `${c.slapend} slapend` : '', !c.slapend && c.kansen ? `${c.kansen} kansen` : ''].filter(Boolean).join(' · '), t: c.slapend ? 'wait' : '' }; }
  if (k === 'planten') { const p = s.planten; return p ? { a: `inkoop ${pctTxt(p.inkoop)}`, b: `verkoop ${pctTxt(p.verkoop)}`, t: p.inkoop != null && p.verkoop != null && p.inkoop > p.verkoop + 0.01 ? 'wait' : '' } : { a: '', b: '', t: '' }; }
  return { a: '', b: '', t: '' };
}

// the chosen card in view inside the slider, without moving the page
export function centerSlider() {
  const t = document.querySelector('.sl-track'), on = t && t.querySelector('.sl-card.on');
  if (!t) return;
  if (on && t.scrollWidth > t.clientWidth) t.scrollLeft = Math.max(0, on.offsetLeft - (t.clientWidth - on.clientWidth) / 2);
  // a soft edge where more cards are hidden, so it is clear the slider slides
  const edge = () => { const s = t.parentElement; s.classList.toggle('more-r', t.scrollLeft + t.clientWidth < t.scrollWidth - 4); s.classList.toggle('more-l', t.scrollLeft > 4); };
  edge();
  t.addEventListener('scroll', edge, { passive: true });
}
export function sliderHtml(parts, cur, base, s, lineFn) {
  return `<nav class="slider" aria-label="Kies een deel"><div class="sl-track">${parts.map(([k, l]) => {
    const x = lineFn(k, s);
    return `<a class="sl-card${k === cur ? ' on' : ''}${x.t ? ` t-${x.t}` : ''}" href="#/${base}?deel=${k}" ${k === cur ? 'aria-current="page"' : ''} data-k="${k}">
      <b>${h(l)}</b><span class="sl-a">${h(x.a || '')}</span><small>${h(x.b || '')}</small></a>`;
  }).join('')}</div></nav>`;
}

let cur = 'bestellen';
export async function render(params, query) {
  const pad = params.pad || 'handel';
  let part = query.get('deel') || (pad === 'relaties' ? query.get('soort') || 'klanten' : pad === 'klanten' ? 'klanten' : 'bestellen');
  if (!PARTS.some(p => p[0] === part)) part = 'bestellen';
  cur = part;
  const m = query.get('maandag');
  const body = part === 'bestellen' || part === 'deals' || part === 'kansen' ? bestellen.renderPart(part, query)
    : part === 'vervoer' ? vervoer.render(query) : relaties.renderPart(part, query);
  const [s, html] = await Promise.all([api(`/week/handel${m ? `?maandag=${m}` : ''}`).catch(() => null), body]);
  return `<div class="page wk hub">
    <div class="hub-h"><h1>Bestellen en relaties</h1><p>Bestellen, deals, nieuwe klanten, het vervoer, je leveranciers en klanten onder de loep, en wat de planten kosten.</p></div>
    ${sliderHtml(PARTS, part, 'handel', s, lineOf)}
    <div class="hub-b" id="h-${part}">${html}</div>
  </div>`;
}

export const actions = { ...bestellen.actions, ...relaties.actions, ...vervoer.actions };
export function mount(ctx) {
  if (cur === 'bestellen') bestellen.mount(ctx);
  centerSlider();
}
export function onChange(e, ctx) { return bestellen.onChange(e, ctx); }
export function onInput(e, ctx) { return relaties.onInput(e, ctx); }
