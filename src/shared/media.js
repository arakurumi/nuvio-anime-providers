/**
 * @param {unknown} url
 * @returns {string}
 */
export function originOf(url) {
  const match = String(url || '').match(/^(https?:\/\/[^/]+)/i);
  return match ? match[1] : '';
}

/**
 * @param {unknown} url
 * @returns {boolean}
 */
export function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

/**
 * @param {string} url
 * @returns {string}
 */
export function ensureTrailingSlash(url) {
  if (!url) return '';
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * @param {unknown} url
 * @param {string} baseUrl
 * @returns {string}
 */
export function absoluteUrl(url, baseUrl) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.indexOf('//') === 0) return `https:${value}`;
  if (value.charAt(0) === '/') return `${originOf(baseUrl)}${value}`;
  return `${ensureTrailingSlash(originOf(baseUrl) || baseUrl)}${value}`;
}

/**
 * Normalizes a site title into the compact label used by Nuvio.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function streamTitle(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Builds a Nuvio stream object.
 *
 * @param {object} options
 * @param {string} options.name Provider name shown in Nuvio.
 * @param {string} options.provider Stable provider id.
 * @param {string} options.title
 * @param {string} options.url
 * @param {string} [options.quality]
 * @param {string} [options.type]
 * @param {string} [options.language]
 * @param {string} [options.referer]
 * @param {string} [options.origin]
 * @param {Array<{ url: string, language: string, name?: string, headers?: Record<string, string> }>} [options.subtitles]
 * @param {string} options.userAgent
 * @returns {Record<string, any>}
 */
export function buildStream({
  name,
  provider,
  title,
  url,
  quality,
  type,
  language,
  referer,
  origin,
  subtitles,
  userAgent,
}) {
  const headers = { 'User-Agent': userAgent };
  if (referer) headers.Referer = ensureTrailingSlash(referer);
  if (origin) headers.Origin = origin;

  const stream = {
    name,
    title: streamTitle(title),
    url,
    quality: quality || 'HD',
    type,
    language,
    provider,
    headers,
  };

  if (Array.isArray(subtitles) && subtitles.length) {
    stream.subtitles = subtitles;
  }

  return stream;
}

/**
 * Reads the largest RESOLUTION height from an HLS master playlist.
 * Returns null for non-HLS urls or when the playlist cannot be read.
 *
 * @param {ReturnType<import('./http.js').createHttpClient>} http
 * @param {string} streamUrl
 * @param {string} [referer]
 * @returns {Promise<string|null>}
 */
export async function probeHlsQuality(http, streamUrl, referer) {
  if (!streamUrl || streamUrl.indexOf('.m3u8') === -1) return null;
  if (http.remaining() < 20000) return null;

  const headers = {};
  if (referer) headers.Referer = ensureTrailingSlash(referer);

  const playlist = await http.text(streamUrl, { headers });
  if (!playlist) return null;

  const pattern = /RESOLUTION=\d+x(\d+)/g;
  let best = 0;
  let match;

  while ((match = pattern.exec(playlist))) {
    const height = Number.parseInt(match[1], 10);
    if (height > best && height <= 4320) best = height;
  }

  return best > 0 ? `${best}p` : null;
}
