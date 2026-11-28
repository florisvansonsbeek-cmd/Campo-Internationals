// Overzicht (the Inkoop tab): the goods of one week, in two views behind one big switch, with on top what has no
// destination yet.
// Leverancier → loods: one lane per order. The supplier, the route to Nootdorp with every stop and its time on the line,
//   the loods, and the customers it fans out to. A click opens the whole order: the shipping papers next to what the desk
//   read, the sizes and numbers, the purchase order for Exact and to whom it goes.
// Loods → klant: the other way round, arranged per batch: every region has its own batch number each week (264901
//   Costa Rica, 264902 Guatemala). Under each batch one lane per customer: which suppliers of that batch bring what, the
//   steps on Monday (counted, packing slip, mail, Exact) on the line, and the customer. A click opens the packing slip that
//   is also the invoice, with the plant passport, exactly as on the Pakbonnen tab, and where every box came from.
import { api, h, icon, fNum } from '../core.js';
import { weekNav, dayTime, tTime, delta, fUsd, fUsdUnit } from '../wk.js';
import { reasons, toWhom, exactBox, doubts, partijActions, noticeDialog, DOC } from '../partij.js';
import { paperHtml, drawPapers } from '../paper.js';
import { slipPaper, slipNext, slipActions } from '../slip.js';

let last = null, seenP = null, seenK = null, kant = 'lev';
const open = new Set();       // the orders Jan opened stay open when the page refreshes
const openK = new Set();      // the same for customers, per batch (klant-batch)
const docSel = new Map();     // which paper is shown per order
const slips = new Map();      // the packing slip per customer, for the open ones
// compact: four customers per order, the rest in one line; an order that is in shows two
const ROW = 24, FORK = 56, MAXK = 4, MAXK_IN = 2, MAXS = 5;
// in the loods is green: Jan ticks a shipment off on Maandag and it turns green here
const TONE = { groen: ['ok', 'Op schema'], oranje: ['wait', 'Let op'], rood: ['bad', 'In gevaar'], binnen: ['in', 'Binnen'] };
const TZ = 'Europe/Amsterdam';
const WD = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit' });
const DD = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'short', day: 'numeric' });
const DAY = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'long' });
const wd = v => WD.format(new Date(v)).replace('.', '');
const dd = s => DD.format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? `${s}T12:00:00` : s)).replace('.', '');
const dayName = v => DAY.format(new Date(v));
const short = n => String(n || '').replace(/ (S\.A\.|B\.V\.|GmbH|Ltd)$/, '');
const sum = (a, f) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const P = id => last.partijen.find(p => p.id === Number(id));
const K = id => last.klanten.find(k => k.id === Number(id));

// ================================================================ from the supplier to the loods
// where the order is on its way to Nootdorp: 0 at the farm, the airports from 30 to 80, the loods at the end
function track(p) {
  const r = p.risico || {}, tone = (TONE[r.licht] || TONE.groen)[0];
  if (r.licht === 'binnen') return { s: 'binnen', pct: 100, tone: 'ok' };
  if (p.stage === 'verzonden') {
    // the plane between the first and the last airport, then the wait at Schiphol and the truck to Nootdorp
    const a = +new Date(r.vertrek), b = +new Date(r.verwacht), now = Date.now();
    const ams = (r.stops || []).find(x => x.soort === 'aankomst'), landed = ams ? +new Date(`${ams.dag}T09:00:00`) : a + 18 * 3600e3;
    const f = (x, y) => Math.max(0, Math.min(1, (now - x) / Math.max(1, y - x)));
    const air = now < landed;
    return { s: 'onderweg', pct: air ? 30 + 50 * f(a, landed) : 80 + 18 * f(landed, b), tone, air };
  }
  return { s: 'gepland', pct: 0, tone };
}

function stageText(p) {
  const r = p.risico || {};
  return p.stage === 'binnen' ? `In de loods sinds ${dayTime(r.binnen || p.binnen_op)}`
    : p.stage === 'verzonden' ? `In de lucht sinds ${dayTime(p.verzonden_op)}`
      : p.stage === 'bevestigd' ? `Bevestigd, vliegt ${dayName(r.vertrek)}`
        : 'Besteld, de bevestiging komt donderdag';
}

