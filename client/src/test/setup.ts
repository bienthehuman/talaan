import "@testing-library/jest-dom/vitest";
import { clearSession } from "../auth/session";

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

beforeEach(() => {
  localStorage.clear();
  clearSession();
  document.documentElement.removeAttribute("data-theme");
  document.title = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
