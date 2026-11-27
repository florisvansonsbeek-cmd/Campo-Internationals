// Inkoop (Thursday and Friday): per supplier what he delivers, the route it flies and whether it will be in the hall on
// Monday (green, orange, red), and the stream to the customers with what is left in the hall. A click on a stream opens
// the full list: what was ordered, confirmed and shipped, the papers, to whom it goes and the purchase order for Exact.
import { api, h, icon, fNum } from '../core.js';
import { weekNav, dLong, dayTime, tTime, zn, regio, stageChip, fUsd } from '../wk.js';
import { stoplicht, lightChip, routeStrip, reasons, flowPartij, flowWeek, timeline, lines, toWhom, exactBox, docsRow, doubts, partijActions, noticeDialog } from '../partij.js';

let last = null;
const open = new Set();    // the full lists Jan opened stay open when the page refreshes itself
let seenP = null;

const cities = (route, plekken) => [...route.map(c => plekken[c]?.stad || c), 'Nootdorp'].join(' → ');
const short = n => n.replace(/ (S\.A\.|B\.V\.|GmbH|Ltd)$/, '');

function sources(d) {
  const w = d.bronnen.weer, s = d.bronnen.storm;
  const weer = { ok: `Weer: MET Norway${w.op ? `, bijgewerkt ${tTime(w.op)}` : ''}`, deels: 'Weer: deels opgehaald', laden: 'Weer: wordt opgehaald', weg: 'Weer: nu niet bereikbaar, de andere signalen tellen wel', 'niet nodig': 'Weer: niet nodig, alles is binnen', uit: 'Weer: uitgezet' }[w.status] || 'Weer: onbekend';
  const storm = { ok: s.aantal ? `Stormen: ${s.aantal} actief (NHC)` : 'Stormen: geen actieve tropische storm (NHC)', laden: 'Stormen: worden opgehaald', weg: 'Stormen: nu niet bereikbaar', 'niet nodig': '', uit: '' }[s.status] || '';
  const n = d.bronnen.meldingen.filter(m => !m.tot || new Date(m.tot) > new Date()).length;
  return `<p class="srcs small faint">${icon('globe')}<span>${[weer, storm, `${n} ${n === 1 ? 'melding' : 'meldingen'} over de route`].filter(Boolean).map(h).join(' · ')}</span>
    <button type="button" class="btn btn-sm btn-line" data-act="melding">${icon('plus')}Melding</button></p>`;
}

// does it arrive on Monday: one line per shipment, the worst reason first
function arrive(d) {
  const ps = d.partijen.filter(p => p.risico && p.risico.licht);
  if (!ps.length) return '';
  const worst = ps.some(p => p.risico.licht === 'rood') ? 'rood' : ps.some(p => p.risico.licht === 'oranje') ? 'oranje' : 'groen';
  const head = { rood: 'Er is een echt probleem op een route', oranje: 'Op schema, met iets om in de gaten te houden', groen: 'Alles op schema voor maandag' }[worst];
  return `<section class="panel arrive" id="binnen" data-l="${worst}"><header><h2>Komt het maandag binnen?</h2><span class="sub">${h(head)}</span></header>
    <ul class="arr">${ps.map(p => {
      const r = p.risico, when = r.licht === 'binnen' ? dayTime(r.binnen) : r.aankomst;
      return `<li data-l="${h(r.licht)}"><a class="arr-a" href="#p${p.id}">
        <span class="arr-l">${stoplicht(r.licht)}</span>
        <span class="arr-b"><span class="arr-h">${zn(p.nummer)} <b>${h(short(p.leverancier))}</b> <small>${h(cities(p.route, d.plekken))}</small></span>
          <span class="arr-k">${h(r.kop)}</span></span>
        <span class="arr-t"><b>${h(when || '')}</b><small>${r.licht === 'binnen' ? 'binnen' : 'in de loods'}</small></span></a></li>`;
    }).join('')}</ul>
    ${sources(d)}</section>`;
}

