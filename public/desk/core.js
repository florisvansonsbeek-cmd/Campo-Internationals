// Shared bits of the desk: talking to the server, formatting, icons, dialog and toast.
export const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const attr = h;

export class ApiError extends Error { constructor(msg, status, data) { super(msg); this.status = status; this.data = data; } }
export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Campo': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  if (r.status === 401 && path !== '/login') { window.dispatchEvent(new CustomEvent('campo:logout')); throw new ApiError('Log opnieuw in.', 401, data); }
  if (!r.ok) throw new ApiError((data && data.fout) || `Er ging iets mis (${r.status}).`, r.status, data);
  return data;
}

// ---------- time and numbers, Dutch style
const TZ = 'Europe/Amsterdam';
const fmt = (o) => new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, ...o });
const F = { time: fmt({ hour: '2-digit', minute: '2-digit' }), day: fmt({ weekday: 'short', day: 'numeric', month: 'short' }), long: fmt({ weekday: 'long', day: 'numeric', month: 'long' }), date: fmt({ day: 'numeric', month: 'short', year: 'numeric' }), ymd: fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }) };
const dkey = d => F.ymd.format(d);
export const fTime = v => (v ? F.time.format(new Date(v)) : '–');
export const fDay = v => (v ? F.day.format(new Date(String(v).length === 10 ? v + 'T12:00:00' : v)) : '–');
export const fLong = v => (v ? F.long.format(new Date(v)) : '');
export const fDate = v => (v ? F.date.format(new Date(String(v).length === 10 ? v + 'T12:00:00' : v)) : '–');
export function dayWord(v) {
  if (!v) return '';
  const d = new Date(String(v).length === 10 ? v + 'T12:00:00' : v), now = new Date();
  const k = dkey(d), t = dkey(now), y = dkey(new Date(now - 864e5)), m = dkey(new Date(+now + 864e5)), mm = dkey(new Date(+now + 2 * 864e5));
  return k === t ? 'vandaag' : k === m ? 'morgen' : k === y ? 'gisteren' : k === mm ? 'overmorgen' : F.day.format(d);
}
export function rel(v) {
  if (!v) return '';
  const diff = Math.round((new Date(v) - new Date()) / 6e4);
  const a = Math.abs(diff);
  const s = a < 1 ? 'nu' : a < 60 ? `${a} min` : a < 60 * 24 ? `${Math.floor(a / 60)} u${a % 60 ? ` ${a % 60} min` : ''}` : `${Math.round(a / 1440)} ${Math.round(a / 1440) === 1 ? 'dag' : 'dagen'}`;
  return a < 1 ? 'nu' : diff > 0 ? `over ${s}` : `${s} geleden`;
}
export const isToday = v => v && dkey(new Date(v)) === dkey(new Date());
const NF = new Intl.NumberFormat('nl-NL');
export const fNum = v => (v == null ? '–' : NF.format(Math.round(Number(v))));
export const fEur = (v, d = 0) => (v == null ? '–' : '€ ' + new Intl.NumberFormat('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v)));
export const fPrice = v => (v == null ? '–' : '€ ' + new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(Number(v)));
// an average price: cents for anything from a euro up, a tenth of a cent below that (cut flowers are priced per stem)
export const fAvg = v => (v == null ? '–' : '€ ' + new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(Number(v)) < 1 ? 3 : 2 }).format(Number(v)));
export const fPct = v => (v == null ? '–' : `${String(Math.round(Number(v) * 10) / 10).replace('.', ',')}%`);
export const plural = (n, one, many) => `${fNum(n)} ${Number(n) === 1 ? one : many}`;
export const COUNTRY = { NL: 'Nederland', BE: 'België', DE: 'Duitsland', FR: 'Frankrijk', GB: 'Verenigd Koninkrijk', SE: 'Zweden', NO: 'Noorwegen', DK: 'Denemarken', PL: 'Polen', IT: 'Italië', AT: 'Oostenrijk', CH: 'Zwitserland', ES: 'Spanje', KE: 'Kenia' };
export const LANG = { nl: 'Nederlands', en: 'Engels', de: 'Duits', fr: 'Frans', it: 'Italiaans', pl: 'Pools', sv: 'Zweeds', da: 'Deens', es: 'Spaans', no: 'Noors' };
export const DOW = ['', 'ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

// ---------- icons (simple line drawings, no brand marks)
const P = {
  today: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  flow: '<rect x="3" y="5" width="5" height="14" rx="1"/><rect x="10" y="5" width="5" height="9" rx="1"/><rect x="17" y="5" width="4" height="6" rx="1"/>',
  inbox: '<path d="M3 13l2.5-7h13L21 13v6H3z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>',
  grower: '<path d="M12 21V11"/><path d="M12 11c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5z"/><path d="M12 14c0-3-2.4-5-5.5-5 0 3 2.4 5 5.5 5z"/><path d="M6 21h12"/>',
  customer: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.6-3.6 3.4-6 7-6s6.4 2.4 7 6"/>',
  plant: '<path d="M8 21h8l1-6H7z"/><path d="M12 15V9"/><path d="M12 9c0-3 2-5 5-5 0 3-2 5-5 5z"/><path d="M12 11c0-2.5-1.8-4-4.2-4 0 2.4 1.8 4 4.2 4z"/>',
  plug: '<path d="M9 7V3M15 7V3"/><path d="M6 7h12v4a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
  truck: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="1.5"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
  chat: '<path d="M4.5 19.5l1.2-3.6A7.5 7.5 0 1 1 8.4 18.5z"/><path d="M9 10.5h6M9 13.5h4"/>',
  upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  paste: '<rect x="6" y="4" width="12" height="17" rx="1.5"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h6M9 18h3"/>',
  warn: '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  check: '<path d="M4.5 12.5l4.5 4.5 10.5-10.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  phone: '<path d="M5 4h4l1.5 4-2.5 1.5a11 11 0 0 0 6.5 6.5L16 13.5l4 1.5v4a1.5 1.5 0 0 1-1.6 1.5C10.6 20 4 13.4 3.5 5.6A1.5 1.5 0 0 1 5 4z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  out: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V4H4v12h4"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l7-7"/>',
  stock: '<path d="M4 8l8-4 8 4v10l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v10"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6"/><path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>',
  basket: '<path d="M3.5 9.5h17l-1.8 9.2a1.5 1.5 0 0 1-1.5 1.3H6.8a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M8 9.5l3-5M16 9.5l-3-5"/><path d="M9.5 13v3.5M14.5 13v3.5"/>',
  shed: '<path d="M3 20V9.5L12 4l9 5.5V20"/><path d="M7 20v-7h10v7"/><path d="M7 16.5h10"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  book: '<path d="M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M17 7.5h2V20h-2"/><path d="M8.5 8.5h5M8.5 12h5"/>',
  shield: '<path d="M12 3.5l7 2.8v5.4c0 4.3-3 7.6-7 8.8-4-1.2-7-4.5-7-8.8V6.3z"/>',
};
export const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
export const MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 16h26M16 3c4 4 5.6 8.4 5.6 13S20 25 16 29M16 3c-4 4-5.6 8.4-5.6 13S12 25 16 29" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/><path d="M16 22c0-6 3.5-10 9-11-.5 6-4 10-9 11z" fill="currentColor"/></svg>';

// ---------- status words, always icon + word
export const STAP = {
  binnen: { naam: 'Binnen', uitleg: 'Via mail, WhatsApp of upload; nog niet gelezen', toon: 'info' },
  nakijken: { naam: 'Nakijken', uitleg: 'De desk twijfelt over een regel', toon: 'wait' },
  koppelen: { naam: 'Koppelen', uitleg: 'Planten staan al bij klanten; bevestigen', toon: 'info' },
  rest: { naam: 'Vrij in de loods', uitleg: 'Wat over is: aanbieden vanuit de loods', toon: 'brass' },
  informeren: { naam: 'Klanten informeren', uitleg: 'Bericht per klant klaarzetten en sturen', toon: 'ok' },
  klaar: { naam: 'Klaar', uitleg: 'Alles heeft een plek en is gemeld', toon: 'ok' },
};
// the chain from a grower's offer to the loods; numbered, because it is a real sequence
export const KETEN = {
  aanbod: { nr: 1, naam: 'Aanbod', uitleg: 'Gelezen, gekoppeld aan klanten, risico gewogen', toon: 'info' },
  bellen: { nr: 2, naam: 'Bellen', uitleg: 'Klanten akkoord vragen, offerte versturen', toon: 'wait' },
  besteld: { nr: 3, naam: 'Besteld', uitleg: 'Bij de kweker besteld; de wagen komt eraan', toon: 'brass' },
  loods: { nr: 4, naam: 'In de loods', uitleg: 'Binnen; klaar voor de wagens naar de klanten', toon: 'ok' },
};
export const RISICO = { laag: { naam: 'Laag risico', toon: 'ok' }, middel: { naam: 'Let op', toon: 'wait' }, hoog: { naam: 'Hoog risico', toon: 'bad' } };
export const risicoChip = r => { const x = r && RISICO[r.niveau || r]; return x ? `<span class="risk ${x.toon}"><i aria-hidden="true"></i>${h(x.naam)}</span>` : ''; };
export const stapChip = s => { const x = STAP[s] || { naam: s, toon: '' }; return `<span class="chip ${x.toon}">${x.toon === 'ok' && s === 'klaar' ? icon('check') : ''}${h(x.naam)}</span>`; };
export const kanaalIcon = k => (k === 'whatsapp' ? icon('chat') : k === 'mail' ? icon('mail') : k === 'upload' ? icon('upload') : k === 'plakken' ? icon('paste') : icon('file'));
export const kanaalNaam = k => ({ whatsapp: 'WhatsApp', mail: 'Mail', upload: 'Upload', plakken: 'Geplakt', telefoon: 'Telefoon', demo: 'Demo' }[k] || k);

// ---------- toast and dialog
let toastT = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 4200);
}
export function dialog({ title, body, ok = 'Opslaan', cancel = 'Annuleren', danger = false, onOk }) {
  const d = document.getElementById('dlg');
  d.innerHTML = `<form method="dialog"><header><h2>${h(title)}</h2></header><div class="body">${body}</div><p class="err" style="color:var(--warn);font-weight:600;padding:0 20px" hidden></p>
    <footer><button class="btn btn-ghost" value="cancel" type="submit">${h(cancel)}</button><button class="btn ${danger ? 'btn-bad' : 'btn-leaf'}" value="ok" type="submit">${h(ok)}</button></footer></form>`;
  const form = d.querySelector('form');
  form.addEventListener('submit', async e => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    const err = d.querySelector('.err');
    try {
      e.submitter && (e.submitter.disabled = true);
      const fd = Object.fromEntries(new FormData(form).entries());
      await onOk(fd, d);
      d.close();
    } catch (x) {
      err.hidden = false; err.textContent = x.message;
      if (x.data && x.data.velden) for (const [k, v] of Object.entries(x.data.velden)) { const f = form.querySelector(`[name="${k}"]`); if (f) { f.setAttribute('aria-invalid', 'true'); const l = f.closest('label'); if (l && !l.querySelector('.err')) l.insertAdjacentHTML('beforeend', `<span class="err">${h(v)}</span>`); } }
    } finally { e.submitter && (e.submitter.disabled = false); }
  });
  d.showModal();
  const first = d.querySelector('input,select,textarea'); if (first) first.focus();
}
export const field = (name, label, value = '', { type = 'text', wide = false, opts = null, hint = '', required = false } = {}) => {
  const v = value == null ? '' : value;
  const input = opts
    ? `<select name="${name}">${opts.map(([val, lab]) => `<option value="${h(val)}"${String(val) === String(v) ? ' selected' : ''}>${h(lab)}</option>`).join('')}</select>`
    : type === 'textarea' ? `<textarea name="${name}">${h(v)}</textarea>` : `<input type="${type}" name="${name}" value="${h(v)}"${required ? ' required' : ''}>`;
  return `<label class="f${wide ? ' wide' : ''}">${h(label)}${input}${hint ? `<span class="faint small">${h(hint)}</span>` : ''}</label>`;
};

export function waLink(number, text) { const n = String(number || '').replace(/\D/g, ''); return n ? `https://wa.me/${n}?text=${encodeURIComponent(text || '')}` : null; }
export function mailLink(email, subject, text) { return email ? `mailto:${email}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(text || '')}` : null; }
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Gekopieerd.'); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); toast('Gekopieerd.'); }
}
export const sum = (a, f = x => x) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
