import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTurns, callLLM, inferTaskCriticality } from './llm';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const fail = (status: number, text = 'error') => new Response(text, { status });

const claude = (text: string) => ok({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } });
const gemini = (text: string) => ok({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 20 } });
const openrouter = (text: string) => ok({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { total_tokens: 30 } });

const env = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'ak';
  process.env.GEMINI_API_KEY = 'gk';
  process.env.OPENROUTER_API_KEY = 'ok';
  delete process.env.GEMINI_API_KEY_SECONDARY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_MODELS;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
});

const hosts = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)).host);

describe('callLLM provider priority', () => {
  it('uses Anthropic first', async () => {
    fetchMock.mockResolvedValueOnce(claude('hello'));
    const r = await callLLM('hi', { taskCriticality: 'basic' });
    expect(r).toMatchObject({ success: true, text: 'hello', provider: 'anthropic', model: 'claude-haiku-5-5' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe('ak');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('routes standard work to the capable model and steps down on failure', async () => {
    fetchMock.mockResolvedValueOnce(fail(529, 'overloaded')).mockResolvedValueOnce(claude('ok'));
    const r = await callLLM('Which doctor is best for knee pain and what are the fees?');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('claude-sonnet-5-5');
    expect(r.model).toBe('claude-haiku-5-5');
  });

  it('falls back to Gemini, then OpenRouter only when both fail', async () => {
    fetchMock
      .mockResolvedValueOnce(fail(401, 'bad key')) // anthropic: auth error skips its other model
      .mockResolvedValueOnce(fail(500))
      .mockResolvedValueOnce(fail(503))
      .mockResolvedValueOnce(openrouter('from openrouter'));
    const r = await callLLM('hello there friend', { taskCriticality: 'standard' });
    expect(hosts()).toEqual(['api.anthropic.com', 'generativelanguage.googleapis.com', 'generativelanguage.googleapis.com', 'openrouter.ai']);
    expect(r).toMatchObject({ success: true, provider: 'openrouter', text: 'from openrouter' });
  });

  it('treats invalid JSON as a failure in JSON mode and moves on', async () => {
    fetchMock.mockResolvedValueOnce(claude('Sure! here you go')).mockResolvedValueOnce(claude('{"a":1}'));
    const r = await callLLM('x', { jsonMode: true, taskCriticality: 'basic' });
    expect(r.text).toBe('{"a":1}');
    expect(r.debugLogs.join()).toMatch(/invalid JSON/);
  });

  it('never sends the deprecated temperature to Claude and leaves room for thinking', async () => {
    fetchMock.mockResolvedValueOnce(claude('fine'));
    await callLLM('x', { taskCriticality: 'basic', temperature: 0.4, maxTokens: 300 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBeGreaterThan(1500);
  });

  it('keeps Gemini-only tasks on Gemini', async () => {
    fetchMock.mockResolvedValueOnce(gemini('g'));
    const r = await callLLM('x', { geminiOnly: true });
    expect(hosts()).toEqual(['generativelanguage.googleapis.com']);
    expect(r.provider).toBe('gemini');
  });

  it('reports failure (not an exception) when every provider fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const r = await callLLM('x', { timeoutMs: 5000 });
    expect(r.success).toBe(false);
    expect(r.debugLogs.length).toBeGreaterThan(3);
  });

  it('sends conversation history as real turns with a cached system prompt', async () => {
    fetchMock.mockResolvedValueOnce(claude('ok'));
    await callLLM('Cancel karo', {
      systemPrompt: 'SYS',
      history: [
        { role: 'assistant', content: 'stray greeting' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system[0]).toMatchObject({ text: 'SYS', cache_control: { type: 'ephemeral' } });
    expect(body.messages).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'Cancel karo' },
    ]);
  });
});

describe('buildTurns', () => {
  it('merges consecutive turns and always ends with the user', () => {
    expect(buildTurns([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }], '')).toEqual([{ role: 'user', content: 'a\nb' }]);
    expect(buildTurns([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], '').at(-1)?.role).toBe('user');
  });
});

describe('inferTaskCriticality', () => {
  it('sends simple replies to the fast tier', () => {
    for (const t of ['Ok', 'No', 'thanks', '2', 'haan', 'नको', '👍', 'tomorrow 5pm', 'Swapnil Patil']) expect(inferTaskCriticality(t)).toBe('basic');
  });
  it('sends clinical, money and complaint topics to the strongest tier', () => {
    for (const t of ['I have chest pain since morning', 'I want a refund', 'this is the worst service, complaint']) expect(inferTaskCriticality(t)).toBe('critical');
  });
  it('uses the capable default for normal questions', () => {
    expect(inferTaskCriticality('Which doctor should I see for my child and when is she available?')).toBe('standard');
  });
});
