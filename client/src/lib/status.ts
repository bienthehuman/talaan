import type { SubmissionStatus } from "../db/types";

/** How a record's status reads on screen, in sentence case. The API and the device store the raw value. */
const LABELS: Record<SubmissionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  returned: "Returned",
};

export function statusLabel(status: SubmissionStatus): string {
  return LABELS[status];
}
