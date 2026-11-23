'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, ExternalLink, FileSpreadsheet, Loader2, RefreshCw, Send, Unplug } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

/** Apps Script the tenant pastes into Extensions → Apps Script. */
export const APPS_SCRIPT = `/**
 * ChatNexGen → Google Sheets
 * Receives leads, appointments and bookings and writes each type to its own tab.
 * Columns are created automatically from the incoming data.
 */
const TABS = { lead: 'Leads', appointment: 'Appointments', booking: 'Bookings', test: 'Connection Test' };

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    const tabName = TABS[data.type] || 'Other';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);

    // Header row: keep existing columns, append any new keys.
    let headers = sheet.getLastColumn() > 0
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].filter(String)
      : [];
    const keys = Object.keys(data).filter((k) => k !== 'type');
    keys.forEach((k) => { if (headers.indexOf(k) === -1) headers.push(k); });
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);

    // Update the row with the same ref (e.g. status changes) or append a new one.
    const row = headers.map((h) => data[h] !== undefined ? data[h] : '');
    const refCol = headers.indexOf('ref') + 1;
    if (refCol > 0 && data.ref && sheet.getLastRow() > 1) {
      const refs = sheet.getRange(2, refCol, sheet.getLastRow() - 1, 1).getValues();
      for (let i = 0; i < refs.length; i++) {
        if (refs[i][0] === data.ref) {
          sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
          return ContentService.createTextOutput(JSON.stringify({ ok: true, updated: true })).setMimeType(ContentService.MimeType.JSON);
        }
      }
    }
    sheet.appendRow(row);
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, message: String(err) })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput('ChatNexGen Google Sheets connector is running.');
}
`;

const STEPS = [
  { title: 'Create a Google Sheet', body: 'Open sheets.new (or any existing sheet) with the Google account that should own your leads and bookings.' },
  { title: 'Open Apps Script', body: 'In the sheet, go to Extensions → Apps Script. Delete any code in Code.gs.' },
  { title: 'Paste the script', body: 'Copy the script below, paste it into Code.gs and click Save (💾).' },
  { title: 'Deploy as a web app', body: 'Click Deploy → New deployment → gear icon → Web app. Set "Execute as: Me" and "Who has access: Anyone". Click Deploy and approve the permissions (Advanced → Go to project → Allow).' },
  { title: 'Copy the Web app URL', body: 'Copy the URL that ends with /exec and paste it below, then click Connect. We send a test row to confirm.' },
  { title: 'Done. Data flows automatically', body: 'New leads, appointments (with queue numbers) and bookings land in separate tabs: Leads, Appointments, Bookings. Status changes update the same row.' },
];

export function GoogleSheetsIntegration() {
  const [url, setUrl] = useState('');
  const [connected, setConnected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'backfill' | 'disconnect'>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    fetch('/api/integrations/google-sheets', { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => { if (b?.success && b.data.url) { setConnected(b.data.url); setUrl(b.data.url); } })
      .finally(() => setLoading(false));
  }, []);

  async function call(method: 'PUT' | 'POST', body: unknown, kind: NonNullable<typeof busy>) {
    setBusy(kind);
    try {
      const res = await fetch('/api/integrations/google-sheets', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Request failed');
      return json.data;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Request failed');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT);
    } catch {
      toast.error('Could not copy. Select the script and copy it manually.');
      return;
    }
    setCopied(true);
    toast.success('Script copied');
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${connected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/70 bg-card'}`}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><FileSpreadsheet className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{loading ? 'Google Sheets' : connected ? 'Connected to Google Sheets' : 'Google Sheets · not connected'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {connected ? 'New leads, appointments and bookings are added to your sheet automatically.' : 'Collect every lead, appointment and booking in a Google Sheet. No Zapier needed.'}
          </p>
        </div>
        {loading ? <span className="h-6 w-24 animate-pulse rounded-full bg-muted" /> : connected ? (
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={async () => { if (await call('POST', { action: 'test' }, 'test')) toast.success('Test row sent'); }} disabled={Boolean(busy)}>
              {busy === 'test' ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send test row
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={async () => { const d = await call('POST', { action: 'backfill' }, 'backfill'); if (d) toast.success(`Synced ${d.sent} rows from the last 30 days`); }} disabled={Boolean(busy)}>
              {busy === 'backfill' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Sync last 30 days
            </Button>
          </div>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Not connected</span>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <section className="rounded-xl border border-border/70 bg-card p-4">
            <h3 className="text-sm font-semibold">Web app URL</h3>
            <p className="mb-2 text-xs text-muted-foreground">Paste the Apps Script deployment URL ending in <code className="rounded bg-muted px-1">/exec</code>. We send a test row to confirm.</p>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" className="h-8 font-mono text-[12px] md:text-[12px]" />
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={async () => { const d = await call('PUT', { url }, 'save'); if (d) { setConnected(d.url); toast.success('Google Sheet connected. A test row was added.'); } }}
                disabled={Boolean(busy) || !url.trim() || url.trim() === connected}
              >
                {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} {connected ? 'Update URL' : 'Connect'}
              </Button>
              {connected && (
                <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmDisconnect(true)} disabled={Boolean(busy)}>
                  <Unplug className="size-3.5" /> Disconnect
                </Button>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border/70 bg-card p-4">
            <h3 className="text-sm font-semibold">How to connect</h3>
            <p className="mb-3 text-xs text-muted-foreground">About 5 minutes. <a href="https://sheets.new" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">Create a new sheet <ExternalLink className="size-3" /></a></p>
            <ol className="space-y-2.5">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{s.title}</p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <section className="overflow-hidden rounded-xl border border-border/70 bg-card lg:sticky lg:top-4">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
            <div>
              <p className="text-sm font-semibold">Apps Script</p>
              <p className="text-[11px] text-muted-foreground">Paste into Code.gs</p>
            </div>
            <Button size="sm" variant="outline" onClick={copyScript} className="gap-1.5">{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy script'}</Button>
          </div>
          <pre className="max-h-[480px] overflow-auto bg-muted/40 p-4 text-[11px] leading-relaxed"><code>{APPS_SCRIPT}</code></pre>
        </section>
      </div>

      <ConfirmationDialog
        isOpen={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Google Sheets?"
        description="New leads, appointments and bookings stop being added to your sheet."
        notes={['Rows already in the sheet are not removed.']}
        confirmText="Disconnect"
        variant="destructive"
        icon="warning"
        onConfirm={async () => {
          setConfirmDisconnect(false);
          const d = await call('PUT', { url: null }, 'disconnect');
          if (d) { setConnected(null); setUrl(''); toast.success('Google Sheets disconnected'); }
        }}
      />
    </div>
  );
}
