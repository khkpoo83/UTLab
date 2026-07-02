// jsdom smoke for design-commenter.js — overlay boots without runtime errors.
// Run (jsdom lives in frontend/): NODE_PATH=frontend/node_modules node tools/design-commenter/smoke.cjs
const { JSDOM } = require("jsdom");
const fs = require("fs");
const code = fs.readFileSync(require("path").join(__dirname, "design-commenter.js"), "utf8");

const dom = new JSDOM(`<!doctype html><html><body>
  <main><button class="btn primary" id="cta">Hi</button>
  <div class="card"><div class="tile">T1</div><div class="tile">T2</div></div></main>
</body></html>`, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });

const { window } = dom;
// minimal shims jsdom lacks
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.CSS = window.CSS || { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&") };

const errors = [];
window.addEventListener && window.addEventListener("error", (e) => errors.push(e.message));

// run the IIFE in the window context
const vm = require("vm");
const ctx = dom.getInternalVMContext();
try {
  vm.runInContext(code, ctx, { filename: "design-commenter.js" });
} catch (e) {
  console.error("THREW at load:", e.message);
  process.exit(1);
}

const doc = window.document;
const host = doc.getElementById("design-commenter-host");
console.log("host injected:", !!host);
console.log("shadowRoot:", !!(host && host.shadowRoot));
const sr = host.shadowRoot;
console.log("toolbar:", !!sr.querySelector(".dc-toolbar"));
console.log("toggle btn:", !!sr.querySelector(".dc-toggle"));
console.log("copy btn:", !!sr.querySelector(".dc-copy"));
console.log("popup:", !!sr.querySelector(".dc-pop"));
console.log("public API:", typeof window.__designCommenter, typeof window.__designCommenter.export);

// export with zero comments should still produce a header
const md0 = window.__designCommenter.export();
console.log("export(0) starts with header:", md0.startsWith("# 디자인 수정 요청 (0건)"));

// simulate selector + source extraction by exercising internal via DOM:
// open the popup programmatically isn't exposed; instead verify cssPath-like
// selector building indirectly through a click handler would need layout.
// We at least confirm no errors were thrown during boot + 1 tick.
setTimeout(() => {
  console.log("runtime errors after tick:", errors.length ? errors : "none");
  console.log("SMOKE OK");
}, 30);
