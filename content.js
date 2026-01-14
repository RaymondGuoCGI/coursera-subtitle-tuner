const STORAGE_KEY = "subtitle_tuner_v19_click_outside"; 

const DEFAULTS = {
  pos: "bottom",
  posOffset: 0,       
  lineHeight: 135,
  fontSize: 24,
  textColor: "#ffffff",
  bgColor: "#000000",
  bgOpacity: 65,
  outline: 2
};

let currentState = { ...DEFAULTS };
let panelEl = null;
const cueHandlers = new WeakMap();

function rgba(hex, opacity01) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0,2), 16);
  const g = parseInt(h.substring(2,4), 16);
  const b = parseInt(h.substring(4,6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity01})`;
}

async function loadState() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEY], (res) => {
      resolve({ ...DEFAULTS, ...(res[STORAGE_KEY] || {}) });
    });
  });
}
async function saveState(state) {
  currentState = state;
  chrome.storage.sync.set({ [STORAGE_KEY]: state });
}

function applyState(state, playerRoot) {
  const root = document.documentElement;
  let yVal = state.pos === "bottom" ? -1 * state.posOffset : state.posOffset;

  root.style.setProperty("--st-font-size", `${state.fontSize}px`);
  root.style.setProperty("--st-line-height", `${state.lineHeight / 100}`);
  root.style.setProperty("--st-color", state.textColor);
  root.style.setProperty("--st-bg", rgba(state.bgColor, state.bgOpacity / 100));
  root.style.setProperty("--st-outline", `${state.outline}px`);
  root.style.setProperty("--st-translate-y", `${yVal}vh`);

  if (playerRoot) {
    playerRoot.classList.add("st-player-root");
    playerRoot.classList.remove("st-pos-top", "st-pos-bottom");
    playerRoot.classList.add(state.pos === "top" ? "st-pos-top" : "st-pos-bottom");

    // 更新所有动态创建的背景层
    const bgLayers = playerRoot.querySelectorAll('.st-bg-layer');
    bgLayers.forEach(bg => {
      bg.style.background = "transparent";
    });
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
      currentState = { ...DEFAULTS };
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
  setVal("st-ol", currentState.outline);
}

function findPlayerRoot() {
  const v = document.querySelector("video");
  if (!v) return null;
  return v.closest(".rc-VideoPlayer, .c-video-player, .video-js") || v.parentElement.parentElement || v.parentElement;
}

function markSubtitleTargets(playerRoot) {
  if (!playerRoot) return;
  const selectors = ['[class*="subtitle"]', '[class*="captions"]', '[class*="Caption"]', '[class*="caption"]', '.vjs-text-track-display'];
  playerRoot.querySelectorAll(selectors.join(",")).forEach(n => n.classList.add("st-subtitle-target"));
}

function wrapMultilineSubtitles(playerRoot) {
  if (!playerRoot) return;

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
        applyWrapperStyles(wrapper);
        const bg = wrapper.querySelector('.st-bg-layer');
        if (bg) {
          applyBgStyles(bg);
        }
        wrapper.querySelectorAll(':scope > *:not(.st-bg-layer)').forEach(line => {
          applyLineStyles(line);
        });
        requestAnimationFrame(() => renderUnifiedBackground(wrapper));
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
      requestAnimationFrame(() => renderUnifiedBackground(wrapper));
    }
  });
}

// 强制应用包裹容器样式
function applyWrapperStyles(wrapper) {
  wrapper.style.setProperty('position', 'relative', 'important');
  wrapper.style.setProperty('display', 'inline-block', 'important');
  wrapper.style.setProperty('padding', '0.2em 0.5em', 'important');
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
  const overlap = Math.min(Math.max(padTop, padBottom), 8);

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
    "[class*=\"control-bar\"]",
    "[class*=\"progress-bar\"]",
    "[data-test*=\"controls\"]",
    "[data-testid*=\"controls\"]",
    "[data-testid*=\"progress\"]"
  ];
  const elements = new Set();
  selectors.forEach((sel) => {
    playerRoot.querySelectorAll(sel).forEach((el) => elements.add(el));
  });
  return Array.from(elements).filter((el) => {
    if (el.querySelector("video")) return false;
    const hasButton = el.querySelector("button") || el.matches("button");
    const hasSlider = el.querySelector("input[type=\"range\"], [role=\"slider\"], [class*=\"progress-bar\"]");
    const hasMediaLabel = el.querySelector(
      "[aria-label*=\"Play\"], [aria-label*=\"Pause\"], [aria-label*=\"Volume\"], [aria-label*=\"Mute\"], [aria-label*=\"Settings\"], [aria-label*=\"Fullscreen\"]"
    );
    return !!(hasButton || hasSlider || hasMediaLabel);
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

function updateCustomCues(video, playerRoot) {
  if (!video || !playerRoot) return;
  const tracks = Array.from(video.textTracks || []);
  const showingTracks = tracks.filter(t => t.mode === "showing");

  if (!showingTracks.length) {
    playerRoot.classList.remove("st-custom-cues");
    const layer = playerRoot.querySelector(".st-cue-layer");
    if (layer) layer.style.display = "none";
    return;
  }
  playerRoot.classList.add("st-custom-cues");

  const texts = [];
  showingTracks.forEach(track => {
    const cues = track.activeCues ? Array.from(track.activeCues) : [];
    cues.forEach(cue => {
      if (cue && cue.text) texts.push(cue.text);
    });
  });

  const text = texts.join("\n").trim();
  const { layer, wrapper, text: textEl } = ensureCueLayer(playerRoot);

  if (!text) {
    layer.style.display = "none";
    return;
  }

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

function findInsertionTarget(playerRoot) {
  if (!playerRoot) return null;
  
  const fullscreenBtn = playerRoot.querySelector('button[aria-label*="Fullscreen"], button[aria-label*="Full Screen"], button[aria-label*="全屏"], .vjs-fullscreen-control, [data-e2e="fullscreen-button"]');
  if (fullscreenBtn) {
    let container = fullscreenBtn.parentNode;
    if (container && (container.tagName === 'SPAN' || container.getAttribute('data-testid') === 'tooltip-wrapper' || container.className.includes('tooltip'))) {
        return { type: 'appendChild', parent: container.parentNode };
    }
    return { type: 'appendChild', parent: fullscreenBtn.parentNode };
  }
  const settingsBtn = playerRoot.querySelector('button[aria-label*="Settings"], button[aria-label*="设置"]');
  if (settingsBtn) {
     let container = settingsBtn.parentNode;
     if (container && container.tagName === 'SPAN') container = container.parentNode;
     return { type: 'appendChild', parent: container };
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

async function boot() {
  currentState = await loadState();
  panelEl = initPanel();
  syncPanelUI();

  const btn = document.createElement("button");
  btn.className = "st-cc-btn";
  btn.textContent = "CC+";
  btn.title = "Coursera Subtitle Tuner";
  
  btn.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (panelEl.classList.contains("st-open")) {
        panelEl.classList.remove("st-open");
    } else {
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
  });
  
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

  const mount = () => {
    const playerRoot = findPlayerRoot();
    if (!playerRoot) return;
    const video = playerRoot.querySelector("video") || document.querySelector("video");
    if (!playerRoot.__stHoverBound) {
      playerRoot.__stHoverBound = true;
      playerRoot.classList.add("st-force-controls");
      const hoveringNow = playerRoot.matches(":hover");
      playerRoot.classList.toggle("st-hover-controls", hoveringNow);
      playerRoot.classList.toggle("st-controls-visible", hoveringNow);
      playerRoot.classList.toggle("st-controls-hidden", !hoveringNow);
      forceControlsVisibility(playerRoot, hoveringNow);
      playerRoot.addEventListener("mouseenter", () => {
        playerRoot.classList.add("st-hover-controls");
        playerRoot.classList.add("st-controls-visible");
        playerRoot.classList.remove("st-controls-hidden");
        forceControlsVisibility(playerRoot, true);
      });
      playerRoot.addEventListener("mouseleave", () => {
        playerRoot.classList.remove("st-hover-controls");
        playerRoot.classList.add("st-controls-hidden");
        playerRoot.classList.remove("st-controls-visible");
        forceControlsVisibility(playerRoot, false);
      });
    }

    const insertion = findInsertionTarget(playerRoot);
    const isInDom = document.body.contains(btn);
    const isTrapped = btn.parentNode && (btn.parentNode.tagName === 'SPAN' || btn.parentNode.getAttribute('data-testid') === 'tooltip-wrapper');

    if ((!isInDom || isTrapped) && insertion && insertion.parent) {
      try {
        insertion.parent.appendChild(btn);
        btn.classList.remove("st-floating");
        const parent = insertion.parent;
        const cs = window.getComputedStyle(parent);
        if (cs.display !== "flex" && cs.display !== "inline-flex") {
            parent.style.display = "flex";
            parent.style.alignItems = "center";
            parent.style.justifyContent = "flex-end";
        }
        parent.style.width = "auto";
        parent.style.maxWidth = "none";
      } catch (e) { console.error(e); }
    } else if (!isInDom) {
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
    wrapMultilineSubtitles(playerRoot);
    attachCustomCueHandlers(video, playerRoot);
    applyState(currentState, playerRoot);
  };

  setInterval(mount, 1000); 
  const mo = new MutationObserver(mount);
  mo.observe(document.body, { childList: true, subtree: true });
  mount();
}

boot();
