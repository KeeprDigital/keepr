# ADR-0131: The Graphics Administrator is an App role on a signed-in User, not a shared token

Accepted · 2026-11-18 · [#1293](https://github.com/KeeprDigital/keepr/issues/1293) · Amends ADR-0010

### Decision

**A Graphics Administrator is a signed-in User who holds the `admin` role** that Stream Keepr's own sign-in stores on the User (Better Auth's admin add-on, one comma-separated `role` column). `requireGraphicsAdministrator` (`server/modules/graphics-administrator.ts`) admits them and answers their User id. It refuses a request with no Session 401 and a Session whose User lacks the role 403, in the existing words. `NUXT_GRAPHICS_ADMIN_TOKEN`, its `x-graphics-admin-token` header and its runtime config are gone.

**`/api/admin/**` is behind the Session boundary.** It is no longer exempt, so the boundary's 401 and its cross-site refusal apply there as on every private route, and each route's guard adds the role.

**The first-admin bootstrap is what grants the role.** It already gave `admin` to every User it ensures. User administration creates Users with no role, and nothing else sets one.

**The Evidence Ledger records the Graphics Administrator who acted**, the User id the guard answers, never the `graphics-administrator` machine actor a token action wrote. Rows already written keep it.

**The admin pages take their reading as they open**, with the browser's Session, and say who they are for when refused.

### Why

- **The role already existed.** The bootstrap wrote `admin` on every account it made, the user list showed it, and the Local Developer User held it. Nothing read it. The Glossary already called the Graphics Administrator a Stream Keepr App role (#1228); the code did not.
- **A shared password says nobody.** One secret handed between people cannot name who acted, cannot be taken from one person without changing it for all, and was one more Worker secret per Installation.
- **The same role is the one that carries over.** Stream Keepr's App roles in the App registry are `member` and `admin`, and the Local Developer User and the Accounts Stand-in's User hold the highest. When Stream Keepr moves onto Keepr Accounts, the guard reads `admin` from the Identity Proof instead of from the User row, and the Graphics Administrator stays the same role.
- **Cookie authentication needs the cross-site check.** A header token could not be attached by another site's page; a Session cookie can. Putting `/api/admin/**` behind the boundary gives it the check every other cookie-authenticated write has.

### What this changes

- **ADR-0010**: "the Graphics Administrator shared token is untouched", the `/api/admin/**` exemption from the Session boundary, and "no Session administers User accounts, whatever its User's role" no longer hold. A Session whose User holds `admin` is the Graphics Administrator. The admin add-on's own HTTP routes stay closed, because they would add hard deletion and impersonation beside Stream Keepr's own user administration.

### Rejected alternatives

- **A new `graphics-administrator` role value.** Every existing administrator account holds `admin`, so a new value would lock all of them out until each was granted it by hand, and the App registry already names `admin` as Stream Keepr's highest role.
- **Checking the role in the session middleware.** Its refusals compose around every route, where the exhaustiveness scan of each route's refusals cannot see them (`test/helpers/routeRefusalScan.ts`). Each admin route calls the guard, and a unit test reads every admin route's import graph for it.
- **Keeping the token beside the role.** Two ways in means the shared password, and everything wrong with it, stays.
- **Granting the role from user administration.** Not needed to retire the token, and a second way to grant it is a decision of its own. The bootstrap ceremony grants it today.
