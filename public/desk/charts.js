// Small, quiet charts: thin marks, hairline grid, one axis, a tooltip on hover and a table for every chart.
import { h, fNum } from './core.js';

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
let uid = 0;

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const compact = v => (Math.abs(v) >= 10000 ? `${fNum(v / 1000)}K` : fNum(v));
const tipAttr = lines => `data-tip="${h(lines.join('\n'))}"`;

function tableOf(head, rows) {
  return `<table class="tb" hidden><thead><tr>${head.map((x, i) => `<th${i ? ' class="r"' : ''}>${h(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((x, i) => `<td${i ? ' class="r num"' : ''}>${h(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
const toggle = '<button type="button" class="lnk tbl-toggle" data-act="chart-table">Als tabel</button>';

// a line with one end dot: shape only, the number sits next to it
export function spark(values, { w = 96, h: hh = 26, color = 'var(--s1)' } = {}) {
  const v = values.map(Number);
  const max = Math.max(...v, 1), min = 0;
  const step = v.length > 1 ? (w - 6) / (v.length - 1) : 0;
  const y = x => hh - 4 - ((x - min) / (max - min || 1)) * (hh - 8);
  const pts = v.map((x, i) => `${(3 + i * step).toFixed(1)},${y(x).toFixed(1)}`);
  const last = pts[pts.length - 1].split(',');
  return `<svg class="spark" viewBox="0 0 ${w} ${hh}" role="img" aria-label="Verloop: ${v.map(fNum).join(', ')}"><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="${color}" stroke="var(--sheet)" stroke-width="2"/></svg>`;
}

// columns from one baseline; tone per column is optional (status), otherwise one colour
// how many bars share one label, so the labels under the bars never run into each other
const labelStep = (data, width) => Math.max(1, Math.ceil((data.length * (Math.max(0, ...data.map(d => String(d.label ?? '').length)) * 6.6 + 10)) / width));

export function columns(data, { height = 170, fmt = fNum, unit = '', title = '', color = 'var(--s1)', max: fixedMax = null } = {}) {
  const W = 560, H = height, L = 40, R = 8, T = 10, B = 24;
  const max = fixedMax ?? niceMax(Math.max(...data.map(d => Number(d.value) || 0), 0));
  const bw = (W - L - R) / Math.max(1, data.length);
  const barW = Math.min(24, bw * 0.62);
  const y = v => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max], every = labelStep(data, W - L - R);
  const showLabel = i => (i % every === 0 && data.length - 1 - i >= every / 2) || i === data.length - 1;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(title)}">`;
  for (const t of ticks) s += `<line class="${t ? 'gl' : 'bl'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${compact(t)}${unit}</text>`;
  data.forEach((d, i) => {
    const v = Number(d.value) || 0, x = L + i * bw + (bw - barW) / 2, top = y(v), base = y(0);
    const hgt = Math.max(0, base - top), r = Math.min(4, hgt / 2, barW / 2);
    const fill = d.color || color;
    if (hgt > 0) s += `<path d="M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z" fill="${fill}"/>`;
    if (showLabel(i)) s += `<text class="ax" x="${x + barW / 2}" y="${H - 6}" text-anchor="middle">${h(d.label)}</text>`;
    s += `<rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" ${tipAttr([d.tipTitle || d.label, d.tip || `${fmt(v)}${unit}`])}/>`;
  });
  s += '</svg>';
  return `<div class="chart">${title ? `<p class="ctitle">${h(title)}</p>` : ''}${s}${toggle}${tableOf(['', title || 'Waarde'], data.map(d => [d.tipTitle || d.label, `${fmt(Number(d.value) || 0)}${unit}`]))}</div>`;
}

// revenue split in two parts that add up: purchase + margin
export function stacked(data, parts, { height = 190, fmt = fNum, title = '' } = {}) {
  const W = 560, H = height, L = 46, R = 8, T = 10, B = 24;
  const max = niceMax(Math.max(...data.map(d => parts.reduce((s, p) => s + (Number(d[p.key]) || 0), 0)), 0));
  const bw = (W - L - R) / Math.max(1, data.length), barW = Math.min(24, bw * 0.62);
  const y = v => T + (H - T - B) * (1 - v / max), every = labelStep(data, W - L - R);
  const showLabel = i => (i % every === 0 && data.length - 1 - i >= every / 2) || i === data.length - 1;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(title)}">`;
  for (const t of [0, max / 2, max]) s += `<line class="${t ? 'gl' : 'bl'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`;
  data.forEach((d, i) => {
    const x = L + i * bw + (bw - barW) / 2;
    let acc = 0;
    parts.forEach((p, j) => {
      const v = Math.max(0, Number(d[p.key]) || 0);
      if (!v) return;
      const y0 = y(acc), y1 = y(acc + v);
      const gap = j > 0 ? 2 : 0;
      const isTop = j === parts.length - 1 || parts.slice(j + 1).every(q => !(Number(d[q.key]) > 0));
      const hgt = Math.max(0, y0 - y1 - gap), r = isTop ? Math.min(4, hgt / 2) : 0;
      const top = y1, base = y0 - gap;
      s += `<path d="M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z" fill="${p.color}"/>`;
      acc += v;
    });
    if (showLabel(i)) s += `<text class="ax" x="${x + barW / 2}" y="${H - 6}" text-anchor="middle">${h(d.label)}</text>`;
    s += `<rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" ${tipAttr([d.tipTitle || d.label, ...parts.map(p => `${p.name}: ${fmt(Number(d[p.key]) || 0)}`)])}/>`;
  });
  s += '</svg>';
  const legend = `<p class="legend">${parts.map(p => `<span><i style="background:${p.color};height:10px;width:10px;border-radius:2px"></i>${h(p.name)}</span>`).join('')}</p>`;
  return `<div class="chart">${title ? `<p class="ctitle">${h(title)}</p>` : ''}${legend}${s}${toggle}${tableOf(['', ...parts.map(p => p.name)], data.map(d => [d.tipTitle || d.label, ...parts.map(p => fmt(Number(d[p.key]) || 0))]))}</div>`;
}

// several lines over the same months; end labels plus a legend, crosshair tooltip
// join: draw over weeks without a value (prices of a plant that does not come every week), instead of a gap
export function lines(labels, series, { height = 200, fmt = v => fNum(v), title = '', min: fixedMin = null, join = false } = {}) {
  const id = `c${++uid}`;
  const W = 560, H = height, L = 46, R = 110, T = 12, B = 24;
  const all = series.flatMap(s => s.values.filter(v => v != null).map(Number));
  if (!all.length) return '<p class="faint small">Nog geen gegevens.</p>';
  let lo = fixedMin ?? Math.min(...all), hi = Math.max(...all);
  if (fixedMin == null) { const pad = (hi - lo) * 0.15 || hi * 0.1 || 1; lo = Math.max(0, lo - pad); hi = hi + pad; }
  const x = i => L + (labels.length > 1 ? i * (W - L - R) / (labels.length - 1) : (W - L - R) / 2);
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(title)}">`;
  for (const t of [lo, (lo + hi) / 2, hi]) s += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${h(fmt(t))}</text>`;
  s += `<line class="bl" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  const every = Math.ceil(labels.length / 7);
  // every few weeks a label, and the last one; a regular label too close to the last one is left out
  labels.forEach((lab, i) => { if ((i % every === 0 && labels.length - 1 - i >= every / 2) || i === labels.length - 1) s += `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="middle">${h(lab)}</text>`; });
  const ends = [];
  series.forEach((se, k) => {
    const color = se.color || SERIES[k % SERIES.length];
    let d = '', pen = false;
    se.values.forEach((v, i) => { if (v == null) { if (!join) pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const li = se.values.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0).pop();
    if (li != null && li >= 0) { s += `<circle cx="${x(li)}" cy="${y(se.values[li])}" r="4" fill="${color}" stroke="var(--sheet)" stroke-width="2"/>`; ends.push({ y: y(se.values[li]), x: x(li), name: se.name, v: se.values[li] }); }
  });
  // end labels, nudged apart so they never collide
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  if (series.length <= 4) for (const e of ends) s += `<text class="lab" x="${e.x + 8}" y="${e.y + 4}">${h(String(e.name).slice(0, 16))}</text>`;
  // hover columns
  labels.forEach((lab, i) => {
    const w = labels.length > 1 ? (W - L - R) / (labels.length - 1) : W - L - R;
    const tips = [lab, ...series.map(se => `${se.name}: ${se.values[i] == null ? '–' : fmt(se.values[i])}`)];
    s += `<g class="hc"><rect class="hit" x="${x(i) - w / 2}" y="${T}" width="${w}" height="${H - T - B}" ${tipAttr(tips)}/><line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}" stroke="var(--ink-3)" stroke-width="1" class="guide"/>${series.map((se, k) => (se.values[i] == null ? '' : `<circle cx="${x(i)}" cy="${y(se.values[i])}" r="4" fill="${se.color || SERIES[k % SERIES.length]}" stroke="var(--sheet)" stroke-width="2" class="guide"/>`)).join('')}</g>`;
  });
  s += '</svg>';
  const legend = series.length > 1 ? `<p class="legend">${series.map((se, k) => `<span><i style="background:${se.color || SERIES[k % SERIES.length]}"></i>${h(se.name)}</span>`).join('')}</p>` : '';
  return `<div class="chart" id="${id}">${title ? `<p class="ctitle">${h(title)}</p>` : ''}${legend}${s}${toggle}${tableOf(['', ...series.map(se => se.name)], labels.map((lab, i) => [lab, ...series.map(se => (se.values[i] == null ? '–' : fmt(se.values[i])))]))}</div>`;
}

// shares as horizontal bars, value at the tip
export function hbars(data, { fmt = v => `${v}%`, max = null, title = '' } = {}) {
  const m = max ?? Math.max(...data.map(d => Number(d.value) || 0), 1);
  return `<div class="chart">${title ? `<p class="ctitle">${h(title)}</p>` : ''}<div style="display:grid;gap:8px">${data.map(d => `
    <div style="display:grid;grid-template-columns:minmax(120px,38%) minmax(0,1fr) auto;gap:10px;align-items:center;font-size:13.5px" ${tipAttr([d.label, d.tip || fmt(d.value)])}>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(d.label)}${d.sub ? ` <span class="faint">${h(d.sub)}</span>` : ''}</span>
      <span style="height:10px;background:var(--paper-2);border-radius:0 4px 4px 0"><span style="display:block;height:100%;width:${Math.max(1, (Number(d.value) || 0) / m * 100)}%;background:${d.color || 'var(--s1)'};border-radius:0 4px 4px 0"></span></span>
      <span class="num" style="font-weight:600;min-width:42px;text-align:right">${h(fmt(d.value))}</span>
    </div>`).join('')}</div></div>`;
}

// tooltips and the table toggle, for every chart on the page
export function chartEvents(root = document) {
  root.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-tip]');
    const chart = e.target.closest('.chart');
    if (!chart) return;
    let tip = chart.querySelector('.tip');
    if (!t) { if (tip) tip.hidden = true; return; }
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; chart.append(tip); }
    const [first, ...rest] = t.dataset.tip.split('\n');
    tip.innerHTML = `<b>${h(first)}</b>${rest.map(r => `<br>${h(r)}`).join('')}`;
    const cr = chart.getBoundingClientRect(), r = t.getBoundingClientRect();
    tip.style.left = `${Math.min(cr.width - 60, Math.max(60, r.left - cr.left + r.width / 2))}px`;
    tip.style.top = `${r.top - cr.top + 10}px`;
    tip.hidden = false;
  });
  root.addEventListener('mouseout', e => {
    const chart = e.target.closest('.chart');
    if (chart && !chart.contains(e.relatedTarget)) { const tip = chart.querySelector('.tip'); if (tip) tip.hidden = true; }
  });
}
