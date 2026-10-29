import { toPositiveInt } from "./text.js";

/**
 * Reads an episode number from a site label such as "Episode 12", "Ep. 5" or
 * "One Piece Episode 1180 Subtitle Indonesia".
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function episodeNumberFromText(value) {
	const text = String(value === null || value === undefined ? "" : value);
	const match = text.match(/\b(?:episode|ep\.?)\s*0*(\d+)\b/i);
	return match ? toPositiveInt(match[1]) : null;
}

/**
 * Reads an episode number from a url such as `/one-piece-episode-1180/`.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function episodeNumberFromUrl(value) {
	const match = String(
		value === null || value === undefined ? "" : value,
	).match(/(?:episode|ep)[-_/]?0*(\d+)/i);
	return match ? toPositiveInt(match[1]) : null;
}

/**
 * Picks the requested episode from a site episode list.
 *
 * Long-running entries (e.g. One Piece) often contain every season in one
 * page, so the absolute number is rebuilt from the per-season lengths that
 * TMDB reports. Movies and single-video pages fall back to their only entry.
 *
 * @param {Array<{ number: number, url: string, title?: string }>} entries
 * @param {number} episode
 * @param {number|null} season
 * @param {Record<number, number>} [seasonCounts]
 * @returns {{ number: number, url: string, title?: string }|null}
 */
export function pickEpisode(entries, episode, season, seasonCounts) {
	const list = (Array.isArray(entries) ? entries : []).filter(
		(entry) => entry?.url,
	);
	if (!list.length) return null;

	const counts = seasonCounts || {};
	const expected = season ? counts[season] : null;
	const isCollection = Boolean(
		season && season > 1 && expected && list.length > expected,
	);

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
			const target = absolute + episode;
			const found = list.find((entry) => entry.number === target);
			if (found) return Object.assign({}, found, { number: target });
		}
	}

	const direct = list.find((entry) => entry.number === episode);
	if (direct) return direct;

	// Movies and some OVAs publish a single page without a reliable number.
	if (episode === 1 && list.length === 1) return list[0];

	return null;
}
