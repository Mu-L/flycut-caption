import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import type { FlyCutCaptionLocale } from '@/locales';
import { defaultLocale } from '@/locales';
import zhCN from '@/locales/zh_CN';
import enUS from '@/locales/en_US';

// 语言包注册表
interface LocaleRegistry {
  [key: string]: FlyCutCaptionLocale;
}

// 内置语言包
const builtinLocales: LocaleRegistry = {
  'zh': zhCN,
  'zh-CN': zhCN,
  'en': enUS,
  'en-US': enUS,
};

// 语言包上下文类型
interface LocaleContextType {
  locale: FlyCutCaptionLocale;
  language: string;
  setLanguage: (lang: string) => void;
  registerLocale: (lang: string, localeData: FlyCutCaptionLocale) => void;
  getAvailableLanguages: () => string[];
  t: (path: string) => string;
}

// 创建上下文
const LocaleContext = createContext<LocaleContextType | null>(null);

// Provider 组件属性
interface LocaleProviderProps {
  children: React.ReactNode;
  language?: string;
  locale?: FlyCutCaptionLocale;
  onLanguageChange?: (language: string) => void;
}

// 获取嵌套对象的值
function getNestedValue(obj: unknown, path: string): string | undefined {
  const keys = path.split('.');
  let result = obj;

  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = (result as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return typeof result === 'string' ? result : undefined;
}

export function LocaleProvider({
  children,
  language = 'zh',
  locale,
  onLanguageChange
}: LocaleProviderProps) {
  // 自定义语言包注册表
  const [customLocales, setCustomLocales] = useState<LocaleRegistry>({});

  // 当前语言
  const [currentLanguage, setCurrentLanguage] = useState(language);

  // 同步外部 language prop 的变化
  useEffect(() => {
    setCurrentLanguage(language);
  }, [language]);

  // 获取当前语言包
  const currentLocale = useMemo(() => {
    if (locale) {
      return locale; // 如果直接传入了语言包，使用传入的
    }

    // 查找语言包：先查自定义，再查内置，最后使用默认
    const targetLocale = customLocales[currentLanguage] ||
                        builtinLocales[currentLanguage] ||
                        builtinLocales[currentLanguage.split('-')[0]] || // 尝试不带地区的语言代码
                        defaultLocale;

    return targetLocale;
  }, [locale, currentLanguage, customLocales]);

  // 设置语言
  const setLanguage = useCallback((lang: string) => {
    setCurrentLanguage(lang);
    onLanguageChange?.(lang);
  }, [onLanguageChange]);

  // 注册自定义语言包
  const registerLocale = useCallback((lang: string, localeData: FlyCutCaptionLocale) => {
    setCustomLocales(prev => ({
      ...prev,
      [lang]: localeData
    }));
  }, []);

  // 获取可用语言列表
  const getAvailableLanguages = useCallback(() => {
    const allLanguages = new Set([
      ...Object.keys(builtinLocales),
      ...Object.keys(customLocales)
    ]);
    return Array.from(allLanguages);
  }, [customLocales]);

  // 翻译函数
  const t = useCallback((path: string): string => {
    return getNestedValue(currentLocale, path) ??
      getNestedValue(defaultLocale, path) ??
      path;
  }, [currentLocale]);

  const contextValue: LocaleContextType = {
    locale: currentLocale,
    language: currentLanguage,
    setLanguage,
    registerLocale,
    getAvailableLanguages,
    t,
  };

  return (
    <LocaleContext.Provider value={contextValue}>
      {children}
    </LocaleContext.Provider>
  );
}

// Hook 用于使用语言包上下文
export function useLocale(): LocaleContextType {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}

// 简化的翻译 Hook
export function useTranslation() {
  const { t, locale, language } = useLocale();
  return { t, locale, language };
}

// 导出类型和内置语言包，供用户使用
export type { FlyCutCaptionLocale };
export { zhCN, enUS, defaultLocale };
