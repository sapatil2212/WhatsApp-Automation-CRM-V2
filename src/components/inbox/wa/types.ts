/**
 * Client-side shapes for the team inbox. They mirror the server DTOs in
 * `src/server/services/inbox.service.ts` and `src/server/dtos/conversation.dto.ts`.
 */

export type ConversationStatus = "open" | "pending" | "closed";
export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";
export type SenderType = "customer" | "agent" | "bot";

export const INBOX_FILTERS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "mine", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "starred", label: "Starred" },
] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number]["value"];

export interface InboxTag {
  id: string;
  name: string;
  color: string;
}

export interface ServiceWindow {
  expired: boolean;
  hoursRemaining: number | null;
  lastCustomerMessageAt: string | null;
}

export interface InboxConversation {
  id: string;
  status: ConversationStatus;
  assignedAgentId: string | null;
  unreadCount: number;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  contact: {
    id: string;
    phone: string;
    name: string | null;
    avatarUrl: string | null;
    tags: InboxTag[];
  };
  lastMessage: { senderType: SenderType; status: MessageStatus; contentType: string } | null;
  serviceWindow: ServiceWindow;
  pinned: boolean;
  starred: boolean;
}

export interface Reaction {
  id: string;
  actorType: "customer" | "agent";
  actorId: string | null;
  emoji: string;
  createdAt: string;
}

export interface InboxMessage {
  id: string;
  conversationId: string;
  senderType: SenderType;
  senderId: string | null;
  contentType: string;
  contentText: string | null;
  mediaUrl: string | null;
  templateName: string | null;
  whatsappMessageId: string | null;
  status: MessageStatus;
  interactiveReplyId: string | null;
  replyToMessageId: string | null;
  replyTo: { id: string; senderType: SenderType; contentType: string; preview: string } | null;
  createdAt: string;
  reactions: Reaction[];
  /** Client-only: optimistic bubble awaiting the server. */
  pending?: boolean;
  /** Client-only: filename of an uploaded document. */
  filename?: string;
}

export interface Agent {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: string | null;
  isMe: boolean;
}

export interface QuickReply {
  id: string;
  shortcut: string;
  text: string;
  createdBy: string | null;
  createdAt: string;
}

export interface InboxNote {
  id: string;
  text: string;
  createdAt: string;
  authorId: string;
  authorName?: string | null;
}

export interface ConversationContext {
  conversation: {
    id: string;
    status: ConversationStatus;
    assignedAgentId: string | null;
    createdAt: string;
    bookingStage: string | null;
    messageCount: number;
  };
  contact: {
    id: string;
    phone: string;
    name: string | null;
    email: string | null;
    company: string | null;
    avatarUrl: string | null;
    createdAt: string;
    tags: InboxTag[];
  };
  notes: InboxNote[];
  deals: Array<{
    id: string;
    title: string;
    value: number;
    currency: string;
    status: string;
    stage: { id: string; name: string; color: string } | null;
    pipeline: { id: string; name: string } | null;
  }>;
  appointments: Array<{
    id: string;
    date: string;
    time: string;
    status: string;
    reason: string | null;
    doctorName: string | null;
  }>;
  availableTags: InboxTag[];
}

// ── fetch helpers ───────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Reads both the kernel envelope (`{success,data,message}`) and legacy `{error}` bodies. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || body.success === false) {
    const message =
      (typeof body.error === "string" && body.error) ||
      (typeof body.message === "string" && body.message) ||
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return { data: ("data" in body ? body.data : body) as T, meta: body.meta as Record<string, unknown> | undefined };
}

// ── display helpers ─────────────────────────────────────────────────

export function displayName(c: { name: string | null; phone: string }): string {
  return c.name?.trim() || c.phone;
}

const AVATAR_COLORS = ["#25d366", "#53bdeb", "#ff8f6b", "#a78bfa", "#f59e0b", "#ec4899", "#14b8a6", "#ef4444"];
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "#";
  if (/^\d/.test(parts[0])) return parts[0].slice(-2);
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** "12:41", "Yesterday", "Monday", "12/03/2026" — WhatsApp's chat-list timestamps. */
export function listTimestamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  if (d.getTime() >= startOfToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.getTime() >= startOfToday - day) return "Yesterday";
  if (d.getTime() >= startOfToday - 6 * day) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString();
}

export function dateSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  if (d.getTime() >= startOfToday) return "Today";
  if (d.getTime() >= startOfToday - day) return "Yesterday";
  if (d.getTime() >= startOfToday - 6 * day) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

export function messageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Live 24-hour window, recomputed client-side from the last inbound timestamp. */
export function windowRemaining(lastCustomerMessageAt: string | null, now = Date.now()) {
  if (!lastCustomerMessageAt) return { expired: true, ms: 0, label: "No customer message" };
  const ms = new Date(lastCustomerMessageAt).getTime() + 24 * 3_600_000 - now;
  if (ms <= 0) return { expired: true, ms: 0, label: "24h window closed" };
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return { expired: false, ms, label: h > 0 ? `${h}h ${m}m left` : `${m}m left` };
}

export function previewFor(m: Pick<InboxMessage, "contentType" | "contentText" | "templateName">): string {
  const text = m.contentText?.trim();
  if (m.contentType === "template") return text || `Template: ${m.templateName ?? ""}`;
  if (text) return text;
  const labels: Record<string, string> = {
    image: "📷 Photo",
    video: "🎥 Video",
    audio: "🎤 Audio",
    document: "📄 Document",
    sticker: "Sticker",
    location: "📍 Location",
    interactive: "Button reply",
  };
  return labels[m.contentType] ?? "Message";
}
