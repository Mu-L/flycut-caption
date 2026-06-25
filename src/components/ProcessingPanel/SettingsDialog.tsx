// 设置弹窗 - 模型下载 + 智能剪切空白段阈值

import { ModelDownloadPanel } from '@/components/ASR/ModelDownloadPanel';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Package, Wand2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useTranslation } from '@/contexts/LocaleProvider';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t } = useTranslation();
  const smartCutSilenceThreshold = useAppStore(state => state.smartCutSilenceThreshold);
  const setSmartCutSilenceThreshold = useAppStore(state => state.setSmartCutSilenceThreshold);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Package className="h-5 w-5" />
            <span>{t('components.workstation.tools')}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="pt-2">
          <ModelDownloadPanel />
        </div>

        {/* 智能剪切空白段阈值 */}
        <div className="pt-4 mt-4 border-t border-aimu-border">
          <div className="flex items-center gap-2 mb-3">
            <Wand2 className="h-4 w-4 text-aimu-coral" />
            <span className="text-sm font-medium text-aimu-text-primary">
              {t('components.workstation.smartCutBlankTitle')}
            </span>
          </div>
          <div className="px-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-aimu-text-muted">
                {t('components.workstation.smartCutThreshold')}
              </span>
              <span className="text-xs font-mono text-aimu-text-primary">
                {smartCutSilenceThreshold.toFixed(1)}s
              </span>
            </div>
            <Slider
              value={[smartCutSilenceThreshold]}
              min={0.2}
              max={5}
              step={0.1}
              onValueChange={(v) => setSmartCutSilenceThreshold(v[0])}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}