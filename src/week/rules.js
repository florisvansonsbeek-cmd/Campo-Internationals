// What is not allowed and what is, for a plant importer that sells to growers in the Netherlands and the rest of Europe,
// and per rule whether the desk's own data keeps to it. The rules come from the law (the Belastingdienst's invoice
// requirements, the EU plant health rules) and from the way Campo works. The desk checks what it can see; for the rest
// it says so. It only reads: fixing is done where the link points.
import { rows, one } from '../db.js';
import { company } from './model.js';
import { isoWeek, today, addDays, EU } from './util.js';

const nl = new Intl.NumberFormat('nl-NL');
const n = (x, een, meer) => `${nl.format(x)} ${x === 1 ? een : meer}`;
const few = (list, f, max = 4) => `${list.slice(0, max).map(f).join(', ')}${list.length > max ? ` en nog ${list.length - max}` : ''}`;

export async function rules({ jaar = Number(today().slice(0, 4)) } = {}) {
  const van = `${jaar}-01-01`, tot = `${jaar}-12-31`;
  const co = await company();
  const slips = await rows(`SELECT s.id, s.nummer, s.maandag, s.datum, s.btw_pct, s.exact, s.exact_op, s.status, k.id AS klant_id, k.naam, k.land, k.btw_nummer, k.adres, k.postcode, k.plaats, k.exact_code
    FROM pakbonnen s JOIN klanten k ON k.id = s.klant_id WHERE s.datum BETWEEN $1 AND $2`, [van, tot]);
  const ok = slips.filter(s => s.status === 'akkoord');
  const lines = ok.length ? await rows(`SELECT r.pakbon_id, r.partij, r.prijs_eur, d.soort, d.naam, d.maat FROM pakbon_regels r JOIN producten d ON d.id = r.product_id WHERE r.pakbon_id = ANY($1)`, [ok.map(s => s.id)]) : [];
  const ships = await rows(`SELECT p.id, p.nummer, p.maandag, p.regio, p.verzonden_op, p.binnen_op, p.fyto, p.exact, l.naam AS leverancier, g.land, g.nummer AS regio_nr,
      (SELECT count(*) FROM partij_documenten d WHERE d.partij_id = p.id AND d.soort = 'verzendbewijs') AS verzendbewijs,
      (SELECT count(*) FROM partij_documenten d WHERE d.partij_id = p.id AND d.soort = 'fyto') AS fyto_doc
    FROM partijen p JOIN leveranciers l ON l.id = p.leverancier_id LEFT JOIN regios g ON g.code = p.regio WHERE p.maandag BETWEEN $1 AND $2`, [van, tot]);
  const flown = ships.filter(p => p.verzonden_op && new Date(p.verzonden_op) <= new Date());
  const bySlip = new Map(); for (const l of lines) { if (!bySlip.has(l.pakbon_id)) bySlip.set(l.pakbon_id, []); bySlip.get(l.pakbon_id).push(l); }
  const batchSet = new Set(ships.map(p => p.nummer));
  const allBatches = new Set((await rows('SELECT DISTINCT nummer FROM partijen')).map(x => x.nummer));
  const out = [];
  const add = (soort, groep, titel, uitleg, bron, check) => out.push({ id: `${soort}-${out.length + 1}`, soort, groep, titel, uitleg, bron, ...check });
  const good = (tekst, extra = {}) => ({ status: 'ok', tekst, ...extra });
  const bad = (tekst, extra = {}) => ({ status: 'fout', tekst, ...extra });
  const warn = (tekst, extra = {}) => ({ status: 'let_op', tekst, ...extra });
  const info = (tekst, extra = {}) => ({ status: 'info', tekst, ...extra });

  // ================================================================ not allowed
  // the plant passport
  {
    const noBot = [...new Set(lines.filter(l => !l.soort).map(l => `${l.naam} ${l.maat}`))];
    const fails = [];
    if (co.pp_b_voorbeeld) fails.push(`het registratienummer (B) is nog het voorbeeld ${co.pp_b}`);
    if (noBot.length) fails.push(`geen botanische naam (A) bij ${few(noBot, x => x)}`);
    const noOrigin = ships.filter(p => !p.land);
    if (noOrigin.length) fails.push(`geen land van herkomst (D) bij ${few(noOrigin, p => p.nummer)}`);
    add('niet', 'Plantenpaspoort', 'Planten leveren zonder volledig plantenpaspoort',
      'Elke levering aan een beroepsmatige afnemer in de EU gaat met een plantenpaspoort: EU-vlag en "Plant Passport", A de botanische naam, B het registratienummer (NL en het nummer van Campo), C de traceerbaarheidscode (bij Campo het batchnummer) en D het land van herkomst.',
      'EU-plantgezondheidsverordening 2016/2031; ondernemersplein.overheid.nl',
      fails.length ? bad(`Op de pakbon en factuur: ${fails.join('; ')}.`, { link: { href: '#/koppelingen', tekst: 'Naar Koppelingen' } }) : good(`Alle ${n(ok.length, 'factuur', 'facturen')} van ${jaar} hebben A, B, C en D.`));
  }
  {
    const wrong = lines.filter(l => !allBatches.has(l.partij) || !/^\d{6}$/.test(l.partij));
    const slipsWrong = [...new Set(wrong.map(l => ok.find(s => s.id === l.pakbon_id)?.nummer))].filter(Boolean);
    // the batch number says the year, the week and the region: 26 49 01
    const off = ships.filter(p => { const w = isoWeek(p.maandag); return p.regio_nr != null && p.nummer !== `${String(w.jaar % 100).padStart(2, '0')}${String(w.week).padStart(2, '0')}${String(p.regio_nr).padStart(2, '0')}`; });
    add('niet', 'Plantenpaspoort', 'Een batchnummer dat niet bij een zending hoort',
      'C op het plantenpaspoort is het batchnummer: jaar, week en regio (264901 = 2026, week 49, regio 01). Elke regel op de factuur moet naar een echte zending wijzen, anders is de plant niet terug te vinden.',
      'Traceerbaarheid plantenpaspoort; Campo',
      slipsWrong.length || off.length ? bad([slipsWrong.length ? `Factuur ${few(slipsWrong, x => x)} heeft een batch die niet bestaat` : '', off.length ? `${few(off, p => p.nummer)} klopt niet met jaar, week en regio` : ''].filter(Boolean).join('. ') + '.')
        : good(`Alle regels wijzen naar een zending; alle ${n(new Set(ships.map(p => p.nummer)).size, 'batchnummer', 'batchnummers')} kloppen met jaar, week en regio.`));
  }
  // import
  {
    const noFyto = flown.filter(p => !p.fyto && !Number(p.fyto_doc));
    add('niet', 'Invoer', 'Planten invoeren zonder fytosanitair certificaat',
      'Planten uit Costa Rica en Guatemala komen de EU alleen in met een origineel fytosanitair certificaat van het land van herkomst (geen kopie of mail), in een EU-taal, met de botanische naam, en niet meer planten dan erop staan. De NVWA keurt bij aankomst.',
      'NVWA, checklist fytosanitair certificaat bij import',
      noFyto.length ? bad(`Geen certificaatnummer bij ${few(noFyto, p => `${p.nummer} ${p.leverancier}`)}.`) : good(`Alle ${n(flown.length, 'zending', 'zendingen')} van ${jaar} hebben een certificaatnummer.`));
  }
  add('niet', 'Invoer', 'Verboden planten, aarde of plagen meenemen',
    'Sommige planten mogen de EU niet in, en stekken en stammen mogen geen grond of plagen bij zich hebben. Wat er mag, staat op het certificaat en beslist de NVWA bij de keuring. Hockeysticks (Dracaena), Yucca en Cordyline komen nu met een certificaat binnen.',
    'EU-uitvoeringsverordening 2019/2072; NVWA',
    info('Dit kan de desk niet zien: de NVWA keurt de dozen bij aankomst. Krijg je een afkeuring, noteer het dan als melding.'));
  // invoices and VAT
  {
    const seq = new Map();
    for (const s of slips) { const m = String(s.nummer).match(/^(\d{2})-(\d+)$/); if (m) { if (!seq.has(m[1])) seq.set(m[1], []); seq.get(m[1]).push(Number(m[2])); } }
    const gaps = [];
    for (const [yy, ns] of seq) { ns.sort((a, b) => a - b); for (let i = 1; i < ns.length; i++) for (let g = ns[i - 1] + 1; g < ns[i] && gaps.length < 20; g++) gaps.push(`${yy}-${String(g).padStart(4, '0')}`); }
    add('niet', 'Factuur en btw', 'Een factuurnummer overslaan of twee keer gebruiken',
      'Facturen krijgen opeenvolgende nummers (één of meer reeksen) en elk nummer bestaat maar één keer. Een heropende pakbon houdt zijn nummer.',
      'Belastingdienst: factuureisen',
      gaps.length ? warn(`Er ontbreken nummers in de reeks: ${few(gaps, x => x)}. Kijk of die factuur ergens anders is gemaakt.`) : good(`${n(slips.length, 'factuurnummer', 'factuurnummers')} in ${jaar}, doorlopend en zonder dubbele.`));
  }
  {
    const miss = [];
    if (!co.btw) miss.push('het btw-nummer van Campo');
    if (!co.kvk) miss.push('het KvK-nummer');
    if (!co.straat || !co.plaats) miss.push('het adres van Campo');
    const noAddr = [...new Map(ok.filter(s => !s.adres || !s.plaats).map(s => [s.klant_id, s.naam])).values()];
    add('niet', 'Factuur en btw', 'Een factuur zonder de verplichte gegevens',
      'Op elke factuur: naam en adres van Campo en van de klant, het btw-nummer en KvK-nummer van Campo, de factuurdatum, een factuurnummer, wat er geleverd is en hoeveel, de leverdatum, het bedrag zonder btw, het btw-tarief en het btw-bedrag.',
      'Belastingdienst: factuureisen',
      miss.length || noAddr.length ? bad([miss.length ? `Bij Koppelingen ontbreekt ${miss.join(', ')}` : '', noAddr.length ? `Geen volledig adres bij ${few(noAddr, x => x)}` : ''].filter(Boolean).join('. ') + '.', { link: { href: miss.length ? '#/koppelingen' : '#/handel?deel=klanten', tekst: miss.length ? 'Naar Koppelingen' : 'Naar de klanten' } })
        : good('Campo en elke klant met een factuur hebben alle gegevens.'));
  }
  {
    const verlegd = ok.filter(s => s.land !== 'NL' && EU.has(s.land));
    const noVat = [...new Map(verlegd.filter(s => !s.btw_nummer).map(s => [s.klant_id, s.naam])).values()];
    const wrongPct = ok.filter(s => (s.land === 'NL' && Number(s.btw_pct) !== 9) || (s.land !== 'NL' && Number(s.btw_pct) !== 0));
    add('niet', 'Factuur en btw', '0% btw rekenen zonder btw-nummer van de klant',
      'Aan een bedrijf in een ander EU-land lever je met 0% (btw verlegd, intracommunautaire levering), maar alleen met een geldig btw-nummer van die klant op de factuur. Zonder nummer reken je Nederlandse btw.',
      'Belastingdienst: aangepaste regels voor facturen',
      noVat.length || wrongPct.length ? bad([noVat.length ? `Geen btw-nummer bij ${few(noVat, x => x)}` : '', wrongPct.length ? `Verkeerd tarief op ${few(wrongPct, s => s.nummer)}` : ''].filter(Boolean).join('. ') + '.', { link: { href: '#/handel?deel=klanten', tekst: 'Naar de klanten' } })
        : good(`${n(verlegd.length, 'factuur', 'facturen')} met btw verlegd, allemaal met het btw-nummer van de klant.`));
  }
  // stock
  {
    const net = await rows(`SELECT p.id, p.nummer, p.maandag, l.naam AS leverancier,
        coalesce(sum(r.geteld - r.uitval), 0) AS in_, (SELECT coalesce(sum(x.dozen), 0) FROM pakbon_regels x JOIN pakbonnen s ON s.id = x.pakbon_id WHERE s.status = 'akkoord' AND x.regel_id IN (SELECT id FROM partij_regels WHERE partij_id = p.id)) AS uit
      FROM partijen p JOIN leveranciers l ON l.id = p.leverancier_id JOIN partij_regels r ON r.partij_id = p.id JOIN weken w ON w.maandag = p.maandag
      WHERE w.geteld_op IS NOT NULL AND p.maandag BETWEEN $1 AND $2 GROUP BY p.id, l.naam`, [van, tot]);
    const over = net.filter(x => Number(x.uit) > Number(x.in_));
    add('niet', 'Voorraad en batches', 'Meer dozen verkopen dan er binnen zijn',
      'Per batch: wat binnenkwam min de uitval is wat er weg kan. Meer op de pakbonnen dan er geteld is, kan niet: dan is er ergens verkeerd geteld of verdeeld.',
      'Campo: netto nul per batch',
      over.length ? bad(`Te veel verkocht uit ${few(over, x => `${x.nummer} ${x.leverancier} (${Number(x.uit) - Number(x.in_)} dozen)`)}.`, { link: { href: '#/controle?deel=database', tekst: 'Naar de database' } }) : good(`Geen enkele batch van ${jaar} is verder verkocht dan er binnen was.`));
  }
  // Exact
  {
    const late = ok.filter(s => s.exact !== 'in_exact' && s.datum < addDays(today(), -14));
    const lateBuy = flown.filter(p => p.exact !== 'in_exact' && String(p.verzonden_op).slice(0, 10) < addDays(today(), -14));
    const reopened = await rows(`SELECT nummer FROM pakbonnen WHERE status <> 'akkoord' AND exact = 'in_exact' AND datum BETWEEN $1 AND $2`, [van, tot]);
    add('niet', 'Exact', 'Een heropende of niet goedgekeurde factuur in Exact laten staan',
      'In Exact hoort alleen wat Jan heeft goedgekeurd. Wordt een pakbon heropend nadat hij in Exact stond, dan moet de boeking in Exact ook worden aangepast.',
      'Campo',
      reopened.length ? bad(`Heropend maar in Exact: ${few(reopened, x => x.nummer)}.`, { link: { href: '#/controle?deel=exact', tekst: 'Naar de controle van Exact' } }) : good('Alles wat in Exact staat, is goedgekeurd.'));
    add('niet', 'Exact', 'Facturen en inkooporders lang buiten Exact laten',
      'Wat geleverd en gefactureerd is, hoort binnen twee weken in de boekhouding, met het batchnummer als kostendrager. Anders klopt de omzet per batch en per regio niet.',
      'Campo',
      late.length || lateBuy.length ? warn([late.length ? `${n(late.length, 'factuur', 'facturen')} ouder dan twee weken nog niet in Exact` : '', lateBuy.length ? `${n(lateBuy.length, 'inkooporder', 'inkooporders')} nog niet in Exact` : ''].filter(Boolean).join('; ') + '.', { link: { href: '#/controle?deel=exact', tekst: 'Naar Exact' } })
        : good('Alles van meer dan twee weken geleden staat in Exact.'));
  }
  // keeping the papers
  {
    const noPaper = flown.filter(p => !Number(p.verzendbewijs));
    add('niet', 'Bewaren', 'Papieren of facturen weggooien binnen zeven jaar',
      'De administratie (facturen, inkooppapieren, verzendbewijzen) bewaar je zeven jaar; de administratie van het plantenpaspoort (van wie gekocht, aan wie verkocht) minstens drie jaar. Het archief op deze tab bewaart alles per jaar en week.',
      'Belastingdienst (bewaarplicht); ondernemersplein.overheid.nl (plantenpaspoort)',
      noPaper.length ? warn(`Geen verzendbewijs bewaard bij ${few(noPaper, p => `${p.nummer} ${p.leverancier}`)}.`, { link: { href: '#/controle?deel=archief', tekst: 'Naar het archief' } }) : good(`Van alle ${n(flown.length, 'zending', 'zendingen')} van ${jaar} is het verzendbewijs bewaard.`));
  }
  // the desk itself
  add('niet', 'De desk zelf', 'Bestellen, mailen of betalen zonder Jan',
    'De desk leest, telt, vergelijkt, stelt voor en zet klaar. Een bestelling, een mail of een betaling gaat alleen de deur uit als Jan zelf op verzenden drukt.',
    'Campo', good('Zo gebouwd: de desk maakt alleen concepten en tekst om te kopiëren.'));

  // ================================================================ allowed
  {
    const nlS = ok.filter(s => s.land === 'NL');
    add('wel', 'Factuur en btw', '9% btw op planten in Nederland',
      'Levende planten en stekken vallen in Nederland onder het lage btw-tarief van 9%.', 'Belastingdienst: btw-tarieven',
      nlS.every(s => Number(s.btw_pct) === 9) ? good(`${n(nlS.length, 'Nederlandse factuur', 'Nederlandse facturen')}, allemaal met 9%.`) : bad('Er is een Nederlandse factuur met een ander tarief.'));
  }
  add('wel', 'Factuur en btw', '0% btw buiten de EU (uitvoer)',
    'Aan een klant buiten de EU lever je met 0% (export), als je kunt laten zien dat de planten de EU uit zijn gegaan.', 'Belastingdienst',
    info(ok.some(s => !EU.has(s.land)) ? `${n(ok.filter(s => !EU.has(s.land)).length, 'factuur', 'facturen')} voor export.` : 'Nu geen klanten buiten de EU.'));
  add('wel', 'Factuur en btw', 'In dollars inkopen en in euro factureren',
    'De leveranciers rekenen in dollars; Campo factureert in euro, omgerekend met de koers die Jan op maandag vastzet. De koers staat op de factuur.', 'Campo',
    info('De koers van elke week staat bij Maandag en in de Excel (blad Koersen).'));
  {
    const groups = new Map();
    for (const p of ships) { const k = `${p.maandag}|${p.regio}`; if (!groups.has(k)) groups.set(k, new Set()); groups.get(k).add(p.nummer); }
    const split = [...groups].filter(([, s]) => s.size > 1);
    add('wel', 'Voorraad en batches', 'Eén batchnummer voor leveranciers uit dezelfde regio in dezelfde week',
      'Twee kwekers uit Costa Rica in week 49 delen batch 264901. In de desk en in de Excel blijft elke zending apart te volgen (batch en leverancier).', 'Campo',
      split.length ? warn(`In ${n(split.length, 'week', 'weken')} heeft één regio meer dan één batchnummer.`) : good('Elke regio heeft per week één batchnummer.'));
  }
  add('wel', 'Voorraad en batches', 'Vrije dozen in de loods houden en later verkopen',
    'Wat geen klant heeft, blijft als rest in zijn batch staan en kan later nog weg. Het telt mee in netto nul zodra het verkocht is.', 'Campo',
    info('Op het Overzicht staat bovenaan wat nog geen bestemming heeft.', { link: { href: '#/inkoop', tekst: 'Naar het overzicht' } }));
  add('wel', 'Voorraad en batches', 'Een klant een week overslaan of de verdeling aanpassen',
    'Tot de pakbon akkoord is, kan Jan aantallen aanpassen of een klant er een week uit zetten (Maandag, controleren). Daarna eerst de pakbon heropenen.', 'Campo',
    info('Bij Maandag, stap Controleren.', { link: { href: '#/maandag?deel=check', tekst: 'Naar Maandag' } }));
  add('wel', 'Plantenpaspoort', 'Het plantenpaspoort op het etiket én op de pakbon',
    'Het plantenpaspoort hoort aan de handelseenheid (de doos of bos). Campo zet A, B, C en D ook op de pakbon en factuur, zodat elke klant kan terugvinden waar zijn planten vandaan komen.', 'EU 2016/2031; Campo',
    info('Elke pakbon en factuur van de desk heeft het plantenpaspoort per soort en batch.'));
  add('wel', 'Exact', 'Na Jans akkoord de factuur door de desk in Exact laten zetten',
    'Jan keurt de pakbon goed; daarna zet de desk hem in Exact met het batchnummer als kostendrager. De controle leest daarna alleen wat er in Exact staat en vergelijkt het.', 'Campo',
    info('Zie het deel Exact op deze tab.', { link: { href: '#/controle?deel=exact', tekst: 'Naar Exact' } }));

  const samen = { fout: out.filter(r => r.status === 'fout').length, let_op: out.filter(r => r.status === 'let_op').length, ok: out.filter(r => r.status === 'ok').length };
  return { jaar, regels: out, samen };
}
