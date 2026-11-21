import type { HermesModel } from './hermesClient';
import { tr } from '../i18n/runtime';

export type ModelBrand = 'openai' | 'anthropic' | 'github' | 'google' | 'deepseek' | 'qwen' | 'minimax' | 'xai' | 'openrouter' | 'ollama' | 'mistral' | 'moonshot' | 'zai' | 'nous' | 'custom' | 'unknown';
export interface ModelChoice {
  model: HermesModel;
  title: string;
  source: string;
  groupId: string;
  groupName: string;
  brand: ModelBrand;
}
export interface ModelGroup {
  id: string;
  name: string;
  brand: ModelBrand;
  choices: ModelChoice[];
}

// Group by the service provider encoded by Hermes. A model publisher name
// does not identify its serving endpoint. Keep the exact ACP modelId for selection.
const PROVIDERS: Readonly<Record<string, { group: ModelBrand; name: string; nameEn?: string }>> = {
  'openai-api': { group: 'openai', name: 'OpenAI' },
  'openai-codex': { group: 'openai', name: 'OpenAI' },
  anthropic: { group: 'anthropic', name: 'Anthropic' },
  'claude-code': { group: 'anthropic', name: 'Anthropic' },
  'copilot-acp': { group: 'github', name: 'GitHub Copilot' },
  copilot: { group: 'github', name: 'GitHub Copilot' },
  google: { group: 'google', name: 'Google' },
  gemini: { group: 'google', name: 'Google' },
  deepseek: { group: 'deepseek', name: 'DeepSeek' },
  'qwen-oauth': { group: 'qwen', name: '通义千问', nameEn: 'Qwen' },
  alibaba: { group: 'qwen', name: '通义千问', nameEn: 'Qwen' },
  'alibaba-coding-plan': { group: 'qwen', name: '通义千问', nameEn: 'Qwen' },
  minimax: { group: 'minimax', name: 'MiniMax' },
  'minimax-cn': { group: 'minimax', name: 'MiniMax' },
  'minimax-oauth': { group: 'minimax', name: 'MiniMax' },
  xai: { group: 'xai', name: 'xAI' },
  'xai-oauth': { group: 'xai', name: 'xAI' },
  openrouter: { group: 'openrouter', name: 'OpenRouter' },
  ollama: { group: 'ollama', name: 'Ollama' },
  'ollama-cloud': { group: 'ollama', name: 'Ollama' },
  mistral: { group: 'mistral', name: 'Mistral' },
  kimi: { group: 'moonshot', name: 'Kimi · 月之暗面', nameEn: 'Kimi · Moonshot' },
  moonshot: { group: 'moonshot', name: 'Kimi · 月之暗面', nameEn: 'Kimi · Moonshot' },
  'kimi-coding': { group: 'moonshot', name: 'Kimi · 月之暗面', nameEn: 'Kimi · Moonshot' },
  'kimi-coding-cn': { group: 'moonshot', name: 'Kimi · 月之暗面', nameEn: 'Kimi · Moonshot' },
  zai: { group: 'zai', name: '智谱', nameEn: 'Zhipu AI' },
  glm: { group: 'zai', name: '智谱', nameEn: 'Zhipu AI' },
  nous: { group: 'nous', name: 'Nous Research' },
};

export function presentHermesModel(model: HermesModel): ModelChoice {
  // Hermes acp_adapter/model_catalog.py emits `Provider: <label> • ...`
  // and, for inventory rows, `<label> · <model>`. Strip only that exact
  // display prefix; never split model IDs into a guessed custom endpoint.
  const providerLabel = /^Provider: (.+?)(?: • |$)/.exec(model.description ?? '')?.[1];
  const separator = model.modelId.indexOf(':');
  const providerId = separator > 0 ? model.modelId.slice(0, separator) : null;
  const known = providerId !== null && Object.prototype.hasOwnProperty.call(PROVIDERS, providerId) ? PROVIDERS[providerId] : undefined;
  const isCustom = providerId === 'custom';
  const source = providerLabel ?? (providerId === null ? tr('Hermes 未提供服务来源', 'Provider not specified by Hermes') : providerId);
  const prefix = providerLabel === undefined ? null : `${providerLabel} · `;
  const title = prefix && model.name.startsWith(prefix) ? model.name.slice(prefix.length) : model.name;
  return {
    model, title, source,
    groupId: known ? known.group : isCustom ? 'custom' : providerId === null ? 'unknown' : `other:${providerId}`,
    groupName: known ? tr(known.name, known.nameEn ?? known.name) : isCustom ? tr('自定义服务', 'Custom Provider') : providerLabel ?? tr('其他来源', 'Other Providers'),
    brand: known ? known.group : isCustom ? 'custom' : 'unknown',
  };
}

export function groupHermesModels(models: HermesModel[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const model of models) {
    const choice = presentHermesModel(model);
    const group = groups.get(choice.groupId);
    if (group) group.choices.push(choice);
    else groups.set(choice.groupId, { id: choice.groupId, name: choice.groupName, brand: choice.brand, choices: [choice] });
  }
  // Preserve Hermes's catalogue order inside each group and each exact ID.
  return [...groups.values()];
}

export function filterModelGroups(groups: ModelGroup[], groupId: string | null, query: string): ModelGroup[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return groups.filter(group => groupId === null || group.id === groupId).map(group => ({
    ...group,
    choices: group.choices.filter(choice => {
      const text = `${group.name} ${choice.title} ${choice.source} ${choice.model.modelId}`.toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    }),
  })).filter(group => group.choices.length > 0);
}
