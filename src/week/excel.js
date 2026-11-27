// The year in one Excel file, straight from the database: every purchase line, every sales line, every batch and
// whether it nets out to zero. Totals are formulas, so Jan can check the desk and Exact himself; the computed
// values are stored next to them, so the file also reads right in a preview.
import ExcelJS from 'exceljs';
import { rows, one } from '../db.js';
import { company } from './model.js';
import { isoWeek, passed, r2, r4 } from './util.js';
import { supplierStats } from './partners.js';
import { routeOf, routeText } from './risk.js';

const FONT = { name: 'Arial', size: 10 };
const HEAD = { font: { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5138' } }, alignment: { vertical: 'middle', wrapText: true } };
const NUM = { int: '#,##0', eur: '€ #,##0.00', eur4: '€ 0.0000', usd: '$ #,##0.00', usd4: '$ 0.0000', koers: '0.0000', date: 'dd-mm-yyyy', pct: '0%', pct1: '0.0%' };
const xd = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const f = (formula, result) => ({ formula, result });
// a moment as Jan reads it in Nootdorp (Excel has no time zones)
const xdt = v => { const d = new Date(v); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes())); };
// the row order of the sheets; the desk uses the same order to say on which row a shipment stands
export const ORDER = { inkoop: 'p.maandag, p.nummer, d.volgorde, d.code, r.id', partijen: 'p.maandag, p.nummer', verkoop: 's.maandag, s.nummer, r.regelnr', leveranciers: 'l.naam, l.id' };
const serial = s => (s ? Date.UTC(...String(s).slice(0, 10).split('-').map((v, i) => Number(v) - (i === 1 ? 1 : 0))) / 864e5 + 25569 : '');

function sheet(wb, name, cols, { freeze = 1 } = {}) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: freeze, xSplit: 0 }] });
  ws.columns = cols.map(c => ({ header: c.h, key: c.k, width: c.w || 12, style: { font: FONT, numFmt: c.fmt, alignment: c.right ? { horizontal: 'right' } : undefined } }));
  const head = ws.getRow(1);
  head.height = 30;
  head.eachCell(cell => { cell.font = HEAD.font; cell.fill = HEAD.fill; cell.alignment = HEAD.alignment; });
  return ws;
}
const colLetter = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

