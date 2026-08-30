import { initLocale } from "./utils/locale";
import { config } from "../package.json";
import {
  removeLLMStyles,
  registerReaderContextPanel,
  registerLLMStyles,
  registerReaderSelectionTracking,
  unregisterReaderContextPanel,
  unregisterReaderSelectionTracking,
} from "./modules/contextPanel";
import {
  injectLibraryPanel,
  removeLibraryPanel,
} from "./modules/contextPanel/libraryPanel";
import { migrateLegacyAdvancedModelParamPrefs } from "./modules/contextPanel/prefHelpers";
import { removeReaderPanels } from "./modules/contextPanel/readerPanel";
import { initChatStore } from "./utils/chatStore";
import { initMemoryStore } from "./utils/memoryStore";
import { initConceptStore } from "./utils/conceptStore";
import {
  initAttachmentRefStore,
  reconcileNoteAttachmentRefsFromNoteContent,
  collectAndDeleteUnreferencedBlobs,
  ATTACHMENT_GC_MIN_AGE_MS,
} from "./utils/attachmentRefStore";
import { initSelectionTranslateCacheStore } from "./utils/selectionTranslateCacheStore";
import { createZToolkit } from "./utils/ztoolkit";
import {
  ensureZoteroProxyFromSystem,
  migrateLegacyGeminiOAuthState,
} from "./utils/oauthCli";
import { maybeShowOpenAIUpdateNotice } from "./modules/updateNotice";
import {
  registerOAuthEnvUpdateSchedulerWindow,
  shutdownOAuthEnvUpdateScheduler,
  unregisterOAuthEnvUpdateSchedulerWindow,
} from "./modules/oauthEnvUpdateScheduler";
import {
  registerAuthorProfiles,
  shutdownAuthorProfiles,
} from "./modules/authorProfiles";
import { abortAllTranslationJobs } from "./modules/pdfTranslator";
import {
  abortTranslationsForWindow,
  stopAllProgressTimers,
} from "./modules/pdfTranslator/translateTabController";
import { cleanupTranslateTempCache } from "./modules/pdfTranslator/tempCache";

const PREF_PANE_ID = `${config.addonRef}-preferences-pane`;

/**
 * One toolkit per main window. `unregisterAll` on window unload must dispose
 * the toolkit created for THAT window — the old code always unregistered
 * `addon.data.ztoolkit`, i.e. whichever window loaded last, so closing an
 * older window killed the newest window's registrations.
 */
const ztoolkitsByWindow = new Map<Window, ZToolkit>();

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // Clean up settings left over from the removed Gemini CLI OAuth provider.
  try {
    migrateLegacyGeminiOAuthState();
  } catch (err) {
    ztoolkit.log("LLM: Failed to migrate legacy Gemini OAuth state", err);
  }

  // Clear the never-user-visible factory temperature/maxTokens pair.
  try {
    migrateLegacyAdvancedModelParamPrefs();
  } catch (err) {
    ztoolkit.log("LLM: Failed to migrate advanced model param prefs", err);
  }

  // Auto-detect system proxy and apply to Gecko so fetch() works with chatgpt.com etc.
  try {
    await ensureZoteroProxyFromSystem();
  } catch (err) {
    ztoolkit.log("LLM: Failed to apply system proxy", err);
  }

  try {
    await initChatStore();
  } catch (err) {
    ztoolkit.log("LLM: Failed to initialize chat store", err);
  }
  try {
    await initMemoryStore();
  } catch (err) {
    ztoolkit.log("LLM: Failed to initialize memory store", err);
  }
  try {
    await initConceptStore();
  } catch (err) {
    ztoolkit.log("LLM: Failed to initialize concept store", err);
  }
  try {
    await initAttachmentRefStore();
  } catch (err) {
    ztoolkit.log("LLM: Failed to initialize attachment reference store", err);
  }
  try {
    await initSelectionTranslateCacheStore();
  } catch (err) {
    ztoolkit.log(
      "LLM: Failed to initialize selection translate cache store",
      err,
    );
  }

  void (async () => {
    try {
      await reconcileNoteAttachmentRefsFromNoteContent();
      await collectAndDeleteUnreferencedBlobs(ATTACHMENT_GC_MIN_AGE_MS);
    } catch (err) {
      ztoolkit.log("LLM: Attachment ref reconciliation/GC failed", err);
    }
  })();

  // Purge translation job directories left over by previous sessions — they
  // can contain a config.toml with the provider API key.
  void cleanupTranslateTempCache().catch((err) => {
    ztoolkit.log("LLM: Failed to clean up translation temp cache", err);
  });

  registerPrefsPane();
  registerAuthorProfiles();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  const windowToolkit = createZToolkit();
  ztoolkitsByWindow.set(win, windowToolkit);
  addon.data.ztoolkit = windowToolkit;

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  registerLLMStyles(win);
  registerReaderContextPanel();
  registerReaderSelectionTracking();
  await injectLibraryPanel(win);

  win.setTimeout(() => {
    try {
      maybeShowOpenAIUpdateNotice(win);
    } catch (err) {
      ztoolkit.log("AIdea: failed to show update notice", err);
    }
  }, 600);

  registerOAuthEnvUpdateSchedulerWindow(win);
}

