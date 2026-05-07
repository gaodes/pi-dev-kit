import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerLoadedToolsCommand } from "../tools/loaded-tools";

export function registerCommands(pi: ExtensionAPI) {
	registerLoadedToolsCommand(pi);
}
