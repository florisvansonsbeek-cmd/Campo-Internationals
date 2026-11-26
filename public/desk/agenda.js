// The agenda, as in the first Vandaag: this week first, day by day, with every truck that comes in
// and every truck that goes out. One click to the month, or open it live in its own tab.
import { api, h, icon, fTime, fNum } from './core.js';

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const noon = d => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = noon(d); x.setDate(x.getDate() + n); return x; };
const monday = d => { const x = noon(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const isoWeek = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7); };
const DOW = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const MON = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONTH = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const NEW = 'target="_blank" rel="noopener"';
const SHORT = /^(Kwekerij|Gärtnerei|Snijbloemen|Tuincentrum|Bloemsalon|Kwiaciarnia|Floristería|Blomsterhandel|Anthuriumhof)\s+/;
export const short = n => String(n || '').replace(SHORT, '').replace(/\s+(BV|B\.V\.|ApS|Ltd|AB|GmbH)$/, '');
const kNum = n => (n >= 10000 ? `${Math.round(n / 1000)}k` : fNum(n));

// what the agenda shows; survives the refresh every minute
export const AG = { view: 'week', anchor: new Date(), hideDone: false };

function range() {
  if (AG.view === 'week') { const a = monday(AG.anchor); return [a, addDays(a, 6)]; }
  const first = noon(new Date(AG.anchor.getFullYear(), AG.anchor.getMonth(), 1));
  const last = noon(new Date(AG.anchor.getFullYear(), AG.anchor.getMonth() + 1, 0));
  return [monday(first), addDays(monday(last), 6)];
}
function title() {
  const [a, b] = range();
  if (AG.view === 'maand') return `${MONTH[AG.anchor.getMonth()].replace(/^./, c => c.toUpperCase())} ${AG.anchor.getFullYear()}`;
  return `Week ${isoWeek(a)} · ${a.getDate()}${a.getMonth() !== b.getMonth() ? ` ${MON[a.getMonth()]}` : ''} – ${b.getDate()} ${MON[b.getMonth()]}`;
}

