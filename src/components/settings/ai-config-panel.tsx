"use client";

import { useEffect, useState } from "react";
import { Bot, Check, Key, Loader2, Sparkles, Sliders } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AiConfig {
  aiProvider: "gemini" | "openai" | "openrouter";
  aiApiKey: string | null;
  aiModel: string | null;
  aiTemperature: number;
  aiSystemPrompt: string | null;
  aiPersonality: string | null;
  aiLanguage: string;
  aiBusinessContext: string | null;
}

export function AiConfigPanel() {
  const [config, setConfig] = useState<AiConfig>({
    aiProvider: "gemini",
    aiApiKey: "",
    aiModel: "Automatic (Flash-Lite / Flash / Pro)",
    aiTemperature: 0.7,
    aiSystemPrompt: "",
    aiPersonality: "Helpful, professional, and friendly",
    aiLanguage: "English",
    aiBusinessContext: "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch("/api/settings/ai-config");
        if (res.ok) {
          const body = await res.json();
          if (body.data) {
            setConfig({
              aiProvider: "gemini",
              aiApiKey: "",
              aiModel: "Automatic (Flash-Lite / Flash / Pro)",
              aiTemperature: Number(body.data.aiTemperature ?? 0.7),
              aiSystemPrompt: body.data.aiSystemPrompt || "",
              aiPersonality: body.data.aiPersonality || "Helpful, professional, and friendly",
              aiLanguage: body.data.aiLanguage || "English",
              aiBusinessContext: body.data.aiBusinessContext || "",
            });
          }
        }
      } catch {
        setError("Failed to load AI settings.");
      } finally {
        setLoading(false);
      }
    }
    loadConfig();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedSuccess(false);

    try {
      const res = await fetch("/api/settings/ai-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiProvider: config.aiProvider,
          aiApiKey: config.aiApiKey || null,
          aiModel: config.aiModel || null,
          aiTemperature: config.aiTemperature,
          aiSystemPrompt: config.aiSystemPrompt || null,
          aiPersonality: config.aiPersonality || null,
          aiLanguage: config.aiLanguage || "English",
          aiBusinessContext: config.aiBusinessContext || null,
        }),
      });

      if (!res.ok) {
        const d = await res.json() as { error?: { message?: string }; message?: string };
        throw new Error(d.error?.message || d.message || "Failed to save settings");
      }

      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred while saving.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">AI Intelligence & Assistant</h2>
            <p className="text-sm text-muted-foreground">
              Configure LLM provider models, API credentials, and default agent behavior for inbox assistance.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-500">
          {error}
        </div>
      )}

      {/* Provider & Model */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" /> LLM Provider & Credentials
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              AI Provider
            </label>
            <div className="w-full rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm text-foreground">
              Google Gemini (server-managed)
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Model Name
            </label>
            <input
              type="text"
              value={config.aiModel || ""}
              readOnly
              className="w-full rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Key className="h-3.5 w-3.5" /> Server API Key
          </label>
          <p className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            AI uses the server&apos;s <code>GEMINI_API_KEY</code>. The key is never exposed to this browser.
          </p>
        </div>
      </div>

      {/* Behavior & Personality */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Sliders className="h-4 w-4 text-primary" /> Tone & Knowledge Context
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Default AI Tone / Personality
            </label>
            <input
              type="text"
              value={config.aiPersonality || ""}
              onChange={(e) => setConfig({ ...config, aiPersonality: e.target.value })}
              placeholder="e.g. Friendly, professional, concise, empathetic"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Primary Language
            </label>
            <input
              type="text"
              value={config.aiLanguage}
              onChange={(e) => setConfig({ ...config, aiLanguage: e.target.value })}
              placeholder="English, Spanish, Hindi, etc."
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            Temperature ({config.aiTemperature}) — Creativity vs Precision
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={config.aiTemperature}
            onChange={(e) => setConfig({ ...config, aiTemperature: parseFloat(e.target.value) })}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
            <span>Precise (0.0)</span>
            <span>Balanced (0.5)</span>
            <span>Creative (1.0)</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            Business Context / Knowledge Base
          </label>
          <textarea
            rows={3}
            value={config.aiBusinessContext || ""}
            onChange={(e) => setConfig({ ...config, aiBusinessContext: e.target.value })}
            placeholder="Tell the AI about your business, products, return policies, hours, or FAQs to ground replies in reality..."
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            Custom System Instructions
          </label>
          <textarea
            rows={3}
            value={config.aiSystemPrompt || ""}
            onChange={(e) => setConfig({ ...config, aiSystemPrompt: e.target.value })}
            placeholder="Always address the user politely, mention we are available 9am-6pm..."
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        {savedSuccess && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-500 font-medium">
            <Check className="h-4 w-4" /> Settings saved
          </span>
        )}
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save AI Configuration
        </Button>
      </div>
    </form>
  );
}
