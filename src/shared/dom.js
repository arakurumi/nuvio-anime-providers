/**
 * Returns the `cheerio` facade available in the Nuvio sandbox.
 *
 * Both the current polyfill and the legacy one expose a global `cheerio`;
 * `require('cheerio')` is used only as a fallback. The polyfill passes a
 * wrapper to `.each()` while desktop cheerio passes a DOM node, and `$(el)`
 * supports both, so callbacks should always wrap their element with `$()`.
 *
 * @param {string} html
 */
export function loadHtml(html) {
  const cheerioLib = typeof cheerio !== 'undefined' && cheerio ? cheerio : globalThis.cheerio;
  if (cheerioLib && typeof cheerioLib.load === 'function') return cheerioLib.load(html);

  const runtimeRequire = typeof globalThis !== 'undefined' ? globalThis.require : null;
  if (typeof runtimeRequire === 'function') {
    const loaded = runtimeRequire('cheerio');
    if (loaded && typeof loaded.load === 'function') return loaded.load(html);
  }

  throw new Error('cheerio is not available in this runtime');
}
