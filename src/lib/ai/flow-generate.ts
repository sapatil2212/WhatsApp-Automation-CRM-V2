/**
 * AI flow builder: a plain-language instruction → a complete chatbot flow
 * (trigger + node graph) that passes the same validator used at activation.
 *
 * The model writes the graph; this module repairs everything mechanical
 * (key format, WhatsApp length limits, dangling links, unreachable nodes)
 * and runs one AI repair pass for anything left. Tags are referenced by
 * name and resolved/created only when the user approves the flow.
 */

import { z } from 'zod';

import { callLLM, parseJSONFromLLM } from '@/lib/ai/llm';
import { validateFlowForActivation, type ValidationIssue } from '@/lib/flows/validate';
import { INTERACTIVE_LIMITS } from '@/lib/whatsapp/meta-api';

export const generateFlowBodySchema = z.object({
  instruction: z.string().trim().min(8, 'Describe what the flow should do.').max(3000),
  /** Optional: tweak a previous draft ("make the menu 3 options", "add a lead form"). */
  feedback: z.string().trim().max(1500).optional(),
  previous: z.unknown().optional(),
});

export interface DraftNode {
  node_key: string;
  node_type: 'start' | 'send_message' | 'send_buttons' | 'send_list' | 'collect_input' | 'condition' | 'set_tag' | 'handoff' | 'end';
  config: Record<string, unknown>;
}

export interface FlowDraft {
  name: string;
  description: string;
  summary: string;
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config: Record<string, unknown>;
  entry_node_key: string;
  nodes: DraftNode[];
  /** Tag names referenced by set_tag / condition nodes (resolved on approval). */
  tag_names: string[];
  issues: ValidationIssue[];
}

const NODE_TYPES = new Set<DraftNode['node_type']>(['start', 'send_message', 'send_buttons', 'send_list', 'collect_input', 'condition', 'set_tag', 'handoff', 'end']);
const L = INTERACTIVE_LIMITS;

const SPEC = `FLOW JSON SCHEMA
{
  "name": "short flow name",
  "description": "one sentence",
  "summary": "2-3 sentences explaining what the bot does, for the business owner",
  "trigger_type": "keyword" | "first_inbound_message",
  "trigger_config": {"keywords": ["hi","menu"], "match_type": "contains"}   // only for keyword; {} otherwise
  "entry_node_key": "start",
  "nodes": [ { "node_key": "snake_case_unique", "node_type": "...", "config": {...} } ]
}

NODE TYPES (config fields):
- start          {"next_node_key"}                         entry point, exactly one
- send_message   {"text", "next_node_key"}                 plain message
- send_buttons   {"text", "header_text"?, "footer_text"?, "buttons":[{"reply_id","title","next_node_key"}]}   1–${L.maxButtons} buttons, title ≤ ${L.buttonTitleMaxLength} chars, waits for a tap
- send_list      {"text", "button_label", "sections":[{"title","rows":[{"reply_id","title","description"?,"next_node_key"}]}]}   ≤ ${L.maxListRowsTotal} rows total, row title ≤ ${L.listRowTitleMaxLength} chars, description ≤ ${L.listRowDescriptionMaxLength}, button_label ≤ 20
- collect_input  {"prompt_text", "var_key", "validation": "any"|"email"|"phone", "next_node_key"}   asks a question and stores the answer; reuse it later as {{vars.<var_key>}}
- condition      {"subject": "var"|"tag", "subject_key", "operator": "equals"|"contains"|"present"|"absent", "value"?, "true_next", "false_next"}   for subject "tag", subject_key is the TAG NAME
- set_tag        {"mode": "add"|"remove", "tag_name": "Lead - Hot", "next_node_key"}
- handoff        {"note"}                                  hands the chat to a human agent (terminal)
- end            {}                                        stops the flow (terminal)

RULES
- Every next_node_key / true_next / false_next must reference an existing node_key. Every node must be reachable from start.
- Use send_buttons for ≤ 3 choices, send_list for 4–10 choices. reply_id: snake_case, unique within the node.
- Messages are WhatsApp-friendly: short, warm, *bold* allowed, emoji sparingly. Reuse collected answers as {{vars.<var_key>}}, e.g. {{vars.name}}. Only reference a var_key that an earlier collect_input stores.
- Prefer ending paths with a helpful message then "end", or "handoff" when a human must take over (complaints, custom quotes, "talk to agent").
- Always include a way to reach a human agent from the main menu.
- Keywords: lowercase, 2–6 relevant words.`;

