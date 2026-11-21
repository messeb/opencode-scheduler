# Development

[README](../README.md) · [Install](INSTALL.md) · [Usage](USAGE.md) · [Configuration](CONFIGURATION.md) · [Architecture](ARCHITECTURE.md) · [Development](DEVELOPMENT.md)


```sh
npm test            # domain rules, event translation, scheduler, job repository, notifier, terminal launchers, config editing
npm run typecheck   # GUI types against @opencode/plugin 2.3.2
npm run build:gui   # vite + @opencode/plugin/gui/vite → dist/gui-experimental.cjs
npm run test:gui    # loads the built bundle in jsdom with a mock host: rendering, create/edit/rename/delete/duplicate, stop, settings, notifications
npm run check       # all of the above, as CI runs it
```

## Releasing

Bump `version`, move the CHANGELOG entry out of "unreleased", then `npm publish` (`prepack` builds the GUI bundle).

The code layout is described in [Architecture](ARCHITECTURE.md).
