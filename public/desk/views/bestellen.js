// Bestellen (Tuesday): what customers asked on the phone, added up per product, and the order per supplier.
// Jan sends the order himself; when he has, one click makes the shipments with their batch numbers.
import { api, h, icon, fNum, fEur, toast, copy, dialog, field, waLink } from '../core.js';
import { weekNav, dLong, dayTime, zn, regio, stageChip, spanishLine, fUsdUnit, fUsd } from '../wk.js';

let last = null, D = null, KN = null;
const pct = v => (v == null ? '–' : `${Math.round(v * 100)}%`);

// ---------------------------------------------------------------- good deals: every box already has a buyer
function buyer(k, act, data) {
  return `<li><span class="by"><a href="#/klant/${k.klant_id}"><b>${h(k.klant)}</b></a><small>${h(k.plaats || '')}${k.land ? `, ${h(k.land)}` : ''}${k.gewoon ? ` · neemt meestal ${fNum(k.gewoon)}` : ''}${k.weken ? ` · ${fNum(k.weken)} van 13 weken` : ''}${k.al ? ` · heeft nu ${fNum(k.al)}` : ''}${k.betaaltLaat ? ' · <b class="late">betaalt laat</b>' : ''}</small></span>
    ${k.genoteerd ? `<span class="chip ok">${icon('check')}${fNum(k.dozen)} genoteerd</span><button type="button" class="lnk small" data-act="deal-undo" ${data}>terug</button>`
      : `<span class="bn"><input type="number" min="1" max="999" value="${k.dozen}" ${data.replace(/data-/g, 'data-n-')} aria-label="Dozen voor ${h(k.klant)}"><small>dz</small></span>
        ${k.telefoon ? `<a class="btn btn-sm btn-ghost" href="tel:${h(String(k.telefoon).replace(/\s/g, ''))}" title="${h(k.telefoon)}">${icon('phone')}<span class="sr">Bel ${h(k.klant)}</span></a>` : ''}
        <button type="button" class="btn btn-sm btn-leaf" data-act="${act}" ${data}>Ja, genoteerd</button>`}</li>`;
}
function acceptText(x) {
  const first = (x.lev_contact || '').split(' ')[0], n = x.genoteerd || x.dozen - x.rest || x.dozen;
  return `Hola${first ? ` ${first}` : ''},\n\nTomamos ${n} cajas de ${spanishLine({ soort: x.soort_plant, naam: x.product, maat: x.maat })} a US$ ${String(x.prijs_usd).replace('.', ',')} para la semana ${D.week}. Por favor inclúyanlas en el envío.\n\nSaludos,\nJan\nCampo International`;
}
function offerCard(x) {
  const data = k => `data-id="${x.id}" data-k="${k.klant_id}"`;
  const take = x.status === 'open' ? `<button type="button" class="btn btn-sm btn-leaf" data-act="deal-take" data-id="${x.id}">${icon('check')}Aanbod aangenomen</button><button type="button" class="btn btn-sm btn-ghost" data-act="deal-skip" data-id="${x.id}">Niet nu</button>`
    : x.status === 'genomen' ? `<span class="chip ok">${icon('check')}Aangenomen${x.genomen_dozen ? `: ${fNum(x.genomen_dozen)} dozen` : ''}</span><button type="button" class="lnk small" data-act="deal-open" data-id="${x.id}">terug</button>`
      : `<span class="chip">Niet genomen</span><button type="button" class="lnk small" data-act="deal-open" data-id="${x.id}">terug</button>`;
  return `<article class="deal${x.goed ? ' is-goed' : ''} st-${h(x.status)}" id="deal${x.id}">
    <header><div><b>${fNum(x.dozen)} dozen ${h(x.product)} ${h(x.maat)}</b><small>aanbod van <a href="#/leverancier/${x.leverancier_id}">${h(x.leverancier)}</a> ${regio(x.regio)} · ${h(dayTime(x.ontvangen))}</small></div>
      <div class="deal-m"><b>${fEur(x.marge_eur)}</b><small>marge${x.marge_pct != null ? ` · ${pct(x.marge_pct)}` : ''}</small></div></header>
    <p class="deal-p">${fUsdUnit(x.prijs_usd)} per stuk${x.normaal_usd > x.prijs_usd ? ` <s title="Normale inkoopprijs">${fUsdUnit(x.normaal_usd)}</s>` : ''} · ${fNum(x.dozen * x.per_doos)} stuks${x.voordeel_usd ? ` · ${fUsd(x.voordeel_usd, 0)} goedkoper dan normaal` : ''}</p>
    <ul class="checks">${x.checks.map(c => `<li class="${c.ok ? 'ok' : 'no'}">${icon(c.ok ? 'check' : 'warn')}${h(c.tekst)}</li>`).join('')}</ul>
    ${x.kopers.length ? `<p class="small muted">Wie het neemt, uit wat ze de laatste 13 weken kochten:</p><ol class="buyers">${x.kopers.map(k => buyer(k, 'deal-yes', data(k))).join('')}</ol>` : '<p class="small faint">Geen vaste koper voor dit product gevonden.</p>'}
    ${x.rest ? `<p class="small rest">${icon('info')}Nog ${fNum(x.rest)} ${x.rest === 1 ? 'doos' : 'dozen'} zonder koper. Neem er ${fNum(x.dozen - x.rest)} in plaats van ${fNum(x.dozen)}, dan blijft er niets over.</p>` : ''}
    ${x.notitie ? `<blockquote class="lev-q" lang="es">${h(x.notitie)}</blockquote>` : ''}
    <footer>${take}${x.lev_email ? `<a class="btn btn-sm btn-ghost" href="mailto:${h(x.lev_email)}?subject=${encodeURIComponent(`Oferta semana ${D.week} - Campo International`)}&body=${encodeURIComponent(acceptText(x))}">${icon('mail')}Mail</a>` : ''}${x.lev_whatsapp ? `<a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="${h(waLink(x.lev_whatsapp, acceptText(x)))}">${icon('chat')}WhatsApp</a>` : ''}</footer>
  </article>`;
}
function wayCard(x) {
  const data = k => `data-p="${x.product_id}" data-k="${k.klant_id}"`;
  return `<article class="deal way">
    <header><div><b>${fNum(x.dozen)} ${x.dozen === 1 ? 'doos' : 'dozen'} ${h(x.product)} ${h(x.maat)}</b><small>komt maandag binnen (${x.partijen.map(p => h(p.nummer)).join(', ')}), heeft nog geen koper</small></div>
      <div class="deal-m"><b>${fEur(x.omzet_eur)}</b><small>omzet</small></div></header>
    ${x.kopers.length ? `<ol class="buyers">${x.kopers.map(k => buyer(k, 'way-yes', data(k))).join('')}</ol>` : '<p class="small faint">Geen vaste koper die er nog ruimte voor heeft.</p>'}
    ${x.rest ? `<p class="small rest">${icon('info')}${fNum(x.rest)} blijven anders in de loods.</p>` : ''}
  </article>`;
}
function dealsPanel() {
  if (!D) return '';
  const open = D.deals.filter(x => x.status !== 'afgewezen'), way = D.onderweg.lijst.filter(x => x.kopers.length);
  const total = open.filter(x => x.status === 'open' || x.status === 'genomen').reduce((t, x) => t + (x.marge_eur || 0), 0);
  return `<section class="panel deals-p" id="deals"><header><h2>Goede deals</h2><span class="sub">één op één: elke doos heeft al een koper, er blijft niets over</span></header>
    <div class="body stack">
      ${open.length ? `<p class="small muted">${fNum(open.length)} ${open.length === 1 ? 'aanbod' : 'aanbiedingen'} voor week ${D.week}, samen ${fEur(total)} marge als je ze neemt. Bel de kopers, zet ze op "genoteerd", en laat de leverancier weten dat je het neemt. De extra dozen gaan mee in de bestelling van dinsdag.</p>
        <div class="deal-g">${open.map(offerCard).join('')}</div>`
        : `<p class="empty">Geen aanbod van leveranciers voor week ${D.week}. Kreeg je er een via mail of WhatsApp? Noteer het, dan zoekt de desk de kopers erbij.</p>`}
      ${way.length ? `<h3>Komt maandag binnen, nog zonder koper</h3><p class="small muted">Er vliegt iets meer dan er verkocht is. Deze klanten nemen het meestal: één telefoontje en het is weg.</p><div class="deal-g">${way.map(wayCard).join('')}</div>` : ''}
      ${D.deals.some(x => x.status === 'afgewezen') ? `<p class="small faint">Niet genomen: ${D.deals.filter(x => x.status === 'afgewezen').map(x => `${h(x.product)} ${h(x.maat)} van ${h(x.leverancier)} <button type="button" class="lnk small" data-act="deal-open" data-id="${x.id}">terug</button>`).join(', ')}</p>` : ''}
      <p><button type="button" class="btn btn-sm btn-line" data-act="aanbod-new">${icon('plus')}Aanbod noteren</button></p>
    </div></section>`;
}

