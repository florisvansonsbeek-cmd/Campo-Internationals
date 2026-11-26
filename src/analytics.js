// Everything the desk knows about growers, customers and plants, worked out from the deliveries themselves.
import { rows, one } from './db.js';
import { familyKey } from './allocate.js';

const n = v => (v == null ? null : Number(v));
const pct = v => (v == null ? null : Math.round(Number(v) * 100));
const nl = v => Math.round(v).toLocaleString('nl-NL');
const eur = v => `€ ${Math.round(v).toLocaleString('nl-NL')}`;

// ---------------------------------------------------------------- growers
const GROWER_STATS = `
WITH z AS (
  SELECT z.kweker_id, z.id,
         extract(epoch FROM (z.aankomst_werkelijk - z.aankomst_gepland)) / 60 AS laat
    FROM zendingen z
   WHERE z.aankomst_werkelijk <= now() AND z.aankomst_gepland > now() - interval '365 days'
), zs AS (
  SELECT kweker_id, count(*) AS leveringen,
         avg((laat <= 15)::int) AS op_tijd,
         avg(laat) FILTER (WHERE laat > 15) AS gem_te_laat,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY laat) AS mediaan_laat
    FROM z GROUP BY kweker_id
), fs AS (
  SELECT f.kweker_id, count(DISTINCT f.id) AS facturen, sum(fr.bedrag) AS inkoop, count(DISTINCT fr.plant_id) AS planten, max(f.datum) AS laatste,
         sum(fr.aantal) AS stuks, sum(fr.besteld) AS besteld,
         sum(fr.bedrag) FILTER (WHERE f.datum > current_date - 90) AS inkoop_90,
         sum(fr.bedrag) FILTER (WHERE f.datum BETWEEN current_date - 180 AND current_date - 91) AS inkoop_prev90
    FROM facturen f JOIN factuur_regels fr ON fr.factuur_id = f.id
   WHERE f.datum > current_date - 365
   GROUP BY f.kweker_id
), a AS (
  SELECT f.kweker_id,
         count(DISTINCT a.factuur_id) FILTER (WHERE a.soort = 'minder') AS minder,
         count(DISTINCT a.factuur_id) FILTER (WHERE a.soort IN ('kwaliteit', 'schade')) AS kwaliteit,
         count(DISTINCT a.factuur_id) FILTER (WHERE a.soort = 'prijs') AS prijs,
         count(DISTINCT a.factuur_id) FILTER (WHERE a.soort = 'maat') AS maat,
         coalesce(sum(a.bedrag) FILTER (WHERE a.soort IN ('kwaliteit', 'schade', 'minder', 'prijs')), 0) AS bedrag,
         count(*) FILTER (WHERE NOT a.opgelost) AS open
    FROM afwijkingen a JOIN facturen f ON f.id = a.factuur_id
   WHERE a.gemeld_op > now() - interval '365 days'
   GROUP BY f.kweker_id
), px AS (
  -- price against what other growers asked for the same plant in the same month
  SELECT fr.plant_id, date_trunc('month', f.datum) AS m, avg(fr.prijs) AS markt
    FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id
   WHERE f.datum > current_date - 365 GROUP BY 1, 2
), pi AS (
  SELECT f.kweker_id, sum(fr.prijs / nullif(px.markt, 0) * fr.bedrag) / nullif(sum(fr.bedrag), 0) AS prijsindex
    FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id
    JOIN px ON px.plant_id = fr.plant_id AND px.m = date_trunc('month', f.datum)
   WHERE f.datum > current_date - 365 GROUP BY f.kweker_id
)
SELECT k.*, fs.facturen, fs.inkoop, fs.planten, fs.laatste, fs.stuks, fs.besteld, fs.inkoop_90, fs.inkoop_prev90,
       zs.leveringen, zs.op_tijd, zs.gem_te_laat, zs.mediaan_laat,
       coalesce(a.minder, 0) AS minder, coalesce(a.kwaliteit, 0) AS kwaliteit, coalesce(a.prijs, 0) AS prijsafwijking, coalesce(a.maat, 0) AS maat,
       coalesce(a.bedrag, 0) AS afwijking_bedrag, coalesce(a.open, 0) AS open_afwijkingen, pi.prijsindex
  FROM kwekers k
  LEFT JOIN fs ON fs.kweker_id = k.id
  LEFT JOIN zs ON zs.kweker_id = k.id
  LEFT JOIN a ON a.kweker_id = k.id
  LEFT JOIN pi ON pi.kweker_id = k.id`;

function growerScore(g) {
  const lev = Number(g.leveringen || 0), fact = Number(g.facturen || 0);
  if (!fact) return { score: null, parts: null };
  // with little history lean on a neutral 75 until there are about ten deliveries
  const w = Math.min(1, fact / 10);
  const onTime = g.op_tijd == null ? 0.8 : Number(g.op_tijd);
  const complete = 1 - Number(g.minder) / fact;
  const quality = 1 - Number(g.kwaliteit) / fact;
  const price = 1 - Number(g.prijsafwijking) / fact;
  // powers stretch the scale: one bad delivery in twenty should cost more than a rounding error
  const raw = 100 * (0.4 * Math.pow(onTime, 1.5) + 0.25 * Math.pow(complete, 3) + 0.2 * Math.pow(quality, 3) + 0.15 * Math.pow(price, 3));
  return {
    score: Math.round(w * raw + (1 - w) * 75),
    parts: { op_tijd: Math.round(onTime * 100), compleet: Math.round(complete * 100), kwaliteit: Math.round(quality * 100), prijs_klopt: Math.round(price * 100), leveringen: lev },
  };
}

function shapeGrower(g) {
  const s = growerScore(g);
  const trend = g.inkoop_prev90 > 0 ? Math.round((Number(g.inkoop_90 || 0) / Number(g.inkoop_prev90) - 1) * 100) : null;
  return {
    id: g.id, code: g.code, naam: g.naam, plaats: g.plaats, land: g.land, contact: g.contact, email: g.email, whatsapp: g.whatsapp, telefoon: g.telefoon,
    vervoer: g.vervoer, laadtijd: g.laadtijd ? String(g.laadtijd).slice(0, 5) : null, reistijd_min: g.reistijd_min, levert_op: g.levert_op, specialiteit: g.specialiteit, notities: g.notities,
    actief: g.actief, bron: g.bron, maildomein: g.maildomein,
    facturen: n(g.facturen) || 0, inkoop: n(g.inkoop) || 0, planten: n(g.planten) || 0, laatste: g.laatste, leveringen: n(g.leveringen) || 0,
    op_tijd: pct(g.op_tijd), gem_te_laat: g.gem_te_laat == null ? null : Math.round(g.gem_te_laat), mediaan_laat: g.mediaan_laat == null ? null : Math.round(g.mediaan_laat),
    compleet: g.besteld ? Math.round(Number(g.stuks) / Number(g.besteld) * 1000) / 10 : null,
    minder: n(g.minder), kwaliteit: n(g.kwaliteit), prijsafwijking: n(g.prijsafwijking), maat: n(g.maat), afwijking_bedrag: n(g.afwijking_bedrag), open_afwijkingen: n(g.open_afwijkingen),
    prijsindex: g.prijsindex == null ? null : Math.round(Number(g.prijsindex) * 1000) / 10,
    trend, score: s.score, score_delen: s.parts,
  };
}

