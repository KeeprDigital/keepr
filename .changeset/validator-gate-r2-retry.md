---
'@keepr/stream': patch
---

The silent-video validator gate repeats a refused R2 object get, put or delete after a growing wait (1s, 2s, 4s), so its cleanup manifest, rewritten to one key faster than R2's one write a second to a key, no longer fails the staging job with `validator-command-failed step=manifest`. A command that still fails names Wrangler's reason, its HTTP status and Cloudflare error code, with every path and target name withheld.
