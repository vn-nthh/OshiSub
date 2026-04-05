/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"MS Sans Serif"', '"Segoe UI"', 'Tahoma', 'Geneva', 'Verdana', 'sans-serif'],
        mono: ['"Fixedsys"', '"Lucida Console"', '"Courier New"', 'monospace'],
      },
      colors: {
        win: {
          surface: '#c0c0c0',
          title: '#000080',
          desktop: '#008080',
        },
      },
    },
  },
  plugins: [],
};
