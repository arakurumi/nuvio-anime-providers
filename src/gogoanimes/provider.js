import { createGogoanimesClient } from './client.js';
import { GOGOANIMES } from './config.js';
import { resolveMegaplay } from './player.js';
import { createHttpClient } from '../shared/http.js';
import { createLogger } from '../shared/log.js';
import { collectStreams } from '../shared/playback.js';
import { findBestMatch } from '../shared/selection.js';
import { resolveTitles } from '../shared/tmdb.js';
import { toPositiveInt } from '../shared/text.js';

/**
 * GogoAnimes provider entry point.
 *
 * Site data comes from gogoanimes.cv, its WordPress AJAX episode endpoint and
 * the MegaPlay player the site embeds.
 *
 * @param {string} contentId
 * @param {string} mediaType
 * @param {number|null} season
 * @param {number|null} episode
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function getStreams(contentId, mediaType, season, episode) {
  const log = createLogger(GOGOANIMES.label);
  const http = createHttpClient({
    userAgent: GOGOANIMES.userAgent,
    budgetMs: GOGOANIMES.budgetMs,
    startedAt: Date.now(),
    log,
  });
  const client = createGogoanimesClient({ http, log });

  const type = mediaType === 'movie' ? 'movie' : 'tv';
  const seasonNumber = toPositiveInt(season);
  const episodeNumber = toPositiveInt(episode) || 1;

  log.info(`Request id=${contentId} type=${type} season=${seasonNumber} episode=${episodeNumber}`);

  const meta = await resolveTitles({
    contentId,
    mediaType: type,
    season: seasonNumber,
    http,
    log,
    locale: GOGOANIMES.locale,
  });

  if (!meta.titles.length) {
    log.warn('No title candidates available; cannot search the site.');
    return [];
  }

  const match = await findBestMatch({
    titles: meta.titles,
    season: seasonNumber,
    maxQueries: 5,
    search: client.search,
    log,
  });

  if (!match) {
    log.warn('No matching series found on GogoAnimes.');
    return [];
  }

  const targetEpisode = resolveTargetEpisode(episodeNumber, seasonNumber, match.item.title, meta);
  const picked = await client.getEpisode(match.item.url, targetEpisode);

  if (!picked) {
    log.warn(`Episode ${targetEpisode} is not available for "${match.item.title}".`);
    return [];
  }

  const candidates = await client.getCandidates(picked.url);
  if (!candidates.length) {
    log.warn(`No players returned for episode ${picked.number}.`);
    return [];
  }

  const label = type === 'movie' ? 'Movie' : `Episode ${picked.number}`;

  return collectStreams(candidates, {
    http,
    log,
    name: GOGOANIMES.label,
    providerId: GOGOANIMES.providerId,
    userAgent: GOGOANIMES.userAgent,
    language: 'en',
    siteReferer: `${GOGOANIMES.baseUrl}/`,
    mp4Quality: 'HD',
    maxStreams: 2,
    resolve: (candidate) => resolveMegaplay(candidate.url, { http, log }),
    title: (candidate) => `${match.item.title} • ${label} • ${candidate.label}`,
  });
}

/**
 * GogoAnimes numbers long-running entries continuously. When the matched
 * entry spans several seasons, the absolute episode number is rebuilt from
 * the per-season lengths reported by TMDB.
 *
 * @param {number} episode
 * @param {number|null} season
 * @param {string} title
 * @param {{ seasonCounts: Record<number, number>, name: string }} meta
 * @returns {number}
 */
function resolveTargetEpisode(episode, season, title, meta) {
  const counts = meta.seasonCounts || {};
  const expected = season ? counts[season] : null;

  if (!season || season <= 1 || !expected) return episode;

  let absolute = 0;

  for (let index = 1; index < season; index += 1) {
    const count = counts[index];
    if (!count) return episode;
    absolute += count;
  }

  return absolute + episode;
}
