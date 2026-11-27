// Campo desk: the shell, sign-in, menu, search and the router.
import { api, h, icon, MARK, toast, dialog, waLink, mailLink, copy, fTime } from './core.js';
import { chartEvents } from './charts.js';
import * as week from './views/week.js';
import * as bestellen from './views/bestellen.js';
import * as inkoop from './views/inkoop.js';
import * as maandag from './views/maandag.js';
import * as pakbonnen from './views/pakbonnen.js';
import * as klanten from './views/klanten.js';
import * as relaties from './views/relaties.js';
import * as leverancier from './views/leverancier.js';
import * as jaar from './views/jaar.js';
import * as koppelingen from './views/koppelingen.js';
import * as uitleg from './views/uitleg.js';

const app = document.getElementById('app');
let me = null, badge = { inkoop: 0, pakbonnen: 0 };

// the desk follows Jan's week: Tuesday order, Thursday and Friday the papers, Monday the hall and the packing slips
const ROUTES = [
  { re: /^week$/, nav: 'week', title: 'Deze week', view: week.render, actions: week.actions, every: week.refreshEvery },
  { re: /^bestellen$/, nav: 'bestellen', title: 'Bestellen', view: bestellen.render, actions: bestellen.actions, mount: bestellen.mount, change: bestellen.onChange },
  { re: /^inkoop$/, nav: 'inkoop', title: 'Inkoop', view: inkoop.render, actions: inkoop.actions, mount: inkoop.mount, every: inkoop.refreshEvery },
  { re: /^maandag$/, nav: 'maandag', title: 'Maandag', view: maandag.render, actions: maandag.actions, mount: maandag.mount, change: maandag.onChange },
  { re: /^pakbonnen$/, nav: 'pakbonnen', title: 'Pakbon en factuur', view: pakbonnen.render, actions: pakbonnen.actions },
  { re: /^pakbon\/(\d+)$/, keys: ['klant'], nav: 'pakbonnen', title: 'Pakbon', view: pakbonnen.renderOne, actions: pakbonnen.actions },
  { re: /^relaties$/, nav: 'relaties', title: 'Relaties', view: relaties.render, actions: relaties.actions, input: relaties.onInput },
  { re: /^klanten$/, nav: 'relaties', title: 'Relaties', view: relaties.render, actions: relaties.actions, input: relaties.onInput },
  { re: /^klant\/(\d+)$/, keys: ['id'], nav: 'relaties', title: 'Klant', view: klanten.renderDetail, actions: klanten.detailActions, mount: klanten.mountDetail },
  { re: /^leverancier\/(\d+)$/, keys: ['id'], nav: 'relaties', title: 'Leverancier', view: leverancier.render, actions: leverancier.actions },
  { re: /^jaar$/, nav: 'jaar', title: 'Jaar en Excel', view: jaar.render, actions: jaar.actions },
  { re: /^koppelingen$/, nav: 'koppelingen', title: 'Koppelingen', view: koppelingen.render, actions: koppelingen.actions, change: koppelingen.onChange, mount: koppelingen.mount },
  { re: /^uitleg$/, nav: 'uitleg', title: 'Zo werkt het', view: uitleg.render, actions: uitleg.actions },
];
// key, label, icon, short label on phones, the day it belongs to
const NAV = [
  ['week', 'Deze week', 'today', 'Week'], ['bestellen', 'Bestellen', 'phone', 'Bestel', 'di'], ['inkoop', 'Inkoop', 'in', 'Inkoop', 'do–vr'],
  ['maandag', 'Maandag', 'shed', 'Maandag', 'ma'], ['pakbonnen', 'Pakbonnen', 'file', 'Pakbon', 'ma'], ['relaties', 'Relaties', 'rel', 'Relaties'], ['jaar', 'Jaar en Excel', 'db', 'Jaar'],
];
const NAV2 = [['koppelingen', 'Koppelingen', 'plug'], ['uitleg', 'Zo werkt het', 'book']];

