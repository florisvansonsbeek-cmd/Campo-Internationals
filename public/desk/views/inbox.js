// Inbox: everything that came in by mail or WhatsApp, plus a place to drop a pdf or a photo, or paste a message.
import { api, h, icon, fTime, dayWord, rel, kanaalIcon, kanaalNaam, toast } from '../core.js';

let filter = 'alle';
const FILTERS = [['alle', 'Alles'], ['nieuw', 'Nog lezen'], ['verdacht', 'Verdacht'], ['factuur', 'Facturen'], ['tijd', 'Tijden'], ['genegeerd', 'Genegeerd']];
const match = (b, f) => f === 'alle' ? b.status !== 'genegeerd' : f === 'nieuw' ? ['nieuw', 'bezig', 'fout'].includes(b.status) && !/^Verdacht/.test(b.fout || '') : f === 'verdacht' ? /^Verdacht/.test(b.fout || '') : f === 'genegeerd' ? b.status === 'genegeerd' : b.soort === f;

function row(b, open) {
  const verdacht = /^Verdacht/.test(b.fout || '');
  const st = verdacht ? '<span class="chip bad">Verdacht</span>' : b.status === 'nieuw' ? '<span class="chip info">Nog lezen</span>' : b.status === 'bezig' ? '<span class="chip info"><span class="spin"></span>Bezig</span>' : b.status === 'fout' ? '<span class="chip bad">Niet gelukt</span>' : b.status === 'genegeerd' ? '<span class="chip">Genegeerd</span>' : `<span class="chip ok">${icon('check')}${b.soort === 'tijd' ? 'Tijd verwerkt' : b.soort === 'aanbod' ? 'Aanbod gelezen' : 'Gelezen'}</span>`;
  return `<li class="${verdacht ? 'verdacht' : ''}" id="m${b.id}">
    <span class="ch ${b.kanaal}" title="${kanaalNaam(b.kanaal)}">${kanaalIcon(b.kanaal)}</span>
    <div>
      <b>${h(b.kweker || b.van_naam || b.van || 'Onbekend')}</b> <span class="faint small">${h(b.van || '')}</span>
      <p class="small faint">${kanaalNaam(b.kanaal)} · ${dayWord(b.ontvangen)} ${fTime(b.ontvangen)} (${rel(b.ontvangen)})</p>
      ${b.onderwerp ? `<p style="font-weight:600;margin-top:4px">${h(b.onderwerp)}</p>` : ''}
      ${b.tekst ? `<p class="pre" ${open ? 'style="max-height:none"' : ''}>${h(b.tekst)}</p>` : ''}
      ${b.bestanden ? `<p class="small" style="margin-top:4px">${b.bestanden.map(f => `<a href="/api/bestanden/${f.id}" target="_blank" rel="noopener">${icon('file')} ${h(f.naam)}</a>`).join(' ')}</p>` : ''}
      ${b.fout ? `<p class="fout">${h(b.fout)}</p>` : ''}
    </div>
    <div class="acts">${st}
      ${b.factuur ? `<a class="btn btn-sm btn-line" href="#/factuur/${b.factuur.id}">Factuur ${h(b.factuur.nummer)}</a>` : ''}
      ${b.aanbod_id ? `<a class="btn btn-sm btn-line" href="#/aanbod/${b.aanbod_id}">Naar het voorstel</a>` : ''}
      ${['nieuw', 'fout'].includes(b.status) && !verdacht ? `<button class="btn btn-sm btn-leaf" data-act="lees" data-id="${b.id}">Lees nu</button>` : ''}
      ${['nieuw', 'fout'].includes(b.status) ? `<button class="btn btn-sm btn-ghost" data-act="negeer" data-id="${b.id}">Negeren</button>` : ''}
      ${b.status === 'genegeerd' ? `<button class="btn btn-sm btn-ghost" data-act="lees" data-id="${b.id}">Toch lezen</button>` : ''}
    </div></li>`;
}

