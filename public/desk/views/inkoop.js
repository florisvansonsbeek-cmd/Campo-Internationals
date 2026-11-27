// Inkoop (Thursday and Friday): per shipment what was ordered, what the supplier confirmed and what is on the shipping papers.
// The papers are the purchase order for Exact: every line ready, with the batch number as cost unit. Jan checks against the original.
import { api, h, icon, fNum, toast, copy, dialog, field } from '../core.js';
import { weekNav, dLong, dayTime, zn, regio, stageChip, delta, fUsd, fUsdUnit, readFile } from '../wk.js';

let last = null;
const DOC = { bestelling: 'Jans bestelling', bevestiging: 'Bevestiging', verzendbewijs: 'Verzendpapieren', awb: 'AWB', fyto: 'Fytosanitair', overig: 'Document' };

function timeline(p) {
  const st = [
    ['Besteld', p.besteld_op, null],
    ['Bevestigd', p.bevestigd_op, p.verwacht.bevestiging],
    ['Verzonden', p.verzonden_op, p.verwacht.verzonden, p.verzonden_op ? [p.awb ? `AWB ${p.awb}` : '', p.vlucht].filter(Boolean).join(' · ') : ''],
    ['In Exact', p.exact === 'in_exact' ? p.exact_op : null, null, p.exact_nummer ? `nr. ${p.exact_nummer}` : ''],
  ];
  return `<ol class="tl">${st.map(([t, at, exp, sub]) => `<li class="${at ? 'done' : ''}"><b>${t}</b><span>${at ? h(dayTime(at)) : exp ? `verwacht ${h(dayTime(exp))}` : '–'}</span>${sub ? `<small>${h(sub)}</small>` : ''}</li>`).join('')}</ol>`;
}

function lines(p) {
  return `<div class="tbwrap"><table class="tb lines"><thead><tr><th>Product</th><th class="r">Besteld</th><th class="r">Bevestigd</th><th class="r">Verzonden</th><th class="r">Per doos</th><th class="r">Stuks</th><th class="r">Prijs</th><th class="r">Bedrag</th><th></th></tr></thead><tbody>
    ${p.regels.map(r => {
      const stuks = (r.verzonden ?? r.bevestigd ?? r.besteld ?? 0) * r.per_doos;
      return `<tr class="${r.twijfel ? 'doubt' : ''}" id="r${r.id}">
        <td><b>${h(r.product)} ${h(r.maat)}</b><small class="faint" style="display:block">${h(r.soort)}</small>${r.twijfel ? `<p class="why-d">${icon('warn')}${h(r.twijfel)}</p>` : ''}</td>
        <td class="r num">${r.besteld == null ? '–' : fNum(r.besteld)}</td>
        <td class="r num">${r.bevestigd == null ? '–' : fNum(r.bevestigd)} ${delta(r.besteld, r.bevestigd)}</td>
        <td class="r num">${r.verzonden == null ? '–' : `<b>${fNum(r.verzonden)}</b>`} ${delta(r.bevestigd ?? r.besteld, r.verzonden)}${r.zekerheid != null && r.verzonden != null ? `<small class="conf ${r.zekerheid >= 90 ? 'hi' : r.zekerheid >= 75 ? 'mid' : 'lo'}" title="Hoe zeker de desk het las">${r.zekerheid}%</small>` : ''}</td>
        <td class="r num">${fNum(r.per_doos)}</td><td class="r num">${fNum(stuks)}</td><td class="r num">${fUsdUnit(r.prijs_usd)}</td><td class="r num">${fUsd(stuks * r.prijs_usd)}</td>
        <td class="r nowrap">${r.twijfel ? `<button type="button" class="btn btn-sm btn-leaf" data-act="line-ok" data-id="${r.id}">${fNum(r.verzonden)} klopt</button> ` : ''}<button type="button" class="btn btn-sm btn-ghost" data-act="line-edit" data-id="${r.id}" data-p="${p.id}" aria-label="Aanpassen">${icon('edit')}</button></td>
      </tr>`;
    }).join('')}
  </tbody></table></div>`;
}

