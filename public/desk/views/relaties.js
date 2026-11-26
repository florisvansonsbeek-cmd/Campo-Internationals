// Kwekers en klanten: how healthy every relationship is, and what stands in the way of working together.
// One page with a slide between customers and growers. Health and obstacles come from the deliveries,
// payments and invoices themselves; clicking a name opens everything about that customer or grower.
import { api, h, icon, fEur, fPct, plural, COUNTRY } from '../core.js';
import { spark } from '../charts.js';
import { KIND, KIND_ORDER, obstacleChips } from '../belemmeringen.js';
import * as klanten from './klanten.js';
import * as kwekers from './kwekers.js';

let kant = 'klanten', q = '', staat = 'alle', soort = 'alle', sort = { key: 'aandacht', dir: 1 };

const SIDE = {
  klanten: {
    een: 'klant', meer: 'klanten',
    health: c => c.gezondheid,
    band: v => (v == null ? 'new' : v >= 65 ? 'ok' : v >= 45 ? 'wait' : 'bad'),
    weight: c => c.omzet_12m || 0,
    href: c => `#/klant/${c.id}`,
    text: c => `${c.naam} ${c.plaats} ${c.contact || ''} ${c.top || ''}`,
    uitleg: 'Gezondheid telt het bestelritme, de groei, het betaalgedrag en de marge.',
  },
  kwekers: {
    een: 'kweker', meer: 'kwekers',
    health: g => g.score,
    band: v => (v == null ? 'new' : v >= 82 ? 'ok' : v >= 70 ? 'wait' : 'bad'),
    weight: g => g.inkoop || 0,
    href: g => `#/kweker/${g.id}`,
    text: g => `${g.naam} ${g.plaats || ''} ${g.specialiteit || ''}`,
    uitleg: 'Gezondheid telt op tijd (40%), compleet geleverd (25%), kwaliteit (20%) en prijs zoals afgesproken (15%).',
  },
};
const BAND = { ok: 'Gezond', wait: 'Let op', bad: 'Zorgen' };
const bar = (v, b) => (v == null ? '<span class="faint">nieuw</span>' : `<span class="bar ${b === 'bad' ? 'lo' : b === 'wait' ? 'mid' : ''}" title="Gezondheid ${v} van 100"><i><span style="width:${v}%"></span></i><b>${v}</b></span>`);
const bad = x => x.belemmeringen.filter(o => o.toon === 'bad').length;

function sorter(S) {
  const val = (x, k) => (k === 'gezondheid' ? S.health(x) : x[k]);
  if (sort.key === 'aandacht') {
    // the ones with serious obstacles first, then the ones with something to mind, the biggest relationships first
    return (a, b) => bad(b) - bad(a) || b.belemmeringen.length - a.belemmeringen.length || S.weight(b) - S.weight(a);
  }
  return (a, b) => { const x = val(a, sort.key), y = val(b, sort.key); if (x == null) return 1; if (y == null) return -1; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.dir; };
}

function cols(S) {
  const th = (k, l, r = false) => `<th class="sort${r ? ' r' : ''}" data-act="sort" data-k="${k}" ${sort.key === k ? `aria-sort="${sort.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${l}</th>`;
  if (kant === 'klanten') {
    return {
      head: `<th style="padding-left:16px">Klant</th>${th('gezondheid', 'Gezondheid')}${th('aandacht', 'Belemmeringen')}${th('omzet_12m', 'Omzet 12 mnd', true)}${th('trend', 'Trend', true)}${th('betaal_dagen', 'Betaalt', true)}${th('dagen_sinds', 'Laatste', true)}<th>12 maanden</th>`,
      row: c => `<td style="padding-left:16px"><a href="${S.href(c)}">${h(c.naam)}</a><div class="as">${h(c.plaats)}, ${h(COUNTRY[c.land] || c.land)} · ${h(c.soort)}</div></td>
        <td>${bar(S.health(c), S.band(S.health(c)))}</td>
        <td>${obstacleChips(c.belemmeringen)}</td>
        <td class="r num">${fEur(c.omzet_12m)}</td>
        <td class="r num">${c.trend == null ? '–' : `<span class="${c.trend >= 10 ? 'up' : c.trend <= -10 ? 'down' : ''}">${c.trend > 0 ? '+' : ''}${c.trend}%</span>`}</td>
        <td class="r num">${c.betaal_dagen == null ? '–' : c.betaal_dagen > 3 ? `<span class="down">${Math.round(c.betaal_dagen)} d laat</span>` : 'op tijd'}</td>
        <td class="r num">${c.dagen_sinds == null ? '–' : `${c.dagen_sinds} d`}</td>
        <td>${spark(c.maanden)}</td>`,
    };
  }
  return {
    head: `<th style="padding-left:16px">Kweker</th>${th('gezondheid', 'Gezondheid')}${th('aandacht', 'Belemmeringen')}${th('op_tijd', 'Op tijd', true)}${th('compleet', 'Compleet', true)}${th('prijsindex', 'Prijs t.o.v. markt', true)}${th('inkoop', 'Inkoop 12 mnd', true)}<th>12 weken</th>`,
    row: g => `<td style="padding-left:16px"><a href="${S.href(g)}">${h(g.naam)}</a><div class="as">${h(g.plaats || '')}, ${h(COUNTRY[g.land] || g.land)}${g.specialiteit ? ` · ${h(g.specialiteit)}` : ''}</div></td>
      <td>${bar(S.health(g), S.band(S.health(g)))}</td>
      <td>${obstacleChips(g.belemmeringen)}</td>
      <td class="r num">${g.op_tijd == null ? '–' : `${g.op_tijd}%`}</td>
      <td class="r num">${g.compleet == null ? '–' : fPct(g.compleet)}</td>
      <td class="r num">${g.prijsindex == null ? '–' : `<span class="${g.prijsindex <= 97 ? 'up' : g.prijsindex >= 103 ? 'down' : ''}">${g.prijsindex > 100 ? '+' : ''}${fPct(g.prijsindex - 100)}</span>`}</td>
      <td class="r num">${fEur(g.inkoop)}</td>
      <td>${spark(g.weken)}</td>`,
  };
}

