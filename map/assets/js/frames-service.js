// assets/js/frames-service.js
// Работа с весовыми рамками и HGV-слоями.
// Не ломает существующую архитектуру, предполагается вызов из других модулей.
// Пример использования:
//   import { initFramesService } from './frames-service.js';
//   const framesSvc = await initFramesService(map);
//   const result = framesSvc.updateFramesForRoute(routeCoords, currentTruckParams);
//   // result.criticalFrames -> список проблемных/подозрительных рамок для UI

const HAS_WINDOW = typeof window !== 'undefined';
const HAS_DOC = typeof document !== 'undefined';

function hasYmaps() {
  return typeof ymaps !== 'undefined';
}

// Кэш для загрузки GeoJSON
const _geojsonCache = new Map();

/**
 * Однократная загрузка GeoJSON по URL.
 */
async function loadGeoJSONOnce(url) {
  if (!url) return null;
  if (_geojsonCache.has(url)) {
    return _geojsonCache.get(url);
  }

  const promise = fetch(url, { cache: 'no-cache' })
    .then((res) => {
      if (!res.ok) {
        console.warn('[TT][frames-service] Не удалось загрузить GeoJSON:', url, res.status);
        return null;
      }
      return res.json();
    })
    .catch((e) => {
      console.warn('[TT][frames-service] Ошибка сети при загрузке GeoJSON:', url, e);
      return null;
    });

  _geojsonCache.set(url, promise);
  return promise;
}

/**
 * Нормализация пары координат (lon, lat).
 */
function normalizeCoordPair(pair) {
  if (!pair || !Array.isArray(pair) || pair.length < 2) return null;
  const lon = Number(pair[0]);
  const lat = Number(pair[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

/**
 * Подготовка bbox с "коридором" вокруг маршрута.
 * routePoints — массив [lon, lat].
 */
function bboxFromRoutePointsWithPadding(routePoints, paddingKm = 5) {
  if (!Array.isArray(routePoints) || !routePoints.length) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  routePoints.forEach((pt) => {
    const pair = normalizeCoordPair(pt);
    if (!pair) return;
    const [lon, lat] = pair;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  });

  if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) {
    return null;
  }

  // Грубая оценка: 1 градус широты ~111 км, долготы ~111 * cos(lat)
  const latCenter = (minLat + maxLat) / 2;
  const kmPerDegLat = 111;
  const kmPerDegLon = 111 * Math.cos((latCenter * Math.PI) / 180);

  const dLat = paddingKm / kmPerDegLat;
  const dLon = paddingKm / (kmPerDegLon || 1e-6);

  return {
    minLon: minLon - dLon,
    maxLon: maxLon + dLon,
    minLat: minLat - dLat,
    maxLat: maxLat + dLat
  };
}

/**
 * Проверка попадания точки в bbox-объект {minLon, maxLon, minLat, maxLat}.
 */
function isPointInBBoxObject(coords, bboxObj) {
  if (!bboxObj) return true;
  const pair = normalizeCoordPair(coords);
  if (!pair) return false;
  const [lon, lat] = pair;
  const { minLon, maxLon, minLat, maxLat } = bboxObj;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

/**
 * Инициализация сервиса рамок.
 *
 * options:
 *   framesUrl      — источник рамок (по умолчанию /api/frames)
 *   roadsUrl       — источник дорог (пока не используем, зарезервировано)
 *   hgvAllowedUrl  — HGV-разрешённые (зарезервировано)
 *   hgvConditionalUrl — условно разрешённые (зарезервировано)
 */
export async function initFramesService(map, options = {}) {
  const state = {
    map: null,
    framesData: null
  };

  if (!HAS_DOC || !HAS_WINDOW) {
    console.warn('[TT][frames-service] Нет window/DOM, сервис рамок будет пустым');
    return {
      state,
      updateFramesForRoute: () => ({
        state,
        bbox: null,
        frames: [],
        criticalFrames: []
      })
    };
  }

  state.map = map || null;

  const {
    framesUrl = '/api/frames',
    roadsUrl = null,
    hgvAllowedUrl = null,
    hgvConditionalUrl = null
  } = options || {};

  try {
    const framesData = await loadGeoJSONOnce(framesUrl);
    state.framesData = framesData && framesData.features ? framesData : { type: 'FeatureCollection', features: [] };
  } catch (e) {
    console.warn('[TT][frames-service] Ошибка при загрузке рамок:', e);
    state.framesData = { type: 'FeatureCollection', features: [] };
  }

  /**
   * Основная функция:
   *   - принимает маршрут в виде массива точек [lon, lat];
   *   - считает bbox-коридор;
   *   - выделяет рамки в этом коридоре;
   *   - возвращает:
   *       { state, bbox, frames, criticalFrames }.
   *
   * Для начала все рамки в коридоре считаем "критичными" — потом можно доработать
   * логику с учётом параметров truckParams.
   */
  function updateFramesForRoute(routePoints, truckParams = {}) {
    const framesData = state.framesData;
    if (!framesData || !Array.isArray(framesData.features) || !routePoints || !routePoints.length) {
      return {
        state,
        bbox: null,
        frames: [],
        criticalFrames: []
      };
    }

    const bboxObj = bboxFromRoutePointsWithPadding(routePoints, 5);
    if (!bboxObj) {
      return {
        state,
        bbox: null,
        frames: [],
        criticalFrames: []
      };
    }

    const framesInCorridor = framesData.features.filter((f) => {
      if (!f || !f.geometry || f.geometry.type !== 'Point') return false;
      return isPointInBBoxObject(f.geometry.coordinates, bboxObj);
    });

    // На этом этапе просто считаем все рамки в коридоре "критичными"
    const criticalFrames = framesInCorridor.slice();

    const bbox = [
      [bboxObj.minLon, bboxObj.minLat],
      [bboxObj.maxLon, bboxObj.maxLat]
    ];

    return {
      state,
      bbox,
      frames: framesInCorridor,
      criticalFrames
    };
  }

  console.log('[TT][frames-service] Сервис рамок инициализирован, источник:', '/api/frames');

  return {
    state,
    updateFramesForRoute
  };
}
