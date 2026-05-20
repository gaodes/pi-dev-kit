import type { RawConfig, ResolvedConfig, SettingsDef } from "./types.js";

export function mergeConfig<T extends ResolvedConfig>(
	global: RawConfig,
	project: RawConfig,
	definitions: SettingsDef<T>,
): T {
	const merged = { ...global };
	for (const [key, value] of Object.entries(project)) {
		if (value !== undefined) {
			merged[key] = value;
		}
	}
	const result = {} as T;
	for (const key of Object.keys(definitions)) {
		if (key in merged && merged[key] !== undefined) {
			(result as Record<string, unknown>)[key] = merged[key];
		} else {
			(result as Record<string, unknown>)[key] =
				definitions[key as keyof T].default;
		}
	}
	return result;
}
