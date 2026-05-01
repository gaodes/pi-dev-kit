import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
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

type ExtLocation = "global" | "project" | "package";

interface ExtensionEntry {
	name: string;
	path: string;
	location: ExtLocation;
}

interface BenchmarkResult {
	name: string;
	path: string;
	location: ExtLocation;
	importMs: number;
	factoryMs: number;
	totalMs: number;
	success: boolean;
	error?: string;
}

interface BenchmarkDetails {
	results: BenchmarkResult[];
	totalExtensions: number;
	totalTimeMs: number;
	slowest: string;
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const ExtBenchmarkParams = Type.Object({
	action: Type.Optional(
		Type.Union(
			[
				Type.Literal("profile", {
					description: "Re-import each extension and time import + factory execution (default)",
				}),
				Type.Literal("list", {
					description: "List discovered extension paths without benchmarking",
				}),
			],
			{
				description: "Action to perform. Default: profile",
			},
		),
	),
	scope: Type.Optional(
		Type.Union(
			[
				Type.Literal("all", { description: "All locations (default)" }),
				Type.Literal("global", { description: "Global extensions only" }),
				Type.Literal("project", {
					description: "Project-local extensions only",
				}),
				Type.Literal("packages", {
					description: "Installed npm/git packages only",
				}),
			],
			{
				description: "Filter by extension location. Default: all",
			},
		),
	),
});
type ExtBenchmarkParamsType = {
	action?: "profile" | "list";
	scope?: "all" | "global" | "project" | "packages";
};

// ---------------------------------------------------------------------------
// Extension discovery (mirrors Pi's loader logic)
// ---------------------------------------------------------------------------

function isExtensionFile(name: string): boolean {
	return name.endsWith(".ts") || name.endsWith(".js");
}

/**
 * Resolve extension entry points from a directory that has a package.json
 * with a pi.extensions manifest. Handles both file and directory entries.
 */
function resolveExtensionEntries(dir: string): string[] | null {
	const packageJsonPath = join(dir, "package.json");
	if (existsSync(packageJsonPath)) {
		try {
			const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
			if (pkg.pi?.extensions?.length) {
				const entries: string[] = [];
				for (const extPath of pkg.pi.extensions) {
					const resolved = resolve(dir, extPath);
					if (!existsSync(resolved)) continue;

					// Manifest entry can be a file or a directory
					const stats = statSync(resolved);
					if (stats.isFile()) {
						entries.push(resolved);
					} else if (stats.isDirectory()) {
						// Directory entry: discover extension files inside
						// (mirrors Pi's collectAutoExtensionEntries)
						const dirEntries = discoverExtensionFilesInDir(resolved);
						entries.push(...dirEntries);
					}
				}
				if (entries.length > 0) return entries;
			}
		} catch {
			// fall through
		}
	}

	// Fallback: index.ts / index.js
	for (const indexFile of ["index.ts", "index.js"]) {
		if (existsSync(join(dir, indexFile))) {
			return [join(dir, indexFile)];
		}
	}

	return null;
}

/**
 * Discover extension files inside a directory.
 * Handles: direct .ts/.js files, and subdirs with index files or package.json manifests.
 * Mirrors Pi's collectAutoExtensionEntries.
 */
function discoverExtensionFilesInDir(dir: string): string[] {
	if (!existsSync(dir)) return [];

	// First check if this directory itself has explicit extension entries (package.json or index)
	const rootEntries = resolveExtensionEntries(dir);
	if (rootEntries) return rootEntries;

	// Otherwise discover from directory contents
	const discovered: string[] = [];
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

			const fullPath = join(dir, entry.name);
			if (entry.isFile() && isExtensionFile(entry.name)) {
				discovered.push(fullPath);
			} else if (entry.isDirectory()) {
				const resolved = resolveExtensionEntries(fullPath);
				if (resolved) discovered.push(...resolved);
			}
		}
	} catch {
		// ignore
	}
	return discovered;
}

/**
 * Discover extension entry points from a directory containing extension directories.
 * Used for global/project extension directories.
 */
function discoverExtensionsInDir(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const discovered: string[] = [];
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const entryPath = join(dir, entry.name);
			if ((entry.isFile() || entry.isSymbolicLink()) && isExtensionFile(entry.name)) {
				discovered.push(entryPath);
				continue;
			}
			if (entry.isDirectory() || entry.isSymbolicLink()) {
				const resolved = resolveExtensionEntries(entryPath);
				if (resolved) discovered.push(...resolved);
			}
		}
	} catch {
		return [];
	}
	return discovered;
}

// ---------------------------------------------------------------------------
// Settings and path helpers
// ---------------------------------------------------------------------------

function getAgentDir(): string {
	return join(homedir(), ".pi", "agent");
}