// ---------------------------------------------------------------- new customers and suppliers
const KST = [['nieuw', 'Nieuw'], ['benaderd', 'Benaderd'], ['in_gesprek', 'In gesprek'], ['klant', 'Klant geworden'], ['afgewezen', 'Geen interesse']];
function lead(x) {
  return `<li class="lead st-${h(x.status)}"><div class="lead-b"><b>${h(x.naam)}${x.bron === 'demo' ? ' <span class="chip">voorbeeld</span>' : ''}</b>
      <small>${h([x.plaats, x.land].filter(Boolean).join(', '))}${x.segment ? ` · ${h(x.segment)}` : ''}${x.contact ? ` · ${h(x.contact)}` : ''}</small>
      ${x.wat ? `<p>${h(x.wat)}</p>` : ''}${x.waarom ? `<p class="small muted">${h(x.waarom)}</p>` : ''}${x.notitie ? `<p class="small note">${icon('edit')}${h(x.notitie)}</p>` : ''}</div>
    <div class="lead-a"><select data-lead="${x.id}" aria-label="Stand van ${h(x.naam)}">${KST.map(([k, l]) => `<option value="${k}"${x.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn btn-sm btn-ghost" data-act="lead-note" data-id="${x.id}">${icon('edit')}<span class="sr">Notitie</span></button>
      ${x.email ? `<a class="btn btn-sm btn-ghost" href="mailto:${h(x.email)}">${icon('mail')}<span class="sr">Mail</span></a>` : ''}${x.telefoon ? `<a class="btn btn-sm btn-ghost" href="tel:${h(String(x.telefoon).replace(/\s/g, ''))}">${icon('phone')}<span class="sr">Bel</span></a>` : ''}</div></li>`;
}
function leadsPanel() {
  if (!KN) return '';
  const side = (soort, title, ins) => `<div class="stack"><h3>${title}</h3>
    ${ins.length ? `<ul class="ins">${ins.map(x => `<li><b>${h(x.titel)}</b><span>${h(x.tekst)}</span></li>`).join('')}</ul>` : ''}
    <ul class="leads">${KN.kansen.filter(k => k.soort === soort).map(lead).join('') || '<li class="empty">Nog niemand genoteerd.</li>'}</ul></div>`;
  return `<section class="panel" id="kansen"><header><h2>Nieuwe klanten en leveranciers</h2><span class="sub">waar de cijfers zeggen dat je moet kijken, en wie je kunt benaderen</span></header>
    <div class="body stack"><div class="grid2 even">${side('klant', 'Nieuwe klanten', KN.inzichten.klanten)}${side('leverancier', 'Nieuwe leveranciers', KN.inzichten.leveranciers)}</div>
      <p class="small faint">De desk stelt voor; jij belt en beslist. Voorbeelden met het label voorbeeld zijn verzonnen voor de demo.</p>
      <p><button type="button" class="btn btn-sm btn-line" data-act="lead-new">${icon('plus')}Kans toevoegen</button></p></div></section>`;
}

function entry(d) {
  const opts = d.producten.map(p => `<option value="${p.id}">${h(p.naam)} ${h(p.maat)}</option>`).join('');
  return `<form class="phone" data-form="order" autocomplete="off">
    <label class="f">Klant<input type="text" name="klant" list="klantlijst" placeholder="Typ een naam" required></label>
    <label class="f">Product<select name="product_id">${opts}</select></label>
    <label class="f">Dozen<input type="number" name="dozen" min="1" max="9999" step="1" inputmode="numeric" required></label>
    <button class="btn btn-leaf" type="submit">${icon('plus')}Noteren</button>
    <datalist id="klantlijst">${d.alleKlanten.map(k => `<option value="${h(k.naam)}">${h(k.plaats)}, ${h(k.land)}</option>`).join('')}</datalist>
  </form>`;
}

function customers(d) {
  if (!d.klanten.length) return '<p class="empty">Nog niemand heeft gebeld voor deze week.</p>';
  return `<ul class="calls-l">${d.klanten.map(k => `<li>
      <div class="calls-k"><a href="#/klant/${k.klant_id}"><b>${h(k.klant)}</b></a><small>${h(k.land)} · ${fNum(k.regels.reduce((s, r) => s + r.dozen, 0))} dozen</small></div>
      <div class="calls-r">${k.regels.map(r => `<span class="ol">
          <span>${h(r.product)} ${h(r.maat)}</span>
          <input type="number" min="0" max="9999" value="${r.dozen}" aria-label="Dozen ${h(r.product)} ${h(r.maat)} voor ${h(k.klant)}" data-act="order-set" data-k="${k.klant_id}" data-p="${r.product_id}">
          <button type="button" class="x" data-act="order-del" data-k="${k.klant_id}" data-p="${r.product_id}" aria-label="Weghalen">×</button>
        </span>`).join('')}</div>
    </li>`).join('')}</ul>`;
}

// per supplier: what to order, ready to copy into a mail
function suppliers(d) {
  const lines = d.producten.filter(p => p.gevraagd > 0 || p.besteld.length);
  if (!lines.length) return '<p class="empty">Er is nog niets te bestellen.</p>';
  const bySup = new Map();
  for (const p of lines) {
    const placed = p.besteld[0];
    const lid = placed ? placed.leverancier_id : p.leverancier_id;
    if (!bySup.has(lid)) bySup.set(lid, []);
    bySup.get(lid).push({ ...p, te: placed ? p.besteld.reduce((s, b) => s + (b.besteld || 0), 0) : p.gevraagd });
  }
  return [...bySup.entries()].map(([lid, ps]) => {
    const l = d.leveranciers.find(x => x.id === lid) || { naam: '?', regio: '' };
    const partij = d.partijen.find(x => x.leverancier_id === lid);
    return `<section class="sup" data-lev="${lid}">
      <header><b>${h(l.naam)}</b> ${regio(l.regio)}${partij ? ` ${zn(partij.nummer)} ${stageChip(partij.stage)}` : ` <span class="faint small">wordt ${h(d.volgendNummer[l.regio] || '')}</span>`}</header>
      <table class="tb sup-t"><thead><tr><th>Product</th><th class="r">Gevraagd</th><th class="r">Bestellen</th></tr></thead><tbody>
        ${ps.map(p => `<tr><td>${h(p.naam)} ${h(p.maat)}${p.leveranciers.length > 1 && !partij ? ` <select class="mini" data-act="order-lev" data-p="${p.id}" aria-label="Leverancier voor ${h(p.naam)} ${h(p.maat)}">${p.leveranciers.map(x => `<option value="${x}"${x === lid ? ' selected' : ''}>${h(d.leveranciers.find(y => y.id === x)?.naam || x)}</option>`).join('')}</select>` : ''}</td>
          <td class="r num">${fNum(p.gevraagd)}</td><td class="r"><input class="num-in" type="number" min="0" max="9999" value="${p.te}" data-plan="${p.id}" data-lev="${lid}" aria-label="Te bestellen ${h(p.naam)} ${h(p.maat)}"></td></tr>`).join('')}
      </tbody></table>
      <p class="sup-a"><button type="button" class="btn btn-sm btn-line" data-act="order-copy" data-lev="${lid}">${icon('copy')}Kopieer de bestelling</button>${l.email ? `<a class="btn btn-sm btn-ghost" href="mailto:${h(l.email)}?subject=${encodeURIComponent(`Pedido semana ${d.week} - Campo International`)}&body=${encodeURIComponent(orderText(d, l, ps))}">${icon('mail')}Mail</a>` : ''}</p>
    </section>`;
  }).join('');
}

function orderText(d, l, ps) {
  const first = (l.contact || '').split(' ')[0];
  const dag = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${d.maandag}T12:00:00`));
  return `Hola${first ? ` ${first}` : ''},\n\nPara la semana ${d.week} (llegada ${dag}) quisiera pedir:\n\n${ps.filter(p => p.te > 0).map(p => `${String(p.te).padStart(4)} cajas  ${spanishLine(p)}`).join('\n')}\n\nPor favor confirmen cantidades y vuelo.\n\nSaludos,\nJan\nCampo International`;
}

