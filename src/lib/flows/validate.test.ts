import { describe, it, expect } from "vitest";
import { validateFlowForActivation, reachableFromEntry } from "./validate";

const validFlow = {
  name: "Welcome",
  trigger_type: "keyword" as const,
  trigger_config: { keywords: ["support"] },
  entry_node_id: "start",
};

const validNodes = [
  { node_key: "start", node_type: "start", config: { next_node_key: "menu" } },
  {
    node_key: "menu",
    node_type: "send_buttons",
    config: {
      text: "How can we help?",
      buttons: [
        { reply_id: "a", title: "A", next_node_key: "ho" },
        { reply_id: "b", title: "B", next_node_key: "ho" },
      ],
    },
  },
  { node_key: "ho", node_type: "handoff", config: {} },
];

describe("validateFlowForActivation — happy path", () => {
  it("produces no issues on a well-formed flow", () => {
    expect(validateFlowForActivation(validFlow, validNodes)).toEqual([]);
  });
});

describe("validateFlowForActivation — flow-level", () => {
  it("flags empty name", () => {
    expect(
      validateFlowForActivation({ ...validFlow, name: "" }, validNodes),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "flow", field: "name" }),
      ]),
    );
  });

  it("flags whitespace-only name", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, name: "   " },
      validNodes,
    );
    expect(issues.some((i) => i.field === "name")).toBe(true);
  });

  it("flags missing entry_node_id", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: null },
      validNodes,
    );
    expect(issues.some((i) => i.field === "entry_node_id")).toBe(true);
  });

  it("flags entry_node_id that doesn't exist in nodes", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "ghost" },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.field === "entry_node_id" &&
          i.message.includes('"ghost"'),
      ),
    ).toBe(true);
  });

  it("flags empty node list", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: null },
      [],
    );
    expect(
      issues.some((i) => i.message.includes("at least one node")),
    ).toBe(true);
  });

  it("flags duplicate node_key", () => {
    const dupes = [
      { node_key: "a", node_type: "start", config: { next_node_key: "b" } },
      { node_key: "a", node_type: "end", config: {} },
      { node_key: "b", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "a" },
      dupes,
    );
    expect(
      issues.some(
        (i) =>
          i.message.includes("Duplicate node_key") &&
          i.node_key === "a",
      ),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — trigger", () => {
  it("flags keyword trigger with no keywords", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_config: { keywords: [] },
      },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.scope === "trigger" &&
          i.message.includes("at least one keyword"),
      ),
    ).toBe(true);
  });

  it("flags keyword trigger missing keywords field entirely", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, trigger_config: {} },
      validNodes,
    );
    expect(issues.some((i) => i.scope === "trigger")).toBe(true);
  });

  it("warns when keywords contain blanks", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_config: { keywords: ["support", "", " "] },
      },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.scope === "trigger" &&
          i.severity === "warning" &&
          i.message.includes("blank"),
      ),
    ).toBe(true);
  });

  it("first_inbound_message trigger needs no config", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_type: "first_inbound_message",
        trigger_config: {},
      },
      validNodes,
    );
    expect(issues.filter((i) => i.scope === "trigger")).toEqual([]);
  });
});

