// Inkoop (Thursday and Friday): every order from a supplier on its way to the loods in Nootdorp, and to which customers it
// goes. One lane per order: the supplier, the flight to Nootdorp with its light, the loods, and the customers it fans out to.
// A click opens the whole order: the shipping papers next to what the desk read, the sizes and numbers, the purchase order
// for Exact, the route and to whom it goes.
import { api, h, icon, fNum } from '../core.js';
import { weekNav, dLong, dayTime, tTime, delta, fUsd, fUsdUnit } from '../wk.js';
import { routeStrip, reasons, toWhom, exactBox, doubts, partijActions, noticeDialog, DOC } from '../partij.js';
import { paperHtml, drawPapers } from '../paper.js';

let last = null, seenP = null;
const open = new Set();       // the orders Jan opened stay open when the page refreshes
const docSel = new Map();     // which paper is shown per order
const ROW = 28, FORK = 64, MAXK = 6;
const TONE = { groen: ['ok', 'Op schema'], oranje: ['wait', 'Let op'], rood: ['bad', 'In gevaar'], binnen: ['done', 'Binnen'] };
const TZ = 'Europe/Amsterdam';
const WD = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'long' });
const wd = v => WD.format(new Date(v)).replace('.', '');
const dayName = v => DAY.format(new Date(v));
const short = n => String(n || '').replace(/ (S\.A\.|B\.V\.|GmbH|Ltd)$/, '');
const sum = (a, f) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const cities = (route, plekken) => [...route.map(c => plekken[c]?.stad || c), 'Nootdorp'].join(' → ');

// where the order is on its way to Nootdorp
function track(p) {
  const r = p.risico || {}, tone = (TONE[r.licht] || TONE.groen)[0];
  if (r.licht === 'binnen') return { s: 'binnen', pct: 100, tone: 'ok', label: `binnen ${wd(r.binnen || p.binnen_op)}` };
  if (p.stage === 'verzonden') {
    // the plane between the first and the last airport, then the wait at Schiphol and the truck to Nootdorp
    const a = +new Date(r.vertrek), b = +new Date(r.verwacht), now = Date.now();
    const ams = (r.stops || []).find(x => x.soort === 'aankomst'), landed = ams ? +new Date(`${ams.dag}T09:00:00`) : a + 18 * 3600e3;
    const f = (x, y) => Math.max(0, Math.min(1, (now - x) / Math.max(1, y - x)));
    const air = now < landed, pct = air ? 18 + 64 * f(a, landed) : 82 + 16 * f(landed, b);
    const late = r.vertraging ? ` <span class="lt t-${tone === 'bad' ? 'bad' : 'wait'}">+${r.vertraging} u</span>` : '';
    return { s: 'onderweg', pct, tone, air, label: air ? `${wd(r.verwacht)} in de loods${late}` : `op Schiphol, ${wd(r.verwacht)} in de loods${late}` };
  }
  if (p.stage === 'bevestigd') return { s: 'gepland', pct: 0, tone, label: `vliegt ${dayName(r.vertrek)}` };
  return { s: 'gepland', pct: 0, tone, label: 'wacht op de bevestiging' };
}

function progress(p, d) {
  if (p.stage === 'binnen') { const ks = p.stroom?.klanten || []; return d.geteld ? (ks.length && ks.every(k => k.pakbon) ? 100 : 92) : 85; }
  if (p.stage === 'verzonden') return Math.round(55 + 0.25 * track(p).pct);
  return p.stage === 'bevestigd' ? 35 : 15;
}

function stageText(p, d) {
  const r = p.risico || {}, st = p.stroom, n = st ? st.klanten.length : 0;
  const where = p.stage === 'binnen' ? `Binnen ${dayTime(r.binnen || p.binnen_op)}${d.geteld ? ', geteld' : ', nog tellen'}`
    : p.stage === 'verzonden' ? `In de lucht sinds ${dayTime(p.verzonden_op)} via ${cities(p.route, d.plekken)}`
      : p.stage === 'bevestigd' ? `Bevestigd ${dayTime(p.bevestigd_op)}, vliegt ${dayName(r.vertrek)}`
        : `Besteld ${dayTime(p.besteld_op)}, de bevestiging komt donderdag`;
  return `${where}; ${n ? `naar ${n} ${n === 1 ? 'klant' : 'klanten'}` : 'nog geen klant'}${st && st.rest ? `, ${st.rest} vrij` : ''}`;
}

