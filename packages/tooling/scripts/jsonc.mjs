/**
 * JSON with comments and trailing commas, as Wrangler configs and deploy
 * descriptors are written. String-aware, so a `//` inside a value survives;
 * a trailing comma may be followed by a comment, as Wrangler accepts.
 *
 * @param {string} text
 * @returns {any} the parsed value
 */
export function parseJsonc(text) {
	/** @type {string[]} the text without comments, a string as one token */
	const tokens = [];
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === '"') {
			const start = index;
			for (index += 1; index < text.length && text[index] !== '"'; index += 1) {
				if (text[index] === '\\') index += 1;
			}
			tokens.push(text.slice(start, index + 1));
		} else if (char === '/' && text[index + 1] === '/') {
			while (index < text.length && text[index] !== '\n') index += 1;
			tokens.push('\n');
		} else if (char === '/' && text[index + 1] === '*') {
			index = text.indexOf('*/', index + 2);
			if (index < 0) break;
			index += 1;
			tokens.push(' ');
		} else {
			tokens.push(/** @type {string} */ (char));
		}
	}
	// With the comments gone, a comma is trailing when only space stands
	// between it and the bracket it closes.
	let out = '';
	for (let index = 0; index < tokens.length; index += 1) {
		const token = /** @type {string} */ (tokens[index]);
		if (token === ',') {
			let next = index + 1;
			while (next < tokens.length && /^\s$/.test(/** @type {string} */ (tokens[next]))) next += 1;
			if (tokens[next] === ']' || tokens[next] === '}') continue;
		}
		out += token;
	}
	return JSON.parse(out);
}
