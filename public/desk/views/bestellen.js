// Bestellen (Tuesday): what customers asked on the phone, added up per product, and the order per supplier.
// Jan sends the order himself; when he has, one click makes the shipments with their batch numbers.
import { api, h, icon, fNum, toast, copy } from '../core.js';
import { weekNav, dLong, dayTime, zn, regio, stageChip, spanishLine } from '../wk.js';

let last = null;

function entry(d) {
  const opts = d.producten.map(p => `<option value="${p.id}">${h(p.naam)} ${h(p.maat)}</option>`).join('');
  return `<form class="phone" data-form="order" autocomplete="off">
    <label class="f">Klant<input type="text" name="klant" list="klantlijst" placeholder="Typ een naam" required></label>
    <label class="f">Product<select name="product_id">${opts}</select></label>
    <label class="f">Dozen<input type="number" name="dozen" min="1" max="9999" step="1" inputmode="numeric" required></label>
    <button class="btn btn-leaf" type="submit">${icon('plus')}Noteren</button>
    <datalist id="klantlijst">${d.alleKlanten.map(k => `<option value="${h(k.naam)}">${h(k.plaats)}, ${h(k.land)}</option>`).join('')}</datalist>
  </form>`;
}

function customers(d) {
  if (!d.klanten.length) return '<p class="empty">Nog niemand heeft gebeld voor deze week.</p>';
  return `<ul class="calls-l">${d.klanten.map(k => `<li>
      <div class="calls-k"><a href="#/klant/${k.klant_id}"><b>${h(k.klant)}</b></a><small>${h(k.land)} · ${fNum(k.regels.reduce((s, r) => s + r.dozen, 0))} dozen</small></div>
      <div class="calls-r">${k.regels.map(r => `<span class="ol">
          <span>${h(r.product)} ${h(r.maat)}</span>
          <input type="number" min="0" max="9999" value="${r.dozen}" aria-label="Dozen ${h(r.product)} ${h(r.maat)} voor ${h(k.klant)}" data-act="order-set" data-k="${k.klant_id}" data-p="${r.product_id}">
          <button type="button" class="x" data-act="order-del" data-k="${k.klant_id}" data-p="${r.product_id}" aria-label="Weghalen">×</button>
        </span>`).join('')}</div>
    </li>`).join('')}</ul>`;
}

// per supplier: what to order, ready to copy into a mail
function suppliers(d) {
  const lines = d.producten.filter(p => p.gevraagd > 0 || p.besteld.length);
  if (!lines.length) return '<p class="empty">Er is nog niets te bestellen.</p>';
  const bySup = new Map();
  for (const p of lines) {
    const placed = p.besteld[0];
    const lid = placed ? placed.leverancier_id : p.leverancier_id;
    if (!bySup.has(lid)) bySup.set(lid, []);
    bySup.get(lid).push({ ...p, te: placed ? p.besteld.reduce((s, b) => s + (b.besteld || 0), 0) : p.gevraagd });
  }
  return [...bySup.entries()].map(([lid, ps]) => {
    const l = d.leveranciers.find(x => x.id === lid) || { naam: '?', regio: '' };
    const partij = d.partijen.find(x => x.leverancier_id === lid);
    return `<section class="sup" data-lev="${lid}">
      <header><b>${h(l.naam)}</b> ${regio(l.regio)}${partij ? ` ${zn(partij.nummer)} ${stageChip(partij.stage)}` : ` <span class="faint small">wordt ${h(d.volgendNummer[l.regio] || '')}</span>`}</header>
      <table class="tb sup-t"><thead><tr><th>Product</th><th class="r">Gevraagd</th><th class="r">Bestellen</th></tr></thead><tbody>
        ${ps.map(p => `<tr><td>${h(p.naam)} ${h(p.maat)}${p.leveranciers.length > 1 && !partij ? ` <select class="mini" data-act="order-lev" data-p="${p.id}" aria-label="Leverancier voor ${h(p.naam)} ${h(p.maat)}">${p.leveranciers.map(x => `<option value="${x}"${x === lid ? ' selected' : ''}>${h(d.leveranciers.find(y => y.id === x)?.naam || x)}</option>`).join('')}</select>` : ''}</td>
          <td class="r num">${fNum(p.gevraagd)}</td><td class="r"><input class="num-in" type="number" min="0" max="9999" value="${p.te}" data-plan="${p.id}" data-lev="${lid}" aria-label="Te bestellen ${h(p.naam)} ${h(p.maat)}"></td></tr>`).join('')}
      </tbody></table>
      <p class="sup-a"><button type="button" class="btn btn-sm btn-line" data-act="order-copy" data-lev="${lid}">${icon('copy')}Kopieer de bestelling</button>${l.email ? `<a class="btn btn-sm btn-ghost" href="mailto:${h(l.email)}?subject=${encodeURIComponent(`Pedido semana ${d.week} - Campo International`)}&body=${encodeURIComponent(orderText(d, l, ps))}">${icon('mail')}Mail</a>` : ''}</p>
    </section>`;
  }).join('');
}