function slug(v: unknown, fallback: string): string {
  const s = String(v ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return s || fallback;
}
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeDraft(raw: any): FlowDraft | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes)) return null;

  // 1. Keys: slugify, de-duplicate, remember renames for link rewriting.
  const rename = new Map<string, string>();
  const used = new Set<string>();
  const nodes: DraftNode[] = [];
  raw.nodes.forEach((n: any, i: number) => {
    const type = NODE_TYPES.has(n?.node_type) ? (n.node_type as DraftNode['node_type']) : null;
    if (!type) return;
    let key = slug(n.node_key, `node_${i + 1}`);
    while (used.has(key)) key = `${key}_${i + 1}`;
    used.add(key);
    rename.set(String(n.node_key ?? ''), key);
    nodes.push({ node_key: key, node_type: type, config: n.config && typeof n.config === 'object' ? { ...n.config } : {} });
  });
  if (!nodes.length) return null;

  // Ensure exactly one start node at the top.
  let start = nodes.find((n) => n.node_type === 'start');
  if (!start) {
    start = { node_key: used.has('start') ? 'start_node' : 'start', node_type: 'start', config: { next_node_key: nodes[0].node_key } };
    nodes.unshift(start);
  }
  const extraStarts = nodes.filter((n) => n.node_type === 'start' && n !== start);
  extraStarts.forEach((n) => { n.node_type = 'send_message'; n.config = { text: '…', next_node_key: n.config.next_node_key }; });

  const keys = new Set(nodes.map((n) => n.node_key));
  let endKey: string | null = nodes.find((n) => n.node_type === 'end')?.node_key ?? null;
  const ensureEnd = () => {
    if (!endKey) {
      endKey = keys.has('end') ? 'end_flow' : 'end';
      nodes.push({ node_key: endKey, node_type: 'end', config: {} });
      keys.add(endKey);
    }
    return endKey;
  };
  const link = (v: unknown) => {
    const k = rename.get(String(v ?? '')) ?? slug(v, '');
    return k && keys.has(k) ? k : ensureEnd();
  };
  const tagNames = new Set<string>();

  // 2. Per-node repairs (limits, required fields, links).
  for (const n of nodes) {
    const c = n.config;
    switch (n.node_type) {
      case 'start':
        c.next_node_key = link(c.next_node_key ?? nodes.find((x) => x !== n)?.node_key);
        break;
      case 'send_message':
        n.config = { text: str(c.text, L.bodyMaxLength) || '…', next_node_key: link(c.next_node_key) };
        break;
      case 'send_buttons': {
        const seen = new Set<string>();
        const buttons = (Array.isArray(c.buttons) ? c.buttons : []).slice(0, L.maxButtons).map((b: any, i: number) => {
          let id = slug(b?.reply_id ?? b?.title, `opt_${i + 1}`);
          while (seen.has(id)) id = `${id}_${i + 1}`;
          seen.add(id);
          return { reply_id: id, title: str(b?.title, L.buttonTitleMaxLength) || `Option ${i + 1}`, next_node_key: link(b?.next_node_key) };
        });
        n.config = {
          text: str(c.text, L.bodyMaxLength) || 'Please choose an option:',
          ...(c.header_text ? { header_text: str(c.header_text, L.headerTextMaxLength) } : {}),
          ...(c.footer_text ? { footer_text: str(c.footer_text, L.footerMaxLength) } : {}),
          buttons: buttons.length ? buttons : [{ reply_id: 'continue', title: 'Continue', next_node_key: ensureEnd() }],
        };
        break;
      }
      case 'send_list': {
        let budget = L.maxListRowsTotal;
        const seen = new Set<string>();
        const sections = (Array.isArray(c.sections) ? c.sections : []).slice(0, L.maxListSections).map((sec: any, si: number) => ({
          title: str(sec?.title, 24) || `Options ${si + 1}`,
          rows: (Array.isArray(sec?.rows) ? sec.rows : []).filter(() => budget-- > 0).map((r: any, i: number) => {
            let id = slug(r?.reply_id ?? r?.title, `row_${si + 1}_${i + 1}`);
            while (seen.has(id)) id = `${id}_${i + 1}`;
            seen.add(id);
            return {
              reply_id: id,
              title: str(r?.title, L.listRowTitleMaxLength) || `Option ${i + 1}`,
              ...(r?.description ? { description: str(r.description, L.listRowDescriptionMaxLength) } : {}),
              next_node_key: link(r?.next_node_key),
            };
          }),
        })).filter((sec: { rows: unknown[] }) => sec.rows.length);
        n.config = {
          text: str(c.text, L.bodyMaxLength) || 'Please choose an option:',
          button_label: str(c.button_label, 20) || 'View options',
          sections: sections.length ? sections : [{ title: 'Options', rows: [{ reply_id: 'continue', title: 'Continue', next_node_key: ensureEnd() }] }],
        };
        break;
      }
      case 'collect_input':
        n.config = {
          prompt_text: str(c.prompt_text ?? c.text, L.bodyMaxLength) || 'Please type your answer:',
          var_key: slug(c.var_key, 'answer'),
          validation: ['any', 'email', 'phone'].includes(String(c.validation)) ? c.validation : 'any',
          next_node_key: link(c.next_node_key),
        };
        break;
      case 'condition': {
        const subject = c.subject === 'tag' ? 'tag' : 'var';
        if (subject === 'tag') tagNames.add(str(c.subject_key, 60));
        n.config = {
          subject,
          subject_key: subject === 'tag' ? str(c.subject_key, 60) : slug(c.subject_key, 'answer'),
          operator: ['equals', 'contains', 'present', 'absent'].includes(String(c.operator)) ? c.operator : 'present',
          ...(c.value !== undefined ? { value: str(c.value, 200) } : {}),
          true_next: link(c.true_next),
          false_next: link(c.false_next),
        };
        break;
      }
      case 'set_tag': {
        const name = str(c.tag_name ?? c.tag ?? c.tag_id, 60) || 'Flow lead';
        tagNames.add(name);
        n.config = { mode: c.mode === 'remove' ? 'remove' : 'add', tag_name: name, next_node_key: link(c.next_node_key) };
        break;
      }
      case 'handoff':
        n.config = { note: str(c.note, 300) || 'Customer asked for a human agent.' };
        break;
      case 'end':
        n.config = {};
        break;
    }
  }

  // 2b. Variables: the model often writes `{{name}}`; store the canonical
  // `{{vars.name}}` so the builder and engine agree. Numeric `{{1}}` is left alone.
  const canonical = (s: string) => s.replace(/\{\{\s*(?!vars\.)([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, '{{vars.$1}}');
  for (const n of nodes) {
    const c = n.config as Record<string, unknown>;
    for (const field of ['text', 'prompt_text', 'note', 'caption']) {
      if (typeof c[field] === 'string') c[field] = canonical(c[field] as string);
    }
  }

  // 3. Trigger.
  const triggerType = raw.trigger_type === 'first_inbound_message' ? 'first_inbound_message' : 'keyword';
  const keywords = (Array.isArray(raw.trigger_config?.keywords) ? raw.trigger_config.keywords : [])
    .map((k: unknown) => str(k, 40).toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
  const trigger_config =
    triggerType === 'keyword'
      ? { keywords: keywords.length ? keywords : ['hi', 'menu'], match_type: raw.trigger_config?.match_type === 'exact' ? 'exact' : 'contains' }
      : {};

  const draft: FlowDraft = {
    name: str(raw.name, 120) || 'AI flow',
    description: str(raw.description, 500),
    summary: str(raw.summary, 800),
    trigger_type: triggerType,
    trigger_config,
    entry_node_key: start.node_key,
    nodes: pruneUnreachable(nodes, start.node_key),
    tag_names: [...tagNames].filter(Boolean),
    issues: [],
  };
  draft.issues = validateDraft(draft);
  return draft;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function nextKeys(n: DraftNode): string[] {
  const c = n.config as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ['next_node_key', 'true_next', 'false_next']) if (typeof c[k] === 'string') out.push(c[k] as string);
  for (const b of (c.buttons as Array<{ next_node_key: string }>) ?? []) out.push(b.next_node_key);
  for (const s of (c.sections as Array<{ rows: Array<{ next_node_key: string }> }>) ?? []) for (const r of s.rows) out.push(r.next_node_key);
  return out;
}

function pruneUnreachable(nodes: DraftNode[], entry: string): DraftNode[] {
  const byKey = new Map(nodes.map((n) => [n.node_key, n]));
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const k = stack.pop()!;
    if (seen.has(k) || !byKey.has(k)) continue;
    seen.add(k);
    stack.push(...nextKeys(byKey.get(k)!));
  }
  return nodes.filter((n) => seen.has(n.node_key));
}

/**
 * Validates as activation would. set_tag / tag conditions carry a tag NAME
 * here; a placeholder id keeps the validator's "tag required" check honest.
 */
export function validateDraft(d: FlowDraft): ValidationIssue[] {
  return validateFlowForActivation(
    { name: d.name, trigger_type: d.trigger_type, trigger_config: d.trigger_config, entry_node_id: d.entry_node_key },
    d.nodes.map((n) => ({
      node_key: n.node_key,
      node_type: n.node_type,
      config: n.node_type === 'set_tag' ? { ...n.config, tag_id: 'pending' } : n.config,
    })),
  );
}

export async function generateFlow(input: {
  instruction: string;
  businessContext: string;
  existingTags: string[];
  feedback?: string;
  previous?: unknown;
}): Promise<FlowDraft> {
  const base = `You are an expert WhatsApp chatbot designer. Build a complete, production-ready conversational flow.

BUSINESS: ${input.businessContext || '(not provided)'}
EXISTING TAGS (reuse when relevant): ${input.existingTags.join(', ') || '(none)'}

USER INSTRUCTION:
${input.instruction}
${input.previous ? `\nCURRENT DRAFT (modify it according to the requested changes, keep what works):\n${JSON.stringify(input.previous).slice(0, 12000)}\n` : ''}${input.feedback ? `\nREQUESTED CHANGES: ${input.feedback}\n` : ''}
${SPEC}

Return ONLY the flow JSON.`;

  let prompt = base;
  let best: FlowDraft | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const llm = await callLLM(prompt, {
      geminiOnly: true,
      jsonMode: true,
      maxTokens: 8192,
      temperature: 0.3,
      taskCriticality: attempt === 0 ? 'standard' : 'critical',
      timeoutMs: 90_000,
    });
    const draft = llm.success ? normalizeDraft(parseJSONFromLLM(llm.text)) : null;
    if (draft) {
      const errors = draft.issues.filter((i) => i.severity === 'error');
      if (!best || errors.length < best.issues.filter((i) => i.severity === 'error').length) best = draft;
      if (!errors.length) break;
      prompt = `${base}\n\nYOUR PREVIOUS FLOW HAD THESE ERRORS — return a corrected full flow:\n${errors.map((e) => `- ${e.node_key ? `[${e.node_key}] ` : ''}${e.message}`).join('\n')}\n\nPREVIOUS FLOW:\n${JSON.stringify({ ...draft, issues: undefined }).slice(0, 12000)}`;
    } else if (!llm.success && !best && attempt === 1) {
      // Both tiers failed (attempt 0 → flash models, attempt 1 → pro): a real outage.
      throw new Error('The AI service did not respond. Please try again.', { cause: llm.debugLogs });
    }
  }
  if (!best) throw new Error('The AI could not build a valid flow. Try rephrasing the instruction.');
  return best;
}
