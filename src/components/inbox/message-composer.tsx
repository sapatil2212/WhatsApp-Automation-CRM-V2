"use client";

import { useState, useRef, useCallback, KeyboardEvent } from "react";
import { Send, LayoutTemplate, Sparkles, Loader2, Wand2, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ReplyQuote } from "./reply-quote";

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  onSend: (text: string, replyToId?: string) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
  recentMessages?: Array<{ senderType: "customer" | "agent" | "bot"; text: string }>;
}

export function MessageComposer({
  conversationId,
  sessionExpired,
  onSend,
  onOpenTemplates,
  replyTo,
  onClearReply,
  recentMessages,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || sessionExpired) return;

    setSending(true);
    try {
      onSend(trimmed, replyTo?.id);
      setText("");
      setAiSuggestions([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  }, [text, sending, sessionExpired, onSend, replyTo?.id]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  // Fetch AI smart reply suggestions
  const handleFetchAiSuggestions = async () => {
    if (aiLoading || !recentMessages || recentMessages.length === 0) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "suggest_replies",
          conversationId,
          recentMessages: recentMessages.filter((m) => m.text.trim().length > 0),
        }),
      });
      if (res.ok) {
        const body = await res.json();
        if (body.data?.suggestions) {
          setAiSuggestions(body.data.suggestions);
        }
      }
    } catch (err) {
      console.error("Failed to fetch AI suggestions:", err);
    } finally {
      setAiLoading(false);
    }
  };

  // Polish draft with selected style
  const handlePolishDraft = async (style: "professional" | "friendly" | "concise" | "fix_grammar") => {
    if (!text.trim() || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "polish_draft",
          text: text.trim(),
          style,
        }),
      });
      if (res.ok) {
        const body = await res.json();
        if (body.data?.polished) {
          setText(body.data.polished);
          setTimeout(adjustHeight, 50);
        }
      }
    } catch (err) {
      console.error("Failed to polish text:", err);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="border-t border-slate-800 bg-slate-900 p-3 space-y-2">
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}

      {sessionExpired && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">
            24-hour session expired. Use a template to re-engage.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-400 hover:text-amber-300"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            Templates
          </Button>
        </div>
      )}

      {/* AI Smart Suggestions Chips Bar */}
      {aiSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-800/80 p-2 border border-violet-500/30 animate-in fade-in duration-200">
          <span className="text-[11px] font-semibold text-violet-400 flex items-center gap-1 shrink-0">
            <Sparkles className="h-3 w-3" /> Suggestions:
          </span>
          {aiSuggestions.map((suggestion, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setText(suggestion);
                setAiSuggestions([]);
                setTimeout(adjustHeight, 50);
              }}
              className="text-xs bg-slate-900 hover:bg-violet-950/60 border border-slate-700 hover:border-violet-500/50 text-slate-200 hover:text-white rounded-md px-2.5 py-1 text-left transition-colors truncate max-w-xs"
              title={suggestion}
            >
              {suggestion}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAiSuggestions([])}
            className="text-[10px] text-slate-400 hover:text-slate-200 ml-auto"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white"
          onClick={onOpenTemplates}
          title="Send template"
        >
          <LayoutTemplate className="h-4 w-4" />
        </Button>

        {/* AI Smart Suggest Button */}
        <Button
          variant="ghost"
          size="sm"
          disabled={sessionExpired || aiLoading}
          onClick={handleFetchAiSuggestions}
          className="h-9 shrink-0 px-2.5 text-xs text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 border border-violet-500/20"
          title="Get AI smart reply suggestions"
        >
          {aiLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1" />
          )}
          AI Suggest
        </Button>

        {/* AI Polish Dropdown (active when text exists) */}
        {text.trim().length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={aiLoading}
              className="inline-flex items-center justify-center h-9 shrink-0 px-2 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 border border-indigo-500/20 rounded-md transition-colors disabled:opacity-50"
              title="Polish draft with AI"
            >
              <Wand2 className="h-3.5 w-3.5 mr-1" />
              Polish
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="bg-slate-900 border-slate-700 text-slate-200 w-48">
              <DropdownMenuItem
                onClick={() => handlePolishDraft("professional")}
                className="text-xs hover:bg-slate-800 cursor-pointer"
              >
                👔 Professional & Polite
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handlePolishDraft("friendly")}
                className="text-xs hover:bg-slate-800 cursor-pointer"
              >
                😊 Friendly & Warm
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handlePolishDraft("concise")}
                className="text-xs hover:bg-slate-800 cursor-pointer"
              >
                ⚡ Concise & Direct
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handlePolishDraft("fix_grammar")}
                className="text-xs hover:bg-slate-800 cursor-pointer"
              >
                ✨ Fix Grammar & Spelling
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            sessionExpired
              ? "Session expired - use a template"
              : "Type a message... (Shift+Enter for new line)"
          }
          disabled={sessionExpired}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-primary/50",
            sessionExpired && "cursor-not-allowed opacity-50"
          )}
        />

        <Button
          size="sm"
          className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
          disabled={!text.trim() || sessionExpired || sending}
          onClick={handleSend}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Hint */}
      <p className="mt-1 pl-11 text-[10px] text-slate-600">
        Type &apos;/&apos; for quick replies · Click &quot;AI Suggest&quot; for instant replies
      </p>
    </div>
  );
}
