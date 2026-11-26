/**
 * ChatNexGen plans: the single source for the marketing site (home + /pricing),
 * signup, Settings and the Subscription page. Ids are what signup stores in
 * `user.selectedPlan`.
 */
export interface BillingPlan {
  id: 'starter' | 'managed' | 'custom';
  name: string;
  /** One-line promise shown under the name. */
  tagline: string;
  /** Longer marketing description. */
  description: string;
  /** Monthly price in paise (charged at signup and renewal); null for quoted plans. */
  pricePaise: number | null;
  /** Display price, e.g. "₹999", or "Custom". */
  price: string;
  /** Text after the price, e.g. "/month". Empty for custom. */
  period: string;
  /** Monthly renewal shown on the Subscription page. */
  renewal: string;
  /** Can be bought directly at signup (custom plans are quoted). */
  selfServe: boolean;
  features: string[];
  popular?: boolean;
  badge?: string;
  cta: string;
  /** Small print under the button on /pricing. */
  footnote: string;
}

export const PLANS: BillingPlan[] = [
  {
    id: 'starter',
    name: 'Self-Managed',
    tagline: 'You manage everything',
    description: 'The full platform for teams who like to set things up themselves. Build your own flows, automations and AI assistant.',
    pricePaise: 99_900,
    price: '₹999',
    period: '/month',
    renewal: '₹999/month',
    selfServe: true,
    features: [
      'Official WhatsApp Business API',
      'Shared team inbox',
      'Visual flow & chatbot builder',
      'AI assistant trained on your documents',
      '27+ native integrations',
      '0% markup on Meta API fees',
    ],
    cta: 'Get started',
    footnote: 'Access within 24 hours of payment. Setup guides included.',
  },
  {
    id: 'managed',
    name: 'Fully Managed',
    tagline: 'We manage everything',
    description: 'Our team sets up and runs WhatsApp for you: verification, templates, automations and the AI assistant, with monthly reviews.',
    pricePaise: 199_900,
    price: '₹1,999',
    period: '/month',
    renewal: '₹1,999/month',
    selfServe: true,
    popular: true,
    badge: 'Recommended',
    features: [
      'Everything in Self-Managed',
      'Meta verification & number setup done for you',
      'Message templates written & approved',
      'Automations and AI assistant configured',
      'Integrations wired in',
      'Dedicated account manager',
      'Monthly strategy call',
    ],
    cta: 'Get started',
    footnote: 'Onboarding starts within 48 hours. Live within 7 days.',
  },
  {
    id: 'custom',
    name: 'Custom',
    tagline: 'Built around your business',
    description: 'For multi-branch businesses, high volumes or special requirements. We scope a plan and price that fits.',
    pricePaise: null,
    price: 'Custom',
    period: '',
    renewal: 'Quoted',
    selfServe: false,
    features: [
      'Everything in Fully Managed',
      'Multiple WhatsApp numbers & branches',
      'Custom integrations & development',
      'Volume pricing',
      'Priority support & SLA',
    ],
    cta: 'Talk to us',
    footnote: 'Tell us what you need and we reply within one working day.',
  },
];

export const SELF_SERVE_PLANS = PLANS.filter((p) => p.selfServe);

/** Billing support contacts (WhatsApp digits only). Payments themselves go through Razorpay. */
export const BILLING_WHATSAPP = '917745868073';
export const BILLING_EMAIL = 'chatnexgen@gmail.com';

/** Plan by id. Also maps ids written by older versions of signup. */
export function planById(id: string | null | undefined): BillingPlan | null {
  if (!id) return null;
  const legacy: Record<string, BillingPlan['id']> = { growth: 'managed', professional: 'managed', enterprise: 'custom' };
  const key = (legacy[id] ?? id) as BillingPlan['id'];
  return PLANS.find((p) => p.id === key) ?? null;
}

/** ₹ amount for paise, e.g. 99900 → "₹999", 49950 → "₹499.50". */
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}
