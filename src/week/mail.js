// The packing slip and invoice for one customer: the document (for the pdf and the preview in the desk)
// and the draft mail in the customer's own language. The desk writes it; Jan reads it and presses send.
import { pool, one, rows } from '../db.js';
import { company } from './model.js';
import { isoWeek, r2 } from './util.js';
import { slipPdf } from './docs.js';

const LOC = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', it: 'it-IT', pl: 'pl-PL', sv: 'sv-SE', da: 'da-DK', es: 'es-ES', no: 'nb-NO' };
const COUNTRY = {
  nl: { NL: 'Nederland', BE: 'België', DE: 'Duitsland', FR: 'Frankrijk', GB: 'Verenigd Koninkrijk', AT: 'Oostenrijk', CH: 'Zwitserland', DK: 'Denemarken', SE: 'Zweden', PL: 'Polen', IT: 'Italië', ES: 'Spanje', CZ: 'Tsjechië', NO: 'Noorwegen' },
  de: { NL: 'Niederlande', BE: 'Belgien', DE: 'Deutschland', FR: 'Frankreich', GB: 'Vereinigtes Königreich', AT: 'Österreich', CH: 'Schweiz', DK: 'Dänemark', SE: 'Schweden', PL: 'Polen', IT: 'Italien', ES: 'Spanien', CZ: 'Tschechien', NO: 'Norwegen' },
  fr: { NL: 'Pays-Bas', BE: 'Belgique', DE: 'Allemagne', FR: 'France', GB: 'Royaume-Uni', AT: 'Autriche', CH: 'Suisse', DK: 'Danemark', SE: 'Suède', PL: 'Pologne', IT: 'Italie', ES: 'Espagne', CZ: 'Tchéquie', NO: 'Norvège' },
  en: { NL: 'Netherlands', BE: 'Belgium', DE: 'Germany', FR: 'France', GB: 'United Kingdom', AT: 'Austria', CH: 'Switzerland', DK: 'Denmark', SE: 'Sweden', PL: 'Poland', IT: 'Italy', ES: 'Spain', CZ: 'Czechia', NO: 'Norway' },
};

