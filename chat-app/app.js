// ===== State =====
let sessions = {};
let activeSessionId = null;
let isStreaming = false;
let abortController = null;

const STORAGE_KEY = 'ollama_chat_sessions';
const ACTIVE_KEY = 'ollama_chat_active';
const MODEL_KEY = 'ollama_chat_model';
const OLLAMA_URL = 'http://localhost:11434/api/chat';

// ===== DOM References =====
const sessionsList = document.getElementById('sessions-list');
const chatArea = document.getElementById('chat-area');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');
const modelSelect = document.getElementById('model-select');
const topbarTitle = document.getElementById('topbar-title');
const exportBtn = document.getElementById('export-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const toast = document.getElementById('toast');

// ===== Init =====
function init() {
  loadFromStorage();
  const savedModel = localStorage.getItem(MODEL_KEY);
  if (savedModel) modelSelect.value = savedModel;

  renderSidebar();

  const savedActive = localStorage.getItem(ACTIVE_KEY);
  if (savedActive && sessions[savedActive]) {
    setActiveSession(savedActive);
  } else {
    showWelcome();
  }

  messageInput.addEventListener('input', autoResize);
  messageInput.addEventListener('keydown', handleInputKey);
  modelSelect.addEventListener('change', () => {
    localStorage.setItem(MODEL_KEY, modelSelect.value);
  });

  marked.setOptions({
    breaks: true,
    gfm: true,
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        try { return hljs.highlight(code, { language: lang }).value; } catch {}
      }
      return hljs.highlightAuto(code).value;
    }
  });

  // Custom renderer for code blocks
  const renderer = new marked.Renderer();
  renderer.code = (code, lang) => {
    const language = lang || 'plaintext';
    let highlighted;
    try {
      if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(code, { language: lang }).value;
      } else {
        highlighted = hljs.highlightAuto(code).value;
      }
    } catch {
      highlighted = escapeHtml(code);
    }
    const id = 'cb-' + Math.random().toString(36).slice(2, 8);
    return `<div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-lang">${escapeHtml(language)}</span>
        <button class="btn-copy" onclick="copyCode('${id}', this)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy
        </button>
      </div>
      <pre><code id="${id}" class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>
    </div>`;
  };
  marked.use({ renderer });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== Storage =====
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    sessions = raw ? JSON.parse(raw) : {};
  } catch { sessions = {}; }
}

function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (e) {
    showToast('Storage full — old sessions may be lost.');
  }
}

// ===== Session Management =====
function createSession() {
  const id = 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  sessions[id] = {
    id,
    name: 'New Chat',
    messages: [],
    model: modelSelect.value,
    createdAt: Date.now(),
  };
  saveToStorage();
  return id;
}

function deleteSession(id) {
  delete sessions[id];
  saveToStorage();
  renderSidebar();
  if (activeSessionId === id) {
    const ids = Object.keys(sessions);
    if (ids.length > 0) {
      setActiveSession(ids[ids.length - 1]);
    } else {
      activeSessionId = null;
      localStorage.removeItem(ACTIVE_KEY);
      showWelcome();
      topbarTitle.textContent = 'Ollama Chat';
    }
  }
}

function setActiveSession(id) {
  activeSessionId = id;
  localStorage.setItem(ACTIVE_KEY, id);
  renderSidebar();
  renderChat();
  const session = sessions[id];
  topbarTitle.textContent = session?.name || 'New Chat';
  if (session?.model) modelSelect.value = session.model;
  closeSidebar();
}

function autoNameSession(id, firstMessage) {
  const trimmed = firstMessage.trim().slice(0, 40);
  sessions[id].name = trimmed || 'New Chat';
  saveToStorage();
  renderSidebar();
  topbarTitle.textContent = sessions[id].name;
}

// ===== Sidebar Rendering =====
function renderSidebar() {
  const ids = Object.keys(sessions).sort((a, b) => sessions[b].createdAt - sessions[a].createdAt);

  if (ids.length === 0) {
    sessionsList.innerHTML = '<div class="sessions-empty">No chats yet</div>';
    return;
  }

  sessionsList.innerHTML = ids.map(id => {
    const s = sessions[id];
    const isActive = id === activeSessionId;
    return `<div class="session-item ${isActive ? 'active' : ''}" onclick="setActiveSession('${id}')">
      <svg class="session-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="session-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
      <button class="session-delete" title="Delete chat" onclick="event.stopPropagation(); deleteSession('${id}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
        </svg>
      </button>
    </div>`;
  }).join('');
}

