/**
 * ask_user — single important-choice question with tradeoffs
 *
 * Uses Pi's built-in select/input dialogs to present the question and
 * collect the user's answer.  Delegates result mapping to ask_user_host
 * so the pure business logic stays testable.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  askUserHost,
  type AskUserOption,
  type AskUserDetails,
  type AskUserParams as HostAskUserParams,
} from "./ask_user_host";
import { runAskUserDialog, validateAskUserParams } from "./ask_user_dialog";

/* ------------------------------------------------------------------ */
/*  Schema                                                            */
/* ------------------------------------------------------------------ */

const OptionSchema = Type.Object({
  label: Type.String({ description: "Short display label for this option" }),
  tradeoff: Type.String({
    description: "Brief description of the tradeoffs / consequences for this option",
  }),
});

const AskUserParams = Type.Object({
  question: Type.String({ description: "One clear question to ask the user" }),
  reason: Type.String({
    description: "Brief reason this choice matters for the current task",
  }),
  options: Type.Array(OptionSchema, {
    minItems: 2,
    maxItems: 3,
    description:
      "Two or three options with tradeoffs. Each option must have a label and a tradeoff description.",
  }),
  recommendation: Type.Optional(
    Type.String({
      description:
        "Optional recommendation indicating the preferred option and why. Leave empty if you have no clear preference.",
    }),
  ),
});

/* ------------------------------------------------------------------ */
/*  Tool                                                              */
/* ------------------------------------------------------------------ */

export default function askUser(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",

    // Prompt-listing text shown to the model in the Available tools section.
    promptSnippet:
      "Ask the user a single unresolved product choice with 2–3 labeled options and their tradeoffs. " +
      "Returns whether the user answered, cancelled, or the UI was unavailable.",

    description:
      "Ask the user a single important unresolved product choice with 2–3 options and their tradeoffs. " +
      "The user picks one option or writes a custom answer. The tool returns an explicit status: " +
      "'answered' (user chose or wrote an answer), 'cancelled' (user dismissed the dialog or " +
      "submitted an empty custom answer), or 'unavailable' (no interactive UI is present).",

    // Guidelines appended to the system prompt when this tool is active.
    promptGuidelines: [
      "Use ask_user when the user has left an important product choice unresolved (e.g. 'make reminders persist or not, as you think best').",
      "Do NOT use ask_user when the user already specified behavior explicitly, for routine variable names, or when the user delegates the choice to you.",
      "If the result is 'cancelled' or 'unavailable', do not invent an answer. Continue by identifying the exact unresolved requirement in your reasoning.",
      "If the result is 'answered', use the user's exact answer on your next turn without silently overriding it.",
    ],

    parameters: AskUserParams,
    executionMode: "sequential",

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Runtime validation enforces unique labels, non-empty fields, correct count.
      // Schema already enforces type-level constraints; this is defense in depth.
      validateAskUserParams(params);

      return askUserHost(params as HostAskUserParams, {
        hasUI: ctx.mode === "tui" && ctx.hasUI,

        async dialog() {
          try {
            return await runAskUserDialog(params, {
              select: (title, options) => ctx.ui.select(title, options),
              input: (title) => ctx.ui.input(title),
            });
          } catch (_err) {
            // UI primitive crashed or stream closed — treat as cancelled
            // so the model gets a structured result instead of a raw error.
            return null;
          }
        },
      });
    },

    /* ---------------------------------------------------------------- */
    /*  Renderers                                                       */
    /* ---------------------------------------------------------------- */

    renderCall(args, theme, _context) {
      const q = String(args.question ?? "");
      const rec = args.recommendation
        ? ` • Rec: ${args.recommendation}`
        : "";
      const opts = Array.isArray(args.options)
        ? args.options.map((o: AskUserOption, i: number) => `${i + 1}. ${o.label}`)
        : [];
      const optText = opts.length
        ? ` • Options: ${opts.join(", ")}, Write custom answer...`
        : "";
      const text =
        theme.fg("toolTitle", theme.bold("ask_user ")) +
        theme.fg("muted", `${q}${rec}${optText}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme, _context) {
      const details = result.details as AskUserDetails | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      if (details.status === "unavailable") {
        return new Text(theme.fg("warning", "Unavailable (no UI)"), 0, 0);
      }

      if (details.status === "cancelled") {
        return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      }

      if (details.wasCustom) {
        return new Text(
          theme.fg("success", "✓ ") +
            theme.fg("muted", "(custom) ") +
            theme.fg("accent", details.answer ?? ""),
          0,
          0,
        );
      }

      const idx =
        (details.options.indexOf(details.answer ?? "") + 1) ||
        (details.answer ? "?" : "");
      const display = details.answer
        ? `${idx}. ${details.answer}`
        : "(no answer)";
      return new Text(
        theme.fg("success", "✓ ") + theme.fg("accent", display),
        0,
        0,
      );
    },
  });
}
