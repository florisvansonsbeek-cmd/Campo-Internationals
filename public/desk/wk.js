// Shared bits of the weekly rhythm: weeks and days, dollars and euros, the week switcher and small labels.
import { h, icon, fNum } from './core.js';

const TZ = 'Europe/Amsterdam';
const day = s => new Date(`${String(s).slice(0, 10)}T12:00:00`);
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (s, n) => { const d = day(s); d.setDate(d.getDate() + n); return ymd(d); };
export function isoWeek(s) {
  const d = day(s), t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const wd = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - wd);
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}
const F = o => new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, ...o });
const DL = F({ weekday: 'long', day: 'numeric', month: 'long' }), DS = F({ weekday: 'short', day: 'numeric', month: 'short' }), DM = F({ day: 'numeric', month: 'long' }), TM = F({ hour: '2-digit', minute: '2-digit' });
export const dLong = s => (s ? DL.format(day(s)) : '');
export const dShort = s => (s ? DS.format(day(s)).replace('.', '') : '');
export const dMonth = s => (s ? DM.format(day(s)) : '');
export const tTime = v => (v ? TM.format(new Date(v)) : '');
export const dayTime = v => (v ? `${DS.format(new Date(v)).replace('.', '')} ${TM.format(new Date(v))}` : '');
export const today = () => ymd(new Date());

const nf = (min, max) => new Intl.NumberFormat('nl-NL', { minimumFractionDigits: min, maximumFractionDigits: max });
export const fUsd = (v, d = 2) => (v == null ? '–' : `$ ${nf(d, d).format(Number(v))}`);
export const fUsdUnit = v => (v == null ? '–' : `$ ${nf(2, 4).format(Number(v))}`);
export const fEur2 = v => (v == null ? '–' : `€ ${nf(2, 2).format(Number(v))}`);
export const fEurUnit = v => (v == null ? '–' : `€ ${nf(4, 4).format(Number(v))}`);
export const fKoers = v => (v == null ? '–' : nf(4, 4).format(Number(v)));
export const dozen = n => `${fNum(n)} ${Number(n) === 1 ? 'doos' : 'dozen'}`;

// ‹ week 48 · Week 49 · week 50 ›
export function weekNav(page, m, extra = '') {
  const w = isoWeek(m), p = addDays(m, -7), n = addDays(m, 7);
  return `<nav class="wknav" aria-label="Andere week">
    <a href="#/${page}?maandag=${p}${extra}" aria-label="Week ${isoWeek(p)}">${icon('back')}<span>wk ${isoWeek(p)}</span></a>
    <span class="wknav-now"><b>Week ${w}</b><small>${h(dShort(m))}</small></span>
    <a href="#/${page}?maandag=${n}${extra}" aria-label="Week ${isoWeek(n)}"><span>wk ${isoWeek(n)}</span>${icon('back', 'flip')}</a>
  </nav>`;
}

export const STAGE = {
  gepland: { naam: 'Nog niet besteld', toon: '' }, besteld: { naam: 'Besteld', toon: 'info' }, bevestigd: { naam: 'Bevestigd', toon: 'brass' },
  verzonden: { naam: 'In het vliegtuig', toon: 'ok' }, binnen: { naam: 'Binnen', toon: 'ok' },
};
export const stageChip = s => { const x = STAGE[s] || { naam: s, toon: '' }; return `<span class="chip ${x.toon}">${h(x.naam)}</span>`; };
export const regio = code => `<span class="rg" title="Regio">${h(code)}</span>`;
export const zn = nr => `<span class="zn">${h(nr)}</span>`;

// a change between two counts: "−6" in rust, "+2" in brass, with the percentage on hover
export function delta(a, b) {
  if (a == null || b == null || Number(a) === Number(b)) return '';
  const d = Number(b) - Number(a), pct = a ? Math.round((d / a) * 100) : null;
  return `<span class="dl ${d < 0 ? 'min' : 'plus'}" title="${pct == null ? '' : `${pct > 0 ? '+' : ''}${pct}%`}">${d > 0 ? '+' : '−'}${fNum(Math.abs(d))}</span>`;
}

// the order as the supplier reads it
export function spanishLine(p) {
  const n = String(p.naam || p.product || '');
  const what = /hockey/i.test(n) ? "'hockey stick'" : /stam/i.test(n) ? 'caña' : /kopstek/i.test(n) ? 'esqueje' : n;
  return `${p.soort} ${what} ${p.maat}`;
}

// the plant passport as it is printed: EU flag, A to D
export function passportHtml(p, local = 'Plantenpaspoort') {
  const stars = Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return `<circle cx="${(15 + 6.2 * Math.cos(a)).toFixed(2)}" cy="${(10 + 6.2 * Math.sin(a)).toFixed(2)}" r="0.95"/>`; }).join('');
  return `<div class="pp" role="group" aria-label="Plantenpaspoort ${h(p.c)}">
    <div class="pp-h"><svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#003399"/><g fill="#ffcc00">${stars}</g></svg><span><b>Plant Passport</b>${local ? `<small>${h(local)}</small>` : ''}</span></div>
    <dl><dt>A</dt><dd>${h(p.a)}</dd><dt>B</dt><dd>${h(p.b)}</dd><dt>C</dt><dd><b>${h(p.c)}</b></dd><dt>D</dt><dd>${h(p.d)}</dd></dl>
  </div>`;
}

// files the desk sends as base64
export const readFile = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('Het bestand kon niet worden gelezen.')); r.readAsDataURL(file); });
