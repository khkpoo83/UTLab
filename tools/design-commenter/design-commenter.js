/*!
 * design-commenter — a standalone visual feedback overlay.
 *
 * Drop into ANY page (plain HTML, any website via bookmarklet, or this
 * project's React dev app). Toggle edit mode, hover to highlight elements,
 * click to leave a comment, then "Copy for Claude Code" to get a paste-ready
 * markdown list of every comment — each mapped back to a CSS selector and, when
 * available, the exact React source location (file:line:col).
 *
 * Usage:
 *   <script src="design-commenter.js"></script>
 *   // or paste the bookmarklet from README.md into any live page.
 *
 * No dependencies. No build step. Self-contained. UI lives in a Shadow DOM so
 * the host page's styles never leak in (and vice-versa).
 */
(function () {
  "use strict";

  if (window.__designCommenterLoaded) {
    // Re-invoking toggles visibility instead of double-injecting.
    window.__designCommenter && window.__designCommenter.toggleToolbar();
    return;
  }
  window.__designCommenterLoaded = true;

  // Embedded mode: loaded inside the app.html shell iframe (/dc.js?embedded=1,
  // or simply running in an iframe). Hides the floating toolbar and drives
  // edit/export via postMessage from the shell instead.
  var EMBEDDED = false;
  try {
    var _cs = document.currentScript;
    if (_cs && /[?&]embedded=1/.test(_cs.src)) EMBEDDED = true;
    if (window.parent && window.parent !== window) EMBEDDED = true;
  } catch (e) {}

  function postToShell(type, extra) {
    if (!EMBEDDED) return;
    try {
      var msg = { type: type };
      if (extra) for (var k in extra) msg[k] = extra[k];
      window.parent.postMessage(msg, "*");
    } catch (e) {}
  }
  // Called from renderList() whenever the comment set changes.
  function notifyCount() { postToShell("dc:count", { count: comments.length }); }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var STORAGE_KEY = "design-commenter::" + location.pathname;
  var active = false; // edit mode on/off
  var comments = []; // {id, selector, source, tag, text, comment, rectKey, _el}
  var nextId = 1;
  var hoverEl = null; // element currently highlighted
  var pendingEl = null; // element awaiting a comment in the popup
  var editingId = null; // comment id being edited (vs new)

  // ---------------------------------------------------------------------------
  // Shadow-DOM host + UI
  // ---------------------------------------------------------------------------
  var host = document.createElement("div");
  host.id = "design-commenter-host";
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  document.documentElement.appendChild(host);
  var root = host.attachShadow({ mode: "open" });

  root.innerHTML =
    '<style>' +
    ':host,*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;}' +
    '.dc-layer{position:fixed;inset:0;pointer-events:none;}' +
    '.dc-highlight{position:fixed;border:2px solid #6366f1;background:rgba(99,102,241,.12);' +
      'border-radius:3px;pointer-events:none;display:none;transition:all .03s linear;}' +
    '.dc-label{position:fixed;background:#312e81;color:#fff;font-size:11px;line-height:1.4;' +
      'padding:3px 7px;border-radius:5px;pointer-events:none;display:none;max-width:340px;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 8px rgba(0,0,0,.3);}' +
    '.dc-pin{position:fixed;width:22px;height:22px;border-radius:50% 50% 50% 2px;background:#6366f1;' +
      'color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;' +
      'pointer-events:auto;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.35);transform:translate(-50%,-100%);' +
      'border:2px solid #fff;}' +
    '.dc-pin:hover{background:#4f46e5;}' +
    '.dc-toolbar{position:fixed;right:16px;bottom:16px;pointer-events:auto;background:#18181b;color:#fff;' +
      'border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.45);display:flex;flex-direction:column;' +
      'overflow:hidden;width:300px;max-height:70vh;font-size:13px;}' +
    '.dc-tb-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#27272a;cursor:default;}' +
    '.dc-dot{width:9px;height:9px;border-radius:50%;background:#52525b;flex:none;}' +
    '.dc-dot.on{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.25);}' +
    '.dc-title{font-weight:700;flex:1;}' +
    '.dc-min{cursor:pointer;color:#a1a1aa;padding:0 4px;font-size:16px;line-height:1;}' +
    '.dc-min:hover{color:#fff;}' +
    '.dc-row{display:flex;gap:8px;padding:10px 12px;}' +
    '.dc-btn{flex:1;border:0;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:600;cursor:pointer;' +
      'background:#3f3f46;color:#fff;transition:background .12s;}' +
    '.dc-btn:hover{background:#52525b;}' +
    '.dc-btn.primary{background:#6366f1;}' +
    '.dc-btn.primary:hover{background:#4f46e5;}' +
    '.dc-btn.on{background:#22c55e;}' +
    '.dc-btn.on:hover{background:#16a34a;}' +
    '.dc-btn:disabled{opacity:.45;cursor:not-allowed;}' +
    '.dc-list{overflow-y:auto;border-top:1px solid #3f3f46;}' +
    '.dc-item{padding:9px 12px;border-bottom:1px solid #27272a;cursor:pointer;}' +
    '.dc-item:hover{background:#27272a;}' +
    '.dc-item-h{display:flex;gap:6px;align-items:center;margin-bottom:3px;}' +
    '.dc-num{background:#6366f1;color:#fff;border-radius:5px;font-size:10px;font-weight:700;padding:1px 6px;flex:none;}' +
    '.dc-sel{color:#a5b4fc;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}' +
    '.dc-del{color:#71717a;flex:none;font-size:13px;}' +
    '.dc-del:hover{color:#f87171;}' +
    '.dc-ctext{color:#e4e4e7;font-size:12px;white-space:pre-wrap;word-break:break-word;}' +
    '.dc-empty{padding:14px 12px;color:#71717a;font-size:12px;text-align:center;}' +
    '.dc-pop{position:fixed;pointer-events:auto;background:#18181b;color:#fff;border-radius:10px;width:280px;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.5);z-index:10;display:none;border:1px solid #3f3f46;}' +
    '.dc-pop-h{font-size:11px;color:#a5b4fc;padding:8px 10px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.dc-pop textarea{width:100%;min-height:70px;resize:vertical;border:0;background:#27272a;color:#fff;' +
      'border-radius:8px;margin:8px 10px;width:calc(100% - 20px);padding:8px;font-size:13px;font-family:inherit;}' +
    '.dc-pop textarea:focus{outline:2px solid #6366f1;}' +
    '.dc-pop-row{display:flex;gap:8px;padding:0 10px 10px;}' +
    '.dc-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#22c55e;color:#fff;' +
      'padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600;pointer-events:none;opacity:0;' +
      'transition:opacity .2s;box-shadow:0 6px 20px rgba(0,0,0,.4);}' +
    '.dc-toast.show{opacity:1;}' +
    '.dc-collapsed .dc-row,.dc-collapsed .dc-list{display:none;}' +
    '</style>' +
    '<div class="dc-layer">' +
    '  <div class="dc-highlight"></div>' +
    '  <div class="dc-label"></div>' +
    '  <div class="dc-pins"></div>' +
    '</div>' +
    '<div class="dc-pop">' +
    '  <div class="dc-pop-h"></div>' +
    '  <textarea placeholder="이 요소에 대한 수정 요청을 적어주세요…"></textarea>' +
    '  <div class="dc-pop-row">' +
    '    <button class="dc-btn primary dc-pop-save">저장</button>' +
    '    <button class="dc-btn dc-pop-cancel">취소</button>' +
    '  </div>' +
    '</div>' +
    '<div class="dc-toolbar">' +
    '  <div class="dc-tb-head">' +
    '    <span class="dc-dot"></span>' +
    '    <span class="dc-title">Design Commenter</span>' +
    '    <span class="dc-min" title="접기/펼치기">—</span>' +
    '  </div>' +
    '  <div class="dc-row">' +
    '    <button class="dc-btn dc-toggle">✎ 편집 모드</button>' +
    '  </div>' +
    '  <div class="dc-row">' +
    '    <button class="dc-btn primary dc-copy">📋 Claude Code로 복사</button>' +
    '    <button class="dc-btn dc-clear" title="전체 삭제">🗑</button>' +
    '  </div>' +
    '  <div class="dc-list"></div>' +
    '</div>' +
    '<div class="dc-toast"></div>';

  var $ = function (s) { return root.querySelector(s); };
  var ui = {
    highlight: $(".dc-highlight"),
    label: $(".dc-label"),
    pins: $(".dc-pins"),
    toolbar: $(".dc-toolbar"),
    dot: $(".dc-dot"),
    toggle: $(".dc-toggle"),
    copy: $(".dc-copy"),
    clear: $(".dc-clear"),
    list: $(".dc-list"),
    min: $(".dc-min"),
    pop: $(".dc-pop"),
    popHead: $(".dc-pop-h"),
    popText: $(".dc-pop textarea"),
    popSave: $(".dc-pop-save"),
    popCancel: $(".dc-pop-cancel"),
    toast: $(".dc-toast"),
  };

  // ---------------------------------------------------------------------------
  // Element introspection
  // ---------------------------------------------------------------------------

  // Robust-ish CSS selector: prefer #id, else tag.classes + :nth-of-type path.
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return "#" + cssEscape(el.id);
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      var sel = node.tagName.toLowerCase();
      var cls = classTokens(node);
      if (cls.length) sel += "." + cls.map(cssEscape).join(".");
      var parent = node.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === node.tagName;
        });
        if (same.length > 1) sel += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(sel);
      if (node.id) { parts[0] = "#" + cssEscape(node.id); break; }
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function classTokens(el) {
    // className may be an SVGAnimatedString on SVG nodes.
    var c = el.getAttribute && el.getAttribute("class");
    if (!c) return [];
    return c.split(/\s+/).filter(Boolean).slice(0, 4); // cap to keep selectors sane
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  // React dev source via fiber._debugSource (enabled by @vitejs/plugin-react in
  // dev, or babel-plugin-transform-react-jsx-source). Returns "file:line:col".
  function reactSource(el) {
    var key = null;
    for (var k in el) {
      if (k.indexOf("__reactFiber$") === 0 || k.indexOf("__reactInternalInstance$") === 0) {
        key = k; break;
      }
    }
    if (!key) return null;
    var fiber = el[key];
    var guard = 0;
    while (fiber && guard++ < 50) {
      var src = fiber._debugSource;
      if (src && src.fileName) {
        var loc = src.fileName;
        if (src.lineNumber != null) loc += ":" + src.lineNumber;
        if (src.columnNumber != null) loc += ":" + src.columnNumber;
        return loc;
      }
      fiber = fiber._debugOwner || fiber.return;
    }
    return null;
  }

  function describe(el) {
    var tag = el.tagName.toLowerCase();
    var cls = classTokens(el);
    var head = "<" + tag + (el.id ? " #" + el.id : "") + (cls.length ? " ." + cls.join(".") : "") + ">";
    var txt = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
    return { tag: tag, head: head, text: txt };
  }

  // ---------------------------------------------------------------------------
  // Highlight + label
  // ---------------------------------------------------------------------------
  function showHighlight(el) {
    var r = el.getBoundingClientRect();
    ui.highlight.style.display = "block";
    ui.highlight.style.left = r.left + "px";
    ui.highlight.style.top = r.top + "px";
    ui.highlight.style.width = r.width + "px";
    ui.highlight.style.height = r.height + "px";

    var d = describe(el);
    var src = reactSource(el);
    ui.label.textContent = d.head + (src ? "  ·  " + src.split("/").pop() : "");
    ui.label.style.display = "block";
    var ly = r.top - 24 < 4 ? r.top + 4 : r.top - 24;
    ui.label.style.left = Math.max(4, r.left) + "px";
    ui.label.style.top = ly + "px";
  }
  function hideHighlight() {
    ui.highlight.style.display = "none";
    ui.label.style.display = "none";
  }

  // ---------------------------------------------------------------------------
  // Event wiring (only while active)
  // ---------------------------------------------------------------------------
  var rafPending = false;
  var lastXY = { x: 0, y: 0 };

  function onMove(e) {
    lastXY.x = e.clientX; lastXY.y = e.clientY;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      if (!active) return;
      var t = document.elementFromPoint(lastXY.x, lastXY.y);
      if (!t || t === host || t === document.documentElement || t === document.body) {
        hoverEl = null; hideHighlight(); return;
      }
      hoverEl = t;
      showHighlight(t);
    });
  }

  function isOwnUI(e) {
    var path = e.composedPath ? e.composedPath() : [];
    return path.indexOf(root) !== -1 || path.indexOf(host) !== -1;
  }

  function onClick(e) {
    if (!active) return;
    if (isOwnUI(e)) return; // clicks on toolbar/popup/pins handled separately
    e.preventDefault();
    e.stopPropagation();
    var t = document.elementFromPoint(e.clientX, e.clientY);
    if (!t || t === host) return;
    openPopup(t, null);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      if (ui.pop.style.display === "block") closePopup();
      else if (active) setActive(false);
    }
  }

  function reposition() {
    if (active && hoverEl && hoverEl.isConnected) showHighlight(hoverEl);
    renderPins();
    if (pendingEl) positionPopup(pendingEl);
  }

  function setActive(on) {
    active = on;
    ui.dot.classList.toggle("on", on);
    ui.toggle.classList.toggle("on", on);
    ui.toggle.textContent = on ? "● 편집 중 (클릭하여 종료)" : "✎ 편집 모드";
    document.documentElement.style.cursor = on ? "crosshair" : "";
    if (on) {
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("click", onClick, true);
      window.addEventListener("scroll", reposition, true);
      window.addEventListener("resize", reposition, true);
    } else {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition, true);
      hideHighlight();
      hoverEl = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Comment popup
  // ---------------------------------------------------------------------------
  function positionPopup(el) {
    var r = el.getBoundingClientRect();
    var pw = 280, ph = 150;
    var left = Math.min(r.left, window.innerWidth - pw - 8);
    var top = r.bottom + 8;
    if (top + ph > window.innerHeight) top = Math.max(8, r.top - ph - 8);
    ui.pop.style.left = Math.max(8, left) + "px";
    ui.pop.style.top = top + "px";
  }

  function openPopup(el, id) {
    pendingEl = el;
    editingId = id;
    var d = describe(el);
    var src = reactSource(el);
    ui.popHead.textContent = (src ? src.split("/").pop() + "  ·  " : "") + d.head;
    var existing = id != null ? comments.find(function (c) { return c.id === id; }) : null;
    ui.popText.value = existing ? existing.comment : "";
    ui.pop.style.display = "block";
    positionPopup(el);
    showHighlight(el);
    ui.popText.focus();
  }

  function closePopup() {
    ui.pop.style.display = "none";
    pendingEl = null;
    editingId = null;
  }

  function saveComment() {
    if (!pendingEl) return;
    var text = ui.popText.value.trim();
    if (!text) { ui.popText.focus(); return; }
    if (editingId != null) {
      var c = comments.find(function (x) { return x.id === editingId; });
      if (c) c.comment = text;
    } else {
      var d = describe(pendingEl);
      comments.push({
        id: nextId++,
        selector: cssPath(pendingEl),
        source: reactSource(pendingEl),
        tag: d.tag,
        head: d.head,
        text: d.text,
        comment: text,
        _el: pendingEl,
      });
    }
    persist();
    closePopup();
    renderList();
    renderPins();
  }

  // ---------------------------------------------------------------------------
  // Pins
  // ---------------------------------------------------------------------------
  function resolveEl(c) {
    if (c._el && c._el.isConnected) return c._el;
    try {
      var el = document.querySelector(c.selector);
      if (el) { c._el = el; return el; }
    } catch (e) {}
    return null;
  }

  function renderPins() {
    ui.pins.innerHTML = "";
    comments.forEach(function (c, i) {
      var el = resolveEl(c);
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return; // offscreen
      var pin = document.createElement("div");
      pin.className = "dc-pin";
      pin.textContent = i + 1;
      pin.style.left = (r.left + 11) + "px";
      pin.style.top = (r.top) + "px";
      pin.title = c.comment;
      pin.addEventListener("click", function (e) {
        e.stopPropagation();
        openPopup(el, c.id);
      });
      ui.pins.appendChild(pin);
    });
  }

  // ---------------------------------------------------------------------------
  // List panel
  // ---------------------------------------------------------------------------
  function renderList() {
    ui.copy.disabled = comments.length === 0;
    if (!comments.length) {
      ui.list.innerHTML = '<div class="dc-empty">편집 모드를 켜고 요소를 클릭해 코멘트를 남기세요.</div>';
      return;
    }
    ui.list.innerHTML = "";
    comments.forEach(function (c, i) {
      var item = document.createElement("div");
      item.className = "dc-item";
      var srcLabel = c.source ? c.source.split("/").pop() : c.selector;
      item.innerHTML =
        '<div class="dc-item-h">' +
        '  <span class="dc-num">' + (i + 1) + '</span>' +
        '  <span class="dc-sel"></span>' +
        '  <span class="dc-del" title="삭제">✕</span>' +
        '</div>' +
        '<div class="dc-ctext"></div>';
      item.querySelector(".dc-sel").textContent = srcLabel;
      item.querySelector(".dc-ctext").textContent = c.comment;
      item.addEventListener("click", function () {
        var el = resolveEl(c);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(function () { showHighlight(el); renderPins(); }, 300);
          setTimeout(hideHighlight, 1500);
        }
      });
      item.querySelector(".dc-del").addEventListener("click", function (e) {
        e.stopPropagation();
        comments = comments.filter(function (x) { return x.id !== c.id; });
        persist(); renderList(); renderPins();
      });
      ui.list.appendChild(item);
    });
    notifyCount();
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  function buildMarkdown() {
    var lines = [];
    lines.push("# 디자인 수정 요청 (" + comments.length + "건)");
    lines.push("페이지: " + document.title + " — " + location.href);
    lines.push("");
    lines.push("> 아래는 실제 화면 위에서 요소별로 남긴 수정 요청입니다. 각 항목의");
    lines.push("> Source(파일:라인) 또는 Selector로 해당 코드를 찾아 Comment 내용을");
    lines.push("> 반영해 주세요. Source가 있으면 그 위치를 우선 신뢰하세요.");
    lines.push("");
    comments.forEach(function (c, i) {
      lines.push("## " + (i + 1) + ". " + c.head);
      if (c.source) lines.push("- Source: " + c.source);
      lines.push("- Selector: `" + c.selector + "`");
      if (c.text) lines.push('- Text: "' + c.text + '"');
      lines.push("- Comment: " + c.comment);
      lines.push("");
    });
    return lines.join("\n");
  }

  function copyExport() {
    if (!comments.length) return;
    var md = buildMarkdown();
    var done = function () { toast("복사됨! Claude Code에 붙여넣으세요 (" + comments.length + "건)"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(done, function () { fallbackCopy(md, done); });
    } else {
      fallbackCopy(md, done);
    }
  }

  function fallbackCopy(text, cb) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); cb(); } catch (e) { alert("복사 실패 — 콘솔에 출력합니다."); console.log(text); }
    document.body.removeChild(ta);
  }

  var toastTimer = null;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toast.classList.remove("show"); }, 2200);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  function persist() {
    try {
      var data = comments.map(function (c) {
        return { id: c.id, selector: c.selector, source: c.source, tag: c.tag,
                 head: c.head, text: c.text, comment: c.comment };
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ nextId: nextId, comments: data }));
    } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      comments = (parsed.comments || []).map(function (c) { c._el = null; return c; });
      nextId = parsed.nextId || (comments.length + 1);
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // Toolbar controls
  // ---------------------------------------------------------------------------
  ui.toggle.addEventListener("click", function () { setActive(!active); });
  ui.copy.addEventListener("click", copyExport);
  ui.clear.addEventListener("click", function () {
    if (!comments.length) return;
    if (!confirm("이 페이지의 코멘트 " + comments.length + "건을 모두 삭제할까요?")) return;
    comments = []; persist(); renderList(); renderPins();
  });
  ui.min.addEventListener("click", function () {
    ui.toolbar.classList.toggle("dc-collapsed");
    ui.min.textContent = ui.toolbar.classList.contains("dc-collapsed") ? "+" : "—";
  });
  ui.popSave.addEventListener("click", saveComment);
  ui.popCancel.addEventListener("click", closePopup);
  ui.popText.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveComment();
  });
  document.addEventListener("keydown", onKey, true);

  // Keep pins glued to elements as the page mutates/animates.
  setInterval(function () { if (comments.length) renderPins(); }, 700);

  // ---------------------------------------------------------------------------
  // Public API + boot
  // ---------------------------------------------------------------------------
  window.__designCommenter = {
    toggleToolbar: function () {
      host.style.display = host.style.display === "none" ? "" : "none";
    },
    setActive: setActive,
    export: buildMarkdown,
    clear: function () { comments = []; persist(); renderList(); renderPins(); },
  };

  // ---------------------------------------------------------------------------
  // Embedded (shell) wiring — postMessage bridge to app.html
  // ---------------------------------------------------------------------------
  if (EMBEDDED) {
    ui.toolbar.style.display = "none"; // shell owns the controls
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "dc:setActive") setActive(!!d.active);
      else if (d.type === "dc:export") postToShell("dc:exported", { markdown: buildMarkdown(), count: comments.length });
      else if (d.type === "dc:clear") { comments = []; persist(); renderList(); renderPins(); }
    });
  }

  load();
  renderList();
  renderPins();
  if (EMBEDDED) {
    postToShell("dc:ready");
    notifyCount();
  } else {
    toast("Design Commenter 준비됨 — 우측 하단 패널");
  }
})();
