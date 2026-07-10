'use client';

import { motion } from 'framer-motion';
import { Trash2, Link2, Phone, MessageSquareReply, Clock, CheckCircle2, XCircle, AlertCircle, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { MessageTemplate } from '@/types';

const categoryColors: Record<string, string> = {
  Marketing: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  Utility: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  Authentication: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

const statusConfig: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  Draft: { color: 'bg-slate-500/10 text-slate-400 border-slate-500/20', icon: AlertCircle, label: 'Draft' },
  Pending: { color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', icon: Clock, label: 'Pending Review' },
  Approved: { color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: CheckCircle2, label: 'Approved' },
  Rejected: { color: 'bg-red-500/10 text-red-400 border-red-500/20', icon: XCircle, label: 'Rejected' },
};

interface TemplateCardProps {
  template: MessageTemplate;
  onDelete: (id: string) => void;
  onSelect?: (template: MessageTemplate) => void;
  isSelected?: boolean;
}

export function TemplateCard({ template, onDelete, onSelect, isSelected }: TemplateCardProps) {
  const status = template.status || 'Draft';
  const statusCfg = statusConfig[status] ?? statusConfig.Draft;
  const StatusIcon = statusCfg.icon;
  const buttons = Array.isArray(template.buttons)
    ? (template.buttons as Array<Record<string, unknown>>)
    : [];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      onClick={() => onSelect?.(template)}
      className={[
        'group relative cursor-pointer rounded-xl border p-4 transition-all duration-200',
        isSelected
          ? 'border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/20'
          : 'border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-600',
      ].join(' ')}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            {template.name}
          </p>
          {template.language && (
            <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">
              {template.language}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(template.id);
          }}
          className="size-7 shrink-0 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-opacity"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
        <Badge className={`text-[10px] font-medium border px-1.5 py-0 ${categoryColors[template.category] || ''}`}>
          {template.category}
        </Badge>
        <Badge className={`text-[10px] font-medium border px-1.5 py-0 flex items-center gap-1 ${statusCfg.color}`}>
          <StatusIcon className="size-2.5" />
          {statusCfg.label}
        </Badge>
      </div>

      {/* Body preview */}
      <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        {template.body_text || 'No body text'}
      </p>

      {/* Buttons preview */}
      {buttons.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2.5">
          {buttons.slice(0, 3).map((b, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-300"
            >
              {b.type === 'URL' ? (
                <Link2 className="size-2.5" />
              ) : b.type === 'PHONE_NUMBER' ? (
                <Phone className="size-2.5" />
              ) : (
                <MessageSquareReply className="size-2.5" />
              )}
              {String(b.text ?? '')}
            </span>
          ))}
          {buttons.length > 3 && (
            <span className="text-[10px] text-slate-400">+{buttons.length - 3} more</span>
          )}
        </div>
      )}

      {/* Pending/Rejected hint */}
      {status === 'Pending' && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-md bg-yellow-500/5 border border-yellow-500/20 px-2 py-1">
          <Send className="size-3 text-yellow-400" />
          <p className="text-[10px] text-yellow-400">Submitted to Meta — awaiting review</p>
        </div>
      )}
      {status === 'Rejected' && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-md bg-red-500/5 border border-red-500/20 px-2 py-1">
          <XCircle className="size-3 text-red-400" />
          <p className="text-[10px] text-red-400">Rejected by Meta — edit and resubmit</p>
        </div>
      )}
      {status === 'Approved' && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-md bg-emerald-500/5 border border-emerald-500/20 px-2 py-1">
          <CheckCircle2 className="size-3 text-emerald-400" />
          <p className="text-[10px] text-emerald-400">Ready to send in broadcasts</p>
        </div>
      )}
    </motion.div>
  );
}
