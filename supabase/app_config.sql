-- Run this once in your Supabase SQL editor
-- Stores app-wide config (e.g. S3 credentials) fetched by the desktop app on login

create table if not exists app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

alter table app_config enable row level security;

create policy "Authenticated users can read app_config"
  on app_config for select to authenticated using (true);

create policy "Authenticated users can insert app_config"
  on app_config for insert to authenticated with check (true);

create policy "Authenticated users can update app_config"
  on app_config for update to authenticated using (true) with check (true);
