# ADR-0135: A generated secret reaches 1Password as an assignment, and is read back before it is synced

Accepted · 2026-11-19 · [#1290](https://github.com/KeeprDigital/keepr/issues/1290) · Amends ADR-0134 · Amended by ADR-0154: the redactor also scrubs each value as JSON escapes it, and a PEM that lost some of its line breaks is refused

### Decision

**`pnpm secrets:sync --generate` writes the new value with a field assignment**, `op item edit <item> --vault <vault> 'FIELD[password]=<value>'`, which keeps the field in its existing section. The value is in `op`'s arguments for as long as `op` runs. It is still never logged, and the redactor still removes it from anything a failing tool prints. Every other value still goes to its tool on stdin.

**It then reads the item back** with a fresh `op item get --reveal`, never the copy it already read, and refuses, before anything is set on the destination, unless the field holds the new value.

### Why

- ADR-0134 piped the item's JSON, its field changed, to `op item edit` on stdin. Against `op` 2.42.0, that exits 0 and keeps no change to a concealed field's value, empty or set, in a section or not. A production `--generate` reported the value generated into 1Password, set it on the Worker, and recorded nothing: a value that exists only on a Worker, which ADR-0134 exists to prevent.
- `op item edit` takes a value as an assignment or in a JSON template (piped, or `--template <file>`). Piped, the template is the route that failed; from a file it is the same JSON, on disk. `--generate-password` fills only an item's built-in password field, with `op`'s own recipe, and a Secure Note has none.
- An argument is visible only to processes of the same user on the operator's machine, for the moment `op` runs. The operator who runs the sync already holds the value in 1Password.
- `op`'s exit status did not say whether the value was kept. Only reading it back does.

### Consequences

- `sync.mjs`'s fake `op` behaves as 2.42 does: it exits 0 on piped JSON and keeps nothing from it, and applies assignments. A test in which `op` keeps nothing fails the sync with the Worker untouched.
- With several secrets to generate, one 1Password refuses stops the sync; those before it are in 1Password and on no destination yet, and the next sync sets them.

### Rejected alternatives

- **Keep the piped JSON, and check it.** The check would refuse every time: 2.42 keeps no concealed value from it.
- **A template file.** The same JSON, on disk, where a crash can leave it.
