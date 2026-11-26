// One order in its own tab: the route with every time on it, each customer it goes to,
// what is on the truck, what was heard about it, and who to call.
import { api, h, icon, fTime, fNum, fEur, fPrice, dayWord, plural, waLink, COUNTRY, toast, dialog, field } from '../core.js';
import { laneHtml, when, dur, cap, TONE, stageText } from '../lane.js';

let shown = null;
const tel = v => `tel:${String(v).replace(/\s/g, '')}`;
const SRC = { whatsapp: 'WhatsApp', mail: 'Mail', jan: 'Jan', vervoerder: 'Vervoerder', ai: 'Desk', demo: 'Demo' };
const EV = { geladen: 'Geladen', vertrokken: 'Vertrokken', eta: 'Nieuwe tijd', aangekomen: 'Aangekomen', vertraging: 'Vertraging', uitgeleverd: 'Uitgeleverd', afgeleverd: 'Afgeleverd', opmerking: 'Opmerking' };

// every stop on the route, in time order; what already happened is filled in
function routeSteps(b) {
  const z = b.in, gone = z.state === 'onderweg' || z.state === 'binnen';
  const s = [
    { t: z.vertrek, done: gone, txt: `${gone ? 'Vertrokken' : 'Vertrekt'} bij ${b.kweker}${b.plaats ? `, ${b.plaats}` : ''}`, sub: z.state === 'laden' ? 'wordt nu geladen' : null },
    { t: z.eta, done: z.state === 'binnen', txt: `${z.state === 'binnen' ? 'Binnen' : 'Aankomst'} in Nootdorp`, sub: z.delay >= 10 ? `${dur(z.delay)} later dan gepland (${fTime(z.gepland)})` : z.state === 'binnen' ? null : 'verwacht', toon: z.toon },
  ];
  for (const k of b.klanten) {
    const left = k.state === 'onderweg' || k.state === 'afgeleverd';
    s.push({ t: k.vertrek, done: left, txt: `Wagen naar ${k.klant} ${left ? 'vertrokken' : 'vertrekt'}`, sub: [k.vervoerder, !left && k.uitstel >= 10 ? `gepland ${fTime(k.vertrek_gepland)}` : null].filter(Boolean).join(', ') || null });
    s.push({ t: k.eta, done: k.state === 'afgeleverd', txt: `${k.state === 'afgeleverd' ? 'Afgeleverd bij' : 'Aankomst bij'} ${k.klant}, ${k.plaats}`, sub: k.delay >= 10 ? `${dur(k.delay)} later dan gepland (${fTime(k.gepland)})` : k.state === 'afgeleverd' ? null : 'verwacht', toon: k.toon });
  }
  return s.sort((a, c) => new Date(a.t) - new Date(c.t));
}
function routePanel(b) {
  const steps = routeSteps(b), now = Date.now();
  let marked = false;
  const li = st => {
    let pre = '';
    if (!marked && new Date(st.t) > now) { marked = true; pre = `<li class="now"><time>${fTime(new Date())}</time><span>Nu</span></li>`; }
    return `${pre}<li class="${st.done ? 'done' : ''}${st.toon && st.toon !== 'ok' && st.toon !== 'done' ? ` t-${st.toon}` : ''}"><time>${h(when(st.t))}</time><span>${h(st.txt)}${st.sub ? `<em>${h(st.sub)}</em>` : ''}</span></li>`;
  };
  return `<section class="panel" aria-labelledby="h-route"><header><h2 id="h-route">De route</h2><span class="sub">Waarschijnlijk ${b.voortgang}% onderweg</span></header>
    <ol class="steps-v">${steps.map(li).join('')}${marked ? '' : `<li class="now"><time>${fTime(new Date())}</time><span>Nu</span></li>`}</ol></section>`;
}

