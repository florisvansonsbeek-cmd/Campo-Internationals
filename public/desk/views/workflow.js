// The workflow: every basket from a grower, from the offer to the loods, in four steps.
import { api, h, icon, fTime, fNum, fEur, dayWord, rel, plural, KETEN, risicoChip, kanaalIcon, kanaalNaam, toast, dialog, field } from '../core.js';

const ORDER = ['aanbod', 'bellen', 'besteld', 'loods'];
const when = v => `${dayWord(v) === 'vandaag' ? '' : dayWord(v) + ' '}${fTime(v)}`;

function linked(c) {
  const pct = Math.max(0, Math.min(100, c.gekoppeld_pct || 0));
  return `<div class="meter" role="img" aria-label="${pct}% heeft een klant"><i style="width:${pct}%"></i></div><p class="meter-l"><b>${pct}%</b> heeft een klant</p>`;
}
function people(list, max = 3) {
  if (!list.length) return '';
  const show = list.slice(0, max);
  const mark = k => (k.bron === 'order' ? `${icon('check')}` : k.status === 'akkoord' ? icon('check') : k.status === 'nee' ? icon('x') : '');
  return `<div class="who">${show.map(k => `<span class="chip${k.status === 'akkoord' || k.bron === 'order' ? ' ok' : k.status === 'nee' ? ' dash' : ''}" title="${h(k.bron === 'order' ? 'Heeft al besteld' : k.status === 'akkoord' ? 'Akkoord' : k.status === 'nee' ? 'Zei nee' : 'Nog bellen')}">${mark(k)}${h(k.naam)}</span>`).join('')}${list.length > max ? `<span class="chip">+${list.length - max}</span>` : ''}</div>`;
}
function next(c) {
  if (c.stap === 'verlopen') return `<p class="c-next bad">${icon('clock')}Verlopen om ${fTime(c.geldig_tot)}. Bel de kweker of het nog kan.</p>`;
  if (c.onbekend) return `<p class="c-next wait">${icon('warn')}${plural(c.onbekend, 'regel', 'regels')} niet herkend: nakijken</p>`;
  if (c.bellen) return `<p class="c-next">${icon('phone')}${c.akkoord ? `${c.akkoord} akkoord, nog ` : 'Bel '}${plural(c.bellen, 'klant', 'klanten')}</p>`;
  if (c.akkoord || c.al_besteld) return `<p class="c-next go">${icon('send')}Plaats de bestelling</p>`;
  return `<p class="c-next">${icon('info')}Kies klanten of wijs af</p>`;
}

function offerCard(c) {
  const soon = c.geldig_tot && c.stap !== 'verlopen' && (new Date(c.geldig_tot) - new Date()) / 6e4 <= 120;
  return `<a class="card offer${c.stap === 'verlopen' ? ' gone' : ''}" href="#/aanbod/${c.id}">
    <div class="c-head"><h3>${h(c.kweker)}</h3>${c.stap === 'verlopen' ? '<span class="chip dash">Verlopen</span>' : risicoChip(c.risico)}</div>
    <div class="meta"><span>${kanaalIcon(c.kanaal || 'upload')}${kanaalNaam(c.kanaal || 'upload')} ${fTime(c.ontvangen)}</span>${c.geldig_tot && c.stap !== 'verlopen' ? `<span class="${soon ? 'soon' : ''}">${icon('clock')}tot ${when(c.geldig_tot)}</span>` : ''}${c.levering ? `<span>${icon('truck')}${dayWord(c.levering)}</span>` : ''}</div>
    <p class="plants">${h(c.planten.join(', '))}</p>
    ${linked(c)}
    <div class="nums"><span>${fNum(c.stuks)} stuks</span><span>marge <b>${fEur(c.marge)}</b>${c.marge_pct != null ? ` · ${c.marge_pct}%` : ''}</span></div>
    ${people(c.klanten)}
    ${next(c)}
  </a>`;
}

