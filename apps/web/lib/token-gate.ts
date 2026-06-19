// $LEO token gate (Base mainnet). Access is granted to any wallet that holds the
// token; we check ERC-20 balanceOf. Used both at sign-in (Node) and on every
// request by the edge middleware, so it must work from Vercel's edge runtime.
import { createPublicClient, http, erc20Abi, getAddress } from "viem";
import { base } from "viem/chains";

// $LEO on Base mainnet (18 decimals). Overridable for testing / future moves.
const LEO_TOKEN = (process.env.LEO_TOKEN_ADDRESS ??
  "0xe1458ac40e3856b601d5dfdd1006c643a43c2ba3") as `0x${string}`;

// IMPORTANT: the canonical https://mainnet.base.org returns HTTP 403 from Vercel
// serverless/edge egress IPs, so it can't be used here. These public Base RPCs
// DO answer from the edge (verified live). Tried in order; first success wins —
// resilient to any single endpoint blocking or going down. Prepend your own with
// LEO_RPC_URL (e.g. a keyed Alchemy/Infura endpoint) for production-grade limits.
const DEFAULT_RPCS = [
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
  "https://1rpc.io/base",
];
const RPCS = [
  ...(process.env.LEO_RPC_URL ? [process.env.LEO_RPC_URL] : []),
  ...DEFAULT_RPCS,
];

// Minimum balance (in whole $LEO) required to enter. "0" (default) means "any
// nonzero balance" — i.e. simply holding the token is enough.
const MIN_TOKENS = (process.env.LEO_MIN_BALANCE ?? "0").trim();

/** Minimum balance as raw 18-decimal units; never below 1 wei so "0" still means
 *  "must actually hold some". */
function minRaw(): bigint {
  try {
    const [whole, frac = ""] = MIN_TOKENS.split(".");
    const fracPad = (frac + "0".repeat(18)).slice(0, 18);
    const raw = BigInt(whole || "0") * 10n ** 18n + BigInt(fracPad || "0");
    return raw > 0n ? raw : 1n;
  } catch {
    return 1n;
  }
}

/** $LEO balance for `address`, trying each RPC until one answers. Returns null if
 *  EVERY RPC failed (treated as a transient outage by callers). */
async function leoBalance(address: string): Promise<bigint | null> {
  const owner = getAddress(address);
  for (const rpc of RPCS) {
    try {
      const client = createPublicClient({ chain: base, transport: http(rpc) });
      return (await client.readContract({
        address: LEO_TOKEN,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      })) as bigint;
    } catch {
      // try the next RPC
    }
  }
  return null;
}

/** True when `address` holds at least the minimum $LEO balance on Base mainnet.
 *  Fails CLOSED (false) when the balance is below the floor OR every RPC errored;
 *  an owner-override wallet can still get in via isOwnerWallet at the gate. */
export async function holdsLeo(address: string): Promise<boolean> {
  const bal = await leoBalance(address);
  if (bal === null) return false;
  return bal >= minRaw();
}

export const LEO_TOKEN_ADDRESS = LEO_TOKEN;

/** Explicit owner override: wallets that may always enter regardless of $LEO
 *  balance. Reads ALLOWED_WALLETS but — unlike session.isAllowed — returns FALSE
 *  when the list is empty/unset. It is NEVER an "open to everyone" default, so an
 *  unset env can't silently disable the token gate. */
export function isOwnerWallet(address: string): boolean {
  const raw = (process.env.ALLOWED_WALLETS ?? "").trim();
  if (!raw) return false;
  const set = new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  return set.has(address.toLowerCase());
}
