import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import { BorderedLoader, getAgentDir, VERSION } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";

// --- Constants ---

const PACKAGE_NAME = "@mariozechner/pi-coding-agent";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CACHE_FILE = join(getAgentDir(), "update-cache.json");

const ENV_SKIP_VERSION_CHECK = "PI_SKIP_VERSION_CHECK";
const ENV_OFFLINE = "PI_OFFLINE";

// --- Schema ---

const UpdaterParams = Type.Object({
	action: Type.Optional(
		Type.Union(
			[
				Type.Literal("check"),
				Type.Literal("install"),
				Type.Literal("dismiss"),
				Type.Literal("status"),
				Type.Literal("cache"),
			],
			{
				description:
					"Action: check (fetch latest from npm), install (run npm update), dismiss (skip this version), status (current vs cached latest), cache (show cache contents). Default: status",
			},
		),
	),
	version: Type.Optional(
		Type.String({
			description: "Target version for install/dismiss actions. If omitted, uses the latest cached or fetched version.",
		}),
	),
});
type UpdaterParamsType = {
	action?: "check" | "install" | "dismiss" | "status" | "cache";
	version?: string;
};

// --- Types ---

interface VersionCache {
	latestVersion: string;
	dismissedVersion?: string;
	checkedAt?: string;
}

interface UpdaterDetails {
	currentVersion: string;
	latestVersion?: string;
	updateAvailable?: boolean;
	dismissedVersion?: string;
	action: string;
	result: string;
}

// --- Cache helpers ---

function readCache(): VersionCache | undefined {
	try {
		return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
	} catch {
		return undefined;
	}
}

function writeCache(cache: VersionCache) {
	try {
		mkdirSync(dirname(CACHE_FILE), { recursive: true });
		writeFileSync(CACHE_FILE, `${JSON.stringify(cache)}\n`);
	} catch {}
}

function saveLatestToCache(latest: string) {
	const prev = readCache();
	writeCache({
		latestVersion: latest,
		dismissedVersion: prev?.dismissedVersion,
		checkedAt: new Date().toISOString(),
	});
}

function dismissVersion(version: string) {
	const cache = readCache();
	writeCache({
		latestVersion: cache?.latestVersion ?? version,
		dismissedVersion: version,
		checkedAt: cache?.checkedAt,
	});
}

// --- Version logic ---

function parseVersion(v: string): [number, number, number] | undefined {
	const parts = v.trim().split(".");
	if (parts.length !== 3) return undefined;
	const nums = parts.map(Number);
	if (nums.some(Number.isNaN)) return undefined;
	return nums as [number, number, number];
}

function isNewer(latest: string, current: string): boolean {
	const l = parseVersion(latest);
	const c = parseVersion(current);
	if (!(l && c)) return false;
	if (l[0] !== c[0]) return l[0] > c[0];
	if (l[1] !== c[1]) return l[1] > c[1];
	return l[2] > c[2];
}

// --- Environment checks ---

function isEnvSet(name: string): boolean {
	return Boolean(process.env[name]);
}

function shouldSkipAutoChecks(): boolean {
	return isEnvSet(ENV_SKIP_VERSION_CHECK) || isEnvSet(ENV_OFFLINE);
}

function isOffline(): boolean {
	return isEnvSet(ENV_OFFLINE);
}

// --- Network ---

