import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands";
import { setupTools } from "./tools";
import {
	registerLoadedToolsRenderer,
	registerStartupDisplay,
} from "./tools/loaded-tools";

export default function (pi: ExtensionAPI) {
	setupTools(pi);
	registerCommands(pi);
	registerLoadedToolsRenderer(pi);
	registerStartupDisplay(pi);

	pi.on("resources_discover", () => {
		const extDir = path.dirname(fileURLToPath(import.meta.url));
		const skillsDir = path.join(extDir, "skills");
		return { skillPaths: [skillsDir] };
	});
}
