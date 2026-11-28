# Campo International

De website van Campo International (Nootdorp) en de **Campo desk** erachter.

- **Website** (`/`): het assortiment, de pagina voor kwekers en de klantpagina om een bestelling te volgen.
- **Campo desk** (`/desk/`): Jans week, van het telefoontje van de klant tot de factuur in zijn mail.

Uitgangspunt: **de desk leest, telt, verdeelt en zet klaar; Jan bestelt, keurt goed en verstuurt.** Er wordt niets automatisch besteld, gemaild of betaald.

## Het weekritme

| Dag | Pagina | Wat er gebeurt |
|---|---|---|
| do tot ma | **Overzicht** | Het **overzichtsblad** van de week, en de startpagina. Bovenaan in één regel wat nog **geen bestemming** heeft (in de loods of onderweg), of dat alles een bestemming heeft, met een schakelaar: *Leverancier → loods* en *Loods → klant*. Elke bestelling op weg naar de loods als één baan: leverancier → route naar Nootdorp → loods → **naar welke klanten** het gaat, met wat er netto vrij blijft. Bovenaan wat aandacht vraagt (oranje, rood), daaronder wat op schema loopt. Een klik op de bestelling geeft **alles**: het verzendbewijs zelf (de pdf, in de desk getekend, ook op de telefoon), Jans bestelling en de bevestiging, de regels met elk verschil, de inkooporder voor Exact, de route met het stoplicht en de volledige verdeling. Wat op Maandag is afgevinkt als binnen staat op **groen**. Omgedraaid, per regio (batchnummer) en per klant: waar zijn dozen vandaan komen, met zijn pakbon en factuur. |
| vrijdag | **Overzicht** | De verzendpapieren (factura comercial, packing list, AWB, fyto) worden gelezen. Dat is de **inkooporder voor Exact**: elke regel klaar, met het batchnummer als kostendrager. Twijfel staat naast het origineel. |
| maandag | **Maandag** | Vijf stappen, de stap die aan de beurt is staat open: 1 de **dollarkoers** van de week (dollars voor één euro); 2 **binnen**: per zending en regel staat wat de papieren zeggen, Jan past met − en + aan wat er echt binnen is (geteld en kapot) en vinkt de zending af, dan staat hij op het Overzicht op groen; 3 **verdelen** (per regio en klant, en controleren in één): per batchnummer een kaart per klant met zijn regels, zoals de desk voorstelde. Een regel **sleept** Jan naar de klant waar hij heen moet of naar de loods; − en + voor het aantal; de pijl om zelf te kiezen hoeveel en waarheen; onderaan klapt de **loods** open met wat vrij staat (ook te slepen, met een voorstel van de desk). Vanaf de eerste wijziging is de verdeling van die plant van Jan en schuift de desk er niets meer aan (database versie 8, `verdeling_vast`); "Terug naar voorstel" geeft hem terug. Dan "Klopt", en de lijst voor de hal printen; 4 **pakbon en factuur**: per klant één pakbon die ook de factuur is, in euro met de koers van de week en met het **plantenpaspoort** (A soort, B registratie, C batchnummer, D herkomst), als concept in **Outlook** (pdf erbij, in de taal van de klant) of met "Open in Outlook" (.eml); 5 **Exact**: elke factuur en inkooporder van de week als **boeking zoals in Exact** (dagboek, debiteur of crediteur, per regel grootboek, aantal, prijs, bedrag, btw-code en kostendrager), met wat Exact teruggeeft en of het klopt; plus de Excel met per factuurregel plantensoort, grootte, hoeveelheid, prijs per eenheid, plantenpaspoortnummer, klant en nog eens het plantenpaspoortnummer (kostendrager). |
| maandag | **Pakbonnen en facturen** | Dezelfde pakbonnen per klant, met de pdf, de mail en **Zet in Exact** per factuur. Bij akkoord bewaart de desk de pdf zoals hij de deur uitging. |
| hele week | **Bestellen en relaties** | Klanten bellen. Jan noteert klant, product en dozen. Wie meestal belt en nog niet heeft, staat erbij met "zelfde als vorige keer" (deel Bestellen). |
| dinsdag | **Bestellen en relaties** | De desk telt op per product en per leverancier, met de bestelling in het Spaans om te kopiëren. "Ik heb besteld" maakt per leverancier een **zending** met het **batchnummer**: jaar, week, regio (`264901` = 2026, week 49, regio 01). Leveranciers uit dezelfde regio in dezelfde week delen het nummer; de regionummers (01 tot 04) staan bij Koppelingen. |
| altijd | **Bestellen en relaties** | Eén tab met een **slider** van zeven delen, elk met in een paar woorden hoe het ervoor staat: **Bestellen** (telefoon en bestelling per leverancier), **Deals** (aanbod en dozen zonder koper, één op één gekoppeld aan vaste kopers, "Deal rond"), **Nieuwe klanten** (en leveranciers), **Vervoer** (de zendingen van de week met hun licht, het weer op elke luchthaven de komende week, tropische stormen, meldingen, drukke vrachtweken, op tijd per leverancier), **Leveranciers** en **Klanten** onder de loep (scores uit wat er echt gebeurde), en **Planten** (prijzen en trend). |
| altijd | **Controle** | Vier delen achter een slider. **Regels**: wat mag niet en wat mag wel (invoer, plantenpaspoort, factuur en btw, Exact, bewaren, de afspraken van Campo), per regel wat de desk in zijn eigen gegevens ziet. **Exact**: de desk zet facturen en inkooporders na Jans akkoord in Exact (één boeking per stuk, het batchnummer als kostendrager); deze controle leest alleen terug en legt het naast de desk (bedrag, debiteur, kostendrager, btw, datum). Bron: Exact Online, een export uit Exact (Excel of CSV), of in de demo een nagebootst Exact met vier fouten expres. **Archief**: elk papier per jaar, maand en week in mappen (bestelling, bevestiging, verzendbewijs, pakbon met factuur, aanbod, Excel voor Exact), per week of per jaar als zip. **Database**: de grote Excel (nu ook met het blad Planten), het jaar in cijfers, lijsten van planten, klanten, leveranciers, batches en facturen, en een back-up van de hele database als CSV per tabel. |

