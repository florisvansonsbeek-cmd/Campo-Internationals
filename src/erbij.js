// What can go along: free stock in the loods, matched with trucks that leave for a customer anyway.
// The desk suggests per lot the trucks it fits on, and per truck the lots that fit its customer.
// Jan decides what goes on (and tells the customer); nothing is put on a truck by itself.
import { rows, one, pool } from './db.js';
import { loodsNow } from './loods.js';
import { familyKey, colorOf } from './allocate.js';

const DAY = 864e5;
const uniq = a => [...new Set(a)];
const ago = d => (d === 0 ? 'vandaag' : d === 1 ? 'gisteren' : `${d} dagen geleden`);

// trucks to customers that have not left yet: planned in the window, or one truck by id
async function trucksLeaving({ hours = 36, id = null } = {}) {
  return rows(`
    SELECT l.id, l.klant_id, l.order_id, l.vervoerder, l.vertrek_gepland, l.aankomst_gepland,
           k.naam AS klant, k.plaats, k.land, k.contact, k.telefoon, k.whatsapp, k.taal, k.kredietlimiet,
           (SELECT coalesce(sum(bedrag), 0) FROM verkoopfacturen v WHERE v.klant_id = k.id AND v.betaald_op IS NULL AND v.vervaldatum < current_date) AS over_tijd,
           (SELECT coalesce(sum(bedrag), 0) FROM verkoopfacturen v WHERE v.klant_id = k.id AND v.betaald_op IS NULL) AS open_bedrag
      FROM leveringen l JOIN klanten k ON k.id = l.klant_id
     WHERE (l.vertrek_werkelijk IS NULL OR l.vertrek_werkelijk > now())
       AND ${id ? 'l.id = $1' : "l.vertrek_gepland BETWEEN now() - interval '2 hours' AND now() + make_interval(hours => $1)"}
     ORDER BY l.vertrek_gepland`, [id || hours]);
}

// what each customer took over the last year, per plant
async function history(klantIds) {
  if (!klantIds.length) return new Map();
  const r = await rows(`
    SELECT t.klant_id, fr.plant_id, count(DISTINCT f.datum)::int AS keer, max(f.datum) AS laatst,
           sum(t.aantal)::numeric / nullif(count(DISTINCT f.datum), 0) AS gem, avg(t.verkoopprijs) AS prijs
      FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id
     WHERE t.bestemming = 'klant' AND t.status IN ('bevestigd', 'geleverd') AND f.datum > current_date - 365 AND t.klant_id = ANY($1)
     GROUP BY t.klant_id, fr.plant_id`, [klantIds]);
  const out = new Map();
  for (const h of r) { if (!out.has(h.klant_id)) out.set(h.klant_id, []); out.get(h.klant_id).push(h); }
  return out;
}

async function plantInfo() {
  const ps = await rows('SELECT id, naam, potmaat, hoogte, per_laag, verkoopprijs, eenheid FROM planten');
  return new Map(ps.map(p => [p.id, { ...p, fam: familyKey(p), col: colorOf(p) }]));
}

