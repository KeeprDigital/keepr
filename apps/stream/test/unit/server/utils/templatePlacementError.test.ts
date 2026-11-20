import { describe, expect, it, vi } from 'vitest';
import { templatePlacementError } from '~~/server/utils/templatePlacementError';

vi.stubGlobal(
	'createError',
	(input: { statusCode: number; statusMessage?: string; message: string }) =>
		Object.assign(new Error(input.message), input),
);

function refusal(statusCode: number, message: string) {
	return Object.assign(new Error(message), { statusCode });
}

describe('templatePlacementError', () => {
	// A placed Broadcast Graphic's ids were generated for the copy; the author can
	// find only the template's, so each placed id is read back as the template's.
	it('restates an unselectable reference at the template slot it came from, naming the template', () => {
		const translated = templatePlacementError(
			refusal(
				409,
				'Graphic Asset Reference at graphics.placed-graphic.items.placed-item.asset is not selectable',
			),
			{
				artifact: 'Broadcast Graphic Template',
				templateName: 'Lower third',
				placedToTemplateIds: new Map([
					['placed-graphic', 'template-graphic'],
					['placed-item', 'template-item'],
				]),
			},
		);

		expect(translated).toMatchObject({
			statusCode: 409,
			message:
				'Broadcast Graphic Template "Lower third" cannot be placed: the Graphic Asset Revision at graphics.template-graphic.items.template-item.asset is no longer selectable',
		});
	});

	it('keeps a slot whose ids are already the template’s', () => {
		const translated = templatePlacementError(
			refusal(409, 'Graphic Asset Reference at layout.frame.backgroundImage is not selectable'),
			{ artifact: 'Feature Match Layout Template', templateName: 'Classic' },
		);

		expect(translated).toMatchObject({
			message:
				'Feature Match Layout Template "Classic" cannot be placed: the Graphic Asset Revision at layout.frame.backgroundImage is no longer selectable',
		});
	});

	it.each([
		{ failure: 'another conflict', error: refusal(409, 'Screen version moved') },
		{
			failure: 'a refusal of another status',
			error: refusal(400, 'Graphic Asset Reference at x is not selectable'),
		},
		{ failure: 'a failure with no status', error: new Error('boom') },
	])('passes $failure through untouched', ({ error }) => {
		expect(
			templatePlacementError(error, {
				artifact: 'Feature Match Layout Template',
				templateName: 'Classic',
			}),
		).toBe(error);
	});
});
