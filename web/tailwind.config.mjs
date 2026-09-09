const melon = {
  25: "#F6FEF9",
  50: "#EBFAF1",
  100: "#E1F7EA",
  200: "#C6EDD5",
  300: "#A5E0BD",
  400: "#86D5A5",
  500: "#68CA8F",
  DEFAULT: "#68CA8F",
  600: "#4FA270",
  700: "#3D7955",
  800: "#1F3D2B",
  900: "#1F3D2B",
  950: "#15281D",
};

const peel = {
  25: "#FFF8F2",
  50: "#FFEAE0",
  100: "#FFDAC9",
  200: "#F7BCA1",
  300: "#E2936B",
  400: "#EE6F3A",
  DEFAULT: "#EE6F3A",
  500: "#E0561B",
  600: "#BD4513",
  700: "#943810",
  800: "#69280C",
  900: "#4C1B07",
  950: "#38180B",
};

// Preserve the contrast hierarchy of the previous neutral scale while moving
// every neutral role onto Melon. Existing utility names remain aliases so the
// palette applies consistently to both current and legacy screens.
const melonNeutral = {
  25: melon[25],
  50: melon[25],
  100: melon[50],
  200: melon[100],
  300: melon[200],
  400: melon[600],
  500: melon[700],
  600: melon[800],
  700: melon[900],
  800: melon[900],
  900: "#000000",
  950: "#000000",
};

// Tailwind 4 refreshed its built-in color scales. Pin the legacy shades that
// are already used by the product so the framework migration does not
// silently recolor warnings, errors, and transaction states.
const legacyColors = {
  red: {
    50: "#fef2f2",
    100: "#fee2e2",
    200: "#fecaca",
    300: "#fca5a5",
    400: "#f87171",
    500: "#ef4444",
    600: "#dc2626",
    700: "#b91c1c",
    900: "#7f1d1d",
    950: "#450a0a",
  },
  orange: {
    50: "#fff7ed",
    100: "#ffedd5",
    200: "#fed7aa",
    400: "#fb923c",
    500: "#f97316",
    900: "#7c2d12",
    950: "#431407",
  },
  amber: {
    50: "#fffbeb",
    200: "#fde68a",
    300: "#fcd34d",
    400: "#fbbf24",
    600: "#d97706",
    700: "#b45309",
    800: "#92400e",
  },
  yellow: {
    400: "#facc15",
    950: "#422006",
  },
  blue: {
    400: "#60a5fa",
  },
  cyan: {
    400: "#22d3ee",
  },
  emerald: {
    50: "#ecfdf5",
    500: "#10b981",
  },
};

const config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        melon,
        peel,
        zinc: melonNeutral,
        gray: melonNeutral,
        neutral: melonNeutral,
        slate: melonNeutral,
        teal: melon,
        ...legacyColors,
        black: {
          DEFAULT: "#000000",
          500: "#000000",
          700: "#000000",
        },
        white: melon[25],
      },
      ringColor: {
        DEFAULT: melon[500],
      },
      boxShadow: {
        sm: "0 1px 2px 0 rgb(21 40 29 / 0.05)",
        DEFAULT: "0 1px 3px 0 rgb(21 40 29 / 0.1), 0 1px 2px -1px rgb(21 40 29 / 0.1)",
        md: "0 4px 6px -1px rgb(21 40 29 / 0.1), 0 2px 4px -2px rgb(21 40 29 / 0.1)",
        lg: "0 10px 15px -3px rgb(21 40 29 / 0.1), 0 4px 6px -4px rgb(21 40 29 / 0.1)",
        xl: "0 20px 25px -5px rgb(21 40 29 / 0.1), 0 8px 10px -6px rgb(21 40 29 / 0.1)",
        "2xl": "0 25px 50px -12px rgb(21 40 29 / 0.25)",
        inner: "inset 0 2px 4px 0 rgb(21 40 29 / 0.05)",
      },
      fontFamily: {
        sans: [
          "var(--font-simplon-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          '"Liberation Mono"',
          '"Courier New"',
          "monospace",
        ],
        mono: [
          "var(--font-simplon-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          '"Liberation Mono"',
          '"Courier New"',
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
