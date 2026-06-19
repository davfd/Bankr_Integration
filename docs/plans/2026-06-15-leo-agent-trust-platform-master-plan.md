# $LEO + Agent Trust Platform Master Plan

> **Council status:** bounded five-seat planning Council in-thread, not a canon/public Council deposit. Use this as the build doctrine for the `$LEO` platform until superseded by a visible Council packet.

**Date:** 2026-06-15  
**Scope:** `$LEO` holder beta, paid/staked access, Graph/Council/Workshop via MCP, Agent Passport / Trust Stack, quest board, receipts, and future reward rails.  
**Core thesis:** `$LEO` is the economic rail around verified agent work. It funds access, bounties, bonds, rewards, and receipts. It does not buy truth, Council verdicts, safety clearance, Scripture interpretation, agent authority, or reputation without verified work.

---

## 0. Council Verdict

**ACCEPT as a staged Agent Trust Stack platform. REJECT passive-yield / resale mechanics.**

Build this:

```text
$LEO holder beta
→ receipt substrate
→ read-only public MCP
→ governed Council Memory read access
→ paid Council planning/audit requests + Workshop intake
→ quest board with verified-work payouts
→ boring contracts for receipts / escrow / reward claims
→ proven $LEO x402 metering if custom ERC-20 settlement works
→ Agent Trust Stack modules as services
→ staking/bonds
→ adoption-weighted rewards
```

Do **not** build this:

```text
stake LEO → free usage accrues → sell unused usage → earn more LEO
```

That loop looks like passive yield, creates quota resale markets, invites Sybil / wash games, and makes compute credits into a shadow financial instrument.

Best public line:

> `$LEO` can buy access and back claims. Verified work earns trust. Nothing buys truth.

---

## 1. What Exists Now vs What Is Planned

| Surface | Current safe claim | Not safe to claim yet |
|---|---|---|
| `$LEO` | Live Base ERC-20; holder-gates beta where wired. | Full tokenomics, staking, payouts, or `$LEO` x402 live settlement. |
| Holder access | Base mainnet balance gate exists in platform code. | Staking access is live. |
| Graph | Closed-beta Imagination Graph MCP is live as an independent read-only developer surface with scoped tokens; it is not the complete Agent Trust Stack. | Public remote MCP implies Council/Workshop intake, receipts, or full-stack agent-trust authority. |
| Council | Gateway has review/panel endpoints and current x402 testnet metering. | Token buys Council verdicts; `$LEO` pays Council today. |
| Council Memory | Shared Council/agent memory graph exists as a deliberative record; Leo can use it as testimony when authorized. | Public raw memory dump; token-governed memory writes; memory access equals truth. |
| Workshop | Research/workshop route and sidecar pattern exist. | Full public Workshop build/test system via MCP. |
| Agent Passport | ERC-8004 identity read/integration exists; Agent Passport is flagship primitive. | Passport alone proves safety/trust; every hosted agent has production passport. |
| Quest board | DB scaffolds / plan exist. | Quest payouts are live and claimable. |
| Staking | Not implemented. | Staked `$LEO` yields income / saleable usage. |
| x402 | Current routes are dollar-priced / Base-Sepolia test flow. | Mainnet `$LEO` x402 settlement. |

---

## 2. Constitutional Rules

1. `$LEO` buys access, funds bounties, backs bonds, and records receipts.
2. `$LEO` does **not** buy truth, Council verdicts, safety clearance, Scripture interpretation, agent authority, memory writes, graph writes, or reputation without verified work.
3. Council remains epistemic; Workshop remains empirical; Council memory is testimony and precedent, not automatic truth.
4. Paid access may buy Council planning/audit intake and Workshop work orders, but never the answer/result.
5. Stake is a **risk bond / anti-spam deposit / capacity commitment**, not reputation.
6. Usage credits are non-transferable, non-redeemable, expiring, account/agent-bound, and never sold for more `$LEO`.
7. Token holders may fund/prioritize safe tracks, not decide outcomes by wealth.
8. Bible KG / Scripture remains read-only reference witness. Structural analogy is not equivalence, replacement, revelation, or license.
9. Dangerous concepts get a misuse disposition: `BUILD`, `INVERT`, `CONTAIN`, `AUTOPSY_ONLY`, or `DO_NOT_BUILD`.
10. Public claims must label maturity: `conceptual`, `containment_scaffold`, `capability_module`, `hosted_service`, `onchain_receipt`.
11. Build boring before clever: receipts before rewards, quest verification before staking incentives, testnet before mainnet value.

---

## 3. System Model

### 3.1 Offchain Intelligence / Judgment

