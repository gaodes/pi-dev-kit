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
}
