// The workflow on one page. On top: baskets that can be ordered right away, and what stands in the loods
// without a customer. Below: every order from the grower, through the loods, to each customer, with where
// it probably is and whether a delivery is in danger. Clicking an order opens everything about it in a new tab.
import { api, h, icon, fNum, fEur, dayWord, plural, toast, dialog, field } from '../core.js';
import { laneHtml, when, TONE, lcTitle } from '../lane.js';

const NEW = 'target="_blank" rel="noopener"';
let doneOpen = false; // keeps "Vandaag afgerond" open across the refresh every minute
const age = u => (u < 1 ? 'net binnen' : u < 24 ? `${u} uur` : `${Math.round(u / 24)} ${Math.round(u / 24) === 1 ? 'dag' : 'dagen'}`);

function buyItem(c) {
  const mid = c.risico && c.risico.niveau === 'middel';
  const who = [c.al_besteld ? `${c.al_besteld} al besteld` : '', c.akkoord ? `${c.akkoord} akkoord` : '', c.bellen ? `${c.bellen} nog bellen` : ''].filter(Boolean).join(', ');
  const left = c.geldig_tot ? (new Date(c.geldig_tot) - Date.now()) / 6e4 : null;
  return `<li><a class="buy t-${mid ? 'wait' : 'ok'}" href="#/aanbod/${c.id}" ${NEW}>
    <span class="dot" aria-hidden="true"></span>
    <span class="bt"><b>${h(c.kweker)}</b>
      <span>${fNum(c.stuks)} stuks naar ${plural(c.klanten, 'klant', 'klanten')}${who ? ` (${who})` : ''}</span>
      <span>${[c.levering ? `levert ${dayWord(c.levering)}` : '', c.geldig_tot ? `aanbod geldt tot ${when(c.geldig_tot)}` : ''].filter(Boolean).join(', ')}${left != null && left > 0 && left <= 180 ? ` <em class="soon">nog ${left < 60 ? `${Math.round(left)} min` : `${Math.floor(left / 60)} u`}</em>` : ''}</span>
      ${mid && c.risico.kop ? `<span class="note">Let op: ${h(lcTitle(c.risico.kop))}</span>` : ''}</span>
    <span class="bm"><b>${fEur(c.marge)}</b><em>marge</em></span>
  </a></li>`;
}

function freeItem(p) {
  return `<li class="fr ${p.leeftijd}">
    <span class="fn"><b>${h(p.plant)}</b> <span class="faint">${h(p.maat)}</span><span class="sub">${h(p.kweker)} · staat ${age(p.uren)}${p.leeftijd !== 'ok' ? `, ${p.leeftijd === 'bad' ? 'te lang' : 'let op'}` : ''}</span></span>
    <b class="num">${fNum(p.vrij)}</b>
    <a class="btn btn-sm btn-line" href="#/loods?aanbieden=${p.regel_id}" ${NEW}>Aanbieden</a>
  </li>`;
}

export async function render() {
  const d = await api('/stroom');
  const t = d.telling;
  const att = d.banen.filter(b => b.toon === 'bad' || b.toon === 'wait'), ok = d.banen.filter(b => b.toon === 'ok');
  const v = d.vrij, free = v.partijen.slice(0, 6);
  return `<div class="page flowpage">
    <div class="ph"><div><h1>Workflow</h1><p>Van de kweker via jouw loods naar de klant. Klik op een bestelling: alles erover opent in een nieuw tabblad.</p></div>
      <div class="acts"><a class="btn btn-ghost" href="#/uitleg">${icon('book')}Zo werkt het</a><button class="btn btn-leaf" data-act="aanbod-plakken">${icon('plus')}Aanbod toevoegen</button></div></div>

    <div class="top2">
      <section class="panel buy-panel" aria-labelledby="h-buy">
        <header><h2 id="h-buy">Direct te bestellen</h2><span class="sub">Elke plant heeft een klant en kan meteen weg</span></header>
        ${d.direct.length ? `<ul class="buys">${d.direct.map(buyItem).join('')}</ul>` : '<p class="empty">Nu is er geen mand die helemaal rond is. Zodra elke plant in een aanbod een klant heeft, staat hij hier.</p>'}
        ${d.uitzoeken.length ? `<p class="later"><span>Nog uitzoeken:</span> ${d.uitzoeken.map(c => `<a href="#/aanbod/${c.id}" ${NEW}>${h(c.kweker)}</a> <span class="faint">(${h(c.waarom)})</span>`).join(', ')}</p>` : ''}
      </section>
      <section class="panel free-panel" aria-labelledby="h-free">
        <header><h2 id="h-free">In de loods zonder bestemming</h2><span class="sub">${v.stuks ? `${fEur(v.waarde)} aan inkoop` : ''}</span></header>
        ${v.stuks ? `<p class="free-total"><b>${fNum(v.stuks)}</b> stuks hebben nog geen klant${v.te_lang ? `; <span class="bad-t">${plural(v.te_lang, 'partij staat', 'partijen staan')} te lang</span>` : ''}.</p>
          <ul class="frees">${free.map(freeItem).join('')}</ul>
          <p class="later"><a href="#/loods?toon=vrij" ${NEW}>${v.partijen.length > free.length ? `Alle ${v.partijen.length} partijen` : 'Naar de loods'}</a></p>` : '<p class="empty">Alles in de loods heeft een klant.</p>'}
      </section>
    </div>

    <section class="flow-sec" aria-labelledby="h-flow">
      <header class="flow-h"><h2 id="h-flow">Van kweker naar klant</h2>
        <p class="tally">${[['bad', t.bad], ['wait', t.wait], ['ok', t.ok]].map(([k, n]) => `<span class="st t-${k}"><i aria-hidden="true"></i>${n} ${TONE[k].toLowerCase()}</span>`).join('')}</p></header>
      <div class="lane-cols" aria-hidden="true"><span>Kweker</span><span>Naar Nootdorp</span><span>Loods</span><span></span><span>Naar de klant</span></div>
      ${att.length ? `<h3 class="grp">Let op</h3><div class="lanes">${att.map(b => laneHtml(b)).join('')}</div>` : ''}
      <h3 class="grp">${att.length ? 'Op schema' : 'Alles loopt op schema'}</h3>
      ${ok.length ? `<div class="lanes">${ok.map(b => laneHtml(b)).join('')}</div>` : '<p class="empty panel">Er is nu niets onderweg.</p>'}
      ${d.klaar.length ? `<details class="done-lanes"${doneOpen ? ' open' : ''}><summary>Vandaag afgerond (${d.klaar.length})</summary><div class="lanes">${d.klaar.map(b => laneHtml(b)).join('')}</div></details>` : ''}
    </section>
  </div>`;
}

export const actions = {
  'aanbod-plakken'(el, ctx) { pasteOffer(ctx); },
};
export function mount() {
  const el = document.querySelector('.done-lanes');
  if (el) el.addEventListener('toggle', () => { doneOpen = el.open; });
}
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
      if (r.soort === 'factuur') { toast('Dit was een factuur; hij staat bij de bestellingen.'); location.hash = `#/factuur/${r.factuur_id}`; return; }
      toast(r.ok ? 'Gelezen, maar er stond geen aanbod in.' : (r.reden || 'Lezen lukte niet.'));
      ctx.refresh();
    },
  });
}
