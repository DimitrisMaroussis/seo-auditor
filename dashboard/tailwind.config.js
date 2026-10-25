/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        // Commissioner (Greek-designed, full Greek coverage) for everything; mono only for URLs, paths and codes.
        sans: ['"Commissioner"', '"Segoe UI"', "system-ui", "-apple-system", "Roboto", "Arial", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Consolas", "monospace"]
      },
      colors: {
        // Neutrals carry a faint plum tint so greys sit with the magenta instead of against it.
        // Overrides Tailwind's slate, so every existing slate-* class picks it up.
        slate: {
          50: "#faf7f9",
          100: "#f3eef1",
          200: "#e6dde2",
          300: "#d2c4cc",
          400: "#a8949f",
          500: "#7d6874",
          600: "#5f4c57",
          700: "#4a3843",
          800: "#2f222a",
          900: "#22171e",
          950: "#170f14"
        },
        // Brand magenta #e20074 at 500; lighter shades for dark-mode text.
        brand: {
          50: "#fff0f7",
          100: "#ffe0ef",
          200: "#ffc2df",
          300: "#ff8fc3",
          400: "#f5479b",
          500: "#e20074",
          600: "#c40065",
          700: "#a10053",
          800: "#7f0042",
          900: "#5c0030"
        }
      }
    }
  },
  plugins: []
};