describe("validateFlowForActivation — nodes", () => {
  it("flags send_buttons without text", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          buttons: [{ reply_id: "x", title: "X", next_node_key: "h" }],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.node_key === "b" && i.field === "text"),
    ).toBe(true);
  });

  it("flags send_buttons with zero buttons", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: { text: "Hi", buttons: [] },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons" &&
          i.message.includes("at least one"),
      ),
    ).toBe(true);
  });

  it("flags send_buttons with more than 3 buttons (Meta limit)", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: "1", next_node_key: "h" },
            { reply_id: "2", title: "2", next_node_key: "h" },
            { reply_id: "3", title: "3", next_node_key: "h" },
            { reply_id: "4", title: "4", next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons" &&
          i.message.includes("at most 3"),
      ),
    ).toBe(true);
  });

  it("flags button title over 20 chars", () => {
    const longTitle = "x".repeat(21);
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: longTitle, next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons.0.title" &&
          i.message.includes("over 20"),
      ),
    ).toBe(true);
  });

  it("flags button pointing at non-existent next node", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: "Go", next_node_key: "ghost" },
          ],
        },
      },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.field === "buttons.0.next_node_key" &&
          i.message.includes("ghost"),
      ),
    ).toBe(true);
  });

  it("flags duplicate button reply_ids", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "x", title: "X1", next_node_key: "h" },
            { reply_id: "x", title: "X2", next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("Duplicate button reply id")),
    ).toBe(true);
  });

  it("flags send_list with more than 10 rows total", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      reply_id: `r${i}`,
      title: `Row ${i}`,
      next_node_key: "h",
    }));
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "l" } },
      {
        node_key: "l",
        node_type: "send_list",
        config: {
          text: "Pick",
          button_label: "Pick",
          sections: [{ rows: eleven }],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "l" &&
          i.field === "sections" &&
          i.message.includes("at most 10"),
      ),
    ).toBe(true);
  });

  it("flags list row title over 24 chars", () => {
    const longTitle = "x".repeat(25);
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "l" } },
      {
        node_key: "l",
        node_type: "send_list",
        config: {
          text: "Pick",
          button_label: "Pick",
          sections: [
            {
              rows: [
                {
                  reply_id: "x",
                  title: longTitle,
                  next_node_key: "h",
                },
              ],
            },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("exceeds 24 chars")),
    ).toBe(true);
  });

  it("warns about unreachable nodes", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "h" } },
      { node_key: "h", node_type: "handoff", config: {} },
      // Orphaned — nothing points at it.
      { node_key: "orphan", node_type: "end", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "orphan" &&
          i.severity === "warning" &&
          i.message.includes("unreachable"),
      ),
    ).toBe(true);
  });

  it("doesn't crash on unknown node_type — flags it", () => {
    const nodes = [
      { node_key: "s", node_type: "wibble", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("Unknown node type")),
    ).toBe(true);
  });
});

describe("reachableFromEntry", () => {
  it("walks the graph from the entry", () => {
    const set = reachableFromEntry("start", validNodes);
    expect(set.has("start")).toBe(true);
    expect(set.has("menu")).toBe(true);
    expect(set.has("ho")).toBe(true);
  });

  it("returns the entry alone when no edges lead out", () => {
    const set = reachableFromEntry("only", [
      { node_key: "only", node_type: "handoff", config: {} },
    ]);
    expect(set).toEqual(new Set(["only"]));
  });

  it("survives a cycle (visited guard)", () => {
    const nodes = [
      { node_key: "a", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Loop",
          buttons: [{ reply_id: "x", title: "Back", next_node_key: "a" }],
        },
      },
    ];
    const set = reachableFromEntry("a", nodes);
    expect(set).toEqual(new Set(["a", "b"]));
  });
});


describe("validateFlowForActivation - send_media and send_template", () => {
  const flow = { name: "Promo", trigger_type: "keyword" as const, trigger_config: { keywords: ["promo"] }, entry_node_id: "start" };
  const withNode = (node: { node_key: string; node_type: string; config: Record<string, unknown> }) => [
    { node_key: "start", node_type: "start", config: { next_node_key: node.node_key } },
    node,
    { node_key: "end", node_type: "end", config: {} },
  ];

  it("accepts a valid media node and a valid template node", () => {
    expect(validateFlowForActivation(flow, withNode({ node_key: "m", node_type: "send_media", config: { media_type: "image", url: "https://cdn.test/a.png", next_node_key: "end" } }))).toEqual([]);
    expect(validateFlowForActivation(flow, withNode({ node_key: "t", node_type: "send_template", config: { template_name: "offer", params: ["{{vars.name}}"], next_node_key: "end" } }))).toEqual([]);
  });

  it("rejects non-https, missing or malformed media links", () => {
    for (const url of ["", "http://cdn.test/a.png", "ftp://x/y", "not a url"]) {
      const issues = validateFlowForActivation(flow, withNode({ node_key: "m", node_type: "send_media", config: { media_type: "image", url, next_node_key: "end" } }));
      expect(issues.some((i) => i.field === "url" && i.severity === "error")).toBe(true);
    }
  });

  it("requires a media type, a template name and a next node", () => {
    expect(validateFlowForActivation(flow, withNode({ node_key: "m", node_type: "send_media", config: { url: "https://cdn.test/a.png", next_node_key: "end" } })).some((i) => i.field === "media_type")).toBe(true);
    expect(validateFlowForActivation(flow, withNode({ node_key: "t", node_type: "send_template", config: { template_name: " ", next_node_key: "end" } })).some((i) => i.field === "template_name")).toBe(true);
    expect(validateFlowForActivation(flow, withNode({ node_key: "t", node_type: "send_template", config: { template_name: "offer" } })).some((i) => i.field === "next_node_key")).toBe(true);
  });

  it("treats the new nodes as edges for reachability", () => {
    const nodes = withNode({ node_key: "m", node_type: "send_media", config: { media_type: "image", url: "https://cdn.test/a.png", next_node_key: "end" } });
    expect(reachableFromEntry("start", nodes).has("end")).toBe(true);
  });
});


