'use client';

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, ImageIcon, Loader2, Sparkles, Trash2, Upload,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/campaigns/api';
import type { TagItem } from './contact-editor';

interface Candidate {
  name: string;
  phone: string;
  email: string;
  company: string;
  rawPhone: string;
  valid: boolean;
  issue?: string;
}

interface Extraction {
  method: 'columns' | 'text' | 'vision';
  contacts: Candidate[];
  totalFound: number;
  validCount: number;
  duplicatesRemoved: number;
  notes: string[];
}

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; phone: string | null; reason: string }>;
}

const ACCEPT = '.csv,.xlsx,.xls,.ods,.tsv,.txt,.vcf,.pdf,.docx,.json,.png,.jpg,.jpeg,.webp';
const METHOD_LABEL: Record<Extraction['method'], string> = {
  columns: 'AI mapped the spreadsheet columns',
  text: 'AI read the document text',
  vision: 'AI read the image / scanned document',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: TagItem[];
  aiAvailable: boolean;
  onImported: () => void;
}

export function AiImportDialog({ open, onOpenChange, tags, aiAvailable, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<'upload' | 'review' | 'done'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [countryCode, setCountryCode] = useState('91');
  const [analysing, setAnalysing] = useState(false);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [rows, setRows] = useState<Array<Candidate & { selected: boolean }>>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update'>('skip');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function reset() {
    setStage('upload');
    setFile(null);
    setExtraction(null);
    setRows([]);
    setTagIds([]);
    setResult(null);
  }

  async function analyse(f: File) {
    setFile(f);
    setAnalysing(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('defaultCountryCode', countryCode);
      const res = await api<Extraction>('/api/contacts/ai-extract', { method: 'POST', body: fd });
      setExtraction(res.data);
      setRows(res.data.contacts.map((c) => ({ ...c, selected: c.valid })));
      if (!res.data.contacts.length) toast.warning('No contacts were found in this file.');
      else setStage('review');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not analyse the file');
    } finally {
      setAnalysing(false);
    }
  }

  const selected = useMemo(() => rows.filter((r) => r.selected && /^[1-9]\d{6,14}$/.test(r.phone.replace(/\D/g, ''))), [rows]);

  function updateRow(i: number, patch: Partial<Candidate & { selected: boolean }>) {
    setRows((rs) => rs.map((r, j) => {
      if (j !== i) return r;
      const next = { ...r, ...patch };
      if (patch.phone !== undefined) {
        next.valid = /^[1-9]\d{6,14}$/.test(patch.phone.replace(/\D/g, ''));
        next.issue = next.valid ? undefined : 'Phone number is not valid';
      }
      return next;
    }));
  }

  async function runImport() {
    if (!selected.length) return;
    setImporting(true);
    try {
      const totals: ImportResult = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
      for (let i = 0; i < selected.length; i += 5000) {
        const chunk = selected.slice(i, i + 5000).map((r) => ({
          phone: r.phone.replace(/\D/g, ''),
          name: r.name || undefined,
          email: r.email || undefined,
          company: r.company || undefined,
        }));
        const res = await api<ImportResult>('/api/contacts/import', { method: 'POST', json: { rows: chunk, onDuplicate, tagIds } });
        totals.created += res.data.created;
        totals.updated += res.data.updated;
        totals.skipped += res.data.skipped;
        totals.failed += res.data.failed;
        totals.errors.push(...res.data.errors);
      }
      setResult(totals);
      setStage('done');
      onImported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setTimeout(reset, 200); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Import contacts with AI</DialogTitle>
          <DialogDescription>
            Upload any file — spreadsheet, PDF, Word, vCard or even a photo of a business card or register. AI finds the contacts; you review before anything is saved.
          </DialogDescription>
        </DialogHeader>

        {stage === 'upload' && (
          <div className="space-y-4">
            {!aiAvailable && (
              <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3.5" /> AI is not configured (GEMINI_API_KEY). Spreadsheets will still import using column headers.
              </p>
            )}
            <div
              role="button"
              tabIndex={0}
              onClick={() => !analysing && fileRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter') fileRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) analyse(f); }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/40'}`}
            >
              {analysing ? (
                <>
                  <Loader2 className="size-8 animate-spin text-primary" />
                  <p className="mt-3 text-sm font-medium">Analysing {file?.name}…</p>
                  <p className="mt-1 text-xs text-muted-foreground">Finding names, numbers, emails and companies.</p>
                </>
              ) : (
                <>
                  <Upload className="size-8 text-primary" />
                  <p className="mt-3 text-sm font-medium">Drop a file here or click to browse</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><FileSpreadsheet className="size-3.5" /> CSV, Excel</span>
                    <span className="inline-flex items-center gap-1"><FileText className="size-3.5" /> PDF, Word, vCard, TXT</span>
                    <span className="inline-flex items-center gap-1"><ImageIcon className="size-3.5" /> JPG, PNG photos</span>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">Up to 20 MB</p>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) analyse(f); e.target.value = ''; }} />
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Default country code</Label>
                <Input value={countryCode} onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, '').slice(0, 4))} className="h-9 w-24" />
              </div>
              <p className="pb-2 text-[11px] text-muted-foreground">Added to local numbers without a country code (e.g. 98765 43210 → +91 98765 43210).</p>
            </div>
          </div>
        )}

        {stage === 'review' && extraction && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-muted/60 px-4 py-3 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium"><Sparkles className="size-3.5 text-primary" /> {METHOD_LABEL[extraction.method]}</span>
              <span><b>{extraction.totalFound}</b> found</span>
              <span className="text-primary"><b>{extraction.validCount}</b> valid</span>
              {extraction.duplicatesRemoved > 0 && <span className="text-muted-foreground">{extraction.duplicatesRemoved} duplicates merged</span>}
              {rows.length - extraction.validCount > 0 && <span className="text-amber-600 dark:text-amber-400">{rows.length - extraction.validCount} need attention</span>}
              <span className="ml-auto text-muted-foreground">{file?.name}</span>
            </div>
            {extraction.notes.map((n) => <p key={n} className="text-xs text-muted-foreground">• {n}</p>)}

            <div className="max-h-[42vh] overflow-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        aria-label="Select all"
                        checked={rows.length > 0 && rows.every((r) => r.selected)}
                        onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, selected: e.target.checked })))}
                      />
                    </th>
                    <th className="px-2 py-2 font-medium">Name</th>
                    <th className="px-2 py-2 font-medium">Phone</th>
                    <th className="px-2 py-2 font-medium">Email</th>
                    <th className="px-2 py-2 font-medium">Company</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.slice(0, 500).map((r, i) => (
                    <tr key={i} className={r.valid ? 'hover:bg-muted/40' : 'bg-amber-500/5'}>
                      <td className="px-3 py-1.5"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={r.selected} onChange={(e) => updateRow(i, { selected: e.target.checked })} aria-label={`Select ${r.name || r.phone}`} /></td>
                      <td className="px-1 py-1"><Input value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })} className="h-7 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-border focus:border-border" /></td>
                      <td className="px-1 py-1">
                        <Input value={r.phone} onChange={(e) => updateRow(i, { phone: e.target.value })} className={`h-7 px-1.5 font-mono text-xs shadow-none ${r.valid ? 'border-transparent bg-transparent hover:border-border' : 'border-amber-500/60'}`} title={r.issue} />
                      </td>
                      <td className="px-1 py-1"><Input value={r.email} onChange={(e) => updateRow(i, { email: e.target.value })} className="h-7 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-border focus:border-border" /></td>
                      <td className="px-1 py-1"><Input value={r.company} onChange={(e) => updateRow(i, { company: e.target.value })} className="h-7 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-border focus:border-border" /></td>
                      <td className="px-2 py-1"><button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive" aria-label="Remove row"><Trash2 className="size-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 500 && <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">Showing the first 500 rows for editing; all {rows.length.toLocaleString()} selected rows will be imported.</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Tag imported contacts</Label>
                <div className="flex flex-wrap gap-1.5">
                  {tags.length === 0 && <span className="text-[11px] text-muted-foreground">No tags yet — create them from Add contact.</span>}
                  {tags.map((t) => {
                    const on = tagIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTagIds((ids) => (on ? ids.filter((x) => x !== t.id) : [...ids, t.id]))}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] ${on ? 'border-transparent font-medium' : 'border-border text-muted-foreground hover:bg-accent'}`}
                        style={on ? { backgroundColor: `${t.color}22`, color: t.color } : undefined}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">If a number already exists</Label>
                <div className="flex gap-2">
                  {(['skip', 'update'] as const).map((v) => (
                    <button key={v} type="button" onClick={() => setOnDuplicate(v)} aria-pressed={onDuplicate === v} className={`flex-1 rounded-lg border px-3 py-2 text-xs ${onDuplicate === v ? 'border-primary bg-primary/5 font-medium' : 'border-border text-muted-foreground hover:bg-accent'}`}>
                      {v === 'skip' ? 'Keep existing' : 'Update with new details'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {stage === 'done' && result && (
          <div className="space-y-3 py-4 text-center">
            <CheckCircle2 className="mx-auto size-10 text-primary" />
            <p className="text-lg font-semibold">Import complete</p>
            <div className="mx-auto grid max-w-md grid-cols-4 gap-2 text-xs">
              {[['Added', result.created], ['Updated', result.updated], ['Skipped', result.skipped], ['Failed', result.failed]].map(([l, v]) => (
                <div key={l as string} className="rounded-lg bg-muted/60 p-2"><p className="text-lg font-bold tabular-nums">{v as number}</p><p className="text-muted-foreground">{l}</p></div>
              ))}
            </div>
            {result.errors.length > 0 && (
              <div className="mx-auto max-h-32 max-w-md overflow-auto rounded-lg border border-border p-2 text-left text-[11px] text-muted-foreground">
                {result.errors.slice(0, 50).map((e, i) => <p key={i}>Row {e.row}{e.phone ? ` (${e.phone})` : ''}: {e.reason}</p>)}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {stage === 'review' && (
            <>
              <Button variant="outline" onClick={reset}>Choose another file</Button>
              <Button onClick={runImport} disabled={importing || selected.length === 0}>
                {importing && <Loader2 className="size-4 animate-spin" />} Import {selected.length.toLocaleString()} contact{selected.length === 1 ? '' : 's'}
              </Button>
            </>
          )}
          {stage === 'done' && <Button onClick={() => onOpenChange(false)}>Done</Button>}
          {stage === 'upload' && <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
