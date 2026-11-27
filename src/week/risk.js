// Does it arrive on Monday? The way every shipment travels (the farm, the airports, the truck to Nootdorp) and what could
// stop it on the way:
//   the desk's own signals    papers later than usual, a doubt on the papers, a supplier that is often late
//   what Jan notes            a strike, ash over an airport, a road closed (risico_meldingen)
//   the calendar              Christmas, Valentine's and Mother's Day fill the cargo planes
//   the weather               the forecast at every stop on the day the boxes are there (MET Norway, free for business use)
//   storms                    tropical storms near an airport on the route (US National Hurricane Center)
// Green: nothing in the way. Orange: keep an eye on it. Red: a real problem, the boxes may not be there on Monday.
// Nothing about Campo leaves the desk: it only asks for the weather at a handful of airport coordinates.
import { rows } from '../db.js';
import { addDays, passed, ymd } from './util.js';

export const PLEKKEN = {
  SJO: { naam: 'Juan Santamaría', stad: 'San José', land: 'CR', lat: 9.9939, lon: -84.2088, tz: 'America/Costa_Rica' },
  LIR: { naam: 'Daniel Oduber', stad: 'Liberia', land: 'CR', lat: 10.5933, lon: -85.5444, tz: 'America/Costa_Rica' },
  GUA: { naam: 'La Aurora', stad: 'Guatemala-Stad', land: 'GT', lat: 14.5833, lon: -90.5275, tz: 'America/Guatemala' },
  MIA: { naam: 'Miami International', stad: 'Miami', land: 'US', lat: 25.7959, lon: -80.287, tz: 'America/New_York' },
  MEX: { naam: 'Benito Juárez', stad: 'Mexico-Stad', land: 'MX', lat: 19.4363, lon: -99.0721, tz: 'America/Mexico_City' },
  BOG: { naam: 'El Dorado', stad: 'Bogotá', land: 'CO', lat: 4.7016, lon: -74.1469, tz: 'America/Bogota' },
  PTY: { naam: 'Tocumen', stad: 'Panama-Stad', land: 'PA', lat: 9.0714, lon: -79.3835, tz: 'America/Panama' },
  UIO: { naam: 'Mariscal Sucre', stad: 'Quito', land: 'EC', lat: -0.1292, lon: -78.3575, tz: 'America/Guayaquil' },
  AMS: { naam: 'Schiphol', stad: 'Amsterdam', land: 'NL', lat: 52.3105, lon: 4.7683, tz: 'Europe/Amsterdam' },
  LGG: { naam: 'Liège Airport', stad: 'Luik', land: 'BE', lat: 50.6374, lon: 5.4432, tz: 'Europe/Brussels' },
  BRU: { naam: 'Brussels Airport', stad: 'Brussel', land: 'BE', lat: 50.9014, lon: 4.4844, tz: 'Europe/Brussels' },
  FRA: { naam: 'Frankfurt', stad: 'Frankfurt', land: 'DE', lat: 50.0379, lon: 8.5622, tz: 'Europe/Berlin' },
  MAD: { naam: 'Barajas', stad: 'Madrid', land: 'ES', lat: 40.4983, lon: -3.5676, tz: 'Europe/Madrid' },
  LUX: { naam: 'Findel', stad: 'Luxemburg', land: 'LU', lat: 49.6233, lon: 6.2044, tz: 'Europe/Luxembourg' },
  NTD: { naam: 'Loods Campo', stad: 'Nootdorp', land: 'NL', lat: 52.045, lon: 4.394, tz: 'Europe/Amsterdam' },
};
const EUROPE = new Set(['NL', 'BE', 'DE', 'ES', 'LU', 'FR']);
export const DEFAULT_ROUTE = { CR: ['SJO', 'AMS'], GT: ['GUA', 'MIA', 'AMS'] };
export const LAND = { CR: 'Costa Rica', GT: 'Guatemala', US: 'Verenigde Staten', MX: 'Mexico', CO: 'Colombia', PA: 'Panama', EC: 'Ecuador', NL: 'Nederland', BE: 'België', DE: 'Duitsland', ES: 'Spanje', LU: 'Luxemburg' };