describe("validateFlowForActivation - delay and http_request", () => {
  const flow = { name: "Follow up", trigger_type: "keyword" as const, trigger_config: { keywords: ["hi"] }, entry_node_id: "start" };
  const withNode = (node: { node_key: string; node_type: string; config: Record<string, unknown> }) => [
    { node_key: "start", node_type: "start", config: { next_node_key: node.node_key } },
    node,
    { node_key: "end", node_type: "end", config: {} },
  ];

  it("accepts a valid delay and a valid http request", () => {
    expect(validateFlowForActivation(flow, withNode({ node_key: "d", node_type: "delay", config: { amount: 30, unit: "minutes", next_node_key: "end" } }))).toEqual([]);
    expect(validateFlowForActivation(flow, withNode({ node_key: "h", node_type: "http_request", config: { url: "https://api.example.com/x", method: "GET", save_as: "out", next_node_key: "end", on_error_next_key: "end" } }))).toEqual([]);
  });

  it("rejects an empty or oversized delay and warns about template-only waits", () => {
    const bad = validateFlowForActivation(flow, withNode({ node_key: "d", node_type: "delay", config: { amount: 0, unit: "hours", next_node_key: "end" } }));
    expect(bad.some((i) => i.field === "amount" && i.severity === "error")).toBe(true);
    const huge = validateFlowForActivation(flow, withNode({ node_key: "d", node_type: "delay", config: { amount: 40, unit: "days", next_node_key: "end" } }));
    expect(huge.some((i) => i.field === "amount" && i.severity === "error")).toBe(true);
    const day = validateFlowForActivation(flow, withNode({ node_key: "d", node_type: "delay", config: { amount: 2, unit: "days", next_node_key: "end" } }));
    expect(day).toEqual([expect.objectContaining({ severity: "warning", field: "amount" })]);
  });

  it("rejects unsafe or malformed http requests", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ url: "http://api.example.com/x" }, "url"],
      [{ url: "https://169.254.169.254/x" }, "url"],
      [{ url: "https://api.example.com/x", method: "DELETE" }, "method"],
      [{ url: "https://api.example.com/x", save_as: "bad name" }, "save_as"],
      [{ url: "https://api.example.com/x", json_path: "a.b" }, "save_as"],
      [{ url: "https://api.example.com/x", on_error_next_key: "ghost" }, "on_error_next_key"],
    ];
    for (const [config, field] of cases) {
      const issues = validateFlowForActivation(flow, withNode({ node_key: "h", node_type: "http_request", config: { next_node_key: "end", ...config } }));
      expect(issues.some((i) => i.field === field && i.severity === "error"), JSON.stringify(config)).toBe(true);
    }
  });

  it("follows both the success and error edges for reachability", () => {
    const nodes = [
      { node_key: "start", node_type: "start", config: { next_node_key: "h" } },
      { node_key: "h", node_type: "http_request", config: { url: "https://api.example.com/x", next_node_key: "ok", on_error_next_key: "bad" } },
      { node_key: "ok", node_type: "end", config: {} },
      { node_key: "bad", node_type: "end", config: {} },
    ];
    const reached = reachableFromEntry("start", nodes);
    expect(reached.has("ok") && reached.has("bad")).toBe(true);
  });
});
