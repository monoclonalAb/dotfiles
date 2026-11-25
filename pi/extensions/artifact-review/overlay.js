// Review panel added to the page by /artifact-review (served by server.ts).
//
// Option-click (Alt-click) any part of the page, or select text and press
// "Add note", to write a note about it. Notes wait in the panel, and in this
// tab's sessionStorage, until Send delivers them to Pi. When the server says a
// file in the page's folder changed, the page reloads and returns to the same
// scroll position; the address (including anything after #) is kept. The panel
// lives in a shadow root so the page's styles cannot reach it.
//
// The panel, its collapsed pill and the reload banner stay put on screen. The
// outlines, the note card and the "Add note" button are placed in page
// coordinates, so they scroll with the part of the page they belong to.
(() => {
  if (window.__artifactReview) return;
  window.__artifactReview = true;

  const script = document.currentScript;
  const base = (script && script.src ? script.src : location.href).replace(/__review\/overlay\.js.*$/, "");
  const pagePath = location.pathname.replace(/^\/[^/]+/, "");
  const KEY = `artifact-review:${pagePath}`;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const OPTION = isMac ? "Option" : "Alt";

  // ---- stored state (survives reloads of this tab) ----
  const load = (name, fallback) => {
    try {
      const value = JSON.parse(sessionStorage.getItem(`${KEY}:${name}`) ?? "null");
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };
  const save = (name, value) => {
    try {
      if (value === undefined) sessionStorage.removeItem(`${KEY}:${name}`);
      else sessionStorage.setItem(`${KEY}:${name}`, JSON.stringify(value));
    } catch {
      /* storage full or blocked: keep going in memory */
    }
  };

  let queue = load("queue", []);
  let clickMode = load("clickMode", false);
  let collapsed = load("collapsed", false);
  let lastSent = load("lastSent", "");
  let busy = false;
  let connected = false;
  let stopped = false;
  let sending = false;
  let flash = "";
  let flashTimer;
  let card = null; // { kind, el, quote, target, screen, label, range }
  let pendingReload = false;
  let lastPointer = null;
  let lastX = -1;
  let lastY = -1;
  let altHeld = false;
  let hoverEl = null; // outlined because Option is held or plain clicks add notes
  let shownTarget = null; // outlined because its queued note is under the pointer
  let selRange = null; // the selection the "Add note" button belongs to
  let nextId = queue.reduce((max, note) => Math.max(max, note.id || 0), 0) + 1;

  // ---- describing the page ----
  const squash = (text, max) => {
    const value = String(text ?? "").replace(/\s+/g, " ").trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  };
  const visible = (el) => el.getClientRects().length > 0;
  const textOf = (el, max = 160) => squash(el.innerText !== undefined ? el.innerText : el.textContent, max);

  function cssPath(el) {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      let part = node.localName;
      const first = [...node.classList].find((name) => /^[A-Za-z_][\w-]*$/.test(name));
      if (first) part += `.${first}`;
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((child) => child.localName === node.localName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (parts.length >= 10) break;
    }
    return parts.join(" > ");
  }

  function labelOf(el) {
    const own = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt");
    if (own) return squash(own, 160);
    const titled = el.closest("[title]");
    if (titled) return squash(titled.getAttribute("title"), 160);
    const labelled = el.closest("[aria-label]");
    if (labelled) return squash(labelled.getAttribute("aria-label"), 160);
    const svgTitle = el.closest("svg")?.querySelector("title");
    return svgTitle ? squash(svgTitle.textContent, 160) : "";
  }

  /**
   * The section the element is in: the nearest heading before it, or for a
   * heading (or text inside one), the nearest heading of a higher level.
   */
  function headingFor(el) {
    const own = el.closest("h1, h2, h3, h4, h5, h6");
    const latest = [];
    let last = "";
    for (const heading of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
      if (heading === own || !(heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      const text = textOf(heading, 160);
      if (!text) continue;
      const level = Number(heading.localName[1]);
      latest[level] = text;
      latest.length = level + 1;
      last = text;
    }
    if (!own) return last;
    for (let level = Number(own.localName[1]) - 1; level >= 1; level--) if (latest[level]) return latest[level];
    return "";
  }

  function describe(el) {
    return { tag: el.localName, selector: cssPath(el), text: textOf(el), label: labelOf(el), heading: headingFor(el) };
  }

  /** A label's own words, without the text of any control inside it (a wrapped picker's options). */
  function wordsOf(el) {
    const copy = el.cloneNode(true);
    for (const control of copy.querySelectorAll("select, input, textarea, button")) control.remove();
    return squash(copy.textContent, 120);
  }

  function controlLabel(el) {
    const label = el.labels && el.labels[0] ? wordsOf(el.labels[0]) : "";
    if (label) return label;
    const by = el.getAttribute("aria-labelledby");
    const named = by && document.getElementById(by);
    return named ? wordsOf(named) : squash(el.getAttribute("aria-label") || el.name || el.id || "", 120);
  }

  /** What is on screen: pressed tabs and buttons, picker values, the address after #. */
  function captureScreen() {
    const pressed = [...document.querySelectorAll('[aria-pressed="true"], [aria-selected="true"], [aria-current]:not([aria-current="false"])')]
      .filter(visible)
      .map((el) => textOf(el, 120))
      .filter(Boolean)
      .slice(0, 10);
    const pickers = [...document.querySelectorAll("select")]
      .filter(visible)
      .map((el) => ({ label: controlLabel(el), value: squash(el.selectedOptions[0] ? el.selectedOptions[0].textContent : el.value, 200) }));
    for (const radio of document.querySelectorAll('input[type="radio"]:checked')) {
      if (visible(radio)) pickers.push({ label: squash(radio.name, 120), value: controlLabel(radio) || radio.value });
    }
    return { hash: location.hash.replace(/^#/, ""), pressed, pickers: pickers.filter((p) => p.value).slice(0, 10) };
  }

  const shortLabel = (note) => {
    if (note.kind === "page") return "Whole page";
    if (note.kind === "selection") return `Text “${squash(note.quote, 60)}”`;
    const words = note.target.text || note.target.label;
    return `${note.target.tag}${words ? ` “${squash(words, 60)}”` : ""}`;
  };

  // ---- panel ----
  const host = document.createElement("div");
  host.id = "__artifact-review";
  host.setAttribute("style", "all: initial !important; position: absolute !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important;");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
<style>
  :host { color-scheme: light dark; }
  * { box-sizing: border-box; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .ui { --bg: #fff; --fg: #1d1d1f; --muted: #6e6e73; --line: #d2d2d7; --accent: #0a66d8; --soft: #eef4fd; --warn: #b3261e; }
  @media (prefers-color-scheme: dark) { .ui { --bg: #1f1f22; --fg: #f2f2f4; --muted: #a1a1a8; --line: #3a3a3f; --accent: #5ea3ff; --soft: #24324a; --warn: #ff8a80; } }
  button { cursor: pointer; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); padding: 4px 10px; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  button:disabled { opacity: .5; cursor: default; }
  textarea { width: 100%; resize: vertical; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; background: var(--bg); color: var(--fg); }
  textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  .panel, .card, .pill, .banner, .selbtn { position: absolute; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.18); }
  .panel, .pill, .banner { position: fixed; }
  .panel { right: 16px; bottom: 16px; width: 330px; max-height: 70vh; display: flex; flex-direction: column; }
  .head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  .head b { font-weight: 600; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #34c759; flex: none; }
  .dot.busy { background: #ff9f0a; }
  .dot.off { background: #8e8e93; }
  .status { color: var(--muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .head button { padding: 0 8px; }
  .body { padding: 8px 10px 10px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
  .hint { color: var(--muted); margin: 0; }
  .mode { display: flex; gap: 6px; align-items: center; color: var(--muted); }
  ol { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
  li { border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; display: grid; grid-template-columns: 1fr auto; gap: 2px 6px; }
  li:hover { background: var(--soft); }
  li .what { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li .text { grid-column: 1; white-space: pre-wrap; word-break: break-word; }
  li button { grid-row: 1 / span 2; grid-column: 2; align-self: start; border: none; color: var(--muted); padding: 0 4px; }
  .actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
  .message { color: var(--muted); }
  .message.error { color: var(--warn); }
  .message button { padding: 0 6px; margin-left: 4px; }
  .pill { right: 16px; bottom: 16px; padding: 6px 12px; cursor: pointer; display: flex; gap: 8px; align-items: center; }
  .card { width: 340px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .card .what { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card .row { display: flex; gap: 8px; align-items: center; }
  .card .keys { color: var(--muted); font-size: 11px; flex: 1; }
  .box { position: absolute; pointer-events: none; border: 2px solid var(--accent); background: rgba(10,102,216,.08); border-radius: 3px; }
  .box.target { border-style: solid; background: rgba(10,102,216,.14); }
  .selbtn { padding: 3px 10px; border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .banner { left: 50%; top: 12px; transform: translateX(-50%); padding: 6px 12px; display: flex; gap: 8px; align-items: center; }
  [hidden] { display: none !important; }
</style>
<div class="ui">
  <div class="box hover" hidden></div>
  <div class="box target" hidden></div>
  <div class="panel">
    <div class="head"><span class="dot"></span><b>Review</b><span class="status"></span><button class="min" title="Hide">–</button></div>
    <div class="body">
      <p class="hint">${OPTION}-click any part of the page, or select text, to add a note.</p>
      <label class="mode"><input type="checkbox" class="clickmode"> Plain clicks add notes</label>
      <ol class="queue"></ol>
      <textarea class="pagenote" rows="2" placeholder="Note on the whole page (optional)"></textarea>
      <div class="actions"><span class="message"></span><button class="primary send">Send to Pi</button></div>
    </div>
  </div>
  <div class="pill" hidden><span class="dot"></span><span class="pilltext">Review</span></div>
  <button class="selbtn" hidden>Add note</button>
  <div class="card" hidden>
    <div class="what"></div>
    <textarea rows="3" placeholder="What should change?"></textarea>
    <div class="row"><span class="keys">Enter adds · Shift+Enter new line · ${isMac ? "⌘" : "Ctrl+"}Enter adds and sends</span><button class="cancel">Cancel</button><button class="primary add">Add</button></div>
  </div>
  <div class="banner" hidden>The page changed. <button class="reloadnow">Reload now</button></div>
</div>`;
  const $ = (selector) => root.querySelector(selector);
  const ui = {
    panel: $(".panel"), pill: $(".pill"), pillText: $(".pilltext"), dots: root.querySelectorAll(".dot"), status: $(".status"),
    min: $(".min"), clickMode: $(".clickmode"), queue: $(".queue"), pageNote: $(".pagenote"), send: $(".send"), message: $(".message"),
    hover: $(".box.hover"), target: $(".box.target"), selBtn: $(".selbtn"), card: $(".card"), cardWhat: $(".card .what"),
    cardText: $(".card textarea"), add: $(".add"), cancel: $(".cancel"), banner: $(".banner"), reloadNow: $(".reloadnow"),
  };
  document.documentElement.appendChild(host);
  const inUi = (event) => event.composedPath().includes(host);

  // ---- rendering ----
  function setMessage(text, kind = "", copy = false) {
    ui.message.className = `message ${kind}`;
    ui.message.textContent = text;
    if (copy && lastSent) {
      const button = document.createElement("button");
      button.textContent = "Copy";
      button.title = "Copy the message Pi received";
      button.addEventListener("click", () => navigator.clipboard?.writeText(lastSent).then(() => setMessage("Copied.")));
      ui.message.appendChild(button);
    }
  }

  function showFlash(text, ms = 4000) {
    flash = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flash = "";
      render();
    }, ms);
    render();
  }

  function statusText() {
    if (stopped) return `Review stopped. Run /artifact-review in Pi to start again.`;
    if (!connected) return "Not connected to Pi";
    if (sending) return "Sending…";
    if (flash) return flash;
    return busy ? "Pi is working…" : "Pi is ready";
  }

  function render() {
    ui.panel.hidden = collapsed;
    ui.pill.hidden = !collapsed;
    const state = stopped || !connected ? "off" : busy ? "busy" : "";
    for (const dot of ui.dots) dot.className = `dot ${state}`;
    ui.status.textContent = statusText();
    ui.pillText.textContent = queue.length ? `Review · ${queue.length} note${queue.length === 1 ? "" : "s"}` : "Review";
    ui.clickMode.checked = clickMode;
    ui.queue.replaceChildren(
      ...queue.map((note, index) => {
        const item = document.createElement("li");
        const what = document.createElement("span");
        what.className = "what";
        what.textContent = `${index + 1}. ${note.label}`;
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = note.note;
        const remove = document.createElement("button");
        remove.textContent = "×";
        remove.title = "Remove this note";
        remove.addEventListener("click", () => {
          queue = queue.filter((other) => other.id !== note.id);
          save("queue", queue);
          hideNoteTarget();
          render();
        });
        item.addEventListener("mouseenter", () => showNoteTarget(note));
        item.addEventListener("mouseleave", hideNoteTarget);
        item.append(what, remove, text);
        return item;
      }),
    );
    const count = queue.length + (ui.pageNote.value.trim() ? 1 : 0);
    ui.send.textContent = count > 1 ? `Send ${count} notes to Pi` : "Send to Pi";
    ui.send.disabled = !count || sending || stopped || !connected;
  }

  /** Outlines a screen rectangle, placed in page coordinates so it scrolls with the page. */
  function placeBox(box, rect) {
    if (!rect || (!rect.width && !rect.height)) return hideBox(box);
    Object.assign(box.style, {
      left: `${rect.left + scrollX - 2}px`,
      top: `${rect.top + scrollY - 2}px`,
      width: `${rect.width + 4}px`,
      height: `${rect.height + 4}px`,
    });
    box.hidden = false;
  }
  function hideBox(box) {
    box.hidden = true;
  }

  function updateHover() {
    hoverEl = !card && (clickMode || altHeld) && lastPointer instanceof Element ? lastPointer : null;
    if (hoverEl) placeBox(ui.hover, hoverEl.getBoundingClientRect());
    else hideBox(ui.hover);
  }

  function showNoteTarget(note) {
    if (card || note.kind === "page") return;
    let el = null;
    try {
      el = document.querySelector(note.target.selector);
    } catch {
      el = null;
    }
    if (!el) return;
    shownTarget = el;
    placeBox(ui.target, el.getBoundingClientRect());
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function hideNoteTarget() {
    shownTarget = null;
    if (!card) hideBox(ui.target);
  }

  function placeSelButton() {
    const rect = selRange && selRange.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      ui.selBtn.hidden = true;
      return;
    }
    ui.selBtn.style.left = `${Math.min(rect.right + 4, innerWidth - 100) + scrollX}px`;
    ui.selBtn.style.top = `${rect.bottom + 4 + scrollY}px`;
  }

  // Page scrolling moves everything placed in page coordinates by itself. This
  // catches up the rest once per frame: a box inside a scrolled panel of the
  // page, and the outline under a pointer that stayed still while the page moved.
  let frame = 0;
  function reposition() {
    frame = 0;
    if (hoverEl && lastX >= 0) {
      const under = document.elementFromPoint(lastX, lastY);
      if (under && under !== host) lastPointer = under;
      updateHover();
    }
    if (card) placeCard();
    else if (shownTarget) placeBox(ui.target, shownTarget.getBoundingClientRect());
    if (selRange && !ui.selBtn.hidden) placeSelButton();
  }
  const scheduleReposition = () => {
    frame ||= requestAnimationFrame(reposition);
  };

  // ---- note card ----
  function openCard(spec) {
    const target = describe(spec.el);
    card = { ...spec, target, screen: captureScreen() };
    card.label = shortLabel({ kind: spec.kind, target, quote: spec.quote });
    ui.cardWhat.textContent = card.label;
    ui.cardWhat.title = target.selector;
    ui.cardText.value = "";
    hoverEl = null;
    hideBox(ui.hover);
    selRange = null;
    ui.selBtn.hidden = true;
    ui.card.hidden = false;
    placeCard();
    ui.cardText.focus({ preventScroll: true });
  }

  function cardRect() {
    if (!card) return null;
    if (card.range) {
      const rect = card.range.getBoundingClientRect();
      if (rect.width || rect.height) return rect;
    }
    return card.el.isConnected ? card.el.getBoundingClientRect() : null;
  }

  /**
   * The card opens next to what it is about (below it, or above when there is
   * no room; next to the click for anything taller than most of the screen) and
   * then keeps that distance from it, so it scrolls along with it.
   */
  function placeCard() {
    const rect = cardRect();
    placeBox(ui.target, rect);
    if (!rect) return; // what it pointed at is gone: leave the card where it is
    if (!card.offset) {
      const width = 340;
      const height = ui.card.offsetHeight || 140;
      const tall = rect.height > innerHeight * 0.6 && card.point;
      const above = tall ? card.point.y : rect.top;
      const below = tall ? card.point.y : rect.bottom;
      let top = below + 8;
      if (top + height > innerHeight - 8) top = above - height - 8 >= 8 ? above - height - 8 : Math.max(8, innerHeight - height - 8);
      const left = Math.min(Math.max(8, tall ? card.point.x - 20 : rect.left), innerWidth - width - 8);
      card.offset = { x: left - rect.left, y: top - rect.top };
    }
    Object.assign(ui.card.style, { left: `${rect.left + card.offset.x + scrollX}px`, top: `${rect.top + card.offset.y + scrollY}px` });
  }

  function closeCard() {
    card = null;
    ui.card.hidden = true;
    hideBox(ui.target);
    if (shownTarget) placeBox(ui.target, shownTarget.getBoundingClientRect());
    if (pendingReload && !sending) reloadPage();
  }

  function addFromCard() {
    const note = ui.cardText.value.trim();
    if (!card || !note) return false;
    queue.push({ id: nextId++, kind: card.kind, note, target: card.target, quote: card.quote, screen: card.screen, label: card.label });
    save("queue", queue);
    closeCard();
    render();
    return true;
  }

  // ---- sending ----
  async function sendNotes() {
    const pageNote = ui.pageNote.value.trim();
    const notes = queue.map(({ kind, note, target, quote, screen }) => ({ kind, note, target, quote, screen }));
    if (pageNote) notes.push({ kind: "page", note: pageNote, screen: captureScreen() });
    if (!notes.length || sending || stopped) return;
    const sentQueue = queue.slice();
    sending = true;
    setMessage("Confirm them in Pi to send.");
    render();
    try {
      const response = await fetch(`${base}__review/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes }) });
      const result = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
      if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
      // Notes added while Pi asked stay for the next Send.
      queue = queue.filter((item) => !sentQueue.includes(item));
      save("queue", queue);
      if (ui.pageNote.value.trim() === pageNote) {
        ui.pageNote.value = "";
        save("pageNote", undefined);
      }
      lastSent = result.text || "";
      save("lastSent", lastSent);
      const count = `${result.count} note${result.count === 1 ? "" : "s"}`;
      setMessage(result.queued ? `Sent ${count}. Pi reads them when it finishes its current step.` : `Sent ${count}.`, "", true);
    } catch (error) {
      setMessage(`Not sent: ${error.message}. Your notes are still here.`, "error");
    } finally {
      sending = false;
      render();
      if (pendingReload && !stopped && !(card && ui.cardText.value.trim())) reloadPage();
    }
  }

  // ---- reloading ----
  function reloadPage() {
    save("scroll", { x: scrollX, y: scrollY, at: Date.now() });
    save("updated", true);
    location.reload();
  }

  function onChange() {
    if (sending || (card && ui.cardText.value.trim())) {
      pendingReload = true;
      ui.banner.hidden = false;
      return;
    }
    reloadPage();
  }

  function restoreScroll() {
    const saved = load("scroll", null);
    save("scroll", undefined);
    if (load("updated", false)) {
      save("updated", undefined);
      showFlash("Page updated");
    }
    if (!saved || Date.now() - saved.at > 60_000) return;
    const go = () => scrollTo(saved.x, saved.y);
    if (document.readyState === "complete") go();
    else addEventListener("load", go, { once: true });
    setTimeout(go, 300);
  }

  // ---- connection to Pi ----
  function connect() {
    const events = new EventSource(`${base}__review/events`);
    events.addEventListener("hello", (event) => {
      connected = true;
      busy = !!JSON.parse(event.data).busy;
      render();
    });
    events.addEventListener("busy", (event) => {
      busy = !!JSON.parse(event.data).busy;
      render();
    });
    events.addEventListener("reload", onChange);
    events.addEventListener("stopped", () => {
      stopped = true;
      events.close();
      render();
    });
    events.addEventListener("error", () => {
      connected = false;
      if (events.readyState === EventSource.CLOSED) stopped = true;
      render();
    });
  }

  // ---- page events ----
  addEventListener(
    "mousemove",
    (event) => {
      lastX = event.clientX;
      lastY = event.clientY;
      altHeld = event.altKey;
      if (inUi(event)) return;
      lastPointer = event.target;
      updateHover();
    },
    { capture: true, passive: true },
  );
  addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Alt") return;
      altHeld = true;
      updateHover();
    },
    true,
  );
  addEventListener(
    "keyup",
    (event) => {
      if (event.key !== "Alt") return;
      altHeld = false;
      updateHover();
    },
    true,
  );
  addEventListener("blur", () => {
    altHeld = false;
    updateHover();
  });
  addEventListener(
    "click",
    (event) => {
      if (inUi(event) || !(clickMode || event.altKey) || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (card) return;
      // A drag that selected text is handled by the "Add note" button.
      const selection = getSelection();
      if (!event.altKey && selection && !selection.isCollapsed && selection.toString().trim()) return;
      const el = event.target instanceof Element ? event.target : event.target.parentElement;
      // Empty space outside the body lands on <html>: a note on the whole page.
      if (el) openCard({ kind: el === document.documentElement ? "page" : "element", el, point: { x: event.clientX, y: event.clientY } });
    },
    true,
  );
  let selectionTimer;
  document.addEventListener("selectionchange", () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const selection = getSelection();
      const text = selection && !selection.isCollapsed ? selection.toString().trim() : "";
      const node = selection && selection.anchorNode;
      if (!text || card || !node || host.contains(node) || root.contains(node)) {
        selRange = null;
        ui.selBtn.hidden = true;
        return;
      }
      selRange = selection.getRangeAt(0).cloneRange();
      ui.selBtn.hidden = false;
      placeSelButton();
    }, 120);
  });
  ui.selBtn.addEventListener("mousedown", (event) => event.preventDefault());
  ui.selBtn.addEventListener("click", () => {
    const selection = getSelection();
    if (!selection || selection.isCollapsed) return;
    const range = selection.getRangeAt(0).cloneRange();
    const container = range.commonAncestorContainer;
    const el = container.nodeType === 1 ? container : container.parentElement;
    openCard({ kind: "selection", el, quote: squash(selection.toString(), 1000), range });
  });
  addEventListener("scroll", scheduleReposition, { capture: true, passive: true });
  addEventListener("resize", scheduleReposition);

  // ---- panel controls ----
  ui.min.addEventListener("click", () => {
    collapsed = true;
    save("collapsed", true);
    render();
  });
  ui.pill.addEventListener("click", () => {
    collapsed = false;
    save("collapsed", false);
    render();
  });
  ui.clickMode.addEventListener("change", () => {
    clickMode = ui.clickMode.checked;
    save("clickMode", clickMode);
    updateHover();
  });
  ui.pageNote.value = load("pageNote", "");
  ui.pageNote.addEventListener("input", () => {
    save("pageNote", ui.pageNote.value || undefined);
    render();
  });
  ui.send.addEventListener("click", sendNotes);
  ui.add.addEventListener("click", addFromCard);
  ui.cancel.addEventListener("click", closeCard);
  ui.reloadNow.addEventListener("click", reloadPage);
  // Keys typed in the panel never reach the page's own shortcuts.
  for (const type of ["keydown", "keyup", "keypress"]) root.addEventListener(type, (event) => event.stopPropagation());
  ui.cardText.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (addFromCard()) sendNotes();
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      addFromCard();
    } else if (event.key === "Escape" && !ui.cardText.value.trim()) {
      event.preventDefault();
      closeCard();
    }
  });
  ui.pageNote.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendNotes();
    }
  });

  restoreScroll();
  render();
  connect();
})();
