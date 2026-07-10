"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import { getTerminology } from "@/lib/business/terminology";
import { toast } from "sonner";
import { Loader2, Brain, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export default function AISettingsPage() {
  const params = useParams();
  const businessSegment = params.businessSegment as string;
  const term = getTerminology(businessSegment);

  const db = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);

  const [settings, setSettings] = useState({
    ai_enabled: true,
    ai_tone: "polite and professional",
    greeting_message: "",
    after_hours_message: "",
    human_handover_enabled: true,
  });

  useEffect(() => {
    async function loadData() {
      try {
        const { data: business } = await db
          .from("business_profiles")
          .select("id")
          .maybeSingle();

        if (business) {
          setBusinessId(business.id);
          const { data: ai } = await db
            .from("business_ai_settings")
            .select("*")
            .eq("business_id", business.id)
            .maybeSingle();

          if (ai) {
            setSettings({
              ai_enabled: ai.ai_enabled ?? true,
              ai_tone: ai.ai_tone || "polite and professional",
              greeting_message: ai.greeting_message || "",
              after_hours_message: ai.after_hours_message || "",
              human_handover_enabled: ai.human_handover_enabled ?? true,
            });
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [businessSegment]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;

    setSaving(true);
    try {
      const { data: existing } = await db
        .from("business_ai_settings")
        .select("id")
        .eq("business_id", businessId)
        .maybeSingle();

      const payload = {
        business_id: businessId,
        ai_enabled: settings.ai_enabled,
        ai_tone: settings.ai_tone,
        greeting_message: settings.greeting_message,
        after_hours_message: settings.after_hours_message,
        human_handover_enabled: settings.human_handover_enabled,
      };

      if (existing) {
        const { error } = await db
          .from("business_ai_settings")
          .update(payload)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await db
          .from("business_ai_settings")
          .insert(payload);
        if (error) throw error;
      }

      toast.success("AI Settings updated successfully.");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <Brain className="h-6 w-6 text-primary" />
          AI Booking settings
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Configure behavior rules, tones, and defaults for the WhatsApp booking chatbot agent.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-md text-white">
          <CardHeader>
            <CardTitle className="text-sm font-bold">Automation Toggles</CardTitle>
            <CardDescription className="text-xs text-slate-400">Control active AI handlers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-950/40 rounded-lg border border-slate-850">
              <div>
                <div className="text-xs font-semibold">Enable Booking Chatbot</div>
                <div className="text-[10px] text-slate-500">Allow AI to autopilot responses on WhatsApp.</div>
              </div>
              <Switch
                checked={settings.ai_enabled}
                onCheckedChange={(val) => setSettings({ ...settings, ai_enabled: val })}
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-950/40 rounded-lg border border-slate-850">
              <div>
                <div className="text-xs font-semibold">Human Handover Enabled</div>
                <div className="text-[10px] text-slate-500">Auto-handover to agents if keywords like 'human' are detected.</div>
              </div>
              <Switch
                checked={settings.human_handover_enabled}
                onCheckedChange={(val) => setSettings({ ...settings, human_handover_enabled: val })}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-md text-white">
          <CardHeader>
            <CardTitle className="text-sm font-bold">Personality & Prompt settings</CardTitle>
            <CardDescription className="text-xs text-slate-400">Customize greeting messages and response tone.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">AI Agent Tone</Label>
              <Input
                value={settings.ai_tone}
                onChange={(e) => setSettings({ ...settings, ai_tone: e.target.value })}
                placeholder="e.g. friendly and welcoming"
                className="h-9 border-slate-800 bg-slate-950 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">AI Greeting Response Message</Label>
              <Textarea
                value={settings.greeting_message}
                onChange={(e) => setSettings({ ...settings, greeting_message: e.target.value })}
                placeholder="Greeting message..."
                className="min-h-[80px] border-slate-800 bg-slate-950 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">After Hours Message</Label>
              <Textarea
                value={settings.after_hours_message}
                onChange={(e) => setSettings({ ...settings, after_hours_message: e.target.value })}
                placeholder="After hours message..."
                className="min-h-[80px] border-slate-800 bg-slate-950 text-xs"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving} className="bg-emerald-500 hover:bg-emerald-400 text-white text-xs">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving Settings...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" /> Save AI settings
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