// how the last deliveries went, and how often a late truck came without a message beforehand
async function growerDelivery(id = null) {
  const r = await rows(`
    WITH z AS (
      SELECT z.id, z.kweker_id, extract(epoch FROM (z.aankomst_werkelijk - z.aankomst_gepland)) / 60 AS laat,
             row_number() OVER (PARTITION BY z.kweker_id ORDER BY z.aankomst_gepland DESC) AS rn,
             EXISTS (SELECT 1 FROM gebeurtenissen e WHERE e.zending_id = z.id AND e.soort IN ('vertraging', 'eta') AND e.tijd < z.aankomst_gepland) AS gemeld
        FROM zendingen z
       WHERE z.aankomst_werkelijk <= now() AND z.aankomst_gepland > now() - interval '365 days'${id ? ' AND z.kweker_id = $1' : ''}
    )
    SELECT kweker_id, count(*) FILTER (WHERE laat > 30) AS laat_n, count(*) FILTER (WHERE laat > 30 AND NOT gemeld) AS stil_n,
           count(*) FILTER (WHERE rn <= 5) AS recent_n, count(*) FILTER (WHERE rn <= 5 AND laat > 15) AS recent_laat
      FROM z GROUP BY kweker_id`, id ? [id] : []);
  return Object.fromEntries(r.map(x => [x.kweker_id, { laat_n: Number(x.laat_n), stil_n: Number(x.stil_n), recent_n: Number(x.recent_n), recent_laat: Number(x.recent_laat) }]));
}

export async function growerList() {
  const list = (await rows(GROWER_STATS + ' ORDER BY k.naam')).map(shapeGrower);
  const extra = await growerDelivery();
  for (const g of list) g.belemmeringen = obstaclesGrower(g, extra[g.id]);
  // twelve weeks of deliveries per grower, for a small spark line
  const weeks = await rows(`SELECT f.kweker_id, floor((current_date - f.datum) / 7)::int AS w, sum(fr.bedrag) AS v
    FROM facturen f JOIN factuur_regels fr ON fr.factuur_id = f.id WHERE f.datum > current_date - 84 GROUP BY 1, 2`);
  const byK = {};
  for (const r of weeks) { (byK[r.kweker_id] = byK[r.kweker_id] || Array(12).fill(0))[11 - Math.min(11, r.w)] += Number(r.v); }
  for (const g of list) g.weken = byK[g.id] || Array(12).fill(0);
  return list;
}

export async function growerDetail(id) {
  const g = await one(GROWER_STATS + ' WHERE k.id = $1', [id]);
  if (!g) return null;
  const base = shapeGrower(g);
  const history = await rows(`
    SELECT f.id, f.nummer, f.datum, f.totaal,
           z.vertrek_gepland, z.vertrek_werkelijk, z.aankomst_gepland, z.aankomst_werkelijk,
           CASE WHEN z.aankomst_werkelijk <= now() THEN round(extract(epoch FROM (z.aankomst_werkelijk - z.aankomst_gepland)) / 60) END AS laat,
           (SELECT json_agg(json_build_object('plant', p.naam, 'maat', concat_ws(' ', p.potmaat, p.hoogte), 'aantal', fr.aantal, 'besteld', fr.besteld, 'prijs', fr.prijs) ORDER BY fr.regelnr)
              FROM factuur_regels fr LEFT JOIN planten p ON p.id = fr.plant_id WHERE fr.factuur_id = f.id) AS regels,
           (SELECT json_agg(json_build_object('soort', a.soort, 'tekst', a.tekst, 'opgelost', a.opgelost, 'oplossing', a.oplossing, 'bedrag', a.bedrag))
              FROM afwijkingen a WHERE a.factuur_id = f.id) AS afwijkingen,
           (SELECT count(DISTINCT t.klant_id) FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id WHERE fr.factuur_id = f.id AND t.bestemming = 'klant' AND t.status <> 'afgewezen') AS klanten,
           s.stap
      FROM facturen f LEFT JOIN zendingen z ON z.factuur_id = f.id LEFT JOIN factuur_stap s ON s.factuur_id = f.id
     WHERE f.kweker_id = $1 ORDER BY f.datum DESC, f.id DESC LIMIT 80`, [id]);
  const assortiment = await rows(`
    SELECT p.id, p.naam, p.potmaat, p.hoogte, p.eenheid, count(DISTINCT f.id) AS keer, sum(fr.aantal) AS stuks, sum(fr.bedrag) AS bedrag,
           avg(fr.prijs) FILTER (WHERE f.datum > current_date - 60) AS prijs_nu,
           avg(fr.prijs) FILTER (WHERE f.datum BETWEEN current_date - 365 AND current_date - 300) AS prijs_jaar_terug,
           (SELECT avg(fr2.prijs) FROM factuur_regels fr2 JOIN facturen f2 ON f2.id = fr2.factuur_id WHERE fr2.plant_id = p.id AND f2.kweker_id <> $1 AND f2.datum > current_date - 60) AS prijs_anderen,
           max(f.datum) AS laatst
      FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id JOIN planten p ON p.id = fr.plant_id
     WHERE f.kweker_id = $1 AND f.datum > current_date - 365
     GROUP BY p.id ORDER BY sum(fr.bedrag) DESC`, [id]);
  const prijsreeks = await rows(`
    SELECT p.id AS plant_id, to_char(date_trunc('month', f.datum), 'YYYY-MM') AS maand, round(avg(fr.prijs), 3) AS prijs
      FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id JOIN planten p ON p.id = fr.plant_id
     WHERE f.kweker_id = $1 AND f.datum > current_date - 365 GROUP BY 1, 2 ORDER BY 2`, [id]);
  const maanden = await rows(`
    SELECT to_char(date_trunc('month', z.aankomst_gepland), 'YYYY-MM') AS maand, count(*) AS leveringen,
           round(avg((extract(epoch FROM (z.aankomst_werkelijk - z.aankomst_gepland)) / 60 <= 15)::int) * 100) AS op_tijd,
           round(avg(greatest(0, extract(epoch FROM (z.aankomst_werkelijk - z.aankomst_gepland)) / 60))) AS gem_laat
      FROM zendingen z WHERE z.kweker_id = $1 AND z.aankomst_werkelijk <= now() AND z.aankomst_gepland > now() - interval '365 days'
     GROUP BY 1 ORDER BY 1`, [id]);
  const weekdagen = await rows(`
    SELECT extract(isodow FROM z.aankomst_gepland)::int AS dag, count(*) AS n,
           round(avg(greatest(0, extract(epoch FROM (z.aankomst_werkelijk - z.aankomst_gepland)) / 60))) AS gem_laat
      FROM zendingen z WHERE z.kweker_id = $1 AND z.aankomst_werkelijk <= now() AND z.aankomst_gepland > now() - interval '365 days' GROUP BY 1 ORDER BY 1`, [id]);
  const klanten = await rows(`
    SELECT k.id, k.naam, k.plaats, k.land, sum(t.aantal) AS stuks, count(DISTINCT f.id) AS keer
      FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id JOIN klanten k ON k.id = t.klant_id
     WHERE f.kweker_id = $1 AND t.bestemming = 'klant' AND t.status <> 'afgewezen' AND f.datum > current_date - 365
     GROUP BY k.id ORDER BY sum(t.aantal * coalesce(t.verkoopprijs, 0)) DESC LIMIT 12`, [id]);
  const berichten = await rows(`SELECT id, kanaal, onderwerp, left(tekst, 220) AS tekst, ontvangen, soort, status FROM berichten_in WHERE kweker_id = $1 AND ontvangen <= now() ORDER BY ontvangen DESC LIMIT 15`, [id]);
  const namen = await rows(`SELECT pn.tekst, p.naam, p.potmaat, p.hoogte, pn.door FROM plant_namen pn JOIN planten p ON p.id = pn.plant_id WHERE pn.kweker_id = $1 ORDER BY pn.geleerd DESC LIMIT 40`, [id]);
  const extra = (await growerDelivery(base.id))[base.id];
  return { ...base, history: history.map(h => ({ ...h, laat: h.laat == null ? null : Number(h.laat) })), assortiment, prijsreeks, maanden, weekdagen, klanten, berichten, namen, inzichten: growerInsights(base, { maanden, weekdagen, assortiment, history }), belemmeringen: obstaclesGrower(base, extra) };
}

