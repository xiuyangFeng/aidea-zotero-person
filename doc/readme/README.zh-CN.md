<p align="center">
  <img src="../../addon/content/icons/icon-96.png" alt="AIdea Logo" width="80" />
</p>

<h1 align="center">AIdea</h1>

<p align="center">
  <a href="../../README.md">English</a>
  ·
  <a href="./README.zh-CN.md">简体中文</a>
  ·
  <a href="./README.zh-TW.md">繁體中文</a>
  ·
  <a href="./README.ja.md">日本語</a>
  ·
  <a href="./README.ko.md">한국어</a>
  ·
  <a href="./README.fr.md">Français</a>
</p>

<p align="center">
  <strong>🌐 Website:</strong> <a href="https://visterainer.github.io/aidea-zotero/">https://visterainer.github.io/aidea-zotero/</a>
</p>

<p align="center">
  <strong>免费开源的 Zotero AI 助手插件</strong><br/>
  🔐 支持 OpenAI（ChatGPT）和 GitHub Copilot 的 OAuth 授权登录<br/>
  ⚙️ 支持 OpenAI 兼容 API，以及通过 Ollama、LM Studio、vLLM 等接入本地或自托管模型
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
  <a href="#-功能特性">功能特性</a> &nbsp;|&nbsp;
  <a href="#-安装">安装</a> &nbsp;|&nbsp;
  <a href="#-快速开始">快速开始</a> &nbsp;|&nbsp;
  <a href="#-配置选项">配置选项</a> &nbsp;|&nbsp;
  <a href="#-许可证">许可证</a>
</p>

---

## ✨ 功能特性

### 💬 侧边栏 AI 对话

在 Zotero 的侧边栏中直接与 AI 对话，**文库视图**、**PDF 阅读器**和 **EPUB 阅读器**中均可使用。提问、获取摘要、继续追问，都可以放在同一个研究工作流里完成。EPUB 对话会根据 EPUB 2/3 出版目录结构在本地进行有界检索，无需额外调用一次模型来规划章节。

<p align="center">
  <img src="../screenshots/chat_panel_cn.png" alt="侧边栏对话" width="800" />
</p>

### 📄 论文感知上下文

在 PDF 或 EPUB 阅读器中选中文本，点击 **Add Text** 即可将选中内容添加到上下文区域。AI 在回答时会优先结合这些原文内容，而不是只给出泛化总结。

### 📝 划词翻译

可直接在 Zotero PDF 或 EPUB 阅读器的划词弹窗中翻译选中文本。AIdea 会自动识别当前阅读器中的文档格式，无需手动切换。划词翻译复用对话框中的 OAuth/API 模型列表和调用方式，但可以单独启用，并独立选择模型、源语言和目标语言。

PDF 首次使用划词翻译时，AIdea 会在本地生成包含精简概述和专业术语摘要的冷启动缓存。EPUB 划词翻译则直接使用以选中文本为锚点的有界图书上下文，不会额外执行冷启动请求。译文可以直接添加回 Zotero 笔记。

<p align="center">
  <img src="../screenshots/selection_translation_popup.png" alt="PDF 阅读器划词翻译弹窗" width="800" />
</p>

<p align="center">
  <img src="../screenshots/selection_translation_settings.png" alt="划词翻译设置" width="800" />
</p>

### ⚡ 快捷操作按钮

支持一键触发常用任务，如 **总结**、**解释**、**翻译** 等。快捷按钮可自由添加、编辑、排序和删除，以适配不同研究习惯。

### 🖼️ 多模态支持

可在消息中附加截图、图表、示意图等图片内容。支持拖拽、从剪贴板粘贴，以及直接从 PDF 中截图。

### 🔐 OAuth 账号登录（无需 API Key）

使用已有账号通过 OAuth 登录，无需手动管理 API Key。AIdea 针对不同服务商提供各自的授权流程，以便更直接地开始使用。

### 📄 全文翻译

可直接在 Zotero 中翻译整篇论文，并导出 **双语对照 PDF** 或 **单语言 PDF**。全文翻译流程支持模型选择、输出路径配置，以及在侧边栏中的一站式执行。

<p align="center">
  <img src="../screenshots/translate_panel_cn.png" alt="全文翻译面板" width="800" />
</p>

示例结果：

<p align="center">
  <img src="../screenshots/translate_example_architecture.png" alt="双语论文翻译示例" width="800" />
</p>

<p align="center">
  <img src="../screenshots/translate_example_formula.png" alt="公式论文翻译示例" width="800" />
</p>

<p align="center">
  <img src="../screenshots/translate_example_table.png" alt="表格与正文翻译示例" width="800" />
</p>

### 🌐 多服务商支持

