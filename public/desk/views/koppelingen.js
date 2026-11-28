// Koppelingen: Outlook for the invoices, what is printed on the packing slip (with the plant passport), Exact,
// the regions with their codes, the mailbox, AI reading and what is in the database.
import { api, h, icon, fNum, fTime, dayWord, dialog, toast, copy, field } from '../core.js';

const state = (on, ok, off) => `<span class="chip ${on ? 'ok' : 'wait'}">${on ? icon('check') : icon('clock')}${h(on ? ok : off)}</span>`;

function outlookPanel(o) {
  const conn = o.doel === 'microsoft' ? `Gekoppeld: ${o.account}` : o.doel === 'imap' ? 'Via de map Concepten' : 'Nog niet gekoppeld';
  return `<section class="panel outlook-panel" id="outlook"><header><h2>Outlook</h2>${state(!!o.doel, conn, conn)}</header><div class="body stack">
    <p class="small muted">Na jouw akkoord zet de desk per klant de pakbon met factuur als concept in Outlook, in de taal van de klant en met de pdf en het plantenpaspoort erbij. Jij leest ze na en drukt zelf op verzenden.</p>
    ${o.doel === 'microsoft' ? `<dl class="kv"><dt>Account</dt><dd>${h(o.microsoft.naam || '')} ${h(o.account || '')}</dd>${o.microsoft.sinds ? `<dt>Sinds</dt><dd>${dayWord(o.microsoft.sinds)}</dd>` : ''}${o.laatsteFout ? `<dt>Laatste fout</dt><dd style="color:var(--warn)">${h(o.laatsteFout)}</dd>` : ''}</dl>
        <p class="small muted">Wat je in Outlook verstuurt, ziet de desk binnen een paar minuten. Je kunt ook vanuit de desk op Versturen drukken.</p>
        <p><button class="btn btn-ghost" data-act="outlook-los">Ontkoppelen</button></p>`
      : o.microsoft.ingesteld ? `<p><a class="btn btn-leaf" href="/api/outlook/start">${icon('mail')}Koppel Outlook</a></p><p class="small muted">Je logt één keer in bij Microsoft met Jans account. De desk mag dan concepten maken en, als jij op Versturen drukt, versturen.</p>`
      : o.doel === 'imap' ? `<p class="small">Concepten komen in de map Concepten van <b>${h(o.account)}</b>. Outlook laat ze daar zien zodra de mailbox is bijgewerkt.</p>`
      : `<ol class="plainlist small"><li>Ga in Microsoft Entra (portal.azure.com) naar App-registraties en maak er een, voor accounts in elke organisatie en persoonlijke Microsoft-accounts.</li>
          <li>Zet als omleidings-URI (Web): <code style="overflow-wrap:anywhere">${h(o.terug)}</code> <button class="lnk small" data-act="copy" data-text="${h(o.terug)}">kopieer</button></li>
          <li>Maak een clientgeheim en zet in Railway onder Variables: <code>MS_CLIENT_ID</code> en <code>MS_CLIENT_SECRET</code>.</li>
          <li>Kom hier terug en klik op Koppel Outlook.</li></ol>
        <p class="small muted">Gebruikt Jan Outlook met een andere mailbox (geen Microsoft 365)? Dan zijn <code>IMAP_HOST</code>, <code>IMAP_USER</code> en <code>IMAP_PASS</code> genoeg: de concepten komen dan in de map Concepten. Tot die tijd opent elke mail met één klik als nieuw bericht in Outlook.</p>`}
  </div></section>`;
}

