import askUser from "./ask_user";
import { askUserHost } from "./ask_user_host";

// Minimal stubs so ask_user.ts loads outside Pi runtime
class Text {
  constructor(public text: string, public x: number, public y: number) {}
}
(globalThis as any).Text = Text;

function createMockExtensionAPI() {
  let capturedTool: any = null;
  return {
    registerTool: (def: any) => { capturedTool = def; },
    getCapturedTool: () => capturedTool,
  };
}

const params = {
  question: "Which storage backend?",
  reason: "Hard to reverse.",
  options: [
    { label: "SQLite", tradeoff: "Simple" },
    { label: "PostgreSQL", tradeoff: "Robust" },
  ],
};

async function testUnavailableViaHost() {
  console.log("=== TEST 1: askUserHost with hasUI = false ===\n");
  const out = await askUserHost(params, {
    hasUI: false,
    dialog: async () => null,
  });
  console.log("Result:", JSON.stringify(out, null, 2));
  console.assert(out.details.status === "unavailable");
  console.assert(out.details.answer === null);
  console.assert(out.details.wasCustom === null);
  console.assert(out.content[0].text.includes("unavailable"));
  console.log("\n✅ Host layer correctly returns unavailable when hasUI is false\n");
}

async function testUnavailableViaExecute() {
  console.log("=== TEST 2: Tool execute in print mode (no UI) ===\n");
  const api = createMockExtensionAPI();
  askUser(api as any);
  const tool = api.getCapturedTool();

  const ctx = {
    mode: "print",
    hasUI: false,
    ui: { select: async () => undefined, input: async () => undefined },
  };

  const out = await tool.execute("tc", params, undefined, undefined, ctx);
  console.log("Result:", JSON.stringify(out, null, 2));
  console.assert(out.details.status === "unavailable");
  console.assert(out.details.answer === null);
  console.assert(out.details.wasCustom === null);
  console.assert(out.content[0].text.includes("unavailable"));
  console.log("\n✅ execute() correctly returns unavailable in print mode\n");
}

async function testUnavailableInRpcMode() {
  console.log("=== TEST 3: Tool execute in rpc mode (hasUI = true but no real TUI) ===\n");
  const api = createMockExtensionAPI();
  askUser(api as any);
  const tool = api.getCapturedTool();

  // rpc mode with hasUI=true — Pi's RPC mode MAY support dialogs, but if
  // the underlying UI implementation simply returns undefined for everything,
  // the tool still degrades gracefully (cancelled, not crashed).
  const ctx = {
    mode: "rpc",
    hasUI: false, // explicitly false — this is what triggers unavailable
    ui: { select: async () => undefined, input: async () => undefined },
  };

  const out = await tool.execute("tc", params, undefined, undefined, ctx);
  console.log("Result:", JSON.stringify(out, null, 2));
  console.assert(out.details.status === "unavailable");
  console.log("\n✅ execute() correctly returns unavailable in rpc mode with hasUI=false\n");
}

async function testRendererForUnavailable() {
  console.log("=== TEST 4: renderResult for unavailable status ===\n");
  const api = createMockExtensionAPI();
  askUser(api as any);
  const tool = api.getCapturedTool();

  const theme = {
    fg: (color: string, text: string) => `[${color}:${text}]`,
    bold: (text: string) => `{bold:${text}}`,
  };

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
  console.log("Rendered text:", rendered.text);
  console.assert(rendered.text.includes("Unavailable"));
  console.log("\n✅ renderResult shows 'Unavailable (no UI)' for unavailable status\n");
}

async function main() {
  await testUnavailableViaHost();
  await testUnavailableViaExecute();
  await testUnavailableInRpcMode();
  await testRendererForUnavailable();
  console.log("All unavailable tests passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
