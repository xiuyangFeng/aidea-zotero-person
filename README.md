<p align="center">
  <img src="addon/content/icons/icon-96.png" alt="AIdea Logo" width="80" />
</p>

<h1 align="center">AIdea</h1>

<p align="center">
  <a href="./README.md">English</a>
  ·
  <a href="./doc/readme/README.zh-CN.md">简体中文</a>
  ·
  <a href="./doc/readme/README.zh-TW.md">繁體中文</a>
  ·
  <a href="./doc/readme/README.ja.md">日本語</a>
  ·
  <a href="./doc/readme/README.ko.md">한국어</a>
  ·
  <a href="./doc/readme/README.fr.md">Français</a>
</p>

<p align="center">
  <strong>🌐 Website:</strong> <a href="https://visterainer.github.io/aidea-zotero/en/">https://visterainer.github.io/aidea-zotero/en/</a>
</p>

<p align="center">
  <strong>A free, open-source AI assistant plugin for Zotero</strong><br/>
  🔐 OAuth login with OpenAI (ChatGPT) and GitHub Copilot<br/>
  ⚙️ OpenAI-compatible APIs and local or self-hosted models via Ollama, LM Studio, vLLM, and similar runtimes
</p>

<p align="center">
  <img alt="OpenAI ChatGPT" src="https://img.shields.io/badge/OpenAI-ChatGPT-10A37F?style=for-the-badge&logo=openai&logoColor=white" />
  <img alt="GitHub Copilot" src="https://img.shields.io/badge/GitHub-Copilot-111111?style=for-the-badge&logo=github&logoColor=white" />
</p>

<p align="center">
  <img alt="OpenAI Compatible API" src="https://img.shields.io/badge/OpenAI-Compatible%20API-4B5563?style=flat-square&logo=openai&logoColor=white" />
  <img alt="Ollama" src="https://img.shields.io/badge/Ollama-1F2937?style=flat-square&logoColor=white" />
  <img alt="LM Studio" src="https://img.shields.io/badge/LM%20Studio-2563EB?style=flat-square&logoColor=white" />
  <img alt="vLLM" src="https://img.shields.io/badge/vLLM-7C3AED?style=flat-square&logoColor=white" />
</p>

<p align="center">
  <a href="#-features">Features</a> &nbsp;|&nbsp;
  <a href="#-installation">Installation</a> &nbsp;|&nbsp;
  <a href="#-getting-started">Getting Started</a> &nbsp;|&nbsp;
  <a href="#-configuration">Configuration</a> &nbsp;|&nbsp;
  <a href="#-license">License</a>
</p>

---

## ✨ Features

### 💬 AI Chat in the Side Panel

Chat with AI directly in Zotero's side panel, available in the **Library** view and the **PDF or EPUB Reader**. Ask questions, get summaries, and stay inside the same research workflow. EPUB conversations use the book's EPUB 2/3 publisher structure and bounded local retrieval to select relevant sections without an additional planning-model request.

<p align="center">
  <img src="doc/screenshots/chat_panel_en.png" alt="Side panel chat" width="800" />
</p>

### 📄 Paper-Aware Context

Select text in the PDF or EPUB reader and click **Add Text** to attach the selected passage to the context area. AIdea can then answer against the selected passage instead of relying on a generic summary.

### 📝 Selection Translation

Translate selected text directly in Zotero's PDF or EPUB reader popup. AIdea detects the active format automatically, with no manual switch required. Selection translation uses the same OAuth/API model list as the chat panel, but can be configured with its own enable switch, model, source language, and target language.

For PDFs, the first selection translation creates a local cold-start cache with a compact paper overview and terminology summary. EPUB selections instead use bounded, selection-anchored book context without a separate warm-up request. Translated passages can be added back to Zotero notes.

<p align="center">
  <img src="doc/screenshots/selection_translation_popup.png" alt="Selection translation popup in the PDF reader" width="800" />
</p>

<p align="center">
  <img src="doc/screenshots/selection_translation_settings.png" alt="Selection translation settings" width="800" />
</p>

### ⚡ Quick Action Shortcuts

Use one-click shortcuts for common tasks such as **Summarize**, **Explain**, and **Translate**. Shortcuts can be added, edited, reordered, or removed to match your workflow.

### 🖼️ Multimodal Support

Attach screenshots, figures, and charts to your messages. AIdea supports drag and drop, clipboard paste, and screenshot capture directly from PDF content.

### 🔐 OAuth Login Without an API Key

Sign in with your existing account through OAuth. AIdea supports multiple providers with provider-specific OAuth flows, so you can start without managing an API key manually.

### 📄 Full-Document Translation

