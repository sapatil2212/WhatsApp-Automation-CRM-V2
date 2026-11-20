'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Check, CheckCircle2, Copy, ExternalLink, Loader2, Mic, MicOff, PenLine, RefreshCw, Sparkles, Star } from 'lucide-react';

import { REVIEW_LANGUAGES, type ReviewLanguage } from '@/lib/reviews/constants';

interface PageData {
  business: { name: string; category: string | null; description: string | null; logoUrl: string | null; defaultLanguage: string };
  campaign: string | null;
  googleConfigured: boolean;
  maxChars: number;
}
type Step = 'rate' | 'describe' | 'choose' | 'google';

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'rate', label: 'Rate' },
  { id: 'describe', label: 'Describe' },
  { id: 'choose', label: 'Review' },
  { id: 'google', label: 'Google' },
];
const RATING_WORDS = ['', 'Very poor', 'Poor', 'Okay', 'Good', 'Excellent'];

async function call<T>(path: string, init?: { method?: string; json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: init?.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
    cache: 'no-store',
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.success === false) throw new Error(body?.message || (res.status === 429 ? 'Too many requests. Please wait a minute and try again.' : 'Something went wrong. Please try again.'));
  return body.data as T;
}

function visitorId(): string {
  try {
    const k = 'cnx.review.visitor';
    const existing = localStorage.getItem(k);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(k, id);
    return id;
  } catch {
    return `anon${Math.random().toString(36).slice(2, 14)}`;
  }
}

