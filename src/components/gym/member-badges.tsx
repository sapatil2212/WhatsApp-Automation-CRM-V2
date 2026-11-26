import type { Membership } from "@/lib/gym/format";
import { inr } from "@/lib/gym/format";

/** Membership state with days left, e.g. "Active · 12 days left", "Expires in 3 days", "Expired 5 days ago". */
export function MembershipBadge({ m }: { m: Membership | null }) {
  if (!m) return <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">No package</span>;
  const { cls, text } =
    m.state === "cancelled"
      ? { cls: "bg-muted text-muted-foreground", text: "Cancelled" }
      : m.state === "upcoming"
        ? { cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400", text: "Starts soon" }
        : m.state === "expired"
          ? { cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400", text: m.daysLeft === -1 ? "Expired yesterday" : `Expired ${-m.daysLeft} days ago` }
          : m.daysLeft <= 7
            ? { cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400", text: m.daysLeft === 0 ? "Expires today" : `Expires in ${m.daysLeft} day${m.daysLeft === 1 ? "" : "s"}` }
            : { cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", text: `Active · ${m.daysLeft} days left` };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{text}</span>;
}

export function PaymentBadge({ m }: { m: Membership | null }) {
  if (!m || m.state === "cancelled") return null;
  if (m.paymentStatus === "paid") return <span className="inline-flex whitespace-nowrap rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Paid</span>;
  return (
    <span className="inline-flex whitespace-nowrap rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
      {m.paymentStatus === "partial" ? "Partly paid" : "Unpaid"} · {inr(m.balance)} due
    </span>
  );
}
