// One message in, everything the desk can make of it out: an invoice with lines matched to plants and
// customers, or a time update for a truck that is on its way. Nothing is paid, ordered or sent from here.
import { pool, rows, log } from '../db.js';
import { pdfRows, readInvoiceText, readTimeText, parseDate, parseNum } from './extract.js';
import { aiRead } from './ai.js';
import { matchPlant, matchGrower, lookalike, matchCustomerRef } from '../match.js';
import { proposeForInvoice } from '../allocate.js';

const slug = s => String(s || 'kweker').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'kweker';
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayAt = (h, m, base = new Date()) => { const x = new Date(base); x.setHours(h, m, 0, 0); return x; };

function normaliseAi(a) {
  if (!a || typeof a !== 'object') return null;
  const regels = Array.isArray(a.regels) ? a.regels.map(r => ({
    aantal: Math.round(parseNum(r.aantal) || 0), omschrijving: String(r.omschrijving || '').trim().slice(0, 200),
    prijs: parseNum(r.prijs, { unit: true }), bedrag: parseNum(r.bedrag), referentie: r.referentie ? String(r.referentie).slice(0, 120) : null,
  })).filter(r => r.aantal > 0 && r.omschrijving && r.prijs != null && r.prijs >= 0) : [];
  const hm = s => { const m = String(s || '').match(/(\d{1,2})[:.](\d{2})/); return m ? { h: +m[1], m: +m[2] } : null; };
  return {
    soort: ['factuur', 'pakbon', 'bevestiging', 'tijd', 'overig'].includes(a.soort) ? a.soort : (regels.length ? 'factuur' : 'overig'),
    leverancier: a.leverancier || {}, factuurnummer: a.factuurnummer ? String(a.factuurnummer).slice(0, 60) : null,
    datum: parseDate(a.datum), vervaldatum: parseDate(a.vervaldatum), totaal_excl: parseNum(a.totaal_excl), iban: a.iban || null, regels,
    tijd: a.tijd ? { vertrek: hm(a.tijd.vertrek), eta: hm(a.tijd.eta), vertraging: !!a.tijd.vertraging, reden: a.tijd.reden || null } : null,
    waarschuwingen: Array.isArray(a.waarschuwingen) ? a.waarschuwingen.map(String).slice(0, 6) : [],
    model: a._model,
  };
}

