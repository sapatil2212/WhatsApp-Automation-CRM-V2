'use strict';
/**
 * Turns the navigator's observation into the job outcome. The approved
 * review text is NOT typed anywhere: it is handed to the customer on their
 * own device (copy button), and they complete Google's own flow themselves.
 */
const MESSAGES = {
  ready: 'The Google review page opened normally. The customer will paste and publish the review themselves.',
  sign_in_required: 'Google asks for a sign-in. The customer must sign in on their own device. The worker stopped here.',
  consent_required: 'Google showed a consent screen. The customer must continue on their own device. The worker stopped here.',
  blocked: 'Google showed a verification or block page. The worker stopped and did not try to get past it. The customer must open the link on their own device.',
};

function prepare(observation, approval) {
  const needsCustomerAction = observation.state !== 'ready';
  return {
    status: 'awaiting_customer_confirmation',
    needsCustomerAction,
    message: MESSAGES[observation.state] || MESSAGES.blocked,
    result: {
      state: observation.state,
      finalHost: observation.finalHost,
      pageTitle: (observation.title || '').slice(0, 120),
      textReady: Boolean(approval && approval.finalText),
      textChars: approval && approval.finalText ? approval.finalText.length : 0,
      published: false,
      note: 'Preparation only. ChatNexGen never submits or publishes a Google review.',
    },
  };
}

module.exports = { prepare };