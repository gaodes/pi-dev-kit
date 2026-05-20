import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { mergeConfig } from "./merge";
import { sanitizeConfig } from "./sanitize";
import type { RawConfig, ResolvedConfig, SettingsDef } from "./types";

const GLOBAL_SETTINGS_PATH = path.join(
	homedir(),
	".pi",
	"agent",
	"prime-settings.json",
);

function readJsonSafe(filePath: string): RawConfig {
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		return JSON.parse(content) as RawConfig;
	} catch {
		return {};
	}
}

function writeJson(filePath: string, data: unknown): void {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function loadGlobalSettings(): RawConfig {
	return readJsonSafe(GLOBAL_SETTINGS_PATH);
}

export function saveGlobalSettings(settings: RawConfig): void {
	writeJson(GLOBAL_SETTINGS_PATH, settings);
}

export function ensurePrimeSettings<T extends ResolvedConfig>(
	definitions: SettingsDef<T>,
): T {
	const raw = loadGlobalSettings();
	const sanitized = sanitizeConfig(raw, definitions);
	saveGlobalSettings(sanitized);
	return sanitized;
}

export function healGlobalConfig<T extends ResolvedConfig>(
	definitions: SettingsDef<T>,
): T {
	return ensurePrimeSettings(definitions);
}

export function loadConfig<T extends ResolvedConfig>(
	definitions: SettingsDef<T>,
	projectPath?: string,
): T {
	const global = loadGlobalSettings();
	const project = projectPath
		? readJsonSafe(path.join(projectPath, ".pi", "prime-settings.json"))
		: {};
	return mergeConfig(global, project, definitions);
}
