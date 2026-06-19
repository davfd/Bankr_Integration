import { createPublicClient, createWalletClient, http, type Abi, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { grantUpdateExecutionGuard, summarizeGrantUpdatePlan, validateReadOnlyGrantDocument } from "./identity-kernel-passport-grant-update";

const NETWORKS = ["base", "baseSepolia"] as const;
type Network = (typeof NETWORKS)[number];

const REGISTRIES: Record<Network, `0x${string}`> = {
  base: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  baseSepolia: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
};

const READ_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const satisfies Abi;

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

function envOrArg(envName: string, argName: string): string | undefined {
  return arg(argName) ?? process.env[envName];
}

function networkFromInput(value: string | undefined): Network {
  if (!value) return "baseSepolia";
  if ((NETWORKS as readonly string[]).includes(value)) return value as Network;
  throw new Error(`unsupported network: ${value}`);
}

function signerAddressFromEnv(): { address?: string; account?: ReturnType<typeof privateKeyToAccount>; error?: string; present: boolean } {
  const raw = process.env.PASSPORT_GRANT_UPDATE_SIGNER_PRIVATE_KEY?.trim();
  if (!raw) return { present: false };
  try {
    const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
    const account = privateKeyToAccount(normalized as `0x${string}`);
    return { present: true, address: account.address, account };
  } catch {
    return { present: true, error: "invalid_signer_private_key" };
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/0x[a-fA-F0-9]{40,}/g, "[REDACTED]") : "unknown error";
}

function chainFor(network: Network) {
  return network === "base" ? base : baseSepolia;
}

function rpcFor(network: Network): string | undefined {
  return network === "base" ? process.env.BASE_MAINNET_RPC_URL : process.env.BASE_SEPOLIA_RPC_URL;
}

function toHttpUrl(uri: string): string {
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length).replace(/^\/+/, "")}`;
  return uri;
}

function decodeDataJson(uri: string): unknown {
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("malformed data URI");
  const meta = uri.slice(0, comma).toLowerCase();
  const payload = uri.slice(comma + 1);
  const text = meta.endsWith(";base64") ? Buffer.from(payload, "base64").toString("utf8") : decodeURIComponent(payload);
  return JSON.parse(text) as unknown;
}

async function fetchPassportDocument(uri: string): Promise<unknown> {
  if (uri.startsWith("data:application/json")) return decodeDataJson(uri);
  const url = toHttpUrl(uri);
  if (!url.startsWith("https://")) throw new Error("unsupported passport document URI scheme");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`passport document fetch failed: ${response.status}`);
  return (await response.json()) as unknown;
}

async function main(): Promise<void> {
  const passportId = envOrArg("PASSPORT_GRANT_UPDATE_PASSPORT_ID", "passport-id") ?? envOrArg("BANKR_LIVE_SMOKE_PASSPORT_ID", "smoke-passport-id");
  if (!passportId?.trim()) {
    console.log(JSON.stringify({ status: "blocked_missing_passport_id", required_env: ["PASSPORT_GRANT_UPDATE_PASSPORT_ID"] }, null, 2));
    return;
  }

  const network = networkFromInput(envOrArg("PASSPORT_GRANT_UPDATE_NETWORK", "network"));
  const expiresAt = envOrArg("PASSPORT_GRANT_UPDATE_EXPIRES_AT", "expires-at");
  const signer = signerAddressFromEnv();
  if (signer.error) {
    console.log(JSON.stringify({ status: "blocked_invalid_signer_key", signer_redacted: true, error: signer.error }, null, 2));
    return;
  }

  const client = createPublicClient({ chain: chainFor(network), transport: http(rpcFor(network)) });
  const tokenId = BigInt(passportId);
  const registry = REGISTRIES[network] as Address;
  const owner = await client.readContract({ address: registry, abi: READ_ABI, functionName: "ownerOf", args: [tokenId] });
  const tokenURI = await client.readContract({ address: registry, abi: READ_ABI, functionName: "tokenURI", args: [tokenId] });
  if (typeof owner !== "string" || typeof tokenURI !== "string") {
    console.log(JSON.stringify({ status: "blocked_passport_read_failed", passport_id: passportId, network, owner_redacted: true, token_uri_redacted: true }, null, 2));
    return;
  }

  const document = await fetchPassportDocument(tokenURI);
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    console.log(JSON.stringify({ status: "blocked_passport_document_invalid", passport_id: passportId, network, owner_redacted: true, token_uri_redacted: true }, null, 2));
    return;
  }

  const summary = summarizeGrantUpdatePlan({
    passportId,
    currentDocument: document as Record<string, unknown>,
    ownerAddress: owner,
    signerAddress: signer.address,
    registryAddress: registry,
    chainId: chainFor(network).id,
    expiresAt,
  });

  const safeTransaction = summary.transaction
    ? process.env.PASSPORT_GRANT_UPDATE_SHOW_CALLDATA === "1"
      ? summary.transaction
      : { ...summary.transaction, data: "[REDACTED]", data_redacted: true }
    : undefined;

  const executeRequested = envOrArg("PASSPORT_GRANT_UPDATE_EXECUTE", "execute") === "1";
  const acknowledgedMetadataMutation = envOrArg("PASSPORT_GRANT_UPDATE_ACK_METADATA_MUTATION", "ack-metadata-mutation") === "1";
  const executionGuard = grantUpdateExecutionGuard({ planStatus: summary.status, executeRequested, acknowledgedMetadataMutation });

  const baseReceipt = {
    ...summary,
    transaction: safeTransaction,
    execution_guard: executionGuard,
    network,
    signer_private_key_present: signer.present,
    owner_redacted: true,
    token_uri_redacted: true,
    raw_document_redacted: true,
  };

  if (!executeRequested || !executionGuard.ok) {
    console.log(JSON.stringify(baseReceipt, null, 2));
    return;
  }

  if (!signer.account || !summary.transaction) {
    console.log(JSON.stringify({ ...baseReceipt, status: "blocked_missing_signer_account" }, null, 2));
    return;
  }

  const wallet = createWalletClient({ account: signer.account, chain: chainFor(network), transport: http(rpcFor(network)) });
  const hash = await wallet.sendTransaction({
    account: signer.account,
    chain: chainFor(network),
    to: summary.transaction.to as Address,
    data: summary.transaction.data,
    value: 0n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const postTokenURI = await client.readContract({ address: registry, abi: READ_ABI, functionName: "tokenURI", args: [tokenId] });
  const postDocument = typeof postTokenURI === "string" ? await fetchPassportDocument(postTokenURI) : null;
  const postValidation = postDocument && typeof postDocument === "object" && !Array.isArray(postDocument)
    ? validateReadOnlyGrantDocument(postDocument as Record<string, unknown>)
    : { ok: false, issues: ["post_document_unreadable"] };

  console.log(JSON.stringify({
    ...baseReceipt,
    status: "metadata_update_confirmed",
    tx_hash: hash,
    tx_status: receipt.status,
    post_readback: {
      token_uri_redacted: true,
      raw_document_redacted: true,
      validation_ok: postValidation.ok,
      issues: postValidation.issues,
    },
  }, null, 2));
}

main().catch((error) => {
  console.log(JSON.stringify({ status: "blocked_exception", error: safeError(error) }, null, 2));
  process.exitCode = 1;
});
