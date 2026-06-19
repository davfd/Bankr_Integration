import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  decodeEventLog: vi.fn(),
  http: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock("viem", () => ({
  createPublicClient: mocks.createPublicClient,
  decodeEventLog: mocks.decodeEventLog,
  http: mocks.http,
}));

vi.mock("viem/chains", () => ({
  base: { id: 8453, name: "Base" },
  baseSepolia: { id: 84532, name: "Base Sepolia" },
}));

import { buildAgentPassportDataUri, registerAgentFromWallet } from "./erc8004";

function decodeDataJson(uri: string): Record<string, unknown> {
  expect(uri.startsWith("data:application/json;base64,")).toBe(true);
  return JSON.parse(Buffer.from(uri.slice("data:application/json;base64,".length), "base64").toString("utf8")) as Record<string, unknown>;
}

describe("Agent Passport metadata", () => {
  it("builds a self-identifying data URI that the Identity Kernel resolver can bind to a passport id", () => {
    const uri = buildAgentPassportDataUri({
      passportId: "4242",
      owner: "0xAaBbCc0000000000000000000000000000000000",
    });

    const doc = decodeDataJson(uri);
    expect(doc).toMatchObject({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      passport_id: "4242",
      agent_id: "leonardo-agent-4242",
      name: "Leonardo Agent Passport #4242",
      active_system_prompt_hash: "sha256:7cd15ae861aa3a6a011efcb219f6ddf832dcd6923624c82aca71fff7d1dde675",
      risk_context: "public_chat",
      protocol: "leonardo-identity-kernel-v0",
      owner_wallet: "0xaabbcc0000000000000000000000000000000000",
      network: "base-sepolia",
      x402Support: false,
      active: true,
    });
    expect(typeof doc.image).toBe("string");
    expect(String(doc.image)).toMatch(/^data:image\/svg\+xml/);
    expect(doc.authority_scope).toEqual(expect.arrayContaining(["answer", "search", "summarize"]));
    expect(doc.supportedTrust).toEqual(expect.arrayContaining(["identity-kernel", "passport-governed-mcp", "receipt-hash"]));
    expect(doc.registrations).toEqual([
      {
        agentId: 4242,
        agentRegistry: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
      },
    ]);
    expect(doc.services).toEqual(
      expect.arrayContaining([
        { name: "web", endpoint: "https://app.leonardo-ai.io/tools/passport" },
        expect.objectContaining({ name: "MCP", endpoint: "https://leo-gw.castorai.ca/mcp/base" }),
      ]),
    );
    expect(doc).not.toHaveProperty("endpoints");
  });

  it("after mint, updates the ERC-8004 tokenURI to exact passport metadata and returns both tx hashes", async () => {
    mocks.createPublicClient.mockReturnValue({ waitForTransactionReceipt: mocks.waitForTransactionReceipt });
    mocks.waitForTransactionReceipt.mockResolvedValueOnce({ logs: [{ data: "0x", topics: [] }] });
    mocks.waitForTransactionReceipt.mockResolvedValueOnce({ logs: [] });
    mocks.decodeEventLog.mockReturnValueOnce({ eventName: "Transfer", args: { tokenId: 4242n } });

    const writes: Array<{ functionName: string; args: unknown[] }> = [];
    const walletClient = {
      account: { address: "0xAaBbCc0000000000000000000000000000000000" },
      writeContract: vi.fn(async (input: { functionName: string; args: unknown[] }) => {
        writes.push(input);
        return writes.length === 1 ? "0xregister" : "0xmetadata";
      }),
    };

    const result = await registerAgentFromWallet(walletClient as never);

    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({ functionName: "register" });
    expect(writes[1]?.functionName).toBe("setAgentURI");
    expect(writes[1]?.args[0]).toBe(4242n);
    const finalUri = String(writes[1]?.args[1]);
    expect(decodeDataJson(finalUri)).toMatchObject({
      passport_id: "4242",
      agent_id: "leonardo-agent-4242",
      owner_wallet: "0xaabbcc0000000000000000000000000000000000",
    });
    expect(result).toEqual({ txHash: "0xregister", metadataTxHash: "0xmetadata", agentId: "4242", agentURI: finalUri });
  });
});
