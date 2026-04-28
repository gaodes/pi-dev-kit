import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { setupChangelogTool } from "./changelog-tool";
import { setupDocsTool } from "./docs-tool";
import { setupExtBenchmarkTool } from "./ext-benchmark-tool";
import { setupLoadedToolsTool } from "./loaded-tools";
import { setupPackageManagerTool } from "./package-manager-tool";
import { setupUpdaterTool } from "./updater-tool";
import { setupVersionTool } from "./version-tool";

export function setupTools(pi: ExtensionAPI) {
	setupExtBenchmarkTool(pi);
	setupPackageManagerTool(pi);
	setupVersionTool(pi);
	setupDocsTool(pi);
	setupChangelogTool(pi);
	setupUpdaterTool(pi);
	setupLoadedToolsTool(pi);
}
