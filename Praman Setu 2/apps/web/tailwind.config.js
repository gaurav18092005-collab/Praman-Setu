/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#EEF2FA',
          100: '#D9E2F3',
          200: '#B3C5E7',
          300: '#86A2D6',
          400: '#557CC1',
          500: '#335CA6',
          600: '#1E4080',
          700: '#1A376D',
          800: '#152C57',
          900: '#102141',
        },
        saffron: {
          50: '#FFF5EC',
          100: '#FFE7D1',
          200: '#FFCDA3',
          300: '#F9AC6B',
          400: '#F08D3F',
          500: '#E8741E',
          600: '#CE5F12',
          700: '#A94B0D',
          800: '#833A0C',
          900: '#5F2B0B',
        },
        green: {
          50: '#EDF7EC',
          100: '#D6EDD3',
          200: '#AEDCA8',
          300: '#7FC577',
          400: '#4FA847',
          500: '#2C8C25',
          600: '#138808',
          700: '#0F6D07',
          800: '#0C5507',
          900: '#093F06',
        },
        paper: {
          50: '#FFFDF8',
          100: '#FAF6EE',
          200: '#F4EDDF',
          300: '#EAE0CC',
          400: '#D9CBB0',
        },
        ink: {
          50: '#F5F6F8',
          100: '#E7E9EE',
          300: '#A9AFBD',
          500: '#5C6478',
          700: '#333B4D',
          900: '#1B2434',
        },
      },
      fontFamily: {
        sans: [
          '"Noto Sans"',
          '"Noto Sans Devanagari"',
          '"Noto Sans Gurmukhi"',
          '"Noto Nastaliq Urdu"',
          '"Noto Naskh Arabic"',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        serif: [
          '"Noto Serif"',
          '"Noto Serif Devanagari"',
          '"Noto Sans Gurmukhi"',
          '"Noto Nastaliq Urdu"',
          'Georgia',
          'serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgba(27, 36, 52, 0.06), 0 8px 24px -12px rgba(27, 36, 52, 0.18)',
        lift: '0 10px 30px -12px rgba(27, 36, 52, 0.35)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      maxWidth: {
        app: '44rem',
        wide: '72rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out both',
        shimmer: 'shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [],
};
