# ERC-8004 Compatibility Study — 2026-06-17

## Sources opened

- Official EIP page: `https://eips.ethereum.org/EIPS/eip-8004`
- Markdown mirror used for exact quoted fields: `https://best-practices.8004scan.io/docs/official-specification/erc-8004-official.md`
- Community metadata profile: `https://best-practices.8004scan.io/docs/01-agent-metadata-standard.md`
- Community feedback profile v2.0: `https://best-practices.8004scan.io/docs/02-feedback-standard.md`
- Community validation profile warning: `https://best-practices.8004scan.io/docs/03-validation-standard.md`
- Reference implementation README: `https://github.com/ChaosChain/trustless-agents-erc-ri`

## Spec facts used

ERC-8004 is a draft Standards Track ERC for trustless agents. It is not a payment/token standard. It defines three registries:

1. **Identity Registry** — ERC-721 + URIStorage. `tokenId` is called `agentId`; `tokenURI` is called `agentURI`; `agentURI` must resolve to an agent registration file.
2. **Reputation Registry** — permissionless feedback using signed fixed-point `int128 value` + `uint8 valueDecimals`, string `tag1/tag2`, optional endpoint and offchain evidence URI/hash.
3. **Validation Registry** — request/response validation hooks keyed by `requestHash`, with `responseHash` in status. Community docs mark the validation data profile unstable/pending finalization.

The current registration file shape uses:

```jsonc
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "myAgentName",
  "description": "...",
  "image": "https://example.com/agentimage.png",
  "services": [{ "name": "web", "endpoint": "https://..." }],
  "x402Support": false,
  "active": true,
  "registrations": [{ "agentId": 22, "agentRegistry": "eip155:1:0x..." }],
  "supportedTrust": ["reputation", "crypto-economic", "tee-attestation"]
}
```

Jan 2026 field-name point: official EIP uses `services`; legacy docs/deployments may still use `endpoints`. New Leonardo mints should emit `services`, not `endpoints`. Parsers may support legacy endpoints later, but the mint path should not create new legacy metadata.

## Leonardo compatibility state before this patch

Already compatible:

- Uses the Base/Base Sepolia ERC-8004 Identity Registry ABIs with `register`, `setAgentURI`, `ownerOf`, `tokenURI`, `getAgentWallet`, `setAgentWallet`, `unsetAgentWallet`.
- Fresh mint flow already did the correct two-step binding: `register(provisionalURI)` then `setAgentURI(tokenId, finalMetadataURI)` so the final document can include the exact minted token id.
- Gateway resolver already failed closed on owner mismatch and required Identity Kernel fields before granting model/tool authority.

Gaps found:

- Final metadata used percent-encoded `data:application/json,` instead of the spec-recommended base64 data URI form for fully onchain registration files.
- Final metadata had custom Leonardo fields but lacked several ERC-8004 interoperability fields: `image`, `services`, and a populated `registrations` entry.
- `supportedTrust` values used old underscore names rather than cleaner public strings.
- Resolver accepted only Leonardo's custom `passport_id` self-identification and did not accept the official `registrations[{agentId, agentRegistry}]` self-identification shape.
- Resolver did not reject a stale custom `owner_wallet` field after token transfer, even though `ownerOf()` was already checked.
- Resolver/Base MCP did not yet consume the ERC-8004 reserved on-chain `agentWallet`. A caller could supply an arbitrary `agent_wallet` argument to the governed read wrapper unless another downstream runtime refused it.

## Patch scope

This patch makes the Identity Registry / Agent Registration File path more ERC-8004 compatible without expanding agent authority:

- New minted passport metadata is base64 `data:application/json;base64,...`.
- New minted passport metadata includes official/profile fields:
  - `type`
  - `name`
  - `description`
  - `image`
  - `services`
  - `x402Support`
  - `active`
  - `registrations`
  - `supportedTrust`
- `registrations` now includes the exact Base Sepolia CAIP-style registry id: `eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e`.
- Gateway resolver now accepts official `registrations` self-identification when `passport_id` is absent, while still requiring Identity Kernel authority fields before use.
- Gateway resolver now verifies `registrations.agentRegistry` against the configured live client when available.
- Gateway resolver rejects stale custom `owner_wallet` if present and different from the signed session wallet.
- Live resolver now reads ERC-8004 `getAgentWallet(agentId)` when available and carries the verified, non-zero `agent_wallet` into the Identity Kernel session.
- Static document `agent_wallet` is treated as a claim that must match the on-chain `agentWallet` when present; stale/mismatched values fail closed.
- Passport-governed Base MCP now normalizes `read_wallet_state.agent_wallet` to the verified ERC-8004 `agentWallet` and refuses malformed or mismatched caller-supplied wallet arguments before downstream Bankr/Base runtime calls.

## Non-claims / not done yet

- No production deployment performed by this patch.
- No onchain mint/write performed by this patch.
- No Reputation Registry write path implemented. Feedback/validation should be Council-reviewed before any write surface.
- No Validation Registry production integration; community docs mark validation profile unstable.
- No Bankr write authority, transfer, swap, sign, submit, or `$LEO` x402 settlement proof added.
- Existing older passports with metadata that only has `passport_id` remain supported for Identity Kernel binding.
