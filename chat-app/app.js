// ─── KnowledgeChat — Main Application ────────────────────────────────────────

// ── State ─────────────────────────────────────────────────────────────────────
const STATE = {
  sessions: [],
  currentSessionId: null,
  references: [],
  settings: {
    ollamaUrl: 'http://localhost:11434',
    model: 'llama3.2',
    topK: 4
  },
  isGenerating: false,
  abortController: null
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fileTypeIcon(ext) {
  const m = { pdf: '📄', docx: '📝', doc: '📝', xlsx: '📊', xls: '📊', csv: '📊', pptx: '📑', ppt: '📑', txt: '📃', md: '📃' };
  return m[ext] || '📎';
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  toast.innerHTML = '<span>' + (icons[type] || '') + '</span><span>' + msg + '</span>';
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Persistence ───────────────────────────────────────────────────────────────
function saveState() {
  try {
    localStorage.setItem('kc_sessions', JSON.stringify(STATE.sessions));
    localStorage.setItem('kc_settings', JSON.stringify(STATE.settings));
    localStorage.setItem('kc_currentSession', STATE.currentSessionId || '');
    const refsMeta = STATE.references.map(r => ({
      id: r.id, name: r.name, type: r.type, size: r.size,
      enabled: r.enabled, addedAt: r.addedAt, chunks: r.chunks,
      imageCount: (r.images || []).length
    }));
    localStorage.setItem('kc_refs_meta', JSON.stringify(refsMeta));
  } catch (e) { console.warn('Save failed:', e); }
}

function loadState() {
  try {
    const sessions = JSON.parse(localStorage.getItem('kc_sessions') || '[]');
    const settings = JSON.parse(localStorage.getItem('kc_settings') || '{}');
    const currentId = localStorage.getItem('kc_currentSession') || null;
    const refsMeta = JSON.parse(localStorage.getItem('kc_refs_meta') || '[]');
    STATE.sessions = sessions;
    STATE.settings = Object.assign(STATE.settings, settings);
    STATE.currentSessionId = currentId && sessions.find(s => s.id === currentId) ? currentId : null;
    STATE.references = refsMeta.map(r => Object.assign({ images: [] }, r));
  } catch (e) { console.warn('Load failed:', e); }
}

// ── Sessions ──────────────────────────────────────────────────────────────────
function createSession(title) {
  title = title || 'محادثة جديدة';
  const session = { id: uid(), title: title, messages: [], createdAt: Date.now() };
  STATE.sessions.unshift(session);
  STATE.currentSessionId = session.id;
  saveState();
  renderSessions();
  renderChat();
  return session;
}

function currentSession() {
  return STATE.sessions.find(s => s.id === STATE.currentSessionId) || null;
}

function deleteSession(id) {
  STATE.sessions = STATE.sessions.filter(s => s.id !== id);
  if (STATE.currentSessionId === id) {
    STATE.currentSessionId = STATE.sessions[0] ? STATE.sessions[0].id : null;
  }
  saveState();
  renderSessions();
  renderChat();
}

function addMessage(sessionId, role, content, extras) {
  extras = extras || {};
  const session = STATE.sessions.find(s => s.id === sessionId);
  if (!session) return null;
  const msg = Object.assign({ id: uid(), role: role, content: content, timestamp: Date.now() }, extras);
  session.messages.push(msg);
  if (role === 'user' && session.messages.filter(m => m.role === 'user').length === 1) {
    session.title = content.slice(0, 45) + (content.length > 45 ? '...' : '');
    renderSessions();
  }
  saveState();
  return msg;
}

// ── Ollama ────────────────────────────────────────────────────────────────────
function checkOllama() {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  fetch(STATE.settings.ollamaUrl + '/api/tags', { signal: AbortSignal.timeout(3000) })
    .then(function(res) {
      if (res.ok) {
        dot.className = 'status-dot online';
        text.textContent = 'متصل';
      } else { throw new Error(); }
    })
    .catch(function() {
      dot.className = 'status-dot offline';
      text.textContent = 'غير متصل';
    });
}

function fetchAvailableModels() {
  return fetch(STATE.settings.ollamaUrl + '/api/tags', { signal: AbortSignal.timeout(5000) })
    .then(function(res) { return res.ok ? res.json() : { models: [] }; })
    .then(function(data) { return (data.models || []).map(function(m) { return m.name; }); })
    .catch(function() { return []; });
}

async function* streamOllama(prompt, signal) {
  const res = await fetch(STATE.settings.ollamaUrl + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: STATE.settings.model, prompt: prompt, stream: true }),
    signal: signal
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Ollama ' + res.status + ': ' + err);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.response) yield obj.response;
        if (obj.done) return;
      } catch (e) {}
    }
  }
}