function regulars(d) {
  if (!d.nogNiet.length) return '';
  return `<section class="panel"><header><h2>Belt meestal, nog niet gehoord</h2><span class="sub">bestelde 4 van de laatste 8 weken</span></header>
    <ul class="reg">${d.nogNiet.slice(0, 12).map(k => `<li>
      <div><a href="#/klant/${k.id}"><b>${h(k.naam)}</b></a><small>${h(k.plaats)}, ${h(k.land)} · ${k.weken} van 8 weken</small>
        <small class="faint">Vorige keer: ${k.vorige.map(v => `${v.dozen} × ${h(v.product?.naam || '')} ${h(v.product?.maat || '')}`).join(', ') || '–'}</small></div>
      <div class="reg-a">${k.telefoon ? `<a class="btn btn-sm btn-ghost" href="tel:${h(String(k.telefoon).replace(/\s/g, ''))}">${icon('phone')}<span class="sr">Bel </span>${h(k.telefoon)}</a>` : ''}
        <button type="button" class="btn btn-sm btn-line" data-act="order-again" data-k="${k.id}">Zelfde als vorige keer</button></div>
    </li>`).join('')}</ul></section>`;
}

export async function render(params, query) {
  const m = query.get('maandag');
  const qs = m ? `?maandag=${m}` : '';
  const [d, deals, kansen] = await Promise.all([api(`/week/bestellen${qs}`), api(`/week/deals${qs}`).catch(() => null), api('/week/kansen').catch(() => null)]);
  last = d; D = deals; KN = kansen;
  const placed = d.partijen.filter(p => p.besteld_op);
  const due = d.vandaag > d.bestellen ? `Bestellen was op ${dLong(d.bestellen)}.` : d.vandaag === d.bestellen ? 'Vandaag bestellen.' : `Bestellen op ${dLong(d.bestellen)}.`;
  return `<div class="page wk">
    <div class="ph"><div><p class="kick">Week ${d.week} · binnen ${h(dLong(d.maandag))}</p><h1>Bestellen</h1>
      <p>Wat klanten aan de telefoon vroegen, opgeteld per product. ${h(due)}</p></div>
      <div class="acts">${weekNav('bestellen', d.maandag)}</div></div>
    ${dealsPanel()}
    <div class="grid2">
      <div class="stack">
        <section class="panel"><header><h2>Telefoon</h2><span class="sub">${fNum(d.totaal.klanten)} klanten · ${fNum(d.totaal.dozen)} dozen</span></header>
          <div class="body">${entry(d)}</div>${customers(d)}</section>
        ${regulars(d)}
      </div>
      <aside class="stack">
        <section class="panel"><header><h2>Bestelling per leverancier</h2><span class="sub">${placed.length ? `besteld ${h(dayTime(placed[0].besteld_op))}` : 'nog niet besteld'}</span></header>
          <div class="body stack">${suppliers(d)}
            <div class="next" style="margin:0"><b>${placed.length ? 'Bestelling aangepast?' : 'Besteld bij de leveranciers?'}</b>
              <p>${placed.length ? 'Zet de nieuwe aantallen in de zendingen.' : 'Dan maakt de desk per leverancier een zending met een eigen zendnummer. Dat nummer gaat mee tot op het plantenpaspoort.'}</p>
              <button type="button" class="btn btn-leaf" data-act="order-place">${icon('check')}${placed.length ? 'Aantallen bijwerken' : 'Ik heb besteld'}</button></div>
          </div></section>
        ${placed.length ? `<section class="panel"><header><h2>Zendingen</h2></header><ul class="ships">${placed.map(p => `<li><a href="#/inkoop?maandag=${d.maandag}&p=${p.id}">${zn(p.nummer)}</a><span class="ships-b"><b>${h(p.leverancier)}</b><small>${regio(p.regio)} ${fNum(p.regels.reduce((s, r) => s + (r.besteld || 0), 0))} dozen besteld</small></span><span class="ships-s">${stageChip(p.stage)}</span></li>`).join('')}</ul></section>` : ''}
      </aside>
    </div>
    ${leadsPanel()}
  </div>`;
}

