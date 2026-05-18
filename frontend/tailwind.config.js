/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans:  ['Pretendard Variable', 'Pretendard', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Noto Serif KR', 'Source Serif Pro', 'Georgia', 'ui-serif', 'serif'],
      },
      colors: {
        accent: 'rgb(var(--c-accent-rgb) / <alpha-value>)',
        up:     'var(--c-up)',
        down:   'var(--c-down)',
        /* renewal mono scale */
        ink: {
          0: 'var(--ink-0)',
          1: 'var(--ink-1)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
          4: 'var(--ink-4)',
          5: 'var(--ink-5)',
        },
        dot:   'var(--dot)',
        paper: 'var(--paper)',
        cream: 'var(--cream)',
        mist:  'var(--mist)',
      },
      fontSize: {
        '2xs': '11px',
        xs: '12px',
        sm: '13px',
        base: '14px',
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
      },
    },
  },
  plugins: [],
}
