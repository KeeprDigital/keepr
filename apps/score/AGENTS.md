The workspace's rules are in the root `AGENTS.md`. These are Score Keepr's own.
Paths in this file are relative to `apps/score`.

Score Keepr is scaffolded, not built: a Nuxt app on the workspace's shared
layer (`packages/nuxt-layer`) with one placeholder page. `README.md` says what
it will run on and how to run it.

## Domain docs

- Before exploring, read `GLOSSARY.md` and the `docs/` sections touching your
  area: the engines' specs, and their decision records in `docs/adr`.
- Name domain concepts with `GLOSSARY.md` terms, never its `_Avoid_` synonyms,
  in this app and in the engine packages. A missing term is either invented
  language (reconsider) or a real gap (add it).
- Stream Keepr's `CONTEXT.md` is a different vocabulary for a different
  product: an Event there is not a Tournament here. Use each in its own app.
- A decision about the engines is a new file in `docs/adr`, with the next
  number. A decision about the workspace or about this app's place in it is a
  section of `apps/stream/DECISIONS.md`.

## What belongs where

- What both apps need goes in `packages/nuxt-layer`, in the change that moves
  Stream Keepr onto it (ADR-0093). Do not copy a file from `apps/stream`.
- The app is the engines' Consumer: it stores, syncs and shows. A rule of
  pairing, standings or the tournament's record belongs in an engine package.
