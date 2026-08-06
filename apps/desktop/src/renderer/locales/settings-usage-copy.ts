import type { UiCatalog, UiLocale } from '@maka/core';

export type UsageSettingsCopy = {
  saveFailed: string; toolbarAria: string; rangeAria: string; ranges: readonly [string, string, string, string];
  refreshingAria: string; refreshAria: string; summaryAria: string; totalRequests: string; totalCost: string; costHelp: string;
  totalTokens: string; tokenDetail(input: number, output: number): string; cacheTokens: string; cacheDetail(miss: number, read: number, creation: number): string;
  viewAria: string; tabs: readonly [string, string, string, string, string]; filtersAria: string; filterPlaceholder: string; filterAria: string;
  statusAria: string; statuses: readonly [string, string, string]; details: string; detailsAria: string; recordCount(count: number): string; clearFilters: string;
  summaryOnly: string; showDetails: string; filteredEmpty: string; requestEmpty: string;
  tables: {
    providersAria: string; modelsAria: string; toolsAria: string; pricingAria: string; requestsAria: string;
    providerHeaders: string[]; modelHeaders: string[]; toolHeaders: string[]; pricingHeaders: string[]; requestHeaders: string[];
    noPricing: string; modelKind: string; toolKind: string; openSession(label: string): string; success: string; error: string;
    providerEmptyTitle: string; providerEmptyBody: string; modelEmptyTitle: string; modelEmptyBody: string;
    toolEmptyTitle: string; toolEmptyBody: string; pricingEmptyBody: string;
    // Pricing editor (pricing.query / pricing.mutate narrow surface)
    pricingRefreshAria: string; pricingLoadFailed: string; pricingSaveFailed: string; pricingDeleteFailed: string;
    pricingConflict: string; pricingRateInvalid: string; pricingModelKeyLabel: string; pricingModelKeyPlaceholder: string;
    pricingInputLabel: string; pricingInputShort: string; pricingInputPlaceholder: string;
    pricingOutputLabel: string; pricingOutputShort: string; pricingOutputPlaceholder: string;
    pricingCacheReadLabel: string; pricingCacheReadShort: string; pricingCacheReadPlaceholder: string;
    pricingCacheWriteLabel: string; pricingCacheWriteShort: string; pricingCacheWritePlaceholder: string;
    pricingSourceBuiltin: string; pricingSourceCustom: string;
    pricingResetEffectRestore: string; pricingResetEffectUnpriced: string;
    pricingResetButton: string; pricingResetConfirm: string; pricingResetSuccess: string;
    pricingAddButton: string; pricingAddRow: string; pricingCancelButton: string;
    pricingClickToSet: string; pricingRefreshButton: string; pricingModelKeyRequired: string;
    // Display scope toggle:
    //  - "已启用": models from currently-enabled connections that the user
    //    has marked usable (whether or not they have a configured price).
    //  - "全部": the union of every connection's full catalog (incl. disabled
    //    connections and unenabled models), built-in-priced models, and saved
    //    custom-priced models (including orphans whose connection was removed).
    pricingScopeAria: string; pricingScopeEnabled: string;
    pricingScopeAll: string; pricingScopeAllHelp: string;
  };
};

