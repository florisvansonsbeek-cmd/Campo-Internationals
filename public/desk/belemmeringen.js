// What stands in the way of working with a customer or grower, shown the same way everywhere.
// The obstacles are worked out on the server (src/analytics.js, obstaclesCustomer and obstaclesGrower).
import { h, icon, plural } from './core.js';

export const KIND = { bezorgen: 'Bezorgen', betalen: 'Betalen', bestellen: 'Bestellen', compleet: 'Compleet', kwaliteit: 'Kwaliteit', prijs: 'Prijs', contact: 'Contact' };
export const KIND_ORDER = ['bezorgen', 'betalen', 'bestellen', 'compleet', 'kwaliteit', 'prijs', 'contact'];

// a few chips for a table row, the worst first; the sentence behind each chip shows on hover
export function obstacleChips(list, max = 3) {
  if (!list || !list.length) return '<span class="obs-none">Geen</span>';
  const more = list.length - max;
  return `<span class="obs">${list.slice(0, max).map(o => `<span class="chip ${o.toon}" title="${h(`${KIND[o.soort] || o.soort}: ${o.tekst}`)}">${h(o.kort)}</span>`).join('')}${more > 0 ? `<span class="obs-more">+${more}</span>` : ''}</span>`;
}

// the panel on the page of one customer or grower
export function obstaclePanel(list, wie) {
  const n = (list || []).length;
  return `<section class="panel obs-panel"><header><h2>Belemmeringen bij samenwerken</h2><span class="sub">${n ? plural(n, 'punt', 'punten') : 'Niets dat het samenwerken lastig maakt'}</span></header>
    <div class="body">${n ? `<ul class="insights">${list.map(o => `<li class="${o.toon}">${icon(o.toon === 'bad' ? 'warn' : 'clock')}<span><b>${h(KIND[o.soort] || o.soort)}.</b> ${h(o.tekst)}</span></li>`).join('')}</ul>`
      : `<p class="muted">Geen belemmeringen: met deze ${wie} loopt het samenwerken zonder haken en ogen.</p>`}</div></section>`;
}
