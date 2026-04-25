import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

// --- Constants ---

const SETTINGS_PATH = join(homedir(), ".pi/agent/settings.json");

// --- Schema ---

const PackageManagerParams = Type.Object({
	action: Type.Optional(
		Type.Union([
			Type.Literal("scan"),
			Type.Literal("uninstall"),
			Type.Literal("reinstall"),
			Type.Literal("orphans"),
		], { description: "Action: scan (list all packages with status), uninstall (remove packages by name), reinstall (re-register orphaned packages back to settings), orphans (find npm packages not in settings). Default: scan" }),
	),
	packages: Type.Optional(
		Type.Array(Type.String(), { description: "Package names (npm:-prefixed). Required for uninstall and reinstall actions." }),
	),
});
type PackageManagerParamsType = {
	action?: "scan" | "uninstall" | "reinstall" | "orphans";
	packages?: string[];
};

// --- Types ---

interface PackageEntry {
	name: string;           // e.g. "npm:pi-cmux" or "git:github.com/user/repo"
	npmPackage?: string;    // e.g. "pi-cmux" (extracted from npm: prefix)
	version?: string;       // from npm ls if available
	status: "installed" | "registered" | "orphaned";
	// installed = in settings + npm global present
	// registered = in settings + npm global missing (git/local packages or npm not yet installed)
	// orphaned = not in settings + npm global present
}

interface PackageManagerDetails {
	action: string;
	total: number;
	installed: number;
	registered: number;
	orphaned: number;
	uninstalled?: string[];
	failed?: string[];
}

// --- Helpers ---

function readSettings(): { packages: string[] } {
	try {
		return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
	} catch {
		return { packages: [] };
	}
}

