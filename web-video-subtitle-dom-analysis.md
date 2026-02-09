# 网页视频字幕元素定位与验证（DeepLearning.AI 播放器案例）

## 目的

本文档记录了一次**完整、可复现、可验证**的网页视频字幕 DOM 定位过程，  
用于在 **AI 工具 / 浏览器插件 / 自动化脚本开发** 中作为参考范例。

核心问题：

> **网页视频中显示的字幕，最终属于哪个 DOM 元素？**

---

## 一、问题背景

在 DeepLearning.AI 课程页面中：

- 视频播放时可以看到英文字幕
- 使用 Chrome DevTools（F12）检查字幕区域
- 只能选中 `<video>` 或播放器整体
- 无法直接选中字幕文本

需要确定字幕的**真实渲染方式与 DOM 位置**。

---

## 二、排查思路总览

本次排查遵循以下工程化思路：

1. **排除烧录字幕（硬字幕）**
2. **排除浏览器原生 `<track>` 渲染**
3. **确认是否为 DOM overlay**
4. **定位具体字幕容器与文本节点**
5. **通过“可证伪验证”确认结论**

---

## 三、关键排查步骤（摘要）

### 1. 全局搜索字幕文本

- `Ctrl + Shift + F` 搜索字幕文本
- 命中位置为：
  - `div.hidden`
  - `script#__NEXT_DATA__`

结论：

> 字幕文本存在于页面数据中，但 **不是直接渲染节点**

---

### 2. 检查 video.textTracks

```js
document.querySelector("video").textTracks
```

结果：

- 存在 textTracks
- `activeCues` 为空
- 强制 `mode = "showing"` 后仍无字幕

结论：

> **字幕不是浏览器原生 `<track>` 渲染**

---

### 3. 扫描视频底部 overlay DOM

通过 Console 扫描：

- `position: absolute / fixed`
- 覆盖视频下半区域
- 文本包含字幕内容

最终锁定元素：

```css
.vds-captions
```

---

### 4. Elements 面板确认结构

DOM 结构（简化）：

```html
<div class="vds-captions" data-part="captions">
  <div class="vds-cue">
    AI assistant as a good response.
    You will use DPO on a small Qwen
  </div>
</div>
```

---

## 四、最终结论（已验证）

> ### ✅ 视频字幕使用 DOM Overlay 渲染

### 1️⃣ 字幕容器层

```css
.vds-captions
```

- 覆盖在视频画面之上
- 负责字幕整体布局与定位
- 隐藏该元素会导致字幕整体消失

---

### 2️⃣ 字幕文本节点（关键结论）

```css
.vds-captions .vds-cue
```

- 每一条字幕对应一个 `.vds-cue`
- 实际显示的字幕文字就在此节点中
- 可直接修改其 `innerText` / 样式

---

## 五、验证方法（可复现、可证伪）

### 验证 1：隐藏法（已执行）

```js
document.querySelector(".vds-captions").style.display = "none";
```

结果：

- 字幕立刻消失
- 视频播放正常

✅ 结论成立：`.vds-captions` 是字幕层

---

### 验证 2：内容替换法（推荐）

```js
document.querySelector(".vds-captions .vds-cue").innerText =
  "THIS IS A TEST SUBTITLE";
```

若画面字幕同步变化：

✅ 结论成立：`.vds-cue` 是字幕文本节点

---

### 验证 3：字幕变化监听（可选）

```js
const cue = document.querySelector(".vds-captions .vds-cue");

new MutationObserver(() => {
  console.log("字幕变化：", cue.innerText);
}).observe(cue, {
  childList: true,
  characterData: true,
  subtree: true
});
```

---

## 六、工程级总结（可直接引用）

> 本页面视频字幕并非浏览器原生 `<track>` 渲染，也非 canvas 绘制，
> 而是播放器使用 **DOM overlay** 方式实现。
>
> - `.vds-captions`：字幕 overlay 容器层
> - `.vds-cue`：实际字幕文本 DOM 节点

---

## 七、适用场景

本结论与方法适用于：

- 浏览器插件开发（字幕增强 / 翻译）
- 自动字幕抓取工具
- AI 视频理解 / 对齐
- 网页播放器逆向分析
- 前端 Debug / 教学示例

---

## 八、关键词索引

- DOM Subtitle Overlay
- `.vds-captions`
- `.vds-cue`
- Web Video Subtitle Debug
- Chrome DevTools 字幕定位

---

**文档结束**
