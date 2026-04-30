import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { setupChangelogTool } from "./changelog-tool";
import { setupDocsTool } from "./docs-tool";
import { setupExtBenchmarkTool } from "./ext-benchmark-tool";
import { setupLoadedToolsTool } from "./loaded-tools";
import { setupVersionTool } from "./version-tool";

export function setupTools(pi: ExtensionAPI) {
	setupExtBenchmarkTool(pi);
	setupVersionTool(pi);
	setupDocsTool(pi);
	setupChangelogTool(pi);
	setupLoadedToolsTool(pi);
}
