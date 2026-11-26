// Vandaag: what asks for Jan, which truck comes in and which goes out (and what can still go along),
// and the agenda: this week first, the month one click away, or live in its own tab.
import { api, h, icon, fTime, fNum, fEur, plural, waLink, fLong, RISICO } from '../core.js';
import { agendaHtml, agendaActions } from '../agenda.js';
import { erbijEen, erbijKies, pack } from '../erbij.js';
import { when, dur } from '../lane.js';

const NEW = 'target="_blank" rel="noopener"';
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
let trDay = 'vandaag';

const lateTag = (m, toon) => (m >= 10 ? ` <span class="lt t-${toon === 'bad' ? 'bad' : 'wait'}">+${dur(m)}</span>` : '');
const askGrower = (z, t) => (z.land === 'DE' ? `Hallo, kommt der LKW von ${fTime(t)} noch nach Nootdorp? Könnt ihr noch etwas dazuladen? Gruß, Jan`
  : z.land && z.land !== 'NL' && z.land !== 'BE' ? `Hi, is the truck of ${fTime(t)} still coming to Nootdorp? Could you load something extra? Best, Jan`
    : `Hoi, komt de wagen van ${fTime(t)} nog naar Nootdorp? Kunnen jullie er nog iets bij laden? Groet, Jan`);

function inRow(z) {
  const done = z.state === 'binnen';
  const what = done ? `binnen${z.delay >= 10 ? `, ${dur(z.delay)} later` : ''}` : z.state === 'onderweg' ? 'onderweg naar Nootdorp' : z.state === 'laden' ? 'wordt geladen bij de kweker' : `vertrekt ${when(z.vertrek)} bij de kweker`;
  const wa = z.whatsapp && !done ? waLink(z.whatsapp, z.state === 'onderweg' ? 'Hoi, hoe laat zijn jullie in Nootdorp? Groet, Jan' : askGrower(z, z.tijd)) : null;
  return `<li class="tr s-${z.state} t-${z.toon}${done ? ' gone' : ''}">
    <time>${done ? icon('check') : '±'}${fTime(z.tijd)}${done ? '' : lateTag(z.delay, z.toon)}</time>
    <div class="tr-b">
      <a class="tr-n" href="#/bestelling/${z.id}" ${NEW}><b>${h(z.kweker)}</b></a>
      <span class="tr-s">${h([z.plaats, `${fNum(z.stuks)} stuks`, what].filter(Boolean).join(' · '))}</span>
      ${z.reden && z.toon !== 'ok' && z.toon !== 'done' ? `<span class="tr-why t-${z.toon}">${h(z.reden)}</span>` : ''}
      ${wa ? `<span class="tr-add"><a class="lnk" href="${wa}" target="_blank" rel="noopener">${icon('chat')}${z.state === 'onderweg' ? 'Vraag hoe laat' : 'Kan er nog iets bij?'}</a></span>` : ''}
    </div>
  </li>`;
}

function outRow(w) {
  const gone = w.state === 'onderweg' || w.state === 'afgeleverd';
  const arr = w.state === 'afgeleverd' ? `afgeleverd ${fTime(w.aankomst)}` : `aankomst ${gone ? '' : '± '}${when(w.aankomst)}`;
  const fits = w.erbij || [];
  return `<li class="tr s-${w.state} t-${w.toon}${gone ? ' gone' : ''}">
    <time>${gone ? icon('check') : '±'}${fTime(w.tijd)}${!gone && w.uitstel >= 10 ? lateTag(w.uitstel, w.toon) : ''}</time>
    <div class="tr-b">
      <a class="tr-n" href="#/wagen/${w.id}" ${NEW}><b>${h(w.klant)}</b></a>
      <span class="tr-s">${h([w.plaats, w.stuks ? `${fNum(w.stuks)} stuks` : '', arr].filter(Boolean).join(' · '))}${gone || w.delay < 10 ? '' : lateTag(w.delay, w.toon)}</span>
      ${w.reden && (w.toon === 'wait' || w.toon === 'bad') ? `<span class="tr-why t-${w.toon}">${h(w.reden.charAt(0).toUpperCase() + w.reden.slice(1))}</span>` : ''}
      ${gone ? '' : `<span class="tr-add">${fits.length ? `<span>Kan erbij:</span>${fits.slice(0, 2).map(l => `<button type="button" class="fit" data-act="erbij" data-x="${pack({ ...w, levering_id: w.id, vertrek: w.tijd }, l)}" title="${h(l.reden)}">${fNum(l.aantal)} ${h(l.plant)}</button>`).join('')}` : ''}<button type="button" class="lnk" data-act="erbij-kies" data-id="${w.id}">${fits.length ? 'Meer' : `${icon('plus')}Iets erbij doen`}</button></span>`}
    </div>
  </li>`;
}

