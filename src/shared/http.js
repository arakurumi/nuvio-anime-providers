const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Rejects a request that takes too long. The runtime timeout would otherwise
 * be consumed by a single hanging page.
 *
 * @param {Promise<any>} promise
 * @param {number} ms
 * @returns {Promise<any>}
 */
function withTimeout(promise, ms) {
  if (typeof setTimeout !== 'function' || !(ms > 0)) return promise;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`request timed out after ${ms}ms`)), ms);
    const clear = typeof clearTimeout === 'function' ? clearTimeout : function () {};

    promise.then(
      (value) => {
        clear(timer);
        resolve(value);
      },
      (error) => {
        clear(timer);
        reject(error);
      }
    );
  });
}

/**
 * HTTP client shared by the providers.
 *
 * Nuvio exposes a browser-like `fetch` in the QuickJS sandbox:
 * `response.ok`, `response.status`, `response.text()`. A network failure is
 * reported as `status === 0` (it does not throw), so both cases are handled.
 *
 * @param {object} options
 * @param {string} options.userAgent
 * @param {string} [options.accept]
 * @param {Record<string, string>} [options.defaultHeaders]
 * @param {number} [options.budgetMs]
 * @param {number} [options.startedAt]
 * @param {ReturnType<import('./log.js').createLogger>} options.log
 */
export function createHttpClient({
  userAgent,
  accept = HTML_ACCEPT,
  defaultHeaders = {},
  budgetMs = 50000,
  startedAt = Date.now(),
  log,
}) {
  const remaining = () => budgetMs - (Date.now() - startedAt);

  /**
   * @param {string} url
   * @param {{ method?: string, headers?: Record<string, string>, body?: string }} [options]
   * @returns {Promise<string|null>}
   */
  async function text(url, options = {}) {
    if (remaining() <= 0) {
      log.warn(`Time budget exhausted, skipping ${url}`);
      return null;
    }

    const headers = Object.assign(
      { 'User-Agent': userAgent, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' },
      defaultHeaders,
      options.headers || {}
    );

    const init = { method: options.method || 'GET', headers };
    if (options.body !== undefined && options.body !== null) init.body = options.body;

    try {
      const timeout = Math.min(REQUEST_TIMEOUT_MS, Math.max(1000, remaining()));
      const response = await withTimeout(fetch(url, init), timeout);
      if (!response || response.status === 0 || !response.ok) {
        log.warn(`HTTP ${response ? response.status : 'no-response'} for ${url}`);
        return null;
      }
      return (await response.text()) || '';
    } catch (error) {
      log.warn(`Request failed for ${url}: ${error && error.message ? error.message : error}`);
      return null;
    }
  }

  /**
   * @param {string} url
   * @param {{ method?: string, headers?: Record<string, string>, body?: string }} [options]
   * @returns {Promise<any|null>}
   */
  async function json(url, options = {}) {
    const payload = await text(
      url,
      Object.assign({}, options, {
        headers: Object.assign({ Accept: 'application/json' }, options.headers || {}),
      })
    );
    if (!payload) return null;

    try {
      return JSON.parse(payload);
    } catch (error) {
      log.warn(`Invalid JSON from ${url}`);
      return null;
    }
  }

  return { text, json, remaining, startedAt, budgetMs };
}
