// ===== MATRIX ANIMATION =====
(function initMatrix() {
  const canvas = document.getElementById('matrix-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const chars = 'مجيبذكاءاصطناعيبياناتخوارزميةتعلمآلةABCDEF0123456789αβγδ∑∏∫≡∞⊕⊗'.split('');
  let cols, drops;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    cols = Math.floor(canvas.width / 18);
    drops = Array(cols).fill(1);
  }

  resize();
  window.addEventListener('resize', resize);

  function draw() {
    ctx.fillStyle = 'rgba(10, 14, 26, 0.06)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '14px monospace';

    for (let i = 0; i < drops.length; i++) {
      const ch = chars[Math.floor(Math.random() * chars.length)];
      const x = i * 18;
      const y = drops[i] * 18;

      // Leading char is bright
      ctx.fillStyle = drops[i] * 18 < canvas.height * 0.2
        ? '#ffffff'
        : `rgba(0, 212, 170, ${Math.random() * 0.8 + 0.2})`;

      ctx.fillText(ch, x, y);

      if (y > canvas.height && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i]++;
    }
  }

  const matrixInterval = setInterval(draw, 45);
  window._matrixInterval = matrixInterval;
})();

// ===== WELCOME TRANSITION =====
function enterApp() {
  const welcome = document.getElementById('welcome-screen');
  const app = document.getElementById('main-app');

  welcome.classList.add('fade-out');
  clearInterval(window._matrixInterval);

  setTimeout(() => {
    welcome.style.display = 'none';
    app.style.display = 'flex';
    showChatWelcome();
    messageInput.focus();
  }, 600);
}

// ===== STATE =====
let sessions = {};
let activeSessionId = null;
let references = [];   // [{id, name, content}]
let isStreaming = false;
let abortController = null;
let activeTab = 'text';
let pendingFileContent = '';

const STORAGE_KEY = 'mojib_sessions';
const REFS_KEY    = 'mojib_refs';
const ACTIVE_KEY  = 'mojib_active';
const MODEL_KEY   = 'mojib_model';
const OLLAMA_URL  = 'http://localhost:11434/api/chat';

// ===== DOM =====
const sessionsList  = document.getElementById('sessions-list');
const chatArea      = document.getElementById('chat-area');
const messageInput  = document.getElementById('message-input');
const sendBtn       = document.getElementById('send-btn');
const stopBtn       = document.getElementById('stop-btn');
const modelSelect   = document.getElementById('model-select');
const topbarTitle   = document.getElementById('topbar-title');
const refsArea      = document.getElementById('refs-area');
const refEmpty      = document.getElementById('ref-empty');
const refBadge      = document.getElementById('ref-badge');
const refCount      = document.getElementById('ref-count');
const toast         = document.getElementById('toast');
const sidebar       = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');

// ===== INIT =====
function initApp() {
  loadStorage();

  const savedModel = localStorage.getItem(MODEL_KEY);
  if (savedModel) modelSelect.value = savedModel;

  renderSidebar();
  renderRefs();

  const savedActive = localStorage.getItem(ACTIVE_KEY);
  if (savedActive && sessions[savedActive]) {
    setActiveSession(savedActive);
  } else {
    // will show welcome after transition
  }

  messageInput.addEventListener('input', autoResize);
  messageInput.addEventListener('keydown', handleKey);
  modelSelect.addEventListener('change', () => localStorage.setItem(MODEL_KEY, modelSelect.value));

  // Drag & drop on file zone
  const dropZone = document.getElementById('file-drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    });
  }

  // Setup marked
  marked.setOptions({ breaks: true, gfm: true });

  const renderer = new marked.Renderer();
  renderer.code = (code, lang) => {
    const language = lang || 'plaintext';
    let highlighted;
    try {
      highlighted = lang && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang }).value
        : hljs.highlightAuto(code).value;
    } catch { highlighted = escapeHtml(code); }
    const id = 'cb-' + Math.random().toString(36).slice(2, 8);
    return `<div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-lang">${escapeHtml(language)}</span>
        <button class="btn-copy" onclick="copyCode('${id}',this)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg> نسخ
        </button>
      </div>
      <pre><code id="${id}" class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>
    </div>`;
  };
  marked.use({ renderer });

  sendBtn.addEventListener('click', sendMessage);
  stopBtn.addEventListener('click', stopStreaming);
}

// ===== STORAGE =====
function loadStorage() {
  try { sessions   = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { sessions = {}; }
  try { references = JSON.parse(localStorage.getItem(REFS_KEY))    || []; } catch { references = []; }
}

function saveStorage() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch { showToast('التخزين ممتلئ'); }
  try { localStorage.setItem(REFS_KEY,    JSON.stringify(references)); } catch {}
}

