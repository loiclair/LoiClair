-- Migration : 2026-04-14_sync_cache.sql
-- Table utilitaire pour rendre les imports nocturnes idempotents.
--
-- À appliquer UNE fois sur la base.
--
-- Ce fichier créait aussi `sync_row_hashes`, le cache d'empreintes, passé dans le
-- bucket `sync-cache` puis supprimé (`migrations/2026-10-14_drop_sync_row_hashes.sql`).

create table if not exists sync_http_cache (
  cache_key text primary key,
  last_modified text,
  etag text,
  content_sha text,
  updated_at timestamptz not null default now()
);
