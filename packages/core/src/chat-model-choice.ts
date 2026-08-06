import { normalizeOpenAiCodexConnection } from './connection-readiness.js';
import { buildConnectionModelCatalogEntries } from './model-catalog.js';
import { lookupModelMetadata } from './model-metadata.js';
import { thinkingVariantsForModel, type ThinkingLevel } from './model-thinking.js';
import {
  CODEX_SUBSCRIPTION_UNSUPPORTED_CHATGPT_MODELS,
  PROVIDER_DEFAULTS,
  connectionEnabledModelIds,
  isWiredOAuthProvider,
  type LlmConnection,
  type ProviderType,
} from './llm-connections.js';

const MODEL_MENU_PROVIDER_LABELS: Partial<Record<ProviderType, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot',
  ollama: 'Ollama',
  'kimi-coding-plan': 'Kimi',
  'zai-coding-plan': 'Z.AI',
  MiniMax: 'MiniMax',
  'openai-codex': 'OpenAI OAuth',
  'gemini-cli': 'Gemini CLI',
};

export interface ChatModelChoice {
  connectionSlug: string;
  providerType: ProviderType;
  providerLabel: string;
  model: string;
  label: string;
  connectionName?: string;
  isDefault: boolean;
  thinkingLevels: readonly ThinkingLevel[];
  /** Short description from models.dev, lets the picker distinguish same-family models (#2329). */
  description?: string;
  /** Knowledge cutoff date (ISO), surfaced so users see how stale a model is (#2329). */
  knowledgeCutoff?: string;
  /** When models.dev last updated this model's facts (ISO), for freshness hints (#2329). */
  lastUpdated?: string;
}

export function buildChatModelChoices(connections: readonly LlmConnection[]): ChatModelChoice[] {
  const choices: ChatModelChoice[] = [];
  for (const rawConnection of connections) {
    const connection = normalizeOpenAiCodexConnection(rawConnection);
    const provider = PROVIDER_DEFAULTS[connection.providerType];
    if (
      !connection.enabled ||
      !provider ||
      provider.backendKind !== 'ai-sdk' ||
      (provider.authKind === 'oauth_token' && !isWiredOAuthProvider(connection.providerType))
    ) {
      continue;
    }
    const enabledModelIds = new Set(connectionEnabledModelIds(connection));
    for (const entry of buildConnectionModelCatalogEntries({ connection })) {
      if (
        !entry.canUseAsChatDefault ||
        !enabledModelIds.has(entry.id) ||
        (connection.providerType === 'openai-codex' &&
          CODEX_SUBSCRIPTION_UNSUPPORTED_CHATGPT_MODELS.has(entry.id.trim()))
      ) {
        continue;
      }
      choices.push({
        connectionSlug: connection.slug,
        providerType: connection.providerType,
        providerLabel: MODEL_MENU_PROVIDER_LABELS[connection.providerType] ?? provider.label,
        model: entry.id,
        label: entry.displayName?.trim() || entry.id,
        ...(provider.authKind === 'oauth_token' ? {} : { connectionName: connection.name }),
        isDefault: entry.isDefault,
        thinkingLevels: thinkingVariantsForModel(connection.providerType, entry.id),
        // Surface models.dev facts so the picker can show description +
        // knowledge cutoff + freshness (#2329). Provider-discovered models
        // (not in the generated snapshot) simply omit them.
        ...((): { description?: string; knowledgeCutoff?: string; lastUpdated?: string } => {
          const meta = lookupModelMetadata(connection.providerType, entry.id);
          return {
            ...(meta.description ? { description: meta.description } : {}),
            ...(meta.knowledgeCutoff ? { knowledgeCutoff: meta.knowledgeCutoff } : {}),
            ...(meta.lastUpdated ? { lastUpdated: meta.lastUpdated } : {}),
          };
        })(),
      });
    }
  }
  return choices;
}