// ── RAG ───────────────────────────────────────────────────────────────────────
function buildRAGPrompt(query, chunks, images) {
  if (!chunks || chunks.length === 0) {
    return 'أنت مساعد ذكي ومفيد. أجب على السؤال التالي:\n\n' + query;
  }
  const context = chunks.map(function(c, i) {
    return '[مرجع ' + (i+1) + ': ' + c.sourceName + (c.page ? ' — صفحة ' + c.page : '') + ']\n' + c.text;
  }).join('\n\n');
  const imageNote = (images && images.length > 0) ? '\n\nملاحظة: يوجد ' + images.length + ' صورة مرفقة من المراجع.' : '';
  return 'أنت مساعد ذكي. أجب على سؤال المستخدم بناءً على المراجع المقدمة فقط. إذا لم تجد الإجابة في المراجع، قل ذلك بوضوح.\n\n=== المراجع المتاحة ===\n' + context + imageNote + '\n\n=== سؤال المستخدم ===\n' + query + '\n\nأجب بشكل واضح ومنظم. اذكر رقم المرجع عند الاقتباس منه.';
}

// ── Send Message ──────────────────────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text || STATE.isGenerating) return;
  if (!STATE.currentSessionId) createSession();
  const sessionId = STATE.currentSessionId;
  input.value = '';
  input.style.height = 'auto';
  document.getElementById('chat-welcome') && document.getElementById('chat-welcome').remove();

  const userMsg = addMessage(sessionId, 'user', text);
  renderMessage(userMsg);
  scrollToBottom();

  const enabledRefs = STATE.references.filter(r => r.enabled);
  const chunks = enabledRefs.length > 0 ? Processor.getRelevantChunks(text, enabledRefs, STATE.settings.topK) : [];
  const images = chunks.length > 0 ? Processor.getRelevantImages(text, enabledRefs, 3) : [];

  const typingEl = showTyping();
  scrollToBottom();
  const prompt = buildRAGPrompt(text, chunks, images);

  STATE.isGenerating = true;
  STATE.abortController = new AbortController();
  document.getElementById('send-btn').classList.add('hidden');
  document.getElementById('stop-btn').classList.remove('hidden');

  let fullResponse = '';
  const assistantMsg = addMessage(sessionId, 'assistant', '', {
    sources: chunks.map(c => ({ name: c.sourceName, page: c.page })),
    images: images.map(img => ({ dataUrl: img.dataUrl, label: img.label || '', sourceName: img.sourceName }))
  });
  typingEl.remove();
  renderMessage(assistantMsg);
  const bubbleEl = document.querySelector('[data-msg-id="' + assistantMsg.id + '"] .msg-bubble');
  scrollToBottom();

  try {
    for await (const token of streamOllama(prompt, STATE.abortController.signal)) {
      fullResponse += token;
      if (bubbleEl) {
        bubbleEl.innerHTML = renderMarkdown(fullResponse) + '<span style="opacity:0.5">▋</span>';
        scrollToBottom();
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      fullResponse = fullResponse || ('❌ خطأ في الاتصال بـ Ollama:\n' + e.message + '\n\nتأكد من تشغيل Ollama على جهازك.');
    } else {
      fullResponse = fullResponse || '⏹ تم إيقاف الإنشاء.';
    }
  }

  assistantMsg.content = fullResponse;
  if (bubbleEl) {
    bubbleEl.innerHTML = renderMarkdown(fullResponse);
    bubbleEl.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  }
  saveState();
  STATE.isGenerating = false;
  STATE.abortController = null;
  document.getElementById('send-btn').classList.remove('hidden');
  document.getElementById('stop-btn').classList.add('hidden');
  scrollToBottom();
}

