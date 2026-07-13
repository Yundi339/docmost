// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

function createEditor(initialEditable: boolean) {
  let editable = initialEditable;
  const listeners = new Set<() => void>();

  return {
    get isEditable() {
      return editable;
    },
    on(event: string, listener: () => void) {
      if (event === "update") listeners.add(listener);
    },
    off(event: string, listener: () => void) {
      if (event === "update") listeners.delete(listener);
    },
    setEditable(nextEditable: boolean) {
      editable = nextEditable;
      listeners.forEach((listener) => listener());
    },
  };
}

function renderView(
  attrs: Record<string, unknown> = {
    language: "typescript",
    title: null,
    wrap: false,
  },
  editable = true,
) {
  const updateAttributes = vi.fn();
  const editor = createEditor(editable);
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
          editor,
        } as any)}
      />
    </MantineProvider>,
  );
  return { editor, updateAttributes };
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

  it("reacts when the mounted editor switches between edit and read mode", () => {
    const { editor } = renderView();
    expect(
      screen.getByRole("textbox", { name: "Code block title" }),
    ).not.toBeNull();

    act(() => editor.setEditable(false));
    expect(
      screen.queryByRole("textbox", { name: "Code block title" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Download code" }),
    ).not.toBeNull();

    act(() => editor.setEditable(true));
    expect(
      screen.getByRole("textbox", { name: "Code block title" }),
    ).not.toBeNull();
  });

  it("collapses Mermaid source when entering read mode", () => {
    const { editor } = renderView({
      language: "mermaid",
      title: null,
      wrap: false,
    });
    const source = document.querySelector("pre");

    fireEvent.click(screen.getByRole("button", { name: "Show source" }));
    expect(source?.hasAttribute("hidden")).toBe(false);

    act(() => editor.setEditable(false));
    expect(source?.hasAttribute("hidden")).toBe(true);
    expect(screen.queryByRole("button", { name: "Show source" })).toBeNull();
  });

  it("shows a saved title as text instead of an input in read mode", () => {
    renderView(
      { language: "typescript", title: "Example title", wrap: false },
      false,
    );

    expect(screen.getByText("Example title")).not.toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Code block title" }),
    ).toBeNull();
  });
});
