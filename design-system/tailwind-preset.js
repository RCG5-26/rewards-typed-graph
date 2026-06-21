/**
 * Malleable UI — Tailwind preset
 * ─────────────────────────────────────────────────────────────────────
 * Bridges the CSS design tokens into Tailwind's theme so you can write
 * `bg-surface`, `text-secondary`, `rounded-card`, `shadow-card`,
 * `font-display`, `gap-md`, etc. Every value points at a CSS variable,
 * so the tokens stay the single source of truth (change the token, the
 * utility updates) and runtime theming keeps working.
 *
 * Usage — tailwind.config.js:
 *   const ds = require('./design-system/tailwind-preset');
 *   module.exports = { presets: [ds], content: [...] };
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        'bg-elevated': 'var(--color-bg-elevated)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          raised: 'var(--color-surface-raised)',
          subtle: 'var(--color-surface-subtle)',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          tertiary: 'var(--color-text-tertiary)',
          disabled: 'var(--color-text-disabled)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          subtle: 'var(--color-accent-subtle)',
          muted: 'var(--color-accent-muted)',
          fg: 'var(--color-accent-fg)',
          text: 'var(--color-accent-text)',
        },
        iris: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => [
            s,
            `var(--color-iris-${s})`,
          ]),
        ),
        neutral: Object.fromEntries(
          [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => [
            s,
            `var(--color-neutral-${s})`,
          ]),
        ),
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        error: 'var(--color-error)',
        // Plan / step lifecycle — drive node + chip colors from these.
        'status-current': 'var(--status-current)',
        'status-stale': 'var(--status-stale)',
        'status-superseded': 'var(--status-superseded)',
        'status-failed': 'var(--status-failed)',
        'status-generating': 'var(--status-generating)',
        'status-proposed': 'var(--status-proposed)',
      },
      borderColor: {
        DEFAULT: 'var(--color-border)',
        strong: 'var(--color-border-strong)',
        subtle: 'var(--color-border-subtle)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        display: 'var(--font-display)',
        mono: 'var(--font-mono)',
      },
      fontSize: {
        '2xs': 'var(--text-2xs)',
        xs: 'var(--text-xs)',
        sm: 'var(--text-sm)',
        base: 'var(--text-base)',
        md: 'var(--text-md)',
        lg: 'var(--text-lg)',
        xl: 'var(--text-xl)',
        '2xl': 'var(--text-2xl)',
        '3xl': 'var(--text-3xl)',
        '4xl': 'var(--text-4xl)',
        '5xl': 'var(--text-5xl)',
      },
      fontWeight: {
        thin: 'var(--weight-thin)',
        light: 'var(--weight-light)',
        normal: 'var(--weight-regular)',
        medium: 'var(--weight-medium)',
        semibold: 'var(--weight-semibold)',
      },
      letterSpacing: {
        tighter: 'var(--tracking-tighter)',
        tight: 'var(--tracking-tight)',
        snug: 'var(--tracking-snug)',
        normal: 'var(--tracking-normal)',
        wide: 'var(--tracking-wide)',
        wider: 'var(--tracking-wider)',
        widest: 'var(--tracking-widest)',
      },
      lineHeight: {
        none: 'var(--leading-none)',
        tight: 'var(--leading-tight)',
        snug: 'var(--leading-snug)',
        normal: 'var(--leading-normal)',
        relaxed: 'var(--leading-relaxed)',
        loose: 'var(--leading-loose)',
      },
      spacing: {
        0: 'var(--space-0)',
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        5: 'var(--space-5)',
        6: 'var(--space-6)',
        7: 'var(--space-7)',
        8: 'var(--space-8)',
        10: 'var(--space-10)',
        12: 'var(--space-12)',
        14: 'var(--space-14)',
        16: 'var(--space-16)',
        20: 'var(--space-20)',
        24: 'var(--space-24)',
        32: 'var(--space-32)',
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        '3xl': 'var(--radius-3xl)',
        full: 'var(--radius-full)',
        button: 'var(--radius-button)',
        card: 'var(--radius-card)',
        input: 'var(--radius-input)',
        chip: 'var(--radius-chip)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        card: 'var(--shadow-card)',
        raised: 'var(--shadow-raised)',
        float: 'var(--shadow-float)',
      },
      transitionTimingFunction: {
        'spring-snappy': 'var(--spring-snappy)',
        'spring-bounce': 'var(--spring-bounce)',
        'spring-gentle': 'var(--spring-gentle)',
        'spring-settle': 'var(--spring-settle)',
        soft: 'var(--ease-soft)',
      },
      transitionDuration: {
        instant: '80ms',
        fast: '150ms',
        base: '280ms',
        slow: '450ms',
        xslow: '700ms',
      },
    },
  },
};
