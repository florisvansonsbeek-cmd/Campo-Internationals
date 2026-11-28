// The archive: every paper of every week in one folder structure, so nothing gets lost. Per year and week: the
// purchase side (per batch and supplier: Jan's order, the confirmation, the shipping papers, the phyto), the sales side
// (per customer the packing slip with invoice, as it went out), the offers of that week and the Excel for Exact.
// The same structure downloads as a zip, per week or per year. And a back-up of the whole database as CSV files.
import { rows, one, pool } from '../db.js';
import { isoWeek, today } from './util.js';
import { slipPdfById } from './mail.js';
import { safeName, makeZip } from '../zip.js';

const DOC = { bestelling: 'Bestelling van Jan', bevestiging: 'Bevestiging', verzendbewijs: 'Verzendbewijs', awb: 'Luchtvrachtbrief (AWB)', fyto: 'Fytosanitair certificaat', overig: 'Overig' };
const MONTH = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' });
const weekName = m => `Week ${String(isoWeek(m).week).padStart(2, '0')} (${MONTH.format(new Date(`${m}T12:00:00`)).replace('.', '')})`;
// The size of the whole database in Dutch: 3,8 MB rather than pg's "3808 kB".
export const DB_SIZE_SQL = `SELECT sum(pg_total_relation_size(c.oid))::bigint AS b FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'campo' AND c.relkind = 'r'`;
export function sizeNl(bytes) {
  const b = Number(bytes || 0);
  if (!b) return null;
  const f = (v, d) => v.toLocaleString('nl-NL', { maximumFractionDigits: d });
  return b >= 1e9 ? `${f(b / 1e9, 1)} GB` : b >= 1e6 ? `${f(b / 1e6, 1)} MB` : `${f(Math.max(1, Math.round(b / 1e3)), 0)} kB`;
}
const ext = mime => (/pdf/.test(mime) ? 'pdf' : /png/.test(mime) ? 'png' : /jpe?g/.test(mime) ? 'jpg' : /xml/.test(mime) ? 'xml' : /text/.test(mime) ? 'txt' : 'bin');

