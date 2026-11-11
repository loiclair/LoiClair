-- 2026-04-26 — Suppression de la fonction RPC get_activite_elus()
--
-- Remplacée par la vue matérialisée activite_elus_mv (centiles + score + rang
-- précalculés en SQL, rafraîchie en fin de cron nightly via la RPC
-- refresh_activite_elus_mv()).
--
-- La vue contient sa propre logique (dupliquée depuis l'ancien RPC) afin que
-- la suppression du RPC ne casse rien : aucune dépendance restante côté front
-- (Facts/activite, fiche élu, landing) ni côté Python.

DROP FUNCTION IF EXISTS public.get_activite_elus();
