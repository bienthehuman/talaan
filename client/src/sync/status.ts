/** Sync status shown in the header. STUB until the sync engine lands in phase 2: there is no outbox
 *  yet, so nothing can be pending and nothing has ever synced. The shape is the real one. */
export interface SyncStatus {
  pending: number;
  lastSyncAt: Date | null;
}

export function useSyncStatus(): SyncStatus {
  return { pending: 0, lastSyncAt: null };
}
