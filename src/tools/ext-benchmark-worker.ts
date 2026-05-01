/**
 * Worker script for isolated extension benchmarking.
 *
 * Runs in a separate worker thread so re-imported extensions cannot
 * crash or pollute the host Pi process. Receives extension paths to
 * benchmark, returns timing results.
 */
import { performance } from "node:perf_hooks";
import { parentPort, workerData } from "node:worker_threads";

type ExtLocation = "global" | "project" | "package";

interface WorkerInput {
	extensions: Array<{ name: string; path: string; location: ExtLocation }>;
	aliases: Record<string, string>;
}

interface WorkerResult {
	name: string;
	location: ExtLocation;
	importMs: number;
	factoryMs: number;
	totalMs: number;
	success: boolean;
	error?: string;
}

/**
 * Stub ExtensionAPI that mimics the full API surface.
 * Captures registrations without triggering real side effects.
 */
function createStubAPI(): Record<string, unknown> {
	const noop = () => {};
	const noopAsync = async () => {};
	const noopReturn = () => undefined;
	const noopReturnArr = () => [] as unknown[];
	const noopReturnStr = () => "";

	return {
		registerTool: noop,
		registerCommand: noop,
		registerShortcut: noop,
		registerFlag: noop,
		registerProvider: noop,
		registerMessageRenderer: noop,
		on: noop,
		appendEntry: noop,
		sendMessage: noopAsync,
		sendUserMessage: noopAsync,
		exec: noopAsync,
		events: { on: noop, emit: noopAsync, off: noop },
		getFlag: noopReturn,
		getFlags: noopReturnArr,
		getLabel: noopReturnStr,
		setLabel: noop,
		getActiveTools: noopReturnArr,
		getAllTools: noopReturnArr,
		setActiveTools: noop,
		refreshTools: noopAsync,
		getCommands: noopReturnArr,
		setModel: noop,
		getThinkingLevel: noopReturn,
		setThinkingLevel: noop,
	};
}

async function benchmarkExtension(
	extPath: string,
	importer: (path: string) => Promise<unknown>,
): Promise<{ importMs: number; factoryMs: number; error?: string }> {
	const importStart = performance.now();
	let factory: unknown;
	try {
		factory = await importer(extPath);
	} catch (err) {
		const importEnd = performance.now();
		return {
			importMs: Math.round((importEnd - importStart) * 100) / 100,
			factoryMs: 0,
			error: `Import failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	const importEnd = performance.now();
	const importMs = Math.round((importEnd - importStart) * 100) / 100;

	if (typeof factory !== "function") {
		return { importMs, factoryMs: 0 };
	}

	const factoryStart = performance.now();
	try {
		factory(createStubAPI());
	} catch (err) {
		const factoryEnd = performance.now();
		return {
			importMs,
			factoryMs: Math.round((factoryEnd - factoryStart) * 100) / 100,
			error: `Factory failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	const factoryEnd = performance.now();
	const factoryMs = Math.round((factoryEnd - factoryStart) * 100) / 100;

	return { importMs, factoryMs };
}

async function run(): Promise<void> {
	const input = workerData as WorkerInput;

	let jiti: {
		import: (path: string, opts?: { default?: true }) => Promise<unknown>;
	} | null = null;
	try {
		const { createJiti } = await import("@mariozechner/jiti");
		jiti = createJiti(import.meta.url, {
			moduleCache: false,
			alias: input.aliases,
		});
	} catch {
		// jiti unavailable
	}

	const importer = jiti
		? (p: string) => jiti!.import(p, { default: true })
		: async (p: string) => {
				const mod = await import(`${p}?t=${Date.now()}`);
				return mod.default ?? mod;
			};

	const results: WorkerResult[] = [];

	for (const entry of input.extensions) {
		const { importMs, factoryMs, error } = await benchmarkExtension(entry.path, importer);
		results.push({
			name: entry.name,
			location: entry.location,
			importMs,
			factoryMs,
			totalMs: importMs + factoryMs,
			success: !error,
			error,
		});
	}

	parentPort?.postMessage(results);
}

run().catch((err) => {
	parentPort?.postMessage({
		error: err instanceof Error ? err.message : String(err),
	});
});
