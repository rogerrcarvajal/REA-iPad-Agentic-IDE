<?php
/**
 * Shared helpers for the REA iPad Agentic IDE PHP bridge.
 */
declare(strict_types=1);

function rea_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }
    $defaults = [
        // Shared secret required by terminal.php. Empty string = PC terminal bridge disabled.
        'bridge_token' => '',
        // Commands executed by the bridge can only use a working directory inside this root.
        'bridge_root'  => dirname(__DIR__, 2),
        // Maximum seconds a bridged command may run.
        'bridge_timeout' => 180,
        // Local Ollama server reached by ollama-proxy.php.
        'ollama_url'   => 'http://127.0.0.1:11434',
    ];
    $local = __DIR__ . '/config.local.php';
    $config = is_file($local) ? array_merge($defaults, (array) require $local) : $defaults;
    return $config;
}

function rea_send_cors_headers(): void
{
    // The IDE is served from the same origin; this only enables the browser preflight.
    header('Access-Control-Allow-Origin: ' . ($_SERVER['HTTP_ORIGIN'] ?? '*'));
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type, Git-Protocol, Accept, X-Bridge-Token');
    header('Access-Control-Expose-Headers: Content-Type, WWW-Authenticate');
}

function rea_request_headers(): array
{
    if (function_exists('getallheaders')) {
        return getallheaders() ?: [];
    }
    $headers = [];
    foreach ($_SERVER as $key => $value) {
        if (str_starts_with($key, 'HTTP_')) {
            $headers[str_replace('_', '-', ucwords(strtolower(substr($key, 5)), '_'))] = $value;
        }
    }
    return $headers;
}

/** Case-insensitive single header lookup. */
function rea_header(string $name): string
{
    foreach (rea_request_headers() as $key => $value) {
        if (strcasecmp((string) $key, $name) === 0) {
            return (string) $value;
        }
    }
    return '';
}

function rea_json(int $status, array $payload): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function rea_json_error(int $status, string $message): never
{
    rea_json($status, ['ok' => false, 'error' => $message]);
}

/** True when the client IP is loopback or RFC1918 / link-local (LAN only). */
function rea_client_is_private(): bool
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if ($ip === '::1' || $ip === '127.0.0.1') {
        return true;
    }
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false
        && filter_var($ip, FILTER_VALIDATE_IP) !== false;
}
