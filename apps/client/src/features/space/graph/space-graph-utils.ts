import {
  SpaceGraphEdge,
  SpaceGraphNode,
} from "@/features/space/types/space.types";

export type GraphConnectionFilter = "all" | "connected" | "unlinked";

export type GraphNodeStats = {
  incoming: number;
  outgoing: number;
};

export function buildGraphNodeStats(
  nodes: SpaceGraphNode[],
  edges: SpaceGraphEdge[],
): Map<string, GraphNodeStats> {
  const stats = new Map(
    nodes.map((node) => [node.id, { incoming: 0, outgoing: 0 }]),
  );

  for (const edge of edges) {
    const source = stats.get(edge.sourcePageId);
    const target = stats.get(edge.targetPageId);
    if (source && target) {
      source.outgoing += 1;
      target.incoming += 1;
    }
  }

  return stats;
}

export function filterGraph(
  nodes: SpaceGraphNode[],
  edges: SpaceGraphEdge[],
  filter: GraphConnectionFilter,
) {
  const stats = buildGraphNodeStats(nodes, edges);
  const filteredNodes = nodes.filter((node) => {
    const nodeStats = stats.get(node.id) ?? { incoming: 0, outgoing: 0 };
    const linked = nodeStats.incoming + nodeStats.outgoing > 0;
    if (filter === "connected") return linked;
    if (filter === "unlinked") return !linked;
    return true;
  });
  const visibleIds = new Set(filteredNodes.map((node) => node.id));

  return {
    nodes: filteredNodes,
    edges: edges.filter(
      (edge) =>
        visibleIds.has(edge.sourcePageId) && visibleIds.has(edge.targetPageId),
    ),
    stats,
  };
}