function showTyping() {
  const chatArea = document.getElementById('chat-area');
  const el = document.createElement('div');
  el.className = 'message assistant';
  el.id = 'typing-indicator';
  el.innerHTML = '<div class="msg-avatar">⚡</div><div class="msg-body"><div class="msg-bubble"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div></div>';
  chatArea.appendChild(el);
  return el;
}

function scrollToBottom() {
  const area = document.getElementById('chat-area');
  area.scrollTop = area.scrollHeight;
}

function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
    return marked.parse(text);
  }
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

// ── Render Message ────────────────────────────────────────────────────────────
function renderMessage(msg) {
  const chatArea = document.getElementById('chat-area');
  const div = document.createElement('div');
  div.className = 'message ' + msg.role;
  div.setAttribute('data-msg-id', msg.id);

  const avatar = msg.role === 'user' ? '👤' : '⚡';
  const bubbleContent = msg.content ? renderMarkdown(msg.content) : '';

  let sourcesHtml = '';
  if (msg.sources && msg.sources.length > 0) {
    sourcesHtml = '<div class="msg-sources">' +
      msg.sources.map(s => '<span class="source-badge">📄 ' + s.name + (s.page ? ' ص' + s.page : '') + '</span>').join('') +
      '</div>';
  }

  let imagesHtml = '';
  if (msg.images && msg.images.length > 0) {
    imagesHtml = '<div class="msg-images">' +
      msg.images.map(img => '<img class="msg-img-thumb" src="' + img.dataUrl + '" alt="' + (img.label || '') + '" data-caption="' + (img.label || '') + '" title="انقر للتكبير" />').join('') +
      '</div>';
  }

  const regenBtn = msg.role === 'assistant' ? '<button class="msg-action-btn" onclick="regenMessage(this)">إعادة</button>' : '';

  div.innerHTML = '<div class="msg-avatar">' + avatar + '</div><div class="msg-body"><div class="msg-bubble">' + bubbleContent + '</div>' + sourcesHtml + imagesHtml + '<div class="msg-actions"><button class="msg-action-btn" onclick="copyMessage(this)">نسخ</button>' + regenBtn + '</div></div>';

  chatArea.appendChild(div);
  div.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  div.querySelectorAll('.msg-img-thumb').forEach(img => {
    img.addEventListener('click', function() { openImageModal(this.src, this.dataset.caption); });
  });
}

function copyMessage(btn) {
  const bubble = btn.closest('.msg-body').querySelector('.msg-bubble');
  navigator.clipboard.writeText(bubble.innerText).then(function() { showToast('تم النسخ', 'success', 2000); });
}

