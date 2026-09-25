-- Apply once in the Supabase SQL editor. The service talks to PostgREST;
-- it does not run this file itself.
-- Free-tier retention is enforced by the process (purge older than 30 days)
-- and by the index on created_at.

create table if not exists alerts (
  id bigint generated always as identity primary key,
  sport text not null check (sport in ('nfl', 'nba')),
  team text not null,
  player_name text not null,
  status text not null check (status in ('INJURY_REPORTED', 'OUT_FOR_GAME', 'QUESTIONABLE_TO_RETURN')),
  source text not null,
  timestamp_source timestamptz,
  timestamp_first_seen timestamptz not null,
  latency_ms integer,
  verbatim_text text,
  source_url text,
  verified boolean not null default false,
  game_id text,
  created_at timestamptz not null default now()
);

create index if not exists alerts_created_idx on alerts (created_at desc);
create index if not exists alerts_lookup_idx on alerts (sport, team, created_at desc);
create index if not exists alerts_dedup_idx on alerts (sport, team, player_name, timestamp_first_seen desc);
create index if not exists alerts_source_url_idx on alerts (source_url);

create table if not exists games (
  id bigint generated always as identity primary key,
  sport text not null,
  game_id text not null,
  club_1 text,
  club_2 text,
  state text,
  kickoff_time timestamptz,
  last_checked timestamptz,
  unique (sport, game_id)
);

create table if not exists health_check (
  id bigint generated always as identity primary key,
  collector_name text not null unique,
  last_run timestamptz,
  status text,
  error_msg text
);

alter table alerts enable row level security;
alter table games enable row level security;
alter table health_check enable row level security;

-- The backend uses the service role, which bypasses RLS. These policies let the
-- anon key read alerts if you point a browser straight at PostgREST. Writes stay
-- server-side. Drop them if you only use the service role.
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'alerts_read') then
    create policy alerts_read on alerts for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'games_read') then
    create policy games_read on games for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'health_read') then
    create policy health_read on health_check for select using (true);
  end if;
end $$;
