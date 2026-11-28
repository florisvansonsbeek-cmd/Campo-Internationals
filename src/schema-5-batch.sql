-- Campo desk database, version 5: the batch number as Jan gives it.
-- Year, week, region: 26 49 01 = 264901 (2026, week 49, region 01). Every supplier from one region that arrives in the
-- same week is in the same batch. The number is C on the plant passport and the cost unit (kostendrager) in Exact.
SET search_path TO campo, public;

-- the region's two digits in the batch number (01 to 04 for Jan's regions; up to 99 if more come)
ALTER TABLE regios ADD COLUMN nummer smallint CHECK (nummer BETWEEN 1 AND 99);
UPDATE regios g SET nummer = x.n FROM (SELECT code, row_number() OVER (ORDER BY code) AS n FROM regios) x WHERE x.code = g.code;
ALTER TABLE regios ADD CONSTRAINT regios_nummer_uniek UNIQUE (nummer);

-- one batch per region per week, so two shipments can carry the same number; per supplier it stays one
ALTER TABLE partijen DROP CONSTRAINT IF EXISTS partijen_nummer_key;
CREATE INDEX IF NOT EXISTS partijen_nummer ON partijen (nummer);
ALTER TABLE partijen ADD CONSTRAINT partijen_nummer_leverancier UNIQUE (nummer, leverancier_id);