const DAGEN = ['', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
function growerInsights(g, { weekdagen, assortiment, history }) {
  const out = [];
  if (g.leveringen >= 5) {
    if (g.op_tijd >= 90) out.push({ toon: 'ok', tekst: `Betrouwbaar: ${g.op_tijd}% van de leveringen kwam op tijd binnen (binnen een kwartier).` });
    else if (g.op_tijd < 75) out.push({ toon: 'bad', tekst: `Komt vaak te laat: maar ${g.op_tijd}% op tijd. Als het misgaat gemiddeld ${g.gem_te_laat} minuten. Plan klanten die vroeg moeten krijgen niet op deze kweker.` });
    const worst = weekdagen.filter(w => Number(w.n) >= 4).sort((a, b) => b.gem_laat - a.gem_laat)[0];
    const best = weekdagen.filter(w => Number(w.n) >= 4).sort((a, b) => a.gem_laat - b.gem_laat)[0];
    if (worst && best && worst.dag !== best.dag && worst.gem_laat - best.gem_laat >= 10) out.push({ toon: 'wait', tekst: `Op ${DAGEN[worst.dag]} gemiddeld ${worst.gem_laat} minuten later; op ${DAGEN[best.dag]} het stiptst (${best.gem_laat} min).` });
  }
  if (g.facturen >= 5 && g.minder / g.facturen >= 0.08) out.push({ toon: 'bad', tekst: `Levert vaker minder dan besteld: bij ${g.minder} van de ${g.facturen} leveringen (${Math.round(g.minder / g.facturen * 100)}%). Bestel bij deze kweker een laag extra of check de pakbon direct.` });
  if (g.prijsafwijking >= 2) out.push({ toon: 'wait', tekst: `${g.prijsafwijking}× een hogere prijs gefactureerd dan afgesproken; samen ${eur(g.afwijking_bedrag)} aan afwijkingen dit jaar.` });
  if (g.prijsindex != null) {
    if (g.prijsindex <= 96) out.push({ toon: 'ok', tekst: `Goedkoper dan andere kwekers voor dezelfde planten: gemiddeld ${Math.round(100 - g.prijsindex)}% onder de markt.` });
    else if (g.prijsindex >= 104) out.push({ toon: 'wait', tekst: `Duurder dan andere kwekers voor dezelfde planten: gemiddeld ${Math.round(g.prijsindex - 100)}% boven de markt.` });
  }
  const rising = assortiment.filter(a => a.prijs_nu && a.prijs_jaar_terug).map(a => ({ ...a, d: (a.prijs_nu / a.prijs_jaar_terug - 1) * 100 })).sort((a, b) => b.d - a.d)[0];
  if (rising && rising.d >= 4) out.push({ toon: 'wait', tekst: `${rising.naam} ${rising.potmaat || ''} is ${Math.round(rising.d)}% duurder dan een jaar geleden.` });
  const cheaper = assortiment.filter(a => a.prijs_nu && a.prijs_anderen && a.prijs_nu < a.prijs_anderen * 0.95)[0];
  if (cheaper) out.push({ toon: 'ok', tekst: `Voor ${cheaper.naam} ${cheaper.potmaat || ''} de scherpste prijs: ${Number(cheaper.prijs_nu).toFixed(2).replace('.', ',')} tegen ${Number(cheaper.prijs_anderen).toFixed(2).replace('.', ',')} bij anderen.` });
  const recent = history.filter(h => h.laat != null).slice(0, 5);
  const lateRecent = recent.filter(h => h.laat > 15).length;
  if (recent.length === 5 && lateRecent >= 3) out.push({ toon: 'bad', tekst: `Van de laatste 5 leveringen kwamen er ${lateRecent} te laat. Dat is slechter dan het jaargemiddelde.` });
  if (g.open_afwijkingen > 0) out.push({ toon: 'wait', tekst: `${g.open_afwijkingen} ${g.open_afwijkingen === 1 ? 'afwijking staat' : 'afwijkingen staan'} nog open (credit of nalevering).` });
  if (!out.length) out.push({ toon: 'info', tekst: 'Nog te weinig leveringen om iets bijzonders te zien.' });
  return out;
}

// ---------------------------------------------------------------- customers
const CUSTOMER_STATS = `
WITH o AS (
  SELECT klant_id, count(*) FILTER (WHERE besteld_op > now() - interval '365 days') AS orders_12m,
         max(besteld_op) AS laatste, min(besteld_op) AS eerste,
         count(*) FILTER (WHERE status IN ('open', 'toegewezen', 'onderweg')) AS lopend
    FROM klant_orders WHERE status <> 'geannuleerd' AND besteld_op <= now() GROUP BY klant_id
), gaps AS (
  SELECT klant_id, avg(gap) AS ritme, stddev_samp(gap) AS spreiding
    FROM (SELECT klant_id, extract(epoch FROM besteld_op - lag(besteld_op) OVER (PARTITION BY klant_id ORDER BY besteld_op)) / 86400 AS gap
            FROM klant_orders WHERE status <> 'geannuleerd' AND besteld_op > now() - interval '365 days' AND besteld_op <= now()) x
   WHERE gap IS NOT NULL GROUP BY klant_id
), s AS (
  SELECT t.klant_id,
         sum(t.aantal * t.verkoopprijs) FILTER (WHERE f.datum > current_date - 365) AS omzet_12m,
         sum(t.aantal * (t.verkoopprijs - fr.prijs)) FILTER (WHERE f.datum > current_date - 365) AS marge_12m,
         sum(t.aantal * t.verkoopprijs) FILTER (WHERE f.datum > current_date - 90) AS omzet_90,
         sum(t.aantal * t.verkoopprijs) FILTER (WHERE f.datum BETWEEN current_date - 180 AND current_date - 91) AS omzet_prev90,
         sum(t.aantal * t.verkoopprijs) FILTER (WHERE f.datum BETWEEN current_date - 455 AND current_date - 365) AS omzet_vorigjaar_90,
         sum(t.aantal * t.verkoopprijs) FILTER (WHERE t.soort = 'aanbod' AND f.datum > current_date - 365) AS omzet_aanbod
    FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id
   WHERE t.bestemming = 'klant' AND t.status IN ('bevestigd', 'geleverd') GROUP BY t.klant_id
), p AS (
  SELECT klant_id, avg(betaald_op - vervaldatum) FILTER (WHERE betaald_op IS NOT NULL AND datum > current_date - 365) AS betaal_dagen,
         coalesce(sum(bedrag) FILTER (WHERE betaald_op IS NULL), 0) AS open_bedrag,
         coalesce(sum(bedrag) FILTER (WHERE betaald_op IS NULL AND vervaldatum < current_date), 0) AS over_tijd
    FROM verkoopfacturen GROUP BY klant_id
), l AS (
  SELECT klant_id, avg((aankomst_werkelijk <= aankomst_gepland + interval '30 minutes')::int) AS op_tijd, count(*) AS leveringen
    FROM leveringen WHERE aankomst_werkelijk <= now() AND aankomst_gepland > now() - interval '365 days' GROUP BY klant_id
)
SELECT k.*, o.orders_12m, o.laatste, o.eerste, o.lopend, gaps.ritme, gaps.spreiding,
       s.omzet_12m, s.marge_12m, s.omzet_90, s.omzet_prev90, s.omzet_vorigjaar_90, s.omzet_aanbod,
       p.betaal_dagen, p.open_bedrag, p.over_tijd, l.op_tijd, l.leveringen
  FROM klanten k
  LEFT JOIN o ON o.klant_id = k.id LEFT JOIN gaps ON gaps.klant_id = k.id LEFT JOIN s ON s.klant_id = k.id
  LEFT JOIN p ON p.klant_id = k.id LEFT JOIN l ON l.klant_id = k.id`;

function shapeCustomer(k, top25) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ritme = k.ritme == null ? null : Math.round(Number(k.ritme));
  const laatste = k.laatste ? new Date(k.laatste) : null;
  const sinds = laatste ? Math.floor((today - new Date(laatste).setHours(0, 0, 0, 0)) / 864e5) : null;
  const volgende = laatste && ritme ? new Date(+new Date(laatste).setHours(0, 0, 0, 0) + ritme * 864e5) : null;
  const telaat = volgende ? Math.round((today - volgende) / 864e5) : null;
  const omzet = Number(k.omzet_12m || 0), o90 = Number(k.omzet_90 || 0), p90 = Number(k.omzet_prev90 || 0), y90 = Number(k.omzet_vorigjaar_90 || 0);
  // against the same 90 days a year ago, so autumn is not compared with summer; otherwise against the 90 days before
  const trend = y90 > 0 ? Math.round((o90 / y90 - 1) * 100) : p90 > 0 ? Math.round((o90 / p90 - 1) * 100) : null;
  const trendBasis = y90 > 0 ? 'jaar' : p90 > 0 ? 'kwartaal' : null;
  const eerste = k.eerste ? Math.floor((today - new Date(k.eerste)) / 864e5) : null;
  let segment = 'stabiel';
  if (!k.actief) segment = 'gestopt';
  else if (eerste != null && eerste < 120) segment = 'nieuw';
  else if (ritme && sinds != null && sinds > Math.max(21, ritme * 2.2)) segment = 'slapend';
  else if (trend != null && trend <= -18) segment = 'dalend';
  else if (trend != null && trend >= 18) segment = 'groeiend';
  else if (omzet >= top25) segment = 'kern';
  // health: rhythm kept, growth, paying on time, margin
  let health = 70;
  if (ritme && sinds != null) health -= Math.max(0, Math.min(30, (sinds - ritme) / ritme * 20));
  if (trend != null) health += Math.max(-15, Math.min(15, trend / 3));
  if (k.betaal_dagen != null) health -= Math.max(0, Math.min(20, Number(k.betaal_dagen)));
  if (Number(k.over_tijd) > 0) health -= 8;
  if (!k.actief) health = 0;
  return {
    id: k.id, code: k.code, naam: k.naam, soort: k.soort, contact: k.contact, email: k.email, telefoon: k.telefoon, whatsapp: k.whatsapp,
    adres: k.adres, postcode: k.postcode, plaats: k.plaats, land: k.land, taal: k.taal, kanaal: k.kanaal, levervenster: k.levervenster, leverdagen: k.leverdagen,
    reistijd_min: k.reistijd_min, betaaltermijn: k.betaaltermijn, kredietlimiet: n(k.kredietlimiet), wensen: k.wensen, klant_sinds: k.klant_sinds, actief: k.actief, bron: k.bron,
    orders_12m: n(k.orders_12m) || 0, lopend: n(k.lopend) || 0, laatste: k.laatste, dagen_sinds: sinds, ritme, spreiding: k.spreiding == null ? null : Math.round(Number(k.spreiding)),
    volgende: volgende ? volgende.toISOString() : null, te_laat_dagen: telaat,
    omzet_12m: Math.round(omzet), marge_12m: Math.round(Number(k.marge_12m || 0)), marge_pct: omzet ? Math.round(Number(k.marge_12m || 0) / omzet * 1000) / 10 : null,
    orderwaarde: k.orders_12m ? Math.round(omzet / Number(k.orders_12m)) : null, trend, trend_basis: trendBasis, omzet_aanbod: Math.round(Number(k.omzet_aanbod || 0)),
    betaal_dagen: k.betaal_dagen == null ? null : Math.round(Number(k.betaal_dagen) * 10) / 10, open_bedrag: Math.round(Number(k.open_bedrag || 0)), over_tijd: Math.round(Number(k.over_tijd || 0)),
    op_tijd: pct(k.op_tijd), leveringen: n(k.leveringen) || 0,
    segment, gezondheid: Math.max(0, Math.min(100, Math.round(health))),
  };
}

