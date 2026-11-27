// Small helpers for the weekly rhythm: days, ISO weeks, the Monday the desk looks at, dollars and euros.
// The server runs in Dutch time (src/tz.js), so a plain Date is a Dutch date here.
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const day = s => new Date(`${String(s).slice(0, 10)}T12:00:00`);            // noon: never shifts across DST
export const addDays = (s, n) => { const d = day(s); d.setDate(d.getDate() + n); return ymd(d); };
export const isoDow = s => ((day(s).getDay() + 6) % 7) + 1;                           // 1 = Monday … 7 = Sunday
export const mondayOf = s => addDays(s, 1 - isoDow(s));
export const today = () => ymd(new Date());
export const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(day(s).getTime());
export const isMonday = s => isDay(s) && isoDow(s) === 1;

export function isoWeek(s) {
  const d = day(s);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const wd = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - wd);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { week: Math.ceil(((t - y0) / 864e5 + 1) / 7), jaar: t.getUTCFullYear() };
}

// the arrival Monday the desk looks at: today when it is Monday, otherwise the coming one.
// Tuesday Jan orders for it, Thursday it is confirmed, Friday it flies, Monday it is in the hall.
export const focusMonday = (t = today()) => (isoDow(t) === 1 ? t : addDays(mondayOf(t), 7));

// the week of a Monday, as Jan says it: "week 49"
export const weekLabel = m => `week ${isoWeek(m).week}`;

// the days of one cycle, counted back from the arrival Monday
export const cycleDays = m => ({ bestellen: addDays(m, -6), bevestiging: addDays(m, -4), verzonden: addDays(m, -3), maandag: m });

// money: Jan notes the rate as dollars for one euro (1 € = $ 1,1630). A dollar price becomes euros by dividing.
// rounding the way Excel and Exact do it: on the decimal number, half away from zero (116.325 becomes 116.33, not 116.32)
export function roundTo(v, d) {
  const n = Number(v);
  if (!Number.isFinite(n)) return n;
  const sign = n < 0 ? -1 : 1, s = Math.abs(n).toPrecision(15);
  if (/e/i.test(s)) return sign * Math.round(Math.abs(n) * 10 ** d) / 10 ** d;
  return sign * Number(`${Math.round(Number(`${s}e${d}`))}e-${d}`);
}
export const r2 = v => roundTo(v, 2);
export const r4 = v => roundTo(v, 4);
export const eurPrice = (usd, koers) => (koers ? r4(Number(usd) / Number(koers)) : null);
export const lineAmount = (stuks, prijsEur) => (prijsEur == null ? null : r2(stuks * prijsEur));

// a stage only counts once its moment has passed (demo documents can be scheduled for later today)
export const passed = (ts, now = new Date()) => !!ts && new Date(ts) <= now;

export const EU = new Set(['NL', 'BE', 'DE', 'FR', 'IT', 'PL', 'SE', 'DK', 'ES', 'AT', 'IE', 'LU', 'PT', 'FI', 'CZ', 'SK', 'SI', 'HU', 'RO', 'BG', 'HR', 'GR', 'CY', 'MT', 'EE', 'LV', 'LT']);
// plants are 9% in the Netherlands; to a business elsewhere in the EU the VAT is reverse charged; outside the EU it is export
export const vatFor = land => (land === 'NL' ? { pct: 9, soort: 'nl' } : EU.has(land) ? { pct: 0, soort: 'verlegd' } : { pct: 0, soort: 'export' });

export const sum = (a, f = x => x) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export const groupBy = (a, f) => { const m = new Map(); for (const x of a) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
