'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Contact, CustomField, MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, ArrowRight, Eye, Loader2, FileText, Sparkles } from 'lucide-react';

type VariableType = 'static' | 'field' | 'custom_field';

interface VariableMapping {
  type: VariableType;
  value: string;
}

interface Step3Props {
  template: MessageTemplate;
  variables: Record<string, VariableMapping>;
  onUpdate: (variables: Record<string, VariableMapping>) => void;
  onNext: () => void;
  onBack: () => void;
}

const contactFields = [
  { value: 'name', label: 'Contact Name' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'email', label: 'Email Address' },
  { value: 'company', label: 'Company' },
];

const SAMPLE_CONTACT: Contact = {
  id: 'sample',
  user_id: '',
  name: 'John Doe',
  phone: '+1234567890',
  email: 'john@example.com',
  company: 'Acme Corp',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export function Step3Personalize({
  template,
  variables,
  onUpdate,
  onNext,
  onBack,
}: Step3Props) {
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [firstContact, setFirstContact] = useState<Contact | null>(null);
  const [firstContactCustomValues, setFirstContactCustomValues] = useState<
    Map<string, string>
  >(new Map());
  const [loadingPreview, setLoadingPreview] = useState(true);

  // Load user's custom fields + a representative contact for the
  // live preview. Fall back to sample data if no contacts exist yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [fieldsRes, contactRes] = await Promise.all([
        supabase.from('custom_fields').select('*').order('field_name'),
        supabase
          .from('contacts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;

      setCustomFields(fieldsRes.data ?? []);
      setLoadingFields(false);

      const contact = contactRes.data ?? null;
      setFirstContact(contact);

      if (contact) {
        const { data: customVals } = await supabase
          .from('contact_custom_values')
          .select('custom_field_id, value')
          .eq('contact_id', contact.id);
        if (!cancelled) {
          const map = new Map<string, string>();
          for (const row of customVals ?? []) {
            map.set(row.custom_field_id, row.value ?? '');
          }
          setFirstContactCustomValues(map);
        }
      }
      setLoadingPreview(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const headerPlaceholders = useMemo(() => {
    if (template.header_type !== 'text' || !template.header_content) return [];
    const matches = template.header_content.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches)].sort();
  }, [template.header_type, template.header_content]);

  const bodyPlaceholders = useMemo(() => {
    const matches = template.body_text.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches)].sort((a, b) => {
      return Number(a.replace(/^\{\{|\}\}$/g, '')) - Number(b.replace(/^\{\{|\}\}$/g, ''));
    });
  }, [template.body_text]);

  const buttonPlaceholders = useMemo(() => {
    if (!template.buttons || !Array.isArray(template.buttons)) return [];
    const list: { buttonIndex: number; buttonText: string; placeholder: string }[] = [];
    (template.buttons as any[]).forEach((btn: any, buttonIndex: number) => {
      if (btn.type === 'URL' && btn.url) {
        const matches = btn.url.match(/\{\{(\d+)\}\}/g);
        if (matches) {
          const uniqueMatches = Array.from(new Set(matches)) as string[];
          uniqueMatches.forEach((m) => {
            list.push({
              buttonIndex,
              buttonText: (btn.text as string) || 'Button',
              placeholder: m,
            });
          });
        }
      }
    });
    return list;
  }, [template.buttons]);

  const hasAnyPlaceholders =
    headerPlaceholders.length > 0 ||
    bodyPlaceholders.length > 0 ||
    buttonPlaceholders.length > 0;

  const unmappedKeys = useMemo(() => {
    const missing: string[] = [];
    
    for (const p of headerPlaceholders) {
      const num = p.replace(/^\{\{|\}\}$/g, '');
      const key = `header_${num}`;
      const mapping = variables[key];
      if (!mapping || !mapping.value?.trim()) missing.push(`Header ${p}`);
    }

    for (const p of bodyPlaceholders) {
      const num = p.replace(/^\{\{|\}\}$/g, '');
      const key = `body_${num}`;
      const mapping = variables[key] ?? variables[num]; 
      if (!mapping || !mapping.value?.trim()) missing.push(`Body ${p}`);
    }

    for (const btn of buttonPlaceholders) {
      const num = btn.placeholder.replace(/^\{\{|\}\}$/g, '');
      const key = `button_${btn.buttonIndex}_${num}`;
      const mapping = variables[key];
      if (!mapping || !mapping.value?.trim()) {
        missing.push(`Button "${btn.buttonText}" ${btn.placeholder}`);
      }
    }

    return missing;
  }, [headerPlaceholders, bodyPlaceholders, buttonPlaceholders, variables]);

  function updateVariable(key: string, patch: Partial<VariableMapping>) {
    const current = variables[key] ?? { type: 'static' as VariableType, value: '' };
    onUpdate({
      ...variables,
      [key]: { ...current, ...patch },
    });
  }

  function resolveMappingValue(
    mapping: VariableMapping | undefined,
    contact: Contact,
    customValues: Map<string, string>,
  ): string {
    if (!mapping) return '';
    if (mapping.type === 'static') return mapping.value;
    if (mapping.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[mapping.value] ?? '';
    }
    if (mapping.type === 'custom_field') {
      return customValues.get(mapping.value) ?? '';
    }
    return '';
  }

  const previewText = useMemo(() => {
    const contact = firstContact ?? SAMPLE_CONTACT;
    const customValues = firstContact
      ? firstContactCustomValues
      : new Map<string, string>();

    let text = template.body_text;
    for (const placeholder of bodyPlaceholders) {
      const num = placeholder.replace(/^\{\{|\}\}$/g, '');
      const key = `body_${num}`;
      const mapping = variables[key] ?? variables[num]; 
      const replacement = resolveMappingValue(mapping, contact, customValues) || placeholder;
      text = text.replaceAll(placeholder, replacement);
    }
    return text;
  }, [template.body_text, bodyPlaceholders, variables, firstContact, firstContactCustomValues]);

  const previewHeaderText = useMemo(() => {
    if (template.header_type !== 'text' || !template.header_content) return null;
    const contact = firstContact ?? SAMPLE_CONTACT;
    const customValues = firstContact
      ? firstContactCustomValues
      : new Map<string, string>();

    let text = template.header_content;
    for (const placeholder of headerPlaceholders) {
      const num = placeholder.replace(/^\{\{|\}\}$/g, '');
      const key = `header_${num}`;
      const mapping = variables[key];
      const replacement = resolveMappingValue(mapping, contact, customValues) || placeholder;
      text = text.replaceAll(placeholder, replacement);
    }
    return text;
  }, [template.header_type, template.header_content, headerPlaceholders, variables, firstContact, firstContactCustomValues]);

  const previewLabel = firstContact
    ? firstContact.name || firstContact.phone
    : 'sample data';

  function renderPlaceholderRow(placeholder: string, key: string, labelPrefix?: string) {
    const mapping = variables[key] ?? { type: 'static', value: '' };

    return (
      <div
        key={key}
        className="rounded-xl border border-border/70 bg-card/60 p-3.5 space-y-2.5 transition-all hover:border-border"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-mono font-bold text-primary">
              {placeholder}
            </span>
            {labelPrefix && (
              <span className="text-xs text-muted-foreground font-medium">{labelPrefix}</span>
            )}
          </div>
          <span className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
            {mapping.type.replace('_', ' ')}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Mapping Source
            </label>
            <Select
              value={mapping.type}
              onValueChange={(val) =>
                updateVariable(key, {
                  type: val as VariableType,
                  value: '',
                })
              }
            >
              <SelectTrigger className="w-full h-8 text-xs border-border/80 bg-background text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border bg-popover text-popover-foreground">
                <SelectItem value="field" className="text-xs">Contact Field</SelectItem>
                <SelectItem value="custom_field" className="text-xs">Custom Field</SelectItem>
                <SelectItem value="static" className="text-xs">Static Text Value</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              {mapping.type === 'static' ? 'Static Value' : 'Select Target Property'}
            </label>
            {mapping.type === 'static' ? (
              <Input
                value={mapping.value}
                onChange={(e) =>
                  updateVariable(key, { value: e.target.value })
                }
                placeholder="Enter value…"
                className="h-8 text-xs border-border/80 bg-background text-foreground placeholder:text-muted-foreground"
              />
            ) : mapping.type === 'field' ? (
              <Select
                value={mapping.value || undefined}
                onValueChange={(val) =>
                  updateVariable(key, { value: val || '' })
                }
              >
                <SelectTrigger className="w-full h-8 text-xs border-border/80 bg-background text-foreground">
                  <SelectValue placeholder="Choose contact property…" />
                </SelectTrigger>
                <SelectContent className="border-border bg-popover text-popover-foreground">
                  {contactFields.map((field) => (
                    <SelectItem key={field.value} value={field.value} className="text-xs">
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select
                value={mapping.value || undefined}
                onValueChange={(val) =>
                  updateVariable(key, { value: val || '' })
                }
              >
                <SelectTrigger className="w-full h-8 text-xs border-border/80 bg-background text-foreground">
                  <SelectValue
                    placeholder={
                      loadingFields
                        ? 'Loading…'
                        : customFields.length === 0
                          ? 'No custom fields'
                          : 'Select custom field…'
                    }
                  />
                </SelectTrigger>
                <SelectContent className="border-border bg-popover text-popover-foreground">
                  {customFields.map((f) => (
                    <SelectItem key={f.id} value={f.id} className="text-xs">
                      {f.field_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground sm:text-lg">
          Personalize Dynamic Variables
        </h2>
        <p className="text-xs text-muted-foreground">
          Map template placeholders like {'{{1}}'}, {'{{2}}'} to recipient properties or static text.
        </p>
      </div>

      {/* 2-Column Responsive Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: Variable Configuration Form */}
        <div className="space-y-5 lg:col-span-7">
          {!hasAnyPlaceholders ? (
            <div className="rounded-xl border border-border/70 bg-card/60 p-6 text-center">
              <Sparkles className="h-6 w-6 text-primary mx-auto mb-2" />
              <h3 className="text-xs font-bold text-foreground">Static Template</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                This template has no dynamic variable placeholders. You can proceed directly to the final review.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {headerPlaceholders.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Header Variables
                  </h3>
                  {headerPlaceholders.map((placeholder: string) => {
                    const key = `header_${placeholder.replace(/^\{\{|\}\}$/g, '')}`;
                    return renderPlaceholderRow(placeholder, key);
                  })}
                </div>
              )}

              {bodyPlaceholders.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Body Variables
                  </h3>
                  {bodyPlaceholders.map((placeholder: string) => {
                    const num = placeholder.replace(/^\{\{|\}\}$/g, '');
                    const key = `body_${num}`;
                    return renderPlaceholderRow(placeholder, key);
                  })}
                </div>
              )}

              {buttonPlaceholders.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Button Link Suffix
                  </h3>
                  {buttonPlaceholders.map((btn) => {
                    const num = btn.placeholder.replace(/^\{\{|\}\}$/g, '');
                    const key = `button_${btn.buttonIndex}_${num}`;
                    return renderPlaceholderRow(btn.placeholder, key, `Button "${btn.buttonText}" link`);
                  })}
                </div>
              )}
            </div>
          )}

          {unmappedKeys.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500 dark:text-amber-300">
              <span className="font-semibold block mb-0.5">Missing Required Mappings:</span>
              Please assign values for:{' '}
              <span className="font-mono font-semibold">
                {unmappedKeys.join(', ')}
              </span>
            </div>
          )}
        </div>

        {/* Right Column: Sticky Live WhatsApp Preview */}
        <div className="lg:col-span-5 lg:sticky lg:top-6">
          <div className="rounded-2xl border border-border/80 bg-card/60 p-4 shadow-sm backdrop-blur-xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Eye className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-bold text-foreground">Live Message Preview</span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                Using {previewLabel}
              </span>
            </div>

            {/* WhatsApp Chat Bubbles Background */}
            <div className="rounded-xl bg-[#0b141a] p-3.5 border border-[#1f2c34] shadow-inner">
              <div className="ml-auto max-w-[92%] rounded-xl bg-[#005c4b] text-[#e9edef] px-3.5 py-2.5 shadow-sm space-y-1.5">
                {template.header_type === 'text' && previewHeaderText && (
                  <p className="font-bold text-xs text-white pb-1 border-b border-[#00473a]">
                    {previewHeaderText}
                  </p>
                )}
                {template.header_type && template.header_type !== 'text' && (
                  <div className="flex items-center gap-2 bg-[#025142] text-[11px] font-medium text-emerald-200 p-2 rounded-lg border border-[#046c58]">
                    <FileText className="size-3.5 shrink-0" />
                    <span className="capitalize">{template.header_type} Attachment</span>
                  </div>
                )}
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-[#e9edef]">
                  {previewText}
                </p>
                {template.footer_text && (
                  <p className="text-[10px] text-[#8696a0] italic mt-1 font-medium">
                    {template.footer_text}
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              {template.buttons && Array.isArray(template.buttons) && template.buttons.length > 0 && (
                <div className="ml-auto max-w-[92%] mt-1.5 space-y-1">
                  {template.buttons.map((btn: any, idx: number) => {
                    let dynamicUrlSuffix = '';
                    if (btn.type === 'URL' && btn.url) {
                      const matches = btn.url.match(/\{\{(\d+)\}\}/g);
                      if (matches) {
                        const contact = firstContact ?? SAMPLE_CONTACT;
                        const customValues = firstContact
                          ? firstContactCustomValues
                          : new Map<string, string>();
                        
                        dynamicUrlSuffix = ' 🔗 ' + btn.url;
                        matches.forEach((m: string) => {
                          const num = m.replace(/^\{\{|\}\}$/g, '');
                          const key = `button_${idx}_${num}`;
                          const mapping = variables[key];
                          const val = resolveMappingValue(mapping, contact, customValues) || m;
                          dynamicUrlSuffix = dynamicUrlSuffix.replaceAll(m, val);
                        });
                      }
                    }
                    return (
                      <div
                        key={idx}
                        className="bg-[#202c33] border border-[#2a3942] text-[#00a884] rounded-lg py-1.5 px-3 text-center text-xs font-medium cursor-default shadow-xs"
                      >
                        {btn.text}
                        {dynamicUrlSuffix && (
                          <span className="text-[10px] text-[#8696a0] block font-normal truncate mt-0.5">
                            {dynamicUrlSuffix}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground text-center">
              Recipients will see dynamic parameters populated with their personal data.
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between border-t border-border/70 pt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={onBack}
          className="gap-1.5 text-xs"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Audience</span>
        </Button>
        <Button
          size="sm"
          onClick={onNext}
          disabled={unmappedKeys.length > 0}
          className="gap-1.5 text-xs shadow-xs"
        >
          <span>Review & Send</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