// nl, en, de and fr are written out; every other language gets English
export const SLIP = {
  nl: {
    subject: n => `Pakbon en factuur ${n} - Campo International`, hi: n => (n ? `Beste ${n},` : 'Goedendag,'),
    intro: (dag, wk) => `Hierbij de pakbon en factuur van de levering van ${dag} (week ${wk}).`, passport: 'Het plantenpaspoort staat op de pakbon.',
    rate: k => `De dollarprijzen zijn omgerekend met de koers van deze week: 1 euro = ${k} dollar.`,
    pay: (n, iban, nr) => (iban ? `Graag betalen binnen ${n} dagen op ${iban}, onder vermelding van ${nr}.` : `Graag betalen binnen ${n} dagen, onder vermelding van ${nr}.`),
    ask: 'Klopt er iets niet? Laat het me weten, dan lossen we het samen op.', bye: 'Met vriendelijke groet,', file: 'Pakbon en factuur', doos: 'dozen',
    pdf: { title: 'PAKBON EN FACTUUR', nr: 'Factuurnummer', date: 'Datum', due: 'Vervaldatum', delivery: 'Levering', week: 'week', cust: 'Klantnummer', vatno: 'Btw-nummer',
      to: 'Aan', boxes: 'Dozen', qty: 'Stuks', desc: 'Omschrijving', batch: 'Batch', price: 'Prijs per stuk', amount: 'Bedrag', total: 'Totaal excl. btw', vat: 'Btw', inc: 'Totaal incl. btw',
      reverse: 'Btw verlegd: intracommunautaire levering.', export: 'Uitvoer buiten de EU: 0% btw.', totalBoxes: 'Totaal dozen', pp: 'Plantenpaspoort', ppLocal: 'Plantenpaspoort',
      rateLine: (w, k) => `Prijzen in dollars, omgerekend met de koers van week ${w}: 1 euro = ${k} dollar.`,
      payLine: (n, iban, nr) => (iban ? `Betalen binnen ${n} dagen op ${iban}, onder vermelding van ${nr}.` : `Betalen binnen ${n} dagen, onder vermelding van ${nr}.`) } },
  en: {
    subject: n => `Delivery note and invoice ${n} - Campo International`, hi: n => (n ? `Dear ${n},` : 'Hello,'),
    intro: (dag, wk) => `Please find attached the delivery note and invoice for the delivery of ${dag} (week ${wk}).`, passport: 'The plant passport is on the delivery note.',
    rate: k => `Dollar prices are converted at this week's rate: 1 euro = ${k} US dollars.`,
    pay: (n, iban, nr) => (iban ? `Please pay within ${n} days to ${iban}, quoting ${nr}.` : `Please pay within ${n} days, quoting ${nr}.`),
    ask: 'If anything is not right, just let me know and we will sort it out.', bye: 'Kind regards,', file: 'Delivery note and invoice', doos: 'boxes',
    pdf: { title: 'DELIVERY NOTE AND INVOICE', nr: 'Invoice no.', date: 'Date', due: 'Due date', delivery: 'Delivery', week: 'week', cust: 'Customer no.', vatno: 'VAT no.',
      to: 'To', boxes: 'Boxes', qty: 'Pieces', desc: 'Description', batch: 'Batch', price: 'Price per piece', amount: 'Amount', total: 'Total excl. VAT', vat: 'VAT', inc: 'Total incl. VAT',
      reverse: 'VAT reverse charged: intra-EU supply.', export: 'Export outside the EU: 0% VAT.', totalBoxes: 'Total boxes', pp: 'Plant passport', ppLocal: '',
      rateLine: (w, k) => `Prices in US dollars, converted at the rate of week ${w}: 1 euro = ${k} dollars.`,
      payLine: (n, iban, nr) => (iban ? `Payment within ${n} days to ${iban}, quoting ${nr}.` : `Payment within ${n} days, quoting ${nr}.`) } },
  de: {
    subject: n => `Lieferschein und Rechnung ${n} - Campo International`, hi: n => (n ? `Guten Tag ${n},` : 'Guten Tag,'),
    intro: (dag, wk) => `anbei der Lieferschein und die Rechnung für die Lieferung vom ${dag} (KW ${wk}).`, passport: 'Der Pflanzenpass steht auf dem Lieferschein.',
    rate: k => `Die Dollarpreise sind mit dem Kurs dieser Woche umgerechnet: 1 Euro = ${k} US-Dollar.`,
    pay: (n, iban, nr) => (iban ? `Bitte zahlen Sie innerhalb von ${n} Tagen auf ${iban} mit Angabe von ${nr}.` : `Bitte zahlen Sie innerhalb von ${n} Tagen mit Angabe von ${nr}.`),
    ask: 'Stimmt etwas nicht? Geben Sie mir kurz Bescheid, dann klären wir das.', bye: 'Mit freundlichen Grüßen', file: 'Lieferschein und Rechnung', doos: 'Kartons',
    pdf: { title: 'LIEFERSCHEIN UND RECHNUNG', nr: 'Rechnungsnummer', date: 'Datum', due: 'Fällig am', delivery: 'Lieferung', week: 'KW', cust: 'Kundennummer', vatno: 'USt-IdNr.',
      to: 'An', boxes: 'Kartons', qty: 'Stück', desc: 'Beschreibung', batch: 'Partie', price: 'Preis pro Stück', amount: 'Betrag', total: 'Summe netto', vat: 'MwSt.', inc: 'Summe brutto',
      reverse: 'Steuerschuldnerschaft des Leistungsempfängers (innergemeinschaftliche Lieferung).', export: 'Ausfuhrlieferung außerhalb der EU: 0 % MwSt.', totalBoxes: 'Kartons gesamt', pp: 'Pflanzenpass', ppLocal: 'Pflanzenpass',
      rateLine: (w, k) => `Preise in US-Dollar, umgerechnet mit dem Kurs der KW ${w}: 1 Euro = ${k} Dollar.`,
      payLine: (n, iban, nr) => (iban ? `Zahlbar innerhalb von ${n} Tagen auf ${iban}, mit Angabe von ${nr}.` : `Zahlbar innerhalb von ${n} Tagen, mit Angabe von ${nr}.`) } },
  fr: {
    subject: n => `Bon de livraison et facture ${n} - Campo International`, hi: n => (n ? `Bonjour ${n},` : 'Bonjour,'),
    intro: (dag, wk) => `Veuillez trouver ci-joint le bon de livraison et la facture de la livraison du ${dag} (semaine ${wk}).`, passport: 'Le passeport phytosanitaire figure sur le bon de livraison.',
    rate: k => `Les prix en dollars sont convertis au taux de cette semaine : 1 euro = ${k} dollars US.`,
    pay: (n, iban, nr) => (iban ? `Merci de régler sous ${n} jours sur ${iban}, en mentionnant ${nr}.` : `Merci de régler sous ${n} jours, en mentionnant ${nr}.`),
    ask: 'Si quelque chose ne va pas, dites-le-moi et nous trouverons une solution.', bye: 'Cordialement,', file: 'Bon de livraison et facture', doos: 'cartons',
    pdf: { title: 'BON DE LIVRAISON ET FACTURE', nr: 'Facture n°', date: 'Date', due: 'Échéance', delivery: 'Livraison', week: 'semaine', cust: 'N° client', vatno: 'N° TVA',
      to: 'À', boxes: 'Cartons', qty: 'Pièces', desc: 'Description', batch: 'Lot', price: 'Prix unitaire', amount: 'Montant', total: 'Total HT', vat: 'TVA', inc: 'Total TTC',
      reverse: 'Autoliquidation de la TVA : livraison intracommunautaire.', export: 'Exportation hors UE : TVA 0 %.', totalBoxes: 'Total cartons', pp: 'Passeport phytosanitaire', ppLocal: 'Passeport phytosanitaire',
      rateLine: (w, k) => `Prix en dollars US, convertis au taux de la semaine ${w} : 1 euro = ${k} dollars.`,
      payLine: (n, iban, nr) => (iban ? `Paiement sous ${n} jours sur ${iban}, en mentionnant ${nr}.` : `Paiement sous ${n} jours, en mentionnant ${nr}.`) } },
};
export const slipLang = taal => (SLIP[taal] ? taal : 'en');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const firstName = c => (c || '').trim().split(/\s+/)[0] || '';

