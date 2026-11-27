'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Check, CheckCircle2, ChevronRight, Copy, ExternalLink, Loader2, Mic, MicOff, PenLine, RefreshCw, Star } from 'lucide-react';

import { REVIEW_LANGUAGES, type ReviewLanguage } from '@/lib/reviews/constants';
import { PLATFORM, type SocialPlatform } from '@/lib/reviews/social-platforms';
import { GoogleLogo, SocialLogo } from '@/components/reviews/social-logo';

interface PageData {
  business: { name: string; category: string | null; description: string | null; logoUrl: string | null; defaultLanguage: string };
  campaign: string | null;
  googleConfigured: boolean;
  socialLinks: Array<{ platform: SocialPlatform; url: string }>;
  services: string[];
  maxChars: number;
}
type Step = 'hub' | 'rate' | 'describe' | 'choose' | 'google';

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'rate', label: 'Rate' },
  { id: 'describe', label: 'Describe' },
  { id: 'choose', label: 'Review' },
  { id: 'google', label: 'Post' },
];
const RATING_WORDS = ['', 'Very poor', 'Poor', 'Okay', 'Good', 'Excellent'];
/** Tap-to-select highlights; the customer chooses what applies, the AI only uses what they chose. */
const HIGHLIGHTS: Record<'good' | 'mixed' | 'bad', string[]> = {
  good: ['Friendly staff', 'Clean and well kept', 'Professional service', 'Good value for money', 'Quick and on time', 'Great results'],
  mixed: ['Friendly staff', 'Clean and well kept', 'Long waiting time', 'Could be better value', 'Service was slow', 'Good results'],
  bad: ['Long waiting time', 'Staff were not helpful', 'Not clean', 'Too expensive', 'Service was slow', 'Problem not solved'],
};
const moodFor = (r: number) => (r >= 4 ? 'good' : r === 3 ? 'mixed' : 'bad');

// Shared styles: compact, neutral, one accent colour.
const btnPrimary = 'flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[13px] font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50';
const btnSecondary = 'flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50';
const btnTool = 'inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 text-[12px] text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50';
const chip = (on: boolean) => `rounded-md border px-2 py-1 text-[12px] leading-none transition-colors ${on ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'}`;
const label = 'text-[11px] font-medium uppercase tracking-wide text-slate-500';
const textarea = 'w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15';

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

function BackLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900">
      <ArrowLeft className="size-3.5" /> {children}
    </button>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12px] text-rose-700" role="alert">{children}</p>;
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
  const [usedServices, setUsedServices] = useState<string[]>([]);
  const [highlights, setHighlights] = useState<string[]>([]);
  // Option 1 on the Describe step: ready-made drafts from the rating and the tapped highlights.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestKey, setSuggestKey] = useState<string | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

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
        if (d.socialLinks?.length) setStep('hub');
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

  /** The highlights the customer tapped, as plain sentences the AI may use. */
  const chipsText = (r: number, services: string[], picked: string[]) =>
    [
      services.length ? `Service I used: ${services.join(', ')}.` : '',
      picked.length ? `${r <= 2 ? 'What went wrong' : r === 3 ? 'What I noticed' : 'What I liked'}: ${picked.join(', ')}.` : '',
    ].filter(Boolean).join(' ');

  /** The customer's own words plus the highlights they tapped. */
  const composedFeedback = () => [feedback.trim(), chipsText(rating, usedServices, highlights)].filter(Boolean).join(' ').slice(0, 1500);

  const keyFor = (r: number, lang: string, services: string[], picked: string[]) => JSON.stringify([r, lang, [...services].sort(), [...picked].sort()]);
  const currentKey = keyFor(rating, language, usedServices, highlights);

  const loadSuggestions = async (r: number, lang: ReviewLanguage, services: string[], picked: string[]) => {
    setSuggestBusy(true);
    setSuggestError(null);
    setSuggestKey(keyFor(r, lang, services, picked));
    try {
      const out = await call<{ drafts: string[] }>(`${base}/feedback`, { method: 'POST', json: { mode: 'generate', visitorId: vid, rating: r, language: lang, feedback: chipsText(r, services, picked) } });
      setSuggestions(out.drafts);
    } catch (e) {
      setSuggestions([]);
      setSuggestError((e as Error).message);
    } finally {
      setSuggestBusy(false);
    }
  };

  const pickRating = (n: number) => {
    const changed = n !== rating;
    setRating(n);
    event('rating_selected', { rating: n });
    setError(null);
    setStep('describe');
    if (changed) {
      // Highlights depend on the mood of the rating.
      setHighlights([]);
      void loadSuggestions(n, language, usedServices, []);
    }
  };

  const toggle = (list: string[], set: (v: string[]) => void, item: string) => set(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const openSocial = (platform: SocialPlatform, url: string) => {
    event('social_opened', { platform });
    window.open(url, '_blank', 'noopener');
  };

  const chooseSuggestion = (s: string) => {
    setDrafts(suggestions);
    setText(s);
    setAiText(s);
    setError(null);
    event('feedback_submitted', { rating, language });
    setStep('choose');
  };

  const generate = async () => {
    setBusy('generate');
    setError(null);
    event('feedback_submitted', { rating, language });
    try {
      const out = await call<{ drafts: string[] }>(`${base}/feedback`, { method: 'POST', json: { mode: 'generate', visitorId: vid, rating, language, feedback: composedFeedback() } });
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
    setText(composedFeedback());
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
      const out = await call<{ jobId: string; googleUrl: string }>(`${base}/approve`, { method: 'POST', json: { visitorId: vid, rating, language, feedback: composedFeedback(), finalText: text.trim(), edited: text.trim() !== aiText.trim(), confirmed: true } });
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
        <div className="max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center">
          <p className="text-[15px] font-semibold">This review page is not available</p>
          <p className="mt-1 text-[13px] text-slate-500">The link may be old or the business has paused it.</p>
        </div>
      </main>
    );
  }
  if (!page) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto max-w-[440px] space-y-3">{[56, 220].map((h, i) => <div key={i} style={{ height: h }} className="animate-pulse rounded-xl bg-slate-200/60" />)}</div>
      </main>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const b = page.business;
  const shown = hover || rating;
  const stale = suggestKey !== currentKey;
  const languageName = REVIEW_LANGUAGES.find((l) => l.code === language)?.label.split(' ')[0];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900 sm:py-8">
      <div className="mx-auto max-w-[440px]">
        {/* Business */}
        <header className="flex items-center gap-2.5 px-0.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {b.logoUrl ? <img src={b.logoUrl} alt="" className="size-10 shrink-0 rounded-lg border border-slate-200 bg-white object-contain" /> : <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-900 text-[13px] font-semibold text-white">{b.name.slice(0, 2).toUpperCase()}</span>}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[14px] font-semibold leading-tight">{b.name}</h1>
            {b.category && <p className="truncate text-[12px] text-slate-500">{b.category}</p>}
          </div>
          <select aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value as ReviewLanguage)} className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[12px] text-slate-700 outline-none focus:border-emerald-500">
            {REVIEW_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </header>

        <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {/* Progress */}
          {step !== 'hub' && (
            <div className="border-b border-slate-100 px-4 py-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-slate-700">{STEPS[stepIndex]?.label}</span>
                <span className="tabular-nums text-slate-400">Step {stepIndex + 1} of {STEPS.length}</span>
              </div>
              <div className="mt-1.5 grid grid-cols-4 gap-1" aria-hidden>
                {STEPS.map((s, i) => <span key={s.id} className={`h-1 rounded-full ${i <= stepIndex ? 'bg-emerald-600' : 'bg-slate-200'}`} />)}
              </div>
            </div>
          )}

          <div className="p-4">
            {step === 'hub' && (
              <div>
                <h2 className="text-[15px] font-semibold">Connect with {b.name}</h2>
                <p className="mt-0.5 text-[12px] text-slate-500">Choose where you&apos;d like to go.</p>
                <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                  {page.googleConfigured && (
                    <li>
                      <button type="button" onClick={() => setStep('rate')} className="flex w-full items-center gap-3 bg-emerald-50/40 px-3 py-2.5 text-left transition-colors hover:bg-emerald-50">
                        <GoogleLogo />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold">Review us on Google</span>
                          <span className="block text-[11px] text-slate-500">Takes under a minute, with writing help</span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
                      </button>
                    </li>
                  )}
                  {page.socialLinks.map((l) => (
                    <li key={l.platform}>
                      <button type="button" onClick={() => openSocial(l.platform, l.url)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50">
                        <SocialLogo platform={l.platform} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium">{PLATFORM[l.platform].cta}</span>
                          <span className="block truncate text-[11px] text-slate-500">{l.url.replace(/^https:\/\/(www\.)?/, '').replace(/\?.*$/, '').replace(/\/$/, '')}</span>
                        </span>
                        <ExternalLink className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {step === 'rate' && (
              <div>
                {page.socialLinks.length > 0 && <BackLink onClick={() => setStep('hub')}>All links</BackLink>}
                <div className="py-3 text-center">
                  <h2 className="text-[15px] font-semibold">How was your experience?</h2>
                  <p className="mt-0.5 text-[12px] text-slate-500">Tap a star to rate {b.name}.</p>
                  <div className="mt-4 flex justify-center gap-1" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onMouseEnter={() => setHover(n)} onClick={() => pickRating(n)} className="rounded-md p-1 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-emerald-600">
                        <Star className={`size-8 ${n <= shown ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} strokeWidth={1.5} />
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 h-4 text-[12px] font-medium text-slate-600">{RATING_WORDS[shown]}</p>
                </div>
              </div>
            )}

            {step === 'describe' && (
              <div>
                <BackLink onClick={() => setStep('rate')}>Change rating ({rating}★)</BackLink>

                {/* Option 1: ready-made drafts */}
                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <h2 className="text-[15px] font-semibold">Pick a suggested review</h2>
                  <button type="button" disabled={suggestBusy} onClick={() => void loadSuggestions(rating, language, usedServices, highlights)} className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-emerald-700 hover:text-emerald-800 disabled:opacity-50">
                    <RefreshCw className={`size-3 ${suggestBusy ? 'animate-spin' : ''}`} /> {stale && !suggestBusy ? 'Update' : 'New ones'}
                  </button>
                </div>
                <p className="mt-0.5 text-[12px] text-slate-500">Tap one to use it. You can edit it on the next step.</p>

                {(page.services.length > 0 || HIGHLIGHTS[moodFor(rating)].length > 0) && (
                  <div className="mt-3 space-y-2">
                    {page.services.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="mr-1 text-[11px] text-slate-500">Service:</span>
                        {page.services.map((sv) => <button key={sv} type="button" aria-pressed={usedServices.includes(sv)} onClick={() => toggle(usedServices, setUsedServices, sv)} className={chip(usedServices.includes(sv))}>{sv}</button>)}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="mr-1 text-[11px] text-slate-500">{rating <= 2 ? 'What went wrong:' : rating === 3 ? 'You noticed:' : 'Stood out:'}</span>
                      {HIGHLIGHTS[moodFor(rating)].map((h) => <button key={h} type="button" aria-pressed={highlights.includes(h)} onClick={() => toggle(highlights, setHighlights, h)} className={chip(highlights.includes(h))}>{h}</button>)}
                    </div>
                    {stale && !suggestBusy && suggestions.length > 0 && <p className="text-[11px] text-amber-700">Tap Update to include what you selected.</p>}
                  </div>
                )}

                <div className="mt-3 space-y-1.5" aria-live="polite" aria-busy={suggestBusy}>
                  {suggestBusy ? (
                    [0, 1, 2].map((i) => (
                      <div key={i} className="space-y-1.5 rounded-lg border border-slate-200 px-3 py-2.5">
                        <div className="h-2.5 w-11/12 animate-pulse rounded bg-slate-200/80" />
                        <div className="h-2.5 w-2/3 animate-pulse rounded bg-slate-200/80" />
                      </div>
                    ))
                  ) : suggestions.length ? (
                    suggestions.map((s, i) => (
                      <button key={i} type="button" onClick={() => chooseSuggestion(s)} className="group flex w-full items-start gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-left transition-colors hover:border-emerald-500 hover:bg-emerald-50/40">
                        <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-slate-700">{s}</span>
                        <span className="mt-0.5 shrink-0 text-[11px] font-medium text-emerald-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Use</span>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-[12px] text-slate-500">
                      {suggestError ?? 'No suggestions yet.'}{' '}
                      <button type="button" onClick={() => void loadSuggestions(rating, language, usedServices, highlights)} className="font-medium text-emerald-700 hover:underline">Try again</button>
                    </div>
                  )}
                </div>

                {/* Option 2: the customer's own words */}
                <div className="my-4 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
                </div>

                <h3 className="text-[13px] font-semibold">Tell us what happened, in your own words</h3>
                <p className="mt-0.5 text-[12px] text-slate-500">Type or speak a few words. We&apos;ll turn them into a review.</p>
                <div className="relative mt-2">
                  <textarea value={feedback} onChange={(e) => setFeedback(e.target.value.slice(0, 1500))} rows={3} placeholder={rating <= 2 ? 'e.g. waited 40 minutes and nobody explained why' : rating === 3 ? 'e.g. good service, but the wait was long' : 'e.g. staff were helpful and everything was on time'} className={`${textarea} pr-10`} />
                  {voice.supported && (
                    <button type="button" onClick={voice.toggle} aria-label={voice.listening ? 'Stop voice input' : 'Speak your feedback'} className={`absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-md transition-colors ${voice.listening ? 'bg-rose-500 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}>
                      {voice.listening ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
                    </button>
                  )}
                </div>
                {voice.listening && <p className="mt-1 text-[11px] text-rose-600">Listening… tap the mic again to stop.</p>}
                {error && <ErrorNote>{error}</ErrorNote>}
                <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-2">
                  <button type="button" onClick={generate} disabled={busy !== null || feedback.trim().length < 3} className={btnPrimary}>
                    {busy === 'generate' ? <><Loader2 className="size-3.5 animate-spin" /> Writing…</> : 'Write my review'}
                  </button>
                  <button type="button" onClick={writeMyself} disabled={busy !== null} className={`${btnSecondary} w-auto`} title="Skip the AI and write it yourself">
                    <PenLine className="size-3.5" /> Write myself
                  </button>
                </div>
                <p className="mt-3 text-[11px] text-slate-400">Suggestions only use your rating and what you select or write. Nothing is posted without you.</p>
              </div>
            )}

            {step === 'choose' && (
              <div>
                <BackLink onClick={() => setStep('describe')}>Back</BackLink>
                <h2 className="mt-3 text-[15px] font-semibold">{drafts.length ? 'Review and edit' : 'Your review'}</h2>
                <p className="mt-0.5 text-[12px] text-slate-500">Make sure it says what you want. You can change any word.</p>
                {drafts.length > 1 && (
                  <div className="mt-3 flex gap-1" role="tablist" aria-label="Drafts">
                    {drafts.map((d, i) => (
                      <button key={i} type="button" role="tab" aria-selected={text === d} onClick={() => { setText(d); setAiText(d); }} className={`h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors ${text === d ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                        Draft {i + 1}
                      </button>
                    ))}
                  </div>
                )}
                <textarea aria-label="Review text" value={text} onChange={(e) => setText(e.target.value.slice(0, page.maxChars))} rows={5} className={`${textarea} mt-2`} />
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {drafts.length > 0 && <button type="button" disabled={busy !== null} onClick={generate} className={btnTool}>{busy === 'generate' ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Regenerate</button>}
                  <button type="button" disabled={busy !== null} onClick={() => transform('shorten')} className={btnTool}>{busy === 'shorten' ? <Loader2 className="size-3 animate-spin" /> : null} Shorter</button>
                  <button type="button" disabled={busy !== null} onClick={() => transform('expand')} className={btnTool}>{busy === 'expand' ? <Loader2 className="size-3 animate-spin" /> : null} Longer</button>
                  <button type="button" disabled={busy !== null} onClick={() => transform('translate')} className={btnTool}>{busy === 'translate' ? <Loader2 className="size-3 animate-spin" /> : null} {languageName}</button>
                  <button type="button" onClick={copy} className={btnTool}>{copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />} {copied ? 'Copied' : 'Copy'}</button>
                  <span className="ml-auto text-[11px] tabular-nums text-slate-400">{text.length}/{page.maxChars}</span>
                </div>
                <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-3.5 accent-emerald-600" />
                  <span>This describes my own experience and I have read the wording.</span>
                </label>
                {error && <ErrorNote>{error}</ErrorNote>}
                {page.googleConfigured ? (
                  <button type="button" onClick={approve} disabled={busy !== null || text.trim().length < 8 || !confirmed} className={`${btnPrimary} mt-3`}>
                    {busy === 'approve' ? <Loader2 className="size-3.5 animate-spin" /> : null} Continue to Google
                  </button>
                ) : (
                  <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-800">This business has not set up its Google review link yet. You can copy your review and share it with them directly.</p>
                )}
              </div>
            )}

            {step === 'google' && (
              <div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                  <div>
                    <h2 className="text-[15px] font-semibold">Post it on Google</h2>
                    <p className="mt-0.5 text-[12px] text-slate-500">Your review is copied. On Google, choose {rating} star{rating > 1 ? 's' : ''}, paste the text and tap Post.</p>
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-[13px] leading-relaxed text-slate-700">{text}</p>
                  <button type="button" onClick={copy} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 hover:underline">{copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? 'Copied' : 'Copy again'}</button>
                </div>
                <button type="button" onClick={openGoogle} className={`${btnPrimary} mt-3`}>
                  Open Google reviews <ExternalLink className="size-3.5" />
                </button>
                <p className="mt-1.5 h-4 text-center text-[11px] text-slate-400">
                  {jobState?.ready ? 'Google review page checked and ready.' : jobState?.failed ? 'We could not pre-check the page, but you can still open it.' : jobId ? 'Checking the Google page…' : ''}
                </p>
                {!done ? (
                  <button type="button" onClick={() => { setDone(true); event('customer_reported_done', { rating, language, jobId: jobId ?? undefined }); }} className={`${btnSecondary} mt-2`}>I&apos;ve posted my review</button>
                ) : (
                  <p className="mt-2 text-center text-[13px] font-medium text-emerald-700">Thank you for sharing your experience.</p>
                )}
                {page.socialLinks.length > 0 && (
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <p className={label}>Stay connected</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {page.socialLinks.map((l) => (
                        <button key={l.platform} type="button" onClick={() => openSocial(l.platform, l.url)} aria-label={PLATFORM[l.platform].cta} title={PLATFORM[l.platform].cta} className="rounded-lg transition-opacity hover:opacity-80">
                          <SocialLogo platform={l.platform} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <p className="mt-3 text-center text-[11px] text-slate-400">No sign-up needed. Your feedback is only used to prepare your review. Powered by ChatNexGen.</p>
      </div>
    </main>
  );
}
