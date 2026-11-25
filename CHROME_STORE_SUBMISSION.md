# Focuence 2.7.1 Chrome Web Store 提交材料

本轮核对的公开更新包是 **1.0.0**。候选 **2.7.1** 的更新目标为扩展 ID `alfcejiicdbndoijbcodgbgpdpnagphl` 对应的现有条目。开发者模式测试使用独立浏览器配置。审核状态以发布者后台为准。[现有商店条目](https://chromewebstore.google.com/detail/alfcejiicdbndoijbcodgbgpdpnagphl) · [上传与更新官方说明](https://developer.chrome.com/docs/webstore/update)

## 上传文件与验收

使用 `package-lock.json` 和 `model-lock.json` 固定的依赖及模型。首次准备工作树时按顺序运行以下命令。

```sh
npm ci --ignore-scripts
npm run models
npm run build
npm run package:store
(cd dist && shasum -a 256 -c Focuence-2.7.1-chrome-store.sha256)
npm test
```

上传文件是 `dist/Focuence-2.7.1-chrome-store.zip`。ZIP 根目录直接包含 `manifest.json`。包内有本机模型、匹配的 WASM、扩展界面、后台程序与第三方许可。校验文件 `dist/Focuence-2.7.1-chrome-store.sha256` 单独留存。常规 `npm run package` 仍生成离线和源码发行包。1.0.0 的旧提交目录和 ZIP 留作历史记录。[Chrome Web Store 打包说明](https://developer.chrome.com/docs/webstore/prepare)

将官方公开的 1.0.0 CRX3 保存为独立输入。更新端点可能在新版发布后提供其他版本，验收脚本固定该输入的 SHA-256 为 `0f99dac4fb93883103a6816dc3fa7a93abed709da6830f243bd174a3441c52cd`。以下命令需要先设置 `CHROME_PATH`，指向 Chrome for Testing 可执行文件。

```sh
node test/native/store-upgrade.mjs --old-crx=/path/to/store-1.0.0.crx
node test/native/model-regression.mjs --out=/path/to/native-results
```

升级验收从 1.0.0 的公开 CRX3 解包运行真实旧 worker，关闭隔离浏览器，从独立候选 ZIP 替换同一加载目录，再以同一 Chrome for Testing 配置启动。两份临时 manifest 都使用与公开扩展 ID 匹配的 CRX3 公钥。脚本阻断对外 HTTP(S)，使用合成的旧浏览记录、AI 配置和检索材料。它验证旧 `chrome.storage.local` 与 `chrome.storage.sync` 键仍在、新版业务数据和 AI 设置没有导入这些键、没有新增授予的站点或可选 API，以及工作台和随包语义模型可用。真机模型回归另外检查全新配置没有任何已授予的可选 API 或站点。实际候选 ZIP 内不写入部署用的 `key`。[Manifest key 说明](https://developer.chrome.com/docs/extensions/reference/manifest/key)

复现结果写到 `dist/Focuence-2.7.1-store-upgrade.json`，含两份输入的 SHA-256、Chrome 版本、权限警告及授予结果。截图 `dist/Focuence-2.7.1-chrome-store-1280x800.png` 使用实际候选工作台和合成任务。商店图标可复用 `icons/icon-128.png`。[商店素材说明](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)

在同一隔离配置中替换目录并重启后，扩展 ID 和本机存储保留。Chrome API 返回的是分别由两版 manifest 计算的安装警告。正式商店升级的签名校验、分发时序、扩展可能暂停及用户重新启用流程需要通过发布者侧另行确认。1.x 旧注意力和 AI 设置不迁移，旧 API 密钥可能仍留在浏览器扩展的 `chrome.storage.sync`。新版“清除 AI 服务”和“清除全部”都不会清掉该旧键。新版预测与补全保持默认关闭。[Chrome 权限警告](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings) · [Chrome Management API](https://developer.chrome.com/docs/extensions/reference/api/management)

Chrome for Testing 156.0.8078.47 计算的 1.0.0 安装警告有四项，包括读取和更改旧固定站点数据、读取浏览记录、显示通知、查看和管理标签页组。2.7.1 沿用 2.7.0 的权限声明，其必需权限触发读取浏览记录与查看和管理标签页组两项警告。2.7.1 的开发者模式替换测试观察到 Chrome 会把旧版的 `https://yunwu.zeabur.app/*` 保留为已授权站点，因为可选 HTTPS 模式涵盖该地址。新版 AI 仍处于默认关闭状态。发布者应另行核实正式签名更新中的授权结果。

## 商店条目文案

| 字段 | 内容 |
| --- | --- |
| 名称 | Focuence 智序 · 本机优先 |
| 版本 | 2.7.1 |
| 主类别 | 生产力 |
| 主要语言 | 简体中文 |
| 技术环境 | Manifest V3，Chrome 120 或更新版本 |
| 简短描述 | 用注意力地图、当前聚焦与分组接续工作。本机记录与语义找回，可选自己的 AI 服务预测下一步并补全文字。 |

**详细描述**

Focuence 智序把标签页分组、任务接续和资料找回放在浏览器里。通过弹窗、原生侧栏或工作台查看当前任务，保存工作断点，并在下一次打开浏览器时继续。

- 在扩展内了解并确认开启前台浏览记录后，可用注意力地图查看本机访问与切换。标签页与原生分组可随时整理。
- 将网页和选文保存到资料库，使用随包的本机语义模型找回材料。可按需开启浏览器历史导入或查看最近关闭的标签页。
- 保存任务目标、下一步和继续页面。支持本机 JSON 备份、导入和数据清理。
- 可选配置自己的 AI 服务，按需生成下一步候选或补全文字。首次使用默认关闭。

**本次更新**

新版加入本机语义找回、跨任务资料库、任务断点和注意力地图。找回线索会逐步更新，当前聚焦优先显示断点与继续动作。原商店版本的 AI 设置需要在新版重新配置，新版不会导入 1.x 的旧注意力记录。

## 权限用途

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存会话状态、可撤销分组、临时检索作业和用户配置的 AI 服务设置。主要历史和资料保存在本机 IndexedDB。 |
| `tabs` | 读取标签页标题、地址及状态，用于本机分组、前台记录、检索与恢复。 |
| `tabGroups` | 读取原生标签页群组并执行用户确认的分组操作。 |
| `idle` | 区分前台使用、空闲与锁屏，避免将空闲计入前台时长。 |
| `alarms` | 定期清理过期记录和草稿，并在空闲后回收模型后台页。 |
| `offscreen` | 提供本机 ONNX/WASM 推理所需的扩展文档与 worker。 |
| `sidePanel` | 打开工作侧栏，显示当前任务、分组及接续操作。 |
| 可选 `sessions` | 用户授权后显示设备上近期关闭的标签页。 |
| 可选 `history` | 用户授权并操作后导入所选时间范围内的本设备浏览器历史。 |
| 可选 `contextMenus` | 用户授权后提供“右键保存选文”，只接收用户主动提交的选文。 |
| 可选站点权限 `https://*/*`、`http://localhost/*`、`http://127.0.0.1/*` | 允许用户为自己配置的 AI 服务单独授权其来源。配置可使用 HTTPS 服务或本机回环 HTTP 开发服务。 |

1.0.0 声明的 `activeTab`、`notifications` 及固定服务 `https://yunwu.zeabur.app/*` 已从必需权限移除。

## 数据使用和审核说明

扩展的单一用途是帮助用户整理浏览任务并继续之前的工作。浏览活动、标签标题和网址、用户保存的选文与任务文字，以及本机诊断所用的事件字段都需要按后台当前口径评估披露，即便平时只在本机处理。应用无账户、广告或第三方统计上报。本机语义模型和执行代码随包加载。

前台浏览记录默认关闭，适用于新安装及没有本机同意状态的升级配置。审阅者可点弹窗、侧栏、工作台或地图中的“开启记录”，也可在“数据与设置”打开记录开关并保存。对话框说明保存的网址、标题、停留时间、切换记录、用途以及暂停和删除入口。只有点击“同意并开始记录”后才开始。导入备份不会开启记录，“清除全部”会关闭记录并撤销本机同意。

可选 AI 支持 OpenAI Chat Completions、Anthropic Messages 和 OpenCode Go 接口。用户配置服务地址、模型和密钥并授予该站点权限以后，仅主动获取候选时才向该服务发送请求。预测使用有限任务文字和最多 12 个候选的编号、标题、主题和依据。补全使用当前输入与有限任务上下文。请求不发送完整浏览历史、资料库原文、任务笔记、网页正文或候选 URL。密钥留在本机扩展存储，不进入备份。详见 [2.7.1 隐私说明](PRIVACY.md)。

审核人员无需账户或 AI API 密钥即可验收主要功能。可打开几个主题各异的普通网页，在工作台查看标签、保存任务，再运行语义找回；可选 AI 和浏览器历史均可保持关闭。

## 发布者后台待核对

- 确认编辑的是现有条目、当前发布版本和关联发布者账户。提交审核时选择通过后手动发布，待审核通过再另行决定生效。核对正式更新是否会需要用户重新授权。[更新与审核](https://developer.chrome.com/docs/webstore/update)
- 核对商店类别、主语言、128×128 图标、真实新版截图、后台要求的推广素材和支持联系方式。[商店条目要求](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements/)
- 核对数据用途、权限理由、用户数据类别、传输及远程代码相关字段。发布者应审核并自行提交相关声明。
- 隐私政策使用公开的 [GitHub 隐私说明](https://github.com/astroleno/focuence/blob/main/PRIVACY.md)。项目 [GitHub 主页](https://github.com/astroleno/focuence#readme) 顶部直达数据有限使用声明。送审前检查两个链接无需登录且已显示 2.7.1 内容。[Chrome 用户数据披露要求](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq/)
