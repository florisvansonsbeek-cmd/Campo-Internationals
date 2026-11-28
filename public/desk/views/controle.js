// Controle: does everything keep to the rules, and is everything right in Exact? The desk puts the invoices and purchase
// orders into Exact after Jan's approval; this tab only reads and checks. Four parts behind the slider:
//   Regels    what is not allowed and what is, each with what the desk sees in its own data
//   Exact     what Exact holds next to the desk, line by line (Exact Online, an export from Exact, or the demo's imitation)
//   Archief   every paper per year and week in folders: orders, confirmations, shipping papers, invoices, offers, Excel
//   Database  the big Excel, the lists of plants, customers, suppliers, batches and invoices, the year, and a back-up
import { api, h, icon, fNum, fEur, toast, dialog } from '../core.js';
import { dShort, dayTime, readFile } from '../wk.js';
import { sliderHtml, centerSlider } from './handel.js';
import { yearHtml } from './jaar.js';

const PARTS = [['regels', 'Regels', 'shield'], ['exact', 'Exact', 'check'], ['archief', 'Archief', 'file'], ['database', 'Database', 'db']];
const ST = { ok: ['ok', 'check', 'In orde'], fout: ['bad', 'warn', 'Oplossen'], let_op: ['wait', 'clock', 'Nakijken'], info: ['info', 'info', 'Goed om te weten'] };
const EXS = { ok: ['ok', 'Klopt'], verschil: ['bad', 'Verschil'], mist: ['bad', 'Mist in Exact'], open: ['wait', 'Nog niet in Exact'], onbekend: ['wait', 'Alleen in Exact'] };
let cur = 'regels', jaar = new Date().getFullYear(), E = null, DB = null, AR = null, list = 'planten', q = '', aq = '';
const money = (v, cur = 'EUR') => (cur === 'USD' ? `$ ${Number(v || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : fEur(v, 2));

function lineOf(k, s) {
  if (!s) return { a: '', b: '', t: '' };
  if (k === 'regels') { const r = s.regels; return { a: r.fout ? `${r.fout} om op te lossen` : r.let_op ? `${r.let_op} om na te kijken` : 'alles in orde', b: `${r.ok} in orde`, t: r.fout ? 'bad' : r.let_op ? 'wait' : 'ok' }; }
  if (k === 'exact') {
    const e = s.exact, wrong = e.verschil + e.mist;
    if (!e.bron) return { a: 'Nog niet gekoppeld', b: 'koppel Exact of lees een export in', t: 'wait' };
    return { a: wrong ? `${wrong} ${wrong === 1 ? 'verschil' : 'verschillen'}` : `${fNum(e.ok)} kloppen`, b: e.open ? `${e.open} nog niet in Exact` : e.bron === 'demo' ? 'demo-Exact' : e.bron === 'import' ? 'uit een export' : 'Exact Online', t: wrong ? 'bad' : e.open ? 'wait' : 'ok' };
  }
  if (k === 'archief') { const a = s.archief; return { a: `${fNum(a.bestanden)} bestanden`, b: `${fNum(a.weken)} weken in ${s.jaar}`, t: '' }; }
  if (k === 'database') return { a: `Excel en back-up`, b: `${fNum(s.database.planten)} planten · ${s.database.grootte || ''}`, t: '' };
  return { a: '', b: '', t: '' };
}
const yearSeg = (jaren, part) => (jaren && jaren.length > 1 ? `<div class="seg" role="group" aria-label="Jaar">${jaren.map(j => `<a href="#/controle?deel=${part}&jaar=${j}" aria-current="${j === jaar}">${j}</a>`).join('')}</div>` : '');

// ================================================================ the rules
function rulesPart(R, jaren) {
  const row = r => { const [t, ic, w] = ST[r.status] || ST.info; return `<li class="rl t-${t}">
      <span class="rl-i" aria-hidden="true">${icon(ic)}</span>
      <div class="rl-b"><b>${h(r.titel)}</b><p>${h(r.tekst)}</p>
        <details><summary>Waarom</summary><p class="small">${h(r.uitleg)}</p><p class="small faint">Bron: ${h(r.bron)}</p></details></div>
      <div class="rl-a"><span class="chip ${t === 'bad' ? 'bad' : t === 'wait' ? 'wait' : t === 'ok' ? 'ok' : 'dash'}">${w}</span>${r.link ? `<a class="lnk small" href="${h(r.link.href)}">${h(r.link.tekst)}</a>` : ''}</div></li>`; };
  const col = (soort, title, sub) => {
    const rs = R.regels.filter(r => r.soort === soort);
    const groups = [...new Set(rs.map(r => r.groep))];
    return `<section class="panel rules"><header><h2>${title}</h2><span class="sub">${sub}</span></header>
      ${groups.map(g => `<h3 class="rl-g">${h(g)}</h3><ul class="rl-l">${rs.filter(r => r.groep === g).map(row).join('')}</ul>`).join('')}</section>`;
  };
  return `<div class="part-h"><div><h2>Wat mag niet en wat mag wel</h2><p>De regels voor invoer, het plantenpaspoort, de factuur en btw, Exact en het bewaren, en de afspraken van Campo. Per regel kijkt de desk in zijn eigen gegevens of het klopt. Rood oplossen, oranje nakijken.</p></div>
      <div class="acts">${yearSeg(jaren, 'regels')}</div></div>
    <p class="rl-sum">${R.samen.fout ? `<span class="chip bad">${icon('warn')}${R.samen.fout} om op te lossen</span>` : ''}${R.samen.let_op ? `<span class="chip wait">${icon('clock')}${R.samen.let_op} om na te kijken</span>` : ''}<span class="chip ok">${icon('check')}${R.samen.ok} in orde</span></p>
    <div class="grid2 even">${col('niet', 'Mag niet', 'en wat de desk ziet')}${col('wel', 'Mag wel', 'zo werkt Campo')}</div>
    <p class="small faint">De desk leest alleen; oplossen doe je waar de link naartoe gaat. Regels over invoer en het plantenpaspoort: kijk bij twijfel bij de NVWA of Naktuinbouw.</p>`;
}

// ================================================================ Exact
function sourceBox(e) {
  const s = e.status;
  if (e.bron === 'api') return `<div class="src ok"><b>${icon('check')}Exact Online${s.administratie ? `: ${h(s.administratie)}` : ''}</b><span>${e.gelezen ? `Gelezen ${h(dayTime(e.gelezen.op))}` : 'Nog niet gelezen'}${e.fout ? ` · ${h(e.fout)}` : ''}</span>
    <button type="button" class="btn btn-sm btn-line" data-act="x-lees">${icon('search')}Lees Exact opnieuw</button></div>`;
  if (e.bron === 'import') return `<div class="src"><b>${icon('file')}Export uit Exact: ${h(s.import.naam)}</b><span>Ingelezen ${h(dayTime(s.import.op))} · ${fNum(s.import.rijen)} regels${e.periode ? ` · ${h(dShort(e.periode.van))} tot ${h(dShort(e.periode.tot))}` : ''}</span>
    <span class="src-a"><button type="button" class="btn btn-sm btn-line" data-act="x-import">${icon('upload')}Ander bestand</button><button type="button" class="lnk small" data-act="x-import-weg">Weghalen</button></span></div>`;
  if (e.bron === 'demo') return `<div class="src demo"><b>${icon('info')}Demo-Exact</b><span>Exact is nog niet gekoppeld; de desk doet na hoe Exact eruit zou zien. ${e.demo?.verschillen?.length ? `Er zijn ${e.demo.verschillen.length} fouten expres in gezet, om te laten zien hoe de controle werkt.` : ''}</span>
    <span class="src-a"><button type="button" class="btn btn-sm btn-line" data-act="x-import">${icon('upload')}Export uit Exact inlezen</button><a class="lnk small" href="#/koppelingen">Exact koppelen</a></span></div>`;
  return `<div class="src none"><b>${icon('plug')}Exact is nog niet gekoppeld</b><span>Koppel Exact bij Koppelingen, dan zet de desk na jouw akkoord alles erin en leest het hier terug. Of lees nu een export uit Exact in.</span>
    <span class="src-a"><a class="btn btn-sm btn-leaf" href="#/koppelingen">Naar Koppelingen</a><button type="button" class="btn btn-sm btn-line" data-act="x-import">${icon('upload')}Export inlezen</button></span></div>`;
}
function exactRow(x) {
  const [t, w] = EXS[x.status];
  return `<tr class="t-${t}"><td><span class="chip ${t === 'bad' ? 'bad' : t === 'wait' ? 'wait' : 'ok'}">${w}</span></td>
    <td>${x.soort === 'verkoop' ? `<a href="#/pakbon/${x.klant_id}?maandag=${x.maandag}"><b>${h(x.ref)}</b></a>` : `<a href="#/inkoop?maandag=${x.maandag}&p=${x.id}"><b>${h(x.ref)}</b></a>`}<small class="faint" style="display:block">${x.soort === 'verkoop' ? 'factuur' : 'inkoop'} · wk ${x.week}</small></td>
    <td>${h(x.relatie || '')}<small class="faint" style="display:block">${h(x.relatie_code || 'geen code')}</small></td>
    <td class="r num">${money(x.bedrag, x.valuta)}${x.exact_boeking && x.exact_boeking.bedrag !== x.bedrag ? `<small class="bad" style="display:block">Exact ${money(x.exact_boeking.bedrag, x.valuta)}</small>` : ''}</td>
    <td>${x.verschillen.length ? `<ul class="xd">${x.verschillen.map(v => `<li>${h(v)}</li>`).join('')}</ul>` : x.status === 'mist' ? '<span class="small">De desk zegt "in Exact", maar Exact heeft hem niet.</span>' : x.status === 'open' ? '<span class="small faint">Nog niet in Exact gezet.</span>' : ''}</td></tr>`;
}
function exactPart(e, jaren) {
  const all = [...e.verkoop, ...e.inkoop];
  const wrong = all.filter(x => x.status === 'verschil' || x.status === 'mist'), open = all.filter(x => x.status === 'open'), good = all.filter(x => x.status === 'ok');
  const k = e.samen;
  const canPut = e.status && (e.status.gekoppeld ? !e.status.ontbreekt.length : e.status.demo);
  return `<div class="part-h"><div><h2>Exact</h2><p>Na jouw akkoord zet de desk elke factuur en inkooporder in Exact, met het batchnummer als kostendrager. Deze controle leest daarna alleen wat er in Exact staat en legt het naast de desk: bedrag, debiteur, kostendrager, btw en datum.</p></div>
      <div class="acts">${yearSeg(jaren, 'exact')}</div></div>
    ${sourceBox(e)}
    <dl class="facts x5">
      <div><dt>Klopt</dt><dd>${fNum(k.ok)}</dd></div><div class="${k.verschil ? 't-bad' : ''}"><dt>Verschil</dt><dd>${fNum(k.verschil)}</dd></div><div class="${k.mist ? 't-bad' : ''}"><dt>Mist in Exact</dt><dd>${fNum(k.mist)}</dd></div>
      <div class="${k.open ? 't-wait' : ''}"><dt>Nog niet in Exact</dt><dd>${fNum(k.open)}</dd></div><div class="${k.onbekend ? 't-wait' : ''}"><dt>Alleen in Exact</dt><dd>${fNum(k.onbekend)}</dd></div>
    </dl>
    ${open.length ? `<div class="next"><b>${fNum(open.length)} ${open.length === 1 ? 'stuk staat' : 'stukken staan'} klaar voor Exact</b><p>${pieces(open)}, al goedgekeurd.</p>
      <button type="button" class="btn btn-leaf" data-act="x-zet"${canPut ? '' : ' disabled'}>${icon('check')}Zet in Exact</button>${canPut ? '' : '<small>Koppel eerst Exact (en vul de btw-codes in).</small>'}</div>` : ''}
    ${wrong.length ? `<section class="panel"><header><h2>Wat niet klopt</h2><span class="sub">pas het aan in Exact, of heropen de pakbon</span></header>
      <div class="tbwrap"><table class="tb xt"><thead><tr><th>Stand</th><th>Stuk</th><th>Relatie</th><th class="r">Bedrag</th><th>Wat er anders is</th></tr></thead><tbody>${wrong.map(exactRow).join('')}</tbody></table></div></section>`
      : e.bron ? `<p class="okline">${icon('check')}Alles wat in Exact staat, klopt met de desk.</p>` : ''}
    ${e.onbekend.length ? `<section class="panel"><header><h2>Alleen in Exact</h2><span class="sub">geboekt in Exact, niet gevonden in de desk</span></header>
      <div class="tbwrap"><table class="tb"><thead><tr><th>Referentie</th><th>Boeking</th><th>Datum</th><th>Relatie</th><th class="r">Bedrag</th></tr></thead><tbody>
      ${e.onbekend.map(b => `<tr><td><b>${h(b.referentie)}</b><small class="faint" style="display:block">${b.soort}</small></td><td>${h(b.entry_nummer || '–')}</td><td>${h(b.datum ? dShort(b.datum) : '–')}</td><td>${h(b.relatie || b.relatie_code || '')}</td><td class="r num">${money(b.bedrag, b.valuta)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    ${open.length ? `<details class="panel xopen"><summary><b>Nog niet in Exact</b> <span class="faint">${fNum(open.length)}</span></summary><div class="tbwrap"><table class="tb xt"><tbody>${open.map(exactRow).join('')}</tbody></table></div></details>` : ''}
    ${good.length ? `<details class="panel xopen"><summary><b>Klopt</b> <span class="faint">${fNum(good.length)} facturen en inkooporders</span></summary><div class="tbwrap"><table class="tb xt"><tbody>${good.slice(0, 400).map(exactRow).join('')}</tbody></table></div></details>` : ''}`;
}

// ================================================================ the archive
const FILE_IC = n => (/\.pdf$/i.test(n) ? 'file' : /\.xlsx$/i.test(n) ? 'db' : 'copy');
function fileLi(f) { return `<li class="af"><a href="${h(f.url)}" target="_blank" rel="noopener">${icon(FILE_IC(f.naam))}<span>${h(f.naam)}</span></a>${f.extra ? `<small>${h(f.extra)}</small>` : ''}</li>`; }
function weekHtml(w, i) {
  const hit = t => !aq || t.toLowerCase().includes(aq);
  const inkoop = w.inkoop.filter(p => hit(`${p.nummer} ${p.leverancier} ${p.bestanden.map(b => b.naam).join(' ')}`));
  const verkoop = w.verkoop.filter(s => hit(`${s.nummer} ${s.klant}`));
  const aanbod = w.aanbod.filter(a => hit(a.naam));
  if (aq && !inkoop.length && !verkoop.length && !aanbod.length) return '';
  return `<details class="aw"${i === 0 || aq ? ' open' : ''}><summary><span class="aw-n">${icon('file')}<b>${h(w.naam)}</b></span><span class="aw-c">${fNum(w.bestanden)} bestanden</span><a class="lnk small" href="${h(w.zip)}" download>${icon('out')}Zip</a></summary>
    <div class="aw-b">
      ${inkoop.length ? `<div class="ad"><h4>${icon('in')}Inkoop</h4>${inkoop.map(p => `<details class="ad2"${aq ? ' open' : ''}><summary>${h(p.nummer)} ${h(p.leverancier)} <span class="faint">${p.bestanden.length}</span></summary>
        <ul>${p.bestanden.map(fileLi).join('') || '<li class="faint small">Geen papieren bewaard.</li>'}${p.fyto ? `<li class="af"><span class="small faint">Fytosanitair certificaat ${h(p.fyto)}${p.awb ? ` · AWB ${h(p.awb)}` : ''}</span></li>` : ''}</ul></details>`).join('')}</div>` : ''}
      ${verkoop.length ? `<div class="ad"><h4>${icon('uit')}Verkoop</h4><ul>${verkoop.map(s => fileLi({ ...s, extra: s.bevroren ? 'zoals verstuurd' : '' })).join('')}</ul></div>` : ''}
      ${aanbod.length ? `<div class="ad"><h4>${icon('tag')}Aanbod</h4><ul>${aanbod.map(fileLi).join('')}</ul></div>` : ''}
      ${w.exact && !aq ? `<div class="ad"><h4>${icon('db')}Exact</h4><ul>${fileLi(w.exact)}</ul></div>` : ''}
    </div></details>`;
}
function archivePart(a) {
  return `<div class="part-h"><div><h2>Archief</h2><p>Alles per jaar en week, zodat er niets verloren gaat: de bestellingen, bevestigingen en verzendpapieren per batch en leverancier, de pakbonnen met factuur per klant, het aanbod en de Excel voor Exact. Bewaar het zeven jaar.</p></div>
      <div class="acts">${yearSeg(a.jaren, 'archief')}<a class="btn btn-leaf" href="/api/week/archief.zip?jaar=${a.jaar}" download>${icon('out')}Heel ${a.jaar} als zip</a></div></div>
    <div class="tools"><input type="search" placeholder="Zoek op batchnummer, leverancier, klant of factuurnummer" data-input="aq" value="${h(aq)}" aria-label="Zoek in het archief">
      <span class="small muted">${fNum(a.samen.weken)} weken · ${fNum(a.samen.zendingen)} zendingen · ${fNum(a.samen.facturen)} facturen · ${fNum(a.samen.bestanden)} bestanden</span></div>
    <div class="atree" id="atree">${treeHtml(a)}</div>`;
}
// year → month → week → inkoop / verkoop / aanbod / Exact: the two most recent months open, the rest folded
const MON = new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' });
function treeHtml(a) {
  const months = [];
  for (const w of a.weken) { const k = w.maandag.slice(0, 7); let m = months.find(x => x.k === k); if (!m) months.push(m = { k, weken: [] }); m.weken.push(w); }
  let first = true;
  const out = months.map((m, i) => {
    const inner = m.weken.map(w => { const x = weekHtml(w, first ? 0 : 1); if (x) first = false; return x; }).join('');
    if (!inner) return '';
    const n = m.weken.reduce((t, w) => t + w.bestanden, 0);
    const name = MON.format(new Date(`${m.k}-15T12:00:00`));
    return `<details class="am"${i < 2 || aq ? ' open' : ''}><summary><b>${h(name[0].toUpperCase() + name.slice(1))}</b><span class="aw-c">${m.weken.length} ${m.weken.length === 1 ? 'week' : 'weken'} · ${fNum(n)} bestanden</span></summary><div class="am-b">${inner}</div></details>`;
  }).join('');
  return out || `<p class="empty">${aq ? 'Niets gevonden.' : 'Nog niets in dit jaar.'}</p>`;
}

// ================================================================ the database
const LISTS = {
  planten: { t: 'Planten', head: ['Artikel', 'Plant', 'Botanische naam', 'Per doos', 'Lijstprijs', 'Leveranciers', 'Dozen', 'Omzet'],
    row: x => [x.exact_code || x.code, `${x.naam} ${x.maat}`, x.soort, fNum(x.per_doos), `$ ${Number(x.prijs_usd).toFixed(3).replace('.', ',')}`, x.leveranciers || '–', fNum(x.dozen), fEur(x.omzet)], num: [3, 4, 6, 7] },
  klanten: { t: 'Klanten', head: ['Klant', 'Plaats', 'Land', 'Debiteur', 'Btw-nummer', 'Mail', 'Facturen', 'Omzet'],
    row: x => [x.naam, x.plaats, x.land, x.exact_code || '–', x.btw_nummer || '–', x.email || '–', fNum(x.facturen), fEur(x.omzet)], num: [6, 7], href: x => `#/klant/${x.id}` },
  leveranciers: { t: 'Leveranciers', head: ['Leverancier', 'Plaats', 'Regio', 'Crediteur', 'Mail', 'Zendingen'],
    row: x => [x.naam, x.plaats || '', x.regio, x.exact_code || '–', x.email || '–', fNum(x.zendingen)], num: [5], href: x => `#/leverancier/${x.id}` },
  batches: { t: 'Batches', head: ['Batch', 'Week', 'Leverancier', 'In', 'Uitval', 'Uit', 'Rest', 'Exact'],
    row: x => [x.nummer, `wk ${x.week}`, x.leverancier, fNum(x.dozen_in), fNum(x.uitval), fNum(x.dozen_uit), fNum(x.rest), x.exact === 'in_exact' ? 'ja' : 'nee'], num: [3, 4, 5, 6], href: x => `#/inkoop?maandag=${x.maandag}&p=${x.id}` },
  facturen: { t: 'Facturen', head: ['Factuur', 'Datum', 'Klant', 'Excl. btw', 'Btw', 'Exact'],
    row: x => [x.nummer, dShort(x.datum), x.klant, fEur(x.totaal, 2), `${fNum(x.btw_pct)}%`, x.exact === 'in_exact' ? (x.exact_nummer || 'ja') : 'nee'], num: [3, 4], href: x => `#/pakbon/${x.klant_id}?maandag=${x.maandag}` },
};
function listRows() {
  const L = LISTS[list], t = q.trim().toLowerCase();
  const rows = DB[list].filter(x => !t || JSON.stringify(x).toLowerCase().includes(t));
  return rows.slice(0, 500).map(x => `<tr${L.href ? ` class="click" data-href="${h(L.href(x))}"` : ''}>${L.row(x).map((c, i) => `<td class="${L.num.includes(i) ? 'r num' : ''}">${h(String(c ?? ''))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${L.head.length}" class="empty">Niets gevonden.</td></tr>`;
}
function databasePart(d, y, jaren) {
  const L = LISTS[list];
  return `<div class="part-h"><div><h2>Database</h2><p>Alles wat de desk weet, altijd terug te halen: de grote Excel met elke regel en formules, de lijsten van planten, klanten, leveranciers, batches en facturen, het jaar in cijfers en een back-up van de hele database.</p></div>
      <div class="acts">${yearSeg(jaren, 'database')}</div></div>
    <div class="dl3">
      <a class="dlc" href="/api/week/excel?jaar=${y.jaar}" download><span>${icon('db')}</span><b>Excel ${y.jaar}</b><small>Overzicht, Inkoop, Verkoop, Batches, Leveranciers, Klanten, Planten, Koersen en Plantenpaspoorten. Met formules.</small></a>
      <a class="dlc" href="/api/week/archief.zip?jaar=${y.jaar}" download><span>${icon('file')}</span><b>Archief ${y.jaar}</b><small>Alle papieren en facturen van het jaar in mappen, als zip.</small></a>
      <a class="dlc" href="/api/week/backup.zip" download><span>${icon('shield')}</span><b>Back-up</b><small>De hele database als CSV per tabel (${h(d.grootte || '')}). Zonder wachtwoorden of sleutels.</small></a>
    </div>
    ${yearHtml(y)}
    <section class="panel"><header><h2>Lijsten</h2><span class="sub">uit de database, ${y.jaar}</span></header>
      <div class="body"><div class="tools" style="margin:0"><div class="pick" role="group" aria-label="Lijst">${Object.entries(LISTS).map(([k, x]) => `<button type="button" data-act="db-list" data-l="${k}" aria-pressed="${list === k}">${x.t}<small>${fNum(d[k].length)}</small></button>`).join('')}</div>
        <input type="search" placeholder="Zoek in ${L.t.toLowerCase()}" data-input="dq" value="${h(q)}" aria-label="Zoek in de lijst"></div></div>
      <div class="tbwrap"><table class="tb dbt"><thead id="dbh"><tr>${L.head.map((c, i) => `<th class="${L.num.includes(i) ? 'r' : ''}">${h(c)}</th>`).join('')}</tr></thead><tbody id="dbrows">${listRows()}</tbody></table></div></section>`;
}

// "1 factuur en 2 inkooporders", or only the part that is there
const pieces = list => {
  const f = list.filter(x => x.soort === 'verkoop').length, i = list.filter(x => x.soort === 'inkoop').length;
  return [f ? `${fNum(f)} ${f === 1 ? 'factuur' : 'facturen'}` : '', i ? `${fNum(i)} ${i === 1 ? 'inkooporder' : 'inkooporders'}` : ''].filter(Boolean).join(' en ');
};

// ================================================================ the page
export async function render(params, query) {
  let part = query.get('deel') || (params.pad === 'jaar' ? 'database' : 'regels');
  if (!PARTS.some(p => p[0] === part)) part = 'regels';
  cur = part;
  jaar = Number(query.get('jaar')) || new Date().getFullYear();
  const y = `jaar=${jaar}`;
  const sumP = api(`/week/controle?${y}`).catch(() => null);
  let body;
  if (part === 'regels') { const [r, s] = await Promise.all([api(`/week/controle/regels?${y}`), sumP]); body = rulesPart(r, s?.jaren); return page(part, s, body); }
  if (part === 'exact') { const [e, s] = await Promise.all([api(`/week/controle/exact?${y}`), sumP]); E = e; body = exactPart(e, s?.jaren); return page(part, s, body); }
  if (part === 'archief') { const [a, s] = await Promise.all([api(`/week/archief?${y}`), sumP]); AR = a; body = archivePart(a); return page(part, s, body); }
  const [d, yr, s] = await Promise.all([api(`/week/database?${y}`), api(`/week/jaar?${y}`), sumP]);
  DB = d;
  return page(part, s, databasePart(d, yr, s?.jaren || yr.jaren));
}
function page(part, s, body) {
  return `<div class="page wk hub">
    <div class="hub-h"><h1>Controle</h1><p>Klopt alles met de regels en staat alles goed in Exact? Met het archief van elke week en de hele database.</p></div>
    ${sliderHtml(PARTS, part, 'controle', s, lineOf)}
    <div class="hub-b" id="c-${part}">${body}</div>
  </div>`;
}
export function mount() { centerSlider(); }

export function onInput(e) {
  const k = e.target.dataset.input;
  if (k === 'dq') { q = e.target.value; const tb = document.getElementById('dbrows'); if (tb) tb.innerHTML = listRows(); }
  if (k === 'aq') { aq = e.target.value.trim().toLowerCase(); const t = document.getElementById('atree'); if (t && AR) t.innerHTML = treeHtml(AR); }
}
export function onChange() {}

export const actions = {
  'db-list': el => {
    list = el.dataset.l;
    document.querySelectorAll('[data-act="db-list"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.l === list)));
    const L = LISTS[list];
    document.getElementById('dbh').innerHTML = `<tr>${L.head.map((c, i) => `<th class="${L.num.includes(i) ? 'r' : ''}">${h(c)}</th>`).join('')}</tr>`;
    const inp = document.querySelector('[data-input="dq"]'); if (inp) inp.placeholder = `Zoek in ${L.t.toLowerCase()}`;
    document.getElementById('dbrows').innerHTML = listRows();
  },
  'x-zet': (el, ctx) => {
    const open = [...E.verkoop, ...E.inkoop].filter(x => x.status === 'open');
    dialog({
      title: 'In Exact zetten', ok: 'Zet in Exact',
      body: `<p>${pieces(open)} van ${jaar} ${open.length === 1 ? 'gaat' : 'gaan'} naar ${E.bron === 'demo' ? 'het demo-Exact' : 'Exact'}, elke regel met het batchnummer als kostendrager.</p><p class="small faint">Alles is al door jou goedgekeurd. Daarna leest de controle terug wat er in Exact staat.</p>`,
      onOk: async () => {
        const r = await api('/week/exact/zet', { method: 'POST', body: { alles: true, jaar } });
        toast(`${r.gezet} in Exact gezet${r.fouten.length ? `; ${r.fouten.length} niet: ${r.fouten[0].ref}: ${r.fouten[0].fout}` : ''}.`);
        ctx.refresh();
      },
    });
  },
  'x-lees': async (el, ctx) => { el.disabled = true; const e = await api(`/week/controle/exact?jaar=${jaar}&lezen=1`).catch(x => { el.disabled = false; throw x; }); toast(e.fout ? e.fout : 'Exact opnieuw gelezen.'); ctx.refresh(); },
  'x-import': (el, ctx) => dialog({
    title: 'Export uit Exact inlezen', ok: 'Inlezen',
    body: `<p class="small">Exporteer in Exact de verkoopboekingen (en eventueel inkoopboekingen) als Excel of CSV, met het factuurnummer of "Uw ref.", de datum, de relatie, het bedrag en de kostendrager. De desk zoekt de kolommen zelf.</p>
      <label class="f wide">Bestand<input type="file" name="bestand" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"></label>
      <p class="small faint">Ook de Excel voor Exact van de desk zelf werkt (handig om te proberen).</p>`,
    onOk: async (v, dlg) => {
      const f = dlg.querySelector('input[type=file]').files[0];
      if (!f) throw new Error('Kies een bestand.');
      const r = await api('/week/exact/import', { method: 'POST', body: { naam: f.name, data: await readFile(f) } });
      toast(`${r.boekingen} boekingen ingelezen (${r.regels} regels). Kolommen: ${Object.values(r.kolommen).slice(0, 4).join(', ')}.`);
      ctx.refresh();
    },
  }),
  'x-import-weg': async (el, ctx) => { await api('/week/exact/import', { method: 'DELETE' }); toast('Export weggehaald.'); ctx.refresh(); },
};
