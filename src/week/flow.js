// The stream of one week, as numbers for the picture on the Inkoop page: what every supplier delivers, through the hall in
// Nootdorp, to which customer, and whether anything is left over. Before Monday it follows the desk's proposal (the phone
// orders laid over what was confirmed or shipped); after the count it is what Jan handed out.
import { sum } from './util.js';

export function streams(d) {
  const asked = new Map();
  for (const o of d.orders) { const k = `${o.klant_id}:${o.product_id}`; asked.set(k, (asked.get(k) || 0) + o.dozen); }
  // what each customer gets of a product from all shipments together, against what he asked
  const gotAll = new Map();
  for (const p of d.partijen) for (const r of p.regels) for (const v of r.verdeling) { const k = `${v.klant_id}:${r.product_id}`; gotAll.set(k, (gotAll.get(k) || 0) + v.dozen); }
  const slipOf = new Map(d.slips.filter(s => s.pakbon).map(s => [s.klant_id, s.pakbon]));
  const partijen = d.partijen.filter(p => p.regels.length).map(p => {
    const links = p.regels.flatMap(r => r.verdeling.filter(v => v.dozen > 0).map(v => ({ van: r.id, naar: v.klant_id, dozen: v.dozen, door: v.door })));
    const per = new Map();
    for (const l of links) per.set(l.naar, (per.get(l.naar) || 0) + l.dozen);
    const prods = new Set(p.regels.map(r => r.product_id));
    const askOf = kid => [...prods].reduce((t, pid) => t + (asked.get(`${kid}:${pid}`) || 0), 0);
    const shortOf = kid => [...prods].reduce((t, pid) => t + Math.max(0, (asked.get(`${kid}:${pid}`) || 0) - (gotAll.get(`${kid}:${pid}`) || 0)), 0);
    return {
      partij_id: p.id, nummer: p.nummer, leverancier: p.leverancier, leverancier_id: p.leverancier_id, regio: p.regio,
      basis: p.regels.every(r => r.basis === 'geteld') ? 'geteld' : p.regels.some(r => r.basis === 'verzonden') ? 'verzonden' : p.regels.some(r => r.basis === 'bevestigd') ? 'bevestigd' : 'besteld',
      regels: p.regels.map(r => ({ id: r.id, product_id: r.product_id, naam: r.product, maat: r.maat, dozen: r.dozen, uitval: r.uitval || 0, per_doos: r.per_doos, rest: r.rest })),
      klanten: [...per].map(([id, dozen]) => ({ id, naam: d.K.get(id)?.naam || '?', plaats: d.K.get(id)?.plaats || '', land: d.K.get(id)?.land || '', dozen,
        gevraagd: askOf(id), tekort: shortOf(id), pakbon: slipOf.get(id)?.status === 'akkoord' ? slipOf.get(id).nummer : null, jan: links.some(l => l.naar === id && l.door === 'jan') })).sort((a, b) => b.dozen - a.dozen),
      links, dozen: sum(p.regels, r => r.dozen), uit: sum(links, l => l.dozen),
      rest: sum(p.regels, r => Math.max(0, r.rest)), teVeel: sum(p.regels, r => Math.max(0, -r.rest)), uitval: sum(p.regels, r => r.uitval || 0),
    };
  });
  // the week: every customer with what comes from which shipment, and what they asked for
  const kl = new Map();
  for (const p of partijen) for (const l of p.links) {
    if (!kl.has(l.naar)) { const k = d.K.get(l.naar) || {}; kl.set(l.naar, { id: l.naar, naam: k.naam || '?', plaats: k.plaats || '', land: k.land || '', dozen: 0, per: {} }); }
    const x = kl.get(l.naar); x.dozen += l.dozen; x.per[p.partij_id] = (x.per[p.partij_id] || 0) + l.dozen;
  }
  const got = new Map();
  for (const p of d.partijen) for (const r of p.regels) for (const v of r.verdeling) { const k = `${v.klant_id}:${r.product_id}`; got.set(k, (got.get(k) || 0) + v.dozen); }
  for (const [k, n] of asked) {
    const [kid] = k.split(':').map(Number);
    const short = Math.max(0, n - (got.get(k) || 0));
    if (!kl.has(kid)) { const c = d.K.get(kid) || {}; kl.set(kid, { id: kid, naam: c.naam || '?', plaats: c.plaats || '', land: c.land || '', dozen: 0, per: {} }); }
    const x = kl.get(kid); x.gevraagd = (x.gevraagd || 0) + n; x.tekort = (x.tekort || 0) + short;
  }
  const klanten = [...kl.values()].map(x => ({ ...x, gevraagd: x.gevraagd || 0, tekort: x.tekort || 0 })).sort((a, b) => b.dozen - a.dozen || a.naam.localeCompare(b.naam, 'nl'));
  const inn = sum(partijen, p => p.dozen), uit = sum(partijen, p => p.uit), rest = sum(partijen, p => p.rest), uitval = sum(partijen, p => p.uitval), teVeel = sum(partijen, p => p.teVeel);
  return {
    partijen,
    week: {
      in: inn, uit, rest, uitval, teVeel, klanten, tekort: sum(klanten, k => k.tekort), kortKlanten: klanten.filter(k => k.tekort > 0).length,
      geteld: !!d.counted, basis: d.counted ? 'geteld' : partijen.some(p => p.basis === 'verzonden') ? 'verzonden' : partijen.some(p => p.basis === 'bevestigd') ? 'bevestigd' : 'besteld',
      netto: !teVeel && !rest ? 'nul' : teVeel ? 'te veel' : 'over',
    },
  };
}