type SpeechRec = { start(): void; stop(): void; abort(): void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

function useVoice(lang: string, onText: (t: string) => void) {
  const [listening, setListening] = useState(false);
  // Only rendered after the page data loads (client-side), so reading window here is safe.
  const [supported] = useState(() => typeof window !== 'undefined' && Boolean((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition));
  const rec = useRef<SpeechRec | null>(null);
  useEffect(() => {
    return () => rec.current?.abort();
  }, []);
  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += `${e.results[i][0].transcript} `;
      if (text.trim()) onText(text.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    try {
      r.start();
      rec.current = r;
      setListening(true);
    } catch {
      setListening(false);
    }
  };
  return { listening, supported, toggle };
}

export default function PublicReviewPage() {
  const { token } = useParams<{ token: string }>();
  const base = `/api/public/reviews/${token}`;
  const vid = useMemo(() => (typeof window === 'undefined' ? '' : visitorId()), []);
  const [page, setPage] = useState<PageData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('rate');
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [language, setLanguage] = useState<ReviewLanguage>('en');
  const [feedback, setFeedback] = useState('');
  const [drafts, setDrafts] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [aiText, setAiText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [googleUrl, setGoogleUrl] = useState<string | null>(null);
  const [jobState, setJobState] = useState<{ ready: boolean; failed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(false);

  const event = useCallback(
    (eventType: string, extra?: Record<string, unknown>) => {
      if (!vid) return;
      void fetch(`${base}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: vid, eventType, ...extra }), keepalive: true }).catch(() => undefined);
    },
    [base, vid],
  );

  useEffect(() => {
    let live = true;
    call<PageData>(base)
      .then((d) => {
        if (!live) return;
        setPage(d);
        setLanguage((REVIEW_LANGUAGES.some((l) => l.code === d.business.defaultLanguage) ? d.business.defaultLanguage : 'en') as ReviewLanguage);
        event('page_view');
      })
      .catch((e: Error) => live && setLoadError(e.message));
    return () => {
      live = false;
    };
  }, [base, event]);

  // Poll the preparation job while the customer is on the Google step.
  useEffect(() => {
    if (!jobId || step !== 'google' || jobState?.ready || jobState?.failed) return;
    const t = setInterval(() => {
      call<{ ready: boolean; failed: boolean }>(`${base}/status?jobId=${jobId}`).then(setJobState).catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [base, jobId, step, jobState]);

  const speechLang = REVIEW_LANGUAGES.find((l) => l.code === language)?.speech ?? 'en-IN';
  const voice = useVoice(speechLang, (t) => setFeedback((f) => `${f ? `${f} ` : ''}${t}`.slice(0, 1500)));

  const pickRating = (n: number) => {
    setRating(n);
    event('rating_selected', { rating: n });
    setStep('describe');
  };

  const generate = async () => {
    setBusy('generate');
    setError(null);
    event('feedback_submitted', { rating, language });
    try {
      const out = await call<{ drafts: string[] }>(`${base}/feedback`, { method: 'POST', json: { mode: 'generate', visitorId: vid, rating, language, feedback } });
      setDrafts(out.drafts);
      setText(out.drafts[0] ?? '');
      setAiText(out.drafts[0] ?? '');
      setStep('choose');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const transform = async (mode: 'translate' | 'shorten' | 'expand') => {
    if (text.trim().length < 8) return setError('Write a little more first.');
    setBusy(mode);
    setError(null);
    try {
      const out = await call<{ drafts: string[] }>(`${base}/feedback`, { method: 'POST', json: { mode, visitorId: vid, rating, language, text } });
      setText(out.drafts[0]);
      setAiText(out.drafts[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const writeMyself = () => {
    setDrafts([]);
    setText(feedback.trim());
    setAiText('');
    setStep('choose');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      event('review_copied', { rating, language });
      setTimeout(() => setCopied(false), 2500);
      return true;
    } catch {
      return false;
    }
  };

  const approve = async () => {
    if (!confirmed) return setError('Please confirm this review describes your own experience.');
    setBusy('approve');
    setError(null);
    try {
      const out = await call<{ jobId: string; googleUrl: string }>(`${base}/approve`, { method: 'POST', json: { visitorId: vid, rating, language, feedback, finalText: text.trim(), edited: text.trim() !== aiText.trim(), confirmed: true } });
      setJobId(out.jobId);
      setGoogleUrl(out.googleUrl);
      await copy();
      setStep('google');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openGoogle = async () => {
    await copy();
    event('google_opened', { rating, language });
    if (googleUrl) window.open(googleUrl, '_blank', 'noopener');
  };

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
        <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-semibold">This review page is not available</p>
          <p className="mt-2 text-sm text-slate-500">The link may be old or the business has paused it.</p>
        </div>
      </main>
    );
  }
  if (!page) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-md space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-200/70" />)}</div>
      </main>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const b = page.business;
  const shown = hover || rating;

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50 to-slate-50 px-4 py-6 text-slate-900 sm:py-10">
      <div className="mx-auto max-w-md space-y-4">
        {/* Business */}
        <header className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {b.logoUrl ? <img src={b.logoUrl} alt="" className="size-12 shrink-0 rounded-xl border border-slate-100 object-contain" /> : <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-100 text-base font-bold text-emerald-700">{b.name.slice(0, 2).toUpperCase()}</span>}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">{b.name}</h1>
            {b.category && <p className="truncate text-xs text-slate-500">{b.category}</p>}
          </div>
          <select aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value as ReviewLanguage)} className="h-8 rounded-lg border border-slate-200 bg-white px-1.5 text-xs">
            {REVIEW_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </header>

        {/* Progress */}
        <ol className="flex items-center gap-1.5" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.id} className="flex flex-1 items-center gap-1.5">
              <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${i < stepIndex ? 'bg-emerald-600 text-white' : i === stepIndex ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-600' : 'bg-slate-200 text-slate-500'}`}>{i < stepIndex ? <Check className="size-3" /> : i + 1}</span>
              <span className={`text-[11px] font-medium ${i === stepIndex ? 'text-emerald-700' : 'text-slate-500'}`}>{s.label}</span>
              {i < STEPS.length - 1 && <span className={`h-px flex-1 ${i < stepIndex ? 'bg-emerald-600' : 'bg-slate-200'}`} />}
            </li>
          ))}
        </ol>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {step === 'rate' && (
            <div className="text-center">
              <h2 className="text-lg font-semibold">How was your experience?</h2>
              {b.description && <p className="mt-1 text-xs text-slate-500">{b.description.slice(0, 160)}</p>}
              <div className="mt-5 flex justify-center gap-1.5" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onMouseEnter={() => setHover(n)} onClick={() => pickRating(n)} className="rounded-lg p-1 transition-transform duration-200 hover:scale-110 focus-visible:outline-2 focus-visible:outline-emerald-600">
                    <Star className={`size-10 ${n <= shown ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                  </button>
                ))}
              </div>
              <p className="mt-2 h-4 text-sm font-medium text-slate-600">{RATING_WORDS[shown]}</p>
            </div>
          )}

          {step === 'describe' && (
            <div>
              <button type="button" className="text-xs text-slate-500 hover:text-slate-900" onClick={() => setStep('rate')}>← Change rating ({rating}★)</button>
              <h2 className="mt-2 text-base font-semibold">Tell us what happened, in your own words</h2>
              <p className="mt-0.5 text-xs text-slate-500">A few words are enough. You can type or speak.</p>
              <div className="relative mt-3">
                <textarea value={feedback} onChange={(e) => setFeedback(e.target.value.slice(0, 1500))} rows={5} placeholder={rating <= 2 ? 'What went wrong?' : rating === 3 ? 'What was good, and what could be better?' : 'What did you like?'} className="w-full resize-none rounded-xl border border-slate-200 p-3 pr-12 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" />
                {voice.supported && (
                  <button type="button" onClick={voice.toggle} aria-label={voice.listening ? 'Stop voice input' : 'Speak your feedback'} className={`absolute right-2 top-2 grid size-9 place-items-center rounded-full transition-colors ${voice.listening ? 'animate-pulse bg-rose-500 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                    {voice.listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                  </button>
                )}
              </div>
              {voice.listening && <p className="mt-1 text-[11px] text-rose-600">Listening… tap the mic again to stop.</p>}
              {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">{error}</p>}
              <button type="button" onClick={generate} disabled={busy !== null} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60">
                {busy === 'generate' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {busy === 'generate' ? 'Preparing drafts…' : 'Help me write it'}
              </button>
              <button type="button" onClick={writeMyself} disabled={busy !== null} className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <PenLine className="size-4" /> I&apos;ll write it myself
              </button>
              <p className="mt-3 text-center text-[11px] text-slate-400">The AI only rewrites what you said. It never adds anything.</p>
            </div>
          )}

          {step === 'choose' && (
            <div>
              <button type="button" className="text-xs text-slate-500 hover:text-slate-900" onClick={() => setStep('describe')}>← Back</button>
              <h2 className="mt-2 text-base font-semibold">{drafts.length ? 'Pick a draft and edit it freely' : 'Your review'}</h2>
              {drafts.length > 1 && (
                <div className="mt-3 space-y-2">
                  {drafts.map((d, i) => (
                    <button key={i} type="button" onClick={() => { setText(d); setAiText(d); }} className={`w-full rounded-xl border p-3 text-left text-sm transition-colors ${text === d ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}>
                      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Option {i + 1}</span>
                      {d}
                    </button>
                  ))}
                </div>
              )}
              <label className="mt-3 block">
                <span className="text-[11px] font-medium text-slate-500">Final wording (you can edit)</span>
                <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, page.maxChars))} rows={5} className="mt-1 w-full resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" />
              </label>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {drafts.length > 0 && <button type="button" disabled={busy !== null} onClick={generate} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">{busy === 'generate' ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Regenerate</button>}
                <button type="button" disabled={busy !== null} onClick={() => transform('shorten')} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">{busy === 'shorten' ? '…' : 'Shorter'}</button>
                <button type="button" disabled={busy !== null} onClick={() => transform('expand')} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">{busy === 'expand' ? '…' : 'Longer'}</button>
                <button type="button" disabled={busy !== null} onClick={() => transform('translate')} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">{busy === 'translate' ? '…' : `Translate to ${REVIEW_LANGUAGES.find((l) => l.code === language)?.label.split(' ')[0]}`}</button>
                <button type="button" onClick={copy} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50">{copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />} {copied ? 'Copied' : 'Copy'}</button>
                <span className="ml-auto text-[10px] tabular-nums text-slate-400">{text.length}/{page.maxChars}</span>
              </div>
              <label className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4 accent-emerald-600" />
                <span>This review describes my own real experience, and I have read the wording.</span>
              </label>
              {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">{error}</p>}
              {page.googleConfigured ? (
                <button type="button" onClick={approve} disabled={busy !== null || text.trim().length < 8 || !confirmed} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
                  {busy === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Approve &amp; continue to Google
                </button>
              ) : (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">This business has not set up its Google review link yet. You can copy your review and share it with them directly.</p>
              )}
            </div>
          )}

          {step === 'google' && (
            <div className="text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="size-6" /></span>
              <h2 className="mt-3 text-base font-semibold">Last step: post it on Google</h2>
              <p className="mt-1 text-xs text-slate-500">Your review is copied. On Google, choose {rating} star{rating > 1 ? 's' : ''}, paste the text and press Post. Only you can publish it.</p>
              <p className="mt-3 rounded-xl bg-slate-50 p-3 text-left text-sm text-slate-700">{text}</p>
              <button type="button" onClick={copy} className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline">{copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? 'Copied' : 'Copy again'}</button>
              <button type="button" onClick={openGoogle} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-700">
                Open Google reviews <ExternalLink className="size-4" />
              </button>
              <p className="mt-2 h-4 text-[11px] text-slate-400">
                {jobState?.ready ? 'Google review page checked and ready.' : jobState?.failed ? 'We could not pre-check the page, but you can still open it.' : jobId ? 'Checking the Google page…' : ''}
              </p>
              {!done ? (
                <button type="button" onClick={() => { setDone(true); event('customer_reported_done', { rating, language, jobId: jobId ?? undefined }); }} className="mt-3 text-xs font-medium text-slate-600 underline-offset-2 hover:underline">I&apos;ve posted my review</button>
              ) : (
                <p className="mt-3 text-sm font-medium text-emerald-700">Thank you for sharing your experience!</p>
              )}
            </div>
          )}
        </section>

        <p className="text-center text-[10px] text-slate-400">No sign-up needed. Your feedback is only used to prepare your review. Powered by ChatNexGen.</p>
      </div>
    </main>
  );
}