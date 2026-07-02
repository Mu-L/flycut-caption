// Web (Transformers) 模型下拉选项组件
// 按 family 分组渲染 Web 模型清单，供 ASRSettingsPanel / 其他位置共用。
// 与 ModelSelectItems 区分：数据源为 WEB_ASR_MODELS，不需要"已下载"过滤。

import { SelectGroup, SelectItem, SelectLabel } from '@/components/ui/select';
import { WEB_ASR_MODELS, WEB_MODEL_FAMILY_LABELS } from '@/config/webAsrModels';

/**
 * 给定当前已就绪的 Web 模型 id 集合（空集表示不过滤），
 * 渲染所有/已就绪的 Web 模型。
 */
interface WebModelSelectItemsProps {
  /** 仅显示已就绪的模型；默认全部展示 */
  readyModelIds?: Set<string>;
}

export function WebModelSelectItems({ readyModelIds }: WebModelSelectItemsProps) {
  const families = Object.keys(WEB_MODEL_FAMILY_LABELS);

  return (
    <>
      {families.map((family) => {
        const models = WEB_ASR_MODELS.filter((m) => m.family === family);
        if (models.length === 0) return null;

        const visible = readyModelIds
          ? models.filter((m) => readyModelIds.has(m.id))
          : models;
        if (visible.length === 0) return null;

        return (
          <SelectGroup key={family}>
            <SelectLabel>{WEB_MODEL_FAMILY_LABELS[family]}</SelectLabel>
            {visible.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="flex items-center gap-1.5">
                  <span>{m.name}</span>
                  {m.recommended && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">
                      推荐
                    </span>
                  )}
                  {m.family === 'moonshine' && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                      EN
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        );
      })}
    </>
  );
}