async function fetchLatestVersion(): Promise<string | undefined> {
	try {
		const res = await fetch(REGISTRY_URL, {
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) return undefined;
		return ((await res.json()) as { version?: string }).version;
	} catch {
		return undefined;
	}
}

// --- Install ---

function getInstallCommand(version: string): { program: string; args: string[] } {
	return {
		program: "npm",
		args: ["install", "-g", `${PACKAGE_NAME}@${version}`],
	};
}

function fmtCmd(cmd: { program: string; args: string[] }): string {
	return `${cmd.program} ${cmd.args.join(" ")}`;
}

async function doInstall(pi: ExtensionAPI, ctx: ExtensionContext, latest: string): Promise<boolean> {
	const cmd = getInstallCommand(latest);
	const success = await ctx.ui.custom<boolean>((tui, theme, _kb, done) => {
		const loader = new BorderedLoader(tui, theme, `Installing ${latest}...`);
		loader.onAbort = () => done(false);

		pi.exec(cmd.program, cmd.args, { timeout: 120_000 })
			.then((result) => {
				if (result.code !== 0) {
					ctx.ui.notify(`Update failed (exit ${result.code}): ${result.stderr || result.stdout}`, "error");
					done(false);
				} else {
					done(true);
				}
			})
			.catch(() => done(false));

		return loader;
	});

	return success;
}

// --- Restart ---

async function findPiBinary(pi: ExtensionAPI): Promise<string> {
	const cmd = process.platform === "win32" ? "where" : "which";
	const result = await pi.exec(cmd, ["pi"]);
	if (result.code === 0 && result.stdout?.trim()) {
		return result.stdout.trim().split(/\r?\n/)[0];
	}
	return "pi";
}

function canAutoRestart(ctx: ExtensionContext): boolean {
	return ctx.hasUI && !!process.stdin.isTTY && !!process.stdout.isTTY;
}

async function restartPi(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
	const piBinary = await findPiBinary(pi);
	const sessionFile = ctx.sessionManager.getSessionFile();
	const restartArgs = sessionFile ? ["--session", sessionFile] : ["--no-session"];

	return ctx.ui.custom<boolean>((tui, _theme, _kb, done) => {
		tui.stop();
		const result = spawnSync(piBinary, restartArgs, {
			cwd: ctx.cwd,
			env: process.env,
			stdio: "inherit",
			shell: process.platform === "win32",
			windowsHide: false,
		});
		tui.start();
		tui.requestRender(true);
		done(!result.error && (result.status === null || result.status === 0));
		return { render: () => [], invalidate: () => {} };
	});
}

// --- Auto-check state ---

let promptOpen = false;
const promptedVersions = new Set<string>();
let liveCheckStarted = false;

function getCachedUpgradeVersion(): string | undefined {
	const cache = readCache();
	if (!cache) return undefined;
	if (!isNewer(cache.latestVersion, VERSION)) return undefined;
	if (cache.dismissedVersion === cache.latestVersion) return undefined;
	return cache.latestVersion;
}

function canAutoPromptVersion(latest: string): boolean {
	if (!isNewer(latest, VERSION)) return false;
	if (promptedVersions.has(latest)) return false;
	if (readCache()?.dismissedVersion === latest) return false;
	return true;
}

async function showUpdatePrompt(pi: ExtensionAPI, ctx: ExtensionContext, latest: string) {
	const cmd = getInstallCommand(latest);
	const choice = await ctx.ui.select(`Update ${VERSION} → ${latest}`, [
		`Update now (${fmtCmd(cmd)})`,
		"Skip",
		"Skip this version",
	]);

	if (!choice || choice === "Skip") return;
	if (choice === "Skip this version") {
		dismissVersion(latest);
		return;
	}

	const success = await doInstall(pi, ctx, latest);
	if (!success) return;

	const restartTip = ctx.sessionManager.getSessionFile()
		? "Tip: run `pi -c` to continue this session."
		: "Tip: run `pi --no-session` to continue without a saved session.";

	if (!canAutoRestart(ctx)) {
		ctx.ui.notify(`Updated to ${latest}! Please restart pi.\n${restartTip}`, "info");
		return;
	}

	const restart = await ctx.ui.confirm(`Updated to ${latest}!`, "Restart now?");
	if (!restart) return;

	const ok = await restartPi(pi, ctx);
	if (ok) {
		ctx.shutdown();
		return;
	}

	ctx.ui.notify(`Updated to ${latest}! Auto-restart failed. Please restart pi manually.\n${restartTip}`, "error");
}

async function maybeShowAutoPrompt(pi: ExtensionAPI, ctx: ExtensionContext, latest: string) {
	if (!ctx.hasUI) return;
	if (promptOpen) return;
	if (!canAutoPromptVersion(latest)) return;

	promptOpen = true;
	promptedVersions.add(latest);
	try {
		await showUpdatePrompt(pi, ctx, latest);
	} finally {
		promptOpen = false;
	}
}

function runAutoChecks(pi: ExtensionAPI, ctx: ExtensionContext) {
	if (!ctx.hasUI) return;
	if (shouldSkipAutoChecks()) return;

	const cached = getCachedUpgradeVersion();
	if (cached) void maybeShowAutoPrompt(pi, ctx, cached);

	if (liveCheckStarted) return;
	liveCheckStarted = true;

	void fetchLatestVersion()
		.then((latest) => {
			if (!latest) return;
			saveLatestToCache(latest);
			void maybeShowAutoPrompt(pi, ctx, latest);
		})
		.catch(() => {});
}

// --- Tool setup ---

export function setupUpdaterTool(pi: ExtensionAPI) {
	// Auto-check on session start (preserves pi-updater auto-prompt behavior)
	pi.on("session_start", async (event, ctx) => {
		if (event.reason === "reload" || event.reason === "fork") return;
		runAutoChecks(pi, ctx);
	});

	// Register /update command (preserves pi-updater manual check UI flow)
	pi.registerCommand("update", {
		description: "Check for pi updates and install",
		handler: async (rawArgs, ctx) => {
			// /update --test — simulate the full UI flow without a real install
			if (rawArgs?.trim() === "--test") {
				const fakeLatest = "99.0.0";
				const cmd = getInstallCommand(fakeLatest);
				const choice = await ctx.ui.select(`Update ${VERSION} → ${fakeLatest}`, [
					`Update now (${fmtCmd(cmd)})`,
					"Skip",
					"Skip this version",
				]);
				if (!choice || choice === "Skip" || choice === "Skip this version") return;

				await ctx.ui.custom<void>((tui, theme, _kb, done) => {
					const loader = new BorderedLoader(tui, theme, `Installing ${fakeLatest}...`);
					loader.onAbort = () => done();
					setTimeout(() => done(), 1500);
					return loader;
				});

				if (!canAutoRestart(ctx)) {
					ctx.ui.notify(`Updated to ${fakeLatest}! Please restart pi.`, "info");
					return;
				}

				const restart = await ctx.ui.confirm(`Updated to ${fakeLatest}!`, "Restart now?");
				if (!restart) return;

				const ok = await restartPi(pi, ctx);
				if (ok) {
					ctx.shutdown();
					return;
				}
				ctx.ui.notify("Test restart failed.", "error");
				return;
			}

			if (isOffline()) {
				ctx.ui.notify("PI_OFFLINE is set. Disable it to check for updates.", "warning");
				return;
			}

			const latest = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, "Checking for updates...");
				loader.onAbort = () => done(null);
				fetchLatestVersion()
					.then((v) => done(v ?? null))
					.catch(() => done(null));
				return loader;
			});

			if (!latest) {
				ctx.ui.notify("Could not reach npm registry.", "error");
				return;
			}

			saveLatestToCache(latest);

			if (!isNewer(latest, VERSION)) {
				ctx.ui.notify(`Already on latest version (${VERSION}).`, "info");
				return;
			}

			promptedVersions.add(latest);
			await showUpdatePrompt(pi, ctx, latest);
		},
	});

	// Register the agent tool
	pi.registerTool<typeof UpdaterParams, UpdaterDetails>({
		name: "pi_updater",
		label: "Pi Updater",
		description:
			"Check for Pi updates, view version status, install updates, dismiss versions, or inspect the update cache. " +
			"Actions: 'status' (current vs latest), 'check' (fetch from npm), 'install' (run npm update), 'dismiss' (skip a version), 'cache' (show cache).",
		promptSnippet: "Check for Pi updates",
		promptGuidelines: [
			"Use pi_updater to check for updates, install new versions, or manage the update cache.",
			"Action 'status' is the default — shows current version, cached latest, and whether an update is available.",
			"Action 'check' fetches the latest version from npm and refreshes the cache.",
			"Action 'install' runs npm install -g to update Pi to the specified or latest version.",
			"Action 'dismiss' marks a version as skipped so auto-checks won't prompt for it.",
			"Action 'cache' shows the raw cache file contents.",
			"The /update command provides the interactive UI flow for users (prompt, install, restart).",
		],

		parameters: UpdaterParams,

		async execute(
			_toolCallId: string,
			params: UpdaterParamsType,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<UpdaterDetails>> {
			const action = params.action ?? "status";
			const cache = readCache();

			switch (action) {
				case "check": {
					if (isOffline()) {
						return {
							content: [{ type: "text", text: "PI_OFFLINE is set. Cannot check for updates." }],
							details: { currentVersion: VERSION, action: "check", result: "offline" },
						};
					}
					const latest = await fetchLatestVersion();
					if (!latest) {
						return {
							content: [{ type: "text", text: "Could not reach npm registry." }],
							details: { currentVersion: VERSION, action: "check", result: "fetch_failed" },
						};
					}
					saveLatestToCache(latest);
					const updateAvailable = isNewer(latest, VERSION);
					const text = updateAvailable
						? `Update available: ${VERSION} → ${latest}`
						: `Already on latest version (${VERSION}). Remote: ${latest}`;
					return {
						content: [{ type: "text", text }],
						details: {
							currentVersion: VERSION,
							latestVersion: latest,
							updateAvailable,
							action: "check",
							result: updateAvailable ? "update_available" : "up_to_date",
						},
					};
				}

				case "install": {
					const targetVersion = params.version ?? cache?.latestVersion;
					if (!targetVersion) {
						return {
							content: [
								{ type: "text", text: "No target version specified and no cached latest version. Run 'check' first." },
							],
							details: { currentVersion: VERSION, action: "install", result: "no_target" },
						};
					}
					const cmd = getInstallCommand(targetVersion);
					const spawnResult = spawnSync(cmd.program, cmd.args, {
						timeout: 120_000,
						encoding: "utf-8",
					});
					const success = !spawnResult.error && spawnResult.status === 0;
					const output = (spawnResult.stderr || spawnResult.stdout || "").trim();
					return {
						content: [
							{
								type: "text",
								text: success
									? `Successfully installed ${targetVersion}. Restart pi to use the new version.`
									: `Install failed: ${output}`,
							},
						],
						details: {
							currentVersion: VERSION,
							latestVersion: targetVersion,
							action: "install",
							result: success ? "success" : "failed",
						},
					};
				}

				case "dismiss": {
					const targetVersion = params.version ?? cache?.latestVersion;
					if (!targetVersion) {
						return {
							content: [{ type: "text", text: "No version to dismiss. Specify a version or run 'check' first." }],
							details: { currentVersion: VERSION, action: "dismiss", result: "no_target" },
						};
					}
					dismissVersion(targetVersion);
					return {
						content: [
							{ type: "text", text: `Dismissed version ${targetVersion}. You will not be prompted for it again.` },
						],
						details: {
							currentVersion: VERSION,
							latestVersion: cache?.latestVersion,
							dismissedVersion: targetVersion,
							action: "dismiss",
							result: "dismissed",
						},
					};
				}

				case "cache": {
					if (!cache) {
						return {
							content: [{ type: "text", text: "No update cache found." }],
							details: { currentVersion: VERSION, action: "cache", result: "no_cache" },
						};
					}
					return {
						content: [
							{
								type: "text",
								text: `Cache: latest=${cache.latestVersion}, dismissed=${cache.dismissedVersion ?? "none"}, checked=${cache.checkedAt ?? "unknown"}`,
							},
						],
						details: {
							currentVersion: VERSION,
							latestVersion: cache.latestVersion,
							dismissedVersion: cache.dismissedVersion,
							action: "cache",
							result: "ok",
						},
					};
				}
				default: {
					const updateAvailable = cache ? isNewer(cache.latestVersion, VERSION) : false;
					let text = `Current: ${VERSION}`;
					if (cache?.latestVersion) {
						text += `\nLatest (cached): ${cache.latestVersion}`;
						text += `\nUpdate available: ${updateAvailable}`;
					} else {
						text += "\nNo cached version data. Use 'check' to fetch from npm.";
					}
					if (cache?.dismissedVersion) {
						text += `\nDismissed: ${cache.dismissedVersion}`;
					}
					return {
						content: [{ type: "text", text }],
						details: {
							currentVersion: VERSION,
							latestVersion: cache?.latestVersion,
							updateAvailable,
							dismissedVersion: cache?.dismissedVersion,
							action: "status",
							result: "ok",
						},
					};
				}
			}
		},

		renderCall(args: UpdaterParamsType, theme: Theme) {
			const action = args.action ?? "status";
			return new Text(theme.fg("dim", `Pi Updater: ${action}`), 0, 0);
		},

		renderResult(result: AgentToolResult<UpdaterDetails>, _options: ToolRenderResultOptions, theme: Theme) {
			const { details } = result;
			const textBlock = result.content.find((c) => c.type === "text");
			const msg = (textBlock?.type === "text" && textBlock.text) || "Done";

			if (!details) {
				return new Text(theme.fg("dim", msg), 0, 0);
			}

			if (details.result === "failed" || details.result === "fetch_failed") {
				return new Text(theme.fg("error", msg), 0, 0);
			}

			if (details.updateAvailable) {
				return new Text(theme.fg("warning", `↑ ${details.currentVersion} → ${details.latestVersion}`), 0, 0);
			}

			return new Text(theme.fg("accent", msg), 0, 0);
		},
	});
}
