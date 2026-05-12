# HTML to Figma Importer Regression Baseline

Known-good landing-page plugin build: `transparent-overflow-v8`

Current dashboard candidate build: `backend-import-plan-v15`

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
- New backend payloads should include `backendImportPlanVersion: "figma-import-plan-v1"` and per-node `importPlan` data for fills, effects, borders, clipping, vectors, layout, and text behavior.
- The plugin should prefer backend `importPlan` data when present while still importing older payloads through fallback heuristics.

## Manual Smoke Areas

- dMaya nav bar: spacing should stay natural, not collapsed.
- Hero eyebrow: `AI UI design canvas` text should fit inside the green pill with no stray line.
- Hero interactive preview: green check icons should render as checkmarks, not squares.
- Footer and FAQ: top-only borders should not become full borders.
- FAQ answers: clipped hidden answers are expected when closed.
- Under the hood cards: rounded top content, shadows, model tags, and clipped menus should remain visually close.
- Act 1 preview: hidden lower chat/status layers should be clipped by the message viewport.

## Update Rule

When a fix intentionally changes any protected behavior, update this baseline and bump `PLUGIN_BUILD` so the Figma UI clearly shows which importer is loaded.
