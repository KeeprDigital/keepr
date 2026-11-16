# Engine core rules

What the functions both engines share promise their callers. Words are defined in `apps/score/GLOSSARY.md`.

## Mapping Standings to the engines

- `pairingEntrantsFrom` takes a Standings result's rows and the ids present, and returns those Entrants for a Swiss round in the order of `present`: Score, opponents faced, Byes received and Rank from the rows, Group Labels from the Consumer. An id listed twice is `duplicate-id`, and an id with no row is `unknown-entrant`.
- `topCutFrom` returns the `size` best Ranks among the rows given, with their Ranks unchanged. Pass only the eligible rows. It never chooses between Entrants who share a Rank: a shared Rank inside the cut, or across its line, is `shared-rank`. A cut smaller than 2 is `invalid-input`, and one larger than the rows is `too-few-entrants`.
- Both never throw: a failure comes back as errors, like the engines'.
