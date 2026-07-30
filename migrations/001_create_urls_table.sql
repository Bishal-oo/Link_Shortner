-- Migration 001: create the urls table.
--
-- "IF NOT EXISTS" makes this migration idempotent: running it twice is safe
-- (the second run does nothing instead of erroring). Idempotent migrations are
-- a best practice — they let you re-run the whole set without fear.

CREATE TABLE IF NOT EXISTS urls (
    -- gen_random_uuid() is built into Postgres 13+ (no extension needed).
    -- A UUID primary key is unguessable, unlike a sequential integer id.
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The short code. UNIQUE means the DATABASE guarantees no two links ever
    -- share a code — even under concurrent inserts. UNIQUE also auto-creates
    -- an index, so lookups by code (every redirect!) are fast.
    code VARCHAR(20) UNIQUE NOT NULL,

    original_url TEXT NOT NULL,

    created_at TIMESTAMP DEFAULT now(),
    expires_at TIMESTAMP,               -- nullable: a link may never expire

    click_count BIGINT DEFAULT 0,       -- BIGINT: click counts can get huge
    last_accessed_at TIMESTAMP          -- nullable: null until first click
);
