# Changelog

## 0.2.2

- Current importer build: `static-decor-v4`.
- Material Symbols icon ligatures now import as readable symbol characters when the icon font is unavailable in Figma.
- Large low-opacity positioned display text now preserves its measured browser text box so decorative background words stay aligned.
- Safe auto-layout rows now keep browser-measured child order and leave absolute pseudo-elements out of the layout flow.
- Italic text intent is preserved when the source family lacks an installed italic face.
- Linear-gradient fills now import as editable Figma gradient fills.
- Shadow-only containers now get a near-invisible support fill so Figma can render their box shadows.
- Remote image imports now fetch temporary R2 bytes before falling back to Figma's URL image API.
- Image fills intentionally skip experimental image filter payloads so real images remain visible across Figma runtimes.

## 0.2.1

- Current importer build: `remote-assets-v2`.
- Remote image imports now prefer Figma's URL image API, with byte-fetch fallback.
- Adds in-plugin import progress and clearer remote asset failure details.

## 0.2.0

- Current importer build: `remote-assets-v1`.
- Adds support for temporary dMaya R2 asset URLs so large payloads no longer need to embed every image as base64.
- Keeps backward compatibility with inline `dataUrl` payloads.

## 0.1.0

- Initial standalone plugin repo.
- Current importer build: `backend-import-plan-v15`.
- Supports backend `figma-import-plan-v1` payloads while keeping fallback support for older payloads.
- Adds payload compatibility checks so future payload/import-plan versions require a plugin update instead of silently importing.
