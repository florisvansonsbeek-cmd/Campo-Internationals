// Looking back: every customer's year, and the whole year per week, per region and per batch (does it net out to zero).
import { rows, one } from '../db.js';
import { addDays, focusMonday, isoWeek, mondayOf, today, r2 } from './util.js';

const yearRange = jaar => [`${jaar}-01-01`, `${jaar}-12-31`];

export async function years() {
  return (await rows(`SELECT DISTINCT extract(year FROM maandag)::int AS jaar FROM weken WHERE EXISTS (SELECT 1 FROM partijen p WHERE p.maandag = weken.maandag) ORDER BY 1 DESC`)).map(r => r.jaar);
}

export async function customerList({ jaar = Number(today().slice(0, 4)) } = {}) {
  const [a, b] = yearRange(jaar);
  const focus = focusMonday(), from = addDays(mondayOf(today()), -7 * 11);
  const list = await rows(`SELECT k.id, k.code, k.naam, k.plaats, k.land, k.taal, k.soort, k.contact, k.telefoon, k.email, k.factuur_email, k.exact_code, k.btw_nummer, k.actief, k.betaaltermijn,
      coalesce(s.omzet, 0) AS omzet, coalesce(s.dozen, 0) AS dozen, coalesce(s.pakbonnen, 0) AS pakbonnen, s.laatst,
      (SELECT coalesce(sum(o.dozen), 0) FROM weekorders o WHERE o.klant_id = k.id AND o.maandag = $3 AND o.aangemaakt <= now()) AS nu_dozen,
      (SELECT coalesce(sum(o.dozen), 0) FROM weekorders o WHERE o.klant_id = k.id AND o.maandag = $3::date + 7 AND o.aangemaakt <= now()) AS straks_dozen
    FROM klanten k
    LEFT JOIN (SELECT p.klant_id, sum(r.bedrag) AS omzet, sum(r.dozen) AS dozen, count(DISTINCT p.id) AS pakbonnen, max(p.maandag) AS laatst
      FROM pakbonnen p JOIN pakbon_regels r ON r.pakbon_id = p.id WHERE p.status = 'akkoord' AND p.maandag BETWEEN $1 AND $2 GROUP BY p.klant_id) s ON s.klant_id = k.id
    ORDER BY k.naam`, [a, b, focus]);
  const weekly = await rows(`SELECT p.klant_id, p.maandag, sum(r.bedrag) AS omzet FROM pakbonnen p JOIN pakbon_regels r ON r.pakbon_id = p.id
     WHERE p.status = 'akkoord' AND p.maandag >= $1 GROUP BY 1, 2`, [from]);
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(from, i * 7));
  for (const k of list) k.reeks = weeks.map(w => Number(weekly.find(x => x.klant_id === k.id && x.maandag === w)?.omzet || 0));
  return { jaar, focus, lijst: list, totaal: r2(list.reduce((s, k) => s + Number(k.omzet), 0)) };
}

