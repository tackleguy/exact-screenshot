-- Outdoor OS: Phase 1 + 2 schema
CREATE EXTENSION IF NOT EXISTS postgis;

-- Profiles (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  brief_bio TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Parks
CREATE TABLE public.parks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  park_name TEXT NOT NULL,
  description TEXT NOT NULL,
  acreage INTEGER NOT NULL,
  contact TEXT,
  country TEXT NOT NULL,
  state TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  location GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  ) STORED,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX parks_location_idx ON public.parks USING GIST (location);
CREATE INDEX parks_name_idx ON public.parks USING gin (to_tsvector('english', park_name));

-- Trails
CREATE TABLE public.trails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  park_id UUID NOT NULL REFERENCES public.parks(id) ON DELETE CASCADE,
  trail_name TEXT NOT NULL,
  description TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'moderate', 'hard')),
  length_miles DOUBLE PRECISION NOT NULL,
  elevation_ft INTEGER NOT NULL,
  duration TEXT,
  route_type TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  location GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  ) STORED,
  image_url TEXT,
  avg_rating NUMERIC(3, 2) NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX trails_park_id_idx ON public.trails(park_id);
CREATE INDEX trails_location_idx ON public.trails USING GIST (location);
CREATE INDEX trails_name_idx ON public.trails USING gin (to_tsvector('english', trail_name));
CREATE INDEX trails_difficulty_idx ON public.trails(difficulty);

-- Reviews
CREATE TABLE public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_id UUID NOT NULL REFERENCES public.trails(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body TEXT,
  review_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trail_id, user_id)
);

CREATE INDEX reviews_trail_id_idx ON public.reviews(trail_id);
CREATE INDEX reviews_user_id_idx ON public.reviews(user_id);

-- Keep trail rating aggregates in sync
CREATE OR REPLACE FUNCTION public.refresh_trail_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_trail_id UUID;
BEGIN
  target_trail_id := COALESCE(NEW.trail_id, OLD.trail_id);

  UPDATE public.trails t
  SET
    avg_rating = COALESCE((
      SELECT ROUND(AVG(r.rating)::numeric, 2)
      FROM public.reviews r
      WHERE r.trail_id = target_trail_id
    ), 0),
    review_count = (
      SELECT COUNT(*)::integer
      FROM public.reviews r
      WHERE r.trail_id = target_trail_id
    ),
    updated_at = now()
  WHERE t.id = target_trail_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER reviews_rating_refresh
AFTER INSERT OR UPDATE OR DELETE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.refresh_trail_rating();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', 'Adventurer'),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Grant API access
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.parks TO anon, authenticated;
GRANT SELECT ON public.trails TO anon, authenticated;
GRANT SELECT ON public.reviews TO anon, authenticated;
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.reviews TO authenticated;

CREATE POLICY "Parks are viewable by everyone"
  ON public.parks FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Trails are viewable by everyone"
  ON public.trails FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Reviews are viewable by everyone"
  ON public.reviews FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Profiles are viewable by everyone"
  ON public.profiles FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Authenticated users can create reviews"
  ON public.reviews FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reviews"
  ON public.reviews FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own reviews"
  ON public.reviews FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
-- Activities for Strava-style GPS tracking
CREATE TABLE IF NOT EXISTS public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('run', 'hike', 'bike', 'ski')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('recording', 'completed')),
  title TEXT NOT NULL,
  distance_m NUMERIC NOT NULL DEFAULT 0,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  elevation_gain_ft INTEGER NOT NULL DEFAULT 0,
  route_geojson JSONB,
  trail_id UUID REFERENCES public.trails(id) ON DELETE SET NULL,
  ski_area_id TEXT,
  ski_area_name TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activities_user_id_idx ON public.activities(user_id);
CREATE INDEX IF NOT EXISTS activities_started_at_idx ON public.activities(started_at DESC);

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activities TO authenticated;

CREATE POLICY "Users can view own activities"
  ON public.activities FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own activities"
  ON public.activities FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own activities"
  ON public.activities FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own activities"
  ON public.activities FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Expanded trail catalog (Yosemite, Bay Area, Rockies, Southwest, PNW, Smokies)
