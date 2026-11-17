/**
 * JSON with comments and trailing commas, as Wrangler configs and deploy
 * descriptors are written. String-aware, so a `//` inside a value survives.
 *
 * @param {string} text
 * @returns {any} the parsed value
 */
export function parseJsonc(text) {
	let out = '';
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === '"') {
			const start = index;
			for (index += 1; index < text.length && text[index] !== '"'; index += 1) {
				if (text[index] === '\\') index += 1;
			}
			out += text.slice(start, index + 1);
		} else if (char === '/' && text[index + 1] === '/') {
			while (index < text.length && text[index] !== '\n') index += 1;
			out += '\n';
		} else if (char === '/' && text[index + 1] === '*') {
			index = text.indexOf('*/', index + 2);
			if (index < 0) break;
			index += 1;
		} else if (char !== ',' || !/^\s*[\]}]/.test(text.slice(index + 1))) {
			out += char;
		}
	}
	return JSON.parse(out);
}
