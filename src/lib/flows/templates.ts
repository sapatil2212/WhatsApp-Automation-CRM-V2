/**
 * Starter flow templates.
 *
 * Three pre-canned flows users can clone with one click instead of
 * building from scratch. Each template is a plain JS object describing
 * the same shape `/api/flows` PUT accepts — name, trigger config,
 * entry_node_id, fallback_policy, nodes[] — keyed by a stable
 * `slug`.
 *
 * The clone path (`/api/flows` POST with `template_slug`) creates a
 * NEW flow_row + flow_nodes rows for the user. `node_key`s are kept
 * verbatim (they're stable strings, not UUIDs, so cloning never
 * needs to rewrite edge references).
 *
 * Choosing a single static module over a DB-backed gallery for v1
 * because: (a) the set is small and changes with code releases, not
 * data; (b) keeps templates portable across self-hosted instances
 * without migrations; (c) editing in source is the lowest-friction
 * way to add the next template.
 */

import type {
  CollectInputNodeConfig,
  ConditionNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
  SendListNodeConfig,
  SendMessageNodeConfig,
  StartNodeConfig,
} from "./types";

export type FlowTemplateNodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "handoff"
  | "end";

export interface FlowTemplateNode {
  node_key: string;
  node_type: FlowTemplateNodeType;
  config:
    | StartNodeConfig
    | SendMessageNodeConfig
    | SendButtonsNodeConfig
    | SendListNodeConfig
    | CollectInputNodeConfig
    | ConditionNodeConfig
    | HandoffNodeConfig
    | Record<string, unknown>;
}

/** lucide-react icon names the gallery knows how to render. */
export type FlowTemplateIcon =
  | "MessageSquare"
  | "HelpCircle"
  | "UserPlus"
  | "CalendarClock"
  | "FileText"
  | "BedDouble"
  | "GraduationCap";

export interface FlowTemplate {
  slug: string;
  name: string;
  description: string;
  /** Used by the gallery to surface a relevant icon. lucide-react name. */
  icon: FlowTemplateIcon;
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
  /**
   * Business segments this template is tailored for (see
   * `getBusinessSegment`). When omitted, the template is generic and
   * shown to every business. When set, the flows gallery marks it as
   * "recommended" for matching businesses and surfaces it first.
   */
  segments?: string[];
}

