import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Card,
  EmptyState,
  SegmentedControl,
  SegmentedControlItem,
  Tab,
  TabList,
  Table,
  type TableColumn,
  type TablePlugin,
  pixel,
  proportional,
} from '@astryxdesign/core';
import {
  uiLocaleToIntlLocale,
  type AppSettings,
  type UpdateAppSettingsResult,
  type UsageRange,
  type UsageStats,
  type PricingConfig,
} from '@maka/core';
import {
  Button,
  IconButton,
  TextInput,
  Selector,
  Switch,
  useToast,
  useUiLocale,
  Banner,
} from '@maka/ui';
import { Activity, BarChart3, Cpu, Database, RefreshCcw, Search } from '@maka/ui/icons';
import {
  getUsageSettingsCopy,
  type UsageSettingsCopy,
} from '../locales/settings-usage-copy';
import { MetricCard } from './settings-metric-card';
import { settingsActionErrorMessage } from './settings-error-copy';
import { SettingsPage } from './settings-section';
import { useActionGuard } from './use-action-guard';
import { useOptimisticSettingsDraft } from './use-optimistic-settings-draft';

type UsageActiveTab = AppSettings['usage']['activeTab'];

export function UsageSettingsPage(props: {
  settings: AppSettings;
  stats: UsageStats | null;
  onUpdate(patch: Parameters<typeof window.maka.settings.update>[0]): Promise<UpdateAppSettingsResult>;
  onReload(range?: UsageRange): Promise<void>;
  onOpenSession?(sessionId: string): void;
}) {
  const locale = useUiLocale();
  const copy = getUsageSettingsCopy(locale);
  const persistedUsage = props.settings.usage;
  const [refreshing, setRefreshing] = useState(false);
  const usageRefreshGuard = useActionGuard<'refresh'>();
  const stats = props.stats;
  const [pricingCount, setPricingCount] = useState(0);
  const toast = useToast();
  const {
    draft: usageDraft,
    draftRef: usageDraftRef,
    mountedRef: usagePageMountedRef,
    update,
  } = useOptimisticSettingsDraft<AppSettings['usage']>(
    persistedUsage,
    (patch) => props.onUpdate({ usage: patch }).then((result) => result.settings.usage),
    { onError: (error) => toast.error(copy.saveFailed, settingsActionErrorMessage(error, locale)) },
  );

  const normalizedModelFilter = usageDraft.modelFilter.trim().toLowerCase();
  const hasRequestFilters = usageDraft.status !== 'all' || normalizedModelFilter.length > 0;
  const showRequestDetails = usageDraft.activeTab === 'requests' && usageDraft.showDetails;
  const filteredLogs = useMemo(() => {
    const logs = stats?.logs ?? [];
    return logs
      .filter((log) => usageDraft.status === 'all' || log.status === usageDraft.status)
      .filter((log) =>
        normalizedModelFilter.length === 0 ||
        log.model.toLowerCase().includes(normalizedModelFilter) ||
        (log.toolName ?? '').toLowerCase().includes(normalizedModelFilter)
      );
  }, [stats, usageDraft.status, normalizedModelFilter]);

  const tabCounts: Record<UsageActiveTab, number> = {
    requests: stats?.logs.length ?? 0,
    providers: stats?.byProvider.length ?? 0,
    models: stats?.byModel.length ?? 0,
    tools: stats?.byTool.length ?? 0,
    pricing: 0,
  };

  async function setRange(range: UsageRange) {
    const saved = await updateUsage({ range });
    if (!saved || !usagePageMountedRef.current) return;
    await props.onReload(range);
  }

  function updateUsage(patch: Partial<AppSettings['usage']>): Promise<boolean> {
    return update(patch);
  }

  async function refresh() {
    if (!usageRefreshGuard.begin('refresh')) return;
    setRefreshing(true);
    try {
      await props.onReload(usageDraftRef.current.range);
    } finally {
      usageRefreshGuard.finish();
      if (usagePageMountedRef.current) {
        setRefreshing(false);
      }
    }
  }

  function clearRequestFilters() {
    void updateUsage({ status: 'all', modelFilter: '' });
  }

  return (
    <SettingsPage className="settingsUsagePage">
      <div className="settingsUsageOverview">
        <div className="settingsUsageToolbar" role="group" aria-label={copy.toolbarAria}>
          <SegmentedControl
            value={usageDraft.range}
            label={copy.rangeAria}
            onChange={(value) => void setRange(value as UsageRange)}
          >
            {(['24h', '7d', '30d', 'all'] as const).map((value, index) => (
              <SegmentedControlItem key={value} value={value} label={copy.ranges[index]} />
            ))}
          </SegmentedControl>
          {/* Detail audit: 刷新 was a primary --action chip glued to the
              segmented — two control styles fighting in one row for a
              low-frequency utility. Same quiet icon form as the automations
              page refresh (one action, one shape everywhere); pinned to the
              row's trailing edge so the time cluster reads as a single
              left-aligned group. */}
          <IconButton
            variant="ghost"
            size="sm"
            isDisabled={refreshing}
            aria-busy={refreshing}
            data-pending={refreshing ? 'true' : undefined}
            label={refreshing ? copy.refreshingAria : copy.refreshAria}
            tooltip={refreshing ? copy.refreshingAria : copy.refreshAria}
            onClick={() => void refresh()}
            icon={<RefreshCcw size={15} aria-hidden="true" />}
          />
        </div>

        <div className="settingsUsageSummary" role="group" aria-label={copy.summaryAria}>
          <MetricCard title={copy.totalRequests} value={String(stats?.summary.totalRequests ?? 0)} />
          <MetricCard title={copy.totalCost} value={`$${(stats?.summary.totalCostUsd ?? 0).toFixed(2)}`} detail={copy.costHelp} />
          <MetricCard title={copy.totalTokens} value={String(stats?.summary.totalTokens ?? 0)} detail={copy.tokenDetail(stats?.summary.inputTokens ?? 0, stats?.summary.outputTokens ?? 0)} />
          <MetricCard title={copy.cacheTokens} value={String(stats?.summary.cacheTokens ?? 0)} detail={copy.cacheDetail(stats?.summary.cacheMiss ?? 0, stats?.summary.cacheRead ?? 0, stats?.summary.cacheCreation ?? 0)} />
        </div>
      </div>

      <div className="settingsUsageBreakdown">
        <div className="settingsUsageTabsBar">
          <TabList
            value={usageDraft.activeTab}
            onChange={(activeTab) => void updateUsage({ activeTab: activeTab as UsageActiveTab })}
            hasDivider
            aria-label={copy.viewAria}
          >
            <Tab value="requests" label={copy.tabs[0]} endContent={<span>{tabCounts.requests}</span>} />
            <Tab value="providers" label={copy.tabs[1]} endContent={<span>{tabCounts.providers}</span>} />
            <Tab value="models" label={copy.tabs[2]} endContent={<span>{tabCounts.models}</span>} />
            <Tab value="tools" label={copy.tabs[3]} endContent={<span>{tabCounts.tools}</span>} />
            <Tab value="pricing" label={copy.tabs[4]} endContent={<span>{tabCounts.pricing}</span>} />
          </TabList>
        </div>

        {usageDraft.activeTab === 'requests' ? (
          <div className="settingsUsageTabPanel">
            <UsageRequestsPanel
            stats={stats}
            logs={showRequestDetails ? filteredLogs : []}
            showDetails={usageDraft.showDetails}
            modelFilter={usageDraft.modelFilter}
            status={usageDraft.status}
            recordCount={filteredLogs.length}
            hasRequestFilters={hasRequestFilters}
            requestEmpty={hasRequestFilters ? copy.filteredEmpty : copy.requestEmpty}
            copy={copy}
            locale={locale}
            onOpenSession={props.onOpenSession}
            onEnableDetails={() => void updateUsage({ showDetails: true })}
            onModelFilterChange={(modelFilter) => void updateUsage({ modelFilter })}
            onStatusChange={(status) => void updateUsage({ status })}
            onToggleDetails={(showDetails) => void updateUsage({ showDetails })}
            onClearFilters={clearRequestFilters}
            />
          </div>
        ) : null}

        {usageDraft.activeTab === 'providers' ? (
          <div className="settingsUsageTabPanel">
            <UsageProvidersPanel stats={stats} copy={copy} />
          </div>
        ) : null}

        {usageDraft.activeTab === 'models' ? (
          <div className="settingsUsageTabPanel">
            <UsageModelsPanel stats={stats} copy={copy} />
          </div>
        ) : null}

        {usageDraft.activeTab === 'tools' ? (
          <div className="settingsUsageTabPanel">
            <UsageToolsPanel stats={stats} copy={copy} />
          </div>
        ) : null}

        {usageDraft.activeTab === 'pricing' ? (
          <div className="settingsUsageTabPanel">
            <UsagePricingPanel stats={stats} copy={copy} onCountChange={setPricingCount} />
          </div>
        ) : null}
      </div>
    </SettingsPage>
  );
}

