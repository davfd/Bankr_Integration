# Bankr Approval Authority Operator Runbook

This runbook is a containment document for Bankr governed-write activation. It is not an activation approval, not a deploy instruction, and not a live-write receipt.

**Do not enable production Bankr writes from this runbook.**

## Boundary

```text
wallet session
  -> base_mcp:governed token
  -> /mcp/base governed wrapper
  -> wallet-owned Passport / ERC-8004 resolver
  -> Identity Kernel capability grant
  -> human approval receipt
  -> Approval Authority sealed record
  -> usage reservation
  -> Bankr runtime adapter
  -> consume or release reservation
```

Bankr is the downstream hand. It is not authority. The authority chain is the passport, grant, human approval, sealed approval record, usage ledger, and audit receipt.

## Production flag doctrine

`BANKR_GOVERNED_WRITES_ENABLED=true is only a request`.

The readiness doctor must still prove all Approval Authority prerequisites before it passes write enablement to the runtime. A flag by itself must leave Bankr writes disabled.

## Required env names

Use env names only in tickets, packets, and public receipts. Do not paste values into chat, docs, commits, screenshots, or Council messages.

Required before governed writes can be considered ready:

- `BANKR_API_KEY`
- `BANKR_API_BASE_URL`
- `BANKR_GOVERNED_WRITES_ENABLED`
- `BANKR_APPROVAL_STORE_PATH`
- `BANKR_APPROVAL_USAGE_STORE_PATH`
- `BANKR_APPROVAL_AUDIT_LOG_PATH`
- `BANKR_APPROVAL_SIGNING_SECRET`

The Bankr key used for ordinary live smoke should be read-only. A non-read-only key belongs only in a separately authorized governed-write test window.

## Readiness doctor behavior

The readiness receipt must remain redacted and machine-checkable.

If `BANKR_API_KEY` is absent:

```json
{
  "configured": false,
  "mode": "disabled",
  "reason": "BANKR_API_KEY missing"
}
```

If `BANKR_GOVERNED_WRITES_ENABLED` is absent or not true, reads may be configured but writes stay disabled:

```json
{
  "configured": true,
  "mode": "read_only",
  "governed_writes": {
    "requested": false,
    "ready": false,
    "reason": "BANKR_GOVERNED_WRITES_ENABLED is not true"
  }
}
```

If the flag is requested but required env names are missing:

```json
{
  "governed_writes": {
    "requested": true,
    "ready": false,
    "reason": "Approval Authority env incomplete",
    "missing_env": [
      "BANKR_APPROVAL_STORE_PATH",
      "BANKR_APPROVAL_USAGE_STORE_PATH",
      "BANKR_APPROVAL_AUDIT_LOG_PATH",
      "BANKR_APPROVAL_SIGNING_SECRET"
    ]
  }
}
```

If env names exist but dry-run validation fails:

```json
{
  "governed_writes": {
    "requested": true,
    "ready": false,
    "reason": "Approval Authority preflight failed",
    "failed_preflight": [
      {
        "env": "BANKR_APPROVAL_USAGE_STORE_PATH",
        "check": "writable_directory",
        "reason": "write probe failed"
      }
    ]
  }
}
```

The preflight checks approval/usage/audit paths and signing-secret strength:

- approval-store parent directory is writable;
- existing approval-store path, if present, is a readable file;
- usage root is writable;
- usage `reserved` directory is writable;
- usage `consumed` directory is writable;
- audit-log parent directory is writable;
- `BANKR_APPROVAL_SIGNING_SECRET` is present and strong enough for HMAC sealing.

Failures are names and check codes only. They must not reveal HMAC material, Bankr keys, MCP tokens, session headers, authorization headers, or raw wallet payloads.

## Operator preflight command

Run only non-mutating or probe-only checks first:

```bash
pnpm bankr:smoke:preflight
```

Expected safe outcomes:

- blocked because no Bankr key is configured;
- read-only configured but governed writes not requested;
- governed writes requested but Approval Authority env incomplete;
- governed writes requested but preflight failed;
- governed writes ready only after env completeness and path/secret preflight pass.

A ready receipt is not production approval. It only proves that the local process can see a plausible sealed-approval authority configuration.

## Before any production activation

Create a Council preflight packet before any production activation.

The packet must include:

1. code commit hash for readiness and approval ledger;
2. test receipts for readiness, approval store, MCP base wrapper, Bankr adapter, and public trust ledger;
3. redacted readiness receipt showing `governed_writes.ready` state;
4. statement that no live Bankr write has executed;
5. statement that no production deploy or restart has occurred unless explicitly authorized;
6. statement that `$LEO` x402 settlement remains unproven unless separately sealed;
7. rollback plan for clearing the governed-write flag;
8. exact approval-store, usage-store, and audit-log path policy described by env name, not raw value.

Do not proceed on a partial Council pass. Any `REVISE`, missing seat, or source-visibility objection blocks activation.

## Refusal rules

Abort and keep writes disabled if any of these occur:

- approval lookup exists but reserve/release/consume hooks are missing;
- approval record lacks `approval_hash` or `nonce`;
- signing-secret preflight fails;
- usage store cannot reserve and consume;
- audit append cannot happen before runtime;
- raw value-movement, asset-exchange, calldata, or transaction body is supplied by model arguments; governed write calls must pass only `approval_id`, `passport_id`, `chain_id`, and matching human approval receipt;
- caller asks for raw transfer, raw swap, raw submit, raw sign, arbitrary contract write, or natural-language Bankr Agent write execution;
- receipts contain secrets, tokens, auth headers, raw wallet data, raw portfolio data, or unredacted request headers.

## Non-claims

This runbook does not claim:

- live production Bankr writes;
- live `$LEO` x402 settlement;
- direct wallet power for the model;
- token-purchased authority;
- Council approval for activation;
- safety beyond the bounded code and receipts named in the packet.

The safe state is read-only. The burden is on every activation attempt to prove otherwise, with receipts.
