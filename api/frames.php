<?php
// /api/frames.php
// Возвращает GeoJSON FeatureCollection из SQLite (frames.db)

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

try {
    $dbPath = __DIR__ . '/backend/frames.db';
    if (!file_exists($dbPath)) {
        http_response_code(500);
        echo json_encode([
            "error" => "frames.db not found",
            "path" => $dbPath
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $pdo = new PDO('sqlite:' . $dbPath, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);

    // только активные (как в Flask: only_active=1 по умолчанию)
    $stmt = $pdo->prepare("SELECT frame_id, lon, lat, road_id, road_name, clazz, object_type, hgv_access,
                                  weight_limit_tons, axle_load_tons, time_windows, tags, valid_from, valid_to, direction,
                                  source_type, source_name, priority, frame_row_id_raw, frame_url, frame_status_raw,
                                  frame_error_raw, frame_state, frame_first_seen, frame_last_seen, frame_is_active,
                                  frame_change_type, comment_raw, comment_human
                           FROM frames_raw
                           WHERE frame_is_active = 1");
    $stmt->execute();
    $rows = $stmt->fetchAll();

    $features = [];
    foreach ($rows as $r) {
        $lon = isset($r['lon']) ? (float)$r['lon'] : null;
        $lat = isset($r['lat']) ? (float)$r['lat'] : null;
        if (!$lon || !$lat) continue;

        // JSON поля из базы — безопасно распарсим
        $time_windows = [];
        if (!empty($r['time_windows'])) {
            $tw = json_decode($r['time_windows'], true);
            if (is_array($tw)) $time_windows = $tw;
        }

        $tags = [];
        if (!empty($r['tags'])) {
            $tg = json_decode($r['tags'], true);
            if (is_array($tg)) $tags = $tg;
        }

        $props = [
            "road_id" => $r['road_id'] ?? null,
            "road_name" => $r['road_name'] ?? null,
            "class" => $r['clazz'] ?? null,
            "object_type" => $r['object_type'] ?? "frame",
            "hgv_access" => $r['hgv_access'] ?? null,
            "weight_limit_tons" => $r['weight_limit_tons'] !== null ? (float)$r['weight_limit_tons'] : null,
            "axle_load_tons" => $r['axle_load_tons'] !== null ? (float)$r['axle_load_tons'] : null,
            "time_windows" => $time_windows,
            "valid_from" => $r['valid_from'] ?? null,
            "valid_to" => $r['valid_to'] ?? null,
            "direction" => $r['direction'] ?? null,
            "source_type" => $r['source_type'] ?? null,
            "source_name" => $r['source_name'] ?? null,
            "priority" => $r['priority'] !== null ? (int)$r['priority'] : null,
            "tags" => $tags,
            "frame_id" => $r['frame_id'] ?? null,
            "frame_row_id_raw" => $r['frame_row_id_raw'] ?? null,
            "frame_url" => $r['frame_url'] ?? null,
            "frame_status_raw" => $r['frame_status_raw'] ?? null,
            "frame_error_raw" => $r['frame_error_raw'] ?? null,
            "frame_state" => $r['frame_state'] ?? null,
            "frame_first_seen" => $r['frame_first_seen'] ?? null,
            "frame_last_seen" => $r['frame_last_seen'] ?? null,
            "frame_is_active" => !empty($r['frame_is_active']),
            "frame_change_type" => $r['frame_change_type'] ?? null,
            "comment_raw" => $r['comment_raw'] ?? "",
            "comment_human" => $r['comment_human'] ?? null
        ];

        $features[] = [
            "type" => "Feature",
            "id" => $r['frame_id'],
            "geometry" => [
                "type" => "Point",
                "coordinates" => [$lon, $lat]
            ],
            "properties" => $props
        ];
    }

    echo json_encode([
        "type" => "FeatureCollection",
        "features" => $features
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        "error" => "server_error",
        "message" => $e->getMessage()
    ], JSON_UNESCAPED_UNICODE);
}
