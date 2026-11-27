# Campo International

De website van Campo International (Nootdorp) en de **Campo desk** erachter.

- **Website** (`/`): het assortiment, de pagina voor kwekers en de klantpagina om een bestelling te volgen.
- **Campo desk** (`/desk/`): Jans week, van het telefoontje van de klant tot de factuur in zijn mail.

Uitgangspunt: **de desk leest, telt, verdeelt en zet klaar; Jan bestelt, keurt goed en verstuurt.** Er wordt niets automatisch besteld, gemaild of betaald.

## Het weekritme

| Dag | Pagina | Wat er gebeurt |
|---|---|---|
| hele week | **Bestellen** | Klanten bellen. Jan noteert klant, product en dozen. Wie meestal belt en nog niet heeft, staat erbij met "zelfde als vorige keer". Bovenaan de **goede deals**: aanbod van een leverancier dat de desk meteen aan vaste kopers koppelt (marge erbij, niets blijft over), en dozen die al onderweg zijn zonder koper. Onderaan **nieuwe klanten en leveranciers**: waar de cijfers zeggen dat je moet kijken, en de mensen die Jan kan benaderen. |
| dinsdag | **Bestellen** | De desk telt op per product en per leverancier, met de bestelling in het Spaans om te kopiëren. "Ik heb besteld" maakt per leverancier een **zending** met een eigen **zendnummer**: regiocode, jaar, volgnummer (`CR26-048`). |
| donderdag | **Inkoop** | Elke bestelling op weg naar de loods als één baan: leverancier → route naar Nootdorp → loods → **naar welke klanten** het gaat, met wat er netto vrij blijft. Bovenaan wat aandacht vraagt (oranje, rood), daaronder wat op schema loopt. Een klik op de bestelling geeft **alles**: het verzendbewijs zelf (de pdf, in de desk getekend, ook op de telefoon), Jans bestelling en de bevestiging, de regels met elk verschil, de inkooporder voor Exact, de route met het stoplicht en de volledige verdeling. |
| vrijdag | **Inkoop** | De verzendpapieren (factura comercial, packing list, AWB, fyto) worden gelezen. Dat is de **inkooporder voor Exact**: elke regel klaar, met het zendnummer als kostendrager. Twijfel staat naast het origineel. |
| maandag | **Maandag** | Jan zet de **dollarkoers** van de week vast (dollars voor één euro), telt de dozen (alleen afwijkingen intikken) en verdeelt ze per klant. De desk stelt de verdeling voor uit de telefoonbestellingen; elke doos een klant, zodat de loods **netto nul** is. Verdeellijst printen voor de hal. |
| maandag | **Pakbonnen** | Per klant één pakbon die ook de factuur is, met de partij per regel en het **plantenpaspoort** (A soort, B registratie, C zendnummer, D herkomst). Prijzen in dollars, omgerekend met de koers van de week. Na akkoord: concept in **Outlook** (pdf erbij, in de taal van de klant), of "Open in Outlook" (.eml). Regels voor Exact met kostendrager. |
| altijd | **Jaar en Excel** | Per week, per regio en per partij: in, uit, rest. **Excel** wordt bij elke download opnieuw uit de database gemaakt (Overzicht, Inkoop, Verkoop, Partijen, Leveranciers, Klanten, Koersen, Plantenpaspoorten), met formules op de regels. |
| altijd | **Relaties** | Klanten en leveranciers met een score uit wat er echt gebeurde, en per relatie wat je nog meer kunt doen. Een klik op een leverancier geeft zijn zending, alles uit zijn mail, hoe het verwerkt is en op welke rijen het in de Excel staat. Onder **Planten**: de prijzen van een jaar (inkoop van de verzendbewijzen, verkoop van de pakbonnen) als prijsindex, en per plant de trend, de marge, de vraag zonder seizoen, bij welke leverancier en wie het meest neemt. |

Verder: **Deze week** (het ritme in één oogopslag, het stoplicht per zending en wat er nu te doen is) en **Koppelingen** (Outlook, de gegevens op de pakbon zoals het B-nummer en de IBAN, Exact, regio's).

De code van het weekritme staat in `src/week/` (database: `src/schema-3-week.sql` en `src/schema-4-relaties.sql`) en de schermen in `public/desk/views/`.

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
| `WEER_CONTACT` | nee | Contact in de User-Agent naar MET Norway (hun voorwaarde), standaard info@campointernational.nl. |

## Lokaal draaien

```bash
npm install
npm run dev      # start een tijdelijke Postgres en de server op http://localhost:8080
npm run check    # syntaxcontrole van alle bestanden
```

Lokaal is het desk-wachtwoord `campo`.

## Demo-data

Bij een lege database (of een database met alleen oude demo-data) maakt de desk een verzonnen wereld: drie leveranciers in Costa Rica en Guatemala, hockeysticks, stammen en stekken, zestig klanten en ruim een jaar afgeronde weken. De huidige week staat waar Jans week staat: besteld, bevestigd, verzendpapieren binnen, maandag nog te doen. Elke vrijdag schuift de demo een week op (alleen zolang alles demo is). Weghalen: Desk → Koppelingen → Demo-data verwijderen.

## Mappen

```
server.js            Express: website, desk, API
src/                 database (schema*.sql, db.js), inloggen, Outlook, pdf
src/week/            het weekritme: model, verdelen, pakbon en plantenpaspoort, Excel, demo
src/ingest/          mail, WhatsApp, pdf- en AI-lezen, verwerken
public/index.html    de website
public/desk/         de desk (losse ES-modules, geen build-stap)
```
