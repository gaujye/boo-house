-- Apply once to the boo-house Supabase project using SQL Editor.
-- All nickname access is intentionally passwordless and mediated by the Vercel API.
begin;
create table if not exists public.boo_players (
  id uuid primary key default gen_random_uuid(),
  nickname text not null check (char_length(nickname) between 1 and 24),
  nickname_key text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.boo_runs (
  id uuid primary key,
  player_id uuid not null references public.boo_players(id),
  score integer not null,
  hits integer not null check (hits >= 0),
  penalties integer not null check (penalties >= 0),
  shots integer not null check (shots >= hits + penalties and shots <= 10000),
  created_at timestamptz not null default now(),
  check (hits + penalties <= 200),
  check (score >= -200 * penalties and score <= hits * 900 - penalties * 200),
  check (score % 50 = 0)
);
create index if not exists boo_runs_player_recent_idx on public.boo_runs (player_id, created_at desc);
alter table public.boo_players enable row level security;
alter table public.boo_runs enable row level security;
revoke all on public.boo_players, public.boo_runs from public, anon, authenticated;
grant select, insert, update on public.boo_players to service_role;
grant select, insert on public.boo_runs to service_role;
create or replace view public.boo_player_totals with (security_invoker = true) as
select p.id as player_id,
  greatest(coalesce(max(r.score), 0), 0)::integer as best_score,
  count(r.id)::integer as total_games,
  coalesce(sum(r.hits), 0)::bigint as total_hits,
  coalesce(sum(r.penalties), 0)::bigint as total_penalties
from public.boo_players p left join public.boo_runs r on r.player_id = p.id
group by p.id;
revoke all on public.boo_player_totals from public, anon, authenticated;
grant select on public.boo_player_totals to service_role;
commit;

-- Verification: empty tables should be present and protected by RLS.
select relname, relrowsecurity from pg_class
where oid in ('public.boo_players'::regclass, 'public.boo_runs'::regclass);
