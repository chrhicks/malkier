---
name: malkier-ui
description: Guides UI work for Malkier's SolidJS frontend. Preserve and evolve the current terminal/cyber console aesthetic with bespoke CSS, responsive layouts, and accessible interaction patterns.
version: 1.0.0
---

# Malkier UI

Use this skill when working on `apps/solid` UI code: components, layout, styling, responsive behavior, or visual polish.

This repo does **not** use Tailwind or shadcn/ui for the current frontend. The default assumption is:

- **Stack:** SolidJS + Vite + TypeScript
- **Styling:** hand-authored global CSS in `apps/solid/src/index.css`
- **Visual language:** terminal / operator console / cyber deck
- **Typography:** monospace-forward, currently `IBM Plex Mono` with `Share Tech Mono`
- **Mood:** dark layered surfaces, thin borders, cyan accent, restrained glow, subtle ambient motion

## When To Use It

Use this skill for:

- New screens or UI sections in `apps/solid`
- Styling or layout refactors
- Responsive improvements
- Visual polish passes
- Accessibility cleanup on frontend controls and states

For a radical redesign, you can combine this with `frontend-design`, but keep Malkier's established identity unless the user explicitly wants a new direction.

## Default Workflow

1. Read the relevant Solid component(s) first.
2. Read the matching CSS in `apps/solid/src/index.css` before introducing new classes.
3. Preserve the existing visual language unless the user asks for a redesign.
4. Extend the current token and panel system instead of inventing a parallel styling system.
5. Verify both desktop and mobile behavior after the change.

## Aesthetic Direction

The target is **clean operator-console UI**, not generic SaaS chrome and not noisy sci-fi parody.

Aim for:

- Strong hierarchy through spacing, density, border treatment, and contrast
- A restrained cyber aesthetic with a few memorable details
- Panels that feel precise and instrument-like
- Interfaces that look intentional under both empty and busy states

Avoid:

- Generic AI dashboard aesthetics
- Purple gradient hero styling
- Excess blur, glassmorphism, or floating cards with no structural logic
- Decorative clutter that weakens readability
- Sudden font changes that break the terminal/editorial tone

## Styling Rules

- Prefer reusing existing CSS variables in `:root` before adding hardcoded colors.
- If a value will be reused two or more times, promote it to a CSS variable.
- Reuse the current semantic roles where possible:
  - `--accent`, `--accent-dim`
  - `--warn`, `--danger`, `--ok`
  - `--panel`, `--panel-2`, `--panel-border`, `--text`, `--muted`
- Prefer thin borders, subtle gradients, and selective glow over heavy shadows.
- Use classes in CSS, not inline styles, unless a value is truly dynamic at runtime.
- Keep radii tight and crisp. The current language favors precise edges over soft rounded cards.
- Add motion sparingly. One ambient layer plus short hover/focus transitions is usually enough.
- For larger animation work, include a `prefers-reduced-motion` fallback.

## Layout Rules

- Favor explicit `grid` and `flex` layouts with deliberate gaps.
- Keep the main information architecture readable in a one-column layout on smaller screens.
- Preserve the existing breakpoint logic unless a change clearly needs a new breakpoint.
  - Current key breakpoints are around `980px` and `560px`.
- Avoid fixed heights unless the scroll region is intentional and beneficial.
- When space gets tight, stack controls vertically instead of compressing hit targets.
- Empty states, loading states, and error states should look designed, not bolted on.

## Interaction And Accessibility

- Keep visible focus states on every interactive control.
- Use semantic elements: `button`, `label`, headings, lists, and form controls.
- Do not rely on color alone for status; pair it with text, labels, or iconography.
- Hover, focus, disabled, error, and pending states should all be represented when relevant.
- Keyboard interaction should remain obvious and intact after any UI refactor.

## Solid Implementation Rules

- Prefer straightforward `createSignal`, `createMemo`, and local helpers.
- Keep code in one component until a real reuse or readability boundary appears.
- Extract repeated markup into a component only when the boundary is clear.
- Prefer small, named formatting helpers over burying formatting logic in JSX.
- Keep styling concerns in CSS and state/orchestration concerns in TypeScript/TSX.
- Do not introduce a new UI framework or utility-class system unless the user asks for it.

## Malkier-Specific Review Questions

Before finishing a UI change, check:

- Does this still feel like Malkier rather than a generic web app?
- Did the change reuse or extend existing tokens instead of adding one-off colors and styles?
- Is the visual hierarchy clearer than before?
- Does it hold up on both desktop and mobile widths?
- Are non-happy-path states covered?
- If motion was added, does the UI still work well without it?

## Verification

After meaningful UI edits in `apps/solid`:

1. Read the edited files end-to-end.
2. Run the Solid app build from the workspace.
3. If the change is visually significant, inspect it in the browser at desktop and mobile widths.

Useful files to check first:

- `apps/solid/src/App.tsx`
- `apps/solid/src/components/MessageBubble.tsx`
- `apps/solid/src/index.css`
