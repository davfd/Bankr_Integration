// Real ERC-8004 Reputation write on Base Sepolia: leave feedback on an agent.
//   PLATFORM_TESTNET_PRIVATE_KEY=0x... bun run spikes/reputation-feedback.ts [agentId]
// Costs a little testnet gas. Not part of CI.
import { giveFeedback, readSummary } from "../packages/contracts/src/reputation";

const pk = process.env.PLATFORM_TESTNET_PRIVATE_KEY as `0x${string}` | undefined;
if (!pk) {
  console.error("Set PLATFORM_TESTNET_PRIVATE_KEY to a funded Base Sepolia key first.");
  process.exit(1);
}
const agentId = BigInt(process.argv[2] ?? "6960"); // our minted Agent Passport

const before = await readSummary({ agentId });
console.log(`before: count=${before.count} sum=${before.sum} decimals=${before.decimals}`);

const r = await giveFeedback({
  privateKey: pk,
  agentId,
  value: 5n,
  tag1: "platform-beta",
  feedbackURI: "https://www.leonardo-ai.io/feedback/spike.json",
});
console.log(`giveFeedback tx: ${r.txHash} (${r.status})`);

const after = await readSummary({ agentId });
console.log(`after:  count=${after.count} sum=${after.sum} decimals=${after.decimals}`);
