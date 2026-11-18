/** Local stores (docs/DATA_MODEL.md section 2). One IndexedDB database per user, so one person's
 *  data is never visible to another who signs in on the same device. */

export type FieldValue = string | number | boolean | null;
export type RecordData = Record<string, string | number | boolean>;

export type SubmissionStatus = "draft" | "submitted" | "approved" | "returned";
/** `pending` = "Saved on this device". `synced` = confirmed by the server. They must never look alike. */
export type SyncState = "pending" | "synced" | "conflict" | "rejected";

/** The server's last confirmed copy of a record. */
export interface Shadow {
  data: RecordData;
  status: SubmissionStatus;
  version: number;
  fieldVersions: Record<string, number>;
  deleted: boolean;
}

export interface LocalSubmission {
  id: string;
  assignmentId: number;
  formVersionId: number;
  /** What the user sees: the shadow plus every unsent edit. */
  data: RecordData;
  status: SubmissionStatus;
  deleted: boolean;
  /** Last version the server confirmed. 0 until the create is applied. */
  serverVersion: number;
  fieldVersions: Record<string, number>;
  shadow: Shadow | null;
  syncState: SyncState;
  /** Why the record is in `conflict` or `rejected` (filled by the engine). */
  syncDetail?: string;
  /** The server's conflict report, kept for the resolution screen (phase 3). */
  conflict?: ConflictInfo;
  updatedAt: number;
}

export interface ConflictInfo {
  kind: "field_conflict" | "deleted_remotely" | "edited_since_base";
  fields: {
    field: string;
    server_value?: FieldValue;
    client_value?: FieldValue;
    server_version?: number;
  }[];
}

export type OutboxOp = "create" | "update" | "submit" | "delete";

export interface OutboxEntry {
  seq?: number;
  mutationId: string;
  recordId: string;
  op: OutboxOp;
  fields: Record<string, FieldValue>;
  /** For an update: what each changed field held before this entry's first edit (`null` = not set).
   *  Only used to show the starting value on the conflict screen; never sent. */
  before?: Record<string, FieldValue>;
  baseVersion: number;
  assignmentId?: number;
  /** Set when the entry is first sent. From then on it is frozen: a retry resends it unchanged. */
  sentAt: number | null;
  attempts: number;
  lastError: string | null;
}

export type MetaValue = string | number | null;
export interface MetaRow {
  key: string;
  value: MetaValue;
}
