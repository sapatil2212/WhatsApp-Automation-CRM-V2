"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Eye, EyeOff, KeyRound, Loader2, PlugZap, RefreshCw, Server, ShieldCheck, Trash2, Webhook, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { api } from "@/lib/campaigns/api";
import { Field, fmtDateTime, inputCls, Pill, useAdminApi } from "@/components/super-admin/offers/shared";

export interface GatewayStatus {
  active: { source: "dashboard" | "env"; mode: "live" | "test"; keyId: string | null; webhookSecretSet: boolean } | null;
  dashboard: { enabled: boolean; keyId: string | null; keySecretSet: boolean; webhookSecretSet: boolean; decryptOk: boolean; updatedAt: string | null; updatedBy: string | null };
  env: { keyId: string | null; keySecretSet: boolean; webhookSecretSet: boolean };
  encryptionReady: boolean;
  webhookUrl: string;
  webhookEvents: string[];
  lastWebhook: { event: string; at: string } | null;
}

const copy = (value: string, label: string) =>
  navigator.clipboard.writeText(value).then(
    () => toast.success(`${label} copied.`),
    () => toast.error("Could not copy. Select the text and copy it manually."),
  );

/** 40 random hex characters for the Razorpay webhook secret. */
function randomSecret() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <button type="button" onClick={() => void copy(value, label)} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-primary hover:bg-primary/10" aria-label={`Copy ${label}`}>
      <Copy className="size-3.5" /> Copy
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{children}</span>
    </div>
  );
}

const SetPill = ({ set }: { set: boolean }) => <Pill tone={set ? "green" : "muted"}>{set ? "Set" : "Not set"}</Pill>;

export function RazorpayIntegration() {
  const { data, error, loading, reload } = useAdminApi<GatewayStatus>("/api/super-admin/integrations/razorpay");
  if (loading && !data) return <div className="h-64 animate-pulse rounded-2xl bg-muted/60" />;
  if (error && !data) return <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>;
  if (!data) return null;
  // Remount the form whenever the saved settings change so it starts from them.
  return <RazorpayForm key={`${data.dashboard.updatedAt ?? "none"}`} status={data} onChange={reload} />;
}

