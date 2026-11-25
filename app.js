(() => {
  "use strict";

  const STORAGE_KEY = "ai-chat.messages.v1";
  const MAX_STORED = 200;
  const SLOW_AFTER_MS = 12000;   // show "taking longer" notice
  const TIMEOUT_MS = 90000;      // give up after this long with no finish

  const $ = (id) => document.getElementById(id);
  const chatEl = $("chat");
  const emptyEl = $("empty");
  const statusEl = $("status");
  const formEl = $("composer");
  const inputEl = $("input");
  const sendBtn = $("send");

  const SEND_ICON = sendBtn.innerHTML;
  const STOP_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

  /** @type {{id:string, role:'user'|'assistant', content:string, error?:string}[]} */
  let messages = load();
  let busy = false;
  let controller = null;
  let userStopped = false;
  let timedOut = false;

  /* ---------------- storage ---------------- */
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(data) ? data.filter((m) => m && m.content !== undefined) : [];
    } catch {
      return [];
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED)));
    } catch { /* storage full or blocked: chat still works, just won't persist */ }
  }

  /* ---------------- tiny markdown renderer ---------------- */
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function inline(s) {
    return esc(s)
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  }
  function renderBlocks(text) {
    const lines = text.split("\n");
    let html = "", para = [], list = null; // list = {type, items}
    const flushPara = () => { if (para.length) { html += "<p>" + para.map(inline).join("<br>") + "</p>"; para = []; } };
    const flushList = () => { if (list) { html += `<${list.type}>` + list.items.map((i) => `<li>${inline(i)}</li>`).join("") + `</${list.type}>`; list = null; } };
    for (const line of lines) {
      const ul = line.match(/^\s*[-*•]\s+(.*)/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
      const h = line.match(/^#{1,6}\s+(.*)/);
      if (ul || ol) {
        flushPara();
        const type = ul ? "ul" : "ol";
        if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
        list.items.push((ul || ol)[1]);
      } else if (h) {
        flushPara(); flushList();
        html += `<p><strong>${inline(h[1])}</strong></p>`;
      } else if (line.trim() === "") {
        flushPara(); flushList();
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara(); flushList();
    return html;
  }
  function renderMarkdown(text) {
    // split on fenced code blocks; an unclosed fence (mid-stream) is treated as code too
    const parts = text.split("```");
    let out = "";
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        const nl = part.indexOf("\n");
        const code = nl === -1 ? part : part.slice(nl + 1);
        out += `<pre><code>${esc(code.replace(/\n$/, ""))}</code></pre>`;
      } else {
        out += renderBlocks(part);
      }
    });
    return out;
  }

  /* ---------------- rendering ---------------- */
  function bubbleHTML(m, waiting) {
    if (m.role === "user") return esc(m.content);
    if (waiting && !m.content) return '<span class="typing" aria-label="AI is typing"><span></span><span></span><span></span></span>';
    return renderMarkdown(m.content);
  }

  function messageNode(m, isLast) {
    const wrap = document.createElement("div");
    wrap.className = `msg ${m.role}`;
    wrap.dataset.id = m.id;

    if (m.content || !m.error) {
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.innerHTML = bubbleHTML(m, busy && isLast);
      wrap.appendChild(bubble);
    }
    if (m.error) {
      const box = document.createElement("div");
      box.className = "error-box";
      box.setAttribute("role", "alert");
      const p = document.createElement("span");
      p.textContent = m.error;
      box.appendChild(p);
      if (isLast && !busy) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "retry";
        b.textContent = "Try again";
        b.addEventListener("click", retry);
        box.appendChild(b);
      }
      wrap.appendChild(box);
    }
    return wrap;
  }

  function render() {
    chatEl.querySelectorAll(".msg").forEach((n) => n.remove());
    emptyEl.hidden = messages.length > 0;
    messages.forEach((m, i) => chatEl.appendChild(messageNode(m, i === messages.length - 1)));
    scrollToBottom();
  }

  function updateLastBubble() {
    const last = messages[messages.length - 1];
    const node = chatEl.querySelector(`.msg[data-id="${last.id}"] .bubble`);
    if (node) node.innerHTML = bubbleHTML(last, busy);
    if (nearBottom()) scrollToBottom();
  }

  function nearBottom() {
    return chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 120;
  }
  function scrollToBottom() {
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function setBusy(b) {
    busy = b;
    sendBtn.classList.toggle("stop", b);
    sendBtn.innerHTML = b ? STOP_ICON : SEND_ICON;
    sendBtn.setAttribute("aria-label", b ? "Stop generating" : "Send");
    sendBtn.disabled = !b && inputEl.value.trim() === "";
  }

  function showStatus(text) {
    statusEl.hidden = !text;
    statusEl.textContent = text || "";
  }

  /* ---------------- sending ---------------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  async function submit(text) {
    messages.push({ id: uid(), role: "user", content: text });
    save();
    await generate();
  }

  async function retry() {
    // drop the failed assistant bubble, then ask again
    const last = messages[messages.length - 1];
    if (last && last.role === "assistant" && last.error) messages.pop();
    await generate();
  }

  async function generate() {
    // history = every finished message (failed attempts are not sent)
    const history = messages
      .filter((m) => !m.error && m.content)
      .map(({ role, content }) => ({ role, content }));

    const bot = { id: uid(), role: "assistant", content: "" };
    messages.push(bot);
    userStopped = false;
    timedOut = false;
    controller = new AbortController();
    setBusy(true);
    render();

    const slowTimer = setTimeout(() => {
      if (!bot.content) showStatus("Still working on it… this is taking longer than usual.");
    }, SLOW_AFTER_MS);
    const hardTimer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);

    let failure = null;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(res.status >= 500
          ? "The server had a problem. Please try again."
          : `The request was rejected (error ${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop();
        for (const ev of events) {
          const line = ev.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let data;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }
          if (data.type === "text") {
            if (!bot.content) showStatus("");
            bot.content += data.text;
            updateLastBubble();
          } else if (data.type === "error") {
            failure = data.message;
          } else if (data.type === "done") {
            finished = true;
          }
        }
      }
      if (!failure && !finished) failure = "The connection dropped before the answer finished.";
    } catch (err) {
      if (timedOut) failure = "The AI is taking too long to respond. Please try again.";
      else if (userStopped) failure = null;
      else if (err && err.name === "TypeError") failure = "Can't reach the server. Check your internet connection and try again.";
      else failure = err.message || "Something went wrong. Please try again.";
    } finally {
      clearTimeout(slowTimer);
      clearTimeout(hardTimer);
      showStatus("");
    }

    if (failure) {
      bot.error = failure;
    } else if (userStopped && !bot.content) {
      messages.pop(); // stopped before anything arrived: remove the empty bubble
    }
    controller = null;
    setBusy(false);
    save();
    render();
    inputEl.focus({ preventScroll: true });
  }

  /* ---------------- events ---------------- */
  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) {
      userStopped = true;
      controller && controller.abort();
      return;
    }
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    autoGrow();
    setBusy(false);
    submit(text);
  });

  inputEl.addEventListener("keydown", (e) => {
    // Enter sends on desktop; Shift+Enter makes a new line. On phones Enter stays a new line.
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !isTouch) {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });

  function autoGrow() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
  }
  inputEl.addEventListener("input", () => {
    autoGrow();
    if (!busy) sendBtn.disabled = inputEl.value.trim() === "";
  });

  $("newChat").addEventListener("click", () => {
    if (busy) { userStopped = true; controller && controller.abort(); }
    if (messages.length && !confirm("Start a new chat? The current conversation will be cleared.")) return;
    messages = [];
    save();
    showStatus("");
    render();
    inputEl.focus();
  });

  document.querySelectorAll(".chip").forEach((chip) =>
    chip.addEventListener("click", () => { if (!busy) submit(chip.textContent.trim()); })
  );

  window.addEventListener("pagehide", save);

  // A refresh mid-answer leaves an empty/partial bubble: mark it so the user can retry.
  let tail = messages[messages.length - 1];
  if (tail && tail.role === "assistant" && !tail.error && !tail.content) {
    messages.pop();
    tail = messages[messages.length - 1];
  }
  if (tail && tail.role === "user") {
    messages.push({ id: uid(), role: "assistant", content: "", error: "This answer didn't finish before the page closed." });
  }

  setBusy(false);
  render();
})();
