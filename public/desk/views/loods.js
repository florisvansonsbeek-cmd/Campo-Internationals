// The loods: what is in the warehouse now, who it is waiting for, and what is still free to sell.
import { api, h, icon, fTime, fNum, fEur, fPrice, dayWord, rel, plural, toast, dialog, field } from '../core.js';

let last = null, offerNow = null;
const when = v => (dayWord(v) === 'vandaag' ? fTime(v) : `${dayWord(v)} ${fTime(v)}`);
const age = (u, groep) => {
  if (u < 1) return 'net binnen';
  if (u < 24) return `${u} uur`;
  const d = Math.round(u / 24);
  return `${d} ${d === 1 ? 'dag' : 'dagen'}`;
};

function freeRow(p) {
  return `<li class="free ${p.leeftijd}">
    <div><b>${h(p.plant)}</b> <span class="faint">${h(p.maat)}</span><p class="small muted">${h(p.kweker)} · binnen ${when(p.binnen_om)} · staat ${age(p.uren)}${p.leeftijd !== 'ok' ? ` <span class="chip ${p.leeftijd}">${p.leeftijd === 'bad' ? 'te lang' : 'let op'}</span>` : ''}</p></div>
    <div class="num big">${fNum(p.vrij)}<small>${p.eenheid === 'stelen' ? 'stelen' : 'stuks'}</small></div>
    <div class="num faint small">${fEur(p.vrij * p.prijs)}<br>inkoop</div>
    <button class="btn btn-sm btn-leaf" data-act="aanbieden" data-id="${p.regel_id}">${icon('basket')}Aanbieden</button>
  </li>`;
}

function plantRow(p) {
  const pct = p.hier ? Math.round(p.gereserveerd / p.hier * 100) : 0;
  return `<tr>
    <td><a href="#/plant/${p.plant_id}"><b>${h(p.plant)}</b></a> <span class="faint">${h(p.maat)}</span><span class="sub">${h(p.kwekers.join(', '))}</span></td>
    <td class="r num"><b>${fNum(p.hier)}</b></td>
    <td><div class="meter thin" role="img" aria-label="${pct}% klaar voor klanten"><i style="width:${pct}%"></i></div>
      ${p.klanten.length ? `<div class="allocs">${p.klanten.slice(0, 4).map(k => `<span class="chip${k.laat ? ' wait' : ''}" title="${k.vertrek ? `Wagen ${when(k.vertrek)}` : 'Nog geen wagen gepland'}">${h(k.klant)} ${fNum(k.aantal)}${k.vertrek ? ` · ${fTime(k.vertrek)}` : ''}</span>`).join('')}${p.klanten.length > 4 ? `<span class="chip">+${p.klanten.length - 4}</span>` : ''}</div>` : '<span class="faint small">Niemand</span>'}</td>
    <td class="r num${p.vrij ? ' freenum' : ' faint'}">${fNum(p.vrij)}</td>
    <td class="r small">${p.leeftijd !== 'ok' ? `<span class="chip ${p.leeftijd}">${icon('clock')}${rel(p.oudste).replace(' geleden', '')}</span>` : `<span class="faint">${when(p.oudste)}</span>`}</td>
  </tr>`;
}