export async function render(params = {}, query) {
  if (params.kant) kant = params.kant;
  else if (query && query.get('kant')) kant = query.get('kant') === 'kwekers' ? 'kwekers' : 'klanten';
  const [kl, kw] = await Promise.all([api('/klanten'), api('/kwekers')]);
  const all = kant === 'klanten' ? kl : kw;
  const S = SIDE[kant];
  const actief = all.filter(x => x.actief);
  const tel = { ok: 0, wait: 0, bad: 0, new: 0 };
  for (const x of actief) tel[S.band(S.health(x))]++;
  const met = actief.filter(x => x.belemmeringen.length).length;
  const perSoort = {};
  for (const x of actief) for (const k of new Set(x.belemmeringen.map(o => o.soort))) perSoort[k] = (perSoort[k] || 0) + 1;
  const pool = staat === 'gestopt' ? all.filter(x => !x.actief) : actief;
  const shown = pool.filter(x => (staat === 'alle' || staat === 'gestopt' || S.band(S.health(x)) === staat)
      && (soort === 'alle' || (soort === 'met' ? x.belemmeringen.length : soort === 'geen' ? !x.belemmeringen.length : x.belemmeringen.some(o => o.soort === soort)))
      && (!q || S.text(x).toLowerCase().includes(q.toLowerCase())))
    .sort(sorter(S));
  // everyone on this side with something serious, the biggest relationships first
  const ernstig = actief.filter(x => bad(x)).sort((a, b) => S.weight(b) - S.weight(a));
  const c = cols(S);
  const tile = (key, label, n, sub) => `<button type="button" class="kpi ${key}" data-act="staat" data-s="${key}" aria-pressed="${staat === key}"><span>${label}</span><b class="t">${n}</b><em>${sub}</em></button>`;
  const stopped = all.length - actief.length;
  return `<div class="page">
    <div class="ph"><div><h1>Kwekers en klanten</h1><p>Hoe gezond elke samenwerking is, en wat het samenwerken lastig maakt: bezorgen, betalen, bestellen, kwaliteit of prijs. Uit de leveringen, betalingen en facturen zelf.</p></div>
      <div class="acts"><button class="btn btn-leaf" data-act="nieuw">${icon('plus')}${kant === 'klanten' ? 'Klant' : 'Kweker'} toevoegen</button></div></div>
    <div class="rel-top">
      <div class="slide" data-k="${kant}" role="group" aria-label="Klanten of kwekers">
        <a href="#/relaties?kant=klanten" data-act="kant" data-k="klanten"${kant === 'klanten' ? ' aria-current="true"' : ''}>${icon('customer')}Klanten <small>${kl.filter(x => x.actief).length}</small></a>
        <a href="#/relaties?kant=kwekers" data-act="kant" data-k="kwekers"${kant === 'kwekers' ? ' aria-current="true"' : ''}>${icon('grower')}Kwekers <small>${kw.filter(x => x.actief).length}</small></a>
        <span class="slide-thumb" aria-hidden="true"></span>
      </div>
      <input type="search" placeholder="Zoek ${S.een}, plaats${kant === 'klanten' ? ' of plant' : ' of soort'}" value="${h(q)}" data-input="q" aria-label="Zoek ${S.meer}">
    </div>
    <div class="kpis rel-kpis">
      ${tile('ok', BAND.ok, tel.ok, `van de ${plural(actief.length, `actieve ${S.een}`, `actieve ${S.meer}`)}`)}
      ${tile('wait', BAND.wait, tel.wait, 'gezondheid zakt')}
      ${tile('bad', BAND.bad, tel.bad, 'nu aandacht nodig')}
      <button type="button" class="kpi obs-kpi" data-act="soort" data-s="met" aria-pressed="${soort === 'met'}"><span>Met belemmeringen</span><b class="t">${met}</b><em>${ernstig.length ? `${ernstig.length} met iets ernstigs` : 'niets ernstigs'}</em></button>
    </div>
    <section class="panel"><header><h2>Wat het samenwerken nu het meest in de weg zit</h2><span class="sub">${ernstig.length ? `${plural(ernstig.length, S.een, S.meer)} met iets ernstigs, de grootste eerst` : `Niets ernstigs bij de ${S.meer}`}</span></header>
      ${ernstig.length ? `<ul class="top-obs">${ernstig.slice(0, 6).map(x => { const bs = x.belemmeringen.filter(o => o.toon === 'bad'); return `<li><a href="${S.href(x)}">${h(x.naam)}</a><div><span class="obs">${bs.map(o => `<span class="chip bad" title="${h(KIND[o.soort] || o.soort)}">${h(o.kort)}</span>`).join('')}</span><p>${h(bs[0].tekst)}</p></div></li>`; }).join('')}</ul>${ernstig.length > 6 ? `<p class="body small muted" style="padding-top:0">En nog ${ernstig.length - 6} in de tabel hieronder, met een rode streep.</p>` : ''}`
        : `<p class="body muted">Bij geen enkele ${S.een} zit nu iets ernstigs in de weg. Kleinere punten staan in de tabel.</p>`}
    </section>
    <div class="tools rel-tools"><div class="seg" role="group" aria-label="Soort belemmering">
      <button type="button" data-act="soort" data-s="alle" aria-pressed="${soort === 'alle'}">Alle</button>
      ${KIND_ORDER.filter(k => perSoort[k]).map(k => `<button type="button" data-act="soort" data-s="${k}" aria-pressed="${soort === k}">${KIND[k]}<small>${perSoort[k]}</small></button>`).join('')}
      <button type="button" data-act="soort" data-s="geen" aria-pressed="${soort === 'geen'}">Zonder belemmeringen<small>${actief.length - met}</small></button>
    </div>${staat !== 'alle' || soort !== 'alle' || q ? '<button type="button" class="lnk small" data-act="reset">Alles tonen</button>' : ''}${stopped ? `<button type="button" class="lnk small" data-act="staat" data-s="gestopt" style="margin-left:auto">${plural(stopped, `gestopte ${S.een}`, `gestopte ${S.meer}`)}</button>` : ''}</div>
    <section class="panel"><div class="tbwrap"><table class="tb rel-tb" style="min-width:1080px">
      <thead><tr>${c.head}</tr></thead>
      <tbody>${shown.length ? shown.map(x => `<tr class="click${x.belemmeringen.some(o => o.toon === 'bad') ? ' has-bad' : ''}" data-href="${S.href(x)}">${c.row(x)}</tr>`).join('')
        : `<tr><td colspan="8" class="empty">Geen ${S.meer} die hierbij passen. <button type="button" class="lnk" data-act="reset">Alles tonen</button></td></tr>`}</tbody></table></div></section>
    <p class="faint small" style="margin-top:10px">${S.uitleg} Groen is gezond, oranje let op, rood zorgen. Wijs een belemmering aan voor de uitleg.</p>
  </div>`;
}

