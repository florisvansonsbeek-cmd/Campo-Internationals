// One packing slip that is also the invoice, with the plant passport on it: the paper as the customer sees it, what Jan
// does next (approve, mail it, Exact) and the buttons for that. The Pakbonnen tab and the Inkoop page (from the loods to
// the customer) show the very same slip.
import { api, h, icon, fNum, toast, copy, dialog, field } from './core.js';
import { dLong, dShort, dayTime, fKoers, fEur2, fEurUnit, fUsdUnit, passportHtml } from './wk.js';

export const VAT = { nl: 'Btw 9%', verlegd: 'Btw verlegd', export: 'Export' };

// the state of a slip in chips: waiting, ready, or approved with Exact and the mail
export function slipStatus(s) {
  if (s.status === 'wacht') return `<span class="chip wait" title="${h(s.reden || '')}">${icon('clock')}Wacht</span>`;
  if (s.status === 'klaar') return '<span class="chip info">Klaar voor akkoord</span>';
  const c = s.concept, out = [`<span class="chip ok">${icon('check')}${h(s.pakbon.nummer)}</span>`];
  if (s.gewijzigd) out.push('<span class="chip bad">Verdeling gewijzigd</span>');
  out.push(s.pakbon.exact === 'in_exact' ? '<span class="chip ok">Exact</span>' : '<span class="chip dash">Exact</span>');
  out.push(c && c.status === 'verstuurd' ? `<span class="chip ok">${icon('mail')}Verstuurd</span>` : c && c.status === 'in_outlook' ? `<span class="chip brass">${icon('mail')}In Outlook</span>` : `<span class="chip dash">${icon('mail')}Concept</span>`);
  return out.join('');
}

