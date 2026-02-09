const STORAGE_KEY = "subtitle_tuner_v19_click_outside"; 

const DEFAULTS = {
  pos: "bottom",
  posOffset: 0,       
  lineHeight: 120,
  fontSize: 24,
  textColor: "#ffffff",
  bgColor: "#000000",
  bgOpacity: 65,
  outline: 0,
  bgMode: "fit"
};

function getContextDefaults() {
  const defaults = { ...DEFAULTS };
  if (isCourseraContext()) {
    defaults.fontSize = 22;
  }
  return defaults;
}

let currentState = { ...getContextDefaults() };
let panelEl = null;
const cueHandlers = new WeakMap();
let mountRaf = 0;
let courseraSubtitleRefreshRaf = 0;
let courseraSubtitleRefreshRoot = null;
const videoBaselineRects = new WeakMap();

const PLAYER_FRAME_HOSTS = ["player.vimeo.com", "fast.wistia.net"];
const PLAYER_FRAME_HOST_SUFFIXES = [".wistia.com"];

function hostnameEndsWith(hostname, suffix) {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

function parseHost(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function getAncestorHosts() {
  const origins = window.location.ancestorOrigins;
  if (!origins || !origins.length) return [];
  return Array.from(origins).map(parseHost).filter(Boolean);
}

function isDeepLearningHost(hostname = window.location.hostname.toLowerCase()) {
  return hostnameEndsWith(hostname, "deeplearning.ai");
}

function isCourseraHost(hostname = window.location.hostname.toLowerCase()) {
  return hostnameEndsWith(hostname, "coursera.org");
}

function isCourseraContext() {
  const hostname = window.location.hostname.toLowerCase();
  if (isCourseraHost(hostname)) return true;
  if (!window.top || window.top === window.self) return false;
  const refHost = parseHost(document.referrer);
  if (isCourseraHost(refHost)) return true;
  return getAncestorHosts().some(isCourseraHost);
}

function isDeepLearningContext() {
  const hostname = window.location.hostname.toLowerCase();
  if (isDeepLearningHost(hostname)) return true;
  if (!window.top || window.top === window.self) return false;
  const refHost = parseHost(document.referrer);
  if (isDeepLearningHost(refHost)) return true;
  return getAncestorHosts().some(isDeepLearningHost);
}

function isAllowedPlayerFrameHost(hostname = window.location.hostname.toLowerCase()) {
  if (PLAYER_FRAME_HOSTS.includes(hostname)) return true;
  return PLAYER_FRAME_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function isSupportedReferrerHost(hostname) {
  return isDeepLearningHost(hostname) || isCourseraHost(hostname);
}

function shouldRunOnCurrentPage() {
  const hostname = window.location.hostname.toLowerCase();
  if (isCourseraHost(hostname) || isDeepLearningHost(hostname)) return true;

  if (!window.top || window.top === window.self) return false;
  if (!isAllowedPlayerFrameHost(hostname)) return false;

  const refHost = parseHost(document.referrer);
  if (isSupportedReferrerHost(refHost)) return true;
  return getAncestorHosts().some(isSupportedReferrerHost);
}

function findDeepLearningPlayerRoot(video) {
  if (!video) return null;

  const selectors = [
    ".video-js",
    ".vjs-player",
    "[data-vjs-player]",
    '[class*="video-js" i]',
    '[class*="wistia" i]',
    '[id*="wistia" i]',
    '[data-testid*="video-player" i]',
    '[data-testid*="player" i]',
    '[class*="player" i][class*="video" i]',
    '[id*="player" i][id*="video" i]',
    '[class*="vds-player" i]',
    '[class*="vidstack" i]'
  ];

  let candidate = video.closest(selectors.join(","));
  if (candidate) return candidate;

  // DeepLearning.AI Vidstack player: find container that has .vds-captions
  let vdsCaptions = document.querySelector('.vds-captions');
  if (vdsCaptions) {
    // Find the closest parent that contains the video
    let node = vdsCaptions.parentElement;
    while (node && node !== document.body) {
      if (node.contains(video)) return node;
      node = node.parentElement;
    }
    // If video is inside vds-captions' parent, use that
    if (vdsCaptions.parentElement && vdsCaptions.parentElement.contains(video)) {
      return vdsCaptions.parentElement;
    }
  }

  // DeepLearning.AI: Check if video is inside a media controller or player container
  let mediaController = video.closest('[data-media-player], media-controller, [class*="media-player" i]');
  if (mediaController) return mediaController;

  let node = video.parentElement;
  while (node && node !== document.body) {
    const rect = node.getBoundingClientRect();
    if (rect.width >= video.clientWidth * 0.95 && rect.height >= video.clientHeight * 0.95) {
      const hasControls = !!node.querySelector(
        'button, [role="button"], [role="slider"], [class*="control" i], [aria-label*="fullscreen" i], [aria-label*="caption" i], [aria-label*="cc" i]'
      );
      if (hasControls) return node;
    }
    node = node.parentElement;
  }

  return video.parentElement;
}

function rgba(hex, opacity01) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0,2), 16);
  const g = parseInt(h.substring(2,4), 16);
  const b = parseInt(h.substring(4,6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity01})`;
}

async function loadState() {
  return new Promise((resolve) => {
    const defaults = getContextDefaults();
    chrome.storage.sync.get([STORAGE_KEY], (res) => {
      resolve({ ...defaults, ...(res[STORAGE_KEY] || {}) });
    });
  });
}
async function saveState(state) {
  currentState = state;
  chrome.storage.sync.set({ [STORAGE_KEY]: state });
}

function getSubtitleScale(playerRoot) {
  const video = (playerRoot && playerRoot.querySelector("video")) || document.querySelector("video");
  if (!video) return 1;

  const rect = video.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return 1;

  const isFullscreen = !!document.fullscreenElement;
  if (!isFullscreen) {
    videoBaselineRects.set(video, { width: rect.width, height: rect.height });
    return 1;
  }

  const baseline = videoBaselineRects.get(video);
  if (!baseline || baseline.width <= 0 || baseline.height <= 0) return 1;

  const scale = Math.min(rect.width / baseline.width, rect.height / baseline.height);
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(3, Math.max(0.8, scale));
}

function applyState(state, playerRoot) {
  const root = document.documentElement;
  let yVal = state.pos === "bottom" ? -1 * state.posOffset : state.posOffset;
  const scale = getSubtitleScale(playerRoot);
  const effectiveFontSize = Math.round(state.fontSize * scale * 10) / 10;

  root.style.setProperty("--st-font-size", `${effectiveFontSize}px`);
  root.style.setProperty("--st-line-height", `${state.lineHeight / 100}`);
  root.style.setProperty("--st-color", state.textColor);
  root.style.setProperty("--st-bg", rgba(state.bgColor, state.bgOpacity / 100));
  root.style.setProperty("--st-outline", `${state.outline}px`);
  root.style.setProperty("--st-translate-y", `${yVal}vh`);
  root.classList.remove("st-bg-mode-fit", "st-bg-mode-uniform");
  root.classList.add(state.bgMode === "uniform" ? "st-bg-mode-uniform" : "st-bg-mode-fit");

  if (playerRoot) {
    playerRoot.classList.add("st-player-root");
    playerRoot.classList.remove("st-pos-top", "st-pos-bottom");
    playerRoot.classList.add(state.pos === "top" ? "st-pos-top" : "st-pos-bottom");

    // 更新所有动态创建的背景层
    const bgLayers = playerRoot.querySelectorAll('.st-bg-layer');
    bgLayers.forEach(bg => {
      bg.style.background = "transparent";
    });

    const wrappers = playerRoot.querySelectorAll('.st-multiline-wrapper');
    wrappers.forEach((wrapper) => renderUnifiedBackground(wrapper));

    if (isDeepLearningContext()) {
      scheduleDeepLearningOverlayRender(playerRoot);
    }

  }
}

function createPanelHTML() {
  return `
    <div class="st-row">
      <label>Dock</label>
      <select id="st-pos">
        <option value="bottom">Bottom</option>
        <option value="top">Top</option>
      </select>
    </div>
    <div class="st-row">
      <label>V-Offset</label>
      <input id="st-po" type="range" min="-20" max="20" step="1" title="Left=Down, Right=Up">
    </div>
    <div class="st-row">
      <label>Line Height</label>
      <input id="st-lh" type="range" min="80" max="250" step="5">
    </div>
    <div class="st-row">
      <label>Font Size</label>
      <input id="st-fs" type="range" min="12" max="60" step="1">
    </div>
    <div class="st-row">
      <label>Color</label>
      <input id="st-tc" type="color">
    </div>
    <div class="st-row">
      <label>Bg Color</label>
      <input id="st-bc" type="color">
    </div>
    <div class="st-row">
      <label>Opacity</label>
      <input id="st-op" type="range" min="0" max="100" step="1">
    </div>
    <div class="st-row">
      <label>Bg Mode</label>
      <select id="st-bgm">
        <option value="fit">Fit Text</option>
        <option value="uniform">Unified</option>
      </select>
    </div>
    <div class="st-row">
      <label>Outline</label>
      <input id="st-ol" type="range" min="0" max="4" step="1">
    </div>
    <div class="st-btns">
      <button id="st-reset" class="st-btn">Default</button>
      <button id="st-close" class="st-btn">Close</button>
    </div>
  `;
}

function initPanel() {
  if (document.getElementById("st-panel")) return document.getElementById("st-panel");
  const div = document.createElement("div");
  div.id = "st-panel";
  div.className = "st-panel";
  div.innerHTML = createPanelHTML();
  document.body.appendChild(div);
  
  const map = {
    "st-pos": [ "change", (v) => currentState.pos = v ],
    "st-po":  [ "input",  (v) => currentState.posOffset = Number(v) ],
    "st-lh":  [ "input",  (v) => currentState.lineHeight = Number(v) ],
    "st-fs":  [ "input",  (v) => currentState.fontSize = Number(v) ],
    "st-tc":  [ "input",  (v) => currentState.textColor = v ],
    "st-bc":  [ "input",  (v) => currentState.bgColor = v ],
    "st-op":  [ "input",  (v) => currentState.bgOpacity = Number(v) ],
    "st-bgm": [ "change", (v) => currentState.bgMode = v === "uniform" ? "uniform" : "fit" ],
    "st-ol":  [ "input",  (v) => currentState.outline = Number(v) ],
  };

  for (let id in map) {
    const el = div.querySelector("#" + id);
    if (el) {
      const eventType = map[id][0];
      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        map[id][1](e.target.value);
        saveState(currentState);
        applyState(currentState, findPlayerRoot());
      };
      el.addEventListener(eventType, handler);
      // 为 change 事件也添加 input 监听，确保实时更新
      if (eventType === "change") {
        el.addEventListener("input", handler);
      }
    } else {
      console.warn(`Element #${id} not found`);
    }
  }

  const resetBtn = div.querySelector("#st-reset");
  if (resetBtn) {
    resetBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      currentState = { ...getContextDefaults() };
      syncPanelUI();
      saveState(currentState);
      applyState(currentState, findPlayerRoot());
    };
  }

  const closeBtn = div.querySelector("#st-close");
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      div.classList.remove("st-open");
    };
  }
  return div;
}

