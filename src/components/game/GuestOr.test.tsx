import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let status: "anonymous" | "restoring" | "authenticated" = "anonymous";

vi.mock("@/lib/auth/session", () => ({
  useAuth: () =>
    status === "authenticated" ? { status, session: { userId: "u1", role: "user" } } : { status },
}));

const { GuestOr } = await import("./GuestOr");

afterEach(() => {
  status = "anonymous";
});

describe("GuestOr", () => {
  it("calls a signed-out player's run a guest run", () => {
    render(<GuestOr signedIn="Unranked run">Guest run</GuestOr>);
    expect(screen.getByText("Guest run")).toBeInTheDocument();
  });

  it("never calls a signed-in player's unranked run a guest run", () => {
    status = "authenticated";
    render(<GuestOr signedIn="Unranked run">Guest run</GuestOr>);
    expect(screen.getByText("Unranked run")).toBeInTheDocument();
    expect(screen.queryByText("Guest run")).toBeNull();
  });

  it("stays neutral while a saved session is being restored", () => {
    status = "restoring";
    render(<GuestOr signedIn="Unranked run">Guest run</GuestOr>);
    expect(screen.queryByText("Guest run")).toBeNull();
  });
});
