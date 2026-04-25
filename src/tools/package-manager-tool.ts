import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
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

// ──────────────────────────────────────────────
// Tool 1: detect_package_manager
// ──────────────────────────────────────────────

const DetectParams = Type.Object({});
type DetectParamsType = Record<string, never>;

interface DetectDetails {
	packageManager: string;
	version?: string;
	lockfile?: string;
	installCommand: string;
	runCommand: string;
	cwd: string;
	detectedFrom: string;
	source: "packageManager" | "lockfile" | "default";
}

const LOCKFILES: Record<string, string> = {
	"pnpm-lock.yaml": "pnpm",
	"yarn.lock": "yarn",
	"package-lock.json": "npm",
	"bun.lockb": "bun",
	"bun.lock": "bun",
};

const COMMANDS: Record<string, { install: string; run: string }> = {
	pnpm: { install: "pnpm install", run: "pnpm" },
	yarn: { install: "yarn install", run: "yarn" },
	npm: { install: "npm install", run: "npm run" },
	bun: { install: "bun install", run: "bun run" },
};

function setupDetectPackageManagerTool(pi: ExtensionAPI) {
	pi.registerTool<typeof DetectParams, DetectDetails>({
		name: "detect_package_manager",
		label: "Package Manager",
		description: "Detect the package manager used in the current project by checking lockfiles and package.json",
		promptSnippet: "Detect the package manager for this project",
		promptGuidelines: [
			"Use detect_package_manager when you need to know which package manager (npm, yarn, pnpm, bun) the project uses",
			"detect_package_manager is helpful before running install commands or scripts",
		],

		parameters: DetectParams,

		async execute(
			_toolCallId: string,
			_params: DetectParamsType,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<DetectDetails>> {
			const cwd = ctx.cwd;

			let declaredPm: string | undefined;
			let declaredVersion: string | undefined;
			let declaredPmFrom: string | undefined;
			let lockfile: string | undefined;
			let lockfilePm: string | undefined;
			let lockfileFrom: string | undefined;

			let searchDir = cwd;
			while (true) {
				if (!declaredPm) {
					const pkgPath = path.join(searchDir, "package.json");
					try {
						if (fs.existsSync(pkgPath)) {
							const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
							if (typeof pkg.packageManager === "string") {
								const match = pkg.packageManager.match(/^([^@]+)@?(.*)?$/);
								if (match) {
									declaredPm = match[1];
									declaredVersion = match[2] || undefined;
									declaredPmFrom = pkgPath;
								}
							}
						}
					} catch {
						// Ignore parse errors
					}
				}

				if (!lockfilePm) {
					for (const [filename, pm] of Object.entries(LOCKFILES)) {
						const candidate = path.join(searchDir, filename);
						if (fs.existsSync(candidate)) {
							lockfilePm = pm;
							lockfile = filename;
							lockfileFrom = candidate;
							break;
						}
					}
				}

				if ((declaredPm && lockfilePm) || fs.existsSync(path.join(searchDir, ".git"))) {
					break;
				}
				const parent = path.dirname(searchDir);
				if (parent === searchDir) break;
				searchDir = parent;
			}

			const pm = declaredPm || lockfilePm || "npm";
			const source: DetectDetails["source"] = declaredPm ? "packageManager" : lockfilePm ? "lockfile" : "default";
			const detectedFrom = declaredPmFrom || lockfileFrom || cwd;
			const fallback = { install: `${pm} install`, run: pm };
			const commands = COMMANDS[pm] ?? fallback;

			const parts: string[] = [];
			parts.push(`Package manager: ${pm}`);
			if (declaredVersion) parts.push(`Declared version: ${declaredVersion}`);
			if (lockfile) parts.push(`Lockfile: ${lockfile}`);
			if (source === "default") parts.push("No lockfile or packageManager field found, defaulting to npm");
			parts.push(`Detected from: ${detectedFrom}`);
			parts.push(`Install: ${commands.install}`);
			parts.push(`Run: ${commands.run}`);

			return {
				content: [{ type: "text", text: parts.join("\n") }],
				details: {
					packageManager: pm,
					version: declaredVersion,
					lockfile,
					installCommand: commands.install,
					runCommand: commands.run,
					cwd,
					detectedFrom,
					source,
				},
			};
		},

		renderCall(_args: DetectParamsType, theme: Theme) {
			return new Text(theme.fg("dim", "Detect Package Manager"), 0, 0);
		},

		renderResult(result: AgentToolResult<DetectDetails>, _options: ToolRenderResultOptions, theme: Theme): Text {
			const { details } = result;
			if (!details?.packageManager) {
				const text = result.content[0];
				const msg = text?.type === "text" && text.text ? text.text : "Failed to detect package manager";
				return new Text(theme.fg("error", msg), 0, 0);
			}
			const lines: string[] = [];
			lines.push(theme.fg("success", `Package manager: ${theme.bold(details.packageManager)}`));
			if (details.version) lines.push(theme.fg("dim", `Version: ${details.version}`));
			if (details.lockfile) lines.push(theme.fg("dim", `Lockfile: ${details.lockfile}`));
			if (details.source === "default") lines.push(theme.fg("muted", "No lockfile found, defaulted to npm"));
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}

// ──────────────────────────────────────────────
// Tool 2: pi_package_manager (+ /manage-packages command)
// ──────────────────────────────────────────────

const SETTINGS_PATH = join(homedir(), ".pi/agent/settings.json");

const PiPkgParams = Type.Object({
	action: Type.Optional(
		Type.Union([Type.Literal("scan"), Type.Literal("uninstall"), Type.Literal("reinstall"), Type.Literal("orphans")], {
			description:
				"Action: scan (list all packages with status), uninstall (remove packages), reinstall (re-register orphans), orphans (find untracked npm packages). Default: scan",
		}),
	),
	packages: Type.Optional(
		Type.Array(Type.String(), {
			description: "Package names (npm:-prefixed). Required for uninstall and reinstall actions.",
		}),
	),
});
type PiPkgParamsType = {
	action?: "scan" | "uninstall" | "reinstall" | "orphans";
	packages?: string[];
};

interface PackageEntry {
	name: string;
	npmPackage?: string;
	version?: string;
	status: "installed" | "registered" | "orphaned";
}

interface PiPkgDetails {
	action: string;
	total: number;
	installed: number;
	registered: number;
	orphaned: number;
	uninstalled?: string[];
	failed?: string[];
}

// --- Shared helpers ---

function readPiSettings(): { packages: string[] } {
	try {
		return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
	} catch {
		return { packages: [] };
	}
}

function writePiSettings(settings: { packages: string[] }) {
	writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
}

function getNpmGlobalPackages(): Map<string, string> {
	const pkgs = new Map<string, string>();
	try {
		const raw = execSync("npm ls -g --depth=0 --json", { encoding: "utf-8", timeout: 15_000 });
		const data = JSON.parse(raw);
		const deps = data.dependencies ?? {};
		for (const [name, info] of Object.entries(deps)) {
			pkgs.set(name, (info as { version?: string }).version ?? "unknown");
		}
	} catch {}
	return pkgs;
}

function extractNpmName(prefixed: string): string | undefined {
	return prefixed.startsWith("npm:") ? prefixed.slice(4) : undefined;
}

function isLikelyPiPackage(name: string): boolean {
	const lower = name.toLowerCase();
	if (lower === "@mariozechner/pi-coding-agent") return false;
	return lower.includes("pi-") || lower.includes("pi_") || lower.includes("/pi-") || lower.includes("/pi_");
}

function scanPiPackages(): PackageEntry[] {
	const settings = readPiSettings();
	const npmGlobals = getNpmGlobalPackages();
	const entries: PackageEntry[] = [];

	for (const pkg of settings.packages) {
		const npmName = extractNpmName(pkg);
		if (npmName) {
			const version = npmGlobals.get(npmName);
			entries.push({ name: pkg, npmPackage: npmName, version, status: version ? "installed" : "registered" });
		} else {
			entries.push({ name: pkg, status: "registered" });
		}
	}

	const settingsNpmNames = new Set(settings.packages.filter((p) => p.startsWith("npm:")).map((p) => p.slice(4)));
	for (const [npmName, version] of npmGlobals) {
		if (!settingsNpmNames.has(npmName) && isLikelyPiPackage(npmName)) {
			entries.push({ name: `npm:${npmName}`, npmPackage: npmName, version, status: "orphaned" });
		}
	}

	return entries;
}

function doUninstall(packageNames: string[]): { uninstalled: string[]; failed: string[] } {
	const settings = readPiSettings();
	const uninstalled: string[] = [];
	const failed: string[] = [];

	for (const pkg of packageNames) {
		if (!settings.packages.includes(pkg)) {
			failed.push(`${pkg} — not found in settings`);
			continue;
		}
		settings.packages = settings.packages.filter((p) => p !== pkg);

		const npmName = extractNpmName(pkg);
		if (npmName) {
			try {
				execSync(`npm uninstall -g ${npmName}`, { encoding: "utf-8", timeout: 60_000 });
			} catch (e) {
				failed.push(`${pkg} — npm uninstall failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		uninstalled.push(pkg);
	}

	writePiSettings(settings);
	return { uninstalled, failed };
}

function doReinstall(packageNames: string[]): { reinstalled: string[]; failed: string[] } {
	const settings = readPiSettings();
	const reinstalled: string[] = [];
	const failed: string[] = [];

	for (const pkg of packageNames) {
		if (settings.packages.includes(pkg)) {
			failed.push(`${pkg} — already in settings`);
			continue;
		}
		settings.packages.push(pkg);

		const npmName = extractNpmName(pkg);
		if (npmName) {
			try {
				execSync(`npm install -g ${npmName}@latest`, { encoding: "utf-8", timeout: 60_000 });
			} catch (e) {
				failed.push(`${pkg} — npm install failed: ${e instanceof Error ? e.message : String(e)}`);
				continue;
			}
		}
		reinstalled.push(pkg);
	}

	writePiSettings(settings);
	return { reinstalled, failed };
}

function setupPiPackageManagerTool(pi: ExtensionAPI) {
	// --- Agent tool ---

	pi.registerTool<typeof PiPkgParams, PiPkgDetails>({
		name: "pi_package_manager",
		label: "Pi Package Manager",
		description:
			"Scan installed Pi packages, find orphaned npm packages, re-register or bulk-uninstall them. " +
			"Actions: 'scan' (list all packages with status), 'orphans' (show npm packages not in settings), " +
			"'reinstall' (re-register orphaned packages back to settings), 'uninstall' (remove packages — provide names in 'packages' param).",
		promptSnippet: "Scan installed Pi packages",
		promptGuidelines: [
			"Use pi_package_manager to audit and manage installed Pi packages.",
			"Action 'scan' (default) lists all packages from settings.json with their npm install status and version.",
			"Action 'orphans' shows npm-global packages that look like Pi packages but aren't in settings.json.",
			"Action 'reinstall' re-registers orphaned packages back into settings.json and updates npm global to latest. Provide package names (npm:-prefixed) in the 'packages' array.",
			"Action 'uninstall' removes packages from settings.json AND runs npm uninstall -g. Provide package names (npm:-prefixed) in the 'packages' array.",
			"⚠️ Uninstall is destructive. Always show the user what will be removed and confirm before calling uninstall.",
			"Git and local packages are marked as 'registered' — they don't have a matching npm global install.",
		],

		parameters: PiPkgParams,

		async execute(
			_toolCallId: string,
			params: PiPkgParamsType,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
		): Promise<AgentToolResult<PiPkgDetails>> {
			const action = params.action ?? "scan";

			switch (action) {
				case "scan": {
					const entries = scanPiPackages();
					const installed = entries.filter((e) => e.status === "installed");
					const registered = entries.filter((e) => e.status === "registered");
					const orphaned = entries.filter((e) => e.status === "orphaned");

					let text = `Pi Package Scan (${entries.length} total)\n─────────────────────────\n`;
					if (installed.length > 0) {
						text += `\nInstalled (${installed.length}):\n`;
						for (const e of installed) text += `  ✅ ${e.name} @${e.version ?? "?"}\n`;
					}
					if (registered.length > 0) {
						text += `\nRegistered only (${registered.length}):\n`;
						for (const e of registered) text += `  📋 ${e.name}${e.version ? ` @${e.version}` : ""}\n`;
					}
					if (orphaned.length > 0) {
						text += `\nOrphaned npm packages (${orphaned.length}):\n`;
						for (const e of orphaned) text += `  ⚠️ ${e.npmPackage} @${e.version ?? "?"}\n`;
					}

					return {
						content: [{ type: "text", text }],
						details: {
							action: "scan",
							total: entries.length,
							installed: installed.length,
							registered: registered.length,
							orphaned: orphaned.length,
						},
					};
				}

				case "orphans": {
					const entries = scanPiPackages().filter((e) => e.status === "orphaned");
					if (entries.length === 0) {
						return {
							content: [{ type: "text", text: "No orphaned Pi packages found." }],
							details: { action: "orphans", total: 0, installed: 0, registered: 0, orphaned: 0 },
						};
					}
					let text = `Orphaned Pi packages (${entries.length}):\n`;
					for (const e of entries) text += `  ${e.npmPackage} @${e.version ?? "?"}\n`;
					text += `\nTo remove: pi_package_manager action "uninstall" packages: [${entries.map((e) => `"${e.name}"`).join(", ")}]`;
					text += `\nTo re-register: pi_package_manager action "reinstall" packages: [${entries.map((e) => `"${e.name}"`).join(", ")}]`;
					return {
						content: [{ type: "text", text }],
						details: {
							action: "orphans",
							total: entries.length,
							installed: 0,
							registered: 0,
							orphaned: entries.length,
						},
					};
				}

				case "reinstall": {
					const targets = params.packages ?? [];
					if (targets.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: "No packages specified. Provide orphaned package names in the 'packages' parameter.",
								},
							],
							details: {
								action: "reinstall",
								total: 0,
								installed: 0,
								registered: 0,
								orphaned: 0,
								uninstalled: [],
								failed: [],
							},
						};
					}
					const result = doReinstall(targets);
					let text = `Reinstall results:\n`;
					if (result.reinstalled.length > 0) text += `  Re-registered: ${result.reinstalled.join(", ")}\n`;
					if (result.failed.length > 0) text += `  Failed: ${result.failed.join("; ")}\n`;
					return {
						content: [{ type: "text", text }],
						details: {
							action: "reinstall",
							total: targets.length,
							installed: 0,
							registered: 0,
							orphaned: 0,
							uninstalled: result.reinstalled,
							failed: result.failed,
						},
					};
				}

				case "uninstall": {
					const targets = params.packages ?? [];
					if (targets.length === 0) {
						return {
							content: [
								{ type: "text", text: "No packages specified. Provide package names in the 'packages' parameter." },
							],
							details: {
								action: "uninstall",
								total: 0,
								installed: 0,
								registered: 0,
								orphaned: 0,
								uninstalled: [],
								failed: [],
							},
						};
					}
					const result = doUninstall(targets);
					let text = `Uninstall results:\n`;
					if (result.uninstalled.length > 0) text += `  Removed: ${result.uninstalled.join(", ")}\n`;
					if (result.failed.length > 0) text += `  Failed: ${result.failed.join("; ")}\n`;
					return {
						content: [{ type: "text", text }],
						details: {
							action: "uninstall",
							total: targets.length,
							installed: 0,
							registered: 0,
							orphaned: 0,
							uninstalled: result.uninstalled,
							failed: result.failed,
						},
					};
				}

				default: {
					return {
						content: [{ type: "text", text: `Unknown action. Use 'scan', 'orphans', 'reinstall', or 'uninstall'.` }],
						details: { action: params.action ?? "unknown", total: 0, installed: 0, registered: 0, orphaned: 0 },
					};
				}
			}
		},

		renderCall(args: PiPkgParamsType, theme: Theme) {
			const action = args.action ?? "scan";
			const suffix =
				(action === "uninstall" || action === "reinstall") && args.packages?.length
					? ` (${args.packages.length} packages)`
					: "";
			return new Text(theme.fg("dim", `Pi Package Manager: ${action}${suffix}`), 0, 0);
		},

		renderResult(result: AgentToolResult<PiPkgDetails>, _options: ToolRenderResultOptions, theme: Theme) {
			const { details } = result;
			const textBlock = result.content.find((c) => c.type === "text");
			const msg = (textBlock?.type === "text" && textBlock.text) || "Done";
			if (!details) return new Text(theme.fg("dim", msg), 0, 0);
			if (details.failed && details.failed.length > 0) return new Text(theme.fg("error", msg), 0, 0);
			if (details.orphaned > 0)
				return new Text(theme.fg("warning", `${details.total} packages, ${details.orphaned} orphaned`), 0, 0);
			return new Text(theme.fg("accent", msg), 0, 0);
		},
	});

	// --- /manage-packages command ---

	pi.registerCommand("manage-packages", {
		description: "Scan and manage installed Pi packages",
		handler: async (_rawArgs, ctx) => {
			const entries = scanPiPackages();
			const installed = entries.filter((e) => e.status === "installed");
			const registered = entries.filter((e) => e.status === "registered");
			const orphaned = entries.filter((e) => e.status === "orphaned");

			if (entries.length === 0) {
				ctx.ui.notify("No Pi packages found in settings.", "info");
				return;
			}

			// Show summary
			let summary = `Pi Packages (${entries.length} total)\n──────────────────────\n`;
			if (installed.length > 0) {
				summary += `\nInstalled (${installed.length}):\n`;
				for (const e of installed) summary += `  ✅ ${e.name} @${e.version ?? "?"}\n`;
			}
			if (registered.length > 0) {
				summary += `\nRegistered (${registered.length}):\n`;
				for (const e of registered) summary += `  📋 ${e.name}${e.version ? ` @${e.version}` : ""}\n`;
			}
			if (orphaned.length > 0) {
				summary += `\nOrphaned (${orphaned.length}):\n`;
				for (const e of orphaned) summary += `  ⚠️ ${e.npmPackage} @${e.version ?? "?"}\n`;
			}
			ctx.ui.notify(summary, "info");

			// Build flat menu
			const tracked = [...installed, ...registered];
			const options: string[] = [];

			if (orphaned.length > 0) {
				options.push(`Remove orphans individually (${orphaned.length})`);
				options.push(`Remove all orphans (${orphaned.length})`);
				options.push(`Re-register orphans individually (${orphaned.length})`);
				options.push(`Re-register all orphans (${orphaned.length})`);
			}
			if (tracked.length > 0) {
				options.push(`Remove installed package (${tracked.length})`);
			}
			options.push("Cancel");

			const choice = await ctx.ui.select("Pi Package Manager", options);
			if (!choice || choice === "Cancel") return;

			// --- Remove orphans individually ---
			if (choice.startsWith("Remove orphans individually")) {
				const orphanLabels = orphaned.map((e) => `${e.npmPackage} @${e.version ?? "?"}`);
				const selected = await ctx.ui.select("Select orphan to remove", [...orphanLabels, "Cancel"]);
				if (!selected || selected === "Cancel") return;
				const target = orphaned[orphanLabels.indexOf(selected)];
				if (!target) return;
				const confirm = await ctx.ui.confirm(`Remove ${target.npmPackage}?`, "This will uninstall it from npm global.");
				if (!confirm) return;
				const result = doUninstall([target.name]);
				ctx.ui.notify(
					result.uninstalled.length > 0
						? `Removed: ${result.uninstalled.join(", ")}`
						: `Failed: ${result.failed.join("; ")}`,
					result.failed.length > 0 ? "error" : "info",
				);
				return;
			}

			// --- Remove all orphans ---
			if (choice.startsWith("Remove all orphans")) {
				const orphanLabels = orphaned.map((e) => `${e.npmPackage} @${e.version ?? "?"}`);
				const confirm = await ctx.ui.confirm(`Remove ${orphaned.length} orphaned package(s)?`, orphanLabels.join("\n"));
				if (!confirm) return;
				const result = doUninstall(orphaned.map((e) => e.name));
				const msg = [];
				if (result.uninstalled.length > 0) msg.push(`Removed: ${result.uninstalled.join(", ")}`);
				if (result.failed.length > 0) msg.push(`Failed: ${result.failed.join("; ")}`);
				ctx.ui.notify(msg.join("\n") || "Done.", result.failed.length > 0 ? "warning" : "info");
				return;
			}

			// --- Re-register orphans individually ---
			if (choice.startsWith("Re-register orphans individually")) {
				const orphanLabels = orphaned.map((e) => `${e.npmPackage} @${e.version ?? "?"}`);
				const selected = await ctx.ui.select("Select orphan to re-register", [...orphanLabels, "Cancel"]);
				if (!selected || selected === "Cancel") return;
				const target = orphaned[orphanLabels.indexOf(selected)];
				if (!target) return;
				const result = doReinstall([target.name]);
				ctx.ui.notify(
					result.reinstalled.length > 0
						? `Re-registered: ${result.reinstalled.join(", ")}`
						: `Failed: ${result.failed.join("; ")}`,
					result.failed.length > 0 ? "error" : "info",
				);
				return;
			}

			// --- Re-register all orphans ---
			if (choice.startsWith("Re-register all orphans")) {
				const orphanLabels = orphaned.map((e) => `${e.npmPackage} @${e.version ?? "?"}`);
				const confirm = await ctx.ui.confirm(
					`Re-register ${orphaned.length} orphaned package(s) in settings.json?`,
					orphanLabels.join("\n"),
				);
				if (!confirm) return;
				const result = doReinstall(orphaned.map((e) => e.name));
				const msg = [];
				if (result.reinstalled.length > 0) msg.push(`Re-registered: ${result.reinstalled.join(", ")}`);
				if (result.failed.length > 0) msg.push(`Failed: ${result.failed.join("; ")}`);
				ctx.ui.notify(msg.join("\n") || "Done.", result.failed.length > 0 ? "warning" : "info");
				return;
			}

			// --- Remove installed package ---
			if (choice.startsWith("Remove installed package")) {
				const trackedLabels = tracked.map((e) => (e.version ? `${e.name} @${e.version}` : e.name));
				const selected = await ctx.ui.select("Select package to uninstall", [...trackedLabels, "Cancel"]);
				if (!selected || selected === "Cancel") return;
				const target = tracked[trackedLabels.indexOf(selected)];
				if (!target) return;
				const confirm = await ctx.ui.confirm(
					`Uninstall ${target.name}?`,
					"This will remove it from settings and run npm uninstall -g.",
				);
				if (!confirm) return;
				const result = doUninstall([target.name]);
				ctx.ui.notify(
					result.uninstalled.length > 0
						? `Uninstalled: ${result.uninstalled.join(", ")}`
						: `Failed: ${result.failed.join("; ")}`,
					result.failed.length > 0 ? "error" : "info",
				);
				return;
			}
		},
	});
}

// ──────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────

export function setupPackageManagerTool(pi: ExtensionAPI) {
	setupDetectPackageManagerTool(pi);
	setupPiPackageManagerTool(pi);
}
