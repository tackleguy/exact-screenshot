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
