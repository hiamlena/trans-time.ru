// assets/js/map.js
// Инициализация карты Trans-Time на Яндекс.Картах 2.1.
// Работает как точка входа для boot.js:
//   import { init as initMap } from './map.js';
//   await initMap();

import { toast } from './core.js';

const hasWindow = typeof window !== 'undefined';
const hasDom = typeof document !== 'undefined';

let initPromise = null;   // защита от повторной инициализации
let mapInstance = null;   // текущий экземпляр карты

/**
 * Публичная точка входа.
 * boot.js вызывает: await init();
 */
export async function init() {
  if (initPromise) {
    return initPromise;
  }
  initPromise = doInit();
  return initPromise;
}

/**
 * Делает панель перетаскиваемой на десктопе и запоминает позицию.
 */
function makePanelDraggable(panel, handleSelector = '.tt-panel-header') {
  if (!hasWindow || !hasDom) return;

  // На тач-устройствах перетаскивание отключаем, чтобы не мешать скроллу
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    return;
  }

  const handle = handleSelector ? panel.querySelector(handleSelector) : panel;
  if (!handle) return;

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  function loadSavedPosition() {
    try {
      const raw = localStorage.getItem('TT_PANEL_POS');
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (pos && pos.left && pos.top) {
        panel.style.left = pos.left;
        panel.style.top = pos.top;
        panel.style.right = 'auto';
      }
    } catch (e) {
      console.warn('[TT][map] Не удалось прочитать позицию панели:', e);
    }
  }

  function savePosition() {
    try {
      const pos = {
        left: panel.style.left,
        top: panel.style.top
      };
      localStorage.setItem('TT_PANEL_POS', JSON.stringify(pos));
    } catch (e) {
      console.warn('[TT][map] Не удалось сохранить позицию панели:', e);
    }
  }

  loadSavedPosition();

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.button !== undefined) return; // только ЛКМ, но на тач button может быть undefined
    isDragging = true;

    const rect = panel.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;

    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
    panel.style.right = 'auto';

    handle.classList.add('dragging');
    if (handle.setPointerCapture && e.pointerId != null) {
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {}
    }
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let left = startLeft + dx;
    let top = startTop + dy;

    const maxLeft = window.innerWidth - panel.offsetWidth - 8;
    const maxTop = window.innerHeight - panel.offsetHeight - 8;

    if (left < 8) left = 8;
    if (top < 8) top = 8;
    if (left > maxLeft) left = maxLeft;
    if (top > maxTop) top = maxTop;

    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  };

  const endDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;
    handle.classList.remove('dragging');
    if (handle.releasePointerCapture && e && e.pointerId != null) {
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {}
    }
    savePosition();
  };

  handle.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

/**
 * Основная логика инициализации карты.
 */
async function doInit() {
  if (!hasDom) {
    throw new Error('[TT][map] DOM недоступен, карта не может быть инициализирована');
  }

  const container = document.getElementById('map');
  if (!container) {
    throw new Error('[TT][map] Не найден контейнер #map');
  }

  // 1. Загружаем API Яндекс.Карт при необходимости
  await ensureYmapsLoaded();

  // 2. Ждём готовности API
  await new Promise((resolve, reject) => {
    try {
      ymaps.ready(resolve);
    } catch (e) {
      reject(e);
    }
  });

  // 3. Определяем центр и зум из конфигурации (если есть)
  let center = [37.62, 55.75]; // Москва, [долгота, широта] по умолчанию
  let zoom = 10;

  try {
    if (hasWindow && window.TT_CONFIG && window.TT_CONFIG.map) {
      const cfg = window.TT_CONFIG.map;
      if (Array.isArray(cfg.defaultCenter) && cfg.defaultCenter.length === 2) {
        center = cfg.defaultCenter;
      }
      if (typeof cfg.defaultZoom === 'number') {
        zoom = cfg.defaultZoom;
      }
    }
  } catch (e) {
    console.warn('[TT][map] Не удалось прочитать TT_CONFIG.map:', e);
  }

  // 4. Создаём карту
  mapInstance = new ymaps.Map('map', {
    center,
    zoom,
    controls: ['zoomControl']
  });

  // 5. Пробрасываем карту в глобалы для других модулей
  if (hasWindow) {
    window.map = mapInstance;
    window.__TT_MAP = window.__TT_MAP || {};
    window.__TT_MAP.map = mapInstance;
  }

  // 6. Включаем пробки (если доступны)
  try {
    const trafficControl = new ymaps.control.TrafficControl({
      state: { trafficShown: true }
    });
    mapInstance.controls.add(trafficControl);
  } catch (e) {
    console.warn('[TT][map] Пробки недоступны:', e);
  }

  // 7. Попытка центрировать карту по геолокации пользователя (не критично)
  try {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lon = pos.coords.longitude;
          const lat = pos.coords.latitude;
          mapInstance.setCenter([lon, lat], 11, { duration: 300 });
        },
        () => {
          // отказ/ошибка — просто оставляем дефолтный центр
        },
        { enableHighAccuracy: false, timeout: 5000 }
      );
    }
  } catch (_) {
    // геолокация не обязательна
  }

  // 8. Подключаем слои (рамки, HGV-дороги и т.п.)
  try {
    await import('./layers.js');
  } catch (e) {
    console.error('[TT][map] Ошибка загрузки слоёв (layers.js):', e);
  }

  // 9. Инициализируем подсказки SuggestView, если модуль доступен
  initSuggestIfPossible();

  // 10. Инициализация frames-service (анализ рамок)
  try {
    // ?v=2 — пробиваем кэш старой версии модуля
    const { initFramesService } = await import('./frames-service.js?v=2');
    const svc = await initFramesService(mapInstance);
    if (hasWindow) {
      window.__TT_FRAMES_SERVICE = svc;
      console.log('[TT][map] frames-service инициализирован');
    }
  } catch (e) {
    console.warn('[TT][map] frames-service недоступен или упал при инициализации:', e);
  }

  // 11. Показываем карту и панель, прячем лоадер
  try {
    container.style.display = 'block';

    const panel = document.querySelector('.tt-panel');
    if (panel) {
      panel.style.display = 'block';
      makePanelDraggable(panel);
    }

    const loader = document.getElementById('loader');
    if (loader) {
      loader.style.display = 'none';
    }
  } catch (_) {
    // косметика, не критично
  }

  console.log('[TT][map] Карта инициализирована');

  // 12. Сигнал остальным модулям, что карта готова
  if (hasWindow) {
    try {
      window.dispatchEvent(new CustomEvent('tt_map_ready', { detail: { map: mapInstance } }));
    } catch (e) {
      console.warn('[TT][map] Не удалось отправить событие tt_map_ready:', e);
    }
  }

  return mapInstance;
}

