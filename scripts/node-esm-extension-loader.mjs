// Minimal Node ESM compatibility loader for the compiled gateway smoke CLIs.
//
// The TypeScript project uses `moduleResolution: "Bundler"`, so `tsc` emits
// extensionless relative imports such as `./chat/freebies`. Bun accepts those;
// plain Node ESM does not. The smoke scripts must run on operator hosts without
// Bun/tsx, so this loader retries relative extensionless specifiers as `.js`.

export async function resolve(specifier, context, defaultResolve) {
  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) {
      throw error;
    }
    if (/\.[cm]?js$|\.json$/i.test(specifier)) {
      throw error;
    }
    return defaultResolve(`${specifier}.js`, context, defaultResolve);
  }
}
