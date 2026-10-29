import { createOtakuDesuClient } from './client.js';
import { OTAKUDESU } from './config.js';
import { resolveVideo } from './player.js';
import { createHttpClient } from '../shared/http.js';
import { createLogger } from '../shared/log.js';
import { buildStream, originOf, probeHlsQuality } from '../shared/media.js';
import { findBestMatch } from '../shared/selection.js';
import { resolveTitles } from '../shared/tmdb.js';
import { cleanCandidate, cleanText, toPositiveInt } from '../shared/text.js';

/**
 * OtakuDesu provider entry point.
 *
 * Site data (search, anime page, episode page, player iframes) comes from
 * otakudesu.blog and the players the site embeds.
 *
 * @param {string} contentId
 * @param {string} mediaType
 * @param {number|null} season
 * @param {number|null} episode
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function getStreams(contentId, mediaType, season, episode) {
  const log = createLogger(OTAKUDESU.label);
  const http = createHttpClient({
    userAgent: OTAKUDESU.userAgent,
    budgetMs: OTAKUDESU.budgetMs,
    startedAt: Date.now(),
    log,
  });
  const client = createOtakuDesuClient({ http, log });

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
    locale: 'id',
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
    log.warn('No matching anime found on OtakuDesu.');
    return [];
  }

  const episodeData = await client.getEpisodes(match.item.url);
  if (!episodeData) return [];

  const pickedEpisode = pickEpisode(episodeData, episodeNumber, seasonNumber, meta);
  if (!pickedEpisode) {
    log.warn(`Episode ${episodeNumber} is not available for "${match.item.title}".`);
    return [];
  }

  const embedUrl = await client.getEmbedUrl(pickedEpisode.url);
  if (!embedUrl) return [];

  const resolved = await resolveVideo(embedUrl, { http, log });
  if (!resolved) {
    log.warn('The embedded player did not expose a playable url.');
    return [];
  }

  const isHls = resolved.url.indexOf('.m3u8') !== -1;
  const quality = isHls
    ? (await probeHlsQuality(http, resolved.url, resolved.referer || originOf(embedUrl))) || 'HD'
    : '360p';

  const displayTitle = cleanText(cleanCandidate(match.item.title)) || meta.name || OTAKUDESU.label;
  const label = type === 'movie' ? 'Movie' : `Episode ${pickedEpisode.number}`;

  return [
    buildStream({
      name: OTAKUDESU.label,
      provider: OTAKUDESU.providerId,
      title: `${displayTitle} • ${label} • ${quality}`,
      url: resolved.url,
      quality,
      type: isHls ? 'hls' : 'mp4',
      language: 'id',
      referer: resolved.referer,
      origin: resolved.referer,
      userAgent: OTAKUDESU.userAgent,
    }),
  ];
}

/**
 * Chooses the episode link, preferring absolute numbering when the anime page
 * is a single collection that spans several seasons.
 *
 * @param {{ numbered: Array<{ number: number, url: string }>, unnumbered: string[], total: number }} episodeData
 * @param {number} episode
 * @param {number|null} season
 * @param {{ seasonCounts: Record<number, number> }} meta
 * @returns {{ url: string, number: number }|null}
 */
function pickEpisode(episodeData, episode, season, meta) {
  const counts = meta.seasonCounts || {};
  const expected = season ? counts[season] : null;
  const isCollection = season && season > 1 && expected && episodeData.total > expected;

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
      const number = absolute + episode;
      const candidate = episodeData.numbered.find((entry) => entry.number === number);
      if (candidate) return { url: candidate.url, number };
    }
  }

  const direct = episodeData.numbered.find((entry) => entry.number === episode);
  if (direct) return { url: direct.url, number: direct.number };

  // Movies and some OVAs publish a single episode page without a number.
  if (episode === 1 && episodeData.unnumbered.length === 1) {
    return { url: episodeData.unnumbered[0], number: 1 };
  }

  return null;
}