/**
 * Гарантировать, что скрипт API Яндекс.Карт загружен.
 * Использует глобальный промис, чтобы не плодить скрипты.
 */
function ensureYmapsLoaded() {
  if (!hasWindow || !hasDom) {
    throw new Error('[TT][map] Окружение без window/document');
  }

  // API уже есть
  if (typeof ymaps !== 'undefined' && ymaps.ready) {
    return Promise.resolve();
  }

  // Уже идёт загрузка
  if (window.__YMAP_LOADING_PROMISE__) {
    return window.__YMAP_LOADING_PROMISE__;
  }

  const script = document.createElement('script');

  // Пытаемся взять ключ из TRANSTIME_CONFIG, иначе используем дефолтный
  let apiKey = '317aa42d-aa15-4acf-885a-6d6bfddb2339';
  try {
    if (hasWindow && window.TRANSTIME_CONFIG && window.TRANSTIME_CONFIG.yandex && window.TRANSTIME_CONFIG.yandex.apiKey) {
      apiKey = window.TRANSTIME_CONFIG.yandex.apiKey;
    }
  } catch (e) {
    console.warn('[TT][map] Не удалось прочитать TRANSTIME_CONFIG.yandex.apiKey:', e);
  }

  script.src =
    `https://api-maps.yandex.ru/2.1/?apikey=${apiKey}` +
    `&suggest_apikey=${apiKey}` +
    `&lang=ru_RU&coordorder=longlat&load=package.full,SuggestView`;
  script.async = true;

  const promise = new Promise((resolve, reject) => {
    script.onload = () => {
      console.log('[TT][map] API Яндекс-Карт загружено');
      resolve();
    };
    script.onerror = (err) => {
      console.error('[TT][map] Ошибка загрузки API Яндекс-Карт:', err);
      try {
        toast('Не удалось загрузить карту. Проверьте интернет или блокировщики.', 6000);
      } catch (_) {}
      reject(new Error('Не удалось загрузить API Яндекс-Карт'));
    };
  });

  window.__YMAP_LOADING_PROMISE__ = promise;
  document.head.appendChild(script);
  return promise;
}

/**
 * Инициализировать SuggestView для полей #from и #to,
 * если модуль доступен в API.
 */
function initSuggestIfPossible() {
  if (!hasDom || typeof ymaps === 'undefined') return;

  const fromInput = document.getElementById('from');
  const toInput   = document.getElementById('to');

  if (!fromInput || !toInput) {
    return;
  }

  if (typeof ymaps.SuggestView === 'undefined') {
    console.warn('[TT][map] SuggestView недоступен. Возможен FeatureRemovedError от Яндекса.');
    return;
  }

  try {
    const suggestFrom = new ymaps.SuggestView('from', { results: 8 });
    const suggestTo   = new ymaps.SuggestView('to',   { results: 8 });

    function bindSelect(sv, input) {
      if (!sv || !input) return;
      sv.events.add('select', (e) => {
        const item = e.get('item');
        if (item && item.value) {
          input.value = item.value;
          // триггерим input, чтобы UI успел включить кнопку "Построить маршрут"
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }

    bindSelect(suggestFrom, fromInput);
    bindSelect(suggestTo, toInput);

    console.log('[TT][map] SuggestView инициализирован для полей #from/#to');
  } catch (e) {
    console.error('[TT][map] Ошибка инициализации SuggestView:', e);
  }
}

/**
 * Необязательный экспорт — получить карту без обращения к window.
 */
export function getMapInstance() {
  return mapInstance;
}
