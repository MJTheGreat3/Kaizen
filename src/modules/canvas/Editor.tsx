/**
 * The Excalidraw editor for one board. Loaded on its own (Excalidraw is
 * large), so only opening a board pays for it.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CaptureUpdateAction,
  Excalidraw,
  exportToBlob,
  exportToSvg,
  MainMenu,
  restoreElements,
  WelcomeScreen,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFileData, BinaryFiles, DataURL, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { FileImage, FileSvg } from "@phosphor-icons/react";
import { toast } from "sonner";

import type { BoardAppState } from "@/core/db/schema";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import { saveScene, storedFileIds, type BoardScene } from "./data";
import { fileIds, mergeElements, sameScene, visible, type SceneElement } from "./logic";

const SAVE_MS = 800;
const PREVIEW_MS = 8_000;
const PREVIEW_PX = 480;

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** Follows the app's light or dark theme. */
function useDark() {
  return useSyncExternalStore(subscribeTheme, () => document.documentElement.classList.contains("dark"));
}

const keptState = (s: Pick<AppState, "viewBackgroundColor" | "gridModeEnabled">): BoardAppState => ({
  viewBackgroundColor: s.viewBackgroundColor,
  gridModeEnabled: s.gridModeEnabled,
});

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

async function savedTo(path: string) {
  const name = path.split(/[\\/]/).pop();
  if (path.startsWith("/storage/")) {
    toast.success(`Saved ${name}`, { description: "In Download/Kaizen" });
    return;
  }
  toast.success(`Saved ${name}`, {
    description: "In Downloads",
    action: {
      label: "Show",
      onClick: () => void import("@tauri-apps/plugin-opener").then(({ revealItemInDir }) => revealItemInDir(path)),
    },
  });
}

