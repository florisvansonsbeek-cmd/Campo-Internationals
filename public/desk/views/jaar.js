// The year at a glance, inside Controle → Database: what came in and went out per week, whether every region and every
// batch nets out to zero, the products and the biggest customers. The Excel with every line comes fresh from the database.
import { h, icon, fNum, fEur } from '../core.js';
import { lines } from '../charts.js';
import { isoWeek } from '../wk.js';

export function yearHtml(d) {
  const k = d.kpi;
  const weeks = d.weken.filter(w => w.pakbonnen);
  const chart = weeks.length > 1 ? lines(weeks.map(w => `wk ${w.week}`), [{ name: 'Omzet', values: weeks.map(w => Math.round(w.omzet)), color: 'var(--s1)' }, { name: 'Inkoop', values: weeks.map(w => Math.round(w.inkoop || 0)), color: 'var(--s3)' }], { height: 200, fmt: v => fEur(v), title: `Omzet en inkoop per week ${d.jaar}` }) : '<p class="empty">Nog te weinig weken.</p>';
  const nz = d.regios.map(g => `<tr><td><b>${h(g.code)}</b> ${h(g.naam)}</td><td class="r num">${fNum(g.zendingen)}</td><td class="r num">${fNum(g.dozen_in)}</td><td class="r num">${fNum(g.uitval)}</td><td class="r num">${fNum(g.dozen_uit)}</td>
    <td class="r">${g.rest === 0 ? `<span class="chip ok">${icon('check')}0</span>` : `<span class="chip ${g.rest > 0 ? 'wait' : 'bad'}">${g.rest > 0 ? '+' : ''}${fNum(g.rest)}</span>`}</td></tr>`).join('');
  return `<div class="kpis kpis-6">
      <div class="kpi"><span>Omzet</span><b>${fEur(k.omzet)}</b><em>excl. btw · ${fNum(k.pakbonnen)} facturen</em></div>
      <div class="kpi"><span>Inkoop</span><b>${fEur(k.inkoop)}</b><em>verzendbewijzen, in euro</em></div>
      <div class="kpi"><span>Brutomarge</span><b>${fEur(k.marge)}</b><em>${k.omzet ? `${Math.round((k.marge / k.omzet) * 100)}% van de omzet` : ''}</em></div>
      <div class="kpi"><span>Zendingen</span><b>${fNum(k.zendingen)}</b><em>${fNum(k.dozen_in)} dozen binnen</em></div>
      <div class="kpi"><span>Klanten</span><b>${fNum(k.klanten)}</b><em>met een factuur</em></div>
      <div class="kpi${d.verschil.length ? ' bad' : ''}"><span>Netto nul</span><b>${d.verschil.length ? fNum(d.verschil.length) : icon('check')}</b><em>${d.verschil.length ? 'batches met verschil' : 'elke batch komt uit'}</em></div>
    </div>
    <div class="grid2">
      <section class="panel"><header><h2>Omzet en inkoop per week</h2><span class="sub">${weeks.length} weken</span></header><div class="body">${chart}</div></section>
      <section class="panel"><header><h2>Netto nul per regio</h2><span class="sub">in min uitval min uit, getelde weken</span></header>
        <div class="tbwrap"><table class="tb"><thead><tr><th>Regio</th><th class="r">Zendingen</th><th class="r">In</th><th class="r">Uitval</th><th class="r">Uit</th><th class="r">Rest</th></tr></thead><tbody>${nz || '<tr><td colspan="6" class="empty">Nog geen getelde weken.</td></tr>'}</tbody></table></div>
        ${d.verschil.length ? `<div class="body"><p class="small"><b>Batches die niet op nul uitkomen:</b> ${d.verschil.map(p => `<a href="#/inkoop?maandag=${p.maandag}&p=${p.id}">${h(p.nummer)}</a> (${p.rest > 0 ? `${p.rest} over` : `${-p.rest} te veel uit`}, wk ${isoWeek(p.maandag)})`).join(', ')}.</p></div>` : ''}
        ${d.lopend.length ? `<div class="body" style="padding-top:0"><p class="small faint">Loopt nog: ${d.lopend.map(p => h(p.nummer)).join(', ')}.</p></div>` : ''}</section>
    </div>`;
}
