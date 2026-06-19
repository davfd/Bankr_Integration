# $LEO + Agent Trust Stack Capability Matrix

_Date: 2026-06-15_

This is the live/planned claim map for Leonardo's `$LEO`-backed Agent Trust Stack. It is intentionally conservative: tokens fund access, requests, bonds, rewards, and receipts; verified work earns trust; nothing buys truth.

Closed-beta MCP access is an independent developer surface for graph/Council-Memory reads. The complete Agent Trust Stack adds Council/Workshop intake, receipts, gates, and token rails around work that survives judgment; do not collapse the beta MCP into the whole system.

Source of truth in code: `packages/shared/src/leo-agent-trust-capabilities.ts` with tests in `packages/shared/src/leo-agent-trust-capabilities.test.ts`.

## Token facts

| Field | Value |
|---|---|
| Name | Leonardo |
| Symbol | LEO |
| Chain | Base mainnet |
| Chain ID | 8453 |
| Contract | `0xe1458ac40e3856b601d5dfdd1006c643a43c2ba3` |
| Decimals | 18 |
| Supply | 100,000,000,000 LEO |
| Launch rail | Bankr launch on Base |
| Launch tx | `0x4d4e290b97b5dcd4cac5ea3eaff95df9f11b26e3785a8038d6f8c1ebbef99162` |

## Doctrine

`$LEO` can fund access, quests, bonds, and receipts. Verified work earns trust. Nothing buys truth.

Allowed rails:

- platform access
- MCP calls
- Council planning/audit intake
- Workshop intake
- quest bounties
- work bonds
- receipts
- metered compute

Forbidden rails:

- truth
- Council verdicts
- safety clearance
- Scripture interpretation
- agent authority
- reputation without verified work

## Matrix

| Surface | Status | Network | Public claim | Next |
|---|---:|---|---|---|
| `$LEO` ERC-20 | live | Base mainnet | Live Base ERC-20 named Leonardo, symbol LEO, 18 decimals, 100B supply. | Keep token facts visible; no investment claims. |
| `$LEO` holder beta access | beta | Base mainnet | Token can be used as the beta access rail; private deploy may still keep allowlist/signature gates. | Reconcile holder gate + allowlist copy; receipt access checks. |
| Imagination Graph search | live | offchain | Search concepts with provenance discipline; mentions are evidence, concepts are clusters. | Keep public access read-only and bounded. |
| Imagination Graph MCP | beta | offchain | Closed-beta independent MCP surface: scoped, revocable, one-active-token-per-wallet, 48-hour beta, read-only token tile for graph provenance and scriptural-reference tools; not the complete Agent Trust Stack. | Maintain gateway token/session checks; keep copy separate from the full-stack product; add abuse/rate metrics per MCP token. |
| Council Memory MCP | beta | offchain | Separate scoped MCP token tile for bounded `search_council_memory` precedent/testimony search only; testimony, not truth or raw memory. | Keep Council Memory read-only; redact sensitive/private memory; no write/dump tools. |
| Council planning/audit intake | planned | offchain | Paid/staked users may request planning/audit; payment buys intake, not PASS/REJECT. | Add request endpoints, receipts, Council Memory handles. |
| Workshop intake | prototype | offchain | Paid/staked request surface for research/build/reproduction packets. | Add brief/repro/build routes and safety dispositions. |
| x402 dollar metering | beta | Base Sepolia | Current gateway x402 is testnet/dollar-priced, not `$LEO` settlement. | Keep public copy explicit; reject wrong chain/asset/payer. |
| `$LEO` x402/custom ERC-20 settlement | planned | Base mainnet | Future work until custom ERC-20/Permit2/facilitator or direct allowance checkout is proven. | Spike x402 custom asset; otherwise direct ERC-20 checkout. |
| Quest board | prototype | offchain | Rewards verified useful work only; no automatic payout/reputation without gates. | Manual Safe-reviewed payout queue + receipts. |
| Staking allowances | planned | Base mainnet | Account-bound allowances/discounts/priority/org seats only. | No resale of free credits; no passive-yield story. |
| Agent Passport / ERC-8004 | beta | Base Sepolia / Base read | Reads live ERC-8004 identity and experiments with Sepolia writes/reputation. | Bind passports to receipt bundles; token never buys authority. |
| Passport-governed Base MCP | prototype | Base Sepolia | Governed wrapper surface for Base actions through passport, capability grants, manifests, and receipts; no raw transfer/swap/approve/deploy tools. | Wire real read/x402/receipt adapters only after policy receipts stay green. |
| Bankr runtime adapter | prototype | offchain | Bankr is a downstream runtime behind Passport-governed Base MCP: read path plus governed-write scaffolding, configurable hash-only receipt attestations, x402 payment adapter is explicitly env-gated and disabled by default, operator-triggered read-only live-smoke route, server-side keyed, approval-store sealed governed submit wrapper, Approval Authority v1 ledgered, Council `ALLOW_AFTER_FIX` and Council `ALLOW_AFTER_DELTA` audited, readiness doctor blocks governed-write flags without Approval Authority env, preflight checks approval/usage/audit paths and signing-secret strength, read-only `policy_hash` runtime gate; not live `$LEO` x402 settlement or direct wallet power. Evidence: `a9eb644`, `e6ab28c`, `3c5c6ec`, `b42b4f2`, `12ded36`, `46683dc`, `697b5d4`, `services/gateway/src/app.ts /api/bankr/live-smoke`, `apps/web/app/status/page.tsx`, `DELTA_RECHECK.md` sha256 `04ddeaf598335ad1051c0969074199c4262e1ec31c46816cef18fe2d513f148b`, `DELTA_SOURCE_READBACK.md` sha256 `9266fdae4a78f7faab4b3b315b9af06d45aba2d6b3ca7052e414124864d38734`, `docs/bankr-runtime-adapter.md`, `docs/bankr-base-authority-boundary-ledger.md`. | Use read-only keys for smoke; enable governed writes only with server flag, approval-store records, and bounded operator authorization; keep configured x402 path disabled by default and separate from live custom-token settlement claims. |

## Rejected mechanics

- `stake LEO -> accrue free usage -> sell unused usage -> earn more LEO`
- passive-yield staking story
- token-weighted truth, doctrine, safety, or Council verdicts
- raw Council Memory dump as a product
- mutable public writes to memory/graph via MCP
- raw weaponization quests
