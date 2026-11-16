# ADR-0044: An operator form settles on what its save stored

Accepted · 2026-10-26 · [#794](https://github.com/KeeprDigital/stream-keepr/pull/794)

### Decision

**A form save runs through `useForm`'s `runSave`.** It snapshots the form when the save is sent. Once the save resolves truthy, every value still as sent takes the baseline's, which the store has moved to the server's answer by then. A value the save normalized (trimmed, a blank read as null, numeric text as a number, an empty deck dropped) reads clean. A value edited while the save was in flight stays a change. A failed save, or one whose answer never reached the baseline, leaves the form alone.

**An Event config card owns its save through `useEventConfigForm`.** It bundles `useForm`, the page's unsaved-changes registration and the save: validate, map the changes to an Event update, `runSave(handleSubmit)`, one at a time. A card no longer emits its changes for the page to save, because an emit cannot report whether the save landed.

**`useForm` compares values regardless of object key order.** The #612 merge appends keys a new baseline adds, so the same values can arrive in another order.

**A form in an overlay modal guards itself through `useModalUnsavedChanges`.** The modal renders outside the page, so it can neither register with the page's guard nor use `onBeforeRouteLeave`. It guards navigation, a browser unload, and its own close through `confirmDiscard`. The Event route middleware asks every open guarded modal (`confirmDiscardInOpenModals`) before it resets the Event stores: a `router.beforeEach` of the modal's own runs after that middleware, so "Keep editing" returned to a form whose Event was gone (#1026).

### Why

The #612 three-way merge keeps a local edit over a conflicting baseline. After a save that normalized a value, the operator's raw value and the stored one conflict, so the form kept the raw value as unsaved. Saving a Feature Match Slot's setup with a trailing space showed the success toast while Save stayed enabled and leaving warned. The Event Controls holding text did the same. A form told to treat itself as saved instead (`updateOriginal`, now removed) marked an edit typed while the save was in flight as saved, and leaving lost it without a warning.

### Consequences

- A save's answer must reach the form's `initialData` before the save resolves. The stores do this, since each writes the answer before it resolves. A form whose baseline the save sets itself, such as the Melee integration card, assigns its `initialData` ref inside the save.
- A guarded modal renders its own close button in the header's `actions` slot with `:close="false"`. Nuxt UI wraps its built-in close in reka-ui's `DialogClose`, which closes the dialog whatever the button's `onClick` does, so it cannot wait for `confirmDiscard`.
- A guarded modal renders its own close button in the header's `actions` slot with `:close="false"`. Nuxt UI wraps its built-in close in reka-ui's `DialogClose`, which closes the dialog whatever the button's `onClick` does, so it cannot wait for `confirmDiscard`.
- Talents keep their reset after a save. A staged Talent with no id merges in beside the one the save created (#612), so the card resets to the Event rather than settling.
- `packages/nuxt-layer/test/nuxt/composables/ui/useForm.test.ts` and `useEventConfigForm.test.ts` cover the settle. The Feature Match panel, Event Controls and Event settings card tests have the mocked store write back a normalized answer, and the form must read clean.

### Rejected alternatives

- **Settle automatically on any baseline that follows a submit.** An optimistic update followed by a rollback would replace a failed edit with the old value, so a retry would have nothing to send. Only the save knows whether it landed.
- **Normalize in the form before comparing.** Each form would have to repeat the server's normalization, and drift between the two would bring the bug back.
- **Settle on the save's answer rather than the baseline.** Each form would have to map the answer to its own shape. The stores already do that through `initialData`.
