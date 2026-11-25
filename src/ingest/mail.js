// Reading Jan's invoice mailbox over IMAP. Only reads: nothing is moved, deleted or marked as read.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import crypto from 'node:crypto';
import { pool, setting, setSetting, log } from '../db.js';
import { processMessage } from './process.js';

const SMTP_PORTS = new Set([25, 465, 587, 2525]);
const LOOKS_RELEVANT = /(factuur|invoice|rechnung|faktura|pakbon|lieferschein|delivery note|bevestiging|levering|eta|vertrek|aankomst|credit)/i;

export function mailConfig() {
  if (/^(uit|off|nee|false|0)$/i.test(process.env.MAIL_LEZEN || '')) return { aan: false, reden: 'Uitgezet met MAIL_LEZEN' };
  let host = process.env.IMAP_HOST || process.env.EMAIL_HOST;
  let port = Number(process.env.IMAP_PORT || process.env.EMAIL_PORT || 993);
  const user = process.env.IMAP_USER || process.env.EMAIL_USER;
  const pass = process.env.IMAP_PASS || process.env.EMAIL_PASS;
  if (!host || !user || !pass) return { aan: false, reden: 'Geen mailgegevens ingesteld (IMAP_HOST, IMAP_USER, IMAP_PASS)' };
  // the EMAIL_* variables may describe the outgoing (SMTP) server; IMAP usually sits next to it
  if (!process.env.IMAP_HOST && /^smtp\./i.test(host)) host = host.replace(/^smtp\./i, 'imap.');
  if (!process.env.IMAP_PORT && SMTP_PORTS.has(port)) port = 993;
  return { aan: true, host, port, user, pass, secure: port === 993 };
}

let running = false, lastRun = null, lastError = null, lastCount = 0;
export const mailStatus = () => { const c = mailConfig(); return { aan: c.aan, reden: c.reden || null, host: c.host || null, user: c.user || null, laatsteKeer: lastRun, laatsteFout: lastError, laatsteAantal: lastCount }; };

export async function pollMail() {
  const cfg = mailConfig();
  if (!cfg.aan || running) return { ok: false, reden: cfg.reden || 'Loopt al' };
  running = true; lastRun = new Date().toISOString();
  const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass }, logger: false, socketTimeout: 60000 });
  let stored = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const state = (await setting('imap', null)) || {};
      const box = client.mailbox;
      let uids;
      if (state.uidValidity && String(state.uidValidity) === String(box.uidValidity) && state.lastUid) {
        uids = await client.search({ uid: `${state.lastUid + 1}:*` }, { uid: true });
        uids = (uids || []).filter(u => u > state.lastUid);
      } else {
        // first time: only the last three days, not the whole mailbox
        const since = new Date(Date.now() - 3 * 864e5);
        uids = (await client.search({ since }, { uid: true })) || [];
      }
      uids = uids.slice(-40);
      let maxUid = state.lastUid || 0;
      for (const uid of uids) {
        maxUid = Math.max(maxUid, uid);
        const msg = await client.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
        if (!msg || !msg.source) continue;
        if (msg.source.length > 30 * 1024 * 1024) continue;
        const m = await simpleParser(msg.source);
        const atts = (m.attachments || []).filter(a => /pdf|^image\/(png|jpe?g|webp)/i.test(a.contentType || '') && a.size <= 20 * 1024 * 1024);
        const text = (m.text || '').slice(0, 20000);
        if (!atts.length && !LOOKS_RELEVANT.test(`${m.subject || ''} ${text.slice(0, 2000)}`)) continue;
        const from = m.from?.value?.[0] || {};
        const ext = m.messageId || `uid-${box.uidValidity}-${uid}`;
        const ins = await pool.query(`INSERT INTO berichten_in (kanaal, extern_id, van, van_naam, onderwerp, tekst, ontvangen) VALUES ('mail', $1, $2, $3, $4, $5, $6)
          ON CONFLICT (kanaal, extern_id) DO NOTHING RETURNING id`, [ext, (from.address || '').toLowerCase() || null, from.name || null, m.subject || null, text, m.date || msg.internalDate || new Date()]);
        if (!ins.rows[0]) continue;
        const id = ins.rows[0].id;
        for (const a of atts) {
          await pool.query('INSERT INTO bestanden (bericht_id, naam, mime, grootte, sha256, data) VALUES ($1, $2, $3, $4, $5, $6)',
            [id, a.filename || 'bijlage', a.contentType, a.size, crypto.createHash('sha256').update(a.content).digest('hex'), a.content]);
        }
        stored++;
        processMessage(id, { wie: 'mail' }).catch(e => console.error('[mail] lezen', e.message));
      }
      await setSetting('imap', { uidValidity: String(box.uidValidity), lastUid: maxUid, at: new Date().toISOString() });
    } finally {
      lock.release();
    }
    await client.logout();
    lastError = null; lastCount = stored;
    if (stored) await log('mail', `${stored} ${stored === 1 ? 'mail' : 'mails'} binnengehaald`);
    return { ok: true, nieuw: stored };
  } catch (e) {
    lastError = e.message;
    console.error('[mail]', e.message);
    try { await client.logout(); } catch { /* ignore */ }
    return { ok: false, reden: e.message };
  } finally {
    running = false;
  }
}

export function startMailPolling() {
  const cfg = mailConfig();
  if (!cfg.aan) { console.log(`[mail] niet actief: ${cfg.reden}`); return; }
  console.log(`[mail] lezen van ${cfg.user} via ${cfg.host}:${cfg.port}`);
  const every = Math.max(1, Number(process.env.MAIL_MINUTEN || 3)) * 60000;
  setTimeout(() => pollMail(), 15000);
  setInterval(() => pollMail(), every).unref();
}
