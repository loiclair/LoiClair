DROP POLICY IF EXISTS "allow insert from app" ON public.isr_generation_log;

ALTER TABLE public.isr_generation_log ENABLE ROW LEVEL SECURITY;
