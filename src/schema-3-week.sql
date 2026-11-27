-- Campo desk database, version 3: the weekly import rhythm.
-- Tuesday Jan orders for the coming Monday. Thursday the supplier confirms what flies. Friday the boxes are on the plane
-- and the shipping documents come in: they are the purchase order for Exact. Monday the boxes are in the hall: Jan notes
-- the dollar rate for the week, counts the boxes, hands them out per customer and sends every customer one packing slip
-- that is also the invoice, with the plant passport on it.
-- One number runs through all of it: the batch number Jan gives every shipment, region code first (CR26-048).
-- It is C on the plant passport and the cost unit (kostendrager) in Exact, so in and out per region nets out to zero.
SET search_path TO campo, public;

-- ---------------------------------------------------------------- customers: what the invoice needs
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'campo.klanten'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%soort%' LOOP
    EXECUTE format('ALTER TABLE campo.klanten DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE klanten ADD CONSTRAINT klanten_soort_check CHECK (soort IN ('bloemist','tuincentrum','groothandel','interieur','supermarkt','evenementen','kwekerij','overig'));
ALTER TABLE klanten ADD COLUMN btw_nummer text;
ALTER TABLE klanten ADD COLUMN exact_code text;
ALTER TABLE klanten ADD COLUMN factuur_email text CHECK (factuur_email IS NULL OR factuur_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- ---------------------------------------------------------------- where the goods come from
CREATE TABLE regios (
  code      text PRIMARY KEY CHECK (code ~ '^[A-Z]{2,3}$'),
  naam      text NOT NULL CHECK (length(btrim(naam)) > 1),
  land      char(2) NOT NULL CHECK (land ~ '^[A-Z]{2}$'),            -- country of origin, D on the plant passport
  valuta    char(3) NOT NULL DEFAULT 'USD' CHECK (valuta ~ '^[A-Z]{3}$'),
  vervoer   text,
  bron      text NOT NULL DEFAULT 'handmatig' CHECK (bron IN ('demo','handmatig','import'))
);

CREATE TABLE leveranciers (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9-]{2,40}$'),
  naam        text NOT NULL CHECK (length(btrim(naam)) > 1),
  regio       text NOT NULL REFERENCES regios ON UPDATE CASCADE,
  plaats      text,
  contact     text,
  email       text CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telefoon    text,
  whatsapp    text CHECK (whatsapp IS NULL OR whatsapp ~ '^\+[0-9]{8,15}$'),
  taal        text NOT NULL DEFAULT 'es' CHECK (taal IN ('es','en','nl','de')),
  exact_code  text,
  actief      boolean NOT NULL DEFAULT true,
  bron        text NOT NULL DEFAULT 'handmatig' CHECK (bron IN ('demo','handmatig','import')),
  aangemaakt  timestamptz NOT NULL DEFAULT now()
);

-- a product is a kind in one size: Hockeystick 60 cm. Ten lines of "the same" plant differ in size or supplier.
CREATE TABLE producten (
  id              serial PRIMARY KEY,
  code            text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,30}$'),
  naam            text NOT NULL CHECK (length(btrim(naam)) > 1),
  soort           text NOT NULL CHECK (length(btrim(soort)) > 1),   -- botanical name, A on the plant passport
  maat            text NOT NULL,
  per_doos        int NOT NULL CHECK (per_doos > 0 AND per_doos < 100000),
  prijs_usd       numeric(10,3) CHECK (prijs_usd >= 0),              -- usual sales price per piece
  inkoop_usd      numeric(10,3) CHECK (inkoop_usd >= 0),             -- usual purchase price per piece
  leverancier_id  int REFERENCES leveranciers ON DELETE SET NULL,     -- who usually supplies it
  exact_code      text,
  volgorde        int NOT NULL DEFAULT 0,
  actief          boolean NOT NULL DEFAULT true,
  bron            text NOT NULL DEFAULT 'handmatig' CHECK (bron IN ('demo','handmatig','import'))
);

-- a price agreed with one customer, in dollars per piece
CREATE TABLE prijsafspraken (
  klant_id    int NOT NULL REFERENCES klanten ON DELETE CASCADE,
  product_id  int NOT NULL REFERENCES producten ON DELETE CASCADE,
  prijs_usd   numeric(10,3) NOT NULL CHECK (prijs_usd >= 0),
  PRIMARY KEY (klant_id, product_id)
);

