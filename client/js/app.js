/* Black GPT Chat - frontend */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const state = {
  user: null,
  chats: [],
  currentChat: null,
  messages: [],
  models: [],
  model: null,
  streaming: false,
  abort: null,
  searchTimer: null
};

/* ---------- helpers ---------- */
async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'خطای ناشناخته');
  return data;
}

function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, 2600);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text) {
  if (!text) return '';
  try {
    const html = marked.parse(text);
    return DOMPurify.sanitize(html, {
      ADD_ATTR: ['target'],
      FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed']
    });
  } catch (e) {
    return escapeHtml(text);
  }
}

function enhanceCodeBlocks(container) {
  container.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.code-header')) return;
    const code = pre.querySelector('code');
    if (!code) return;
    const match = (code.className || '').match(/language-(\w+)/);
    const lang = match ? match[1] : 'code';
    const header = document.createElement('div');
    header.className = 'code-header';
    header.innerHTML = `<span>${escapeHtml(lang)}</span><button class="copy-btn" type="button">Copy</button>`;
    header.querySelector('.copy-btn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        header.querySelector('.copy-btn').textContent = 'Copied!';
        setTimeout(() => (header.querySelector('.copy-btn').textContent = 'Copy'), 1500);
      } catch (e) {}
    };
    pre.insertBefore(header, code);
    if (window.hljs && match) {
      try { hljs.highlightElement(code); } catch (e) {}
    }
  });
}

/* ---------- theme ---------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const hl = $('#hljs-theme');
  if (hl) {
    hl.href = theme === 'light' ? '/vendor/github.min.css' : '/vendor/github-dark.min.css';
  }
}

const THEME_TRANSITION_MS = 1000;
let themeTransitioning = false;

// Expands a circle from the exact center of the toggle button on the page
// background. Every detail (text, buttons, icons, surfaces) transitions to the
// next theme over the same duration, so the whole UI changes with the circle.
async function animateThemeChange(button, next) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    applyTheme(next);
    return;
  }

  const rect = button.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = Math.hypot(
    Math.max(cx, window.innerWidth - cx),
    Math.max(cy, window.innerHeight - cy)
  ) + 12;

  const root = document.documentElement;
  const app = document.querySelector('.app') || document.body;
  const main = document.querySelector('.main');

  // Freeze the current background so the circle is the only thing revealing
  // the next theme's background.
  if (main) {
    const bg = getComputedStyle(main);
    app.style.backgroundImage = bg.backgroundImage;
    app.style.backgroundColor = bg.backgroundColor;
  }
  root.classList.add('theme-wiping');

  const ripple = document.createElement('span');
  ripple.className = 'theme-ripple' + (next === 'light' ? ' theme-ripple--light' : '');
  ripple.setAttribute('aria-hidden', 'true');
  ripple.style.width = `${radius * 2}px`;
  ripple.style.height = `${radius * 2}px`;
  ripple.style.left = `${cx - radius}px`;
  ripple.style.top = `${cy - radius}px`;
  app.appendChild(ripple);

  // Switch the theme and let every detail transition to the new colors over the
  // same duration as the circle, so the whole UI changes together with it.
  root.classList.add('theme-detail-fade');
  // Commit starting styles so transitions run from the old theme values.
  void app.offsetWidth;
  applyTheme(next);

  void ripple.offsetWidth;
  requestAnimationFrame(() => ripple.classList.add('theme-ripple--expand'));

  await new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      ripple.remove();
      root.classList.remove('theme-wiping', 'theme-detail-fade');
      app.style.backgroundImage = '';
      app.style.backgroundColor = '';
      resolve();
    };

    ripple.addEventListener('animationend', (event) => {
      if (event.animationName === 'theme-ripple-expand') finish();
    });
    // Safety net in case animationend never fires.
    setTimeout(finish, THEME_TRANSITION_MS + 200);
  });
}

/* ---------- auth ---------- */
async function loadMe() {
  const data = await api('/api/auth/me');
  state.user = data.user;
  state.messageCount = data.user.message_count || 0;
  applyTheme(data.user.theme || 'dark');
  $('#user-name').textContent = data.user.username;
  $('#user-role').textContent = data.user.role === 'admin' ? 'ادمین' : 'کاربر' + (data.user.status === 'limited' ? ' (محدود)' : data.user.status === 'blocked' ? ' (مسدود)' : '');
  $('#user-avatar').textContent = data.user.username[0].toUpperCase();
  if (data.user.role === 'admin') $('#admin-link').style.display = 'flex';
  updateBlockedBanner();
  updateUsageInfo();
}

