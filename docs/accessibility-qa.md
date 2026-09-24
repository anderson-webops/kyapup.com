# Accessibility QA Checklist

This checklist complements the automated `npm run a11y` axe smoke suite. Run it before shipping template page, starter layout, theme, routing, and generated-site changes.

## Screen Reader Pass

- macOS VoiceOver: open `/`, `/hi/a11y`; use `VO + Right Arrow` through each page, then jump by headings, landmarks, buttons, form controls, and links.
- Windows NVDA: repeat the same routes in Firefox or Chrome when a Windows machine is available; verify browse mode and focus mode both announce the active control and destination clearly.
- Confirm page titles, headings, landmarks, link text, form labels, validation messages, and interactive state changes are announced clearly.

## Keyboard Pass

- Start at the browser address bar and tab through each page without using the mouse.
- Verify visible focus on starter navigation, theme controls, generated page links, form controls added by a derived app, and footer links.
- Confirm no hidden control receives focus, no keyboard trap occurs, and Escape closes dismissible overlays or menus when present.

## Contrast And Motion Pass

- Check light mode and dark mode at desktop and mobile widths.
- Verify primary text, muted text, buttons, form controls, links, alerts, cards, and media captions remain readable.
- With reduced motion enabled, confirm animation is not the only status cue and no page depends on motion to be understandable.

## Required Automated Evidence

- `npm run a11y`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
