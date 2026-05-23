/**
 * PR-UI-RENDER-3a — renderer components consumed by the registry.
 *
 * Two components, both deliberately small:
 *
 *   - `UnsupportedArtifactPreview` — pure UI. Shows file metadata
 *     (name, MIME if known, size) and a brief reason copy keyed to
 *     `PreviewResolution.reason`. Optionally renders a real
 *     "在 Finder 中打开" button when the caller passes
 *     `onShowInFolder`. No prop = no button (NOT a disabled button —
 *     @kenji review @msg 9cf1ca7a says disabled buttons here would
 *     wrongly suggest "all unsupported items can be opened in
 *     Finder").
 *   - `ImageArtifactPreview` — loads the binary via
 *     `window.maka.artifacts.readBinary`, applies the L2 base64
 *     length cap from `exceedsImagePayloadCap` BEFORE decoding,
 *     and renders a `<img>` with `object-fit: contain` inside a
 *     bounded container. Loading / failure / oversize all fall
 *     back to the Unsupported component with a typed `reason`.
 *
 * No new IPC introduced — the components only call existing
 * `window.maka.artifacts.readBinary` (PR-UI-12) and reuse
 * `window.maka.app.openArtifactPath` via the caller's optional
 * `onShowInFolder` prop.
 */

import { useEffect, useState } from 'react';
import type { ArtifactBinaryReadResult, ArtifactRecord } from '@maka/core';
import {
  type ArtifactPreviewInput,
  type PreviewResolution,
  exceedsImagePayloadCap,
  formatPreviewSize,
  resolvePreviewKind,
} from '@maka/ui/artifact-preview-registry';

/**
 * Top-level dispatcher: classifies the record and renders the
 * appropriate component. The caller (currently
 * `artifact-preview.tsx`) only needs to call this for the `image`
 * record.kind; other kinds keep using the legacy preview switch.
 */
export function RegistryArtifactPreview(props: {
  record: ArtifactRecord;
  /** Optional: shows a real button when provided. Hidden otherwise. */
  onShowInFolder?: () => void;
}) {
  const input = toPreviewInput(props.record);
  const resolution = resolvePreviewKind(input);
  if (resolution.kind === 'image') {
    return <ImageArtifactPreview record={props.record} input={input} onShowInFolder={props.onShowInFolder} />;
  }
  return (
    <UnsupportedArtifactPreview
      input={input}
      reason={resolution.reason}
      onShowInFolder={props.onShowInFolder}
    />
  );
}

/**
 * Reason → user-facing copy. Keyed by `PreviewResolution.reason`
 * (the unsupported variant only). Adding a new reason variant in
 * the registry pure module forces TypeScript exhaustiveness here.
 */
function describeUnsupportedReason(
  reason: Extract<PreviewResolution, { kind: 'unsupported' }>['reason'],
): { title: string; description: string } {
  switch (reason) {
    case 'kind_disallowed':
      return {
        title: '当前预览暂不支持该类型',
        description: '此类 artifact 还没在内联预览注册表中实现。请使用工具栏「在 Finder 中打开」查看。',
      };
    case 'mime_disallowed':
      return {
        title: '格式暂不支持预览',
        description: '已识别到 artifact 的 MIME 类型，但当前注册表只支持 PNG / JPEG / GIF / WebP / AVIF。',
      };
    case 'no_mime_no_ext':
      return {
        title: '无法识别 artifact 类型',
        description: '文件没有 MIME 元数据，扩展名也未匹配。请通过工具栏「在 Finder 中打开」查看。',
      };
    case 'oversize':
      return {
        title: '文件过大，暂不预览',
        description: '为避免在内存中加载大体积图片，超过 2 MB 的 artifact 不在此处展开预览。',
      };
    default: {
      const _exhaustive: never = reason;
      return { title: '暂不支持的预览', description: String(_exhaustive) };
    }
  }
}

/**
 * Renders metadata + reason text. NEVER renders `relativePath` or
 * any absolute path (the input shape doesn't even carry path data).
 */
