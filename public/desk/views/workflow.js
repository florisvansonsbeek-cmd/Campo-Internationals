// The workflow: every invoice from a grower moves left to right, from "in" to "done".
import { api, h, icon, fTime, fNum, dayWord, rel, plural, STAP, kanaalIcon, kanaalNaam, toast } from '../core.js';

const ORDER = ['binnen', 'nakijken', 'koppelen', 'rest', 'informeren', 'klaar'];

function allocBar(c) {
  const total = Number(c.stuks) || 0;
  if (!total) return '';
  const prop = Number(c.voorstel) || 0, done = Math.max(0, (Number(c.verdeeld) || 0) - prop), rest = Math.max(0, Number(c.rest) || 0);
  const pc = v => `${Math.max(0, v / total * 100)}%`;
  return `<div class="alloc" role="img" aria-label="${fNum(done)} verdeeld, ${fNum(prop)} voorgesteld, ${fNum(rest)} over">${done ? `<i class="a-ok" style="width:${pc(done)}"></i>` : ''}${prop ? `<i class="a-prop" style="width:${pc(prop)}"></i>` : ''}${rest ? `<i class="a-rest" style="width:${pc(rest)}"></i>` : ''}</div>`;
}

function arrival(c) {
  if (c.binnen_om) return `<span>${icon('check')}binnen ${fTime(c.binnen_om)}</span>`;
  if (c.aankomst_gepland) return `<span>${icon('truck')}${dayWord(c.aankomst_gepland) === 'vandaag' ? '' : dayWord(c.aankomst_gepland) + ' '}${fTime(c.aankomst_verwacht || c.aankomst_gepland)}</span>`;
  return '';
}

function doneCard(c) {
  return `<a class="card" href="#/factuur/${c.id}"><h3>${h(c.kweker)}</h3><div class="meta"><span>${h(c.nummer)}</span>${c.binnen_om ? `<span>${icon('check')}${fTime(c.binnen_om)}</span>` : ''}</div><div class="meta"><span>${plural((c.klantnamen || []).length, 'klant', 'klanten')}</span><span>${fNum(c.stuks)} stuks</span></div></a>`;
}

function card(c) {
  const names = c.klantnamen || [];
  const plants = (c.planten || []).filter(p => p.plant);
  return `<a class="card${c.waarschuwing ? ' bad' : ''}" href="#/factuur/${c.id}">
    <h3>${h(c.kweker)}</h3>
    <div class="meta"><span>${h(c.nummer)}</span>${c.kanaal ? `<span>${kanaalIcon(c.kanaal)}${kanaalNaam(c.kanaal)}</span>` : ''}${arrival(c)}</div>
    <div class="meta"><span>${plural(c.regels, 'regel', 'regels')}</span><span>${fNum(c.stuks)} stuks</span>${plants.length ? `<span title="${h(plants.map(p => `${p.aantal} ${p.plant}`).join(', '))}">${h([...new Set(plants.map(p => p.plant.replace(/\s(wit|roze|paars|blauw|geel|oranje|rood)$/, '')))].slice(0, 2).join(', '))}${plants.length > 2 ? '…' : ''}</span>` : ''}</div>
    ${allocBar(c)}
    ${names.length ? `<div class="who">${names.slice(0, 3).map(n => `<span class="chip">${h(n)}</span>`).join('')}${names.length > 3 ? `<span class="chip">+${names.length - 3}</span>` : ''}</div>` : ''}
    ${c.stap === 'nakijken' ? `<p class="warn">${plural(c.twijfel, 'regel', 'regels')} niet zeker gelezen</p>` : ''}
    ${c.stap === 'rest' ? `<p class="warn" style="color:var(--brass)">${fNum(c.rest)} stuks zonder bestemming</p>` : ''}
    ${c.stap === 'informeren' ? `<p class="small muted">${plural(c.klanten - c.verstuurd, 'klant wacht', 'klanten wachten')} op bericht</p>` : ''}
    ${c.waarschuwing ? `<p class="warn">${h(c.waarschuwing)}</p>` : ''}
  </a>`;
}

