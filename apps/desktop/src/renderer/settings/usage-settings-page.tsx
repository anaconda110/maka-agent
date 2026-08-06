import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  type PricingConfig,
  type UpdateAppSettingsResult,
  type UsageRange,
  type UsageStats,
  buildConnectionModelCatalogEntries,
  connectionEnabledModelIds,
} from '@maka/core';
import type {
  EffectivePricingEntry,
  PricingMutation,
} from '@maka/runtime-host/protocol';
import {
  Button,
  IconButton,
  TextInput,
  NumberInput,
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
    pricing: pricingCount,
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
            <UsagePricingPanel copy={copy} onCountChange={setPricingCount} />
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

function UsagePricingPanel(props: {
  copy: UsageSettingsCopy;
  onCountChange?: (count: number) => void;
}) {
  const toast = useToast();
  const [revision, setRevision] = useState(0);
  const [entries, setEntries] = useState<EffectivePricingEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editingField, setEditingField] = useState<Field>('input');
  const [editingNumber, setEditingNumber] = useState<number | null | undefined>(undefined);
  const [addingNew, setAddingNew] = useState(false);
  const [newModelKey, setNewModelKey] = useState('');
  const [newInput, setNewInput] = useState('');
  const [newOutput, setNewOutput] = useState('');
  const [newCacheRead, setNewCacheRead] = useState('');
  const [newCacheWrite, setNewCacheWrite] = useState('');
  const [busy, setBusy] = useState(false);
  type Field = 'input' | 'output' | 'cacheRead' | 'cacheWrite';
  const pendingCommit = useRef<{ key: string; field: Field } | null>(null);
  const [connectionModels, setConnectionModels] = useState<Set<string>>(new Set());
  const [availableModels, setAvailableModels] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<'enabled' | 'all'>('enabled');
  useEffect(() => {
    let cancelled = false;
    window.maka.connections.list().then((conns) => {
      if (cancelled) return;
      const enabled = new Set<string>();
      const available = new Set<string>();
      for (const conn of conns) {
        for (const entry of buildConnectionModelCatalogEntries({ connection: conn })) {
          available.add(`${conn.slug}:${entry.id}`);
        }
        if (!conn.enabled) continue;
        connectionEnabledModelIds(conn).forEach((id) => enabled.add(`${conn.slug}:${id}`));
      }
      setConnectionModels(enabled);
      setAvailableModels(available);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const loadPricing = async () => {
    setLoading(true);
    try {
      const snapshot = await window.maka.pricing.query();
      setRevision(snapshot.revision);
      setEntries(snapshot.entries);
    } catch (error) {
      toast.error(props.copy.tables.pricingLoadFailed, String(error));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void loadPricing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!props.onCountChange) return;
    if (scope === 'all') {
      const keys = new Set<string>(availableModels);
      entries.forEach((e) => keys.add(e.pricing.modelKey));
      props.onCountChange(keys.size);
    } else {
      props.onCountChange(connectionModels.size);
    }
  }, [connectionModels, availableModels, entries, scope, props.onCountChange]);
  async function runMutation(mutation: PricingMutation): Promise<boolean> {
    setBusy(true);
    try {
      const result = await window.maka.pricing.mutate({ expectedRevision: revision, mutation });
      if (result.kind === 'revision_conflict') {
        toast.error(props.copy.tables.pricingConflict);
        await loadPricing();
        return false;
      }
      await loadPricing();
      return true;
    } catch (error) {
      toast.error(mutation.kind === 'delete' ? props.copy.tables.pricingDeleteFailed : props.copy.tables.pricingSaveFailed, String(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function fieldValue(entry: EffectivePricingEntry | undefined, f: Field): number | undefined {
    return f === 'input' ? entry?.pricing.inputUsdPer1M : f === 'output' ? entry?.pricing.outputUsdPer1M : f === 'cacheRead' ? entry?.pricing.cacheReadUsdPer1M : entry?.pricing.cacheWriteUsdPer1M;
  }
  const fieldOrder: Array<Field> = ['input', 'output', 'cacheRead', 'cacheWrite'];
  function startEdit(modelKey: string, field: Field, value: number | undefined) {
    pendingCommit.current = { key: modelKey, field };
    setEditingKey(modelKey);
    setEditingField(field);
    setEditingNumber(value);
  }
  async function commit(): Promise<void> {
    const pending = pendingCommit.current;
    if (!pending) return;
    pendingCommit.current = null;
    setEditingKey('');
    await applyCommit(pending);
  }
  function commitAndMoveTo(targetKey: string, targetField: Field) {
    const pending = pendingCommit.current;
    pendingCommit.current = null;
    void applyCommit(pending);
    startEdit(targetKey, targetField, fieldValue(entries.find((e) => e.pricing.modelKey === targetKey), targetField));
  }
  async function applyCommit(pending: { key: string; field: Field } | null) {
    if (!pending) return;
    const { key, field } = pending;
    const entry = entries.find((e) => e.pricing.modelKey === key);
    if (editingNumber === null && (field === 'input' || field === 'output')) {
      void runMutation({ kind: 'delete', modelKey: key });
      return;
    }
    const input = field === 'input' && editingNumber !== null && editingNumber !== undefined ? editingNumber : entry?.pricing.inputUsdPer1M ?? 0;
    const output = field === 'output' && editingNumber !== null && editingNumber !== undefined ? editingNumber : entry?.pricing.outputUsdPer1M ?? 0;
    const cacheRead = field === 'cacheRead' ? (editingNumber === null ? undefined : editingNumber) : entry?.pricing.cacheReadUsdPer1M;
    const cacheWrite = field === 'cacheWrite' ? (editingNumber === null ? undefined : editingNumber) : entry?.pricing.cacheWriteUsdPer1M;
    const pricing: PricingConfig = {
      modelKey: key, inputUsdPer1M: input, outputUsdPer1M: output,
      ...(cacheRead !== undefined ? { cacheReadUsdPer1M: cacheRead } : {}),
      ...(cacheWrite !== undefined ? { cacheWriteUsdPer1M: cacheWrite } : {}),
    };
    void runMutation({ kind: 'upsert', pricing });
  }
  async function commitThenReset(modelKey: string) {
    if (modelKey === editingKey) {
      pendingCommit.current = null;
      setEditingKey('');
    } else if (pendingCommit.current) {
      const pending = pendingCommit.current;
      pendingCommit.current = null;
      setEditingKey('');
      await applyCommit(pending);
    }
    await handleReset(modelKey);
  }
  async function handleReset(modelKey: string) {
    await runMutation({ kind: 'delete', modelKey });
  }
  async function handleSaveNew() {
    const key = newModelKey.trim();
    const input = Number(newInput);
    const output = Number(newOutput);
    if (!key) { toast.error(props.copy.tables.pricingModelKeyRequired, props.copy.tables.pricingModelKeyRequired); return; }
    if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
      toast.error(props.copy.tables.pricingRateInvalid, props.copy.tables.pricingRateInvalid);
      return;
    }
    const cacheRead = newCacheRead.trim() !== '' ? Number(newCacheRead) : undefined;
    const cacheWrite = newCacheWrite.trim() !== '' ? Number(newCacheWrite) : undefined;
    const pricing: PricingConfig = {
      modelKey: key, inputUsdPer1M: input, outputUsdPer1M: output,
      ...(cacheRead !== undefined ? { cacheReadUsdPer1M: cacheRead } : {}),
      ...(cacheWrite !== undefined ? { cacheWriteUsdPer1M: cacheWrite } : {}),
    };
    const ok = await runMutation({ kind: 'upsert', pricing });
    if (ok) { setAddingNew(false); setNewModelKey(''); setNewInput(''); setNewOutput(''); setNewCacheRead(''); setNewCacheWrite(''); }
  }
  const allModels = useMemo(() => {
    if (scope === 'all') {
      const keys = new Set<string>(availableModels);
      entries.forEach((e) => keys.add(e.pricing.modelKey));
      return Array.from(keys).sort();
    }
    return Array.from(connectionModels).sort();
  }, [connectionModels, availableModels, entries, scope]);
  const t = props.copy.tables;
  const fieldLabel: Record<Field, string> = { input: t.pricingInputLabel, output: t.pricingOutputLabel, cacheRead: t.pricingCacheReadLabel, cacheWrite: t.pricingCacheWriteLabel };
  type PricingRow = Record<string, unknown> & { id: string; modelKey: string; entry?: EffectivePricingEntry };
  const rows: PricingRow[] = useMemo(() => allModels.map((modelKey) => ({ id: modelKey, modelKey, entry: entries.find((e) => e.pricing.modelKey === modelKey) })), [allModels, entries]);
  const priceColumns: Array<Field> = ['input', 'output', 'cacheRead', 'cacheWrite'];
  function renderPriceCell(modelKey: string, field: Field, entry?: EffectivePricingEntry): ReactNode {
    const value = fieldValue(entry, field);
    if (editingKey === modelKey && editingField === field) {
      return (
        <NumberInput label={fieldLabel[field]} isLabelHidden hasAutoFocus hasClear min={0} value={editingNumber ?? undefined} onChange={(v) => setEditingNumber(v)} width={88}
          onBlur={() => void commit()}
          onEnter={() => {
            const nextField = fieldOrder[fieldOrder.indexOf(field) + 1];
            if (nextField) commitAndMoveTo(modelKey, nextField);
            else { const nextKey = allModels[allModels.indexOf(modelKey) + 1]; if (nextKey) commitAndMoveTo(nextKey, 'input'); else void commit(); }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { pendingCommit.current = null; setEditingKey(''); }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              const nextKey = allModels[allModels.indexOf(modelKey) + (e.key === 'ArrowDown' ? 1 : -1)];
              if (nextKey) { e.preventDefault(); commitAndMoveTo(nextKey, field); }
            } else if (e.key === 'ArrowRight') {
              const nextField = fieldOrder[fieldOrder.indexOf(field) + 1];
              if (nextField) { e.preventDefault(); commitAndMoveTo(modelKey, nextField); }
              else { const nextKey = allModels[allModels.indexOf(modelKey) + 1]; if (nextKey) { e.preventDefault(); commitAndMoveTo(nextKey, 'input'); } }
            } else if (e.key === 'ArrowLeft') {
              const prevField = fieldOrder[fieldOrder.indexOf(field) - 1];
              if (prevField) { e.preventDefault(); commitAndMoveTo(modelKey, prevField); }
              else { const prevKey = allModels[allModels.indexOf(modelKey) - 1]; if (prevKey) { e.preventDefault(); commitAndMoveTo(prevKey, 'cacheWrite'); } }
            }
          }}
        />
      );
    }
    return <span>{value !== undefined ? value : <span style={{ color: 'var(--text-3, #999)', fontSize: '0.85em' }}>{t.pricingClickToSet}</span>}</span>;
  }
  const columns: Array<TableColumn<PricingRow>> = useMemo(() => {
    const cols: Array<TableColumn<PricingRow>> = [{
      key: 'modelKey', header: t.pricingModelKeyLabel, width: proportional(2),
      renderCell: (row) => {
        const colonIdx = row.modelKey.indexOf(':');
        const displayKey = colonIdx > 0 ? row.modelKey.slice(colonIdx + 1) : row.modelKey;
        return (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span>{displayKey}</span>
            <span style={{ fontSize: '0.75em', color: 'var(--text-3, #999)' }}>
              {row.entry?.source === 'builtin' ? t.pricingSourceBuiltin : t.pricingSourceCustom}
              {row.entry?.source === 'custom' ? row.entry.resetEffect === 'restore_builtin' ? ` · ${t.pricingResetEffectRestore}` : ` · ${t.pricingResetEffectUnpriced}` : ''}
            </span>
          </div>
        );
      },
    }];
    for (const field of priceColumns) {
      const short = field === 'input' ? t.pricingInputShort : field === 'output' ? t.pricingOutputShort : field === 'cacheRead' ? t.pricingCacheReadShort : t.pricingCacheWriteShort;
      cols.push({ key: field, header: short, align: 'end', width: pixel(88), renderCell: (row) => renderPriceCell(row.modelKey, field, row.entry) });
    }
    cols.push({
      key: 'reset', header: t.pricingResetButton, align: 'center', width: pixel(72),
      renderCell: (row) => row.entry?.source === 'custom' ? <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => void commitThenReset(row.modelKey)} label={t.pricingResetButton} /> : null,
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allModels, entries, editingKey, editingNumber, busy]);
  const editCellPlugin: TablePlugin<PricingRow> = useMemo(() => ({
    transformBodyCell: (cell, column, row) => {
      if (!priceColumns.includes(column.key as Field)) return cell;
      return { ...cell, htmlProps: { ...cell.htmlProps, style: { ...cell.htmlProps.style, cursor: 'pointer' }, onClick: () => commitAndMoveTo(row.modelKey, column.key as Field) } };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [entries, editingNumber, editingKey]);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <SegmentedControl value={scope} label={t.pricingScopeAria} onChange={(value) => setScope(value as 'enabled' | 'all')}>
          <SegmentedControlItem value="enabled" label={t.pricingScopeEnabled} />
          <SegmentedControlItem value="all" label={t.pricingScopeAll} />
        </SegmentedControl>
        {scope === 'all' ? <span style={{ color: 'var(--text-3, #999)', fontSize: '0.85em' }}>{t.pricingScopeAllHelp}</span> : null}
        <Button variant="ghost" size="sm" onClick={() => void loadPricing()} isDisabled={loading} label={t.pricingRefreshButton} />
      </div>
      {rows.length > 0 || addingNew ? (
        <Card className="settingsUsageTable" padding={3}>
          <Table aria-label={t.pricingAria} data={rows} columns={columns} idKey="id" density="compact" dividers="rows" textOverflow="truncate" plugins={{ edit: editCellPlugin }} />
          {!addingNew ? (
            <div style={{ padding: '8px 12px' }}><Button variant="ghost" size="sm" onClick={() => setAddingNew(true)} label={t.pricingAddRow} /></div>
          ) : (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-1)' }}>
              <NewPricingRow copy={t} newModelKey={newModelKey} newInput={newInput} newOutput={newOutput} newCacheRead={newCacheRead} newCacheWrite={newCacheWrite} setNewModelKey={setNewModelKey} setNewInput={setNewInput} setNewOutput={setNewOutput} setNewCacheRead={setNewCacheRead} setNewCacheWrite={setNewCacheWrite} busy={busy} onSave={handleSaveNew} onCancel={() => setAddingNew(false)} />
            </div>
          )}
        </Card>
      ) : (
        <EmptyState icon={<BarChart3 />} title={props.copy.tables.noPricing} description={props.copy.tables.pricingEmptyBody} actions={<Button variant="primary" size="sm" onClick={() => setAddingNew(true)} label={props.copy.tables.pricingAddRow} />} />
      )}
    </div>
  );
}
function NewPricingRow(props: {
  copy: UsageSettingsCopy['tables'];
  newModelKey: string; newInput: string; newOutput: string; newCacheRead: string; newCacheWrite: string;
  setNewModelKey: (v: string) => void; setNewInput: (v: string) => void; setNewOutput: (v: string) => void; setNewCacheRead: (v: string) => void; setNewCacheWrite: (v: string) => void;
  busy: boolean; onSave: () => void; onCancel: () => void;
}) {
  const c = props.copy;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
      <TextInput label={c.pricingModelKeyLabel} value={props.newModelKey} onChange={props.setNewModelKey} placeholder={c.pricingModelKeyPlaceholder} />
      <NumberInput label={c.pricingInputLabel} value={props.newInput ? Number(props.newInput) : 0} onChange={(v) => props.setNewInput(String(v))} min={0} width={88} />
      <NumberInput label={c.pricingOutputLabel} value={props.newOutput ? Number(props.newOutput) : 0} onChange={(v) => props.setNewOutput(String(v))} min={0} width={88} />
      <NumberInput label={c.pricingCacheReadLabel} value={props.newCacheRead ? Number(props.newCacheRead) : undefined} onChange={(v) => props.setNewCacheRead(v === null ? '' : String(v))} min={0} width={88} placeholder={c.pricingCacheReadPlaceholder} />
      <NumberInput label={c.pricingCacheWriteLabel} value={props.newCacheWrite ? Number(props.newCacheWrite) : undefined} onChange={(v) => props.setNewCacheWrite(v === null ? '' : String(v))} min={0} width={88} placeholder={c.pricingCacheWritePlaceholder} />
      <div style={{ display: 'flex', gap: 4 }}>
        <Button variant="primary" size="sm" isDisabled={props.busy} onClick={props.onSave} label={c.pricingAddButton} />
        <Button variant="ghost" size="sm" onClick={props.onCancel} label={c.pricingCancelButton} />
      </div>
    </div>
  );
}
// ── Request-log cell helpers ────────────────────────────────────────────────

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
