"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Lightbulb,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

/**
 * AI "check my flow" panel. Sends the current in-memory flow to
 * /api/ai/flow-review and renders a scored review with per-check
 * findings and improvement tips. Purely advisory — it never blocks
 * saving or activation (that's the deterministic validator's job).
 */
export function AiCheckPanel({
  flow,
  nodes,
}: {
  flow: FlowHeader;
  nodes: NodeInput[];
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);

  async function runCheck() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/ai/flow-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow, nodes }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? `AI check failed: ${res.status}`);
      }
      setResult(json as ReviewResult);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI check failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-4 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">AI flow check</h3>
            <p className="text-[11px] text-slate-400">
              Let AI review the whole conversation for dead-ends, clarity, and tone.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={runCheck} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analyzing…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              {result ? "Re-run AI check" : "Run AI check"}
            </>
          )}
        </Button>
      </div>

      {result && (
        <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
          {/* Score + summary */}
          <div className="flex items-start gap-3">
            <ScoreBadge score={result.score} passed={result.passed} />
            <p className="flex-1 text-xs leading-relaxed text-slate-300">
              {result.summary}
            </p>
          </div>

          {/* Checks */}
          <ul className="space-y-1.5">
            {result.checks.map((c, i) => (
              <li
                key={`${c.id}-${i}`}
                className="flex items-start gap-2 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2"
              >
                <CheckIcon passed={c.passed} severity={c.severity} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-200">
                      {c.label}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-400">
                    {c.message}
                  </p>
                  {!c.passed && c.suggestion && (
                    <p className="mt-1 text-[11px] leading-relaxed text-primary/90">
                      → {c.suggestion}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* Improvements */}
          {result.improvements.length > 0 && (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-primary">
                <Lightbulb className="h-3.5 w-3.5" />
                Suggested improvements
              </div>
              <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-slate-300">
                {result.improvements.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreBadge({ score, passed }: { score: number; passed: boolean }) {
  const color = passed
    ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-300"
    : score >= 60
      ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
      : "border-red-600/40 bg-red-500/10 text-red-300";
  return (
    <div
      className={cn(
        "flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border text-center",
        color,
      )}
    >
      <span className="text-sm font-bold leading-none">{score}</span>
      <span className="text-[8px] uppercase tracking-wide opacity-70">score</span>
    </div>
  );
}

function CheckIcon({
  passed,
  severity,
}: {
  passed: boolean;
  severity: "error" | "warning" | "info";
}) {
  if (passed) {
    return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />;
  }
  if (severity === "error") {
    return <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />;
  }
  if (severity === "warning") {
    return <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />;
  }
  return <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />;
}
