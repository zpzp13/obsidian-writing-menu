# Export UI references and licensing

The export UI is an original Obsidian Modal/DOM/CSS implementation. The user's two-column layout separates metadata settings above a Bases-backed document collection, with a full format drill-down page. Current controls reuse the plugin's toolbar, plot sidebar, dictionary search and shared segmented-control styles. Document queries use Obsidian's public Bases view API and a temporary inline base rendered through MarkdownRenderer; no additional UI framework is shipped. The following source was inspected for visual/interaction reference; React/Tailwind components are not shipped.

| Source | Used as reference | License |
| --- | --- | --- |
| [tweakcn theme-control-panel](https://github.com/jnsahaj/tweakcn/blob/main/components/editor/theme-control-panel.tsx) | Compact tabs, aligned setting rows, color and numeric controls | Apache-2.0 |
| [shadcn settings dialog](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/blocks/sidebar-13/components/settings-dialog.tsx) | Dialog spacing, quiet borders and selection states | MIT |
| [shadcn resizable example](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/examples/resizable-demo.tsx) | Nested split panels, adapted to the left side and native pointer/keyboard events | MIT |
| [Excalidraw ImageExportDialog.scss](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/components/ImageExportDialog.scss) | Preview frame, setting groups and action/status placement | MIT |

## Shipped code and assets

- User-provided `filetype-txt.svg` and `filetype-docx.svg` are Bootstrap Icons (MIT, Copyright 2019–2024 The Bootstrap Authors). Their paths are embedded in `src/export/ExportIcons.ts`. HWPX preserves the DOCX outline with newly drawn HWPX letter paths. No external SVG path is needed at runtime.
- [kordoc](https://github.com/chrisryugj/kordoc), MIT, Copyright 2026 chrisryugj: version 4.24.6, revision `71666c52fe6321e2ad1df8dfbc21b58693bd6ae3`. SVG/reflow/style core only; native XML object shapes also informed the adapter. `scripts/vendor-kordoc.mjs` reproduces the module graph from this revision and records original source hashes. Browser modifications replace Node ZIP streams with bounded JSZip byte streams, Node image base64 with `btoa`, and CLI logging/environment handling with inert browser behavior. Modified generated modules retain source attribution. See `vendor/kordoc/LICENSE` and provenance.
- [docx](https://github.com/dolanmiu/docx) 9.14.0: MIT, Copyright 2016 Dolan.
- [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) 0.4.1: Apache-2.0. It renders generated DOCX only; altChunk rendering is disabled.
- markdown-it 14.3.3 and markdown-it-footnote 4.0.0: MIT.
- fflate, JSZip and @xmldom/xmldom: their distributions retain their respective MIT/(JSZip dual MIT/GPLv3, used under MIT) notices. xmldom is pinned to 0.9.12.

Full license texts for these newly shipped dependencies and icons are retained under `vendor/licenses/`. The production main.js banner includes the combined notices so that the normal community installer also carries them. Upstream UI reference licenses can be consulted at the linked repositories; no UI component source is copied wholesale.
