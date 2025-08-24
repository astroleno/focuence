# Focuence智序 - Chrome扩展

一个基于Vue3的智能标签页管理工具，通过AI增强的注意力算法和智能分组技术，帮助用户高效管理浏览器标签页。

## 功能特性

- 🤖 **AI智能分组**: 自动将相关标签页分组，减少混乱
- 🎯 **注意力分析**: 识别重要标签页，优化工作流程  
- 🧹 **清理建议**: 智能建议可关闭的标签页
- ⚙️ **自定义设置**: 支持自定义AI API地址和模型
- 🎨 **现代UI**: 简洁优雅的用户界面

## 安装方法

1. 克隆或下载此项目
2. 打开Chrome浏览器，进入 `chrome://extensions/`
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择项目文件夹

## 目录结构

```
focuence/
├── manifest.json          # Chrome扩展配置
├── popup/                 # 弹窗界面
│   ├── index.html        # 主页面
│   ├── style.css         # 样式文件
│   └── app.js            # Vue3应用
├── options/              # 设置页面
│   ├── index.html        # 设置页面
│   ├── style.css         # 样式文件
│   └── settings.js       # Vue3应用
├── background.js         # 后台脚本
└── assets/               # 静态资源
    └── icon.svg          # 图标文件
```

## 技术栈

- **前端**: Vue3 (CDN方式)
- **样式**: 原生CSS
- **构建**: 无需构建工具
- **存储**: Chrome Storage API
- **API**: OpenAI兼容接口

## 配置说明

### API设置

在设置页面中配置AI API：

- **API地址**: 默认为 `https://yunwu.zeabur.app`
- **模型名称**: 默认为 `chatgpt-4o-mini`
- **API密钥**: 您的API密钥

### 权限说明

扩展仅请求必要的权限：
- `storage`: 存储用户设置
- `activeTab`: 访问当前活动标签页
- `tabs`: 管理标签页

## 使用方法

1. 点击工具栏中的Focuence图标打开弹窗
2. 点击"AI分组"按钮自动分组标签页
3. 点击"清理建议"查看可关闭的标签页
4. 点击设置按钮进行个性化配置

## 开发说明

这是一个轻量级的Chrome扩展，使用Vue3 CDN方式，无需复杂的构建工具。直接修改HTML、CSS、JS文件即可。

## 版权信息

© 2025@LessLand