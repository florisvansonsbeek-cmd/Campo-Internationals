// Klanten: every customer analysed from what they actually ordered, received and paid.
import { api, h, icon, fTime, fNum, fEur, fPrice, fPct, fDate, fDay, dayWord, plural, COUNTRY, LANG, DOW, dialog, field, toast, waLink, kanaalNaam } from '../core.js';
import { spark, stacked, hbars, columns } from '../charts.js';

const SEG = { kern: ['Kern', 'ok'], groeiend: ['Groeiend', 'ok'], stabiel: ['Stabiel', ''], dalend: ['Dalend', 'wait'], slapend: ['Bestelt later dan normaal', 'bad'], nieuw: ['Nieuw', 'info'], gestopt: ['Gestopt', ''] };
const segChip = s => `<span class="chip seg-chip ${SEG[s]?.[1] || ''}">${h(SEG[s]?.[0] || s)}</span>`;
let sort = { key: 'omzet_12m', dir: -1 }, q = '', seg = 'alle';
const MONTH = m => new Date(m + '-15').toLocaleDateString('nl-NL', { month: 'short' }).replace('.', '');
const health = v => `<span class="bar ${v < 45 ? 'lo' : v < 65 ? 'mid' : ''}" title="Gezondheid ${v} van 100"><i><span style="width:${v}%"></span></i><b>${v}</b></span>`;

