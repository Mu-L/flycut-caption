import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/contexts/LocaleProvider';
import { SUBTITLE_FONTS } from '@/config/subtitleFonts';
import {
  type SubtitleStyle,
  fontSizeAtReference,
  bottomOffsetAtReference,
  fontSizeRatioFromReference,
  bottomOffsetRatioFromReference,
  ASPECT_PRESETS,
  STYLE_PRESETS,
  applyAspectPreset,
  applyStylePreset,
} from '@/subtitle';

interface SubtitleSettingsProps {
  style: SubtitleStyle;
  onStyleChange: (style: SubtitleStyle) => void;
  className?: string;
}

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

  const fontSizeDisplay = fontSizeAtReference(style);
  const bottomOffsetDisplay = bottomOffsetAtReference(style);

  return (
    <div className={cn("bg-transparent text-aimu-text-primary text-xs p-3 space-y-3", className)}>
      <div className="flex items-start gap-2">
        <div className="w-12 font-bold mt-1 shrink-0">{t('components.workstation.colors')}:</div>
        <div className="flex gap-4">
          <ColorBlock label={t('components.workstation.primaryColor')} value={style.color} onChange={(v) => updateStyle({ color: v })} />
          <ColorBlock label={t('components.workstation.primaryOutline')} value={style.borderColor} onChange={(v) => updateStyle({ borderColor: v })} />
          <ColorBlock label={t('components.workstation.secondaryColor')} value={style.backgroundColor} onChange={(v) => updateStyle({ backgroundColor: v })} />
          <ColorBlock label={t('components.workstation.secondaryOutline')} value={style.shadowColor} onChange={(v) => updateStyle({ shadowColor: v })} />
        </div>
      </div>

      <div className="flex items-start gap-2">
        <div className="w-12 font-bold mt-1 shrink-0">{t('components.workstation.sizes')}:</div>
        <div className="flex-1 space-y-1.5">
          <SliderRow
            label={t('components.subtitleEditor.fontSize')}
            value={fontSizeDisplay}
            min={18}
            max={72}
            onChange={(v) => updateStyle({ fontSizeRatio: fontSizeRatioFromReference(v) })}
          />
          <SliderRow label={t('components.workstation.letterSpacing')} value={style.letterSpacing} min={0} max={5} onChange={(v) => updateStyle({ letterSpacing: v })} />
          <SliderRow
            label={t('components.workstation.bottomOffset')}
            value={bottomOffsetDisplay}
            min={0}
            max={160}
            onChange={(v) => updateStyle({ bottomOffsetRatio: bottomOffsetRatioFromReference(v) })}
          />
        </div>
      </div>

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

      <div className="flex items-start gap-2">
        <div className="w-12 font-bold mt-1 shrink-0">预设:</div>
        <div className="flex-1 flex flex-col gap-2">
          <Select
            value={style.aspectPreset}
            onValueChange={(v) => onStyleChange(applyAspectPreset(style, v as SubtitleStyle['aspectPreset']))}
          >
            <SelectTrigger className="h-7 text-xs px-2 py-0 bg-aimu-input border-aimu-border w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASPECT_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id} className="text-xs">
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            onValueChange={(v) => onStyleChange(applyStylePreset(style, v as typeof STYLE_PRESETS[number]['id']))}
          >
            <SelectTrigger className="h-7 text-xs px-2 py-0 bg-aimu-input border-aimu-border w-full">
              <SelectValue placeholder="应用样式预设…" />
            </SelectTrigger>
            <SelectContent>
              {STYLE_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id} className="text-xs">
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <div className="w-12 font-bold mt-1 shrink-0">{t('components.workstation.font')}:</div>
        <div className="flex-1 flex flex-col gap-2">
          <Select value={style.fontId} onValueChange={(v) => updateStyle({ fontId: v })}>
            <SelectTrigger className="h-7 text-xs px-2 py-0 bg-aimu-input border-aimu-border w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUBTITLE_FONTS.map((font) => (
                <SelectItem key={font.id} value={font.id} className="text-xs">
                  <span className="flex items-center gap-1.5">
                    <span style={{ fontFamily: font.family }}>{font.label}</span>
                    {font.recommended && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">
                        推荐
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-aimu-text-muted leading-snug">
            字号按 1080p 参考显示；不同分辨率视频自动保持相同画面比例。
          </p>
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