Translate full papers directly inside Zotero and export either a **bilingual dual-column PDF** or a **single-language PDF**. The translation workflow supports model selection, output path configuration, and end-to-end execution in the side panel.

<p align="center">
  <img src="doc/screenshots/translate_panel_en.png" alt="Full-document translation panel" width="800" />
</p>

Example outputs:

<p align="center">
  <img src="doc/screenshots/translate_example_architecture.png" alt="Bilingual architecture paper translation example" width="800" />
</p>

<p align="center">
  <img src="doc/screenshots/translate_example_formula.png" alt="Formula-heavy paper translation example" width="800" />
</p>

<p align="center">
  <img src="doc/screenshots/translate_example_table.png" alt="Table and prose translation example" width="800" />
</p>

### 🌐 Multi-Provider Support

| Provider             | Auth Method                   | Extra Setup              |
| -------------------- | ----------------------------- | ------------------------ |
| **OpenAI (ChatGPT)** | OAuth via Codex CLI           | Node.js (auto-installed) |
| **GitHub Copilot**   | In-plugin OAuth (Device Code) | None                     |

> **Note:** Gemini CLI OAuth support was removed because Google shut down Code Assist OAuth access for individual accounts (including Google AI Pro/Ultra) on June 18, 2026. Gemini models remain usable via a Gemini API key through any OpenAI-compatible custom endpoint, or through GitHub Copilot's model catalog.

### 📝 Note Export

Save AI responses as Zotero notes with one click. Responses are stored in Markdown and support LaTeX math rendering.

### 💾 Persistent Chat History

All conversations are stored locally in Zotero's database. You can switch between conversations, continue previous threads, and manage local chat history.

### 🧠 Memory System

AIdea captures and recalls useful information across conversations to improve continuity and context awareness over time.

- **Auto-capture** detects preferences, decisions, facts, and key entities from natural conversation
- **Per-library isolation** keeps memories scoped to each Zotero library
- **Smart deduplication** uses Jaccard token similarity to prevent redundant memories
- **Relevance-ranked retrieval** combines overlap, substring match, recency, and importance
- **Prompt injection defense** blocks malicious or irrelevant content from being stored
- **Fully local storage** keeps memory data inside Zotero's SQLite database

### 🧭 Where Everything Lives

The composer has two menus, so context and actions no longer share one list:

- **`+` menu — add context only**: **Upload files**, **Select references** (or type `@`), **Add selected items** from the library, and **Add my annotations**.
- **📖 Reading menu — everything that reads the paper for you**, in five groups (arrow keys, Home/End and Esc work inside it):

| Group                  | Actions                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**           | Generate paper briefing · Generate reading card · Figure navigator · Find code repositories                                                                                                 |
| **On the selection**   | Explain in plain language · Break down this sentence · Break down this formula · Walk through this algorithm · Read this results table · Question this passage · Explain selected citations |
| **Deep dive**          | Critical review (whole document) · Build a comparison matrix · Academic polishing (Academic tone / Conciseness / Clarity / Reviewer response)                                               |
| **Concepts & writing** | Extract concept cards · Record a concept… · Export glossary · Export writing draft                                                                                                          |
| **Annotations**        | Summarize my annotations                                                                                                                                                                    |

### 📰 Proactive Reading Assistant

- **Auto briefing**: opening a paper with an empty conversation writes a short briefing by itself. While it is pending, an inline notice offers **Cancel** and **Don't auto-generate**; the mode (auto / manual / off) is in Settings → Reading Assistant.
- **Guided questions**: the paper briefing ends with a few follow-up questions you can click (toggle in Settings → Reading Assistant).
- **Page anchors**: `[p.N]` citations in answers are links that jump the reader to that page.
- **Empty-conversation guide**: a fresh conversation shows one-click starting points (paper briefing, reading card, explain my selection, annotation summary, add library items / references, all reading tools) plus the configured hotkeys.
- **Inline notices**: warnings, errors and anything you can act on appear in a banner above the composer with action buttons; warnings and errors stay until closed.

### 📖 Reading Actions on the Selection

Select a passage in the reader, then pick an action from the Reading menu or the selection popup:

- **Break down this sentence** — the subject–verb–object backbone, the modifier hierarchy and a plain paraphrase.
- **Break down this formula** — a symbol-by-symbol table, dimensions, intuition and constraints.
- **Walk through this algorithm** — steps through the pseudocode on a tiny toy example, tracking variables and shapes.
- **Read this results table** — which method wins, by how much, and what the ablations say about each component.
- **Question this passage** — a reviewer's look at assumptions, baselines and missing controls.

### 🔍 Citation Insight and 1-Click Citation Import