function updateBlockedBanner() {
  const banner = $('#blocked-banner');
  const input = $('#input');
  const send = $('#send-btn');
  const u = state.user;
  if (u && u.status === 'blocked') {
    banner.textContent = 'این حساب مسدود شده است. امکان ارسال پیام وجود ندارد.';
    banner.classList.remove('hidden');
    input.disabled = true;
    send.disabled = true;
    return true;
  }
  if (u && u.max_messages != null && (state.messageCount || 0) >= u.max_messages) {
    banner.textContent = `سقف پیام شما (${u.max_messages}) پر شده است. امکان ارسال پیام وجود ندارد.`;
    banner.classList.remove('hidden');
    input.disabled = true;
    send.disabled = true;
    return true;
  }
  banner.classList.add('hidden');
  if (!state.streaming) {
    input.disabled = false;
    send.disabled = !input.value.trim();
  }
  return false;
}

function hideLimitedReply(el, msgObj, container) {
  setTimeout(() => {
    if (!el || !el.isConnected) return;
    el.remove();
    const idx = state.messages.indexOf(msgObj);
    if (idx !== -1) state.messages.splice(idx, 1);
    if (container && !state.messages.length) renderMessages();
  }, 5000);
}

/* ---------- chats list ---------- */
async function loadChats(q = '') {
  const url = q ? `/api/chats?q=${encodeURIComponent(q)}` : '/api/chats';
  const data = await api(url);
  state.chats = data.chats;
  renderChatList();
}

