import type {
	RawConfig,
	ResolvedConfig,
	SettingsDef,
	SettingDefinition,
} from "./types.js";

export function sanitizeConfig<T extends ResolvedConfig>(
	raw: RawConfig,
	definitions: SettingsDef<T>,
): T {
	const result = {} as T;
	for (const [key, def] of Object.entries(definitions)) {
		const typedDef = def as SettingDefinition<unknown>;
		if (key in raw && raw[key] !== undefined) {
			(result as Record<string, unknown>)[key] = raw[key];
		} else {
			(result as Record<string, unknown>)[key] = typedDef.default;
		}
	}
	return result;
}
