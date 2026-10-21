CREATE TABLE public.ski_areas (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  country text NOT NULL DEFAULT '',
  country_name text NOT NULL DEFAULT '',
  region text NOT NULL DEFAULT '',
  locality text NOT NULL DEFAULT '',
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  bounds jsonb,
  website text,
  ski_types text[] NOT NULL DEFAULT '{}',
  elevation_min_ft integer,
  elevation_max_ft integer,
  lifts integer NOT NULL DEFAULT 0,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  file text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ski_areas_country_idx ON public.ski_areas (country);
CREATE INDEX ski_areas_name_idx ON public.ski_areas (lower(name));

GRANT SELECT ON public.ski_areas TO anon;
GRANT SELECT ON public.ski_areas TO authenticated;
GRANT ALL ON public.ski_areas TO service_role;

ALTER TABLE public.ski_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY ski_areas_public_read ON public.ski_areas
  FOR SELECT TO anon, authenticated
  USING (true);