function exactBox(p) {
  const ready = p.verzonden_op && !p.twijfels;
  return `<div class="exact ${p.exact === 'in_exact' ? 'is-in' : ''}">
    <div class="exact-h"><b>Inkooporder voor Exact</b><span class="small muted">${h(p.leverancier)} · valuta USD · kostendrager <b>${h(p.nummer)}</b> · ${fUsd(p.totaal_usd)}</span></div>
    <details><summary>De ${p.exactRegels.length} regels zoals ze in Exact komen</summary>
      <div class="tbwrap"><table class="tb"><thead><tr><th>Artikel</th><th>Omschrijving</th><th class="r">Aantal</th><th class="r">Prijs $</th><th class="r">Bedrag $</th><th>Kostendrager</th></tr></thead><tbody>
      ${p.exactRegels.map(l => `<tr><td>${h(l.artikel)}</td><td>${h(l.omschrijving)}</td><td class="r num">${fNum(l.stuks)}</td><td class="r num">${fUsdUnit(l.prijs_usd)}</td><td class="r num">${fUsd(l.bedrag_usd)}</td><td>${h(l.kostendrager)}</td></tr>`).join('')}
      </tbody></table></div></details>
    <div class="exact-a">
      <button type="button" class="btn btn-sm btn-line" data-act="exact-copy" data-id="${p.id}">${icon('copy')}Kopieer regels</button>
      ${p.exact === 'in_exact' ? `<span class="chip ok">${icon('check')}Staat in Exact${p.exact_op ? ` sinds ${h(dayTime(p.exact_op))}` : ''}</span><button type="button" class="lnk small" data-act="exact-back" data-id="${p.id}">Terugzetten</button>`
        : `<button type="button" class="btn btn-sm btn-leaf" data-act="exact-in" data-id="${p.id}"${ready ? '' : ' disabled'} title="${ready ? '' : p.verzonden_op ? 'Kijk eerst de twijfels na' : 'Wacht op het verzendbewijs'}">${icon('check')}Staat in Exact</button>
           ${ready ? '' : `<span class="small faint">${p.verzonden_op ? 'Eerst de regels nakijken waar de desk over twijfelt.' : 'De inkooporder komt uit het verzendbewijs.'}</span>`}`}
    </div>
  </div>`;
}

function partij(p, d) {
  const manual = p.stage === 'besteld' ? `<button type="button" class="btn btn-sm btn-ghost" data-act="stage" data-id="${p.id}" data-stap="bevestigd">Bevestigd zonder papier</button>`
    : p.stage === 'bevestigd' ? `<button type="button" class="btn btn-sm btn-ghost" data-act="stage" data-id="${p.id}" data-stap="verzonden">Verzonden zonder papier</button>` : '';
  return `<section class="panel partij" id="p${p.id}">
    <header><h2>${zn(p.nummer)} ${h(p.leverancier)}</h2>
      <span class="ph-chips">${regio(p.regio)} ${stageChip(p.stage)}${p.twijfels ? ` <span class="chip wait">${p.twijfels} nakijken</span>` : ''} <button type="button" class="lnk small" data-act="nummer" data-id="${p.id}" data-nr="${h(p.nummer)}">Zendnummer wijzigen</button></span></header>
    <div class="body stack">
      ${timeline(p)}
      <div class="docs">${p.docs.map(x => `<button type="button" class="doc" data-act="doc" data-p="${p.id}" data-d="${x.id}">${icon(x.bestand_id ? 'file' : 'mail')}<span><b>${h(x.titel || DOC[x.soort])}</b><small>${h(DOC[x.soort])} · ${h(dayTime(x.ontvangen))}${x.gelezen_door === 'ai' ? ' · gelezen door de desk' : ''}</small></span></button>`).join('')}
        <button type="button" class="doc add" data-act="doc-add" data-p="${p.id}">${icon('upload')}<span><b>Papier toevoegen</b><small>pdf, foto of geplakte mail</small></span></button></div>
      ${lines(p)}
      ${exactBox(p)}
      ${manual ? `<p class="small faint">Kwam de ${p.stage === 'besteld' ? 'bevestiging' : 'verzendinformatie'} via de telefoon? ${manual}</p>` : ''}
    </div>
  </section>`;
}