export const actions = {
  kant(el, ctx, e) {
    if (e) e.preventDefault();
    const k = el.dataset.k;
    if (k === kant) return;
    const s = el.closest('.slide');
    s.dataset.k = k; // the thumb slides across, then the other side loads
    staat = 'alle'; soort = 'alle'; sort = { key: 'aandacht', dir: 1 };
    setTimeout(() => { location.hash = `#/relaties?kant=${k}`; }, 220);
  },
  staat(el, ctx) { const s = el.dataset.s; staat = staat === s ? 'alle' : s; ctx.refresh(); },
  soort(el, ctx) { const s = el.dataset.s; soort = soort === s && s !== 'alle' ? 'alle' : s; ctx.refresh(); },
  reset(el, ctx) { staat = 'alle'; soort = 'alle'; q = ''; ctx.refresh(); },
  sort(el, ctx) { const k = el.dataset.k; sort = { key: k, dir: sort.key === k ? -sort.dir : (k === 'gezondheid' ? 1 : -1) }; ctx.refresh(); },
  nieuw(el, ctx) { (kant === 'klanten' ? klanten.listActions : kwekers.listActions).nieuw(el, ctx); },
};
export function onInput(e, ctx) { if (e.target.dataset.input === 'q') { q = e.target.value; ctx.refreshSoon(); } }
