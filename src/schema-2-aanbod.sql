-- Campo desk database, version 2: offers from growers, before anything is ordered.
-- A grower sends a basket of plants (mail, WhatsApp, upload). The desk reads it, links every plant to the
-- customers who are likely to take it, checks the risks, and drafts the order and the customer mails.
-- Jan calls, decides and sends. Nothing here orders, mails or pays by itself.
SET search_path TO campo, public;

ALTER TABLE berichten_in DROP CONSTRAINT IF EXISTS berichten_in_soort_check;
ALTER TABLE berichten_in ADD CONSTRAINT berichten_in_soort_check CHECK (soort IN ('factuur','pakbon','bevestiging','tijd','aanbod','overig'));

CREATE SEQUENCE bestelnummer_seq;
CREATE SEQUENCE offertenummer_seq;

-- ---------------------------------------------------------------- one offer from one grower
CREATE TABLE aanbiedingen (
  id            serial PRIMARY KEY,
  kweker_id     int NOT NULL REFERENCES kwekers ON DELETE CASCADE,
  nummer        text,                                   -- the grower's own reference, if any
  bestelnummer  text UNIQUE,                            -- ours, once Jan orders: CI-B-26-0012
  bericht_id    int REFERENCES berichten_in ON DELETE SET NULL,
  bestand_id    int REFERENCES bestanden ON DELETE SET NULL,
  ontvangen     timestamptz NOT NULL DEFAULT now(),
  geldig_tot    timestamptz,
  levering      date,                                   -- the day the grower can deliver
  gelezen_door  text NOT NULL DEFAULT 'jan' CHECK (gelezen_door IN ('ai','regels','jan','demo')),
  zekerheid     int CHECK (zekerheid BETWEEN 0 AND 100),
  waarschuwing  text,
  hele_partij   boolean NOT NULL DEFAULT false,          -- all or nothing
  status        text NOT NULL DEFAULT 'nieuw' CHECK (status IN ('nieuw','bellen','besteld','afgewezen')),
  besteld_op    timestamptz,
  afgewezen_om  text,
  factuur_id    int REFERENCES facturen ON DELETE SET NULL,
  risico        jsonb,
  gemeld_op     timestamptz,
  notitie       text,
  aangemaakt    timestamptz NOT NULL DEFAULT now(),
  bijgewerkt    timestamptz NOT NULL DEFAULT now(),
  CHECK (geldig_tot IS NULL OR geldig_tot > ontvangen - interval '1 day'),
  CHECK ((status = 'besteld') = (besteld_op IS NOT NULL) OR status = 'afgewezen')
);
CREATE INDEX aanbiedingen_ontvangen ON aanbiedingen (ontvangen DESC);
CREATE INDEX aanbiedingen_kweker ON aanbiedingen (kweker_id, ontvangen DESC);
CREATE INDEX aanbiedingen_status ON aanbiedingen (status);
CREATE UNIQUE INDEX aanbiedingen_bericht_uk ON aanbiedingen (bericht_id) WHERE bericht_id IS NOT NULL;

CREATE TABLE aanbod_regels (
  id              serial PRIMARY KEY,
  aanbod_id       int NOT NULL REFERENCES aanbiedingen ON DELETE CASCADE,
  regelnr         int NOT NULL CHECK (regelnr > 0),
  omschrijving    text NOT NULL CHECK (length(btrim(omschrijving)) > 0),
  plant_id        int REFERENCES planten ON DELETE SET NULL,
  match_zekerheid int CHECK (match_zekerheid BETWEEN 0 AND 100),
  aantal          int NOT NULL CHECK (aantal > 0 AND aantal < 1000000),   -- what the grower offers
  prijs           numeric(10,3) NOT NULL CHECK (prijs >= 0 AND prijs < 100000),
  minimum         int CHECK (minimum > 0),
  extra           int NOT NULL DEFAULT 0 CHECK (extra >= 0),               -- Jan takes this much more for the loods
  bestellen       int CHECK (bestellen >= 0),                              -- fixed when Jan orders
  UNIQUE (aanbod_id, regelnr),
  CHECK (bestellen IS NULL OR bestellen <= aantal),
  CHECK (extra <= aantal)
);
CREATE INDEX aanbod_regels_plant ON aanbod_regels (plant_id);

