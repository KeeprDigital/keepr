/** How deep a cause chain is walked; a cycle stops here too. */
const MAX_CAUSE_DEPTH = 8;

/**
 * Whether a write failed on a unique index, wherever in its cause chain the
 * driver's refusal sits: Drizzle wraps it in a query error that names only the
 * query. `index` narrows it to one index, by the name or the columns SQLite
 * reports (an expression index by name, a column index by its columns).
 */
export function isUniqueConstraintViolation(error: unknown, index?: string): boolean {
	let current: unknown = error;
	for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth++) {
		if (
			current.message.includes('UNIQUE constraint failed') &&
			(index === undefined || current.message.includes(index))
		)
			return true;
		current = current.cause;
	}
	return false;
}
