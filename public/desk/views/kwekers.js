// One grower: who delivers what, how reliably, at what price, what stands in the way, and how it went every single time.
import { api, h, icon, fTime, fNum, fEur, fPrice, fPct, fDate, fDay, dayWord, plural, COUNTRY, DOW, dialog, field, toast, waLink, stapChip } from '../core.js';
import { columns, lines } from '../charts.js';
import { obstaclePanel } from '../belemmeringen.js';

const MONTH = m => new Date(m + '-15').toLocaleDateString('nl-NL', { month: 'short' }).replace('.', '');

export async function renderDetail(params) {
  const g = await api(`/kwekers/${params.id}`);
  const months = [...new Set(g.prijsreeks.map(p => p.maand))].sort();
  const top = g.assortiment.slice(0, 5);
  // prices of different plants differ tenfold, so each line is indexed to its own first month (= 100)
  const priceSeries = top.map(a => {
    const raw = months.map(m => { const x = g.prijsreeks.find(p => p.plant_id === a.id && p.maand === m); return x ? Number(x.prijs) : null; });
    const base = raw.find(v => v != null);
    return { name: `${a.naam.replace(/^Phalaenopsis/, 'Phal.')} ${a.potmaat || ''}`.trim(), values: raw.map(v => (v == null || !base ? null : Math.round(v / base * 1000) / 10)) };
  });
  const late = g.history.filter(x => x.laat != null);
  return `<div class="page">
    <a class="back" href="#/relaties?kant=kwekers">${icon('back')}Kwekers en klanten</a>
    <div class="prof"><div><h1>${h(g.naam)}</h1>
      <div class="sub"><span>${h(g.plaats || '')}, ${h(COUNTRY[g.land] || g.land)}</span>${g.contact ? `<span>${h(g.contact)}</span>` : ''}${g.whatsapp ? `<a href="${waLink(g.whatsapp, '')}" target="_blank" rel="noopener">${icon('chat')}${h(g.whatsapp)}</a>` : ''}${g.email ? `<a href="mailto:${h(g.email)}">${h(g.email)}</a>` : ''}${g.bron === 'demo' ? '<span class="chip">demo</span>' : ''}${!g.actief ? '<span class="chip bad">niet actief</span>' : ''}</div>
      <div class="sub">${g.specialiteit ? `<span>${h(g.specialiteit)}</span>` : ''}${g.vervoer ? `<span>${icon('truck')} ${h(g.vervoer)}</span>` : ''}${g.laadtijd ? `<span>laadt ${h(g.laadtijd)}, ${g.reistijd_min} min naar Nootdorp</span>` : ''}${g.levert_op ? `<span>levert ${g.levert_op.map(d => DOW[d]).join(', ')}</span>` : ''}</div></div>
      <div class="bigscore"><b class="num">${g.score ?? '–'}</b><span>score van 100</span><button class="btn btn-sm btn-line" data-act="bewerk" data-id="${g.id}">${icon('edit')}Gegevens</button></div></div>
    <dl class="facts">
      <div><dt>Op tijd</dt><dd>${g.op_tijd == null ? '–' : `${g.op_tijd}%`}<small>${plural(g.leveringen, 'levering', 'leveringen')} gemeten</small></dd></div>
      <div><dt>Als het laat is</dt><dd>${g.gem_te_laat == null ? '–' : `${g.gem_te_laat} min`}<small>gemiddeld te laat</small></dd></div>
      <div><dt>Compleet geleverd</dt><dd>${g.compleet == null ? '–' : fPct(g.compleet)}<small>${g.minder}× minder dan besteld</small></dd></div>
      <div><dt>Kwaliteit</dt><dd>${g.score_delen ? `${g.score_delen.kwaliteit}%` : '–'}<small>${g.kwaliteit}× schade of kwaliteit</small></dd></div>
      <div><dt>Prijs t.o.v. markt</dt><dd>${g.prijsindex == null ? '–' : `${g.prijsindex > 100 ? '+' : ''}${fPct(g.prijsindex - 100)}`}<small>${g.prijsafwijking}× anders gefactureerd</small></dd></div>
      <div><dt>Inkoop 12 mnd</dt><dd>${fEur(g.inkoop)}<small>${g.trend == null ? '' : `${g.trend > 0 ? '+' : ''}${g.trend}% laatste 90 dagen`}</small></dd></div>
    </dl>
    <div class="grid2">
      <div class="stack">
        ${obstaclePanel(g.belemmeringen, 'kweker')}
        <section class="panel"><header><h2>Wat de desk ziet</h2></header><div class="body"><ul class="insights">${g.inzichten.map(i => `<li class="${i.toon}">${icon(i.toon === 'ok' ? 'check' : i.toon === 'bad' ? 'warn' : i.toon === 'wait' ? 'clock' : 'info')}<span>${h(i.tekst)}</span></li>`).join('')}</ul></div></section>
        <section class="panel"><header><h2>Hoe ging het iedere keer</h2><span class="sub">Laatste ${g.history.length} leveringen: gepland, werkelijk en wat er niet klopte</span></header>
          <div class="tbwrap"><table class="tb"><thead><tr><th style="padding-left:16px">Dag</th><th>Factuur</th><th class="r">Gepland</th><th class="r">Binnen</th><th>Wat</th><th>Bijzonderheden</th></tr></thead><tbody>
          ${g.history.map((x, i) => `<tr class="click${i >= 25 ? ' more-row' : ''}" data-href="#/factuur/${x.id}"${i >= 25 ? ' hidden' : ''}><td style="padding-left:16px" class="nowrap">${fDay(x.datum)}</td><td class="nowrap"><a href="#/factuur/${x.id}">${h(x.nummer)}</a>${x.stap && x.stap !== 'klaar' ? ` ${stapChip(x.stap)}` : ''}</td>
            <td class="r num">${x.aankomst_gepland ? fTime(x.aankomst_gepland) : '–'}</td>
            <td class="r num">${x.aankomst_werkelijk && x.laat != null ? `${fTime(x.aankomst_werkelijk)}${x.laat > 15 ? ` <span class="late${x.laat >= 45 ? ' bad' : ''}">+${x.laat}</span>` : x.laat < -5 ? ` <span class="late ok">${x.laat}</span>` : ''}` : '<span class="faint">nog niet</span>'}</td>
            <td class="small">${(x.regels || []).map(r => `${fNum(r.aantal)} ${h(r.plant || '?')}`).join(', ')}${x.klanten ? ` <span class="faint">→ ${plural(x.klanten, 'klant', 'klanten')}</span>` : ''}</td>
            <td class="small">${(x.afwijkingen || []).map(a => `<span class="chip ${a.opgelost ? '' : 'wait'}" title="${h(a.tekst)}">${h({ minder: 'minder', schade: 'schade', kwaliteit: 'kwaliteit', te_laat: 'te laat', prijs: 'prijs', maat: 'maat', dubbel: 'dubbel', meer: 'meer' }[a.soort] || a.soort)}</span>`).join(' ') || '<span class="faint">goed</span>'}</td></tr>`).join('')}
          </tbody></table></div>${g.history.length > 25 ? `<p class="body" style="padding-top:10px"><button class="lnk" data-act="meer">Toon alle ${g.history.length} leveringen</button></p>` : ''}</section>
      </div>
      <aside class="stack">
        <section class="panel"><header><h2>Op tijd per maand</h2></header><div class="body">${columns(g.maanden.map(m => ({ label: MONTH(m.maand), tipTitle: m.maand, value: Number(m.op_tijd), tip: `${m.op_tijd}% op tijd, ${m.leveringen} leveringen, gem. ${m.gem_laat} min laat` })), { unit: '%', max: 100, title: 'Aandeel leveringen binnen een kwartier van de afgesproken tijd' })}</div></section>
        <section class="panel"><header><h2>Per weekdag</h2></header><div class="body">${columns(g.weekdagen.map(w => ({ label: DOW[w.dag], value: Number(w.gem_laat), tip: `gemiddeld ${w.gem_laat} min te laat, ${w.n} leveringen` })), { unit: ' min', title: 'Gemiddeld te laat (minuten)', height: 140 })}</div></section>
        ${priceSeries.length ? `<section class="panel"><header><h2>Prijsverloop</h2><span class="sub">Per plant, eerste maand = 100</span></header><div class="body">${lines(months.map(MONTH), priceSeries, { fmt: v => String(Math.round(v)), title: 'Inkoopprijs als index' })}<p class="faint small" style="margin-top:6px">Boven de 100 is duurder dan aan het begin. De echte prijzen staan bij Assortiment.</p></div></section>` : ''}
      </aside>
    </div>
    <div class="grid2e" style="margin-top:16px">
      <section class="panel"><header><h2>Assortiment</h2><span class="sub">Twaalf maanden</span></header><div class="tbwrap"><table class="tb"><thead><tr><th style="padding-left:16px">Plant</th><th class="r">Keer</th><th class="r">Stuks</th><th class="r">Prijs nu</th><th class="r">Jaar terug</th><th class="r">Bij anderen</th></tr></thead><tbody>
        ${g.assortiment.map(a => { const d = a.prijs_nu && a.prijs_jaar_terug ? (a.prijs_nu / a.prijs_jaar_terug - 1) * 100 : null; return `<tr class="click" data-href="#/plant/${a.id}"><td style="padding-left:16px"><a href="#/plant/${a.id}">${h(a.naam)}</a> <span class="faint">${h([a.potmaat, a.hoogte].filter(Boolean).join(' '))}</span></td><td class="r num">${a.keer}</td><td class="r num">${fNum(a.stuks)}</td><td class="r num">${fPrice(a.prijs_nu)}</td><td class="r num">${d == null ? '–' : `<span class="${d > 3 ? 'down' : d < -3 ? 'up' : ''}">${d > 0 ? '+' : ''}${fPct(d)}</span>`}</td><td class="r num">${fPrice(a.prijs_anderen)}</td></tr>`; }).join('')}
      </tbody></table></div></section>
      <section class="panel"><header><h2>Bij welke klanten het terechtkomt</h2></header><div class="tbwrap"><table class="tb"><thead><tr><th style="padding-left:16px">Klant</th><th class="r">Keer</th><th class="r">Stuks</th></tr></thead><tbody>
        ${g.klanten.map(k => `<tr class="click" data-href="#/klant/${k.id}"><td style="padding-left:16px"><a href="#/klant/${k.id}">${h(k.naam)}</a> <span class="faint">${h(k.plaats)}</span></td><td class="r num">${k.keer}</td><td class="r num">${fNum(k.stuks)}</td></tr>`).join('')}
      </tbody></table></div>
      ${g.namen.length ? `<header style="border-top:1px solid var(--line)"><h2>Hoe deze kweker planten noemt</h2><span class="sub">Geleerd van eerdere facturen</span></header><div class="body"><ul class="feed">${g.namen.slice(0, 14).map(n => `<li style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)"><span>“${h(n.tekst)}”</span><span class="muted">${h(n.naam)} ${h([n.potmaat, n.hoogte].filter(Boolean).join(' '))}</span></li>`).join('')}</ul></div>` : ''}
      </section>
    </div>
  </div>`;
}

