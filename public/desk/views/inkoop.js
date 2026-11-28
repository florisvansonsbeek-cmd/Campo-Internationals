// Inkoop: the goods of one week, in two views behind one big switch.
// Leverancier → loods: one lane per order. The supplier, the route to Nootdorp with every stop and its time on the line,
//   the loods, and the customers it fans out to. A click opens the whole order: the shipping papers next to what the desk
//   read, the sizes and numbers, the purchase order for Exact and to whom it goes.
// Loods → klant: the other way round, one lane per customer. Which suppliers and batches bring what, the steps on Monday
//   (counted, packing slip, mail, Exact) on the line, and the customer. A click opens the packing slip that is also the
//   invoice, with the plant passport, exactly as on the Pakbonnen tab, and where every box came from.
import { api, h, icon, fNum } from '../core.js';
import { weekNav, dayTime, tTime, delta, fUsd, fUsdUnit, fEur2 } from '../wk.js';
import { reasons, toWhom, exactBox, doubts, partijActions, noticeDialog, DOC } from '../partij.js';
import { paperHtml, drawPapers } from '../paper.js';
import { slipPaper, slipNext, slipActions } from '../slip.js';

let last = null, seenP = null, seenK = null, kant = 'lev';
const open = new Set();       // the orders Jan opened stay open when the page refreshes
const openK = new Set();      // the same for customers
const docSel = new Map();     // which paper is shown per order
const slips = new Map();      // the packing slip per customer, for the open ones
const ROW = 28, FORK = 64, MAXK = 6, MAXS = 5;
const TONE = { groen: ['ok', 'Op schema'], oranje: ['wait', 'Let op'], rood: ['bad', 'In gevaar'], binnen: ['done', 'Binnen'] };
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

function progress(p, d) {
  if (p.stage === 'binnen') { const ks = p.stroom?.klanten || []; return d.geteld ? (ks.length && ks.every(k => k.pakbon) ? 100 : 92) : 85; }
  if (p.stage === 'verzonden') return Math.round(55 + 0.25 * track(p).pct);
  return p.stage === 'bevestigd' ? 35 : 15;
}

function stageText(p, d) {
  const r = p.risico || {}, st = p.stroom, n = st ? st.klanten.length : 0;
  const where = p.stage === 'binnen' ? `Binnen ${dayTime(r.binnen || p.binnen_op)}${d.geteld ? ', geteld' : ', nog tellen'}`
    : p.stage === 'verzonden' ? `In de lucht sinds ${dayTime(p.verzonden_op)}`
      : p.stage === 'bevestigd' ? `Bevestigd ${dayTime(p.bevestigd_op)}, vliegt ${dayName(r.vertrek)}`
        : `Besteld ${dayTime(p.besteld_op)}, de bevestiging komt donderdag`;
  return `${where}; ${n ? `naar ${n} ${n === 1 ? 'klant' : 'klanten'}` : 'nog geen klant'}${st && st.rest ? `, ${st.rest} vrij` : ''}`;
}

