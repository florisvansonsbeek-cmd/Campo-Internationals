// One shipment, the same on Inkoop and on the supplier's page: does it arrive (the route with its light and the reasons),
// the full list, to whom it goes, the papers and the purchase order for Exact.
import { api, h, icon, fNum, toast, copy, dialog, field } from './core.js';
import { dayTime, dShort, zn, regio, stageChip, delta, fUsd, fUsdUnit, readFile } from './wk.js';
import { paperHtml, drawPapers } from './paper.js';

export const DOC = { bestelling: 'Jans bestelling', bevestiging: 'Bevestiging', verzendbewijs: 'Verzendpapieren', awb: 'AWB', fyto: 'Fytosanitair', overig: 'Document' };
const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const pad = n => String(n).padStart(2, '0');
// a moment for a datetime-local field, in the time of the person filling it in
const localInput = v => { if (!v) return ''; const d = new Date(v); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const iso = v => (v ? new Date(v).toISOString() : null);

// ---------------------------------------------------------------- the light: green, orange, red
const LICHT = { groen: 'Op schema', oranje: 'Let op', rood: 'Probleem', binnen: 'Binnen' };
export const lightWord = l => LICHT[l] || 'Nog niet besteld';
export const stoplicht = l => `<span class="sl" data-l="${h(l || '')}" role="img" aria-label="${h(lightWord(l))}"><i></i><i></i><i></i></span>`;
export const lightChip = l => `<span class="lgt" data-l="${h(l || '')}"><i aria-hidden="true"></i>${h(lightWord(l))}</span>`;

const BRON = { demo: 'Voorbeeld', jan: 'Melding van Jan', desk: 'De desk', 'met.no': 'Weerbericht MET Norway', nhc: 'Orkaancentrum NHC', kalender: 'Kalender' };
// the doubt on the papers has its own box with the answers, so a card can leave it out here
export function reasons(r, { info = true, actions = true, doubt = true } = {}) {
  const list = (r?.redenen || []).filter(x => (info || x.ernst !== 'info') && (doubt || !x.twijfel));
  if (!list.length) return '';
  return `<ul class="rsn">${list.map(x => `<li class="e-${h(x.ernst)}">
      <i aria-hidden="true"></i><div><b>${h(x.tekst)}</b>${x.uitleg ? `<p>${h(x.uitleg)}</p>` : ''}
      <small>${h(BRON[x.bron] || 'De desk')}${x.plek ? ` · ${h(x.plek)}` : ''}${x.tot ? ` · tot ${h(dayTime(x.tot))}` : ''}${actions && x.id && x.bron === 'jan' ? ` · <button type="button" class="lnk small" data-act="melding-weg" data-id="${x.id}">Opgelost</button>` : ''}</small></div></li>`).join('')}</ul>`;
}

// farm, airports, the truck, the hall: each stop with its own light
export function routeStrip(r) {
  if (!r || !r.stops) return '';
  const leg = (a, b) => {
    const truck = a.soort === 'herkomst' || b.soort === 'loods';
    return `<li class="hleg ${b.voorbij || (a.voorbij && b.soort === 'vertrek') ? 'done' : ''}" aria-hidden="true">${icon(truck ? 'truck' : 'plane')}</li>`;
  };
  const out = [];
  r.stops.forEach((s, i) => {
    if (i) out.push(leg(r.stops[i - 1], s));
    const title = s.soort === 'herkomst' ? s.stad || s.naam : s.soort === 'loods' ? 'Nootdorp' : s.code;
    const sub = s.soort === 'herkomst' ? 'kwekerij' : s.soort === 'loods' ? 'de loods' : s.stad;
    const when = s.soort === 'loods' ? dayTime(r.binnen || r.verwacht) : dShort(s.dag);
    out.push(`<li class="hop${s.voorbij ? ' done' : ''}" data-l="${h(s.licht)}"><span class="hd" aria-hidden="true">${s.voorbij ? icon('check') : ''}</span>
      <b>${h(title)}</b><small>${h(sub || '')}</small><small class="t">${h(when)}</small></li>`);
  });
  return `<ol class="rte" aria-label="Route">${out.join('')}</ol>`;
}

// ---------------------------------------------------------------- the full list
export function timeline(p) {
  const st = [
    ['Besteld', p.besteld_op, null],
    ['Bevestigd', p.bevestigd_op, p.verwacht?.bevestiging],
    ['Verzonden', p.verzonden_op, p.verwacht?.verzonden, p.verzonden_op ? [p.awb ? `AWB ${p.awb}` : '', p.vlucht].filter(Boolean).join(' · ') : ''],
    ['In Exact', p.exact === 'in_exact' ? p.exact_op : null, null, p.exact_nummer ? `nr. ${p.exact_nummer}` : ''],
  ];
  return `<ol class="tl">${st.map(([t, at, exp, sub]) => `<li class="${at ? 'done' : ''}"><b>${t}</b><span>${at ? h(dayTime(at)) : exp ? `verwacht ${h(dayTime(exp))}` : '–'}</span>${sub ? `<small>${h(sub)}</small>` : ''}</li>`).join('')}</ol>`;
}

export function lines(p) {
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
  </tbody><tfoot><tr><td><b>Samen</b></td><td class="r num">${fNum(sum(p.regels, r => r.besteld || 0))}</td><td class="r num">${p.bevestigd_op ? fNum(sum(p.regels, r => r.bevestigd || 0)) : '–'}</td><td class="r num">${p.verzonden_op ? `<b>${fNum(sum(p.regels, r => r.verzonden || 0))}</b>` : '–'}</td>
    <td></td><td class="r num">${fNum(sum(p.regels, r => (r.verzonden ?? r.bevestigd ?? r.besteld ?? 0) * r.per_doos))}</td><td></td><td class="r num">${fUsd(p.totaal_usd)}</td><td></td></tr></tfoot></table></div>`;
}

// to whom every line goes: the stream as a list
export function toWhom(p) {
  const st = p.stroom;
  if (!st || !st.links.length) return '<p class="small faint">Nog niet verdeeld: de desk legt de telefoonbestellingen erover zodra er besteld is.</p>';
  const name = new Map(st.regels.map(r => [r.id, `${r.naam} ${r.maat}`]));
  const by = new Map();
  for (const l of st.links) { if (!by.has(l.naar)) by.set(l.naar, []); by.get(l.naar).push(l); }
  const rows = st.klanten.map(k => `<li><a href="#/klant/${k.id}"><b>${h(k.naam)}</b></a><span>${(by.get(k.id) || []).map(l => `${fNum(l.dozen)} × ${h(name.get(l.van))}`).join(' · ')}</span><em>${fNum(k.dozen)}</em></li>`);
  const rest = st.regels.filter(r => r.rest > 0);
  if (rest.length) rows.push(`<li class="t-wait"><b>Over in de loods</b><span>${rest.map(r => `${fNum(r.rest)} × ${h(r.naam)} ${h(r.maat)}`).join(' · ')}</span><em>${fNum(st.rest)}</em></li>`);
  return `<ul class="whom">${rows.join('')}</ul><p class="small faint">${st.basis === 'geteld' ? 'Zoals Jan het maandag verdeelde.' : 'Voorstel van de desk uit de telefoonbestellingen. Maandag na het tellen verdeel je het echt.'}</p>`;
}

export function exactBox(p, kan = null) {
  const ready = p.verzonden_op && !p.twijfels;
  const push = kan && kan.kan;
  return `<div class="exact ${p.exact === 'in_exact' ? 'is-in' : ''}">
    <div class="exact-h"><b>Inkooporder voor Exact</b><span class="small muted">${h(p.leverancier)} · valuta USD · kostendrager <b>${h(p.nummer)}</b> · ${fUsd(p.totaal_usd)}</span></div>
    <details><summary>De ${p.exactRegels.length} regels zoals ze in Exact komen</summary>
      <div class="tbwrap"><table class="tb"><thead><tr><th>Artikel</th><th>Omschrijving</th><th class="r">Aantal</th><th class="r">Prijs $</th><th class="r">Bedrag $</th><th>Kostendrager</th></tr></thead><tbody>
      ${p.exactRegels.map(l => `<tr><td>${h(l.artikel)}</td><td>${h(l.omschrijving)}</td><td class="r num">${fNum(l.stuks)}</td><td class="r num">${fUsdUnit(l.prijs_usd)}</td><td class="r num">${fUsd(l.bedrag_usd)}</td><td>${h(l.kostendrager)}</td></tr>`).join('')}
      </tbody></table></div></details>
    <div class="exact-a">
      <button type="button" class="btn btn-sm btn-line" data-act="exact-copy" data-id="${p.id}">${icon('copy')}Kopieer regels</button>
      ${p.exact === 'in_exact' ? `<span class="chip ok">${icon('check')}Staat in Exact${p.exact_op ? ` sinds ${h(dayTime(p.exact_op))}` : ''}</span><button type="button" class="lnk small" data-act="exact-back" data-id="${p.id}">Terugzetten</button>`
        : push ? `<button type="button" class="btn btn-sm btn-leaf" data-act="exact-zet-p" data-id="${p.id}"${ready ? '' : ' disabled'} title="${ready ? '' : p.verzonden_op ? 'Kijk eerst de twijfels na' : 'Wacht op het verzendbewijs'}">${icon('check')}Zet in ${kan.bron === 'demo' ? 'demo-Exact' : 'Exact'}</button><button type="button" class="lnk small" data-act="exact-in" data-id="${p.id}"${ready ? '' : ' disabled'}>met de hand gezet</button>`
        : `<button type="button" class="btn btn-sm btn-leaf" data-act="exact-in" data-id="${p.id}"${ready ? '' : ' disabled'} title="${ready ? '' : p.verzonden_op ? 'Kijk eerst de twijfels na' : 'Wacht op het verzendbewijs'}">${icon('check')}Staat in Exact</button>
           ${ready ? '' : `<span class="small faint">${p.verzonden_op ? 'Eerst de regels nakijken waar de desk over twijfelt.' : 'De inkooporder komt uit het verzendbewijs.'}</span>`}`}
    </div>
  </div>`;
}

export function docsRow(p, { add = true } = {}) {
  return `<div class="docs">${p.docs.map(x => `<button type="button" class="doc" data-act="doc" data-p="${p.id}" data-d="${x.id}">${icon(x.bestand_id ? 'file' : 'mail')}<span><b>${h(x.titel || DOC[x.soort])}</b><small>${h(DOC[x.soort])} · ${h(dayTime(x.ontvangen))}${x.gelezen_door === 'ai' ? ' · gelezen door de desk' : ''}</small></span></button>`).join('')}
    ${add ? `<button type="button" class="doc add" data-act="doc-add" data-p="${p.id}">${icon('upload')}<span><b>Papier toevoegen</b><small>pdf, foto of geplakte mail</small></span></button>` : ''}</div>`;
}

// the lines the desk doubts, with the two answers right there
export function doubts(p) {
  const d = p.regels.filter(r => r.twijfel);
  if (!d.length) return '';
  return `<div class="warnbox wait doubts">${icon('warn')}<div>${d.map(r => `<p><b>${h(r.product)} ${h(r.maat)}:</b> ${h(r.twijfel)}</p>
    <p class="acts"><button type="button" class="btn btn-sm btn-leaf" data-act="line-ok" data-id="${r.id}">${fNum(r.verzonden)} klopt</button><button type="button" class="btn btn-sm btn-line" data-act="line-edit" data-id="${r.id}" data-p="${p.id}">Aanpassen</button>
    <button type="button" class="btn btn-sm btn-ghost" data-act="doc" data-p="${p.id}" data-d="${(p.docs.find(x => x.soort === 'verzendbewijs') || p.docs[p.docs.length - 1] || {}).id || ''}">Bekijk het origineel</button></p>`).join('')}</div></div>`;
}

// ---------------------------------------------------------------- the original next to what the desk read from it
export function showDoc(p, doc) {
  if (!doc) return;
  const dlg = document.getElementById('dlg');
  const f = { bestelling: 'besteld', bevestiging: 'bevestigd', verzendbewijs: 'verzonden' }[doc.soort];
  const read = f ? `<table class="tb"><thead><tr><th>Wat de desk las</th><th class="r">Dozen</th>${f === 'verzonden' ? '<th class="r">Prijs</th><th class="r">Zeker</th>' : ''}</tr></thead><tbody>
      ${p.regels.map(r => `<tr class="${r.twijfel && f === 'verzonden' ? 'doubt' : ''}"><td>${h(r.product)} ${h(r.maat)}</td><td class="r num"><b>${r[f] == null ? '–' : fNum(r[f])}</b></td>${f === 'verzonden' ? `<td class="r num">${fUsdUnit(r.prijs_usd)}</td><td class="r">${r.zekerheid != null ? `<span class="conf ${r.zekerheid >= 90 ? 'hi' : r.zekerheid >= 75 ? 'mid' : 'lo'}">${r.zekerheid}%</span>` : ''}</td>` : ''}</tr>`).join('')}
    </tbody></table>${f === 'verzonden' ? `<dl class="kv small" style="margin-top:10px"><dt>AWB</dt><dd>${h(p.awb || '–')}</dd><dt>Vlucht</dt><dd>${h(p.vlucht || '–')}</dd><dt>Fytosanitair</dt><dd>${h(p.fyto || '–')}</dd></dl>` : ''}` : '';
  dlg.classList.add('dlg-wide');
  dlg.innerHTML = `<form method="dialog"><header><h2>${h(doc.titel || DOC[doc.soort])} · ${h(p.nummer)}</h2></header>
    <div class="body docview"><div class="orig">${doc.bestand_id ? `${paperHtml(doc.bestand_id, doc.titel || DOC[doc.soort], doc.mime)}<a class="lnk small" href="/api/bestanden/${doc.bestand_id}" target="_blank" rel="noopener">Open het origineel apart</a>` : `<pre class="mailtxt" style="max-height:none">${h(doc.tekst || '')}</pre>`}</div>
      <div>${read || '<p class="muted">Dit papier hoort bij de zending; er zijn geen aantallen uit gelezen.</p>'}<p class="small faint" style="margin-top:10px">${doc.gelezen_door === 'ai' ? 'Gelezen door de desk.' : doc.gelezen_door === 'regels' ? 'Gelezen met vaste regels.' : 'Door Jan ingevoerd.'} Ontvangen ${h(dayTime(doc.ontvangen))}.</p></div></div>
    <footer><button class="btn btn-leaf" value="cancel" type="submit">Sluiten</button></footer></form>`;
  dlg.addEventListener('close', () => dlg.classList.remove('dlg-wide'), { once: true });
  dlg.showModal();
  drawPapers(dlg);
}

// a notice about the world, from Jan
export function noticeDialog(ctx, { partij = null, plekken = {} } = {}) {
  const codes = Object.keys(plekken).filter(c => c !== 'NTD');
  dialog({
    title: 'Melding over de route', ok: 'Opslaan',
    body: `<div class="form">${field('titel', 'Wat is er', '', { wide: true, required: true, hint: 'Bijvoorbeeld: staking grondpersoneel Schiphol zondag.' })}
      ${field('ernst', 'Hoe erg', 'let_op', { opts: [['let_op', 'Let op (oranje)'], ['probleem', 'Echt een probleem (rood)']] })}
      ${field('soort', 'Soort', 'staking', { opts: [['staking', 'Staking'], ['weer', 'Weer'], ['storm', 'Storm'], ['vulkaan', 'Vulkaan of as'], ['douane', 'Douane of keuring'], ['capaciteit', 'Geen vrachtruimte'], ['vertraging', 'Vertraging'], ['overig', 'Iets anders']] })}
      ${field('plek', 'Waar', partij ? '' : 'AMS', { opts: [['', 'Elke route'], ...codes.map(c => [c, `${c} · ${plekken[c].stad}`]), ['CR', 'Heel Costa Rica'], ['GT', 'Heel Guatemala'], ['NL', 'De weg naar Nootdorp']] })}
      ${field('vertraging_uren', 'Hoeveel uur later (mag leeg)', '', { type: 'number' })}
      ${field('tot', 'Tot wanneer (mag leeg)', '', { type: 'datetime-local' })}
      ${field('tekst', 'Meer uitleg (mag leeg)', '', { type: 'textarea', wide: true })}</div>
      <p class="small faint">De melding telt mee voor elke zending die over die plek komt, tot de eindtijd of tot je hem op opgelost zet.</p>`,
    onOk: async v => { await api('/week/meldingen', { method: 'POST', body: { ...v, tot: iso(v.tot), partij_id: partij } }); toast('Melding opgeslagen.'); ctx.refresh(); },
  });
}

// ---------------------------------------------------------------- the buttons of a shipment (find gives the shipment by id)
export function partijActions(find) {
  return {
    doc: el => { const p = find(el.dataset.p); if (p) showDoc(p, p.docs.find(x => x.id === Number(el.dataset.d))); },
    'doc-add': (el, ctx) => {
      const p = find(el.dataset.p);
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
      const p = find(el.dataset.p), r = p.regels.find(x => x.id === Number(el.dataset.id));
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
      title: 'Batchnummer', ok: 'Opslaan',
      body: `${field('nummer', 'Batchnummer (C op het plantenpaspoort, kostendrager in Exact)', el.dataset.nr)}<p class="small faint" style="margin-top:8px">Jaar, week en regio: 264901 is 2026, week 49, regio 01. Leveranciers uit dezelfde regio in dezelfde week delen het nummer.</p>`,
      onOk: async v => { await api(`/week/partijen/${el.dataset.id}`, { method: 'PATCH', body: { nummer: v.nummer } }); toast('Batchnummer opgeslagen.'); ctx.refresh(); },
    }),
    route: (el, ctx) => {
      const p = find(el.dataset.p);
      dialog({
        title: `Route van ${p.nummer}`, ok: 'Opslaan',
        body: `${field('route', 'Luchthavens, van vertrek tot aankomst', (p.route || []).join(' '), { hint: 'Bijvoorbeeld SJO AMS, of GUA MIA AMS met een overstap in Miami. Daarna rijdt de vrachtwagen naar Nootdorp.' })}
          ${field('verwacht_op', 'In de loods verwacht (mag leeg: maandag 07:00)', localInput(p.verwacht_op), { type: 'datetime-local' })}`,
        onOk: async v => { await api(`/week/partijen/${p.id}`, { method: 'PATCH', body: { route: v.route, verwacht_op: iso(v.verwacht_op) } }); toast('Route opgeslagen.'); ctx.refresh(); },
      });
    },
    'exact-copy': async el => {
      const p = find(el.dataset.id);
      await copy(['Artikel\tOmschrijving\tAantal\tPrijs USD\tBedrag USD\tKostendrager', ...p.exactRegels.map(l => [l.artikel, l.omschrijving, l.stuks, String(l.prijs_usd).replace('.', ','), String(l.bedrag_usd).replace('.', ','), l.kostendrager].join('\t'))].join('\n'));
    },
    'exact-in': (el, ctx) => dialog({
      title: 'Staat in Exact', ok: 'Staat in Exact',
      body: `${field('nummer', 'Nummer van de inkooporder in Exact (mag leeg)', '')}`,
      onOk: async v => { await api(`/week/partijen/${el.dataset.id}/exact`, { method: 'POST', body: { nummer: v.nummer || null } }); toast('Inkooporder staat in Exact.'); ctx.refresh(); },
    }),
    'exact-zet-p': async (el, ctx) => {
      el.disabled = true;
      const r = await api('/week/exact/zet', { method: 'POST', body: { partijen: [Number(el.dataset.id)] } }).catch(x => { el.disabled = false; throw x; });
      toast(r.gezet ? 'De inkooporder staat in Exact. Controle kijkt of het klopt.' : r.fouten[0]?.fout || 'Niet gelukt.');
      ctx.refresh();
    },
    'exact-back': async (el, ctx) => { await api(`/week/partijen/${el.dataset.id}/exact`, { method: 'POST', body: { terug: true } }); toast('Teruggezet.'); ctx.refresh(); },
    'melding-weg': async (el, ctx) => { await api(`/week/meldingen/${el.dataset.id}/opgelost`, { method: 'POST', body: {} }); toast('Melding op opgelost gezet.'); ctx.refresh(); },
  };
}

export { regio, zn, stageChip };
