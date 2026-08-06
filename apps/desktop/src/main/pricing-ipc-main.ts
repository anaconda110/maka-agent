import type { IpcMain } from 'electron';
import { tryResult } from '@maka/core/result';
import type { PricingMutation } from '@maka/runtime-host/protocol';
import type { PricingPort } from './pricing-port.js';

export interface PricingIpcDeps {
  readonly ipcMain: Pick<IpcMain, 'handle'>;
  readonly port: PricingPort;
  readonly sendToRenderer: (channel: string, ...args: unknown[]) => void;
}

export function registerPricingIpc(deps: PricingIpcDeps): void {
  let queue: Promise<void> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  deps.ipcMain.handle('pricing:query', () =>
    tryResult(() => deps.port.query(), 'PRICING_QUERY_FAILED'),
  );
  deps.ipcMain.handle('pricing:mutate', (_event, input: { expectedRevision: number; mutation: PricingMutation }) =>
    tryResult(
      () =>
        enqueue(async () => {
          const result = await deps.port.mutate(input);
          if (result.kind !== 'revision_conflict') deps.sendToRenderer('pricing:changed');
          return result;
        }),
      'PRICING_MUTATE_FAILED',
    ),
  );
}
