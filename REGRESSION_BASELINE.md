# HTML to Figma Importer Regression Baseline

Known-good landing-page plugin build: `transparent-overflow-v8`

Current dashboard candidate build: `render-ir-export-v6`

This file pins the behavior that must not regress while improving new layouts such as dashboards.

## Protected Behaviors

- Plugin code must stay compatible with Figma's older JavaScript parser: no optional chaining or nullish coalescing in `code.js`.
- Text nodes must load fonts before text sizing, auto-resize, or font property changes.
- Single-line labels and logo text must keep their measured width and avoid unwanted wrapping.
- Small horizontal chips may use auto layout, but larger nav/tool rows must not collapse.
- Vertically centered text in pills, bullets, numbered labels, and icon rows must remain visually centered.
- Per-side borders must stay per-side. `border-top` must not become a full rectangle border.
- CSS shadows must convert to Figma effects without removing fills, borders, or rounded clipping.
- Rounded containers with overflowing children must clip/mask content so sharp inner corners do not show.
- Transparent fixed-height stacks that visually hide overflowing content, such as the Act 1 chat preview, must clip their hidden children.
- CSS `opacity`, `blur`, `lab()`, `lch()`, `oklab()`, `oklch()`, and `color()` values must preserve visible colors as closely as possible.
- SVG icons using `currentColor` or modern CSS colors must import as vector shapes with the correct color, not black icons or square placeholders.
- Compact SVG icons must preserve their browser `viewBox` padding so line icons do not import oversized or visually off-center.
- Absolutely positioned adornments such as search icons must paint above static controls when CSS would layer them that way.
- Center-rotated SVGs, such as circular progress rings, should bake the rotation into the SVG markup instead of shifting the Figma node position.
- Browser-measured multiline text should preserve its measured width, so wrapped headings and mixed inline copy do not stretch into one long Figma line.
- Stale or union-rect inline text payloads should be defensively split when sibling text already occupies the first line.
- Text decoration from CSS, especially `line-through`, should become Figma text decoration.
- Inline wrap repair should keep a natural word gap after previous inline fragments.
- Icon-font ligatures such as Material Symbols `arrow_forward` should not import as literal merged words when Figma lacks the icon font.
- Large positioned decorative text should keep its measured browser box instead of auto-resizing into a shifted fallback-font box.
- Small visual pseudo-elements, such as decorative CTA underlines, should import as positioned layers without changing auto-layout child order.
- Italic labels and counters should stay italic even when the exact source font family italic face is unavailable in Figma.
- Simple CSS linear gradients should become editable Figma gradient fills.
- Containers with CSS box-shadow and no visible fill should still render the shadow in Figma.
- New backend payloads should include `backendImportPlanVersion: "figma-import-plan-v1"` and per-node `importPlan` data for fills, effects, borders, clipping, vectors, layout, and text behavior.
- Internal Render IR payloads must stay on the same generic payload/import-plan contract; the plugin must not add browser extraction, CSS interpretation, or website-specific handling.
- Large Render IR verification imports should yield often enough for progress/cancel messages, so a stale payload cannot leave the plugin permanently stuck.
- The plugin should prefer backend `importPlan` data when present while still importing older payloads through fallback heuristics.
- Payloads may use temporary remote asset URLs for large images and snapshots. The plugin must fetch those assets during import while keeping old inline `dataUrl` payloads working.
- Remote image imports should prefer fetching temporary R2 bytes and show progress in the plugin UI while layers/assets are being created.
- Backend `remote-assets-v4` payloads may keep small normalized PNG assets inline while offloading larger images to temporary R2 URLs; the plugin must continue importing both in the same payload.
- Internal Render IR verification may send `import-payload-and-export`; the plugin should import
  through the same generic path and return a PNG export of the imported root node without adding
  browser extraction, CSS interpretation, or website-specific logic.
- Internal large-payload verification may load payload JSON from an explicit URL, including the
  localhost verification server listed in development network access. URL loading is transport
  only; imported nodes must still use the same generic payload/import-plan path.
- The local verification URL may auto-run import plus PNG export when the development localhost
  server is available. This is only for internal Render IR measurement and must not introduce
  browser extraction, CSS interpretation, or site-specific behavior into the plugin.

## Manual Smoke Areas

- dMaya nav bar: spacing should stay natural, not collapsed.
- Hero eyebrow: `AI UI design canvas` text should fit inside the green pill with no stray line.
- Hero interactive preview: green check icons should render as checkmarks, not squares.
- Footer and FAQ: top-only borders should not become full borders.
- FAQ answers: clipped hidden answers are expected when closed.
- Under the hood cards: rounded top content, shadows, model tags, and clipped menus should remain visually close.
- Act 1 preview: hidden lower chat/status layers should be clipped by the message viewport.
- Internal Render IR sample payloads: absolute text, image fills, vectors, borders, shadows, opacity, and clipping plans should import through the same generic path.

## Update Rule

When a fix intentionally changes any protected behavior, update this baseline and bump `PLUGIN_BUILD` so the Figma UI clearly shows which importer is loaded.
