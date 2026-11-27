// Postgres connection and migrations. All tables live in the schema "campo".
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// numeric comes back as a string by default; the desk wants numbers
pg.types.setTypeParser(1700, v => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, v => (v === null ? null : Number(v)));
// plain dates stay 'YYYY-MM-DD' strings, so they never shift a day across time zones
pg.types.setTypeParser(1082, v => v);

export const TZ = process.env.CAMPO_TZ || 'Europe/Amsterdam';

function sslFor(url) {
  if (!url) return undefined;
  if (/sslmode=disable/.test(url) || /localhost|127\.0\.0\.1|\.railway\.internal/.test(url)) return undefined;
  return { rejectUnauthorized: false };
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslFor(process.env.DATABASE_URL),
  max: 8,
  idleTimeoutMillis: 30000,
  // every connection starts in the campo schema and in Dutch time, without an extra query racing the first one
  options: `-c search_path=campo,public -c TimeZone=${TZ}`,
});
pool.on('error', e => console.error('[db] idle client error', e.message));

export const q = (text, params) => pool.query(text, params);
export const rows = async (text, params) => (await pool.query(text, params)).rows;
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;

export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const MIGRATIONS = [
  { v: 1, file: 'schema.sql' },
  { v: 2, file: 'schema-2-aanbod.sql' },
  { v: 3, file: 'schema-3-week.sql' },
  { v: 4, file: 'schema-4-relaties.sql' },
];

export async function migrate() {
  const c = await pool.connect();
  try {
    await c.query('CREATE SCHEMA IF NOT EXISTS campo');
    await c.query('CREATE TABLE IF NOT EXISTS campo.migraties (versie int PRIMARY KEY, op timestamptz NOT NULL DEFAULT now())');
    // one server at a time
    await c.query('SELECT pg_advisory_lock(424242)');
    const done = new Set((await c.query('SELECT versie FROM campo.migraties')).rows.map(r => r.versie));
    for (const m of MIGRATIONS) {
      if (done.has(m.v)) continue;
      const sql = await readFile(path.join(here, m.file), 'utf8');
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO campo.migraties (versie) VALUES ($1)', [m.v]);
        await c.query('COMMIT');
        console.log(`[db] migratie ${m.v} toegepast`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
    await c.query('SELECT pg_advisory_unlock(424242)');
  } finally {
    c.release();
  }
}

export async function setting(key, fallback = null) {
  const r = await one('SELECT waarde FROM instellingen WHERE sleutel = $1', [key]);
  return r ? r.waarde : fallback;
}
export async function setSetting(key, value) {
  await q(`INSERT INTO instellingen (sleutel, waarde, bijgewerkt) VALUES ($1, $2, now())
           ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, bijgewerkt = now()`, [key, JSON.stringify(value)]);
}
export async function log(wie, actie, object = null, objectId = null, details = null) {
  try {
    await q('INSERT INTO logboek (wie, actie, object, object_id, details) VALUES ($1,$2,$3,$4,$5)', [wie, actie, object, objectId, details ? JSON.stringify(details) : null]);
  } catch (e) { console.error('[log]', e.message); }
}
