REVOKE EXECUTE ON FUNCTION public.get_assembly_averages()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_senate_averages()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_view_count_month(text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_assembly_averages() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_senate_averages() TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_view_count_month(text) TO service_role;

-- Code mort : aucun appel trouvé nulle part dans le code (le refresh réel
-- passe par pipeline/refresh_activite_scores.py en SQL direct).
DROP FUNCTION IF EXISTS public.refresh_activite_elus_mv();
