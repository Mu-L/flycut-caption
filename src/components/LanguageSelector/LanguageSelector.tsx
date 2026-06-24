import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Languages, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/contexts/LocaleProvider';

interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
}

interface LanguageSelectorProps {
  className?: string;
  variant?: 'button' | 'minimal';
  showText?: boolean;
  currentLanguage: string;
  languages: LanguageOption[];
  onLanguageChange: (language: string) => void;
}

export function LanguageSelector({
  className,
  variant = 'button',
  showText = true,
  currentLanguage,
  languages,
  onLanguageChange
}: LanguageSelectorProps) {
  const { t } = useTranslation();
  const currentLangInfo = languages.find(lang =>
    lang.code === currentLanguage ||
    lang.code === currentLanguage.split('-')[0]
  ) || languages[0];

  const handleLanguageChange = (languageCode: string) => {
    onLanguageChange(languageCode);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'minimal' ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('components.languageSelector.selectLanguage')}
            className={cn("h-8 px-2", className)}
          >
            <Languages className="h-4 w-4" />
            {showText && (
              <span className="ml-1 hidden sm:inline">
                {currentLangInfo.nativeName}
              </span>
            )}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            aria-label={t('components.languageSelector.selectLanguage')}
            className={cn("h-9 px-3", className)}
          >
            <Languages className="h-4 w-4" />
            {showText && (
              <span className="ml-2">
                {currentLangInfo.nativeName}
              </span>
            )}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {languages.map((language) => (
          <DropdownMenuItem
            key={language.code}
            onClick={() => handleLanguageChange(language.code)}
            className="flex items-center justify-between cursor-pointer"
          >
            <div className="flex flex-col">
              <span className="font-medium">{language.nativeName}</span>
              <span className="text-xs text-muted-foreground">{language.name}</span>
            </div>
            {(currentLanguage === language.code || currentLanguage.startsWith(language.code)) && (
              <Check className="h-4 w-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
