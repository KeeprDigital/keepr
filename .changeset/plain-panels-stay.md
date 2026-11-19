---
'@keepr/stream': minor
---

A Screen's actions offer "Show debug panel" and "Hide debug panel" in place of the one Debug item, on the Screens page and on a Screen's own page. Each asks every Screen Output of that Screen for the state it names, where Debug turned each output's panel over from wherever it stood. The page cannot read an output's panel, so it shows no state of its own: the confirmation says which was asked for. There is no step beyond Deploy. An operator's page left open from before this Release has its Debug refused until it is reloaded.
