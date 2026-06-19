import type { IdentityKernelHarnessOptions } from "./app";
import { evaluateContext, evaluateOutput, evaluatePrompt, evaluateToolCall } from "@leonardo/identity-kernel";
import type { IdentityKernelModel } from "./identity-kernel-gate";
import { createErc8004PassportResolver } from "./identity-kernel-passport-resolver";
import { createLiveErc8004PassportClient, type FetchLike, type LiveErc8004ReadContract } from "./identity-kernel-live-passport-client";

export type IdentityKernelHarnessEnv = Record<string, string | undefined>;

export type IdentityKernelHarnessEnvOptions = {
  env?: IdentityKernelHarnessEnv;
  readContract?: LiveErc8004ReadContract;
  fetch?: FetchLike;
  model?: IdentityKernelModel;
  tools?: IdentityKernelHarnessOptions["tools"];
};

function enabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function networkFromEnv(value: string | undefined): "base" | "baseSepolia" {
  if (!value) return "baseSepolia";
  if (value === "base" || value === "baseSepolia") return value;
  throw new Error("IDENTITY_KERNEL_LIVE_NETWORK must be base or baseSepolia");
}

function additionalNetworksFromEnv(value: string | undefined): Array<"base" | "baseSepolia"> {
  if (!value?.trim()) return [];
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => networkFromEnv(item));
}

function uniqueNetworks(primary: "base" | "baseSepolia", additional: Array<"base" | "baseSepolia">): Array<"base" | "baseSepolia"> {
  const out: Array<"base" | "baseSepolia"> = [];
  for (const network of [primary, ...additional]) {
    if (!out.includes(network)) out.push(network);
  }
  return out;
}

function registryFromEnv(value: string | undefined): `0x${string}` | undefined {
  if (!value) return undefined;
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error("IDENTITY_KERNEL_REGISTRY_ADDRESS must be a 0x-prefixed address");
  return value as `0x${string}`;
}

/**
 * Build the optional production/beta Identity Kernel route harness from env.
 *
 * Default is dark: no harness route is registered unless IDENTITY_KERNEL_HARNESS_ENABLED
 * is explicitly true/1, and /api/chat is not guarded unless
 * IDENTITY_KERNEL_CHAT_ENFORCEMENT_ENABLED is explicitly true/1. When enabled,
 * both surfaces resolve the signed wallet session + passport_id through live
 * ERC-8004 ownerOf/tokenURI + document self-identification before constructing
 * the IdentityEnvelope.
 */
export function createIdentityKernelHarnessFromEnv(opts: IdentityKernelHarnessEnvOptions = {}): IdentityKernelHarnessOptions | undefined {
  const env = opts.env ?? process.env;
  const harnessEnabled = enabled(env.IDENTITY_KERNEL_HARNESS_ENABLED);
  const chatEnforcementEnabled = enabled(env.IDENTITY_KERNEL_CHAT_ENFORCEMENT_ENABLED);
  if (!harnessEnabled && !chatEnforcementEnabled) return undefined;

  const primaryNetwork = networkFromEnv(env.IDENTITY_KERNEL_LIVE_NETWORK);
  const networks = uniqueNetworks(primaryNetwork, additionalNetworksFromEnv(env.IDENTITY_KERNEL_ADDITIONAL_LIVE_NETWORKS));
  const primaryRegistryAddress = registryFromEnv(env.IDENTITY_KERNEL_REGISTRY_ADDRESS);
  const resolvers = networks.map((network, index) =>
    createErc8004PassportResolver(
      createLiveErc8004PassportClient({
        network,
        registryAddress: index === 0 ? primaryRegistryAddress : undefined,
        rpcUrl: network === primaryNetwork ? env.IDENTITY_KERNEL_RPC_URL : undefined,
        readContract: opts.readContract,
        fetch: opts.fetch,
      }),
    ),
  );
  const resolvePassport = async (input: { wallet: string; passport_id: string }) => {
    for (const resolver of resolvers) {
      const passport = await resolver(input);
      if (passport) return passport;
    }
    return null;
  };

  return {
    ...(harnessEnabled ? { enabled: true as const } : {}),
    ...(chatEnforcementEnabled ? { enforceChat: true } : {}),
    resolvePassport,
    kernel: { evaluatePrompt, evaluateContext, evaluateToolCall, evaluateOutput },
    model: opts.model,
    tools: opts.tools,
  };
}
