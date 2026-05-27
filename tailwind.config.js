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
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
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
          DEFAULT: "hsl(var(--accent-hsl))",
          foreground: "hsl(var(--accent-foreground))",
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
        border: "hsl(var(--border-hsl))",
        input: "hsl(var(--input-hsl))",
        ring: "hsl(var(--ring))",
      },
    },
  },
  plugins: [animate],
};

export default config;
