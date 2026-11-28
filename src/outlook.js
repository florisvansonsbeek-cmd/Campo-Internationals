// Drafts in Jan's Outlook. Two ways in:
//  1. Microsoft 365 or Outlook.com: Microsoft Graph, after Jan signs in once (MS_CLIENT_ID and MS_CLIENT_SECRET in Railway).
//  2. Any other mailbox that Outlook shows (IMAP): the draft goes into the Drafts folder over IMAP (IMAP_HOST, IMAP_USER, IMAP_PASS).
// The desk only makes drafts. A mail leaves when Jan presses send: in Outlook, or with the send button in the desk.
import crypto from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { pool, one, rows, setting, setSetting, log } from './db.js';
import { conceptEml, conceptPdf } from './drafts.js';
import { mailConfig } from './ingest/mail.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'offline_access openid email User.Read Mail.ReadWrite Mail.Send';
const msConfigured = () => !!(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
const tenant = () => process.env.MS_TENANT || 'common';
const off = v => /^(uit|off|nee|false|0)$/i.test(v || '');
let lastError = null;

// the refresh token is stored encrypted with the desk's own secret
const key = () => crypto.createHash('sha256').update(String(process.env.SESSION_SECRET || `${process.env.DESK_PASSWORD || ''}|${process.env.DATABASE_URL || ''}`)).digest();
export function seal(s) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(s), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
export function unseal(s) {
  const [iv, tag, enc] = String(s).split('.').map(x => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------- signing in with Microsoft, once
export const redirectUri = req => process.env.MS_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/outlook/terug`;

export async function authStart(req, res) {
  if (!msConfigured()) return res.redirect('/desk/#/koppelingen?outlook=niet-ingesteld');
  const state = crypto.randomBytes(16).toString('hex');
  await setSetting('outlook_state', { state, at: Date.now() });
  const u = new URL(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`);
  u.search = new URLSearchParams({ client_id: process.env.MS_CLIENT_ID, response_type: 'code', redirect_uri: redirectUri(req), response_mode: 'query', scope: SCOPES, state, prompt: 'select_account' }).toString();
  res.redirect(u.toString());
}

async function tokenRequest(params) {
  const r = await fetch(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.MS_CLIENT_ID, client_secret: process.env.MS_CLIENT_SECRET, scope: SCOPES, ...params }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description ? j.error_description.split('\r\n')[0] : j.error || `Microsoft gaf ${r.status}`);
  return j;
}

let access = null;
export async function authBack(req, res) {
  try {
    const st = await setting('outlook_state');
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error).split('\r\n')[0]);
    if (!st || st.state !== req.query.state || Date.now() - st.at > 15 * 60000) throw new Error('De aanmelding duurde te lang of kwam niet van de desk. Probeer het opnieuw.');
    const tok = await tokenRequest({ grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: redirectUri(req) });
    access = { token: tok.access_token, until: Date.now() + (Number(tok.expires_in || 3600) - 120) * 1000 };
    const me = await graph('/me?$select=displayName,mail,userPrincipalName');
    await setSetting('outlook', { refresh: seal(tok.refresh_token), account: me.mail || me.userPrincipalName, naam: me.displayName, sinds: new Date().toISOString() });
    await pool.query(`DELETE FROM instellingen WHERE sleutel = 'outlook_state'`);
    await log(req.user?.naam || 'Jan', 'Outlook gekoppeld', null, null, { account: me.mail || me.userPrincipalName });
    lastError = null;
    res.redirect('/desk/#/koppelingen?outlook=ok');
  } catch (e) {
    lastError = e.message;
    res.redirect(`/desk/#/koppelingen?outlook=fout&reden=${encodeURIComponent(e.message.slice(0, 200))}`);
  }
}

export async function disconnect(wie) {
  await pool.query(`DELETE FROM instellingen WHERE sleutel IN ('outlook', 'outlook_state')`);
  access = null;
  await log(wie, 'Outlook ontkoppeld');
}

async function token() {
  if (access && access.until > Date.now()) return access.token;
  const s = await setting('outlook');
  if (!s) throw new Error('Outlook is niet gekoppeld.');
  const tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: unseal(s.refresh) });
  if (tok.refresh_token) await setSetting('outlook', { ...s, refresh: seal(tok.refresh_token) });
  access = { token: tok.access_token, until: Date.now() + (Number(tok.expires_in || 3600) - 120) * 1000 };
  return access.token;
}
async function graph(path, { method = 'GET', body } = {}) {
  const r = await fetch(GRAPH + path, {
    method, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', Prefer: 'IdType="ImmutableId"' },
  });
  if (r.status === 202 || r.status === 204) return null;
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  if (!r.ok) { const e = new Error(j?.error?.message || `Microsoft gaf ${r.status}`); e.status = r.status; throw e; }
  return j;
}