INSERT INTO public.parks (id, park_name, description, acreage, contact, country, state, latitude, longitude, image_url) VALUES
(
  'a0000000-0000-4000-8000-000000000004',
  'Yosemite National Park',
  'Iconic granite cliffs, waterfalls, and giant sequoias in California''s Sierra Nevada.',
  759620,
  '209-372-0200',
  'United States of America',
  'California',
  37.8651,
  -119.5383,
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=80'
),
(
  'a0000000-0000-4000-8000-000000000005',
  'Golden Gate National Recreation Area',
  'Urban-adjacent coastal trails from the Marin Headlands to San Francisco.',
  82116,
  '415-561-4700',
  'United States of America',
  'California',
  37.8324,
  -122.4795,
  'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=1200&q=80'
),
(
  'a0000000-0000-4000-8000-000000000006',
  'Rocky Mountain National Park',
  'Alpine tundra, elk meadows, and 14,000 ft peaks in Colorado.',
  265461,
  '970-586-1206',
  'United States of America',
  'Colorado',
  40.3428,
  -105.6836,
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200&q=80'
),
(
  'a0000000-0000-4000-8000-000000000007',
  'Grand Canyon National Park',
  'One of the world''s most spectacular canyon landscapes on the Colorado Plateau.',
  1201647,
  '928-638-7888',
  'United States of America',
  'Arizona',
  36.0544,
  -112.1401,
  'https://images.unsplash.com/photo-1474044159687-1ee9f3a51722?w=1200&q=80'
),
(
  'a0000000-0000-4000-8000-000000000008',
  'Great Smoky Mountains National Park',
  'Ancient mountains, diverse wildlife, and misty Appalachian forests.',
  522427,
  '865-436-1200',
  'United States of America',
  'Tennessee',
  35.6532,
  -83.5070,
  'https://images.unsplash.com/photo-1448375248136-8827089dd12f?w=1200&q=80'
),
(
  'a0000000-0000-4000-8000-000000000009',
  'Mount Rainier National Park',
  'Glaciated volcano, wildflower meadows, and old-growth forests in Washington.',
  236381,
  '360-569-2211',
  'United States of America',
  'Washington',
  46.8797,
  -121.7269,
  'https://images.unsplash.com/photo-1518173946687-a4c036bc253c?w=1200&q=80'
),
(
  'a0000000-0000-4000-8000-000000000010',
  'Joshua Tree National Park',
  'Mojave and Colorado desert ecosystems with iconic Joshua trees and boulder fields.',
  795156,
  '760-367-5500',
  'United States of America',
  'California',
  33.8734,
  -115.9010,
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=80'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.trails (id, park_id, trail_name, description, difficulty, length_miles, elevation_ft, duration, route_type, latitude, longitude, image_url) VALUES
-- Yosemite
('b0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000004', 'Half Dome Trail', 'Strenuous climb with cable section and panoramic valley views.', 'hard', 14.2, 4800, 'Est. 10h', 'Out & back', 37.7460, -119.5332, 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000004', 'Mist Trail to Vernal Fall', 'Classic waterfall hike on granite steps beside the Merced River.', 'moderate', 5.4, 2000, 'Est. 4h', 'Out & back', 37.7274, -119.5436, 'https://images.unsplash.com/photo-1518173946687-a4c036bc253c?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000004', 'Lower Yosemite Fall Trail', 'Easy paved walk to the base of North America''s tallest waterfall.', 'easy', 1.0, 50, 'Est. 30m', 'Loop', 37.7516, -119.5963, 'https://images.unsplash.com/photo-1474044159687-1ee9f3a51722?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000004', 'Four Mile Trail', 'Steep ascent from valley floor to Glacier Point.', 'hard', 4.8, 3200, 'Est. 4h', 'Out & back', 37.7317, -119.5738, 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&q=80'),
-- Golden Gate / Bay Area
('b0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000005', 'Matt Davis Trail', 'Coastal redwoods and ocean views on the way to Stinson Beach.', 'moderate', 7.2, 1600, 'Est. 3h 30m', 'Point to point', 37.8941, -122.5812, 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000005', 'Lands End Trail', 'Clifftop walk above the Pacific with Golden Gate views.', 'easy', 3.4, 500, 'Est. 1h 30m', 'Out & back', 37.7849, -122.5058, 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000016', 'a0000000-0000-4000-8000-000000000005', 'Muir Woods Main Trail', 'Paved loop among old-growth coast redwoods.', 'easy', 2.0, 100, 'Est. 1h', 'Loop', 37.8914, -122.5811, 'https://images.unsplash.com/photo-1448375248136-8827089dd12f?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000005', 'Mount Tamalpais East Peak', 'Bay Area classic with 360° views from the summit.', 'moderate', 4.5, 1100, 'Est. 2h 30m', 'Out & back', 37.9235, -122.5805, 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200&q=80'),
-- Rocky Mountain
('b0000000-0000-4000-8000-000000000018', 'a0000000-0000-4000-8000-000000000006', 'Emerald Lake Trail', 'Family-friendly alpine lakes beneath Tyndall Glacier.', 'easy', 3.6, 650, 'Est. 2h', 'Out & back', 40.3111, -105.6647, 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000019', 'a0000000-0000-4000-8000-000000000006', 'Sky Pond via Glacier Gorge', 'Iconic RMNP hike past Alberta Falls to an alpine tarn.', 'hard', 9.0, 1780, 'Est. 5h', 'Out & back', 40.2989, -105.6401, 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000006', 'Bear Lake Loop', 'Short accessible loop at 9,450 ft elevation.', 'easy', 0.8, 45, 'Est. 30m', 'Loop', 40.3128, -105.6482, 'https://images.unsplash.com/photo-1518173946687-a4c036bc253c?w=1200&q=80'),
-- Grand Canyon
('b0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000007', 'Bright Angel Trail', 'Classic rim-to-river route on the South Rim.', 'hard', 12.0, 4380, 'Est. 8h', 'Out & back', 36.0573, -112.1430, 'https://images.unsplash.com/photo-1474044159687-1ee9f3a51722?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000022', 'a0000000-0000-4000-8000-000000000007', 'South Kaibab to Ooh Aah Point', 'Dramatic canyon views with steep exposed ridgeline.', 'moderate', 1.8, 690, 'Est. 1h', 'Out & back', 36.0553, -112.0838, 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000023', 'a0000000-0000-4000-8000-000000000007', 'Rim Trail – Mather Point', 'Paved rim walk with expansive canyon vistas.', 'easy', 2.5, 200, 'Est. 1h 15m', 'Out & back', 36.0617, -112.1099, 'https://images.unsplash.com/photo-1448375248136-8827089dd12f?w=1200&q=80'),
-- Smokies
('b0000000-0000-4000-8000-000000000024', 'a0000000-0000-4000-8000-000000000008', 'Alum Cave Trail to Mount LeConte', 'Popular Smokies summit route with cliff alcove and lodge.', 'hard', 11.0, 2763, 'Est. 6h', 'Out & back', 35.6234, -83.4512, 'https://images.unsplash.com/photo-1448375248136-8827089dd12f?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000025', 'a0000000-0000-4000-8000-000000000008', 'Laurel Falls Trail', 'Paved waterfall hike suitable for families.', 'easy', 2.6, 314, 'Est. 1h 20m', 'Out & back', 35.6542, -83.6199, 'https://images.unsplash.com/photo-1518173946687-a4c036bc253c?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000026', 'a0000000-0000-4000-8000-000000000008', 'Charlies Bunion via Appalachian Trail', 'Exposed rock outcrop with panoramic mountain views.', 'hard', 8.0, 1640, 'Est. 4h 30m', 'Out & back', 35.6289, -83.4055, 'https://images.unsplash.com/photo-1474044159687-1ee9f3a51722?w=1200&q=80'),
-- Mount Rainier
('b0000000-0000-4000-8000-000000000027', 'a0000000-0000-4000-8000-000000000009', 'Skyline Trail Loop', 'Wildflower meadows and glacier views from Paradise.', 'moderate', 5.5, 1450, 'Est. 3h', 'Loop', 46.7867, -121.7354, 'https://images.unsplash.com/photo-1518173946687-a4c036bc253c?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000028', 'a0000000-0000-4000-8000-000000000009', 'Grove of the Patriarchs', 'Short walk to ancient hemlocks on an island in the Ohanapecosh.', 'easy', 1.5, 50, 'Est. 45m', 'Loop', 46.7551, -121.5555, 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000029', 'a0000000-0000-4000-8000-000000000009', 'Mount Fremont Lookout', 'Fire lookout with Rainier backdrop.', 'moderate', 5.6, 900, 'Est. 2h 30m', 'Out & back', 46.9153, -121.6432, 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200&q=80'),
-- Joshua Tree
('b0000000-0000-4000-8000-000000000030', 'a0000000-0000-4000-8000-000000000010', 'Ryan Mountain Trail', '360° desert views from the park''s most popular summit.', 'moderate', 3.0, 1050, 'Est. 2h', 'Out & back', 33.9873, -116.1348, 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=80'),
('b0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000010', 'Hidden Valley Nature Trail', 'Easy loop through iconic boulder formations.', 'easy', 1.0, 100, 'Est. 30m', 'Loop', 34.0122, -116.1686, 'https://images.unsplash.com/photo-1474044159687-1ee9f3a51722?w=1200&q=80')
ON CONFLICT (id) DO NOTHING;
-- Trail Platform Phase 1: provenance, geometry, POIs, deduplication, spatial RPCs

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.confidence_level AS ENUM (
    'verified', 'source_reported', 'inferred', 'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.merge_candidate_status AS ENUM (
    'pending', 'approved', 'rejected', 'merged'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.import_status AS ENUM (
    'pending', 'running', 'completed', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Data sources (provenance)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL,
  source_url TEXT,
  license TEXT NOT NULL,
  license_url TEXT,
  attribution TEXT NOT NULL,
  import_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  version TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_sources_name_idx ON public.data_sources (source_name);

-- ---------------------------------------------------------------------------
-- Canonical trails (deduplication target)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.canonical_trails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_name TEXT NOT NULL,
  description TEXT,
  difficulty TEXT CHECK (difficulty IN ('easy', 'moderate', 'hard')),
  length_miles DOUBLE PRECISION,
  elevation_gain_ft INTEGER,
  elevation_loss_ft INTEGER,
  highest_point_ft INTEGER,
  lowest_point_ft INTEGER,
  trail_type TEXT,
  surface TEXT,
  allows_hiking BOOLEAN NOT NULL DEFAULT true,
  allows_backpacking BOOLEAN NOT NULL DEFAULT true,
  allows_biking BOOLEAN NOT NULL DEFAULT false,
  allows_horseback BOOLEAN NOT NULL DEFAULT false,
  allows_dogs BOOLEAN,
  seasonal_information TEXT,
  official_source TEXT,
  confidence_score public.confidence_level NOT NULL DEFAULT 'unknown',
  geometry GEOGRAPHY(LINESTRING, 4326),
  start_latitude DOUBLE PRECISION,
  start_longitude DOUBLE PRECISION,
  end_latitude DOUBLE PRECISION,
  end_longitude DOUBLE PRECISION,
  merged_trail_id UUID REFERENCES public.trails(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canonical_trails_geometry_idx
  ON public.canonical_trails USING GIST (geometry);
CREATE INDEX IF NOT EXISTS canonical_trails_name_idx
  ON public.canonical_trails USING gin (to_tsvector('english', trail_name));

-- ---------------------------------------------------------------------------
-- Extend existing trails table
-- ---------------------------------------------------------------------------
ALTER TABLE public.trails
  ADD COLUMN IF NOT EXISTS canonical_trail_id UUID REFERENCES public.canonical_trails(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS data_source_id UUID REFERENCES public.data_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS geometry GEOGRAPHY(LINESTRING, 4326),
  ADD COLUMN IF NOT EXISTS start_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS start_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS end_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS end_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS elevation_loss_ft INTEGER,
  ADD COLUMN IF NOT EXISTS highest_point_ft INTEGER,
  ADD COLUMN IF NOT EXISTS lowest_point_ft INTEGER,
  ADD COLUMN IF NOT EXISTS trail_type TEXT,
  ADD COLUMN IF NOT EXISTS surface TEXT,
  ADD COLUMN IF NOT EXISTS allows_hiking BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allows_backpacking BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allows_biking BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allows_horseback BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allows_dogs BOOLEAN,
  ADD COLUMN IF NOT EXISTS seasonal_information TEXT,
  ADD COLUMN IF NOT EXISTS official_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence_score public.confidence_level NOT NULL DEFAULT 'source_reported',
  ADD COLUMN IF NOT EXISTS source_external_id TEXT,
  ADD COLUMN IF NOT EXISTS elevation_profile JSONB;

CREATE INDEX IF NOT EXISTS trails_geometry_idx ON public.trails USING GIST (geometry);
CREATE INDEX IF NOT EXISTS trails_canonical_trail_id_idx ON public.trails (canonical_trail_id);
CREATE INDEX IF NOT EXISTS trails_data_source_id_idx ON public.trails (data_source_id);
CREATE INDEX IF NOT EXISTS trails_allows_dogs_idx ON public.trails (allows_dogs) WHERE allows_dogs IS NOT NULL;
CREATE INDEX IF NOT EXISTS trails_length_miles_idx ON public.trails (length_miles);
CREATE INDEX IF NOT EXISTS trails_elevation_ft_idx ON public.trails (elevation_ft);

-- ---------------------------------------------------------------------------
-- Source trail records (raw imports linked to canonical)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trail_source_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_trail_id UUID REFERENCES public.canonical_trails(id) ON DELETE SET NULL,
  trail_id UUID REFERENCES public.trails(id) ON DELETE SET NULL,
  data_source_id UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
  external_id TEXT,
  raw_name TEXT NOT NULL,
  raw_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_geometry GEOGRAPHY(GEOMETRY, 4326),
  confidence_score public.confidence_level NOT NULL DEFAULT 'source_reported',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trail_source_records_canonical_idx
  ON public.trail_source_records (canonical_trail_id);
CREATE INDEX IF NOT EXISTS trail_source_records_source_idx
  ON public.trail_source_records (data_source_id);
CREATE INDEX IF NOT EXISTS trail_source_records_geometry_idx
  ON public.trail_source_records USING GIST (raw_geometry);

-- ---------------------------------------------------------------------------
-- Merge candidates (manual review — never auto-merge)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merge_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_a_id UUID NOT NULL REFERENCES public.trails(id) ON DELETE CASCADE,
  trail_b_id UUID NOT NULL REFERENCES public.trails(id) ON DELETE CASCADE,
  canonical_trail_id UUID REFERENCES public.canonical_trails(id) ON DELETE SET NULL,
  overlap_score DOUBLE PRECISION NOT NULL,
  name_similarity DOUBLE PRECISION NOT NULL,
  distance_delta_miles DOUBLE PRECISION,
  status public.merge_candidate_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (trail_a_id <> trail_b_id)
);

CREATE INDEX IF NOT EXISTS merge_candidates_status_idx ON public.merge_candidates (status);

-- ---------------------------------------------------------------------------
-- Trail segments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trail_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_id UUID NOT NULL REFERENCES public.trails(id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL,
  name TEXT,
  description TEXT,
  length_miles DOUBLE PRECISION,
  elevation_gain_ft INTEGER,
  geometry GEOGRAPHY(LINESTRING, 4326),
  confidence_score public.confidence_level NOT NULL DEFAULT 'source_reported',
  data_source_id UUID REFERENCES public.data_sources(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trail_id, segment_index)
);

CREATE INDEX IF NOT EXISTS trail_segments_trail_id_idx ON public.trail_segments (trail_id);
CREATE INDEX IF NOT EXISTS trail_segments_geometry_idx ON public.trail_segments USING GIST (geometry);

-- ---------------------------------------------------------------------------
-- Trailheads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trailheads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_id UUID REFERENCES public.trails(id) ON DELETE SET NULL,
  park_id UUID REFERENCES public.parks(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  location GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  ) STORED,
  parking_info TEXT,
  fees TEXT,
  access_notes TEXT,
  restrooms BOOLEAN,
  accessibility_notes TEXT,
  data_source_id UUID REFERENCES public.data_sources(id) ON DELETE SET NULL,
  confidence_score public.confidence_level NOT NULL DEFAULT 'source_reported',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trailheads_location_idx ON public.trailheads USING GIST (location);
CREATE INDEX IF NOT EXISTS trailheads_trail_id_idx ON public.trailheads (trail_id);

-- ---------------------------------------------------------------------------
-- Campsites, water sources, viewpoints
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campsites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_id UUID REFERENCES public.trails(id) ON DELETE SET NULL,
  name TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  location GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  ) STORED,
  campsite_type TEXT,
  capacity INTEGER,
  amenities JSONB NOT NULL DEFAULT '{}'::jsonb,
  seasonal_information TEXT,
  data_source_id UUID REFERENCES public.data_sources(id) ON DELETE SET NULL,
  confidence_score public.confidence_level NOT NULL DEFAULT 'source_reported',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campsites_location_idx ON public.campsites USING GIST (location);
CREATE INDEX IF NOT EXISTS campsites_trail_id_idx ON public.campsites (trail_id);

CREATE TABLE IF NOT EXISTS public.water_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_id UUID REFERENCES public.trails(id) ON DELETE SET NULL,
  name TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  location GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  ) STORED,
  water_type TEXT,
  seasonal_information TEXT,
  treatment_required BOOLEAN,
  data_source_id UUID REFERENCES public.data_sources(id) ON DELETE SET NULL,
  confidence_score public.confidence_level NOT NULL DEFAULT 'source_reported',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS water_sources_location_idx ON public.water_sources USING GIST (location);
CREATE INDEX IF NOT EXISTS water_sources_trail_id_idx ON public.water_sources (trail_id);

CREATE TABLE IF NOT EXISTS public.viewpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_id UUID REFERENCES public.trails(id) ON DELETE SET NULL,
  name TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  location GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  ) STORED,
  description TEXT,
  elevation_ft INTEGER,
  data_source_id UUID REFERENCES public.data_sources(id) ON DELETE SET NULL,
  confidence_score public.confidence_level NOT NULL DEFAULT 'source_reported',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS viewpoints_location_idx ON public.viewpoints USING GIST (location);
CREATE INDEX IF NOT EXISTS viewpoints_trail_id_idx ON public.viewpoints (trail_id);

-- ---------------------------------------------------------------------------
-- Protected areas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.protected_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  area_type TEXT NOT NULL,
  boundary GEOGRAPHY(MULTIPOLYGON, 4326),
  description TEXT,
  managing_agency TEXT,
  data_source_id UUID REFERENCES public.data_sources(id) ON DELETE SET NULL,
  confidence_score public.confidence_level NOT NULL DEFAULT 'source_reported',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS protected_areas_boundary_idx
  ON public.protected_areas USING GIST (boundary);
CREATE INDEX IF NOT EXISTS protected_areas_name_idx
  ON public.protected_areas USING gin (to_tsvector('english', name));

-- ---------------------------------------------------------------------------
-- Restrictions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.restrictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_id UUID REFERENCES public.trails(id) ON DELETE CASCADE,
  protected_area_id UUID REFERENCES public.protected_areas(id) ON DELETE CASCADE,
  restriction_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  effective_start DATE,
  effective_end DATE,
  permit_required BOOLEAN NOT NULL DEFAULT false,
  permit_url TEXT,
  data_source_id UUID REFERENCES public.data_sources(id) ON DELETE SET NULL,
  confidence_score public.confidence_level NOT NULL DEFAULT 'source_reported',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS restrictions_trail_id_idx ON public.restrictions (trail_id);
CREATE INDEX IF NOT EXISTS restrictions_area_id_idx ON public.restrictions (protected_area_id);

-- ---------------------------------------------------------------------------
-- Trail photos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trail_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_id UUID NOT NULL REFERENCES public.trails(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  caption TEXT,
  photographer TEXT,
  license TEXT NOT NULL,
  license_url TEXT,
  attribution TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  external_id TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
    CASE
      WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN
        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
      ELSE NULL
    END
  ) STORED,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_hero BOOLEAN NOT NULL DEFAULT false,
  is_disabled BOOLEAN NOT NULL DEFAULT false,
  disabled_reason TEXT,
  data_source_id UUID REFERENCES public.data_sources(id) ON DELETE SET NULL,
  confidence_score public.confidence_level NOT NULL DEFAULT 'source_reported',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trail_photos_trail_id_idx ON public.trail_photos (trail_id);
CREATE INDEX IF NOT EXISTS trail_photos_location_idx ON public.trail_photos USING GIST (location);

-- ---------------------------------------------------------------------------
-- Import logs (admin)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id UUID REFERENCES public.data_sources(id) ON DELETE SET NULL,
  adapter_name TEXT NOT NULL,
  status public.import_status NOT NULL DEFAULT 'pending',
  records_processed INTEGER NOT NULL DEFAULT 0,
  records_stored INTEGER NOT NULL DEFAULT 0,
  records_failed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS import_logs_status_idx ON public.import_logs (status);
CREATE INDEX IF NOT EXISTS import_logs_started_at_idx ON public.import_logs (started_at DESC);

-- ---------------------------------------------------------------------------
-- Helpers: GeoJSON <-> geography
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.geojson_to_geography_line(geojson JSONB)
RETURNS GEOGRAPHY
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ST_GeogFromText(ST_AsText(ST_GeomFromGeoJSON(geojson::text)))::geography;
$$;

CREATE OR REPLACE FUNCTION public.geography_to_geojson(geom GEOGRAPHY)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT ST_AsGeoJSON(geom::geometry)::jsonb;
$$;

-- ---------------------------------------------------------------------------
-- Spatial RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nearby_trails(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radius_m DOUBLE PRECISION DEFAULT 50000,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  park_id UUID,
  trail_name TEXT,
  description TEXT,
  difficulty TEXT,
  length_miles DOUBLE PRECISION,
  elevation_ft INTEGER,
  duration TEXT,
  route_type TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  image_url TEXT,
  avg_rating NUMERIC,
  review_count INTEGER,
  geometry JSONB,
  allows_dogs BOOLEAN,
  confidence_score public.confidence_level,
  distance_m DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.park_id,
    t.trail_name,
    t.description,
    t.difficulty,
    t.length_miles,
    t.elevation_ft,
    t.duration,
    t.route_type,
    t.latitude,
    t.longitude,
    t.image_url,
    t.avg_rating,
    t.review_count,
    public.geography_to_geojson(t.geometry) AS geometry,
    t.allows_dogs,
    t.confidence_score,
    ST_Distance(
      t.location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    ) AS distance_m
  FROM public.trails t
  WHERE ST_DWithin(
    t.location,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    p_radius_m
  )
  ORDER BY distance_m
  LIMIT GREATEST(p_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.trails_in_bbox(
  p_min_lng DOUBLE PRECISION,
  p_min_lat DOUBLE PRECISION,
  p_max_lng DOUBLE PRECISION,
  p_max_lat DOUBLE PRECISION,
  p_limit INTEGER DEFAULT 200
)
RETURNS TABLE (
  id UUID,
  trail_name TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  geometry JSONB,
  difficulty TEXT,
  length_miles DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.trail_name,
    t.latitude,
    t.longitude,
    public.geography_to_geojson(t.geometry) AS geometry,
    t.difficulty,
    t.length_miles
  FROM public.trails t
  WHERE t.location && ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography
  LIMIT GREATEST(p_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.search_trails_filtered(
  p_query TEXT DEFAULT NULL,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_radius_m DOUBLE PRECISION DEFAULT NULL,
  p_difficulty TEXT DEFAULT NULL,
  p_min_length_miles DOUBLE PRECISION DEFAULT NULL,
  p_max_length_miles DOUBLE PRECISION DEFAULT NULL,
  p_min_elevation_ft INTEGER DEFAULT NULL,
  p_max_elevation_ft INTEGER DEFAULT NULL,
  p_dog_friendly BOOLEAN DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  park_id UUID,
  trail_name TEXT,
  description TEXT,
  difficulty TEXT,
  length_miles DOUBLE PRECISION,
  elevation_ft INTEGER,
  duration TEXT,
  route_type TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  image_url TEXT,
  avg_rating NUMERIC,
  review_count INTEGER,
  geometry JSONB,
  allows_dogs BOOLEAN,
  confidence_score public.confidence_level,
  park_name TEXT,
  park_state TEXT,
  distance_m DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.park_id,
    t.trail_name,
    t.description,
    t.difficulty,
    t.length_miles,
    t.elevation_ft,
    t.duration,
    t.route_type,
    t.latitude,
    t.longitude,
    t.image_url,
    t.avg_rating,
    t.review_count,
    public.geography_to_geojson(t.geometry) AS geometry,
    t.allows_dogs,
    t.confidence_score,
    p.park_name,
    p.state AS park_state,
    CASE
      WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
        ST_Distance(t.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography)
      ELSE NULL
    END AS distance_m
  FROM public.trails t
  JOIN public.parks p ON p.id = t.park_id
  WHERE
    (p_query IS NULL OR p_query = '' OR t.trail_name ILIKE '%' || p_query || '%'
      OR t.description ILIKE '%' || p_query || '%'
      OR p.park_name ILIKE '%' || p_query || '%')
    AND (p_difficulty IS NULL OR t.difficulty = p_difficulty)
    AND (p_min_length_miles IS NULL OR t.length_miles >= p_min_length_miles)
    AND (p_max_length_miles IS NULL OR t.length_miles <= p_max_length_miles)
    AND (p_min_elevation_ft IS NULL OR t.elevation_ft >= p_min_elevation_ft)
    AND (p_max_elevation_ft IS NULL OR t.elevation_ft <= p_max_elevation_ft)
    AND (p_dog_friendly IS NULL OR t.allows_dogs IS NOT DISTINCT FROM p_dog_friendly)
    AND (
      p_lat IS NULL OR p_lng IS NULL OR p_radius_m IS NULL OR
      ST_DWithin(
        t.location,
        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
        p_radius_m
      )
    )
  ORDER BY
    CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN distance_m END NULLS LAST,
    t.trail_name
  LIMIT GREATEST(p_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.trail_elevation_profile(p_trail_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    t.elevation_profile,
    CASE
      WHEN t.geometry IS NOT NULL THEN
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'distance_m', dist,
              'elevation_m', ST_Z(pt::geometry)
            )
            ORDER BY dist
          )
          FROM (
            SELECT
              ST_LineLocatePoint(t.geometry::geometry, dp.geom) *
                ST_Length(t.geometry::geography) AS dist,
              dp.geom AS pt
            FROM ST_DumpPoints(t.geometry::geometry) dp
          ) pts
          WHERE ST_Z(pt::geometry) IS NOT NULL
        )
      ELSE NULL
    END
  )
  FROM public.trails t
  WHERE t.id = p_trail_id;
$$;

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------
ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_trails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trail_source_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merge_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trail_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trailheads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campsites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.viewpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protected_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trail_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.data_sources TO anon, authenticated;
GRANT SELECT ON public.canonical_trails TO anon, authenticated;
GRANT SELECT ON public.trail_source_records TO anon, authenticated;
GRANT SELECT ON public.merge_candidates TO anon, authenticated;
GRANT SELECT ON public.trail_segments TO anon, authenticated;
GRANT SELECT ON public.trailheads TO anon, authenticated;
GRANT SELECT ON public.campsites TO anon, authenticated;
GRANT SELECT ON public.water_sources TO anon, authenticated;
GRANT SELECT ON public.viewpoints TO anon, authenticated;
GRANT SELECT ON public.protected_areas TO anon, authenticated;
GRANT SELECT ON public.restrictions TO anon, authenticated;
GRANT SELECT ON public.trail_photos TO anon, authenticated;
GRANT SELECT ON public.import_logs TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.nearby_trails TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trails_in_bbox TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_trails_filtered TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_trail_detail(p_trail_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'geometry', public.geography_to_geojson(t.geometry),
    'elevation_profile', t.elevation_profile,
    'start_latitude', t.start_latitude,
    'start_longitude', t.start_longitude,
    'end_latitude', t.end_latitude,
    'end_longitude', t.end_longitude,
    'elevation_loss_ft', t.elevation_loss_ft,
    'highest_point_ft', t.highest_point_ft,
    'lowest_point_ft', t.lowest_point_ft,
    'trail_type', t.trail_type,
    'surface', t.surface,
    'allows_hiking', t.allows_hiking,
    'allows_backpacking', t.allows_backpacking,
    'allows_biking', t.allows_biking,
    'allows_horseback', t.allows_horseback,
    'allows_dogs', t.allows_dogs,
    'seasonal_information', t.seasonal_information,
    'official_source', t.official_source,
    'confidence_score', t.confidence_score
  )
  FROM public.trails t
  WHERE t.id = p_trail_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_trail_detail TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.geography_to_geojson TO anon, authenticated;

DO $$ BEGIN
  CREATE POLICY "Data sources viewable" ON public.data_sources FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Canonical trails viewable" ON public.canonical_trails FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Trail source records viewable" ON public.trail_source_records FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Merge candidates viewable" ON public.merge_candidates FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Trail segments viewable" ON public.trail_segments FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Trailheads viewable" ON public.trailheads FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Campsites viewable" ON public.campsites FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Water sources viewable" ON public.water_sources FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Viewpoints viewable" ON public.viewpoints FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Protected areas viewable" ON public.protected_areas FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Restrictions viewable" ON public.restrictions FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Trail photos viewable" ON public.trail_photos FOR SELECT TO anon, authenticated USING (is_disabled = false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Import logs viewable" ON public.import_logs FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Sample trail geometries for Phase 1 demo (simplified polylines near trailhead points)
-- License: synthetic demo data for development only

INSERT INTO public.data_sources (id, source_name, source_url, license, license_url, attribution, version)
VALUES (
  'c0000000-0000-4000-8000-000000000001',
  'Outdoor OS Demo Geometries',
  NULL,
  'Public Domain',
  NULL,
  'Synthetic demo polylines for local development',
  '2025-08-29'
)
ON CONFLICT (id) DO NOTHING;

-- Angels Landing (Zion) — simplified out-and-back
UPDATE public.trails SET
  data_source_id = 'c0000000-0000-4000-8000-000000000001',
  start_latitude = 37.2695,
  start_longitude = -112.9478,
  end_latitude = 37.2697,
  end_longitude = -112.9407,
  allows_dogs = false,
  confidence_score = 'inferred',
  geometry = ST_GeogFromText(
    'LINESTRING(-112.9478 37.2695, -112.9450 37.2680, -112.9425 37.2670, -112.9407 37.2697, -112.9425 37.2670, -112.9450 37.2680, -112.9478 37.2695)'
  ),
  elevation_profile = '[
    {"distance_m": 0, "elevation_m": 1480},
    {"distance_m": 800, "elevation_m": 1550},
    {"distance_m": 1600, "elevation_m": 1680},
    {"distance_m": 3200, "elevation_m": 1760},
    {"distance_m": 4800, "elevation_m": 1760},
    {"distance_m": 6400, "elevation_m": 1680},
    {"distance_m": 7000, "elevation_m": 1480}
  ]'::jsonb
WHERE id = 'b0000000-0000-4000-8000-000000000001';

-- Half Dome (Yosemite)
UPDATE public.trails SET
  data_source_id = 'c0000000-0000-4000-8000-000000000001',
  start_latitude = 37.7460,
  start_longitude = -119.5930,
  end_latitude = 37.7459,
  end_longitude = -119.5332,
  allows_dogs = false,
  confidence_score = 'inferred',
  geometry = ST_GeogFromText(
    'LINESTRING(-119.5930 37.7460, -119.5750 37.7450, -119.5550 37.7445, -119.5400 37.7455, -119.5332 37.7459, -119.5400 37.7455, -119.5550 37.7445, -119.5750 37.7450, -119.5930 37.7460)'
  ),
  elevation_profile = '[
    {"distance_m": 0, "elevation_m": 1200},
    {"distance_m": 3000, "elevation_m": 1800},
    {"distance_m": 6000, "elevation_m": 2400},
    {"distance_m": 9000, "elevation_m": 2600},
    {"distance_m": 12000, "elevation_m": 2700},
    {"distance_m": 15000, "elevation_m": 2600},
    {"distance_m": 18000, "elevation_m": 2400},
    {"distance_m": 22000, "elevation_m": 1200}
  ]'::jsonb
WHERE id = 'b0000000-0000-4000-8000-000000000010';

-- Lands End (Golden Gate)
UPDATE public.trails SET
  data_source_id = 'c0000000-0000-4000-8000-000000000001',
  start_latitude = 37.7849,
  start_longitude = -122.5058,
  end_latitude = 37.7875,
  end_longitude = -122.5105,
  allows_dogs = true,
  confidence_score = 'inferred',
  geometry = ST_GeogFromText(
    'LINESTRING(-122.5058 37.7849, -122.5075 37.7858, -122.5090 37.7868, -122.5105 37.7875, -122.5090 37.7868, -122.5075 37.7858, -122.5058 37.7849)'
  ),
  elevation_profile = '[
    {"distance_m": 0, "elevation_m": 30},
    {"distance_m": 800, "elevation_m": 45},
    {"distance_m": 1600, "elevation_m": 60},
    {"distance_m": 2400, "elevation_m": 55},
    {"distance_m": 3200, "elevation_m": 35},
    {"distance_m": 4000, "elevation_m": 30}
  ]'::jsonb
WHERE id = 'b0000000-0000-4000-8000-000000000015';

-- Emerald Lake (Rocky Mountain)
UPDATE public.trails SET
  data_source_id = 'c0000000-0000-4000-8000-000000000001',
  start_latitude = 40.3111,
  start_longitude = -105.6647,
  end_latitude = 40.3125,
  end_longitude = -105.6550,
  allows_dogs = false,
  confidence_score = 'inferred',
  geometry = ST_GeogFromText(
    'LINESTRING(-105.6647 40.3111, -105.6620 40.3118, -105.6585 40.3122, -105.6550 40.3125, -105.6585 40.3122, -105.6620 40.3118, -105.6647 40.3111)'
  ),
  elevation_profile = '[
    {"distance_m": 0, "elevation_m": 2880},
    {"distance_m": 1000, "elevation_m": 2920},
    {"distance_m": 2000, "elevation_m": 2960},
    {"distance_m": 3000, "elevation_m": 2980},
    {"distance_m": 4000, "elevation_m": 2960},
    {"distance_m": 5000, "elevation_m": 2880}
  ]'::jsonb
WHERE id = 'b0000000-0000-4000-8000-000000000018';

-- Sample trailhead
INSERT INTO public.trailheads (trail_id, name, latitude, longitude, parking_info, fees, access_notes, restrooms, data_source_id, confidence_score)
SELECT
  'b0000000-0000-4000-8000-000000000010',
  'Happy Isles Trailhead',
  37.7317,
  -119.5583,
  'Limited parking; arrive early or use shuttle.',
  'Park entrance fee required.',
  'Shuttle service typically required during peak season.',
  true,
  'c0000000-0000-4000-8000-000000000001',
  'source_reported'
WHERE EXISTS (SELECT 1 FROM public.trails WHERE id = 'b0000000-0000-4000-8000-000000000010');


-- ===========================================================================
-- Accounts: cloud user data (supabase/migrations/20261021000001_cloud_user_data.sql)
-- ===========================================================================
-- Everything a person creates lives in their account, not on the device: gear, planner preferences, trips,
-- saved routes, personal trails (route builder), recorded activities and Eco AI chat history.
-- Every table is owner-only through row-level security; a personal trail is readable by others only through
-- get_shared_personal_trail(token) once its owner turns sharing on. Safe to run more than once.

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Gear (created by 20260920080206 / 20260922060942; repeated here so this file also works on its own)
CREATE TABLE IF NOT EXISTS public.gear_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL,
  type text NOT NULL DEFAULT 'Base',
  qty integer NOT NULL DEFAULT 1,
  weight numeric NOT NULL DEFAULT 0,
  price numeric NOT NULL DEFAULT 0,
  link text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gear_items ADD COLUMN IF NOT EXISTS product_details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.gear_items ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.gear_items ALTER COLUMN user_id SET DEFAULT auth.uid();
CREATE INDEX IF NOT EXISTS gear_items_user_id_idx ON public.gear_items (user_id);
ALTER TABLE public.gear_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gear_items_own" ON public.gear_items;
CREATE POLICY "gear_items_own" ON public.gear_items FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gear_items TO authenticated;
DROP TRIGGER IF EXISTS gear_items_touch ON public.gear_items;
CREATE TRIGGER gear_items_touch BEFORE UPDATE ON public.gear_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Trip-planner preferences (miles per day, comfortable pack weight, pack size, experience, priorities)
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  planner_profile jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(planner_profile) = 'object' AND octet_length(planner_profile::text) <= 8000),
  pack_units text NOT NULL DEFAULT 'imperial' CHECK (pack_units IN ('imperial', 'metric')),
  local_data_migrated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_preferences_own" ON public.user_preferences;
CREATE POLICY "user_preferences_own" ON public.user_preferences FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO authenticated;
DROP TRIGGER IF EXISTS user_preferences_touch ON public.user_preferences;
CREATE TRIGGER user_preferences_touch BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Saved planner trips: request, chosen route, pack, shopping list, packed items and completed-trip feedback
CREATE TABLE IF NOT EXISTS public.trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id text NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 160),
  name text NOT NULL DEFAULT '',
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <= 400000),
  personal_trail_id uuid,
  saved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS trips_user_saved_idx ON public.trips (user_id, saved_at DESC);
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trips_own" ON public.trips;
CREATE POLICY "trips_own" ON public.trips FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trips TO authenticated;
DROP TRIGGER IF EXISTS trips_touch ON public.trips;
CREATE TRIGGER trips_touch BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Point-to-point routes joined from mapped trails on the map
CREATE TABLE IF NOT EXISTS public.saved_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Saved route' CHECK (char_length(name) <= 200),
  meters numeric NOT NULL DEFAULT 0 CHECK (meters >= 0),
  geometry jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (octet_length(geometry::text) <= 2000000),
  trail_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_routes_user_idx ON public.saved_routes (user_id, created_at DESC);
ALTER TABLE public.saved_routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "saved_routes_own" ON public.saved_routes;
CREATE POLICY "saved_routes_own" ON public.saved_routes FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_routes TO authenticated;
DROP TRIGGER IF EXISTS saved_routes_touch ON public.saved_routes;
CREATE TRIGGER saved_routes_touch BEFORE UPDATE ON public.saved_routes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Personal trails: routes built along real trails and saved with name, notes, photo, stats and features
CREATE TABLE IF NOT EXISTS public.personal_trails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 10000),
  photo_path text,
  geometry jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(geometry) = 'array' AND octet_length(geometry::text) <= 3000000),
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  trails jsonb NOT NULL DEFAULT '[]'::jsonb,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  days jsonb,
  waypoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_public boolean NOT NULL DEFAULT false,
  share_token text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS personal_trails_user_idx ON public.personal_trails (user_id, updated_at DESC);
