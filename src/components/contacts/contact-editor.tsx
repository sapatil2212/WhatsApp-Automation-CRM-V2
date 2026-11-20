'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/campaigns/api';

export interface TagItem {
  id: string;
  name: string;
  color: string;
  contactCount?: number;
}

export interface ContactRow {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  tags: TagItem[];
}

const TAG_COLORS = ['#16a34a', '#2563eb', '#9333ea', '#ea580c', '#dc2626', '#0891b2', '#ca8a04', '#db2777'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: ContactRow | null;
  tags: TagItem[];
  onTagCreated: (tag: TagItem) => void;
  onSaved: (contact: ContactRow) => void;
}

export function ContactEditor({ open, onOpenChange, contact, tags, onTagCreated, onSaved }: Props) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setPhone(contact?.phone ? `+${contact.phone.replace(/^\+/, '')}` : '');
    setName(contact?.name ?? '');
    setEmail(contact?.email ?? '');
    setCompany(contact?.company ?? '');
    setTagIds(contact?.tags.map((t) => t.id) ?? []);
    setErrors({});
    setNewTag('');
  }, [open, contact]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    const digits = phone.replace(/\D/g, '');
    if (!/^[1-9]\d{6,14}$/.test(digits)) e.phone = 'Enter the number with country code, e.g. +91 98765 43210';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Enter a valid email address';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function createTag() {
    const n = newTag.trim();
    if (!n) return;
    const existing = tags.find((t) => t.name.toLowerCase() === n.toLowerCase());
    if (existing) {
      setTagIds((ids) => (ids.includes(existing.id) ? ids : [...ids, existing.id]));
      setNewTag('');
      return;
    }
    try {
      const res = await api<TagItem>('/api/tags', { method: 'POST', json: { name: n, color: TAG_COLORS[tags.length % TAG_COLORS.length] } });
      onTagCreated(res.data);
      setTagIds((ids) => [...ids, res.data.id]);
      setNewTag('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create tag');
    }
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    const body = {
      phone: phone.replace(/\D/g, ''),
      name: name.trim() || null,
      email: email.trim() || null,
      company: company.trim() || null,
      tagIds,
    };
    try {
      const res = contact
        ? await api<ContactRow>(`/api/contacts/${contact.id}`, { method: 'PATCH', json: body })
        : await api<ContactRow>('/api/contacts', { method: 'POST', json: body });
      toast.success(contact ? 'Contact updated' : 'Contact added');
      onSaved(res.data);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save contact';
      if (/phone/i.test(message)) setErrors((e) => ({ ...e, phone: message }));
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{contact ? 'Edit contact' : 'Add contact'}</DialogTitle>
          <DialogDescription>WhatsApp number with country code is required; everything else is optional.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); save(); }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-phone">WhatsApp number *</Label>
              <Input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" inputMode="tel" autoFocus={!contact} aria-invalid={Boolean(errors.phone)} />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Full name</Label>
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Sharma" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-company">Company</Label>
              <Input id="c-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Pvt Ltd" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="priya@example.com" aria-invalid={Boolean(errors.email)} />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const on = tagIds.includes(t.id);
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => setTagIds((ids) => (on ? ids.filter((x) => x !== t.id) : [...ids, t.id]))}
                    aria-pressed={on}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? 'border-transparent font-medium' : 'border-border text-muted-foreground hover:bg-accent'}`}
                    style={on ? { backgroundColor: `${t.color}22`, color: t.color } : undefined}
                  >
                    {on ? <Check className="size-3" /> : <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />}
                    {t.name}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value.slice(0, 60))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createTag(); } }}
                placeholder="New tag name"
                className="h-8 text-xs"
              />
              <Button type="button" size="sm" variant="outline" onClick={createTag} disabled={!newTag.trim()}>
                <Plus className="size-3.5" /> Add tag
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />} {contact ? 'Save changes' : 'Add contact'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
