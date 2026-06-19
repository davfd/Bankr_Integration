# Bankr/Base Authority Boundary Ledger

Generated for the 2026-06-19 Council debt-priority ruling. This tracked ledger is the public/team-visible index of the current Bankr/Base proof boundary. It does **not** copy secrets, raw env values, MCP tokens, Bankr keys, wallet private data, or gitignored report bodies.

## Current build footing

| Lane | Current footing | Boundary |
|---|---|---|
| Read-only Bankr/Base smoke | Verified by sealed local receipt. | Applies only to read-only `read_wallet_state` through Passport-governed Base MCP; not authorization for writes, value movement, x402 settlement, or contract execution. |
| Passport read grant | Public metadata mutation was performed and independently verified by local sealed receipts. | Grant proves `base.wallet.read` capability/chain admission only; it does not grant sibling spend/write/x402/contract powers. |
| `policy_hash` | Runtime-enforced for `read_wallet_state` after this slice. | A missing or mismatched read-only grant `policy_hash` refuses before Bankr runtime; this still does not authorize sibling spend/write/x402/contract powers. |
| Skipped tests | Existing skips are opt-in integration/live tests. | Zero skips must not be advertised as if they already ran. |
| Reports directory | Local receipts are hash-sealed under `/home/exor/Leonardo/reports/bankr_approval_authority_v1/`. | Those report files are gitignored; this ledger provides tracked hash pointers, not a replacement for the local full receipts. |

## Dangerous lanes closed without separate Council/user gate

The following lanes remain shut by default:

- governed writes;
- `$LEO` x402 settlement;
- approval seeding/signing;
- contract operation execution;
- production env mutation, deploy, restart, or rollback;
- live Bankr write smoke.

A read-only receipt, a Passport identity, or a policy hash witness cannot open any of these lanes.

## Sealed receipt index

| Artifact | SHA-256 | Local path |
|---|---:|---|
| Debt-priority Council packet | `a7ae0825af9608c45ac071e0f411915f964d07b7602e8b2fa9487eb655a4fa5b` | `/home/exor/Leonardo/reports/bankr_approval_authority_v1/DEBT_PRIORITY_COUNCIL_PACKET_20260619.md` |
| Debt-priority Council synthesis | `399c235e47af5d64d73c73edd499f12e33243a9ff14f0040a6797c74e25a0148` | `/home/exor/Leonardo/reports/bankr_approval_authority_v1/DEBT_PRIORITY_COUNCIL_SYNTHESIS_20260619.md` |
| Passport read-grant update packet V2 | `d00fbae226213834c8e5c989ec09e1bb7d24d67ea3de1a78ef6ceb12aac4cc0a` | `/home/exor/Leonardo/reports/bankr_approval_authority_v1/PASSPORT_READ_GRANT_UPDATE_PACKET_V2.md` |
| Passport read-grant execution and smoke receipt | `e0be5a0eee0ef3092ba85cab8331b106d5a93cf1d56eeef1031ed30bfca9cecc` | `/home/exor/Leonardo/reports/bankr_approval_authority_v1/PASSPORT_READ_GRANT_EXECUTION_AND_SMOKE_RECEIPT.md` |
| Passport post-interruption verify addendum | `d8e25f42e07692accdd5bb423fd3a8350f6b8af5b3ec5d02d494dba5a1398595` | `/home/exor/Leonardo/reports/bankr_approval_authority_v1/PASSPORT_READ_GRANT_POST_INTERRUPTION_VERIFY_ADDENDUM.md` |
| Live read-smoke refusal diagnosis | `5cdea7abd9949c13b0d521a2e74da01e517eefee88734e6068e467933c14a9ce` | `/home/exor/Leonardo/reports/bankr_approval_authority_v1/LIVE_READ_SMOKE_REFUSAL_DIAGNOSIS.md` |
| Live read-smoke rollback receipt | `255bc77a732f5ab337337b649bfcf34606f8fd64128f67219d6d01ebecd8bf2c` | `/home/exor/Leonardo/reports/bankr_approval_authority_v1/LIVE_READ_SMOKE_ATTEMPT_ROLLBACK_RECEIPT.md` |
| Production env activation receipt | `c28b18cdd3a42a10ee2c6e185aaacbbb0fe13f1327ca646b5d13c9118ff80c38` | `/home/exor/Leonardo/reports/bankr_approval_authority_v1/PRODUCTION_ENV_ACTIVATION_RECEIPT.md` |
| Final synthesis after bounded repairs | `abeba8c794b4f46bf1842197a639d816e0826ae8faec6523bc2947caf2c8411d` | `/home/exor/Leonardo/reports/bankr_approval_authority_v1/FINAL_SYNTHESIS_AFTER_DO_IT_ALL.md` |

## Policy-hash runtime gate completed in this slice

Code and tests now prove:

1. a `base.wallet.read` grant with missing `policy_hash` refuses before Bankr runtime;
2. a `base.wallet.read` grant with mismatched `policy_hash` refuses before Bankr runtime;
3. a `base.wallet.read` grant with the planner's Bankr read-only policy hash preserves the existing allowed read-only path;
4. refusal receipts mention the policy-hash boundary without leaking raw secrets or env values.

Scope is deliberately narrow: this runtime gate covers read-only Bankr/Base admission for `read_wallet_state`; it does not open governed writes, x402, approval signing, contract execution, production mutation, or live write smoke.
