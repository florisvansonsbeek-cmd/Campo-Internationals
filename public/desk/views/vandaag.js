// Vandaag: where every order is right now, and at what time it arrives where.
import { api, h, icon, fTime, fNum, dayWord, rel, plural, stapChip, waLink, toast, fLong, dialog, field } from '../core.js';

const STATE_IN = { binnen: 'Binnen', onderweg: 'Onderweg', laden: 'Wordt geladen', gepland: 'Gepland' };
const STATE_OUT = { afgeleverd: 'Afgeleverd', onderweg: 'Onderweg', wacht: 'Wacht op goederen', klaar: 'Klaar om te laden' };

function lateTag(delay, state, silent) {
  if (silent) return '<span class="late bad">Niets gehoord</span>';
  if (state === 'binnen' || state === 'afgeleverd') return delay > 15 ? `<span class="late">${delay} min later</span>` : delay < -5 ? `<span class="late ok">${-delay} min eerder</span>` : '<span class="late ok">Op tijd</span>';
  if (delay >= 15) return `<span class="late${delay >= 45 ? ' bad' : ''}">+${delay} min</span>`;
  return '';
}

function stop(time, place, { end = false, was = null, day = null } = {}) {
  const dw = day && dayWord(day) !== 'vandaag' ? dayWord(day) : '';
  return `<div class="stop${end ? ' end' : ''}">${was ? `<span class="tm was">${fTime(was)}</span>` : ''}<span class="tm t">${fTime(time)}</span><span class="pl" title="${h(place)}">${h(place)}</span>${dw ? `<span class="dy">${h(dw)}</span>` : ''}</div>`;
}

function track(x, from, to, depTime, arrTime, { planned = null, note = '' } = {}) {
  const p = Math.round((x.progress || 0) * 1000) / 10;
  const moving = x.state === 'onderweg';
  const done = x.state === 'binnen' || x.state === 'afgeleverd';
  const wasShown = planned && Math.abs(x.delay) >= 10 && !done ? planned : null;
  return `<div class="track">
    ${stop(depTime, from, { day: depTime })}
    <div class="line" role="img" aria-label="${h(`${from} naar ${to}: ${note || ''}`)}">
      <span class="a ${done || moving ? 'on' : ''}"></span>
      <span class="done" style="width:calc(${done ? 100 : p}% - 12px)"></span>
      ${moving ? `<span class="truck" style="left:${Math.max(6, Math.min(94, p))}%">${icon('truck')}</span>` : ''}
      <span class="b ${done ? 'on' : ''}"></span>
      ${note ? `<span class="note">${h(note)}</span>` : ''}
    </div>
    ${stop(arrTime, to, { end: true, was: wasShown, day: arrTime })}
  </div>`;
}

