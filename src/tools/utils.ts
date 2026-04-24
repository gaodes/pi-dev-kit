import * as child_process from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);

const PI_PACKAGE_NAME = "@mariozechner/pi-coding-agent";

/**
 * Find the currently running Pi installation directory.
 *
 * Resolution order:
 * 1. require.resolve (works when Pi injects peers via jiti)
 * 2. PI_PACKAGE_DIR env var (for testing / custom setups)
 * 3. npm root -g (dynamic global discovery)
 * 4. Well-known global roots (homebrew, linux)
 * 5. process.argv[1] walk-up (CLI invocation path)
 */
export function findPiInstallation(): string | null {
	// 1. Try require.resolve with createRequire for ESM context
	try {
		const piModulePath = require.resolve(`${PI_PACKAGE_NAME}/package.json`);
		return path.dirname(piModulePath);
	} catch {
		// package may not be directly resolvable from this context
	}

	// 2. Check PI_PACKAGE_DIR env var
	const envPackageDir = process.env.PI_PACKAGE_DIR;
	if (envPackageDir) {
		const candidate = path.join(envPackageDir, "@mariozechner", "pi-coding-agent");
		if (isPiPackage(candidate)) return candidate;
	}

	// 3. npm root -g
	const globalRoots: string[] = [];
	try {
		const npmRoot = child_process.execSync("npm root -g", { encoding: "utf-8", timeout: 3000 }).trim();
		if (npmRoot) globalRoots.push(npmRoot);
	} catch {
		// npm may be unavailable
	}

	// 4. Well-known global roots
	globalRoots.push("/opt/homebrew/lib/node_modules");
	globalRoots.push("/usr/local/lib/node_modules");

	for (const root of globalRoots) {
		const candidate = path.join(root, "@mariozechner", "pi-coding-agent");
		if (isPiPackage(candidate)) return candidate;
	}

	// 5. Walk up from process.argv[1]
	const scriptPath = process.argv[1];
	if (scriptPath) {
		let currentDir = path.dirname(path.resolve(scriptPath));
		while (currentDir !== path.dirname(currentDir)) {
			if (isPiPackage(currentDir)) return currentDir;
			currentDir = path.dirname(currentDir);
		}
	}

	return null;
}

function isPiPackage(dir: string): boolean {
	const pkgPath = path.join(dir, "package.json");
	if (!fs.existsSync(pkgPath)) return false;
	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
		return pkg.name === PI_PACKAGE_NAME;
	} catch {
		return false;
	}
}
