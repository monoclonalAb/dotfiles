// Stand-in for the app's gpui-kit: any element builder chain returns itself.
const element = new Proxy(function () {}, { get: () => () => element, apply: () => element });
export class View {}
export const div = () => element;
export const svg = () => element;
export const image = () => element;