// the route on the line itself: the farm, every airport with its day or time, and the time in the loods at the hub
function routeOnLine(p) {
  const r = p.risico || {}, stops = r.stops || [];
  const farm = stops.find(s => s.soort === 'herkomst'), air = stops.filter(s => s.code && s.soort !== 'loods');
  // once it is in the loods, every stop on the way is behind it
  const past = s => r.licht === 'binnen' || s.voorbij;
  const when = s => (s.soort === 'vertrek' && past(s) && r.vertrek ? wd(r.vertrek) : dd(s.dag));
  const pos = i => (air.length > 1 ? 30 + (50 * i) / (air.length - 1) : 55);
  const arrive = r.licht === 'binnen' ? wd(r.binnen || p.binnen_op) : r.verwacht ? wd(r.verwacht) : '';
  const late = r.licht !== 'binnen' && r.vertraging ? r.vertraging : 0;
  const ticks = [
    farm ? `<span class="ap ap0${past(farm) ? ' done' : ''}" data-l="${h(r.licht === 'binnen' ? '' : farm.licht)}"><b>kwekerij</b><em>${h(dd(farm.dag))}</em></span>` : '',
    ...air.map((s, i) => `<span class="ap${past(s) ? ' done' : ''}" data-l="${h(r.licht === 'binnen' ? '' : s.licht)}" style="left:${pos(i)}%"><i></i><b>${h(s.code)}</b><em>${h(when(s))}</em></span>`),
  ].join('');
  const parts = [...(farm ? [{ t: `${farm.stad || 'kwekerij'} ${dd(farm.dag)}`, l: farm.licht }] : []), ...air.map(s => ({ t: `${s.code} ${when(s)}`, l: s.licht }))];
  const mobile = parts.map(x => `<span data-l="${h(x.l || '')}">${h(x.t)}</span>`).join('<i aria-hidden="true">→</i>');
  const title = [farm ? `Kwekerij ${farm.stad || ''} ${dd(farm.dag)}` : '', ...air.map(s => `${s.stad} (${s.code}) ${when(s)}`), `loods ${arrive}`].filter(Boolean).join(' → ');
  return { ticks, arrive, late, mobile, title };
}

// one order: supplier → route to Nootdorp → loods → customers. Also drawn, without the click, on the supplier's page.
export function laneHtml(p, d, { interactive = true } = {}) {
  const r = p.risico || {}, st = p.stroom || { klanten: [], rest: 0 }, tr = track(p), isOpen = interactive && open.has(p.id);
  const [tone, word] = TONE[r.licht] || ['ok', 'Op schema'];
  const max = r.licht === 'binnen' ? MAXK_IN : MAXK;
  const ks = st.klanten.slice(0, max), others = st.klanten.slice(max);
  const rows = ks.map(k => ({ k }));
  if (others.length) rows.push({ andere: others.length, dozen: sum(others, k => k.dozen), kort: sum(others, k => k.tekort || 0), klaar: others.every(k => k.pakbon) });
  if (st.rest > 0) rows.push({ vrij: st.rest });
  if (!rows.length) rows.push({ leeg: true });
  const n = rows.length, H = Math.max(n * ROW, 56), top = (H - n * ROW) / 2, mid = H / 2;
  const counted = !!d.geteld || p.stage === 'binnen';
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
      ${interactive ? `<span class="cn"><b>${h(k.naam)}</b><span>${h(k.plaats || '')}</span></span>` : `<a class="cn" href="#/klant/${k.id}"><b>${h(k.naam)}</b><span>${h(k.plaats || '')}</span></a>`}
      <span class="ct">${k.pakbon ? icon('check') : ''}${fNum(k.dozen)} dz${k.tekort ? ` <span class="lt t-wait">−${fNum(k.tekort)}</span>` : ''}</span></li>`;
  };
  const rt = routeOnLine(p);
  const label = `${p.leverancier}, batch ${p.nummer}: ${fNum(p.dozen)} dozen naar ${st.klanten.length} klanten. ${rt.title}. ${word}${r.licht === 'oranje' || r.licht === 'rood' ? `: ${r.kop}` : ''}. Klik voor de hele bestelling.`;
  return `<article class="lane t-${tone}${isOpen ? ' is-open' : ''}"${interactive ? ` id="p${p.id}"` : ''}>
    <div class="lane-top">
      ${interactive ? `<button type="button" class="lane-link" data-act="lane" data-p="${p.id}" aria-expanded="${isOpen}" aria-controls="more${p.id}" aria-label="${h(label)}"></button>` : ''}
      <div class="ln" style="--h:${H}px">
        <div class="gr"><b>${h(short(p.leverancier))}</b><span>${h([p.nummer, p.lev_plaats].filter(Boolean).join(' · '))}</span><span>${fNum(p.dozen)} dozen</span></div>
        <div class="in s-${tr.s} t-${tr.tone}" style="--p:${tr.pct}%" title="${h(rt.title)}"><span class="tk" aria-hidden="true"><i></i>${tr.s === 'onderweg' ? `<span class="truck">${icon(tr.air ? 'plane' : 'truck')}</span>` : ''}</span>${rt.ticks}<span class="rtm">${rt.mobile}</span></div>
        <div class="hub${tr.s === 'binnen' ? ' on' : ''}" title="In de loods in Nootdorp"><span aria-hidden="true">${icon('shed')}</span><em class="${rt.late ? `t-${tone === 'bad' ? 'bad' : 'wait'}` : ''}">${h(rt.arrive)}${rt.late ? ` +${rt.late} u` : ''}</em></div>
        <svg class="fork" viewBox="0 0 ${FORK} ${H}" width="${FORK}" height="${H}" aria-hidden="true" focusable="false">${curves}</svg>
        <ul class="custs" style="padding-top:${top}px">${rows.map(row).join('')}</ul>
      </div>
      <div class="ft">
        <span class="stg">${h(stageText(p))}</span>
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
  const why = reasons(p.risico, { doubt: !p.twijfels });
  return `<div class="om">
      <div class="om-doc">
        <div class="om-tabs" role="tablist" aria-label="Papieren van ${h(p.leverancier)}">${p.docs.map(x => `<button type="button" role="tab" aria-selected="${doc && x.id === doc.id}" data-act="om-doc" data-p="${p.id}" data-d="${x.id}">${icon(x.bestand_id ? 'file' : 'mail')}<span><b>${h(DOC[x.soort])}</b><small>${h(dayTime(x.ontvangen))}</small></span></button>`).join('')}
          <button type="button" class="om-add" data-act="doc-add" data-p="${p.id}" title="Pdf, foto of geplakte mail toevoegen">${icon('upload')}<span><b>Papier</b><small>toevoegen</small></span></button></div>
        <div class="om-view">${preview(doc)}</div>
      </div>
      <div class="om-info stack">
        ${doubts(p)}
        <div><h3 class="h3s">In deze bestelling</h3>${lines(p)}</div>
        ${exactBox(p, d.exactKan)}
        ${why ? `<div><h3 class="h3s">Waarom dit licht</h3>${why}</div>` : ''}
      </div>
    </div>
    <div class="om3"><h3 class="h3s">Naar wie het gaat</h3>${toWhom(p)}</div>
    <p class="om-f"><a class="btn btn-sm btn-line" href="#/leverancier/${p.leverancier_id}?maandag=${d.maandag}">${icon('file')}Leverancier, alle papieren en de Excel</a>
      <button type="button" class="btn btn-sm btn-ghost" data-act="route" data-p="${p.id}">Route wijzigen</button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="nummer" data-id="${p.id}" data-nr="${h(p.nummer)}">Batchnummer wijzigen</button>${manual}</p>`;
}