-- ---------------------------------------------------------------- the week: one row per arrival Monday
CREATE TABLE weken (
  maandag      date PRIMARY KEY CHECK (extract(isodow FROM maandag) = 1),
  koers        numeric(9,5) CHECK (koers > 0 AND koers < 10),   -- dollars for one euro, noted by Jan on Monday, used all week
  koers_op     timestamptz,
  koers_door   text,
  geteld_op    timestamptz,
  geteld_door  text,
  besteld_op   timestamptz,
  notitie      text
);

-- what customers asked for, mostly on the phone; in whole boxes
CREATE TABLE weekorders (
  id          serial PRIMARY KEY,
  maandag     date NOT NULL REFERENCES weken ON DELETE CASCADE,
  klant_id    int NOT NULL REFERENCES klanten ON DELETE CASCADE,
  product_id  int NOT NULL REFERENCES producten ON DELETE CASCADE,
  dozen       int NOT NULL CHECK (dozen > 0 AND dozen < 10000),
  via         text NOT NULL DEFAULT 'telefoon' CHECK (via IN ('telefoon','mail','whatsapp','vast','demo')),
  notitie     text,
  door        text,
  aangemaakt  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (maandag, klant_id, product_id)
);
CREATE INDEX weekorders_klant ON weekorders (klant_id, maandag);

