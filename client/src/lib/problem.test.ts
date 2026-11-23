import { ApiError, messageFor, NetworkError, toProblem } from "./problem";

describe("toProblem", () => {
  it("keeps a problem+json body and adds the status", () => {
    expect(toProblem({ code: "rate_limited", retry_after: 12 }, 429)).toMatchObject({
      status: 429,
      code: "rate_limited",
      retry_after: 12,
    });
  });

  it("falls back to a generic code for a body that is not a problem", () => {
    expect(toProblem("<html>Bad gateway</html>", 502).code).toBe("server_error");
    expect(toProblem(undefined, 400).code).toBe("error");
  });
});

describe("messageFor", () => {
  it("explains a network failure", () => {
    expect(messageFor(new NetworkError())).toBe(
      "Can't connect. Check your signal or internet connection and try again.",
    );
  });

  it("says wrong credentials only in the login context", () => {
    const err = new ApiError({ status: 401, code: "unauthenticated" });
    expect(messageFor(err, "login")).toBe("Wrong username or password.");
    expect(messageFor(err)).toBe("Something went wrong. Try again.");
  });

  it("tells the user how long to wait when rate limited", () => {
    const err = new ApiError({ status: 429, code: "rate_limited", retry_after: 30 });
    expect(messageFor(err, "login")).toBe("Too many attempts. Try again in 30 seconds.");
    const one = new ApiError({ status: 429, code: "rate_limited", retry_after: 1 });
    expect(messageFor(one)).toBe("Too many attempts. Try again in 1 second.");
  });

  it("does not leak server details for 5xx", () => {
    const err = new ApiError({ status: 500, code: "server_error", detail: "stack trace" });
    expect(messageFor(err)).toBe("Something went wrong on our side. Try again in a moment.");
  });
});
