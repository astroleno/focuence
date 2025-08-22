# Focuence智序 - AI智能标签页管理

基于注意力知识图谱的AI驱动标签页分组工具，帮助用户高效管理浏览器标签页。

## 核心特性

- **🧠 注意力知识图谱** - 基于用户行为模式构建标签页关系网络
- **🤖 AI智能分组** - 使用gpt-4o-mini等AI模型进行语义分组
- **⚡ 工作流识别** - 智能识别开发、研究、学习等工作模式
- **🎯 清理建议** - 基于注意力分数推荐可关闭的标签页
- **🎨 简洁设计** - 黑白灰配色，专业优雅的用户界面

## 技术架构

- **Frontend**: React 18 + TypeScript
- **Build**: Vite
- **Chrome API**: Manifest V3
- **AI支持**: OpenAI、Anthropic、DeepSeek
- **存储**: Chrome Storage API (本地存储)

## 开发指南

### 安装依赖
```bash
npm install
```

### 开发模式
```bash
npm run dev
```

### 构建生产版本
```bash
npm run build
```

### 加载到Chrome
1. 打开 `chrome://extensions/`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `dist` 文件夹

## 使用方法

1. **配置AI**: 在设置页面输入OpenAI等API密钥
2. **智能分组**: 点击popup中的"智能分组"按钮
3. **查看洞察**: AI会分析您的工作模式并给出建议
4. **清理建议**: 获得基于注意力分数的清理建议

## 隐私保护

- 所有数据处理在本地完成
- 不会上传用户数据到外部服务器
- API密钥本地加密存储
- 用户完全控制自己的数据

## 许可证

MIT License