export {
	booleanSetting,
	numberSetting,
	objectSetting,
	stringSetting,
} from "./factories.js";

export {
	ensurePrimeSettings,
	healGlobalConfig,
	loadConfig,
	loadGlobalSettings,
	saveGlobalSettings,
} from "./io.js";
export { mergeConfig } from "./merge.js";
export { sanitizeConfig } from "./sanitize.js";
export type {
	RawConfig,
	ResolvedConfig,
	SettingDefinition,
	SettingsDef,
} from "./types.js";