export async function render(params, query) {
  const m = query.get('maandag');
  const d = await api(`/week/inkoop${m ? `?maandag=${m}` : ''}`);
  last = d;
  return `<div class="page wk">
    <div class="ph"><div><p class="kick">Week ${d.week} · binnen ${h(dLong(d.maandag))}</p><h1>Inkoop</h1>
      <p>Per zending wat je bestelde, wat de leverancier bevestigde en wat er in het vliegtuig zit. De verzendpapieren zijn de inkooporder voor Exact, met het zendnummer als kostendrager.</p></div>
      <div class="acts">${weekNav('inkoop', d.maandag)}</div></div>
    ${d.vorige.length ? `<div class="warnbox wait">${icon('info')}<span>Nog niet in Exact van week ${d.vorige[0].week}: ${d.vorige.map(p => `<a href="#/inkoop?maandag=${p.maandag}&p=${p.id}">${h(p.nummer)}</a>`).join(', ')}.</span></div>` : ''}
    ${d.partijen.length ? d.partijen.map(p => partij(p, d)).join('') : `<section class="panel"><p class="empty">Voor deze week is nog niets besteld. <a href="#/bestellen?maandag=${d.maandag}">Naar bestellen</a></p></section>`}
  </div>`;
}

export function mount() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const el = q.get('p') && document.getElementById(`p${q.get('p')}`);
  if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 30);
}
export const refreshEvery = 60000;

const P = id => last.partijen.find(p => p.id === Number(id));

// the original next to what the desk read from it
function showDoc(p, doc) {
  const dlg = document.getElementById('dlg');
  const field_ = { bestelling: 'besteld', bevestiging: 'bevestigd', verzendbewijs: 'verzonden' }[doc.soort];
  const read = field_ ? `<table class="tb"><thead><tr><th>Wat de desk las</th><th class="r">Dozen</th>${field_ === 'verzonden' ? '<th class="r">Prijs</th><th class="r">Zeker</th>' : ''}</tr></thead><tbody>
      ${p.regels.map(r => `<tr class="${r.twijfel && field_ === 'verzonden' ? 'doubt' : ''}"><td>${h(r.product)} ${h(r.maat)}</td><td class="r num"><b>${r[field_] == null ? '–' : fNum(r[field_])}</b></td>${field_ === 'verzonden' ? `<td class="r num">${fUsdUnit(r.prijs_usd)}</td><td class="r">${r.zekerheid != null ? `<span class="conf ${r.zekerheid >= 90 ? 'hi' : r.zekerheid >= 75 ? 'mid' : 'lo'}">${r.zekerheid}%</span>` : ''}</td>` : ''}</tr>`).join('')}
    </tbody></table>${field_ === 'verzonden' ? `<dl class="kv small" style="margin-top:10px"><dt>AWB</dt><dd>${h(p.awb || '–')}</dd><dt>Vlucht</dt><dd>${h(p.vlucht || '–')}</dd><dt>Fytosanitair</dt><dd>${h(p.fyto || '–')}</dd></dl>` : ''}` : '';
  dlg.classList.add('dlg-wide');
  dlg.innerHTML = `<form method="dialog"><header><h2>${h(doc.titel || DOC[doc.soort])} · ${h(p.nummer)}</h2></header>
    <div class="body docview"><div class="orig">${doc.bestand_id ? `<iframe src="/api/bestanden/${doc.bestand_id}" title="Origineel"></iframe><a class="lnk small" href="/api/bestanden/${doc.bestand_id}" target="_blank" rel="noopener">Open het origineel apart</a>` : `<pre class="mailtxt" style="max-height:none">${h(doc.tekst || '')}</pre>`}</div>
      <div>${read || '<p class="muted">Dit papier hoort bij de zending; er zijn geen aantallen uit gelezen.</p>'}<p class="small faint" style="margin-top:10px">${doc.gelezen_door === 'ai' ? 'Gelezen door de desk.' : doc.gelezen_door === 'regels' ? 'Gelezen met vaste regels.' : 'Door Jan ingevoerd.'} Ontvangen ${h(dayTime(doc.ontvangen))}.</p></div></div>
    <footer><button class="btn btn-leaf" value="cancel" type="submit">Sluiten</button></footer></form>`;
  dlg.addEventListener('close', () => dlg.classList.remove('dlg-wide'), { once: true });
  dlg.showModal();
}

