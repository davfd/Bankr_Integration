import { createPublicClient, http, type Abi, type Address } from "viem";
import { base } from "viem/chains";
import { ERC8004_ADDRESSES, type Erc8004Deployment } from "./addresses";
import IdentityRegistryAbi from "../abis/IdentityRegistry.json";
import ReputationRegistryAbi from "../abis/ReputationRegistry.json";
import ValidationRegistryAbi from "../abis/ValidationRegistry.json";

export const abis = {
  identity: IdentityRegistryAbi as unknown as Abi,
  reputation: ReputationRegistryAbi as unknown as Abi,
  validation: ValidationRegistryAbi as unknown as Abi,
};

export const deployments = ERC8004_ADDRESSES;

const BASE_RPC = () => process.env.BASE_MAINNET_RPC_URL ?? "https://mainnet.base.org";

// Internal (not exported): viem's inferred client type is too large to emit in a
// composite project's .d.ts. Callers use the typed read/write helpers below.
function basePublicClient(rpcUrl: string = BASE_RPC()) {
  return createPublicClient({ chain: base, transport: http(rpcUrl) });
}

/** Read the global, deterministic fields of the Base-mainnet Identity Registry. */
export async function readIdentityRegistryInfo(
  deployment: Erc8004Deployment = ERC8004_ADDRESSES.base,
  rpcUrl?: string,
): Promise<{ name: string; symbol: string; version: string }> {
  const client = basePublicClient(rpcUrl);
  const address = deployment.identityRegistry as Address;
  const read = (functionName: string) =>
    client.readContract({ address, abi: abis.identity, functionName }) as Promise<string>;
  const [name, symbol, version] = await Promise.all([read("name"), read("symbol"), read("getVersion")]);
  return { name, symbol, version };
}
