# How Did I Get Here?

一个 Chrome MV3 插件 MVP，用来记录浏览器里的研究路径，把普通网页浏览自动整理成可以恢复的研究主题。

## 已实现功能

- 自动记录普通 `http` 和 `https` 网页访问。
- 使用 `chrome.storage.local` 本地保存 Page Node、Page Edge、Research Topic、设置、黑名单和 AI 授权状态。
- 默认跳过敏感类别网站，并支持用户自定义域名黑名单。
- 通过 opener tab 和 `document.referrer` 记录网页来源关系。
- 无后端也能用本地规则生成 Research Topic。
- 首次授权后支持直连 AI 进行主题聚类。
- Side Panel 展示研究主题卡片、主题树、网页详情和关系线索。
- 支持点击 `Continue research` 重新打开核心页面和待读页面。

## 本地加载插件

1. 打开 Chrome。
2. 访问 `chrome://extensions`。
3. 打开右上角的 `Developer mode`。
4. 点击 `Load unpacked`。
5. 选择本项目目录：`D:\Programs\Personal\Chrome-Plguin\网页关系图`。
6. 在浏览器工具栏固定 `How Did I Get Here?`。
7. 点击插件图标，打开右侧 Side Panel。

## 本地测试流程

1. 加载插件后，先打开几个相关网页，例如：
   - `https://developer.chrome.com/docs/extensions/`
   - `https://developer.chrome.com/docs/webstore/`
   - `https://stripe.com/docs`
   - `https://www.lemonsqueezy.com/`
2. 从一个页面点击链接打开另一个页面，或者从搜索引擎结果页打开目标页面，用来测试来源关系。
3. 打开插件 Side Panel。
4. 第一次会看到 AI 授权提示：
   - 点击 `Enable AI grouping`：允许 AI 聚类。
   - 点击 `Local only`：只用本地规则聚类。
5. 点击右上角 `Refresh`，生成或刷新研究主题。
6. 点击任意主题卡片，查看：
   - Core pages
   - To read
   - Related pages
   - 页面标签、阅读进度和关系线索
7. 点击 `Continue research`，确认插件会重新打开该主题的核心页面和待读页面。

## 测试隐私和黑名单

1. 在 Side Panel 点击 `Privacy`。
2. 在 `Domain blacklist` 输入一个域名，例如：

```text
stripe.com
mail.google.com
```

3. 点击 `Save privacy settings`。
4. 再访问这些域名，确认它们不会进入主题树，也不会进入 AI 聚类 payload。

## AI 配置

内测用的 API Key、模型名和接口地址配置在 `background.js`：

```js
const AI_API_KEY = "...";
const AI_MODEL = "qwen3.7-plus";
const AI_ENDPOINT = "https://llm-4hryrnsg5f8wv91v.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions";
```

当前实现使用 OpenAI-compatible `chat/completions` 请求格式。这个方式适合个人和内测验证；如果未来公开上架，应该改成代理服务或用户自带 Key。

## 开发命令

运行单元测试：

```bash
npm test
```

运行语法检查：

```bash
node --check background.js
node --check contentScript.js
node --check sidepanel.js
```

## 常见问题

### 为什么没有立刻出现主题？

先打开几个相关网页，然后回到 Side Panel 点击 `Refresh`。本地聚类需要至少有一些已记录页面才会形成主题。

### 为什么某些页面没有被记录？

插件只记录 `http` 和 `https` 页面。Chrome 内置页面、扩展商店、部分受保护页面、黑名单域名和敏感类别网站会被跳过。

### 修改代码后怎么生效？

回到 `chrome://extensions`，找到 `How Did I Get Here?`，点击刷新按钮重新加载扩展。然后重新打开 Side Panel 测试。
