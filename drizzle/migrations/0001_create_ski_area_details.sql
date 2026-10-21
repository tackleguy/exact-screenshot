CREATE TABLE public.ski_area_details (
  slug text PRIMARY KEY REFERENCES public.ski_areas(slug) ON DELETE CASCADE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ski_area_details TO anon;
GRANT SELECT ON public.ski_area_details TO authenticated;
GRANT ALL ON public.ski_area_details TO service_role;
ALTER TABLE public.ski_area_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY ski_area_details_public_read ON public.ski_area_details FOR SELECT TO anon, authenticated USING (true);