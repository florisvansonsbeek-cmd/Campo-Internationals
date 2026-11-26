// Putting something from the loods on a truck that leaves for a customer anyway.
// One lot on one truck, or a pick from everything that fits. Jan decides; the desk asks the customer for him if he wants.
import { api, h, icon, fNum, fPrice, toast, dialog, waLink, dayWord, fTime } from './core.js';
import { when } from './lane.js';

// the message to the customer, in his language
const WHEN = {
  nl: d => `${dayWord(d) === 'vandaag' ? 'vandaag' : dayWord(d)} om ${fTime(d)}`,
  de: d => `${dayWord(d) === 'vandaag' ? 'heute' : dayWord(d) === 'morgen' ? 'morgen' : new Date(d).toLocaleDateString('de-DE', { weekday: 'long' })} um ${fTime(d)}`,
  en: d => `${dayWord(d) === 'vandaag' ? 'today' : dayWord(d) === 'morgen' ? 'tomorrow' : `on ${new Date(d).toLocaleDateString('en-GB', { weekday: 'long' })}`} at ${fTime(d)}`,
  fr: d => `${dayWord(d) === 'vandaag' ? "aujourd'hui" : dayWord(d) === 'morgen' ? 'demain' : new Date(d).toLocaleDateString('fr-FR', { weekday: 'long' })} à ${fTime(d)}`,
};
const ASK = {
  nl: (c, t, items) => `Hoi${c ? ` ${c}` : ''}, ${t} gaat er een wagen naar jullie. Ik kan er nog ${items} bij doen. Zal ik dat meesturen? Groet, Jan`,
  de: (c, t, items) => `Hallo${c ? ` ${c}` : ''}, ${t} fährt ein LKW zu Ihnen. Ich kann noch ${items} mitschicken. Soll ich das dazu packen? Grüße, Jan`,
  en: (c, t, items) => `Hi${c ? ` ${c}` : ''}, a truck leaves for you ${t}. I can still add ${items}. Shall I send it along? Best, Jan`,
  fr: (c, t, items) => `Bonjour${c ? ` ${c}` : ''}, un camion part chez vous ${t}. Je peux encore ajouter ${items}. Je l'envoie avec ? Cordialement, Jan`,
};
export function askText(w, lots) {
  const lang = ASK[w.taal] ? w.taal : 'en';
  const items = lots.map(l => `${l.aantal} ${l.plant}${l.maat ? ` ${l.maat}` : ''}${l.prijs ? ` (€ ${fPrice(l.prijs).replace('€', '').trim()})` : ''}`).join(lang === 'nl' ? ' en ' : lang === 'de' ? ' und ' : lang === 'fr' ? ' et ' : ' and ');
  return ASK[lang]((w.contact || '').split(' ')[0], WHEN[lang] ? WHEN[lang](w.vertrek) : WHEN.en(w.vertrek), items);
}

// the data a button carries: the truck and the lot, with the suggested number and price
export const pack = (w, lot) => h(JSON.stringify({ w: { levering_id: w.levering_id, klant: w.klant, plaats: w.plaats, vertrek: w.vertrek, whatsapp: w.whatsapp, contact: w.contact, taal: w.taal },
  lot: { regel_id: lot.regel_id, plant: lot.plant, maat: lot.maat, eenheid: lot.eenheid, vrij: lot.vrij, aantal: lot.aantal, prijs: lot.prijs, reden: lot.reden } }));

