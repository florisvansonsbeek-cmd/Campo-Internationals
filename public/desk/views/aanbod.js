// One offer: the basket, who takes what, the risks, the calls, and the order to the grower.
import { api, h, icon, fTime, fNum, fEur, fPrice, fAvg, fPct, fLong, dayWord, plural, LANG, risicoChip, RISICO, kanaalNaam, toast, dialog, field, waLink, copy } from '../core.js';

let last = null;
// how far along: steps done, and the step Jan is on now
const STEP = { aanbod: [1, 2], bellen: [1, 2], verlopen: [1, 2], besteld: [3, 4], loods: [4, 0], afgewezen: [1, 0] };
const when = v => `${dayWord(v)} ${fTime(v)}`;
const size = r => [r.potmaat, r.hoogte].filter(Boolean).join(' ');

function steps(a) {
  const [done, now] = STEP[a.stap] || [1, 2];
  const names = ['Aanbod gelezen', 'Klanten bellen', 'Bestellen', 'In de loods'];
  return `<ol class="steps four">${names.map((s, i) => `<li class="${i + 1 <= done ? 'done' : i + 1 === now ? 'now' : ''}">${s}</li>`).join('')}</ol>`;
}

function banner(d) {
  const a = d.aanbod;
  if (a.stap === 'afgewezen') return `<div class="warnbox">${icon('x')}<span>Afgewezen${a.afgewezen_om ? `: ${h(a.afgewezen_om)}` : ''}.</span></div>`;
  if (a.stap === 'verlopen') return `<div class="warnbox">${icon('clock')}<span>Het aanbod gold tot ${when(a.geldig_tot)}. Bel ${h(a.kweker)} of het nog kan; daarna kun je gewoon verder.</span></div>`;
  if (a.stap === 'besteld' || a.stap === 'loods') {
    const z = d.zending;
    const truck = z ? (z.binnen ? `binnen sinds ${when(z.aankomst_werkelijk)}` : `komt ${when(z.eta)}`) : '';
    return `<div class="okbox">${icon('check')}<span>Besteld ${when(a.besteld_op)} met bestelnummer <b>${h(a.bestelnummer || '')}</b>${truck ? `; ${truck}` : ''}. De klantorders en wagens staan klaar.</span></div>`;
  }
  return '';
}

