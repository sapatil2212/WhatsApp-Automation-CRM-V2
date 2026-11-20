'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Mic, MicOff, RotateCcw, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { api } from '@/lib/campaigns/api';
import { AiModalShell } from './ai-modal-shell';

export interface Suggestion {
  chiefComplaint: Record<string, string>;
  vitals: Record<string, string>;
  diagnoses: Array<{ id: string; text: string; code?: string; source: 'ai'; verified: false }>;
  medicines: Array<Record<string, unknown> & { id: string; name: string; flags: string[] }>;
  investigations: string[];
  advice: Record<string, string>;
  followUpInDays: number | null;
  treatmentPlan: string;
  examination?: string;
}

/** Downmixes + resamples a recording to 16 kHz mono 16-bit WAV (Gemini-friendly, small). */
async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const rate = 16000;
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const pcm = (await offline.startRendering()).getChannelData(0);
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF');
    v.setUint32(4, 36 + pcm.length * 2, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, 'data');
    v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
    return new Blob([buf], { type: 'audio/wav' });
  } finally {
    void ctx.close();
  }
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

// ── microphone permission ────────────────────────────────────────────

export type MicState = 'checking' | 'granted' | 'prompt' | 'denied' | 'policy' | 'insecure' | 'unsupported' | 'nodevice' | 'busy';

export const MIC_HELP: Record<Exclude<MicState, 'checking' | 'granted'>, { title: string; body: string }> = {
  prompt: { title: 'Allow the microphone to dictate', body: 'Your browser will ask once. Choose “Allow on every visit” / “Allow while visiting the site” so it stays on.' },
  denied: { title: 'Microphone is blocked for this site', body: 'Click the lock / site-settings icon at the left of the address bar → Microphone → Allow, then press “Try again”.' },
  policy: { title: 'Microphone is turned off by the app’s security settings', body: 'The server is still sending the old Permissions-Policy header. Restart the app server, then reload this page.' },
  insecure: { title: 'Dictation needs a secure connection', body: 'Open the app over https:// (or http://localhost) to use the microphone.' },
  unsupported: { title: 'This browser can’t record audio', body: 'Use a recent Chrome, Edge or Safari. You can still type the dictation below.' },
  nodevice: { title: 'No microphone found', body: 'Connect or enable a microphone, then press “Try again”.' },
  busy: { title: 'Microphone is busy', body: 'Another app (Zoom, Teams, Meet…) is using it. Close that app, then press “Try again”.' },
};

const MIC_OK_KEY = 'cnx.mic.granted';
const MIC_ASKED_KEY = 'cnx.mic.asked';

function policyAllowsMic(): boolean {
  const d = document as unknown as { permissionsPolicy?: { allowsFeature(f: string): boolean }; featurePolicy?: { allowsFeature(f: string): boolean } };
  try {
    const p = d.permissionsPolicy ?? d.featurePolicy;
    return p ? p.allowsFeature('microphone') : true;
  } catch {
    return true;
  }
}

/**
 * Tracks the browser's microphone permission live and asks for it once.
 * The browser itself remembers "Allow", so after the first grant doctors
 * are never asked again.
 */