function RazorpayForm({ status, onChange }: { status: GatewayStatus; onChange: () => Promise<void> | void }) {
  const d = status.dashboard;
  const [enabled, setEnabled] = useState(d.enabled || !d.keyId);
  const [keyId, setKeyId] = useState(d.keyId ?? "");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const active = status.active;
  const healthy = Boolean(active && active.webhookSecretSet);
  const changed = keyId.trim() !== (d.keyId ?? "") || Boolean(keySecret.trim()) || Boolean(webhookSecret.trim()) || enabled !== d.enabled;

  const save = async () => {
    setBusy("save");
    setFieldError(null);
    try {
      await api("/api/super-admin/integrations/razorpay", { method: "PUT", json: { enabled, keyId: keyId.trim(), keySecret: keySecret.trim(), webhookSecret: webhookSecret.trim() } });
      toast.success(enabled ? "Saved. Payments now use these keys." : "Saved. These keys are switched off.");
      await onChange();
    } catch (e) {
      const details = (e as { details?: { field?: string } }).details;
      setFieldError({ field: details?.field, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy("test");
    setTest(null);
    try {
      const res = await api<{ ok: boolean; message: string }>("/api/super-admin/integrations/razorpay/test", { method: "POST", json: { keyId: keySecret.trim() ? keyId.trim() : "", keySecret: keySecret.trim() } });
      setTest(res.data);
    } catch (e) {
      setTest({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      await api("/api/super-admin/integrations/razorpay", { method: "PUT", json: { enabled: false, clear: true } });
      toast.success("Saved keys removed.");
      setConfirmRemove(false);
      await onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const errFor = (field: string) => (fieldError?.field === field ? fieldError.message : null);

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className={`rounded-2xl border p-4 ${healthy ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            {healthy ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-600 dark:text-emerald-400" /> : <AlertTriangle className="mt-0.5 size-4 text-amber-600 dark:text-amber-400" />}
            <div>
              <p className="text-sm font-semibold">
                {active ? `Razorpay connected · ${active.mode === "live" ? "Live mode" : "Test mode"}` : "Razorpay not connected"}
                {active && !active.webhookSecretSet && " · webhook secret missing"}
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {!active
                  ? "Signups and renewals cannot be paid until keys are added here or in the server .env."
                  : `Using keys from ${active.source === "dashboard" ? "this dashboard" : "the server .env"} (${active.keyId}).${active.webhookSecretSet ? " Payments are confirmed by webhook even if the customer closes the page." : " Add a webhook secret so payments are confirmed even if the customer closes the page."}`}
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void onChange()}><RefreshCw className="size-3.5" /> Refresh</Button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-card px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Active source</p>
            <p className="mt-0.5 text-[13px] font-semibold">{active ? (active.source === "dashboard" ? "Dashboard" : "Server .env") : "None"}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-card px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Mode</p>
            <p className="mt-0.5 text-[13px] font-semibold">{active ? (active.mode === "live" ? "Live (real money)" : "Test (no real money)") : "—"}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-card px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Last webhook received</p>
            <p className="mt-0.5 truncate text-[13px] font-semibold">{status.lastWebhook ? `${status.lastWebhook.event} · ${fmtDateTime(status.lastWebhook.at)}` : "None yet"}</p>
          </div>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Keys form */}
        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold"><KeyRound className="size-3.5 text-primary" /> Razorpay keys (dashboard)</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">Saved keys take priority over the server .env while switched on. Secrets are encrypted and never shown again.</p>
            </div>
            <label className="flex items-center gap-2 text-[12px] font-medium">
              <Switch checked={enabled} onCheckedChange={(v: boolean) => setEnabled(v)} aria-label="Use these keys" />
              {enabled ? "On" : "Off"}
            </label>
          </div>

          {!status.encryptionReady && (
            <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
              ENCRYPTION_KEY (64 hex characters) is not set on the server, so secrets cannot be saved here. Use the .env option below, or set ENCRYPTION_KEY and restart.
            </p>
          )}
          {d.keySecretSet && !d.decryptOk && (
            <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              The saved Key Secret cannot be read (ENCRYPTION_KEY changed). Enter the Key Secret and webhook secret again and save.
            </p>
          )}

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Key ID" hint={errFor("keyId") ? <span className="text-destructive">{errFor("keyId")}</span> : "Starts with rzp_test_ or rzp_live_."}>
              <Input value={keyId} onChange={(e) => setKeyId(e.target.value.trim())} placeholder="rzp_live_XXXXXXXXXXXXXX" className={`${inputCls} font-mono`} autoComplete="off" spellCheck={false} aria-invalid={Boolean(errFor("keyId"))} />
            </Field>
            <Field label="Key Secret" hint={d.keySecretSet ? "Saved. Leave blank to keep it." : "Shown once by Razorpay when you generate the key."}>
              <div className="relative">
                <Input type={showSecret ? "text" : "password"} value={keySecret} onChange={(e) => setKeySecret(e.target.value)} placeholder={d.keySecretSet ? "•••••••• (saved)" : "Paste the Key Secret"} className={`${inputCls} pr-8 font-mono`} autoComplete="new-password" spellCheck={false} />
                <button type="button" onClick={() => setShowSecret((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={showSecret ? "Hide secret" : "Show secret"}>
                  {showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
            </Field>
            <Field
              className="md:col-span-2"
              label="Webhook secret"
              hint={errFor("webhookSecret") ? <span className="text-destructive">{errFor("webhookSecret")}</span> : d.webhookSecretSet ? "Saved. Leave blank to keep it, or generate a new one and update it in Razorpay too." : "Any random text of 12+ characters. Paste the same value in Razorpay when you add the webhook."}
            >
              <div className="flex gap-1.5">
                <Input value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder={d.webhookSecretSet ? "•••••••• (saved)" : "Generate or paste a secret"} className={`${inputCls} font-mono`} autoComplete="off" spellCheck={false} aria-invalid={Boolean(errFor("webhookSecret"))} />
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setWebhookSecret(randomSecret())}><Wand2 className="size-3.5" /> Generate</Button>
                {webhookSecret && <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void copy(webhookSecret, "Webhook secret")}><Copy className="size-3.5" /> Copy</Button>}
              </div>
            </Field>
          </div>

          {fieldError && !fieldError.field && <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{fieldError.message}</p>}
          {test && (
            <p className={`mt-3 flex items-start gap-1.5 rounded-lg border px-3 py-2 text-[12px] ${test.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
              {test.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />} {test.message}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
            <Button size="sm" className="h-8 gap-1.5" disabled={busy !== null || !changed || !status.encryptionReady} onClick={() => void save()}>
              {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Save
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy !== null} onClick={() => void runTest()}>
              {busy === "test" ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />} Test connection
            </Button>
            {(d.keyId || d.keySecretSet || d.webhookSecretSet) && (
              <Button size="sm" variant="ghost" className="ml-auto h-8 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy !== null} onClick={() => setConfirmRemove(true)}>
                <Trash2 className="size-3.5" /> Remove saved keys
              </Button>
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Test connection checks the keys typed above, or the saved / .env keys when the secret field is empty. It reads one order and changes nothing.
            {d.updatedAt ? ` Last saved ${fmtDateTime(d.updatedAt)}${d.updatedBy ? ` by ${d.updatedBy}` : ""}.` : ""}
          </p>
        </section>

        {/* Env fallback */}
        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Server className="size-3.5 text-primary" /> Server .env (fallback)</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Used when the dashboard keys are off or empty. Restart the server after changing .env.</p>
          <div className="mt-2 divide-y divide-border/70">
            <Row label="RAZORPAY_KEY_ID">{status.env.keyId ? <span className="font-mono">{status.env.keyId}</span> : <SetPill set={false} />}</Row>
            <Row label="RAZORPAY_KEY_SECRET"><SetPill set={status.env.keySecretSet} /></Row>
            <Row label="RAZORPAY_WEBHOOK_SECRET"><SetPill set={status.env.webhookSecretSet} /></Row>
          </div>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-border/70 bg-muted/50 px-3 py-2 text-[11px] leading-relaxed">{`RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret`}</pre>
          <p className="mt-2 text-[11px] text-muted-foreground">Webhooks signed with either the dashboard or the .env secret are accepted, so switching between them does not drop payments.</p>
        </section>
      </div>

      {/* Webhook + steps */}
      <section className="rounded-2xl border border-border/70 bg-card p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Webhook className="size-3.5 text-primary" /> Webhook</h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Razorpay calls this URL when a payment succeeds or fails, so accounts activate even if the customer closes the page.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2">
          <span className="text-[11px] font-medium text-muted-foreground">Webhook URL</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[12px]">{status.webhookUrl}</code>
          <CopyButton value={status.webhookUrl} label="Webhook URL" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Active events:</span>
          {status.webhookEvents.map((e) => <code key={e} className="rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[11px]">{e}</code>)}
          <CopyButton value={status.webhookEvents.join(", ")} label="Event names" />
        </div>
        {/localhost|127\.0\.0\.1/.test(status.webhookUrl) && (
          <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
            This URL points to localhost, which Razorpay cannot reach. Set NEXT_PUBLIC_SITE_URL to your public https domain on the live server and use that URL.
          </p>
        )}

        <h4 className="mt-4 text-[12px] font-semibold">How to connect Razorpay</h4>
        <ol className="mt-2 grid gap-2 md:grid-cols-2">
          {[
            <>Log in to the <a href="https://dashboard.razorpay.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">Razorpay Dashboard <ExternalLink className="size-3" /></a> and pick <b>Test mode</b> or <b>Live mode</b> at the top. Keys and webhooks are separate for each mode.</>,
            <>Open <b>Account &amp; Settings → API Keys</b> and click <b>Generate Key</b>. Copy the <b>Key ID</b> and <b>Key Secret</b> (the secret is shown only once).</>,
            <>Paste both into the form above. Click <b>Generate</b> next to Webhook secret and <b>Copy</b> it. Turn the switch on and click <b>Save</b>, then <b>Test connection</b>.</>,
            <>In Razorpay open <b>Account &amp; Settings → Webhooks</b> and click <b>Add New Webhook</b>.</>,
            <>Paste the <b>Webhook URL</b> shown above, and paste the same <b>webhook secret</b> into the Secret field. Add an alert email if you like.</>,
            <>Tick the events <code className="font-mono">payment.captured</code>, <code className="font-mono">order.paid</code> and <code className="font-mono">payment.failed</code>, then click <b>Create Webhook</b>.</>,
            <>Make a test payment from the signup page (test mode: use Razorpay&apos;s test card or UPI ID <code className="font-mono">success@razorpay</code>). <b>Last webhook received</b> above should update within a few seconds.</>,
            <>Going live: repeat steps 2 to 6 in <b>Live mode</b> (Live keys need a KYC-approved Razorpay account), save the live keys here and run one small real payment.</>,
          ].map((step, i) => (
            <li key={i} className="flex gap-2 rounded-lg border border-border/70 px-3 py-2 text-[12px]">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{i + 1}</span>
              <span className="text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <ConfirmationDialog
        isOpen={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove saved Razorpay keys?"
        description="The Key ID, Key Secret and webhook secret saved in this dashboard are deleted."
        notes={[status.env.keySecretSet ? "Payments switch to the keys in the server .env." : "No keys are left in the server .env, so online payments stop until new keys are added.", "Webhooks signed with the removed secret will be rejected."]}
        confirmText="Remove keys"
        variant="destructive"
        icon="delete"
        onConfirm={remove}
      />
    </div>
  );
}
