'use client';

/**
 * Thin client for the campaign API. Unwraps the standard
 * `{ success, message, data, meta, error }` envelope and throws the
 * server's human-readable message on failure.
 */

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
  meta?: { pagination?: { page: number; pageSize: number; total: number; totalPages: number } };
  error?: { code?: string; details?: unknown } | null;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<ApiEnvelope<T>> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    cache: 'no-store',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !body || body.success === false) {
    const message = body?.message || `Request failed (HTTP ${res.status})`;
    throw new ApiError(message, res.status, body?.error?.details);
  }
  return body;
}

// ── shared DTO shapes (mirror server/dtos) ─────────────────────────

export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'failed' | 'cancelled';

export interface BroadcastStats {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  deliveryRate: number;
  readRate: number;
  failureRate: number;
}

export type Audience =
  | { type: 'all'; excludeTagIds: string[] }
  | { type: 'tags'; tagIds: string[]; excludeTagIds: string[] }
  | { type: 'contacts'; contactIds: string[]; excludeTagIds: string[] }
  | { type: 'customField'; customFieldId: string; operator: 'is' | 'isNot' | 'contains'; value: string; excludeTagIds: string[] };

export interface BroadcastDto {
  id: string;
  name: string;
  templateName: string;
  templateLanguage: string;
  templateVariables: string[];
  personalization: Record<string, { source: string; value?: string; fallback?: string }>;
  audience: Audience | null;
  scheduledAt: string | null;
  status: BroadcastStatus;
  stats: BroadcastStats;
  editable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDto {
  id: string;
  name: string;
  category: 'Marketing' | 'Utility' | 'Authentication';
  language: string;
  headerType: 'none' | 'text' | 'image' | 'video' | 'document';
  headerContent: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: Array<{ type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url: string | null; phoneNumber: string | null }>;
  status: string;
  variableCount: number;
  sendable: boolean;
}

export interface CampaignSetup {
  whatsappConnected: boolean;
  aiAvailable: boolean;
  totalContacts: number;
  templates: TemplateDto[];
  tags: Array<{ id: string; name: string; color: string; contactCount: number }>;
  customFields: Array<{ id: string; name: string }>;
}

export interface AudiencePreview {
  reach: number;
  excluded: number;
  sample: Array<{ id: string; phone: string; name: string | null }>;
}

export interface RecipientDto {
  id: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed' | 'cancelled';
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  repliedAt: string | null;
  errorMessage: string | null;
  contact: { id: string; phone: string; name: string | null } | null;
}
