// Relaties: how good the customers and suppliers really are, from what really happened in the desk (ordered,
// delivered, counted, invoiced, paid), and where Jan could serve them more.
import { api, h, icon, fNum, fEur, toast, dialog, field, LANG } from '../core.js';
import { spark, lines as lineChart, columns } from '../charts.js';
import { fUsd, fUsdUnit } from '../wk.js';
import { scoreBar, partsList, kansList } from './leverancier.js';

let R = null, PL = null, soort = 'klanten', filter = 'alle', q = '';
const openPlant = new Set();
const SOORT = { kwekerij: 'Kwekerij', groothandel: 'Groothandel', tuincentrum: 'Tuincentrum', interieur: 'Interieur', bloemist: 'Bloemist', overig: 'Overig' };
const pct = v => (v == null ? '–' : `${Math.round(v * 100)}%`);
const sign = v => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`);

const FILTERS = [
  ['alle', 'Alle', () => true], ['kansen', 'Met een kans', c => c.kansen.some(k => k.soort !== 'risico')], ['top', 'Topklanten', c => c.label.naam === 'Topklant'],
  ['slapend', 'Slapend', c => c.tags.some(t => t.naam === 'slapend')], ['laat', 'Betaalt laat', c => c.tags.some(t => t.naam === 'betaalt laat')], ['nu', 'Belde al', c => c.nu_dozen > 0],
];

function rowsHtml() {
  const t = q.trim().toLowerCase(), f = FILTERS.find(x => x[0] === filter)[2];
  const show = R.klanten.filter(c => f(c) && (!t || `${c.naam} ${c.plaats} ${c.contact || ''}`.toLowerCase().includes(t)));
  if (!show.length) return '<tr><td colspan="8" class="empty">Geen klant gevonden.</td></tr>';
  return show.map(c => {
    const best = c.kansen.find(k => k.soort !== 'risico') || c.kansen[0];
    return `<tr class="click" data-href="#/klant/${c.id}">
      <td><a href="#/klant/${c.id}"><b>${h(c.naam)}</b></a><small class="faint" style="display:block">${h(c.plaats)} · ${h(c.land)} · ${h(SOORT[c.soort] || c.soort)}</small>
        ${c.tags.length ? `<span class="tags">${c.tags.map(x => `<span class="chip ${h(x.toon)}">${h(x.naam)}</span>`).join('')}</span>` : ''}</td>
      <td>${scoreBar(c.score)}<small class="faint" style="display:block">${h(c.label.naam)}</small></td>
      <td class="r num">${fEur(c.omzet)}${c.reeks ? `<span class="sp">${spark(c.reeks)}</span>` : ''}</td>
      <td class="r num">${pct(c.marge_pct)}</td>
      <td class="r num">${fNum(c.weken)}<small class="faint"> wk</small><small class="faint" style="display:block">${sign(c.groei)}</small></td>
      <td>${c.betalen ? `${pct(c.betalen.opTijd)}<small class="faint" style="display:block">${c.betalen.open ? `${c.betalen.open} open` : c.betalen.gemDagen >= 1 ? `${Math.round(c.betalen.gemDagen)} d te laat` : 'op tijd'}</small>` : '<span class="faint">–</span>'}</td>
      <td class="r num">${c.nu_dozen ? `<b>${fNum(c.nu_dozen)}</b>` : '<span class="faint">–</span>'}</td>
      <td class="kn">${best ? `<span class="k-${best.soort === 'risico' ? 'bad' : 'ok'}">${h(best.tekst)}</span>` : '<span class="faint">–</span>'}</td>
    </tr>`;
  }).join('');
}

function customers() {
  const s = R.samen;
  return `<dl class="facts">
      <div><dt>Topklanten</dt><dd>${fNum(s.top)}<small>${pct(s.topAandeel)} van de omzet</small></dd></div>
      <div><dt>Met een kans</dt><dd>${fNum(s.kansen)}<small>meer te halen</small></dd></div>
      <div><dt>Slapend</dt><dd>${fNum(s.slapend)}<small>bestelden vaak, nu niet</small></dd></div>
      <div><dt>Betaalt laat</dt><dd>${fNum(s.laat)}<small>${R.betaalGegevens ? 'na de vervaldatum' : 'nog geen betaalgegevens'}</small></dd></div>
    </dl>
    ${R.inzichten.klanten.length ? `<section class="panel"><header><h2>Waar zit meer</h2><span class="sub">uit de omzet en de marge van het laatste half jaar</span></header>
      <ul class="ins">${R.inzichten.klanten.map(x => `<li><b>${h(x.titel)}</b><span>${h(x.tekst)}</span></li>`).join('')}</ul></section>` : ''}
    <div class="tools"><input type="search" placeholder="Zoek op naam of plaats" data-input="rq" value="${h(q)}" aria-label="Zoek klant">
      <div class="pick" role="group" aria-label="Filter">${FILTERS.map(([k, l, f]) => `<button type="button" data-act="f" data-f="${k}" aria-pressed="${filter === k}">${l}<small>${R.klanten.filter(f).length}</small></button>`).join('')}</div></div>
    <section class="panel"><div class="tbwrap"><table class="tb rel"><thead><tr><th>Klant</th><th>Score</th><th class="r">Omzet ½ jaar</th><th class="r">Marge</th><th class="r">Besteld</th><th>Betaalt op tijd</th><th class="r">Wk ${R.week}</th><th>Kans</th></tr></thead>
      <tbody id="rrows">${rowsHtml()}</tbody></table></div>
      <p class="small faint" style="padding:10px 16px 14px">De score telt trouw, omzet, groei (met het seizoen eruit gehaald), marge, betalen en hoeveel producten iemand neemt. Klik een klant voor de uitleg en wat je hem nog meer kunt bieden.</p></section>`;
}

function suppliers() {
  const shared = new Map();
  for (const s of R.leveranciers) for (const p of s.producten) if (p.prijs && p.stuks > 1000) { if (!shared.has(p.product_id)) shared.set(p.product_id, []); shared.get(p.product_id).push({ s, p }); }
  const both = [...shared.values()].filter(x => x.length > 1);
  return `<div class="sups">${R.leveranciers.map(s => `<section class="panel sup-c">
      <header><h2><a href="#/leverancier/${s.id}">${h(s.naam)}</a></h2>${s.score != null ? `<span class="badge-s" data-s="${s.score >= 70 ? 'g' : s.score >= 55 ? 'o' : 'r'}"><b>${s.score}</b><small>${h(s.label.naam)}</small></span>` : ''}</header>
      <div class="body stack"><p class="small muted">${h(s.regio_naam || s.regio)} · ${h(s.plaats || '')} · route ${h(s.route_tekst)} → Nootdorp</p>
        ${partsList(s.parts)}
        <dl class="facts mini"><div><dt>Zendingen</dt><dd>${fNum(s.zendingen)}</dd></div><div><dt>Aandeel</dt><dd>${pct(s.aandeel)}</dd></div><div><dt>Ingekocht</dt><dd>${fUsd(s.inkoop_usd, 0)}</dd></div><div><dt>Marge</dt><dd>${pct(s.marge_pct)}</dd></div></dl>
        <h3>Meer met hem doen</h3>${kansList(s.kansen.slice(0, 4))}
        <p><a class="btn btn-sm btn-line" href="#/leverancier/${s.id}">${icon('file')}Zijn zendingen, papieren en Excel</a></p></div></section>`).join('')}</div>
    ${both.length ? `<section class="panel"><header><h2>Hetzelfde product, twee leveranciers</h2><span class="sub">prijs per stuk en op tijd, laatste half jaar</span></header>
      <div class="tbwrap"><table class="tb"><thead><tr><th>Product</th>${both[0].map(() => '<th>Leverancier</th><th class="r">Prijs</th><th class="r">Op tijd</th>').join('')}</tr></thead><tbody>
      ${both.map(x => `<tr><td><b>${h(x[0].p.product.naam)} ${h(x[0].p.product.maat)}</b></td>${x.map(({ s, p }) => `<td>${h(s.naam)}</td><td class="r num">$ ${p.prijs.toFixed(3).replace('.', ',')}</td><td class="r num">${pct(s.parts.find(y => y.key === 'optijd').waarde)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></section>` : ''}
    ${R.inzichten.leveranciers.length ? `<section class="panel"><header><h2>Waar het kwetsbaar is</h2><span class="sub">en waar een nieuwe leverancier helpt</span></header>
      <ul class="ins">${R.inzichten.leveranciers.map(x => `<li><b>${h(x.titel)}</b><span>${h(x.tekst)}</span></li>`).join('')}</ul>
      <p class="small faint" style="padding:0 16px 14px">Nieuwe leveranciers en klanten die je kunt benaderen staan bij <a href="#/bestellen?deel=kansen">Bestellen</a>.</p></section>` : ''}`;
}

// ---------------------------------------------------------------- plants: what they cost and fetch, and where it is going
const usd3 = v => (v == null ? '–' : `$ ${Number(v).toFixed(3).replace('.', ',')}`);
const chg = (v, { pts = false, good = 'up' } = {}) => {
  if (v == null) return '<small class="faint">–</small>';
  const x = v * 100, s = Math.abs(x) < 0.5 ? 'flat' : (x > 0) === (good === 'up') ? 'good' : 'bad';
  return `<small class="chg ${s}">${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(1).replace('.', ',')}${pts ? ' pt' : '%'}</small>`;
};
// two lines in one small picture, each as its own change since the start: purchase (brass) and sales (green).
// When the brass line climbs above the green one, the purchase price rose faster than the selling price.
function spark2(a0, b0, { w = 124, hh = 30 } = {}) {
  const rel = v => { const f = v.find(x => x != null); return v.map(x => (x == null || !f ? null : x / f)); };
  const a = rel(a0), b = rel(b0);
  const all = [...a, ...b].filter(v => v != null);
  if (!all.length) return '';
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || hi * 0.1 || 1, n = Math.max(a.length, b.length), step = n > 1 ? (w - 4) / (n - 1) : 0;
  // weeks without a shipment are drawn over, so a plant that comes every other week is still one line
  const path = vals => vals.map((v, i) => (v == null ? '' : `${(2 + i * step).toFixed(1)},${(hh - 3 - ((v - lo) / span) * (hh - 6)).toFixed(1)}`)).filter(Boolean).map((pt, i) => `${i ? 'L' : 'M'}${pt}`).join('');
  return `<svg class="sp2" viewBox="0 0 ${w} ${hh}" width="${w}" height="${hh}" aria-hidden="true"><path d="${path(b)}" fill="none" stroke="#2b7a4b" stroke-width="1.7"/><path d="${path(a)}" fill="none" stroke="#7d6740" stroke-width="1.7"/></svg>`;
}
function plantDetail(p) {
  const last26 = PL.labels.slice(-26);
  return `<div class="pd">
    <div class="pd-c">${lineChart(PL.labels, [{ name: 'Verkoop', values: p.reeks.verkoop, color: '#2b7a4b' }, { name: 'Inkoop', values: p.reeks.inkoop, color: '#7d6740' }], { height: 210, fmt: v => usd3(v), join: true, title: `${p.naam} ${p.maat}: dollar per stuk, een jaar` })}
      ${columns(p.reeks.dozen_uit.slice(-26).map((v, i) => ({ label: last26[i], value: v })), { height: 130, title: 'Dozen naar klanten per week, een half jaar', color: '#2b7a4b' })}</div>
    <div class="pd-i stack">
      ${p.tips.length ? `<div><h3 class="h3s">Wat opvalt</h3>${kansList(p.tips)}</div>` : ''}
      <div><h3 class="h3s">Bij welke leverancier</h3><table class="tb"><thead><tr><th>Leverancier</th><th class="r">Laatste prijs</th><th class="r">13 weken</th><th class="r">Aandeel</th></tr></thead><tbody>
        ${p.leveranciers.map(l => `<tr><td><a href="#/leverancier/${l.id}">${h(l.naam)}</a></td><td class="r num">${usd3(l.laatst)}</td><td class="r num">${usd3(l.prijs13)}</td><td class="r num">${Math.round(l.aandeel * 100)}%</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nog geen inkoop.</td></tr>'}</tbody></table></div>
      <div><h3 class="h3s">Wie het meest neemt</h3><table class="tb"><tbody>${p.kopers.map(k => `<tr><td><a href="#/klant/${k.id}">${h(k.naam)}</a><small class="faint" style="display:block">${h(k.plaats)}</small></td><td class="r num">${fNum(k.dozen)} dozen</td><td class="r num">${fUsdUnit(k.prijs)}</td></tr>`).join('') || '<tr><td class="empty">Nog niemand dit kwartaal.</td></tr>'}</tbody></table>
        <p class="small faint">Laatste 13 weken. De lijstprijs is ${fUsdUnit(p.lijst_usd)} per stuk, de standaard inkoop ${fUsdUnit(p.standaard_usd)}.</p></div>
    </div></div>`;
}
function plants() {
  const x = PL, ix = x.index;
  const inkJ = ix.inkoopNu != null ? ix.inkoopNu / 100 - 1 : null, verJ = ix.verkoopNu != null ? ix.verkoopNu / 100 - 1 : null;
  const vol = x.producten.reduce((t, p) => t + p.volume, 0);
  const tipsN = x.producten.filter(p => p.tips.length).length;
  return `<dl class="facts">
      <div><dt>Inkoopprijzen</dt><dd>${chg(inkJ, { good: 'down' })}<small>in een jaar, zelfde mand planten</small></dd></div>
      <div><dt>Verkoopprijzen</dt><dd>${chg(verJ)}<small>in een jaar, op de pakbonnen</small></dd></div>
      <div><dt>Marge</dt><dd>${x.gemMarge != null ? `${Math.round(x.gemMarge * 100)}%` : '–'}<small>laatste 4 weken, in dollars</small></dd></div>
      <div><dt>Dozen per week</dt><dd>${fNum(vol)}<small>gemiddeld, laatste 13 weken</small></dd></div>
    </dl>
    <section class="panel"><header><h2>Prijzen in een jaar</h2><span class="sub">100 = begin van de periode, dezelfde mand planten</span></header>
      <div class="body">${lineChart(x.labels, [{ name: 'Verkoop', values: ix.verkoop, color: '#2b7a4b' }, { name: 'Inkoop', values: ix.inkoop, color: '#7d6740' }], { height: 200, fmt: v => String(Math.round(v * 10) / 10).replace('.', ','), title: 'Prijsindex inkoop en verkoop' })}
        <p class="small faint">Loopt de inkoop harder dan de verkoop, dan krimpt je marge. Per plant zie je hieronder waar het zit${tipsN ? `; bij ${tipsN} planten valt iets op` : ''}.</p></div></section>
    <section class="panel"><header><h2>Per plant</h2><span class="sub">dollar per stuk, laatste 4 weken tegen 13 weken eerder · klik voor het verloop</span></header>
      <div class="tbwrap"><table class="tb plants"><thead><tr><th>Plant</th><th class="r">Inkoop</th><th class="r">Verkoop</th><th class="r">Marge</th><th>Half jaar</th><th class="r">Dozen per week</th><th class="r">Wk ${x.week}</th></tr></thead><tbody>
      ${x.producten.map(p => `<tr class="click pl${openPlant.has(p.id) ? ' is-open' : ''}" data-act="plant" data-id="${p.id}" aria-expanded="${openPlant.has(p.id)}">
          <td><b>${h(p.naam)} ${h(p.maat)}</b><small class="faint" style="display:block">${h(p.soort)} · ${h(p.leveranciers.map(l => l.naam.replace(/ (S\.A\.|B\.V\.)$/, '')).join(', ') || '–')}</small>${p.tips.length ? `<small class="tipn">${p.tips.length === 1 ? '1 ding valt op' : `${p.tips.length} dingen vallen op`}</small>` : ''}</td>
          <td class="r num">${usd3(p.inkoop)}<br>${chg(p.d_inkoop13, { good: 'down' })}</td>
          <td class="r num">${usd3(p.verkoop)}<br>${chg(p.d_verkoop13)}</td>
          <td class="r num">${p.marge != null ? `${Math.round(p.marge * 100)}%` : '–'}<br>${chg(p.marge != null && p.marge13 != null ? p.marge - p.marge13 : null, { pts: true })}</td>
          <td>${spark2(p.reeks.inkoop.slice(-26), p.reeks.verkoop.slice(-26))}</td>
          <td class="r num">${fNum(p.volume)}<br>${chg(p.d_volume)}</td>
          <td class="r num">${p.deze_week.dozen ? `<b>${fNum(p.deze_week.dozen)}</b>` : '–'}<small class="faint" style="display:block">${p.deze_week.gevraagd ? `${fNum(p.deze_week.gevraagd)} gevraagd` : ''}</small></td></tr>
        <tr class="pdr" id="pd${p.id}"${openPlant.has(p.id) ? '' : ' hidden'}><td colspan="7">${openPlant.has(p.id) ? plantDetail(p) : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="small faint" style="padding:10px 16px 14px"><span class="lg-b"></span>Inkoop <span class="lg-g"></span>Verkoop. Inkoop komt van de verzendbewijzen, verkoop van de pakbonnen. De vraag is met het seizoen eruit gehaald: het aandeel van de plant in alle dozen.</p></section>`;
}

export async function render(params, query) {
  soort = ['leveranciers', 'planten'].includes(query.get('soort')) ? query.get('soort') : 'klanten';
  const [rel, kl, pl] = await Promise.all([api('/week/relaties'), api('/week/klanten'), soort === 'planten' ? api('/week/planten') : null]);
  PL = pl;
  const by = new Map(kl.lijst.map(k => [k.id, k]));
  for (const c of rel.klanten) { const k = by.get(c.id) || {}; Object.assign(c, { nu_dozen: k.nu_dozen || 0, reeks: k.reeks, contact: k.contact }); }
  R = rel;
  return `<div class="page wk">
    <div class="ph"><div><h1>Relaties</h1><p>Hoe goed je klanten en leveranciers echt zijn, waar je ze meer kunt dienen, en wat de planten kosten en opbrengen. Alles komt uit wat er in de desk gebeurde: besteld, geleverd, geteld, gefactureerd en betaald.</p></div>
      <div class="acts">${soort === 'klanten' ? `<button type="button" class="btn btn-leaf" data-act="new">${icon('plus')}Nieuwe klant</button>` : ''}</div></div>
    <div class="pick big" role="group" aria-label="Klanten, leveranciers of planten">
      <a href="#/relaties?soort=klanten" aria-pressed="${soort === 'klanten'}">${icon('customer')}Klanten<small>${R.klanten.length}</small></a>
      <a href="#/relaties?soort=leveranciers" aria-pressed="${soort === 'leveranciers'}">${icon('grower')}Leveranciers<small>${R.leveranciers.length}</small></a>
      <a href="#/relaties?soort=planten" aria-pressed="${soort === 'planten'}">${icon('plant')}Planten<small>prijzen</small></a></div>
    ${soort === 'klanten' ? customers() : soort === 'leveranciers' ? suppliers() : plants()}
  </div>`;
}

export function onInput(e) {
  if (e.target.dataset.input !== 'rq') return;
  q = e.target.value;
  const tb = document.getElementById('rrows'); if (tb) tb.innerHTML = rowsHtml();
}

const form = (k = {}) => `<div class="form">${field('naam', 'Naam', k.naam, { wide: true, required: true })}${field('contact', 'Contactpersoon', k.contact)}${field('telefoon', 'Telefoon', k.telefoon)}
    ${field('email', 'E-mail (inkoop)', k.email, { type: 'email' })}${field('factuur_email', 'E-mail voor facturen', k.factuur_email, { type: 'email', hint: 'Hier gaat de pakbon met factuur naartoe.' })}
    ${field('adres', 'Adres', k.adres)}${field('postcode', 'Postcode', k.postcode)}${field('plaats', 'Plaats', k.plaats, { required: true })}${field('land', 'Land (2 letters)', k.land || 'NL')}
    ${field('taal', 'Taal van de factuur', k.taal || 'nl', { opts: Object.entries(LANG) })}${field('soort', 'Soort', k.soort || 'kwekerij', { opts: Object.entries(SOORT) })}
    ${field('btw_nummer', 'Btw-nummer', k.btw_nummer)}${field('exact_code', 'Debiteurnummer in Exact', k.exact_code)}${field('betaaltermijn', 'Betaaltermijn (dagen)', k.betaaltermijn ?? 14, { type: 'number' })}</div>`;

export const actions = {
  plant: (el, ctx, e) => {
    if (e && e.target.closest('a')) return 'default';
    const id = Number(el.dataset.id), on = !openPlant.has(id), row = document.getElementById(`pd${id}`);
    if (on) openPlant.add(id); else openPlant.delete(id);
    if (row) { row.hidden = !on; row.firstElementChild.innerHTML = on ? plantDetail(PL.producten.find(p => p.id === id)) : ''; }
    el.setAttribute('aria-expanded', String(on)); el.classList.toggle('is-open', on);
  },
  f: el => { filter = el.dataset.f; document.querySelectorAll('[data-act="f"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === filter))); const tb = document.getElementById('rrows'); if (tb) tb.innerHTML = rowsHtml(); },
  new: () => dialog({ title: 'Nieuwe klant', ok: 'Toevoegen', body: form(), onOk: async v => { const r = await api('/week/klanten', { method: 'POST', body: v }); toast('Klant toegevoegd.'); location.hash = `#/klant/${r.id}`; } }),
};