// ---------------------------------------------------------------- where drafts go
export async function target() {
  const ms = await setting('outlook');
  if (msConfigured() && ms) return { soort: 'microsoft', account: ms.account };
  const m = mailConfig();
  if (m.aan && !off(process.env.CONCEPTEN_IMAP)) return { soort: 'imap', account: m.user };
  return null;
}

export async function outlookStatus() {
  const ms = await setting('outlook');
  const m = mailConfig();
  const t = await target();
  const meld = await setting('meldingen', { mail: true });
  return {
    doel: t ? t.soort : null, account: t ? t.account : null,
    microsoft: { ingesteld: msConfigured(), gekoppeld: !!ms, account: ms?.account || null, naam: ms?.naam || null, sinds: ms?.sinds || null },
    imap: { aan: m.aan && !off(process.env.CONCEPTEN_IMAP), account: m.aan ? m.user : null },
    meldingen: meld, laatsteFout: lastError,
  };
}

async function withImap(fn) {
  const cfg = mailConfig();
  if (!cfg.aan) throw new Error(cfg.reden || 'Geen IMAP-gegevens.');
  const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass }, logger: false, socketTimeout: 60000 });
  await client.connect();
  try { return await fn(client, cfg); } finally { await client.logout().catch(() => {}); }
}
async function draftsFolder(client) {
  const boxes = await client.list();
  const box = boxes.find(b => b.specialUse === '\\Drafts') || boxes.find(b => /^(drafts|concepten|entwürfe|brouillons|bozze|borradores|utkast|kladder)$/i.test(b.name));
  if (!box) throw new Error('Er is geen map Concepten gevonden in de mailbox.');
  return box.path;
}
async function imapRemove(client, folder, conceptId) {
  const lock = await client.getMailboxLock(folder);
  try {
    const old = await client.search({ header: { 'X-Campo-Concept': String(conceptId) } }, { uid: true });
    if (old && old.length) await client.messageDelete(old, { uid: true });
  } finally { lock.release(); }
}

// ---------------------------------------------------------------- one draft in, one draft out
export async function pushConcept(id) {
  const t = await target();
  if (!t) return { ok: false, reden: 'Outlook is niet gekoppeld.' };
  const c = await one('SELECT * FROM concepten WHERE id = $1', [id]);
  if (!c || c.status === 'vervallen' || c.status === 'verstuurd') return { ok: false, reden: 'Dit concept is niet meer nodig.' };
  try {
    if (t.soort === 'microsoft') {
      if (c.extern_id && c.waar === 'microsoft') await graph(`/me/messages/${encodeURIComponent(c.extern_id)}`, { method: 'DELETE' }).catch(e => { if (e.status !== 404) throw e; });
      const pdf = await conceptPdf(c);
      const msg = await graph('/me/messages', {
        method: 'POST', body: {
          subject: c.onderwerp, body: { contentType: 'HTML', content: c.html },
          toRecipients: c.aan ? [{ emailAddress: { address: c.aan } }] : [],
          attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: c.bijlage_naam || `${c.nummer}.pdf`, contentType: 'application/pdf', contentBytes: pdf.toString('base64') }],
        },
      });
      await pool.query(`UPDATE concepten SET status = 'in_outlook', waar = 'microsoft', extern_id = $2, extern_link = $3, gezet_op = now(), bijgewerkt = now() WHERE id = $1`, [id, msg.id, msg.webLink || null]);
    } else {
      await withImap(async (client, cfg) => {
        const folder = await draftsFolder(client);
        await imapRemove(client, folder, c.id);
        const raw = await conceptEml(c, { from: /@/.test(cfg.user) ? cfg.user : null, draftHeader: false });
        await client.append(folder, raw, ['\\Draft', '\\Seen']);
        await pool.query(`UPDATE concepten SET status = 'in_outlook', waar = 'imap', extern_id = $2, extern_link = NULL, gezet_op = now(), bijgewerkt = now() WHERE id = $1`, [id, folder]);
      });
    }
    lastError = null;
    return { ok: true };
  } catch (e) {
    lastError = e.message;
    return { ok: false, reden: e.message };
  }
}

export async function removeFromOutlook(c) {
  if (!c || !c.extern_id) return;
  try {
    if (c.waar === 'microsoft' && msConfigured()) await graph(`/me/messages/${encodeURIComponent(c.extern_id)}`, { method: 'DELETE' }).catch(e => { if (e.status !== 404) throw e; });
    else if (c.waar === 'imap') await withImap(async client => imapRemove(client, c.extern_id, c.id));
  } catch (e) { lastError = e.message; }
}

// every draft of one offer that is new or changed goes in; drafts no longer needed come out
export async function pushOffer(aanbodId) {
  const t = await target();
  if (!t) return { ok: false, gezet: 0, reden: 'Outlook is niet gekoppeld.' };
  const todo = await rows(`SELECT id FROM concepten WHERE aanbod_id = $1 AND status = 'concept' AND aan IS NOT NULL ORDER BY soort, id`, [aanbodId]);
  const gone = await rows(`SELECT * FROM concepten WHERE aanbod_id = $1 AND status = 'vervallen' AND extern_id IS NOT NULL`, [aanbodId]);
  let gezet = 0; const fouten = [];
  for (const c of todo) { const r = await pushConcept(c.id); if (r.ok) gezet++; else fouten.push(r.reden); }
  for (const c of gone) { await removeFromOutlook(c); await pool.query('UPDATE concepten SET extern_id = NULL WHERE id = $1', [c.id]); }
  return { ok: !fouten.length, gezet, fouten: [...new Set(fouten)], waar: t.soort };
}

