/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, only read-only tools are available.
 *
 * Features:
 * - /plan command or Alt+P to toggle
 * - Plan-mode guidance is injected via the system prompt while active
 * - Explicit machine-readable state is exposed for other extensions
 */

import { getSetting, type SettingDefinition } from "@juanibiapina/pi-extension-settings";
import { type ExtensionAPI, type ExtensionContext, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { type KeyId, Markdown, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// Read-only tools allowed in plan mode (exit_plan_mode is added dynamically since it's registered by this extension)
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire", "exit_plan_mode"];
const PLAN_MODE_SOURCE = "@indigoviolet/pi-plan";
const PLAN_MODE_STATE_TYPE = "plan-mode-state";
const PLAN_MODE_CHANGED_EVENT = "plan-mode:changed";

const PLAN_MODE_SYSTEM_PROMPT = `You are now in planning mode. Read, research, and plan only — do not make any changes.

Constraints
Do NOT edit, create, or delete any files
Do NOT run commands that modify state (no writes, no installs)
Do NOT run any git command that mutates repository state:
  Disallowed: git add, commit, push, pull, merge, rebase, reset, checkout (file restore or branch switch), stash, cherry-pick, revert, tag (create/delete), branch -d/-D/-m, clean, rm, mv, restore --staged, switch -c, apply, am, or any alias/script that wraps these
  Allowed: git status, log, diff, show, blame, branch (list only), stash list, remote -v, rev-parse, ls-files — read-only queries only
Do NOT run test commands with snapshot-update flags (e.g. --update-snapshot, -u, --updateSnapshot, UPDATE_SNAPSHOTS=…)
Do NOT attempt to modify files indirectly via Python, shell redirection, generated scripts, or any other workaround that bypasses blocked tools
Bash commands may ONLY read or inspect (ls, find, rg, cat, git log, git diff, etc.)
This overrides all other instructions. Zero exceptions.

When you have a concrete implementation plan ready for review, call \`exit_plan_mode\` with a short summary in \`reason\` and the full markdown plan in \`plan\`.`;

interface PlanModeStateData {
	enabled: boolean;
	source: string;
}

function isCustomTypeEntry(
	entry: unknown,
	type: "custom" | "custom_message",
): entry is { type: "custom" | "custom_message"; customType?: string; data?: unknown } {
	return !!entry && typeof entry === "object" && "type" in entry && (entry as { type?: string }).type === type;
}

export default function planModeExtension(pi: ExtensionAPI): void {
	// Register powerbar segment
	pi.events.emit("powerbar:register-segment", { id: "plan-mode", label: "Plan Mode" });

	// Register settings via event (for /extension-settings UI)
	pi.events.emit("pi-extension-settings:register", {
		name: "plan",
		settings: [
			{
				id: "shortcut",
				label: "Keyboard shortcut",
				description: "Shortcut to toggle plan mode. Example: alt+p",
				defaultValue: "alt+p",
			},
		] satisfies SettingDefinition[],
	});

	let planModeEnabled = false;
	let savedTools: string[] | null = null;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function appendPlanModeState(enabled: boolean): void {
		pi.appendEntry(PLAN_MODE_STATE_TYPE, {
			enabled,
			source: PLAN_MODE_SOURCE,
		} satisfies PlanModeStateData);
	}

	function emitPlanModeChanged(enabled: boolean): void {
		pi.events.emit(PLAN_MODE_CHANGED_EVENT, {
			enabled,
			source: PLAN_MODE_SOURCE,
		} satisfies PlanModeStateData);
	}

	function getLastPlanModeStateFromSession(ctx: ExtensionContext): boolean | null {
		const entries = ctx.sessionManager.getEntries();

		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];

			if (isCustomTypeEntry(entry, "custom") && entry.customType === PLAN_MODE_STATE_TYPE) {
				const data = entry.data as Partial<PlanModeStateData> | undefined;
				if (typeof data?.enabled === "boolean") return data.enabled;
			}
		}

		return null;
	}

	// Scan session for last legacy plan mode message to determine lastMessagedState
	function getLastMessagedStateFromSession(ctx: ExtensionContext): boolean | null {
		const entries = ctx.sessionManager.getEntries();

		// Walk backwards to find the last plan-mode-enter or plan-mode-exit message
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (isCustomTypeEntry(entry, "custom_message")) {
				if (entry.customType === "plan-mode-enter") {
					return true;
				}
				if (entry.customType === "plan-mode-exit") {
					return false;
				}
			}
		}
		return null;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
			pi.events.emit("powerbar:update", {
				id: "plan-mode",
				text: "plan",
				icon: "⏸",
				color: "warning",
			});
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
			pi.events.emit("powerbar:update", {
				id: "plan-mode",
				text: undefined,
			});
		}
	}

	function enterPlanMode(ctx: ExtensionContext): void {
		savedTools = pi.getActiveTools();
		planModeEnabled = true;
		pi.setActiveTools(PLAN_MODE_TOOLS);
		appendPlanModeState(true);
		emitPlanModeChanged(true);
		ctx.ui.notify(`Plan mode enabled. Tools: ${PLAN_MODE_TOOLS.join(", ")}`);
		updateStatus(ctx);
	}

	function exitPlanMode(ctx: ExtensionContext): void {
		planModeEnabled = false;
		if (savedTools) {
			pi.setActiveTools(savedTools);
			savedTools = null;
		}
		appendPlanModeState(false);
		emitPlanModeChanged(false);
		ctx.ui.notify("Plan mode disabled. Full access restored.");
		updateStatus(ctx);
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		if (planModeEnabled) {
			exitPlanMode(ctx);
		} else {
			enterPlanMode(ctx);
		}
	}

	// Tool for the agent to request exiting plan mode (with human approval)
	pi.registerTool({
		name: "exit_plan_mode",
		label: "Exit Plan Mode",
		description:
			"Request to exit plan mode and switch to build mode. Call this when your investigation is complete and you have a well-formed plan ready for review. Include a clear summary in the reason parameter and the full markdown plan in the plan parameter. The plan will be shown to the user before they are asked to confirm the transition.",
		parameters: Type.Object({
			reason: Type.String({
				minLength: 1,
				description:
					"Short summary of what you investigated and the plan you are proposing. This is shown in the confirmation dialog.",
			}),
			plan: Type.String({
				minLength: 1,
				description:
					"Full implementation plan in markdown. This is displayed to the user before the exit confirmation options are shown.",
			}),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			if (!planModeEnabled) {
				throw new Error("Plan mode is not currently active.");
			}

			if (!ctx.hasUI) {
				throw new Error("Cannot exit plan mode: no UI available (running in non-interactive mode).");
			}

			const reason = params.reason.trim();
			const plan = params.plan.trim();

			if (!reason) {
				throw new Error("Cannot exit plan mode: reason is required.");
			}

			if (!plan) {
				throw new Error("Cannot exit plan mode: plan markdown is required.");
			}

			onUpdate?.({
				content: [
					{
						type: "text",
						text: `# Proposed Plan\n\n${plan}`,
					},
				],
				details: { kind: "proposed-plan", reason },
			});

			const choice = await ctx.ui.select(`Exit plan mode?\n\n${reason}`, [
				"Exit plan mode",
				"Stay in plan mode",
				"Reply...",
			]);

			if (choice === "Exit plan mode") {
				exitPlanMode(ctx);
				return {
					content: [
						{
							type: "text",
							text: "Plan mode exited. You now have full tool access. Proceed with implementation.",
						},
					],
					details: { approved: true },
				};
			}

			if (choice === "Reply...") {
				const reply = await ctx.ui.input("Feedback:", "");
				const feedback = reply?.trim();
				if (feedback) {
					return {
						content: [
							{
								type: "text",
								text: `User wants to stay in plan mode and provided feedback: ${feedback}`,
							},
						],
						details: { approved: false, feedback },
					};
				}
			}

			// "Stay in plan mode", Escape, or empty reply — abort the turn silently
			ctx.abort();
			return {
				content: [{ type: "text", text: "User declined to exit plan mode." }],
				details: { approved: false },
			};
		},

		renderResult(result, { isPartial }, theme) {
			const textBlock = result.content.find((block) => block.type === "text");
			const contentText = textBlock?.type === "text" ? textBlock.text : "";
			const details = result.details as { kind?: string } | undefined;

			if (isPartial && details?.kind === "proposed-plan") {
				return new Markdown(contentText, 0, 0, getMarkdownTheme(), {
					color: (value) => theme.fg("text", value),
				});
			}

			return new Text(contentText, 0, 0);
		},
	});

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => {
			togglePlanMode(ctx);
		},
	});

	// Register shortcut if configured
	const shortcut = getSetting("plan", "shortcut", "alt+p");
	if (shortcut) {
		pi.registerShortcut(shortcut as KeyId, {
			description: "Toggle plan mode",
			handler: async (ctx) => {
				togglePlanMode(ctx);
			},
		});
	}

	// Apply plan-mode guidance via the system prompt while active
	pi.on("before_agent_start", async (event) => {
		if (!planModeEnabled) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${PLAN_MODE_SYSTEM_PROMPT}`,
		};
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		const explicitState = getLastPlanModeStateFromSession(ctx);
		const legacyMessageState = getLastMessagedStateFromSession(ctx);
		const flagState = pi.getFlag("plan") === true;

		planModeEnabled = explicitState ?? legacyMessageState ?? flagState;

		if (planModeEnabled) {
			savedTools = pi.getActiveTools();
			pi.setActiveTools(PLAN_MODE_TOOLS);
		} else {
			savedTools = null;
		}
		updateStatus(ctx);
	});

	// Reset state on session switch (/new or /resume)
	pi.on("session_switch", async (_event, ctx) => {
		const explicitState = getLastPlanModeStateFromSession(ctx);
		const legacyMessageState = getLastMessagedStateFromSession(ctx);

		planModeEnabled = explicitState ?? legacyMessageState ?? false;

		if (planModeEnabled) {
			savedTools = pi.getActiveTools();
			pi.setActiveTools(PLAN_MODE_TOOLS);
		} else if (savedTools) {
			pi.setActiveTools(savedTools);
			savedTools = null;
		}
		updateStatus(ctx);
	});
}