function groupLabel(dateStr) {
  const d = new Date(dateStr + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z'));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - thatDay) / 86400000);
  if (diffDays <= 0) return 'امروز';
  if (diffDays === 1) return 'دیروز';
  return 'گفتگوهای قبلی';
}

function renderChatList() {
  const el = $('#chat-list');
  if (!state.chats.length) {
    el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">چتی وجود ندارد</div>';
    return;
  }
  let html = '';
  let lastGroup = '';
  for (const c of state.chats) {
    const g = groupLabel(c.updated_at);
    if (g !== lastGroup) {
      html += `<div class="chat-group-title">${g}</div>`;
      lastGroup = g;
    }
    html += `
      <div class="chat-item ${state.currentChat && state.currentChat.id === c.id ? 'active' : ''}" data-id="${c.id}">
        <span class="title">${escapeHtml(c.title || 'بدون عنوان')}</span>
        ${c.model ? `<span class="model-tag">${escapeHtml(shortModel(c.model))}</span>` : ''}
        <button class="menu-btn" data-menu="${c.id}" title="گزینه‌ها">⋯</button>
      </div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.chat-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.menu-btn')) return;
      openChat(Number(item.dataset.id));
    });
  });
  el.querySelectorAll('.menu-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showContextMenu(e, Number(btn.dataset.menu));
    });
  });
}

function shortModel(m) {
  if (!m) return '';
  const parts = m.split('/');
  const last = parts[parts.length - 1];
  return last.length > 18 ? last.slice(0, 18) + '…' : last;
}

function showContextMenu(e, chatId) {
  document.querySelectorAll('.ctx-menu').forEach((m) => m.remove());
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = `
    <button data-act="rename"><svg class="ctx-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg> تغییر نام</button>
    <button data-act="settings"><svg class="ctx-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> تنظیمات چت</button>
    <button data-act="delete" class="danger"><svg class="ctx-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> حذف</button>
  `;
  document.body.appendChild(menu);
  const x = Math.min(e.clientX, window.innerWidth - 170);
  const y = Math.min(e.clientY, window.innerHeight - 130);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 0);
  menu.querySelector('[data-act="rename"]').onclick = async () => {
    close();
    const chat = state.chats.find((c) => c.id === chatId);
    const name = prompt('عنوان جدید:', chat ? chat.title : '');
    if (name && name.trim()) {
      await api(`/api/chats/${chatId}`, { method: 'PATCH', body: JSON.stringify({ title: name.trim() }) });
      loadChats($('#search-input').value.trim());
      if (state.currentChat && state.currentChat.id === chatId) {
        state.currentChat.title = name.trim();
        $('#chat-title').value = name.trim();
      }
    }
  };
  menu.querySelector('[data-act="settings"]').onclick = () => { close(); openChatSettings(chatId); };
  menu.querySelector('[data-act="delete"]').onclick = async () => {
    close();
    if (!confirm('این چت حذف شود؟')) return;
    await api(`/api/chats/${chatId}`, { method: 'DELETE' });
    if (state.currentChat && state.currentChat.id === chatId) newChat();
    loadChats($('#search-input').value.trim());
    toast('چت حذف شد');
  };
}

/* ---------- models ---------- */
async function loadModels() {
  const el = $('#model-options');
  if (el && !state.models.length) {
    el.innerHTML = '<div class="model-option disabled">در حال بارگذاری...</div>';
  }
  try {
    const data = await api('/api/models');
    state.models = data.models.filter((m) => m.enabled);
    if (!state.model && state.models.length) {
      const preferred = (state.user && state.user.default_model) || (state.currentChat && state.currentChat.model);
      state.model = (preferred && state.models.find((m) => m.id === preferred) && preferred) || state.models[0].id;
    }
    updateModelLabel();
    renderModelMenu();
    $('#lm-dot').classList.toggle('on', data.online);
    $('#lm-text').textContent = data.online ? 'متصل' : 'قطع';
    $('#lm-status').title = data.online ? 'LM Studio: متصل' : 'LM Studio: قطع';
  } catch (e) {
    $('#lm-dot').classList.remove('on');
    $('#lm-text').textContent = 'قطع';
    $('#lm-status').title = 'LM Studio: قطع';
    renderModelMenu(e);
  }
}

function renderModelMenu(err) {
  const el = $('#model-options');
  if (!el) return;
  let html = '';
  if (err) {
    html += '<div class="model-option disabled">خطا در دریافت مدل‌ها</div>';
  } else if (!state.models.length) {
    html += '<div class="model-option disabled">مدلی در دسترس نیست</div>';
  } else {
    html += state.models
      .map(
        (m) => `
    <div class="model-option ${m.id === state.model ? 'selected' : ''}" data-model="${escapeHtml(m.id)}">
      <span>${escapeHtml(m.name)}</span>
      ${m.id === state.model ? '<span>✓</span>' : ''}
    </div>`
      )
      .join('');
  }
  html += `<div class="model-option" data-refresh="1" style="margin-top:4px;border-top:1px solid var(--border-soft);justify-content:center;color:var(--text-secondary)">بروزرسانی فهرست</div>`;
  el.innerHTML = html;
  el.querySelectorAll('.model-option[data-model]').forEach((opt) => {
    opt.addEventListener('click', () => {
      state.model = opt.dataset.model;
      updateModelLabel();
      renderModelMenu();
      $('#model-menu').classList.add('hidden');
      if (state.currentChat) {
        api(`/api/chats/${state.currentChat.id}`, { method: 'PATCH', body: JSON.stringify({ model: state.model }) }).catch(() => {});
      }
    });
  });
  const refresh = el.querySelector('[data-refresh]');
  if (refresh) {
    refresh.addEventListener('click', async (e) => {
      e.stopPropagation();
      el.innerHTML = '<div class="model-option disabled">در حال بارگذاری...</div>';
      await loadModels();
    });
  }
}

function updateModelLabel() {
  const m = state.models.find((x) => x.id === state.model);
  $('#model-label').textContent = m ? shortModel(m.id) : (state.models.length ? 'انتخاب مدل' : 'مدلی یافت نشد');
}

/* ---------- messages ---------- */
function welcomeHtml() {
  return `
    <div class="empty-state">
      <div class="hero-logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9L12 3z"/><path d="M19 15.4l.8 2.3 2.3.8-2.3.8-.8 2.3-.8-2.3-2.3-.8 2.3-.8.8-2.3z"/></svg>
      </div>
      <div class="hero-eyebrow"><span class="eyebrow-dot"></span> Local AI Workspace</div>
      <h2>هوش مصنوعی، با قدرت مدل‌های خودت.</h2>
      <p class="tagline">با مدل‌های محلی خودت گفتگو کن، کدنویسی کن و ایده‌هایت را توسعه بده.</p>
      <div class="hints">
        <button class="hint-chip hint-card" data-hint="برای من یک API با Node.js طراحی کن.">
          <span class="hint-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span>
          <span class="hint-copy">
            <span class="hint-title">طراحی API با Node.js</span>
            <span class="hint-desc">یک API امن و مقیاس‌پذیر برای پروژه‌ات بساز.</span>
          </span>
        </button>
        <button class="hint-chip hint-card" data-hint="یک کد Python را تحلیل و بهینه‌سازی کن.">
          <span class="hint-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg></span>
          <span class="hint-copy">
            <span class="hint-title">بهینه‌سازی کد Python</span>
            <span class="hint-desc">کدت را تحلیل کن و سریع‌تر و تمیزترش کن.</span>
          </span>
        </button>
        <button class="hint-chip hint-card" data-hint="معماری یک پروژه نرم‌افزاری را بررسی کن.">
          <span class="hint-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg></span>
          <span class="hint-copy">
            <span class="hint-title">بررسی معماری پروژه</span>
            <span class="hint-desc">ساختار پروژه را بررسی و بهترین مسیر را پیدا کن.</span>
          </span>
        </button>
        <button class="hint-chip hint-card" data-hint="برای پروژه‌ی من چند ایده‌ی خلاقانه پیشنهاد بده.">
          <span class="hint-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg></span>
          <span class="hint-copy">
            <span class="hint-title">ایده‌پردازی و تولید محتوا</span>
            <span class="hint-desc">از یک ایده‌ی خام تا متن نهایی، همراهت هستم.</span>
          </span>
        </button>
      </div>
    </div>`;
}

const AI_AVATAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M5 16l.75 2.25L8 19l-2.25.75L5 22l-.75-2.25L2 19l2.25-.75L5 16z"/><path d="M18 14l.75 2.25L21 17l-2.25.75L18 20l-.75-2.25L15 17l2.25-.75L18 14z"/></svg>';

const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const SHARE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';

function streamingHtml() {
  return '<span class="streaming-label"><span class="spin"></span> در حال تولید پاسخ...</span>';
}

function renderMessages() {
  const inner = $('#messages-inner');
  if (!state.messages.length) {
    inner.innerHTML = welcomeHtml();
    inner.querySelectorAll('.hint-chip').forEach((b) => {
      b.addEventListener('click', () => {
        $('#input').value = b.dataset.hint;
        autoResize();
        $('#input').focus();
        $('#send-btn').disabled = false;
      });
    });
    return;
  }
  inner.innerHTML = '';
  for (const m of state.messages) inner.appendChild(messageEl(m));
  enhanceCodeBlocks(inner);
  scrollToBottom();
}

function messageEl(m) {
  const div = document.createElement('div');
  div.className = `msg ${m.role === 'user' ? 'user' : 'assistant'}`;
  const isUser = m.role === 'user';
  if (isUser) {
    div.innerHTML = `
      <div class="user-bubble">
        <div class="content" data-role="user">${escapeHtml(m.content)}</div>
      </div>`;
    return div;
  }
  div.innerHTML = `
    <div class="ai-card">
      <div class="ai-header">
        <div class="avatar ai">${AI_AVATAR_SVG}</div>
        <span class="ai-label">دستیار</span>
        ${m.model ? `<span class="model-pill">${escapeHtml(shortModel(m.model))}</span>` : ''}
        <div class="ai-actions">
          <button data-copy title="کپی پاسخ">${COPY_SVG}</button>
          <button data-share title="اشتراک‌گذاری">${SHARE_SVG}</button>
        </div>
      </div>
      <div class="body">
        <div class="content" data-role="assistant">${renderMarkdown(m.content)}</div>
        <div class="msg-actions"><button data-copy-text>کپی پاسخ</button></div>
      </div>
    </div>`;
  const content = div.querySelector('.content');
  enhanceCodeBlocks(content);
  const copyHandler = async (btn) => {
    await navigator.clipboard.writeText(m.content);
    if (btn.hasAttribute('data-copy-text')) {
      btn.textContent = 'کپی شد';
      setTimeout(() => (btn.textContent = 'کپی'), 1500);
    } else {
      toast('کپی شد');
    }
  };
  div.querySelectorAll('[data-copy], [data-copy-text]').forEach((btn) => {
    btn.onclick = () => copyHandler(btn);
  });
  const shareBtn = div.querySelector('[data-share]');
  if (shareBtn) {
    shareBtn.onclick = async () => {
      if (navigator.share) {
        try { await navigator.share({ text: m.content }); } catch (e) {}
      } else {
        await navigator.clipboard.writeText(m.content);
        toast('متن پاسخ کپی شد');
      }
    };
  }
  return div;
}

function scrollToBottom() {
  const el = $('#messages');
  el.scrollTop = el.scrollHeight;
}

function syncTopbarTitle() {
  const brand = $('#topbar-brand');
  const title = $('#chat-title');
  if (!brand || !title) return;
  if (state.currentChat) {
    brand.classList.add('hidden');
    title.classList.remove('hidden');
    title.disabled = false;
    title.value = state.currentChat.title || '';
  } else {
    brand.classList.remove('hidden');
    title.classList.add('hidden');
    title.value = '';
    title.disabled = true;
  }
}

async function openChat(id) {
  if (state.streaming) stopStream();
  const data = await api(`/api/chats/${id}`);
  state.currentChat = data.chat;
  state.messages = data.messages;
  state.model = data.chat.model || state.model;
  updateModelLabel();
  renderModelMenu();
  syncTopbarTitle();
  renderMessages();
  renderChatList();
  closeSidebarMobile();
  updateUsageInfo();
}

function newChat() {
  state.currentChat = null;
  state.messages = [];
  syncTopbarTitle();
  renderMessages();
  renderChatList();
  updateUsageInfo();
}

/* ---------- send / stream ---------- */
function autoResize() {
  const ta = $('#input');
  if (!ta) return;
  ta.style.height = 'auto';
  const max = 160;
  const h = Math.min(ta.scrollHeight, max);
  ta.style.height = h + 'px';
  ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
}

function updateUsageInfo() {
  const u = state.user;
  const el = $('#usage-info');
  if (!u) return;
  if (u.max_messages != null) {
    el.textContent = `پیام: ${state.messageCount ?? 0} / ${u.max_messages}`;
  } else {
    el.textContent = '';
  }
}

async function sendMessage() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text || state.streaming) return;
  if (updateBlockedBanner()) return;
  if (!state.model) {
    toast('ابتدا یک مدل انتخاب کنید (LM Studio روشن باشد)');
    return;
  }

  input.value = '';
  autoResize();

  let aiMsg = null;
  let aiEl = null;
  let contentEl = null;
  let inner = $('#messages-inner');

  try {
    if (!state.currentChat) {
      const data = await api('/api/chats', {
        method: 'POST',
        body: JSON.stringify({ title: text.slice(0, 50), model: state.model })
      });
      state.currentChat = data.chat;
      syncTopbarTitle();
      loadChats();
    } else if (!state.currentChat.model || state.currentChat.model !== state.model) {
      api(`/api/chats/${state.currentChat.id}`, { method: 'PATCH', body: JSON.stringify({ model: state.model }) }).catch(() => {});
      state.currentChat.model = state.model;
    }

    const userMsg = { role: 'user', content: text, model: state.model };
    state.messages.push(userMsg);
    if (state.messages.length === 1) inner.innerHTML = '';
    inner.appendChild(messageEl(userMsg));
    scrollToBottom();

    aiMsg = { role: 'assistant', content: '', model: state.model };
    state.messages.push(aiMsg);
    aiEl = messageEl(aiMsg);
    contentEl = aiEl.querySelector('.content');
    contentEl.innerHTML = streamingHtml();
    const initialActions = aiEl.querySelector('.msg-actions');
    if (initialActions) initialActions.classList.add('hidden');
    inner.appendChild(aiEl);
    scrollToBottom();

    state.streaming = true;
    setSendButton(true);

    const controller = new AbortController();
    state.abort = controller;

    const res = await fetch(`/api/chats/${state.currentChat.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, model: state.model }),
      signal: controller.signal
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'خطا در ارسال');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let errMessage = null;
    let limitedShown = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        const lines = part.split('\n');
        let event = 'message';
        let data = '';
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { continue; }
        if (event === 'delta' && parsed.delta) {
          aiMsg.content += parsed.delta;
          contentEl.classList.add('typing-cursor');
          contentEl.innerHTML = renderMarkdown(aiMsg.content);
          enhanceCodeBlocks(contentEl);
          scrollToBottom();
        } else if (event === 'error') {
          errMessage = parsed.error;
        } else if (event === 'done') {
          aiMsg.messageId = parsed.messageId;
          if (parsed.model) {
            aiMsg.model = parsed.model;
            const pill = aiEl.querySelector('.model-pill');
            if (pill) pill.textContent = shortModel(parsed.model);
          }
          if (parsed.limited) {
            limitedShown = true;
            hideLimitedReply(aiEl, aiMsg, inner);
          }
        }
      }
    }

    if (errMessage) {
      if (!aiMsg.content) {
        state.messages.pop();
        aiEl.remove();
      }
      const errDiv = document.createElement('div');
      errDiv.className = 'error-banner';
      errDiv.textContent = errMessage;
      inner.appendChild(errDiv);
      scrollToBottom();
    } else if (!aiMsg.content) {
      state.messages.pop();
      aiEl.remove();
    } else if (!limitedShown) {
      contentEl.classList.remove('typing-cursor');
      contentEl.innerHTML = renderMarkdown(aiMsg.content);
      enhanceCodeBlocks(contentEl);
      const actions = aiEl.querySelector('.msg-actions');
      if (actions) {
        actions.classList.remove('hidden');
        const copyBtn = actions.querySelector('[data-copy-text]');
        if (copyBtn) {
          copyBtn.onclick = async () => {
            await navigator.clipboard.writeText(aiMsg.content);
            copyBtn.textContent = 'کپی شد';
            setTimeout(() => (copyBtn.textContent = 'کپی'), 1500);
          };
        }
      }
      scrollToBottom();
    } else {
      contentEl.classList.remove('typing-cursor');
      contentEl.innerHTML = renderMarkdown(aiMsg.content);
      scrollToBottom();
    }

    if (!limitedShown) {
      state.messageCount = (state.messageCount || 0) + 1;
      updateUsageInfo();
    }
    loadChats($('#search-input').value.trim());
  } catch (e) {
    if (e.name === 'AbortError') {
      // user pressed stop — keep partial answer, backend also aborts LM Studio
      if (contentEl && aiMsg && aiEl) {
        contentEl.classList.remove('typing-cursor');
        if (aiMsg.content) {
          contentEl.innerHTML = renderMarkdown(aiMsg.content);
          enhanceCodeBlocks(contentEl);
          const actions = aiEl.querySelector('.msg-actions');
          if (actions) {
            actions.classList.remove('hidden');
            const copyBtn = actions.querySelector('[data-copy-text]');
            if (copyBtn) {
              copyBtn.onclick = async () => {
                await navigator.clipboard.writeText(aiMsg.content);
                toast('کپی شد');
              };
            }
          }
        } else {
          state.messages.pop();
          aiEl.remove();
        }
      }
      toast('توقف تولید پاسخ — در LM Studio هم متوقف شد');
      loadChats($('#search-input').value.trim());
    } else {
      const errDiv = document.createElement('div');
      errDiv.className = 'error-banner';
      errDiv.textContent = e.message;
      inner.appendChild(errDiv);
      scrollToBottom();
    }
  } finally {
    state.streaming = false;
    state.abort = null;
    setSendButton(false);
    updateBlockedBanner();
  }
}

