// The workflow, simple. On top: baskets that can be ordered right away, and what stands in the loods without
// a customer, each lot with the truck it can go along on. Below: one picture of the day, the growers on the left,
// Jan's loods in the middle, the customers on the right; under it one line per order with how far it probably is
// and whether a delivery is in danger. Every order, truck and basket opens in a new tab.
import { api, h, icon, fNum, fEur, fTime, dayWord, plural, toast, dialog, field } from '../core.js';
import { when, TONE, lcTitle, stageText, cap } from '../lane.js';
import { short } from '../agenda.js';
import { erbijEen, pack } from '../erbij.js';

const NEW = 'target="_blank" rel="noopener"';
const pad = n => String(n).padStart(2, '0');
const ymd = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const RANK = { bad: 0, wait: 1, ok: 2, done: 3 };
let day = 'vandaag', doneOpen = false; // survive the refresh every minute
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

// a free lot and the truck it fits on best (the why, and the other trucks, sit in the tooltip)
function freeItem(p) {
  const w = p.wagens[0];
  const more = p.wagens.slice(1).map(x => `${x.klant} (${when(x.vertrek)})`).join(', ');
  return `<li class="fr2 ${p.leeftijd}">
    <div class="fr-top"><span><b>${h(p.plant)}</b> <span class="faint">${h(p.maat)}</span><span class="sub">${h(short(p.kweker))} · staat ${age(p.uren)}${p.leeftijd !== 'ok' ? `, ${p.leeftijd === 'bad' ? 'te lang' : 'let op'}` : ''}</span></span><b class="num">${fNum(p.vrij)}</b></div>
    ${w ? `<div class="fr-go" title="${h(`${cap(w.reden)}.${more ? ` Past ook op: ${more}.` : ''}`)}"><span>${icon('truck')}<span>Mee met <b>${h(w.klant)}</b>, ${h(when(w.vertrek))} <em>${h(w.reden.split(',')[0])}</em></span></span>
        <button type="button" class="btn btn-sm btn-leaf" data-act="erbij" data-x="${pack(w, { ...p, aantal: w.aantal, prijs: w.prijs, reden: w.reden })}">${fNum(w.aantal)} erbij</button></div>`
      : `<div class="fr-go none"><span>Geen wagen die past.</span><a class="btn btn-sm btn-line" href="#/loods?aanbieden=${p.regel_id}" ${NEW}>Aanbieden</a></div>`}
  </li>`;
}

// the next trucks to customers: what time, and whether something from the loods fits on them
function nextTrucks(ws) {
  return `<ul class="trucks-next">${ws.slice(0, 7).map(w => `<li><a class="tn" href="#/wagen/${w.levering_id}" ${NEW}>
    <time>± ${dayWord(w.vertrek) === 'vandaag' ? '' : dayWord(w.vertrek) === 'morgen' ? 'morgen ' : `${['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'][new Date(w.vertrek).getDay()]} `}${fTime(w.vertrek)}</time>
    <span><b>${h(w.klant)}</b><em>${h(w.plaats || '')}</em></span>
    <span class="fitn${w.past ? '' : ' none'}">${w.past ? `${w.past} ${w.past === 1 ? 'partij past' : 'partijen passen'}` : 'niets passend'}</span></a></li>`).join('')}</ul>`;
}

