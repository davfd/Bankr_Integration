import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { resolveErc8004Passport } from "./identity-kernel-passport-resolver";
import { createLiveErc8004PassportClient } from "./identity-kernel-live-passport-client";

const runLive = process.env.IDENTITY_KERNEL_RUN_LIVE_PASSPORT_SMOKE === "1";
const liveDescribe = runLive ? describe : describe.skip;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function differentWallet(owner: string): string {
  const lower = owner.toLowerCase();
  const candidate = "0x0000000000000000000000000000000000000001";
  return lower === candidate ? "0x0000000000000000000000000000000000000002" : candidate;
}

liveDescribe("Identity Kernel live ERC-8004 passport resolver smoke", () => {
  it("reads a live registry owner/tokenURI and fails closed for the wrong wallet", async () => {
    const passportId = process.env.IDENTITY_KERNEL_LIVE_PASSPORT_ID ?? "6960";
    const network = (process.env.IDENTITY_KERNEL_LIVE_NETWORK ?? "baseSepolia") as "base" | "baseSepolia";
    const client = createLiveErc8004PassportClient({ network });

    const owner = await client.ownerOf(passportId);
    const tokenURI = await client.tokenURI(passportId);
    expect(owner).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(tokenURI).toEqual(expect.any(String));

    const wrongWalletResult = await resolveErc8004Passport({ wallet: differentWallet(owner!), passport_id: passportId, client });
    expect(wrongWalletResult).toBeNull();

    let documentFetch: "ok" | "failed" = "failed";
    let documentFetchReason: string | null = null;
    try {
      await client.fetchPassportDocument(tokenURI!);
      documentFetch = "ok";
    } catch (err) {
      documentFetchReason = err instanceof Error ? err.message : String(err);
    }

    let correctWalletStatus: "verified" | "incomplete" = "incomplete";
    let correctWalletReason: string | null = null;
    const resolved = await resolveErc8004Passport({ wallet: owner!, passport_id: passportId, client });
    if (resolved) correctWalletStatus = "verified";
    else correctWalletReason = documentFetchReason ?? "passport document missing required self-identifying fields";

    const receipt = {
      status: correctWalletStatus,
      network,
      passport_id: passportId,
      owner,
      token_uri_scheme: tokenURI!.split(":", 1)[0],
      token_uri_sha256: sha256(tokenURI!),
      document_fetch: documentFetch,
      document_fetch_reason: documentFetchReason,
      wrong_wallet_fails_closed: wrongWalletResult === null,
      correct_wallet_reason: correctWalletReason,
      boundary: "live ownerOf/tokenURI read only; production route enforcement not claimed",
    };
    console.log(`[identity-kernel-live-passport-smoke] ${JSON.stringify(receipt)}`);
  }, 30_000);
});
