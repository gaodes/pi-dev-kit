import type { SettingDefinition } from "./types.js";

export function booleanSetting(
	key: string,
	defaultValue: boolean,
	description?: string,
): SettingDefinition<boolean> {
	return { key, default: defaultValue, description };
}

export function stringSetting(
	key: string,
	defaultValue: string,
	description?: string,
): SettingDefinition<string> {
	return { key, default: defaultValue, description };
}

export function numberSetting(
	key: string,
	defaultValue: number,
	description?: string,
): SettingDefinition<number> {
	return { key, default: defaultValue, description };
}

export function objectSetting<T extends object>(
	key: string,
	defaultValue: T,
	description?: string,
): SettingDefinition<T> {
	return { key, default: defaultValue, description };
}
