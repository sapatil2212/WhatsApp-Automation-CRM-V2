"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText, Megaphone, BookOpen, History, Plus, Search,
  Edit2, Trash2, Eye, EyeOff, CheckCircle2, AlertTriangle, AlertCircle,
  Info, Sparkles, RefreshCw, Loader2, ExternalLink, Calendar,
  Globe, Shield, Check, X, ArrowUpRight, Copy, Tag, MessageSquare,
  Mail, Phone, MapPin, Send, Palette, Layout, Server, Lock
} from "lucide-react";
import { cn } from "@/lib/utils";

type TabType = "branding" | "footer" | "contact" | "smtp" | "announcements" | "articles" | "changelog";

interface Announcement {
  id: string;
  title: string;
  content: string;
  type: "info" | "warning" | "success" | "alert" | "maintenance";
  priority: "low" | "normal" | "urgent";
  targetPlan: string;
  targetAudience: string;
  isActive: boolean;
  isDismissible: boolean;
  actionLabel?: string | null;
  actionUrl?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
}

interface Article {
  id: string;
  title: string;
  slug: string;
  category: string;
  excerpt?: string | null;
  content: string;
  status: "draft" | "published" | "archived";
  author: string;
  views: number;
  createdAt: string;
}

interface ChangelogItem {
  id: string;
  version: string;
  title: string;
  tag: "feature" | "improvement" | "fix" | "security";
  content: string;
  publishedAt: string;
  isPublished: boolean;
  createdAt: string;
}

