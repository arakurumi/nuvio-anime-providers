import { createHianimeClient } from './client.js';
import { HIANIME } from './config.js';
import { resolveEmbed } from './embed.js';
import { createHttpClient } from '../shared/http.js';
import { createLogger } from '../shared/log.js';
import { buildStream, probeHlsQuality } from '../shared/media.js';
import { findBestMatch } from '../shared/selection.js';
import { parseContentId, resolveTitles } from '../shared/tmdb.js';
import { toPositiveInt } from '../shared/text.js';

/**
 * HiAnime provider entry point.
 *
 * Nuvio calls this with the content id, media type and episode coordinates.
 * Site data (search, episode list, servers, player payload) comes from
 * hianime.at and its player endpoints only.
 *
 * @param {string} contentId
 * @param {string} mediaType
 * @param {number|null} season
 * @param {number|null} episode
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function getStreams(contentId, mediaType, season, episode) {
  const log = createLogger(HIANIME.label);
  const http = createHttpClient({
    userAgent: HIANIME.userAgent,
    budgetMs: HIANIME.budgetMs,
    startedAt: Date.now(),
    log,
  });
  const client = createHianimeClient({ http, log });

  const type = mediaType === 'movie' ? 'movie' : 'tv';
  const seasonNumber = toPositiveInt(season);
  const episodeNumber = toPositiveInt(episode) || 1;

  // MAL ids can be played directly: the site's player is MAL based.
  const parsed = parseContentId(contentId);
  const effectiveEpisode = parsed.kind === 'mal' && !toPositiveInt(episode)
    ? parsed.seasonSuffix || episodeNumber
    : episodeNumber;

  log.info(`Request id=${contentId} type=${type} season=${seasonNumber} episode=${effectiveEpisode}`);

  if (parsed.kind === 'mal') {
    return resolveByMal(parsed.value, effectiveEpisode, type === 'movie', { http, log });
  }

  const meta = await resolveTitles({
    contentId,
    mediaType: type,
    season: seasonNumber,
    http,
    log,
    locale: 'en',
  });

  if (!meta.titles.length) {
    log.warn('No title candidates available; cannot search the site.');
    return [];
  }

  const match = await findBestMatch({
    titles: meta.titles,
    season: seasonNumber,
    search: client.search,
    log,
  });

  if (!match) {
    log.warn('No matching anime found on HiAnime.');
    return [];
  }

  const episodeMap = await client.getEpisodes(match.item);
  if (!episodeMap) return [];

  const resolvedEpisode = resolveEpisodeNumber(episodeMap, seasonNumber, episodeNumber, meta);
  if (!resolvedEpisode) {
    log.warn(`Episode ${episodeNumber} is not available for "${match.item.title}".`);
    return [];
  }

  const servers = await client.getServers(episodeMap.byNumber[resolvedEpisode]);
  if (!servers.length) {
    log.warn(`No servers returned for episode ${resolvedEpisode}.`);
    return [];
  }

  const label = type === 'movie' ? 'Movie' : `Episode ${resolvedEpisode}`;
  return resolveServers(servers, label, { http, log });
}

/**
 * Maps an episode within a season to the numbering used by the site entry.
 * Long-running entries (e.g. One Piece, Naruto) contain every season, so the
 * absolute number is rebuilt from the season lengths reported by TMDB.
 *
 * @param {{ byNumber: Record<number, string>, total: number }} episodeMap
 * @param {number|null} season
 * @param {number} episode
 * @param {{ seasonCounts: Record<number, number> }} meta
 * @returns {number|null}
 */
function resolveEpisodeNumber(episodeMap, season, episode, meta) {
  const counts = meta.seasonCounts || {};
  const expected = season ? counts[season] : null;
  const isCollection = season && season > 1 && expected && episodeMap.total > expected;

  if (isCollection) {
    let absolute = 0;
    let complete = true;

    for (let index = 1; index < season; index += 1) {
      const count = counts[index];
      if (!count) {
        complete = false;
        break;
      }
      absolute += count;
    }

    if (complete) {
      const candidate = absolute + episode;
      if (episodeMap.byNumber[candidate]) return candidate;
    }
  }

  return episodeMap.byNumber[episode] ? episode : null;
}

/**
 * @param {Array<{ name: string, type: string, url: string }>} servers
 * @param {string} label
 * @param {{ http: ReturnType<import('../shared/http.js').createHttpClient>, log: ReturnType<import('../shared/log.js').createLogger> }} options
 */
async function resolveServers(servers, label, { http, log }) {
  const streams = [];
  let attempts = 0;

  for (const server of servers) {
    if (attempts >= 3 || streams.length >= 2 || http.remaining() < 22000) break;
    attempts += 1;

    const resolved = await resolveEmbed(server.url, { http, log });
    if (!resolved) continue;

    const quality = await probeHlsQuality(http, resolved.url, resolved.origin);

    streams.push(
      buildStream({
        name: HIANIME.label,
        provider: HIANIME.providerId,
        title: `${label} • ${server.name} (${server.type.toUpperCase()})`,
        url: resolved.url,
        quality,
        type: 'hls',
        language: server.type === 'dub' ? 'en' : 'ja',
        referer: resolved.origin,
        origin: resolved.origin,
        subtitles: resolved.subtitles,
        userAgent: HIANIME.userAgent,
      })
    );
  }

  log.debug(`Resolved ${streams.length} stream(s).`);
  return streams;
}

/**
 * @param {string} malId
 * @param {number} episode
 * @param {boolean} isMovie
 * @param {{ http: ReturnType<import('../shared/http.js').createHttpClient>, log: ReturnType<import('../shared/log.js').createLogger> }} options
 */
async function resolveByMal(malId, episode, isMovie, { http, log }) {
  const streams = [];

  for (const kind of ['sub', 'dub']) {
    if (streams.length >= 2 || http.remaining() < 22000) break;

    const embedUrl = `${HIANIME.embedBaseUrl}/stream/mal/${malId}/${episode}/${kind}`;
    const resolved = await resolveEmbed(embedUrl, { http, log });
    if (!resolved) continue;

    const quality = await probeHlsQuality(http, resolved.url, resolved.origin);

    streams.push(
      buildStream({
        name: HIANIME.label,
        provider: HIANIME.providerId,
        title: `${isMovie ? 'Movie' : `Episode ${episode}`} • ZokoAnime (${kind.toUpperCase()})`,
        url: resolved.url,
        quality,
        type: 'hls',
        language: kind === 'dub' ? 'en' : 'ja',
        referer: resolved.origin,
        origin: resolved.origin,
        subtitles: resolved.subtitles,
        userAgent: HIANIME.userAgent,
      })
    );
  }

  log.debug(`Direct MAL playback resolved ${streams.length} stream(s).`);
  return streams;
}
