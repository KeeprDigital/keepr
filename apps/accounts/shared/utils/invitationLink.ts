/**
 * The page an Invitation's link opens, its id in the fragment so no request line
 * or log carries it. The same link is emailed and offered to copy.
 */
export function invitationLink(origin: string, invitationId: string): string {
	return `${origin}/invitation#id=${encodeURIComponent(invitationId)}`;
}
