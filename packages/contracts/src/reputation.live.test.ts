import { describe, it, expect } from "vitest";
import { readSummary } from "./reputation";

// Live read against the real Reputation Registry on Base Sepolia. Public RPC,
// read-only. Our platform wallet left feedback on agent #1 (tx 0x451184…dc3b8),
// so the summary must be non-empty and include us among the clients.
describe("ERC-8004 live read · Base Sepolia ReputationRegistry", () => {
  it("agent #1 has feedback, including ours", async () => {
    const s = await readSummary({ agentId: 1n });
    expect(s.count).toBeGreaterThan(0n);
    expect(s.clients.map((c) => c.toLowerCase())).toContain(
      "0xb4b90d033ba1fe07c5e178cc6fce10ab18822ef8",
    );
  }, 30_000);
});
