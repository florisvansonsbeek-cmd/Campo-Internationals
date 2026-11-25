-- Campo desk database (version 1).
-- Everything lives in the schema "campo". Names are Dutch, like the desk.
-- Rule of the house: the desk reads, compares and suggests; Jan decides and sends.

CREATE SCHEMA IF NOT EXISTS campo;
SET search_path TO campo, public;

-- ---------------------------------------------------------------- kwekers
CREATE TABLE kwekers (
  id            serial PRIMARY KEY,
  code          text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9-]{2,40}$'),
  naam          text NOT NULL CHECK (length(btrim(naam)) > 1),
  plaats        text,
  land          char(2) NOT NULL DEFAULT 'NL' CHECK (land ~ '^[A-Z]{2}$'),
  contact       text,
  email         text CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  maildomein    text,
  telefoon      text,
  whatsapp      text CHECK (whatsapp IS NULL OR whatsapp ~ '^\+[0-9]{8,15}$'),
  vervoer       text,
  laadtijd      time,
  reistijd_min  int CHECK (reistijd_min BETWEEN 0 AND 4320),
  levert_op     smallint[],
  specialiteit  text,
  notities      text,
  actief        boolean NOT NULL DEFAULT true,
  bron          text NOT NULL DEFAULT 'handmatig' CHECK (bron IN ('demo','handmatig','mail','whatsapp','import')),
  aangemaakt    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX kwekers_naam_uk ON kwekers (lower(naam));

-- ---------------------------------------------------------------- planten
CREATE TABLE planten (
  id            serial PRIMARY KEY,
  code          text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9-]{2,60}$'),
  naam          text NOT NULL CHECK (length(btrim(naam)) > 1),
  latijn        text,
  groep         text NOT NULL CHECK (groep IN ('orchidee','bloeiend','groen','snijbloem','buiten','seizoen')),
  potmaat       text,
  hoogte        text,
  eenheid       text NOT NULL DEFAULT 'stuks' CHECK (eenheid IN ('stuks','stelen')),
  per_laag      int CHECK (per_laag > 0),
  per_kar       int CHECK (per_kar > 0),
  seizoen       smallint[] CHECK (seizoen IS NULL OR seizoen <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]),
  verkoopprijs  numeric(10,2) CHECK (verkoopprijs >= 0),
  actief        boolean NOT NULL DEFAULT true,
  bron          text NOT NULL DEFAULT 'handmatig' CHECK (bron IN ('demo','handmatig','mail','whatsapp','import')),
  aangemaakt    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX planten_uk ON planten (lower(naam), coalesce(potmaat, ''), coalesce(hoogte, ''));