function slipPanel(b) {
  return `<section class="panel" id="pakbon"><header><h2>Op de pakbon en factuur</h2>${b.pp_b_voorbeeld || !b.iban ? '<span class="chip wait">nog aanvullen</span>' : `<span class="chip ok">${icon('check')}compleet</span>`}</header><div class="body stack">
    <p class="small muted">Dit staat op elke pakbon. B is Campo’s registratienummer voor het plantenpaspoort; C is het batchnummer (jaar, week, regio: 264901), A en D komen uit de zending.</p>
    <form data-form="bedrijf" class="form">
      ${field('pp_b', 'Plantenpaspoort B: registratienummer', b.pp_b_voorbeeld ? '' : b.pp_b, { hint: b.pp_b_voorbeeld ? `Nu staat er een voorbeeld: ${b.pp_b}` : 'Begint met NL-' })}
      ${field('iban', 'IBAN op de factuur', b.iban)}${field('naam', 'Bedrijfsnaam', b.naam)}${field('straat', 'Straat', b.straat)}${field('postcode', 'Postcode', b.postcode)}${field('plaats', 'Plaats', b.plaats)}
      ${field('telefoon', 'Telefoon', b.telefoon)}${field('email', 'E-mail', b.email)}${field('kvk', 'KvK', b.kvk)}${field('btw', 'Btw-nummer', b.btw)}${field('betaaltermijn', 'Standaard betaaltermijn (dagen)', b.betaaltermijn, { type: 'number' })}
      <p class="wide"><button class="btn btn-leaf" type="submit">Opslaan</button></p>
    </form></div></section>`;
}

function exactPanel() {
  return `<section class="panel" id="exact"><header><h2>Exact</h2><span class="chip wait">${icon('clock')}Klaarzetten, nog niet gekoppeld</span></header><div class="body stack">
    <p class="small muted">Elke inkooporder (uit de verzendpapieren) en elke verkoopfactuur (de pakbon) staat in de desk klaar zoals hij in Exact komt: artikel, aantal, prijs en het batchnummer (jaar, week, regio: 264901) als kostendrager. Met <b>Kopieer regels</b> neem je ze over; met <b>Staat in Exact</b> houdt de desk bij wat erin staat.</p>
    <p class="small muted">Rechtstreeks in Exact zetten kan met een koppeling via Exact Online (een app in het Exact App Center, net als bij Outlook). Die bouwen we als de werkwijze zo blijft.</p>
  </div></section>`;
}

const nr2 = n => (n == null ? '–' : String(n).padStart(2, '0'));
function regionPanel(r) {
  return `<section class="panel" id="regios"><header><h2>Regio's en batchnummers</h2></header><div class="body stack">
    <p class="small muted">Het batchnummer is jaar, week en regio: <b>264901</b> is 2026, week 49, regio 01. Leveranciers uit dezelfde regio die in dezelfde week binnenkomen delen één batchnummer. Het staat als C op het plantenpaspoort en als kostendrager in Exact. Een ander regionummer geldt voor nieuwe bestellingen.</p>
    <div class="tbwrap"><table class="tb"><thead><tr><th>Nr</th><th>Code</th><th>Regio</th><th>Herkomst (D)</th><th>Leveranciers</th><th></th></tr></thead><tbody>
      ${r.regios.map(g => `<tr><td><b class="num">${nr2(g.nummer)}</b></td><td>${h(g.code)}</td><td>${h(g.naam)}<small class="faint" style="display:block">${h(g.vervoer || '')}</small></td><td>${h(g.land)}</td><td class="small">${r.leveranciers.filter(l => l.regio === g.code).map(l => h(l.naam)).join(', ')}</td>
        <td class="r"><button type="button" class="lnk small" data-act="regio-edit" data-code="${h(g.code)}">Wijzigen</button></td></tr>`).join('')}
    </tbody></table></div>
    <p><button type="button" class="btn btn-sm btn-line" data-act="regio-new">${icon('plus')}Regio toevoegen</button></p>
  </div></section>`;
}
function regionForm(g = {}) {
  return `<div class="form">${field('nummer', 'Nummer in het batchnummer (01 tot 04)', g.nummer == null ? '' : String(g.nummer).padStart(2, '0'), { hint: 'Leeg: het eerstvolgende vrije nummer.' })}${field('code', 'Code (2 of 3 letters)', g.code || '')}${field('naam', 'Naam', g.naam || '')}${field('land', 'Land van herkomst (2 letters)', g.land || '')}${field('valuta', 'Valuta', g.valuta || 'USD')}${field('vervoer', 'Hoe het komt', g.vervoer || '', { wide: true })}</div>`;
}

