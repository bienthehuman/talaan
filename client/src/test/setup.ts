import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import Dexie from "dexie";
import { clearSession } from "../auth/session";
import { closeAll } from "../db";

// jsdom versions differ on <dialog>; make showModal/close behave enough for tests.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
}

// axe probes canvas for colour checks, which jsdom cannot do (contrast is covered in Playwright).
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;

// IndexedDB work is asynchronous; a loaded CI machine needs more than the 1 s default.
configure({ asyncUtilTimeout: 4000 });

beforeEach(() => {
  // A fresh, empty IndexedDB for every test. Dexie keeps its own reference, so repoint it too.
  globalThis.indexedDB = new IDBFactory();
  Dexie.dependencies.indexedDB = globalThis.indexedDB;
  localStorage.clear();
  clearSession();
  document.documentElement.removeAttribute("data-theme");
  document.title = "";
});

afterEach(() => {
  closeAll(); // cached Dexie instances belong to this test's IndexedDB
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
