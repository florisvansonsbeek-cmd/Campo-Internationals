// Signing in to the desk: one password (DESK_PASSWORD), a signed cookie, and a brake on guessing.
import crypto from 'node:crypto';

const COOKIE = 'campo_sessie';
const DAYS = 30;
const secret = () => process.env.SESSION_SECRET || crypto.createHash('sha256').update(`${process.env.DESK_PASSWORD || ''}|${process.env.DATABASE_URL || ''}|campo-desk`).digest('hex');
const b64 = s => Buffer.from(s).toString('base64url');
const sign = payload => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

export const loginEnabled = () => !!process.env.DESK_PASSWORD;

function readCookie(req) {
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}

export function session(req) {
  const tok = readCookie(req);
  if (!tok || !tok.includes('.')) return null;
  const [p, s] = tok.split('.');
  const want = sign(p);
  if (s.length !== want.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
  try {
    const data = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

function setCookie(req, res, value, maxAge) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

const tries = new Map();
function tooMany(ip) {
  const t = tries.get(ip);
  if (!t) return false;
  if (Date.now() > t.until) { tries.delete(ip); return false; }
  return t.n >= 8;
}
function failed(ip) {
  const t = tries.get(ip) || { n: 0, until: Date.now() + 15 * 60000 };
  t.n++; tries.set(ip, t);
}

export function login(req, res) {
  if (!loginEnabled()) return res.status(503).json({ fout: 'Inloggen is nog niet ingesteld. Zet DESK_PASSWORD in Railway onder Variables.' });
  const ip = req.ip || 'onbekend';
  if (tooMany(ip)) return res.status(429).json({ fout: 'Te vaak een verkeerd wachtwoord. Probeer het over een kwartier opnieuw.' });
  const pw = String(req.body?.wachtwoord || '');
  const a = crypto.createHash('sha256').update(pw).digest(), b = crypto.createHash('sha256').update(process.env.DESK_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) { failed(ip); return res.status(401).json({ fout: 'Dat wachtwoord klopt niet.' }); }
  tries.delete(ip);
  const naam = String(req.body?.naam || 'Jan').trim().slice(0, 40) || 'Jan';
  const payload = b64(JSON.stringify({ naam, exp: Date.now() + DAYS * 864e5 }));
  setCookie(req, res, `${payload}.${sign(payload)}`, DAYS * 86400);
  res.json({ ok: true, naam });
}

export function logout(req, res) {
  setCookie(req, res, '', 0);
  res.json({ ok: true });
}

export function requireAuth(req, res, next) {
  const s = session(req);
  if (!s) return res.status(401).json({ fout: 'Log opnieuw in.' });
  req.user = s;
  // simple guard against cross-site posts: our own pages always send this header
  if (req.method !== 'GET' && req.get('x-campo') !== '1') return res.status(403).json({ fout: 'Verzoek geweigerd.' });
  next();
}