let settings = null;
export async function render(params, query) {
  const [d, w] = await Promise.all([api('/koppelingen'), api('/week/instellingen')]);
  settings = w;
  const back = query && query.get('outlook');
  const backMsg = back === 'ok' ? '<div class="okbox">' + icon('check') + '<span>Outlook is gekoppeld. Nieuwe concepten komen voortaan bij Concepten.</span></div>'
    : back === 'fout' ? `<div class="warnbox">${icon('warn')}<span>Koppelen lukte niet: ${h(query.get('reden') || 'onbekende fout')}</span></div>`
    : back === 'niet-ingesteld' ? `<div class="warnbox wait">${icon('info')}<span>Eerst moeten MS_CLIENT_ID en MS_CLIENT_SECRET in Railway staan. Zie hieronder.</span></div>` : '';
  const db = d.database;
  return `<div class="page wk">
    <div class="ph"><div><h1>Koppelingen</h1><p>Waar de facturen naartoe gaan, wat er op de pakbon staat, en wat de desk leest. Bestellen, betalen en versturen blijft bij Jan.</p></div></div>
    ${backMsg}
    <div class="grid2e">
      ${outlookPanel(d.outlook)}
      ${slipPanel(w.bedrijf)}
      ${exactPanel()}
      ${regionPanel(w)}
      <section class="panel"><header><h2>Mail</h2>${state(d.mail.aan, 'Leest mee', 'Nog niet gekoppeld')}</header><div class="body stack">
        ${d.mail.aan ? `<dl class="kv"><dt>Mailbox</dt><dd>${h(d.mail.user)} via ${h(d.mail.host)}</dd><dt>Laatst gekeken</dt><dd>${d.mail.laatsteKeer ? `${dayWord(d.mail.laatsteKeer)} ${fTime(d.mail.laatsteKeer)}` : 'nog niet'}${d.mail.laatsteAantal ? `, ${d.mail.laatsteAantal} nieuw` : ''}</dd>${d.mail.laatsteFout ? `<dt>Fout</dt><dd style="color:var(--warn)">${h(d.mail.laatsteFout)}</dd>` : ''}</dl>
          <p class="small muted">Elke drie minuten kijkt de desk naar nieuwe mail met een pdf of foto. Mail wordt alleen gelezen: niets wordt verplaatst, verwijderd of als gelezen gemarkeerd.</p>
          <p><button class="btn btn-line" data-act="mail-nu">Nu ophalen</button></p>`
        : `<p>${h(d.mail.reden || '')}</p><p class="small muted">Met <code>IMAP_HOST</code>, <code>IMAP_USER</code> en <code>IMAP_PASS</code> in Railway kan de desk de mailbox lezen. Bevestigingen en verzendpapieren van de leveranciers voeg je nu per zending toe bij Inkoop: een pdf, een foto of de geplakte mail.</p>`}
      </div></section>
      <section class="panel"><header><h2>Lezen met AI</h2>${state(d.ai.aan, 'Grok leest mee', 'Alleen vaste regels')}</header><div class="body stack">
        <p class="small muted">Met AI leest de desk bevestigingen en verzendpapieren van de leveranciers, ook scans en foto’s. Zonder AI leest hij nette pdf’s met vaste regels. Twijfelt hij, dan zie je dat bij Inkoop en kies jij.</p>
        ${d.ai.aan ? `<dl class="kv"><dt>Model</dt><dd>${h(d.ai.model || 'wordt bepaald')}</dd>${d.ai.laatsteSucces ? `<dt>Laatst gelukt</dt><dd>${dayWord(d.ai.laatsteSucces)} ${fTime(d.ai.laatsteSucces)}</dd>` : ''}${d.ai.laatsteFout ? `<dt>Laatste fout</dt><dd style="color:var(--warn)">${h(d.ai.laatsteFout)}</dd>` : ''}</dl><p><button class="btn btn-line" data-act="ai-test">Test de verbinding</button></p>` : '<p class="small muted">Zet <code>XAI_API_KEY</code> in Railway om AI aan te zetten.</p>'}
      </div></section>
      <section class="panel"><header><h2>Database</h2><span class="chip ok">${icon('db')}${h(db.grootte || '')}</span></header><div class="body">
        <dl class="kv nums">${[['Klanten', db.klanten], ['Leveranciers', db.leveranciers], ['Producten', db.producten], ['Telefoonbestellingen', db.weekorders], ['Zendingen', db.partijen], ['Zendingregels', db.partijregels], ['Weken met een koers', db.koersen], ['Pakbonnen', db.pakbonnen], ['Pakbonregels', db.pakbonregels], ['Conceptmails', db.concepten]].map(([k, v]) => `<dt>${k}</dt><dd class="num">${fNum(v)}</dd>`).join('')}</dl>
        <p class="small muted" style="margin-top:10px">Een batchnummer hoort bij één regio en één week, aantallen zijn hele dozen, en een pakbon ligt vast zodra hij akkoord is: wat erna verandert, zie je meteen.</p>
      </div></section>
    </div>
    ${d.demo ? `<section class="panel" style="margin-top:16px;border-color:var(--wait)"><header><h2>Demo-data</h2><span class="chip wait">Aan</span></header><div class="body stack">
      <p>De leveranciers, zestig klanten, zendingen en ruim een jaar weken hier zijn verzonnen, om te laten zien hoe de desk werkt. Elke vrijdag schuift de demo een week op. Zodra Jan echt begint: haal de demo weg.</p>
      <p><button class="btn btn-bad" data-act="demo-weg">Demo-data verwijderen</button></p></div></section>` : ''}
  </div>`;
}

