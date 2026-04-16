-- Migration: add catalog structure version metadata for split-replace publishing
-- Run this in the Supabase SQL editor.

ALTER TABLE catalog
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE catalog
  ADD COLUMN IF NOT EXISTS structure_hash text;

UPDATE catalog
SET updated_at = COALESCE(updated_at, now())
WHERE updated_at IS NULL;

UPDATE catalog AS c
SET structure_hash = 'struct-' || substr(md5(
  concat_ws(
    '|',
    COALESCE(c.s3_prefix, ''),
    COALESCE(c.chapter_count, jsonb_array_length(COALESCE(c.chapters, '[]'::jsonb)))::text,
    COALESCE((
      SELECT string_agg(COALESCE(chapter.entry->>'filename', ''), '|' ORDER BY chapter.ord)
      FROM jsonb_array_elements(COALESCE(c.chapters, '[]'::jsonb)) WITH ORDINALITY AS chapter(entry, ord)
    ), '')
  )
), 1, 8)
WHERE c.structure_hash IS NULL;
