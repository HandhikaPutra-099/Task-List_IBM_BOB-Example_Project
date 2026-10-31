-- ============================================================
-- Task List — Supabase PostgreSQL Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ─── EXTENSIONS ─────────────────────────────────────────────
-- pgcrypto is needed for gen_random_uuid() on older Supabase instances;
-- on modern ones uuid_generate_v4() / gen_random_uuid() are already available.
create extension if not exists "pgcrypto";

-- ─── ENUM TYPES ──────────────────────────────────────────────
do $$ begin
  create type task_priority as enum ('high', 'medium', 'low');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type task_category as enum (
    'College', 'Personal', 'Work', 'Project', 'Organization', 'Other'
  );
exception when duplicate_object then null;
end $$;

-- ─── TABLE: tasks ────────────────────────────────────────────
create table if not exists public.tasks (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,

  -- Core fields
  title            text        not null check (char_length(title) between 1 and 120),
  completed        boolean     not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Deadline (stored as UTC timestamp; NULL = no deadline)
  due_at           timestamptz,

  -- Classification
  priority         task_priority not null default 'medium',
  category         task_category not null default 'Other',

  -- Subtasks stored as JSONB array: [{id, text, completed}]
  subtasks         jsonb       not null default '[]'::jsonb,

  -- Reminder
  reminder_enabled         boolean     not null default false,
  reminder_minutes_before  integer     not null default 30 check (reminder_minutes_before >= 0),
  reminder_at              timestamptz,          -- exact UTC fire time
  reminder_sent_at         timestamptz           -- set when notification was dispatched
);

-- Automatically keep updated_at current
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- Indexes
create index if not exists tasks_user_id_idx        on public.tasks (user_id);
create index if not exists tasks_due_at_idx         on public.tasks (due_at)         where due_at is not null;
create index if not exists tasks_reminder_at_idx    on public.tasks (reminder_at)    where reminder_at is not null and reminder_sent_at is null;
create index if not exists tasks_completed_idx      on public.tasks (user_id, completed);

-- ─── TABLE: push_subscriptions ───────────────────────────────
create table if not exists public.push_subscriptions (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,

  -- Web Push endpoint + keys
  endpoint     text        not null,
  p256dh       text        not null,
  auth         text        not null,

  -- Metadata
  device_label text        not null default 'Unknown device',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,

  -- Prevent duplicate subscriptions for the same endpoint per user
  unique (user_id, endpoint)
);

create index if not exists push_subs_user_id_idx on public.push_subscriptions (user_id);

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────
-- tasks
alter table public.tasks enable row level security;

drop policy if exists "Users can select own tasks"  on public.tasks;
drop policy if exists "Users can insert own tasks"  on public.tasks;
drop policy if exists "Users can update own tasks"  on public.tasks;
drop policy if exists "Users can delete own tasks"  on public.tasks;

create policy "Users can select own tasks"
  on public.tasks for select
  using (auth.uid() = user_id);

create policy "Users can insert own tasks"
  on public.tasks for insert
  with check (auth.uid() = user_id);

create policy "Users can update own tasks"
  on public.tasks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own tasks"
  on public.tasks for delete
  using (auth.uid() = user_id);

-- push_subscriptions
alter table public.push_subscriptions enable row level security;

drop policy if exists "Users can select own subscriptions"  on public.push_subscriptions;
drop policy if exists "Users can insert own subscriptions"  on public.push_subscriptions;
drop policy if exists "Users can delete own subscriptions"  on public.push_subscriptions;

create policy "Users can select own subscriptions"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

create policy "Users can insert own subscriptions"
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own subscriptions"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

-- ─── REALTIME ────────────────────────────────────────────────
-- Enable Supabase Realtime replication for the tasks table
-- (run this once — idempotent via "if not exists" on the publication member)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end $$;

-- ─── HELPER: service-role bypass for Edge Functions ──────────
-- The Edge Function runs with the service role key so it bypasses RLS.
-- No additional grants needed — service role has full access by design.

-- ─── GRANT anon / authenticated roles ───────────────────────
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.tasks             to authenticated;
grant select, insert, delete         on public.push_subscriptions to authenticated;
