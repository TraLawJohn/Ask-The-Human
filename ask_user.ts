/**
 * ask_user — single important-choice question with tradeoffs
 *
 * Displays one question, the reason it matters, 2–3 options (each with a
 * tradeoff), and an optional recommendation.  The user picks an option or
 * writes a custom answer.  The tool returns an explicit status:
 *   • "answered"    – user's custom response or the chosen option
 *   • "cancelled"   – user cancels or submits an empty custom response
 *   • "unavailable" – no interactive terminal UI is present
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

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
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface AskUserOption {
  label: string;
  tradeoff: string;
}

type DisplayOption = AskUserOption & { isOther?: boolean };

interface AskUserDetails {
  status: "answered" | "cancelled" | "unavailable";
  question: string;
  reason: string;
  options: string[];
  recommendation?: string;
  answer: string | null;
  wasCustom: boolean | null;
}

/* ------------------------------------------------------------------ */
/*  Tool                                                              */
/* ------------------------------------------------------------------ */

export default function askUser(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the user a single important unresolved product choice with 2–3 options and their tradeoffs. " +
      "Call this tool when the user has left an important choice unresolved (for example, 'Make reminders persist or not, as you think best'). " +
      "DO NOT call this tool when the user has already specified the behavior (for example, 'Keep reminder state only for this session. Do not persist it after the app closes'). " +
      "DO NOT call for routine variable names, explicit requirements, or when the user delegates the choice to you. " +
      "Proceed without questions for explicit requirements or routine reversible details.",
    parameters: AskUserParams,
    executionMode: "sequential",

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      /* ---- non-interactive / no UI → explicit unavailable ----------- */
      if (ctx.mode !== "tui" || !ctx.hasUI) {
        const details: AskUserDetails = {
          status: "unavailable",
          question: params.question,
          reason: params.reason,
          options: params.options.map((o) => o.label),
          recommendation: params.recommendation,
          answer: null,
          wasCustom: null,
        };
        return {
          content: [
            {
              type: "text",
              text: "ask_user unavailable: no interactive terminal UI is present.",
            },
          ],
          details,
        };
      }

      /* ---- option list (including custom) ------------------------- */
      const allOptions: DisplayOption[] = [
        ...params.options,
        { label: "Write custom answer...", tradeoff: "", isOther: true },
      ];

      /* ---- custom TUI --------------------------------------------- */
      const result = await ctx.ui.custom<{
        answer: string;
        wasCustom: boolean;
        index?: number;
      } | null>((tui, theme, _kb, done) => {
        let optionIndex = 0;
        let editMode = false;
        let cachedLines: string[] | undefined;

        const editorTheme: EditorTheme = {
          borderColor: (s) => theme.fg("accent", s),
          selectList: {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
          },
        };
        const editor = new Editor(tui, editorTheme);

        editor.onSubmit = (value) => {
          const trimmed = value.trim();
          if (trimmed) {
            done({ answer: trimmed, wasCustom: true });
          } else {
            /* empty custom answer → back to list (no silent consent) */
            editMode = false;
            editor.setText("");
            refresh();
          }
        };

        function refresh() {
          cachedLines = undefined;
          tui.requestRender();
        }

        function handleInput(data: string) {
          if (editMode) {
            if (matchesKey(data, Key.escape)) {
              editMode = false;
              editor.setText("");
              refresh();
              return;
            }
            editor.handleInput(data);
            refresh();
            return;
          }

          if (matchesKey(data, Key.up)) {
            optionIndex = Math.max(0, optionIndex - 1);
            refresh();
            return;
          }
          if (matchesKey(data, Key.down)) {
            optionIndex = Math.min(allOptions.length - 1, optionIndex + 1);
            refresh();
            return;
          }

          if (matchesKey(data, Key.enter)) {
            const selected = allOptions[optionIndex];
            if (selected.isOther) {
              editMode = true;
              refresh();
            } else {
              done({
                answer: selected.label,
                wasCustom: false,
                index: optionIndex + 1,
              });
            }
            return;
          }

          if (matchesKey(data, Key.escape)) {
            done(null); /* cancelled */
            return;
          }
        }

        /* ---- helpers ----------------------------------------------- */
        function addWrapped(lines: string[], text: string, width: number) {
          lines.push(...wrapTextWithAnsi(text, Math.max(1, width)));
        }

        function addWrappedWithPrefix(
          lines: string[],
          prefix: string,
          text: string,
          width: number,
        ) {
          const prefixWidth = visibleWidth(prefix);
          const renderWidth = Math.max(1, width);
          if (prefixWidth >= renderWidth) {
            addWrapped(lines, prefix + text, width);
            return;
          }
          const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
          const continuationPrefix = " ".repeat(prefixWidth);
          for (let i = 0; i < wrapped.length; i++) {
            lines.push(
              `${i === 0 ? prefix : continuationPrefix}${wrapped[i]}`,
            );
          }
        }

        /* ---- render ------------------------------------------------ */
        function render(width: number): string[] {
          if (cachedLines) return cachedLines;
          const lines: string[] = [];
          const w = Math.max(1, width);

          /* header bar */
          lines.push(theme.fg("accent", "─".repeat(w)));

          /* question */
          addWrappedWithPrefix(lines, " ", theme.fg("text", params.question), w);
          lines.push("");

          /* reason */
          addWrappedWithPrefix(
            lines,
            " ",
            theme.fg("muted", `Why it matters: ${params.reason}`),
            w,
          );

          /* optional recommendation */
          if (params.recommendation) {
            lines.push("");
            addWrappedWithPrefix(
              lines,
              " ",
              theme.fg("accent", `Recommendation: ${params.recommendation}`),
              w,
            );
          }

          lines.push("");

          /* options */
          for (let i = 0; i < allOptions.length; i++) {
            const opt = allOptions[i];
            const selected = i === optionIndex;
            const isOther = opt.isOther === true;
            const prefix = selected ? theme.fg("accent", "> ") : "  ";
            const labelColor = selected || (isOther && editMode) ? "accent" : "text";
            const label = `${i + 1}. ${opt.label}${isOther && editMode ? " ✎" : ""}`;

            addWrappedWithPrefix(lines, prefix, theme.fg(labelColor, label), w);

            if (!isOther && opt.tradeoff) {
              addWrappedWithPrefix(
                lines,
                "     ",
                theme.fg("muted", `Tradeoff: ${opt.tradeoff}`),
                w,
              );
            }
          }

          /* editor when in custom mode */
          if (editMode) {
            lines.push("");
            addWrappedWithPrefix(
              lines,
              " ",
              theme.fg("muted", "Your custom answer:"),
              w,
            );
            for (const line of editor.render(Math.max(1, w - 2))) {
              lines.push(` ${line}`);
            }
          }

          /* footer hint */
          lines.push("");
          if (editMode) {
            addWrappedWithPrefix(
              lines,
              " ",
              theme.fg("dim", "Enter to submit • Esc to go back"),
              w,
            );
          } else {
            addWrappedWithPrefix(
              lines,
              " ",
              theme.fg("dim", "↑↓ navigate • Enter to select • Esc to cancel"),
              w,
            );
          }
          lines.push(theme.fg("accent", "─".repeat(w)));

          cachedLines = lines;
          return lines;
        }

        return {
          render,
          invalidate: () => {
            cachedLines = undefined;
          },
          handleInput,
        };
      });

      /* ---- build result ------------------------------------------- */
      const simpleOptions = params.options.map((o) => o.label);

      if (!result) {
        const details: AskUserDetails = {
          status: "cancelled",
          question: params.question,
          reason: params.reason,
          options: simpleOptions,
          recommendation: params.recommendation,
          answer: null,
          wasCustom: null,
        };
        return {
          content: [{ type: "text", text: "User cancelled the question." }],
          details,
        };
      }

      const details: AskUserDetails = {
        status: "answered",
        question: params.question,
        reason: params.reason,
        options: simpleOptions,
        recommendation: params.recommendation,
        answer: result.answer,
        wasCustom: result.wasCustom,
      };

      if (result.wasCustom) {
        return {
          content: [
            {
              type: "text",
              text: `User provided a custom answer: ${result.answer}`,
            },
          ],
          details,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `User selected option ${result.index}: ${result.answer}`,
          },
        ],
        details,
      };
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
      const display = details.answer ? `${idx}. ${details.answer}` : "";
      return new Text(
        theme.fg("success", "✓ ") + theme.fg("accent", display),
        0,
        0,
      );
    },
  });
}