function regenMessage(btn) {
  const session = currentSession();
  if (!session || STATE.isGenerating) return;
  const lastUser = [...session.messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return;
  const lastAsst = [...session.messages].reverse().find(m => m.role === 'assistant');
  if (lastAsst) {
    session.messages = session.messages.filter(m => m.id !== lastAsst.id);
    const el = document.querySelector('[data-msg-id="' + lastAsst.id + '"]');
    if (el) el.remove();
  }
  document.getElementById('message-input').value = lastUser.content;
  sendMessage();
}

// ── Render UI ─────────────────────────────────────────────────────────────────
function renderSessions() {
  const list = document.getElementById('sessions-list');
  if (STATE.sessions.length === 0) {
    list.innerHTML = '<div style="padding:12px 16px;font-size:0.8rem;color:var(--text-3)">لا توجد محادثات</div>';
    return;
  }
  list.innerHTML = STATE.sessions.map(s =>
    '<div class="session-item ' + (s.id === STATE.currentSessionId ? 'active' : '') + '" onclick="switchSession(\'' + s.id + '\')">' +
    '<span class="session-item-title">' + s.title + '</span>' +
    '<button class="session-item-del" onclick="event.stopPropagation();deleteSession(\'' + s.id + '\')" title="حذف">✕</button>' +
    '</div>'
  ).join('');
}

function renderChat() {
  const chatArea = document.getElementById('chat-area');
  chatArea.innerHTML = '';
  const session = currentSession();
  if (!session || session.messages.length === 0) {
    chatArea.innerHTML = '<div class="chat-welcome" id="chat-welcome"><div class="welcome-icon">⚡</div><h2>مرحباً بك في مرجعي</h2><p>أضف مراجعك وابدأ المحادثة. يمكنني الإجابة على أسئلتك بناءً على محتوى ملفاتك.</p><div class="welcome-tips"><div class="tip">📄 أرفع ملفات PDF أو Word أو Excel أو PowerPoint</div><div class="tip">💬 اسألني عن محتوى مراجعك</div><div class="tip">🖼️ سأعرض الصور والمحتوى ذي الصلة</div><div class="tip">🔒 كل شيء يعمل محلياً على جهازك</div></div></div>';
    return;
  }
  session.messages.forEach(msg => renderMessage(msg));
  scrollToBottom();
}

function switchSession(id) {
  STATE.currentSessionId = id;
  saveState();
  renderSessions();
  renderChat();
  if (window.innerWidth <= 768) {
    document.querySelector('.sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
  }
}

// ── References ────────────────────────────────────────────────────────────────
function handleFiles(files) {
  let chain = Promise.resolve();
  files.forEach(function(file) { chain = chain.then(function() { return processAndAddFile(file); }); });
  return chain;
}

function processAndAddFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const supported = ['pdf','docx','doc','xlsx','xls','csv','pptx','ppt','txt','md'];
  if (!supported.includes(ext)) { showToast('نوع الملف غير مدعوم: .' + ext, 'error'); return Promise.resolve(); }
  if (STATE.references.find(r => r.name === file.name)) { showToast('الملف "' + file.name + '" موجود بالفعل', 'warning'); return Promise.resolve(); }

  showProcessing('جاري معالجة "' + file.name + '"...');
  return Processor.processFile(file).then(function(result) {
    const ref = { id: uid(), name: file.name, type: ext, size: file.size, enabled: true, chunks: result.chunks, images: result.images || [], addedAt: Date.now() };
    STATE.references.push(ref);
    saveState();
    renderReferencesSidebar();
    renderReferencesPanel();
    updateRefsBadge();
    showToast('✅ تمت إضافة "' + file.name + '" — ' + result.chunks.length + ' قطعة', 'success');
  }).catch(function(e) {
    showToast('خطأ في معالجة الملف: ' + e.message, 'error');
    console.error(e);
  }).finally(function() { hideProcessing(); });
}

function showProcessing(msg) {
  let overlay = document.getElementById('processing-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'processing-overlay';
    overlay.className = 'processing-overlay';
    overlay.innerHTML = '<div class="processing-spinner"></div><p class="processing-text" id="proc-text"></p>';
    document.body.appendChild(overlay);
  }
  document.getElementById('proc-text').textContent = msg;
  overlay.classList.remove('hidden');
}
function hideProcessing() {
  const o = document.getElementById('processing-overlay');
  if (o) o.classList.add('hidden');
}

function renderReferencesSidebar() {
  const list = document.getElementById('refs-sidebar-list');
  list.innerHTML = STATE.references.map(r =>
    '<div class="ref-sidebar-item ' + (r.enabled ? 'enabled' : '') + '"><div class="ref-sidebar-dot"></div><span class="ref-sidebar-name">' + r.name + '</span></div>'
  ).join('');
}

function renderReferencesPanel() {
  const list = document.getElementById('refs-list');
  if (STATE.references.length === 0) {
    list.innerHTML = '<div class="refs-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".3"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>لا توجد مراجع بعد</p><small>أضف ملفات PDF أو Word أو Excel أو PowerPoint</small></div>';
    return;
  }
  list.innerHTML = STATE.references.map(r =>
    '<div class="ref-card ' + (r.enabled ? 'enabled' : '') + '" id="ref-card-' + r.id + '">' +
    '<div class="ref-card-header">' +
    '<div class="ref-type-icon ' + r.type + '">' + fileTypeIcon(r.type) + '</div>' +
    '<div class="ref-info"><div class="ref-name" title="' + r.name + '">' + r.name + '</div><div class="ref-meta">' + fmtSize(r.size) + ' · ' + fmtDate(r.addedAt) + '</div></div>' +
    '<button class="ref-toggle ' + (r.enabled ? 'on' : '') + '" onclick="toggleRef(\'' + r.id + '\')" title="' + (r.enabled ? 'تعطيل' : 'تفعيل') + '"></button>' +
    '</div>' +
    '<div class="ref-card-footer"><span class="ref-stats">' + r.chunks.length + ' قطعة نصية · ' + (r.images ? r.images.length : 0) + ' صورة</span>' +
    '<div class="ref-actions"><button class="ref-action-btn" onclick="previewRef(\'' + r.id + '\')">معاينة</button><button class="ref-action-btn danger" onclick="deleteRef(\'' + r.id + '\')">حذف</button></div></div>' +
    '</div>'
  ).join('');
}

function updateRefsBadge() {
  const count = STATE.references.filter(r => r.enabled).length;
  const badge = document.getElementById('refs-badge');
  if (count > 0) { badge.textContent = count; badge.style.display = 'flex'; }
  else { badge.style.display = 'none'; }
}

function toggleRef(id) {
  const ref = STATE.references.find(r => r.id === id);
  if (ref) { ref.enabled = !ref.enabled; saveState(); renderReferencesSidebar(); renderReferencesPanel(); updateRefsBadge(); }
}

function deleteRef(id) {
  STATE.references = STATE.references.filter(r => r.id !== id);
  saveState(); renderReferencesSidebar(); renderReferencesPanel(); updateRefsBadge();
  showToast('تم حذف المرجع', 'info', 2000);
}

function previewRef(id) {
  const ref = STATE.references.find(r => r.id === id);
  if (!ref) return;
  document.getElementById('preview-modal-title').textContent = ref.name;
  const allText = ref.chunks.map(function(c, i) {
    return '[القطعة ' + (i+1) + (c.page ? ' — صفحة ' + c.page : '') + ']\n' + c.text;
  }).join('\n\n──────────\n\n');
  document.getElementById('preview-text-tab').innerHTML = '<pre>' + allText.replace(/</g,'&lt;') + '</pre>';
  const imagesEl = document.getElementById('preview-images-tab');
  if (!ref.images || ref.images.length === 0) {
    imagesEl.innerHTML = '<p style="color:var(--text-3);text-align:center;padding:20px">لا توجد صور</p>';
  } else {
    imagesEl.innerHTML = '<div class="preview-images-grid">' + ref.images.map(img =>
      '<div class="preview-img-item" onclick="openImageModal(\'' + img.dataUrl + '\', \'' + (img.label || '') + '\')"><img src="' + img.dataUrl + '" alt="' + (img.label||'') + '" loading="lazy" /><div class="preview-img-caption">' + (img.label || 'صورة') + '</div></div>'
    ).join('') + '</div>';
  }
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'text'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'preview-text-tab'));
  document.getElementById('preview-modal').classList.remove('hidden');
}

