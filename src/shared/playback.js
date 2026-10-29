import { buildStream, probeHlsQuality } from './media.js';
import { resolveEmbeddedVideo } from './player.js';

/**
 * Resolves player candidates into Nuvio stream objects.
 *
 * Candidates are tried in order until `maxStreams` is reached or the request
 * budget runs low. A candidate may be resolved by the generic iframe chain or
 * by a site specific resolver (e.g. ok.ru for Anichin).
 *
 * @param {Array<{ label?: string, url: string }>} candidates
 * @param {object} options
 * @param {ReturnType<import('./http.js').createHttpClient>} options.http
 * @param {ReturnType<import('./log.js').createLogger>} options.log
 * @param {string} options.name Provider label shown in Nuvio.
 * @param {string} options.providerId Stable provider id.
 * @param {string} options.userAgent
 * @param {string} options.language
 * @param {string} [options.siteReferer]
 * @param {string} [options.mp4Quality] Quality label used for non-HLS urls.
 * @param {number} [options.maxStreams]
 * @param {(candidate: { label?: string, url: string }) => Promise<any>} [options.resolve]
 * @param {(candidate: { label?: string, url: string }) => string} [options.title]
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function collectStreams(candidates, {
  http,
  log,
  name,
  providerId,
  userAgent,
  language,
  siteReferer,
  mp4Quality = '360p',
  maxStreams = 2,
  resolve,
  title,
}) {
  const streams = [];
  const seen = {};
  const list = Array.isArray(candidates) ? candidates : [];

  for (const candidate of list) {
    if (!candidate || !candidate.url) continue;
    if (streams.length >= maxStreams || http.remaining() < 18000) break;

    let resolved = null;

    try {
      resolved = resolve
        ? await resolve(candidate)
        : await resolveEmbeddedVideo(candidate.url, { http, log, referer: siteReferer });
    } catch (error) {
      log.debug(`Player ${candidate.url} failed: ${error && error.message ? error.message : error}`);
      continue;
    }

    if (!resolved || !resolved.url || seen[resolved.url]) continue;
    seen[resolved.url] = true;

    const isHls = /\.m3u8/i.test(resolved.url);
    let quality = resolved.quality || null;

    if (!quality && isHls) {
      quality = (await probeHlsQuality(http, resolved.url, resolved.referer)) || 'HD';
    }

    if (!quality) quality = isHls ? 'HD' : mp4Quality;

    streams.push(
      buildStream({
        name,
        provider: providerId,
        title: title ? title(candidate) : candidate.label || name,
        url: resolved.url,
        quality,
        type: isHls ? 'hls' : 'mp4',
        language,
        referer: resolved.referer,
        origin: resolved.origin || resolved.referer,
        subtitles: resolved.subtitles,
        userAgent,
      })
    );
  }

  log.debug(`Resolved ${streams.length} stream(s).`);
  return streams;
}
