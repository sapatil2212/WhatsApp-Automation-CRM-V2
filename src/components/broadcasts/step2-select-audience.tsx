'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CustomField, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Users,
  Tags,
  Filter,
  Upload,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
} from 'lucide-react';

type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv';
type CustomFieldOperator = 'is' | 'is_not' | 'contains';

interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  excludeTagIds?: string[];
}

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

const audienceOptions: {
  type: AudienceType;
  label: string;
  description: string;
  icon: typeof Users;
}[] = [
  {
    type: 'all',
    label: 'All Contacts',
    description: 'Send to every contact in your database',
    icon: Users,
  },
  {
    type: 'tags',
    label: 'Filter by Tags',
    description: 'Target contacts with specific tags',
    icon: Tags,
  },
  {
    type: 'custom_field',
    label: 'Custom Field',
    description: 'Filter by a custom field value',
    icon: Filter,
  },
  {
    type: 'csv',
    label: 'Upload CSV',
    description: 'Upload a list of phone numbers',
    icon: Upload,
  },
];

const OPERATOR_OPTIONS: { value: CustomFieldOperator; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'contains', label: 'contains' },
];

export function Step2SelectAudience({
  audience,
  onUpdate,
  onNext,
  onBack,
}: Step2Props) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);

  // Tags are used both by the primary "Filter by Tags" audience type
  // AND by the exclude-list below — so always load once on mount.
  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('tags').select('*').order('name');
        setTags(data ?? []);
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  // Lazy-load custom fields only when that audience type is active.
  useEffect(() => {
    if (audience.type !== 'custom_field') return;
    async function fetchFields() {
      setLoadingFields(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('custom_fields')
          .select('*')
          .order('field_name');
        setCustomFields(data ?? []);
      } finally {
        setLoadingFields(false);
      }
    }
    fetchFields();
  }, [audience.type]);

  const fetchEstimatedCount = useCallback(async () => {
    setLoadingCount(true);
    try {
      const supabase = createClient();

      // Base query — produces the superset before exclude is applied.
      let baseIds: Set<string> | null = null; // null means "all contacts"

      if (audience.type === 'all') {
        // Handled below — full-table count adjusted by excludes.
      } else if (
        audience.type === 'tags' &&
        audience.tagIds &&
        audience.tagIds.length > 0
      ) {
        const { data } = await supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', audience.tagIds);
        baseIds = new Set((data ?? []).map((r: any) => r.contact_id));
      } else if (
        audience.type === 'custom_field' &&
        audience.customField?.fieldId &&
        audience.customField.value
      ) {
        const { fieldId, operator, value } = audience.customField;
        let q = supabase
          .from('contact_custom_values')
          .select('contact_id')
          .eq('custom_field_id', fieldId);
        if (operator === 'is') q = q.eq('value', value);
        else if (operator === 'is_not') q = q.neq('value', value);
        else q = q.ilike('value', `%${value}%`);
        const { data } = await q;
        baseIds = new Set((data ?? []).map((r: any) => r.contact_id));
      } else if (
        audience.type === 'csv' &&
        audience.csvContacts &&
        audience.csvContacts.length > 0
      ) {
        setEstimatedCount(audience.csvContacts.length);
        return;
      } else {
        // Partially-configured audience — wait for the user to finish.
        setEstimatedCount(null);
        return;
      }

      // Apply exclude tags
      let excludeSet: Set<string> | null = null;
      if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
        const { data: excludeRows } = await supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', audience.excludeTagIds);
        excludeSet = new Set((excludeRows ?? []).map((r: any) => r.contact_id));
      }

      if (baseIds) {
        const effective = [...baseIds].filter(
          (id) => !excludeSet?.has(id),
        );
        setEstimatedCount(effective.length);
      } else {
        // "All" — fetch the total, then subtract exclude set if any.
        const { count } = await supabase
          .from('contacts')
          .select('*', { count: 'exact', head: true });
        const total = count ?? 0;
        setEstimatedCount(excludeSet ? Math.max(0, total - excludeSet.size) : total);
      }
    } finally {
      setLoadingCount(false);
    }
  }, [
    audience.type,
    audience.tagIds,
    audience.customField,
    audience.csvContacts,
    audience.excludeTagIds,
  ]);

  useEffect(() => {
    fetchEstimatedCount();
  }, [fetchEstimatedCount]);

  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, tagIds: updated });
  }

  function toggleExcludeTag(tagId: string) {
    const current = audience.excludeTagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, excludeTagIds: updated });
  }

  function updateCustomField(patch: Partial<CustomFieldFilter>) {
    const prev = audience.customField ?? {
      fieldId: '',
      operator: 'is' as CustomFieldOperator,
      value: '',
    };
    onUpdate({ ...audience, customField: { ...prev, ...patch } });
  }

  const isValid =
    audience.type === 'all' ||
    (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) ||
    (audience.type === 'custom_field' &&
      !!audience.customField?.fieldId &&
      audience.customField.value.length > 0) ||
    (audience.type === 'csv' &&
      audience.csvContacts &&
      audience.csvContacts.length > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground sm:text-lg">
          Select Target Audience
        </h2>
        <p className="text-xs text-muted-foreground">
          Define who will receive your broadcast message using smart filters or tags.
        </p>
      </div>

      {/* Prominent Audience Estimate Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-primary/25 bg-primary/5 p-4 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Estimated Campaign Reach
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              {loadingCount ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Calculating recipients…</span>
                </div>
              ) : estimatedCount !== null ? (
                <>
                  <span className="text-xl font-bold tracking-tight text-foreground tabular-nums">
                    {estimatedCount.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    contacts selected
                  </span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Select an audience filter below
                </span>
              )}
            </div>
          </div>
        </div>

        {estimatedCount !== null && estimatedCount === 0 && !loadingCount && (
          <span className="text-[11px] font-medium text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/20">
            No contacts match current criteria
          </span>
        )}
      </div>

      {/* Audience Type Selection Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {audienceOptions.map((option) => {
          const isSelected = audience.type === option.type;
          const Icon = option.icon;
          return (
            <button
              key={option.type}
              type="button"
              onClick={() =>
                onUpdate({
                  ...audience,
                  type: option.type,
                  tagIds: option.type === 'tags' ? audience.tagIds : undefined,
                  customField:
                    option.type === 'custom_field'
                      ? audience.customField
                      : undefined,
                  csvContacts:
                    option.type === 'csv' ? audience.csvContacts : undefined,
                })
              }
              className={`flex items-start gap-3.5 rounded-xl border p-4 text-left transition-all cursor-pointer ${
                isSelected
                  ? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary/40'
                  : 'border-border/70 bg-card/60 hover:border-border hover:bg-accent/40'
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  isSelected
                    ? 'bg-primary text-primary-foreground shadow-2xs'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-foreground">{option.label}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Tag Selection Config */}
      {audience.type === 'tags' && (
        <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-foreground">Include Contacts with Tags</p>
            {audience.tagIds && audience.tagIds.length > 0 && (
              <button
                type="button"
                onClick={() => onUpdate({ ...audience, tagIds: [] })}
                className="text-[11px] font-medium text-primary hover:underline"
              >
                Clear all ({audience.tagIds.length})
              </button>
            )}
          </div>
          {loadingTags ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">Loading tags…</span>
            </div>
          ) : tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No tags found. You can create tags in Settings.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {tags.map((tag) => {
                const isSelected = audience.tagIds?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'border-primary/40 bg-primary/10 text-primary shadow-2xs font-semibold'
                        : 'border-border/80 bg-background/80 text-muted-foreground hover:border-border hover:text-foreground'
                    }`}
                  >
                    <span
                      className="mr-1.5 h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Custom Field Filter Config */}
      {audience.type === 'custom_field' && (
        <div className="space-y-3 rounded-xl border border-border/70 bg-card/60 p-4">
          <p className="text-xs font-bold text-foreground">Filter by Custom Field</p>
          {loadingFields ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">Loading fields…</span>
            </div>
          ) : customFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No custom fields defined. Create one in Settings → Custom Fields.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)]">
              <select
                value={audience.customField?.fieldId ?? ''}
                onChange={(e) => updateCustomField({ fieldId: e.target.value })}
                className="h-9 rounded-lg border border-border/80 bg-background px-3 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Select field…</option>
                {customFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.field_name}
                  </option>
                ))}
              </select>
              <select
                value={audience.customField?.operator ?? 'is'}
                onChange={(e) =>
                  updateCustomField({
                    operator: e.target.value as CustomFieldOperator,
                  })
                }
                className="h-9 rounded-lg border border-border/80 bg-background px-3 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                {OPERATOR_OPTIONS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={audience.customField?.value ?? ''}
                onChange={(e) => updateCustomField({ value: e.target.value })}
                placeholder="Field value to match…"
                className="h-9 rounded-lg border border-border/80 bg-background px-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
        </div>
      )}

      {/* Exclude list — applies regardless of audience type */}
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <X className="h-4 w-4 text-destructive" />
            <p className="text-xs font-bold text-foreground">
              Exclude Contacts with Specific Tags
            </p>
            <span className="text-[10px] text-muted-foreground">(Optional)</span>
          </div>
          {audience.excludeTagIds && audience.excludeTagIds.length > 0 && (
            <button
              type="button"
              onClick={() => onUpdate({ ...audience, excludeTagIds: [] })}
              className="text-[11px] font-medium text-destructive hover:underline"
            >
              Clear exclusions
            </button>
          )}
        </div>

        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tags available to exclude.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {tags.map((tag) => {
              const isExcluded = audience.excludeTagIds?.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleExcludeTag(tag.id)}
                  className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                    isExcluded
                      ? 'border-destructive/40 bg-destructive/15 text-destructive font-semibold shadow-2xs'
                      : 'border-border/80 bg-background/80 text-muted-foreground hover:border-destructive/30 hover:text-foreground'
                  }`}
                >
                  <span
                    className="mr-1.5 h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
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
          <span>Back to Template</span>
        </Button>
        <Button
          size="sm"
          onClick={onNext}
          disabled={!isValid}
          className="gap-1.5 text-xs shadow-xs"
        >
          <span>Continue to Personalize</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
