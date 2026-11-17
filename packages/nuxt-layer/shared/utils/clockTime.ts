/**
 * Clock time: a length of time as a clock shows it, and as an operator types
 * it. Milliseconds throughout; minutes only where an operator enters them or a
 * row stores them.
 */

const DIGITS_ONLY_RE = /^\d+$/;
const NON_DIGIT_RE = /\D/g;

// ──────────────── Units ────────────────

/**
 * Minutes as milliseconds. Clock code works in milliseconds; minutes stay where
 * an operator enters them or a row or Screen config stores them, and cross here
 * once, at that edge.
 */
export function minutesToMs(minutes: number): number {
	return minutes * 60_000;
}

// ──────────────── Time Formatting ────────────────

/**
 * Format milliseconds as mm:ss or h:mm:ss, rounding down: for a length of time,
 * and for time counting up. Time remaining takes `formatCountdownTime`.
 */
export function formatClockTime(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
	}
	return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Format the time remaining on a countdown, rounding up (ADR-0078): it reads
 * its full duration through its first second, and `0:00` only once none remains.
 */
export function formatCountdownTime(remainingMs: number): string {
	return formatClockTime(Math.ceil(Math.max(0, remainingMs) / 1000) * 1000);
}

/**
 * How long until what `formatCountdownTime` shows for `remainingMs` (above zero)
 * next changes: when the time remaining reaches the next whole second down.
 */
export function countdownNextChangeInMs(remainingMs: number): number {
	return remainingMs % 1000 || 1000;
}

/**
 * Normalizes raw time input into canonical mm:ss or h:mm:ss format.
 * Interprets digit-only input based on length:
 * - 1-2 digits: minutes only (e.g., "45" -> "45:00")
 * - 3 digits: m:ss (e.g., "530" -> "05:30")
 * - 4 digits: mm:ss (e.g., "1234" -> "12:34")
 * - 5 digits: h:mm:ss (e.g., "12345" -> "1:23:45")
 * - 6 digits: hh:mm:ss (e.g., "123456" -> "12:34:56")
 * Returns null if input cannot be normalized.
 */
export function normalizeTimeInput(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	// If already contains colons, validate and pass through. Range checks must
	// match parseTimeInput's — every string returned here is canonical, so the
	// parser must accept it.
	if (trimmed.includes(':')) {
		const parts = trimmed.split(':');
		if ((parts.length !== 2 && parts.length !== 3) || !parts.every((p) => DIGITS_ONLY_RE.test(p)))
			return null;
		const seconds = Number(parts[parts.length - 1]);
		const minutes = Number(parts[parts.length - 2]);
		if (seconds >= 60 || (parts.length === 3 && minutes >= 60)) return null;
		return trimmed;
	}

	// Strip non-digits for pure numeric input
	const digits = trimmed.replace(NON_DIGIT_RE, '');
	if (!digits) return null;

	let mm: string, ss: string, hh: string;

	switch (digits.length) {
		case 1:
		case 2:
			return `${digits}:00`;
		case 3:
			mm = digits.slice(0, 1).padStart(2, '0');
			ss = digits.slice(1);
			return Number(ss) >= 60 ? null : `${mm}:${ss}`;
		case 4:
			mm = digits.slice(0, 2);
			ss = digits.slice(2);
			return Number(ss) >= 60 ? null : `${mm}:${ss}`;
		case 5:
			hh = digits.slice(0, 1);
			mm = digits.slice(1, 3);
			ss = digits.slice(3);
			return Number(mm) >= 60 || Number(ss) >= 60 ? null : `${hh}:${mm}:${ss}`;
		case 6:
			hh = digits.slice(0, 2);
			mm = digits.slice(2, 4);
			ss = digits.slice(4);
			return Number(mm) >= 60 || Number(ss) >= 60 ? null : `${hh}:${mm}:${ss}`;
		default:
			return null;
	}
}

/** Parse a time string (mm:ss or h:mm:ss) into milliseconds. Returns null if invalid. */
export function parseTimeInput(input: string): number | null {
	const normalized = normalizeTimeInput(input);
	if (!normalized) return null;

	const parts = normalized.split(':').map(Number);
	if (parts.some((p) => Number.isNaN(p) || p < 0)) return null;

	if (parts.length === 2) {
		const [minutes, seconds] = parts;
		if (minutes == null || seconds == null || seconds >= 60) return null;
		return (minutes * 60 + seconds) * 1000;
	}

	if (parts.length === 3) {
		const [hours, minutes, seconds] = parts;
		if (hours == null || minutes == null || seconds == null || minutes >= 60 || seconds >= 60)
			return null;
		return (hours * 3600 + minutes * 60 + seconds) * 1000;
	}

	return null;
}