// one order: supplier → flight to Nootdorp → loods → customers. Also drawn, without the click, on the supplier's page.
export function laneHtml(p, d, { interactive = true } = {}) {
  const r = p.risico || {}, st = p.stroom || { klanten: [], rest: 0 }, tr = track(p), isOpen = interactive && open.has(p.id);
  const [tone, word] = TONE[r.licht] || ['ok', 'Op schema'];
  const ks = st.klanten.slice(0, MAXK), others = st.klanten.slice(MAXK);
  const rows = ks.map(k => ({ k }));
  if (others.length) rows.push({ andere: others.length, dozen: sum(others, k => k.dozen), kort: sum(others, k => k.tekort || 0), klaar: others.every(k => k.pakbon) });
  if (st.rest > 0) rows.push({ vrij: st.rest });
  if (!rows.length) rows.push({ leeg: true });
  const n = rows.length, H = Math.max(n * ROW, 58), top = (H - n * ROW) / 2, mid = H / 2;
  const counted = !!d.geteld;
  const curves = rows.map((x, i) => {
    const y = top + i * ROW + ROW / 2;
    const cls = x.k ? `${x.k.pakbon || counted ? 'go' : 'not'} t-${x.k.tekort ? 'wait' : 'ok'}` : x.vrij ? 'stock' : x.andere && (counted || x.klaar) ? 'go t-ok' : 'not';
    return `<path class="${cls}" d="M0 ${mid} H8 C ${FORK * 0.6} ${mid}, ${FORK * 0.4} ${y}, ${FORK} ${y}"/>`;
  }).join('');
  const row = x => {
    if (x.leeg) return '<li class="cust none"><span class="bl"></span><span class="cd"></span><span class="cn">Nog geen klant</span><span class="ct"></span></li>';
    if (x.vrij) return `<li class="cust stock"><span class="bl"></span><span class="cd"></span><span class="cn"><b>${fNum(x.vrij)}</b>&nbsp;vrij voor de loods</span><span class="ct"></span></li>`;
    if (x.andere) {
      const st2 = x.klaar ? 'afgeleverd' : counted ? 'onderweg' : null, kort = x.kort ? ` <span class="lt t-wait" title="Samen ${fNum(x.kort)} ${x.kort === 1 ? 'doos' : 'dozen'} minder dan gevraagd">−${fNum(x.kort)}</span>` : '';
      return `<li class="cust more ${st2 ? `t-ok s-${st2}` : 'none'}"><span class="bl" aria-hidden="true">${st2 ? '<i style="width:100%"></i>' : ''}</span><span class="cd" aria-hidden="true"></span><span class="cn">+ ${fNum(x.andere)} andere ${x.andere === 1 ? 'klant' : 'klanten'}</span><span class="ct">${x.klaar ? icon('check') : ''}${fNum(x.dozen)} dz${kort}</span></li>`;
    }
    const k = x.k, state = k.pakbon ? 'afgeleverd' : counted ? 'onderweg' : 'gepland';
    const title = `${k.pakbon ? `Pakbon ${k.pakbon} is akkoord` : counted ? 'Verdeeld na het tellen' : 'Voorstel uit de telefoonbestellingen'}${k.tekort ? `; van deze maten ${k.tekort} ${k.tekort === 1 ? 'doos' : 'dozen'} minder dan gevraagd` : ''}`;
    return `<li class="cust t-${k.tekort ? 'wait' : 'ok'} s-${state}" title="${h(title)}">
      <span class="bl" aria-hidden="true"><i style="width:${state === 'gepland' ? 0 : 100}%"></i></span><span class="cd" aria-hidden="true"></span>
      <a class="cn" href="#/klant/${k.id}"><b>${h(k.naam)}</b><span>${h(k.plaats || '')}</span></a>
      <span class="ct">${k.pakbon ? icon('check') : ''}${fNum(k.dozen)} dz${k.tekort ? ` <span class="lt t-wait">−${fNum(k.tekort)}</span>` : ''}</span></li>`;
  };
  const stops = (r.stops || []).filter(s => s.code && s.code !== 'NTD');
  const ticks = stops.map((s, i) => `<span class="ap${s.voorbij ? ' done' : ''}" data-l="${h(s.licht)}" style="left:${stops.length > 1 ? 18 + (64 * i) / (stops.length - 1) : 50}%" title="${h(`${s.stad} (${s.code})`)}"><i></i><b>${h(s.code)}</b></span>`).join('');
  const pr = progress(p, d), maten = p.regels.length;
  const label = `${p.leverancier}, ${p.nummer}: ${fNum(p.dozen)} dozen naar ${st.klanten.length} klanten. ${word}${r.licht === 'oranje' || r.licht === 'rood' ? `: ${r.kop}` : ''}. Klik voor de hele bestelling.`;
  return `<article class="lane t-${tone}${isOpen ? ' is-open' : ''}"${interactive ? ` id="p${p.id}"` : ''}>
    <div class="lane-top">
      ${interactive ? `<button type="button" class="lane-link" data-act="lane" data-p="${p.id}" aria-expanded="${isOpen}" aria-controls="more${p.id}" aria-label="${h(label)}"></button>` : ''}
      <div class="ln" style="--h:${H}px">
        <div class="gr"><b>${h(short(p.leverancier))}</b><span>${h([p.lev_plaats, p.nummer].filter(Boolean).join(' · '))}</span><span>${fNum(p.dozen)} dozen, ${maten} ${maten === 1 ? 'maat' : 'maten'}</span></div>
        <div class="in s-${tr.s} t-${tr.tone}" style="--p:${tr.pct}%"><span class="tk" aria-hidden="true"><i></i>${tr.s === 'onderweg' ? `<span class="truck">${icon(tr.air ? 'plane' : 'truck')}</span>` : ''}</span>${ticks}<span class="il">${tr.label}</span></div>
        <div class="hub${tr.s === 'binnen' ? ' on' : ''}" aria-hidden="true"><span>${icon('shed')}</span><em>Campo</em></div>
        <svg class="fork" viewBox="0 0 ${FORK} ${H}" width="${FORK}" height="${H}" aria-hidden="true" focusable="false">${curves}</svg>
        <ul class="custs" style="padding-top:${top}px">${rows.map(row).join('')}</ul>
      </div>
      <div class="ft">
        <span class="pbar" role="img" aria-label="${pr}% van de week"><i style="width:${pr}%"></i></span><b class="pct">${pr}%</b>
        <span class="stg">${h(stageText(p, d))}</span>
        <span class="st t-${tone}"><i aria-hidden="true"></i>${word}</span>
      </div>
      ${r.licht === 'oranje' || r.licht === 'rood' ? `<p class="why t-${tone}">${icon(r.licht === 'rood' ? 'warn' : 'clock')}<span>${h(r.kop)}</span></p>` : ''}
    </div>
    ${interactive ? `<div class="lane-more" id="more${p.id}"${isOpen ? ' data-hold' : ' hidden'}>${isOpen ? more(p, d) : ''}</div>` : ''}
  </article>`;
}

