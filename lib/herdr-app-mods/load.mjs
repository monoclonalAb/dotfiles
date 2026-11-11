// loadMod("next-agent"): the mod's main.js from this checkout, with the app's
// modules stubbed (hooks.mjs). Import the mod dynamically, after this registers.
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);

export const loadMod = (name) => import(new URL(`../../herdr-app/mods/${name}/main.js`, import.meta.url).href);