export async function customerList() {
  const raw = await rows(CUSTOMER_STATS + ' ORDER BY k.naam');
  const sorted = raw.map(k => Number(k.omzet_12m || 0)).sort((a, b) => b - a);
  const top25 = sorted[Math.max(0, Math.floor(sorted.length / 4) - 1)] || 0;
  const list = raw.map(k => shapeCustomer(k, top25));
  const months = await rows(`SELECT t.klant_id, floor((current_date - f.datum) / 30)::int AS m, sum(t.aantal * t.verkoopprijs) AS v
     FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id
    WHERE t.bestemming = 'klant' AND t.status IN ('bevestigd', 'geleverd') AND f.datum > current_date - 360 GROUP BY 1, 2`);
  const byK = {};
  for (const r of months) (byK[r.klant_id] = byK[r.klant_id] || Array(12).fill(0))[11 - Math.min(11, r.m)] += Number(r.v);
  const tops = await rows(`SELECT DISTINCT ON (t.klant_id) t.klant_id, p.naam, p.potmaat
     FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id JOIN planten p ON p.id = fr.plant_id
    WHERE t.bestemming = 'klant' AND f.datum > current_date - 365 GROUP BY t.klant_id, p.id ORDER BY t.klant_id, sum(t.aantal * t.verkoopprijs) DESC`);
  const topBy = Object.fromEntries(tops.map(t => [t.klant_id, `${t.naam.replace(/\s(wit|roze|paars|blauw|geel|oranje|rood)$/, '')}${t.potmaat ? ' ' + t.potmaat : ''}`]));
  for (const c of list) { c.maanden = byK[c.id] || Array(12).fill(0); c.top = topBy[c.id] || null; c.belemmeringen = obstaclesCustomer(c); }
  return list;
}