function syncPanelUI() {
  if (!panelEl) return;
  const setVal = (id, val) => { const el = panelEl.querySelector("#" + id); if (el) el.value = val; };
  setVal("st-pos", currentState.pos);
  setVal("st-po", currentState.posOffset);
  setVal("st-lh", currentState.lineHeight);
  setVal("st-fs", currentState.fontSize);
  setVal("st-tc", currentState.textColor);
  setVal("st-bc", currentState.bgColor);
  setVal("st-op", currentState.bgOpacity);
  setVal("st-bgm", currentState.bgMode || "fit");
  setVal("st-ol", currentState.outline);
}

function findPlayerRoot() {
  const v = document.querySelector("video");
  if (!v) return null;
  if (isDeepLearningHost() || isAllowedPlayerFrameHost()) {
    return findDeepLearningPlayerRoot(v);
  }
  return v.closest(".rc-VideoPlayer, .c-video-player, .video-js") || v.parentElement.parentElement || v.parentElement;
}

function isLikelyControlElement(node) {
  if (!node || !(node instanceof Element)) return false;
  if (node.matches("button, [role='button'], input, [role='slider']")) return true;
  if (node.closest(".vjs-control-bar, .vjs-control, .vjs-menu, .vjs-menu-button")) return true;
  if (node.closest("[class*='control-bar' i], [class*='controls' i]")) return true;
  const className = String(node.className || "");
  return /button|control|menu|toggle|icon/i.test(className);
}

let deepLearningOverlayObserver = null;
let deepLearningOverlayObservedHost = null;
let deepLearningOverlayObservedRoot = null;
let deepLearningOverlayRenderRaf = 0;
let deepLearningOverlayLastKey = "";

function getDeepLearningOverlayMountHost() {
  const fsEl = document.fullscreenElement;
  if (fsEl && fsEl instanceof Element && fsEl.tagName !== "VIDEO") {
    return fsEl;
  }
  return document.body;
}

