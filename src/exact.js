// Exact Online, the way the desk works with it. After Jan's approval the desk puts the invoices into Exact (one sales
// entry per invoice, every line with the batch number as cost unit) and the purchase orders (one purchase entry per
// shipment, in dollars). The Controle tab then only reads what Exact holds and checks it against the desk, line by line.
// Where the check reads from:
//   api     Exact Online itself, after Jan signed in once (EXACT_CLIENT_ID and EXACT_CLIENT_SECRET in Railway)
//   import  an export Jan downloaded from Exact and dropped on the Controle tab (also the desk's own Excel for Exact)
//   demo    while the desk runs on demo data and Exact is not connected: an imitated Exact inside the database
// Nothing goes into Exact without Jan's click, and reading never changes anything in Exact.
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { pool, one, rows, q, setting, setSetting, log } from './db.js';
import { seal, unseal } from './outlook.js';
import { slipDoc } from './week/mail.js';
import { r2, sum, isoWeek, today, vatFor } from './week/util.js';

const BASE = () => String(process.env.EXACT_BASE || 'https://start.exactonline.nl').replace(/\/+$/, '');
const configured = () => !!(process.env.EXACT_CLIENT_ID && process.env.EXACT_CLIENT_SECRET);
export const exactRedirect = req => process.env.EXACT_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/exact/terug`;
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
let lastError = null;

// ---------------------------------------------------------------- how Campo's administration is set up in Exact
// journals, revenue accounts per kind of customer and VAT codes differ per administration: Jan (or his bookkeeper) fills them in
export const EXACT_DEFAULTS = {
  dagboek_verkoop: '70', dagboek_inkoop: '60',
  gb_omzet_nl: '8000', gb_omzet_eu: '8100', gb_omzet_export: '8200', gb_inkoop: '7000',
  btw_nl: '', btw_eu: '', btw_export: '', btw_inkoop: '',
};
export async function exactSettings() { return { ...EXACT_DEFAULTS, ...(await setting('exact_instellingen', {})) }; }
export async function saveExactSettings(v = {}) {
  const cur = await exactSettings(), out = { ...cur };
  for (const k of Object.keys(EXACT_DEFAULTS)) if (v[k] !== undefined) {
    const s = String(v[k] ?? '').trim();
    if (s.length > 20 || /[^\w .-]/.test(s)) throw fail(`${k}: alleen een code van letters en cijfers, zoals 8000.`);
    out[k] = s;
  }
  await setSetting('exact_instellingen', out);
  return out;
}

async function demoActive() {
  const d = await setting('demo', null), s = await setting('exact', null);
  return !!(d && d.wereld === 'week') && !(s && s.refresh);
}
export async function exactStatus() {
  const s = await setting('exact', null), st = await exactSettings();
  const missing = ['btw_nl', 'btw_eu', 'btw_export', 'btw_inkoop'].filter(k => !st[k]);
  const imp = await one('SELECT id, naam, rijen, op, door FROM exact_imports ORDER BY op DESC LIMIT 1');
  return {
    ingesteld: configured(), gekoppeld: !!(s && s.refresh), divisie: s?.divisie || null, administratie: s?.administratie || null, gebruiker: s?.gebruiker || null, op: s?.op || null,
    demo: await demoActive(), fout: lastError, instellingen: st, ontbreekt: missing, import: imp,
  };
}
// can the desk put something into Exact right now: connected (with the VAT codes filled in), or the demo
export async function exactCan() {
  const s = await exactStatus();
  if (s.gekoppeld) return { kan: !s.ontbreekt.length, bron: 'api', waarom: s.ontbreekt.length ? 'Vul bij Koppelingen → Exact eerst de btw-codes in.' : null };
  if (s.demo) return { kan: true, bron: 'demo', waarom: null };
  return { kan: false, bron: null, waarom: 'Exact is nog niet gekoppeld (Koppelingen → Exact).' };
}

// ---------------------------------------------------------------- signing in with Exact, once
export async function exactStart(req, res) {
  if (!configured()) return res.redirect('/desk/#/koppelingen?exact=niet-ingesteld');
  const state = crypto.randomBytes(16).toString('hex');
  await setSetting('exact_state', { state, at: Date.now() });
  const u = new URL(`${BASE()}/api/oauth2/auth`);
  u.search = new URLSearchParams({ client_id: process.env.EXACT_CLIENT_ID, redirect_uri: exactRedirect(req), response_type: 'code', force_login: '0', state }).toString();
  res.redirect(u.toString());
}
async function tokenRequest(params) {
  const r = await fetch(`${BASE()}/api/oauth2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: process.env.EXACT_CLIENT_ID, client_secret: process.env.EXACT_CLIENT_SECRET, ...params }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || `Exact gaf ${r.status}`);
  return j;
}
let access = null, refreshing = null;
export async function exactBack(req, res) {
  try {
    const st = await setting('exact_state');
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    if (!st || st.state !== req.query.state || Date.now() - st.at > 15 * 60000) throw new Error('De aanmelding duurde te lang of kwam niet van de desk. Probeer het opnieuw.');
    const t = await tokenRequest({ grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: exactRedirect(req) });
    access = { token: t.access_token, until: Date.now() + (Number(t.expires_in) || 600) * 1000 - 30000 };
    await setSetting('exact', { refresh: seal(t.refresh_token), op: new Date().toISOString() });
    const me = await call('GET', 'current/Me?$select=CurrentDivision,FullName,Email,DivisionCustomerName');
    const m = Array.isArray(me?.results) ? me.results[0] : me;
    const cur = await setting('exact', {});
    await setSetting('exact', { ...cur, divisie: m?.CurrentDivision ?? null, gebruiker: m?.FullName || m?.Email || null, administratie: m?.DivisionCustomerName || null });
    await pool.query(`DELETE FROM instellingen WHERE sleutel = 'exact_state'`);
    lastError = null;
    await log((req.user && req.user.naam) || 'Jan', 'Exact gekoppeld', null, null, { divisie: m?.CurrentDivision ?? null });
    res.redirect('/desk/#/koppelingen?exact=gekoppeld');
  } catch (e) {
    lastError = e.message;
    res.redirect(`/desk/#/koppelingen?exact=fout&melding=${encodeURIComponent(e.message)}`);
  }
}
export async function exactDisconnect() {
  access = null;
  await pool.query(`DELETE FROM instellingen WHERE sleutel IN ('exact', 'exact_state')`);
  await pool.query(`DELETE FROM exact_boekingen WHERE bron = 'api'`);
}

