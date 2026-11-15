GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_trails TO authenticated;
GRANT ALL ON public.user_trails TO service_role;
CREATE TABLE public.saved_routes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL DEFAULT auth.uid(),
 name text NOT NULL DEFAULT 'Saved route',
 meters numeric NOT NULL DEFAULT 0,
 geometry jsonb NOT NULL DEFAULT '[]'::jsonb,
 trail_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_routes TO authenticated;
GRANT ALL ON public.saved_routes TO service_role;
ALTER TABLE public.saved_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY saved_routes_own ON public.saved_routes FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE INDEX saved_routes_user_idx ON public.saved_routes(user_id, created_at DESC);
CREATE TABLE public.personal_trails (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL DEFAULT auth.uid(),
 name text NOT NULL,
 notes text NOT NULL DEFAULT '',
 photo_path text,
 geometry jsonb NOT NULL DEFAULT '[]'::jsonb,
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_trails TO authenticated;
GRANT ALL ON public.personal_trails TO service_role;
ALTER TABLE public.personal_trails ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_trails_own ON public.personal_trails FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE INDEX personal_trails_user_idx ON public.personal_trails(user_id, updated_at DESC);
CREATE OR REPLACE FUNCTION public.update_trail_timestamp() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER personal_trails_touch BEFORE UPDATE ON public.personal_trails FOR EACH ROW EXECUTE FUNCTION public.update_trail_timestamp();
CREATE TRIGGER saved_routes_touch BEFORE UPDATE ON public.saved_routes FOR EACH ROW EXECUTE FUNCTION public.update_trail_timestamp();
CREATE OR REPLACE FUNCTION public.personal_trail_share_token() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ BEGIN IF NEW.is_public THEN IF TG_OP = 'INSERT' OR NOT OLD.is_public THEN NEW.share_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); ELSE NEW.share_token = OLD.share_token; END IF; ELSE NEW.share_token = NULL; END IF; RETURN NEW; END; $$;
CREATE TRIGGER personal_trails_share BEFORE INSERT OR UPDATE ON public.personal_trails FOR EACH ROW EXECUTE FUNCTION public.personal_trail_share_token();
CREATE OR REPLACE FUNCTION public.get_shared_personal_trail(token text) RETURNS TABLE (id uuid, name text, notes text, photo_path text, geometry jsonb, stats jsonb, trails jsonb, features jsonb, days jsonb, waypoints jsonb, is_public boolean, share_token text, created_at timestamptz, updated_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT p.id,p.name,p.notes,p.photo_path,p.geometry,p.stats,p.trails,p.features,p.days,p.waypoints,p.is_public,p.share_token,p.created_at,p.updated_at FROM public.personal_trails p WHERE p.is_public AND p.share_token IS NOT NULL AND p.share_token = token LIMIT 1; $$;
REVOKE ALL ON FUNCTION public.get_shared_personal_trail(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_shared_personal_trail(text) TO anon, authenticated;