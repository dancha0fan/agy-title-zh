# Agy Title ZH (`agy-title-zh`)

自动将 **Antigravity 2.0** 原生生成的英文会话标题翻译为中文并写回的轻量级独立插件。

## 特性

- **零配置开箱即用**：默认使用免 Key 的 Google 翻译接口，不消耗 Antigravity 模型额度，也不产生多余对话轮次。
- **不覆盖手动改名**：仅处理原生自动生成且不含中文的英文标题；你手动重命名过的会话、已有中文的会话、子智能体会话与已归档会话都不会被修改。
- **本地缓存与防重复**：翻译结果持久化缓存在本地，断网或接口超时时静默保留原英文并退避重试。
- **独立插件、零第三方依赖**：纯 Node.js（`>= 22.13`）标准库实现，不修改 Antigravity 安装包，可与 `agy-powertools` 等其他插件和平共存。
- **可选自定义模型翻译**：支持通过本地 `config.json` 切换为任意 OpenAI 兼容接口（如 DeepSeek、本地 Ollama 等）。

## 环境要求

- 已安装并至少启动过一次 Antigravity 2.0（且客户端已开启本地调试端口 `DevToolsActivePort`）。
- 本机 Node.js `>= 22.13`（未安装时安装脚本会自动回退到 Antigravity 自带的 `agy-node`）。

## 安装与卸载

### 安装

克隆仓库或下载源码后，在项目目录执行：

Windows (PowerShell)：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

macOS / Linux：

```sh
sh ./install.sh
```

安装过程不会强制关闭正在运行的 Antigravity，也不会改动其他插件、账号或聊天记录。安装后如未自动生效，完成手头任务重启一次 Antigravity 即可。

### 卸载

Windows (PowerShell)：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

macOS / Linux：

```sh
sh ./uninstall.sh
```

如需在卸载时保留本地配置与翻译缓存，可追加 `--keep-data`。

## 可选配置

默认无需创建任何配置文件。如需自定义翻译源或暂停功能，可在以下路径创建 `config.json`：

- `~/.gemini/antigravity/plugin_data/agy-title-zh/config.json`

示例（切换为 OpenAI 兼容接口）：

```json
{
  "enabled": true,
  "provider": "openai",
  "targetLang": "zh-CN",
  "pollIntervalMs": 3000,
  "batchSize": 2,
  "openai": {
    "baseUrl": "https://api.deepseek.com/v1",
    "apiKey": "sk-your-key",
    "model": "deepseek-chat"
  }
}
```

如果只想临时关闭自动翻译，把 `"enabled"` 设为 `false` 即可（无需重启客户端）。

## 工作原理

1. 侧载进程读取 Antigravity 的 `DevToolsActivePort`，通过本机 CDP 连接到主窗口。
2. 通过 React Fiber 读取当前会话列表（`trajectorySummaries`），筛选出未手动改名、未归档、非子智能体且为纯英文的自动标题。
3. 在后台 Node 进程中完成翻译并写入本地缓存，再调用客户端原生 `updateConversationAnnotations` 接口写回中文标题。

## 本地测试

```sh
npm test
```

## 致谢与协议

- 调试端口接入与插件注册思路参考了开源项目 [WhiteBr1ck/agy-powertools](https://github.com/WhiteBr1ck/agy-powertools)（MIT License）。
- 本项目基于 [MIT License](LICENSE) 开源。
