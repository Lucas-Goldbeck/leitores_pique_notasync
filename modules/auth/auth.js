const AUTH_STORAGE_KEY = 'notasync:leitores-xml:auth:v1';
const AUTH_IDLE_TIMEOUT_MS = 20 * 60 * 1000;
const AUTH_ACTIVITY_PING_INTERVAL_MS = 60 * 1000;

export function mountAuthAccess({ authRoot, appShell, readerMount, settingsMount, settingsNav }) {
  if (!authRoot || !appShell || !readerMount || !settingsMount || !settingsNav) return;

  const auth = { accessToken: '', refreshToken: '', user: null, remember: false };
  const settings = { users: [], loading: false, creating: false, savingUser: false, deletingUser: false, error: '', success: '', resetUser: null, editingUser: null, deleteUser: null };
  let refreshPromise = null;
  let idleTimeout = null;
  let lastAuthActivityPingAt = 0;
  let authActivityPingPromise = null;
  let authGeneration = 0;
  let sessionEnding = false;

  document.addEventListener('keydown', registerAuthInteraction, true);
  document.addEventListener('pointerdown', registerAuthInteraction, true);
  document.addEventListener('touchstart', registerAuthInteraction, true);
  document.addEventListener('drop', registerAuthInteraction, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registerAuthInteraction();
  }, true);

  settingsNav.addEventListener('click', () => {
    if (auth.user?.role !== 'admin') return;
    readerMount.hidden = true;
    settingsMount.hidden = false;
    document.querySelectorAll('[data-reader]').forEach((button) => button.removeAttribute('aria-current'));
    settingsNav.setAttribute('aria-current', 'page');
    void loadUsers();
  });

  document.querySelectorAll('[data-reader]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!auth.user) return;
      settingsMount.hidden = true;
      readerMount.hidden = false;
      settingsNav.removeAttribute('aria-current');
    });
  });

  document.getElementById('authLogoutButton')?.addEventListener('click', () => void logout());
  authRoot.addEventListener('submit', (event) => {
    if (event.target.id !== 'authLoginForm') return;
    event.preventDefault();
    void login(event.target);
  });
  settingsMount.addEventListener('click', handleSettingsClick);
  settingsMount.addEventListener('submit', handleSettingsSubmit);

  void initialize();

  async function initialize() {
    const saved = readStoredAuth();
    if (!saved?.accessToken && !saved?.refreshToken) {
      renderLogin();
      return;
    }

    Object.assign(auth, saved);
    authRoot.replaceChildren();
    authRoot.hidden = true;
    try {
      let user = null;
      if (auth.accessToken) {
        try {
          const payload = await rawRequest('/auth/me');
          user = payload?.user || null;
        } catch (error) {
          if (error.status !== 401) throw error;
        }
      }
      if (!user && auth.refreshToken && await refreshSession()) user = auth.user;
      if (!user) {
        clearStoredAuth();
        clearLocalAuth();
        renderLogin();
        return;
      }
      auth.user = user;
      persistAuth();
      await showApplication();
    } catch (error) {
      renderLogin({ error: connectionMessage(error) });
    }
  }

  async function login(form) {
    sessionEnding = false;
    const loginGeneration = authGeneration;
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add('loading'); }
    const formData = new FormData(form);
    const username = String(formData.get('username') || '').trim();
    const password = String(formData.get('password') || '');
    auth.remember = Boolean(form.querySelector('#authRemember')?.checked);
    if (!username || !password) {
      renderLogin({ username, error: 'Informe usuário e senha para entrar.', remember: auth.remember });
      return;
    }

    try {
      const payload = await rawRequest('/auth/login', {
        method: 'POST',
        body: { username, password },
        skipAuth: true
      });
      if (loginGeneration !== authGeneration) return;
      applyAuthPayload(payload);
      await showApplication();
    } catch (error) {
      if (loginGeneration !== authGeneration) return;
      renderLogin({ username, error: connectionMessage(error) });
    }
  }

  async function logout() {
    sessionEnding = true;
    authGeneration += 1;
    clearTimeout(idleTimeout);
    try {
      if (auth.accessToken) await rawRequest('/auth/logout', { method: 'POST' });
    } catch {}
    clearReaderSession();
    clearStoredAuth();
    clearLocalAuth();
    appShell.hidden = true;
    settingsMount.hidden = true;
    settingsNav.hidden = true;
    renderLogin();
  }

  async function showApplication() {
    if (!auth.user) {
      clearStoredAuth();
      renderLogin({ error: 'A API n\u00e3o retornou os dados da conta autenticada.' });
      return;
    }
    authRoot.replaceChildren();
    authRoot.hidden = true;
    appShell.hidden = false;
    settingsMount.hidden = true;
    readerMount.hidden = false;
    syncUserIdentity();
    settingsNav.removeAttribute('aria-current');
    document.querySelector('[data-reader="nfe"]')?.click();
    registerAuthInteraction({ skipPing: true });
  }

  function syncUserIdentity() {
    if (!auth.user) return;
    settingsNav.hidden = auth.user.role !== 'admin';
    const name = auth.user.nome || auth.user.username || 'Usuário';
    const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'CF';
    document.getElementById('authUserName').textContent = name;
    document.getElementById('authUserRole').textContent = roleLabel(auth.user.role);
    document.getElementById('authUserInitials').textContent = initials;
    document.getElementById('authUserCard').hidden = false;
    if (auth.user.role !== 'admin') {
      resetSettingsState();
      settingsMount.replaceChildren();
      if (!settingsMount.hidden) {
        settingsMount.hidden = true;
        readerMount.hidden = false;
        document.querySelector('[data-reader="nfe"]')?.click();
      }
      settingsNav.removeAttribute('aria-current');
    }
  }

  function renderLogin({ username = '', error = '', focus = true, remember = auth.remember } = {}) {
    appShell.hidden = true;
    authRoot.hidden = false;
    authRoot.innerHTML =
      '<section class="auth-screen confis-login-screen">' +
        '<article class="auth-card confis-login-card">' +
          '<img class="confis-login-logo" src="./assets/confis-logo2.png" alt="CONFIS \u2014 Confer\u00eancia Fiscal" />' +
          '<h1 class="confis-login-title">Acessar o sistema</h1>' +
          '<p class="confis-login-subtitle">Informe suas credenciais para entrar no CONFIS.</p>' +
          (error ? '<div class="auth-error" role="alert">' + escapeHtml(error) + '</div>' : '') +
          '<form id="authLoginForm" class="confis-login-form" novalidate>' +
            '<label class="confis-login-field">Usu\u00e1rio' +
              '<span class="confis-login-input-wrap">' +
                '<input class="confis-login-input" name="username" type="text" value="' + escapeHtml(username) + '" autocomplete="username" spellcheck="false" required />' +
                '<span class="confis-login-input-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>' +
              '</span>' +
            '</label>' +
            '<label class="confis-login-field">Senha' +
              '<span class="confis-login-input-wrap">' +
                '<input class="confis-login-input" name="password" type="password" autocomplete="current-password" id="authPassInput" required />' +
                '<button type="button" class="confis-login-input-icon" id="authPassToggle" aria-label="Mostrar senha">' +
                  '<svg id="authEyeOn" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
                  '<svg id="authEyeOff" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" hidden><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>' +
                '</button>' +
              '</span>' +
            '</label>' +
            '<div class="confis-login-options">' +
              '<label class="confis-login-remember" for="authRemember">' +
                '<input type="checkbox" id="authRemember"' + (remember ? ' checked' : '') + ' />' +
                '<span class="confis-login-checkbox" aria-hidden="true"></span>' +
                '<span>Manter conectado</span>' +
              '</label>' +
              '<button class="confis-login-link" type="button" id="authForgotPassword">Esqueci a senha</button>' +
            '</div>' +
            '<p class="confis-login-notice" id="authLoginNotice" hidden>Para redefinir sua senha, fale com o administrador.</p>' +
            '<button class="auth-primary-button confis-login-submit" type="submit">' +
              '<span class="auth-btn-loader" aria-hidden="true"></span>' +
              '<span class="auth-btn-lbl">Entrar</span>' +
              '<svg class="auth-btn-arr" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>' +
            '</button>' +
          '</form>' +
          '<footer class="confis-login-footer">Precisa de acesso? <button type="button" class="confis-login-link" id="authContactAdmin">Fale com o administrador</button><span>\u00a9 2026 CONFIS \u00b7 Todos os direitos reservados</span></footer>' +
        '</article>' +
      '</section>';
    if (focus) authRoot.querySelector('input[name="username"]')?.focus();
    const passInput = document.getElementById('authPassInput');
    const passToggle = document.getElementById('authPassToggle');
    if (passToggle && passInput) {
      passToggle.addEventListener('click', () => {
        const show = passInput.type === 'password';
        passInput.type = show ? 'text' : 'password';
        document.getElementById('authEyeOn').hidden = show;
        document.getElementById('authEyeOff').hidden = !show;
        passInput.focus();
      });
    }
    const showLoginNotice = () => {
      const notice = document.getElementById('authLoginNotice');
      if (notice) notice.hidden = false;
    };
    document.getElementById('authForgotPassword')?.addEventListener('click', showLoginNotice);
    document.getElementById('authContactAdmin')?.addEventListener('click', showLoginNotice);
  }

  async function loadUsers() {
    if (auth.user?.role !== 'admin' || settings.loading) return;
    const requestingAdminId = auth.user.userId;
    settings.loading = true;
    settings.error = '';
    try {
      const users = await apiRequest('/auth/usuarios');
      if (auth.user?.userId === requestingAdminId && auth.user?.role === 'admin') settings.users = Array.isArray(users) ? users : [];
    } catch (error) {
      if (auth.user?.userId === requestingAdminId && auth.user?.role === 'admin') settings.error = connectionMessage(error);
    } finally {
      settings.loading = false;
      if (!settingsMount.hidden && auth.user?.userId === requestingAdminId && auth.user?.role === 'admin') renderSettings();
    }
  }

  function renderSettings() {
    if (auth.user?.role !== 'admin') {
      settingsMount.replaceChildren();
      settingsMount.hidden = true;
      return;
    }

    settingsMount.innerHTML = `
      <section class="settings-page">
        <header class="settings-page-header">
          <div><span class="settings-kicker">CONFIS · GCONT</span><h1>Configurações</h1><p>Crie e administre os acessos aos leitores fiscais.</p></div>
          <button class="settings-secondary-button" type="button" data-action="reload-users" ${settings.loading ? 'disabled' : ''}>${settings.loading ? 'Atualizando…' : 'Atualizar usuários'}</button>
        </header>
        ${settings.error ? `<div class="settings-alert" role="alert">${escapeHtml(settings.error)}</div>` : ''}
        ${settings.success ? `<div class="settings-success" role="status">${escapeHtml(settings.success)}</div>` : ''}
        <div class="settings-grid">
          <section class="settings-card settings-create-card">
            <header><span class="settings-card-icon" aria-hidden="true">+</span><div><h2>Criar acesso</h2><p>Cadastre um usuário para entrar nos leitores.</p></div></header>
            <form id="createAccessForm" class="settings-form">
              <label>Usuário<input name="username" minlength="3" maxlength="80" pattern="[A-Za-z0-9._-]+" autocomplete="off" required placeholder="ex.: maria.silva" /></label>
              <label>Nome<input name="nome" maxlength="120" autocomplete="name" placeholder="Nome da pessoa" /></label>
              <label>Perfil<select name="role"><option value="comum">Usuário comum</option><option value="admin">Administrador</option></select></label>
              <label>Senha inicial<input name="password" type="password" autocomplete="new-password" required placeholder="Defina uma senha" /></label>
              <label class="settings-checkbox"><input name="ativo" type="checkbox" checked /><span>Acesso ativo</span></label>
              <button class="auth-primary-button" type="submit" ${settings.creating ? 'disabled' : ''}>${settings.creating ? 'Criando acesso…' : 'Criar acesso'}</button>
              <small>Somente administradores podem acessar esta página e criar contas.</small>
            </form>
          </section>
          <section class="settings-card settings-users-card">
            <header><span class="settings-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 8v6m3-3h-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span><div><h2>Usuários e acessos</h2><p>Contas cadastradas no GSync principal.</p></div><span class="settings-count">${settings.users.length}</span></header>
            ${settings.users.length ? `
              <div class="settings-table-wrap"><table class="settings-table"><thead><tr><th>Usuário</th><th>Perfil</th><th>Status</th><th>Tempo logado</th><th>Último acesso</th><th>Ações</th></tr></thead><tbody>
                ${settings.users.map((user) => {
                  const self = user.id === auth.user.userId;
                  return `<tr>
                    <td><strong>${escapeHtml(user.nome || user.username)}</strong><small>${escapeHtml(user.username)}</small></td>
                    <td><span class="settings-role-badge ${user.role === 'admin' ? 'is-admin' : ''}">${escapeHtml(roleLabel(user.role))}</span></td>
                    <td><span class="settings-state ${user.ativo ? 'is-active' : 'is-inactive'}">${user.ativo ? 'Ativo' : 'Inativo'}</span></td>
                    <td>${escapeHtml(formatDuration(user.tempoLogadoMs))}${user.conectadoAgora ? '<small class="settings-login-live">Conectado agora</small>' : ''}</td>
                    <td>${escapeHtml(formatDate(user.ultimoLoginAt))}</td>
                    <td><div class="settings-row-actions">
                      <button class="settings-secondary-button compact" type="button" data-action="edit-user" data-user-id="${escapeHtml(user.id)}">Editar</button>
                      <button class="settings-link-button" type="button" data-action="reset-password" data-user-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}">Redefinir senha</button>
                      <button class="settings-secondary-button compact" type="button" data-action="toggle-user" data-user-id="${escapeHtml(user.id)}" data-active="${!user.ativo}" ${self ? 'disabled title="Você não pode desativar a própria conta."' : ''}>${user.ativo ? 'Desativar' : 'Ativar'}</button>
                    </div></td>
                  </tr>`;
                }).join('')}
              </tbody></table></div>
            ` : '<div class="settings-empty">Nenhum usuário cadastrado.</div>'}
          </section>
        </div>
        ${settings.resetUser ? renderResetPasswordDialog(settings.resetUser) : ''}
        ${settings.deleteUser ? renderDeleteUserDialog(settings.deleteUser) : settings.editingUser ? renderEditUserDialog(settings.editingUser) : ''}
      </section>
    `;
  }

  function renderEditUserDialog(user) {
    return `<div class="settings-modal-backdrop" role="presentation"><section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="editUserTitle">
      <h2 id="editUserTitle">Editar usuário</h2><p>Atualize o nome, usuário, perfil e status de <strong>${escapeHtml(user.username)}</strong>. A edição também está disponível para o administrador principal.</p>
      ${settings.error ? `<div class="settings-alert" role="alert">${escapeHtml(settings.error)}</div>` : ''}
      <form id="editAccessForm" class="settings-form">
        <label>Usuário<input name="username" minlength="3" maxlength="80" pattern="[A-Za-z0-9._-]+" autocomplete="off" required value="${escapeHtml(user.username)}" /></label>
        <label>Nome<input name="nome" maxlength="120" autocomplete="name" value="${escapeHtml(user.nome || '')}" placeholder="Nome da pessoa" /></label>
        <label>Perfil<select name="role"><option value="comum" ${user.role === 'comum' ? 'selected' : ''}>Usuário comum</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option></select></label>
        <label class="settings-checkbox"><input name="ativo" type="checkbox" ${user.ativo ? 'checked' : ''} /><span>Acesso ativo</span></label>
        <div class="settings-modal-actions settings-edit-actions"><button class="settings-danger-button" type="button" data-action="request-delete-edit" ${settings.savingUser ? 'disabled' : ''}>Excluir usuário</button><div><button class="settings-secondary-button" type="button" data-action="cancel-edit" ${settings.savingUser ? 'disabled' : ''}>Cancelar</button><button class="auth-primary-button" type="submit" ${settings.savingUser ? 'disabled' : ''}>${settings.savingUser ? 'Salvando…' : 'Salvar alterações'}</button></div></div>
      </form>
    </section></div>`;
  }

  function renderDeleteUserDialog(user) {
    return `<div class="settings-modal-backdrop" role="presentation"><section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="deleteUserTitle">
      <h2 id="deleteUserTitle">Excluir usuário</h2><p>Deseja excluir permanentemente a conta <strong>${escapeHtml(user.nome || user.username)}</strong> (${escapeHtml(user.username)})? As sessões dessa conta serão encerradas. É necessário manter pelo menos um administrador ativo.</p>
      ${settings.error ? `<div class="settings-alert" role="alert">${escapeHtml(settings.error)}</div>` : ''}
      <div class="settings-modal-actions"><button class="settings-secondary-button" type="button" data-action="cancel-delete" ${settings.deletingUser ? 'disabled' : ''}>Cancelar</button><button class="settings-danger-button" type="button" data-action="confirm-delete" ${settings.deletingUser ? 'disabled' : ''}>${settings.deletingUser ? 'Excluindo…' : 'Excluir usuário'}</button></div>
    </section></div>`;
  }

  function renderResetPasswordDialog(user) {
    return `<div class="settings-modal-backdrop" role="presentation"><section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="resetPasswordTitle">
      <h2 id="resetPasswordTitle">Redefinir senha</h2><p>Nova senha para <strong>${escapeHtml(user.username)}</strong>. As sessões anteriores serão encerradas.</p>
      <form id="resetAccessPasswordForm"><label class="auth-field">Nova senha<input name="password" type="password" autocomplete="new-password" required autofocus /></label><label class="auth-field">Confirmar senha<input name="passwordConfirmation" type="password" autocomplete="new-password" required /></label><div class="settings-modal-actions"><button class="settings-secondary-button" type="button" data-action="cancel-reset">Cancelar</button><button class="auth-primary-button" type="submit">Salvar senha</button></div></form>
    </section></div>`;
  }

  async function handleSettingsSubmit(event) {
    if (auth.user?.role !== 'admin') return;
    if (event.target.id === 'createAccessForm') {
      event.preventDefault();
      const actingAdminId = auth.user.userId;
      const data = new FormData(event.target);
      settings.creating = true;
      settings.error = '';
      settings.success = '';
      renderSettings();
      try {
        await apiRequest('/auth/usuarios', {
          method: 'POST',
          body: {
            username: String(data.get('username') || '').trim(),
            nome: String(data.get('nome') || '').trim() || undefined,
            password: String(data.get('password') || ''),
            role: String(data.get('role') || 'comum'),
            ativo: data.get('ativo') === 'on'
          }
        });
        if (auth.user?.userId !== actingAdminId || auth.user?.role !== 'admin') return;
        settings.success = 'Acesso criado com sucesso.';
        settings.loading = true;
        renderSettings();
        const users = await apiRequest('/auth/usuarios');
        if (auth.user?.userId === actingAdminId && auth.user?.role === 'admin') settings.users = Array.isArray(users) ? users : [];
      } catch (error) {
        if (auth.user?.userId === actingAdminId && auth.user?.role === 'admin') settings.error = connectionMessage(error);
      } finally {
        if (auth.user?.userId === actingAdminId && auth.user?.role === 'admin') {
          settings.creating = false;
          settings.loading = false;
          if (!settingsMount.hidden && auth.user?.role === 'admin') renderSettings();
        }
      }
    } else if (event.target.id === 'resetAccessPasswordForm') {
      event.preventDefault();
      if (!settings.resetUser) return;
      const actingAdminId = auth.user.userId;
      const user = settings.resetUser;
      const formData = new FormData(event.target);
      const password = String(formData.get('password') || '');
      const passwordConfirmation = String(formData.get('passwordConfirmation') || '');
      if (password !== passwordConfirmation) {
        settings.error = 'As senhas devem ser iguais.';
        renderSettings();
        return;
      }
      try {
        await apiRequest(`/auth/usuarios/${encodeURIComponent(user.id)}/reset-password`, {
          method: 'POST',
          body: { password }
        });
        if (auth.user?.userId !== actingAdminId || auth.user?.role !== 'admin') return;
        settings.resetUser = null;
        settings.success = `Senha redefinida para ${user.username}. As sessões anteriores foram encerradas.`;
        if (user.id === auth.user.userId) {
          clearStoredAuth();
          clearReaderSession();
          clearLocalAuth();
          appShell.hidden = true;
          settingsNav.hidden = true;
          renderLogin({ username: user.username, error: 'Senha atualizada. Entre novamente com a nova senha.' });
          return;
        }
        renderSettings();
      } catch (error) {
        if (auth.user?.userId !== actingAdminId || auth.user?.role !== 'admin') return;
        settings.error = connectionMessage(error);
        renderSettings();
      }
    } else if (event.target.id === 'editAccessForm') {
      event.preventDefault();
      if (!settings.editingUser || settings.savingUser) return;
      const actingAdminId = auth.user.userId;
      const user = settings.editingUser;
      const data = new FormData(event.target);
      const changes = {
        username: String(data.get('username') || '').trim(),
        nome: String(data.get('nome') || '').trim(),
        role: String(data.get('role') || 'comum'),
        ativo: data.get('ativo') === 'on'
      };
      settings.savingUser = true;
      settings.error = '';
      renderSettings();
      try {
        const updated = await apiRequest(`/auth/usuarios/${encodeURIComponent(user.id)}`, { method: 'PATCH', body: changes });
        if (auth.user?.userId !== actingAdminId || auth.user?.role !== 'admin') return;
        if (user.id === actingAdminId && updated.role !== 'admin') {
          clearStoredAuth();
          clearReaderSession();
          clearLocalAuth();
          appShell.hidden = true;
          settingsNav.hidden = true;
          renderLogin({ username: updated.username, error: 'Conta atualizada. Entre novamente para continuar.' });
          return;
        }
        if (user.id === actingAdminId) {
          auth.user.username = updated.username;
          auth.user.nome = updated.nome;
          auth.user.role = updated.role;
          syncUserIdentity();
          persistAuth();
        }
        settings.editingUser = null;
        settings.success = `Usuário ${updated.username} atualizado com sucesso.`;
        settings.savingUser = false;
        await loadUsers();
      } catch (error) {
        if (auth.user?.userId !== actingAdminId || auth.user?.role !== 'admin') return;
        settings.error = connectionMessage(error);
        settings.savingUser = false;
        renderSettings();
      }
    }
  }

  function handleSettingsClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button || auth.user?.role !== 'admin') return;
    const action = button.dataset.action;
    if (action === 'reload-users') {
      void loadUsers();
    } else if (action === 'cancel-reset') {
      settings.resetUser = null;
      renderSettings();
    } else if (action === 'edit-user') {
      const user = settings.users.find((entry) => entry.id === button.dataset.userId);
      if (!user) return;
      settings.error = '';
      settings.editingUser = user;
      renderSettings();
      settingsMount.querySelector('#editAccessForm input[name="username"]')?.focus();
    } else if (action === 'cancel-edit') {
      settings.editingUser = null;
      settings.savingUser = false;
      renderSettings();
    } else if (action === 'request-delete-edit') {
      const user = settings.editingUser;
      if (!user || settings.savingUser) return;
      settings.error = '';
      settings.deleteUser = user;
      renderSettings();
    } else if (action === 'cancel-delete') {
      settings.deleteUser = null;
      settings.deletingUser = false;
      renderSettings();
    } else if (action === 'confirm-delete') {
      void removeUser();
    } else if (action === 'reset-password') {
      settings.error = '';
      settings.resetUser = { id: button.dataset.userId, username: button.dataset.username };
      renderSettings();
      settingsMount.querySelector('#resetAccessPasswordForm input')?.focus();
    } else if (action === 'toggle-user') {
      void toggleUser(button.dataset.userId, button.dataset.active === 'true');
    }
  }

  async function toggleUser(userId, ativo) {
    const actingAdminId = auth.user?.userId;
    settings.error = '';
    settings.success = '';
    try {
      await apiRequest(`/auth/usuarios/${encodeURIComponent(userId)}`, { method: 'PATCH', body: { ativo } });
      if (auth.user?.userId !== actingAdminId || auth.user?.role !== 'admin') return;
      settings.success = `Acesso ${ativo ? 'ativado' : 'desativado'} com sucesso.`;
      await loadUsers();
    } catch (error) {
      if (auth.user?.userId !== actingAdminId || auth.user?.role !== 'admin') return;
      settings.error = connectionMessage(error);
      renderSettings();
    }
  }

  async function removeUser() {
    if (!settings.deleteUser || settings.deletingUser) return;
    const actingAdminId = auth.user?.userId;
    const user = settings.deleteUser;
    settings.deletingUser = true;
    settings.error = '';
    renderSettings();
    try {
      await apiRequest(`/auth/usuarios/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
      if (auth.user?.userId !== actingAdminId || auth.user?.role !== 'admin') return;
      if (user.id === actingAdminId) {
        clearStoredAuth();
        clearReaderSession();
        clearLocalAuth();
        appShell.hidden = true;
        settingsNav.hidden = true;
        renderLogin({ username: user.username, error: 'Conta excluída. Entre com outro administrador.' });
        return;
      }
      settings.editingUser = null;
      settings.deleteUser = null;
      settings.deletingUser = false;
      settings.success = `Usuário ${user.username} excluído com sucesso.`;
      await loadUsers();
    } catch (error) {
      if (auth.user?.userId !== actingAdminId || auth.user?.role !== 'admin') return;
      settings.error = connectionMessage(error);
      settings.deletingUser = false;
      renderSettings();
    }
  }

  async function apiRequest(path, options = {}) {
    try {
      return await rawRequest(path, options);
    } catch (error) {
      if (error.status !== 401 || path === '/auth/login' || path === '/auth/refresh') throw error;
      if (await refreshSession()) return rawRequest(path, options);
      clearStoredAuth();
      clearReaderSession();
      clearLocalAuth();
      appShell.hidden = true;
      settingsMount.hidden = true;
      settingsNav.hidden = true;
      renderLogin({ error: 'Sua sessão expirou. Entre novamente para continuar.' });
      throw error;
    }
  }

  async function rawRequest(path, { method = 'GET', body, skipAuth = false, responseType = 'json' } = {}) {
    const headers = { 'X-Session-Activity': 'active' };
    if (!skipAuth && auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;
    if (responseType === 'blob') headers.Accept = 'application/pdf';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(`/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store'
      });
    } catch {
      throw new Error('A conexão com a API do GSync falhou.');
    }

    if (response.ok && responseType === 'blob') return response.blob();
    const responseText = response.status === 204 ? '' : await response.text();
    let payload = null;
    if (responseText) {
      try { payload = JSON.parse(responseText); } catch { payload = responseText; }
    }
    if (!response.ok) {
      const error = new Error(apiErrorMessage(payload, response.status));
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function refreshSession() {
    if (sessionEnding) return Promise.resolve(false);
    if (refreshPromise) return refreshPromise;
    if (!auth.refreshToken) return Promise.resolve(false);
    const refreshGeneration = authGeneration;
    refreshPromise = rawRequest('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: auth.refreshToken },
      skipAuth: true
    }).then((payload) => {
      if (sessionEnding || refreshGeneration !== authGeneration) return false;
      applyAuthPayload(payload);
      if (!appShell.hidden) syncUserIdentity();
      return Boolean(auth.user);
    }).catch(() => false).finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  function applyAuthPayload(payload) {
    auth.accessToken = String(payload?.accessToken || '').trim();
    auth.refreshToken = String(payload?.refreshToken || '').trim();
    auth.user = payload?.user && typeof payload.user === 'object' ? payload.user : null;
    persistAuth();
  }

  function clearLocalAuth() {
    sessionEnding = true;
    authGeneration += 1;
    clearTimeout(idleTimeout);
    idleTimeout = null;
    lastAuthActivityPingAt = 0;
    authActivityPingPromise = null;
    auth.accessToken = '';
    auth.refreshToken = '';
    auth.user = null;
    auth.remember = false;
    resetSettingsState();
    settingsMount.replaceChildren();
    settingsMount.hidden = true;
    document.getElementById('authUserCard').hidden = true;
    document.getElementById('authUserName').textContent = '';
    document.getElementById('authUserRole').textContent = '';
    settingsNav.removeAttribute('aria-current');
  }

  function persistAuth() {
    try {
      const destination = auth.remember ? localStorage : sessionStorage;
      const secondary = auth.remember ? sessionStorage : localStorage;
      secondary.removeItem(AUTH_STORAGE_KEY);
      destination.setItem(AUTH_STORAGE_KEY, JSON.stringify({
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        user: auth.user
      }));
    } catch {}
  }

  function readStoredAuth() {
    try {
      const persistentValue = localStorage.getItem(AUTH_STORAGE_KEY);
      const temporaryValue = sessionStorage.getItem(AUTH_STORAGE_KEY);
      for (const [storedValue, remember] of [[persistentValue, true], [temporaryValue, false]]) {
        if (!storedValue) continue;
        try {
          const value = JSON.parse(storedValue);
          if (value && typeof value === 'object') {
            return {
              accessToken: String(value.accessToken || ''),
              refreshToken: String(value.refreshToken || ''),
              user: value.user && typeof value.user === 'object' ? value.user : null,
              remember
            };
          }
        } catch {}
      }
      return null;
    } catch {
      clearStoredAuth();
      return null;
    }
  }

  function clearStoredAuth() {
    try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch {}
    try { sessionStorage.removeItem(AUTH_STORAGE_KEY); } catch {}
  }

  function resetSettingsState() {
    settings.users = [];
    settings.loading = false;
    settings.creating = false;
    settings.savingUser = false;
    settings.deletingUser = false;
    settings.error = '';
    settings.success = '';
    settings.resetUser = null;
    settings.editingUser = null;
    settings.deleteUser = null;
  }

  function clearReaderSession() {
    document.querySelector('[data-reader="nfe"]')?.click();
    readerMount.querySelector('[data-action="clear-files"]')?.click();
  }

  function registerAuthInteraction({ skipPing = false } = {}) {
    if (sessionEnding || (!auth.accessToken && !auth.refreshToken)) return;
    clearTimeout(idleTimeout);
    idleTimeout = window.setTimeout(() => void expireIdleSession(), AUTH_IDLE_TIMEOUT_MS);
    if (skipPing) return;

    const now = Date.now();
    if (authActivityPingPromise || now - lastAuthActivityPingAt < AUTH_ACTIVITY_PING_INTERVAL_MS) return;
    lastAuthActivityPingAt = now;
    const requestingUserId = auth.user?.userId;
    authActivityPingPromise = apiRequest('/auth/me')
      .then((payload) => {
        if (auth.user?.userId === requestingUserId && payload?.user) {
          auth.user = payload.user;
          syncUserIdentity();
          persistAuth();
        }
      })
      .catch(() => {})
      .finally(() => { authActivityPingPromise = null; });
  }

  async function expireIdleSession() {
    if (sessionEnding || !auth.user) return;
    sessionEnding = true;
    authGeneration += 1;
    const username = auth.user.username || '';
    try {
      if (auth.accessToken) await rawRequest('/auth/logout', { method: 'POST' });
    } catch {}
    clearReaderSession();
    clearStoredAuth();
    clearLocalAuth();
    appShell.hidden = true;
    settingsNav.hidden = true;
    renderLogin({ username, error: 'Sua sessão foi encerrada por inatividade. Entre novamente para continuar.' });
  }

  return { request: apiRequest };
}

function roleLabel(role) {
  if (role === 'admin') return 'Administrador';
  if (role === 'cliente') return 'Usuário cliente';
  return 'Usuário comum';
}

function formatDate(value) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function formatDuration(value) {
  const totalMinutes = Math.floor(Math.max(0, Number(value) || 0) / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} d`);
  if (hours) parts.push(`${hours} h`);
  if (minutes || !parts.length) parts.push(`${minutes} min`);
  return parts.join(' ');
}

function apiErrorMessage(payload, status) {
  if (payload && typeof payload === 'object') {
    const message = payload.message;
    if (Array.isArray(message)) return message.join(' ');
    if (typeof message === 'string' && message) return message;
  }
  return typeof payload === 'string' && payload ? payload : `Falha na API (HTTP ${status}).`;
}

function connectionMessage(error) {
  const message = String(error?.message || '');
  if (error?.status === 405) {
    return 'Esta página está em um servidor antigo ou estático. Inicie o projeto com npm.cmd start e abra http://127.0.0.1:4173.';
  }
  if (message.includes('conexão com a API') || message.includes('API do GSync')) {
    return 'Não foi possível conectar ao GSync principal. Verifique a configuração da API e tente novamente.';
  }
  return message || 'Não foi possível concluir a operação.';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
