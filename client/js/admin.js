/* Admin panel */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const state = { user: null, users: [], models: [], perms: {}, editingUserId: null };

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (res.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
  if (res.status === 403) { location.href = '/'; throw new Error('forbidden'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'خطا');
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
  el._t = setTimeout(() => { el.textContent = ''; }, 2500);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d.includes('Z') || d.includes('+') ? d : d + 'Z').toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
}

function statusBadge(s) {
  if (s === 'active') return '<span class="badge green"><svg class="badge-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> آزاد</span>';
  if (s === 'limited') return '<span class="badge yellow"><svg class="badge-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg> محدود</span>';
  if (s === 'blocked') return '<span class="badge red"><svg class="badge-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/></svg> مسدود</span>';
  return esc(s);
}

/* ---------- tabs ---------- */
$$('.nav-item[data-tab]').forEach((btn) => {
  btn.onclick = () => {
    $$('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab-panel').forEach((p) => p.classList.remove('active'));
    $('#tab-' + btn.dataset.tab).classList.add('active');
    loadTab(btn.dataset.tab);
  };
});

function loadTab(tab) {
  if (tab === 'dashboard') loadStats();
  if (tab === 'users') loadUsers();
  if (tab === 'chats') loadChats();
  if (tab === 'models') loadModelsAdmin();
  if (tab === 'usage') loadUsage();
  if (tab === 'logs') loadLogs();
  if (tab === 'settings') loadSettings();
}

/* ---------- dashboard ---------- */
async function loadStats() {
  const data = await api('/api/admin/stats');
  $('#st-users').textContent = data.users;
  $('#st-chats').textContent = data.chats;
  $('#st-messages').textContent = data.messages.toLocaleString('en-US');
  $('#st-messages-today').textContent = data.messages_today;
  $('#st-files').textContent = data.files;
  $('#st-models').textContent = data.models;

  const lm = data.lm;
  $('#lm-panel').innerHTML = lm.online
    ? `<div class="lm-line"><span class="dot on"></span> آنلاین</div>
       <div class="lm-line">مدل‌های قابل استفاده: <b>${lm.modelCount}</b></div>
       <div class="lm-line">آدرس: <code>${esc(location.origin)}</code></div>`
    : `<div class="lm-line"><span class="dot"></span> آفلاین — LM Studio را باز کنید</div>`;

  const usage = data.usage || [];
  $('#model-usage').innerHTML = usage.length
    ? usage.map((u) => {
        const pct = usage.reduce((a, b) => a + b.uses, 0) ? Math.round((u.uses / usage.reduce((a, b) => a + b.uses, 0)) * 100) : 0;
        return `<div class="usage-row"><span>${esc(u.model || '?')}</span><div class="bar"><div style="width:${pct}%"></div></div><span>${u.uses} (${pct}%)</span></div>`;
      }).join('')
    : 'هنوز مصرفی ثبت نشده';
}

/* ---------- users ---------- */
let usersSearchTimer = null;
let chatsSearchTimer = null;

