import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError, NotFoundError, ValidationError } from '../kernel';
import {
  OutboundMessageService,
  type OutboundServiceDeps,
  type SendTarget,
} from './outbound.service';

const now = new Date('2026-06-01T12:00:00.000Z');
const oneHourAgo = new Date(now.getTime() - 3_600_000);
const twoDaysAgo = new Date(now.getTime() - 2 * 86_400_000);

function makeDeps() {
  const conversations = {
    ensureForContact: vi.fn(async (): Promise<{ id: string }> => ({ id: 'conv-1' })),
    findForSend: vi.fn(async () => ({
      id: 'conv-1',
      status: 'open',
      contactId: 'contact-1',
      contact: { id: 'contact-1', phone: '+15551230000' },
      messages: [{ createdAt: oneHourAgo }],
    })),
    touchLastMessage: vi.fn(async () => undefined),
  };
  const messages = {
    create: vi.fn(async () => ({ id: 'msg-1', createdAt: now })),
  };
  const transport = {
    sendText: vi.fn(async () => ({ whatsappMessageId: 'wamid.text' })),
    sendTemplate: vi.fn(async () => ({ whatsappMessageId: 'wamid.tpl' })),
    sendMedia: vi.fn(async () => ({ whatsappMessageId: 'wamid.media' })),
    sendInteractiveButtons: vi.fn(async () => ({ whatsappMessageId: 'wamid.btn' })),
    sendInteractiveList: vi.fn(async () => ({ whatsappMessageId: 'wamid.list' })),
  };
  return { conversations, messages, transport } as unknown as OutboundServiceDeps & {
    conversations: typeof conversations;
    messages: typeof messages;
    transport: typeof transport;
  };
}

function target(overrides: Partial<SendTarget> = {}): SendTarget {
  return {
    conversationId: 'conv-1',
    contactId: 'contact-1',
    phone: '+15551230000',
    status: 'open',
    lastInboundAt: oneHourAgo,
    ...overrides,
  };
}

let deps: ReturnType<typeof makeDeps>;
let service: OutboundMessageService;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  deps = makeDeps();
  service = new OutboundMessageService(deps, 'user-1');
});

describe('resolveTarget', () => {
  it('creates a conversation when the trigger did not supply one', async () => {
    const resolved = await service.resolveTarget({ contactId: 'contact-1' });

    expect(deps.conversations.ensureForContact).toHaveBeenCalledWith('contact-1', 'user-1');
    expect(resolved.conversationId).toBe('conv-1');
  });

  it('reuses a supplied conversation without creating one', async () => {
    await service.resolveTarget({ contactId: 'contact-1', conversationId: 'conv-1' });

    expect(deps.conversations.ensureForContact).not.toHaveBeenCalled();
  });

  it('refuses a conversation that belongs to another contact', async () => {
    deps.conversations.findForSend.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'open',
      contactId: 'someone-else',
      contact: { id: 'someone-else', phone: '+15559999999' },
      messages: [],
    });

    await expect(
      service.resolveTarget({ contactId: 'contact-1', conversationId: 'conv-1' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a contact with no phone number', async () => {
    deps.conversations.findForSend.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'open',
      contactId: 'contact-1',
      contact: { id: 'contact-1', phone: '' },
      messages: [],
    });

    await expect(
      service.resolveTarget({ contactId: 'contact-1', conversationId: 'conv-1' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('the 24-hour service window', () => {
  it('sends free text inside the window', async () => {
    const result = await service.sendText(target(), 'Hello there');

    expect(deps.transport.sendText).toHaveBeenCalledWith({ to: '+15551230000', text: 'Hello there' });
    expect(result.whatsappMessageId).toBe('wamid.text');
  });

  it('refuses free text once the window has closed, before calling Meta', async () => {
    await expect(
      service.sendText(target({ lastInboundAt: twoDaysAgo }), 'Hello there'),
    ).rejects.toBeInstanceOf(ConflictError);

    // The point of the check: no wasted Meta call, no phantom message row.
    expect(deps.transport.sendText).not.toHaveBeenCalled();
    expect(deps.messages.create).not.toHaveBeenCalled();
  });

  it('still allows a template once the window has closed', async () => {
    await service.sendTemplate(target({ lastInboundAt: twoDaysAgo }), {
      templateName: 'reminder',
      params: [],
    });

    expect(deps.transport.sendTemplate).toHaveBeenCalled();
  });

  it('treats a contact who has never written as outside the window', async () => {
    await expect(service.sendText(target({ lastInboundAt: null }), 'Hi')).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('persistence', () => {
  it('records the send as a bot message attributed to the owner', async () => {
    await service.sendText(target(), 'Hello');

    expect(deps.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        senderType: 'bot',
        senderId: 'user-1',
        contentType: 'text',
        contentText: 'Hello',
        whatsappMessageId: 'wamid.text',
        status: 'sent',
      }),
    );
  });

  it('does not persist anything when Meta rejects the send', async () => {
    deps.transport.sendText.mockRejectedValueOnce(new Error('Meta said no'));

    await expect(service.sendText(target(), 'Hello')).rejects.toThrow('Meta said no');
    expect(deps.messages.create).not.toHaveBeenCalled();
    expect(deps.conversations.touchLastMessage).not.toHaveBeenCalled();
  });

  it('updates the conversation preview from the sent content', async () => {
    await service.sendTemplate(target(), { templateName: 'welcome', params: [] });

    expect(deps.conversations.touchLastMessage).toHaveBeenCalledWith(
      'conv-1',
      '[template] welcome',
      now,
    );
  });

  it('stores interactive prompts with their body text as the preview', async () => {
    await service.sendButtons(target(), {
      bodyText: 'Pick one',
      buttons: [{ id: 'a', title: 'A' }],
    });

    expect(deps.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'interactive', contentText: 'Pick one' }),
    );
    expect(deps.conversations.touchLastMessage).toHaveBeenCalledWith('conv-1', 'Pick one', now);
  });
});