export function UnsupportedArtifactPreview(props: {
  input: ArtifactPreviewInput;
  reason: Extract<PreviewResolution, { kind: 'unsupported' }>['reason'];
  onShowInFolder?: () => void;
}) {
  const copy = describeUnsupportedReason(props.reason);
  return (
    <div className="maka-artifact-preview-unsupported" data-reason={props.reason} role="status">
      <div className="maka-artifact-preview-unsupported-title">{copy.title}</div>
      <p className="maka-artifact-preview-unsupported-body">{copy.description}</p>
      <dl className="maka-artifact-preview-unsupported-meta">
        <div>
          <dt>名称</dt>
          <dd>{props.input.name || '(未命名)'}</dd>
        </div>
        {props.input.mimeType && (
          <div>
            <dt>类型</dt>
            <dd>{props.input.mimeType}</dd>
          </div>
        )}
        <div>
          <dt>大小</dt>
          <dd>{formatPreviewSize(props.input.sizeBytes)}</dd>
        </div>
      </dl>
      {/* @kenji review @msg 9cf1ca7a — only render the button when a
          real handler is provided. We deliberately do NOT render a
          disabled button here: a disabled button suggests the action
          is available "eventually", which is misleading for surfaces
          that have no path-open IPC. */}
      {props.onShowInFolder && (
        <button
          type="button"
          className="maka-button maka-button-secondary maka-artifact-preview-unsupported-cta"
          onClick={props.onShowInFolder}
        >
          在 Finder 中打开
        </button>
      )}
    </div>
  );
}

/**
 * Loads the image via existing `readBinary` IPC, enforces L2 base64
 * length cap before any decode, and renders inside a bounded
 * container with `object-fit: contain` so an unexpectedly large
 * intrinsic size can't break the chat / pane layout.
 */
function ImageArtifactPreview(props: {
  record: ArtifactRecord;
  input: ArtifactPreviewInput;
  onShowInFolder?: () => void;
}) {
  const result = useBinaryRead(props.record.id);
  if (result.state === 'loading') {
    return (
      <div className="maka-artifact-preview-loading" role="status" aria-live="polite">
        <span className="maka-artifact-preview-spinner" aria-hidden="true" />
        <span>加载图片预览…</span>
      </div>
    );
  }
  if (!result.value.ok) {
    // Read failed — pass through to Unsupported with the closest
    // matching reason. `read_failed` / `not_found` / `not_allowed`
    // collapse to `kind_disallowed` here because they're not
    // really registry classification failures, they're IPC
    // failures. We don't add a separate reason for them in this
    // PR; future PR can add `load_failed` if needed.
    return (
      <UnsupportedArtifactPreview
        input={props.input}
        reason="kind_disallowed"
        onShowInFolder={props.onShowInFolder}
      />
    );
  }
  // L2 cap check — fail closed if main returned a payload past the
  // policy cap even though resolver thought sizeBytes was within
  // limits (or sizeBytes was undefined at resolve time).
  if (exceedsImagePayloadCap(result.value.base64)) {
    return (
      <UnsupportedArtifactPreview
        input={props.input}
        reason="oversize"
        onShowInFolder={props.onShowInFolder}
      />
    );
  }
  return (
    <div className="maka-artifact-preview-image">
      <img
        alt={props.record.name}
        src={`data:${result.value.mimeType};base64,${result.value.base64}`}
      />
    </div>
  );
}

function toPreviewInput(record: ArtifactRecord): ArtifactPreviewInput {
  return {
    name: record.name,
    kind: record.kind,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
  };
}

type BinaryReadState =
  | { state: 'loading' }
  | { state: 'done'; value: ArtifactBinaryReadResult };

function useBinaryRead(artifactId: string): BinaryReadState {
  const [state, setState] = useState<BinaryReadState>({ state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ state: 'loading' });
    void (async () => {
      try {
        const value = await window.maka.artifacts.readBinary(artifactId);
        if (!cancelled) setState({ state: 'done', value });
      } catch {
        if (!cancelled) {
          setState({
            state: 'done',
            value: { ok: false, reason: 'read_failed' },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifactId]);
  return state;
}