Keep these offchain:

- Imagination Graph reasoning
- source chunks and full text
- Council deliberation
- Council memory
- Workshop tests
- raw eval logs
- hosted agent execution
- reward scoring
- safety classification
- disputes / appeals
- private logs
- liveness / biometric material
- redaction decisions

### 3.2 Onchain Settlement / Receipts

Put only these onchain:

- `$LEO` payments / access rails
- bounty escrow
- reward claims
- artifact hashes
- action receipt hashes
- revocation / observation / attestation hashes
- ERC-8004 identity / reputation / validation pointers
- claim-specific bonds
- treasury movements

Rule:

> Put the seal onchain, not the manuscript.

---

## 4. Token Utility Model

Four jobs of `$LEO`:

```text
ACCESS  = pay/meter hosted agent, Graph, Council, Council Memory summaries, Workshop, MCP routes.
BOND    = stake/deposit behind identity, persona, claim, review, or high-risk action.
REWARD  = pay verified useful work after Council/Workshop gates.
RECEIPT = anchor artifact/action/validation hashes and pointers.
```

Allowed mechanics:

- holder-gated beta access
- paid access to public-safe service calls
- non-transferable usage credits or discounts
- claim-specific bonds
- anti-spam deposits for quests
- verified bounty payouts
- artifact/action receipt fees
- adoption-weighted rewards

Forbidden mechanics:

- passive staking yield
- saleable usage credits
- stake-weighted Council verdicts
- stake-weighted reputation
- raw submission-count rewards
- token-governed safety clearance
- token-governed Scripture interpretation
- buyable agent authority

---

## 5. Staking / Allowance Design

### 5.1 Replace “free usage resale”

Do not allow:

```text
stake LEO → accrue free usage → sell usage → earn LEO
```

Replace with:

```text
stake/deposit LEO
→ non-transferable account-bound allowance / discount / priority
→ usage expires or rolls over only inside capped account plan
→ can delegate to owned agents or organization members
→ cannot sell, redeem, transfer, or collateralize
```

### 5.2 Acceptable staking roles

- **Access commitment:** staker gets bounded usage allowance / discount.
- **Anti-spam deposit:** quest submitter deposits and gets it back if submission is valid.
- **Claim bond:** persona/passport/validation claim is challengeable; bond backs the claim.
- **Pledge bond:** specific scoped high-risk action requires deposit + PledgeGate.
- **Queue priority:** capped priority among safe tasks, never outcome influence.

### 5.3 Staking red lines

- No “yield” language.
- No token-emissions-as-income promise.
- No transferable compute credits.
- No whale-bought trust.
- No unlimited compute liability for treasury.

---

## 6. MCP Product Surface

Ship MCP in two tiers.

### 6.1 MVP: Read-Only Public-Safe MCP

Current closed beta starts narrower than the complete stack: Imagination Graph MCP and Council Memory MCP are independent read-only developer surfaces. They let external agents retrieve graph provenance, scriptural-reference parallels, and bounded Council precedent/testimony. They do **not** include Council/Workshop request intake, receipt anchoring, paid execution, quest payouts, authority grants, or `$LEO` settlement by themselves.

Scopes:

```text
graph:read
scripture:read
trust:read
receipts:read
council_memory:read
```

Tools:

```text
search_graph(query, limit?)
graph_concept(id_or_name, limit?)
graph_related(id_or_name, limit?)
scripture_reference(name, limit?)
search_council_memory(query, filters?, limit?)
get_council_precedents(topic | canon_id | artifact_hash)
get_council_verdict_summary(verdict_id | canon_id)
get_agent_passport(agent_id | wallet)
verify_agent_identity(agent_id | wallet)
read_agent_reputation(agent_id)
list_receipts(subject | wallet | hash)
get_receipt(receipt_id | hash)
check_revocation(subject | receipt_id)
list_capability_cards()
```

Never expose in public MCP:

- raw Cypher
- Neo4j credentials
- graph writes / imports
- Bible KG writes
- terminal/file/browser tools
- raw Council memory
- raw Workshop logs
- raw eval prompts/completions
- liveness/biometric material
- dangerous capability tools

### 6.2 Later: Paid / Request MCP

Scopes:

```text
council:request
council:plan
council:audit
workshop:request
quests:submit
receipts:write
```

Tools:

```text
request_council_review(packet)
request_council_panel(packet)
request_council_plan(problem, constraints, evidence_refs?)
request_council_audit(artifact_uri, artifact_hash, audit_question)
request_workshop_brief(packet)
request_workshop_reproduction(artifact_uri, artifact_hash, expected_result)
request_workshop_build(work_order, constraints, budget_cap?)
submit_quest_artifact(quest_id, artifact_uri, artifact_hash)
create_public_receipt(kind, subject, artifact_hash)
request_validation(agent_id, request_hash)
```

