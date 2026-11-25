// One invoice from one grower, as a workflow: read, check, link to customers, share out the rest, tell customers.
import { api, h, icon, fTime, fNum, fEur, fPrice, fDate, dayWord, rel, plural, stapChip, kanaalIcon, kanaalNaam, toast, dialog, field, waLink, mailLink, copy, LANG, sum } from '../core.js';

let plantCache = null, klantCache = null;
const plants = async () => (plantCache ||= await api('/planten'));
const klanten = async () => (klantCache ||= await api('/klanten'));
const STEPS = [['gelezen', 'Gelezen'], ['nakijken', 'Nagekeken'], ['koppelen', 'Gekoppeld'], ['rest', 'Rest verdeeld'], ['informeren', 'Klanten ingelicht'], ['klaar', 'Klaar']];
const IDX = { nakijken: 1, koppelen: 2, rest: 3, informeren: 4, klaar: 6 };
const plantName = r => (r.plant ? `${r.plant}${r.potmaat || r.hoogte ? ` ${[r.potmaat, r.hoogte].filter(Boolean).join(' ')}` : ''}` : 'Niet herkend');
const conf = v => (v == null ? '' : `<span class="conf ${v < 75 ? 'lo' : v < 90 ? 'mid' : 'hi'}">${v}% zeker</span>`);

function steps(stap) {
  const i = IDX[stap] ?? 1;
  return `<ol class="steps">${STEPS.map(([, label], k) => `<li class="${k < i ? 'done' : k === i ? 'now' : ''}"${k === i ? ' aria-current="step"' : ''}>${h(label)}</li>`).join('')}</ol>`;
}

function nextBox(d) {
  const s = d.stap.stap;
  const msgs = d.berichten.filter(b => b.status === 'concept').length;
  const map = {
    nakijken: ['Kijk de gemarkeerde regels na', 'De desk twijfelt welke plant er bedoeld wordt. Kies de juiste; de desk onthoudt het voor deze kweker.', '<a class="btn btn-leaf" href="#lezen">Naar de regels</a>'],
    koppelen: ['Klopt de verdeling?', `De desk koppelde ${plural(d.stap.voorstel, 'stuk', 'stuks')} aan open bestellingen van klanten. Loop het na en bevestig.`, '<button class="btn btn-leaf" data-act="bevestig">Koppeling bevestigen</button>'],
    rest: ['Verdeel wat over is', `${plural(d.stap.rest, 'stuk heeft', 'stuks hebben')} nog geen bestemming. Bied het aan, zet het op voorraad of stuur het terug.`, '<a class="btn btn-leaf" href="#rest">Naar de rest</a>'],
    informeren: ['Laat de klanten weten wat er komt', msgs ? `${plural(msgs, 'bericht staat', 'berichten staan')} klaar. Stuur ze via WhatsApp of mail en vink ze af.` : 'Zet per klant een bericht klaar, in de eigen taal van de klant.', msgs ? '<a class="btn btn-leaf" href="#berichten">Naar de berichten</a>' : '<button class="btn btn-leaf" data-act="berichten">Berichten klaarzetten</button>'],
    klaar: ['Alles heeft een plek', 'Iedere plant van deze factuur gaat naar een klant, de voorraad of terug, en de klanten weten het.', d.factuur.afgerond ? '<button class="btn btn-leaf" data-act="heropen">Heropenen</button>' : '<button class="btn btn-leaf" data-act="afronden">Afronden</button>'],
  }[s];
  if (!map) return '';
  return `<div class="next">${icon(s === 'klaar' ? 'check' : 'info')}<b>${h(map[0])}</b><p>${h(map[1])}</p>${map[2]}</div>`;
}

