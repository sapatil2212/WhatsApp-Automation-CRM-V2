'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw, Send, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type ChatMsg = { role: 'user' | 'ai'; text: string };

const WELCOME: ChatMsg = {
  role: 'ai',
  text: "Hi! I'm your WhatsApp AI receptionist. Ask what a patient would ask (timings, fees, doctors, policies) to check what I've learned.",
};
const SUGGESTIONS = ['What are your timings?', 'What is the consultation fee?', 'Which doctors are available?', 'Where are you located?'];

interface Props {
  /** Knowledge text to test with (the editor's current, possibly unsaved, text). */
  knowledgeText: string;
  /** True when knowledgeText differs from what is saved. */
  unsaved: boolean;
  className?: string;
}

/**
 * Ask the AI test questions. Answers use the given knowledge text plus the
 * saved doctors, services and FAQs (see /api/healthcare/knowledge-base/test).
 */
export function AiTestChat({ knowledgeText, unsaved, className }: Props) {
  const [chat, setChat] = useState<ChatMsg[]>([WELCOME]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, busy]);

  const ask = async (q: string) => {
    const msg = q.trim();
    if (!msg || busy) return;
    setQuery('');
    setChat((prev) => [...prev, { role: 'user', text: msg }]);
    setBusy(true);
    try {
      const res = await fetch('/api/healthcare/knowledge-base/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, knowledgeBaseText: knowledgeText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not reach the AI.');
      setChat((prev) => [...prev, { role: 'ai', text: data.reply || 'No reply generated.' }]);
    } catch (err) {
      setChat((prev) => [...prev, { role: 'ai', text: `⚠️ ${(err as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('flex flex-col rounded-xl border border-border/70 bg-card', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">Test the AI</p>
          <p className={cn('text-[10px] font-medium', unsaved ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
            {unsaved ? 'Using your unsaved text' : 'Using saved knowledge'}
          </p>
        </div>
        {chat.length > 1 && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setChat([WELCOME])}>
            <RotateCcw className="size-3.5" /> Clear
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="h-[360px] space-y-2 overflow-y-auto bg-muted/20 p-3">
        {chat.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed',
                m.role === 'user' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm border border-border/70 bg-card text-foreground shadow-sm'
              )}
            >
              {m.role === 'ai' && <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold text-primary"><Sparkles className="size-3" /> WhatsApp AI</p>}
              <p className="whitespace-pre-wrap">{m.text}</p>
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-card px-3 py-2 text-[12.5px] text-muted-foreground shadow-sm">
              <Loader2 className="size-3.5 animate-spin text-primary" /> Thinking…
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border/70 p-2.5">
        {chat.length <= 1 && (
          <div className="flex flex-wrap gap-1">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground">
                {s}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); void ask(query); }} className="flex gap-1.5">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a patient question…" className="h-8 text-[13px]" disabled={busy} />
          <Button type="submit" size="sm" disabled={!query.trim() || busy} className="gap-1" aria-label="Send"><Send className="size-3.5" /></Button>
        </form>
      </div>
    </div>
  );
}
