// The weekly rhythm in one place: what is known about a week, how the boxes are handed out, and the packing slips.
// Rule of the house: the desk reads, counts, proposes and prepares. Jan notes the rate, checks, approves and sends.
import { pool, rows, one, q, setting, log } from '../db.js';
import { addDays, isoWeek, focusMonday, today, passed, r2, eurPrice, lineAmount, vatFor, sum, groupBy, cycleDays, batchNumber } from './util.js';

export const DEFAULT_COMPANY = {
  naam: 'Campo International B.V.', straat: 'Stoomweg 10', postcode: '2631 RR', plaats: 'Nootdorp', land: 'Nederland',
  telefoon: '+31 (0)10 433 7640', email: 'info@campointernational.nl', kvk: '27226650', btw: 'NL007654194B01',
  iban: '', bic: '', pp_b: 'NL-1234567', betaaltermijn: 14,
};
export async function company() {
  const s = await setting('bedrijf', {});
  return { ...DEFAULT_COMPANY, ...s, pp_b_voorbeeld: !s.pp_b };
}

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
export const STAGES = ['gepland', 'besteld', 'bevestigd', 'verzonden', 'binnen'];
export function stageOf(p, now = new Date()) {
  if (passed(p.binnen_op, now)) return 'binnen';
  if (passed(p.verzonden_op, now)) return 'verzonden';
  if (passed(p.bevestigd_op, now)) return 'bevestigd';
  if (passed(p.besteld_op, now)) return 'besteld';
  return 'gepland';
}

export async function ensureWeek(maandag, c = pool) {
  await c.query('INSERT INTO weken (maandag) VALUES ($1) ON CONFLICT (maandag) DO NOTHING', [maandag]);
}

// ---------------------------------------------------------------- everything about one arrival Monday
export async function weekData(maandag, { now = new Date() } = {}) {
  const wk = (await one('SELECT * FROM weken WHERE maandag = $1', [maandag])) || { maandag, koers: null };
  const partijen = await rows(`SELECT p.*, l.naam AS leverancier, l.code AS lev_code, l.email AS lev_email, l.taal AS lev_taal, l.exact_code AS lev_exact,
      l.contact AS lev_contact, l.plaats AS lev_plaats, l.route AS lev_route, l.whatsapp AS lev_whatsapp, l.telefoon AS lev_telefoon, g.naam AS regio_naam, g.land AS herkomst, g.valuta
    FROM partijen p JOIN leveranciers l ON l.id = p.leverancier_id JOIN regios g ON g.code = p.regio
    WHERE p.maandag = $1 ORDER BY p.regio, p.nummer`, [maandag]);
  const pids = partijen.map(p => p.id);
  const regelsRaw = pids.length ? await rows(`SELECT r.*, d.code AS product_code, d.naam AS product, d.soort, d.maat, d.prijs_usd AS std_usd, d.exact_code AS product_exact, d.volgorde
      FROM partij_regels r JOIN producten d ON d.id = r.product_id WHERE r.partij_id = ANY($1) ORDER BY d.volgorde, d.code`, [pids]) : [];
  const docs = pids.length ? await rows(`SELECT d.id, d.partij_id, d.soort, d.titel, d.bestand_id, b.mime, d.tekst, d.ontvangen, d.gelezen_door
      FROM partij_documenten d LEFT JOIN bestanden b ON b.id = d.bestand_id
      WHERE d.partij_id = ANY($1) AND d.ontvangen <= $2 ORDER BY d.ontvangen`, [pids, now]) : [];
  const orders = await rows(`SELECT id, klant_id, product_id, dozen, via, notitie, door, aangemaakt FROM weekorders WHERE maandag = $1 AND aangemaakt <= $2 ORDER BY aangemaakt`, [maandag, now]);
  const rids = regelsRaw.map(r => r.id);
  const verdeling = rids.length ? await rows('SELECT * FROM verdeling WHERE regel_id = ANY($1)', [rids]) : [];
  const slips = await rows('SELECT * FROM pakbonnen WHERE maandag = $1', [maandag]);
  const sids = slips.map(s => s.id);
  const slipRegels = sids.length ? await rows('SELECT * FROM pakbon_regels WHERE pakbon_id = ANY($1) ORDER BY pakbon_id, regelnr', [sids]) : [];
  const concepts = sids.length ? await rows(`SELECT id, pakbon_id, status, waar, aan, gezet_op, verstuurd_op, extern_link FROM concepten WHERE pakbon_id = ANY($1) AND status <> 'vervallen'`, [sids]) : [];
  const kids = [...new Set([...orders.map(o => o.klant_id), ...verdeling.map(v => v.klant_id), ...slips.map(s => s.klant_id)])];
  const klanten = kids.length ? await rows(`SELECT id, code, naam, plaats, land, taal, email, factuur_email, telefoon, contact, btw_nummer, exact_code, betaaltermijn, adres, postcode
      FROM klanten WHERE id = ANY($1)`, [kids]) : [];
  const afspraken = kids.length ? await rows('SELECT klant_id, product_id, prijs_usd FROM prijsafspraken WHERE klant_id = ANY($1)', [kids]) : [];
  const producten = await rows('SELECT id, code, naam, soort, maat, per_doos, prijs_usd, inkoop_usd, leverancier_id, exact_code, volgorde FROM producten WHERE actief ORDER BY volgorde, code');

  const K = new Map(klanten.map(k => [k.id, k]));
  const P = new Map(producten.map(p => [p.id, p]));
  const deal = new Map(afspraken.map(a => [`${a.klant_id}:${a.product_id}`, Number(a.prijs_usd)]));
  const priceFor = (kid, pid) => deal.get(`${kid}:${pid}`) ?? Number(P.get(pid)?.prijs_usd || 0);
  const vBy = groupBy(verdeling, v => v.regel_id);
  const koers = wk.koers ? Number(wk.koers) : null;

  for (const p of partijen) {
    p.stage = stageOf(p, now);
    p.docs = docs.filter(d => d.partij_id === p.id);
    const bev = passed(p.bevestigd_op, now), verz = passed(p.verzonden_op, now);
    p.regels = regelsRaw.filter(r => r.partij_id === p.id).map(r => {
      const bevestigd = bev ? r.bevestigd : null, verzonden = verz ? r.verzonden : null;
      const basis = r.geteld != null ? 'geteld' : verzonden != null ? 'verzonden' : bevestigd != null ? 'bevestigd' : 'besteld';
      const dozen = r.geteld ?? verzonden ?? bevestigd ?? r.besteld ?? 0;
      const avail = Math.max(0, dozen - r.uitval);
      const all = (vBy.get(r.id) || []).map(v => ({ klant_id: v.klant_id, klant: K.get(v.klant_id)?.naam || '?', dozen: v.dozen, door: v.door }));
      const gegeven = sum(all, v => v.dozen);
      return {
        ...r, bevestigd, verzonden, twijfel: verz ? r.twijfel : null, gelezen: verz ? r.gelezen : null, zekerheid: verz ? r.zekerheid : null,
        basis, dozen, avail, verdeling: all.sort((a, b) => b.dozen - a.dozen), gegeven, rest: avail - gegeven,
        partij_id: p.id, nummer: p.nummer, regio: p.regio, herkomst: p.herkomst, leverancier: p.leverancier,
      };
    });
    p.dozen = sum(p.regels, r => r.dozen);
    p.twijfels = p.regels.filter(r => r.twijfel).length;
  }
  const regels = partijen.flatMap(p => p.regels);

  // the packing slip per customer: live from the hand-out until Jan approves, fixed after that
  const slipOf = new Map(slips.map(s => [s.klant_id, s]));
  const concOf = new Map(concepts.map(c => [c.pakbon_id, c]));
  const counted = !!wk.geteld_op;
  const custIds = new Set([...verdeling.filter(v => v.dozen > 0).map(v => v.klant_id), ...slips.map(s => s.klant_id)]);
  const out = [];
  for (const kid of custIds) {
    const k = K.get(kid);
    if (!k) continue;
    const s = slipOf.get(kid);
    const live = [];
    for (const r of regels) {
      const v = r.verdeling.find(x => x.klant_id === kid);
      if (!v || v.dozen <= 0) continue;
      const stuks = v.dozen * r.per_doos, pu = priceFor(kid, r.product_id), pe = eurPrice(pu, koers);
      live.push({ regel_id: r.id, product_id: r.product_id, product: r.product, product_code: r.product_code, product_exact: r.product_exact, soort: r.soort, maat: r.maat, volgorde: r.volgorde,
        partij: r.nummer, regio: r.regio, herkomst: r.herkomst, dozen: v.dozen, per_doos: r.per_doos, stuks, prijs_usd: pu, prijs_eur: pe, bedrag: lineAmount(stuks, pe), door: v.door, rest: r.rest });
    }
    live.sort((a, b) => a.volgorde - b.volgorde || a.partij.localeCompare(b.partij));
    const frozen = s && s.status === 'akkoord';
    const lines = frozen ? slipRegels.filter(x => x.pakbon_id === s.id).map(x => {
      const pr = P.get(x.product_id) || {}, rg = regels.find(r => r.id === x.regel_id);
      return { ...x, product: pr.naam, product_code: pr.code, product_exact: pr.exact_code, soort: pr.soort, maat: pr.maat, per_doos: rg ? rg.per_doos : Math.round(x.stuks / x.dozen), regio: rg?.regio, herkomst: rg?.herkomst || partijen.find(p => p.nummer === x.partij)?.herkomst };
    }) : live;
    const key = a => a.map(l => `${l.regel_id}:${l.dozen}`).sort().join('|');
    const gewijzigd = !!frozen && key(lines) !== key(live);
    let status = 'klaar', reden = null;
    if (frozen) status = 'akkoord';
    else if (!live.length) status = 'leeg';
    else if (!koers) { status = 'wacht'; reden = 'De koers van deze week staat er nog niet in.'; }
    else if (!counted) { status = 'wacht'; reden = 'De dozen zijn nog niet geteld.'; }
    else if (live.some(l => l.rest < 0)) { status = 'wacht'; reden = 'Er is meer verdeeld dan er binnen is.'; }
    if (status === 'leeg' && !s) continue;
    const totaal = r2(sum(lines, l => l.bedrag || 0));
    const vat = vatFor(k.land);
    out.push({
      klant_id: kid, klant: k.naam, code: k.code, plaats: k.plaats, land: k.land, taal: k.taal, email: k.factuur_email || k.email, telefoon: k.telefoon,
      regels: lines, dozen: sum(lines, l => l.dozen), stuks: sum(lines, l => l.stuks), totaal, btw: vat, btw_bedrag: r2(totaal * vat.pct / 100),
      status, reden, gewijzigd,
      pakbon: s ? { id: s.id, nummer: s.nummer, status: s.status, exact: s.exact, exact_op: s.exact_op, exact_nummer: s.exact_nummer, gedrukt_op: s.gedrukt_op, datum: s.datum, vervaldatum: s.vervaldatum } : null,
      concept: s ? concOf.get(s.id) || null : null,
    });
  }
  out.sort((a, b) => a.klant.localeCompare(b.klant, 'nl'));

  const vraag = orders.map(o => ({ ...o, klant: K.get(o.klant_id)?.naam || '?', land: K.get(o.klant_id)?.land, product: P.get(o.product_id) }));
  const w = isoWeek(maandag);
  return { maandag, week: w.week, jaar: w.jaar, wk, koers, counted, partijen, regels, orders: vraag, slips: out, producten, P, K, priceFor, now };
}

