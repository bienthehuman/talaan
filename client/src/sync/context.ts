import { createContext } from "react";
import type { TalaanDb } from "../db";
import type { SyncEngine } from "./engine";

export type EngineHandle = Pick<SyncEngine, "getStatus" | "subscribe" | "syncNow" | "resume"> & {
  db: TalaanDb;
};

export const SyncContext = createContext<EngineHandle | null>(null);
