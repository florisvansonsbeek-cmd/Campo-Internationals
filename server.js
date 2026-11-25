// Campo International: the website, and the Campo desk behind a password.
import './src/tz.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, pool, one } from './src/db.js';
import { api } from './src/api.js';
import { login, logout, requireAuth, session, loginEnabled } from './src/auth.js';
import { seedDemo, keepDemoCurrent } from './src/seed.js';
import { verify as waVerify, receive as waReceive } from './src/ingest/whatsapp.js';
import { startMailPolling } from './src/ingest/mail.js';
import { aiCheck } from './src/ingest/ai.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(root, 'public');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

let dbReady = false, dbError = null;

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // nothing from the API or the health check may be kept by the browser or Railway's edge cache
  if (req.path.startsWith('/api') || req.path === '/healthz') res.set('Cache-Control', 'no-store');
  if (req.path.startsWith('/desk') || req.path.startsWith('/api')) {
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
  }
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true, database: dbReady, fout: dbError }));

// WhatsApp needs the raw body to check its signature, so it comes before the JSON parser
app.get('/api/whatsapp/webhook', waVerify);
app.post('/api/whatsapp/webhook', express.raw({ type: '*/*', limit: '2mb' }), waReceive);

app.use('/api', express.json({ limit: '40mb' }));
app.post('/api/login', login);
app.post('/api/logout', logout);
app.get('/api/status', (req, res) => res.json({ ingelogd: !!session(req), inloggen: loginEnabled(), database: dbReady }));
app.use('/api', (req, res, next) => (dbReady ? next() : res.status(503).json({ fout: dbError ? `De database is niet bereikbaar: ${dbError}` : 'De database start nog op. Probeer het zo opnieuw.' })));
app.use('/api', requireAuth, api);

// static files: images and fonts may be cached long; pages, scripts and styles are checked every time,
// so after a deploy the desk never mixes old and new modules
const longCache = (res, file) => {
  if (/\.(woff2|webp|avif|png|jpg|svg)$/.test(file)) res.set('Cache-Control', 'public, max-age=2592000');
  else res.set('Cache-Control', 'no-cache');
};
app.use('/desk', express.static(path.join(pub, 'desk'), { index: 'index.html', setHeaders: longCache }));
app.get(/^\/desk(\/.*)?$/, (req, res) => res.sendFile(path.join(pub, 'desk', 'index.html')));
app.use(express.static(pub, { index: 'index.html', setHeaders: longCache }));
app.use((req, res) => res.status(404).sendFile(path.join(pub, 'index.html')));

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`[web] Campo luistert op poort ${port}`));

async function boot() {
  if (!process.env.DATABASE_URL) { dbError = 'DATABASE_URL ontbreekt'; console.error('[db] DATABASE_URL ontbreekt; de desk blijft uit'); return; }
  for (let i = 0; i < 10; i++) {
    try { await migrate(); dbReady = true; dbError = null; break; } catch (e) { dbError = e.message; console.error('[db]', e.message); await new Promise(r => setTimeout(r, 3000 * (i + 1))); }
  }
  if (!dbReady) return;
  try {
    const n = await one('SELECT count(*)::int AS n FROM kwekers');
    if (!n.n && !/^(uit|off|nee|false|0)$/i.test(process.env.DEMO_DATA || '')) {
      const out = await seedDemo();
      console.log('[demo] aangemaakt', JSON.stringify(out));
    }
    const shifted = await keepDemoCurrent();
    if (shifted) console.log(`[demo] ${shifted} dagen opgeschoven naar vandaag`);
  } catch (e) { console.error('[demo]', e.message); }
  setInterval(() => keepDemoCurrent().then(d => d && console.log(`[demo] ${d} dagen opgeschoven`)).catch(e => console.error('[demo]', e.message)), 10 * 60000).unref();
  startMailPolling();
  if (process.env.XAI_API_KEY) aiCheck().then(r => console.log(r.ok ? `[ai] xAI bereikbaar, model ${r.model} (${r.aantal} modellen)` : `[ai] xAI niet bereikbaar: ${r.reden}`));
  else console.log('[ai] geen XAI_API_KEY: facturen worden met vaste regels gelezen');
  if (!loginEnabled()) console.warn('[desk] DESK_PASSWORD ontbreekt: inloggen staat uit');
}
boot();

const shutdown = () => { pool.end().finally(() => process.exit(0)); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