function getProjectDir(cwd: string): string {
	return join(cwd, ".pi");
}

function readSettingsPackages(agentDir: string): string[] {
	const settingsPath = join(agentDir, "settings.json");
	try {
		return JSON.parse(readFileSync(settingsPath, "utf-8")).packages ?? [];
	} catch {
		return [];
	}
}

function getNpmGlobalRoot(): string {
	try {
		return execSync("npm root -g", { encoding: "utf-8", timeout: 3000 }).trim();
	} catch {
		return "/opt/homebrew/lib/node_modules";
	}
}

// ---------------------------------------------------------------------------
// Package discovery
// ---------------------------------------------------------------------------

interface PackageSource {
	spec: string;
	scope: "global" | "project";
}

/**
 * Collect all package sources from global and project settings.
 * Project scope wins on collision (mirrors Pi's dedup behavior).
 */
function collectPackageSources(cwd: string): PackageSource[] {
	const globalPkgs = readSettingsPackages(getAgentDir());
	const projectPkgs = readSettingsPackages(getProjectDir(cwd));

	const sources: PackageSource[] = [];
	for (const spec of projectPkgs) sources.push({ spec, scope: "project" });
	for (const spec of globalPkgs) sources.push({ spec, scope: "global" });
	return sources;
}

/**
 * Discover extension entry points from all installed packages (npm and git)
 * across both global and project scopes.
 *
 * - npm global: $(npm root -g)/<name>
 * - npm project: .pi/npm/node_modules/<name>
 * - git global: ~/.pi/agent/git/<host>/<user>/<repo>
 * - git project: .pi/git/<host>/<user>/<repo>
 */
function discoverPackageExtensions(cwd: string): string[] {
	const agentDir = getAgentDir();
	const projectDir = getProjectDir(cwd);
	const npmGlobalRoot = getNpmGlobalRoot();
	const sources = collectPackageSources(cwd);
	const paths: string[] = [];
	const seen = new Set<string>();

	const addUnique = (newPaths: string[]) => {
		for (const p of newPaths) {
			if (!seen.has(p)) {
				seen.add(p);
				paths.push(p);
			}
		}
	};

	const resolveNpm = (pkgName: string, scope: "global" | "project") => {
		const candidate =
			scope === "project" ? join(projectDir, "npm", "node_modules", pkgName) : join(npmGlobalRoot, pkgName);
		if (!existsSync(candidate)) return;
		const entries = resolveExtensionEntries(candidate);
		if (entries) {
			addUnique(entries);
			return;
		}
		const discovered = discoverExtensionFilesInDir(candidate);
		if (discovered.length > 0) addUnique(discovered);
	};

	const resolveGit = (scope: "global" | "project") => {
		const gitBase = scope === "project" ? join(projectDir, "git") : join(agentDir, "git");
		if (!existsSync(gitBase)) return;
		addUnique(discoverGitPackageExtensions(gitBase));
	};

	for (const { spec, scope } of sources) {
		if (spec.startsWith("npm:")) {
			resolveNpm(spec.slice(4), scope);
		} else if (
			spec.startsWith("git:") ||
			spec.startsWith("ssh:") ||
			spec.startsWith("https://") ||
			spec.includes("gitlab") ||
			spec.includes("github")
		) {
			resolveGit(scope);
		}
	}

	return paths;
}

/**
 * Recursively discover extension entry points from git-installed packages.
 * Git packages are stored at ~/.pi/agent/git/<host>/<user>/<repo>.
 */
function discoverGitPackageExtensions(gitBase: string): string[] {
	const paths: string[] = [];

	if (!existsSync(gitBase)) return paths;

	// Walk: git/<host>/<user>/<repo> — repos are at depth 3
	function walk(dir: string, depth: number) {
		if (!existsSync(dir)) return;
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			const fullPath = join(dir, entry.name);
			if (!entry.isDirectory()) continue;

			if (depth >= 2 && existsSync(join(fullPath, "package.json"))) {
				// This looks like a git-installed package
				const extEntries = resolveExtensionEntries(fullPath);
				if (extEntries) {
					paths.push(...extEntries);
					continue;
				}
			}
			walk(fullPath, depth + 1);
		}
	}

	walk(gitBase, 0);
	return paths;
}

// ---------------------------------------------------------------------------
// Extension name derivation
// ---------------------------------------------------------------------------