export async function customerDetail(id) {
  const raw = await rows(CUSTOMER_STATS + ' ORDER BY k.id');
  const sorted = raw.map(k => Number(k.omzet_12m || 0)).sort((a, b) => b - a);
  const top25 = sorted[Math.max(0, Math.floor(sorted.length / 4) - 1)] || 0;
  const me = raw.find(k => k.id === Number(id));
  if (!me) return null;
  const c = shapeCustomer(me, top25);
  const all = raw.map(k => shapeCustomer(k, top25)).filter(x => x.actief);
  c.rang = all.sort((a, b) => b.omzet_12m - a.omzet_12m).findIndex(x => x.id === c.id) + 1;
  c.klanten_totaal = all.length;
  const planten = await rows(`
    SELECT p.id, p.naam, p.potmaat, p.hoogte, p.eenheid, sum(t.aantal) AS stuks, sum(t.aantal * t.verkoopprijs) AS omzet, count(DISTINCT f.id) AS keer,
           avg(t.verkoopprijs) AS prijs, avg(fr.prijs) AS inkoop, max(f.datum) AS laatst, avg(t.aantal) AS gem
      FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id JOIN planten p ON p.id = fr.plant_id
     WHERE t.klant_id = $1 AND t.bestemming = 'klant' AND t.status IN ('bevestigd', 'geleverd') AND f.datum > current_date - 365
     GROUP BY p.id ORDER BY omzet DESC`, [id]);
  const maanden = await rows(`
    SELECT to_char(date_trunc('month', f.datum), 'YYYY-MM') AS maand, sum(t.aantal * t.verkoopprijs) AS omzet, sum(t.aantal * (t.verkoopprijs - fr.prijs)) AS marge
      FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id
     WHERE t.klant_id = $1 AND t.bestemming = 'klant' AND t.status IN ('bevestigd', 'geleverd') AND f.datum > date_trunc('month', current_date) - interval '12 months'
     GROUP BY 1 ORDER BY 1`, [id]);
  const weekdagen = await rows(`SELECT extract(isodow FROM besteld_op)::int AS dag, count(*) AS n FROM klant_orders WHERE klant_id = $1 AND besteld_op > now() - interval '365 days' AND besteld_op <= now() GROUP BY 1 ORDER BY 1`, [id]);
  const orders = await rows(`
    SELECT ko.id, ko.nummer, ko.besteld_op, ko.gewenst_op, ko.status, ko.kanaal,
           (SELECT json_agg(json_build_object('plant', p.naam, 'maat', concat_ws(' ', p.potmaat, p.hoogte), 'aantal', kor.aantal, 'prijs', kor.prijs) ORDER BY kor.id)
              FROM klant_order_regels kor JOIN planten p ON p.id = kor.plant_id WHERE kor.order_id = ko.id) AS regels,
           (SELECT sum(kor.aantal * coalesce(kor.prijs, 0)) FROM klant_order_regels kor WHERE kor.order_id = ko.id) AS waarde,
           l.vertrek_gepland, l.aankomst_gepland, CASE WHEN l.aankomst_werkelijk <= now() THEN l.aankomst_werkelijk END AS aankomst_werkelijk,
           CASE WHEN l.aankomst_werkelijk <= now() THEN round(extract(epoch FROM (l.aankomst_werkelijk - l.aankomst_gepland)) / 60) END AS laat
      FROM klant_orders ko LEFT JOIN leveringen l ON l.order_id = ko.id
     WHERE ko.klant_id = $1 AND ko.besteld_op <= now() ORDER BY ko.besteld_op DESC LIMIT 60`, [id]);
  const kwekers = await rows(`
    SELECT g.id, g.naam, g.plaats, sum(t.aantal) AS stuks, count(DISTINCT f.id) AS keer
      FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id JOIN kwekers g ON g.id = f.kweker_id
     WHERE t.klant_id = $1 AND t.bestemming = 'klant' AND f.datum > current_date - 365 GROUP BY g.id ORDER BY sum(t.aantal * t.verkoopprijs) DESC`, [id]);
  const facturen = await rows(`SELECT nummer, datum, vervaldatum, bedrag, betaald_op, CASE WHEN betaald_op IS NOT NULL THEN betaald_op - vervaldatum END AS dagen
      FROM verkoopfacturen WHERE klant_id = $1 ORDER BY datum DESC LIMIT 24`, [id]);
  const berichten = await rows(`SELECT b.id, b.soort, b.kanaal, b.status, left(b.tekst, 260) AS tekst, b.aangemaakt, b.verstuurd_op, f.nummer AS factuur
      FROM berichten_uit b LEFT JOIN facturen f ON f.id = b.factuur_id WHERE b.klant_id = $1 ORDER BY coalesce(b.verstuurd_op, b.aangemaakt) DESC LIMIT 12`, [id]);
  const aanbod = await rows(`SELECT count(*) AS keer, sum(t.aantal) AS stuks FROM toewijzingen t WHERE t.klant_id = $1 AND t.soort = 'aanbod' AND t.status <> 'afgewezen'`, [id]);
  // what is open now in the workflow for this customer
  const lopend = await rows(`
    SELECT f.id AS factuur_id, f.nummer, g.naam AS kweker, p.naam AS plant, p.potmaat, t.aantal, t.status, t.soort
      FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id JOIN kwekers g ON g.id = f.kweker_id JOIN planten p ON p.id = fr.plant_id
     WHERE t.klant_id = $1 AND t.status IN ('voorstel', 'bevestigd') AND f.datum >= current_date - 1 ORDER BY f.datum, f.id`, [id]);
  const fam = {};
  let totaal = 0;
  for (const p of planten) {
    const k = familyKey(p); totaal += Number(p.omzet);
    fam[k] = fam[k] || { naam: p.naam.replace(/\s(wit|roze|paars|blauw|geel|oranje|rood)$/, ''), maat: [p.potmaat, p.hoogte].filter(Boolean).join(' '), omzet: 0, stuks: 0, kleuren: [] };
    fam[k].omzet += Number(p.omzet); fam[k].stuks += Number(p.stuks);
    const kl = p.naam.match(/\s(wit|roze|paars|blauw|geel|oranje|rood)$/); if (kl) fam[k].kleuren.push({ kleur: kl[1], stuks: Number(p.stuks) });
  }
  const families = Object.values(fam).sort((a, b) => b.omzet - a.omzet).map(f => ({ ...f, aandeel: totaal ? Math.round(f.omzet / totaal * 100) : 0 }));
  const result = { ...c, planten, families, maanden, weekdagen, orders: orders.map(o => ({ ...o, laat: o.laat == null ? null : Number(o.laat) })), kwekers, facturen, berichten, lopend, aanbod: aanbod[0] };
  result.inzichten = customerInsights(result);
  result.belemmeringen = obstaclesCustomer(result);
  return result;
}