// ── Per-tab panels ─────────────────────────────────────────────────────────
// Each tab owns its own component so the panel structure (filters, tables,
// empty states) reads top-to-bottom instead of hiding inside one switch.
// They all funnel their rows through the shared UsageStatsTable so every tab
// inherits the same hairline / column-rhythm / tabular-nums recipe.

function UsageRequestsPanel(props: {
  stats: UsageStats | null;
  logs: UsageStats['logs'];
  showDetails: boolean;
  modelFilter: string;
  status: AppSettings['usage']['status'];
  recordCount: number;
  hasRequestFilters: boolean;
  requestEmpty: string;
  copy: UsageSettingsCopy;
  locale: ReturnType<typeof useUiLocale>;
  onOpenSession?(sessionId: string): void;
  onEnableDetails(): void;
  onModelFilterChange(value: string): void;
  onStatusChange(status: AppSettings['usage']['status']): void;
  onToggleDetails(showDetails: boolean): void;
  onClearFilters(): void;
}) {
  if (!props.showDetails) {
    return (
      <Banner
        status="info"
        title={props.copy.summaryOnly}
        endContent={<Button variant="secondary" size="sm" onClick={props.onEnableDetails} label={props.copy.showDetails} />} />
    );
  }
  return (
    <>
      <div className="settingsUsageFilters" role="group" aria-label={props.copy.filtersAria}>
        <div className="settingsUsageModelFilter">
          <TextInput
            value={props.modelFilter}
            onChange={(value) => props.onModelFilterChange(value)}
            placeholder={props.copy.filterPlaceholder}
            label={props.copy.filterAria}
            isLabelHidden
            width="100%"
          />
        </div>
        <Selector
          value={props.status}
          label={props.copy.statusAria}
          isLabelHidden
          options={[
            { value: 'all', label: props.copy.statuses[0] },
            { value: 'success', label: props.copy.statuses[1] },
            { value: 'error', label: props.copy.statuses[2] },
          ]}
          width={320}
          onChange={(value) => props.onStatusChange(value as AppSettings['usage']['status'])}
        />
        <div className="settingsUsageDetailToggle">
          <span>{props.copy.details}</span>
          <Switch
            label={props.copy.detailsAria}
            isLabelHidden
            value={props.showDetails}
            onChange={props.onToggleDetails}
          />
        </div>
        <small className="settingsUsageRecordCount">{props.copy.recordCount(props.recordCount)}</small>
        <Button
          className="settingsUsageClearFilter"
          variant="ghost"
          size="sm"
          isDisabled={!props.hasRequestFilters}
          aria-hidden={!props.hasRequestFilters ? 'true' : undefined}
          tabIndex={!props.hasRequestFilters ? -1 : undefined}
          onClick={props.hasRequestFilters ? props.onClearFilters : undefined}
          label={props.copy.clearFilters}
        />
      </div>
      <UsageStatsTable
        ariaLabel={props.copy.tables.requestsAria}
        columns={[
          { header: props.copy.tables.requestHeaders[0] },
          { header: props.copy.tables.requestHeaders[1] },
          { header: props.copy.tables.requestHeaders[2], grow: true },
          { header: props.copy.tables.requestHeaders[3] },
          { header: props.copy.tables.requestHeaders[4], numeric: true },
          { header: props.copy.tables.requestHeaders[5], numeric: true },
          { header: props.copy.tables.requestHeaders[6], numeric: true },
          { header: props.copy.tables.requestHeaders[7] },
        ]}
        rows={props.logs.map((row) => [
          new Date(row.ts).toLocaleString(uiLocaleToIntlLocale(props.locale)),
          usageRequestKindLabel(row.kind, props.copy),
          usageRequestTarget(row),
          usageRequestSessionCell(row, props.copy, props.onOpenSession),
          row.inputTokens + row.outputTokens,
          row.kind === 'model' ? `$${(row.costUsd ?? 0).toFixed(2)}` : '-',
          row.latencyMs ? `${row.latencyMs}ms` : '-',
          usageRequestStatusLabel(row.status, props.copy),
        ])}
        empty={{ Icon: props.hasRequestFilters ? Search : Activity, title: props.requestEmpty }}
      />
    </>
  );
}

