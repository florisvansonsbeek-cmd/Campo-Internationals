// Maandag: the boxes come in and go out, in six steps.
// 1 the dollar rate of the week, 2 tick every shipment off as in (it turns green on Inkoop), 3 lay the boxes out per
// region and customer, 4 check and change: other numbers, or a customer out if an order went wrong, 5 the packing slips
// and invoices (in euro, with the plant passports) as drafts in Outlook, 6 the Excel for Exact.
// The step that is up is open; a step that is done is one line. Nothing leaves the desk without Jan.
import { api, h, icon, fNum, toast, dialog } from '../core.js';
import { spark } from '../charts.js';
import { weekNav, dLong, dayTime, fKoers } from '../wk.js';

let last = null, slipsOf = null;
const opened = new Set(), closed = new Set();     // steps Jan opened or closed himself
const STEPS = [['koers', 'Koers'], ['binnen', 'Binnen'], ['leggen', 'Per regio en klant'], ['check', 'Controleren'], ['pakbon', 'Pakbon en factuur'], ['exact', 'Exact']];

const short = n => String(n || '').replace(/ (S\.A\.|B\.V\.|GmbH|Ltd)$/, '');
const sum = (a, f) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const lines = d => d.partijen.flatMap(p => p.regels.map(r => ({ ...r, nummer: p.nummer, regio: p.regio, partij_id: p.id })));
const regioName = (d, code) => (d.regios || []).find(g => g.code === code)?.naam || code;

// ---------------------------------------------------------------- which step is done
function state(d, s) {
  const ls = lines(d), withLines = d.partijen.filter(p => p.regels.length);
  const allIn = withLines.length > 0 && withLines.every(p => p.binnen_op);
  const slips = (s?.slips || []).filter(x => x.regels.length);
  const done = slips.filter(x => x.status === 'akkoord');
  return {
    koers: !!d.koers,
    binnen: allIn,
    leggen: allIn,
    // Jan says the hand-out is right (free boxes may stay in the loods; more than there is may not), or the slips are made
    check: allIn && !ls.some(r => r.rest < 0) && (d.nagekeken || done.length > 0),
    pakbon: slips.length > 0 && done.length === slips.length,
    exact: done.length > 0 && done.length === slips.length && done.every(x => x.pakbon.exact === 'in_exact'),
  };
}

// ---------------------------------------------------------------- 1 the rate
function rate(d) {
  const prev = d.koersen[d.koersen.length - 1];
  if (d.koers) return `<div class="koers-set"><div><span class="small muted">1 euro =</span><b>$ ${fKoers(d.koers)}</b></div>
      <p class="small muted">Vastgezet ${h(dayTime(d.koers_op))}. Alle pakbonnen en facturen van week ${d.week} rekenen hiermee.</p>
      <button type="button" class="btn btn-sm btn-ghost" data-act="koers-edit">${icon('edit')}Aanpassen</button></div>`;
  return `<form class="koers-f" data-form="koers">
      <label class="f">Hoeveel dollar is 1 euro deze week?<span class="koers-in"><span>1 € = $</span><input type="text" name="koers" inputmode="decimal" required placeholder="${prev ? fKoers(prev.koers) : '1,1600'}" aria-describedby="koers-hint"></span></label>
      <button class="btn btn-leaf" type="submit">${icon('check')}Vastzetten</button>
      <p class="small muted" id="koers-hint">${prev ? `Vorige week ${fKoers(prev.koers)}. ` : ''}De facturen zijn in euro; de desk rekent elke dollarprijs om met deze koers.</p>
      ${d.koersen.length > 2 ? `<div class="koers-sp">${spark(d.koersen.map(k => Math.round((k.koers - Math.min(...d.koersen.map(x => x.koers))) * 10000) + 10), { w: 120, h: 30 })}</div>` : ''}
    </form>`;
}