const SETTINGS_USAGE_COPY = {
  zh: {
    saveFailed: '保存使用统计设置失败', toolbarAria: '使用统计范围与刷新', rangeAria: '使用统计时间范围', ranges: ['24h', '7天', '30天', '全部'],
    refreshingAria: '正在刷新使用统计', refreshAria: '刷新使用统计', summaryAria: '使用统计汇总指标', totalRequests: '总请求', totalCost: '总费用', costHelp: '以模型供应商最终结算为准',
    totalTokens: '总 Token', tokenDetail: (input, output) => `输入 ${input} / 输出 ${output}`, cacheTokens: '缓存 Token',
    cacheDetail: (miss, read, creation) => `新 ${miss} / 命中 ${read} / 创建 ${creation}`, viewAria: '使用统计视图', tabs: ['请求日志', '供应商统计', '模型统计', '工具统计', '定价配置'],
    filtersAria: '请求记录筛选', filterPlaceholder: '按模型或工具筛选…', filterAria: '按模型或工具筛选请求记录', statusAria: '请求状态筛选',
    statuses: ['全部状态', '成功', '错误'], details: '详情记录', detailsAria: '显示使用统计详情记录', recordCount: (count) => `共 ${count} 条记录`, clearFilters: '清除筛选',
    summaryOnly: '当前仅显示汇总指标。打开详情记录后，可以查看逐条模型请求和工具调用，按模型、工具或状态筛选，并用于排查费用与失败请求。',
    showDetails: '显示明细', filteredEmpty: '没有符合筛选条件的请求记录', requestEmpty: '暂无请求记录',
    tables: {
      providersAria: '使用统计供应商统计表', modelsAria: '使用统计模型统计表', toolsAria: '使用统计工具统计表', pricingAria: '使用统计定价配置表', requestsAria: '使用统计请求日志表',
      providerHeaders: ['供应商', '请求', 'Token', '费用'], modelHeaders: ['模型', '请求', 'Token', '费用'], toolHeaders: ['工具', '调用', '成功', '错误', '平均耗时'],
      pricingHeaders: ['供应商', '模型', '输入 / 1M', '输出 / 1M'], requestHeaders: ['时间', '类型', '对象', '会话', 'Token', '费用', '延迟', '状态'],
      noPricing: '暂无定价覆盖配置', modelKind: '模型', toolKind: '工具', openSession: (label) => `打开 ${label}`, success: '成功', error: '错误',
      providerEmptyTitle: '暂无供应商用量', providerEmptyBody: '完成一次模型请求后，这里会按供应商聚合请求数、Token 与费用。',
      modelEmptyTitle: '暂无模型用量', modelEmptyBody: '完成一次模型请求后，这里会按模型聚合请求数、Token 与费用。',
      toolEmptyTitle: '暂无工具调用', toolEmptyBody: '智能体调用工具后，这里会按工具聚合调用次数、成功、错误与平均耗时。',
      pricingEmptyBody: '未配置定价覆盖时，费用按内置模型定价表结算；在此可为特定模型登记自定义价格。',
      pricingRefreshAria: '刷新定价配置', pricingLoadFailed: '加载定价配置失败', pricingSaveFailed: '保存定价失败', pricingDeleteFailed: '删除定价失败',
      pricingConflict: '定价已被改动，已自动刷新，请重试', pricingRateInvalid: '价格必须为非负数字', pricingModelKeyLabel: '模型标识', pricingModelKeyPlaceholder: '如 openai:gpt-4o',
      pricingInputLabel: '输入 / 1M (USD)', pricingInputShort: '输入', pricingInputPlaceholder: '如 5',
      pricingOutputLabel: '输出 / 1M (USD)', pricingOutputShort: '输出', pricingOutputPlaceholder: '如 15',
      pricingCacheReadLabel: '缓存读 / 1M (USD)', pricingCacheReadShort: '缓存读', pricingCacheReadPlaceholder: '可选',
      pricingCacheWriteLabel: '缓存写 / 1M (USD)', pricingCacheWriteShort: '缓存写', pricingCacheWritePlaceholder: '可选',
      pricingSourceBuiltin: '内置', pricingSourceCustom: '自定义',
      pricingResetEffectRestore: '删除后恢复内置价格', pricingResetEffectUnpriced: '删除后变为无价',
      pricingResetButton: '重置', pricingResetConfirm: '确定要删除该模型的自定义价格吗？', pricingResetSuccess: '已重置为内置价格',
      pricingAddButton: '保存', pricingAddRow: '新增定价', pricingCancelButton: '取消',
      pricingClickToSet: '点击设置', pricingRefreshButton: '刷新', pricingModelKeyRequired: '请输入模型标识',
      pricingScopeAria: '显示范围', pricingScopeEnabled: '当前启用', pricingScopeAll: '全部',
      pricingScopeAllHelp: '显示所有连接的全部模型（含已停用连接和未启用模型）。',
    },
  },
  en: {
    saveFailed: 'Failed to save usage settings', toolbarAria: 'Usage range and refresh', rangeAria: 'Usage time range', ranges: ['24h', '7 days', '30 days', 'All'],
    refreshingAria: 'Refreshing usage', refreshAria: 'Refresh usage', summaryAria: 'Usage summary metrics', totalRequests: 'Total requests', totalCost: 'Total cost', costHelp: 'Final billing is determined by the model provider',
    totalTokens: 'Total tokens', tokenDetail: (input, output) => `Input ${input} / output ${output}`, cacheTokens: 'Cache tokens',
    cacheDetail: (miss, read, creation) => `New ${miss} / hit ${read} / created ${creation}`, viewAria: 'Usage view', tabs: ['Request log', 'Providers', 'Models', 'Tools', 'Pricing'],
    filtersAria: 'Request filters', filterPlaceholder: 'Filter by model or tool…', filterAria: 'Filter requests by model or tool', statusAria: 'Filter by request status',
    statuses: ['All statuses', 'Success', 'Error'], details: 'Detailed records', detailsAria: 'Show detailed usage records', recordCount: (count) => `${count} ${count === 1 ? 'record' : 'records'}`, clearFilters: 'Clear filters',
    summaryOnly: 'Only summary metrics are shown. Enable detailed records to inspect individual model requests and tool calls, filter by model, tool, or status, and investigate costs or failures.',
    showDetails: 'Show details', filteredEmpty: 'No requests match these filters', requestEmpty: 'No request records',
    tables: {
      providersAria: 'Usage by provider', modelsAria: 'Usage by model', toolsAria: 'Usage by tool', pricingAria: 'Usage pricing configuration', requestsAria: 'Usage request log',
      providerHeaders: ['Provider', 'Requests', 'Tokens', 'Cost'], modelHeaders: ['Model', 'Requests', 'Tokens', 'Cost'], toolHeaders: ['Tool', 'Calls', 'Success', 'Errors', 'Average duration'],
      pricingHeaders: ['Provider', 'Model', 'Input / 1M', 'Output / 1M'], requestHeaders: ['Time', 'Type', 'Target', 'Session', 'Tokens', 'Cost', 'Latency', 'Status'],
      noPricing: 'No pricing overrides', modelKind: 'Model', toolKind: 'Tool', openSession: (label) => `Open ${label}`, success: 'Success', error: 'Error',
      providerEmptyTitle: 'No provider usage', providerEmptyBody: 'After a model request, provider request counts, tokens, and costs appear here.',
      modelEmptyTitle: 'No model usage', modelEmptyBody: 'After a model request, request counts, tokens, and costs appear here by model.',
      toolEmptyTitle: 'No tool calls', toolEmptyBody: 'After an agent calls a tool, calls, successes, errors, and average duration appear here by tool.',
      pricingEmptyBody: 'Without pricing overrides, costs use the built-in model pricing table. Add custom prices here for specific models.',
      pricingRefreshAria: 'Refresh pricing', pricingLoadFailed: 'Failed to load pricing', pricingSaveFailed: 'Failed to save pricing', pricingDeleteFailed: 'Failed to delete pricing',
      pricingConflict: 'Pricing changed concurrently — refreshed, please retry', pricingRateInvalid: 'Rates must be non-negative numbers', pricingModelKeyLabel: 'Model key', pricingModelKeyPlaceholder: 'e.g. openai:gpt-4o',
      pricingInputLabel: 'Input / 1M (USD)', pricingInputShort: 'In', pricingInputPlaceholder: 'e.g. 5',
      pricingOutputLabel: 'Output / 1M (USD)', pricingOutputShort: 'Out', pricingOutputPlaceholder: 'e.g. 15',
      pricingCacheReadLabel: 'Cache Read / 1M (USD)', pricingCacheReadShort: 'C.Rd', pricingCacheReadPlaceholder: 'optional',
      pricingCacheWriteLabel: 'Cache Write / 1M (USD)', pricingCacheWriteShort: 'C.Wr', pricingCacheWritePlaceholder: 'optional',
      pricingSourceBuiltin: 'builtin', pricingSourceCustom: 'custom',
      pricingResetEffectRestore: 'Resets to the built-in price', pricingResetEffectUnpriced: 'Becomes unpriced',
      pricingResetButton: 'Reset', pricingResetConfirm: 'Delete the custom price for this model?', pricingResetSuccess: 'Reset to built-in price',
      pricingAddButton: 'Save', pricingAddRow: 'Add pricing', pricingCancelButton: 'Cancel',
      pricingClickToSet: 'Click to set', pricingRefreshButton: 'Refresh', pricingModelKeyRequired: 'Model key is required',
      pricingScopeAria: 'Display scope', pricingScopeEnabled: 'Enabled only', pricingScopeAll: 'All',
      pricingScopeAllHelp: "Show every connection's full model catalog (including disabled connections and unenabled models).",
    },
  },
} satisfies UiCatalog<UsageSettingsCopy>;

export function getUsageSettingsCopy(locale: UiLocale): UsageSettingsCopy {
  return SETTINGS_USAGE_COPY[locale];
}