// ---------------------------------------------------------------- the people to call
function callCard(k, a) {
  const live = k.regels.filter(r => r.bron === 'aanbod');
  const c = k.concept;
  const locked = a.status === 'besteld' || a.status === 'afgewezen';
  const btn = (u, label, ic) => `<button class="seg${k.status === u ? ' on' : ''}" data-act="gesprek" data-klant="${k.klant_id}" data-uitkomst="${u}"${locked ? ' disabled' : ''} aria-pressed="${k.status === u}">${icon(ic)}${label}</button>`;
  const phone = k.telefoon || k.whatsapp;
  return `<article class="call is-${k.status}" id="klant-${k.klant_id}">
    <header>
      <div class="id"><h3><a href="#/klant/${k.klant_id}">${h(k.naam)}</a></h3>
        <p>${h(k.plaats)}, ${h(k.land)} · ${h(LANG[k.taal] || k.taal)}${k.contact ? ` · ${h(k.contact)}` : ''}</p></div>
      <div class="reach">${phone ? `<a class="btn btn-sm btn-line" href="tel:${h(phone.replace(/\s/g, ''))}">${icon('phone')}Bel</a>` : ''}${k.whatsapp ? `<a class="btn btn-sm btn-ghost" href="${waLink(k.whatsapp, '')}" target="_blank" rel="noopener">${icon('chat')}App</a>` : ''}</div>
    </header>
    <ul class="what">${live.map(r => `<li class="${r.status === 'nee' ? 'no' : ''}"><button class="lnk-plain" data-act="voorstel" data-id="${r.id}" ${locked ? 'disabled' : ''} title="Aantal of prijs aanpassen"><b class="num">${fNum(r.aantal)}</b> × ${h(r.plant)}</button><span class="num">à ${fPrice(r.verkoopprijs)}</span><span class="num">${fEur(r.aantal * r.verkoopprijs)}</span></li>`).join('')}
      <li class="tot"><span>Samen</span><span class="num">marge ${fEur(live.filter(r => r.status !== 'nee').reduce((s, r) => s + r.aantal * (r.verkoopprijs - r.inkoop), 0))}</span><b class="num">${fEur(live.filter(r => r.status !== 'nee').reduce((s, r) => s + r.aantal * r.verkoopprijs, 0))}</b></li></ul>
    ${live[0] && live[0].reden ? `<p class="why">${icon('info')}${h(live[0].reden)}.</p>` : ''}
    ${k.over_tijd > 750 ? `<p class="why bad">${icon('warn')}${fEur(k.over_tijd)} staat over tijd open.</p>` : ''}
    ${k.gesprek_notitie ? `<p class="why">${icon('edit')}${h(k.gesprek_notitie)}</p>` : ''}
    <div class="decide" role="group" aria-label="Uitkomst van het gesprek met ${h(k.naam)}">
      ${btn('akkoord', 'Akkoord', 'check')}${btn('nee', 'Nee', 'x')}${btn('terugbellen', 'Later bellen', 'clock')}
    </div>
    ${c ? `<div class="offerte">${icon('file')}<span>Offerte <b>${h(c.nummer)}</b> · ${conceptState(c)}</span>
      <span class="acts"><button class="btn btn-sm btn-ghost" data-act="concept" data-id="${c.id}">Bekijk</button>${c.status !== 'verstuurd' ? `<a class="btn btn-sm btn-ghost" href="/api/concepten/${c.id}/eml" download>Open in Outlook</a>` : ''}${k.status === 'akkoord' && c.status !== 'verstuurd' ? `<button class="btn btn-sm btn-leaf" data-act="concept" data-id="${c.id}">${icon('send')}Versturen</button>` : ''}</span></div>` : ''}
  </article>`;
}
function conceptState(c) {
  if (c.status === 'verstuurd') return `<span class="ok-t">${icon('check')}verstuurd ${c.verstuurd_op ? when(c.verstuurd_op) : ''}</span>`;
  if (c.status === 'in_outlook') return `<span class="ok-t">in Outlook bij Concepten</span>`;
  return c.aan ? 'klaar als concept' : 'klaar, nog geen mailadres';
}

function callPanel(d) {
  const a = d.aanbod;
  // a fixed order (biggest first, whatever the answer), so a card never jumps away under Jan's cursor
  const full = k => k.regels.filter(r => r.bron === 'aanbod').reduce((s, r) => s + r.aantal * r.verkoopprijs, 0);
  const calls = d.klanten.filter(k => k.bron !== 'order').sort((x, y) => full(y) - full(x) || x.naam.localeCompare(y.naam, 'nl'));
  const pre = d.klanten.filter(k => k.bron === 'order' || k.bron === 'beide');
  const t = d.totalen;
  return `<section class="panel" id="bellen" aria-labelledby="h-bellen">
    <header><h2 id="h-bellen">Klanten bellen</h2><span class="sub">${[t.akkoord ? `${t.akkoord} akkoord` : '', t.bellen ? `${t.bellen} nog bellen` : '', t.afgewezen ? `${t.afgewezen} nee` : ''].filter(Boolean).join(' · ') || 'Niemand te bellen'}</span></header>
    ${calls.length ? `<div class="calls">${calls.map(k => callCard(k, a)).join('')}</div>` : `<p class="empty">${pre.length ? 'Alles in deze mand is al besteld door klanten: niemand hoeft gebeld te worden.' : 'De desk vond geen klant die dit koopt. Voeg zelf een klant toe, of wijs het aanbod af.'}</p>`}
    ${pre.length ? `<div class="body pre"><h3>${icon('check')}Al besteld, geen telefoontje nodig</h3><ul>${pre.map(k => `<li><a href="#/klant/${k.klant_id}">${h(k.naam)}</a> <span class="faint">${h(k.plaats)}</span>: ${k.regels.filter(r => r.bron === 'order').map(r => `${fNum(r.aantal)} × ${h(r.plant)} <span class="faint">(${h(r.order || '')}, ${h(dayWord(r.gewenst_op))})</span>`).join(', ')}</li>`).join('')}</ul></div>` : ''}
    ${a.status !== 'besteld' && a.status !== 'afgewezen' ? `<div class="body foot"><button class="btn btn-sm btn-line" data-act="klant-erbij">${icon('plus')}Klant toevoegen</button><button class="btn btn-sm btn-ghost" data-act="opnieuw">Opnieuw laten voorstellen</button></div>` : ''}
  </section>`;
}

