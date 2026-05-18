# HTML to Figma by dMaya

[HTML to Figma by dMaya](https://dmaya.ai/html-to-figma) is a free Figma plugin for turning HTML, public URLs, single-file frontends, and AI-generated UI output into editable Figma layers from [dMaya](https://dmaya.ai).

Use it for HTML to Figma, URL to Figma, Claude Code to Figma, Lovable to Figma, Cursor to Figma, Bolt to Figma, v0 to Figma, Replit to Figma, and other AI output to Figma workflows where you want editable frames, text, vectors, image fills, borders, shadows, and raster fallbacks instead of a flat screenshot.

The backend owns the conversion logic and emits `figma-import-plan-v1` payloads. This plugin should stay thin: it loads fonts, creates Figma nodes/images/vectors, fetches temporary dMaya asset URLs when present, builds masks/groups, and applies the backend import plan.

## Local Development

1. In Figma desktop, open `Plugins > Development > Import plugin from manifest...`.
2. Select this repo's `manifest.json`.
3. Run `Plugins > Development > HTML to Figma by dMaya`.
4. Paste the copied payload or upload the downloaded `.json` payload.

Dragging the `.json` file directly onto a Figma canvas will not work. Figma does not import arbitrary JSON files as editable design documents.

## Checks

```bash
npm run check
```

The plugin must remain compatible with Figma's older JavaScript parser. Do not use optional chaining or nullish coalescing in `code.js`.

## Packaging

```bash
npm run pack
```

This creates `dist/dmaya-html-to-figma-plugin.zip` for manual release testing. Production users should install from the Figma Community listing once published; the frontend should link to that store URL, not to a hosted zip.

See `PUBLISHING.md` and `STORE_LISTING.md` before submitting the first Community build or any update.

## Release Notes

- Update `PLUGIN_BUILD` in `code.js`.
- Update `PLUGIN_VERSION` when the release changes compatibility or user-visible behavior.
- Update `REGRESSION_BASELINE.md`.
- Run `npm run check`.
- Smoke-test imports against the dMaya landing page and Workvio dashboard payloads.
