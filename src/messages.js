// Messages to customers, in their own language. The desk drafts them; Jan reads and sends.

const LOCALE = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', it: 'it-IT', pl: 'pl-PL', sv: 'sv-SE', da: 'da-DK', es: 'es-ES', no: 'nb-NO' };

const T = {
  nl: { hi: n => `Goedemorgen ${n},`, intro: o => `Voor ${o ? `bestelling ${o}` : 'jullie bestelling'} komt het volgende binnen:`, eta: d => `Verwacht bij jullie: ${d}.`, bye: 'Groet,',
        offer: (lines, until) => `We hebben vandaag nog een mooie partij over:\n${lines}\n\nInteresse? Laat het ${until} weten, dan gaat het vandaag nog mee.`, late: (min, d) => `De levering loopt ongeveer ${min} minuten later dan gepland. Nieuwe verwachte tijd: ${d}.`, each: 'per stuk', instead: 'normaal', until: 'vóór 12:00', around: 'rond', subjectDelivery: o => `Levering ${o || ''}`.trim(), subjectOffer: 'Restpartij van vandaag' },
  en: { hi: n => `Good morning ${n},`, intro: o => `For ${o ? `order ${o}` : 'your order'} the following is on its way:`, eta: d => `Expected with you: ${d}.`, bye: 'Kind regards,',
        offer: (lines, until) => `We have a nice batch left today:\n${lines}\n\nInterested? Let us know ${until} and it ships today.`, late: (min, d) => `The delivery is running about ${min} minutes late. New expected time: ${d}.`, each: 'each', instead: 'usually', until: 'before 12:00', around: 'around', subjectDelivery: o => `Delivery ${o || ''}`.trim(), subjectOffer: 'Today’s spare batch' },
  de: { hi: n => `Guten Morgen ${n},`, intro: o => `für ${o ? `Ihre Bestellung ${o}` : 'Ihre Bestellung'} ist Folgendes unterwegs:`, eta: d => `Voraussichtlich bei Ihnen: ${d}.`, bye: 'Viele Grüße',
        offer: (lines, until) => `Heute haben wir noch eine schöne Partie übrig:\n${lines}\n\nInteresse? Geben Sie uns ${until} Bescheid, dann geht sie heute noch mit.`, late: (min, d) => `Die Lieferung verspätet sich um etwa ${min} Minuten. Neue voraussichtliche Zeit: ${d}.`, each: 'pro Stück', instead: 'sonst', until: 'bis 12:00 Uhr', around: 'gegen', subjectDelivery: o => `Lieferung ${o || ''}`.trim(), subjectOffer: 'Restpartie von heute' },
  fr: { hi: n => `Bonjour ${n},`, intro: o => `Pour ${o ? `votre commande ${o}` : 'votre commande'}, voici ce qui arrive :`, eta: d => `Livraison prévue : ${d}.`, bye: 'Cordialement,',
        offer: (lines, until) => `Il nous reste aujourd’hui un beau lot :\n${lines}\n\nIntéressé ? Dites-le-nous ${until} et il part aujourd’hui.`, late: (min, d) => `La livraison a environ ${min} minutes de retard. Nouvelle heure prévue : ${d}.`, each: 'pièce', instead: 'au lieu de', until: 'avant 12h00', around: 'vers', subjectDelivery: o => `Livraison ${o || ''}`.trim(), subjectOffer: 'Lot disponible aujourd’hui' },
  it: { hi: n => `Buongiorno ${n},`, intro: o => `per ${o ? `l’ordine ${o}` : 'il vostro ordine'} arriva:`, eta: d => `Consegna prevista: ${d}.`, bye: 'Cordiali saluti,',
        offer: (lines, until) => `Oggi ci resta un bel lotto:\n${lines}\n\nInteressati? Fatecelo sapere ${until} e parte oggi stesso.`, late: (min, d) => `La consegna è in ritardo di circa ${min} minuti. Nuovo orario previsto: ${d}.`, each: 'al pezzo', instead: 'di solito', until: 'entro le 12:00', around: 'verso le', subjectDelivery: o => `Consegna ${o || ''}`.trim(), subjectOffer: 'Lotto disponibile oggi' },
  pl: { hi: n => `Dzień dobry ${n},`, intro: o => `do ${o ? `zamówienia ${o}` : 'zamówienia'} jedzie:`, eta: d => `Przewidywana dostawa: ${d}.`, bye: 'Pozdrawiam,',
        offer: (lines, until) => `Dziś zostało nam jeszcze:\n${lines}\n\nZainteresowani? Prosimy o wiadomość ${until}, wtedy wyślemy dziś.`, late: (min, d) => `Dostawa jest opóźniona o około ${min} minut. Nowy przewidywany czas: ${d}.`, each: 'za sztukę', instead: 'zwykle', until: 'do 12:00', around: 'około', subjectDelivery: o => `Dostawa ${o || ''}`.trim(), subjectOffer: 'Dzisiejsza partia' },
  sv: { hi: n => `God morgon ${n},`, intro: o => `Till ${o ? `beställning ${o}` : 'er beställning'} kommer följande:`, eta: d => `Beräknad leverans: ${d}.`, bye: 'Vänliga hälsningar,',
        offer: (lines, until) => `Vi har ett fint parti kvar i dag:\n${lines}\n\nIntresserade? Hör av er ${until} så skickas det i dag.`, late: (min, d) => `Leveransen är ungefär ${min} minuter försenad. Ny beräknad tid: ${d}.`, each: 'per styck', instead: 'normalt', until: 'före 12:00', around: 'runt', subjectDelivery: o => `Leverans ${o || ''}`.trim(), subjectOffer: 'Dagens restparti' },
  da: { hi: n => `Godmorgen ${n},`, intro: o => `Til ${o ? `bestilling ${o}` : 'jeres bestilling'} kommer følgende:`, eta: d => `Forventet levering: ${d}.`, bye: 'Med venlig hilsen',
        offer: (lines, until) => `Vi har et flot parti tilbage i dag:\n${lines}\n\nInteresseret? Giv besked ${until}, så sendes det i dag.`, late: (min, d) => `Leveringen er cirka ${min} minutter forsinket. Ny forventet tid: ${d}.`, each: 'pr. stk.', instead: 'normalt', until: 'før kl. 12', around: 'omkring kl.', subjectDelivery: o => `Levering ${o || ''}`.trim(), subjectOffer: 'Dagens restparti' },
  es: { hi: n => `Buenos días, ${n}:`, intro: o => `Para ${o ? `el pedido ${o}` : 'su pedido'} llega lo siguiente:`, eta: d => `Entrega prevista: ${d}.`, bye: 'Un saludo,',
        offer: (lines, until) => `Hoy nos queda un buen lote:\n${lines}\n\n¿Le interesa? Díganoslo ${until} y sale hoy mismo.`, late: (min, d) => `La entrega lleva unos ${min} minutos de retraso. Nueva hora prevista: ${d}.`, each: 'por unidad', instead: 'normalmente', until: 'antes de las 12:00', around: 'hacia las', subjectDelivery: o => `Entrega ${o || ''}`.trim(), subjectOffer: 'Lote disponible hoy' },
  no: { hi: n => `God morgen ${n},`, intro: o => `Til ${o ? `bestilling ${o}` : 'bestillingen'} kommer følgende:`, eta: d => `Forventet levering: ${d}.`, bye: 'Vennlig hilsen',
        offer: (lines, until) => `Vi har et fint parti igjen i dag:\n${lines}\n\nInteressert? Gi beskjed ${until}, så sendes det i dag.`, late: (min, d) => `Leveransen er omtrent ${min} minutter forsinket. Ny forventet tid: ${d}.`, each: 'per stk.', instead: 'vanligvis', until: 'før kl. 12', around: 'rundt', subjectDelivery: o => `Levering ${o || ''}`.trim(), subjectOffer: 'Dagens restparti' },
};