function inboundRow(z) {
  const cls = z.state === 'binnen' ? 'is-done' : z.silentLate || z.delay >= 45 ? 'is-late is-bad' : z.delay >= 15 ? 'is-late' : z.state === 'gepland' ? 'is-plan' : '';
  const klanten = [...new Map(z.regels.flatMap(r => r.naar).map(n => [n.klant_id, n.klant])).values()];
  const note = z.state === 'onderweg' ? `onderweg, ${rel(z.eta).replace('over ', 'nog ')}` : z.state === 'laden' ? 'wordt geladen' : z.state === 'gepland' ? `vertrekt ${rel(z.vertrek)}` : '';
  return `<li class="route ${cls}">
    <div class="who">
      <h3>${z.factuur_id ? `<a href="#/factuur/${z.factuur_id}">${h(z.kweker)}</a>` : h(z.kweker)}</h3>
      <p>${h(z.van || '')}${z.nummer ? ` · ${h(z.nummer)}` : ''}${z.karren ? ` · ${String(z.karren).replace('.', ',')} ${Number(z.karren) === 1 ? 'kar' : 'karren'}` : ''}</p>
      <p><span class="chip ${z.state === 'binnen' ? 'ok' : z.silentLate || z.delay >= 15 ? 'wait' : 'info'}">${STATE_IN[z.state]}</span> ${lateTag(z.delay, z.state, z.silentLate)}</p>
    </div>
    ${track(z, z.van || z.kweker, 'Nootdorp', z.state === 'gepland' ? z.vertrek_gepland || z.vertrek : z.vertrek, z.eta, { planned: z.gepland, note })}
    <div class="what">
      ${z.stap ? stapChip(z.stap) : ''}
      ${z.rest > 0 ? `<span class="chip brass">${fNum(z.rest)} over</span>` : ''}
      <span class="chip">${klanten.length ? plural(klanten.length, 'klant', 'klanten') : 'nog niet verdeeld'}</span>
    </div>
    <details>
      <summary>${plural(z.regels.length, 'regel', 'regels')}, ${fNum(z.regels.reduce((s, r) => s + r.aantal, 0))} stuks: wie krijgt wat</summary>
      <div class="cargo">
        <table><thead><tr><th>Plant</th><th class="r">Stuks</th><th>Naar</th></tr></thead><tbody>
        ${z.regels.map(r => `<tr><td>${h(r.plant || 'Onbekend')} <span class="faint">${h(r.maat || '')}</span></td><td class="num">${fNum(r.aantal)}</td><td>${r.naar.length ? r.naar.map(n => `${h(n.klant)} <span class="faint">${fNum(n.aantal)}${n.status === 'voorstel' ? ', voorstel' : ''}${n.soort === 'aanbod' ? ', aanbod' : ''}</span>`).join('<br>') : '<span class="faint">nog niet verdeeld</span>'}</td></tr>`).join('')}
        </tbody></table>
        <div>
          <ul class="feed">${z.gebeurtenissen.length ? z.gebeurtenissen.slice().reverse().map(e => `<li><time>${fTime(e.tijd)}</time><span>${h(e.tekst || e.soort)}<br><span class="src">${h({ whatsapp: 'WhatsApp van de kweker', mail: 'Mail', jan: 'Door Jan', vervoerder: 'Vervoerder', ai: 'Desk', demo: 'Demo' }[e.bron] || e.bron)}</span></span></li>`).join('') : '<li><time></time><span class="faint">Nog niets gehoord van deze wagen.</span></li>'}</ul>
          <p style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            ${z.state !== 'binnen' ? `<button class="btn btn-sm btn-leaf" data-act="z-binnen" data-id="${z.id}">${icon('check')}Is binnen</button><button class="btn btn-sm btn-line" data-act="z-eta" data-id="${z.id}">Nieuwe tijd</button>` : ''}
            ${z.whatsapp ? `<a class="btn btn-sm btn-line" href="${waLink(z.whatsapp, `Hoi, hoe laat zijn jullie in Nootdorp? Gr Jan`)}" target="_blank" rel="noopener">${icon('chat')}Vraag tijd</a>` : ''}
            ${z.factuur_id ? `<a class="btn btn-sm btn-ghost" href="#/factuur/${z.factuur_id}">Open bestelling</a>` : ''}
          </p>
        </div>
      </div>
    </details>
  </li>`;
}

function outChip(l) {
  if (l.state === 'afgeleverd') return `<span class="chip ok">${STATE_OUT.afgeleverd}</span>`;
  if (l.state === 'onderweg') return `<span class="chip info">${STATE_OUT.onderweg}</span>`;
  if (l.krap) return '<span class="chip bad">Vertrek in gevaar</span>';
  const soon = (new Date(l.vertrek_gepland) - new Date()) / 6e4 < 60;
  if (l.state === 'wacht') return soon ? '<span class="chip wait">Wacht op goederen</span>' : '<span class="chip">Goederen komen nog</span>';
  return '<span class="chip info">Klaar om te laden</span>';
}

