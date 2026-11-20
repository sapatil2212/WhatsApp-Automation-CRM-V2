"use client";

import { memo, useState } from "react";
import {
  Bot,
  ChevronDown,
  Copy,
  CornerDownLeft,
  CornerUpLeft,
  Download,
  FileText,
  ImageOff,
  LayoutTemplate,
  MapPin,
  RotateCcw,
  SmilePlus,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { BubbleTail, Ticks } from "./parts";
import { messageTime, type InboxMessage, type Reaction } from "./types";

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

interface BubbleProps {
  message: InboxMessage;
  /** First bubble of a run from the same side — draws the tail. */
  first: boolean;
  contactName: string;
  agentName: (id: string | null) => string | null;
  currentUserId: string | null;
  onReply: (m: InboxMessage) => void;
  onReact: (m: InboxMessage, emoji: string) => void;
  onJumpTo: (id: string) => void;
  onRetry?: (m: InboxMessage) => void;
}

function Media({ message }: { message: InboxMessage }) {
  const [broken, setBroken] = useState(false);
  const url = message.mediaUrl;
  if (!url || broken) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-[var(--wa-quote-in)] px-3 py-2 text-[13px] text-[var(--wa-text-2)]">
        <ImageOff className="h-4 w-4" /> {message.contentType === "image" ? "Photo" : "Media"} unavailable
      </div>
    );
  }
  if (message.contentType === "image" || message.contentType === "sticker") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Shared photo"
          onError={() => setBroken(true)}
          className={cn(
            "rounded-md object-cover",
            message.contentType === "sticker" ? "max-h-40 max-w-40" : "max-h-80 w-full max-w-[330px]",
          )}
        />
      </a>
    );
  }
  if (message.contentType === "video") {
    return <video src={url} controls className="max-h-80 w-full max-w-[330px] rounded-md" onError={() => setBroken(true)} />;
  }
  if (message.contentType === "audio") {
    return <audio src={url} controls className="w-64 max-w-full" onError={() => setBroken(true)} />;
  }
  return null;
}

function Document({ message, out }: { message: InboxMessage; out: boolean }) {
  const name = message.filename || (message.mediaUrl ? decodeURIComponent(message.mediaUrl.split("/").pop() ?? "") : "") || "Document";
  const ext = name.includes(".") ? name.split(".").pop()!.toUpperCase() : "FILE";
  return (
    <a
      href={message.mediaUrl ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex w-[280px] max-w-full items-center gap-3 rounded-md px-3 py-2.5",
        out ? "bg-[var(--wa-quote-out)]" : "bg-[var(--wa-quote-in)]",
      )}
    >
      <div className="flex h-10 w-8 shrink-0 items-center justify-center rounded bg-[#e2574c] text-[9px] font-bold text-white">
        {ext.slice(0, 4)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px]">{name}</p>
        <p className="text-[12px] text-[var(--wa-text-2)]">{ext}</p>
      </div>
      {message.mediaUrl ? <Download className="h-5 w-5 shrink-0 text-[var(--wa-text-2)]" /> : <FileText className="h-5 w-5" />}
    </a>
  );
}

