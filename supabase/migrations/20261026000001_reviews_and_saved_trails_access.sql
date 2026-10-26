-- Trail reviews and saved trails for catalog trails (tables from 20261020000001): the row-level security
-- policies existed, but the roles had no table privileges, so every read answered "permission denied".
-- Anyone may read reviews; signed-in people write, edit and delete their own; saved trails are owner-only.
-- Safe to run more than once.

GRANT SELECT ON public.catalog_trail_reviews TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.catalog_trail_reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.favorite_trails TO authenticated;
