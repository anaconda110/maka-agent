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
  // NumberInput controlled with `number | null | undefined`:
  //  - number: a valid (component-validated, min=0) rate
  //  - null:   user cleared via hasClear → delete record (input/output) or
  //            omit the cache field (cacheRead/cacheWrite)
  //  - undefined: the field doesn't exist on the entry yet (placeholder shown)
  const [editingNumber, setEditingNumber] = useState<number | null | undefined>(undefined);
  const [addingNew, setAddingNew] = useState(false);
  const [newModelKey, setNewModelKey] = useState('');
  const [newInput, setNewInput] = useState('');
  const [newOutput, setNewOutput] = useState('');
  const [newCacheRead, setNewCacheRead] = useState('');
  const [newCacheWrite, setNewCacheWrite] = useState('');
  const [busy, setBusy] = useState(false);

  // `pendingCommit` tracks which cell is currently being edited, decoupled from
  // the `editingKey/Field` render state. It exists so `commit()` (fired on blur
  // when the user clicks elsewhere) and `commitAndMoveTo()` (fired by Enter /
  // clicking another price cell / arrow keys) don't double-commit: once a
  // commit has run, `pendingCommit.current` is nulled, so a follow-up blur on
  // the now-unmounting input becomes a no-op.
  type Field = 'input' | 'output' | 'cacheRead' | 'cacheWrite';
  const pendingCommit = useRef<{ key: string; field: Field } | null>(null);

  // Display scope: which models the table shows.
  //  - connectionModels: models from currently-enabled connections that the
  //    user has marked usable (`connectionEnabledModelIds`). This is the
  //    "已启用" scope — only models the user can actually call right now,
  //    whether or not they have a configured price.
  //  - availableModels: every connection's full catalog from
  //    `buildConnectionModelCatalogEntries`, including disabled connections
  //    and models the user hasn't enabled. Combined with the pricing snapshot's
  //    model keys, this forms the "全部" scope (see `allModels` below).
  const [connectionModels, setConnectionModels] = useState<Set<string>>(new Set());
  const [availableModels, setAvailableModels] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<'enabled' | 'all'>('enabled');

  useEffect(() => {
    let cancelled = false;
    window.maka.connections
      .list()
      .then((conns) => {
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
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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

  // Tab counter reflects the models shown in the table for the current scope.
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
      toast.error(
        mutation.kind === 'delete' ? props.copy.tables.pricingDeleteFailed : props.copy.tables.pricingSaveFailed,
        String(error),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  function fieldValue(entry: EffectivePricingEntry | undefined, f: Field) {
    return f === 'input'
      ? entry?.pricing.inputUsdPer1M
      : f === 'output'
        ? entry?.pricing.outputUsdPer1M
        : f === 'cacheRead'
          ? entry?.pricing.cacheReadUsdPer1M
          : entry?.pricing.cacheWriteUsdPer1M;
  }

  const fieldOrder: Array<Field> = ['input', 'output', 'cacheRead', 'cacheWrite'];

  // Enter edit mode for a cell. Sets both the render state (which cell shows the
  // input) and the pendingCommit ref (so the eventual commit knows what to save).
  function startEdit(modelKey: string, field: Field, value: number | undefined) {
    pendingCommit.current = { key: modelKey, field };
    setEditingKey(modelKey);
    setEditingField(field);
    setEditingNumber(value);
  }

  // Commit the current edit (if any) and exit edit mode. Called by `onBlur`
  // (rule ③: click elsewhere → save + exit). No-op if nothing is pending — this
  // is the guard that stops a stray blur after `commitAndMoveTo` from
  // double-committing.
  async function commit(): Promise<void> {
    const pending = pendingCommit.current;
    if (!pending) return;
    pendingCommit.current = null;
    setEditingKey('');
    await applyCommit(pending);
  }

  // Commit the current edit, then immediately start editing another cell
  // (rule ① Enter → next cell; rule ② click a price cell → that cell; arrow
  // keys). The commit fires first; `startEdit` flips the render to the new cell
  // so the old input unmounts. Its blur would re-enter `commit()`, but
  // `pendingCommit.current` is already null → no-op (the guard above).
  function commitAndMoveTo(targetKey: string, targetField: Field) {
    const pending = pendingCommit.current;
    pendingCommit.current = null;
    void applyCommit(pending);
    startEdit(targetKey, targetField, fieldValue(entries.find((e) => e.pricing.modelKey === targetKey), targetField));
  }

  // The shared commit core. Rules:
  //  - null + input/output → delete the whole record (required field cleared)
  //  - null + cacheRead/cacheWrite → omit that optional field, keep the rest
  //  - number → upsert with that field, carrying over the non-edited fields
  //  NumberInput guarantees onChange only delivers a valid non-negative number
  //  or null (cleared via hasClear), so no manual validation/parsing is needed.
  async function applyCommit(pending: { key: string; field: Field } | null) {
    if (!pending) return;
    const { key, field } = pending;
    const entry = entries.find((e) => e.pricing.modelKey === key);

    // Cleared a required field → delete the whole record.
    if (editingNumber === null && (field === 'input' || field === 'output')) {
      void runMutation({ kind: 'delete', modelKey: key });
      return;
    }

    // Carry over the non-edited fields; the edited field uses editingNumber.
    const input = field === 'input' && editingNumber !== null && editingNumber !== undefined
      ? editingNumber
      : entry?.pricing.inputUsdPer1M ?? 0;
    const output = field === 'output' && editingNumber !== null && editingNumber !== undefined
      ? editingNumber
      : entry?.pricing.outputUsdPer1M ?? 0;
    // Cleared cache field (null) → omit (undefined); non-edited → carry over; edited → new value.
    const cacheRead =
      field === 'cacheRead' ? (editingNumber === null ? undefined : editingNumber) : entry?.pricing.cacheReadUsdPer1M;
    const cacheWrite =
      field === 'cacheWrite' ? (editingNumber === null ? undefined : editingNumber) : entry?.pricing.cacheWriteUsdPer1M;

    const pricing: PricingConfig = {
      modelKey: key,
      inputUsdPer1M: input,
      outputUsdPer1M: output,
      ...(cacheRead !== undefined ? { cacheReadUsdPer1M: cacheRead } : {}),
      ...(cacheWrite !== undefined ? { cacheWriteUsdPer1M: cacheWrite } : {}),
    };
    void runMutation({ kind: 'upsert', pricing });
  }

  // Reset (delete) a pricing row, coordinating with an in-flight edit:
  //  - resetting the row currently being edited → discard the edit, just delete
  //  - resetting a different row → commit the current edit first, then delete
  //  - nothing being edited → just delete
  async function commitThenReset(modelKey: string) {
    if (modelKey === editingKey) {
      // Resetting the row we're editing: the edit is moot, drop it directly.
      pendingCommit.current = null;
      setEditingKey('');
    } else if (pendingCommit.current) {
      // Commit the in-flight edit first so it isn't lost, then delete the target.
      const pending = pendingCommit.current;
      pendingCommit.current = null;
      setEditingKey('');
      await applyCommit(pending);
    }
    await handleReset(modelKey);
  }

  async function handleReset(modelKey: string) {
    if (!window.confirm(props.copy.tables.pricingResetConfirm)) return;
    const ok = await runMutation({ kind: 'delete', modelKey });
    if (ok) toast.success(props.copy.tables.pricingResetSuccess);
  }

  async function handleSaveNew() {
    const key = newModelKey.trim();
    const input = Number(newInput);
    const output = Number(newOutput);
    if (!key) {
      toast.error(props.copy.tables.pricingModelKeyRequired, props.copy.tables.pricingModelKeyRequired);
      return;
    }
    if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
      toast.error(props.copy.tables.pricingRateInvalid, props.copy.tables.pricingRateInvalid);
      return;
    }
    const cacheRead = newCacheRead.trim() !== '' ? Number(newCacheRead) : undefined;
    const cacheWrite = newCacheWrite.trim() !== '' ? Number(newCacheWrite) : undefined;
    const pricing: PricingConfig = {
      modelKey: key,
      inputUsdPer1M: input,
      outputUsdPer1M: output,
      ...(cacheRead !== undefined ? { cacheReadUsdPer1M: cacheRead } : {}),
      ...(cacheWrite !== undefined ? { cacheWriteUsdPer1M: cacheWrite } : {}),
    };
    const ok = await runMutation({ kind: 'upsert', pricing });
    if (ok) {
      setAddingNew(false);
      setNewModelKey('');
      setNewInput('');
      setNewOutput('');
      setNewCacheRead('');
      setNewCacheWrite('');
    }
  }

  const allModels = useMemo(() => {
    if (scope === 'all') {
      // "全部" = the union of three model sets:
      //   1. every connection's full catalog (incl. disabled connections and
      //      models the user hasn't enabled — i.e. `availableModels`),
      //   2. built-in-priced models (`source: 'builtin'` entries),
      //   3. saved custom-priced models (`source: 'custom'` entries, including
      //      "orphans" whose connection has since been disabled/removed).
      // Set #1 is already in `availableModels`; #2 and #3 are both in the
      // pricing snapshot's `entries`, so taking the union of `availableModels`
      // and every entry's `modelKey` covers all three. Models that are in the
      // catalog but have no price at all appear as empty rows (click-to-set).
      const keys = new Set<string>(availableModels);
      entries.forEach((e) => keys.add(e.pricing.modelKey));
      return Array.from(keys).sort();
    }
    // "已启用": only models from currently-enabled connections that the user
    // has marked usable — whether or not they have a configured price.
    return Array.from(connectionModels).sort();
  }, [connectionModels, availableModels, entries, scope]);

  const fieldLabel: Record<'input' | 'output' | 'cacheRead' | 'cacheWrite', string> = {
    input: props.copy.tables.pricingInputLabel,
    output: props.copy.tables.pricingOutputLabel,
    cacheRead: props.copy.tables.pricingCacheReadLabel,
    cacheWrite: props.copy.tables.pricingCacheWriteLabel,
  };

  function renderCell(
    modelKey: string,
    field: 'input' | 'output' | 'cacheRead' | 'cacheWrite',
    value: number | undefined,
  ) {
    const isEditing = editingKey === modelKey && editingField === field;
    if (isEditing) {
      return (
        <NumberInput
          label={fieldLabel[field]}
          isLabelHidden
          hasAutoFocus
          hasClear
          min={0}
          value={editingNumber ?? undefined}
          onChange={(v) => setEditingNumber(v)}
          width={100}
          onBlur={() => void commit()}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const nextField = fieldOrder[fieldOrder.indexOf(field) + 1];
              if (nextField) commitAndMoveTo(modelKey, nextField);
              else {
                const nextKey = allModels[allModels.indexOf(modelKey) + 1];
                if (nextKey) commitAndMoveTo(nextKey, 'input');
                else void commit();
              }
            } else if (e.key === 'Escape') {
              // Discard the edit entirely — don't commit, just exit.
              pendingCommit.current = null;
              setEditingKey('');
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              const nextKey = allModels[allModels.indexOf(modelKey) + (e.key === 'ArrowDown' ? 1 : -1)];
              if (nextKey) {
                e.preventDefault();
                commitAndMoveTo(nextKey, field);
              }
              // First row ↑ / last row ↓: stay editing, caret moves naturally.
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              const idx = fieldOrder.indexOf(field);
              if (e.key === 'ArrowRight') {
                const nextField = fieldOrder[idx + 1];
                if (nextField) {
                  e.preventDefault();
                  commitAndMoveTo(modelKey, nextField);
                } else {
                  const nextKey = allModels[allModels.indexOf(modelKey) + 1];
                  if (nextKey) {
                    e.preventDefault();
                    commitAndMoveTo(nextKey, 'input');
                  }
                  // Last row, last column: stay editing, caret moves naturally.
                }
              } else {
                const prevField = fieldOrder[idx - 1];
                if (prevField) {
                  e.preventDefault();
                  commitAndMoveTo(modelKey, prevField);
                } else {
                  const prevKey = allModels[allModels.indexOf(modelKey) - 1];
                  if (prevKey) {
                    e.preventDefault();
                    commitAndMoveTo(prevKey, 'cacheWrite');
                  }
                  // First row, first column: do nothing — stay editing, caret moves naturally.
                }
              }
            }
          }}
        />
      );
    }
    return <span>{value !== undefined ? value : <span style={{ color: 'var(--text-3, #999)', fontSize: '0.85em' }}>{props.copy.tables.pricingClickToSet}</span>}</span>;
  }

  function editableCellProps(
    _modelKey: string,
    _field: 'input' | 'output' | 'cacheRead' | 'cacheWrite',
    value: number | undefined,
  ) {
    return {
      style: {
        padding: '8px 12px',
        textAlign: 'right' as const,
        borderBottom: '1px solid var(--border-1)',
        whiteSpace: 'nowrap' as const,
        cursor: 'pointer',
      },
      onClick: () => {
        // Rule ②: clicking another price cell saves the current edit and moves
        // the edit cursor to the clicked cell. If nothing is being edited,
        // commitAndMoveTo just starts editing the clicked cell.
        commitAndMoveTo(_modelKey, _field);
      },
    };
  }

  const t = props.copy.tables;
  const cellBorder = { borderBottom: '1px solid var(--border-1)', whiteSpace: 'nowrap' as const };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <SegmentedControl
          value={scope}
          label={t.pricingScopeAria}
          onChange={(value) => setScope(value as 'enabled' | 'all')}
        >
          <SegmentedControlItem value="enabled" label={t.pricingScopeEnabled} />
          <SegmentedControlItem value="all" label={t.pricingScopeAll} />
        </SegmentedControl>
        {scope === 'all' ? (
          <span style={{ color: 'var(--text-3, #999)', fontSize: '0.85em' }}>{t.pricingScopeAllHelp}</span>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => void loadPricing()} isDisabled={loading} label={t.pricingRefreshButton} />
      </div>
      {allModels.length > 0 || addingNew ? (
        <Card className="settingsUsageTable" padding={3}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 12px', ...cellBorder }}>{t.pricingModelKeyLabel}</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', ...cellBorder }} title={t.pricingInputLabel}>{t.pricingInputShort}</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', ...cellBorder }} title={t.pricingOutputLabel}>{t.pricingOutputShort}</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', ...cellBorder }} title={t.pricingCacheReadLabel}>{t.pricingCacheReadShort}</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', ...cellBorder }} title={t.pricingCacheWriteLabel}>{t.pricingCacheWriteShort}</th>
                <th style={{ textAlign: 'center', padding: '8px 12px', ...cellBorder }}>{t.pricingResetButton}</th>
              </tr>
            </thead>
            <tbody>
              {allModels.map((modelKey) => {
                const entry = entries.find((e) => e.pricing.modelKey === modelKey);
                const colonIdx = modelKey.indexOf(':');
                const displayKey = colonIdx > 0 ? modelKey.slice(colonIdx + 1) : modelKey;
                return (
                  <tr key={modelKey}>
                    <td style={{ padding: '8px 12px', ...cellBorder }} title={modelKey}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span>{displayKey}</span>
                        <span style={{ fontSize: '0.75em', color: 'var(--text-3, #999)' }}>
                          {entry?.source === 'builtin' ? t.pricingSourceBuiltin : t.pricingSourceCustom}
                          {entry?.source === 'custom'
                            ? entry.resetEffect === 'restore_builtin'
                              ? ` · ${t.pricingResetEffectRestore}`
                              : ` · ${t.pricingResetEffectUnpriced}`
                            : ''}
                        </span>
                      </div>
                    </td>
                    <td {...editableCellProps(modelKey, 'input', entry?.pricing.inputUsdPer1M)}>
                      {renderCell(modelKey, 'input', entry?.pricing.inputUsdPer1M)}
                    </td>
                    <td {...editableCellProps(modelKey, 'output', entry?.pricing.outputUsdPer1M)}>
                      {renderCell(modelKey, 'output', entry?.pricing.outputUsdPer1M)}
                    </td>
                    <td {...editableCellProps(modelKey, 'cacheRead', entry?.pricing.cacheReadUsdPer1M)}>
                      {renderCell(modelKey, 'cacheRead', entry?.pricing.cacheReadUsdPer1M)}
                    </td>
                    <td {...editableCellProps(modelKey, 'cacheWrite', entry?.pricing.cacheWriteUsdPer1M)}>
                      {renderCell(modelKey, 'cacheWrite', entry?.pricing.cacheWriteUsdPer1M)}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', ...cellBorder }}>
                      {entry?.source === 'custom' ? (
                        <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => void commitThenReset(modelKey)} label={t.pricingResetButton} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {addingNew ? (
                <tr>
                  <td style={{ padding: '8px 12px', ...cellBorder }}>
                    <TextInput label={t.pricingModelKeyLabel} isLabelHidden value={newModelKey} onChange={setNewModelKey} placeholder={t.pricingModelKeyPlaceholder} width="100%" />
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', ...cellBorder }}>
                    <TextInput label={t.pricingInputLabel} isLabelHidden value={newInput} onChange={setNewInput} placeholder={t.pricingInputPlaceholder} width={100} />
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', ...cellBorder }}>
                    <TextInput label={t.pricingOutputLabel} isLabelHidden value={newOutput} onChange={setNewOutput} placeholder={t.pricingOutputPlaceholder} width={100} />
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', ...cellBorder }}>
                    <TextInput label={t.pricingCacheReadLabel} isLabelHidden value={newCacheRead} onChange={setNewCacheRead} placeholder={t.pricingCacheReadPlaceholder} width={100} />
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', ...cellBorder }}>
                    <TextInput label={t.pricingCacheWriteLabel} isLabelHidden value={newCacheWrite} onChange={setNewCacheWrite} placeholder={t.pricingCacheWritePlaceholder} width={100} />
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', ...cellBorder }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <Button variant="primary" size="sm" isDisabled={busy} onClick={handleSaveNew} label={t.pricingAddButton} />
                      <Button variant="ghost" size="sm" onClick={() => setAddingNew(false)} label={t.pricingCancelButton} />
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {!addingNew ? (
            <div style={{ padding: '8px 12px' }}>
              <Button variant="ghost" size="sm" onClick={() => setAddingNew(true)} label={t.pricingAddRow} />
            </div>
          ) : null}
        </Card>
      ) : (
        <EmptyState
          icon={<BarChart3 />}
          title={props.copy.tables.noPricing}
          description={props.copy.tables.pricingEmptyBody}
          actions={
            <Button variant="primary" size="sm" onClick={() => setAddingNew(true)} label={props.copy.tables.pricingAddRow} />
          }
        />
      )}
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
