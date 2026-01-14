# coursera-subtitle-tuner

## 中文
一个面向 Coursera 的字幕调节扩展：合并多行字幕，并优化字幕位置表现。

Coursera 字幕调节器 - MVP

安装：
1) 打开 Chrome -> chrome://extensions
2) 开启开发者模式
3) 点击“加载已解压的扩展程序”，选择本文件夹

测试：
- 打开任意 Coursera 视频页面
- 你会在视频控制条附近看到 “CC+” 按钮
- 点击它打开字幕设置面板

备注：
- Coursera 的 DOM 经常变化。如果按钮未出现，请在视频可见时刷新页面
- 如需支持更多网站，在 manifest 的 host_permissions/matches 中添加，并在 content.js 中添加站点适配器

隐私政策：
见 `PRIVACY.md`。

## English
A Coursera-focused subtitle tuner that unifies multi-line captions and improves subtitle positioning behavior.

Coursera Subtitle Tuner - MVP

Install:
1) Open Chrome -> chrome://extensions
2) Enable Developer mode
3) Click "Load unpacked" and select this folder.

Test:
- Open a Coursera video page
- You should see a "CC+" button on/near the video controls.
- Click it to open subtitle settings panel.

Notes:
- Coursera DOM changes frequently. If button doesn't appear, refresh when video is visible.
- To support more websites, add them to manifest host_permissions/matches and add a site adapter in content.js.

Privacy policy:
See `PRIVACY.md`.
