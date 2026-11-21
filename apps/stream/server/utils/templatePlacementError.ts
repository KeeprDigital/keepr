const UNSELECTABLE_PREFIX = 'Graphic Asset Reference at ';
const UNSELECTABLE_SUFFIX = / is not selectable$/;

/**
 * Restate a Screen write failure in terms of the template that was placed.
 *
 * The Screen's write path refuses a Graphic Asset Reference that is not selectable
 * now, and names the slot that carries it. For a placed Broadcast Graphic that slot
 * is made of ids generated for the copy, on a graphic that was never written, so
 * each is read back as the template's own through `placedToTemplateIds`; a layout's
 * slots are already the template's. Either way the template is named, so an author
 * can tell which design is unplaceable and which item in it to repair. Any other
 * failure passes through untouched.
 */
export function templatePlacementError(
	error: unknown,
	placement: {
		artifact: 'Broadcast Graphic Template' | 'Feature Match Layout Template';
		templateName: string;
		placedToTemplateIds?: ReadonlyMap<string, string>;
	},
): unknown {
	const failure = error as { statusCode?: number; message?: string } | undefined;
	if (failure?.statusCode !== 409 || typeof failure.message !== 'string') return error;
	if (!failure.message.startsWith(UNSELECTABLE_PREFIX)) return error;

	const slot = failure.message
		.slice(UNSELECTABLE_PREFIX.length)
		.replace(UNSELECTABLE_SUFFIX, '')
		.split('.')
		.map((segment) => placement.placedToTemplateIds?.get(segment) ?? segment)
		.join('.');

	return createError({
		statusCode: 409,
		statusMessage: 'Conflict',
		message: `${placement.artifact} "${placement.templateName}" cannot be placed: the Graphic Asset Revision at ${slot} is no longer selectable`,
	});
}
