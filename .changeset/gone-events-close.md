---
'@keepr/stream': patch
---

Deleting an Event now disconnects every realtime socket of its Event at once, its Screen Outputs' and its operators' pages', after the pages are told of the delete. Before, they stayed connected to an Event that no longer existed until each dropped, and a Screen Output still present kept the Event's realtime object waking about every 15 s.