// ================================================================ from the loods to the customer
const lightOf = v => P(v.partij_id)?.risico?.licht || 'groen';
const inHall = v => { const p = P(v.partij_id); return !!p && (p.stage === 'binnen' || last.geteld); };

// a customer is in danger when a shipment for him may not make it, and needs a look when he gets less or later;
// a doubt on a supplier's papers stays with that supplier (the dot on his line is orange)
const lateOf = v => (inHall(v) ? 0 : P(v.partij_id)?.risico?.vertraging || 0);
function customerTone(k) {
  if (k.slip?.status === 'akkoord') return ['done', k.slip.mail === 'verstuurd' ? 'Verstuurd' : 'Pakbon akkoord'];
  if (k.van.some(v => !inHall(v) && lightOf(v) === 'rood')) return ['bad', 'In gevaar'];
  if (k.tekort > 0) return ['wait', 'Krijgt minder'];
  if (k.van.some(v => lateOf(v) > 0)) return ['wait', 'Komt later'];
  if (k.slip?.gewijzigd) return ['wait', 'Let op'];
  if (!k.van.length) return ['wait', 'Krijgt niets'];
  if (k.van.every(inHall)) return ['in', 'In de loods'];
  return ['ok', 'Op schema'];
}

// Monday's steps between the loods and the customer: counted, the slip approved, mailed or given along, in Exact
function customerSteps(k, d) {
  const s = k.slip || {}, ok = s.status === 'akkoord';
  return [
    { k: 'geteld', on: !!d.geteld, t: d.geteld ? 'verdeeld' : 'voorstel' },
    { k: 'pakbon', on: ok, t: ok ? s.nummer : s.status === 'klaar' ? 'klaar' : s.status === 'wacht' ? 'wacht' : '–' },
    { k: 'factuur', on: ok && (s.mail === 'verstuurd' || s.gedrukt), t: !ok ? '–' : s.mail === 'verstuurd' ? 'verstuurd' : s.mail === 'in_outlook' ? 'in Outlook' : s.gedrukt ? 'meegegeven' : 'klaar' },
    { k: 'exact', on: ok && s.exact === 'in_exact', t: ok && s.exact === 'in_exact' ? 'erin' : '–' },
  ];
}

function customerText(k, d) {
  const s = k.slip;
  if (!k.van.length) return 'Krijgt deze week niets';
  if (s?.status === 'akkoord') {
    const how = s.mail === 'verstuurd' ? 'verstuurd' : s.mail === 'in_outlook' ? 'concept in Outlook' : s.gedrukt ? 'met de goederen meegegeven' : 'mail staat klaar';
    return `Pakbon ${s.nummer} · ${how}${s.exact === 'in_exact' ? ' · in Exact' : ''}`;
  }
  if (k.van.every(inHall)) return s?.status === 'klaar' ? 'In de loods · pakbon klaar' : 'In de loods';
  const eta = k.van.filter(v => !inHall(v)).map(v => P(v.partij_id)?.risico?.verwacht).filter(Boolean).sort().pop();
  return `Voorstel${eta ? ` · in de loods ${wd(eta)}` : ''}`;
}

