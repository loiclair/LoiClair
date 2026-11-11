CREATE TABLE IF NOT EXISTS public.user_feedback (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vote       text NOT NULL CHECK (vote IN ('like', 'dislike')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_feedback_vote_created_at
  ON public.user_feedback (vote, created_at DESC);