/** Minimal WhatsApp text formatting: *bold*, _italic_, ~strike~, ```mono``` and links. */
function formatText(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(```[^`]+```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|https?:\/\/[^\s]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("```")) out.push(<code key={k++} className="font-mono text-[13px]">{t.slice(3, -3)}</code>);
    else if (t.startsWith("*")) out.push(<strong key={k++}>{t.slice(1, -1)}</strong>);
    else if (t.startsWith("_")) out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    else if (t.startsWith("~")) out.push(<s key={k++}>{t.slice(1, -1)}</s>);
    else
      out.push(
        <a key={k++} href={t} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--wa-tick-read)] underline">
          {t}
        </a>,
      );
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Reactions({ reactions, currentUserId, onToggle }: { reactions: Reaction[]; currentUserId: string | null; onToggle: (emoji: string) => void }) {
  const grouped = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const g = grouped.get(r.emoji) ?? { count: 0, mine: false };
    g.count += 1;
    if (r.actorType === "agent" && r.actorId === currentUserId) g.mine = true;
    grouped.set(r.emoji, g);
  }
  return (
    <div className="relative z-[1] -mt-1.5 flex gap-1 px-2">
      {[...grouped.entries()].map(([emoji, g]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onToggle(emoji)}
          title={g.mine ? "Remove your reaction" : "React"}
          className={cn(
            "flex h-6 items-center gap-0.5 rounded-full border border-[var(--wa-border)] bg-[var(--wa-panel-header)] px-1.5 text-[13px] shadow-sm",
            g.mine && "border-[var(--wa-accent)]",
          )}
        >
          {emoji}
          {g.count > 1 && <span className="text-[11px] text-[var(--wa-text-2)]">{g.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const Bubble = memo(function Bubble({
  message: m,
  first,
  contactName,
  agentName,
  currentUserId,
  onReply,
  onReact,
  onJumpTo,
  onRetry,
}: BubbleProps) {
  const out = m.senderType !== "customer";
  const [menuOpen, setMenuOpen] = useState(false);
  const hasMediaFrame = ["image", "video", "sticker"].includes(m.contentType) && !!m.mediaUrl;
  const text = m.contentText ?? "";
  const author = m.senderType === "bot" ? "AI Assistant" : m.senderType === "agent" ? agentName(m.senderId) : null;

  const myReaction = m.reactions.find((r) => r.actorType === "agent" && r.actorId === currentUserId)?.emoji;
  const toggle = (emoji: string) => onReact(m, myReaction === emoji ? "" : emoji);

  return (
    <div
      id={`msg-${m.id}`}
      className={cn("group/row flex w-full px-[5%] lg:px-[7%]", out ? "justify-end" : "justify-start", first ? "mt-3" : "mt-0.5")}
    >
      <div className={cn("flex max-w-[85%] flex-col md:max-w-[65%]", out ? "items-end" : "items-start")}>
        <div
          className={cn(
            "relative rounded-lg text-[14.2px] leading-[19px] shadow-[var(--wa-shadow)]",
            out ? "bg-[var(--wa-out)]" : "bg-[var(--wa-in)]",
            first && (out ? "rounded-tr-none" : "rounded-tl-none"),
            hasMediaFrame ? "p-[3px]" : "px-[9px] pb-[8px] pt-[6px]",
          )}
        >
          {first && <BubbleTail side={out ? "out" : "in"} />}

          {/* Hover menu */}
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              aria-label="Message options"
              className={cn(
                "absolute right-1 top-1 z-[2] flex h-6 w-6 items-center justify-center rounded-full text-[var(--wa-text-2)] opacity-0 transition-opacity focus:opacity-100 group-hover/row:opacity-100",
                out ? "bg-[var(--wa-out)]" : "bg-[var(--wa-in)]",
                menuOpen && "opacity-100",
              )}
            >
              <ChevronDown className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align={out ? "end" : "start"} className="w-56">
              <div className="flex justify-between gap-1 px-1 py-1">
                {QUICK_REACTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={cn("rounded-full p-1 text-lg hover:bg-accent", myReaction === e && "bg-accent")}
                    onClick={() => {
                      toggle(e);
                      setMenuOpen(false);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <DropdownMenuItem onClick={() => onReply(m)}>
                <CornerUpLeft className="mr-2 h-4 w-4" /> Reply
              </DropdownMenuItem>
              {text && (
                <DropdownMenuItem
                  onClick={() => {
                    void navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" /> Copy
                </DropdownMenuItem>
              )}
              {m.status === "failed" && onRetry && (
                <DropdownMenuItem onClick={() => onRetry(m)}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Retry
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {author && out && (
            <p
              className={cn(
                "mb-0.5 flex items-center gap-1 text-[12.8px] font-medium",
                m.senderType === "bot" ? "text-[#a78bfa]" : "text-[var(--wa-accent-strong)]",
                hasMediaFrame && "px-1.5 pt-1",
              )}
            >
              {m.senderType === "bot" && <Bot className="h-3.5 w-3.5" />}
              {author}
            </p>
          )}

          {m.replyTo && (
            <button
              type="button"
              onClick={() => onJumpTo(m.replyTo!.id)}
              className={cn(
                "mb-1 flex w-full min-w-[160px] overflow-hidden rounded-md text-left",
                out ? "bg-[var(--wa-quote-out)]" : "bg-[var(--wa-quote-in)]",
              )}
            >
              <span
                className={cn("w-1 shrink-0", m.replyTo.senderType === "customer" ? "bg-[#53bdeb]" : "bg-[var(--wa-accent-strong)]")}
              />
              <span className="min-w-0 px-2 py-1">
                <span
                  className={cn(
                    "block text-[12.8px] font-medium",
                    m.replyTo.senderType === "customer" ? "text-[#53bdeb]" : "text-[var(--wa-accent-strong)]",
                  )}
                >
                  {m.replyTo.senderType === "customer" ? contactName : "You"}
                </span>
                <span className="line-clamp-2 block text-[13px] text-[var(--wa-text-2)]">{m.replyTo.preview}</span>
              </span>
            </button>
          )}

          {m.contentType === "template" && (
            <span className="mb-1 inline-flex items-center gap-1 rounded bg-[var(--wa-quote-out)] px-1.5 py-0.5 text-[11px] text-[var(--wa-text-2)]">
              <LayoutTemplate className="h-3 w-3" /> {m.templateName ?? "Template"}
            </span>
          )}
          {m.contentType === "interactive" && (
            <span className="mb-0.5 flex items-center gap-1 text-[11px] uppercase tracking-wide text-[var(--wa-text-2)]">
              <CornerDownLeft className="h-3 w-3" /> Button reply
            </span>
          )}
          {m.contentType === "location" && (
            <span className="mb-0.5 flex items-center gap-1 text-[13px]">
              <MapPin className="h-4 w-4 text-[var(--wa-accent-strong)]" /> Location
            </span>
          )}

          {["image", "video", "audio", "sticker"].includes(m.contentType) && <Media message={m} />}
          {m.contentType === "document" && <Document message={m} out={out} />}

          {/* Text + inline meta (WhatsApp floats the time into the last line) */}
          {(text || !["image", "video", "audio", "sticker", "document"].includes(m.contentType)) &&
          !(m.contentType === "document" && !text) ? (
            <div className={cn("whitespace-pre-wrap break-words", hasMediaFrame && "px-1.5 pb-1 pt-1")}>
              {text ? formatText(text) : <span className="italic text-[var(--wa-text-2)]">Unsupported message</span>}
              <span className={cn("inline-block h-3", out ? "w-[68px]" : "w-[46px]")} aria-hidden />
            </div>
          ) : null}

          {/* Room for the time row under media/documents that have no caption. */}
          {!text && !hasMediaFrame && ["document", "audio"].includes(m.contentType) && <div className="h-3.5" />}
          <span
            className={cn(
              "absolute flex items-center gap-1 whitespace-nowrap text-[11px] leading-[15px]",
              hasMediaFrame && !text
                ? "bottom-2 right-2 rounded-full bg-black/45 px-1.5 py-0.5 text-white"
                : cn("bottom-[4px] right-[7px]", out ? "text-[var(--wa-text-out-meta)]" : "text-[var(--wa-text-2)]"),
            )}
          >
            {messageTime(m.createdAt)}
            {out && <Ticks status={m.status} className={hasMediaFrame && !text ? "!text-white" : undefined} />}
          </span>
        </div>
        {m.status === "failed" && out && (
          <button type="button" onClick={() => onRetry?.(m)} className="mt-0.5 text-[11px] text-red-500 hover:underline">
            Not delivered{onRetry ? " · Tap to retry" : ""}
          </button>
        )}
        {m.reactions.length > 0 && <Reactions reactions={m.reactions} currentUserId={currentUserId} onToggle={toggle} />}
      </div>
      <button
        type="button"
        aria-label="React"
        onClick={() => setMenuOpen(true)}
        className={cn(
          "mx-1 hidden h-7 w-7 shrink-0 items-center justify-center self-center rounded-full text-[var(--wa-text-2)] opacity-0 transition-opacity hover:bg-[var(--wa-panel-header)] group-hover/row:opacity-100 md:flex",
          out ? "order-first" : "",
        )}
      >
        <SmilePlus className="h-4 w-4" />
      </button>
    </div>
  );
});
