/** A field of a request body as text: anything but a string is empty. */
export function textField(value: unknown): string {
	return typeof value === 'string' ? value : '';
}
