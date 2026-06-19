-- Wallet-keyed quest loop. The platform authenticates by WALLET (signed session),
-- not Supabase auth — so these tables key off `wallet text`, and the Next.js API
-- routes enforce per-wallet scoping using the service-role key. RLS is enabled
-- with no public policies (deny-all): nothing reaches these tables except the
-- server-side service role, which bypasses RLS. `quests` stays world-readable.

-- A user's work submitted against a quest (wallet-keyed).
create table public.quest_submissions (
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null references public.quests(id) on delete cascade,
  wallet text not null,
  artifact_uri text,
  status text not null default 'pending',   -- pending | verified | rejected
  created_at timestamptz not null default now()
);
create index quest_submissions_wallet_idx on public.quest_submissions (wallet);
create index quest_submissions_quest_idx on public.quest_submissions (quest_id);

-- Off-chain $LEO credits (the token isn't launched; this is the ledger of awards).
create table public.credits (
  id bigint generated always as identity primary key,
  wallet text not null,
  amount_leo numeric not null,
  reason text not null,                      -- e.g. 'quest <id> verified'
  submission_id uuid references public.quest_submissions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index credits_wallet_idx on public.credits (wallet);

-- Public receipts: proof that verified work happened (artifact hash).
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  submission_id uuid references public.quest_submissions(id) on delete set null,
  quest_id uuid references public.quests(id) on delete set null,
  artifact_uri text,
  artifact_hash text,
  created_at timestamptz not null default now()
);
create index receipts_wallet_idx on public.receipts (wallet);

-- Wallet-keyed metered usage (what P3's gateway will write; parallel to the
-- auth-based usage_ledger which the wallet model doesn't use).
create table public.usage_events (
  id bigint generated always as identity primary key,
  wallet text not null,
  kind text not null,                        -- 'council' | 'council_panel' | 'identity' | …
  units numeric not null default 1,
  leo_cost numeric not null default 0,
  created_at timestamptz not null default now()
);
create index usage_events_wallet_idx on public.usage_events (wallet);

-- Deny-all RLS (service role bypasses; no direct anon/authenticated access).
alter table public.quest_submissions enable row level security;
alter table public.credits           enable row level security;
alter table public.receipts          enable row level security;
alter table public.usage_events      enable row level security;

-- Seed a few real opening quests.
insert into public.quests (title, body, bounty_leo, status) values
  ('Find a contradiction in the graph',
   'Search the imagination graph and surface two concepts whose provenance disagrees. Submit the concept ids and a one-paragraph writeup.',
   50, 'open'),
  ('Red-team the Council',
   'Craft an idea that wins a false ACCEPT from the five-seat panel. Submit the idea text and the ruling it produced.',
   100, 'open'),
  ('Strengthen a thin concept',
   'Pick a concept with few sources and add two real provenance links. Submit the concept id and the sources.',
   40, 'open');