function item(x, kind) {
  const gone = kind === 'in' ? x.state === 'binnen' : x.state === 'onderweg' || x.state === 'afgeleverd';
  const name = kind === 'in' ? x.kweker : x.klant;
  const tip = kind === 'in'
    ? `${x.kweker}${x.plaats ? `, ${x.plaats}` : ''} · ${fNum(x.stuks)} stuks · ${x.state === 'binnen' ? `binnen ${fTime(x.tijd)}` : `verwacht ${fTime(x.tijd)}`}${x.reden ? ` · ${x.reden}` : ''}`
    : `Wagen naar ${x.klant}${x.plaats ? `, ${x.plaats}` : ''} · ${gone ? 'vertrok' : 'vertrekt'} ${fTime(x.tijd)} · aankomst ${fTime(x.aankomst)}${x.reden ? ` · ${x.reden}` : ''}`;
  return `<li><a class="ag-it ${kind} t-${x.toon}${gone ? ' gone' : ''}" href="${kind === 'in' ? `#/bestelling/${x.id}` : `#/wagen/${x.id}`}" ${NEW} title="${h(tip)}">
    <time>${gone ? '' : '±'}${fTime(x.tijd)}</time><b>${h(short(name))}</b>${x.stuks ? `<span>${kNum(x.stuks)}</span>` : ''}</a></li>`;
}

function dayCol(d, data, today) {
  const key = ymd(d), past = key < ymd(today), isToday = key === ymd(today);
  let ins = data.binnen.filter(x => x.dag === key), outs = data.weg.filter(x => x.dag === key);
  const need = data.nodig.filter(x => x.dag === key), offers = data.aanbod.filter(x => x.dag === key);
  const nIn = ins.length, nOut = outs.length;
  if (AG.hideDone) { ins = ins.filter(x => x.state !== 'binnen'); outs = outs.filter(x => x.state !== 'afgeleverd' && x.state !== 'onderweg'); }
  const empty = !nIn && !nOut && !need.length && !offers.length;
  return `<div class="ag-day${isToday ? ' today' : ''}${past ? ' past' : ''}${d.getDay() === 0 ? ' sun' : ''}">
    <header><span class="dw">${DOW[d.getDay()]}${isToday ? ' · vandaag' : ''}</span><b>${d.getDate()} ${MON[d.getMonth()]}</b></header>
    ${need.length ? `<p class="ag-need" title="${h(need.map(n => `${n.klant}: ${fNum(n.stuks)} stuks, order ${n.nummer}`).join('\n'))}">▲ ${h(need.map(n => short(n.klant)).join(', '))}</p>` : ''}
    ${empty ? `<p class="ag-empty">${past ? 'Niets' : 'Nog niets gepland'}</p>` : `<ul class="ag-list">
      ${nIn ? `<li class="ag-sec">${icon('in')}Binnen <span>${nIn}</span></li>${ins.map(x => item(x, 'in')).join('')}${AG.hideDone && nIn > ins.length ? `<li class="ag-more">${nIn - ins.length} al binnen</li>` : ''}` : ''}
      ${offers.map(o => `<li><a class="ag-it offer" href="#/aanbod/${o.id}" ${NEW} title="${h(`Aanbod van ${o.kweker}: ${fNum(o.stuks)} stuks; komt als je bestelt`)}"><time>◇</time><b>${h(short(o.kweker))}</b><span>aanbod</span></a></li>`).join('')}
      ${nOut ? `<li class="ag-sec">${icon('uit')}Weg <span>${nOut}</span></li>${outs.map(x => item(x, 'out')).join('')}${AG.hideDone && nOut > outs.length ? `<li class="ag-more">${nOut - outs.length} al weg</li>` : ''}` : ''}
    </ul>`}
  </div>`;
}

function monthCell(d, data, today) {
  const key = ymd(d), other = d.getMonth() !== AG.anchor.getMonth();
  const ins = data.binnen.filter(x => x.dag === key), outs = data.weg.filter(x => x.dag === key);
  const open = [...ins.filter(x => x.state !== 'binnen'), ...outs.filter(x => x.state !== 'afgeleverd')];
  const bad = open.filter(x => x.toon === 'bad').length, wait = open.filter(x => x.toon === 'wait').length;
  const need = data.nodig.filter(x => x.dag === key).length, offers = data.aanbod.filter(x => x.dag === key).length;
  return `<button type="button" class="ag-cell${other ? ' other' : ''}${key === ymd(today) ? ' today' : ''}${key < ymd(today) ? ' past' : ''}" data-act="ag-go" data-d="${key}" aria-label="${h(`${d.getDate()} ${MONTH[d.getMonth()]}: ${ins.length} binnen, ${outs.length} weg${bad ? `, ${bad} in gevaar` : ''}. Toon die week.`)}">
    <b>${d.getDate()}</b>
    ${ins.length || outs.length ? `<span class="ag-c">${ins.length ? `<i class="in">↓ ${ins.length}</i>` : ''}${outs.length ? `<i class="out">↑ ${outs.length}</i>` : ''}</span>` : ''}
    ${bad || wait ? `<span class="ag-p">${bad ? `<i class="t-bad">${bad}</i>` : ''}${wait ? `<i class="t-wait">${wait}</i>` : ''}</span>` : ''}
    ${need ? `<span class="ag-n">▲ ${need}</span>` : ''}${offers ? `<span class="ag-o">◇ ${offers}</span>` : ''}
  </button>`;
}

export async function agendaHtml({ live = false } = {}) {
  const [a, b] = range();
  const data = await api(`/agenda?van=${ymd(a)}&tot=${ymd(b)}`);
  const today = new Date(data.nu);
  const days = []; for (let d = a; d <= b; d = addDays(d, 1)) days.push(d);
  const body = AG.view === 'week'
    ? `<div class="ag-week">${days.map(d => dayCol(d, data, today)).join('')}</div>`
    : `<div class="ag-month"><div class="ag-mh">${['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map(x => `<span>${x}</span>`).join('')}</div><div class="ag-cells">${days.map(d => monthCell(d, data, today)).join('')}</div></div>`;
  return `<section class="panel agenda${live ? ' live' : ''}" id="agenda" aria-labelledby="h-ag">
    <header class="ag-head">
      <div><h2 id="h-ag">Agenda</h2><span class="sub">${AG.view === 'week' ? 'Welke wagen wanneer binnenkomt en weggaat. Klik voor alles erover.' : 'Klik een dag voor die week.'}</span></div>
      <div class="ag-tools">
        <div class="tog" role="group" aria-label="Weergave"><button type="button" data-act="ag-view" data-v="week" aria-pressed="${AG.view === 'week'}">Deze week</button><button type="button" data-act="ag-view" data-v="maand" aria-pressed="${AG.view === 'maand'}">Deze maand</button></div>
        <div class="ag-nav"><button type="button" class="icon-btn" data-act="ag-prev" aria-label="${AG.view === 'week' ? 'Vorige week' : 'Vorige maand'}">${icon('back')}</button><b>${h(title())}</b><button type="button" class="icon-btn fwd" data-act="ag-next" aria-label="${AG.view === 'week' ? 'Volgende week' : 'Volgende maand'}">${icon('back')}</button></div>
        <button type="button" class="btn btn-sm btn-ghost" data-act="ag-today">Vandaag</button>
        ${live ? '' : `<a class="btn btn-sm btn-line" href="#/agenda" ${NEW}>${icon('out')}Live in nieuw tabblad</a>`}
      </div>
    </header>
    ${body}
    <footer class="ag-foot">
      <span><i class="lg in"></i>Binnen van de kweker</span><span><i class="lg out"></i>Weg naar de klant</span><span><i class="lg t-wait"></i>Krap</span><span><i class="lg t-bad"></i>In gevaar</span>
      <span>▲ Klant heeft iets nodig, nog geen wagen</span><span>◇ Aanbod: komt als je bestelt</span>
      <label class="ck small"><input type="checkbox" data-act="ag-done"${AG.hideDone ? ' checked' : ''}> Verberg wat al gebeurd is</label>
    </footer>
  </section>`;
}

export const agendaActions = {
  'ag-view'(el, ctx) { AG.view = el.dataset.v; AG.anchor = new Date(); ctx.refresh(); },
  'ag-prev'(el, ctx) { AG.anchor = AG.view === 'week' ? addDays(AG.anchor, -7) : noon(new Date(AG.anchor.getFullYear(), AG.anchor.getMonth() - 1, 1)); ctx.refresh(); },
  'ag-next'(el, ctx) { AG.anchor = AG.view === 'week' ? addDays(AG.anchor, 7) : noon(new Date(AG.anchor.getFullYear(), AG.anchor.getMonth() + 1, 1)); ctx.refresh(); },
  'ag-today'(el, ctx) { AG.anchor = new Date(); ctx.refresh(); },
  'ag-go'(el, ctx) { AG.view = 'week'; AG.anchor = noon(new Date(`${el.dataset.d}T12:00:00`)); ctx.refresh(); },
  'ag-done'(el, ctx) { AG.hideDone = !AG.hideDone; ctx.refresh(); },
};

// the live page: the agenda on its own, in its own tab
export async function render() {
  return `<div class="page ag-page">
    <div class="ph"><div><h1>Agenda</h1><p>Live: ververst elke minuut. Welke wagen wanneer binnenkomt en weggaat.</p></div>
      <div class="acts"><a class="btn btn-ghost" href="#/vandaag">${icon('back')}Vandaag</a></div></div>
    ${await agendaHtml({ live: true })}
  </div>`;
}
export const actions = agendaActions;
export const refreshEvery = 60000;
