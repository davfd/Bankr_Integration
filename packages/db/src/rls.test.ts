import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Real RLS isolation test against Postgres. Start a DB and set DATABASE_URL:
//   docker run -d --name leo-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres pnpm test
// Skipped when DATABASE_URL is absent (keeps CI green without a DB).
const __dir = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

run("RLS isolation · accounts schema", () => {
  let c: Client;
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await c.query("drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;");
    await c.query(readFileSync(join(__dir, "../test/shim.sql"), "utf8"));
    await c.query(readFileSync(join(__dir, "../../../supabase/migrations/0001_init.sql"), "utf8"));
    await c.query(readFileSync(join(__dir, "../../../supabase/migrations/0002_quests_wallet.sql"), "utf8"));
    // seed as superuser (bypasses RLS)
    await c.query("insert into auth.users(id) values ($1),($2)", [A, B]);
    await c.query("insert into public.agents(owner,name) values ($1,'A-bot'),($2,'B-bot')", [A, B]);
    await c.query("insert into public.usage_ledger(account,kind) values ($1,'council'),($2,'council')", [A, B]);
    await c.query("insert into public.quests(title) values ('grow the graph')");
  });

  afterAll(async () => {
    await c?.end();
  });

  // Run a query as a given authenticated user (RLS enforced), inside a rolled-back txn.
  async function asUser(id: string, q: string) {
    await c.query("begin");
    try {
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id })]);
      return await c.query(q);
    } finally {
      await c.query("rollback");
    }
  }

  it("a user sees only their own agents", async () => {
    const r = await asUser(A, "select name from public.agents order by name");
    expect(r.rows.map((x) => x.name)).toEqual(["A-bot"]);
  });

  it("a user cannot read another user's usage ledger", async () => {
    const r = await asUser(B, "select count(*)::int as n from public.usage_ledger");
    expect(r.rows[0].n).toBe(1); // only B's own row, not A's
  });

  it("a user cannot insert an agent owned by someone else", async () => {
    await expect(asUser(A, `insert into public.agents(owner,name) values ('${B}','sneaky')`)).rejects.toThrow();
  });

  it("quests are world-readable", async () => {
    const r = await asUser(A, "select count(*)::int as n from public.quests");
    expect(r.rows[0].n).toBe(4);
  });

  it("wallet-keyed beta tables are service-role only", async () => {
    await expect(asUser(A, "select count(*)::int as n from public.quest_submissions")).rejects.toThrow(/permission denied/i);
    await expect(asUser(A, "insert into public.usage_events(wallet, kind) values ('0xaaaa000000000000000000000000000000000001', 'chat')")).rejects.toThrow(/permission denied/i);
  });
});
