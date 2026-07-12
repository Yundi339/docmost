// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChangeEmail from "./change-email";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import {
  confirmEmailChange,
  requestEmailChange,
} from "@/features/user/services/user-service.ts";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));

vi.mock("@/features/user/services/user-service.ts", () => ({
  requestEmailChange: vi.fn(),
  confirmEmailChange: vi.fn(),
}));

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe("ChangeEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requests confirmation instead of changing the email directly", async () => {
    vi.mocked(requestEmailChange).mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    renderComponent();

    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    fireEvent.change(await screen.findByLabelText("Current password"), {
      target: { value: "current-password" },
    });
    fireEvent.change(screen.getByLabelText("New email"), {
      target: { value: "new@example.test" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Send confirmation link" }),
    );

    await waitFor(() =>
      expect(requestEmailChange).toHaveBeenCalledWith({
        email: "new@example.test",
        password: "current-password",
      }),
    );
  });

  it("requires an explicit click before consuming a link token", async () => {
    window.sessionStorage.setItem("emailChangeToken", "a".repeat(43));
    vi.mocked(confirmEmailChange).mockResolvedValue({
      email: "new@example.test",
    });
    renderComponent(false, "/settings/account/profile?confirmEmailChange=1");

    expect(confirmEmailChange).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm email change" }),
    );

    await waitFor(() =>
      expect(confirmEmailChange).toHaveBeenCalledWith("a".repeat(43)),
    );
    expect(await screen.findByText("new@example.test")).not.toBeNull();
  });

  it("disables local email changes when SSO is enforced", () => {
    renderComponent(true);

    expect(
      screen
        .getByRole("button", { name: "Change email" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByText("Email changes are unavailable while SSO is enforced."),
    ).not.toBeNull();
  });
});

function renderComponent(
  enforceSso = false,
  route = "/settings/account/profile",
) {
  const store = createStore();
  store.set(currentUserAtom, {
    user: {
      id: "user-id",
      email: "old@example.test",
      name: "Test User",
      emailVerifiedAt: new Date(),
      workspaceId: "workspace-id",
    } as any,
    workspace: {
      id: "workspace-id",
      enforceSso,
    } as any,
  });

  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[route]}>
        <MantineProvider>
          <ChangeEmail />
        </MantineProvider>
      </MemoryRouter>
    </Provider>,
  );
}
