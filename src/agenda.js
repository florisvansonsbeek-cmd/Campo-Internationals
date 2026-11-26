// The agenda: per day the trucks that come in and go out, what customers need that day without a truck yet,
// and offers that would arrive if Jan orders them. Near now every truck gets its live state; further back it
// is done, further ahead it is planned. Also the trucks of one day (Vandaag) and one customer's truck.
import { rows, one } from './db.js';
import { statesFor } from './stroom.js';
import { erbijBoard, erbijForTruck } from './erbij.js';

const pad = n => String(n).padStart(2, '0');
export const ymd = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const HOUR = 36e5;

export async function agenda(van, tot) {
  const now = new Date();
  const zs = await rows(`
    SELECT z.id, z.kweker_id, g.naam AS kweker, g.plaats, g.land, g.whatsapp, g.telefoon, z.factuur_id, z.aanbod_id, z.vervoerder, z.karren,
           z.vertrek_gepland, z.aankomst_gepland, f.nummer AS factuur_nummer, a.bestelnummer,
           CASE WHEN z.aankomst_werkelijk <= now() THEN z.aankomst_werkelijk END AS binnen,
           coalesce((SELECT sum(aantal) FROM factuur_regels WHERE factuur_id = z.factuur_id), (SELECT sum(coalesce(bestellen, 0)) FROM aanbod_regels WHERE aanbod_id = z.aanbod_id), 0)::int AS stuks
      FROM zendingen z JOIN kwekers g ON g.id = z.kweker_id LEFT JOIN facturen f ON f.id = z.factuur_id LEFT JOIN aanbiedingen a ON a.id = z.aanbod_id
     WHERE (CASE WHEN z.aankomst_werkelijk <= now() THEN z.aankomst_werkelijk ELSE z.aankomst_gepland END) >= $1::date
       AND (CASE WHEN z.aankomst_werkelijk <= now() THEN z.aankomst_werkelijk ELSE z.aankomst_gepland END) < $2::date + 1`, [van, tot]);
  const ls = await rows(`
    SELECT l.id, l.klant_id, k.naam AS klant, k.plaats, k.land, k.whatsapp, k.telefoon, k.contact, k.taal, l.order_id, o.nummer AS order_nummer, l.vervoerder,
           l.vertrek_gepland, l.aankomst_gepland,
           CASE WHEN l.vertrek_werkelijk <= now() THEN l.vertrek_werkelijk END AS vertrok,
           CASE WHEN l.aankomst_werkelijk <= now() THEN l.aankomst_werkelijk END AS af,
           (coalesce((SELECT sum(t.aantal) FROM toewijzingen t WHERE t.levering_id = l.id AND t.status <> 'afgewezen'), 0)
            + coalesce((SELECT sum(r.aantal) FROM klant_order_regels r WHERE r.order_id = l.order_id
                         AND NOT EXISTS (SELECT 1 FROM toewijzingen t WHERE t.order_regel_id = r.id AND t.levering_id IS NOT NULL AND t.status <> 'afgewezen')), 0))::int AS stuks
      FROM leveringen l JOIN klanten k ON k.id = l.klant_id LEFT JOIN klant_orders o ON o.id = l.order_id
     WHERE (CASE WHEN l.vertrek_werkelijk <= now() THEN l.vertrek_werkelijk ELSE l.vertrek_gepland END) >= $1::date
       AND (CASE WHEN l.vertrek_werkelijk <= now() THEN l.vertrek_werkelijk ELSE l.vertrek_gepland END) < $2::date + 1`, [van, tot]);

  // live states only near now: a day and a bit back, two and a half days ahead
  const near = t => { const d = new Date(t) - now; return d > -30 * HOUR && d < 60 * HOUR; };
  const st = await statesFor(zs.filter(z => near(z.aankomst_gepland)).map(z => z.id), ls.filter(l => near(l.vertrek_gepland)).map(l => l.id), now);

  const binnen = zs.map(z => {
    const s = st.z.get(z.id);
    const state = s ? s.state : z.binnen ? 'binnen' : 'gepland';
    return {
      id: z.id, dag: ymd(z.binnen || z.aankomst_gepland), tijd: s ? s.eta : (z.binnen || z.aankomst_gepland), gepland: z.aankomst_gepland, vertrek: s ? s.vertrek : z.vertrek_gepland,
      kweker: z.kweker, kweker_id: z.kweker_id, plaats: z.plaats, land: z.land, whatsapp: z.whatsapp, telefoon: z.telefoon, nummer: z.factuur_nummer || z.bestelnummer || null,
      vervoerder: z.vervoerder, karren: z.karren == null ? null : Number(z.karren), stuks: z.stuks,
      state, toon: s ? s.toon : state === 'binnen' ? 'done' : new Date(z.aankomst_gepland) < now ? 'wait' : 'ok',
      delay: s ? s.delay : 0, silent: s ? s.silentLate : false, reden: s ? s.reden : (state !== 'binnen' && new Date(z.aankomst_gepland) < now ? 'Nooit als binnen gemeld' : null),
    };
  }).sort((a, b) => new Date(a.tijd) - new Date(b.tijd));
  const weg = ls.map(l => {
    const s = st.l.get(l.id);
    const state = s ? s.state : l.af ? 'afgeleverd' : l.vertrok ? 'onderweg' : 'klaar';
    return {
      id: l.id, dag: ymd(l.vertrok || l.vertrek_gepland), tijd: s ? s.vertrek : (l.vertrok || l.vertrek_gepland), gepland: l.vertrek_gepland,
      aankomst: s ? s.eta : (l.af || l.aankomst_gepland), aankomst_gepland: l.aankomst_gepland,
      klant: l.klant, klant_id: l.klant_id, plaats: l.plaats, land: l.land, whatsapp: l.whatsapp, telefoon: l.telefoon, contact: l.contact, taal: l.taal, order: l.order_nummer, vervoerder: l.vervoerder, stuks: l.stuks,
      state, toon: s ? s.toon : state === 'afgeleverd' ? 'done' : 'ok', delay: s ? s.delay : 0, reden: s ? s.reden : null, krap: s ? s.krap : false, uitstel: s ? s.uitstel : 0,
      wacht_op: s ? s.wacht_op.filter(w => w.state !== 'binnen') : [],
    };
  }).sort((a, b) => new Date(a.tijd) - new Date(b.tijd));

  // customers who need something on a day and have no truck for it yet
  const nodig = (await rows(`
    SELECT ko.id, ko.nummer, ko.klant_id, k.naam AS klant, k.plaats, ko.gewenst_op,
           coalesce((SELECT sum(aantal) FROM klant_order_regels WHERE order_id = ko.id), 0)::int AS stuks
      FROM klant_orders ko JOIN klanten k ON k.id = ko.klant_id
     WHERE ko.gewenst_op BETWEEN $1 AND $2 AND ko.status IN ('open', 'toegewezen')
       AND NOT EXISTS (SELECT 1 FROM leveringen l WHERE l.order_id = ko.id)
     ORDER BY ko.gewenst_op, k.naam`, [van, tot])).map(o => ({ ...o, dag: typeof o.gewenst_op === 'string' ? o.gewenst_op : ymd(o.gewenst_op) }));
  // offers that would arrive on a day if Jan orders them
  const aanbod = (await rows(`
    SELECT a.id, g.naam AS kweker, a.levering, a.geldig_tot, a.status,
           coalesce((SELECT sum(aantal) FROM aanbod_regels WHERE aanbod_id = a.id), 0)::int AS stuks
      FROM aanbiedingen a JOIN kwekers g ON g.id = a.kweker_id
     WHERE a.status IN ('nieuw', 'bellen') AND a.levering BETWEEN $1 AND $2 AND (a.geldig_tot IS NULL OR a.geldig_tot > now())
     ORDER BY a.levering`, [van, tot])).map(o => ({ ...o, dag: typeof o.levering === 'string' ? o.levering : ymd(o.levering) }));

  return { nu: now.toISOString(), van, tot, binnen, weg, nodig, aanbod };
}

