import { describe, expect, it } from "vitest";
import { buildGraphNodeStats, filterGraph } from "./space-graph-utils";

const nodes = ["a", "b", "c"].map((id) => ({ id })) as any;
const edges = [{ id: "ab", sourcePageId: "a", targetPageId: "b" }] as any;

describe("space graph utilities", () => {
  it("counts incoming and outgoing links independently", () => {
    const stats = buildGraphNodeStats(nodes, edges);
    expect(stats.get("a")).toEqual({ incoming: 0, outgoing: 1 });
    expect(stats.get("b")).toEqual({ incoming: 1, outgoing: 0 });
    expect(stats.get("c")).toEqual({ incoming: 0, outgoing: 0 });
  });

  it("keeps edges only when both filtered endpoints remain visible", () => {
    expect(filterGraph(nodes, edges, "connected")).toMatchObject({
      nodes: [{ id: "a" }, { id: "b" }],
      edges,
    });
    expect(filterGraph(nodes, edges, "unlinked")).toMatchObject({
      nodes: [{ id: "c" }],
      edges: [],
    });
  });
});