export async function customerDetail(id, { jaar = Number(today().slice(0, 4)) } = {}) {
  const k = await one('SELECT * FROM klanten WHERE id = $1', [id]);
  if (!k) return null;
  const [a, b] = yearRange(jaar);
  const focus = focusMonday();
  const perWeek = await rows(`SELECT p.maandag, sum(r.bedrag) AS omzet, sum(r.dozen) AS dozen, sum(r.stuks) AS stuks,
      round(sum(r.bedrag - r.stuks * coalesce(pr.prijs_usd, 0) / p.koers), 2) AS marge
    FROM pakbonnen p JOIN pakbon_regels r ON r.pakbon_id = p.id LEFT JOIN partij_regels pr ON pr.id = r.regel_id
    WHERE p.klant_id = $1 AND p.status = 'akkoord' AND p.maandag BETWEEN $2 AND $3 GROUP BY p.maandag ORDER BY p.maandag`, [id, a, b]);
  const mix = await rows(`SELECT d.id, d.code, d.naam, d.maat, d.soort, sum(r.dozen) AS dozen, sum(r.stuks) AS stuks, sum(r.bedrag) AS omzet, count(DISTINCT p.maandag) AS weken
    FROM pakbonnen p JOIN pakbon_regels r ON r.pakbon_id = p.id JOIN producten d ON d.id = r.product_id
    WHERE p.klant_id = $1 AND p.status = 'akkoord' AND p.maandag BETWEEN $2 AND $3 GROUP BY d.id ORDER BY sum(r.bedrag) DESC`, [id, a, b]);
  const slips = await rows(`SELECT p.id, p.nummer, p.maandag, p.datum, p.totaal, p.btw_pct, p.exact, p.status,
      (SELECT sum(dozen) FROM pakbon_regels r WHERE r.pakbon_id = p.id) AS dozen,
      (SELECT c.status FROM concepten c WHERE c.pakbon_id = p.id AND c.status <> 'vervallen' LIMIT 1) AS mail
    FROM pakbonnen p WHERE p.klant_id = $1 ORDER BY p.maandag DESC LIMIT 40`, [id]);
  const deals = await rows(`SELECT d.id AS product_id, d.code, d.naam, d.maat, d.prijs_usd AS standaard, a.prijs_usd FROM producten d
    LEFT JOIN prijsafspraken a ON a.product_id = d.id AND a.klant_id = $1 WHERE d.actief ORDER BY d.volgorde`, [id]);
  const upcoming = await rows(`SELECT o.id, o.maandag, o.product_id, o.dozen, o.notitie, d.naam, d.maat FROM weekorders o JOIN producten d ON d.id = o.product_id
    WHERE o.klant_id = $1 AND o.maandag >= $2 AND o.aangemaakt <= now() ORDER BY o.maandag, d.volgorde`, [id, addDays(focus, -7)]);
  const omzet = r2(perWeek.reduce((s, w) => s + Number(w.omzet), 0));
  const weeksSoFar = Math.max(1, Math.min(52, isoWeek(today()).jaar === jaar ? isoWeek(today()).week : 52));
  return {
    klant: k, jaar, focus, perWeek, mix, slips, deals, upcoming,
    kpi: { omzet, dozen: perWeek.reduce((s, w) => s + Number(w.dozen), 0), weken: perWeek.length, van: weeksSoFar, gemiddeld: perWeek.length ? r2(omzet / perWeek.length) : 0, marge: r2(perWeek.reduce((s, w) => s + Number(w.marge || 0), 0)) },
  };
}

