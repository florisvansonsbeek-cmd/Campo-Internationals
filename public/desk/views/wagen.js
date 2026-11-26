// One truck to a customer, in its own tab: when it leaves and arrives, what goes on it and from which grower,
// what from the loods could still go along, and the buttons Jan needs on the day.
import { api, h, icon, fTime, fNum, fEur, waLink, toast, COUNTRY } from '../core.js';
import { when, dur, cap, TONE } from '../lane.js';
import { erbijEen, erbijKies, pack } from '../erbij.js';

const tel = v => `tel:${String(v).replace(/\s/g, '')}`;
const STATE = { klaar: 'Klaar om te laden', wacht: 'Wacht op goederen van de kweker', onderweg: 'Onderweg naar de klant', afgeleverd: 'Afgeleverd' };
const SRC = { whatsapp: 'WhatsApp', mail: 'Mail', jan: 'Jan', vervoerder: 'Vervoerder', ai: 'Desk', demo: 'Demo' };

function timesPanel(w) {
  const gone = w.state === 'onderweg' || w.state === 'afgeleverd';
  const row = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  return `<section class="panel" aria-labelledby="h-t"><header><h2 id="h-t">Tijden</h2></header>
    <dl class="kv body">
      ${row('Vertrek uit Nootdorp', `${gone ? '' : '± '}${h(when(w.vertrek))}${Math.abs(w.uitstel) >= 10 ? ` <span class="lt t-wait">gepland ${fTime(w.vertrek_gepland)}</span>` : ''}`)}
      ${row(w.state === 'afgeleverd' ? 'Afgeleverd' : 'Aankomst', `${w.state === 'afgeleverd' ? '' : 'waarschijnlijk '}${h(when(w.eta))}${w.delay >= 10 ? ` <span class="lt t-${w.toon === 'bad' ? 'bad' : 'wait'}">${dur(w.delay)} later dan gepland (${fTime(w.aankomst_gepland)})</span>` : ''}`)}
      ${w.levervenster ? row('Levervenster', h(w.levervenster)) : ''}
      ${w.vervoerder ? row('Vervoerder', h(w.vervoerder)) : ''}
      ${w.wacht_op && w.wacht_op.filter(x => x.state !== 'binnen').length ? row('Wacht op', w.wacht_op.filter(x => x.state !== 'binnen').map(x => `${h(x.kweker)}, komt ${h(when(x.eta))}${x.delay >= 10 ? ` <span class="lt t-wait">+${dur(x.delay)}</span>` : ''}`).join('<br>')) : ''}
    </dl>
    <p class="body acts-row">
      ${w.state === 'klaar' || w.state === 'wacht' ? `<button class="btn btn-sm btn-leaf" data-act="l-vertrokken" data-id="${w.id}">${icon('truck')}Vertrokken</button>` : ''}
      ${w.state === 'onderweg' ? `<button class="btn btn-sm btn-leaf" data-act="l-afgeleverd" data-id="${w.id}">${icon('check')}Afgeleverd</button>` : ''}
      ${w.state !== 'afgeleverd' && (w.toon === 'wait' || w.toon === 'bad') ? `<button class="btn btn-sm btn-line" data-act="l-vertraging" data-id="${w.id}" data-eta="${h(w.eta)}">${icon('chat')}Meld vertraging</button>` : ''}
    </p>
  </section>`;
}

