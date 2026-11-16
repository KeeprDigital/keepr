# ADR-0095: Rules say what is true now, decisions say why and are never rewritten, and each lives beside its code

Accepted · 2026-11-16 · Extends ADR-0094 · Work: #1230

### Decision

**Three kinds of document, each answering one question.** A glossary says what a word means (ADR-0094). Rules say what is true now. A decision says why it is so, and what else was weighed. None states what another holds: a decision cites the rules it set rather than restating them, and a rule carries no reasons.

**Rules hold what something outside their module relies on**: a caller, an operator or another module. How the module achieves it is code, with its tests at the rule's home (`apps/stream/AGENTS.md` § Writing tests). The engines' `RULES.md` keep their formulas, because callers rely on the exact costs. Rules are edited in place, in the present tense.

**A decision is written once.** A later decision that changes it says so, and the earlier one gains only a status line: `Amended by ADR-NNNN` or `Superseded by ADR-NNNN`. Its body is edited only to correct an error in what it recorded, such as a wrong citation or a sentence its own section contradicts. This replaces "when a decision changes, edit its section to state what is now true".

**Two levels, each document beside the code it governs.** The root holds the workspace's: `GLOSSARY.md`, `GLOSSARY-MAP.md`, and `docs/adr` for decisions about tooling, layout, the shared layer and anything that crosses apps. Each app or package holds its own `GLOSSARY.md`, `RULES.md` and `docs/adr`, each created when it first has something to hold. There are no root rules: the workspace's are `AGENTS.md` and its tooling's configuration. A decision moves with its code, as a term does (ADR-0094).

**One file per decision, `docs/adr/NNNN-slug.md`, in one number sequence for the workspace.** A decision keeps its number wherever it moves. A new decision takes the next number free anywhere in the workspace, read from `origin/main` at merge.

**A spec lives while its work is in flight.** Once the work is built, its rules go to `RULES.md`, the trade-offs that meet the bar for a decision become decisions, and how to use the result goes to the README. Then the spec is deleted; git keeps it.

### Why

- An audit of the decisions on 2026-11-16 found 26 Stream Keepr decisions still stating a rule that a later decision had changed: stating what is now true means finding every earlier section a change touches. It found 11 rules in `apps/stream/RULES.md` that had drifted from the decisions that set them, among 276 rules the two files both state. Two copies of a rule drift. A decision that is never rewritten cannot go stale, only be superseded, and its status line says so.
- `apps/stream/DECISIONS.md` is 537 KB. No agent reads it whole, so the current rule was found by grep and amendment lines. Rules read by area, and a decision opened by its number, fit in one context window.
- 87 of the 90 Stream Keepr decisions give reasons and 78 weigh alternatives, which no rule holds. 229 of the rules in `RULES.md` are in no decision, and most would not meet the bar for one. Neither file can absorb the other.
- Several of the drifted rules described mechanics: how Auto columns score a layout, when page rotation restarts. A test at a rule's home fails when its mechanics change; prose does not.
- Score Keepr's decisions were already one file each. A single file of every decision conflicts at its end whenever two branches add one.
- 768 files cite decisions as `ADR-NNNN`, 2,624 times, so a number must survive a move.
- Score Keepr's spec restated `packages/pairing/RULES.md`, the exact definition, and one restatement diverged from it and from the code.

### Consequences

- Score Keepr's decisions 0001 to 0011 share numbers with Stream Keepr's. They take 0096 to 0106 in order, and until they do, those numbers are held for them: the next new decision is 0107. Decisions 0001 to 0005 (pairing) move to `packages/pairing/docs/adr`, and 0006 and 0007 (standings) to `packages/standings/docs/adr`. Decisions 0008 to 0011 (the Tournament Engine) stay in `apps/score/docs/adr` until it is a package.
- `apps/stream/DECISIONS.md` becomes `apps/stream/docs/adr`, one file per section, and ADR-0089 to ADR-0094, the workspace's, move to the root `docs/adr`. Numbers 0003, 0008 and 0013, folded into others long ago, stay unused. Until the split, a new Stream Keepr decision is still appended to `DECISIONS.md`, under these rules.
- Every rule now stated only in a decision moves to its `RULES.md`, so that knowing what is true needs no decision.
- `apps/score/docs/spec.md` and `standings-spec.md` are folded and deleted; `tournament-spec.md` stays until the Tournament Engine is built. `GLOSSARY-MAP.md` then names `RULES.md` files where it now names "the specs".
- The decisions the audit found stale gain status lines rather than new text, and the repeats it found stay as history.
- The `AGENTS.md` files and the opening of `DECISIONS.md` say all this. The work runs in the order #1230 sets.

### Rejected alternatives

- **Decisions only, each edited to state what is now true.** The rule this replaces, and what the audit found.
- **Rules only.** Reasons and rejected alternatives would have no home, and an agent could not tell a settled question from an open one.
- **One record of decisions for the whole workspace.** Today's shape, with the workspace's decisions inside Stream Keepr's file. A decision would not follow its code, as a term does.
- **A number sequence per level, with a prefix.** It rewrites 2,624 citations, or leaves old ones unprefixed beside new ones.
- **Engine decisions kept in `apps/score`.** The packages are their code, and Score Keepr is one Consumer of them.
- **Specs kept after build as design notes.** Score Keepr's restated rules, and one diverged. A reason too small for a decision is not worth a document that can drift.