// past above the line, what is still to come below it
function withNow(items, row, now) {
  let i = items.findIndex(x => new Date(x.tijd) > now);
  if (i < 0) i = items.length;
  const line = `<li class="tr-now" aria-label="Nu"><span>nu ${fTime(now)}</span></li>`;
  return [...items.slice(0, i).map(row), ...(trDay === 'vandaag' ? [line] : []), ...items.slice(i).map(row)].join('');
}

function todoList(items) {
  if (!items.length) return '<p class="empty">Niets dat nu om je vraagt. Alles loopt.</p>';
  return `<ul class="todo">${items.slice(0, 6).map(a => `<li class="${a.toon === 'bad' ? 'bad' : ''}">
      ${icon(a.toon === 'bad' ? 'warn' : a.toon === 'wait' ? 'clock' : 'info', `ic ${a.toon}`)}
      <div><b>${h(a.titel)}</b><p>${h(a.tekst)}</p>${a.risico && a.risico !== 'laag' ? `<p class="small" style="color:var(--${a.risico === 'hoog' ? 'warn' : 'wait'})">${h(RISICO[a.risico].naam)}</p>` : ''}</div>
      <div class="acts">${a.link ? `<a class="btn btn-sm ${a.toon === 'bad' ? 'btn-bad' : 'btn-line'}" href="${a.link}">${h(a.knop || 'Openen')}</a>` : ''}${a.bellen ? `<a class="btn btn-sm btn-ghost" href="${waLink(a.bellen, 'Hoi, hoe laat zijn jullie in Nootdorp? Gr Jan')}" target="_blank" rel="noopener">${icon('chat')}App kweker</a>` : ''}</div>
    </li>`).join('')}${items.length > 6 ? `<li><span></span><a class="lnk" href="#/workflow">Nog ${items.length - 6} in de workflow</a></li>` : ''}</ul>`;
}

