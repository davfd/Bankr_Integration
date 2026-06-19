// M1-A write spike: register a REAL Agent Passport on ERC-8004 (Base Sepolia).
// Needs a funded testnet key. Run:
//   PLATFORM_TESTNET_PRIVATE_KEY=0x... bun run spikes/erc8004-register.ts
import { registerAgent } from "../packages/contracts/src/write";

const pk = process.env.PLATFORM_TESTNET_PRIVATE_KEY as `0x${string}` | undefined;
if (!pk) {
  console.error("Set PLATFORM_TESTNET_PRIVATE_KEY to a funded Base Sepolia key first.");
  process.exit(1);
}

const agentURI = process.env.AGENT_URI ?? "https://www.leonardo-ai.io/agents/demo-passport.json";

console.log("Registering Agent Passport on Base Sepolia…");
const r = await registerAgent({ privateKey: pk, agentURI });
console.log("status :", r.status);
console.log("agentId:", r.agentId ?? "(not decoded)");
console.log("owner  :", r.owner);
console.log("tx     :", r.txHash);
console.log("explorer:", `https://sepolia.basescan.org/tx/${r.txHash}`);
