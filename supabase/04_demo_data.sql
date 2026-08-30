-- =====================================================================
-- 04 — Demo data: REMOVED, and cleaned up.
--
-- This file used to insert three placeholder facilities called "Sample
-- Primary Health Centre", "Sample Community Health Centre" and "Sample
-- District Hospital". They were stamped 'unverified' so the interface
-- would not present them as fact, but they are gone now for a better
-- reason than labelling: they are no longer needed.
--
-- Facility data now comes from the real thing. `public.hospitals` is
-- loaded from the National Health Authority's PM-JAY empanelment
-- registry by scripts/import-hospitals.mjs — roughly 38,900 hospitals
-- across every state, with coordinates for about 96% of them. A
-- placeholder next to that is not a helpful stand-in, it is a hazard: a
-- row reading "Demo District" is the one thing on the screen that could
-- send somebody to an address that does not exist.
--
-- The statement below deletes those three rows if an earlier version of
-- this file was already run. It is keyed on the exact placeholder source
-- string, so it cannot touch a real facility that somebody has since
-- added by hand.
--
-- Health camps were always left empty and still are. A camp that does
-- not exist sends someone walking to a field for nothing, so the app
-- says "No verified health camps found." rather than inventing one.
-- =====================================================================

delete from public.healthcare_facilities
where source = 'DEMO PLACEHOLDER — not a real facility';

do $$
declare
  removed int;
begin
  select count(*) into removed
  from public.healthcare_facilities
  where source = 'DEMO PLACEHOLDER — not a real facility';

  if removed = 0 then
    raise notice 'No demo facilities present. Real hospital data lives in public.hospitals — run scripts/import-hospitals.mjs if that table is empty.';
  end if;
end $$;