// ---------------------------------------------------------------- 2 in: tick every shipment off, green on Inkoop
function arrivals(d) {
  const ps = d.partijen.filter(p => p.regels.length);
  if (!ps.length) return '<p class="empty">Er zijn deze week geen zendingen.</p>';
  return `<ul class="arr">${ps.map(p => {
    const inn = !!p.binnen_op, n = sum(p.regels, r => r.verzonden ?? r.bevestigd ?? r.besteld ?? 0);
    const diff = p.regels.filter(r => r.geteld != null && (r.geteld !== (r.verzonden ?? r.bevestigd ?? r.besteld) || r.uitval));
    return `<li class="arr-i${inn ? ' is-in' : ''}" id="arr${p.id}">
      <button type="button" class="tick" data-act="binnen" data-p="${p.id}" aria-pressed="${inn}" aria-label="${h(`${p.leverancier} ${inn ? 'is binnen; klik om terug te zetten' : 'binnen melden'}`)}">${icon('check')}</button>
      <div class="arr-t"><b>${h(short(p.leverancier))}</b><span>${h(p.nummer)} · ${h(regioName(d, p.regio))}</span></div>
      <div class="arr-s">${inn ? `<span class="st t-ok"><i aria-hidden="true"></i>Binnen ${h(dayTime(p.binnen_op))}</span>${diff.length ? `<small>${diff.length} ${diff.length === 1 ? 'regel' : 'regels'} anders geteld</small>` : ''}`
        : `<span class="small muted">${fNum(n)} dozen volgens ${p.docsIn ? 'het verzendbewijs' : 'de bevestiging'}</span>`}</div>
      ${inn ? '' : `<details class="arr-d"><summary>Telling aanpassen</summary>
        <table class="tb count"><thead><tr><th>Maat</th><th class="r">Volgens papier</th><th class="r">Geteld</th><th class="r">Kapot</th></tr></thead><tbody>
        ${p.regels.map(r => { const exp = r.verzonden ?? r.bevestigd ?? r.besteld ?? 0; return `<tr><td>${h(r.product)} ${h(r.maat)}</td><td class="r num">${fNum(exp)}</td>
          <td class="r"><input class="num-in" type="number" min="0" max="9999" name="g${r.id}" value="${r.geteld ?? exp}" data-exp="${exp}" aria-label="Geteld ${h(r.product)} ${h(r.maat)}"></td>
          <td class="r"><input class="num-in sm" type="number" min="0" max="9999" name="u${r.id}" value="${r.uitval || 0}" aria-label="Kapot ${h(r.product)} ${h(r.maat)}"></td></tr>`; }).join('')}
        </tbody></table><p class="small faint">Pas alleen aan wat anders is, en vink de zending dan af.</p></details>`}
    </li>`;
  }).join('')}</ul>`;
}

// ---------------------------------------------------------------- per batch (region, week) and customer: what goes on whose pallet
function batches(d) {
  const by = new Map();
  for (const r of lines(d)) {
    if (!by.has(r.nummer)) by.set(r.nummer, { nummer: r.nummer, regio: r.regio, lev: new Set(), klanten: new Map() });
    const b = by.get(r.nummer);
    b.lev.add(short(r.leverancier || d.partijen.find(p => p.id === r.partij_id)?.leverancier));
    for (const v of r.verdeling.filter(x => x.dozen > 0)) {
      if (!b.klanten.has(v.klant_id)) b.klanten.set(v.klant_id, { klant_id: v.klant_id, klant: v.klant, items: [] });
      b.klanten.get(v.klant_id).items.push({ regel_id: r.id, product: r.product, maat: r.maat, dozen: v.dozen });
    }
  }
  return [...by.values()].sort((a, b) => a.nummer.localeCompare(b.nummer)).map(b => ({ ...b, klanten: [...b.klanten.values()].sort((x, y) => x.klant.localeCompare(y.klant, 'nl')) }));
}