export function useMicPermission() {
  const [state, setState] = useState<MicState>('checking');

  const evaluate = useCallback(async (): Promise<MicState> => {
    if (typeof window === 'undefined') return 'checking';
    if (!window.isSecureContext) return 'insecure';
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return 'unsupported';
    if (!policyAllowsMic()) return 'policy';
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'prompt';
    } catch {
      // Permissions API without "microphone" (older Firefox/Safari): rely on what we saw last time.
      try {
        return localStorage.getItem(MIC_OK_KEY) === '1' ? 'granted' : 'prompt';
      } catch {
        return 'prompt';
      }
    }
  }, []);

  const fromError = useCallback((e: unknown): Exclude<MicState, 'checking' | 'granted'> => {
    const name = (e as { name?: string })?.name ?? '';
    const next: Exclude<MicState, 'checking' | 'granted'> =
      !policyAllowsMic() || name === 'SecurityError'
        ? 'policy'
        : name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? 'denied'
          : name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError'
            ? 'nodevice'
            : name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError'
              ? 'busy'
              : 'denied';
    setState(next);
    return next;
  }, []);

  const markGranted = useCallback(() => {
    setState('granted');
    try {
      localStorage.setItem(MIC_OK_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  }, []);

  /** Opens the browser's permission prompt (or confirms an existing grant). */
  const request = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop()); // only asking — release the device
      markGranted();
      return true;
    } catch (e) {
      fromError(e);
      return false;
    }
  }, [fromError, markGranted]);

  useEffect(() => {
    let live = true;
    let status: PermissionStatus | null = null;
    const onChange = () => {
      if (status && live) setState(status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'prompt');
    };
    void evaluate().then(async (s) => {
      if (!live) return;
      setState(s);
      // Ask once, right away, the first time this browser opens a consultation.
      if (s === 'prompt') {
        let asked = false;
        try {
          asked = sessionStorage.getItem(MIC_ASKED_KEY) === '1';
          sessionStorage.setItem(MIC_ASKED_KEY, '1');
        } catch {
          /* ignore */
        }
        if (!asked) void request();
      }
      try {
        status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        status.addEventListener('change', onChange);
      } catch {
        /* no live updates in this browser */
      }
    });
    return () => {
      live = false;
      status?.removeEventListener('change', onChange);
    };
  }, [evaluate, request]);

  const retry = useCallback(async () => {
    const s = await evaluate();
    if (s === 'granted') return setState('granted');
    if (s === 'policy' || s === 'insecure' || s === 'unsupported') return setState(s);
    await request();
  }, [evaluate, request]);

  return { state, request, retry, markGranted, fromError };
}

