"use client";

import { useState } from "react";
import { Settings, Shield, Bell, Key, Server, Globe, Save } from "lucide-react";
import { SuperAdminShell } from "../super-admin-shell";

const inputCls = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/10 transition-all";
const labelCls = "block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5";

export default function SuperAdminSettingsPage() {
  const [saved, setSaved] = useState(false);
  const [notifyNewUser,   setNotifyNewUser]   = useState(true);
  const [notifyChurn,     setNotifyChurn]     = useState(true);
  const [notifyTrial,     setNotifyTrial]     = useState(false);
  const [agencyName,      setAgencyName]      = useState("ChatNexGen Technologies");
  const [supportEmail,    setSupportEmail]    = useState("support@chatnexgen.com");
  const [siteUrl,         setSiteUrl]         = useState(process.env.NEXT_PUBLIC_SITE_URL ?? "https://crm.example.com");

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <SuperAdminShell>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Settings className="size-6 text-violet-500" /> Settings
          </h1>
          <p className="mt-1 text-sm text-slate-500">Configure super admin portal preferences.</p>
        </div>

        {/* Credentials card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-sm shadow-slate-100">
          <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Key className="size-4 text-violet-500" /> Super Admin Credentials
          </p>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Username / Email</span>
              <code className="text-violet-600 font-mono bg-violet-50 border border-violet-100/50 px-1.5 py-0.5 rounded">
                {process.env.NEXT_PUBLIC_SITE_URL ? "Set via env" : "SUPER_ADMIN_USERNAME"}
              </code>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Password</span>
              <code className="text-violet-600 font-mono bg-violet-50 border border-violet-100/50 px-1.5 py-0.5 rounded">
                SUPER_ADMIN_PASSWORD
              </code>
            </div>
            <p className="text-xs text-slate-400 pt-2 border-t border-slate-200 mt-2 font-medium">
              Credentials are set via environment variables. Edit your <code className="text-violet-600 font-mono font-bold">.env.local</code> file to change them — no code changes needed.
            </p>
          </div>
        </div>

        {/* Agency details */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-sm shadow-slate-100">
          <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Shield className="size-4 text-violet-500" /> Agency Details
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Agency Name</label>
              <input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Support Email</label>
              <input type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>

        {/* Platform */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-sm shadow-slate-100">
          <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Globe className="size-4 text-violet-500" /> Platform
          </p>
          <div>
            <label className={labelCls}>Site URL</label>
            <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://yourcrm.com" className={inputCls} />
            <p className="text-xs text-slate-400 mt-1.5 font-medium">Set via <code className="text-violet-500 font-mono font-bold">NEXT_PUBLIC_SITE_URL</code> env var for permanent changes.</p>
          </div>
        </div>

        {/* Notifications */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-sm shadow-slate-100">
          <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Bell className="size-4 text-violet-500" /> Notifications
          </p>
          {[
            { label: "New user signup",    sub: "Get notified when a new user registers",       val: notifyNewUser, set: setNotifyNewUser },
            { label: "Client churn alert", sub: "Alert when a client account becomes inactive", val: notifyChurn,   set: setNotifyChurn   },
            { label: "Trial expiry",       sub: "Alert 2 days before a trial expires",          val: notifyTrial,   set: setNotifyTrial   },
          ].map((n) => (
            <div key={n.label} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-800">{n.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{n.sub}</p>
              </div>
              <button
                type="button"
                onClick={() => n.set(!n.val)}
                className={`relative w-11 h-6 rounded-full shadow-inner border border-transparent transition-all duration-200 active:scale-[0.95] ${n.val ? "bg-violet-600 border-violet-700" : "bg-slate-200 border-slate-300"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${n.val ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>
          ))}
        </div>

        {/* System info */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3 shadow-sm shadow-slate-100">
          <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Server className="size-4 text-violet-500" /> System Info
          </p>
          {[
            { label: "Auth Cookie",    value: "super_admin_session" },
            { label: "Session TTL",    value: "8 hours" },
            { label: "Route Prefix",   value: "/super-admin" },
            { label: "API Prefix",     value: "/api/super-admin" },
          ].map((r) => (
            <div key={r.label} className="flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">{r.label}</span>
              <code className="text-violet-600 font-mono bg-violet-50 border border-violet-100/50 px-1.5 py-0.5 rounded">{r.value}</code>
            </div>
          ))}
        </div>

        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-sm font-bold shadow-md shadow-violet-500/20 hover:shadow-lg hover:shadow-violet-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
        >
          <Save className="size-4" />
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </div>
    </SuperAdminShell>
  );
}
