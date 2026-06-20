# leonardo-platform

The hosted platform for [Leonardo](https://www.leonardo-ai.io): run an agent on the harness,
with the Council and Workshop as services, quests, metered in $LEO on Base. ERC-8004-native,
x402-settled. **Offchain execution, onchain trust.**

Build plan: see `../leonardo-site/PLATFORM_ROADMAP.md`. Scope of this repo's first phase:
foundations → hosted-agent private beta (P0→P2). **Testnet only** — no mainnet, no real $LEO.

## Layout (pnpm workspaces)
```
apps/web/            Next.js authed app (Supabase SSR, wallet-connect, dashboard, quests)
services/gateway/    API over graph (Neo4j) + memory (claw-memory) + Council + Workshop
services/agent-runner/  per-tenant Hermes provisioning + lifecycle
packages/contracts/  ERC-8004 client + tests (viem; Foundry once installed)
packages/shared/     shared types + invariants (integrity-ordering gate)
supabase/            versioned migrations + RLS policies
```

## Dev
```bash
pnpm install
pnpm typecheck
pnpm test          # vitest — unit + integration
pnpm bankr:proof:bridge  # offline/no-spend public-source → final-receipt provenance check
```

## Public proof bridge

`pnpm bankr:proof:bridge` is an offline/no-spend verifier for the Bankr/x402 proof bridge. It reads only repository source, performs no wallet signing, no RPC calls, no Bankr writes, and no x402 payment. The check fails if the public paid-proof runner stops binding to `BASE_SEPOLIA_PAID_ATTACK_FINAL_RECEIPT_20260619.json`, reintroduces the older non-final receipt name, or loses the tx-success / transfer-log settlement guards.

## Status
- **M0 · scaffold + CI + integrity invariant** — ✅ done (tsc + vitest green)
- **M1 · de-risking spikes**
  - **A · ERC-8004 read** — ✅ live read of the real Base registry (`packages/contracts`)
  - **A · ERC-8004 write** — ✅ real on-chain registration on Base Sepolia: agentId `6960` minted, owner + tokenURI read back (tx `0xf729f539…eec22e`)
  - **B · x402 metering** — ✅ **real pay-to-use proven**: client pays $0.05 USDC on Base Sepolia (x402.org facilitator) → settled on-chain (payer 20→19.95, payTo 0→0.05) → real Council verdict returned. Browser pays via x402-fetch from the connected wallet.
  - **C · Council over HTTP** — ✅ real seat verdict via `callSeat()` (`bun run spikes/council-seat.ts`; manual — spends model tokens, not in CI)
- M2–M6 — see `../leonardo-site/PLATFORM_ROADMAP.md`

> `spikes/` are manual proofs (network/model/onchain), intentionally excluded from CI.
