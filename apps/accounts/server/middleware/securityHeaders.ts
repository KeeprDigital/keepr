import { applySecurityHeaders } from '~~/server/utils/securityHeaders';

/** Every response carries the security headers (`securityHeaders.ts`). */
export default defineEventHandler((event) => {
	applySecurityHeaders(event);
});