function clearDeepLearningOverlayState(playerRoot) {
  if (playerRoot) playerRoot.classList.remove("st-dl-overlay-active");
  if (deepLearningOverlayObservedRoot) {
    deepLearningOverlayObservedRoot.classList.remove("st-dl-overlay-active");
  }
  const layer = document.getElementById("st-dl-overlay-layer");
  if (layer) layer.style.display = "none";
}

function getDeepLearningOverlayLayer() {
  let layer = document.getElementById("st-dl-overlay-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "st-dl-overlay-layer";
    layer.className = "st-dl-overlay-layer";
  }
  const host = getDeepLearningOverlayMountHost();
  if (layer.parentElement !== host) host.appendChild(layer);
  return layer;
}

function collectDeepLearningCueLines(captionHost) {
  if (!captionHost) return [];
  const cueNodes = captionHost.querySelectorAll(
    ".vds-cue, [data-part='cue'], .vjs-text-track-cue"
  );
  const lines = [];
  cueNodes.forEach((node) => {
    const text = (node.textContent || "").trim();
    if (!text) return;
    text.split(/\r?\n/).forEach((part) => {
      const normalized = part.trim();
      if (normalized) lines.push(normalized);
    });
  });
  return Array.from(new Set(lines)).slice(0, 4);
}

function getCaptionTextUnits(text) {
  let units = 0;
  for (const ch of text) {
    units += /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch) ? 2 : 1;
  }
  return units;
}

function findSplitIndexNearCenter(text) {
  const breakChars = /[\s,.;:!?，。！？；：、]/;
  const center = Math.floor(text.length / 2);
  let best = -1;
  let bestDistance = Infinity;

  for (let i = 1; i < text.length - 1; i += 1) {
    if (!breakChars.test(text[i])) continue;
    const distance = Math.abs(i - center);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

function splitCaptionLineToTwo(text, maxUnitsPerLine) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (getCaptionTextUnits(normalized) <= maxUnitsPerLine) {
    return [normalized];
  }

  const splitAt = findSplitIndexNearCenter(normalized);
  if (splitAt > 0) {
    const left = normalized.slice(0, splitAt).trim();
    const right = normalized.slice(splitAt + 1).trim();
    if (left && right) {
      return [left, right];
    }
  }

  let currentUnits = 0;
  let hardSplit = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    currentUnits += /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(normalized[i]) ? 2 : 1;
    if (currentUnits >= maxUnitsPerLine) {
      hardSplit = i + 1;
      break;
    }
  }

  if (hardSplit <= 0 || hardSplit >= normalized.length) return [normalized];
  return [normalized.slice(0, hardSplit).trim(), normalized.slice(hardSplit).trim()].filter(Boolean);
}

function formatDeepLearningOverlayLines(rawLines) {
  const cleaned = rawLines.map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!cleaned.length) return [];

  const maxUnitsPerLine = 36;
  if (cleaned.length >= 2) {
    const merged = cleaned.slice(0, 2).join(" ").trim();
    const formatted = splitCaptionLineToTwo(merged, maxUnitsPerLine);
    return formatted.slice(0, 2);
  }

  return splitCaptionLineToTwo(cleaned[0], maxUnitsPerLine).slice(0, 2);
}

function isDeepLearningControlBarVisible(playerRoot) {
  if (!playerRoot) return false;
  const bars = playerRoot.querySelectorAll(
    ".vjs-control-bar, [class*='control-bar' i], [class*='controls' i]"
  );
  for (const bar of bars) {
    if (!(bar instanceof Element)) continue;
    const cs = getComputedStyle(bar);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const opacity = Number.parseFloat(cs.opacity || "1");
    if (Number.isFinite(opacity) && opacity < 0.05) continue;
    const rect = bar.getBoundingClientRect();
    if (rect.width > 20 && rect.height > 8) return true;
  }
  return false;
}

function renderDeepLearningOverlay(playerRoot, captionHost) {
  if (!playerRoot || !isDeepLearningContext()) return;
  const fsEl = document.fullscreenElement;
  if (fsEl && fsEl.tagName === "VIDEO") {
    clearDeepLearningOverlayState(playerRoot);
    return;
  }
  const host = captionHost || playerRoot.querySelector(".vds-captions, .vjs-text-track-display");
  if (!host) {
    clearDeepLearningOverlayState(playerRoot);
    return;
  }
  const layer = getDeepLearningOverlayLayer();
  const rect = playerRoot.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) {
    layer.style.display = "none";
    clearDeepLearningOverlayState(playerRoot);
    return;
  }

  layer.style.setProperty("left", `${rect.left}px`, "important");
  layer.style.setProperty("top", `${rect.top}px`, "important");
  layer.style.setProperty("width", `${rect.width}px`, "important");
  layer.style.setProperty("height", `${rect.height}px`, "important");
  layer.classList.toggle("st-pos-top", playerRoot.classList.contains("st-pos-top"));
  layer.classList.toggle("st-pos-bottom", playerRoot.classList.contains("st-pos-bottom"));
  const controlsVisible = isDeepLearningControlBarVisible(playerRoot) || playerRoot.classList.contains("st-controls-visible") || playerRoot.classList.contains("st-hover-controls");
  layer.classList.toggle("st-controls-visible", controlsVisible);

  const rawLines = collectDeepLearningCueLines(host);
  const lines = formatDeepLearningOverlayLines(rawLines);
  if (!lines.length) {
    layer.style.display = "none";
    clearDeepLearningOverlayState(playerRoot);
    deepLearningOverlayLastKey = "";
    return;
  }

  const key = [
    `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`,
    playerRoot.classList.contains("st-pos-top") ? "top" : "bottom",
    playerRoot.classList.contains("st-controls-visible") || playerRoot.classList.contains("st-hover-controls") ? "controls" : "idle",
    currentState.bgMode || "fit",
    lines.join("\n")
  ].join("|");

  if (key === deepLearningOverlayLastKey) return;
  deepLearningOverlayLastKey = key;

  layer.textContent = "";
  if ((currentState.bgMode || "fit") === "uniform") {
    const block = document.createElement("div");
    block.className = "st-dl-overlay-line st-dl-overlay-line-uniform";
    block.textContent = lines.join("\n");
    layer.appendChild(block);
  } else {
    lines.forEach((lineText) => {
      const line = document.createElement("div");
      line.className = "st-dl-overlay-line st-dl-overlay-line-fit";
      line.textContent = lineText;
      layer.appendChild(line);
    });
  }
  layer.style.display = "flex";
  playerRoot.classList.add("st-dl-overlay-active");
}

