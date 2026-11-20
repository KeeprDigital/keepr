---
'@keepr/stream': patch
---

A browser that was signed in to Stream Keepr before it relied on Keepr Accounts can sign in again. Stream Keepr's former sign-in cookie has the same name as Keepr Accounts' session cookie, and a browser still holding it sent both: Keepr Accounts read the old one, answered that nobody was signed in, and the browser was sent to sign in again without end. Stream Keepr now takes the old cookie out of such a request and expires it in the browser. Until this Release is live, clearing the site data for the Stream Keepr host gets a browser in.