function custCard(k, focus) {
  const gone = k.state === 'onderweg' || k.state === 'afgeleverd';
  return `<article class="ocust t-${k.toon}${focus === k.levering_id ? ' focus' : ''}" id="lev-${k.levering_id}">
    <header><h3><a href="#/klant/${k.klant_id}">${h(k.klant)}</a></h3><span class="st t-${k.toon}"><i aria-hidden="true"></i>${TONE[k.toon]}</span></header>
    <p class="small"><a class="lnk" href="#/wagen/${k.levering_id}" target="_blank" rel="noopener">${icon('truck')}Open de wagen naar ${h(k.klant)}</a></p>
    <p class="sub">${h(k.plaats || '')}${k.land ? `, ${h(COUNTRY[k.land] || k.land)}` : ''}${k.order ? ` · order ${h(k.order)}` : ''}${k.levervenster ? ` · levert ${h(k.levervenster)}` : ''}</p>
    <ul class="goods">${k.planten.map(p => `<li><b class="num">${fNum(p.aantal)}</b> × ${h(p.naam)} <span class="faint">${h(p.maat)}</span>${p.voorstel ? ' <span class="chip info">voorstel</span>' : ''}</li>`).join('')}</ul>
    <dl class="times">
      <div><dt>Wagen</dt><dd>${h(k.vervoerder || 'Nog geen vervoerder')}, ${gone ? 'vertrok' : 'vertrekt'} ${h(when(k.vertrek))}${!gone && k.uitstel >= 10 ? ` <span class="lt t-wait">gepland ${fTime(k.vertrek_gepland)}</span>` : ''}</dd></div>
      <div><dt>Aankomst</dt><dd>${k.state === 'afgeleverd' ? '' : 'waarschijnlijk '}${h(when(k.eta))}${k.delay >= 10 ? ` <span class="lt t-${k.toon === 'done' ? 'wait' : k.toon}">${dur(k.delay)} later dan gepland (${fTime(k.gepland)})</span>` : ''}</dd></div>
    </dl>
    ${k.reden ? `<p class="why t-${k.toon}">${icon(k.toon === 'bad' ? 'warn' : 'clock')}<span>${h(cap(k.reden))}.</span></p>` : ''}
    ${k.ook_van.length ? `<p class="small muted">Ook in deze wagen: ${k.ook_van.map(o => `${h(o.kweker)} (${o.state === 'binnen' ? 'binnen' : `komt ${h(when(o.eta))}`})`).join(', ')}.</p>` : ''}
    ${k.telefoon || k.whatsapp ? `<p class="acts">${k.telefoon || k.whatsapp ? `<a class="btn btn-sm btn-line" href="${tel(k.telefoon || k.whatsapp)}">${icon('phone')}Bel${k.contact ? ` ${h(k.contact.split(' ')[0])}` : ''}</a>` : ''}${k.whatsapp ? `<a class="btn btn-sm btn-ghost" href="${waLink(k.whatsapp, '')}" target="_blank" rel="noopener">${icon('chat')}App</a>` : ''}</p>` : ''}
  </article>`;
}

function linesPanel(d) {
  if (!d.regels.length) return '';
  return `<section class="panel" aria-labelledby="h-lines"><header><h2 id="h-lines">Wat erin zit</h2><span class="sub">${plural(d.regels.length, 'soort', 'soorten')}, ${fNum(d.regels.reduce((s, r) => s + r.aantal, 0))} stuks</span></header>
    <div class="tbwrap"><table class="tb"><thead><tr><th>Plant</th><th class="r">Stuks</th><th class="r">Inkoop</th><th>Naar</th><th class="r">Vrij</th></tr></thead><tbody>
    ${d.regels.map(r => `<tr><td>${r.plant_id ? `<a href="#/plant/${r.plant_id}"><b>${h(r.naam)}</b></a>` : `<b>${h(r.omschrijving)}</b>`} <span class="faint">${h(r.maat || '')}</span></td>
      <td class="r num">${fNum(r.aantal)}</td><td class="r num">${fPrice(r.prijs)}</td>
      <td>${r.naar.length ? `<div class="allocs">${r.naar.map(n => `<span class="chip${n.status === 'voorstel' ? ' info' : ''}">${h(n.klant)} ${fNum(n.aantal)}</span>`).join('')}</div>` : '<span class="faint">Nog niemand</span>'}</td>
      <td class="r num${r.vrij ? ' freenum' : ' faint'}">${fNum(r.vrij)}</td></tr>`).join('')}
    </tbody></table></div></section>`;
}

function eventsPanel(d) {
  const ev = d.gebeurtenissen;
  return `<section class="panel" aria-labelledby="h-ev"><header><h2 id="h-ev">Wat er gebeurde</h2></header>
    ${ev.length ? `<ul class="feed body">${ev.slice(0, 14).map(e => `<li><time>${fTime(e.tijd)}</time><span>${h(e.tekst || EV[e.soort] || e.soort)}<br><span class="src">${h([e.klant ? `wagen naar ${e.klant}` : 'wagen van de kweker', SRC[e.bron] || e.bron, dayWord(e.tijd) !== 'vandaag' ? dayWord(e.tijd) : ''].filter(Boolean).join(' · '))}</span></span></li>`).join('')}</ul>`
      : '<p class="empty">Nog niets gehoord over deze wagens.</p>'}</section>`;
}

function papersPanel(d) {
  const f = d.factuur, a = d.aanbod, k = d.kweker;
  const items = [
    f && f.bestand_id ? `<li><a href="/api/bestanden/${f.bestand_id}" target="_blank" rel="noopener">${icon('file')}Factuur ${h(f.nummer)} (pdf)</a></li>` : '',
    f ? `<li><a href="#/factuur/${f.id}">${icon('out')}Factuur in de desk: wie krijgt wat${f.totaal ? `, ${fEur(f.totaal)}` : ''}</a></li>` : '',
    a ? `<li><a href="#/aanbod/${a.id}">${icon('basket')}Het aanbod${a.bestelnummer ? ` en bestelling ${h(a.bestelnummer)}` : ''}</a></li>` : '',
    `<li><a href="#/kweker/${k.id}">${icon('grower')}${h(k.naam)}: stiptheid en kwaliteit</a></li>`,
  ].filter(Boolean);
  return `<section class="panel" aria-labelledby="h-pap"><header><h2 id="h-pap">Papieren en meer</h2></header><ul class="body plainlist links-l">${items.join('')}</ul></section>`;
}