function openImageModal(src, caption) {
  document.getElementById('image-modal-img').src = src;
  document.getElementById('image-modal-caption').textContent = caption || '';
  document.getElementById('image-modal').classList.remove('hidden');
}

// ── Export ────────────────────────────────────────────────────────────────────
function exportChat() {
  const session = currentSession();
  if (!session || session.messages.length === 0) { showToast('لا توجد رسائل للتصدير', 'warning'); return; }
  const lines = ['# ' + session.title, '_' + fmtDate(session.createdAt) + '_', ''];
  session.messages.forEach(function(m) {
    lines.push('### ' + (m.role === 'user' ? '👤 المستخدم' : '⚡ المساعد'));
    lines.push(m.content);
    if (m.sources && m.sources.length) { lines.push(''); lines.push('**المراجع:** ' + m.sources.map(s => s.name).join(' · ')); }
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = session.title.replace(/[^\w؀-ۿ]/g, '_') + '.md';
  a.click();
  showToast('تم تصدير المحادثة', 'success');
}

// ── Settings ──────────────────────────────────────────────────────────────────
function openSettings() {
  document.getElementById('ollama-url-input').value = STATE.settings.ollamaUrl;
  document.getElementById('default-model-select').value = STATE.settings.model;
  document.getElementById('topk-input').value = STATE.settings.topK;
  const modelsEl = document.getElementById('available-models');
  modelsEl.textContent = 'جاري الفحص...';
  fetchAvailableModels().then(function(models) {
    if (models.length === 0) modelsEl.innerHTML = '<span style="color:var(--text-3)">لا توجد نماذج أو Ollama غير متصل</span>';
    else modelsEl.innerHTML = models.map(m => '<span class="model-chip">' + m + '</span>').join('');
  });
  document.getElementById('settings-modal').classList.remove('hidden');
}

function saveSettings() {
  STATE.settings.ollamaUrl = document.getElementById('ollama-url-input').value.trim() || 'http://localhost:11434';
  STATE.settings.model = document.getElementById('default-model-select').value;
  STATE.settings.topK = parseInt(document.getElementById('topk-input').value) || 4;
  document.getElementById('model-select').value = STATE.settings.model;
  saveState(); checkOllama();
  document.getElementById('settings-modal').classList.add('hidden');
  showToast('تم حفظ الإعدادات', 'success');
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────
function setupDragDrop() {
  const main = document.querySelector('.main-content');
  const overlay = document.getElementById('drop-zone-overlay');
  main.addEventListener('dragover', function(e) { e.preventDefault(); overlay.classList.add('active'); });
  main.addEventListener('dragleave', function(e) { if (!main.contains(e.relatedTarget)) overlay.classList.remove('active'); });
  main.addEventListener('drop', function(e) {
    e.preventDefault(); overlay.classList.remove('active');
    const files = Array.from(e.dataTransfer.files);
    if (files.length) handleFiles(files);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
function initApp() {
  loadState();

  document.addEventListener('splashComplete', function() {
    const splash = document.getElementById('splash-screen');
    const app = document.getElementById('app');
    splash.classList.add('fade-out');
    setTimeout(function() { splash.style.display = 'none'; app.classList.remove('hidden'); }, 600);
  });

  renderSessions();
  renderReferencesSidebar();
  renderReferencesPanel();
  updateRefsBadge();
  if (STATE.currentSessionId) renderChat();
  checkOllama();
  setInterval(checkOllama, 30000);
  document.getElementById('model-select').value = STATE.settings.model;

  // ── textarea ──
  const ta = document.getElementById('message-input');
  ta.addEventListener('input', function() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
  ta.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

  // ── buttons ──
  document.getElementById('new-chat-btn').addEventListener('click', function() { createSession(); });
  document.getElementById('send-btn').addEventListener('click', sendMessage);
  document.getElementById('stop-btn').addEventListener('click', function() { STATE.abortController && STATE.abortController.abort(); });
  document.getElementById('export-btn').addEventListener('click', exportChat);
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('close-settings').addEventListener('click', function() { document.getElementById('settings-modal').classList.add('hidden'); });
  document.getElementById('settings-modal').addEventListener('click', function(e) { if (e.target === this) this.classList.add('hidden'); });
  document.getElementById('model-select').addEventListener('change', function(e) { STATE.settings.model = e.target.value; saveState(); });

  // ── refs panel ──
  document.getElementById('refs-panel-btn').addEventListener('click', function() { document.getElementById('refs-panel').classList.toggle('hidden'); });
  document.getElementById('close-refs-panel').addEventListener('click', function() { document.getElementById('refs-panel').classList.add('hidden'); });

  // ── file input ──
  const fileInput = document.getElementById('file-input');
  ['add-ref-btn','add-ref-panel-btn','attach-btn'].forEach(function(id) {
    document.getElementById(id).addEventListener('click', function() { fileInput.click(); });
  });
  fileInput.addEventListener('change', function(e) { handleFiles(Array.from(e.target.files)); fileInput.value = ''; });

  // ── image modal ──
  document.getElementById('close-image-modal').addEventListener('click', function() { document.getElementById('image-modal').classList.add('hidden'); });
  document.getElementById('image-modal').addEventListener('click', function(e) { if (e.target === this) this.classList.add('hidden'); });

  // ── preview modal ──
  document.getElementById('close-preview-modal').addEventListener('click', function() { document.getElementById('preview-modal').classList.add('hidden'); });
  document.querySelectorAll('.modal-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('preview-' + tab.dataset.tab + '-tab').classList.add('active');
    });
  });

  // ── sidebar toggle ──
  document.getElementById('sidebar-toggle').addEventListener('click', function() { document.querySelector('.sidebar').classList.toggle('collapsed'); });
  document.getElementById('menu-btn').addEventListener('click', function() {
    document.querySelector('.sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('visible');
  });
  document.getElementById('sidebar-overlay').addEventListener('click', function() {
    document.querySelector('.sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
  });

  setupDragDrop();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
