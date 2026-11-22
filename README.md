English | [中文](README.zh.md)

# dsh-local-no-auth

A DSH plugin that removes the `?token=` launch gate for **local-only** Web GUI deployments and
makes the printed / auto-opened startup URL a clean `http://127.0.0.1:3080/`.

## What it does

Since dsh `0.2.2-rc.2` the default token sign-in moved out of Connection into the
`@deepseek-ai/dsh-host-authentication-token` provider, and route admission became the
`webServer` `auth` policy plus the `connection.authentication` registry (see
`dsh/docs/upgrade-guide/v0.2.2-rc.2/connection-page-peer`). The plugin therefore no longer
patches `BrowserAuth`; it hooks the new extension points:

| Extension point | What the plugin does |
| --- | --- |
| `connection.authentication.register` | Registers a provider that returns the owner Peer for loopback requests (the same Peer the Token plugin hands the page entry) |
| `webserver/entry-url` | Strips `?token=` from entry URLs, keeps startup printing one line, and lets the browser handoff use the clean address |

A loopback request now gets the page on a bare `/`, `/api` no longer answers 401, and both the
printed line and the browser handoff are `http://127.0.0.1:3080/`.

## Three safety gates

1. **Bind check**: when `webServer.host` is not a loopback address (an outward bind), the plugin
   registers no provider at all — it only warns in the startup output and stock authentication
   remains in force.
2. **Host check**: even on a loopback bind, a request whose Host header is not a loopback name
   (forged Host / DNS rebinding) never matches this provider and falls through to the Token
   cookie check.
3. **Peer check**: when the connection reports a `remoteAddress`, it must be a loopback address,
   otherwise the request falls through as well.

The connection's own Host/Origin fence (`isTrustedApiRequest`, 403 for untrusted Host headers on
`/api`) is untouched, and it runs *before* providers — a forged Host is refused with 403 before
the authentication registry is consulted. Launch URLs that still carry a token keep working (the
Token plugin's `authorizeIndex` branch is preserved and still mints cookies).

This only makes sense for loopback deployments, where any process that can reach the port could
read `~/.dsh` anyway. The dsh CLI refuses `--host 0.0.0.0` outright, so gate 1 is a second line of
defense in case the host is changed at the profile-config layer instead.

## Install

```bash
# From the GitHub repository
dsh plugin --profile web add github:zhj9709/dsh-local-no-auth
# Local development: symlink this directory (edit, restart dsh web, done)
dsh plugin --profile web add "link:./"
# From a local tarball (npm pack output)
dsh plugin --profile web add D:/path/to/dsh-local-no-auth-0.2.0.tgz
# Or from npm once published
dsh plugin --profile web add dsh-local-no-auth
```

`add` writes the package name into `dsh.profile.bundles`, and the package's own
`cordis.patch.yml` (declared through the `dsh.bundle.patch` manifest field) inserts the plugin row
into the loader tree — the profile's patch layer needs no hand edit.

## Verify

```bash
dsh web --dump-config | grep -A1 local-no-auth     # shows file:///.../dsh-local-no-auth/lib/index.js
dsh web --no-open --port 3099                      # prints exactly one line: dsh web: http://127.0.0.1:3099/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3099/                                # 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: evil.example.com" http://127.0.0.1:3099/    # 403
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3099/api/x                           # 404 (not 401)
dsh web --no-open --port 3098 --host 172.22.16.1   # non-loopback bind: warning plus the token URL
curl -s -o /dev/null -w "%{http_code}\n" http://172.22.16.1:3098/                              # 401
```

## Rollback / uninstall

Remove `"dsh-local-no-auth"` from `dsh.profile.bundles` to restore the stock authentication;
`dsh plugin --profile web remove dsh-local-no-auth` also drops the dependency.

To keep the plugin installed but switch the bypass off temporarily, add to
`~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: local-no-auth
  disabled: true
```

## Compatibility

| Plugin | dsh | Implementation |
| --- | --- | --- |
| `0.2.x` (current) | `0.2.2-rc.2` and newer | `connection.authentication` provider + `webserver/entry-url` |
| `0.1.0` | `0.1.5` – `0.2.2-rc.1` | overrides `connection.browserAuth`'s `isAuthenticated` / `authenticatedUrl` |

`0.1.0` fails **silently** on a newer dsh: `browserAuth` is gone, so `apply` returns early and the
symptom is simply "back to 401". That is what `0.2.x` fixes.

## Verified environment

dsh `0.2.3-alpha.2` (Windows / Node 24). If a newer dsh changes the authentication extension
points again, the plugin fails silently the same way; compare
`<dsh install>/node_modules/@deepseek-ai/dsh-client-connection/src/authentication.ts`
(`ConnectionAuthentication.register`) with
`dsh-host-authentication-token/src/index.ts` (the provider shape) and adjust `lib/index.js`.
