// Planten: the catalogue, with who grows each plant, who buys it and what it costs.
import { api, h, icon, fNum, fPrice, fAvg, fPct, dayWord, plural, dialog, field, toast } from '../core.js';
import { lines } from '../charts.js';

const GROEP = { orchidee: 'Orchideeën', bloeiend: 'Bloeiend', groen: 'Groen', snijbloem: 'Snijbloemen', buiten: 'Buiten', seizoen: 'Seizoen' };
const MON = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
let q = '';
const MONTH = m => new Date(m + '-15').toLocaleDateString('nl-NL', { month: 'short' }).replace('.', '');
// the season as runs of months, also across the new year: sep–mrt, apr–aug
function season(ms) {
  if (!ms || !ms.length || ms.length === 12) return 'hele jaar';
  const on = new Set(ms.map(Number)), runs = [];
  for (let m = 1; m <= 12; m++) {
    if (!on.has(m) || on.has(m === 1 ? 12 : m - 1)) continue;
    let end = m; while (on.has(end === 12 ? 1 : end + 1) && (end === 12 ? 1 : end + 1) !== m) end = end === 12 ? 1 : end + 1;
    runs.push(end === m ? MON[m - 1] : `${MON[m - 1]}–${MON[end - 1]}`);
  }
  return runs.join(', ');
}

export async function renderList() {
  const list = await api('/planten');
  const shown = list.filter(p => !q || `${p.naam} ${p.latijn || ''} ${p.potmaat || ''}`.toLowerCase().includes(q.toLowerCase()));
  const groups = Object.keys(GROEP).map(g => [g, shown.filter(p => p.groep === g)]).filter(([, ps]) => ps.length);
  return `<div class="page">
    <div class="ph"><div><h1>Planten</h1><p>${plural(list.length, 'plant', 'planten')} in de catalogus. Kleuren zijn aparte planten, zodat elke factuurregel precies één plant is.</p></div>
      <div class="acts"><button class="btn btn-leaf" data-act="nieuw">${icon('plus')}Plant toevoegen</button></div></div>
    <div class="tools"><input type="search" placeholder="Zoek op naam of maat" value="${h(q)}" data-input="q" aria-label="Zoek planten"></div>
    ${groups.map(([g, ps]) => `<section class="panel"><header><h2>${h(GROEP[g])}</h2><span class="sub">${plural(ps.length, 'plant', 'planten')}</span></header><div class="tbwrap"><table class="tb fixed" style="min-width:860px">
      <colgroup><col style="width:25%"><col style="width:11%"><col style="width:7%"><col style="width:7%"><col style="width:10%"><col style="width:9%"><col style="width:9%"><col style="width:7%"><col style="width:15%"></colgroup>
      <thead><tr><th style="padding-left:16px">Plant</th><th>Maat</th><th class="r">Kwekers</th><th class="r">Klanten</th><th class="r">Stuks 12 mnd</th><th class="r">Inkoop nu</th><th class="r">Verkoop</th><th class="r">Marge</th><th style="padding-left:18px">Seizoen</th></tr></thead>
      <tbody>${ps.map(p => { const m = p.verkoop && p.inkoop ? (p.verkoop - p.inkoop) / p.verkoop * 100 : null; return `<tr class="click" data-href="#/plant/${p.id}"><td style="padding-left:16px"><a href="#/plant/${p.id}">${h(p.naam)}</a>${p.latijn ? `<div class="as"><i>${h(p.latijn)}</i></div>` : ''}</td><td class="nowrap">${h([p.potmaat, p.hoogte].filter(Boolean).join(' '))}</td>
        <td class="r num">${p.kwekers || 0}</td><td class="r num">${p.klanten || 0}</td><td class="r num">${fNum(p.stuks || 0)}</td><td class="r num">${fAvg(p.inkoop)}</td><td class="r num">${fAvg(p.verkoop || p.verkoopprijs)}</td><td class="r num">${m == null ? '–' : fPct(m)}</td>
        <td class="small nowrap" style="padding-left:18px">${season(p.seizoen)}</td></tr>`; }).join('')}</tbody></table></div></section>`).join('')}
  </div>`;
}

