import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/contexts/LocaleProvider';

interface ThemeToggleProps {
  variant?: 'select' | 'button';
  className?: string;
}

const themeOptions = [
  { value: 'light', labelKey: 'components.themeToggle.light', icon: Sun },
  { value: 'dark', labelKey: 'components.themeToggle.dark', icon: Moon },
  { value: 'system', labelKey: 'components.themeToggle.auto', icon: Monitor },
] as const;

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ 
  variant = 'button', 
  className 
}) => {
  const { theme, setTheme, toggleTheme } = useThemeStore();
  const { t } = useTranslation();

  if (variant === 'select') {
    return (
      <Select value={theme} onValueChange={setTheme}>
        <SelectTrigger className={className}>
          <SelectValue>
            {(() => {
              const currentOption = themeOptions.find(option => option.value === theme);
              const Icon = currentOption?.icon || Monitor;
              return (
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span>{currentOption ? t(currentOption.labelKey) : t('components.themeToggle.auto')}</span>
                </div>
              );
            })()}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {themeOptions.map((option) => {
            const Icon = option.icon;
            return (
              <SelectItem key={option.value} value={option.value}>
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span>{t(option.labelKey)}</span>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    );
  }

  // Button variant
  const currentOption = themeOptions.find(option => option.value === theme);
  const Icon = currentOption?.icon || Monitor;

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      className={className}
      title={`${t('components.themeToggle.currentTheme')}: ${currentOption ? t(currentOption.labelKey) : t('components.themeToggle.auto')}`}
    >
      <Icon className="h-4 w-4" />
      <span className="sr-only">{t('components.themeToggle.toggleTheme')}</span>
    </Button>
  );
};