function form(g = {}) {
  return `<div class="form">${field('naam', 'Naam', g.naam, { wide: true })}${field('plaats', 'Plaats', g.plaats)}${field('land', 'Land (2 letters)', g.land || 'NL')}
    ${field('contact', 'Contactpersoon', g.contact)}${field('whatsapp', 'WhatsApp-nummer', g.whatsapp)}${field('email', 'E-mail', g.email, { type: 'email' })}${field('telefoon', 'Telefoon', g.telefoon)}
    ${field('vervoer', 'Vervoer', g.vervoer)}${field('laadtijd', 'Laadt meestal om', g.laadtijd, { type: 'time' })}${field('reistijd_min', 'Reistijd naar Nootdorp (min)', g.reistijd_min, { type: 'number' })}
    ${field('levert_op', 'Levert op (1=ma … 7=zo)', (g.levert_op || []).join(','))}${field('specialiteit', 'Specialiteit', g.specialiteit, { wide: true })}${field('notities', 'Notities', g.notities, { type: 'textarea', wide: true })}</div>`;
}
const payload = v => ({ ...v, reistijd_min: v.reistijd_min === '' ? null : v.reistijd_min, levert_op: v.levert_op ? v.levert_op : null });

// adding a grower starts on the Kwekers en klanten page (views/relaties.js)
export const listActions = {
  nieuw(el, ctx) { dialog({ title: 'Kweker toevoegen', ok: 'Toevoegen', body: form(), onOk: async v => { const r = await api('/kwekers', { method: 'POST', body: payload(v) }); toast('Kweker toegevoegd.'); location.hash = `#/kweker/${r.id}`; } }); },
};
export const detailActions = {
  meer(el) { document.querySelectorAll('.more-row').forEach(r => { r.hidden = false; }); el.remove(); },
  async bewerk(el, ctx) {
    const g = await api(`/kwekers/${el.dataset.id}`);
    dialog({ title: 'Gegevens van de kweker', body: form(g), onOk: async v => { await api(`/kwekers/${g.id}`, { method: 'PATCH', body: payload(v) }); toast('Opgeslagen.'); ctx.refresh(); } });
  },
};