const DAG = ['', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
function customerInsights(c) {
  const out = [];
  if (c.ritme) {
    const spread = c.spreiding ? ` (± ${c.spreiding})` : '';
    if (c.te_laat_dagen != null && c.te_laat_dagen > Math.max(3, (c.spreiding || 0))) out.push({ toon: 'bad', tekst: `Bestelt normaal elke ${c.ritme} dagen${spread}, maar de laatste bestelling is ${c.dagen_sinds} dagen geleden: ${c.te_laat_dagen} dagen later dan verwacht. Even bellen of appen?` });
    else if (c.te_laat_dagen != null && c.te_laat_dagen >= -2) out.push({ toon: 'info', tekst: `Bestelt elke ${c.ritme} dagen${spread}. De volgende bestelling wordt ${c.te_laat_dagen >= 0 ? 'nu' : `over ${-c.te_laat_dagen} ${-c.te_laat_dagen === 1 ? 'dag' : 'dagen'}`} verwacht.` });
    else out.push({ toon: 'ok', tekst: `Vast ritme: bestelt elke ${c.ritme} dagen${spread}. Volgende bestelling rond ${new Date(c.volgende).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}.` });
  }
  if (c.trend != null && Math.abs(c.trend) >= 12) out.push({ toon: c.trend > 0 ? 'ok' : 'bad', tekst: `Omzet laatste 90 dagen ${c.trend > 0 ? '+' : ''}${c.trend}% ten opzichte van ${c.trend_basis === 'jaar' ? 'dezelfde periode vorig jaar' : 'de 90 dagen ervoor'}.` });
  if (c.families[0]) {
    const f = c.families[0];
    const kl = f.kleuren.length ? `, vooral ${f.kleuren.sort((a, b) => b.stuks - a.stuks).slice(0, 2).map(x => x.kleur).join(' en ')}` : '';
    out.push({ toon: 'info', tekst: `Koopt vooral ${f.naam} ${f.maat}: ${f.aandeel}% van de omzet${kl}.${c.families[1] ? ` Daarna ${c.families[1].naam} (${c.families[1].aandeel}%).` : ''}` });
  }
  if (c.betaal_dagen != null) {
    if (c.betaal_dagen > 7) out.push({ toon: 'bad', tekst: `Betaalt gemiddeld ${Math.round(c.betaal_dagen)} dagen na de vervaldatum.${c.over_tijd ? ` Nu staat ${eur(c.over_tijd)} over tijd open.` : ''}` });
    else if (c.betaal_dagen <= 1) out.push({ toon: 'ok', tekst: `Betaalt op tijd (gemiddeld ${c.betaal_dagen <= 0 ? `${Math.abs(Math.round(c.betaal_dagen))} dagen vóór` : '1 dag na'} de vervaldatum).` });
  }
  if (c.kredietlimiet && c.open_bedrag > c.kredietlimiet) out.push({ toon: 'bad', tekst: `Open bedrag ${eur(c.open_bedrag)} is hoger dan de kredietlimiet van ${eur(c.kredietlimiet)}.` });
  if (c.marge_pct != null) out.push({ toon: c.marge_pct >= 28 ? 'ok' : c.marge_pct < 18 ? 'wait' : 'info', tekst: `Marge ${String(c.marge_pct).replace('.', ',')}% op ${eur(c.omzet_12m)} omzet in 12 maanden (${c.rang}e van ${c.klanten_totaal} klanten).` });
  if (c.op_tijd != null && c.leveringen >= 5 && c.op_tijd < 85) out.push({ toon: 'wait', tekst: `Campo leverde hier ${c.op_tijd}% op tijd. Vaak door late kwekers: kijk welke kwekers deze klant bedienen.` });
  if (Number(c.aanbod?.keer) >= 3) out.push({ toon: 'ok', tekst: `Neemt restpartijen af: ${c.aanbod.keer}× een aanbod aangenomen. Goede kandidaat als er iets over is.` });
  const wd = c.weekdagen.slice().sort((a, b) => b.n - a.n)[0];
  if (wd && c.orders_12m >= 6 && wd.n / c.orders_12m >= 0.4) out.push({ toon: 'info', tekst: `Bestelt meestal op ${DAG[wd.dag]} (${Math.round(wd.n / c.orders_12m * 100)}% van de bestellingen).` });
  return out;
}

// ---------------------------------------------------------------- what stands in the way of working together
// Each obstacle has a kind (soort: bezorgen, betalen, bestellen, compleet, kwaliteit, prijs, contact), a tone
// (bad: serious, wait: keep in mind), a few words for a chip (kort) and one sentence with the numbers (tekst).
const DAGK = ['', 'ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const dur = m => (m >= 90 ? `${Math.round(m / 60)} uur` : `${m} min`);
const daysList = (arr, names) => { const a = arr.map(d => names[d]); return a.length > 1 ? `${a.slice(0, -1).join(', ')} en ${a[a.length - 1]}` : a[0]; };
const comma = v => String(v).replace('.', ',');
const severity = o => (o.toon === 'bad' ? 0 : 1);

// "di–vr 06:00–09:00" -> a window of 3 hours from 06:00; "di en vr vóór 07:00" -> before 07:00; "in overleg" -> nothing
export function deliveryWindow(text) {
  if (!text) return null;
  const t = [...String(text).matchAll(/(\d{1,2})[:.](\d{2})/g)].map(m => ({ min: Number(m[1]) * 60 + Number(m[2]), txt: `${m[1].padStart(2, '0')}:${m[2]}` }));
  if (t.length >= 2) return { start: t[0].min, end: t[1].min, width: (t[1].min - t[0].min) / 60, text: `${t[0].txt}–${t[1].txt}` };
  if (t.length === 1 && /v[óo]{1,2}r/i.test(text)) return { before: t[0].min, text: t[0].txt };
  return null;
}

export function obstaclesCustomer(c) {
  if (!c.actief) return [];
  const out = [];
  const add = (soort, toon, kort, tekst) => out.push({ soort, toon, kort, tekst });
  const far = c.reistijd_min >= 720;
  const road = far ? `, ${dur(c.reistijd_min)} rijden vanaf Nootdorp` : '';
  // paying
  if (c.kredietlimiet && c.open_bedrag > c.kredietlimiet) add('betalen', 'bad', 'Boven kredietlimiet', `Er staat ${eur(c.open_bedrag)} open bij een kredietlimiet van ${eur(c.kredietlimiet)}. Eerst betalen, dan weer leveren.`);
  else if (c.kredietlimiet && c.open_bedrag > 0.9 * c.kredietlimiet) add('betalen', 'wait', 'Bijna aan kredietlimiet', `${eur(c.open_bedrag)} open van de ${eur(c.kredietlimiet)} kredietlimiet (${Math.round(c.open_bedrag / c.kredietlimiet * 100)}%).`);
  if (c.over_tijd >= 1000) add('betalen', c.over_tijd >= 5000 ? 'bad' : 'wait', `${eur(c.over_tijd)} over tijd`, `${eur(c.over_tijd)} is niet op tijd betaald en staat nog open.`);
  if (c.betaal_dagen != null && c.betaal_dagen > 10) add('betalen', c.betaal_dagen > 18 ? 'bad' : 'wait', `Betaalt ${Math.round(c.betaal_dagen)} d te laat`, `Betaalt gemiddeld ${Math.round(c.betaal_dagen)} dagen na de vervaldatum, bij een betaaltermijn van ${c.betaaltermijn} dagen.`);
  // delivering
  if (c.op_tijd != null && c.leveringen >= 5 && c.op_tijd < 70) add('bezorgen', c.op_tijd < 60 ? 'bad' : 'wait', `${c.op_tijd}% op tijd geleverd`, `Campo leverde hier in twaalf maanden ${c.op_tijd}% op tijd${road}. Vaak door een kweker die te laat was.`);
  const w = deliveryWindow(c.levervenster);
  if (w && w.width != null && w.width <= 2 && (far || w.start <= 6 * 60)) add('bezorgen', 'wait', `Smal venster ${w.text}`, `Levering alleen tussen ${w.text}${road}. Een kweker die te laat is of een wagen die later vertrekt, haalt dat niet.`);
  else if (w && w.before != null && w.before <= 7 * 60) add('bezorgen', 'wait', `Vóór ${w.text} binnen`, `Moet vóór ${w.text} binnen zijn${road}: de wagen moet de avond ervoor geladen zijn.`);
  if (Array.isArray(c.leverdagen) && c.leverdagen.length === 1 && (far || (c.op_tijd != null && c.op_tijd < 80))) add('bezorgen', 'wait', `Alleen op ${DAGK[c.leverdagen[0]]}`, `Neemt alleen op ${DAG[c.leverdagen[0]]} levering aan${road}: een gemiste wagen schuift een week op.`);
  // ordering
  if (c.segment === 'slapend') add('bestellen', 'bad', `Bestelt ${c.te_laat_dagen} d later dan normaal`, `Bestelt normaal elke ${c.ritme} dagen; de laatste bestelling is ${c.dagen_sinds} dagen geleden.`);
  else if (c.trend != null && c.trend <= -18) add('bestellen', 'wait', `Omzet ${c.trend}%`, `Omzet laatste 90 dagen ${c.trend}% ten opzichte van ${c.trend_basis === 'jaar' ? 'dezelfde periode vorig jaar' : 'de 90 dagen ervoor'}.`);
  // margin and contact
  if (c.marge_pct != null && c.omzet_12m > 0 && c.marge_pct < 15) add('prijs', 'wait', `Marge ${comma(c.marge_pct)}%`, `Maar ${comma(c.marge_pct)}% marge op ${eur(c.omzet_12m)} omzet in twaalf maanden.`);
  if (!c.whatsapp && !c.email) add('contact', 'wait', 'Geen WhatsApp of e-mail', 'Er staat geen WhatsApp-nummer of e-mailadres: alleen bellen kan.');
  return out.sort((a, b) => severity(a) - severity(b));
}

export function obstaclesGrower(g, x = {}) {
  if (!g.actief) return [];
  const out = [];
  const add = (soort, toon, kort, tekst) => out.push({ soort, toon, kort, tekst });
  // delivering
  if (g.leveringen >= 5 && g.op_tijd != null && g.op_tijd < 85) add('bezorgen', g.op_tijd < 72 ? 'bad' : 'wait', `${g.op_tijd}% op tijd`, `${g.op_tijd}% van de leveringen kwam op tijd binnen; als het misgaat gemiddeld ${g.gem_te_laat} minuten te laat.`);
  if (x && x.recent_n >= 5 && x.recent_laat >= 3) add('bezorgen', 'bad', `${x.recent_laat} van de laatste 5 te laat`, `Van de laatste vijf leveringen kwamen er ${x.recent_laat} te laat binnen: slechter dan het jaargemiddelde.`);
  if (Array.isArray(g.levert_op) && g.levert_op.length && g.levert_op.length <= 2) add('bezorgen', 'wait', `Levert alleen ${daysList(g.levert_op, DAGK)}`, `Levert alleen op ${daysList(g.levert_op, DAG)}: bestel ruim op tijd.`);
  if (g.reistijd_min >= 480) add('bezorgen', 'wait', `${dur(g.reistijd_min)} onderweg`, `De planten komen van ver (${g.vervoer || 'eigen vervoer'}, ongeveer ${dur(g.reistijd_min)}): een vertraging raakt alle klanten op die wagen.`);
  // complete and quality
  if (g.facturen >= 5) {
    const m = g.minder / g.facturen, q = g.kwaliteit / g.facturen;
    if (m >= 0.12) add('compleet', m >= 0.2 ? 'bad' : 'wait', 'Levert vaak minder', `Bij ${g.minder} van de ${g.facturen} leveringen kwam er minder dan besteld (${Math.round(m * 100)}%).`);
    if (q >= 0.06 && g.kwaliteit >= 2) add('kwaliteit', q >= 0.1 ? 'bad' : 'wait', `Schade of kwaliteit ${g.kwaliteit}×`, `${g.kwaliteit} van de ${g.facturen} leveringen hadden schade of slechte kwaliteit.`);
    if (g.prijsafwijking >= 3 && g.prijsafwijking / g.facturen >= 0.1) add('prijs', 'wait', `Factuur wijkt ${g.prijsafwijking}× af`, `${g.prijsafwijking} van de ${g.facturen} facturen hadden een andere prijs dan afgesproken; samen ${eur(g.afwijking_bedrag)} aan afwijkingen dit jaar.`);
  }
  if (g.prijsindex != null && g.prijsindex >= 104) add('prijs', 'wait', `${Math.round(g.prijsindex - 100)}% boven de markt`, `Gemiddeld ${Math.round(g.prijsindex - 100)}% duurder dan andere kwekers voor dezelfde planten.`);
  if (g.open_afwijkingen >= 2) add('prijs', 'wait', `${g.open_afwijkingen} afwijkingen open`, `${g.open_afwijkingen} afwijkingen staan nog open: een credit of nalevering.`);
  // contact
  if (x && x.laat_n >= 3 && x.stil_n / x.laat_n >= 0.5) add('contact', 'wait', 'Meldt vertraging vaak niet', `Van de ${x.laat_n} keer dat de wagen meer dan een half uur te laat was, kwam er ${x.stil_n} keer vooraf geen bericht.`);
  if (!g.whatsapp && !g.email) add('contact', 'wait', 'Geen WhatsApp of e-mail', 'Er staat geen WhatsApp-nummer of e-mailadres: alleen bellen kan.');
  return out.sort((a, b) => severity(a) - severity(b));
}

// ---------------------------------------------------------------- plants
export async function plantList() {
  return rows(`
    SELECT p.*,
      (SELECT count(DISTINCT f.kweker_id) FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id WHERE fr.plant_id = p.id AND f.datum > current_date - 365) AS kwekers,
      (SELECT count(DISTINCT t.klant_id) FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id WHERE fr.plant_id = p.id AND t.bestemming = 'klant' AND f.datum > current_date - 365) AS klanten,
      (SELECT sum(fr.aantal) FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id WHERE fr.plant_id = p.id AND f.datum > current_date - 365) AS stuks,
      (SELECT round(avg(fr.prijs), 3) FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id WHERE fr.plant_id = p.id AND f.datum > current_date - 60) AS inkoop,
      (SELECT round(min(fr.prijs), 3) FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id WHERE fr.plant_id = p.id AND f.datum > current_date - 60) AS inkoop_min,
      (SELECT round(avg(t.verkoopprijs), 2) FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id WHERE fr.plant_id = p.id AND t.bestemming = 'klant' AND f.datum > current_date - 60) AS verkoop
    FROM planten p ORDER BY p.groep, p.naam, p.potmaat`);
}

export async function plantDetail(id) {
  const p = await one('SELECT * FROM planten WHERE id = $1', [id]);
  if (!p) return null;
  const kwekers = await rows(`
    SELECT g.id, g.naam, g.plaats, count(DISTINCT f.id) AS keer, sum(fr.aantal) AS stuks, round(avg(fr.prijs), 3) AS prijs,
           round(avg(fr.prijs) FILTER (WHERE f.datum > current_date - 60), 3) AS prijs_nu, max(f.datum) AS laatst,
           round(avg((extract(epoch FROM (z.aankomst_werkelijk - z.aankomst_gepland)) / 60 <= 15)::int) * 100) AS op_tijd
      FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id JOIN kwekers g ON g.id = f.kweker_id LEFT JOIN zendingen z ON z.factuur_id = f.id AND z.aankomst_werkelijk <= now()
     WHERE fr.plant_id = $1 AND f.datum > current_date - 365 GROUP BY g.id ORDER BY sum(fr.aantal) DESC`, [id]);
  const klanten = await rows(`
    SELECT k.id, k.naam, k.plaats, k.land, sum(t.aantal) AS stuks, count(DISTINCT f.id) AS keer, round(avg(t.verkoopprijs), 2) AS prijs, max(f.datum) AS laatst
      FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id JOIN klanten k ON k.id = t.klant_id
     WHERE fr.plant_id = $1 AND t.bestemming = 'klant' AND t.status <> 'afgewezen' AND f.datum > current_date - 365 GROUP BY k.id ORDER BY sum(t.aantal) DESC`, [id]);
  const reeks = await rows(`
    SELECT to_char(date_trunc('month', f.datum), 'YYYY-MM') AS maand, f.kweker_id, round(avg(fr.prijs), 3) AS prijs, sum(fr.aantal) AS stuks
      FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id WHERE fr.plant_id = $1 AND f.datum > date_trunc('month', current_date) - interval '12 months' GROUP BY 1, 2 ORDER BY 1`, [id]);
  const namen = await rows(`SELECT pn.tekst, g.naam AS kweker, pn.door FROM plant_namen pn LEFT JOIN kwekers g ON g.id = pn.kweker_id WHERE pn.plant_id = $1 ORDER BY g.naam`, [id]);
  return { ...p, kwekers, klanten, reeks, namen };
}
