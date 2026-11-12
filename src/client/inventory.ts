import { DELV, TIMEOUT_MS } from '../constants';
import { GrabError } from '../errors';
import type { GrabCaller } from './http';

/** Current inventory export (CSV with 3 header rows). */
export async function exportInventory(api: GrabCaller): Promise<string> {
  type Cat = { categoryID?: string; id?: string };
  const cats = await api.call<Cat[] | { categories?: Cat[] }>(
    `${DELV}/v1/inventory/categories?categoryName=&menuGroupID=`,
  );
  const list = Array.isArray(cats) ? cats : (cats?.categories ?? []);
  const categoryIDs = list.map((c) => c.categoryID ?? c.id).filter(Boolean);
  const exp = await api.call<{ downloadUrl?: string }>(`${DELV}/v1/inventory/categories/export`, {
    method: 'POST',
    body: { categoryIDs, menuGroupID: '', itemStatus: '' },
  });
  if (!exp?.downloadUrl) throw new GrabError('BAD_RESPONSE', 'Grab did not return an inventory download link.');
  // Presigned URL → fetch it BARE, without auth headers (S3 rejects them).
  const res = await fetch(exp.downloadUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new GrabError('HTTP_ERROR', `Grab inventory download failed: HTTP ${res.status}`, res.status);
  return res.text();
}

/** Bulk inventory import — three steps in the same order as the portal. Returns the `taskID`. */
export async function uploadInventory(
  api: GrabCaller,
  csv: string,
  fileName: string,
  merchantGroupID: string,
): Promise<string> {
  // ⚠️ `uploadType` must match the portal's CamelCase exactly — otherwise Grab accepts the task but applies nothing.
  const task = await api.call<{
    presignedURL?: string;
    taskID?: string;
    headers?: { name?: string; value?: string }[];
  }>(`${DELV}/v1/bulktasks`, {
    method: 'POST',
    body: { fileName, uploadType: 'UpdateItemStock', merchantGroupID, menuGroupID: '' },
  });
  const { presignedURL, taskID } = task ?? {};
  if (!presignedURL || !taskID) throw new GrabError('BAD_RESPONSE', 'Grab did not provide an upload location.');
  const putHeaders: Record<string, string> = {};
  for (const h of task?.headers ?? []) if (h?.name) putHeaders[h.name] = h.value ?? '';
  const put = await fetch(presignedURL, {
    method: 'PUT',
    body: csv,
    headers: putHeaders,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!put.ok) throw new GrabError('HTTP_ERROR', `Grab file upload failed: HTTP ${put.status}`, put.status);
  await api.call(`${DELV}/v1/bulktasks/${encodeURIComponent(taskID)}/complete-uploading`, {
    method: 'PUT',
    body: { taskID, uploadType: 'UpdateItemStock', menuGroupID: '' },
  });
  return taskID;
}