function orderCard(c) {
  const z = c.zending || {};
  const sent = c.concepten.bestelling === 'verstuurd';
  return `<a class="card offer" href="#/aanbod/${c.id}">
    <div class="c-head"><h3>${h(c.kweker)}</h3><span class="faint small">${h(c.bestelnummer || '')}</span></div>
    <p class="eta">${icon('truck')}${z.vertrokken_om ? 'Onderweg, ' : ''}komt ${when(z.verwacht || z.gepland)}</p>
    <div class="nums"><span>${plural(c.regels, 'soort', 'soorten')} · ${fNum(c.stuks)} stuks</span><span>${plural(c.klanten.filter(k => k.status !== 'nee').length, 'klant', 'klanten')}</span></div>
    ${people(c.klanten.filter(k => k.status !== 'nee'))}
    ${sent ? `<p class="c-next go">${icon('check')}Bestelling verstuurd</p>` : `<p class="c-next wait">${icon('send')}Bestelmail nog versturen</p>`}
  </a>`;
}
function truckCard(z) {
  return `<a class="card offer plain mini" href="${z.factuur_id ? `#/factuur/${z.factuur_id}` : '#/vandaag'}">
    <div class="c-head"><h3>${h(z.kweker)}</h3><span class="faint small">${fTime(z.aankomst_verwacht || z.aankomst_gepland)}</span></div>
    <div class="nums"><span>${dayWord(z.aankomst_verwacht || z.aankomst_gepland)} · ${fNum(z.stuks)} stuks</span><span>${z.klanten ? plural(z.klanten, 'klant', 'klanten') : 'nog niet verdeeld'}</span></div>
  </a>`;
}
function loodsCard(x) {
  const pct = x.hier ? Math.round(x.gereserveerd / x.hier * 100) : 0;
  return `<a class="card offer" href="${x.aanbod_id ? `#/aanbod/${x.aanbod_id}` : `#/factuur/${x.factuur_id}`}">
    <div class="c-head"><h3>${h(x.kweker)}</h3><span class="faint small">binnen ${fTime(x.binnen_om)}</span></div>
    <p class="plants">${h(x.planten.join(', '))}</p>
    <div class="meter" role="img" aria-label="${pct}% staat klaar voor klanten"><i style="width:${pct}%"></i></div>
    <div class="nums"><span>${fNum(x.gereserveerd)} voor klanten</span><span class="${x.vrij ? 'free' : ''}">${fNum(x.vrij)} vrij</span></div>
    ${x.klanten.length ? `<div class="who">${x.klanten.slice(0, 3).map(n => `<span class="chip">${h(n)}</span>`).join('')}${x.klanten.length > 3 ? `<span class="chip">+${x.klanten.length - 3}</span>` : ''}</div>` : ''}
    ${x.leeftijd !== 'ok' ? `<p class="c-next wait">${icon('clock')}Staat al ${rel(x.binnen_om).replace(' geleden', '')}</p>` : x.vrij ? `<p class="c-next">${icon('basket')}Vrij: aanbieden</p>` : ''}
  </a>`;
}

function inboxStrip(list) {
  if (!list.length) return '';
  return `<section class="inbox-strip" aria-label="Nog te lezen">
    <h2>${icon('inbox')}${plural(list.length, 'bericht', 'berichten')} nog lezen</h2>
    <ul>${list.slice(0, 3).map(b => {
      const verdacht = b.status === 'fout' && /^Verdacht/.test(b.fout || '');
      return `<li class="${verdacht ? 'bad' : ''}"><span class="src">${kanaalIcon(b.kanaal)}${h(b.kweker || b.van_naam || b.van || 'Onbekend')}</span>
        <span class="txt">${h(verdacht ? b.fout : (b.onderwerp || b.tekst || '').slice(0, 90))}</span><span class="faint small">${rel(b.ontvangen)}</span>
        ${verdacht ? `<a class="btn btn-sm btn-bad" href="#/inbox/${b.id}">Bekijken</a>` : `<button class="btn btn-sm btn-leaf" data-act="lees" data-id="${b.id}">Lees nu</button>`}</li>`;
    }).join('')}</ul>
    ${list.length > 3 ? `<a class="lnk small" href="#/inbox">Alle ${list.length} in de inbox</a>` : ''}
  </section>`;
}

export async function render() {
  const d = await api('/workflow');
  const by = { aanbod: [], bellen: [], besteld: [], loods: [] };
  for (const c of d.aanbod) {
    if (c.stap === 'verlopen') by.aanbod.push(c);
    else if (by[c.stap]) by[c.stap].push(c);
  }
  by.aanbod.sort((a, b) => (a.stap === 'verlopen') - (b.stap === 'verlopen') || new Date(b.ontvangen) - new Date(a.ontvangen));
  by.bellen.sort((a, b) => b.bellen - a.bellen);
  const counts = { aanbod: by.aanbod.filter(c => c.stap !== 'verlopen').length, bellen: by.bellen.length, besteld: by.besteld.length + d.komt.length, loods: d.loods.length };
  const body = {
    aanbod: by.aanbod.map(offerCard).join('') || '<p class="more">Geen nieuw aanbod. Komt er iets binnen via mail of WhatsApp, dan staat het hier, al gekoppeld aan klanten.</p>',
    bellen: by.bellen.map(offerCard).join('') || '<p class="more">Niemand te bellen.</p>',
    besteld: (by.besteld.map(orderCard).join('') + (d.komt.length ? `<p class="col-sub">${icon('phone')}Buiten een aanbod besteld</p>${d.komt.map(truckCard).join('')}` : '')) || '<p class="more">Niets onderweg.</p>',
    loods: d.loods.slice(0, 8).map(loodsCard).join('') + (d.loods.length > 8 ? `<a class="more lnk" href="#/loods">en nog ${d.loods.length - 8} leveringen in de loods</a>` : '') || '<p class="more">De loods is leeg.</p>',
  };
  const col = s => `<section class="col" data-step="${s}" aria-labelledby="col-${s}">
    <header><h2 id="col-${s}"><span class="nr">${KETEN[s].nr}</span>${h(KETEN[s].naam)}<span class="pill-n">${counts[s]}</span></h2><p>${h(KETEN[s].uitleg)}</p></header>
    <div class="cards">${body[s]}</div>
    ${s === 'loods' ? `<a class="btn btn-sm btn-line col-foot" href="#/loods">${icon('shed')}Hele loods: ${fNum(d.loods_kpi.stuks)} stuks, ${fNum(d.loods_kpi.vrij)} vrij</a>` : ''}
  </section>`;
  const todo = counts.aanbod + counts.bellen;
  return `<div class="page" style="max-width:none">
    <div class="ph"><div><h1>Workflow</h1><p>Van aanbod tot loods. Elke kaart is één mand van één kweker: gelezen, gekoppeld aan klanten en op risico gewogen. ${todo ? `Nu ${plural(todo, 'mand', 'manden')} om te bellen of te bestellen.` : 'Alles is bij.'}</p></div>
      <div class="acts"><a class="btn btn-ghost" href="#/uitleg">${icon('book')}Zo werkt het</a><button class="btn btn-leaf" data-act="aanbod-plakken">${icon('plus')}Aanbod toevoegen</button></div></div>
    ${d.facturen.length ? `<div class="warnbox wait">${icon('warn')}<span>${plural(d.facturen.length, 'factuur', 'facturen')} met een regel die de desk niet zeker las: ${d.facturen.map(f => `<a href="#/factuur/${f.id}">${h(f.kweker)} ${h(f.nummer)}</a>`).join(', ')}.</span></div>` : ''}
    ${inboxStrip(d.inbox)}
    <div class="flow chain">${ORDER.map(col).join('')}</div>
  </div>`;
}

export const actions = {
  async lees(el, ctx) {
    el.disabled = true; el.innerHTML = '<span class="spin"></span> Lezen…';
    const r = await api(`/inbox/${el.dataset.id}/lees`, { method: 'POST', body: {} }).catch(e => ({ ok: false, reden: e.message }));
    if (r.soort === 'aanbod') { toast(`Aanbod gelezen${r.gelezen_door === 'ai' ? ' met AI' : ''}: ${plural(r.voorstellen, 'koppeling', 'koppelingen')} met klanten.`); location.hash = `#/aanbod/${r.aanbod_id}`; return; }
    if (r.soort === 'factuur') { toast(`Factuur gelezen${r.gelezen_door === 'ai' ? ' met AI' : ''}.`); location.hash = `#/factuur/${r.factuur_id}`; return; }
    if (r.soort === 'verdacht') toast('Verdacht bericht: niet betalen.');
    else if (r.soort === 'tijd') toast('Tijd van de wagen bijgewerkt.');
    else if (r.soort === 'dubbel') toast('Deze factuur stond er al.');
    else if (!r.ok) toast(r.reden || 'Lezen lukte niet.');
    else toast('Gelezen: geen aanbod, factuur of tijd gevonden.');
    ctx.refresh();
  },
  'aanbod-plakken'(el, ctx) { pasteOffer(ctx); },
};
export const refreshEvery = 60000;

