// Koppelingen: where messages come from, who reads them, and what is in the database.
import { api, h, icon, fNum, fTime, dayWord, dialog, toast, copy } from '../core.js';

const state = (on, ok, off) => `<span class="chip ${on ? 'ok' : 'wait'}">${on ? icon('check') : icon('clock')}${h(on ? ok : off)}</span>`;

export async function render() {
  const d = await api('/koppelingen');
  const db = d.database;
  return `<div class="page">
    <div class="ph"><div><h1>Koppelingen</h1><p>De desk leest mee in Jans mail en WhatsApp, herkent facturen en tijden, en zet alles klaar. Bestellen, goedkeuren, betalen en berichten sturen blijft bij Jan.</p></div></div>
    <div class="grid2e">
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
        <dl class="kv nums">${[['Kwekers', db.kwekers], ['Klanten', db.klanten], ['Planten', db.planten], ['Geleerde plantnamen', db.plantnamen], ['Klantorders', db.orders], ['Facturen', db.facturen], ['Factuurregels', db.regels], ['Toewijzingen', db.toewijzingen], ['Zendingen', db.zendingen], ['Gebeurtenissen onderweg', db.gebeurtenissen], ['Berichten binnen', db.berichten_in]].map(([k, v]) => `<dt>${k}</dt><dd class="num">${fNum(v)}</dd>`).join('')}</dl>
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
  'demo-weg'(el, ctx) {
    dialog({ title: 'Demo-data verwijderen', ok: 'Verwijderen', danger: true, body: '<p>Alle verzonnen kwekers, klanten, facturen, zendingen en berichten gaan weg. De plantencatalogus en alles wat je zelf hebt toegevoegd blijven staan. Dit kun je niet terugdraaien.</p><label class="f">Typ VERWIJDER om te bevestigen<input type="text" name="bevestig" autocomplete="off"></label>',
      onOk: async v => { await api('/demo/verwijderen', { method: 'POST', body: { bevestig: v.bevestig } }); toast('Demo-data verwijderd.'); ctx.refresh(); } });
  },
};