Verder: **Koppelingen** (Outlook, Exact met de codes van de administratie, de gegevens op de pakbon zoals het B-nummer en de IBAN, regio's) en **Zo werkt het**.

De code van het weekritme staat in `src/week/` (database: `src/schema-3-week.sql` tot en met `src/schema-8-verdeling.sql`; Exact in `src/exact.js`) en de schermen in `public/desk/views/`.

### Het stoplicht: komt het maandag binnen

`src/week/risk.js` bekijkt per zending:

- **eigen signalen**: bevestiging of verzendbewijs later dan normaal, een twijfel op de papieren, een leverancier die vaker te laat is, een overstap;
- **meldingen van Jan**: een staking, as boven een luchthaven, een weg dicht (met hoeveel uur later het wordt);
- **de kalender**: kerst, Valentijn en Moederdag maken de vrachtvliegtuigen vol;
- **het weer**: de verwachting van MET Norway (vrij te gebruiken, ook zakelijk) voor elke luchthaven op de route, op de dag dat de dozen er zijn, en voor Nootdorp op maandag;
- **stormen**: de actieve tropische stormen van het Amerikaanse orkaancentrum (NHC) in de buurt van een luchthaven op de route.

Naar buiten gaan alleen de coördinaten van de luchthavens. Is een bron niet bereikbaar, dan zegt de desk dat en tellen de andere signalen gewoon. Groen: niets in de weg. Oranje: let op. Rood: echt een probleem.

### De analyse van klanten en leveranciers

`src/week/partners.js` rekent over het laatste half jaar. Leveranciers: op tijd in de loods, bevestigt wat je bestelt, stuurt wat hij bevestigt, telling klopt, uitval, papieren op tijd, prijs tegen de standaard. Klanten: trouw, omzet, groei (het seizoen eruit gehaald: het aandeel in de omzet tegen het halfjaar ervoor), marge, betalen, hoeveel producten. Daarnaast de goede deals en de voorstellen voor nieuwe klanten en leveranciers. Wanneer een klant betaalde komt straks uit Exact; tot die tijd kan Jan het bij de klant aanvinken.

De planten (`plantStats`): per week de gewogen inkoopprijs per stuk uit de verzendbewijzen en de verkoopprijs uit de pakbonnen. De prijsindex houdt de mand planten gelijk (de hoeveelheden van het jaar), zodat een week met meer dure maten de index niet laat springen. Per plant: laatste 4 weken tegen 13 weken eerder en tegen een jaar terug, de marge, de vraag met het seizoen eruit, en wat opvalt (bijvoorbeeld: inkoop omhoog terwijl de verkoopprijs gelijk bleef, met hoeveel de lijstprijs omhoog moet om de oude marge te houden).

De originelen (pdf) tekent de desk zelf met pdf.js, dat met `unpdf` al op de server staat (`/desk/vendor/pdf.mjs`); er komt niets van buiten.

## Variabelen in Railway

| Variabele | Nodig | Wat |
|---|---|---|
| `DATABASE_URL` | ja | De Postgres van Railway (koppel de Postgres-service). |
| `DESK_PASSWORD` | ja | Het wachtwoord van de desk. Zonder staat inloggen uit. |
| `XAI_API_KEY` | nee | AI-lezen met Grok. `XAI_MODEL` kiest een model. |
| `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS` | nee | De factuurmailbox (alleen lezen, `IMAP_PORT` standaard 993). `MAIL_MINUTEN` = hoe vaak (standaard 3). `EMAIL_*`-variabelen worden nooit gelezen. Weigert de server de inlog, dan stopt de desk tot de gegevens zijn aangepast. |
| `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | nee | WhatsApp Cloud API (Meta). De webhook staat op `/api/whatsapp/webhook`. |
| `DEMO_DATA` | nee | `uit` = geen voorbeelddata aanmaken bij een lege database. `DEMO_OPNIEUW=ja` maakt een database met alleen demo-data opnieuw. |
| `CAMPO_TZ` | nee | Tijdzone, standaard Europe/Amsterdam. |
| `WERELD` | nee | `uit` = het weer en de stormen niet ophalen (de eigen signalen en meldingen tellen wel). |
| `EXACT_CLIENT_ID`, `EXACT_CLIENT_SECRET` | nee | Exact Online (een eigen app in het Exact App Center, redirect-URI `https://<site>/api/exact/terug`). Daarna bij Koppelingen op Koppel Exact en de codes invullen. `EXACT_BASE` alleen voor een ander Exact-land. |
| `WEER_CONTACT` | nee | Contact in de User-Agent naar MET Norway (hun voorwaarde), standaard info@campointernational.nl. |

## Lokaal draaien

```bash
npm install
npm run dev      # start een tijdelijke Postgres en de server op http://localhost:8080
npm run check    # syntaxcontrole van alle bestanden
```

Lokaal is het desk-wachtwoord `campo`.

## Demo-data

Bij een lege database (of een database met alleen oude demo-data) maakt de desk een verzonnen wereld: drie leveranciers in Costa Rica en Guatemala, hockeysticks, stammen en stekken, negen klanten (zo'n zes per week) en ruim een jaar afgeronde weken. De huidige week staat waar Jans week staat: besteld, bevestigd, verzendpapieren binnen, maandag nog te doen. Elke vrijdag schuift de demo een week op (alleen zolang alles demo is). Weghalen: Desk → Koppelingen → Demo-data verwijderen.

## Mappen

```
server.js            Express: website, desk, API
src/                 database (schema*.sql, db.js), inloggen, Outlook, pdf
src/week/            het weekritme: model, verdelen, pakbon en plantenpaspoort, Excel, demo
src/ingest/          mail, WhatsApp, pdf- en AI-lezen, verwerken
public/index.html    de website
public/desk/         de desk (losse ES-modules, geen build-stap)
```