function stopStream() {
  if (state.abort) state.abort.abort();
}

function setSendButton(streaming) {
  const btn = $('#send-btn');
  if (streaming) {
    btn.classList.add('stop');
    btn.innerHTML = '<svg class="send-ico" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>';
    btn.disabled = false;
    btn.title = 'توقف تولید';
    btn.setAttribute('aria-label', 'توقف تولید');
  } else {
    btn.classList.remove('stop');
    btn.innerHTML = '<svg class="send-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
    btn.disabled = !$('#input').value.trim();
    btn.title = 'ارسال';
    btn.setAttribute('aria-label', 'ارسال');
  }
}

/* ---------- file upload ---------- */
async function uploadFile(file) {
  if (!state.currentChat) {
    // create chat first so file has a home
    const data = await api('/api/chats', {
      method: 'POST',
      body: JSON.stringify({ title: file.name.slice(0, 50), model: state.model })
    });
    state.currentChat = data.chat;
    syncTopbarTitle();
    loadChats();
  }
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/files/chat/${state.currentChat.id}`, { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'خطا در آپلود');
  const chip = document.createElement('div');
  chip.className = 'file-chip';
  chip.textContent = `📎 ${data.file.filename}`;
  $('.composer').parentNode.insertBefore(chip, $('.composer'));
  toast('فایل آپلود شد');
  return data.file;
}

/* ---------- chat settings modal ---------- */
async function openChatSettings(chatId) {
  const id = chatId || (state.currentChat && state.currentChat.id);
  if (!id) {
    toast('ابتدا یک چت باز کنید');
    return;
  }
  let chat;
  if (state.currentChat && state.currentChat.id === id) {
    chat = state.currentChat;
  } else {
    const data = await api(`/api/chats/${id}`);
    chat = data.chat;
  }
  $('#cs-title').value = chat.title || '';
  $('#cs-system').value = chat.system_prompt || '';
  $('#cs-temp').value = chat.temperature ?? 0.7;
  $('#cs-temp-val').textContent = chat.temperature ?? 0.7;
  $('#cs-top-p').value = chat.top_p ?? 0.95;
  $('#cs-top-p-val').textContent = chat.top_p ?? 0.95;
  $('#cs-max-tokens').value = chat.max_tokens ?? 2048;
  $('#cs-msg').textContent = '';
  $('#chat-settings-modal').classList.remove('hidden');
  $('#cs-save').onclick = async () => {
    try {
      const body = {
        title: $('#cs-title').value,
        system_prompt: $('#cs-system').value,
        temperature: Number($('#cs-temp').value),
        top_p: Number($('#cs-top-p').value),
        max_tokens: Number($('#cs-max-tokens').value)
      };
      const data = await api(`/api/chats/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (state.currentChat && state.currentChat.id === id) {
        state.currentChat = data.chat;
        syncTopbarTitle();
      }
      loadChats($('#search-input').value.trim());
      $('#chat-settings-modal').classList.add('hidden');
      toast('تنظیمات ذخیره شد');
    } catch (e) {
      $('#cs-msg').textContent = e.message;
      $('#cs-msg').style.color = 'var(--danger)';
    }
  };
  $('#cs-cancel').onclick = () => $('#chat-settings-modal').classList.add('hidden');
}

