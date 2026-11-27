// The papers of the weekly rhythm as pdf: the packing slip that is also the invoice (with the plant passport on it),
// and, for the demo, a supplier's commercial invoice with packing list as it comes from Costa Rica or Guatemala.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// the standard PDF fonts only know Western European letters
const ascii = s => String(s ?? '')
  .replace(/[łŁ]/g, m => (m === 'ł' ? 'l' : 'L')).replace(/[śŚ]/g, 's').replace(/[żźŻŹ]/g, 'z').replace(/[ąĄ]/g, 'a').replace(/[ęĘ]/g, 'e')
  .replace(/[ćĆ]/g, 'c').replace(/[ńŃ]/g, 'n').replace(/[ůŮ]/g, 'u').replace(/[řŘ]/g, 'r').replace(/[čČ]/g, 'c').replace(/[ěĚ]/g, 'e').replace(/[šŠ]/g, 's').replace(/[žŽ]/g, 'z')
  .replace(/[’‘]/g, "'").replace(/[“”„]/g, '"').replace(/[–—]/g, '-').replace(/[   ]/g, ' ').replace(/[^\x20-\x7E¡-ÿ€×]/g, '');

const INK = rgb(0.08, 0.13, 0.1), SOFT = rgb(0.36, 0.4, 0.38), LINE = rgb(0.8, 0.83, 0.79), LEAF = rgb(0.12, 0.32, 0.22), PAPER = rgb(0.96, 0.96, 0.94);
const EU_BLUE = rgb(0, 0.2, 0.6), EU_GOLD = rgb(1, 0.8, 0);

function kit(doc, page, f, b) {
  const text = (s, x, y, o = {}) => page().drawText(ascii(s), { x, y, size: o.size || 9.5, font: o.bold ? b : f, color: o.color || INK });
  const width = (s, o = {}) => (o.bold ? b : f).widthOfTextAtSize(ascii(s), o.size || 9.5);
  const right = (s, x, y, o = {}) => text(s, x - width(s, o), y, o);
  const fit = (s, max, o = {}) => { let t = ascii(s); while (t.length > 3 && width(t, o) > max) t = t.slice(0, -2); return t === ascii(s) ? t : `${t}…`; };
  const hr = (x1, x2, y, o = {}) => page().drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: o.t || 0.5, color: o.color || LINE });
  return { text, right, fit, hr, width };
}

function euFlag(page, x, y, w = 24) {
  const h = w * 2 / 3;
  page.drawRectangle({ x, y, width: w, height: h, color: EU_BLUE });
  const cx = x + w / 2, cy = y + h / 2, r = h * 0.33;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    page.drawCircle({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), size: w / 30, color: EU_GOLD });
  }
}

// one plant passport label: EU flag, "Plant Passport", then A (species), B (registration), C (batch), D (origin)
function passport(page, k, x, y, p, extra) {
  const w = 156, h = 74;
  page.drawRectangle({ x, y, width: w, height: h, borderColor: INK, borderWidth: 0.9, color: rgb(1, 1, 1) });
  euFlag(page, x + 7, y + h - 22, 21);
  k.text('Plant Passport', x + 34, y + h - 13, { bold: true, size: 9 });
  if (extra) k.text(k.fit(extra, w - 40, { size: 7.5 }), x + 34, y + h - 22, { size: 7.5, color: SOFT });
  const rowsY = [y + h - 35, y + h - 45, y + h - 55, y + h - 65];
  [['A', p.a], ['B', p.b], ['C', p.c], ['D', p.d]].forEach(([l, v], i) => {
    k.text(l, x + 8, rowsY[i], { bold: true, size: 8.5 });
    k.text(k.fit(v, w - 30, { size: 8.5, bold: l === 'C' }), x + 22, rowsY[i], { size: 8.5, bold: l === 'C' });
  });
}

