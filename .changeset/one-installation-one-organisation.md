---
'@keepr/stream': major
---

A Stream Keepr Installation serves one Organisation, and admits no User working in another (ADR-0161). Until now any Organisation's owner could grant themselves the `admin` App role in `stream` and reach every Event, Screen and Graphic Asset of the Installation. A User whose Identity Proof names another Organisation, or none, is now refused as a User with no App access is: 403 on every route, an admin route included, no realtime socket, and `/no-access` in the app. An Installation that names no Organisation refuses every request that requires a Session 503, and a deploy refuses an Installation whose Worker lacks the new secret `NUXT_INSTALLATION_ORGANISATION_ID`. (#1388)

Operator steps, for each Environment (staging, then production):

1. **Before this Release deploys**, find the id of the Organisation the Installation serves in that Environment's Keepr Accounts: as a Keepr Administrator, open `/platform`; the Organisation's members link ends `/members?organisation=<id>`.
2. **Record it** in 1Password, vault `Keepr`, item `stream-staging` or `stream-production`, as the concealed field `NUXT_INSTALLATION_ORGANISATION_ID`, then run `pnpm secrets:sync --app stream --env staging` (or `--env production`) from the workspace root. Without it the deploy refuses, before it changes anything.
3. **For staging**, check the acceptance operator (`STREAM_KEEPR_ACCEPTANCE_OPERATOR_EMAIL`) is a member of that Organisation with `admin` in `stream`, and works in it at Keepr Accounts; otherwise the deployed gates are refused and production does not deploy.
4. Tell anyone who uses Stream Keepr and belongs to several Organisations to choose the Installation's at Keepr Accounts.

A rollback past this Release admits every Organisation again; the secret it leaves behind is read by nothing.
