// One supplier: what he delivers this week and whether it arrives, everything his mail contained (the order, the
// confirmation, the shipping papers), how the desk processed it step by step, where it stands in the big Excel,
// and how good he really is over the last half year.
import { api, h, icon, fNum, fEur, toast, dialog, field, waLink } from '../core.js';
import { dLong, dShort, dayTime, isoWeek, zn, regio, stageChip, fUsd, fUsdUnit } from '../wk.js';
import { stoplicht, reasons, lines, toWhom, docsRow, doubts, exactBox, partijActions } from '../partij.js';
import { laneHtml } from './inkoop.js';

let cur = null, openList = false;
const pct = v => (v == null ? '–' : `${Math.round(v * 100)}%`);
const scoreBar = (v, { big = false } = {}) => (v == null ? '<span class="faint small">te weinig gegevens</span>'
  : `<span class="sc${big ? ' big' : ''}" data-s="${v >= 70 ? 'g' : v >= 55 ? 'o' : 'r'}"><span class="sc-b" aria-hidden="true"><i style="width:${Math.max(3, Math.min(100, v))}%"></i></span><b>${Math.round(v)}</b></span>`);
export { scoreBar };

export function partsList(parts) {
  return `<ul class="parts">${parts.map(p => `<li><span class="pn">${h(p.naam)}</span>${scoreBar(p.score)}<small>${h(p.uitleg || '')}</small></li>`).join('')}</ul>`;
}
const KANS = { meer: ['leaf', 'ok'], prijs: ['tag', 'info'], let_op: ['warn', 'wait'], risico: ['shield', 'bad'], erbij: ['plus', 'ok'], tekort: ['in', 'ok'], bellen: ['phone', 'wait'], groei: ['leaf', 'ok'], seizoen: ['clock', 'info'] };
export function kansList(list, empty = 'Niets bijzonders: deze relatie loopt.') {
  if (!list || !list.length) return `<p class="empty">${h(empty)}</p>`;
  return `<ul class="kans">${list.map(k => { const [ic, t] = KANS[k.soort] || ['info', '']; return `<li class="k-${h(t)}">${icon(ic)}<span>${h(k.tekst)}</span></li>`; }).join('')}</ul>`;
}

