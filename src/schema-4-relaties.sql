-- Campo desk database, version 4: the way a shipment travels and what could stop it, offers from suppliers,
-- people Jan could work with, and when customers paid. Together they answer three questions of Jan's:
-- does it arrive on Monday, how good are my partners really, and where is easy money.
SET search_path TO campo, public;

-- ---------------------------------------------------------------- the route: airport codes from the supplier's country to Europe
-- {SJO,AMS} is San José straight to Schiphol, {GUA,MIA,AMS} changes planes in Miami. After the last airport the truck to Nootdorp.
ALTER TABLE leveranciers ADD COLUMN IF NOT EXISTS route text[];
ALTER TABLE partijen ADD COLUMN IF NOT EXISTS route text[];
-- when the boxes should be in the hall, when it is not the usual Monday morning (Jan heard of a delay)
ALTER TABLE partijen ADD COLUMN IF NOT EXISTS verwacht_op timestamptz;

-- ---------------------------------------------------------------- what Jan hears about the world
-- a strike at Schiphol, ash over an airport, a road closed. The desk adds the weather and the storms itself.
CREATE TABLE risico_meldingen (
  id               serial PRIMARY KEY,
  soort            text NOT NULL DEFAULT 'overig' CHECK (soort IN ('weer','storm','vulkaan','staking','douane','capaciteit','vertraging','overig')),
  ernst            text NOT NULL DEFAULT 'let_op' CHECK (ernst IN ('let_op','probleem')),
  titel            text NOT NULL CHECK (length(btrim(titel)) > 1),
  tekst            text,
  plek             text,                -- an airport code (MIA), a region (GT), NL for the road to Nootdorp; empty is every route
  partij_id        int REFERENCES partijen ON DELETE CASCADE,
  vertraging_uren  int CHECK (vertraging_uren BETWEEN 0 AND 240),
  van              timestamptz NOT NULL DEFAULT now(),
  tot              timestamptz,
  bron             text NOT NULL DEFAULT 'jan' CHECK (bron IN ('jan','demo','desk')),
  door             text,
  opgelost_op      timestamptz,
  aangemaakt       timestamptz NOT NULL DEFAULT now(),
  CHECK (tot IS NULL OR tot > van)
);
CREATE INDEX risico_meldingen_tijd ON risico_meldingen (van, tot);

-- ---------------------------------------------------------------- an offer: extra boxes or a better price for one arrival Monday
CREATE TABLE leverancier_aanbod (
  id              serial PRIMARY KEY,
  leverancier_id  int NOT NULL REFERENCES leveranciers ON DELETE CASCADE,
  product_id      int NOT NULL REFERENCES producten ON DELETE CASCADE,
  maandag         date NOT NULL,
  dozen           int NOT NULL CHECK (dozen BETWEEN 1 AND 9999),
  prijs_usd       numeric(10,4) NOT NULL CHECK (prijs_usd >= 0 AND prijs_usd < 10000),
  notitie         text,
  ontvangen       timestamptz NOT NULL DEFAULT now(),
  geldig_tot      timestamptz,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','genomen','afgewezen')),
  genomen_dozen   int CHECK (genomen_dozen IS NULL OR genomen_dozen BETWEEN 0 AND 9999),
  status_op       timestamptz,
  door            text,
  bron            text NOT NULL DEFAULT 'handmatig' CHECK (bron IN ('demo','handmatig','mail')),
  aangemaakt      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leverancier_aanbod_maandag ON leverancier_aanbod (maandag, status);

-- ---------------------------------------------------------------- people Jan could work with, and how far it got
CREATE TABLE kansen (
  id          serial PRIMARY KEY,
  soort       text NOT NULL CHECK (soort IN ('klant','leverancier')),
  naam        text NOT NULL CHECK (length(btrim(naam)) > 1),
  plaats      text,
  land        text,
  segment     text,                  -- kwekerij, interieur, groothandel … or what a supplier grows
  contact     text,
  telefoon    text,
  email       text,
  wat         text,                  -- what they would buy or sell
  waarom      text,                  -- why it fits
  status      text NOT NULL DEFAULT 'nieuw' CHECK (status IN ('nieuw','benaderd','in_gesprek','klant','afgewezen')),
  notitie     text,
  bron        text NOT NULL DEFAULT 'jan' CHECK (bron IN ('jan','demo','desk')),
  aangemaakt  timestamptz NOT NULL DEFAULT now(),
  bijgewerkt  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- paid: from Exact, or ticked by Jan
ALTER TABLE pakbonnen ADD COLUMN IF NOT EXISTS betaald_op date;

-- which customer took how many boxes of an offer (Jan notes it after the phone call)
CREATE TABLE aanbod_verkoop (
  aanbod_id   int NOT NULL REFERENCES leverancier_aanbod ON DELETE CASCADE,
  klant_id    int NOT NULL REFERENCES klanten ON DELETE CASCADE,
  dozen       int NOT NULL CHECK (dozen BETWEEN 1 AND 9999),
  door        text,
  op          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (aanbod_id, klant_id)
);
