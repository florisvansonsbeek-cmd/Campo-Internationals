// Reading documents with Grok (xAI). Only used when XAI_API_KEY is set; otherwise the rules in extract.js read.
const BASE = process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
let models = null, modelsAt = 0, lastError = null, lastOk = null;

export const aiStatus = () => ({ aan: !!process.env.XAI_API_KEY, model: process.env.XAI_MODEL || (models && pickModel(models)) || null, laatsteFout: lastError, laatsteSucces: lastOk });

function pickModel(list) {
  if (process.env.XAI_MODEL) return process.env.XAI_MODEL;
  const ids = list.map(m => m.id);
  const prefs = [/^grok-4[.-]?\d*-fast(?!.*reason)/, /^grok-4[.-]?\d*-fast/, /^grok-4(?!.*(code|image|imagine))/, /^grok-3(?!.*mini)/, /^grok/];
  for (const re of prefs) { const hit = ids.find(id => re.test(id)); if (hit) return hit; }
  return ids[0] || 'grok-4';
}

async function listModels() {
  if (models && Date.now() - modelsAt < 6 * 3600e3) return models;
  const r = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`xAI models: ${r.status}`);
  const j = await r.json();
  models = (j.data || j.models || []).filter(m => m && m.id);
  modelsAt = Date.now();
  return models;
}

export async function aiCheck() {
  if (!process.env.XAI_API_KEY) return { ok: false, reden: 'XAI_API_KEY ontbreekt' };
  try {
    const list = await listModels();
    lastOk = new Date().toISOString();
    return { ok: true, model: pickModel(list), aantal: list.length };
  } catch (e) {
    lastError = e.message;
    return { ok: false, reden: e.message };
  }
}

const SYSTEM = `Je leest berichten en documenten die kwekers sturen aan Campo International, een groothandel in bloemen en planten in Nootdorp.
Geef uitsluitend één JSON-object terug, zonder uitleg eromheen. Verzin niets: wat niet in het bericht staat, wordt null.
Schema:
{
  "soort": "factuur" | "pakbon" | "bevestiging" | "tijd" | "overig",
  "leverancier": { "naam": string|null, "email": string|null, "telefoon": string|null, "plaats": string|null },
  "factuurnummer": string|null,
  "datum": "JJJJ-MM-DD"|null,
  "vervaldatum": "JJJJ-MM-DD"|null,
  "totaal_excl": number|null,
  "iban": string|null,
  "regels": [ { "aantal": number, "omschrijving": string, "prijs": number, "bedrag": number|null, "referentie": string|null } ],
  "tijd": { "vertrek": "HH:MM"|null, "eta": "HH:MM"|null, "vertraging": boolean, "reden": string|null } | null,
  "waarschuwingen": [string]
}
Regels: "omschrijving" precies zoals op het document (plantnaam, potmaat, hoogte, kleur). "prijs" is de prijs per stuk of steel; reken een prijs per tray om als het aantal per tray erbij staat, anders zet je de trayprijs en noem je het in "waarschuwingen". "referentie" is een klantnaam of ordernummer dat bij de regel staat.
Bij een bericht over tijden ("vertrokken om 6:50, rond 9:15 bij jullie") is soort "tijd" en vul je "tijd" in.
Zet in "waarschuwingen" alles wat Jan moet weten: druk om snel te betalen, een gewijzigd rekeningnummer, bedragen die niet optellen, onleesbare delen.`;

export async function aiRead({ kanaal, van, onderwerp, tekst, bijlagen = [] }) {
  if (!process.env.XAI_API_KEY) return null;
  const list = await listModels().catch(e => { lastError = e.message; return []; });
  const model = pickModel(list);
  const parts = [{ type: 'text', text: `Kanaal: ${kanaal}\nAfzender: ${van || 'onbekend'}\nOnderwerp: ${onderwerp || '-'}\n\nBericht:\n${(tekst || '').slice(0, 12000)}` }];
  for (const b of bijlagen) {
    if (b.tekst) parts.push({ type: 'text', text: `\n\nBijlage ${b.naam} (tekst uit de pdf, cellen gescheiden door |):\n${b.tekst.slice(0, 20000)}` });
    else if (b.image) parts.push({ type: 'image_url', image_url: { url: `data:${b.mime};base64,${b.image.toString('base64')}`, detail: 'high' } });
  }
  const body = { model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: parts }] };
  const call = async b => {
    const r = await fetch(`${BASE}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.XAI_API_KEY}` }, body: JSON.stringify(b), signal: AbortSignal.timeout(90000) });
    const txt = await r.text();
    if (!r.ok) throw new Error(`xAI ${r.status}: ${txt.slice(0, 300)}`);
    const j = JSON.parse(txt);
    const content = j.choices?.[0]?.message?.content || '';
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('xAI gaf geen JSON terug');
    return JSON.parse(m[0]);
  };
  try {
    let out;
    try { out = await call(body); } catch (e) {
      // some models do not take response_format or images; try once more without them
      if (/response_format|image|vision|400/.test(e.message)) {
        const b2 = { ...body, response_format: undefined, messages: [body.messages[0], { role: 'user', content: parts.filter(p => p.type === 'text').map(p => p.text).join('\n') }] };
        out = await call(b2);
      } else throw e;
    }
    lastOk = new Date().toISOString(); lastError = null;
    return { ...out, _model: model };
  } catch (e) {
    lastError = e.message;
    console.error('[ai]', e.message);
    return null;
  }
}