/* ---------- account settings ---------- */
function openSettings() {
  $('#set-username').value = state.user.username;
  $('#set-password').value = '';
  $('#set-current-password').value = '';
  const sel = $('#set-model');
  sel.innerHTML = '<option value="">—</option>' + state.models.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');
  sel.value = state.user.default_model || '';
  $('#settings-msg').textContent = '';
  $('#settings-modal').classList.remove('hidden');

  $('#save-settings').onclick = async () => {
    const msg = $('#settings-msg');
    msg.textContent = '';
    try {
      const patch = {};
      if ($('#set-username').value.trim() !== state.user.username) patch.username = $('#set-username').value.trim();
      if (sel.value !== (state.user.default_model || '')) patch.default_model = sel.value;
      if (Object.keys(patch).length) {
        const data = await api('/api/auth/me', { method: 'PATCH', body: JSON.stringify(patch) });
        state.user = data.user;
        $('#user-name').textContent = data.user.username;
        $('#user-avatar').textContent = data.user.username[0].toUpperCase();
      }
      const pass = $('#set-password').value;
      if (pass) {
        await api('/api/auth/password', {
          method: 'POST',
          body: JSON.stringify({ current: $('#set-current-password').value, next: pass })
        });
      }
      msg.textContent = 'ذخیره شد ✓';
      msg.style.color = 'var(--accent)';
      setTimeout(() => $('#settings-modal').classList.add('hidden'), 700);
    } catch (e) {
      msg.textContent = e.message;
      msg.style.color = 'var(--danger)';
    }
  };
  $('#cancel-settings').onclick = () => $('#settings-modal').classList.add('hidden');
}