// ===== Chat Rendering =====
function showWelcome() {
  chatArea.innerHTML = `
    <div class="welcome">
      <div class="welcome-logo">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
          <path d="M8 12h8M12 8v8" stroke-linecap="round"/>
        </svg>
      </div>
      <h1>Ollama Chat</h1>
      <p>Chat with local AI models powered by Ollama. Your conversations are stored locally and never leave your device.</p>
      <div class="welcome-chips">
        <div class="chip" onclick="useChip(this)">Explain quantum computing</div>
        <div class="chip" onclick="useChip(this)">Write a Python script</div>
        <div class="chip" onclick="useChip(this)">اشرح لي الذكاء الاصطناعي</div>
        <div class="chip" onclick="useChip(this)">Summarize a concept</div>
        <div class="chip" onclick="useChip(this)">Help me debug code</div>
        <div class="chip" onclick="useChip(this)">ترجم هذا النص</div>
      </div>
    </div>`;
}

function useChip(el) {
  const text = el.textContent;
  // Create new session and send
  const id = createSession();
  setActiveSession(id);
  messageInput.value = text;
  autoResize.call(messageInput);
  sendMessage();
}

function renderChat() {
  const session = sessions[activeSessionId];
  if (!session) return showWelcome();

  if (session.messages.length === 0) {
    chatArea.innerHTML = '<div class="messages"></div>';
    return;
  }

  chatArea.innerHTML = '<div class="messages" id="messages-container"></div>';
  const container = document.getElementById('messages-container');

  session.messages.forEach(msg => {
    container.appendChild(createMessageEl(msg));
  });

  scrollToBottom();
}

function createMessageEl(msg) {
  const div = document.createElement('div');
  div.className = `message ${msg.role}`;

  const isRTL = detectRTL(msg.content);
  const dir = isRTL ? 'rtl' : 'ltr';

  const avatarLabel = msg.role === 'user' ? 'U' : 'AI';

  if (msg.role === 'user') {
    div.innerHTML = `
      <div class="msg-avatar">${avatarLabel}</div>
      <div class="msg-content">
        <div class="msg-bubble" dir="${dir}">${escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>
      </div>`;
  } else {
    div.innerHTML = `
      <div class="msg-avatar">${avatarLabel}</div>
      <div class="msg-content">
        <div class="msg-bubble" dir="${dir}">${renderMarkdown(msg.content)}</div>
      </div>`;
  }

  return div;
}

