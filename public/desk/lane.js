// One order drawn as a route: the grower's truck to Jan's loods, then fanning out to every customer.
// Used on the workflow (every order, click opens a new tab) and on the order's own page.
import { h, icon, fTime, fNum, dayWord } from './core.js';

export const TONE = { ok: 'Op tijd', wait: 'Krap', bad: 'In gevaar', done: 'Afgeleverd' };
export const when = v => (dayWord(v) === 'vandaag' ? fTime(v) : `${dayWord(v)} ${fTime(v)}`);
export const dur = m => { m = Math.round(Math.abs(m)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} u${m % 60 ? ` ${m % 60} min` : ''}`; };
export const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const GENERIC = /^(Komt|Levert|Kwaliteit|Factuurprijs|Nieuwe|Lange|Regel|Twijfel|Verlies|Te|Hele|Extra|Kort|Seizoen|Geen|Eén|Dunne|Smalle|Aanbod|Beslis|Bij|Betrouwbare|Goede)\b/;
export const lcTitle = s => (s && GENERIC.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s || '');
const NEW = 'target="_blank" rel="noopener"';
const ROW = 28, FORK = 64;

const lateTag = (m, toon) => (m >= 10 ? ` <span class="lt t-${toon || 'wait'}">+${m < 60 ? `${m} min` : `${Math.floor(m / 60)} u${m % 60 ? ` ${m % 60}` : ''}`}</span>` : '');

function inLabel(z) {
  if (z.state === 'gepland') return `vertrekt ${h(when(z.vertrek))}`;
  if (z.state === 'laden') return 'wordt geladen';
  if (z.state === 'onderweg') return `komt ${h(when(z.eta))}${lateTag(z.delay, z.toon === 'ok' ? 'wait' : z.toon)}`;
  return `binnen ${h(when(z.eta))}${lateTag(z.delay, 'wait')}`;
}

function custTitle(k) {
  const gone = k.state === 'onderweg' || k.state === 'afgeleverd';
  return `Wagen ${gone ? 'vertrok' : 'vertrekt'} ${when(k.vertrek)}; ${k.state === 'afgeleverd' ? 'afgeleverd' : 'aankomst waarschijnlijk'} ${when(k.eta)}`;
}

// where the order probably is now, in one sentence
export function stageText(b) {
  const z = b.in, ks = b.klanten;
  const af = ks.filter(k => k.state === 'afgeleverd').length, weg = ks.filter(k => k.state === 'onderweg').length;
  const thuis = ks.length - af - weg;
  switch (b.stap) {
    case 'kweker': return `${z.state === 'laden' ? 'Wordt geladen bij de kweker' : 'Nog bij de kweker'}; in Nootdorp ${when(z.eta)}`;
    case 'naar-campo': return `Onderweg naar Nootdorp, aankomst ${when(z.eta)}`;
    case 'loods': {
      if (!ks.length) return 'In de loods; alles is vrij om te verkopen';
      const first = ks.filter(k => k.state !== 'afgeleverd').sort((x, y) => new Date(x.vertrek) - new Date(y.vertrek))[0];
      return `In de loods${first ? `; eerste wagen vertrekt ${when(first.vertrek)}` : ''}`;
    }
    case 'naar-klant': return `${[af ? `${af} afgeleverd` : '', weg ? `${weg} onderweg` : '', thuis ? `${thuis} nog in de loods` : ''].filter(Boolean).join(', ')}; laatste aankomst ${when(b.eind)}`;
    default: return `Alles afgeleverd, laatste ${when(b.eind)}`;
  }
}

export function laneHtml(b, { link = true } = {}) {
  const rows = b.klanten.map(k => ({ k }));
  if (b.vrij > 0) rows.push({ vrij: b.vrij });
  if (!rows.length) rows.push({ leeg: true });
  const n = rows.length, H = Math.max(n * ROW, 58), top = (H - n * ROW) / 2, mid = H / 2;
  const z = b.in, zp = Math.round((z.state === 'binnen' ? 1 : z.progress) * 100);
  const curves = rows.map((r, i) => {
    const y = top + i * ROW + ROW / 2;
    const cls = r.k ? (r.k.state === 'onderweg' || r.k.state === 'afgeleverd' ? `go t-${r.k.toon}` : 'not') : 'stock';
    return `<path class="${cls}" d="M0 ${mid} H8 C ${FORK * 0.6} ${mid}, ${FORK * 0.4} ${y}, ${FORK} ${y}"/>`;
  }).join('');
  const row = r => {
    if (r.leeg) return `<li class="cust none"><span class="bl"></span><span class="cd"></span><span class="cn">Nog geen klant</span><span class="ct"></span></li>`;
    if (r.vrij) return `<li class="cust stock"><span class="bl"></span><span class="cd"></span><span class="cn"><b>${fNum(r.vrij)}</b> vrij voor de loods</span><span class="ct"></span></li>`;
    const k = r.k, p = Math.round(k.progress * 100);
    const name = `<b>${h(k.klant)}</b><span>${h(k.plaats || '')}</span>`;
    return `<li class="cust t-${k.toon} s-${k.state}" title="${h(custTitle(k))}">
      <span class="bl" aria-hidden="true"><i style="width:${p}%"></i></span><span class="cd" aria-hidden="true"></span>
      ${link ? `<a class="cn" href="#/bestelling/${b.id}?klant=${k.levering_id}" ${NEW}>${name}</a>` : `<a class="cn" href="#lev-${k.levering_id}">${name}</a>`}
      <span class="ct">${k.state === 'afgeleverd' ? icon('check') : ''}${h(when(k.eta))}${k.state === 'afgeleverd' ? '' : lateTag(k.delay, k.toon === 'ok' ? 'wait' : k.toon)}</span></li>`;
  };
  const label = `Bestelling van ${b.kweker}, ${b.klanten.length} ${b.klanten.length === 1 ? 'klant' : 'klanten'}: ${TONE[b.toon]}${b.reden ? `, ${b.reden}` : ''}. Opent in een nieuw tabblad.`;
  return `<article class="lane t-${b.toon}${b.actief ? '' : ' is-done'}">
    ${link ? `<a class="lane-link" href="#/bestelling/${b.id}" ${NEW} aria-label="${h(label)}"></a>` : ''}
    <div class="ln" style="--h:${H}px">
      <div class="gr"><b>${h(b.kweker)}</b><span>${h([b.plaats, b.nummer].filter(Boolean).join(' · '))}</span><span>${fNum(b.stuks)} stuks${b.soorten ? `, ${b.soorten} ${b.soorten === 1 ? 'soort' : 'soorten'}` : ''}</span></div>
      <div class="in s-${z.state} t-${z.toon}" style="--p:${zp}%"><span class="tk" aria-hidden="true"><i></i>${z.state === 'onderweg' ? `<span class="truck">${icon('truck')}</span>` : ''}</span><span class="il">${inLabel(z)}</span></div>
      <div class="hub${z.state === 'binnen' ? ' on' : ''}" aria-hidden="true"><span>${icon('shed')}</span><em>Campo</em></div>
      <svg class="fork" viewBox="0 0 ${FORK} ${H}" width="${FORK}" height="${H}" aria-hidden="true" focusable="false">${curves}</svg>
      <ul class="custs" style="padding-top:${top}px">${rows.map(row).join('')}</ul>
    </div>
    <div class="ft">
      <span class="pbar" role="img" aria-label="Waarschijnlijk ${b.voortgang}% van de route"><i style="width:${b.voortgang}%"></i></span><b class="pct">${b.voortgang}%</b>
      <span class="stg">${h(stageText(b))}</span>
      <span class="st t-${b.toon}"><i aria-hidden="true"></i>${TONE[b.toon]}</span>
    </div>
    ${b.reden ? `<p class="why t-${b.toon}">${icon(b.toon === 'bad' ? 'warn' : 'clock')}<span>${h(cap(b.reden))}.</span></p>` : ''}
  </article>`;
}
