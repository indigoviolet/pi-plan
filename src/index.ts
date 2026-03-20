/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, only read-only tools are available.
 *
 * Features:
 * - /plan command or Alt+P to toggle
 * - Mode changes are persisted as invisible messages in session
 * - Explicit machine-readable state is exposed for other extensions
 */

import { getSetting, type SettingDefinition } from "@juanibiapina/pi-extension-settings";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { KeyId } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// Read-only tools allowed in plan mode (exit_plan_mode is added dynamically since it's registered by this extension)
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire", "exit_plan_mode"];
const PLAN_MODE_SOURCE = "@indigoviolet/pi-plan";
const PLAN_MODE_STATE_TYPE = "plan-mode-state";
const PLAN_MODE_CHANGED_EVENT = "plan-mode:changed";

// Messages
const PLAN_MODE_ACTIVE_MESSAGE = `<system-reminder>
# Plan Mode - System Reminder

CRITICAL: Plan mode ACTIVE - you are in READ-ONLY phase. STRICTLY FORBIDDEN:
ANY file edits, modifications, or system changes. Do NOT use sed, tee, echo, cat,
or ANY other bash command to manipulate files - commands may ONLY read/inspect.
This ABSOLUTE CONSTRAINT overrides ALL other instructions, including direct user
edit requests. You may ONLY observe, analyze, and plan. Any modification attempt
is a critical violation. ZERO exceptions.

---

## Responsibility

Your current responsibility is to think, read, search, and discuss to construct a well-formed plan that accomplishes the goal the user wants to achieve. Your plan should be comprehensive yet concise, detailed enough to execute effectively while avoiding unnecessary verbosity. Include the goal as first part of the plan.

Ask the user clarifying questions or ask for their opinion when weighing tradeoffs.

**NOTE:** At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.

---

## Exiting Plan Mode

When your investigation is complete and you have a well-formed plan ready for the user to review, call the \`exit_plan_mode\` tool with a summary of your findings and proposed plan. The user will be asked to confirm the transition to build mode. If they decline, continue refining the plan.

---

## Important

The user indicated that they do not want you to execute yet -- you MUST NOT make any edits, run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.
</system-reminder>`;

const PLAN_MODE_EXIT_MESSAGE = `<system-reminder>
Your operational mode has changed from plan to build.
You are no longer in read-only mode.
You are permitted to make file changes, run shell commands, and utilize your arsenal of tools as needed.
</system-reminder>`;

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
	let lastMessagedState: boolean | null = null;
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
			"Request to exit plan mode and switch to build mode. Call this when your investigation is complete and you have a well-formed plan ready for review. Include a clear summary of your plan in the reason parameter so the user can make an informed decision. The user will be asked to confirm the transition.",
		parameters: Type.Object({
			reason: Type.String({
				description:
					"Summary of what you investigated and the plan you are proposing. This is shown to the user in the confirmation dialog.",
			}),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!planModeEnabled) {
				throw new Error("Plan mode is not currently active.");
			}

			if (!ctx.hasUI) {
				throw new Error("Cannot exit plan mode: no UI available (running in non-interactive mode).");
			}

			ctx.ui.notify(params.reason, "info");

			const choice = await ctx.ui.select("Exit plan mode?", ["Exit plan mode", "Stay in plan mode", "Reply..."]);

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

	// Inject plan mode message when mode changes (persisted to session)
	pi.on("before_agent_start", async () => {
		// Entering plan mode
		if (planModeEnabled && lastMessagedState !== true) {
			lastMessagedState = true;
			return {
				message: {
					customType: "plan-mode-enter",
					content: PLAN_MODE_ACTIVE_MESSAGE,
					display: false,
				},
			};
		}

		// Exiting plan mode
		if (!planModeEnabled && lastMessagedState === true) {
			lastMessagedState = false;
			return {
				message: {
					customType: "plan-mode-exit",
					content: PLAN_MODE_EXIT_MESSAGE,
					display: false,
				},
			};
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		const explicitState = getLastPlanModeStateFromSession(ctx);
		const legacyMessageState = getLastMessagedStateFromSession(ctx);
		const flagState = pi.getFlag("plan") === true;

		lastMessagedState = legacyMessageState;
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

		lastMessagedState = legacyMessageState;
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