function writeSettings(settings: { packages: string[] }) {
	writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

function getNpmGlobalPackages(): Map<string, string> {
	const pkgs = new Map<string, string>();
	try {
		const raw = execSync("npm ls -g --depth=0 --json", {
			encoding: "utf-8",
			timeout: 15_000,
		});
		const data = JSON.parse(raw);
		const deps = data.dependencies ?? {};
		for (const [name, info] of Object.entries(deps)) {
			const ver = (info as { version?: string }).version ?? "unknown";
			pkgs.set(name, ver);
		}
	} catch {
		// npm may be unavailable or produce warnings in JSON output
	}
	return pkgs;
}

function extractNpmPackageName(prefixed: string): string | undefined {
	if (prefixed.startsWith("npm:")) {
		return prefixed.slice(4);
	}
	return undefined;
}

function scanPackages(): PackageEntry[] {
	const settings = readSettings();
	const npmGlobals = getNpmGlobalPackages();
	const entries: PackageEntry[] = [];

	// Packages in settings
	for (const pkg of settings.packages) {
		const npmName = extractNpmPackageName(pkg);
		if (npmName) {
			const version = npmGlobals.get(npmName);
			entries.push({
				name: pkg,
				npmPackage: npmName,
				version,
				status: version ? "installed" : "registered",
			});
		} else {
			// git: or local packages — always registered, no npm version check
			entries.push({
				name: pkg,
				status: "registered",
			});
		}
	}

	// Orphaned: npm global packages that look like pi packages but aren't in settings
	const settingsNpmNames = new Set(
		settings.packages
			.filter(p => p.startsWith("npm:"))
			.map(p => p.slice(4)),
	);

	for (const [npmName, version] of npmGlobals) {
		if (!settingsNpmNames.has(npmName) && isLikelyPiPackage(npmName)) {
			entries.push({
				name: `npm:${npmName}`,
				npmPackage: npmName,
				version,
				status: "orphaned",
			});
		}
	}

	return entries;
}

function isLikelyPiPackage(name: string): string {
	// Pi packages typically contain 'pi' in the name
	const lower = name.toLowerCase();
	// Exclude the core package
	if (lower === "@mariozechner/pi-coding-agent") return "";
	if (
		lower.includes("pi-") ||
		lower.includes("pi_") ||
		lower.includes("/pi-") ||
		lower.includes("/pi_")
	) {
		return name;
	}
	return "";
}

function doUninstall(packageNames: string[]): { uninstalled: string[]; failed: string[] } {
	const settings = readSettings();
	const uninstalled: string[] = [];
	const failed: string[] = [];

	for (const pkg of packageNames) {
		// Remove from settings
		if (!settings.packages.includes(pkg)) {
			failed.push(`${pkg} — not found in settings`);
			continue;
		}

		settings.packages = settings.packages.filter(p => p !== pkg);

		// If it's an npm package, also uninstall from npm global
		const npmName = extractNpmPackageName(pkg);
		if (npmName) {
			try {
				execSync(`npm uninstall -g ${npmName}`, {
					encoding: "utf-8",
					timeout: 60_000,
				});
			} catch (e) {
				failed.push(`${pkg} — npm uninstall failed: ${e instanceof Error ? e.message : String(e)}`);
				// Don't remove from settings if npm uninstall failed? Still remove — settings is the source of truth.
			}
		}

		uninstalled.push(pkg);
	}

	writeSettings(settings);
	return { uninstalled, failed };
}

function doReinstall(packageNames: string[]): { reinstalled: string[]; failed: string[] } {
	const settings = readSettings();
	const reinstalled: string[] = [];
	const failed: string[] = [];

	for (const pkg of packageNames) {
		if (settings.packages.includes(pkg)) {
			failed.push(`${pkg} — already in settings`);
			continue;
		}

		settings.packages.push(pkg);

		// Also update the npm global install to latest version
		const npmName = extractNpmPackageName(pkg);
		if (npmName) {
			try {
				execSync(`npm install -g ${npmName}@latest`, {
					encoding: "utf-8",
					timeout: 60_000,
				});
			} catch (e) {
				failed.push(`${pkg} — npm install failed: ${e instanceof Error ? e.message : String(e)}`);
				continue;
			}
		}

		reinstalled.push(pkg);
	}

	writeSettings(settings);
	return { reinstalled, failed };
}

// --- Tool ---

export function setupPkgCleanerTool(pi: ExtensionAPI) {
	pi.registerTool<typeof PackageManagerParams, PackageManagerDetails>({
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
			"Action 'reinstall' re-registers orphaned packages back into settings.json. Provide package names (npm:-prefixed) in the 'packages' array.",
			"Action 'uninstall' removes packages from settings.json AND runs npm uninstall -g. Provide package names (npm:-prefixed) in the 'packages' array.",
			"⚠️ Uninstall is destructive. Always show the user what will be removed and confirm before calling uninstall.",
			"Git and local packages are marked as 'registered' — they don't have a matching npm global install.",
		],

		parameters: PackageManagerParams,

		async execute(
			_toolCallId: string,
			params: PackageManagerParamsType,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
		): Promise<AgentToolResult<PackageManagerDetails>> {
			const action = params.action ?? "scan";

			switch (action) {
				case "scan": {
					const entries = scanPackages();
					const installed = entries.filter(e => e.status === "installed");
					const registered = entries.filter(e => e.status === "registered");
					const orphaned = entries.filter(e => e.status === "orphaned");

					let text = `Pi Package Scan (${entries.length} total)\n`;
					text += `─────────────────────────\n`;

					if (installed.length > 0) {
						text += `\nInstalled (${installed.length}):\n`;
						for (const e of installed) {
							text += `  ✅ ${e.name} @${e.version ?? "?"}\n`;
						}
					}

					if (registered.length > 0) {
						text += `\nRegistered only (${registered.length}):\n`;
						for (const e of registered) {
							text += `  📋 ${e.name}${e.version ? ` @${e.version}` : ""}\n`;
						}
					}

					if (orphaned.length > 0) {
						text += `\nOrphaned npm packages (${orphaned.length}):\n`;
						for (const e of orphaned) {
							text += `  ⚠️ ${e.npmPackage} @${e.version ?? "?"}\n`;
						}
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
					const entries = scanPackages().filter(e => e.status === "orphaned");

					if (entries.length === 0) {
						return {
							content: [{ type: "text", text: "No orphaned Pi packages found. All npm-global Pi packages are tracked in settings.json." }],
							details: { action: "orphans", total: entries.length, installed: 0, registered: 0, orphaned: 0 },
						};
					}

					let text = `Orphaned Pi packages (${entries.length}):\n`;
					for (const e of entries) {
						text += `  ${e.npmPackage} @${e.version ?? "?"}\n`;
					}
					text += `\nTo remove, use: pi_package_manager with action "uninstall" and packages: [${entries.map(e => `"${e.name}"`).join(", ")}]`;
					text += `\nOr run: ${entries.map(e => `pi uninstall ${e.name}`).join(" && ")}`;

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
							content: [{ type: "text", text: "No packages specified. Provide orphaned package names in the 'packages' parameter (e.g. [\"npm:pi-cmux\", \"npm:pi-mermaid\"])." }],
							details: { action: "reinstall", total: 0, installed: 0, registered: 0, orphaned: 0, uninstalled: [], failed: [] },
						};
					}

					const result = doReinstall(targets);

					let text = `Reinstall results:\n`;
					if (result.reinstalled.length > 0) {
						text += `  Re-registered: ${result.reinstalled.join(", ")}\n`;
					}
					if (result.failed.length > 0) {
						text += `  Failed: ${result.failed.join("; ")}\n`;
					}

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
							content: [{ type: "text", text: "No packages specified. Provide package names in the 'packages' parameter (e.g. [\"npm:pi-cmux\", \"npm:pi-mermaid\"])." }],
							details: { action: "uninstall", total: 0, installed: 0, registered: 0, orphaned: 0, uninstalled: [], failed: [] },
						};
					}

					const result = doUninstall(targets);

					let text = `Uninstall results:\n`;
					if (result.uninstalled.length > 0) {
						text += `  Removed: ${result.uninstalled.join(", ")}\n`;
					}
					if (result.failed.length > 0) {
						text += `  Failed: ${result.failed.join("; ")}\n`;
					}

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

		renderCall(args: PackageManagerParamsType, theme: Theme) {
			const action = args.action ?? "scan";
			const suffix = action === "uninstall" && args.packages?.length
				? ` (${args.packages.length} packages)`
				: "";
			return new Text(theme.fg("dim", `Pi Package Manager: ${action}${suffix}`), 0, 0);
		},

		renderResult(
			result: AgentToolResult<PackageManagerDetails>,
			_options: ToolRenderResultOptions,
			theme: Theme,
		) {
			const { details } = result;
			const textBlock = result.content.find((c) => c.type === "text");
			const msg = (textBlock?.type === "text" && textBlock.text) || "Done";

			if (!details) {
				return new Text(theme.fg("dim", msg), 0, 0);
			}

			if (details.failed && details.failed.length > 0) {
				return new Text(theme.fg("error", msg), 0, 0);
			}

			if (details.action === "scan" || details.action === "orphans") {
				const label = details.orphaned > 0
					? `${details.total} packages, ${details.orphaned} orphaned`
					: `${details.total} packages, clean`;
				return new Text(theme.fg("accent", label), 0, 0);
			}

			return new Text(theme.fg("accent", msg), 0, 0);
		},
	});

	// --- /manage-packages command ---

	pi.registerCommand("manage-packages", {
		description: "Scan and manage installed Pi packages",
		handler: async (_rawArgs, ctx) => {
			const entries = scanPackages();
			const installed = entries.filter(e => e.status === "installed");
			const registered = entries.filter(e => e.status === "registered");
			const orphaned = entries.filter(e => e.status === "orphaned");

			if (entries.length === 0) {
				ctx.ui.notify("No Pi packages found in settings.", "info");
				return;
			}

			// Show summary
			let summary = `Pi Packages (${entries.length} total)\n`;
			summary += `──────────────────────\n`;
			if (installed.length > 0) {
				summary += `\nInstalled (${installed.length}):\n`;
				for (const e of installed) {
					summary += `  ✅ ${e.name} @${e.version ?? "?"}\n`;
				}
			}
			if (registered.length > 0) {
				summary += `\nRegistered (${registered.length}):\n`;
				for (const e of registered) {
					summary += `  📋 ${e.name}${e.version ? ` @${e.version}` : ""}\n`;
				}
			}
			if (orphaned.length > 0) {
				summary += `\nOrphaned (${orphaned.length}):\n`;
				for (const e of orphaned) {
					summary += `  ⚠️ ${e.npmPackage} @${e.version ?? "?"}\n`;
				}
			}

			ctx.ui.notify(summary, "info");

			// Build flat menu — only include actions that have targets
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

			const choice = await ctx.ui.select(
				"Pi Package Manager",
				options,
			);

			if (!choice || choice === "Cancel") return;

			// --- Remove orphans individually ---
			if (choice.startsWith("Remove orphans individually")) {
				const orphanLabels = orphaned.map(e => `${e.npmPackage} @${e.version ?? "?"}`);
				const selected = await ctx.ui.select(
					"Select orphan to remove",
					[...orphanLabels, "Cancel"],
				);
				if (!selected || selected === "Cancel") return;
				const target = orphaned[orphanLabels.indexOf(selected)];
				if (!target) return;

				const confirm = await ctx.ui.confirm(
					`Remove ${target.npmPackage}?`,
					"This will uninstall it from npm global.",
				);
				if (!confirm) return;

				const result = doUninstall([target.name]);
				ctx.ui.notify(
					result.uninstalled.length > 0 ? `Removed: ${result.uninstalled.join(", ")}` : `Failed: ${result.failed.join("; ")}`,
					result.failed.length > 0 ? "error" : "info",
				);
				return;
			}

			// --- Remove all orphans ---
			if (choice.startsWith("Remove all orphans")) {
				const orphanLabels = orphaned.map(e => `${e.npmPackage} @${e.version ?? "?"}`);
				const confirm = await ctx.ui.confirm(
					`Remove ${orphaned.length} orphaned package(s)?`,
					orphanLabels.join("\n"),
				);
				if (!confirm) return;

				const result = doUninstall(orphaned.map(e => e.name));
				const msg = [];
				if (result.uninstalled.length > 0) msg.push(`Removed: ${result.uninstalled.join(", ")}`);
				if (result.failed.length > 0) msg.push(`Failed: ${result.failed.join("; ")}`);
				ctx.ui.notify(msg.join("\n") || "Done.", result.failed.length > 0 ? "warning" : "info");
				return;
			}

			// --- Re-register orphans individually ---
			if (choice.startsWith("Re-register orphans individually")) {
				const orphanLabels = orphaned.map(e => `${e.npmPackage} @${e.version ?? "?"}`);
				const selected = await ctx.ui.select(
					"Select orphan to re-register",
					[...orphanLabels, "Cancel"],
				);
				if (!selected || selected === "Cancel") return;
				const target = orphaned[orphanLabels.indexOf(selected)];
				if (!target) return;

				const result = doReinstall([target.name]);
				ctx.ui.notify(
					result.reinstalled.length > 0 ? `Re-registered: ${result.reinstalled.join(", ")}` : `Failed: ${result.failed.join("; ")}`,
					result.failed.length > 0 ? "error" : "info",
				);
				return;
			}

			// --- Re-register all orphans ---
			if (choice.startsWith("Re-register all orphans")) {
				const orphanLabels = orphaned.map(e => `${e.npmPackage} @${e.version ?? "?"}`);
				const confirm = await ctx.ui.confirm(
					`Re-register ${orphaned.length} orphaned package(s) in settings.json?`,
					orphanLabels.join("\n"),
				);
				if (!confirm) return;

				const result = doReinstall(orphaned.map(e => e.name));
				const msg = [];
				if (result.reinstalled.length > 0) msg.push(`Re-registered: ${result.reinstalled.join(", ")}`);
				if (result.failed.length > 0) msg.push(`Failed: ${result.failed.join("; ")}`);
				ctx.ui.notify(msg.join("\n") || "Done.", result.failed.length > 0 ? "warning" : "info");
				return;
			}

			// --- Remove installed package ---
			if (choice.startsWith("Remove installed package")) {
				const trackedLabels = tracked.map(e => {
					return e.version ? `${e.name} @${e.version}` : e.name;
				});
				const selected = await ctx.ui.select(
					"Select package to uninstall",
					[...trackedLabels, "Cancel"],
				);
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
					result.uninstalled.length > 0 ? `Uninstalled: ${result.uninstalled.join(", ")}` : `Failed: ${result.failed.join("; ")}`,
					result.failed.length > 0 ? "error" : "info",
				);
				return;
			}
		},
	});
}