function customerWhy(k) {
  if (k.slip?.status === 'akkoord') return null;
  const bad = k.van.find(v => !inHall(v) && lightOf(v) === 'rood');
  if (bad) return ['bad', `${short(bad.leverancier)} (${bad.nummer}): ${P(bad.partij_id).risico.kop}`];
  if (k.tekort > 0) {
    const list = k.kort.slice(0, 3).map(x => `${x.naam} ${x.maat} (vroeg ${x.gevraagd}, krijgt ${x.krijgt})`).join(', ');
    return ['wait', `Vroeg ${k.tekort} ${k.tekort === 1 ? 'doos' : 'dozen'} meer dan er komt: ${list}${k.kort.length > 3 ? ' …' : ''}`];
  }
  const late = k.van.find(v => lateOf(v) > 0);
  if (late) return ['wait', `${short(late.leverancier)} (${late.nummer}) komt later: ${P(late.partij_id).risico.aankomst}`];
  return null;
}

export function customerLaneHtml(k, d) {
  const key = k.nr ? `${k.id}-${k.nr}` : `${k.id}`, [tone, word] = customerTone(k), isOpen = openK.has(key);
  const vs = k.van.slice(0, MAXS), others = k.van.slice(MAXS);
  const rows = vs.map(v => ({ v }));
  if (others.length) rows.push({ andere: others.length, dozen: sum(others, v => v.dozen) });
  if (!rows.length) rows.push({ leeg: true });
  const n = rows.length, H = Math.max(n * ROW, 56), top = (H - n * ROW) / 2, mid = H / 2;
  const curves = rows.map((x, i) => {
    const y = top + i * ROW + ROW / 2;
    const l = x.v ? lightOf(x.v) : null, t = l === 'rood' ? 'bad' : l === 'oranje' ? 'wait' : 'ok';
    const cls = x.v ? `${inHall(x.v) ? 'go t-ok' : `not t-${t}`}` : x.andere && d.geteld ? 'go t-ok' : 'not';
    return `<path class="${cls}" d="M0 ${y} H6 C ${FORK * 0.6} ${y}, ${FORK * 0.4} ${mid}, ${FORK - 6} ${mid} H${FORK}"/>`;
  }).join('');
  const src = x => {
    if (x.leeg) return `<li class="kf none"><span class="sn"><span class="faint">Krijgt deze week niets${k.gevraagd ? ` (vroeg ${fNum(k.gevraagd)})` : ''}</span></span><span class="sd"></span><span class="cd"></span><span class="bl"></span></li>`;
    if (x.andere) return `<li class="kf more"><span class="sn">+ ${fNum(x.andere)} andere</span><span class="sd">${fNum(x.dozen)} dz</span><span class="cd"></span><span class="bl"></span></li>`;
    const v = x.v, l = lightOf(v), here = inHall(v), t = here ? 'ok' : l === 'rood' ? 'bad' : l === 'oranje' ? 'wait' : 'ok';
    const what = v.regels.map(r => `${fNum(r.dozen)} × ${r.naam} ${r.maat}`).join(', ');
    return `<li class="kf t-${t} ${here ? 's-in' : 's-weg'}" title="${h(`${v.leverancier}, batch ${v.nummer}: ${what}`)}">
      <span class="sn"><b>${h(short(v.leverancier))}</b>${k.nr ? '' : `<span>${h(v.nummer)}</span>`}</span>
      <span class="sd">${fNum(v.dozen)} dz</span><span class="cd" aria-hidden="true"></span><span class="bl" aria-hidden="true"><i style="width:${here ? 100 : 0}%"></i></span></li>`;
  };
  const steps = customerSteps(k, d), done = steps.filter(s => s.on).length;
  const POS = [16, 39, 62, 85];
  const fill = done ? (done === steps.length ? 100 : POS[done - 1]) : 0;
  const ticks = steps.map((s, i) => `<span class="ap${s.on ? ' done' : ''}" style="left:${POS[i]}%"><i></i><b>${s.k}</b><em>${h(s.t)}</em></span>`).join('');
  const pct = Math.round((done / steps.length) * 100);
  const why = customerWhy(k);
  const label = `${k.naam}: ${fNum(k.dozen)} dozen van ${k.van.length} ${k.van.length === 1 ? 'leverancier' : 'leveranciers'}. ${word}. Klik voor de pakbon met het plantenpaspoort.`;
  return `<article class="lane klane t-${tone}${isOpen ? ' is-open' : ''}" id="k${key}">
    <div class="lane-top">
      <button type="button" class="lane-link" data-act="klane" data-k="${k.id}" data-key="${key}" aria-expanded="${isOpen}" aria-controls="kmore${key}" aria-label="${h(label)}"></button>
      <div class="ln kn" style="--h:${H}px">
        <ul class="kfrom" style="padding-top:${top}px">${rows.map(src).join('')}</ul>
        <svg class="fork" viewBox="0 0 ${FORK} ${H}" width="${FORK}" height="${H}" aria-hidden="true" focusable="false">${curves}</svg>
        <div class="hub${d.geteld ? ' on' : ''}" title="De loods in Nootdorp"><span aria-hidden="true">${icon('shed')}</span><em>loods</em></div>
        <div class="in kout ${d.geteld ? 's-onderweg' : 's-gepland'} t-ok" style="--p:${fill}%"><span class="tk" aria-hidden="true"><i></i></span>${ticks}
          <span class="rtm">${steps.map(s => `<span class="${s.on ? 'on' : ''}">${s.k} ${h(s.t)}</span>`).join('<i aria-hidden="true">·</i>')}</span></div>
        <div class="kl"><span class="kn-n"><b>${h(k.naam)}</b></span><span>${h([k.plaats, k.land].filter(Boolean).join(' · '))}</span>
          <span class="kd"><b>${fNum(k.dozen)} dz</b>${k.tekort ? ` <span class="lt t-wait" title="Van deze maten ${fNum(k.tekort)} minder dan gevraagd">−${fNum(k.tekort)}</span>` : ''}</span></div>
      </div>
      <div class="ft">
        <span class="stg">${h(customerText(k, d))}</span>
        <span class="st t-${tone}"><i aria-hidden="true"></i>${word}</span>
      </div>
      ${why ? `<p class="why t-${why[0]}">${icon(why[0] === 'bad' ? 'warn' : 'clock')}<span>${h(why[1])}</span></p>` : ''}
    </div>
    <div class="lane-more" id="kmore${key}"${isOpen ? ' data-hold' : ' hidden'}>${isOpen ? customerMore(K(k.id), d) : ''}</div>
  </article>`;
}