export default function Editor({ scene, title }: { scene: BoardScene; title: string }) {
  const id = scene.board.id;
  const dark = useDark();
  const client = useQueryClient();
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  /** The scene as last saved or loaded, to skip saving what has not changed. */
  const saved = useRef<{ elements: readonly SceneElement[]; state: string }>({
    elements: scene.board.elements as SceneElement[],
    state: JSON.stringify(scene.board.appState),
  });
  const savedFiles = useRef(new Set(scene.files.map((f) => f.id)));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastPreview = useRef(0);
  /** The stored preview is older than the scene. */
  const previewStale = useRef(false);
  const saving = useRef<Promise<void>>(Promise.resolve());
  /** The scene as of the last change. Saving reads this, not the editor, which may be gone by then. */
  const latest = useRef<Latest | null>(null);

  /** Takes in elements from elsewhere (a save's merge or another device), unless the scene already has them. */
  const absorb = useCallback((incoming: readonly SceneElement[]) => {
    const a = api.current;
    if (!a) return;
    const current = a.getSceneElementsIncludingDeleted() as unknown as SceneElement[];
    const merged = mergeElements(current, incoming);
    if (sameScene(merged, current)) return;
    a.updateScene({
      elements: restoreElements(merged as unknown as OrderedExcalidrawElement[], null),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, []);

  const save = useCallback(
    (withPreview: boolean) => {
      const run = async () => {
        const now = latest.current;
        if (!now) return;
        const { elements, files } = now;
        const appState = keptState(now.appState);
        const state = JSON.stringify(appState);
        const used = [...fileIds(elements)].filter((f) => !savedFiles.current.has(f) && files[f]);
        const changed = !sameScene(elements, saved.current.elements) || state !== saved.current.state || used.length > 0;
        if (changed) previewStale.current = true;
        const wantPreview = previewStale.current && (withPreview || Date.now() - lastPreview.current > PREVIEW_MS);
        if (!changed && !wantPreview) return;
        if (used.length) for (const f of await storedFileIds(used)) savedFiles.current.add(f);
        const fresh = used.filter((f) => !savedFiles.current.has(f));
        let preview: string | null | undefined;
        if (wantPreview) {
          preview = await makePreview(now).catch((e) => {
            log.warn(`board preview failed: ${String(e)}`);
            return undefined;
          });
          lastPreview.current = Date.now();
          if (preview !== undefined) previewStale.current = false;
        }
        const merged = await saveScene(id, {
          elements,
          appState,
          files: fresh.map((f) => ({ id: f, mime: files[f].mimeType, data: files[f].dataURL })),
          preview,
        });
        for (const f of fresh) savedFiles.current.add(f);
        saved.current = { elements: merged, state };
        absorb(merged);
        void client.invalidateQueries({ queryKey: ["boards"] });
      };
      saving.current = saving.current.then(run).catch((e) => {
        log.error(`board save failed: ${String(e)}`);
        toast.error(`Could not save the board: ${String(e)}`);
      });
      return saving.current;
    },
    [id, absorb, client],
  );

  const onChange = useCallback((elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    latest.current = { elements: elements as unknown as SceneElement[], appState, files };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(false), SAVE_MS);
  }, [save]);

  // Leaving the board or the app: save now, with a fresh preview.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(timer.current);
        void save(true);
      }
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      clearTimeout(timer.current);
      void save(true);
    };
  }, [save]);

  // Another device's edits arrived (sync reloads the board): merge them in.
  useEffect(() => {
    absorb(scene.board.elements as SceneElement[]);
    const a = api.current;
    const missing = scene.files.filter((f) => a && !a.getFiles()[f.id]);
    if (a && missing.length) a.addFiles(missing.map(fileData));
    for (const f of scene.files) savedFiles.current.add(f.id);
  }, [scene, absorb]);

  async function exportAs(kind: "png" | "svg") {
    const a = api.current;
    if (!a) return;
    const elements = visible(a.getSceneElements());
    if (!elements.length) {
      toast("Nothing to export yet");
      return;
    }
    const appState = { ...a.getAppState(), exportBackground: true, exportWithDarkMode: false };
    try {
      let data: string;
      if (kind === "png") {
        const blob = await exportToBlob({
          elements,
          appState,
          files: a.getFiles(),
          mimeType: "image/png",
          exportPadding: 32,
          getDimensions: (width: number, height: number) => ({ width: width * 2, height: height * 2, scale: 2 }),
        });
        data = base64Of(await blobToDataUrl(blob));
      } else {
        const svg = await exportToSvg({ elements, appState, files: a.getFiles(), exportPadding: 32 });
        data = base64Of(await blobToDataUrl(new Blob([svg.outerHTML], { type: "image/svg+xml" })));
      }
      await savedTo(await ipc.exportSave(`${title || "Board"}.${kind}`, data));
    } catch (e) {
      toast.error(`Could not export: ${String(e)}`);
    }
  }

  return (
    <Excalidraw
      excalidrawAPI={(a) => {
        api.current = a;
      }}
      initialData={{
        elements: restoreElements(scene.board.elements as unknown as OrderedExcalidrawElement[], null),
        appState: { ...scene.board.appState, theme: dark ? "dark" : "light" },
        files: Object.fromEntries(scene.files.map((f) => [f.id, fileData(f)])) as BinaryFiles,
        scrollToContent: true,
      }}
      theme={dark ? "dark" : "light"}
      onChange={onChange}
      autoFocus
      name={title}
      UIOptions={{
        canvasActions: {
          loadScene: false,
          saveToActiveFile: false,
          export: false,
          saveAsImage: false,
          toggleTheme: false,
        },
      }}
    >
      <MainMenu>
        <MainMenu.Item icon={<FileImage size={16} />} onSelect={() => void exportAs("png")}>
          Export as PNG
        </MainMenu.Item>
        <MainMenu.Item icon={<FileSvg size={16} />} onSelect={() => void exportAs("svg")}>
          Export as SVG
        </MainMenu.Item>
        <MainMenu.Separator />
        <MainMenu.DefaultItems.SearchMenu />
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.DefaultItems.Help />
        <MainMenu.Separator />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
      <WelcomeScreen>
        <WelcomeScreen.Hints.ToolbarHint />
        <WelcomeScreen.Hints.MenuHint />
        <WelcomeScreen.Center>
          <WelcomeScreen.Center.Heading>Draw, write, paste images. It saves as you go.</WelcomeScreen.Center.Heading>
        </WelcomeScreen.Center>
      </WelcomeScreen>
    </Excalidraw>
  );
}

function fileData(f: { id: string; mime: string; data: string; createdAt: number }): BinaryFileData {
  return {
    id: f.id as BinaryFileData["id"],
    mimeType: f.mime as BinaryFileData["mimeType"],
    dataURL: f.data as DataURL,
    created: f.createdAt,
  };
}

interface Latest {
  elements: readonly SceneElement[];
  appState: AppState;
  files: BinaryFiles;
}

/** A small PNG of the board for the list, or null when it is empty. */
async function makePreview({ elements: all, appState, files }: Latest): Promise<string | null> {
  const elements = visible(all) as unknown as OrderedExcalidrawElement[];
  if (!elements.length) return null;
  const blob = await exportToBlob({
    elements,
    appState: { ...appState, exportBackground: false, exportWithDarkMode: false },
    files,
    mimeType: "image/png",
    maxWidthOrHeight: PREVIEW_PX,
    exportPadding: 16,
  });
  return blobToDataUrl(blob);
}