// the route on the line itself: the farm, every airport with its day or time, and the time in the loods at the hub
function routeOnLine(p) {
  const r = p.risico || {}, stops = r.stops || [];
  const farm = stops.find(s => s.soort === 'herkomst'), air = stops.filter(s => s.code && s.soort !== 'loods');
  const when = s => (s.soort === 'vertrek' && s.voorbij && r.vertrek ? wd(r.vertrek) : dd(s.dag));
  const pos = i => (air.length > 1 ? 30 + (50 * i) / (air.length - 1) : 55);
  const arrive = r.licht === 'binnen' ? wd(r.binnen || p.binnen_op) : r.verwacht ? wd(r.verwacht) : '';
  const late = r.licht !== 'binnen' && r.vertraging ? r.vertraging : 0;
  const ticks = [
    farm ? `<span class="ap ap0${farm.voorbij ? ' done' : ''}" data-l="${h(farm.licht)}"><b>kwekerij</b><em>${h(dd(farm.dag))}</em></span>` : '',
    ...air.map((s, i) => `<span class="ap${s.voorbij ? ' done' : ''}" data-l="${h(s.licht)}" style="left:${pos(i)}%"><i></i><b>${h(s.code)}</b><em>${h(when(s))}</em></span>`),
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
  const ks = st.klanten.slice(0, MAXK), others = st.klanten.slice(MAXK);
  const rows = ks.map(k => ({ k }));
  if (others.length) rows.push({ andere: others.length, dozen: sum(others, k => k.dozen), kort: sum(others, k => k.tekort || 0), klaar: others.every(k => k.pakbon) });
  if (st.rest > 0) rows.push({ vrij: st.rest });
  if (!rows.length) rows.push({ leeg: true });
  const n = rows.length, H = Math.max(n * ROW, 64), top = (H - n * ROW) / 2, mid = H / 2;
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
  const rt = routeOnLine(p);
  const pr = progress(p, d), maten = p.regels.length;
  const label = `${p.leverancier}, batch ${p.nummer}: ${fNum(p.dozen)} dozen naar ${st.klanten.length} klanten. ${rt.title}. ${word}${r.licht === 'oranje' || r.licht === 'rood' ? `: ${r.kop}` : ''}. Klik voor de hele bestelling.`;
  return `<article class="lane t-${tone}${isOpen ? ' is-open' : ''}"${interactive ? ` id="p${p.id}"` : ''}>
    <div class="lane-top">
      ${interactive ? `<button type="button" class="lane-link" data-act="lane" data-p="${p.id}" aria-expanded="${isOpen}" aria-controls="more${p.id}" aria-label="${h(label)}"></button>` : ''}
      <div class="ln" style="--h:${H}px">
        <div class="gr"><b>${h(short(p.leverancier))}</b><span>${h([p.lev_plaats, p.nummer].filter(Boolean).join(' · '))}</span><span>${fNum(p.dozen)} dozen, ${maten} ${maten === 1 ? 'maat' : 'maten'}</span></div>
        <div class="in s-${tr.s} t-${tr.tone}" style="--p:${tr.pct}%" title="${h(rt.title)}"><span class="tk" aria-hidden="true"><i></i>${tr.s === 'onderweg' ? `<span class="truck">${icon(tr.air ? 'plane' : 'truck')}</span>` : ''}</span>${rt.ticks}<span class="rtm">${rt.mobile}</span></div>
        <div class="hub${tr.s === 'binnen' ? ' on' : ''}" title="In de loods in Nootdorp"><span aria-hidden="true">${icon('shed')}</span><em class="${rt.late ? `t-${tone === 'bad' ? 'bad' : 'wait'}` : ''}">${h(rt.arrive)}${rt.late ? ` +${rt.late} u` : ''}</em></div>
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
        ${exactBox(p)}
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
  const s = k.slip, srcs = k.van.length;
  const from = srcs ? `${fNum(k.dozen)} dozen van ${srcs} ${srcs === 1 ? 'leverancier' : 'leveranciers'}` : 'Nog niets';
  if (s?.status === 'akkoord') {
    const how = s.mail === 'verstuurd' ? 'verstuurd' : s.mail === 'in_outlook' ? 'in Outlook' : s.gedrukt ? 'met de goederen meegegeven' : 'mail staat klaar';
    return `Pakbon ${s.nummer} akkoord${d.koers && s.totaal ? `, ${fEur2(s.totaal)}` : ''}; ${how}${s.exact === 'in_exact' ? ', in Exact' : ''}`;
  }
  if (!d.geteld) {
    const eta = k.van.map(v => P(v.partij_id)?.risico?.verwacht).filter(Boolean).sort().pop();
    return `${from}${k.gevraagd ? `, vroeg ${fNum(k.gevraagd)}` : ''}; voorstel uit de telefoonbestellingen${eta ? `, in de loods ${wd(eta)}` : ''}`;
  }
  return `${from}; ${s?.status === 'klaar' ? 'pakbon klaar voor akkoord' : s?.reden ? s.reden.replace(/\.$/, '').toLowerCase() : 'geteld en verdeeld'}`;
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
  const [tone, word] = customerTone(k), isOpen = openK.has(k.id);
  const vs = k.van.slice(0, MAXS), others = k.van.slice(MAXS);
  const rows = vs.map(v => ({ v }));
  if (others.length) rows.push({ andere: others.length, dozen: sum(others, v => v.dozen) });
  if (!rows.length) rows.push({ leeg: true });
  const n = rows.length, H = Math.max(n * ROW, 64), top = (H - n * ROW) / 2, mid = H / 2;
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
      <a class="sn" href="#/inkoop?maandag=${d.maandag}&p=${v.partij_id}"><b>${h(short(v.leverancier))}</b><span>${h(v.nummer)}</span></a>
      <span class="sd">${fNum(v.dozen)} dz</span><span class="cd" aria-hidden="true"></span><span class="bl" aria-hidden="true"><i style="width:${here ? 100 : 0}%"></i></span></li>`;
  };
  const steps = customerSteps(k, d), done = steps.filter(s => s.on).length;
  const POS = [16, 39, 62, 85];
  const fill = done ? (done === steps.length ? 100 : POS[done - 1]) : 0;
  const ticks = steps.map((s, i) => `<span class="ap${s.on ? ' done' : ''}" style="left:${POS[i]}%"><i></i><b>${s.k}</b><em>${h(s.t)}</em></span>`).join('');
  const pct = Math.round((done / steps.length) * 100);
  const why = customerWhy(k);
  const label = `${k.naam}: ${fNum(k.dozen)} dozen van ${k.van.length} ${k.van.length === 1 ? 'leverancier' : 'leveranciers'}. ${word}. Klik voor de pakbon met het plantenpaspoort.`;
  return `<article class="lane klane t-${tone}${isOpen ? ' is-open' : ''}" id="k${k.id}">
    <div class="lane-top">
      <button type="button" class="lane-link" data-act="klane" data-k="${k.id}" aria-expanded="${isOpen}" aria-controls="kmore${k.id}" aria-label="${h(label)}"></button>
      <div class="ln kn" style="--h:${H}px">
        <ul class="kfrom" style="padding-top:${top}px">${rows.map(src).join('')}</ul>
        <svg class="fork" viewBox="0 0 ${FORK} ${H}" width="${FORK}" height="${H}" aria-hidden="true" focusable="false">${curves}</svg>
        <div class="hub${d.geteld ? ' on' : ''}" title="De loods in Nootdorp"><span aria-hidden="true">${icon('shed')}</span><em>loods</em></div>
        <div class="in kout ${d.geteld ? 's-onderweg' : 's-gepland'} t-ok" style="--p:${fill}%"><span class="tk" aria-hidden="true"><i></i></span>${ticks}
          <span class="rtm">${steps.map(s => `<span class="${s.on ? 'on' : ''}">${s.k} ${h(s.t)}</span>`).join('<i aria-hidden="true">·</i>')}</span></div>
        <div class="kl"><a class="kn-n" href="#/klant/${k.id}"><b>${h(k.naam)}</b></a><span>${h([k.plaats, k.land].filter(Boolean).join(' · '))}</span>
          <span class="kd"><b>${fNum(k.dozen)} dz</b>${k.tekort ? ` <span class="lt t-wait" title="Vroeg ${fNum(k.gevraagd)}">−${fNum(k.tekort)}</span>` : ''}${k.gevraagd && k.gevraagd !== k.dozen ? `<small>vroeg ${fNum(k.gevraagd)}</small>` : ''}</span></div>
      </div>
      <div class="ft">
        <span class="pbar" role="img" aria-label="${pct}% van maandag"><i style="width:${pct}%"></i></span><b class="pct">${pct}%</b>
        <span class="stg">${h(customerText(k, d))}</span>
        <span class="st t-${tone}"><i aria-hidden="true"></i>${word}</span>
      </div>
      ${why ? `<p class="why t-${why[0]}">${icon(why[0] === 'bad' ? 'warn' : 'clock')}<span>${h(why[1])}</span></p>` : ''}
    </div>
    <div class="lane-more" id="kmore${k.id}"${isOpen ? ' data-hold' : ' hidden'}>${isOpen ? customerMore(k, d) : ''}</div>
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

export async function render(params, query) {
  const m = query.get('maandag');
  kant = query.get('kant') === 'klant' ? 'klant' : 'lev';
  const d = await api(`/week/inkoop${m ? `?maandag=${m}` : ''}`);
  last = d;
  const want = Number(query.get('p')), wantK = Number(query.get('k'));
  if (want && seenP !== `${d.maandag}:${want}`) { open.add(want); seenP = `${d.maandag}:${want}`; }
  if (wantK && seenK !== `${d.maandag}:${wantK}`) { openK.add(wantK); seenK = `${d.maandag}:${wantK}`; }
  if (kant === 'klant') await Promise.all([...openK].filter(id => K(id)).map(id => loadSlip(id, d.maandag)));

  const ps = d.partijen.filter(p => p.stroom || p.regels.length);
  const count = k => ps.filter(p => p.risico?.licht === k).length;
  const w = d.stroom;
  const ks = d.klanten.filter(k => k.dozen > 0 || k.gevraagd > 0);
  const ktone = new Map(ks.map(k => [k.id, customerTone(k)[0]]));
  const kcount = t => ks.filter(k => ktone.get(k.id) === t).length;
  const sw = (key, ic, title, sub, d2) => `<a role="tab" class="fl-sw${kant === key ? ' on' : ''}" aria-selected="${kant === key}" href="#/inkoop?maandag=${d.maandag}${key === 'klant' ? '&kant=klant' : ''}">
      <span class="sw-i" aria-hidden="true">${icon(ic)}</span><span class="sw-t"><b>${title}</b><small>${sub}</small></span><span class="sw-ds">${d2}</span></a>`;
  const head = `<div class="fl-top">
      <h1 class="vh">Inkoop week ${d.week}</h1>
      <div class="fl-switch" role="tablist" aria-label="Bekijk de week">
        ${sw('lev', 'grower', 'Leverancier → loods', `${fNum(ps.length)} ${ps.length === 1 ? 'bestelling' : 'bestellingen'} · ${fNum(w.in)} dozen · ${w.teVeel ? `${fNum(w.teVeel)} te veel verdeeld` : w.rest ? `${fNum(w.rest)} vrij` : 'netto nul'}`,
          dots([['bad', count('rood'), 'in gevaar'], ['wait', count('oranje'), 'let op'], ['ok', count('groen'), 'op schema'], ['done', count('binnen'), 'binnen']]))}
        ${sw('klant', 'customer', 'Loods → klant', `${fNum(ks.length)} klanten · ${kcount('done') ? `${fNum(kcount('done'))} pakbonnen akkoord` : w.kortKlanten ? `${fNum(w.kortKlanten)} krijgen minder` : 'iedereen krijgt wat hij vroeg'}`,
          dots([['bad', kcount('bad'), 'in gevaar'], ['wait', kcount('wait'), 'let op'], ['ok', kcount('ok'), 'op schema'], ['done', kcount('done'), 'pakbon akkoord']]))}
      </div>
      <div class="fl-acts">${weekNav('inkoop', d.maandag, kant === 'klant' ? '&kant=klant' : '')}
        ${kant === 'lev' ? `<button type="button" class="btn btn-line btn-sm" data-act="melding" title="Melding over de route: staking, as, een weg dicht">${icon('plus')}Melding</button>` : ''}</div>
    </div>
    ${d.vorige.length ? `<div class="warnbox wait">${icon('info')}<span>Nog niet in Exact van week ${d.vorige[0].week}: ${d.vorige.map(p => `<a href="#/inkoop?maandag=${p.maandag}&p=${p.id}">${h(short(p.leverancier))} ${h(p.nummer)}</a>`).join(', ')}.</span></div>` : ''}`;

  if (kant === 'klant') {
    const order = t => ks.filter(k => ktone.get(k.id) === t);
    const att = [...order('bad'), ...order('wait')], ok = order('ok'), done = order('done');
    return `<div class="page wk flowpage">${head}
      ${ks.length ? `<section class="flow-sec" aria-label="Van de loods naar de klant">
        ${att.length ? `<h2 class="grp">Let op</h2><div class="lanes">${att.map(k => customerLaneHtml(k, d)).join('')}</div>` : ''}
        ${ok.length ? `<h2 class="grp">${att.length ? 'Op schema' : 'Alles op schema'}</h2><div class="lanes">${ok.map(k => customerLaneHtml(k, d)).join('')}</div>` : ''}
        ${done.length ? `<h2 class="grp">Pakbon akkoord</h2><div class="lanes">${done.map(k => customerLaneHtml(k, d)).join('')}</div>` : ''}
      </section>` : `<section class="panel"><p class="empty">Voor deze week heeft nog geen klant besteld. <a href="#/bestellen?maandag=${d.maandag}">Naar bestellen</a></p></section>`}
    </div>`;
  }
  const att = ps.filter(p => ['rood', 'oranje'].includes(p.risico?.licht)).sort((a, b) => (a.risico.licht === 'rood' ? 0 : 1) - (b.risico.licht === 'rood' ? 0 : 1)), ok = ps.filter(p => !['rood', 'oranje', 'binnen'].includes(p.risico?.licht)), inn = ps.filter(p => p.risico?.licht === 'binnen');
  return `<div class="page wk flowpage">${head}
    ${ps.length ? `<section class="flow-sec" aria-label="Van de leverancier naar de loods">
      ${att.length ? `<h2 class="grp">Let op</h2><div class="lanes">${att.map(p => laneHtml(p, d)).join('')}</div>` : ''}
      ${ok.length ? `<h2 class="grp">${att.length ? 'Op schema' : 'Alles loopt op schema'}</h2><div class="lanes">${ok.map(p => laneHtml(p, d)).join('')}</div>` : ''}
      ${inn.length ? `<h2 class="grp">Binnen</h2><div class="lanes">${inn.map(p => laneHtml(p, d)).join('')}</div>` : ''}
      ${sources(d)}
    </section>` : `<section class="panel"><p class="empty">Voor deze week is nog niets besteld. <a href="#/bestellen?maandag=${d.maandag}">Naar bestellen</a></p></section>`}
  </div>`;
}

export function mount() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const el = (q.get('p') && document.getElementById(`p${q.get('p')}`)) || (q.get('k') && document.getElementById(`k${q.get('k')}`));
  if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 30);
  drawPapers(document);
}
export const refreshEvery = 60000;

function show(id, on) {
  const box = document.getElementById(`more${id}`), btn = document.querySelector(`button.lane-link[data-p="${id}"]`), art = document.getElementById(`p${id}`);
  if (!box) return null;
  if (on) { open.add(id); box.innerHTML = more(P(id), last); box.hidden = false; box.setAttribute('data-hold', ''); drawPapers(box); } else { open.delete(id); box.hidden = true; box.innerHTML = ''; box.removeAttribute('data-hold'); }
  if (btn) btn.setAttribute('aria-expanded', String(on));
  if (art) art.classList.toggle('is-open', on);
  return box;
}
async function showK(id, on) {
  const box = document.getElementById(`kmore${id}`), btn = document.querySelector(`button.lane-link[data-k="${id}"]`), art = document.getElementById(`k${id}`), k = K(id);
  if (!box || !k) return;
  if (btn) btn.setAttribute('aria-expanded', String(on));
  if (art) art.classList.toggle('is-open', on);
  if (!on) { openK.delete(id); box.hidden = true; box.innerHTML = ''; box.removeAttribute('data-hold'); return; }
  openK.add(id); box.hidden = false; box.setAttribute('data-hold', '');
  box.innerHTML = customerMore(k, last);
  const m = last.maandag;
  await loadSlip(id, m);
  if (openK.has(id) && last.maandag === m) box.innerHTML = customerMore(K(id), last);
}

export const actions = {
  ...partijActions(P),
  ...slipActions(id => slips.get(slipKey(last.maandag, id))),
  // a click on an order opens all of it; a name still goes to the customer or supplier
  lane: (el, ctx, e) => {
    if (e && e.target.closest('a')) return 'default';
    const id = Number(el.dataset.p), on = !open.has(id);
    show(id, on);
    if (on) setTimeout(() => document.getElementById(`p${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);
  },
  klane: (el, ctx, e) => {
    if (e && e.target.closest('a')) return 'default';
    const id = Number(el.dataset.k), on = !openK.has(id);
    if (on) setTimeout(() => document.getElementById(`k${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);
    return showK(id, on);
  },
  'om-doc': el => { docSel.set(Number(el.dataset.p), Number(el.dataset.d)); show(Number(el.dataset.p), true); },
  melding: (el, ctx) => noticeDialog(ctx, { plekken: last.plekken }),
};
