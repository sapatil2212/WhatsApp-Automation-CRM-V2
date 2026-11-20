'use client';

import { motion } from 'framer-motion';
import {
  Trash2, Link2, Phone, MessageSquareReply, Clock, CheckCircle2, XCircle, AlertCircle,
  Copy, PencilLine, KeyRound, Image as ImageIcon, Video, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { MessageTemplate } from '@/types';

export interface TemplateMetaDetail {
  meta_id?: string;
  meta_status?: string;
  rejected_reason?: string | null;
  quality?: string | null;
}

const categoryColors: Record<string, string> = {
  Marketing: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  Utility: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20',
  Authentication: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
};

const statusConfig: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  Draft: { color: 'bg-slate-500/10 text-muted-foreground dark:text-slate-400 border-slate-500/20', icon: AlertCircle, label: 'Draft' },
  Pending: { color: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20', icon: Clock, label: 'In review' },
  Approved: { color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20', icon: CheckCircle2, label: 'Approved' },
  Rejected: { color: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20', icon: XCircle, label: 'Rejected' },
};

const REASON_TEXT: Record<string, string> = {
  INVALID_FORMAT: 'Invalid format — check variables, samples and button formats.',
  ABUSIVE_CONTENT: 'Content was flagged as abusive or against policy.',
  INCORRECT_CATEGORY: 'Category does not match the content.',
  PROMOTIONAL: 'Promotional content is not allowed in this category.',
  TAG_CONTENT_MISMATCH: 'Content does not match the selected category.',
  SCAM: 'Flagged as a potential scam.',
};

const QUALITY: Record<string, { label: string; cls: string }> = {
  GREEN: { label: 'High quality', cls: 'text-emerald-600 dark:text-emerald-400' },
  YELLOW: { label: 'Medium quality', cls: 'text-amber-600 dark:text-amber-400' },
  RED: { label: 'Low quality', cls: 'text-red-600 dark:text-red-400' },
};

interface TemplateCardProps {
  template: MessageTemplate;
  detail?: TemplateMetaDetail;
  onDelete: (template: MessageTemplate) => void;
  onEdit?: (template: MessageTemplate) => void;
  onDuplicate?: (template: MessageTemplate) => void;
}

export function TemplateCard({ template, detail, onDelete, onEdit, onDuplicate }: TemplateCardProps) {
  const status = template.status || 'Draft';
  const statusCfg = statusConfig[status] ?? statusConfig.Draft;
  const StatusIcon = statusCfg.icon;
  const buttons = Array.isArray(template.buttons) ? (template.buttons as Array<Record<string, unknown>>) : [];
  const reason = detail?.rejected_reason ? REASON_TEXT[detail.rejected_reason] ?? detail.rejected_reason.replace(/_/g, ' ').toLowerCase() : null;
  const quality = detail?.quality ? QUALITY[detail.quality] : undefined;
  const HeaderIcon = template.header_type === 'image' ? ImageIcon : template.header_type === 'video' ? Video : template.header_type === 'document' ? FileText : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      className="group relative flex flex-col rounded-xl border border-slate-200/70 bg-white p-4 transition-all hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-slate-700"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[13px] font-semibold text-slate-800 dark:text-slate-100" title={template.name}>
            {template.name}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {template.language}
            {quality && <span className={`ml-2 normal-case tracking-normal ${quality.cls}`}>● {quality.label}</span>}
          </p>
        </div>
        <Badge className={`flex shrink-0 items-center gap-1 border px-1.5 py-0 text-[10px] font-semibold ${statusCfg.color}`}>
          <StatusIcon className={`size-2.5 ${status === 'Pending' ? 'animate-pulse' : ''}`} />
          {statusCfg.label}
        </Badge>
      </div>

      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <Badge className={`border px-1.5 py-0 text-[10px] font-medium ${categoryColors[template.category] || ''}`}>
          {template.category === 'Authentication' && <KeyRound className="mr-0.5 size-2.5" />}
          {template.category}
        </Badge>
        {HeaderIcon && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <HeaderIcon className="size-3" /> {template.header_type} header
          </span>
        )}
      </div>

      {template.header_content && (
        <p className="truncate text-[11px] font-semibold text-muted-foreground dark:text-slate-300">{template.header_content}</p>
      )}
      <p className="line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-muted-foreground dark:text-slate-400">
        {template.body_text || 'No body text'}
      </p>

      {buttons.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {buttons.slice(0, 3).map((b, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-muted-foreground dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
            >
              {b.type === 'URL' ? <Link2 className="size-2.5" /> : b.type === 'PHONE_NUMBER' ? <Phone className="size-2.5" /> : b.type === 'OTP' ? <Copy className="size-2.5" /> : <MessageSquareReply className="size-2.5" />}
              {String(b.text ?? '')}
            </span>
          ))}
          {buttons.length > 3 && <span className="text-[10px] text-muted-foreground">+{buttons.length - 3} more</span>}
        </div>
      )}

      {status === 'Rejected' && (
        <div className="mt-3 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-1.5">
          <p className="text-[11px] font-semibold text-red-700 dark:text-red-400">Rejected by Meta</p>
          <p className="mt-0.5 text-[10px] leading-snug text-red-600/90 dark:text-red-400/80">
            {reason ?? 'Sync from Meta to load the reason, then edit and resubmit.'}
          </p>
        </div>
      )}
      {status === 'Pending' && (
        <p className="mt-3 text-[10px] text-amber-700 dark:text-amber-400">
          Meta is reviewing this template — usually minutes, up to 24 hours. Status updates automatically.
        </p>
      )}

      <div className="mt-auto flex items-center gap-1 pt-3">
        {onEdit && (status === 'Rejected' || status === 'Draft') && (
          <Button size="sm" onClick={() => onEdit(template)} className="h-7 gap-1 bg-emerald-600 px-2.5 text-[11px] text-white hover:bg-emerald-700">
            <PencilLine className="size-3" /> Edit & resubmit
          </Button>
        )}
        {onDuplicate && (
          <Button size="sm" variant="ghost" onClick={() => onDuplicate(template)} className="h-7 gap-1 px-2 text-[11px] text-muted-foreground">
            <Copy className="size-3" /> Duplicate
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Delete ${template.name}`}
          onClick={() => onDelete(template)}
          className="ml-auto size-7 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </motion.div>
  );
}
