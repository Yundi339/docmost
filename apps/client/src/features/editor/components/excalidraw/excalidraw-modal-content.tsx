import "@excalidraw/excalidraw/index.css";
import {
  Excalidraw,
  useHandleLibrary,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import { localStorageLibraryAdapter } from "@/features/editor/components/excalidraw/excalidraw-utils.ts";

interface ExcalidrawModalContentProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  setExcalidrawAPI: (api: ExcalidrawImperativeAPI) => void;
  initialData?: ExcalidrawInitialDataState | null;
  theme: "light" | "dark";
  onChange: (
    elements: readonly any[],
    appState: any,
    files: any,
  ) => void;
}

// This component is loaded lazily so that the heavy `@excalidraw/excalidraw`
// bundle (and its CSS) is not pulled into the editor entry chunk. The bundle
// is fetched only when the user actually opens the Excalidraw editor modal.
export default function ExcalidrawModalContent({
  excalidrawAPI,
  setExcalidrawAPI,
  initialData,
  theme,
  onChange,
}: ExcalidrawModalContentProps) {
  useHandleLibrary({
    excalidrawAPI,
    adapter: localStorageLibraryAdapter,
  });

  return (
    <Excalidraw
      excalidrawAPI={(api) => setExcalidrawAPI(api)}
      onChange={onChange}
      initialData={initialData ?? undefined}
      theme={theme}
    />
  );
}
