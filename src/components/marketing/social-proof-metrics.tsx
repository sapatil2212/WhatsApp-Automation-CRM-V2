const STATS = [
  { value: "100%", label: "Official Meta API", glowColor: "var(--color-m-glow-emerald)" },
  { value: "1s", label: "Webhook Sync Latency", glowColor: "rgba(20, 184, 166, 0.1)" },
  { value: "99.9%", label: "Target Architecture Uptime", glowColor: "var(--color-m-glow-emerald)" },
  { value: "24/7", label: "Always-On Auto-Replies", glowColor: "rgba(20, 184, 166, 0.1)" },
];

export function SocialProofMetrics() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 w-full max-w-5xl mx-auto py-10">
      {STATS.map((stat) => (
        <div
          key={stat.label}
          className="rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] p-6 relative overflow-hidden flex flex-col justify-between hover:border-[var(--m-border-secondary)] transition-colors duration-200"
        >
          <div className="space-y-2 relative z-10">
            <span className="text-[10px] uppercase font-bold text-[var(--m-text-tertiary)] tracking-wider">
              {stat.label}
            </span>
            <h3 className="text-3xl sm:text-4xl md:text-5xl font-black text-[var(--m-text-primary)] flex items-baseline tracking-tight">
              <span className="font-mono">{stat.value}</span>
            </h3>
          </div>
          <div
            className="absolute -bottom-8 -right-8 w-24 h-24 rounded-full blur-2xl pointer-events-none opacity-40"
            style={{ backgroundColor: stat.glowColor }}
          />
        </div>
      ))}
    </div>
  );
}