function original(f) {
  if (f.bestand_id && /pdf/.test(f.bestand_mime || '')) return `<iframe src="/api/bestanden/${f.bestand_id}#view=FitH" title="Origineel: ${h(f.bestand_naam)}"></iframe><a class="lnk small" href="/api/bestanden/${f.bestand_id}" target="_blank" rel="noopener">${icon('out')}Open ${h(f.bestand_naam)} los</a>`;
  if (f.bestand_id && /^image\//.test(f.bestand_mime || '')) return `<img src="/api/bestanden/${f.bestand_id}" alt="Foto van de factuur">`;
  if (f.kanaal === 'whatsapp' || f.kanaal === 'plakken') return `<div class="bubble">${h(f.bericht_tekst || '')}</div><p class="faint small">${kanaalNaam(f.kanaal)} van ${h(f.van_naam || f.van || '')}, ${fDate(f.ontvangen)} ${fTime(f.ontvangen)}</p>`;
  if (f.bericht_tekst) return `<div class="mailtxt">${h(f.bericht_tekst)}</div>`;
  return '<p class="faint">Het origineel is niet bewaard (demo-geschiedenis of handmatig ingevoerd).</p>';
}

async function linesTable(d) {
  const doubt = d.regels.some(r => !r.plant_id || (r.match_zekerheid ?? 100) < 75) && !d.factuur.nagekeken;
  const ps = doubt ? await plants() : [];
  const opts = sel => `<option value="">Kies de plant…</option>${ps.map(p => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${h(`${p.naam} ${[p.potmaat, p.hoogte].filter(Boolean).join(' ')}`)}</option>`).join('')}`;
  const total = sum(d.regels, r => r.bedrag);
  return `<div class="tbwrap"><table class="tb"><thead><tr><th>Op de factuur</th><th>Herkend als</th><th class="r">Aantal</th><th class="r">Prijs</th><th class="r">Bedrag</th></tr></thead><tbody>
    ${d.regels.map(r => {
      const isDoubt = !r.plant_id || (r.match_zekerheid ?? 100) < 75;
      const priceOff = r.afgesproken && r.prijs > r.afgesproken * 1.005;
      const short = r.besteld && r.aantal < r.besteld;
      return `<tr class="${isDoubt && !d.factuur.nagekeken ? 'doubt' : ''}">
        <td><b>${h(r.omschrijving)}</b>${r.klant_ref ? `<div class="as">Ref. ${h(r.klant_ref)}</div>` : ''}</td>
        <td>${isDoubt && !d.factuur.nagekeken ? `<select data-doubt="${r.id}" aria-label="Plant voor regel ${r.regelnr}">${opts(r.plant_id)}</select><div class="as">${r.plant_id ? `Beste gok: ${h(plantName(r))}. ` : ''}${conf(r.match_zekerheid)}</div>` : `${h(plantName(r))}<div class="as">${conf(r.match_zekerheid)}</div>`}</td>
        <td class="r num">${fNum(r.aantal)}${short ? `<div class="as" style="color:var(--warn)">besteld ${fNum(r.besteld)}</div>` : ''}</td>
        <td class="r num">${fPrice(r.prijs)}${priceOff ? `<div class="as" style="color:var(--warn)">afgesproken ${fPrice(r.afgesproken)}</div>` : ''}</td>
        <td class="r num">${fEur(r.bedrag, 2)}</td></tr>`;
    }).join('')}
    <tr><td colspan="4" class="r muted">Totaal excl. btw${d.factuur.totaal && Math.abs(d.factuur.totaal - total) > 1 ? ` (factuur zegt ${fEur(d.factuur.totaal, 2)})` : ''}</td><td class="r num"><b>${fEur(total, 2)}</b></td></tr>
  </tbody></table></div>
  ${doubt ? '<p style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn btn-leaf" data-act="nagekeken">Klopt zo, onthoud het</button><span class="faint small">De gekozen plant geldt voortaan voor deze omschrijving van deze kweker.</span></p>' : ''}`;
}

// the distribution as a branching stem: grower -> Campo -> customers
function tree(d) {
  const per = new Map();
  let stock = 0, retour = 0;
  for (const r of d.regels) for (const t of r.toewijzingen) {
    if (t.bestemming === 'voorraad') { stock += t.aantal; continue; }
    if (t.bestemming === 'retour') { retour += t.aantal; continue; }
    const k = per.get(t.klant_id) || { naam: t.klant, plaats: t.plaats, stuks: 0, soorten: new Set(), status: new Set(), soort: new Set() };
    k.stuks += t.aantal; k.soorten.add(r.plant_id); k.status.add(t.status); k.soort.add(t.soort); per.set(t.klant_id, k);
  }
  const rest = sum(d.regels, r => r.rest);
  const nodes = [...per.entries()].sort((a, b) => b[1].stuks - a[1].stuks).map(([id, k]) => ({ id, ...k, kind: k.status.has('voorstel') ? 'prop' : k.soort.has('aanbod') && k.soort.size === 1 ? 'offer' : 'ok' }));
  if (stock) nodes.push({ naam: 'Voorraad', plaats: 'koelcel Nootdorp', stuks: stock, kind: 'stock', soorten: new Set() });
  if (retour) nodes.push({ naam: 'Retour', plaats: 'terug naar de kweker', stuks: retour, kind: 'stock', soorten: new Set() });
  if (rest) nodes.push({ naam: 'Nog niet verdeeld', plaats: 'kies een bestemming', stuks: rest, kind: 'rest', soorten: new Set() });
  const total = sum(d.regels, r => r.aantal) || 1;
  const narrow = window.innerWidth < 640;
  const W = narrow ? 400 : 760, rowH = 46, H = Math.max(150, nodes.length * rowH + 30);
  const gx = narrow ? 12 : 26, cx = narrow ? 120 : 300, nx = narrow ? 214 : 470, cy = H / 2;
  const cut = (t, n) => (narrow && String(t).length > n ? String(t).slice(0, n - 1) + '…' : t);
  nodes.forEach(n => { n.naam = cut(n.naam, 22); n.plaats = narrow ? '' : n.plaats; });
  const z = d.zending;
  const col = { ok: 'var(--leaf)', prop: 'var(--s2)', offer: 'var(--s3)', stock: 'var(--brass)', rest: 'var(--wait)' };
  let s = `<svg class="tree" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verdeling: ${h(nodes.map(n => `${n.naam} ${n.stuks}`).join(', '))}">`;
  s += `<path d="M${gx + 8},${cy} C${gx + 110},${cy} ${cx - 110},${cy} ${cx - 8},${cy}" fill="none" stroke="var(--leaf)" stroke-width="6" stroke-linecap="round"/>`;
  nodes.forEach((n, i) => {
    const y = 15 + rowH / 2 + i * rowH;
    const w = Math.max(1.5, Math.min(7, 7 * n.stuks / total + 1));
    const dash = n.kind === 'prop' || n.kind === 'rest' ? ' stroke-dasharray="6 5"' : '';
    s += `<path d="M${cx + 8},${cy} C${cx + 90},${cy} ${nx - 100},${y} ${nx - 8},${y}" fill="none" stroke="${col[n.kind]}" stroke-width="${w.toFixed(1)}" stroke-linecap="round"${dash}/>`;
    s += `<circle cx="${nx}" cy="${y}" r="6" fill="${n.kind === 'rest' ? 'var(--sheet)' : col[n.kind]}" stroke="${n.kind === 'rest' ? col.rest : 'var(--sheet)'}" stroke-width="2"/>`;
    s += `<text class="t-name" x="${nx + 14}" y="${y - 2}">${h(n.naam)}</text><text class="t-sub" x="${nx + 14}" y="${y + 13}">${h(`${fNum(n.stuks)} stuks${n.soorten.size ? `, ${n.soorten.size} ${n.soorten.size === 1 ? 'soort' : 'soorten'}` : ''}${n.plaats ? ' · ' + n.plaats : ''}${n.kind === 'prop' ? ' · voorstel' : n.kind === 'offer' ? ' · aanbod' : ''}`)}</text>`;
  });
  s += `<circle cx="${gx}" cy="${cy}" r="8" fill="var(--leaf)" stroke="var(--sheet)" stroke-width="2"/><text class="t-name" x="${gx - (narrow ? 4 : 6)}" y="${cy - 18}">${h(cut(d.factuur.kweker, 14))}</text><text class="t-sub" x="${gx - (narrow ? 4 : 6)}" y="${cy + 26}">${h(narrow ? '' : d.factuur.kweker_plaats || '')}</text>`;
  s += `<circle cx="${cx}" cy="${cy}" r="9" fill="var(--forest)" stroke="var(--sheet)" stroke-width="2"/><text class="t-name" x="${cx}" y="${cy - 20}" text-anchor="middle">${narrow ? 'Campo' : 'Campo, Nootdorp'}</text>`;
  if (z) s += `<text class="t-big" x="${cx}" y="${cy + 30}" text-anchor="middle">${z.state === 'binnen' ? `binnen ${fTime(z.aankomst_werkelijk)}` : `${dayWord(z.eta) !== 'vandaag' ? dayWord(z.eta) + ' ' : ''}${fTime(z.eta)}`}</text>`;
  s += '</svg>';
  const legend = `<p class="legend"><span><i style="background:var(--leaf)"></i>Bevestigd</span><span><i style="background:var(--s2)"></i>Voorstel van de desk</span><span><i style="background:var(--s3)"></i>Aanbod</span><span><i style="background:var(--brass)"></i>Voorraad of retour</span>${rest ? '<span><i style="background:var(--wait)"></i>Nog niet verdeeld</span>' : ''}</p>`;
  return legend + s;
}