function UsageProvidersPanel(props: { stats: UsageStats | null; copy: UsageSettingsCopy }) {
  return (
    <UsageStatsTable
      ariaLabel={props.copy.tables.providersAria}
      columns={[
        { header: props.copy.tables.providerHeaders[0], grow: true },
        { header: props.copy.tables.providerHeaders[1], numeric: true },
        { header: props.copy.tables.providerHeaders[2], numeric: true },
        { header: props.copy.tables.providerHeaders[3], numeric: true },
      ]}
      rows={(props.stats?.byProvider ?? []).map((row) => [row.provider, row.requests, row.tokens, `$${row.costUsd.toFixed(2)}`])}
      empty={{ Icon: Database, title: props.copy.tables.providerEmptyTitle, body: props.copy.tables.providerEmptyBody }}
    />
  );
}

function UsageModelsPanel(props: { stats: UsageStats | null; copy: UsageSettingsCopy }) {
  return (
    <UsageStatsTable
      ariaLabel={props.copy.tables.modelsAria}
      columns={[
        { header: props.copy.tables.modelHeaders[0], grow: true },
        { header: props.copy.tables.modelHeaders[1], numeric: true },
        { header: props.copy.tables.modelHeaders[2], numeric: true },
        { header: props.copy.tables.modelHeaders[3], numeric: true },
      ]}
      rows={(props.stats?.byModel ?? []).map((row) => [row.model, row.requests, row.tokens, `$${row.costUsd.toFixed(2)}`])}
      empty={{ Icon: Cpu, title: props.copy.tables.modelEmptyTitle, body: props.copy.tables.modelEmptyBody }}
    />
  );
}

