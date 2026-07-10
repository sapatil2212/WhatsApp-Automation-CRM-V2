'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  Link2,
  Phone,
  MessageSquareReply,
  Send,
  Info,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MessageTemplate } from '@/types';

const CATEGORIES = ['Marketing', 'Utility', 'Authentication'] as const;
const HEADER_TYPES = ['none', 'text', 'image', 'video', 'document'] as const;

const categoryColors: Record<string, string> = {
  Marketing: 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30',
  Utility: 'bg-teal-600/20 text-teal-400 border-teal-600/30',
  Authentication: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
};

const statusColors: Record<string, string> = {
  Draft: 'bg-slate-600/20 text-slate-400 border-slate-600/30',
  Pending: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
  Approved: 'bg-primary/20 text-primary border-primary/30',
  Rejected: 'bg-red-600/20 text-red-400 border-red-600/30',
};

const COMMON_LANGUAGE_CODES = [
  'en_US', 'en_GB', 'en', 'es', 'es_ES', 'es_MX', 'fr', 'fr_FR', 'de',
  'it', 'pt_BR', 'pt_PT', 'nl', 'pl', 'ru', 'tr', 'hi', 'ar', 'id',
];

type ButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';

interface TemplateButton {
  type: ButtonType;
  text: string;
  url?: string;
  phone_number?: string;
  example?: string;
}

interface TemplateFormData {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_type: (typeof HEADER_TYPES)[number];
  header_text: string;
  header_example: string;
  header_text_example: string;
  body_text: string;
  body_example: string[];
  footer_text: string;
  buttons: TemplateButton[];
}

const emptyForm: TemplateFormData = {
  name: '',
  category: 'Marketing',
  language: 'en_US',
  header_type: 'none',
  header_text: '',
  header_example: '',
  header_text_example: '',
  body_text: '',
  body_example: [],
  footer_text: '',
  buttons: [],
};

/** Highest {{n}} placeholder in a string (0 = none). */
function maxPlaceholder(text: string): number {
  const nums = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

/** Render {{1}} → sample value for the live preview. */
function fillPreview(text: string, samples: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
    const idx = Number(n) - 1;
    return samples[idx]?.trim() || `{{${n}}}`;
  });
}