function weekStream(d) {
  const w = d.stroom;
  if (!d.partijen.some(p => p.stroom && p.stroom.dozen)) return '';
  const klanten = w.klanten.filter(k => k.dozen > 0).length;
  const net = w.teVeel ? ['bad', 'warn', `${fNum(w.teVeel)} dozen meer verdeeld dan er binnenkomt.`]
    : w.rest ? ['wait', 'info', `${fNum(w.rest)} ${w.rest === 1 ? 'doos heeft' : 'dozen hebben'} nog geen klant en ${w.rest === 1 ? 'blijft' : 'blijven'} over in de loods.`]
      : ['ok', 'check', 'Netto nul: elke doos heeft een klant, er blijft niets over in de loods.'];
  const basis = { geteld: 'Zoals het maandag geteld en verdeeld is.', verzonden: 'Uit de verzendbewijzen en de telefoonbestellingen. Maandag na het tellen wordt het de echte verdeling.', bevestigd: 'Uit de bevestigingen en de telefoonbestellingen.', besteld: 'Uit de bestelling en de telefoonbestellingen.' }[w.basis];
  return `<section class="panel stream" id="stroom"><header><h2>Waar het naartoe gaat</h2><span class="sub">${fNum(w.in)} dozen in · ${fNum(w.uit)} naar ${fNum(klanten)} klanten${w.rest ? ` · ${fNum(w.rest)} over` : ''}</span></header>
    <div class="body stack">
      <p class="net ${net[0]}">${icon(net[1])}<span>${h(net[2])}${w.kortKlanten ? ` ${fNum(w.kortKlanten)} ${w.kortKlanten === 1 ? 'klant krijgt' : 'klanten krijgen'} minder dan gevraagd (samen ${fNum(w.tekort)} dozen).` : ''}${w.rest ? ' <a href="#/bestellen">Goede deals</a> zoekt er kopers bij.' : ''}</span></p>
      ${flowWeek(w, d.partijen, { maandag: d.maandag })}
      <p class="small faint">${h(basis)} Klik op een leverancier voor zijn papieren, op de stroom voor de volledige lijst.</p>
    </div></section>`;
}

function card(p, d) {
  const r = p.risico, st = p.stroom, isOpen = open.has(p.id);
  const stuks = p.regels.reduce((s, x) => s + (x.verzonden ?? x.bevestigd ?? x.besteld ?? 0) * x.per_doos, 0);
  const basis = { verzonden: 'volgens het verzendbewijs', bevestigd: 'volgens de bevestiging', besteld: 'zoals besteld', geteld: 'geteld in de hal' }[st?.basis] || '';
  const manual = p.stage === 'besteld' ? `<button type="button" class="btn btn-sm btn-ghost" data-act="stage" data-id="${p.id}" data-stap="bevestigd">Bevestigd zonder papier</button>`
    : p.stage === 'bevestigd' ? `<button type="button" class="btn btn-sm btn-ghost" data-act="stage" data-id="${p.id}" data-stap="verzonden">Verzonden zonder papier</button>` : '';
  const exactNow = p.exact === 'in_exact' ? `<span class="chip ok">${icon('check')}In Exact</span>`
    : p.verzonden_op && !p.twijfels ? `<button type="button" class="btn btn-sm btn-leaf" data-act="exact-in" data-id="${p.id}">${icon('check')}Staat in Exact</button>` : '';
  return `<section class="panel partij" id="p${p.id}" data-l="${h(r?.licht || '')}">
    <header><h2>${r?.licht ? stoplicht(r.licht) : ''} ${zn(p.nummer)} <a href="#/leverancier/${p.leverancier_id}?maandag=${d.maandag}">${h(p.leverancier)}</a></h2>
      <span class="ph-chips">${regio(p.regio)} ${stageChip(p.stage)}${p.twijfels ? ` <span class="chip wait">${p.twijfels} nakijken</span>` : ''} <button type="button" class="lnk small" data-act="nummer" data-id="${p.id}" data-nr="${h(p.nummer)}">Zendnummer wijzigen</button></span></header>
    <div class="body stack">
      ${r ? `<div class="rt">${routeStrip(r)}<p class="rt-a">${lightChip(r.licht)}<span>${h(r.kop)}</span><button type="button" class="lnk small" data-act="route" data-p="${p.id}">Route wijzigen</button></p></div>
      ${reasons(r, { doubt: !p.twijfels })}` : ''}
      ${doubts(p)}
      <div class="wl"><h3>Wat ${h(short(p.leverancier))} levert</h3><p class="small muted">${fNum(p.regels.length)} ${p.regels.length === 1 ? 'variant' : 'varianten'} · ${fNum(p.dozen)} dozen · ${fNum(stuks)} stuks · ${fUsd(p.totaal_usd)}${basis ? ` · ${basis}` : ''}</p></div>
      ${flowPartij(st, { id: p.id })}
      <div class="row-a">
        <button type="button" class="btn btn-sm btn-line" data-act="flow" data-p="${p.id}" aria-expanded="${isOpen}" aria-controls="full${p.id}">${icon('file')}<span>${isOpen ? 'Verberg de volledige lijst' : 'Volledige lijst'}</span></button>
        <a class="btn btn-sm btn-ghost" href="#/leverancier/${p.leverancier_id}?maandag=${d.maandag}">${icon('mail')}Papieren en Excel</a>
        ${exactNow}
      </div>
      <div class="full stack" id="full${p.id}"${isOpen ? '' : ' hidden'}>
        ${timeline(p)}
        ${docsRow(p)}
        <h3>Maten, aantallen en prijzen</h3>${lines(p)}
        <h3>Naar wie het gaat</h3>${toWhom(p)}
        ${exactBox(p)}
        ${manual ? `<p class="small faint">Kwam de ${p.stage === 'besteld' ? 'bevestiging' : 'verzendinformatie'} via de telefoon? ${manual}</p>` : ''}
      </div>
    </div>
  </section>`;
}

