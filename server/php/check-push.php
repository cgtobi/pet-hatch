<?php
/**
 * For server/php/push.test.ts only (never deployed): reads {"encrypt": {payload, uaPublic, auth, asPrivate,
 * asPublic, salt}} (base64url) on stdin and prints what webpush.php encrypts from it, base64url, as JSON. With
 * the fixed key and salt of RFC 8291's example, the result must be the RFC's.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit;
require __DIR__ . '/webpush.php';

$in = json_decode((string) stream_get_contents(STDIN), true)['encrypt'];
$d = fn(string $k) => b64url_decode($in[$k]);
$local = ['key' => openssl_pkey_get_private(p256_private_pem($d('asPrivate'), $d('asPublic'))), 'public' => $d('asPublic')];
echo json_encode(['encrypted' => b64url_encode(push_encrypt($d('payload'), $d('uaPublic'), $d('auth'), $local, $d('salt')))]);
