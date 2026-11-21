# Development

[README](../README.md) · [Install](INSTALL.md) · [Usage](USAGE.md) · [Configuration](CONFIGURATION.md) · [Architecture](ARCHITECTURE.md) · [Development](DEVELOPMENT.md)


## Checks

```sh
npm test            # domain rules, event translation, scheduler, job repository, notifier, terminal launchers, config editing
npm run typecheck   # GUI types against @opencode/plugin 2.3.2
npm run build:gui   # vite + @opencode/plugin/gui/vite → dist/gui-experimental.cjs
npm run test:gui    # loads the built bundle in jsdom with a mock host: rendering, create/edit/rename/delete/duplicate, stop, settings, notifications
npm run check       # all of the above, as CI runs it
```

## Pipelines

| Trigger | Workflow | What it does |
|---|---|---|
| push to `main`, pull request | `ci.yml` | typecheck, unit tests, GUI build, GUI test on Node 20 and 22 |
| push to `release/x.y.z` | `release-candidate.yml` | the same checks, then a GitHub pre-release `x.y.z-rc.N` with the packed tarball; npm `next` if `NPM_TOKEN` is set |
| push of tag `x.y.z` | `release.yml` | the same checks, then the GitHub release `x.y.z` with the CHANGELOG section as notes; npm `latest` if `NPM_TOKEN` is set |

The checks live in the reusable `check.yml`. Each release push fails early if the version in the branch or tag name differs from `package.json`.

## Releasing

1. Branch off `main`, bump the version and date the CHANGELOG entry:

   ```sh
   git switch -c release/1.2.0 main
   npm version 1.2.0 --no-git-tag-version
   # CHANGELOG.md: "## 1.2.0 — 2026-12-01"
   git commit -am "release: 1.2.0" && git push -u origin release/1.2.0
   ```

   Every push to the branch builds the next candidate: `1.2.0-rc.1`, `1.2.0-rc.2`, …
2. When a candidate is good, tag it and push the tag:

   ```sh
   git tag 1.2.0 && git push origin 1.2.0
   ```

3. Merge the release branch back into `main`.

To publish to npm, add an npm automation token as the repository secret `NPM_TOKEN`. Without it, releases go to GitHub only.

The code layout is described in [Architecture](ARCHITECTURE.md).