// ---------------------------------------------------------------- handing out: whole boxes, by what customers asked
export function allocate(demand, lines) {
  const cap = sum(lines, l => l.cap), want = sum(demand, d => d.dozen);
  let give;
  if (cap >= want) give = demand.map(d => ({ ...d, krijgt: d.dozen }));
  else {
    const f = want ? cap / want : 0;
    give = demand.map(d => { const x = d.dozen * f; return { ...d, krijgt: Math.floor(x), frac: x - Math.floor(x) }; });
    let left = cap - sum(give, d => d.krijgt);
    for (const d of [...give].sort((a, b) => b.frac - a.frac || b.dozen - a.dozen)) { if (left <= 0) break; d.krijgt++; left--; }
  }
  const room = lines.map(l => ({ ...l, left: l.cap })), out = [];
  for (const d of [...give].sort((a, b) => b.krijgt - a.krijgt || a.klant_id - b.klant_id)) {
    let need = d.krijgt;
    if (need <= 0) continue;
    const whole = room.find(l => l.left >= need);
    if (whole) { out.push({ regel_id: whole.id, klant_id: d.klant_id, dozen: need }); whole.left -= need; continue; }
    for (const l of room) {
      if (need <= 0) break;
      const t = Math.min(need, l.left);
      if (t > 0) { out.push({ regel_id: l.id, klant_id: d.klant_id, dozen: t }); l.left -= t; need -= t; }
    }
  }
  return { rows: out, over: sum(room, l => l.left), give };
}