const ERNST = { probleem: 3, let_op: 2, info: 1, ok: 0 };
const LICHT = { 3: 'rood', 2: 'oranje' };
const at = (d, h, m = 0) => { const x = new Date(`${d}T00:00:00`); x.setHours(h, m, 0, 0); return x; };
const H = 3600e3;
const fmtDay = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });
const dag = s => fmtDay.format(new Date(`${String(s).slice(0, 10)}T12:00:00`)).replace('.', '');
const dagTijd = v => `${fmtDay.format(new Date(v)).replace('.', '')} ${fmtTime.format(new Date(v))}`;

export function routeOf(p) {
  const r = (p.route && p.route.length ? p.route : p.lev_route && p.lev_route.length ? p.lev_route : DEFAULT_ROUTE[p.regio] || ['AMS']);
  return r.map(x => String(x).trim().toUpperCase()).filter(x => /^[A-Z]{3}$/.test(x) && x !== 'NTD');
}
export function parseRoute(text) {
  const codes = String(text || '').toUpperCase().split(/[^A-Z]+/).filter(x => /^[A-Z]{3}$/.test(x) && x !== 'NTD');
  return codes.length ? codes.slice(0, 6) : null;
}
export const routeText = codes => codes.map(c => (PLEKKEN[c] ? PLEKKEN[c].stad : c)).join(' → ');

// when the boxes are where: Friday out of Central America (or the day the papers say), changing planes the same day,
// a night over the ocean, Europe the next day, and Monday morning the truck to Nootdorp
export function plan(p, { now = new Date() } = {}) {
  const route = routeOf(p);
  const m = String(p.maandag).slice(0, 10);
  const vertrek = p.verzonden_op ? new Date(p.verzonden_op) : at(addDays(m, -3), 18);
  const vd = ymd(vertrek), n = route.length;
  const stops = [{ code: null, soort: 'herkomst', naam: p.leverancier || 'Leverancier', stad: p.lev_plaats || '', land: p.herkomst || p.regio, dag: vd }];
  route.forEach((code, i) => {
    const pl = PLEKKEN[code] || { naam: code, stad: code, land: '' };
    const day = i === 0 ? vd : i < n - 1 ? addDays(vd, i - 1) : addDays(vd, Math.max(1, n - 2));
    stops.push({ code, soort: i === 0 ? 'vertrek' : i < n - 1 ? 'overstap' : 'aankomst', naam: pl.naam, stad: pl.stad, land: pl.land, dag: day });
  });
  const base = p.verwacht_op ? new Date(p.verwacht_op) : at(m, 7);
  stops.push({ code: 'NTD', soort: 'loods', naam: PLEKKEN.NTD.naam, stad: PLEKKEN.NTD.stad, land: 'NL', dag: ymd(base) });
  return { route, stops, vertrek, verwacht: base, maandag: m, binnen: passed(p.binnen_op, now) ? new Date(p.binnen_op) : null };
}

// ---------------------------------------------------------------- the world outside: fetched with a short leash and kept a while
const memo = new Map();
const ttl = { ok: 45 * 60e3, fout: 10 * 60e3 };
const contact = () => process.env.WEER_CONTACT || 'info@campointernational.nl';
async function getJson(url, ms = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': `campo-desk/1.0 (${contact()})`, accept: 'application/json' } });
    if (!r.ok) throw new Error(`antwoord ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
// a value that is still being fetched does not hold up the page: what is not there within the budget comes next time
async function cached(key, fetcher, budget) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < (hit.ok ? ttl.ok : ttl.fout)) return hit;
  if (!hit || !hit.loading) {
    const loading = fetcher().then(data => ({ ok: true, data, at: Date.now() }), e => ({ ok: false, fout: e.name === 'AbortError' ? 'geen antwoord' : e.message, at: Date.now() }))
      .then(v => { memo.set(key, v); return v; });
    memo.set(key, { ...(hit || {}), loading });
  }
  const pending = memo.get(key).loading;
  let timer;
  const late = new Promise(res => { timer = setTimeout(() => res(null), budget); });
  const v = await Promise.race([pending, late]);
  clearTimeout(timer);
  return v || (hit && hit.data ? hit : { ok: false, fout: 'nog aan het ophalen', at: Date.now(), wacht: true });
}
const off = () => process.env.WERELD === 'uit';

// MET Norway's forecast for one place, folded into days in that place's own time zone
export function metDays(json, tz) {
  const days = {};
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const t of json?.properties?.timeseries || []) {
    const d = f.format(new Date(t.time));
    const x = days[d] || (days[d] = { wind: 0, gust: null, regen: 0, sneeuw: 0, onweer: false, mist: 0, ijzel: false, tmin: null });
    const inst = t.data?.instant?.details || {};
    const n1 = t.data?.next_1_hours, n6 = t.data?.next_6_hours;
    const next = n1 || n6;
    const sym = String(next?.summary?.symbol_code || '');
    const mm = Number(next?.details?.precipitation_amount || 0);
    if (inst.wind_speed != null) x.wind = Math.max(x.wind, Number(inst.wind_speed));
    if (inst.wind_speed_of_gust != null) x.gust = Math.max(x.gust ?? 0, Number(inst.wind_speed_of_gust));
    if (inst.air_temperature != null) x.tmin = x.tmin == null ? Number(inst.air_temperature) : Math.min(x.tmin, Number(inst.air_temperature));
    if (/fog/.test(sym) || Number(inst.fog_area_fraction) >= 60) x.mist++;
    if (/thunder/.test(sym)) x.onweer = true;
    const cold = inst.air_temperature != null && Number(inst.air_temperature) <= 0.5;
    if (/snow|sleet/.test(sym)) x.sneeuw += mm;
    else x.regen += mm;
    if (mm > 0 && cold && /rain|drizzle/.test(sym)) x.ijzel = true;
  }
  return days;
}

async function weatherFor(codes) {
  if (off()) return { status: 'uit', per: {} };
  const list = [...new Set(codes)].filter(c => PLEKKEN[c]);
  if (!list.length) return { status: 'niet nodig', per: {} };
  const got = await Promise.all(list.map(c => cached(`met:${c}`, async () => {
    const p = PLEKKEN[c];
    const j = await getJson(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}`);
    return metDays(j, p.tz);
  }, 2500)));
  const per = {}, fouten = [];
  list.forEach((c, i) => { if (got[i].ok) per[c] = got[i].data; else fouten.push(got[i].fout); });
  const okN = Object.keys(per).length;
  return { status: okN === list.length ? 'ok' : okN ? 'deels' : fouten.some(f => f === 'nog aan het ophalen') ? 'laden' : 'weg', per, op: Math.max(0, ...got.filter(g => g.ok).map(g => g.at)) || null, fout: fouten[0] || null };
}

