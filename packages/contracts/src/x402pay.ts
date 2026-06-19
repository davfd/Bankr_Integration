import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { wrapFetchWithPayment } from "x402-fetch";

export type PaidCouncilResult = { seat: string; verdict: string; ms: number };

/**
 * Pay for a Council review end-to-end via x402: hits the gateway's metered
 * route, auto-signs + settles the USDC payment on Base Sepolia, and returns the
 * verdict. Requires a key with a little Base Sepolia USDC (+ ETH for gas).
 */
export async function payForCouncil(opts: {
  privateKey: `0x${string}`;
  gatewayUrl: string;
  idea: string;
  seat?: string;
  rpcUrl?: string;
}): Promise<PaidCouncilResult> {
  const account = privateKeyToAccount(opts.privateKey);
  const wallet = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(opts.rpcUrl ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"),
  });
  // x402-fetch's Signer type is viem-compatible; cast to avoid cross-version friction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payFetch = wrapFetchWithPayment(fetch, wallet as any);
  const res = await payFetch(`${opts.gatewayUrl}/api/council/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idea: opts.idea, seat: opts.seat }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}: ${await res.text()}`);
  return (await res.json()) as PaidCouncilResult;
}