ALTER TABLE public.personal_trails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "personal_trails_own" ON public.personal_trails;
CREATE POLICY "personal_trails_own" ON public.personal_trails FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_trails TO authenticated;
DROP TRIGGER IF EXISTS personal_trails_touch ON public.personal_trails;
CREATE TRIGGER personal_trails_touch BEFORE UPDATE ON public.personal_trails FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$ BEGIN
  ALTER TABLE public.trips ADD CONSTRAINT trips_personal_trail_fk FOREIGN KEY (personal_trail_id) REFERENCES public.personal_trails(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sharing turns on a random, unguessable token; turning it off removes the token so old links stop working.
CREATE OR REPLACE FUNCTION public.personal_trail_share_token()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_public AND NEW.share_token IS NULL THEN
    NEW.share_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  ELSIF NOT NEW.is_public THEN
    NEW.share_token = NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS personal_trails_share ON public.personal_trails;
CREATE TRIGGER personal_trails_share BEFORE INSERT OR UPDATE OF is_public ON public.personal_trails FOR EACH ROW EXECUTE FUNCTION public.personal_trail_share_token();

-- A shared trail by its token: the only way anyone but the owner can read a personal trail (no owner id returned).
CREATE OR REPLACE FUNCTION public.get_shared_personal_trail(token text)
RETURNS TABLE (id uuid, name text, notes text, photo_path text, geometry jsonb, stats jsonb, trails jsonb, features jsonb, days jsonb, waypoints jsonb, is_public boolean, share_token text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.notes, p.photo_path, p.geometry, p.stats, p.trails, p.features, p.days, p.waypoints, p.is_public, p.share_token, p.created_at, p.updated_at
  FROM public.personal_trails p
  WHERE p.is_public AND p.share_token IS NOT NULL AND p.share_token = token
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_shared_personal_trail(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_shared_personal_trail(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_shared_trail_photo(path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.personal_trails p WHERE p.photo_path = path AND p.is_public AND p.share_token IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.is_shared_trail_photo(text) FROM public;
GRANT EXECUTE ON FUNCTION public.is_shared_trail_photo(text) TO anon, authenticated;

-- Eco AI chat history
CREATE TABLE IF NOT EXISTS public.ai_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (char_length(content) <= 20000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_chat_messages_user_idx ON public.ai_chat_messages (user_id, created_at DESC);
ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_chat_messages_own" ON public.ai_chat_messages;
CREATE POLICY "ai_chat_messages_own" ON public.ai_chat_messages FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
GRANT SELECT, INSERT, DELETE ON public.ai_chat_messages TO authenticated;

-- Recorded activities already exist (20250623000001) with owner-only policies; let inserts default the owner.
ALTER TABLE IF EXISTS public.activities ALTER COLUMN user_id SET DEFAULT auth.uid();

-- Photos for personal trails: private bucket, one folder per user (<user id>/<file>), readable by others only
-- while the trail that uses the photo is shared.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('trail-photos', 'trail-photos', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "trail_photos_owner_read" ON storage.objects;
CREATE POLICY "trail_photos_owner_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'trail-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS "trail_photos_owner_write" ON storage.objects;
CREATE POLICY "trail_photos_owner_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'trail-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS "trail_photos_owner_update" ON storage.objects;
CREATE POLICY "trail_photos_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'trail-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS "trail_photos_owner_delete" ON storage.objects;
CREATE POLICY "trail_photos_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'trail-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS "trail_photos_shared_read" ON storage.objects;
CREATE POLICY "trail_photos_shared_read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'trail-photos' AND public.is_shared_trail_photo(name));
