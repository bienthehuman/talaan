import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getSession } from "../auth/session";
import { expectNoA11yViolations, json, mockFetch, renderApp, signIn, WORKER } from "../test/utils";

const ME = { id: 2, username: "worker1", role: "worker", permissions: ["submission.edit"] };

async function fillAndSubmit(username: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Username"), username);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginPage", () => {
  it("renders labelled fields, a page title and passes the structural a11y check", async () => {
    const { container } = renderApp("/login");
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(document.title).toBe("Sign in · Talaan");
    await expectNoA11yViolations(container);
  });

  it("shows and hides the password", async () => {
    renderApp("/login");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("asks for both fields without calling the server", async () => {
    const fetch = mockFetch(() => json({}));
    renderApp("/login");
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your username and password.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("signs in, stores the session and lands on the assignments page", async () => {
    mockFetch((req) => {
      const path = new URL(req.url).pathname;
      if (path === "/api/auth/token/") return json({ access: "a-token", refresh: "r-token" });
      if (path === "/api/me/") {
        expect(req.headers.get("Authorization")).toBe("Bearer a-token");
        return json(ME);
      }
      return json({}, 404);
    });
    renderApp("/login");
    await fillAndSubmit("worker1", "pw");
    expect(await screen.findByRole("heading", { name: "Assignments" })).toBeInTheDocument();
    expect(getSession()).toMatchObject({ access: "a-token", refresh: "r-token", user: ME });
    expect(screen.getByText(WORKER.username)).toBeInTheDocument();
  });

  it("explains wrong credentials and keeps the user on the form", async () => {
    mockFetch(() =>
      json({ status: 401, code: "unauthenticated", detail: "No active account." }, 401),
    );
    renderApp("/login");
    await fillAndSubmit("worker1", "nope");
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong username or password.");
    expect(getSession()).toBeNull();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("tells a rate-limited user how long to wait", async () => {
    mockFetch(() => json({ status: 429, code: "rate_limited", retry_after: 30 }, 429));
    renderApp("/login");
    await fillAndSubmit("worker1", "pw");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in 30 seconds.",
    );
  });

  it("explains an unreachable server and does not store anything", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    renderApp("/login");
    await fillAndSubmit("worker1", "pw");
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
    expect(getSession()).toBeNull();
  });

  it("clears the half-made session if loading the profile fails", async () => {
    mockFetch((req) =>
      new URL(req.url).pathname === "/api/auth/token/"
        ? json({ access: "a", refresh: "r" })
        : json({ status: 500, code: "server_error" }, 500),
    );
    renderApp("/login");
    await fillAndSubmit("worker1", "pw");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(getSession()).toBeNull();
  });

  it("sends a signed-in user straight to the start page", () => {
    signIn();
    renderApp("/login");
    expect(screen.getByRole("heading", { name: "Assignments" })).toBeInTheDocument();
  });
});
