import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoadedTool {
	name: string;
	description: string;
	active: boolean;
	source: "builtin" | "sdk" | "extension";
	scope: string;
	origin?: string;
	extensionPath?: string;
}

interface ToolGroup {
	scope: string;
	localTools: { name: string; active: boolean }[];
	packages: Map<string, { name: string; active: boolean }[]>;
}

interface ToolStats {
	total: number;
	active: number;
	inactive: number;
	builtin: { total: number; active: number };
	sdk: { total: number; active: number };
	extensions: { total: number; active: number };
}

interface LoadedToolsDetails {
	tools: LoadedTool[];
	stats: ToolStats;
}

const LoadedToolsParams = Type.Object({});
type LoadedToolsParamsType = Record<string, never>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function getPrimeSettings(): Record<string, unknown> {
	const paths = [
		join(homedir(), ".pi", "agent", "prime-settings.json"),
		join(process.cwd(), ".pi", "prime-settings.json"),
	];
	for (const p of paths) {
		try {
			return JSON.parse(readFileSync(p, "utf-8"));
		} catch {
			// continue
		}
	}
	return {};
}

function shouldShowOnStartup(): boolean {
	const settings = getPrimeSettings();
	const toolSettings = settings["pi-tools"] as Record<string, unknown> | undefined;
	if (toolSettings && typeof toolSettings.showOnStartup === "boolean") {
		return toolSettings.showOnStartup;
	}
	return false; // default: do not show on startup
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function toSourceGroup(source: string): "builtin" | "sdk" | "extensions" {
	return source === "extension" ? "extensions" : (source as "builtin" | "sdk");
}

function getAllLoadedTools(allTools: ReturnType<ExtensionAPI["getAllTools"]>, activeNames: Set<string>): LoadedTool[] {
	return allTools.map((tool) => {
		const si = tool.sourceInfo;
		const rawSource = si?.source ?? "";
		const isBuiltin = (si?.path?.startsWith("<") ?? false) || rawSource === "builtin";
		const source = isBuiltin ? "builtin" : rawSource === "sdk" ? "sdk" : "extension";

		let extensionPath: string | undefined;
		if (source === "extension") {
			const origin = si?.origin ?? "top-level";
			if (origin === "package" && rawSource && rawSource !== "local") {
				extensionPath = rawSource;
			} else {
				extensionPath = si?.path || undefined;
			}
		}

		const desc = (tool.description ?? "").split("\n")[0] ?? "";

		return {
			name: tool.name,
			description: desc.trim(),
			active: activeNames.has(tool.name),
			source,
			scope: si?.scope ?? "project",
			origin: si?.origin ?? undefined,
			extensionPath,
		};
	});
}

function getToolGroups(tools: LoadedTool[]): {
	builtin: { active: LoadedTool[]; inactive: LoadedTool[] };
	sdk: { active: LoadedTool[]; inactive: LoadedTool[] };
	extensions: { active: LoadedTool[]; inactive: LoadedTool[] };
} {
	const groups = {
		builtin: { active: [] as LoadedTool[], inactive: [] as LoadedTool[] },
		sdk: { active: [] as LoadedTool[], inactive: [] as LoadedTool[] },
		extensions: { active: [] as LoadedTool[], inactive: [] as LoadedTool[] },
	};
	for (const tool of tools) {
		const target = groups[toSourceGroup(tool.source)];
		(tool.active ? target.active : target.inactive).push(tool);
	}
	return groups;
}

function getToolStats(tools: LoadedTool[]): ToolStats {
	const stats: ToolStats = {
		total: tools.length,
		active: 0,
		inactive: 0,
		builtin: { total: 0, active: 0 },
		sdk: { total: 0, active: 0 },
		extensions: { total: 0, active: 0 },
	};
	for (const tool of tools) {
		stats.active += tool.active ? 1 : 0;
		stats.inactive += tool.active ? 0 : 1;
		const target = stats[toSourceGroup(tool.source)];
		target.total++;
		if (tool.active) target.active++;
	}
	return stats;
}

function formatToolSource(source: string, extensionPath?: string): string {
	if (source === "builtin") return "built-in";
	if (source === "sdk") return "SDK";
	if (source === "extension" && extensionPath) {
		return extensionPath.replace(/\/dist\/index\.js$/, "") || extensionPath;
	}
	return "extension";
}

function getSourceLabel(source: string): string {
	switch (source) {
		case "builtin":
			return "Built-in";
		case "sdk":
			return "SDK";
		case "extension":
			return "Extensions";
	}
	return source;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function buildToolGroups(tools: LoadedTool[]): ToolGroup[] {
	const builtin: ToolGroup = { scope: "builtin", localTools: [], packages: new Map() };
	const project: ToolGroup = { scope: "project", localTools: [], packages: new Map() };
	const user: ToolGroup = { scope: "user", localTools: [], packages: new Map() };
	const path: ToolGroup = { scope: "path", localTools: [], packages: new Map() };

	for (const tool of tools) {
		let group: ToolGroup;
		if (tool.source === "builtin") {
			group = builtin;
		} else if (tool.source === "sdk") {
			group = path;
		} else {
			const scope = tool.scope;
			group = scope === "user" ? user : scope === "project" ? project : path;
		}

		const isPackage = tool.origin === "package" && tool.extensionPath;
		if (isPackage && tool.extensionPath) {
			const list = group.packages.get(tool.extensionPath) ?? [];
			list.push({ name: tool.name, active: tool.active });
			group.packages.set(tool.extensionPath, list);
		} else {
			group.localTools.push({ name: tool.name, active: tool.active });
		}
	}

	return [builtin, project, user, path].filter((g) => g.localTools.length > 0 || g.packages.size > 0);
}

function buildStatsLine(tools: LoadedTool[]): string {
	const total = tools.length;
	const active = tools.filter((t) => t.active).length;
	const extCount = tools.filter((t) => t.source === "extension").length;
	const parts = [`${total} tool${total !== 1 ? "s" : ""}`, `${active} active`];
	if (extCount > 0) {
		parts.push(`${extCount} from extension${extCount !== 1 ? "s" : ""}`);
	}
	return parts.join(" · ");
}

/**
 * Format a loaded-tools list using Pi's native boot-time visual style.
 *
 * When `compact` is true, shows a single line listing tool names.
 * When false (expanded), shows the full listing with scope groups,
 * active indicators, and a stats summary line.
 */
function getExtensionShortName(path: string): string {
	if (path.startsWith("npm:")) {
		return path.slice(4);
	}
	const cleaned = path.replace(/\/dist\/index\.js$/, "").replace(/\/src\/index\.[tj]s$/, "");
	const segments = cleaned.split("/");
	return segments[segments.length - 1] || cleaned;
}

export function formatToolsList(tools: LoadedTool[], theme: Theme, compact = false): string {
	if (compact) {
		const lines: string[] = [];
		lines.push(theme.fg("mdHeading", "\x1b[1m[Tools]\x1b[22m"));

		// Group by source, then by extension path
		const bySource = new Map<string, Map<string, string[]>>();
		for (const tool of tools) {
			const sourceKey = tool.source;
			if (!bySource.has(sourceKey)) {
				bySource.set(sourceKey, new Map());
			}
			const extMap = bySource.get(sourceKey)!;
			const extKey = tool.extensionPath ?? "(local)";
			if (!extMap.has(extKey)) {
				extMap.set(extKey, []);
			}
			extMap.get(extKey)!.push(tool.name);
		}

		// Built-in
		const builtinExts = bySource.get("builtin");
		if (builtinExts) {
			const names = [...builtinExts.values()].flat().sort((a, b) => a.localeCompare(b));
			lines.push(`  ${theme.fg("accent", "built-in")}`);
			lines.push(theme.fg("dim", `    ${names.join(", ")}`));
		}

		// SDK
		const sdkExts = bySource.get("sdk");
		if (sdkExts) {
			const names = [...sdkExts.values()].flat().sort((a, b) => a.localeCompare(b));
			lines.push(`  ${theme.fg("accent", "sdk")}`);
			lines.push(theme.fg("dim", `    ${names.join(", ")}`));
		}

		// Extensions
		const extExts = bySource.get("extension");
		if (extExts) {
			lines.push(`  ${theme.fg("accent", "Extensions")}`);
			const sortedExts = Array.from(extExts.entries()).sort(([a], [b]) => a.localeCompare(b));
			for (const [extPath, names] of sortedExts) {
				const displayName = getExtensionShortName(extPath);
				lines.push(`    ${theme.fg("mdLink", displayName)}`);
				lines.push(theme.fg("dim", `      ${names.sort((a, b) => a.localeCompare(b)).join(", ")}`));
			}
		}

		return lines.join("\n");
	}

	const stats = buildStatsLine(tools);
	const lines: string[] = [];
	lines.push(theme.fg("mdHeading", "[Tools]"));

	const groups = buildToolGroups(tools);
	for (const group of groups) {
		lines.push(`  ${theme.fg("accent", group.scope)}`);
		const sorted = [...group.localTools].sort((a, b) => a.name.localeCompare(b.name));
		for (const tool of sorted) {
			lines.push(theme.fg("dim", `    ${tool.active ? "●" : "○"} ${tool.name}`));
		}
		const sortedPkgs = Array.from(group.packages.entries()).sort(([a], [b]) => a.localeCompare(b));
		for (const [source, pkgTools] of sortedPkgs) {
			lines.push(`    ${theme.fg("mdLink", source)}`);
			const sortedPkgTools = [...pkgTools].sort((a, b) => a.name.localeCompare(b.name));
			for (const tool of sortedPkgTools) {
				lines.push(theme.fg("dim", `      ${tool.active ? "●" : "○"} ${tool.name}`));
			}
		}
	}
	lines.push(theme.fg("dim", `  ${stats}`));
	return lines.join("\n");
}

function formatToolsText(tools: LoadedTool[]): string {
	const groups = getToolGroups(tools);
	const stats = getToolStats(tools);
	const lines: string[] = [];

	lines.push(`# Loaded Tools (${stats.total} total, ${stats.active} active)`);
	lines.push("");

	for (const [source, group] of Object.entries(groups)) {
		if (group.active.length === 0 && group.inactive.length === 0) continue;
		lines.push(`## ${getSourceLabel(source)}`);
		for (const tool of [...group.active, ...group.inactive].sort((a, b) => a.name.localeCompare(b.name))) {
			const status = tool.active ? "●" : "○";
			const src = formatToolSource(tool.source, tool.extensionPath);
			lines.push(`  ${status} **${tool.name}** — ${tool.description || "(no description)"} _(${src})_`);
		}
		lines.push("");
	}

	lines.push(`---`);
	lines.push(`**Summary:** ${stats.total} tools · ${stats.active} active · ${stats.inactive} inactive`);
	lines.push(`- Built-in: ${stats.builtin.total} (${stats.builtin.active} active)`);
	lines.push(`- SDK: ${stats.sdk.total} (${stats.sdk.active} active)`);
	lines.push(`- Extensions: ${stats.extensions.total} (${stats.extensions.active} active)`);

	return lines.join("\n");
}

function showTools(pi: ExtensionAPI, _ctx: ExtensionContext): void {
	const tools = getAllLoadedTools(pi.getAllTools(), new Set(pi.getActiveTools()));
	pi.sendMessage({
		customType: "pi-loaded-tools",
		content: `${tools.length} tools (${tools.filter((t) => t.active).length} active)`,
		display: true,
		details: { tools },
	});
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function setupLoadedToolsTool(pi: ExtensionAPI) {
	pi.registerTool<typeof LoadedToolsParams, LoadedToolsDetails>({
		name: "loaded_tools",
		label: "Loaded Tools",
		description: "List all loaded tools with source provenance and active status",
		promptSnippet: "List all loaded tools",
		promptGuidelines: [
			"Use loaded_tools when the user asks about available tools, tool count, or what extensions provide",
			"loaded_tools shows which tools are active vs inactive and where each tool comes from",
		],

		parameters: LoadedToolsParams,

		async execute(
			_toolCallId: string,
			_params: LoadedToolsParamsType,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<LoadedToolsDetails>> {
			const allTools = pi.getAllTools();
			const activeNames = new Set(pi.getActiveTools());
			const tools = getAllLoadedTools(allTools, activeNames);
			const stats = getToolStats(tools);

			return {
				content: [{ type: "text", text: formatToolsText(tools) }],
				details: { tools, stats },
			};
		},

		renderCall(_args: object, theme: Theme) {
			return new Text(theme.fg("dim", "Loaded Tools"), 0, 0);
		},

		renderResult(result: AgentToolResult<LoadedToolsDetails>, _options: ToolRenderResultOptions, theme: Theme): Text {
			const { details } = result;
			if (!details?.tools) {
				const textBlock = result.content.find((c) => c.type === "text");
				const msg = (textBlock?.type === "text" && textBlock.text) || "No tool data";
				return new Text(theme.fg("error", msg), 0, 0);
			}
			const stats = details.stats;
			const summary = `${stats.total} tools · ${stats.active} active · ${stats.inactive} inactive`;
			return new Text(theme.fg("accent", summary), 0, 0);
		},
	});
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerLoadedToolsCommand(pi: ExtensionAPI) {
	pi.registerCommand("tools", {
		description: "List all loaded tools with source provenance and active status",
		handler: async (_args, ctx) => {
			await Promise.resolve(showTools(pi, ctx));
		},
	});
}

// ---------------------------------------------------------------------------
// Message renderer
// ---------------------------------------------------------------------------

export function registerLoadedToolsRenderer(pi: ExtensionAPI) {
	pi.registerMessageRenderer("pi-loaded-tools", (message, options, theme) => {
		const details = message.details as { tools?: LoadedTool[] } | undefined;
		const tools = details?.tools ?? [];
		const compact = !options?.expanded;
		return new Text(formatToolsList(tools, theme, compact), 0, 0);
	});
}

// ---------------------------------------------------------------------------
// Optional startup display
// ---------------------------------------------------------------------------

export function registerStartupDisplay(pi: ExtensionAPI) {
	let shownAtBoot = false;
	pi.on("session_start", (_event, ctx) => {
		if (shownAtBoot) return;
		shownAtBoot = true;
		if (shouldShowOnStartup()) {
			showTools(pi, ctx);
		}
	});
}
