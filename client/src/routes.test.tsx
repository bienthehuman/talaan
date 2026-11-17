import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getSession } from "./auth/session";
import { expectNoA11yViolations, renderApp, signIn } from "./test/utils";

describe("routing", () => {
  it("sends an anonymous visitor to the sign-in page", () => {
    const { router } = renderApp("/");
    expect(router.state.location.pathname).toBe("/login");
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows the assignments page to a signed-in worker, with an empty state", async () => {
    signIn();
    const { container } = renderApp("/");
    expect(screen.getByRole("heading", { name: "Assignments" })).toBeInTheDocument();
    expect(screen.getByText("No assignments yet")).toBeInTheDocument();
    expect(document.title).toBe("Assignments · Talaan");
    await expectNoA11yViolations(container);
  });

  it("renders a 404 page inside the layout for unknown paths", async () => {
    const { container } = renderApp("/no/such/page");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to start" })).toHaveAttribute("href", "/");
    expect(document.title).toBe("Page not found · Talaan");
    expect(screen.getByRole("banner")).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("has a skip link and a main landmark", () => {
    renderApp("/login");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });

  it("serves the style guide in dev builds and it passes the structural a11y check", async () => {
    const { container } = renderApp("/styleguide");
    expect(screen.getByRole("heading", { name: "Style guide" })).toBeInTheDocument();
    for (const label of [
      "Saved on this device",
      "Synced",
      "Needs your decision",
      "Not accepted: approved",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    await expectNoA11yViolations(container);
  });
});

describe("layout", () => {
  it("warns when the browser goes offline and clears the warning when it returns", () => {
    renderApp("/login");
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(screen.getByText(/You're offline/)).toBeInTheDocument();

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
  });

  it("shows the stub sync status only when signed in", () => {
    const anonymous = renderApp("/login");
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
    anonymous.unmount();

    signIn();
    renderApp("/");
    expect(screen.getByText("0 pending · Last sync: never")).toBeInTheDocument();
  });

  it("signs out with no unsent changes straight away", async () => {
    signIn();
    renderApp("/");
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(getSession()).toBeNull();
  });

  it("cycles the theme and remembers it", async () => {
    renderApp("/login");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Theme: System" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    await user.click(screen.getByRole("button", { name: "Theme: Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("talaan.theme")).toBe("dark");
  });
});