function layout(d) {
  const bs = batches(d);
  if (!bs.length) return '<p class="empty">Nog niets te verdelen.</p>';
  return `${bs.map(b => `<section class="lay">
      <header><span class="bnr">${h(b.nummer)}</span><span><b>${h(regioName(d, b.regio))}</b><small>${[...b.lev].map(h).join(' · ')}</small></span></header>
      <ul>${b.klanten.map(k => `<li><b>${h(k.klant)}</b><span class="its">${k.items.map(it => `<span class="it"><em>${fNum(it.dozen)}</em> ${h(it.product)} ${h(it.maat)}</span>`).join('')}</span></li>`).join('')}</ul>
    </section>`).join('')}
    <p><button type="button" class="btn btn-sm btn-line" data-act="print">${icon('file')}Lijst printen voor de hal</button></p>`;
}

// ---------------------------------------------------------------- 4 check and change: other numbers, or a customer out
function review(d) {
  const ls = lines(d);
  if (!ls.length) return '<p class="empty">Nog niets te verdelen.</p>';
  const done = new Set(d.akkoord), out = new Set(d.eruit.map(x => x.klant_id));
  const per = new Map();
  for (const r of ls) for (const v of r.verdeling) {
    if (out.has(v.klant_id) || (v.dozen === 0 && v.door === 'desk')) continue;
    if (!per.has(v.klant_id)) per.set(v.klant_id, { klant_id: v.klant_id, klant: v.klant, items: [], jan: false });
    const x = per.get(v.klant_id);
    x.items.push({ r, v });
    if (v.door === 'jan') x.jan = true;
  }
  const ks = [...per.values()].sort((a, b) => a.klant.localeCompare(b.klant, 'nl'));
  const short_ = new Map(d.tekort.map(t => [t.klant_id, t]));
  const over = ls.filter(r => r.rest > 0), too = ls.filter(r => r.rest < 0);
  const head = too.length ? ['bad', icon('warn'), `Meer verdeeld dan er is bij ${too.length} ${too.length === 1 ? 'regel' : 'regels'}.`]
    : over.length ? ['wait', icon('info'), `${fNum(sum(over, r => r.rest))} dozen hebben nog geen klant.`]
      : ['ok', icon('check'), 'Netto nul: elke doos heeft een klant.'];
  return `${too.length ? `<div class="nz ${head[0]}">${head[1]}<div><p><b>${head[2]}</b></p></div></div>` : ''}
    <ul class="rv">${ks.map(k => {
      const t = short_.get(k.klant_id), locked = done.has(k.klant_id);
      return `<li class="${locked ? 'is-locked' : ''}">
        <div class="rv-h"><b>${h(k.klant)}</b>${t ? '<span class="lt t-wait" title="Krijgt minder dan gevraagd">minder</span>' : ''}${locked ? `<span class="chip ok">${icon('check')}pakbon akkoord</span>` : ''}
          <span class="rv-a">${k.jan && !locked ? `<button type="button" class="lnk small" data-act="reset" data-k="${k.klant_id}">Terug naar voorstel</button>` : ''}
          ${locked ? '' : `<button type="button" class="btn btn-sm btn-ghost danger" data-act="eruit" data-k="${k.klant_id}" data-n="${h(k.klant)}">Eruit</button>`}</span></div>
        <div class="rv-i">${k.items.map(({ r, v }) => `<label class="hk${v.door !== 'desk' ? ' is-jan' : ''}"><span>${h(r.product)} ${h(r.maat)} <small>${h(r.nummer)}</small></span>
          <input type="number" min="0" max="9999" value="${v.dozen}" data-r="${r.id}" data-k="${k.klant_id}"${locked ? ' disabled' : ''} aria-label="${h(`${k.klant}: ${r.product} ${r.maat}`)}"></label>`).join('')}</div>
      </li>`;
    }).join('')}</ul>
    ${over.length ? `<details class="free"${opened.has('vrij') ? ' open' : ''}><summary><b>${fNum(sum(over, r => r.rest))} dozen vrij</b> <span class="small muted">blijven in de loods, of geef ze aan iemand</span></summary>${over.map(r => {
      const sug = (d.over.find(o => o.regel_id === r.id)?.suggesties || [])[0];
      return `<div class="free-i"><span><b>${fNum(r.rest)}</b> ${h(r.product)} ${h(r.maat)} <small>${h(r.nummer)}</small></span>
        ${sug ? `<span class="free-s"><button type="button" class="btn btn-sm btn-line" data-act="give" data-r="${r.id}" data-k="${sug.klant_id}" data-n="${r.rest}" title="${h(sug.reden)}">Aan ${h(short(sug.klant))}</button></span>` : ''}</div>`;
    }).join('')}</details>` : ''}
    ${d.eruit.length ? `<div class="outk"><h3 class="h3s">Eruit deze week</h3>${d.eruit.map(x => `<div class="outk-i"><span><b>${h(x.klant)}</b> <small>vroeg ${fNum(x.gevraagd)} dozen</small></span>
      <button type="button" class="btn btn-sm btn-line" data-act="reset" data-k="${x.klant_id}">Terugzetten</button></div>`).join('')}</div>` : ''}
    <div class="ok-row">${d.nagekeken ? `<span class="chip ok">${icon('check')}Nagekeken ${h(dayTime(d.nagekeken_op))}</span><button type="button" class="lnk small" data-act="nagekeken" data-terug="1">Weer openzetten</button>`
      : `<button type="button" class="btn btn-leaf" data-act="nagekeken"${too.length || !d.partijen.filter(p => p.regels.length).every(p => p.binnen_op) ? ' disabled' : ''}>${icon('check')}Klopt, naar de pakbonnen</button>
        <span class="small muted">${too.length ? 'Eerst wat te veel verdeeld is aanpassen.' : d.partijen.filter(p => p.regels.length).every(p => p.binnen_op) ? 'Daarna maak je de pakbonnen en facturen.' : 'Kan als alle zendingen binnen zijn.'}</span>`}</div>`;
}