function orderText(d, l, ps) {
  const first = (l.contact || '').split(' ')[0];
  const dag = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${d.maandag}T12:00:00`));
  return `Hola${first ? ` ${first}` : ''},\n\nPara la semana ${d.week} (llegada ${dag}) quisiera pedir:\n\n${ps.filter(p => p.te > 0).map(p => `${String(p.te).padStart(4)} cajas  ${spanishLine(p)}`).join('\n')}\n\nPor favor confirmen cantidades y vuelo.\n\nSaludos,\nJan\nCampo International`;
}

function regulars(d) {
  if (!d.nogNiet.length) return '';
  return `<section class="panel"><header><h2>Belt meestal, nog niet gehoord</h2><span class="sub">bestelde 4 van de laatste 8 weken</span></header>
    <ul class="reg">${d.nogNiet.slice(0, 12).map(k => `<li>
      <div><a href="#/klant/${k.id}"><b>${h(k.naam)}</b></a><small>${h(k.plaats)}, ${h(k.land)} · ${k.weken} van 8 weken</small>
        <small class="faint">Vorige keer: ${k.vorige.map(v => `${v.dozen} × ${h(v.product?.naam || '')} ${h(v.product?.maat || '')}`).join(', ') || '–'}</small></div>
      <div class="reg-a">${k.telefoon ? `<a class="btn btn-sm btn-ghost" href="tel:${h(String(k.telefoon).replace(/\s/g, ''))}">${icon('phone')}<span class="sr">Bel </span>${h(k.telefoon)}</a>` : ''}
        <button type="button" class="btn btn-sm btn-line" data-act="order-again" data-k="${k.id}">Zelfde als vorige keer</button></div>
    </li>`).join('')}</ul></section>`;
}

export async function render(params, query) {
  const m = query.get('maandag');
  const d = await api(`/week/bestellen${m ? `?maandag=${m}` : ''}`);
  last = d;
  const placed = d.partijen.filter(p => p.besteld_op);
  const due = d.vandaag > d.bestellen ? `Bestellen was op ${dLong(d.bestellen)}.` : d.vandaag === d.bestellen ? 'Vandaag bestellen.' : `Bestellen op ${dLong(d.bestellen)}.`;
  return `<div class="page wk">
    <div class="ph"><div><p class="kick">Week ${d.week} · binnen ${h(dLong(d.maandag))}</p><h1>Bestellen</h1>
      <p>Wat klanten aan de telefoon vroegen, opgeteld per product. ${h(due)}</p></div>
      <div class="acts">${weekNav('bestellen', d.maandag)}</div></div>
    <div class="grid2">
      <div class="stack">
        <section class="panel"><header><h2>Telefoon</h2><span class="sub">${fNum(d.totaal.klanten)} klanten · ${fNum(d.totaal.dozen)} dozen</span></header>
          <div class="body">${entry(d)}</div>${customers(d)}</section>
        ${regulars(d)}
      </div>
      <aside class="stack">
        <section class="panel"><header><h2>Bestelling per leverancier</h2><span class="sub">${placed.length ? `besteld ${h(dayTime(placed[0].besteld_op))}` : 'nog niet besteld'}</span></header>
          <div class="body stack">${suppliers(d)}
            <div class="next" style="margin:0"><b>${placed.length ? 'Bestelling aangepast?' : 'Besteld bij de leveranciers?'}</b>
              <p>${placed.length ? 'Zet de nieuwe aantallen in de zendingen.' : 'Dan maakt de desk per leverancier een zending met een eigen zendnummer. Dat nummer gaat mee tot op het plantenpaspoort.'}</p>
              <button type="button" class="btn btn-leaf" data-act="order-place">${icon('check')}${placed.length ? 'Aantallen bijwerken' : 'Ik heb besteld'}</button></div>
          </div></section>
        ${placed.length ? `<section class="panel"><header><h2>Zendingen</h2></header><ul class="ships">${placed.map(p => `<li><a href="#/inkoop?maandag=${d.maandag}&p=${p.id}">${zn(p.nummer)}</a><span class="ships-b"><b>${h(p.leverancier)}</b><small>${regio(p.regio)} ${fNum(p.regels.reduce((s, r) => s + (r.besteld || 0), 0))} dozen besteld</small></span><span class="ships-s">${stageChip(p.stage)}</span></li>`).join('')}</ul></section>` : ''}
      </aside>
    </div>
  </div>`;
}

const klantId = naam => { const n = String(naam || '').trim().toLowerCase(); const k = last.alleKlanten.find(x => x.naam.toLowerCase() === n) || last.alleKlanten.filter(x => x.naam.toLowerCase().includes(n)); return Array.isArray(k) ? (k.length === 1 ? k[0].id : null) : k.id; };
function plan() {
  return [...document.querySelectorAll('[data-plan]')].map(i => ({ product_id: Number(i.dataset.plan), leverancier_id: Number(i.closest('tr')?.querySelector('[data-act="order-lev"]')?.value || i.dataset.lev), dozen: Number(i.value) }));
}

export const actions = {
  'order-del': async (el, ctx) => { await api('/week/bestellen/regel', { method: 'POST', body: { maandag: last.maandag, klant_id: Number(el.dataset.k), product_id: Number(el.dataset.p), dozen: 0 } }); toast('Weggehaald.'); ctx.refresh(); },
  'order-again': async (el, ctx) => { el.disabled = true; const r = await api('/week/bestellen/vorige', { method: 'POST', body: { maandag: last.maandag, klant_id: Number(el.dataset.k) } }); toast(`${r.regels} ${r.regels === 1 ? 'regel' : 'regels'} genoteerd, zoals vorige keer.`); ctx.refresh(); },
  'order-copy': async el => {
    const lid = Number(el.dataset.lev), l = last.leveranciers.find(x => x.id === lid);
    const ps = plan().filter(x => x.leverancier_id === lid && x.dozen > 0).map(x => ({ ...last.producten.find(p => p.id === x.product_id), te: x.dozen }));
    await copy(orderText(last, l, ps));
  },
  'order-place': async (el, ctx) => {
    const items = plan().filter(x => x.dozen > 0);
    if (!items.length) { toast('Er staat nog niets om te bestellen.'); return; }
    el.disabled = true;
    const r = await api('/week/bestellen/plaatsen', { method: 'POST', body: { maandag: last.maandag, regels: items } });
    toast(`Zendingen: ${r.partijen.map(p => p.nummer).join(', ')}.`);
    ctx.refresh();
  },
};

export function mount(ctx) {
  const f = document.querySelector('[data-form="order"]');
  if (f) f.addEventListener('submit', async e => {
    e.preventDefault();
    const k = klantId(f.klant.value);
    if (!k) { toast('Kies een klant uit de lijst.'); f.klant.focus(); return; }
    await api('/week/bestellen/regel', { method: 'POST', body: { maandag: last.maandag, klant_id: k, product_id: Number(f.product_id.value), dozen: Number(f.dozen.value) } }).catch(x => { toast(x.message); throw x; });
    toast(`Genoteerd: ${f.dozen.value} dozen voor ${f.klant.value}.`);
    await ctx.refresh();
    const again = document.querySelector('[data-form="order"] input[name="klant"]'); if (again) again.focus();
  });
}
export async function onChange(e, ctx) {
  const el = e.target;
  if (el.matches('[data-act="order-set"]')) {
    await api('/week/bestellen/regel', { method: 'POST', body: { maandag: last.maandag, klant_id: Number(el.dataset.k), product_id: Number(el.dataset.p), dozen: Math.max(0, Number(el.value) || 0) } }).catch(x => toast(x.message));
    ctx.refresh();
  }
}
