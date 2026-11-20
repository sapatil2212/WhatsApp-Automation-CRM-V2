/** Shared constants for the Google Review module (safe for client and server). */

export const REVIEW_LANGUAGES = [
  { code: 'en', label: 'English', speech: 'en-IN' },
  { code: 'hi', label: 'हिन्दी (Hindi)', speech: 'hi-IN' },
  { code: 'mr', label: 'मराठी (Marathi)', speech: 'mr-IN' },
  { code: 'hinglish', label: 'Hinglish', speech: 'hi-IN' },
] as const;
export type ReviewLanguage = (typeof REVIEW_LANGUAGES)[number]['code'];
export const LANGUAGE_CODES = REVIEW_LANGUAGES.map((l) => l.code) as [ReviewLanguage, ...ReviewLanguage[]];
export const LANGUAGE_NAME: Record<ReviewLanguage, string> = {
  en: 'English',
  hi: 'Hindi (Devanagari script)',
  mr: 'Marathi (Devanagari script)',
  hinglish: 'Hinglish (Hindi written in Roman letters, mixed with English)',
};

export const JOB_STATUSES = [
  'pending',
  'queued',
  'initializing',
  'browser_launched',
  'navigating',
  'preparing_review',
  'awaiting_customer_confirmation',
  'completed',
  'failed',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Pending',
  queued: 'Queued',
  initializing: 'Initializing',
  browser_launched: 'Browser launched',
  navigating: 'Navigating',
  preparing_review: 'Preparing review',
  awaiting_customer_confirmation: 'Awaiting customer confirmation',
  completed: 'Completed (customer reported)',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Statuses a job can still move out of. */
export const ACTIVE_JOB_STATUSES: JobStatus[] = ['pending', 'queued', 'initializing', 'browser_launched', 'navigating', 'preparing_review'];
export const TERMINAL_JOB_STATUSES: JobStatus[] = ['awaiting_customer_confirmation', 'completed', 'failed', 'cancelled'];

export const EVENT_TYPES = [
  'page_view',
  'rating_selected',
  'feedback_submitted',
  'ai_generated',
  'draft_approved',
  'review_copied',
  'google_opened',
  'customer_reported_done',
] as const;
export type ReviewEventType = (typeof EVENT_TYPES)[number];

export const QR_PLACEMENTS = [
  { value: 'reception', label: 'Reception' },
  { value: 'billing', label: 'Billing counter' },
  { value: 'thank_you', label: 'Customer thank you' },
  { value: 'whatsapp', label: 'WhatsApp follow-up' },
  { value: 'website', label: 'Website' },
  { value: 'invoice', label: 'Printed invoice' },
  { value: 'other', label: 'Other' },
] as const;

export const MAX_REVIEW_CHARS = 1000;