// how well one lot fits one truck: does this customer buy it, is he due, colour, time to load, money
function fit(lot, t, hist, info, now) {
  const p = info.get(lot.plant_id);
  if (!p) return null;
  const same = (hist.get(t.klant_id) || []).filter(h => info.get(h.plant_id)?.fam === p.fam);
  if (!same.length) return null;
  const keer = same.reduce((s, h) => s + h.keer, 0);
  const exact = same.find(h => h.plant_id === lot.plant_id);
  const laatst = same.reduce((m, h) => (!m || h.laatst > m ? h.laatst : m), null);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const dagen = laatst ? Math.round((today - new Date(`${laatst}T00:00:00`)) / DAY) : null;
  const ritme = keer > 1 ? 365 / keer : null;
  const due = dagen != null && dagen < 0 ? 0.2 : ritme && dagen != null ? Math.min(1.3, dagen / ritme) : 0.5;
  const colorFit = !p.col || exact ? 1 : 0.55;
  const leaveIn = (new Date(t.vertrek_gepland) - now) / 36e5;
  const timeFit = leaveIn < 0.5 ? 0.4 : 1;
  let risk = 0;
  if (Number(t.over_tijd) > 0) risk += Math.min(15, Number(t.over_tijd) / 500);
  if (t.kredietlimiet && Number(t.open_bedrag) > Number(t.kredietlimiet)) risk += 25;
  const score = Math.max(1, Math.min(99, Math.round(40 * Math.min(1, keer / 8) + 25 * Math.min(1, due) + 20 * colorFit + 15 * timeFit - risk)));
  const per = p.per_laag || 1;
  const gem = same.reduce((s, h) => s + Number(h.gem || 0) * h.keer, 0) / Math.max(1, keer);
  const aantal = lot.vrij < per ? lot.vrij : Math.max(per, Math.min(lot.vrij, Math.round(gem / per) * per || per));
  const avgPrice = same.filter(h => h.prijs != null).reduce((s, h, _, a) => s + Number(h.prijs) / a.length, 0);
  const prijs = Math.round((exact && exact.prijs != null ? Number(exact.prijs) : avgPrice || Number(p.verkoopprijs || 0) * 0.95) * 100) / 100;
  const waar = [`kocht ${exact ? 'deze plant' : 'deze soort'} ${keer}× dit jaar`];
  if (dagen != null && dagen >= 0) waar.push(`laatst ${ago(dagen)}`);
  if (dagen != null && dagen < 0) waar.push('krijgt er al wat van');
  if (risk >= 25) waar.push('let op: boven de kredietlimiet');
  else if (risk > 0) waar.push('let op: betaalt laat');
  return { score, aantal, prijs, reden: waar.join(', '), keer, risk };
}

const truckView = t => ({ levering_id: t.id, klant_id: t.klant_id, klant: t.klant, plaats: t.plaats, land: t.land, contact: t.contact, telefoon: t.telefoon, whatsapp: t.whatsapp, taal: t.taal, vervoerder: t.vervoerder, vertrek: t.vertrek_gepland, aankomst: t.aankomst_gepland });
const lotView = l => ({ regel_id: l.regel_id, plant_id: l.plant_id, plant: l.plant, maat: l.maat, eenheid: l.eenheid, kweker: l.kweker, uren: l.uren, vrij: l.vrij, leeftijd: l.leeftijd, per_laag: l.per_laag, inkoop: l.prijs, lijstprijs: l.lijstprijs });

// every free lot with the trucks it fits, and every leaving truck with the lots that fit it
export async function erbijBoard({ hours = 36 } = {}) {
  const now = new Date();
  const loods = await loodsNow();
  const free = loods.partijen.filter(p => p.vrij > 0);
  const trucks = await trucksLeaving({ hours });
  const hist = await history(uniq(trucks.map(t => t.klant_id)));
  const info = await plantInfo();
  const pairs = [];
  for (const lot of free) for (const t of trucks) {
    const f = fit(lot, t, hist, info, now);
    if (f && f.score >= 35) pairs.push({ lot, t, ...f });
  }
  const byScore = (a, b) => b.score - a.score || new Date(a.t.vertrek_gepland) - new Date(b.t.vertrek_gepland);
  return {
    nu: now.toISOString(),
    vrij: { stuks: loods.kpi.vrij, waarde: loods.kpi.vrij_waarde, te_lang: loods.kpi.te_lang },
    partijen: free.map(lot => ({ ...lotView(lot), wagens: pairs.filter(p => p.lot === lot).sort(byScore).slice(0, 3).map(p => ({ ...truckView(p.t), score: p.score, aantal: p.aantal, prijs: p.prijs, reden: p.reden })) }))
      .sort((a, b) => ({ bad: 0, wait: 1, ok: 2 }[a.leeftijd] - { bad: 0, wait: 1, ok: 2 }[b.leeftijd]) || (b.wagens.length ? 1 : 0) - (a.wagens.length ? 1 : 0) || b.vrij * b.inkoop - a.vrij * a.inkoop),
    wagens: trucks.map(t => ({ ...truckView(t), past: pairs.filter(p => p.t === t).sort(byScore).slice(0, 4).map(p => ({ ...lotView(p.lot), score: p.score, aantal: p.aantal, prijs: p.prijs, reden: p.reden })) })),
  };
}

