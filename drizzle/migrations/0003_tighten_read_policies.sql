DROP POLICY cmt_read ON public.comments;
CREATE POLICY cmt_read ON public.comments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY cp_read ON public.community_posts;
CREATE POLICY cp_read ON public.community_posts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY ski_areas_public_read ON public.ski_areas;
CREATE POLICY ski_areas_read ON public.ski_areas
  FOR SELECT TO authenticated
  USING (true);
REVOKE SELECT ON public.ski_areas FROM anon;

DROP POLICY ski_area_details_public_read ON public.ski_area_details;
CREATE POLICY ski_area_details_read ON public.ski_area_details
  FOR SELECT TO authenticated
  USING (true);
REVOKE SELECT ON public.ski_area_details FROM anon;