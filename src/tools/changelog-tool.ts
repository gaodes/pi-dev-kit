import * as fs from "node:fs";
import * as path from "node:path";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import { VERSION } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { type Static, Type } from "typebox";
import { findPiInstallation } from "./utils";

const GITHUB_RAW_CHANGELOG_URL =
	"https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/CHANGELOG.md";

const ChangelogParamsSchema = Type.Object({
	version: Type.Optional(
		Type.String({
			description:
				"Specific version to get changelog for. If not provided, returns latest version.",
		}),
	),
});
type ChangelogParams = Static<typeof ChangelogParamsSchema>;

const ChangelogVersionsParamsSchema = Type.Object({});
type ChangelogVersionsParams = Record<string, never>;

interface ChangelogEntry {
	version: string;
	content: string;
}

interface ChangelogDetails {
	changelog: ChangelogEntry;
	source: "local" | "github";
}

interface ChangelogVersionsDetails {
	versions: string[];
	source: "local" | "github";
}

interface ParsedChangelog {
	entries: Array<{ version: string; content: string }>;
}

function parseChangelogEntries(changelogContent: string): ParsedChangelog {
	const lines = changelogContent.split("\n");
	const entries: Array<{
		version: string;
		content: string;
		lineStart: number;
		lineEnd: number;
	}> = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const versionMatch = line.trim().match(/^#+\s*(?:\[([^\]]+)\]|([^[\s]+))/);
		if (versionMatch) {
			const version = versionMatch[1] || versionMatch[2];
			if (version && /^v?\d+\.\d+/.test(version)) {
				entries.push({ version, content: "", lineStart: i, lineEnd: -1 });
			}
		}
	}

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (!entry) continue;
		const nextEntry = entries[i + 1];
		const nextStart = nextEntry ? nextEntry.lineStart : lines.length;
		entry.lineEnd = nextStart;

		const contentLines = lines.slice(entry.lineStart + 1, entry.lineEnd);
		const rawContent = contentLines.join("\n").trim();

		const cleanContent = rawContent
			.replace(/^-+$|^=+$|^\*+$|^#+$/gm, "")
			.trim();
		if (!cleanContent || cleanContent.length < 10) {
			entry.content =
				"[Empty changelog entry - no details provided for this version]";
		} else {
			entry.content = rawContent;
		}
	}

	return { entries };
}

function findChangelogEntry(
	changelogContent: string,
	requestedVersion?: string,
): ChangelogEntry {
	const { entries } = parseChangelogEntries(changelogContent);
	if (entries.length === 0) {
		throw new Error("No version entries found in changelog");
	}

	if (requestedVersion) {
		const normalizedRequested = requestedVersion.replace(/^v/, "");
		const entry = entries.find(
			(e) =>
				e.version === requestedVersion ||
				e.version === normalizedRequested ||
				e.version === `v${requestedVersion}` ||
				e.version === `v${normalizedRequested}`,
		);
		if (entry) return entry;
		throw new Error(
			`Version ${requestedVersion} not found in changelog. Available: ${entries.map((e) => e.version).join(", ")}`,
		);
	}

	return entries[0];
}

function isNewerThanInstalled(requestedVersion: string): boolean {
	const clean = requestedVersion.replace(/^v/, "");
	const installed = VERSION.replace(/^v/, "");

	const requestedParts = clean.split(".").map(Number);
	const installedParts = installed.split(".").map(Number);

	for (let i = 0; i < Math.max(requestedParts.length, installedParts.length); i++) {
		const r = requestedParts[i] || 0;
		const inst = installedParts[i] || 0;
		if (r > inst) return true;
		if (r < inst) return false;
	}
	return false;
}

async function fetchGithubChangelog(): Promise<string> {
	const res = await fetch(GITHUB_RAW_CHANGELOG_URL, {
		signal: AbortSignal.timeout(10000),
	});
	if (!res.ok) {
		throw new Error(`Failed to fetch changelog from GitHub: ${res.status}`);
	}
	return await res.text();
}

function readLocalChangelog(): { content: string; piPath: string } {
	const piPath = findPiInstallation();
	if (!piPath) {
		throw new Error("Could not locate Pi installation");
	}

	const changelogPath = path.join(piPath, "CHANGELOG.md");
	if (!fs.existsSync(changelogPath)) {
		throw new Error(`No CHANGELOG.md found in Pi installation at ${piPath}`);
	}

	return {
		content: fs.readFileSync(changelogPath, "utf-8"),
		piPath,
	};
}