// ===== SESSIONS =====
function createSession() {
  const id = 'sess-' + Date.now();
  sessions[id] = { id, name: 'محادثة جديدة', messages: [], model: modelSelect.value, createdAt: Date.now() };
  saveStorage();
  return id;
}

function setActiveSession(id) {
  activeSessionId = id;
  localStorage.setItem(ACTIVE_KEY, id);
  renderSidebar();
  renderChat();
  const s = sessions[id];
  topbarTitle.textContent = s?.name || 'مجيب';
  if (s?.model) modelSelect.value = s.model;
  closeSidebar();
}

function deleteSession(id, e) {
  e && e.stopPropagation();
  delete sessions[id];
  saveStorage();
  renderSidebar();
  if (activeSessionId === id) {
    const ids = Object.keys(sessions);
    ids.length ? setActiveSession(ids[ids.length - 1]) : (() => {
      activeSessionId = null;
      localStorage.removeItem(ACTIVE_KEY);
      topbarTitle.textContent = 'مجيب';
      showChatWelcome();
    })();
  }
}

function newChat() {
  const id = createSession();
  setActiveSession(id);
  showChatWelcome();
  messageInput.focus();
  closeSidebar();
}

function autoNameSession(id, text) {
  sessions[id].name = text.trim().slice(0, 35) || 'محادثة جديدة';
  saveStorage();
  renderSidebar();
  topbarTitle.textContent = sessions[id].name;
}

// ===== SIDEBAR RENDER =====
function renderSidebar() {
  const ids = Object.keys(sessions).sort((a, b) => sessions[b].createdAt - sessions[a].createdAt);
  if (!ids.length) {
    sessionsList.innerHTML = '<div class="sessions-empty">لا توجد محادثات</div>';
    return;
  }
  sessionsList.innerHTML = ids.map(id => {
    const s = sessions[id];
    return `<div class="session-item ${id === activeSessionId ? 'active' : ''}" onclick="setActiveSession('${id}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="session-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
      <button class="session-del" title="حذف" onclick="deleteSession('${id}', event)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        </svg>
      </button>
    </div>`;
  }).join('');
}

// ===== REFERENCES =====
function renderRefs() {
  const count = references.length;
  if (!count) {
    refsArea.innerHTML = '<div class="ref-empty">لا توجد مراجع مضافة</div>';
    refBadge.style.display = 'none';
    return;
  }

  refBadge.style.display = 'flex';
  refCount.textContent = count;

  refsArea.innerHTML = references.map((r, i) =>
    `<div class="ref-item" title="${escapeHtml(r.name)}">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <span class="ref-name">${escapeHtml(r.name)}</span>
      <span class="ref-chars">${formatNum(r.content.length)} حرف</span>
      <button class="ref-del" onclick="deleteRef(${i}, event)" title="حذف المرجع">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`
  ).join('');
}

function formatNum(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n;
}

function deleteRef(i, e) {
  e && e.stopPropagation();
  references.splice(i, 1);
  saveStorage();
  renderRefs();
  showToast('تم حذف المرجع');
}

// ===== REF MODAL =====
function openRefModal() {
  document.getElementById('ref-modal').style.display = 'flex';
  document.getElementById('ref-title').value = '';
  document.getElementById('ref-content').value = '';
  document.getElementById('ref-title-file').value = '';
  document.getElementById('file-preview').style.display = 'none';
  pendingFileContent = '';
  switchTab('text', document.querySelector('.tab'));
}

function closeRefModal(e) {
  if (e && e.target !== document.getElementById('ref-modal')) return;
  document.getElementById('ref-modal').style.display = 'none';
}

function switchTab(tab, btn) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-text').style.display = tab === 'text' ? 'flex' : 'none';
  document.getElementById('tab-file').style.display = tab === 'file' ? 'block' : 'none';
  if (tab === 'text') document.getElementById('tab-text').style.flexDirection = 'column';
  if (tab === 'text') document.getElementById('tab-text').style.gap = '10px';
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
}

function processFile(file) {
  if (file.size > 2 * 1024 * 1024) {
    showToast('الملف كبير جداً (الحد 2 ميجابايت)');
    return;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    pendingFileContent = ev.target.result;
    const preview = document.getElementById('file-preview');
    preview.style.display = 'block';
    preview.innerHTML = `
      <strong>📄 ${escapeHtml(file.name)}</strong><br>
      <span style="color:var(--text3)">${formatNum(pendingFileContent.length)} حرف · ${(file.size/1024).toFixed(1)} KB</span><br><br>
      <em style="opacity:0.6">${escapeHtml(pendingFileContent.slice(0, 200))}${pendingFileContent.length > 200 ? '…' : ''}</em>
    `;
    if (!document.getElementById('ref-title-file').value) {
      document.getElementById('ref-title-file').value = file.name.replace(/\.[^.]+$/, '');
    }
  };
  reader.readAsText(file, 'utf-8');
}

