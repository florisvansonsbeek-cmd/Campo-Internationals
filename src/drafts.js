// Draft mails: the order for the grower and an offer per customer, in their own language, with a pdf.
// The desk writes them and can put them in Outlook as drafts; Jan reads, adjusts and presses send himself.
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { pool, rows, one } from './db.js';
import { offerDetail, planDelivery, growerArrival } from './offers.js';
import { campoPdf } from './pdf.js';
import { slipPdfById } from './week/mail.js';

const LOC = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', it: 'it-IT', pl: 'pl-PL', sv: 'sv-SE', da: 'da-DK', es: 'es-ES', no: 'nb-NO' };
const EU = new Set(['NL', 'BE', 'DE', 'FR', 'IT', 'PL', 'SE', 'DK', 'ES', 'AT', 'IE', 'LU', 'PT', 'FI', 'CZ', 'SK', 'SI', 'HU', 'RO', 'BG', 'HR', 'GR', 'CY', 'MT', 'EE', 'LV', 'LT']);
const ADDRESS = 'Campo International, Veilingweg 14, 2631 PH Nootdorp';

// ---------------------------------------------------------------- words
const OFFER = {
  nl: { subject: n => `Offerte ${n} van Campo International`, hi: n => (n ? `Beste ${n},` : 'Goedendag,'), intro: 'Zoals besproken stuur ik u hierbij de offerte voor de volgende planten:', delivery: d => `Levering: ${d}.`, valid: d => `De offerte is geldig tot ${d}.`, terms: n => `Betaling binnen ${n} dagen na factuurdatum.`, ask: 'Laat u even weten of alles klopt? Dan zetten wij het voor u klaar.', bye: 'Met vriendelijke groet,', each: 'per stuk', stem: 'per steel', total: 'Totaal excl. btw',
    pdf: { title: 'OFFERTE', nr: 'Offertenummer', date: 'Datum', valid: 'Geldig tot', delivery: 'Levering', to: 'Aan', qty: 'Aantal', desc: 'Omschrijving', price: 'Prijs', amount: 'Bedrag', total: 'Totaal excl. btw', vat: 'Btw', inc: 'Totaal incl. btw', reverse: 'Btw verlegd: intracommunautaire levering.', export: 'Export buiten de EU: 0% btw.', thanks: 'Met dank voor uw vertrouwen.' } },
  en: { subject: n => `Quotation ${n} from Campo International`, hi: n => (n ? `Dear ${n},` : 'Hello,'), intro: 'As discussed, please find our quotation for the following plants:', delivery: d => `Delivery: ${d}.`, valid: d => `This quotation is valid until ${d}.`, terms: n => `Payment within ${n} days of the invoice date.`, ask: 'Could you let me know that everything is correct? We will then get it ready for you.', bye: 'Kind regards,', each: 'each', stem: 'per stem', total: 'Total excl. VAT',
    pdf: { title: 'QUOTATION', nr: 'Quotation no.', date: 'Date', valid: 'Valid until', delivery: 'Delivery', to: 'To', qty: 'Qty', desc: 'Description', price: 'Price', amount: 'Amount', total: 'Total excl. VAT', vat: 'VAT', inc: 'Total incl. VAT', reverse: 'VAT reverse charged: intra-EU supply.', export: 'Export outside the EU: 0% VAT.', thanks: 'Thank you for your business.' } },
  de: { subject: n => `Angebot ${n} von Campo International`, hi: n => (n ? `Guten Tag ${n},` : 'Guten Tag,'), intro: 'wie besprochen sende ich Ihnen hiermit unser Angebot für die folgenden Pflanzen:', delivery: d => `Lieferung: ${d}.`, valid: d => `Das Angebot gilt bis ${d}.`, terms: n => `Zahlung innerhalb von ${n} Tagen nach Rechnungsdatum.`, ask: 'Geben Sie mir bitte kurz Bescheid, ob alles stimmt? Dann stellen wir die Ware für Sie bereit.', bye: 'Mit freundlichen Grüßen', each: 'pro Stück', stem: 'pro Stiel', total: 'Summe netto',
    pdf: { title: 'ANGEBOT', nr: 'Angebotsnummer', date: 'Datum', valid: 'Gültig bis', delivery: 'Lieferung', to: 'An', qty: 'Menge', desc: 'Beschreibung', price: 'Preis', amount: 'Betrag', total: 'Summe netto', vat: 'MwSt.', inc: 'Summe brutto', reverse: 'Steuerschuldnerschaft des Leistungsempfängers: innergemeinschaftliche Lieferung.', export: 'Ausfuhr außerhalb der EU: 0 % MwSt.', thanks: 'Vielen Dank für Ihr Vertrauen.' } },
  fr: { subject: n => `Devis ${n} de Campo International`, hi: n => (n ? `Bonjour ${n},` : 'Bonjour,'), intro: 'Comme convenu, voici notre devis pour les plantes suivantes :', delivery: d => `Livraison : ${d}.`, valid: d => `Ce devis est valable jusqu’au ${d}.`, terms: n => `Paiement à ${n} jours date de facture.`, ask: 'Pouvez-vous me confirmer que tout est correct ? Nous préparerons alors la commande.', bye: 'Cordialement,', each: 'la pièce', stem: 'la tige', total: 'Total HT',
    pdf: { title: 'DEVIS', nr: 'Devis n°', date: 'Date', valid: 'Valable jusqu’au', delivery: 'Livraison', to: 'À', qty: 'Quantité', desc: 'Description', price: 'Prix', amount: 'Montant', total: 'Total HT', vat: 'TVA', inc: 'Total TTC', reverse: 'Autoliquidation de la TVA : livraison intracommunautaire.', export: 'Exportation hors UE : TVA 0 %.', thanks: 'Merci de votre confiance.' } },
  it: { subject: n => `Offerta ${n} di Campo International`, hi: n => (n ? `Buongiorno ${n},` : 'Buongiorno,'), intro: 'come concordato, le invio la nostra offerta per le seguenti piante:', delivery: d => `Consegna: ${d}.`, valid: d => `L’offerta è valida fino al ${d}.`, terms: n => `Pagamento entro ${n} giorni dalla data della fattura.`, ask: 'Mi fa sapere se è tutto corretto? Così prepariamo la merce.', bye: 'Cordiali saluti,', each: 'al pezzo', stem: 'allo stelo', total: 'Totale IVA esclusa',
    pdf: { title: 'OFFERTA', nr: 'Offerta n.', date: 'Data', valid: 'Valida fino al', delivery: 'Consegna', to: 'A', qty: 'Quantità', desc: 'Descrizione', price: 'Prezzo', amount: 'Importo', total: 'Totale IVA esclusa', vat: 'IVA', inc: 'Totale IVA inclusa', reverse: 'Inversione contabile: cessione intracomunitaria.', export: 'Esportazione extra UE: IVA 0%.', thanks: 'Grazie per la fiducia.' } },
  pl: { subject: n => `Oferta ${n} od Campo International`, hi: n => (n ? `Dzień dobry ${n},` : 'Dzień dobry,'), intro: 'zgodnie z rozmową przesyłam ofertę na następujące rośliny:', delivery: d => `Dostawa: ${d}.`, valid: d => `Oferta jest ważna do ${d}.`, terms: n => `Płatność w ciągu ${n} dni od daty faktury.`, ask: 'Proszę o potwierdzenie, czy wszystko się zgadza. Wtedy przygotujemy towar.', bye: 'Pozdrawiam,', each: 'za sztukę', stem: 'za łodygę', total: 'Razem netto',
    pdf: { title: 'OFERTA', nr: 'Nr oferty', date: 'Data', valid: 'Ważna do', delivery: 'Dostawa', to: 'Do', qty: 'Ilość', desc: 'Opis', price: 'Cena', amount: 'Kwota', total: 'Razem netto', vat: 'VAT', inc: 'Razem brutto', reverse: 'Odwrotne obciążenie: dostawa wewnątrzwspólnotowa.', export: 'Eksport poza UE: VAT 0%.', thanks: 'Dziękujemy za zaufanie.' } },
  sv: { subject: n => `Offert ${n} från Campo International`, hi: n => (n ? `Hej ${n},` : 'Hej,'), intro: 'som vi pratade om skickar jag här vår offert på följande växter:', delivery: d => `Leverans: ${d}.`, valid: d => `Offerten gäller till ${d}.`, terms: n => `Betalning inom ${n} dagar från fakturadatum.`, ask: 'Hör gärna av dig om allt stämmer, så gör vi i ordning varorna.', bye: 'Vänliga hälsningar,', each: 'per styck', stem: 'per stjälk', total: 'Summa exkl. moms',
    pdf: { title: 'OFFERT', nr: 'Offertnr', date: 'Datum', valid: 'Gäller till', delivery: 'Leverans', to: 'Till', qty: 'Antal', desc: 'Beskrivning', price: 'Pris', amount: 'Belopp', total: 'Summa exkl. moms', vat: 'Moms', inc: 'Summa inkl. moms', reverse: 'Omvänd skattskyldighet: gemenskapsintern leverans.', export: 'Export utanför EU: 0 % moms.', thanks: 'Tack för förtroendet.' } },
  da: { subject: n => `Tilbud ${n} fra Campo International`, hi: n => (n ? `Hej ${n},` : 'Hej,'), intro: 'som aftalt sender jeg hermed vores tilbud på følgende planter:', delivery: d => `Levering: ${d}.`, valid: d => `Tilbuddet gælder til ${d}.`, terms: n => `Betaling inden ${n} dage fra fakturadato.`, ask: 'Giv mig gerne besked, om alt stemmer, så gør vi varerne klar.', bye: 'Med venlig hilsen', each: 'pr. stk.', stem: 'pr. stilk', total: 'I alt ekskl. moms',
    pdf: { title: 'TILBUD', nr: 'Tilbudsnr.', date: 'Dato', valid: 'Gælder til', delivery: 'Levering', to: 'Til', qty: 'Antal', desc: 'Beskrivelse', price: 'Pris', amount: 'Beløb', total: 'I alt ekskl. moms', vat: 'Moms', inc: 'I alt inkl. moms', reverse: 'Omvendt betalingspligt: EU-levering.', export: 'Eksport uden for EU: 0 % moms.', thanks: 'Tak for tilliden.' } },
  es: { subject: n => `Presupuesto ${n} de Campo International`, hi: n => (n ? `Buenos días, ${n}:` : 'Buenos días:'), intro: 'Tal como hablamos, le envío nuestro presupuesto para las siguientes plantas:', delivery: d => `Entrega: ${d}.`, valid: d => `El presupuesto es válido hasta el ${d}.`, terms: n => `Pago a ${n} días desde la fecha de factura.`, ask: '¿Me confirma si todo es correcto? Así le preparamos la mercancía.', bye: 'Un saludo,', each: 'por unidad', stem: 'por tallo', total: 'Total sin IVA',
    pdf: { title: 'PRESUPUESTO', nr: 'Presupuesto n.º', date: 'Fecha', valid: 'Válido hasta', delivery: 'Entrega', to: 'Para', qty: 'Cantidad', desc: 'Descripción', price: 'Precio', amount: 'Importe', total: 'Total sin IVA', vat: 'IVA', inc: 'Total con IVA', reverse: 'Inversión del sujeto pasivo: entrega intracomunitaria.', export: 'Exportación fuera de la UE: IVA 0 %.', thanks: 'Gracias por su confianza.' } },
  no: { subject: n => `Tilbud ${n} fra Campo International`, hi: n => (n ? `Hei ${n},` : 'Hei,'), intro: 'som avtalt sender jeg her vårt tilbud på følgende planter:', delivery: d => `Levering: ${d}.`, valid: d => `Tilbudet gjelder til ${d}.`, terms: n => `Betaling innen ${n} dager fra fakturadato.`, ask: 'Gi meg gjerne beskjed om alt stemmer, så gjør vi varene klare.', bye: 'Vennlig hilsen', each: 'per stk.', stem: 'per stilk', total: 'Sum ekskl. mva.',
    pdf: { title: 'TILBUD', nr: 'Tilbudsnr.', date: 'Dato', valid: 'Gyldig til', delivery: 'Levering', to: 'Til', qty: 'Antall', desc: 'Beskrivelse', price: 'Pris', amount: 'Beløp', total: 'Sum ekskl. mva.', vat: 'Mva.', inc: 'Sum inkl. mva.', reverse: 'Omvendt avgiftsplikt.', export: 'Eksport utenfor EU: 0 % mva.', thanks: 'Takk for tilliten.' } },
};
const ORDER = {
  nl: { subject: (n, d) => `Bestelling ${n} van Campo International, levering ${d}`, hi: n => (n ? `Beste ${n},` : 'Goedendag,'), intro: r => `Naar aanleiding van uw aanbod${r ? ` ${r}` : ''} bestellen wij graag:`, delivery: d => `Graag leveren op ${d} bij ${ADDRESS}.`, prices: 'De prijzen zijn die uit uw aanbod; graag dezelfde prijzen op de factuur.', confirm: 'Wilt u de bestelling kort bevestigen, met de verwachte aankomsttijd?', bye: 'Met vriendelijke groet,', total: 'Totaal excl. btw',
    pdf: { title: 'BESTELLING', nr: 'Bestelnummer', date: 'Datum', ref: 'Uw aanbod', delivery: 'Levering', to: 'Aan', qty: 'Aantal', desc: 'Omschrijving', price: 'Prijs', amount: 'Bedrag', total: 'Totaal excl. btw' } },
  de: { subject: (n, d) => `Bestellung ${n} von Campo International, Lieferung ${d}`, hi: n => (n ? `Guten Tag ${n},` : 'Guten Tag,'), intro: r => `bezugnehmend auf Ihr Angebot${r ? ` ${r}` : ''} bestellen wir gern:`, delivery: d => `Bitte liefern Sie am ${d} an ${ADDRESS}, Niederlande.`, prices: 'Die Preise sind die aus Ihrem Angebot; bitte dieselben Preise auf der Rechnung.', confirm: 'Bitte bestätigen Sie die Bestellung kurz mit der voraussichtlichen Ankunftszeit.', bye: 'Mit freundlichen Grüßen', total: 'Summe netto',
    pdf: { title: 'BESTELLUNG', nr: 'Bestellnummer', date: 'Datum', ref: 'Ihr Angebot', delivery: 'Lieferung', to: 'An', qty: 'Menge', desc: 'Beschreibung', price: 'Preis', amount: 'Betrag', total: 'Summe netto' } },
  en: { subject: (n, d) => `Order ${n} from Campo International, delivery ${d}`, hi: n => (n ? `Dear ${n},` : 'Hello,'), intro: r => `Further to your offer${r ? ` ${r}` : ''}, we would like to order:`, delivery: d => `Please deliver on ${d} to ${ADDRESS}, the Netherlands.`, prices: 'Prices as in your offer; please use the same prices on the invoice.', confirm: 'Could you briefly confirm the order, with the expected arrival time?', bye: 'Kind regards,', total: 'Total excl. VAT',
    pdf: { title: 'PURCHASE ORDER', nr: 'Order no.', date: 'Date', ref: 'Your offer', delivery: 'Delivery', to: 'To', qty: 'Qty', desc: 'Description', price: 'Price', amount: 'Amount', total: 'Total excl. VAT' } },
};
const growerLang = land => (['NL', 'BE'].includes(land) ? 'nl' : ['DE', 'AT', 'CH'].includes(land) ? 'de' : 'en');
const firstName = c => (c || '').trim().split(/\s+/)[0] || '';
const r2 = v => Math.round(v * 100) / 100;
const money = (v, loc, dec = 2) => new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
const num = (v, loc) => new Intl.NumberFormat(loc).format(v);
const longDay = (d, loc) => new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(String(d).length === 10 ? d + 'T12:00:00' : d));
const atTime = (d, loc) => new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' }).format(new Date(d));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plantLabel = (r, taal) => {
  const base = taal === 'nl' ? r.naam : (r.en || r.naam);
  return [base, r.potmaat, r.hoogte].filter(Boolean).join(' ');
};