export async function renderList(params, query) {
  if (query && query.get('segment')) seg = query.get('segment');
  const list = await api('/klanten');
  const counts = { alle: list.filter(c => c.actief).length };
  for (const c of list) counts[c.segment] = (counts[c.segment] || 0) + 1;
  const shown = list.filter(c => (seg === 'alle' ? c.actief : c.segment === seg) && (!q || `${c.naam} ${c.plaats} ${c.contact || ''} ${c.top || ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => { const x = a[sort.key], y = b[sort.key]; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.dir; });
  const th = (k, l, r = false) => `<th class="sort${r ? ' r' : ''}" data-act="sort" data-k="${k}" ${sort.key === k ? `aria-sort="${sort.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${l}</th>`;
  const omzet = list.reduce((s, c) => s + c.omzet_12m, 0), marge = list.reduce((s, c) => s + c.marge_12m, 0);
  return `<div class="page">
    <div class="ph"><div><h1>Klanten</h1><p>${plural(counts.alle, 'actieve klant', 'actieve klanten')}, ${fEur(omzet)} omzet en ${fEur(marge)} marge in twaalf maanden. Ritme, groei, betaalgedrag en wat ze kopen, uit de leveringen zelf.</p></div>
      <div class="acts"><button class="btn btn-leaf" data-act="nieuw">${icon('plus')}Klant toevoegen</button></div></div>
    <div class="tools"><div class="seg" role="group" aria-label="Segment">${['alle', 'kern', 'groeiend', 'stabiel', 'dalend', 'slapend', 'nieuw', 'gestopt'].filter(s => s === 'alle' || counts[s]).map(s => `<button type="button" data-act="seg" data-s="${s}" aria-pressed="${seg === s}">${s === 'alle' ? 'Alle actieve' : h(SEG[s][0])}<small>${counts[s] || 0}</small></button>`).join('')}</div>
      <input type="search" placeholder="Zoek klant, plaats of plant" value="${h(q)}" data-input="q" aria-label="Zoek klanten"></div>
    <section class="panel"><div class="tbwrap"><table class="tb" style="min-width:1120px">
      <thead><tr><th style="padding-left:16px">Klant</th><th>Hoe het gaat</th>${th('gezondheid', 'Gezondheid')}${th('omzet_12m', 'Omzet 12 mnd', true)}${th('trend', 'Trend', true)}${th('marge_pct', 'Marge', true)}${th('ritme', 'Ritme', true)}${th('dagen_sinds', 'Laatste', true)}${th('betaal_dagen', 'Betaalt', true)}<th>12 maanden</th></tr></thead>
      <tbody>${shown.map(c => `<tr class="click" data-href="#/klant/${c.id}">
        <td style="padding-left:16px"><a href="#/klant/${c.id}">${h(c.naam)}</a><div class="as">${h(c.plaats)}, ${h(COUNTRY[c.land] || c.land)} · ${h(c.soort)}${c.top ? ` · vooral ${h(c.top)}` : ''}</div></td>
        <td>${segChip(c.segment)}</td>
        <td>${health(c.gezondheid)}</td>
        <td class="r num">${fEur(c.omzet_12m)}</td>
        <td class="r num">${c.trend == null ? '–' : `<span class="${c.trend >= 10 ? 'up' : c.trend <= -10 ? 'down' : ''}">${c.trend > 0 ? '+' : ''}${c.trend}%</span>`}</td>
        <td class="r num">${c.marge_pct == null ? '–' : fPct(c.marge_pct)}</td>
        <td class="r num">${c.ritme ? `elke ${c.ritme} d` : '–'}</td>
        <td class="r num">${c.dagen_sinds == null ? '–' : `${c.dagen_sinds} d`}${c.te_laat_dagen > 3 && c.actief ? ` <span class="late">+${c.te_laat_dagen}</span>` : ''}</td>
        <td class="r num">${c.betaal_dagen == null ? '–' : c.betaal_dagen > 3 ? `<span class="down">${Math.round(c.betaal_dagen)} d laat</span>` : 'op tijd'}${c.over_tijd ? `<div class="as" style="color:var(--warn)">${fEur(c.over_tijd)} over tijd</div>` : ''}</td>
        <td>${spark(c.maanden)}</td></tr>`).join('')}</tbody></table></div></section>
  </div>`;
}

export async function renderDetail(params) {
  const c = await api(`/klanten/${params.id}`);
  const months = c.maanden.map(m => ({ label: MONTH(m.maand), tipTitle: m.maand, inkoop: Math.max(0, Number(m.omzet) - Number(m.marge)), marge: Math.max(0, Number(m.marge)) }));
  const wd = [1, 2, 3, 4, 5, 6, 7].map(d => ({ label: DOW[d], value: Number((c.weekdagen.find(w => w.dag === d) || {}).n || 0), tip: `${(c.weekdagen.find(w => w.dag === d) || {}).n || 0} bestellingen` }));
  const open = c.facturen.filter(f => !f.betaald_op);
  return `<div class="page">
    <a class="back" href="#/klanten">${icon('back')}Klanten</a>
    <div class="prof"><div><h1>${h(c.naam)}</h1>
      <div class="sub"><span>${h(c.soort)} in ${h(c.plaats)}, ${h(COUNTRY[c.land] || c.land)}</span>${c.contact ? `<span>${h(c.contact)}</span>` : ''}${c.whatsapp ? `<a href="${waLink(c.whatsapp, '')}" target="_blank" rel="noopener">${icon('chat')}${h(c.whatsapp)}</a>` : ''}${c.email ? `<a href="mailto:${h(c.email)}">${h(c.email)}</a>` : ''}</div>
      <div class="sub"><span>${h(LANG[c.taal] || c.taal)}, liefst via ${h(kanaalNaam(c.kanaal))}</span>${c.levervenster ? `<span>${icon('truck')} ${h(c.levervenster)}</span>` : ''}<span>klant sinds ${c.klant_sinds || '–'}</span><span>betaaltermijn ${c.betaaltermijn} dagen</span>${segChip(c.segment)}${c.bron === 'demo' ? '<span class="chip">demo</span>' : ''}</div>
      ${c.wensen ? `<p style="margin-top:10px;max-width:70ch;font:italic 500 19px/1.4 var(--serif);color:var(--leaf)">“${h(c.wensen)}”</p>` : ''}</div>
      <div class="bigscore"><b class="num">${c.gezondheid}</b><span>gezondheid van 100</span><button class="btn btn-sm btn-line" data-act="bewerk" data-id="${c.id}">${icon('edit')}Gegevens</button></div></div>
    <dl class="facts">
      <div><dt>Omzet 12 mnd</dt><dd>${fEur(c.omzet_12m)}<small>${c.rang}e van ${c.klanten_totaal} klanten</small></dd></div>
      <div><dt>Marge</dt><dd>${c.marge_pct == null ? '–' : fPct(c.marge_pct)}<small>${fEur(c.marge_12m)} in 12 maanden</small></dd></div>
      <div><dt>Bestellingen</dt><dd>${c.orders_12m}<small>gemiddeld ${fEur(c.orderwaarde)} per bestelling</small></dd></div>
      <div><dt>Ritme</dt><dd>${c.ritme ? `elke ${c.ritme} d` : '–'}<small>${c.volgende ? `volgende rond ${fDay(c.volgende)}${c.te_laat_dagen > 0 ? `, ${c.te_laat_dagen} d over tijd` : ''}` : ''}</small></dd></div>
      <div><dt>Trend</dt><dd>${c.trend == null ? '–' : `${c.trend > 0 ? '+' : ''}${c.trend}%`}<small>${c.trend_basis === 'jaar' ? 'laatste 90 dagen t.o.v. vorig jaar' : 'laatste 90 dagen'}</small></dd></div>
      <div><dt>Betaalt</dt><dd>${c.betaal_dagen == null ? '–' : c.betaal_dagen > 1 ? `${Math.round(c.betaal_dagen)} d laat` : 'op tijd'}<small>${c.open_bedrag ? `${fEur(c.open_bedrag)} open${c.over_tijd ? `, ${fEur(c.over_tijd)} over tijd` : ''}` : 'niets open'}</small></dd></div>
      <div><dt>Door Campo op tijd</dt><dd>${c.op_tijd == null ? '–' : `${c.op_tijd}%`}<small>${plural(c.leveringen, 'levering', 'leveringen')}</small></dd></div>
    </dl>
    <div class="grid2">
      <div class="stack">
        <section class="panel"><header><h2>Wat de desk ziet</h2></header><div class="body"><ul class="insights">${c.inzichten.map(i => `<li class="${i.toon}">${icon(i.toon === 'ok' ? 'check' : i.toon === 'bad' ? 'warn' : i.toon === 'wait' ? 'clock' : 'info')}<span>${h(i.tekst)}</span></li>`).join('')}</ul></div></section>
        ${c.lopend.length ? `<section class="panel"><header><h2>Nu onderweg in de workflow</h2></header><div class="tbwrap"><table class="tb"><tbody>${c.lopend.map(l => `<tr class="click" data-href="#/factuur/${l.factuur_id}"><td style="padding-left:16px"><a href="#/factuur/${l.factuur_id}">${h(l.kweker)} ${h(l.nummer)}</a></td><td>${fNum(l.aantal)} × ${h(l.plant)} ${h(l.potmaat || '')}</td><td>${l.status === 'voorstel' ? '<span class="chip info">voorstel</span>' : '<span class="chip ok">bevestigd</span>'}${l.soort === 'aanbod' ? ' <span class="chip brass">aanbod</span>' : ''}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
        <section class="panel"><header><h2>Bestellingen</h2><span class="sub">Laatste ${c.orders.length}, met hoe de levering ging</span></header><div class="tbwrap"><table class="tb"><thead><tr><th style="padding-left:16px">Besteld</th><th>Order</th><th>Wat</th><th class="r">Waarde</th><th class="r">Afgeleverd</th></tr></thead><tbody>
          ${c.orders.map(o => `<tr><td style="padding-left:16px" class="nowrap">${fDay(o.besteld_op)}</td><td class="nowrap">${h(o.nummer)}<div class="as">${h(o.kanaal || '')}</div></td><td class="small">${(o.regels || []).map(r => `${fNum(r.aantal)} ${h(r.plant)}`).join(', ')}</td><td class="r num">${fEur(o.waarde)}</td>
            <td class="r num nowrap">${o.aankomst_werkelijk ? `${fDay(o.aankomst_werkelijk)} ${fTime(o.aankomst_werkelijk)}${o.laat > 30 ? ` <span class="late">+${o.laat}</span>` : ''}` : o.status === 'open' || o.status === 'toegewezen' ? `<span class="chip info">${o.status}</span>` : o.status === 'onderweg' ? '<span class="chip info">onderweg</span>' : '–'}</td></tr>`).join('')}
        </tbody></table></div></section>
      </div>
      <aside class="stack">
        <section class="panel"><header><h2>Omzet per maand</h2></header><div class="body">${stacked(months, [{ key: 'inkoop', name: 'Inkoop', color: '#9db7a2' }, { key: 'marge', name: 'Marge', color: 'var(--s1)' }], { fmt: v => fEur(v), title: 'Omzet = inkoop + marge' })}</div></section>
        <section class="panel"><header><h2>Wat ze kopen</h2></header><div class="body">${hbars(c.families.slice(0, 7).map(f => ({ label: f.naam, sub: f.maat, value: f.aandeel, tip: `${fEur(f.omzet)}, ${fNum(f.stuks)} stuks${f.kleuren.length ? `; ${f.kleuren.map(k => `${k.kleur} ${fNum(k.stuks)}`).join(', ')}` : ''}` })), { title: 'Aandeel in de omzet' })}</div></section>
        <section class="panel"><header><h2>Wanneer ze bestellen</h2></header><div class="body">${columns(wd, { title: 'Bestellingen per weekdag', height: 130 })}</div></section>
      </aside>
    </div>
    <div class="grid2e" style="margin-top:16px">
      <section class="panel"><header><h2>Planten</h2><span class="sub">Wat ze betalen tegenover inkoop</span></header><div class="tbwrap"><table class="tb"><thead><tr><th style="padding-left:16px">Plant</th><th class="r">Keer</th><th class="r">Stuks</th><th class="r">Betaalt</th><th class="r">Inkoop</th><th class="r">Laatst</th></tr></thead><tbody>
        ${c.planten.map(p => `<tr class="click" data-href="#/plant/${p.id}"><td style="padding-left:16px"><a href="#/plant/${p.id}">${h(p.naam)}</a> <span class="faint">${h([p.potmaat, p.hoogte].filter(Boolean).join(' '))}</span></td><td class="r num">${p.keer}</td><td class="r num">${fNum(p.stuks)}</td><td class="r num">${fPrice(p.prijs)}</td><td class="r num">${fPrice(p.inkoop)}</td><td class="r nowrap">${dayWord(p.laatst)}</td></tr>`).join('')}
      </tbody></table></div></section>
      <div class="stack">
        <section class="panel"><header><h2>Betalingen</h2><span class="sub">${plural(open.length, 'factuur open', 'facturen open')}</span></header><div class="tbwrap"><table class="tb"><thead><tr><th style="padding-left:16px">Factuur</th><th class="r">Bedrag</th><th class="r">Vervalt</th><th class="r">Betaald</th></tr></thead><tbody>
          ${c.facturen.slice(0, 12).map(f => `<tr><td style="padding-left:16px">${h(f.nummer)}<div class="as">${fDate(f.datum)}</div></td><td class="r num">${fEur(f.bedrag, 2)}</td><td class="r nowrap">${fDay(f.vervaldatum)}</td><td class="r nowrap">${f.betaald_op ? `${fDay(f.betaald_op)}${f.dagen > 2 ? ` <span class="late">${f.dagen} d laat</span>` : ''}` : new Date(f.vervaldatum) < new Date() ? '<span class="chip bad">over tijd</span>' : '<span class="chip">open</span>'}</td></tr>`).join('')}
        </tbody></table></div></section>
        <section class="panel"><header><h2>Van welke kwekers</h2></header><div class="tbwrap"><table class="tb"><tbody>${c.kwekers.map(k => `<tr class="click" data-href="#/kweker/${k.id}"><td style="padding-left:16px"><a href="#/kweker/${k.id}">${h(k.naam)}</a> <span class="faint">${h(k.plaats)}</span></td><td class="r num">${fNum(k.stuks)} stuks</td></tr>`).join('')}</tbody></table></div></section>
        ${c.berichten.length ? `<section class="panel"><header><h2>Laatste berichten</h2></header><ul class="feed body">${c.berichten.slice(0, 6).map(b => `<li style="grid-template-columns:86px minmax(0,1fr)"><time>${b.verstuurd_op ? fDay(b.verstuurd_op) : 'concept'}</time><span class="small">${h(b.tekst.split('\n').filter(Boolean).slice(1, 3).join(' '))}${b.factuur ? ` <span class="src">· ${h(b.factuur)}</span>` : ''}</span></li>`).join('')}</ul></section>` : ''}
      </div>
    </div>
  </div>`;
}

function form(c = {}) {
  return `<div class="form">${field('naam', 'Naam', c.naam, { wide: true })}
    ${field('soort', 'Soort', c.soort || 'bloemist', { opts: [['bloemist', 'Bloemist'], ['tuincentrum', 'Tuincentrum'], ['groothandel', 'Groothandel'], ['interieur', 'Interieur'], ['supermarkt', 'Supermarkt'], ['evenementen', 'Evenementen'], ['overig', 'Overig']] })}
    ${field('contact', 'Contactpersoon', c.contact)}${field('whatsapp', 'WhatsApp-nummer', c.whatsapp)}${field('email', 'E-mail', c.email, { type: 'email' })}
    ${field('adres', 'Adres', c.adres)}${field('postcode', 'Postcode', c.postcode)}${field('plaats', 'Plaats', c.plaats)}${field('land', 'Land (2 letters)', c.land || 'NL')}
    ${field('taal', 'Taal', c.taal || 'nl', { opts: Object.entries(LANG) })}${field('kanaal', 'Liefst via', c.kanaal || 'whatsapp', { opts: [['whatsapp', 'WhatsApp'], ['mail', 'Mail'], ['telefoon', 'Telefoon']] })}
    ${field('levervenster', 'Levervenster', c.levervenster)}${field('reistijd_min', 'Rijtijd vanaf Nootdorp (min)', c.reistijd_min, { type: 'number' })}
    ${field('betaaltermijn', 'Betaaltermijn (dagen)', c.betaaltermijn ?? 14, { type: 'number' })}${field('kredietlimiet', 'Kredietlimiet (€)', c.kredietlimiet, { type: 'number' })}
    ${field('wensen', 'Wensen', c.wensen, { type: 'textarea', wide: true })}</div>`;
}
const payload = v => { const o = { ...v }; for (const k of ['reistijd_min', 'betaaltermijn', 'kredietlimiet']) if (o[k] === '') o[k] = null; return o; };

export const listActions = {
  sort(el, ctx) { const k = el.dataset.k; sort = { key: k, dir: sort.key === k ? -sort.dir : -1 }; ctx.refresh(); },
  seg(el, ctx) { seg = el.dataset.s; if (location.hash.includes('?')) location.hash = '#/klanten'; else ctx.refresh(); },
  nieuw() { dialog({ title: 'Klant toevoegen', ok: 'Toevoegen', body: form(), onOk: async v => { const r = await api('/klanten', { method: 'POST', body: payload(v) }); toast('Klant toegevoegd.'); location.hash = `#/klant/${r.id}`; } }); },
};
export const detailActions = {
  async bewerk(el, ctx) {
    const c = await api(`/klanten/${el.dataset.id}`);
    dialog({ title: 'Gegevens van de klant', body: form(c), onOk: async v => { await api(`/klanten/${c.id}`, { method: 'PATCH', body: payload(v) }); toast('Opgeslagen.'); ctx.refresh(); } });
  },
};
export function onInput(e, ctx) { if (e.target.dataset.input === 'q') { q = e.target.value; ctx.refreshSoon(); } }
