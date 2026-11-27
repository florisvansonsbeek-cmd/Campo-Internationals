// Deze week: the rhythm of one shipment week at a glance (Tuesday order, Thursday confirmation, Friday papers,
// Monday rate, count and hand-out, then one packing slip per customer), what asks for Jan now, and what differs.
import { api, h, icon, fNum } from '../core.js';
import { weekNav, dLong, dMonth, dayTime, stageChip, regio, zn, fKoers } from '../wk.js';

const STAP = { klaar: ['check', 'Klaar'], nu: ['clock', 'Nu'], straks: ['', 'Straks'] };

function context(d) {
  const t = d.vandaag, x = d.dagen;
  if (t === x.maandag) return 'Vandaag zijn de dozen binnen: koers vastzetten, tellen, verdelen en de pakbonnen versturen.';
  if (t > x.maandag) return 'De dozen van deze week zijn binnen.';
  if (t === x.bestellen) return `Vandaag bestellen voor ${dLong(x.maandag)}.`;
  if (t < x.bevestiging) return 'Besteld. Donderdag bevestigen de leveranciers wat er meegaat.';
  if (t === x.bevestiging) return 'Vandaag bevestigen de leveranciers wat er maandag binnenkomt.';
  if (t === x.verzonden) return 'Vandaag gaan de dozen op het vliegtuig. De verzendbewijzen komen binnen.';
  return `De dozen vliegen. Maandag ${dMonth(x.maandag)} staan ze in de hal.`;
}

function steps(d) {
  return `<ol class="ritme" aria-label="Het weekritme">${d.stappen.map((s, i) => {
    const [ic, word] = STAP[s.status];
    return `<li class="rs is-${s.status}${s.huidig ? ' is-huidig' : ''}${s.toon ? ` t-${s.toon}` : ''}">
      <a href="${h(s.href)}">
        <span class="rs-dag">${h(s.dag)} ${h(dMonth(s.datum))}</span>
        <span class="rs-t"><i class="rs-n" aria-hidden="true">${s.status === 'klaar' ? icon('check') : i + 1}</i>${h(s.titel)}</span>
        <span class="rs-s">${ic ? icon(ic) : ''}${word}</span>
        <ul>${s.regels.map(r => `<li>${h(r)}</li>`).join('')}</ul>
      </a></li>`;
  }).join('')}</ol>`;
}

const todo = (list, empty) => (list.length ? `<ul class="todo">${list.map(t => `<li class="${t.toon === 'bad' ? 'bad' : ''}">
    ${icon(t.toon === 'bad' ? 'warn' : t.toon === 'wait' ? 'clock' : 'info', `ic ${t.toon}`)}
    <div><b>${h(t.titel)}</b><p>${h(t.tekst)}</p><div class="acts"><a class="btn btn-sm ${t.toon === 'info' ? 'btn-line' : 'btn-leaf'}" href="${h(t.href)}">${h(t.knop)}</a></div></div>
  </li>`).join('')}</ul>` : `<p class="empty">${empty}</p>`);

function deviations(list) {
  if (!list.length) return '<p class="empty">Alles kwam zoals besteld.</p>';
  const word = { bevestigd: 'bevestigd', verzonden: 'verzonden', geteld: 'geteld', uitval: 'uitval' };
  return `<ul class="devs">${list.slice(0, 10).map(x => `<li>
      <span class="devs-p">${h(x.product)}</span>
      <span class="devs-n">${fNum(x.van)} → <b>${fNum(x.naar)}</b> <span class="dl ${x.verschil < 0 ? 'min' : 'plus'}">${x.verschil > 0 ? '+' : '−'}${fNum(Math.abs(x.verschil))}${x.pct != null ? ` (${x.pct > 0 ? '+' : ''}${x.pct}%)` : ''}</span></span>
      <span class="devs-w">${zn(x.partij)} ${h(word[x.stap])}</span>
    </li>`).join('')}</ul>${list.length > 10 ? `<p class="small faint" style="padding:0 16px 12px">En nog ${list.length - 10}. Alles staat bij Inkoop.</p>` : ''}`;
}

function shipments(d) {
  if (!d.partijen.length) return `<p class="empty">Nog niets besteld voor deze week.</p>`;
  return `<ul class="ships">${d.partijen.map(p => `<li>
      <a href="#/inkoop?maandag=${d.maandag}&p=${p.id}">${zn(p.nummer)}</a>
      <span class="ships-b"><b>${h(p.leverancier)}</b><small>${regio(p.regio)} ${fNum(p.dozen)} dozen${p.verzonden_op ? ` · ${h(p.vlucht || '')}` : p.verwacht ? ` · papieren verwacht ${h(dayTime(p.verwacht))}` : ''}</small></span>
      <span class="ships-s">${stageChip(p.stage)}${p.exact === 'in_exact' ? `<span class="chip ok">${icon('check')}Exact</span>` : ''}${p.twijfels ? `<span class="chip wait">${p.twijfels} nakijken</span>` : ''}</span>
    </li>`).join('')}</ul>`;
}

export async function render(params, query) {
  const m = query.get('maandag');
  const d = await api(`/week/overzicht${m ? `?maandag=${m}` : ''}`);
  const next = d.volgende;
  return `<div class="page wk">
    <div class="ph"><div><p class="kick">Week ${d.week} · binnen ${h(dLong(d.maandag))}</p><h1>Deze week</h1><p>${h(context(d))}</p></div>
      <div class="acts">${weekNav('week', d.maandag)}</div></div>
    ${steps(d)}
    ${d.vorige ? `<section class="panel prev"><header><h2>Nog open van week ${d.vorige.week}</h2><span class="sub">binnen ${h(dLong(d.vorige.maandag))}</span></header>${todo(d.vorige.taken, '')}</section>` : ''}
    <div class="grid2 wk-main">
      <section class="panel"><header><h2>Nu te doen</h2><span class="sub">${d.taken.length ? `${d.taken.length} ${d.taken.length === 1 ? 'ding' : 'dingen'}` : ''}</span></header>
        ${todo(d.taken, 'Niets dat nu om je vraagt. Deze week loopt.')}</section>
      <aside class="stack">
        <section class="panel"><header><h2>Zendingen</h2><span class="sub">${d.koers ? `koers 1 € = $ ${fKoers(d.koers)}` : ''}</span></header>${shipments(d)}</section>
        <section class="panel"><header><h2>Afwijkingen</h2><span class="sub">besteld → bevestigd → verzonden → geteld</span></header>${deviations(d.afwijkingen)}</section>
        <section class="panel"><header><h2>Week ${next.week}</h2><span class="sub">binnen ${h(dLong(next.maandag))}</span></header>
          <div class="body stack" style="gap:10px"><p>${next.klanten ? `${fNum(next.klanten)} ${next.klanten === 1 ? 'klant heeft' : 'klanten hebben'} al gebeld, samen ${fNum(next.dozen)} dozen.` : 'Nog niemand heeft gebeld.'} Bestellen op ${h(dLong(next.bestellen))}.</p>
          <p><a class="btn btn-line btn-sm" href="#/bestellen?maandag=${next.maandag}">${icon('phone')}Telefoon en bestellen</a></p></div></section>
      </aside>
    </div>
  </div>`;
}
export const actions = {};
export const refreshEvery = 60000;
