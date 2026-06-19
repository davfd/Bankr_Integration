// Local gateway server. Run under bun (so council-cc's TS imports resolve):
//   METER=false bun run src/serve.ts
// Meter defaults ON; disable for local end-to-end testing without payments.
import { createGatewayApp } from "./app";
import { bankrReadinessFromEnv } from "./bankr-readiness";
import { runBankrLiveSmoke } from "./bankr-live-smoke";
import { createBankrApprovalStoreFromEnv } from "./bankr-approval-store";
import { createIdentityKernelHarnessFromEnv } from "./identity-kernel-harness-env";

const identityKernelHarness = createIdentityKernelHarnessFromEnv();
const bankrReadiness = bankrReadinessFromEnv();
const baseMcpRuntime = bankrReadiness.runtime;
const baseMcpApprovalStore = createBankrApprovalStoreFromEnv();

// Payments default OFF for local dev (beta, test mode); set METER=true to gate.
const app = createGatewayApp({
  payTo: (process.env.X402_PAY_TO_ADDRESS as `0x${string}`) || undefined,
  meter: process.env.METER === "true",
  identityKernelHarness,
  baseMcpRuntime,
  baseMcpApprovalStore,
  bankrReadiness: bankrReadiness.receipt,
  bankrLiveSmokeRunner: process.env.BANKR_LIVE_SMOKE_ROUTE_ENABLED === "true" ? () => runBankrLiveSmoke() : undefined,
});

const port = Number(process.env.PORT ?? 8787);

// idleTimeout: Bun closes a connection that sends no bytes for this many seconds
// (default 10). Chat turns can be quiet for longer than that — while the agent
// reasons before its first token, or while a turn waits for the single-bridge
// lock — so without this, slow/queued turns get their connection killed mid-stream
// and return empty. 255 is Bun's max; the SSE heartbeat keeps things flowing well
// under it. eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Bun?.serve({ port, fetch: app.fetch, idleTimeout: 255 });
// eslint-disable-next-line no-console
console.log(`[gateway] http://localhost:${port}  (meter=${process.env.METER === "true"})`);