// sending from the desk: only through Microsoft, and only when Jan presses the button
export async function sendConcept(id, wie) {
  const t = await target();
  if (!t || t.soort !== 'microsoft') throw Object.assign(new Error('Versturen vanuit de desk kan met de Microsoft-koppeling. Verstuur deze mail in Outlook, of open hem met "Open in Outlook".'), { status: 400 });
  let c = await one('SELECT * FROM concepten WHERE id = $1', [id]);
  if (!c || c.status === 'vervallen') throw Object.assign(new Error('Dit concept is niet meer nodig.'), { status: 404 });
  if (c.status === 'verstuurd') return c;
  if (!c.aan) throw Object.assign(new Error('Er is geen mailadres voor deze mail.'), { status: 400 });
  if (c.status !== 'in_outlook' || c.waar !== 'microsoft') {
    const r = await pushConcept(id);
    if (!r.ok) throw Object.assign(new Error(r.reden), { status: 502 });
    c = await one('SELECT * FROM concepten WHERE id = $1', [id]);
  }
  await graph(`/me/messages/${encodeURIComponent(c.extern_id)}/send`, { method: 'POST' });
  await pool.query(`UPDATE concepten SET status = 'verstuurd', verstuurd_op = now(), bijgewerkt = now() WHERE id = $1`, [id]);
  await log(wie, c.soort === 'bestelling' ? 'Bestelling verstuurd' : c.soort === 'factuur' ? `Factuur ${c.nummer} verstuurd` : 'Offerte verstuurd', c.soort === 'factuur' ? 'pakbon' : 'aanbod', c.soort === 'factuur' ? c.pakbon_id : c.aanbod_id, { aan: c.aan, nummer: c.nummer });
  return one('SELECT * FROM concepten WHERE id = $1', [id]);
}

// drafts Jan sent from Outlook himself: noticed here, so the desk knows
export async function syncSent() {
  const t = await target();
  if (!t || t.soort !== 'microsoft') return 0;
  const list = await rows(`SELECT id, extern_id, aanbod_id, pakbon_id, soort, nummer, aan FROM concepten WHERE status = 'in_outlook' AND waar = 'microsoft' AND gezet_op > now() - interval '14 days'`);
  let n = 0;
  for (const c of list) {
    try {
      const m = await graph(`/me/messages/${encodeURIComponent(c.extern_id)}?$select=isDraft,sentDateTime`);
      if (m && m.isDraft === false) {
        await pool.query(`UPDATE concepten SET status = 'verstuurd', verstuurd_op = coalesce($2, now()), bijgewerkt = now() WHERE id = $1`, [c.id, m.sentDateTime || null]);
        await log('Outlook', c.soort === 'bestelling' ? 'Bestelling verstuurd' : c.soort === 'factuur' ? `Factuur ${c.nummer} verstuurd` : 'Offerte verstuurd', c.soort === 'factuur' ? 'pakbon' : 'aanbod', c.soort === 'factuur' ? c.pakbon_id : c.aanbod_id, { aan: c.aan, nummer: c.nummer });
        n++;
      }
    } catch (e) {
      if (e.status === 404) await pool.query(`UPDATE concepten SET status = 'concept', extern_id = NULL, extern_link = NULL, bijgewerkt = now() WHERE id = $1`, [c.id]);
      else { lastError = e.message; break; }
    }
  }
  return n;
}

// a short note to Jan himself when an order is ready: in his own inbox, nobody else gets it
export async function notifyJan({ onderwerp, html, tekst }) {
  const t = await target();
  const pref = await setting('meldingen', { mail: true });
  if (!t || !pref.mail) return { ok: false };
  try {
    if (t.soort === 'microsoft') {
      await graph('/me/sendMail', { method: 'POST', body: { message: { subject: onderwerp, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: t.account } }] }, saveToSentItems: false } });
    } else {
      const { default: MailComposer } = await import('nodemailer/lib/mail-composer/index.js');
      await withImap(async (client, cfg) => {
        const raw = await new Promise((resolve, reject) => new MailComposer({ from: { name: 'Campo desk', address: /@/.test(cfg.user) ? cfg.user : 'desk@campo.local' }, to: /@/.test(cfg.user) ? cfg.user : undefined, subject: onderwerp, text: tekst, html })
          .compile().build((e, m) => (e ? reject(e) : resolve(m))));
        await client.append('INBOX', raw, []);
      });
    }
    return { ok: true };
  } catch (e) {
    lastError = e.message;
    return { ok: false, reden: e.message };
  }
}
