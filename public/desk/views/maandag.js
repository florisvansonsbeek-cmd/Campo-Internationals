// Maandag: the boxes are in the hall. Note the dollar rate for the week, count the boxes, hand them out per customer.
// The desk proposes the hand-out from what customers asked; Jan changes what he wants. Every box needs a customer: net zero.
import { api, h, icon, fNum, toast, dialog } from '../core.js';
import { spark } from '../charts.js';
import { weekNav, dLong, dayTime, zn, fKoers } from '../wk.js';

let last = null;

function rate(d) {
  const prev = d.koersen[d.koersen.length - 1];
  if (d.koers) return `<div class="koers-set"><div><span class="small muted">1 euro =</span><b>$ ${fKoers(d.koers)}</b><span class="small muted">1 dollar = € ${fKoers(1 / d.koers)}</span></div>
      <p class="small muted">Vastgezet${d.koers_door ? ` door ${h(d.koers_door)}` : ''} ${h(dayTime(d.koers_op))}. Alle pakbonnen en facturen van week ${d.week} rekenen hiermee.</p>
      <button type="button" class="btn btn-sm btn-ghost" data-act="koers-edit">${icon('edit')}Aanpassen</button></div>`;
  return `<form class="koers-f" data-form="koers">
      <label class="f">Hoeveel dollar is 1 euro deze week?<span class="koers-in"><span>1 € = $</span><input type="text" name="koers" inputmode="decimal" required placeholder="${prev ? fKoers(prev.koers) : '1,1600'}" aria-describedby="koers-hint"></span></label>
      <button class="btn btn-leaf" type="submit">${icon('check')}Vastzetten voor week ${d.week}</button>
      <p class="small muted" id="koers-hint">${prev ? `Vorige week ${fKoers(prev.koers)}. ` : ''}De desk rekent elke dollarprijs om met deze koers, de hele week.</p>
      ${d.koersen.length > 2 ? `<div class="koers-sp">${spark(d.koersen.map(k => Math.round((k.koers - Math.min(...d.koersen.map(x => x.koers))) * 10000) + 10), { w: 120, h: 30 })}<span class="small faint">${fKoers(d.koersen[0].koers)} → ${fKoers(prev.koers)}, laatste ${d.koersen.length} weken</span></div>` : ''}
    </form>`;
}

