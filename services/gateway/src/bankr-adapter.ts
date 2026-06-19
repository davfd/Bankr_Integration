import type { BaseMcpExecutionInput, BaseMcpRuntime } from "./mcp-base";

export type BankrRuntimeEnv = Record<string, string | undefined>;

export type BankrResponseLike = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
};

export type BankrFetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<BankrResponseLike>;

export type BankrRuntimeOptions = {
  apiKey: string;
  apiBaseUrl?: string;
  fetch?: BankrFetchLike;
  enableGovernedWrites?: boolean;
  /** Optional hash-only receipt/attestation endpoint under the Bankr API base URL. Disabled when unset. */
  receiptPublishPath?: string;
  /** Optional x402 payment endpoint under the Bankr API base URL. Requires enableX402Payments=true. */
  x402PaymentPath?: string;
  enableX402Payments?: boolean;
};

function defaultFetch(): BankrFetchLike {
  const fetchFn = (globalThis as { fetch?: BankrFetchLike }).fetch;
  if (!fetchFn) throw new Error("global fetch is not available for Bankr runtime");
  return fetchFn;
}

function cleanBaseUrl(value: string | undefined): string {
  const raw = (value ?? "https://api.bankr.bot").trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("BANKR_API_BASE_URL must be a valid http(s) URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("BANKR_API_BASE_URL must be a valid http(s) URL");
  }
  return parsed.href.replace(/\/+$/, "");
}

function cleanApiPath(value: string | undefined, envName: string): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) throw new Error(`${envName} must be an API path, not a full URL`);
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(normalized) || normalized.includes("..")) {
    throw new Error(`${envName} must be a safe API path`);
  }
  return normalized;
}

function chainName(chainId: unknown): string {
  const n = Number(chainId);
  if (n === 8453) return "base";
  if (n === 84532) return "base-sepolia";
  return Number.isFinite(n) ? String(n) : "base";
}

function lower(value: unknown): string | null {
  const out = String(value ?? "").trim().toLowerCase();
  return out || null;
}

async function parseError(res: BankrResponseLike): Promise<string> {
  const body = res.text ? await res.text().catch(() => "") : "";
  return body ? body.slice(0, 160) : `status ${res.status}`;
}

