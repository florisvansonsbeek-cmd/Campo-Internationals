// Jaar en Excel: the whole year per week, whether every region and every batch nets out to zero,
// the best customers and products, and the Excel file with every line, made fresh from the database on every download.
import { api, h, icon, fNum, fEur } from '../core.js';
import { lines } from '../charts.js';
import { dShort, isoWeek, zn } from '../wk.js';

let cur = null;

export async function render(params, query) {
  const jaar = Number(query.get('jaar')) || new Date().getFullYear();
  const d = await api(`/week/jaar?jaar=${jaar}`);
  cur = d;
  const k = d.kpi;
  const weeks = d.weken.filter(w => w.pakbonnen);
  const chart = weeks.length > 1 ? lines(weeks.map(w => `wk ${w.week}`), [{ name: 'Omzet', values: weeks.map(w => Math.round(w.omzet)), color: 'var(--s1)' }, { name: 'Inkoop', values: weeks.map(w => Math.round(w.inkoop || 0)), color: 'var(--s3)' }], { height: 220, fmt: v => fEur(v), title: `Omzet en inkoop per week ${d.jaar}` }) : '<p class="empty">Nog te weinig weken.</p>';
  const nz = d.regios.map(g => `<tr><td><b>${h(g.code)}</b> ${h(g.naam)}</td><td class="r num">${fNum(g.zendingen)}</td><td class="r num">${fNum(g.dozen_in)}</td><td class="r num">${fNum(g.uitval)}</td><td class="r num">${fNum(g.dozen_uit)}</td>
    <td class="r">${g.rest === 0 ? `<span class="chip ok">${icon('check')}0</span>` : `<span class="chip ${g.rest > 0 ? 'wait' : 'bad'}">${g.rest > 0 ? '+' : ''}${fNum(g.rest)}</span>`}</td></tr>`).join('');
  return `<div class="page wk">
    <div class="ph"><div><h1>Jaar en Excel</h1><p>Alles wat er in ${d.jaar} binnenkwam en wegging, per week, per regio en per partij. In Excel staat elke regel, met formules om zelf na te rekenen.</p></div>
      <div class="acts">${d.jaren.length > 1 ? `<div class="seg" role="group" aria-label="Jaar">${d.jaren.map(j => `<a href="#/jaar?jaar=${j}" aria-current="${j === d.jaar}">${j}</a>`).join('')}</div>` : ''}
        <a class="btn btn-leaf" href="/api/week/excel?jaar=${d.jaar}" download>${icon('db')}Download Excel</a></div></div>
    <div class="kpis kpis-6">
      <div class="kpi"><span>Omzet</span><b>${fEur(k.omzet)}</b><em>excl. btw · ${fNum(k.pakbonnen)} facturen</em></div>
      <div class="kpi"><span>Inkoop</span><b>${fEur(k.inkoop)}</b><em>verzendbewijzen, in euro</em></div>
      <div class="kpi"><span>Brutomarge</span><b>${fEur(k.marge)}</b><em>${k.omzet ? `${Math.round((k.marge / k.omzet) * 100)}% van de omzet` : ''}</em></div>
      <div class="kpi"><span>Zendingen</span><b>${fNum(k.zendingen)}</b><em>${fNum(k.dozen_in)} dozen binnen</em></div>
      <div class="kpi"><span>Klanten</span><b>${fNum(k.klanten)}</b><em>met een factuur</em></div>
      <div class="kpi${d.verschil.length ? ' bad' : ''}"><span>Netto nul</span><b>${d.verschil.length ? fNum(d.verschil.length) : icon('check')}</b><em>${d.verschil.length ? 'partijen met verschil' : 'elke partij komt uit'}</em></div>
    </div>
    <div class="grid2">
      <div class="stack">
        <section class="panel"><header><h2>Omzet en inkoop per week</h2><span class="sub">${weeks.length} weken</span></header><div class="body">${chart}</div></section>
        <section class="panel"><header><h2>Netto nul per regio</h2><span class="sub">dozen in min uitval min dozen naar klanten, alleen getelde weken</span></header>
          <div class="tbwrap"><table class="tb"><thead><tr><th>Regio</th><th class="r">Zendingen</th><th class="r">In</th><th class="r">Uitval</th><th class="r">Uit</th><th class="r">Rest</th></tr></thead><tbody>${nz || '<tr><td colspan="6" class="empty">Nog geen getelde weken.</td></tr>'}</tbody></table></div>
          ${d.verschil.length ? `<div class="body"><p class="small"><b>Partijen die niet op nul uitkomen:</b> ${d.verschil.map(p => `<a href="#/inkoop?maandag=${p.maandag}&p=${p.id}">${h(p.nummer)}</a> (${p.rest > 0 ? `${p.rest} over` : `${-p.rest} te veel uit`}, wk ${isoWeek(p.maandag)})`).join(', ')}.</p></div>` : ''}
          ${d.lopend.length ? `<div class="body" style="padding-top:0"><p class="small faint">Loopt nog: ${d.lopend.map(p => h(p.nummer)).join(', ')}.</p></div>` : ''}</section>
        <section class="panel"><header><h2>Producten</h2></header><div class="tbwrap"><table class="tb"><thead><tr><th>Product</th><th class="r">Dozen</th><th class="r">Stuks</th><th class="r">Omzet</th></tr></thead><tbody>
          ${d.producten.map(p => `<tr><td>${h(p.naam)} ${h(p.maat)}</td><td class="r num">${fNum(p.dozen)}</td><td class="r num">${fNum(p.stuks)}</td><td class="r num">${fEur(p.omzet)}</td></tr>`).join('')}</tbody></table></div></section>
      </div>
      <aside class="stack">
        <section class="panel xl"><header><h2>Het Excel-bestand</h2><span class="sub">altijd de stand van nu</span></header><div class="body stack" style="gap:10px">
          <p>De desk maakt het bestand bij elke download opnieuw uit de database. Zo heb je het zelf in handen: alles nakijken, sorteren, filteren.</p>
          <ul class="plainlist small"><li><b>Overzicht</b>: totalen, per regio en per week</li><li><b>Inkoop</b>: elke regel van elke zending, van besteld tot geteld</li><li><b>Verkoop</b>: elke regel van elke pakbon, met partij en kostendrager</li>
            <li><b>Partijen</b>: per zending (batchnummer) in, uit en rest</li><li><b>Klanten</b>, <b>Koersen</b> en <b>Plantenpaspoorten</b></li></ul>
          <p class="small faint">Totalen zijn formules op de regels, dus wat je aanpast rekent mee.</p>
          <p><a class="btn btn-leaf" href="/api/week/excel?jaar=${d.jaar}" download>${icon('db')}Download Excel ${d.jaar}</a></p></div></section>
        <section class="panel"><header><h2>Grootste klanten</h2></header><table class="tb"><tbody>${d.klanten.map(c => `<tr class="click" data-href="#/klant/${c.id}"><td><a href="#/klant/${c.id}">${h(c.naam)}</a><small class="faint" style="display:block">${h(c.land)} · ${fNum(c.weken)} weken</small></td><td class="r num">${fEur(c.omzet)}</td></tr>`).join('')}</tbody></table></section>
      </aside>
    </div>
  </div>`;
}
export const actions = {};
