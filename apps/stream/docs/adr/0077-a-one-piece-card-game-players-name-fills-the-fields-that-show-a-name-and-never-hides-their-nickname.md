# ADR-0077: A One Piece Card Game Player's name fills the fields that show a name, and never hides their Nickname

Accepted · 2026-11-08 · Changes ADR-0074.

### Decision

**A Player's name and Nickname each keep their place.**

- **Fields that show a name** take the operator's name, with the Nickname filling in while there is none: a Feature Match side's Name (picking a Player fills it), the Feature Match and graphic `Name` values, the Deck List Screen, Metagame and the Cards page's Slot sides (`playerDisplayName`).
- **Operator screens** tell a Player apart by Nickname, else name: the Players page, every Player picker and modal, the Cards page, and the TCG+ Import preview (`playerLabel`). The Players list shows the name and the Nickname each in its own column, the name blank until an operator gives one.
- **The Top Cut Bracket** shows a Player by name or by Nickname, as its Screen's `Show Players by` setting picks, the other standing in when the chosen one is blank. It is offered on One Piece Card Game Events. A Screen saved before it shows the name.

### Why

ADR-0074 let a given name stand in for the Nickname everywhere, so naming a Player hid the handle the operator knows them by and searches TCG+ with. An operator gives a name for the broadcast, so the name belongs in the fields that go on air. Not every Player is given a real name, so the bracket offers the Nickname for a field where most have none.

### Consequences

- One rule, `playerShownName(player, 'name' | 'nickname')`, decides both orders, so a Player missing one name always shows the other.
- A Magic: The Gathering Player has no Nickname, so every surface shows their name as before.

### Rejected alternatives

- **Showing both, as `Name (Nickname)`, everywhere.** A broadcast wants one name, and the Players list already gives each its column.