// ---------------------------------------------------------------- the customer opened: packing slip, plant passport, where it came from
const slipKey = (m, id) => `${m}:${id}`;
async function loadSlip(id, m) {
  const x = await api(`/week/pakbonnen/klant/${id}?maandag=${m}`).catch(e => (e.status === 404 ? null : { fout: e.message }));
  slips.set(slipKey(m, id), x);
  return x;
}

function customerMore(k, d) {
  const key = slipKey(d.maandag, k.id);
  if (!slips.has(key)) return '<p class="pdfbox-wait">De pakbon laden…</p>';
  const x = slips.get(key);
  const src = k.van.length ? `<div class="tbwrap"><table class="tb ksrc"><thead><tr><th>Leverancier</th><th>Batch</th><th>Wat</th><th class="r">Dozen</th></tr></thead><tbody>
    ${k.van.map(v => { const l = lightOf(v), here = inHall(v); return `<tr><td><a href="#/inkoop?maandag=${d.maandag}&p=${v.partij_id}"><b>${h(short(v.leverancier))}</b></a>
      <small class="faint" style="display:block"><span class="lgt" data-l="${here ? 'binnen' : h(l)}"><i></i>${here ? 'in de loods' : l === 'rood' ? 'in gevaar' : l === 'oranje' ? 'let op' : 'op schema'}</span></small></td>
      <td class="num"><b>${h(v.nummer)}</b></td><td class="small">${v.regels.map(r => `${fNum(r.dozen)} × ${h(r.naam)} ${h(r.maat)}`).join('<br>')}</td><td class="r num">${fNum(v.dozen)}</td></tr>`; }).join('')}
  </tbody></table></div>` : '<p class="small faint">Nog niets verdeeld voor deze klant.</p>';
  const kort = k.kort.length ? `<ul class="kort">${k.kort.map(x2 => `<li><b>${h(x2.naam)} ${h(x2.maat)}</b><span>vroeg ${fNum(x2.gevraagd)}, krijgt ${fNum(x2.krijgt)}</span><em class="lt t-wait">−${fNum(x2.gevraagd - x2.krijgt)}</em></li>`).join('')}</ul>` : '';
  const slip = x && !x.fout ? slipPaper(x) : `<p class="empty">${x && x.fout ? h(x.fout) : 'Deze klant krijgt deze week nog niets, dus er is geen pakbon.'}</p>`;
  return `<div class="km">
      <div class="km-slip">${slip}</div>
      <div class="km-info stack">
        ${x && !x.fout ? `<section class="km-next"><h3 class="h3s">Pakbon en factuur</h3><div class="stack" style="gap:10px">${slipNext(x)}</div></section>` : ''}
        <section><h3 class="h3s">Waar het vandaan komt</h3>${src}<p class="small faint">Het batchnummer staat als C op het plantenpaspoort en als kostendrager in Exact.</p></section>
        ${kort ? `<section><h3 class="h3s">Vroeg meer dan er komt</h3>${kort}</section>` : ''}
      </div>
    </div>
    <p class="om-f"><a class="btn btn-sm btn-line" href="#/klant/${k.id}">${icon('customer')}Alles over ${h(k.naam)}</a>
      <a class="btn btn-sm btn-ghost" href="#/pakbon/${k.id}?maandag=${d.maandag}">Bij Pakbonnen</a>
      <a class="btn btn-sm btn-ghost" href="#/maandag?maandag=${d.maandag}&deel=verdelen">Verdeling aanpassen</a></p>`;
}

