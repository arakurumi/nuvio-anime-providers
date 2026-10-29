import { loadHtml } from '../shared/dom.js';
import { absoluteUrl } from '../shared/media.js';
import { cleanText } from '../shared/text.js';
import { OTAKUDESU } from './config.js';

/**
 * @param {string} url
 * @returns {number}
 */
function episodeNumberFromUrl(url) {
  const match = String(url || '').match(/\/episode\/([^/?#]+)/i);
  const slug = match ? match[1] : '';
  const number = slug.match(/episode[-_ ]?(\d+)/i);
  return number ? Number.parseInt(number[1], 10) : 0;
}

/**
 * @param {string} text
 * @returns {number}
 */
function episodeNumberFromText(text) {
  const match = String(text || '').match(/episode\s+(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

/**
 * Site client for OtakuDesu. The WordPress REST API of the site is restricted
 * to logged-in users, so the public search page and the anime/episode pages
 * are the site interfaces this provider uses.
 *
 * @param {object} options
 * @param {ReturnType<import('../shared/http.js').createHttpClient>} options.http
 * @param {ReturnType<import('../shared/log.js').createLogger>} options.log
 */
export function createOtakuDesuClient({ http, log }) {
  const baseUrl = OTAKUDESU.baseUrl;
  const siteReferer = `${baseUrl}/`;

  /**
   * @param {string} query
   * @returns {Promise<Array<{ title: string, url: string }>>}
   */
  async function search(query) {
    const html = await http.text(`${baseUrl}/?s=${encodeURIComponent(query)}&post_type=anime`, {
      headers: { Referer: siteReferer },
    });
    if (!html) return [];

    const $ = loadHtml(html);
    const results = [];

    $('ul.chivsrc li').each(function (index, element) {
      const item = $(element);
      const link = item.find('h2 a').first();
      if (!link || !link.length) return;

      const href = link.attr('href') || '';
      if (href.indexOf('/anime/') === -1) return;

      const title = cleanText(link.text());
      if (!title) return;

      results.push({ title, url: absoluteUrl(href, baseUrl) });
    });

    log.debug(`Search "${query}" returned ${results.length} result(s).`);
    return results;
  }

  /**
   * @param {string} animeUrl
   * @returns {Promise<{ numbered: Array<{ number: number, url: string }>, unnumbered: string[], total: number }|null>}
   */
  async function getEpisodes(animeUrl) {
    const html = await http.text(animeUrl, { headers: { Referer: siteReferer } });
    if (!html) return null;

    const $ = loadHtml(html);
    const numbered = [];
    const unnumbered = [];
    const seen = {};

    $('a[href*="/episode/"]').each(function (index, element) {
      const anchor = $(element);
      const href = anchor.attr('href');
      if (!href) return;

      const url = absoluteUrl(href, baseUrl);
      if (!url || seen[url]) return;
      seen[url] = true;

      const number = episodeNumberFromUrl(url) || episodeNumberFromText(cleanText(anchor.text()));
      if (number > 0) numbered.push({ number, url });
      else unnumbered.push(url);
    });

    if (!numbered.length && !unnumbered.length) {
      log.warn(`No episode links found at ${animeUrl}`);
      return null;
    }

    log.debug(`Anime page exposes ${numbered.length} numbered episode(s).`);
    return { numbered, unnumbered, total: numbered.length };
  }

  /**
   * @param {string} episodeUrl
   * @returns {Promise<string|null>}
   */
  async function getEmbedUrl(episodeUrl) {
    const html = await http.text(episodeUrl, { headers: { Referer: siteReferer } });
    if (!html) return null;

    const $ = loadHtml(html);
    let source = $('#pembed iframe').attr('src') || $('.responsive-embed-stream iframe').attr('src') || '';

    if (!source) {
      const match = html.match(/id=["']pembed["'][\s\S]{0,1200}?<iframe[^>]+src=["']([^"']+)["']/i);
      if (match) source = match[1];
    }

    if (!source) {
      log.debug(`No player iframe at ${episodeUrl}`);
      return null;
    }

    return absoluteUrl(cleanText(source), baseUrl);
  }

  return { search, getEpisodes, getEmbedUrl };
}
