import { createOploverzClient, seriesSlug } from './client.js';
import { OPLOVERZ } from './config.js';
import { createHttpClient } from '../shared/http.js';
import { createLogger } from '../shared/log.js';
import { pickEpisode } from '../shared/episodes.js';
import { collectStreams } from '../shared/playback.js';
import { findBestMatch } from '../shared/selection.js';
import { resolveTitles } from '../shared/tmdb.js';
import { toPositiveInt } from '../shared/text.js';

/**
 * Oploverz provider entry point.
 *
 * Site data (search, series page, episode page, players) comes from
 * oploverz.ch only.
 *
 * @param {string} contentId
 * @param {string} mediaType
 * @param {number|null} season
 * @param {number|null} episode
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function getStreams(contentId, mediaType, season, episode) {
  const log = createLogger(OPLOVERZ.label);
  const http = createHttpClient({
    userAgent: OPLOVERZ.userAgent,
    budgetMs: OPLOVERZ.budgetMs,
    startedAt: Date.now(),
    log,
  });
  const client = createOploverzClient({ http, log });

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
    locale: OPLOVERZ.locale,
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
    log.warn('No matching series found on Oploverz.');
    return [];
  }

  const episodes = await client.getEpisodes(match.item.url);
  let picked = pickEpisode(episodes, episodeNumber, seasonNumber, meta.seasonCounts);

  // Movie pages sometimes only expose the player on the entry page itself.
  if (!picked && type === 'movie') picked = { number: 1, url: match.item.url };

  let episodeUrl = picked ? picked.url : '';
  const resolvedNumber = picked ? picked.number : episodeNumber;

  if (!episodeUrl) {
    // Episode pages on Oploverz follow a stable slug pattern even when the
    // series page only lists the most recent episodes.
    const slug = seriesSlug(match.item.url);
    if (slug) {
      episodeUrl = `${OPLOVERZ.baseUrl}/${slug}-episode-${episodeNumber}-subtitle-indonesia/`;
      log.debug(`Trying constructed episode url ${episodeUrl}`);
    }
  }

  if (!episodeUrl) {
    log.warn(`Episode ${episodeNumber} is not available for "${match.item.title}".`);
    return [];
  }

  const candidates = await client.getCandidates(episodeUrl);
  if (!candidates.length) {
    log.warn(`No players returned for episode ${resolvedNumber}.`);
    return [];
  }

  const displayTitle = match.item.title;
  const label = type === 'movie' ? 'Movie' : `Episode ${resolvedNumber}`;

  return collectStreams(candidates, {
    http,
    log,
    name: OPLOVERZ.label,
    providerId: OPLOVERZ.providerId,
    userAgent: OPLOVERZ.userAgent,
    language: 'id',
    siteReferer: `${OPLOVERZ.baseUrl}/`,
    mp4Quality: '360p',
    maxStreams: 2,
    title: (candidate) => `${displayTitle} • ${label} • ${candidate.label}`,
  });
}
