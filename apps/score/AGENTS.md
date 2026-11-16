The workspace's rules are in the root `AGENTS.md`. These are Score Keepr's own.
Paths in this file are relative to `apps/score`.

Score Keepr is scaffolded, not built: a Nuxt app on the workspace's shared
layer (`packages/nuxt-layer`) with one placeholder page. `README.md` says what
it will run on and how to run it.

## Domain docs

- Before exploring, read `GLOSSARY.md` and the `docs/` sections touching your
  area: the engines' specs, and the decisions in this app's `docs/adr` and
  each engine package's.
- Name domain concepts with `GLOSSARY.md` terms, never its `_Avoid_` synonyms,
  in this app and in the engine packages. A missing term is either invented
  language (reconsider) or a real gap (add it).
- Stream Keepr's `GLOSSARY.md` is a different vocabulary for a different
  product: an Event there is not a Tournament here. Use each in its own app;
  the root `GLOSSARY-MAP.md` says how the two meet.
- A decision is a new file, numbered from the workspace's one sequence
  (ADR-0095), beside the code it governs: an engine's in its package's
  `docs/adr`, the Tournament Engine's in this app's `docs/adr` until it is a
  package. A decision about the workspace or about this app's place in it is a
  file in the root `docs/adr`. A decision is written once; one that changes it
  leaves it only an `Amended by` or `Superseded by` line.

## What belongs where

- What both apps need is in `packages/nuxt-layer`, or moves there in the
  change that moves Stream Keepr onto it (ADR-0093). Do not copy a file from
  `apps/stream`. The layer registers no route and no middleware: this app
  states its own.
- The app is the engines' Consumer: it stores, syncs and shows. A rule of
  pairing, standings or the tournament's record belongs in an engine package.
