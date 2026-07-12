// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forwardRef } from "react";
import CodeBlockView from "./code-block-view";
import { downloadCodeBlock } from "./code-block-download";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: forwardRef<HTMLDivElement, any>(
    ({ children, ...props }, ref) => (
      <div ref={ref} {...props}>
        {children}
      </div>
    ),
  ),
  NodeViewContent: ({ as: Component = "div", ...props }: any) => (
    <Component {...props} />
  ),
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

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock("./mermaid-view.tsx", () => ({
  default: () => <div data-testid="mermaid-preview" />,
}));

vi.mock("./code-block-download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./code-block-download")>();
  return { ...actual, downloadCodeBlock: vi.fn() };
});

function renderView(
  attrs: Record<string, unknown> = {
    language: "typescript",
    title: null,
    wrap: false,
  },
  editable = true,
) {
  const updateAttributes = vi.fn();
  render(
    <MantineProvider>
      <CodeBlockView
        {...({
          node: { attrs, textContent: "const value = 1;" },
          updateAttributes,
          extension: {
            options: {
              lowlight: { listLanguages: () => ["typescript", "mermaid"] },
            },
          },
          editor: { isEditable: editable },
        } as any)}
      />
    </MantineProvider>,
  );
  return { updateAttributes };
}

describe("CodeBlockView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("edits a normalized title and toggles visual wrapping", () => {
    const { updateAttributes } = renderView();
    const title = screen.getByRole("textbox", { name: "Code block title" });

    fireEvent.change(title, { target: { value: "  Server\n example  " } });
    fireEvent.blur(title);
    expect(updateAttributes).toHaveBeenCalledWith({
      title: "Server example",
    });

    fireEvent.click(screen.getByRole("button", { name: "Wrap lines" }));
    expect(updateAttributes).toHaveBeenCalledWith({ wrap: true });
  });

  it("commits Enter once and cancels title edits with Escape", () => {
    const { updateAttributes } = renderView({
      language: "typescript",
      title: "Original",
      wrap: false,
    });
    const title = screen.getByRole("textbox", { name: "Code block title" });

    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: "Updated" } });
    fireEvent.keyDown(title, { key: "Enter" });
    fireEvent.blur(title);
    expect(updateAttributes).toHaveBeenCalledTimes(1);
    expect(updateAttributes).toHaveBeenCalledWith({ title: "Updated" });

    updateAttributes.mockClear();
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: "Cancelled" } });
    fireEvent.keyDown(title, { key: "Escape" });
    fireEvent.blur(title);
    expect(updateAttributes).not.toHaveBeenCalled();
    expect((title as HTMLInputElement).value).toBe("Original");
  });

  it("downloads the current editable title without waiting for blur", () => {
    renderView();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Code block title" }),
      { target: { value: "example" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Download code" }));

    expect(downloadCodeBlock).toHaveBeenCalledWith(
      "const value = 1;",
      "example",
      "typescript",
    );
  });

  it("keeps Mermaid source hidden until the existing source toggle is used", async () => {
    renderView({ language: "mermaid", title: null, wrap: false });
    const source = document.querySelector("pre");
    expect(source?.hasAttribute("hidden")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Show source" }));
    expect(source?.hasAttribute("hidden")).toBe(false);
    expect(await screen.findByTestId("mermaid-preview")).not.toBeNull();
  });

  it("keeps controls available without reserving a title row in read-only mode", () => {
    renderView(undefined, false);

    expect(
      screen.getByRole("button", { name: "Download code" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Code block title" }),
    ).toBeNull();
  });
});