| 服务商                | 认证方式                    | 额外安装                |
| --------------------- | --------------------------- | ----------------------- |
| **OpenAI（ChatGPT）** | Codex CLI OAuth             | Node.js（插件自动安装） |
| **GitHub Copilot**    | 插件内 OAuth（Device Code） | 无需额外安装            |

> **注意：** 由于 Google 已于 2026 年 6 月 18 日关停个人账号（含 Google AI Pro/Ultra）的 Code Assist OAuth 通道，Gemini CLI OAuth 支持已被移除。Gemini 模型仍可通过 Gemini API Key 配合任意 OpenAI 兼容自定义端点使用，或通过 GitHub Copilot 的模型目录使用。

### 📝 笔记导出

可一键将 AI 回复保存为 Zotero 笔记。回复采用 Markdown 格式，并支持 LaTeX 数学公式渲染。

### 💾 持久化聊天记录

所有对话都保存在 Zotero 的本地数据库中，可以在多个会话之间切换，继续之前的讨论，并管理本地聊天历史。

### 🧠 记忆系统

AIdea 会在多轮对话中捕捉和回忆有价值的信息，以便后续回答更具连续性和上下文相关性。

- **自动捕捉**：识别自然对话中的偏好、事实、决定和关键实体
- **按文库隔离**：不同 Zotero 文库之间的记忆互不干扰
- **智能去重**：通过 Jaccard 相似度避免重复记忆
- **相关性排序检索**：结合词元重叠、子串匹配、时间衰减和重要性进行排序
- **提示注入防护**：防止无关或恶意内容写入记忆
- **完全本地**：所有记忆保存在 Zotero 的 SQLite 数据库中

### 🧭 功能入口一览

输入框旁有两个菜单，上下文与动作不再挤在同一个列表里：

- **`+` 菜单：只负责添加上下文**：**上传文件**、**选择参考论文**（也可输入 `@`）、**添加选中的文献**、**引入我的标注**。
- **📖 阅读菜单：所有「替你读论文」的动作**，分为五组（支持方向键、Home/End 和 Esc）：

| 分组           | 动作                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------- |
| **通览**       | 生成论文速览 · 生成精读卡片 · 图表导读 · 查找代码仓库                                    |
| **针对选区**   | 通俗解释 · 长难句拆解 · 公式拆解 · 算法走读 · 实验表格洞察 · 审辩质疑 · 解读选中引用     |
| **深度**       | 批判性评审（全文）· 生成对比矩阵 · 学术润色（学术语气 / 精简篇幅 / 逻辑连贯 / 审稿回复） |
| **概念与写作** | 提取概念卡 · 记录概念…… · 导出术语表 · 导出写作草稿                                      |
| **标注**       | 汇总我的标注                                                                             |

### 📰 主动式阅读助手

- **自动论文速览**：打开一篇对话为空的论文时自动生成简短速览；等待期间输入框上方的提示条提供 **取消** 和 **不再自动生成**，模式（自动 / 手动 / 关闭）可在「设置 → 阅读助手」中修改。
- **引导追问**：论文速览末尾附带几条可点击的追问（可在「设置 → 阅读助手」中关闭）。
- **页码锚点**：回答中的 `[p.N]` 可点击，直接跳转到阅读器对应页。
- **空对话引导**：新对话会显示一键起点（论文速览、精读卡片、解释选中内容、汇总标注、添加文献 / 参考论文、全部阅读工具），并列出当前的全局快捷键。
- **内联提示条**：警告、错误以及需要你操作的消息显示在输入框上方，带操作按钮；警告和错误会一直保留，直到手动关闭。

### 📖 针对选区的阅读动作

在阅读器中选中一段文字，然后从阅读菜单或划词弹窗中选择动作：

- **长难句拆解**：主谓宾骨架、修饰成分层级与通俗改写。
- **公式拆解**：逐符号释义表、维度、直觉理解与约束条件。
- **算法走读**：用迷你玩具样例逐步推演伪代码，跟踪变量与张量形状。
- **实验表格洞察**：谁赢了、领先多少，以及消融实验说明了各组件的什么作用。
- **审辩质疑**：以审稿人视角检查假设、基线与缺失的对照实验。

### 🔍 引用解读与一键入库

选中含有 `[12]` 或 `(Smith et al., 2020)` 的文字，选择 **解读选中引用**：AIdea 会在论文参考文献列表中定位条目，并解释每篇文献被引用的原因。文库中已有的被引文献会自动挂为补充文献；文库中没有的，会在提示条中提供 **导入 Zotero**（逐条或 **全部导入**）：元数据来自 **Crossref**（有 DOI 按 DOI 查询，否则做书目检索），**OpenAlex** 作为后备；导入前按 DOI / 标题查重，新条目创建在论文所在的同一个文库中。若开启了 Zotero 的「保存条目时自动附加相关 PDF」选项，Zotero 还会尝试查找开放获取 PDF，找到后自动挂为上下文。

