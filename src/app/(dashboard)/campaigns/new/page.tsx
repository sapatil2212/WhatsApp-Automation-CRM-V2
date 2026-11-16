'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { MessageTemplate } from '@/types';
import { Step1ChooseTemplate } from '@/components/broadcasts/step1-choose-template';
import { Step2SelectAudience } from '@/components/broadcasts/step2-select-audience';
import { Step3Personalize } from '@/components/broadcasts/step3-personalize';
import { Step4ScheduleSend } from '@/components/broadcasts/step4-schedule-send';
import { useBroadcastSending } from '@/hooks/use-broadcast-sending';
import { Check, ArrowLeft, FileText, Users, Sparkles, Send, Megaphone } from 'lucide-react';

const steps = [
  { label: 'Template', key: 'template', icon: FileText, desc: 'Approved WhatsApp template' },
  { label: 'Audience', key: 'audience', icon: Users, desc: 'Target contacts & filters' },
  { label: 'Personalize', key: 'personalize', icon: Sparkles, desc: 'Dynamic variable mappings' },
  { label: 'Review & Send', key: 'send', icon: Send, desc: 'Summary & launch' },
] as const;

export default function NewCampaignPage() {
  const router = useRouter();
  const { createAndSendBroadcast, isProcessing, progress } = useBroadcastSending();

  const [currentStep, setCurrentStep] = useState(0);
  const [template, setTemplate] = useState<MessageTemplate | null>(null);
  const [audience, setAudience] = useState<{
    type: 'all' | 'tags' | 'custom_field' | 'csv';
    tagIds?: string[];
    customField?: {
      fieldId: string;
      operator: 'is' | 'is_not' | 'contains';
      value: string;
    };
    csvContacts?: { phone: string; name?: string }[];
    excludeTagIds?: string[];
  }>({ type: 'all' });
  const [variables, setVariables] = useState<
    Record<string, { type: 'static' | 'field' | 'custom_field'; value: string }>
  >({});
  const [name, setName] = useState('');

  async function handleSend() {
    if (!template) return;

    try {
      const broadcastId = await createAndSendBroadcast({
        name,
        template,
        audience: {
          type: audience.type,
          tagIds: audience.tagIds,
          customField: audience.customField,
          csvContacts: audience.csvContacts,
          excludeTagIds: audience.excludeTagIds,
        },
        variables,
      });
      router.push(`/campaigns/${broadcastId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Campaign failed';
      console.error('Campaign failed:', err);
      toast.error(message);
    }
  }

  async function handleSaveDraft() {
    if (!template || !name.trim()) {
      toast.error('Give the campaign a name before saving a draft.');
      return;
    }
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      toast.error('Not signed in.');
      return;
    }

    const { error } = await supabase.from('broadcasts').insert({
      user_id: user.id,
      name: name.trim(),
      template_name: template.name,
      template_language: template.language ?? 'en_US',
      template_variables: variables,
      audience_filter: {
        type: audience.type,
        tagIds: audience.tagIds,
      },
      status: 'draft',
      total_recipients: 0,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      replied_count: 0,
      failed_count: 0,
    });

    if (error) {
      toast.error(`Failed to save draft: ${error.message}`);
      return;
    }
    toast.success('Draft saved');
    router.push('/campaigns');
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Campaigns
          </Link>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Create Broadcast Campaign
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              Meta Approved
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Launch high-converting personalized WhatsApp broadcasts with verified templates.
          </p>
        </div>

        {/* Step indicator badge */}
        <div className="flex items-center gap-2 self-start rounded-xl border border-border/80 bg-card/60 px-3 py-1.5 shadow-2xs backdrop-blur-xs sm:self-auto">
          <Megaphone className="h-4 w-4 text-primary" />
          <div className="text-right">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Progress
            </span>
            <span className="text-xs font-bold text-foreground">
              Step {currentStep + 1} of {steps.length}
            </span>
          </div>
        </div>
      </div>

      {/* Modern Stepper Navigation */}
      <div className="rounded-2xl border border-border/70 bg-card/60 p-3 shadow-xs backdrop-blur-xs sm:p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          {steps.map((step, index) => {
            const isActive = index === currentStep;
            const isCompleted = index < currentStep;
            const canNavigate = index <= currentStep || (index === 1 && !!template);
            const Icon = step.icon;

            return (
              <button
                key={step.key}
                type="button"
                disabled={!canNavigate}
                onClick={() => canNavigate && setCurrentStep(index)}
                className={`group flex items-center gap-3 rounded-xl border p-2.5 text-left transition-all sm:p-3 ${
                  isActive
                    ? 'border-primary/50 bg-primary/10 shadow-xs ring-1 ring-primary/30'
                    : isCompleted
                      ? 'border-border/80 bg-accent/40 hover:border-border hover:bg-accent/70 cursor-pointer'
                      : 'border-transparent bg-transparent opacity-50 cursor-not-allowed'
                }`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold transition-all ${
                    isCompleted
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : isActive
                        ? 'bg-primary/20 text-primary border border-primary/40'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      0{index + 1}
                    </span>
                    {isCompleted && (
                      <span className="text-[9px] font-medium text-primary">Done</span>
                    )}
                  </div>
                  <p
                    className={`truncate text-xs font-semibold ${
                      isActive
                        ? 'text-foreground font-bold'
                        : isCompleted
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {step.label}
                  </p>
                  <p className="hidden truncate text-[10px] text-muted-foreground lg:block">
                    {step.desc}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Card Container */}
      <div className="rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-xs sm:p-7">
        <div
          className="transition-all duration-300 ease-in-out"
          style={{
            opacity: isProcessing ? 0.6 : 1,
            pointerEvents: isProcessing ? 'none' : 'auto',
          }}
        >
          {currentStep === 0 && (
            <Step1ChooseTemplate
              selectedTemplate={template}
              onSelect={setTemplate}
              onNext={() => setCurrentStep(1)}
              onBack={() => router.push('/campaigns')}
            />
          )}
          {currentStep === 1 && (
            <Step2SelectAudience
              audience={audience}
              onUpdate={setAudience}
              onNext={() => setCurrentStep(2)}
              onBack={() => setCurrentStep(0)}
            />
          )}
          {currentStep === 2 && template && (
            <Step3Personalize
              template={template}
              variables={variables}
              onUpdate={setVariables}
              onNext={() => setCurrentStep(3)}
              onBack={() => setCurrentStep(1)}
            />
          )}
          {currentStep === 3 && template && (
            <Step4ScheduleSend
              name={name}
              onNameChange={setName}
              template={template}
              audience={audience}
              onSend={handleSend}
              onSaveDraft={handleSaveDraft}
              onBack={() => setCurrentStep(2)}
              isProcessing={isProcessing}
              progress={progress}
            />
          )}
        </div>
      </div>
    </div>
  );
}
