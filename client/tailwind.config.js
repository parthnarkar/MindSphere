/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      screens: {
        'xs': '475px',
      },
      colors: {
        primary: {
          DEFAULT: "#4aaab1",
          50: "#e6f7f8",
          100: "#c2ecef",
          200: "#99e0e5",
          300: "#6fd3db",
          400: "#4aaab1",
          500: "#36898f",
          600: "#25696e",
          700: "#18494d",
          800: "#0c292c",
          900: "#051415",
        },
        secondary: {
          DEFAULT: "#fbbf24", // gold accent
        },
        accent: {
          DEFAULT: "#7f5af0", // purple accent
        },
        background: "#f8fafc",
        surface: "#ffffff",
        border: "#e5e7eb",
        muted: "#f3f4f6",
        "primary-gradient-from": "#4aaab1",
        "primary-gradient-to": "#36898f",
      },
      gradientColorStops: (theme) => ({
        ...theme("colors"),
        "primary-from": "#4aaab1",
        "primary-to": "#36898f",
        "accent-from": "#7f5af0",
        "accent-to": "#4aaab1",
      }),
      typography: {
        DEFAULT: {
          css: {
            maxWidth: 'none',
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    function({ addUtilities }) {
      addUtilities({
        '.line-clamp-2': {
          display: '-webkit-box',
          '-webkit-line-clamp': '2',
          '-webkit-box-orient': 'vertical',
          overflow: 'hidden',
        },
        '.line-clamp-3': {
          display: '-webkit-box',
          '-webkit-line-clamp': '3',
          '-webkit-box-orient': 'vertical',
          overflow: 'hidden',
        },
      })
    }
  ],
};