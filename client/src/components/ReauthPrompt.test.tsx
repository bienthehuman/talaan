import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthContext";
import { getSession } from "../auth/session";
import { expectNoA11yViolations, json, mockFetch, signIn, WORKER } from "../test/utils";
import { ReauthPrompt } from "./ReauthPrompt";

function setup(handler: (request: Request) => Response) {
  signIn();
  mockFetch(handler);
  const onSignedIn = vi.fn();
  const view = render(
    <AuthProvider>
      <ReauthPrompt onSignedIn={onSignedIn} />
    </AuthProvider>,
  );
  return { onSignedIn, ...view };
}

const me = (id: number) => ({ ...WORKER, id });
const server = (meId: number) => (request: Request) =>
  new URL(request.url).pathname === "/api/me/"
    ? json(me(meId))
    : json({ access: "new-access", refresh: "new-refresh" });

async function submit(password: string) {
  const user = userEvent.setup();
  if (password) await user.type(screen.getByLabelText("Password", { exact: true }), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("ReauthPrompt", () => {
  it("says the changes are safe and has no structural a11y problems", async () => {
    const { container } = setup(server(2));
    expect(screen.getByText(/Your work is safe on this device/)).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("signs the same person in again, keeps nothing stale, and tells the engine to resume", async () => {
    const { onSignedIn } = setup(server(2));
    await submit("secret-pw");
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(getSession()).toMatchObject({ access: "new-access", refresh: "new-refresh" });
  });

  it("refuses to swap in a different person's session", async () => {
    const { onSignedIn } = setup(server(99));
    await submit("secret-pw");
    expect(await screen.findByText("Sign in as worker1.")).toBeInTheDocument();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(getSession()?.access).toBe("access-token");
  });

  it("explains a wrong password and stays", async () => {
    const { onSignedIn } = setup(() => json({ code: "unauthenticated" }, 401));
    await submit("wrong");
    expect(await screen.findByText("Wrong username or password.")).toBeInTheDocument();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("asks for a password before trying", async () => {
    const { onSignedIn } = setup(server(2));
    await submit("");
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});