// one picture of the day: growers, the loods, customers; hover a name to see where its goods go
const ROWH = 32;
function flowMap(lanes, key) {
  const left = lanes.slice().sort((a, b) => new Date(a.in.eta) - new Date(b.in.eta));
  const rmap = new Map();
  for (const b of left) for (const k of b.klanten) {
    if (ymd(k.vertrek) !== key) continue;
    if (!rmap.has(k.levering_id)) rmap.set(k.levering_id, { ...k, z: [] });
    rmap.get(k.levering_id).z.push(b.id);
  }
  const right = [...rmap.values()].sort((a, b) => new Date(a.vertrek) - new Date(b.vertrek));
  if (!left.length) return '<p class="empty panel">Voor deze dag staat er nog geen wagen gepland.</p>';
  const n = Math.max(left.length, right.length, 3), H = n * ROWH, mid = H / 2;
  const topL = (H - left.length * ROWH) / 2, topR = (H - right.length * ROWH) / 2;
  const lCls = b => (b.in.state === 'binnen' ? 'go t-done' : b.in.state === 'onderweg' ? `go t-${b.in.toon}` : `not t-${b.in.toon}`);
  const rCls = k => (k.state === 'afgeleverd' ? 'go t-done' : k.state === 'onderweg' ? `go t-${k.toon}` : `not t-${k.toon}`);
  const lp = left.map((b, i) => { const y = topL + i * ROWH + ROWH / 2; return `<path class="${lCls(b)}" data-z="${b.id}" d="M0 ${y} C 26 ${y}, 30 ${mid}, 45 ${mid}"/>`; }).join('');
  const rp = right.map((k, j) => { const y = topR + j * ROWH + ROWH / 2; return `<path class="${rCls(k)}" data-l="${k.levering_id}" d="M55 ${mid} C 70 ${mid}, 74 ${y}, 100 ${y}"/>`; }).join('');
  const DOW = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const t = v => (ymd(v) === key ? fTime(v) : `${DOW[new Date(v).getDay()]} ${fTime(v)}`);
  const inT = z => (z.state === 'binnen' ? `${icon('check')}${t(z.eta)}` : `±${t(z.eta)}`);
  const outT = k => (k.state === 'afgeleverd' || k.state === 'onderweg' ? `${icon('check')}${t(k.vertrek)}` : `±${t(k.vertrek)}`);
  const ln = left.map(b => `<li class="fm-n t-${b.toon}" data-z="${b.id}" data-l="${b.klanten.filter(k => ymd(k.vertrek) === key).map(k => k.levering_id).join(',')}">
      <a href="#/bestelling/${b.id}" ${NEW} title="${h(`${b.kweker}: ${stageText(b)}`)}"><i class="dot" aria-hidden="true"></i><b>${h(short(b.kweker))}</b><time>${inT(b.in)}</time></a></li>`).join('');
  const rn = right.map(k => `<li class="fm-n t-${k.toon}" data-l="${k.levering_id}" data-z="${k.z.join(',')}">
      <a href="#/wagen/${k.levering_id}" ${NEW} title="${h(`Wagen naar ${k.klant}${k.plaats ? `, ${k.plaats}` : ''}: aankomst ${k.state === 'afgeleverd' ? '' : 'waarschijnlijk '}${when(k.eta)}${k.reden ? `. ${cap(k.reden)}` : ''}`)}"><time>${outT(k)}</time><b>${h(short(k.klant))}</b><span>${h(k.plaats || '')}</span><i class="dot" aria-hidden="true"></i></a></li>`).join('');
  return `<div class="flowmap" style="--h:${H}px">
    <div class="fm-cols" aria-hidden="true"><span>Kwekers <b>${left.length}</b></span><span>Loods</span><span>Klanten <b>${right.length}</b></span></div>
    <div class="fm-grid">
      <ol class="fm-side fm-l" style="padding-top:${topL}px" aria-label="Wagens van kwekers">${ln}</ol>
      <div class="fm-mid"><svg viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${lp}${rp}</svg>
        <div class="fm-hub"><span>${icon('shed')}</span><b>Campo</b><em>Nootdorp</em></div></div>
      <ol class="fm-side fm-r" style="padding-top:${topR}px" aria-label="Wagens naar klanten">${rn}</ol>
    </div>
  </div>`;
}

