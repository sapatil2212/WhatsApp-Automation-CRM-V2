"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import { getTerminology } from "@/lib/business/terminology";
import {
  Activity,
  Calendar,
  CheckCircle,
  MessageSquare,
  Bot,
  Brain,
  ChevronRight,
  User,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function BusinessDashboard() {
  const params = useParams();
  const businessSegment = params.businessSegment as string;
  const term = getTerminology(businessSegment);

  const db = createClient();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalBookings: 0,
    pendingBookings: 0,
    confirmedBookings: 0,
    totalLogs: 0,
    aiEnabled: false,
    businessName: "No Business Set Up",
  });
  const [enquiries, setEnquiries] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        // Fetch business profile
        const { data: business } = await db
          .from("business_profiles")
          .select("id, business_name")
          .maybeSingle();

        if (!business) {
          setLoading(false);
          return;
        }

        // Fetch AI settings
        const { data: aiSettings } = await db
          .from("business_ai_settings")
          .select("ai_enabled")
          .eq("business_id", business.id)
          .maybeSingle();

        // Fetch Enquiries (Bookings)
        const { data: bookingEnquiries } = await db
          .from("business_enquiries")
          .select(`
            id,
            preferred_date,
            preferred_time,
            status,
            notes,
            contact_name,
            contact_phone
          `)
          .eq("business_id", business.id)
          .order("preferred_date", { ascending: true })
          .order("preferred_time", { ascending: true });

        // Fetch AI logs
        const { data: chatLogs } = await db
          .from("business_ai_logs")
          .select(`
            id,
            user_message,
            ai_response,
            detected_intent,
            confidence_score,
            created_at,
            contact:contacts ( name, phone )
          `)
          .eq("business_id", business.id)
          .order("created_at", { ascending: false })
          .limit(5);

        const total = bookingEnquiries?.length || 0;
        const pending = bookingEnquiries?.filter((a: any) => a.status === "pending").length || 0;
        const confirmed = bookingEnquiries?.filter((a: any) => a.status === "confirmed" || a.status === "completed").length || 0;

        setStats({
          totalBookings: total,
          pendingBookings: pending,
          confirmedBookings: confirmed,
          totalLogs: chatLogs?.length || 0,
          aiEnabled: aiSettings?.ai_enabled ?? false,
          businessName: business.business_name || "Generic Business",
        });

        if (bookingEnquiries) setEnquiries(bookingEnquiries.slice(0, 5));
        if (chatLogs) setLogs(chatLogs);
      } catch (err) {
        console.error("Error loading dashboard data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, [businessSegment]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-slate-400">Loading AI booking & automation dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            <Activity className="h-8 w-8 text-primary animate-pulse" />
            {term.dashboardTitle}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Overview of AI booking automation, client interactions, and {term.bookingPluralLabel.toLowerCase()} for <span className="text-primary font-medium">{stats.businessName}</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            className={`px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-all duration-300 ${
              stats.aiEnabled
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 animate-pulse"
                : "bg-slate-800 text-slate-400 border border-slate-700"
            }`}
          >
            ● AI status: {stats.aiEnabled ? "ACTIVE" : "INACTIVE"}
          </Badge>
          <Link
            href={`/${businessSegment}/setup`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "border-slate-800 hover:bg-slate-800 text-white")}
          >
            Setup Wizard <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-md hover:border-slate-700 transition-all duration-300">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-400">Total Bookings</span>
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Calendar className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4">
              <span className="text-3xl font-bold text-white">{stats.totalBookings}</span>
              <span className="block text-xs text-slate-500 mt-1">All booking requests</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-md hover:border-slate-700 transition-all duration-300">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-400">Pending Slots</span>
              <div className="rounded-lg bg-amber-500/10 p-2 text-amber-400">
                <Activity className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4">
              <span className="text-3xl font-bold text-white">{stats.pendingBookings}</span>
              <span className="block text-xs text-slate-500 mt-1">Awaiting confirmation</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-md hover:border-slate-700 transition-all duration-300">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-400">Confirmed Sessions</span>
              <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400">
                <CheckCircle className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4">
              <span className="text-3xl font-bold text-white">{stats.confirmedBookings}</span>
              <span className="block text-xs text-slate-500 mt-1">Fulfilled sessions</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-md hover:border-slate-700 transition-all duration-300">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-400">AI Auto Replies</span>
              <div className="rounded-lg bg-teal-500/10 p-2 text-teal-400">
                <Bot className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4">
              <span className="text-3xl font-bold text-white">{stats.totalLogs}</span>
              <span className="block text-xs text-slate-500 mt-1">Recent automated queries</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid: Bookings & Logs */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Upcoming bookings */}
        <Card className="lg:col-span-7 border-slate-800 bg-slate-900/60 backdrop-blur-md">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-800 pb-4">
            <CardTitle className="text-lg font-bold text-white flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              Upcoming {term.bookingPluralLabel}
            </CardTitle>
            <Link
              href={`/${businessSegment}/doctors`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-slate-400 hover:text-white")}
            >
              Manage {term.staffPluralLabel}
            </Link>
          </CardHeader>
          <CardContent className="p-6">
            {enquiries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Calendar className="h-10 w-10 text-slate-600 mb-3" />
                <p className="text-sm text-slate-400">No upcoming bookings scheduled yet.</p>
                <p className="text-xs text-slate-600 mt-1">AI automatically creates bookings when clients query via WhatsApp.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="pb-3 font-medium">{term.clientLabel}</th>
                      <th className="pb-3 font-medium">Details</th>
                      <th className="pb-3 font-medium">Date & Time</th>
                      <th className="pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-sm">
                    {enquiries.map((appt) => (
                      <tr key={appt.id} className="hover:bg-slate-800/20 transition-colors">
                        <td className="py-4">
                          <div className="font-medium text-white">
                            {appt.contact_name || "Unknown Client"}
                          </div>
                          <div className="text-xs text-slate-500">
                            {appt.contact_phone || ""}
                          </div>
                        </td>
                        <td className="py-4 text-slate-300 text-xs max-w-[200px] truncate">
                          {appt.notes || "General enquiry"}
                        </td>
                        <td className="py-4 text-slate-300">
                          <div>{appt.preferred_date}</div>
                          <div className="text-xs text-slate-500">{appt.preferred_time}</div>
                        </td>
                        <td className="py-4">
                          <Badge
                            className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                              appt.status === "pending"
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                : appt.status === "confirmed" || appt.status === "completed"
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            }`}
                          >
                            {appt.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Column: Recent AI Chat Logs */}
        <Card className="lg:col-span-5 border-slate-800 bg-slate-900/60 backdrop-blur-md">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-800 pb-4">
            <CardTitle className="text-lg font-bold text-white flex items-center gap-2">
              <Bot className="h-5 w-5 text-teal-400" />
              Recent AI Activity
            </CardTitle>
            <Link
              href={`/${businessSegment}/logs`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-slate-400 hover:text-white")}
            >
              View All Logs
            </Link>
          </CardHeader>
          <CardContent className="p-6">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <MessageSquare className="h-10 w-10 text-slate-600 mb-3" />
                <p className="text-sm text-slate-400">No automated responses generated yet.</p>
                <p className="text-xs text-slate-600 mt-1">AI logs appear here when incoming messages are processed.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {logs.map((log) => (
                  <div key={log.id} className="border-b border-slate-800 pb-4 last:border-b-0 last:pb-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                        <User className="h-3 w-3 text-slate-500" />
                        {log.contact?.name || "Client"}
                      </span>
                      <Badge className="bg-teal-500/10 text-teal-400 border border-teal-500/20 text-[9px] font-semibold uppercase tracking-wider">
                        {log.detected_intent}
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-500 italic truncate mb-1">
                      "{log.user_message}"
                    </div>
                    <div className="text-xs text-slate-300 bg-slate-800/40 rounded-lg p-2.5 border border-slate-800/60 mt-1">
                      <span className="font-semibold text-teal-400 text-[10px] block uppercase tracking-wider mb-0.5">AI Response:</span>
                      {log.ai_response}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-600 mt-1.5">
                      <span>Conf score: {log.confidence_score ? `${(Number(log.confidence_score) * 100).toFixed(0)}%` : "N/A"}</span>
                      <span>{new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