function outboundRow(l) {
  const late = l.delay >= 15 && l.state !== 'afgeleverd';
  const cls = l.state === 'afgeleverd' ? 'is-done' : l.krap || late ? 'is-late' : l.state === 'klaar' || l.state === 'wacht' ? 'is-plan' : '';
  const note = l.state === 'wacht' ? `goederen van ${l.wacht_op.map(w => w.kweker).join(', ')}` : l.state === 'onderweg' ? `onderweg, ${rel(l.eta).replace('over ', 'nog ')}` : l.state === 'klaar' ? `vertrekt ${rel(l.vertrek)}` : '';
  return `<li class="route ${cls}">
    <div class="who">
      <h3><a href="#/klant/${l.klant_id}">${h(l.klant)}</a></h3>
      <p>${h(l.plaats)}, ${h(l.land)}${l.order ? ` · ${h(l.order)}` : ''}${l.levervenster ? ` · ${h(l.levervenster)}` : ''}</p>
      <p>${outChip(l)} ${l.krap ? `<span class="late">vertrek ${fTime(l.vertrek)} in plaats van ${fTime(l.vertrek_gepland)}</span>` : lateTag(l.delay, l.state, false)}</p>
    </div>
    ${track(l, 'Nootdorp', l.plaats, l.vertrek, l.eta, { planned: l.aankomst_gepland, note })}
    <div class="what">
      <span class="chip">${plural(l.goederen.length, 'soort', 'soorten')}</span>
      ${l.krap || late ? `<button class="btn btn-sm btn-line" data-act="l-vertraging" data-id="${l.id}" data-eta="${h(l.eta)}">${icon('chat')}Meld vertraging</button>` : ''}
    </div>
    <details>
      <summary>Wat gaat er mee, en van welke kweker</summary>
      <div class="cargo">
        <table><thead><tr><th>Plant</th><th class="r">Stuks</th><th>Kweker</th></tr></thead><tbody>
          ${l.goederen.map(g => `<tr><td>${h(g.plant)} <span class="faint">${h(g.maat)}</span></td><td class="num">${fNum(g.aantal)}</td><td>${h(g.kweker || '–')}</td></tr>`).join('') || '<tr><td colspan="3" class="faint">Nog niets toegewezen.</td></tr>'}
        </tbody></table>
        <div>
          ${l.wacht_op.length ? `<p class="small" style="margin-bottom:8px"><b>Wacht op:</b> ${l.wacht_op.map(w => `${h(w.kweker)} (verwacht ${fTime(w.eta)}${w.delay >= 15 ? `, +${w.delay} min` : ''})`).join(', ')}</p>` : ''}
          <ul class="feed">${l.gebeurtenissen.slice().reverse().map(e => `<li><time>${fTime(e.tijd)}</time><span>${h(e.tekst || e.soort)}</span></li>`).join('')}</ul>
          <p style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            ${l.state === 'klaar' || l.state === 'wacht' ? `<button class="btn btn-sm btn-leaf" data-act="l-vertrokken" data-id="${l.id}">Vertrokken</button>` : ''}
            ${l.state === 'onderweg' ? `<button class="btn btn-sm btn-leaf" data-act="l-afgeleverd" data-id="${l.id}">${icon('check')}Afgeleverd</button>` : ''}
          </p>
        </div>
      </div>
    </details>
  </li>`;
}

function todoList(items) {
  if (!items.length) return '<p class="empty">Niets dat nu om je vraagt. Alles loopt.</p>';
  return `<ul class="todo">${items.slice(0, 9).map(a => `<li class="${a.toon === 'bad' ? 'bad' : ''}">
      ${icon(a.toon === 'bad' ? 'warn' : a.toon === 'wait' ? 'clock' : 'info', `ic ${a.toon}`)}
      <div><b>${h(a.titel)}</b><p>${h(a.tekst)}</p></div>
      <div class="acts">${a.link ? `<a class="btn btn-sm ${a.toon === 'bad' ? 'btn-bad' : 'btn-line'}" href="${a.link}">${h(a.knop || 'Openen')}</a>` : ''}${a.bellen ? `<a class="btn btn-sm btn-ghost" href="${waLink(a.bellen, 'Hoi, hoe laat zijn jullie in Nootdorp? Gr Jan')}" target="_blank" rel="noopener">${icon('chat')}App kweker</a>` : ''}</div>
    </li>`).join('')}${items.length > 9 ? `<li><span></span><a class="lnk" href="#/workflow">Nog ${items.length - 9} in de workflow</a></li>` : ''}</ul>`;
}

