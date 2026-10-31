<?php
/**
 * REA iPad Agentic IDE — Same-origin Git Smart-HTTP proxy.
 *
 * Browsers cannot talk to github.com's git endpoints directly (no CORS headers).
 * isomorphic-git is configured with `corsProxy: '<base>/api/git-proxy.php'` and
 * requests URLs of the form:
 *     /api/git-proxy.php/github.com/<owner>/<repo>.git/info/refs?service=git-upload-pack
 *
 * Only a strict allow-list of public git hosts is forwarded (no open proxy).
 */
declare(strict_types=1);

require __DIR__ . '/_common.php';

const ALLOWED_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'];
const FORWARD_REQUEST_HEADERS = ['authorization', 'content-type', 'accept', 'git-protocol', 'user-agent'];
const FORWARD_RESPONSE_HEADERS = ['content-type', 'cache-control', 'www-authenticate', 'expires', 'pragma'];

rea_send_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$pathInfo = $_SERVER['PATH_INFO'] ?? '';
$pathInfo = ltrim($pathInfo, '/');
if ($pathInfo === '') {
    rea_json_error(400, 'Ruta vacía. Uso: git-proxy.php/github.com/<owner>/<repo>.git/...');
}

$host = strtolower(explode('/', $pathInfo, 2)[0]);
if (!in_array($host, ALLOWED_HOSTS, true)) {
    rea_json_error(403, "Host no permitido: {$host}");
}

// Only git smart-http endpoints are proxied.
if (!preg_match('#/(info/refs|git-upload-pack|git-receive-pack)$#', parse_url('/' . $pathInfo, PHP_URL_PATH) ?: '')) {
    rea_json_error(403, 'Solo se permiten endpoints Git Smart-HTTP.');
}

$query = $_SERVER['QUERY_STRING'] ?? '';
$target = 'https://' . $pathInfo . ($query !== '' ? '?' . $query : '');

$headers = [];
foreach (rea_request_headers() as $name => $value) {
    if (in_array(strtolower($name), FORWARD_REQUEST_HEADERS, true)) {
        $headers[] = "{$name}: {$value}";
    }
}
if (!array_filter($headers, fn($h) => stripos($h, 'user-agent:') === 0)) {
    $headers[] = 'User-Agent: git/isomorphic-git (REA-iPad-Agentic-IDE)';
}

$ch = curl_init($target);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST  => $_SERVER['REQUEST_METHOD'],
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 5,
    CURLOPT_CONNECTTIMEOUT => 20,
    CURLOPT_TIMEOUT        => 600,
    CURLOPT_HEADERFUNCTION => function ($ch, string $line): int {
        $len = strlen($line);
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
            http_response_code((int) $m[1]);
            return $len;
        }
        $parts = explode(':', $line, 2);
        if (count($parts) === 2 && in_array(strtolower(trim($parts[0])), FORWARD_RESPONSE_HEADERS, true)) {
            header(trim($parts[0]) . ': ' . trim($parts[1]), true);
        }
        return $len;
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
    rea_json_error(502, 'Error contactando el servidor Git: ' . curl_error($ch));
}