export async function processMessage(berichtId, { wie = 'desk' } = {}) {
  const claim = await pool.query(`UPDATE berichten_in SET status = 'bezig', fout = NULL WHERE id = $1 AND status IN ('nieuw', 'fout', 'genegeerd') RETURNING *`, [berichtId]);
  const b = claim.rows[0];
  if (!b) return { ok: false, reden: 'Dit bericht is al gelezen of wordt nu gelezen.' };
  try {
    const files = await rows('SELECT id, naam, mime, data, tekst FROM bestanden WHERE bericht_id = $1 ORDER BY id', [b.id]);
    const bijlagen = [];
    for (const f of files) {
      if (/pdf/i.test(f.mime)) {
        let tekst = f.tekst;
        if (!tekst) { try { tekst = await pdfRows(f.data); } catch (e) { tekst = ''; } await pool.query('UPDATE bestanden SET tekst = $2 WHERE id = $1', [f.id, tekst]); }
        bijlagen.push({ naam: f.naam, tekst, id: f.id });
      } else if (/^image\//i.test(f.mime)) bijlagen.push({ naam: f.naam, image: f.data, mime: f.mime, id: f.id });
    }
    const allText = [b.tekst || '', ...bijlagen.filter(x => x.tekst).map(x => x.tekst)].join('\n');

    let read = normaliseAi(await aiRead({ kanaal: b.kanaal, van: b.van_naam ? `${b.van_naam} <${b.van}>` : b.van, onderwerp: b.onderwerp, tekst: b.tekst, bijlagen }));
    let door = read ? 'ai' : 'regels';
    if (!read || (read.soort === 'overig' && !read.regels.length)) {
      const inv = readInvoiceText(allText);
      if (inv) { read = { ...inv, waarschuwingen: [] }; door = 'regels'; }
      else {
        const t = readTimeText(b.tekst);
        if (t) { read = { soort: 'tijd', leverancier: {}, regels: [], tijd: t, waarschuwingen: [] }; door = 'regels'; }
        else if (!read) read = { soort: 'overig', leverancier: {}, regels: [], waarschuwingen: [] };
      }
    }

    const kwekers = await rows('SELECT id, naam, email, maildomein, whatsapp, telefoon, laadtijd, reistijd_min, plaats FROM kwekers');
    const sender = { from: b.van, name: read.leverancier?.naam || b.van_naam, phone: read.leverancier?.telefoon || (b.kanaal === 'whatsapp' ? b.van : null) };
    const known = matchGrower(sender, kwekers);
    const fake = !known || known.anderAdres ? lookalike({ from: b.van, name: read.leverancier?.naam || b.van_naam }, kwekers) : null;

    if (fake) {
      const why = `Verdacht: ${fake.waarom}${read.waarschuwingen.length ? ' ' + read.waarschuwingen.join(' ') : ''} Niet betalen; bel ${fake.kweker.naam} op het nummer dat je al had.`;
      await pool.query(`UPDATE berichten_in SET status = 'fout', soort = $2, fout = $3 WHERE id = $1`, [b.id, read.soort === 'overig' ? 'factuur' : read.soort, why]);
      await log(wie, 'Verdacht bericht herkend', 'bericht', b.id, { van: b.van, lijkt_op: fake.kweker.naam });
      return { ok: true, soort: 'verdacht', waarschuwing: why };
    }

    // ---- a time update for a truck
    if (read.soort === 'tijd' && read.tijd && known) {
      const out = await applyTime(b, known.kweker, read.tijd, door);
      return out;
    }

    if (!['factuur', 'pakbon', 'bevestiging'].includes(read.soort) || !read.regels.length) {
      await pool.query(`UPDATE berichten_in SET status = 'gelezen', soort = 'overig', kweker_id = $2 WHERE id = $1`, [b.id, known ? known.kweker.id : null]);
      return { ok: true, soort: 'overig' };
    }

    // ---- an invoice (or a delivery note or confirmation with prices)
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      let kweker = known ? known.kweker : null;
      const warnings = [...(read.waarschuwingen || [])];
      if (!kweker) {
        const naam = (read.leverancier?.naam || b.van_naam || b.van || 'Onbekende kweker').trim().slice(0, 120);
        const email = /@/.test(b.van || '') ? b.van : (read.leverancier?.email || null);
        const wa = b.kanaal === 'whatsapp' && /^\+\d{8,15}$/.test(b.van || '') ? b.van : null;
        let code = slug(naam), i = 1;
        while ((await c.query('SELECT 1 FROM kwekers WHERE code = $1', [code])).rows.length) code = `${slug(naam).slice(0, 32)}-${++i}`;
        const ins = await c.query(`INSERT INTO kwekers (code, naam, plaats, email, maildomein, whatsapp, bron) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT ((lower(naam))) DO UPDATE SET naam = EXCLUDED.naam RETURNING *`,
          [code, naam, read.leverancier?.plaats || null, email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null, email ? email.split('@')[1] : null, wa, b.kanaal === 'whatsapp' ? 'whatsapp' : 'mail']);
        kweker = ins.rows[0];
        warnings.push(`Nieuwe kweker: ${naam} stond nog niet in de database. Controleer de gegevens.`);
      }
      const nummer = read.factuurnummer || `ZONDER-NR-${b.id}`;
      const dup = (await c.query('SELECT id FROM facturen WHERE kweker_id = $1 AND nummer = $2', [kweker.id, nummer])).rows[0];
      if (dup) {
        await c.query('ROLLBACK');
        await pool.query(`UPDATE berichten_in SET status = 'gelezen', soort = 'factuur', kweker_id = $2, fout = $3 WHERE id = $1`, [b.id, kweker.id, `Deze factuur (${nummer}) staat er al in. Niet nog een keer betalen.`]);
        await pool.query(`INSERT INTO afwijkingen (factuur_id, soort, tekst) VALUES ($1, 'dubbel', $2)`, [dup.id, `Factuur ${nummer} kwam nog een keer binnen via ${b.kanaal}.`]);
        return { ok: true, soort: 'dubbel', factuur_id: dup.id };
      }
      const plants = (await c.query('SELECT id, naam, latijn, potmaat, hoogte FROM planten WHERE actief')).rows;
      const aliases = (await c.query('SELECT plant_id, kweker_id, tekst FROM plant_namen')).rows;
      const klanten = (await c.query('SELECT id, naam FROM klanten WHERE actief')).rows;
      const orders = (await c.query(`SELECT id, nummer, klant_id FROM klant_orders WHERE besteld_op > now() - interval '60 days'`)).rows;
      const datum = read.datum || ymd(new Date());
      const sum = read.regels.reduce((s, r) => s + r.aantal * r.prijs, 0);
      if (read.totaal_excl && Math.abs(sum - read.totaal_excl) > Math.max(1, read.totaal_excl * 0.01)) warnings.push(`De regels tellen op tot € ${sum.toFixed(2).replace('.', ',')}, de factuur noemt € ${read.totaal_excl.toFixed(2).replace('.', ',')}.`);
      const matched = read.regels.map(r => ({ ...r, m: matchPlant(r.omschrijving, plants, aliases, kweker.id), ref: matchCustomerRef(r.referentie || '', klanten, orders) }));
      const zek = Math.min(...matched.map(r => (r.m ? r.m.zekerheid : 0)));
      const f = (await c.query(`INSERT INTO facturen (kweker_id, nummer, datum, vervaldatum, bericht_id, bestand_id, totaal, zekerheid, gelezen_door, waarschuwing)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [kweker.id, nummer, datum, read.vervaldatum && read.vervaldatum >= datum ? read.vervaldatum : null, b.id, bijlagen[0] ? bijlagen[0].id : null,
          read.totaal_excl ?? Math.round(sum * 100) / 100, Math.max(0, Math.min(100, zek)), door, warnings.length ? warnings.join(' ') : null])).rows[0];
      const refs = {};
      let nr = 0;
      for (const r of matched) {
        const ins = await c.query(`INSERT INTO factuur_regels (factuur_id, regelnr, omschrijving, plant_id, match_zekerheid, aantal, prijs, klant_ref) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [f.id, ++nr, r.omschrijving, r.m && r.m.zekerheid >= 40 ? r.m.plant_id : null, r.m ? r.m.zekerheid : null, r.aantal, Math.round(r.prijs * 1000) / 1000, r.referentie || null]);
        if (r.ref) refs[ins.rows[0].id] = r.ref;
      }
      // when the goods are expected: today or tomorrow gets a truck on the board
      const d = new Date(datum + 'T00:00:00'), today = new Date(); today.setHours(0, 0, 0, 0);
      const diff = Math.round((d - today) / 864e5);
      if (diff >= 0 && diff <= 3) {
        let arr;
        if (read.tijd?.eta) arr = todayAt(read.tijd.eta.h, read.tijd.eta.m, d);
        else if (kweker.laadtijd && kweker.reistijd_min != null) { const [h, m] = String(kweker.laadtijd).split(':').map(Number); arr = new Date(todayAt(h, m, d).getTime() + kweker.reistijd_min * 6e4); }
        else arr = todayAt(8, 30, d);
        // an invoice for goods that should already be here says nothing about a truck: only plan what is still to come
        if (arr > new Date()) {
          const dep = kweker.reistijd_min != null ? new Date(arr.getTime() - kweker.reistijd_min * 6e4) : null;
          await c.query(`INSERT INTO zendingen (factuur_id, kweker_id, vervoerder, vertrek_gepland, aankomst_gepland) VALUES ($1, $2, $3, $4, $5)`, [f.id, kweker.id, null, dep, arr]);
        }
      }
      const made = await proposeForInvoice(c, f.id, { klantRefs: refs });
      await c.query(`UPDATE berichten_in SET status = 'gelezen', soort = $2, kweker_id = $3 WHERE id = $1`, [b.id, read.soort, kweker.id]);
      await c.query('COMMIT');
      await log(wie, door === 'ai' ? 'Factuur gelezen met AI' : 'Factuur gelezen met vaste regels', 'factuur', f.id, { nummer, kweker: kweker.naam, regels: matched.length, voorstellen: made, model: read.model || null });
      return { ok: true, soort: 'factuur', factuur_id: f.id, voorstellen: made, gelezen_door: door };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  } catch (e) {
    console.error('[lezen]', b.id, e.message);
    await pool.query(`UPDATE berichten_in SET status = 'fout', fout = $2 WHERE id = $1`, [b.id, `Lezen lukte niet: ${e.message}`.slice(0, 500)]);
    return { ok: false, reden: e.message };
  }
}

async function applyTime(b, kweker, t, door) {
  const z = (await pool.query(`SELECT * FROM zendingen WHERE kweker_id = $1 AND aankomst_gepland BETWEEN now() - interval '10 hours' AND now() + interval '30 hours'
     AND (aankomst_werkelijk IS NULL OR aankomst_werkelijk > now()) ORDER BY aankomst_gepland LIMIT 1`, [kweker.id])).rows[0];
  if (!z) {
    await pool.query(`UPDATE berichten_in SET status = 'gelezen', soort = 'tijd', kweker_id = $2, fout = $3 WHERE id = $1`, [b.id, kweker.id, 'Geen wagen van deze kweker op de planning gevonden.']);
    return { ok: true, soort: 'tijd', zending_id: null };
  }
  const base = new Date(z.aankomst_gepland);
  const eta = t.eta ? todayAt(t.eta.h, t.eta.m, base) : null;
  const vertrek = t.vertrek ? todayAt(t.vertrek.h, t.vertrek.m, new Date(z.vertrek_gepland || base)) : null;
  if (vertrek && !z.vertrek_werkelijk) {
    await pool.query('UPDATE zendingen SET vertrek_werkelijk = $2 WHERE id = $1', [z.id, vertrek]);
    await pool.query(`INSERT INTO gebeurtenissen (zending_id, bericht_id, tijd, soort, plaats, eta, tekst, bron) VALUES ($1, $2, $3, 'vertrokken', $4, $5, $6, $7)`,
      [z.id, b.id, vertrek, kweker.plaats, eta, b.tekst?.slice(0, 300), b.kanaal === 'whatsapp' ? 'whatsapp' : 'mail']);
  }
  if (eta) {
    const late = (eta - new Date(z.aankomst_gepland)) / 6e4;
    await pool.query('UPDATE zendingen SET aankomst_verwacht = $2 WHERE id = $1', [z.id, eta]);
    await pool.query(`INSERT INTO gebeurtenissen (zending_id, bericht_id, tijd, soort, plaats, eta, tekst, bron) VALUES ($1, $2, $3, $4, 'onderweg', $5, $6, $7)`,
      [z.id, b.id, b.ontvangen, t.vertraging || late >= 15 ? 'vertraging' : 'eta', eta, b.tekst?.slice(0, 300), b.kanaal === 'whatsapp' ? 'whatsapp' : 'mail']);
  }
  await pool.query(`UPDATE berichten_in SET status = 'gelezen', soort = 'tijd', kweker_id = $2 WHERE id = $1`, [b.id, kweker.id]);
  await log('desk', 'Tijd bijgewerkt uit bericht', 'zending', z.id, { kweker: kweker.naam, eta: eta ? eta.toISOString() : null, gelezen_door: door });
  return { ok: true, soort: 'tijd', zending_id: z.id };
}
