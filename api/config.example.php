<?php
/**
 * Copy to config.local.php (git-ignored) and adjust.
 * Generate a token with:  php -r "echo bin2hex(random_bytes(24));"
 */
return [
    'bridge_token'   => '',                       // required to enable the PC terminal bridge
    'bridge_root'    => 'C:\\xampp\\htdocs',      // allowed working-directory root
    'bridge_timeout' => 180,
    'ollama_url'     => 'http://127.0.0.1:11434',
];
