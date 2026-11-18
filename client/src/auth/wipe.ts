import { deleteDbFor } from "../db";
import { stopEngineFor } from "../sync/engine";

let pending: Promise<void> = Promise.resolve();

/** Sign-out: stop this person's sync, then delete their local database. Runs one after another, and
 *  `whenWiped` lets the next sign-in wait, so a quick sign-in never has its new data deleted. */
export function wipeUser(userId: number): Promise<void> {
  pending = pending
    .then(() => stopEngineFor(userId))
    .then(() => deleteDbFor(userId))
    .catch(() => undefined);
  return pending;
}

export function whenWiped(): Promise<void> {
  return pending;
}
