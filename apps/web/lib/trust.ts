import { createPublicClient, http, type Abi, type Address, type WalletClient } from "viem";
import { baseSepolia } from "viem/chains";
import ReputationRegistryAbi from "./abis/ReputationRegistry.json";

// ERC-8004 Reputation Registry on Base Sepolia — the live Trust Registry rail.
// (Validation Registry isn't deployed anywhere yet; spec still in discussion.)
export const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;

const abi = ReputationRegistryAbi as unknown as Abi;
const ZERO_HASH = `0x${"0".repeat(64)}` as const;

function pub() {
  return createPublicClient({ chain: baseSepolia, transport: http() });
}

export type AgentReputation = {
  count: number;
  /** Average score (sum/count scaled by decimals), null when no feedback. */
  average: number | null;
  clients: number;
  recent: { client: string; value: number; tag: string; revoked: boolean }[];
};

/** Read an agent's on-chain reputation: summary + recent feedback entries. */
export async function readAgentReputation(agentId: bigint): Promise<AgentReputation> {
  const client = pub();
  const clients = (await client.readContract({
    address: REPUTATION_REGISTRY,
    abi,
    functionName: "getClients",
    args: [agentId],
  })) as Address[];
  if (clients.length === 0) return { count: 0, average: null, clients: 0, recent: [] };

  const [count, sum, decimals] = (await client.readContract({
    address: REPUTATION_REGISTRY,
    abi,
    functionName: "getSummary",
    args: [agentId, clients, "", ""],
  })) as [bigint, bigint, number];

  const [addrs, , values, valueDecimals, tag1s, , revoked] = (await client.readContract({
    address: REPUTATION_REGISTRY,
    abi,
    functionName: "readAllFeedback",
    args: [agentId, clients, "", "", true],
  })) as [Address[], bigint[], bigint[], number[], string[], string[], boolean[]];

  const recent = addrs
    .map((a, i) => ({
      client: a,
      value: Number(values[i] ?? 0n) / 10 ** (valueDecimals[i] ?? 0),
      tag: tag1s[i] ?? "",
      revoked: revoked[i] ?? false,
    }))
    .slice(-8)
    .reverse();

  const average = count > 0n ? Number(sum) / 10 ** decimals / Number(count) : null;
  return { count: Number(count), average, clients: clients.length, recent };
}

/** Leave 0–5 feedback on an agent from the connected wallet (not your own agent). */
export async function giveFeedbackFromWallet(
  walletClient: WalletClient,
  opts: { agentId: bigint; score: number; tag?: string },
): Promise<`0x${string}`> {
  const account = walletClient.account;
  if (!account) throw new Error("No wallet account connected.");
  const score = Math.max(0, Math.min(5, Math.round(opts.score)));
  const txHash = await walletClient.writeContract({
    address: REPUTATION_REGISTRY,
    abi,
    functionName: "giveFeedback",
    args: [opts.agentId, BigInt(score), 0, opts.tag ?? "leonardo-platform", "", "", "", ZERO_HASH],
    account,
    chain: baseSepolia,
  });
  await pub().waitForTransactionReceipt({ hash: txHash });
  return txHash;
}
