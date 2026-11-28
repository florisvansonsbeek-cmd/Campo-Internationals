-- Monday, the hand-out by hand. From Jan's first change to a product in a week (dragging a line to another customer
-- or to the loods, a number up or down), the hand-out of that product is his: the desk stops redistributing it, so
-- every box stays exactly where he put it. "Terug naar het voorstel" removes the row and the desk takes over again.
CREATE TABLE verdeling_vast (
  maandag     date NOT NULL REFERENCES weken ON DELETE CASCADE,
  product_id  int  NOT NULL REFERENCES producten ON DELETE CASCADE,
  door        text,
  op          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (maandag, product_id)
);