// one lot on one truck
export function erbijEen(el, ctx) {
  const { w, lot } = JSON.parse(el.dataset.x);
  const wa = w.whatsapp ? waLink(w.whatsapp, askText(w, [lot])) : null;
  dialog({
    title: `Erbij op de wagen naar ${w.klant}`, ok: 'Erbij doen',
    body: `<p class="small" style="margin-bottom:10px">De wagen naar ${h(w.klant)}${w.plaats && !w.klant.includes(w.plaats) ? ` in ${h(w.plaats)}` : ''} vertrekt ${h(when(w.vertrek))}. ${h(lot.plant)} ${h(lot.maat || '')}: ${fNum(lot.vrij)} vrij in de loods${lot.reden ? `; ${h(lot.reden)}` : ''}.</p>
      <div class="grid-f">
        <label class="f">Aantal<input type="number" name="aantal" min="1" max="${lot.vrij}" step="1" value="${lot.aantal || lot.vrij}" required></label>
        <label class="f">Prijs per stuk (€)<input type="number" name="prijs" min="0" step="0.01" value="${lot.prijs ?? ''}"></label>
      </div>
      ${wa ? `<p class="small muted" style="margin-top:10px">Eerst even vragen? <a class="lnk" href="${wa}" target="_blank" rel="noopener">${icon('chat')}App ${h(w.contact ? w.contact.split(' ')[0] : w.klant)}</a> met een klaar bericht.</p>` : ''}`,
    onOk: async v => {
      const aantal = Number(v.aantal);
      if (!aantal || aantal < 1) throw new Error('Vul een aantal in.');
      if (aantal > lot.vrij) throw new Error(`Er is ${lot.vrij} vrij.`);
      await api(`/wagen/${w.levering_id}/erbij`, { method: 'POST', body: { regel_id: lot.regel_id, aantal, verkoopprijs: v.prijs === '' ? null : Number(v.prijs) } });
      toast(`${fNum(aantal)} ${lot.plant} gaat mee met de wagen naar ${w.klant}.`);
      ctx.refresh();
    },
  });
}

// choose from everything that fits one truck, and the rest of the loods
export async function erbijKies(leveringId, ctx) {
  const d = await api(`/wagen/${leveringId}`);
  if (!d.erbij) { toast('Deze wagen is al vertrokken.'); return; }
  const w = d.erbij.wagen, all = [...d.erbij.past.map(x => ({ ...x, fit: true })), ...d.erbij.anders];
  if (!all.length) { toast('Er staat niets vrij in de loods.'); return; }
  const row = (l, i) => `<tr class="${l.fit ? '' : 'other'}"><td><label class="ck"><input type="checkbox" name="k${i}"${l.fit && i < 2 ? ' checked' : ''}><span><b>${h(l.plant)}</b> <span class="faint">${h(l.maat || '')}</span><br><span class="small ${l.fit ? 'muted' : 'faint'}">${h(l.reden || '')}</span></span></label></td>
    <td class="r num">${fNum(l.vrij)}</td><td><input class="num-in" type="number" name="a${i}" min="1" max="${l.vrij}" value="${l.aantal}"></td><td><input class="num-in" type="number" name="p${i}" min="0" step="0.01" value="${l.prijs ?? ''}"></td></tr>`;
  dialog({
    title: `Wat kan er mee naar ${w.klant}?`, ok: 'Erbij doen',
    body: `<p class="small" style="margin-bottom:10px">De wagen vertrekt ${h(when(w.vertrek))}. Bovenaan wat ${h(w.klant)} vaker koopt; vink aan wat mee mag.</p>
      <div class="tbwrap"><table class="tb pick"><thead><tr><th>Uit de loods</th><th class="r">Vrij</th><th>Aantal</th><th>€ per stuk</th></tr></thead><tbody>${all.map(row).join('')}</tbody></table></div>
      ${w.whatsapp ? `<p class="small muted" style="margin-top:10px"><a class="lnk" href="${waLink(w.whatsapp, askText(w, d.erbij.past.slice(0, 2)))}" target="_blank" rel="noopener">${icon('chat')}Eerst appen met ${h(w.contact ? w.contact.split(' ')[0] : w.klant)}</a></p>` : ''}`,
    onOk: async v => {
      const pick = all.map((l, i) => ({ l, on: v[`k${i}`] === 'on', aantal: Number(v[`a${i}`]), prijs: v[`p${i}`] === '' ? null : Number(v[`p${i}`]) })).filter(x => x.on);
      if (!pick.length) throw new Error('Vink eerst iets aan.');
      for (const x of pick) if (!x.aantal || x.aantal < 1 || x.aantal > x.l.vrij) throw new Error(`Kies voor ${x.l.plant} tussen 1 en ${x.l.vrij}.`);
      for (const x of pick) await api(`/wagen/${leveringId}/erbij`, { method: 'POST', body: { regel_id: x.l.regel_id, aantal: x.aantal, verkoopprijs: x.prijs } });
      toast(`${pick.length === 1 ? `${fNum(pick[0].aantal)} ${pick[0].l.plant} gaat` : `${pick.length} partijen gaan`} mee met de wagen naar ${w.klant}.`);
      ctx.refresh();
    },
  });
}
