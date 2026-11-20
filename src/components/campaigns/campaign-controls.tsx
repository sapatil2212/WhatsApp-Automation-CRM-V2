'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Pause, Play, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { api, type BroadcastDto } from '@/lib/campaigns/api';

type Action = 'pause' | 'resume' | 'cancel';

interface CampaignControlsProps {
  campaign: BroadcastDto;
  onChanged: (updated: BroadcastDto) => void;
  /** Compact icon+label buttons for table rows. */
  compact?: boolean;
}

/**
 * Pause / resume / cancel for a running campaign.
 *  - sending   → Pause, Cancel
 *  - paused    → Resume, Cancel
 *  - scheduled → Cancel
 * Renders nothing for other states.
 */
export function CampaignControls({ campaign, onChanged, compact }: CampaignControlsProps) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const { status } = campaign;
  if (status !== 'sending' && status !== 'paused' && status !== 'scheduled') return null;

  async function run(action: Action) {
    setBusy(action);
    try {
      const res = await api<BroadcastDto>(`/api/broadcasts/${campaign.id}/${action}`, { method: 'POST' });
      onChanged(res.data);
      toast.success(
        action === 'pause'
          ? 'Campaign paused. Messages already sent are not affected.'
          : action === 'resume'
            ? 'Campaign resumed.'
            : 'Campaign cancelled. No further messages will be sent.',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not ${action} the campaign`);
    } finally {
      setBusy(null);
    }
  }

  const size = compact ? 'sm' : 'default';
  const cls = compact ? 'h-7 gap-1 px-2 text-[11px]' : 'gap-1.5';
  const icon = compact ? 'size-3' : 'size-4';
  const remaining = campaign.stats.pending;

  return (
    <>
      {status === 'sending' && (
        <Button size={size} variant="outline" disabled={busy !== null} onClick={() => run('pause')} className={cls}>
          {busy === 'pause' ? <Loader2 className={`${icon} animate-spin`} /> : <Pause className={icon} />} Pause
        </Button>
      )}
      {status === 'paused' && (
        <Button size={size} disabled={busy !== null} onClick={() => run('resume')} className={cls}>
          {busy === 'resume' ? <Loader2 className={`${icon} animate-spin`} /> : <Play className={icon} />} Resume
        </Button>
      )}
      <Button
        size={size}
        variant="outline"
        disabled={busy !== null}
        onClick={() => setConfirmCancel(true)}
        className={`${cls} text-destructive hover:bg-destructive/10 hover:text-destructive`}
      >
        {busy === 'cancel' ? <Loader2 className={`${icon} animate-spin`} /> : <Square className={icon} />} Cancel
      </Button>

      <ConfirmationDialog
        isOpen={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={`Cancel “${campaign.name}”?`}
        description={
          status === 'scheduled'
            ? 'The scheduled send will not happen. This cannot be undone.'
            : `Sending stops immediately and the ${remaining.toLocaleString()} recipient${remaining === 1 ? '' : 's'} not yet messaged will be skipped. Messages already sent stay delivered. This cannot be undone — use Pause if you may want to continue later.`
        }
        confirmText="Cancel campaign"
        cancelText="Keep it"
        variant="destructive"
        onConfirm={() => run('cancel')}
      />
    </>
  );
}
