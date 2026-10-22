-- Optional public event venue; existing admin-only write policies remain in force.
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS venue text CHECK (char_length(venue) <= 150);