// an offer that came in by phone or a forwarded chat: paste it, the desk reads it like any other
export async function pasteOffer(ctx) {
  const growers = await api('/kwekers/namen').catch(() => []);
  dialog({
    title: 'Aanbod toevoegen', ok: 'Lezen',
    body: `<p class="small muted" style="margin-bottom:10px">Plak het bericht van de kweker, zoals het in WhatsApp of de mail staat. De desk zoekt de planten, koppelt ze aan klanten en maakt de concepten.</p>
      ${field('tekst', 'Bericht', '', { type: 'textarea', wide: true })}
      ${field('kweker_id', 'Kweker', '', { opts: [['', 'Laat de desk het herkennen'], ...growers.map(g => [g.id, g.naam])] })}
      ${field('van', 'Of: telefoonnummer of mailadres van de afzender', '')}`,
    onOk: async v => {
      if (!v.tekst || v.tekst.trim().length < 10) throw new Error('Plak eerst het bericht.');
      const r = await api('/inbox/plakken', { method: 'POST', body: { tekst: v.tekst, van: v.van || null, kweker_id: v.kweker_id ? Number(v.kweker_id) : null } });
      if (r.soort === 'aanbod') { toast(`Gelezen: ${plural(r.voorstellen, 'koppeling', 'koppelingen')} met klanten.`); location.hash = `#/aanbod/${r.aanbod_id}`; return; }
      if (r.soort === 'factuur') { toast('Dit was een factuur; hij staat in de workflow.'); location.hash = `#/factuur/${r.factuur_id}`; return; }
      toast(r.ok ? 'Gelezen, maar er stond geen aanbod in.' : (r.reden || 'Lezen lukte niet.'));
      ctx.refresh();
    },
  });
}