function registerPrefsPane() {
  try {
    Zotero.PreferencePanes.unregister(PREF_PANE_ID);
  } catch (_err) {
    void _err;
  }
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    id: PREF_PANE_ID,
    src: `chrome://${addon.data.config.addonRef}/content/preferences.xhtml`,
    label: "AIdea",
    image: `chrome://${addon.data.config.addonRef}/content/icons/icon-20.png`,
  });
}

async function onMainWindowUnload(win: Window): Promise<void> {
  unregisterOAuthEnvUpdateSchedulerWindow(win);
  // Kill any translation still running from this window's UI before its
  // panel DOM (and the session that references it) disappears.
  abortTranslationsForWindow(win);
  removeLibraryPanel(win);
  removeReaderPanels(win);
  removeLLMStyles(win);
  const windowToolkit = ztoolkitsByWindow.get(win);
  if (windowToolkit) {
    try {
      windowToolkit.unregisterAll();
    } finally {
      ztoolkitsByWindow.delete(win);
    }
  }
  // Keep the global accessor pointing at a live toolkit for the remaining
  // windows; it is only ever used for logging and cross-window registrations.
  if (addon.data.ztoolkit === windowToolkit) {
    addon.data.ztoolkit =
      ztoolkitsByWindow.values().next().value ?? windowToolkit;
  }
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  // Kill running translation subprocesses first — nsIProcess kill is
  // synchronous, so no pdf2zh/python bridge can outlive Zotero.
  try {
    abortAllTranslationJobs();
  } catch (err) {
    ztoolkit.log("LLM: failed to abort translation jobs on shutdown", err);
  }
  stopAllProgressTimers();
  // Best-effort removal of temp job dirs (config.toml holds credentials);
  // a non-finished sweep is retried by the startup cleanup on next launch.
  void cleanupTranslateTempCache().catch((err) => {
    ztoolkit.log("LLM: translation temp cache cleanup failed on shutdown", err);
  });
  try {
    for (const win of Zotero.getMainWindows()) {
      try {
        unregisterOAuthEnvUpdateSchedulerWindow(win);
        removeLibraryPanel(win);
        removeReaderPanels(win);
        removeLLMStyles(win);
      } catch (err) {
        ztoolkit.log("LLM: failed to clean up main window on shutdown", err);
      }
    }
  } catch (err) {
    ztoolkit.log("LLM: failed to enumerate main windows on shutdown", err);
  }
  unregisterReaderSelectionTracking();
  unregisterReaderContextPanel();
  try {
    Zotero.PreferencePanes.unregister(PREF_PANE_ID);
  } catch (_err) {
    void _err;
  }
  for (const windowToolkit of ztoolkitsByWindow.values()) {
    try {
      windowToolkit.unregisterAll();
    } catch (err) {
      ztoolkit.log("LLM: failed to unregister window toolkit", err);
    }
  }
  ztoolkitsByWindow.clear();
  shutdownAuthorProfiles();
  shutdownOAuthEnvUpdateScheduler();
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

/**
 * This function is just an example of dispatcher for Notify events.
 * Any operations should be placed in a function to keep this funcion clear.
 */
async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  // You can add your code to the corresponding notify type
  ztoolkit.log("notify", event, type, ids, extraData);
  return;
}

/**
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this funcion clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      // No longer used, preferences have moved to sidebar Setting panel
      break;
    default:
      return;
  }
}

function onDialogEvents(_type: string) {
  return;
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onDialogEvents,
};
