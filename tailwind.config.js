/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  // Tailwind only generates a class it can SEE here. A class name written in a
  // folder that is not on this list produces no CSS and no error — the element
  // simply renders unstyled, which is the quietest possible failure and one
  // this project has already hit once (see the dead hero scrim in
  // components/base/Hero.tsx).
  //
  // lib/ and config/ are on the list not because they hold classes today —
  // they do not — but because nothing stops the next shared helper from
  // returning one, and the day that happens should not cost an afternoon.
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './config/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      // Desktop keeps 2rem. The phone override lives in globals.css, because
      // breakpoint-keyed padding here is silently dropped for any breakpoint
      // missing from `screens` below — and `screens` is narrowed to 2xl, so a
      // `md` key generates no CSS at all and desktop quietly loses its margin.
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        brand: "#047857",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require('tailwind-scrollbar')
  ],
}
