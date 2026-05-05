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

// Dark-green-tinted neutral scale (replaces Tailwind's `zinc`).
// 950/900 are the app shell, 800/700 are panels/borders, 100/50 fade to cream.
const brandNeutral = {
  50:  '#F6F0DC', // cream
  100: '#E8EFE7',
  200: '#D6E2D8',
  300: '#C5DAD0',
  400: '#A8C4B9',
  500: '#7BA396',
  600: '#4F8273',
  700: '#1F6450',
  800: '#07543F',
  900: '#003A2D',
  950: '#002A20',
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
        // Remap existing Tailwind colour names so existing `bg-emerald-*` /
        // `text-zinc-*` / `from-teal-*` classes pick up brand values without
        // touching the hundreds of usages across page components.
        emerald: brandGreen,
        teal: brandGreen,
        zinc: brandNeutral,
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
