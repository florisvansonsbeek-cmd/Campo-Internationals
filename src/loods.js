// The loods: what came in, minus what left on a truck, went back to the grower or was sold from stock.
// Every lot is one invoice line; what is still there is either waiting for a customer's truck or free.
import { rows } from './db.js';

const H = 36e5;
// how long a plant may stand before it becomes a worry (hours): cut flowers go fast, pot plants keep longer
const AGE = { snijbloem: [48, 96], default: [120, 240] };

export async function loodsNow() {
  const now = new Date();
  const lots = await rows(`
    SELECT fr.id AS regel_id, fr.factuur_id, fr.plant_id, fr.aantal, fr.prijs, f.kweker_id, f.nummer, z.id AS zending_id, z.aankomst_werkelijk AS binnen_om,
           pl.naam, pl.potmaat, pl.hoogte, pl.eenheid, pl.groep, pl.per_laag, pl.verkoopprijs AS lijstprijs, g.naam AS kweker,
           coalesce((SELECT json_agg(json_build_object('id', t.id, 'bestemming', t.bestemming, 'klant_id', t.klant_id, 'klant', k.naam, 'plaats', k.plaats,
               'aantal', t.aantal, 'status', t.status, 'soort', t.soort, 'verkoopprijs', t.verkoopprijs,
               'vertrek', coalesce(CASE WHEN l.vertrek_werkelijk <= now() THEN l.vertrek_werkelijk END, l.vertrek_gepland, ol.vertrek_gepland),
               'vertrokken', coalesce(l.vertrek_werkelijk, ol.vertrek_werkelijk) <= now()) ORDER BY t.id)
              FROM toewijzingen t LEFT JOIN klanten k ON k.id = t.klant_id LEFT JOIN leveringen l ON l.id = t.levering_id
              LEFT JOIN klant_order_regels kor ON kor.id = t.order_regel_id
              LEFT JOIN LATERAL (SELECT vertrek_gepland, vertrek_werkelijk FROM leveringen WHERE order_id = kor.order_id ORDER BY vertrek_gepland LIMIT 1) ol ON true
             WHERE t.regel_id = fr.id AND t.status <> 'afgewezen'), '[]') AS uit
      FROM factuur_regels fr JOIN facturen f ON f.id = fr.factuur_id JOIN zendingen z ON z.factuur_id = f.id
      JOIN planten pl ON pl.id = fr.plant_id JOIN kwekers g ON g.id = f.kweker_id
     WHERE z.aankomst_werkelijk <= now() AND z.aankomst_werkelijk > now() - interval '21 days'
     ORDER BY z.aankomst_werkelijk`);

  const partijen = [];
  for (const p of lots) {
    let weg = 0, vrij = 0;
    const klaar = [];
    for (const t of p.uit) {
      if (t.bestemming === 'retour' || t.status === 'geleverd') { weg += t.aantal; continue; }
      if (t.bestemming === 'voorraad') { vrij += t.aantal; continue; }
      if (t.vertrokken) { weg += t.aantal; continue; }
      klaar.push({ toewijzing_id: t.id, klant_id: t.klant_id, klant: t.klant, plaats: t.plaats, aantal: t.aantal, vertrek: t.vertrek, voorstel: t.status === 'voorstel', laat: t.vertrek && new Date(t.vertrek) < now });
    }
    const verdeeld = p.uit.reduce((s, t) => s + t.aantal, 0);
    const open = Math.max(0, p.aantal - verdeeld);
    vrij += open;
    const gereserveerd = klaar.reduce((s, k) => s + k.aantal, 0);
    const hier = gereserveerd + vrij;
    if (hier <= 0) continue;
    const uren = (now - new Date(p.binnen_om)) / H;
    const [warn, bad] = AGE[p.groep] || AGE.default;
    partijen.push({
      regel_id: p.regel_id, factuur_id: p.factuur_id, nummer: p.nummer, kweker_id: p.kweker_id, kweker: p.kweker, binnen_om: p.binnen_om, uren: Math.round(uren),
      plant_id: p.plant_id, plant: p.naam, maat: [p.potmaat, p.hoogte].filter(Boolean).join(' '), eenheid: p.eenheid, groep: p.groep, per_laag: p.per_laag,
      prijs: Number(p.prijs), lijstprijs: p.lijstprijs == null ? null : Number(p.lijstprijs),
      aantal: p.aantal, hier, gereserveerd, vrij, nog_verdelen: open, klanten: klaar,
      leeftijd: vrij > 0 && uren > bad ? 'bad' : vrij > 0 && uren > warn ? 'wait' : 'ok',
    });
  }

  // one row per plant, newest lots inside
  const byPlant = new Map();
  for (const p of partijen) {
    const k = p.plant_id;
    if (!byPlant.has(k)) byPlant.set(k, { plant_id: k, plant: p.plant, maat: p.maat, eenheid: p.eenheid, groep: p.groep, hier: 0, gereserveerd: 0, vrij: 0, waarde: 0, vrij_waarde: 0, oudste: p.binnen_om, leeftijd: 'ok', kwekers: new Set(), klanten: new Map(), partijen: [] });
    const g = byPlant.get(k);
    g.hier += p.hier; g.gereserveerd += p.gereserveerd; g.vrij += p.vrij;
    g.waarde += p.hier * p.prijs; g.vrij_waarde += p.vrij * p.prijs;
    if (new Date(p.binnen_om) < new Date(g.oudste)) g.oudste = p.binnen_om;
    if (p.leeftijd === 'bad' || (p.leeftijd === 'wait' && g.leeftijd === 'ok')) g.leeftijd = p.leeftijd;
    g.kwekers.add(p.kweker);
    for (const c of p.klanten) {
      const x = g.klanten.get(c.klant_id) || { klant_id: c.klant_id, klant: c.klant, plaats: c.plaats, aantal: 0, vertrek: c.vertrek, laat: false, voorstel: false };
      x.aantal += c.aantal; if (c.vertrek && (!x.vertrek || new Date(c.vertrek) < new Date(x.vertrek))) x.vertrek = c.vertrek; x.laat = x.laat || c.laat; x.voorstel = x.voorstel || c.voorstel;
      g.klanten.set(c.klant_id, x);
    }
    g.partijen.push(p);
  }
  const planten = [...byPlant.values()].map(g => ({ ...g, kwekers: [...g.kwekers], klanten: [...g.klanten.values()].sort((a, b) => new Date(a.vertrek || 8.64e15) - new Date(b.vertrek || 8.64e15)), waarde: Math.round(g.waarde), vrij_waarde: Math.round(g.vrij_waarde) }))
    .sort((a, b) => (b.leeftijd === 'bad') - (a.leeftijd === 'bad') || b.vrij - a.vrij || b.hier - a.hier);

  // what is still on its way here today and tomorrow morning
  const komt = await rows(`
    SELECT z.id, z.aankomst_gepland, z.aankomst_verwacht, CASE WHEN z.vertrek_werkelijk <= now() THEN z.vertrek_werkelijk END AS vertrokken, g.naam AS kweker, z.factuur_id, z.aanbod_id,
           coalesce((SELECT sum(fr.aantal) FROM factuur_regels fr WHERE fr.factuur_id = z.factuur_id), (SELECT sum(ar.bestellen) FROM aanbod_regels ar WHERE ar.aanbod_id = z.aanbod_id), 0) AS stuks
      FROM zendingen z JOIN kwekers g ON g.id = z.kweker_id
     WHERE (z.aankomst_werkelijk IS NULL OR z.aankomst_werkelijk > now()) AND z.aankomst_gepland BETWEEN now() - interval '12 hours' AND now() + interval '36 hours'
     ORDER BY z.aankomst_gepland`);

  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  return {
    nu: now.toISOString(),
    kpi: {
      stuks: sum(partijen, p => p.hier), waarde: Math.round(sum(partijen, p => p.hier * p.prijs)),
      gereserveerd: sum(partijen, p => p.gereserveerd), klanten: new Set(partijen.flatMap(p => p.klanten.map(c => c.klant_id))).size,
      vrij: sum(partijen, p => p.vrij), vrij_waarde: Math.round(sum(partijen, p => p.vrij * p.prijs)),
      te_lang: partijen.filter(p => p.leeftijd !== 'ok').length, nog_verdelen: sum(partijen, p => p.nog_verdelen),
      komt: komt.length, komt_stuks: sum(komt, z => Number(z.stuks)),
    },
    planten, partijen, komt: komt.map(z => ({ ...z, stuks: Number(z.stuks) })),
  };
}
