import * as fs from "node:fs";
import * as path from "node:path";
import { ToolCallHeader } from "@gaodes/pi-utils-ui";
import type {
	AgentToolResult,
	ExtensionAPI,
	Theme,
} from "@mariozechner/pi-coding-agent";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { type Static, Type } from "typebox";
import { findPiInstallation } from "./utils";

const DocsParamsSchema = Type.Object({});
type DocsParams = Static<typeof DocsParamsSchema>;

interface DocsDetails {
	docFiles: string[];
	installPath: string;
}

function listFilesRecursive(dir: string, prefix = ""): string[] {
	const results: string[] = [];
	if (!fs.existsSync(dir)) return results;

	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			results.push(...listFilesRecursive(path.join(dir, entry.name), rel));
		} else {
			results.push(rel);
		}
	}
	return results;
}

function renderDocsCall(_args: DocsParams, theme: Theme) {
	return new ToolCallHeader({ toolName: "Pi Docs" }, theme);
}

const docsTool = defineTool({
	name: "pi_docs",
	label: "Pi Documentation",
	description:
		"List Pi markdown documentation files (README, docs/, examples/)",
	promptSnippet: "List Pi documentation files",
	promptGuidelines: [
		"Use pi_docs to discover available Pi documentation",
		"pi_docs returns markdown files from README.md, docs/, and examples/",
	],

	parameters: DocsParamsSchema,

	async execute(
		_toolCallId,
		_params,
		_signal,
		_onUpdate,
		_ctx,
	): Promise<AgentToolResult<DocsDetails>> {
		const piPath = findPiInstallation();
		if (!piPath) {
			throw new Error("Could not locate running Pi installation directory");
		}

		const readmePath = path.join(piPath, "README.md");
		const docsDir = path.join(piPath, "docs");
		const examplesDir = path.join(piPath, "examples");

		const docFiles: string[] = [];

		if (fs.existsSync(readmePath)) {
			docFiles.push("README.md");
		}

		if (fs.existsSync(docsDir)) {
			for (const file of listFilesRecursive(docsDir)) {
				if (file.endsWith(".md")) {
					docFiles.push(`docs/${file}`);
				}
			}
		}

		if (fs.existsSync(examplesDir)) {
			for (const file of listFilesRecursive(examplesDir)) {
				if (file.endsWith(".md")) {
					docFiles.push(`examples/${file}`);
				}
			}
		}

		if (docFiles.length === 0) {
			throw new Error(
				`No markdown documentation found in Pi installation at ${piPath}`,
			);
		}

		const lines = docFiles.map((rel) => `${path.join(piPath, rel)} (${rel})`);
		const message = `${docFiles.length} markdown files:\n${lines.join("\n")}`;

		return {
			content: [{ type: "text", text: message }],
			details: {
				docFiles,
				installPath: piPath,
			},
		};
	},

	renderCall(args, theme) {
		return renderDocsCall(args, theme);
	},

	renderResult(result, _options, theme) {
		const { details } = result;

		if (!details?.docFiles) {
			const text = result.content[0];
			return new Text(
				text?.type === "text" && text.text ? text.text : "No result",
				0,
				0,
			);
		}

		const { docFiles } = details;
		const lines: string[] = [];
		lines.push(theme.fg("accent", `${docFiles.length} markdown files:`));
		for (const rel of docFiles) {
			lines.push(theme.fg("dim", `  ${rel}`));
		}
		return new Text(lines.join("\n"), 0, 0);
	},
});

export function setupDocsTool(pi: ExtensionAPI) {
	pi.registerTool(docsTool);
}
