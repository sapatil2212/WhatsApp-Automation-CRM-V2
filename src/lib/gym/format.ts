/** Display helpers and DTO types shared by the health & fitness pages. */

export interface GymPackage {
  id: string;
  name: string;
  description: string | null;
  durationDays: number;
  price: number;
  joiningFee: number | null;
  features: string[];
  isActive: boolean;
  sortOrder: number;
  activeMembers: number;
}

export const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function durationLabel(days: number): string {
  if (days % 365 === 0) return `${days / 365} year${days === 365 ? "" : "s"}`;
  if (days % 30 === 0) return `${days / 30} month${days === 30 ? "" : "s"}`;
  if (days % 7 === 0) return `${days / 7} week${days === 7 ? "" : "s"}`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

export const fmtPhone = (p?: string | null) => {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  return d.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : d ? `+${d}` : p;
};

/** India business day, matching the server. */
export const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export interface Membership {
  id: string;
  packageId: string | null;
  packageName: string;
  startDate: string;
  endDate: string;
  price: number;
  discount: number;
  amountPaid: number;
  balance: number;
  paymentStatus: "paid" | "partial" | "unpaid";
  paymentMode: string | null;
  status: "active" | "cancelled";
  notes: string | null;
  state: "active" | "upcoming" | "expired" | "cancelled";
  daysLeft: number;
  createdAt: string;
}

export interface Member {
  id: string;
  contactId: string;
  memberCode: string;
  name: string;
  phone: string;
  email: string | null;
  gender: "male" | "female" | "other" | null;
  dateOfBirth: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  heightCm: number | null;
  weightKg: number | null;
  fitnessGoal: string | null;
  medicalNotes: string | null;
  notes: string | null;
  joinedAt: string | null;
  status: "active" | "frozen" | "inactive";
  source: string;
  whatsappConsent: boolean;
  welcomeSentAt: string | null;
  lastAttendanceAt: string | null;
  current: Membership | null;
  memberships: Membership[];
  createdAt: string;
}

export interface MemberDetail extends Member {
  conversationId: string | null;
  messages: Array<{ id: string; eventType: string; channel: string; status: string; templateName: string | null; errorMessage: string | null; createdAt: string; sentAt: string | null }>;
}

/** What a welcome send result means for staff. */
export function welcomeOutcome(status: string | null | undefined): { ok: boolean; text: string } | null {
  switch (status) {
    case "sent":
      return { ok: true, text: "Welcome message sent on WhatsApp." };
    case "blocked_no_template":
      return { ok: false, text: "Welcome not sent: the member hasn't messaged in 24 hours and the \"Membership activated\" template isn't approved yet (WhatsApp templates)." };
    case "skipped_no_consent":
      return { ok: false, text: "Welcome not sent: no WhatsApp consent or no valid number." };
    case "duplicate":
      return { ok: true, text: "Welcome message was already sent." };
    case "failed":
      return { ok: false, text: "Welcome message failed. Check the WhatsApp connection and try again." };
    default:
      return null;
  }
}

export function age(dob: string | null): number | null {
  if (!dob) return null;
  const b = new Date(`${dob}T00:00:00Z`);
  const n = new Date();
  let a = n.getUTCFullYear() - b.getUTCFullYear();
  if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a -= 1;
  return a >= 0 && a < 130 ? a : null;
}