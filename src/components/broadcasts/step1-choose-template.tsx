'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Loader2,
  FileText,
  ArrowRight,
  Search,
  CheckCircle2,
  Globe,
  Sparkles,
  PlusCircle,
} from 'lucide-react';

const categoryColors: Record<string, { bg: string; text: string; border: string }> = {
  Marketing: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-500 dark:text-emerald-400',
    border: 'border-emerald-500/20',
  },
  Utility: {
    bg: 'bg-teal-500/10',
    text: 'text-teal-500 dark:text-teal-400',
    border: 'border-teal-500/20',
  },
  Authentication: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-500 dark:text-amber-400',
    border: 'border-amber-500/20',
  },
};

interface Step1Props {
  selectedTemplate: MessageTemplate | null;
  onSelect: (template: MessageTemplate) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step1ChooseTemplate({ selectedTemplate, onSelect, onNext, onBack }: Step1Props) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const supabase = createClient();
        const { data, error: fetchError } = await supabase
          .from('message_templates')
          .select('*')
          .order('created_at', { ascending: false });

        if (fetchError) throw fetchError;
        setTemplates(data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load templates');
      } finally {
        setLoading(false);
      }
    }

    fetchTemplates();
  }, []);

  const categories = useMemo(() => {
    const set = new Set(templates.map((t) => t.category).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    return templates.filter((tpl) => {
      const matchesSearch =
        tpl.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tpl.body_text.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        selectedCategory === 'all' ||
        tpl.category?.toLowerCase() === selectedCategory.toLowerCase();
      return matchesSearch && matchesCategory;
    });
  }, [templates, searchQuery, selectedCategory]);

  if (loading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p className="text-xs text-muted-foreground">Loading verified WhatsApp templates…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center">
        <p className="text-sm font-medium text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground sm:text-lg">
            Choose a WhatsApp Template
          </h2>
          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {templates.length} Available
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Select an approved Meta message template to base your broadcast campaign on.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates by name or text…"
            className="pl-9 h-9 text-xs bg-background border-border/80"
          />
        </div>

        {/* Category Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((cat) => {
            const isCatActive = selectedCategory.toLowerCase() === cat.toLowerCase();
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${
                  isCatActive
                    ? 'bg-primary text-primary-foreground shadow-2xs font-semibold'
                    : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {cat === 'all' ? 'All' : cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Template Grid or Empty State */}
      {templates.length === 0 ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-border p-8 text-center bg-card/40">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
            <FileText className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">No message templates found</h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            You need at least one approved WhatsApp message template to launch a broadcast.
          </p>
          <Link href="/templates" className="mt-4">
            <Button size="sm" className="gap-2 text-xs">
              <PlusCircle className="h-3.5 w-3.5" />
              Create Template in Settings
            </Button>
          </Link>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-border/70 p-8 text-center bg-card/40">
          <Search className="h-7 w-7 text-muted-foreground mb-2" />
          <h4 className="text-xs font-semibold text-foreground">No matching templates</h4>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Try adjusting your search query or filter options.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('all');
            }}
            className="mt-3 text-xs text-primary"
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((tpl) => {
            const isSelected = selectedTemplate?.id === tpl.id;
            const categoryStyle =
              categoryColors[tpl.category] ?? categoryColors.Utility;

            return (
              <div
                key={tpl.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(tpl)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(tpl)}
                className={`group relative flex flex-col justify-between rounded-xl border p-4 text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary/40'
                    : 'border-border/70 bg-card/60 hover:border-border hover:bg-accent/40'
                }`}
              >
                {/* Selection Check Circle */}
                <div className="absolute right-3.5 top-3.5">
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-full transition-all ${
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-2xs'
                        : 'border border-border/80 bg-background/80 group-hover:border-primary/40'
                    }`}
                  >
                    {isSelected && <CheckCircle2 className="h-3.5 w-3.5" />}
                  </div>
                </div>

                {/* Card Header */}
                <div className="space-y-2.5 pr-6">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${categoryStyle.bg} ${categoryStyle.text} ${categoryStyle.border}`}
                    >
                      {tpl.category || 'Standard'}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      <Globe className="h-2.5 w-2.5" />
                      {tpl.language ?? 'en_US'}
                    </span>
                  </div>

                  <h3 className="text-xs font-bold text-foreground leading-snug">
                    {tpl.name}
                  </h3>
                </div>

                {/* WhatsApp Message Preview Bubble */}
                <div className="my-3 rounded-lg border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  <p className="line-clamp-3 font-normal italic">
                    &ldquo;{tpl.body_text}&rdquo;
                  </p>
                </div>

                {/* Card Footer */}
                <div className="flex items-center justify-between pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
                  <span className="capitalize">{tpl.header_type ? `${tpl.header_type} Header` : 'Text only'}</span>
                  {tpl.buttons && Array.isArray(tpl.buttons) && tpl.buttons.length > 0 && (
                    <span className="font-medium text-primary">
                      {tpl.buttons.length} button{tpl.buttons.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Step Actions */}
      <div className="flex items-center justify-between border-t border-border/70 pt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={onBack}
          className="text-xs"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={onNext}
          disabled={!selectedTemplate}
          className="gap-2 text-xs shadow-xs"
        >
          <span>Continue to Audience</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
