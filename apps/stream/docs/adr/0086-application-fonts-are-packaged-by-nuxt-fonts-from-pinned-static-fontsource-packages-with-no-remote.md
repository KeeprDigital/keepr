# ADR-0086: Application fonts are packaged by Nuxt Fonts from pinned static Fontsource packages, with no remote provider at build

Accepted · 2026-11-13 · [#1168](https://github.com/KeeprDigital/stream-keepr/issues/1168) · Supersedes the deferral recorded in [#453](https://github.com/KeeprDigital/stream-keepr/issues/453)

### Decision

**Every application font is a static `@fontsource/<family>` package, pinned to an exact version in `package.json`, and Nuxt Fonts' npm provider packages it from disk.** `nuxt.config.ts` takes its whole `fonts` block from `build/applicationFonts.ts` (`APPLICATION_FONTS_OPTIONS`): `provider: 'npm'`, `npm.remote: false`, `experimental.disableLocalFallbacks: true`, and `families` from the registry (`applicationFontFamilies()`): one entry per packaged definition in `GRAPHIC_FONTS`, asking for every weight the package ships and for italic where it has one. Each definition's `cssFamily` is derived from its id (`var(--font-<id>)`), and the `--font-<id>` custom properties in `app/assets/css/main.css` are checked against the registry's stacks by `test/unit/shared/applicationFontWiring.test.ts`, so neither list can drift from it.

**No font comes from the network at build.** The global provider removes every other provider, and `remote: false` keeps the npm provider off its CDN: a face it cannot find on disk is dropped, not fetched. `fontless` already defaults `remote` to `false`; it is set anyway, because bare `unifont` defaults it to `true` and the offline guarantee should not rest on a default.

**A declared face has no `local()` source.** `fontless` puts `local("<Family> <Style>")` ahead of every face's file by default, so a machine with Roboto or Inter installed would paint its own copy, and a preview and a program machine could differ. `experimental.disableLocalFallbacks` turns that off, and the build check refuses a declared face that names one. The metric-adjusted `"<Family> Fallback: …"` faces stay `local()`: they size a system font while the real face loads.

**Font files are not in Nuxt's build manifest.** Vite lists each file a stylesheet references as an asset of the chunk that imports it, and Nuxt copies every chunk's assets into its dependents' precomputed dependencies, which the Worker evaluates on its first document request. A `build:manifest` hook (`dropFontAssetsFromManifest()`) removes them: the `@font-face` rules fetch a face when a page paints it, and no application font is preloaded.

**Every subset a package has ships.** A static package's per-weight stylesheet carries all its scripts, and the npm provider does not filter by subset, so a non-Latin name keeps painting in the chosen face.

**One Nuxt Fonts runs, at the version `package.json` pins.** Nuxt UI installs `@nuxt/fonts` as a module dependency at `^0.14.0`; a pnpm override in `pnpm-workspace.yaml` resolves it to the root's version. Nuxt installs a module once by name, so one `@nuxt/fonts` runs: the root's `families` set the weights of each family they list, and Nuxt UI's module defaults (weights 400–700) still apply to any family not listed.

### Why

The deferral in #453 (2026-08-20) accepted Nuxt Fonts' remote providers: builds that consult Google, a cold build that fails when a remote font disappears (#405), system fallback names looked up as downloadable fonts, and Nuxt UI's 400–700 default dropping the 800 and 900 faces broadcast tables use. #1168 broadens the set to thirteen families, which makes each of those costs larger, and the maintainer chose to pay for packaging instead.

**Static, not `@fontsource-variable/*`.** `unifont` 1.0.3 maps the requested weights and styles onto a static package's `<weight>.css` and `<weight>-italic.css`, so the full matrix resolves through one uniform path under plain family names. For a variable package it reads only `index.css`, which carries no italics, under the family `"<Name> Variable"`. #453 recorded the npm provider as reading only `index.css`, which reduced every static family to 400 normal; that held on Nuxt Fonts 0.14 and no longer does.

**Nuxt Fonts stays the packager.** It injects each family's `@font-face` rules where processed CSS names it, `--font-*` custom properties included, and emits the files as hashed build assets. A hand-written `@font-face` over package file paths, #453's suggested route, would bypass it and keep a second list of faces.

### Consequences

- A cold build with font hosts unreachable succeeds. The first one emitted 1,181 `@font-face` rules in the global stylesheet: 1,129 faces, one per subset of each declared weight and style, and 52 metric-adjusted local fallbacks. The stylesheet is 704 KB raw, 126 KB gzipped (before #1168: 285 KB and 147 rules), and the 1,129 WOFF2 files total 15.3 MB under `_nuxt/fonts/`. A browser fetches only the faces and subsets a page paints.
- The Worker bundle does not carry them. With font files in the build manifest, `precomputed.mjs` was 21.6 MB (each of the 1,129 file names repeated in about 180 chunks' dependencies) and the server bundle 28.0 MB; without them, 0.47 MB and 6.8 MB.
- A system fallback name has no package and resolves to nothing, silently. Names `fontless` knows as system fonts (`Georgia`, `Segoe UI`, `Menlo`) are never asked; others (`Cascadia Mono` in the Feature Match display) are asked of the npm provider and come back empty. No denylist exists, and none is needed.
- The provider skips a weight file a package lacks without a warning, so the configuration alone does not prove the faces exist. #1168 has the declared matrix held against the built CSS, by weight and style, by `scripts/assert-built-fonts.mjs`, which `pnpm worker:dry-run` runs against `.output/public` (so `pnpm verify`, CI's Worker job and `pnpm run deploy` all reach it). The same check refuses a declared face with a remote or `local()` source, and a remote `@import` in any built stylesheet. Removing `provider` would still pass it, since a remote provider downloads to local files; `test/unit/build/applicationFonts.test.ts` holds `provider` and `npm.remote` instead.
- Adding an application font is a registry entry and a pinned package. A font the registry names but `package.json` lacks paints nothing; `applicationFontWiring.test.ts` refuses that.
- `--font-mono` is JetBrains Mono, which changes the operator app's monospace text too (`DESIGN.md`). `--font-body` is `'IBM Plex Sans', sans-serif`, the registry's stack, without the former Inter fallback.
- Upgrading `@nuxt/fonts` means bumping the override with it; `applicationFontWiring.test.ts` fails while the two differ.

### Rejected alternatives

- **Keep zero configuration and Google at build.** The smallest change, but it keeps the network dependency #405 broke on and the missing 800 and 900 faces.
- **The `local` provider over WOFF2 files committed under `public/fonts/`.** Offline and dependency-free, but binaries in git, hand-kept licences and manual updates for thirteen families.
- **`ui.fonts: false`** in place of the override. Nuxt UI would stop installing the module, but its `^0.14.0` package would still be installed beside the root's, two versions where one is wanted.
