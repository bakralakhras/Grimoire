-- Grimoire Supabase Schema
-- Run this in your Supabase project: Dashboard → SQL Editor → Run

-- Progress: listening position per book per user
create table if not exists progress (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  book_id      text not null,
  book_title   text default '',
  chapter_index integer not null default 0,
  position     float not null default 0,
  speed        float not null default 1,
  updated_at   timestamptz not null default now(),
  unique(user_id, book_id)
);

-- Bookmarks per book per user (local UUID is the PK for easy upsert)
create table if not exists bookmarks (
  id            text primary key,
  user_id       uuid references auth.users(id) on delete cascade not null,
  book_id       text not null,
  chapter_index integer not null,
  position      float not null,
  name          text not null,
  created_at    timestamptz not null default now()
);

-- Book settings (ratings) per book per user
create table if not exists book_settings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  book_id    text not null,
  rating     float,
  updated_at timestamptz not null default now(),
  unique(user_id, book_id)
);

-- Row Level Security: each user sees only their own data
alter table progress     enable row level security;
alter table bookmarks    enable row level security;
alter table book_settings enable row level security;

create policy "own progress"      on progress      for all using (auth.uid() = user_id);
create policy "own bookmarks"     on bookmarks     for all using (auth.uid() = user_id);
create policy "own book_settings" on book_settings for all using (auth.uid() = user_id);
