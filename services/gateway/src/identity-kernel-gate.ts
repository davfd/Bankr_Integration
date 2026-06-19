import type { IdentityEnvelope, IdentityVerdict, Receipt } from "@leonardo/identity-kernel";

export type IdentityKernelContextItem = {
  kind: "retrieved_document" | "memory" | "tool_result" | string;
  text: string;
};

export type IdentityKernelToolCall = {
  name: string;
  args?: unknown;
};

export type IdentityKernelModelResult = {
  text: string;
  requestedTool?: IdentityKernelToolCall;
};

export type IdentityKernelModel = (input: {
  userRequest: string;
  context: IdentityKernelContextItem[];
  constraints: string[];
}) => Promise<IdentityKernelModelResult>;

export type IdentityKernelRuntime = {
  evaluatePrompt: (envelope: IdentityEnvelope) => IdentityVerdict;
  evaluateContext: (envelope: IdentityEnvelope, item: IdentityKernelContextItem) => IdentityVerdict;
  evaluateToolCall: (envelope: IdentityEnvelope, toolCall: IdentityKernelToolCall) => IdentityVerdict;
  evaluateOutput: (envelope: IdentityEnvelope, output: { draft_output: string }) => IdentityVerdict;
};

export type IdentityKernelGateResult = {
  released: boolean;
  output: string;
  final_verdict: IdentityVerdict;
  receipts: Receipt[];
  tool_results: unknown[];
};

function receipt(stage: string, envelope: IdentityEnvelope, verdict: IdentityVerdict): Receipt {
  return {
    stage,
    hash: verdict.receipt_hash,
    agent_id: envelope.agent_id,
    passport_id: envelope.passport_id,
    verdict: verdict.verdict,
    reason: verdict.reason,
  };
}

function isBlocking(verdict: IdentityVerdict): boolean {
  return verdict.verdict === "refuse" || verdict.verdict === "require_human" || verdict.verdict === "ask_clarifying";
}

function missingEvaluator(envelope: IdentityEnvelope, stage: "context" | "tool" | "output", name: string): IdentityVerdict {
  return {
    verdict: "require_human",
    reason: `missing ${name} evaluator; runtime would otherwise be default-open`,
    safe_instruction: `Identity Kernel is misconfigured: missing ${name} evaluator. Stop before ${stage} boundary and require operator repair.`,
    tool_grants: [],
    tool_denials: [],
    active_constraints: [`identity:${envelope.agent_id}`, `passport:${envelope.passport_id}`, `stage:${stage}`, "fail_closed:true"],
    receipt_hash: `missing-${stage}`.padEnd(64, "0").slice(0, 64),
  };
}

export async function runIdentityKernelGatedTurn(input: {
  envelope: IdentityEnvelope;
  context: IdentityKernelContextItem[];
  kernel: IdentityKernelRuntime;
  model: IdentityKernelModel;
  tools?: Record<string, (args: unknown) => Promise<unknown> | unknown>;
}): Promise<IdentityKernelGateResult> {
  const receipts: Receipt[] = [];
  const toolResults: unknown[] = [];

  const promptVerdict = input.kernel.evaluatePrompt(input.envelope);
  receipts.push(receipt("pre_llm", input.envelope, promptVerdict));
  if (isBlocking(promptVerdict)) {
    return { released: false, output: promptVerdict.safe_instruction, final_verdict: promptVerdict, receipts, tool_results: toolResults };
  }

  const admittedContext: IdentityKernelContextItem[] = [];
  for (const item of input.context) {
    if (typeof input.kernel.evaluateContext !== "function") {
      const verdict = missingEvaluator(input.envelope, "context", "context");
      receipts.push(receipt("context", input.envelope, verdict));
      return { released: false, output: verdict.safe_instruction, final_verdict: verdict, receipts, tool_results: toolResults };
    }
    const contextVerdict = input.kernel.evaluateContext(input.envelope, item);
    receipts.push(receipt("context", input.envelope, contextVerdict));
    if (isBlocking(contextVerdict)) {
      return { released: false, output: contextVerdict.safe_instruction, final_verdict: contextVerdict, receipts, tool_results: toolResults };
    }
    if (contextVerdict.verdict !== "transform") admittedContext.push(item);
  }

  const modelResult = await input.model({
    userRequest: input.envelope.user_request,
    context: admittedContext,
    constraints: promptVerdict.active_constraints,
  });

  if (modelResult.requestedTool) {
    if (typeof input.kernel.evaluateToolCall !== "function") {
      const verdict = missingEvaluator(input.envelope, "tool", "tool");
      receipts.push(receipt("tool", input.envelope, verdict));
      return { released: false, output: verdict.safe_instruction, final_verdict: verdict, receipts, tool_results: toolResults };
    }
    const toolVerdict = input.kernel.evaluateToolCall(input.envelope, modelResult.requestedTool);
    receipts.push(receipt("tool", input.envelope, toolVerdict));
    if (isBlocking(toolVerdict)) {
      return { released: false, output: toolVerdict.safe_instruction, final_verdict: toolVerdict, receipts, tool_results: toolResults };
    }
    if (toolVerdict.verdict !== "downgrade_tools") {
      const tool = input.tools?.[modelResult.requestedTool.name];
      if (tool) toolResults.push(await tool(modelResult.requestedTool.args));
    }
  }

  if (typeof input.kernel.evaluateOutput !== "function") {
    const verdict = missingEvaluator(input.envelope, "output", "output");
    receipts.push(receipt("output", input.envelope, verdict));
    return { released: false, output: verdict.safe_instruction, final_verdict: verdict, receipts, tool_results: toolResults };
  }
  const outputVerdict = input.kernel.evaluateOutput(input.envelope, { draft_output: modelResult.text });
  receipts.push(receipt("output", input.envelope, outputVerdict));
  if (isBlocking(outputVerdict)) {
    return { released: false, output: outputVerdict.safe_instruction, final_verdict: outputVerdict, receipts, tool_results: toolResults };
  }

  return {
    released: true,
    output: outputVerdict.verdict === "transform" ? outputVerdict.safe_instruction : modelResult.text,
    final_verdict: outputVerdict,
    receipts,
    tool_results: toolResults,
  };
}
