---
'@keepr/stream': patch
'@keepr/accounts': patch
---

The Worker dry run bundles for every Environment the deploy descriptor names, outside the build a deploy uploads, and a deploy refuses a build of another commit or an integration build before it changes anything (#1382). There is no step beyond Deploy.
