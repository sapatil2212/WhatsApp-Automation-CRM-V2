/**
 * Professional pipeline templates — proven stage sequences for common
 * WhatsApp-led businesses. Colours progress cool → warm → green so the board
 * reads left-to-right at a glance.
 */

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  emoji: string;
  stages: Array<{ name: string; color: string; hint: string }>;
}

const C = {
  slate: '#64748b',
  blue: '#3b82f6',
  sky: '#0ea5e9',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  amber: '#f59e0b',
  orange: '#f97316',
  green: '#22c55e',
  red: '#ef4444',
};

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    id: 'b2b-sales',
    name: 'B2B Sales',
    emoji: '💼',
    description: 'Classic consultative sales: qualify, demo, propose, negotiate, close.',
    stages: [
      { name: 'New Lead', color: C.slate, hint: 'Inbound or sourced, not yet contacted' },
      { name: 'Contacted', color: C.blue, hint: 'First conversation started' },
      { name: 'Qualified', color: C.indigo, hint: 'Budget, need and timeline confirmed' },
      { name: 'Demo / Meeting', color: C.violet, hint: 'Product shown to decision makers' },
      { name: 'Proposal Sent', color: C.amber, hint: 'Quote or proposal shared' },
      { name: 'Negotiation', color: C.orange, hint: 'Terms and pricing in discussion' },
      { name: 'Won', color: C.green, hint: 'Signed and paid' },
    ],
  },
  {
    id: 'whatsapp-leads',
    name: 'WhatsApp Lead Qualification',
    emoji: '💬',
    description: 'For Click-to-WhatsApp ads and inbound chats: respond fast, qualify, convert.',
    stages: [
      { name: 'New Enquiry', color: C.slate, hint: 'Came in from an ad or chat' },
      { name: 'Engaged', color: C.sky, hint: 'Replied to our first message' },
      { name: 'Qualified', color: C.indigo, hint: 'Interested and a good fit' },
      { name: 'Offer Shared', color: C.amber, hint: 'Pricing / offer sent on WhatsApp' },
      { name: 'Follow-up', color: C.orange, hint: 'Awaiting decision' },
      { name: 'Converted', color: C.green, hint: 'Purchased or booked' },
    ],
  },
  {
    id: 'real-estate',
    name: 'Real Estate',
    emoji: '🏠',
    description: 'Property enquiries through site visits to booking and agreement.',
    stages: [
      { name: 'Enquiry', color: C.slate, hint: 'Asked about a project' },
      { name: 'Requirement Captured', color: C.blue, hint: 'Budget, location, BHK noted' },
      { name: 'Site Visit Scheduled', color: C.indigo, hint: 'Visit date fixed' },
      { name: 'Site Visit Done', color: C.violet, hint: 'Visited the property' },
      { name: 'Negotiation', color: C.orange, hint: 'Discussing price and plan' },
      { name: 'Booking Done', color: C.green, hint: 'Token amount received' },
    ],
  },
  {
    id: 'education',
    name: 'Admissions',
    emoji: '🎓',
    description: 'Course and school admissions from enquiry to enrolment.',
    stages: [
      { name: 'Enquiry', color: C.slate, hint: 'Asked about a course' },
      { name: 'Counselling', color: C.blue, hint: 'Counselling call done' },
      { name: 'Application', color: C.indigo, hint: 'Form submitted' },
      { name: 'Documents Verified', color: C.violet, hint: 'Eligibility checked' },
      { name: 'Fee Pending', color: C.amber, hint: 'Offer made, awaiting fee' },
      { name: 'Enrolled', color: C.green, hint: 'Fee paid' },
    ],
  },
  {
    id: 'clinic',
    name: 'Patient Journey',
    emoji: '🩺',
    description: 'Clinics and wellness: enquiry, consultation, treatment and follow-up.',
    stages: [
      { name: 'Enquiry', color: C.slate, hint: 'Asked about a treatment' },
      { name: 'Appointment Booked', color: C.sky, hint: 'Consultation scheduled' },
      { name: 'Consulted', color: C.indigo, hint: 'Seen by the doctor' },
      { name: 'Treatment Plan Shared', color: C.amber, hint: 'Plan and cost shared' },
      { name: 'In Treatment', color: C.violet, hint: 'Treatment ongoing' },
      { name: 'Completed', color: C.green, hint: 'Treatment finished' },
    ],
  },
  {
    id: 'ecommerce',
    name: 'E-commerce Orders',
    emoji: '🛍️',
    description: 'WhatsApp commerce: cart to delivery, with abandoned-cart recovery.',
    stages: [
      { name: 'Interested', color: C.slate, hint: 'Browsing or asked about a product' },
      { name: 'Cart / Quote', color: C.blue, hint: 'Items chosen' },
      { name: 'Payment Pending', color: C.amber, hint: 'Payment link sent' },
      { name: 'Paid', color: C.indigo, hint: 'Payment received' },
      { name: 'Shipped', color: C.violet, hint: 'Out for delivery' },
      { name: 'Delivered', color: C.green, hint: 'Order completed' },
    ],
  },
  {
    id: 'agency',
    name: 'Agency / Services',
    emoji: '🧩',
    description: 'Service businesses and agencies from brief to retainer.',
    stages: [
      { name: 'Lead', color: C.slate, hint: 'New prospect' },
      { name: 'Discovery Call', color: C.blue, hint: 'Requirements understood' },
      { name: 'Proposal', color: C.amber, hint: 'Scope and price sent' },
      { name: 'Contract', color: C.orange, hint: 'Agreement in signing' },
      { name: 'Active Project', color: C.violet, hint: 'Work in progress' },
      { name: 'Closed Won', color: C.green, hint: 'Delivered and paid' },
    ],
  },
  {
    id: 'recruitment',
    name: 'Recruitment',
    emoji: '🧑‍💼',
    description: 'Hiring pipeline for candidates sourced on WhatsApp.',
    stages: [
      { name: 'Applied', color: C.slate, hint: 'Application received' },
      { name: 'Screening', color: C.blue, hint: 'Initial call' },
      { name: 'Interview', color: C.indigo, hint: 'Interview rounds' },
      { name: 'Offer', color: C.amber, hint: 'Offer extended' },
      { name: 'Hired', color: C.green, hint: 'Offer accepted' },
    ],
  },
];