export async function render(params, query) {
  const d = await api('/loods');
  last = d;
  const k = d.kpi;
  const filter = query.get('toon') || 'alles';
  offerNow = query.get('aanbieden');
  const free = d.partijen.filter(p => p.vrij > 0).sort((a, b) => (b.leeftijd === 'bad') - (a.leeftijd === 'bad') || (b.leeftijd === 'wait') - (a.leeftijd === 'wait') || b.vrij * b.prijs - a.vrij * a.prijs);
  const plants = d.planten.filter(p => filter === 'vrij' ? p.vrij > 0 : filter === 'klanten' ? p.gereserveerd > 0 : true);
  return `<div class="page">
    <div class="ph"><div><h1>Loods</h1><p>Wat er nu in de loods staat, voor wie het klaarstaat en wat nog vrij is. Bijgewerkt ${fTime(d.nu)}.</p></div>
      <div class="acts"><a class="btn btn-line" href="#/workflow">${icon('flow')}Naar de workflow</a></div></div>
    <div class="kpis">
      <div class="kpi"><span>In de loods</span><b class="t">${fNum(k.stuks)}</b><em>${fEur(k.waarde)} aan inkoop</em></div>
      <div class="kpi"><span>Klaar voor klanten</span><b class="t">${fNum(k.gereserveerd)}</b><em>voor ${plural(k.klanten, 'klant', 'klanten')}, gaat met de wagens mee</em></div>
      <a class="kpi" href="#vrij"><span>Vrij om te verkopen</span><b class="t">${fNum(k.vrij)}</b><em>${fEur(k.vrij_waarde)} zonder klant</em></a>
      <a class="kpi${k.te_lang ? ' bad' : ''}" href="#vrij"><span>Staat te lang</span><b class="t">${k.te_lang}</b><em>${k.te_lang ? 'vrije partij die al dagen staat' : 'niets blijft staan'}</em></a>
    </div>
    ${d.komt.length ? `<section class="incoming" aria-label="Komt nog binnen"><h2>${icon('truck')}Komt nog binnen: ${plural(d.komt.length, 'wagen', 'wagens')}, ${fNum(k.komt_stuks)} stuks</h2>
      <ul>${d.komt.map(z => `<li><time>${when(z.aankomst_verwacht || z.aankomst_gepland)}</time><span>${h(z.kweker)}</span><span class="num faint">${fNum(z.stuks)}</span></li>`).join('')}</ul></section>` : ''}
    <div class="grid2">
      <section class="panel" aria-labelledby="h-all"><header><h2 id="h-all">Alles in de loods</h2>
        <nav class="seg-nav" aria-label="Filter">${[['alles', 'Alles'], ['klanten', 'Voor klanten'], ['vrij', 'Vrij']].map(([v, l]) => `<a href="#/loods?toon=${v}"${filter === v ? ' aria-current="true"' : ''}>${l}</a>`).join('')}</nav></header>
        ${plants.length ? `<div class="tbwrap"><table class="tb loods-tb"><thead><tr><th>Plant</th><th class="r">In de loods</th><th>Klaar voor</th><th class="r">Vrij</th><th class="r">Binnen</th></tr></thead>
          <tbody>${plants.map(plantRow).join('')}</tbody></table></div>` : '<p class="empty">Niets in deze selectie.</p>'}
      </section>
      <aside class="stack">
        <section class="panel" id="vrij" aria-labelledby="h-vrij"><header><h2 id="h-vrij">Vrij om te verkopen</h2><span class="sub">${free.length ? 'Oudste en duurste eerst' : ''}</span></header>
          ${free.length ? `<ul class="freelist">${free.map(freeRow).join('')}</ul>` : '<p class="empty">Alles in de loods heeft een klant.</p>'}
        </section>
        <section class="panel" aria-labelledby="h-how"><header><h2 id="h-how">Hoe de loods klopt</h2></header>
          <div class="body small muted"><p>Alles wat binnenkwam staat hier tot de wagen naar de klant is vertrokken. Vrij is wat geen klant heeft: extra voor de loods, of wat over was.</p>
          <p style="margin-top:8px">Potplanten die langer dan vijf dagen vrij staan en snijbloemen na twee dagen krijgen een waarschuwing.</p></div>
        </section>
      </aside>
    </div>
  </div>`;
}

export const actions = {
  async aanbieden(el, ctx) {
    const d = await api(`/loods/regel/${el.dataset.id}/kandidaten`);
    const p = d.partij;
    const best = d.klanten.slice(0, 5);
    dialog({
      title: `${p.plant} ${p.maat}: ${fNum(p.vrij)} vrij`, ok: 'Aan klant geven',
      body: `${best.length ? `<ul class="sugg mini">${best.map((k, i) => `<li><label><input type="radio" name="klant_id" value="${k.klant_id}" data-aantal="${Math.min(k.aantal, p.vrij)}" data-prijs="${k.prijs}"${i === 0 ? ' checked' : ''}>
          <span><b>${h(k.klant)}</b> <span class="faint">${h(k.plaats)}</span><br><span class="small muted">${h(k.redenen.slice(0, 2).join('. '))}.</span></span>
          <span class="num small">${fNum(Math.min(k.aantal, p.vrij))} à ${fPrice(k.prijs)}</span></label></li>`).join('')}</ul>` : '<p class="muted">De desk vond geen vaste koper. Kies zelf een klant via de klantpagina.</p>'}
        ${field('aantal', 'Aantal', best[0] ? Math.min(best[0].aantal, p.vrij) : p.vrij, { type: 'number' })}${field('verkoopprijs', 'Prijs per stuk (€)', best[0] ? String(best[0].prijs).replace('.', ',') : '')}
        <p class="faint small">${d.voorraad && d.voorraad.dagen ? `Normaal gaat dit in ongeveer ${d.voorraad.dagen} ${d.voorraad.dagen === 1 ? 'dag' : 'dagen'} weg. ` : ''}De klant gaat mee met de eerstvolgende wagen. Stuur zelf even een bericht.</p>`,
      onOk: async v => {
        if (!v.klant_id) throw new Error('Kies een klant.');
        await api(`/loods/regel/${el.dataset.id}/klant`, { method: 'POST', body: { klant_id: Number(v.klant_id), aantal: Number(v.aantal), verkoopprijs: v.verkoopprijs || null } });
        toast('Gegeven. Het staat nu klaar voor die klant.');
        ctx.refresh();
      },
    });
    for (const r of document.querySelectorAll('#dlg input[name="klant_id"]')) r.addEventListener('change', () => {
      const f = r.closest('form');
      f.aantal.value = r.dataset.aantal; f.verkoopprijs.value = String(r.dataset.prijs).replace('.', ',');
    });
  },
};
// opened from the workflow with ?aanbieden=<lot>: show who could take it straight away
export function mount(ctx) {
  if (!offerNow) return;
  const id = offerNow;
  offerNow = null;
  history.replaceState(null, '', '#/loods');
  actions.aanbieden({ dataset: { id } }, ctx).catch(e => toast(e.message));
}
export const refreshEvery = 120000;
