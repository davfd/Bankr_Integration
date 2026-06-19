import { createPublicClient, http, type Abi, type Address } from "viem";
import { base } from "viem/chains";
import identityAbi from "./abis/IdentityRegistry.json";

// Canonical ERC-8004 Identity Registry on Base.
export const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;

export type RegistryInfo = { name: string; symbol: string; version: string };

/** Read the deterministic, global fields of the live Identity Registry on Base. */
export async function readRegistry(): Promise<RegistryInfo> {
  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_MAINNET_RPC_URL),
  });
  const abi = identityAbi as unknown as Abi;
  const address = IDENTITY_REGISTRY as Address;
  const read = (functionName: string) =>
    client.readContract({ address, abi, functionName }) as Promise<string>;
  const [name, symbol, version] = await Promise.all([read("name"), read("symbol"), read("getVersion")]);
  return { name, symbol, version };
}
