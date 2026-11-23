'use client';

import { CheckCircle2, Plus, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AiTestChat } from '@/components/setup/ai-test-chat';

const SECTIONS: Array<{ label: string; text: string }> = [
  { label: 'About the clinic', text: '### ABOUT US:\n- Established in 20XX, specialised in …\n- Facilities: …' },
  { label: 'Booking policy', text: '### BOOKING & CANCELLATION:\n- Book at least 2 hours in advance.\n- Free cancellation up to 4 hours before the slot.' },
  { label: 'Payments & insurance', text: '### PAYMENTS & INSURANCE:\n- We accept cash, cards and UPI.\n- Cashless insurance with: …' },
  { label: 'Directions & parking', text: '### DIRECTIONS & PARKING:\n- Landmark: …\n- Free parking available.' },
  { label: 'Emergency', text: '### EMERGENCY:\n- For chest pain, severe bleeding or breathing difficulty, go to the nearest emergency room or call 108.' },
];

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

interface Props {
  value: string;
  saved: string;
  onChange: (v: string) => void;
}

/**
 * Business Setup → AI Training. Free-form knowledge the WhatsApp AI treats
 * as fact, next to a live test chat. Saved by the wizard's Save button.
 */
export function AiTrainingStep({ value, saved, onChange }: Props) {
  const dirty = value.trim() !== saved.trim();
  const insert = (text: string) => onChange(value.trim() ? `${value.trimEnd()}\n\n${text}` : text);

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Add a section:</span>
          {SECTIONS.map((s) => (
            <Button key={s.label} type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => insert(s.text)}>
              <Plus className="size-3" /> {s.label}
            </Button>
          ))}
        </div>
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={18}
          className="min-h-[360px] bg-background font-mono text-[12px] leading-relaxed"
          placeholder={'Write what a good receptionist knows: specialities, facilities, policies, payment and insurance, directions, offers, common patient concerns…\n\nTip: use "Upload document" or "Type details" at the top to fill this and the other steps automatically.'}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{words(value).toLocaleString()} words · {value.length.toLocaleString()} characters</span>
          {dirty ? (
            <span className="flex items-center gap-2">
              <span className="font-medium text-amber-600 dark:text-amber-400">Unsaved. The AI still uses the saved version.</span>
              <button type="button" onClick={() => onChange(saved)} className="inline-flex items-center gap-1 hover:text-foreground"><RotateCcw className="size-3" /> Undo</button>
            </span>
          ) : value.trim() ? (
            <span className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-3.5" /> Saved and in use</span>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Doctors, hours, services and FAQs from the other steps are already given to the AI. Use this space for everything else.
        </p>
      </div>
      <AiTestChat knowledgeText={value} unsaved={dirty} className="xl:sticky xl:top-4" />
    </div>
  );
}