-- who takes what: one row per line per customer
--   bron 'order':  the customer had already asked for it (an open order), so it is agreed already
--   bron 'aanbod': a new sale; Jan calls and the customer says yes or no
CREATE TABLE aanbod_klanten (
  id             serial PRIMARY KEY,
  regel_id       int NOT NULL REFERENCES aanbod_regels ON DELETE CASCADE,
  klant_id       int NOT NULL REFERENCES klanten ON DELETE CASCADE,
  order_regel_id int REFERENCES klant_order_regels ON DELETE SET NULL,
  bron           text NOT NULL DEFAULT 'aanbod' CHECK (bron IN ('order','aanbod')),
  aantal         int NOT NULL CHECK (aantal > 0),
  verkoopprijs   numeric(10,2) NOT NULL CHECK (verkoopprijs >= 0),
  score          int CHECK (score BETWEEN 0 AND 100),
  reden          text,
  status         text NOT NULL DEFAULT 'voorstel' CHECK (status IN ('voorstel','akkoord','nee')),
  door           text NOT NULL DEFAULT 'ai' CHECK (door IN ('ai','jan','demo')),
  aangemaakt     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (regel_id, klant_id)
);
CREATE INDEX aanbod_klanten_klant ON aanbod_klanten (klant_id);
CREATE INDEX aanbod_klanten_order ON aanbod_klanten (order_regel_id);

-- a line can never be promised to customers more than once over
CREATE FUNCTION aanbod_klant_past() RETURNS trigger AS $$
DECLARE
  max_aantal int;
  al         int;
BEGIN
  IF NEW.status = 'nee' THEN RETURN NEW; END IF;
  SELECT aantal INTO max_aantal FROM aanbod_regels WHERE id = NEW.regel_id FOR UPDATE;
  SELECT coalesce(sum(aantal), 0) INTO al FROM aanbod_klanten
   WHERE regel_id = NEW.regel_id AND status <> 'nee' AND id <> coalesce(NEW.id, -1);
  IF al + NEW.aantal > max_aantal THEN
    RAISE EXCEPTION 'De kweker biedt % stuks aan; % zijn al aan klanten toegezegd, dus % passen er niet meer bij.', max_aantal, al, NEW.aantal
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER aanbod_klant_past BEFORE INSERT OR UPDATE ON aanbod_klanten FOR EACH ROW EXECUTE FUNCTION aanbod_klant_past();

-- ---------------------------------------------------------------- draft mails: the desk writes them, Jan sends them
CREATE TABLE concepten (
  id              serial PRIMARY KEY,
  aanbod_id       int NOT NULL REFERENCES aanbiedingen ON DELETE CASCADE,
  soort           text NOT NULL CHECK (soort IN ('bestelling','offerte')),
  kweker_id       int REFERENCES kwekers ON DELETE CASCADE,
  klant_id        int REFERENCES klanten ON DELETE CASCADE,
  nummer          text,
  aan             text,
  taal            text NOT NULL DEFAULT 'nl',
  onderwerp       text NOT NULL,
  tekst           text NOT NULL,
  html            text NOT NULL,
  inhoud          jsonb NOT NULL,                       -- the lines and dates the mail and the pdf were made from
  bijlage_naam    text,
  status          text NOT NULL DEFAULT 'concept' CHECK (status IN ('concept','in_outlook','verstuurd','vervallen')),
  waar            text CHECK (waar IN ('microsoft','imap')),
  extern_id       text,
  extern_link     text,
  gesprek         text NOT NULL DEFAULT 'open' CHECK (gesprek IN ('open','akkoord','nee','terugbellen')),
  gesprek_notitie text,
  gebeld_op       timestamptz,
  gezet_op        timestamptz,
  verstuurd_op    timestamptz,
  aangemaakt      timestamptz NOT NULL DEFAULT now(),
  bijgewerkt      timestamptz NOT NULL DEFAULT now(),
  CHECK ((soort = 'bestelling') = (kweker_id IS NOT NULL)),
  CHECK ((soort = 'offerte') = (klant_id IS NOT NULL))
);
CREATE UNIQUE INDEX concepten_uk ON concepten (aanbod_id, soort, coalesce(klant_id, 0)) WHERE status <> 'vervallen';
CREATE INDEX concepten_status ON concepten (status);

-- ---------------------------------------------------------------- what an order sets in motion
ALTER TABLE zendingen ADD COLUMN aanbod_id int REFERENCES aanbiedingen ON DELETE SET NULL;
CREATE UNIQUE INDEX zendingen_aanbod_uk ON zendingen (aanbod_id) WHERE aanbod_id IS NOT NULL;
ALTER TABLE klant_orders ADD COLUMN aanbod_id int REFERENCES aanbiedingen ON DELETE SET NULL;
CREATE INDEX klant_orders_aanbod ON klant_orders (aanbod_id);