export async function render() {
  const d = await api('/vandaag');
  const now = new Date(d.nu);
  const today = d.zendingen.filter(z => dayWord(z.gepland) === 'vandaag' || z.state === 'onderweg');
  const early = d.zendingen.filter(z => !today.includes(z));
  const inOrder = today.slice().sort((a, b) => ({ onderweg: 0, laden: 1, gepland: 2, binnen: 3 }[a.state] - { onderweg: 0, laden: 1, gepland: 2, binnen: 3 }[b.state]) || new Date(a.eta) - new Date(b.eta));
  const out = d.leveringen.slice().sort((a, b) => ({ wacht: 0, klaar: 1, onderweg: 2, afgeleverd: 3 }[a.state] - { wacht: 0, klaar: 1, onderweg: 2, afgeleverd: 3 }[b.state]) || new Date(a.vertrek) - new Date(b.vertrek));
  const k = d.kpi;
  return `<div class="page">
    <div class="ph"><div><h1>Vandaag</h1><p>${h(fLong(now))}: waar elke bestelling nu is, en hoe laat hij waar aankomt. Ververst elke minuut.</p></div>
      <div class="acts"><a class="btn btn-line" href="#/inbox">${icon('upload')}Factuur toevoegen</a><a class="btn btn-leaf" href="#/workflow">${icon('flow')}Naar de workflow</a></div></div>
    <div class="kpis">
      <a class="kpi" href="#in"><span>Onderweg naar Campo</span><b class="t">${k.onderweg}</b><em>${k.binnen} van ${k.vandaag} vandaag al binnen</em></a>
      <a class="kpi${k.achter ? ' bad' : ''}" href="#in"><span>Loopt achter</span><b class="t">${k.achter}</b><em>${k.achter ? 'kweker later dan gepland' : 'alles op schema'}</em></a>
      <a class="kpi" href="#uit"><span>Naar klanten onderweg</span><b class="t">${k.uit}</b><em>${k.afgeleverd} van ${k.leveringen} afgeleverd</em></a>
      <a class="kpi${k.krap ? ' bad' : ''}" href="#uit"><span>Levering in gevaar</span><b class="t">${k.krap}</b><em>${k.krap ? 'wacht op een late kweker' : 'geen wagen hoeft te wachten'}</em></a>
    </div>
    <div class="grid2">
      <div class="stack">
        <section class="panel" id="in" aria-labelledby="h-in"><header><h2 id="h-in">Binnenkomend bij Campo</h2><span class="sub">Van de kweker naar Nootdorp</span></header>
          ${inOrder.length ? `<ul class="routes">${inOrder.map(inboundRow).join('')}</ul>` : '<p class="empty">Vandaag komt er niets binnen.</p>'}
        </section>
        ${early.length ? `<section class="panel" aria-labelledby="h-early"><header><h2 id="h-early">Morgenvroeg</h2><span class="sub">Komt binnen vóór 08:00</span></header><ul class="routes">${early.map(inboundRow).join('')}</ul></section>` : ''}
        <section class="panel" id="uit" aria-labelledby="h-uit"><header><h2 id="h-uit">Uitgaand naar klanten</h2><span class="sub">Van Nootdorp naar de klant</span></header>
          ${out.length ? `<ul class="routes">${out.map(outboundRow).join('')}</ul>` : '<p class="empty">Vandaag gaat er niets de deur uit.</p>'}
        </section>
      </div>
      <aside class="stack">
        <section class="panel" aria-labelledby="h-todo"><header><h2 id="h-todo">Wat nu om jou vraagt</h2><span class="sub">Belangrijkste bovenaan</span></header>${todoList(d.aandacht)}</section>
        <section class="panel" aria-labelledby="h-wf"><header><h2 id="h-wf">In de workflow</h2><a class="lnk small" href="#/workflow">Open</a></header>
          <div class="body" style="display:grid;gap:8px">
            ${['nakijken', 'koppelen', 'rest', 'informeren'].map(s => `<a href="#/workflow" style="display:flex;justify-content:space-between;align-items:center;text-decoration:none;color:var(--ink)">${stapChip(s)}<b class="num">${(d.stappen[s] && d.stappen[s].n) || 0}</b></a>`).join('')}
            <a href="#/inbox" style="display:flex;justify-content:space-between;align-items:center;text-decoration:none;color:var(--ink)">${stapChip('binnen')}<b class="num">${d.inbox.nieuw}</b></a>
          </div>
        </section>
      </aside>
    </div>
  </div>`;
}

export const actions = {
  async 'z-binnen'(el, ctx) { await api(`/zendingen/${el.dataset.id}/gebeurtenis`, { method: 'POST', body: { soort: 'aangekomen' } }); toast('Gemeld: binnen.'); ctx.refresh(); },
  async 'z-eta'(el, ctx) {
    dialog({ title: 'Nieuwe verwachte tijd', ok: 'Opslaan', body: `${field('eta', 'Verwacht in Nootdorp om', '', { type: 'time' })}${field('tekst', 'Waarom (optioneel)', '', { hint: 'Bijvoorbeeld: file op de A4, later geladen' })}`,
      onOk: async v => { await api(`/zendingen/${el.dataset.id}/gebeurtenis`, { method: 'POST', body: { soort: 'eta', eta: v.eta, tekst: v.tekst ? `${v.tekst} (nieuwe tijd ${v.eta})` : `Nieuwe tijd ${v.eta}` } }); toast('Tijd bijgewerkt.'); ctx.refresh(); } });
  },
  async 'l-vertrokken'(el, ctx) { await api(`/leveringen/${el.dataset.id}/gebeurtenis`, { method: 'POST', body: { soort: 'vertrokken' } }); toast('Gemeld: vertrokken.'); ctx.refresh(); },
  async 'l-afgeleverd'(el, ctx) { await api(`/leveringen/${el.dataset.id}/gebeurtenis`, { method: 'POST', body: { soort: 'afgeleverd' } }); toast('Gemeld: afgeleverd.'); ctx.refresh(); },
  async 'l-vertraging'(el, ctx) {
    const m = await api(`/leveringen/${el.dataset.id}/vertraging-bericht`, { method: 'POST', body: { eta: el.dataset.eta } });
    ctx.showMessage(m);
  },
};
export const refreshEvery = 60000;
