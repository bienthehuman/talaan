import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// Maskable and Apple icons are padded; fill the padding with the band colour (DESIGN_SYSTEM.md section 6).
const band = { resizeOptions: { background: "#16181d" } };

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, ...band },
    apple: { ...minimal2023Preset.apple, ...band },
  },
  images: ["public/favicon.svg"],
});
