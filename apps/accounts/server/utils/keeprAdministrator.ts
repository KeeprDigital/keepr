import { sql } from 'drizzle-orm';
import { schema } from '~~/server/db';
import { KEEPR_ADMINISTRATOR_ROLE } from '~~/shared/utils/keeprAdministrator';

/** `isKeeprAdministrator`, as a condition on the `user` table's row. */
export const userIsKeeprAdministrator = sql<boolean>`(',' || coalesce(${schema.user.role}, '') || ',') like ${`%,${KEEPR_ADMINISTRATOR_ROLE},%`}`;