export async function renderDetail(params) {
  const p = await api(`/planten/${params.id}`);
  const months = [...new Set(p.reeks.map(r => r.maand))].sort();
  const ks = p.kwekers.slice(0, 5);
  const series = ks.map(k => ({ name: k.naam, values: months.map(m => { const r = p.reeks.find(x => x.maand === m && x.kweker_id === k.id); return r ? Number(r.prijs) : null; }) }));
  return `<div class="page">
    <a class="back" href="#/planten">${icon('back')}Planten</a>
    <div class="prof"><div><h1>${h(p.naam)} <span style="color:var(--ink-3);font-weight:500">${h([p.potmaat, p.hoogte].filter(Boolean).join(' '))}</span></h1>
      <div class="sub">${p.latijn ? `<i>${h(p.latijn)}</i>` : ''}<span>${h(GROEP[p.groep] || p.groep)}</span><span>${p.per_laag ? `${p.per_laag} per laag` : ''}${p.per_kar ? `, ${p.per_kar} per kar` : ''}</span><span>${p.seizoen && p.seizoen.length < 12 ? `seizoen ${season(p.seizoen)}` : 'hele jaar'}</span><span>adviesprijs ${fPrice(p.verkoopprijs)}</span></div></div>
      <div class="bigscore"><button class="btn btn-sm btn-line" data-act="bewerk" data-id="${p.id}">${icon('edit')}Gegevens</button></div></div>
    <div class="grid2">
      <div class="stack">
        <section class="panel"><header><h2>Kwekers</h2><span class="sub">Wie het levert, voor hoeveel, en hoe stipt</span></header><div class="tbwrap"><table class="tb"><thead><tr><th style="padding-left:16px">Kweker</th><th class="r">Keer</th><th class="r">Stuks</th><th class="r">Prijs nu</th><th class="r">Gem.</th><th class="r">Op tijd</th><th class="r">Laatst</th></tr></thead><tbody>
          ${p.kwekers.map(k => `<tr class="click" data-href="#/kweker/${k.id}"><td style="padding-left:16px"><a href="#/kweker/${k.id}">${h(k.naam)}</a> <span class="faint">${h(k.plaats)}</span></td><td class="r num">${k.keer}</td><td class="r num">${fNum(k.stuks)}</td><td class="r num">${fAvg(k.prijs_nu)}</td><td class="r num">${fAvg(k.prijs)}</td><td class="r num">${k.op_tijd == null ? '–' : `${k.op_tijd}%`}</td><td class="r nowrap">${dayWord(k.laatst)}</td></tr>`).join('') || '<tr><td colspan="7" class="faint" style="padding-left:16px">Nog niet ingekocht.</td></tr>'}
        </tbody></table></div></section>
        <section class="panel"><header><h2>Klanten</h2><span class="sub">Wie het koopt</span></header><div class="tbwrap"><table class="tb"><thead><tr><th style="padding-left:16px">Klant</th><th class="r">Keer</th><th class="r">Stuks</th><th class="r">Betaalt</th><th class="r">Laatst</th></tr></thead><tbody>
          ${p.klanten.map(k => `<tr class="click" data-href="#/klant/${k.id}"><td style="padding-left:16px"><a href="#/klant/${k.id}">${h(k.naam)}</a> <span class="faint">${h(k.plaats)}, ${h(k.land)}</span></td><td class="r num">${k.keer}</td><td class="r num">${fNum(k.stuks)}</td><td class="r num">${fAvg(k.prijs)}</td><td class="r nowrap">${dayWord(k.laatst)}</td></tr>`).join('') || '<tr><td colspan="5" class="faint" style="padding-left:16px">Nog niet verkocht.</td></tr>'}
        </tbody></table></div></section>
      </div>
      <aside class="stack">
        ${series.length ? `<section class="panel"><header><h2>Inkoopprijs per kweker</h2></header><div class="body">${lines(months.map(MONTH), series, { fmt: v => fAvg(v), title: 'Gemiddelde inkoopprijs per maand' })}</div></section>` : ''}
        ${p.namen.length ? `<section class="panel"><header><h2>Zo staat hij op facturen</h2><span class="sub">Geleerde namen</span></header><ul class="feed body">${p.namen.map(n => `<li style="grid-template-columns:minmax(0,1fr) auto"><span>“${h(n.tekst)}”</span><span class="faint small">${h(n.kweker || 'alle kwekers')}${n.door === 'jan' ? ', door Jan' : ''}</span></li>`).join('')}</ul></section>` : ''}
      </aside>
    </div>
  </div>`;
}

function form(p = {}) {
  return `<div class="form">${field('naam', 'Naam (met kleur, bijvoorbeeld "Hortensia blauw")', p.naam, { wide: true })}${field('latijn', 'Latijnse naam', p.latijn)}
    ${field('groep', 'Groep', p.groep || 'groen', { opts: Object.entries(GROEP) })}${field('potmaat', 'Potmaat (P12)', p.potmaat)}${field('hoogte', 'Hoogte of lengte (H55, 60 cm)', p.hoogte)}
    ${field('eenheid', 'Eenheid', p.eenheid || 'stuks', { opts: [['stuks', 'Stuks'], ['stelen', 'Stelen']] })}${field('per_laag', 'Per laag', p.per_laag, { type: 'number' })}${field('per_kar', 'Per kar', p.per_kar, { type: 'number' })}
    ${field('verkoopprijs', 'Adviesprijs (€)', p.verkoopprijs, { type: 'number' })}</div>`;
}
const payload = v => { const o = { ...v }; for (const k of ['per_laag', 'per_kar', 'verkoopprijs']) if (o[k] === '') o[k] = null; return o; };
export const listActions = { nieuw() { dialog({ title: 'Plant toevoegen', ok: 'Toevoegen', body: form(), onOk: async v => { const r = await api('/planten', { method: 'POST', body: payload(v) }); toast('Plant toegevoegd.'); location.hash = `#/plant/${r.id}`; } }); } };
export const detailActions = { async bewerk(el, ctx) { const p = await api(`/planten/${el.dataset.id}`); dialog({ title: 'Plant', body: form(p), onOk: async v => { await api(`/planten/${p.id}`, { method: 'PATCH', body: payload(v) }); toast('Opgeslagen.'); ctx.refresh(); } }); } };
export function onInput(e, ctx) { if (e.target.dataset.input === 'q') { q = e.target.value; ctx.refreshSoon(); } }
