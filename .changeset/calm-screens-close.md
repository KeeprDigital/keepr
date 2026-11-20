---
'@keepr/stream': patch
---

Deleting a Screen now disconnects its Screen Outputs at once, so they leave its presence with the delete. Before, an output already connected stayed until its socket dropped.
