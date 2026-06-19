import { createPublicClient, http, type Abi, type Address, type Chain } from "viem";
import { base, baseSepolia } from "viem/chains";
import identityAbi from "./abis/IdentityRegistry.json";
import type { Erc8004PassportClient } from "./identity-kernel-passport-resolver";

export const ERC8004_IDENTITY_REGISTRIES = {
  base: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  baseSepolia: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
} as const satisfies Record<string, `0x${string}`>;

export type LiveErc8004ReadContractInput = {
  address: Address;
  abi: Abi;
  functionName: "ownerOf" | "tokenURI" | "getAgentWallet";
  args: [bigint];
};

export type LiveErc8004ReadContract = (input: LiveErc8004ReadContractInput) => Promise<unknown> | unknown;
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type LiveErc8004PassportClientOptions = {
  network?: "base" | "baseSepolia";
  registryAddress?: `0x${string}`;
  rpcUrl?: string;
  chain?: Chain;
  readContract?: LiveErc8004ReadContract;
  fetch?: FetchLike;
  ipfsGateway?: string;
};

const abi = identityAbi as unknown as Abi;

function passportTokenId(passportId: string): bigint {
  const trimmed = passportId.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error("passport_id must be a decimal token id");
  return BigInt(trimmed);
}

function defaultChain(network: "base" | "baseSepolia"): Chain {
  return network === "base" ? base : baseSepolia;
}

function defaultRpc(network: "base" | "baseSepolia", explicit?: string): string | undefined {
  if (explicit) return explicit;
  return network === "base" ? process.env.BASE_MAINNET_RPC_URL : process.env.BASE_SEPOLIA_RPC_URL;
}

function defaultReadContract(opts: LiveErc8004PassportClientOptions): LiveErc8004ReadContract {
  const network = opts.network ?? "baseSepolia";
  const chain = opts.chain ?? defaultChain(network);
  const client = createPublicClient({
    chain,
    transport: http(defaultRpc(network, opts.rpcUrl)),
  });
  return (input) => client.readContract(input);
}

function agentRegistryCaip(chain: Chain, address: Address): string {
  return `eip155:${chain.id}:${address}`;
}

function toHttpUrl(uri: string, ipfsGateway: string): string {
  if (uri.startsWith("ipfs://")) {
    const suffix = uri.slice("ipfs://".length).replace(/^\/+/, "");
    const gateway = ipfsGateway.replace(/\/+$/, "");
    return gateway.endsWith("/ipfs") ? `${gateway}/${suffix}` : `${gateway}/ipfs/${suffix}`;
  }
  return uri;
}

function decodeDataJson(uri: string): unknown {
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("malformed data URI");
  const meta = uri.slice(0, comma).toLowerCase();
  const payload = uri.slice(comma + 1);
  const text = meta.endsWith(";base64")
    ? Buffer.from(payload, "base64").toString("utf8")
    : decodeURIComponent(payload);
  return JSON.parse(text) as unknown;
}

async function fetchJson(uri: string, fetchImpl: FetchLike, ipfsGateway: string): Promise<unknown> {
  if (uri.startsWith("data:application/json")) return decodeDataJson(uri);

  const url = toHttpUrl(uri, ipfsGateway);
  if (!url.startsWith("https://")) {
    throw new Error("unsupported passport document URI scheme");
  }
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`passport document fetch failed: ${response.status}`);
  return (await response.json()) as unknown;
}

export function createLiveErc8004PassportClient(opts: LiveErc8004PassportClientOptions = {}): Erc8004PassportClient {
  const network = opts.network ?? "baseSepolia";
  const chain = opts.chain ?? defaultChain(network);
  const address = (opts.registryAddress ?? ERC8004_IDENTITY_REGISTRIES[network]) as Address;
  const readContract = opts.readContract ?? defaultReadContract({ ...opts, chain });
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const ipfsGateway = opts.ipfsGateway ?? "https://ipfs.io/ipfs";

  const read = async (functionName: "ownerOf" | "tokenURI" | "getAgentWallet", passportId: string): Promise<string | null> => {
    const result = await readContract({ address, abi, functionName, args: [passportTokenId(passportId)] });
    return typeof result === "string" && result.trim().length > 0 ? result : null;
  };

  return {
    agentRegistry: agentRegistryCaip(chain, address),
    ownerOf: (passportId) => read("ownerOf", passportId),
    getAgentWallet: (passportId) => read("getAgentWallet", passportId),
    tokenURI: (passportId) => read("tokenURI", passportId),
    fetchPassportDocument: (uri) => fetchJson(uri.trim(), fetchImpl, ipfsGateway),
  };
}
