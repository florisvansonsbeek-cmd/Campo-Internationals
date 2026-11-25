# Campo International

De website van Campo International (Nootdorp) en de **Campo desk** erachter.

- **Website** (`/`): het assortiment, de pagina voor kwekers en de klantpagina om een bestelling te volgen.
- **Campo desk** (`/desk/`): waar elke bestelling nu is en hoe laat hij waar aankomt. De desk leest facturen uit mail en WhatsApp, koppelt elke factuurregel aan de klanten die erop wachten, stelt voor wat er met de rest gebeurt, en bouwt een database op van kwekers, planten en klanten met hun hele geschiedenis.

Uitgangspunt: **de desk leest, vergelijkt en waarschuwt; Jan bestelt, keurt goed en betaalt.** Er wordt niets automatisch besteld, gemaild of betaald.

## Zo werkt een factuur

1. **Binnen**: een factuur komt binnen via mail, WhatsApp of uploaden. Het origineel wordt bewaard.
2. **Lezen**: de desk haalt kweker, nummer, datum, regels (plant, aantal, prijs) en tijden eruit. Met `XAI_API_KEY` leest Grok mee (ook scans en foto's); zonder leest hij nette pdf's en berichten met vaste regels.
3. **Nakijken**: twijfelt de desk over een regel, dan kiest Jan. Wat Jan kiest, onthoudt de desk per kweker.
4. **Koppelen**: elke regel wordt verdeeld over de open klantorders die erop wachten.
5. **Rest**: wat overblijft krijgt voorstellen (welke klant koopt dit vaak, wie wacht nog, welke wagen vertrekt).
6. **Klanten op de hoogte**: de desk zet het bericht klaar; Jan verstuurt het zelf.

## Variabelen in Railway

| Variabele | Nodig | Wat |
|---|---|---|
| `DATABASE_URL` | ja | De Postgres van Railway (koppel de Postgres-service). |
| `DESK_PASSWORD` | ja | Het wachtwoord van de desk. Zonder staat inloggen uit. |
| `XAI_API_KEY` | nee | AI-lezen met Grok. `XAI_MODEL` kiest een model. |
| `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS` | nee | De factuurmailbox (alleen lezen, `IMAP_PORT` standaard 993). `MAIL_MINUTEN` = hoe vaak (standaard 3). `EMAIL_*`-variabelen worden nooit gelezen. Weigert de server de inlog, dan stopt de desk tot de gegevens zijn aangepast. |
| `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | nee | WhatsApp Cloud API (Meta). De webhook staat op `/api/whatsapp/webhook`. |
| `DEMO_DATA` | nee | `uit` = geen voorbeelddata aanmaken bij een lege database. |
| `CAMPO_TZ` | nee | Tijdzone, standaard Europe/Amsterdam. |

## Lokaal draaien

```bash
npm install
npm run dev      # start een tijdelijke Postgres en de server op http://localhost:8080
npm run check    # syntaxcontrole van alle bestanden
```

Lokaal is het desk-wachtwoord `campo`.

## Demo-data

Bij een lege database maakt de desk verzonnen kwekers, klanten, facturen en vijftien maanden geschiedenis aan, zodat te zien is hoe alles werkt. Die data schuift elke dag mee. Weghalen: Desk → Koppelingen → Demo-data verwijderen. De plantencatalogus blijft staan.

## Mappen

```
server.js            Express: website, desk, API
src/                 database (schema.sql, db.js), analyses, verdelen, inloggen
src/ingest/          mail, WhatsApp, pdf- en AI-lezen, verwerken
public/index.html    de website
public/desk/         de desk (losse ES-modules, geen build-stap)
```
