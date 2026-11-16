"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText, Megaphone, BookOpen, History, Plus, Search,
  Edit2, Trash2, Eye, CheckCircle2, AlertTriangle, AlertCircle,
  Info, Sparkles, RefreshCw, Loader2, ExternalLink, Calendar,
  Globe, Shield, Check, X, ArrowUpRight, Copy, Tag, MessageSquare
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SuperAdminShell } from "../super-admin-shell";

type TabType = "announcements" | "articles" | "changelog" | "legal";

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
  const [activeTab, setActiveTab] = useState<TabType>("announcements");
  const [loading, setLoading] = useState(true);

  // Data states
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
      const [annRes, artRes, clRes] = await Promise.all([
        fetch("/api/super-admin/cms/announcements").then((r) => (r.ok ? r.json() : { announcements: [] })),
        fetch("/api/super-admin/cms/articles").then((r) => (r.ok ? r.json() : { articles: [] })),
        fetch("/api/super-admin/cms/changelog").then((r) => (r.ok ? r.json() : { changelogs: [] })),
      ]);
      setAnnouncements(annRes.announcements || []);
      setArticles(artRes.articles || []);
      setChangelogs(clRes.changelogs || []);
    } catch (err) {
      console.error("Failed to load CMS data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
    <SuperAdminShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-violet-100 text-violet-700">
                <FileText className="size-6" />
              </span>
              Content Management System
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Manage in-app tenant announcements, help center articles, product release logs, and legal notices.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={loadData}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold shadow-sm flex items-center gap-1.5 transition active:scale-95"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              Refresh
            </button>

            {activeTab === "announcements" && (
              <button
                onClick={() => {
                  setEditingAnnouncement(null);
                  setAnnouncementModalOpen(true);
                }}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-violet-500/20 flex items-center gap-1.5 transition active:scale-95"
              >
                <Plus className="size-4" />
                New Announcement
              </button>
            )}

            {activeTab === "articles" && (
              <button
                onClick={() => {
                  setEditingArticle(null);
                  setArticleModalOpen(true);
                }}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-violet-500/20 flex items-center gap-1.5 transition active:scale-95"
              >
                <Plus className="size-4" />
                New Article
              </button>
            )}

            {activeTab === "changelog" && (
              <button
                onClick={() => {
                  setEditingChangelog(null);
                  setChangelogModalOpen(true);
                }}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-violet-500/20 flex items-center gap-1.5 transition active:scale-95"
              >
                <Plus className="size-4" />
                New Release Note
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-slate-200 pb-px">
          {[
            { id: "announcements", label: "Tenant Banners & Alerts", icon: Megaphone, count: announcements.filter((a) => a.isActive).length },
            { id: "articles",      label: "Knowledge Base Articles",  icon: BookOpen,  count: articles.length },
            { id: "changelog",     label: "Product Changelog",        icon: History,   count: changelogs.length },
            { id: "legal",         label: "Legal & Entity Notices",   icon: Shield,    count: null },
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
                  "flex items-center gap-2 px-4 py-3 text-xs font-semibold transition-all relative border-b-2 -mb-px",
                  isActive
                    ? "border-violet-600 text-violet-700 bg-violet-50/40 rounded-t-lg"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50/60"
                )}
              >
                <tab.icon className={cn("size-4", isActive ? "text-violet-600" : "text-slate-400")} />
                <span>{tab.label}</span>
                {tab.count !== null && (
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.2 rounded-full font-bold tabular-nums",
                      isActive ? "bg-violet-200/80 text-violet-800" : "bg-slate-100 text-slate-500"
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content 1: Tenant Announcements */}
        {activeTab === "announcements" && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200">
              <div className="relative w-full sm:w-72">
                <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search announcements..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:border-violet-500 transition"
                />
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  {announcements.filter((a) => a.isActive).length} Active Banners live on Tenant Dashboards
                </span>
              </div>
            </div>

            {loading ? (
              <div className="py-20 text-center">
                <Loader2 className="size-7 text-violet-600 animate-spin mx-auto mb-2" />
                <p className="text-xs text-slate-400">Loading announcements...</p>
              </div>
            ) : announcements.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center bg-slate-50/50">
                <Megaphone className="size-10 text-slate-300 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-slate-700">No Announcements Created</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Create system banners, maintenance alerts, or promotional announcements that appear on tenant dashboards.
                </p>
                <button
                  onClick={() => {
                    setEditingAnnouncement(null);
                    setAnnouncementModalOpen(true);
                  }}
                  className="mt-4 px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 transition"
                >
                  Create First Announcement
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {announcements
                  .filter((a) => !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.content.toLowerCase().includes(search.toLowerCase()))
                  .map((ann) => {
                    const typeConfig = {
                      info: { bg: "bg-blue-50/80 border-blue-200 text-blue-900", badge: "bg-blue-100 text-blue-700", icon: Info },
                      warning: { bg: "bg-amber-50/80 border-amber-200 text-amber-900", badge: "bg-amber-100 text-amber-800", icon: AlertTriangle },
                      success: { bg: "bg-emerald-50/80 border-emerald-200 text-emerald-900", badge: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
                      alert: { bg: "bg-red-50/80 border-red-200 text-red-900", badge: "bg-red-100 text-red-700", icon: AlertCircle },
                      maintenance: { bg: "bg-indigo-50/80 border-indigo-200 text-indigo-900", badge: "bg-indigo-100 text-indigo-700", icon: Sparkles },
                    }[ann.type] || { bg: "bg-slate-50 border-slate-200 text-slate-900", badge: "bg-slate-100 text-slate-700", icon: Info };

                    const Icon = typeConfig.icon;

                    return (
                      <div
                        key={ann.id}
                        className={cn(
                          "rounded-2xl border p-5 flex flex-col justify-between transition-all duration-200 bg-white hover:shadow-md",
                          ann.isActive ? "border-slate-200 shadow-sm" : "border-slate-100 opacity-70 bg-slate-50/30"
                        )}
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full capitalize", typeConfig.badge)}>
                                {ann.type}
                              </span>
                              {ann.priority === "urgent" && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 flex items-center gap-1">
                                  <AlertCircle className="size-3" /> Urgent
                                </span>
                              )}
                              <span className="text-[10px] text-slate-400 font-mono">
                                Target: {ann.targetPlan.toUpperCase()}
                              </span>
                            </div>

                            <button
                              onClick={() => toggleAnnouncement(ann)}
                              className={cn(
                                "relative w-10 h-5.5 rounded-full transition-colors p-0.5 flex items-center",
                                ann.isActive ? "bg-violet-600" : "bg-slate-200"
                              )}
                              title={ann.isActive ? "Active (Click to Pause)" : "Inactive (Click to Activate)"}
                            >
                              <div
                                className={cn(
                                  "w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
                                  ann.isActive ? "translate-x-4.5" : "translate-x-0"
                                )}
                              />
                            </button>
                          </div>

                          <div>
                            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                              <Icon className="size-4 shrink-0 text-violet-600" />
                              {ann.title}
                            </h4>
                            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{ann.content}</p>
                          </div>

                          {ann.actionLabel && ann.actionUrl && (
                            <div className="pt-2">
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-600 bg-violet-50 px-2.5 py-1 rounded-lg border border-violet-100">
                                Action: {ann.actionLabel} → <code className="font-mono text-[10px] text-violet-500">{ann.actionUrl}</code>
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-100 text-[11px] text-slate-400">
                          <span>Created {new Date(ann.createdAt).toLocaleDateString()}</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                setEditingAnnouncement(ann);
                                setAnnouncementModalOpen(true);
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                              title="Edit"
                            >
                              <Edit2 className="size-3.5" />
                            </button>
                            <button
                              onClick={() => deleteAnnouncement(ann.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                              title="Delete"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* Tab Content 2: Knowledge Base & Articles */}
        {activeTab === "articles" && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200">
              <div className="relative w-full sm:w-72">
                <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search articles..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:border-violet-500 transition"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
                {["all", "whatsapp", "campaigns", "automations", "general"].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={cn(
                      "px-3 py-1 rounded-xl text-xs font-semibold capitalize transition",
                      categoryFilter === cat
                        ? "bg-violet-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="py-20 text-center">
                <Loader2 className="size-7 text-violet-600 animate-spin mx-auto mb-2" />
                <p className="text-xs text-slate-400">Loading articles...</p>
              </div>
            ) : articles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center bg-slate-50/50">
                <BookOpen className="size-10 text-slate-300 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-slate-700">No Knowledge Base Articles</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Publish guides, onboarding tutorials, and API documentation for your tenants.
                </p>
                <button
                  onClick={() => {
                    setEditingArticle(null);
                    setArticleModalOpen(true);
                  }}
                  className="mt-4 px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 transition"
                >
                  Create First Article
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {articles
                  .filter((a) => categoryFilter === "all" || a.category === categoryFilter)
                  .filter((a) => !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.content.toLowerCase().includes(search.toLowerCase()))
                  .map((art) => (
                    <div
                      key={art.id}
                      className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col justify-between hover:shadow-md transition-all duration-200"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100 capitalize">
                            {art.category}
                          </span>
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-full capitalize",
                            art.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                          )}>
                            {art.status}
                          </span>
                        </div>

                        <h4 className="text-sm font-bold text-slate-900 line-clamp-1">{art.title}</h4>
                        <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed">
                          {art.excerpt || art.content}
                        </p>

                        <div className="pt-2 text-[11px] text-slate-400 flex items-center gap-3">
                          <span>By {art.author}</span>
                          <span>•</span>
                          <span>{art.views} views</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-100 text-xs">
                        <code className="text-[10px] text-slate-400 font-mono truncate max-w-[120px]">
                          /{art.slug}
                        </code>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              setEditingArticle(art);
                              setArticleModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                            title="Edit Article"
                          >
                            <Edit2 className="size-3.5" />
                          </button>
                          <button
                            onClick={() => deleteArticle(art.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                            title="Delete Article"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Tab Content 3: Product Changelog */}
        {activeTab === "changelog" && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200">
              <div className="relative w-full sm:w-72">
                <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search versions or updates..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:border-violet-500 transition"
                />
              </div>

              <div className="text-xs text-slate-400">
                Latest Published Version: <span className="font-bold text-violet-600 font-mono">{changelogs[0]?.version || "v1.0.0"}</span>
              </div>
            </div>

            {loading ? (
              <div className="py-20 text-center">
                <Loader2 className="size-7 text-violet-600 animate-spin mx-auto mb-2" />
                <p className="text-xs text-slate-400">Loading changelogs...</p>
              </div>
            ) : changelogs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center bg-slate-50/50">
                <History className="size-10 text-slate-300 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-slate-700">No Product Updates Published</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Keep tenants informed of new features, bug fixes, and performance upgrades.
                </p>
                <button
                  onClick={() => {
                    setEditingChangelog(null);
                    setChangelogModalOpen(true);
                  }}
                  className="mt-4 px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 transition"
                >
                  Create Release Note
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {changelogs
                  .filter((c) => !search || c.title.toLowerCase().includes(search.toLowerCase()) || c.version.toLowerCase().includes(search.toLowerCase()))
                  .map((log) => {
                    const tagBadge = {
                      feature: "bg-emerald-50 text-emerald-700 border-emerald-100",
                      improvement: "bg-blue-50 text-blue-700 border-blue-100",
                      fix: "bg-amber-50 text-amber-700 border-amber-100",
                      security: "bg-purple-50 text-purple-700 border-purple-100",
                    }[log.tag] || "bg-slate-100 text-slate-700 border-slate-200";

                    return (
                      <div
                        key={log.id}
                        className="rounded-2xl border border-slate-200 bg-white p-5 hover:shadow-sm transition"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2.5">
                            <span className="font-mono text-xs font-bold text-violet-700 bg-violet-50 px-2.5 py-1 rounded-lg border border-violet-100">
                              {log.version}
                            </span>
                            <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider", tagBadge)}>
                              {log.tag}
                            </span>
                            <h4 className="text-sm font-bold text-slate-900">{log.title}</h4>
                          </div>

                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span>{new Date(log.publishedAt).toLocaleDateString()}</span>
                            <button
                              onClick={() => {
                                setEditingChangelog(log);
                                setChangelogModalOpen(true);
                              }}
                              className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                              title="Edit"
                            >
                              <Edit2 className="size-3.5" />
                            </button>
                            <button
                              onClick={() => deleteChangelog(log.id)}
                              className="p-1 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                              title="Delete"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>

                        <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line pl-1">
                          {log.content}
                        </p>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* Tab Content 4: Legal & Entity Notices */}
        {activeTab === "legal" && (
          <div className="space-y-4 max-w-4xl">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-2xl bg-indigo-50 text-indigo-600">
                  <Shield className="size-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-slate-900">Platform Corporate Attribution & Entity Notices</h3>
                  <p className="text-xs text-slate-500">
                    Mandatory legal statements appearing across marketing footers, terms, and billing invoices.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Product Ownership</p>
                  <p className="text-sm font-semibold text-slate-900">A product of Brightwave Digital Products LLP</p>
                  <p className="text-[11px] text-slate-400">Included on all public legal, privacy, and footer pages.</p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Official Support Channel</p>
                  <p className="text-sm font-semibold text-violet-600 font-mono">chatnexgen@gmail.com</p>
                  <p className="text-[11px] text-slate-400">Primary Help & Escalation inbox for tenant queries.</p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Meta Cloud API Compliance</p>
                  <p className="text-sm font-semibold text-emerald-600 flex items-center gap-1.5">
                    <CheckCircle2 className="size-4" /> WhatsApp Cloud API v21.0 Compliant
                  </p>
                  <p className="text-[11px] text-slate-400">End-to-end HTTPS encrypted webhook delivery and rate-limiting.</p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Live Public Pages</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <a href="/terms-and-conditions" target="_blank" className="text-violet-600 hover:underline flex items-center gap-0.5">
                      Terms <ArrowUpRight className="size-3" />
                    </a>
                    <span className="text-slate-300">•</span>
                    <a href="/privacy-policy" target="_blank" className="text-violet-600 hover:underline flex items-center gap-0.5">
                      Privacy <ArrowUpRight className="size-3" />
                    </a>
                    <span className="text-slate-300">•</span>
                    <a href="/refund-policy" target="_blank" className="text-violet-600 hover:underline flex items-center gap-0.5">
                      Refunds <ArrowUpRight className="size-3" />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── MODAL: Create/Edit Announcement ─── */}
      <AnimatePresence>
        {announcementModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Megaphone className="size-4 text-violet-600" />
                  {editingAnnouncement ? "Edit Announcement" : "Create New Tenant Announcement"}
                </h3>
                <button
                  onClick={() => setAnnouncementModalOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                >
                  <X className="size-4" />
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
                  } catch (err) {
                    alert("Network error saving announcement");
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="p-6 space-y-4 max-h-[80vh] overflow-y-auto"
              >
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Banner Title</label>
                  <input
                    name="title"
                    required
                    defaultValue={editingAnnouncement?.title || ""}
                    placeholder="e.g. Scheduled Maintenance or New Feature"
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Banner Message / Content</label>
                  <textarea
                    name="content"
                    required
                    rows={3}
                    defaultValue={editingAnnouncement?.content || ""}
                    placeholder="Detailed message shown to tenants on their CRM dashboard..."
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Banner Style</label>
                    <select
                      name="type"
                      defaultValue={editingAnnouncement?.type || "info"}
                      className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-200 bg-white"
                    >
                      <option value="info">Info (Blue)</option>
                      <option value="warning">Warning (Amber)</option>
                      <option value="success">Success (Emerald)</option>
                      <option value="alert">Critical Alert (Red)</option>
                      <option value="maintenance">Maintenance (Indigo)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Target Plan</label>
                    <select
                      name="targetPlan"
                      defaultValue={editingAnnouncement?.targetPlan || "all"}
                      className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-200 bg-white"
                    >
                      <option value="all">All Plans</option>
                      <option value="free">Free Tier Only</option>
                      <option value="starter">Starter Plan</option>
                      <option value="pro">Pro Plan</option>
                      <option value="enterprise">Enterprise Plan</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Priority</label>
                    <select
                      name="priority"
                      defaultValue={editingAnnouncement?.priority || "normal"}
                      className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-200 bg-white"
                    >
                      <option value="normal">Normal Banner</option>
                      <option value="urgent">Urgent / Top Priority</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Action Button Text (Optional)</label>
                    <input
                      name="actionLabel"
                      defaultValue={editingAnnouncement?.actionLabel || ""}
                      placeholder="e.g. Upgrade Now"
                      className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Action Button Link (URL)</label>
                  <input
                    name="actionUrl"
                    defaultValue={editingAnnouncement?.actionUrl || ""}
                    placeholder="e.g. /settings or https://..."
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="flex items-center gap-6 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      name="isActive"
                      defaultChecked={editingAnnouncement ? editingAnnouncement.isActive : true}
                      className="accent-violet-600 rounded"
                    />
                    Publish Immediately
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      name="isDismissible"
                      defaultChecked={editingAnnouncement ? editingAnnouncement.isDismissible : true}
                      className="accent-violet-600 rounded"
                    />
                    Tenants can dismiss
                  </label>
                </div>

                <div className="flex gap-2.5 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setAnnouncementModalOpen(false)}
                    className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold shadow-md shadow-violet-500/20 flex items-center justify-center gap-2"
                  >
                    {submitting ? <Loader2 className="size-4 animate-spin" /> : "Save Announcement"}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <BookOpen className="size-4 text-violet-600" />
                  {editingArticle ? "Edit Article" : "Create Knowledge Base Article"}
                </h3>
                <button
                  onClick={() => setArticleModalOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                >
                  <X className="size-4" />
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
                  } catch (err) {
                    alert("Network error saving article");
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="p-6 space-y-4 max-h-[80vh] overflow-y-auto"
              >
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Article Title</label>
                  <input
                    name="title"
                    required
                    defaultValue={editingArticle?.title || ""}
                    placeholder="e.g. Connecting Meta WhatsApp Business"
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Category</label>
                    <select
                      name="category"
                      defaultValue={editingArticle?.category || "general"}
                      className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-200 bg-white"
                    >
                      <option value="general">General</option>
                      <option value="whatsapp">WhatsApp Meta Setup</option>
                      <option value="campaigns">Broadcast Campaigns</option>
                      <option value="automations">Flow Builder & Bots</option>
                      <option value="billing">Plans & Billing</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Status</label>
                    <select
                      name="status"
                      defaultValue={editingArticle?.status || "published"}
                      className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-200 bg-white"
                    >
                      <option value="published">Published</option>
                      <option value="draft">Draft</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Short Excerpt</label>
                  <input
                    name="excerpt"
                    defaultValue={editingArticle?.excerpt || ""}
                    placeholder="Brief description shown in search results..."
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Content / Guide Text</label>
                  <textarea
                    name="content"
                    required
                    rows={5}
                    defaultValue={editingArticle?.content || ""}
                    placeholder="Step by step documentation, code snippets, or setup instructions..."
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-violet-500 font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Custom URL Slug (Optional)</label>
                    <input
                      name="slug"
                      defaultValue={editingArticle?.slug || ""}
                      placeholder="e.g. meta-whatsapp-guide"
                      className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-violet-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Author Name</label>
                    <input
                      name="author"
                      defaultValue={editingArticle?.author || "ChatNexGen Team"}
                      className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>

                <div className="flex gap-2.5 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setArticleModalOpen(false)}
                    className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold shadow-md shadow-violet-500/20 flex items-center justify-center gap-2"
                  >
                    {submitting ? <Loader2 className="size-4 animate-spin" /> : "Save Article"}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <History className="size-4 text-violet-600" />
                  {editingChangelog ? "Edit Release Update" : "Publish Release Note"}
                </h3>
                <button
                  onClick={() => setChangelogModalOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                >
                  <X className="size-4" />
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
                  } catch (err) {
                    alert("Network error saving release note");
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="p-6 space-y-4"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Version Number</label>
                    <input
                      name="version"
                      required
                      defaultValue={editingChangelog?.version || "v2.5.0"}
                      placeholder="e.g. v2.5.0"
                      className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 font-mono focus:outline-none focus:border-violet-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Release Category</label>
                    <select
                      name="tag"
                      defaultValue={editingChangelog?.tag || "feature"}
                      className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-200 bg-white"
                    >
                      <option value="feature">New Feature</option>
                      <option value="improvement">Improvement</option>
                      <option value="fix">Bug Fix</option>
                      <option value="security">Security Update</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Release Title</label>
                  <input
                    name="title"
                    required
                    defaultValue={editingChangelog?.title || ""}
                    placeholder="e.g. Super Admin Realtime Dashboard & CMS"
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Release Notes</label>
                  <textarea
                    name="content"
                    required
                    rows={4}
                    defaultValue={editingChangelog?.content || ""}
                    placeholder="Detailed bullet points of what changed..."
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-violet-500"
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

                <div className="flex gap-2.5 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setChangelogModalOpen(false)}
                    className="flex-1 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold shadow-md shadow-violet-500/20 flex items-center justify-center gap-2"
                  >
                    {submitting ? <Loader2 className="size-4 animate-spin" /> : "Publish Note"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </SuperAdminShell>
  );
}
