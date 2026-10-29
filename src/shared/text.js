/**
 * Decodes the HTML entities that WordPress titles and attributes contain.
 *
 * @param {unknown} value
 * @returns {string}
 */
function decodeEntities(value) {
	return String(value === null || value === undefined ? "" : value)
		.replace(/&#x([0-9a-f]+);/gi, (_match, hex) =>
			String.fromCharCode(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_match, decimal) =>
			String.fromCharCode(Number.parseInt(decimal, 10)),
		)
		.replace(/&nbsp;/gi, " ")
		.replace(/&quot;/gi, '"')
		.replace(/&#0*39;|&apos;/gi, "'")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&amp;/gi, "&");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function cleanText(value) {
	return decodeEntities(value).replace(/\s+/g, " ").trim();
}

/**
 * Lowercases, strips diacritics and punctuation, and collapses whitespace.
 * Used for stable comparisons between site titles and TMDB titles.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalize(value) {
	let text = String(
		value === null || value === undefined ? "" : value,
	).toLowerCase();

	try {
		text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
	} catch (_error) {
		// Older QuickJS builds may not implement String.prototype.normalize.
	}

	text = text.replace(/&/g, " and ").replace(/['`\u2019]/g, "");
	return text.replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Removes decorations that sites add to listing titles, e.g.
 * "(Episode 1 - 24)", "Subtitle Indonesia", "(BD)".
 *
 * @param {unknown} value
 * @returns {string}
 */
export function cleanCandidate(value) {
	let text = String(value === null || value === undefined ? "" : value);
	text = text.replace(/\([^)]*episode[^)]*\)/gi, " ");
	text = text.replace(
		/\([^)]*(?:sub|dub|batch|bd|bluray|movie|tv|ova|ona|special)[^)]*\)/gi,
		" ",
	);
	text = text.replace(/subtitle\s+indonesia/gi, " ");
	text = text.replace(/\bsub\s*indo\b/gi, " ");
	text = text.replace(/\bdub\s*indo\b/gi, " ");
	return text.replace(/\s+/g, " ").trim();
}

/**
 * Normalizes season markers so "2nd Season", "S2" and "Season 2" compare
 * equal after `normalize()`.
 *
 * @param {string} value
 * @returns {string}
 */
export function canonicalSeason(value) {
	let text = String(value === null || value === undefined ? "" : value);
	text = text.replace(/\b(\d+)(?:st|nd|rd|th)\s+season\b/g, "season $1");
	text = text.replace(/\bs(\d+)\b/g, "season $1");
	return text;
}

/**
 * @param {number} value
 * @returns {string}
 */
export function ordinal(value) {
	const mod100 = value % 100;
	if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
	if (value % 10 === 1) return `${value}st`;
	if (value % 10 === 2) return `${value}nd`;
	if (value % 10 === 3) return `${value}rd`;
	return `${value}th`;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
export function toPositiveInt(value) {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