function parse() {
  const raw = location.hash.replace(/^#\/?/, '') || 'week';
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
      <p class="lede">De hele week op één plek: bestellen, de verzendbewijzen, maandag in de hal en de pakbon met factuur.</p>
      <label class="f">Naam<input type="text" name="naam" value="Jan" autocomplete="username"></label>
      <label class="f">Wachtwoord<input type="password" name="wachtwoord" autocomplete="current-password" autofocus></label>
      <p class="err" role="alert"${msg ? '' : ' hidden'}>${h(msg)}</p>
      <button class="btn btn-leaf" type="submit" style="min-height:44px">Inloggen</button>
      <a class="lnk small" href="/">Naar de website</a>
    </form>
    <div class="art"><p>De desk leest, vergelijkt en zet klaar. Jan beslist.</p><picture><source type="image/avif" srcset="/img/kiem-480.avif 480w, /img/kiem-760.avif 760w" sizes="380px"><img src="/img/kiem-480.webp" srcset="/img/kiem-480.webp 480w, /img/kiem-760.webp 760w" sizes="380px" alt="" width="1100" height="1400"></picture></div>
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
      <a class="wm" href="#/week">${MARK}<b>CAMPO</b><i>Desk</i></a>
      <div class="search"><input type="search" id="q" placeholder="Zoek klant, zendnummer of factuur" autocomplete="off" aria-label="Zoeken">${icon('search')}<div class="sres" id="sres" hidden></div></div>
      <div class="top-r"><span class="clock" id="clock"></span><span class="who">${h(me.naam)}</span><button class="btn btn-sm btn-line" data-act="logout">${icon('logout')}<span class="sr">Uitloggen</span></button></div>
    </header>
    <div class="shell">
      <aside class="rail"><nav aria-label="Desk">${NAV.map(([k, l, ic, , dag]) => `<a href="#/${k}" data-nav="${k}">${icon(ic)}<span>${l}</span>${k === 'inkoop' || k === 'pakbonnen' ? `<span class="pill-n" data-badge="${k}" hidden></span>` : ''}${dag ? `<small class="dag">${dag}</small>` : ''}</a>`).join('')}</nav>
        <div class="sep"></div><nav aria-label="Meer">${NAV2.map(([k, l, ic]) => `<a href="#/${k}" data-nav="${k}">${icon(ic)}<span>${l}</span></a>`).join('')}</nav>
        <div class="sep"></div><p class="note">De desk leest, telt, verdeelt en zet klaar. Jan bestelt, keurt goed en verstuurt.</p><p class="note"><a href="/">Naar de website</a></p></aside>
      <main id="main" tabindex="-1"></main>
    </div>
    <nav class="tabs-m" aria-label="Desk">${NAV.map(([k, l, ic, short]) => `<a href="#/${k}" data-nav="${k}">${icon(ic)}${short || l}${k === 'inkoop' || k === 'pakbonnen' ? `<span class="pill-n" data-badge="${k}" hidden></span>` : ''}</a>`).join('')}</nav>`;
  tick(); setInterval(tick, 15000);
  setupSearch();
  updateBadges();
}
function tick() { const c = document.getElementById('clock'); if (c) c.textContent = fTime(new Date()); }
async function updateBadges() {
  try {
    badge = await api('/week/badges');
    for (const el of document.querySelectorAll('[data-badge]')) { const n = badge[el.dataset.badge] || 0; el.hidden = !n; el.textContent = n; }
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
    // ?deel=koers opens the page at that part
    const deel = query.get('deel');
    if (deel && changed && !keepScroll) setTimeout(() => document.getElementById(deel)?.scrollIntoView({ block: 'start' }), 30);
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
  const go = {
    klant: id => `#/klant/${id}`, leverancier: id => `#/leverancier/${id}`, product: () => '#/jaar',
    partij: id => { const [m, p] = String(id).split('#p'); return `#/inkoop?maandag=${m}&p=${p}`; },
    pakbon: id => { const [m, k] = String(id).split(':'); return `#/pakbon/${k}?maandag=${m}`; },
  };
  q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      if (q.value.trim().length < 2) { box.hidden = true; return; }
      const r = await api(`/week/zoek?q=${encodeURIComponent(q.value.trim())}`).catch(() => []);
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