// ============================================================
// 1. Welcome menu — the example from the owner's brief
// ============================================================
const WELCOME_MENU: FlowTemplate = {
  slug: "welcome_menu",
  name: "Welcome menu",
  description:
    "Greet customers who type a keyword and route them to the right agent based on whether they're new or existing.",
  icon: "MessageSquare",
  trigger_type: "keyword",
  trigger_config: { keywords: ["support", "help", "hi"], match_type: "contains" },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "welcome" },
    },
    {
      node_key: "welcome",
      node_type: "send_buttons",
      config: {
        text: "Hi! 👋 Welcome to support. Are you an existing customer or new here?",
        footer_text: "Tap a button below to continue.",
        buttons: [
          {
            reply_id: "existing",
            title: "Existing customer",
            next_node_key: "existing_handoff",
          },
          {
            reply_id: "new",
            title: "New customer",
            next_node_key: "new_handoff",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "existing_handoff",
      node_type: "handoff",
      config: {
        note: "Existing customer needs assistance — please check account history before replying.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "new_handoff",
      node_type: "handoff",
      config: {
        note: "New customer — share pricing + onboarding link.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 2. FAQ bot — list-message answers, fully automated
// ============================================================
const FAQ_BOT: FlowTemplate = {
  slug: "faq_bot",
  name: "FAQ bot",
  description:
    "Answer common questions automatically. Customer picks a topic from a list; the bot replies with the answer and ends.",
  icon: "HelpCircle",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["faq", "question", "info"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "topics" },
    },
    {
      node_key: "topics",
      node_type: "send_list",
      config: {
        text: "What can I help you with?",
        button_label: "View topics",
        sections: [
          {
            title: "Common questions",
            rows: [
              {
                reply_id: "hours",
                title: "Opening hours",
                next_node_key: "answer_hours",
              },
              {
                reply_id: "pricing",
                title: "Pricing",
                next_node_key: "answer_pricing",
              },
              {
                reply_id: "refunds",
                title: "Refund policy",
                next_node_key: "answer_refunds",
              },
            ],
          },
          {
            title: "Other",
            rows: [
              {
                reply_id: "human",
                title: "Talk to a human",
                next_node_key: "human_handoff",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "answer_hours",
      node_type: "send_message",
      config: {
        text: "We're open Mon–Fri, 9am–6pm local time. Weekend support is limited to urgent issues.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_pricing",
      node_type: "send_message",
      config: {
        text: "Our pricing starts at $9/mo. Visit https://example.com/pricing for the full breakdown.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_refunds",
      node_type: "send_message",
      config: {
        text: "Refunds are honored within 30 days of purchase. Reply with your order number and we'll process it.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "human_handoff",
      node_type: "handoff",
      config: {
        note: "Customer asked to talk to a human from the FAQ bot.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
    },
  ],
};

// ============================================================
// 3. Lead capture — collect_input chain, ends in a handoff
// ============================================================
const LEAD_CAPTURE: FlowTemplate = {
  slug: "lead_capture",
  name: "Lead capture",
  description:
    "Greet first-time inbounds, capture name + email + company, then hand off to sales with the answers in the note.",
  icon: "UserPlus",
  trigger_type: "first_inbound_message",
  trigger_config: {},
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "intro" },
    },
    {
      node_key: "intro",
      node_type: "send_message",
      config: {
        text: "Welcome! 👋 I'll ask a few quick questions so we can get you to the right person.",
        next_node_key: "ask_name",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: "What's your name?",
        var_key: "name",
        next_node_key: "ask_email",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_email",
      node_type: "collect_input",
      config: {
        prompt_text: "Thanks {{vars.name}}! What's your work email?",
        var_key: "email",
        next_node_key: "ask_company",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_company",
      node_type: "collect_input",
      config: {
        prompt_text: "Almost done — what's your company name?",
        var_key: "company",
        next_node_key: "handoff",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "New lead — name={{vars.name}}, email={{vars.email}}, company={{vars.company}}.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 4. Appointment booking — service businesses that take bookings
// ============================================================
const APPOINTMENT_BOOKING: FlowTemplate = {
  slug: "appointment_booking",
  name: "Appointment booking",
  description:
    "Let customers request an appointment on WhatsApp — capture their name, the service they want, and a preferred time, then hand off to your team to confirm.",
  icon: "CalendarClock",
  segments: ["beauty", "wellness", "healthcare", "automotive", "pet", "professional"],
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["book", "appointment", "booking", "slot", "schedule"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "intro" } },
    {
      node_key: "intro",
      node_type: "send_message",
      config: {
        text: "Hi! 👋 I can help you book an appointment. Just a few quick details.",
        next_node_key: "ask_name",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: "What's your full name?",
        var_key: "name",
        next_node_key: "ask_service",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_service",
      node_type: "collect_input",
      config: {
        prompt_text: "Thanks {{vars.name}}! Which service would you like to book?",
        var_key: "service",
        next_node_key: "ask_time",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_time",
      node_type: "collect_input",
      config: {
        prompt_text: "What day and time works best for you?",
        var_key: "preferred_time",
        next_node_key: "handoff",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "Booking request — name={{vars.name}}, service={{vars.service}}, preferred={{vars.preferred_time}}. Please confirm availability.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 5. Quote request — trades / professional / automotive
// ============================================================
const QUOTE_REQUEST: FlowTemplate = {
  slug: "quote_request",
  name: "Quote request",
  description:
    "Capture the details of a job — what the customer needs, where, and when — then hand off so you can send an accurate quote.",
  icon: "FileText",
  segments: ["trades", "professional", "automotive"],
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["quote", "estimate", "price", "cost", "enquiry", "inquiry"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "intro" } },
    {
      node_key: "intro",
      node_type: "send_message",
      config: {
        text: "Happy to prepare a quote for you. 📋 A few quick questions first.",
        next_node_key: "ask_job",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "ask_job",
      node_type: "collect_input",
      config: {
        prompt_text: "What work do you need done? Please describe it briefly.",
        var_key: "job",
        next_node_key: "ask_location",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_location",
      node_type: "collect_input",
      config: {
        prompt_text: "Where is the job located (area / pincode)?",
        var_key: "location",
        next_node_key: "ask_timing",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_timing",
      node_type: "collect_input",
      config: {
        prompt_text: "When would you like this done?",
        var_key: "timing",
        next_node_key: "handoff",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "Quote request — job={{vars.job}}, location={{vars.location}}, timing={{vars.timing}}. Prepare and send an estimate.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 6. Room reservation — hospitality
// ============================================================
const ROOM_RESERVATION: FlowTemplate = {
  slug: "room_reservation",
  name: "Room reservation",
  description:
    "Take reservation enquiries — check-in / check-out dates, number of guests, and room type — then hand off to confirm availability.",
  icon: "BedDouble",
  segments: ["hospitality"],
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["book", "room", "reservation", "stay", "availability"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "intro" } },
    {
      node_key: "intro",
      node_type: "send_message",
      config: {
        text: "Welcome! 🏨 I can help with your reservation. A few quick details, please.",
        next_node_key: "ask_dates",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "ask_dates",
      node_type: "collect_input",
      config: {
        prompt_text: "What are your check-in and check-out dates?",
        var_key: "dates",
        next_node_key: "ask_guests",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_guests",
      node_type: "collect_input",
      config: {
        prompt_text: "How many guests will be staying?",
        var_key: "guests",
        next_node_key: "ask_room",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_room",
      node_type: "collect_input",
      config: {
        prompt_text: "Which room type would you prefer (e.g. Standard, Deluxe, Suite)?",
        var_key: "room_type",
        next_node_key: "handoff",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "Reservation enquiry — dates={{vars.dates}}, guests={{vars.guests}}, room={{vars.room_type}}. Confirm availability and rate.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 7. Course enquiry — education
// ============================================================
const COURSE_ENQUIRY: FlowTemplate = {
  slug: "course_enquiry",
  name: "Course enquiry",
  description:
    "Handle admission and course enquiries — capture the student's name, the course they're interested in, and hand off with the details.",
  icon: "GraduationCap",
  segments: ["education"],
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["course", "admission", "enroll", "class", "fees", "join"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "intro" } },
    {
      node_key: "intro",
      node_type: "send_message",
      config: {
        text: "Hello! 🎓 Happy to help with your course enquiry. Just a couple of details.",
        next_node_key: "ask_name",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: "What's the student's name?",
        var_key: "name",
        next_node_key: "ask_course",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_course",
      node_type: "collect_input",
      config: {
        prompt_text: "Which course or program are you interested in?",
        var_key: "course",
        next_node_key: "handoff",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "Course enquiry — student={{vars.name}}, course={{vars.course}}. Share fees, schedule, and next steps.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// Registry
// ============================================================

const TEMPLATES: Record<string, FlowTemplate> = {
  welcome_menu: WELCOME_MENU,
  faq_bot: FAQ_BOT,
  lead_capture: LEAD_CAPTURE,
  appointment_booking: APPOINTMENT_BOOKING,
  quote_request: QUOTE_REQUEST,
  room_reservation: ROOM_RESERVATION,
  course_enquiry: COURSE_ENQUIRY,
};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}
