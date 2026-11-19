import { describe, expect, it } from 'vitest';
import { screenOutputCapabilityRegenerationNotice } from '~~/app/utils/screenOutputCapabilityRegeneration';

describe('what an Operator is told once a Screen Output Asset Capability is regenerated', () => {
	it('is a success when the outputs were disconnected', () => {
		expect(screenOutputCapabilityRegenerationNotice({ outputsClosed: true })).toMatchObject({
			color: 'success',
			title: 'Asset Access Rotated',
		});
	});

	// The regeneration stood, so it is not an error; only the Operator can close
	// what was left open, so it says how.
	it('is a warning that says to do it again when the outputs could not be disconnected', () => {
		const notice = screenOutputCapabilityRegenerationNotice({ outputsClosed: false });

		expect(notice.color).toBe('warning');
		expect(notice.title).toContain('Outputs Still Connected');
		expect(notice.description).toContain('Rotate asset access again');
	});
});