-- how a grower writes a plant on an invoice; the desk learns these
CREATE TABLE plant_namen (
  id            serial PRIMARY KEY,
  plant_id      int NOT NULL REFERENCES planten ON DELETE CASCADE,
  kweker_id     int REFERENCES kwekers ON DELETE CASCADE,
  tekst         text NOT NULL CHECK (length(btrim(tekst)) > 1),
  door          text NOT NULL DEFAULT 'jan' CHECK (door IN ('jan','ai','demo')),
  geleerd       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX plant_namen_uk ON plant_namen (coalesce(kweker_id, 0), lower(tekst));

-- ---------------------------------------------------------------- klanten
CREATE TABLE klanten (
  id            serial PRIMARY KEY,
  code          text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9-]{2,40}$'),
  naam          text NOT NULL CHECK (length(btrim(naam)) > 1),
  soort         text NOT NULL DEFAULT 'bloemist' CHECK (soort IN ('bloemist','tuincentrum','groothandel','interieur','supermarkt','evenementen','overig')),
  contact       text,
  email         text CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telefoon      text,
  whatsapp      text CHECK (whatsapp IS NULL OR whatsapp ~ '^\+[0-9]{8,15}$'),
  adres         text,
  postcode      text,
  plaats        text NOT NULL,
  land          char(2) NOT NULL CHECK (land ~ '^[A-Z]{2}$'),
  taal          text NOT NULL DEFAULT 'nl' CHECK (taal IN ('nl','en','de','fr','it','pl','sv','da','es','no')),
  kanaal        text NOT NULL DEFAULT 'whatsapp' CHECK (kanaal IN ('whatsapp','mail','telefoon')),
  levervenster  text,
  leverdagen    smallint[],
  reistijd_min  int CHECK (reistijd_min BETWEEN 0 AND 4320),
  betaaltermijn int NOT NULL DEFAULT 14 CHECK (betaaltermijn BETWEEN 0 AND 120),
  kredietlimiet numeric(12,2) CHECK (kredietlimiet >= 0),
  wensen        text,
  klant_sinds   int CHECK (klant_sinds BETWEEN 1950 AND 2100),
  actief        boolean NOT NULL DEFAULT true,
  bron          text NOT NULL DEFAULT 'handmatig' CHECK (bron IN ('demo','handmatig','mail','whatsapp','import')),
  aangemaakt    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX klanten_naam_uk ON klanten (lower(naam), lower(plaats));

-- what customers asked for
CREATE TABLE klant_orders (
  id            serial PRIMARY KEY,
  nummer        text NOT NULL UNIQUE,
  klant_id      int NOT NULL REFERENCES klanten ON DELETE CASCADE,
  besteld_op    timestamptz NOT NULL,
  gewenst_op    date,
  kanaal        text CHECK (kanaal IN ('whatsapp','mail','telefoon','portaal','beurs')),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','toegewezen','onderweg','geleverd','geannuleerd')),
  opmerking     text,
  aangemaakt    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX klant_orders_klant ON klant_orders (klant_id, besteld_op DESC);

CREATE TABLE klant_order_regels (
  id            serial PRIMARY KEY,
  order_id      int NOT NULL REFERENCES klant_orders ON DELETE CASCADE,
  plant_id      int NOT NULL REFERENCES planten,
  aantal        int NOT NULL CHECK (aantal > 0 AND aantal < 1000000),
  prijs         numeric(10,2) CHECK (prijs >= 0)
);
CREATE INDEX klant_order_regels_order ON klant_order_regels (order_id);
CREATE INDEX klant_order_regels_plant ON klant_order_regels (plant_id);

-- ---------------------------------------------------------------- what comes in (mail, WhatsApp, upload)
CREATE TABLE berichten_in (
  id            serial PRIMARY KEY,
  kanaal        text NOT NULL CHECK (kanaal IN ('mail','whatsapp','upload','plakken','demo')),
  extern_id     text,
  van           text,
  van_naam      text,
  onderwerp     text,
  tekst         text,
  ontvangen     timestamptz NOT NULL DEFAULT now(),
  kweker_id     int REFERENCES kwekers ON DELETE SET NULL,
  soort         text CHECK (soort IN ('factuur','pakbon','bevestiging','tijd','overig')),
  status        text NOT NULL DEFAULT 'nieuw' CHECK (status IN ('nieuw','bezig','gelezen','genegeerd','fout')),
  fout          text,
  UNIQUE (kanaal, extern_id)
);
CREATE INDEX berichten_in_ontvangen ON berichten_in (ontvangen DESC);

CREATE TABLE bestanden (
  id            serial PRIMARY KEY,
  bericht_id    int REFERENCES berichten_in ON DELETE CASCADE,
  naam          text NOT NULL,
  mime          text NOT NULL,
  grootte       int NOT NULL CHECK (grootte BETWEEN 0 AND 26214400),
  sha256        text NOT NULL,
  data          bytea NOT NULL,
  tekst         text,
  aangemaakt    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bestanden_sha ON bestanden (sha256);
CREATE INDEX bestanden_bericht ON bestanden (bericht_id);

-- ---------------------------------------------------------------- facturen van kwekers (one delivery each)
CREATE TABLE facturen (
  id            serial PRIMARY KEY,
  kweker_id     int NOT NULL REFERENCES kwekers ON DELETE CASCADE,
  nummer        text NOT NULL CHECK (length(btrim(nummer)) > 0),
  datum         date NOT NULL,
  vervaldatum   date,
  bericht_id    int REFERENCES berichten_in ON DELETE SET NULL,
  bestand_id    int REFERENCES bestanden ON DELETE SET NULL,
  totaal        numeric(12,2),
  valuta        char(3) NOT NULL DEFAULT 'EUR',
  zekerheid     int CHECK (zekerheid BETWEEN 0 AND 100),
  gelezen_door  text NOT NULL DEFAULT 'jan' CHECK (gelezen_door IN ('ai','regels','jan','demo')),
  waarschuwing  text,
  nagekeken     boolean NOT NULL DEFAULT false,
  afgerond      boolean NOT NULL DEFAULT false,
  aangemaakt    timestamptz NOT NULL DEFAULT now(),
  bijgewerkt    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kweker_id, nummer),
  CHECK (vervaldatum IS NULL OR vervaldatum >= datum)
);
CREATE INDEX facturen_datum ON facturen (datum DESC);

CREATE TABLE factuur_regels (
  id              serial PRIMARY KEY,
  factuur_id      int NOT NULL REFERENCES facturen ON DELETE CASCADE,
  regelnr         int NOT NULL CHECK (regelnr > 0),
  omschrijving    text NOT NULL,
  plant_id        int REFERENCES planten ON DELETE SET NULL,
  match_zekerheid int CHECK (match_zekerheid BETWEEN 0 AND 100),
  aantal          int NOT NULL CHECK (aantal > 0 AND aantal < 1000000),
  besteld         int CHECK (besteld > 0),
  prijs           numeric(10,3) NOT NULL CHECK (prijs >= 0 AND prijs < 100000),
  afgesproken     numeric(10,3) CHECK (afgesproken >= 0),
  bedrag          numeric(12,2) GENERATED ALWAYS AS (round(aantal * prijs, 2)) STORED,
  klant_ref       text,
  UNIQUE (factuur_id, regelnr)
);
CREATE INDEX factuur_regels_plant ON factuur_regels (plant_id);

-- ---------------------------------------------------------------- where the goods are
-- from the grower to Campo
CREATE TABLE zendingen (
  id                 serial PRIMARY KEY,
  factuur_id         int UNIQUE REFERENCES facturen ON DELETE CASCADE,
  kweker_id          int NOT NULL REFERENCES kwekers ON DELETE CASCADE,
  vervoerder         text,
  karren             numeric(5,1) CHECK (karren >= 0),
  vertrek_gepland    timestamptz,
  vertrek_werkelijk  timestamptz,
  aankomst_gepland   timestamptz NOT NULL,
  aankomst_verwacht  timestamptz,
  aankomst_werkelijk timestamptz,
  bestemming         text NOT NULL DEFAULT 'Campo, Nootdorp',
  CHECK (aankomst_werkelijk IS NULL OR vertrek_werkelijk IS NULL OR aankomst_werkelijk >= vertrek_werkelijk)
);
CREATE INDEX zendingen_aankomst ON zendingen (aankomst_gepland);

-- from Campo to a customer
CREATE TABLE leveringen (
  id                 serial PRIMARY KEY,
  klant_id           int NOT NULL REFERENCES klanten ON DELETE CASCADE,
  order_id           int REFERENCES klant_orders ON DELETE SET NULL,
  vervoerder         text,
  vertrek_gepland    timestamptz NOT NULL,
  vertrek_werkelijk  timestamptz,
  aankomst_gepland   timestamptz NOT NULL,
  aankomst_verwacht  timestamptz,
  aankomst_werkelijk timestamptz,
  CHECK (aankomst_gepland >= vertrek_gepland)
);
CREATE INDEX leveringen_vertrek ON leveringen (vertrek_gepland);
CREATE INDEX leveringen_klant ON leveringen (klant_id);

-- each invoice line goes to a customer, to stock, or back to the grower
CREATE TABLE toewijzingen (
  id             serial PRIMARY KEY,
  regel_id       int NOT NULL REFERENCES factuur_regels ON DELETE CASCADE,
  bestemming     text NOT NULL CHECK (bestemming IN ('klant','voorraad','retour')),
  klant_id       int REFERENCES klanten ON DELETE CASCADE,
  order_regel_id int REFERENCES klant_order_regels ON DELETE SET NULL,
  levering_id    int REFERENCES leveringen ON DELETE SET NULL,
  aantal         int NOT NULL CHECK (aantal > 0),
  verkoopprijs   numeric(10,2) CHECK (verkoopprijs >= 0),
  soort          text NOT NULL DEFAULT 'order' CHECK (soort IN ('order','aanbod','voorraad','retour')),
  status         text NOT NULL DEFAULT 'voorstel' CHECK (status IN ('voorstel','bevestigd','geleverd','afgewezen')),
  reden          text,
  score          int CHECK (score BETWEEN 0 AND 100),
  door           text NOT NULL DEFAULT 'ai' CHECK (door IN ('ai','jan','demo')),
  aangemaakt     timestamptz NOT NULL DEFAULT now(),
  CHECK ((bestemming = 'klant') = (klant_id IS NOT NULL))
);
CREATE INDEX toewijzingen_regel ON toewijzingen (regel_id);
CREATE INDEX toewijzingen_klant ON toewijzingen (klant_id);

-- a line can never be handed out more than once
CREATE FUNCTION toewijzing_past() RETURNS trigger AS $$
DECLARE
  max_aantal int;
  al         int;
BEGIN
  IF NEW.status = 'afgewezen' THEN RETURN NEW; END IF;
  SELECT aantal INTO max_aantal FROM factuur_regels WHERE id = NEW.regel_id FOR UPDATE;
  SELECT coalesce(sum(aantal), 0) INTO al FROM toewijzingen
   WHERE regel_id = NEW.regel_id AND status <> 'afgewezen' AND id <> coalesce(NEW.id, -1);
  IF al + NEW.aantal > max_aantal THEN
    RAISE EXCEPTION 'Er staan % stuks op deze regel; % zijn al verdeeld, dus % passen er niet meer bij.', max_aantal, al, NEW.aantal
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER toewijzing_past BEFORE INSERT OR UPDATE ON toewijzingen FOR EACH ROW EXECUTE FUNCTION toewijzing_past();

-- what happened, where and when
CREATE TABLE gebeurtenissen (
  id            serial PRIMARY KEY,
  zending_id    int REFERENCES zendingen ON DELETE CASCADE,
  levering_id   int REFERENCES leveringen ON DELETE CASCADE,
  bericht_id    int REFERENCES berichten_in ON DELETE SET NULL,
  tijd          timestamptz NOT NULL,
  soort         text NOT NULL CHECK (soort IN ('geladen','vertrokken','eta','aangekomen','vertraging','uitgeleverd','afgeleverd','opmerking')),
  plaats        text,
  eta           timestamptz,
  tekst         text,
  bron          text NOT NULL DEFAULT 'jan' CHECK (bron IN ('whatsapp','mail','jan','vervoerder','ai','demo')),
  CHECK (zending_id IS NOT NULL OR levering_id IS NOT NULL)
);
CREATE INDEX gebeurtenissen_zending ON gebeurtenissen (zending_id, tijd);
CREATE INDEX gebeurtenissen_levering ON gebeurtenissen (levering_id, tijd);

-- how a delivery went: anything that did not match
CREATE TABLE afwijkingen (
  id            serial PRIMARY KEY,
  factuur_id    int NOT NULL REFERENCES facturen ON DELETE CASCADE,
  regel_id      int REFERENCES factuur_regels ON DELETE CASCADE,
  soort         text NOT NULL CHECK (soort IN ('minder','meer','maat','kwaliteit','schade','te_laat','prijs','dubbel','afzender')),
  aantal        int,
  bedrag        numeric(12,2),
  tekst         text NOT NULL,
  opgelost      boolean NOT NULL DEFAULT false,
  oplossing     text CHECK (oplossing IN ('credit','nalevering','geaccepteerd','retour')),
  gemeld_op     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX afwijkingen_factuur ON afwijkingen (factuur_id);

-- messages to customers: drafted by the desk, sent by Jan
CREATE TABLE berichten_uit (
  id            serial PRIMARY KEY,
  klant_id      int NOT NULL REFERENCES klanten ON DELETE CASCADE,
  factuur_id    int REFERENCES facturen ON DELETE SET NULL,
  soort         text NOT NULL CHECK (soort IN ('levering','aanbod','vertraging')),
  kanaal        text NOT NULL CHECK (kanaal IN ('whatsapp','mail','telefoon')),
  taal          text NOT NULL,
  onderwerp     text,
  tekst         text NOT NULL,
  status        text NOT NULL DEFAULT 'concept' CHECK (status IN ('concept','verstuurd','geannuleerd')),
  aangemaakt    timestamptz NOT NULL DEFAULT now(),
  verstuurd_op  timestamptz
);
CREATE UNIQUE INDEX berichten_uit_uk ON berichten_uit (klant_id, factuur_id, soort) WHERE status <> 'geannuleerd';

-- sales invoices, for payment behaviour
CREATE TABLE verkoopfacturen (
  id            serial PRIMARY KEY,
  klant_id      int NOT NULL REFERENCES klanten ON DELETE CASCADE,
  order_id      int REFERENCES klant_orders ON DELETE SET NULL,
  nummer        text NOT NULL UNIQUE,
  datum         date NOT NULL,
  vervaldatum   date NOT NULL,
  bedrag        numeric(12,2) NOT NULL,
  betaald_op    date,
  CHECK (vervaldatum >= datum)
);
CREATE INDEX verkoopfacturen_klant ON verkoopfacturen (klant_id, datum DESC);

-- ---------------------------------------------------------------- bookkeeping of the desk itself
CREATE TABLE logboek (
  id            bigserial PRIMARY KEY,
  tijd          timestamptz NOT NULL DEFAULT now(),
  wie           text NOT NULL,
  actie         text NOT NULL,
  object        text,
  object_id     int,
  details       jsonb
);
CREATE INDEX logboek_tijd ON logboek (tijd DESC);

CREATE TABLE instellingen (
  sleutel       text PRIMARY KEY,
  waarde        jsonb NOT NULL,
  bijgewerkt    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- the step each invoice is in, derived from the data
CREATE VIEW factuur_stap AS
WITH r AS (
  SELECT f.id AS factuur_id,
         count(fr.id) AS regels,
         count(fr.id) FILTER (WHERE fr.plant_id IS NULL) AS zonder_plant,
         count(fr.id) FILTER (WHERE coalesce(fr.match_zekerheid, 100) < 75) AS twijfel,
         coalesce(sum(fr.aantal), 0) AS stuks
    FROM facturen f LEFT JOIN factuur_regels fr ON fr.factuur_id = f.id
   GROUP BY f.id
), t AS (
  SELECT fr.factuur_id,
         coalesce(sum(t.aantal) FILTER (WHERE t.status <> 'afgewezen'), 0) AS verdeeld,
         coalesce(sum(t.aantal) FILTER (WHERE t.status = 'voorstel'), 0) AS voorstel,
         count(DISTINCT t.klant_id) FILTER (WHERE t.status IN ('bevestigd','geleverd') AND t.bestemming = 'klant') AS klanten
    FROM factuur_regels fr JOIN toewijzingen t ON t.regel_id = fr.id
   GROUP BY fr.factuur_id
), b AS (
  SELECT factuur_id, count(DISTINCT klant_id) FILTER (WHERE status = 'verstuurd') AS verstuurd
    FROM berichten_uit GROUP BY factuur_id
)
SELECT f.id AS factuur_id, r.regels, r.zonder_plant, r.twijfel, r.stuks,
       coalesce(t.verdeeld, 0) AS verdeeld, coalesce(t.voorstel, 0) AS voorstel,
       r.stuks - coalesce(t.verdeeld, 0) AS rest,
       coalesce(t.klanten, 0) AS klanten, coalesce(b.verstuurd, 0) AS verstuurd,
       CASE
         WHEN f.afgerond THEN 'klaar'
         WHEN r.zonder_plant > 0 OR (r.twijfel > 0 AND NOT f.nagekeken) THEN 'nakijken'
         WHEN coalesce(t.voorstel, 0) > 0 THEN 'koppelen'
         WHEN r.stuks - coalesce(t.verdeeld, 0) > 0 THEN 'rest'
         WHEN coalesce(t.klanten, 0) > coalesce(b.verstuurd, 0) THEN 'informeren'
         ELSE 'klaar'
       END AS stap
  FROM facturen f
  JOIN r ON r.factuur_id = f.id
  LEFT JOIN t ON t.factuur_id = f.id
  LEFT JOIN b ON b.factuur_id = f.id;
