// Pakbon en factuur: one per customer per week. It is the invoice as well and carries the plant passport.
// After Jan's approval the desk puts each one as a draft in Outlook (with the pdf) and lists the lines for Exact.
import { api, h, icon, fNum, toast, dialog } from '../core.js';
import { weekNav, fKoers, fEur2 } from '../wk.js';
import { VAT, slipStatus as statusOf, slipPaper as paper, slipNext, slipActions } from '../slip.js';

let last = null, one = null;

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
  else if (!d.geteld) warn.push(`<div class="warnbox wait">${icon('clock')}<span>Nog niet alle zendingen zijn afgevinkt als binnen. <a href="#/maandag?maandag=${d.maandag}&deel=binnen">Naar Maandag</a></span></div>`);
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
        <td class="r">${s.status === 'klaar' ? `<button type="button" class="btn btn-sm btn-line" data-act="slip-approve" data-k="${s.klant_id}" data-m="${d.maandag}">Akkoord</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty">Nog niets verdeeld voor deze week.</td></tr>'}
    </tbody></table></div></section>
  </div>`;
}

// ---------------------------------------------------------------- one packing slip, as the customer sees it
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
          ${slipNext(x)}
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
  'outlook-all': async (el, ctx) => {
    el.disabled = true;
    const r = await api('/week/pakbonnen/outlook', { method: 'POST', body: { maandag: last.maandag } }).catch(x => { toast(x.message); el.disabled = false; throw x; });
    toast(`${r.gezet} in Outlook gezet.${r.fouten.length ? ` ${r.fouten[0]}` : ''}`);
    ctx.refresh();
  },
  'exact-all': (el, ctx) => dialog({
    title: 'Staan in Exact', ok: 'Ja, ze staan erin',
    body: `<p>Zet je alle pakbonnen van week ${last.week} die akkoord zijn als verkoopfactuur in Exact? De regels staan per klant klaar, met het batchnummer als kostendrager.</p>`,
    onOk: async () => { const r = await api('/week/pakbonnen/exact', { method: 'POST', body: { maandag: last.maandag } }); toast(`${r.aantal} verkoopfacturen in Exact.`); ctx.refresh(); },
  }),
  ...slipActions(() => one),
};