function contentPanel(d) {
  const rows = d.inhoud;
  const tot = rows.reduce((s, r) => s + r.aantal, 0);
  return `<section class="panel" aria-labelledby="h-c"><header><h2 id="h-c">Wat gaat er mee</h2><span class="sub">${fNum(tot)} stuks</span></header>
    ${rows.length ? `<div class="tbwrap"><table class="tb"><thead><tr><th>Plant</th><th class="r">Stuks</th><th>Van</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><a href="#/plant/${r.plant_id}"><b>${h(r.naam)}</b></a> <span class="faint">${h(r.maat)}</span>${r.voorstel ? ' <span class="chip info">voorstel</span>' : ''}</td><td class="r num">${fNum(r.aantal)}</td>
        <td>${r.kweker ? `${r.zending_id ? `<a href="#/bestelling/${r.zending_id}" target="_blank" rel="noopener">${h(r.kweker)}</a>` : h(r.kweker)} <span class="st t-${r.kweker_toon || 'ok'}"><i></i>${r.kweker_state === 'binnen' ? 'binnen' : `komt ${h(when(r.kweker_eta))}`}</span>` : '<span class="faint">besteld, nog niet toegewezen</span>'}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="empty">Er staat nog niets op deze wagen.</p>'}
  </section>`;
}

function erbijPanel(d) {
  const e = d.erbij;
  if (!e) return '';
  const w = { ...e.wagen };
  const row = l => `<li class="fitrow"><div><b>${h(l.plant)}</b> <span class="faint">${h(l.maat || '')}</span><span class="sub">${fNum(l.vrij)} vrij · ${h(l.reden || '')}</span></div>
    <button type="button" class="btn btn-sm btn-leaf" data-act="erbij" data-x="${pack(w, l)}">${icon('plus')}${fNum(l.aantal)} erbij</button></li>`;
  return `<section class="panel" aria-labelledby="h-e"><header><h2 id="h-e">Kan erbij</h2><span class="sub">Uit de loods, wat ${h(d.wagen.klant)} vaker koopt</span></header>
    ${e.past.length ? `<ul class="fits">${e.past.slice(0, 6).map(row).join('')}</ul>` : '<p class="empty">Niets in de loods dat deze klant vaker koopt.</p>'}
    <p class="later"><button type="button" class="lnk" data-act="erbij-kies" data-id="${d.wagen.id}">Kies zelf uit de hele loods (${e.past.length + e.anders.length} partijen)</button></p>
  </section>`;
}

export async function render(params) {
  const d = await api(`/wagen/${params.id}`);
  const w = d.wagen;
  const phone = w.telefoon || w.whatsapp;
  const stage = STATE[w.state] || '';
  return `<div class="page order-page">
    <a class="back" href="#/vandaag">${icon('back')}Vandaag</a>
    <div class="ph"><div><h1>Wagen naar ${h(w.klant)}</h1><p>${h([`${w.plaats || ''}${w.land ? `, ${COUNTRY[w.land] || w.land}` : ''}`, w.order ? `order ${w.order}` : null, w.vervoerder].filter(Boolean).join(' · '))}</p></div>
      <div class="acts">${phone ? `<a class="btn btn-line" href="${tel(phone)}">${icon('phone')}Bel ${h(w.contact ? w.contact.split(' ')[0] : 'de klant')}</a>` : ''}${w.whatsapp ? `<a class="btn btn-ghost" href="${waLink(w.whatsapp, '')}" target="_blank" rel="noopener">${icon('chat')}App</a>` : ''}</div></div>
    <div class="ostatus t-${w.toon}"><span class="st t-${w.toon}"><i aria-hidden="true"></i>${TONE[w.toon]}</span><p><b>${h(stage)}.</b> ${w.state === 'afgeleverd' ? `Afgeleverd ${h(when(w.eta))}.` : `Vertrekt ${w.state === 'onderweg' ? '' : '± '}${h(when(w.vertrek))}, aankomst waarschijnlijk ${h(when(w.eta))}.`}${w.reden ? ` ${h(cap(w.reden))}.` : ''}</p></div>
    <div class="grid2">
      <div class="stack">${contentPanel(d)}${erbijPanel(d)}</div>
      <aside class="stack">${timesPanel(w)}
        <section class="panel" aria-labelledby="h-ev"><header><h2 id="h-ev">Wat er gebeurde</h2></header>
          ${d.gebeurtenissen.length ? `<ul class="feed body">${d.gebeurtenissen.map(e => `<li><time>${fTime(e.tijd)}</time><span>${h(e.tekst || e.soort)}<br><span class="src">${h(SRC[e.bron] || e.bron || '')}</span></span></li>`).join('')}</ul>` : '<p class="empty">Nog niets gehoord over deze wagen.</p>'}</section>
      </aside>
    </div>
  </div>`;
}

export const actions = {
  erbij(el, ctx) { erbijEen(el, ctx); },
  async 'erbij-kies'(el, ctx) { await erbijKies(el.dataset.id, ctx); },
  async 'l-vertrokken'(el, ctx) { await api(`/leveringen/${el.dataset.id}/gebeurtenis`, { method: 'POST', body: { soort: 'vertrokken' } }); toast('Gemeld: vertrokken.'); ctx.refresh(); },
  async 'l-afgeleverd'(el, ctx) { await api(`/leveringen/${el.dataset.id}/gebeurtenis`, { method: 'POST', body: { soort: 'afgeleverd' } }); toast('Gemeld: afgeleverd.'); ctx.refresh(); },
  async 'l-vertraging'(el, ctx) { const m = await api(`/leveringen/${el.dataset.id}/vertraging-bericht`, { method: 'POST', body: { eta: el.dataset.eta } }); ctx.showMessage(m); },
};
export const refreshEvery = 60000;
