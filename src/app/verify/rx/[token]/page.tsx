'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, ShieldAlert } from 'lucide-react';

interface Result { valid: boolean; prescriptionNo?: string; issuedAt?: string | null; clinic?: string; doctor?: string | null; patientInitials?: string | null; sha256?: string | null }

/** Public QR target: confirms a prescription is genuine without exposing patient details. */
export default function VerifyPrescriptionPage() {
  const { token } = useParams<{ token: string }>();
  const [r, setR] = useState<Result | null>(null);
  useEffect(() => {
    fetch(`/api/public/rx/${token}`)
      .then((x) => x.json())
      .then((b) => setR(b?.data ?? { valid: false }))
      .catch(() => setR({ valid: false }));
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {!r ? (
          <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
        ) : r.valid ? (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold text-emerald-700"><CheckCircle2 className="size-6" /> Genuine prescription</p>
            <dl className="mt-4 grid grid-cols-[120px_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">Prescription</dt><dd className="font-mono">{r.prescriptionNo}</dd>
              <dt className="text-slate-500">Issued</dt><dd>{r.issuedAt ? new Date(r.issuedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd>
              <dt className="text-slate-500">Clinic</dt><dd>{r.clinic}</dd>
              <dt className="text-slate-500">Doctor</dt><dd>{r.doctor ?? '—'}</dd>
              <dt className="text-slate-500">Patient</dt><dd>{r.patientInitials ?? '—'}</dd>
            </dl>
            <p className="mt-4 break-all text-[11px] text-slate-400">Document fingerprint (SHA-256): {r.sha256}</p>
          </>
        ) : (
          <p className="flex items-center gap-2 text-lg font-semibold text-rose-700"><ShieldAlert className="size-6" /> Prescription not found</p>
        )}
        <p className="mt-6 text-center text-[11px] text-slate-400">Verified by ChatNexGen</p>
      </div>
    </main>
  );
}
