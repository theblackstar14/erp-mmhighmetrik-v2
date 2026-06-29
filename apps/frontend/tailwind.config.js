/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
    },
    extend: {
      screens: {
        '3xl': '1920px',
        '4xl': '2560px',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        'bg-elev': 'hsl(var(--bg-elev))',
        'bg-sunken': 'hsl(var(--bg-sunken))',
        'ink-2': 'hsl(var(--ink-2))',
        'ink-3': 'hsl(var(--ink-3))',
        'ink-4': 'hsl(var(--ink-4))',
        line: 'hsl(var(--line))',
        'line-2': 'hsl(var(--line-2))',
        'line-strong': 'hsl(var(--line-strong))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          soft: 'hsl(var(--primary-soft))',
          ink: 'hsl(var(--primary-ink))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          soft: 'hsl(var(--destructive-soft))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        warn: {
          DEFAULT: 'hsl(var(--warn))',
          soft: 'hsl(var(--warn-soft))',
          ink: 'hsl(var(--warn-ink))',
        },
        ok: {
          DEFAULT: 'hsl(var(--ok))',
          soft: 'hsl(var(--ok-soft))',
          ink: 'hsl(var(--ok-ink))',
        },
        danger: 'hsl(var(--destructive))',
      },
      borderRadius: {
        lg: 'calc(var(--radius) + 4px)',
        md: 'var(--radius)',
        sm: 'calc(var(--radius) - 2px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pageEnter: {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.99)' },
          // 'none' al final · evita transform residual que crea containing-block para position:fixed (modales)
          '100%': { opacity: '1', transform: 'none' },
        },
        loginExit: {
          '0%': { opacity: '1', transform: 'scale(1)', filter: 'blur(0)' },
          '100%': { opacity: '0', transform: 'scale(1.02)', filter: 'blur(4px)' },
        },
        appEnter: {
          '0%': { opacity: '0', transform: 'scale(1.02)', filter: 'blur(4px)' },
          // 'none' al final · transform Y filter residuales también crean containing-block para fixed
          '100%': { opacity: '1', transform: 'none', filter: 'none' },
        },
        // pop suave con leve overshoot · para modales (drill categoría)
        modalPop: {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        backdropIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        // fade rápido de solo opacidad · para contenido que llega de una query (sin slide lento)
        dataIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        // barra indeterminada del splash de boot · desliza un segmento de izq a der
        bootbar: {
          '0%': { transform: 'translateX(-110%)' },
          '100%': { transform: 'translateX(410%)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn .6s ease both',
        dataIn: 'dataIn .16s ease-out both',
        pageEnter: 'pageEnter .35s cubic-bezier(.2,.7,.3,1) both',
        loginExit: 'loginExit .45s cubic-bezier(.65,0,.35,1) forwards',
        appEnter: 'appEnter .55s cubic-bezier(.2,.7,.3,1) both',
        modalPop: 'modalPop .26s cubic-bezier(.34,1.4,.5,1) both',
        backdropIn: 'backdropIn .18s ease both',
        bootbar: 'bootbar 1.1s cubic-bezier(.4,0,.2,1) infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
