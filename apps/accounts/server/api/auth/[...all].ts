import { getRequestHost, toWebRequest } from 'h3';
import { serverAuth } from '~~/server/utils/auth';

/** Better Auth's own routes, under `/api/auth`, less the ones it closes (`CLOSED_PATHS`). */
export default defineEventHandler((event) =>
	serverAuth(getRequestHost(event)).handler(toWebRequest(event)),
);
