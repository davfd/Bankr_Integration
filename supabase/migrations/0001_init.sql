-- Leonardo platform — core accounts/quests schema with row-level security.
-- Supabase-compatible: assumes the auth schema + auth.uid() exist in Supabase
-- (the test harness installs a minimal shim to exercise the same policies).

create extension if not exists pgcrypto;

-- one profile per auth user; optional wallet linkage
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  wallet text unique,
  handle text,
  created_at timestamptz not null default now()
);

-- a user's agents, linked to an ERC-8004 passport
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null,
  agent_id bigint,         -- ERC-8004 tokenId once registered
  agent_uri text,
  chain_id int,
  created_at timestamptz not null default now()
);

-- public quest board (project-owned; written via service role)
create table public.quests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  bounty_leo numeric not null default 0,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

-- a user's work submitted against a quest
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null references public.quests(id) on delete cascade,
  submitter uuid not null references auth.users(id) on delete cascade,
  artifact_uri text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- metered usage per account
create table public.usage_ledger (
  id bigint generated always as identity primary key,
  account uuid not null references auth.users(id) on delete cascade,
  kind text not null,      -- 'council' | 'identity' | …
  units numeric not null default 1,
  leo_cost numeric not null default 0,
  created_at timestamptz not null default now()
);

-- grants (RLS still restricts rows)
grant usage on schema public to anon, authenticated;
grant select on public.quests to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.agents, public.submissions to authenticated;
grant select on public.usage_ledger to authenticated;

-- row-level security
alter table public.profiles      enable row level security;
alter table public.agents        enable row level security;
alter table public.quests        enable row level security;
alter table public.submissions   enable row level security;
alter table public.usage_ledger  enable row level security;

create policy profiles_own   on public.profiles     for all  using (id = auth.uid())        with check (id = auth.uid());
create policy agents_own     on public.agents        for all  using (owner = auth.uid())     with check (owner = auth.uid());
create policy quests_read    on public.quests        for select using (true);
create policy subs_read_own  on public.submissions   for select using (submitter = auth.uid());
create policy subs_ins_own   on public.submissions   for insert with check (submitter = auth.uid());
create policy usage_read_own on public.usage_ledger  for select using (account = auth.uid());
