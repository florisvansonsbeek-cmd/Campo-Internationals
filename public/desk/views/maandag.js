// Maandag: the boxes come in and go out, in five steps.
// 1 the dollar rate of the week. 2 in: per shipment what really came in. The desk filled in what the papers say; Jan
// changes a number with − and + and ticks the shipment off (on the Overzicht it turns green). 3 the hand-out per region
// and customer, checked and changed in one place: drag a line to the customer it belongs to, or to the loods; − and +
// for the numbers; what is free in the loods folds out below and drags to a customer just the same. 4 the packing
// slips and invoices (in euro, with the plant passports) as drafts in Outlook. 5 Exact: every entry as Exact holds it.
// The desk did the groundwork; Jan changes and moves. Nothing leaves the desk without him.
import { api, h, icon, fNum, toast, dialog } from '../core.js';
import { spark } from '../charts.js';
import { weekNav, dLong, dayTime, fKoers } from '../wk.js';

let last = null, slipsOf = null, exactOf = null, ctxRef = null, draftWeek = null;
const opened = new Set(), closed = new Set();     // steps (and the loods) Jan opened or closed himself
const STEPS = [['koers', 'Koers'], ['binnen', 'Binnen'], ['verdelen', 'Verdelen'], ['pakbon', 'Pakbon en factuur'], ['exact', 'Exact']];
const ALIAS = { tellen: 'binnen', leggen: 'verdelen', check: 'verdelen', controleren: 'verdelen', vrij: 'verdelen' };
const draft = new Map();                          // counts Jan changed and did not save yet: regel id → { g, u }
const shipOpen = new Set();                       // shipments that are in, opened again to change a count
const saveT = new Map();