// the folder tree of one year, as the Controle tab shows it
export async function archiveTree(jaar = Number(today().slice(0, 4))) {
  const van = `${jaar}-01-01`, tot = `${jaar}-12-31`;
  const ps = await rows(`SELECT p.id, p.nummer, p.maandag, p.verzonden_op, p.fyto, p.awb, l.naam AS leverancier FROM partijen p JOIN leveranciers l ON l.id = p.leverancier_id
    WHERE p.maandag BETWEEN $1 AND $2 AND p.besteld_op IS NOT NULL AND p.besteld_op <= now() ORDER BY p.maandag DESC, p.nummer, l.naam`, [van, tot]);
  const docs = ps.length ? await rows(`SELECT d.id, d.partij_id, d.soort, d.titel, d.bestand_id, d.tekst IS NOT NULL AS tekst, d.ontvangen, b.naam, b.mime, b.grootte
    FROM partij_documenten d LEFT JOIN bestanden b ON b.id = d.bestand_id WHERE d.partij_id = ANY($1) AND d.ontvangen <= now() ORDER BY d.ontvangen`, [ps.map(p => p.id)]) : [];
  const slips = await rows(`SELECT s.id, s.nummer, s.maandag, s.datum, s.klant_id, s.pdf_id, s.exact, k.naam AS klant FROM pakbonnen s JOIN klanten k ON k.id = s.klant_id
    WHERE s.status = 'akkoord' AND s.maandag BETWEEN $1 AND $2 ORDER BY s.maandag DESC, s.nummer`, [van, tot]);
  const offers = await rows(`SELECT a.id, a.maandag, a.dozen, a.prijs_usd, a.status, a.notitie, l.naam AS leverancier, d.naam AS product, d.maat FROM leverancier_aanbod a
    JOIN leveranciers l ON l.id = a.leverancier_id JOIN producten d ON d.id = a.product_id WHERE a.maandag BETWEEN $1 AND $2 ORDER BY a.maandag DESC, a.id`, [van, tot]);
  const weeks = [...new Set([...ps.map(p => p.maandag), ...slips.map(s => s.maandag), ...offers.map(o => o.maandag)])].sort().reverse();
  const jaren = (await rows(`SELECT DISTINCT extract(year FROM maandag)::int AS j FROM partijen UNION SELECT DISTINCT extract(year FROM maandag)::int FROM pakbonnen ORDER BY 1 DESC`)).map(x => x.j);
  const out = weeks.map(m => {
    const inkoop = ps.filter(p => p.maandag === m).map(p => ({
      id: p.id, nummer: p.nummer, leverancier: p.leverancier, map: safeName(`${p.nummer} ${p.leverancier}`),
      bestanden: docs.filter(d => d.partij_id === p.id).map(d => ({ id: d.id, soort: d.soort, soortNaam: DOC[d.soort] || d.soort, titel: d.titel, op: d.ontvangen,
        naam: safeName(`${DOC[d.soort] || d.soort}${d.titel ? ` - ${d.titel}` : ''}.${d.bestand_id ? ext(d.mime) : 'txt'}`), url: d.bestand_id ? `/api/bestanden/${d.bestand_id}` : `/api/week/archief/document/${d.id}`, grootte: d.grootte || null })),
      fyto: p.fyto, awb: p.awb,
    }));
    const verkoop = slips.filter(s => s.maandag === m).map(s => ({ id: s.id, nummer: s.nummer, klant: s.klant, klant_id: s.klant_id, bevroren: !!s.pdf_id, exact: s.exact,
      naam: safeName(`Pakbon en factuur ${s.nummer} ${s.klant}.pdf`), url: `/api/week/pakbonnen/${s.id}/pdf` }));
    const aanbod = offers.filter(o => o.maandag === m).map(o => ({ id: o.id, naam: safeName(`Aanbod ${o.leverancier} ${o.product} ${o.maat}.txt`), tekst: `${o.dozen} dozen ${o.product} ${o.maat} van ${o.leverancier}, $ ${Number(o.prijs_usd).toFixed(3).replace('.', ',')} per stuk (${o.status})`, url: `/api/week/archief/aanbod/${o.id}` }));
    const files = inkoop.reduce((t, p) => t + p.bestanden.length, 0) + verkoop.length + aanbod.length + (verkoop.length ? 1 : 0);
    return { maandag: m, week: isoWeek(m).week, naam: weekName(m), inkoop, verkoop, aanbod, exact: verkoop.length ? { naam: `Exact week ${isoWeek(m).week} ${isoWeek(m).jaar}.xlsx`, url: `/api/week/weken/${m}/exact.xlsx` } : null, bestanden: files,
      zip: `/api/week/archief.zip?maandag=${m}` };
  });
  return { jaar, jaren: jaren.length ? jaren : [jaar], weken: out, samen: { weken: out.length, bestanden: out.reduce((t, w) => t + w.bestanden, 0), zendingen: ps.length, facturen: slips.length } };
}

export async function documentText(id) {
  const d = await one('SELECT d.*, p.nummer FROM partij_documenten d JOIN partijen p ON p.id = d.partij_id WHERE d.id = $1', [id]);
  return d && d.tekst != null ? { naam: safeName(`${DOC[d.soort] || d.soort} ${d.nummer}.txt`), tekst: d.tekst } : null;
}
export async function offerText(id) {
  const o = await one(`SELECT a.*, l.naam AS leverancier, d.naam AS product, d.maat FROM leverancier_aanbod a JOIN leveranciers l ON l.id = a.leverancier_id JOIN producten d ON d.id = a.product_id WHERE a.id = $1`, [id]);
  if (!o) return null;
  return { naam: safeName(`Aanbod ${o.leverancier} ${o.product} ${o.maat}.txt`), tekst: [
    `Aanbod van ${o.leverancier} voor week ${isoWeek(o.maandag).week}`, '', `${o.dozen} dozen ${o.product} ${o.maat}`, `Prijs: $ ${Number(o.prijs_usd).toFixed(3).replace('.', ',')} per stuk`,
    `Stand: ${o.status === 'genomen' ? `aangenomen${o.genomen_dozen ? ` (${o.genomen_dozen} dozen)` : ''}` : o.status === 'afgewezen' ? 'niet genomen' : 'open'}`, o.notitie ? `\nWat hij schreef:\n${o.notitie}` : '',
  ].join('\n') };
}

