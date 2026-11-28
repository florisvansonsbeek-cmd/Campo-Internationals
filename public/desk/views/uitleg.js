// How the desk follows Jan's week, told once, with where it stands right now next to every step.
import { api, h, icon, fNum } from '../core.js';
import { dLong, fKoers } from '../wk.js';

export async function render() {
  const d = await api('/week/overzicht');
  const st = Object.fromEntries(d.stappen.map(s => [s.key, s]));
  const now = s => (st[s] ? `${st[s].status === 'klaar' ? 'Klaar' : st[s].status === 'nu' ? 'Nu' : 'Straks'}: ${st[s].regels[0] || ''}` : '');
  const steps = [
    { t: 'De klant belt', p: 'Jan spreekt zijn klanten aan de telefoon. Wat ze willen noteert hij in een paar tikken bij Bestellen en relaties, deel Bestellen: klant, product, aantal dozen. Belt iemand die meestal bestelt nog niet, dan staat hij in het lijstje met zijn nummer en "zelfde als vorige keer".',
      waar: [['#/handel?deel=bestellen', 'Bestellen: telefoon']], nu: `${fNum(d.volgende.klanten)} klanten belden al voor week ${d.volgende.week}` },
    { t: 'Dinsdag: bestellen', p: 'De desk telt op wat er per product gevraagd is, per leverancier. Jan stuurt de bestelling zelf (de tekst staat klaar in het Spaans). Daarna tikt hij op "Ik heb besteld": elke leverancier krijgt een zending met het batchnummer: jaar, week en regio, zoals 264901 (2026, week 49, regio 01). Bij Deals staat aanbod van een leverancier dat de desk één op één aan vaste kopers koppelt, en dozen die al onderweg zijn zonder koper. Zo blijft er niets over.',
      waar: [['#/handel?deel=bestellen', 'Bestellen']], nu: now('bestellen') },
    { t: 'Donderdag: de bevestiging', p: 'De leverancier bevestigt wat er maandag binnenkomt. Soms 10% meer of minder, omdat Jan op het laatste moment nog iets afsprak. De desk zet bevestigd naast besteld, zodat elk verschil meteen opvalt.',
      waar: [['#/inkoop', 'Overzicht']], nu: now('bevestiging') },
    { t: 'Vrijdag: het vliegtuig en de verzendpapieren', p: 'De factura en packing list zijn officieel: dat is de inkooporder. De desk leest ze en zet elke regel klaar zoals hij in Exact komt, met het batchnummer als kostendrager. Twijfelt de desk, dan staat het origineel ernaast en kiest Jan. Op het Overzicht zie je per leverancier wat hij levert en naar welke klanten het gaat, en een stoplicht dat zegt of het maandag binnen is. Bovenaan staat wat nog geen bestemming heeft.',
      waar: [['#/inkoop', 'Overzicht'], ['#/handel?deel=vervoer', 'Vervoer']], nu: now('verzonden') },
    { t: 'Maandag: binnen', p: 'Jan zet de dollarkoers van de week vast; daarmee rekent de desk alle facturen. Dan telt hij de dozen. De desk vulde per regel al in wat de papieren zeggen; wat anders is past Jan aan met − en + (geteld en kapot), en hij vinkt de zending af als binnen. Op het Overzicht staat die zending dan op groen.',
      waar: [['#/maandag?deel=binnen', 'Maandag: binnen']], nu: d.koers ? `Koers 1 € = $ ${fKoers(d.koers)}` : now('maandag') },
    { t: 'Maandag: verdelen', p: 'Eén korte rij per klant met wat hij krijgt, zoals de desk het voorstelde uit de telefoonbestellingen; komen er twee batches, dan staat elke batch op een eigen regel achter zijn regio. Klopt een regel niet, dan sleept Jan hem naar de klant waar hij wél heen moet, of naar de loods. Een klik op een regel geeft − en + en de pijl om zelf te kiezen hoeveel en waarheen. Wat een klant mist staat oranje in zijn rij. Onderaan klapt de loods open: wat er nog vrij staat, met wie het het eerst mist, ook te slepen naar een klant. Op de telefoon is elke klant één regel tekst; tik erop om zijn regels te zien. Daarna "Klopt, naar de pakbonnen"; de lijst kan geprint de hal in.',
      waar: [['#/maandag?deel=verdelen', 'Maandag: verdelen'], ['#/maandag?deel=vrij', 'De loods']], nu: null },
    { t: 'Maandag: pakbon en factuur', p: 'Per klant één pakbon die ook de factuur is, in euro met de koers van de week: alle regels, het batchnummer per regel en het plantenpaspoort erop (A soort, B Campo’s registratie, C het batchnummer, D het land van herkomst). Elke factuur krijgt een nummer en staat als concept in Outlook, in de taal van de klant, met de pdf. Jan drukt zelf op verzenden, of geeft hem mee met de goederen.',
      waar: [['#/maandag?deel=pakbon', 'Maandag: pakbon en factuur'], ['#/pakbonnen', 'Pakbonnen en facturen']], nu: now('pakbonnen') },
    { t: 'Maandag: in Exact', p: 'Na Jans akkoord zet de desk op zijn klik elke factuur en inkooporder in Exact: één boeking per factuur, elke regel met grootboek, btw-code en het batchnummer als kostendrager. In de stap Exact staat elke boeking zoals Exact hem heeft, met wat Exact teruggeeft en of het klopt. Ook is er de Excel met per factuurregel plantensoort, grootte, hoeveelheid, prijs per eenheid, plantenpaspoortnummer, klant en nog eens het plantenpaspoortnummer.',
      waar: [['#/maandag?deel=exact', 'Maandag: Exact']], nu: null },
    { t: 'Controle: klopt het?', p: 'De desk leest daarna alleen: staat alles goed in Exact (bedrag, debiteur, kostendrager, btw, datum), en houdt alles zich aan de regels: wat mag niet en wat mag wel, voor invoer, het plantenpaspoort, de factuur en btw en het bewaren. Met het archief van elke week in mappen en de hele database als Excel, lijsten en back-up.',
      waar: [['#/controle?deel=regels', 'Regels'], ['#/controle?deel=exact', 'Exact'], ['#/controle?deel=archief', 'Archief'], ['#/controle?deel=database', 'Database']], nu: null },
    { t: 'Hoe goed zijn je relaties', p: 'Bij Bestellen en relaties krijgt elke klant en leverancier een score uit wat er echt gebeurde. Leveranciers: op tijd binnen, bevestigt wat je bestelt, stuurt wat hij bevestigt, de telling in de hal, uitval, papieren en prijs. Klanten: trouw, omzet, groei met het seizoen eruit, marge, betalen en hoeveel producten ze nemen. Met per relatie wat je nog meer voor ze kunt doen, nieuwe klanten om te bellen, en wat de planten kosten en opbrengen.',
      waar: [['#/handel?deel=klanten', 'Klanten'], ['#/handel?deel=leveranciers', 'Leveranciers'], ['#/handel?deel=kansen', 'Nieuwe klanten'], ['#/handel?deel=planten', 'Planten']], nu: null },
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
          <p><span class="lgt" data-l="binnen"><i></i>Binnen</span> afgevinkt op Maandag: de dozen staan in de loods.</p>
          <p class="small muted">De desk kijkt naar zijn eigen signalen, naar jouw meldingen, naar het weerbericht van elke luchthaven op de dag dat de dozen er zijn (MET Norway) en naar tropische stormen (orkaancentrum NHC). Naar buiten gaan alleen de coördinaten van de luchthavens.</p></div></section>
        <section class="panel"><header><h2>Wat de desk nooit doet</h2></header><div class="body"><ul class="plainlist small"><li>Bestellen bij een leverancier</li><li>Een mail versturen zonder dat Jan op verzenden drukt</li><li>Betalen</li><li>Iets in Exact zetten zonder Jans akkoord en klik</li></ul></div></section>
        <section class="panel"><header><h2>Het overzicht</h2></header><div class="body stack" style="gap:8px"><p>Week ${d.week}, binnen ${h(dLong(d.maandag))}. Op het Overzicht zie je per leverancier waar de dozen zijn en naar welke klanten ze gaan; omgedraaid per klant waar zijn dozen vandaan komen. Wat op Maandag is afgevinkt, staat op groen.</p>
          <p class="acts-row"><a class="btn btn-line btn-sm" href="#/inkoop">Naar het overzicht</a><a class="btn btn-ghost btn-sm" href="#/maandag">Naar Maandag</a></p></div></section>
      </aside>
    </div>
  </div>`;
}
export const actions = {};