// ---------------------------------------------------------------- the whole order
function preview(doc) {
  if (!doc) return '<p class="empty">Nog geen papieren voor deze bestelling. De bevestiging komt donderdag, het verzendbewijs vrijdag.</p>';
  if (doc.bestand_id) return `${paperHtml(doc.bestand_id, doc.titel || DOC[doc.soort], doc.mime)}
    <p class="small"><a class="lnk" href="/api/bestanden/${doc.bestand_id}" target="_blank" rel="noopener">Open het origineel apart</a> · ${h(doc.gelezen_door === 'ai' ? 'gelezen door de desk' : 'ingevoerd door Jan')}</p>`;
  return `<pre class="mailtxt">${h(doc.tekst || '')}</pre><p class="small faint">${h(doc.gelezen_door === 'ai' ? 'Gelezen door de desk.' : doc.gelezen_door === 'jan' ? 'Door Jan verstuurd of ingevoerd.' : '')}</p>`;
}

function lines(p) {
  const stuks = r => (r.verzonden ?? r.bevestigd ?? r.besteld ?? 0) * r.per_doos;
  return `<div class="tbwrap"><table class="tb om-t"><thead><tr><th>Maat</th><th class="r">Besteld</th><th class="r">Bevestigd</th><th class="r">Verzonden</th><th class="r">Prijs</th><th class="r">Bedrag</th><th></th></tr></thead><tbody>
    ${p.regels.map(r => `<tr class="${r.twijfel ? 'doubt' : ''}"><td><b>${h(r.product)} ${h(r.maat)}</b></td>
      <td class="r num" data-l="Besteld">${r.besteld == null ? '–' : fNum(r.besteld)}</td>
      <td class="r num" data-l="Bevestigd">${r.bevestigd == null ? '–' : fNum(r.bevestigd)}${delta(r.besteld, r.bevestigd)}</td>
      <td class="r num" data-l="Verzonden">${r.verzonden == null ? '–' : `<b>${fNum(r.verzonden)}</b>`}${delta(r.bevestigd ?? r.besteld, r.verzonden)}</td>
      <td class="r num" data-l="Prijs">${fUsdUnit(r.prijs_usd)}<small class="faint" style="display:block">${fNum(stuks(r))} st</small></td><td class="r num" data-l="Bedrag">${fUsd(stuks(r) * r.prijs_usd)}</td>
      <td class="r"><button type="button" class="btn btn-sm btn-ghost" data-act="line-edit" data-id="${r.id}" data-p="${p.id}" aria-label="${h(`${r.product} ${r.maat} aanpassen`)}">${icon('edit')}</button></td></tr>`).join('')}
  </tbody><tfoot><tr><td><b>Samen</b></td><td class="r num" data-l="Besteld">${fNum(sum(p.regels, r => r.besteld))}</td><td class="r num" data-l="Bevestigd">${p.bevestigd_op ? fNum(sum(p.regels, r => r.bevestigd)) : '–'}</td>
    <td class="r num" data-l="Verzonden">${p.verzonden_op ? `<b>${fNum(sum(p.regels, r => r.verzonden))}</b>` : '–'}</td><td class="r num" data-l="Stuks"><small class="faint">${fNum(sum(p.regels, stuks))} st</small></td><td class="r num" data-l="Bedrag">${fUsd(p.totaal_usd)}</td><td></td></tr></tfoot></table></div>`;
}

