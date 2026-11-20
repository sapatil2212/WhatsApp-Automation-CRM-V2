"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Lock,
  Mic,
  Paperclip,
  Plus,
  SendHorizontal,
  Smile,
  Sparkles,
  StickyNote,
  Wand2,
  X,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { QuickReply } from "./types";

const EMOJI_GROUPS: Array<{ label: string; emojis: string[] }> = [
  {
    label: "Smileys",
    emojis: "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😌 😍 🥰 😘 😋 😛 😜 🤪 🤗 🤭 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😴 😷 🤒 🤕 🥳 😎 🤓 😕 😟 🙁 😮 😯 😲 😳 🥺 😢 😭 😱 😖 😞 😓 😩 😫 😤 😡 😠".split(" "),
  },
  {
    label: "Gestures",
    emojis: "👍 👎 👌 ✌️ 🤞 🤝 🙏 👏 🙌 👋 🤙 💪 👉 👈 👆 👇 ✋ 🤚 🖐️ ✍️ 💅".split(" "),
  },
  {
    label: "Hearts & symbols",
    emojis: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💯 ✅ ❌ ⭐ 🌟 ✨ 🔥 🎉 🎊 🎁 📌 📍 ⏰ 📅 📞 💬 ⚠️ ❓ ❗".split(" "),
  },
  {
    label: "Health & places",
    emojis: "🏥 🩺 💊 💉 🩹 🦷 👨‍⚕️ 👩‍⚕️ 🚑 🏠 🏢 🚗 ✈️ ☕ 🍕 🎂 🌸 🌞 🌙 ☔".split(" "),
  },
];

export interface ComposerHandle {
  focus: () => void;
  insert: (text: string) => void;
}

