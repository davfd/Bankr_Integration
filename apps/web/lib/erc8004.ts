import { createPublicClient, decodeEventLog, http, type Abi, type WalletClient } from "viem";
import { base, baseSepolia } from "viem/chains";
import IdentityRegistryAbi from "./abis/IdentityRegistry.json";

// Real, canonical ERC-8004 Identity Registry on Base (0x8004… vanity deploy).
export const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
// Same registry on Base Sepolia — where the testnet passports are minted.
export const IDENTITY_REGISTRY_SEPOLIA = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;

const abi = IdentityRegistryAbi as unknown as Abi;

export type RegistryInfo = { name: string; symbol: string; version: string };

export async function readRegistry(): Promise<RegistryInfo> {
  const client = createPublicClient({ chain: base, transport: http() });
  const [name, symbol, version] = await Promise.all([
    client.readContract({ address: IDENTITY_REGISTRY, abi, functionName: "name" }),
    client.readContract({ address: IDENTITY_REGISTRY, abi, functionName: "symbol" }),
    client.readContract({ address: IDENTITY_REGISTRY, abi, functionName: "getVersion" }),
  ]);
  return { name: name as string, symbol: symbol as string, version: version as string };
}

export type RegisterResult = {
  txHash: `0x${string}`;
  /** Metadata-finalization transaction hash. Null only if the registry receipt did not expose a token id. */
  metadataTxHash: `0x${string}` | null;
  agentId: string | null;
  /** Final self-identifying passport metadata URI used by the Identity Kernel resolver. */
  agentURI: string | null;
};

const ERC8004_REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
const IDENTITY_KERNEL_PROMPT_HASH = "sha256:7cd15ae861aa3a6a011efcb219f6ddf832dcd6923624c82aca71fff7d1dde675";
const BASE_SEPOLIA_AGENT_REGISTRY = `eip155:84532:${IDENTITY_REGISTRY_SEPOLIA}`;
const LEONARDO_PASSPORT_WEB_ENDPOINT = "https://app.leonardo-ai.io/tools/passport";
const LEONARDO_GOVERNED_MCP_ENDPOINT = "https://leo-gw.castorai.ca/mcp/base";
const LEONARDO_PASSPORT_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0a0b12"/><circle cx="256" cy="214" r="116" fill="none" stroke="#6fb6ff" stroke-width="18"/><path d="M144 358c38-54 187-54 224 0" fill="none" stroke="#d7c9a5" stroke-width="20" stroke-linecap="round"/><text x="256" y="452" text-anchor="middle" font-family="serif" font-size="52" fill="#d7c9a5">LEO</text></svg>`,
)}`;

function dataJsonUri(document: Record<string, unknown>): string {
  const json = JSON.stringify(document);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:application/json;base64,${globalThis.btoa(binary)}`;
}

function jsonAgentId(passportId: string): number | string {
  if (!/^\d+$/.test(passportId)) return passportId;
  const n = Number(passportId);
  return Number.isSafeInteger(n) && n >= 0 && BigInt(n) === BigInt(passportId) ? n : passportId;
}

function erc8004Services() {
  return [
    { name: "web", endpoint: LEONARDO_PASSPORT_WEB_ENDPOINT },
    {
      name: "MCP",
      endpoint: LEONARDO_GOVERNED_MCP_ENDPOINT,
      version: "2025-06-18",
      capabilities: ["tools"],
      description: "Passport-governed Base MCP endpoint; requires a scoped MCP token and Identity Kernel verdict.",
    },
  ];
}

function accountAddress(account: NonNullable<WalletClient["account"]>): `0x${string}` {
  return (typeof account === "string" ? account : account.address) as `0x${string}`;
}

