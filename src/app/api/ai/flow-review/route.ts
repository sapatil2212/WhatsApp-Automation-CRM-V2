import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateFlowForActivation } from "@/lib/flows/validate";
import { callLLM, hasAnyLLMKey, parseJSONFromLLM } from "@/lib/ai/llm";

/**
 * POST /api/ai/flow-review
 *
 * AI-powered "check my flow". Given the current flow (header + nodes),
 * it (1) runs the deterministic activation validator for hard structural
 * errors and (2) asks an LLM to review the conversation design for
 * clarity, dead-ends, tone, and missing fallbacks. Results are merged so
 * hard errors always surface even if the model misses them.
 *
 * Returns a ReviewResult the flow builder renders inline.
 */

interface ReviewCheck {
  id: string;
  label: string;
  passed: boolean;
  severity: "error" | "warning" | "info";
  message: string;
  suggestion?: string;
}

interface ReviewResult {
  passed: boolean;
  score: number;
  summary: string;
  checks: ReviewCheck[];
  improvements: string[];
}

interface FlowHeader {
  name: string;
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
}

interface NodeInput {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasAnyLLMKey()) {
    return NextResponse.json({ error: "AI service not configured" }, { status: 500 });
  }

  let body: { flow?: FlowHeader; nodes?: NodeInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const flow = body.flow;
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  if (!flow) {
    return NextResponse.json({ error: "Missing flow" }, { status: 400 });
  }

  // ---- 1. Deterministic structural validation ----
  const issues = validateFlowForActivation(
    {
      name: flow.name ?? "",
      trigger_type: flow.trigger_type,
      trigger_config: flow.trigger_config ?? {},
      entry_node_id: flow.entry_node_id ?? null,
    },
    nodes,
  );
  const deterministicChecks: ReviewCheck[] = issues.map((i, idx) => ({
    id: `STRUCT_${idx}`,
    label:
      i.scope === "trigger"
        ? "Trigger"
        : i.scope === "node"
          ? `Node: ${i.node_key ?? ""}`
          : "Flow",
    passed: false,
    severity: i.severity,
    message: i.message,
    suggestion: i.field ? `Check the "${i.field}" field.` : undefined,
  }));
  const hasHardErrors = issues.some((i) => i.severity === "error");

  // ---- 2. Build a compact, model-friendly description of the graph ----
  const triggerDesc =
    flow.trigger_type === "keyword"
      ? `keyword (keywords: ${
          Array.isArray((flow.trigger_config as any)?.keywords)
            ? (flow.trigger_config as any).keywords.join(", ") || "NONE SET"
            : "NONE SET"
        })`
      : flow.trigger_type;

  const nodesDesc = nodes
    .map((n) => `  - [${n.node_type}] key="${n.node_key}" config=${JSON.stringify(n.config)}`)
    .join("\n");

  const prompt = `You are an expert WhatsApp conversation designer. Review this automated chat flow for a business and return ONLY valid JSON (no markdown fences, no prose).

## FLOW
Name: ${flow.name || "(unnamed)"}
Trigger: ${triggerDesc}
Entry node: ${flow.entry_node_id || "(not set)"}
Nodes (${nodes.length}):
${nodesDesc || "  (no nodes)"}

## NODE TYPES
start (entry), send_message (text then auto-advance via next_node_key), send_buttons (1-3 buttons, each has next_node_key), send_list (rows, each has next_node_key), collect_input (asks a question, stores answer in var_key, then next_node_key), condition (true_next/false_next), set_tag, handoff (hands to a human), end (terminates).

## CHECKS TO PERFORM (use these exact ids)
1. REACHABILITY - Every node is reachable from the entry node; no orphan nodes.
2. DEAD_ENDS - Every path eventually reaches a handoff or end node (no next_node_key pointing nowhere).
3. TERMINATION - The flow can end gracefully (has at least one handoff or end).
4. CLARITY - Messages are clear, concise, and WhatsApp-friendly.
5. TONE - Tone is warm, professional, and on-brand.
6. INPUT_PROMPTS - collect_input prompts clearly tell the user what to send.
7. BUTTON_LABELS - Button/list labels are short (<=20 chars) and unambiguous.
8. FALLBACK - The flow guides users who reply unexpectedly (or hands off to a human).
9. VALUE - The flow accomplishes a clear goal for the customer (booking, FAQ, capture, etc.).

## OUTPUT JSON SHAPE
{"passed":boolean,"score":0-100,"summary":"one concise sentence","checks":[{"id":"CHECK_ID","label":"short label","passed":boolean,"severity":"error"|"warning"|"info","message":"what you found","suggestion":"how to fix if not passed"}],"improvements":["actionable tip", "..."]}

Scoring: start at 100, deduct 15 per error, 5 per warning. passed=true only if there are zero errors. Be specific and reference node keys. Return 4-9 checks and up to 5 improvements.`;

  const { text, success, debugLogs } = await callLLM(prompt, { maxTokens: 2048 });
  if (!success) {
    return NextResponse.json(
      {
        error:
          "AI review service is busy or unavailable. Please try again in a few seconds.",
        debugLogs,
      },
      { status: 502 },
    );
  }

  const review = parseJSONFromLLM<ReviewResult>(text);
  if (!review || !Array.isArray(review.checks)) {
    return NextResponse.json(
      { error: "AI returned an unexpected format. Please try again." },
      { status: 502 },
    );
  }

  // ---- 3. Merge deterministic structural issues (authoritative) ----
  if (deterministicChecks.length > 0) {
    review.checks = [...deterministicChecks, ...review.checks];
  }

  // Hard structural errors always fail the review and cap the score.
  if (hasHardErrors) {
    review.passed = false;
    const errorCount = review.checks.filter((c) => c.severity === "error").length;
    const warnCount = review.checks.filter((c) => c.severity === "warning").length;
    review.score = Math.max(0, 100 - errorCount * 15 - warnCount * 5);
  }

  if (typeof review.score !== "number") review.score = review.passed ? 90 : 60;
  if (typeof review.summary !== "string") review.summary = "";
  if (!Array.isArray(review.improvements)) review.improvements = [];

  return NextResponse.json(review);
}