function addReference() {
  if (activeTab === 'text') {
    const name    = document.getElementById('ref-title').value.trim();
    const content = document.getElementById('ref-content').value.trim();
    if (!content) { showToast('أدخل محتوى المرجع'); return; }
    references.push({ id: Date.now(), name: name || 'مرجع ' + (references.length + 1), content });
  } else {
    const name = document.getElementById('ref-title-file').value.trim();
    if (!pendingFileContent) { showToast('اختر ملفاً أولاً'); return; }
    references.push({ id: Date.now(), name: name || 'ملف ' + (references.length + 1), content: pendingFileContent });
  }

  saveStorage();
  renderRefs();
  document.getElementById('ref-modal').style.display = 'none';
  showToast('تم إضافة المرجع بنجاح ✓');
}

// ===== CHAT RENDER =====
function showChatWelcome() {
  chatArea.innerHTML = `
    <div class="chat-welcome">
      <div class="chat-welcome-icon">م</div>
      <h2>كيف يمكنني مساعدتك؟</h2>
      <p>أنا مجيب، مساعدك الذكي المحلي. اطرح عليّ أي سؤال، أو أضف مرجعاً لأجيب بناءً عليه.</p>
      <div class="suggestion-chips">
        <div class="chip" onclick="useChip(this)">اشرح لي مفهوم الذكاء الاصطناعي</div>
        <div class="chip" onclick="useChip(this)">ما هي خوارزميات الفرز؟</div>
        <div class="chip" onclick="useChip(this)">اكتب لي كود Python بسيط</div>
        <div class="chip" onclick="useChip(this)">لخّص لي هذا المرجع</div>
        <div class="chip" onclick="useChip(this)">ما أهمية التعلم الآلي؟</div>
        <div class="chip" onclick="useChip(this)">ساعدني في حل مسألة رياضية</div>
      </div>
    </div>`;
}

function useChip(el) {
  messageInput.value = el.textContent;
  autoResize.call(messageInput);
  sendMessage();
}

function renderChat() {
  const session = sessions[activeSessionId];
  if (!session) return showChatWelcome();
  if (!session.messages.length) { showChatWelcome(); return; }

  chatArea.innerHTML = '<div class="messages" id="msgs"></div>';
  const container = document.getElementById('msgs');
  session.messages.forEach(m => container.appendChild(createMsgEl(m)));
  scrollBottom();
}

function createMsgEl(msg) {
  const div = document.createElement('div');
  div.className = `message ${msg.role}`;

  const dir = detectRTL(msg.content) ? 'rtl' : 'ltr';
  const label = msg.role === 'user' ? 'أنت' : 'م';

  div.innerHTML = msg.role === 'user'
    ? `<div class="msg-avatar">${label}</div>
       <div class="msg-content">
         <div class="msg-bubble" dir="${dir}">${escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>
       </div>`
    : `<div class="msg-avatar">${label}</div>
       <div class="msg-content">
         <div class="msg-bubble" dir="${dir}">${renderMd(msg.content)}</div>
       </div>`;
  return div;
}

function renderMd(text) {
  try { return marked.parse(text || ''); } catch { return escapeHtml(text).replace(/\n/g, '<br>'); }
}