// everything the pdf and the preview need, built fresh from the database (so a changed IBAN shows up at once)
export async function slipDoc(pakbonId) {
  const s = await one('SELECT * FROM pakbonnen WHERE id = $1', [pakbonId]);
  if (!s) return null;
  const k = await one('SELECT * FROM klanten WHERE id = $1', [s.klant_id]);
  const regels = await rows(`SELECT r.*, d.naam, d.soort, d.maat, d.code, d.exact_code, g.land AS herkomst
      FROM pakbon_regels r JOIN producten d ON d.id = r.product_id
      LEFT JOIN LATERAL (SELECT x.regio FROM partijen x LEFT JOIN partij_regels pr ON pr.partij_id = x.id AND pr.id = r.regel_id
        WHERE x.nummer = r.partij ORDER BY (pr.id IS NULL), x.id LIMIT 1) p ON true
      LEFT JOIN regios g ON g.code = p.regio
      WHERE r.pakbon_id = $1 ORDER BY r.regelnr`, [pakbonId]);
  const co = await company();
  const taal = slipLang(k.taal), T = SLIP[taal], loc = LOC[taal];
  const countries = COUNTRY[taal] || COUNTRY.en;
  const pass = new Map();
  for (const r of regels) { const key = `${r.soort}|${r.partij}`; if (!pass.has(key)) pass.set(key, { a: r.soort, b: co.pp_b, c: r.partij, d: r.herkomst || '' }); }
  const totaal = Number(s.totaal), pct = Number(s.btw_pct), btw = r2(totaal * pct / 100);
  return {
    soort: 'factuur', id: s.id, nummer: s.nummer, datum: s.datum, vervaldatum: s.vervaldatum, maandag: s.maandag, week: isoWeek(s.maandag).week,
    koers: Number(s.koers), taal, loc, L: T.pdf, bedrijf: co, betaaltermijn: k.betaaltermijn || co.betaaltermijn || 14,
    klant: { id: k.id, naam: k.naam, contact: k.contact, adres: k.adres, postcode: k.postcode, plaats: k.plaats, land: k.land, landnaam: k.land === 'NL' && taal === 'nl' ? '' : countries[k.land] || k.land, btw_nummer: k.btw_nummer, exact_code: k.exact_code, email: k.factuur_email || k.email },
    regels: regels.map(r => ({ dozen: r.dozen, stuks: r.stuks, omschrijving: `${r.naam} ${r.maat}`, sub: r.soort, partij: r.partij, product_code: r.code, product_exact: r.exact_code,
      prijs_usd: Number(r.prijs_usd), prijs_eur: Number(r.prijs_eur), bedrag: Number(r.bedrag), soort: r.soort, herkomst: r.herkomst })),
    dozen: regels.reduce((a, r) => a + r.dozen, 0), stuks: regels.reduce((a, r) => a + r.stuks, 0),
    totaal, btw_pct: pct, btw_bedrag: btw, totaal_incl: r2(totaal + btw), btw_soort: pct > 0 ? 'nl' : k.land && ['NL', 'BE', 'DE', 'FR', 'IT', 'PL', 'SE', 'DK', 'ES', 'AT', 'IE', 'LU', 'PT', 'FI', 'CZ', 'SK', 'SI', 'HU', 'RO', 'BG', 'HR', 'GR', 'CY', 'MT', 'EE', 'LV', 'LT'].includes(k.land) ? 'verlegd' : 'export',
    paspoorten: [...pass.values()],
  };
}