### 💻 论文代码查找（Paper-to-Code）

**阅读菜单 → 查找代码仓库** 通过 GitHub 仓库搜索 API，查找提到该论文 arXiv 编号、DOI 或完整标题的仓库，列出星标数、语言与简介，点击即可打开。请求为匿名请求（不保存任何 token），因此受 GitHub 频率限制；触发限制时会提示需要等待的时间。结果是「提到这篇论文的仓库」，不一定是作者官方实现。

### 🧐 批判性评审与对比矩阵

- **批判性评审（全文）**：以「Reviewer 2」视角审阅当前论文；保存的笔记带 `aidea-critical-review` 标签。
- **生成对比矩阵**：把两篇及以上论文加入上下文，生成研究问题、方法、数据集、指标与局限的对比表；保存的笔记带 `aidea-synthesis-matrix` 标签。
- **汇总我的标注**：把你的高亮与批注整理成结构化的阅读摘要笔记，带 `aidea-highlight-digest` 标签。

### ✍️ 学术润色

四种模式——**学术语气**、**精简篇幅**（压缩 15%~30%）、**逻辑连贯**、**审稿回复**——作用于选中的文字；回答附带可切换显示的**词级 Diff**，清楚看到改了哪里。

### 💊 划词弹窗快捷操作

阅读器划词弹窗中，翻译旁边有一个快捷操作胶囊：根据选中内容（句子、公式、算法、表格……）推荐最合适的动作，其余动作收在 **更多** 里。可在「设置 → 划词与弹窗」中关闭。

### ⌨️ 全局快捷键

在文库面板和阅读器标签页中都可用，可在「设置 → 快捷键」中修改（`accel` 在 macOS 上是 ⌘，其他平台为 Ctrl）：

| 动作               | 默认            |
| ------------------ | --------------- |
| 聚焦输入框         | `accel+shift+M` |
| 针对选区提问       | `accel+shift+E` |
| 翻译选中内容       | `accel+shift+D` |
| 停止正在输出的回答 | `Esc`           |

### 🎨 丰富的渲染效果

- 完整的 **Markdown** 渲染，包括标题、列表、代码块和表格
- **LaTeX** 数学公式支持（KaTeX）
- 代码块 **语法高亮**
- 流畅的 **流式输出**

### 🌍 语言支持

插件界面当前支持 **12 种界面语言**：**English**、**简体中文**、**繁體中文**、**日本語**、**한국어**、**Français**、**Deutsch**、**Español**、**Русский**、**Português**、**العربية** 和 **हिन्दी**。全文翻译保留独立的目标语言列表，不受界面语言列表限制。

---

## 📦 安装

### 环境要求

- **Zotero 7 及以上**
- **Node.js**，OpenAI（Codex CLI）需要时可由插件自动安装

### 安装插件