export async function render(params) {
  const all = await api('/inbox');
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, all.filter(b => match(b, k)).length]));
  const waiting = b => ['nieuw', 'bezig', 'fout'].includes(b.status);
  const list = all.filter(b => match(b, filter)).sort((a, b) => waiting(b) - waiting(a) || new Date(b.ontvangen) - new Date(a.ontvangen));
  const focus = params.id ? Number(params.id) : null;
  return `<div class="page">
    <div class="ph"><div><h1>Inbox</h1><p>Wat kwekers via mail en WhatsApp sturen. De desk leest aanbod, facturen en tijden; jij beslist. Mail en WhatsApp lopen vanzelf binnen zodra ze gekoppeld zijn (zie Koppelingen).</p></div></div>
    <div class="grid2">
      <section class="panel"><header><div class="seg" role="group" aria-label="Filter">${FILTERS.map(([k, l]) => `<button type="button" data-act="filter" data-f="${k}" aria-pressed="${filter === k}">${h(l)}<small>${counts[k]}</small></button>`).join('')}</div></header>
        ${list.length ? `<ul class="ib">${list.map(b => row(b, b.id === focus)).join('')}</ul>` : '<p class="empty">Hier staat niets.</p>'}
      </section>
      <aside class="stack">
        <section class="panel"><header><h2>Aanbod of factuur toevoegen</h2></header><div class="body stack">
          <label class="drop" id="drop" tabindex="0">${icon('upload')}<b>Sleep een pdf of foto hierheen</b><span class="small">of klik om te kiezen. De desk leest hem meteen.</span><input type="file" id="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden></label>
          <p id="upstate" class="small muted" hidden></p>
        </div></section>
        <section class="panel"><header><h2>Bericht plakken</h2><span class="sub">Bijvoorbeeld een WhatsApp van een kweker</span></header><div class="body stack">
          <label class="f">Van (nummer of naam, optioneel)<input type="text" id="plak-van" placeholder="+31 6 …"></label>
          <label class="f">Tekst<textarea id="plak-tekst" placeholder="Heb nog: 240x Phal. 2t 12 roze à €2,81&#10;Levering morgen, geldig tot 14:00"></textarea></label>
          <p><button class="btn btn-leaf" data-act="plak">Lees dit bericht</button></p>
        </div></section>
      </aside>
    </div>
  </div>`;
}

async function readFile(file, ctx) {
  const st = document.getElementById('upstate');
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) { toast('Dat bestand is groter dan 25 MB.'); return; }
  st.hidden = false; st.innerHTML = `<span class="spin"></span> ${h(file.name)} wordt gelezen…`;
  const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
  try {
    const out = await api('/inbox/upload', { method: 'POST', body: { naam: file.name, mime: file.type || 'application/pdf', data } });
    after(out, ctx);
  } catch (e) { st.textContent = e.message; }
}
function after(out, ctx) {
  if (out.soort === 'aanbod' && out.aanbod_id) { toast(`Aanbod gelezen${out.gelezen_door === 'ai' ? ' met AI' : ''}: ${out.voorstellen} ${out.voorstellen === 1 ? 'koppeling' : 'koppelingen'} met klanten.`); location.hash = `#/aanbod/${out.aanbod_id}`; return; }
  if (out.soort === 'factuur' && out.factuur_id) { toast(`Gelezen${out.gelezen_door === 'ai' ? ' met AI' : ''}.`); location.hash = `#/factuur/${out.factuur_id}`; return; }
  if (out.soort === 'dubbel') { toast(out.reden || 'Deze factuur stond er al.'); if (out.factuur_id) location.hash = `#/factuur/${out.factuur_id}`; return; }
  if (out.soort === 'verdacht') toast('Verdacht bericht. Niet betalen.');
  else if (out.soort === 'tijd') toast('Tijd van de wagen bijgewerkt.');
  else toast(out.ok ? 'Gelezen, maar geen aanbod, factuur of tijd gevonden.' : (out.reden || 'Lezen lukte niet.'));
  ctx.refresh();
}

export const actions = {
  filter(el, ctx) { filter = el.dataset.f; ctx.refresh(); },
  async lees(el, ctx) { el.disabled = true; el.innerHTML = '<span class="spin"></span> Lezen…'; const out = await api(`/inbox/${el.dataset.id}/lees`, { method: 'POST', body: {} }).catch(e => ({ ok: false, reden: e.message })); after(out, ctx); },
  async negeer(el, ctx) { await api(`/inbox/${el.dataset.id}/negeer`, { method: 'POST', body: {} }); toast('Genegeerd.'); ctx.refresh(); },
  async plak(el, ctx) {
    const tekst = document.getElementById('plak-tekst').value.trim(), van = document.getElementById('plak-van').value.trim();
    if (!tekst) { toast('Plak eerst een bericht.'); return; }
    el.disabled = true;
    const out = await api('/inbox/plakken', { method: 'POST', body: { tekst, van: van || undefined } }).catch(e => ({ ok: false, reden: e.message }));
    after(out, ctx);
  },
};
export function mount(ctx) {
  const drop = document.getElementById('drop'), file = document.getElementById('file');
  if (!drop) return;
  drop.addEventListener('click', e => { if (e.target !== file) file.click(); });
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  file.addEventListener('change', () => readFile(file.files[0], ctx));
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => readFile(e.dataTransfer.files[0], ctx));
  const m = document.querySelector('.ib li[id^=m]:target');
  if (m) m.scrollIntoView({ block: 'center' });
}