function UsageToolsPanel(props: { stats: UsageStats | null; copy: UsageSettingsCopy }) {
  return (
    <UsageStatsTable
      ariaLabel={props.copy.tables.toolsAria}
      columns={[
        { header: props.copy.tables.toolHeaders[0], grow: true },
        { header: props.copy.tables.toolHeaders[1], numeric: true },
        { header: props.copy.tables.toolHeaders[2], numeric: true },
        { header: props.copy.tables.toolHeaders[3], numeric: true },
        { header: props.copy.tables.toolHeaders[4], numeric: true },
      ]}
      rows={(props.stats?.byTool ?? []).map((row) => [row.tool, row.calls, row.success, row.errors, `${row.avgDurationMs}ms`])}
      empty={{ Icon: Activity, title: props.copy.tables.toolEmptyTitle, body: props.copy.tables.toolEmptyBody }}
    />
  );
}

function UsagePricingPanel(props: { stats: UsageStats | null; copy: UsageSettingsCopy; onCountChange?: (count: number) => void }) {
  const toast = useToast();
  const [overrides, setOverrides] = useState<PricingConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editingInput, setEditingInput] = useState('');
  const [editingOutput, setEditingOutput] = useState('');
  const [editingCacheRead, setEditingCacheRead] = useState('');
  const [editingCacheWrite, setEditingCacheWrite] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [newModelKey, setNewModelKey] = useState('');
  const [newInput, setNewInput] = useState('');
  const [newOutput, setNewOutput] = useState('');
  const [newCacheRead, setNewCacheRead] = useState('');
  const [newCacheWrite, setNewCacheWrite] = useState('');
  const [saving, setSaving] = useState(false);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const result = await window.maka.usage.listPricingOverrides();
      setOverrides(Array.isArray(result) ? result : []);
      if (props.onCountChange) props.onCountChange(Array.isArray(result) ? result.length : 0);
      console.log("[pricing] loaded overrides:", result);
    } catch (error) {
      toast.error(props.copy.tables.pricingLoadFailed, String(error));
      console.error("[pricing] load failed:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPricing();
    const unsubscribe = window.maka.usage.subscribePricingChanged(() => void loadPricing());
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(modelKey: string, inputUsdPer1M: number, outputUsdPer1M: number, cacheReadUsdPer1M?: number, cacheWriteUsdPer1M?: number) {
    setSaving(true);
    try {
      await window.maka.usage.putPricingOverride({ modelKey, inputUsdPer1M, outputUsdPer1M, ...(cacheReadUsdPer1M !== undefined ? { cacheReadUsdPer1M } : {}), ...(cacheWriteUsdPer1M !== undefined ? { cacheWriteUsdPer1M } : {}) });
      toast.success(props.copy.tables.pricingAddSuccess);
      setEditingKey('');
      await loadPricing();
    } catch (error) {
      toast.error(props.copy.tables.pricingAddFailed, String(error));
      console.error("[pricing] save failed:", error);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset(modelKey: string) {
    try {
      await window.maka.usage.resetPricingOverride(modelKey);
      toast.success(props.copy.tables.pricingResetSuccess);
      await loadPricing();
    } catch (error) {
      toast.error(props.copy.tables.pricingResetFailed, String(error));
    }
  }

  function handleEdit(modelKey: string, input: number, output: number, cacheRead?: number, cacheWrite?: number) {
    setEditingKey(modelKey);
    setEditingInput(String(input));
    setEditingOutput(String(output));
    setEditingCacheRead(cacheRead !== undefined ? String(cacheRead) : '');
    setEditingCacheWrite(cacheWrite !== undefined ? String(cacheWrite) : '');
  }

  function handleSaveEdit() {
    const key = editingKey.trim();
    const input = Number(editingInput);
    const output = Number(editingOutput);
    if (!key || !Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
      toast.error(props.copy.tables.pricingValidationFailed, props.copy.tables.pricingRateInvalid);
      return;
    }
    const cacheRead = editingCacheRead.trim() !== '' ? Number(editingCacheRead) : undefined;
    const cacheWrite = editingCacheWrite.trim() !== '' ? Number(editingCacheWrite) : undefined;
    void handleSave(key, input, output, cacheRead, cacheWrite);
  }

  function handleAddNew() {
    setAddingNew(true);
    setNewModelKey('');
    setNewInput('');
    setNewOutput('');
    setNewCacheRead('');
    setNewCacheWrite('');
  }

  function handleSaveNew() {
    const key = newModelKey.trim();
    const input = Number(newInput);
    const output = Number(newOutput);
    if (!key) {
      toast.error(props.copy.tables.pricingValidationFailed, props.copy.tables.pricingModelKeyRequired);
      return;
    }
    if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
      toast.error(props.copy.tables.pricingValidationFailed, props.copy.tables.pricingRateInvalid);
      return;
    }
    const cacheRead = newCacheRead.trim() !== '' ? Number(newCacheRead) : undefined;
    const cacheWrite = newCacheWrite.trim() !== '' ? Number(newCacheWrite) : undefined;
    void handleSave(key, input, output, cacheRead, cacheWrite).then(() => {
      setAddingNew(false);
      setNewModelKey('');
      setNewInput('');
      setNewOutput('');
    });
  }

  return (
    <div>
      {overrides.length > 0 || addingNew ? (
        <Card className="settingsUsageTable" padding={3}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border-1)' }}>
                  {props.copy.tables.pricingModelKeyLabel}
                </th>
                <th style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '1px solid var(--border-1)' }}>
                  {props.copy.tables.pricingInputLabel}
                </th>
                <th style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '1px solid var(--border-1)' }}>
                  {props.copy.tables.pricingOutputLabel}
                </th>
                <th style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '1px solid var(--border-1)' }}>
                  {props.copy.tables.pricingCacheReadLabel}
                </th>
                <th style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '1px solid var(--border-1)' }}>
                  {props.copy.tables.pricingCacheWriteLabel}
                </th>
                <th style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border-1)' }}>
                  {props.copy.tables.pricingResetButton}
                </th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((row) => (
                <tr key={row.modelKey}>
                  <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-1)' }}>
                    {row.modelKey}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid var(--border-1)' }}>
                    {editingKey === row.modelKey ? (
                      <TextInput
                        value={editingInput}
                        onChange={setEditingInput}
                        width={100}
                      />
                    ) : (
                      <span
                        onClick={() => handleEdit(row.modelKey, row.inputUsdPer1M, row.outputUsdPer1M)}
                        style={{ cursor: 'pointer' }}
                      >
                        {row.inputUsdPer1M}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid var(--border-1)' }}>
                    {editingKey === row.modelKey ? (
                      <TextInput
                        value={editingOutput}
                        onChange={setEditingOutput}
                        width={100}
                      />
                    ) : (
                      <span
                        onClick={() => handleEdit(row.modelKey, row.inputUsdPer1M, row.outputUsdPer1M, row.cacheReadUsdPer1M, row.cacheWriteUsdPer1M)}
                        style={{ cursor: 'pointer' }}
                      >
                        {row.outputUsdPer1M}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid var(--border-1)' }}>
                    {editingKey === row.modelKey ? (
                      <TextInput
                        value={editingCacheRead}
                        onChange={setEditingCacheRead}
                        width={100}
                      />
                    ) : (
                      <span
                        onClick={() => handleEdit(row.modelKey, row.inputUsdPer1M, row.outputUsdPer1M, row.cacheReadUsdPer1M, row.cacheWriteUsdPer1M)}
                        style={{ cursor: 'pointer' }}
                      >
                        {row.cacheReadUsdPer1M ?? '-'}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid var(--border-1)' }}>
                    {editingKey === row.modelKey ? (
                      <TextInput
                        value={editingCacheWrite}
                        onChange={setEditingCacheWrite}
                        width={100}
                      />
                    ) : (
                      <span
                        onClick={() => handleEdit(row.modelKey, row.inputUsdPer1M, row.outputUsdPer1M, row.cacheReadUsdPer1M, row.cacheWriteUsdPer1M)}
                        style={{ cursor: 'pointer' }}
                      >
                        {row.cacheWriteUsdPer1M ?? '-'}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '1px solid var(--border-1)' }}>
                    {editingKey === row.modelKey ? (
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        <Button
                          variant="primary"
                          size="sm"
                          isDisabled={saving}
                          onClick={handleSaveEdit}
                          label={props.copy.tables.pricingAddButton}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingKey('')}
                          label={props.copy.tables.pricingCancelButton}
                        />
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleReset(row.modelKey)}
                        label={props.copy.tables.pricingResetButton}
                      />
                    )}
                  </td>
                </tr>
              ))}
              {addingNew ? (
                <tr>
                  <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-1)' }}>
                    <TextInput
                      value={newModelKey}
                      onChange={setNewModelKey}
                      placeholder={props.copy.tables.pricingModelKeyPlaceholder}
                      width="100%"
                    />
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid var(--border-1)' }}>
                    <TextInput
                      value={newInput}
                      onChange={setNewInput}
                      placeholder={props.copy.tables.pricingInputPlaceholder}
                      width={100}
                    />
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid var(--border-1)' }}>
                    <TextInput
                      value={newOutput}
                      onChange={setNewOutput}
                      placeholder={props.copy.tables.pricingOutputPlaceholder}
                      width={100}
                    />
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid var(--border-1)' }}>
                    <TextInput
                      value={newCacheRead}
                      onChange={setNewCacheRead}
                      placeholder={props.copy.tables.pricingCacheReadPlaceholder}
                      width={100}
                    />
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid var(--border-1)' }}>
                    <TextInput
                      value={newCacheWrite}
                      onChange={setNewCacheWrite}
                      placeholder={props.copy.tables.pricingCacheWritePlaceholder}
                      width={100}
                    />
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '1px solid var(--border-1)' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <Button
                        variant="primary"
                        size="sm"
                        isDisabled={saving}
                        onClick={handleSaveNew}
                        label={props.copy.tables.pricingAddButton}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAddingNew(false)}
                        label={props.copy.tables.pricingCancelButton}
                      />
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState
          icon={<BarChart3 />}
          title={props.copy.tables.noPricing}
          description={props.copy.tables.pricingEmptyBody}
          className="settingsUsageEmpty"
        />
      )}
      {!addingNew ? (
        <div style={{ marginTop: 12 }}>
          <Button
            variant="secondary"
            size="sm"
            isDisabled={loading}
            onClick={handleAddNew}
            label={props.copy.tables.pricingAddButton}
          />
        </div>
      ) : null}
    </div>
  );
}