export function TemplateManager() {
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState<TemplateFormData>(emptyForm);

  const bodyVarCount = useMemo(() => maxPlaceholder(form.body_text), [form.body_text]);
  const headerHasVar = useMemo(
    () => form.header_type === 'text' && maxPlaceholder(form.header_text) === 1,
    [form.header_type, form.header_text],
  );

  useEffect(() => {
    if (authLoading) return;
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  async function fetchTemplates() {
    try {
      setLoading(true);
      const res = await fetch('/api/whatsapp/templates');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load templates');
      setTemplates(data.templates || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }

  function updateForm(patch: Partial<TemplateFormData>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function addButton(type: ButtonType) {
    if (form.buttons.length >= 10) {
      toast.error('A template supports at most 10 buttons.');
      return;
    }
    setForm((prev) => ({
      ...prev,
      buttons: [...prev.buttons, { type, text: '', url: '', phone_number: '', example: '' }],
    }));
  }

  function updateButton(index: number, patch: Partial<TemplateButton>) {
    setForm((prev) => ({
      ...prev,
      buttons: prev.buttons.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    }));
  }

  function removeButton(index: number) {
    setForm((prev) => ({ ...prev, buttons: prev.buttons.filter((_, i) => i !== index) }));
  }

  async function handleSubmit() {
    if (!form.name.trim()) return toast.error('Template name is required');
    if (!form.body_text.trim()) return toast.error('Body text is required');

    const payload = {
      name: form.name,
      category: form.category,
      language: form.language.trim() || 'en_US',
      header_type: form.header_type,
      header_text: form.header_text,
      header_example: form.header_example,
      header_text_example: headerHasVar ? [form.header_text_example] : [],
      body_text: form.body_text,
      body_example: form.body_example.slice(0, bodyVarCount),
      footer_text: form.footer_text,
      buttons: form.buttons,
    };

    try {
      setSaving(true);
      const res = await fetch('/api/whatsapp/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to submit template');
      toast.success(
        data.meta_status === 'APPROVED'
          ? 'Template approved by Meta and ready to send.'
          : 'Template submitted to Meta for review. Status will update once approved.',
      );
      setDialogOpen(false);
      setForm(emptyForm);
      await fetchTemplates();
    } catch (err) {
      console.error('Submit error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to submit template');
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncFromMeta() {
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Sync failed (HTTP ${res.status})`);
      toast.success(
        `Synced ${data.total} template${data.total === 1 ? '' : 's'} from Meta` +
          (data.inserted || data.updated ? ` (${data.inserted} new, ${data.updated} updated)` : ''),
      );
      await fetchTemplates();
    } catch (err) {
      console.error('Template sync error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to sync templates');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/whatsapp/templates?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to delete template');
      toast.success('Template deleted');
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error('Delete error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete template');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">Message Templates</h2>
          <p className="text-sm text-slate-400 max-w-2xl">
            Build WhatsApp templates with headers, variables, and call-to-action
            buttons, then submit them to Meta for approval right here. Use
            &quot;Sync from Meta&quot; to pull the latest approval status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSyncFromMeta}
            disabled={syncing}
            className="border-slate-200 dark:border-slate-700 bg-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
            title="Pull approval status from your Meta WhatsApp Business Account"
          >
            <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync from Meta'}
          </Button>
          <Button
            onClick={() => {
              setForm(emptyForm);
              setDialogOpen(true);
            }}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            New Template
          </Button>
        </div>
      </div>

      {templates.length === 0 ? (
        <Card className="bg-slate-900/40 border-slate-800">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-slate-400 text-sm">No templates yet.</p>
            <p className="text-slate-400 text-xs mt-1">
              Create your first template and submit it for Meta approval.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {templates.map((template) => (
            <Card key={template.id} className="bg-slate-900/40 border-slate-800">
              <CardContent className="flex items-start justify-between pt-4">
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-slate-200">{template.name}</h3>
                    <Badge className={`text-xs border ${categoryColors[template.category] || ''}`}>
                      {template.category}
                    </Badge>
                    <Badge className={`text-xs border ${statusColors[template.status || 'Draft'] || ''}`}>
                      {template.status || 'Draft'}
                    </Badge>
                    {template.language && (
                      <span className="text-xs text-slate-400 uppercase">{template.language}</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400 line-clamp-2">{template.body_text}</p>
                  {template.footer_text && (
                    <p className="text-xs text-slate-400 italic">{template.footer_text}</p>
                  )}
                  {Array.isArray(template.buttons) && template.buttons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {(template.buttons as Array<Record<string, unknown>>).map((b, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-300"
                        >
                          {b.type === 'URL' ? (
                            <Link2 className="size-3" />
                          ) : b.type === 'PHONE_NUMBER' ? (
                            <Phone className="size-3" />
                          ) : (
                            <MessageSquareReply className="size-3" />
                          )}
                          {String(b.text ?? '')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(template.id)}
                  className="text-slate-400 hover:text-red-400 hover:bg-red-950/30 shrink-0 ml-2"
                >
                  <Trash2 className="size-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Builder dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-slate-200">New Message Template</DialogTitle>
            <DialogDescription>
              Templates are submitted to Meta for review. Approval typically takes
              a few minutes to a few hours.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-2 md:grid-cols-[1fr_300px]">
            {/* ── Builder ── */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-200">Template Name</Label>
                  <Input
                    placeholder="order_confirmation"
                    value={form.name}
                    onChange={(e) => updateForm({ name: e.target.value })}
                  />
                  <p className="text-[11px] text-slate-400">
                    Lowercase letters, numbers, underscores only.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-200">Language</Label>
                  <Input
                    list="template-language-codes"
                    placeholder="en_US"
                    value={form.language}
                    onChange={(e) => updateForm({ language: e.target.value })}
                  />
                  <datalist id="template-language-codes">
                    {COMMON_LANGUAGE_CODES.map((code) => (
                      <option key={code} value={code} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-200">Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(val) =>
                    updateForm({ category: val as MessageTemplate['category'] })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Header */}
              <div className="space-y-2">
                <Label className="text-slate-200">Header (optional)</Label>
                <Select
                  value={form.header_type}
                  onValueChange={(val) =>
                    updateForm({ header_type: val as TemplateFormData['header_type'] })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HEADER_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type === 'none' ? 'None' : type.charAt(0).toUpperCase() + type.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.header_type === 'text' && (
                  <>
                    <Input
                      placeholder="Header text (max 60 chars, one {{1}} allowed)"
                      value={form.header_text}
                      onChange={(e) => updateForm({ header_text: e.target.value })}
                      maxLength={60}
                    />
                    {headerHasVar && (
                      <Input
                        placeholder="Sample value for header {{1}}"
                        value={form.header_text_example}
                        onChange={(e) => updateForm({ header_text_example: e.target.value })}
                      />
                    )}
                  </>
                )}
                {(form.header_type === 'image' ||
                  form.header_type === 'video' ||
                  form.header_type === 'document') && (
                  <Input
                    placeholder={`Sample ${form.header_type} URL (for Meta review)`}
                    value={form.header_example}
                    onChange={(e) => updateForm({ header_example: e.target.value })}
                  />
                )}
              </div>

              {/* Body */}
              <div className="space-y-2">
                <Label className="text-slate-200">Body Text</Label>
                <Textarea
                  placeholder="Hi {{1}}, your order {{2}} has shipped!"
                  value={form.body_text}
                  onChange={(e) => updateForm({ body_text: e.target.value })}
                  rows={4}
                  className="resize-none"
                />
                <p className="text-[11px] text-slate-400">
                  Use {'{{1}}'}, {'{{2}}'} for variables. Meta requires a sample
                  value for each.
                </p>
                {bodyVarCount > 0 && (
                  <div className="grid gap-2 rounded-md border border-slate-800 bg-slate-900/40 p-3">
                    {Array.from({ length: bodyVarCount }).map((_, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 w-10">{`{{${i + 1}}}`}</span>
                        <Input
                          placeholder={`Sample for variable ${i + 1}`}
                          value={form.body_example[i] ?? ''}
                          onChange={(e) => {
                            const next = [...form.body_example];
                            next[i] = e.target.value;
                            updateForm({ body_example: next });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="space-y-2">
                <Label className="text-slate-200">Footer (optional)</Label>
                <Input
                  placeholder="e.g. Reply STOP to unsubscribe"
                  value={form.footer_text}
                  onChange={(e) => updateForm({ footer_text: e.target.value })}
                  maxLength={60}
                />
              </div>

              {/* Buttons */}
              <div className="space-y-2">
                <Label className="text-slate-200">Buttons (optional)</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addButton('QUICK_REPLY')}
                    className="border-slate-700 text-slate-300"
                  >
                    <MessageSquareReply className="size-3.5" /> Quick reply
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addButton('URL')}
                    className="border-slate-700 text-slate-300"
                  >
                    <Link2 className="size-3.5" /> Visit website
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addButton('PHONE_NUMBER')}
                    className="border-slate-700 text-slate-300"
                  >
                    <Phone className="size-3.5" /> Call phone
                  </Button>
                </div>

                {form.buttons.map((btn, i) => (
                  <div
                    key={i}
                    className="space-y-2 rounded-md border border-slate-800 bg-slate-900/40 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-300">
                        {btn.type === 'URL'
                          ? 'Visit website'
                          : btn.type === 'PHONE_NUMBER'
                            ? 'Call phone'
                            : 'Quick reply'}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeButton(i)}
                        className="size-6 text-slate-400 hover:text-red-400"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <Input
                      placeholder="Button label (max 25 chars)"
                      value={btn.text}
                      maxLength={25}
                      onChange={(e) => updateButton(i, { text: e.target.value })}
                    />
                    {btn.type === 'URL' && (
                      <>
                        <Input
                          placeholder="https://example.com/{{1}}"
                          value={btn.url}
                          onChange={(e) => updateButton(i, { url: e.target.value })}
                        />
                        {/\{\{\s*1\s*\}\}/.test(btn.url ?? '') && (
                          <Input
                            placeholder="Sample URL value (e.g. order/123)"
                            value={btn.example}
                            onChange={(e) => updateButton(i, { example: e.target.value })}
                          />
                        )}
                      </>
                    )}
                    {btn.type === 'PHONE_NUMBER' && (
                      <Input
                        placeholder="+14155551234"
                        value={btn.phone_number}
                        onChange={(e) => updateButton(i, { phone_number: e.target.value })}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Live preview ── */}
            <div className="space-y-2">
              <Label className="text-slate-200">Preview</Label>
              <div className="rounded-xl bg-[#0b141a] p-3">
                <div className="max-w-[260px] rounded-lg rounded-tl-none bg-[#202c33] p-2.5 shadow">
                  {form.header_type === 'text' && form.header_text && (
                    <p className="mb-1 text-sm font-semibold text-slate-100">
                      {fillPreview(form.header_text, [form.header_text_example])}
                    </p>
                  )}
                  {(form.header_type === 'image' ||
                    form.header_type === 'video' ||
                    form.header_type === 'document') && (
                    <div className="mb-1 flex h-20 items-center justify-center rounded bg-slate-700/50 text-[11px] uppercase text-slate-400">
                      {form.header_type}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap text-sm text-slate-100">
                    {fillPreview(form.body_text || 'Your message body…', form.body_example)}
                  </p>
                  {form.footer_text && (
                    <p className="mt-1 text-[11px] text-slate-400">{form.footer_text}</p>
                  )}
                </div>
                {form.buttons.length > 0 && (
                  <div className="mt-1 max-w-[260px] space-y-1">
                    {form.buttons.map((b, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-[#202c33] py-2 text-sm font-medium text-[#53bdeb]"
                      >
                        {b.type === 'URL' ? (
                          <Link2 className="size-3.5" />
                        ) : b.type === 'PHONE_NUMBER' ? (
                          <Phone className="size-3.5" />
                        ) : (
                          <MessageSquareReply className="size-3.5" />
                        )}
                        {b.text || 'Button'}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-start gap-1.5 rounded-md border border-slate-800 bg-slate-900/40 p-2 text-[11px] text-slate-400">
                <Info className="size-3.5 shrink-0 mt-0.5" />
                <span>
                  Marketing templates with variables face stricter review. Keep
                  the copy specific and avoid promotional-only content in Utility
                  templates.
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Submitting…
                </>
              ) : (
                <>
                  <Send className="size-4" /> Submit for approval
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
