// assets/js/layers.js
// Модуль слоёв Trans-Time.
// Отвечает за:
//  - загрузку и отображение весовых рамок из GeoJSON;
//  - фильтрацию рамок по bbox маршрута;
//  - безопасный API для router.js / map.js через window.__TT_LAYERS.
//
// ВАЖНО: если что-то пойдёт не так (нет ymaps, нет карты, нет ответа /api/frames),
//        модуль тихо логирует ошибку и НЕ ломает карту.

const HAS_WINDOW = typeof window !== 'undefined';
const HAS_DOM = typeof document !== 'undefined';

if (HAS_WINDOW) {
  // Единая точка для всех слоёв карты
  window.__TT_LAYERS = window.__TT_LAYERS || {};
}

let framesManager = null;
let framesVisible = true;
let framesBBox = null;
let framesData = null;
let framesLoadingPromise = null;

/**
 * Безопасно получить карту из глобалов.
 */
function getMap() {
  if (!HAS_WINDOW) return null;
  return (window.__TT_MAP && window.__TT_MAP.map) || window.map || null;
}

/**
 * Проверка готовности ymaps.
 */
function hasYmaps() {
  return typeof ymaps !== 'undefined';
}

/**
 * Проверяем, что точка попадает в bbox.
 * bbox: [[minLon, minLat], [maxLon, maxLat]]
 */
function isPointInBBox(coords, bbox) {
  if (!bbox || !Array.isArray(coords)) return true;
  const [[minLon, minLat], [maxLon, maxLat]] = bbox;
  const lon = coords[0];
  const lat = coords[1];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

/**
 * Ленивая загрузка GeoJSON с рамками из backend API.
 * Источник: /api/frames (FeatureCollection).
 */
async function loadFramesGeoJSON() {
  if (framesLoadingPromise) {
    return framesLoadingPromise;
  }

  const url = '/api/frames';

  framesLoadingPromise = fetch(url, { cache: 'no-cache' })
    .then((res) => {
      if (!res.ok) {
        console.warn('[TT][layers] Не удалось загрузить /api/frames:', res.status);
        return null;
      }
      return res.json();
    })
    .then((data) => {
      if (!data || data.type !== 'FeatureCollection') {
        console.warn('[TT][layers] Некорректный формат ответа /api/frames');
        return null;
      }
      framesData = data;
      return data;
    })
    .catch((e) => {
      console.warn('[TT][layers] Ошибка сети при загрузке /api/frames:', e);
      return null;
    });

  return framesLoadingPromise;
}

/**
 * Инициализация ObjectManager для рамок и привязка к карте.
 */
function ensureFramesManager() {
  const map = getMap();
  if (!map || !hasYmaps()) return null;

  if (!framesManager) {
    framesManager = new ymaps.ObjectManager({
      clusterize: true,
      gridSize: 64,
      clusterDisableClickZoom: false
    });

    framesManager.options.set('geoObjectOpenBalloonOnClick', true);
    framesManager.objects.options.set('preset', 'islands#orangeDotIcon');

    if (framesData && Array.isArray(framesData.features)) {
      framesManager.add(framesData.features);
    }
  }

  if (framesVisible) {
    if (!map.geoObjects.contains(framesManager)) {
      map.geoObjects.add(framesManager);
    }
  } else {
    if (map.geoObjects.contains(framesManager)) {
      map.geoObjects.remove(framesManager);
    }
  }

  return framesManager;
}

/**
 * Внутренняя установка bbox для слоя рамок.
 */
async function internalSetFramesBBox(bbox) {
  framesBBox = bbox || null;

  const map = getMap();
  if (!map || !hasYmaps()) {
    console.warn('[TT][layers] Нет карты или ymaps, пропускаем setFramesBBox');
    return;
  }

  // Ждём загрузку данных
  const data = framesData || (await loadFramesGeoJSON());
  if (!data || !Array.isArray(data.features)) {
    console.warn('[TT][layers] Нет данных рамок, setFramesBBox ничего не делает');
    return;
  }

  const manager = ensureFramesManager();
  if (!manager) return;

  // Фильтр по bbox и видимости
  manager.setFilter((obj) => {
    if (!framesVisible) return false;
    const g = obj && obj.geometry;
    if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return false;
    if (!framesBBox) return true;
    return isPointInBBox(g.coordinates, framesBBox);
  });
}

/**
 * Получить список рамок в заданном bbox (для отладочного / аналитического UI).
 */
function getFramesInBBox(bbox) {
  if (!framesData || !Array.isArray(framesData.features)) return [];
  if (!bbox) return framesData.features.slice();

  return framesData.features.filter((f) => {
    const g = f.geometry;
    if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return false;
    return isPointInBBox(g.coordinates, bbox);
  });
}

/**
 * Публичный API для window.__TT_LAYERS.
 */
if (HAS_WINDOW) {
  const api = (window.__TT_LAYERS = window.__TT_LAYERS || {});

  if (typeof api.setFramesBBox !== 'function') {
    api.setFramesBBox = function setFramesBBox(bbox) {
      internalSetFramesBBox(bbox).catch((e) => {
        console.warn('[TT][layers] Ошибка setFramesBBox:', e);
      });
    };
  }

  if (typeof api.setFramesVisible !== 'function') {
    api.setFramesVisible = function setFramesVisible(visible) {
      framesVisible = !!visible;
      // переустанавливаем текущий bbox, чтобы перерисовать слой
      internalSetFramesBBox(framesBBox).catch((e) => {
        console.warn('[TT][layers] Ошибка setFramesVisible:', e);
      });
    };
  }

  if (typeof api.getFramesInBBox !== 'function') {
    api.getFramesInBBox = function apiGetFramesInBBox(bbox) {
      return getFramesInBBox(bbox);
    };
  }

  console.log('[TT][layers] Модуль слоёв загружен (источник: /api/frames)');
}

// Экспортируем пустой объект, чтобы модуль был валидным ES-модулем.
export {};