// everything of one week or one year as a zip with the same folders
export async function archiveZip({ jaar, maandag }) {
  const y = maandag ? isoWeek(maandag).jaar : jaar;
  const tree = await archiveTree(maandag ? Number(String(maandag).slice(0, 4)) : y);
  const weeks = maandag ? tree.weken.filter(w => w.maandag === maandag) : tree.weken;
  const { exactWorkbook } = await import('./excel.js');
  const files = [];
  const root = `Campo archief ${y}`;
  for (const w of weeks) {
    const base = `${root}/${w.naam}`;
    const docIds = w.inkoop.flatMap(p => p.bestanden.map(b => b.id));
    const docs = docIds.length ? await rows(`SELECT d.id, d.tekst, b.data FROM partij_documenten d LEFT JOIN bestanden b ON b.id = d.bestand_id WHERE d.id = ANY($1)`, [docIds]) : [];
    for (const p of w.inkoop) for (const b of p.bestanden) {
      const d = docs.find(x => x.id === b.id);
      if (d) files.push({ naam: `${base}/Inkoop/${p.map}/${b.naam}`, data: d.data || d.tekst || '', datum: b.op });
    }
    for (const s of w.verkoop) {
      const frozen = s.bevroren ? await one('SELECT b.data FROM pakbonnen s JOIN bestanden b ON b.id = s.pdf_id WHERE s.id = $1', [s.id]) : null;
      const pdf = frozen?.data || (await slipPdfById(s.id))?.pdf;
      if (pdf) files.push({ naam: `${base}/Verkoop/${s.naam}`, data: Buffer.from(pdf) });
    }
    for (const a of w.aanbod) { const t = await offerText(a.id); if (t) files.push({ naam: `${base}/Aanbod/${t.naam}`, data: t.tekst }); }
    if (w.exact) {
      const { wb } = await exactWorkbook(w.maandag);
      files.push({ naam: `${base}/${w.exact.naam}`, data: Buffer.from(await wb.xlsx.writeBuffer()) });
    }
  }
  files.push({ naam: `${root}/Lees mij.txt`, data: [
    `Archief van Campo International, ${maandag ? weeks[0]?.naam || '' : `heel ${y}`}.`, `Gemaakt door de Campo desk op ${new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })}.`, '',
    'Per week:', '  Inkoop/<batchnummer en leverancier>: de bestelling van Jan, de bevestiging en de verzendpapieren zoals ze binnenkwamen.',
    '  Verkoop: per klant de pakbon die ook de factuur is, met het plantenpaspoort.', '  Aanbod: wat leveranciers die week aanboden.', '  Exact week ... .xlsx: de regels zoals ze in Exact horen.', '',
    'Bewaar dit zeven jaar (fiscale bewaarplicht).',
  ].join('\r\n') });
  return { zip: makeZip(files), naam: maandag ? `Campo archief ${y} ${weeks[0]?.naam || maandag}.zip` : `Campo archief ${y}.zip`, bestanden: files.length };
}

