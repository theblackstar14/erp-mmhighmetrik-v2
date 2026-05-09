import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';

type ThemeState = {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      toggle: () => {
        const next: Theme = get().theme === 'light' ? 'dark' : 'light';
        document.documentElement.dataset.theme = next;
        set({ theme: next });
      },
      setTheme: (t) => {
        document.documentElement.dataset.theme = t;
        set({ theme: t });
      },
    }),
    { name: 'erp-theme' },
  ),
);

// Inicializa al cargar (lee de localStorage)
if (typeof document !== 'undefined') {
  const stored = JSON.parse(localStorage.getItem('erp-theme') ?? '{"state":{"theme":"light"}}');
  document.documentElement.dataset.theme = stored?.state?.theme ?? 'light';
}