Select text containing `[12]` or `(Smith et al., 2020)` and choose **Explain selected citations**: AIdea finds the entries in the paper's reference list and explains why each work is cited. Cited works already in your library are attached as supplemental papers. For the ones that are not, a notice offers **Import to Zotero** (per marker, or **Import all**): metadata comes from **Crossref** (by DOI when the entry has one, else a bibliographic search) with **OpenAlex** as fallback, a DOI/title check prevents duplicates, and the new item is created in the same library as the paper. If Zotero's "automatically attach associated PDFs" option is on, Zotero also looks for an open-access PDF, and a found PDF is attached as context.

### 💻 Paper-to-Code

**Reading menu → Find code repositories** searches the GitHub repository search API for repositories that mention the paper's arXiv id, DOI or exact title, and lists them with stars, language and description; click a row to open it. Requests are anonymous (no token is stored), so GitHub's rate limit applies; hitting it shows a notice with the wait time. Results are repositories that _mention_ the paper, not necessarily the official implementation.

### 🧐 Critical Review and Comparison Matrix

- **Critical review (whole document)** — a "Reviewer 2" report on the open paper; saved notes are tagged `aidea-critical-review`.
- **Build a comparison matrix** — select two or more papers as context to get a table of research questions, methods, datasets, metrics and limitations; saved notes are tagged `aidea-synthesis-matrix`.
- **Summarize my annotations** — turns your highlights and comments into a structured digest note tagged `aidea-highlight-digest`.

### ✍️ Academic Polishing

Four modes — **Academic tone**, **Conciseness** (trims 15–30%), **Clarity & coherence** and **Reviewer response** — work on the selected text; the answer has a **word-level diff** you can toggle to see exactly what changed.

### 💊 Selection Popup Quick Actions

The reader's selection popup carries a quick-action capsule next to translation: it recommends the most fitting actions for what you selected (sentence, formula, algorithm, table…) and keeps the rest under **More**. It can be turned off in Settings → Selection & Popup.

### ⌨️ Global Hotkeys

Work in the library pane and in reader tabs, and can be rebound in Settings → Keyboard Shortcuts (`accel` is ⌘ on macOS, Ctrl elsewhere):

| Action                  | Default         |
| ----------------------- | --------------- |
| Focus the composer      | `accel+shift+M` |
| Ask about the selection | `accel+shift+E` |
| Translate the selection | `accel+shift+D` |
| Stop a streaming reply  | `Esc`           |

### 🎨 Rich Rendering

- Full **Markdown** rendering, including headings, lists, code blocks, and tables
- **LaTeX** math support via KaTeX
- **Syntax highlighting** for code blocks
- Smooth **streaming** responses

### 🌍 Interface Languages

The plugin interface now supports **12 UI languages**: **English**, **简体中文**, **繁體中文**, **日本語**, **한국어**, **Français**, **Deutsch**, **Español**, **Русский**, **Português**, **العربية**, and **हिन्दी**. Full-document translation keeps its broader target-language list independent from the UI language list.

---

## 📦 Installation

### Requirements

- **Zotero 7 or later**
- **Node.js**, required for OpenAI (Codex CLI), can be installed automatically by the plugin when needed

### Install the Plugin

