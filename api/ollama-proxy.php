<?php
/**
 * REA iPad Agentic IDE — Ollama proxy.
 * Lets the iPad reach the Ollama server running on the PC (127.0.0.1:11434)
 * without exposing Ollama on the LAN or configuring OLLAMA_ORIGINS.
 *   GET  ollama-proxy.php/api/tags
 *   POST ollama-proxy.php/api/chat   (streams NDJSON)
 */
declare(strict_types=1);

require __DIR__ . '/_common.php';

rea_send_cors_headers();
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (!rea_client_is_private()) {
    rea_json_error(403, 'Solo red local.');
}

$path = $_SERVER['PATH_INFO'] ?? '';
if (!in_array($path, ['/api/tags', '/api/chat', '/api/generate', '/api/version'], true)) {
    rea_json_error(404, "Endpoint no permitido: {$path}");
}

$target = rtrim(rea_config()['ollama_url'], '/') . $path;

@ini_set('zlib.output_compression', '0');
@ini_set('output_buffering', '0');
while (ob_get_level() > 0) {
    ob_end_flush();
}

$ch = curl_init($target);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST  => $_SERVER['REQUEST_METHOD'],
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT        => 900,
    CURLOPT_HEADERFUNCTION => function ($ch, string $line): int {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
            http_response_code((int) $m[1]);
        } elseif (stripos($line, 'content-type:') === 0) {
            header(trim($line));
        }
        return strlen($line);
    },
    CURLOPT_WRITEFUNCTION  => function ($ch, string $chunk): int {
        echo $chunk;
        @flush();
        return strlen($chunk);
    },
]);
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
}
if (curl_exec($ch) === false) {
    rea_json_error(502, 'Ollama no responde en ' . rea_config()['ollama_url'] . ': ' . curl_error($ch));
}
