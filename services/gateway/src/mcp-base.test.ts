import { describe, expect, it, vi } from "vitest";
import { BANKR_READ_ONLY_GRANT_POLICY_SHA256 } from "./identity-kernel-passport-grant-update";
import { BASE_MCP_TOOLS, handleBaseMcpRequest, type BaseMcpApprovedContractOperation, type BaseMcpApprovalStore, type BaseMcpSession } from "./mcp-base";

const OWNER = "0xaaaa000000000000000000000000000000000001";
const AGENT = "0xbbbb000000000000000000000000000000000002";
const MERCHANT = "0xcccc000000000000000000000000000000000003";

function session(overrides: Partial<BaseMcpSession["passport"]> = {}): BaseMcpSession {
  return {
    wallet: OWNER,
    passport: {
      agent_id: "leonardo-agent-7241",
      passport_id: "7241",
      agent_wallet: AGENT,
      active_system_prompt_hash: "sha256:test-system",
      authority_scope: ["answer", "base.wallet.read"],
      risk_context: "tool_execution",
      capability_grants: [],
      ...overrides,
    },
  };
}

function rpc(name: string, args: Record<string, unknown> = {}, id = 1): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

function payload(out: Record<string, unknown>): Record<string, unknown> {
  const result = out.result as { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
  const text = result?.content?.[0]?.text;
  if (!text) throw new Error("missing text payload");
  return JSON.parse(text) as Record<string, unknown>;
}

function approvedContract(overrides: Partial<BaseMcpApprovedContractOperation> = {}): BaseMcpApprovedContractOperation {
  return {
    approval_id: "approval-1",
    status: "approved",
    passport_id: "7241",
    chain_id: 8453,
    contract: "0xeeee000000000000000000000000000000000005",
    method: "setAgentURI",
    calldata_hash: "sha256:calldata-approved",
    human_approval_receipt: "sha256:approved-submit",
    approval_hash: "sha256:approval",
    nonce: "nonce-1",
    transaction: {
      chainId: 8453,
      to: "0xeeee000000000000000000000000000000000005",
      data: "0x1234deadbeef",
      value: "0x0",
    },
    ...overrides,
  };
}

function contractGrantSession(): BaseMcpSession {
  return session({
    authority_scope: ["answer", "base.contract.execute"],
    capability_grants: [{ capability: "base.contract.execute", chain_id: 8453, allowed_contracts: ["0xeeee000000000000000000000000000000000005"], allowed_methods: ["setAgentURI"], max_per_call: "0", requires_human: true }],
  });
}

function contractArgs(): Record<string, unknown> {
  return { passport_id: "7241", chain_id: 8453, approval_id: "approval-1", human_approval_receipt: "sha256:approved-submit" };
}

function approvedValueMovement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation_kind: "value_movement",
    approval_id: "move-1",
    status: "approved",
    passport_id: "7241",
    chain_id: 8453,
    recipient: MERCHANT,
    token_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amount: "2",
    is_native_token: false,
    human_approval_receipt: "sha256:human-approved-transfer",
    approval_hash: "sha256:move-approval",
    nonce: "move-nonce-1",
    ...overrides,
  };
}

function approvedAssetExchange(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation_kind: "asset_exchange",
    approval_id: "swap-1",
    status: "approved",
    passport_id: "7241",
    chain_id: 8453,
    from_token: "0x4200000000000000000000000000000000000006",
    to_token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amount: "0.5",
    min_buy_amount: "1000",
    human_approval_receipt: "sha256:human-approved-exchange",
    approval_hash: "sha256:swap-approval",
    nonce: "swap-nonce-1",
    ...overrides,
  };
}