const short = n => String(n || '').replace(/ (S\.A\.|B\.V\.|GmbH|Ltd)$/, '');
const sum = (a, f) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const lines = d => d.partijen.flatMap(p => p.regels.map(r => ({ ...r, nummer: p.nummer, regio: p.regio, partij_id: p.id, leverancier: p.leverancier })));
const regioName = (d, code) => (d.regios || []).find(g => g.code === code)?.naam || code;
const money = (v, cur = 'EUR') => `${cur === 'USD' ? '$' : '€'} ${Number(v || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const unit = (v, cur = 'EUR') => `${cur === 'USD' ? '$' : '€'} ${Number(v || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const dmy = s => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : '–');

// ---------------------------------------------------------------- which step is done
function state(d, s) {
  const ls = lines(d), withLines = d.partijen.filter(p => p.regels.length);
  const allIn = withLines.length > 0 && withLines.every(p => p.binnen_op);
  const slips = (s?.slips || []).filter(x => x.regels.length);
  const done = slips.filter(x => x.status === 'akkoord');
  return {
    koers: !!d.koers,
    binnen: allIn,
    // Jan says the hand-out is right (free boxes may stay in the loods; more than there is may not), or the slips are made
    verdelen: allIn && !ls.some(r => r.rest < 0) && (d.nagekeken || done.length > 0),
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

// ---------------------------------------------------------------- 2 in: what really came in, per shipment and line
const expOf = r => r.verzonden ?? r.bevestigd ?? r.besteld ?? 0;
const cntOf = r => { const x = draft.get(r.id); return { g: x?.g ?? r.geteld ?? expOf(r), u: x?.u ?? r.uitval ?? 0 }; };
function stepper(f, r, v, label, extra = '') {
  return `<span class="stp${f === 'u' ? ' sm' : ''}"><button type="button" class="stp-b" data-act="cnt" data-r="${r.id}" data-f="${f}" data-d="-1" aria-label="${h(label)}: één minder"${v <= 0 ? ' disabled' : ''}>${icon('minus')}</button><input type="number" inputmode="numeric" min="0" max="9999" value="${v}" data-cnt="${f}" data-r="${r.id}" aria-label="${h(label)}"${extra}><button type="button" class="stp-b" data-act="cnt" data-r="${r.id}" data-f="${f}" data-d="1" aria-label="${h(label)}: één meer">${icon('plus')}</button></span>`;
}
function arrivals(d) {
  const ps = d.partijen.filter(p => p.regels.length);
  if (!ps.length) return '<p class="empty">Er zijn deze week geen zendingen.</p>';
  const notIn = ps.filter(p => !p.binnen_op);
  return `<div class="in-top"><p class="small muted">De desk vulde in wat de papieren zeggen. Pas met − en + aan wat er echt binnen is en vink de zending af. Kapot telt mee bij geteld, maar gaat naar niemand.</p>
      ${notIn.length > 1 ? `<button type="button" class="btn btn-sm btn-line" data-act="alles-binnen">${icon('check')}Alle ${notIn.length} zendingen binnen</button>` : ''}</div>
    <div class="ships">${ps.map(p => ship(d, p)).join('')}</div>`;
}
function shipFacts(p) {
  const rows = p.regels.map(r => ({ r, exp: expOf(r), ...cntOf(r) }));
  return { rows, total: sum(rows, x => x.g), diff: rows.filter(x => x.g !== x.exp || x.u).length, pending: rows.filter(x => draft.has(x.r.id)).length };
}
const shipLine = f => `<b>${fNum(f.total)}</b> dozen${f.diff ? ` · <span class="t-wait">${f.diff} ${f.diff === 1 ? 'regel' : 'regels'} anders dan de papieren</span>` : ''}`;
const pendingText = f => (f.pending ? `${f.pending} ${f.pending === 1 ? 'regel' : 'regels'} aangepast. Vink de zending af om het op te slaan.` : '');
function ship(d, p) {
  const inn = !!p.binnen_op, show = !inn || shipOpen.has(p.id), f = shipFacts(p);
  return `<section class="ship${inn ? ' is-in' : ''}" id="arr${p.id}">
    <header class="ship-h">
      <button type="button" class="tick" data-act="binnen" data-p="${p.id}" aria-pressed="${inn}" aria-label="${h(`${p.leverancier} ${inn ? 'is binnen; klik om terug te zetten' : 'binnen melden'}`)}">${icon('check')}</button>
      <div class="ship-t"><b>${h(short(p.leverancier))}</b><span>${h(p.nummer)} · ${h(regioName(d, p.regio))}</span></div>
      <div class="ship-s">${inn ? `<span class="st t-ok"><i aria-hidden="true"></i>Binnen ${h(dayTime(p.binnen_op))}</span>` : `<span class="small muted">${p.docsIn ? 'volgens het verzendbewijs' : 'volgens de bevestiging'}</span>`}<small class="ship-n">${shipLine(f)}</small></div>
      ${inn ? `<button type="button" class="btn btn-sm btn-ghost" data-act="ship-open" data-p="${p.id}" aria-expanded="${show}">${show ? 'Klaar' : `${icon('edit')}Aanpassen`}</button>` : ''}
    </header>
    ${show ? `<div class="tbwrap"><table class="tb cnt"><thead><tr><th>Plant</th><th class="r">Papieren</th><th class="c">Geteld</th><th class="c">Kapot</th></tr></thead><tbody>
      ${f.rows.map(({ r, exp, g, u }) => `<tr class="${g !== exp || u ? 'is-ch' : ''}" data-row="${r.id}"><td><b>${h(r.product)} ${h(r.maat)}</b><small>${fNum(r.per_doos)} per doos</small></td><td class="r num">${fNum(exp)}</td>
        <td class="c">${stepper('g', r, g, `Geteld ${r.product} ${r.maat}`)}</td><td class="c">${stepper('u', r, u, `Kapot ${r.product} ${r.maat}`)}</td></tr>`).join('')}
      </tbody></table></div>
      ${inn ? '<p class="small faint ship-f">Een ander getal slaat de desk meteen op; de verdeling rekent ermee.</p>' : `<p class="small ship-f t-wait"${f.pending ? '' : ' hidden'}>${pendingText(f)}</p>`}` : ''}
  </section>`;
}
// a count changed: shown at once; for a shipment that is in it is saved after a moment, otherwise with the tick
function changeCount(id, f, v) {
  const p = last.partijen.find(x => x.regels.some(r => r.id === id)), r = p?.regels.find(x => x.id === id);
  if (!r) return;
  const next = { ...cntOf(r), [f]: Math.max(0, Math.min(9999, Math.round(Number(v) || 0))) };
  next.u = Math.min(next.u, next.g);     // never more broken than counted
  draft.set(id, next);
  paintShip(p);
  if (p.binnen_op) { clearTimeout(saveT.get(p.id)); saveT.set(p.id, setTimeout(() => saveCounts(p), 700)); }
}
function paintShip(p) {
  const sec = document.getElementById(`arr${p.id}`);
  if (!sec) return;
  const f = shipFacts(p);
  const n = sec.querySelector('.ship-n');
  if (n) n.innerHTML = shipLine(f);
  const note = sec.querySelector('.ship-f.t-wait');
  if (note) { note.textContent = pendingText(f); note.hidden = !f.pending; }
  for (const x of f.rows) {
    const tr = sec.querySelector(`tr[data-row="${x.r.id}"]`);
    if (!tr) continue;
    tr.classList.toggle('is-ch', x.g !== x.exp || x.u > 0);
    for (const k of ['g', 'u']) {
      const inp = tr.querySelector(`input[data-cnt="${k}"]`);
      if (inp && document.activeElement !== inp) inp.value = x[k];
      const minus = tr.querySelector(`button[data-f="${k}"][data-d="-1"]`);
      if (minus) minus.disabled = x[k] <= 0;
    }
  }
}
async function saveCounts(p) {
  const regels = p.regels.filter(r => draft.has(r.id)).map(r => ({ id: r.id, geteld: draft.get(r.id).g, uitval: draft.get(r.id).u }));
  if (!regels.length) return;
  try {
    await api(`/week/partijen/${p.id}/binnen`, { method: 'POST', body: { binnen: true, regels } });
    regels.forEach(x => draft.delete(x.id));
    toast(`Telling van ${short(p.leverancier)} aangepast. De verdeling rekent ermee.`);
  } catch (x) { toast(x.message); }
  ctxRef?.refresh();
}
const draftsOf = p => p.regels.filter(r => draft.has(r.id)).map(r => ({ id: r.id, geteld: draft.get(r.id).g, uitval: draft.get(r.id).u }));

// ---------------------------------------------------------------- 3 the hand-out: per region and customer, drag to change
function board(d) {
  const ls = lines(d);
  if (!ls.length) return '<p class="empty">Nog niets te verdelen.</p>';
  const allIn = d.partijen.filter(p => p.regels.length).every(p => p.binnen_op);
  const locked = new Set(d.akkoord), out = new Set(d.eruit.map(x => x.klant_id));
  const plaats = new Map((d.alleKlanten || []).map(k => [k.id, k.plaats]));
  const over = ls.filter(r => r.rest > 0), too = ls.filter(r => r.rest < 0), free = sum(over, r => r.rest);
  const anyJan = (d.vast || []).length > 0 || ls.some(r => r.verdeling.some(v => v.door === 'jan'));
  const short_ = new Map();
  for (const t of d.tekort || []) { if (!out.has(t.klant_id)) short_.set(t.klant_id, [...(short_.get(t.klant_id) || []), t]); }
  const head = too.length ? ['bad', 'warn', `Te veel verdeeld bij ${too.map(r => `${r.product} ${r.maat} (${r.nummer}): ${-r.rest} ${-r.rest === 1 ? 'doos' : 'dozen'}`).join(', ')}. Haal er dozen af of zet ze in de loods.`]
    : free ? ['wait', 'stock', `${fNum(free)} ${free === 1 ? 'doos staat' : 'dozen staan'} nog vrij in de loods. Klap de loods onderaan open en sleep ze naar een klant, of laat ze staan.`]
      : ['ok', 'check', 'Netto nul: elke doos heeft een klant.'];
  // per batch (region, week): who gets something from it, and who asked for one of its plants but got none of it
  const byB = new Map();
  for (const r of ls) {
    if (!byB.has(r.nummer)) byB.set(r.nummer, { nummer: r.nummer, regio: r.regio, lev: new Set(), pids: new Set(), dozen: 0, klanten: new Map() });
    const b = byB.get(r.nummer);
    b.lev.add(short(r.leverancier)); b.pids.add(r.product_id); b.dozen += r.avail;
    for (const v of r.verdeling) {
      if (v.dozen <= 0 || out.has(v.klant_id)) continue;
      if (!b.klanten.has(v.klant_id)) b.klanten.set(v.klant_id, { klant_id: v.klant_id, klant: v.klant, items: [] });
      b.klanten.get(v.klant_id).items.push({ r, v });
    }
  }
  for (const b of byB.values()) {
    for (const [kid, ts] of short_) {
      if (b.klanten.has(kid) || locked.has(kid)) continue;
      const mine = ts.filter(t => b.pids.has(t.product_id) && t.krijgt === 0);
      if (mine.length) b.klanten.set(kid, { klant_id: kid, klant: mine[0].klant, items: [], vroeg: mine });
    }
  }
  const chip = (r, v, k, lock, tip = '') => {
    const what = `${r.product} ${r.maat}`, mine = !!k;
    return `<li class="cl${v.door === 'jan' ? ' is-jan' : ''}${lock ? ' is-locked' : ''}" data-chip data-r="${r.id}" data-k="${mine ? k.klant_id : ''}" data-n="${v.dozen}" data-what="${h(what)}">
      <span class="grip" title="Sleep naar een andere klant of de loods" aria-hidden="true">${icon('grip')}</span>
      <b class="cl-p">${h(r.product)} <span class="nw">${h(r.maat)}</span></b><small class="cl-s">${mine ? '' : `${h(r.nummer)} · `}${h(short(r.leverancier))}${v.door === 'jan' ? ' · door jou' : ''}</small>
      ${mine ? `<span class="stp sm"><button type="button" class="stp-b" data-act="sh" data-r="${r.id}" data-k="${k.klant_id}" data-d="-1" aria-label="${h(`${k.klant}, ${what}`)}: één doos minder"${lock || v.dozen <= 0 ? ' disabled' : ''}>${icon('minus')}</button><input type="number" inputmode="numeric" min="0" max="9999" value="${v.dozen}" data-share data-r="${r.id}" data-k="${k.klant_id}" aria-label="${h(`${k.klant}, ${what}`)}: dozen"${lock ? ' disabled' : ''}><button type="button" class="stp-b" data-act="sh" data-r="${r.id}" data-k="${k.klant_id}" data-d="1" aria-label="${h(`${k.klant}, ${what}`)}: één doos meer uit de loods"${lock || r.rest <= 0 ? ' disabled' : ''} title="${r.rest > 0 ? 'Eén doos meer, uit de loods' : 'Niets meer vrij van deze regel'}">${icon('plus')}</button></span>`
        : `<span class="cl-n"><b>${fNum(v.dozen)}</b> dz</span>`}
      ${lock ? '' : `<button type="button" class="ic mv" data-act="mv" data-r="${r.id}" data-k="${mine ? k.klant_id : ''}" data-n="${v.dozen}" data-what="${h(what)}" title="Verplaats naar…" aria-label="${h(`${what} verplaatsen`)}">${icon('move')}</button>`}${tip}
    </li>`;
  };
  const card = k => {
    const lock = locked.has(k.klant_id), n = sum(k.items, i => i.v.dozen), ts = short_.get(k.klant_id) || [];
    const minder = sum(ts, t => t.gevraagd - t.krijgt), jan = k.items.some(i => i.v.door === 'jan');
    return `<article class="vk${lock ? ' is-locked' : ''}${k.items.length ? '' : ' is-empty'}" data-drop="klant" data-k="${k.klant_id}" data-name="${h(k.klant)}">
      <header class="vk-h"><span class="vk-n"><b>${h(k.klant)}</b>${plaats.get(k.klant_id) ? `<small>${h(plaats.get(k.klant_id))}</small>` : ''}</span>
        <span class="vk-c">${fNum(n)} dz${minder > 0 ? ` <span class="lt t-wait" title="${h(ts.map(t => `vroeg ${t.gevraagd} × ${t.product}, krijgt ${t.krijgt}`).join('; '))}">−${fNum(minder)}</span>` : ''}</span></header>
      <ul class="vk-l">${k.items.map(i => chip(i.r, i.v, k, lock)).join('')}${k.items.length ? '' : `<li class="vk-e">Vroeg ${h((k.vroeg || []).map(t => `${fNum(t.gevraagd)} × ${t.product}`).join(', '))}, krijgt hier niets. Sleep een regel hierheen.</li>`}</ul>
      <footer class="vk-f">${lock ? `<span class="chip ok">${icon('check')}pakbon akkoord</span><a class="lnk small" href="#/pakbon/${k.klant_id}?maandag=${d.maandag}">heropen om te wijzigen</a>`
        : `${jan ? `<button type="button" class="vk-x" data-act="reset" data-k="${k.klant_id}">Terug naar voorstel</button>` : ''}${k.items.length ? `<button type="button" class="vk-x danger" data-act="eruit" data-k="${k.klant_id}" data-n="${h(k.klant)}">Eruit deze week</button>` : ''}`}</footer>
    </article>`;
  };
  const sug = new Map((d.over || []).map(o => [o.regel_id, o.suggesties || []]));
  const loods = `<details class="loods" id="loods" data-drop="loods"${opened.has('loods') ? ' open' : ''}>
      <summary><span class="ld-i">${icon('stock')}</span><b>Vrij in de loods</b><span class="ld-n${free ? ' t-wait' : ''}">${fNum(free)} ${free === 1 ? 'doos' : 'dozen'}</span><small>${free ? 'klap uit om te zien wat er staat' : 'alles heeft een klant'} · sleep een regel hierheen om hem in de loods te houden</small><span class="ld-c" aria-hidden="true">${icon('back')}</span></summary>
      ${free ? `<ul class="vk-l ld-l">${over.map(r => {
        const s = (sug.get(r.id) || [])[0];
        return chip(r, { dozen: r.rest, door: '' }, null, false, s ? `<span class="cl-x"><button type="button" class="vk-x" data-act="give" data-r="${r.id}" data-k="${s.klant_id}" data-n="${r.rest}" title="De desk stelt voor: ${h(s.reden)}">Aan ${h(short(s.klant))}</button> <span class="faint">${h(s.reden)}</span></span>` : '');
      }).join('')}</ul>` : '<p class="small muted ld-e">Niets vrij: elke doos heeft een klant.</p>'}
    </details>`;
  const bs = [...byB.values()].sort((a, b) => a.nummer.localeCompare(b.nummer));
  return `<div class="nz ${head[0]}">${icon(head[1])}<div><p><b>${h(head[2])}</b></p>${allIn ? '' : '<p class="nz-sub">Nog niet alles is binnen: dit is wat de papieren zeggen. Het staat vast als alle zendingen zijn afgevinkt.</p>'}</div></div>
    <div class="vd-bar"><p class="small muted"><span class="vd-g">${icon('grip')}</span>Sleep een regel naar de klant waar hij heen moet, of naar de loods. Met − en + pas je het aantal aan; met ${icon('move')} kies je zelf hoeveel en waarheen.</p>
      <span class="vd-a"><button type="button" class="btn btn-sm btn-line" data-act="print">${icon('file')}Lijst printen voor de hal</button>${anyJan ? '<button type="button" class="btn btn-sm btn-ghost" data-act="reset-all">Alles terug naar het voorstel</button>' : ''}</span></div>
    ${bs.map(b => {
      const ks = [...b.klanten.values()].sort((x, y) => (y.items.length > 0) - (x.items.length > 0) || x.klant.localeCompare(y.klant, 'nl'));
      return `<section class="vb">
        <header class="vb-h"><span class="bnr">${h(b.nummer)}</span><span class="vb-t"><b>${h(regioName(d, b.regio))}</b><small>${[...b.lev].map(h).join(' · ')}</small></span><span class="vb-c">${fNum(b.dozen)} dozen · ${fNum(ks.filter(k => k.items.length).length)} klanten</span></header>
        <div class="vb-g">${ks.map(card).join('')}<div class="vk vk-new" data-drop="ander" role="note"><span>${icon('plus')}</span><b>Andere klant</b><small>sleep een regel hierheen</small></div></div>
      </section>`;
    }).join('')}
    ${loods}
    ${d.eruit.length ? `<div class="outk"><h3 class="h3s">Eruit deze week</h3>${d.eruit.map(x => `<div class="outk-i"><span><b>${h(x.klant)}</b> <small>vroeg ${fNum(x.gevraagd)} dozen</small></span>
      <button type="button" class="btn btn-sm btn-line" data-act="reset" data-k="${x.klant_id}">Terugzetten</button></div>`).join('')}</div>` : ''}
    <div class="ok-row">${d.nagekeken ? `<span class="chip ok">${icon('check')}Nagekeken ${h(dayTime(d.nagekeken_op))}</span><button type="button" class="lnk small" data-act="nagekeken" data-terug="1">Weer openzetten</button>`
      : `<button type="button" class="btn btn-leaf" data-act="nagekeken"${too.length || !allIn ? ' disabled' : ''}>${icon('check')}Klopt, naar de pakbonnen</button>
        <span class="small muted">${too.length ? 'Eerst wat te veel verdeeld is aanpassen.' : allIn ? 'Daarna maak je de pakbonnen en facturen.' : 'Kan als alle zendingen binnen zijn.'}</span>`}</div>`;
}

// what goes on whose pallet, printed for the hall: per batch, then per customer
function batches(d) {
  const by = new Map();
  for (const r of lines(d)) {
    if (!by.has(r.nummer)) by.set(r.nummer, { nummer: r.nummer, regio: r.regio, klanten: new Map() });
    const b = by.get(r.nummer);
    for (const v of r.verdeling.filter(x => x.dozen > 0)) {
      if (!b.klanten.has(v.klant_id)) b.klanten.set(v.klant_id, { klant_id: v.klant_id, klant: v.klant, items: [] });
      b.klanten.get(v.klant_id).items.push({ regel_id: r.id, product: r.product, maat: r.maat, dozen: v.dozen });
    }
  }
  return [...by.values()].sort((a, b) => a.nummer.localeCompare(b.nummer)).map(b => ({ ...b, klanten: [...b.klanten.values()].sort((x, y) => x.klant.localeCompare(y.klant, 'nl')) }));
}
function hallList(d) {
  return `<section class="print-only hall"><h1>Verdeellijst week ${d.week} · ${h(dLong(d.maandag))}</h1>
    ${batches(d).map(b => `<h2>${h(b.nummer)} · ${h(regioName(d, b.regio))}</h2>${b.klanten.map(k => `<div class="hall-k"><h3>${h(k.klant)} <small>${fNum(sum(k.items, i => i.dozen))} dozen</small></h3>
      <table>${k.items.map(i => `<tr><td>${fNum(i.dozen)}</td><td>${h(i.product)} ${h(i.maat)}</td><td class="ht"></td></tr>`).join('')}</table></div>`).join('')}`).join('')}</section>`;
}

// ---------------------------------------------------------------- 4 packing slip and invoice, drafts in Outlook
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

// ---------------------------------------------------------------- 5 Exact: every entry as Exact holds it
const XST = { ok: ['ok', 'Klopt'], verschil: ['bad', 'Verschil'], mist: ['bad', 'Mist in Exact'], open: ['wait', 'Nog niet in Exact'] };
function entry(y, kind) {
  const [t, w] = XST[y.status] || ['info', y.status];
  const cur = y.valuta, code = kind === 'verkoop' ? y.debiteur : y.crediteur, who = kind === 'verkoop' ? y.klant : y.leverancier;
  const wrong = y.status === 'verschil' || y.status === 'mist';
  return `<li class="xw-i t-${t}"><details${wrong ? ' open' : ''}>
    <summary><span class="xw-n"><b>${h(kind === 'verkoop' ? y.nummer : `Batch ${y.nummer}`)}</b><small>${h(who)}${code ? ` · ${kind === 'verkoop' ? 'debiteur' : 'crediteur'} ${h(code)}` : ''}</small></span>
      <span class="xw-b num">${money(kind === 'verkoop' ? y.totaal : y.bedrag, cur)}</span><span class="chip ${t}">${w}</span><span class="xw-c" aria-hidden="true">${icon('back')}</span></summary>
    <div class="xb">
      <dl class="xb-h"><div><dt>${kind === 'verkoop' ? 'Verkoopboeking' : 'Inkoopboeking'}</dt><dd>${y.exact?.nummer ? h(y.exact.nummer) : '<span class="faint">nog geen nummer</span>'}</dd></div>
        <div><dt>Dagboek</dt><dd>${h(y.dagboek || '–')}</dd></div>
        <div><dt>Datum</dt><dd>${dmy(y.exact?.datum || y.datum)}</dd></div>
        <div><dt>${kind === 'verkoop' ? 'Debiteur' : 'Crediteur'}</dt><dd>${code ? h(code) : '<span class="t-bad">geen nummer</span>'} ${h(who)}</dd></div>
        <div><dt>Uw referentie</dt><dd>${h(kind === 'verkoop' ? y.nummer : `Batch ${y.nummer}`)}</dd></div>
        <div><dt>Valuta</dt><dd>${cur}</dd></div></dl>
      <div class="tbwrap"><table class="tb xbt"><thead><tr><th>Grootboek</th><th>Omschrijving</th><th class="r">Aantal</th><th class="r">Prijs</th><th class="r">Bedrag</th><th>Btw-code</th><th>Kostendrager</th></tr></thead><tbody>
        ${y.regels.map(l => `<tr><td>${h(y.grootboek || '–')}</td><td>${h(l.omschrijving)}</td><td class="r num">${fNum(l.stuks)}</td><td class="r num">${unit(l.prijs, cur)}</td><td class="r num">${money(l.bedrag, cur)}</td><td>${y.btw_code ? h(y.btw_code) : '<span class="faint">–</span>'}</td><td><span class="kd">${h(l.kostendrager)}</span></td></tr>`).join('')}
      </tbody><tfoot>
        <tr><td colspan="4">Totaal${kind === 'verkoop' ? ' excl. btw' : ''}</td><td class="r num">${money(y.bedrag, cur)}</td><td colspan="2"></td></tr>
        ${kind === 'verkoop' ? `<tr><td colspan="4">Btw ${y.btw_pct ? `${y.btw_pct}%` : y.btw_soort === 'verlegd' ? 'verlegd (0%)' : '0%, uitvoer'}</td><td class="r num">${money(y.btw)}</td><td colspan="2"></td></tr>
        <tr class="xbt-t"><td colspan="4">Totaal</td><td class="r num">${money(y.totaal)}</td><td colspan="2"></td></tr>` : ''}
      </tfoot></table></div>
      ${back(y, kind)}
    </div></details></li>`;
}
function back(y, kind) {
  if (y.status === 'open') return `<p class="small muted xb-n">${icon('clock')}Nog niet in Exact. Zo zet de desk hem erin, na jouw klik.</p>`;
  if (y.status === 'mist') return `<p class="small xb-n t-bad">${icon('warn')}De desk zegt "in Exact", maar Exact heeft hem niet. Zoek hem op in Exact, of zet hem er opnieuw in.</p>`;
  const kd = (y.exact?.regels || []).filter(r => r.kostendrager).map(r => `${h(r.kostendrager)} ${money(r.bedrag, y.valuta)}`).join(' · ');
  return `<div class="xb-back"><p class="small"><b>Teruggelezen uit Exact:</b> boekstuk ${h(y.exact?.nummer || '–')}, ${money(y.exact?.bedrag, y.valuta)}${kd ? `; per kostendrager ${kd}` : ''}.</p>
    ${y.verschillen.length ? `<ul class="xd">${y.verschillen.map(v => `<li>${h(v)}</li>`).join('')}</ul>` : `<p class="okline small">${icon('check')}Klopt met de desk: bedrag, ${kind === 'verkoop' ? 'debiteur, btw, ' : 'crediteur, '}kostendragers en datum.</p>`}</div>`;
}
function exactStep(d, s, x) {
  const done = (s?.slips || []).filter(y => y.status === 'akkoord');
  if (!done.length) return '<p class="empty">Eerst de pakbonnen en facturen (stap 4).</p>';
  const open = done.filter(y => y.pakbon.exact !== 'in_exact');
  const buys = x ? x.inkoop.filter(y => y.status === 'open') : [];
  const ex = s?.exact || { kan: false };
  const where = ex.bron === 'demo' ? 'het demo-Exact' : 'Exact';
  const btns = [open.length ? `<button type="button" class="btn btn-leaf" data-act="exact-zet"${ex.kan ? '' : ' disabled'}>${icon('check')}Zet ${open.length} ${open.length === 1 ? 'factuur' : 'facturen'} in ${where}</button>` : '',
    buys.length ? `<button type="button" class="btn ${open.length ? 'btn-line' : 'btn-leaf'}" data-act="exact-zet-inkoop"${ex.kan ? '' : ' disabled'}>${icon('check')}Zet ${buys.length} ${buys.length === 1 ? 'inkooporder' : 'inkooporders'} in ${where}</button>` : ''].filter(Boolean);
  const top = btns.length ? `<div class="mk"><div class="acts-row">${open.length ? '' : `<span class="chip ok">${icon('check')}De facturen van week ${d.week} staan in Exact</span>`}${btns.join('')}</div>
      <p class="small muted">${ex.kan ? 'Elke regel met het batchnummer als kostendrager. Hieronder zie je per boeking hoe hij in Exact komt, en daarna wat Exact teruggeeft.' : h(ex.waarom || '')}</p></div>`
    : `<p class="xw-all"><span class="chip ok">${icon('check')}Alles van week ${d.week} staat in Exact</span> <a class="lnk small" href="#/controle?deel=exact">Het hele jaar bij Controle</a></p>`;
  if (!x) return `${top}<p class="empty">Het overzicht uit Exact laden…</p>`;
  const src = x.bron === 'demo' ? `${icon('info')}Exact is nog niet gekoppeld. Dit is het demo-Exact: het doet na hoe Exact eruit zou zien. Koppel Exact bij <a href="#/koppelingen">Koppelingen</a>.`
    : x.bron === 'api' ? `${icon('check')}Teruggelezen uit Exact Online${x.gelezen?.op ? `, ${h(dayTime(x.gelezen.op))}` : ''}. Opnieuw lezen kan bij <a href="#/controle?deel=exact">Controle</a>.`
      : x.bron === 'import' ? `${icon('info')}Vergeleken met de export uit Exact die bij <a href="#/controle?deel=exact">Controle</a> is ingelezen.` : `${icon('info')}Nog geen Exact om mee te vergelijken.`;
  const sm = x.samen || {};
  const facts = [['ok', 'klopt', 'kloppen'], ['verschil', 'verschil', 'verschillen'], ['mist', 'mist in Exact', 'missen in Exact'], ['open', 'nog niet in Exact', 'nog niet in Exact']].filter(([k]) => sm[k]).map(([k, one, more]) => `<span class="chip ${XST[k][0]}">${fNum(sm[k])} ${sm[k] === 1 ? one : more}</span>`).join('');
  const sec = (title, list, kind) => (list.length ? `<h3 class="h3s">${title}</h3><ul class="xw">${list.map(y => entry(y, kind)).join('')}</ul>` : '');
  return `${top}
    <div class="xw-top"><p class="small muted xw-src">${src}</p>${facts ? `<p class="xw-sum">${facts}</p>` : ''}</div>
    ${sec(`Facturen van week ${d.week}`, x.facturen, 'verkoop')}
    ${sec(`Inkooporders van week ${d.week}`, x.inkoop, 'inkoop')}
    <p class="acts-row"><a class="btn btn-line" href="/api/week/weken/${d.maandag}/exact.xlsx">${icon('db')}Excel voor Exact</a>
      ${open.length && !ex.kan ? `<button type="button" class="btn btn-ghost" data-act="exact-all">${icon('check')}Met de hand in Exact gezet</button>` : ''}</p>
    <p class="small faint">De Excel heeft één regel per factuurregel, in euro: plantensoort, grootte, hoeveelheid, prijs per eenheid, plantenpaspoortnummer, klant en nog eens het plantenpaspoortnummer als kostendrager.</p>`;
}

function summary(key, d, s) {
  const ps = d.partijen.filter(p => p.regels.length), inn = ps.filter(p => p.binnen_op).length;
  const done = (s?.slips || []).filter(x => x.status === 'akkoord'), list = (s?.slips || []).filter(x => x.regels.length);
  const ls = lines(d), free = sum(ls.filter(r => r.rest > 0), r => r.rest);
  return {
    koers: d.koers ? `1 € = $ ${fKoers(d.koers)}` : 'nog invullen',
    binnen: ps.length ? `${inn} van ${ps.length} binnen` : 'geen zendingen',
    verdelen: [`${batches(d).length} ${batches(d).length === 1 ? 'batch' : 'batches'}`, d.eruit.length ? `${d.eruit.length} eruit` : '', ls.some(r => r.rest < 0) ? 'te veel verdeeld' : free ? `${fNum(free)} vrij in de loods` : 'netto nul'].filter(Boolean).join(' · '),
    pakbon: list.length ? `${done.length} van ${list.length} gemaakt` : '–',
    exact: done.length ? `${done.filter(x => x.pakbon.exact === 'in_exact').length} van ${done.length} in Exact` : '–',
  }[key];
}

export async function render(params, query) {
  const m = query.get('maandag');
  const d = await api(`/week/maandag${m ? `?maandag=${m}` : ''}`);
  const s = await api(`/week/pakbonnen?maandag=${d.maandag}`).catch(() => null);
  if (draftWeek !== d.maandag) { draft.clear(); shipOpen.clear(); draftWeek = d.maandag; }
  last = d; slipsOf = s;
  const st = state(d, s);
  const up = STEPS.find(([k]) => !st[k])?.[0] || null;
  const want = query.get('deel');
  const openKey = k => !closed.has(k) && (k === up || opened.has(k) || (want && (ALIAS[want] || want) === k));
  // the overview from Exact only when that step is open: it reads the whole year
  exactOf = openKey('exact') && (s?.slips || []).some(x => x.status === 'akkoord') ? await api(`/week/maandag/exact?maandag=${d.maandag}`).catch(() => null) : null;
  const body = { koers: () => rate(d), binnen: () => arrivals(d), verdelen: () => board(d), pakbon: () => slipsStep(d, s, st), exact: () => exactStep(d, s, exactOf) };
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

// ---------------------------------------------------------------- moving boxes: dragging, the move dialog, − and +
const move = body => api('/week/verdeling/verplaats', { method: 'POST', body });
const nameOf = k => (last.alleKlanten || []).find(x => x.id === k)?.naam || last.klanten.find(x => x.klant_id === k)?.klant || 'de klant';
async function moved(out, { r, van, naar, what }) {
  const n = out.verplaatst;
  toast(`${fNum(n)} ${n === 1 ? 'doos' : 'dozen'} ${what} naar ${naar ? nameOf(naar) : 'de loods'}.`, {
    label: 'Ongedaan maken',
    run: () => move({ regel_id: r, van: naar, naar: van, dozen: n }).then(() => { toast('Teruggezet.'); opened.add('verdelen'); ctxRef.refresh(); }).catch(x => toast(x.message)),
  });
  opened.add('verdelen');
  await ctxRef.refresh();
}
function moveDialog({ r, van, n, what }) {
  const d = last, locked = new Set(d.akkoord);
  const thisWeek = new Set([...d.klanten.map(k => k.klant_id), ...Object.keys(d.gevraagd || {}).map(Number)]);
  const opt = k => `<option value="${k.id}">${h(k.naam)}${k.plaats ? ` · ${h(k.plaats)}` : ''}</option>`;
  const all = (d.alleKlanten || []).filter(k => k.id !== van && !locked.has(k.id));
  const week = all.filter(k => thisWeek.has(k.id)), rest = all.filter(k => !thisWeek.has(k.id));
  dialog({
    title: `${what} verplaatsen`, ok: 'Verplaatsen',
    body: `<p class="small muted" style="margin-bottom:10px">${van ? `${h(nameOf(van))} heeft ${fNum(n)} ${n === 1 ? 'doos' : 'dozen'} van deze regel.` : `${fNum(n)} ${n === 1 ? 'doos staat' : 'dozen staan'} vrij in de loods.`}</p>
      <label class="f">Naar<select name="naar">${van ? '<option value="loods">De loods (vrij houden)</option>' : ''}${week.length ? `<optgroup label="Klanten van deze week">${week.map(opt).join('')}</optgroup>` : ''}${rest.length ? `<optgroup label="Andere klanten">${rest.map(opt).join('')}</optgroup>` : ''}</select></label>
      <label class="f">Hoeveel dozen<input type="number" name="dozen" inputmode="numeric" min="1" max="${n}" value="${n}" required></label>`,
    onOk: async v => {
      const naar = v.naar === 'loods' ? null : Number(v.naar), dz = Math.round(Number(v.dozen));
      if (!(dz >= 1 && dz <= n)) throw new Error(`Kies 1 tot ${n} dozen.`);
      const out = await move({ regel_id: r, van, naar, dozen: dz });
      await moved(out, { r, van, naar, what });
    },
  });
}

// Dragging works with a mouse anywhere on a line, and on a phone or tablet with the grip (so the page still scrolls).
// While dragging, a strip at the bottom of the screen takes the boxes back to the loods, wherever Jan is on the page.
let dnd = null, bound = false;
function bindDnd() {
  if (bound) return;
  bound = true;
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !document.querySelector('.monday')) return;
    const chip = e.target.closest('[data-chip]');
    if (!chip || chip.classList.contains('is-locked') || e.target.closest('input,button,a,select')) return;
    if (e.pointerType !== 'mouse' && !e.target.closest('.grip')) return;
    if (e.pointerType === 'mouse') e.preventDefault();
    dnd = { chip, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false };
  });
  document.addEventListener('pointermove', e => {
    if (!dnd || e.pointerId !== dnd.id) return;
    dnd.x = e.clientX; dnd.y = e.clientY;
    if (!dnd.on) { if (Math.hypot(dnd.x - dnd.x0, dnd.y - dnd.y0) < 6) return; startDrag(); }
    e.preventDefault();
    placeGhost(); findTarget();
  }, { passive: false });
  document.addEventListener('pointerup', e => { if (dnd && e.pointerId === dnd.id) endDrag(true); });
  document.addEventListener('pointercancel', e => { if (dnd && e.pointerId === dnd.id) endDrag(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && dnd?.on) endDrag(false); });
  // a touch drag must not scroll the page
  document.addEventListener('touchmove', e => { if (dnd?.on) e.preventDefault(); }, { passive: false });
}
function startDrag() {
  dnd.on = true;
  const r = dnd.chip.getBoundingClientRect();
  dnd.dx = dnd.x0 - r.left; dnd.dy = dnd.y0 - r.top;
  const g = dnd.chip.cloneNode(true);
  g.classList.add('dnd-ghost'); g.style.width = `${r.width}px`;
  g.removeAttribute('data-chip');
  document.body.append(g); dnd.ghost = g;
  dnd.chip.classList.add('is-dragging'); document.body.classList.add('dnd-on');
  if (dnd.chip.dataset.k) {
    const bar = document.createElement('div');
    bar.className = 'dnd-loods'; bar.dataset.drop = 'loods';
    bar.innerHTML = `${icon('stock')}<span>Laat hier los: terug in de loods</span>`;
    document.body.append(bar); dnd.bar = bar;
  }
  placeGhost();
  // near the top or the bottom of the screen the page scrolls along, so a customer far away can be reached
  const edgeTop = () => (document.querySelector('.top')?.getBoundingClientRect().bottom || 0) + 70;
  const edgeLow = () => {
    const tabs = document.querySelector('.tabs-m'), shown = tabs && getComputedStyle(tabs).display !== 'none';
    const floor = Math.min(shown ? tabs.getBoundingClientRect().top : window.innerHeight, dnd.bar ? dnd.bar.getBoundingClientRect().top : window.innerHeight);
    return [floor - 70, floor];
  };
  const tick = () => {
    if (!dnd?.on) return;
    const top = edgeTop(), [low, floor] = edgeLow();
    let v = 0;
    if (dnd.y < top) v = -Math.min(28, Math.ceil((top - dnd.y) / 4));
    else if (dnd.y > low && dnd.y < floor) v = Math.min(28, Math.ceil((dnd.y - low) / 4));
    if (v) { window.scrollBy(0, v); findTarget(); }
    dnd.raf = requestAnimationFrame(tick);
  };
  dnd.raf = requestAnimationFrame(tick);
}
function placeGhost() { if (dnd?.ghost) dnd.ghost.style.transform = `translate(${dnd.x - dnd.dx}px, ${dnd.y - dnd.dy}px) rotate(1.2deg)`; }
function findTarget() {
  const el = document.elementFromPoint(dnd.x, dnd.y)?.closest('[data-drop]') || null;
  const from = dnd.chip.dataset.k;
  const ok = el && !el.classList.contains('is-locked') && !(el.dataset.drop === 'klant' && el.dataset.k === from) && !(el.dataset.drop === 'loods' && !from);
  const t = ok ? el : null;
  if (dnd.over !== t) { dnd.over?.classList.remove('is-over'); dnd.over = t; t?.classList.add('is-over'); }
}
function endDrag(drop) {
  const x = dnd;
  dnd = null;
  cancelAnimationFrame(x.raf);
  x.ghost?.remove(); x.bar?.remove(); x.over?.classList.remove('is-over');
  x.chip.classList.remove('is-dragging'); document.body.classList.remove('dnd-on');
  if (drop && x.on && x.over) dropOn(x.chip, x.over).catch(e => { toast(e.message); ctxRef.refresh(); });
}
async function dropOn(chip, zone) {
  const r = Number(chip.dataset.r), van = Number(chip.dataset.k) || null, n = Number(chip.dataset.n), what = chip.dataset.what;
  if (zone.dataset.drop === 'ander') return moveDialog({ r, van, n, what });
  const naar = zone.dataset.drop === 'klant' ? Number(zone.dataset.k) : null;
  if (van === naar) return;
  // the line moves at once; the desk saves it and draws the hand-out again
  const list = naar ? zone.querySelector('.vk-l') : null;
  if (list) { list.querySelector('.vk-e')?.remove(); list.append(chip); } else chip.remove();
  const out = await move({ regel_id: r, van, naar });
  await moved(out, { r, van, naar, what });
}

export function mount(ctx) {
  ctxRef = ctx;
  bindDnd();
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
  document.getElementById('loods')?.addEventListener('toggle', e => { if (e.target.open) opened.add('loods'); else opened.delete('loods'); });
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const want = q.get('deel');
  if (want) { const el = document.getElementById(want === 'vrij' ? 'loods' : `mon-${ALIAS[want] || want}`); if (el) { if (want === 'vrij') el.open = true; setTimeout(() => el.scrollIntoView({ block: 'start' }), 30); } }
}

export async function onChange(e, ctx) {
  const el = e.target;
  if (el.dataset.cnt) { changeCount(Number(el.dataset.r), el.dataset.cnt, el.value); return; }
  if (el.dataset.share == null) return;
  const n = Math.max(0, Math.round(Number(el.value) || 0));
  await api('/week/verdeling/aantal', { method: 'PUT', body: { regel_id: Number(el.dataset.r), klant_id: Number(el.dataset.k), dozen: n } }).then(() => toast('Aangepast.')).catch(x => toast(x.message));
  opened.add('verdelen');
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
  // − and + on a count
  cnt: el => {
    const id = Number(el.dataset.r), p = last.partijen.find(x => x.regels.some(r => r.id === id)), r = p?.regels.find(x => x.id === id);
    if (!r) return;
    changeCount(id, el.dataset.f, cntOf(r)[el.dataset.f] + Number(el.dataset.d));
  },
  'ship-open': (el, ctx) => {
    const id = Number(el.dataset.p);
    if (shipOpen.has(id)) shipOpen.delete(id); else shipOpen.add(id);
    opened.add('binnen');
    return ctx.refresh();
  },
  // a shipment in (or back): with the numbers Jan changed
  binnen: async (el, ctx) => {
    const id = Number(el.dataset.p), p = last.partijen.find(x => x.id === id), inn = !!p.binnen_op;
    if (inn) {
      return dialog({ title: `${short(p.leverancier)} niet binnen?`, ok: 'Terugzetten', body: '<p>De telling van deze zending gaat terug naar wat de papieren zeggen, en op het Overzicht staat hij weer onderweg.</p>',
        onOk: async () => { await api(`/week/partijen/${id}/binnen`, { method: 'POST', body: { binnen: false } }); p.regels.forEach(r => draft.delete(r.id)); shipOpen.delete(id); toast('Teruggezet.'); ctx.refresh(); } });
    }
    const regels = draftsOf(p);
    el.disabled = true;
    await api(`/week/partijen/${id}/binnen`, { method: 'POST', body: { binnen: true, regels } }).catch(x => { el.disabled = false; throw x; });
    regels.forEach(x => draft.delete(x.id));
    toast(`${short(p.leverancier)} is binnen${regels.length ? `, ${regels.length} ${regels.length === 1 ? 'regel' : 'regels'} anders geteld` : ''}. Op het Overzicht staat hij op groen.`);
    ctx.refresh();
  },
  'alles-binnen': async (el, ctx) => {
    const todo = last.partijen.filter(p => p.regels.length && !p.binnen_op);
    el.disabled = true;
    try {
      for (const p of todo) { const regels = draftsOf(p); await api(`/week/partijen/${p.id}/binnen`, { method: 'POST', body: { binnen: true, regels } }); regels.forEach(x => draft.delete(x.id)); }
      toast(`${todo.length} zendingen binnen. Op het Overzicht staan ze op groen.`);
    } finally { ctx.refresh(); }
  },
  // − and + on a line of the hand-out: the box goes to the loods, or comes from it
  sh: async (el, ctx) => {
    const r = lines(last).find(x => x.id === Number(el.dataset.r)), k = Number(el.dataset.k);
    const cur = r?.verdeling.find(v => v.klant_id === k)?.dozen || 0, n = Math.max(0, cur + Number(el.dataset.d));
    el.disabled = true;
    await api('/week/verdeling/aantal', { method: 'PUT', body: { regel_id: r.id, klant_id: k, dozen: n } });
    opened.add('verdelen');
    return ctx.refresh();
  },
  mv: el => moveDialog({ r: Number(el.dataset.r), van: Number(el.dataset.k) || null, n: Number(el.dataset.n), what: el.dataset.what }),
  give: async (el, ctx) => {
    const r = Number(el.dataset.r), naar = Number(el.dataset.k), what = lines(last).find(x => x.id === r);
    const out = await move({ regel_id: r, van: null, naar, dozen: Number(el.dataset.n) });
    opened.add('loods');
    await moved(out, { r, van: null, naar, what: what ? `${what.product} ${what.maat}` : '' });
  },
  reset: async (el, ctx) => {
    await api(`/week/weken/${last.maandag}/voorstel`, { method: 'POST', body: { klant_id: Number(el.dataset.k) } });
    opened.add('verdelen'); toast('Terug naar het voorstel van de desk.'); ctx.refresh();
  },
  'reset-all': (el, ctx) => dialog({
    title: 'Alles terug naar het voorstel?', ok: 'Terug naar het voorstel',
    body: '<p>Wat je deze week hebt versleept en aangepast, gaat terug naar het voorstel van de desk: wat elke klant vroeg, met de dozen die er zijn. Klanten met een pakbon die al akkoord is, blijven zoals ze zijn.</p>',
    onOk: async () => { await api(`/week/weken/${last.maandag}/voorstel`, { method: 'POST', body: {} }); opened.add('verdelen'); toast('Alles staat weer zoals de desk het voorstelde.'); ctx.refresh(); },
  }),
  nagekeken: async (el, ctx) => {
    await api(`/week/weken/${last.maandag}/nagekeken`, { method: 'POST', body: { terug: !!el.dataset.terug } });
    if (el.dataset.terug) opened.add('verdelen'); else { opened.delete('verdelen'); closed.delete('pakbon'); }
    toast(el.dataset.terug ? 'De verdeling staat weer open.' : 'Nagekeken. Nu de pakbonnen en facturen.');
    await ctx.refresh();
    if (!el.dataset.terug) document.getElementById('mon-pakbon')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  eruit: (el, ctx) => dialog({
    title: `${el.dataset.n} eruit deze week?`, ok: 'Eruit', danger: true,
    body: '<p>Hij krijgt deze week niets en er komt geen pakbon. Zijn dozen gaan naar wie meer vroeg, of blijven vrij in de loods. Je kunt hem terugzetten zolang de pakbonnen nog niet gemaakt zijn.</p>',
    onOk: async () => { await api(`/week/weken/${last.maandag}/klant-eruit`, { method: 'POST', body: { klant_id: Number(el.dataset.k) } }); opened.add('verdelen'); toast(`${el.dataset.n} staat eruit.`); ctx.refresh(); },
  }),
  maak: (el, ctx) => {
    const ready = slipsOf.slips.filter(x => x.status === 'klaar');
    dialog({
      title: `${ready.length} ${ready.length === 1 ? 'pakbon en factuur' : 'pakbonnen en facturen'} maken`, ok: 'Maken',
      body: `<p>Elke klant krijgt een factuurnummer en een pakbon in euro (1 € = $ ${fKoers(last.koers)}) met het plantenpaspoort. ${slipsOf.outlook?.doel ? 'De facturen komen als concept in Outlook.' : 'Per factuur staat de mail klaar met "Open in Outlook".'} Er gaat niets vanzelf de deur uit.</p>`,
      onOk: async () => {
        const r = await api('/week/pakbonnen/akkoord', { method: 'POST', body: { maandag: last.maandag } });
        opened.add('pakbon'); opened.add('exact');     // the list stays in view, and the next step shows the entries
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
      body: `<p>${n} ${n === 1 ? 'factuur gaat' : 'facturen gaan'} naar ${where}, elke regel met het batchnummer als kostendrager.</p><p class="small faint">Ze zijn al door jou goedgekeurd. Daarna leest de desk terug wat er in Exact staat, en zie je hier per factuur of het klopt.</p>`,
      onOk: async () => {
        const r = await api('/week/exact/zet', { method: 'POST', body: { maandag: last.maandag, soort: 'verkoop' } });
        opened.add('exact');
        toast(`${r.gezet} in Exact gezet${r.fouten.length ? `; niet gelukt: ${r.fouten[0].ref}: ${r.fouten[0].fout}` : ''}.`);
        ctx.refresh();
      },
    });
  },
  'exact-zet-inkoop': (el, ctx) => {
    const n = (exactOf?.inkoop || []).filter(y => y.status === 'open').length;
    const where = slipsOf.exact?.bron === 'demo' ? 'het demo-Exact' : 'Exact';
    dialog({
      title: 'Inkooporders in Exact zetten', ok: 'Zet in Exact',
      body: `<p>${n} ${n === 1 ? 'inkooporder gaat' : 'inkooporders gaan'} naar ${where}: wat het verzendbewijs zegt, in dollars, met het batchnummer als kostendrager.</p>`,
      onOk: async () => {
        const r = await api('/week/exact/zet', { method: 'POST', body: { maandag: last.maandag, soort: 'inkoop' } });
        opened.add('exact');
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
