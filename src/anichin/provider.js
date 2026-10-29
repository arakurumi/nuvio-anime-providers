import { pickEpisode } from "../shared/episodes.js";
import { createHttpClient } from "../shared/http.js";
import { createLogger } from "../shared/log.js";
import { collectStreams } from "../shared/playback.js";
import { findBestMatch } from "../shared/selection.js";
import { toPositiveInt } from "../shared/text.js";
import { resolveTitles } from "../shared/tmdb.js";
import { createAnichinClient } from "./client.js";
import { ANICHIN } from "./config.js";
import { resolveAnichinPlayer } from "./player.js";

/**
 * Anichin provider entry point.
 *
 * Site data comes from anichin.moe and the players the site embeds (ok.ru by
 * default).
 *
 * @param {string} contentId
 * @param {string} mediaType
 * @param {number|null} season
 * @param {number|null} episode
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function getStreams(contentId, mediaType, season, episode) {
	const log = createLogger(ANICHIN.label);
	const http = createHttpClient({
		budgetMs: ANICHIN.budgetMs,
		log,
		startedAt: Date.now(),
		userAgent: ANICHIN.userAgent,
	});
	const client = createAnichinClient({ http, log });

	const type = mediaType === "movie" ? "movie" : "tv";
	const seasonNumber = toPositiveInt(season);
	const episodeNumber = toPositiveInt(episode) || 1;

	log.info(
		`Request id=${contentId} type=${type} season=${seasonNumber} episode=${episodeNumber}`,
	);

	const meta = await resolveTitles({
		contentId,
		http,
		locale: ANICHIN.locale,
		log,
		mediaType: type,
		season: seasonNumber,
	});

	if (!meta.titles.length) {
		log.warn("No title candidates available; cannot search the site.");
		return [];
	}

	const match = await findBestMatch({
		log,
		maxQueries: 5,
		search: client.search,
		season: seasonNumber,
		titles: meta.titles,
	});

	if (!match) {
		log.warn("No matching series found on Anichin.");
		return [];
	}

	const episodes = await client.getEpisodes(match.item.url);
	let picked = pickEpisode(
		episodes,
		episodeNumber,
		seasonNumber,
		meta.seasonCounts,
	);

	// Movie pages sometimes only expose the player on the entry page itself.
	if (!picked && type === "movie") picked = { number: 1, url: match.item.url };

	if (!picked) {
		log.warn(
			`Episode ${episodeNumber} is not available for "${match.item.title}".`,
		);
		return [];
	}

	const candidates = await client.getCandidates(picked.url);
	if (!candidates.length) {
		log.warn(`No players returned for episode ${picked.number}.`);
		return [];
	}

	const label = type === "movie" ? "Movie" : `Episode ${picked.number}`;

	return collectStreams(candidates, {
		http,
		language: "id",
		log,
		maxStreams: 2,
		mp4Quality: "HD",
		name: ANICHIN.label,
		providerId: ANICHIN.providerId,
		resolve: (candidate) => resolveAnichinPlayer(candidate, { http, log }),
		siteReferer: `${ANICHIN.baseUrl}/`,
		title: (candidate) => `${match.item.title} • ${label} • ${candidate.label}`,
		userAgent: ANICHIN.userAgent,
	});
}
