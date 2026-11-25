// What happens after an offer is read or changed: drafts refreshed, risk worked out, drafts into Outlook,
// and once, a short note to Jan that an order is ready to place.
import { pool, log } from './db.js';
import { refreshRisk } from './offers.js';
import { makeDrafts } from './drafts.js';
import { pushOffer, notifyJan, target } from './outlook.js';

const BASE = (process.env.PUBLIC_URL || 'https://campo.vsonsbeek.nl').replace(/\/$/, '');
const eur = v => `€ ${Math.round(Number(v) || 0).toLocaleString('nl-NL')}`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function afterChange(id) {
  await makeDrafts(id);
  const d = await refreshRisk(id);
  const t = await target();
  const outlook = t && d && ['nieuw', 'bellen', 'besteld'].includes(d.aanbod.status) ? await pushOffer(id) : null;
  return { d, outlook };
}

export async function afterOffer(id, { notify = true } = {}) {
  const { d, outlook } = await afterChange(id);
  if (!d || !notify) return { outlook };
  const t = await target();
  if (!t || d.aanbod.gemeld_op) return { outlook };
  const bellen = d.klanten.filter(k => k.bron !== 'order' && k.status !== 'nee');
  const al = d.klanten.filter(k => k.bron === 'order');
  const kop = d.risico.factoren.filter(f => f.toon === 'bad' || f.toon === 'wait').slice(0, 3).map(f => f.titel);
  const url = `${BASE}/desk/#/aanbod/${id}`;
  const onderwerp = `Klaar om te bestellen: ${d.aanbod.kweker}${bellen.length ? ` (${bellen.length} ${bellen.length === 1 ? 'klant' : 'klanten'} bellen)` : ''}`;
  const regels = [
    `Aanbod van ${d.aanbod.kweker}: ${d.totalen.stuks.toLocaleString('nl-NL')} stuks in ${d.regels.length} ${d.regels.length === 1 ? 'soort' : 'soorten'}; ${d.totalen.gekoppeld_pct}% heeft al een klant.`,
    al.length ? `Al besteld door: ${al.map(k => k.naam).join(', ')}.` : null,
    bellen.length ? `Bellen: ${bellen.map(k => `${k.naam}${k.telefoon || k.whatsapp ? ` (${k.telefoon || k.whatsapp})` : ''}`).join(', ')}.` : null,
    `Marge ${eur(d.totalen.marge)}${d.totalen.marge_pct != null ? ` (${String(d.totalen.marge_pct).replace('.', ',')}%)` : ''}. Risico ${d.risico.niveau}${kop.length ? `: ${kop.join(', ').toLowerCase()}` : ''}.`,
    outlook && outlook.gezet ? `De bestelling en de offertes staan in Outlook bij Concepten.` : null,
  ].filter(Boolean);
  const html = `<div style="font:14px/1.5 Arial,Helvetica,sans-serif;color:#15201a">${regels.map(r => `<p style="margin:0 0 10px">${esc(r)}</p>`).join('')}<p><a href="${url}" style="color:#1f5138;font-weight:bold">Open in de Campo desk</a></p></div>`;
  const r = await notifyJan({ onderwerp, html, tekst: `${regels.join('\n')}\n\n${url}` });
  if (r.ok) {
    await pool.query('UPDATE aanbiedingen SET gemeld_op = now() WHERE id = $1', [id]);
    await log('desk', 'Jan gemeld: bestelling klaar', 'aanbod', id, { via: t.soort });
  }
  return { outlook, gemeld: r.ok };
}