interface ComposerProps {
  conversationId: string;
  windowExpired: boolean;
  disabledReason?: string | null;
  replyTo: { authorLabel: string; preview: string } | null;
  onClearReply: () => void;
  onSendText: (text: string) => void;
  onSendNote: (text: string) => Promise<void>;
  onSendFile: (file: File, caption: string) => Promise<void>;
  onOpenTemplates: () => void;
  quickReplies: QuickReply[];
  onManageQuickReplies: () => void;
  recentMessages: Array<{ senderType: "customer" | "agent"; text: string }>;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    conversationId,
    windowExpired,
    disabledReason,
    replyTo,
    onClearReply,
    onSendText,
    onSendNote,
    onSendFile,
    onOpenTemplates,
    quickReplies,
    onManageQuickReplies,
    recentMessages,
  },
  ref,
) {
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [qrIndex, setQrIndex] = useState(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  // Drafts are kept per conversation, like WhatsApp Web.
  const drafts = useRef(new Map<string, string>());
  const lastConv = useRef(conversationId);
  useEffect(() => {
    if (lastConv.current !== conversationId) {
      drafts.current.set(lastConv.current, text);
      lastConv.current = conversationId;
       
      setText(drafts.current.get(conversationId) ?? "");
      setSuggestions([]);
      setPendingFile(null);
      setMode("reply");
    }
  }, [conversationId, text]);

  const resize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, []);
  useEffect(resize, [text, resize]);

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    insert: (value: string) => {
      setText((t) => (t ? `${t} ${value}` : value));
      taRef.current?.focus();
    },
  }));

  const locked = mode === "reply" && windowExpired;

  // `/shortcut` quick-reply lookup on the current word at the caret start.
  const qrQuery = useMemo(() => {
    if (mode !== "reply") return null;
    const m = /^\/([\w-]*)$/.exec(text);
    return m ? m[1].toLowerCase() : null;
  }, [text, mode]);
  const qrMatches = useMemo(
    () =>
      qrQuery === null
        ? []
        : quickReplies.filter((q) => q.shortcut.includes(qrQuery) || q.text.toLowerCase().includes(qrQuery)).slice(0, 8),
    [qrQuery, quickReplies],
  );
  useEffect(() => {
     
    setQrIndex(0);
  }, [qrQuery]);

  const applyQuickReply = (q: QuickReply) => {
    setText(q.text);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const submit = async () => {
    if (busy) return;
    if (pendingFile) {
      setBusy(true);
      try {
        await onSendFile(pendingFile, text.trim());
        setPendingFile(null);
        setText("");
      } finally {
        setBusy(false);
      }
      return;
    }
    const value = text.trim();
    if (!value) return;
    if (mode === "note") {
      setBusy(true);
      try {
        await onSendNote(value);
        setText("");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (locked) return;
    onSendText(value);
    setText("");
    setSuggestions([]);
    drafts.current.delete(conversationId);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (qrMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setQrIndex((i) => (i + 1) % qrMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setQrIndex((i) => (i - 1 + qrMatches.length) % qrMatches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyQuickReply(qrMatches[qrIndex]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
    if (e.key === "Escape") {
      if (replyTo) onClearReply();
      else if (pendingFile) setPendingFile(null);
    }
  };

  const pickFile = (input: HTMLInputElement | null) => {
    if (!input) return;
    input.value = "";
    input.click();
  };
  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPendingFile(file);
      setMode("reply");
      requestAnimationFrame(() => taRef.current?.focus());
    }
  };

  const fetchSuggestions = async () => {
    const recent = recentMessages.filter((m) => m.text.trim());
    if (aiLoading || recent.length === 0) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest_replies", conversationId, recentMessages: recent }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body.data?.suggestions)) setSuggestions(body.data.suggestions);
    } finally {
      setAiLoading(false);
    }
  };

  const polish = async (style: "professional" | "friendly" | "concise" | "fix_grammar") => {
    if (!text.trim() || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "polish_draft", text: text.trim(), style }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.data?.polished) setText(body.data.polished);
    } finally {
      setAiLoading(false);
    }
  };

  if (disabledReason) {
    return (
      <div className="flex min-h-[62px] shrink-0 items-center justify-center bg-[var(--wa-panel-header)] px-4 text-center text-[14px] text-[var(--wa-text-2)]">
        {disabledReason}
      </div>
    );
  }

  return (
    <div className="relative shrink-0 bg-[var(--wa-panel-header)]">
      {/* Quick reply suggestions */}
      {qrQuery !== null && (
        <div className="absolute bottom-full left-0 right-0 z-20 mx-2 mb-1 overflow-hidden rounded-lg border border-[var(--wa-border)] bg-[var(--wa-panel)] shadow-lg">
          <div className="flex items-center justify-between border-b border-[var(--wa-border)] px-3 py-1.5 text-[12px] text-[var(--wa-text-2)]">
            <span className="flex items-center gap-1">
              <Zap className="h-3.5 w-3.5" /> Quick replies
            </span>
            <button type="button" className="hover:text-[var(--wa-text)]" onClick={onManageQuickReplies}>
              Manage
            </button>
          </div>
          {qrMatches.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-[var(--wa-text-2)]">
              No quick reply for “/{qrQuery}”.{" "}
              <button type="button" className="text-[var(--wa-accent-strong)] hover:underline" onClick={onManageQuickReplies}>
                Create one
              </button>
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {qrMatches.map((q, i) => (
                <li key={q.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setQrIndex(i)}
                    onClick={() => applyQuickReply(q)}
                    className={cn("flex w-full gap-3 px-3 py-2 text-left", i === qrIndex && "bg-[var(--wa-panel-active)]")}
                  >
                    <span className="shrink-0 font-mono text-[13px] text-[var(--wa-accent-strong)]">/{q.shortcut}</span>
                    <span className="truncate text-[13px] text-[var(--wa-text-2)]">{q.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* AI suggestions */}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--wa-border)] px-3 py-2">
          <Sparkles className="h-3.5 w-3.5 text-[#a78bfa]" />
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              title={s}
              onClick={() => {
                setText(s);
                setSuggestions([]);
                taRef.current?.focus();
              }}
              className="max-w-xs truncate rounded-full border border-[var(--wa-border)] bg-[var(--wa-panel)] px-3 py-1 text-[13px] hover:border-[#a78bfa]"
            >
              {s}
            </button>
          ))}
          <button type="button" aria-label="Dismiss suggestions" onClick={() => setSuggestions([])} className="ml-auto text-[var(--wa-text-2)]">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Reply / note tabs */}
      <div className="flex items-center gap-1 px-3 pt-2 text-[13px]">
        <button
          type="button"
          onClick={() => setMode("reply")}
          className={cn(
            "rounded-full px-3 py-0.5",
            mode === "reply" ? "bg-[var(--wa-chip-active)] text-[var(--wa-chip-active-text)]" : "text-[var(--wa-text-2)] hover:text-[var(--wa-text)]",
          )}
        >
          Reply
        </button>
        <button
          type="button"
          onClick={() => setMode("note")}
          className={cn(
            "flex items-center gap-1 rounded-full px-3 py-0.5",
            mode === "note" ? "bg-[var(--wa-note)] text-amber-600 dark:text-amber-300" : "text-[var(--wa-text-2)] hover:text-[var(--wa-text)]",
          )}
        >
          <StickyNote className="h-3.5 w-3.5" /> Internal note
        </button>
        {mode === "reply" && (
          <span className="ml-auto hidden text-[11px] text-[var(--wa-text-2)] sm:inline">
            Type <kbd className="font-mono">/</kbd> for quick replies · Enter to send · Shift+Enter new line
          </span>
        )}
      </div>

      {replyTo && mode === "reply" && (
        <div className="mx-3 mt-2 flex overflow-hidden rounded-md bg-[var(--wa-panel)]">
          <span className="w-1 shrink-0 bg-[var(--wa-accent-strong)]" />
          <div className="min-w-0 flex-1 px-3 py-1.5">
            <p className="text-[12.8px] font-medium text-[var(--wa-accent-strong)]">{replyTo.authorLabel}</p>
            <p className="truncate text-[13px] text-[var(--wa-text-2)]">{replyTo.preview}</p>
          </div>
          <button type="button" aria-label="Cancel reply" onClick={onClearReply} className="px-3 text-[var(--wa-text-2)]">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {pendingFile && (
        <div className="mx-3 mt-2 flex items-center gap-3 rounded-md bg-[var(--wa-panel)] px-3 py-2">
          {pendingFile.type.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={URL.createObjectURL(pendingFile)} alt="" className="h-12 w-12 rounded object-cover" />
          ) : (
            <FileText className="h-8 w-8 text-[var(--wa-text-2)]" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px]">{pendingFile.name}</p>
            <p className="text-[12px] text-[var(--wa-text-2)]">{(pendingFile.size / 1024).toFixed(0)} KB · add a caption below</p>
          </div>
          <button type="button" aria-label="Remove attachment" onClick={() => setPendingFile(null)} className="text-[var(--wa-text-2)]">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {locked && !pendingFile ? (
        <div className="flex flex-col items-center gap-2 px-4 py-3 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="flex items-center gap-2 text-[13px] text-[var(--wa-text-2)]">
            <Lock className="h-4 w-4 shrink-0" />
            The 24-hour customer service window is closed. Only approved templates can be sent.
          </p>
          <button
            type="button"
            onClick={onOpenTemplates}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--wa-accent)] px-4 py-1.5 text-[14px] font-medium text-white hover:opacity-90"
          >
            <LayoutTemplate className="h-4 w-4" /> Send template
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-1 px-2 py-[7px] sm:px-3">
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger
              aria-label="Emoji"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--wa-text-2)] hover:bg-[var(--wa-panel-active)]"
            >
              <Smile className="h-6 w-6" />
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-[320px] p-2">
              <div className="wa-scroll max-h-72 overflow-y-auto">
                {EMOJI_GROUPS.map((g) => (
                  <div key={g.label} className="mb-2">
                    <p className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g.label}</p>
                    <div className="grid grid-cols-8 gap-0.5">
                      {g.emojis.map((e) => (
                        <button
                          key={e}
                          type="button"
                          className="rounded p-1 text-xl hover:bg-accent"
                          onClick={() => {
                            const el = taRef.current;
                            const start = el?.selectionStart ?? text.length;
                            const end = el?.selectionEnd ?? text.length;
                            setText(text.slice(0, start) + e + text.slice(end));
                            requestAnimationFrame(() => {
                              el?.focus();
                              el?.setSelectionRange(start + e.length, start + e.length);
                            });
                          }}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {mode === "reply" && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Attach"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--wa-text-2)] hover:bg-[var(--wa-panel-active)]"
              >
                <Plus className="h-6 w-6" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-52">
                <DropdownMenuItem onClick={() => pickFile(docInput.current)}>
                  <FileText className="mr-2 h-4 w-4 text-[#7f66ff]" /> Document
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => pickFile(mediaInput.current)}>
                  <ImageIcon className="mr-2 h-4 w-4 text-[#007bfc]" /> Photos &amp; videos
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => pickFile(audioInput.current)}>
                  <Mic className="mr-2 h-4 w-4 text-[#ff2e74]" /> Audio
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onOpenTemplates}>
                  <LayoutTemplate className="mr-2 h-4 w-4 text-[var(--wa-accent-strong)]" /> Template
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onManageQuickReplies}>
                  <Zap className="mr-2 h-4 w-4 text-amber-500" /> Quick replies
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <input ref={docInput} type="file" hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" onChange={onFileChosen} />
          <input ref={mediaInput} type="file" hidden accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp" onChange={onFileChosen} />
          <input ref={audioInput} type="file" hidden accept=".mp3,.ogg,.m4a,.aac" onChange={onFileChosen} />

          <div
            className={cn(
              "flex min-h-[42px] flex-1 items-end rounded-lg px-3 py-[9px]",
              mode === "note" ? "border border-[var(--wa-note-border)] bg-[var(--wa-note)]" : "bg-[var(--wa-input)]",
            )}
          >
            <textarea
              ref={taRef}
              value={text}
              rows={1}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label={mode === "note" ? "Internal note" : "Type a message"}
              placeholder={
                mode === "note"
                  ? "Add an internal note — only your team sees this"
                  : pendingFile
                    ? "Add a caption"
                    : "Type a message"
              }
              className="wa-scroll max-h-[140px] min-w-0 flex-1 resize-none bg-transparent text-[15px] leading-[22px] text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-text-2)]"
            />
          </div>

          {mode === "reply" && !pendingFile && (
            <>
              {text.trim() ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Polish with AI"
                    disabled={aiLoading}
                    className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#a78bfa] hover:bg-[var(--wa-panel-active)] sm:flex"
                  >
                    {aiLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wand2 className="h-5 w-5" />}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="end" className="w-52">
                    <DropdownMenuItem onClick={() => polish("professional")}>Professional</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => polish("friendly")}>Friendly</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => polish("concise")}>Concise</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => polish("fix_grammar")}>Fix grammar</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <button
                  type="button"
                  aria-label="AI reply suggestions"
                  title="AI reply suggestions"
                  onClick={fetchSuggestions}
                  disabled={aiLoading}
                  className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#a78bfa] hover:bg-[var(--wa-panel-active)] disabled:opacity-50 sm:flex"
                >
                  {aiLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                </button>
              )}
            </>
          )}

          <button
            type="button"
            aria-label={mode === "note" ? "Save note" : "Send"}
            onClick={() => void submit()}
            disabled={busy || (!text.trim() && !pendingFile)}
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
              text.trim() || pendingFile ? "bg-[var(--wa-accent)] text-white" : "text-[var(--wa-text-2)]",
            )}
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : mode === "note" ? (
              <StickyNote className="h-5 w-5" />
            ) : pendingFile ? (
              <Paperclip className="h-5 w-5" />
            ) : (
              <SendHorizontal className="h-5 w-5" />
            )}
          </button>
        </div>
      )}
    </div>
  );
});