// ---------------------------------------------------------------- per batch: every region its own number this week
// A customer who gets boxes from two regions has a lane under both batches, each with only that batch's boxes.
const TONE_ORDER = { bad: 0, wait: 1, ok: 2, in: 3, done: 4 };
function batches(d, ks) {
  const by = new Map();
  for (const p of d.partijen.filter(p => p.regels.length)) {
    if (!by.has(p.nummer)) by.set(p.nummer, { nummer: p.nummer, regio: p.regio, partijen: [], delen: [] });
    by.get(p.nummer).partijen.push(p);
  }
  for (const k of ks) {
    const per = new Map();
    for (const v of k.van) { if (!per.has(v.nummer)) per.set(v.nummer, []); per.get(v.nummer).push(v); }
    for (const [nr, van] of per) {
      const pids = new Set(van.flatMap(v => v.regels.map(r => r.product_id)));
      const kort = k.kort.filter(x => pids.has(x.product_id));
      by.get(nr)?.delen.push({ ...k, nr, van, dozen: sum(van, v => v.dozen), totaal: k.dozen, kort, tekort: sum(kort, x => x.gevraagd - x.krijgt) });
    }
  }
  for (const b of by.values()) b.delen.sort((x, y) => TONE_ORDER[customerTone(x)[0]] - TONE_ORDER[customerTone(y)[0]] || y.dozen - x.dozen || x.naam.localeCompare(y.naam, 'nl'));
  return [...by.values()].sort((a, b) => a.nummer.localeCompare(b.nummer));
}

function batchHtml(b, d) {
  const g = (d.regios || []).find(x => x.code === b.regio);
  const inn = sum(b.partijen, p => p.dozen), uit = sum(b.delen, x => x.dozen), vrij = sum(b.partijen, p => p.stroom?.rest || 0);
  const lights = b.partijen.map(p => p.risico?.licht);
  const [t, w] = lights.every(l => l === 'binnen') ? ['in', 'In de loods'] : lights.includes('rood') ? ['bad', 'In gevaar'] : lights.includes('oranje') ? ['wait', 'Let op'] : ['ok', 'Op schema'];
  return `<section class="bsec" aria-label="Batch ${h(b.nummer)}">
    <header class="bsec-h">
      <span class="bnr">${h(b.nummer)}</span>
      <span class="bt"><b>${h(g ? g.naam : b.regio)}${g?.nummer ? ` · regio ${String(g.nummer).padStart(2, '0')}` : ''}</b><small>${b.partijen.map(p => h(short(p.leverancier))).join(' · ')} · ${fNum(b.delen.length)} ${b.delen.length === 1 ? 'klant' : 'klanten'}${vrij ? ` · ${fNum(vrij)} vrij` : uit === inn ? ' · netto nul' : ''}</small></span>
      <span class="st t-${t}"><i aria-hidden="true"></i>${w}</span>
    </header>
    <div class="lanes">${b.delen.map(k => customerLaneHtml(k, d)).join('')}</div>
  </section>`;
}

// ================================================================ the page
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

const dots = list => list.filter(([, n]) => n).map(([t, n, l]) => `<span class="sw-d t-${t}" title="${h(l)}"><i aria-hidden="true"></i>${fNum(n)}</span>`).join('');

// at the top: what has no destination yet (in the loods or on its way), or that everything has one
function freeBar(d) {
  const w = d.stroom, v = w.vrij || [];
  const n = v.reduce((t, x) => t + x.dozen, 0);
  if (!w.in) return '';
  if (w.teVeel > 0) return `<div class="vrij t-bad">${icon('warn')}<b>${fNum(w.teVeel)} ${w.teVeel === 1 ? 'doos' : 'dozen'} meer verdeeld dan er is</b><span class="vrij-w">pas het aan bij Maandag</span><a class="btn btn-sm btn-line" href="#/maandag?maandag=${d.maandag}&deel=verdelen">Naar verdelen</a></div>`;
  if (!n) return `<div class="vrij t-ok">${icon('check')}<b>Alles heeft een bestemming</b><span class="vrij-w">${fNum(w.in)} dozen naar ${fNum(w.klanten.length)} ${w.klanten.length === 1 ? 'klant' : 'klanten'}</span></div>`;
  const binnen = v.reduce((t, x) => t + x.binnen, 0), weg = n - binnen;
  return `<div class="vrij t-wait">${icon('stock')}<b>${fNum(n)} ${n === 1 ? 'doos' : 'dozen'} zonder bestemming</b>
    <span class="vrij-w">${[binnen ? `${fNum(binnen)} in de loods` : '', weg ? `${fNum(weg)} onderweg` : ''].filter(Boolean).join(' · ')}</span>
    <span class="vrij-p" data-n="${v.length}">${v.slice(0, 12).map(x => `<span class="vp" title="${h(x.batches.join(', '))}">${h(x.naam)} ${h(x.maat)} <b>${fNum(x.dozen)}</b></span>`).join('')}<span class="vp vp-more" hidden></span></span>
    <a class="btn btn-sm btn-line" href="#/handel?deel=deals">Koper zoeken</a></div>`;
}

