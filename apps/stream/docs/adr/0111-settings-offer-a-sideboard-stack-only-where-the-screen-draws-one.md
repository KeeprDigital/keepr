# ADR-0111: Settings offer a sideboard stack only where the Screen draws one

Accepted · 2026-11-17 · [#1240](https://github.com/KeeprDigital/keepr/issues/1240) · Amends ADR-0054

### Decision

**The sideboard's View hides Stack where the Screen draws a grid, rather than showing it disabled** (`RULES.md` § Sideboard). ADR-0054 called for a disabled Stack tab. It still holds that a stored stack is kept so the strip comes back when the sideboard moves beside again. Settings do not overwrite that stored value. They show what the Screen draws.

**A field may show a value other than the one it stores.** This is `shownValue` on its editor meta, which `fieldValue` reads, so the control and the closed card's summary agree with the Screen. The stored value stays until another value is chosen. A stack shown as Grid stays stored as a stack until List is chosen or the sideboard moves.

### Why

#860 drew the Stack tab disabled where it could not stack. #1107 then drew every settings page from its contract, where a setting that cannot have an effect is hidden, never disabled (ADR-0037, #1094). That change dropped the disabled tab but never hid the option, so an operator could choose Stack below the mainboard and get a grid. Hiding the option follows the page's rule, and keeping the stored stack keeps ADR-0054's restore.

### Consequences

- Settings decide from the Board Selection and the placement alone (`sideboardStacks`). The Screen uses the same check, and also needs both boards to have cards. A Deck List with an empty board therefore still offers Stack.
- A sideboard shown as Grid may store `view: 'stack'`. Anything that reads the config reads the stored view, as `resolveDeckBoards` does.

### Rejected alternatives

- **Keep Stack offered.** This breaks the page's rule, and choosing Stack changes nothing on the Screen.
- **Write `view: 'grid'` when the sideboard moves.** This loses the strip that ADR-0054 brings back when the sideboard moves beside again.
