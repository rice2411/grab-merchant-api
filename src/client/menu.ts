import { FOOD } from '../constants';
import type { GrabCaller } from './http';

export function fetchMenu<T>(api: GrabCaller): Promise<T | null> {
  return api.call<T>(`${FOOD}/v2/menu`);
}

export async function putItemsAvailable(api: GrabCaller, itemIDs: string[], availableStatus: 1 | 2 | 3): Promise<void> {
  if (itemIDs.length === 0) return;
  await api.call(`${FOOD}/v1/items/available-status`, { method: 'PUT', body: { itemIDs, availableStatus } });
}

export async function putModifiersAvailable(
  api: GrabCaller,
  modifierIDs: string[],
  availableStatus: 1 | 2,
): Promise<void> {
  if (modifierIDs.length === 0) return;
  await api.call(`${FOOD}/v2/modifiers/available`, { method: 'PUT', body: { availableStatus, modifierIDs } });
}
