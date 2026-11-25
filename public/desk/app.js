// Campo desk: the shell, sign-in, menu, search and the router.
import { api, h, icon, MARK, toast, dialog, waLink, mailLink, copy, fTime } from './core.js';
import { chartEvents } from './charts.js';
import * as vandaag from './views/vandaag.js';
import * as workflow from './views/workflow.js';
import * as factuur from './views/factuur.js';
import * as inbox from './views/inbox.js';
import * as kwekers from './views/kwekers.js';
import * as klanten from './views/klanten.js';
import * as planten from './views/planten.js';
import * as koppelingen from './views/koppelingen.js';
import * as aanbod from './views/aanbod.js';
import * as loods from './views/loods.js';
import * as uitleg from './views/uitleg.js';
import * as bestelling from './views/bestelling.js';

const app = document.getElementById('app');
let me = null, badge = { inbox: 0, werk: 0 };

const ROUTES = [
  { re: /^vandaag$/, nav: 'vandaag', title: 'Vandaag', view: vandaag.render, actions: vandaag.actions, every: vandaag.refreshEvery },
  { re: /^workflow$/, nav: 'workflow', title: 'Workflow', view: workflow.render, actions: workflow.actions, mount: workflow.mount, every: workflow.refreshEvery },
  { re: /^aanbod\/(\d+)$/, keys: ['id'], nav: 'workflow', title: 'Aanbod', view: aanbod.render, actions: aanbod.actions },
  { re: /^bestelling\/(\d+)$/, keys: ['id'], nav: 'workflow', title: 'Bestelling', view: bestelling.render, actions: bestelling.actions, mount: bestelling.mount, every: bestelling.refreshEvery },
  { re: /^loods$/, nav: 'loods', title: 'Loods', view: loods.render, actions: loods.actions, mount: loods.mount, every: loods.refreshEvery },
  { re: /^uitleg$/, nav: 'uitleg', title: 'Zo werkt het', view: uitleg.render, actions: uitleg.actions },
  { re: /^factuur\/(\d+)$/, keys: ['id'], nav: 'workflow', title: 'Factuur', view: factuur.render, actions: factuur.actions, change: factuur.onChange },
  { re: /^inbox(?:\/(\d+))?$/, keys: ['id'], nav: 'inbox', title: 'Inbox', view: inbox.render, actions: inbox.actions, mount: inbox.mount },
  { re: /^kwekers$/, nav: 'kwekers', title: 'Kwekers', view: kwekers.renderList, actions: kwekers.listActions, input: kwekers.onInput },
  { re: /^kweker\/(\d+)$/, keys: ['id'], nav: 'kwekers', title: 'Kweker', view: kwekers.renderDetail, actions: kwekers.detailActions },
  { re: /^klanten$/, nav: 'klanten', title: 'Klanten', view: klanten.renderList, actions: klanten.listActions, input: klanten.onInput },
  { re: /^klant\/(\d+)$/, keys: ['id'], nav: 'klanten', title: 'Klant', view: klanten.renderDetail, actions: klanten.detailActions },
  { re: /^planten$/, nav: 'planten', title: 'Planten', view: planten.renderList, actions: planten.listActions, input: planten.onInput },
  { re: /^plant\/(\d+)$/, keys: ['id'], nav: 'planten', title: 'Plant', view: planten.renderDetail, actions: planten.detailActions },
  { re: /^koppelingen$/, nav: 'koppelingen', title: 'Koppelingen', view: koppelingen.render, actions: koppelingen.actions, change: koppelingen.onChange },
];
const NAV = [
  ['vandaag', 'Vandaag', 'today'], ['workflow', 'Workflow', 'flow'], ['loods', 'Loods', 'shed'], ['inbox', 'Inbox', 'inbox'],
  ['kwekers', 'Kwekers', 'grower'], ['klanten', 'Klanten', 'customer'], ['planten', 'Planten', 'plant'], ['koppelingen', 'Koppelingen', 'plug'], ['uitleg', 'Zo werkt het', 'book'],
];

function parse() {
  const raw = location.hash.replace(/^#\/?/, '') || 'vandaag';
  const [path, qs] = raw.split('?');
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) return { r, params: Object.fromEntries((r.keys || []).map((k, i) => [k, m[i + 1]])), query: new URLSearchParams(qs || '') };
  }
  return { r: ROUTES[0], params: {}, query: new URLSearchParams() };
}