export async function slipPdfById(pakbonId) {
  const d = await slipDoc(pakbonId);
  return d ? { doc: d, pdf: await slipPdf(d) } : null;
}

function mailFor(d) {
  const T = SLIP[d.taal], loc = d.loc;
  const dag = new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${d.maandag}T12:00:00`));
  const k = new Intl.NumberFormat(loc, { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(d.koers);
  const money = v => new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR' }).format(v);
  const lines = [T.intro(dag, d.week), T.passport, T.rate(k), T.pay(d.betaaltermijn, d.bedrijf.iban, d.nummer), T.ask];
  const sum = `${d.nummer}: ${new Intl.NumberFormat(loc).format(d.dozen)} ${T.doos}, ${money(d.btw_pct > 0 ? d.totaal_incl : d.totaal)}`;
  const tekst = [T.hi(firstName(d.klant.contact)), '', lines[0], sum, '', ...lines.slice(1), '', T.bye, 'Jan', d.bedrijf.naam].join('\n');
  const p = t => `<p style="margin:0 0 12px">${esc(t)}</p>`;
  const html = `<div style="font:14px/1.5 Arial,Helvetica,sans-serif;color:#15201a">${p(T.hi(firstName(d.klant.contact)))}${p(lines[0])}<p style="margin:0 0 12px;font-weight:bold">${esc(sum)}</p>${lines.slice(1).map(p).join('')}<p style="margin:0">${esc(T.bye)}<br>Jan<br>${esc(d.bedrijf.naam)}</p></div>`;
  return { onderwerp: T.subject(d.nummer), tekst, html, bijlage_naam: `${T.file} ${d.nummer}.pdf` };
}

// make (or refresh) the draft mail of one packing slip; Outlook gets it when it is linked
export async function slipConcept(pakbonId, { push = true } = {}) {
  const d = await slipDoc(pakbonId);
  if (!d) return null;
  const m = mailFor(d);
  const inhoud = { soort: 'factuur', taal: d.taal, nummer: d.nummer, datum: d.datum, pakbon_id: d.id, totaal: d.totaal };
  const old = await one(`SELECT * FROM concepten WHERE pakbon_id = $1 AND status <> 'vervallen'`, [pakbonId]);
  let id;
  if (old) {
    id = old.id;
    await pool.query(`UPDATE concepten SET aan = $2, taal = $3, onderwerp = $4, tekst = $5, html = $6, inhoud = $7, bijlage_naam = $8, nummer = $9,
        status = CASE WHEN status = 'verstuurd' THEN status ELSE 'concept' END, bijgewerkt = now() WHERE id = $1`,
      [id, d.klant.email || null, d.taal, m.onderwerp, m.tekst, m.html, JSON.stringify(inhoud), m.bijlage_naam, d.nummer]);
  } else {
    id = (await one(`INSERT INTO concepten (soort, klant_id, pakbon_id, nummer, aan, taal, onderwerp, tekst, html, inhoud, bijlage_naam)
        VALUES ('factuur', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [d.klant.id, d.id, d.nummer, d.klant.email || null, d.taal, m.onderwerp, m.tekst, m.html, JSON.stringify(inhoud), m.bijlage_naam])).id;
  }
  if (push && d.klant.email) {
    const { target, pushConcept } = await import('../outlook.js');
    if (await target()) await pushConcept(id);
  }
  return id;
}