export default function SuperAdminCmsPage() {
  const [activeTab, setActiveTab] = useState<TabType>("branding");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedSuccessKey, setSavedSuccessKey] = useState<string | null>(null);

  // CMS Settings States
  const [branding, setBranding] = useState({
    siteName: "ChatNexGen",
    siteTagline: "AI-Powered WhatsApp CRM & Marketing Automation",
    logoLightUrl: "/images/logo/chatnexgen-logo-light.png",
    logoDarkUrl: "/images/logo/chatnexgen-logo.png",
    faviconUrl: "/favicon.ico",
    primaryColor: "#7c3aed",
  });

  const [footer, setFooter] = useState({
    companyName: "Brightwave Digital Products LLP",
    attributionText: "A product of Brightwave Digital Products LLP.",
    copyrightText: "© 2026 ChatNexGen Technologies. All rights reserved.",
    footerDescription:
      "ChatNexGen is a premium AI-powered WhatsApp CRM and customer support automation platform. Automate business communication, configure smart chatbots, organize leads, and sync calendar reminders using the official WhatsApp Business API.",
    disclaimerText:
      "ChatNexGen uses WhatsApp Business API solutions in accordance with Meta and WhatsApp Business policies. Businesses are responsible for obtaining user consent before initiating communication.",
    socialLinks: {
      linkedin: "https://linkedin.com",
      twitter: "https://twitter.com",
      facebook: "https://facebook.com",
      instagram: "https://instagram.com",
    },
  });

  const [contact, setContact] = useState({
    supportEmail: "chatnexgen@gmail.com",
    salesEmail: "sales@chatnexgen.com",
    phone: "+91 98765 43210",
    address: "Pune, Maharashtra, India",
    businessHours: "Monday - Saturday, 9:00 AM - 6:00 PM IST",
    helpDeskUrl: "/contact-us",
  });

  const [smtp, setSmtp] = useState({
    host: "smtp.gmail.com",
    port: 587,
    user: "infomedinexplus@gmail.com",
    pass: "",
    fromName: "ChatNexGen Support",
    fromEmail: "infomedinexplus@gmail.com",
    bccEmail: "saptechnoeditors@gmail.com",
    secure: false,
  });

  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [testEmailRecipient, setTestEmailRecipient] = useState("");
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [testSmtpResult, setTestSmtpResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Content items
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [changelogs, setChangelogs] = useState<ChangelogItem[]>([]);

  // Search & Filter
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Modals
  const [announcementModalOpen, setAnnouncementModalOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);

  const [articleModalOpen, setArticleModalOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);

  const [changelogModalOpen, setChangelogModalOpen] = useState(false);
  const [editingChangelog, setEditingChangelog] = useState<ChangelogItem | null>(null);

  const [submitting, setSubmitting] = useState(false);

  // Fetch all CMS data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, annRes, artRes, clRes] = await Promise.all([
        fetch("/api/super-admin/cms/settings").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/super-admin/cms/announcements").then((r) => (r.ok ? r.json() : { announcements: [] })),
        fetch("/api/super-admin/cms/articles").then((r) => (r.ok ? r.json() : { articles: [] })),
        fetch("/api/super-admin/cms/changelog").then((r) => (r.ok ? r.json() : { changelogs: [] })),
      ]);

      if (settingsRes) {
        if (settingsRes.site_branding) setBranding(settingsRes.site_branding);
        if (settingsRes.footer_details) setFooter(settingsRes.footer_details);
        if (settingsRes.contact_info) setContact(settingsRes.contact_info);
        if (settingsRes.smtp_config) {
          setSmtp({
            ...settingsRes.smtp_config,
            pass: settingsRes.smtp_config.pass || "",
          });
        }
      }

      setAnnouncements(annRes?.announcements || []);
      setArticles(artRes?.articles || []);
      setChangelogs(clRes?.changelogs || []);
    } catch (err) {
      console.error("Failed to load CMS data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Save specific settings section
  const handleSaveSettings = async (sectionKey: "site_branding" | "footer_details" | "contact_info" | "smtp_config", payload: any) => {
    setSavingKey(sectionKey);
    try {
      const res = await fetch("/api/super-admin/cms/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [sectionKey]: payload }),
      });
      if (res.ok) {
        setSavedSuccessKey(sectionKey);
        setTimeout(() => setSavedSuccessKey(null), 3000);
      } else {
        const d = await res.json();
        alert(d.error || "Failed to save settings");
      }
    } catch {
      alert("Network error while saving settings");
    } finally {
      setSavingKey(null);
    }
  };

  // Test SMTP Connection & send test email
  const handleTestSmtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmailRecipient || !testEmailRecipient.includes("@")) {
      alert("Please enter a valid recipient email for the test");
      return;
    }
    setTestingSmtp(true);
    setTestSmtpResult(null);

    try {
      const res = await fetch("/api/super-admin/cms/settings/test-smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetEmail: testEmailRecipient,
          config: smtp,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTestSmtpResult({ ok: true, message: `Test email dispatched successfully! (ID: ${data.messageId})` });
      } else {
        setTestSmtpResult({ ok: false, message: data.error || "Failed to connect to SMTP server" });
      }
    } catch (err: any) {
      setTestSmtpResult({ ok: false, message: err.message || "Network error testing SMTP" });
    } finally {
      setTestingSmtp(false);
    }
  };

  // Toggle Announcement Active Status
  const toggleAnnouncement = async (ann: Announcement) => {
    try {
      const res = await fetch("/api/super-admin/cms/announcements", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ann.id, isActive: !ann.isActive }),
      });
      if (res.ok) {
        setAnnouncements((prev) =>
          prev.map((a) => (a.id === ann.id ? { ...a, isActive: !a.isActive } : a))
        );
      }
    } catch (err) {
      console.error("Error toggling announcement:", err);
    }
  };

  // Delete Announcement
  const deleteAnnouncement = async (id: string) => {
    if (!confirm("Are you sure you want to delete this announcement?")) return;
    try {
      const res = await fetch(`/api/super-admin/cms/announcements?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setAnnouncements((prev) => prev.filter((a) => a.id !== id));
      }
    } catch (err) {
      console.error("Error deleting announcement:", err);
    }
  };

  // Delete Article
  const deleteArticle = async (id: string) => {
    if (!confirm("Are you sure you want to delete this article?")) return;
    try {
      const res = await fetch(`/api/super-admin/cms/articles?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setArticles((prev) => prev.filter((a) => a.id !== id));
      }
    } catch (err) {
      console.error("Error deleting article:", err);
    }
  };

  // Delete Changelog
  const deleteChangelog = async (id: string) => {
    if (!confirm("Are you sure you want to delete this release update?")) return;
    try {
      const res = await fetch(`/api/super-admin/cms/changelog?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setChangelogs((prev) => prev.filter((c) => c.id !== id));
      }
    } catch (err) {
      console.error("Error deleting changelog:", err);
    }
  };

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-violet-100 text-violet-700">
                <FileText className="size-4" />
              </span>
              Super Admin CMS & Platform Settings
            </h1>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Configure platform logos, footer details, support contacts, SMTP email gateway, and in-app tenant banners.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
            >
              <RefreshCw className={cn("size-3", loading && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 border-b border-slate-200 pb-px overflow-x-auto">
          {[
            { id: "branding",      label: "Brand Logo & UI",        icon: Palette,     count: null },
            { id: "footer",        label: "Footer & Attribution",   icon: Layout,      count: null },
            { id: "contact",       label: "Contact & Support",      icon: Phone,       count: null },
            { id: "smtp",          label: "Email SMTP Gateway",     icon: Server,      count: null },
            { id: "announcements", label: "In-App Banners",         icon: Megaphone,   count: announcements.filter((a) => a.isActive).length },
            { id: "articles",      label: "Knowledge Base",         icon: BookOpen,    count: articles.length },
            { id: "changelog",     label: "Changelog",              icon: History,     count: changelogs.length },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id as TabType);
                  setSearch("");
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all relative border-b-2 -mb-px whitespace-nowrap",
                  isActive
                    ? "border-violet-600 text-violet-700 bg-violet-50/50 rounded-t-lg"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50/60"
                )}
              >
                <tab.icon className={cn("size-3.5", isActive ? "text-violet-600" : "text-slate-400")} />
                <span>{tab.label}</span>
                {tab.count !== null && (
                  <span
                    className={cn(
                      "text-[9px] px-1 py-0.2 rounded-full font-bold tabular-nums",
                      isActive ? "bg-violet-200 text-violet-800" : "bg-slate-100 text-slate-500"
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* TAB 1: Brand Logo & UI */}
        {activeTab === "branding" && (
          <div className="space-y-4 max-w-4xl">
            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <Palette className="size-4 text-violet-600" />
                    Frontend Brand Identity & Logos
                  </h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Controls the logo displayed across marketing landing pages, navigation headers, and sidebar menus.
                  </p>
                </div>

                <button
                  onClick={() => handleSaveSettings("site_branding", branding)}
                  disabled={savingKey === "site_branding"}
                  className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50"
                >
                  {savingKey === "site_branding" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                  Save Branding
                </button>
              </div>

              {savedSuccessKey === "site_branding" && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-2">
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  Branding settings updated and applied across the frontend.
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Platform Brand Name</label>
                  <input
                    value={branding.siteName}
                    onChange={(e) => setBranding({ ...branding, siteName: e.target.value })}
                    placeholder="ChatNexGen"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Brand Tagline</label>
                  <input
                    value={branding.siteTagline}
                    onChange={(e) => setBranding({ ...branding, siteTagline: e.target.value })}
                    placeholder="AI-Powered WhatsApp CRM"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Logo URL (Light Theme)</label>
                  <input
                    value={branding.logoLightUrl}
                    onChange={(e) => setBranding({ ...branding, logoLightUrl: e.target.value })}
                    placeholder="/images/logo/chatnexgen-logo-light.png"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Logo URL (Dark Theme)</label>
                  <input
                    value={branding.logoDarkUrl}
                    onChange={(e) => setBranding({ ...branding, logoDarkUrl: e.target.value })}
                    placeholder="/images/logo/chatnexgen-logo.png"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              {/* Live Logo Preview Box */}
              <div className="pt-3 border-t border-slate-100">
                <p className="text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-2">Live Logo Preview</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-4 rounded-lg border border-slate-200 bg-white flex flex-col items-center justify-center gap-1.5">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Light Background</span>
                    <img
                      src={branding.logoLightUrl}
                      alt="Light Logo Preview"
                      className="h-7 w-auto object-contain max-w-[180px]"
                      onError={(e: any) => (e.target.src = "/images/logo/chatnexgen-logo-light.png")}
                    />
                  </div>

                  <div className="p-4 rounded-lg border border-slate-800 bg-slate-900 flex flex-col items-center justify-center gap-1.5">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Dark Background</span>
                    <img
                      src={branding.logoDarkUrl}
                      alt="Dark Logo Preview"
                      className="h-7 w-auto object-contain max-w-[180px]"
                      onError={(e: any) => (e.target.src = "/images/logo/chatnexgen-logo.png")}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Footer & Attribution Details */}
        {activeTab === "footer" && (
          <div className="space-y-4 max-w-4xl">
            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <Layout className="size-4 text-violet-600" />
                    Footer Details & Legal Attributions
                  </h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Changes made here update the marketing footer, legal policy headers, and corporate statements.
                  </p>
                </div>

                <button
                  onClick={() => handleSaveSettings("footer_details", footer)}
                  disabled={savingKey === "footer_details"}
                  className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50"
                >
                  {savingKey === "footer_details" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                  Save Footer Details
                </button>
              </div>

              {savedSuccessKey === "footer_details" && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-2">
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  Footer details saved and updated live on the website.
                </div>
              )}

              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">Product Ownership Statement</label>
                    <input
                      value={footer.attributionText}
                      onChange={(e) => setFooter({ ...footer, attributionText: e.target.value })}
                      placeholder="A product of Brightwave Digital Products LLP."
                      className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500 font-semibold text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">Company Entity Name</label>
                    <input
                      value={footer.companyName}
                      onChange={(e) => setFooter({ ...footer, companyName: e.target.value })}
                      placeholder="Brightwave Digital Products LLP"
                      className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Copyright Statement</label>
                  <input
                    value={footer.copyrightText}
                    onChange={(e) => setFooter({ ...footer, copyrightText: e.target.value })}
                    placeholder="© 2026 ChatNexGen Technologies. All rights reserved."
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Footer Tagline & Description</label>
                  <textarea
                    rows={2}
                    value={footer.footerDescription}
                    onChange={(e) => setFooter({ ...footer, footerDescription: e.target.value })}
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Meta API Compliance Disclaimer</label>
                  <textarea
                    rows={2}
                    value={footer.disclaimerText}
                    onChange={(e) => setFooter({ ...footer, disclaimerText: e.target.value })}
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500 text-slate-600"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">LinkedIn URL</label>
                    <input
                      value={footer.socialLinks?.linkedin || ""}
                      onChange={(e) =>
                        setFooter({ ...footer, socialLinks: { ...footer.socialLinks, linkedin: e.target.value } })
                      }
                      placeholder="https://linkedin.com/..."
                      className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">Twitter / X URL</label>
                    <input
                      value={footer.socialLinks?.twitter || ""}
                      onChange={(e) =>
                        setFooter({ ...footer, socialLinks: { ...footer.socialLinks, twitter: e.target.value } })
                      }
                      placeholder="https://twitter.com/..."
                      className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Contact & Support Information */}
        {activeTab === "contact" && (
          <div className="space-y-4 max-w-4xl">
            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <Phone className="size-4 text-violet-600" />
                    Public Contact & Customer Support Details
                  </h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Displayed on the footer, Contact Us page, and tenant help desk cards.
                  </p>
                </div>

                <button
                  onClick={() => handleSaveSettings("contact_info", contact)}
                  disabled={savingKey === "contact_info"}
                  className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50"
                >
                  {savingKey === "contact_info" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                  Save Contact Details
                </button>
              </div>

              {savedSuccessKey === "contact_info" && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-2">
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  Contact details updated successfully.
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Help &amp; Support Email</label>
                  <input
                    value={contact.supportEmail}
                    onChange={(e) => setContact({ ...contact, supportEmail: e.target.value })}
                    placeholder="chatnexgen@gmail.com"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Sales &amp; Partnership Email</label>
                  <input
                    value={contact.salesEmail}
                    onChange={(e) => setContact({ ...contact, salesEmail: e.target.value })}
                    placeholder="sales@chatnexgen.com"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Support Phone / WhatsApp</label>
                  <input
                    value={contact.phone}
                    onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                    placeholder="+91 98765 43210"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Business Support Hours</label>
                  <input
                    value={contact.businessHours}
                    onChange={(e) => setContact({ ...contact, businessHours: e.target.value })}
                    placeholder="Monday - Saturday, 9:00 AM - 6:00 PM IST"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Physical Office Address</label>
                  <input
                    value={contact.address}
                    onChange={(e) => setContact({ ...contact, address: e.target.value })}
                    placeholder="Pune, Maharashtra, India"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Email SMTP Configuration */}
        {activeTab === "smtp" && (
          <div className="space-y-4 max-w-4xl">
            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <Server className="size-4 text-violet-600" />
                    Outgoing Email SMTP Configuration
                  </h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Powers all verification OTPs, welcome emails, password resets, and demo notifications.
                  </p>
                </div>

                <button
                  onClick={() => handleSaveSettings("smtp_config", smtp)}
                  disabled={savingKey === "smtp_config"}
                  className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50"
                >
                  {savingKey === "smtp_config" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                  Save SMTP Settings
                </button>
              </div>

              {savedSuccessKey === "smtp_config" && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-2">
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  SMTP credentials updated and stored in database.
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">SMTP Host</label>
                  <input
                    value={smtp.host}
                    onChange={(e) => setSmtp({ ...smtp, host: e.target.value })}
                    placeholder="smtp.gmail.com"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">SMTP Port</label>
                  <input
                    type="number"
                    value={smtp.port}
                    onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })}
                    placeholder="587"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">SMTP Username / Email</label>
                  <input
                    value={smtp.user}
                    onChange={(e) => setSmtp({ ...smtp, user: e.target.value })}
                    placeholder="infomedinexplus@gmail.com"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">SMTP Password / App Password</label>
                  <div className="relative">
                    <input
                      type={showSmtpPass ? "text" : "password"}
                      value={smtp.pass}
                      onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })}
                      placeholder="••••••••••••••••"
                      className="w-full text-xs px-3 py-1.5 pr-8 rounded-lg border border-slate-200 font-mono focus:outline-none focus:border-violet-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSmtpPass(!showSmtpPass)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showSmtpPass ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Sender Name</label>
                  <input
                    value={smtp.fromName}
                    onChange={(e) => setSmtp({ ...smtp, fromName: e.target.value })}
                    placeholder="ChatNexGen Support"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">From Email Address</label>
                  <input
                    value={smtp.fromEmail}
                    onChange={(e) => setSmtp({ ...smtp, fromEmail: e.target.value })}
                    placeholder="infomedinexplus@gmail.com"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">BCC Admin Audit Email (Optional)</label>
                  <input
                    value={smtp.bccEmail || ""}
                    onChange={(e) => setSmtp({ ...smtp, bccEmail: e.target.value })}
                    placeholder="saptechnoeditors@gmail.com"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              {/* Live SMTP Tester Card */}
              <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 space-y-3">
                <div className="flex items-center gap-1.5">
                  <Send className="size-3.5 text-violet-600" />
                  <h4 className="text-[11px] font-bold text-slate-900 uppercase tracking-wider">Test SMTP Connection Live</h4>
                </div>

                <form onSubmit={handleTestSmtp} className="flex flex-col sm:flex-row items-center gap-2">
                  <input
                    type="email"
                    required
                    value={testEmailRecipient}
                    onChange={(e) => setTestEmailRecipient(e.target.value)}
                    placeholder="Enter recipient email to verify (e.g. your email)"
                    className="w-full sm:flex-1 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-violet-500"
                  />
                  <button
                    type="submit"
                    disabled={testingSmtp}
                    className="w-full sm:w-auto px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
                  >
                    {testingSmtp ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                    {testingSmtp ? "Testing..." : "Send Test Email"}
                  </button>
                </form>

                {testSmtpResult && (
                  <div
                    className={cn(
                      "p-2.5 rounded-lg border text-[11px] flex items-start gap-1.5",
                      testSmtpResult.ok
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                        : "bg-red-50 border-red-200 text-red-800"
                    )}
                  >
                    {testSmtpResult.ok ? (
                      <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="size-3.5 text-red-600 shrink-0 mt-0.5" />
                    )}
                    <span className="font-medium leading-relaxed">{testSmtpResult.message}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: In-App Banners & Announcements */}
        {activeTab === "announcements" && (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200">
              <div className="relative w-full sm:w-64">
                <Search className="size-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search announcements..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1 text-xs rounded-lg border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:border-violet-500 transition"
                />
              </div>

              <div className="flex items-center gap-2.5">
                <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {announcements.filter((a) => a.isActive).length} Active
                </span>

                <button
                  onClick={() => {
                    setEditingAnnouncement(null);
                    setAnnouncementModalOpen(true);
                  }}
                  className="px-3 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Plus className="size-3" />
                  New Banner
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {announcements
                .filter((a) => !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.content.toLowerCase().includes(search.toLowerCase()))
                .map((ann) => {
                  const typeConfig = {
                    info: { badge: "bg-blue-100 text-blue-700", icon: Info },
                    warning: { badge: "bg-amber-100 text-amber-800", icon: AlertTriangle },
                    success: { badge: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
                    alert: { badge: "bg-red-100 text-red-700", icon: AlertCircle },
                    maintenance: { badge: "bg-indigo-100 text-indigo-700", icon: Sparkles },
                  }[ann.type] || { badge: "bg-slate-100 text-slate-700", icon: Info };

                  const Icon = typeConfig.icon;

                  return (
                    <div
                      key={ann.id}
                      className={cn(
                        "rounded-xl border p-3.5 flex flex-col justify-between transition-all bg-white",
                        ann.isActive ? "border-slate-200" : "border-slate-100 opacity-70 bg-slate-50/30"
                      )}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded capitalize", typeConfig.badge)}>
                              {ann.type}
                            </span>
                            {ann.priority === "urgent" && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 flex items-center gap-1">
                                <AlertCircle className="size-2.5" /> Urgent
                              </span>
                            )}
                            <span className="text-[9px] text-slate-400 font-mono">
                              {ann.targetPlan.toUpperCase()}
                            </span>
                          </div>

                          <button
                            onClick={() => toggleAnnouncement(ann)}
                            className={cn(
                              "relative w-8 h-4.5 rounded-full transition-colors p-0.5 flex items-center",
                              ann.isActive ? "bg-violet-600" : "bg-slate-200"
                            )}
                            title={ann.isActive ? "Active (Click to Pause)" : "Inactive (Click to Activate)"}
                          >
                            <div
                              className={cn(
                                "w-3.5 h-3.5 rounded-full bg-white shadow-xs transition-transform",
                                ann.isActive ? "translate-x-3.5" : "translate-x-0"
                              )}
                            />
                          </button>
                        </div>

                        <div>
                          <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            <Icon className="size-3.5 shrink-0 text-violet-600" />
                            {ann.title}
                          </h4>
                          <p className="text-[11px] text-slate-600 mt-1 leading-normal">{ann.content}</p>
                        </div>

                        {ann.actionLabel && ann.actionUrl && (
                          <div className="pt-1">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded border border-violet-100">
                              Action: {ann.actionLabel} → <code className="font-mono text-[9px] text-violet-500">{ann.actionUrl}</code>
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-slate-100 text-[10px] text-slate-400">
                        <span>{new Date(ann.createdAt).toLocaleDateString()}</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setEditingAnnouncement(ann);
                              setAnnouncementModalOpen(true);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                            title="Edit"
                          >
                            <Edit2 className="size-3" />
                          </button>
                          <button
                            onClick={() => deleteAnnouncement(ann.id)}
                            className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                            title="Delete"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* TAB 6: Knowledge Base Articles */}
        {activeTab === "articles" && (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200">
              <div className="relative w-full sm:w-64">
                <Search className="size-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search articles..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1 text-xs rounded-lg border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:border-violet-500 transition"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditingArticle(null);
                    setArticleModalOpen(true);
                  }}
                  className="px-3 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Plus className="size-3" />
                  New Article
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {articles
                .filter((a) => !search || a.title.toLowerCase().includes(search.toLowerCase()))
                .map((art) => (
                  <div
                    key={art.id}
                    className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col justify-between transition-all"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-100 capitalize">
                          {art.category}
                        </span>
                        <span className={cn(
                          "text-[9px] font-bold px-1.5 py-0.5 rounded capitalize",
                          art.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                        )}>
                          {art.status}
                        </span>
                      </div>

                      <h4 className="text-xs font-bold text-slate-900 line-clamp-1">{art.title}</h4>
                      <p className="text-[11px] text-slate-500 line-clamp-2 leading-normal">
                        {art.excerpt || art.content}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-slate-100 text-[11px]">
                      <code className="text-[9px] text-slate-400 font-mono truncate max-w-[120px]">
                        /{art.slug}
                      </code>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingArticle(art);
                            setArticleModalOpen(true);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                        >
                          <Edit2 className="size-3" />
                        </button>
                        <button
                          onClick={() => deleteArticle(art.id)}
                          className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* TAB 7: Product Changelog */}
        {activeTab === "changelog" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-slate-200">
              <span className="text-[11px] text-slate-500">
                Latest Version: <strong className="font-mono text-violet-600">{changelogs[0]?.version || "v1.0.0"}</strong>
              </span>

              <button
                onClick={() => {
                  setEditingChangelog(null);
                  setChangelogModalOpen(true);
                }}
                className="px-3 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Plus className="size-3" />
                New Release Note
              </button>
            </div>

            <div className="space-y-2.5">
              {changelogs.map((log) => (
                <div key={log.id} className="rounded-xl border border-slate-200 bg-white p-3.5 transition">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded border border-violet-100">
                        {log.version}
                      </span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase bg-emerald-50 text-emerald-700 border-emerald-100">
                        {log.tag}
                      </span>
                      <h4 className="text-xs font-bold text-slate-900">{log.title}</h4>
                    </div>

                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                      <span>{new Date(log.publishedAt).toLocaleDateString()}</span>
                      <button
                        onClick={() => {
                          setEditingChangelog(log);
                          setChangelogModalOpen(true);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100"
                      >
                        <Edit2 className="size-3" />
                      </button>
                      <button
                        onClick={() => deleteChangelog(log.id)}
                        className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-red-50"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-600 leading-normal whitespace-pre-line pl-0.5">{log.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── MODAL: Create/Edit Announcement ─── */}
      <AnimatePresence>
        {announcementModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                  <Megaphone className="size-3.5 text-violet-600" />
                  {editingAnnouncement ? "Edit Announcement" : "Create New Tenant Announcement"}
                </h3>
                <button
                  onClick={() => setAnnouncementModalOpen(false)}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSubmitting(true);
                  const fd = new FormData(e.currentTarget);
                  const payload = {
                    id: editingAnnouncement?.id,
                    title: fd.get("title"),
                    content: fd.get("content"),
                    type: fd.get("type"),
                    priority: fd.get("priority"),
                    targetPlan: fd.get("targetPlan"),
                    actionLabel: fd.get("actionLabel"),
                    actionUrl: fd.get("actionUrl"),
                    isActive: fd.get("isActive") === "on",
                    isDismissible: fd.get("isDismissible") === "on",
                  };

                  try {
                    const res = await fetch("/api/super-admin/cms/announcements", {
                      method: editingAnnouncement ? "PUT" : "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload),
                    });
                    if (res.ok) {
                      setAnnouncementModalOpen(false);
                      loadData();
                    } else {
                      const data = await res.json();
                      alert(data.error || "Failed to save announcement");
                    }
                  } catch {
                    alert("Network error saving announcement");
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="p-4 space-y-3 max-h-[80vh] overflow-y-auto"
              >
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Banner Title</label>
                  <input
                    name="title"
                    required
                    defaultValue={editingAnnouncement?.title || ""}
                    placeholder="e.g. Scheduled Maintenance or New Feature"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Banner Message / Content</label>
                  <textarea
                    name="content"
                    required
                    rows={3}
                    defaultValue={editingAnnouncement?.content || ""}
                    placeholder="Detailed message shown to tenants on their CRM dashboard..."
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Banner Style</label>
                    <select
                      name="type"
                      defaultValue={editingAnnouncement?.type || "info"}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                    >
                      <option value="info">Info (Blue)</option>
                      <option value="warning">Warning (Amber)</option>
                      <option value="success">Success (Emerald)</option>
                      <option value="alert">Critical Alert (Red)</option>
                      <option value="maintenance">Maintenance (Indigo)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Target Plan</label>
                    <select
                      name="targetPlan"
                      defaultValue={editingAnnouncement?.targetPlan || "all"}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                    >
                      <option value="all">All Plans</option>
                      <option value="free">Free Tier Only</option>
                      <option value="starter">Starter Plan</option>
                      <option value="pro">Pro Plan</option>
                      <option value="enterprise">Enterprise Plan</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Priority</label>
                    <select
                      name="priority"
                      defaultValue={editingAnnouncement?.priority || "normal"}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                    >
                      <option value="normal">Normal Banner</option>
                      <option value="urgent">Urgent / Top Priority</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Action Button Text (Optional)</label>
                    <input
                      name="actionLabel"
                      defaultValue={editingAnnouncement?.actionLabel || ""}
                      placeholder="e.g. Upgrade Now"
                      className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Action Button Link (URL)</label>
                  <input
                    name="actionUrl"
                    defaultValue={editingAnnouncement?.actionUrl || ""}
                    placeholder="e.g. /settings or https://..."
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="flex items-center gap-4 pt-1">
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      name="isActive"
                      defaultChecked={editingAnnouncement ? editingAnnouncement.isActive : true}
                      className="accent-violet-600 rounded"
                    />
                    Publish Immediately
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      name="isDismissible"
                      defaultChecked={editingAnnouncement ? editingAnnouncement.isDismissible : true}
                      className="accent-violet-600 rounded"
                    />
                    Tenants can dismiss
                  </label>
                </div>

                <div className="flex gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setAnnouncementModalOpen(false)}
                    className="flex-1 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    {submitting ? <Loader2 className="size-3.5 animate-spin" /> : "Save Announcement"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── MODAL: Create/Edit Article ─── */}
      <AnimatePresence>
        {articleModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                  <BookOpen className="size-3.5 text-violet-600" />
                  {editingArticle ? "Edit Article" : "Create Knowledge Base Article"}
                </h3>
                <button
                  onClick={() => setArticleModalOpen(false)}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSubmitting(true);
                  const fd = new FormData(e.currentTarget);
                  const payload = {
                    id: editingArticle?.id,
                    title: fd.get("title"),
                    slug: fd.get("slug"),
                    category: fd.get("category"),
                    excerpt: fd.get("excerpt"),
                    content: fd.get("content"),
                    status: fd.get("status"),
                    author: fd.get("author"),
                  };

                  try {
                    const res = await fetch("/api/super-admin/cms/articles", {
                      method: editingArticle ? "PUT" : "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload),
                    });
                    if (res.ok) {
                      setArticleModalOpen(false);
                      loadData();
                    } else {
                      const data = await res.json();
                      alert(data.error || "Failed to save article");
                    }
                  } catch {
                    alert("Network error saving article");
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="p-4 space-y-3 max-h-[80vh] overflow-y-auto"
              >
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Article Title</label>
                  <input
                    name="title"
                    required
                    defaultValue={editingArticle?.title || ""}
                    placeholder="e.g. Connecting Meta WhatsApp Business"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Category</label>
                    <select
                      name="category"
                      defaultValue={editingArticle?.category || "general"}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                    >
                      <option value="general">General</option>
                      <option value="whatsapp">WhatsApp Meta Setup</option>
                      <option value="campaigns">Broadcast Campaigns</option>
                      <option value="automations">Flow Builder & Bots</option>
                      <option value="billing">Plans & Billing</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Status</label>
                    <select
                      name="status"
                      defaultValue={editingArticle?.status || "published"}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                    >
                      <option value="published">Published</option>
                      <option value="draft">Draft</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Short Excerpt</label>
                  <input
                    name="excerpt"
                    defaultValue={editingArticle?.excerpt || ""}
                    placeholder="Brief description shown in search results..."
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Content / Guide Text</label>
                  <textarea
                    name="content"
                    required
                    rows={4}
                    defaultValue={editingArticle?.content || ""}
                    placeholder="Step by step documentation, code snippets, or setup instructions..."
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500 font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Custom URL Slug (Optional)</label>
                    <input
                      name="slug"
                      defaultValue={editingArticle?.slug || ""}
                      placeholder="e.g. meta-whatsapp-guide"
                      className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Author Name</label>
                    <input
                      name="author"
                      defaultValue={editingArticle?.author || "ChatNexGen Team"}
                      className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setArticleModalOpen(false)}
                    className="flex-1 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    {submitting ? <Loader2 className="size-3.5 animate-spin" /> : "Save Article"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── MODAL: Create/Edit Changelog ─── */}
      <AnimatePresence>
        {changelogModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                  <History className="size-3.5 text-violet-600" />
                  {editingChangelog ? "Edit Release Update" : "Publish Release Note"}
                </h3>
                <button
                  onClick={() => setChangelogModalOpen(false)}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSubmitting(true);
                  const fd = new FormData(e.currentTarget);
                  const payload = {
                    id: editingChangelog?.id,
                    version: fd.get("version"),
                    title: fd.get("title"),
                    tag: fd.get("tag"),
                    content: fd.get("content"),
                    isPublished: fd.get("isPublished") === "on",
                  };

                  try {
                    const res = await fetch("/api/super-admin/cms/changelog", {
                      method: editingChangelog ? "PUT" : "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload),
                    });
                    if (res.ok) {
                      setChangelogModalOpen(false);
                      loadData();
                    } else {
                      const data = await res.json();
                      alert(data.error || "Failed to save release note");
                    }
                  } catch {
                    alert("Network error saving release note");
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="p-4 space-y-3"
              >
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Version Number</label>
                    <input
                      name="version"
                      required
                      defaultValue={editingChangelog?.version || "v2.5.0"}
                      placeholder="e.g. v2.5.0"
                      className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-mono focus:outline-none focus:border-violet-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Release Category</label>
                    <select
                      name="tag"
                      defaultValue={editingChangelog?.tag || "feature"}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                    >
                      <option value="feature">New Feature</option>
                      <option value="improvement">Improvement</option>
                      <option value="fix">Bug Fix</option>
                      <option value="security">Security Update</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Release Title</label>
                  <input
                    name="title"
                    required
                    defaultValue={editingChangelog?.title || ""}
                    placeholder="e.g. Super Admin Realtime Dashboard & CMS"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Release Notes</label>
                  <textarea
                    name="content"
                    required
                    rows={4}
                    defaultValue={editingChangelog?.content || ""}
                    placeholder="Detailed bullet points of what changed..."
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      name="isPublished"
                      defaultChecked={editingChangelog ? editingChangelog.isPublished : true}
                      className="accent-violet-600 rounded"
                    />
                    Publish to Public Changelog
                  </label>
                </div>

                <div className="flex gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setChangelogModalOpen(false)}
                    className="flex-1 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    {submitting ? <Loader2 className="size-3.5 animate-spin" /> : "Publish Note"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