// one line per order: how far it probably is, and whether a delivery is in danger
function orderRow(b) {
  const names = b.klanten.map(k => short(k.klant));
  const to = names.length ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}` : 'alles naar de loods';
  return `<li><a class="orow t-${b.toon}" href="#/bestelling/${b.id}" ${NEW}>
    <i class="dot" aria-hidden="true"></i>
    <span class="ow"><b>${h(b.kweker)}</b><span>naar ${h(to)}</span></span>
    <span class="op"><span class="pbar" role="img" aria-label="Waarschijnlijk ${b.voortgang}% van de route"><i style="width:${b.voortgang}%"></i></span><b>${b.voortgang}%</b></span>
    <span class="os">${h(stageText(b))}</span>
    <span class="st t-${b.toon}"><i aria-hidden="true"></i>${TONE[b.toon]}</span>
    ${b.reden ? `<span class="or t-${b.toon}">${h(cap(b.reden))}.</span>` : ''}
  </a></li>`;
}

export async function render() {
  const d = await api('/stroom');
  const now = new Date(d.nu);
  const key = day === 'morgen' ? ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12)) : ymd(now);
  const all = [...d.banen, ...d.klaar];
  const lanes = all.filter(b => ymd(b.in.eta) === key || b.klanten.some(k => ymd(k.vertrek) === key));
  const open = lanes.filter(b => b.actief).sort((a, b) => RANK[a.toon] - RANK[b.toon] || new Date(a.volgende || a.eind) - new Date(b.volgende || b.eind));
  const done = lanes.filter(b => !b.actief);
  const tally = k => open.filter(b => b.toon === k).length;
  const v = d.vrij, free = v.partijen.slice(0, 5);
  const leaving = v.wagens.length;
  return `<div class="page flowpage">
    <div class="ph"><div><h1>Workflow</h1><p>Wat je kunt bestellen, wat er vrij in de loods staat, en waar elke bestelling is. Alles opent in een nieuw tabblad.</p></div>
      <div class="acts"><a class="btn btn-ghost" href="#/uitleg">${icon('book')}Zo werkt het</a><button class="btn btn-leaf" data-act="aanbod-plakken">${icon('plus')}Aanbod toevoegen</button></div></div>

    <div class="top2">
      <div class="stack">
        <section class="panel buy-panel" aria-labelledby="h-buy">
        <header><h2 id="h-buy">Direct te bestellen</h2><span class="sub">Elke plant heeft een klant en kan meteen weg</span></header>
        ${d.direct.length ? `<ul class="buys">${d.direct.map(buyItem).join('')}</ul>` : '<p class="empty">Nu is er geen mand die helemaal rond is. Zodra elke plant in een aanbod een klant heeft, staat hij hier.</p>'}
        ${d.uitzoeken.length ? `<p class="later"><span>Nog uitzoeken:</span> ${d.uitzoeken.map(c => `<a href="#/aanbod/${c.id}" ${NEW}>${h(c.kweker)}</a> <span class="faint">(${h(c.waarom)})</span>`).join(', ')}</p>` : ''}
        </section>
        ${leaving ? `<section class="panel" aria-labelledby="h-next"><header><h2 id="h-next">Wagens die nog vertrekken</h2><span class="sub">Hier kan nog iets bij</span></header>${nextTrucks(v.wagens)}${leaving > 7 ? `<p class="later"><a href="#/vandaag">Alle ${leaving} bij Vandaag</a></p>` : ''}</section>` : ''}
      </div>
      <section class="panel free-panel" aria-labelledby="h-free">
        <header><h2 id="h-free">In de loods zonder bestemming</h2><span class="sub">${v.stuks ? `${fNum(v.stuks)} stuks, ${fEur(v.waarde)} inkoop` : ''}</span></header>
        ${v.stuks ? `<p class="free-lead">Wat vrij staat, en de wagen die toch al naar een klant gaat die het koopt.${v.te_lang ? ` <span class="bad-t">${plural(v.te_lang, 'partij staat', 'partijen staan')} te lang.</span>` : ''}</p>
          <ul class="frees">${free.map(freeItem).join('')}</ul>
          <p class="later"><a href="#/loods?toon=vrij" ${NEW}>${v.partijen.length > free.length ? `Alle ${v.partijen.length} partijen in de loods` : 'Naar de loods'}</a></p>`
          : '<p class="empty">Alles in de loods heeft een klant.</p>'}
      </section>
    </div>

    <section class="flow-sec" aria-labelledby="h-flow">
      <header class="flow-h"><div><h2 id="h-flow">Van kweker naar klant</h2><p class="small muted">Wijs een naam aan om te zien waar de planten heen gaan.</p></div>
        <div class="flow-tools"><p class="tally">${[['bad', tally('bad')], ['wait', tally('wait')], ['ok', tally('ok')]].map(([k, n]) => `<span class="st t-${k}"><i aria-hidden="true"></i>${n} ${TONE[k].toLowerCase()}</span>`).join('')}</p>
          <div class="tog" role="group" aria-label="Dag"><button type="button" data-act="wf-dag" data-d="vandaag" aria-pressed="${day === 'vandaag'}">Vandaag</button><button type="button" data-act="wf-dag" data-d="morgen" aria-pressed="${day === 'morgen'}">Morgen</button></div></div></header>
      <div class="panel fm-panel">${flowMap(lanes, key)}</div>
      ${open.length ? `<h3 class="grp">Bestellingen onderweg <span>${open.length}</span></h3><ol class="orows panel">${open.map(orderRow).join('')}</ol>` : ''}
      ${done.length ? `<details class="done-lanes"${doneOpen ? ' open' : ''}><summary>Afgerond (${done.length})</summary><ol class="orows panel">${done.map(orderRow).join('')}</ol></details>` : ''}
    </section>
  </div>`;
}

// hovering a grower lights up the customers its plants go to, and the other way round
export function mount() {
  const el = document.querySelector('.done-lanes');
  if (el) el.addEventListener('toggle', () => { doneOpen = el.open; });
  const map = document.querySelector('.flowmap');
  if (!map) return;
  const clear = () => { map.classList.remove('focus'); map.querySelectorAll('.hl').forEach(x => x.classList.remove('hl')); };
  const light = n => {
    clear();
    const zs = (n.dataset.z || '').split(',').filter(Boolean), ls = (n.dataset.l || '').split(',').filter(Boolean);
    map.classList.add('focus');
    n.classList.add('hl');
    for (const z of zs) map.querySelectorAll(`[data-z="${z}"]`).forEach(x => { if (x.matches('path') || x.closest('.fm-l')) x.classList.add('hl'); });
    for (const l of ls) map.querySelectorAll(`[data-l="${l}"]`).forEach(x => { if (x.matches('path') || x.closest('.fm-r')) x.classList.add('hl'); });
  };
  map.querySelectorAll('.fm-n').forEach(n => {
    n.addEventListener('mouseenter', () => light(n));
    n.addEventListener('focusin', () => light(n));
    n.addEventListener('mouseleave', clear);
    n.addEventListener('focusout', clear);
  });
}

export const actions = {
  'aanbod-plakken'(el, ctx) { pasteOffer(ctx); },
  'wf-dag'(el, ctx) { day = el.dataset.d; ctx.refresh(); },
  erbij(el, ctx) { erbijEen(el, ctx); },
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
      if (r.soort === 'factuur') { toast('Dit was een factuur; hij staat bij de bestellingen.'); location.hash = `#/factuur/${r.factuur_id}`; return; }
      toast(r.ok ? 'Gelezen, maar er stond geen aanbod in.' : (r.reden || 'Lezen lukte niet.'));
      ctx.refresh();
    },
  });
}
