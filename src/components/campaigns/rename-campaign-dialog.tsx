'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, type BroadcastDto } from '@/lib/campaigns/api';

/** Renames a campaign. Works for every status, including finished ones. */
export function RenameCampaignDialog({ campaign, onClose, onSaved }: { campaign: BroadcastDto | null; onClose: () => void; onSaved: (updated: BroadcastDto) => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(campaign?.name ?? '');
  }, [campaign]);

  const save = async () => {
    if (!campaign) return;
    setSaving(true);
    try {
      const res = await api<BroadcastDto>(`/api/broadcasts/${campaign.id}`, { method: 'PATCH', json: { name: name.trim() } });
      toast.success('Campaign renamed');
      onSaved(res.data);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(campaign)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename campaign</DialogTitle>
          <DialogDescription>Only the name changes. Messages already sent and their results stay as they are.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="campaign-name">Campaign name</Label>
          <Input id="campaign-name" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && void save()} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim() || name.trim() === campaign?.name}>
            {saving && <Loader2 className="mr-1 size-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
