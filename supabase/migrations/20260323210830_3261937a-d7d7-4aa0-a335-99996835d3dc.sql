
CREATE TABLE public.user_trails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  location text NOT NULL DEFAULT '',
  distance numeric NOT NULL DEFAULT 0,
  elevation numeric NOT NULL DEFAULT 0,
  days text NOT NULL DEFAULT '1',
  difficulty text NOT NULL DEFAULT 'moderate',
  tags text[] NOT NULL DEFAULT '{}',
  season text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_trails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_trails_own" ON public.user_trails
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
