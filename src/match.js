// Recognising things in loose text: which plant a line means, which grower sent something,
// and whether a sender only looks like a grower Jan knows.

const SYN = [
  [/\bphal(?:aenopsis|\.)?\b|\bphal\b|orchid(?:ee|ea|s)?\b|orchidee\w*/g, ' phalaenopsis '],
  [/\bhydr(?:angea|\.)?\b|\bhortensi[ae]\w*\b|\bhortensie\b/g, ' hortensia '],
  [/\bbolchrys\w*|\bchrysanthem\w*\s+kugel|\bkugelchrys\w*|\bchrysanthemum\s+ball|\bchrysantheme\b/g, ' bolchrysant '],
  [/\bcyclam\w*|\bcyclaam\w*|\balpenveilchen\b/g, ' cyclaam '],
  [/\bkalanch\w*/g, ' kalanchoe '],
  [/\bpoinsettia\b|\bweihnachtsstern\b|\bkerstster\w*/g, ' kerstster '],
  [/\bguzmania\b|\bbromel\w*/g, ' bromelia '],
  [/\bmonstera\b|\bdelic(?:iosa|\.)/g, ' monstera '],
  [/\bcalathea\b|\bgoeppertia\b/g, ' calathea '],
  [/\bzamioculcas\b|\bzz\b/g, ' zamioculcas '],
  [/\bsansevier\w*|\btrifasciata\b/g, ' sansevieria '],
  [/\bstrelitzi\w*/g, ' strelitzia '],
  [/\bdracaen\w*/g, ' dracaena '],
  [/\bnephrolepis\b|\bvaren\b|\bfarn\b|\bfern\b/g, ' varen '],
  [/\bpothos\b|\bepipremnum\b/g, ' pothos '],
  [/\bolea\b|\bolijf\w*|\bolive\b|\bolivenbaum\b/g, ' olijfboom '],
  [/\blavend\w*|\blavandula\b/g, ' lavendel '],
  [/\bbuxus\b|\bbuchs\w*/g, ' buxus '],
  [/\bhyac\w*/g, ' hyacint '],
  [/\brosa\b(?=\s+[a-z])|\brozen?\b|\broses?\b|\brosen\b/g, ' roos '],
  [/\btulp\w*|\btulip\w*|\btulpe\w*/g, ' tulp '],
  [/\balstro\w*/g, ' alstroemeria '],
  [/\bhelleb\w*|\bkerstroos\b|\bchristrose\b/g, ' helleborus '],
  [/\banthur\w*/g, ' anthurium '],
  [/\bspathi\w*|\blepelplant\b/g, ' spathiphyllum '],
  [/\bficus\b/g, ' ficus '],
];
const COLOR = [
  [/\b(?:wit|white|weiss|weiß|blanc|bianco|bia[lł]y)\b/g, ' c:wit '],
  [/\b(?:roze|pink|rosa|rose|rosé)\b/g, ' c:roze '],
  [/\b(?:paars|purple|lila|violet|mauve)\b/g, ' c:paars '],
  [/\b(?:blauw|blue|blau|bleu)\b/g, ' c:blauw '],
  [/\b(?:geel|yellow|gelb|jaune)\b/g, ' c:geel '],
  [/\b(?:oranje|orange)\b/g, ' c:oranje '],
  [/\b(?:rood|red|rot|rouge|rosso)\b/g, ' c:rood '],
];

