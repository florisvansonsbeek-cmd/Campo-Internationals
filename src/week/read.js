// Reading a supplier's confirmation or shipping papers (commercial invoice, packing list, AWB) into the lines of one shipment.
// With XAI_API_KEY Grok reads them; without it simple rules read a clean pdf or a pasted mail. Jan always sees what was read.
import { pdfRows } from '../ingest/extract.js';
import { aiStatus, aiCheck } from '../ingest/ai.js';

const BASE = process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
const SYSTEM = `Je leest papieren van leveranciers in Costa Rica en Guatemala aan Campo International (Nootdorp): een orderbevestiging, of verzendpapieren
(factura comercial, packing list, AWB, fytosanitair certificaat). Ze gaan over stekken en stammen: Dracaena fragrans ("hockey stick", "caña"), Yucca, Dracaena marginata, Cordyline.
Geef uitsluitend één JSON-object terug, zonder uitleg. Verzin niets: wat er niet staat is null.
{
  "regels": [ { "omschrijving": string, "dozen": number|null, "per_doos": number|null, "stuks": number|null, "prijs_usd": number|null, "opmerking": string|null } ],
  "awb": string|null, "vlucht": string|null, "fyto": string|null, "factuurnummer": string|null,
  "waarschuwingen": [string]
}
"dozen" = cajas/boxes. "prijs_usd" = prijs per stuk (unidad) in dollars. Staat er dat een deel later komt ("próximo vuelo", "pendiente"), zet dan bij "dozen" wat er nu meegaat en noem het in "opmerking" en "waarschuwingen".`;

async function ai(parts) {
  const key = process.env.XAI_API_KEY;
  if (!key) return null;
  if (!aiStatus().model) await aiCheck();
  const model = aiStatus().model || 'grok-4';
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: parts }] }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`xAI ${r.status}: ${txt.slice(0, 200)}`);
  const content = JSON.parse(txt).choices?.[0]?.message?.content || '';
  const m = content.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
// which of our products a supplier's line is about
export function matchProduct(text, producten) {
  const t = norm(text), size = (t.match(/(\d{2,3})\s*(cm|ft)?/) || [])[1];
  let best = null;
  for (const p of producten) {
    let s = 0;
    const naam = norm(p.naam), soort = norm(p.soort), maat = (norm(p.maat).match(/\d+/) || [])[0];
    if (soort.split(' ').every(w => t.includes(w))) s += 40; else if (t.includes(soort.split(' ')[0])) s += 15;
    if (/hockey/.test(t) === /hockey/.test(naam)) s += 15;
    if (/(cana|cane|stam|stem)/.test(t) && /stam/.test(naam)) s += 15;
    if (/(esqueje|cutting|kopstek|tip)/.test(t) && /kopstek/.test(naam)) s += 15;
    if (size && maat === size) s += 30;
    if (!best || s > best.s) best = { p, s };
  }
  return best && best.s >= 55 ? { product: best.p, zekerheid: Math.min(99, best.s) } : null;
}

// the rules: rows with a product and numbers, the first whole number being the boxes
function byRules(text, producten) {
  const out = [];
  for (const row of String(text || '').split('\n')) {
    const m = matchProduct(row, producten);
    if (!m) continue;
    const cells = row.split('|').map(x => x.trim());
    const nums = cells.slice(1).map(x => Number(x.replace(/[$\s]/g, '').replace(/,(?=\d{3}\b)/g, ''))).filter(n => Number.isFinite(n));
    const dozen = nums.find(n => Number.isInteger(n) && n > 0 && n < 5000);
    const prijs = nums.find(n => !Number.isInteger(n) && n < 50);
    if (dozen == null) {
      const w = row.match(/^\s*(\d{1,4})\s*(cajas|boxes|dozen|cajas?)\b/i) || row.match(/\b(\d{1,4})\s*(cajas|boxes)\b/i);
      if (w) out.push({ omschrijving: row.trim(), dozen: Number(w[1]), prijs_usd: null, match: m });
      continue;
    }
    out.push({ omschrijving: cells[0] || row.trim(), dozen, prijs_usd: prijs ?? null, match: m });
  }
  return out;
}

export async function readShipping({ tekst = '', pdf = null, image = null, mime = null }, producten) {
  let pdfText = '';
  if (pdf) { try { pdfText = await pdfRows(pdf); } catch { pdfText = ''; } }
  let read = null, door = 'regels';
  try {
    const parts = [{ type: 'text', text: `${tekst ? `Bericht:\n${tekst.slice(0, 12000)}\n\n` : ''}${pdfText ? `Pdf (cellen gescheiden door |):\n${pdfText.slice(0, 20000)}` : ''}` || 'Leeg' }];
    if (image) parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${image.toString('base64')}`, detail: 'high' } });
    read = await ai(parts);
    if (read) door = 'ai';
  } catch (e) { console.error('[lezen]', e.message); }
  let lines;
  if (read && Array.isArray(read.regels)) lines = read.regels.map(r => ({ ...r, match: matchProduct(r.omschrijving, producten) }));
  else lines = byRules(`${tekst}\n${pdfText}`, producten);
  const grab = re => { const m = `${tekst}\n${pdfText}`.match(re); return m ? m[1].trim() : null; };
  return {
    door, regels: lines,
    awb: read?.awb || grab(/AWB\s*\|?\s*([0-9]{3}-[0-9 ]{6,12})/i),
    vlucht: read?.vlucht || grab(/(?:Vuelo|Flight)[^|\n]*\|\s*([^|\n]+)/i),
    fyto: read?.fyto || grab(/Fitosanitario\s*\|\s*([^|\n]+)/i),
    factuur: read?.factuurnummer || grab(/No\.\s*\|\s*([A-Z]{2,4}-[0-9-]+)/),
    waarschuwingen: read?.waarschuwingen || [],
  };
}
