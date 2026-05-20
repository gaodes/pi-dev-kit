import type { RawConfig, ResolvedConfig, SettingsDef } from "./types";

export function sanitizeConfig<T extends ResolvedConfig>(
	raw: RawConfig,
	definitions: SettingsDef<T>,
): T {
	const result = {} as T;
	for (const [key, def] of Object.entries(definitions)) {
		if (key in raw && raw[key] !== undefined) {
			(result as Record<string, unknown>)[key] = raw[key];
		} else {
			(result as Record<string, unknown>)[key] = def.default;
		}
	}
	return result;
}
