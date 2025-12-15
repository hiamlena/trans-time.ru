// assets/js/router.js
// Маршрутизация Trans-Time на основе Яндекс.Карт 2.1 (multiRouter.MultiRoute).
// Улучшено: добавлены UI-события, выбор альтернативного маршрута, хук редактирования маршрута.

import { $, toast } from './core.js';

const hasWindow = typeof window !== 'undefined';
const hasDom = typeof document !== 'undefined';

let multiRoute = null;

/* ------------------------------------------------------
   Получение карты
------------------------------------------------------ */
function getMap() {
  if (!hasWindow) return null;
  return window.map || (window.__TT_MAP && window.__TT_MAP.map) || null;
}

/* ------------------------------------------------------
   Frames-service
------------------------------------------------------ */
function getFramesService() {
  if (!hasWindow) return null;
  return window.__TT_FRAMES_SERVICE || null;
}

/* ------------------------------------------------------
   Режим "Легковой"
------------------------------------------------------ */
function isCarMode() {
  if (!hasDom) return false;
  const carRadio = document.querySelector('input[name=veh][value="car"]');
  return !!(carRadio && carRadio.checked);
}

/* ------------------------------------------------------
   Параметры ТС
------------------------------------------------------ */
function updateTruckParamsFromUI() {
  if (!hasDom || !hasWindow) return;

  const weightInput = $('#truckWeight');
  const heightInput = $('#truckHeight');
  const widthInput  = $('#truckWidth');
  const lengthInput = $('#truckLength');

  const params = {
    weight: Number(weightInput?.value) || 0,
    height: Number(heightInput?.value) || 0,
    width:  Number(widthInput?.value)  || 0,
    length: Number(lengthInput?.value) || 0
  };

  window.__TT_TRUCK_PARAMS = params;
  return params;
}

/* ------------------------------------------------------
   Reference points (from/via/to)
------------------------------------------------------ */
function getReferencePointsFromState() {
  if (!hasDom) return null;

  const fromInput = $('#from');
  const toInput   = $('#to');

  const from = fromInput?.value.trim() || '';
  const to   = toInput?.value.trim()   || '';

  if (!from || !to) return null;

  if (hasWindow) {
    window.routes = window.routes || {};
    window.routes.viaPoints  = window.routes.viaPoints  || [];
    window.routes.viaMarkers = window.routes.viaMarkers || [];
    window.routes.legacyWaypoints = [
      { request: from },
      { request: to }
    ];
  }

  const viaPoints = (hasWindow && window.routes && Array.isArray(window.routes.viaPoints))
    ? window.routes.viaPoints
    : [];

  return [from, ...viaPoints, to];
}

