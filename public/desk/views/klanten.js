// Klanten: the sixty customers Jan calls with, what they took this year, and one page per customer with
// a quick order for the coming week, the products they take, the prices agreed in dollars and every packing slip.
import { api, h, icon, fNum, fEur, toast, dialog, field, LANG } from '../core.js';
import { spark, columns } from '../charts.js';
import { dLong, dShort, fUsdUnit, fEur2, isoWeek, today } from '../wk.js';
import { scoreBar, partsList, kansList } from './leverancier.js';

let list = null, filter = 'alle', q = '';
const SOORT = { kwekerij: 'Kwekerij', groothandel: 'Groothandel', tuincentrum: 'Tuincentrum', interieur: 'Interieur', bloemist: 'Bloemist', overig: 'Overig' };

function rowsHtml() {
  const t = q.trim().toLowerCase();
  const show = list.lijst.filter(k => (filter === 'alle' || (filter === 'nu' && k.nu_dozen > 0) || (filter === 'nl' && k.land === 'NL') || (filter === 'buiten' && k.land !== 'NL'))
    && (!t || `${k.naam} ${k.plaats} ${k.contact || ''}`.toLowerCase().includes(t)));
  if (!show.length) return '<tr><td colspan="7" class="empty">Geen klant gevonden.</td></tr>';
  return show.map(k => `<tr class="click" data-href="#/klant/${k.id}">
    <td><a href="#/klant/${k.id}"><b>${h(k.naam)}</b></a><small class="faint" style="display:block">${h(k.plaats)} · ${h(k.land)} · ${h(SOORT[k.soort] || k.soort)}</small></td>
    <td>${k.telefoon ? `<a class="lnk-plain" href="tel:${h(String(k.telefoon).replace(/\s/g, ''))}">${h(k.telefoon)}</a>` : '–'}</td>
    <td class="r num">${k.nu_dozen ? `<b>${fNum(k.nu_dozen)}</b>` : '<span class="faint">–</span>'}${k.straks_dozen ? `<small class="faint" style="display:block">+${fNum(k.straks_dozen)} volgende</small>` : ''}</td>
    <td class="r num">${fEur(k.omzet)}</td><td class="r num">${fNum(k.pakbonnen)}</td>
    <td>${k.laatst ? h(dShort(k.laatst)) : '–'}</td><td>${spark(k.reeks.length ? k.reeks : [0])}</td>
  </tr>`).join('');
}

export async function renderList() {
  list = await api('/week/klanten');
  const active = list.lijst.filter(k => k.nu_dozen > 0).length;
  return `<div class="page wk">
    <div class="ph"><div><h1>Klanten</h1><p>${fNum(list.lijst.length)} klanten. Wat ze dit jaar namen, wie er voor week ${isoWeek(list.focus)} al belde, en per klant de prijsafspraken in dollars.</p></div>
      <div class="acts"><button type="button" class="btn btn-leaf" data-act="new">${icon('plus')}Nieuwe klant</button></div></div>
    <div class="tools"><input type="search" placeholder="Zoek op naam of plaats" data-input="kq" value="${h(q)}" aria-label="Zoek klant">
      <div class="seg" role="group" aria-label="Filter">${[['alle', 'Alle', list.lijst.length], ['nu', `Week ${isoWeek(list.focus)}`, active], ['nl', 'Nederland', list.lijst.filter(k => k.land === 'NL').length], ['buiten', 'Buitenland', list.lijst.filter(k => k.land !== 'NL').length]]
        .map(([k, l, n]) => `<button type="button" data-act="f" data-f="${k}" aria-pressed="${filter === k}">${l}<small>${n}</small></button>`).join('')}</div>
      <span class="small faint" style="margin-left:auto">Omzet ${list.jaar}: ${fEur(list.totaal)}</span></div>
    <section class="panel"><div class="tbwrap"><table class="tb klanten"><thead><tr><th>Klant</th><th>Telefoon</th><th class="r">Week ${isoWeek(list.focus)}</th><th class="r">Omzet ${list.jaar}</th><th class="r">Facturen</th><th>Laatst</th><th>12 weken</th></tr></thead>
      <tbody id="krows">${rowsHtml()}</tbody></table></div></section>
  </div>`;
}
export function onListInput(e) {
  if (e.target.dataset.input !== 'kq') return;
  q = e.target.value;
  const tb = document.getElementById('krows'); if (tb) tb.innerHTML = rowsHtml();
}

