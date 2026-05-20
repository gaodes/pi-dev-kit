export {
	booleanSetting,
	numberSetting,
	objectSetting,
	stringSetting,
} from "./factories";

export {
	ensurePrimeSettings,
	healGlobalConfig,
	loadConfig,
	loadGlobalSettings,
	saveGlobalSettings,
} from "./io";
export { mergeConfig } from "./merge";
export { sanitizeConfig } from "./sanitize";
export type {
	RawConfig,
	ResolvedConfig,
	SettingDefinition,
	SettingsDef,
} from "./types";
