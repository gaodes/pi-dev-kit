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

const PackageCleanerParams = Type.Object({
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
type PackageCleanerParamsType = {
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

interface PackageCleanerDetails {
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

export function setupPackageCleanerTool(pi: ExtensionAPI) {
	pi.registerTool<typeof PackageCleanerParams, PackageCleanerDetails>({
		name: "pi_package_cleaner",
		label: "Pi Package Cleaner",
		description:
			"Scan installed Pi packages, find orphaned npm packages, re-register or bulk-uninstall them. " +
			"Actions: 'scan' (list all packages with status), 'orphans' (show npm packages not in settings), " +
			"'reinstall' (re-register orphaned packages back to settings), 'uninstall' (remove packages — provide names in 'packages' param).",
		promptSnippet: "Scan installed Pi packages",
		promptGuidelines: [
			"Use pi_package_cleaner to audit and clean up installed Pi packages.",
			"Action 'scan' (default) lists all packages from settings.json with their npm install status and version.",
			"Action 'orphans' shows npm-global packages that look like Pi packages but aren't in settings.json.",
			"Action 'reinstall' re-registers orphaned packages back into settings.json. Provide package names (npm:-prefixed) in the 'packages' array.",
			"Action 'uninstall' removes packages from settings.json AND runs npm uninstall -g. Provide package names (npm:-prefixed) in the 'packages' array.",
			"⚠️ Uninstall is destructive. Always show the user what will be removed and confirm before calling uninstall.",
			"Git and local packages are marked as 'registered' — they don't have a matching npm global install.",
		],

		parameters: PackageCleanerParams,

		async execute(
			_toolCallId: string,
			params: PackageCleanerParamsType,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
		): Promise<AgentToolResult<PackageCleanerDetails>> {
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
					text += `\nTo remove, use: pi_package_cleaner with action "uninstall" and packages: [${entries.map(e => `"${e.name}"`).join(", ")}]`;
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

		renderCall(args: PackageCleanerParamsType, theme: Theme) {
			const action = args.action ?? "scan";
			const suffix = action === "uninstall" && args.packages?.length
				? ` (${args.packages.length} packages)`
				: "";
			return new Text(theme.fg("dim", `Pi Package Cleaner: ${action}${suffix}`), 0, 0);
		},

		renderResult(
			result: AgentToolResult<PackageCleanerDetails>,
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

	// --- /clean-packages command ---

	pi.registerCommand("clean-packages", {
		description: "Scan and clean up installed Pi packages",
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
					summary += `  \u2705 ${e.name} @${e.version ?? "?"}\n`;
				}
			}
			if (registered.length > 0) {
				summary += `\nRegistered (${registered.length}):\n`;
				for (const e of registered) {
					summary += `  \uD83D\uDCCB ${e.name}${e.version ? ` @${e.version}` : ""}\n`;
				}
			}
			if (orphaned.length > 0) {
				summary += `\nOrphaned (${orphaned.length}):\n`;
				for (const e of orphaned) {
					summary += `  \u26A0\uFE0F ${e.npmPackage} @${e.version ?? "?"}\n`;
				}
			}

			ctx.ui.notify(summary, "info");

			if (orphaned.length === 0) {
				// No orphans — offer to manage installed packages
				const allPkgs = [...installed, ...registered];
				if (allPkgs.length === 0) {
					ctx.ui.notify("Nothing to manage.", "info");
					return;
				}

				const choices = allPkgs.map(e => {
					const label = e.version
						? `${e.name} @${e.version}`
						: e.name;
					return label;
				});

				const toRemove = await ctx.ui.select(
					"Select packages to uninstall",
					[...choices, "Cancel"],
				);

				if (!toRemove || toRemove === "Cancel") return;

				// Map label back to package entry
				const target = allPkgs.find(e => {
					const label = e.version ? `${e.name} @${e.version}` : e.name;
					return label === toRemove;
				});
				if (!target) return;

				const confirm = await ctx.ui.confirm(
					`Uninstall ${target.name}?`,
					"This will remove it from settings and run npm uninstall -g.",
				);
				if (!confirm) return;

				const result = doUninstall([target.name]);
				if (result.uninstalled.length > 0) {
					ctx.ui.notify(`Uninstalled: ${result.uninstalled.join(", ")}`, "info");
				} else if (result.failed.length > 0) {
					ctx.ui.notify(`Failed: ${result.failed.join("; ")}`, "error");
				}
				return;
			}

			// Orphans found — offer cleanup
			const orphanLabels = orphaned.map(e => `${e.npmPackage} @${e.version ?? "?"}`);
			const choice = await ctx.ui.select(
				`${orphaned.length} orphaned package(s) found`,
				[
					"Re-register all in settings",
					"Remove all orphans",
					"Select individually",
					"Cancel",
				],
			);

			if (!choice || choice === "Cancel") return;

			if (choice === "Re-register all in settings") {
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

			if (choice === "Remove all orphans") {
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

			// Select individually — multi-step selection
			const toRemove: string[] = [];
			const toReregister: string[] = [];
			for (const e of orphaned) {
				const pick = await ctx.ui.select(
					`${e.npmPackage} @${e.version ?? "?"}`,
					["Re-register", "Remove", "Keep", "Done selecting"],
				);
				if (pick === "Done selecting") break;
				if (pick === "Remove") toRemove.push(e.name);
				if (pick === "Re-register") toReregister.push(e.name);
			}

			if (toRemove.length === 0 && toReregister.length === 0) {
				ctx.ui.notify("No packages selected.", "info");
				return;
			}

			const msgs = [];
			if (toReregister.length > 0) {
				const r = doReinstall(toReregister);
				if (r.reinstalled.length > 0) msgs.push(`Re-registered: ${r.reinstalled.join(", ")}`);
				if (r.failed.length > 0) msgs.push(`Re-register failed: ${r.failed.join("; ")}`);
			}
			if (toRemove.length > 0) {
				const r = doUninstall(toRemove);
				if (r.uninstalled.length > 0) msgs.push(`Removed: ${r.uninstalled.join(", ")}`);
				if (r.failed.length > 0) msgs.push(`Remove failed: ${r.failed.join("; ")}`);
			}
			ctx.ui.notify(msgs.join("\n") || "Done.", msgs.some(m => m.includes("failed")) ? "warning" : "info");
		},
	});
}
