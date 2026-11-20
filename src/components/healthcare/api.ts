'use client';

import type { WeeklySchedule } from '@/lib/healthcare/schedule';

/** Calls a kernel route and unwraps the `{ success, message, data }` envelope. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'include',
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    throw new Error(body?.message || body?.error || `Request failed (${res.status})`);
  }
  return (body && 'data' in body ? body.data : body) as T;
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  doctorCount: number;
}

export interface DirectoryDoctor {
  id: string;
  name: string;
  photoUrl: string | null;
  qualification: string | null;
  specialization: string | null;
  experience: string | null;
  languages: string | null;
  consultationFee: number;
  phone: string | null;
  email: string | null;
  registrationNumber: string | null;
  bio: string | null;
  departments: Array<{ id: string; name: string }>;
  schedule: WeeklySchedule;
  leaves: Array<{ date: string; reason: string }>;
  scheduleSummary: { workingDays: number; slotsPerWeek: number; breakMinutesPerWeek: number; activeDays: string[] };
}