function customerForm(k = {}) {
  return `<div class="form">${field('naam', 'Naam', k.naam, { wide: true, required: true })}${field('contact', 'Contactpersoon', k.contact)}${field('telefoon', 'Telefoon', k.telefoon)}
    ${field('email', 'E-mail (inkoop)', k.email, { type: 'email' })}${field('factuur_email', 'E-mail voor facturen', k.factuur_email, { type: 'email', hint: 'Hier gaat de pakbon met factuur naartoe.' })}
    ${field('adres', 'Adres', k.adres)}${field('postcode', 'Postcode', k.postcode)}${field('plaats', 'Plaats', k.plaats, { required: true })}${field('land', 'Land (2 letters)', k.land || 'NL')}
    ${field('taal', 'Taal van de factuur', k.taal || 'nl', { opts: Object.entries(LANG) })}${field('soort', 'Soort', k.soort || 'kwekerij', { opts: Object.entries(SOORT) })}
    ${field('btw_nummer', 'Btw-nummer', k.btw_nummer)}${field('exact_code', 'Debiteurnummer in Exact', k.exact_code)}${field('betaaltermijn', 'Betaaltermijn (dagen)', k.betaaltermijn ?? 14, { type: 'number' })}</div>`;
}

// paid on time, late, or still open (until Exact tells the desk, Jan ticks it here)
function paid(s) {
  if (s.status !== 'akkoord') return '';
  const late = s.betaald_op ? Math.round((new Date(`${s.betaald_op}T12:00:00`) - new Date(`${s.vervaldatum}T12:00:00`)) / 864e5) : null;
  if (s.betaald_op) return `<span class="ot ${late > 2 ? 'late' : 'ok'}">${icon(late > 2 ? 'clock' : 'check')}${h(dShort(s.betaald_op))}${late > 2 ? ` · ${late} d te laat` : ''}</span>`;
  const over = Math.round((new Date(`${today()}T12:00:00`) - new Date(`${s.vervaldatum}T12:00:00`)) / 864e5);
  return `${over > 0 ? `<span class="ot late">${over} d over tijd</span> ` : '<span class="faint">open</span> '}<button type="button" class="lnk small" data-act="paid" data-id="${s.id}">Betaald</button>`;
}
function analysis(a) {
  if (!a) return '';
  return `<section class="panel"><header><h2>Hoe goed is deze klant</h2>${a.score != null ? `<span class="badge-s" data-s="${a.score >= 60 ? 'g' : a.score >= 40 ? 'o' : 'r'}"><b>${a.score}</b><small>${h(a.label.naam)}</small></span>` : `<span class="sub">${h(a.label.naam)}</span>`}</header>
    <div class="body stack">${a.tags.length ? `<p class="tags">${a.tags.map(t => `<span class="chip ${h(t.toon)}">${h(t.naam)}</span>`).join('')}</p>` : ''}
      ${partsList(a.parts)}
      <h3 class="h3s">Meer voor hem doen</h3>${kansList(a.kansen, 'Geen open kansen: hij neemt wat bij hem past.')}</div></section>`;
}

