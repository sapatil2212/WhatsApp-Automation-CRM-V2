"use client";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import { getTerminology } from "@/lib/business/terminology";
import { Loader2, History, User, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AILogsPage() {
  const params = useParams();
  const businessSegment = params.businessSegment as string;
  const term = getTerminology(businessSegment);

  const db = createClient();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const { data: business } = await db
          .from("business_profiles")
          .select("id")
          .maybeSingle();

        if (business) {
          const { data: chatLogs, error } = await db
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
            .order("created_at", { ascending: false });

          if (error) console.error("Error loading AI logs:", error);
          else setLogs(chatLogs || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [businessSegment]);

  if (loading) return <PageSkeleton variant="table" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <History className="h-6 w-6 text-primary" />
          WhatsApp AI Automation Activity Logs
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Review details of automated conversations handled by your AI agent, including recognized intents and response confidence.
        </p>
      </div>

      <Card className="border-border bg-muted/40 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-sm font-bold text-foreground">Activity Logs</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">Total automated replies generated: {logs.length}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No AI log activity found.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {logs.map((log) => (
                <div key={log.id} className="border-b border-border pb-6 last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-350 flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      {log.contact?.name || "Client"} ({log.contact?.phone || "Unknown Number"})
                    </span>
                    <div className="flex gap-2">
                      <Badge className="bg-teal-500/10 text-teal-400 border border-teal-500/20 text-[9px] font-semibold uppercase tracking-wider">
                        Intent: {log.detected_intent}
                      </Badge>
                      <Badge className="bg-muted text-muted-foreground border border-border text-[9px] font-semibold uppercase tracking-wider">
                        Conf: {log.confidence_score ? `${(Number(log.confidence_score) * 100).toFixed(0)}%` : "N/A"}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-2 mt-2">
                    <div className="text-xs text-slate-450 italic pl-3 border-l-2 border-border py-1">
                      "{log.user_message}"
                    </div>
                    <div className="text-xs text-foreground/90 bg-background rounded-lg p-3 border border-slate-850">
                      <span className="font-semibold text-teal-400 text-[10px] block uppercase tracking-wider mb-1">AI Response:</span>
                      {log.ai_response}
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground text-right mt-2">
                    {new Date(log.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