/* ------------------------------------------------------
   POSTROITЬ МАРШРУТ
------------------------------------------------------ */
export async function buildRouteWithState(options = {}) {
  const map = getMap();
  if (!map || typeof ymaps === 'undefined') {
    console.error('[TT][router] Карта недоступна');
    toast?.('Карта недоступна');
    return;
  }

  const fromInput = $('#from');
  const toInput   = $('#to');
  const buildBtn  = $('#buildBtn');

  const refPoints = getReferencePointsFromState();
  if (!refPoints) {
    fromInput && !fromInput.value.trim() && (fromInput.style.borderColor = '#ef4444');
    toInput   && !toInput.value.trim()   && (toInput.style.borderColor   = '#ef4444');
    toast?.('Заполните поля "Откуда" и "Куда"');
    return;
  }
  fromInput && (fromInput.style.borderColor = '');
  toInput   && (toInput.style.borderColor   = '');

  const truckParams = updateTruckParamsFromUI();

  let oldText = '';
  try {
    if (buildBtn) {
      oldText = buildBtn.textContent || '';
      buildBtn.disabled = true;
      buildBtn.textContent = 'Строим...';
    }

    console.log('[TT][router] Построение маршрута:', refPoints);

    if (multiRoute) {
      try { map.geoObjects.remove(multiRoute); } catch {}
      multiRoute = null;
    }

    const vehRadio = document.querySelector('input[name=veh]:checked');
    const vehMode = vehRadio ? vehRadio.value : 'truck40';

    const params = {
      results: options.results || 3,
      avoidTrafficJams: options.avoidTrafficJams !== false,
      routingMode: 'auto'
    };

    // Создаем MultiRoute
    multiRoute = new ymaps.multiRouter.MultiRoute(
      { referencePoints: refPoints, params },
      {
        boundsAutoApply: true,
        zoomMargin: 40,
        routeStrokeColor: '#4b5563',
        routeStrokeOpacity: 0.6,
        routeStrokeWidth: 4,
        routeActiveStrokeColor: '#4da3ff',
        routeActiveStrokeOpacity: 0.9,
        routeActiveStrokeWidth: 6
      }
    );

    if (hasWindow) {
      window.multiRoute = multiRoute;
      window.routes = window.routes || {};
      window.routes.vehMode = vehMode;
      window.__TT_TRUCK_PARAMS = truckParams;
    }

    // Обновление маршрута → рамки + альтернативы
    multiRoute.events.add('update', () => {
      refreshFramesForActiveRoute();
      renderRouteList();
      window.dispatchEvent(new CustomEvent('tt_router_route_updated'));
    });

    multiRoute.events.add('activeroutechange', () => {
      refreshFramesForActiveRoute();
      renderRouteList();
      window.dispatchEvent(new CustomEvent('tt_router_active_route_changed'));
    });

    map.geoObjects.add(multiRoute);

    // Уведомляем систему
    window.dispatchEvent(new CustomEvent('tt_router_built'));

  } catch (e) {
    console.error('[TT][router] Ошибка построения маршрута:', e);
    toast?.('Не удалось построить маршрут');
  } finally {
    if (buildBtn) {
      buildBtn.disabled = false;
      buildBtn.textContent = oldText || 'Построить маршрут';
    }
  }
}

/* ------------------------------------------------------
   UI → выбор альтернативного маршрута
------------------------------------------------------ */
if (hasWindow) {
  window.addEventListener('tt_ui_select_route', (ev) => {
    if (!multiRoute) return;
    const index = ev.detail?.index;
    try {
      const routes = multiRoute.getRoutes();
      if (!routes || !routes.getLength()) return;
      const route = routes.get(index);
      if (route) {
        multiRoute.setActiveRoute(route);
        renderRouteList();
      }
    } catch (e) {
      console.warn('Не удалось выбрать маршрут:', e);
    }
  });
}

/* ------------------------------------------------------
   Рендер альтернатив
------------------------------------------------------ */
function renderRouteList() {
  if (!hasDom) return;
  const container = $('#routeList');
  if (!container) return;

  container.innerHTML = '';

  if (!multiRoute) {
    container.textContent = 'Маршрут не построен';
    return;
  }

  const routes = multiRoute.getRoutes?.();
  if (!routes || typeof routes.getLength !== 'function') {
    container.textContent = 'Маршруты недоступны';
    return;
  }

  const len = routes.getLength();
  if (!len) {
    container.textContent = 'Маршруты не найдены';
    return;
  }

  const activeRoute = multiRoute.getActiveRoute?.();

  for (let i = 0; i < len; i++) {
    const route = routes.get(i);
    const props = route.properties;
    const distance = props.get('distance');
    const duration = props.get('durationInTraffic') || props.get('duration');
    const blocked  = props.get('blocked');

    const item = document.createElement('div');
    item.className = 'tt-route-item';
    if (activeRoute === route) item.classList.add('active');

    const title = document.createElement('div');
    title.className = 'tt-route-title';
    title.textContent = `Маршрут ${i + 1}` + (blocked ? ' (недоступен)' : '');

    const meta = document.createElement('div');
    meta.className = 'tt-route-meta';
    const parts = [];
    distance?.text && parts.push(distance.text);
    duration?.text && parts.push(duration.text);
    meta.textContent = parts.join(' • ');

    item.appendChild(title);
    item.appendChild(meta);

    item.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('tt_ui_select_route', { detail: { index: i } }));
    });

    container.appendChild(item);
  }
}