// ---------------------------------------------------------------- the basket
function priceCell(r) {
  const diff = r.verschil;
  const cls = diff == null ? '' : diff > 8 ? 'up' : diff < -5 ? 'down' : '';
  return `${fPrice(r.prijs)}${r.normaal ? `<span class="sub ${cls}">normaal ${fAvg(r.normaal)}${diff != null && Math.abs(diff) >= 1 ? ` (${diff > 0 ? '+' : ''}${fPct(diff)})` : ''}</span>` : '<span class="sub">nog geen eerdere prijs</span>'}`;
}
function basketPanel(d) {
  const locked = d.aanbod.status === 'besteld' || d.aanbod.status === 'afgewezen';
  return `<section class="panel" id="mand" aria-labelledby="h-mand">
    <header><h2 id="h-mand">De mand</h2><span class="sub">${plural(d.regels.length, 'soort', 'soorten')}, ${fNum(d.totalen.stuks)} stuks${d.aanbod.hele_partij ? ' · alleen als hele partij' : ''}</span></header>
    <div class="tbwrap"><table class="tb basket">
      <thead><tr><th>Plant</th><th class="r">Aangeboden</th><th class="r">Prijs</th><th>Naar</th></tr></thead>
      <tbody>${d.regels.map(r => `<tr class="${r.plant_id ? '' : 'doubt'}">
        <td>${r.plant_id ? `<a href="#/plant/${r.plant_id}"><b>${h(r.naam)}</b> ${h(size(r))}</a>` : `<b>Niet herkend</b>${locked ? '' : ` <button class="btn btn-sm btn-line" data-act="plant-kiezen" data-id="${r.id}">Plant kiezen</button>`}`}<span class="sub">${h(r.omschrijving)}</span></td>
        <td class="r num">${fNum(r.aantal)}${r.minimum ? `<span class="sub">min ${fNum(r.minimum)}</span>` : ''}</td>
        <td class="r num">${priceCell(r)}</td>
        <td>${r.klanten.length ? `<div class="allocs">${r.klanten.map(k => `<span class="chip ${k.bron === 'order' || k.status === 'akkoord' ? 'ok' : k.status === 'nee' ? 'dash' : 'info'}" title="${h(k.reden || '')}">${k.bron === 'order' || k.status === 'akkoord' ? icon('check') : k.status === 'nee' ? icon('x') : ''}${h(k.klant)} ${fNum(k.aantal)}</span>`).join('')}</div>` : '<span class="faint">Nog geen klant</span>'}
          ${r.rest_advies ? `<p class="rest">${h(r.rest_advies)}</p>` : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

// ---------------------------------------------------------------- the risks
function riskPanel(d) {
  const r = d.risico, x = RISICO[r.niveau];
  const list = r.factoren;
  const top = list.filter(f => f.toon !== 'ok').slice(0, 5), rest = list.filter(f => !top.includes(f));
  const item = f => `<li class="${f.toon}">${icon(f.toon === 'bad' ? 'warn' : f.toon === 'wait' ? 'clock' : f.toon === 'ok' ? 'check' : 'info')}<div><b>${h(f.titel)}</b><p>${h(f.tekst)}</p></div></li>`;
  return `<section class="panel risk-panel ${x.toon}" id="risico" aria-labelledby="h-risico">
    <header><h2 id="h-risico">Risico</h2>${risicoChip(r)}</header>
    <p class="body lede">${r.niveau === 'laag' ? 'Niets dat deze bestelling in de weg zit.' : r.niveau === 'middel' ? 'Een paar dingen om op te letten voor je bestelt.' : 'Kijk hier eerst naar voor je bestelt.'}</p>
    ${top.length ? `<ul class="factors">${top.map(item).join('')}</ul>` : ''}
    ${rest.length ? `<details class="more-f"><summary>${rest.some(f => f.toon === 'ok') ? 'Wat goed is' : 'Meer'} (${rest.length})</summary><ul class="factors">${rest.map(item).join('')}</ul></details>` : ''}
  </section>`;
}

// ---------------------------------------------------------------- the order to the grower
function orderPanel(d) {
  const a = d.aanbod;
  const c = d.concepten.find(x => x.soort === 'bestelling');
  const placed = a.status === 'besteld';
  const lines = d.regels.filter(r => r.plant_id);
  const sum = lines.reduce((s, r) => s + r.te_bestellen * r.prijs, 0);
  const z = d.zending;
  return `<section class="panel" id="bestellen" aria-labelledby="h-best">
    <header><h2 id="h-best">Bestelling bij ${h(a.kweker)}</h2>${placed ? `<span class="chip ok">${icon('check')}Besteld</span>` : ''}</header>
    <div class="body">
      ${placed ? '' : `<p class="small muted" style="margin-bottom:10px">Wat je bij de kweker bestelt: wat klanten nemen, afgerond op hele lagen${a.hele_partij ? ', of de hele partij' : ''}. Pas het aan als je extra voor de loods wilt.</p>`}
      <form id="bestelform" class="orderlines">
        ${lines.map(r => `<label><span>${h(r.naam)} ${h(size(r))}<small>${fNum(r.voorgesteld)} voor klanten${r.zonder_klant ? `, ${fNum(r.zonder_klant)} naar de loods` : ''}</small></span>
          ${placed ? `<b class="num">${fNum(r.te_bestellen)}</b>` : `<input type="number" inputmode="numeric" name="b-${r.id}" value="${r.te_bestellen}" min="0" max="${r.aantal}" step="${r.per_laag || 1}"${a.hele_partij ? ' readonly' : ''}>`}</label>`).join('')}
        <p class="sum"><span>Inkoop</span><b class="num">${fEur(sum)}</b></p>
      </form>
      ${c ? `<div class="offerte">${icon('file')}<span>Bestelmail <b>${h(c.nummer)}</b> · ${conceptState(c)}</span><span class="acts"><button class="btn btn-sm btn-ghost" data-act="concept" data-id="${c.id}">Bekijk</button>${c.status !== 'verstuurd' ? `<a class="btn btn-sm btn-ghost" href="/api/concepten/${c.id}/eml" download>Open in Outlook</a>` : ''}</span></div>` : ''}
      ${placed ? (z && !z.binnen ? `<p class="small" style="margin-top:12px">${icon('truck')} Komt ${when(z.eta)}. <button class="btn btn-sm btn-leaf" data-act="z-binnen" data-id="${z.id}">${icon('check')}Is binnen</button></p>` : z && z.binnen ? `<p class="small" style="margin-top:12px"><a class="lnk" href="#/loods">${icon('shed')} Staat in de loods</a></p>` : '')
        : a.status === 'afgewezen' ? '' : `<div class="place"><button class="btn btn-leaf" data-act="bestellen">${icon('send')}Bestelling plaatsen</button>
          <p class="faint small">${d.totalen.bellen ? `Nog ${plural(d.totalen.bellen, 'klant', 'klanten')} te bellen. Wie geen ja zei, gaat niet mee.` : 'Iedereen is gebeld.'}</p></div>`}
    </div>
  </section>`;
}

function messagePanel(a) {
  return `<section class="panel" aria-labelledby="h-msg"><header><h2 id="h-msg">Het bericht van de kweker</h2><span class="sub">${a.kanaal ? `${kanaalNaam(a.kanaal)}, ` : ''}${when(a.ontvangen)}</span></header>
    <div class="body">${a.onderwerp ? `<p><b>${h(a.onderwerp)}</b></p>` : ''}<pre class="msg">${h(a.bericht_tekst || 'Geen tekst bewaard.')}</pre>
      ${a.bestand_id ? `<p style="margin-top:8px"><a class="lnk" href="/api/bestanden/${a.bestand_id}" target="_blank" rel="noopener">${icon('file')} ${h(a.bestand_naam || 'Bijlage')}</a></p>` : ''}
      <p class="faint small" style="margin-top:8px">Gelezen ${a.gelezen_door === 'ai' ? 'met AI' : a.gelezen_door === 'regels' ? 'met vaste regels' : a.gelezen_door === 'demo' ? 'als voorbeeld' : 'door Jan'}${a.zekerheid != null ? `, ${a.zekerheid}% zeker` : ''}.</p></div></section>`;
}

function logPanel(d) {
  if (!d.logboek || !d.logboek.length) return '';
  return `<section class="panel" aria-labelledby="h-log"><header><h2 id="h-log">Wat er gebeurde</h2></header>
    <ul class="feed body">${d.logboek.slice(0, 10).map(l => `<li><time>${fTime(l.tijd)}</time><span>${h(l.actie)}${l.details && l.details.klant ? `: ${h(l.details.klant)}` : ''}<br><span class="src">${h(l.wie)}${dayWord(l.tijd) !== 'vandaag' ? `, ${h(dayWord(l.tijd))}` : ''}</span></span></li>`).join('')}</ul></section>`;
}

export async function render(params) {
  const d = await api(`/aanbod/${params.id}`);
  last = d;
  const a = d.aanbod, t = d.totalen;
  const left = a.geldig_tot ? (new Date(a.geldig_tot) - new Date()) / 6e4 : null;
  const sub = [`Aanbod via ${kanaalNaam(a.kanaal || 'upload')}, ${when(a.ontvangen)}`, a.levering ? `levert ${fLong(a.levering + 'T12:00:00')}` : null,
    a.geldig_tot && left > 0 && ['aanbod', 'bellen'].includes(a.stap) ? `geldig tot ${dayWord(a.geldig_tot) === 'vandaag' ? '' : `${dayWord(a.geldig_tot)} `}${fTime(a.geldig_tot)}${left <= 180 ? ` (nog ${left < 60 ? `${Math.round(left)} min` : `${Math.floor(left / 60)} u ${Math.round(left % 60)} min`})` : ''}` : null].filter(Boolean).join(' · ');
  return `<div class="page offer-page">
    <a class="back" href="#/workflow">${icon('back')}Workflow</a>
    <div class="ph"><div><h1>${h(a.kweker)}</h1><p>${h(sub)}</p></div>
      <div class="acts">${['aanbod', 'bellen', 'verlopen'].includes(a.stap) ? `<button class="btn btn-line" data-act="outlook">${icon('mail')}Concepten in Outlook</button><button class="btn btn-ghost" data-act="afwijzen">${icon('x')}Afwijzen</button>` : ''}</div></div>
    ${steps(a)}
    ${banner(d)}
    <div class="kpis">
      <div class="kpi"><span>Inkoop</span><b class="t">${fEur(t.inkoop)}</b><em>${fNum(t.te_bestellen)} stuks bij ${h(a.kweker)}</em></div>
      <div class="kpi"><span>Verkoop aan klanten</span><b class="t">${fEur(t.omzet)}</b><em>${plural(t.klanten - t.afgewezen, 'klant', 'klanten')}</em></div>
      <div class="kpi"><span>Marge</span><b class="t">${fEur(t.marge)}</b><em>${t.marge_pct != null ? `${fPct(t.marge_pct)} van de verkoop` : 'nog geen verkoop'}</em></div>
      <div class="kpi"><span>Heeft een klant</span><b class="t">${t.gekoppeld_pct}<small>%</small></b><em>${fNum(t.gekoppeld)} van ${fNum(t.stuks)} stuks</em></div>
    </div>
    <div class="grid2">
      <div class="stack">${callPanel(d)}${basketPanel(d)}</div>
      <aside class="stack">${riskPanel(d)}${orderPanel(d)}${messagePanel(a)}${logPanel(d)}</aside>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- Jan's actions
const id = () => last.aanbod.id;
async function viewConcept(cid, ctx) {
  const c = await api(`/concepten/${cid}`);
  const k = c.klant_id ? last.klanten.find(x => x.klant_id === c.klant_id) : null;
  const outlook = last.outlook;
  dialog({
    title: c.soort === 'bestelling' ? `Bestelmail aan ${last.aanbod.kweker}` : `Offerte aan ${k ? k.naam : 'klant'}`,
    ok: c.status === 'verstuurd' ? 'Sluiten' : outlook && outlook.soort === 'microsoft' && c.aan ? 'Nu versturen' : 'Markeer als verstuurd', cancel: 'Sluiten',
    body: `<div class="mailview">
      <p><span class="faint">Aan</span> ${c.aan ? h(c.aan) : '<b>nog geen mailadres</b>'}</p>
      <p><span class="faint">Onderwerp</span> ${h(c.onderwerp)}</p>
      <p><span class="faint">Bijlage</span> <a href="/api/concepten/${c.id}/pdf" target="_blank" rel="noopener">${icon('file')} ${h(c.bijlage_naam || 'pdf')}</a></p>
      ${c.soort === 'offerte' && k && k.status !== 'akkoord' && c.status !== 'verstuurd' ? `<p class="callfirst">${icon('phone')}<span>${h(k.naam)} zei nog geen ja. Bel eerst${k.contact ? ` met ${h(k.contact)}` : ''}; zegt de klant ja, dan verstuur je deze offerte.</span></p>` : ''}
      <pre class="msg">${h(c.tekst)}</pre>
      <p class="links"><a class="btn btn-sm btn-line" href="/api/concepten/${c.id}/eml" download>${icon('mail')}Open in Outlook</a>
        <button type="button" class="btn btn-sm btn-ghost" data-copy="1">${icon('copy')}Kopieer tekst</button>
        ${k && k.whatsapp ? `<a class="btn btn-sm btn-ghost" href="${waLink(k.whatsapp, c.tekst)}" target="_blank" rel="noopener">${icon('chat')}Via WhatsApp</a>` : ''}</p>
      <p class="faint small">${c.status === 'verstuurd' ? 'Deze mail is verstuurd.' : outlook ? `De desk zet concepten in ${outlook.soort === 'microsoft' ? 'Outlook' : 'de map Concepten'} van ${h(outlook.account || '')}. Versturen doe je zelf.` : '"Open in Outlook" opent de mail als nieuw bericht met de pdf erbij; je drukt zelf op verzenden.'}</p>
    </div>`,
    onOk: async () => {
      if (c.status === 'verstuurd') return;
      if (outlook && outlook.soort === 'microsoft' && c.aan) { await api(`/concepten/${c.id}/verstuur`, { method: 'POST', body: {} }); toast('Verstuurd.'); }
      else { await api(`/concepten/${c.id}`, { method: 'PATCH', body: { status: 'verstuurd' } }); toast('Gemarkeerd als verstuurd.'); }
      ctx.refresh();
    },
  });
  const btn = document.querySelector('#dlg [data-copy]');
  if (btn) btn.addEventListener('click', () => copy(c.tekst));
}

export const actions = {
  async gesprek(el, ctx) {
    el.disabled = true;
    const u = el.dataset.uitkomst, kid = Number(el.dataset.klant);
    const k = last.klanten.find(x => x.klant_id === kid);
    const next = k && k.status === u ? 'open' : u;
    await api(`/aanbod/${id()}/gesprek`, { method: 'POST', body: { klant_id: kid, uitkomst: next } });
    toast(next === 'akkoord' ? `${k.naam}: akkoord. Verstuur de offerte.` : next === 'nee' ? `${k.naam}: nee.` : next === 'terugbellen' ? `${k.naam}: later bellen.` : 'Teruggezet.');
    await ctx.refresh();
  },
  concept(el, ctx) { return viewConcept(el.dataset.id, ctx); },
  async outlook(el, ctx) {
    el.disabled = true;
    const r = await api(`/aanbod/${id()}/concepten`, { method: 'POST', body: {} });
    const o = r.outlook_gezet;
    if (!r.outlook) toast('Outlook is nog niet gekoppeld: gebruik "Open in Outlook" per mail, of koppel Outlook bij Koppelingen.');
    else if (o && o.ok) toast(o.gezet ? `${plural(o.gezet, 'concept', 'concepten')} in Outlook gezet.` : 'Alles stond al in Outlook.');
    else toast(`Niet gelukt: ${(o && o.fouten && o.fouten[0]) || 'onbekende fout'}`);
    await ctx.refresh();
  },
  bestellen(el, ctx) {
    const form = document.getElementById('bestelform');
    const regels = [...form.querySelectorAll('input[name^="b-"]')].map(i => ({ id: Number(i.name.slice(2)), bestellen: Number(i.value) || 0 }));
    const total = regels.reduce((s, r) => s + r.bestellen, 0);
    if (!total) { toast('Er staat niets om te bestellen.'); return; }
    const c = last.concepten.find(x => x.soort === 'bestelling');
    // what happens to every piece: sold (pre-ordered or a yes), or free in the loods
    const want = new Map(regels.map(r => [r.id, r.bestellen]));
    let sold = 0, free = 0, cost = 0;
    for (const r of last.regels.filter(x => x.plant_id)) {
      const n = want.has(r.id) ? want.get(r.id) : r.te_bestellen;
      sold += Math.min(n, r.akkoord); free += Math.max(0, n - r.akkoord); cost += n * r.prijs;
    }
    const names = list => list.map(k => h(k.naam)).join(', ').replace(/, ([^,]*)$/, ' en $1');
    const yes = last.klanten.filter(k => k.bron !== 'order' && k.status === 'akkoord');
    const pre = last.klanten.filter(k => k.bron === 'order' || k.bron === 'beide');
    const open = last.klanten.filter(k => k.bron !== 'order' && (k.status === 'open' || k.status === 'terugbellen'));
    const who = [yes.length ? `${names(yes)} ${yes.length === 1 ? 'krijgt' : 'krijgen'} een klantorder` : '', pre.length ? `${names(pre)} ${pre.length === 1 ? 'had' : 'hadden'} al besteld` : ''].filter(Boolean).join('; ');
    dialog({
      title: 'Bestelling plaatsen', ok: 'Bestelling plaatsen',
      body: `<p>Je bestelt <b>${fNum(total)} stuks</b> voor <b>${fEur(cost)}</b> bij ${h(last.aanbod.kweker)}${last.aanbod.levering ? `, levering ${h(fLong(last.aanbod.levering + 'T12:00:00'))}` : ''}.</p>
        <ul class="plainlist">
          ${sold ? `<li><b>${fNum(sold)} stuks zijn verkocht.</b> ${who ? `${who}. ` : ''}De leveringen komen in de planning.</li>` : ''}
          ${free ? `<li><b>${fNum(free)} stuks hebben nog geen koper</b> en komen vrij in de loods.${open.length ? ` Nog niet gebeld: ${names(open)}; ${open.length === 1 ? 'die krijgt' : 'zij krijgen'} niets als je nu bestelt.` : ''} Wil je geen voorraad, verlaag dan de aantallen.</li>` : ''}
          <li>De bestelmail${c ? ` (${h(c.nummer)})` : ''} krijgt deze aantallen. ${last.outlook ? 'Hij staat in Outlook bij Concepten; verstuur hem daar.' : 'Open hem in Outlook en druk op verzenden.'}</li></ul>`,
      onOk: async () => {
        const r = await api(`/aanbod/${id()}/bestellen`, { method: 'POST', body: { regels } });
        toast(`Besteld: ${r.geplaatst.bestelnummer}. ${r.geplaatst.klantorders ? `${plural(r.geplaatst.klantorders, 'klantorder', 'klantorders')} gemaakt.` : ''}`);
        await ctx.refresh();
      },
    });
  },
  afwijzen(el, ctx) {
    dialog({ title: 'Aanbod afwijzen', ok: 'Afwijzen', danger: true, body: field('reden', 'Waarom (helpt later bij de analyse van de kweker)', '', { opts: [['Te duur', 'Te duur'], ['Al genoeg op voorraad', 'Al genoeg op voorraad'], ['Klanten hadden geen interesse', 'Klanten hadden geen interesse'], ['Levering te laat', 'Levering te laat'], ['Kwaliteit twijfelachtig', 'Kwaliteit twijfelachtig'], ['Anders', 'Anders']] }),
      onOk: async v => { await api(`/aanbod/${id()}/afwijzen`, { method: 'POST', body: { reden: v.reden } }); toast('Afgewezen. De concepten zijn weggehaald.'); location.hash = '#/workflow'; } });
  },
  async opnieuw(el, ctx) { el.disabled = true; await api(`/aanbod/${id()}/opnieuw`, { method: 'POST', body: {} }); toast('Opnieuw voorgesteld met de nieuwste cijfers.'); await ctx.refresh(); },
  async 'klant-erbij'(el, ctx) {
    const klanten = await api('/klanten/namen');
    const lines = last.regels.filter(r => r.plant_id && r.aantal - r.voorgesteld > 0);
    if (!lines.length) { toast('Alles in de mand heeft al een klant.'); return; }
    dialog({ title: 'Klant toevoegen', ok: 'Toevoegen',
      body: `${field('regel_id', 'Plant', lines[0].id, { opts: lines.map(r => [r.id, `${r.naam} ${size(r)} (nog ${fNum(r.aantal - r.voorgesteld)} vrij)`]) })}
        ${field('klant_id', 'Klant', '', { opts: klanten.map(k => [k.id, `${k.naam}, ${k.plaats}`]) })}
        ${field('aantal', 'Aantal', lines[0].per_laag || '', { type: 'number' })}${field('verkoopprijs', 'Verkoopprijs per stuk (€)', lines[0].lijstprijs || '', { type: 'text' })}`,
      onOk: async v => { await api(`/aanbod/${id()}/klanten`, { method: 'POST', body: { regel_id: Number(v.regel_id), klant_id: Number(v.klant_id), aantal: Number(v.aantal), verkoopprijs: v.verkoopprijs } }); toast('Toegevoegd. De offerte staat klaar.'); await ctx.refresh(); } });
  },
  voorstel(el, ctx) {
    const r = last.klanten.flatMap(k => k.regels.map(x => ({ ...x, klant: k.naam }))).find(x => String(x.id) === el.dataset.id);
    if (!r) return;
    dialog({ title: `${r.klant}: ${r.plant}`, ok: 'Opslaan',
      body: `${field('aantal', 'Aantal', r.aantal, { type: 'number' })}${field('verkoopprijs', 'Verkoopprijs per stuk (€)', String(r.verkoopprijs).replace('.', ','))}
        <p class="faint small">Inkoop ${fPrice(r.inkoop)} per stuk. <button type="button" class="lnk-plain bad-t" data-remove="${r.id}">Deze regel weghalen</button></p>`,
      onOk: async v => { await api(`/aanbod-klanten/${r.id}`, { method: 'PATCH', body: { aantal: Number(v.aantal), verkoopprijs: v.verkoopprijs } }); toast('Aangepast; de offerte is bijgewerkt.'); await ctx.refresh(); } });
    const rm = document.querySelector('#dlg [data-remove]');
    if (rm) rm.addEventListener('click', async () => { await api(`/aanbod-klanten/${r.id}`, { method: 'DELETE' }).then(() => { document.getElementById('dlg').close(); toast('Weggehaald.'); ctx.refresh(); }).catch(e => toast(e.message)); });
  },
  async 'plant-kiezen'(el, ctx) {
    const plants = await api('/planten/namen');
    const r = last.regels.find(x => String(x.id) === el.dataset.id);
    dialog({ title: `Welke plant is "${r.omschrijving}"?`, ok: 'Opslaan',
      body: `${field('plant_id', 'Plant', '', { opts: plants.map(p => [p.id, p.naam]) })}<p class="faint small">De desk onthoudt dit voor ${h(last.aanbod.kweker)} en zoekt daarna klanten.</p>`,
      onOk: async v => { await api(`/aanbod-regels/${r.id}`, { method: 'PATCH', body: { plant_id: Number(v.plant_id) } }); toast('Onthouden.'); await ctx.refresh(); } });
  },
  async 'z-binnen'(el, ctx) { el.disabled = true; await api(`/zendingen/${el.dataset.id}/gebeurtenis`, { method: 'POST', body: { soort: 'aangekomen' } }); toast('Binnen: de planten staan in de loods, klaar voor de klanten.'); await ctx.refresh(); },
};