-- ---------------------------------------------------------------- one shipment from one supplier: one batch number
CREATE TABLE partijen (
  id              serial PRIMARY KEY,
  nummer          text NOT NULL UNIQUE CHECK (nummer ~ '^[A-Z0-9][A-Z0-9-]{2,15}$'),
  regio           text NOT NULL REFERENCES regios ON UPDATE CASCADE,
  leverancier_id  int NOT NULL REFERENCES leveranciers,
  maandag         date NOT NULL REFERENCES weken ON DELETE CASCADE,
  besteld_op      timestamptz,
  bevestigd_op    timestamptz,
  verzonden_op    timestamptz,
  binnen_op       timestamptz,
  awb             text,
  vlucht          text,
  fyto            text,
  dozen_doc       int CHECK (dozen_doc >= 0),
  exact           text NOT NULL DEFAULT 'open' CHECK (exact IN ('open','in_exact')),
  exact_nummer    text,
  exact_op        timestamptz,
  exact_door      text,
  notitie         text,
  bron            text NOT NULL DEFAULT 'handmatig' CHECK (bron IN ('demo','handmatig','import')),
  aangemaakt      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partijen_maandag ON partijen (maandag);
CREATE INDEX partijen_regio ON partijen (regio, maandag);

-- boxes per product: ordered (Tuesday), confirmed (Thursday), on the shipping documents (Friday), counted (Monday)
CREATE TABLE partij_regels (
  id          serial PRIMARY KEY,
  partij_id   int NOT NULL REFERENCES partijen ON DELETE CASCADE,
  product_id  int NOT NULL REFERENCES producten,
  besteld     int CHECK (besteld >= 0),
  bevestigd   int CHECK (bevestigd >= 0),
  verzonden   int CHECK (verzonden >= 0),
  geteld      int CHECK (geteld >= 0),
  uitval      int NOT NULL DEFAULT 0 CHECK (uitval >= 0),          -- boxes that cannot be sold; kept apart in the net-zero sum
  per_doos    int NOT NULL CHECK (per_doos > 0),
  prijs_usd   numeric(10,4) NOT NULL CHECK (prijs_usd >= 0),       -- purchase price per piece
  zekerheid   int CHECK (zekerheid BETWEEN 0 AND 100),             -- how sure the desk is of what it read
  twijfel     text,                                                -- what the desk doubts; empty once Jan checked it
  gelezen     jsonb,                                               -- per field: what the desk read and where
  UNIQUE (partij_id, product_id)
);
CREATE INDEX partij_regels_product ON partij_regels (product_id);

-- the papers of a shipment: Jan's order, the confirmation, the commercial invoice with packing list, the AWB, the phyto
CREATE TABLE partij_documenten (
  id            serial PRIMARY KEY,
  partij_id     int NOT NULL REFERENCES partijen ON DELETE CASCADE,
  soort         text NOT NULL CHECK (soort IN ('bestelling','bevestiging','verzendbewijs','awb','fyto','overig')),
  titel         text,
  bestand_id    int REFERENCES bestanden ON DELETE SET NULL,
  bericht_id    int REFERENCES berichten_in ON DELETE SET NULL,
  tekst         text,
  ontvangen     timestamptz NOT NULL DEFAULT now(),
  gelezen_door  text NOT NULL DEFAULT 'jan' CHECK (gelezen_door IN ('ai','regels','jan','demo'))
);
CREATE INDEX partij_documenten_partij ON partij_documenten (partij_id);

-- ---------------------------------------------------------------- Monday: the boxes of one shipment line for one customer
CREATE TABLE verdeling (
  regel_id  int NOT NULL REFERENCES partij_regels ON DELETE CASCADE,
  klant_id  int NOT NULL REFERENCES klanten ON DELETE CASCADE,
  dozen     int NOT NULL CHECK (dozen >= 0),
  door      text NOT NULL DEFAULT 'desk' CHECK (door IN ('desk','jan','demo')),
  PRIMARY KEY (regel_id, klant_id)
);
CREATE INDEX verdeling_klant ON verdeling (klant_id);

-- one packing slip per customer per Monday; it is the invoice as well. Made when Jan says it is right; the lines are fixed then.
CREATE TABLE pakbonnen (
  id            serial PRIMARY KEY,
  nummer        text NOT NULL UNIQUE,
  maandag       date NOT NULL REFERENCES weken ON DELETE CASCADE,
  klant_id      int NOT NULL REFERENCES klanten ON DELETE CASCADE,
  datum         date NOT NULL,
  vervaldatum   date NOT NULL,
  koers         numeric(9,5) NOT NULL CHECK (koers > 0),
  btw_pct       numeric(4,1) NOT NULL DEFAULT 0 CHECK (btw_pct >= 0),
  totaal        numeric(12,2) NOT NULL,                 -- euro, excl. VAT
  status        text NOT NULL DEFAULT 'akkoord' CHECK (status IN ('akkoord','heropend')),   -- reopened keeps its number
  exact         text NOT NULL DEFAULT 'open' CHECK (exact IN ('open','in_exact')),
  exact_nummer  text,
  exact_op      timestamptz,
  exact_door    text,
  gedrukt_op    timestamptz,
  door          text,
  bron          text NOT NULL DEFAULT 'handmatig' CHECK (bron IN ('demo','handmatig','import')),
  aangemaakt    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (maandag, klant_id),
  CHECK (vervaldatum >= datum)
);
CREATE INDEX pakbonnen_klant ON pakbonnen (klant_id, maandag);

CREATE TABLE pakbon_regels (
  id          serial PRIMARY KEY,
  pakbon_id   int NOT NULL REFERENCES pakbonnen ON DELETE CASCADE,
  regelnr     int NOT NULL CHECK (regelnr > 0),
  regel_id    int REFERENCES partij_regels ON DELETE SET NULL,
  product_id  int NOT NULL REFERENCES producten,
  partij      text NOT NULL,                             -- the batch number as printed: C on the plant passport
  dozen       int NOT NULL CHECK (dozen > 0),
  stuks       int NOT NULL CHECK (stuks > 0),
  prijs_usd   numeric(10,4) NOT NULL CHECK (prijs_usd >= 0),
  prijs_eur   numeric(10,4) NOT NULL CHECK (prijs_eur >= 0),
  bedrag      numeric(12,2) NOT NULL,
  UNIQUE (pakbon_id, regelnr)
);
CREATE INDEX pakbon_regels_regel ON pakbon_regels (regel_id);
CREATE INDEX pakbon_regels_partij ON pakbon_regels (partij);

-- ---------------------------------------------------------------- draft mails now also carry a customer's packing slip and invoice
ALTER TABLE concepten ALTER COLUMN aanbod_id DROP NOT NULL;
ALTER TABLE concepten ADD COLUMN pakbon_id int REFERENCES pakbonnen ON DELETE CASCADE;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'campo.concepten'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%soort%' LOOP
    EXECUTE format('ALTER TABLE campo.concepten DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE concepten ADD CONSTRAINT concepten_soort_check CHECK (soort IN ('bestelling','offerte','factuur'));
ALTER TABLE concepten ADD CONSTRAINT concepten_waarvoor_check CHECK (
     (soort = 'bestelling' AND kweker_id IS NOT NULL AND aanbod_id IS NOT NULL)
  OR (soort = 'offerte' AND klant_id IS NOT NULL AND aanbod_id IS NOT NULL)
  OR (soort = 'factuur' AND klant_id IS NOT NULL AND pakbon_id IS NOT NULL));
CREATE UNIQUE INDEX concepten_pakbon_uk ON concepten (pakbon_id) WHERE pakbon_id IS NOT NULL AND status <> 'vervallen';
