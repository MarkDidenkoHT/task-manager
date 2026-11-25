// Обёртка над Telegram WebApp с запасным поведением для обычного браузера (разработка).
const wa = window.Telegram?.WebApp;
export const inTelegram = !!(wa && wa.initData);

export function initTelegram() {
  applyScheme();
  if (!wa) return;
  wa.ready();
  wa.expand();
  wa.onEvent('themeChanged', applyScheme);
  wa.onEvent('viewportChanged', onViewport);
  try {
    wa.disableVerticalSwipes?.();
  } catch {
    /* не поддерживается */
  }
}

// Цвета шапки и фона Telegram совпадают с --bg и --card из tokens.css.
const CHROME = { light: { bg: '#f2f2ee', bar: '#ffffff' }, dark: { bg: '#0d0e10', bar: '#18191c' } };

function applyScheme() {
  const scheme = wa?.colorScheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.scheme = scheme;
  const c = CHROME[scheme] || CHROME.light;
  try {
    wa?.setHeaderColor?.(c.bg);
    wa?.setBackgroundColor?.(c.bg);
    wa?.setBottomBarColor?.(c.bar);
  } catch {
    /* старые клиенты */
  }
}

function onViewport() {
  if (!wa) return;
  const kb = wa.viewportStableHeight - wa.viewportHeight > 120;
  document.body.classList.toggle('keyboard', kb);
}

// В браузере: прячем панель вкладок, пока поле ввода в фокусе на узких экранах.
document.addEventListener('focusin', (e) => {
  if (e.target.matches?.('input, textarea') && innerWidth < 700) document.body.classList.add('keyboard');
});
document.addEventListener('focusout', () => setTimeout(() => {
  if (!document.activeElement?.matches?.('input, textarea')) document.body.classList.remove('keyboard');
}, 50));

export const initData = () => wa?.initData || '';
export const startParam = () => wa?.initDataUnsafe?.start_param || null;
export const tgUser = () => wa?.initDataUnsafe?.user || null;

export const haptic = (kind = 'light') => {
  try {
    wa?.HapticFeedback?.impactOccurred(kind);
  } catch {
    /* нет поддержки */
  }
};
export const selectionHaptic = () => {
  try {
    wa?.HapticFeedback?.selectionChanged();
  } catch {
    /* нет поддержки */
  }
};
export const notify = (kind = 'success') => {
  try {
    wa?.HapticFeedback?.notificationOccurred(kind);
  } catch {
    /* нет поддержки */
  }
};

// ---------- MainButton ----------
let mainHandler = null;
let fallbackBtn = null;

export function setMainButton(text, onClick) {
  hideMainButton();
  mainHandler = async () => {
    if (setMainButton.busy) return;
    setMainButton.busy = true;
    showProgress(true);
    try {
      await onClick();
    } finally {
      setMainButton.busy = false;
      showProgress(false);
    }
  };
  if (inTelegram && wa.MainButton) {
    wa.MainButton.setText(text);
    wa.MainButton.onClick(mainHandler);
    wa.MainButton.show();
    wa.MainButton.enable();
  } else {
    fallbackBtn = document.createElement('button');
    fallbackBtn.className = 'btn block fallback-main';
    fallbackBtn.textContent = text;
    fallbackBtn.addEventListener('click', mainHandler);
    document.body.appendChild(fallbackBtn);
    document.body.classList.add('has-fallback-main');
  }
}

export function setMainButtonText(text) {
  if (inTelegram && wa.MainButton) wa.MainButton.setText(text);
  else if (fallbackBtn) fallbackBtn.textContent = text;
}

function showProgress(on) {
  if (inTelegram && wa.MainButton) {
    if (on) wa.MainButton.showProgress(false);
    else wa.MainButton.hideProgress();
  } else if (fallbackBtn) {
    fallbackBtn.disabled = on;
  }
}

export function hideMainButton() {
  if (inTelegram && wa.MainButton) {
    if (mainHandler) wa.MainButton.offClick(mainHandler);
    wa.MainButton.hide();
  }
  if (fallbackBtn) {
    fallbackBtn.remove();
    fallbackBtn = null;
  }
  document.body.classList.remove('has-fallback-main');
  mainHandler = null;
}

// ---------- BackButton ----------
let backHandler = null;
export function setBack(visible, onClick) {
  if (!wa?.BackButton) return;
  if (backHandler) wa.BackButton.offClick(backHandler);
  backHandler = null;
  if (visible && inTelegram) {
    backHandler = onClick;
    wa.BackButton.onClick(onClick);
    wa.BackButton.show();
  } else {
    wa.BackButton.hide();
  }
}

// ---------- Диалоги ----------
export function confirmDialog(message) {
  return new Promise((resolve) => {
    if (inTelegram && wa.showConfirm) {
      notify('warning');
      wa.showConfirm(message, (ok) => resolve(!!ok));
    } else {
      resolve(window.confirm(message));
    }
  });
}

export function alertDialog(message) {
  return new Promise((resolve) => {
    if (inTelegram && wa.showAlert) wa.showAlert(message, () => resolve());
    else {
      window.alert(message);
      resolve();
    }
  });
}

export function openTgLink(url) {
  if (inTelegram && wa.openTelegramLink) wa.openTelegramLink(url);
  else window.open(url, '_blank');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------- CloudStorage ----------
export function cloudGet(key) {
  return new Promise((resolve) => {
    if (inTelegram && wa.CloudStorage) {
      wa.CloudStorage.getItem(key, (err, value) => resolve(err ? null : value || null));
    } else {
      try {
        resolve(localStorage.getItem(key));
      } catch {
        resolve(null);
      }
    }
  });
}

export function cloudSet(key, value) {
  if (inTelegram && wa.CloudStorage) {
    wa.CloudStorage.setItem(key, value, () => {});
  } else {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* приватный режим */
    }
  }
}
