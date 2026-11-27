# Campo International

De website van Campo International (Nootdorp) en de **Campo desk** erachter.

- **Website** (`/`): het assortiment, de pagina voor kwekers en de klantpagina om een bestelling te volgen.
- **Campo desk** (`/desk/`): Jans week, van het telefoontje van de klant tot de factuur in zijn mail.

Uitgangspunt: **de desk leest, telt, verdeelt en zet klaar; Jan bestelt, keurt goed en verstuurt.** Er wordt niets automatisch besteld, gemaild of betaald.

## Het weekritme

| Dag | Pagina | Wat er gebeurt |
|---|---|---|
| hele week | **Bestellen** | Klanten bellen. Jan noteert klant, product en dozen. Wie meestal belt en nog niet heeft, staat erbij met "zelfde als vorige keer". |
| dinsdag | **Bestellen** | De desk telt op per product en per leverancier, met de bestelling in het Spaans om te kopiëren. "Ik heb besteld" maakt per leverancier een **zending** met een eigen **zendnummer**: regiocode, jaar, volgnummer (`CR26-048`). |
| donderdag | **Inkoop** | De bevestiging: bevestigd naast besteld, elk verschil (die 10% meer of minder) zichtbaar. |
| vrijdag | **Inkoop** | De verzendpapieren (factura comercial, packing list, AWB, fyto) worden gelezen. Dat is de **inkooporder voor Exact**: elke regel klaar, met het zendnummer als kostendrager. Twijfel staat naast het origineel. |
| maandag | **Maandag** | Jan zet de **dollarkoers** van de week vast (dollars voor één euro), telt de dozen (alleen afwijkingen intikken) en verdeelt ze per klant. De desk stelt de verdeling voor uit de telefoonbestellingen; elke doos een klant, zodat de loods **netto nul** is. Verdeellijst printen voor de hal. |
| maandag | **Pakbonnen** | Per klant één pakbon die ook de factuur is, met de partij per regel en het **plantenpaspoort** (A soort, B registratie, C zendnummer, D herkomst). Prijzen in dollars, omgerekend met de koers van de week. Na akkoord: concept in **Outlook** (pdf erbij, in de taal van de klant), of "Open in Outlook" (.eml). Regels voor Exact met kostendrager. |
| altijd | **Jaar en Excel** | Per week, per regio en per partij: in, uit, rest. **Excel** wordt bij elke download opnieuw uit de database gemaakt (Overzicht, Inkoop, Verkoop, Partijen, Klanten, Koersen, Plantenpaspoorten), met formules op de regels. |

Verder: **Deze week** (het ritme in één oogopslag en wat er nu te doen is), **Klanten** (60 klanten, prijsafspraken in dollars, pakbonnen) en **Koppelingen** (Outlook, de gegevens op de pakbon zoals het B-nummer en de IBAN, Exact, regio's).

De code van het weekritme staat in `src/week/` (database: `src/schema-3-week.sql`) en de schermen in `public/desk/views/`.

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
