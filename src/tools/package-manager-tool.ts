import * as fs from "node:fs";
import * as path from "node:path";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const Params = Type.Object({});
type PackageManagerParams = Record<string, never>;

interface PackageManagerDetails {
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

export function setupPackageManagerTool(pi: ExtensionAPI) {
	pi.registerTool<typeof Params, PackageManagerDetails>({
		name: "detect_package_manager",
		label: "Package Manager",
		description:
			"Detect the package manager used in the current project by checking lockfiles and package.json",
		promptSnippet: "Detect the package manager for this project",
		promptGuidelines: [
			"Use detect_package_manager when you need to know which package manager (npm, yarn, pnpm, bun) the project uses",
			"detect_package_manager is helpful before running install commands or scripts",
		],

		parameters: Params,

		async execute(
			_toolCallId: string,
			_params: PackageManagerParams,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<PackageManagerDetails>> {
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
			const source: PackageManagerDetails["source"] = declaredPm
				? "packageManager"
				: lockfilePm
					? "lockfile"
					: "default";
			const detectedFrom = declaredPmFrom || lockfileFrom || cwd;
			const fallback = { install: `${pm} install`, run: pm };
			const commands = COMMANDS[pm] ?? fallback;

			const parts: string[] = [];
			parts.push(`Package manager: ${pm}`);
			if (declaredVersion) {
				parts.push(`Declared version: ${declaredVersion}`);
			}
			if (lockfile) {
				parts.push(`Lockfile: ${lockfile}`);
			}
			if (source === "default") {
				parts.push("No lockfile or packageManager field found, defaulting to npm");
			}
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

		renderCall(_args: PackageManagerParams, theme: Theme) {
			return new Text(theme.fg("dim", "Detect Package Manager"), 0, 0);
		},

		renderResult(
			result: AgentToolResult<PackageManagerDetails>,
			_options: ToolRenderResultOptions,
			theme: Theme,
		): Text {
			const { details } = result;

			if (!details?.packageManager) {
				const text = result.content[0];
				const errorMessage =
					text?.type === "text" && text.text
						? text.text
						: "Failed to detect package manager";
				return new Text(theme.fg("error", errorMessage), 0, 0);
			}

			const lines: string[] = [];
			lines.push(
				theme.fg(
					"success",
					`Package manager: ${theme.bold(details.packageManager)}`,
				),
			);
			if (details.version) {
				lines.push(theme.fg("dim", `Version: ${details.version}`));
			}
			if (details.lockfile) {
				lines.push(theme.fg("dim", `Lockfile: ${details.lockfile}`));
			}
			if (details.source === "default") {
				lines.push(theme.fg("muted", "No lockfile found, defaulted to npm"));
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
