/** @type {import("prettier").Config} */
const config = {
  printWidth: 100,
  semi: true,
  quoteProps: "as-needed",
  jsxSingleQuote: false,
  bracketSpacing: true,
  arrowParens: "always",
  plugins: ["prettier-plugin-tailwindcss", "prettier-plugin-organize-imports"],
};

export default config;
