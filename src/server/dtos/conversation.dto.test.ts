import { describe, expect, it } from 'vitest';

import {
  SERVICE_WINDOW_HOURS,
  computeServiceWindow,
  conversationDtoSchema,
  messageDtoSchema,
  toConversationDto,
  toMessageDto,
} from './conversation.dto';

const now = new Date('2026-05-22T12:00:00.000Z');

function hoursAgo(hours: number): Date {
  return new Date(now.getTime() - hours * 3_600_000);
}

describe('computeServiceWindow', () => {
  it('reports remaining hours inside the window', () => {
    const window = computeServiceWindow(hoursAgo(4), now);
    expect(window).toEqual({
      expired: false,
      hoursRemaining: 20,
      lastCustomerMessageAt: hoursAgo(4).toISOString(),
    });
  });

  it('marks the window closed at exactly 24 hours', () => {
    expect(computeServiceWindow(hoursAgo(SERVICE_WINDOW_HOURS), now).expired).toBe(true);
  });

  it('marks the window closed beyond 24 hours and clamps remaining to zero', () => {
    const window = computeServiceWindow(hoursAgo(100), now);
    expect(window.expired).toBe(true);
    expect(window.hoursRemaining).toBe(0);
  });

  it('treats a conversation with no inbound message as closed, since only templates are allowed', () => {
    expect(computeServiceWindow(null, now)).toEqual({
      expired: true,
      hoursRemaining: null,
      lastCustomerMessageAt: null,
    });
  });

  it('rounds to one decimal so the UI can render it directly', () => {
    expect(computeServiceWindow(hoursAgo(1.234), now).hoursRemaining).toBe(22.8);
  });
});

describe('toConversationDto', () => {
  const row = {
    id: 'conv-1',
    status: 'open',
    assignedAgentId: null,
    lastMessageText: 'Hi there',
    lastMessageAt: hoursAgo(1),
    unreadCount: 2,
    createdAt: hoursAgo(48),
    updatedAt: hoursAgo(1),
    contact: { id: 'contact-1', phone: '919876543210', name: 'Asha', avatarUrl: null },
    messages: [{ createdAt: hoursAgo(2) }],
  };

  it('matches its own schema', () => {
    expect(conversationDtoSchema.safeParse(toConversationDto(row, now)).success).toBe(true);
  });

  it('always carries the contact — the join the old data layer dropped', () => {
    expect(toConversationDto(row, now).contact).toEqual({
      id: 'contact-1',
      phone: '919876543210',
      name: 'Asha',
      avatarUrl: null,
    });
  });

  it('derives the service window from the last inbound message', () => {
    expect(toConversationDto(row, now).serviceWindow.hoursRemaining).toBe(22);
  });

  it('reports an expired window when there are no inbound messages', () => {
    expect(toConversationDto({ ...row, messages: [] }, now).serviceWindow.expired).toBe(true);
  });

  it('degrades an unrecognised legacy status instead of failing the whole inbox', () => {
    expect(toConversationDto({ ...row, status: 'archived' }, now).status).toBe('open');
  });

  it('does not expose tenantId or userId', () => {
    const dto = toConversationDto({ ...row, tenantId: 't', userId: 'u' } as typeof row, now);
    expect(Object.keys(dto)).not.toContain('tenantId');
    expect(Object.keys(dto)).not.toContain('userId');
  });
});

describe('toMessageDto', () => {
  const row = {
    id: 'msg-1',
    conversationId: 'conv-1',
    senderType: 'agent',
    senderId: 'user-1',
    contentType: 'text',
    contentText: 'Hello',
    mediaUrl: null,
    templateName: null,
    messageId: 'wamid.ABC',
    status: 'delivered',
    interactiveReplyId: null,
    replyToMessageId: null,
    createdAt: now,
  };

  it('matches its own schema', () => {
    expect(messageDtoSchema.safeParse(toMessageDto(row)).success).toBe(true);
  });

  it('renames the Meta id to whatsappMessageId so it is not confused with our primary key', () => {
    const dto = toMessageDto(row);
    expect(dto.whatsappMessageId).toBe('wamid.ABC');
    expect(dto.id).toBe('msg-1');
    expect(Object.keys(dto)).not.toContain('messageId');
  });

  it('reports a null Meta id for a message that never reached Meta', () => {
    expect(toMessageDto({ ...row, messageId: null }).whatsappMessageId).toBeNull();
  });

  it('emits an empty reaction list when reactions were not included', () => {
    expect(toMessageDto(row).reactions).toEqual([]);
  });

  it('maps reactions', () => {
    const dto = toMessageDto({
      ...row,
      reactions: [{ id: 'r-1', actorType: 'customer', actorId: null, emoji: '👍', createdAt: now }],
    });
    expect(dto.reactions).toEqual([
      { id: 'r-1', actorType: 'customer', actorId: null, emoji: '👍', createdAt: now.toISOString() },
    ]);
  });

  it('degrades unknown legacy content types to text', () => {
    expect(toMessageDto({ ...row, contentType: 'contacts' }).contentType).toBe('text');
  });

  it('preserves the interactive reply id used by the flow runner', () => {
    const dto = toMessageDto({ ...row, contentType: 'interactive', interactiveReplyId: 'btn_yes' });
    expect(dto.interactiveReplyId).toBe('btn_yes');
  });
});