// the slip as the customer gets it: company, customer, lines with the batch, totals and the plant passport
export function slipPaper(x) {
  const co = x.bedrijf;
  return `<article class="paper" aria-label="Pakbon en factuur">
    <div class="paper-band"><b>CAMPO</b> International<span>PAKBON EN FACTUUR ${h(x.nummer || '')}</span></div>
    <div class="paper-top">
      <div><b>${h(co.naam)}</b><br>${h(co.straat)}<br>${h(co.postcode)} ${h(co.plaats)}<br><small>${h(co.telefoon)} · ${h(co.email)}</small></div>
      <dl><dt>Factuurnummer</dt><dd><b>${h(x.nummer || 'volgt bij akkoord')}</b></dd><dt>Datum</dt><dd>${h(dLong(x.datum))}</dd><dt>Levering</dt><dd>${h(dShort(x.maandag))} (week ${x.week})</dd>${x.klant.exact_code ? `<dt>Klantnummer</dt><dd>${h(x.klant.exact_code)}</dd>` : ''}</dl>
    </div>
    <div class="paper-to"><small>Aan</small><b>${h(x.klant.naam)}</b>${[x.klant.contact, x.klant.adres, [x.klant.postcode, x.klant.plaats].filter(Boolean).join(' '), x.klant.landnaam || (x.klant.land !== 'NL' ? x.klant.land : '')].filter(Boolean).map(l => `<br>${h(l)}`).join('')}${x.klant.btw_nummer ? `<br><small>Btw-nummer: ${h(x.klant.btw_nummer)}</small>` : ''}</div>
    <div class="tbwrap"><table class="paper-t"><thead><tr><th class="r">Dozen</th><th class="r">Stuks</th><th>Omschrijving</th><th>Batch</th><th class="r">Prijs per stuk</th><th class="r">Bedrag</th></tr></thead><tbody>
      ${x.regels.map(r => `<tr><td class="r">${fNum(r.dozen)}</td><td class="r">${fNum(r.stuks)}</td><td>${h(r.omschrijving)}<small>${h(r.sub || '')}</small></td><td><b>${h(r.partij)}</b></td>
        <td class="r" title="${fUsdUnit(r.prijs_usd)} / ${fKoers(x.koers)}">${r.prijs_eur == null ? '–' : fEurUnit(r.prijs_eur)}</td><td class="r">${r.bedrag == null ? '–' : fEur2(r.bedrag)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="paper-sum"><span>Totaal dozen ${fNum(x.dozen)} · stuks ${fNum(x.stuks)}</span><dl><dt>Totaal excl. btw</dt><dd><b>${x.koers ? fEur2(x.totaal) : '–'}</b></dd>
      ${x.btw_pct > 0 ? `<dt>Btw ${fNum(x.btw_pct)}%</dt><dd>${x.koers ? fEur2(x.btw_bedrag) : '–'}</dd><dt>Totaal incl. btw</dt><dd><b>${x.koers ? fEur2(x.totaal_incl) : '–'}</b></dd>` : `<dt></dt><dd class="small">${x.btw_soort === 'export' ? 'Uitvoer buiten de EU: 0% btw' : 'Btw verlegd: intracommunautaire levering'}</dd>`}</dl></div>
    <p class="paper-note">${x.koers ? `Prijzen in dollars, omgerekend met de koers van week ${x.week}: 1 euro = ${fKoers(x.koers)} dollar.` : 'De koers van deze week staat er nog niet in.'} Betalen binnen ${x.betaaltermijn || 14} dagen${co.iban ? ` op ${h(co.iban)}` : ''}.</p>
    <div class="paper-pp"><b>Plantenpaspoort</b><div>${x.paspoorten.map(p => passportHtml(p, x.ppLocal ?? 'Plantenpaspoort')).join('')}</div></div>
  </article>`;
}

// what Jan does with it: approve; then the pdf, the mail, Exact; or reopen
export function slipNext(x) {
  const s = x.pakbon, c = x.concept, ok = x.status === 'akkoord', k = x.klant_id, m = x.maandag;
  if (!ok) {
    return `<button type="button" class="btn btn-leaf" data-act="slip-approve" data-k="${k}" data-m="${m}"${x.status === 'klaar' ? '' : ' disabled'}>${icon('check')}Akkoord</button>
      <p class="small faint">${x.status === 'wacht' && x.reden ? `${h(x.reden)} ` : ''}Bij akkoord krijgt hij een factuurnummer en staat de mail met de pdf klaar${x.email ? ` voor ${h(x.email)}` : ''}.</p>
      <p><a class="lnk small" href="#/maandag?maandag=${m}&deel=check">Verdeling aanpassen</a></p>`;
  }
  const outlook = x.outlook && x.outlook.doel;
  return `<p class="st-chips">${slipStatus({ status: 'akkoord', pakbon: s, concept: c, gewijzigd: x.gewijzigd })}</p>
    ${x.gewijzigd ? `<p class="small" style="color:var(--warn)">De verdeling is gewijzigd na het akkoord. Heropen de pakbon en geef opnieuw akkoord.</p>` : ''}
    <p><a class="btn btn-line" href="/api/week/pakbonnen/${s.id}/pdf" target="_blank" rel="noopener">${icon('file')}Pdf openen of printen</a></p>
    <h3 class="mini-h">Mail aan ${h(x.email || 'onbekend')}</h3>
    ${!x.email ? '<p class="small" style="color:var(--warn)">Er staat geen mailadres bij deze klant. Vul het in bij de klant.</p>' : ''}
    <p class="acts-row">${c && c.status !== 'verstuurd' ? `${outlook ? `<button type="button" class="btn btn-sm btn-leaf" data-act="slip-outlook" data-id="${s.id}"${x.email ? '' : ' disabled'}>${icon('mail')}${c.status === 'in_outlook' ? 'Opnieuw in Outlook' : 'In Outlook zetten'}</button>` : ''}
      <a class="btn btn-sm ${outlook ? 'btn-line' : 'btn-leaf'}" href="/api/week/pakbonnen/${s.id}/eml">${icon('out')}Open in Outlook</a>
      <button type="button" class="btn btn-sm btn-ghost" data-act="slip-paper" data-id="${s.id}">Met de goederen meegegeven</button>` : c && c.status === 'verstuurd' ? `<span class="chip ok">${icon('check')}Verstuurd ${h(dayTime(c.verstuurd_op))}</span>` : ''}</p>
    ${c && c.status !== 'verstuurd' && !outlook ? '<p class="small faint">Open in Outlook geeft een nieuwe mail met de pdf erbij; jij drukt op verzenden. Met Outlook gekoppeld (Koppelingen) staan ze allemaal tegelijk bij Concepten.</p>' : ''}
    <h3 class="mini-h">Exact</h3>
    <p class="acts-row">${s.exact === 'in_exact' ? `<span class="chip ok">${icon('check')}Staat in Exact</span><button type="button" class="lnk small" data-act="slip-exact-back" data-id="${s.id}">Terugzetten</button>` : `<button type="button" class="btn btn-sm btn-leaf" data-act="slip-exact-in" data-id="${s.id}">${icon('check')}Staat in Exact</button>`}
      <button type="button" class="btn btn-sm btn-line" data-act="slip-exact-copy" data-k="${k}">${icon('copy')}Kopieer regels</button></p>
    <p class="small faint">Elke regel met het batchnummer als kostendrager. Zo telt Exact per regio en per week wat erin en eruit gaat.</p>
    <p><button type="button" class="lnk small" data-act="slip-reopen" data-id="${s.id}">Pakbon heropenen</button></p>`;
}

// the buttons above; slipOf(klant_id) gives the slip that is on the screen (for copying its lines)
export function slipActions(slipOf) {
  return {
    'slip-approve': async (el, ctx) => {
      el.disabled = true;
      const r = await api('/week/pakbonnen/akkoord', { method: 'POST', body: { maandag: el.dataset.m, klant_ids: [Number(el.dataset.k)] } }).catch(e => { el.disabled = false; throw e; });
      toast(`Pakbon ${r.nummers[0]} akkoord.${r.outlook ? ' Staat in Outlook.' : ''}`);
      ctx.refresh();
    },
    'slip-outlook': async (el, ctx) => {
      el.disabled = true;
      const r = await api('/week/pakbonnen/outlook', { method: 'POST', body: { ids: [Number(el.dataset.id)] } }).catch(x => { toast(x.message); el.disabled = false; throw x; });
      toast(r.gezet ? 'Staat in Outlook bij Concepten.' : r.fouten[0] || 'Niet gelukt.');
      ctx.refresh();
    },
    'slip-paper': async (el, ctx) => { await api(`/week/pakbonnen/${el.dataset.id}/papier`, { method: 'POST', body: {} }); toast('Genoteerd: met de goederen meegegeven.'); ctx.refresh(); },
    'slip-exact-in': (el, ctx) => dialog({
      title: 'Staat in Exact', ok: 'Staat in Exact', body: field('nummer', 'Factuurnummer in Exact (mag leeg)', ''),
      onOk: async v => { await api('/week/pakbonnen/exact', { method: 'POST', body: { ids: [Number(el.dataset.id)], nummer: v.nummer || null } }); toast('Staat in Exact.'); ctx.refresh(); },
    }),
    'slip-exact-back': async (el, ctx) => { await api('/week/pakbonnen/exact', { method: 'POST', body: { ids: [Number(el.dataset.id)], terug: true } }); toast('Teruggezet.'); ctx.refresh(); },
    'slip-exact-copy': async el => {
      const x = slipOf(Number(el.dataset.k));
      if (!x) return;
      await copy([`Klant\t${x.klant.naam}\t${x.klant.exact_code || ''}`, `Factuur\t${x.nummer}\t${x.datum}`, 'Aantal\tOmschrijving\tPrijs EUR\tBedrag EUR\tKostendrager',
        ...x.regels.map(r => [r.stuks, r.omschrijving, String(r.prijs_eur).replace('.', ','), String(r.bedrag).replace('.', ','), r.partij].join('\t'))].join('\n'));
    },
    'slip-reopen': (el, ctx) => dialog({
      title: 'Pakbon heropenen', ok: 'Heropenen', danger: true,
      body: '<p>Het factuurnummer blijft. Het concept in Outlook gaat weg; na een nieuw akkoord komt er een nieuw concept.</p>',
      onOk: async () => { await api(`/week/pakbonnen/${el.dataset.id}/heropen`, { method: 'POST', body: {} }); toast('Heropend.'); ctx.refresh(); },
    }),
  };
}
