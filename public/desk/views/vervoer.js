// Vervoer, a part of Bestellen en relaties: what could stop the plants on their way to Nootdorp. This week's shipments
// with their light, the route airports for the coming week (the weather of MET Norway on the day itself), tropical storms
// near Central America and the Caribbean (National Hurricane Center), Jan's own notices, the busy cargo weeks of the
// calendar and how punctual every supplier was. Only airport coordinates leave the desk.
import { api, h, icon, toast } from '../core.js';
import { dShort, dayTime } from '../wk.js';
import { noticeDialog } from '../partij.js';

let V = null;
const LIGHT = { rood: ['bad', 'In gevaar'], oranje: ['wait', 'Let op'], groen: ['ok', 'Op schema'], binnen: ['in', 'Binnen'] };
const ERN = { probleem: 'bad', let_op: 'wait', ok: 'ok', info: 'info' };
const DD = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric' });
const dd = s => DD.format(new Date(`${s}T12:00:00`)).replace('.', '');

function grid(v) {
  const any = v.plekken.some(p => p.dagen.some(x => x.ernst));
  const notes = v.plekken.flatMap(p => p.dagen.filter(x => x.tekst).map(x => ({ ernst: x.ernst, tekst: x.tekst })));
  return `<section class="panel"><header><h2>De route, de komende week</h2><span class="sub">het weer op elke luchthaven, op de dag zelf</span></header>
    <div class="tbwrap"><table class="tb vgrid"><thead><tr><th>Plek</th>${v.dagen.map(d => `<th class="c">${h(dd(d))}</th>`).join('')}</tr></thead><tbody>
      ${v.plekken.map(p => `<tr><td><b>${h(p.code === 'NTD' ? 'Loods' : p.code)}</b><small>${h(p.code === 'NTD' ? 'Nootdorp' : p.stad)}</small></td>
        ${p.dagen.map(x => `<td class="c"><span class="vd t-${x.ernst ? ERN[x.ernst] : 'none'}" title="${h(x.tekst || (x.ernst ? `Niets in de weg${x.wind != null ? `, wind tot ${x.wind} km/u` : ''}` : 'Geen verwachting'))}"></span></td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    <div class="body">${!any ? `<p class="small faint">${icon('info')} Het weer is nu niet bereikbaar${v.bronnen.weer.fout ? ` (${h(v.bronnen.weer.fout)})` : ''}. Op de echte site haalt de desk het elk uur op bij MET Norway.</p>`
      : notes.length ? `<ul class="vnotes">${notes.map(n => `<li class="t-${ERN[n.ernst]}">${icon(n.ernst === 'probleem' ? 'warn' : 'clock')}<span>${h(n.tekst)}</span></li>`).join('')}</ul>`
        : '<p class="small">Geen zwaar weer verwacht op de route.</p>'}</div></section>`;
}

export async function render() {
  V = await api('/week/vervoer');
  const v = V;
  const bad = v.zendingen.filter(z => z.licht === 'rood').length, wait = v.zendingen.filter(z => z.licht === 'oranje').length;
  return `<div class="part-h"><div><h2>Vervoer</h2><p>Wat de planten op weg naar Nootdorp kan tegenhouden: het weer op elke luchthaven, stormen, stakingen en drukke vrachtweken. Een melding telt meteen mee in het licht van elke zending die over die plek komt.</p></div>
      <div class="acts"><button type="button" class="btn btn-line" data-act="v-melding">${icon('plus')}Melding over de route</button></div></div>
    <div class="grid2">
      <div class="stack">
        <section class="panel"><header><h2>Week ${v.week}</h2><span class="sub">${bad ? `${bad} in gevaar` : wait ? `${wait} let op` : 'alles op schema'}</span></header>
          <ul class="vz">${v.zendingen.map(z => { const [t, w] = LIGHT[z.licht] || ['none', 'Nog niet besteld']; return `<li class="t-${t}">
            <span class="vz-l" aria-hidden="true"></span>
            <a class="vz-n" href="#/inkoop?maandag=${v.maandag}&p=${z.id}"><b>${h(z.leverancier)}</b><small>${h(z.nummer)} · ${h(z.route.join(' → '))} → Nootdorp</small></a>
            <span class="vz-s"><span class="st t-${t}"><i aria-hidden="true"></i>${w}</span>${z.aankomst ? `<small>loods ${h(z.aankomst)}</small>` : ''}</span>
            ${z.licht === 'rood' || z.licht === 'oranje' ? `<p class="vz-w">${h(z.kop)}</p>` : ''}</li>`; }).join('') || '<li class="empty">Deze week is nog niets besteld.</li>'}</ul></section>
        ${grid(v)}
      </div>
      <aside class="stack">
        <section class="panel"><header><h2>Meldingen</h2><span class="sub">van jou, of van een leverancier</span></header>
          <ul class="vm">${v.meldingen.map(m => `<li class="t-${ERN[m.ernst] || 'wait'}"><div><b>${h(m.titel)}</b><small>${h([m.plek, m.tot ? `tot ${dayTime(m.tot)}` : 'tot het opgelost is', m.vertraging_uren ? `${m.vertraging_uren} uur later` : ''].filter(Boolean).join(' · '))}${m.bron === 'demo' ? ' · voorbeeld' : ''}</small>${m.tekst ? `<p class="small muted">${h(m.tekst)}</p>` : ''}</div>
            <button type="button" class="btn btn-sm btn-ghost" data-act="melding-weg" data-id="${m.id}">Opgelost</button></li>`).join('') || '<li class="empty">Geen open meldingen.</li>'}</ul></section>
        <section class="panel"><header><h2>Stormen</h2><span class="sub">Atlantische Oceaan en oostelijke Stille Oceaan</span></header><div class="body">
          ${v.bronnen.storm.status !== 'ok' && v.bronnen.storm.status !== 'niet nodig' ? `<p class="small faint">${icon('info')} Het orkaancentrum is nu niet bereikbaar. Op de echte site kijkt de desk elk uur.</p>`
            : v.stormen.length ? `<ul class="vm">${v.stormen.map(s => `<li class="t-${ERN[s.ernst]}"><div><b>${h(s.soort)} ${h(s.naam)}</b><small>${s.dichtst ? `${s.dichtst.km} km van ${h(s.dichtst.stad)}` : ''}${s.kn ? ` · ${s.kn} knopen` : ''}</small></div></li>`).join('')}</ul>`
              : '<p class="small">Geen tropische storm actief.</p>'}</div></section>
        <section class="panel"><header><h2>Drukke vrachtweken</h2><span class="sub">de komende tien weken</span></header><div class="body">
          ${v.kalender.length ? `<ul class="vm">${v.kalender.map(k => `<li class="t-wait"><div><b>${h(dShort(k.van))}${k.tot ? ` tot ${h(dShort(k.tot))}` : ''}</b><p class="small muted">${h(k.tekst)}</p></div></li>`).join('')}</ul>` : '<p class="small">Geen feestdagen of bloemenpieken in zicht.</p>'}</div></section>
        <section class="panel"><header><h2>Op tijd</h2><span class="sub">laatste dertien zendingen per leverancier</span></header>
          <table class="tb"><tbody>${v.leveranciers.map(l => `<tr><td><a href="#/leverancier/${l.id}">${h(l.naam)}</a><small class="faint" style="display:block">${h(l.route.join(' → '))}</small></td>
            <td class="r">${l.n ? (l.laat ? `<span class="chip ${l.laat >= 3 ? 'wait' : 'dash'}">${l.laat} van ${l.n} te laat</span>` : `<span class="chip ok">${icon('check')}${l.n} van ${l.n} op tijd</span>`) : '<span class="faint">–</span>'}</td></tr>`).join('')}</tbody></table></section>
      </aside>
    </div>`;
}

export const actions = {
  'v-melding': (el, ctx) => noticeDialog(ctx, { plekken: Object.fromEntries((V?.plekken || []).map(p => [p.code, { stad: p.stad }])) }),
  'melding-weg': async (el, ctx) => { await api(`/week/meldingen/${el.dataset.id}/opgelost`, { method: 'POST', body: {} }); toast('Melding op opgelost gezet.'); ctx.refresh(); },
};