// the desk's proposal follows what is known (confirmation, shipping papers, the count); Jan's own choices and approved slips stay put
export async function syncProposal(maandag) {
  const d = await weekData(maandag);
  if (!d.regels.length) return 0;
  const locked = new Set(d.slips.filter(s => s.pakbon && s.pakbon.status === 'akkoord').map(s => s.klant_id));
  const desired = [];
  for (const [pid, lines] of groupBy(d.regels, r => r.product_id)) {
    const fixed = lines.flatMap(r => r.verdeling.filter(v => v.door !== 'desk' || locked.has(v.klant_id)).map(v => ({ ...v, regel_id: r.id })));
    const fixedK = new Set(fixed.map(v => v.klant_id));
    const caps = lines.map(r => ({ id: r.id, cap: Math.max(0, r.avail - sum(fixed.filter(v => v.regel_id === r.id), v => v.dozen)) }));
    const demand = d.orders.filter(o => o.product_id === pid && !fixedK.has(o.klant_id) && !locked.has(o.klant_id)).map(o => ({ klant_id: o.klant_id, dozen: o.dozen }));
    desired.push(...allocate(demand, caps).rows);
  }
  const lockedRows = new Set(d.regels.flatMap(r => r.verdeling.filter(v => v.door !== 'desk' || locked.has(v.klant_id)).map(v => `${r.id}:${v.klant_id}`)));
  const want = new Map(desired.filter(x => !lockedRows.has(`${x.regel_id}:${x.klant_id}`)).map(x => [`${x.regel_id}:${x.klant_id}`, x]));
  const have = new Map(d.regels.flatMap(r => r.verdeling.filter(v => v.door === 'desk' && !locked.has(v.klant_id)).map(v => [`${r.id}:${v.klant_id}`, { regel_id: r.id, klant_id: v.klant_id, dozen: v.dozen }])));
  const del = [...have.keys()].filter(k => !want.has(k));
  const put = [...want.values()].filter(x => !have.has(`${x.regel_id}:${x.klant_id}`) || have.get(`${x.regel_id}:${x.klant_id}`).dozen !== x.dozen);
  if (!del.length && !put.length) return 0;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const k of del) { const [r, kl] = k.split(':').map(Number); await c.query(`DELETE FROM verdeling WHERE regel_id = $1 AND klant_id = $2 AND door = 'desk'`, [r, kl]); }
    for (const x of put) {
      await c.query(`INSERT INTO verdeling (regel_id, klant_id, dozen, door) VALUES ($1, $2, $3, 'desk')
        ON CONFLICT (regel_id, klant_id) DO UPDATE SET dozen = EXCLUDED.dozen WHERE verdeling.door = 'desk'`, [x.regel_id, x.klant_id, x.dozen]);
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return del.length + put.length;
}

// Jan changes what one customer gets from one shipment line; that customer's share of this product is then his
export async function setAllocation({ regel_id, klant_id, dozen }, wie) {
  const r = await one(`SELECT r.id, r.product_id, p.maandag, p.nummer FROM partij_regels r JOIN partijen p ON p.id = r.partij_id WHERE r.id = $1`, [regel_id]);
  if (!r) throw fail('Deze regel bestaat niet meer.', 404);
  const slip = await one(`SELECT nummer FROM pakbonnen WHERE maandag = $1 AND klant_id = $2 AND status = 'akkoord'`, [r.maandag, klant_id]);
  if (slip) throw fail(`De pakbon ${slip.nummer} van deze klant is al akkoord. Heropen hem eerst.`);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`UPDATE verdeling v SET door = 'jan' FROM partij_regels r JOIN partijen p ON p.id = r.partij_id
      WHERE v.regel_id = r.id AND v.klant_id = $1 AND r.product_id = $2 AND p.maandag = $3`, [klant_id, r.product_id, r.maandag]);
    await c.query(`INSERT INTO verdeling (regel_id, klant_id, dozen, door) VALUES ($1, $2, $3, 'jan')
      ON CONFLICT (regel_id, klant_id) DO UPDATE SET dozen = EXCLUDED.dozen, door = 'jan'`, [regel_id, klant_id, dozen]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await log(wie, 'Verdeling aangepast', 'partij_regel', regel_id, { klant_id, dozen, partij: r.nummer });
  await syncProposal(r.maandag);
  return r.maandag;
}

// back to the desk's proposal for one customer and product (or the whole week)
export async function resetAllocation(maandag, { klant_id = null, product_id = null } = {}, wie) {
  await q(`DELETE FROM verdeling v USING partij_regels r, partijen p
     WHERE v.regel_id = r.id AND p.id = r.partij_id AND p.maandag = $1 AND v.door = 'jan'
       AND ($2::int IS NULL OR v.klant_id = $2) AND ($3::int IS NULL OR r.product_id = $3)
       AND NOT EXISTS (SELECT 1 FROM pakbonnen s WHERE s.maandag = $1 AND s.klant_id = v.klant_id AND s.status = 'akkoord')`, [maandag, klant_id, product_id]);
  await log(wie, 'Verdeling terug naar het voorstel', 'week', null, { maandag, klant_id, product_id });
  await syncProposal(maandag);
}

// ---------------------------------------------------------------- Monday: the rate and the count
export async function setRate(maandag, koers, wie) {
  const k = Number(String(koers).replace(',', '.'));
  if (!Number.isFinite(k) || k < 0.5 || k > 2.5) throw fail('Vul de koers in als dollars voor één euro, bijvoorbeeld 1,1630.');
  await ensureWeek(maandag);
  await q('UPDATE weken SET koers = $2, koers_op = now(), koers_door = $3 WHERE maandag = $1', [maandag, k, wie]);
  await log(wie, 'Koers vastgezet', 'week', null, { maandag, koers: k });
  return k;
}

export async function countBoxes(maandag, regels = [], wie) {
  const d = await weekData(maandag);
  if (!d.regels.length) throw fail('Er zijn deze week nog geen zendingen.');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const x of regels) {
      const r = d.regels.find(y => y.id === Number(x.id));
      if (!r) continue;
      const g = Number(x.geteld), u = x.uitval == null ? r.uitval : Number(x.uitval);
      if (!Number.isInteger(g) || g < 0 || g > 100000 || !Number.isInteger(u) || u < 0 || u > g) throw fail(`Kijk de telling van ${r.product} ${r.maat} (${r.nummer}) nog even na.`);
      await c.query('UPDATE partij_regels SET geteld = $2, uitval = $3 WHERE id = $1', [r.id, g, u]);
    }
    // whatever Jan did not type in, was there as the papers said
    for (const r of d.regels) {
      if (regels.some(x => Number(x.id) === r.id) || r.geteld != null) continue;
      await c.query('UPDATE partij_regels SET geteld = $2 WHERE id = $1', [r.id, r.verzonden ?? r.bevestigd ?? r.besteld ?? 0]);
    }
    await c.query(`UPDATE partijen SET binnen_op = coalesce(binnen_op, now()) WHERE maandag = $1`, [maandag]);
    await c.query(`UPDATE weken SET geteld_op = now(), geteld_door = $2 WHERE maandag = $1`, [maandag, wie]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await log(wie, 'Dozen geteld', 'week', null, { maandag, aangepast: regels.length });
  await syncProposal(maandag);
}

export async function uncount(maandag, wie) {
  const done = await one(`SELECT count(*) AS n FROM pakbonnen WHERE maandag = $1 AND status = 'akkoord'`, [maandag]);
  if (done.n) throw fail('Er zijn al pakbonnen akkoord. Heropen die eerst.');
  await q(`UPDATE weken SET geteld_op = NULL, geteld_door = NULL WHERE maandag = $1`, [maandag]);
  await q(`UPDATE partij_regels r SET geteld = NULL FROM partijen p WHERE p.id = r.partij_id AND p.maandag = $1`, [maandag]);
  await q(`UPDATE partijen SET binnen_op = NULL WHERE maandag = $1`, [maandag]);
  await log(wie, 'Telling teruggezet', 'week', null, { maandag });
  await syncProposal(maandag);
}