// ---------------------------------------------------------------- 5 packing slip and invoice, drafts in Outlook
function slipsStep(d, s, st) {
  if (!s) return '<p class="empty">De pakbonnen laden…</p>';
  const list = s.slips.filter(x => x.regels.length);
  if (!list.length) return '<p class="empty">Nog geen pakbonnen: er is nog niets verdeeld.</p>';
  const ready = list.filter(x => x.status === 'klaar'), done = list.filter(x => x.status === 'akkoord'), wait = list.filter(x => x.status === 'wacht');
  const why = !d.koers ? 'Zet eerst de koers vast (stap 1).' : !st.binnen ? 'Vink eerst alle zendingen af als binnen (stap 2).' : wait[0]?.reden || '';
  const outlook = s.outlook && s.outlook.doel;
  const all = done.length === list.length;
  const how = outlook ? `De facturen staan als concept in Outlook${s.outlook.account ? ` (${h(s.outlook.account)})` : ''}; jij verstuurt ze.`
    : 'Outlook is nog niet gekoppeld: "Open in Outlook" zet elke factuur klaar als nieuwe mail met de pdf. Koppel Outlook bij <a href="#/koppelingen">Koppelingen</a>, dan staan ze allemaal tegelijk bij Concepten.';
  return `<div class="mk">
      ${all ? `<span class="chip ok">${icon('check')}${done.length === 1 ? 'De pakbon en factuur is gemaakt' : `Alle ${done.length} pakbonnen en facturen zijn gemaakt`}</span>`
        : `<button type="button" class="btn btn-leaf" data-act="maak"${ready.length ? '' : ' disabled'}>${icon('file')}${ready.length ? `Maak ${ready.length} ${ready.length === 1 ? 'pakbon en factuur' : 'pakbonnen en facturen'}` : 'Pakbonnen maken'}</button>`}
      <p class="small muted">${ready.length || done.length ? `In euro${d.koers ? ` (1 € = $ ${fKoers(d.koers)})` : ''}, met het plantenpaspoort per soort en batch. ${how}` : h(why)}</p>
    </div>
    <ul class="mslips">${list.map(x => {
      const ok = x.status === 'akkoord', c = x.concept;
      return `<li><a href="#/pakbon/${x.klant_id}?maandag=${d.maandag}"><b>${h(x.klant)}</b></a>
        <span class="mslips-s">${ok ? `<span class="chip ok">${icon('check')}${h(x.pakbon.nummer)}</span>${c && c.status === 'verstuurd' ? `<span class="chip ok">${icon('mail')}verstuurd</span>` : c && c.status === 'in_outlook' ? `<span class="chip brass">${icon('mail')}in Outlook</span>` : `<a class="chip dash" href="/api/week/pakbonnen/${x.pakbon.id}/eml">${icon('out')}Open in Outlook</a>`}`
          : x.status === 'klaar' ? '<span class="chip info">klaar</span>' : `<span class="chip wait" title="${h(x.reden || '')}">${icon('clock')}wacht</span>`}</span></li>`;
    }).join('')}</ul>`;
}