const nf = (loc, d) => new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDay = (d, loc) => new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${String(d).slice(0, 10)}T12:00:00`));

// doc: see mail.js slipDoc()
export async function slipPdf(d) {
  const L = d.L, loc = d.loc;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${L.title} ${d.nummer}`);
  pdf.setAuthor(d.bedrijf.naam);
  pdf.setProducer('Campo desk');
  const f = await pdf.embedFont(StandardFonts.Helvetica), b = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  const k = kit(pdf, () => page, f, b);
  const money = v => `€ ${nf(loc, 2).format(v)}`;
  const unit = v => `€ ${nf(loc, 4).format(v)}`;
  const num = v => new Intl.NumberFormat(loc).format(v);
  const co = d.bedrijf;

  const head = (first) => {
    page.drawRectangle({ x: 0, y: 812, width: 595.28, height: 30, color: LEAF });
    k.text('CAMPO', 48, 822, { size: 13, bold: true, color: PAPER });
    k.text('International', 98, 822, { size: 11, color: rgb(0.85, 0.9, 0.86) });
    k.right(`${L.title} ${d.nummer}`, 547, 822, { size: 9, color: rgb(0.85, 0.9, 0.86) });
    if (!first) return 780;
    [co.naam, co.straat, `${co.postcode} ${co.plaats}`, co.land].forEach((l, i) => k.text(l, 48, 786 - i * 13, { color: i ? SOFT : INK, bold: !i }));
    k.text([co.telefoon, co.email].filter(Boolean).join(' · '), 48, 734, { color: SOFT, size: 8.5 });
    k.text(L.title, 330, 786, { size: 15, bold: true, color: LEAF });
    let y = 768;
    const meta = [[L.nr, d.nummer, true], [L.date, fmtDay(d.datum, loc)], [L.due, fmtDay(d.vervaldatum, loc)], [L.delivery, `${fmtDay(d.maandag, loc)} (${L.week} ${d.week})`]];
    if (d.klant.exact_code) meta.push([L.cust, d.klant.exact_code]);
    for (const [a, v, bold] of meta) { k.text(a, 330, y, { color: SOFT, size: 9 }); k.right(v, 547, y, { bold, size: 9 }); y -= 13; }
    k.text(L.to, 48, 704, { color: SOFT });
    const to = [d.klant.naam, d.klant.contact, d.klant.adres, [d.klant.postcode, d.klant.plaats].filter(Boolean).join(' '), d.klant.landnaam].filter(Boolean);
    to.forEach((l, i) => k.text(k.fit(l, 250), 48, 690 - i * 13, { bold: i === 0 }));
    if (d.klant.btw_nummer) k.text(`${L.vatno}: ${d.klant.btw_nummer}`, 48, 690 - to.length * 13, { color: SOFT, size: 8.5 });
    return 612;
  };

  // columns: boxes | pieces | description | batch | price | amount
  const cols = { box: 48, pcs: 116, desc: 128, batch: 360, price: 482, amt: 547 };
  const tableHead = y => {
    k.hr(48, 547, y + 14, { t: 0.8, color: INK });
    k.right(L.boxes, 80, y, { bold: true, size: 9 }); k.right(L.qty, cols.pcs + 4, y, { bold: true, size: 9 });
    k.text(L.desc, cols.desc + 10, y, { bold: true, size: 9 }); k.text(L.batch, cols.batch, y, { bold: true, size: 9 });
    k.right(L.price, cols.price, y, { bold: true, size: 9 }); k.right(L.amount, cols.amt, y, { bold: true, size: 9 });
    k.hr(48, 547, y - 7);
    return y - 22;
  };
  let y = tableHead(head(true));
  for (const r of d.regels) {
    if (y < 120) { page = pdf.addPage([595.28, 841.89]); y = tableHead(head(false) - 10); }
    k.right(num(r.dozen), 80, y); k.right(num(r.stuks), cols.pcs + 4, y);
    k.text(k.fit(r.omschrijving, cols.batch - cols.desc - 22), cols.desc + 10, y);
    k.text(r.partij, cols.batch, y, { bold: true });
    k.right(unit(r.prijs_eur), cols.price, y); k.right(money(r.bedrag), cols.amt, y);
    if (r.sub) { k.text(k.fit(r.sub, cols.batch - cols.desc - 22, { size: 7.5 }), cols.desc + 10, y - 9, { size: 7.5, color: SOFT }); y -= 9; }
    y -= 15;
  }
  k.hr(48, 547, y + 6);
  const need = 150 + Math.ceil(d.paspoorten.length / 3) * 84;
  if (y - need < 50) { page = pdf.addPage([595.28, 841.89]); y = head(false) - 10; }
  y -= 12;
  k.text(L.total, 360, y, { color: SOFT }); k.right(money(d.totaal), 547, y, { bold: true });
  if (d.btw_pct > 0) {
    y -= 14; k.text(`${L.vat} ${nf(loc, 0).format(d.btw_pct)}%`, 360, y, { color: SOFT }); k.right(money(d.btw_bedrag), 547, y);
    y -= 14; k.text(L.inc, 360, y, { color: SOFT }); k.right(money(d.totaal_incl), 547, y, { bold: true });
  } else { y -= 14; k.text(k.fit(d.btw_soort === 'export' ? L.export : L.reverse, 330, { size: 8.5 }), 217, y, { size: 8.5, color: SOFT }); }
  k.text(`${L.totalBoxes}: ${num(d.dozen)} · ${L.qty.toLowerCase()}: ${num(d.stuks)}`, 48, y + (d.btw_pct > 0 ? 28 : 14), { color: SOFT, size: 8.5 });
  y -= 26;
  k.text(L.rateLine(d.week, nf(loc, 4).format(d.koers)), 48, y, { color: SOFT, size: 8.5 });
  y -= 13;
  k.text(k.fit(L.payLine(d.betaaltermijn, co.iban, d.nummer), 499, { size: 8.5 }), 48, y, { color: SOFT, size: 8.5 });
  // plant passports, three in a row
  y -= 26;
  k.text(L.pp, 48, y, { bold: true, size: 9 });
  y -= 82;
  d.paspoorten.forEach((p, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    passport(page, k, 48 + col * 172, y - row * 84, p, L.ppLocal);
  });
  const foot = [co.naam, co.kvk ? `KvK ${co.kvk}` : '', co.btw ? `Btw ${co.btw}` : '', co.iban ? `IBAN ${co.iban}` : ''].filter(Boolean).join(' · ');
  for (const p of pdf.getPages()) p.drawText(ascii(foot), { x: 48, y: 30, size: 7.5, font: f, color: SOFT });
  return Buffer.from(await pdf.save());
}