async function accessToken() {
  if (access && access.until > Date.now()) return access.token;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const s = await setting('exact', null);
    if (!s?.refresh) throw fail('Exact is niet gekoppeld.');
    // Exact gives a new refresh token every time: store it before anything else
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: unseal(s.refresh) });
    await setSetting('exact', { ...s, refresh: seal(t.refresh_token || unseal(s.refresh)) });
    access = { token: t.access_token, until: Date.now() + (Number(t.expires_in) || 600) * 1000 - 30000 };
    return access.token;
  })().finally(() => { refreshing = null; });
  return refreshing;
}
const exactMsg = (j, status) => j?.error?.message?.value || (typeof j?.error?.message === 'string' ? j.error.message : '') || (typeof j === 'string' && j.length < 300 ? j : '') || `Exact gaf ${status}`;
async function call(method, path, body) {
  const tok = await accessToken();
  const s = await setting('exact', {});
  const url = /^https?:/.test(path) ? path : `${BASE()}/api/v1/${path.startsWith('current/') ? '' : `${s.divisie}/`}${path}`;
  const r = await fetch(url, {
    method, headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  const txt = await r.text();
  let j = null;
  try { j = txt ? JSON.parse(txt) : null; } catch { j = txt; }
  if (r.status === 401) access = null;
  if (!r.ok) { lastError = exactMsg(j, r.status); throw fail(`Exact: ${lastError}`, 502); }
  return j && typeof j === 'object' && 'd' in j ? j.d : j;
}
async function list(path, max = 40) {
  let out = [], next = path, n = 0;
  while (next && n++ < max) {
    const d = await call('GET', next);
    out = out.concat(Array.isArray(d) ? d : d?.results || []);
    next = d?.__next || null;
  }
  return out;
}
const odata = v => `'${String(v).replace(/'/g, "''")}'`;
function lookups() {
  const cache = new Map();
  const get = async (key, fn) => { if (!cache.has(key)) cache.set(key, await fn()); return cache.get(key); };
  return {
    account: code => get(`a:${code}`, async () => (await list(`crm/Accounts?$filter=trim(Code) eq ${odata(code)}&$select=ID,Code,Name`, 1))[0] || null),
    gl: code => get(`g:${code}`, async () => (await list(`financial/GLAccounts?$filter=trim(Code) eq ${odata(code)}&$select=ID,Code,Description`, 1))[0] || null),
    // the batch number is the cost unit: made in Exact the first time it is used
    costUnit: (code, desc) => get(`c:${code}`, async () => (await list(`hrm/Costunits?$filter=trim(Code) eq ${odata(code)}&$select=ID,Code`, 1))[0] || call('POST', 'hrm/Costunits', { Code: code, Description: desc })),
    accountById: id => get(`i:${id}`, async () => (await list(`crm/Accounts?$filter=ID eq guid${odata(id)}&$select=ID,Code,Name`, 1))[0] || null),
  };
}

// ---------------------------------------------------------------- what the desk says should be in Exact
const ymd = v => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const norm = v => String(v ?? '').trim().toUpperCase();
async function purchaseLines(ids) {
  const r = await rows(`SELECT r.partij_id, r.id, coalesce(r.verzonden, r.bevestigd, r.besteld, 0) * r.per_doos AS stuks, r.prijs_usd, d.naam, d.maat, d.soort
    FROM partij_regels r JOIN producten d ON d.id = r.product_id WHERE r.partij_id = ANY($1) ORDER BY d.naam, d.maat`, [ids]);
  return r.map(x => ({ ...x, bedrag: r2(x.stuks * Number(x.prijs_usd)) })).filter(x => x.stuks > 0);
}
export async function deskBookings({ van = '2000-01-01', tot = '2100-01-01' } = {}) {
  const slips = await rows(`SELECT s.id, s.nummer, s.datum, s.maandag, s.totaal, s.btw_pct, s.exact, s.exact_nummer, s.exact_id, k.id AS klant_id, k.naam AS klant, k.exact_code
    FROM pakbonnen s JOIN klanten k ON k.id = s.klant_id WHERE s.status = 'akkoord' AND s.datum BETWEEN $1 AND $2 ORDER BY s.datum, s.nummer`, [van, tot]);
  const sl = slips.length ? await rows(`SELECT pakbon_id, partij, sum(bedrag) AS bedrag, sum(stuks) AS stuks FROM pakbon_regels WHERE pakbon_id = ANY($1) GROUP BY pakbon_id, partij`, [slips.map(s => s.id)]) : [];
  const verkoop = slips.map(s => {
    const kd = Object.fromEntries(sl.filter(l => l.pakbon_id === s.id).map(l => [l.partij, r2(l.bedrag)]));
    return { soort: 'verkoop', id: s.id, ref: s.nummer, key: norm(s.nummer), datum: ymd(s.datum), maandag: ymd(s.maandag), week: isoWeek(s.maandag).week, relatie_code: s.exact_code || null, relatie: s.klant, klant_id: s.klant_id,
      valuta: 'EUR', bedrag: r2(s.totaal), btw: r2(Number(s.totaal) * Number(s.btw_pct) / 100), exact: s.exact, exact_nummer: s.exact_nummer, kostendragers: kd };
  });
  const ps = await rows(`SELECT p.id, p.nummer, p.maandag, p.verzonden_op, p.exact, p.exact_nummer, l.id AS leverancier_id, l.naam AS leverancier, l.exact_code
    FROM partijen p JOIN leveranciers l ON l.id = p.leverancier_id WHERE p.verzonden_op IS NOT NULL AND p.verzonden_op <= now() AND p.maandag BETWEEN $1 AND $2 ORDER BY p.maandag, p.nummer, l.naam`, [van, tot]);
  const pl = ps.length ? await purchaseLines(ps.map(p => p.id)) : [];
  const inkoop = ps.map(p => {
    const b = r2(sum(pl.filter(l => l.partij_id === p.id), l => l.bedrag));
    return { soort: 'inkoop', id: p.id, ref: p.nummer, key: `${p.nummer}|${norm(p.exact_code || p.leverancier)}`, datum: ymd(p.verzonden_op), maandag: ymd(p.maandag), week: isoWeek(p.maandag).week,
      relatie_code: p.exact_code || null, relatie: p.leverancier, leverancier_id: p.leverancier_id, valuta: 'USD', bedrag: b, btw: 0, exact: p.exact, exact_nummer: p.exact_nummer, kostendragers: { [p.nummer]: b } };
  });
  return { verkoop, inkoop };
}

// ---------------------------------------------------------------- putting it into Exact (after Jan's click)
async function nextDemoNumber(soort) {
  const r = await one(`SELECT count(*)::int AS n FROM exact_boekingen WHERE bron = 'demo' AND soort = $1`, [soort]);
  return `${soort === 'verkoop' ? '70' : '60'}${String(26000 + r.n + 1)}`;
}
async function pushSlipApi(id, st, L) {
  const d = await slipDoc(id);
  const soort = d.btw_soort;
  const glCode = soort === 'nl' ? st.gb_omzet_nl : soort === 'verlegd' ? st.gb_omzet_eu : st.gb_omzet_export;
  const vat = soort === 'nl' ? st.btw_nl : soort === 'verlegd' ? st.btw_eu : st.btw_export;
  if (!d.klant.exact_code) throw fail(`${d.klant.naam} heeft geen debiteurnummer. Vul het in bij de klant.`);
  if (!vat) throw fail('Vul bij Koppelingen → Exact eerst de btw-codes in.');
  const acc = await L.account(d.klant.exact_code);
  if (!acc) throw fail(`Debiteur ${d.klant.exact_code} (${d.klant.naam}) staat niet in Exact.`);
  const gl = await L.gl(glCode);
  if (!gl) throw fail(`Grootboekrekening ${glCode} staat niet in Exact.`);
  for (const b of new Set(d.regels.map(r => r.partij))) await L.costUnit(b, `Batch ${b}`);
  const e = await call('POST', 'salesentry/SalesEntries', {
    Journal: st.dagboek_verkoop, Customer: acc.ID, EntryDate: `${ymd(d.datum)}T00:00:00`, YourRef: d.nummer, Description: `Factuur ${d.nummer} week ${d.week}`.slice(0, 60), Currency: 'EUR',
    SalesEntryLines: d.regels.map(r => ({ GLAccount: gl.ID, AmountFC: r.bedrag, VATCode: vat, CostUnit: r.partij, Quantity: r.stuks, Description: `${r.omschrijving} batch ${r.partij}`.slice(0, 60) })),
  });
  return { exact_id: e?.EntryID || null, exact_nummer: e?.EntryNumber != null ? String(e.EntryNumber) : null };
}
async function pushPurchaseApi(id, st, L) {
  const p = await one(`SELECT p.*, l.naam AS leverancier, l.exact_code AS lev_code FROM partijen p JOIN leveranciers l ON l.id = p.leverancier_id WHERE p.id = $1`, [id]);
  const lines = await purchaseLines([id]);
  if (!p.lev_code) throw fail(`${p.leverancier} heeft geen crediteurnummer. Vul het in bij de leverancier.`);
  if (!st.btw_inkoop) throw fail('Vul bij Koppelingen → Exact eerst de btw-code voor inkoop in.');
  const acc = await L.account(p.lev_code);
  if (!acc) throw fail(`Crediteur ${p.lev_code} (${p.leverancier}) staat niet in Exact.`);
  const gl = await L.gl(st.gb_inkoop);
  if (!gl) throw fail(`Grootboekrekening ${st.gb_inkoop} staat niet in Exact.`);
  await L.costUnit(p.nummer, `Batch ${p.nummer}`);
  const e = await call('POST', 'purchaseentry/PurchaseEntries', {
    Journal: st.dagboek_inkoop, Supplier: acc.ID, EntryDate: `${ymd(p.verzonden_op || p.maandag)}T00:00:00`, YourRef: `Batch ${p.nummer}`, Description: `Inkoop ${p.leverancier} batch ${p.nummer}`.slice(0, 60), Currency: 'USD',
    PurchaseEntryLines: lines.map(l => ({ GLAccount: gl.ID, AmountFC: l.bedrag, VATCode: st.btw_inkoop, CostUnit: p.nummer, Quantity: l.stuks, Description: `${l.naam} ${l.maat} batch ${p.nummer}`.slice(0, 60) })),
  });
  return { exact_id: e?.EntryID || null, exact_nummer: e?.EntryNumber != null ? String(e.EntryNumber) : null };
}
// in the demo the desk writes into the imitated Exact exactly what it would send
async function pushDemo(x) {
  const nummer = await nextDemoNumber(x.soort);
  const ref = x.soort === 'verkoop' ? x.ref : x.ref;
  await q(`INSERT INTO exact_boekingen (bron, soort, referentie, entry_nummer, datum, relatie_code, relatie, valuta, bedrag, btw, regels) VALUES ('demo', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [x.soort, ref, nummer, x.datum, x.relatie_code, x.relatie, x.valuta, x.bedrag, x.btw, JSON.stringify(Object.entries(x.kostendragers).map(([k, v]) => ({ kostendrager: k, bedrag: v })))]);
  return { exact_id: `demo-${nummer}`, exact_nummer: nummer };
}

// put approved invoices and shipped purchase orders into Exact. ids: { pakbonnen: [..], partijen: [..] }
export async function exactPush({ pakbonnen = [], partijen = [] } = {}, wie = 'Jan') {
  const can = await exactCan();
  if (!can.kan) throw fail(can.waarom);
  const st = await exactSettings(), L = can.bron === 'api' ? lookups() : null;
  // the imitated Exact first gets what the desk already marked, so the check stays whole
  if (can.bron === 'demo') await ensureDemoMirror();
  const desk = await deskBookings();
  const out = { gezet: 0, fouten: [], bron: can.bron, nummers: [] };
  for (const id of pakbonnen) {
    const x = desk.verkoop.find(v => v.id === id);
    try {
      if (!x) throw fail('Deze pakbon is (nog) niet akkoord.');
      if (x.exact === 'in_exact') continue;
      const r = can.bron === 'api' ? await pushSlipApi(id, st, L) : await pushDemo(x);
      await q(`UPDATE pakbonnen SET exact = 'in_exact', exact_nummer = $2, exact_id = $3, exact_op = now(), exact_door = $4 WHERE id = $1`, [id, r.exact_nummer, r.exact_id, wie]);
      out.gezet++; out.nummers.push(x.ref);
    } catch (e) { out.fouten.push({ ref: x?.ref || `pakbon ${id}`, fout: e.message }); if (e.status === 502 && /429|limit/i.test(e.message)) break; }
  }
  for (const id of partijen) {
    const x = desk.inkoop.find(v => v.id === id);
    try {
      if (!x) throw fail('Deze zending heeft nog geen verzendbewijs.');
      if (x.exact === 'in_exact') continue;
      const r = can.bron === 'api' ? await pushPurchaseApi(id, st, L) : await pushDemo(x);
      await q(`UPDATE partijen SET exact = 'in_exact', exact_nummer = $2, exact_id = $3, exact_op = now(), exact_door = $4 WHERE id = $1`, [id, r.exact_nummer, r.exact_id, wie]);
      out.gezet++; out.nummers.push(`${x.ref} ${x.relatie}`);
    } catch (e) { out.fouten.push({ ref: x ? `${x.ref} ${x.relatie}` : `zending ${id}`, fout: e.message }); }
  }
  if (out.gezet) await log(wie, `${out.gezet} in Exact gezet${can.bron === 'demo' ? ' (demo-Exact)' : ''}`, 'exact', null, { nummers: out.nummers.slice(0, 40), fouten: out.fouten.length });
  return out;
}

// ---------------------------------------------------------------- reading back what Exact holds
async function readBackApi({ van, tot }) {
  const st = await exactSettings(), L = lookups();
  const sel = 'EntryID,EntryNumber,EntryDate,YourRef,Customer,CustomerName,Currency,VATAmountFC,Journal';
  const sales = await list(`salesentry/SalesEntries?$filter=EntryDate ge datetime${odata(van)} and EntryDate le datetime${odata(tot)}&$expand=SalesEntryLines&$select=${sel},SalesEntryLines`);
  const buys = await list(`purchaseentry/PurchaseEntries?$filter=EntryDate ge datetime${odata(van)} and EntryDate le datetime${odata(tot)}&$expand=PurchaseEntryLines&$select=EntryID,EntryNumber,EntryDate,YourRef,Supplier,SupplierName,Currency,VATAmountFC,Journal,PurchaseEntryLines`);
  const out = [];
  const lines = e => e.SalesEntryLines?.results || e.SalesEntryLines || e.PurchaseEntryLines?.results || e.PurchaseEntryLines || [];
  const date = v => { const m = String(v || '').match(/\/Date\((\d+)/); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : ymd(v); };
  // the VAT only when Exact says it; without it the check leaves the VAT alone
  const vatOf = (e, ls) => (e.VATAmountFC != null ? r2(e.VATAmountFC) : ls.some(l => l.VATAmountFC != null) ? r2(sum(ls, l => l.VATAmountFC)) : null);
  for (const e of sales) {
    if (st.dagboek_verkoop && e.Journal && String(e.Journal).trim() !== st.dagboek_verkoop) continue;
    const acc = e.Customer ? await L.accountById(e.Customer) : null, ls = lines(e);
    out.push({ soort: 'verkoop', referentie: String(e.YourRef || '').trim(), entry_nummer: e.EntryNumber != null ? String(e.EntryNumber) : null, datum: date(e.EntryDate), relatie_code: acc ? String(acc.Code).trim() : null,
      relatie: e.CustomerName || acc?.Name || null, valuta: e.Currency || 'EUR', bedrag: r2(sum(ls, l => l.AmountFC)), btw: vatOf(e, ls),
      regels: ls.map(l => ({ kostendrager: l.CostUnit ? String(l.CostUnit).trim() : null, bedrag: r2(l.AmountFC), aantal: l.Quantity ?? null, omschrijving: l.Description || null, grootboek: l.GLAccountCode || null, btw_code: l.VATCode || null })) });
  }
  for (const e of buys) {
    if (st.dagboek_inkoop && e.Journal && String(e.Journal).trim() !== st.dagboek_inkoop) continue;
    const acc = e.Supplier ? await L.accountById(e.Supplier) : null, ls = lines(e);
    const batch = String(e.YourRef || '').match(/(\d{6})/)?.[1] || ls.map(l => l.CostUnit).find(Boolean) || String(e.YourRef || '').trim();
    out.push({ soort: 'inkoop', referentie: String(batch).trim(), entry_nummer: e.EntryNumber != null ? String(e.EntryNumber) : null, datum: date(e.EntryDate), relatie_code: acc ? String(acc.Code).trim() : null,
      relatie: e.SupplierName || acc?.Name || null, valuta: e.Currency || 'USD', bedrag: r2(sum(ls, l => l.AmountFC)), btw: vatOf(e, ls),
      regels: ls.map(l => ({ kostendrager: l.CostUnit ? String(l.CostUnit).trim() : null, bedrag: r2(l.AmountFC), aantal: l.Quantity ?? null, omschrijving: l.Description || null, grootboek: l.GLAccountCode || null, btw_code: l.VATCode || null })) });
  }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`DELETE FROM exact_boekingen WHERE bron = 'api'`);
    for (const b of out) await c.query(`INSERT INTO exact_boekingen (bron, soort, referentie, entry_nummer, datum, relatie_code, relatie, valuta, bedrag, btw, regels) VALUES ('api', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [b.soort, b.referentie, b.entry_nummer, b.datum, b.relatie_code, b.relatie, b.valuta, b.bedrag, b.btw, JSON.stringify(b.regels)]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await setSetting('exact_gelezen', { op: new Date().toISOString(), van, tot, boekingen: out.length });
  return out.length;
}

// the imitated Exact of the demo: what the desk marked as in Exact, with three mistakes on purpose so the check has
// something to show (an amount typed wrong, two digits of a batch number swapped, one invoice that never arrived)
export async function ensureDemoMirror() {
  const n = await one(`SELECT count(*)::int AS n FROM exact_boekingen WHERE bron = 'demo'`);
  if (n.n) return;
  const desk = await deskBookings();
  const done = [...desk.verkoop, ...desk.inkoop].filter(x => x.exact === 'in_exact');
  if (!done.length) return;
  const weeks = [...new Set(desk.verkoop.filter(x => x.exact === 'in_exact').map(x => x.maandag))].sort().reverse();
  const pick = (w, i = 0) => desk.verkoop.filter(x => x.exact === 'in_exact' && x.maandag === weeks[w])[i];
  const wrong = pick(1, 0), swapped = pick(2, 1) || pick(2, 0), gone = pick(3, 2) || pick(3, 0);
  const buyWeeks = [...new Set(desk.inkoop.filter(x => x.exact === 'in_exact').map(x => x.maandag))].sort().reverse();
  const buyWrong = desk.inkoop.find(x => x.exact === 'in_exact' && x.maandag === buyWeeks[1]);
  const notes = [];
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let nr = { verkoop: 0, inkoop: 0 };
    for (const x of done) {
      if (x === gone) { notes.push({ ref: x.ref, wat: 'staat in de desk als "in Exact", maar is daar nooit aangekomen' }); continue; }
      let bedrag = x.bedrag;
      let regels = Object.entries(x.kostendragers).map(([k, v]) => ({ kostendrager: k, bedrag: v }));
      if (x === wrong) { bedrag = r2(bedrag + 12.4); regels = regels.map((r, i) => (i === 0 ? { ...r, bedrag: r2(r.bedrag + 12.4) } : r)); notes.push({ ref: x.ref, wat: 'bedrag met de hand anders ingetikt (+ € 12,40)' }); }
      if (x === swapped) { regels = regels.map((r, i) => (i === 0 ? { ...r, kostendrager: `${r.kostendrager.slice(0, 4)}${r.kostendrager[5]}${r.kostendrager[4]}` } : r)); notes.push({ ref: x.ref, wat: 'kostendrager met twee cijfers omgedraaid' }); }
      if (x === buyWrong) { bedrag = r2(bedrag - 25); regels = regels.map(r => ({ ...r, bedrag: r2(r.bedrag - 25) })); notes.push({ ref: `${x.ref} ${x.relatie}`, wat: 'inkooporder $ 25 lager geboekt' }); }
      nr[x.soort]++;
      await c.query(`INSERT INTO exact_boekingen (bron, soort, referentie, entry_nummer, datum, relatie_code, relatie, valuta, bedrag, btw, regels) VALUES ('demo', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [x.soort, x.ref, `${x.soort === 'verkoop' ? '70' : '60'}${String(25000 + nr[x.soort])}`, x.datum, x.relatie_code, x.relatie, x.valuta, bedrag, x.btw, JSON.stringify(regels)]);
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await setSetting('exact_demo', { gemaakt: new Date().toISOString(), verschillen: notes });
}

// ---------------------------------------------------------------- an export from Exact (or the desk's own Excel), read in
const flat = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const FIELDS = {
  referentie: ['uw ref', 'uw referentie', 'your ref', 'yourref', 'factuurnummer', 'factuur nr', 'factuurnr', 'invoice number', 'invoice', 'referentie'],
  datum: ['factuurdatum', 'boekdatum', 'datum', 'entry date', 'date', 'invoice date'],
  relatie_code: ['debiteurnummer', 'debiteur', 'crediteurnummer', 'crediteur', 'relatiecode', 'code relatie', 'relatie code', 'account code', 'klantnummer', 'code'],
  relatie: ['relatie', 'naam relatie', 'debiteurnaam', 'crediteurnaam', 'account name', 'klant', 'naam'],
  bedrag: ['bedrag excl btw', 'bedrag excl', 'bedrag', 'netto', 'amount', 'omzet', 'bedrag vv'],
  btw: ['btw bedrag', 'btw', 'vat amount', 'vat'],
  kostendrager: ['plantenpaspoortnummer kostendrager', 'kostendrager', 'cost unit', 'costunit'],
  aantal: ['hoeveelheid', 'aantal', 'quantity', 'qty'],
  dagboek: ['dagboek', 'journal', 'dagboekcode'],
  valuta: ['valuta', 'currency'],
};
function mapHeaders(headers) {
  const map = {}, used = new Set();
  const hs = headers.map(flat);
  for (const [f, words] of Object.entries(FIELDS)) {
    for (const w of words) {
      const i = hs.findIndex((x, j) => !used.has(j) && x === w);
      if (i >= 0) { map[f] = i; used.add(i); break; }
    }
    if (map[f] == null) for (const w of words) {
      const i = hs.findIndex((x, j) => !used.has(j) && x && x.startsWith(w));
      if (i >= 0) { map[f] = i; used.add(i); break; }
    }
  }
  return map;
}
const num = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v.result != null) return num(v.result);
  let s = String(v).replace(/[€$\s]/g, '');
  if (/^-?[\d.]+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?[\d,]+\.\d+$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const dateOf = v => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v.result != null) return dateOf(v.result);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};
const cellText = v => (v == null ? '' : typeof v === 'object' ? (v.text ?? v.result ?? (v.richText ? v.richText.map(x => x.text).join('') : '')) : v);
function parseCsv(text) {
  const first = text.split(/\r?\n/)[0] || '';
  const sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const out = []; let row = [], cur = '', inq = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inq) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += ch; continue; }
    if (ch === '"') inq = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out.filter(r => r.some(c => String(c).trim()));
}
async function tableOf(buf) {
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    // the sheet with the most recognisable headers (the desk's own Excel has its lines on "Exact")
    let best = null;
    wb.eachSheet(ws => {
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const hdr = (ws.getRow(r).values || []).slice(1).map(cellText);
        const m = mapHeaders(hdr);
        const score = Object.keys(m).length;
        if (score >= 3 && (!best || score > best.score)) best = { ws, r, hdr, m, score };
      }
    });
    if (!best) return null;
    const data = [];
    for (let r = best.r + 1; r <= best.ws.rowCount; r++) data.push((best.ws.getRow(r).values || []).slice(1).map(v => (v && typeof v === 'object' && !(v instanceof Date) ? (v.result ?? v.text ?? cellText(v)) : v)));
    return { headers: best.hdr, map: best.m, data };
  }
  const text = buf.toString('utf8').replace(/^﻿/, '');
  const t = parseCsv(text);
  for (let r = 0; r < Math.min(10, t.length); r++) { const m = mapHeaders(t[r]); if (Object.keys(m).length >= 3) return { headers: t[r], map: m, data: t.slice(r + 1) }; }
  return null;
}
export async function exactImport({ naam, data }, wie = 'Jan') {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const t = await tableOf(buf);
  if (!t) throw fail('In dit bestand vond de desk geen kolommen als factuurnummer, datum, relatie en bedrag. Exporteer de boekingen uit Exact als Excel of CSV.');
  const { map, headers } = t;
  if (map.referentie == null || map.bedrag == null) throw fail('Er is geen kolom met het factuurnummer (of uw referentie) en het bedrag.');
  const st = await exactSettings();
  const by = new Map();
  let used = 0;
  for (const r of t.data) {
    const get = f => (map[f] == null ? null : r[map[f]]);
    let ref = String(cellText(get('referentie')) || '').trim();
    const bedrag = num(get('bedrag'));
    if (!ref || bedrag == null) continue;
    const dag = String(cellText(get('dagboek')) || '').trim();
    const soort = /inkoop|purchase/i.test(dag) || (dag && dag === st.dagboek_inkoop) || /^batch\s/i.test(ref) ? 'inkoop' : 'verkoop';
    const kd = String(cellText(get('kostendrager')) || '').trim() || null;
    if (soort === 'inkoop') ref = ref.match(/(\d{6})/)?.[1] || kd || ref;
    const code = String(cellText(get('relatie_code')) || '').trim() || null;
    const key = `${soort}|${norm(ref)}|${soort === 'inkoop' ? norm(code) : ''}`;
    if (!by.has(key)) by.set(key, { soort, referentie: ref, datum: dateOf(get('datum')), relatie_code: code, relatie: String(cellText(get('relatie')) || '').trim() || null, valuta: String(cellText(get('valuta')) || '').trim() || (soort === 'inkoop' ? 'USD' : 'EUR'), bedrag: 0, btw: null, regels: [] });
    const b = by.get(key);
    b.bedrag = r2(b.bedrag + bedrag);
    const btw = num(get('btw'));
    if (btw != null) b.btw = r2((b.btw || 0) + btw);
    b.regels.push({ kostendrager: kd, bedrag: r2(bedrag), aantal: num(get('aantal')) });
    used++;
  }
  if (!by.size) throw fail('Er stonden geen regels met een factuurnummer en een bedrag in.');
  const kolommen = Object.fromEntries(Object.entries(map).map(([f, i]) => [f, String(cellText(headers[i]) || '')]));
  const c = await pool.connect();
  let id;
  try {
    await c.query('BEGIN');
    await c.query(`DELETE FROM exact_imports`);
    id = (await c.query(`INSERT INTO exact_imports (naam, rijen, kolommen, door) VALUES ($1, $2, $3, $4) RETURNING id`, [String(naam || 'export').slice(0, 200), used, JSON.stringify(kolommen), wie])).rows[0].id;
    for (const b of by.values()) await c.query(`INSERT INTO exact_boekingen (bron, soort, referentie, datum, relatie_code, relatie, valuta, bedrag, btw, regels, import_id) VALUES ('import', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [b.soort, b.referentie, b.datum, b.relatie_code, b.relatie, b.valuta, b.bedrag, b.btw, JSON.stringify(b.regels), id]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await log(wie, 'Export uit Exact ingelezen', 'exact', id, { regels: used, boekingen: by.size });
  return { id, regels: used, boekingen: by.size, kolommen, niet: headers.map(cellText).filter((h, i) => h && !Object.values(map).includes(i)) };
}
export async function exactImportRemove() { await q('DELETE FROM exact_imports'); }

// ---------------------------------------------------------------- the check: the desk next to Exact
const eq = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
const money = (v, cur = 'EUR') => `${cur === 'USD' ? '$' : '€'} ${Number(v || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = s => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : '–');
function diffs(x, e) {
  const out = [];
  if (!eq(x.bedrag, e.bedrag)) out.push(`Bedrag: in de desk ${money(x.bedrag, x.valuta)}, in Exact ${money(e.bedrag, x.valuta)}`);
  if (x.relatie_code && e.relatie_code && norm(x.relatie_code) !== norm(e.relatie_code)) out.push(`${x.soort === 'verkoop' ? 'Debiteur' : 'Crediteur'}: in de desk ${x.relatie_code}, in Exact ${e.relatie_code}`);
  if (x.soort === 'verkoop' && e.btw != null && !eq(x.btw, e.btw)) out.push(`Btw: in de desk ${money(x.btw)}, in Exact ${money(e.btw)}`);
  const ek = {};
  for (const r of e.regels || []) if (r.kostendrager) ek[r.kostendrager] = r2((ek[r.kostendrager] || 0) + Number(r.bedrag || 0));
  if (Object.keys(ek).length) {
    for (const k of Object.keys(ek)) if (!(k in x.kostendragers)) out.push(`Kostendrager ${k} staat in Exact, maar niet op ${x.soort === 'verkoop' ? 'de factuur' : 'de inkooporder'}${Object.keys(x.kostendragers).length === 1 ? ` (moet ${Object.keys(x.kostendragers)[0]} zijn)` : ''}`);
    for (const [k, v] of Object.entries(x.kostendragers)) {
      if (!(k in ek)) out.push(`Kostendrager ${k} ontbreekt in Exact`);
      else if (!eq(v, ek[k]) && eq(x.bedrag, e.bedrag)) out.push(`Batch ${k}: in de desk ${money(v, x.valuta)}, in Exact ${money(ek[k], x.valuta)}`);
    }
  }
  if (x.datum && e.datum && x.datum !== e.datum && x.soort === 'verkoop') out.push(`Datum: factuur ${dmy(x.datum)}, in Exact ${dmy(e.datum)}`);
  return out;
}
export async function exactCheck({ jaar = Number(today().slice(0, 4)), lezen = false } = {}) {
  const status = await exactStatus();
  let bron = status.gekoppeld ? 'api' : status.import ? 'import' : status.demo ? 'demo' : null;
  let van = `${jaar}-01-01`, tot = `${jaar}-12-31`;
  const res = { bron, jaar, status, fout: null, verkoop: [], inkoop: [], onbekend: [], samen: { ok: 0, verschil: 0, mist: 0, open: 0, onbekend: 0 }, demo: null, periode: null };
  if (bron === 'api' && lezen) {
    try { await readBackApi({ van, tot }); } catch (e) { res.fout = e.message; }
  }
  if (bron === 'demo') { await ensureDemoMirror(); res.demo = await setting('exact_demo', null); }
  if (bron === 'api') res.gelezen = await setting('exact_gelezen', null);
  const desk = await deskBookings({ van, tot });
  const ex = bron ? await rows(`SELECT * FROM exact_boekingen WHERE bron = $1`, [bron]) : [];
  // an export only covers the dates in it: outside those the desk has nothing to compare with
  if (bron === 'import') {
    const ds = ex.map(b => b.datum).filter(Boolean).sort();
    if (ds.length) { van = ds[0] > van ? ds[0] : van; tot = ds[ds.length - 1] < tot ? ds[ds.length - 1] : tot; }
    res.periode = { van, tot };
  }
  const inRange = x => !x.datum || (x.datum >= van && x.datum <= tot);
  const keyOf = b => (b.soort === 'verkoop' ? norm(b.referentie) : `${norm(b.referentie)}|${norm(b.relatie_code || b.relatie)}`);
  const exBy = new Map();
  for (const b of ex) { const k = `${b.soort}:${keyOf(b)}`; if (!exBy.has(k)) exBy.set(k, []); exBy.get(k).push({ ...b, bedrag: Number(b.bedrag), btw: b.btw == null ? null : Number(b.btw) }); }
  // purchase entries without a supplier code: match on the batch alone when that is unambiguous
  const byBatch = new Map();
  for (const b of ex.filter(b => b.soort === 'inkoop')) { const k = norm(b.referentie); byBatch.set(k, [...(byBatch.get(k) || []), b]); }
  const seen = new Set();
  for (const soort of ['verkoop', 'inkoop']) {
    for (const x of desk[soort].filter(inRange)) {
      let hits = exBy.get(`${soort}:${x.key}`) || [];
      if (!hits.length && soort === 'inkoop') {
        const sameBatch = (byBatch.get(norm(x.ref)) || []).filter(b => !b.relatie_code);
        const deskSame = desk.inkoop.filter(y => y.ref === x.ref);
        if (sameBatch.length === 1 && deskSame.length === 1) hits = sameBatch.map(b => ({ ...b, bedrag: Number(b.bedrag) }));
      }
      hits.forEach(b => seen.add(b.id));
      let st, notes = [];
      if (!hits.length) st = x.exact === 'in_exact' ? 'mist' : 'open';
      else {
        notes = diffs(x, hits[0]);
        if (hits.length > 1) notes.unshift(`${hits.length} keer geboekt in Exact`);
        st = notes.length ? 'verschil' : 'ok';
        if (st === 'ok' && x.exact !== 'in_exact') notes.push('Staat al in Exact; in de desk nog niet aangevinkt');
      }
      res.samen[st]++;
      res[soort].push({ ...x, status: st, verschillen: notes, exact_boeking: hits[0] ? { entry_nummer: hits[0].entry_nummer, datum: hits[0].datum, bedrag: hits[0].bedrag, btw: hits[0].btw, relatie_code: hits[0].relatie_code, regels: hits[0].regels || [] } : null });
    }
  }
  for (const b of ex) {
    if (seen.has(b.id) || !inRange(b)) continue;
    res.onbekend.push({ soort: b.soort, referentie: b.referentie, entry_nummer: b.entry_nummer, datum: b.datum, relatie: b.relatie, relatie_code: b.relatie_code, bedrag: Number(b.bedrag), valuta: b.valuta });
    res.samen.onbekend++;
  }
  return res;
}

// ---------------------------------------------------------------- Maandag → Exact: the week as Exact holds it
// The week's invoices and purchase orders as the entries the desk sends (journal, debtor or creditor, every line with
// its general ledger account, VAT code and the batch as cost unit), with what Exact gave back next to it.
export async function exactWeek(maandag) {
  const jaar = Number(String(maandag).slice(0, 4));
  const [chk, st, can] = await Promise.all([exactCheck({ jaar }), exactSettings(), exactCan()]);
  const sales = chk.verkoop.filter(x => x.maandag === maandag), buys = chk.inkoop.filter(x => x.maandag === maandag);
  const sl = sales.length ? await rows(`SELECT r.pakbon_id, r.regelnr, r.partij, r.dozen, r.stuks, r.prijs_eur, r.bedrag, d.naam, d.maat, s.btw_pct, k.land
      FROM pakbon_regels r JOIN producten d ON d.id = r.product_id JOIN pakbonnen s ON s.id = r.pakbon_id JOIN klanten k ON k.id = s.klant_id
      WHERE r.pakbon_id = ANY($1) ORDER BY r.pakbon_id, r.regelnr`, [sales.map(x => x.id)]) : [];
  const pl = buys.length ? await purchaseLines(buys.map(x => x.id)) : [];
  const GL = { nl: st.gb_omzet_nl, verlegd: st.gb_omzet_eu, export: st.gb_omzet_export }, VAT = { nl: st.btw_nl, verlegd: st.btw_eu, export: st.btw_export };
  const exactOf = x => (x.exact_boeking ? { nummer: x.exact_boeking.entry_nummer, datum: ymd(x.exact_boeking.datum), bedrag: x.exact_boeking.bedrag, btw: x.exact_boeking.btw, relatie_code: x.exact_boeking.relatie_code,
    regels: (x.exact_boeking.regels || []).map(r => ({ kostendrager: r.kostendrager || null, bedrag: r2(Number(r.bedrag || 0)), omschrijving: r.omschrijving || null })) } : null);
  const facturen = sales.map(x => {
    const ls = sl.filter(l => l.pakbon_id === x.id);
    const pct = Number(ls[0]?.btw_pct ?? 0), soort = pct > 0 ? 'nl' : vatFor(ls[0]?.land).soort === 'nl' ? 'export' : vatFor(ls[0]?.land).soort;
    return { id: x.id, nummer: x.ref, klant: x.relatie, klant_id: x.klant_id, debiteur: x.relatie_code, datum: x.datum, valuta: 'EUR', bedrag: x.bedrag, btw: x.btw, totaal: r2(x.bedrag + x.btw), btw_pct: pct,
      status: x.status, verschillen: x.verschillen, exact: exactOf(x), dagboek: st.dagboek_verkoop, grootboek: GL[soort] || '', btw_code: VAT[soort] || '', btw_soort: soort,
      regels: ls.map(l => ({ omschrijving: `${l.naam} ${l.maat}`, dozen: l.dozen, stuks: l.stuks, prijs: Number(l.prijs_eur), bedrag: Number(l.bedrag), kostendrager: l.partij })) };
  });
  const inkoop = buys.map(x => ({ id: x.id, nummer: x.ref, leverancier: x.relatie, leverancier_id: x.leverancier_id, crediteur: x.relatie_code, datum: x.datum, valuta: 'USD', bedrag: x.bedrag,
    status: x.status, verschillen: x.verschillen, exact: exactOf(x), dagboek: st.dagboek_inkoop, grootboek: st.gb_inkoop || '', btw_code: st.btw_inkoop || '',
    regels: pl.filter(l => l.partij_id === x.id).map(l => ({ omschrijving: `${l.naam} ${l.maat}`, stuks: l.stuks, prijs: Number(l.prijs_usd), bedrag: l.bedrag, kostendrager: x.ref })) }));
  const samen = { ok: 0, verschil: 0, mist: 0, open: 0 };
  for (const y of [...facturen, ...inkoop]) samen[y.status] = (samen[y.status] || 0) + 1;
  return { maandag, bron: chk.bron, kan: can, gekoppeld: !!chk.status?.gekoppeld, demo: chk.bron === 'demo', gelezen: chk.gelezen || null, facturen, inkoop, samen };
}
