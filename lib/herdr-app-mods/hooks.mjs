// Resolve the Herdr app's built-in modules to inert stand-ins, so tests can
// import a mod's main.js and call its exported rules outside the app.
const STUBS = new Set(["gpui-kit", "gpui-base", "herdr"]);

export async function resolve(specifier, context, next) {
  if (STUBS.has(specifier)) return { url: new URL(`./stubs/${specifier}.mjs`, import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