export async function yearData(jaar = Number(today().slice(0, 4))) {
  const [a, b] = yearRange(jaar);
  const weeks = await rows(`SELECT w.maandag, w.koers, w.geteld_op IS NOT NULL AS geteld,
      (SELECT count(*) FROM partijen p WHERE p.maandag = w.maandag) AS zendingen,
      (SELECT coalesce(sum(coalesce(r.geteld, r.verzonden, r.bevestigd, r.besteld, 0)), 0) FROM partijen p JOIN partij_regels r ON r.partij_id = p.id WHERE p.maandag = w.maandag) AS dozen_in,
      (SELECT coalesce(sum(coalesce(r.verzonden, r.bevestigd, r.besteld, 0) * r.per_doos * r.prijs_usd), 0) FROM partijen p JOIN partij_regels r ON r.partij_id = p.id WHERE p.maandag = w.maandag) AS inkoop_usd,
      (SELECT coalesce(sum(r.dozen), 0) FROM pakbonnen s JOIN pakbon_regels r ON r.pakbon_id = s.id WHERE s.maandag = w.maandag AND s.status = 'akkoord') AS dozen_uit,
      (SELECT coalesce(sum(r.bedrag), 0) FROM pakbonnen s JOIN pakbon_regels r ON r.pakbon_id = s.id WHERE s.maandag = w.maandag AND s.status = 'akkoord') AS omzet,
      (SELECT count(*) FROM pakbonnen s WHERE s.maandag = w.maandag AND s.status = 'akkoord') AS pakbonnen
    FROM weken w WHERE w.maandag BETWEEN $1 AND $2 AND EXISTS (SELECT 1 FROM partijen p WHERE p.maandag = w.maandag) ORDER BY w.maandag`, [a, b]);
  for (const w of weeks) {
    w.week = isoWeek(w.maandag).week;
    w.inkoop = w.koers ? r2(w.inkoop_usd / w.koers) : null;
    w.marge = w.inkoop != null && w.pakbonnen ? r2(w.omzet - w.inkoop) : null;
  }
  const batches = await rows(`WITH inn AS (
      SELECT p.id, p.nummer, p.regio, p.maandag, p.exact, l.naam AS leverancier, w.geteld_op IS NOT NULL AS geteld,
        sum(coalesce(r.geteld, r.verzonden, r.bevestigd, r.besteld, 0)) AS dozen_in, sum(r.uitval) AS uitval
      FROM partijen p JOIN partij_regels r ON r.partij_id = p.id JOIN leveranciers l ON l.id = p.leverancier_id JOIN weken w ON w.maandag = p.maandag
      WHERE p.maandag BETWEEN $1 AND $2 GROUP BY p.id, l.naam, w.geteld_op),
    uit AS (SELECT r.partij, sum(r.dozen) AS dozen_uit FROM pakbon_regels r JOIN pakbonnen s ON s.id = r.pakbon_id WHERE s.status = 'akkoord' GROUP BY r.partij)
    SELECT inn.*, coalesce(uit.dozen_uit, 0) AS dozen_uit, inn.dozen_in - inn.uitval - coalesce(uit.dozen_uit, 0) AS rest FROM inn LEFT JOIN uit ON uit.partij = inn.nummer ORDER BY inn.maandag, inn.nummer`, [a, b]);
  const regios = await rows(`SELECT code, naam, land FROM regios ORDER BY code`);
  const perRegio = regios.map(g => {
    const bs = batches.filter(x => x.regio === g.code && x.geteld);
    return { ...g, zendingen: bs.length, dozen_in: bs.reduce((s, x) => s + Number(x.dozen_in), 0), uitval: bs.reduce((s, x) => s + Number(x.uitval), 0), dozen_uit: bs.reduce((s, x) => s + Number(x.dozen_uit), 0), rest: bs.reduce((s, x) => s + Number(x.rest), 0) };
  }).filter(g => g.zendingen);
  const klanten = await rows(`SELECT k.id, k.naam, k.land, sum(r.bedrag) AS omzet, sum(r.dozen) AS dozen, count(DISTINCT p.maandag) AS weken
    FROM pakbonnen p JOIN pakbon_regels r ON r.pakbon_id = p.id JOIN klanten k ON k.id = p.klant_id
    WHERE p.status = 'akkoord' AND p.maandag BETWEEN $1 AND $2 GROUP BY k.id ORDER BY sum(r.bedrag) DESC LIMIT 12`, [a, b]);
  const producten = await rows(`SELECT d.id, d.code, d.naam, d.maat, sum(r.dozen) AS dozen, sum(r.stuks) AS stuks, sum(r.bedrag) AS omzet
    FROM pakbonnen p JOIN pakbon_regels r ON r.pakbon_id = p.id JOIN producten d ON d.id = r.product_id
    WHERE p.status = 'akkoord' AND p.maandag BETWEEN $1 AND $2 GROUP BY d.id ORDER BY sum(r.bedrag) DESC`, [a, b]);
  const done = weeks.filter(w => w.pakbonnen);
  const kpi = {
    zendingen: weeks.reduce((s, w) => s + Number(w.zendingen), 0), dozen_in: weeks.reduce((s, w) => s + Number(w.dozen_in), 0), dozen_uit: weeks.reduce((s, w) => s + Number(w.dozen_uit), 0),
    omzet: r2(weeks.reduce((s, w) => s + Number(w.omzet), 0)), inkoop: r2(done.reduce((s, w) => s + Number(w.inkoop || 0), 0)), pakbonnen: weeks.reduce((s, w) => s + Number(w.pakbonnen), 0),
    klanten: (await one(`SELECT count(DISTINCT klant_id) AS n FROM pakbonnen WHERE status = 'akkoord' AND maandag BETWEEN $1 AND $2`, [a, b])).n,
  };
  kpi.marge = r2(kpi.omzet - kpi.inkoop);
  const open = batches.filter(x => x.geteld && Number(x.rest) !== 0);
  const lopend = batches.filter(x => !x.geteld);
  return { jaar, jaren: await years(), weken: weeks, partijen: batches, regios: perRegio, verschil: open, lopend, klanten, producten, kpi };
}