export async function render(params, query) {
  const m = query.get('maandag');
  const d = await api(`/week/inkoop${m ? `?maandag=${m}` : ''}`);
  last = d;
  const want = Number(query.get('p'));
  if (want && seenP !== `${d.maandag}:${want}`) { open.add(want); seenP = `${d.maandag}:${want}`; }
  return `<div class="page wk">
    <div class="ph"><div><p class="kick">Week ${d.week} · binnen ${h(dLong(d.maandag))}</p><h1>Inkoop</h1>
      <p>Wat elke leverancier levert, langs welke route het komt en naar welke klanten het gaat. Klik op een stroom voor de volledige lijst, op een leverancier voor zijn papieren.</p></div>
      <div class="acts">${weekNav('inkoop', d.maandag)}</div></div>
    ${d.vorige.length ? `<div class="warnbox wait">${icon('info')}<span>Nog niet in Exact van week ${d.vorige[0].week}: ${d.vorige.map(p => `<a href="#/inkoop?maandag=${p.maandag}&p=${p.id}">${h(p.nummer)}</a>`).join(', ')}.</span></div>` : ''}
    ${d.partijen.length ? `${arrive(d)}${weekStream(d)}${d.partijen.map(p => card(p, d)).join('')}` : `<section class="panel"><p class="empty">Voor deze week is nog niets besteld. <a href="#/bestellen?maandag=${d.maandag}">Naar bestellen</a></p></section>`}
  </div>`;
}

export function mount() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const el = q.get('p') && document.getElementById(`p${q.get('p')}`);
  if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 30);
}
export const refreshEvery = 60000;

const P = id => last.partijen.find(p => p.id === Number(id));
function toggle(id, show) {
  const full = document.getElementById(`full${id}`), btn = document.querySelector(`button[data-act="flow"][data-p="${id}"]`);
  if (!full) return;
  const on = show ?? full.hidden;
  full.hidden = !on;
  if (on) open.add(id); else open.delete(id);
  if (btn) { btn.setAttribute('aria-expanded', String(on)); btn.querySelector('span').textContent = on ? 'Verberg de volledige lijst' : 'Volledige lijst'; }
  return full;
}

export const actions = {
  ...partijActions(P),
  // a click on the stream (or its button) opens the full list; links inside the picture still go where they point
  flow: (el, ctx, e) => {
    if (e && e.target.closest('a')) return 'default';
    const id = Number(el.dataset.p), full = toggle(id);
    if (full && !full.hidden && el.tagName !== 'BUTTON') setTimeout(() => full.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);
  },
  'flow-all': (el, ctx, e) => {
    if (e && e.target.closest('a')) return 'default';
    for (const p of last.partijen) toggle(p.id, true);
    const first = last.partijen[0] && document.getElementById(`p${last.partijen[0].id}`);
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  melding: (el, ctx) => noticeDialog(ctx, { plekken: last.plekken }),
};
