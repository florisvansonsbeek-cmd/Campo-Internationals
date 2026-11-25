// Koppelingen: where messages come from, who reads them, and what is in the database.
import { api, h, icon, fNum, fTime, dayWord, dialog, toast, copy } from '../core.js';

const state = (on, ok, off) => `<span class="chip ${on ? 'ok' : 'wait'}">${on ? icon('check') : icon('clock')}${h(on ? ok : off)}</span>`;

function outlookPanel(o) {
  const conn = o.doel === 'microsoft' ? `Gekoppeld: ${o.account}` : o.doel === 'imap' ? 'Via de map Concepten' : 'Nog niet gekoppeld';
  return `<section class="panel outlook-panel" id="outlook"><header><h2>Outlook</h2>${state(!!o.doel, conn, conn)}</header><div class="body stack">
    <p class="small muted">De desk zet de bestelling voor de kweker en de offertes voor de klanten als concept in Outlook, met de pdf erbij. Jij leest ze na en drukt zelf op verzenden.</p>
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
    <label class="check"><input type="checkbox" data-act="meldingen"${o.meldingen && o.meldingen.mail ? ' checked' : ''}${o.doel ? '' : ' disabled'}> Stuur Jan een mail als een bestelling klaarstaat</label>
  </div></section>`;
}