function allocTable(d) {
  return `<div class="tbwrap"><table class="tb"><thead><tr><th>Regel</th><th>Gaat naar</th><th></th></tr></thead><tbody>${d.regels.map(r => `
    <tr><td style="min-width:200px"><b class="num">${fNum(r.aantal)}</b> × ${h(plantName(r))}<div class="as">${h(r.omschrijving)}</div></td>
    <td><div class="allocs">${r.toewijzingen.map(t => {
      const cls = t.status === 'voorstel' ? 'prop' : t.bestemming !== 'klant' ? 'stock' : t.soort === 'aanbod' ? 'offer' : 'ok';
      const label = t.bestemming === 'voorraad' ? 'Voorraad' : t.bestemming === 'retour' ? 'Retour' : t.klant;
      return `<span class="al ${cls}" title="${h(t.reden || '')}">${t.bestemming === 'klant' ? `<a href="#/klant/${t.klant_id}" style="color:inherit;text-decoration:none">${h(label)}</a>` : h(label)} <b>${fNum(t.aantal)}</b>${t.soort === 'aanbod' ? ' <span class="faint">aanbod</span>' : ''}${t.status === 'voorstel' ? ' <span class="faint">voorstel</span>' : ''}${t.status === 'geleverd' ? ' ✓' : `<button class="x" data-act="weg" data-id="${t.id}" aria-label="Haal ${h(label)} weg">×</button>`}</span>`;
    }).join('')}${r.rest > 0 ? `<span class="al rest">Over: ${fNum(r.rest)}</span>` : ''}</div>
    ${r.toewijzingen.filter(t => t.status === 'voorstel').map(t => `<div class="why">${h(t.klant)}: ${h(t.reden || '')}</div>`).join('')}</td>
    <td class="r"><button class="btn btn-sm btn-line" data-act="toewijzen" data-regel="${r.id}" data-rest="${r.rest}" ${r.plant_id ? '' : 'disabled title="Kies eerst de plant"'}>${icon('plus')}Toewijzen</button></td></tr>`).join('')}
  </tbody></table></div>`;
}

