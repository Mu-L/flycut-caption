import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/contexts/LocaleProvider';

export interface SubtitleStyle {
  // 字体设置
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';

  // 颜色设置
  color: string;
  backgroundColor: string;
  borderColor: string;
  shadowColor: string;

  // 布局设置
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;

  // 边框和阴影
  borderWidth: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowBlur: number;

  // 背景
  backgroundOpacity: number;
  backgroundRadius: number;
  backgroundPadding: number;

  // 位置
  bottomOffset: number; // 距离底部的偏移量

  // 显示设置
  visible: boolean;
}

export const defaultSubtitleStyle: SubtitleStyle = {
  fontSize: 24,
  fontFamily: 'Arial, sans-serif',
  fontWeight: 'bold',
  fontStyle: 'normal',

  color: '#FFFFFF',
  backgroundColor: '#000000',
  borderColor: '#000000',
  shadowColor: '#000000',

  textAlign: 'center',
  lineHeight: 1.2,
  letterSpacing: 0,

  borderWidth: 1,
  shadowOffsetX: 1,
  shadowOffsetY: 1,
  shadowBlur: 2,

  backgroundOpacity: 0.8,
  backgroundRadius: 4,
  backgroundPadding: 8,

  bottomOffset: 60,

  visible: true,
};

interface SubtitleSettingsProps {
  style: SubtitleStyle;
  onStyleChange: (style: SubtitleStyle) => void;
  className?: string;
}

// Custom Aimu Toggle
function AimuToggle({ checked, onChange, label }: { checked: boolean, onChange: (c: boolean) => void, label?: string }) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="w-14 text-xs text-aimu-text-secondary shrink-0">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-4 w-8 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none",
          checked ? "bg-aimu-coral" : "bg-aimu-text-muted"
        )}
      >
        <span
          className={cn(
            "pointer-events-none flex h-3 w-3 items-center justify-center rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        >
          <span className={cn("text-[8px] font-bold", checked ? "text-aimu-coral" : "text-aimu-text-muted")}>
            {checked ? "Y" : "N"}
          </span>
        </span>
      </button>
    </div>
  );
}

// Custom Color Picker Block
function ColorBlock({ label, value, onChange }: { label: string, value: string, onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-6 h-6 rounded-[2px] border border-aimu-border overflow-hidden cursor-pointer">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute -top-2 -left-2 w-10 h-10 cursor-pointer opacity-0"
        />
        <div className="w-full h-full pointer-events-none" style={{ backgroundColor: value }} />
      </div>
      <span className="text-[10px] text-aimu-text-secondary whitespace-nowrap">{label}</span>
    </div>
  );
}

// Custom Slider Row
function SliderRow({ label, value, min, max, onChange }: { label: string, value: number, min: number, max: number, onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2 h-6">
      <span className="w-14 text-xs text-aimu-text-secondary shrink-0">{label}</span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={([v]) => onChange(v)}
        className="aimu-slider flex-1 [&_[data-slot=slider-track]]:h-1"
      />
      <span className="w-6 text-[11px] text-aimu-text-secondary text-right shrink-0">{value}</span>
    </div>
  );
}

