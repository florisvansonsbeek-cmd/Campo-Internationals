// Pakbon en factuur: one per customer per week. It is the invoice as well and carries the plant passport.
// After Jan's approval the desk puts each one as a draft in Outlook (with the pdf) and lists the lines for Exact.
import { api, h, icon, fNum, toast, copy, dialog, field } from '../core.js';
import { weekNav, dLong, dShort, dayTime, fKoers, fEur2, fEurUnit, fUsdUnit, passportHtml } from '../wk.js';

let last = null, one = null;
const VAT = { nl: 'Btw 9%', verlegd: 'Btw verlegd', export: 'Export' };

function statusOf(s) {
  if (s.status === 'wacht') return `<span class="chip wait" title="${h(s.reden || '')}">${icon('clock')}Wacht</span>`;
  if (s.status === 'klaar') return '<span class="chip info">Klaar voor akkoord</span>';
  const c = s.concept, out = [`<span class="chip ok">${icon('check')}${h(s.pakbon.nummer)}</span>`];
  if (s.gewijzigd) out.push('<span class="chip bad">Verdeling gewijzigd</span>');
  out.push(s.pakbon.exact === 'in_exact' ? '<span class="chip ok">Exact</span>' : '<span class="chip dash">Exact</span>');
  out.push(c && c.status === 'verstuurd' ? `<span class="chip ok">${icon('mail')}Verstuurd</span>` : c && c.status === 'in_outlook' ? `<span class="chip brass">${icon('mail')}In Outlook</span>` : `<span class="chip dash">${icon('mail')}Concept</span>`);
  return out.join('');
}