function restBlock(d) {
  const lines = d.regels.filter(r => r.rest > 0 && d.rest[r.id]);
  if (!lines.length) return '';
  return `<section class="panel" id="rest"><header><h2>Rest verdelen</h2><span class="sub">Wie wil dit waarschijnlijk hebben: op koopgedrag, ritme, kleur en of er vandaag al een wagen naartoe gaat</span></header><div class="body stack">
    ${lines.map(r => {
      const s = d.rest[r.id];
      return `<div><h3 style="font-size:15.5px;margin-bottom:8px">${fNum(r.rest)} × ${h(plantName(r))} <span class="faint" style="font-weight:400">over van ${fNum(r.aantal)}</span></h3>
        ${s.klanten.length ? `<ol class="sugg">${s.klanten.map(k => `<li>
          <div class="score"><b class="num">${k.score}</b><i><span style="width:${k.score}%"></span></i></div>
          <div><h4><a href="#/klant/${k.klant_id}" style="color:var(--ink);text-decoration:none">${h(k.klant)}</a> <span class="faint" style="font-weight:400">${h(k.plaats)}, ${h(k.land)}</span></h4><ul>${k.redenen.map(x => `<li>${h(x)}</li>`).join('')}</ul></div>
          <div class="go"><label class="small faint">Aantal <input type="number" min="1" max="${r.rest}" step="${r.per_laag || 1}" value="${Math.min(r.rest, k.aantal)}" data-n="${r.id}-${k.klant_id}"></label><label class="small faint">Prijs <input type="number" min="0" step="0.01" value="${k.prijs}" data-p="${r.id}-${k.klant_id}"></label><button class="btn btn-sm btn-leaf" data-act="bied" data-regel="${r.id}" data-klant="${k.klant_id}">Bied aan</button></div>
        </li>`).join('')}</ol>` : '<p class="faint">Geen klant die dit de afgelopen tijd kocht.</p>'}
        <p style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn btn-sm btn-line" data-act="voorraad" data-regel="${r.id}" data-n="${r.rest}">${icon('stock')}Alles op voorraad${s.voorraad.dagen ? ` <span class="faint" style="font-weight:400">(gaat er gemiddeld in ${plural(s.voorraad.dagen, 'dag', 'dagen')} uit)</span>` : ''}</button>
          <button class="btn btn-sm btn-ghost" data-act="retour" data-regel="${r.id}" data-n="${r.rest}">Terug naar de kweker</button>
        </p></div>`;
    }).join('<hr style="border:0;border-top:1px solid var(--line);margin:4px 0">')}
  </div></section>`;
}

