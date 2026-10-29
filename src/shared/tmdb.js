import { cleanText, normalize, ordinal } from './text.js';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const ID_PREFIX = /^(?:tmdb|movie|series|show)[:/]/i;
const TRACKER_ID = /^(mal|anilist|kitsu|anidb|tvdb):(\d+)(?::(\d+))?$/i;
const IMDB_ID = /^(?:imdb:)?(tt\d+)$/i;

/**
 * Nuvio injects `TMDB_API_KEY` from its own settings (there is always a
 * built-in key). The plugin never ships or hardcodes a third-party key.
 *
 * @returns {string}
 */
export function readTmdbKey() {
  if (typeof globalThis !== 'undefined' && globalThis.TMDB_API_KEY) {
    return String(globalThis.TMDB_API_KEY);
  }
  return '';
}

/**
 * @param {unknown} rawId
 * @returns {{ kind: string, value: string, seasonSuffix: number|null }}
 */
export function parseContentId(rawId) {
  const raw = cleanText(rawId);

  const tracker = raw.match(TRACKER_ID);
  if (tracker) {
    return {
      kind: tracker[1].toLowerCase(),
      value: tracker[2],
      seasonSuffix: tracker[3] ? Number.parseInt(tracker[3], 10) : null,
    };
  }

  const imdb = raw.match(IMDB_ID);
  if (imdb) return { kind: 'imdb', value: imdb[1], seasonSuffix: null };

  const numeric = raw.replace(ID_PREFIX, '');
  if (/^\d+$/.test(numeric)) return { kind: 'tmdb', value: numeric, seasonSuffix: null };

  return { kind: 'unknown', value: raw, seasonSuffix: null };
}

/**
 * Resolves the content id that Nuvio passes into a list of titles.
 *
 * Nuvio only sends an id, so for TMDB/IMDb ids the titles are read from TMDB
 * with the key injected by the app. This is the only metadata lookup, and it
 * is the app's own channel: no AniList, Kitsu, Jikan or other third-party
 * service is called. `mal:` ids are returned as-is so HiAnime can play them
 * without any lookup.
 *
 * @param {object} options
 * @param {string} options.contentId
 * @param {string} options.mediaType
 * @param {number|null} options.season
 * @param {ReturnType<import('./http.js').createHttpClient>} options.http
 * @param {ReturnType<import('./log.js').createLogger>} options.log
 * @param {string} [options.locale]
 * @returns {Promise<{ titles: string[], seasonCounts: Record<number, number>, name: string, malId: string|null, seasonSuffix: number|null }>}
 */
export async function resolveTitles({ contentId, mediaType, season, http, log, locale = 'en' }) {
  const parsed = parseContentId(contentId);
  const result = {
    titles: [],
    seasonCounts: {},
    name: '',
    malId: null,
    seasonSuffix: parsed.seasonSuffix,
  };

  if (parsed.kind === 'mal') {
    result.malId = parsed.value;
    return result;
  }

  if (parsed.kind !== 'tmdb' && parsed.kind !== 'imdb') {
    log.warn(`Unsupported content id "${contentId}": only TMDB/IMDb/mal ids can be resolved without third-party metadata.`);
    return result;
  }

  const apiKey = readTmdbKey();
  if (!apiKey) {
    log.error('TMDB_API_KEY is not available; Nuvio normally injects it.');
    return result;
  }

  const type = mediaType === 'movie' ? 'movie' : 'tv';
  let tmdbId = parsed.value;

  if (parsed.kind === 'imdb') {
    const found = await http.json(
      `${TMDB_API_BASE}/find/${encodeURIComponent(tmdbId)}?api_key=${apiKey}&external_source=imdb_id`
    );
    const list = found ? (type === 'movie' ? found.movie_results : found.tv_results) : null;
    const first = list && list.length ? list[0] : null;

    if (!first || !first.id) {
      log.warn(`IMDb id ${tmdbId} could not be resolved to a TMDB id.`);
      return result;
    }
    tmdbId = String(first.id);
  }

  const url =
    `${TMDB_API_BASE}/${type}/${encodeURIComponent(tmdbId)}` +
    `?api_key=${apiKey}&language=en-US&append_to_response=alternative_titles,translations`;

  const details = await http.json(url);
  if (!details) {
    log.warn(`TMDB details are unavailable for ${tmdbId}.`);
    return result;
  }

  const name = type === 'movie' ? details.title : details.name;
  const original = type === 'movie' ? details.original_title : details.original_name;

  addTitle(result.titles, name);
  addTitle(result.titles, original);

  if (type === 'tv' && Array.isArray(details.seasons)) {
    for (const entry of details.seasons) {
      if (entry && entry.season_number > 0 && entry.episode_count > 0) {
        result.seasonCounts[entry.season_number] = entry.episode_count;
      }
    }
  }

  const alternativeBlock = details.alternative_titles || {};
  const alternatives = type === 'movie' ? alternativeBlock.titles : alternativeBlock.results;
  if (Array.isArray(alternatives)) {
    for (const entry of alternatives) {
      if (entry) addTitle(result.titles, entry.title);
    }
  }

  addSeasonVariants(result.titles, type, season);

  const localized = findTranslation(details.translations, locale);
  if (localized) prioritizeTitle(result.titles, 1, localized);

  result.name = cleanText(name || original);
  return result;
}

/**
 * @param {string[]} titles
 * @param {unknown} value
 */
function addTitle(titles, value) {
  const text = cleanText(value);
  if (!text) return;

  const key = normalize(text);
  if (!key) return;
  for (const existing of titles) {
    if (normalize(existing) === key) return;
  }
  titles.push(text);
}

/**
 * Moves a title to the requested position (or inserts it). This keeps the
 * localized/season titles at the front even when TMDB already listed them
 * among the alternative titles.
 *
 * @param {string[]} titles
 * @param {number} index
 * @param {unknown} value
 */
function prioritizeTitle(titles, index, value) {
  const text = cleanText(value);
  if (!text) return;

  const key = normalize(text);
  if (!key) return;

  let existingIndex = -1;
  for (let position = 0; position < titles.length; position += 1) {
    if (normalize(titles[position]) === key) {
      existingIndex = position;
      break;
    }
  }

  if (existingIndex !== -1) {
    if (existingIndex <= index) return;
    titles.splice(existingIndex, 1);
  }

  titles.splice(Math.min(index, titles.length), 0, text);
}

/**
 * @param {any} block
 * @param {string} locale
 * @returns {string}
 */
function findTranslation(block, locale) {
  const translations = block && Array.isArray(block.translations) ? block.translations : [];
  for (const entry of translations) {
    if (entry && entry.iso_639_1 === locale && entry.data) {
      return cleanText(entry.data.name || entry.data.title);
    }
  }
  return '';
}

/**
 * Adds "Title Season N", "Title 2nd Season" and "Title SN" near the front so
 * they are queried before unrelated alternative titles.
 *
 * @param {string[]} titles
 * @param {string} mediaType
 * @param {number|null} season
 */
function addSeasonVariants(titles, mediaType, season) {
  if (mediaType === 'movie' || !season || season <= 1 || !titles.length) return;

  const base = titles[0];
  const variants = [
    `${base} Season ${season}`,
    `${base} ${ordinal(season)} Season`,
    `${base} S${season}`,
  ];

  for (let index = variants.length - 1; index >= 0; index -= 1) {
    prioritizeTitle(titles, 1, variants[index]);
  }
}
