/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  theme: {
    extend: {
      colors: {
        // IEEE blue, sampled from the Figma brand panel + login/signup buttons.
        ieee: {
          50: '#e6f1f8',
          100: '#cce3f1',
          200: '#99c7e3',
          300: '#66abd5',
          400: '#338fc7',
          500: '#0073b9',
          600: '#00629b',
          700: '#005280',
          800: '#003e62',
          900: '#002b44',
          950: '#001f33',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 30px 60px -20px rgba(15, 23, 42, 0.18)',
      },
    },
  },
  plugins: [],
};