function count(d) {
  const rows = d.partijen.flatMap(p => p.regels.map(r => ({ ...r, nummer: p.nummer })));
  if (!rows.length) return '<p class="empty">Er zijn deze week geen zendingen.</p>';
  const missing = d.partijen.filter(p => !p.docsIn);
  if (d.geteld) {
    const diff = rows.filter(r => r.geteld !== (r.verzonden ?? r.bevestigd) || r.uitval);
    return `<div class="body stack" style="gap:10px"><p>${icon('check')} ${fNum(rows.reduce((s, r) => s + (r.geteld || 0), 0))} dozen geteld${d.geteld_door ? ` door ${h(d.geteld_door)}` : ''} ${h(dayTime(d.geteld_op))}.
      ${diff.length ? `Anders dan de papieren: ${diff.map(r => `${h(r.product)} ${h(r.maat)} (${h(r.nummer)}) ${r.geteld - (r.verzonden ?? r.bevestigd) ? `${r.geteld - (r.verzonden ?? r.bevestigd) > 0 ? '+' : '−'}${Math.abs(r.geteld - (r.verzonden ?? r.bevestigd))}` : ''}${r.uitval ? `, ${r.uitval} uitval` : ''}`).join('; ')}.` : 'Alles klopte met de papieren.'}</p>
      <p><button type="button" class="lnk small" data-act="uncount">Telling terugzetten</button></p></div>`;
  }
  return `<form data-form="count">
    ${missing.length ? `<div class="warnbox wait" style="margin:12px 16px 0">${icon('info')}<span>Van ${missing.map(p => h(p.nummer)).join(', ')} zijn de verzendpapieren er nog niet; daar staat het bevestigde aantal.</span></div>` : ''}
    <div class="tbwrap"><table class="tb count"><thead><tr><th>Product</th><th>Zending</th><th class="r">Verwacht</th><th class="r">Geteld</th><th class="r">Kapot</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${h(r.product)} ${h(r.maat)}</b><span class="m-zn">${zn(r.nummer)}</span></td><td>${zn(r.nummer)}</td><td class="r num">${fNum(r.verzonden ?? r.bevestigd ?? r.besteld)}</td>
      <td class="r"><input class="num-in" type="number" min="0" max="9999" name="g${r.id}" value="${r.verzonden ?? r.bevestigd ?? r.besteld ?? 0}" data-exp="${r.verzonden ?? r.bevestigd ?? r.besteld ?? 0}" aria-label="Geteld ${h(r.product)} ${h(r.maat)} ${h(r.nummer)}"></td>
      <td class="r"><input class="num-in sm" type="number" min="0" max="9999" name="u${r.id}" value="${r.uitval || 0}" aria-label="Kapot ${h(r.product)} ${h(r.maat)}"></td></tr>`).join('')}
    </tbody></table></div>
    <div class="body" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><button class="btn btn-leaf" type="submit">${icon('check')}Telling opslaan</button><span class="small muted">Alleen wat afwijkt hoef je te veranderen.</span></div>
  </form>`;
}

function handOut(d) {
  const lines = d.partijen.flatMap(p => p.regels.map(r => ({ ...r, nummer: p.nummer, regio: p.regio }))).sort((a, b) => `${a.product} ${a.maat}`.localeCompare(`${b.product} ${b.maat}`, 'nl', { numeric: true }) || a.nummer.localeCompare(b.nummer));
  if (!lines.length) return '<p class="empty">Nog niets te verdelen.</p>';
  const over = lines.filter(r => r.rest > 0), too = lines.filter(r => r.rest < 0);
  const done = new Set(d.akkoord);
  const head = too.length ? [icon('warn'), `<b>Meer verdeeld dan er is</b> bij ${too.length} ${too.length === 1 ? 'regel' : 'regels'}.`]
    : over.length ? [icon('info'), `<b>${fNum(over.reduce((s, r) => s + r.rest, 0))} dozen hebben nog geen klant.</b> Geef ze aan iemand, dan is de loods weer netto nul.`]
      : [icon('check'), '<b>Netto nul.</b> Elke doos heeft een klant.'];
  const sum_ = `<div class="nz ${too.length ? 'bad' : over.length ? 'wait' : 'ok'}">${head[0]}<div><p>${head[1]}</p>
    ${d.tekort.length ? `<p class="nz-sub">${d.tekort.length} ${d.tekort.length === 1 ? 'klant krijgt' : 'klanten krijgen'} minder dan gevraagd: ${d.tekort.slice(0, 4).map(t => `${h(t.klant)} ${t.krijgt} van ${t.gevraagd} ${h(t.product)}`).join(', ')}${d.tekort.length > 4 ? ` en nog ${d.tekort.length - 4}` : ''}. Even bellen?</p>` : ''}
    ${d.nietIn.length ? `<p class="nz-sub">Niet in deze zendingen: ${d.nietIn.map(t => `${h(t.klant)} (${t.dozen} × ${h(t.product)})`).join(', ')}.</p>` : ''}</div></div>`;
  return `${sum_}<ul class="ho">${lines.map(r => {
    const sug = d.over.find(o => o.regel_id === r.id);
    return `<li class="${r.rest < 0 ? 'is-bad' : r.rest > 0 ? 'is-over' : ''}">
      <div class="ho-h"><b>${h(r.product)} ${h(r.maat)}</b>${zn(r.nummer)}<span class="ho-n">${fNum(r.avail)} dozen${r.basis !== 'geteld' ? ` <small class="faint">(${r.basis === 'verzonden' ? 'verzendbewijs' : r.basis === 'bevestigd' ? 'bevestiging' : 'besteld'})</small>` : ''}</span>
        <span class="ho-r">${r.rest === 0 ? `<span class="chip ok">${icon('check')}0 over</span>` : r.rest > 0 ? `<span class="chip wait">${r.rest} over</span>` : `<span class="chip bad">${-r.rest} te veel</span>`}</span></div>
      <div class="ho-k">${r.verdeling.map(v => `<label class="hk${v.door !== 'desk' ? ' is-jan' : ''}${done.has(v.klant_id) ? ' is-locked' : ''}" title="${v.door === 'desk' ? 'Voorstel van de desk' : 'Door jou'}${done.has(v.klant_id) ? ' · pakbon al akkoord' : ''}"><span>${h(v.klant)}</span><input type="number" min="0" max="9999" value="${v.dozen}" data-input="v${r.id}-${v.klant_id}" data-r="${r.id}" data-k="${v.klant_id}"${done.has(v.klant_id) ? ' disabled' : ''}></label>`).join('')}
        <button type="button" class="hk-add" data-act="add-klant" data-r="${r.id}" aria-label="Klant toevoegen aan ${h(r.product)} ${h(r.maat)}">${icon('plus')}</button></div>
      ${sug && sug.suggesties.length ? `<div class="ho-s"><span class="small faint">Geef ${r.rest} aan:</span>${sug.suggesties.map(s => `<button type="button" class="btn btn-sm btn-line" data-act="give" data-r="${r.id}" data-k="${s.klant_id}" data-n="${r.rest}" title="${h(s.reden)}">${h(s.klant)} <small>${h(s.reden)}</small></button>`).join('')}</div>` : ''}
      ${r.verdeling.some(v => v.door === 'jan') ? `<button type="button" class="lnk small ho-reset" data-act="reset" data-p="${r.product_id}">Terug naar het voorstel</button>` : ''}
    </li>`;
  }).join('')}</ul>`;
}

// what goes on whose pallet: printed for the hall
function hallList(d) {
  return `<section class="print-only hall"><h1>Verdeellijst week ${d.week} · ${h(dLong(d.maandag))}</h1>
    ${d.klanten.map(k => `<div class="hall-k"><h2>${h(k.klant)} <small>${h(k.plaats || '')} · ${fNum(k.dozen)} dozen</small></h2><table>${k.regels.map(r => `<tr><td>${fNum(r.dozen)}</td><td>${h(r.product)}</td><td>${h(r.partij)}</td><td class="tick"></td></tr>`).join('')}</table></div>`).join('')}</section>`;
}

export async function render(params, query) {
  const m = query.get('maandag');
  const d = await api(`/week/maandag${m ? `?maandag=${m}` : ''}`);
  last = d;
  const early = d.vandaag < d.maandag;
  return `<div class="page wk monday">
    <div class="ph"><div><p class="kick">Week ${d.week} · ${h(dLong(d.maandag))}</p><h1>Maandag</h1>
      <p>${early ? `Nu kun je alvast kijken hoe de dozen verdeeld worden. Maandag zet je de koers vast, tel je de dozen en verdeel je wat er echt is.` : 'De dozen staan in de hal. Koers vastzetten, tellen, verdelen. Daarna de pakbonnen.'}</p></div>
      <div class="acts">${weekNav('maandag', d.maandag)}<button type="button" class="btn btn-line" data-act="print">${icon('file')}Verdeellijst printen</button></div></div>
    <ol class="mon">
      <li id="koers"><section class="panel"><header><h2><span class="n">1</span>Koers van de week</h2>${d.koers ? `<span class="chip ok">${icon('check')}vast</span>` : '<span class="chip wait">nog invullen</span>'}</header><div class="body">${rate(d)}</div></section></li>
      <li id="tellen"><section class="panel"><header><h2><span class="n">2</span>Dozen tellen</h2>${d.geteld ? `<span class="chip ok">${icon('check')}geteld</span>` : '<span class="chip wait">nog tellen</span>'}</header>${count(d)}</section></li>
      <li id="verdelen"><section class="panel"><header><h2><span class="n">3</span>Verdelen per klant</h2><span class="sub">${fNum(d.klanten.length)} klanten · voorstel uit de telefoonbestellingen</span></header><div class="body">${handOut(d)}</div></section></li>
    </ol>
    <div class="next"><b>Klaar met verdelen?</b><p>Dan staan de pakbonnen klaar: één per klant, met het plantenpaspoort. Na jouw akkoord staan ze in Outlook.</p><a class="btn btn-leaf" href="#/pakbonnen?maandag=${d.maandag}">Naar de pakbonnen</a></div>
    ${hallList(d)}
  </div>`;
}

const put = (regel_id, klant_id, dozen) => api('/week/verdeling', { method: 'PUT', body: { regel_id, klant_id, dozen } });

export function mount(ctx) {
  const f = document.querySelector('[data-form="koers"]');
  if (f) f.addEventListener('submit', async e => {
    e.preventDefault();
    const v = f.koers.value.trim();
    const prev = last.koersen[last.koersen.length - 1];
    const k = Number(v.replace(',', '.'));
    const go = async () => { await api(`/week/weken/${last.maandag}/koers`, { method: 'POST', body: { koers: v } }); toast(`Koers vastgezet: 1 € = $ ${fKoers(k)}.`); ctx.refresh(); };
    // a typo in the rate would end up on every invoice of the week: a big jump is asked once more
    if (prev && Number.isFinite(k) && Math.abs(k - prev.koers) / prev.koers > 0.05) {
      dialog({ title: 'Klopt deze koers?', ok: `Ja, ${v}`, body: `<p>1 € = $ ${h(v)} is meer dan 5% anders dan vorige week (${fKoers(prev.koers)}). Alle facturen van deze week rekenen ermee.</p>`, onOk: go });
      return;
    }
    await go().catch(x => toast(x.message));
  });
  const c = document.querySelector('[data-form="count"]');
  if (c) c.addEventListener('submit', async e => {
    e.preventDefault();
    const regels = [];
    for (const i of c.querySelectorAll('input[name^="g"]')) {
      const id = Number(i.name.slice(1)), u = c.querySelector(`input[name="u${id}"]`);
      if (Number(i.value) !== Number(i.dataset.exp) || Number(u.value)) regels.push({ id, geteld: Number(i.value), uitval: Number(u.value) || 0 });
    }
    await api(`/week/weken/${last.maandag}/tellen`, { method: 'POST', body: { regels } }).catch(x => { toast(x.message); throw x; });
    toast(regels.length ? `Geteld, ${regels.length} ${regels.length === 1 ? 'regel wijkt' : 'regels wijken'} af. De verdeling is bijgewerkt.` : 'Geteld: alles klopte met de papieren.');
    ctx.refresh();
  });
}

export async function onChange(e, ctx) {
  const el = e.target;
  if (!el.dataset.r || !el.dataset.k) return;
  const n = Math.max(0, Math.round(Number(el.value) || 0));
  await put(Number(el.dataset.r), Number(el.dataset.k), n).then(() => toast('Verdeling aangepast.')).catch(x => toast(x.message));
  ctx.refresh();
}

export const actions = {
  print: () => { window.print(); },
  'koers-edit': (el, ctx) => dialog({
    title: `Koers week ${last.week}`, ok: 'Opslaan',
    body: `<label class="f">1 euro = hoeveel dollar<input name="koers" value="${fKoers(last.koers)}" inputmode="decimal"></label><p class="small faint" style="margin-top:8px">Pakbonnen die al akkoord zijn houden hun koers. Heropen ze als die mee moeten.</p>`,
    onOk: async v => { await api(`/week/weken/${last.maandag}/koers`, { method: 'POST', body: { koers: v.koers } }); toast('Koers aangepast.'); ctx.refresh(); },
  }),
  uncount: async (el, ctx) => { await api(`/week/weken/${last.maandag}/telling-terug`, { method: 'POST', body: {} }); toast('Telling teruggezet.'); ctx.refresh(); },
  give: async (el, ctx) => {
    const r = last.partijen.flatMap(p => p.regels).find(x => x.id === Number(el.dataset.r));
    const cur = r.verdeling.find(v => v.klant_id === Number(el.dataset.k));
    await put(r.id, Number(el.dataset.k), (cur ? cur.dozen : 0) + Number(el.dataset.n));
    toast('Gegeven.'); ctx.refresh();
  },
  reset: async (el, ctx) => { await api(`/week/weken/${last.maandag}/voorstel`, { method: 'POST', body: { product_id: Number(el.dataset.p) } }); toast('Terug naar het voorstel.'); ctx.refresh(); },
  'add-klant': async (el, ctx) => {
    const r = last.partijen.flatMap(p => p.regels).find(x => x.id === Number(el.dataset.r));
    const all = await api('/week/klanten');
    dialog({
      title: `${r.product} ${r.maat} · aan een klant`, ok: 'Toevoegen',
      body: `<div class="form"><label class="f wide">Klant<input name="klant" list="kl-all" required></label><label class="f">Dozen<input type="number" name="dozen" min="1" value="${Math.max(1, r.rest)}"></label></div>
        <datalist id="kl-all">${all.lijst.map(k => `<option value="${h(k.naam)}">`).join('')}</datalist>`,
      onOk: async v => {
        const k = all.lijst.find(x => x.naam.toLowerCase() === String(v.klant).trim().toLowerCase());
        if (!k) throw new Error('Kies een klant uit de lijst.');
        const cur = r.verdeling.find(x => x.klant_id === k.id);
        await put(r.id, k.id, (cur ? cur.dozen : 0) + Number(v.dozen));
        toast('Toegevoegd.'); ctx.refresh();
      },
    });
  },
};