async function loadRegisterRequests() {
  try {
    const data = await api('/api/admin/register-requests');
    const list = data.requests || [];
    const pending = list.filter((r) => r.status === 'pending');
    $('#reg-requests-panel').style.display = pending.length || list.length ? '' : 'none';
    const tbody = $('#reg-requests-table tbody');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4">درخواستی وجود ندارد</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((r) => {
      const statusText =
        r.status === 'pending'
          ? '<span class="badge yellow"><svg class="badge-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> در انتظار</span>'
          : r.status === 'approved'
            ? '<span class="badge green"><svg class="badge-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> تایید شده</span>'
            : '<span class="badge red"><svg class="badge-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg> رد شده</span>';
      const actions =
        r.status === 'pending'
          ? `<button class="btn-mini" data-approve="${r.id}"><svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> تایید</button>
             <button class="btn-mini danger" data-reject="${r.id}"><svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg> رد</button>`
          : '';
      return `<tr>
        <td><b>${esc(r.username)}</b></td>
        <td>${statusText}</td>
        <td>${fmtDate(r.created_at)}</td>
        <td class="actions">${actions}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="4">درخواستی وجود ندارد</td></tr>';

    tbody.querySelectorAll('[data-approve]').forEach((b) =>
      (b.onclick = async () => {
        try {
          const r = await api(`/api/admin/register-requests/${b.dataset.approve}/approve`, { method: 'POST' });
          toast(`کاربر ${r.username || ''} تایید شد`);
          loadRegisterRequests();
          loadUsers();
        } catch (e) {
          toast(e.message);
        }
      })
    );
    tbody.querySelectorAll('[data-reject]').forEach((b) =>
      (b.onclick = async () => {
        if (!confirm('این درخواست رد شود؟')) return;
        try {
          await api(`/api/admin/register-requests/${b.dataset.reject}/reject`, { method: 'POST' });
          toast('درخواست رد شد');
          loadRegisterRequests();
        } catch (e) {
          toast(e.message);
        }
      })
    );
  } catch (e) {
    /* ignore */
  }
}

async function loadUsers() {
  loadRegisterRequests();
  const q = ($('#users-search') && $('#users-search').value.trim()) || '';
  const data = await api('/api/admin/users' + (q ? `?q=${encodeURIComponent(q)}` : ''));
  state.users = data.users;
  const tbody = $('#users-table tbody');
  if (!data.users.length) {
    tbody.innerHTML = '<tr><td colspan="9">کاربری یافت نشد</td></tr>';
    return;
  }
  tbody.innerHTML = data.users.map((u) => {
    const usedMsgs = u.messages || 0;
    const usedChats = u.chats || 0;
    const usageStr = (u.max_messages != null ? `${usedMsgs}/${u.max_messages}` : `${usedMsgs}`) +
      (u.max_new_chats != null ? ` چت: ${usedChats}/${u.max_new_chats}` : '');
    return `<tr>
      <td><b>${esc(u.username)}</b><br><small>#${u.id}</small></td>
      <td>${u.role === 'admin' ? '<svg class="inline-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> ادمین' : 'کاربر'}</td>
      <td>${statusBadge(u.status)}</td>
      <td>${u.max_new_chats ?? '∞'}</td>
      <td>${u.max_messages ?? '∞'}</td>
      <td>${esc(usageStr)}</td>
      <td>${usedChats}</td>
      <td>${fmtDate(u.last_activity)}</td>
      <td class="actions">
        <button class="btn-mini" data-edit="${u.id}" title="ویرایش"><svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>
        <button class="btn-mini" data-block="${u.id}" title="${u.status === 'blocked' ? 'آزاد کردن' : 'مسدود کردن'}">${u.status === 'blocked'
          ? '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'
          : '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'}</button>
        <button class="btn-mini danger" data-del="${u.id}" title="حذف"><svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => openUserModal(Number(b.dataset.edit)));
  tbody.querySelectorAll('[data-block]').forEach((b) => b.onclick = async () => {
    const u = state.users.find((x) => x.id === Number(b.dataset.block));
    const next = u.status === 'blocked' ? 'active' : 'blocked';
    await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
    toast(next === 'blocked' ? 'کاربر مسدود شد' : 'کاربر آزاد شد');
    loadUsers();
  });
  tbody.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('این کاربر و همه چت‌هایش حذف شود؟')) return;
    await api(`/api/admin/users/${b.dataset.del}`, { method: 'DELETE' });
    toast('کاربر حذف شد');
    loadUsers();
  });
}