// ===== SEND MESSAGE =====
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isStreaming) return;

  if (!activeSessionId || !sessions[activeSessionId]) {
    const id = createSession();
    setActiveSession(id);
  }

  const session = sessions[activeSessionId];
  if (!session.messages.length) autoNameSession(activeSessionId, text);

  session.messages.push({ role: 'user', content: text });
  session.model = modelSelect.value;
  saveStorage();

  messageInput.value = '';
  autoResize.call(messageInput);

  // Ensure container
  let container = document.getElementById('msgs');
  if (!container) {
    chatArea.innerHTML = '<div class="messages" id="msgs"></div>';
    container = document.getElementById('msgs');
  }

  container.appendChild(createMsgEl({ role: 'user', content: text }));

  // Show context bar if refs active
  if (references.length) {
    const bar = document.createElement('div');
    bar.className = 'context-bar';
    bar.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      يُجيب استناداً إلى ${references.length} مرجع`;
    container.appendChild(bar);
  }

  // Typing indicator
  const typingEl = document.createElement('div');
  typingEl.className = 'message assistant';
  typingEl.id = 'typing';
  typingEl.innerHTML = `
    <div class="msg-avatar">م</div>
    <div class="msg-content">
      <div class="typing-indicator">
        <div class="typing-dots"><span></span><span></span><span></span></div>
        يفكّر…
      </div>
    </div>`;
  container.appendChild(typingEl);
  scrollBottom();

  setStreaming(true);

  let assistantContent = '';

  try {
    abortController = new AbortController();

    // Build messages with optional reference context
    const systemMsg = buildSystemPrompt();
    const apiMessages = [];
    if (systemMsg) apiMessages.push({ role: 'system', content: systemMsg });
    apiMessages.push(...session.messages.map(m => ({ role: m.role, content: m.content })));

    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelSelect.value, messages: apiMessages, stream: true }),
      signal: abortController.signal,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    typingEl.remove();
    const assistantEl = document.createElement('div');
    assistantEl.className = 'message assistant';
    assistantEl.innerHTML = `
      <div class="msg-avatar">م</div>
      <div class="msg-content">
        <div class="msg-bubble" id="stream-bubble"></div>
      </div>`;
    container.appendChild(assistantEl);

    const bubble = document.getElementById('stream-bubble');
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n').filter(l => l.trim())) {
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            assistantContent += data.message.content;
            bubble.innerHTML = renderMd(assistantContent);
            bubble.dir = detectRTL(assistantContent) ? 'rtl' : 'ltr';
            scrollBottom();
          }
        } catch {}
      }
    }

  } catch (err) {
    typingEl.remove();
    if (err.name !== 'AbortError') {
      const errEl = document.createElement('div');
      errEl.className = 'message assistant';
      errEl.innerHTML = `
        <div class="msg-avatar">م</div>
        <div class="msg-content">
          <div class="msg-bubble" style="color:var(--danger)">
            <strong>خطأ:</strong> ${escapeHtml(err.message)}<br><br>
            تأكد من تشغيل Ollama: <code>ollama serve</code>
          </div>
        </div>`;
      container.appendChild(errEl);
      scrollBottom();
    }
  }

  if (assistantContent) {
    session.messages.push({ role: 'assistant', content: assistantContent });
    saveStorage();
  }

  setStreaming(false);
  messageInput.focus();
}

function buildSystemPrompt() {
  if (!references.length) return '';

  const refTexts = references.map((r, i) =>
    `=== مرجع ${i + 1}: ${r.name} ===\n${r.content}`
  ).join('\n\n');

  return `أنت مساعد ذكي يُدعى "مجيب". أجب على أسئلة المستخدم بالاستناد إلى المراجع التالية:\n\n${refTexts}\n\nإذا لم يكن الجواب في المراجع، أخبر المستخدم بذلك بوضوح. أجب باللغة العربية ما لم يطلب المستخدم غير ذلك.`;
}

function stopStreaming() {
  abortController?.abort();
  abortController = null;
}

function setStreaming(state) {
  isStreaming = state;
  sendBtn.style.display = state ? 'none' : 'flex';
  stopBtn.style.display = state ? 'flex' : 'none';
  messageInput.disabled = state;
  if (!state) messageInput.focus();
}

// ===== EXPORT =====
function exportChat() {
  const session = sessions[activeSessionId];
  if (!session?.messages.length) { showToast('لا توجد رسائل للتصدير'); return; }

  const lines = [
    `المحادثة: ${session.name}`,
    `النموذج: ${session.model}`,
    `التاريخ: ${new Date().toLocaleString('ar')}`,
    '='.repeat(50), '',
    ...session.messages.flatMap(m => [
      `[${m.role === 'user' ? 'أنت' : 'مجيب'}]`,
      m.content, '',
    ]),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `mojib-${Date.now()}.txt` });
  a.click();
  URL.revokeObjectURL(url);
  showToast('تم تصدير المحادثة');
}

// ===== HELPERS =====
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function detectRTL(text) {
  const rtl = /[؀-ۿ]/;
  for (const ch of (text || '').trim()) {
    if (rtl.test(ch)) return true;
    if (/[a-zA-Z]/.test(ch)) return false;
  }
  return false;
}

function autoResize() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 180) + 'px';
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function scrollBottom() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function copyCode(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> تم النسخ`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> نسخ`;
    }, 2000);
  }).catch(() => showToast('فشل النسخ'));
}

// ===== SIDEBAR TOGGLE =====
function toggleSidebar() {
  sidebar.classList.toggle('open');
  sidebarOverlay.classList.toggle('show');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('show');
}

// ===== BOOT =====
// initApp runs after the main-app is shown (triggered by enterApp)
// but we call it now so DOM refs are ready even if app isn't visible
initApp();