export function createBankrRuntimeAdapter(opts: BankrRuntimeOptions): BaseMcpRuntime {
  const apiKey = opts.apiKey.trim();
  if (!apiKey) throw new Error("BANKR_API_KEY is required for Bankr runtime");
  const apiBaseUrl = cleanBaseUrl(opts.apiBaseUrl);
  const receiptPublishPath = cleanApiPath(opts.receiptPublishPath, "BANKR_RECEIPT_PUBLISH_PATH");
  const x402PaymentPath = cleanApiPath(opts.x402PaymentPath, "BANKR_X402_PAYMENT_PATH");
  const fetchImpl = opts.fetch ?? defaultFetch();
  const governedWritesEnabled = opts.enableGovernedWrites === true;
  const x402PaymentsEnabled = opts.enableX402Payments === true;

  async function get(path: string): Promise<unknown> {
    const res = await fetchImpl(`${apiBaseUrl}${path}`, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`Bankr request failed: ${await parseError(res)}`);
    return res.json();
  }

  async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetchImpl(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Bankr request failed: ${await parseError(res)}`);
    return res.json();
  }

  function disabledWrite(input: BaseMcpExecutionInput): unknown {
    return {
      provider: "bankr",
      mode: "bankr_governed_writes_disabled",
      executed: false,
      note: "Bankr governed write execution is disabled unless BANKR_GOVERNED_WRITES_ENABLED=true and a passport/kernel/human-approved request reaches this adapter.",
      passport_id: input.session.passport.passport_id,
      receipt_hash: input.receipt.hash,
    };
  }

  return {
    async readWalletState(input: BaseMcpExecutionInput): Promise<unknown> {
      const chain = chainName(input.args.chain_id);
      const bankrWallet = await get("/wallet/me");
      const portfolio = await get(`/wallet/portfolio?chains=${encodeURIComponent(chain)}`);
      return {
        provider: "bankr",
        mode: "read_only",
        source: "bankr_wallet_api",
        wallet: input.session.wallet.toLowerCase(),
        agent_id: input.session.passport.agent_id,
        passport_id: input.session.passport.passport_id,
        agent_wallet: lower(input.args.agent_wallet),
        chain_id: Number(input.args.chain_id),
        chain,
        bankr_wallet: bankrWallet,
        portfolio,
        receipt_hash: input.receipt.hash,
      };
    },

    async payX402Invoice(input: BaseMcpExecutionInput): Promise<unknown> {
      if (!x402PaymentsEnabled || !x402PaymentPath) {
        return {
          provider: "bankr",
          mode: "bankr_x402_disabled",
          executed: false,
          note: "Bankr x402 payment execution is disabled unless BANKR_X402_PAYMENTS_ENABLED=true and BANKR_X402_PAYMENT_PATH is configured server-side.",
          passport_id: input.session.passport.passport_id,
          receipt_hash: input.receipt.hash,
        };
      }
      const recipient = String(input.args.recipient ?? "").trim();
      const amount = String(input.args.amount ?? "").trim();
      const asset = String(input.args.asset ?? "").trim();
      const invoiceUrl = String(input.args.invoice_url ?? "").trim();
      if (!recipient || !amount || !invoiceUrl) throw new Error("recipient, amount, and invoice_url are required for Bankr x402 payment");
      const result = await post(x402PaymentPath, {
        recipient,
        amount,
        ...(asset ? { asset } : {}),
        chain_id: Number(input.args.chain_id),
        invoice_url: invoiceUrl,
        passport_id: input.session.passport.passport_id,
        agent_id: input.session.passport.agent_id,
        wallet: input.session.wallet.toLowerCase(),
        capability: input.manifest.capability,
        policy_receipt_hash: input.receipt.hash,
      });
      const txHash = typeof (result as { txHash?: unknown }).txHash === "string"
        ? (result as { txHash: string }).txHash
        : typeof (result as { hash?: unknown }).hash === "string"
          ? (result as { hash: string }).hash
          : undefined;
      return {
        provider: "bankr",
        mode: "x402_payment",
        endpoint: x402PaymentPath,
        executed: true,
        tx_hash: txHash,
        passport_id: input.session.passport.passport_id,
        chain_id: Number(input.args.chain_id),
        recipient,
        amount,
        ...(asset ? { asset } : {}),
        receipt_hash: input.receipt.hash,
        result,
      };
    },

    async publishReceiptHash(input: BaseMcpExecutionInput): Promise<unknown> {
      if (!receiptPublishPath) {
        return {
          provider: "bankr",
          mode: "bankr_receipt_publish_disabled",
          executed: false,
          note: "Bankr receipt publication is not configured in this adapter slice; set BANKR_RECEIPT_PUBLISH_PATH to enable hash-only receipt attestations.",
          passport_id: input.session.passport.passport_id,
          receipt_hash: input.receipt.hash,
        };
      }
      const receiptHash = String(input.args.receipt_hash ?? "").trim();
      if (!receiptHash) throw new Error("receipt_hash is required for Bankr receipt publication");
      const subject = String(input.args.subject ?? "").trim();
      const result = await post(receiptPublishPath, {
        receipt_hash: receiptHash,
        ...(subject ? { subject } : {}),
        passport_id: input.session.passport.passport_id,
        agent_id: input.session.passport.agent_id,
        wallet: input.session.wallet.toLowerCase(),
        chain_id: Number(input.args.chain_id),
        capability: input.manifest.capability,
        policy_receipt_hash: input.receipt.hash,
      });
      return {
        provider: "bankr",
        mode: "receipt_publish",
        endpoint: receiptPublishPath,
        executed: true,
        passport_id: input.session.passport.passport_id,
        chain_id: Number(input.args.chain_id),
        receipt_hash: receiptHash,
        policy_receipt_hash: input.receipt.hash,
        result,
      };
    },

    async executeApprovedValueMovement(input: BaseMcpExecutionInput): Promise<unknown> {
      if (!governedWritesEnabled) return disabledWrite(input);
      const transfer = await post("/wallet/transfer", {
        tokenAddress: String(input.args.token_address ?? ""),
        recipientAddress: String(input.args.recipient ?? ""),
        amount: String(input.args.amount ?? ""),
        isNativeToken: input.args.is_native_token === true,
      });
      const txHash = typeof (transfer as { txHash?: unknown }).txHash === "string" ? (transfer as { txHash: string }).txHash : undefined;
      return {
        provider: "bankr",
        mode: "governed_write",
        endpoint: "/wallet/transfer",
        executed: true,
        tx_hash: txHash,
        chain_id: Number(input.args.chain_id),
        passport_id: input.session.passport.passport_id,
        receipt_hash: input.receipt.hash,
        result: transfer,
      };
    },

    async executeApprovedAssetExchange(input: BaseMcpExecutionInput): Promise<unknown> {
      if (!governedWritesEnabled) return disabledWrite(input);
      const chain = chainName(input.args.chain_id);
      const swap = await post("/wallet/swap", {
        fromChain: chain,
        fromToken: String(input.args.from_token ?? ""),
        toChain: chain,
        toToken: String(input.args.to_token ?? ""),
        amount: String(input.args.amount ?? ""),
        minBuyAmount: String(input.args.min_buy_amount ?? ""),
      });
      const txHash = typeof (swap as { hash?: unknown }).hash === "string" ? (swap as { hash: string }).hash : undefined;
      return {
        provider: "bankr",
        mode: "governed_write",
        endpoint: "/wallet/swap",
        executed: true,
        tx_hash: txHash,
        chain_id: Number(input.args.chain_id),
        passport_id: input.session.passport.passport_id,
        receipt_hash: input.receipt.hash,
        result: swap,
      };
    },

    async executeApprovedContractOperation(input: BaseMcpExecutionInput): Promise<unknown> {
      if (!governedWritesEnabled) return disabledWrite(input);
      const approval = input.approvedContractOperation;
      if (!approval) {
        return {
          provider: "bankr",
          mode: "missing_approval_record",
          executed: false,
          passport_id: input.session.passport.passport_id,
          receipt_hash: input.receipt.hash,
        };
      }
      const submitted = await post("/wallet/submit", {
        transaction: {
          chainId: approval.transaction.chainId,
          to: approval.transaction.to,
          data: approval.transaction.data,
          value: approval.transaction.value ?? "0x0",
        },
      });
      const txHash = typeof (submitted as { txHash?: unknown }).txHash === "string"
        ? (submitted as { txHash: string }).txHash
        : typeof (submitted as { hash?: unknown }).hash === "string"
          ? (submitted as { hash: string }).hash
          : undefined;
      return {
        provider: "bankr",
        mode: "governed_write",
        endpoint: "/wallet/submit",
        executed: true,
        tx_hash: txHash,
        chain_id: approval.chain_id,
        passport_id: input.session.passport.passport_id,
        approval_id: approval.approval_id,
        calldata_hash: approval.calldata_hash,
        human_approval_receipt: approval.human_approval_receipt,
        receipt_hash: input.receipt.hash,
      };
    },
  };
}

export function createBankrRuntimeFromEnv(env: BankrRuntimeEnv = process.env, fetch?: BankrFetchLike): BaseMcpRuntime | undefined {
  const apiKey = env.BANKR_API_KEY?.trim();
  if (!apiKey) return undefined;
  return createBankrRuntimeAdapter({
    apiKey,
    apiBaseUrl: env.BANKR_API_BASE_URL,
    fetch,
    enableGovernedWrites: env.BANKR_GOVERNED_WRITES_ENABLED === "true",
    receiptPublishPath: env.BANKR_RECEIPT_PUBLISH_PATH,
    x402PaymentPath: env.BANKR_X402_PAYMENT_PATH,
    enableX402Payments: env.BANKR_X402_PAYMENTS_ENABLED === "true",
  });
}
