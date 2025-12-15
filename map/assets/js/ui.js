// assets/js/ui.js
// Инициализация UI-панели Trans-Time.

import { $, $$ } from './core.js';
import { buildRouteWithState } from './router.js';

const hasDom = typeof document !== 'undefined';
const hasWindow = typeof window !== 'undefined';

/**
 * Универсальная утилита для UI-событий
 * (не ломает существующий функционал, просто добавляет крючки).
 */
function emit(name, detail = {}) {
  if (!hasWindow) return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Инициализация UI-панели Trans-Time.
 * Вызывается из boot.js: initUI();
 */
export function initUI() {
  if (!hasDom) return;

  // ─────────────────────────────────────────────
  // Сохранение состояния <details>
  // ─────────────────────────────────────────────

  const details = $$('.tt-details');

  details.forEach((el) => {
    const key = 'DETAILS_' + (el.id || 'unknown');

    try {
      const saved = localStorage.getItem(key);
      if (saved === 'true') el.setAttribute('open', '');
      if (saved === 'false') el.removeAttribute('open');

      el.addEventListener('toggle', () => {
        try {
          localStorage.setItem(key, String(el.open));
        } catch {}
      });
    } catch {}
  });

  // ─────────────────────────────────────────────
  // Подсветка выбранного ТС
  // ─────────────────────────────────────────────

  $$('input[name=veh]').forEach((radio) => {
    radio.addEventListener('change', () => {
      $$('.tt-chip').forEach((chip) => chip.classList.remove('active'));
      const parent = radio.parentElement;
      parent?.classList?.add('active');

      // хук на будущее: смена профиля ТС должна вызывать перерасчёт маршрута
      emit('tt_ui_vehicle_changed', { value: radio.value });
    });

    if (radio.checked) radio.parentElement?.classList?.add('active');
  });

  // ─────────────────────────────────────────────
  // Кнопка «Построить маршрут»
  // ─────────────────────────────────────────────

  const buildBtn = $('#buildBtn');
  const fromInput = $('#from');
  const toInput = $('#to');

  if (buildBtn) {
    buildBtn.addEventListener('click', (e) => {
      e.preventDefault();
      buildRouteWithState();
      emit('tt_ui_route_build');
    });
  }

  // ─────────────────────────────────────────────
  // Авто-включение кнопки
  // ─────────────────────────────────────────────

  function syncBuildBtnState() {
    if (!buildBtn) return;
    const hasFrom = !!(fromInput && fromInput.value.trim());
    const hasTo = !!(toInput && toInput.value.trim());
    buildBtn.disabled = !(hasFrom && hasTo);

    // хук: поля ввода изменились
    emit('tt_ui_input_changed', { from: fromInput?.value, to: toInput?.value });
  }

  function handleEnter(e) {
    if (e.key !== 'Enter') return;
    syncBuildBtnState();
    if (!buildBtn || buildBtn.disabled) return;
    buildRouteWithState();
    emit('tt_ui_route_build');
  }

  if (fromInput) {
    fromInput.addEventListener('input', syncBuildBtnState);
    fromInput.addEventListener('keyup', handleEnter);
  }

  if (toInput) {
    toInput.addEventListener('input', syncBuildBtnState);
    toInput.addEventListener('keyup', handleEnter);
  }

  syncBuildBtnState();

  // ─────────────────────────────────────────────
  // ✨ Новые UI-крючки на будущее
  // ─────────────────────────────────────────────

  // Включить режим редактирования маршрута мышью
  const editRouteBtn = $('#editRouteBtn');
  if (editRouteBtn) {
    editRouteBtn.addEventListener('click', () => {
      emit('tt_ui_edit_route');
    });
  }

  // Выбор альтернативного маршрута — Router будет подписан
  window.tt_select_route = function (index) {
    emit('tt_ui_select_route', { index });
  };

  // Тоггл рамок (если Router/Layers подписаны)
  const framesToggle = $('#toggle-frames');
  if (framesToggle) {
    framesToggle.addEventListener('change', () => {
      emit('tt_ui_toggle_frames', { enabled: framesToggle.checked });
    });
  }

  /**
   * Точка расширения для будущего UI (оставляем из твоего оригинала)
   */
}
