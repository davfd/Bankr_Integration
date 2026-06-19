import {
  createWalletClient,
  createPublicClient,
  http,
  decodeEventLog,
  type Abi,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { ERC8004_ADDRESSES } from "./addresses";
import IdentityRegistryAbi from "../abis/IdentityRegistry.json";

const abi = IdentityRegistryAbi as unknown as Abi;

export type RegisterResult = {
  txHash: Hash;
  agentId: string | null; // ERC-721 tokenId minted (decimal string)
  owner: Address;
  status: "success" | "reverted";
};

/**
 * Register a real Agent Passport on the ERC-8004 Identity Registry on Base
 * Sepolia. Sends a transaction — requires a funded testnet key. Returns the tx
 * hash + the minted agentId (tokenId), read back from the ERC-721 Transfer log.
 */
export async function registerAgent(opts: {
  privateKey: `0x${string}`;
  agentURI: string;
  rpcUrl?: string;
}): Promise<RegisterResult> {
  const account = privateKeyToAccount(opts.privateKey);
  const transport = http(opts.rpcUrl ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const pub = createPublicClient({ chain: baseSepolia, transport });
  const address = ERC8004_ADDRESSES.baseSepolia.identityRegistry as Address;

  const txHash = await wallet.writeContract({ address, abi, functionName: "register", args: [opts.agentURI] });
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

  return { txHash, agentId, owner: account.address, status: receipt.status };
}
