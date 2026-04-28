import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerLoadedToolsCommand } from "../tools/loaded-tools";

export function registerCommands(pi: ExtensionAPI) {
	registerLoadedToolsCommand(pi);
}
