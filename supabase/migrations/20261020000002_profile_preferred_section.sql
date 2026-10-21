-- Trail section a person picks at sign-up (Hike & walk, Bike, Horseback, Snow); the map and search open on it.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_section text NOT NULL DEFAULT 'foot'
  CHECK (preferred_section IN ('foot', 'bike', 'horse', 'snow'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name, preferred_section)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', 'Adventurer'),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    CASE WHEN NEW.raw_user_meta_data->>'preferred_section' IN ('foot', 'bike', 'horse', 'snow')
      THEN NEW.raw_user_meta_data->>'preferred_section' ELSE 'foot' END
  );
  RETURN NEW;
END;
$$;