export const actions = {
  doc: el => { const p = P(el.dataset.p); showDoc(p, p.docs.find(x => x.id === Number(el.dataset.d))); },
  'doc-add': (el, ctx) => {
    const p = P(el.dataset.p);
    dialog({
      title: `Papier bij ${p.nummer}`, ok: 'Lezen en toevoegen',
      body: `<div class="form">${field('soort', 'Wat is het', p.stage === 'besteld' ? 'bevestiging' : 'verzendbewijs', { opts: [['bevestiging', 'Bevestiging van de leverancier'], ['verzendbewijs', 'Verzendpapieren (factura, packing list)'], ['awb', 'AWB'], ['fyto', 'Fytosanitair certificaat'], ['overig', 'Iets anders']] })}
        <label class="f wide">Pdf of foto<input type="file" name="bestand" accept="application/pdf,image/png,image/jpeg,image/webp"></label>
        ${field('tekst', 'Of plak de mail of het appje', '', { type: 'textarea', wide: true })}</div>
        <p class="small faint">De desk leest de dozen en prijzen en zet ze bij de regels. Twijfelt hij, dan zie je dat hier en kies jij.</p>`,
      onOk: async (v, dlg) => {
        const file = dlg.querySelector('input[type=file]').files[0];
        const body = { soort: v.soort, tekst: v.tekst || '' };
        if (file) Object.assign(body, { naam: file.name, mime: file.type, data: await readFile(file) });
        const r = await api(`/week/partijen/${p.id}/document`, { method: 'POST', body });
        toast(r.gelezen != null ? `${r.gelezen} regels gelezen${r.twijfel ? `, ${r.twijfel} om na te kijken` : ''}${r.onbekend?.length ? `; niet herkend: ${r.onbekend.slice(0, 2).join(', ')}` : ''}.` : 'Toegevoegd.');
        ctx.refresh();
      },
    });
  },
  'line-ok': async (el, ctx) => { await api(`/week/regels/${el.dataset.id}`, { method: 'PATCH', body: { nagekeken: true } }); toast('Nagekeken.'); ctx.refresh(); },
  'line-edit': (el, ctx) => {
    const p = P(el.dataset.p), r = p.regels.find(x => x.id === Number(el.dataset.id));
    dialog({
      title: `${r.product} ${r.maat} · ${p.nummer}`, ok: 'Opslaan',
      body: `<div class="form">${field('besteld', 'Besteld (dozen)', r.besteld ?? '', { type: 'number' })}${field('bevestigd', 'Bevestigd', r.bevestigd ?? '', { type: 'number' })}
        ${field('verzonden', 'Verzonden (verzendbewijs)', r.verzonden ?? '', { type: 'number' })}${field('prijs_usd', 'Inkoopprijs $ per stuk', String(r.prijs_usd).replace('.', ','))}</div>
        ${r.twijfel ? `<p class="small" style="color:var(--wait);margin-top:10px">${h(r.twijfel)}</p>` : ''}`,
      onOk: async v => { await api(`/week/regels/${r.id}`, { method: 'PATCH', body: { ...v, nagekeken: true } }); toast('Opgeslagen.'); ctx.refresh(); },
    });
  },
  stage: async (el, ctx) => { await api(`/week/partijen/${el.dataset.id}/stap`, { method: 'POST', body: { stap: el.dataset.stap } }); toast('Verwerkt.'); ctx.refresh(); },
  nummer: (el, ctx) => dialog({
    title: 'Zendnummer', ok: 'Opslaan',
    body: `${field('nummer', 'Zendnummer (C op het plantenpaspoort, kostendrager in Exact)', el.dataset.nr)}<p class="small faint" style="margin-top:8px">Regiocode vooraan, daarna jaar en volgnummer, bijvoorbeeld CR26-048. Elk nummer is uniek.</p>`,
    onOk: async v => { await api(`/week/partijen/${el.dataset.id}`, { method: 'PATCH', body: { nummer: v.nummer } }); toast('Zendnummer opgeslagen.'); ctx.refresh(); },
  }),
  'exact-copy': async el => {
    const p = P(el.dataset.id);
    await copy(['Artikel\tOmschrijving\tAantal\tPrijs USD\tBedrag USD\tKostendrager', ...p.exactRegels.map(l => [l.artikel, l.omschrijving, l.stuks, String(l.prijs_usd).replace('.', ','), String(l.bedrag_usd).replace('.', ','), l.kostendrager].join('\t'))].join('\n'));
  },
  'exact-in': (el, ctx) => dialog({
    title: 'Staat in Exact', ok: 'Staat in Exact',
    body: `${field('nummer', 'Nummer van de inkooporder in Exact (mag leeg)', '')}`,
    onOk: async v => { await api(`/week/partijen/${el.dataset.id}/exact`, { method: 'POST', body: { nummer: v.nummer || null } }); toast('Inkooporder staat in Exact.'); ctx.refresh(); },
  }),
  'exact-back': async (el, ctx) => { await api(`/week/partijen/${el.dataset.id}/exact`, { method: 'POST', body: { terug: true } }); toast('Teruggezet.'); ctx.refresh(); },
};