describe("Passport-governed Base MCP policy engine", () => {
  it("lists only governed Base wrappers and no raw Base powers", async () => {
    const out = await handleBaseMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { session: session() });
    const tools = (((out as Record<string, unknown>).result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);

    expect(tools).toEqual([
      "read_wallet_state",
      "pay_x402_invoice",
      "publish_receipt_hash",
      "request_human_approved_contract_call",
      "execute_approved_value_movement",
      "execute_approved_asset_exchange",
      "execute_approved_contract_operation",
    ]);
    expect(BASE_MCP_TOOLS.map((tool) => tool.name)).toEqual(tools);
    expect(tools).not.toEqual(expect.arrayContaining(["transfer_token", "swap", "approve_token", "deploy_contract", "call_contract", "wallet_submit"]));
  });

  it("refuses x402 payment when the passport lacks a matching capability grant", async () => {
    const pay = vi.fn();
    const out = await handleBaseMcpRequest(rpc("pay_x402_invoice", {
      passport_id: "7241",
      agent_wallet: AGENT,
      recipient: MERCHANT,
      amount: "2",
      asset: "LEO",
      chain_id: 8453,
      invoice_url: "https://api.leonardo-ai.io/x402/invoice/1",
    }), {
      session: session({ authority_scope: ["answer", "base.x402.pay"] }),
      runtime: { payX402Invoice: pay },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: false, decision: "refuse", reason: expect.stringContaining("capability grant") });
    expect(body.receipt).toMatchObject({ stage: "tool", passport_id: "7241", verdict: "refuse" });
    expect(pay).not.toHaveBeenCalled();
  });

  it("refuses x402 payments outside recipient and amount policy before downstream execution", async () => {
    const pay = vi.fn();
    const grant = {
      capability: "base.x402.pay",
      chain_id: 8453,
      allowed_recipients: [MERCHANT],
      max_per_call: "5",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    const deps = {
      session: session({ authority_scope: ["answer", "base.x402.pay"], capability_grants: [grant] }),
      runtime: { payX402Invoice: pay },
    };

    const tooMuch = payload((await handleBaseMcpRequest(rpc("pay_x402_invoice", {
      passport_id: "7241",
      recipient: MERCHANT,
      amount: "6",
      asset: "LEO",
      chain_id: 8453,
      invoice_url: "https://api.leonardo-ai.io/x402/invoice/2",
    }), deps)) as Record<string, unknown>);
    const wrongRecipient = payload((await handleBaseMcpRequest(rpc("pay_x402_invoice", {
      passport_id: "7241",
      recipient: "0xdddd000000000000000000000000000000000004",
      amount: "2",
      asset: "LEO",
      chain_id: 8453,
      invoice_url: "https://api.leonardo-ai.io/x402/invoice/3",
    }), deps)) as Record<string, unknown>);

    expect(tooMuch).toMatchObject({ ok: false, decision: "refuse", reason: expect.stringContaining("max_per_call") });
    expect(wrongRecipient).toMatchObject({ ok: false, decision: "refuse", reason: expect.stringContaining("recipient") });
    expect(pay).not.toHaveBeenCalled();
  });

  it("refuses caller-supplied capability grants in JSON-RPC arguments", async () => {
    const pay = vi.fn();
    const out = await handleBaseMcpRequest(rpc("pay_x402_invoice", {
      passport_id: "7241",
      recipient: MERCHANT,
      amount: "1",
      asset: "LEO",
      chain_id: 8453,
      invoice_url: "https://api.leonardo-ai.io/x402/invoice/self-declared",
      capability_grants: [{ capability: "base.x402.pay", chain_id: 8453, allowed_recipients: [MERCHANT], max_per_call: "10" }],
    }), {
      session: session({ authority_scope: ["answer", "base.x402.pay"], capability_grants: [] }),
      runtime: { payX402Invoice: pay },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: false, decision: "refuse", reason: expect.stringContaining("self-declare") });
    expect(pay).not.toHaveBeenCalled();
  });

  it("refuses read_wallet_state when the Passport read grant lacks the runtime policy_hash witness", async () => {
    const readWalletState = vi.fn(async () => ({ balance: "10", chain_id: 8453 }));
    const out = await handleBaseMcpRequest(rpc("read_wallet_state", { passport_id: "7241", agent_wallet: AGENT, chain_id: 8453 }), {
      session: session({
        authority_scope: ["answer", "base.wallet.read"],
        capability_grants: [{ capability: "base.wallet.read", chain_id: 8453 }],
      }),
      runtime: { readWalletState },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: false, decision: "refuse", tool: "read_wallet_state" });
    expect(String(body.reason)).toMatch(/policy_hash/i);
    expect(readWalletState).not.toHaveBeenCalled();
  });

  it("refuses read_wallet_state when the Passport read grant policy_hash does not match the Bankr read-only policy", async () => {
    const readWalletState = vi.fn(async () => ({ balance: "10", chain_id: 8453 }));
    const out = await handleBaseMcpRequest(rpc("read_wallet_state", { passport_id: "7241", agent_wallet: AGENT, chain_id: 8453 }), {
      session: session({
        authority_scope: ["answer", "base.wallet.read"],
        capability_grants: [{ capability: "base.wallet.read", chain_id: 8453, policy_hash: "sha256:wrong-policy" }],
      }),
      runtime: { readWalletState },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: false, decision: "refuse", tool: "read_wallet_state" });
    expect(String(body.reason)).toMatch(/policy_hash/i);
    expect(readWalletState).not.toHaveBeenCalled();
  });

  it("allows read_wallet_state with a wallet-read grant and records a passport receipt", async () => {
    const readWalletState = vi.fn(async () => ({ balance: "10", chain_id: 8453 }));
    const out = await handleBaseMcpRequest(rpc("read_wallet_state", { passport_id: "7241", agent_wallet: AGENT, chain_id: 8453 }), {
      session: session({
        authority_scope: ["answer", "base.wallet.read"],
        capability_grants: [{ capability: "base.wallet.read", chain_id: 8453, policy_hash: BANKR_READ_ONLY_GRANT_POLICY_SHA256 }],
      }),
      runtime: { readWalletState },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: true, decision: "allow", tool: "read_wallet_state", result: { balance: "10", chain_id: 8453 } });
    expect(body.receipt).toMatchObject({ stage: "tool", passport_id: "7241", verdict: "allow" });
    expect(readWalletState).toHaveBeenCalledTimes(1);
  });

  it("turns human-approved contract calls into non-executed approval envelopes", async () => {
    const out = await handleBaseMcpRequest(rpc("request_human_approved_contract_call", {
      passport_id: "7241",
      chain_id: 8453,
      contract: "0xeeee000000000000000000000000000000000005",
      method: "setAgentURI",
      calldata_hash: "sha256:abcdef",
      purpose: "repair passport metadata",
    }), {
      session: session({
        authority_scope: ["answer", "base.contract.request_human"],
        capability_grants: [{ capability: "base.contract.request_human", chain_id: 8453, allowed_contracts: ["0xeeee000000000000000000000000000000000005"] }],
      }),
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: true, decision: "human_required", executed: false, approval: { status: "pending_human_approval" } });
    expect(JSON.stringify(body)).not.toMatch(/txHash|executed":true/);
  });

  it("refuses governed value movement when only a human approval receipt string is supplied", async () => {
    const move = vi.fn();
    const out = await handleBaseMcpRequest(rpc("execute_approved_value_movement", {
      passport_id: "7241",
      chain_id: 8453,
      recipient: MERCHANT,
      token_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: "1",
      is_native_token: false,
      human_approval_receipt: "sha256:human-approved-transfer",
    }), {
      session: session({
        authority_scope: ["answer", "base.value.move"],
        capability_grants: [{ capability: "base.value.move", chain_id: 8453, allowed_recipients: [MERCHANT], allowed_assets: ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"], max_per_call: "5", requires_human: true }],
      }),
      runtime: { executeApprovedValueMovement: move },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: false, decision: "refuse", tool: "execute_approved_value_movement" });
    expect(String(body.reason)).toMatch(/approval_id|sealed|approval store/i);
    expect(move).not.toHaveBeenCalled();
  });

  it("executes governed value movement only from a sealed approval record with reservation lifecycle", async () => {
    const approval = approvedValueMovement();
    const reservation = { approval_id: "move-1", passport_id: "7241", chain_id: 8453, approval_hash: "sha256:move-approval", nonce: "move-nonce-1", reservation_id: "move-reservation-1" };
    const move = vi.fn(async () => ({ provider: "bankr", mode: "governed_write", endpoint: "/wallet/transfer", executed: true, accepted: true, tx_hash: "0xabc" }));
    const store = {
      getApprovedValueMovement: vi.fn(async () => approval),
      reserveApprovedContractOperation: vi.fn(async () => ({ ok: true as const, reservation })),
      consumeApprovedContractOperation: vi.fn(async () => undefined),
      releaseApprovedContractOperation: vi.fn(async () => undefined),
    };

    const out = await handleBaseMcpRequest(rpc("execute_approved_value_movement", {
      passport_id: "7241",
      chain_id: 8453,
      approval_id: "move-1",
      human_approval_receipt: "sha256:human-approved-transfer",
    }), {
      session: session({
        authority_scope: ["answer", "base.value.move"],
        capability_grants: [{ capability: "base.value.move", chain_id: 8453, allowed_recipients: [MERCHANT], allowed_assets: ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"], max_per_call: "5", requires_human: true }],
      }),
      approvalStore: store as unknown as BaseMcpApprovalStore,
      runtime: { executeApprovedValueMovement: move },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: true, decision: "allow", tool: "execute_approved_value_movement", result: { provider: "bankr", mode: "governed_write", executed: true } });
    expect(store.getApprovedValueMovement).toHaveBeenCalledWith({ approval_id: "move-1", passport_id: "7241", chain_id: 8453 });
    expect(store.reserveApprovedContractOperation).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith(expect.objectContaining({ args: expect.objectContaining({ recipient: MERCHANT, amount: "2" }) }));
    expect(store.consumeApprovedContractOperation).toHaveBeenCalledWith(reservation, expect.objectContaining({ result: expect.objectContaining({ tx_hash: "0xabc" }) }));
    expect(store.releaseApprovedContractOperation).not.toHaveBeenCalled();
  });

  it("refuses governed value movement when sealed approval policy bindings fail before Bankr execution", async () => {
    const move = vi.fn();
    const deps = (approval: Record<string, unknown>) => ({
      session: session({
        authority_scope: ["answer", "base.value.move"],
        capability_grants: [{ capability: "base.value.move", chain_id: 8453, allowed_recipients: [MERCHANT], allowed_assets: ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"], max_per_call: "5", requires_human: true }],
      }),
      approvalStore: { getApprovedValueMovement: vi.fn(async () => approval) } as unknown as BaseMcpApprovalStore,
      runtime: { executeApprovedValueMovement: move },
    });

    const wrongRecipient = payload((await handleBaseMcpRequest(rpc("execute_approved_value_movement", { passport_id: "7241", chain_id: 8453, approval_id: "move-1", human_approval_receipt: "sha256:human-approved-transfer" }), deps(approvedValueMovement({ recipient: "0xdddd000000000000000000000000000000000004" })))) as Record<string, unknown>);
    const wrongAsset = payload((await handleBaseMcpRequest(rpc("execute_approved_value_movement", { passport_id: "7241", chain_id: 8453, approval_id: "move-1", human_approval_receipt: "sha256:human-approved-transfer" }), deps(approvedValueMovement({ token_address: "0xeeee000000000000000000000000000000000005" })))) as Record<string, unknown>);
    const tooMuch = payload((await handleBaseMcpRequest(rpc("execute_approved_value_movement", { passport_id: "7241", chain_id: 8453, approval_id: "move-1", human_approval_receipt: "sha256:human-approved-transfer" }), deps(approvedValueMovement({ amount: "6" })))) as Record<string, unknown>);

    expect(wrongRecipient.reason).toMatch(/recipient/i);
    expect(wrongAsset.reason).toMatch(/asset/i);
    expect(tooMuch.reason).toMatch(/max_per_call/i);
    expect(move).not.toHaveBeenCalled();
  });

  it("executes governed asset exchange only from a sealed approval record with reservation lifecycle", async () => {
    const approval = approvedAssetExchange();
    const reservation = { approval_id: "swap-1", passport_id: "7241", chain_id: 8453, approval_hash: "sha256:swap-approval", nonce: "swap-nonce-1", reservation_id: "swap-reservation-1" };
    const exchange = vi.fn(async () => ({ provider: "bankr", mode: "governed_write", endpoint: "/wallet/swap", executed: true, accepted: true, tx_hash: "0xdef" }));
    const store = {
      getApprovedAssetExchange: vi.fn(async () => approval),
      reserveApprovedContractOperation: vi.fn(async () => ({ ok: true as const, reservation })),
      consumeApprovedContractOperation: vi.fn(async () => undefined),
      releaseApprovedContractOperation: vi.fn(async () => undefined),
    };

    const out = await handleBaseMcpRequest(rpc("execute_approved_asset_exchange", {
      passport_id: "7241",
      chain_id: 8453,
      approval_id: "swap-1",
      human_approval_receipt: "sha256:human-approved-exchange",
    }), {
      session: session({
        authority_scope: ["answer", "base.asset.exchange"],
        capability_grants: [{ capability: "base.asset.exchange", chain_id: 8453, allowed_assets: ["0x4200000000000000000000000000000000000006", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"], max_per_call: "1", requires_human: true }],
      }),
      approvalStore: store as unknown as BaseMcpApprovalStore,
      runtime: { executeApprovedAssetExchange: exchange },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: true, decision: "allow", tool: "execute_approved_asset_exchange", result: { provider: "bankr", mode: "governed_write", executed: true } });
    expect(store.getApprovedAssetExchange).toHaveBeenCalledWith({ approval_id: "swap-1", passport_id: "7241", chain_id: 8453 });
    expect(store.reserveApprovedContractOperation).toHaveBeenCalledTimes(1);
    expect(exchange).toHaveBeenCalledWith(expect.objectContaining({ args: expect.objectContaining({ from_token: "0x4200000000000000000000000000000000000006", amount: "0.5" }) }));
    expect(store.consumeApprovedContractOperation).toHaveBeenCalledWith(reservation, expect.objectContaining({ result: expect.objectContaining({ tx_hash: "0xdef" }) }));
    expect(store.releaseApprovedContractOperation).not.toHaveBeenCalled();
  });

  it("refuses governed value movement and asset exchange when approval lifecycle hooks or sealing are missing", async () => {
    const move = vi.fn();
    const exchange = vi.fn();
    const lookupOnlyValue = payload((await handleBaseMcpRequest(rpc("execute_approved_value_movement", { passport_id: "7241", chain_id: 8453, approval_id: "move-1", human_approval_receipt: "sha256:human-approved-transfer" }), {
      session: session({ authority_scope: ["answer", "base.value.move"], capability_grants: [{ capability: "base.value.move", chain_id: 8453, allowed_recipients: [MERCHANT], allowed_assets: ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"], max_per_call: "5", requires_human: true }] }),
      approvalStore: { getApprovedValueMovement: vi.fn(async () => approvedValueMovement()) } as unknown as BaseMcpApprovalStore,
      runtime: { executeApprovedValueMovement: move },
    })) as Record<string, unknown>);
    const lookupOnlySwap = payload((await handleBaseMcpRequest(rpc("execute_approved_asset_exchange", { passport_id: "7241", chain_id: 8453, approval_id: "swap-1", human_approval_receipt: "sha256:human-approved-exchange" }), {
      session: session({ authority_scope: ["answer", "base.asset.exchange"], capability_grants: [{ capability: "base.asset.exchange", chain_id: 8453, allowed_assets: ["0x4200000000000000000000000000000000000006", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"], max_per_call: "1", requires_human: true }] }),
      approvalStore: { getApprovedAssetExchange: vi.fn(async () => approvedAssetExchange()) } as unknown as BaseMcpApprovalStore,
      runtime: { executeApprovedAssetExchange: exchange },
    })) as Record<string, unknown>);
    const unsealedReserve = vi.fn(async () => ({ ok: true as const, reservation: { approval_id: "move-1", passport_id: "7241", chain_id: 8453, approval_hash: "sha256:move-approval", nonce: "move-nonce-1" } }));
    const unsealed = payload((await handleBaseMcpRequest(rpc("execute_approved_value_movement", { passport_id: "7241", chain_id: 8453, approval_id: "move-1", human_approval_receipt: "sha256:human-approved-transfer" }), {
      session: session({ authority_scope: ["answer", "base.value.move"], capability_grants: [{ capability: "base.value.move", chain_id: 8453, allowed_recipients: [MERCHANT], allowed_assets: ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"], max_per_call: "5", requires_human: true }] }),
      approvalStore: {
        getApprovedValueMovement: vi.fn(async () => ({ ...approvedValueMovement(), approval_hash: undefined, nonce: undefined })),
        reserveApprovedContractOperation: unsealedReserve,
        consumeApprovedContractOperation: vi.fn(async () => undefined),
        releaseApprovedContractOperation: vi.fn(async () => undefined),
      } as unknown as BaseMcpApprovalStore,
      runtime: { executeApprovedValueMovement: move },
    })) as Record<string, unknown>);

    expect(lookupOnlyValue).toMatchObject({ ok: false, decision: "refuse" });
    expect(lookupOnlyValue.reason).toMatch(/usage store|approval store|reservation/i);
    expect(lookupOnlySwap).toMatchObject({ ok: false, decision: "refuse" });
    expect(lookupOnlySwap.reason).toMatch(/usage store|approval store|reservation/i);
    expect(unsealed).toMatchObject({ ok: false, decision: "refuse" });
    expect(unsealed.reason).toMatch(/approval_hash|nonce|sealed/i);
    expect(unsealedReserve).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });

  it("refuses replay before value movement or exchange runtime when reservation fails", async () => {
    const move = vi.fn();
    const exchange = vi.fn();
    const reserve = vi.fn(async () => ({ ok: false as const, reason: "approval already consumed or reserved" }));
    const value = payload((await handleBaseMcpRequest(rpc("execute_approved_value_movement", { passport_id: "7241", chain_id: 8453, approval_id: "move-1", human_approval_receipt: "sha256:human-approved-transfer" }), {
      session: session({ authority_scope: ["answer", "base.value.move"], capability_grants: [{ capability: "base.value.move", chain_id: 8453, allowed_recipients: [MERCHANT], allowed_assets: ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"], max_per_call: "5", requires_human: true }] }),
      approvalStore: { getApprovedValueMovement: vi.fn(async () => approvedValueMovement()), reserveApprovedContractOperation: reserve, consumeApprovedContractOperation: vi.fn(), releaseApprovedContractOperation: vi.fn() } as unknown as BaseMcpApprovalStore,
      runtime: { executeApprovedValueMovement: move },
    })) as Record<string, unknown>);
    const swap = payload((await handleBaseMcpRequest(rpc("execute_approved_asset_exchange", { passport_id: "7241", chain_id: 8453, approval_id: "swap-1", human_approval_receipt: "sha256:human-approved-exchange" }), {
      session: session({ authority_scope: ["answer", "base.asset.exchange"], capability_grants: [{ capability: "base.asset.exchange", chain_id: 8453, allowed_assets: ["0x4200000000000000000000000000000000000006", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"], max_per_call: "1", requires_human: true }] }),
      approvalStore: { getApprovedAssetExchange: vi.fn(async () => approvedAssetExchange()), reserveApprovedContractOperation: reserve, consumeApprovedContractOperation: vi.fn(), releaseApprovedContractOperation: vi.fn() } as unknown as BaseMcpApprovalStore,
      runtime: { executeApprovedAssetExchange: exchange },
    })) as Record<string, unknown>);

    expect(value.reason).toMatch(/consumed|reserved|replay/i);
    expect(swap.reason).toMatch(/consumed|reserved|replay/i);
    expect(move).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });

  it("releases value movement and exchange reservations on runtime non-success or throw", async () => {
    const valueReservation = { approval_id: "move-1", passport_id: "7241", chain_id: 8453, approval_hash: "sha256:move-approval", nonce: "move-nonce-1", reservation_id: "move-reservation-1" };
    const swapReservation = { approval_id: "swap-1", passport_id: "7241", chain_id: 8453, approval_hash: "sha256:swap-approval", nonce: "swap-nonce-1", reservation_id: "swap-reservation-1" };
    const valueStore = {
      getApprovedValueMovement: vi.fn(async () => approvedValueMovement()),
      reserveApprovedContractOperation: vi.fn(async () => ({ ok: true as const, reservation: valueReservation })),
      consumeApprovedContractOperation: vi.fn(async () => undefined),
      releaseApprovedContractOperation: vi.fn(async () => undefined),
    };
    const swapStore = {
      getApprovedAssetExchange: vi.fn(async () => approvedAssetExchange()),
      reserveApprovedContractOperation: vi.fn(async () => ({ ok: true as const, reservation: swapReservation })),
      consumeApprovedContractOperation: vi.fn(async () => undefined),
      releaseApprovedContractOperation: vi.fn(async () => undefined),
    };

    const value = payload((await handleBaseMcpRequest(rpc("execute_approved_value_movement", { passport_id: "7241", chain_id: 8453, approval_id: "move-1", human_approval_receipt: "sha256:human-approved-transfer" }), {
      session: session({ authority_scope: ["answer", "base.value.move"], capability_grants: [{ capability: "base.value.move", chain_id: 8453, allowed_recipients: [MERCHANT], allowed_assets: ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"], max_per_call: "5", requires_human: true }] }),
      approvalStore: valueStore as unknown as BaseMcpApprovalStore,
      runtime: { executeApprovedValueMovement: vi.fn(async () => ({ provider: "bankr", executed: false, accepted: false })) },
    })) as Record<string, unknown>);
    const swap = payload((await handleBaseMcpRequest(rpc("execute_approved_asset_exchange", { passport_id: "7241", chain_id: 8453, approval_id: "swap-1", human_approval_receipt: "sha256:human-approved-exchange" }), {
      session: session({ authority_scope: ["answer", "base.asset.exchange"], capability_grants: [{ capability: "base.asset.exchange", chain_id: 8453, allowed_assets: ["0x4200000000000000000000000000000000000006", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"], max_per_call: "1", requires_human: true }] }),
      approvalStore: swapStore as unknown as BaseMcpApprovalStore,
      runtime: { executeApprovedAssetExchange: vi.fn(async () => { throw new Error("Bankr timeout"); }) },
    })) as Record<string, unknown>);

    expect(value).toMatchObject({ ok: false, decision: "refuse" });
    expect(valueStore.consumeApprovedContractOperation).not.toHaveBeenCalled();
    expect(valueStore.releaseApprovedContractOperation).toHaveBeenCalledWith(valueReservation, expect.objectContaining({ reason: expect.stringMatching(/runtime|accepted|execution/i) }));
    expect(swap).toMatchObject({ ok: false, decision: "refuse" });
    expect(swapStore.consumeApprovedContractOperation).not.toHaveBeenCalled();
    expect(swapStore.releaseApprovedContractOperation).toHaveBeenCalledWith(swapReservation, expect.objectContaining({ reason: expect.stringMatching(/Bankr timeout|runtime/i) }));
  });

  it("refuses governed contract execution when raw transaction fields are supplied even if a matching approval store record exists", async () => {
    const submit = vi.fn();
    const approved = approvedContract({
      calldata_hash: "sha256:server-side-calldata",
      transaction: {
        chainId: 8453,
        to: "0xeeee000000000000000000000000000000000005",
        data: "0x1234abcdef",
        value: "0x0",
      },
    });
    const approvalStore = { getApprovedContractOperation: vi.fn(async () => approved) };

    const out = await handleBaseMcpRequest(rpc("execute_approved_contract_operation", {
      passport_id: "7241",
      chain_id: 8453,
      approval_id: "approval-1",
      human_approval_receipt: "sha256:approved-submit",
      transaction: { to: "0xeeee000000000000000000000000000000000005", data: "0xdeadbeef" },
    }), {
      session: session({
        authority_scope: ["answer", "base.contract.execute"],
        capability_grants: [{ capability: "base.contract.execute", chain_id: 8453, allowed_contracts: ["0xeeee000000000000000000000000000000000005"], allowed_methods: ["setAgentURI"], requires_human: true }],
      }),
      approvalStore,
      runtime: { executeApprovedContractOperation: submit },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: false, decision: "refuse", tool: "execute_approved_contract_operation" });
    expect(String(body.reason)).toMatch(/raw transaction/i);
    expect(approvalStore.getApprovedContractOperation).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("executes a governed contract operation only from a matching approval-store record", async () => {
    const approved = approvedContract({ purpose: "repair passport metadata" });
    const reservation = { approval_id: "approval-1", passport_id: "7241", chain_id: 8453, approval_hash: "sha256:approval", nonce: "nonce-1", reservation_id: "reservation-1" };
    const submit = vi.fn(async (_input: unknown) => ({ provider: "bankr", mode: "governed_write", endpoint: "/wallet/submit", executed: true, accepted: true, tx_hash: "0x789" }));
    const store: BaseMcpApprovalStore = {
      getApprovedContractOperation: vi.fn(async () => approved),
      reserveApprovedContractOperation: vi.fn(async () => ({ ok: true as const, reservation })),
      consumeApprovedContractOperation: vi.fn(async () => undefined),
      releaseApprovedContractOperation: vi.fn(async () => undefined),
    };

    const out = await handleBaseMcpRequest(rpc("execute_approved_contract_operation", {
      passport_id: "7241",
      chain_id: 8453,
      approval_id: "approval-1",
      human_approval_receipt: "sha256:approved-submit",
    }), {
      session: session({
        authority_scope: ["answer", "base.contract.execute"],
        capability_grants: [{ capability: "base.contract.execute", chain_id: 8453, allowed_contracts: ["0xeeee000000000000000000000000000000000005"], allowed_methods: ["setAgentURI"], max_per_call: "0", requires_human: true }],
      }),
      approvalStore: store,
      runtime: { executeApprovedContractOperation: submit },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: true, decision: "allow", tool: "execute_approved_contract_operation", result: { provider: "bankr", endpoint: "/wallet/submit", executed: true } });
    expect(JSON.stringify(body)).not.toContain("0x1234deadbeef");
    expect(store.getApprovedContractOperation).toHaveBeenCalledWith({ approval_id: "approval-1", passport_id: "7241", chain_id: 8453 });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(store.consumeApprovedContractOperation).toHaveBeenCalledWith(reservation, expect.objectContaining({ result: expect.objectContaining({ tx_hash: "0x789" }) }));
    expect(store.releaseApprovedContractOperation).not.toHaveBeenCalled();
    const submittedInput = submit.mock.calls[0]?.[0] as { approvedContractOperation?: BaseMcpApprovedContractOperation } | undefined;
    expect(submittedInput?.approvedContractOperation).toMatchObject({ approval_id: "approval-1", transaction: { data: "0x1234deadbeef" } });
  });

  it("refuses governed contract execution when approval store lacks reservation support", async () => {
    const approval = approvedContract();
    const lookupOnlyStore: BaseMcpApprovalStore = {
      getApprovedContractOperation: vi.fn(async () => approval),
    };
    const submit = vi.fn(async () => ({ provider: "bankr", endpoint: "/wallet/submit", executed: true, accepted: true }));

    const out = await handleBaseMcpRequest(rpc("execute_approved_contract_operation", contractArgs()), {
      session: contractGrantSession(),
      approvalStore: lookupOnlyStore,
      runtime: { executeApprovedContractOperation: submit },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: false, decision: "refuse", tool: "execute_approved_contract_operation" });
    expect(body.reason).toMatch(/usage store|reservation|approval store/i);
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses governed contract execution when the approval record lacks hash or nonce sealing", async () => {
    const unsealed = { ...approvedContract(), approval_hash: undefined, nonce: undefined } as unknown as BaseMcpApprovedContractOperation;
    const reservation = { approval_id: "approval-1", passport_id: "7241", chain_id: 8453, approval_hash: "sha256:approval", nonce: "nonce-1", reservation_id: "reservation-1" };
    const store: BaseMcpApprovalStore = {
      getApprovedContractOperation: vi.fn(async () => unsealed),
      reserveApprovedContractOperation: vi.fn(async () => ({ ok: true as const, reservation })),
      consumeApprovedContractOperation: vi.fn(async () => undefined),
      releaseApprovedContractOperation: vi.fn(async () => undefined),
    };
    const submit = vi.fn(async () => ({ provider: "bankr", endpoint: "/wallet/submit", executed: true, accepted: true }));

    const out = await handleBaseMcpRequest(rpc("execute_approved_contract_operation", contractArgs()), {
      session: contractGrantSession(),
      approvalStore: store,
      runtime: { executeApprovedContractOperation: submit },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: false, decision: "refuse", tool: "execute_approved_contract_operation" });
    expect(body.reason).toMatch(/approval_hash|nonce|sealed/i);
    expect(store.reserveApprovedContractOperation).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("reserves and consumes governed contract approvals only after accepted runtime execution", async () => {
    const approval = approvedContract();
    const reservation = { approval_id: "approval-1", passport_id: "7241", chain_id: 8453, approval_hash: "sha256:approval", nonce: "nonce-1", reservation_id: "reservation-1" };
    const store: BaseMcpApprovalStore = {
      getApprovedContractOperation: vi.fn(async () => approval),
      reserveApprovedContractOperation: vi.fn(async () => ({ ok: true as const, reservation })),
      consumeApprovedContractOperation: vi.fn(async () => undefined),
      releaseApprovedContractOperation: vi.fn(async () => undefined),
    };
    const submit = vi.fn(async () => ({ provider: "bankr", endpoint: "/wallet/submit", executed: true, accepted: true, tx_hash: "0x789" }));

    const out = await handleBaseMcpRequest(rpc("execute_approved_contract_operation", contractArgs()), {
      session: contractGrantSession(),
      approvalStore: store,
      runtime: { executeApprovedContractOperation: submit },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: true, decision: "allow", result: { executed: true, accepted: true } });
    expect(store.reserveApprovedContractOperation).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(store.consumeApprovedContractOperation).toHaveBeenCalledWith(reservation, expect.objectContaining({ result: expect.objectContaining({ executed: true }) }));
    expect(store.releaseApprovedContractOperation).not.toHaveBeenCalled();
  });

  it("releases reservations and refuses when runtime returns non-success or throws", async () => {
    const approval = approvedContract();
    const reservation = { approval_id: "approval-1", passport_id: "7241", chain_id: 8453, approval_hash: "sha256:approval", nonce: "nonce-1", reservation_id: "reservation-1" };
    const makeStore = (): BaseMcpApprovalStore => ({
      getApprovedContractOperation: vi.fn(async () => approval),
      reserveApprovedContractOperation: vi.fn(async () => ({ ok: true as const, reservation })),
      consumeApprovedContractOperation: vi.fn(async () => undefined),
      releaseApprovedContractOperation: vi.fn(async () => undefined),
    });

    const nonSuccessStore = makeStore();
    const nonSuccess = payload((await handleBaseMcpRequest(rpc("execute_approved_contract_operation", contractArgs()), {
      session: contractGrantSession(),
      approvalStore: nonSuccessStore,
      runtime: { executeApprovedContractOperation: vi.fn(async () => ({ provider: "bankr", executed: false, accepted: false })) },
    })) as Record<string, unknown>);

    expect(nonSuccess).toMatchObject({ ok: false, decision: "refuse" });
    expect(nonSuccess.reason).toMatch(/accepted|executed|runtime/i);
    expect(nonSuccessStore.consumeApprovedContractOperation).not.toHaveBeenCalled();
    expect(nonSuccessStore.releaseApprovedContractOperation).toHaveBeenCalledWith(reservation, expect.objectContaining({ reason: expect.stringMatching(/runtime/i) }));

    const throwStore = makeStore();
    const thrown = payload((await handleBaseMcpRequest(rpc("execute_approved_contract_operation", contractArgs()), {
      session: contractGrantSession(),
      approvalStore: throwStore,
      runtime: { executeApprovedContractOperation: vi.fn(async () => { throw new Error("Bankr timeout"); }) },
    })) as Record<string, unknown>);

    expect(thrown).toMatchObject({ ok: false, decision: "refuse" });
    expect(thrown.reason).toMatch(/runtime/i);
    expect(throwStore.consumeApprovedContractOperation).not.toHaveBeenCalled();
    expect(throwStore.releaseApprovedContractOperation).toHaveBeenCalledWith(reservation, expect.objectContaining({ reason: expect.stringMatching(/Bankr timeout|runtime/i) }));
  });

  it("refuses replay before runtime when approval reservation fails", async () => {
    const approval = approvedContract();
    const store: BaseMcpApprovalStore = {
      getApprovedContractOperation: vi.fn(async () => approval),
      reserveApprovedContractOperation: vi.fn(async () => ({ ok: false as const, reason: "approval already consumed or reserved" })),
      consumeApprovedContractOperation: vi.fn(async () => undefined),
      releaseApprovedContractOperation: vi.fn(async () => undefined),
    };
    const submit = vi.fn();

    const out = await handleBaseMcpRequest(rpc("execute_approved_contract_operation", contractArgs()), {
      session: contractGrantSession(),
      approvalStore: store,
      runtime: { executeApprovedContractOperation: submit },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: false, decision: "refuse", tool: "execute_approved_contract_operation" });
    expect(body.reason).toMatch(/consumed|reserved|replay/i);
    expect(submit).not.toHaveBeenCalled();
    expect(store.consumeApprovedContractOperation).not.toHaveBeenCalled();
  });

  it("does not reserve governed contract approvals when policy rejects before runtime", async () => {
    const approval = approvedContract();
    const store: BaseMcpApprovalStore = {
      getApprovedContractOperation: vi.fn(async () => approval),
      reserveApprovedContractOperation: vi.fn(async () => ({ ok: true as const, reservation: { approval_id: "approval-1", passport_id: "7241", chain_id: 8453, approval_hash: "sha256:approval", nonce: "nonce-1" } })),
      consumeApprovedContractOperation: vi.fn(async () => undefined),
      releaseApprovedContractOperation: vi.fn(async () => undefined),
    };

    const out = await handleBaseMcpRequest(rpc("execute_approved_contract_operation", contractArgs()), {
      session: session({ authority_scope: ["answer", "base.contract.execute"], capability_grants: [] }),
      approvalStore: store,
      runtime: { executeApprovedContractOperation: vi.fn() },
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: false, decision: "refuse" });
    expect(body.reason).toMatch(/capability grant/i);
    expect(store.reserveApprovedContractOperation).not.toHaveBeenCalled();
  });

  it("refuses governed contract operation when approval record mismatches receipt, contract policy, or expiry", async () => {
    const submit = vi.fn();
    const deps = (approved: BaseMcpApprovedContractOperation) => ({
      session: session({
        authority_scope: ["answer", "base.contract.execute"],
        capability_grants: [{ capability: "base.contract.execute", chain_id: 8453, allowed_contracts: ["0xeeee000000000000000000000000000000000005"], allowed_methods: ["setAgentURI"], max_per_call: "0", requires_human: true }],
      }),
      approvalStore: { getApprovedContractOperation: vi.fn(async () => approved) } satisfies BaseMcpApprovalStore,
      runtime: { executeApprovedContractOperation: submit },
    });
    const baseApproval = approvedContract({
      transaction: { chainId: 8453, to: "0xeeee000000000000000000000000000000000005", data: "0x1234", value: "0x0" },
    });

    const wrongReceipt = payload((await handleBaseMcpRequest(rpc("execute_approved_contract_operation", { passport_id: "7241", chain_id: 8453, approval_id: "approval-1", human_approval_receipt: "sha256:wrong" }), deps(baseApproval))) as Record<string, unknown>);
    const wrongContract = payload((await handleBaseMcpRequest(rpc("execute_approved_contract_operation", { passport_id: "7241", chain_id: 8453, approval_id: "approval-1", human_approval_receipt: "sha256:approved-submit" }), deps({ ...baseApproval, contract: "0xffff000000000000000000000000000000000006", transaction: { ...baseApproval.transaction, to: "0xffff000000000000000000000000000000000006" } }))) as Record<string, unknown>);
    const expired = payload((await handleBaseMcpRequest(rpc("execute_approved_contract_operation", { passport_id: "7241", chain_id: 8453, approval_id: "approval-1", human_approval_receipt: "sha256:approved-submit" }), deps({ ...baseApproval, expires_at: "2000-01-01T00:00:00.000Z" }))) as Record<string, unknown>);

    expect(wrongReceipt.reason).toMatch(/human approval/i);
    expect(wrongContract.reason).toMatch(/contract/i);
    expect(expired.reason).toMatch(/expired/i);
    expect(submit).not.toHaveBeenCalled();
  });

  it("denies unknown raw Base tools instead of treating them as downstream MCP calls", async () => {
    const out = await handleBaseMcpRequest(rpc("transfer_token", { passport_id: "7241", recipient: MERCHANT, amount: "1" }), {
      session: session({ authority_scope: ["answer", "base:transfer"] }),
    });

    const body = payload(out as Record<string, unknown>);
    expect(body).toMatchObject({ ok: false, decision: "refuse" });
    expect(String(body.reason)).toMatch(/unknown|raw|not exposed/i);
  });
});