/* ------------------------------------------------------
   Работа с рамками
------------------------------------------------------ */
function normalizeCoordPair(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  let [x, y] = pair;
  if (Math.abs(x) <= 90 && Math.abs(y) > 90) [x, y] = [y, x];
  return [Number(x), Number(y)];
}

function normalizeBBox(rawBBox) {
  if (!Array.isArray(rawBBox) || rawBBox.length < 2) return null;
  const p1 = normalizeCoordPair(rawBBox[0]);
  const p2 = normalizeCoordPair(rawBBox[1]);
  if (!p1 || !p2) return null;
  const [lon1, lat1] = p1;
  const [lon2, lat2] = p2;
  return [
    [Math.min(lon1, lon2), Math.min(lat1, lat2)],
    [Math.max(lon1, lon2), Math.max(lat1, lat2)]
  ];
}

function collectRouteGeometryPoints(route) {
  const pts = [];
  try {
    route.getPaths?.().each((path) => {
      path.getSegments?.().each((segment) => {
        segment.getCoordinates?.()?.forEach((c) => Array.isArray(c) && pts.push(c));
      });
    });
  } catch {}
  return pts;
}

function bboxFromPoints(points, margin = 0.05) {
  if (!Array.isArray(points) || !points.length) return null;

  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;

  points.forEach((pt) => {
    const [lon, lat] = normalizeCoordPair(pt) || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  });

  return [
    [minLon - margin, minLat - margin],
    [maxLon + margin, maxLat + margin]
  ];
}

/* ------------------------------------------------------
   Обновление рамок
------------------------------------------------------ */
export function refreshFramesForActiveRoute(fallbackPoints) {
  if (isCarMode()) return;
  const framesToggle = $('#toggle-frames');
  if (!framesToggle?.checked) return;

  let bbox = null;
  let routePoints = null;

  const activeRoute = multiRoute?.getActiveRoute?.();
  if (activeRoute) {
    bbox = normalizeBBox(activeRoute.properties?.get?.('boundedBy'));
    if (!bbox) {
      routePoints = collectRouteGeometryPoints(activeRoute);
      bbox = bboxFromPoints(routePoints);
    }
  }

  if (!bbox && Array.isArray(fallbackPoints)) {
    routePoints = fallbackPoints;
    bbox = bboxFromPoints(fallbackPoints);
  }

  applyFramesBBox(bbox);

  const framesSvc = getFramesService();
  if (framesSvc && !isCarMode()) {
    try {
      if (!routePoints && activeRoute) {
        routePoints = collectRouteGeometryPoints(activeRoute);
      }
      const truckParams = window.__TT_TRUCK_PARAMS || {};
      const res = framesSvc.updateFramesForRoute(routePoints || [], truckParams);

      if (res?.criticalFrames?.length) {
        toast?.(`Внимание: найдено проблемных рамок: ${res.criticalFrames.length}`, 7000);
        console.log('[TT][router] Критичные рамки:', res.criticalFrames);
      }
    } catch (e) {
      console.warn('[TT][router] Ошибка frames-service:', e);
    }
  }
}

/* ------------------------------------------------------
   Применение BBOX к слою рамок
------------------------------------------------------ */
export function applyFramesBBox(bbox) {
  const api = window.__TT_LAYERS;
  api?.setFramesBBox?.(bbox);
}

/* ------------------------------------------------------
   UI → режим редактирования маршрута (готово для будущего)
------------------------------------------------------ */
if (hasWindow) {
  window.addEventListener('tt_ui_edit_route', () => {
    try {
      if (!multiRoute) return;
      multiRoute.editor?.start();
      toast?.('Редактирование маршрута: включено');
    } catch (e) {
      console.warn('Cannot enable route editor:', e);
    }
  });

  window.addEventListener('tt_ui_edit_route_stop', () => {
    try {
      multiRoute?.editor?.stop();
      toast?.('Редактирование маршрута завершено');
      refreshFramesForActiveRoute();
    } catch {}
  });
}