export async function render() {
  const now0 = new Date();
  const day = trDay === 'morgen' ? new Date(now0.getFullYear(), now0.getMonth(), now0.getDate() + 1, 12) : now0;
  const [d, tr, agenda] = await Promise.all([api('/vandaag'), api(`/wagens?dag=${ymd(day)}`), agendaHtml()]);
  const now = new Date(d.nu), k = d.kpi;
  const inOpen = tr.binnen.filter(z => z.state !== 'binnen').length, outOpen = tr.weg.filter(w => w.state === 'klaar' || w.state === 'wacht').length;
  return `<div class="page">
    <div class="ph"><div><h1>Vandaag</h1><p>${h(fLong(now))}: wat om je vraagt, welke wagen wanneer komt en gaat, en de agenda. Ververst elke minuut.</p></div>
      <div class="acts"><a class="btn btn-ghost" href="#/uitleg">${icon('book')}Zo werkt het</a><a class="btn btn-leaf" href="#/workflow">${icon('flow')}Naar de workflow</a></div></div>
    <div class="kpis story-kpis">
      <a class="kpi" href="#/workflow"><span><i class="nr">1</i>Klaar om te bestellen</span><b class="t">${k.aanbod + k.bellen_aanbod}</b><em>${k.aanbod + k.bellen_aanbod ? `${plural(k.aanbod + k.bellen_aanbod, 'mand', 'manden')}, ${fEur(k.marge)} marge als klanten ja zeggen` : 'geen open aanbod'}</em></a>
      <a class="kpi${k.bellen ? ' act' : ''}" href="#/workflow"><span><i class="nr">2</i>Klanten bellen</span><b class="t">${k.bellen}</b><em>${k.bellen ? `voor ${plural(k.aanbod + k.bellen_aanbod, 'mand', 'manden')}` : 'niemand te bellen'}</em></a>
      <a class="kpi${k.achter ? ' bad' : ''}" href="#wagens"><span><i class="nr">3</i>Onderweg naar Campo</span><b class="t">${k.onderweg}</b><em>${k.achter ? `${k.achter} ${k.achter === 1 ? 'kweker loopt' : 'kwekers lopen'} achter` : `${k.binnen} van ${k.vandaag} vandaag al binnen`}</em></a>
      <a class="kpi" href="#/loods"><span><i class="nr">4</i>In de loods</span><b class="t">${fNum(k.loods)}</b><em>${fNum(k.loods_vrij)} vrij${k.loods_te_lang ? `, <strong class="late-t">${k.loods_te_lang} te lang</strong>` : ''}</em></a>
    </div>
    <div class="grid2">
      <div class="stack">
        <section class="panel trucks" id="wagens" aria-labelledby="h-tr">
          <header><div><h2 id="h-tr">Vrachtwagens ${trDay === 'morgen' ? 'morgen' : 'vandaag'}</h2><span class="sub">Wanneer ongeveer welke wagen binnenkomt en weggaat. Wat nog niet weg is, kan nog iets bij.</span></div>
            <div class="tog" role="group" aria-label="Dag"><button type="button" data-act="tr-dag" data-d="vandaag" aria-pressed="${trDay === 'vandaag'}">Vandaag</button><button type="button" data-act="tr-dag" data-d="morgen" aria-pressed="${trDay === 'morgen'}">Morgen</button></div></header>
          <div class="tr-cols">
            <div class="tr-col"><h3>${icon('in')}Komt binnen <span>${tr.binnen.length}${inOpen && inOpen < tr.binnen.length ? `, nog ${inOpen}` : ''}</span></h3>
              ${tr.binnen.length ? `<ol class="tr-list">${withNow(tr.binnen, inRow, now)}</ol>` : '<p class="empty">Er komt niets binnen.</p>'}</div>
            <div class="tr-col"><h3>${icon('uit')}Gaat weg <span>${tr.weg.length}${outOpen && outOpen < tr.weg.length ? `, nog ${outOpen}` : ''}</span></h3>
              ${tr.weg.length ? `<ol class="tr-list">${withNow(tr.weg, outRow, now)}</ol>` : '<p class="empty">Er gaat niets weg.</p>'}</div>
          </div>
          ${tr.vrij && tr.vrij.stuks ? `<p class="tr-foot">${icon('shed')}In de loods staan <b>${fNum(tr.vrij.stuks)}</b> stuks zonder klant. <a class="lnk" href="#/workflow">Koppel ze aan een wagen</a></p>` : ''}
        </section>
      </div>
      <aside class="stack">
        <section class="panel" aria-labelledby="h-todo"><header><h2 id="h-todo">Wat nu om jou vraagt</h2><span class="sub">Belangrijkste bovenaan</span></header>${todoList(d.aandacht)}</section>
      </aside>
    </div>
    ${agenda}
  </div>`;
}

export const actions = {
  ...agendaActions,
  'tr-dag'(el, ctx) { trDay = el.dataset.d; ctx.refresh(); },
  erbij(el, ctx) { erbijEen(el, ctx); },
  async 'erbij-kies'(el, ctx) { await erbijKies(el.dataset.id, ctx); },
};
export const refreshEvery = 60000;
