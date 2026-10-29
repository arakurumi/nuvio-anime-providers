import { ANICHIN } from './config.js';
import { resolveEmbeddedVideo } from '../shared/player.js';

const QUALITY_BY_NAME = {
  full: '1080p',
  hd: '720p',
  sd: '480p',
  low: '360p',
  lowest: '240p',
  mobile: '144p',
};

/**
 * @param {string} url
 * @returns {string|null}
 */
export function extractOkRuId(url) {
  const match = String(url || '').match(/ok\.ru\/(?:videoembed|video)\/(\d+)/i);
  return match ? match[1] : null;
}

/**
 * ok.ru exposes its player metadata through its own `dk` endpoint. The
 * response carries an adaptive HLS manifest (and progressive fallbacks).
 *
 * @param {string} embedUrl
 * @param {{ http: ReturnType<import('../shared/http.js').createHttpClient>, log: ReturnType<import('../shared/log.js').createLogger> }} options
 * @returns {Promise<{ url: string, referer: string, origin: string, quality?: string }|null>}
 */
export async function resolveOkRu(embedUrl, { http, log }) {
  const id = extractOkRuId(embedUrl);
  if (!id) return null;

  const data = await http.json('https://ok.ru/dk', {
    method: 'POST',
    body: `cmd=videoPlayerMetadata&mid=${encodeURIComponent(id)}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://ok.ru/',
      Origin: 'https://ok.ru',
    },
  });

  if (!data) {
    log.warn(`ok.ru metadata is unavailable for ${id}.`);
    return null;
  }

  if (typeof data.hlsManifestUrl === 'string' && data.hlsManifestUrl) {
    return {
      url: data.hlsManifestUrl,
      referer: 'https://ok.ru/',
      origin: 'https://ok.ru',
    };
  }

  const videos = Array.isArray(data.videos) ? data.videos : [];
  const order = ['full', 'hd', 'sd', 'low', 'lowest', 'mobile'];
  let best = null;

  for (const name of order) {
    const found = videos.find((video) => video && video.name === name && video.url);
    if (found) {
      best = found;
      break;
    }
  }

  if (!best) {
    log.warn(`ok.ru video ${id} has no playable source.`);
    return null;
  }

  return {
    url: best.url,
    referer: 'https://ok.ru/',
    origin: 'https://ok.ru',
    quality: QUALITY_BY_NAME[best.name] || 'HD',
  };
}

/**
 * Resolves an Anichin server: ok.ru through its metadata endpoint, everything
 * else through the generic iframe chain.
 *
 * @param {{ label?: string, url: string }} candidate
 * @param {{ http: ReturnType<import('../shared/http.js').createHttpClient>, log: ReturnType<import('../shared/log.js').createLogger> }} options
 * @returns {Promise<any>}
 */
export async function resolveAnichinPlayer(candidate, { http, log }) {
  if (/ok\.ru/i.test(candidate.url)) {
    const resolved = await resolveOkRu(candidate.url, { http, log });
    if (resolved) return resolved;
  }

  return resolveEmbeddedVideo(candidate.url, { http, log, referer: `${ANICHIN.baseUrl}/` });
}
