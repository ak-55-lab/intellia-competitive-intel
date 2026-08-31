import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#f7f8fa",
        ink: "#16213a",
        muted: "#5b6478",
        faint: "#9aa3b2",
        line: "#e6e8ec",
        nav: "#142033",
        accent: "#1f3a5f",
        win: "#2e7d5b",
        caution: "#b8893b",
        threat: "#b23b3b"
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-inter)", "Inter", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"]
      },
      boxShadow: {
        panel: "0 1px 2px rgba(21,22,26,.05)",
        lift: "0 2px 8px rgba(21,22,26,.06), 0 12px 32px rgba(21,22,26,.05)"
      }
    }
  },
  plugins: []
};

export default config;