export function SubtitleSettings({
  style,
  onStyleChange,
  className
}: SubtitleSettingsProps) {
  const { t } = useTranslation();
  const updateStyle = useCallback((updates: Partial<SubtitleStyle>) => {
    onStyleChange({ ...style, ...updates });
  }, [style, onStyleChange]);

  return (
    <div className={cn("bg-transparent text-aimu-text-primary text-xs p-3 space-y-3", className)}>
      {/* 1. 颜色 (Colors) */}
      <div className="flex items-start gap-2">
        <div className="w-12 font-bold mt-1 shrink-0">{t('components.workstation.colors')}:</div>
        <div className="flex gap-4">
          <ColorBlock label={t('components.workstation.primaryColor')} value={style.color} onChange={(v) => updateStyle({ color: v })} />
          <ColorBlock label={t('components.workstation.primaryOutline')} value={style.borderColor} onChange={(v) => updateStyle({ borderColor: v })} />
          <ColorBlock label={t('components.workstation.secondaryColor')} value={style.backgroundColor} onChange={(v) => updateStyle({ backgroundColor: v })} />
          <ColorBlock label={t('components.workstation.secondaryOutline')} value={style.shadowColor} onChange={(v) => updateStyle({ shadowColor: v })} />
        </div>
      </div>

      {/* 2. 尺寸 (Sizes) */}
      <div className="flex items-start gap-2">
        <div className="w-12 font-bold mt-1 shrink-0">{t('components.workstation.sizes')}:</div>
        <div className="flex-1 space-y-1.5">
          <SliderRow label={t('components.subtitleEditor.fontSize')} value={style.fontSize} min={14} max={30} onChange={(v) => updateStyle({ fontSize: v })} />
          <SliderRow label={t('components.workstation.letterSpacing')} value={style.letterSpacing} min={0} max={5} onChange={(v) => updateStyle({ letterSpacing: v })} />
          <SliderRow label={t('components.workstation.bottomOffset')} value={style.bottomOffset} min={0} max={100} onChange={(v) => updateStyle({ bottomOffset: v })} />
        </div>
      </div>

      {/* 3. 阴影 (Shadow) */}
      <div className="flex items-start gap-2">
        <div className="w-12 font-bold mt-1 shrink-0">{t('components.subtitleEditor.shadow')}:</div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center h-6">
            <AimuToggle 
              label={t('components.workstation.background')}
              checked={style.backgroundOpacity > 0} 
              onChange={(c) => updateStyle({ backgroundOpacity: c ? 0.8 : 0 })} 
            />
          </div>
          <SliderRow 
            label={t('components.workstation.opacity')}
            value={Math.round(style.backgroundOpacity * 250)} 
            min={0} 
            max={250} 
            onChange={(v) => updateStyle({ backgroundOpacity: v / 250 })} 
          />
          <SliderRow 
            label={t('components.workstation.outline')}
            value={style.borderWidth} 
            min={1} 
            max={3} 
            onChange={(v) => updateStyle({ borderWidth: v })} 
          />
          <SliderRow 
            label={t('components.workstation.offset')}
            value={style.shadowOffsetX} 
            min={0} 
            max={3} 
            onChange={(v) => updateStyle({ shadowOffsetX: v, shadowOffsetY: v })} 
          />
        </div>
      </div>

      {/* 4. 字体 (Font) */}
      <div className="flex items-start gap-2">
        <div className="w-12 font-bold mt-1 shrink-0">{t('components.workstation.font')}:</div>
        <div className="flex-1 flex flex-col gap-2">
          <Select value={style.fontFamily} onValueChange={(v) => updateStyle({ fontFamily: v })}>
            <SelectTrigger className="h-7 text-xs px-2 py-0 bg-aimu-input border-aimu-border w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Arial, sans-serif" className="text-xs">Arial</SelectItem>
              <SelectItem value="'Microsoft YaHei', sans-serif" className="text-xs">微软雅黑</SelectItem>
              <SelectItem value="'PingFang SC', sans-serif" className="text-xs">苹方</SelectItem>
              <SelectItem value="'Source Han Sans', sans-serif" className="text-xs">思源黑体(正常)</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-4 mt-1">
            <AimuToggle 
              label={t('components.workstation.bold')}
              checked={style.fontWeight === 'bold'} 
              onChange={(c) => updateStyle({ fontWeight: c ? 'bold' : 'normal' })} 
            />
            <AimuToggle 
              label={t('components.workstation.italic')}
              checked={style.fontStyle === 'italic'} 
              onChange={(c) => updateStyle({ fontStyle: c ? 'italic' : 'normal' })} 
            />
          </div>
        </div>
      </div>
    </div>
  );
}
