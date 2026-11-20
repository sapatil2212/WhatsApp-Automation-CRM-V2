'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, CheckCircle2, Copy, ExternalLink, FileSpreadsheet, Loader2, RefreshCw, Send, Unplug } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  { title: 'Done — data flows automatically', body: 'New leads, appointments (with token numbers) and bookings land in separate tabs: Leads, Appointments, Bookings. Status changes update the same row.' },
];

export function GoogleSheetsIntegration() {
  const [url, setUrl] = useState('');
  const [connected, setConnected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'backfill' | 'disconnect'>(null);
  const [copied, setCopied] = useState(false);

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
    await navigator.clipboard.writeText(APPS_SCRIPT);
    setCopied(true);
    toast.success('Script copied');
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border/70 bg-card p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600"><FileSpreadsheet className="size-6" /></span>
          <div>
            <p className="font-semibold">Google Sheets</p>
            <p className="max-w-xl text-sm text-muted-foreground">Automatically collect every lead, appointment and booking in a Google Sheet your team already uses — no Zapier needed.</p>
          </div>
        </div>
        {loading ? (
          <span className="h-6 w-24 animate-pulse rounded-full bg-muted" />
        ) : connected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3.5" /> Connected</span>
        ) : (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">Not connected</span>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-5">
          <p className="text-sm font-semibold">How to connect (5 minutes)</p>
          <ol className="space-y-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <a href="https://sheets.new" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Create a new Google Sheet <ExternalLink className="size-3" /></a>

          <div className="space-y-2 border-t border-border/60 pt-4">
            <p className="text-sm font-semibold">Web app URL</p>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" className="font-mono text-xs" />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={async () => { const d = await call('PUT', { url }, 'save'); if (d) { setConnected(d.url); toast.success('Google Sheet connected — a test row was added.'); } }}
                disabled={Boolean(busy) || !url.trim()}
                className="gap-1.5"
              >
                {busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {connected ? 'Update' : 'Connect'}
              </Button>
              {connected && (
                <>
                  <Button variant="outline" onClick={async () => { if (await call('POST', { action: 'test' }, 'test')) toast.success('Test row sent'); }} disabled={Boolean(busy)} className="gap-1.5">
                    {busy === 'test' ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send test row
                  </Button>
                  <Button variant="outline" onClick={async () => { const d = await call('POST', { action: 'backfill' }, 'backfill'); if (d) toast.success(`Synced ${d.sent} rows from the last 30 days`); }} disabled={Boolean(busy)} className="gap-1.5">
                    {busy === 'backfill' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Sync last 30 days
                  </Button>
                  <Button variant="ghost" onClick={async () => { const d = await call('PUT', { url: null }, 'disconnect'); if (d) { setConnected(null); setUrl(''); toast.success('Disconnected'); } }} disabled={Boolean(busy)} className="gap-1.5 text-muted-foreground hover:text-destructive">
                    <Unplug className="size-4" /> Disconnect
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <p className="text-sm font-semibold">Apps Script (Code.gs)</p>
            <Button size="sm" variant="outline" onClick={copyScript} className="h-7 gap-1.5 text-xs">{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy script'}</Button>
          </div>
          <pre className="max-h-[520px] overflow-auto bg-muted/40 p-4 text-[11px] leading-relaxed"><code>{APPS_SCRIPT}</code></pre>
        </div>
      </div>
    </div>
  );
}