// the trucks of one day, for Vandaag: in and out with times, and what could still go along
export async function trucksOn(dag) {
  const a = await agenda(dag, dag);
  const board = await erbijBoard({ hours: 48 });
  const fits = new Map(board.wagens.map(w => [w.levering_id, w.past]));
  for (const w of a.weg) w.erbij = w.state === 'klaar' || w.state === 'wacht' ? (fits.get(w.id) || []) : [];
  return { nu: a.nu, dag, binnen: a.binnen, weg: a.weg, nodig: a.nodig, aanbod: a.aanbod, vrij: board.vrij };
}

// one truck to a customer, for its own tab
export async function wagenNow(id) {
  const now = new Date();
  const l = await one(`
    SELECT l.*, k.naam AS klant, k.plaats, k.land, k.contact, k.telefoon, k.whatsapp, k.levervenster, k.taal, o.nummer AS order_nummer, o.gewenst_op
      FROM leveringen l JOIN klanten k ON k.id = l.klant_id LEFT JOIN klant_orders o ON o.id = l.order_id WHERE l.id = $1`, [id]);
  if (!l) return null;
  const st = await statesFor([], [id], now);
  const s = st.l.get(id);
  let inhoud = st.al.filter(a => a.levering_id === id).map(a => {
    const z = st.z.get(a.zending_id);
    return { zending_id: a.zending_id, kweker: z ? z.kweker : null, kweker_state: z ? z.state : null, kweker_eta: z ? z.eta : null, kweker_toon: z ? z.toon : null,
      plant_id: a.plant_id, naam: a.naam, maat: [a.potmaat, a.hoogte].filter(Boolean).join(' '), eenheid: a.eenheid, aantal: a.aantal, waarde: Math.round(Number(a.waarde)), voorstel: a.voorstel };
  });
  if (!inhoud.length && l.order_id) {
    inhoud = (await rows(`SELECT r.plant_id, p.naam, p.potmaat, p.hoogte, p.eenheid, r.aantal, r.prijs FROM klant_order_regels r JOIN planten p ON p.id = r.plant_id WHERE r.order_id = $1 ORDER BY p.naam`, [l.order_id]))
      .map(r => ({ zending_id: null, kweker: null, kweker_state: null, plant_id: r.plant_id, naam: r.naam, maat: [r.potmaat, r.hoogte].filter(Boolean).join(' '), eenheid: r.eenheid, aantal: r.aantal, waarde: Math.round(r.aantal * Number(r.prijs || 0)), voorstel: false, open: true }));
  }
  const erbij = s.state === 'klaar' || s.state === 'wacht' ? await erbijForTruck(id) : null;
  return {
    nu: now.toISOString(),
    wagen: {
      id: l.id, klant_id: l.klant_id, klant: l.klant, plaats: l.plaats, land: l.land, contact: l.contact, telefoon: l.telefoon, whatsapp: l.whatsapp, taal: l.taal,
      levervenster: l.levervenster, order: l.order_nummer, order_id: l.order_id, gewenst_op: l.gewenst_op, vervoerder: l.vervoerder,
      vertrek_gepland: l.vertrek_gepland, aankomst_gepland: l.aankomst_gepland, ...s, gebeurtenissen: undefined,
    },
    inhoud, erbij, gebeurtenissen: (s.gebeurtenissen || []).slice().reverse(),
  };
}
