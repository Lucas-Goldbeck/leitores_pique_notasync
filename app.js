import { mountXmlReader30 } from './modules/xml-reader30/reader.js';
import { mountAuthAccess } from './modules/auth/auth.js';

(() => {
  const storageKey = 'gcont:theme:v1';
  const root = document.documentElement;
  const toggle = document.getElementById('themeToggle');
  const label = document.getElementById('themeLabel');
  const icon = document.getElementById('themeIcon');

  const sunIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v2m0 15v2m9.5-9.5h-2m-15 0h-2m16.22-6.72-1.42 1.42M6.7 17.3l-1.42 1.42m13.44 0-1.42-1.42M6.7 6.7 5.28 5.28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const moonIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.2 15.15A8.25 8.25 0 0 1 8.85 3.8 8.5 8.5 0 1 0 20.2 15.15Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderTheme() {
    const isDark = root.dataset.theme === 'Escuro';
    label.textContent = isDark ? 'Tema escuro' : 'Tema claro';
    icon.innerHTML = isDark ? moonIcon : sunIcon;
    toggle.setAttribute('aria-label', isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro');
    toggle.setAttribute('aria-pressed', String(isDark));
  }

  try {
    root.dataset.theme = localStorage.getItem(storageKey) === 'Escuro' ? 'Escuro' : 'Claro';
  } catch {
    root.dataset.theme = 'Claro';
  }

  renderTheme();

  toggle.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'Escuro' ? 'Claro' : 'Escuro';
    try {
      localStorage.setItem(storageKey, root.dataset.theme);
    } catch {}
    renderTheme();
  });

  const readerMount = document.getElementById('readerMount');
  const authAccess = mountAuthAccess({
    authRoot: document.getElementById('authRoot'),
    appShell: document.getElementById('appShell'),
    readerMount,
    settingsMount: document.getElementById('settingsMount'),
    settingsNav: document.getElementById('settingsNav')
  });
  mountXmlReader30(readerMount, authAccess?.request);
})();