export async function render(params, query) {
  const d = await api(`/bestelling/${params.id}`);
  const b = d.baan, k = d.kweker;
  if (!b) throw new Error('Deze bestelling bestaat niet (meer).');
  const focus = Number(query.get('klant')) || null;
  shown = { id: params.id, focus, done: shown && shown.id === params.id ? shown.done : false };
  const sub = [b.nummer, `${fNum(b.stuks)} stuks`, b.soorten ? plural(b.soorten, 'soort', 'soorten') : null, b.vervoerder || k.vervoer].filter(Boolean).join(' · ');
  const phone = k.telefoon || k.whatsapp;
  return `<div class="page order-page">
    <a class="back" href="#/workflow">${icon('back')}Workflow</a>
    <div class="ph"><div><h1>${h(b.kweker)} naar ${plural(b.klanten.length, 'klant', 'klanten')}</h1><p>${h(sub)}</p></div>
      <div class="acts">${b.in.state !== 'binnen' ? `<button class="btn btn-leaf" data-act="z-binnen" data-id="${b.id}">${icon('check')}Is binnen</button><button class="btn btn-line" data-act="z-eta" data-id="${b.id}">Nieuwe tijd</button>` : ''}${phone ? `<a class="btn btn-line" href="${tel(phone)}">${icon('phone')}Bel ${h(k.contact ? k.contact.split(' ')[0] : 'de kweker')}</a>` : ''}${k.whatsapp ? `<a class="btn btn-ghost" href="${waLink(k.whatsapp, b.in.state === 'gepland' || b.in.state === 'laden' ? 'Hoi, kunnen jullie op de wagen naar Nootdorp nog iets bijladen? Groet, Jan' : 'Hoi, hoe laat zijn jullie in Nootdorp? Gr Jan')}" target="_blank" rel="noopener">${icon('chat')}${b.in.state === 'gepland' || b.in.state === 'laden' ? 'Kan er nog iets bij?' : 'Vraag de tijd'}</a>` : ''}</div></div>
    <div class="ostatus t-${b.toon}"><span class="st t-${b.toon}"><i aria-hidden="true"></i>${TONE[b.toon]}</span><p><b>${h(stageText(b))}.</b>${b.reden ? ` ${h(cap(b.reden))}.` : b.toon === 'ok' ? ' Alles komt waarschijnlijk op tijd aan.' : ''}</p></div>
    <section class="panel lane-solo" aria-label="De route in één beeld">${laneHtml(b, { link: false })}</section>
    <div class="grid2">
      <div class="stack">
        <section class="panel" aria-labelledby="h-k"><header><h2 id="h-k">Naar de klanten</h2><span class="sub">${b.klanten.length ? `${plural(b.klanten.length, 'wagen', 'wagens')}${b.vrij ? `, ${fNum(b.vrij)} stuks vrij voor de loods` : ''}` : ''}</span></header>
          ${b.klanten.length ? `<div class="ocusts">${b.klanten.map(x => custCard(x, focus)).join('')}</div>` : `<p class="empty">Deze wagen gaat helemaal naar de loods: ${fNum(b.vrij)} stuks vrij om te verkopen.</p>`}</section>
        ${linesPanel(d)}
      </div>
      <aside class="stack">${routePanel(b)}${eventsPanel(d)}${papersPanel(d)}</aside>
    </div>
  </div>`;
}

// opened for one customer: bring that card into view once
export function mount() {
  if (!shown || shown.done || !shown.focus) return;
  shown.done = true;
  const el = document.getElementById(`lev-${shown.focus}`);
  if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
}
export const actions = {
  async 'z-binnen'(el, ctx) { await api(`/zendingen/${el.dataset.id}/gebeurtenis`, { method: 'POST', body: { soort: 'aangekomen' } }); toast('Gemeld: binnen.'); ctx.refresh(); },
  'z-eta'(el, ctx) {
    dialog({ title: 'Nieuwe verwachte tijd', ok: 'Opslaan', body: `${field('eta', 'Verwacht in Nootdorp om', '', { type: 'time' })}${field('tekst', 'Waarom (optioneel)', '', { hint: 'Bijvoorbeeld: file op de A4, later geladen' })}`,
      onOk: async v => { await api(`/zendingen/${el.dataset.id}/gebeurtenis`, { method: 'POST', body: { soort: 'eta', eta: v.eta, tekst: v.tekst ? `${v.tekst} (nieuwe tijd ${v.eta})` : `Nieuwe tijd ${v.eta}` } }); toast('Tijd bijgewerkt.'); ctx.refresh(); } });
  },
};
export const refreshEvery = 60000;
