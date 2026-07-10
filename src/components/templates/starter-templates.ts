export interface StarterTemplate {
  id: string;
  label: string;
  description: string;
  emoji: string;
  category: 'Marketing' | 'Utility' | 'Authentication';
  name: string;
  language: string;
  header_type: 'none' | 'text' | 'image' | 'video' | 'document';
  header_text: string;
  body_text: string;
  footer_text: string;
  buttons: Array<{
    type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
    text: string;
    url?: string;
    phone_number?: string;
    example?: string;
  }>;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'appointment_reminder',
    label: 'Appointment Reminder',
    description: 'Remind customers of upcoming bookings',
    emoji: '📅',
    category: 'Utility',
    name: 'appointment_reminder',
    language: 'en_US',
    header_type: 'text',
    header_text: 'Appointment Reminder',
    body_text:
      'Hi {{1}}, this is a friendly reminder that you have an appointment scheduled on *{{2}}* at *{{3}}*.\n\nPlease arrive 5 minutes early. If you need to reschedule, reply to this message.',
    footer_text: 'We look forward to seeing you.',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Confirm' },
      { type: 'QUICK_REPLY', text: 'Reschedule' },
    ],
  },
  {
    id: 'order_confirmation',
    label: 'Order Confirmation',
    description: 'Confirm orders and provide tracking info',
    emoji: '📦',
    category: 'Utility',
    name: 'order_confirmation',
    language: 'en_US',
    header_type: 'text',
    header_text: 'Order Confirmed! 🎉',
    body_text:
      'Hi {{1}}, your order *#{{2}}* has been confirmed!\n\nOrder Total: *{{3}}*\nEstimated Delivery: *{{4}}*\n\nWe\'ll send you a tracking link once your order ships.',
    footer_text: 'Thank you for your purchase!',
    buttons: [
      { type: 'URL', text: 'Track Order', url: 'https://track.yourstore.com/{{1}}', example: 'ORD123' },
    ],
  },
  {
    id: 'promotional_offer',
    label: 'Promotional Offer',
    description: 'Send exclusive deals to your customers',
    emoji: '🎁',
    category: 'Marketing',
    name: 'promotional_offer',
    language: 'en_US',
    header_type: 'image',
    header_text: '',
    body_text:
      'Hi {{1}}! 🎉 We have an *exclusive offer* just for you!\n\n✨ *{{2}}% OFF* on your next purchase\n🗓 Valid until: *{{3}}*\n\nUse code *{{4}}* at checkout.',
    footer_text: 'Terms & conditions apply',
    buttons: [
      { type: 'URL', text: 'Shop Now', url: 'https://yourstore.com/sale', example: '' },
      { type: 'QUICK_REPLY', text: 'Not Interested' },
    ],
  },
  {
    id: 'payment_reminder',
    label: 'Payment Reminder',
    description: 'Remind customers of pending payments',
    emoji: '💳',
    category: 'Utility',
    name: 'payment_reminder',
    language: 'en_US',
    header_type: 'text',
    header_text: 'Payment Due',
    body_text:
      'Hi {{1}}, this is a reminder that a payment of *{{2}}* is due on *{{3}}*.\n\nPlease make your payment to avoid any service interruption.\n\nIf you have already paid, please disregard this message.',
    footer_text: 'Contact us if you have any questions',
    buttons: [
      { type: 'URL', text: 'Pay Now', url: 'https://pay.yoursite.com/{{1}}', example: 'INV123' },
      { type: 'PHONE_NUMBER', text: 'Call Us', phone_number: '+1234567890' },
    ],
  },
  {
    id: 'feedback_request',
    label: 'Feedback Request',
    description: 'Collect customer reviews and feedback',
    emoji: '⭐',
    category: 'Marketing',
    name: 'feedback_request',
    language: 'en_US',
    header_type: 'text',
    header_text: 'How was your experience?',
    body_text:
      'Hi {{1}}, thank you for visiting *{{2}}*!\n\nWe\'d love to hear your feedback. It only takes 30 seconds and helps us serve you better. 😊',
    footer_text: 'Your feedback matters to us',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Excellent' },
      { type: 'QUICK_REPLY', text: 'Good' },
      { type: 'QUICK_REPLY', text: 'Needs Work' },
    ],
  },
  {
    id: 'welcome_message',
    label: 'Welcome Message',
    description: 'Greet new customers when they first contact you',
    emoji: '👋',
    category: 'Utility',
    name: 'welcome_message',
    language: 'en_US',
    header_type: 'text',
    header_text: 'Welcome to {{1}}! 👋',
    body_text:
      'Hi {{2}}, welcome! We\'re thrilled to have you here.\n\nHere\'s how we can help you:\n🔹 Browse our services\n🔹 Book an appointment\n🔹 Get support\n\nSimply reply with what you need and we\'ll be right with you!',
    footer_text: 'Reply anytime — we\'re here to help',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Browse Services' },
      { type: 'QUICK_REPLY', text: 'Book Appointment' },
      { type: 'QUICK_REPLY', text: 'Get Support' },
    ],
  },
  {
    id: 'service_followup',
    label: 'Service Follow-up',
    description: 'Check in after a service or appointment',
    emoji: '🩺',
    category: 'Utility',
    name: 'service_followup',
    language: 'en_US',
    header_type: 'text',
    header_text: 'Following Up 🙂',
    body_text:
      'Hi {{1}}, we hope everything went well after your visit on *{{2}}*.\n\nIf you have any questions or concerns, please don\'t hesitate to reach out. We\'re here to help!\n\nWishing you a great day ahead. 😊',
    footer_text: 'Thank you for choosing us',
    buttons: [
      { type: 'QUICK_REPLY', text: 'All Good' },
      { type: 'QUICK_REPLY', text: 'I Have a Question' },
    ],
  },
  {
    id: 'reengagement',
    label: 'Re-engagement',
    description: 'Win back customers who haven\'t visited recently',
    emoji: '💫',
    category: 'Marketing',
    name: 'reengagement',
    language: 'en_US',
    header_type: 'text',
    header_text: 'We miss you! 💫',
    body_text:
      'Hi {{1}}, it\'s been a while since your last visit and we miss you!\n\nAs a valued customer, we\'d like to offer you *{{2}}% off* your next visit.\n\nThis offer is valid for the next *7 days* only.',
    footer_text: 'Reply STOP to opt out',
    buttons: [
      { type: 'URL', text: 'Book Now', url: 'https://book.yoursite.com', example: '' },
      { type: 'QUICK_REPLY', text: 'Remind Me Later' },
    ],
  },
];
