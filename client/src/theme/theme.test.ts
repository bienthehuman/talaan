import { applyTheme, getStoredTheme, nextTheme } from "./theme";

describe("theme", () => {
  it("applies and remembers an explicit choice", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(getStoredTheme()).toBe("dark");
  });

  it("system removes the attribute so prefers-color-scheme decides", () => {
    applyTheme("light");
    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(getStoredTheme()).toBe("system");
  });

  it("cycles system, light, dark", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });

  it("still applies the theme when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => applyTheme("dark")).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(getStoredTheme()).toBe("system");
  });
});
