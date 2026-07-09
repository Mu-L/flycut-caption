import { useCallback, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Ban,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useTranslation } from '@/contexts/LocaleProvider';
import { SUBTITLE_FONTS } from '@/config/subtitleFonts';
import {
  type SubtitleStyle,
  fontSizeAtReference,
  bottomOffsetAtReference,
  fontSizeRatioFromReference,
  bottomOffsetRatioFromReference,
  STYLE_PRESETS,
  applyStylePreset,
  matchActiveStylePreset,
} from '@/subtitle';

interface SubtitleSettingsProps {
  style: SubtitleStyle;
  onStyleChange: (style: SubtitleStyle) => void;
  className?: string;
}


function SettingRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2 min-h-7', className)}>
      <span className="w-14 shrink-0 text-xs text-aimu-text-secondary">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

function NumberInput({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  return (
    <Input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const parsed = Number(e.target.value);
        if (!Number.isNaN(parsed)) onChange(clamp(parsed));
      }}
      className={cn(
        'h-6 w-12 shrink-0 border-aimu-border bg-aimu-input px-1.5 text-center text-[11px] text-aimu-text-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        className,
      )}
    />
  );
}

function SliderWithInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <SettingRow label={label}>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={([next]) => onChange(next)}
        className="aimu-slider flex-1 [&_[data-slot=slider-track]]:h-1"
      />
      <NumberInput value={value} min={min} max={max} onChange={onChange} />
    </SettingRow>
  );
}

function normalizeHexColor(value: string): string {
  const normalized = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) return normalized.toUpperCase();
  return '#FFFFFF';
}

