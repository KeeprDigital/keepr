---
'@keepr/stream': patch
---

`/admin` opens the Operations Cockpit at `/admin/graphics-assets` instead of answering 404. A browser with no Session is sent to sign in and returns to the cockpit.
