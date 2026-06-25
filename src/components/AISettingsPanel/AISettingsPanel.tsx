// AI 模型管理面板 - 放在播放器下方 "api" 标签页
// 支持添加 / 编辑 / 删除 OpenAI 兼容模型，并选择默认模型用于字幕纠错 / 翻译

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/appStore'
import { useTranslation } from '@/contexts/LocaleProvider'
import type { AIModelConfig } from '@/types/ai'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Pencil, Trash2, Check, Cpu } from 'lucide-react'

interface FormState {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: string
}

const EMPTY_FORM: FormState = {
  name: '',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: '0.2',
}

export function AISettingsPanel() {
  const { t } = useTranslation()
  const aiModels = useAppStore((s) => s.aiModels)
  const selectedAIModelId = useAppStore((s) => s.selectedAIModelId)
  const addAIModel = useAppStore((s) => s.addAIModel)
  const updateAIModel = useAppStore((s) => s.updateAIModel)
  const removeAIModel = useAppStore((s) => s.removeAIModel)
  const setSelectedAIModelId = useAppStore((s) => s.setSelectedAIModelId)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const openAdd = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (m: AIModelConfig) => {
    setEditingId(m.id)
    setForm({
      name: m.name,
      baseUrl: m.baseUrl,
      apiKey: m.apiKey,
      model: m.model,
      temperature: m.temperature !== undefined ? String(m.temperature) : '',
    })
    setDialogOpen(true)
  }

  const handleSave = () => {
    if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()) return
    const payload = {
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      model: form.model.trim(),
      temperature: form.temperature.trim() ? Number(form.temperature) : undefined,
    }
    if (editingId) {
      updateAIModel(editingId, payload)
    } else {
      addAIModel(payload)
    }
    setDialogOpen(false)
  }

  return (
    <div className="flex flex-col h-full space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-aimu-purple" />
          <span className="text-sm font-medium">{t('components.aiSettings.title')}</span>
        </div>
        <Button size="sm" onClick={openAdd} className="h-8">
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('components.aiSettings.addModel')}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{t('components.aiSettings.description')}</p>

      {aiModels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Cpu className="h-8 w-8 text-muted-foreground/40 mb-2" />
          <p className="text-xs text-muted-foreground">{t('components.aiSettings.emptyTip')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {aiModels.map((m) => {
            const isSelected = m.id === selectedAIModelId
            return (
              <div
                key={m.id}
                className={cn(
                  'flex items-center justify-between rounded-md border p-3 cursor-pointer transition-colors',
                  isSelected
                    ? 'border-aimu-purple bg-aimu-purple/5'
                    : 'border-border hover:bg-muted/40',
                )}
                onClick={() => setSelectedAIModelId(m.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {isSelected && <Check className="h-3.5 w-3.5 text-aimu-purple shrink-0" />}
                    <span className="text-sm font-medium truncate">{m.name}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {m.model} · {m.baseUrl}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => openEdit(m)}
                    className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
                    title={t('components.aiSettings.editModel')}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => removeAIModel(m.id)}
                    className="p-1.5 text-muted-foreground hover:text-aimu-coral rounded transition-colors"
                    title={t('components.aiSettings.delete')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground mt-2">{t('components.aiSettings.apiKeyHint')}</p>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? t('components.aiSettings.editModel') : t('components.aiSettings.addModel')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>{t('components.aiSettings.name')}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="My GPT-4o"
              />
            </div>
            <div className="space-y-1">
              <Label>{t('components.aiSettings.baseUrl')}</Label>
              <Input
                value={form.baseUrl}
                onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div className="space-y-1">
              <Label>{t('components.aiSettings.model')}</Label>
              <Input
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                placeholder="gpt-4o-mini"
              />
            </div>
            <div className="space-y-1">
              <Label>{t('components.aiSettings.apiKey')}</Label>
              <Input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                placeholder="sk-..."
              />
            </div>
            <div className="space-y-1">
              <Label>{t('components.aiSettings.temperature')}</Label>
              <Input
                value={form.temperature}
                onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))}
                placeholder="0.2"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('components.aiSettings.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()}>
              {t('components.aiSettings.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}