function excelPanel(d) {
  const p = d.partij, x = d.excel;
  if (!p || !x) return '';
  const inn = p.regels.reduce((s, r) => s + (r.geteld ?? r.verzonden ?? r.bevestigd ?? r.besteld ?? 0), 0), uitval = p.regels.reduce((s, r) => s + (r.uitval || 0), 0);
  const uit = x.verkoop.reduce((s, v) => s + v.dozen, 0), rest = inn - uitval - uit, counted = p.stroom?.basis === 'geteld';
  const stand = !counted ? 'loopt nog' : rest === 0 ? 'netto nul' : rest > 0 ? 'over in de loods' : 'meer uit dan in';
  const slips = [...new Set(x.verkoop.map(v => v.factuur))];
  return `<section class="panel"><header><h2>In de grote Excel</h2><span class="sub">jaaroverzicht ${x.jaar}</span></header>
    <div class="body stack">
      <ul class="xlrefs">
        <li><b>Blad Inkoop</b><span>${h(x.inkoopRange)} · ${fNum(x.inkoop.length)} ${x.inkoop.length === 1 ? 'regel' : 'regels'}, één per maat, met ${h(p.nummer)} in kolom C</span></li>
        <li><b>Blad Partijen</b><span>rij ${fNum(x.partijen)} · in, uitval, uit en rest van ${h(p.nummer)}: <em>${h(stand)}</em></span></li>
        <li><b>Blad Leveranciers</b><span>rij ${fNum(x.leveranciers)} · zijn totalen van het jaar, als formules</span></li>
        <li><b>Blad Verkoop</b><span>${x.verkoop.length ? `${fNum(x.verkoop.length)} regels op ${fNum(slips.length)} pakbonnen (rij ${fNum(x.verkoop[0].rij)} tot ${fNum(x.verkoop[x.verkoop.length - 1].rij)}), met ${h(p.nummer)} als partij` : 'nog geen pakbonnen: die komen maandag na het verdelen'}</span></li>
      </ul>
      <div class="tbwrap"><table class="tb xl"><thead><tr><th>Rij</th><th>Artikel</th><th>Product</th><th class="r">Besteld</th><th class="r">Bevestigd</th><th class="r">Verzonden</th><th class="r">Geteld</th><th class="r">Stuks</th><th class="r">Prijs $</th><th class="r">Bedrag $</th></tr></thead><tbody>
        ${p.regels.map(r => { const stuks = (r.verzonden ?? r.bevestigd ?? r.besteld ?? 0) * r.per_doos; return `<tr><td class="num faint">${fNum(x.regels[r.id])}</td><td>${h(r.product_code)}</td><td>${h(r.product)} ${h(r.maat)}</td>
          <td class="r num">${r.besteld ?? ''}</td><td class="r num">${r.bevestigd ?? ''}</td><td class="r num">${r.verzonden ?? ''}</td><td class="r num">${r.geteld ?? ''}</td><td class="r num">${fNum(stuks)}</td><td class="r num">${fUsdUnit(r.prijs_usd)}</td><td class="r num">${fUsd(stuks * r.prijs_usd)}</td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="tbwrap"><table class="tb xl"><thead><tr><th>Partijen, rij ${fNum(x.partijen)}</th><th class="r">Dozen in</th><th class="r">Uitval</th><th class="r">Dozen uit</th><th class="r">Rest</th><th>Stand</th></tr></thead>
        <tbody><tr><td>${h(p.nummer)}</td><td class="r num">${fNum(inn)}</td><td class="r num">${fNum(uitval)}</td><td class="r num">${fNum(uit)}</td><td class="r num"><b>${fNum(rest)}</b></td><td>${h(stand)}</td></tr></tbody></table></div>
      <div><a class="btn btn-line" href="/api/week/excel?jaar=${x.jaar}" download>${icon('db')}Download de Excel van ${x.jaar}</a>
        <p class="small faint" style="margin-top:6px">De Excel wordt bij elke download opnieuw gemaakt uit de desk, met formules die je zelf kunt narekenen.</p></div>
    </div></section>`;
}

function historyTable(list) {
  if (!list.length) return '<p class="empty">Nog geen zendingen.</p>';
  const tm = v => new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' }).format(new Date(v));
  const when = z => (String(z.binnen_op).slice(0, 10) === z.maandag || new Date(z.binnen_op).toDateString() === new Date(`${z.maandag}T12:00:00`).toDateString() ? `ma ${tm(z.binnen_op)}` : dayTime(z.binnen_op));
  return `<div class="tbwrap"><table class="tb hist"><thead><tr><th>Week</th><th>Zending</th><th class="r" title="Besteld en wat er volgens de papieren vloog">Besteld → verzonden</th><th class="r">Geteld</th><th>Binnen</th></tr></thead><tbody>
    ${list.slice(0, 14).map(z => `<tr class="click" data-href="#/leverancier/${cur.leverancier.id}?maandag=${z.maandag}"><td class="nowrap">wk ${z.week}</td><td class="nowrap"><a href="#/leverancier/${cur.leverancier.id}?maandag=${z.maandag}">${h(z.nummer)}</a></td>
      <td class="r num nowrap">${fNum(z.besteld)} → ${z.verzonden == null ? '…' : fNum(z.verzonden)}</td><td class="r num nowrap">${z.geteld == null ? '–' : fNum(z.geteld)}${z.uitval ? `<small class="faint"> −${fNum(z.uitval)}</small>` : ''}</td>
      <td class="nowrap">${z.binnen_op ? `<span class="ot ${z.op_tijd ? 'ok' : 'late'}">${z.op_tijd ? icon('check') : icon('clock')}${h(when(z))}</span>` : '<span class="faint">onderweg</span>'}</td></tr>`).join('')}
  </tbody></table></div><p class="small faint" style="padding:8px 18px 12px">Op tijd is maandag voor 12:00 in de loods.</p>`;
}

export async function render(params, query) {
  const m = query.get('maandag');
  const d = await api(`/week/leveranciers/${params.id}${m ? `?maandag=${m}` : ''}`);
  if (!cur || cur.leverancier.id !== d.leverancier.id || cur.maandag !== d.maandag) openList = false;
  cur = d;
  const l = d.leverancier, p = d.partij, s = d.stat, r = p?.risico;
  const tel = x => String(x || '').replace(/\s/g, '');
  const nav = `<nav class="wknav" aria-label="Andere zending">
      ${d.vorige ? `<a href="#/leverancier/${l.id}?maandag=${d.vorige}">${icon('back')}<span>wk ${isoWeek(d.vorige)}</span></a>` : '<span></span>'}
      <span class="wknav-now"><b>Week ${d.week}</b><small>${h(dShort(d.maandag))}</small></span>
      ${d.volgende ? `<a href="#/leverancier/${l.id}?maandag=${d.volgende}"><span>wk ${isoWeek(d.volgende)}</span>${icon('back', 'flip')}</a>` : '<span></span>'}</nav>`;
  return `<div class="page wk">
    <p class="crumbs"><a class="back" href="#/inkoop?maandag=${d.maandag}">${icon('back')}Overzicht week ${d.week}</a><a class="back" href="#/handel?deel=leveranciers">Leveranciers</a></p>
    <div class="prof"><div><h1>${h(l.naam)}</h1>
      <p class="sub"><span>${h([l.plaats, l.regio_naam].filter(Boolean).join(', '))}</span>${l.contact ? `<span>${h(l.contact)}</span>` : ''}
        ${l.telefoon ? `<a href="tel:${h(tel(l.telefoon))}">${icon('phone')}${h(l.telefoon)}</a>` : ''}${l.whatsapp ? `<a href="${h(waLink(l.whatsapp, ''))}" target="_blank" rel="noopener">${icon('chat')}WhatsApp</a>` : ''}
        ${l.email ? `<a href="mailto:${h(l.email)}">${icon('mail')}${h(l.email)}</a>` : ''}</p>
      <p class="sub small">${regio(l.regio)}<span>Route ${h([...l.route.map(c => d.plekken[c]?.stad || c), 'Nootdorp'].join(' → '))}</span>${l.exact_code ? `<span>Crediteur Exact ${h(l.exact_code)}</span>` : ''}
        <button type="button" class="lnk small" data-act="lev-edit">Gegevens en route wijzigen</button></p></div>
      <div class="prof-s">${s && s.score != null ? `<span class="badge-s" data-s="${s.score >= 70 ? 'g' : s.score >= 55 ? 'o' : 'r'}"><b>${s.score}</b><small>${h(s.label.naam)}</small></span>` : ''}</div></div>
    <div class="acts-row">${nav}</div>
    ${p ? `<section class="panel partij" data-l="${h(r?.licht || '')}"><header><h2>${r?.licht ? stoplicht(r.licht) : ''} ${zn(p.nummer)} wat hij levert</h2><span class="ph-chips">${stageChip(p.stage)}${p.twijfels ? ` <span class="chip wait">${p.twijfels} nakijken</span>` : ''}</span></header>
          <div class="lanes flat">${laneHtml(p, { geteld: d.geteld, plekken: d.plekken, maandag: d.maandag }, { interactive: false })}</div>
          <div class="body stack">
            ${r ? reasons(r, { doubt: !p.twijfels }) : ''}
            ${doubts(p)}
            <div class="row-a"><button type="button" class="btn btn-sm btn-line" data-act="flow" data-p="${p.id}" aria-expanded="${openList}" aria-controls="lfull">${icon('file')}<span>${openList ? 'Verberg de volledige lijst' : 'Volledige lijst'}</span></button>
              <a class="btn btn-sm btn-ghost" href="#/inkoop?maandag=${d.maandag}&p=${p.id}">${icon('in')}Op de Inkoop-pagina</a>
              <button type="button" class="btn btn-sm btn-ghost" data-act="route" data-p="${p.id}">Route van deze zending</button></div>
            <div class="full stack" id="lfull"${openList ? '' : ' hidden'}><h3>Maten, aantallen en prijzen</h3>${lines(p)}<h3>Naar wie het gaat</h3>${toWhom(p)}${exactBox(p)}</div>
          </div></section>` : ''}
    <div class="grid2 after-p">
      <div class="stack">
        ${p ? `<section class="panel"><header><h2>Uit zijn mail</h2><span class="sub">${fNum(p.docs.length)} ${p.docs.length === 1 ? 'stuk' : 'stukken'} voor ${h(p.nummer)}</span></header>
          <div class="body stack"><p class="small muted">Alles wat er voor deze zending heen en weer ging: Jans bestelling, de bevestiging en de verzendpapieren. Klik een stuk voor het origineel naast wat de desk eruit las.</p>${docsRow(p)}</div></section>
        <section class="panel"><header><h2>Zo is het verwerkt</h2><span class="sub">van mail tot Excel</span></header>
          <ol class="vstp">${d.verwerking.map(x => `<li><span class="when">${h(x.wanneer || '')}</span><span class="who">${h(x.wie === 'desk' ? 'De desk' : x.wie)}</span><span class="what">${h(x.tekst)}${x.doc ? ` <button type="button" class="lnk small" data-act="doc" data-p="${p.id}" data-d="${x.doc}">bekijk</button>` : ''}</span></li>`).join('')}
            <li><span class="when"></span><span class="who">De desk</span><span class="what">Staat in de grote Excel: blad Inkoop ${h(d.excel?.inkoopRange || '')}, blad Partijen rij ${fNum(d.excel?.partijen)}.</span></li></ol></section>
        ${excelPanel(d)}`
    : `<section class="panel"><p class="empty">Geen zending van ${h(l.naam)} voor week ${d.week}. ${d.vorige ? `<a href="#/leverancier/${l.id}?maandag=${d.vorige}">Naar de vorige</a>` : ''}</p></section>`}
      </div>
      <aside class="stack">
        <section class="panel"><header><h2>Hoe goed is hij</h2><span class="sub">laatste half jaar</span></header>
          <div class="body stack">${s ? `${partsList(s.parts)}
            <dl class="facts mini"><div><dt>Zendingen</dt><dd>${fNum(s.zendingen)}</dd></div><div><dt>Aandeel inkoop</dt><dd>${pct(s.aandeel)}</dd></div>
              <div><dt>Ingekocht</dt><dd>${fUsd(s.inkoop_usd, 0)}</dd></div><div><dt>Marge op zijn dozen</dt><dd>${fEur(s.marge)}<small>${pct(s.marge_pct)}</small></dd></div></dl>` : '<p class="empty">Nog te weinig zendingen.</p>'}</div></section>
        <section class="panel"><header><h2>Meer met hem doen</h2><span class="sub">kansen en aandachtspunten</span></header>${kansList(s?.kansen)}</section>
        <section class="panel"><header><h2>Laatste zendingen</h2></header>${historyTable(d.geschiedenis)}</section>
      </aside>
    </div>
  </div>`;
}

export const actions = {
  ...partijActions(() => cur.partij),
  flow: (el, ctx, e) => {
    if (e && e.target.closest('a')) return 'default';
    const full = document.getElementById('lfull'), btn = document.querySelector('button[data-act="flow"]');
    if (!full) return;
    openList = full.hidden;
    full.hidden = !openList;
    if (btn) { btn.setAttribute('aria-expanded', String(openList)); btn.querySelector('span').textContent = openList ? 'Verberg de volledige lijst' : 'Volledige lijst'; }
    if (openList && el.tagName !== 'BUTTON') setTimeout(() => full.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);
  },
  'lev-edit': (el, ctx) => {
    const l = cur.leverancier;
    dialog({
      title: l.naam, ok: 'Opslaan',
      body: `<div class="form">${field('contact', 'Contactpersoon', l.contact)}${field('telefoon', 'Telefoon', l.telefoon)}${field('whatsapp', 'WhatsApp', l.whatsapp)}${field('email', 'E-mail', l.email, { type: 'email' })}
        ${field('route', 'Vaste route: luchthavens van vertrek tot aankomst', l.route.join(' '), { wide: true, hint: 'Bijvoorbeeld SJO AMS, of GUA MIA AMS met een overstap in Miami. Zendingen die nog niet gevlogen zijn volgen de nieuwe route.' })}</div>`,
      onOk: async v => { await api(`/week/leveranciers/${l.id}`, { method: 'PATCH', body: v }); toast('Opgeslagen.'); ctx.refresh(); },
    });
  },
};