// -- Request-log cell helpers --

function usageRequestKindLabel(kind: UsageStats['logs'][number]['kind'], copy: UsageSettingsCopy) {
  switch (kind) {
    case 'model': return copy.tables.modelKind;
    case 'tool': return copy.tables.toolKind;
  }
}

function usageRequestTarget(row: UsageStats['logs'][number]) {
  return row.kind === 'tool' ? row.toolName ?? row.model : row.model;
}

function usageRequestSessionCell(row: UsageStats['logs'][number], copy: UsageSettingsCopy, onOpenSession?: (sessionId: string) => void) {
  const label = shortUsageSessionId(row.sessionId);
  if (!onOpenSession) return label;
  return (
    <Button variant="ghost" size="sm" onClick={() => onOpenSession(row.sessionId)} label={copy.tables.openSession(label)} />
  );
}

function shortUsageSessionId(sessionId: string) {
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
}

function usageRequestStatusLabel(status: UsageStats['logs'][number]['status'], copy: UsageSettingsCopy) {
  switch (status) {
    case 'success': return copy.tables.success;
    case 'error': return copy.tables.error;
  }
}

// ── Usage table mapping ─────────────────────────────────────────────────────
// Astryx Table owns table geometry, scrolling, dividers, density, and cell
// semantics. This page only maps its product rows and empty-state copy into
// that public API.

