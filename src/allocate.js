// Who gets what: proposals from open customer orders, and suggestions for what is left over.
import { rows, one } from './db.js';

const COLORS = /\s(wit|roze|paars|blauw|geel|oranje|rood)$/i;
export const familyKey = p => `${String(p.naam).replace(COLORS, '').toLowerCase()}|${p.potmaat || ''}|${p.hoogte || ''}`;
export const colorOf = p => { const m = String(p.naam).match(COLORS); return m ? m[1].toLowerCase() : null; };

// open order lines for a plant around a delivery date, oldest need first
export async function openOrderLines(db, plantId, datum) {
  const { rows: r } = await db.query(`
    SELECT kor.id AS order_regel_id, ko.id AS order_id, ko.nummer, ko.klant_id, k.naam AS klant, ko.gewenst_op, ko.besteld_op,
           kor.aantal, kor.prijs,
           kor.aantal - coalesce((SELECT sum(t.aantal) FROM toewijzingen t WHERE t.order_regel_id = kor.id AND t.status <> 'afgewezen'), 0) AS open,
           (SELECT l.id FROM leveringen l WHERE l.order_id = ko.id ORDER BY l.vertrek_gepland LIMIT 1) AS levering_id
      FROM klant_order_regels kor
      JOIN klant_orders ko ON ko.id = kor.order_id
      JOIN klanten k ON k.id = ko.klant_id
     WHERE kor.plant_id = $1 AND ko.status IN ('open', 'toegewezen')
       AND ko.gewenst_op BETWEEN $2::date - 2 AND $2::date + 7
     ORDER BY ko.gewenst_op, ko.besteld_op`, [plantId, datum]);
  return r.filter(x => x.open > 0);
}

// proposals for every line of an invoice that has no allocation yet
export async function proposeForInvoice(db, factuurId, { klantRefs = {} } = {}) {
  const f = (await db.query('SELECT id, datum FROM facturen WHERE id = $1', [factuurId])).rows[0];
  const lines = (await db.query(`SELECT fr.* FROM factuur_regels fr WHERE fr.factuur_id = $1 AND fr.plant_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM toewijzingen t WHERE t.regel_id = fr.id AND t.status <> 'afgewezen') ORDER BY regelnr`, [factuurId])).rows;
  let made = 0;
  for (const line of lines) {
    let left = line.aantal;
    let open = await openOrderLines(db, line.plant_id, f.datum);
    const ref = klantRefs[line.id];
    if (ref) open = open.sort((a, b) => (b.klant_id === ref.klant_id) - (a.klant_id === ref.klant_id) || (b.order_id === ref.order_id) - (a.order_id === ref.order_id));
    for (const o of open) {
      if (left <= 0) break;
      const n = Math.min(left, o.open);
      const byRef = ref && (ref.klant_id === o.klant_id);
      const reden = `${byRef ? 'Staat op de factuur bij deze regel; ' : ''}open bestelling ${o.nummer} van ${o.klant}, gewenst ${new Date(o.gewenst_op + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}`;
      await db.query(`INSERT INTO toewijzingen (regel_id, bestemming, klant_id, order_regel_id, levering_id, aantal, verkoopprijs, soort, status, reden, score, door)
                      VALUES ($1, 'klant', $2, $3, $4, $5, $6, 'order', 'voorstel', $7, $8, 'ai')`,
        [line.id, o.klant_id, o.order_regel_id, o.levering_id, n, o.prijs, reden, byRef ? 99 : n === o.open ? 95 : 85]);
      left -= n; made++;
    }
  }
  return made;
}

