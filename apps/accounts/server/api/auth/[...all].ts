import { getRequestHost, toWebRequest } from 'h3';
import { serverAuth } from '~~/server/utils/auth';

/** Better Auth's own routes, under `/api/auth`, those it leaves open (`OPEN_AUTH_ROUTES`). */
export default defineEventHandler((event) =>
	serverAuth(getRequestHost(event)).handler(toWebRequest(event)),
);