export async function yearWorkbook(jaar, { now = new Date() } = {}) {
  const a = `${jaar}-01-01`, b = `${jaar}-12-31`;
  const co = await company();
  const inkoop = await rows(`SELECT p.maandag, p.nummer, p.regio, p.awb, p.exact, p.exact_nummer, p.bevestigd_op, p.verzonden_op, l.naam AS leverancier, l.exact_code AS crediteur,
      d.code, d.exact_code, d.naam, d.soort, d.maat, r.per_doos, r.besteld, r.bevestigd, r.verzonden, r.geteld, r.uitval, r.prijs_usd, w.koers
    FROM partijen p JOIN partij_regels r ON r.partij_id = p.id JOIN leveranciers l ON l.id = p.leverancier_id JOIN producten d ON d.id = r.product_id JOIN weken w ON w.maandag = p.maandag
    WHERE p.maandag BETWEEN $1 AND $2 ORDER BY ${ORDER.inkoop}`, [a, b]);
  const verkoop = await rows(`SELECT s.id AS pakbon_id, s.maandag, s.nummer, s.datum, s.exact, s.btw_pct, s.koers, k.naam AS klant, k.land, k.exact_code AS debiteur,
      d.code, d.exact_code, d.naam, d.soort, d.maat, r.regelnr, r.partij, p.regio, r.dozen, r.stuks, r.prijs_usd, r.prijs_eur, r.bedrag,
      (SELECT c.status FROM concepten c WHERE c.pakbon_id = s.id AND c.status <> 'vervallen' LIMIT 1) AS mail
    FROM pakbonnen s JOIN pakbon_regels r ON r.pakbon_id = s.id JOIN klanten k ON k.id = s.klant_id JOIN producten d ON d.id = r.product_id
    LEFT JOIN partijen p ON p.nummer = r.partij
    WHERE s.status = 'akkoord' AND s.maandag BETWEEN $1 AND $2 ORDER BY ${ORDER.verkoop}`, [a, b]);
  const partijen = await rows(`SELECT p.nummer, p.regio, p.maandag, p.binnen_op, p.route, l.route AS lev_route, l.naam AS leverancier, w.geteld_op IS NOT NULL AS geteld
    FROM partijen p JOIN leveranciers l ON l.id = p.leverancier_id JOIN weken w ON w.maandag = p.maandag WHERE p.maandag BETWEEN $1 AND $2 ORDER BY ${ORDER.partijen}`, [a, b]);
  const leveranciers = await rows(`SELECT l.id, l.naam, l.regio, l.exact_code, l.route FROM leveranciers l ORDER BY ${ORDER.leveranciers}`);
  const scores = await supplierStats().catch(() => []);
  const weken = await rows(`SELECT w.maandag, w.koers, w.koers_door, w.koers_op FROM weken w WHERE w.maandag BETWEEN $1 AND $2 AND EXISTS (SELECT 1 FROM partijen p WHERE p.maandag = w.maandag) ORDER BY w.maandag`, [a, b]);
  const klanten = await rows(`SELECT k.naam, k.land, k.exact_code, coalesce(k.factuur_email, k.email) AS mail, k.telefoon FROM klanten k ORDER BY k.naam`);
  const regios = await rows('SELECT code, naam, land FROM regios ORDER BY code');
  const paspoort = await rows(`SELECT DISTINCT s.nummer, s.datum, k.naam AS klant, d.soort, r.partij, g.land AS herkomst
    FROM pakbonnen s JOIN pakbon_regels r ON r.pakbon_id = s.id JOIN klanten k ON k.id = s.klant_id JOIN producten d ON d.id = r.product_id
    LEFT JOIN partijen p ON p.nummer = r.partij LEFT JOIN regios g ON g.code = p.regio
    WHERE s.status = 'akkoord' AND s.maandag BETWEEN $1 AND $2 ORDER BY s.nummer, r.partij, d.soort`, [a, b]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Campo desk';
  wb.created = now;
  wb.calcProperties.fullCalcOnLoad = true;
  const ov = wb.addWorksheet('Overzicht');
  const stamp = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(now);

  // ---------- Inkoop: one row per product per shipment
  const wsI = sheet(wb, 'Inkoop', [
    { h: 'Week', k: 'week', w: 7, fmt: '0' }, { h: 'Aankomst', k: 'maandag', w: 11, fmt: NUM.date }, { h: 'Zendnummer (C)', k: 'nummer', w: 13 }, { h: 'Regio', k: 'regio', w: 7 },
    { h: 'Leverancier', k: 'leverancier', w: 26 }, { h: 'Crediteur Exact', k: 'crediteur', w: 10 }, { h: 'Artikel', k: 'artikel', w: 9 }, { h: 'Product', k: 'product', w: 18 },
    { h: 'Botanische naam (A)', k: 'soort', w: 20 }, { h: 'Maat', k: 'maat', w: 8 }, { h: 'Per doos', k: 'per', w: 8, fmt: NUM.int },
    { h: 'Besteld (dozen)', k: 'besteld', w: 9, fmt: NUM.int }, { h: 'Bevestigd', k: 'bevestigd', w: 9, fmt: NUM.int }, { h: 'Verzonden', k: 'verzonden', w: 9, fmt: NUM.int },
    { h: 'Geteld', k: 'geteld', w: 8, fmt: NUM.int }, { h: 'Uitval', k: 'uitval', w: 7, fmt: NUM.int }, { h: 'Dozen in', k: 'dozen', w: 8, fmt: NUM.int }, { h: 'Stuks (verzendbewijs)', k: 'stuks', w: 11, fmt: NUM.int },
    { h: 'Prijs $/st', k: 'prijs', w: 9, fmt: NUM.usd4 }, { h: 'Bedrag $', k: 'usd', w: 11, fmt: NUM.usd }, { h: 'Koers ($ per €)', k: 'koers', w: 9, fmt: NUM.koers },
    { h: 'Bedrag €', k: 'eur', w: 11, fmt: NUM.eur }, { h: 'AWB', k: 'awb', w: 15 }, { h: 'In Exact', k: 'exact', w: 8 }, { h: 'Inkooporder Exact', k: 'exnr', w: 12 },
  ]);
  const inkoopRows = [];
  inkoop.forEach((x, i) => {
    const n = i + 2;
    const bev = passed(x.bevestigd_op, now) ? x.bevestigd : null, verz = passed(x.verzonden_op, now) ? x.verzonden : null;
    // in the hall: what was counted; on the invoice of the supplier: what flew (the shipping papers)
    const dozen = x.geteld ?? verz ?? bev ?? x.besteld ?? 0, stuks = (verz ?? bev ?? x.besteld ?? 0) * x.per_doos, usd = r2(stuks * Number(x.prijs_usd));
    const eur = x.koers ? r2(usd / Number(x.koers)) : '';
    inkoopRows.push({ maandag: x.maandag, nummer: x.nummer, regio: x.regio, leverancier: x.leverancier, dozen, uitval: x.uitval, eur: eur === '' ? 0 : eur, usd, besteld: x.besteld, bev, verz, geteld: x.geteld });
    wsI.addRow({
      week: isoWeek(x.maandag).week, maandag: xd(x.maandag), nummer: x.nummer, regio: x.regio, leverancier: x.leverancier, crediteur: x.crediteur, artikel: x.exact_code || x.code,
      product: x.naam, soort: x.soort, maat: x.maat, per: x.per_doos, besteld: x.besteld, bevestigd: bev, verzonden: verz, geteld: x.geteld, uitval: x.uitval,
      dozen: f(`IF(O${n}<>"",O${n},IF(N${n}<>"",N${n},IF(M${n}<>"",M${n},L${n})))`, dozen), stuks: f(`IF(N${n}<>"",N${n},IF(M${n}<>"",M${n},L${n}))*K${n}`, stuks), prijs: Number(x.prijs_usd),
      usd: f(`ROUND(R${n}*S${n},2)`, usd), koers: x.koers ? Number(x.koers) : null, eur: f(`IF(U${n}="","",ROUND(T${n}/U${n},2))`, eur),
      awb: x.awb, exact: x.exact === 'in_exact' ? 'ja' : 'nee', exnr: x.exact_nummer,
    });
  });
  const nI = inkoop.length + 1;
  wsI.autoFilter = { from: 'A1', to: `Y${Math.max(2, nI)}` };

  // ---------- Verkoop: one row per line on a packing slip (the slip is the invoice)
  const wsV = sheet(wb, 'Verkoop', [
    { h: 'Week', k: 'week', w: 7, fmt: '0' }, { h: 'Maandag', k: 'maandag', w: 11, fmt: NUM.date }, { h: 'Factuur', k: 'nummer', w: 9 }, { h: 'Datum', k: 'datum', w: 11, fmt: NUM.date },
    { h: 'Klant', k: 'klant', w: 28 }, { h: 'Land', k: 'land', w: 6 }, { h: 'Debiteur Exact', k: 'debiteur', w: 10 }, { h: 'Artikel', k: 'artikel', w: 9 }, { h: 'Product', k: 'product', w: 18 },
    { h: 'Botanische naam (A)', k: 'soort', w: 20 }, { h: 'Maat', k: 'maat', w: 8 }, { h: 'Partij (C) = kostendrager', k: 'partij', w: 13 }, { h: 'Regio', k: 'regio', w: 7 },
    { h: 'Dozen', k: 'dozen', w: 7, fmt: NUM.int }, { h: 'Stuks', k: 'stuks', w: 9, fmt: NUM.int }, { h: 'Prijs $/st', k: 'usd', w: 9, fmt: NUM.usd4 }, { h: 'Koers ($ per €)', k: 'koers', w: 9, fmt: NUM.koers },
    { h: 'Prijs €/st', k: 'eur', w: 9, fmt: NUM.eur4 }, { h: 'Bedrag €', k: 'bedrag', w: 11, fmt: NUM.eur }, { h: 'Btw', k: 'btw', w: 6, fmt: NUM.pct }, { h: 'Btw €', k: 'btwe', w: 9, fmt: NUM.eur },
    { h: 'In Exact', k: 'exact', w: 8 }, { h: 'Verstuurd', k: 'mail', w: 14 }, { h: 'Regel', k: 'regel', w: 6, fmt: '0' },
  ]);
  const verkoopRows = [];
  verkoop.forEach((x, i) => {
    const n = i + 2, btw = Number(x.btw_pct) / 100, bedrag = Number(x.bedrag);
    verkoopRows.push({ maandag: x.maandag, klant: x.klant, partij: x.partij, dozen: x.dozen, bedrag, regel: x.regelnr });
    wsV.addRow({
      week: isoWeek(x.maandag).week, maandag: xd(x.maandag), nummer: x.nummer, datum: xd(x.datum), klant: x.klant, land: x.land, debiteur: x.debiteur, artikel: x.exact_code || x.code,
      product: x.naam, soort: x.soort, maat: x.maat, partij: x.partij, regio: x.regio, dozen: x.dozen, stuks: x.stuks, usd: Number(x.prijs_usd), koers: Number(x.koers),
      eur: f(`ROUND(P${n}/Q${n},4)`, Number(x.prijs_eur)), bedrag: f(`ROUND(O${n}*R${n},2)`, bedrag), btw, btwe: f(`ROUND(S${n}*T${n},2)`, r2(bedrag * btw)),
      exact: x.exact === 'in_exact' ? 'ja' : 'nee', mail: x.mail === 'verstuurd' ? 'per mail' : x.mail === 'in_outlook' ? 'in Outlook' : x.mail === 'concept' ? 'concept' : 'met de goederen', regel: x.regelnr,
    });
  });
  const nV = verkoop.length + 1;
  wsV.autoFilter = { from: 'A1', to: `X${Math.max(2, nV)}` };

  // ---------- Partijen: in, out and what is left of every batch number
  const wsP = sheet(wb, 'Partijen', [
    { h: 'Zendnummer (C)', k: 'nummer', w: 13 }, { h: 'Regio', k: 'regio', w: 7 }, { h: 'Week', k: 'week', w: 7, fmt: '0' }, { h: 'Aankomst', k: 'maandag', w: 11, fmt: NUM.date },
    { h: 'Leverancier', k: 'leverancier', w: 26 }, { h: 'Dozen in', k: 'in', w: 9, fmt: NUM.int }, { h: 'Uitval', k: 'uitval', w: 8, fmt: NUM.int }, { h: 'Dozen uit', k: 'uit', w: 9, fmt: NUM.int },
    { h: 'Rest', k: 'rest', w: 8, fmt: NUM.int }, { h: 'Stand', k: 'stand', w: 16 }, { h: 'Geteld', k: 'geteld', w: 8 },
    { h: 'Route', k: 'route', w: 26 }, { h: 'In de loods', k: 'binnen', w: 16, fmt: 'dd-mm-yyyy hh:mm' }, { h: 'Op tijd (voor maandag 12:00)', k: 'optijd', w: 11 },
  ]);
  const I = c => `Inkoop!$${c}$2:$${c}$${Math.max(2, nI)}`, V = c => `Verkoop!$${c}$2:$${c}$${Math.max(2, nV)}`;
  const partRows = [];
  partijen.forEach((p, i) => {
    const n = i + 2;
    const inn = inkoopRows.filter(x => x.nummer === p.nummer).reduce((s, x) => s + x.dozen, 0), uitval = inkoopRows.filter(x => x.nummer === p.nummer).reduce((s, x) => s + x.uitval, 0);
    const uit = verkoopRows.filter(x => x.partij === p.nummer).reduce((s, x) => s + x.dozen, 0), rest = inn - uitval - uit;
    const stand = !p.geteld ? 'loopt nog' : rest === 0 ? 'netto nul' : rest > 0 ? 'over in de loods' : 'meer uit dan in';
    const binnen = passed(p.binnen_op, now) ? new Date(p.binnen_op) : null;
    const opTijd = binnen ? (binnen.getTime() <= new Date(`${String(p.maandag).slice(0, 10)}T12:00:00`).getTime() ? 'ja' : 'nee') : '';
    partRows.push({ ...p, in: inn, uitval, uit, rest, opTijd });
    wsP.addRow({
      nummer: p.nummer, regio: p.regio, week: isoWeek(p.maandag).week, maandag: xd(p.maandag), leverancier: p.leverancier,
      in: f(`SUMIFS(${I('Q')},${I('C')},A${n})`, inn), uitval: f(`SUMIFS(${I('P')},${I('C')},A${n})`, uitval), uit: f(`SUMIFS(${V('N')},${V('L')},A${n})`, uit),
      rest: f(`F${n}-G${n}-H${n}`, rest), stand: f(`IF(K${n}="nee","loopt nog",IF(I${n}=0,"netto nul",IF(I${n}>0,"over in de loods","meer uit dan in")))`, stand), geteld: p.geteld ? 'ja' : 'nee',
      route: routeText([...routeOf(p), 'Nootdorp']), binnen: binnen ? xdt(binnen) : null, optijd: f(`IF(M${n}="","",IF(M${n}<=D${n}+0.5,"ja","nee"))`, opTijd),
    });
  });
  const nP = partijen.length + 1;
  wsP.autoFilter = { from: 'A1', to: `N${Math.max(2, nP)}` };
  if (partijen.length) wsP.addConditionalFormatting({ ref: `A2:K${nP}`, rules: [{ type: 'expression', formulae: [`AND($K2="ja",$I2<>0)`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF3E3DC' } }, font: { color: { argb: 'FF8A3D2A' }, bold: true } } }] });

  // ---------- Leveranciers: how each one delivers, as formulas on Inkoop and Partijen
  const wsL = sheet(wb, 'Leveranciers', [
    { h: 'Leverancier', k: 'naam', w: 28 }, { h: 'Regio', k: 'regio', w: 7 }, { h: 'Route', k: 'route', w: 26 }, { h: 'Crediteur Exact', k: 'exact', w: 10 }, { h: 'Zendingen', k: 'zend', w: 9, fmt: NUM.int },
    { h: 'Besteld (dozen)', k: 'besteld', w: 10, fmt: NUM.int }, { h: 'Bevestigd', k: 'bev', w: 10, fmt: NUM.int }, { h: 'Verzonden', k: 'verz', w: 10, fmt: NUM.int }, { h: 'Geteld', k: 'geteld', w: 9, fmt: NUM.int },
    { h: 'Uitval', k: 'uitval', w: 8, fmt: NUM.int }, { h: 'Bevestigd / besteld', k: 'r1', w: 10, fmt: NUM.pct1 }, { h: 'Verzonden / bevestigd', k: 'r2', w: 10, fmt: NUM.pct1 },
    { h: 'Geteld / verzonden', k: 'r3', w: 10, fmt: NUM.pct1 }, { h: 'Uitval / geteld', k: 'r4', w: 9, fmt: NUM.pct1 }, { h: 'Op tijd in de loods', k: 'optijd', w: 10, fmt: NUM.pct },
    { h: 'Inkoop $', k: 'usd', w: 12, fmt: NUM.usd }, { h: 'Score desk (laatste half jaar)', k: 'score', w: 11, fmt: '0' },
  ]);
  const PP = c => `Partijen!$${c}$2:$${c}$${Math.max(2, nP)}`;
  leveranciers.forEach((l, i) => {
    const n = i + 2, mine = inkoopRows.filter(x => x.leverancier === l.naam), pm = partRows.filter(x => x.leverancier === l.naam);
    const s_ = (rowsX, k) => rowsX.reduce((t, x) => t + (Number(x[k]) || 0), 0);
    const withBev = mine.filter(x => x.bev != null), withVerz = mine.filter(x => x.verz != null), withGet = mine.filter(x => x.geteld != null);
    const ratio = (num, den) => (den ? num / den : '');
    const ja = pm.filter(x => x.opTijd === 'ja').length, nee = pm.filter(x => x.opTijd === 'nee').length;
    const sc = scores.find(x => x.id === l.id);
    const cond = c => `${I('E')},A${n},${I(c)},">=0"`;
    wsL.addRow({
      naam: l.naam, regio: l.regio, route: routeText([...routeOf({ route: l.route, regio: l.regio }), 'Nootdorp']), exact: l.exact_code,
      zend: f(`COUNTIFS(${PP('E')},A${n})`, pm.length),
      besteld: f(`SUMIFS(${I('L')},${I('E')},A${n})`, s_(mine, 'besteld')), bev: f(`SUMIFS(${I('M')},${I('E')},A${n})`, s_(withBev, 'bev')),
      verz: f(`SUMIFS(${I('N')},${I('E')},A${n})`, s_(withVerz, 'verz')), geteld: f(`SUMIFS(${I('O')},${I('E')},A${n})`, s_(withGet, 'geteld')), uitval: f(`SUMIFS(${I('P')},${I('E')},A${n})`, s_(mine, 'uitval')),
      r1: f(`IFERROR(SUMIFS(${I('M')},${cond('M')})/SUMIFS(${I('L')},${cond('M')}),"")`, ratio(s_(withBev, 'bev'), s_(withBev, 'besteld'))),
      r2: f(`IFERROR(SUMIFS(${I('N')},${cond('N')})/SUMIFS(${I('M')},${cond('N')}),"")`, ratio(s_(withVerz, 'verz'), s_(withVerz, 'bev'))),
      r3: f(`IFERROR(SUMIFS(${I('O')},${cond('O')})/SUMIFS(${I('N')},${cond('O')}),"")`, ratio(s_(withGet, 'geteld'), s_(withGet, 'verz'))),
      r4: f(`IFERROR(SUMIFS(${I('P')},${cond('O')})/SUMIFS(${I('O')},${cond('O')}),"")`, ratio(s_(withGet, 'uitval'), s_(withGet, 'geteld'))),
      optijd: f(`IFERROR(COUNTIFS(${PP('E')},A${n},${PP('N')},"ja")/(COUNTIFS(${PP('E')},A${n},${PP('N')},"ja")+COUNTIFS(${PP('E')},A${n},${PP('N')},"nee")),"")`, ja + nee ? ja / (ja + nee) : ''),
      usd: f(`SUMIFS(${I('T')},${I('E')},A${n})`, r2(s_(mine, 'usd'))), score: sc && sc.score != null ? sc.score : null,
    });
  });
  wsL.autoFilter = { from: 'A1', to: `Q${Math.max(2, leveranciers.length + 1)}` };

  // ---------- Klanten
  const wsK = sheet(wb, 'Klanten', [
    { h: 'Klant', k: 'naam', w: 30 }, { h: 'Land', k: 'land', w: 6 }, { h: 'Debiteur Exact', k: 'exact', w: 10 }, { h: 'Factuurmail', k: 'mail', w: 32 }, { h: 'Telefoon', k: 'tel', w: 17 },
    { h: 'Omzet € (excl. btw)', k: 'omzet', w: 14, fmt: NUM.eur }, { h: 'Dozen', k: 'dozen', w: 9, fmt: NUM.int }, { h: 'Facturen', k: 'facturen', w: 9, fmt: NUM.int }, { h: 'Laatste levering', k: 'laatst', w: 12, fmt: NUM.date },
  ]);
  klanten.forEach((k, i) => {
    const n = i + 2, mine = verkoopRows.filter(x => x.klant === k.naam);
    const last = mine.reduce((m, x) => (x.maandag > m ? x.maandag : m), '');
    wsK.addRow({
      naam: k.naam, land: k.land, exact: k.exact_code, mail: k.mail, tel: k.telefoon,
      omzet: f(`SUMIFS(${V('S')},${V('E')},A${n})`, r2(mine.reduce((s, x) => s + x.bedrag, 0))), dozen: f(`SUMIFS(${V('N')},${V('E')},A${n})`, mine.reduce((s, x) => s + x.dozen, 0)),
      facturen: f(`COUNTIFS(${V('E')},A${n},${V('X')},1)`, mine.filter(x => x.regel === 1).length),
      laatst: f(`IF(COUNTIF(${V('E')},A${n})=0,"",_xlfn.MAXIFS(${V('B')},${V('E')},A${n}))`, serial(last)),
    });
  });
  const nK = klanten.length + 1;
  wsK.autoFilter = { from: 'A1', to: `I${Math.max(2, nK)}` };

  // ---------- Koersen
  const wsR = sheet(wb, 'Koersen', [{ h: 'Week', k: 'week', w: 7, fmt: '0' }, { h: 'Maandag', k: 'maandag', w: 11, fmt: NUM.date }, { h: 'Dollar voor 1 euro', k: 'koers', w: 12, fmt: NUM.koers },
    { h: 'Euro voor 1 dollar', k: 'inv', w: 12, fmt: '0.00000' }, { h: 'Vastgezet door', k: 'door', w: 12 }]);
  weken.forEach((w, i) => {
    const n = i + 2;
    wsR.addRow({ week: isoWeek(w.maandag).week, maandag: xd(w.maandag), koers: w.koers ? Number(w.koers) : null, inv: f(`IF(C${n}="","",ROUND(1/C${n},5))`, w.koers ? Math.round(100000 / Number(w.koers)) / 100000 : ''), door: w.koers_door });
  });

  // ---------- Plantenpaspoorten
  const wsS = sheet(wb, 'Plantenpaspoorten', [{ h: 'Factuur', k: 'nummer', w: 9 }, { h: 'Datum', k: 'datum', w: 11, fmt: NUM.date }, { h: 'Klant', k: 'klant', w: 30 },
    { h: 'A  Botanische naam', k: 'a', w: 22 }, { h: 'B  Registratie', k: 'b', w: 14 }, { h: 'C  Partij', k: 'c', w: 12 }, { h: 'D  Herkomst', k: 'd', w: 10 }]);
  for (const p of paspoort) wsS.addRow({ nummer: p.nummer, datum: xd(p.datum), klant: p.klant, a: p.soort, b: co.pp_b, c: p.partij, d: p.herkomst });
  wsS.autoFilter = { from: 'A1', to: `G${Math.max(2, paspoort.length + 1)}` };

  // ---------- Overzicht: the first sheet, filled last
  ov.columns = [{ width: 24 }, { width: 12 }, { width: 13 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 10 }];
  const put = (addr, v, o = {}) => { const c = ov.getCell(addr); c.value = v; c.font = { ...FONT, ...(o.font || {}) }; if (o.fmt) c.numFmt = o.fmt; if (o.fill) c.fill = o.fill; if (o.align) c.alignment = o.align; return c; };
  put('A1', `${co.naam} · jaaroverzicht ${jaar}`, { font: { size: 14, bold: true, color: { argb: 'FF10291E' } } });
  put('A2', `Stand van ${stamp}, rechtstreeks uit de Campo desk. Download opnieuw voor de stand van dat moment.`, { font: { color: { argb: 'FF5F6963' } } });
  const sumI = c => `SUM(${I(c)})`, sumV = c => `SUM(${V(c)})`;
  const tot = { in: inkoopRows.reduce((s, x) => s + x.dozen, 0), uit: verkoopRows.reduce((s, x) => s + x.dozen, 0), omzet: r2(verkoopRows.reduce((s, x) => s + x.bedrag, 0)), inkoop: r2(inkoopRows.reduce((s, x) => s + x.eur, 0)) };
  const kpis = [
    ['Zendingen', f(`COUNTA(Partijen!$A$2:$A$${Math.max(2, nP)})`, partijen.length), NUM.int],
    ['Dozen binnen', f(sumI('Q'), tot.in), NUM.int],
    ['Dozen naar klanten', f(sumV('N'), tot.uit), NUM.int],
    ['Omzet € (excl. btw)', f(sumV('S'), tot.omzet), NUM.eur],
    ['Inkoop €', f(sumI('V'), tot.inkoop), NUM.eur],
    ['Brutomarge €', f('B7-B8', r2(tot.omzet - tot.inkoop)), NUM.eur],
    ['Klanten met een factuur', f(`COUNTIF(Klanten!$F$2:$F$${Math.max(2, nK)},">0")`, klanten.filter(k => verkoopRows.some(x => x.klant === k.naam)).length), NUM.int],
    ['Facturen', f(`COUNTIF(${V('X')},1)`, verkoopRows.filter(x => x.regel === 1).length), NUM.int],
  ];
  kpis.forEach(([l, v, fmt], i) => { put(`A${4 + i}`, l, { font: { bold: true } }); put(`B${4 + i}`, v, { fmt }); });
  // the rows above: A4 Zendingen, A5 Dozen binnen, A6 Dozen naar klanten, A7 Omzet, A8 Inkoop, A9 Marge
  put('D4', 'Dollarkoers: dollars voor één euro, door Jan op maandag vastgezet. Een dollarprijs gedeeld door de koers is de europrijs.', { font: { color: { argb: 'FF5F6963' } } });
  put('D5', 'Inkoop: wat op het verzendbewijs staat, in euro alleen voor weken met een koers. Rest per partij: dozen in min uitval min dozen naar klanten; 0 is netto nul.', { font: { color: { argb: 'FF5F6963' } } });
  put('D6', `Plantenpaspoort: A botanische naam, B ${co.pp_b}${co.pp_b_voorbeeld ? ' (voorbeeldnummer)' : ''}, C partij, D land van herkomst.`, { font: { color: { argb: 'FF5F6963' } } });

  let r0 = 14;
  put(`A${r0 - 1}`, 'Per regio (alleen getelde weken)', { font: { bold: true, size: 11 } });
  ['Regio', 'Zendingen', 'Dozen in', 'Uitval', 'Dozen uit', 'Rest'].forEach((h, i) => put(`${colLetter(i + 1)}${r0}`, h, { font: HEAD.font, fill: HEAD.fill }));
  const P = c => `Partijen!$${c}$2:$${c}$${Math.max(2, nP)}`;
  regios.forEach((g, i) => {
    const n = r0 + 1 + i, mine = partRows.filter(x => x.regio === g.code && x.geteld);
    put(`A${n}`, `${g.code} · ${g.naam}`);
    put(`B${n}`, f(`COUNTIFS(${P('B')},"${g.code}",${P('K')},"ja")`, mine.length), { fmt: NUM.int });
    put(`C${n}`, f(`SUMIFS(${P('F')},${P('B')},"${g.code}",${P('K')},"ja")`, mine.reduce((s, x) => s + x.in, 0)), { fmt: NUM.int });
    put(`D${n}`, f(`SUMIFS(${P('G')},${P('B')},"${g.code}",${P('K')},"ja")`, mine.reduce((s, x) => s + x.uitval, 0)), { fmt: NUM.int });
    put(`E${n}`, f(`SUMIFS(${P('H')},${P('B')},"${g.code}",${P('K')},"ja")`, mine.reduce((s, x) => s + x.uit, 0)), { fmt: NUM.int });
    put(`F${n}`, f(`C${n}-D${n}-E${n}`, mine.reduce((s, x) => s + x.rest, 0)), { fmt: NUM.int, font: { bold: true } });
  });
  r0 += regios.length + 3;
  put(`A${r0 - 1}`, 'Per week', { font: { bold: true, size: 11 } });
  ['Week', 'Maandag', 'Koers', 'Zendingen', 'Dozen in', 'Dozen uit', 'Inkoop €', 'Omzet €', 'Marge €', 'Marge'].forEach((h, i) => put(`${colLetter(i + 1)}${r0}`, h, { font: HEAD.font, fill: HEAD.fill }));
  weken.forEach((w, i) => {
    const n = r0 + 1 + i, m = w.maandag;
    const zi = partRows.filter(x => x.maandag === m).length, di = inkoopRows.filter(x => x.maandag === m).reduce((s, x) => s + x.dozen, 0), du = verkoopRows.filter(x => x.maandag === m).reduce((s, x) => s + x.dozen, 0);
    const ink = r2(inkoopRows.filter(x => x.maandag === m).reduce((s, x) => s + x.eur, 0)), om = r2(verkoopRows.filter(x => x.maandag === m).reduce((s, x) => s + x.bedrag, 0));
    put(`A${n}`, isoWeek(m).week, { fmt: '0' }); put(`B${n}`, xd(m), { fmt: NUM.date }); put(`C${n}`, w.koers ? Number(w.koers) : null, { fmt: NUM.koers });
    put(`D${n}`, f(`COUNTIFS(${P('D')},B${n})`, zi), { fmt: NUM.int });
    put(`E${n}`, f(`SUMIFS(${I('Q')},${I('B')},B${n})`, di), { fmt: NUM.int });
    put(`F${n}`, f(`SUMIFS(${V('N')},${V('B')},B${n})`, du), { fmt: NUM.int });
    put(`G${n}`, f(`SUMIFS(${I('V')},${I('B')},B${n})`, ink), { fmt: NUM.eur });
    put(`H${n}`, f(`SUMIFS(${V('S')},${V('B')},B${n})`, om), { fmt: NUM.eur });
    put(`I${n}`, f(`IF(H${n}=0,"",H${n}-G${n})`, om ? r2(om - ink) : ''), { fmt: NUM.eur });
    put(`J${n}`, f(`IF(OR(H${n}=0,I${n}=""),"",I${n}/H${n})`, om ? (om - ink) / om : ''), { fmt: NUM.pct1 });
  });
  ov.views = [{ state: 'frozen', ySplit: 2 }];

  // ---------- Uitleg
  const wsU = wb.addWorksheet('Uitleg');
  wsU.columns = [{ width: 22 }, { width: 110 }];
  [['Blad', 'Wat erin staat'],
    ['Overzicht', 'De totalen van het jaar, per regio en per week. Alles zijn formules op de andere bladen.'],
    ['Inkoop', 'Elke regel van elke zending: besteld (dinsdag), bevestigd (donderdag), verzonden (verzendbewijs, vrijdag), geteld (maandag). Dozen in = geteld, anders het laatst bekende aantal.'],
    ['Verkoop', 'Elke regel van elke pakbon. De pakbon is ook de factuur. Prijs €/st = prijs $/st gedeeld door de koers van die week, afgerond op 4 decimalen; bedrag = stuks × prijs €/st.'],
    ['Partijen', 'Per zendnummer (C op het plantenpaspoort, kostendrager in Exact): dozen in, uitval, dozen naar klanten en de rest. Rood = een getelde partij die niet op nul uitkomt. Met de route en of het voor maandag 12:00 in de loods stond.'],
    ['Leveranciers', 'Per leverancier: besteld, bevestigd, verzonden en geteld, hoeveel daarvan klopte en hoe vaak het op tijd binnen was. Formules op Inkoop en Partijen; de score is hoe de desk hem over het laatste halfjaar rekent.'],
    ['Klanten', 'Omzet, dozen en facturen per klant in dit jaar.'],
    ['Koersen', 'De dollarkoers per week, zoals Jan hem op maandag vastzette.'],
    ['Plantenpaspoorten', 'Welk paspoort (A, B, C, D) op welke factuur stond.'],
    ['Stand', `Gemaakt ${stamp}. De desk maakt dit bestand bij elke download opnieuw uit de database.`],
  ].forEach((row, i) => { const r = wsU.addRow(row); r.font = i ? FONT : HEAD.font; if (!i) r.eachCell(c => { c.fill = HEAD.fill; }); r.alignment = { wrapText: true, vertical: 'top' }; });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// where one shipment stands in the workbook of its year: the same order as the sheets above
export async function sheetRows(partijId) {
  const p = await one('SELECT id, nummer, maandag, leverancier_id FROM partijen WHERE id = $1', [partijId]);
  if (!p) return null;
  const jaar = Number(String(p.maandag).slice(0, 4)), a = `${jaar}-01-01`, b = `${jaar}-12-31`;
  const [ink, par, lev, ver] = await Promise.all([
    rows(`SELECT * FROM (SELECT r.id AS regel_id, p.id AS partij_id, row_number() OVER (ORDER BY ${ORDER.inkoop}) + 1 AS rij
        FROM partijen p JOIN partij_regels r ON r.partij_id = p.id JOIN leveranciers l ON l.id = p.leverancier_id JOIN producten d ON d.id = r.product_id JOIN weken w ON w.maandag = p.maandag
        WHERE p.maandag BETWEEN $1 AND $2) x WHERE partij_id = $3 ORDER BY rij`, [a, b, partijId]),
    one(`SELECT rij FROM (SELECT p.id, row_number() OVER (ORDER BY ${ORDER.partijen}) + 1 AS rij FROM partijen p JOIN leveranciers l ON l.id = p.leverancier_id JOIN weken w ON w.maandag = p.maandag
        WHERE p.maandag BETWEEN $1 AND $2) x WHERE id = $3`, [a, b, partijId]),
    one(`SELECT rij FROM (SELECT l.id, row_number() OVER (ORDER BY ${ORDER.leveranciers}) + 1 AS rij FROM leveranciers l) x WHERE id = $1`, [p.leverancier_id]),
    rows(`SELECT * FROM (SELECT s.nummer AS factuur, k.naam AS klant, r.partij, r.dozen, row_number() OVER (ORDER BY ${ORDER.verkoop}) + 1 AS rij
        FROM pakbonnen s JOIN pakbon_regels r ON r.pakbon_id = s.id JOIN klanten k ON k.id = s.klant_id JOIN producten d ON d.id = r.product_id
        WHERE s.status = 'akkoord' AND s.maandag BETWEEN $1 AND $2) x WHERE partij = $3 ORDER BY rij`, [a, b, p.nummer]),
  ]);
  return { jaar, inkoop: ink.map(x => Number(x.rij)), regels: Object.fromEntries(ink.map(x => [x.regel_id, Number(x.rij)])), partijen: par ? Number(par.rij) : null, leveranciers: lev ? Number(lev.rij) : null,
    verkoop: ver.map(x => ({ ...x, rij: Number(x.rij) })) };
}