export function MicBanner({ state, onAllow, onRetry }: { state: MicState; onAllow: () => void; onRetry: () => void }) {
  if (state === 'granted' || state === 'checking') return null;
  const help = MIC_HELP[state];
  const tone = state === 'prompt' ? 'border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-200' : 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200';
  return (
    <div className={`mt-3 flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3 text-sm ${tone}`} role="status">
      <div className="flex min-w-0 gap-2">
        {state === 'prompt' ? <Mic className="mt-0.5 size-4 shrink-0" /> : <MicOff className="mt-0.5 size-4 shrink-0" />}
        <div>
          <p className="font-medium">{help.title}</p>
          <p className="text-xs opacity-90">{help.body}</p>
        </div>
      </div>
      {state === 'prompt' && <Button size="sm" onClick={onAllow} className="gap-1.5"><Mic className="size-3.5" /> Turn on microphone</Button>}
      {(state === 'denied' || state === 'nodevice' || state === 'busy') && <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5"><RotateCcw className="size-3.5" /> Try again</Button>}
    </div>
  );
}

type Phase = 'idle' | 'recording' | 'transcribing' | 'structuring';

/**
 * "AI Voice Prescription": the doctor speaks in any language, the AI
 * transcribes it, structures it and fills the prescription form. Audio is
 * never stored; the transcript is kept for audit. Every field lands as an
 * unconfirmed suggestion.
 */
export function VoiceRxModal({ consultationId, onClose, onSuggestion }: { consultationId: string; onClose: () => void; onSuggestion: (s: Suggestion) => void }) {
  const mic = useMicPermission();
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState('');

  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const raf = useRef<number | null>(null);
  const secondsRef = useRef(0);

  const stopMeters = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (raf.current) cancelAnimationFrame(raf.current);
    timer.current = null;
    raf.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    setLevel(0);
  }, []);
  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => () => {
    stopMeters();
    releaseMic();
    if (recRef.current && recRef.current.state !== 'inactive') {
      recRef.current.onstop = null;
      recRef.current.stop();
    }
  }, [stopMeters, releaseMic]);

  const start = async () => {
    setError(null);
    setHeard('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      mic.markGranted();
      streamRef.current = stream;
      chunks.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.start(1000);
      recRef.current = rec;
      secondsRef.current = 0;
      setSeconds(0);
      setPhase('recording');
      timer.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1000);
      const ac = new AudioContext();
      ctxRef.current = ac;
      const an = ac.createAnalyser();
      ac.createMediaStreamSource(stream).connect(an);
      const data = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(data);
        let peak = 0;
        for (const x of data) peak = Math.max(peak, Math.abs(x - 128));
        setLevel(peak / 128);
        raf.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      const next = mic.fromError(e);
      toast.error(MIC_HELP[next].title, { description: MIC_HELP[next].body, duration: 10000 });
    }
  };

  const finish = async () => {
    const rec = recRef.current;
    if (!rec) return;
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.stop();
    await done;
    stopMeters();
    releaseMic();
    if (secondsRef.current < 1) {
      setPhase('idle');
      return setError('That was too short. Tap the mic and speak the prescription.');
    }
    setPhase('transcribing');
    try {
      const wav = await toWav(new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }));
      const tr = await api<{ text: string }>(`/api/healthcare/consultations/${consultationId}/transcribe`, { method: 'POST', json: { audioBase64: await toBase64(wav), mimeType: 'audio/wav' } });
      const text = tr.data.text;
      setHeard(text);
      setPhase('structuring');
      const res = await api<{ suggestion: Suggestion }>(`/api/healthcare/consultations/${consultationId}/extract`, {
        method: 'POST',
        json: { originalText: text, source: 'voice', audioSeconds: secondsRef.current },
      });
      onSuggestion(res.data.suggestion);
      toast.success('Prescription filled from your voice — review and confirm each line.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
    } finally {
      chunks.current = [];
    }
  };

  const cancel = () => {
    if (recRef.current && recRef.current.state !== 'inactive') {
      recRef.current.onstop = null;
      recRef.current.stop();
    }
    stopMeters();
    releaseMic();
    onClose();
  };

  const busy = phase === 'transcribing' || phase === 'structuring';
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const blocked = mic.state === 'policy' || mic.state === 'insecure' || mic.state === 'unsupported';

  return (
    <AiModalShell title="AI Voice Prescription" subtitle="Speak in any language: English, Hindi, Marathi or a mix. AI listens, then fills the prescription for your review." icon={<Mic className="size-4" />} busy={busy} onClose={cancel}>
      <MicBanner state={mic.state} onAllow={() => void mic.request()} onRetry={() => void mic.retry()} />

      <div className="flex flex-col items-center gap-3 py-4">
        {phase === 'idle' && (
          <>
            <button type="button" onClick={start} disabled={blocked} aria-label="Start recording" className="grid size-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform duration-300 hover:scale-105 disabled:opacity-50">
              <Mic className="size-7" />
            </button>
            <p className="text-xs text-muted-foreground">Tap the mic and dictate the consultation and medicines.</p>
          </>
        )}

        {phase === 'recording' && (
          <>
            <div className="relative grid size-16 place-items-center">
              <span className="absolute inset-0 rounded-full bg-red-500/25 transition-transform duration-100" style={{ transform: `scale(${1 + Math.min(level * 1.6, 0.9)})` }} />
              <button type="button" onClick={finish} aria-label="Stop and fill prescription" className="relative grid size-16 place-items-center rounded-full bg-red-500 text-white shadow-lg">
                <Square className="size-6 fill-current" />
              </button>
            </div>
            <p className="flex items-center gap-2 text-sm font-medium tabular-nums" role="status" aria-live="polite">
              <span className="size-2 animate-pulse rounded-full bg-red-500" /> Listening… {mmss}
            </p>
            <p className="text-xs text-muted-foreground">Tap the square when you are done.</p>
          </>
        )}

        {busy && (
          <>
            <Loader2 className="size-9 animate-spin text-primary" />
            <p className="text-sm font-medium" role="status" aria-live="polite">{phase === 'transcribing' ? 'Listening to your recording…' : 'Filling the prescription…'}</p>
            {heard && <p className="max-h-24 w-full overflow-y-auto rounded-md bg-muted/60 p-2 text-xs italic text-muted-foreground">{heard}</p>}
          </>
        )}
      </div>

      {error && <p className="mb-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive" role="alert">{error}</p>}

      <p className="text-[11px] leading-relaxed text-muted-foreground">Audio is not stored. The transcript is kept for audit. AI only structures what you said; every field stays unconfirmed until you review it.</p>
      {phase === 'recording' && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={cancel}>Cancel</Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={finish}><Square className="size-3 fill-current" /> Stop &amp; fill prescription</Button>
        </div>
      )}
    </AiModalShell>
  );
}