// ---------------------------------------------------------------- the database as files: one CSV per table
const SECRET = new Set(['outlook', 'outlook_state', 'exact', 'exact_state', 'imap', 'sessie', 'sessions']);
const csvCell = v => {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export async function backupZip() {
  const tables = (await rows(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'campo' AND table_type = 'BASE TABLE' ORDER BY table_name`)).map(t => t.table_name);
  const files = [], counts = [];
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const t of tables) {
      const cols = (await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'campo' AND table_name = $1 ORDER BY ordinal_position`, [t])).rows;
      // the files themselves are in the archive zip; tokens and passwords never leave the desk
      const keep = cols.filter(x => x.data_type !== 'bytea' && !/wachtwoord|token|secret/i.test(x.column_name));
      if (!keep.length) continue;
      let r = (await c.query(`SELECT ${keep.map(x => `"${x.column_name}"`).join(', ')} FROM campo."${t}"`)).rows;
      if (t === 'instellingen') r = r.filter(x => !SECRET.has(x.sleutel));
      if (/^sessie|session/.test(t)) continue;
      const body = [keep.map(x => x.column_name).join(';'), ...r.map(x => keep.map(k => csvCell(x[k.column_name])).join(';'))].join('\r\n');
      files.push({ naam: `Campo database/${t}.csv`, data: `﻿${body}` });
      counts.push([t, r.length]);
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  files.push({ naam: 'Campo database/Lees mij.txt', data: [
    `Back-up van de Campo desk, ${new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })}.`, '',
    'Elke tabel is een CSV-bestand (puntkomma als scheiding, UTF-8), te openen in Excel.', 'De bestanden zelf (pdf\'s van verzendbewijzen en facturen) staan in het archief, per jaar te downloaden.',
    'Wachtwoorden en koppelingssleutels zitten er niet in.', '', 'Tabellen:', ...counts.map(([t, n]) => `  ${t}: ${n} rijen`),
  ].join('\r\n') });
  const d = new Date().toISOString().slice(0, 10);
  return { zip: makeZip(files), naam: `Campo database ${d}.zip`, tabellen: counts.length };
}

// ---------------------------------------------------------------- the lists of the database, for the Controle tab
export async function databaseLists(jaar = Number(today().slice(0, 4))) {
  const van = `${jaar}-01-01`, tot = `${jaar}-12-31`;
  const planten = await rows(`SELECT d.id, d.code, d.exact_code, d.naam, d.soort, d.maat, d.per_doos, d.prijs_usd, d.actief,
      (SELECT string_agg(DISTINCT l.naam, ', ') FROM partij_regels r JOIN partijen p ON p.id = r.partij_id JOIN leveranciers l ON l.id = p.leverancier_id WHERE r.product_id = d.id) AS leveranciers,
      (SELECT coalesce(sum(x.dozen), 0) FROM pakbon_regels x JOIN pakbonnen s ON s.id = x.pakbon_id WHERE x.product_id = d.id AND s.status = 'akkoord' AND s.maandag BETWEEN $1 AND $2) AS dozen,
      (SELECT coalesce(sum(x.bedrag), 0) FROM pakbon_regels x JOIN pakbonnen s ON s.id = x.pakbon_id WHERE x.product_id = d.id AND s.status = 'akkoord' AND s.maandag BETWEEN $1 AND $2) AS omzet
    FROM producten d ORDER BY d.naam, d.per_doos DESC, d.maat`, [van, tot]);
  const klanten = await rows(`SELECT k.id, k.naam, k.plaats, k.land, k.exact_code, k.btw_nummer, coalesce(k.factuur_email, k.email) AS email, k.telefoon,
      (SELECT count(*) FROM pakbonnen s WHERE s.klant_id = k.id AND s.status = 'akkoord' AND s.maandag BETWEEN $1 AND $2) AS facturen,
      (SELECT coalesce(sum(s.totaal), 0) FROM pakbonnen s WHERE s.klant_id = k.id AND s.status = 'akkoord' AND s.maandag BETWEEN $1 AND $2) AS omzet
    FROM klanten k ORDER BY k.naam`, [van, tot]);
  const leveranciers = await rows(`SELECT l.id, l.naam, l.plaats, l.regio, l.exact_code, l.email,
      (SELECT count(*) FROM partijen p WHERE p.leverancier_id = l.id AND p.maandag BETWEEN $1 AND $2) AS zendingen FROM leveranciers l ORDER BY l.naam`, [van, tot]);
  const batches = await rows(`SELECT p.id, p.nummer, p.maandag, p.regio, l.naam AS leverancier, p.exact, p.binnen_op,
      coalesce(sum(coalesce(r.geteld, r.verzonden, r.bevestigd, r.besteld, 0)), 0) AS dozen_in, coalesce(sum(r.uitval), 0) AS uitval,
      (SELECT coalesce(sum(x.dozen), 0) FROM pakbon_regels x JOIN pakbonnen s ON s.id = x.pakbon_id WHERE s.status = 'akkoord' AND x.regel_id IN (SELECT id FROM partij_regels WHERE partij_id = p.id)) AS dozen_uit
    FROM partijen p JOIN leveranciers l ON l.id = p.leverancier_id LEFT JOIN partij_regels r ON r.partij_id = p.id
    WHERE p.maandag BETWEEN $1 AND $2 GROUP BY p.id, l.naam ORDER BY p.maandag DESC, p.nummer, l.naam`, [van, tot]);
  const facturen = await rows(`SELECT s.id, s.nummer, s.datum, s.maandag, s.klant_id, k.naam AS klant, s.totaal, s.btw_pct, s.exact, s.exact_nummer
    FROM pakbonnen s JOIN klanten k ON k.id = s.klant_id WHERE s.status = 'akkoord' AND s.maandag BETWEEN $1 AND $2 ORDER BY s.nummer DESC`, [van, tot]);
  const grootte = await one(DB_SIZE_SQL);
  return { jaar, planten, klanten, leveranciers, batches: batches.map(b => ({ ...b, week: isoWeek(b.maandag).week, rest: Number(b.dozen_in) - Number(b.uitval) - Number(b.dozen_uit) })), facturen, grootte: sizeNl(grootte?.b) };
}