export const actions = {
  async 'mail-nu'(el, ctx) { el.disabled = true; const r = await api('/koppelingen/mail-nu', { method: 'POST', body: {} }); toast(r.ok ? `${r.nieuw} nieuw.` : r.reden || 'Mislukt.'); ctx.refresh(); },
  async 'ai-test'(el, ctx) { el.disabled = true; const r = await api('/koppelingen/ai-test', { method: 'POST', body: {} }); toast(r.ok ? `Verbinding goed: ${r.model}.` : `Niet gelukt: ${r.reden}`); ctx.refresh(); },
  copy(el) { copy(el.dataset.text); },
  async 'outlook-los'(el, ctx) { await api('/outlook/los', { method: 'POST', body: {} }); toast('Outlook ontkoppeld.'); ctx.refresh(); },

  'demo-weg'(el, ctx) {
    dialog({ title: 'Demo-data verwijderen', ok: 'Verwijderen', danger: true, body: '<p>Alle verzonnen kwekers, klanten, facturen, zendingen en berichten gaan weg. De plantencatalogus en alles wat je zelf hebt toegevoegd blijven staan. Dit kun je niet terugdraaien.</p><label class="f">Typ VERWIJDER om te bevestigen<input type="text" name="bevestig" autocomplete="off"></label>',
      onOk: async v => { await api('/demo/verwijderen', { method: 'POST', body: { bevestig: v.bevestig } }); toast('Demo-data verwijderd.'); ctx.refresh(); } });
  },
  'regio-new'(el, ctx) {
    dialog({ title: 'Regio toevoegen', ok: 'Opslaan', body: regionForm(),
      onOk: async v => { await api('/week/regios', { method: 'POST', body: v }); toast('Regio opgeslagen.'); ctx.refresh(); } });
  },
  'regio-edit'(el, ctx) {
    const g = (settings?.regios || []).find(x => x.code === el.dataset.code);
    if (!g) return;
    dialog({ title: `Regio ${g.naam}`, ok: 'Opslaan', body: regionForm(g),
      onOk: async v => { await api('/week/regios', { method: 'POST', body: v }); toast('Regio opgeslagen.'); ctx.refresh(); } });
  },
};

export function mount(ctx) {
  const f = document.querySelector('[data-form="bedrijf"]');
  if (f) f.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    try { await api('/week/instellingen', { method: 'PATCH', body: v }); toast('Opgeslagen. Nieuwe pdf’s krijgen deze gegevens.'); ctx.refresh(); }
    catch (x) { toast(x.message); }
  });
}

// the checkbox for notifications: inputs do not go through the click handler
export async function onChange(e) {
  const el = e.target;
  if (!el.matches('[data-act="meldingen"]')) return;
  try { await api('/instellingen/meldingen', { method: 'PATCH', body: { mail: el.checked } }); toast(el.checked ? 'Meldingen staan aan.' : 'Meldingen staan uit.'); }
  catch (x) { el.checked = !el.checked; toast(x.message); }
}
