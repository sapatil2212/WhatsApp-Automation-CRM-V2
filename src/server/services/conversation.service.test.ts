import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError, NotFoundError, ValidationError } from '../kernel';
import { ConversationService, type ConversationServiceDeps } from './conversation.service';

const now = new Date();

function hoursAgo(hours: number): Date {
  return new Date(now.getTime() - hours * 3_600_000);
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    senderType: 'agent',
    senderId: 'user-1',
    contentType: 'text',
    contentText: 'Hello',
    mediaUrl: null,
    templateName: null,
    messageId: 'wamid.NEW',
    status: 'sent',
    interactiveReplyId: null,
    createdAt: now,
    reactions: [],
    ...overrides,
  };
}

function makeDeps(sendableSince = hoursAgo(1)) {
  const conversations = {
    list: vi.fn(),
    findDetail: vi.fn(),
    findForSend: vi.fn(async () => ({
      id: 'conv-1',
      status: 'open',
      contactId: 'contact-1',
      contact: { id: 'contact-1', phone: '919876543210' },
      messages: sendableSince ? [{ createdAt: sendableSince }] : [],
    })),
    update: vi.fn(),
    markRead: vi.fn(async () => true),
    unreadSummary: vi.fn(async () => ({ totalUnread: 5, conversationsWithUnread: 2 })),
    exists: vi.fn(async () => true),
    touchLastMessage: vi.fn(async () => undefined),
    ensureForContact: vi.fn(),
    findByContact: vi.fn(),
  };
  const messages = {
    listForConversation: vi.fn(),
    findById: vi.fn(async () => messageRow()),
    findQuoteTarget: vi.fn(
      async (): Promise<{ id: string; messageId: string | null } | null> => null,
    ),
    create: vi.fn(async () => messageRow()),
    setReaction: vi.fn(async () => undefined),
    clearReaction: vi.fn(async () => undefined),
    listReactions: vi.fn(),
    updateStatus: vi.fn(),
    updateStatusByWhatsappId: vi.fn(),
    findByWhatsappId: vi.fn(),
    countInboundSince: vi.fn(),
    lastInboundAt: vi.fn(),
  };
  const profiles = { existsInTenant: vi.fn(async () => true) };
  const transport = {
    sendText: vi.fn(async () => ({ whatsappMessageId: 'wamid.NEW' })),
    sendTemplate: vi.fn(async () => ({ whatsappMessageId: 'wamid.TPL' })),
    sendMedia: vi.fn(async () => ({ whatsappMessageId: 'wamid.MEDIA' })),
  };
  return { conversations, messages, profiles, transport } as unknown as ConversationServiceDeps & {
    conversations: typeof conversations;
    messages: typeof messages;
    profiles: typeof profiles;
    transport: typeof transport;
  };
}

let deps: ReturnType<typeof makeDeps>;
let service: ConversationService;

beforeEach(() => {
  deps = makeDeps();
  service = new ConversationService(deps, 'user-1');
});

describe('update', () => {
  it('rejects assigning to a user outside the tenant', async () => {
    deps.profiles.existsInTenant.mockResolvedValueOnce(false);
    await expect(service.update('conv-1', { assignedAgentId: 'agent-elsewhere' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(deps.conversations.update).not.toHaveBeenCalled();
  });

  it('allows unassigning without a membership check', async () => {
    deps.conversations.update.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'open',
      assignedAgentId: null,
      lastMessageText: null,
      lastMessageAt: null,
      unreadCount: 0,
      createdAt: now,
      updatedAt: now,
      contact: { id: 'c-1', phone: '9199', name: null, avatarUrl: null, tags: [], createdAt: now, updatedAt: now, email: null, company: null },
      messages: [],
    } as never);

    await service.update('conv-1', { assignedAgentId: null });
    expect(deps.profiles.existsInTenant).not.toHaveBeenCalled();
    expect(deps.conversations.update).toHaveBeenCalledWith('conv-1', { assignedAgentId: null });
  });

  it('passes only the fields the caller supplied', async () => {
    deps.conversations.update.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'closed',
      assignedAgentId: null,
      lastMessageText: null,
      lastMessageAt: null,
      unreadCount: 0,
      createdAt: now,
      updatedAt: now,
      contact: { id: 'c-1', phone: '9199', name: null, avatarUrl: null, tags: [], createdAt: now, updatedAt: now, email: null, company: null },
      messages: [],
    } as never);

    await service.update('conv-1', { status: 'closed' });
    expect(deps.conversations.update).toHaveBeenCalledWith('conv-1', { status: 'closed' });
  });
});

