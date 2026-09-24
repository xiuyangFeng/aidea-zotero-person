/**
 * Strings introduced by the sectioned settings layout: the section navigation,
 * the keyboard-shortcut fields, the selection quick-action toggle and the
 * local-service scanner.
 *
 * Merged into the settings dictionary with the usual `en-US` fallback, so a
 * locale that is not listed here still renders English rather than a blank.
 */

import type { PanelLang } from "../contextPanel/languages";

export const SETTINGS_I18N_LAYOUT_OVERRIDES: Partial<
  Record<PanelLang, Record<string, string>>
> = {
  "en-US": {
    settingsNavLabel: "Settings sections",
    sectionConnection: "Connection & Models",
    sectionReading: "Reading Assistant",
    sectionSelection: "Selection & Popup",
    sectionHotkeys: "Keyboard Shortcuts",
    sectionAppearance: "Appearance",
    sectionAuthorProfiles: "Author Profiles (Beta)",
    sectionConsole: "Console",

    selectionQuickActions: "Show quick-action capsule in the selection popup",
    selectionQuickActionsHint:
      "One tap from the popup to explain the selection, break down a long sentence, or unpack a formula.",

    hotkeysFocusComposer: "Focus the composer",
    hotkeysAskSelection: "Ask about the selection",
    hotkeysTranslateSelection: "Translate the selection",
    hotkeysHint:
      'Modifiers joined by "+" followed by one key, e.g. accel+shift+l. Clearing a field restores its default.',
    hotkeysInvalid:
      "Invalid shortcut: it needs at least one modifier and exactly one key.",
    hotkeysEscHint: "Esc always cancels a streaming reply.",
    hotkeysAccelLine: "On this platform accel = {label}",

    localScanTitle: "Local services",
    localScanButton: "Scan local services",
    localScanRunning: "Scanning local ports…",
    localScanHint:
      "Probes the usual local inference servers on this machine (Ollama, LM Studio, LocalAI, vLLM, TextGen). Click a result to fill in the API Base URL.",
    localScanFound: "Found {n} local service(s).",
    localScanEmpty:
      "No local service answered (scanned ports {ports}). Start Ollama or LM Studio, then scan again.",
    localScanFailed: "Scan failed. Please try again.",
    localScanModelCount: "{n} models",
    localScanApplied: "Filled in {url}. Fetching the model list…",
  },
  "zh-CN": {
    settingsNavLabel: "设置分区导航",
    sectionConnection: "连接与模型",
    sectionReading: "阅读助手",
    sectionSelection: "划词与弹窗",
    sectionHotkeys: "快捷键",
    sectionAppearance: "外观",
    sectionAuthorProfiles: "作者档案（Beta）",
    sectionConsole: "控制台",

    selectionQuickActions: "在划词弹窗显示快捷动作胶囊",
    selectionQuickActionsHint:
      "在弹窗内一键直达解释、长难句拆解、公式拆解等动作，无需先打开侧栏。",

    hotkeysFocusComposer: "聚焦输入框",
    hotkeysAskSelection: "询问选中文本",
    hotkeysTranslateSelection: "翻译选中文本",
    hotkeysHint:
      "格式为修饰键加单个按键，用 + 连接，例如 accel+shift+l；清空输入框即可恢复默认值。",
    hotkeysInvalid: "格式无效：至少需要一个修饰键和一个按键。",
    hotkeysEscHint: "回复流式输出时，按 Esc 可随时中断。",
    hotkeysAccelLine: "当前平台 accel = {label}",

    localScanTitle: "本地服务",
    localScanButton: "扫描本地服务",
    localScanRunning: "正在扫描本地端口…",
    localScanHint:
      "探测本机常见的本地推理服务（Ollama、LM Studio、LocalAI、vLLM、TextGen），点击结果即可填入 API Base URL。",
    localScanFound: "发现 {n} 个本地服务。",
    localScanEmpty:
      "未发现本地服务（已扫描端口 {ports}）。请先启动 Ollama 或 LM Studio，然后重新扫描。",
    localScanFailed: "扫描失败，请稍后重试。",
    localScanModelCount: "{n} 个模型",
    localScanApplied: "已填入 {url}，正在获取模型列表…",
  },
  "zh-TW": {
    settingsNavLabel: "設定分區導覽",
    sectionConnection: "連線與模型",
    sectionReading: "閱讀助手",
    sectionSelection: "劃詞與彈窗",
    sectionHotkeys: "快速鍵",
    sectionAppearance: "外觀",
    sectionAuthorProfiles: "作者檔案（Beta）",
    sectionConsole: "主控台",

    selectionQuickActions: "在劃詞彈窗顯示快捷動作膠囊",
    selectionQuickActionsHint:
      "在彈窗內一鍵直達解釋、長難句拆解、公式拆解等動作，不必先打開側欄。",

    hotkeysFocusComposer: "聚焦輸入框",
    hotkeysAskSelection: "詢問選取文字",
    hotkeysTranslateSelection: "翻譯選取文字",
    hotkeysHint:
      "格式為修飾鍵加單一按鍵，以 + 連接，例如 accel+shift+l；清空輸入框即可恢復預設值。",
    hotkeysInvalid: "格式無效：至少需要一個修飾鍵與一個按鍵。",
    hotkeysEscHint: "回覆串流輸出時，按 Esc 可隨時中斷。",
    hotkeysAccelLine: "目前平台 accel = {label}",

    localScanTitle: "本機服務",
    localScanButton: "掃描本機服務",
    localScanRunning: "正在掃描本機連接埠…",
    localScanHint:
      "探測本機常見的本地推理服務（Ollama、LM Studio、LocalAI、vLLM、TextGen），點選結果即可填入 API Base URL。",
    localScanFound: "發現 {n} 個本機服務。",
    localScanEmpty:
      "未發現本機服務（已掃描連接埠 {ports}）。請先啟動 Ollama 或 LM Studio，然後重新掃描。",
    localScanFailed: "掃描失敗，請稍後再試。",
    localScanModelCount: "{n} 個模型",
    localScanApplied: "已填入 {url}，正在取得模型清單…",
  },
};
