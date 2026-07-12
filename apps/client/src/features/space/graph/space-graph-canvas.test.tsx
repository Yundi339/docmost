// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SpaceGraphCanvas from "./space-graph-canvas";

const cytoscapeMock = vi.hoisted(() => vi.fn());

vi.mock("cytoscape", () => ({ default: cytoscapeMock }));

const node = {
  id: "page-id",
  slugId: "page-slug",
  title: "Page",
  icon: null,
  parentPageId: null,
  updatedAt: new Date().toISOString(),
  distance: null,
};

function mockPointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(any-pointer: coarse)" && coarse,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderCanvas() {
  render(
    <SpaceGraphCanvas
      nodes={[node]}
      edges={[]}
      selectedId={null}
      centerPageId={node.id}
      layout="grid"
      ariaLabel="Relationship graph"
      onSelect={vi.fn()}
    />,
  );
}

describe("SpaceGraphCanvas input adaptation", () => {
  beforeEach(() => {
    cytoscapeMock.mockReturnValue({
      on: vi.fn(),
      destroy: vi.fn(),
      $: vi.fn().mockReturnValue({ unselect: vi.fn() }),
      $id: vi.fn().mockReturnValue({ select: vi.fn() }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses larger fixed nodes and disables dragging for coarse pointers", async () => {
    mockPointer(true);
    renderCanvas();

    await waitFor(() => expect(cytoscapeMock).toHaveBeenCalledOnce());
    const options = cytoscapeMock.mock.calls[0][0];
    const nodeStyle = options.style.find(
      (entry: { selector: string }) => entry.selector === "node",
    );
    const centerStyle = options.style.find(
      (entry: { selector: string }) => entry.selector === "node[?centered]",
    );

    expect(nodeStyle.style).toMatchObject({ height: 40, width: 40 });
    expect(centerStyle.style).toMatchObject({ height: 48, width: 48 });
    expect(options).toMatchObject({
      autoungrabify: true,
      boxSelectionEnabled: false,
      selectionType: "single",
    });
    expect(options).not.toHaveProperty("wheelSensitivity");
  });

  it("keeps the denser node size and dragging for precise pointers", async () => {
    mockPointer(false);
    renderCanvas();

    await waitFor(() => expect(cytoscapeMock).toHaveBeenCalledOnce());
    const options = cytoscapeMock.mock.calls[0][0];
    const nodeStyle = options.style.find(
      (entry: { selector: string }) => entry.selector === "node",
    );

    expect(nodeStyle.style).toMatchObject({ height: 28, width: 28 });
    expect(options.autoungrabify).toBe(false);
  });
});