Payment buys request/intake/cost recovery, not PASS/REJECT.

### 6.3 Council Memory / Council / Workshop Access Doctrine

These are first-class paid/staked platform surfaces, but with different authority classes:

| Surface | User gets | User does **not** get |
|---|---|---|
| Council Memory access | precedent search, verdict summaries, warning retrieval, artifact-linked memory handles | raw memory dump, private deliberation leakage, mutable memory writes, truth-by-memory |
| Council planning | bounded multi-seat planning, objections, staged roadmap, receipt | guaranteed approval, token-weighted answer, hidden chain-of-thought |
| Council audit | adversarial review of artifact/claim/plan against evidence and guardrails | purchased PASS, safety clearance by payment |
| Workshop access | scoped reproduction/build/test work orders, empirical reports, failed-test receipts | unrestricted execution, dangerous capability builds, raw secret/tool access |

MCP should expose **summaries and handles** first, not the whole cadaver laid open on the table. Raw Council memory and Workshop logs remain internal until redacted into receipts or public-safe briefs.

---

## 7. Agent Trust Stack Integration

| Primitive | Product module | `$LEO` / onchain hook | Boundary |
|---|---|---|---|
| Agent Passport | persistent agent identity envelope | ERC-8004 Identity, passport hash, registration fee/bond | not a magic trust badge |
| Persona Provenance | authorized masks vs spoofing | persona claim bond, anti-spoof bounty, reputation pointer | masks allowed; stolen faces not |
| Recognition Gateway | pre-action identity/scope challenge | high-risk action fee/bond, validation receipt | not production auth until tested |
| Revocation Receipts | revoke/supersede identity/memory links | revocation hash | never raw private data onchain |
| PledgeGate | scoped covenant before dangerous powers | pledge hash + bond | voluntary, scoped, releasable |
| Local Liveness | live authorized operator ceremony | liveness ceremony hash | no raw biometric leaves device |
| Observation Receipts | accountability for watching | observation receipt hash | not surveillance-as-a-service |
| Need-to-know router | compartmented memory/access | access receipt / policy hash | not secrecy without redress |

Integrity order:

```text
Passport → Persona Provenance → Recognition Gateway → PledgeGate → Revocation → Liveness → Observation → Need-to-know
```

Autonomous spend remains blocked until Recognition Gateway and PledgeGate are hosted, tested, and receipted.

---

## 8. Quest / Reward System

### 8.1 Quest lifecycle

```text
1. Leonardo/Council/Workshop publishes a need.
2. Quest opens with safety class, allowed work, forbidden work, payout criteria.
3. Builder submits artifact URI + hash.
4. Deterministic checks run where possible.
5. Council reviews disputed/high-value claims.
6. Workshop reproduces/tests where required.
7. Accepted work gets receipt.
8. Payout happens manually/Safe first, then escrow/distributor later.
9. Useful artifacts enter capability modules or public receipt ledger.
10. Later reuse/adoption feeds reward epochs.
```

### 8.2 Quest classes

- graph provenance cleanup
- concept/dossier packaging
- capability module implementation
- benchmark/eval harnesses
- red-team of trust primitives
- bug/security fixes
- documentation / SDK / MCP examples
- Workshop reproduction
- Council support / review labor

### 8.3 Quest safety template

Every quest requires:

```text
quest_id
safety_class
misuse_disposition: BUILD | INVERT | CONTAIN | AUTOPSY_ONLY | DO_NOT_BUILD
allowed_work
forbidden_work
required_artifact
required_tests
review_gate
workshop_gate
payout_amount_or_pool
bond_required
publication_tier
receipt_fields
dispute_path
revocation_path
```

### 8.4 Reward formula

```text
reward_i = pool_track_epoch × capped(score_i) / Σ capped(score_j)

score_i = adoption_points
        × provenance_integrity
        × uniqueness_multiplier
        × council_quality
        × workshop_signal
        × safety_multiplier
        × cost_efficiency
```

Hard zero for:

- fake provenance
- unsafe weaponization
- plagiarism
- unverifiable claims
- duplicate spam
- policy-bypassing artifacts
- raw submission-count farming

Reward useful failed/negative Workshop results if they produce clean evidence.

---

## 9. Contract Stack

Start boring:

1. **Existing `$LEO` ERC-20** on Base.
2. **ERC-8004 integration** for identity / reputation / validation pointers.
3. **ReceiptRegistry**
   - emits immutable receipt events
   - stores only kind, subject, artifact hash, metadata pointer/hash, issuer
4. **BountyEscrow**
   - holds `$LEO` for accepted quests
   - Safe/multisig controlled at MVP
5. **MerkleRewardDistributor**
   - epoch reward roots
   - offchain scoring, onchain claims
6. **BondVault / PledgeBond** later
   - claim-specific deposits
   - cautious slashing only after dispute process is proven
7. **Safe / timelock / pause controls**

Do not put scoring, Council truth, raw evidence, or safety decisions inside contracts.

---

## 10. Phased Build Plan

### Phase 0 — Truth Map / Claim Freeze

Goal: prevent overclaim.

Tasks:

- Create capability matrix: live / scaffold / hosted / onchain / testnet / planned.
- Reconcile `/token`, `/agent`, `/whitepaper`, `/council`, and data JSON.
- State plainly: `$LEO` holder gating is live where wired; `$LEO` x402 is not live yet.
- Add public “what `$LEO` can/cannot do” page block.

Exit gate:

- No public page claims staking, quest payouts, or `$LEO` x402 are live before proof.

### Phase 1 — Holder Beta + Usage Ledger

Goal: current beta, cleanly accounted.

Tasks:

- Wallet login.
- `$LEO` balance check.
- Holder-only pages/tools.
- Usage ledger for graph/chat/Council/Workshop calls.
- Optional beta credits: non-transferable, expiring, account-bound.
- Basic receipts for calls.

Exit gate:

- Holder can use beta; non-holder fails closed; usage is recorded.

### Phase 2 — Receipt Substrate

Goal: every serious action leaves a receipt.

Tasks:

- DB tables for receipts, revocations, passports, persona claims, pledges, liveness, observation receipts, MCP tokens, x402 payments.
- Gateway receipt routes.
- Receipt schema validation.
- Public receipt explorer.
- Redaction rules.

Exit gate:

- Council/Workshop/agent/quest/MCP events can create public-safe offchain receipts.

### Phase 3 — Read-Only MCP + Council Memory Search

Goal: let external agents safely query Leonardo and retrieve Council precedent without exposing raw memory.

Tasks:

- Public MCP endpoint with scoped tokens.
- Read-only graph/trust/receipt tools.
- Public-safe Council Memory tools: precedent search, verdict summaries, warning retrieval, artifact-linked memory handles.
- Token creation/revocation UI.
- Rate limits and audit logs.
- Redaction layer: no raw Council memory, no private deliberation, no memory writes, no raw Cypher.

Exit gate:

- External agent can search graph, retrieve a Council precedent summary, and verify receipts with a scoped token; revoked token fails; raw memory remains inaccessible.

### Phase 4 — Council Planning/Audit + Workshop Intake

Goal: make Council and Workshop access real platform products before quest payouts depend on them.

Tasks:

- `request_council_plan(problem, constraints, evidence_refs?)` intake route.
- `request_council_audit(artifact_uri, artifact_hash, audit_question)` intake route.
- `request_workshop_brief(packet)` and `request_workshop_reproduction(...)` intake routes.
- Work-order schema: scope, budget cap, safety class, evidence refs, expected artifact, redaction level.
- Council/Workshop queue UI with statuses: `submitted`, `accepted`, `needs_info`, `in_review`, `workshop_testing`, `complete`, `rejected`.
- Receipts for intake, seat dispatch, synthesis, Workshop result, and final delivery.
- Intake receipts expose a server-keyed brief commitment only; no public unsalted brief hash, raw brief, private source text, or short-brief dictionary oracle belongs in the public receipt/ledger surface.
- Payment/staking gate can prioritize intake/cost recovery, but not verdict/result.

Exit gate:

- One holder submits a Council planning request and one Workshop reproduction request; both produce receipts and public-safe final summaries; payment/stake changes queue access only, not outcome.

### Phase 5 — Quest Board v1

Goal: verified work loop without complex contracts, using Council/Workshop gates built in Phase 4.

Tasks:

- Quest board UI.
- Submission flow with artifact URI/hash.
- Safety template enforced.
- Deterministic checks where possible.
- Council audit / Workshop reproduction gates selectable per quest.
- Manual/Safe payout queue.
- Accepted/rejected receipts.

Exit gate:

- One real quest moves open → submitted → Council/Workshop reviewed → accepted → payout queued → receipt displayed.

### Phase 6 — Contracts v1

Goal: onchain receipts / escrow / reward claims.

Tasks:

- ReceiptRegistry.
- BountyEscrow.
- MerkleRewardDistributor.
- Event indexer.
- Testnet deployment.
- Mainnet deployment only after tests/audit.

Exit gate:

- Accepted testnet quest produces onchain receipt and escrowed payout.

### Phase 7 — `$LEO` x402 Metering

Goal: real `$LEO` service payments if x402 custom ERC-20 path is proven.

Tasks:

- Verify x402 custom ERC-20 / Permit2 support end-to-end.
- Configure asset `$LEO`, network Base, facilitator support.
- Add wallet client flow.
- Add reconciliation to `x402_payments`.
- Enforce wrong chain/asset/payer rejection.

Exit gate:

- Tiny `$LEO` x402 payment unlocks one route and receipt reconciles.

Fallback if not viable:

- Use direct `$LEO` payment contract / prepaid account balance / stablecoin x402 with `$LEO` holder/staker discounts.

### Phase 8 — Agent Trust Stack Modules

Goal: ship primitives as callable tools.

Tasks:

- Agent Passport service.
- Persona Provenance service.
- Recognition Gateway middleware.
- PledgeGate middleware.
- Revocation receipt service.
- Local Liveness ceremony hash flow.
- Observation receipt service.
- Need-to-know memory/access router.

Exit gate:

- Hosted agent can prove identity/scope/pledge before bounded non-financial protected actions.

### Phase 9 — Staking / Bonds

Goal: stake as access commitment and claim-specific risk backing.

Tasks:

- Non-transferable staking allowance / discount design.
- Cooldowns.
- Claim-specific bond records.
- Challenge/dispute process.
- Council/Workshop request priority caps.
- No resale, no passive yield.

Exit gate:

- Stake grants bounded account-bound access/discount and backs specific challengeable claims; it does not mint reputation or buy Council/Workshop outcomes.

### Phase 10 — Adoption-Weighted Rewards

Goal: reward what survives use.

Tasks:

- Adoption event model.
- Scoring service.
- Epoch reward manifest.
- Merkle root publication.
- Public reward explorer.

Exit gate:

- One reward epoch pays multiple contributors from a public manifest with receipts.

---

## 11. Testing Gates

Minimum commands:

```bash
cd /home/exor/leonardo-platform
BASE_MAINNET_RPC_URL=https://base-rpc.publicnode.com pnpm test
pnpm typecheck
pnpm build
```

Additional gates:

- Supabase RLS tests with disposable `DATABASE_URL`.
- ERC-8004 mainnet read.
- ERC-8004 Sepolia write smoke for testnet flows.
- MCP auth/scope/revocation tests.
- Token gate tests: holder pass, zero balance fail, RPC outage fail closed.
- Receipt redaction tests.
- Contract tests for escrow, distributor, receipts, access control, double-claim prevention.
- x402 tests: unpaid 402, wrong asset fail, wrong chain fail, valid payment pass.
- Agent Trust tests: revoked passport fails, pledge mismatch fails, liveness no raw biometric, observation no raw private logs.

---

## 12. Public Copy

Safe current wording:

> Leonardo is in holder-gated beta for `$LEO` holders. Inside the beta, Leonardo exposes staged access to the imagination graph, Council Memory precedent search, Council planning/audit paths, Workshop research/build/test intake, hosted-agent tools, and ERC-8004 identity experiments. `$LEO` is the economic rail for access, bounties, bonds, rewards, and receipts around verified work. Truth, Council verdicts, safety, Scripture interpretation, and agent authority are not token-governed.

Future wording after proof:

> Staked `$LEO` can provide bounded, non-transferable platform allowance and can back specific challengeable claims. Verified work earns rewards; stake alone does not earn trust.

Avoid:

- “stake for yield”
- “free usage you can sell”
- “token holders govern truth”
- “staking proves trust”
- “$LEO x402 is live” before proof
- “Council verdicts are decentralized by token”
- “Bible-powered token” / “tokenized Scripture”

---

## 13. Immediate Next Sprint

1. Create capability matrix JSON that drives docs/pages.
2. Patch stale public copy around staking, x402, quest status, Council Memory access, Council planning/audit access, and Workshop access.
3. Add receipt schema + DB tables.
4. Add read-only MCP token model and route plan, including public-safe Council Memory summary tools.
5. Add Council planning/audit + Workshop intake schemas and queues.
6. Build quest safety template.
7. Decide `$LEO` x402 proof spike vs fallback payment design.
8. Keep usage-credit resale out of v1.

---

## Final Inscription

> The token is a purse and a seal, not a judge. The judge is evidence, the Council, the Workshop, and the record that remains.