let cur = null;
export async function renderDetail(params) {
  const d = await api(`/week/klanten/${params.id}`);
  cur = d;
  const k = d.klant;
  const chart = d.perWeek.length ? columns(d.perWeek.map(w => ({ label: `wk ${isoWeek(w.maandag)}`, value: Math.round(w.omzet) })), { title: `Omzet per week ${d.jaar}`, fmt: v => fEur(v), height: 180 }) : '<p class="empty">Dit jaar nog niets geleverd.</p>';
  const upcoming = d.upcoming.filter(u => u.maandag >= d.focus);
  const byWeek = new Map();
  for (const u of upcoming) { if (!byWeek.has(u.maandag)) byWeek.set(u.maandag, []); byWeek.get(u.maandag).push(u); }
  return `<div class="page wk">
    <a class="back" href="#/relaties">${icon('back')}Relaties</a>
    <div class="prof"><div><h1>${h(k.naam)}</h1>
      <p class="sub"><span>${h([k.adres, [k.postcode, k.plaats].filter(Boolean).join(' '), k.land].filter(Boolean).join(', '))}</span>
        ${k.contact ? `<span>${h(k.contact)}</span>` : ''}${k.telefoon ? `<a href="tel:${h(String(k.telefoon).replace(/\s/g, ''))}">${icon('phone')}${h(k.telefoon)}</a>` : ''}
        ${k.factuur_email || k.email ? `<a href="mailto:${h(k.factuur_email || k.email)}">${icon('mail')}${h(k.factuur_email || k.email)}</a>` : ''}</p>
      <p class="sub small"><span>Factuur in het ${h((LANG[k.taal] || k.taal).toLowerCase())}</span>${k.btw_nummer ? `<span>Btw ${h(k.btw_nummer)}</span>` : ''}${k.exact_code ? `<span>Exact ${h(k.exact_code)}</span>` : ''}<span>${k.betaaltermijn} dagen</span></p></div>
      <div><button type="button" class="btn btn-line" data-act="edit">${icon('edit')}Bewerken</button></div></div>
    <dl class="facts">
      <div><dt>Omzet ${d.jaar}</dt><dd>${fEur(d.kpi.omzet)}<small>excl. btw</small></dd></div>
      <div><dt>Brutomarge</dt><dd>${fEur(d.kpi.marge)}<small>${d.kpi.omzet ? `${Math.round((d.kpi.marge / d.kpi.omzet) * 100)}% van de omzet` : ''}</small></dd></div>
      <div><dt>Weken besteld</dt><dd>${fNum(d.kpi.weken)}<small>van de ${d.kpi.van} weken</small></dd></div>
      <div><dt>Per keer</dt><dd>${fEur(d.kpi.gemiddeld)}<small>${fNum(d.kpi.dozen)} dozen dit jaar</small></dd></div>
    </dl>
    <div class="grid2">
      <div class="stack">
        <section class="panel"><header><h2>Telefoon</h2><span class="sub">bestelling noteren</span></header><div class="body stack">
          <form class="phone" data-form="korder"><label class="f">Week<select name="maandag">${[0, 1, 2].map(i => { const m = new Date(`${d.bestelWeek}T12:00:00`); m.setDate(m.getDate() + i * 7); const s = m.toISOString().slice(0, 10); return `<option value="${s}">Week ${isoWeek(s)} · ${h(dShort(s))}</option>`; }).join('')}</select></label>
            <label class="f">Product<select name="product_id">${d.producten.map(p => `<option value="${p.id}">${h(p.naam)} ${h(p.maat)}</option>`).join('')}</select></label>
            <label class="f">Dozen<input type="number" name="dozen" min="1" max="9999" required></label><button class="btn btn-leaf" type="submit">${icon('plus')}Noteren</button></form>
          ${byWeek.size ? [...byWeek.entries()].map(([m, us]) => `<p class="small"><b>Week ${isoWeek(m)}</b> (${h(dShort(m))}): ${us.map(u => `${u.dozen} × ${h(u.naam)} ${h(u.maat)}`).join(', ')}</p>`).join('') : '<p class="small faint">Nog niets genoteerd voor de komende weken.</p>'}
        </div></section>
        <section class="panel"><header><h2>Omzet per week</h2><span class="sub">${d.jaar}</span></header><div class="body">${chart}</div></section>
        <section class="panel"><header><h2>Pakbonnen en facturen</h2></header><div class="tbwrap"><table class="tb"><thead><tr><th>Nummer</th><th>Week</th><th class="r">Dozen</th><th class="r">Bedrag</th><th>Exact</th><th>Mail</th><th>Betaald</th></tr></thead><tbody>
          ${d.slips.map(s => `<tr><td>${s.status === 'akkoord' ? `<a href="/api/week/pakbonnen/${s.id}/pdf" target="_blank" rel="noopener">${h(s.nummer)}</a>` : `${h(s.nummer)} <span class="chip wait">heropend</span>`}</td><td>wk ${isoWeek(s.maandag)} · ${h(dShort(s.maandag))}</td>
            <td class="r num">${fNum(s.dozen || 0)}</td><td class="r num">${fEur2(s.totaal)}</td><td>${s.exact === 'in_exact' ? icon('check') : '–'}</td><td class="small">${s.mail === 'verstuurd' ? 'verstuurd' : s.mail === 'in_outlook' ? 'in Outlook' : s.mail === 'concept' ? 'concept' : 'met de goederen'}</td>
            <td class="small nowrap">${paid(s)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nog geen pakbonnen.</td></tr>'}
        </tbody></table></div></section>
      </div>
      <aside class="stack">
        ${analysis(d.analyse)}
        <section class="panel"><header><h2>Wat ze nemen</h2><span class="sub">${d.jaar}</span></header>${d.mix.length ? `<table class="tb"><tbody>${d.mix.map(p => `<tr><td>${h(p.naam)} ${h(p.maat)}<small class="faint" style="display:block">${fNum(p.weken)} weken</small></td><td class="r num">${fNum(p.dozen)} dozen</td><td class="r num">${fEur(p.omzet)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Nog niets.</p>'}</section>
        <section class="panel"><header><h2>Prijzen in dollars</h2><span class="sub">per stuk</span></header><table class="tb deals"><tbody>
          ${d.deals.map(p => `<tr><td>${h(p.naam)} ${h(p.maat)}</td><td class="r num">${p.prijs_usd != null ? `<b>${fUsdUnit(p.prijs_usd)}</b><small class="faint" style="display:block">lijst ${fUsdUnit(p.standaard)}</small>` : `<span class="faint">${fUsdUnit(p.standaard)}</span>`}</td>
            <td class="r"><button type="button" class="btn btn-sm btn-ghost" data-act="deal" data-p="${p.product_id}" aria-label="Prijs ${h(p.naam)} ${h(p.maat)}">${icon('edit')}</button></td></tr>`).join('')}
        </tbody></table><p class="small faint" style="padding:0 16px 12px">Zonder afspraak geldt de lijstprijs. De factuur rekent met de koers van de week om naar euro.</p></section>
      </aside>
    </div>
  </div>`;
}

export function mountDetail(ctx) {
  const f = document.querySelector('[data-form="korder"]');
  if (f) f.addEventListener('submit', async e => {
    e.preventDefault();
    await api('/week/bestellen/regel', { method: 'POST', body: { maandag: f.maandag.value, klant_id: cur.klant.id, product_id: Number(f.product_id.value), dozen: Number(f.dozen.value) } }).catch(x => { toast(x.message); throw x; });
    toast('Genoteerd.'); ctx.refresh();
  });
}

const save = async (id, v) => api(id ? `/week/klanten/${id}` : '/week/klanten', { method: id ? 'PATCH' : 'POST', body: v });
export const listActions = {
  f: (el, ctx) => { filter = el.dataset.f; document.querySelectorAll('[data-act="f"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === filter))); const tb = document.getElementById('krows'); if (tb) tb.innerHTML = rowsHtml(); },
  new: () => dialog({ title: 'Nieuwe klant', ok: 'Toevoegen', body: customerForm(), onOk: async v => { const r = await save(null, v); toast('Klant toegevoegd.'); location.hash = `#/klant/${r.id}`; } }),
};
export const detailActions = {
  paid: async (el, ctx) => { await api(`/week/pakbonnen/${el.dataset.id}/betaald`, { method: 'POST', body: { datum: today() } }); toast('Op betaald gezet.'); ctx.refresh(); },
  edit: (el, ctx) => dialog({ title: cur.klant.naam, ok: 'Opslaan', body: customerForm(cur.klant), onOk: async v => { await save(cur.klant.id, v); toast('Opgeslagen.'); ctx.refresh(); } }),
  deal: (el, ctx) => {
    const p = cur.deals.find(x => x.product_id === Number(el.dataset.p));
    dialog({
      title: `${p.naam} ${p.maat}`, ok: 'Opslaan',
      body: `${field('prijs_usd', 'Afgesproken prijs in dollar per stuk (leeg = lijstprijs)', p.prijs_usd != null ? String(p.prijs_usd).replace('.', ',') : '')}<p class="small faint" style="margin-top:8px">Lijstprijs ${fUsdUnit(p.standaard)}.</p>`,
      onOk: async v => { await api(`/week/klanten/${cur.klant.id}/prijs`, { method: 'PUT', body: { product_id: p.product_id, prijs_usd: v.prijs_usd === '' ? null : v.prijs_usd } }); toast('Prijs opgeslagen.'); ctx.refresh(); },
    });
  },
};
