import { describe, expect, it } from 'vitest';

import { finalizeContacts, normalizePhone } from './contact-extract';
import { normalizeDraft } from './flow-generate';
import { adNoteText, META_AD_NOTE_PREFIX } from './reply-context';

describe('contact extraction normalisation', () => {
  it('adds the default country code to local numbers only', () => {
    expect(normalizePhone('98765 43210', '91')).toBe('919876543210');
    expect(normalizePhone('+44 7700 900123', '91')).toBe('447700900123');
    expect(normalizePhone('0091 98765 43210', '91')).toBe('919876543210');
  });

  it('dedupes by phone, cleans emails and flags invalid numbers', () => {
    const { contacts, duplicatesRemoved } = finalizeContacts(
      [
        { name: 'Asha', phone: '9876543210', email: 'ASHA@x.com' },
        { name: 'Asha dup', phone: '+91 98765-43210' },
        { name: 'Bad', phone: '123', email: 'not-an-email' },
        { name: '', phone: '' },
      ],
      '91',
    );
    expect(duplicatesRemoved).toBe(1);
    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toMatchObject({ name: 'Asha', phone: '919876543210', email: 'asha@x.com', valid: true });
    expect(contacts[1]).toMatchObject({ name: 'Bad', valid: false, email: '' });
  });
});

describe('AI flow draft normalisation', () => {
  const raw = {
    name: 'Welcome',
    trigger_type: 'keyword',
    trigger_config: { keywords: ['Hi', 'MENU'] },
    nodes: [
      { node_key: 'Start Node', node_type: 'start', config: { next_node_key: 'Start Node 2' } },
      {
        node_key: 'menu',
        node_type: 'send_buttons',
        config: {
          text: 'How can we help?',
          buttons: [
            { reply_id: 'a', title: 'Our services and pricing plans', next_node_key: 'info' },
            { reply_id: 'a', title: 'Talk to agent', next_node_key: 'agent' },
            { reply_id: 'c', title: 'Book', next_node_key: 'missing' },
            { reply_id: 'd', title: 'Extra', next_node_key: 'info' },
          ],
        },
      },
      { node_key: 'info', node_type: 'send_message', config: { text: 'We do X.', next_node_key: 'tag' } },
      { node_key: 'tag', node_type: 'set_tag', config: { tag_name: 'Interested', next_node_key: 'done' } },
      { node_key: 'agent', node_type: 'handoff', config: {} },
      { node_key: 'done', node_type: 'end', config: {} },
      { node_key: 'orphan', node_type: 'send_message', config: { text: 'never reached', next_node_key: 'done' } },
    ],
  };

  it('repairs keys, links, limits and prunes unreachable nodes', () => {
    const d = normalizeDraft(raw)!;
    expect(d.entry_node_key).toBe('start_node');
    expect(d.trigger_config).toEqual({ keywords: ['hi', 'menu'], match_type: 'contains' });
    const menu = d.nodes.find((n) => n.node_key === 'menu');
    // start pointed at an unknown key → linked to "end"; the menu is then unreachable and pruned.
    expect(menu).toBeUndefined();
    expect(d.nodes.find((n) => n.node_key === 'orphan')).toBeUndefined();
  });

  it('keeps a valid graph valid and enforces WhatsApp button limits', () => {
    const fixed = { ...raw, nodes: raw.nodes.map((n) => (n.node_type === 'start' ? { ...n, config: { next_node_key: 'menu' } } : n)) };
    const d = normalizeDraft(fixed)!;
    const menu = d.nodes.find((n) => n.node_key === 'menu')!;
    const buttons = menu.config.buttons as Array<{ reply_id: string; title: string; next_node_key: string }>;
    expect(buttons).toHaveLength(3);
    expect(buttons[0].title.length).toBeLessThanOrEqual(20);
    expect(new Set(buttons.map((b) => b.reply_id)).size).toBe(3);
    expect(buttons[2].next_node_key).toBe('done'); // dangling "missing" → existing end node
    expect(d.tag_names).toEqual(['Interested']);
    expect(d.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('Meta ad notes', () => {
  it('records the ad so later replies keep the context', () => {
    const note = adNoteText({ headline: 'Free consultation', body: 'Book this week', source_id: '123', source_url: 'https://fb.me/x' });
    expect(note.startsWith(META_AD_NOTE_PREFIX)).toBe(true);
    expect(note).toContain('Headline: Free consultation');
    expect(note).toContain('Ad ID: 123');
  });
});
