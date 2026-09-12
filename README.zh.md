[English](README.md) | 中文

# dsh-local-no-auth

DSH 插件：对**仅本机使用**的 Web GUI 免掉 `?token=` 启动门槛，并让启动时打印 / 自动
打开的地址变成干净的 `http://127.0.0.1:3080/`。

它只覆盖 `dsh-client-connection` 里 `BrowserAuth` 的两个方法（原型级）：

| 方法 | 覆写后 |
| --- | --- |
| `isAuthenticated` | 请求 Host 头是回环名（`127.0.0.1` / `localhost` / `[::1]`）时恒真；否则回落原始 cookie 校验 |
| `authenticatedUrl` | 只做 URL 规范化，不再附加 `?token=` |

## 两道安全闸门

1. **绑定检查**：`webServer.host` 不是 `127.0.0.1`（即对外绑定）时，插件整体不生效，
   只打一条警告，认证原样保留。
2. **Host 检查**：即使绑回环，非回环 Host 头（伪造 Host / DNS rebinding）也拿不到免认证。

connection 自身的 Host/Origin fence（`isTrustedApiRequest`，`/api` 上非信任 Host 403）完全没有动。
带 token 的旧链接仍然可用（`authorizeIndex` 的 token 分支保留）。

前提：这只在"能连到端口的进程本来就能读 `~/.dsh`"的 loopback 部署里有意义。
dsh 0.1.5-rc.1 的 CLI 本身就拒绝 `--host 0.0.0.0`，所以正常情况下第一道闸门不会被触发。

## 安装

```bash
# 从 GitHub 仓库
dsh plugin --profile web add github:zhj9709/dsh-local-no-auth
# 从本地 tgz（npm pack 产物）
dsh plugin --profile web add D:/path/to/dsh-local-no-auth-0.1.0.tgz
# 或发布 npm 后
dsh plugin --profile web add dsh-local-no-auth
```

然后把包名加进 profile 的 bundle 列表 —— 编辑 `~/.dsh/profiles/web/package.json`：

```json
"dsh": {
  "profile": {
    "bundles": [ "...现有条目...", "dsh-local-no-auth" ]
  }
}
```

重启 `dsh web` 即生效。bundle 自带的 `cordis.patch.yml` 会把插件条目插进 loader 树，
不需要再手改 profile 的 patch 层。

## 验证

```bash
dsh web --dump-config | grep -A1 local-no-auth     # 出现 file:///.../dsh-local-no-auth/lib/index.js
dsh web --no-open --port 3099                      # 打印: dsh web: http://127.0.0.1:3099/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3099/                                # 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: evil.example.com" http://127.0.0.1:3099/    # 401
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3099/api/x                           # 404(非401)
```

## 回退 / 卸载

从 `dsh.profile.bundles` 里删掉 `"dsh-local-no-auth"` 即恢复原认证行为；
`dsh plugin --profile web remove dsh-local-no-auth` 可顺带移除依赖。

## 已验证环境

dsh `0.1.5-rc.1`（Windows / Node 24）。若新版 dsh 改了 `BrowserAuth` 的方法名，插件会
静默失效（表现为恢复 401），此时在
`<dsh安装目录>/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js` 里
grep `isAuthenticated` / `authenticatedUrl` 同步改 `lib/index.js` 的覆写键名即可。
