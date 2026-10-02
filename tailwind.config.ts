// Extends the "brutal" preset (templates/_ui/brutal/tailwind.preset.ts
// in the hackathon-starter skill). Tailwind v4 itself reads its design tokens from
// app/globals.css's `@theme inline` block — this is a documentation/tooling artifact.
const theme = {
  "name": "brutal",
  "mode": "light",
  "accent": "#0047ff",
  "accentContrast": "#ffffff",
  "surfaces": {
    "bg": "#f5f1e8",
    "surface": "#ffffff",
    "surfaceRaised": "#fff2b8",
    "border": "#000000"
  },
  "text": {
    "fg": "#0a0a0a",
    "fgMuted": "#4a4a4a"
  },
  "radii": {
    "radius": "0px",
    "radiusSm": "0px"
  },
  "shadows": {
    "shadow": "6px 6px 0 #000"
  },
  "font": {
    "sans": "Geist",
    "display": "Bricolage Grotesque"
  },
  "typeScale": {
    "sm": "0.875rem",
    "base": "1rem",
    "lg": "1.125rem",
    "xl": "1.5rem",
    "2xl": "2rem"
  }
} as const;

export default theme;
