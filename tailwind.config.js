/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'poker-green': {
          light: '#1e5631',
          DEFAULT: '#145028',
          dark: '#0d3d1c',
        },
        'poker-gold': '#ffd700',
        'poker-red': '#e63946',
      },
      animation: {
        'pulse-glow': 'pulse-glow 1.5s infinite',
        'thinking': 'thinking 1.4s infinite ease-in-out both',
        'action-pop': 'action-pop 1s ease forwards',
        'deal-card': 'deal-card 0.4s ease-out forwards',
        'flip-card': 'flip-card 0.6s ease forwards',
        'fade-in': 'fade-in 0.3s ease',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 15px rgba(255,215,0,0.6)' },
          '50%': { boxShadow: '0 0 25px rgba(255,215,0,0.9)' },
        },
        'thinking': {
          '0%, 80%, 100%': { transform: 'scale(0)' },
          '40%': { transform: 'scale(1)' },
        },
        'action-pop': {
          '0%': { transform: 'translateX(-50%) scale(0.5)', opacity: '0' },
          '20%': { transform: 'translateX(-50%) scale(1)', opacity: '1' },
          '80%': { transform: 'translateX(-50%) scale(1)', opacity: '1' },
          '100%': { transform: 'translateX(-50%) scale(0.8)', opacity: '0' },
        },
        'deal-card': {
          '0%': { opacity: '1', transform: 'translate(0, 0) rotate(0deg) scale(0.5)' },
          '100%': { opacity: '1', transform: 'translate(var(--deal-x), var(--deal-y)) rotate(var(--deal-rotate)) scale(1)' },
        },
        'flip-card': {
          '0%': { transform: 'rotateY(0deg)' },
          '100%': { transform: 'rotateY(180deg)' },
        },
        'fade-in': {
          'from': { opacity: '0' },
          'to': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