async function getChangelogContent(requestedVersion?: string): Promise<{
	entry: ChangelogEntry;
	source: "local" | "github";
}> {
	// If requested version is newer than installed, try GitHub first
	if (requestedVersion && isNewerThanInstalled(requestedVersion)) {
		try {
			const githubContent = await fetchGithubChangelog();
			const entry = findChangelogEntry(githubContent, requestedVersion);
			return { entry, source: "github" };
		} catch {
			// Fall through to local
		}
	}

	// Try local
	try {
		const { content } = readLocalChangelog();
		const entry = findChangelogEntry(content, requestedVersion);
		return { entry, source: "local" };
	} catch {
		// Fall through to GitHub
	}

	// Fall back to GitHub for anything else
	const githubContent = await fetchGithubChangelog();
	const entry = findChangelogEntry(githubContent, requestedVersion);
	return { entry, source: "github" };
}

export function setupChangelogTool(pi: ExtensionAPI) {
	// pi_changelog — get changelog for a specific version
	pi.registerTool<typeof ChangelogParamsSchema, ChangelogDetails>({
		name: "pi_changelog",
		label: "Pi Changelog",
		description:
			"Get changelog entry for a specific Pi version. Returns latest by default. Use pi_changelog_versions to list all available versions.",
		promptSnippet: "Check Pi changelog for recent changes",
		promptGuidelines: [
			"Use pi_changelog to check what's new in a Pi version",
			"pi_changelog returns the changelog entry for a specific version (or the latest by default)",
		],

		parameters: ChangelogParamsSchema,

		async execute(
			_toolCallId: string,
			params: ChangelogParams,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<ChangelogDetails>> {
			const { entry, source } = await getChangelogContent(params.version);

			return {
				content: [
					{
						type: "text",
						text: `## ${entry.version}\n\n${entry.content}\n\nSource: ${source}`,
					},
				],
				details: {
					changelog: entry,
					source,
				},
			};
		},

		renderCall(args: ChangelogParams, theme: Theme) {
			const label = args.version ? `v${args.version.replace(/^v/, "")}` : "latest";
			return new Text(theme.fg("dim", `Pi Changelog: ${label}`), 0, 0);
		},

		renderResult(
			result: AgentToolResult<ChangelogDetails>,
			_options: ToolRenderResultOptions,
			theme: Theme,
		) {
			const { details } = result;

			if (!details?.changelog) {
				const text = result.content[0];
				return new Text(
					text?.type === "text" && text.text ? text.text : "No result",
					0,
					0,
				);
			}

			const { changelog, source } = details;
			const lines: string[] = [];
			lines.push(theme.fg("accent", `## ${changelog.version}`));
			lines.push(theme.fg("dim", `Source: ${source}`));
			lines.push("");

			// Render first few lines of content
			const contentLines = changelog.content.split("\n").slice(0, 10);
			for (const line of contentLines) {
				lines.push(theme.fg("text", line));
			}

			return new Text(lines.join("\n"), 0, 0);
		},
	});

	// pi_changelog_versions — list all available versions
	pi.registerTool<
		typeof ChangelogVersionsParamsSchema,
		ChangelogVersionsDetails
	>({
		name: "pi_changelog_versions",
		label: "Pi Changelog Versions",
		description:
			"List all available Pi changelog versions.",

		promptSnippet: "List Pi changelog versions",
		promptGuidelines: [
			"Use pi_changelog_versions first to list all available versions",
			"Then use pi_changelog with a specific version to get details",
		],

		parameters: ChangelogVersionsParamsSchema,

		async execute(
			_toolCallId: string,
			_params: ChangelogVersionsParams,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<ChangelogVersionsDetails>> {
			let changelogContent: string;
			let source: "local" | "github";

			try {
				const local = readLocalChangelog();
				changelogContent = local.content;
				source = "local";
			} catch {
				changelogContent = await fetchGithubChangelog();
				source = "github";
			}

			const { entries } = parseChangelogEntries(changelogContent);
			const versions = entries.map((e) => e.version);

			if (versions.length === 0) {
				throw new Error("No version entries found in changelog");
			}

			return {
				content: [
					{
						type: "text",
						text: `${versions.length} versions available (${source}):\n${versions.join(", ")}`,
					},
				],
				details: {
					versions,
					source,
				},
			};
		},

		renderCall(_args: ChangelogVersionsParams, theme: Theme) {
			return new Text(theme.fg("dim", "Pi Changelog Versions"), 0, 0);
		},

		renderResult(
			result: AgentToolResult<ChangelogVersionsDetails>,
			_options: ToolRenderResultOptions,
			theme: Theme,
		) {
			const { details } = result;

			if (!details?.versions) {
				const text = result.content[0];
				return new Text(
					text?.type === "text" && text.text ? text.text : "No result",
					0,
					0,
				);
			}

			const { versions, source } = details;
			const lines: string[] = [];
			lines.push(
				theme.fg("accent", `${versions.length} versions (${source})`),
			);

			// Show first 10 + count of remaining
			const shown = versions.slice(0, 10);
			for (const v of shown) {
				lines.push(theme.fg("dim", `  ${v}`));
			}
			if (versions.length > 10) {
				lines.push(theme.fg("muted", `  ... and ${versions.length - 10} more`));
			}

			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
