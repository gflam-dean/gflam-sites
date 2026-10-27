#!/usr/bin/env python3
"""Make the key pair for help desk phone alerts (Web Push / VAPID), 19 Oct 2026.

Prints the three values to paste into the venueplay-api Worker as SECRETS:

    VAPID_PUBLIC_KEY    the public key, base64url (65 bytes uncompressed P-256)
    VAPID_PRIVATE_JWK   the private key as a JWK (the Worker imports and signs with it)
    VAPID_SUBJECT       mailto:hello@venueplay.com.au (who the push services contact)

Uses the openssl that ships with the Mac, so nothing to install. The private key is printed to
this terminal ONCE and written nowhere: paste it into Cloudflare and close the window. Run it
again only if you mean to replace the keys (every phone then has to tap "Alert me" again).

    python3 tools/make-vapid-keys.py
"""
import base64, json, re, subprocess, sys


def b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def main():
    pem = subprocess.run(['openssl', 'ecparam', '-name', 'prime256v1', '-genkey', '-noout'],
                         capture_output=True, check=True).stdout
    text = subprocess.run(['openssl', 'ec', '-text', '-noout'], input=pem,
                          capture_output=True, check=True).stdout.decode()
    def block(name):
        m = re.search(name + r':\s*\n((?:\s+[0-9a-f:]+\n)+)', text)
        if not m:
            sys.exit('openssl did not print a %s block; nothing was made.' % name)
        return bytes.fromhex(re.sub(r'[\s:]', '', m.group(1)))
    d = block('priv')
    pub = block('pub')
    d = d[-32:].rjust(32, b'\0')                 # openssl may add a leading zero byte
    if len(pub) != 65 or pub[0] != 4:
        sys.exit('unexpected public key shape (%d bytes); nothing was made.' % len(pub))
    jwk = {'kty': 'EC', 'crv': 'P-256', 'd': b64url(d), 'x': b64url(pub[1:33]), 'y': b64url(pub[33:65])}
    print('Paste each of these into Cloudflare > Workers > venueplay-api > Settings >')
    print('Variables and Secrets > Add > type SECRET. Name on the left, value on the right.\n')
    print('VAPID_PUBLIC_KEY   ' + b64url(pub))
    print('VAPID_PRIVATE_JWK  ' + json.dumps(jwk, separators=(',', ':')))
    print('VAPID_SUBJECT      mailto:hello@venueplay.com.au')
    print('\nThe private key is not saved anywhere. Close this window once it is pasted.')


if __name__ == '__main__':
    main()
