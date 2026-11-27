/**
 * Turns a non-text WhatsApp message into text the reply AI can understand:
 * voice notes are transcribed, photos/documents are briefly described
 * (including any readable text such as a prescription or report).
 *
 * Uses Gemini (the only configured provider that accepts audio). Every step
 * is best-effort with tight timeouts; on any failure a plain label is
 * returned so the AI still knows what kind of message arrived.
 */
import { callLLM, hasGeminiKey } from './llm';
import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api';

const MAX_BYTES = 15 * 1024 * 1024;

const LABELS: Record<string, string> = {
  audio: '[Customer sent a voice note]',
  image: '[Customer sent a photo]',
  video: '[Customer sent a video]',
  document: '[Customer sent a document]',
};

function mediaIdFrom(mediaUrl: string | null): string | null {
  const m = (mediaUrl || '').match(/\/api\/whatsapp\/media\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Returns the text the AI should read for this message. Text messages are
 * returned unchanged.
 */
export async function messageTextForAi(input: {
  contentType: string;
  contentText: string | null;
  mediaUrl: string | null;
  accessToken: string;
}): Promise<string> {
  const caption = (input.contentText || '').trim();
  const label = LABELS[input.contentType];
  if (!label) return caption;

  const mediaId = mediaIdFrom(input.mediaUrl);
  const supported = input.contentType === 'audio' || input.contentType === 'image' || (input.contentType === 'document' && !caption);
  if (!mediaId || !supported || !hasGeminiKey()) return caption ? `${label} ${caption}` : label;

  try {
    const { url, mimeType } = await getMediaUrl({ mediaId, accessToken: input.accessToken });
    const { buffer, contentType } = await downloadMedia({ downloadUrl: url, accessToken: input.accessToken });
    if (buffer.length > MAX_BYTES) return caption ? `${label} ${caption}` : label;
    const mime = (contentType || mimeType || '').split(';')[0] || 'application/octet-stream';
    if (input.contentType === 'document' && mime !== 'application/pdf' && !mime.startsWith('image/')) {
      return caption ? `${label} ${caption}` : label;
    }

    const prompt =
      input.contentType === 'audio'
        ? 'Transcribe this WhatsApp voice note word for word, in the language spoken, using that language\'s native script. Output only the transcript. If nothing intelligible is said, output: (unclear audio)'
        : 'In 1-3 short lines describe what this image/document shows for a front-desk assistant, and copy any important readable text (names, medicines, dates, amounts, questions). Output only that.';
    const res = await callLLM(prompt, {
      attachments: [{ mimeType: mime, data: buffer.toString('base64') }],
      taskCriticality: 'basic',
      maxTokens: 600,
      temperature: 0,
      timeoutMs: 20_000,
      deadlineMs: 30_000,
    });
    const text = res.success ? res.text.trim().slice(0, 1500) : '';
    if (!text) return caption ? `${label} ${caption}` : label;
    if (input.contentType === 'audio') return `[Voice note transcript] ${text}`;
    return `${label}${caption ? ` with caption: "${caption}"` : ''}. It shows: ${text}`;
  } catch {
    return caption ? `${label} ${caption}` : label;
  }
}