1. 从 [Releases](https://github.com/Visterainer/aidea-zotero/releases) 下载最新的 `AIdea-x.x.x.xpi`
2. 在 Zotero 中进入 **工具 → 附加组件**
3. 点击齿轮图标 ⚙️，选择 **从文件安装附加组件...**
4. 选择下载的 `.xpi` 文件
5. 重启 Zotero

### 升级

直接安装新版 `.xpi` 文件即可覆盖旧版本。聊天记录、记忆数据和本地设置都会保留。

---

## 🚀 快速开始

### 1. 打开设置

进入 **工具 → 附加组件 → AIdea → 设置**。在较旧的 Zotero 版本中，也可能出现在 **编辑 → 首选项 → AIdea**。

### 2. 选择连接方式

AIdea 提供两种连接方式，可以只用其中一种，也可以同时使用。

#### 方式一：OAuth 登录

在每个服务商卡片中，通常按以下顺序完成设置：

> **① `安装/更新环境`** → **② `OAuth 登录`** → **③ `刷新模型`**

| 按钮                | 功能说明                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| **`安装/更新环境`** | 安装并配置所需 CLI 工具及运行环境，包括 Node.js 和 npm。GitHub Copilot 无需此步骤。                          |
| **`OAuth 登录`**    | 启动服务商对应的授权流程。OpenAI 会直接打开浏览器。GitHub Copilot 会显示 device code，并打开浏览器完成授权。 |
| **`刷新模型`**      | 登录成功后加载当前服务商可用的模型列表。                                                                     |
| **`删除授权`**      | 清除本地保存的 OAuth 令牌。                                                                                  |

<p align="center">
  <img src="../screenshots/settings_oauth_models_cn.png" alt="OAuth 提供商与模型管理" width="700" />
</p>

> 💡 **提示：** 每个服务商通常只需配置一次。登录状态保存在本地，重启 Zotero 后仍然有效。

#### 方式二：OpenAI 兼容 API 端点

AIdea 也支持连接任意 **OpenAI 兼容聊天端点**，适合本地、自托管或第三方兼容服务，例如 Ollama、LM Studio、vLLM、DeepSeek、OpenRouter 或 Groq。

在 **设置** 中切换到 **API Mode**，填写以下字段：

| 字段             | 必填 | 说明                                                                                |
| ---------------- | ---- | ----------------------------------------------------------------------------------- |
| **API Base URL** | 是   | 兼容端点的基础地址，例如 `https://api.openai.com/v1` 或 `http://localhost:11434/v1` |
| **API Key**      | 否   | 仅当端点需要认证时填写                                                              |
| **Model**        | 是   | 可手动输入模型 ID，或点击 **自动获取模型** 获取可用模型                             |

<p align="center">
  <img src="../screenshots/settings_api_cn.png" alt="API 模式自定义端点" width="700" />
</p>

> **注意：** API 模式面向兼容 `/chat/completions` 的端点，不保证对服务商特有能力的完全兼容。

### 3. 开始对话

- 在 **文库面板** 中选择条目，并使用右侧 AIdea 面板
- 在 **PDF 或 EPUB 阅读器** 中打开文档，并使用阅读器侧边栏中的 AIdea 面板
- 输入问题并点击 **发送**，或按 `Enter`

### 4. 使用快捷操作

点击 **总结**、**解释**、**翻译** 等快捷按钮即可一键执行常见操作。右键点击快捷按钮可编辑或删除。

---

## ⚙️ 配置选项

| 设置项              | 说明                                                     | 默认值            |
| ------------------- | -------------------------------------------------------- | ----------------- |
| **界面语言**        | 插件界面语言                                             | 自动检测，回退 EN |
| **系统提示词**      | 模型的自定义指令                                         | 空                |
| **显示 "Add Text"** | 在阅读器选择菜单中显示 Add Text                          | 开启              |
| **划词翻译**        | 在阅读器划词弹窗中翻译选中文本，并自动使用有界文档上下文 | 开启              |
| **划词翻译模型**    | 用于阅读器划词翻译的独立模型                             | 默认使用可用模型  |
| **显示所有模型**    | 显示全部模型而非精选模型                                 | 关闭              |
| **标签栏**          | 显示或隐藏标签导航栏                                     | 显示              |

设置页分为七个分区，顶部有固定的分区导航：**连接与模型**、**阅读助手**、**划词与弹窗**、**快捷键**、**外观**、**作者档案（Beta）**、**控制台**。在 **连接与模型** 中点击 **扫描本地服务**，会探测常见的本地推理端口（Ollama `11434`、LM Studio `1234`、LocalAI `8080`、vLLM `8000`、TextGen `5000`），点击结果即可填入 API Base URL。

---

## 🔒 隐私与安全

- OAuth 令牌**仅保存在本地**
- API 请求**直接发送**到所选服务商或你配置的端点
- AIdea **不收集遥测或用户数据**
- 聊天记录与记忆保存在 Zotero 的本地数据库中
- 源码可在 [GitHub](https://github.com/Visterainer/aidea-zotero) 公开查看

---

## 🗺️ 未来计划

计划中的方向包括：

- **一键生成框架图**：从论文内容中生成结构化可视图

> 💡 欢迎通过 [Issue](https://github.com/Visterainer/aidea-zotero/issues) 提出需求建议。

---

## 🎨 个性化优化与增强

本分支包含以下针对实际使用场景的深度优化与美化：

- **CLI 与 OAuth 环境智能识别**：全面增强对 macOS 环境下 Homebrew（`/opt/homebrew/bin`）以及 NVM 管理的多版本 Node/npm 全局模块路径（`~/.nvm/versions/node/*/lib/node_modules` 与 `bin`）的自动扫描，彻底解决从 Zotero GUI 启动时由于 PATH 缺失导致 Codex CLI 提示未找到的问题。
- **现代化对话界面美化**：
  - 重构“尚未准备好”状态卡片，采用现代磨砂拟态风格，彻底修复设置按钮文字断行折叠问题。
  - 美化快捷操作标签（摘要/翻译/要点等），升级为精致药丸胶囊按钮，增加柔和阴影与悬停微动效。
  - 输入框卡片一体化设计：去除杂乱的多层边框与原生缩放手柄，获得焦点时展示呼吸感柔光效果。
  - 优化底部操作栏与纸飞机发送按钮，交互更加流畅优雅。

---

## 🛠️ 开发

```bash
# 安装依赖
npm install

# 开发模式
npm start

# 构建生产版 XPI
npm run build

# 运行测试
npm run test:unit
```

---

## 📄 许可证

[AGPL-3.0-or-later](../../LICENSE)

本项目基于 [llm-for-zotero](https://github.com/yilewang/llm-for-zotero) 演进而来。完整第三方声明见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。

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
  作者：<strong>zhile</strong>
</p>