// ---------------------------------------------------------------- demo: a supplier's commercial invoice with packing list
// d: { leverancier: {naam, plaats, land, email}, factuur, datum, awb, vlucht, fyto, regels: [{ omschrijving, cajas, por_caja, precio }], scan: bool }
export async function supplierPdf(d) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Factura ${d.factuur}`);
  pdf.setProducer(d.leverancier.naam);
  const f = await pdf.embedFont(StandardFonts.Helvetica), b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);
  const k = kit(pdf, () => page, f, b);
  const usd = v => `$ ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v)}`;
  const tot = v => `$ ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;
  const ink = d.scan ? rgb(0.2, 0.22, 0.24) : INK;
  if (d.scan) page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(0.975, 0.97, 0.955) });
  k.text(d.leverancier.naam, 48, 784, { size: 16, bold: true, color: ink });
  k.text(`${d.leverancier.plaats}, ${d.leverancier.landnaam}`, 48, 766, { color: SOFT });
  k.text(d.leverancier.email || '', 48, 753, { color: SOFT });
  k.text('FACTURA COMERCIAL / COMMERCIAL INVOICE', 300, 784, { size: 10.5, bold: true, color: ink });
  k.text('LISTA DE EMPAQUE / PACKING LIST', 300, 770, { size: 9, bold: true, color: SOFT });
  let y = 750;
  for (const [a, v] of [['No.', d.factuur], ['Fecha / Date', d.datum], ['AWB', d.awb], ['Vuelo / Flight', String(d.vlucht || '').replace(/→/g, '-')], ['Fitosanitario', d.fyto]]) { k.text(a, 300, y, { color: SOFT, size: 9 }); k.right(v || '-', 547, y, { size: 9, bold: a === 'AWB' }); y -= 13; }
  k.text('Consignatario / Consignee', 48, 712, { color: SOFT, size: 9 });
  ['Campo International B.V.', 'Stoomweg 10', '2631 RR Nootdorp', 'Netherlands'].forEach((l, i) => k.text(l, 48, 698 - i * 12, { bold: i === 0, size: 9.5 }));
  y = 620;
  k.hr(48, 547, y + 14, { t: 0.8, color: ink });
  k.text('Descripción / Description', 48, y, { bold: true, size: 9 }); k.right('Cajas', 318, y, { bold: true, size: 9 }); k.right('Und/caja', 368, y, { bold: true, size: 9 });
  k.right('Unidades', 422, y, { bold: true, size: 9 }); k.right('Precio', 476, y, { bold: true, size: 9 }); k.right('Total', 547, y, { bold: true, size: 9 });
  k.hr(48, 547, y - 7);
  y -= 22;
  let cajas = 0, total = 0, und = 0;
  for (const r of d.regels) {
    const u = r.cajas * r.por_caja, t = Math.round(u * r.precio * 100) / 100;
    cajas += r.cajas; und += u; total += t;
    k.text(k.fit(r.omschrijving, 235), 48, y, { color: ink });
    k.right(String(r.cajas), 318, y, { color: ink }); k.right(String(r.por_caja), 368, y, { color: ink });
    k.right(new Intl.NumberFormat('en-US').format(u), 422, y, { color: ink }); k.right(usd(r.precio), 476, y, { color: ink }); k.right(tot(t), 547, y, { color: ink });
    y -= 16;
  }
  k.hr(48, 547, y + 6);
  y -= 12;
  k.text('Total cajas / boxes', 300, y, { color: SOFT }); k.right(String(cajas), 547, y, { bold: true });
  y -= 14; k.text('Total unidades / pieces', 300, y, { color: SOFT }); k.right(new Intl.NumberFormat('en-US').format(und), 547, y);
  y -= 14; k.text('Total FOB USD', 300, y, { color: SOFT }); k.right(tot(total), 547, y, { bold: true });
  y -= 40;
  k.text('Plantas vivas para plantar. Origen: ' + d.leverancier.landnaam + '. Incoterm FOB ' + (d.leverancier.land === 'GT' ? 'Guatemala City' : 'San José') + '.', 48, y, { color: SOFT, size: 8.5 });
  if (d.nota) { y -= 14; k.text(d.nota, 48, y, { color: SOFT, size: 8.5 }); }
  return Buffer.from(await pdf.save());
}
