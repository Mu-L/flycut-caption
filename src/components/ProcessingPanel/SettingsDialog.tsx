// 设置弹窗 - 模型下载

import { ModelDownloadPanel } from '@/components/ASR/ModelDownloadPanel';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Package } from 'lucide-react';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Package className="h-5 w-5" />
            <span>模型下载</span>
          </DialogTitle>
        </DialogHeader>

        <div className="pt-2">
          <ModelDownloadPanel />
        </div>
      </DialogContent>
    </Dialog>
  );
}