/* ---------- sidebar mobile ---------- */
function closeSidebarMobile() {
  if (window.innerWidth <= 768) setSidebarOpen(false);
}

function isSidebarClosed() {
  return $('#sidebar').classList.contains('closed');
}

function setSidebarOpen(open) {
  const sb = $('#sidebar');
  sb.classList.toggle('closed', !open);
  sb.classList.toggle('open', open);
  const openBtn = $('#open-sidebar');
  if (openBtn) openBtn.classList.toggle('hidden', open && window.innerWidth > 768);
}

/* ---------- wire events ---------- */
function init() {
  $('#toggle-sidebar').onclick = () => setSidebarOpen(isSidebarClosed());
  const openBtn = $('#open-sidebar');
  if (openBtn) openBtn.onclick = () => setSidebarOpen(true);
  $('#mobile-menu').onclick = () => setSidebarOpen(isSidebarClosed());
  $('#sidebar-overlay').onclick = () => setSidebarOpen(false);
  $('#new-chat-btn').onclick = () => { newChat(); closeSidebarMobile(); };
  const topNew = $('#topbar-new-chat');
  if (topNew) topNew.onclick = () => { newChat(); closeSidebarMobile(); };
  const lockBtn = $('#lock-btn');
  if (lockBtn) lockBtn.onclick = () => openSettings();

  $('#search-input').addEventListener('input', (e) => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => loadChats(e.target.value.trim()), 300);
  });

  const input = $('#input');
  input.addEventListener('input', () => {
    autoResize();
    if (!state.streaming) $('#send-btn').disabled = !input.value.trim();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (state.streaming) stopStream();
      else sendMessage();
    }
  });

  $('#send-btn').onclick = () => {
    if (state.streaming) stopStream();
    else sendMessage();
  };

  $('#model-btn').onclick = (e) => {
    e.stopPropagation();
    $('#model-menu').classList.toggle('hidden');
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.model-picker')) $('#model-menu').classList.add('hidden');
  });

  $('#theme-btn').onclick = async () => {
    if (themeTransitioning) return;
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    themeTransitioning = true;
    try {
      await animateThemeChange($('#theme-btn'), next);
    } finally {
      themeTransitioning = false;
    }
    await api('/api/auth/me', { method: 'PATCH', body: JSON.stringify({ theme: next }) }).catch(() => {});
  };

  $('#logout-btn').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  };

  $('#settings-btn').onclick = openSettings;
  $('#chat-settings-btn').onclick = () => openChatSettings();

  const navModels = $('#nav-models');
  if (navModels) {
    navModels.onclick = () => {
      $$('.side-nav-item').forEach((b) => b.classList.remove('active'));
      navModels.classList.add('active');
      $('#model-menu').classList.remove('hidden');
      $('#model-btn').focus();
    };
  }
  const navSettings = $('#nav-settings');
  if (navSettings) {
    navSettings.onclick = () => {
      $$('.side-nav-item').forEach((b) => b.classList.remove('active'));
      navSettings.classList.add('active');
      openSettings();
      setTimeout(() => {
        $$('.side-nav-item').forEach((b) => b.classList.remove('active'));
        const chatNav = $('#nav-chat');
        if (chatNav) chatNav.classList.add('active');
      }, 100);
    };
  }
  const navChat = $('#nav-chat');
  if (navChat) {
    navChat.onclick = () => {
      $$('.side-nav-item').forEach((b) => b.classList.remove('active'));
      navChat.classList.add('active');
      closeSidebarMobile();
    };
  }

  $('#chat-title').addEventListener('change', async (e) => {
    if (!state.currentChat) return;
    try {
      await api(`/api/chats/${state.currentChat.id}`, { method: 'PATCH', body: JSON.stringify({ title: e.target.value }) });
      state.currentChat.title = e.target.value;
      loadChats($('#search-input').value.trim());
    } catch (err) { toast(err.message); }
  });
  $('#chat-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });

  $('#attach-btn').onclick = () => $('#file-input').click();
  $('#file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await uploadFile(file);
    } catch (err) {
      toast(err.message);
    }
    e.target.value = '';
  });

  $('#settings-modal').addEventListener('click', (e) => {
    if (e.target === $('#settings-modal')) $('#settings-modal').classList.add('hidden');
  });
  $('#chat-settings-modal').addEventListener('click', (e) => {
    if (e.target === $('#chat-settings-modal')) $('#chat-settings-modal').classList.add('hidden');
  });
  $('#cs-temp').addEventListener('input', (e) => ($('#cs-temp-val').textContent = e.target.value));
  $('#cs-top-p').addEventListener('input', (e) => ($('#cs-top-p-val').textContent = e.target.value));

  function syncMobileBtns() {
    $('#mobile-menu').style.display = window.innerWidth <= 768 ? 'flex' : 'none';
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    } else {
      $('#sidebar').classList.remove('closed', 'open');
      const openBtn = $('#open-sidebar');
      if (openBtn) openBtn.classList.add('hidden');
    }
  }
  window.addEventListener('resize', syncMobileBtns);
  syncMobileBtns();

  syncTopbarTitle();
  const hashId = location.hash.startsWith('#chat=') ? Number(location.hash.slice(6)) : null;
  if (hashId) openChat(hashId);

  const searchInput = $('#search-input');
  searchInput.setAttribute('autocomplete', 'off');
  searchInput.addEventListener('change', () => { searchInput.value = searchInput.value.trim(); });
}

/* ---------- boot ---------- */
(async function boot() {
  try {
    await loadMe();
  } catch (e) {
    return; // redirecting to /login
  }
  init();
  await Promise.all([loadChats(), loadModels()]);
  renderMessages();
  setInterval(loadModels, 60000);
})();