function rgbaPreview(color: string, opacity: number): string {
  const hex = normalizeHexColor(color).replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function ColorControl({
  label,
  value,
  opacity,
  onChange,
  onOpacityChange,
  allowNone = false,
}: {
  label: string;
  value: string;
  opacity: number;
  onChange: (value: string) => void;
  onOpacityChange: (value: number) => void;
  allowNone?: boolean;
}) {
  const disabled = allowNone && opacity === 0;

  return (
    <div className="space-y-1.5 rounded border border-aimu-border bg-aimu-input p-2">
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-[10px] text-aimu-text-muted">{label}</span>
        <label className="relative h-7 w-9 shrink-0 cursor-pointer overflow-hidden rounded border border-aimu-border subtitle-alpha-bg">
          <input
            type="color"
            value={normalizeHexColor(value)}
            onChange={(e) => {
              onChange(e.target.value.toUpperCase());
              if (disabled) onOpacityChange(1);
            }}
            className="absolute -left-2 -top-2 h-12 w-12 cursor-pointer opacity-0"
          />
          <span className="block h-full w-full" style={{ backgroundColor: rgbaPreview(value, opacity) }} />
        </label>
        <Input
          value={normalizeHexColor(value)}
          onChange={(e) => onChange(normalizeHexColor(e.target.value))}
          className="h-7 flex-1 border-aimu-border bg-aimu-panel px-2 text-[11px] text-aimu-text-primary"
        />
        {allowNone && (
          <button
            type="button"
            data-active={disabled}
            onClick={() => onOpacityChange(disabled ? 1 : 0)}
            className="subtitle-none-color h-7 w-9 shrink-0 rounded border border-aimu-border text-[10px] text-aimu-text-muted transition-colors"
          >
            无
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-[10px] text-aimu-text-muted">透明</span>
        <Slider
          value={[Math.round(opacity * 100)]}
          min={0}
          max={100}
          step={1}
          onValueChange={([next]) => onOpacityChange(next / 100)}
          className="aimu-slider flex-1 [&_[data-slot=slider-track]]:h-1"
        />
        <NumberInput
          value={Math.round(opacity * 100)}
          min={0}
          max={100}
          onChange={(next) => onOpacityChange(next / 100)}
        />
      </div>
    </div>
  );
}

const toggleGroupClass = 'subtitle-settings-toggle h-7 border-aimu-border';

function PresetButton({
  active,
  onClick,
  preview,
  label,
}: {
  active: boolean;
  onClick: () => void;
  preview: (typeof STYLE_PRESETS)[number]['preview'];
  label: string;
}) {
  return (
    <button
      type="button"
      title={label}
      data-active={active}
      onClick={onClick}
      className="subtitle-preset-btn flex h-9 w-full items-center justify-center rounded-md border transition-colors"
      style={preview.backgroundColor ? { backgroundColor: preview.backgroundColor } : undefined}
    >
      {preview.showNone ? (
        <Ban className="h-4 w-4 text-aimu-text-muted" />
      ) : (
        <span
          className="text-lg font-bold leading-none"
          style={{
            color: preview.textColor,
            WebkitTextStroke: preview.borderColor ? `1px ${preview.borderColor}` : undefined,
          }}
        >
          T
        </span>
      )}
    </button>
  );
}

function AimuSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      onClick={() => onChange(!checked)}
      className="subtitle-settings-switch relative inline-flex h-4 w-8 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none"
    >
      <span
        className={cn(
          'pointer-events-none block h-3 w-3 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}

export function SubtitleSettings({
  style,
  onStyleChange,
  className,
}: SubtitleSettingsProps) {
  const { t } = useTranslation();
  const [positionOpen, setPositionOpen] = useState(true);

  const updateStyle = useCallback(
    (updates: Partial<SubtitleStyle>) => {
      onStyleChange({ ...style, ...updates });
    },
    [style, onStyleChange],
  );

  const fontSizeDisplay = fontSizeAtReference(style);
  const bottomOffsetDisplay = bottomOffsetAtReference(style);
  const activePreset = matchActiveStylePreset(style);

  return (
    <div className={cn('space-y-2.5 text-xs text-aimu-text-primary', className)}>
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-aimu-text-secondary">
          {t('components.workstation.presetStyles')}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(2.25rem,1fr))] gap-1.5 sm:grid-cols-[repeat(auto-fit,minmax(3.25rem,1fr))]">
          {STYLE_PRESETS.map((preset) => (
            <PresetButton
              key={preset.id}
              active={activePreset === preset.id}
              label={preset.label}
              preview={preset.preview}
              onClick={() => onStyleChange(applyStylePreset(style, preset.id))}
            />
          ))}
        </div>
      </div>

      <div className="h-px bg-aimu-border" />

      <SettingRow label={t('components.workstation.font')}>
        <Select value={style.fontId} onValueChange={(value) => updateStyle({ fontId: value })}>
          <SelectTrigger className="h-7 flex-1 border-aimu-border bg-aimu-input px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUBTITLE_FONTS.map((font) => (
              <SelectItem key={font.id} value={font.id} className="text-xs">
                <span style={{ fontFamily: font.family }}>{font.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SliderWithInput
        label={t('components.workstation.fontSize')}
        value={fontSizeDisplay}
        min={18}
        max={72}
        onChange={(value) => updateStyle({ fontSizeRatio: fontSizeRatioFromReference(value) })}
      />

      <SettingRow label={t('components.workstation.textStyle')}>
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          value={[
            ...(style.fontWeight === 'bold' ? ['bold'] : []),
            ...(style.textDecoration === 'underline' ? ['underline'] : []),
            ...(style.fontStyle === 'italic' ? ['italic'] : []),
          ]}
          onValueChange={(values) => {
            updateStyle({
              fontWeight: values.includes('bold') ? 'bold' : 'normal',
              textDecoration: values.includes('underline') ? 'underline' : 'none',
              fontStyle: values.includes('italic') ? 'italic' : 'normal',
            });
          }}
          className={toggleGroupClass}
        >
          <ToggleGroupItem value="bold" className="h-7 w-8 px-0 text-xs font-bold">
            B
          </ToggleGroupItem>
          <ToggleGroupItem value="underline" className="h-7 w-8 px-0 text-xs underline underline-offset-2">
            U
          </ToggleGroupItem>
          <ToggleGroupItem value="italic" className="h-7 w-8 px-0 text-xs italic">
            I
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingRow>

      <SettingRow label={t('components.workstation.color')} className="items-start">
        <div className="grid flex-1 gap-2">
          <ColorControl
            label="字体"
            value={style.color}
            opacity={style.colorOpacity}
            onChange={(value) => updateStyle({ color: value })}
            onOpacityChange={(value) => updateStyle({ colorOpacity: value })}
          />
          <ColorControl
            label={t('components.workstation.outline')}
            value={style.borderColor}
            opacity={style.borderOpacity}
            onChange={(value) => updateStyle({ borderColor: value, borderWidth: style.borderWidth || 2 })}
            onOpacityChange={(value) => updateStyle({ borderOpacity: value, borderWidth: value === 0 ? 0 : style.borderWidth || 2 })}
            allowNone
          />
          <ColorControl
            label={t('components.workstation.background')}
            value={style.backgroundColor}
            opacity={style.backgroundOpacity}
            onChange={(value) => updateStyle({ backgroundColor: value })}
            onOpacityChange={(value) => updateStyle({ backgroundOpacity: value })}
            allowNone
          />
        </div>
      </SettingRow>

      <SettingRow label="">
        <div className="flex flex-1 gap-2">
          <div className="flex flex-1 items-center gap-1.5">
            <span className="w-10 shrink-0 text-[10px] text-aimu-text-muted">
              {t('components.workstation.letterSpacing')}
            </span>
            <NumberInput
              value={style.letterSpacing}
              min={0}
              max={10}
              step={0.5}
              onChange={(value) => updateStyle({ letterSpacing: value })}
              className="flex-1"
            />
          </div>
          <div className="flex flex-1 items-center gap-1.5">
            <span className="w-10 shrink-0 text-[10px] text-aimu-text-muted">
              {t('components.workstation.lineSpacing')}
            </span>
            <NumberInput
              value={Math.round(style.lineHeight * 10)}
              min={8}
              max={30}
              onChange={(value) => updateStyle({ lineHeight: value / 10 })}
              className="flex-1"
            />
          </div>
        </div>
      </SettingRow>

      <Collapsible open={positionOpen} onOpenChange={setPositionOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between py-1 text-xs text-aimu-text-secondary hover:text-aimu-text-primary">
          <span>{t('components.workstation.positionSize')}</span>
          {positionOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-1">
          <SliderWithInput
            label={t('components.workstation.bottomOffset')}
            value={bottomOffsetDisplay}
            min={0}
            max={160}
            onChange={(value) => updateStyle({ bottomOffsetRatio: bottomOffsetRatioFromReference(value) })}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}