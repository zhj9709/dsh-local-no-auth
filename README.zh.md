[English](README.md) | 中文

# dsh-local-no-auth

DSH 插件：对**仅本机使用**的 Web GUI 免掉 `?token=` 启动门槛，并让启动时打印 / 自动
打开的地址变成干净的 `http://127.0.0.1:3080/`。

## 它做什么

dsh `0.2.2-rc.2` 起，默认 Token 登录从 Connection 迁进了
`@deepseek-ai/dsh-host-authentication-token` provider，路由准入改成
`webServer` 的 `auth` 策略加 `connection.authentication` 注册表
（见 `dsh/docs/upgrade-guide/v0.2.2-rc.2/connection-page-peer`）。插件因此不再给
`BrowserAuth` 的原型打补丁，而是接在新的扩展点上：

| 扩展点 | 插件的行为 |
| --- | --- |
| `connection.authentication.register` | 注册一个 provider：回环请求直接返回 owner Peer（等价于 Token 插件在页面入口给出的那个 Peer） |
| `webserver/entry-url` | 把入口 URL 上的 `?token=` 抹掉，并保证只打印一行、自动打开的是干净地址 |

回环请求因此裸访问 `/` 直接出页面、`/api` 也不再 401，启动打印与浏览器跳转都是
`http://127.0.0.1:3080/`。

## 三道安全闸门

1. **绑定检查**：`webServer.host` 不是回环地址（对外绑定）时，插件完全不注册
   provider，只在启动输出里打一条警告，认证原样保留。
2. **Host 检查**：即使绑回环，Host 头不是回环名的请求（伪造 Host / DNS rebinding）
   不会命中本 provider，回落到 Token 的 cookie 校验。
3. **对端检查**：连接能报出 `remoteAddress` 时，它必须是回环地址，否则同样回落。

connection 自身的 Host/Origin fence（`isTrustedApiRequest`，`/api` 上非信任 Host
403）完全没有动，而且先于 provider 执行——伪造 Host 在进入认证注册表之前就 403 了。
带 token 的旧链接仍然可用（Token 插件的 `authorizeIndex` 分支保留，可以继续换 cookie）。

前提：这只在"能连到端口的进程本来就能读 `~/.dsh`"的 loopback 部署里有意义。
dsh 的 CLI 本身就拒绝 `--host 0.0.0.0`，所以正常情况下第一道闸门不会被触发。

## 安装

```bash
# 从 GitHub 仓库
dsh plugin --profile web add github:zhj9709/dsh-local-no-auth
# 本地开发：软链当前目录（改完代码重启 dsh web 即生效，无需重新安装）
dsh plugin --profile web add "link:./"
# 从本地 tgz（npm pack 产物）
dsh plugin --profile web add D:/path/to/dsh-local-no-auth-0.2.0.tgz
# 或发布 npm 后
dsh plugin --profile web add dsh-local-no-auth
```

`add` 会把包名写进 profile 的 `dsh.profile.bundles`；包自带的 `cordis.patch.yml`
（`dsh.bundle.patch` 清单字段）会把插件条目插进 loader 树，不需要手改 profile 的 patch
层。

## 验证

```bash
dsh web --dump-config | grep -A1 local-no-auth     # 出现 file:///.../dsh-local-no-auth/lib/index.js
dsh web --no-open --port 3099                      # 只打印一行: dsh web: http://127.0.0.1:3099/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3099/                                # 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: evil.example.com" http://127.0.0.1:3099/    # 403
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3099/api/x                           # 404(非401)
dsh web --no-open --port 3098 --host 172.22.16.1   # 非回环绑定: 打印 warning 与带 token 的入口
curl -s -o /dev/null -w "%{http_code}\n" http://172.22.16.1:3098/                              # 401
```

## 回退 / 卸载

从 `dsh.profile.bundles` 里删掉 `"dsh-local-no-auth"` 即恢复原认证行为；
`dsh plugin --profile web remove dsh-local-no-auth` 可顺带移除依赖。

想保留插件但临时关掉免认证：把 `~/.dsh/profiles/web/cordis.patch.yml` 里加一行

```yaml
- id: local-no-auth
  disabled: true
```

## 兼容性

| 插件版本 | 适用 dsh | 实现 |
| --- | --- | --- |
| `0.2.x`（当前） | `0.2.2-rc.2` 及更新 | `connection.authentication` provider + `webserver/entry-url` |
| `0.1.0` | `0.1.5` ~ `0.2.2-rc.1` | 覆盖 `connection.browserAuth` 的 `isAuthenticated` / `authenticatedUrl` |

旧版本（`0.1.0`）在 dsh 更新后会**静默失效**：`browserAuth` 已被移除，插件 `apply`
找不到它就直接返回，表现为又回到 401 —— 这正是升级到 `0.2.x` 的原因。

## 已验证环境

dsh `0.2.3-alpha.2`（Windows / Node 24）。若更新的 dsh 再次改动认证扩展点，插件同样会
静默失效；对照 `<dsh安装目录>/node_modules/@deepseek-ai/dsh-client-connection/src/`
里的 `authentication.ts`（`ConnectionAuthentication.register`）与
`dsh-host-authentication-token/src/index.ts`（provider 写法）同步调整即可。
