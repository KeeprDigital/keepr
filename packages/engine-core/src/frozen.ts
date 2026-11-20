/**
 * Freezes a value and every object and list inside it, and returns it. Exported Configurations
 * are shared by every caller, so none may change one under another.
 */
export function deepFrozen<T>(value: T): T {
	if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
		for (const inner of Object.values(value)) deepFrozen(inner);
		Object.freeze(value);
	}
	return value;
}