export function buildAgentPassportDataUri(input: { passportId: string; owner: string }): string {
  const passportId = input.passportId.trim();
  const owner = input.owner.trim().toLowerCase();
  const doc = {
    type: ERC8004_REGISTRATION_TYPE,
    passport_id: passportId,
    agent_id: `leonardo-agent-${passportId}`,
    name: `Leonardo Agent Passport #${passportId}`,
    description:
      "Self-identifying Base Sepolia Agent Passport metadata for Leonardo's Identity Kernel beta. This is an accountability envelope, not a universal safety guarantee.",
    image: LEONARDO_PASSPORT_IMAGE,
    services: erc8004Services(),
    active_system_prompt_hash: IDENTITY_KERNEL_PROMPT_HASH,
    authority_scope: ["answer", "search", "summarize"],
    risk_context: "public_chat",
    protocol: "leonardo-identity-kernel-v0",
    owner_wallet: owner,
    network: "base-sepolia",
    registry: IDENTITY_REGISTRY_SEPOLIA,
    x402Support: false,
    active: true,
    registrations: [{ agentId: jsonAgentId(passportId), agentRegistry: BASE_SEPOLIA_AGENT_REGISTRY }],
    supportedTrust: ["identity-kernel", "passport-governed-mcp", "receipt-hash"],
  };
  return dataJsonUri(doc);
}

function buildProvisionalAgentUri(owner: string): string {
  return dataJsonUri({
    type: ERC8004_REGISTRATION_TYPE,
    passport_id: "pending",
    agent_id: "leonardo-agent-pending",
    name: "Leonardo Agent Passport — pending metadata finalization",
    description: "Temporary ERC-8004 URI used only until the wallet signs setAgentURI with the exact minted token id.",
    image: LEONARDO_PASSPORT_IMAGE,
    services: erc8004Services(),
    owner_wallet: owner.trim().toLowerCase(),
    protocol: "leonardo-identity-kernel-v0",
    x402Support: false,
    active: false,
    registrations: [],
    supportedTrust: ["identity-kernel", "passport-governed-mcp", "receipt-hash"],
  });
}

/**
 * Mint an Agent Passport from the user's connected wallet (Base Sepolia), then
 * immediately set the tokenURI to self-identifying data JSON containing the
 * exact minted token id. The second wallet signature is what makes a fresh mint
 * resolvable by the Identity Kernel without waiting for a separate metadata host.
 */
export async function registerAgentFromWallet(
  walletClient: WalletClient,
  provisionalAgentURI?: string,
): Promise<RegisterResult> {
  const account = walletClient.account as NonNullable<WalletClient["account"]> | undefined;
  if (!account) throw new Error("No wallet account connected.");
  const owner = accountAddress(account);
  const txHash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY_SEPOLIA,
    abi,
    functionName: "register",
    args: [provisionalAgentURI ?? buildProvisionalAgentUri(owner)],
    account,
    chain: baseSepolia,
  });
  const pub = createPublicClient({ chain: baseSepolia, transport: http() });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  let agentId: string | null = null;
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (ev.eventName === "Transfer") {
        const args = ev.args as unknown as { tokenId?: bigint };
        if (args.tokenId !== undefined) {
          agentId = args.tokenId.toString();
          break;
        }
      }
    } catch {
      // not a Transfer log from this ABI — skip
    }
  }

  if (!agentId) return { txHash, metadataTxHash: null, agentId, agentURI: null };

  const finalAgentURI = buildAgentPassportDataUri({ passportId: agentId, owner });
  const metadataTxHash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY_SEPOLIA,
    abi,
    functionName: "setAgentURI",
    args: [BigInt(agentId), finalAgentURI],
    account,
    chain: baseSepolia,
  });
  await pub.waitForTransactionReceipt({ hash: metadataTxHash });

  return { txHash, metadataTxHash, agentId, agentURI: finalAgentURI };
}

/** Best-effort list of the wallet's existing agent IDs (Transfer→to logs). */
export async function listMyAgents(address: `0x${string}`): Promise<string[]> {
  const pub = createPublicClient({ chain: baseSepolia, transport: http() });
  try {
    const logs = await pub.getLogs({
      address: IDENTITY_REGISTRY_SEPOLIA,
      event: {
        type: "event",
        name: "Transfer",
        inputs: [
          { indexed: true, name: "from", type: "address" },
          { indexed: true, name: "to", type: "address" },
          { indexed: true, name: "tokenId", type: "uint256" },
        ],
      },
      args: { to: address },
      fromBlock: "earliest",
      toBlock: "latest",
    });
    const ids = new Set<string>();
    for (const l of logs) {
      const tid = (l as unknown as { args?: { tokenId?: bigint } }).args?.tokenId;
      if (tid !== undefined) ids.add(tid.toString());
    }
    return [...ids];
  } catch {
    return []; // public RPCs often cap log ranges; the mint result is the primary signal
  }
}