// one truck: what fits its customer best, and the rest of the free stock
export async function erbijForTruck(leveringId) {
  const now = new Date();
  const [t] = await trucksLeaving({ id: leveringId });
  if (!t) return null;
  const loods = await loodsNow();
  const free = loods.partijen.filter(p => p.vrij > 0);
  const hist = await history([t.klant_id]);
  const info = await plantInfo();
  const scored = free.map(lot => ({ lot, f: fit(lot, t, hist, info, now) }));
  const past = scored.filter(x => x.f && x.f.score >= 35).sort((a, b) => b.f.score - a.f.score)
    .map(x => ({ ...lotView(x.lot), score: x.f.score, aantal: x.f.aantal, prijs: x.f.prijs, reden: x.f.reden }));
  const anders = scored.filter(x => !(x.f && x.f.score >= 35)).map(x => {
    const p = info.get(x.lot.plant_id);
    return { ...lotView(x.lot), aantal: Math.min(x.lot.vrij, p && p.per_laag ? p.per_laag : x.lot.vrij), prijs: Math.round(Number(x.lot.lijstprijs || x.lot.prijs * 1.3) * 100) / 100, reden: x.f ? x.f.reden : 'kocht dit nog niet' };
  }).sort((a, b) => a.plant.localeCompare(b.plant, 'nl'));
  return { nu: now.toISOString(), wagen: truckView(t), past, anders };
}

// give free stock from the loods to a customer, on a given truck (or his next one)
export async function giveFromLoods(regelId, { klant_id, aantal, verkoopprijs = null, levering_id = null }) {
  const l = (await loodsNow()).partijen.find(p => p.regel_id === regelId);
  if (!l) { const e = new Error('Deze partij staat niet (meer) in de loods.'); e.status = 404; throw e; }
  if (aantal > l.vrij) { const e = new Error(`Er is nog ${l.vrij} vrij van ${l.plant}.`); e.status = 400; throw e; }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let lev = null;
    if (levering_id) {
      lev = (await c.query(`SELECT id, klant_id FROM leveringen WHERE id = $1 AND (vertrek_werkelijk IS NULL OR vertrek_werkelijk > now())`, [levering_id])).rows[0];
      if (!lev) { const e = new Error('Deze wagen is al vertrokken.'); e.status = 409; throw e; }
      klant_id = lev.klant_id;
    } else {
      lev = (await c.query(`SELECT id FROM leveringen WHERE klant_id = $1 AND vertrek_gepland BETWEEN now() - interval '1 hour' AND now() + interval '48 hours' AND (vertrek_werkelijk IS NULL OR vertrek_werkelijk > now()) ORDER BY vertrek_gepland LIMIT 1`, [klant_id])).rows[0] || null;
    }
    // first what has no destination yet, then what was put aside as stock
    let need = Math.max(0, aantal - l.nog_verdelen);
    for (const t of (await c.query(`SELECT id, aantal FROM toewijzingen WHERE regel_id = $1 AND bestemming = 'voorraad' AND status = 'bevestigd' ORDER BY id DESC`, [regelId])).rows) {
      if (need <= 0) break;
      const take = Math.min(need, t.aantal);
      if (take === t.aantal) await c.query('DELETE FROM toewijzingen WHERE id = $1', [t.id]); else await c.query('UPDATE toewijzingen SET aantal = aantal - $2 WHERE id = $1', [t.id, take]);
      need -= take;
    }
    await c.query(`INSERT INTO toewijzingen (regel_id, bestemming, klant_id, levering_id, aantal, verkoopprijs, soort, status, reden, door) VALUES ($1, 'klant', $2, $3, $4, $5, 'aanbod', 'bevestigd', $6, 'jan')`,
      [regelId, klant_id, lev ? lev.id : null, aantal, verkoopprijs, lev && levering_id ? 'Uit de loods erbij op een wagen die toch vertrok' : 'Uit de loods aan klant gegeven']);
    await c.query('COMMIT');
    return { partij: l, levering_id: lev ? lev.id : null, klant_id };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