function renderMarkdown(text) {
  try {
    return marked.parse(text || '');
  } catch {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
}

function detectRTL(text) {
  const rtlChars = /[؀-ۿݐ-ݿ֐-׿ࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Check first significant character
  for (const ch of trimmed) {
    if (rtlChars.test(ch)) return true;
    if (/[a-zA-Z]/.test(ch)) return false;
  }
  return false;
}

// ===== Messaging =====
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isStreaming) return;

  // Send button pop animation
  sendBtn.classList.add('sending');
  sendBtn.addEventListener('animationend', () => sendBtn.classList.remove('sending'), { once: true });

  // Create session if needed
  if (!activeSessionId || !sessions[activeSessionId]) {
    const id = createSession();
    setActiveSession(id);
  }

  const session = sessions[activeSessionId];

  // Auto-name session on first message
  if (session.messages.length === 0) {
    autoNameSession(activeSessionId, text);
  }

  // Add user message
  session.messages.push({ role: 'user', content: text });
  session.model = modelSelect.value;
  saveToStorage();

  messageInput.value = '';
  autoResize();

  // Render user message
  let container = document.getElementById('messages-container');
  if (!container) {
    chatArea.innerHTML = '<div class="messages" id="messages-container"></div>';
    container = document.getElementById('messages-container');
  }

  const userMsg = session.messages[session.messages.length - 1];
  container.appendChild(createMessageEl(userMsg));
  scrollToBottom();

  // Add typing indicator
  const typingEl = document.createElement('div');
  typingEl.className = 'message assistant';
  typingEl.id = 'typing-indicator';
  typingEl.innerHTML = `
    <div class="msg-avatar">AI</div>
    <div class="msg-content">
      <div class="typing-indicator">
        <div class="typing-dots"><span></span><span></span><span></span></div>
        Thinking…
      </div>
    </div>`;
  container.appendChild(typingEl);
  scrollToBottom();

  setStreaming(true);

  // Prepare assistant message placeholder
  let assistantContent = '';

  try {
    abortController = new AbortController();
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelSelect.value,
        messages: session.messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Remove typing indicator, add assistant bubble
    typingEl.remove();
    const assistantMsgEl = document.createElement('div');
    assistantMsgEl.className = 'message assistant';
    assistantMsgEl.innerHTML = `
      <div class="msg-avatar">AI</div>
      <div class="msg-content">
        <div class="msg-bubble" id="streaming-bubble"></div>
      </div>`;
    container.appendChild(assistantMsgEl);

    const bubble = document.getElementById('streaming-bubble');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            assistantContent += data.message.content;
            bubble.innerHTML = renderMarkdown(assistantContent);
            bubble.dir = detectRTL(assistantContent) ? 'rtl' : 'ltr';
            scrollToBottom();
          }
          if (data.done) break;
        } catch {}
      }
    }

  } catch (err) {
    typingEl.remove();
    if (err.name === 'AbortError') {
      // Stopped by user — keep partial content
    } else {
      const errEl = document.createElement('div');
      errEl.className = 'message assistant';
      errEl.innerHTML = `
        <div class="msg-avatar">AI</div>
        <div class="msg-content">
          <div class="msg-bubble" style="color: var(--danger);">
            <strong>Error:</strong> ${escapeHtml(err.message)}<br><br>
            Make sure Ollama is running: <code>ollama serve</code>
          </div>
        </div>`;
      container.appendChild(errEl);
      scrollToBottom();
    }
  }

  // Save assistant response
  if (assistantContent) {
    session.messages.push({ role: 'assistant', content: assistantContent });
    saveToStorage();
  }

  setStreaming(false);
  messageInput.focus();
}

function stopStreaming() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
}

function setStreaming(state) {
  isStreaming = state;
  sendBtn.style.display = state ? 'none' : 'flex';
  stopBtn.style.display = state ? 'flex' : 'none';
  messageInput.disabled = state;
  if (!state) messageInput.focus();
}

// ===== Input Helpers =====
function autoResize() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 180) + 'px';
}

function handleInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function scrollToBottom() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

// ===== Export =====
function exportConversation() {
  const session = sessions[activeSessionId];
  if (!session || session.messages.length === 0) {
    showToast('No messages to export.');
    return;
  }

  const lines = [
    `Chat: ${session.name}`,
    `Model: ${session.model}`,
    `Exported: ${new Date().toLocaleString()}`,
    '='.repeat(60),
    '',
  ];

  session.messages.forEach(msg => {
    const role = msg.role === 'user' ? 'You' : 'Assistant';
    lines.push(`[${role}]`);
    lines.push(msg.content);
    lines.push('');
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chat-${session.name.slice(0, 30).replace(/[^a-z0-9؀-ۿ]/gi, '-')}-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== Copy Code =====
function copyCode(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
    }, 2000);
  }).catch(() => showToast('Copy failed.'));
}

// ===== Toast =====
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

// ===== Sidebar Toggle (Mobile) =====
function toggleSidebar() {
  sidebar.classList.toggle('open');
  sidebarOverlay.classList.toggle('show');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('show');
}

// ===== Event Listeners =====
newChatBtn.addEventListener('click', () => {
  const id = createSession();
  setActiveSession(id);
  showWelcome();
  chatArea.innerHTML = '<div class="messages" id="messages-container"></div>';
  topbarTitle.textContent = 'New Chat';
  messageInput.focus();
  closeSidebar();
});

sendBtn.addEventListener('click', sendMessage);
stopBtn.addEventListener('click', stopStreaming);
exportBtn.addEventListener('click', exportConversation);
sidebarToggle.addEventListener('click', toggleSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

// ===== Start =====
init();