function more(p, d) {
  const def = p.docs.find(x => x.soort === 'verzendbewijs') || p.docs[p.docs.length - 1];
  const sel = docSel.get(p.id) ?? def?.id;
  const doc = p.docs.find(x => x.id === sel) || def;
  const manual = p.stage === 'besteld' ? `<button type="button" class="btn btn-sm btn-ghost" data-act="stage" data-id="${p.id}" data-stap="bevestigd">Bevestigd zonder papier</button>`
    : p.stage === 'bevestigd' ? `<button type="button" class="btn btn-sm btn-ghost" data-act="stage" data-id="${p.id}" data-stap="verzonden">Verzonden zonder papier</button>` : '';
  return `<div class="om">
      <div class="om-doc">
        <div class="om-tabs" role="tablist" aria-label="Papieren van ${h(p.nummer)}">${p.docs.map(x => `<button type="button" role="tab" aria-selected="${doc && x.id === doc.id}" data-act="om-doc" data-p="${p.id}" data-d="${x.id}">${icon(x.bestand_id ? 'file' : 'mail')}<span><b>${h(DOC[x.soort])}</b><small>${h(dayTime(x.ontvangen))}</small></span></button>`).join('')}
          <button type="button" class="om-add" data-act="doc-add" data-p="${p.id}" title="Pdf, foto of geplakte mail toevoegen">${icon('upload')}<span><b>Papier</b><small>toevoegen</small></span></button></div>
        <div class="om-view">${preview(doc)}</div>
      </div>
      <div class="om-info stack">
        ${doubts(p)}
        <div><h3 class="h3s">In deze bestelling</h3>${lines(p)}</div>
        ${exactBox(p)}
      </div>
    </div>
    <div class="om2">
      <div class="stack"><h3 class="h3s">Komt het maandag binnen</h3>${routeStrip(p.risico)}${reasons(p.risico, { doubt: !p.twijfels })}</div>
      <div><h3 class="h3s">Naar wie het gaat</h3>${toWhom(p)}</div>
    </div>
    <p class="om-f"><a class="btn btn-sm btn-line" href="#/leverancier/${p.leverancier_id}?maandag=${d.maandag}">${icon('file')}Leverancier, alle papieren en de Excel</a>
      <button type="button" class="btn btn-sm btn-ghost" data-act="route" data-p="${p.id}">Route wijzigen</button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="nummer" data-id="${p.id}" data-nr="${h(p.nummer)}">Zendnummer wijzigen</button>${manual}</p>`;
}