// the hurricane center's list of active storms, Atlantic and eastern Pacific
// coordinates come as numbers (latitudeNumeric, or latitude_numeric in NHC's reference) or as text like "25.8N", "71.3W"
const coord = v => {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  const m = String(v).trim().match(/^(-?[\d.]+)\s*([NSEW])?$/i);
  if (!m) return NaN;
  const x = Number(m[1]);
  return /[SW]/i.test(m[2] || '') ? -Math.abs(x) : x;
};
export function nhcStorms(json) {
  return (json?.activeStorms || []).map(s => ({
    naam: s.name, klasse: String(s.classification || '').toUpperCase(), kn: Number(s.intensity) || null,
    lat: coord(s.latitudeNumeric ?? s.latitude_numeric ?? s.latitude), lon: coord(s.longitudeNumeric ?? s.longitude_numeric ?? s.longitude),
  })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
}
async function stormsNow() {
  if (off()) return { status: 'uit', lijst: [] };
  const v = await cached('nhc', async () => nhcStorms(await getJson('https://www.nhc.noaa.gov/CurrentStorms.json')), 2500);
  return v.ok ? { status: 'ok', lijst: v.data, op: v.at } : { status: v.wacht ? 'laden' : 'weg', lijst: [], fout: v.fout };
}
const km = (a, b) => {
  const r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
};

// ---------------------------------------------------------------- what the weather means for a box on that day at that place
export function weatherVerdict(w, stop) {
  if (!w) return null;
  const eu = EUROPE.has(stop.land), where = `${stop.code === 'AMS' ? 'Schiphol' : stop.stad || stop.naam} ${dag(stop.dag)}`;
  const gust = w.gust ?? null, kmh = v => Math.round(v * 3.6);
  const out = [];
  if ((gust != null && gust >= 28) || w.wind >= 24.5) out.push(['probleem', `${where}: zware storm, windstoten tot ${kmh(gust ?? w.wind)} km/u. Vluchten en vrachtwagens kunnen stilliggen.`]);
  else if ((gust != null && gust >= 20) || w.wind >= 17) out.push(['let_op', `${where}: harde wind, windstoten tot ${kmh(gust ?? w.wind)} km/u.`]);
  if (eu && w.sneeuw >= 5) out.push(['probleem', `${where}: veel sneeuw verwacht (ongeveer ${Math.round(w.sneeuw)} cm). Schiphol en de weg naar Nootdorp lopen vast.`]);
  else if (eu && w.sneeuw >= 0.5) out.push(['let_op', `${where}: sneeuw verwacht, kans op vertraging en gladheid.`]);
  if (eu && w.ijzel) out.push([stop.soort === 'loods' ? 'probleem' : 'let_op', `${where}: kans op ijzel.`]);
  if (w.regen >= 40) out.push(['let_op', `${where}: zware regen (${Math.round(w.regen)} mm)${w.onweer ? ' met onweer' : ''}.`]);
  else if (w.onweer && w.regen >= 20 && stop.soort !== 'loods') out.push(['let_op', `${where}: onweersbuien, laden en opstijgen kunnen uitlopen.`]);
  if (eu && w.mist >= 4 && stop.soort !== 'loods') out.push(['let_op', `${where}: mist, landingen kunnen vertragen.`]);
  if (!out.length) return null;
  out.sort((a, b) => ERNST[b[0]] - ERNST[a[0]]);
  return { ernst: out[0][0], tekst: out.map(x => x[1]).join(' ') };
}

// Christmas and the flower holidays: full planes out of Latin America
function calendarNote(d) {
  const md = d.slice(5);
  if (md >= '12-18' || md <= '01-04') return 'Feestdagen: minder vluchten en volle vliegtuigen. Laat de vlucht vroeg bevestigen.';
  if (md >= '02-01' && md <= '02-14') return 'Valentijn: veel bloemenvracht uit Latijns-Amerika, de vrachtruimte kan krap zijn. Laat de vlucht vroeg bevestigen.';
  if (md >= '05-01' && md <= '05-12') return 'Moederdag: drukke vrachtweken uit Latijns-Amerika. Laat de vlucht vroeg bevestigen.';
  return null;
}

// ---------------------------------------------------------------- one verdict per shipment
// hist: per supplier { laat, n } over the last thirteen shipments (see lateHistory)
export async function assess(partijen, { now = new Date(), hist = {} } = {}) {
  const live = partijen.filter(p => passed(p.besteld_op, now) && !passed(p.binnen_op, now));
  const plans = new Map(partijen.map(p => [p.id, plan(p, { now })]));
  let notices = [];
  if (partijen.length) {
    const ps = [...plans.values()];
    const from = new Date(Math.min(...ps.map(x => +x.vertrek)) - 36 * H), to = new Date(Math.max(...ps.map(x => +x.verwacht)) + 36 * H);
    // a strike announced for Sunday counts from the moment Jan notes it, not from Sunday
    notices = await rows(`SELECT * FROM risico_meldingen WHERE opgelost_op IS NULL AND van <= $2 AND (tot IS NULL OR tot > $1) AND aangemaakt <= $3
      ORDER BY CASE ernst WHEN 'probleem' THEN 0 ELSE 1 END, van`, [from, to, now]);
  }
  // only ask the world when something is still on its way and close enough for a forecast
  const soon = live.filter(p => +plans.get(p.id).verwacht - +now < 8 * 24 * H);
  const codes = soon.flatMap(p => plans.get(p.id).stops.filter(s => s.code && new Date(`${s.dag}T23:59:59`) >= now).map(s => s.code));
  const [weer, storm] = soon.length ? await Promise.all([weatherFor(codes), stormsNow()]) : [{ status: 'niet nodig', per: {} }, { status: 'niet nodig', lijst: [] }];

  const per = new Map();
  for (const p of partijen) {
    const pl = plans.get(p.id);
    const R = [];
    const add = (ernst, soort, tekst, o = {}) => R.push({ ernst, soort, tekst, ...o });
    const m = pl.maandag;
    const ordered = passed(p.besteld_op, now), confirmed = passed(p.bevestigd_op, now), flown = passed(p.verzonden_op, now);
    if (!ordered) { per.set(p.id, { licht: null, kop: 'Nog niet besteld.', ...pl, stops: pl.stops, redenen: [] }); continue; }
    if (pl.binnen) {
      const late = pl.binnen > at(m, 12);
      per.set(p.id, { licht: 'binnen', kop: `Binnen ${dagTijd(pl.binnen)}${late ? ', later dan normaal' : ''}.`, ...pl, redenen: late ? [{ ernst: 'info', soort: 'historie', tekst: 'Kwam later binnen dan maandagochtend.' }] : [] });
      continue;
    }
    // papers: the confirmation on Thursday, the shipping papers on Friday
    if (!confirmed) {
      const due = p.bevestigd_op && new Date(p.bevestigd_op) > now ? new Date(p.bevestigd_op) : at(addDays(m, -4), 17);
      if (now > at(addDays(m, -3), 12) && now > due) add('probleem', 'papieren', 'Nog geen bevestiging, terwijl het vandaag zou vliegen. Bel de leverancier.');
      else if (+now > +due + 2 * H) add('let_op', 'papieren', `Nog geen bevestiging (normaal ${dagTijd(due)}).`);
    } else if (!flown) {
      const due = p.verzonden_op && new Date(p.verzonden_op) > now ? new Date(p.verzonden_op) : at(addDays(m, -3), 20);
      if (now > at(addDays(m, -2), 14) && now > due) add('probleem', 'papieren', 'Geen verzendbewijs: het is niet zeker dat de dozen in het vliegtuig zitten. Bel de leverancier of de expediteur.');
      else if (+now > +due + 3 * H) add('let_op', 'papieren', `Het verzendbewijs is later dan normaal (${dagTijd(due)}).`);
    }
    if (p.twijfels) add('let_op', 'papieren', `${p.twijfels === 1 ? 'Eén regel' : `${p.twijfels} regels`} op het verzendbewijs om na te kijken${p.twijfelProduct ? ` (${p.twijfelProduct})` : ''}.`, { uitleg: p.twijfel || null, bron: 'desk', twijfel: true });
    // what Jan noted, or the demo's examples
    let delay = 0;
    const codes_ = new Set(pl.route);
    for (const n of notices) {
      const plek = n.plek ? String(n.plek).toUpperCase() : null;
      const hits = n.partij_id ? n.partij_id === p.id : !plek || codes_.has(plek) || plek === p.regio || (plek === 'NL' || plek === 'NTD');
      if (!hits) continue;
      const van = new Date(n.van), tot = n.tot ? new Date(n.tot) : null;
      if (tot && tot < new Date(+pl.vertrek - 24 * H)) continue;
      if (van > new Date(+pl.verwacht + 24 * H)) continue;
      // over: no longer in the way, but a delay it caused still counts
      const over = tot && tot <= now;
      add(over ? 'info' : n.ernst, n.soort === 'weer' || n.soort === 'storm' ? n.soort : 'melding', over ? `Voorbij: ${n.titel}` : n.titel,
        { uitleg: n.tekst, plek: plek === 'NL' ? 'NTD' : plek, bron: n.bron, id: n.id, tot: n.tot, van: n.van });
      if (n.vertraging_uren) delay = Math.max(delay, n.vertraging_uren);
    }
    // the weather where the boxes are, on the day they are there
    for (const s of pl.stops) {
      if (!s.code || new Date(`${s.dag}T23:59:59`) < now) continue;
      if (s.soort === 'vertrek' && flown) continue;
      const v = weatherVerdict(weer.per[s.code]?.[s.dag], s);
      if (v) add(v.ernst, 'weer', v.tekst, { plek: s.code, bron: 'met.no' });
      for (const st of storm.lijst) {
        const pl_ = PLEKKEN[s.code];
        if (!pl_ || EUROPE.has(pl_.land)) continue;
        const d = km(pl_, st);
        const hur = st.klasse === 'HU', ts = st.klasse === 'TS' || st.klasse === 'STS';
        const kind = hur ? 'Orkaan' : ts ? 'Tropische storm' : st.klasse === 'PTC' ? 'Restant van storm' : st.klasse === 'PC' ? 'Mogelijke tropische storm' : 'Tropische depressie';
        if (hur && d <= 300) add('probleem', 'storm', `${kind} ${st.naam} op ${Math.round(d)} km van ${pl_.stad}.`, { plek: s.code, bron: 'nhc' });
        else if ((hur && d <= 750) || (ts && d <= 450) || d <= 250) add('let_op', 'storm', `${kind} ${st.naam} op ${Math.round(d)} km van ${pl_.stad}.`, { plek: s.code, bron: 'nhc' });
      }
    }
    const cal = calendarNote(ymd(pl.vertrek));
    if (cal) add('let_op', 'kalender', cal, { bron: 'kalender' });
    const h = hist[p.leverancier_id];
    if (h && h.n >= 5) {
      if (h.laat >= 3) add('let_op', 'historie', `Kwam ${h.laat} van de laatste ${h.n} keer later dan maandagochtend.`, { bron: 'desk' });
      else if (h.laat) add('info', 'historie', `${h.laat === 1 ? 'Eén keer' : `${h.laat} keer`} later dan maandagochtend in de laatste ${h.n} zendingen.`, { bron: 'desk' });
    }
    pl.route.slice(1, -1).forEach(c => add('info', 'route', `Overstap in ${PLEKKEN[c]?.stad || c}: mist het de aansluiting, dan schuift het een dag.`, { plek: c, bron: 'desk' }));

    R.sort((a, b) => ERNST[b.ernst] - ERNST[a.ernst]);
    const worst = R.length ? ERNST[R[0].ernst] : 0;
    const licht = LICHT[worst] || 'groen';
    const verwacht = new Date(+pl.verwacht + delay * H);
    const stops = pl.stops.map(s => {
      const mine = R.filter(r => r.plek && (r.plek === s.code || (s.soort === 'herkomst' && r.plek === p.regio)));
      const w = mine.length ? Math.max(...mine.map(r => ERNST[r.ernst])) : 0;
      const voorbij = s.soort === 'herkomst' ? flown || new Date(`${s.dag}T23:59:59`) < now : s.soort === 'vertrek' ? flown : new Date(`${s.dag}T23:59:59`) < now;
      return { ...s, licht: LICHT[w] || 'groen', voorbij: !!voorbij };
    });
    const where = flown ? `vertrokken ${dagTijd(pl.vertrek)}` : confirmed ? `bevestigd, vliegt ${dag(ymd(pl.vertrek))}` : 'besteld, de bevestiging komt nog';
    const arrive = `${dagTijd(verwacht)}${delay ? ` (${delay} uur later)` : ''}`;
    const kop = licht === 'groen' ? `${where[0].toUpperCase()}${where.slice(1)}. Maandag ${dagTijd(verwacht).split(' ').pop()} in de loods.` : R[0].tekst;
    per.set(p.id, { ...pl, licht, kop, verwacht, vertraging: delay, aankomst: arrive, stops, redenen: R });
  }
  return {
    per,
    bronnen: {
      weer: { status: weer.status, op: weer.op ? new Date(weer.op) : null, fout: weer.fout || null },
      storm: { status: storm.status, op: storm.op ? new Date(storm.op) : null, aantal: storm.lijst.length, fout: storm.fout || null },
      meldingen: notices.map(n => ({ id: n.id, soort: n.soort, ernst: n.ernst, titel: n.titel, tekst: n.tekst, plek: n.plek, van: n.van, tot: n.tot, bron: n.bron, vertraging_uren: n.vertraging_uren, partij_id: n.partij_id })),
    },
  };
}

// how often a supplier's boxes came later than Monday morning, over its last thirteen shipments
export async function lateHistory(before) {
  const r = await rows(`SELECT leverancier_id, count(*) AS n, count(*) FILTER (WHERE binnen_op > (maandag + time '12:00')) AS laat
    FROM (SELECT p.*, row_number() OVER (PARTITION BY leverancier_id ORDER BY maandag DESC) AS rn FROM partijen p
      WHERE binnen_op IS NOT NULL AND binnen_op <= now() AND maandag < $1) x WHERE rn <= 13 GROUP BY leverancier_id`, [before]);
  return Object.fromEntries(r.map(x => [x.leverancier_id, { n: Number(x.n), laat: Number(x.laat) }]));
}

// for the page: the verdict as plain data
export function riskJson(v) {
  if (!v) return null;
  return {
    licht: v.licht, kop: v.kop, verwacht: v.verwacht || null, aankomst: v.aankomst || null, vertraging: v.vertraging || 0, binnen: v.binnen || null, vertrek: v.vertrek,
    route: v.route, stops: v.stops, redenen: v.redenen,
  };
}
