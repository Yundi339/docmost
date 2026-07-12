import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import cytoscape, { Core } from "cytoscape";
import {
  SpaceGraphEdge,
  SpaceGraphNode,
} from "@/features/space/types/space.types";
import classes from "./space-graph.module.css";

export type SpaceGraphCanvasApi = {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

type Props = {
  nodes: SpaceGraphNode[];
  edges: SpaceGraphEdge[];
  selectedId: string | null;
  centerPageId?: string;
  layout: "force" | "grid";
  ariaLabel: string;
  onSelect: (pageId: string) => void;
};

const SpaceGraphCanvas = forwardRef<SpaceGraphCanvasApi, Props>(
  (
    { nodes, edges, selectedId, centerPageId, layout, ariaLabel, onSelect },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const graphRef = useRef<Core | null>(null);
    const selectRef = useRef(onSelect);
    selectRef.current = onSelect;

    useImperativeHandle(ref, () => ({
      fit: () => graphRef.current?.fit(undefined, 36),
      zoomIn: () => {
        const graph = graphRef.current;
        if (graph) graph.zoom(graph.zoom() * 1.2);
      },
      zoomOut: () => {
        const graph = graphRef.current;
        if (graph) graph.zoom(graph.zoom() / 1.2);
      },
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const graph = cytoscape({
        container: containerRef.current,
        elements: [
          ...nodes.map((node) => ({
            data: {
              id: node.id,
              label: node.title || "Untitled",
              centered: node.id === centerPageId,
            },
          })),
          ...edges.map((edge) => ({
            data: {
              id: edge.id,
              source: edge.sourcePageId,
              target: edge.targetPageId,
            },
          })),
        ],
        style: [
          {
            selector: "node",
            style: {
              "background-color": "#ffffff",
              "border-color": "#868e96",
              "border-width": 1.5,
              color: "#212529",
              label: "data(label)",
              "font-size": 11,
              "text-max-width": "120px",
              "text-wrap": "ellipsis",
              "text-valign": "bottom",
              "text-margin-y": 8,
              height: 28,
              width: 28,
            },
          },
          {
            selector: "node[?centered]",
            style: {
              "background-color": "#2f9e44",
              "border-color": "#2b8a3e",
              color: "#1b4332",
              height: 36,
              width: 36,
            },
          },
          {
            selector: "node:selected",
            style: {
              "background-color": "#1971c2",
              "border-color": "#1864ab",
              color: "#0b3d66",
              height: 36,
              width: 36,
            },
          },
          {
            selector: "edge",
            style: {
              "curve-style": "bezier",
              "line-color": "#adb5bd",
              "target-arrow-color": "#868e96",
              "target-arrow-shape": "triangle",
              "arrow-scale": 0.7,
              opacity: 0.75,
              width: 1.2,
            },
          },
        ],
        layout:
          layout === "force"
            ? {
                name: "cose",
                animate: false,
                randomize: true,
                nodeRepulsion: () => 5000,
                idealEdgeLength: () => 90,
                numIter: 500,
              }
            : { name: "grid", animate: false, avoidOverlap: true },
        minZoom: 0.2,
        maxZoom: 2.5,
      });

      graph.on("tap", "node", (event) => {
        selectRef.current(event.target.id());
      });
      graphRef.current = graph;

      return () => {
        graph.destroy();
        graphRef.current = null;
      };
    }, [centerPageId, edges, layout, nodes]);

    useEffect(() => {
      const graph = graphRef.current;
      if (!graph) return;
      graph.$(":selected").unselect();
      if (selectedId) graph.$id(selectedId).select();
    }, [selectedId]);

    return (
      <div
        ref={containerRef}
        className={classes.canvas}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
      />
    );
  },
);

SpaceGraphCanvas.displayName = "SpaceGraphCanvas";

export default SpaceGraphCanvas;
