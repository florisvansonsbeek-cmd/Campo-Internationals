-- The Controle tab. The packing slip as it went to the customer is kept as a file; the entry the desk made in Exact is
-- remembered; and what Exact holds (read back from Exact Online, read from an export, or in the demo an imitated Exact)
-- is stored next to the desk's own numbers, so the check can say line by line whether it is right.
ALTER TABLE pakbonnen ADD COLUMN pdf_id int REFERENCES bestanden ON DELETE SET NULL;
ALTER TABLE pakbonnen ADD COLUMN exact_id text;
ALTER TABLE partijen ADD COLUMN exact_id text;

CREATE TABLE exact_imports (
  id        serial PRIMARY KEY,
  naam      text NOT NULL,
  rijen     int NOT NULL,
  kolommen  jsonb NOT NULL DEFAULT '{}',
  door      text,
  op        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE exact_boekingen (
  id            serial PRIMARY KEY,
  bron          text NOT NULL CHECK (bron IN ('api', 'import', 'demo')),
  soort         text NOT NULL CHECK (soort IN ('verkoop', 'inkoop')),
  referentie    text NOT NULL,                      -- our invoice number (sales) or the batch number (purchase)
  entry_nummer  text,                               -- the entry number in Exact
  datum         date,
  relatie_code  text,
  relatie       text,
  valuta        text NOT NULL DEFAULT 'EUR',
  bedrag        numeric(12,2),                      -- excl. VAT, in the entry's currency
  btw           numeric(12,2),
  regels        jsonb NOT NULL DEFAULT '[]',        -- per line: omschrijving, aantal, bedrag, kostendrager, grootboek, btw_code
  import_id     int REFERENCES exact_imports ON DELETE CASCADE,
  gelezen_op    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exact_boekingen_ref ON exact_boekingen (bron, soort, referentie);