function discoverAllExtensions(cwd: string, scopeFilter: string): ExtensionEntry[] {
	const agentDir = getAgentDir();
	const seen = new Set<string>();
	const entries: ExtensionEntry[] = [];

	const addEntries = (paths: string[], location: ExtLocation) => {
		for (const p of paths) {
			const resolved = resolve(p);
			if (seen.has(resolved)) continue;
			seen.add(resolved);

			let name: string;
			if (location === "global" || location === "project") {
				const extDir = location === "global" ? join(agentDir, "extensions") : join(cwd, ".pi", "extensions");
				const rel = relative(extDir, resolved);
				name = rel.split("/")[0];
				if (isExtensionFile(name)) name = name.replace(/\.(ts|js)$/, "");
			} else {
				// Derive from path — check npm node_modules, then git dirs, then fallback
				const nmIdx = resolved.lastIndexOf("node_modules");
				if (nmIdx >= 0) {
					const afterNm = resolved.slice(nmIdx + "node_modules".length + 1);
					const parts = afterNm.split("/");
					name = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
				} else if (resolved.includes(join(agentDir, "git"))) {
					// Global git package — extract <user>/<repo> from path
					const gitRel = relative(join(agentDir, "git"), resolved);
					const parts = gitRel.split("/");
					name = parts.length >= 3 ? parts.slice(1, 3).join("/") : parts[0];
				} else if (resolved.includes(join(cwd, ".pi", "git"))) {
					// Project git package
					const gitRel = relative(join(cwd, ".pi", "git"), resolved);
					const parts = gitRel.split("/");
					name = parts.length >= 3 ? parts.slice(1, 3).join("/") : parts[0];
				} else {
					name = basename(dirname(resolved));
				}
			}

			entries.push({ name, path: resolved, location });
		}
	};

	if (scopeFilter === "all" || scopeFilter === "project") {
		const localExtDir = join(cwd, ".pi", "extensions");
		addEntries(discoverExtensionsInDir(localExtDir), "project");
	}
	if (scopeFilter === "all" || scopeFilter === "global") {
		const globalExtDir = join(agentDir, "extensions");
		addEntries(discoverExtensionsInDir(globalExtDir), "global");
	}
	if (scopeFilter === "all" || scopeFilter === "packages") {
		addEntries(discoverPackageExtensions(cwd), "package");
	}

	return entries;
}

// ---------------------------------------------------------------------------
// Benchmarking: re-import each extension with jiti + time it
// ---------------------------------------------------------------------------

function buildJitiAliases(): Record<string, string> {
	const req = createRequire(import.meta.url);
	const aliases: Record<string, string> = {};

	const tryResolve = (specifier: string) => {
		try {
			return req.resolve(specifier);
		} catch {
			return undefined;
		}
	};

	const piCorePkgs = [
		"@mariozechner/pi-coding-agent",
		"@mariozechner/pi-agent-core",
		"@mariozechner/pi-tui",
		"@mariozechner/pi-ai",
		"@mariozechner/pi-ai/oauth",
	];
	for (const pkg of piCorePkgs) {
		const resolved = tryResolve(pkg);
		if (resolved) aliases[pkg] = resolved;
	}

	const typeboxVariants = ["typebox", "typebox/compile", "typebox/value"];
	for (const variant of typeboxVariants) {
		const resolved = tryResolve(variant);
		if (resolved) aliases[variant] = resolved;
	}

	return aliases;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
	if (ms < 1) return `${Math.round(ms * 1000)}µs`;
	if (ms < 1000) return `${ms.toFixed(1)}ms`;
	return `${(ms / 1000).toFixed(2)}s`;
}

function formatResults(results: BenchmarkResult[]): string {
	const sorted = [...results].sort((a, b) => b.totalMs - a.totalMs);

	const nameWidth = Math.max(4, ...sorted.map((r) => r.name.length));
	const locWidth = 7;
	const importWidth = 10;
	const factoryWidth = 10;
	const totalWidth = 10;

	const header = [
		"Extension".padEnd(nameWidth),
		"Loc".padEnd(locWidth),
		"Import".padStart(importWidth),
		"Factory".padStart(factoryWidth),
		"Total".padStart(totalWidth),
		"Status",
	]
		.join("  ")
		.trimEnd();

	const sep = "─".repeat(header.length);
	const lines = [sep, header, sep];

	for (const r of sorted) {
		const status = r.success ? "✓" : `✗ ${r.error ?? "unknown"}`;
		const line = [
			r.name.padEnd(nameWidth),
			r.location.padEnd(locWidth),
			formatDuration(r.importMs).padStart(importWidth),
			formatDuration(r.factoryMs).padStart(factoryWidth),
			formatDuration(r.totalMs).padStart(totalWidth),
			status,
		]
			.join("  ")
			.trimEnd();
		lines.push(line);
	}

	lines.push(sep);

	const totalTime = results.reduce((sum, r) => sum + r.totalMs, 0);
	const successCount = results.filter((r) => r.success).length;
	lines.push(
		`Total: ${formatDuration(totalTime)} across ${results.length} extensions (${successCount} ok, ${results.length - successCount} failed)`,
	);

	return lines.join("\n");
}