// ---------------------------------------------------------------- 6 the Excel for Exact
function exactStep(d, s) {
  const done = (s?.slips || []).filter(x => x.status === 'akkoord');
  if (!done.length) return '<p class="empty">Eerst de pakbonnen en facturen (stap 5).</p>';
  const open = done.filter(x => x.pakbon.exact !== 'in_exact');
  const ex = s?.exact || { kan: false };
  const where = ex.bron === 'demo' ? 'het demo-Exact' : 'Exact';
  return `${open.length ? `<div class="mk"><button type="button" class="btn btn-leaf" data-act="exact-zet"${ex.kan ? '' : ' disabled'}>${icon('check')}Zet ${open.length} ${open.length === 1 ? 'factuur' : 'facturen'} in ${where}</button>
      <p class="small muted">${ex.kan ? `Elke regel met het batchnummer als kostendrager. Daarna kijkt <a href="#/controle?deel=exact">Controle</a> of alles goed in Exact staat.` : h(ex.waarom || '')}</p></div>`
      : `<p><span class="chip ok">${icon('check')}Alles staat in Exact</span> <a class="lnk small" href="#/controle?deel=exact">Naar de controle</a></p>`}
    <p class="xcols">${['Plantensoort', 'Grootte', 'Hoeveelheid', 'Prijs per eenheid', 'Plantenpaspoortnummer', 'Klant', 'Plantenpaspoortnummer'].map(c => `<span>${c}</span>`).join('<i aria-hidden="true">›</i>')}</p>
    <p class="acts-row"><a class="btn btn-line" href="/api/week/weken/${d.maandag}/exact.xlsx">${icon('db')}Excel voor Exact</a>
      ${open.length && !ex.kan ? `<button type="button" class="btn btn-ghost" data-act="exact-all">${icon('check')}Met de hand in Exact gezet</button>` : ''}</p>
    <p class="small faint">De Excel heeft één regel per factuurregel, in euro. Het plantenpaspoortnummer is het batchnummer; de tweede keer als kostendrager.</p>`;
}

// what goes on whose pallet, printed for the hall: per batch, then per customer
function hallList(d) {
  return `<section class="print-only hall"><h1>Verdeellijst week ${d.week} · ${h(dLong(d.maandag))}</h1>
    ${batches(d).map(b => `<h2>${h(b.nummer)} · ${h(regioName(d, b.regio))}</h2>${b.klanten.map(k => `<div class="hall-k"><h3>${h(k.klant)} <small>${fNum(sum(k.items, i => i.dozen))} dozen</small></h3>
      <table>${k.items.map(i => `<tr><td>${fNum(i.dozen)}</td><td>${h(i.product)} ${h(i.maat)}</td><td class="ht"></td></tr>`).join('')}</table></div>`).join('')}`).join('')}</section>`;
}

function summary(key, d, s) {
  const ps = d.partijen.filter(p => p.regels.length), inn = ps.filter(p => p.binnen_op).length;
  const done = (s?.slips || []).filter(x => x.status === 'akkoord'), list = (s?.slips || []).filter(x => x.regels.length);
  return {
    koers: d.koers ? `1 € = $ ${fKoers(d.koers)}` : 'nog invullen',
    binnen: ps.length ? `${inn} van ${ps.length} binnen` : 'geen zendingen',
    leggen: `${batches(d).length} ${batches(d).length === 1 ? 'batch' : 'batches'}`,
    check: [d.eruit.length ? `${d.eruit.length} eruit` : '', lines(d).some(r => r.rest < 0) ? 'te veel verdeeld' : lines(d).some(r => r.rest > 0) ? `${fNum(sum(lines(d).filter(r => r.rest > 0), r => r.rest))} vrij` : 'netto nul'].filter(Boolean).join(' · '),
    pakbon: list.length ? `${done.length} van ${list.length} gemaakt` : '–',
    exact: done.length ? `${done.filter(x => x.pakbon.exact === 'in_exact').length} van ${done.length} in Exact` : '–',
  }[key];
}