const klantId = naam => { const n = String(naam || '').trim().toLowerCase(); const k = last.alleKlanten.find(x => x.naam.toLowerCase() === n) || last.alleKlanten.filter(x => x.naam.toLowerCase().includes(n)); return Array.isArray(k) ? (k.length === 1 ? k[0].id : null) : k.id; };
function plan() {
  return [...document.querySelectorAll('[data-plan]')].map(i => ({ product_id: Number(i.dataset.plan), leverancier_id: Number(i.closest('tr')?.querySelector('[data-act="order-lev"]')?.value || i.dataset.lev), dozen: Number(i.value) }));
}

const nOf = (sel) => Math.max(0, Math.round(Number(document.querySelector(sel)?.value) || 0));
export const actions = {
  'deal-yes': async (el, ctx) => {
    const n = nOf(`input[data-n-id="${el.dataset.id}"][data-n-k="${el.dataset.k}"]`);
    if (!n) { toast('Vul het aantal dozen in.'); return; }
    el.disabled = true;
    await api(`/week/aanbod/${el.dataset.id}/verkoop`, { method: 'POST', body: { klant_id: Number(el.dataset.k), dozen: n } });
    toast(`Genoteerd: ${n} dozen. Ze staan bij de telefoonbestellingen.`); ctx.refresh();
  },
  'deal-undo': async (el, ctx) => { await api(`/week/aanbod/${el.dataset.id}/verkoop`, { method: 'POST', body: { klant_id: Number(el.dataset.k), dozen: 0 } }); toast('Teruggezet.'); ctx.refresh(); },
  'deal-take': async (el, ctx) => { await api(`/week/aanbod/${el.dataset.id}/status`, { method: 'POST', body: { status: 'genomen' } }); toast('Aangenomen. De prijs van het aanbod gaat mee in de bestelling.'); ctx.refresh(); },
  'deal-skip': async (el, ctx) => { await api(`/week/aanbod/${el.dataset.id}/status`, { method: 'POST', body: { status: 'afgewezen' } }); toast('Niet genomen.'); ctx.refresh(); },
  'deal-open': async (el, ctx) => { await api(`/week/aanbod/${el.dataset.id}/status`, { method: 'POST', body: { status: 'open' } }); ctx.refresh(); },
  'way-yes': async (el, ctx) => {
    const n = nOf(`input[data-n-p="${el.dataset.p}"][data-n-k="${el.dataset.k}"]`);
    if (!n) { toast('Vul het aantal dozen in.'); return; }
    el.disabled = true;
    await api('/week/deals/onderweg', { method: 'POST', body: { klant_id: Number(el.dataset.k), product_id: Number(el.dataset.p), dozen: n } });
    toast(`Genoteerd voor maandag: ${n} ${n === 1 ? 'doos' : 'dozen'} erbij.`); ctx.refresh();
  },
  'aanbod-new': (el, ctx) => dialog({
    title: `Aanbod voor week ${last.week}`, ok: 'Noteren',
    body: `<div class="form">${field('leverancier_id', 'Leverancier', last.leveranciers[0]?.id, { opts: last.leveranciers.map(l => [l.id, l.naam]) })}
      ${field('product_id', 'Product', last.producten[0]?.id, { opts: last.producten.map(p => [p.id, `${p.naam} ${p.maat}`]) })}
      ${field('dozen', 'Dozen', '', { type: 'number', required: true })}${field('prijs_usd', 'Prijs in dollar per stuk', '', { required: true })}
      ${field('notitie', 'Wat hij schreef (mag leeg)', '', { type: 'textarea', wide: true })}</div>
      <p class="small faint">De desk zoekt de vaste kopers erbij en rekent de marge uit. Jij belt.</p>`,
    onOk: async v => { await api('/week/aanbod', { method: 'POST', body: { ...v, maandag: last.maandag } }); toast('Aanbod genoteerd.'); ctx.refresh(); },
  }),
  'lead-new': (el, ctx) => dialog({
    title: 'Kans toevoegen', ok: 'Toevoegen',
    body: `<div class="form">${field('soort', 'Wat is het', 'klant', { opts: [['klant', 'Een mogelijke klant'], ['leverancier', 'Een mogelijke leverancier']] })}${field('naam', 'Naam', '', { required: true })}
      ${field('plaats', 'Plaats')}${field('land', 'Land (2 letters)', 'NL')}${field('segment', 'Soort bedrijf of wat hij kweekt')}${field('contact', 'Contactpersoon')}${field('telefoon', 'Telefoon')}${field('email', 'E-mail', '', { type: 'email' })}
      ${field('wat', 'Wat zou hij kopen of leveren', '', { wide: true })}${field('waarom', 'Waarom past het', '', { type: 'textarea', wide: true })}</div>`,
    onOk: async v => { await api('/week/kansen', { method: 'POST', body: v }); toast('Toegevoegd.'); ctx.refresh(); },
  }),
  'lead-note': (el, ctx) => {
    const x = KN.kansen.find(k => k.id === Number(el.dataset.id));
    dialog({ title: x.naam, ok: 'Opslaan', body: field('notitie', 'Notitie', x.notitie || '', { type: 'textarea', wide: true }), onOk: async v => { await api(`/week/kansen/${x.id}`, { method: 'PATCH', body: { notitie: v.notitie } }); toast('Opgeslagen.'); ctx.refresh(); } });
  },
  'order-del': async (el, ctx) => { await api('/week/bestellen/regel', { method: 'POST', body: { maandag: last.maandag, klant_id: Number(el.dataset.k), product_id: Number(el.dataset.p), dozen: 0 } }); toast('Weggehaald.'); ctx.refresh(); },
  'order-again': async (el, ctx) => { el.disabled = true; const r = await api('/week/bestellen/vorige', { method: 'POST', body: { maandag: last.maandag, klant_id: Number(el.dataset.k) } }); toast(`${r.regels} ${r.regels === 1 ? 'regel' : 'regels'} genoteerd, zoals vorige keer.`); ctx.refresh(); },
  'order-copy': async el => {
    const lid = Number(el.dataset.lev), l = last.leveranciers.find(x => x.id === lid);
    const ps = plan().filter(x => x.leverancier_id === lid && x.dozen > 0).map(x => ({ ...last.producten.find(p => p.id === x.product_id), te: x.dozen }));
    await copy(orderText(last, l, ps));
  },
  'order-place': async (el, ctx) => {
    const items = plan().filter(x => x.dozen > 0);
    if (!items.length) { toast('Er staat nog niets om te bestellen.'); return; }
    el.disabled = true;
    const r = await api('/week/bestellen/plaatsen', { method: 'POST', body: { maandag: last.maandag, regels: items } });
    toast(`Zendingen: ${r.partijen.map(p => p.nummer).join(', ')}.`);
    ctx.refresh();
  },
};

