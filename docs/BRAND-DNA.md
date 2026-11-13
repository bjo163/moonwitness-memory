# ARCHIVE RIOT — Visual DNA

**MoonWitness Memory / Interface language v0.3**

## Core idea

MoonWitness Memory is not a generic backup dashboard. It is a local archive intelligence lab: a place where raw conversation history is collected, sorted, extracted and traced back to its source.

The visual metaphor is an underground archive room crossed with a manga field notebook and an industrial control deck. It should feel energetic and handcrafted, but remain usable for long working sessions.

## Identity pillars

1. **Archive Riot** — file labels, stamps, folders, index numbers, registration marks and evidence cards.
2. **Chaotic Intelligence** — collage rhythm, asymmetric composition and unexpected graphic interruptions without sacrificing reading order.
3. **Industrial Hardcore** — hard borders, machine labels, scan texture, halftone, angled panels and monospace telemetry.
4. **Manga Energy** — original vector characters, burst marks, expressive poses and editorial illustration.
5. **Neobrutalist HUD** — high contrast states, visible system status, strong action hierarchy and tactile buttons.

## Palette

| Token | Dark theme | Light theme | Usage |
|---|---|---|---|
| Asphalt | `#090B09` | `#E6E2D5` | Main canvas |
| Panel | `#111511` | `#F4F0E2` | Work surfaces |
| Acid lime | `#C8FF32` | `#A5CE12` | Primary action, online, signal |
| Riot orange | `#FF5B27` | `#E84B1E` | Warning, emphasis, interruption |
| Paper | `#EEEade` | `#161914` | Primary text |
| Muted | `#858C7D` | `#686C60` | Metadata |

Do not use every accent everywhere. Acid lime marks primary actions and healthy states. Orange signals urgency, annotation or a visual interruption.

## Typography

- Display: Barlow Condensed / Impact fallback. Use for large editorial headlines, panel titles and counters.
- UI/body: Space Grotesk / Arial fallback. Use for readable controls and prose.
- Telemetry: DM Mono / Consolas fallback. Use for identifiers, timestamps, states and small labels.

Fonts are progressive enhancement; the interface must remain legible when remote fonts are unavailable.

## Layout rules

- Persistent navigation rail at desktop widths; compact horizontal navigation on small screens.
- Editorial hero: large condensed headline, short explanation, one dominant import action and an original vector archivist illustration.
- Data panels use hard edges, visible borders and small indexing labels.
- Use asymmetry for emphasis, not for core controls or dense data tables.
- Responsive cards collapse from 4/3 columns to 2 and then 1.
- Keep archive names, job states, confidence and source identifiers readable.

## Interaction rules

- Theme toggle: dark industrial console and light paper archive. Light mode is a complete palette, not a CSS inversion.
- Motion is restrained: subtle pulse, float and panel entrance only. Respect `prefers-reduced-motion`.
- Every action should provide a visible status or disabled state.
- Search, import, resume, Drive backup and NDJSON export stay connected to the real API.
- Knowledge cards open a provenance reader that resolves original source messages.

## Reusable frontend components

- `components/icon.tsx` — centralized inline icon set.
- `components/ui.tsx` — metric, panel, section label, status and empty-state primitives.
- `components/manga-archivist.tsx` — original inline vector illustration.
- `app/globals.css` — centralized theme tokens, layout primitives, responsive rules and motion.

## Do / don't

**Do:** use index numbers, stamps, paper grain, halftone patterns, diagonal cuts, strong display typography and custom vector accents.

**Don't:** use generic gradient cards, glassmorphism everywhere, random neon colors, emoji as primary controls, tiny low-contrast labels, or decorative chaos that hides an action.

## Accessibility and performance

- All controls have accessible names and visible focus.
- Prefer CSS/vector artwork to large raster assets.
- Avoid motion when reduced motion is requested.
- Keep keyboard interaction and responsive layout intact.
- Use semantic landmarks and real button/link elements.
