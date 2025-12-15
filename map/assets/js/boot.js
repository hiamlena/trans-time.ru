// assets/js/boot.js
// Точка входа для страницы карты Trans-Time.

import { toast } from './core.js'; // улучшено: используем toast для ошибок
import { init as initMap } from './map.js';
import { initUI } from './ui.js';
import { renderSavedRoutes } from './storage.js';

// Глобальное состояние via-точек (если кто-то ещё полагается на window.routes)
if (typeof window !== 'undefined') {
  // улучшено: не переопределяем объект, а дополняем его полями
  window.routes = window.routes || {};
  window.routes.viaPoints = window.routes.viaPoints || [];
  window.routes.viaMarkers = window.routes.viaMarkers || [];
}

let booted = false; // улучшено: защита от повторной инициализации

async function boot() {
  if (booted) {
    // уже инициализировано, повторно не трогаем
    return;
  }
  booted = true;

  try {
    // 1. Инициализируем карту и геолокацию
    await initMap();

    // 2. Запускаем UI (панель, кнопки, детали)
    initUI();

    // 3. Рендер избранных маршрутов (если модуль хранит их в storage/localStorage)
    if (typeof renderSavedRoutes === 'function') {
      renderSavedRoutes();
    }
  } catch (e) {
    console.error('[TT] boot failed:', e);
    try {
      // улучшено: даём пользователю явный фидбэк
      toast('Не удалось инициализировать карту. Попробуйте обновить страницу.', 5000);
    } catch (_) {
      // если toast по какой-то причине не доступен, просто молча игнорируем
    }
  }
}

boot();