function messagesBlock(d) {
  const confirmed = new Set(d.regels.flatMap(r => r.toewijzingen.filter(t => t.bestemming === 'klant' && t.status !== 'voorstel').map(t => t.klant_id)));
  if (!confirmed.size && !d.berichten.length) return '';
  const byK = Object.fromEntries(d.klanten.map(k => [k.id, k]));
  const missing = [...confirmed].filter(id => !d.berichten.some(b => b.klant_id === id));
  return `<section class="panel" id="berichten"><header><h2>Klanten informeren</h2><span class="sub">Per klant een bericht in de eigen taal. Jij leest het na en stuurt het; de desk stuurt zelf niets.</span></header><div class="body">
    ${missing.length ? `<p style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn btn-leaf" data-act="berichten">${d.berichten.length ? 'Ontbrekende berichten klaarzetten' : 'Berichten klaarzetten'}</button><span class="faint small">${plural(missing.length, 'klant heeft', 'klanten hebben')} nog geen bericht.</span></p>` : ''}
    <div class="msgs">${d.berichten.map(b => {
      const k = byK[b.klant_id] || {};
      const wa = b.kanaal === 'whatsapp' && k.whatsapp ? waLink(k.whatsapp, b.tekst) : null;
      const ml = k.email ? mailLink(k.email, b.onderwerp, b.tekst) : null;
      return b.status === 'verstuurd'
        ? `<div class="msg sent"><header><b>${h(k.naam || '')}</b><span class="chip ok">${icon('check')}Verstuurd ${fDate(b.verstuurd_op)} ${fTime(b.verstuurd_op)} via ${kanaalNaam(b.kanaal)}</span></header><pre>${h(b.tekst)}</pre></div>`
        : `<div class="msg"><header><b>${h(k.naam || '')} <span class="faint" style="font-weight:400">${h(k.plaats || '')} · ${h(LANG[b.taal] || b.taal)} · liefst via ${kanaalNaam(b.kanaal)}</span></b>${b.soort === 'aanbod' ? '<span class="chip brass">Aanbod</span>' : ''}</header>
          <textarea data-msg="${b.id}" aria-label="Bericht aan ${h(k.naam || '')}">${h(b.tekst)}</textarea>
          <div class="acts">
            ${wa ? `<a class="btn btn-sm btn-leaf" href="${h(wa)}" target="_blank" rel="noopener" data-act="open-wa" data-id="${b.id}">${icon('chat')}Open in WhatsApp</a>` : ''}
            ${ml ? `<a class="btn btn-sm ${wa ? 'btn-line' : 'btn-leaf'}" href="${h(ml)}" data-act="open-mail" data-id="${b.id}">${icon('mail')}Open in mail</a>` : ''}
            <button class="btn btn-sm btn-line" data-act="kopieer" data-id="${b.id}">${icon('copy')}Kopieer</button>
            <button class="btn btn-sm btn-ghost" data-act="verstuurd" data-id="${b.id}">${icon('check')}Is verstuurd</button>
          </div></div>`;
    }).join('')}</div></div></section>`;
}

function routeBlock(d) {
  const z = d.zending;
  if (!z) return `<section class="panel"><header><h2>Route en tijden</h2></header><p class="empty">Geen wagen gepland voor deze factuur (de goederen zijn er al, of de tijd is onbekend).</p></section>`;
  const st = { binnen: 'Binnen', onderweg: 'Onderweg', laden: 'Wordt geladen', gepland: 'Gepland' }[z.state];
  return `<section class="panel"><header><h2>Route en tijden</h2><span class="chip ${z.state === 'binnen' ? 'ok' : z.delay >= 15 ? 'wait' : 'info'}">${st}</span></header><div class="body">
    <dl class="kv"><dt>Vertrek kweker</dt><dd>${z.vertrek_werkelijk ? `${fTime(z.vertrek_werkelijk)} ${dayWord(z.vertrek_werkelijk)}` : z.vertrek_gepland ? `gepland ${fTime(z.vertrek_gepland)} ${dayWord(z.vertrek_gepland)}` : '–'}</dd>
    <dt>Aankomst Nootdorp</dt><dd>${z.aankomst_werkelijk ? `<b>${fTime(z.aankomst_werkelijk)}</b> ${dayWord(z.aankomst_werkelijk)}` : `verwacht <b>${fTime(z.eta)}</b> ${dayWord(z.eta)} (${rel(z.eta)})`}${Math.abs(z.delay) >= 10 ? `, gepland ${fTime(z.aankomst_gepland)}` : ''}</dd>
    ${z.vervoerder ? `<dt>Vervoer</dt><dd>${h(z.vervoerder)}${z.karren ? `, ${String(z.karren).replace('.', ',')} karren` : ''}</dd>` : ''}</dl>
    <ul class="feed" style="margin-top:14px">${z.gebeurtenissen.slice().reverse().map(e => `<li><time>${fTime(e.tijd)}</time><span>${h(e.tekst || e.soort)}<br><span class="src">${h({ whatsapp: 'WhatsApp', mail: 'Mail', jan: 'Door Jan', vervoerder: 'Vervoerder', ai: 'Desk', demo: 'Demo' }[e.bron] || e.bron)}</span></span></li>`).join('') || '<li><time></time><span class="faint">Nog niets gehoord.</span></li>'}</ul>
    ${z.state !== 'binnen' ? `<p style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn btn-sm btn-leaf" data-act="z-binnen" data-id="${z.id}">${icon('check')}Is binnen</button><button class="btn btn-sm btn-line" data-act="z-eta" data-id="${z.id}">Nieuwe tijd</button>${d.factuur.kweker_whatsapp ? `<a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="${h(waLink(d.factuur.kweker_whatsapp, 'Hoi, hoe laat zijn jullie in Nootdorp? Gr Jan'))}">${icon('chat')}Vraag tijd</a>` : ''}</p>` : ''}
  </div></section>`;
}

function issuesBlock(d) {
  const SO = { minder: 'Minder geleverd', meer: 'Meer geleverd', maat: 'Andere maat', kwaliteit: 'Kwaliteit', schade: 'Schade', te_laat: 'Te laat', prijs: 'Prijs wijkt af', dubbel: 'Dubbele factuur', afzender: 'Afzender' };
  return `<section class="panel"><header><h2>Hoe ging deze levering</h2><button class="btn btn-sm btn-line" data-act="afwijking">${icon('plus')}Meld iets</button></header>
    ${d.afwijkingen.length ? `<ul class="todo">${d.afwijkingen.map(a => `<li>${icon(a.opgelost ? 'check' : 'warn', `ic ${a.opgelost ? 'ok' : 'wait'}`)}<div><b>${h(SO[a.soort] || a.soort)}${a.bedrag ? ` · ${fEur(a.bedrag, 2)}` : ''}</b><p>${h(a.tekst)}${a.opgelost ? ` Opgelost: ${h(a.oplossing || '')}.` : ''}</p></div>${a.opgelost ? '' : `<div class="acts"><button class="btn btn-sm btn-line" data-act="opgelost" data-id="${a.id}" data-how="credit">Credit ontvangen</button><button class="btn btn-sm btn-ghost" data-act="opgelost" data-id="${a.id}" data-how="nalevering">Nageleverd</button><button class="btn btn-sm btn-ghost" data-act="opgelost" data-id="${a.id}" data-how="geaccepteerd">Akkoord</button></div>`}</li>`).join('')}</ul>` : '<p class="empty">Niets bijzonders gemeld. Dit telt mee in de score van de kweker.</p>'}
  </section>`;
}

let current = null;
export async function render(params) {
  const d = await api(`/facturen/${params.id}`);
  current = d;
  const f = d.factuur;
  return `<div class="page">
    <a class="back" href="#/workflow">${icon('back')}Workflow</a>
    <div class="ph"><div><h1>${h(f.kweker)} <span style="color:var(--ink-3);font-weight:500">${h(f.nummer)}</span></h1>
      <p>${f.kanaal ? `${kanaalNaam(f.kanaal)} ${rel(f.ontvangen)}` : 'Ingevoerd'} · factuur van ${fDate(f.datum)} · ${f.gelezen_door === 'ai' ? 'gelezen met AI' : f.gelezen_door === 'regels' ? 'gelezen met vaste regels' : f.gelezen_door === 'demo' ? 'demo-factuur' : 'ingevoerd door Jan'}${f.zekerheid != null ? `, ${f.zekerheid}% zeker` : ''}</p></div>
      <div class="acts">${stapChip(d.stap.stap)}<a class="btn btn-line" href="#/kweker/${f.kweker_id}">${icon('grower')}Kweker</a></div></div>
    ${f.waarschuwing ? `<div class="warnbox">${icon('warn')}<span>${h(f.waarschuwing)}</span></div>` : ''}
    ${steps(d.stap.stap)}
    ${nextBox(d)}
    <div class="stack">
      <section class="panel" id="lezen"><header><h2>Wat de desk las</h2><span class="sub">Origineel naast de regels zoals ze zijn herkend</span></header>
        <div class="body grid2e"><div class="orig">${original(f)}</div><div>${await linesTable(d)}</div></div></section>
      <section class="panel" id="verdeling"><header><h2>Verdeling</h2>${d.stap.voorstel ? '<button class="btn btn-sm btn-leaf" data-act="bevestig">Koppeling bevestigen</button>' : `<span class="sub">${plural(d.stap.klanten, 'klant', 'klanten')}${d.stap.rest ? `, ${fNum(d.stap.rest)} over` : ''}</span>`}</header>
        <div class="body">${tree(d)}<div style="margin-top:14px">${allocTable(d)}</div></div></section>
      ${restBlock(d)}
      ${messagesBlock(d)}
      <div class="grid2e">${routeBlock(d)}${issuesBlock(d)}</div>
      ${d.logboek.length ? `<section class="panel"><header><h2>Logboek</h2></header><ul class="feed body">${d.logboek.map(l => `<li><time>${fTime(l.tijd)}</time><span>${h(l.actie)} <span class="src">· ${h(l.wie)}, ${dayWord(l.tijd)}</span></span></li>`).join('')}</ul></section>` : ''}
    </div>
  </div>`;
}

const reload = async (ctx, msg) => { if (msg) toast(msg); await ctx.refresh(); };
export const actions = {
  async bevestig(el, ctx) { await api(`/facturen/${current.factuur.id}/bevestig`, { method: 'POST', body: {} }); reload(ctx, 'Koppeling bevestigd.'); },
  async nagekeken(el, ctx) {
    const regels = [...document.querySelectorAll('[data-doubt]')].map(s => ({ id: Number(s.dataset.doubt), plant_id: Number(s.value) }));
    if (regels.some(r => !r.plant_id)) { toast('Kies bij elke gemarkeerde regel een plant.'); return; }
    await api(`/facturen/${current.factuur.id}/nagekeken`, { method: 'POST', body: { regels } });
    plantCache = null; reload(ctx, 'Nagekeken. De desk onthoudt deze namen.');
  },
  async weg(el, ctx) { await api(`/toewijzingen/${el.dataset.id}`, { method: 'DELETE' }); reload(ctx, 'Weggehaald.'); },
  async bied(el, ctx) {
    const key = `${el.dataset.regel}-${el.dataset.klant}`;
    const n = Number(document.querySelector(`[data-n="${key}"]`).value), p = Number(document.querySelector(`[data-p="${key}"]`).value);
    await api('/toewijzingen', { method: 'POST', body: { regel_id: Number(el.dataset.regel), bestemming: 'klant', klant_id: Number(el.dataset.klant), aantal: n, verkoopprijs: p, soort: 'aanbod' } });
    reload(ctx, 'Aangeboden. Het bericht zet je klaar bij "Klanten informeren".');
  },
  async voorraad(el, ctx) { await api('/toewijzingen', { method: 'POST', body: { regel_id: Number(el.dataset.regel), bestemming: 'voorraad', aantal: Number(el.dataset.n) } }); reload(ctx, 'Op voorraad gezet.'); },
  async retour(el, ctx) { await api('/toewijzingen', { method: 'POST', body: { regel_id: Number(el.dataset.regel), bestemming: 'retour', aantal: Number(el.dataset.n) } }); reload(ctx, 'Gaat terug naar de kweker.'); },
  async toewijzen(el, ctx) {
    const ks = (await klanten()).filter(k => k.actief);
    const rest = Number(el.dataset.rest);
    dialog({ title: 'Toewijzen', ok: 'Toewijzen', body: `
      ${field('bestemming', 'Naar', 'klant', { opts: [['klant', 'Een klant'], ['voorraad', 'Voorraad'], ['retour', 'Terug naar de kweker']] })}
      ${field('klant_id', 'Klant', '', { opts: [['', 'Kies…'], ...ks.map(k => [k.id, `${k.naam} (${k.plaats})`])] })}
      ${field('soort', 'Soort', 'order', { opts: [['order', 'Hoort bij een bestelling'], ['aanbod', 'Aanbod (rest)']] })}
      ${field('aantal', 'Aantal', rest > 0 ? rest : '', { type: 'number' })}
      ${field('verkoopprijs', 'Verkoopprijs per stuk (optioneel)', '', { type: 'number' })}`,
      onOk: async v => { await api('/toewijzingen', { method: 'POST', body: { regel_id: Number(el.dataset.regel), bestemming: v.bestemming, klant_id: v.bestemming === 'klant' ? Number(v.klant_id) || null : null, aantal: Number(v.aantal), verkoopprijs: v.verkoopprijs ? Number(v.verkoopprijs) : null, soort: v.bestemming === 'klant' ? v.soort : v.bestemming } }); reload(ctx, 'Toegewezen.'); } });
  },
  async berichten(el, ctx) { el.disabled = true; await api(`/facturen/${current.factuur.id}/berichten`, { method: 'POST', body: {} }); await reload(ctx, 'Berichten staan klaar.'); document.getElementById('berichten')?.scrollIntoView({ block: 'start' }); },
  async verstuurd(el, ctx) { const t = document.querySelector(`[data-msg="${el.dataset.id}"]`); await api(`/berichten/${el.dataset.id}`, { method: 'PATCH', body: { tekst: t ? t.value : undefined, status: 'verstuurd' } }); reload(ctx, 'Afgevinkt als verstuurd.'); },
  async kopieer(el) { const t = document.querySelector(`[data-msg="${el.dataset.id}"]`); if (t) copy(t.value); },
  'open-wa'(el) { const t = document.querySelector(`[data-msg="${el.dataset.id}"]`); if (t) el.href = el.href.replace(/text=[^&]*/, 'text=' + encodeURIComponent(t.value)); return 'default'; },
  'open-mail'(el) { const t = document.querySelector(`[data-msg="${el.dataset.id}"]`); if (t) el.href = el.href.replace(/body=[^&]*/, 'body=' + encodeURIComponent(t.value)); return 'default'; },
  async afronden(el, ctx) { await api(`/facturen/${current.factuur.id}/afronden`, { method: 'POST', body: {} }); reload(ctx, 'Afgerond.'); },
  async heropen(el, ctx) { await api(`/facturen/${current.factuur.id}/afronden`, { method: 'POST', body: { open: true } }); reload(ctx, 'Heropend.'); },
  async 'z-binnen'(el, ctx) { await api(`/zendingen/${el.dataset.id}/gebeurtenis`, { method: 'POST', body: { soort: 'aangekomen' } }); reload(ctx, 'Gemeld: binnen.'); },
  async 'z-eta'(el, ctx) {
    dialog({ title: 'Nieuwe verwachte tijd', body: `${field('eta', 'Verwacht in Nootdorp om', '', { type: 'time' })}${field('tekst', 'Waarom (optioneel)', '')}`,
      onOk: async v => { await api(`/zendingen/${el.dataset.id}/gebeurtenis`, { method: 'POST', body: { soort: 'eta', eta: v.eta, tekst: v.tekst ? `${v.tekst} (nieuwe tijd ${v.eta})` : `Nieuwe tijd ${v.eta}` } }); reload(ctx, 'Tijd bijgewerkt.'); } });
  },
  async afwijking(el, ctx) {
    dialog({ title: 'Meld wat er niet klopte', ok: 'Melden', body: `
      ${field('soort', 'Wat', 'minder', { opts: [['minder', 'Minder geleverd'], ['schade', 'Schade'], ['kwaliteit', 'Kwaliteit'], ['maat', 'Andere maat'], ['prijs', 'Prijs wijkt af'], ['te_laat', 'Te laat'], ['meer', 'Meer geleverd']] })}
      ${field('regel_id', 'Regel', '', { opts: [['', 'Hele levering'], ...current.regels.map(r => [r.id, `${r.aantal} × ${plantName(r)}`])] })}
      ${field('aantal', 'Aantal (optioneel)', '', { type: 'number' })}
      ${field('bedrag', 'Bedrag in euro (optioneel)', '', { type: 'number' })}
      ${field('tekst', 'Toelichting', '', { type: 'textarea' })}`,
      onOk: async v => { await api(`/facturen/${current.factuur.id}/afwijking`, { method: 'POST', body: { soort: v.soort, regel_id: v.regel_id ? Number(v.regel_id) : undefined, aantal: v.aantal ? Number(v.aantal) : undefined, bedrag: v.bedrag ? Number(v.bedrag) : undefined, tekst: v.tekst || 'Gemeld door Jan' } }); reload(ctx, 'Gemeld.'); } });
  },
  async opgelost(el, ctx) { await api(`/afwijkingen/${el.dataset.id}`, { method: 'PATCH', body: { opgelost: true, oplossing: el.dataset.how } }); reload(ctx, 'Afgehandeld.'); },
};
export function onChange(e) {
  const t = e.target.closest('[data-msg]');
  if (t) api(`/berichten/${t.dataset.msg}`, { method: 'PATCH', body: { tekst: t.value } }).then(() => toast('Tekst bewaard.')).catch(err => toast(err.message));
}
