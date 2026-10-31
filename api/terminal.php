<?php
/**
 * REA iPad Agentic IDE — PC terminal bridge (RF4).
 *
 * Runs a single non-interactive shell command on the PC that hosts XAMPP and returns
 * stdout/stderr. Lets the iPad drive real CLIs (git, npm, gemini -p "...", ollama run ...).
 *
 * Security:
 *   - Disabled unless `bridge_token` is set in api/config.local.php.
 *   - Requires header X-Bridge-Token matching that secret (constant-time compare).
 *   - Only accepts clients from loopback / private LAN addresses.
 *   - Working directory is confined to `bridge_root`.
 */
declare(strict_types=1);

require __DIR__ . '/_common.php';

rea_send_cors_headers();
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$config = rea_config();

if ($config['bridge_token'] === '') {
    rea_json_error(503, 'Puente de terminal deshabilitado: define bridge_token en api/config.local.php');
}
if (!rea_client_is_private()) {
    rea_json_error(403, 'El puente de terminal solo acepta clientes de la red local.');
}
$given = rea_header('X-Bridge-Token');
if (!hash_equals($config['bridge_token'], $given)) {
    rea_json_error(401, 'Token del puente inválido.');
}

$root = realpath($config['bridge_root']);
if ($root === false) {
    rea_json_error(500, 'bridge_root no existe en el servidor.');
}

$input = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
$action = $input['action'] ?? 'exec';

if ($action === 'ping') {
    rea_json(200, ['ok' => true, 'root' => $root, 'os' => PHP_OS_FAMILY, 'cwd' => $root]);
}

$command = trim((string) ($input['command'] ?? ''));
$cwdIn = (string) ($input['cwd'] ?? $root);
if ($command === '') {
    rea_json_error(400, 'Comando vacío.');
}

// Resolve cwd and keep it inside the allowed root.
$cwd = realpath($cwdIn) ?: realpath($root . DIRECTORY_SEPARATOR . $cwdIn);
if ($cwd === false || !str_starts_with(strtolower($cwd), strtolower($root))) {
    rea_json_error(400, "Directorio fuera de bridge_root: {$cwdIn}");
}

// Built-in `cd` so the terminal can navigate between calls.
if (preg_match('/^cd(?:\s+(.+))?$/i', $command, $m)) {
    $target = trim($m[1] ?? '', " \"'");
    $next = $target === '' ? $root : (realpath($cwd . DIRECTORY_SEPARATOR . $target) ?: realpath($target));
    if ($next === false || !is_dir($next) || !str_starts_with(strtolower($next), strtolower($root))) {
        rea_json(200, ['ok' => false, 'cwd' => $cwd, 'stdout' => '', 'stderr' => "cd: no permitido o inexistente: {$target}\n", 'code' => 1]);
    }
    rea_json(200, ['ok' => true, 'cwd' => $next, 'stdout' => '', 'stderr' => '', 'code' => 0]);
}

$isWindows = PHP_OS_FAMILY === 'Windows';
$shellCmd = $isWindows ? ['cmd.exe', '/d', '/s', '/c', $command] : ['/bin/sh', '-lc', $command];

$env = getenv();
$env['NO_COLOR'] = '1';
$env['FORCE_COLOR'] = '0';
$env['TERM'] = 'dumb';
$env['GIT_TERMINAL_PROMPT'] = '0';

$proc = proc_open($shellCmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $cwd, $env, ['bypass_shell' => true]);
if (!is_resource($proc)) {
    rea_json_error(500, 'No se pudo iniciar el proceso.');
}

if (isset($input['stdin']) && is_string($input['stdin'])) {
    fwrite($pipes[0], $input['stdin']);
}
fclose($pipes[0]);
stream_set_blocking($pipes[1], false);
stream_set_blocking($pipes[2], false);

$stdout = '';
$stderr = '';
$deadline = microtime(true) + (int) $config['bridge_timeout'];
$timedOut = false;
while (true) {
    $stdout .= stream_get_contents($pipes[1]);
    $stderr .= stream_get_contents($pipes[2]);
    $status = proc_get_status($proc);
    if (!$status['running']) {
        break;
    }
    if (microtime(true) > $deadline) {
        $timedOut = true;
        if ($isWindows) {
            exec('taskkill /F /T /PID ' . (int) $status['pid']);
        } else {
            proc_terminate($proc, 9);
        }
        break;
    }
    usleep(50_000);
}
$stdout .= stream_get_contents($pipes[1]);
$stderr .= stream_get_contents($pipes[2]);
fclose($pipes[1]);
fclose($pipes[2]);
$code = proc_close($proc);
if (isset($status) && !$status['running'] && $status['exitcode'] >= 0) {
    $code = $status['exitcode'];
}

$toUtf8 = static function (string $s): string {
    return mb_check_encoding($s, 'UTF-8') ? $s : mb_convert_encoding($s, 'UTF-8', 'Windows-1252');
};

rea_json(200, [
    'ok'       => $code === 0 && !$timedOut,
    'cwd'      => $cwd,
    'code'     => $code,
    'timedOut' => $timedOut,
    'stdout'   => $toUtf8($stdout),
    'stderr'   => $toUtf8($stderr) . ($timedOut ? "\n[timeout tras {$config['bridge_timeout']}s]\n" : ''),
]);
