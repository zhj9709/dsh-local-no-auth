[English](README.md) | [中文](README.zh.md)

# dsh-local-no-auth

A DSH plugin that removes the `?token=` launch gate for **local-only** Web GUI deployments and
makes the printed / auto-opened startup URL a clean `http://127.0.0.1:3080/`.

It overrides just two methods of `BrowserAuth` in `dsh-client-connection` (at the prototype level):

| Method | After the override |
| --- | --- |
| `isAuthenticated` | Always `true` when the request's Host header is a loopback name (`127.0.0.1` / `localhost` / `[::1]`); otherwise falls back to the stock cookie check |
| `authenticatedUrl` | Only normalizes the URL; no longer appends `?token=` |

## Two safety gates

1. **Bind check**: when `webServer.host` is not `127.0.0.1` (i.e. an all-interfaces bind), the
   plugin stays completely inert — it only logs a warning and the stock authentication remains
   in force.
2. **Host check**: even on a loopback bind, non-loopback Host headers (forged Host / DNS
   rebinding) never get the bypass.

The connection's own Host/Origin fence (`isTrustedApiRequest`, which answers 403 for untrusted
Host headers on `/api`) is left untouched. Launch URLs that still carry a token keep working
(the token branch of `authorizeIndex` is preserved).

This only makes sense for loopback deployments, where any process that can reach the port could
read `~/.dsh` anyway. The dsh 0.1.5-rc.1 CLI refuses `--host 0.0.0.0` outright, so gate 1 is a
second line of defense in case the host is changed at the profile-config layer instead.

## Install

```bash
# From the GitHub repository
dsh plugin --profile web add github:zhj9709/dsh-local-no-auth
# From a local tarball (npm pack output)
dsh plugin --profile web add D:/path/to/dsh-local-no-auth-0.1.0.tgz
# Or from npm once published
dsh plugin --profile web add dsh-local-no-auth
```

The `add` step pnpm-installs the package **and automatically writes `"dsh-local-no-auth"` into
the `dsh.profile.bundles` list** of `profiles/web/package.json`. Double-check that the bundles
list actually contains it; add the line manually if not.

Takes effect on the next `dsh web` start — and, on a running server whose profile uses
`patchReload: "live"`, immediately via hot reload.

## Verify

```bash
dsh web --dump-config | grep -A1 local-no-auth     # shows file:///.../dsh-local-no-auth/lib/index.js
dsh web --no-open --port 3099                      # prints: dsh web: http://127.0.0.1:3099/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3099/                                # 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: evil.example.com" http://127.0.0.1:3099/    # 401
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3099/api/x                           # 404 (not 401)
```

## Rollback / uninstall

Remove `"dsh-local-no-auth"` from `dsh.profile.bundles` to restore the stock authentication;
`dsh plugin --profile web remove dsh-local-no-auth` also drops the dependency.

## Verified environment

dsh `0.1.5-rc.1` (Windows / Node 24). If a newer dsh renames the `BrowserAuth` methods, the
plugin fails silently (symptom: back to 401); grep for `isAuthenticated` / `authenticatedUrl` in
`<dsh install>/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js` and update the two
overridden keys in `lib/index.js`.
