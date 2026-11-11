-- 2026-10-28 : plus aucune position de groupe pour les non-inscrits (D-313)
--
-- POURQUOI. Les non-inscrits ne forment pas un groupe et ne votent pas ensemble. Une
-- position majoritaire calculée sur eux s'affichait pourtant comme un fait : /Facts/alliances
-- citait « Horizons & Indépendants ↔ Non inscrit » parmi les paires les plus alignées.
-- Les imports n'en écrivent plus (`import_scrutins_cloud.py`, `sync_senat.py`), et leur
-- purge de fin de passe efface celles des scrutins qu'ils relisent. Cette migration
-- efface les autres, pour que la table n'en garde aucune.
--
-- QUI EST NON-INSCRIT. À l'Assemblée, un organe `GP` de sigle `NI` (un par législature) ;
-- au Sénat, l'organe `GROUPESENAT` de sigle `NIPOL` (PO77708, `GROUPES_SENAT_VERS_ORGANE["NI"]`
-- de `_positions_groupe.py`). Mesuré le 2026-10-28 avant la passe des imports : 191 lignes
-- à l'Assemblée (PO840056), 123 au Sénat (PO77708). Appliquée le même jour après cette
-- passe, elle n'a plus rien trouvé : la purge des deux imports avait tout effacé. Elle
-- reste comme garantie pour une base qui n'aurait pas connu cette passe.
--
-- Les empreintes de ces lignes dans le cache des imports (`RowHashCache`, bucket
-- `sync-cache`) restent sans effet : aucune ligne non-inscrit n'est plus jamais proposée
-- à l'écriture.

delete from public.scrutins_groupes_positions
where groupe_uid in (
  select uid from public.organes
  where (code_type = 'GP' and libelle_abrev = 'NI')
     or (code_type = 'GROUPESENAT' and libelle_abrev = 'NIPOL')
);
