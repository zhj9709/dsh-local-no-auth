/**
 * Loopback整洁层(限定生效): 只在 Web GUI 绑到回环地址、且请求的 Host 头也是回环名
 * 时才免认证 —— 能连到该端口的进程本来就能直接读 ~/.dsh 下的会话与凭据, 启动令牌
 * 换来的那道浏览器 cookie 门槛对本机访问没有实际防护价值, 但每次重启都会重新生成,
 * 所以对回环访问把它整条拆掉:
 *
 *   1. `isAuthenticated` 对回环请求恒真 —— 裸访问 `/` 就给页面, `/api` 也不再 401。
 *   2. `authenticatedUrl` 不再附加 `?token=` —— 启动时打印的 URL 和自动打开的浏览器
 *      地址都是干净的 `http://127.0.0.1:3080/`。
 *
 * 两道闸门保证它不会在对外部署时误放行:
 *   - 激活时检查 `webServer.host`, 不是 127.0.0.1(即 `--host 0.0.0.0`) 就完全不生效,
 *     认证原样保留。
 *   - 即使绑回环, 非回环 Host 头(伪造 Host 的 DNS rebinding 请求)也回落到原始 cookie
 *     校验, 不会被放行。
 * connection 的 Host/Origin fence (`isTrustedApiRequest`) 同样未改动。
 */

/** Cordis plugin name, matched by the bundle patch's entry id. */
export const name = "local-no-auth";

/** Wait for the connection service so `browserAuth` exists before patching. */
export const inject = ["connection", "webServer"];

/** The webserver schema's loopback bind literal. */
const LOOPBACK_BIND_HOST = "127.0.0.1";

/** Host-header names that mean "this machine"; IPv6 keeps its URL brackets. */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Read one header from either a Fetch `Headers` or a node header bag. */
function headerOf(headers, key) {
	if (headers instanceof Headers) return headers.get(key) ?? void 0;
	const value = headers?.[key];
	return typeof value === "string" ? value : void 0;
}

/** Whether the request addressed this GUI by a loopback name. */
function isLoopbackRequest(request) {
	const host = headerOf(request?.headers, "host");
	if (host === void 0) return false;
	try {
		return LOOPBACK_HOSTNAMES.has(new URL(`http://${host}`).hostname);
	} catch {
		return false;
	}
}

export function apply(ctx) {
	if (ctx.webServer.host !== LOOPBACK_BIND_HOST) {
		ctx.logger?.warn?.("local-no-auth: webServer is not bound to loopback; browser authentication stays enabled");
		return;
	}
	const auth = ctx.connection?.browserAuth;
	if (auth === void 0) return;
	// Patch the prototype rather than the instance: a live patch reload rebuilds
	// connection (and its BrowserAuth) without re-running this plugin.
	const proto = Object.getPrototypeOf(auth);
	const originalIsAuthenticated = proto.isAuthenticated;
	proto.isAuthenticated = function (request) {
		return isLoopbackRequest(request) ? true : originalIsAuthenticated.call(this, request);
	};
	proto.authenticatedUrl = (baseUrl) => {
		const url = new URL(baseUrl);
		url.pathname = "/";
		url.search = "";
		url.hash = "";
		return url.href;
	};
}