export async function render(params, query) {
  const m = query.get('maandag');
  const d = await api(`/week/maandag${m ? `?maandag=${m}` : ''}`);
  const s = await api(`/week/pakbonnen?maandag=${d.maandag}`).catch(() => null);
  last = d; slipsOf = s;
  const st = state(d, s);
  const up = STEPS.find(([k]) => !st[k])?.[0] || null;
  const want = query.get('deel'), alias = { tellen: 'binnen', verdelen: 'check' };
  // while Jan checks, the hand-out per region and customer stays open above it: that is when he lays the boxes out
  const openKey = k => !closed.has(k) && (k === up || (k === 'leggen' && up === 'check') || opened.has(k) || (want && (alias[want] || want) === k));
  const body = { koers: () => rate(d), binnen: () => arrivals(d), leggen: () => layout(d), check: () => review(d), pakbon: () => slipsStep(d, s, st), exact: () => exactStep(d, s) };
  const early = d.vandaag < d.maandag;
  return `<div class="page wk monday">
    <div class="mon-top"><div><h1>Maandag</h1><p class="small muted">${early ? `Week ${d.week}: de dozen komen ${h(dLong(d.maandag))}. Je kunt alvast kijken.` : `Week ${d.week}, ${h(dLong(d.maandag))}.`}</p></div>
      <div class="acts">${weekNav('maandag', d.maandag)}</div></div>
    <ol class="stepper" aria-label="Stappen">${STEPS.map(([k, l], i) => `<li class="${st[k] ? 'is-done' : k === up ? 'is-up' : ''}"><a href="#mon-${k}" data-act="step" data-k="${k}"><span class="n">${st[k] ? icon('check') : i + 1}</span>${l}</a></li>`).join('')}</ol>
    <div class="mon2">${STEPS.map(([k, l], i) => {
      const isOpen = openKey(k);
      return `<section class="panel mstep${isOpen ? ' is-open' : ''}${st[k] ? ' is-done' : ''}" id="mon-${k}">
        <header><button type="button" class="mstep-h" data-act="step" data-k="${k}" aria-expanded="${isOpen}"><span class="n">${st[k] ? icon('check') : i + 1}</span><b>${l}</b><span class="mstep-s">${h(summary(k, d, s))}</span></button></header>
        ${isOpen ? `<div class="body">${body[k]()}</div>` : ''}
      </section>`;
    }).join('')}</div>
    ${hallList(d)}
  </div>`;
}

const put = (regel_id, klant_id, dozen) => api('/week/verdeling', { method: 'PUT', body: { regel_id, klant_id, dozen } });

export function mount(ctx) {
  const f = document.querySelector('[data-form="koers"]');
  if (f) f.addEventListener('submit', async e => {
    e.preventDefault();
    const v = f.koers.value.trim();
    const prev = last.koersen[last.koersen.length - 1];
    const k = Number(v.replace(',', '.'));
    const go = async () => { await api(`/week/weken/${last.maandag}/koers`, { method: 'POST', body: { koers: v } }); toast(`Koers vastgezet: 1 € = $ ${fKoers(k)}.`); ctx.refresh(); };
    // a typo in the rate would end up on every invoice of the week: a big jump is asked once more
    if (prev && Number.isFinite(k) && Math.abs(k - prev.koers) / prev.koers > 0.05) {
      dialog({ title: 'Klopt deze koers?', ok: `Ja, ${v}`, body: `<p>1 € = $ ${h(v)} is meer dan 5% anders dan vorige week (${fKoers(prev.koers)}). Alle facturen van deze week rekenen ermee.</p>`, onOk: go });
      return;
    }
    await go().catch(x => toast(x.message));
  });
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const want = q.get('deel');
  if (want) { const el = document.getElementById(`mon-${({ tellen: 'binnen', verdelen: 'check' })[want] || want}`); if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 30); }
}

