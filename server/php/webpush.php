<?php
/**
 * Web Push for push.php, with nothing but PHP's openssl and hash functions: message encryption (RFC 8291,
 * aes128gcm), the server's signed identity (VAPID, RFC 8292) and delivery to the browser's push service
 * (RFC 8030). Not meant to be opened on its own (it does nothing then).
 *
 * Keys are P-256 key pairs as raw bytes: the public key as the 65-byte uncompressed point (0x04, x, y), the
 * private one as its 32-byte number, the way browsers and npm run deploy hand them out.
 */

declare(strict_types=1);

/** Who may receive push messages from us: the push services of Chrome, Safari, Firefox and Edge. */
const PUSH_HOSTS = ['fcm.googleapis.com', 'push.apple.com', 'push.services.mozilla.com', 'notify.windows.com'];

function b64url_encode(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

/** Bytes from base64url (padding optional), or null if it isn't valid. */
function b64url_decode(string $text): ?string
{
    if (!preg_match('/^[A-Za-z0-9_-]*={0,2}$/', $text)) return null;
    $text = rtrim($text, '=');
    $bin = base64_decode(str_pad(strtr($text, '-_', '+/'), (int) ceil(strlen($text) / 4) * 4, '='), true);
    return $bin === false ? null : $bin;
}

/**
 * Whether a subscription's address is one of the known push services (or $testOrigin, for the tests), so
 * players can't make this server send requests anywhere else.
 */
function is_push_endpoint(string $endpoint, ?string $testOrigin = null): bool
{
    if (strlen($endpoint) > 1000) return false;
    if ($testOrigin && str_starts_with($endpoint, rtrim($testOrigin, '/') . '/')) return true;
    $url = parse_url($endpoint);
    if (($url['scheme'] ?? '') !== 'https' || isset($url['user']) || isset($url['port'])) return false;
    $host = strtolower($url['host'] ?? '');
    foreach (PUSH_HOSTS as $known) {
        if ($host === $known || str_ends_with($host, ".$known")) return true;
    }
    return false;
}

/** A raw public key (65 bytes) as PEM, for openssl. */
function p256_public_pem(string $public): string
{
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $public;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

/** A raw key pair (32-byte private number, 65-byte public point) as a PEM private key, for openssl. */
function p256_private_pem(string $private, string $public): string
{
    $der = hex2bin('30770201010420') . $private . hex2bin('a00a06082a8648ce3d030107a144034200') . $public;
    return "-----BEGIN EC PRIVATE KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END EC PRIVATE KEY-----\n";
}

/** A fresh key pair: ['key' => for openssl, 'public' => 65 raw bytes]. */
function p256_new_key(): array
{
    $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
    if ($key === false) throw new RuntimeException('Can’t make a P-256 key: ' . openssl_error_string());
    $ec = openssl_pkey_get_details($key)['ec'];
    $pad = fn(string $n) => str_pad($n, 32, "\0", STR_PAD_LEFT);
    return ['key' => $key, 'public' => "\x04" . $pad($ec['x']) . $pad($ec['y'])];
}

/**
 * Encrypt a message for one subscription (RFC 8291): $uaPublic and $authSecret are the subscription's p256dh
 * and auth keys. A fresh key pair and salt are made for every message; the tests pass the RFC's own instead.
 */
function push_encrypt(string $payload, string $uaPublic, string $authSecret, ?array $local = null, ?string $salt = null): string
{
    $local ??= p256_new_key();
    $salt ??= random_bytes(16);
    $peer = openssl_pkey_get_public(p256_public_pem($uaPublic));
    $ecdh = $peer === false ? false : openssl_pkey_derive($peer, $local['key'], 32);
    if ($ecdh === false) throw new RuntimeException('Not a valid subscription key.');
    // The key derivation of RFC 8291 §3.4, spelled out as HMACs (one-block HKDF).
    $prkKey = hash_hmac('sha256', $ecdh, $authSecret, true);
    $ikm = hash_hmac('sha256', "WebPush: info\0" . $uaPublic . $local['public'] . "\x01", $prkKey, true);
    $prk = hash_hmac('sha256', $ikm, $salt, true);
    $cek = substr(hash_hmac('sha256', "Content-Encoding: aes128gcm\0\x01", $prk, true), 0, 16);
    $nonce = substr(hash_hmac('sha256', "Content-Encoding: nonce\0\x01", $prk, true), 0, 12);
    $tag = '';
    // One record, ended by the 0x02 delimiter.
    $cipher = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '', 16);
    if ($cipher === false) throw new RuntimeException('Encryption failed.');
    return $salt . pack('N', 4096) . chr(65) . $local['public'] . $cipher . $tag;
}

/** An ECDSA signature from openssl (DER) as the 64 raw bytes (r, s) a JWT needs. */
function der_signature_to_raw(string $der): string
{
    $raw = '';
    $pos = 2;
    for ($i = 0; $i < 2; $i++) {
        $len = ord($der[$pos + 1]);
        $raw .= str_pad(ltrim(substr($der, $pos + 2, $len), "\0"), 32, "\0", STR_PAD_LEFT);
        $pos += 2 + $len;
    }
    return $raw;
}

/**
 * The Authorization header that tells the push service who sends (VAPID, RFC 8292): a JWT for the endpoint's
 * origin, valid for 12 hours, signed with our private key. $subject is how to reach us: our site's address.
 * @param array{public: string, private: string} $keys
 */
function vapid_header(string $endpoint, string $subject, array $keys, int $now): string
{
    $url = parse_url($endpoint);
    $aud = $url['scheme'] . '://' . $url['host'] . (isset($url['port']) ? ':' . $url['port'] : '');
    $data = b64url_encode('{"typ":"JWT","alg":"ES256"}') . '.'
        . b64url_encode(json_encode(['aud' => $aud, 'exp' => $now + 12 * 3600, 'sub' => $subject], JSON_UNESCAPED_SLASHES));
    if (!openssl_sign($data, $der, p256_private_pem($keys['private'], $keys['public']), OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('Can’t sign: ' . openssl_error_string());
    }
    return "vapid t=$data." . b64url_encode(der_signature_to_raw($der)) . ', k=' . b64url_encode($keys['public']);
}

/** POST one encrypted message to a push service; returns its HTTP status, or 0 if it couldn't be reached. */
function push_send(string $endpoint, string $body, array $headers): int
{
    $lines = [];
    foreach ($headers as $name => $value) $lines[] = "$name: $value";
    $lines[] = 'Content-Type: application/octet-stream';
    $lines[] = 'Content-Encoding: aes128gcm';
    if (function_exists('curl_init')) {
        $curl = curl_init($endpoint);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $lines,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        return $status;
    }
    $context = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => implode("\r\n", $lines),
        'content' => $body,
        'timeout' => 10,
        'ignore_errors' => true,
        'follow_location' => 0,
    ]]);
    $stream = @fopen($endpoint, 'r', false, $context);
    if ($stream === false) return 0;
    $status = preg_match('#^HTTP/\S+ (\d{3})#', stream_get_meta_data($stream)['wrapper_data'][0] ?? '', $m) ? (int) $m[1] : 0;
    fclose($stream);
    return $status;
}
