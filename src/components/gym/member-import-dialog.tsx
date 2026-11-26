"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Sparkles, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/campaigns/api";
import { durationLabel, fmtPhone, type GymPackage } from "@/lib/gym/format";
import { GymModal } from "./gym-modal";

interface Row {
  name: string;
  phone: string;
  email: string;
  gender: "male" | "female" | "other" | null;
  dateOfBirth: string | null;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  fitnessGoal: string;
  medicalNotes: string;
  packageName: string;
  packageId: string | null;
  startDate: string | null;
  endDate: string | null;
  amountPaid: number | null;
  notes: string;
  valid: boolean;
  issue?: string;
}
interface Extraction { method: string; members: Row[]; totalFound: number; validCount: number; duplicatesRemoved: number; notes: string[] }
interface ImportResult { created: number; skipped: Array<{ row: number; name: string; reason: string }> }

const ACCEPT = ".xlsx,.xls,.csv,.tsv,.ods,.pdf,.docx,.doc,.txt,.png,.jpg,.jpeg,.webp";
const cell = "h-7 rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export function MemberImportDialog({ packages, clientPluralLabel, onClose, onDone }: { packages: GymPackage[]; clientPluralLabel: string; onClose: () => void; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"extract" | "import" | null>(null);
  const [data, setData] = useState<Extraction | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [welcome, setWelcome] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const lower = clientPluralLabel.toLowerCase();

  const extract = async (f: File) => {
    setFile(f);
    setBusy("extract");
    setData(null);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await api<Extraction>("/api/gym/members/import/extract", { method: "POST", body: form });
      setData(res.data);
      setRows(res.data.members);
      setPicked(new Set(res.data.members.flatMap((m, i) => (m.valid ? [i] : []))));
      if (!res.data.members.length) toast.error(`No ${lower} were found in this file.`);
    } catch (e) {
      toast.error((e as Error).message, { duration: 8000 });
    } finally {
      setBusy(null);
    }
  };

  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const validRow = (r: Row) => r.name.trim().length >= 2 && r.phone.replace(/\D/g, "").length >= 10;
  const selected = useMemo(() => rows.filter((r, i) => picked.has(i) && validRow(r)), [rows, picked]);
  const allValid = rows.map((r, i) => (validRow(r) ? i : -1)).filter((i) => i >= 0);
  const allPicked = allValid.length > 0 && allValid.every((i) => picked.has(i));

  const commit = async () => {
    if (!selected.length) return toast.error(`Select the ${lower} to import.`);
    setBusy("import");
    try {
      const res = await api<ImportResult>("/api/gym/members/import", {
        method: "POST",
        json: {
          sendWelcome: welcome,
          rows: selected.map((r) => ({
            name: r.name.trim(),
            phone: r.phone.trim(),
            email: r.email || null,
            gender: r.gender,
            dateOfBirth: r.dateOfBirth,
            address: r.address || null,
            emergencyContactName: r.emergencyContactName || null,
            emergencyContactPhone: r.emergencyContactPhone || null,
            fitnessGoal: r.fitnessGoal || null,
            medicalNotes: r.medicalNotes || null,
            notes: [r.notes, r.packageName && !r.packageId ? `Package in file: ${r.packageName}` : ""].filter(Boolean).join(" · ") || null,
            joinedAt: r.startDate ?? undefined,
            packageId: r.packageId,
            startDate: r.packageId ? r.startDate : null,
            amountPaid: r.packageId ? r.amountPaid : null,
            whatsappConsent: true,
          })),
        },
      });
      setResult(res.data);
      if (res.data.created) toast.success(`${res.data.created} ${res.data.created === 1 ? "member" : lower} imported.`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // ── result ──
  if (result) {
    return (
      <GymModal title="Import finished" onClose={onClose} size="lg" footer={<Button size="sm" onClick={onClose}>Done</Button>}>
        <div className="space-y-3 text-[13px]">
          <p className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-4" /> {result.created} imported{welcome ? ", welcome messages sent where possible" : ""}.</p>
          {result.skipped.length > 0 && (
            <div>
              <p className="mb-1.5 font-medium">{result.skipped.length} skipped</p>
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {result.skipped.map((s) => <li key={s.row} className="flex justify-between gap-3 rounded-lg border border-border/70 px-3 py-1.5 text-[12px]"><span className="truncate font-medium">{s.name || `Row ${s.row}`}</span><span className="shrink-0 text-muted-foreground">{s.reason}</span></li>)}
              </ul>
            </div>
          )}
        </div>
      </GymModal>
    );
  }

  // ── upload ──
  if (!data) {
    return (
      <GymModal title={`Import ${lower}`} subtitle="AI reads your file and fills in the details. You review everything before it's saved." onClose={onClose} size="lg">
        <input ref={input} type="file" hidden accept={ACCEPT} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void extract(f); }} />
        <button
          type="button"
          disabled={busy === "extract"}
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void extract(f); }}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border px-4 py-12 text-center transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:cursor-wait"
        >
          {busy === "extract" ? (
            <>
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Reading {file?.name}…</p>
              <p className="text-xs text-muted-foreground">Large registers and scanned pages can take up to a minute.</p>
            </>
          ) : (
            <>
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileUp className="size-5" /></span>
              <p className="text-sm font-medium">Drop a file here or click to choose</p>
              <p className="text-xs text-muted-foreground">Excel or CSV exports, PDF or Word registers, admission forms, or a photo of a register (up to 25 MB).</p>
            </>
          )}
        </button>
        <ul className="mt-4 grid gap-2 text-[12px] text-muted-foreground sm:grid-cols-3">
          <li className="flex gap-2"><Sparkles className="size-3.5 shrink-0 text-primary" /> Finds name, phone, package, dates, fees and health notes in any layout.</li>
          <li className="flex gap-2"><CheckCircle2 className="size-3.5 shrink-0 text-primary" /> Checks numbers, removes duplicates, matches your packages.</li>
          <li className="flex gap-2"><AlertTriangle className="size-3.5 shrink-0 text-primary" /> Existing members are skipped, never overwritten.</li>
        </ul>
      </GymModal>
    );
  }

  // ── review ──
  return (
    <GymModal
      size="xl"
      title={`Review ${rows.length} ${rows.length === 1 ? "member" : lower}`}
      subtitle={<span>{file?.name} · {data.validCount} ready{data.duplicatesRemoved ? ` · ${data.duplicatesRemoved} duplicates removed` : ""}{rows.length - data.validCount ? ` · ${rows.length - data.validCount} need fixing` : ""}</span>}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" className="mr-auto gap-1.5" onClick={() => { setData(null); setRows([]); }}><Upload className="size-3.5" /> Different file</Button>
          <label className="flex cursor-pointer items-center gap-2 text-[12px]"><input type="checkbox" className="size-4 rx-check" checked={welcome} onChange={(e) => setWelcome(e.target.checked)} /> Send WhatsApp welcome</label>
          <Button size="sm" disabled={busy === "import" || !selected.length} onClick={() => void commit()} className="gap-1.5">{busy === "import" ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Import {selected.length}</Button>
        </>
      }
    >
      {data.notes.length > 0 && <div className="mb-3 space-y-1">{data.notes.map((n) => <p key={n} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-700 dark:text-amber-300">{n}</p>)}</div>}
      {packages.length === 0 && <p className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-[12px] text-muted-foreground">You have no packages yet, so members are imported without one. The package named in the file is kept in their notes.</p>}
      <div className="overflow-x-auto rounded-xl border border-border/70">
        <table className="w-full min-w-[920px] table-fixed text-[12px]">
          <colgroup><col className="w-9" /><col className="w-[20%]" /><col className="w-[16%]" /><col className="w-[22%]" /><col className="w-[14%]" /><col className="w-[11%]" /><col className="w-[17%]" /></colgroup>
          <thead className="border-b border-border bg-muted/50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-2 pl-3"><input type="checkbox" className="size-4 rx-check" aria-label="Select all" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(allValid))} /></th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">WhatsApp</th>
              <th className="px-2 py-2">Package</th>
              <th className="px-2 py-2">Start date</th>
              <th className="px-2 py-2">Paid (₹)</th>
              <th className="px-2 py-2">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {rows.map((r, i) => {
              const ok = validRow(r);
              return (
                <tr key={i} className={picked.has(i) && ok ? "bg-primary/5" : ""}>
                  <td className="py-1.5 pl-3"><input type="checkbox" className="size-4 rx-check" disabled={!ok} checked={picked.has(i) && ok} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} aria-label={`Select ${r.name}`} /></td>
                  <td className="px-2 py-1.5"><Input className={`${cell} w-full`} value={r.name} onChange={(e) => update(i, { name: e.target.value })} /></td>
                  <td className="px-2 py-1.5">
                    <Input className={`${cell} w-full font-mono ${ok ? "" : "border-destructive/60"}`} value={r.phone} onChange={(e) => update(i, { phone: e.target.value })} title={r.issue} />
                    {!ok && <p className="mt-0.5 truncate text-[10px] text-destructive">{r.issue ?? "Check the number"}</p>}
                  </td>
                  <td className="px-2 py-1.5">
                    <select className={`${cell} w-full`} value={r.packageId ?? ""} onChange={(e) => update(i, { packageId: e.target.value || null })}>
                      <option value="">{r.packageName ? `Not matched: ${r.packageName}` : "No package"}</option>
                      {packages.map((p) => <option key={p.id} value={p.id}>{p.name} ({durationLabel(p.durationDays)})</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5"><Input type="date" className={`${cell} w-full`} value={r.startDate ?? ""} onChange={(e) => update(i, { startDate: e.target.value || null })} disabled={!r.packageId} /></td>
                  <td className="px-2 py-1.5"><Input className={`${cell} w-full`} inputMode="decimal" value={r.amountPaid ?? ""} onChange={(e) => update(i, { amountPaid: e.target.value === "" ? null : Number(e.target.value.replace(/[^\d.]/g, "")) })} disabled={!r.packageId} /></td>
                  <td className="truncate px-2 py-1.5 text-[11px] text-muted-foreground" title={[r.email, r.gender, r.dateOfBirth, r.address, r.medicalNotes].filter(Boolean).join(" · ")}>
                    {[r.email, r.gender, r.dateOfBirth && `DOB ${r.dateOfBirth}`, r.emergencyContactPhone && `SOS ${fmtPhone(r.emergencyContactPhone)}`, r.medicalNotes && "medical notes"].filter(Boolean).join(" · ") || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">A package is assigned only when both a package and a start date are set. Rows with a package but no start date are imported without one.</p>
    </GymModal>
  );
}
