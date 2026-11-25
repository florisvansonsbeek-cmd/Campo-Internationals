// Getting text out of what comes in, and reading invoices and times without AI (the fallback).
import { getDocumentProxy } from 'unpdf';

// PDF text as rows: cells on one line joined with " | ", top to bottom
export async function pdfRows(buf) {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const out = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 8); p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: Math.round(i.transform[5]) }));
    const rows = [];
    for (const it of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
      const row = rows.find(r => Math.abs(r.y - it.y) <= 3);
      if (row) row.cells.push(it); else rows.push({ y: it.y, cells: [it] });
    }
    for (const r of rows.sort((a, b) => b.y - a.y)) out.push(r.cells.sort((a, b) => a.x - b.x).map(c => c.s).join(' | '));
  }
  return out.join('\n');
}

// numbers the way growers write them: 1.370,88 / 1,370.88 / 2,856 / 0.432
export function parseNum(s, { unit = false } = {}) {
  if (s == null) return null;
  let t = String(s).replace(/[€\s]|eur/gi, '');
  if (!t) return null;
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  if (lc > -1 && ld > -1) t = lc > ld ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (lc > -1) t = t.replace(/\./g, '').replace(',', '.');
  else if (ld > -1 && !unit && /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

const DATE_RE = /(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/;
export function parseDate(s) {
  const m = String(s || '').match(DATE_RE) || String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  let d, mo, y;
  if (m[1].length === 4) { y = +m[1]; mo = +m[2]; d = +m[3]; } else { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const MONEY = /€?\s*-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,3})?|€?\s*-?\d+(?:[.,]\d{1,3})?/g;

// an invoice read with plain rules. Returns null when it does not look like one.
export function readInvoiceText(text) {
  const t = String(text || '');
  const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = { soort: 'factuur', factuurnummer: null, datum: null, vervaldatum: null, totaal_excl: null, iban: null, regels: [], leverancier: {} };
  const num = t.match(/(?:factuur(?:nummer|nr\.?)?|invoice(?:\s*(?:no\.?|number))?|rechnung(?:snummer|s-nr\.?)?|faktura(?:nummer)?)\s*[|:#]?\s*\|?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i);
  if (num && !/^(datum|date)$/i.test(num[1])) out.factuurnummer = num[1];
  const dat = t.match(/(?:factuurdatum|invoice date|rechnungsdatum|datum|date)\s*[|:]?\s*\|?\s*(\d{1,2}[-./]\d{1,2}[-./]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (dat) out.datum = parseDate(dat[1]);
  const due = t.match(/(?:vervaldatum|due date|fällig(?:keit)?(?:sdatum)?)\s*[|:]?\s*\|?\s*(\d{1,2}[-./]\d{1,2}[-./]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (due) out.vervaldatum = parseDate(due[1]);
  const tot = t.match(/(?:totaal|total|summe|netto)\s*(?:excl\.?|exkl\.?|excluding|ohne)?\s*(?:btw|vat|mwst|ust)?\.?\s*[|:]?\s*\|?\s*(€?\s*[\d.,]+)/i);
  if (tot) out.totaal_excl = parseNum(tot[1]);
  const iban = t.replace(/\s/g, '').match(/[A-Z]{2}\d{2}[A-Z]{4}\d{7,16}/);
  if (iban) out.iban = iban[0];

  for (const raw of lines) {
    // WhatsApp style: "240x Phal. 2t 12 Ø 55cm à €2,81"
    let m = raw.match(/^(\d[\d.]*)\s*(?:x|×|st\.?|stuks|pcs)?\s+(.+?)\s+(?:à|a|@|x|per)\s*€?\s*(\d+[.,]?\d*)\b/i);
    if (m && /[a-z]{3}/i.test(m[2])) {
      const aantal = parseNum(m[1]), prijs = parseNum(m[3], { unit: true });
      if (aantal > 0 && prijs > 0) { out.regels.push({ aantal, omschrijving: m[2].trim(), prijs, bedrag: null, referentie: null }); continue; }
    }
    // table rows: "480 | Phal. 2-tak 12cm H55 roze | CI-26-0418 Martin | € 2,856 | € 1.370,88"
    const cells = raw.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 3 && /^\d[\d.]*$/.test(cells[0])) {
      const aantal = parseNum(cells[0]);
      const desc = cells[1];
      const moneyCells = cells.slice(2).filter(c => /^€?\s*-?\d[\d.,]*$/.test(c));
      const ref = cells.slice(2).find(c => !/^€?\s*-?\d[\d.,]*$/.test(c)) || null;
      if (aantal > 0 && /[a-z]{3}/i.test(desc) && moneyCells.length >= 1) {
        const prijs = parseNum(moneyCells[0], { unit: true });
        const bedrag = moneyCells.length > 1 ? parseNum(moneyCells[moneyCells.length - 1]) : null;
        if (prijs != null) { out.regels.push({ aantal, omschrijving: desc, prijs, bedrag, referentie: ref }); continue; }
      }
    }
    // loose rows: "480 Phalaenopsis 2-tak P12 2,85 1.368,00"
    m = raw.match(/^(\d{1,6})\s+([A-Za-zÀ-ÿ].+?)\s+(€?\s*\d+[.,]\d{2,3})\s+(€?\s*\d{1,3}(?:[.,]\d{3})*[.,]\d{2})$/);
    if (m) {
      const aantal = parseNum(m[1]), prijs = parseNum(m[3], { unit: true }), bedrag = parseNum(m[4]);
      if (aantal > 0 && prijs > 0) out.regels.push({ aantal, omschrijving: m[2].trim(), prijs, bedrag, referentie: null });
    }
  }
  if (!out.regels.length) return null;
  // WhatsApp invoices often say "voor morgen" and "rond 8:15"
  const low = t.toLowerCase();
  if (!out.datum && /\b(morgen|tomorrow|morgen früh)\b/.test(low) && !/\bvandaag\b/.test(low)) { const d = new Date(); d.setDate(d.getDate() + 1); out.datum = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  const eta = low.match(/(?:rond|om|eta|verwacht|levering[^\n]*?)\s*(\d{1,2})[:.u](\d{2})/);
  if (eta) out.tijd = { vertrek: null, eta: { h: +eta[1], m: +eta[2] }, vertraging: false };
  return out;
}

// times in a message: "vertrokken om 6:52, rond 9:10 bij jullie" / "wordt ongeveer 9:55"
export function readTimeText(text) {
  const t = String(text || '').toLowerCase();
  const times = [...t.matchAll(/\b([01]?\d|2[0-3])[:.u]([0-5]\d)\b/g)].map(m => ({ h: +m[1], m: +m[2], i: m.index }));
  if (!times.length) return null;
  const late = /(file|vertraging|later|sorry|pech|vast|stau|verspät|delay|late)/.test(t);
  const left = /(vertrok|vertrokken|weg om|onderweg|geladen|gestart|losgegaan|abgefahren|departed|left)/.test(t);
  const etaWord = /(rond|eta|verwacht|bij jullie|wordt|aankomst|ankunft|arrive|in nootdorp|ongeveer|circa|ca\.)/.test(t);
  if (!late && !left && !etaWord) return null;
  const fmt = x => ({ h: x.h, m: x.m });
  return {
    soort: 'tijd',
    vertraging: late,
    vertrek: left && times.length > 1 ? fmt(times[0]) : (left && !etaWord ? fmt(times[0]) : null),
    eta: etaWord || late ? fmt(times[times.length - 1]) : null,
  };
}