export function normText(s) {
  let t = ' ' + String(s || '').toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[×x](?=\s*\d)/g, ' ').replace(/[,;:()[\]"'`´’]/g, ' ') + ' ';
  // the roses: "Rosa Red Naomi" reads as a red rose before "rosa" can mean pink
  t = t.replace(/\brosa\s+(red|rood|rot)\b/g, ' roos c:rood ').replace(/\brosa\s+(avalanche|white|wit|weiss)\b/g, ' roos c:wit ');
  for (const [re, to] of SYN) t = t.replace(re, to);
  for (const [re, to] of COLOR) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

// sizes: P12 / 12cm / 12er / Ø12 / 12/70 (pot/height) / H55 / 60cm for cut flowers
export function sizesOf(s) {
  const t = String(s || '').toLowerCase().replace(',', '.');
  const out = { pot: null, height: null, len: null, stems: null };
  let m = t.match(/\b(\d{1,2})\s*\/\s*(\d{2,3})\b/);
  if (m) { out.pot = Number(m[1]); out.height = Number(m[2]); }
  m = t.match(/\bp\s?(\d{1,2}(?:\.\d)?)\b/) || t.match(/\b(\d{1,2}(?:\.\d)?)\s*er\b/) || t.match(/\bpot\s*(\d{1,2})\b/);
  if (m && out.pot == null) out.pot = Math.round(Number(m[1]));
  m = t.match(/\bh\s?(\d{2,3})\b/);
  if (m) out.height = Number(m[1]);
  m = t.match(/\b(\d{2,3})\s*cm\b/g);
  if (m) {
    const vals = m.map(x => Number(x.replace(/\D/g, '')));
    for (const v of vals) { if (v <= 30 && out.pot == null) out.pot = v; else if (v > 30) out.len = v; }
  }
  m = t.match(/\b(\d)\s*(?:-?\s*)(?:t|tak|takken|trieb|triebe|stem|stems|tige|tiges)\b/);
  if (m) out.stems = Number(m[1]);
  if (out.len && out.height == null) out.height = out.len;
  return out;
}

function plantSizes(p) {
  const pot = p.potmaat ? Number(String(p.potmaat).replace(/\D/g, '')) : null;
  const hm = String(p.hoogte || '').match(/(\d{2,3})/);
  const height = hm ? Number(hm[1]) : null;
  const sm = String(p.naam).match(/(\d)-tak/);
  return { pot, height, stems: sm ? Number(sm[1]) : null };
}

const tokens = s => new Set(normText(s).split(' ').filter(w => w.length > 1 || /^\d$/.test(w)));
const colorOf = set => [...set].find(w => w.startsWith('c:')) || null;

// plants: [{ id, naam, latijn, potmaat, hoogte, en }]; aliases: [{ plant_id, kweker_id, tekst }]
export function matchPlant(text, plants, aliases = [], kwekerId = null) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const low = raw.toLowerCase().replace(/\s+/g, ' ');
  // learned names first: exact for this grower, then exact for anyone
  const own = aliases.find(a => a.kweker_id === kwekerId && a.tekst.toLowerCase().replace(/\s+/g, ' ') === low);
  if (own) return { plant_id: own.plant_id, zekerheid: 99, hoe: 'geleerd' };
  const any = aliases.find(a => a.tekst.toLowerCase().replace(/\s+/g, ' ') === low);
  if (any) return { plant_id: any.plant_id, zekerheid: 94, hoe: 'geleerd bij andere kweker' };

  const T = tokens(raw), S = sizesOf(raw), col = colorOf(T);
  let best = null;
  for (const p of plants) {
    const PT = tokens(`${p.naam} ${p.latijn || ''} ${p.en || ''}`);
    const PS = plantSizes(p), pcol = colorOf(PT);
    // the family: shared name words (without colours and tiny words)
    const fam = [...PT].filter(w => !w.startsWith('c:') && !/^\d/.test(w) && w.length > 2);
    const hits = fam.filter(w => T.has(w)).length;
    if (!hits) continue;
    let score = 40 + Math.min(30, hits * 18);
    if (PS.pot != null) score += S.pot == null ? -4 : S.pot === PS.pot ? 14 : -22;
    if (PS.height != null) score += S.height == null ? -2 : Math.abs(S.height - PS.height) <= 5 ? 8 : -10;
    if (PS.stems != null) score += S.stems == null ? -3 : S.stems === PS.stems ? 8 : -18;
    if (pcol) score += col ? (col === pcol ? 10 : -25) : -8;
    else if (col) score -= 4;
    if (!best || score > best.score) best = { plant_id: p.id, score };
  }
  if (!best) return null;
  return { plant_id: best.plant_id, zekerheid: Math.max(5, Math.min(97, Math.round(best.score))), hoe: 'herkend aan naam en maat' };
}

// --- who sent it
const domainOf = addr => { const m = String(addr || '').toLowerCase().match(/@([a-z0-9.-]+)/); return m ? m[1] : null; };
const digits = s => String(s || '').replace(/\D/g, '');

export function lev(a, b) {
  a = a || ''; b = b || '';
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const simpleName = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\b(kwekerij|gartnerei|gaertnerei|bv|b\.v\.|ltd|aps|gmbh|de|van|the)\b/g, '').replace(/[^a-z0-9]/g, '');

// kwekers: [{ id, naam, email, maildomein, whatsapp }]
export function matchGrower({ from, name, phone }, kwekers) {
  const dom = domainOf(from), ph = digits(phone || (String(from || '').startsWith('+') ? from : ''));
  if (dom) {
    const k = kwekers.find(k => (k.maildomein && k.maildomein.toLowerCase() === dom) || domainOf(k.email) === dom);
    if (k) return { kweker: k, zekerheid: 99, hoe: 'afzender' };
  }
  if (ph.length >= 8) {
    const k = kwekers.find(k => k.whatsapp && digits(k.whatsapp).endsWith(ph.slice(-9)));
    if (k) return { kweker: k, zekerheid: 99, hoe: 'telefoonnummer' };
  }
  const sn = simpleName(name);
  if (sn.length >= 4) {
    const exact = kwekers.find(k => simpleName(k.naam) === sn);
    if (exact) return { kweker: exact, zekerheid: dom ? 80 : 90, hoe: 'naam', anderAdres: !!dom };
  }
  return null;
}

// a sender that is almost, but not quite, a known grower
export function lookalike({ from, name }, kwekers) {
  const dom = domainOf(from) || '';
  const sn = simpleName(name), sd = dom.split('.')[0].replace(/[^a-z0-9]/g, '');
  for (const k of kwekers) {
    const kn = simpleName(k.naam), kd = (k.maildomein || domainOf(k.email) || '').split('.')[0].replace(/[^a-z0-9]/g, '');
    if (dom && k.maildomein && dom === k.maildomein.toLowerCase()) return null;
    const nameClose = sn && kn && sn !== kn && lev(sn, kn) <= 2 && kn.length >= 6;
    const domClose = sd && kd && sd !== kd && (lev(sd, kd) <= 3 || sd.includes(kn.slice(0, 6)));
    if (nameClose || (domClose && sn && lev(sn, kn) <= 3)) return { kweker: k, waarom: `Lijkt op ${k.naam}, maar komt van ${dom || 'een onbekend adres'} in plaats van ${k.maildomein || domainOf(k.email)}.` };
  }
  return null;
}

// customers named on an invoice line: order numbers, or a name
export function matchCustomerRef(text, klanten, orders = []) {
  const t = String(text || '');
  if (!t.trim()) return null;
  const on = t.match(/CI-\d{2}-\d{4}/i);
  if (on) {
    const o = orders.find(o => o.nummer.toLowerCase() === on[0].toLowerCase());
    if (o) return { klant_id: o.klant_id, order_id: o.id, hoe: `ordernummer ${o.nummer}` };
  }
  const low = simpleName(t);
  for (const k of klanten) {
    const last = simpleName(k.naam.split(' ').slice(-1)[0]);
    if (last.length >= 4 && low.includes(last)) return { klant_id: k.id, hoe: `naam ${k.naam}` };
  }
  return null;
}