const firstName = contact => (contact || '').trim().split(/\s+/)[0] || '';
const tr = taal => T[taal] || T.en;

export function plantLabel(p, taal) {
  const name = taal === 'nl' ? p.naam : (p.en || p.naam);
  const size = [p.potmaat, p.hoogte].filter(Boolean).join(' ');
  return `${name}${size ? ' ' + size : ''}`;
}

export function when(d, taal) {
  if (!d) return '';
  const t = tr(taal), loc = LOCALE[taal] || 'en-GB';
  const date = new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long', timeZone: process.env.TZ || 'Europe/Amsterdam' }).format(new Date(d));
  const time = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Amsterdam' }).format(new Date(d));
  return `${date} ${t.around} ${time}`;
}

const money = (v, taal) => new Intl.NumberFormat(LOCALE[taal] || 'en-GB', { style: 'currency', currency: 'EUR' }).format(v);
const qty = (n, taal) => new Intl.NumberFormat(LOCALE[taal] || 'en-GB').format(n);

// lines: [{ plant, aantal }]
export function deliveryMessage({ klant, lines, eta, order }) {
  const t = tr(klant.taal);
  const list = lines.map(l => `• ${qty(l.aantal, klant.taal)} × ${plantLabel(l.plant, klant.taal)}`).join('\n');
  const body = [t.hi(firstName(klant.contact)), '', t.intro(order), list, '', eta ? t.eta(when(eta, klant.taal)) : null, '', t.bye, 'Jan', 'Campo International'].filter(x => x !== null).join('\n');
  return { onderwerp: t.subjectDelivery(order), tekst: body.replace(/\n{3,}/g, '\n\n') };
}

// lines: [{ plant, aantal, prijs, normaal }]
export function offerMessage({ klant, lines }) {
  const t = tr(klant.taal);
  const list = lines.map(l => `• ${qty(l.aantal, klant.taal)} × ${plantLabel(l.plant, klant.taal)}${l.prijs ? `, ${money(l.prijs, klant.taal)} ${t.each}${l.normaal && l.normaal > l.prijs ? ` (${t.instead} ${money(l.normaal, klant.taal)})` : ''}` : ''}`).join('\n');
  const body = [t.hi(firstName(klant.contact)), '', t.offer(list, t.until), '', t.bye, 'Jan', 'Campo International'].join('\n');
  return { onderwerp: t.subjectOffer, tekst: body };
}

export function delayMessage({ klant, minutes, eta }) {
  const t = tr(klant.taal);
  const body = [t.hi(firstName(klant.contact)), '', t.late(Math.round(minutes / 5) * 5, when(eta, klant.taal)), '', t.bye, 'Jan', 'Campo International'].join('\n');
  return { onderwerp: t.subjectDelivery(''), tekst: body };
}

export const LANG_NAME = { nl: 'Nederlands', en: 'Engels', de: 'Duits', fr: 'Frans', it: 'Italiaans', pl: 'Pools', sv: 'Zweeds', da: 'Deens', es: 'Spaans', no: 'Noors' };