// ---------- sign in
function loginView(msg = '') {
  document.title = 'Inloggen · Campo desk';
  app.innerHTML = `<div class="login">
    <form id="login" novalidate>
      <a class="wm" href="/" style="color:var(--forest)">${MARK}<b>CAMPO</b><i style="color:var(--leaf)">Desk</i></a>
      <h1>Campo desk</h1>
      <p class="lede">Waar elke bestelling is, wie wat krijgt en hoe het met elke kweker en klant gaat.</p>
      <label class="f">Naam<input type="text" name="naam" value="Jan" autocomplete="username"></label>
      <label class="f">Wachtwoord<input type="password" name="wachtwoord" autocomplete="current-password" autofocus></label>
      <p class="err" role="alert"${msg ? '' : ' hidden'}>${h(msg)}</p>
      <button class="btn btn-leaf" type="submit" style="min-height:44px">Inloggen</button>
      <a class="lnk small" href="/">Naar de website</a>
    </form>
    <div class="art"><p>De desk leest, vergelijkt en zet klaar. Jan beslist.</p><picture><source type="image/avif" srcset="/img/plant-760.avif 760w, /img/plant-1100.avif 1100w" sizes="40vw"><img src="/img/plant-760.webp" srcset="/img/plant-760.webp 760w, /img/plant-1100.webp 1100w" sizes="40vw" alt="" width="760" height="999"></picture></div>
  </div>`;
  document.getElementById('login').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, err = f.querySelector('.err');
    try {
      const r = await api('/login', { method: 'POST', body: { wachtwoord: f.wachtwoord.value, naam: f.naam.value } });
      me = { naam: r.naam };
      shell(); route();
    } catch (x) { err.hidden = false; err.textContent = x.message; f.wachtwoord.select(); }
  });
}

// ---------- the frame around every page
function shell() {
  app.innerHTML = `<header class="top">
      <a class="wm" href="#/vandaag">${MARK}<b>CAMPO</b><i>Desk</i></a>
      <div class="search"><input type="search" id="q" placeholder="Zoek kweker, klant, plant, bestelling of factuur" autocomplete="off" aria-label="Zoeken">${icon('search')}<div class="sres" id="sres" hidden></div></div>
      <div class="top-r"><span class="clock" id="clock"></span><span class="who">${h(me.naam)}</span><button class="btn btn-sm btn-line" data-act="logout">${icon('logout')}<span class="sr">Uitloggen</span></button></div>
    </header>
    <div class="shell">
      <aside class="rail"><nav aria-label="Desk">${NAV.map(([k, l, ic]) => `<a href="#/${k}" data-nav="${k}">${icon(ic)}<span>${l}</span>${k === 'inbox' || k === 'workflow' ? `<span class="pill-n" data-badge="${k}" hidden></span>` : ''}</a>`).join('')}</nav>
        <div class="sep"></div><p class="note">De desk leest, vergelijkt en zet klaar. Jan bestelt, keurt goed, betaalt en verstuurt.</p><p class="note"><a href="/">Naar de website</a></p></aside>
      <main id="main" tabindex="-1"></main>
    </div>
    <nav class="tabs-m" aria-label="Desk">${NAV.slice(0, 6).map(([k, l, ic]) => `<a href="#/${k}" data-nav="${k}">${icon(ic)}${l}${k === 'inbox' || k === 'workflow' ? `<span class="pill-n" data-badge="${k}" hidden></span>` : ''}</a>`).join('')}</nav>`;
  tick(); setInterval(tick, 15000);
  setupSearch();
  updateBadges();
}
function tick() { const c = document.getElementById('clock'); if (c) c.textContent = fTime(new Date()); }
async function updateBadges() {
  try {
    const d = await api('/workflow');
    badge.inbox = d.inbox.length;
    badge.werk = d.aanbod.filter(c => c.stap === 'aanbod' || c.stap === 'bellen').length;
    for (const el of document.querySelectorAll('[data-badge]')) {
      const n = el.dataset.badge === 'inbox' ? badge.inbox : badge.werk;
      el.hidden = !n; el.textContent = n;
      el.classList.toggle('bad', el.dataset.badge === 'inbox' && d.inbox.some(b => b.status === 'fout'));
    }
  } catch { /* quiet */ }
}

let current = null, timer = null, soon = null, seq = 0;
async function route({ keepScroll = false } = {}) {
  if (!me) return;
  const { r, params, query } = parse();
  const main = document.getElementById('main');
  document.querySelectorAll('[data-nav]').forEach(a => { if (a.dataset.nav === r.nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const changed = !current || current.r !== r || JSON.stringify(current.params) !== JSON.stringify(params);
  current = { r, params, query };
  const my = ++seq;
  if (changed && !keepScroll) main.innerHTML = '<p class="loading"><span class="spin"></span> Laden…</p>';
  const y = window.scrollY;
  try {
    const html = await r.view(params, query);
    if (my !== seq) return;
    main.innerHTML = html;
    document.title = `${r.title} · Campo desk`;
    if (r.mount) r.mount(ctx);
    if (changed && !keepScroll) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); } else window.scrollTo(0, y);
  } catch (e) {
    if (my !== seq) return;
    if (e.status === 401) return;
    main.innerHTML = `<div class="page"><div class="warnbox">${icon('warn')}<span>${h(e.message)}</span></div><button class="btn btn-line" data-act="retry">Opnieuw proberen</button></div>`;
  }
  clearInterval(timer);
  if (r.every) timer = setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]') && !document.activeElement?.matches('textarea,input,select')) route({ keepScroll: true }); }, r.every);
}

