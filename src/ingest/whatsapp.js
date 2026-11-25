// WhatsApp Business (Cloud API) webhook: invoices, photos and time updates that growers send to Jan's business number.
// Needs WHATSAPP_VERIFY_TOKEN and WHATSAPP_TOKEN (and preferably WHATSAPP_APP_SECRET) in the environment.
import crypto from 'node:crypto';
import { pool, log } from '../db.js';
import { processMessage } from './process.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
let lastIn = null, lastError = null;
export const whatsappStatus = () => ({ aan: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_VERIFY_TOKEN), laatsteBericht: lastIn, laatsteFout: lastError, beveiligd: !!process.env.WHATSAPP_APP_SECRET });

export function verify(req, res) {
  const mode = req.query['hub.mode'], token = req.query['hub.verify_token'], challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && process.env.WHATSAPP_VERIFY_TOKEN && token === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).type('text/plain').send(String(challenge || ''));
  return res.sendStatus(403);
}

async function media(id) {
  const meta = await fetch(`${GRAPH}/${id}`, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }, signal: AbortSignal.timeout(20000) });
  if (!meta.ok) throw new Error(`media ${meta.status}`);
  const j = await meta.json();
  const bin = await fetch(j.url, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }, signal: AbortSignal.timeout(60000) });
  if (!bin.ok) throw new Error(`media download ${bin.status}`);
  return { data: Buffer.from(await bin.arrayBuffer()), mime: j.mime_type || bin.headers.get('content-type') || 'application/octet-stream' };
}

export async function receive(req, res) {
  const raw = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  if (process.env.WHATSAPP_APP_SECRET) {
    const sig = String(req.get('x-hub-signature-256') || '');
    const want = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(raw).digest('hex');
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return res.sendStatus(401);
  }
  res.sendStatus(200); // answer fast; Meta retries slow webhooks
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return; }
  for (const entry of body.entry || []) for (const ch of entry.changes || []) {
    const v = ch.value || {};
    const names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile?.name]));
    for (const m of v.messages || []) {
      try {
        lastIn = new Date().toISOString();
        const from = '+' + String(m.from || '').replace(/\D/g, '');
        const text = m.type === 'text' ? m.text?.body : (m[m.type]?.caption || null);
        const ins = await pool.query(`INSERT INTO berichten_in (kanaal, extern_id, van, van_naam, tekst, ontvangen) VALUES ('whatsapp', $1, $2, $3, $4, to_timestamp($5))
          ON CONFLICT (kanaal, extern_id) DO NOTHING RETURNING id`, [m.id, from, names[m.from] || null, text, Number(m.timestamp) || Date.now() / 1000]);
        if (!ins.rows[0]) continue;
        const id = ins.rows[0].id;
        if (['document', 'image'].includes(m.type) && process.env.WHATSAPP_TOKEN) {
          const part = m[m.type];
          const f = await media(part.id);
          await pool.query('INSERT INTO bestanden (bericht_id, naam, mime, grootte, sha256, data) VALUES ($1, $2, $3, $4, $5, $6)',
            [id, part.filename || (m.type === 'image' ? 'foto.jpg' : 'document'), f.mime, f.data.length, crypto.createHash('sha256').update(f.data).digest('hex'), f.data]);
        }
        processMessage(id, { wie: 'whatsapp' }).catch(e => console.error('[whatsapp] lezen', e.message));
      } catch (e) {
        lastError = e.message;
        console.error('[whatsapp]', e.message);
        await log('whatsapp', 'Bericht kon niet worden opgeslagen', null, null, { fout: e.message });
      }
    }
  }
}
