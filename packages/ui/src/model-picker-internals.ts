import type { SelectorDivider, SelectorOptionData } from '@astryxdesign/core/Selector';
import type { ProviderType } from '@maka/core';
import { type ModelMenuGroup, modelChoiceValue } from './chat-model-helpers.js';

export type ModelPickerOption = SelectorOptionData;

export interface ModelPickerOptionMeta {
  /** Short description from models.dev (#2329). */
  description?: string;
  /** Knowledge cutoff date (ISO) (#2329). */
  knowledgeCutoff?: string;
  /** When models.dev last updated this model (ISO), for freshness hints (#2329). */
  lastUpdated?: string;
}

export interface ModelPickerSection {
  type: 'section';
  title: string;
  options: ModelPickerOption[];
}

export type ModelPickerSelectorOption = ModelPickerOption | SelectorDivider | ModelPickerSection;

export interface ModelPickerLeadingOption {
  value: string;
  label: string;
  providerType?: ProviderType;
}

/**
 * Shapes Maka's provider catalog into Astryx Selector's public option model.
 * Search, flattening, keyboard navigation, selection, and empty results remain
 * entirely inside Selector. Provider marks use the separate public-value map
 * below rather than relying on Selector to preserve product-only fields.
 */
export function buildModelPickerOptions(
  groups: readonly ModelMenuGroup[],
  leadingOption?: ModelPickerLeadingOption,
): ModelPickerSelectorOption[] {
  const sections: ModelPickerSection[] = groups.map((group) => ({
    type: 'section',
    title: group.heading,
    options: group.choices.map((choice) => ({
      value: modelChoiceValue(choice.connectionSlug, choice.model),
      label: choice.label,
    })),
  }));

  if (!leadingOption) return sections;

  const option: ModelPickerOption = {
    value: leadingOption.value,
    label: leadingOption.label,
  };
  return sections.length > 0 ? [option, { type: 'divider' }, ...sections] : [option];
}

/**
 * Build a per-option-value lookup of models.dev facts (description, knowledge
 * cutoff, lastUpdated) so `renderOption` can show them without Selector carrying
 * product-only fields (#2329). The leading option has no metadata.
 */
export function buildModelPickerOptionMeta(
  groups: readonly ModelMenuGroup[],
): Map<string, ModelPickerOptionMeta> {
  const meta = new Map<string, ModelPickerOptionMeta>();
  for (const group of groups) {
    for (const choice of group.choices) {
      const value = modelChoiceValue(choice.connectionSlug, choice.model);
      const entry: ModelPickerOptionMeta = {};
      if (choice.description) entry.description = choice.description;
      if (choice.knowledgeCutoff) entry.knowledgeCutoff = choice.knowledgeCutoff;
      if (choice.lastUpdated) entry.lastUpdated = choice.lastUpdated;
      if (Object.keys(entry).length > 0) meta.set(value, entry);
    }
  }
  return meta;
}

export function buildModelPickerProviderTypes(
  groups: readonly ModelMenuGroup[],
  leadingOption?: ModelPickerLeadingOption,
): ReadonlyMap<string, ProviderType> {
  const entries: [string, ProviderType][] = groups.flatMap((group) =>
    group.choices.map((choice) => [
      modelChoiceValue(choice.connectionSlug, choice.model),
      group.providerType,
    ]),
  );
  if (leadingOption?.providerType) {
    entries.unshift([leadingOption.value, leadingOption.providerType]);
  }
  return new Map(entries);
}