export async function render(params, query) {
  const m = query.get('maandag');
  const d = await api(`/week/pakbonnen${m ? `?maandag=${m}` : ''}`);
  last = d;
  const t = d.totalen;
  const ready = d.slips.filter(s => s.status === 'klaar'), done = d.slips.filter(s => s.status === 'akkoord');
  // one reason for all waiting slips is said once, at the top
  const waiting = d.slips.filter(s => s.status === 'wacht'), sameReason = waiting.length > 0 && new Set(waiting.map(s => s.reden)).size === 1;
  const notOutlook = done.filter(s => !s.concept || s.concept.status === 'concept'), notExact = done.filter(s => s.pakbon.exact === 'open');
  const warn = [];
  if (!d.koers) warn.push(`<div class="warnbox wait">${icon('clock')}<span>De koers van week ${d.week} staat er nog niet in, dus de bedragen ontbreken nog. <a href="#/maandag?maandag=${d.maandag}&deel=koers">Koers invullen</a></span></div>`);
  else if (!d.geteld) warn.push(`<div class="warnbox wait">${icon('clock')}<span>De dozen zijn nog niet geteld. <a href="#/maandag?maandag=${d.maandag}&deel=tellen">Tellen</a></span></div>`);
  if (d.bedrijf.pp_b_voorbeeld || !d.bedrijf.iban) warn.push(`<div class="warnbox wait">${icon('info')}<span>${d.bedrijf.pp_b_voorbeeld ? `Op het plantenpaspoort staat nog een voorbeeldnummer bij B (${h(d.bedrijf.pp_b)}). ` : ''}${!d.bedrijf.iban ? 'Er staat nog geen IBAN op de factuur. ' : ''}<a href="#/koppelingen?deel=pakbon">Invullen bij Koppelingen</a></span></div>`);
  return `<div class="page wk">
    <div class="ph"><div><p class="kick">Week ${d.week} · ${d.koers ? `koers 1 € = $ ${fKoers(d.koers)}` : 'koers nog niet vast'}</p><h1>Pakbon en factuur</h1>
      <p>Eén pakbon per klant. Hij is ook de factuur, met het plantenpaspoort erop. Na jouw akkoord staat elke factuur als concept in Outlook, met de pdf erbij.</p></div>
      <div class="acts">${weekNav('pakbonnen', d.maandag)}</div></div>
    ${warn.join('')}
    <div class="kpis">
      <div class="kpi"><span>Klanten</span><b>${fNum(t.klanten)}</b><em>${fNum(t.dozen)} dozen</em></div>
      <div class="kpi"><span>Omzet excl. btw</span><b>${d.koers ? fEur2(t.omzet).replace(/,\d\d$/, '') : '–'}</b><em>${d.koers ? 'met de koers van deze week' : 'wacht op de koers'}</em></div>
      <div class="kpi"><span>Akkoord</span><b>${fNum(t.akkoord)}<small> / ${fNum(t.klanten)}</small></b><em>${t.klaar ? `${t.klaar} klaar voor akkoord` : t.akkoord ? 'alles akkoord' : ''}</em></div>
      <div class="kpi"><span>Exact · verstuurd</span><b>${fNum(t.exact)}<small> · ${fNum(t.verstuurd)}</small></b><em>${t.outlook ? `${t.outlook} in Outlook` : ''}</em></div>
    </div>
    <div class="bulk">
      <button type="button" class="btn btn-leaf" data-act="approve-all"${ready.length ? '' : ' disabled'}>${icon('check')}Alles akkoord${ready.length ? ` (${ready.length})` : ''}</button>
      <button type="button" class="btn btn-line" data-act="outlook-all"${notOutlook.length ? '' : ' disabled'}>${icon('mail')}In Outlook zetten${notOutlook.length ? ` (${notOutlook.length})` : ''}</button>
      <button type="button" class="btn btn-line" data-act="exact-all"${notExact.length ? '' : ' disabled'}>${icon('db')}Staan in Exact${notExact.length ? ` (${notExact.length})` : ''}</button>
      <a class="btn btn-line${done.length ? '' : ' is-off'}" href="${done.length ? `/api/week/weken/${d.maandag}/pakbonnen.pdf` : '#'}" target="_blank" rel="noopener"${done.length ? '' : ' aria-disabled="true" tabindex="-1"'}>${icon('file')}Alles printen</a>
      <span class="small faint">${d.outlook.doel ? `Outlook: ${h(d.outlook.account || '')}` : 'Outlook is nog niet gekoppeld: elke mail opent met één klik.'}</span>
    </div>
    <section class="panel"><div class="tbwrap"><table class="tb slips"><thead><tr><th>Klant</th><th class="r">Dozen</th><th class="r">Bedrag</th><th>Btw</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.slips.map(s => `<tr class="click" data-href="#/pakbon/${s.klant_id}?maandag=${d.maandag}">
        <td><a href="#/pakbon/${s.klant_id}?maandag=${d.maandag}"><b>${h(s.klant)}</b></a><small class="faint" style="display:block">${h(s.plaats || '')} · ${h(s.land)} · ${s.regels.length} ${s.regels.length === 1 ? 'regel' : 'regels'}</small></td>
        <td class="r num">${fNum(s.dozen)}</td><td class="r num">${d.koers ? fEur2(s.totaal) : '–'}</td><td><span class="small">${VAT[s.btw.soort]}</span></td>
        <td><span class="st-chips">${statusOf(s)}</span>${s.status === 'wacht' && s.reden && !sameReason ? `<small class="faint" style="display:block">${h(s.reden)}</small>` : ''}</td>
        <td class="r">${s.status === 'klaar' ? `<button type="button" class="btn btn-sm btn-line" data-act="approve-one" data-k="${s.klant_id}">Akkoord</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty">Nog niets verdeeld voor deze week.</td></tr>'}
    </tbody></table></div></section>
  </div>`;
}

// ---------------------------------------------------------------- one packing slip, as the customer sees it
function paper(x) {
  const co = x.bedrijf;
  return `<article class="paper" aria-label="Pakbon en factuur">
    <div class="paper-band"><b>CAMPO</b> International<span>PAKBON EN FACTUUR ${h(x.nummer || '')}</span></div>
    <div class="paper-top">
      <div><b>${h(co.naam)}</b><br>${h(co.straat)}<br>${h(co.postcode)} ${h(co.plaats)}<br><small>${h(co.telefoon)} · ${h(co.email)}</small></div>
      <dl><dt>Factuurnummer</dt><dd><b>${h(x.nummer || 'volgt bij akkoord')}</b></dd><dt>Datum</dt><dd>${h(dLong(x.datum))}</dd><dt>Levering</dt><dd>${h(dShort(x.maandag))} (week ${x.week})</dd>${x.klant.exact_code ? `<dt>Klantnummer</dt><dd>${h(x.klant.exact_code)}</dd>` : ''}</dl>
    </div>
    <div class="paper-to"><small>Aan</small><b>${h(x.klant.naam)}</b>${[x.klant.contact, x.klant.adres, [x.klant.postcode, x.klant.plaats].filter(Boolean).join(' '), x.klant.landnaam || (x.klant.land !== 'NL' ? x.klant.land : '')].filter(Boolean).map(l => `<br>${h(l)}`).join('')}${x.klant.btw_nummer ? `<br><small>Btw-nummer: ${h(x.klant.btw_nummer)}</small>` : ''}</div>
    <div class="tbwrap"><table class="paper-t"><thead><tr><th class="r">Dozen</th><th class="r">Stuks</th><th>Omschrijving</th><th>Partij</th><th class="r">Prijs per stuk</th><th class="r">Bedrag</th></tr></thead><tbody>
      ${x.regels.map(r => `<tr><td class="r">${fNum(r.dozen)}</td><td class="r">${fNum(r.stuks)}</td><td>${h(r.omschrijving)}<small>${h(r.sub || '')}</small></td><td><b>${h(r.partij)}</b></td>
        <td class="r" title="${fUsdUnit(r.prijs_usd)} / ${fKoers(x.koers)}">${r.prijs_eur == null ? '–' : fEurUnit(r.prijs_eur)}</td><td class="r">${r.bedrag == null ? '–' : fEur2(r.bedrag)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="paper-sum"><span>Totaal dozen ${fNum(x.dozen)} · stuks ${fNum(x.stuks)}</span><dl><dt>Totaal excl. btw</dt><dd><b>${x.koers ? fEur2(x.totaal) : '–'}</b></dd>
      ${x.btw_pct > 0 ? `<dt>Btw ${fNum(x.btw_pct)}%</dt><dd>${x.koers ? fEur2(x.btw_bedrag) : '–'}</dd><dt>Totaal incl. btw</dt><dd><b>${x.koers ? fEur2(x.totaal_incl) : '–'}</b></dd>` : `<dt></dt><dd class="small">${x.btw_soort === 'export' ? 'Uitvoer buiten de EU: 0% btw' : 'Btw verlegd: intracommunautaire levering'}</dd>`}</dl></div>
    <p class="paper-note">${x.koers ? `Prijzen in dollars, omgerekend met de koers van week ${x.week}: 1 euro = ${fKoers(x.koers)} dollar.` : 'De koers van deze week staat er nog niet in.'} Betalen binnen ${x.betaaltermijn || 14} dagen${co.iban ? ` op ${h(co.iban)}` : ''}.</p>
    <div class="paper-pp"><b>Plantenpaspoort</b><div>${x.paspoorten.map(p => passportHtml(p, x.ppLocal ?? 'Plantenpaspoort')).join('')}</div></div>
  </article>`;
}

export async function renderOne(params, query) {
  const m = query.get('maandag');
  const x = await api(`/week/pakbonnen/klant/${params.klant}${m ? `?maandag=${m}` : ''}`);
  one = x;
  const s = x.pakbon, c = x.concept, ok = x.status === 'akkoord';
  const back = `#/pakbonnen?maandag=${x.maandag}`;
  return `<div class="page wk">
    <a class="back" href="${back}">${icon('back')}Pakbonnen week ${x.week}</a>
    <div class="ph"><div><p class="kick">${ok ? `Pakbon ${h(s.nummer)} · akkoord` : x.status === 'wacht' ? 'Wacht nog' : 'Klaar voor akkoord'}</p><h1>${h(x.klant.naam)}</h1>
      <p>${ok ? 'Zo staat hij vast. Wijzigt de verdeling nog, heropen hem dan.' : 'Zo komt hij eruit te zien. De regels komen uit de verdeling van maandag.'}${x.reden ? ` ${h(x.reden)}` : ''}</p></div></div>
    ${x.gewijzigd ? `<div class="warnbox">${icon('warn')}<span>De verdeling van deze klant is gewijzigd na het akkoord. Heropen de pakbon en geef opnieuw akkoord.</span></div>` : ''}
    <div class="grid2 slip">
      ${paper(x)}
      <aside class="stack">
        <section class="panel"><header><h2>Wat nu</h2></header><div class="body stack" style="gap:10px">
          ${ok ? `<p class="st-chips">${statusOf({ status: 'akkoord', pakbon: s, concept: c, gewijzigd: x.gewijzigd })}</p>
              <p><a class="btn btn-line" href="/api/week/pakbonnen/${s.id}/pdf" target="_blank" rel="noopener">${icon('file')}Pdf openen of printen</a></p>
              <h3 class="mini-h">Mail aan ${h(x.email || 'onbekend')}</h3>
              ${!x.email ? '<p class="small" style="color:var(--warn)">Er staat geen mailadres bij deze klant. Vul het in bij de klant.</p>' : ''}
              <p class="acts-row">${c && c.status !== 'verstuurd' ? `${x.outlook && x.outlook.doel ? `<button type="button" class="btn btn-sm btn-leaf" data-act="outlook" data-id="${s.id}"${x.email ? '' : ' disabled'}>${icon('mail')}${c.status === 'in_outlook' ? 'Opnieuw in Outlook' : 'In Outlook zetten'}</button>` : ''}
                <a class="btn btn-sm ${x.outlook && x.outlook.doel ? 'btn-line' : 'btn-leaf'}" href="/api/week/pakbonnen/${s.id}/eml">${icon('out')}Open in Outlook</a>
                <button type="button" class="btn btn-sm btn-ghost" data-act="paper" data-id="${s.id}">Met de goederen meegegeven</button>` : c && c.status === 'verstuurd' ? `<span class="chip ok">${icon('check')}Verstuurd ${h(dayTime(c.verstuurd_op))}</span>` : ''}</p>
              ${c && c.status !== 'verstuurd' && !(x.outlook && x.outlook.doel) ? '<p class="small faint">Open in Outlook geeft een nieuwe mail met de pdf erbij; jij drukt op verzenden. Met Outlook gekoppeld (Koppelingen) staan ze allemaal tegelijk bij Concepten.</p>' : ''}
              <h3 class="mini-h">Exact</h3>
              <p class="acts-row">${s.exact === 'in_exact' ? `<span class="chip ok">${icon('check')}Staat in Exact</span><button type="button" class="lnk small" data-act="exact-back" data-id="${s.id}">Terugzetten</button>` : `<button type="button" class="btn btn-sm btn-leaf" data-act="exact-in" data-id="${s.id}">${icon('check')}Staat in Exact</button>`}
                <button type="button" class="btn btn-sm btn-line" data-act="exact-copy">${icon('copy')}Kopieer regels</button></p>
              <p class="small faint">Elke regel met de partij als kostendrager. Zo telt Exact per regio wat erin en eruit gaat.</p>
              <p><button type="button" class="lnk small" data-act="reopen" data-id="${s.id}">Pakbon heropenen</button></p>`
            : `<button type="button" class="btn btn-leaf" data-act="approve-one" data-k="${x.klant_id}"${x.status === 'klaar' ? '' : ' disabled'}>${icon('check')}Akkoord</button>
               <p class="small faint">Bij akkoord krijgt hij een factuurnummer en staat de mail met de pdf klaar${x.email ? ` voor ${h(x.email)}` : ''}.</p>
               <p><a class="lnk small" href="#/maandag?maandag=${x.maandag}&deel=verdelen">Verdeling aanpassen</a></p>`}
        </div></section>
      </aside>
    </div>
  </div>`;
}

export const actions = {
  'approve-all': (el, ctx) => {
    const over = last.totalen.over;
    dialog({
      title: `${last.slips.filter(s => s.status === 'klaar').length} pakbonnen akkoord`, ok: 'Akkoord',
      body: `<p>Elke pakbon krijgt een factuurnummer. ${last.outlook.doel ? 'De mails met de pdf komen in Outlook bij Concepten.' : 'De mails staan klaar; open ze met "Open in Outlook".'} Versturen doe je zelf.</p>
        ${over ? `<p class="warnbox wait" style="margin:12px 0 0">${icon('info')}<span>Er hebben nog ${over} dozen geen klant. Krijgt een klant hier nog iets van, verdeel dat dan eerst; een pakbon die akkoord is moet je anders heropenen.</span></p>` : ''}`,
      onOk: async () => {
        const r = await api('/week/pakbonnen/akkoord', { method: 'POST', body: { maandag: last.maandag } });
        toast(`${r.akkoord} pakbonnen akkoord: ${r.nummers[0]} tot ${r.nummers[r.nummers.length - 1]}.${r.outlook ? ` ${r.inOutlook} in Outlook.` : ''}`);
        ctx.refresh();
      },
    });
  },
  'approve-one': async (el, ctx) => {
    el.disabled = true;
    const m = document.querySelector('.slips') ? last.maandag : one.maandag;
    const r = await api('/week/pakbonnen/akkoord', { method: 'POST', body: { maandag: m, klant_ids: [Number(el.dataset.k)] } });
    toast(`Pakbon ${r.nummers[0]} akkoord.${r.outlook ? ' Staat in Outlook.' : ''}`);
    ctx.refresh();
  },
  'outlook-all': async (el, ctx) => {
    el.disabled = true;
    const r = await api('/week/pakbonnen/outlook', { method: 'POST', body: { maandag: last.maandag } }).catch(x => { toast(x.message); el.disabled = false; throw x; });
    toast(`${r.gezet} in Outlook gezet.${r.fouten.length ? ` ${r.fouten[0]}` : ''}`);
    ctx.refresh();
  },
  'exact-all': (el, ctx) => dialog({
    title: 'Staan in Exact', ok: 'Ja, ze staan erin',
    body: `<p>Zet je alle pakbonnen van week ${last.week} die akkoord zijn als verkoopfactuur in Exact? De regels staan per klant klaar, met de partij als kostendrager.</p>`,
    onOk: async () => { const r = await api('/week/pakbonnen/exact', { method: 'POST', body: { maandag: last.maandag } }); toast(`${r.aantal} verkoopfacturen in Exact.`); ctx.refresh(); },
  }),
  outlook: async (el, ctx) => {
    el.disabled = true;
    const r = await api('/week/pakbonnen/outlook', { method: 'POST', body: { ids: [Number(el.dataset.id)] } }).catch(x => { toast(x.message); el.disabled = false; throw x; });
    toast(r.gezet ? 'Staat in Outlook bij Concepten.' : r.fouten[0] || 'Niet gelukt.');
    ctx.refresh();
  },
  paper: async (el, ctx) => { await api(`/week/pakbonnen/${el.dataset.id}/papier`, { method: 'POST', body: {} }); toast('Genoteerd: met de goederen meegegeven.'); ctx.refresh(); },
  'exact-in': (el, ctx) => dialog({
    title: 'Staat in Exact', ok: 'Staat in Exact', body: field('nummer', 'Factuurnummer in Exact (mag leeg)', ''),
    onOk: async v => { await api('/week/pakbonnen/exact', { method: 'POST', body: { ids: [Number(el.dataset.id)], nummer: v.nummer || null } }); toast('Staat in Exact.'); ctx.refresh(); },
  }),
  'exact-back': async (el, ctx) => { await api('/week/pakbonnen/exact', { method: 'POST', body: { ids: [Number(el.dataset.id)], terug: true } }); toast('Teruggezet.'); ctx.refresh(); },
  'exact-copy': async () => {
    const x = one;
    await copy([`Klant\t${x.klant.naam}\t${x.klant.exact_code || ''}`, `Factuur\t${x.nummer}\t${x.datum}`, 'Aantal\tOmschrijving\tPrijs EUR\tBedrag EUR\tKostendrager',
      ...x.regels.map(r => [r.stuks, r.omschrijving, String(r.prijs_eur).replace('.', ','), String(r.bedrag).replace('.', ','), r.partij].join('\t'))].join('\n'));
  },
  reopen: (el, ctx) => dialog({
    title: 'Pakbon heropenen', ok: 'Heropenen', danger: true,
    body: '<p>Het factuurnummer blijft. Het concept in Outlook gaat weg; na een nieuw akkoord komt er een nieuw concept.</p>',
    onOk: async () => { await api(`/week/pakbonnen/${el.dataset.id}/heropen`, { method: 'POST', body: {} }); toast('Heropend.'); ctx.refresh(); },
  }),
};
