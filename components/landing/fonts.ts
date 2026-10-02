// components/landing/fonts.ts — written by generate_landing.py from brief.json "design.fonts".
// Change the fonts there and re-run: generate_landing.py . --design-only
import { DM_Sans, Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-landing-sans", display: "swap" });
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-landing-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-landing-mono", display: "swap" });

export const fontVariables = [sans.variable, display.variable, mono.variable].join(" ");