interface UsageColumn {
  header: string;
  numeric?: boolean;
  grow?: boolean;
}

type UsageTableRow = Record<string, unknown> & {
  id: number;
  cells: Array<ReactNode>;
};

const usageTablePlugins = {
  rowHeader: {
    transformBodyCell: (cell, _column, _row, columnIndex) => columnIndex === 0
      ? { ...cell, htmlProps: { ...cell.htmlProps, role: 'rowheader' } }
      : cell,
  },
} satisfies Record<string, TablePlugin<UsageTableRow>>;

interface UsageEmpty {
  /** A lucide icon (same shape EmptyState accepts). */
  Icon: typeof Search;
  title: string;
  body?: string;
}

function UsageStatsTable(props: {
  ariaLabel: string;
  columns: UsageColumn[];
  rows: Array<Array<ReactNode>>;
  empty: UsageEmpty;
}) {
  if (props.rows.length === 0) {
    return (
      <EmptyState
        icon={<props.empty.Icon />}
        title={props.empty.title}
        description={props.empty.body ?? ''}
        className="settingsUsageEmpty"
      />
    );
  }
  const data: UsageTableRow[] = props.rows.map((cells, id) => ({ id, cells }));
  const columns: Array<TableColumn<UsageTableRow>> = props.columns.map((column, index) => ({
    key: `cell-${index}`,
    header: column.header,
    align: column.numeric ? 'end' : 'start',
    width: column.grow ? proportional(1) : pixel(column.numeric ? 88 : 120),
    renderCell: (row) => (
      <span className={column.numeric ? 'settingsUsageNumericCell' : undefined}>
        {row.cells[index]}
      </span>
    ),
  }));

  return (
    <Card className="settingsUsageTable" padding={3}>
      <Table
        aria-label={props.ariaLabel}
        data={data}
        columns={columns}
        idKey="id"
        density="compact"
        dividers="rows"
        textOverflow="truncate"
        plugins={usageTablePlugins}
      />
    </Card>
  );
}
