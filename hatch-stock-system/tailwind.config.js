/** @type {import('tailwindcss').Config} */

// Hatch brand palette (Style Guide):
//   cream     #F6F0DC
//   green     #166C53  (mid green — primary accent)
//   dark      #004638  (dark green — backgrounds)

// Brand-green scale, anchored at 600 = #166C53
const brandGreen = {
  50:  '#EAF3EE',
  100: '#D1E5DA',
  200: '#A4CBB6',
  300: '#6FAE8E',
  400: '#3E8F6E',
  500: '#1F7A5C',
  600: '#166C53',
  700: '#10573F',
  800: '#0A4231',
  900: '#063225',
  950: '#03241B',
};

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Canonical brand tokens
        hatch: {
          cream: '#F6F0DC',
          green: '#166C53',
          dark:  '#004638',
        },
        // Remap accent palettes so existing `bg-emerald-*` / `from-teal-*`
        // classes resolve to brand mid-green. `zinc` is left at Tailwind's
        // default neutral scale so panels and chrome read as proper darks
        // rather than tinted green.
        emerald: brandGreen,
        teal: brandGreen,
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
