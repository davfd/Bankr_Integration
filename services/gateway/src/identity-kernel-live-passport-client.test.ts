import { describe, expect, it } from "vitest";
import { resolveErc8004Passport } from "./identity-kernel-passport-resolver";
import { createLiveErc8004PassportClient } from "./identity-kernel-live-passport-client";

const TEST_WALLET = "0xabc0000000000000000000000000000000000001";

function passportDocument(passportId = "42") {
  return {
    passport_id: passportId,
    agent_id: "gabriel",
    active_system_prompt_hash: "sha256:gabriel-seed",
    authority_scope: ["answer", "search"],
    risk_context: "public_chat",
  };
}

describe("Identity Kernel live ERC-8004 passport client", () => {
  it("reads ownerOf and tokenURI from the configured registry using the decimal passport id", async () => {
    const calls: Array<{ functionName: string; args: unknown[] }> = [];
    const client = createLiveErc8004PassportClient({
      registryAddress: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      readContract: async ({ functionName, args }) => {
        calls.push({ functionName, args });
        return functionName === "ownerOf" ? TEST_WALLET : "data:application/json;base64,e30=";
      },
      fetch: async () => new Response(JSON.stringify(passportDocument()), { status: 200 }),
    });

    await expect(client.ownerOf("42")).resolves.toBe(TEST_WALLET);
    await expect(client.tokenURI("42")).resolves.toBe("data:application/json;base64,e30=");
    expect(calls).toEqual([
      { functionName: "ownerOf", args: [42n] },
      { functionName: "tokenURI", args: [42n] },
    ]);
  });

  it("exposes the ERC-8004 agentWallet from the configured registry", async () => {
    const calls: Array<{ functionName: string; args: unknown[] }> = [];
    const client = createLiveErc8004PassportClient({
      registryAddress: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      readContract: async ({ functionName, args }) => {
        calls.push({ functionName, args });
        return "0xCccc000000000000000000000000000000000003";
      },
      fetch: async () => new Response("should not be used", { status: 500 }),
    });

    await expect(client.getAgentWallet?.("42")).resolves.toBe("0xCccc000000000000000000000000000000000003");
    expect(client.agentRegistry).toBe("eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e");
    expect(calls).toEqual([{ functionName: "getAgentWallet", args: [42n] }]);
  });

  it("decodes data-URI passport documents without network fetch", async () => {
    let fetchCalls = 0;
    const encoded = Buffer.from(JSON.stringify(passportDocument("7")), "utf8").toString("base64");
    const client = createLiveErc8004PassportClient({
      readContract: async () => TEST_WALLET,
      fetch: async () => {
        fetchCalls += 1;
        return new Response("should not be used", { status: 500 });
      },
    });

    await expect(client.fetchPassportDocument(`data:application/json;base64,${encoded}`)).resolves.toEqual(passportDocument("7"));
    expect(fetchCalls).toBe(0);
  });

  it("fetches https passport documents and rejects non-OK responses", async () => {
    const fetched: string[] = [];
    const client = createLiveErc8004PassportClient({
      readContract: async () => TEST_WALLET,
      fetch: async (url) => {
        fetched.push(url.toString());
        return new Response(JSON.stringify(passportDocument()), { status: 200 });
      },
    });

    await expect(client.fetchPassportDocument("https://example.test/passport.json")).resolves.toEqual(passportDocument());
    expect(fetched).toEqual(["https://example.test/passport.json"]);

    const failing = createLiveErc8004PassportClient({
      readContract: async () => TEST_WALLET,
      fetch: async () => new Response("missing", { status: 404 }),
    });
    await expect(failing.fetchPassportDocument("https://example.test/missing.json")).rejects.toThrow("passport document fetch failed: 404");
  });

  it("rejects plain-http passport documents before fetch", async () => {
    let fetchCalls = 0;
    const client = createLiveErc8004PassportClient({
      readContract: async () => TEST_WALLET,
      fetch: async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify(passportDocument()), { status: 200 });
      },
    });

    await expect(client.fetchPassportDocument("http://example.test/passport.json")).rejects.toThrow("unsupported passport document URI scheme");
    expect(fetchCalls).toBe(0);
  });

  it("maps ipfs passport documents through the configured gateway", async () => {
    const fetched: string[] = [];
    const client = createLiveErc8004PassportClient({
      ipfsGateway: "https://gateway.example/ipfs/",
      readContract: async () => TEST_WALLET,
      fetch: async (url) => {
        fetched.push(url.toString());
        return new Response(JSON.stringify(passportDocument()), { status: 200 });
      },
    });

    await expect(client.fetchPassportDocument("ipfs://bafkreiabc/path/passport.json")).resolves.toEqual(passportDocument());
    expect(fetched).toEqual(["https://gateway.example/ipfs/bafkreiabc/path/passport.json"]);
  });

  it("composes with the resolver so a live client output still requires document self-identification", async () => {
    const encoded = Buffer.from(JSON.stringify(passportDocument("42")), "utf8").toString("base64");
    const client = createLiveErc8004PassportClient({
      readContract: async ({ functionName }) => (functionName === "ownerOf" ? TEST_WALLET : `data:application/json;base64,${encoded}`),
      fetch: async () => new Response("should not be used", { status: 500 }),
    });

    await expect(resolveErc8004Passport({ wallet: TEST_WALLET, passport_id: "42", client })).resolves.toEqual({
      agent_id: "gabriel",
      passport_id: "42",
      active_system_prompt_hash: "sha256:gabriel-seed",
      authority_scope: ["answer", "search"],
      risk_context: "public_chat",
    });

    const forged = Buffer.from(JSON.stringify(passportDocument("forged-43")), "utf8").toString("base64");
    const forgedClient = createLiveErc8004PassportClient({
      readContract: async ({ functionName }) => (functionName === "ownerOf" ? TEST_WALLET : `data:application/json;base64,${forged}`),
      fetch: async () => new Response("should not be used", { status: 500 }),
    });
    await expect(resolveErc8004Passport({ wallet: TEST_WALLET, passport_id: "42", client: forgedClient })).resolves.toBeNull();
  });
});