// ranked options for the rest of one invoice line
export async function restSuggestions(regelId, { vrij = null } = {}) {
  const line = await one(`SELECT fr.*, f.datum, f.kweker_id, p.naam, p.potmaat, p.hoogte, p.per_laag, p.verkoopprijs AS lijstprijs, p.eenheid
    FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id JOIN planten p ON p.id = fr.plant_id WHERE fr.id = $1`, [regelId]);
  if (!line) return null;
  const used = await one(`SELECT coalesce(sum(aantal), 0) AS n FROM toewijzingen WHERE regel_id = $1 AND status <> 'afgewezen'`, [regelId]);
  const rest = vrij != null ? vrij : line.aantal - Number(used.n);
  const plants = await rows('SELECT id, naam, potmaat, hoogte FROM planten');
  const fam = familyKey(line), col = colorOf(line);
  const famIds = plants.filter(p => familyKey(p) === fam).map(p => p.id);

  // per customer: how often they took this plant (any colour) and this exact one, counted per delivery day
  const hist = await rows(`
    SELECT t.klant_id,
           count(DISTINCT f.datum) AS keer, max(f.datum) AS laatst, sum(t.aantal)::numeric / nullif(count(DISTINCT f.datum), 0) AS gem,
           count(DISTINCT f.datum) FILTER (WHERE fr.plant_id = $2) AS keer_exact,
           avg(t.verkoopprijs) FILTER (WHERE fr.plant_id = $2) AS prijs_exact, avg(t.verkoopprijs) AS prijs
      FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id
     WHERE t.bestemming = 'klant' AND t.status IN ('bevestigd', 'geleverd') AND f.datum > current_date - 365 AND fr.plant_id = ANY($1)
     GROUP BY t.klant_id`, [famIds, line.plant_id]);
  const klanten = await rows(`
    SELECT k.id, k.naam, k.plaats, k.land, k.kanaal, k.taal, k.kredietlimiet, k.actief,
      (SELECT coalesce(sum(bedrag), 0) FROM verkoopfacturen v WHERE v.klant_id = k.id AND v.betaald_op IS NULL AND v.vervaldatum < current_date) AS over_tijd,
      (SELECT coalesce(sum(bedrag), 0) FROM verkoopfacturen v WHERE v.klant_id = k.id AND v.betaald_op IS NULL) AS open_bedrag,
      (SELECT json_build_object('id', l.id, 'vertrek', l.vertrek_gepland) FROM leveringen l
        WHERE l.klant_id = k.id AND l.vertrek_gepland BETWEEN now() AND now() + interval '36 hours' AND (l.vertrek_werkelijk IS NULL OR l.vertrek_werkelijk > now())
        ORDER BY l.vertrek_gepland LIMIT 1) AS wagen,
      (SELECT json_build_object('nummer', ko.nummer, 'gewenst', ko.gewenst_op, 'open', kor.aantal) FROM klant_order_regels kor JOIN klant_orders ko ON ko.id = kor.order_id
        WHERE ko.klant_id = k.id AND kor.plant_id = $1 AND ko.status = 'open' AND ko.gewenst_op > $2::date + 7 ORDER BY ko.gewenst_op LIMIT 1) AS later
      FROM klanten k WHERE k.actief`, [line.plant_id, line.datum]);
  const byK = new Map(hist.map(h => [h.klant_id, h]));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  for (const k of klanten) {
    const h = byK.get(k.id);
    if (!h && !k.later) continue;
    const keer = h ? Number(h.keer) : 0;
    const exactKeer = h ? Number(h.keer_exact) : 0;
    const laatst = h ? h.laatst : null;
    const dagen = laatst ? Math.round((today - new Date(laatst + 'T00:00:00')) / 864e5) : null;
    const ritme = keer > 1 ? Math.round(365 / keer) : null;
    const due = ritme && dagen != null ? Math.min(1.3, dagen / ritme) : 0.4;
    const gem = h ? Number(h.gem) : line.per_laag * 2;
    const otherCols = keer - exactKeer;
    const colorFit = !col ? 1 : exactKeer > 0 ? 1 : otherCols >= 3 ? 0.15 : 0.6;
    const affinity = Math.min(1, keer / 8);
    const logistics = k.wagen ? 1 : 0;
    const volumeFit = Math.max(0, 1 - Math.abs(Math.min(rest, gem) - gem) / Math.max(gem, 1));
    let risk = 0;
    if (Number(k.over_tijd) > 0) risk += Math.min(15, Number(k.over_tijd) / 500);
    if (k.kredietlimiet && Number(k.open_bedrag) > Number(k.kredietlimiet)) risk += 25;
    let score = 32 * affinity + 22 * Math.min(1, due) + 22 * logistics + 14 * colorFit + 10 * volumeFit - risk + (k.later ? 18 : 0);
    score = Math.max(1, Math.min(99, Math.round(score)));
    const per = line.per_laag || 1;
    const voorstel = Math.max(per, Math.min(rest, Math.round(Math.min(rest, Math.max(gem, per)) / per) * per));
    const prijs = Math.round(((h && h.prijs_exact ? Number(h.prijs_exact) : h && h.prijs ? Number(h.prijs) : Number(line.lijstprijs)) * 0.95) * 100) / 100;
    const why = [];
    if (k.later) why.push(`Heeft al besteld voor ${new Date(k.later.gewenst + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'short' })}; kan nu al mee`);
    if (keer) why.push(`Kreeg deze plant ${keer}× in een jaar${ritme ? `, ongeveer elke ${ritme} dagen` : ''}${dagen == null ? '' : dagen < 0 ? `; krijgt er ${dagen === -1 ? 'morgen' : `over ${-dagen} dagen`} al een levering van` : `; laatste keer ${dagen === 0 ? 'vandaag' : dagen === 1 ? 'gisteren' : `${dagen} dagen geleden`}`}`);
    if (k.wagen) why.push(`Wagen naar ${k.plaats} vertrekt ${new Date(k.wagen.vertrek).toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}: kan zonder extra rit mee`);
    if (col && !exactKeer && otherCols >= 3) why.push(`Koopt deze plant wel, maar nooit in ${col}`);
    else if (col && exactKeer >= 3) why.push(`Neemt ${col} vaker: ${exactKeer}× dit jaar`);
    if (Number(k.over_tijd) > 0) why.push(`€ ${Math.round(Number(k.over_tijd)).toLocaleString('nl-NL')} staat over tijd open`);
    if (gem) why.push(`Neemt meestal zo'n ${Math.round(gem / per) * per} ${line.eenheid}`);
    out.push({ klant_id: k.id, klant: k.naam, plaats: k.plaats, land: k.land, kanaal: k.kanaal, score, aantal: voorstel, prijs, redenen: why, wagen: k.wagen });
  }
  out.sort((a, b) => b.score - a.score);
  // stock as an option: how fast this plant usually goes
  const speed = await one(`SELECT coalesce(sum(t.aantal), 0) / 90.0 AS per_dag FROM toewijzingen t JOIN factuur_regels fr ON fr.id = t.regel_id JOIN facturen f ON f.id = fr.factuur_id
     WHERE fr.plant_id = $1 AND t.bestemming = 'klant' AND f.datum > current_date - 90`, [line.plant_id]);
  const perDag = Number(speed.per_dag);
  return {
    rest, plant: line.naam,
    klanten: out.slice(0, 6),
    voorraad: { dagen: perDag > 0 ? Math.max(1, Math.round(rest / perDag)) : null, perDag: Math.round(perDag) },
  };
}
