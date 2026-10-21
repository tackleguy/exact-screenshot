DROP POLICY jp_read ON storage.objects;

CREATE POLICY jp_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'journal-photos'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );