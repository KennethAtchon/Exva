import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
const config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  safelist: [
    {
      pattern:
        /^(text|bg|border)-(success|error|warning|info|market|status-orange)(-(dim|border))?$/,
    },
    {
      pattern: /^text-log-(debug|info|warn|error)$/,
    },
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        micro: [
          "11px",
          { lineHeight: "15px", letterSpacing: "0.06em", fontWeight: "500" },
        ],
        caption: ["13px", { lineHeight: "18px", fontWeight: "400" }],
        body: ["14px", { lineHeight: "22px", fontWeight: "400" }],
        label: ["14px", { lineHeight: "22px", fontWeight: "500" }],
        data: ["14px", { lineHeight: "22px", fontWeight: "400" }],
        head: ["16px", { lineHeight: "24px", fontWeight: "600" }],
        title: [
          "20px",
          { lineHeight: "28px", letterSpacing: "-0.01em", fontWeight: "600" },
        ],
        stat: ["27px", { lineHeight: "32px", fontWeight: "600" }],
        hero: [
          "42px",
          { lineHeight: "46px", letterSpacing: "-0.02em", fontWeight: "600" },
        ],
      },
      spacing: {
        rail: "var(--rail)",
        contextbar: "var(--contextbar)",
        tape: "var(--tape)",
      },
      height: {
        rail: "var(--rail)",
        contextbar: "var(--contextbar)",
        tape: "var(--tape)",
      },
      width: {
        rail: "var(--rail)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 1px)",
        sm: "3px",
        DEFAULT: "var(--radius)",
      },
      boxShadow: {
        popover: "var(--shadow-popover)",
      },
      transitionDuration: {
        hover: "120ms",
        panel: "180ms",
        tape: "240ms",
      },
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        surface2: "var(--surface2)",
        surface3: "var(--surface3)",
        chip: "var(--chip)",
        hairline: "var(--hairline)",
        text1: "var(--text1)",
        text2: "var(--text2)",
        text3: "var(--text3)",
        "accent-dim": "var(--accent-dim)",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "hsl(var(--accent-foreground))",
          dim: "var(--accent-dim)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "var(--color-success)",
          dim: "var(--color-success-dim)",
          border: "var(--color-success-border)",
        },
        error: {
          DEFAULT: "var(--color-error)",
          dim: "var(--color-error-dim)",
          border: "var(--color-error-border)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
          dim: "var(--color-warning-dim)",
          border: "var(--color-warning-border)",
        },
        info: {
          DEFAULT: "var(--color-info)",
          dim: "var(--color-info-dim)",
          border: "var(--color-info-border)",
        },
        market: {
          DEFAULT: "var(--color-market)",
          dim: "var(--color-market-dim)",
          border: "var(--color-market-border)",
        },
        "status-orange": {
          DEFAULT: "var(--color-orange)",
          dim: "var(--color-orange-dim)",
          border: "var(--color-orange-border)",
        },
        "log-debug": "var(--color-log-debug)",
        "log-info": "var(--color-log-info)",
        "log-warn": "var(--color-log-warn)",
        "log-error": "var(--color-log-error)",
        border: {
          DEFAULT: "var(--border)",
          hsl: "hsl(var(--border-hsl))",
        },
        input: "hsl(var(--input-hsl))",
        ring: "hsl(var(--ring))",
      },
    },
  },
  plugins: [animate],
};

export default config;
