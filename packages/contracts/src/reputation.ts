import {
  createWalletClient,
  createPublicClient,
  http,
  type Abi,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { ERC8004_ADDRESSES } from "./addresses";
import ReputationRegistryAbi from "../abis/ReputationRegistry.json";

// ERC-8004 Reputation Registry (Base Sepolia): on-chain feedback on an agent.
// giveFeedback(agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)
// The ValidationRegistry portion of ERC-8004 is not deployed anywhere yet
// (spec still under discussion) — only Reputation is wired here.

const abi = ReputationRegistryAbi as unknown as Abi;
const REGISTRY = ERC8004_ADDRESSES.baseSepolia.reputationRegistry as Address;
const ZERO_HASH = `0x${"0".repeat(64)}` as const;

export type FeedbackResult = { txHash: Hash; status: "success" | "reverted" };

/** Leave on-chain feedback on an agent (server/spike path — private key). */
export async function giveFeedback(opts: {
  privateKey: `0x${string}`;
  agentId: bigint;
  /** Score, e.g. 5 with valueDecimals 0 → "5". */
  value: bigint;
  valueDecimals?: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  feedbackURI?: string;
  rpcUrl?: string;
}): Promise<FeedbackResult> {
  const account = privateKeyToAccount(opts.privateKey);
  const transport = http(opts.rpcUrl ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const pub = createPublicClient({ chain: baseSepolia, transport });
  const txHash = await wallet.writeContract({
    address: REGISTRY,
    abi,
    functionName: "giveFeedback",
    args: [
      opts.agentId,
      opts.value,
      opts.valueDecimals ?? 0,
      opts.tag1 ?? "",
      opts.tag2 ?? "",
      opts.endpoint ?? "",
      opts.feedbackURI ?? "",
      ZERO_HASH,
    ],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  return { txHash, status: receipt.status };
}

/** Revoke a feedback entry this wallet previously left. */
export async function revokeFeedback(opts: {
  privateKey: `0x${string}`;
  agentId: bigint;
  feedbackIndex: bigint;
  rpcUrl?: string;
}): Promise<FeedbackResult> {
  const account = privateKeyToAccount(opts.privateKey);
  const transport = http(opts.rpcUrl ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const pub = createPublicClient({ chain: baseSepolia, transport });
  const txHash = await wallet.writeContract({
    address: REGISTRY,
    abi,
    functionName: "revokeFeedback",
    args: [opts.agentId, opts.feedbackIndex],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  return { txHash, status: receipt.status };
}

export type ReputationSummary = { count: bigint; sum: bigint; decimals: number; clients: Address[] };

/**
 * Aggregate feedback for an agent. The contract requires explicit client
 * addresses, so this reads getClients() first; no clients = zero summary.
 */
export async function readSummary(opts: {
  agentId: bigint;
  rpcUrl?: string;
}): Promise<ReputationSummary> {
  const transport = http(opts.rpcUrl ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");
  const pub = createPublicClient({ chain: baseSepolia, transport });
  const clients = (await pub.readContract({
    address: REGISTRY,
    abi,
    functionName: "getClients",
    args: [opts.agentId],
  })) as Address[];
  if (clients.length === 0) return { count: 0n, sum: 0n, decimals: 0, clients };
  const [count, sum, decimals] = (await pub.readContract({
    address: REGISTRY,
    abi,
    functionName: "getSummary",
    args: [opts.agentId, clients, "", ""],
  })) as [bigint, bigint, number];
  return { count, sum, decimals, clients };
}