function scheduleDeepLearningOverlayRender(playerRoot, captionHost) {
  if (!playerRoot || !isDeepLearningContext()) return;
  if (deepLearningOverlayRenderRaf) return;
  deepLearningOverlayRenderRaf = requestAnimationFrame(() => {
    deepLearningOverlayRenderRaf = 0;
    renderDeepLearningOverlay(playerRoot, captionHost);
  });
}

function ensureDeepLearningOverlayObserver(playerRoot) {
  if (!playerRoot || !isDeepLearningContext()) return;
  const captionHost = playerRoot.querySelector(".vds-captions, .vjs-text-track-display");
  if (!captionHost) return;

  if (deepLearningOverlayObservedHost === captionHost && deepLearningOverlayObservedRoot === playerRoot && deepLearningOverlayObserver) {
    return;
  }

  if (deepLearningOverlayObserver) deepLearningOverlayObserver.disconnect();
  deepLearningOverlayObservedHost = captionHost;
  deepLearningOverlayObservedRoot = playerRoot;

  deepLearningOverlayObserver = new MutationObserver(() => {
    scheduleDeepLearningOverlayRender(playerRoot, captionHost);
  });

  deepLearningOverlayObserver.observe(captionHost, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function markSubtitleTargets(playerRoot) {
  if (!playerRoot) return;
  const selectors = [
    ".vjs-text-track-display",
    ".vds-captions",           /* DeepLearning.AI Vidstack player */
    '[data-purpose*="caption" i]',
    '[data-testid*="caption" i]',
    '[aria-live="polite"]',
    '[class*="subtitle" i]',
    '[class*="captions" i]',
    '[class*="caption" i]'
  ];
  playerRoot.querySelectorAll(selectors.join(",")).forEach((n) => {
    if (isLikelyControlElement(n)) return;
    if (n.closest(".vjs-control-bar, [class*='control-bar' i], [class*='controls' i]")) return;
    n.classList.add("st-subtitle-target");
  });
  
  if (isDeepLearningContext()) {
    scheduleDeepLearningOverlayRender(playerRoot);
    ensureDeepLearningOverlayObserver(playerRoot);
  }
}

function wrapMultilineSubtitles(playerRoot) {
  if (!playerRoot) return;
  if (isDeepLearningContext()) return;

  // 查找所有字幕容器
  const containerSelector = '[class*="subtitle"], [class*="captions"], [class*="Caption"], [class*="caption"]';
  const allContainers = Array.from(playerRoot.querySelectorAll(containerSelector));
  const subtitleContainers = allContainers.filter((container) => {
    if (container.closest(".st-multiline-wrapper")) return false;
    const parent = container.parentElement;
    return !(parent && parent.closest(containerSelector));
  });

  subtitleContainers.forEach(container => {
    // 跳过已经处理过的
    if (container.classList.contains('st-wrapped')) {
      // 即使已处理，也要持续强制样式
      const wrapper = container.querySelector('.st-multiline-wrapper');
      if (wrapper) {
        const currentLinesKey = Array.from(wrapper.children)
          .filter(child => !child.classList.contains('st-bg-layer'))
          .map(child => (child.textContent || '').trim())
          .filter(Boolean)
          .join('\n');
        const currentBgMode = currentState.bgMode || 'fit';
        if (container.__stLinesKey === currentLinesKey && container.__stBgMode === currentBgMode) {
          return;
        }

        applyWrapperStyles(wrapper);
        const bg = wrapper.querySelector('.st-bg-layer');
        if (bg) {
          applyBgStyles(bg);
        }
        wrapper.querySelectorAll(':scope > *:not(.st-bg-layer)').forEach(line => {
          applyLineStyles(line);
        });
        renderUnifiedBackground(wrapper);
        container.__stLinesKey = currentLinesKey;
        container.__stBgMode = currentBgMode;
      }
      return;
    }

    // 查找所有直接子元素（每行字幕）
    const lines = Array.from(container.children).filter(child => {
      return child.textContent.trim().length > 0 && !child.classList.contains('st-bg-layer');
    });

    // 无论单行还是多行，都需要统一处理
    if (lines.length >= 1) {
      // 创建包裹容器
      const wrapper = document.createElement('div');
      wrapper.className = 'st-multiline-wrapper';
      applyWrapperStyles(wrapper);

      // 创建背景层
      const bg = document.createElement('div');
      bg.className = 'st-bg-layer';
      applyBgStyles(bg);

      wrapper.appendChild(bg);

      // 将所有行放入包裹容器
      lines.forEach(line => {
        const clonedLine = line.cloneNode(true);
        applyLineStyles(clonedLine);
        wrapper.appendChild(clonedLine);
      });

      // 清空原容器并添加包裹器
      container.innerHTML = '';
      container.appendChild(wrapper);
      container.classList.add('st-wrapped');
      applyContainerStyles(container);
      renderUnifiedBackground(wrapper);
      container.__stLinesKey = lines.map(line => (line.textContent || '').trim()).filter(Boolean).join('\n');
      container.__stBgMode = currentState.bgMode || 'fit';
    }
  });
}

function scheduleCourseraSubtitleRefresh(playerRoot) {
  if (!playerRoot) return;
  courseraSubtitleRefreshRoot = playerRoot;
  if (courseraSubtitleRefreshRaf) return;
  courseraSubtitleRefreshRaf = requestAnimationFrame(() => {
    courseraSubtitleRefreshRaf = 0;
    const root = courseraSubtitleRefreshRoot;
    if (!root || !document.body.contains(root)) return;
    const video = root.querySelector("video") || document.querySelector("video");
    wrapMultilineSubtitles(root);
    attachCustomCueHandlers(video, root);
  });
}

// 强制应用包裹容器样式
function applyWrapperStyles(wrapper) {
  wrapper.style.setProperty('position', 'relative', 'important');
  wrapper.style.setProperty('display', 'inline-block', 'important');
  wrapper.style.setProperty('padding', '0.1em 0.5em', 'important');
  wrapper.style.setProperty('background', 'transparent', 'important');
  wrapper.style.setProperty('background-color', 'transparent', 'important');
  wrapper.style.setProperty('max-width', '90%', 'important');
  wrapper.style.setProperty('margin', '0', 'important');
  wrapper.style.setProperty('border', 'none', 'important');
  wrapper.style.setProperty('box-shadow', 'none', 'important');
}

function renderUnifiedBackground(wrapper) {
  if (!wrapper) return;
  const bg = wrapper.querySelector('.st-bg-layer');
  if (!bg) return;

  if ((currentState.bgMode || "fit") === "uniform") {
    bg.style.setProperty("display", "none", "important");
    bg.textContent = "";
    wrapper.style.setProperty("background", "var(--st-bg)", "important");
    wrapper.style.setProperty("border-radius", "0.2em", "important");
    return;
  }

  bg.style.setProperty("display", "block", "important");
  wrapper.style.setProperty("background", "transparent", "important");
  wrapper.style.setProperty("border-radius", "0", "important");

  const wrapperRect = wrapper.getBoundingClientRect();
  if (wrapperRect.width <= 0 || wrapperRect.height <= 0) return;

  let svg = bg.querySelector('svg.st-bg-svg');
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("st-bg-svg");
    bg.appendChild(svg);
  }

  svg.setAttribute("width", `${wrapperRect.width}`);
  svg.setAttribute("height", `${wrapperRect.height}`);
  svg.setAttribute("viewBox", `0 0 ${wrapperRect.width} ${wrapperRect.height}`);
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const cs = window.getComputedStyle(wrapper);
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const padRight = parseFloat(cs.paddingRight) || 0;
  const padTop = parseFloat(cs.paddingTop) || 0;
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  const fontSize = parseFloat(cs.fontSize) || 16;
  const radius = Math.max(4, Math.round(fontSize * 0.2));
  const overlap = Math.min(Math.max(padTop, padBottom), 4); // 恢复之前的重叠值

  let lineEls = Array.from(wrapper.querySelectorAll('.st-cue-line'));
  if (!lineEls.length) {
    lineEls = Array.from(wrapper.children).filter(child => {
      return !child.classList.contains('st-bg-layer');
    });
  }

  const maskId = wrapper.__stMaskId || `st-mask-${Math.random().toString(36).slice(2, 10)}`;
  wrapper.__stMaskId = maskId;

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const mask = document.createElementNS("http://www.w3.org/2000/svg", "mask");
  mask.setAttribute("id", maskId);
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  defs.appendChild(mask);
  svg.appendChild(defs);

  lineEls.forEach(line => {
    if (!line.textContent.trim()) return;
    const rect = line.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    let x = rect.left - wrapperRect.left - padLeft;
    let y = rect.top - wrapperRect.top - padTop - overlap;
    let w = rect.width + padLeft + padRight;
    let h = rect.height + padTop + padBottom + overlap * 2;

    x = Math.max(0, x);
    y = Math.max(0, y);
    w = Math.min(wrapperRect.width - x, w);
    h = Math.min(wrapperRect.height - y, h);

    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", `${x}`);
    r.setAttribute("y", `${y}`);
    r.setAttribute("width", `${w}`);
    r.setAttribute("height", `${h}`);
    r.setAttribute("rx", `${radius}`);
    r.setAttribute("ry", `${radius}`);
    r.setAttribute("fill", "#fff");
    mask.appendChild(r);
  });

  const fillRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  fillRect.setAttribute("x", "0");
  fillRect.setAttribute("y", "0");
  fillRect.setAttribute("width", `${wrapperRect.width}`);
  fillRect.setAttribute("height", `${wrapperRect.height}`);
  fillRect.setAttribute("mask", `url(#${maskId})`);
  fillRect.classList.add("st-bg-fill");
  svg.appendChild(fillRect);
}

// 强制应用背景层样式
function applyBgStyles(bg) {
  bg.style.setProperty('position', 'absolute', 'important');
  bg.style.setProperty('top', '0', 'important');
  bg.style.setProperty('left', '0', 'important');
  bg.style.setProperty('right', '0', 'important');
  bg.style.setProperty('bottom', '0', 'important');
  bg.style.setProperty('width', '100%', 'important');
  bg.style.setProperty('height', '100%', 'important');
  bg.style.setProperty('background', 'transparent', 'important');
  bg.style.setProperty('background-color', 'transparent', 'important');
  bg.style.setProperty('border-radius', '0.3em', 'important');
  bg.style.setProperty('z-index', '-1', 'important');
  bg.style.setProperty('pointer-events', 'none', 'important');
}

// 强制应用每行样式
function applyLineStyles(line) {
  line.style.setProperty('display', 'block', 'important');
  line.style.setProperty('background', 'transparent', 'important');
  line.style.setProperty('background-color', 'transparent', 'important');
  line.style.setProperty('padding', '0', 'important');
  line.style.setProperty('margin', '0 auto', 'important');
  line.style.setProperty('width', 'fit-content', 'important');
  line.style.setProperty('max-width', '100%', 'important');
  line.style.setProperty('border', 'none', 'important');
  line.style.setProperty('box-shadow', 'none', 'important');
}

// 强制应用容器样式
function applyContainerStyles(container) {
  container.style.setProperty('background', 'transparent', 'important');
  container.style.setProperty('background-color', 'transparent', 'important');
  container.style.setProperty('padding', '0', 'important');
  container.style.setProperty('margin', '0', 'important');
}

function getControlsElements(playerRoot) {
  if (!playerRoot) return [];
  const selectors = [
    ".rc-VideoPlayerControlsContainer",
    ".rc-VideoPlayerControls",
    ".rc-VideoPlayer-control-bar",
    ".vjs-control-bar",
    "[class*=\"control-bar\" i]",
    "[class*=\"controls-container\" i]",
    "[class*=\"progress-bar\" i]",
    "[class*=\"playback-bar\" i]",
    "[class*=\"VideoProgress\" i]",
    "[class*=\"Scrubber\" i]",
    "[class*=\"ControlBar\" i]",
    "[class*=\"VideoControls\" i]",
    "[data-test*=\"controls\" i]",
    "[data-testid*=\"controls\" i]",
    "[data-testid*=\"progress\" i]",
    ".video-controls",
    ".video-control-bar"
  ];
  const elements = new Set();
  selectors.forEach((sel) => {
    playerRoot.querySelectorAll(sel).forEach((el) => elements.add(el));
  });
  return Array.from(elements).filter((el) => {
    if (el.querySelector("video")) return false;
    // 检查是否包含常见的交互元素或具有控制条特征
    const hasButton = el.querySelector("button") || el.matches("button");
    const hasSlider = el.querySelector("input[type=\"range\"], [role=\"slider\"], [class*=\"progress\" i], [class*=\"scrubber\" i]");
    const hasMediaLabel = el.querySelector(
      "[aria-label*=\"Play\" i], [aria-label*=\"Pause\" i], [aria-label*=\"Volume\" i], [aria-label*=\"Mute\" i], [aria-label*=\"Settings\" i], [aria-label*=\"Fullscreen\" i]"
    );
    // 或者是其中一个已知的主容器
    const isMainContainer = el.classList.contains("rc-VideoPlayerControlsContainer") || 
                            el.classList.contains("rc-VideoPlayerControls") ||
                            el.classList.contains("vjs-control-bar");

    return !!(hasButton || hasSlider || hasMediaLabel || isMainContainer);
  });
}

function forceControlsVisibility(playerRoot, visible) {
  const elements = getControlsElements(playerRoot);
  elements.forEach((el) => {
    el.style.setProperty("display", visible ? "block" : "none", "important");
    el.style.setProperty("opacity", visible ? "1" : "0", "important");
    el.style.setProperty("visibility", visible ? "visible" : "hidden", "important");
    el.style.setProperty("pointer-events", visible ? "auto" : "none", "important");
    el.style.setProperty("transition", "none", "important");
    el.style.setProperty("animation", "none", "important");
  });
}

function ensureCueLayer(playerRoot) {
  let layer = playerRoot.querySelector(".st-cue-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "st-cue-layer";
    const wrapper = document.createElement("div");
    wrapper.className = "st-multiline-wrapper st-cue-wrapper";
    const bg = document.createElement("div");
    bg.className = "st-bg-layer";
    const text = document.createElement("div");
    text.className = "st-cue-text";
    wrapper.appendChild(bg);
    wrapper.appendChild(text);
    layer.appendChild(wrapper);
    playerRoot.appendChild(layer);
  }

  const wrapper = layer.querySelector(".st-cue-wrapper");
  const bg = layer.querySelector(".st-bg-layer");
  const text = layer.querySelector(".st-cue-text");
  if (wrapper) applyWrapperStyles(wrapper);
  if (bg) applyBgStyles(bg);
  return { layer, wrapper, bg, text };
}

function getCaptionRoot(playerRoot, video) {
  const fsEl = document.fullscreenElement;
  if (!fsEl) return playerRoot;
  if (video && fsEl === video) return null; // can't append overlays to <video>
  if (video && fsEl.contains(video)) return fsEl;
  if (playerRoot && fsEl.contains(playerRoot)) return fsEl;
  return playerRoot;
}

function updateCustomCues(video, playerRoot) {
  if (!video || !playerRoot) return;
  const tracks = Array.from(video.textTracks || []);
  const showingTracks = tracks.filter(t => t.mode === "showing");

  if (!showingTracks.length) {
    const roots = new Set([playerRoot, document.fullscreenElement].filter(Boolean));
    roots.forEach((root) => {
      root.classList.remove("st-custom-cues");
      const layer = root.querySelector(".st-cue-layer");
      if (layer) layer.style.display = "none";
    });
    return;
  }

  const captionRoot = getCaptionRoot(playerRoot, video);
  if (!captionRoot) {
    // Fullscreen element is <video>; fallback to native cues
    const roots = new Set([playerRoot, document.fullscreenElement].filter(Boolean));
    roots.forEach((root) => {
      root.classList.remove("st-custom-cues");
      const layer = root.querySelector(".st-cue-layer");
      if (layer) layer.style.display = "none";
    });
    return;
  }

  const texts = [];
  showingTracks.forEach(track => {
    const cues = track.activeCues ? Array.from(track.activeCues) : [];
    cues.forEach(cue => {
      if (cue && cue.text) texts.push(cue.text);
    });
  });

  const text = texts.join("\n").trim();
  if (!text) {
    // Keep native captions if we can't render custom cues
    const roots = new Set([playerRoot, document.fullscreenElement].filter(Boolean));
    roots.forEach((root) => {
      root.classList.remove("st-custom-cues");
      const layer = root.querySelector(".st-cue-layer");
      if (layer) layer.style.display = "none";
    });
    return;
  }
  const roots = new Set([playerRoot, document.fullscreenElement].filter(Boolean));
  roots.forEach((root) => {
    root.classList.remove("st-custom-cues");
    if (root !== captionRoot) {
      const layer = root.querySelector(".st-cue-layer");
      if (layer) layer.style.display = "none";
    }
  });

  captionRoot.classList.add("st-custom-cues");
  const { layer, wrapper, text: textEl } = ensureCueLayer(captionRoot);

  textEl.textContent = "";
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (!lines.length) {
    layer.style.display = "none";
    return;
  }
  lines.forEach(lineText => {
    const line = document.createElement("div");
    line.className = "st-cue-line";
    line.textContent = lineText;
    applyLineStyles(line);
    textEl.appendChild(line);
  });
  layer.style.display = "block";
  requestAnimationFrame(() => renderUnifiedBackground(wrapper));
}

function attachCustomCueHandlers(video, playerRoot) {
  if (!video || cueHandlers.has(video)) return;

  const handler = () => updateCustomCues(video, playerRoot);
  cueHandlers.set(video, handler);

  video.addEventListener("timeupdate", handler);
  video.addEventListener("loadedmetadata", handler);
  video.addEventListener("emptied", handler);

  const trackList = video.textTracks;
  if (trackList) {
    const addTrackListeners = () => {
      Array.from(trackList).forEach(track => {
        if (track.__stCueListener) return;
        track.addEventListener("cuechange", handler);
        track.__stCueListener = true;
      });
    };
    addTrackListeners();
    if (!trackList.__stListener) {
      trackList.addEventListener("addtrack", () => {
        addTrackListeners();
        handler();
      });
      trackList.__stListener = true;
    }
  }

  handler();
}

function disableCustomCueRendering(playerRoot) {
  const roots = new Set([
    playerRoot,
    document.fullscreenElement,
    ...Array.from(document.querySelectorAll(".st-custom-cues"))
  ].filter(Boolean));

  roots.forEach((root) => {
    root.classList.remove("st-custom-cues");
    const layer = root.querySelector ? root.querySelector(".st-cue-layer") : null;
    if (layer) layer.style.display = "none";
  });
}

function findDeepLearningInsertionTarget(playerRoot) {
  if (!playerRoot) return null;

  const directBars = [
    ".vjs-control-bar",
    '[class*="control-bar" i]',
    '[class*="controls-bar" i]',
    '[class*="player-controls" i]',
    '[class*="video-controls" i]'
  ];

  for (const sel of directBars) {
    const bar = playerRoot.querySelector(sel);
    if (bar) {
      const rightGroup = bar.querySelector(
        '.vjs-control-bar-right, .vjs-right-controls, [class*="right-controls" i], [class*="controls-right" i]'
      );
      if (rightGroup) return { type: "appendChild", parent: rightGroup };
      return { type: "appendChild", parent: bar };
    }
  }

  const anchors = [
    playerRoot.querySelector('button[aria-label*="Fullscreen" i], .vjs-fullscreen-control, [data-e2e="fullscreen-button" i]'),
    playerRoot.querySelector('button[aria-label*="Captions" i], button[aria-label*="Subtitles" i], button[aria-label="CC" i], .vjs-captions-button, .vjs-subtitles-button'),
    playerRoot.querySelector('[class*="logo" i], [data-testid*="logo" i], a[href*="deeplearning.ai" i]')
  ].filter(Boolean);

  for (const anchor of anchors) {
    let node = anchor;
    while (node && node !== playerRoot) {
      const parent = node.parentElement;
      if (!parent) break;
      const cs = window.getComputedStyle(parent);
      const hasControls = parent.querySelectorAll('button, [role="button"]').length >= 2;
      if ((cs.display.includes("flex") || cs.display.includes("grid")) && hasControls) {
        return { type: "appendChild", parent };
      }
      node = parent;
    }
  }

  const genericControls = getControlsElements(playerRoot).filter((el) => {
    const cs = window.getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  });
  if (genericControls.length) {
    return { type: "appendChild", parent: genericControls[genericControls.length - 1] };
  }

  return { type: "deeplearningFloating", parent: playerRoot };
}

function findInsertionTarget(playerRoot) {
  if (!playerRoot) return null;

  const isDeepLearning = isDeepLearningContext();

  // DeepLearning.ai 专用：优先插入到右侧工具栏末尾
  if (isDeepLearning) {
    return findDeepLearningInsertionTarget(playerRoot);
  }

  if (isCourseraContext()) {
    const courseraFullscreenBtn = playerRoot.querySelector(
      'button[aria-label*="Fullscreen" i], button[aria-label*="Full Screen" i], button[aria-label*="全屏" i], [data-e2e="fullscreen-button" i], .vjs-fullscreen-control'
    );
    if (courseraFullscreenBtn) {
      let reference = courseraFullscreenBtn;
      while (reference.parentElement) {
        const parent = reference.parentElement;
        const testId = (parent.getAttribute("data-testid") || "").toLowerCase();
        const className = String(parent.className || "");
        const isTooltipWrapper = parent.tagName === "SPAN" || testId.includes("tooltip") || /tooltip/i.test(className);
        if (!isTooltipWrapper) break;
        reference = parent;
      }
      if (reference.parentElement) {
        return { type: "insertAfter", parent: reference.parentElement, reference };
      }
    }
  }

  const fullscreenBtn = playerRoot.querySelector('button[aria-label*="Fullscreen"], button[aria-label*="Full Screen"], button[aria-label*="全屏"], .vjs-fullscreen-control, [data-e2e="fullscreen-button"]');
  if (fullscreenBtn) {
    let reference = fullscreenBtn;
    while (reference.parentElement) {
      const parent = reference.parentElement;
      const testId = (parent.getAttribute("data-testid") || "").toLowerCase();
      const className = String(parent.className || "");
      const isTooltipWrapper = parent.tagName === "SPAN" || testId.includes("tooltip") || /tooltip/i.test(className);
      if (!isTooltipWrapper) break;
      reference = parent;
    }
    if (reference.parentElement) {
      return { type: "insertAfter", parent: reference.parentElement, reference };
    }
  }
  const settingsBtn = playerRoot.querySelector('button[aria-label*="Settings"], button[aria-label*="设置"]');
  if (settingsBtn) {
     let container = settingsBtn.parentNode;
     if (container && container.tagName === 'SPAN') container = container.parentNode;
     return { type: 'appendChild', parent: container };
  }
  const captionsBtn = playerRoot.querySelector('button[aria-label*="Captions" i], button[aria-label*="Subtitles" i], button[aria-label="CC" i], [class*="caption" i] button, [class*="subtitle" i] button');
  if (captionsBtn) {
     let container = captionsBtn.parentNode;
     if (container && container.tagName === 'SPAN') container = container.parentNode;
     return { type: 'appendChild', parent: container };
  }
  const controlBars = getControlsElements(playerRoot).filter((el) => {
    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (el.querySelector("video")) return false;
    const hasButton = el.querySelector("button, [role=\"button\"]");
    const isProgress = /progress|scrubber|seek|timeline/i.test(el.className || "");
    return !!hasButton && !isProgress;
  });
  if (controlBars.length) {
    return { type: "appendChild", parent: controlBars[controlBars.length - 1] };
  }
  return null;
}

function repositionPanel(btn) {
  if (!panelEl || !btn) return;
  const rect = btn.getBoundingClientRect();
  const panelWidth = 292;
  let left = rect.right - panelWidth;
  let top = rect.top - panelEl.offsetHeight - 12;
  
  if (top < 10) top = rect.bottom + 12;
  if (left + panelWidth > window.innerWidth) left = window.innerWidth - panelWidth - 10;
  
  panelEl.style.left = `${left}px`;
  panelEl.style.top = `${top}px`;
}

function getPanelHost(playerRoot) {
  const fsEl = document.fullscreenElement;
  if (fsEl && fsEl.tagName !== "VIDEO") return fsEl;
  return document.body;
}

function ensurePanelMounted(playerRoot) {
  if (!panelEl) return;
  const host = getPanelHost(playerRoot);
  if (panelEl.parentElement !== host) {
    host.appendChild(panelEl);
  }
}

async function boot() {
  currentState = await loadState();
  const courseraContext = isCourseraContext();
  const deepLearningContext = isDeepLearningContext();
  document.documentElement.classList.toggle("st-context-coursera", courseraContext);
  document.documentElement.classList.toggle("st-context-non-coursera", !courseraContext);
  document.documentElement.classList.toggle("st-context-deeplearning", deepLearningContext);
  panelEl = initPanel();
  syncPanelUI();

  const btn = document.createElement("button");
  btn.className = "st-cc-btn";
  btn.textContent = "CC+";
  btn.title = "Coursera Subtitle Tuner";
  if (deepLearningContext) {
    btn.classList.add("vjs-control", "vjs-button");
  }
  
  btn.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (panelEl.classList.contains("st-open")) {
        panelEl.classList.remove("st-open");
    } else {
        ensurePanelMounted(findPlayerRoot());
        syncPanelUI();
        panelEl.style.visibility = "hidden";
        panelEl.classList.add("st-open");
        repositionPanel(btn);
        panelEl.style.visibility = "visible";
    }
  };
  
  window.addEventListener('resize', () => {
      if (panelEl.classList.contains("st-open")) {
          repositionPanel(btn);
      }
      const playerRoot = findPlayerRoot();
      if (playerRoot) {
          const video = playerRoot.querySelector("video") || document.querySelector("video");
          const captionRoot = getCaptionRoot(playerRoot, video) || playerRoot;
          applyState(currentState, captionRoot);
      }
      if (isDeepLearningContext()) {
          scheduleDeepLearningOverlayRender(playerRoot || findPlayerRoot());
      }
  });

  // 仅在 Coursera 场景接管空格播放，避免影响页面滚动
  window.addEventListener("keydown", (e) => {
    if (!courseraContext) return;
    if (e.code === "Space" || e.key === " ") {
      const activeEl = document.activeElement;
      const isInput = activeEl && (
        activeEl.tagName === "INPUT" || 
        activeEl.tagName === "TEXTAREA" || 
        activeEl.isContentEditable
      );
      if (isInput) return;

      const playerRoot = findPlayerRoot();
      const video = playerRoot ? playerRoot.querySelector("video") : document.querySelector("video");
      if (!playerRoot || !playerRoot.matches(":hover")) return;

      if (video) {
        e.preventDefault();
        e.stopPropagation();
        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
      }
    }
  }, true);
  
  // === 核心修改：使用 Capture 阶段监听点击 ===
  // 这里的 'true' 参数确保我们在事件被其他按钮拦截前就能捕获它
  document.addEventListener("click", (e) => {
    if (panelEl.classList.contains("st-open")) {
      // 检查点击目标是否在 Panel 内部，或者就是 CC+ 按钮本身
      if (!panelEl.contains(e.target) && !btn.contains(e.target)) {
        panelEl.classList.remove("st-open");
      }
    }
  }, true);

  document.addEventListener("fullscreenchange", () => {
    const playerRoot = findPlayerRoot();
    if (!playerRoot) return;
    const video = playerRoot.querySelector("video") || document.querySelector("video");
    ensurePanelMounted(playerRoot);
    if (!isDeepLearningContext()) {
      attachCustomCueHandlers(video, playerRoot);
    }
    const captionRoot = getCaptionRoot(playerRoot, video) || playerRoot;
    applyState(currentState, captionRoot);
    if (isDeepLearningContext()) {
      ensureDeepLearningOverlayObserver(playerRoot);
      scheduleDeepLearningOverlayRender(playerRoot);
      setTimeout(() => {
        const latestRoot = findPlayerRoot();
        if (!latestRoot) return;
        ensureDeepLearningOverlayObserver(latestRoot);
        scheduleDeepLearningOverlayRender(latestRoot);
      }, 200);
    }
  });

  const mount = () => {
    const playerRoot = findPlayerRoot();
    if (!playerRoot) return;
    const video = playerRoot.querySelector("video") || document.querySelector("video");
    ensurePanelMounted(playerRoot);
    if (courseraContext && !playerRoot.__stHoverBound) {
      playerRoot.__stHoverBound = true;
      playerRoot.classList.add("st-force-controls");

      let hideTimer = null;
      let policeInterval = null;

      const enforce = () => {
        if (!document.body.contains(playerRoot)) {
          if (policeInterval) { clearInterval(policeInterval); policeInterval = null; }
          return;
        }
        forceControlsVisibility(playerRoot, true);
        // 发送虚拟事件以保持原生播放器控制条显示，防止其提前或延迟隐藏
        playerRoot.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: 0,
          clientY: 0
        }));
      };

      const hideControls = () => {
        if (hideTimer) clearTimeout(hideTimer);
        if (policeInterval) { clearInterval(policeInterval); policeInterval = null; }
        
        playerRoot.classList.remove("st-hover-controls");
        playerRoot.classList.remove("st-controls-visible");
        playerRoot.classList.add("st-controls-hidden");
        forceControlsVisibility(playerRoot, false);
      };

      const showControls = (e) => {
        // 忽略由我们自己发出的虚拟事件，避免死循环
        if (e && e.isTrusted === false) return;

        if (hideTimer) clearTimeout(hideTimer);
        
        // Ensure visual state matches "Showing"
        playerRoot.classList.add("st-hover-controls");
        playerRoot.classList.add("st-controls-visible");
        playerRoot.classList.remove("st-controls-hidden");
        
        // Force immediately and start policing to fight native auto-hide
        forceControlsVisibility(playerRoot, true);
        if (!policeInterval) {
          policeInterval = setInterval(enforce, 250);
        }
        
        hideTimer = setTimeout(hideControls, 5000);
      };

      if (playerRoot.matches(":hover")) {
        showControls();
      } else {
        hideControls();
      }

      playerRoot.addEventListener("mousemove", showControls);
      playerRoot.addEventListener("mouseleave", hideControls);
      
      if (video) {
        video.addEventListener("pause", showControls);
        video.addEventListener("play", showControls);
      }
    }

    const insertion = findInsertionTarget(playerRoot);
    const isInDom = document.body.contains(btn);
    const isTrapped = btn.parentNode && (btn.parentNode.tagName === 'SPAN' || btn.parentNode.getAttribute('data-testid') === 'tooltip-wrapper');
    const hasTargetButWrongParent = !!(insertion && insertion.parent && btn.parentElement !== insertion.parent);

    if ((!isInDom || isTrapped || hasTargetButWrongParent) && insertion && insertion.parent) {
      try {
        if (insertion.type === "deeplearningFloating") {
          playerRoot.classList.add("st-deeplearning-player");
          if (btn.parentElement !== playerRoot) {
            playerRoot.appendChild(btn);
          }
          btn.classList.add("st-deeplearning-floating");
        } else if (insertion.type === 'insertBefore' && insertion.reference) {
          insertion.parent.insertBefore(btn, insertion.reference);
          btn.classList.remove("st-deeplearning-floating");
        } else if (insertion.type === 'insertAfter' && insertion.reference) {
          insertion.reference.parentNode.insertBefore(btn, insertion.reference.nextSibling);
          btn.classList.remove("st-deeplearning-floating");
        } else {
          insertion.parent.appendChild(btn);
          btn.classList.remove("st-deeplearning-floating");
        }
        btn.classList.remove("st-floating");

      } catch (e) { console.error(e); }
    } else if (!isInDom && !deepLearningContext) {
      let floatContainer = document.getElementById("st-float-container");
      if (!floatContainer) {
        floatContainer = document.createElement("div");
        floatContainer.id = "st-float-container";
        floatContainer.className = "st-cc-floating-container";
        document.body.appendChild(floatContainer);
      }
      floatContainer.appendChild(btn);
      btn.classList.add("st-floating");
    }

    markSubtitleTargets(playerRoot);
    if (!isDeepLearningContext()) {
      scheduleCourseraSubtitleRefresh(playerRoot);
    }
    const captionRoot = getCaptionRoot(playerRoot, video) || playerRoot;
    applyState(currentState, captionRoot);
  };

  const scheduleMount = () => {
    if (mountRaf) return;
    mountRaf = requestAnimationFrame(() => {
      mountRaf = 0;
      mount();
    });
  };

  setInterval(scheduleMount, 1000); 
  const mo = new MutationObserver(scheduleMount);
  mo.observe(document.body, { childList: true, subtree: true });
  mount();
}

if (shouldRunOnCurrentPage()) {
  boot();
}