function openUserModal(id = null) {
  state.editingUserId = id;
  const u = id ? state.users.find((x) => x.id === id) : null;
  $('#user-modal-title').textContent = u ? `ویرایش ${u.username}` : 'کاربر جدید';
  $('#um-username').value = u ? u.username : '';
  $('#um-password').value = '';
  $('#um-password').placeholder = u ? 'خالی = بدون تغییر' : 'رمز عبور';
  $('#um-role').value = u ? u.role : 'user';
  $('#um-status').value = u ? u.status : 'active';
  $('#um-chats').value = u && u.max_new_chats != null ? u.max_new_chats : '';
  $('#um-messages').value = u && u.max_messages != null ? u.max_messages : '';
  $('#um-msg').textContent = '';
  $('#um-delete').classList.toggle('hidden', !u || u.id === state.user.id);
  $('#user-modal').classList.remove('hidden');

  $('#um-save').onclick = async () => {
    try {
      const body = {
        username: $('#um-username').value.trim(),
        role: $('#um-role').value,
        status: $('#um-status').value,
        max_new_chats: $('#um-chats').value === '' ? null : Number($('#um-chats').value),
        max_messages: $('#um-messages').value === '' ? null : Number($('#um-messages').value)
      };
      const pass = $('#um-password').value;
      if (pass) body.password = pass;
      if (id) {
        await api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        if (!pass) throw new Error('برای کاربر جدید رمز عبور لازم است');
        await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ ...body, password: pass }) });
      }
      toast('ذخیره شد');
      $('#user-modal').classList.add('hidden');
      loadUsers();
    } catch (e) {
      $('#um-msg').textContent = e.message;
      $('#um-msg').style.color = 'var(--danger)';
    }
  };
  $('#um-cancel').onclick = () => $('#user-modal').classList.add('hidden');
  $('#um-delete').onclick = async () => {
    if (!id || !confirm('حذف شود؟')) return;
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    $('#user-modal').classList.add('hidden');
    loadUsers();
  };
}
$('#add-user-btn').onclick = () => openUserModal(null);

/* ---------- chats ---------- */
async function loadChats() {
  const q = ($('#chats-search') && $('#chats-search').value.trim()) || '';
  const data = await api('/api/admin/chats' + (q ? `?q=${encodeURIComponent(q)}` : ''));
  $('#chats-table tbody').innerHTML = data.chats.map((c) => `<tr>
    <td>${c.id}</td>
    <td>${esc(c.title)}</td>
    <td>${esc(c.username)}</td>
    <td>${esc(c.model || '—')}</td>
    <td>${c.message_count}</td>
    <td>${fmtDate(c.updated_at)}</td>
  </tr>`).join('') || '<tr><td colspan="6">چتی موجود نیست</td></tr>';
}

if ($('#users-search')) {
  $('#users-search').addEventListener('input', () => {
    clearTimeout(usersSearchTimer);
    usersSearchTimer = setTimeout(loadUsers, 300);
  });
}
if ($('#chats-search')) {
  $('#chats-search').addEventListener('input', () => {
    clearTimeout(chatsSearchTimer);
    chatsSearchTimer = setTimeout(loadChats, 300);
  });
}

/* ---------- models ---------- */
async function loadModelsAdmin() {
  await api('/api/models'); // triggers server-side sync
  const data = await api('/api/admin/models');
  state.models = data.models;
  state.perms = data.perms;

  $('#models-list').innerHTML = state.models.length
    ? state.models.map((m) => `<div class="model-admin-row">
        <div>
          <b>${esc(m.display_name)}</b><br><small>${esc(m.model_key)}</small>
        </div>
        <label class="switch">
          <input type="checkbox" data-model="${esc(m.model_key)}" ${m.enabled ? 'checked' : ''}>
          <span>${m.enabled ? 'فعال' : 'غیرفعال'}</span>
        </label>
      </div>`).join('')
    : '<p class="hint-text">مدلی یافت نشد. LM Studio را روشن کنید و رفرش بزنید.</p>';

  $('#models-list').querySelectorAll('input[data-model]').forEach((cb) => {
    cb.onchange = async () => {
      await api(`/api/admin/models/${encodeURIComponent(cb.dataset.model)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: cb.checked })
      });
      toast(cb.checked ? 'مدل فعال شد' : 'مدل غیرفعال شد');
      loadModelsAdmin();
    };
  });

  // permissions matrix
  const users = state.users.length ? state.users : (await api('/api/admin/users')).users;
  state.users = users;
  $('#perms-head').innerHTML = '<th>مدل</th>' + users.map((u) => `<th>${esc(u.username)}</th>`).join('');
  $('#perms-table tbody').innerHTML = state.models.map((m) => {
    return `<tr>
      <td><b>${esc(m.display_name)}</b></td>
      ${users.map((u) => {
        const key = `${u.id}_${m.model_key}`;
        const perm = state.perms[m.model_key] && state.perms[m.model_key][u.id];
        const checked = perm === undefined ? m.enabled : perm;
        return `<td><input type="checkbox" data-uid="${u.id}" data-mk="${esc(m.model_key)}" ${checked ? 'checked' : ''}></td>`;
      }).join('')}
    </tr>`;
  }).join('');

  $('#perms-table').querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.onchange = async () => {
      await api(`/api/admin/users/${cb.dataset.uid}/models/${encodeURIComponent(cb.dataset.mk)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: cb.checked })
      });
      toast('دسترسی بروزرسانی شد');
    };
  });
}