1. Download the latest `AIdea-x.x.x.xpi` from [Releases](https://github.com/Visterainer/aidea-zotero/releases)
2. In Zotero, go to **Tools → Add-ons**
3. Click the gear icon ⚙️ and choose **Install Add-on From File...**
4. Select the downloaded `.xpi` file
5. Restart Zotero

### Upgrade

Install the newer `.xpi` package over the existing one. Chat history, stored memory, and local settings are preserved.

---

## 🚀 Getting Started

### 1. Open Settings

Go to **Tools → Add-ons → AIdea → Settings**. On older Zotero builds, the path may appear under **Edit → Settings → AIdea**.

### 2. Choose a Connection Mode

AIdea supports two connection modes. You can use either one or combine both.

#### Option A: OAuth Login

For each provider card, the typical setup order is:

> **① `Install/Update Env`** → **② `OAuth Login`** → **③ `Refresh Models`**

| Button                   | What it does                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`Install/Update Env`** | Installs and configures the required CLI tools and runtime, including Node.js and npm when needed. GitHub Copilot does not require this step.                       |
| **`OAuth Login`**        | Starts the provider-specific login flow. OpenAI opens the browser directly. GitHub Copilot shows a device code, copies it, and opens the browser for authorization. |
| **`Refresh Models`**     | Loads the list of available models for the provider after login.                                                                                                    |
| **`Remove Auth`**        | Clears the locally stored OAuth token for that provider.                                                                                                            |

<p align="center">
  <img src="doc/screenshots/settings_oauth_models_en.png" alt="OAuth providers and model management" width="700" />
</p>

> 💡 **Tip:** Each provider only needs to be configured once. The login session is stored locally and remains available after Zotero restarts.

#### Option B: OpenAI-Compatible API Endpoint

AIdea can also connect to any **OpenAI-compatible chat endpoint**, including local, self-hosted, or third-party services such as Ollama, LM Studio, vLLM, DeepSeek, OpenRouter, or Groq.

In **Settings**, switch to **API Mode** and fill in:

| Field            | Required | Description                                                                                                 |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| **API Base URL** | Yes      | The base URL of the compatible endpoint, such as `https://api.openai.com/v1` or `http://localhost:11434/v1` |
| **API Key**      | No       | Required only when the endpoint expects authentication                                                      |
| **Model**        | Yes      | Enter the model manually or click **Auto Fetch Models** to detect available models                          |

<p align="center">
  <img src="doc/screenshots/settings_api_en.png" alt="API mode custom endpoint" width="700" />
</p>

> **Note:** API mode targets compatible `/chat/completions` endpoints. It does not guarantee support for provider-specific features beyond standard chat completion.

### 3. Start Chatting

- In the **Library Panel**, select an item and use the AIdea panel in the right sidebar
- In the **PDF or EPUB Reader**, open a document and use the AIdea panel in the reader sidebar
- Type your question and press **Send** or hit `Enter`

### 4. Use Quick Actions

Click shortcut buttons such as **Summarize**, **Explain**, or **Translate** for one-click actions. Right-click a shortcut to edit or remove it.

---

## ⚙️ Configuration

| Setting                         | Description                                                            | Default                              |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------ |
| **UI Language**                 | Plugin interface language                                              | Auto-detected, fallback EN           |
| **System Prompt**               | Custom instructions for the model                                      | Empty                                |
| **Show "Add Text"**             | Show the Add Text option in the reader selection popup                 | On                                   |
| **Selection Translation**       | Translate selected reader text with automatic bounded document context | On                                   |
| **Selection Translation Model** | Dedicated model for reader selection translation                       | First available model unless changed |
| **Show All Models**             | Show all available models instead of a curated subset                  | Off                                  |
| **Tab Bar**                     | Show or hide the tab navigation bar                                    | Shown                                |

The settings page is split into seven sections with a sticky section bar: **Connection & Models**, **Reading Assistant**, **Selection & Popup**, **Keyboard Shortcuts**, **Appearance**, **Author Profiles (Beta)** and **Console**. In **Connection & Models**, **Scan local services** probes the usual local inference ports (Ollama `11434`, LM Studio `1234`, LocalAI `8080`, vLLM `8000`, TextGen `5000`); click a result to fill in the API Base URL.

---

## 🔒 Privacy & Security

- OAuth tokens are stored **locally only**
- API requests are sent **directly** to the selected provider or configured endpoint
- AIdea **does not collect usage telemetry or user data**
- Chat history and memory remain in Zotero's local database
- The code is fully available for inspection on [GitHub](https://github.com/Visterainer/aidea-zotero)

---

## 🗺️ Roadmap

Planned directions for future releases include:

- **One-click architecture diagrams**, for generating structural visualizations from paper content

> 💡 Feature requests are welcome through [Issues](https://github.com/Visterainer/aidea-zotero/issues).

---

## 🎨 Custom Optimizations & Enhancements

This personal fork includes dedicated fixes and visual improvements:

- **CLI & OAuth Environment Discovery**: Enhanced automatic detection for Homebrew (`/opt/homebrew/bin`) and NVM-managed global Node/npm packages (`~/.nvm/versions/node/*/lib/node_modules` and `bin`), resolving Codex CLI OAuth login issues under macOS GUI launch environments.
- **Modernized Chat UI**:
  - Redesigned readiness banner with frosted-glass card style and fixed button text wrapping.
  - Upgraded prompt shortcuts to modern pill chips with subtle elevation and smooth hover micro-interactions.
  - Unified composer card design with clean borderless textarea, removed distracting resize handles, and added soft breathing glow on focus.
  - Enhanced send button with modern gradient and micro-bounce effects.

---

## 🛠️ Development

```bash
# Install dependencies
npm install

# Development mode
npm start

# Build production XPI
npm run build

# Run tests
npm run test:unit
```

---

## 📄 License

[AGPL-3.0-or-later](./LICENSE)

This project is derived from [llm-for-zotero](https://github.com/yilewang/llm-for-zotero) by Yile Wang. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for attribution details.

---

## ⭐ Star History

<a href="https://star-history.com/#Visterainer/aidea-zotero&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Visterainer/aidea-zotero&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Visterainer/aidea-zotero&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Visterainer/aidea-zotero&type=Date" />
 </picture>
</a>

---

<p align="center">
  Author: <strong>zhile</strong>
</p>