export function mount(ctx) {
  const f = document.querySelector('[data-form="order"]');
  if (f) f.addEventListener('submit', async e => {
    e.preventDefault();
    const k = klantId(f.klant.value);
    if (!k) { toast('Kies een klant uit de lijst.'); f.klant.focus(); return; }
    await api('/week/bestellen/regel', { method: 'POST', body: { maandag: last.maandag, klant_id: k, product_id: Number(f.product_id.value), dozen: Number(f.dozen.value) } }).catch(x => { toast(x.message); throw x; });
    toast(`Genoteerd: ${f.dozen.value} dozen voor ${f.klant.value}.`);
    await ctx.refresh();
    const again = document.querySelector('[data-form="order"] input[name="klant"]'); if (again) again.focus();
  });
}
export async function onChange(e, ctx) {
  const el = e.target;
  if (el.matches('select[data-lead]')) { await api(`/week/kansen/${el.dataset.lead}`, { method: 'PATCH', body: { status: el.value } }).catch(x => toast(x.message)); toast('Bijgewerkt.'); ctx.refresh(); return; }
  if (el.matches('[data-act="order-set"]')) {
    await api('/week/bestellen/regel', { method: 'POST', body: { maandag: last.maandag, klant_id: Number(el.dataset.k), product_id: Number(el.dataset.p), dozen: Math.max(0, Number(el.value) || 0) } }).catch(x => toast(x.message));
    ctx.refresh();
  }
}
