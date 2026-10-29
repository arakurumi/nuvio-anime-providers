/**
 * Logger that prefixes every message with the provider name.
 * Nuvio forwards console.* calls to logcat under the "PluginRuntime" tag.
 *
 * @param {string} tag
 */
export function createLogger(tag) {
	const prefix = `[${tag}]`;

	function write(level, args) {
		const target = console[level] || console.log;
		target(prefix, ...args);
	}

	return {
		debug(...args) {
			write("log", args);
		},
		error(...args) {
			write("error", args);
		},
		info(...args) {
			write("info", args);
		},
		warn(...args) {
			write("warn", args);
		},
	};
}