export async function render(params, query) {
  const m = query.get('maandag');
  kant = query.get('kant') === 'klant' ? 'klant' : 'lev';
  const d = await api(`/week/inkoop${m ? `?maandag=${m}` : ''}`);
  last = d;
  const want = Number(query.get('p')), wantK = Number(query.get('k'));
  if (want && seenP !== `${d.maandag}:${want}`) { open.add(want); seenP = `${d.maandag}:${want}`; }
  const wantKey = query.get('k');
  if (wantK && seenK !== `${d.maandag}:${wantKey}`) { openK.add(wantKey); seenK = `${d.maandag}:${wantKey}`; }
  if (kant === 'klant') await Promise.all([...new Set([...openK].map(x => Number(String(x).split('-')[0])))].filter(id => K(id)).map(id => loadSlip(id, d.maandag)));

  const ps = d.partijen.filter(p => p.stroom || p.regels.length);
  const count = k => ps.filter(p => p.risico?.licht === k).length;
  const w = d.stroom;
  const ks = d.klanten.filter(k => k.dozen > 0 || k.gevraagd > 0);
  const ktone = new Map(ks.map(k => [k.id, customerTone(k)[0]]));
  const kcount = t => ks.filter(k => ktone.get(k.id) === t).length;
  const sw = (key, ic, title, sub, d2) => `<a role="tab" class="fl-sw${kant === key ? ' on' : ''}" aria-selected="${kant === key}" href="#/inkoop?maandag=${d.maandag}${key === 'klant' ? '&kant=klant' : ''}">
      <span class="sw-i" aria-hidden="true">${icon(ic)}</span><b>${title}</b><small>${sub}</small><span class="sw-ds">${d2}</span></a>`;
  const head = `<div class="fl-top">
      <h1 class="vh">Overzicht week ${d.week}</h1>
      <div class="fl-switch" role="tablist" aria-label="Bekijk de week">
        ${sw('lev', 'grower', 'Leverancier → loods', `${fNum(ps.length)} ${ps.length === 1 ? 'bestelling' : 'bestellingen'} · ${fNum(w.in)} dozen`,
          dots([['bad', count('rood'), 'in gevaar'], ['wait', count('oranje'), 'let op'], ['ok', count('groen'), 'op schema'], ['in', count('binnen'), 'binnen']]))}
        ${sw('klant', 'customer', 'Loods → klant', `${fNum(ks.length)} klanten · ${fNum(new Set(ps.map(p => p.nummer)).size)} batches`,
          dots([['bad', kcount('bad'), 'in gevaar'], ['wait', kcount('wait'), 'let op'], ['ok', kcount('ok'), 'op schema'], ['in', kcount('in'), 'in de loods'], ['done', kcount('done'), 'pakbon klaar']]))}
      </div>
      <div class="fl-acts">${weekNav('inkoop', d.maandag, kant === 'klant' ? '&kant=klant' : '')}
        ${kant === 'lev' ? `<button type="button" class="btn btn-line btn-sm" data-act="melding" title="Melding over de route: staking, as, een weg dicht">${icon('plus')}Melding</button>` : ''}</div>
    </div>
    ${freeBar(d)}
    ${d.vorige.length ? `<div class="warnbox wait">${icon('info')}<span>Nog niet in Exact van week ${d.vorige[0].week}: ${d.vorige.map(p => `<a href="#/inkoop?maandag=${p.maandag}&p=${p.id}">${h(short(p.leverancier))} ${h(p.nummer)}</a>`).join(', ')}.</span></div>` : ''}`;

  if (kant === 'klant') {
    const bs = batches(d, ks), none = ks.filter(k => !k.van.length);
    return `<div class="page wk flowpage">${head}
      ${ks.length ? `${bs.map(b => batchHtml(b, d)).join('')}
        ${none.length ? `<section class="bsec" aria-label="Nog zonder batch"><header class="bsec-h"><span class="bt"><b>Nog zonder batch</b><small>Vroegen iets wat deze week niet komt</small></span></header>
          <div class="lanes">${none.map(k => customerLaneHtml(k, d)).join('')}</div></section>` : ''}`
        : `<section class="panel"><p class="empty">Voor deze week heeft nog geen klant besteld. <a href="#/handel?deel=bestellen&maandag=${d.maandag}">Naar bestellen</a></p></section>`}
    </div>`;
  }
  const att = ps.filter(p => ['rood', 'oranje'].includes(p.risico?.licht)).sort((a, b) => (a.risico.licht === 'rood' ? 0 : 1) - (b.risico.licht === 'rood' ? 0 : 1)), ok = ps.filter(p => !['rood', 'oranje', 'binnen'].includes(p.risico?.licht)), inn = ps.filter(p => p.risico?.licht === 'binnen');
  return `<div class="page wk flowpage">${head}
    ${ps.length ? `<section class="flow-sec" aria-label="Van de leverancier naar de loods">
      ${att.length ? `<h2 class="grp">Let op</h2><div class="lanes">${att.map(p => laneHtml(p, d)).join('')}</div>` : ''}
      ${ok.length ? `<h2 class="grp">${att.length ? 'Op schema' : 'Alles loopt op schema'}</h2><div class="lanes">${ok.map(p => laneHtml(p, d)).join('')}</div>` : ''}
      ${inn.length ? `<h2 class="grp">Binnen</h2><div class="lanes">${inn.map(p => laneHtml(p, d)).join('')}</div>` : ''}
      ${sources(d)}
    </section>` : `<section class="panel"><p class="empty">Voor deze week is nog niets besteld. <a href="#/handel?deel=bestellen&maandag=${d.maandag}">Naar bestellen</a></p></section>`}
  </div>`;
}