function sources(d) {
  const w = d.bronnen.weer, s = d.bronnen.storm;
  const n = d.bronnen.meldingen.filter(m => !m.tot || new Date(m.tot) > new Date()).length;
  const uses = ['de papieren', 'de route'];
  if (w.status === 'ok' || w.status === 'deels') uses.push(`het weer van MET Norway${w.op ? ` (${tTime(w.op)})` : ''}`);
  if (s.status === 'ok') uses.push(s.aantal ? `${s.aantal} actieve ${s.aantal === 1 ? 'storm' : 'stormen'} (NHC)` : 'de stormen van NHC');
  if (n) uses.push(`${n} ${n === 1 ? 'melding' : 'meldingen'}`);
  const away = [w.status === 'weg' || w.status === 'laden' ? 'het weer' : '', s.status === 'weg' || s.status === 'laden' ? 'de stormen' : ''].filter(Boolean);
  const list = uses.length > 1 ? `${uses.slice(0, -1).join(', ')} en ${uses[uses.length - 1]}` : uses[0];
  return `<p class="srcs-l small faint">${icon('globe')}<span>Het licht kijkt naar ${h(list)}.${away.length ? ` ${h(away.join(' en ').replace(/^h/, 'H').replace(/^d/, 'D'))} ${away.length === 1 ? 'is' : 'zijn'} nu niet bereikbaar.` : ''}</span></p>`;
}

