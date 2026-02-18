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
        'cream': {
          50: '#FDFCFA',
          100: '#FAF8F5',
          200: '#F5F0EB',
          300: '#E8E0D4',
          400: '#D4CCC0',
          500: '#B8AD9E',
          600: '#8B7E6A',
          700: '#6B5E4A',
          800: '#4A3F30',
          900: '#1A1A1A',
        },
        'forest': {
          DEFAULT: '#2D5A3D',
          light: '#3D7A53',
          dark: '#1D3A27',
        },
      },
      animation: {
        'pulse-glow': 'pulse-glow 1.5s infinite',
        'thinking': 'thinking 1.4s infinite ease-in-out both',
        'action-pop': 'action-pop 1s ease forwards',
        'deal-card': 'deal-card 0.4s ease-out forwards',
        'flip-card': 'flip-card 0.6s ease forwards',
        'fade-in': 'fade-in 0.3s ease',
        'scale-in': 'scale-in 0.2s ease-out forwards',
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
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/container-queries'),
  ],
}
