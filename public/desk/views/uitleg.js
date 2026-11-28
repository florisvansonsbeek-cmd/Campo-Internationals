// How the desk follows Jan's week, told once, with where it stands right now next to every step.
import { api, h, icon, fNum } from '../core.js';
import { dLong, fKoers } from '../wk.js';

export async function render() {
  const d = await api('/week/overzicht');
  const st = Object.fromEntries(d.stappen.map(s => [s.key, s]));
  const now = s => (st[s] ? `${st[s].status === 'klaar' ? 'Klaar' : st[s].status === 'nu' ? 'Nu' : 'Straks'}: ${st[s].regels[0] || ''}` : '');
  const steps = [
    { t: 'De klant belt', p: 'Jan spreekt zijn klanten aan de telefoon. Wat ze willen noteert hij in een paar tikken bij Bestellen: klant, product, aantal dozen. Belt iemand die meestal bestelt nog niet, dan staat hij in het lijstje met zijn nummer en "zelfde als vorige keer".',
      waar: [['#/bestellen', 'Bestellen: telefoon']], nu: `${fNum(d.volgende.klanten)} klanten belden al voor week ${d.volgende.week}` },
    { t: 'Dinsdag: bestellen', p: 'De desk telt op wat er per product gevraagd is, per leverancier. Jan stuurt de bestelling zelf (de tekst staat klaar in het Spaans). Daarna tikt hij op "Ik heb besteld": elke leverancier krijgt een zending met het batchnummer: jaar, week en regio, zoals 264901 (2026, week 49, regio 01). Bovenaan staan de goede deals: aanbod van een leverancier dat de desk meteen aan vaste kopers koppelt, en dozen die al onderweg zijn zonder koper. Zo blijft er niets over.',
      waar: [['#/bestellen', 'Bestellen']], nu: now('bestellen') },
    { t: 'Donderdag: de bevestiging', p: 'De leverancier bevestigt wat er maandag binnenkomt. Soms 10% meer of minder, omdat Jan op het laatste moment nog iets afsprak. De desk zet bevestigd naast besteld, zodat elk verschil meteen opvalt.',
      waar: [['#/inkoop', 'Inkoop']], nu: now('bevestiging') },
    { t: 'Vrijdag: het vliegtuig en de verzendpapieren', p: 'De factura en packing list zijn officieel: dat is de inkooporder. De desk leest ze en zet elke regel klaar zoals hij in Exact komt, met het batchnummer als kostendrager. Twijfelt de desk, dan staat het origineel ernaast en kiest Jan. Per leverancier zie je wat hij levert en naar welke klanten het gaat, en een stoplicht dat zegt of het maandag binnen is.',
      waar: [['#/inkoop', 'Inkoop: inkooporder voor Exact']], nu: now('verzonden') },
    { t: 'Maandag: koers, tellen, verdelen', p: 'De dozen staan in de hal. Jan zet de dollarkoers van de week vast; daarmee rekent de desk de hele week. Hij telt de dozen (alleen wat afwijkt hoeft hij in te tikken). De desk verdeelt de dozen over de klanten volgens hun telefoonbestelling; Jan past aan wat hij wil. Elke doos krijgt een klant, zodat de loods weer netto nul is. De verdeellijst gaat geprint de hal in.',
      waar: [['#/maandag', 'Maandag']], nu: d.koers ? `Koers 1 € = $ ${fKoers(d.koers)}` : now('maandag') },
    { t: 'Maandag: pakbon en factuur', p: 'Per klant één pakbon die ook de factuur is: alle regels, de partij per regel en het plantenpaspoort erop (A soort, B Campo’s registratie, C de partij, D het land van herkomst). Na akkoord staat elke factuur als concept in Outlook, in de taal van de klant, met de pdf. Jan drukt zelf op verzenden, of geeft hem mee met de goederen. In Exact komt elke regel met de partij als kostendrager.',
      waar: [['#/pakbonnen', 'Pakbon en factuur']], nu: now('pakbonnen') },
    { t: 'Het jaar, ook in Excel', p: 'Alles wat binnenkwam en wegging staat per week, per regio en per partij bij Jaar. Daar zie je ook of elke partij op nul uitkomt. Het Excel-bestand maakt de desk bij elke download opnieuw uit de database: elke regel, met formules om zelf na te rekenen naast Exact.',
      waar: [['#/jaar', 'Jaar en Excel']], nu: null },
    { t: 'Hoe goed zijn je relaties', p: 'Bij Relaties krijgt elke klant en leverancier een score uit wat er echt gebeurde. Leveranciers: op tijd binnen, bevestigt wat je bestelt, stuurt wat hij bevestigt, de telling in de hal, uitval, papieren en prijs. Klanten: trouw, omzet, groei met het seizoen eruit, marge, betalen en hoeveel producten ze nemen. Met per relatie wat je nog meer voor ze kunt doen.',
      waar: [['#/relaties', 'Relaties'], ['#/bestellen?deel=kansen', 'Nieuwe klanten en leveranciers']], nu: null },
  ];
  return `<div class="page story wk">
    <div class="ph"><div><h1>Zo werkt de desk</h1><p>Van het telefoontje van de klant tot de factuur in zijn mail. De desk leest, telt, verdeelt en zet klaar. Jan bestelt, keurt goed en verstuurt.</p></div></div>
    <div class="grid2">
      <ol class="story-steps">${steps.map((s, i) => `<li>
        <span class="n" aria-hidden="true">${i + 1}</span>
        <div><h2>${h(s.t)}</h2><p>${h(s.p)}</p>
          <p class="where">${s.waar.map(([href, l]) => `<a href="${href}">${h(l)}</a>`).join('')}${s.nu ? `<span class="now">${icon('clock')}${h(s.nu)}</span>` : ''}</p></div>
      </li>`).join('')}</ol>
      <aside class="stack">
        <section class="panel"><header><h2>Eén nummer door alles heen</h2></header><div class="body stack" style="gap:10px">
          <p>Elke zending krijgt het batchnummer: <b>jaar, week, regio</b>. <b>264901</b> is 2026, week 49, regio 01 (Costa Rica). Leveranciers uit dezelfde regio die in dezelfde week binnenkomen, delen één batchnummer. Dat nummer is:</p>
          <ul class="plainlist"><li>C op het plantenpaspoort</li><li>de kostendrager in Exact, op de inkooporder én op elke verkoopregel</li><li>de batch in de verdeling en op de pakbon</li></ul>
          <p class="small muted">Zo telt de desk per batch en per regio wat erin en eruit ging: netto nul. De regionummers staan bij Koppelingen.</p></div></section>
        <section class="panel"><header><h2>Het stoplicht</h2></header><div class="body stack" style="gap:8px">
          <p><span class="lgt" data-l="groen"><i></i>Groen</span> niets in de weg: maandagochtend in de loods.</p>
          <p><span class="lgt" data-l="oranje"><i></i>Oranje</span> let op: papieren later dan normaal, een twijfel op het verzendbewijs, een leverancier die vaker te laat is, harde wind of sneeuw op de route, drukke vrachtweken.</p>
          <p><span class="lgt" data-l="rood"><i></i>Rood</span> echt een probleem: geen verzendbewijs terwijl het zou vliegen, een luchthaven dicht, een storm of staking op de route.</p>
          <p class="small muted">De desk kijkt naar zijn eigen signalen, naar jouw meldingen, naar het weerbericht van elke luchthaven op de dag dat de dozen er zijn (MET Norway) en naar tropische stormen (orkaancentrum NHC). Naar buiten gaan alleen de coördinaten van de luchthavens.</p></div></section>
        <section class="panel"><header><h2>Wat de desk nooit doet</h2></header><div class="body"><ul class="plainlist small"><li>Bestellen bij een leverancier</li><li>Een mail versturen zonder dat Jan op verzenden drukt</li><li>Betalen</li><li>Iets in Exact zetten zonder Jan</li></ul></div></section>
        <section class="panel"><header><h2>Deze week</h2></header><div class="body"><p>Week ${d.week}, binnen ${h(dLong(d.maandag))}.</p><p style="margin-top:8px"><a class="btn btn-line btn-sm" href="#/week">Naar Deze week</a></p></div></section>
      </aside>
    </div>
  </div>`;
}
export const actions = {};
