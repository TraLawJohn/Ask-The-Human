import { describe, it } from "node:test";
import assert from "node:assert";

// We import the default export directly. The Pi-runtime types are unavailable
// outside the herdr process, but execute()/renderers only touch fields we stub.
// tsx transpiles without strict type-checking, so we pass plain-objects as mocks.
import askUser from "./ask_user";

/* ------------------------------------------------------------------ */
/*  Minimal Pi stubs                                                  */
/* ------------------------------------------------------------------ */

function mockTheme() {
  return {
    fg: (color: string, text: string) => `[${color}:${text}]`,
    bold: (text: string) => `{bold:${text}}`,
  };
}

function createMockExtensionAPI() {
  let capturedTool: any = null;
  return {
    registerTool: (def: any) => {
      capturedTool = def;
    },
    getCapturedTool: () => capturedTool,
  };
}

function createMockCtx(uiOverrides?: Record<string, any>) {
  return {
    mode: "tui",
    hasUI: true,
    ui: {
      select: async () => undefined,
      input: async () => undefined,
      ...uiOverrides,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Fixtures                                                          */
/* ------------------------------------------------------------------ */

const validParams = {
  question: "Which DB?",
  reason: "Hard to reverse.",
  options: [
    { label: "SQLite", tradeoff: "Simple" },
    { label: "PostgreSQL", tradeoff: "Robust" },
  ],
  recommendation: "Use PostgreSQL",
};

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("ask_user Pi-stub integration", () => {
  it("registers the tool with correct name and label", () => {
    const api = createMockExtensionAPI();
    askUser(api as any);
    const tool = api.getCapturedTool();

    assert.strictEqual(tool.name, "ask_user");
    assert.strictEqual(tool.label, "Ask User");
    assert.strictEqual(tool.executionMode, "sequential");
    assert.ok(tool.description.includes("answered"));
    assert.ok(tool.description.includes("cancelled"));
    assert.ok(tool.description.includes("unavailable"));
  });

  it("renderCall includes question, recommendation, and option labels", () => {
    const api = createMockExtensionAPI();
    askUser(api as any);
    const tool = api.getCapturedTool();

    const theme = mockTheme();
    const rendered = tool.renderCall(validParams, theme, {});

    const text = rendered.text ?? "";
    assert.ok(text.includes("Which DB?"));
    assert.ok(text.includes("Use PostgreSQL"));
    assert.ok(text.includes("SQLite"));
    assert.ok(text.includes("PostgreSQL"));
    assert.ok(text.includes("Write custom answer"));
  });

  it("renderResult shows unavailable status", () => {
    const api = createMockExtensionAPI();
    askUser(api as any);
    const tool = api.getCapturedTool();

    const theme = mockTheme();
    const result = {
      content: [{ type: "text", text: "no ui" }],
      details: {
        status: "unavailable",
        question: "Q",
        reason: "R",
        options: ["A", "B"],
        answer: null,
        wasCustom: null,
      },
    };

    const rendered = tool.renderResult(result, { expanded: false, isPartial: false }, theme, {});
    const text = rendered.text ?? "";
    assert.ok(text.includes("Unavailable"), `got: ${text}`);
  });

  it("renderResult shows cancelled status", () => {
    const api = createMockExtensionAPI();
    askUser(api as any);
    const tool = api.getCapturedTool();

    const theme = mockTheme();
    const result = {
      content: [{ type: "text", text: "cancelled" }],
      details: {
        status: "cancelled",
        question: "Q",
        reason: "R",
        options: ["A", "B"],
        answer: null,
        wasCustom: null,
      },
    };

    const rendered = tool.renderResult(result, { expanded: false, isPartial: false }, theme, {});
    const text = rendered.text ?? "";
    assert.ok(text.includes("Cancelled"), `got: ${text}`);
  });

  it("renderResult shows answered option status", () => {
    const api = createMockExtensionAPI();
    askUser(api as any);
    const tool = api.getCapturedTool();

    const theme = mockTheme();
    const result = {
      content: [{ type: "text", text: "selected" }],
      details: {
        status: "answered",
        question: "Q",
        reason: "R",
        options: ["SQLite", "PostgreSQL"],
        answer: "PostgreSQL",
        wasCustom: false,
        index: 2,
      },
    };

    const rendered = tool.renderResult(result, { expanded: false, isPartial: false }, theme, {});
    const text = rendered.text ?? "";
    assert.ok(text.includes("PostgreSQL"), `got: ${text}`);
  });

  it("renderResult shows answered custom status", () => {
    const api = createMockExtensionAPI();
    askUser(api as any);
    const tool = api.getCapturedTool();

    const theme = mockTheme();
    const result = {
      content: [{ type: "text", text: "custom" }],
      details: {
        status: "answered",
        question: "Q",
        reason: "R",
        options: ["A", "B"],
        answer: "DuckDB",
        wasCustom: true,
      },
    };

    const rendered = tool.renderResult(result, { expanded: false, isPartial: false }, theme, {});
    const text = rendered.text ?? "";
    assert.ok(text.includes("(custom)"), `got: ${text}`);
    assert.ok(text.includes("DuckDB"), `got: ${text}`);
  });

  it("renderResult shows '(no answer)' fallback when answer is missing", () => {
    const api = createMockExtensionAPI();
    askUser(api as any);
    const tool = api.getCapturedTool();

    const theme = mockTheme();
    const result = {
      content: [{ type: "text", text: "?" }],
      details: {
        status: "answered",
        question: "Q",
        reason: "R",
        options: ["A", "B"],
        answer: "",
        wasCustom: false,
      },
    };

    const rendered = tool.renderResult(result, { expanded: false, isPartial: false }, theme, {});
    const text = rendered.text ?? "";
    assert.ok(text.includes("(no answer)"), `got: ${text}`);
  });

  it("execute returns answered when user picks an option", async () => {
    const api = createMockExtensionAPI();
    askUser(api as any);
    const tool = api.getCapturedTool();

    const ctx = createMockCtx({
      select: async (_title: string, options: string[]) => options[1], // PostgreSQL
    });

    const out = await tool.execute("tc1", validParams, undefined, undefined, ctx);

    assert.strictEqual(out.details.status, "answered");
    assert.strictEqual(out.details.answer, "PostgreSQL");
    assert.strictEqual(out.details.wasCustom, false);
    assert.ok(out.content[0].text.includes("PostgreSQL"));
  });

  it("execute returns answered when user provides a custom answer", async () => {
    const api = createMockExtensionAPI();
    askUser(api as any);
    const tool = api.getCapturedTool();

    const ctx = createMockCtx({
      select: async (_title: string, options: string[]) => options[options.length - 1], // custom
      input: async () => "DuckDB",
    });

    const out = await tool.execute("tc2", validParams, undefined, undefined, ctx);

    assert.strictEqual(out.details.status, "answered");
    assert.strictEqual(out.details.answer, "DuckDB");
    assert.strictEqual(out.details.wasCustom, true);
    assert.ok(out.content[0].text.includes("DuckDB"));
  });

  it("execute returns cancelled when user dismisses select", async () => {
    const api = createMockExtensionAPI();
    askUser(api as any);
    const tool = api.getCapturedTool();

    const ctx = createMockCtx({
      select: async () => undefined,
    });

    const out = await tool.execute("tc3", validParams, undefined, undefined, ctx);

    assert.strictEqual(out.details.status, "cancelled");
    assert.strictEqual(out.details.answer, null);
    assert.strictEqual(out.content[0].text, "User cancelled the question.");
  });

  it("execute returns unavailable when UI is not present", async () => {
    const api = createMockExtensionAPI();
    askUser(api as any);
    const tool = api.getCapturedTool();

    const ctx = { ...createMockCtx(), mode: "print", hasUI: false };

    const out = await tool.execute("tc4", validParams, undefined, undefined, ctx);

    assert.strictEqual(out.details.status, "unavailable");
    assert.strictEqual(out.details.answer, null);
    assert.ok(out.content[0].text.includes("unavailable"));
  });

  it("execute throws on duplicate option labels (validation)", async () => {
    const api = createMockExtensionAPI();
    askUser(api as any);
    const tool = api.getCapturedTool();

    const badParams = {
      ...validParams,
      options: [
        { label: "Same", tradeoff: "t1" },
        { label: "Same", tradeoff: "t2" },
      ],
    };

    await assert.rejects(
      async () => tool.execute("tc5", badParams, undefined, undefined, createMockCtx()),
      /unique labels/,
    );
  });

  it("execute returns cancelled when UI primitive throws", async () => {
    const api = createMockExtensionAPI();
    askUser(api as any);
    const tool = api.getCapturedTool();

    const ctx = createMockCtx({
      select: async () => {
        throw new Error("TUI stream closed");
      },
    });

    const out = await tool.execute("tc6", validParams, undefined, undefined, ctx);

    assert.strictEqual(out.details.status, "cancelled");
    assert.strictEqual(out.content[0].text, "User cancelled the question.");
  });
});