export async function render(params, query) {
  const m = query.get('maandag');
  const d = await api(`/week/inkoop${m ? `?maandag=${m}` : ''}`);
  last = d;
  const want = Number(query.get('p'));
  if (want && seenP !== `${d.maandag}:${want}`) { open.add(want); seenP = `${d.maandag}:${want}`; }
  const ps = d.partijen.filter(p => p.stroom || p.regels.length);
  const att = ps.filter(p => ['rood', 'oranje'].includes(p.risico?.licht)).sort((a, b) => (a.risico.licht === 'rood' ? 0 : 1) - (b.risico.licht === 'rood' ? 0 : 1)), ok = ps.filter(p => !['rood', 'oranje', 'binnen'].includes(p.risico?.licht)), inn = ps.filter(p => p.risico?.licht === 'binnen');
  const count = k => ps.filter(p => p.risico?.licht === k).length;
  const w = d.stroom;
  const kl = w.klanten.filter(k => k.dozen > 0).length;
  return `<div class="page wk flowpage">
    <div class="ph"><div><p class="kick">Week ${d.week} · binnen ${h(dLong(d.maandag))}</p><h1>Inkoop</h1>
      <p>Elke bestelling op weg naar de loods, en naar welke klanten het gaat. Klik op een bestelling voor het verzendbewijs en alles erover.</p></div>
      <div class="acts">${weekNav('inkoop', d.maandag)}<button type="button" class="btn btn-line" data-act="melding">${icon('plus')}Melding over de route</button></div></div>
    ${d.vorige.length ? `<div class="warnbox wait">${icon('info')}<span>Nog niet in Exact van week ${d.vorige[0].week}: ${d.vorige.map(p => `<a href="#/inkoop?maandag=${p.maandag}&p=${p.id}">${h(p.nummer)}</a>`).join(', ')}.</span></div>` : ''}
    ${ps.length ? `<section class="flow-sec" aria-labelledby="h-flow">
      <header class="flow-h"><h2 id="h-flow">Van leverancier naar klant</h2>
        <p class="tally">${[['rood', 'bad', 'in gevaar'], ['oranje', 'wait', 'let op'], ['groen', 'ok', 'op schema'], ['binnen', 'done', 'binnen']].filter(([k]) => count(k)).map(([k, t, l]) => `<span class="st t-${t}"><i aria-hidden="true"></i>${count(k)} ${l}</span>`).join('')}</p></header>
      <p class="sumline">${fNum(w.in)} dozen naar de loods · ${fNum(w.uit)} naar ${fNum(kl)} klanten · ${w.teVeel ? `<b class="bad-t">${fNum(w.teVeel)} meer verdeeld dan er komt</b>` : w.rest ? `<b class="stock-t">${fNum(w.rest)} vrij voor de loods</b>` : '<b class="ok-t">netto nul</b>'}${w.kortKlanten ? ` · ${fNum(w.kortKlanten)} ${w.kortKlanten === 1 ? 'klant krijgt' : 'klanten krijgen'} minder dan gevraagd` : ''}</p>
      <div class="lane-cols" aria-hidden="true"><span>Leverancier</span><span>Naar Nootdorp</span><span>Loods</span><span></span><span>Naar de klant</span></div>
      ${att.length ? `<h3 class="grp">Let op</h3><div class="lanes">${att.map(p => laneHtml(p, d)).join('')}</div>` : ''}
      ${ok.length ? `<h3 class="grp">${att.length ? 'Op schema' : 'Alles loopt op schema'}</h3><div class="lanes">${ok.map(p => laneHtml(p, d)).join('')}</div>` : ''}
      ${inn.length ? `<h3 class="grp">Binnen</h3><div class="lanes">${inn.map(p => laneHtml(p, d)).join('')}</div>` : ''}
      ${sources(d)}
    </section>` : `<section class="panel"><p class="empty">Voor deze week is nog niets besteld. <a href="#/bestellen?maandag=${d.maandag}">Naar bestellen</a></p></section>`}
  </div>`;
}

export function mount() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const el = q.get('p') && document.getElementById(`p${q.get('p')}`);
  if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 30);
  drawPapers(document);
}
export const refreshEvery = 60000;

const P = id => last.partijen.find(p => p.id === Number(id));
function show(id, on) {
  const box = document.getElementById(`more${id}`), btn = document.querySelector(`button.lane-link[data-p="${id}"]`), art = document.getElementById(`p${id}`);
  if (!box) return null;
  if (on) { open.add(id); box.innerHTML = more(P(id), last); box.hidden = false; box.setAttribute('data-hold', ''); drawPapers(box); } else { open.delete(id); box.hidden = true; box.innerHTML = ''; box.removeAttribute('data-hold'); }
  if (btn) btn.setAttribute('aria-expanded', String(on));
  if (art) art.classList.toggle('is-open', on);
  return box;
}

export const actions = {
  ...partijActions(P),
  // a click on an order opens all of it; a customer's name still goes to the customer
  lane: (el, ctx, e) => {
    if (e && e.target.closest('a')) return 'default';
    const id = Number(el.dataset.p), on = !open.has(id);
    show(id, on);
    if (on) setTimeout(() => document.getElementById(`p${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);
  },
  'om-doc': el => { docSel.set(Number(el.dataset.p), Number(el.dataset.d)); show(Number(el.dataset.p), true); },
  melding: (el, ctx) => noticeDialog(ctx, { plekken: last.plekken }),
};
