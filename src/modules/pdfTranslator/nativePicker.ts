/* ---------------------------------------------------------------------------
 * pdfTranslator/nativePicker.ts  –  System-native file & directory picker
 *
 * Uses Zotero's FilePicker module (chrome://zotero/content/modules/
 * filePicker.mjs), which wraps the OS-native dialog on all platforms:
 *   - Windows: Explorer dialog
 *   - macOS:   Finder dialog
 *   - Linux:   GTK/Qt file dialog
 *
 * Notes:
 *   - The picker opens in `options.startDir` when provided (and existing),
 *     so users land in a familiar folder instead of an empty-looking one.
 *   - `filterAll` is always appended — a restricted filter set can leave
 *     the folder dialog showing nothing to browse.
 *   - Infrastructure errors propagate to the caller (which surfaces them
 *     in the translate console); only user cancellation yields `null`.
 * -------------------------------------------------------------------------*/

type FilePickerMode = "open" | "folder";
type FilePickerFilter = [string, string];

declare const Zotero: any;
declare const ChromeUtils: any;
declare const Services: any;
declare const Components: any;

export interface PickerOptions {
  /** Directory the dialog should open in (falls back to the home dir) */
  startDir?: string;
}

type PickerBackend = (
  win: Window,
  title: string,
  mode: FilePickerMode,
  filters?: FilePickerFilter[],
  options?: PickerOptions,
) => Promise<string | false>;

let backendForTest: PickerBackend | null = null;

/** Replace the native picker backend (tests only). */
export function setFilePickerForTest(backend: PickerBackend | null): void {
  backendForTest = backend;
}

export function resetFilePickerForTest(): void {
  backendForTest = null;
}

function loadFilePickerCtor(): any {
  return ChromeUtils.importESModule(
    "chrome://zotero/content/modules/filePicker.mjs",
  ).FilePicker;
}

function resolveParentWindow(win?: Window | null): Window | null {
  if (win && !win.closed) return win;
  try {
    return Zotero.getMainWindow?.() || null;
  } catch {
    return null;
  }
}

function homeDirPath(): string {
  try {
    return String(
      Services.dirsvc.get("Home", Components.interfaces.nsIFile).path || "",
    );
  } catch {
    return "";
  }
}

async function showNativePicker(
  win: Window,
  title: string,
  mode: FilePickerMode,
  filters?: FilePickerFilter[],
  options?: PickerOptions,
): Promise<string | false> {
  const FilePicker = loadFilePickerCtor();
  const fp = new FilePicker();
  fp.init(win, title, mode === "folder" ? fp.modeGetFolder : fp.modeOpen);
  for (const [label, pattern] of filters || []) {
    fp.appendFilter(label, pattern);
  }
  fp.appendFilters(fp.filterAll);

  const startDir = (options?.startDir || "").trim() || homeDirPath();
  if (startDir) {
    try {
      // Zotero's FilePicker accepts a string path for displayDirectory
      fp.displayDirectory = startDir;
    } catch {
      /* invalid start dir — let the picker use its own default */
    }
  }

  const choice = await fp.show();
  if (choice !== fp.returnOK && choice !== fp.returnReplace) return false;
  const path = fp.file;
  return typeof path === "string" && path ? path : false;
}

/**
 * Open a system-native file picker to select a single PDF file.
 *
 * @param win     parent window (falls back to the main Zotero window)
 * @param options `startDir` opens the dialog in that directory
 * @returns       absolute path to the selected file, or `null` if cancelled
 * @throws        when the picker cannot be shown (parent window missing,
 *                Zotero FilePicker unavailable, …)
 */
export async function pickPdfFile(
  win?: Window | null,
  options?: PickerOptions,
): Promise<string | null> {
  const parent = resolveParentWindow(win);
  if (!parent) throw new Error("File picker: no parent window available");
  const backend = backendForTest || showNativePicker;
  const result = await backend(
    parent,
    "Select PDF",
    "open",
    [["PDF Files (*.pdf)", "*.pdf"]],
    options,
  );
  return result === false ? null : result;
}

/**
 * Open a system-native directory picker to select a save directory.
 *
 * @param win     parent window (falls back to the main Zotero window)
 * @param options `startDir` opens the dialog in that directory
 * @returns       absolute path to the selected directory, or `null` if cancelled
 * @throws        when the picker cannot be shown
 */
export async function pickDirectory(
  win?: Window | null,
  options?: PickerOptions,
): Promise<string | null> {
  const parent = resolveParentWindow(win);
  if (!parent) throw new Error("Directory picker: no parent window available");
  const backend = backendForTest || showNativePicker;
  const result = await backend(
    parent,
    "Select Save Directory",
    "folder",
    undefined,
    options,
  );
  return result === false ? null : result;
}
