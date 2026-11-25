// Local development: starts a throwaway Postgres (in the temp folder) and then the server.
// Usage: npm run dev   (needs the devDependency embedded-postgres)
import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import { existsSync } from 'node:fs';
import os from 'node:os';

const dir = process.env.DEV_DB_DIR || path.join(os.tmpdir(), 'campo-dev-db');
const port = Number(process.env.DEV_PG_PORT || 54329);
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'campo', password: 'campo', port, persistent: true, onLog: () => {}, onError: () => {} });

if (!existsSync(path.join(dir, 'PG_VERSION'))) await pg.initialise();
await pg.start();
try { await pg.createDatabase('campo'); } catch { /* exists */ }
process.env.DATABASE_URL = `postgres://campo:campo@127.0.0.1:${port}/campo`;
process.env.DESK_PASSWORD = process.env.DESK_PASSWORD || 'campo';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-dev-secret-dev-secret';
process.env.PORT = process.env.PORT || '8080';
const stop = async () => { try { await pg.stop(); } catch { /* ignore */ } process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
await import('../server.js');
