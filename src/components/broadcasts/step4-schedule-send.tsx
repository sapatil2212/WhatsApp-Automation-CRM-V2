'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Send,
  Loader2,
  Users,
  Save,
  FileText,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface AudienceConfig {
  type: string;
  tagIds?: string[];
  csvContacts?: { phone: string; name?: string }[];
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  onSend: () => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        const supabase = createClient();

        if (audience.type === 'all') {
          const { count } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true });
          setEstimatedReach(count ?? 0);
        } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
          const { data: contactTags } = await supabase
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', audience.tagIds);

          const uniqueIds = new Set((contactTags ?? []).map((ct: any) => ct.contact_id));
          setEstimatedReach(uniqueIds.size);
        } else if (audience.type === 'csv' && audience.csvContacts) {
          setEstimatedReach(audience.csvContacts.length);
        } else {
          setEstimatedReach(0);
        }
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience]);

  const audienceLabel =
    audience.type === 'all'
      ? 'All Contacts in Database'
      : audience.type === 'tags'
        ? `Segmented by Tags (${audience.tagIds?.length ?? 0} active)`
        : audience.type === 'csv'
          ? 'Uploaded CSV File'
          : 'Custom Field Segment';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground sm:text-lg">
          Review & Launch Campaign
        </h2>
        <p className="text-xs text-muted-foreground">
          Confirm your campaign setup, name your broadcast, and initiate delivery.
        </p>
      </div>

      {/* Broadcast Name Card */}
      <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-2">
        <label className="block text-xs font-bold text-foreground">
          Campaign Name <span className="text-primary">*</span>
        </label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Black Friday Early Access VIP"
          className="h-10 text-xs border-border/80 bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/20"
        />
        <p className="text-[11px] text-muted-foreground">
          Give your campaign an identifiable internal title for metrics tracking in Analytics.
        </p>
      </div>

      {/* Campaign Blueprint Grid */}
      <div className="rounded-xl border border-border/70 bg-card/60 p-5 space-y-4 shadow-xs">
        <div className="flex items-center justify-between pb-2 border-b border-border/60">
          <span className="text-xs font-bold text-foreground">Campaign Summary</span>
          <span className="inline-flex items-center gap-1 text-[10px] text-primary font-semibold">
            <CheckCircle2 className="h-3 w-3" /> Ready to Launch
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Template
            </span>
            <div className="flex items-center gap-1.5 pt-0.5">
              <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
              <p className="text-xs font-bold text-foreground truncate">{template.name}</p>
            </div>
            <p className="text-[10px] text-muted-foreground capitalize">{template.category || 'Standard'}</p>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Target Audience
            </span>
            <div className="flex items-center gap-1.5 pt-0.5">
              <Users className="h-3.5 w-3.5 text-teal-400 shrink-0" />
              <p className="text-xs font-bold text-foreground truncate">{audienceLabel}</p>
            </div>
            <p className="text-[10px] text-muted-foreground capitalize">{audience.type} mode</p>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Estimated Reach
            </span>
            <div className="flex items-center gap-1.5 pt-0.5">
              {loadingReach ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : (
                <span className="text-base font-extrabold text-foreground tabular-nums">
                  {estimatedReach.toLocaleString()}
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">recipients queued</p>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Language & Platform
            </span>
            <div className="flex items-center gap-1.5 pt-0.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <p className="text-xs font-bold text-foreground truncate">{template.language ?? 'en_US'}</p>
            </div>
            <p className="text-[10px] text-muted-foreground">Cloud API Direct</p>
          </div>
        </div>
      </div>

      {/* Meta Compliance Pill */}
      <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 p-3.5 text-xs">
        <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="space-y-0.5 text-muted-foreground leading-relaxed">
          <p className="font-semibold text-foreground text-xs">Meta Business API Protection</p>
          <p className="text-[11px]">
            Messages will be delivered safely with automatic rate-limit throttling in accordance with Meta Business platform guidelines.
          </p>
        </div>
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-xs font-bold text-foreground">Broadcasting messages via Meta Cloud API…</p>
            </div>
            <span className="text-xs font-bold text-primary tabular-nums">{progress}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Navigation and Launch Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={onBack}
          disabled={isProcessing}
          className="gap-1.5 text-xs"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Personalize</span>
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="gap-1.5 text-xs"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Save as Draft</span>
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <DialogTrigger
              render={
                <Button
                  size="sm"
                  disabled={!name.trim() || isProcessing || estimatedReach === 0}
                  className="gap-2 text-xs shadow-xs"
                />
              }
            >
              <Send className="h-3.5 w-3.5" />
              <span>Send Broadcast Now</span>
            </DialogTrigger>
            <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base text-foreground">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Confirm Broadcast Dispatch
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground pt-1.5 leading-relaxed">
                  You are about to send{' '}
                  <span className="font-bold text-foreground">
                    {estimatedReach.toLocaleString()}
                  </span>{' '}
                  WhatsApp messages using the{' '}
                  <span className="font-bold text-foreground">{template.name}</span> template. Once triggered, delivery commences immediately.
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Campaign:</span>
                  <span className="font-semibold text-foreground">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recipients:</span>
                  <span className="font-semibold text-foreground">{estimatedReach.toLocaleString()}</span>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowConfirm(false)}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setShowConfirm(false);
                    onSend();
                  }}
                  className="gap-1.5 text-xs"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Confirm & Send</span>
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