function inboxCard(b) {
  const verdacht = b.status === 'fout' && /^Verdacht/.test(b.fout || '');
  return `<div class="card${verdacht || b.status === 'fout' ? ' bad' : ''}">
    <h3>${h(b.kweker || b.van_naam || b.van || 'Onbekend')}</h3>
    <div class="meta"><span>${kanaalIcon(b.kanaal)}${kanaalNaam(b.kanaal)}</span><span>${rel(b.ontvangen)}</span>${b.bestanden ? `<span>${icon('file')}${h(b.bestanden[0])}</span>` : ''}</div>
    ${b.onderwerp ? `<p class="small">${h(b.onderwerp)}</p>` : b.tekst ? `<p class="small muted">${h(b.tekst.slice(0, 110))}${b.tekst.length > 110 ? '…' : ''}</p>` : ''}
    ${b.fout ? `<p class="warn">${h(b.fout)}</p>` : ''}
    <div style="display:flex;gap:6px;flex-wrap:wrap">${verdacht ? `<a class="btn btn-sm btn-bad" href="#/inbox/${b.id}">Bekijken</a><button class="btn btn-sm btn-ghost" data-act="negeer" data-id="${b.id}">Negeren</button>` : `<button class="btn btn-sm btn-leaf" data-act="lees" data-id="${b.id}">${b.status === 'bezig' ? '<span class="spin"></span> Bezig' : 'Lees nu'}</button><a class="btn btn-sm btn-ghost" href="#/inbox/${b.id}">Bekijken</a>`}</div>
  </div>`;
}

export async function render() {
  const d = await api('/workflow');
  const by = Object.fromEntries(ORDER.map(s => [s, []]));
  for (const c of d.kaarten) (by[c.stap] || by.klaar).push(c);
  by.binnen = d.inbox;
  const head = s => `<header><h2>${h(STAP[s].naam)}<span class="pill-n${s === 'nakijken' || (s === 'binnen' && by[s].some(b => b.status === 'fout')) ? ' bad' : ''}">${by[s].length}</span></h2><p>${h(STAP[s].uitleg)}</p></header>`;
  const col = s => `<section class="col" data-step="${s}" aria-label="${h(STAP[s].naam)}">${head(s)}<div class="cards">${
    by[s].length ? (s === 'binnen' ? by[s].map(inboxCard) : by[s].slice(0, s === 'klaar' ? 14 : 60).map(s === 'klaar' ? doneCard : card)).join('') + (s === 'klaar' && by[s].length > 14 ? `<p class="more">en nog ${by[s].length - 14}</p>` : '')
    : `<p class="more">${s === 'klaar' ? 'Vandaag nog niets afgerond.' : 'Leeg.'}</p>`}</div></section>`;
  const open = ORDER.slice(1, 5).reduce((n, s) => n + by[s].length, 0);
  return `<div class="page" style="max-width:none">
    <div class="ph"><div><h1>Workflow</h1><p>Elke factuur van een kweker gaat van links naar rechts: gelezen, gekoppeld aan klanten, de rest verdeeld, klanten op de hoogte. ${open ? `Nu ${plural(open, 'factuur', 'facturen')} onderweg in de stappen.` : 'Alles is bij.'}</p></div>
      <div class="acts"><a class="btn btn-line" href="#/inbox">${icon('upload')}Factuur toevoegen</a></div></div>
    <div class="flow">${ORDER.map(col).join('')}</div>
  </div>`;
}

export const actions = {
  async lees(el, ctx) {
    el.disabled = true; el.innerHTML = '<span class="spin"></span> Lezen…';
    const r = await api(`/inbox/${el.dataset.id}/lees`, { method: 'POST', body: {} }).catch(e => ({ ok: false, reden: e.message }));
    if (r.soort === 'factuur') { toast(`Gelezen${r.gelezen_door === 'ai' ? ' met AI' : ''}: ${r.voorstellen} ${r.voorstellen === 1 ? 'koppeling' : 'koppelingen'} voorgesteld.`); location.hash = `#/factuur/${r.factuur_id}`; return; }
    if (r.soort === 'verdacht') toast('Verdacht bericht: niet betalen.');
    else if (r.soort === 'tijd') toast('Tijd van de wagen bijgewerkt.');
    else if (r.soort === 'dubbel') toast('Deze factuur stond er al.');
    else if (!r.ok) toast(r.reden || 'Lezen lukte niet.');
    else toast('Gelezen: geen factuur of tijd gevonden.');
    ctx.refresh();
  },
  async negeer(el, ctx) { await api(`/inbox/${el.dataset.id}/negeer`, { method: 'POST', body: {} }); toast('Genegeerd.'); ctx.refresh(); },
};
export const refreshEvery = 60000;
