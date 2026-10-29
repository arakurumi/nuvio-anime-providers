import { absoluteUrl, isHttpUrl, originOf } from './media.js';
import { unpackPacker } from './packer.js';

const AD_HOST =
  /googleads|doubleclick|googletagmanager|googlesyndication|facebook|twitter|disqus|histats|analytics|adservice|popads|adsterra|propeller/i;

/**
 * @param {string} html
 * @returns {string|null}
 */
function findDirectMedia(html) {
  const match = String(html || '').match(/https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)(?:\?[^"'\s\\]*)?/i);
  return match ? match[0] : null;
}

/**
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string|null}
 */
function findIframe(html, baseUrl) {
  const pattern = /<iframe[^>]+src=["']([^"']+)["']/gi;
  const candidates = [];
  let match;

  while ((match = pattern.exec(html))) {
    const url = absoluteUrl(match[1], baseUrl);
    if (!isHttpUrl(url)) continue;
    if (AD_HOST.test(url)) continue;
    if (candidates.indexOf(url) === -1) candidates.push(url);
  }

  // Prefer known video hosts over the first unrelated iframe on the page.
  for (const url of candidates) {
    if (/blogger\.com|video\.g|drive\.google\.com|desustream|desudrive|mp4upload|vidhide|filemoon|streamtape/i.test(url)) {
      return url;
    }
  }

  return candidates.length ? candidates[0] : null;
}

/**
 * Blogger/Google Video tokens embed the signed `googlevideo.com/videoplayback`
 * url inside a JSON-in-HTML payload.
 *
 * @param {string} html
 * @returns {string|null}
 */
function extractGooglevideo(html) {
  const decoded = String(html || '')
    .replace(/\\u003d/g, '=')
    .replace(/\\u0026/g, '&')
    .replace(/\\u0025/g, '%')
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/')
    .replace(/\\&quot;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

  const match = decoded.match(/https?:\/\/[A-Za-z0-9.-]*googlevideo\.com\/videoplayback\?[^"'\s\\]*/i);
  if (!match) return null;

  const url = match[0].replace(/\\+$/, '');
  return isHttpUrl(url) ? url : null;
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isGoogleHost(url) {
  return /blogger\.com|video\.g\?token|googlevideo\.com/i.test(url);
}

/**
 * Follows the player iframes used by the sites until a playable url is found.
 *
 * Supported layers:
 * - Blogger / Google Video tokens (MP4)
 * - Dean Edwards packed players such as vidhide/mp4upload (HLS or MP4)
 * - Any page that embeds a direct `.m3u8` / `.mp4` url
 *
 * @param {string} embedUrl
 * @param {{ http: ReturnType<import('./http.js').createHttpClient>, log: ReturnType<import('./log.js').createLogger>, referer?: string }} options
 * @returns {Promise<{ url: string, referer: string, subtitles: any[] }|null>}
 */
export async function resolveEmbeddedVideo(embedUrl, { http, log, referer }) {
  let current = embedUrl;
  let siteReferer = referer || `${originOf(embedUrl)}/`;
  const visited = {};

  for (let depth = 0; depth <= 3 && current; depth += 1) {
    if (visited[current]) return null;
    visited[current] = true;

    const html = await http.text(current, { headers: { Referer: siteReferer } });
    if (!html) return null;

    if (isGoogleHost(current) || html.indexOf('googlevideo.com/videoplayback') !== -1) {
      const url = extractGooglevideo(html);
      if (url) return { url, referer: '', subtitles: [] };
    }

    let direct = null;
    if (html.indexOf('eval(function(p,a,c,k,e,d)') !== -1) {
      const unpacked = unpackPacker(html);
      if (unpacked !== html) direct = findDirectMedia(unpacked);
    }
    if (!direct) direct = findDirectMedia(html);

    if (direct) {
      const url = absoluteUrl(direct, current);
      return { url, referer: originOf(current), subtitles: [] };
    }

    const next = findIframe(html, current);
    if (!next || next === current) {
      log.debug(`No playable url found at ${current}`);
      return null;
    }

    siteReferer = `${originOf(current)}/`;
    current = next;
  }

  return null;
}