describe('markRead', () => {
  it('404s for a conversation outside the tenant', async () => {
    deps.conversations.exists.mockResolvedValueOnce(false);
    await expect(service.markRead('conv-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('reports whether the badge actually changed, so callers can skip a broadcast', async () => {
    deps.conversations.markRead.mockResolvedValueOnce(false);
    expect(await service.markRead('conv-1')).toEqual({ changed: false });
  });
});

describe('sendMessage — service window', () => {
  it('sends free text inside the 24-hour window', async () => {
    const dto = await service.sendMessage('conv-1', { contentType: 'text', text: 'Hello' });
    expect(deps.transport.sendText).toHaveBeenCalledWith({ to: '919876543210', text: 'Hello' });
    expect(dto.whatsappMessageId).toBe('wamid.NEW');
  });

  it('refuses free text once the window has closed, before calling Meta', async () => {
    deps = makeDeps(hoursAgo(30));
    service = new ConversationService(deps, 'user-1');

    await expect(service.sendMessage('conv-1', { contentType: 'text', text: 'Hello' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(deps.transport.sendText).not.toHaveBeenCalled();
    expect(deps.messages.create).not.toHaveBeenCalled();
  });

  it('tells the client a template is required when it refuses', async () => {
    deps = makeDeps(hoursAgo(30));
    service = new ConversationService(deps, 'user-1');

    await service.sendMessage('conv-1', { contentType: 'text', text: 'Hi' }).catch((error: ConflictError) => {
      expect(error.details).toMatchObject({ requiredContentType: 'template' });
    });
  });

  it('still allows a template once the window has closed', async () => {
    deps = makeDeps(hoursAgo(30));
    service = new ConversationService(deps, 'user-1');

    await service.sendMessage('conv-1', {
      contentType: 'template',
      templateName: 'welcome',
      templateParams: [],
    });
    expect(deps.transport.sendTemplate).toHaveBeenCalled();
  });

  it('allows a template on a conversation that has never had an inbound message', async () => {
    deps = makeDeps(null as unknown as Date);
    service = new ConversationService(deps, 'user-1');

    await service.sendMessage('conv-1', {
      contentType: 'template',
      templateName: 'welcome',
      templateParams: [],
    });
    expect(deps.transport.sendTemplate).toHaveBeenCalled();
  });

  it('refuses to send on a closed conversation', async () => {
    deps.conversations.findForSend.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'closed',
      contactId: 'contact-1',
      contact: { id: 'contact-1', phone: '919876543210' },
      messages: [{ createdAt: hoursAgo(1) }],
    } as never);

    await expect(service.sendMessage('conv-1', { contentType: 'text', text: 'Hi' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('rejects a contact with no phone number', async () => {
    deps.conversations.findForSend.mockResolvedValueOnce({
      id: 'conv-1',
      status: 'open',
      contactId: 'contact-1',
      contact: { id: 'contact-1', phone: '' },
      messages: [{ createdAt: hoursAgo(1) }],
    } as never);

    await expect(service.sendMessage('conv-1', { contentType: 'text', text: 'Hi' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('sendMessage — persistence', () => {
  it('persists only after Meta accepts, and records the upstream id', async () => {
    await service.sendMessage('conv-1', { contentType: 'text', text: 'Hello' });
    expect(deps.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        senderType: 'agent',
        senderId: 'user-1',
        contentType: 'text',
        contentText: 'Hello',
        whatsappMessageId: 'wamid.NEW',
        status: 'sent',
      }),
    );
  });

  it('does not persist when the upstream send throws', async () => {
    deps.transport.sendText.mockRejectedValueOnce(new Error('Meta 502'));
    await expect(service.sendMessage('conv-1', { contentType: 'text', text: 'Hi' })).rejects.toThrow('Meta 502');
    expect(deps.messages.create).not.toHaveBeenCalled();
  });

  it('updates the conversation preview so the list reflects the newest message', async () => {
    await service.sendMessage('conv-1', { contentType: 'text', text: 'Hello' });
    expect(deps.conversations.touchLastMessage).toHaveBeenCalledWith('conv-1', 'Hello', now);
  });

  it('labels a template send in the preview rather than showing an empty row', async () => {
    await service.sendMessage('conv-1', {
      contentType: 'template',
      templateName: 'order_update',
      templateParams: ['A1'],
    });
    expect(deps.conversations.touchLastMessage).toHaveBeenCalledWith('conv-1', '[template] order_update', now);
  });

  it('stores media url and caption for a media send', async () => {
    await service.sendMessage('conv-1', {
      contentType: 'image',
      mediaUrl: 'https://cdn.example.com/a.png',
      caption: 'Invoice',
    });
    expect(deps.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image',
        mediaUrl: 'https://cdn.example.com/a.png',
        contentText: 'Invoice',
      }),
    );
  });

  it('falls back to a bracketed label when a media send has no caption', async () => {
    await service.sendMessage('conv-1', {
      contentType: 'document',
      mediaUrl: 'https://cdn.example.com/a.pdf',
    });
    expect(deps.conversations.touchLastMessage).toHaveBeenCalledWith('conv-1', '[document]', now);
  });

  it('refuses to send when no transport was injected', async () => {
    const withoutTransport = new ConversationService({ ...deps, transport: undefined }, 'user-1');
    await expect(
      withoutTransport.sendMessage('conv-1', { contentType: 'text', text: 'Hi' }),
    ).rejects.toThrow();
  });
});

describe('sendMessage — reply quote', () => {
  it('resolves the quoted message to Meta’s context id', async () => {
    deps.messages.findQuoteTarget.mockResolvedValueOnce({
      id: 'msg-parent',
      messageId: 'wamid.PARENT',
    } as never);

    await service.sendMessage('conv-1', {
      contentType: 'text',
      text: 'Replying',
      replyToMessageId: 'msg-parent',
    });

    expect(deps.transport.sendText).toHaveBeenCalledWith({
      to: '919876543210',
      text: 'Replying',
      contextMessageId: 'wamid.PARENT',
    });
  });

  it('persists the quote link', async () => {
    deps.messages.findQuoteTarget.mockResolvedValueOnce({
      id: 'msg-parent',
      messageId: 'wamid.PARENT',
    } as never);

    await service.sendMessage('conv-1', {
      contentType: 'text',
      text: 'Replying',
      replyToMessageId: 'msg-parent',
    });

    expect(deps.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ replyToMessageId: 'msg-parent' }),
    );
  });

  it('refuses a parent from another conversation, before calling Meta', async () => {
    deps.messages.findQuoteTarget.mockResolvedValueOnce(null as never);

    await expect(
      service.sendMessage('conv-1', {
        contentType: 'text',
        text: 'Replying',
        replyToMessageId: 'msg-elsewhere',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(deps.transport.sendText).not.toHaveBeenCalled();
  });

  it('sends without a quote when the parent never reached Meta, rather than dropping the message', async () => {
    deps.messages.findQuoteTarget.mockResolvedValueOnce({
      id: 'msg-parent',
      messageId: null,
    } as never);

    await service.sendMessage('conv-1', {
      contentType: 'text',
      text: 'Replying',
      replyToMessageId: 'msg-parent',
    });

    expect(deps.transport.sendText).toHaveBeenCalledWith({
      to: '919876543210',
      text: 'Replying',
      contextMessageId: undefined,
    });
    // The link is still stored so our own thread renders the quote.
    expect(deps.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ replyToMessageId: 'msg-parent' }),
    );
  });

  it('does not look up a quote target when none was requested', async () => {
    await service.sendMessage('conv-1', { contentType: 'text', text: 'Plain' });
    expect(deps.messages.findQuoteTarget).not.toHaveBeenCalled();
    expect(deps.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ replyToMessageId: null }),
    );
  });
});

describe('setReaction', () => {
  it('refuses a message id belonging to a different conversation', async () => {
    deps.messages.findById.mockResolvedValueOnce(messageRow({ conversationId: 'other-conv' }) as never);
    await expect(service.setReaction('conv-1', 'msg-1', { emoji: '👍' })).rejects.toBeInstanceOf(NotFoundError);
    expect(deps.messages.setReaction).not.toHaveBeenCalled();
  });

  it('sets the reaction for the acting agent', async () => {
    await service.setReaction('conv-1', 'msg-1', { emoji: '👍' });
    expect(deps.messages.setReaction).toHaveBeenCalledWith({
      messageId: 'msg-1',
      conversationId: 'conv-1',
      actorType: 'agent',
      actorId: 'user-1',
      emoji: '👍',
    });
  });

  it('clears the reaction when the emoji is empty — the path that always threw before', async () => {
    await service.setReaction('conv-1', 'msg-1', { emoji: '' });
    expect(deps.messages.clearReaction).toHaveBeenCalledWith({
      messageId: 'msg-1',
      actorType: 'agent',
      actorId: 'user-1',
    });
    expect(deps.messages.setReaction).not.toHaveBeenCalled();
  });

  it('treats whitespace as a clear', async () => {
    await service.setReaction('conv-1', 'msg-1', { emoji: '   ' });
    expect(deps.messages.clearReaction).toHaveBeenCalled();
  });
});