function formatList(entries: ExtensionEntry[]): string {
	if (entries.length === 0) return "No extensions discovered.";

	const nameWidth = Math.max(4, ...entries.map((e) => e.name.length));
	return entries.map((e) => `${e.name.padEnd(nameWidth)}  ${e.location.padEnd(7)}  ${e.path}`).join("\n");
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function setupExtBenchmarkTool(pi: ExtensionAPI) {
	pi.registerTool<typeof ExtBenchmarkParams, BenchmarkDetails>({
		name: "pi_ext_benchmark",
		label: "Extension Benchmark",
		description:
			"Profile Pi extension loading times. Discovers all extensions (global, project-local, installed npm/git packages) and measures import time and factory execution time for each. Use to identify slow extensions that impact startup performance.",
		promptSnippet: "Benchmark extension loading times",
		promptGuidelines: [
			"Use pi_ext_benchmark when the user asks about extension loading performance, slow startup, or wants to profile extensions.",
			"Use action='list' to quickly see what extensions are installed without benchmarking.",
			"Use scope='global' or scope='packages' to narrow the profile to specific locations.",
		],
		parameters: ExtBenchmarkParams,

		async execute(
			_toolCallId: string,
			params: ExtBenchmarkParamsType,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<BenchmarkDetails>> {
			const action = params.action ?? "profile";
			const scope = params.scope ?? "all";
			const cwd = process.cwd();

			const entries = discoverAllExtensions(cwd, scope);

			if (action === "list") {
				const text = formatList(entries);
				return {
					content: [
						{
							type: "text",
							text: `Discovered ${entries.length} extension(s):\n\n${text}`,
						},
					],
					details: {
						results: [],
						totalExtensions: entries.length,
						totalTimeMs: 0,
						slowest: "",
					},
				};
			}

			// Profile mode — run in a worker thread for isolation
			if (entries.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: "No extensions discovered for the selected scope.",
						},
					],
					details: {
						results: [],
						totalExtensions: 0,
						totalTimeMs: 0,
						slowest: "",
					},
				};
			}

			const aliases = buildJitiAliases();
			const workerPath = new URL("./ext-benchmark-worker.ts", import.meta.url);

			const { Worker } = await import("node:worker_threads");
			const overallStart = performance.now();

			const results: BenchmarkResult[] = await new Promise((resolve, reject) => {
				const worker = new Worker(workerPath, {
					workerData: {
						extensions: entries.map((e) => ({
							name: e.name,
							path: e.path,
							location: e.location,
						})),
						aliases,
					},
				});

				worker.on("message", (msg: unknown) => {
					if (msg && typeof msg === "object" && "error" in msg) {
						reject(new Error((msg as { error: string }).error));
						return;
					}
					resolve(msg as BenchmarkResult[]);
				});

				worker.on("error", reject);

				// Timeout after 60s to prevent hanging
				const timeout = setTimeout(() => {
					worker.terminate();
					reject(new Error("Benchmark timed out after 60s"));
				}, 60_000);

				worker.on("exit", () => clearTimeout(timeout));
			});

			const overallEnd = performance.now();
			const totalTimeMs = Math.round((overallEnd - overallStart) * 100) / 100;

			// Merge paths back in (worker doesn't return them)
			const pathMap = new Map(entries.map((e) => [e.name + e.location, e.path]));
			for (const r of results) {
				r.path = pathMap.get(r.name + r.location) ?? "";
			}

			const sorted = [...results].sort((a, b) => b.totalMs - a.totalMs);
			const text = formatResults(results);

			return {
				content: [{ type: "text", text }],
				details: {
					results,
					totalExtensions: results.length,
					totalTimeMs,
					slowest: sorted[0]?.name ?? "",
				},
			};
		},

		renderCall(_args: object, theme: Theme) {
			return new Text(theme.fg("dim", "Extension Benchmark"), 0, 0);
		},

		renderResult(result: AgentToolResult<BenchmarkDetails>, _options: ToolRenderResultOptions, theme: Theme): Text {
			const { details } = result;
			if (!details || details.results.length === 0) {
				const textBlock = result.content.find((c) => c.type === "text");
				const msg = (textBlock?.type === "text" && textBlock.text) || "No results";
				return new Text(theme.fg("dim", msg), 0, 0);
			}

			const ok = details.results.filter((r) => r.success).length;
			const fail = details.results.length - ok;
			const status = fail > 0 ? theme.fg("warning", `${fail} failed`) : theme.fg("success", "all ok");
			return new Text(
				`${theme.fg("accent", `${details.results.length} extensions`)} · ${formatDuration(details.totalTimeMs)} · ${status} · slowest: ${details.slowest}`,
				0,
				0,
			);
		},
	});
}
