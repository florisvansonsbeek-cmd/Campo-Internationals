// Syntax check of every server and desk file, without starting anything: npm run check
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const files = [];
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(path.join(p, f))) : p.endsWith('.js') && files.push(p));
['server.js', 'src', 'scripts', 'public/desk'].forEach(walk);

let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad++; console.error(`✗ ${f}\n${e.stderr}`); }
}
console.log(`${files.length - bad} van ${files.length} bestanden in orde`);
process.exit(bad ? 1 : 0);
