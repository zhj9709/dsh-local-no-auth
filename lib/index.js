/**
 * 回环免认证层(限定生效): 只在 Web GUI 绑定到回环地址、且请求本身来自本机回环时才
 * 把该请求当作 owner —— 能连到该端口的进程本来就能直接读 ~/.dsh 下的会话与凭据, 启动
 * 令牌换来的那道浏览器 cookie 门槛对本机访问没有实际防护价值, 但每次重启都会重新生成,
 * 所以对回环访问把它整条拆掉:
 *
 *   1. 向 `connection.authentication` 注册一个 provider: 回环请求直接给出 owner Peer,
 *      裸访问 `/` 就给页面, `/api` 也不再 401。
 *   2. 在 `webserver/entry-url` 里抹掉入口 URL 上的 `?token=` —— 启动时打印的 URL 和
 *      自动打开的浏览器地址都是干净的 `http://127.0.0.1:3080/`。
 *
 * dsh 0.2.2-rc.2 起, 默认 Token 登录从 Connection 迁入 `dsh-host-authentication-token`
 * provider, 路由准入改成 `webServer` 的 `auth` 策略 + `connection.authentication`
 * 注册表; 旧版给 `connection.browserAuth` 原型打补丁的两个方法已不存在(见
 * dsh/docs/upgrade-guide/v0.2.2-rc.2/connection-page-peer)。
 *
 * 三道闸门保证它不会在对外部署时误放行:
 *   - 激活时检查 `webServer.host`, 不是回环地址就完全不注册 provider, 认证原样保留。
 *   - 请求的 Host 头必须是回环名(伪造 Host 的 DNS rebinding 请求)。
 *   - 连接的对端地址能读到就必须是回环地址; 任一闸门不过都回落到后续 provider(即
 *     Token 的 cookie 校验), 不会被放行。
 * connection 的 Host/Origin fence (`isTrustedApiRequest`) 同样未改动: 它先于 provider
 * 执行, 非回环 Host 在进入认证注册表之前就已经 403。
 */

/** Cordis plugin name, matched by the bundle patch's entry id. */
export const name = "local-no-auth";

/** Services needed before the loopback provider can be registered. */
export const inject = ["connection", "connection.authentication", "webServer"];

/** The launch-credential query parameter the Token provider appends. */
const TOKEN_QUERY = "token";

/** Whether one address literal or hostname means "this machine". */
function isLoopbackAddress(value) {
	let name = String(value ?? "").replace(/^\[/u, "").replace(/\]$/u, "");
	// Zone ids (`fe80::1%4`) never appear on loopback, but strip them before parsing.
	const zone = name.indexOf("%");
	if (zone !== -1) name = name.slice(0, zone);
	name = name.toLowerCase();
	// IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is what a dual-stack listener reports.
	if (name.startsWith("::ffff:")) return isLoopbackAddress(name.slice("::ffff:".length));
	if (name === "localhost" || name === "::1" || name === "0:0:0:0:0:0:0:1") return true;
	const octets = name.split(".");
	return octets.length === 4
		&& octets[0] === "127"
		&& octets.every((octet) => /^\d{1,3}$/u.test(octet));
}

/** Read one header from either a Fetch `Headers` or a node header bag. */
function headerOf(headers, key) {
	if (headers instanceof Headers) return headers.get(key) ?? void 0;
	const value = headers?.[key];
	return typeof value === "string" ? value : void 0;
}

/** The parsed URL of a loopback authority, or undefined for anything else. */
function loopbackUrl(raw) {
	try {
		const url = new URL(raw);
		return isLoopbackAddress(url.hostname) ? url : void 0;
	} catch {
		return void 0;
	}
}

/**
 * Whether the carrier socket, when it exposes one, originated on this machine.
 * A missing address fact keeps the previous behaviour: the Host gate decides.
 */
function isLoopbackSocket(socket) {
	const address = socket?.remoteAddress;
	return typeof address !== "string" || isLoopbackAddress(address);
}

/** Whether the request addressed this GUI by a loopback name from a loopback peer. */
function isLoopbackRequest(request) {
	if (!isLoopbackSocket(request?.socket)) return false;
	const host = headerOf(request?.headers, "host");
	if (host === void 0) return false;
	return loopbackUrl(`http://${host}`) !== void 0;
}

/** One entry with the launch token removed from its loopback URL. */
function cleanEntry(entry) {
	const url = loopbackUrl(entry.url);
	if (url === void 0) return entry;
	url.searchParams.delete(TOKEN_QUERY);
	return { label: entry.label, url: url.href, open: entry.open };
}

/**
 * Publish one clean loopback entry and keep every other contribution clean.
 *
 * Listener order is not ours to choose — the Token provider's `apply` awaits its
 * credential store and registers `webserver/entry-url` after ours, so the entry
 * it appends would carry `?token=` and be printed a second time. Entries already
 * present are rewritten in place, later `push` calls go through the same rewrite,
 * and a contribution identical to ours (same label, same canonical URL) is
 * dropped so startup prints exactly one line and the browser handoff uses it.
 */
function publishCleanEntry(baseUrl, entries) {
	const base = loopbackUrl(baseUrl);
	if (base === void 0) return;
	for (let index = 0; index < entries.length; index += 1) entries[index] = cleanEntry(entries[index]);
	const append = Array.prototype.push.bind(entries);
	const appendClean = (...items) => {
		let length = entries.length;
		for (const item of items) {
			const entry = cleanEntry(item);
			if (entries.some((existing) => existing.label === entry.label && existing.url === entry.url)) continue;
			length = append(entry);
		}
		return length;
	};
	if (Object.isExtensible(entries)) entries.push = appendClean;
	// Also the only entry when the composition mounts no Token provider.
	appendClean({ label: "dsh web", url: base.href, open: true });
}

export function apply(ctx) {
	const bindHost = ctx.webServer.host;
	if (!isLoopbackAddress(bindHost)) {
		// console, not ctx.logger: this must stay visible in `dsh web` output, which
		// is where an operator looks after the gate did not disappear.
		console.warn(`local-no-auth: webServer is bound to ${bindHost}, not a loopback address; browser authentication stays enabled`);
		return;
	}
	// One owner Peer for this plugin's lifetime: reloading the plugin (live patch
	// reload) creates a fresh one, and disposal aborts the old one, so a stale
	// provider can never keep admitting requests.
	const peer = ctx.connection.createPeer({ principal: { kind: "owner" } });
	ctx.connection.authentication.register({
		authenticate(request) {
			return isLoopbackRequest(request) ? peer : void 0;
		},
	});
	ctx.on("webserver/entry-url", publishCleanEntry);
}