function tableHtml(regels, loc, L, totaal) {
  const td = 'padding:6px 10px;border-bottom:1px solid #d8ddd2;';
  const totalLabel = L.total;
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0;font:14px/1.4 Arial,Helvetica,sans-serif;color:#15201a">
<tr style="background:#e8ebe3"><th align="right" style="${td}">${esc(L.qty)}</th><th align="left" style="${td}">${esc(L.desc)}</th><th align="right" style="${td}">${esc(L.price)}</th><th align="right" style="${td}">${esc(L.amount)}</th></tr>
${regels.map(r => `<tr><td align="right" style="${td}">${esc(num(r.aantal, loc))}</td><td style="${td}">${esc(r.omschrijving)}</td><td align="right" style="${td}white-space:nowrap">${esc(money(r.prijs, loc, r.prijs < 1 ? 3 : 2))}</td><td align="right" style="${td}white-space:nowrap">${esc(money(r.bedrag, loc))}</td></tr>`).join('\n')}
<tr><td></td><td style="padding:8px 10px;font-weight:bold">${esc(totalLabel)}</td><td></td><td align="right" style="padding:8px 10px;font-weight:bold;white-space:nowrap">${esc(money(totaal, loc))}</td></tr>
</table>`;
}
function wrapHtml(paragraphs, table, signature) {
  const p = t => `<p style="margin:0 0 12px">${esc(t).replace(/\n/g, '<br>')}</p>`;
  return `<div style="font:14px/1.5 Arial,Helvetica,sans-serif;color:#15201a">${paragraphs.before.map(p).join('')}${table}${paragraphs.after.map(p).join('')}${p(signature)}</div>`;
}

// ---------------------------------------------------------------- the order for the grower
function orderContent(d, k, nummer) {
  const taal = growerLang(k.land), T = ORDER[taal], loc = LOC[taal];
  const regels = d.regels.filter(r => r.plant_id && r.te_bestellen > 0).map(r => ({ aantal: r.te_bestellen, omschrijving: r.omschrijving, prijs: r.prijs, bedrag: r2(r.te_bestellen * r.prijs) }));
  const totaal = r2(regels.reduce((s, r) => s + r.bedrag, 0));
  const lev = d.aanbod.levering ? longDay(d.aanbod.levering, loc) : '';
  const inhoud = {
    soort: 'bestelling', taal, nummer, datum: new Date().toISOString().slice(0, 10), ref: d.aanbod.nummer || null, regels, totaal,
    levering_tekst: lev, adres_tekst: ADDRESS, aan: [k.naam, k.contact || '', k.plaats ? `${k.plaats}${k.land && k.land !== 'NL' ? `, ${k.land}` : ''}` : ''].filter(Boolean),
    voet: [T.prices, T.confirm],
  };
  const text = [T.hi(firstName(k.contact)), '', T.intro(d.aanbod.nummer), '', ...regels.map(r => `${num(r.aantal, loc)} × ${r.omschrijving} à ${money(r.prijs, loc, r.prijs < 1 ? 3 : 2)}`), '', `${T.total}: ${money(totaal, loc)}`, '', lev ? T.delivery(lev) : null, T.prices, T.confirm, '', T.bye, 'Jan', 'Campo International'].filter(x => x !== null).join('\n');
  const html = wrapHtml({ before: [T.hi(firstName(k.contact)), T.intro(d.aanbod.nummer)], after: [lev ? T.delivery(lev) : '', T.prices, T.confirm].filter(Boolean) }, tableHtml(regels, loc, T.pdf, totaal), `${T.bye}\nJan\nCampo International`);
  return { taal, onderwerp: T.subject(nummer, lev), tekst: text, html, inhoud, bijlage_naam: `${T.pdf.title === 'BESTELLING' ? 'Bestelling' : T.pdf.title === 'BESTELLUNG' ? 'Bestellung' : 'Order'} ${nummer}.pdf` };
}

// ---------------------------------------------------------------- an offer for one customer
function quoteContent(d, k, lines, nummer) {
  const taal = OFFER[k.taal] ? k.taal : 'en', T = OFFER[taal], loc = LOC[taal];
  const regels = lines.map(l => ({ aantal: l.aantal, omschrijving: plantLabel(l, taal), prijs: l.verkoopprijs, bedrag: r2(l.aantal * l.verkoopprijs), eenheid: l.eenheid }));
  const totaal = r2(regels.reduce((s, r) => s + r.bedrag, 0));
  const lev = k.plan ? `${longDay(k.plan.aankomst, loc)} ${atTime(k.plan.aankomst, loc)}` : d.aanbod.levering ? longDay(d.aanbod.levering, loc) : '';
  const geldig = new Date(Math.max(Date.now() + 36e5 * 4, d.aanbod.geldig_tot ? new Date(d.aanbod.geldig_tot).getTime() - 36e5 : Date.now() + 36e5 * 20));
  const btw = k.land === 'NL' ? 9 : 0;
  const btwRegel = k.land === 'NL' ? null : EU.has(k.land) ? T.pdf.reverse : T.pdf.export;
  const inhoud = {
    soort: 'offerte', taal, nummer, datum: new Date().toISOString().slice(0, 10), geldig_tot: geldig.toISOString(), regels, totaal, btw_pct: btw, btw_regel: btwRegel,
    levering_tekst: lev, aan: [k.naam, k.contact || '', k.adres || '', [k.postcode, k.plaats].filter(Boolean).join(' '), k.land && k.land !== 'NL' ? k.land : ''].filter(Boolean),
    voet: [T.terms(k.betaaltermijn || 14), T.pdf.thanks],
  };
  const validTxt = `${longDay(geldig, loc)} ${atTime(geldig, loc)}`;
  const text = [T.hi(firstName(k.contact)), '', T.intro, '', ...regels.map(r => `${num(r.aantal, loc)} × ${r.omschrijving}, ${money(r.prijs, loc, r.prijs < 1 ? 3 : 2)} ${r.eenheid === 'stelen' ? T.stem : T.each}`), '', `${T.total}: ${money(totaal, loc)}`, '', lev ? T.delivery(lev) : null, T.valid(validTxt), T.terms(k.betaaltermijn || 14), '', T.ask, '', T.bye, 'Jan', 'Campo International'].filter(x => x !== null).join('\n');
  const html = wrapHtml({ before: [T.hi(firstName(k.contact)), T.intro], after: [lev ? T.delivery(lev) : '', T.valid(validTxt), T.terms(k.betaaltermijn || 14), T.ask].filter(Boolean) }, tableHtml(regels, loc, T.pdf, totaal), `${T.bye}\nJan\nCampo International`);
  const word = { nl: 'Offerte', en: 'Quotation', de: 'Angebot', fr: 'Devis', it: 'Offerta', pl: 'Oferta', sv: 'Offert', da: 'Tilbud', es: 'Presupuesto', no: 'Tilbud' }[taal];
  return { taal, onderwerp: T.subject(nummer), tekst: text, html, inhoud, bijlage_naam: `${word} ${nummer}.pdf` };
}

export async function conceptPdf(c) {
  const i = c.inhoud;
  // a packing slip with invoice is built fresh from the database, with the plant passport on it
  if (i.soort === 'factuur' || c.soort === 'factuur') {
    const out = await slipPdfById(c.pakbon_id || i.pakbon_id);
    if (!out) throw new Error('De pakbon bij dit concept bestaat niet meer.');
    return out.pdf;
  }
  const L = i.soort === 'bestelling' ? ORDER[i.taal].pdf : OFFER[i.taal].pdf;
  return campoPdf(i, L, LOC[i.taal]);
}

// a .eml that opens in Outlook as a new, unsent message: Jan only has to press send
export async function conceptEml(c, { from = null, draftHeader = true } = {}) {
  const pdf = await conceptPdf(c);
  const mail = new MailComposer({
    from: from || undefined, to: c.aan || undefined, subject: c.onderwerp, text: c.tekst, html: c.html,
    attachments: [{ filename: c.bijlage_naam || `${c.nummer}.pdf`, content: pdf, contentType: 'application/pdf' }],
    headers: { ...(draftHeader ? { 'X-Unsent': '1' } : {}), 'X-Campo-Concept': `${c.id}` },
  });
  return new Promise((resolve, reject) => mail.compile().build((err, msg) => (err ? reject(err) : resolve(msg))));
}

// ---------------------------------------------------------------- make or refresh every draft of one offer
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function makeDrafts(aanbodId) {
  const d = await offerDetail(aanbodId, { withRisk: false });
  if (!d || d.aanbod.status === 'afgewezen') return { changed: [], removed: [] };
  const kweker = await one('SELECT * FROM kwekers WHERE id = $1', [d.aanbod.kweker_id]);
  const existing = await rows(`SELECT * FROM concepten WHERE aanbod_id = $1 AND status <> 'vervallen'`, [aanbodId]);
  const changed = [], removed = [];
  const yy = String(new Date().getFullYear()).slice(2);
  const upsert = async (soort, klantId, build) => {
    const old = existing.find(c => c.soort === soort && (c.klant_id || null) === (klantId || null));
    const nummer = soort === 'bestelling' ? d.aanbod.bestelnummer
      : old ? old.nummer : `CI-O-${yy}-${String((await one(`SELECT nextval('offertenummer_seq') AS n`)).n).padStart(4, '0')}`;
    const m = build(nummer);
    const aan = soort === 'bestelling' ? kweker.email : m.aan;
    const keep = { ...m.inhoud, datum: old ? old.inhoud.datum : m.inhoud.datum, geldig_tot: old && old.inhoud.geldig_tot ? old.inhoud.geldig_tot : m.inhoud.geldig_tot };
    if (old) {
      const before = { ...old.inhoud, datum: null, geldig_tot: null }, after = { ...keep, datum: null, geldig_tot: null };
      if (same(before, after) && old.aan === aan) return old.id;
      const r = await one(`UPDATE concepten SET aan = $2, taal = $3, onderwerp = $4, tekst = $5, html = $6, inhoud = $7, bijlage_naam = $8,
          status = CASE WHEN status = 'verstuurd' THEN status ELSE 'concept' END, bijgewerkt = now() WHERE id = $1 RETURNING id`,
        [old.id, aan || null, m.taal, m.onderwerp, m.tekst, m.html, JSON.stringify(keep), m.bijlage_naam]);
      changed.push(r.id);
      return r.id;
    }
    const r = await one(`INSERT INTO concepten (aanbod_id, soort, kweker_id, klant_id, nummer, aan, taal, onderwerp, tekst, html, inhoud, bijlage_naam)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [aanbodId, soort, soort === 'bestelling' ? kweker.id : null, klantId || null, nummer, aan || null, m.taal, m.onderwerp, m.tekst, m.html, JSON.stringify(keep), m.bijlage_naam]);
    changed.push(r.id);
    return r.id;
  };

  if (d.regels.some(r => r.plant_id && r.te_bestellen > 0)) {
    if (!d.aanbod.bestelnummer) {
      const n = (await one(`SELECT nextval('bestelnummer_seq') AS n`)).n;
      d.aanbod.bestelnummer = `CI-B-${yy}-${String(n).padStart(4, '0')}`;
      await pool.query('UPDATE aanbiedingen SET bestelnummer = $2 WHERE id = $1 AND bestelnummer IS NULL', [aanbodId, d.aanbod.bestelnummer]);
    }
    await upsert('bestelling', null, () => orderContent(d, kweker, d.aanbod.bestelnummer));
  }
  const goodsIn = growerArrival(kweker, d.aanbod.levering || new Date(Date.now() + 864e5).toISOString().slice(0, 10));
  const klanten = await rows('SELECT * FROM klanten WHERE id = ANY($1)', [d.klanten.map(k => k.klant_id)]);
  for (const k of d.klanten) {
    const lines = k.regels.filter(l => l.bron === 'aanbod' && l.status !== 'nee');
    const old = existing.find(c => c.soort === 'offerte' && c.klant_id === k.klant_id);
    if (!lines.length) {
      if (old && old.status !== 'verstuurd') { await pool.query(`UPDATE concepten SET status = 'vervallen', bijgewerkt = now() WHERE id = $1`, [old.id]); removed.push(old); }
      continue;
    }
    const full = klanten.find(x => x.id === k.klant_id);
    const plants = await rows('SELECT id, naam, potmaat, hoogte, eenheid FROM planten WHERE id = ANY($1)', [lines.map(l => l.plant_id)]);
    const withPlant = lines.map(l => { const p = plants.find(x => x.id === l.plant_id) || {}; return { ...l, naam: p.naam, potmaat: p.potmaat, hoogte: p.hoogte, eenheid: p.eenheid }; });
    await upsert('offerte', k.klant_id, nr => ({ ...quoteContent(d, { ...full, plan: planDelivery(full, goodsIn) }, withPlant, nr), aan: full.email }));
  }
  return { changed, removed };
}

export async function conceptById(id) {
  return one('SELECT * FROM concepten WHERE id = $1', [id]);
}
