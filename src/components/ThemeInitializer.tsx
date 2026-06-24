import { useEffect } from 'react';
import { useThemeStore } from '@/stores/themeStore';

export function ThemeInitializer() {
  const { resolvedTheme, setTheme } = useThemeStore();

  useEffect(() => {
    // 确保主题正确应用到 DOM
    const applyTheme = (theme: 'light' | 'dark') => {
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(theme);
    };

    // 立即应用当前主题
    applyTheme(resolvedTheme);
    
    // 如果是首次访问且没有保存的主题，设置默认主题
    if (!localStorage.getItem('theme-storage')) {
      setTheme('light');
    }
  }, [resolvedTheme, setTheme]);

  return null;
}
