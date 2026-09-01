/** Canonical LOQUIRA model catalog — mirrors desktop app allowlist (loquiraModelAllowlist.js). */
export const LOQUIRA_CATALOG_VERSION = '2026-03-01';

export const LOQUIRA_PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter', description: 'Google Gemini & OpenAI GPT models' },
  { id: 'deepseek', name: 'DeepSeek', description: 'DeepSeek V4 models' },
];

/** Picker order and metadata aligned with extensions/forge-ai/runtime/server/modelRegistry.js */
export const LOQUIRA_MODEL_CATALOG = [
  {
    id: 'forge-auto',
    name: 'Auto by LOQUIRA',
    detail: 'Auto — picks the best model for the task',
    group: 'Auto',
    provider: 'forge',
    providerLabel: 'LOQUIRA',
    supportsVision: true,
    supportsTools: true,
    supportsReasoning: true,
    pickerOrder: 0,
  },
  {
    id: 'google/gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    detail: 'Economical — simple tasks',
    group: 'Google',
    provider: 'openrouter',
    providerLabel: 'OpenRouter',
    supportsVision: true,
    supportsTools: true,
    supportsReasoning: false,
    pickerOrder: 1,
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    detail: 'Balanced — coding & features',
    group: 'Google',
    provider: 'openrouter',
    providerLabel: 'OpenRouter',
    supportsVision: true,
    supportsTools: true,
    supportsReasoning: false,
    pickerOrder: 2,
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    detail: 'Powerful — complex tasks & reasoning',
    group: 'Google',
    provider: 'openrouter',
    providerLabel: 'OpenRouter',
    supportsVision: true,
    supportsTools: true,
    supportsReasoning: true,
    pickerOrder: 3,
  },
  {
    id: 'openai/gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    detail: 'Balanced — Vision · Tools · Reasoning',
    group: 'OpenAI',
    provider: 'openrouter',
    providerLabel: 'OpenRouter',
    supportsVision: true,
    supportsTools: true,
    supportsReasoning: true,
    pickerOrder: 4,
  },
  {
    id: 'openai/gpt-5.4',
    name: 'GPT-5.4',
    detail: 'High — Vision · Tools · Reasoning',
    group: 'OpenAI',
    provider: 'openrouter',
    providerLabel: 'OpenRouter',
    supportsVision: true,
    supportsTools: true,
    supportsReasoning: true,
    pickerOrder: 5,
  },
  {
    id: 'openai/gpt-5.4-pro',
    name: 'GPT-5.4 Pro',
    detail: 'Premium — Vision · Tools · Reasoning',
    group: 'OpenAI',
    provider: 'openrouter',
    providerLabel: 'OpenRouter',
    supportsVision: true,
    supportsTools: true,
    supportsReasoning: true,
    pickerOrder: 6,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    detail: 'Agent & coding — default',
    group: 'DeepSeek',
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    supportsVision: false,
    supportsTools: true,
    supportsReasoning: false,
    pickerOrder: 7,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    detail: 'Complex coding tasks',
    group: 'DeepSeek',
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    supportsVision: false,
    supportsTools: true,
    supportsReasoning: false,
    pickerOrder: 8,
  },
  {
    id: 'deepseek-v4-flash-vision-exp',
    name: 'DeepSeek V4 Flash Vision',
    detail: 'Vision — image analysis via DeepSeek API',
    group: 'DeepSeek',
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    supportsVision: true,
    supportsTools: true,
    supportsReasoning: false,
    pickerOrder: 9,
  },
];

export const LOQUIRA_MODEL_GROUPS = ['Auto', 'Google', 'OpenAI', 'DeepSeek'];

export function encodeModelDocId(modelId) {
  return String(modelId).replace(/\//g, '__');
}

export function decodeModelDocId(docId) {
  return String(docId).replace(/__/g, '/');
}

export function getCapabilityLabels(model) {
  const caps = [];
  if (model.supportsTools) caps.push('Tools');
  if (model.supportsVision) caps.push('Vision');
  if (model.supportsReasoning) caps.push('Reasoning');
  return caps;
}

function isProviderConnected(settings, providerId) {
  const entry = settings?.[providerId];
  return entry?.status === 'connected';
}

/** Availability rules mirror LOQUIRA runtime provider resolution. */
export function computeModelAvailability(model, providerSettings) {
  if (model.id === 'forge-auto') {
    return isProviderConnected(providerSettings, 'openrouter') || isProviderConnected(providerSettings, 'deepseek');
  }
  if (model.provider === 'openrouter') {
    return isProviderConnected(providerSettings, 'openrouter');
  }
  if (model.provider === 'deepseek') {
    return isProviderConnected(providerSettings, 'deepseek');
  }
  return false;
}

export function enrichCatalogWithAvailability(providerSettings) {
  return LOQUIRA_MODEL_CATALOG.map(function (model) {
    const available = computeModelAvailability(model, providerSettings);
    return {
      ...model,
      capabilities: getCapabilityLabels(model),
      available: available,
      availabilityReason: available
        ? 'Provider connected'
        : model.provider === 'forge'
          ? 'Connect OpenRouter or DeepSeek in Settings'
          : 'Connect ' + model.providerLabel + ' in Settings',
    };
  });
}

export function groupModels(models) {
  const byGroup = new Map();
  LOQUIRA_MODEL_GROUPS.forEach(function (g) {
    byGroup.set(g, []);
  });
  models.forEach(function (m) {
    const list = byGroup.get(m.group);
    if (list) list.push(m);
  });
  return LOQUIRA_MODEL_GROUPS
    .map(function (group) {
      return { group: group, models: byGroup.get(group) || [] };
    })
    .filter(function (entry) {
      return entry.models.length > 0;
    });
}