export async function render(params, query) {
  const d = await api('/koppelingen');
  const back = query && query.get('outlook');
  const backMsg = back === 'ok' ? '<div class="okbox">' + icon('check') + '<span>Outlook is gekoppeld. Nieuwe concepten komen voortaan bij Concepten.</span></div>'
    : back === 'fout' ? `<div class="warnbox">${icon('warn')}<span>Koppelen lukte niet: ${h(query.get('reden') || 'onbekende fout')}</span></div>`
    : back === 'niet-ingesteld' ? `<div class="warnbox wait">${icon('info')}<span>Eerst moeten MS_CLIENT_ID en MS_CLIENT_SECRET in Railway staan. Zie hieronder.</span></div>` : '';
  const db = d.database;
  return `<div class="page">
    <div class="ph"><div><h1>Koppelingen</h1><p>De desk leest mee in Jans mail en WhatsApp, herkent aanbod, facturen en tijden, en zet concepten klaar in Outlook. Bestellen, betalen en versturen blijft bij Jan.</p></div></div>
    ${backMsg}
    <div class="grid2e">
      ${outlookPanel(d.outlook)}
      <section class="panel"><header><h2>Mail</h2>${state(d.mail.aan, 'Leest mee', 'Nog niet gekoppeld')}</header><div class="body stack">
        ${d.mail.aan ? `<dl class="kv"><dt>Mailbox</dt><dd>${h(d.mail.user)} via ${h(d.mail.host)}</dd><dt>Laatst gekeken</dt><dd>${d.mail.laatsteKeer ? `${dayWord(d.mail.laatsteKeer)} ${fTime(d.mail.laatsteKeer)}` : 'nog niet'}${d.mail.laatsteAantal ? `, ${d.mail.laatsteAantal} nieuw` : ''}</dd>${d.mail.laatsteFout ? `<dt>Fout</dt><dd style="color:var(--warn)">${h(d.mail.laatsteFout)}</dd>` : ''}</dl>
          <p class="small muted">Elke drie minuten kijkt de desk naar nieuwe mail met een pdf of foto, of met woorden als factuur of pakbon. Mail wordt alleen gelezen: niets wordt verplaatst, verwijderd of als gelezen gemarkeerd.</p>
          <p><button class="btn btn-line" data-act="mail-nu">Nu ophalen</button></p>`
        : `<p>${h(d.mail.reden || '')}</p><p class="small muted">Zet in Railway onder Variables: <code>IMAP_HOST</code> (bijvoorbeeld imap.gmail.com), <code>IMAP_USER</code> en <code>IMAP_PASS</code> (bij Gmail een app-wachtwoord). Tot die tijd: stuur facturen door of sleep ze in de Inbox.</p>`}
      </div></section>
      <section class="panel"><header><h2>WhatsApp</h2>${state(d.whatsapp.aan, 'Ontvangt berichten', 'Nog niet gekoppeld')}</header><div class="body stack">
        <p class="small muted">Kwekers sturen facturen, foto’s en tijden naar het WhatsApp Business-nummer van Campo. Via de WhatsApp Cloud API van Meta komen die hier binnen en leest de desk ze, net als mail.</p>
        <dl class="kv"><dt>Webhook</dt><dd><code style="overflow-wrap:anywhere">${h(d.whatsapp.webhook)}</code> <button class="lnk small" data-act="copy" data-text="${h(d.whatsapp.webhook)}">kopieer</button></dd>
        ${d.whatsapp.laatsteBericht ? `<dt>Laatste bericht</dt><dd>${dayWord(d.whatsapp.laatsteBericht)} ${fTime(d.whatsapp.laatsteBericht)}</dd>` : ''}${d.whatsapp.laatsteFout ? `<dt>Fout</dt><dd style="color:var(--warn)">${h(d.whatsapp.laatsteFout)}</dd>` : ''}</dl>
        ${d.whatsapp.aan ? '' : '<p class="small muted">Nodig in Railway: <code>WHATSAPP_TOKEN</code>, <code>WHATSAPP_VERIFY_TOKEN</code> en liefst <code>WHATSAPP_APP_SECRET</code>. Tot die tijd: plak een WhatsApp-bericht in de Inbox, of stuur het door naar de factuurmail.</p>'}
      </div></section>
      <section class="panel"><header><h2>Lezen met AI</h2>${state(d.ai.aan, 'Grok leest mee', 'Alleen vaste regels')}</header><div class="body stack">
        <p class="small muted">Met AI leest de desk ook scans, foto’s en rommelige WhatsApp-berichten. Zonder AI leest hij nette pdf’s en berichten met vaste regels. Twijfelt hij, dan kijk jij na; wat je kiest onthoudt hij per kweker.</p>
        ${d.ai.aan ? `<dl class="kv"><dt>Model</dt><dd>${h(d.ai.model || 'wordt bepaald')}</dd>${d.ai.laatsteSucces ? `<dt>Laatst gelukt</dt><dd>${dayWord(d.ai.laatsteSucces)} ${fTime(d.ai.laatsteSucces)}</dd>` : ''}${d.ai.laatsteFout ? `<dt>Laatste fout</dt><dd style="color:var(--warn)">${h(d.ai.laatsteFout)}</dd>` : ''}</dl><p><button class="btn btn-line" data-act="ai-test">Test de verbinding</button></p>` : '<p class="small muted">Zet <code>XAI_API_KEY</code> in Railway om AI aan te zetten.</p>'}
      </div></section>
      <section class="panel"><header><h2>Database</h2><span class="chip ok">${icon('db')}${h(db.grootte || '')}</span></header><div class="body">
        <dl class="kv nums">${[['Kwekers', db.kwekers], ['Klanten', db.klanten], ['Planten', db.planten], ['Geleerde plantnamen', db.plantnamen], ['Klantorders', db.orders], ['Facturen', db.facturen], ['Factuurregels', db.regels], ['Toewijzingen', db.toewijzingen], ['Zendingen', db.zendingen], ['Aanbiedingen', db.aanbiedingen], ['Aanbodregels', db.aanbodregels], ['Conceptmails', db.concepten], ['Gebeurtenissen onderweg', db.gebeurtenissen], ['Berichten binnen', db.berichten_in]].map(([k, v]) => `<dt>${k}</dt><dd class="num">${fNum(v)}</dd>`).join('')}</dl>
        <p class="small muted" style="margin-top:10px">Elke regel wordt gecontroleerd: aantallen en prijzen positief, nooit meer verdeeld dan er op een factuurregel staat, geen dubbele facturen per kweker, en alles wat bij elkaar hoort aan elkaar gekoppeld.</p>
      </div></section>
    </div>
    ${d.demo ? `<section class="panel" style="margin-top:16px;border-color:var(--wait)"><header><h2>Demo-data</h2><span class="chip wait">Aan</span></header><div class="body stack">
      <p>De kwekers, klanten, facturen en vijftien maanden geschiedenis hier zijn verzonnen, om te laten zien hoe de desk werkt. Ze schuiven elke dag mee, zodat Vandaag altijd gevuld is. Zodra Jan echt begint: haal de demo weg. De plantencatalogus blijft staan.</p>
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
};

// the checkbox for notifications: inputs do not go through the click handler
export async function onChange(e) {
  const el = e.target;
  if (!el.matches('[data-act="meldingen"]')) return;
  try { await api('/instellingen/meldingen', { method: 'PATCH', body: { mail: el.checked } }); toast(el.checked ? 'Meldingen staan aan.' : 'Meldingen staan uit.'); }
  catch (x) { el.checked = !el.checked; toast(x.message); }
}