const ctx = {
  refresh: () => { updateBadges(); return route({ keepScroll: true }); },
  refreshSoon: () => { clearTimeout(soon); soon = setTimeout(async () => { const el = document.activeElement, pos = el && el.selectionStart; await route({ keepScroll: true }); const again = el && el.dataset && el.dataset.input ? document.querySelector(`[data-input="${el.dataset.input}"]`) : null; if (again) { again.focus(); if (pos != null) again.setSelectionRange(pos, pos); } }, 220); },
  showMessage(m) {
    const wa = m.whatsapp ? waLink(m.whatsapp, m.tekst) : null, ml = m.email ? mailLink(m.email, m.onderwerp, m.tekst) : null;
    dialog({ title: `Bericht aan ${m.klant}`, ok: 'Kopieer', cancel: 'Sluiten', body: `<textarea name="tekst" style="min-height:200px">${h(m.tekst)}</textarea><p style="display:flex;gap:8px;flex-wrap:wrap">${wa ? `<a class="btn btn-sm btn-leaf" target="_blank" rel="noopener" href="${h(wa)}">${icon('chat')}Open in WhatsApp</a>` : ''}${ml ? `<a class="btn btn-sm btn-line" href="${h(ml)}">${icon('mail')}Open in mail</a>` : ''}</p>`, onOk: async v => copy(v.tekst) });
  },
};

// ---------- search everywhere
function setupSearch() {
  const q = document.getElementById('q'), box = document.getElementById('sres');
  let t = null;
  const go = { kweker: id => `#/kweker/${id}`, klant: id => `#/klant/${id}`, plant: id => `#/plant/${id}`, factuur: id => `#/factuur/${id}`, order: id => `#/klant/${id}`, aanbod: id => `#/aanbod/${id}` };
  q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      if (q.value.trim().length < 2) { box.hidden = true; return; }
      const r = await api(`/zoek?q=${encodeURIComponent(q.value.trim())}`).catch(() => []);
      box.innerHTML = r.length ? r.map(x => `<a href="${go[x.soort](x.id)}"><span>${h(x.titel)}</span><small>${h(x.soort)}${x.sub ? ` · ${h(x.sub)}` : ''}</small></a>`).join('') : '<p class="faint small" style="padding:8px">Niets gevonden.</p>';
      box.hidden = false;
    }, 180);
  });
  q.addEventListener('keydown', e => { if (e.key === 'Escape') { box.hidden = true; q.blur(); } if (e.key === 'Enter') { const a = box.querySelector('a'); if (a) { location.hash = a.getAttribute('href'); box.hidden = true; q.value = ''; } } });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) box.hidden = true; else if (e.target.closest('.sres a')) { box.hidden = true; q.value = ''; } });
}

// ---------- one listener for every button with data-act
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (a && !a.getAttribute('href').startsWith('#/') && a.getAttribute('href').length > 1) {
    const el = document.getElementById(a.getAttribute('href').slice(1));
    if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    return;
  }
  const row = e.target.closest('tr[data-href]');
  if (row && !e.target.closest('a,button,input,select,textarea')) { location.hash = row.dataset.href; return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  const act = el.dataset.act;
  if (act === 'logout') { e.preventDefault(); api('/logout', { method: 'POST', body: {} }).finally(() => { me = null; loginView(); }); return; }
  if (act === 'retry') { route(); return; }
  if (act === 'chart-table') { const t = el.closest('.chart').querySelector('table'); t.hidden = !t.hidden; el.textContent = t.hidden ? 'Als tabel' : 'Verberg tabel'; return; }
  const fn = current && current.r.actions && current.r.actions[act];
  if (!fn) return;
  const out = fn(el, ctx, e);
  if (out === 'default') return;
  e.preventDefault();
  if (out && out.catch) out.catch(err => { toast(err.message); el.disabled = false; });
});
document.addEventListener('change', e => { if (current && current.r.change) current.r.change(e, ctx); });
document.addEventListener('input', e => { if (current && current.r.input) current.r.input(e, ctx); });
window.addEventListener('hashchange', () => route());
window.addEventListener('campo:logout', () => { me = null; clearInterval(timer); loginView('Je sessie is verlopen. Log opnieuw in.'); });
chartEvents(document);

(async function start() {
  try {
    const s = await api('/status');
    if (!s.inloggen) { app.innerHTML = `<div class="page" style="padding:40px"><h1 style="font:600 36px var(--serif);color:var(--forest)">Campo desk</h1><p style="margin-top:12px;max-width:60ch">Inloggen is nog niet ingesteld. Zet <code>DESK_PASSWORD</code> in Railway onder Variables en herstart de dienst.</p><p style="margin-top:12px"><a href="/">Naar de website</a></p></div>`; return; }
    if (!s.ingelogd) return loginView();
    me = await api('/me');
    shell(); route();
  } catch (e) { app.innerHTML = `<p class="boot">${h(e.message)}</p>`; }
})();
