# @ansly/design

The single source of Ansly's colours and typography. The web app (via
Tailwind) and the browser extension (via CSS variables) both read from here,
so a change in this package changes every surface.

```ts
import { themes, palette, fontSize, themeDeclarations } from '@ansly/design'
```

## Colour

### Rule: use semantic tokens

UI code uses **semantic tokens**, never raw hex values or palette steps. A
semantic token has a light and a dark value, so a component written once
looks right in both themes.

| Token | Use for | Light | Dark |
| --- | --- | --- | --- |
| `bg` | Page background | neutral-25 | neutral-950 |
| `surface` | Cards, sheets, popovers, inputs | neutral-0 | neutral-900 |
| `surface-muted` | Wells, hover fills, secondary panels | neutral-50 | neutral-850 |
| `border` | Default dividers and outlines | neutral-100 | neutral-800 |
| `border-strong` | Hovered outlines, dashed drop zones | neutral-200 | neutral-700 |
| `fg` | Primary text | neutral-900 | neutral-50 |
| `muted` | Secondary text: descriptions, labels | neutral-600 | neutral-300 |
| `subtle` | Tertiary text: hints, placeholders, idle icons | neutral-400 | neutral-500 |
| `accent` | Primary actions, links, focus rings, selection | brand-500 | brand-400 |
| `accent-fg` | Text and icons on `accent` | neutral-0 | neutral-0 |
| `accent-soft` | Tinted backgrounds: selected rows, info | brand-50 | brand-950 |
| `success` / `success-soft` | Done, connected, high confidence | green-600 / 50 | green-400 / 950 |
| `warning` / `warning-soft` | Incomplete, needs attention | amber-600 / 50 | amber-400 / 950 |
| `danger` / `danger-soft` | Errors, destructive actions | red-600 / 50 | red-400 / 950 |

In Tailwind: `bg-surface`, `text-muted`, `border-border-strong`,
`ring-accent/15`. Opacity modifiers work on every token.

### Palette scales

`brand`, `orchid`, `magenta`, `blush`, `neutral`, `green`, `amber` and `red`,
each in steps 50–950 (`neutral` also has 0, 25 and 850). The scales back the
semantic tokens. Use them directly only for illustration and gradients, where
the hue itself is the point (`from-brand-700`).

### Gradients

| Gradient | Stops | Use for |
| --- | --- | --- |
| `brand` | brand-500 → orchid-400 → blush-400 | Highlighted words (`text-gradient`), the ✨ button, avatars |
| `deep` | brand-950 → brand-700 → magenta-800 | Large panels with white text (sign-in brand panel) |
| `vivid` | brand-600 → orchid-600 → magenta-600 | Call-to-action blocks with white text |

In Tailwind: `bg-gradient-brand`, `bg-gradient-deep`, `bg-gradient-vivid`.

## Typography

### Rule: one scale, no arbitrary sizes

Text sizes come only from this scale. The web app disables Tailwind's
default `text-xs … text-9xl`, so `text-[13px]` and `text-lg` are not
available. Each step sets its own line height, letter spacing and (for
headings) weight, so `text-h2` alone is a complete page title.

| Token | Size | Use for |
| --- | --- | --- |
| `display` | 40 → 58px, fluid | The one hero headline on a marketing page |
| `h1` | 30 → 36px, fluid | Marketing section titles, standalone page titles (privacy, 404) |
| `h2` | 26px | App page titles (`PageHeader`), auth and error pages |
| `h3` | 18px | Card hero titles, sheet titles |
| `title` | 15px | Card titles, list item titles, form section titles |
| `lead` | 18px | Marketing intro paragraphs |
| `body-lg` | 15px | Page descriptions, long-form reading |
| `body` | 14px | Default UI text |
| `body-sm` | 13px | Dense UI: nav items, labels, small buttons, chips |
| `caption` | 12px | Hints, metadata, badges, counters |
| `overline` | 11px, 600, tracked | Group labels above lists; always uppercase (use `<Overline>`) |

Weights: `font-normal` for running text, `font-medium` for labels and
buttons, `font-semibold` for emphasis. Headings already carry 600.

Numbers that change or line up (counts, stats, character limits) use
`tabular-nums`.

Fonts: Geist for text, Geist Mono for code and ordinal numbers.