$('#refresh-models').onclick = async () => {
  try {
    const s = await api('/api/admin/models/refresh', { method: 'POST' });
    toast(s.online ? `${s.modelCount} مدل دریافت شد` : 'LM Studio آفلاین است');
    loadModelsAdmin();
  } catch (e) { toast(e.message); }
};

/* ---------- usage & logs ---------- */
async function loadUsage() {
  const data = await api('/api/admin/usage');
  $('#usage-table tbody').innerHTML = data.logs.map((l) => `<tr>
    <td>${esc(l.username || '—')}</td>
    <td>${esc(l.model || '—')}</td>
    <td>${l.status === 'ok'
      ? '<svg class="inline-ico ok" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>'
      : '<svg class="inline-ico err" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/></svg> ' + esc(l.status)}</td>
    <td>${l.duration_ms ?? '—'}</td>
    <td>${fmtDate(l.created_at)}</td>
  </tr>`).join('') || '<tr><td colspan="5">موردی نیست</td></tr>';
}

async function loadLogs() {
  const data = await api('/api/admin/logs');
  $('#logs-table tbody').innerHTML = data.logs.map((l) => `<tr>
    <td>${esc(l.username || '—')}</td>
    <td><code>${esc(l.action)}</code></td>
    <td>${esc(l.detail || '')}</td>
    <td>${fmtDate(l.created_at)}</td>
  </tr>`).join('') || '<tr><td colspan="4">موردی نیست</td></tr>';
}

/* ---------- settings ---------- */
async function loadSettings() {
  const data = await api('/api/admin/settings');
  const s = data.settings;
  $('#set-site-name').value = s.site_name;
  $('#set-allow-reg').value = s.allow_registration;
  $('#set-system').value = s.default_system_prompt;
  $('#set-temp').value = s.default_temperature;
  $('#set-ctx').value = s.max_context_messages;
}

$('#save-site-settings').onclick = async () => {
  try {
    await api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        site_name: $('#set-site-name').value,
        allow_registration: $('#set-allow-reg').value,
        default_system_prompt: $('#set-system').value,
        default_temperature: $('#set-temp').value,
        max_context_messages: $('#set-ctx').value
      })
    });
    $('#site-settings-msg').textContent = 'ذخیره شد ✓';
    $('#site-settings-msg').style.color = 'var(--accent)';
    toast('تنظیمات ذخیره شد');
  } catch (e) {
    $('#site-settings-msg').textContent = e.message;
    $('#site-settings-msg').style.color = 'var(--danger)';
  }
};

/* ---------- boot ---------- */
(async function boot() {
  try {
    const data = await api('/api/auth/me');
    if (data.user.role !== 'admin') { location.href = '/'; return; }
    state.user = data.user;
    $('#admin-name').textContent = data.user.username;
    $('#admin-avatar').textContent = data.user.username[0].toUpperCase();
  } catch (e) { return; }

  $('#admin-logout').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  };

  loadStats();
  setInterval(() => {
    if ($('#tab-dashboard').classList.contains('active')) loadStats();
  }, 15000);
})();