export async function onChange(e, ctx) {
  const el = e.target;
  if (!el.dataset.r || !el.dataset.k) return;
  const n = Math.max(0, Math.round(Number(el.value) || 0));
  await put(Number(el.dataset.r), Number(el.dataset.k), n).then(() => toast('Aangepast.')).catch(x => toast(x.message));
  opened.add('check');
  ctx.refresh();
}

export const actions = {
  print: () => { window.print(); },
  step: async (el, ctx) => {
    const k = el.dataset.k, sec = document.getElementById(`mon-${k}`), fromHead = el.classList.contains('mstep-h');
    const close = fromHead && sec && sec.classList.contains('is-open');
    if (close) { opened.delete(k); closed.add(k); } else { closed.delete(k); opened.add(k); }
    await ctx.refresh();
    if (!close) document.getElementById(`mon-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'koers-edit': (el, ctx) => dialog({
    title: `Koers week ${last.week}`, ok: 'Opslaan',
    body: `<label class="f">1 euro = hoeveel dollar<input name="koers" value="${fKoers(last.koers)}" inputmode="decimal"></label><p class="small faint" style="margin-top:8px">Pakbonnen die al gemaakt zijn houden hun koers. Heropen ze als die mee moeten.</p>`,
    onOk: async v => { await api(`/week/weken/${last.maandag}/koers`, { method: 'POST', body: { koers: v.koers } }); toast('Koers aangepast.'); ctx.refresh(); },
  }),
  // a shipment in (or back): the counted numbers from the table, only where Jan changed them
  binnen: async (el, ctx) => {
    const id = Number(el.dataset.p), p = last.partijen.find(x => x.id === id), inn = !!p.binnen_op;
    if (inn) {
      return dialog({ title: `${short(p.leverancier)} niet binnen?`, ok: 'Terugzetten', body: '<p>De telling van deze zending gaat terug naar wat de papieren zeggen, en op het Overzicht staat hij weer onderweg.</p>',
        onOk: async () => { await api(`/week/partijen/${id}/binnen`, { method: 'POST', body: { binnen: false } }); toast('Teruggezet.'); ctx.refresh(); } });
    }
    const box = document.getElementById(`arr${id}`), regels = [];
    for (const i of box.querySelectorAll('input[name^="g"]')) {
      const rid = Number(i.name.slice(1)), u = box.querySelector(`input[name="u${rid}"]`);
      if (Number(i.value) !== Number(i.dataset.exp) || Number(u?.value)) regels.push({ id: rid, geteld: Number(i.value), uitval: Number(u?.value) || 0 });
    }
    el.disabled = true;
    await api(`/week/partijen/${id}/binnen`, { method: 'POST', body: { binnen: true, regels } }).catch(x => { el.disabled = false; throw x; });
    toast(`${short(p.leverancier)} is binnen${regels.length ? `, ${regels.length} ${regels.length === 1 ? 'regel' : 'regels'} anders geteld` : ''}. Op het Overzicht staat hij op groen.`);
    ctx.refresh();
  },
  give: async (el, ctx) => {
    const r = last.partijen.flatMap(p => p.regels).find(x => x.id === Number(el.dataset.r));
    const cur = r.verdeling.find(v => v.klant_id === Number(el.dataset.k));
    await put(r.id, Number(el.dataset.k), (cur ? cur.dozen : 0) + Number(el.dataset.n));
    opened.add('check'); opened.add('vrij'); toast('Gegeven.'); ctx.refresh();
  },
  reset: async (el, ctx) => {
    await api(`/week/weken/${last.maandag}/voorstel`, { method: 'POST', body: { klant_id: Number(el.dataset.k) } });
    opened.add('check'); toast('Terug naar het voorstel.'); ctx.refresh();
  },
  nagekeken: async (el, ctx) => {
    await api(`/week/weken/${last.maandag}/nagekeken`, { method: 'POST', body: { terug: !!el.dataset.terug } });
    if (el.dataset.terug) opened.add('check'); else { opened.delete('check'); closed.delete('pakbon'); }
    toast(el.dataset.terug ? 'De verdeling staat weer open.' : 'Nagekeken. Nu de pakbonnen en facturen.');
    await ctx.refresh();
    if (!el.dataset.terug) document.getElementById('mon-pakbon')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  eruit: (el, ctx) => dialog({
    title: `${el.dataset.n} eruit deze week?`, ok: 'Eruit', danger: true,
    body: '<p>Hij krijgt deze week niets en er komt geen pakbon. Zijn dozen gaan naar wie meer vroeg, of blijven vrij. Je kunt hem terugzetten zolang de pakbonnen nog niet gemaakt zijn.</p>',
    onOk: async () => { await api(`/week/weken/${last.maandag}/klant-eruit`, { method: 'POST', body: { klant_id: Number(el.dataset.k) } }); opened.add('check'); toast(`${el.dataset.n} staat eruit.`); ctx.refresh(); },
  }),
  maak: (el, ctx) => {
    const ready = slipsOf.slips.filter(x => x.status === 'klaar');
    dialog({
      title: `${ready.length} ${ready.length === 1 ? 'pakbon en factuur' : 'pakbonnen en facturen'} maken`, ok: 'Maken',
      body: `<p>Elke klant krijgt een factuurnummer en een pakbon in euro (1 € = $ ${fKoers(last.koers)}) met het plantenpaspoort. ${slipsOf.outlook?.doel ? 'De facturen komen als concept in Outlook.' : 'Per factuur staat de mail klaar met "Open in Outlook".'} Er gaat niets vanzelf de deur uit.</p>`,
      onOk: async () => {
        const r = await api('/week/pakbonnen/akkoord', { method: 'POST', body: { maandag: last.maandag } });
        opened.add('pakbon'); opened.add('exact');     // the list stays in view: per invoice the mail, or "in Outlook"
        toast(`${r.nummers.length} ${r.nummers.length === 1 ? 'pakbon' : 'pakbonnen'} gemaakt${r.inOutlook ? `, ${r.inOutlook} als concept in Outlook` : ''}.`);
        ctx.refresh();
      },
    });
  },
  'exact-zet': (el, ctx) => {
    const n = slipsOf.slips.filter(x => x.status === 'akkoord' && x.pakbon.exact !== 'in_exact').length;
    const where = slipsOf.exact?.bron === 'demo' ? 'het demo-Exact' : 'Exact';
    dialog({
      title: 'In Exact zetten', ok: 'Zet in Exact',
      body: `<p>${n} ${n === 1 ? 'factuur gaat' : 'facturen gaan'} naar ${where}, elke regel met het batchnummer als kostendrager.</p><p class="small faint">Ze zijn al door jou goedgekeurd. Controle leest daarna terug wat er in Exact staat.</p>`,
      onOk: async () => {
        const r = await api('/week/exact/zet', { method: 'POST', body: { maandag: last.maandag, soort: 'verkoop' } });
        toast(`${r.gezet} in Exact gezet${r.fouten.length ? `; niet gelukt: ${r.fouten[0].ref}: ${r.fouten[0].fout}` : ''}.`);
        ctx.refresh();
      },
    });
  },
  'exact-all': (el, ctx) => {
    const ids = slipsOf.slips.filter(x => x.status === 'akkoord' && x.pakbon.exact !== 'in_exact').map(x => x.pakbon.id);
    dialog({
      title: 'Staat in Exact', ok: 'Ja, staat erin',
      body: `<p>${ids.length} ${ids.length === 1 ? 'factuur staat' : 'facturen staan'} met de Excel in Exact. Zo houdt de desk bij wat er nog moet.</p>`,
      onOk: async () => { await api('/week/pakbonnen/exact', { method: 'POST', body: { ids } }); toast('Genoteerd: staat in Exact.'); ctx.refresh(); },
    });
  },
};
