const path = require("path");

// Wire the Malleable UI design-system preset when it's present on this branch.
// It lives on the `val/design-system` branch (not yet on main), so degrade
// gracefully when absent — the GPFree landing page is self-contained and uses
// no preset utilities, so the build stays green either way.
let presets = [];
try {
  presets = [require(path.join(__dirname, "design-system", "tailwind-preset.js"))];
} catch {
  presets = [];
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets,
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
};
