// How the desk works, told once, with what is happening right now next to every step.
import { api, h, icon, fNum, fEur, plural } from '../core.js';

export async function render() {
  const [v, k] = await Promise.all([api('/vandaag'), api('/koppelingen')]);
  const kpi = v.kpi, o = k.outlook || {};
  const outlookNow = o.doel === 'microsoft' ? `gekoppeld met ${o.account}` : o.doel === 'imap' ? `concepten in de map Concepten van ${o.account}` : 'Outlook nog niet gekoppeld; elke mail opent met één klik';
  const steps = [
    { t: 'Het aanbod komt binnen', p: 'Een kweker stuurt via WhatsApp of mail wat hij heeft: een mand met verschillende planten. De desk leest het bericht, ook een pdf of een foto, en zet elke plant met aantal, prijs en levertijd in de database. Kent de desk een plant of kweker nog niet, dan vraagt hij het één keer en onthoudt het.',
      waar: [['#/workflow', 'Workflow: direct te bestellen'], ['#/inbox', 'Inbox']], nu: `${plural(kpi.aanbod + kpi.bellen_aanbod, 'mand', 'manden')} klaar om te bestellen` },
    { t: 'De mand wordt gekoppeld aan klanten', p: 'Voor elke plant zoekt de desk wie hem nodig heeft: klanten die er al om vroegen, klanten die deze plant vaak kopen en eraan toe zijn, en hoe vaak ze ja zeggen op een aanbod. Zo ontstaat een bestelvoorstel: wat je inkoopt, voor wie, tegen welke prijs en marge, en wat er overblijft.',
      waar: [['#/workflow', 'Een mand openen'], ['#/klanten', 'Klanten']], nu: kpi.marge ? `${fEur(kpi.marge)} marge in de open manden` : null },
    { t: 'Elke bestelling krijgt een risico', p: 'De desk weegt wat mis kan gaan. Komt deze kweker vaak te laat of levert hij te weinig? Is de prijs hoger dan normaal? Heeft een klant een betaalachterstand, of zit hij aan zijn kredietlimiet? Blijft er iets over dat snel bederft? Groen, oranje of rood, altijd met de reden erbij.',
      waar: [['#/kwekers', 'Kwekers'], ['#/klanten', 'Klanten']], nu: null },
    { t: 'Jij krijgt een melding, de concepten staan klaar', p: 'Zodra het voorstel klaar is, staat het bovenaan Vandaag en krijg je een mail (als Outlook gekoppeld is). De bestelling voor de kweker en een offerte per klant staan klaar als concept, met pdf en in de taal van de klant. Met Outlook gekoppeld staan ze daar bij Concepten.',
      waar: [['#/koppelingen', 'Koppelingen']], nu: outlookNow },
    { t: 'Bellen, en zelf versturen', p: 'Je belt de klant. Zegt hij ja, dan tik je op Akkoord en verstuur je de offerte. Nee of later bellen is ook één tik. Als iedereen gebeld is, plaats je de bestelling: de desk maakt de klantorders en plant de wagens naar de klanten.',
      waar: [['#/workflow', 'Workflow: direct te bestellen']], nu: kpi.bellen ? `${plural(kpi.bellen, 'klant', 'klanten')} te bellen` : 'Niemand te bellen' },
    { t: 'Onderweg, de loods in, naar de klant', p: 'In de Workflow staat elke bestelling als één lijn: van de kweker naar jouw loods, en van daar naar elke klant. Je ziet hoever hij waarschijnlijk is. Groen is op tijd, oranje is krap, rood betekent dat een levering in gevaar is. Klik erop voor alle tijden, wat erin zit en wie je moet bellen. Bovenaan staat wat in de loods nog geen klant heeft.',
      waar: [['#/workflow', 'Workflow: van kweker naar klant'], ['#/loods', 'Loods']], nu: `${fNum(kpi.loods)} stuks in de loods, ${fNum(kpi.loods_vrij)} vrij` },
  ];
  return `<div class="page story">
    <div class="ph"><div><h1>Zo werkt de desk</h1><p>Van het aanbod van een kweker tot de planten bij de klant. De desk leest, koppelt, rekent en zet klaar. Jij belt, beslist en verstuurt.</p></div></div>
    <div class="grid2">
      <ol class="story-steps">${steps.map((s, i) => `<li>
        <span class="n" aria-hidden="true">${i + 1}</span>
        <div><h2>${h(s.t)}</h2><p>${h(s.p)}</p>
          <p class="where">${s.waar.map(([href, l]) => `<a href="${href}">${h(l)}</a>`).join('')}${s.nu ? `<span class="now">${icon('clock')}Nu: ${h(s.nu)}</span>` : ''}</p></div>
      </li>`).join('')}</ol>
      <aside class="stack">
        <section class="panel rule"><header><h2>Wat de desk nooit zelf doet</h2></header>
          <div class="body"><p>Bestellen, mailen en betalen. Elke mail die de deur uitgaat, verstuur jij. De desk maakt alleen concepten.</p></div></section>
        <section class="panel"><header><h2>Wat de desk bijhoudt</h2></header>
          <ul class="body plainlist">
            <li><a href="#/kwekers"><b>Kwekers</b></a>: hoe stipt en compleet ze leveren, de kwaliteit, of de prijs klopt, en hoe elk aanbod afliep.</li>
            <li><a href="#/klanten"><b>Klanten</b></a>: wat ze kopen en hoe vaak, omzet en marge, betaalgedrag, en hoe vaak ze ja zeggen op een aanbod.</li>
            <li><a href="#/planten"><b>Planten</b></a>: de prijs per kweker door het jaar, en wie wat koopt.</li>
          </ul></section>
        <section class="panel"><header><h2>Wat nog gekoppeld kan worden</h2></header>
          <ul class="body ticks">
            <li>${k.ai.aan ? icon('check') : icon('info')} AI-lezen: ${k.ai.aan ? 'aan' : 'uit; de desk leest met vaste regels'}</li>
            <li>${o.doel ? icon('check') : icon('info')} Outlook: ${h(o.doel ? (o.doel === 'microsoft' ? 'gekoppeld' : 'via de map Concepten') : 'nog niet gekoppeld')}</li>
            <li>${k.mail.aan ? icon('check') : icon('info')} Mail lezen: ${k.mail.aan ? h(k.mail.user || 'aan') : 'nog geen factuurmailbox'}</li>
            <li>${k.whatsapp.aan ? icon('check') : icon('info')} WhatsApp: ${k.whatsapp.aan ? 'aan' : 'nog geen WhatsApp Business-nummer'}</li>
          </ul><p class="body" style="padding-top:0"><a class="lnk" href="#/koppelingen">Naar Koppelingen</a></p></section>
      </aside>
    </div>
  </div>`;
}
export const actions = {};
