export interface SettingDefinition<T> {
	key: string;
	default: T;
	description?: string;
}

export type SettingsDef<T> = {
	[K in keyof T]: SettingDefinition<T[K]>;
};

export interface RawConfig {
	[key: string]: unknown;
}

export interface ResolvedConfig {
	[key: string]: unknown;
}
