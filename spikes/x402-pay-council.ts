// Real pay-to-use proof: pay $0.05 USDC on Base Sepolia (x402) and get a
// Council verdict back through the metered gateway. Run a gateway with METER on:
//   X402_PAY_TO_ADDRESS=0x... METER=true bun run services/gateway/src/serve.ts
// then (with a USDC-funded key):
//   PLATFORM_TESTNET_PRIVATE_KEY=0x... GATEWAY_URL=http://localhost:8787 bun run spikes/x402-pay-council.ts
import { payForCouncil } from "../packages/contracts/src/x402pay";

const pk = process.env.PLATFORM_TESTNET_PRIVATE_KEY as `0x${string}` | undefined;
if (!pk) {
  console.error("Set PLATFORM_TESTNET_PRIVATE_KEY (key with Base Sepolia USDC + ETH).");
  process.exit(1);
}
const gatewayUrl = process.env.GATEWAY_URL ?? "http://localhost:8787";
const idea = process.env.IDEA ?? "Bind an agent's authority to a revocable name, not its key, with an audit trail.";

console.log(`Paying $0.05 USDC via x402 and calling the Council at ${gatewayUrl}…`);
const r = await payForCouncil({ privateKey: pk, gatewayUrl, idea });
console.log("seat:", r.seat, "| ms:", r.ms);
console.log("--- verdict ---");
console.log(String(r.verdict).slice(0, 900));
