import { createAccountsStandIn } from './standIn';

// The Accounts Stand-in as a Worker, run locally by `keepr-accounts-stand-in`.
const standIn = createAccountsStandIn();

export default {
	fetch: (request: Request): Promise<Response> => standIn.fetch(request),
};
