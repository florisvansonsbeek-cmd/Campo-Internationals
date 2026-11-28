-- Campo desk database, version 6: Monday's check step. After the boxes are in and laid out per region and customer,
-- Jan looks it over (other numbers, a customer out) and says it is right; then the packing slips.
SET search_path TO campo, public;
ALTER TABLE weken ADD COLUMN nagekeken_op timestamptz;
ALTER TABLE weken ADD COLUMN nagekeken_door text;
