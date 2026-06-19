import { describe, it, expect } from "vitest";
import { readIdentityRegistryInfo, deployments } from "./client";

// M1-A spike: prove our client + the real ABIs + the canonical Base mainnet
// deployment all work together — a live read against the real ERC-8004
// IdentityRegistry, no key/funds required. Skipped in CI unless a Base RPC is
// configured (avoids a hard network dependency in CI).
const live = process.env.CI && !process.env.BASE_MAINNET_RPC_URL ? describe.skip : describe;

live("ERC-8004 live read · Base mainnet IdentityRegistry", () => {
  it(
    "reads name/symbol/version from the real registry at the canonical address",
    async () => {
      const info = await readIdentityRegistryInfo(deployments.base);
      expect(typeof info.name).toBe("string");
      expect(info.name.length).toBeGreaterThan(0);
      expect(typeof info.symbol).toBe("string");
      expect(info.version.length).toBeGreaterThan(0);
      // eslint-disable-next-line no-console
      console.log(
        `[ERC-8004 @ ${deployments.base.identityRegistry}] name="${info.name}" symbol="${info.symbol}" version="${info.version}"`,
      );
    },
    30_000,
  );
});