// One line of chips under "zonder bestemming": as many as fit, then "+ 6" for the rest (the deals part lists them all).
function fitChips(bar) {
  const box = bar?.querySelector('.vrij-p');
  if (!box || !box.isConnected) return;
  const chips = [...box.querySelectorAll('.vp:not(.vp-more)')], more = box.querySelector('.vp-more'), total = Number(box.dataset.n) || chips.length;
  chips.forEach(c => { c.hidden = false; });
  more.hidden = true;
  const avail = box.clientWidth, gap = 6, widths = chips.map(c => c.offsetWidth);
  more.textContent = `+ ${total}`; more.hidden = false;
  const moreW = more.offsetWidth;
  let used = 0, shown = 0;
  for (let i = 0; i < chips.length; i++) {
    const next = used + (i ? gap : 0) + widths[i];
    if (next + (total - i - 1 ? gap + moreW : 0) > avail) break;
    used = next; shown = i + 1;
  }
  chips.forEach((c, i) => { c.hidden = i >= shown; });
  const rest = total - shown;
  more.textContent = `+ ${fNum(rest)}`; more.hidden = !rest;
  more.title = rest ? `en nog ${rest} ${rest === 1 ? 'soort' : 'soorten'}: zie Deals` : '';
}
let fitObs = null;

export function mount(ctx, how = {}) {
  const bar = document.querySelector('.vrij.t-wait');
  if (fitObs) { fitObs.disconnect(); fitObs = null; }
  if (bar) {
    fitChips(bar);
    if (window.ResizeObserver) { fitObs = new ResizeObserver(() => fitChips(bar)); fitObs.observe(bar); }
  }
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const el = how.nav === false ? null : (q.get('p') && document.getElementById(`p${q.get('p')}`)) || (q.get('k') && (document.getElementById(`k${q.get('k')}`) || document.querySelector(`.klane[id^="k${q.get('k')}-"]`)));
  if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 30);
  drawPapers(document);
}
export const refreshEvery = 60000;

// Opening a lane keeps the page still, so Jan stays where he clicked. Only when the details start low on the
// screen does the page move down a little to show them; it never jumps back up to the supplier.
function reveal(box) {
  if (!box || box.hidden) return;
  requestAnimationFrame(() => {
    const top = box.getBoundingClientRect().top, vh = window.innerHeight;
    if (top > vh * 0.62) window.scrollBy({ top: Math.round(top - vh * 0.38), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}

function show(id, on) {
  const box = document.getElementById(`more${id}`), btn = document.querySelector(`button.lane-link[data-p="${id}"]`), art = document.getElementById(`p${id}`);
  if (!box) return null;
  if (on) { open.add(id); box.innerHTML = more(P(id), last); box.hidden = false; box.setAttribute('data-hold', ''); drawPapers(box); } else { open.delete(id); box.hidden = true; box.innerHTML = ''; box.removeAttribute('data-hold'); }
  if (btn) btn.setAttribute('aria-expanded', String(on));
  if (art) art.classList.toggle('is-open', on);
  return box;
}
async function showK(id, key, on) {
  const box = document.getElementById(`kmore${key}`), btn = document.querySelector(`button.lane-link[data-key="${key}"]`), art = document.getElementById(`k${key}`), k = K(id);
  if (!box || !k) return;
  if (btn) btn.setAttribute('aria-expanded', String(on));
  if (art) art.classList.toggle('is-open', on);
  if (!on) { openK.delete(key); box.hidden = true; box.innerHTML = ''; box.removeAttribute('data-hold'); return; }
  openK.add(key); box.hidden = false; box.setAttribute('data-hold', '');
  box.innerHTML = customerMore(k, last);
  const m = last.maandag;
  await loadSlip(id, m);
  if (openK.has(key) && last.maandag === m) box.innerHTML = customerMore(K(id), last);
}

export const actions = {
  ...partijActions(P),
  ...slipActions(id => slips.get(slipKey(last.maandag, id))),
  // a click on an order opens all of it; a name still goes to the customer or supplier
  lane: (el, ctx, e) => {
    if (e && e.target.closest('a')) return 'default';
    const id = Number(el.dataset.p), on = !open.has(id);
    const box = show(id, on);
    if (on) reveal(box);
  },
  klane: (el, ctx, e) => {
    if (e && e.target.closest('a')) return 'default';
    const id = Number(el.dataset.k), key = el.dataset.key || String(id), on = !openK.has(key);
    const done = showK(id, key, on);
    if (on) reveal(document.getElementById(`kmore${key}`));
    return done;
  },
  'om-doc': el => { docSel.set(Number(el.dataset.p), Number(el.dataset.d)); show(Number(el.dataset.p), true); },
  melding: (el, ctx) => noticeDialog(ctx, { plekken: last.plekken }),
};