// ---------------------------------------------------------------- the packing slip that is also the invoice
async function nextSlipNumber(c, datum) {
  const yy = datum.slice(2, 4);
  const r = await c.query(`SELECT max(substring(nummer from 4)::int) AS n FROM pakbonnen WHERE nummer ~ $1`, [`^${yy}-[0-9]+$`]);
  return `${yy}-${String((r.rows[0].n || 0) + 1).padStart(4, '0')}`;
}

export async function approveSlips(maandag, klantIds = null, wie) {
  const d = await weekData(maandag);
  const pick = d.slips.filter(s => !klantIds || klantIds.includes(s.klant_id));
  const ready = pick.filter(s => s.status === 'klaar');
  if (!ready.length) {
    const why = pick.find(s => s.reden);
    throw fail(why ? why.reden : pick.length ? 'Deze pakbonnen zijn al akkoord.' : 'Er is nog niets om akkoord te geven.');
  }
  const datum = today() < maandag ? maandag : today();
  const made = [];
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(515151)');
    for (const s of ready) {
      const k = d.K.get(s.klant_id);
      const verval = addDays(datum, Number(k.betaaltermijn || 14));
      let id, nummer;
      if (s.pakbon) {
        ({ id, nummer } = s.pakbon);
        await c.query(`UPDATE pakbonnen SET status = 'akkoord', datum = $2, vervaldatum = $3, koers = $4, btw_pct = $5, totaal = $6, door = $7 WHERE id = $1`,
          [id, datum, verval, d.koers, s.btw.pct, s.totaal, wie]);
        await c.query('DELETE FROM pakbon_regels WHERE pakbon_id = $1', [id]);
      } else {
        nummer = await nextSlipNumber(c, datum);
        id = (await c.query(`INSERT INTO pakbonnen (nummer, maandag, klant_id, datum, vervaldatum, koers, btw_pct, totaal, door) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [nummer, maandag, s.klant_id, datum, verval, d.koers, s.btw.pct, s.totaal, wie])).rows[0].id;
      }
      let n = 0;
      for (const l of s.regels) {
        await c.query(`INSERT INTO pakbon_regels (pakbon_id, regelnr, regel_id, product_id, partij, dozen, stuks, prijs_usd, prijs_eur, bedrag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [id, ++n, l.regel_id, l.product_id, l.partij, l.dozen, l.stuks, l.prijs_usd, l.prijs_eur, l.bedrag]);
      }
      made.push({ id, nummer, klant_id: s.klant_id, klant: s.klant });
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  const { slipConcept } = await import('./mail.js');
  for (const m of made) await slipConcept(m.id);
  await log(wie, made.length === 1 ? `Pakbon ${made[0].nummer} akkoord` : `${made.length} pakbonnen akkoord`, 'week', null, { maandag, nummers: made.map(m => m.nummer) });
  return made;
}

export async function reopenSlip(id, wie) {
  const s = await one('SELECT p.*, k.naam AS klant FROM pakbonnen p JOIN klanten k ON k.id = p.klant_id WHERE p.id = $1', [id]);
  if (!s) throw fail('Deze pakbon bestaat niet.', 404);
  if (s.exact === 'in_exact') throw fail(`Pakbon ${s.nummer} staat al in Exact. Zet hem daar eerst terug, dan kan hij hier open.`);
  const c = await one(`SELECT * FROM concepten WHERE pakbon_id = $1 AND status <> 'vervallen'`, [id]);
  if (c && c.status === 'verstuurd') throw fail(`De factuur ${s.nummer} is al naar ${s.klant} gestuurd. Maak liever een creditnota.`);
  if (c) {
    const { removeFromOutlook } = await import('../outlook.js');
    await removeFromOutlook(c);
    await q(`UPDATE concepten SET status = 'vervallen', extern_id = NULL, bijgewerkt = now() WHERE id = $1`, [c.id]);
  }
  await q('DELETE FROM pakbon_regels WHERE pakbon_id = $1', [id]);
  await q(`UPDATE pakbonnen SET status = 'heropend', totaal = 0 WHERE id = $1`, [id]);
  await log(wie, `Pakbon ${s.nummer} heropend`, 'pakbon', id, { klant: s.klant });
  return s;
}

export async function markSlipsExact(ids, wie, { nummer = null, terug = false } = {}) {
  if (!ids.length) throw fail('Er is niets om in Exact te zetten.');
  const r = terug
    ? await rows(`UPDATE pakbonnen SET exact = 'open', exact_op = NULL, exact_door = NULL, exact_nummer = NULL WHERE id = ANY($1) RETURNING nummer`, [ids])
    : await rows(`UPDATE pakbonnen SET exact = 'in_exact', exact_op = now(), exact_door = $2, exact_nummer = coalesce($3, exact_nummer) WHERE id = ANY($1) AND status = 'akkoord' AND exact = 'open' RETURNING nummer`, [ids, wie, nummer]);
  if (r.length) await log(wie, terug ? 'Verkoopfactuur terug uit Exact' : r.length === 1 ? `Verkoopfactuur ${r[0].nummer} in Exact` : `${r.length} verkoopfacturen in Exact`, 'pakbon', null, { nummers: r.map(x => x.nummer) });
  return r.length;
}

export async function markPartijExact(id, wie, { nummer = null, terug = false } = {}) {
  const p = await one('SELECT * FROM partijen WHERE id = $1', [id]);
  if (!p) throw fail('Deze zending bestaat niet.', 404);
  if (!terug) {
    const open = await one('SELECT count(*) FILTER (WHERE twijfel IS NOT NULL) AS twijfel, count(*) FILTER (WHERE verzonden IS NULL) AS leeg FROM partij_regels WHERE partij_id = $1', [id]);
    if (!passed(p.verzonden_op)) throw fail('Het verzendbewijs van deze zending is er nog niet. De inkooporder komt daaruit.');
    if (open.twijfel) throw fail('Kijk eerst de regels na waar de desk over twijfelt.');
    if (open.leeg) throw fail('Niet elke regel heeft een aantal van het verzendbewijs.');
  }
  await q(terug ? `UPDATE partijen SET exact = 'open', exact_op = NULL, exact_door = NULL, exact_nummer = NULL WHERE id = $1`
    : `UPDATE partijen SET exact = 'in_exact', exact_op = now(), exact_door = $2, exact_nummer = coalesce($3, exact_nummer) WHERE id = $1`, terug ? [id] : [id, wie, nummer]);
  await log(wie, terug ? `Inkooporder ${p.nummer} terug uit Exact` : `Inkooporder ${p.nummer} in Exact`, 'partij', id, nummer ? { nummer } : null);
}

// ---------------------------------------------------------------- Tuesday: ordering for the coming Monday
// the batch number: year, week, region (264901). Every supplier of one region in one week shares it.
async function nextBatch(c, regio, maandag) {
  const g = (await c.query('SELECT code, naam, nummer FROM regios WHERE code = $1', [regio])).rows[0];
  if (!g || !g.nummer) throw fail(`Regio ${g ? g.naam : regio} heeft nog geen nummer voor het batchnummer. Vul het in bij Koppelingen, Regio's.`);
  return batchNumber(maandag, g.nummer);
}
export async function proposeBatchNumber(regio, maandag) {
  const c = await pool.connect();
  try { return await nextBatch(c, regio, maandag); } catch { return null; } finally { c.release(); }
}

export async function orderBook(maandag, { now = new Date() } = {}) {
  const d = await weekData(maandag, { now });
  const producten = d.producten;
  const leveranciers = await rows(`SELECT l.id, l.code, l.naam, l.regio, l.email, l.taal, l.contact, g.naam AS regio_naam FROM leveranciers l JOIN regios g ON g.code = l.regio WHERE l.actief ORDER BY l.regio, l.naam`);
  const usual = await rows(`SELECT DISTINCT p.leverancier_id, r.product_id FROM partij_regels r JOIN partijen p ON p.id = r.partij_id WHERE p.maandag > $1::date - 120`, [maandag]);
  // who usually calls but has not yet for this week: ordered at least four of the last eight weeks
  const regular = await rows(`WITH last AS (
       SELECT klant_id, count(DISTINCT maandag) AS weken, max(maandag) AS laatst FROM weekorders WHERE maandag < $1 AND maandag >= $1::date - 56 GROUP BY klant_id)
     SELECT k.id, k.naam, k.plaats, k.land, k.telefoon, k.contact, l.weken, l.laatst FROM last l JOIN klanten k ON k.id = l.klant_id
     WHERE l.weken >= 4 AND NOT EXISTS (SELECT 1 FROM weekorders o WHERE o.maandag = $1 AND o.klant_id = k.id AND o.aangemaakt <= $2) ORDER BY l.weken DESC, k.naam LIMIT 24`, [maandag, now]);
  const lastLines = regular.length ? await rows(`SELECT o.klant_id, o.product_id, o.dozen, o.maandag FROM weekorders o
     WHERE (o.klant_id, o.maandag) IN (SELECT klant_id, max(maandag) FROM weekorders WHERE klant_id = ANY($1) AND maandag < $2 GROUP BY klant_id)`, [regular.map(r => r.id), maandag]) : [];
  for (const r of regular) r.vorige = lastLines.filter(l => l.klant_id === r.id).map(l => ({ product_id: l.product_id, dozen: l.dozen, product: d.P.get(l.product_id) }));
  // the totals per product, and which supplier it usually comes from
  const totals = producten.map(p => {
    const os = d.orders.filter(o => o.product_id === p.id);
    const besteld = d.partijen.flatMap(x => x.regels.filter(r => r.product_id === p.id).map(r => ({ partij: x.nummer, leverancier_id: x.leverancier_id, leverancier: x.leverancier, besteld: r.besteld })));
    const kan = usual.filter(u => u.product_id === p.id).map(u => u.leverancier_id);
    return { ...p, gevraagd: sum(os, o => o.dozen), klanten: os.length, besteld, leveranciers: [...new Set([p.leverancier_id, ...kan].filter(Boolean))] };
  });
  const klanten = await rows(`SELECT id, naam, plaats, land FROM klanten WHERE actief ORDER BY naam`);
  return { ...d, leveranciers, totals, regular, klanten, besteld: !!d.wk.besteld_op || d.partijen.some(p => passed(p.besteld_op, now)) };
}

export async function addOrder({ maandag, klant_id, product_id, dozen, notitie = null, via = 'telefoon' }, wie) {
  await ensureWeek(maandag);
  if (dozen <= 0) {
    await q('DELETE FROM weekorders WHERE maandag = $1 AND klant_id = $2 AND product_id = $3', [maandag, klant_id, product_id]);
  } else {
    await q(`INSERT INTO weekorders (maandag, klant_id, product_id, dozen, via, notitie, door) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (maandag, klant_id, product_id) DO UPDATE SET dozen = EXCLUDED.dozen, notitie = coalesce(EXCLUDED.notitie, weekorders.notitie), door = EXCLUDED.door, aangemaakt = least(weekorders.aangemaakt, now())`,
    [maandag, klant_id, product_id, dozen, via, notitie, wie]);
  }
  const k = await one('SELECT naam FROM klanten WHERE id = $1', [klant_id]);
  await log(wie, dozen > 0 ? 'Bestelling genoteerd' : 'Bestelling weggehaald', 'klant', klant_id, { maandag, product_id, dozen, klant: k?.naam });
  await syncProposal(maandag);
}

export async function copyPrevious(maandag, klant_id, wie) {
  const prev = await rows(`SELECT product_id, dozen FROM weekorders WHERE klant_id = $1 AND maandag = (SELECT max(maandag) FROM weekorders WHERE klant_id = $1 AND maandag < $2)`, [klant_id, maandag]);
  if (!prev.length) throw fail('Deze klant heeft nog niet eerder besteld.');
  for (const p of prev) await addOrder({ maandag, klant_id, product_id: p.product_id, dozen: p.dozen, via: 'telefoon' }, wie);
  return prev.length;
}

// Jan has ordered: one shipment (one batch number) per supplier
export async function placeOrders(maandag, plan, wie) {
  const items = (plan || []).map(x => ({ product_id: Number(x.product_id), leverancier_id: Number(x.leverancier_id), dozen: Number(x.dozen) })).filter(x => x.product_id && x.leverancier_id && Number.isInteger(x.dozen) && x.dozen > 0);
  if (!items.length) throw fail('Er staat nog niets om te bestellen.');
  await ensureWeek(maandag);
  const made = [];
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(616161)');
    for (const [lid, lines] of groupBy(items, x => x.leverancier_id)) {
      const lev = (await c.query('SELECT id, regio, naam FROM leveranciers WHERE id = $1', [lid])).rows[0];
      if (!lev) throw fail('Onbekende leverancier.');
      let p = (await c.query('SELECT * FROM partijen WHERE maandag = $1 AND leverancier_id = $2 ORDER BY id LIMIT 1', [maandag, lid])).rows[0];
      if (!p) {
        const nummer = await nextBatch(c, lev.regio, maandag);
        // the shipment flies the supplier's usual route; Jan can change it per shipment
        p = (await c.query(`INSERT INTO partijen (nummer, regio, leverancier_id, maandag, besteld_op, route) VALUES ($1,$2,$3,$4, now(), (SELECT route FROM leveranciers WHERE id = $3)) RETURNING *`, [nummer, lev.regio, lid, maandag])).rows[0];
      } else if (!p.besteld_op) await c.query('UPDATE partijen SET besteld_op = now() WHERE id = $1', [p.id]);
      for (const l of lines) {
        const prod = (await c.query('SELECT per_doos, inkoop_usd FROM producten WHERE id = $1', [l.product_id])).rows[0];
        const last = (await c.query(`SELECT r.prijs_usd FROM partij_regels r JOIN partijen x ON x.id = r.partij_id WHERE x.leverancier_id = $1 AND r.product_id = $2 AND x.maandag < $3 ORDER BY x.maandag DESC LIMIT 1`, [lid, l.product_id, maandag])).rows[0];
        // an offer Jan took: those boxes at the offer price, the rest at the usual one
        const off = (await c.query(`SELECT coalesce(sum(coalesce(genomen_dozen, dozen)), 0) AS n, max(prijs_usd) AS prijs FROM leverancier_aanbod WHERE maandag = $1 AND leverancier_id = $2 AND product_id = $3 AND status = 'genomen'`, [maandag, lid, l.product_id])).rows[0];
        const base = Number(last ? last.prijs_usd : prod.inkoop_usd || 0), g = Math.min(Number(off.n) || 0, l.dozen);
        const price = g ? Math.round((((l.dozen - g) * base + g * Number(off.prijs)) / l.dozen) * 10000) / 10000 : base;
        await c.query(`INSERT INTO partij_regels (partij_id, product_id, besteld, per_doos, prijs_usd) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (partij_id, product_id) DO UPDATE SET besteld = EXCLUDED.besteld`, [p.id, l.product_id, l.dozen, prod.per_doos, price]);
      }
      made.push({ id: p.id, nummer: p.nummer, leverancier: lev.naam });
    }
    await c.query('UPDATE weken SET besteld_op = coalesce(besteld_op, now()) WHERE maandag = $1', [maandag]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await log(wie, 'Besteld bij leveranciers', 'week', null, { maandag, partijen: made.map(m => m.nummer) });
  await syncProposal(maandag);
  return made;
}

// ---------------------------------------------------------------- Thursday and Friday: what the supplier confirms and what flies
export async function updateLine(id, v, wie) {
  const r = await one(`SELECT r.*, p.nummer, p.maandag FROM partij_regels r JOIN partijen p ON p.id = r.partij_id WHERE r.id = $1`, [id]);
  if (!r) throw fail('Deze regel bestaat niet meer.', 404);
  const set = [], vals = [id];
  for (const k of ['besteld', 'bevestigd', 'verzonden', 'geteld', 'uitval']) {
    if (!(k in v)) continue;
    const n = v[k] === null || v[k] === '' ? null : Number(v[k]);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 100000)) throw fail('Een aantal dozen is een heel getal.');
    if (k === 'uitval' && n === null) continue;
    vals.push(n); set.push(`${k} = $${vals.length}`);
  }
  if ('prijs_usd' in v) { const n = Number(String(v.prijs_usd).replace(',', '.')); if (!Number.isFinite(n) || n < 0 || n > 10000) throw fail('Een prijs in dollars per stuk.'); vals.push(n); set.push(`prijs_usd = $${vals.length}`); }
  if (v.nagekeken) set.push('twijfel = NULL, zekerheid = 100');
  if (!set.length) return r.maandag;
  await q(`UPDATE partij_regels SET ${set.join(', ')} WHERE id = $1`, vals);
  await log(wie, v.nagekeken ? 'Regel nagekeken' : 'Regel aangepast', 'partij', r.partij_id, { regel: id, partij: r.nummer, ...v });
  await syncProposal(r.maandag);
  return r.maandag;
}

export async function setStage(id, stage, wie) {
  const p = await one('SELECT * FROM partijen WHERE id = $1', [id]);
  if (!p) throw fail('Deze zending bestaat niet.', 404);
  if (stage === 'bevestigd') {
    await q(`UPDATE partij_regels SET bevestigd = coalesce(bevestigd, besteld) WHERE partij_id = $1`, [id]);
    await q(`UPDATE partijen SET bevestigd_op = CASE WHEN bevestigd_op IS NULL OR bevestigd_op > now() THEN now() ELSE bevestigd_op END WHERE id = $1`, [id]);
  } else if (stage === 'verzonden') {
    await q(`UPDATE partij_regels SET bevestigd = coalesce(bevestigd, besteld), verzonden = coalesce(verzonden, bevestigd, besteld) WHERE partij_id = $1`, [id]);
    await q(`UPDATE partijen SET bevestigd_op = coalesce(bevestigd_op, now()), verzonden_op = CASE WHEN verzonden_op IS NULL OR verzonden_op > now() THEN now() ELSE verzonden_op END WHERE id = $1`, [id]);
  } else throw fail('Onbekende stap.');
  await log(wie, stage === 'bevestigd' ? `Bevestiging ${p.nummer} verwerkt` : `Verzendbewijs ${p.nummer} verwerkt`, 'partij', id);
  await syncProposal(p.maandag);
}

export async function updatePartij(id, v, wie) {
  const p = await one('SELECT * FROM partijen WHERE id = $1', [id]);
  if (!p) throw fail('Deze zending bestaat niet.', 404);
  const set = [], vals = [id];
  if ('nummer' in v) {
    const n = String(v.nummer || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{2,15}$/.test(n)) throw fail('Een batchnummer is jaar, week en regio: 264901 is 2026, week 49, regio 01.');
    if (p.exact === 'in_exact' && n !== p.nummer) throw fail('Deze inkooporder staat al in Exact met dit nummer als kostendrager.');
    // the same number is right for another supplier of the same region in the same week (one batch), not for another week or region
    const other = await one('SELECT 1 FROM partijen WHERE nummer = $1 AND id <> $2 AND (regio <> $3 OR maandag <> $4) LIMIT 1', [n, id, p.regio, p.maandag]);
    if (other) throw fail(`Batchnummer ${n} hoort al bij een andere week of regio.`);
    const twice = await one('SELECT 1 FROM partijen WHERE nummer = $1 AND id <> $2 AND leverancier_id = $3', [n, id, p.leverancier_id]);
    if (twice) throw fail(`Deze leverancier heeft al een zending met batchnummer ${n}.`);
    const used = await one('SELECT 1 FROM pakbon_regels r JOIN partij_regels x ON x.id = r.regel_id WHERE x.partij_id = $1', [id]);
    if (used && n !== p.nummer) throw fail('Er staan al pakbonnen met dit nummer op het plantenpaspoort.');
    vals.push(n); set.push(`nummer = $${vals.length}`);
  }
  for (const k of ['awb', 'vlucht', 'fyto', 'notitie']) if (k in v) { vals.push(v[k] ? String(v[k]).slice(0, 200) : null); set.push(`${k} = $${vals.length}`); }
  if (!set.length) return p;
  await q(`UPDATE partijen SET ${set.join(', ')} WHERE id = $1`, vals);
  await log(wie, 'Zending aangepast', 'partij', id, v);
  return one('SELECT * FROM partijen WHERE id = $1', [id]);
}

// ---------------------------------------------------------------- what asks for Jan, per week and in the menu
export function weekTasks(d, { now = new Date() } = {}) {
  const t = [], m = d.maandag, days = cycleDays(m), nowDay = today();
  const placed = d.partijen.filter(p => passed(p.besteld_op, now));
  const href = (page, extra = '') => `#/${page}?maandag=${m}${extra}`;
  if (!placed.length) {
    if (d.orders.length) t.push({ stap: 'bestellen', toon: nowDay >= days.bestellen ? 'wait' : 'info', titel: `Bestellen voor week ${d.week}`, tekst: `${d.orders.length} regels van ${new Set(d.orders.map(o => o.klant_id)).size} klanten, ${sum(d.orders, o => o.dozen)} dozen. Dinsdag bestellen bij de leveranciers.`, href: href('bestellen'), knop: 'Bestelling maken' });
    return t;
  }
  for (const p of d.partijen) {
    if (p.stage === 'besteld' && nowDay > days.bevestiging) t.push({ stap: 'inkoop', toon: 'wait', titel: `Nog geen bevestiging van ${p.leverancier}`, tekst: `${p.nummer} · normaal komt die donderdag.`, href: href('inkoop', `&p=${p.id}`), knop: 'Bekijk' });
    if (p.twijfels) t.push({ stap: 'inkoop', toon: 'wait', titel: `${p.twijfels === 1 ? '1 regel' : `${p.twijfels} regels`} nakijken op het verzendbewijs`, tekst: `${p.nummer} · ${p.leverancier}`, href: href('inkoop', `&p=${p.id}`), knop: 'Nakijken' });
    else if (p.stage !== 'gepland' && p.stage !== 'besteld' && p.stage !== 'bevestigd' && p.exact === 'open') t.push({ stap: 'inkoop', toon: 'info', titel: `Inkooporder ${p.nummer} in Exact zetten`, tekst: `${p.leverancier} · ${p.regels.length} regels, ${p.dozen} dozen. Alles staat klaar.`, href: href('inkoop', `&p=${p.id}`), knop: 'Naar Exact' });
  }
  const arrived = nowDay >= m;
  if (arrived && !d.koers) t.push({ stap: 'maandag', toon: 'wait', titel: 'Koers van deze week invullen', tekst: 'Dollars voor één euro. De desk rekent er alle pakbonnen en facturen van deze week mee.', href: href('maandag', '&deel=koers'), knop: 'Koers invullen' });
  if (arrived && !d.counted && d.partijen.some(p => p.stage === 'verzonden' || p.stage === 'binnen')) t.push({ stap: 'maandag', toon: 'wait', titel: 'Dozen tellen', tekst: `${sum(d.regels, r => r.dozen)} dozen verwacht volgens de verzendbewijzen.`, href: href('maandag', '&deel=tellen'), knop: 'Tellen' });
  const over = d.regels.filter(r => r.rest > 0), short = d.regels.filter(r => r.rest < 0);
  if (d.counted && over.length) t.push({ stap: 'maandag', toon: 'wait', titel: `${sum(over, r => r.rest)} dozen hebben nog geen klant`, tekst: over.slice(0, 3).map(r => `${r.product} ${r.maat} (${r.nummer})`).join(', '), href: href('maandag', '&deel=verdelen'), knop: 'Verdelen' });
  if (short.length) t.push({ stap: 'maandag', toon: 'bad', titel: 'Meer verdeeld dan er binnen is', tekst: short.slice(0, 3).map(r => `${r.product} ${r.maat} (${r.nummer}): ${-r.rest} te veel`).join(', '), href: href('maandag', '&deel=verdelen'), knop: 'Verdelen' });
  const ready = d.slips.filter(s => s.status === 'klaar'), done = d.slips.filter(s => s.status === 'akkoord');
  if (ready.length) t.push({ stap: 'pakbonnen', toon: 'info', titel: `${ready.length} pakbonnen klaar voor akkoord`, tekst: 'Klopt alles, dan staan ze met één klik als concept in Outlook, met de pdf en het plantenpaspoort.', href: href('pakbonnen'), knop: 'Pakbonnen' });
  const changed = d.slips.filter(s => s.gewijzigd);
  if (changed.length) t.push({ stap: 'pakbonnen', toon: 'bad', titel: `${changed.length === 1 ? '1 pakbon' : `${changed.length} pakbonnen`} gewijzigd na akkoord`, tekst: changed.map(s => s.klant).slice(0, 3).join(', '), href: href('pakbonnen'), knop: 'Bekijk' });
  const notExact = done.filter(s => s.pakbon.exact === 'open');
  if (notExact.length) t.push({ stap: 'pakbonnen', toon: 'info', titel: `${notExact.length} verkoopfacturen nog in Exact zetten`, tekst: 'Alle regels staan klaar met de partij als kostendrager.', href: href('pakbonnen'), knop: 'Naar Exact' });
  // slips without a mail went with the goods on paper (the old way); only open mails count
  const unsent = done.filter(s => s.concept && s.concept.status !== 'verstuurd');
  if (unsent.length && done.length) t.push({ stap: 'pakbonnen', toon: 'info', titel: `${unsent.length} facturen nog versturen`, tekst: unsent.some(s => s.concept && s.concept.status === 'in_outlook') ? 'Ze staan in Outlook bij Concepten.' : 'Zet ze in Outlook of open ze als mail.', href: href('pakbonnen'), knop: 'Versturen' });
  return t;
}

export function deviations(d) {
  const out = [];
  for (const r of d.regels) {
    const pairs = [['bevestigd', r.besteld, r.bevestigd, 'bevestigd'], ['verzonden', r.bevestigd ?? r.besteld, r.verzonden, 'op het verzendbewijs'], ['geteld', r.verzonden ?? r.bevestigd, r.geteld, 'geteld']];
    for (const [stap, a, b, woord] of pairs) {
      if (a == null || b == null || a === b) continue;
      out.push({ stap, partij: r.nummer, partij_id: r.partij_id, regel_id: r.id, product: `${r.product} ${r.maat}`, van: a, naar: b, verschil: b - a, pct: a ? Math.round(((b - a) / a) * 100) : null, woord });
    }
    if (r.uitval) out.push({ stap: 'uitval', partij: r.nummer, partij_id: r.partij_id, regel_id: r.id, product: `${r.product} ${r.maat}`, van: r.dozen, naar: r.dozen - r.uitval, verschil: -r.uitval, pct: null, woord: 'uitval' });
  }
  return out;
}

// ---------------------------------------------------------------- the Deze week page
export async function overview(maandag = focusMonday(), { now = new Date() } = {}) {
  await syncProposal(maandag).catch(() => 0);
  const d = await weekData(maandag, { now });
  const days = cycleDays(maandag), nowDay = today();
  const placed = d.partijen.filter(p => passed(p.besteld_op, now));
  const conf = d.partijen.filter(p => ['bevestigd', 'verzonden', 'binnen'].includes(p.stage));
  const flown = d.partijen.filter(p => ['verzonden', 'binnen'].includes(p.stage));
  const akkoord = d.slips.filter(s => s.status === 'akkoord');
  const step = (key, dag, datum, titel, done, now_, regels, href, tone = null) => ({ key, dag, datum, titel, status: done ? 'klaar' : now_ ? 'nu' : 'straks', toon: tone, regels, href });
  const sumOrders = sum(d.orders, o => o.dozen);
  const steps = [
    step('bestellen', 'di', days.bestellen, 'Bestellen', placed.length > 0, nowDay >= days.bestellen,
      placed.length ? [`${placed.length === 1 ? '1 zending' : `${placed.length} zendingen`}: ${placed.map(p => p.nummer).join(', ')}`, `${sum(d.regels, r => r.besteld || 0)} dozen besteld`]
        : [`${new Set(d.orders.map(o => o.klant_id)).size} klanten belden, ${sumOrders} dozen`], `#/bestellen?maandag=${maandag}`),
    step('bevestiging', 'do', days.bevestiging, 'Bevestiging', placed.length > 0 && conf.length === placed.length, placed.length > 0 && nowDay >= days.bevestiging,
      placed.length ? [`${conf.length} van ${placed.length} bevestigd`, ...deviations(d).filter(x => x.stap === 'bevestigd').slice(0, 2).map(x => `${x.product}: ${x.verschil > 0 ? '+' : ''}${x.verschil} (${x.pct > 0 ? '+' : ''}${x.pct}%)`)] : ['Na het bestellen'], `#/inkoop?maandag=${maandag}`),
    step('verzonden', 'vr', days.verzonden, 'Verzonden', placed.length > 0 && flown.length === placed.length && placed.every(p => p.exact === 'in_exact'), flown.length > 0 || (placed.length > 0 && nowDay >= days.verzonden),
      flown.length ? [`${flown.length} van ${placed.length} verzendbewijzen binnen`, `${flown.filter(p => p.exact === 'in_exact').length} inkooporders in Exact`] : ['Vrijdag op het vliegtuig'], `#/inkoop?maandag=${maandag}`,
      flown.some(p => p.twijfels) ? 'wait' : null),
    step('maandag', 'ma', maandag, 'Binnen en verdelen', !!d.koers && d.counted && !d.regels.some(r => r.rest !== 0), nowDay >= maandag,
      [d.koers ? `Koers 1 € = $ ${String(d.koers.toFixed(4)).replace('.', ',')}` : 'Koers nog invullen', d.counted ? `${sum(d.regels, r => r.geteld || 0)} dozen geteld` : `${sum(d.regels, r => r.dozen)} dozen verwacht`,
        d.regels.length ? (d.regels.some(r => r.rest > 0) ? `${sum(d.regels.filter(r => r.rest > 0), r => r.rest)} dozen nog zonder klant` : d.regels.some(r => r.rest < 0) ? 'Te veel verdeeld' : 'Alles heeft een klant') : ''].filter(Boolean),
      `#/maandag?maandag=${maandag}`, d.regels.some(r => r.rest < 0) ? 'bad' : null),
    step('pakbonnen', 'ma', maandag, 'Pakbon en factuur', d.slips.length > 0 && akkoord.length === d.slips.length && akkoord.every(s => s.pakbon.exact === 'in_exact' && (!s.concept || s.concept.status === 'verstuurd')), nowDay >= maandag,
      d.slips.length ? [`${akkoord.length} van ${d.slips.length} akkoord`, `${akkoord.filter(s => s.pakbon.exact === 'in_exact').length} in Exact · ${akkoord.filter(s => s.concept && s.concept.status === 'verstuurd').length} verstuurd`] : ['Na het verdelen'], `#/pakbonnen?maandag=${maandag}`),
  ];
  // the step Jan is in now: the first one not done whose day has come
  const cur = steps.find(s => s.status === 'nu');
  if (cur) cur.huidig = true;
  const prevMonday = addDays(maandag, -7);
  const prev = await weekData(prevMonday, { now });
  const prevTasks = prev.partijen.length ? weekTasks(prev, { now }) : [];
  const next = addDays(maandag, 7);
  const nextOrders = await one(`SELECT count(DISTINCT klant_id) AS klanten, coalesce(sum(dozen), 0) AS dozen FROM weekorders WHERE maandag = $1 AND aangemaakt <= $2`, [next, now]);
  const rest = d.regels.map(r => ({ partij: r.nummer, regio: r.regio, product: `${r.product} ${r.maat}`, in: r.dozen, uit: r.gegeven, uitval: r.uitval, rest: r.rest }));
  return {
    maandag, week: d.week, jaar: d.jaar, vandaag: nowDay, dagen: days, koers: d.koers, counted: d.counted,
    stappen: steps, taken: weekTasks(d, { now }), afwijkingen: deviations(d),
    partijen: d.partijen.map(p => ({ id: p.id, nummer: p.nummer, regio: p.regio, leverancier: p.leverancier, leverancier_id: p.leverancier_id, stage: p.stage, dozen: p.dozen, exact: p.exact, twijfels: p.twijfels, vlucht: p.vlucht, awb: p.awb, verzonden_op: passed(p.verzonden_op, now) ? p.verzonden_op : null, verwacht: !passed(p.verzonden_op, now) && p.verzonden_op ? p.verzonden_op : null })),
    klanten: new Set(d.orders.map(o => o.klant_id)).size, dozen: sumOrders,
    omzet: r2(sum(d.slips, s => s.totaal)), pakbonnen: { totaal: d.slips.length, akkoord: akkoord.length },
    vorige: prevTasks.length ? { maandag: prevMonday, week: prev.week, taken: prevTasks } : null,
    volgende: { maandag: next, week: isoWeek(next).week, klanten: nextOrders.klanten, dozen: nextOrders.dozen, bestellen: addDays(next, -6) },
    netto: rest,
  };
}

export async function badges(now = new Date()) {
  const m = focusMonday();
  const weeks = [addDays(m, -7), m];
  // how many shipments and packing slips still ask for something (each counted once)
  const r = await one(`SELECT
      (SELECT count(*) FROM partijen p WHERE p.maandag = ANY($1) AND p.verzonden_op <= $2
         AND (p.exact = 'open' OR EXISTS (SELECT 1 FROM partij_regels r WHERE r.partij_id = p.id AND r.twijfel IS NOT NULL))) AS inkoop,
      (SELECT count(*) FROM pakbonnen s WHERE s.maandag = ANY($1) AND s.status = 'akkoord'
         AND (s.exact = 'open' OR EXISTS (SELECT 1 FROM concepten c WHERE c.pakbon_id = s.id AND c.status IN ('concept','in_outlook')))) AS pakbonnen`, [weeks, now]);
  return { inkoop: r.inkoop, pakbonnen: r.pakbonnen };
}
