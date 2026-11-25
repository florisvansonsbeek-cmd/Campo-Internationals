// Simple invoice PDFs for the demo, so the desk can show "the original" next to what it read.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// the standard PDF fonts only know Western European letters
const ascii = s => String(s ?? '')
  .replace(/[łŁ]/g, m => (m === 'ł' ? 'l' : 'L')).replace(/[śŚ]/g, 's').replace(/[żźŻŹ]/g, 'z').replace(/[ąĄ]/g, 'a').replace(/[ęĘ]/g, 'e')
  .replace(/[ćĆ]/g, 'c').replace(/[ńŃ]/g, 'n').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E -ÿ€×]/g, '');

const eur = v => '€ ' + new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const num = v => new Intl.NumberFormat('nl-NL').format(v);
const unit = v => '€ ' + new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(v);
const dmy = d => { const x = new Date(d + (String(d).length === 10 ? 'T12:00:00' : '')); return `${String(x.getDate()).padStart(2, '0')}-${String(x.getMonth() + 1).padStart(2, '0')}-${x.getFullYear()}`; };

export async function invoicePdf({ kweker, nummer, datum, vervaldatum, regels, iban, note, lookalike }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Factuur ${nummer}`);
  doc.setProducer('Campo demo');
  const page = doc.addPage([595.28, 841.89]);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.14, 0.13), soft = rgb(0.38, 0.4, 0.39), line = rgb(0.8, 0.82, 0.8);
  const text = (s, x, y, o = {}) => page.drawText(ascii(s), { x, y, size: o.size || 9.5, font: o.bold ? b : f, color: o.color || ink });
  const right = (s, x, y, o = {}) => { const w = (o.bold ? b : f).widthOfTextAtSize(ascii(s), o.size || 9.5); text(s, x - w, y, o); };

  text(kweker.naam, 48, 780, { size: 16, bold: true });
  text(`${kweker.plaats || ''}${kweker.land && kweker.land !== 'NL' ? ', ' + kweker.land : ''}`, 48, 762, { color: soft });
  text(kweker.email || '', 48, 749, { color: soft });
  if (kweker.telefoon || kweker.whatsapp) text(kweker.telefoon || kweker.whatsapp, 48, 736, { color: soft });
  text('FACTUUR', 420, 780, { size: 16, bold: true });
  text('Factuurnummer', 420, 760, { color: soft }); right(nummer, 547, 760, { bold: true });
  text('Factuurdatum', 420, 746, { color: soft }); right(dmy(datum), 547, 746);
  if (vervaldatum) { text('Vervaldatum', 420, 732, { color: soft }); right(dmy(vervaldatum), 547, 732); }

  text('Aan', 48, 700, { color: soft });
  text('Campo International B.V.', 48, 686, { bold: true });
  text('Veilingweg 14', 48, 673); text('2631 PH Nootdorp', 48, 660); text('Nederland', 48, 647);

  let y = 606;
  page.drawLine({ start: { x: 48, y: y + 14 }, end: { x: 547, y: y + 14 }, thickness: 0.8, color: ink });
  text('Aantal', 48, y, { bold: true }); text('Omschrijving', 104, y, { bold: true }); text('Ref.', 330, y, { bold: true });
  right('Prijs', 470, y, { bold: true }); right('Bedrag', 547, y, { bold: true });
  y -= 8; page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 0.5, color: line });
  let total = 0;
  for (const r of regels) {
    y -= 16;
    const amount = Math.round(r.aantal * r.prijs * 100) / 100; total += amount;
    right(num(r.aantal), 84, y); text(r.omschrijving, 104, y); if (r.ref) text(r.ref, 330, y, { color: soft, size: 8.5 });
    right(unit(r.prijs), 470, y); right(eur(amount), 547, y);
  }
  y -= 12; page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 0.5, color: line });
  const vat = Math.round(total * 0.09 * 100) / 100;
  y -= 18; text('Totaal excl. btw', 380, y, { color: soft }); right(eur(total), 547, y, { bold: true });
  y -= 14; text('Btw 9%', 380, y, { color: soft }); right(eur(vat), 547, y);
  y -= 14; text('Totaal incl. btw', 380, y, { color: soft }); right(eur(total + vat), 547, y, { bold: true });

  y -= 44;
  text(`Graag betalen binnen de termijn op ${iban}, o.v.v. ${nummer}.`, 48, y, { color: soft });
  if (note) { y -= 16; text(note, 48, y, { bold: lookalike, color: lookalike ? rgb(0.6, 0.1, 0.05) : soft }); }
  text(`${kweker.naam} · KvK ${String(70000000 + (kweker.id || 1) * 1237).slice(0, 8)} · Btw NL00${String(1000 + (kweker.id || 1) * 37)}B01`, 48, 40, { size: 7.5, color: soft });
  return Buffer.from(await doc.save());
}

// ---------------------------------------------------------------- Campo's own documents: an order to a grower, an offer to a customer
const CAMPO = ['Campo International B.V.', 'Veilingweg 14', '2631 PH Nootdorp', 'Nederland'];
const fmtDate = (d, loc) => new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(String(d).length === 10 ? d + 'T12:00:00' : d));
const money = (v, loc, dec = 2) => '€ ' + new Intl.NumberFormat(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);

// inhoud: { nummer, datum, geldig_tot?, levering_tekst, regels: [{ aantal, omschrijving, prijs, bedrag }], totaal, btw_pct, btw_regel?, aan: [lines], ref?, voet? }
export async function campoPdf(inhoud, L, loc) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${L.title} ${inhoud.nummer}`);
  doc.setAuthor('Campo International');
  doc.setProducer('Campo desk');
  const page = doc.addPage([595.28, 841.89]);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.13, 0.1), soft = rgb(0.36, 0.4, 0.38), line = rgb(0.8, 0.83, 0.79), leaf = rgb(0.12, 0.32, 0.22);
  const text = (s, x, y, o = {}) => page.drawText(ascii(s), { x, y, size: o.size || 9.5, font: o.bold ? b : f, color: o.color || ink });
  const right = (s, x, y, o = {}) => { const w = (o.bold ? b : f).widthOfTextAtSize(ascii(s), o.size || 9.5); text(s, x - w, y, o); };
  const fit = (s, max, o = {}) => { let t = ascii(s); const font = o.bold ? b : f, size = o.size || 9.5; while (t.length > 3 && font.widthOfTextAtSize(t, size) > max) t = t.slice(0, -2); return t === ascii(s) ? t : t + '…'; };

  page.drawRectangle({ x: 0, y: 812, width: 595.28, height: 30, color: leaf });
  text('CAMPO', 48, 822, { size: 13, bold: true, color: rgb(0.96, 0.96, 0.94) });
  text('International', 98, 822, { size: 11, color: rgb(0.85, 0.9, 0.86) });
  CAMPO.forEach((l, i) => text(l, 48, 786 - i * 13, { color: i ? soft : ink, bold: !i }));
  text('+31 15 000 0000 · info@campo.example', 48, 734, { color: soft, size: 8.5 });

  text(L.title, 380, 786, { size: 17, bold: true, color: leaf });
  let y = 766;
  const meta = [[L.nr, inhoud.nummer], [L.date, fmtDate(inhoud.datum, loc)]];
  if (inhoud.geldig_tot && L.valid) meta.push([L.valid, fmtDate(inhoud.geldig_tot, loc)]);
  if (inhoud.ref && L.ref) meta.push([L.ref, inhoud.ref]);
  for (const [k, v] of meta) { text(k, 380, y, { color: soft }); right(v, 547, y, { bold: k === L.nr }); y -= 14; }

  text(L.to, 48, 700, { color: soft });
  (inhoud.aan || []).forEach((l, i) => text(l, 48, 686 - i * 13, { bold: i === 0 }));
  if (inhoud.levering_tekst) { text(L.delivery, 300, 700, { color: soft }); text(fit(inhoud.levering_tekst, 247), 300, 686); if (inhoud.adres_tekst) text(fit(inhoud.adres_tekst, 247), 300, 673, { color: soft }); }

  y = 606;
  page.drawLine({ start: { x: 48, y: y + 14 }, end: { x: 547, y: y + 14 }, thickness: 0.8, color: ink });
  text(L.qty, 48, y, { bold: true }); text(L.desc, 110, y, { bold: true }); right(L.price, 470, y, { bold: true }); right(L.amount, 547, y, { bold: true });
  y -= 8; page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 0.5, color: line });
  for (const r of inhoud.regels) {
    y -= 16;
    right(new Intl.NumberFormat(loc).format(r.aantal), 90, y); text(fit(r.omschrijving, 280), 110, y);
    right(money(r.prijs, loc, r.prijs < 1 ? 3 : 2), 470, y); right(money(r.bedrag, loc), 547, y);
    if (y < 140) break;
  }
  y -= 12; page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 0.5, color: line });
  y -= 18; text(L.total, 360, y, { color: soft }); right(money(inhoud.totaal, loc), 547, y, { bold: true });
  if (inhoud.btw_pct != null && L.vat) {
    const vat = Math.round(inhoud.totaal * inhoud.btw_pct) / 100;
    if (inhoud.btw_pct > 0) {
      y -= 14; text(`${L.vat} ${inhoud.btw_pct}%`, 360, y, { color: soft }); right(money(vat, loc), 547, y);
      y -= 14; text(L.inc, 360, y, { color: soft }); right(money(inhoud.totaal + vat, loc), 547, y, { bold: true });
    } else if (inhoud.btw_regel) { y -= 14; text(fit(inhoud.btw_regel, 330), 217, y, { color: soft, size: 8.5 }); }
  }
  y -= 40;
  for (const l of inhoud.voet || []) { text(fit(l, 499), 48, y, { color: soft }); y -= 14; }
  text('Campo International B.V. · KvK 00000000 · Btw NL000000000B01 · IBAN NL00 RABO 0000 0000 00', 48, 40, { size: 7.5, color: soft });
  return Buffer.from(await doc.save());
}
