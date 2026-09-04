import { a as e, i as t, n, o as r, r as i, t as a } from "./rolldown-runtime-CJfroGDQ.js";
import { BrowserWindow as o, app as s, dialog as c, ipcMain as l, safeStorage as u, session as d, shell as f } from "electron";
import p from "node:path";
import { URL as m, fileURLToPath as h } from "node:url";
import g from "node:fs/promises";
import { existsSync as _ } from "node:fs";
import { execFile as v, spawn as y } from "node:child_process";
import b from "gray-matter";
import { simpleGit as x } from "simple-git";
import S from "node:os";
import { EventEmitter as C } from "node:events";
import { Worker as ee } from "node:worker_threads";
import te from "node:http";
import ne, { randomUUID as re } from "node:crypto";
import { TLSSocket as ie } from "node:tls";
import ae from "tree-kill";
import oe from "chokidar";
import { promisify as se } from "node:util";
//#region electron/services/projectRegistry.ts
var ce = {
	version: 1,
	scanRoots: (process.platform === "win32" ? [
		"F:\\",
		"D:\\",
		p.join(S.homedir(), "Projects")
	] : [p.join(S.homedir(), "Projects"), p.join(S.homedir(), "Developer")]).filter((e) => _(e)),
	projects: [{
		path: process.cwd(),
		addedAt: (/* @__PURE__ */ new Date()).toISOString(),
		favorite: !0,
		tags: ["hub", "core"]
	}],
	settings: {
		autoScanOnStartup: !0,
		scanDepth: 2
	}
}, le = new class {
	configPath;
	cachedConfig = null;
	constructor() {
		let e = S.homedir(), t = p.join(e, ".projecthub");
		this.configPath = p.join(t, "projects.json");
	}
	async ensureConfigFile() {
		try {
			let e = p.dirname(this.configPath);
			return _(e) || await g.mkdir(e, { recursive: !0 }), _(this.configPath) || await g.writeFile(this.configPath, JSON.stringify(ce, null, 2), "utf-8"), this.configPath;
		} catch {
			let e = s ? s.getPath("userData") : p.join(S.tmpdir(), ".projecthub");
			return _(e) || await g.mkdir(e, { recursive: !0 }), this.configPath = p.join(e, "projects.json"), _(this.configPath) || await g.writeFile(this.configPath, JSON.stringify(ce, null, 2), "utf-8"), this.configPath;
		}
	}
	async getConfig() {
		if (this.cachedConfig) return this.cachedConfig;
		await this.ensureConfigFile();
		try {
			let e = await g.readFile(this.configPath, "utf-8"), t = JSON.parse(e);
			return this.cachedConfig = {
				...ce,
				...t,
				projects: t.projects || [],
				scanRoots: t.scanRoots || ce.scanRoots,
				settings: {
					...ce.settings,
					...t.settings
				}
			}, this.cachedConfig;
		} catch (e) {
			return console.error("Failed to parse projects.json, restoring default config:", e), this.cachedConfig = ce, await this.saveConfig(this.cachedConfig), this.cachedConfig;
		}
	}
	async saveConfig(e) {
		this.cachedConfig = e, await this.ensureConfigFile();
		try {
			await g.writeFile(this.configPath, JSON.stringify(e, null, 2), "utf-8");
		} catch (e) {
			console.error("Failed to save project registry:", e);
		}
	}
	async getScanRoots() {
		return (await this.getConfig()).scanRoots;
	}
	async setScanRoots(e) {
		let t = await this.getConfig();
		return t.scanRoots = Array.from(new Set(e.map((e) => p.normalize(e)))), await this.saveConfig(t), !0;
	}
	async getProjects() {
		return (await this.getConfig()).projects;
	}
	async addProject(e, t = !1) {
		let n = p.normalize(e), r = await this.getConfig(), i = r.projects.findIndex((e) => p.normalize(e.path).toLowerCase() === n.toLowerCase());
		return i >= 0 ? r.projects[i].favorite = t || r.projects[i].favorite : r.projects.unshift({
			path: n,
			addedAt: (/* @__PURE__ */ new Date()).toISOString(),
			favorite: t,
			tags: []
		}), await this.saveConfig(r), !0;
	}
	async removeProject(e) {
		let t = p.normalize(e).toLowerCase(), n = await this.getConfig(), r = n.projects.length;
		return n.projects = n.projects.filter((e) => p.normalize(e.path).toLowerCase() !== t), n.projects.length !== r && (await this.saveConfig(n), !0);
	}
	async toggleFavorite(e) {
		let t = p.normalize(e).toLowerCase(), n = await this.getConfig(), r = n.projects.find((e) => p.normalize(e.path).toLowerCase() === t);
		return r ? (r.favorite = !r.favorite, await this.saveConfig(n), r.favorite) : !1;
	}
	async isFavorite(e) {
		let t = p.normalize(e).toLowerCase();
		return !!(await this.getConfig()).projects.find((e) => p.normalize(e.path).toLowerCase() === t)?.favorite;
	}
	async setVoiceAlias(e, t) {
		let n = p.normalize(e).toLowerCase(), r = await this.getConfig(), i = r.projects.find((e) => p.normalize(e.path).toLowerCase() === n);
		return i ? (i.voiceAlias = t.trim() || void 0, await this.saveConfig(r), !0) : (r.projects.push({
			path: e,
			addedAt: (/* @__PURE__ */ new Date()).toISOString(),
			voiceAlias: t.trim() || void 0
		}), await this.saveConfig(r), !0);
	}
	async getVoiceAlias(e) {
		let t = p.normalize(e).toLowerCase();
		return (await this.getConfig()).projects.find((e) => p.normalize(e.path).toLowerCase() === t)?.voiceAlias;
	}
}(), ue = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	".agents",
	".claude",
	".gemini",
	"dist",
	"dist-electron",
	"build",
	".next",
	".nuxt",
	"$recycle.bin",
	"system volume information",
	"appdata",
	"windows"
]);
async function de(e) {
	try {
		let t = p.normalize(e);
		if (!_(t) || !(await g.stat(t)).isDirectory()) return null;
		let n = _(p.join(t, "backlog")), r = _(p.join(t, "infra.config.json")), i = _(p.join(t, ".git")), a = _(p.join(t, "package.json"));
		if (!n && !r && !(i && a)) return null;
		let o = p.basename(t), s, c, l;
		if (r) try {
			let e = await g.readFile(p.join(t, "infra.config.json"), "utf-8");
			l = JSON.parse(e).features;
		} catch {}
		if (a) try {
			let e = await g.readFile(p.join(t, "package.json"), "utf-8"), n = JSON.parse(e);
			n.name && (o = n.name), n.description && (s = n.description), n.version && (c = n.version);
		} catch {}
		if (n && _(p.join(t, "backlog", "config.yml"))) try {
			let e = (await g.readFile(p.join(t, "backlog", "config.yml"), "utf-8")).match(/project_name:\s*["']?([^"'\r\n]+)["']?/);
			e && e[1] && (o = e[1].trim());
		} catch {}
		let u = {
			total: 0,
			todo: 0,
			inProgress: 0,
			review: 0,
			done: 0
		};
		if (n && _(p.join(t, "backlog", "tasks"))) try {
			let e = await g.readdir(p.join(t, "backlog", "tasks"));
			for (let n of e) if (n.endsWith(".md")) {
				u.total++;
				try {
					let e = await g.readFile(p.join(t, "backlog", "tasks", n), "utf-8"), { data: r } = b(e), i = r.status || "To Do";
					i === "To Do" ? u.todo++ : i === "In Progress" ? u.inProgress++ : i === "Review" ? u.review++ : i === "Done" && u.done++;
				} catch {
					u.todo++;
				}
			}
		} catch {}
		let d, f, m = 0, h = 0, v = 0, y;
		if (i) try {
			let e = x(t), n = await e.status();
			d = n.current || "detached", f = n.isClean(), m = n.files.length, h = n.ahead || 0, v = n.behind || 0;
			let r = await e.log({ maxCount: 1 });
			r.latest && (y = {
				hash: r.latest.hash,
				message: r.latest.message,
				date: r.latest.date,
				author: r.latest.author_name
			});
		} catch {}
		let S, C = p.join(t, ".rag-index", "meta.json");
		if (_(C)) try {
			let e = await g.readFile(C, "utf-8"), t = JSON.parse(e);
			S = {
				ready: !0,
				chunksCount: t.chunks || 0,
				filesCount: t.files?.length || 0,
				builtAt: t.builtAt,
				model: t.model
			};
		} catch {
			S = { ready: !0 };
		}
		else (_(p.join(t, "scripts", "rag")) || l && l.docsRag) && (S = { ready: !1 });
		let ee = {
			runningCount: 0,
			processes: []
		}, te = p.join(t, ".env-state", "processes.json");
		if (_(te)) try {
			let e = await g.readFile(te, "utf-8"), t = JSON.parse(e), n = [];
			for (let [e, r] of Object.entries(t)) if (r && r.pid) {
				let t = !1;
				try {
					process.kill(r.pid, 0), t = !0;
				} catch {
					t = !1;
				}
				t && n.push({
					name: e,
					pid: r.pid,
					command: r.command,
					startedAt: r.startedAt
				});
			}
			ee = {
				runningCount: n.length,
				processes: n
			};
		} catch {}
		let ne = await le.isFavorite(t), re = await le.getVoiceAlias(t);
		return {
			name: o,
			path: t,
			description: s,
			version: c,
			favorite: ne,
			voiceAlias: re,
			hasBacklog: n,
			hasInfraConfig: r,
			hasGit: i,
			gitBranch: d,
			gitClean: f,
			gitAhead: h,
			gitBehind: v,
			uncommittedCount: m,
			lastCommit: y,
			taskCounts: u,
			ragStatus: S,
			processStatus: ee,
			features: l,
			lastScannedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	} catch (t) {
		return console.error(`Error inspecting project at ${e}:`, t), null;
	}
}
async function fe(e, t = 2) {
	let n = /* @__PURE__ */ new Map();
	async function r(e, i) {
		if (!(i > t)) try {
			if (!_(e) || !(await g.stat(e)).isDirectory()) return;
			let t = await de(e);
			if (t && (n.set(p.normalize(t.path).toLowerCase(), t), i > 0)) return;
			let a = await g.readdir(e, { withFileTypes: !0 });
			for (let t of a) if (t.isDirectory()) {
				let n = t.name.toLowerCase();
				if (ue.has(n) || n.startsWith(".")) continue;
				await r(p.join(e, t.name), i + 1);
			}
		} catch {}
	}
	for (let t of e) await r(p.normalize(t), 0);
	for (let e of n.values()) await le.addProject(e.path, !!e.favorite);
	return Array.from(n.values());
}
//#endregion
//#region electron/services/secretStorageService.ts
var pe = "enc_v1:", me = p.join(S.homedir(), ".projecthub"), he = p.join(me, "secrets.enc.json"), ge = new class {
	inMemoryCache = /* @__PURE__ */ new Map();
	initialized = !1;
	constructor() {
		this.ensureDir();
	}
	ensureDir() {
		if (!_(me)) try {
			g.mkdir(me, { recursive: !0 });
		} catch (e) {
			console.error("[SecretStorage] Failed to create dir:", e);
		}
	}
	isEncryptionAvailable() {
		try {
			return u.isEncryptionAvailable();
		} catch {
			return !1;
		}
	}
	encrypt(e) {
		if (!e || e.startsWith(pe)) return e;
		if (this.isEncryptionAvailable()) try {
			return `${pe}${u.encryptString(e).toString("base64")}`;
		} catch (t) {
			return console.warn("[SecretStorage] safeStorage.encryptString failed, using plain fallback:", t), e;
		}
		return e;
	}
	decrypt(e) {
		if (!e) return "";
		if (!e.startsWith(pe)) return e;
		if (this.isEncryptionAvailable()) try {
			let t = e.slice(7), n = Buffer.from(t, "base64");
			return u.decryptString(n);
		} catch (e) {
			return console.error("[SecretStorage] safeStorage.decryptString failed:", e), "";
		}
		return console.warn("[SecretStorage] Decryption requested but safeStorage is unavailable"), "";
	}
	mask(e) {
		if (!e) return "";
		let t = e.startsWith(pe) ? this.decrypt(e) : e;
		return t.length <= 8 ? "********" : `${t.slice(0, 4)}...${t.slice(-4)}`;
	}
	async loadSecretsFile() {
		try {
			if (_(he)) {
				let e = await g.readFile(he, "utf-8");
				return JSON.parse(e);
			}
		} catch (e) {
			console.warn("[SecretStorage] Error reading secrets file:", e);
		}
		return {};
	}
	async saveSecretsFile(e) {
		this.ensureDir(), await g.writeFile(he, JSON.stringify(e, null, 2), "utf-8");
	}
	async setSecret(e, t) {
		let n = this.encrypt(t);
		this.inMemoryCache.set(e, t);
		let r = await this.loadSecretsFile();
		r[e] = n, await this.saveSecretsFile(r), console.log(`[SecretStorage] Secret "${e}" encrypted & saved successfully (DPAPI: ${this.isEncryptionAvailable()})`);
	}
	async getSecret(e) {
		if (this.inMemoryCache.has(e)) return this.inMemoryCache.get(e);
		let t = (await this.loadSecretsFile())[e];
		if (!t) return null;
		let n = this.decrypt(t);
		return this.inMemoryCache.set(e, n), n;
	}
	async deleteSecret(e) {
		this.inMemoryCache.delete(e);
		let t = await this.loadSecretsFile();
		return e in t && (delete t[e], await this.saveSecretsFile(t), !0);
	}
}(), _e = p.join(S.homedir(), ".projecthub", "claude_config"), ve = p.join(S.homedir(), ".projecthub", "ai-config.json"), ye = new class {
	activeControllers = /* @__PURE__ */ new Map();
	constructor() {
		this.ensureConfigDir();
	}
	ensureConfigDir() {
		let e = p.dirname(ve);
		if (!_(e)) try {
			g.mkdir(e, { recursive: !0 });
		} catch (e) {
			console.error("Failed to create config dir:", e);
		}
		if (!_(_e)) try {
			g.mkdir(_e, { recursive: !0 });
		} catch (e) {
			console.error("Failed to create claude config dir:", e);
		}
	}
	async getClaudeAuthStatus() {
		let e = [p.join(_e, ".claude.json"), p.join(S.homedir(), ".claude.json")];
		for (let t of e) if (_(t)) try {
			let e = await g.readFile(t, "utf-8"), n = JSON.parse(e);
			if (n.oauthAccount && (n.oauthAccount.emailAddress || n.oauthAccount.email)) return {
				isLoggedIn: !0,
				email: n.oauthAccount.emailAddress || n.oauthAccount.email,
				displayName: n.oauthAccount.displayName || n.oauthAccount.fullName,
				seatTier: n.oauthAccount.seatTier || n.oauthAccount.billingType || "Pro / Team",
				organizationName: n.oauthAccount.organizationName
			};
		} catch (e) {
			console.warn(`Failed to read ${t}:`, e);
		}
		return { isLoggedIn: !1 };
	}
	async claudeLogout() {
		let e = [p.join(_e, ".claude.json"), p.join(S.homedir(), ".claude.json")];
		for (let t of e) if (_(t)) try {
			let e = await g.readFile(t, "utf-8"), n = JSON.parse(e);
			n.oauthAccount && (delete n.oauthAccount, delete n.primaryApiKey, await g.writeFile(t, JSON.stringify(n, null, 2), "utf-8"));
		} catch (e) {
			console.warn(`Failed to clean oauthAccount from ${t}:`, e);
		}
		try {
			let e = p.join(_e, ".credentials.json");
			_(e) && await g.unlink(e);
		} catch {}
		try {
			process.platform === "win32" ? y("cmd.exe", ["/c", "claude auth logout"], { env: {
				...process.env,
				CLAUDE_CONFIG_DIR: _e
			} }) : y("claude", ["auth", "logout"], { env: {
				...process.env,
				CLAUDE_CONFIG_DIR: _e
			} });
		} catch (e) {
			console.warn("Failed to spawn claude auth logout:", e);
		}
		return !0;
	}
	async getConfig() {
		try {
			if (_(ve)) {
				let e = await g.readFile(ve, "utf-8"), t = JSON.parse(e);
				return t && t.apiKey && (t.apiKey = ge.decrypt(t.apiKey)), t;
			}
		} catch (e) {
			console.warn("Failed to load AI config, using defaults:", e);
		}
		return {
			provider: "anthropic",
			model: "claude-3-7-sonnet-20250219",
			temperature: .7,
			thinkingBudget: 2048
		};
	}
	async saveConfig(e) {
		this.ensureConfigDir();
		let t = { ...e };
		t.apiKey &&= ge.encrypt(t.apiKey), await g.writeFile(ve, JSON.stringify(t, null, 2), "utf-8");
	}
	abortStream(e) {
		let t = this.activeControllers.get(e);
		t && (t.abort(), this.activeControllers.delete(e));
	}
	generateDiff(e, t, n = "file") {
		let r = e.split("\n"), i = t.split("\n"), a = `--- a/${n}\n+++ b/${n}\n@@ -1,${r.length} +1,${i.length} @@\n`, o = Math.max(r.length, i.length);
		for (let e = 0; e < o; e++) {
			let t = r[e], n = i[e];
			t === n ? a += ` ${t ?? ""}\n` : (t !== void 0 && (a += `-${t}\n`), n !== void 0 && (a += `+${n}\n`));
		}
		return a.trim();
	}
	async applyDiff(e, t, n) {
		let r = p.isAbsolute(t) ? t : p.join(e, t), i = p.dirname(r);
		return await g.mkdir(i, { recursive: !0 }), await g.writeFile(r, n, "utf-8"), !0;
	}
	async streamChat(e, t, n, r) {
		let i = new AbortController();
		this.activeControllers.set(e.sessionId, i);
		try {
			let a = await this.buildSystemPrompt(e.projectPath, e.mode);
			e.config.provider === "anthropic" ? await this.streamAnthropic(e, a, i.signal, t, n, r) : await this.streamOpenAICompatible(e, a, i.signal, t, n, r);
		} catch (e) {
			e.name === "AbortError" ? t({ text: "\n\n*(Отменено пользователем)*" }) : r(e.message || String(e));
		} finally {
			this.activeControllers.delete(e.sessionId);
		}
	}
	async streamAnthropic(e, t, n, r, i, a) {
		let o = e.config.apiKey?.trim();
		if (!o) throw Error("API ключ Anthropic не указан. Пожалуйста, откройте настройки AI Studio и укажите ключ.");
		let s = e.messages.filter((e) => e.role === "user" || e.role === "assistant").map((e) => ({
			role: e.role,
			content: e.content
		})), c = e.mode === "agent" ? this.getAnthropicTools() : void 0, l = {
			model: e.config.model || "claude-3-7-sonnet-20250219",
			max_tokens: 4096,
			system: t,
			messages: s,
			stream: !0
		};
		c && c.length > 0 && (l.tools = c), e.config.thinkingBudget && e.config.thinkingBudget > 0 && e.config.model.includes("3-7") ? l.thinking = {
			type: "enabled",
			budget_tokens: e.config.thinkingBudget
		} : l.temperature = e.config.temperature ?? .7;
		let u = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"x-api-key": o,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json"
			},
			body: JSON.stringify(l),
			signal: n
		});
		if (!u.ok) {
			let e = await u.text();
			throw Error(`Anthropic API Error (${u.status}): ${e}`);
		}
		let d = "", f = "", m = [], h = null, v = u.body?.getReader();
		if (!v) throw Error("Response body is empty");
		let y = new TextDecoder(), b = "";
		for (;;) {
			let { done: t, value: n } = await v.read();
			if (t) break;
			b += y.decode(n, { stream: !0 });
			let i = b.split("\n");
			b = i.pop() || "";
			for (let t of i) {
				let n = t.trim();
				if (!n || !n.startsWith("data: ")) continue;
				let i = n.slice(6);
				if (i !== "[DONE]") try {
					let t = JSON.parse(i);
					if (t.type === "content_block_delta") {
						if (t.delta?.type === "text_delta") {
							let e = t.delta.text;
							d += e, r({ text: e });
						} else if (t.delta?.type === "thinking_delta") {
							let e = t.delta.thinking;
							f += e, r({ thought: e });
						} else t.delta?.type === "input_json_delta" && h && (h.argsStr += t.delta.partial_json);
					} else if (t.type === "content_block_start") t.content_block?.type === "tool_use" && (h = {
						id: t.content_block.id,
						name: t.content_block.name,
						argsStr: ""
					});
					else if (t.type === "content_block_stop" && h) {
						let t = {};
						try {
							t = JSON.parse(h.argsStr || "{}");
						} catch (e) {
							console.error("Failed to parse tool args:", e);
						}
						let n = {
							id: h.id,
							name: h.name,
							args: t,
							status: "pending"
						};
						if (h.name === "write_file" && t.filePath && t.content) {
							let r = p.isAbsolute(t.filePath) ? t.filePath : p.join(e.projectPath, t.filePath), i = "";
							_(r) && (i = await g.readFile(r, "utf-8").catch(() => "")), n.diff = {
								filePath: t.filePath,
								oldContent: i,
								newContent: t.content,
								patch: this.generateDiff(i, t.content, t.filePath)
							};
						}
						m.push(n), r({ toolCall: n }), h = null;
					}
				} catch {}
			}
		}
		i({
			id: `msg-${Date.now()}`,
			role: "assistant",
			content: d,
			thought: f || void 0,
			toolCalls: m.length > 0 ? m.map((e) => ({
				...e,
				status: e.status || (e.diff ? "pending" : "done")
			})) : void 0,
			timestamp: (/* @__PURE__ */ new Date()).toISOString()
		});
	}
	async streamOpenAICompatible(e, t, n, r, i, a) {
		let o = "https://openrouter.ai/api/v1/chat/completions", s = { "content-type": "application/json" }, c = e.config.apiKey?.trim();
		if (e.config.provider === "openrouter") {
			if (!c) throw Error("API ключ OpenRouter не указан в настройках.");
			s.Authorization = `Bearer ${c}`, s["HTTP-Referer"] = "https://projecthub.local", s["X-Title"] = "ProjectHub AI Studio";
		} else if (e.config.provider === "deepseek") {
			if (!c) throw Error("API ключ DeepSeek не указан в настройках.");
			o = "https://api.deepseek.com/chat/completions", s.Authorization = `Bearer ${c}`;
		} else e.config.provider === "ollama" ? o = `${(e.config.baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "")}/v1/chat/completions` : e.config.provider === "custom" && (o = e.config.baseUrl || "http://localhost:8000/v1/chat/completions", c && (s.Authorization = `Bearer ${c}`));
		let l = [{
			role: "system",
			content: t
		}, ...e.messages.filter((e) => e.role === "user" || e.role === "assistant").map((e) => ({
			role: e.role,
			content: e.content
		}))], u = {
			model: e.config.model || "deepseek/deepseek-chat",
			messages: l,
			temperature: e.config.temperature ?? .7,
			stream: !0
		}, d = await fetch(o, {
			method: "POST",
			headers: s,
			body: JSON.stringify(u),
			signal: n
		});
		if (!d.ok) {
			let e = await d.text();
			throw Error(`API Error (${d.status}): ${e}`);
		}
		let f = "", p = "", m = d.body?.getReader();
		if (!m) throw Error("Response body is empty");
		let h = new TextDecoder(), g = "";
		for (;;) {
			let { done: e, value: t } = await m.read();
			if (e) break;
			g += h.decode(t, { stream: !0 });
			let n = g.split("\n");
			g = n.pop() || "";
			for (let e of n) {
				let t = e.trim();
				if (!t || !t.startsWith("data: ")) continue;
				let n = t.slice(6);
				if (n !== "[DONE]") try {
					let e = JSON.parse(n).choices?.[0]?.delta;
					e && (e.reasoning_content && (p += e.reasoning_content, r({ thought: e.reasoning_content })), e.content && (f += e.content, r({ text: e.content })));
				} catch {}
			}
		}
		i({
			id: `msg-${Date.now()}`,
			role: "assistant",
			content: f,
			thought: p || void 0,
			timestamp: (/* @__PURE__ */ new Date()).toISOString()
		});
	}
	async buildSystemPrompt(e, t) {
		return `You are Claude Code, Anthropic's official AI assistant for software development.
Working directory: "${e}".
Answer directly, clearly, and concisely as Claude Code. If the user addresses you in Russian, answer naturally in Russian while preserving technical terms, file paths, and code.`;
	}
	getAnthropicTools() {
		return [
			{
				name: "read_file",
				description: "Прочитать содержимое файла проекта",
				input_schema: {
					type: "object",
					properties: { filePath: {
						type: "string",
						description: "Относительный или абсолютный путь к файлу"
					} },
					required: ["filePath"]
				}
			},
			{
				name: "write_file",
				description: "Создать или изменить файл проекта (показывает интерактивный Diff пользователю)",
				input_schema: {
					type: "object",
					properties: {
						filePath: {
							type: "string",
							description: "Относительный или абсолютный путь к файлу"
						},
						content: {
							type: "string",
							description: "Полное новое содержимое файла"
						},
						explanation: {
							type: "string",
							description: "Краткое объяснение внесенных изменений"
						}
					},
					required: ["filePath", "content"]
				}
			},
			{
				name: "list_dir",
				description: "Получить список файлов и подкаталогов в директории проекта",
				input_schema: {
					type: "object",
					properties: { subDir: {
						type: "string",
						description: "Относительный путь подкаталога (пустая строка для корня)"
					} }
				}
			},
			{
				name: "search_rag",
				description: "Семантический поиск по документации и ADR проекта через LanceDB",
				input_schema: {
					type: "object",
					properties: { query: {
						type: "string",
						description: "Поисковый запрос на естественном языке"
					} },
					required: ["query"]
				}
			},
			{
				name: "ask_question",
				description: "Задать интерактивный вопрос пользователю с выбором вариантов (радиокнопки, чекбоксы, свой вариант)",
				input_schema: {
					type: "object",
					properties: {
						title: {
							type: "string",
							description: "Краткий заголовок вопроса (например, \"Что делаем?\")"
						},
						question: {
							type: "string",
							description: "Развернутый текст вопроса пользователю"
						},
						options: {
							type: "array",
							items: {
								type: "object",
								properties: {
									label: {
										type: "string",
										description: "Название варианта ответа"
									},
									description: {
										type: "string",
										description: "Подробное описание или действие для этого варианта"
									}
								},
								required: ["label"]
							},
							description: "Список вариантов ответа (от 2 до 10 вариантов)"
						},
						is_multi_select: {
							type: "boolean",
							description: "Если true — множественный выбор (чекбоксы), если false — одиночный (радиокнопки)"
						}
					},
					required: ["question", "options"]
				}
			}
		];
	}
}(), be = [
	{
		id: "default",
		name: "Default (recommended)",
		description: "Sonnet 5 · Efficient for routine tasks",
		family: "default"
	},
	{
		id: "sonnet",
		name: "Sonnet",
		description: "Sonnet 5 · Efficient for routine tasks",
		family: "sonnet"
	},
	{
		id: "fable",
		name: "Fable",
		description: "Fable 5 · Most capable for your hardest and longest-running tasks",
		badge: "Requires usage credits",
		family: "fable"
	},
	{
		id: "opus[1m]",
		name: "Opus (1M context)",
		description: "Opus 5 with 1M context · Best for everyday, complex tasks",
		badge: "1M Context",
		family: "opus"
	},
	{
		id: "haiku",
		name: "Haiku",
		description: "Haiku 4.5 · Fastest for quick answers",
		badge: "Fast",
		family: "haiku"
	},
	{
		id: "best",
		name: "Best",
		description: "Auto-selects optimal model for task complexity",
		family: "default"
	},
	{
		id: "opusplan",
		name: "OpusPlan",
		description: "Opus planning with Sonnet execution",
		family: "opus"
	},
	{
		id: "sonnet[1m]",
		name: "Sonnet (1M context)",
		description: "Sonnet 5 with extended 1M context window",
		badge: "1M Context",
		family: "sonnet"
	},
	{
		id: "fable[1m]",
		name: "Fable (1M context)",
		description: "Fable 5 with extended 1M context window",
		badge: "1M Context",
		family: "fable"
	}
], xe = new class extends C {
	projectStatuses = /* @__PURE__ */ new Map();
	pendingApprovals = /* @__PURE__ */ new Map();
	activeSubagents = /* @__PURE__ */ new Map();
	activeProcesses = /* @__PURE__ */ new Map();
	constructor() {
		super();
	}
	getProjectStatus(e) {
		return this.projectStatuses.get(e) || {
			projectPath: e,
			projectName: p.basename(e),
			status: "idle",
			updatedAt: Date.now()
		};
	}
	getAllProjectStatuses() {
		return Array.from(this.projectStatuses.values());
	}
	getAvailableModels() {
		return be;
	}
	setProjectStatus(e, t, n, r) {
		let i = (this.activeSubagents.get(e) || []).filter((e) => e.status === "running").length, a = {
			projectPath: e,
			projectName: p.basename(e),
			status: t,
			lastMessage: n,
			pendingApproval: r,
			activeSubagentsCount: i,
			updatedAt: Date.now()
		};
		this.projectStatuses.set(e, a), this.emit("statusChanged", a);
	}
	async requestApproval(e) {
		return new Promise((t) => {
			this.pendingApprovals.set(e.id, t), this.setProjectStatus(e.projectPath, "waiting_approval", e.title, e);
		});
	}
	sendApprovalResponse(e, t) {
		let n = this.pendingApprovals.get(e);
		return n ? (n(t), this.pendingApprovals.delete(e), !0) : !1;
	}
	registerSubagent(e) {
		let t = this.activeSubagents.get(e.projectPath) || [], n = t.findIndex((t) => t.id === e.id);
		n >= 0 ? t[n] = e : t.push(e), this.activeSubagents.set(e.projectPath, t), this.emit("subagentUpdated", e);
	}
	getSubagents(e) {
		return this.activeSubagents.get(e) || [];
	}
	abortSession(e) {
		ye.abortStream(e);
		let t = this.activeProcesses.get(e);
		t && (t.kill(), this.activeProcesses.delete(e));
	}
	parseQuestionData(e) {
		let t = e.title || "Вопрос от ассистента", n = e.question || e.prompt || e.subtitle || e.description || "", r = !!(e.is_multi_select || e.isMultiSelect || e.multiple), i = [];
		if (Array.isArray(e.questions) && e.questions.length > 0) {
			let t = e.questions[0];
			t.question && (n = t.question), t.is_multi_select !== void 0 && (r = !!t.is_multi_select), Array.isArray(t.options) && (i = t.options);
		} else Array.isArray(e.options) ? i = e.options : Array.isArray(e.choices) && (i = e.choices);
		let a = i.map((e, t) => {
			if (typeof e == "string") {
				let n = e.indexOf(" - ");
				return n > 0 ? {
					id: `opt-${t}`,
					label: e.slice(0, n).trim(),
					description: e.slice(n + 3).trim()
				} : {
					id: `opt-${t}`,
					label: e,
					description: void 0
				};
			}
			return typeof e == "object" && e ? {
				id: e.id || `opt-${t}`,
				label: e.label || e.text || e.title || e.name || `Вариант ${t + 1}`,
				description: e.description || e.desc || e.detail
			} : {
				id: `opt-${t}`,
				label: String(e)
			};
		});
		return {
			title: t,
			subtitle: n,
			options: a,
			isMultiSelect: r,
			allowOther: e.allowOther ?? !0
		};
	}
	isPathExcluded(e, t = []) {
		if (!e || !t || t.length === 0) return !1;
		let n = e.replace(/\\/g, "/").toLowerCase(), r = p.basename(n);
		return t.some((e) => {
			let t = e.trim().replace(/\\/g, "/").toLowerCase();
			if (!t) return !1;
			if (t.startsWith("*") && t.endsWith("*")) {
				let e = t.slice(1, -1);
				return n.includes(e);
			}
			if (t.startsWith("*")) {
				let e = t.slice(1);
				return n.endsWith(e);
			}
			if (t.endsWith("*")) {
				let e = t.slice(0, -1);
				return n.startsWith(e) || r.startsWith(e);
			}
			if (t.startsWith("**/")) {
				let e = t.slice(3);
				return n.endsWith(e) || r === e;
			}
			return n === t || r === t || n.endsWith("/" + t);
		});
	}
	isCommandDenied(e, t = []) {
		if (!e || !t || t.length === 0) return !1;
		let n = e.trim().toLowerCase();
		return t.some((e) => {
			let t = e.trim().toLowerCase();
			return t && n.includes(t);
		});
	}
	async runAgentTask(e, t, n, r) {
		let { sessionId: i, projectPath: a } = e, o = !!e.config.autoApprove, s = e.config.autoApproveRules, c = o && (!s || s.allowCommands !== !1), l = o && (!s || s.allowFileWrite !== !1);
		if (s && s.allowFileRead, o && s && s.allowSubagents, this.setProjectStatus(a, "running", "Агент анализирует задачу..."), e.config.provider === "anthropic" && (!e.config.apiKey || !e.config.apiKey.trim())) return this.runClaudeCliTask(e, t, n, r);
		try {
			await ye.streamChat(e, async (e) => {
				if (t(e), e.toolCall) {
					let n = e.toolCall;
					if (n.name === "ask_question" || n.name === "AskUserQuestion") {
						let e = this.parseQuestionData(n.args), r = {
							id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
							sessionId: i,
							projectPath: a,
							type: "question",
							title: e.title || "Вопрос от ассистента",
							details: e.subtitle,
							questionData: e,
							createdAt: Date.now()
						};
						t({ approvalRequest: r });
						let o = await this.requestApproval(r);
						n.status = o.approved ? "accepted" : "rejected", n.result = o.text || (o.approved ? "Подтверждено пользователем" : "Отклонено пользователем"), t({ toolCall: n });
					} else if (n.name === "read_file" || n.name === "read") {
						let e = n.args.filePath || n.args.path || "";
						if (s?.readExcludePatterns && this.isPathExcluded(e, s.readExcludePatterns)) {
							let r = {
								id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
								sessionId: i,
								projectPath: a,
								type: "question",
								title: "Разрешение на чтение защищенного файла",
								details: `Файл ${e} находится в списке исключений для чтения. Разрешить агенту доступ?`,
								questionData: {
									title: "Чтение защищенного файла",
									subtitle: `Разрешить агенту прочитать файл ${e}?`,
									options: [{
										id: "allow",
										label: "Разрешить чтение",
										description: "Предоставить агенту содержимое файла"
									}, {
										id: "deny",
										label: "Запретить чтение",
										description: "Скрыть содержимое файла от агента"
									}],
									isMultiSelect: !1,
									allowOther: !1
								},
								createdAt: Date.now()
							};
							t({ approvalRequest: r });
							let o = await this.requestApproval(r);
							if (!o.approved || o.text?.includes("deny") || o.text?.includes("Запретить")) {
								n.status = "rejected", n.result = `Доступ к чтению файла ${e} отклонен пользователем`, t({ toolCall: n });
								return;
							}
						}
					} else if (n.name === "run_command" || n.name === "bash") {
						let e = n.args.command || n.args.cmd || "", r = s?.commandDenyList && this.isCommandDenied(e, s.commandDenyList);
						if (c && !r) {
							this.setProjectStatus(a, "running", `Выполняется: ${e}`);
							try {
								let r = "", i = await this.executeSubprocess(e, a, (e) => {
									r += e, n.status = "running", n.result = r, t({ toolCall: { ...n } });
								});
								n.status = "accepted", n.result = i, t({ toolCall: n });
							} catch (e) {
								n.status = "error", n.result = `Error: ${e.message}`, t({ toolCall: n });
							}
						} else {
							let o = {
								id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
								sessionId: i,
								projectPath: a,
								type: "command",
								title: r ? `⚠️ Заблокированная команда требует подтверждения: ${e}` : `Разрешение на запуск команды: ${e}`,
								command: e,
								details: n.args.explanation || (r ? "Команда находится в списке запрещенных для авто-запуска" : "Выполнение команды терминала"),
								createdAt: Date.now()
							};
							t({ approvalRequest: o });
							let s = await this.requestApproval(o);
							if (s.approved) {
								this.setProjectStatus(a, "running", `Выполняется: ${e}`);
								try {
									let r = "", i = await this.executeSubprocess(e, a, (e) => {
										r += e, n.status = "running", n.result = r, t({ toolCall: { ...n } });
									});
									n.status = "accepted", n.result = i, t({ toolCall: n });
								} catch (e) {
									n.status = "error", n.result = `Error: ${e.message}`, t({ toolCall: n });
								}
							} else n.status = "rejected", n.result = `Отклонено пользователем: ${s.text || "Без комментария"}`, t({ toolCall: n });
						}
						this.setProjectStatus(a, "running", "Обработка результатов...");
					} else if (n.name === "write_file" || n.name === "write_to_file") {
						let e = n.args.filePath || n.args.path || "", r = n.args.content || "", o = s?.writeExcludePatterns && this.isPathExcluded(e, s.writeExcludePatterns);
						if (l && !o) await ye.applyDiff(a, e, r), n.status = "accepted", n.result = `Файл ${e} успешно записан`, t({ toolCall: n });
						else {
							let s = "", c = p.isAbsolute(e) ? e : p.join(a, e);
							if (_(c)) try {
								s = await g.readFile(c, "utf-8");
							} catch {}
							let l = ye.generateDiff(s, r, e);
							n.diff = {
								filePath: e,
								oldContent: s,
								newContent: r,
								patch: l
							};
							let u = {
								id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
								sessionId: i,
								projectPath: a,
								type: "file_write",
								title: o ? `⚠️ Файл в списке исключений: ${e}` : `Разрешение на запись файла: ${e}`,
								filePath: e,
								details: o ? "Файл защищен списком исключений авто-одобрения" : n.args.explanation || "Изменение содержимого файла",
								diff: n.diff,
								createdAt: Date.now()
							};
							t({
								approvalRequest: u,
								toolCall: n
							});
							let d = await this.requestApproval(u);
							d.approved ? (await ye.applyDiff(a, e, r), n.status = "accepted", n.result = `Файл ${e} успешно сохранен`, t({ toolCall: n })) : (n.status = "rejected", n.result = `Отклонено пользователем: ${d.text || "Без комментария"}`, t({ toolCall: n }));
						}
					} else if (n.name === "spawn_subagent" || n.name === "dispatch_agent") {
						let e = n.args.task || n.args.prompt || "Подзадача", r = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, o = {
							id: r,
							parentSessionId: i,
							projectPath: a,
							name: n.args.name || `Подагент #${r.slice(-4)}`,
							task: e,
							status: "running",
							progress: "Инициализация подзадачи...",
							startedAt: Date.now()
						};
						this.registerSubagent(o), t({ subagent: o });
					}
				}
			}, (e) => {
				this.setProjectStatus(a, "done", "Задача успешно выполнена"), n(e);
			}, (e) => {
				this.setProjectStatus(a, "error", `Ошибка: ${e}`), r(e);
			});
		} catch (e) {
			this.setProjectStatus(a, "error", e.message), r(e.message);
		}
	}
	sessionClaudeCliIds = /* @__PURE__ */ new Map();
	clearSession(e) {
		this.sessionClaudeCliIds.delete(e), this.abortSession(e);
	}
	async runClaudeCliTask(e, t, n, r) {
		let { sessionId: i, projectPath: a, messages: o } = e, s = [...o].reverse().find((e) => e.role === "user")?.content || "";
		if (!s.trim()) {
			n({
				id: `msg-${Date.now()}`,
				role: "assistant",
				content: "Пожалуйста, введите сообщение.",
				timestamp: (/* @__PURE__ */ new Date()).toISOString()
			});
			return;
		}
		let c = e.claudeCliSessionId || this.sessionClaudeCliIds.get(i), l = ["-p"];
		c && l.push("--resume", c), e.config.model && e.config.model !== "default" && l.push("--model", e.config.model), l.push("--dangerously-skip-permissions"), l.push("--output-format", "stream-json", "--verbose");
		let u = y("claude", l, {
			cwd: a,
			shell: !0,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			env: {
				...process.env,
				FORCE_COLOR: "0",
				CLAUDE_CONFIG_DIR: _e
			}
		});
		this.activeProcesses.set(i, u), u.stdin.write(s, "utf-8"), u.stdin.end();
		let d = "", f = "", p = [], m = "";
		u.stdout.on("data", async (n) => {
			m += n.toString("utf-8");
			let r = m.split("\n");
			m = r.pop() || "";
			for (let n of r) {
				let r = n.trim();
				if (!(!r || !r.startsWith("{"))) try {
					let n = JSON.parse(r);
					if (n.session_id && (this.sessionClaudeCliIds.set(i, n.session_id), t({ claudeCliSessionId: n.session_id })), n.type === "rate_limit_event" || n.rate_limit_info) {
						let e = n.rate_limit_info || n, r = e.utilization ?? e.unifiedWindows?.[0]?.utilization, i = e.resetsAt || e.reset_at || e.unifiedWindows?.[0]?.resetsAt;
						t({ rateLimitWarning: {
							id: `rl-${Date.now()}`,
							type: e.status === "throttled" ? "throttled" : "rate_limit",
							title: e.status === "throttled" ? "Достигнут лимит запросов Claude Code" : "Приближение к лимиту запросов Claude Code",
							message: e.message || `Использовано ${r ? Math.round(r * 100) : 85}% доступного лимита запросов.`,
							utilization: r ? Math.round(r * 100) : 85,
							resetsAt: i ? new Date(i).toLocaleTimeString([], {
								hour: "2-digit",
								minute: "2-digit"
							}) : void 0,
							timestamp: Date.now()
						} });
					}
					if (n.type === "assistant" && n.message?.content) {
						for (let r of n.message.content) if (r.type === "text") {
							d += r.text, t({ text: r.text });
							let e = r.text.toLowerCase();
							if (e.includes("rate limit") || e.includes("used ") && e.includes("% of your")) {
								let e = r.text.match(/(\d+)%/), n = e ? parseInt(e[1], 10) : 85;
								t({ rateLimitWarning: {
									id: `rl-${Date.now()}`,
									type: n >= 100 ? "throttled" : "rate_limit",
									title: n >= 100 ? "Достигнут лимит запросов Claude Code" : `Приближение к лимиту запросов (${n}%)`,
									message: r.text,
									utilization: n,
									timestamp: Date.now()
								} });
							}
						} else if (r.type === "thinking") f += r.thinking, t({ thought: r.thinking });
						else if (r.type === "tool_use") {
							let n = {
								id: r.id || `tool-${Date.now()}`,
								name: r.name,
								args: r.input || {}
							};
							if (p.push(n), t({ toolCall: n }), r.name === "AskUserQuestion" || r.name === "ask_question" || r.name === "ask_user") {
								let e = this.parseQuestionData(r.input || {});
								t({ approvalRequest: {
									id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
									sessionId: i,
									projectPath: a,
									type: "question",
									title: e.title || "Вопрос от Claude Code",
									details: e.subtitle,
									questionData: e,
									createdAt: Date.now()
								} });
							} else if (r.name === "Write" || r.name === "Edit") {
								let n = r.input?.file_path || r.input?.path || r.input?.target || "", o = e.config.autoApproveRules, s = o?.writeExcludePatterns && this.isPathExcluded(n, o.writeExcludePatterns);
								(!e.config.autoApprove || s || o && o.allowFileWrite === !1) && t({ approvalRequest: {
									id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
									sessionId: i,
									projectPath: a,
									type: "file_write",
									title: s ? `⚠️ Файл в списке исключений: ${n}` : `Запись в файл: ${n}`,
									filePath: n,
									details: s ? "Файл защищен списком исключений авто-одобрения" : `Claude Code запрашивает запись в файл ${n}`,
									createdAt: Date.now()
								} });
							} else if (r.name === "Read" || r.name === "read_file") {
								let n = r.input?.file_path || r.input?.path || r.input?.target || "", o = e.config.autoApproveRules;
								o?.readExcludePatterns && this.isPathExcluded(n, o.readExcludePatterns) && t({ approvalRequest: {
									id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
									sessionId: i,
									projectPath: a,
									type: "question",
									title: "Чтение защищенного файла",
									details: `Файл ${n} находится в списке исключений для чтения. Разрешить Claude Code доступ?`,
									questionData: {
										title: "Чтение защищенного файла",
										subtitle: `Разрешить Claude Code прочитать ${n}?`,
										options: [{
											id: "allow",
											label: "Разрешить чтение",
											description: "Предоставить доступ к файлу"
										}, {
											id: "deny",
											label: "Запретить чтение",
											description: "Заблокировать чтение"
										}],
										isMultiSelect: !1,
										allowOther: !1
									},
									createdAt: Date.now()
								} });
							} else if (r.name === "Bash" || r.name === "bash") {
								let n = r.input?.command || r.input?.cmd || "", o = e.config.autoApproveRules, s = o?.commandDenyList && this.isCommandDenied(n, o.commandDenyList);
								(!e.config.autoApprove || s || o && o.allowCommands === !1) && t({ approvalRequest: {
									id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
									sessionId: i,
									projectPath: a,
									type: "command",
									title: s ? `⚠️ Заблокированная команда: ${n}` : `Команда терминала: ${n}`,
									command: n,
									details: s ? "Команда находится в списке запрещенных для авто-запуска" : `Claude Code выполняет команду ${n}`,
									createdAt: Date.now()
								} });
							}
						}
					} else n.type === "result" && n.result && typeof n.result == "string" && !d && (d = n.result, t({ text: n.result }));
				} catch {
					(r.includes("rate limit") || r.includes("429 Too Many")) && t({ rateLimitWarning: {
						id: `rl-${Date.now()}`,
						type: "rate_limit",
						title: "Предупреждение о лимитах Claude Code",
						message: r,
						timestamp: Date.now()
					} });
				}
			}
		});
		let h = "";
		u.stderr.on("data", (e) => {
			let n = e.toString();
			h += n, (n.includes("rate limit") || n.includes("429 Too Many")) && t({ rateLimitWarning: {
				id: `rl-${Date.now()}`,
				type: "rate_limit",
				title: "Предупреждение о лимитах Claude Code",
				message: n.trim(),
				timestamp: Date.now()
			} });
		}), u.on("close", (e) => {
			if (this.activeProcesses.delete(i), e === 0 || d) {
				let e = {
					id: `msg-${Date.now()}`,
					role: "assistant",
					content: d,
					thought: f,
					toolCalls: p.map((e) => ({
						...e,
						status: e.status || "done"
					})),
					timestamp: (/* @__PURE__ */ new Date()).toISOString()
				};
				this.setProjectStatus(a, "done", "Задача успешно выполнена"), n(e);
			} else {
				let t = h || `Claude Code завершился с кодом ${e}`;
				this.setProjectStatus(a, "error", t), r(t);
			}
		}), u.on("error", (e) => {
			this.activeProcesses.delete(i), this.setProjectStatus(a, "error", e.message), r(e.message);
		});
	}
	executeSubprocess(e, t, n) {
		return new Promise((r, i) => {
			let a = process.platform === "win32", o = y(a ? "powershell.exe" : "/bin/bash", a ? [
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				e
			] : ["-c", e], {
				cwd: t,
				env: {
					...process.env,
					FORCE_COLOR: "0"
				}
			}), s = "";
			o.stdout.on("data", (e) => {
				let t = e.toString();
				s += t, n?.(t);
			}), o.stderr.on("data", (e) => {
				let t = e.toString();
				s += t, n?.(t);
			}), o.on("close", (e) => {
				r(e === 0 ? s || "Команда успешно выполнена (код 0)" : `Команда завершилась с кодом ${e}:\n${s}`);
			}), o.on("error", (e) => {
				i(e);
			});
		});
	}
}(), Se = new class {
	status = "unloaded";
	modelName = "Xenova/whisper-base";
	cacheDir;
	worker = null;
	errorMessage;
	loadStartTime = 0;
	loadTimeMs;
	requestIdCounter = 0;
	pendingJobs = /* @__PURE__ */ new Map();
	fallbackPipeline = null;
	constructor() {
		this.cacheDir = p.join(S.homedir(), ".cache", "projecthub", "whisper");
	}
	getState() {
		return {
			status: this.status,
			model: this.modelName,
			cacheDir: this.cacheDir,
			workerActive: !!this.worker,
			queueLength: this.pendingJobs.size,
			error: this.errorMessage,
			loadTimeMs: this.loadTimeMs
		};
	}
	initBackground() {
		this.status !== "loading" && this.status !== "ready" && (this.status = "loading", this.loadStartTime = Date.now(), console.log(`[LocalWhisper] Initializing isolated Worker thread for ${this.modelName}...`), this.spawnWorker());
	}
	resolveWorkerPath() {
		let e = [
			p.join(process.cwd(), "dist-electron", "workers", "whisperWorker.mjs"),
			p.join(process.cwd(), "electron", "workers", "whisperWorker.mjs"),
			p.join(p.dirname(h(import.meta.url)), "../workers/whisperWorker.mjs"),
			p.join(p.dirname(h(import.meta.url)), "workers/whisperWorker.mjs")
		];
		for (let t of e) if (_(t)) return t;
		return e[1];
	}
	spawnWorker() {
		try {
			let e = this.resolveWorkerPath();
			if (!e || !_(e)) {
				console.warn(`[LocalWhisper] Worker script not found at ${e}, using in-process fallback`), this.initInProcessFallback();
				return;
			}
			console.log(`[LocalWhisper] Spawning Worker thread at ${e}`);
			let t = new ee(e);
			this.worker = t, t.on("message", (e) => {
				if (e) {
					if (e.type === "ready") this.status = "ready", this.loadTimeMs = e.loadTimeMs || Date.now() - this.loadStartTime, console.log(`[LocalWhisper] Isolated Worker thread is READY (${this.loadTimeMs}ms)`);
					else if (e.type === "init_error") this.status = "error", this.errorMessage = e.error, console.warn("[LocalWhisper] Worker initialization error:", e.error);
					else if (e.type === "result") {
						let t = this.pendingJobs.get(e.id);
						t && (this.pendingJobs.delete(e.id), t.resolve({
							text: e.text,
							timeMs: e.timeMs
						}));
					} else if (e.type === "error") {
						let t = this.pendingJobs.get(e.id);
						t && (this.pendingJobs.delete(e.id), t.reject(Error(e.error)));
					}
				}
			}), t.on("error", (e) => {
				console.error("[LocalWhisper] Worker thread runtime error:", e), this.status = "error", this.errorMessage = e?.message || String(e), this.flushPendingWithError(e);
			}), t.on("exit", (e) => {
				console.warn(`[LocalWhisper] Worker thread exited with code ${e}`), this.worker = null, e !== 0 && this.status !== "ready" && this.initInProcessFallback();
			}), t.postMessage({ type: "init" });
		} catch (e) {
			console.error("[LocalWhisper] Failed to spawn worker thread:", e), this.initInProcessFallback();
		}
	}
	flushPendingWithError(e) {
		for (let [t, n] of this.pendingJobs.entries()) n.reject(e), this.pendingJobs.delete(t);
	}
	async initInProcessFallback() {
		try {
			console.log("[LocalWhisper] Initializing in-process Transformers fallback..."), await g.mkdir(this.cacheDir, { recursive: !0 });
			let e = await import("./transformers.node-COFdxZ8y.js");
			e.env && (e.env.cacheDir = this.cacheDir, e.env.allowLocalModels = !0), this.fallbackPipeline = await e.pipeline("automatic-speech-recognition", this.modelName, { dtype: "fp32" }), this.status = "ready", this.loadTimeMs = Date.now() - this.loadStartTime, console.log(`[LocalWhisper] In-process fallback pipeline is READY (${this.loadTimeMs}ms)`);
		} catch (e) {
			this.status = "error", this.errorMessage = e.message;
		}
	}
	async transcribe(e, t = "ru") {
		let n = Date.now(), r = e instanceof Float32Array ? e : new Float32Array(e);
		if (r.length < 1600) return {
			text: "",
			timeMs: 0
		};
		if (this.worker) {
			let e = `whisper-req-${++this.requestIdCounter}-${Date.now()}`;
			return new Promise((i, a) => {
				this.pendingJobs.set(e, {
					id: e,
					audioData: r,
					language: t,
					resolve: i,
					reject: a,
					startTime: n
				}), this.worker.postMessage({
					type: "transcribe",
					id: e,
					audioData: r,
					language: t
				}), setTimeout(() => {
					this.pendingJobs.has(e) && (this.pendingJobs.delete(e), a(/* @__PURE__ */ Error("Whisper transcription timed out after 30s")));
				}, 3e4);
			});
		}
		if (this.fallbackPipeline) {
			let e = t === "en" ? "english" : "russian";
			return {
				text: ((await this.fallbackPipeline(r, {
					language: e,
					task: "transcribe",
					chunk_length_s: 30,
					stride_length_s: 5
				}))?.text || "").trim(),
				timeMs: Date.now() - n
			};
		}
		throw Error("Local Whisper pipeline is currently initializing in background");
	}
	async dispose() {
		if (this.flushPendingWithError(/* @__PURE__ */ Error("Whisper service disposed")), this.worker) {
			try {
				await this.worker.terminate();
			} catch (e) {
				console.warn("[LocalWhisper] Error terminating worker thread:", e);
			}
			this.worker = null;
		}
		this.fallbackPipeline = null, this.status = "unloaded", console.log("[LocalWhisper] Service disposed and worker terminated");
	}
}(), w;
(function(e) {
	e.assertEqual = (e) => {};
	function t(e) {}
	e.assertIs = t;
	function n(e) {
		throw Error();
	}
	e.assertNever = n, e.arrayToEnum = (e) => {
		let t = {};
		for (let n of e) t[n] = n;
		return t;
	}, e.getValidEnumValues = (t) => {
		let n = e.objectKeys(t).filter((e) => typeof t[t[e]] != "number"), r = {};
		for (let e of n) r[e] = t[e];
		return e.objectValues(r);
	}, e.objectValues = (t) => e.objectKeys(t).map(function(e) {
		return t[e];
	}), e.objectKeys = typeof Object.keys == "function" ? (e) => Object.keys(e) : (e) => {
		let t = [];
		for (let n in e) Object.prototype.hasOwnProperty.call(e, n) && t.push(n);
		return t;
	}, e.find = (e, t) => {
		for (let n of e) if (t(n)) return n;
	}, e.isInteger = typeof Number.isInteger == "function" ? (e) => Number.isInteger(e) : (e) => typeof e == "number" && Number.isFinite(e) && Math.floor(e) === e;
	function r(e, t = " | ") {
		return e.map((e) => typeof e == "string" ? `'${e}'` : e).join(t);
	}
	e.joinValues = r, e.jsonStringifyReplacer = (e, t) => typeof t == "bigint" ? t.toString() : t;
})(w ||= {});
var Ce;
(function(e) {
	e.mergeShapes = (e, t) => ({
		...e,
		...t
	});
})(Ce ||= {});
var T = w.arrayToEnum([
	"string",
	"nan",
	"number",
	"integer",
	"float",
	"boolean",
	"date",
	"bigint",
	"symbol",
	"function",
	"undefined",
	"null",
	"array",
	"object",
	"unknown",
	"promise",
	"void",
	"never",
	"map",
	"set"
]), we = (e) => {
	switch (typeof e) {
		case "undefined": return T.undefined;
		case "string": return T.string;
		case "number": return Number.isNaN(e) ? T.nan : T.number;
		case "boolean": return T.boolean;
		case "function": return T.function;
		case "bigint": return T.bigint;
		case "symbol": return T.symbol;
		case "object": return Array.isArray(e) ? T.array : e === null ? T.null : e.then && typeof e.then == "function" && e.catch && typeof e.catch == "function" ? T.promise : typeof Map < "u" && e instanceof Map ? T.map : typeof Set < "u" && e instanceof Set ? T.set : typeof Date < "u" && e instanceof Date ? T.date : T.object;
		default: return T.unknown;
	}
}, E = w.arrayToEnum([
	"invalid_type",
	"invalid_literal",
	"custom",
	"invalid_union",
	"invalid_union_discriminator",
	"invalid_enum_value",
	"unrecognized_keys",
	"invalid_arguments",
	"invalid_return_type",
	"invalid_date",
	"invalid_string",
	"too_small",
	"too_big",
	"invalid_intersection_types",
	"not_multiple_of",
	"not_finite"
]), Te = class e extends Error {
	get errors() {
		return this.issues;
	}
	constructor(e) {
		super(), this.issues = [], this.addIssue = (e) => {
			this.issues = [...this.issues, e];
		}, this.addIssues = (e = []) => {
			this.issues = [...this.issues, ...e];
		};
		let t = new.target.prototype;
		Object.setPrototypeOf ? Object.setPrototypeOf(this, t) : this.__proto__ = t, this.name = "ZodError", this.issues = e;
	}
	format(e) {
		let t = e || function(e) {
			return e.message;
		}, n = { _errors: [] }, r = (e) => {
			for (let i of e.issues) if (i.code === "invalid_union") i.unionErrors.map(r);
			else if (i.code === "invalid_return_type") r(i.returnTypeError);
			else if (i.code === "invalid_arguments") r(i.argumentsError);
			else if (i.path.length === 0) n._errors.push(t(i));
			else {
				let e = n, r = 0;
				for (; r < i.path.length;) {
					let n = i.path[r];
					r === i.path.length - 1 ? (e[n] = e[n] || { _errors: [] }, e[n]._errors.push(t(i))) : e[n] = e[n] || { _errors: [] }, e = e[n], r++;
				}
			}
		};
		return r(this), n;
	}
	static assert(t) {
		if (!(t instanceof e)) throw Error(`Not a ZodError: ${t}`);
	}
	toString() {
		return this.message;
	}
	get message() {
		return JSON.stringify(this.issues, w.jsonStringifyReplacer, 2);
	}
	get isEmpty() {
		return this.issues.length === 0;
	}
	flatten(e = (e) => e.message) {
		let t = {}, n = [];
		for (let r of this.issues) if (r.path.length > 0) {
			let n = r.path[0];
			t[n] = t[n] || [], t[n].push(e(r));
		} else n.push(e(r));
		return {
			formErrors: n,
			fieldErrors: t
		};
	}
	get formErrors() {
		return this.flatten();
	}
};
Te.create = (e) => new Te(e);
//#endregion
//#region node_modules/zod/v3/locales/en.js
var Ee = (e, t) => {
	let n;
	switch (e.code) {
		case E.invalid_type:
			n = e.received === T.undefined ? "Required" : `Expected ${e.expected}, received ${e.received}`;
			break;
		case E.invalid_literal:
			n = `Invalid literal value, expected ${JSON.stringify(e.expected, w.jsonStringifyReplacer)}`;
			break;
		case E.unrecognized_keys:
			n = `Unrecognized key(s) in object: ${w.joinValues(e.keys, ", ")}`;
			break;
		case E.invalid_union:
			n = "Invalid input";
			break;
		case E.invalid_union_discriminator:
			n = `Invalid discriminator value. Expected ${w.joinValues(e.options)}`;
			break;
		case E.invalid_enum_value:
			n = `Invalid enum value. Expected ${w.joinValues(e.options)}, received '${e.received}'`;
			break;
		case E.invalid_arguments:
			n = "Invalid function arguments";
			break;
		case E.invalid_return_type:
			n = "Invalid function return type";
			break;
		case E.invalid_date:
			n = "Invalid date";
			break;
		case E.invalid_string:
			typeof e.validation == "object" ? "includes" in e.validation ? (n = `Invalid input: must include "${e.validation.includes}"`, typeof e.validation.position == "number" && (n = `${n} at one or more positions greater than or equal to ${e.validation.position}`)) : "startsWith" in e.validation ? n = `Invalid input: must start with "${e.validation.startsWith}"` : "endsWith" in e.validation ? n = `Invalid input: must end with "${e.validation.endsWith}"` : w.assertNever(e.validation) : n = e.validation === "regex" ? "Invalid" : `Invalid ${e.validation}`;
			break;
		case E.too_small:
			n = e.type === "array" ? `Array must contain ${e.exact ? "exactly" : e.inclusive ? "at least" : "more than"} ${e.minimum} element(s)` : e.type === "string" ? `String must contain ${e.exact ? "exactly" : e.inclusive ? "at least" : "over"} ${e.minimum} character(s)` : e.type === "number" || e.type === "bigint" ? `Number must be ${e.exact ? "exactly equal to " : e.inclusive ? "greater than or equal to " : "greater than "}${e.minimum}` : e.type === "date" ? `Date must be ${e.exact ? "exactly equal to " : e.inclusive ? "greater than or equal to " : "greater than "}${new Date(Number(e.minimum))}` : "Invalid input";
			break;
		case E.too_big:
			n = e.type === "array" ? `Array must contain ${e.exact ? "exactly" : e.inclusive ? "at most" : "less than"} ${e.maximum} element(s)` : e.type === "string" ? `String must contain ${e.exact ? "exactly" : e.inclusive ? "at most" : "under"} ${e.maximum} character(s)` : e.type === "number" ? `Number must be ${e.exact ? "exactly" : e.inclusive ? "less than or equal to" : "less than"} ${e.maximum}` : e.type === "bigint" ? `BigInt must be ${e.exact ? "exactly" : e.inclusive ? "less than or equal to" : "less than"} ${e.maximum}` : e.type === "date" ? `Date must be ${e.exact ? "exactly" : e.inclusive ? "smaller than or equal to" : "smaller than"} ${new Date(Number(e.maximum))}` : "Invalid input";
			break;
		case E.custom:
			n = "Invalid input";
			break;
		case E.invalid_intersection_types:
			n = "Intersection results could not be merged";
			break;
		case E.not_multiple_of:
			n = `Number must be a multiple of ${e.multipleOf}`;
			break;
		case E.not_finite:
			n = "Number must be finite";
			break;
		default: n = t.defaultError, w.assertNever(e);
	}
	return { message: n };
}, De = Ee;
function Oe() {
	return De;
}
//#endregion
//#region node_modules/zod/v3/helpers/parseUtil.js
var ke = (e) => {
	let { data: t, path: n, errorMaps: r, issueData: i } = e, a = [...n, ...i.path || []], o = {
		...i,
		path: a
	};
	if (i.message !== void 0) return {
		...i,
		path: a,
		message: i.message
	};
	let s = "", c = r.filter((e) => !!e).slice().reverse();
	for (let e of c) s = e(o, {
		data: t,
		defaultError: s
	}).message;
	return {
		...i,
		path: a,
		message: s
	};
};
function D(e, t) {
	let n = Oe(), r = ke({
		issueData: t,
		data: e.data,
		path: e.path,
		errorMaps: [
			e.common.contextualErrorMap,
			e.schemaErrorMap,
			n,
			n === Ee ? void 0 : Ee
		].filter((e) => !!e)
	});
	e.common.issues.push(r);
}
var Ae = class e {
	constructor() {
		this.value = "valid";
	}
	dirty() {
		this.value === "valid" && (this.value = "dirty");
	}
	abort() {
		this.value !== "aborted" && (this.value = "aborted");
	}
	static mergeArray(e, t) {
		let n = [];
		for (let r of t) {
			if (r.status === "aborted") return O;
			r.status === "dirty" && e.dirty(), n.push(r.value);
		}
		return {
			status: e.value,
			value: n
		};
	}
	static async mergeObjectAsync(t, n) {
		let r = [];
		for (let e of n) {
			let t = await e.key, n = await e.value;
			r.push({
				key: t,
				value: n
			});
		}
		return e.mergeObjectSync(t, r);
	}
	static mergeObjectSync(e, t) {
		let n = {};
		for (let r of t) {
			let { key: t, value: i } = r;
			if (t.status === "aborted" || i.status === "aborted") return O;
			t.status === "dirty" && e.dirty(), i.status === "dirty" && e.dirty(), t.value !== "__proto__" && (i.value !== void 0 || r.alwaysSet) && (n[t.value] = i.value);
		}
		return {
			status: e.value,
			value: n
		};
	}
}, O = Object.freeze({ status: "aborted" }), je = (e) => ({
	status: "dirty",
	value: e
}), Me = (e) => ({
	status: "valid",
	value: e
}), Ne = (e) => e.status === "aborted", Pe = (e) => e.status === "dirty", Fe = (e) => e.status === "valid", Ie = (e) => typeof Promise < "u" && e instanceof Promise, k;
(function(e) {
	e.errToObj = (e) => typeof e == "string" ? { message: e } : e || {}, e.toString = (e) => typeof e == "string" ? e : e?.message;
})(k ||= {});
//#endregion
//#region node_modules/zod/v3/types.js
var Le = class {
	constructor(e, t, n, r) {
		this._cachedPath = [], this.parent = e, this.data = t, this._path = n, this._key = r;
	}
	get path() {
		return this._cachedPath.length || (Array.isArray(this._key) ? this._cachedPath.push(...this._path, ...this._key) : this._cachedPath.push(...this._path, this._key)), this._cachedPath;
	}
}, Re = (e, t) => {
	if (Fe(t)) return {
		success: !0,
		data: t.value
	};
	if (!e.common.issues.length) throw Error("Validation failed but no issues detected.");
	return {
		success: !1,
		get error() {
			if (this._error) return this._error;
			let t = new Te(e.common.issues);
			return this._error = t, this._error;
		}
	};
};
function A(e) {
	if (!e) return {};
	let { errorMap: t, invalid_type_error: n, required_error: r, description: i } = e;
	if (t && (n || r)) throw Error("Can't use \"invalid_type_error\" or \"required_error\" in conjunction with custom error map.");
	return t ? {
		errorMap: t,
		description: i
	} : {
		errorMap: (t, i) => {
			let { message: a } = e;
			return t.code === "invalid_enum_value" ? { message: a ?? i.defaultError } : i.data === void 0 ? { message: a ?? r ?? i.defaultError } : t.code === "invalid_type" ? { message: a ?? n ?? i.defaultError } : { message: i.defaultError };
		},
		description: i
	};
}
var j = class {
	get description() {
		return this._def.description;
	}
	_getType(e) {
		return we(e.data);
	}
	_getOrReturnCtx(e, t) {
		return t || {
			common: e.parent.common,
			data: e.data,
			parsedType: we(e.data),
			schemaErrorMap: this._def.errorMap,
			path: e.path,
			parent: e.parent
		};
	}
	_processInputParams(e) {
		return {
			status: new Ae(),
			ctx: {
				common: e.parent.common,
				data: e.data,
				parsedType: we(e.data),
				schemaErrorMap: this._def.errorMap,
				path: e.path,
				parent: e.parent
			}
		};
	}
	_parseSync(e) {
		let t = this._parse(e);
		if (Ie(t)) throw Error("Synchronous parse encountered promise.");
		return t;
	}
	_parseAsync(e) {
		let t = this._parse(e);
		return Promise.resolve(t);
	}
	parse(e, t) {
		let n = this.safeParse(e, t);
		if (n.success) return n.data;
		throw n.error;
	}
	safeParse(e, t) {
		let n = {
			common: {
				issues: [],
				async: t?.async ?? !1,
				contextualErrorMap: t?.errorMap
			},
			path: t?.path || [],
			schemaErrorMap: this._def.errorMap,
			parent: null,
			data: e,
			parsedType: we(e)
		};
		return Re(n, this._parseSync({
			data: e,
			path: n.path,
			parent: n
		}));
	}
	"~validate"(e) {
		let t = {
			common: {
				issues: [],
				async: !!this["~standard"].async
			},
			path: [],
			schemaErrorMap: this._def.errorMap,
			parent: null,
			data: e,
			parsedType: we(e)
		};
		if (!this["~standard"].async) try {
			let n = this._parseSync({
				data: e,
				path: [],
				parent: t
			});
			return Fe(n) ? { value: n.value } : { issues: t.common.issues };
		} catch (e) {
			e?.message?.toLowerCase()?.includes("encountered") && (this["~standard"].async = !0), t.common = {
				issues: [],
				async: !0
			};
		}
		return this._parseAsync({
			data: e,
			path: [],
			parent: t
		}).then((e) => Fe(e) ? { value: e.value } : { issues: t.common.issues });
	}
	async parseAsync(e, t) {
		let n = await this.safeParseAsync(e, t);
		if (n.success) return n.data;
		throw n.error;
	}
	async safeParseAsync(e, t) {
		let n = {
			common: {
				issues: [],
				contextualErrorMap: t?.errorMap,
				async: !0
			},
			path: t?.path || [],
			schemaErrorMap: this._def.errorMap,
			parent: null,
			data: e,
			parsedType: we(e)
		}, r = this._parse({
			data: e,
			path: n.path,
			parent: n
		});
		return Re(n, await (Ie(r) ? r : Promise.resolve(r)));
	}
	refine(e, t) {
		let n = (e) => typeof t == "string" || t === void 0 ? { message: t } : typeof t == "function" ? t(e) : t;
		return this._refinement((t, r) => {
			let i = e(t), a = () => r.addIssue({
				code: E.custom,
				...n(t)
			});
			return typeof Promise < "u" && i instanceof Promise ? i.then((e) => e ? !0 : (a(), !1)) : i ? !0 : (a(), !1);
		});
	}
	refinement(e, t) {
		return this._refinement((n, r) => e(n) ? !0 : (r.addIssue(typeof t == "function" ? t(n, r) : t), !1));
	}
	_refinement(e) {
		return new Vt({
			schema: this,
			typeName: M.ZodEffects,
			effect: {
				type: "refinement",
				refinement: e
			}
		});
	}
	superRefine(e) {
		return this._refinement(e);
	}
	constructor(e) {
		this.spa = this.safeParseAsync, this._def = e, this.parse = this.parse.bind(this), this.safeParse = this.safeParse.bind(this), this.parseAsync = this.parseAsync.bind(this), this.safeParseAsync = this.safeParseAsync.bind(this), this.spa = this.spa.bind(this), this.refine = this.refine.bind(this), this.refinement = this.refinement.bind(this), this.superRefine = this.superRefine.bind(this), this.optional = this.optional.bind(this), this.nullable = this.nullable.bind(this), this.nullish = this.nullish.bind(this), this.array = this.array.bind(this), this.promise = this.promise.bind(this), this.or = this.or.bind(this), this.and = this.and.bind(this), this.transform = this.transform.bind(this), this.brand = this.brand.bind(this), this.default = this.default.bind(this), this.catch = this.catch.bind(this), this.describe = this.describe.bind(this), this.pipe = this.pipe.bind(this), this.readonly = this.readonly.bind(this), this.isNullable = this.isNullable.bind(this), this.isOptional = this.isOptional.bind(this), this["~standard"] = {
			version: 1,
			vendor: "zod",
			validate: (e) => this["~validate"](e)
		};
	}
	optional() {
		return Ht.create(this, this._def);
	}
	nullable() {
		return Ut.create(this, this._def);
	}
	nullish() {
		return this.nullable().optional();
	}
	array() {
		return St.create(this);
	}
	promise() {
		return Bt.create(this, this._def);
	}
	or(e) {
		return Tt.create([this, e], this._def);
	}
	and(e) {
		return kt.create(this, e, this._def);
	}
	transform(e) {
		return new Vt({
			...A(this._def),
			schema: this,
			typeName: M.ZodEffects,
			effect: {
				type: "transform",
				transform: e
			}
		});
	}
	default(e) {
		let t = typeof e == "function" ? e : () => e;
		return new Wt({
			...A(this._def),
			innerType: this,
			defaultValue: t,
			typeName: M.ZodDefault
		});
	}
	brand() {
		return new qt({
			typeName: M.ZodBranded,
			type: this,
			...A(this._def)
		});
	}
	catch(e) {
		let t = typeof e == "function" ? e : () => e;
		return new Gt({
			...A(this._def),
			innerType: this,
			catchValue: t,
			typeName: M.ZodCatch
		});
	}
	describe(e) {
		let t = this.constructor;
		return new t({
			...this._def,
			description: e
		});
	}
	pipe(e) {
		return Jt.create(this, e);
	}
	readonly() {
		return Yt.create(this);
	}
	isOptional() {
		return this.safeParse(void 0).success;
	}
	isNullable() {
		return this.safeParse(null).success;
	}
}, ze = /^c[^\s-]{8,}$/i, Be = /^[0-9a-z]+$/, Ve = /^[0-9A-HJKMNP-TV-Z]{26}$/i, He = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i, Ue = /^[a-z0-9_-]{21}$/i, We = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/, Ge = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/, Ke = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i, qe = "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$", Je, Ye = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, Xe = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/, Ze = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/, Qe = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, $e = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/, et = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/, tt = "((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))", nt = RegExp(`^${tt}$`);
function rt(e) {
	let t = "[0-5]\\d";
	e.precision ? t = `${t}\\.\\d{${e.precision}}` : e.precision ?? (t = `${t}(\\.\\d+)?`);
	let n = e.precision ? "+" : "?";
	return `([01]\\d|2[0-3]):[0-5]\\d(:${t})${n}`;
}
function it(e) {
	return RegExp(`^${rt(e)}$`);
}
function at(e) {
	let t = `${tt}T${rt(e)}`, n = [];
	return n.push(e.local ? "Z?" : "Z"), e.offset && n.push("([+-]\\d{2}:?\\d{2})"), t = `${t}(${n.join("|")})`, RegExp(`^${t}$`);
}
function ot(e, t) {
	return !!((t === "v4" || !t) && Ye.test(e) || (t === "v6" || !t) && Ze.test(e));
}
function st(e, t) {
	if (!We.test(e)) return !1;
	try {
		let [n] = e.split(".");
		if (!n) return !1;
		let r = n.replace(/-/g, "+").replace(/_/g, "/").padEnd(n.length + (4 - n.length % 4) % 4, "="), i = JSON.parse(atob(r));
		return !(typeof i != "object" || !i || "typ" in i && i?.typ !== "JWT" || !i.alg || t && i.alg !== t);
	} catch {
		return !1;
	}
}
function ct(e, t) {
	return !!((t === "v4" || !t) && Xe.test(e) || (t === "v6" || !t) && Qe.test(e));
}
var lt = class e extends j {
	_parse(e) {
		if (this._def.coerce && (e.data = String(e.data)), this._getType(e) !== T.string) {
			let t = this._getOrReturnCtx(e);
			return D(t, {
				code: E.invalid_type,
				expected: T.string,
				received: t.parsedType
			}), O;
		}
		let t = new Ae(), n;
		for (let r of this._def.checks) if (r.kind === "min") e.data.length < r.value && (n = this._getOrReturnCtx(e, n), D(n, {
			code: E.too_small,
			minimum: r.value,
			type: "string",
			inclusive: !0,
			exact: !1,
			message: r.message
		}), t.dirty());
		else if (r.kind === "max") e.data.length > r.value && (n = this._getOrReturnCtx(e, n), D(n, {
			code: E.too_big,
			maximum: r.value,
			type: "string",
			inclusive: !0,
			exact: !1,
			message: r.message
		}), t.dirty());
		else if (r.kind === "length") {
			let i = e.data.length > r.value, a = e.data.length < r.value;
			(i || a) && (n = this._getOrReturnCtx(e, n), i ? D(n, {
				code: E.too_big,
				maximum: r.value,
				type: "string",
				inclusive: !0,
				exact: !0,
				message: r.message
			}) : a && D(n, {
				code: E.too_small,
				minimum: r.value,
				type: "string",
				inclusive: !0,
				exact: !0,
				message: r.message
			}), t.dirty());
		} else if (r.kind === "email") Ke.test(e.data) || (n = this._getOrReturnCtx(e, n), D(n, {
			validation: "email",
			code: E.invalid_string,
			message: r.message
		}), t.dirty());
		else if (r.kind === "emoji") Je ||= new RegExp(qe, "u"), Je.test(e.data) || (n = this._getOrReturnCtx(e, n), D(n, {
			validation: "emoji",
			code: E.invalid_string,
			message: r.message
		}), t.dirty());
		else if (r.kind === "uuid") He.test(e.data) || (n = this._getOrReturnCtx(e, n), D(n, {
			validation: "uuid",
			code: E.invalid_string,
			message: r.message
		}), t.dirty());
		else if (r.kind === "nanoid") Ue.test(e.data) || (n = this._getOrReturnCtx(e, n), D(n, {
			validation: "nanoid",
			code: E.invalid_string,
			message: r.message
		}), t.dirty());
		else if (r.kind === "cuid") ze.test(e.data) || (n = this._getOrReturnCtx(e, n), D(n, {
			validation: "cuid",
			code: E.invalid_string,
			message: r.message
		}), t.dirty());
		else if (r.kind === "cuid2") Be.test(e.data) || (n = this._getOrReturnCtx(e, n), D(n, {
			validation: "cuid2",
			code: E.invalid_string,
			message: r.message
		}), t.dirty());
		else if (r.kind === "ulid") Ve.test(e.data) || (n = this._getOrReturnCtx(e, n), D(n, {
			validation: "ulid",
			code: E.invalid_string,
			message: r.message
		}), t.dirty());
		else if (r.kind === "url") try {
			new URL(e.data);
		} catch {
			n = this._getOrReturnCtx(e, n), D(n, {
				validation: "url",
				code: E.invalid_string,
				message: r.message
			}), t.dirty();
		}
		else r.kind === "regex" ? (r.regex.lastIndex = 0, r.regex.test(e.data) || (n = this._getOrReturnCtx(e, n), D(n, {
			validation: "regex",
			code: E.invalid_string,
			message: r.message
		}), t.dirty())) : r.kind === "trim" ? e.data = e.data.trim() : r.kind === "includes" ? e.data.includes(r.value, r.position) || (n = this._getOrReturnCtx(e, n), D(n, {
			code: E.invalid_string,
			validation: {
				includes: r.value,
				position: r.position
			},
			message: r.message
		}), t.dirty()) : r.kind === "toLowerCase" ? e.data = e.data.toLowerCase() : r.kind === "toUpperCase" ? e.data = e.data.toUpperCase() : r.kind === "startsWith" ? e.data.startsWith(r.value) || (n = this._getOrReturnCtx(e, n), D(n, {
			code: E.invalid_string,
			validation: { startsWith: r.value },
			message: r.message
		}), t.dirty()) : r.kind === "endsWith" ? e.data.endsWith(r.value) || (n = this._getOrReturnCtx(e, n), D(n, {
			code: E.invalid_string,
			validation: { endsWith: r.value },
			message: r.message
		}), t.dirty()) : r.kind === "datetime" ? at(r).test(e.data) || (n = this._getOrReturnCtx(e, n), D(n, {
			code: E.invalid_string,
			validation: "datetime",
			message: r.message
		}), t.dirty()) : r.kind === "date" ? nt.test(e.data) || (n = this._getOrReturnCtx(e, n), D(n, {
			code: E.invalid_string,
			validation: "date",
			message: r.message
		}), t.dirty()) : r.kind === "time" ? it(r).test(e.data) || (n = this._getOrReturnCtx(e, n), D(n, {
			code: E.invalid_string,
			validation: "time",
			message: r.message
		}), t.dirty()) : r.kind === "duration" ? Ge.test(e.data) || (n = this._getOrReturnCtx(e, n), D(n, {
			validation: "duration",
			code: E.invalid_string,
			message: r.message
		}), t.dirty()) : r.kind === "ip" ? ot(e.data, r.version) || (n = this._getOrReturnCtx(e, n), D(n, {
			validation: "ip",
			code: E.invalid_string,
			message: r.message
		}), t.dirty()) : r.kind === "jwt" ? st(e.data, r.alg) || (n = this._getOrReturnCtx(e, n), D(n, {
			validation: "jwt",
			code: E.invalid_string,
			message: r.message
		}), t.dirty()) : r.kind === "cidr" ? ct(e.data, r.version) || (n = this._getOrReturnCtx(e, n), D(n, {
			validation: "cidr",
			code: E.invalid_string,
			message: r.message
		}), t.dirty()) : r.kind === "base64" ? $e.test(e.data) || (n = this._getOrReturnCtx(e, n), D(n, {
			validation: "base64",
			code: E.invalid_string,
			message: r.message
		}), t.dirty()) : r.kind === "base64url" ? et.test(e.data) || (n = this._getOrReturnCtx(e, n), D(n, {
			validation: "base64url",
			code: E.invalid_string,
			message: r.message
		}), t.dirty()) : w.assertNever(r);
		return {
			status: t.value,
			value: e.data
		};
	}
	_regex(e, t, n) {
		return this.refinement((t) => e.test(t), {
			validation: t,
			code: E.invalid_string,
			...k.errToObj(n)
		});
	}
	_addCheck(t) {
		return new e({
			...this._def,
			checks: [...this._def.checks, t]
		});
	}
	email(e) {
		return this._addCheck({
			kind: "email",
			...k.errToObj(e)
		});
	}
	url(e) {
		return this._addCheck({
			kind: "url",
			...k.errToObj(e)
		});
	}
	emoji(e) {
		return this._addCheck({
			kind: "emoji",
			...k.errToObj(e)
		});
	}
	uuid(e) {
		return this._addCheck({
			kind: "uuid",
			...k.errToObj(e)
		});
	}
	nanoid(e) {
		return this._addCheck({
			kind: "nanoid",
			...k.errToObj(e)
		});
	}
	cuid(e) {
		return this._addCheck({
			kind: "cuid",
			...k.errToObj(e)
		});
	}
	cuid2(e) {
		return this._addCheck({
			kind: "cuid2",
			...k.errToObj(e)
		});
	}
	ulid(e) {
		return this._addCheck({
			kind: "ulid",
			...k.errToObj(e)
		});
	}
	base64(e) {
		return this._addCheck({
			kind: "base64",
			...k.errToObj(e)
		});
	}
	base64url(e) {
		return this._addCheck({
			kind: "base64url",
			...k.errToObj(e)
		});
	}
	jwt(e) {
		return this._addCheck({
			kind: "jwt",
			...k.errToObj(e)
		});
	}
	ip(e) {
		return this._addCheck({
			kind: "ip",
			...k.errToObj(e)
		});
	}
	cidr(e) {
		return this._addCheck({
			kind: "cidr",
			...k.errToObj(e)
		});
	}
	datetime(e) {
		return typeof e == "string" ? this._addCheck({
			kind: "datetime",
			precision: null,
			offset: !1,
			local: !1,
			message: e
		}) : this._addCheck({
			kind: "datetime",
			precision: e?.precision === void 0 ? null : e?.precision,
			offset: e?.offset ?? !1,
			local: e?.local ?? !1,
			...k.errToObj(e?.message)
		});
	}
	date(e) {
		return this._addCheck({
			kind: "date",
			message: e
		});
	}
	time(e) {
		return typeof e == "string" ? this._addCheck({
			kind: "time",
			precision: null,
			message: e
		}) : this._addCheck({
			kind: "time",
			precision: e?.precision === void 0 ? null : e?.precision,
			...k.errToObj(e?.message)
		});
	}
	duration(e) {
		return this._addCheck({
			kind: "duration",
			...k.errToObj(e)
		});
	}
	regex(e, t) {
		return this._addCheck({
			kind: "regex",
			regex: e,
			...k.errToObj(t)
		});
	}
	includes(e, t) {
		return this._addCheck({
			kind: "includes",
			value: e,
			position: t?.position,
			...k.errToObj(t?.message)
		});
	}
	startsWith(e, t) {
		return this._addCheck({
			kind: "startsWith",
			value: e,
			...k.errToObj(t)
		});
	}
	endsWith(e, t) {
		return this._addCheck({
			kind: "endsWith",
			value: e,
			...k.errToObj(t)
		});
	}
	min(e, t) {
		return this._addCheck({
			kind: "min",
			value: e,
			...k.errToObj(t)
		});
	}
	max(e, t) {
		return this._addCheck({
			kind: "max",
			value: e,
			...k.errToObj(t)
		});
	}
	length(e, t) {
		return this._addCheck({
			kind: "length",
			value: e,
			...k.errToObj(t)
		});
	}
	nonempty(e) {
		return this.min(1, k.errToObj(e));
	}
	trim() {
		return new e({
			...this._def,
			checks: [...this._def.checks, { kind: "trim" }]
		});
	}
	toLowerCase() {
		return new e({
			...this._def,
			checks: [...this._def.checks, { kind: "toLowerCase" }]
		});
	}
	toUpperCase() {
		return new e({
			...this._def,
			checks: [...this._def.checks, { kind: "toUpperCase" }]
		});
	}
	get isDatetime() {
		return !!this._def.checks.find((e) => e.kind === "datetime");
	}
	get isDate() {
		return !!this._def.checks.find((e) => e.kind === "date");
	}
	get isTime() {
		return !!this._def.checks.find((e) => e.kind === "time");
	}
	get isDuration() {
		return !!this._def.checks.find((e) => e.kind === "duration");
	}
	get isEmail() {
		return !!this._def.checks.find((e) => e.kind === "email");
	}
	get isURL() {
		return !!this._def.checks.find((e) => e.kind === "url");
	}
	get isEmoji() {
		return !!this._def.checks.find((e) => e.kind === "emoji");
	}
	get isUUID() {
		return !!this._def.checks.find((e) => e.kind === "uuid");
	}
	get isNANOID() {
		return !!this._def.checks.find((e) => e.kind === "nanoid");
	}
	get isCUID() {
		return !!this._def.checks.find((e) => e.kind === "cuid");
	}
	get isCUID2() {
		return !!this._def.checks.find((e) => e.kind === "cuid2");
	}
	get isULID() {
		return !!this._def.checks.find((e) => e.kind === "ulid");
	}
	get isIP() {
		return !!this._def.checks.find((e) => e.kind === "ip");
	}
	get isCIDR() {
		return !!this._def.checks.find((e) => e.kind === "cidr");
	}
	get isBase64() {
		return !!this._def.checks.find((e) => e.kind === "base64");
	}
	get isBase64url() {
		return !!this._def.checks.find((e) => e.kind === "base64url");
	}
	get minLength() {
		let e = null;
		for (let t of this._def.checks) t.kind === "min" && (e === null || t.value > e) && (e = t.value);
		return e;
	}
	get maxLength() {
		let e = null;
		for (let t of this._def.checks) t.kind === "max" && (e === null || t.value < e) && (e = t.value);
		return e;
	}
};
lt.create = (e) => new lt({
	checks: [],
	typeName: M.ZodString,
	coerce: e?.coerce ?? !1,
	...A(e)
});
function ut(e, t) {
	let n = (e.toString().split(".")[1] || "").length, r = (t.toString().split(".")[1] || "").length, i = n > r ? n : r;
	return Number.parseInt(e.toFixed(i).replace(".", "")) % Number.parseInt(t.toFixed(i).replace(".", "")) / 10 ** i;
}
var dt = class e extends j {
	constructor() {
		super(...arguments), this.min = this.gte, this.max = this.lte, this.step = this.multipleOf;
	}
	_parse(e) {
		if (this._def.coerce && (e.data = Number(e.data)), this._getType(e) !== T.number) {
			let t = this._getOrReturnCtx(e);
			return D(t, {
				code: E.invalid_type,
				expected: T.number,
				received: t.parsedType
			}), O;
		}
		let t, n = new Ae();
		for (let r of this._def.checks) r.kind === "int" ? w.isInteger(e.data) || (t = this._getOrReturnCtx(e, t), D(t, {
			code: E.invalid_type,
			expected: "integer",
			received: "float",
			message: r.message
		}), n.dirty()) : r.kind === "min" ? (r.inclusive ? e.data < r.value : e.data <= r.value) && (t = this._getOrReturnCtx(e, t), D(t, {
			code: E.too_small,
			minimum: r.value,
			type: "number",
			inclusive: r.inclusive,
			exact: !1,
			message: r.message
		}), n.dirty()) : r.kind === "max" ? (r.inclusive ? e.data > r.value : e.data >= r.value) && (t = this._getOrReturnCtx(e, t), D(t, {
			code: E.too_big,
			maximum: r.value,
			type: "number",
			inclusive: r.inclusive,
			exact: !1,
			message: r.message
		}), n.dirty()) : r.kind === "multipleOf" ? ut(e.data, r.value) !== 0 && (t = this._getOrReturnCtx(e, t), D(t, {
			code: E.not_multiple_of,
			multipleOf: r.value,
			message: r.message
		}), n.dirty()) : r.kind === "finite" ? Number.isFinite(e.data) || (t = this._getOrReturnCtx(e, t), D(t, {
			code: E.not_finite,
			message: r.message
		}), n.dirty()) : w.assertNever(r);
		return {
			status: n.value,
			value: e.data
		};
	}
	gte(e, t) {
		return this.setLimit("min", e, !0, k.toString(t));
	}
	gt(e, t) {
		return this.setLimit("min", e, !1, k.toString(t));
	}
	lte(e, t) {
		return this.setLimit("max", e, !0, k.toString(t));
	}
	lt(e, t) {
		return this.setLimit("max", e, !1, k.toString(t));
	}
	setLimit(t, n, r, i) {
		return new e({
			...this._def,
			checks: [...this._def.checks, {
				kind: t,
				value: n,
				inclusive: r,
				message: k.toString(i)
			}]
		});
	}
	_addCheck(t) {
		return new e({
			...this._def,
			checks: [...this._def.checks, t]
		});
	}
	int(e) {
		return this._addCheck({
			kind: "int",
			message: k.toString(e)
		});
	}
	positive(e) {
		return this._addCheck({
			kind: "min",
			value: 0,
			inclusive: !1,
			message: k.toString(e)
		});
	}
	negative(e) {
		return this._addCheck({
			kind: "max",
			value: 0,
			inclusive: !1,
			message: k.toString(e)
		});
	}
	nonpositive(e) {
		return this._addCheck({
			kind: "max",
			value: 0,
			inclusive: !0,
			message: k.toString(e)
		});
	}
	nonnegative(e) {
		return this._addCheck({
			kind: "min",
			value: 0,
			inclusive: !0,
			message: k.toString(e)
		});
	}
	multipleOf(e, t) {
		return this._addCheck({
			kind: "multipleOf",
			value: e,
			message: k.toString(t)
		});
	}
	finite(e) {
		return this._addCheck({
			kind: "finite",
			message: k.toString(e)
		});
	}
	safe(e) {
		return this._addCheck({
			kind: "min",
			inclusive: !0,
			value: -(2 ** 53 - 1),
			message: k.toString(e)
		})._addCheck({
			kind: "max",
			inclusive: !0,
			value: 2 ** 53 - 1,
			message: k.toString(e)
		});
	}
	get minValue() {
		let e = null;
		for (let t of this._def.checks) t.kind === "min" && (e === null || t.value > e) && (e = t.value);
		return e;
	}
	get maxValue() {
		let e = null;
		for (let t of this._def.checks) t.kind === "max" && (e === null || t.value < e) && (e = t.value);
		return e;
	}
	get isInt() {
		return !!this._def.checks.find((e) => e.kind === "int" || e.kind === "multipleOf" && w.isInteger(e.value));
	}
	get isFinite() {
		let e = null, t = null;
		for (let n of this._def.checks) if (n.kind === "finite" || n.kind === "int" || n.kind === "multipleOf") return !0;
		else n.kind === "min" ? (t === null || n.value > t) && (t = n.value) : n.kind === "max" && (e === null || n.value < e) && (e = n.value);
		return Number.isFinite(t) && Number.isFinite(e);
	}
};
dt.create = (e) => new dt({
	checks: [],
	typeName: M.ZodNumber,
	coerce: e?.coerce || !1,
	...A(e)
});
var ft = class e extends j {
	constructor() {
		super(...arguments), this.min = this.gte, this.max = this.lte;
	}
	_parse(e) {
		if (this._def.coerce) try {
			e.data = BigInt(e.data);
		} catch {
			return this._getInvalidInput(e);
		}
		if (this._getType(e) !== T.bigint) return this._getInvalidInput(e);
		let t, n = new Ae();
		for (let r of this._def.checks) r.kind === "min" ? (r.inclusive ? e.data < r.value : e.data <= r.value) && (t = this._getOrReturnCtx(e, t), D(t, {
			code: E.too_small,
			type: "bigint",
			minimum: r.value,
			inclusive: r.inclusive,
			message: r.message
		}), n.dirty()) : r.kind === "max" ? (r.inclusive ? e.data > r.value : e.data >= r.value) && (t = this._getOrReturnCtx(e, t), D(t, {
			code: E.too_big,
			type: "bigint",
			maximum: r.value,
			inclusive: r.inclusive,
			message: r.message
		}), n.dirty()) : r.kind === "multipleOf" ? e.data % r.value !== BigInt(0) && (t = this._getOrReturnCtx(e, t), D(t, {
			code: E.not_multiple_of,
			multipleOf: r.value,
			message: r.message
		}), n.dirty()) : w.assertNever(r);
		return {
			status: n.value,
			value: e.data
		};
	}
	_getInvalidInput(e) {
		let t = this._getOrReturnCtx(e);
		return D(t, {
			code: E.invalid_type,
			expected: T.bigint,
			received: t.parsedType
		}), O;
	}
	gte(e, t) {
		return this.setLimit("min", e, !0, k.toString(t));
	}
	gt(e, t) {
		return this.setLimit("min", e, !1, k.toString(t));
	}
	lte(e, t) {
		return this.setLimit("max", e, !0, k.toString(t));
	}
	lt(e, t) {
		return this.setLimit("max", e, !1, k.toString(t));
	}
	setLimit(t, n, r, i) {
		return new e({
			...this._def,
			checks: [...this._def.checks, {
				kind: t,
				value: n,
				inclusive: r,
				message: k.toString(i)
			}]
		});
	}
	_addCheck(t) {
		return new e({
			...this._def,
			checks: [...this._def.checks, t]
		});
	}
	positive(e) {
		return this._addCheck({
			kind: "min",
			value: BigInt(0),
			inclusive: !1,
			message: k.toString(e)
		});
	}
	negative(e) {
		return this._addCheck({
			kind: "max",
			value: BigInt(0),
			inclusive: !1,
			message: k.toString(e)
		});
	}
	nonpositive(e) {
		return this._addCheck({
			kind: "max",
			value: BigInt(0),
			inclusive: !0,
			message: k.toString(e)
		});
	}
	nonnegative(e) {
		return this._addCheck({
			kind: "min",
			value: BigInt(0),
			inclusive: !0,
			message: k.toString(e)
		});
	}
	multipleOf(e, t) {
		return this._addCheck({
			kind: "multipleOf",
			value: e,
			message: k.toString(t)
		});
	}
	get minValue() {
		let e = null;
		for (let t of this._def.checks) t.kind === "min" && (e === null || t.value > e) && (e = t.value);
		return e;
	}
	get maxValue() {
		let e = null;
		for (let t of this._def.checks) t.kind === "max" && (e === null || t.value < e) && (e = t.value);
		return e;
	}
};
ft.create = (e) => new ft({
	checks: [],
	typeName: M.ZodBigInt,
	coerce: e?.coerce ?? !1,
	...A(e)
});
var pt = class extends j {
	_parse(e) {
		if (this._def.coerce && (e.data = !!e.data), this._getType(e) !== T.boolean) {
			let t = this._getOrReturnCtx(e);
			return D(t, {
				code: E.invalid_type,
				expected: T.boolean,
				received: t.parsedType
			}), O;
		}
		return Me(e.data);
	}
};
pt.create = (e) => new pt({
	typeName: M.ZodBoolean,
	coerce: e?.coerce || !1,
	...A(e)
});
var mt = class e extends j {
	_parse(e) {
		if (this._def.coerce && (e.data = new Date(e.data)), this._getType(e) !== T.date) {
			let t = this._getOrReturnCtx(e);
			return D(t, {
				code: E.invalid_type,
				expected: T.date,
				received: t.parsedType
			}), O;
		}
		if (Number.isNaN(e.data.getTime())) return D(this._getOrReturnCtx(e), { code: E.invalid_date }), O;
		let t = new Ae(), n;
		for (let r of this._def.checks) r.kind === "min" ? e.data.getTime() < r.value && (n = this._getOrReturnCtx(e, n), D(n, {
			code: E.too_small,
			message: r.message,
			inclusive: !0,
			exact: !1,
			minimum: r.value,
			type: "date"
		}), t.dirty()) : r.kind === "max" ? e.data.getTime() > r.value && (n = this._getOrReturnCtx(e, n), D(n, {
			code: E.too_big,
			message: r.message,
			inclusive: !0,
			exact: !1,
			maximum: r.value,
			type: "date"
		}), t.dirty()) : w.assertNever(r);
		return {
			status: t.value,
			value: new Date(e.data.getTime())
		};
	}
	_addCheck(t) {
		return new e({
			...this._def,
			checks: [...this._def.checks, t]
		});
	}
	min(e, t) {
		return this._addCheck({
			kind: "min",
			value: e.getTime(),
			message: k.toString(t)
		});
	}
	max(e, t) {
		return this._addCheck({
			kind: "max",
			value: e.getTime(),
			message: k.toString(t)
		});
	}
	get minDate() {
		let e = null;
		for (let t of this._def.checks) t.kind === "min" && (e === null || t.value > e) && (e = t.value);
		return e == null ? null : new Date(e);
	}
	get maxDate() {
		let e = null;
		for (let t of this._def.checks) t.kind === "max" && (e === null || t.value < e) && (e = t.value);
		return e == null ? null : new Date(e);
	}
};
mt.create = (e) => new mt({
	checks: [],
	coerce: e?.coerce || !1,
	typeName: M.ZodDate,
	...A(e)
});
var ht = class extends j {
	_parse(e) {
		if (this._getType(e) !== T.symbol) {
			let t = this._getOrReturnCtx(e);
			return D(t, {
				code: E.invalid_type,
				expected: T.symbol,
				received: t.parsedType
			}), O;
		}
		return Me(e.data);
	}
};
ht.create = (e) => new ht({
	typeName: M.ZodSymbol,
	...A(e)
});
var gt = class extends j {
	_parse(e) {
		if (this._getType(e) !== T.undefined) {
			let t = this._getOrReturnCtx(e);
			return D(t, {
				code: E.invalid_type,
				expected: T.undefined,
				received: t.parsedType
			}), O;
		}
		return Me(e.data);
	}
};
gt.create = (e) => new gt({
	typeName: M.ZodUndefined,
	...A(e)
});
var _t = class extends j {
	_parse(e) {
		if (this._getType(e) !== T.null) {
			let t = this._getOrReturnCtx(e);
			return D(t, {
				code: E.invalid_type,
				expected: T.null,
				received: t.parsedType
			}), O;
		}
		return Me(e.data);
	}
};
_t.create = (e) => new _t({
	typeName: M.ZodNull,
	...A(e)
});
var vt = class extends j {
	constructor() {
		super(...arguments), this._any = !0;
	}
	_parse(e) {
		return Me(e.data);
	}
};
vt.create = (e) => new vt({
	typeName: M.ZodAny,
	...A(e)
});
var yt = class extends j {
	constructor() {
		super(...arguments), this._unknown = !0;
	}
	_parse(e) {
		return Me(e.data);
	}
};
yt.create = (e) => new yt({
	typeName: M.ZodUnknown,
	...A(e)
});
var bt = class extends j {
	_parse(e) {
		let t = this._getOrReturnCtx(e);
		return D(t, {
			code: E.invalid_type,
			expected: T.never,
			received: t.parsedType
		}), O;
	}
};
bt.create = (e) => new bt({
	typeName: M.ZodNever,
	...A(e)
});
var xt = class extends j {
	_parse(e) {
		if (this._getType(e) !== T.undefined) {
			let t = this._getOrReturnCtx(e);
			return D(t, {
				code: E.invalid_type,
				expected: T.void,
				received: t.parsedType
			}), O;
		}
		return Me(e.data);
	}
};
xt.create = (e) => new xt({
	typeName: M.ZodVoid,
	...A(e)
});
var St = class e extends j {
	_parse(e) {
		let { ctx: t, status: n } = this._processInputParams(e), r = this._def;
		if (t.parsedType !== T.array) return D(t, {
			code: E.invalid_type,
			expected: T.array,
			received: t.parsedType
		}), O;
		if (r.exactLength !== null) {
			let e = t.data.length > r.exactLength.value, i = t.data.length < r.exactLength.value;
			(e || i) && (D(t, {
				code: e ? E.too_big : E.too_small,
				minimum: i ? r.exactLength.value : void 0,
				maximum: e ? r.exactLength.value : void 0,
				type: "array",
				inclusive: !0,
				exact: !0,
				message: r.exactLength.message
			}), n.dirty());
		}
		if (r.minLength !== null && t.data.length < r.minLength.value && (D(t, {
			code: E.too_small,
			minimum: r.minLength.value,
			type: "array",
			inclusive: !0,
			exact: !1,
			message: r.minLength.message
		}), n.dirty()), r.maxLength !== null && t.data.length > r.maxLength.value && (D(t, {
			code: E.too_big,
			maximum: r.maxLength.value,
			type: "array",
			inclusive: !0,
			exact: !1,
			message: r.maxLength.message
		}), n.dirty()), t.common.async) return Promise.all([...t.data].map((e, n) => r.type._parseAsync(new Le(t, e, t.path, n)))).then((e) => Ae.mergeArray(n, e));
		let i = [...t.data].map((e, n) => r.type._parseSync(new Le(t, e, t.path, n)));
		return Ae.mergeArray(n, i);
	}
	get element() {
		return this._def.type;
	}
	min(t, n) {
		return new e({
			...this._def,
			minLength: {
				value: t,
				message: k.toString(n)
			}
		});
	}
	max(t, n) {
		return new e({
			...this._def,
			maxLength: {
				value: t,
				message: k.toString(n)
			}
		});
	}
	length(t, n) {
		return new e({
			...this._def,
			exactLength: {
				value: t,
				message: k.toString(n)
			}
		});
	}
	nonempty(e) {
		return this.min(1, e);
	}
};
St.create = (e, t) => new St({
	type: e,
	minLength: null,
	maxLength: null,
	exactLength: null,
	typeName: M.ZodArray,
	...A(t)
});
function Ct(e) {
	if (e instanceof wt) {
		let t = {};
		for (let n in e.shape) {
			let r = e.shape[n];
			t[n] = Ht.create(Ct(r));
		}
		return new wt({
			...e._def,
			shape: () => t
		});
	}
	return e instanceof St ? new St({
		...e._def,
		type: Ct(e.element)
	}) : e instanceof Ht ? Ht.create(Ct(e.unwrap())) : e instanceof Ut ? Ut.create(Ct(e.unwrap())) : e instanceof At ? At.create(e.items.map((e) => Ct(e))) : e;
}
var wt = class e extends j {
	constructor() {
		super(...arguments), this._cached = null, this.nonstrict = this.passthrough, this.augment = this.extend;
	}
	_getCached() {
		if (this._cached !== null) return this._cached;
		let e = this._def.shape(), t = w.objectKeys(e);
		return this._cached = {
			shape: e,
			keys: t
		}, this._cached;
	}
	_parse(e) {
		if (this._getType(e) !== T.object) {
			let t = this._getOrReturnCtx(e);
			return D(t, {
				code: E.invalid_type,
				expected: T.object,
				received: t.parsedType
			}), O;
		}
		let { status: t, ctx: n } = this._processInputParams(e), { shape: r, keys: i } = this._getCached(), a = [];
		if (!(this._def.catchall instanceof bt && this._def.unknownKeys === "strip")) for (let e in n.data) i.includes(e) || a.push(e);
		let o = [];
		for (let e of i) {
			let t = r[e], i = n.data[e];
			o.push({
				key: {
					status: "valid",
					value: e
				},
				value: t._parse(new Le(n, i, n.path, e)),
				alwaysSet: e in n.data
			});
		}
		if (this._def.catchall instanceof bt) {
			let e = this._def.unknownKeys;
			if (e === "passthrough") for (let e of a) o.push({
				key: {
					status: "valid",
					value: e
				},
				value: {
					status: "valid",
					value: n.data[e]
				}
			});
			else if (e === "strict") a.length > 0 && (D(n, {
				code: E.unrecognized_keys,
				keys: a
			}), t.dirty());
			else if (e !== "strip") throw Error("Internal ZodObject error: invalid unknownKeys value.");
		} else {
			let e = this._def.catchall;
			for (let t of a) {
				let r = n.data[t];
				o.push({
					key: {
						status: "valid",
						value: t
					},
					value: e._parse(new Le(n, r, n.path, t)),
					alwaysSet: t in n.data
				});
			}
		}
		return n.common.async ? Promise.resolve().then(async () => {
			let e = [];
			for (let t of o) {
				let n = await t.key, r = await t.value;
				e.push({
					key: n,
					value: r,
					alwaysSet: t.alwaysSet
				});
			}
			return e;
		}).then((e) => Ae.mergeObjectSync(t, e)) : Ae.mergeObjectSync(t, o);
	}
	get shape() {
		return this._def.shape();
	}
	strict(t) {
		return k.errToObj, new e({
			...this._def,
			unknownKeys: "strict",
			...t === void 0 ? {} : { errorMap: (e, n) => {
				let r = this._def.errorMap?.(e, n).message ?? n.defaultError;
				return e.code === "unrecognized_keys" ? { message: k.errToObj(t).message ?? r } : { message: r };
			} }
		});
	}
	strip() {
		return new e({
			...this._def,
			unknownKeys: "strip"
		});
	}
	passthrough() {
		return new e({
			...this._def,
			unknownKeys: "passthrough"
		});
	}
	extend(t) {
		return new e({
			...this._def,
			shape: () => ({
				...this._def.shape(),
				...t
			})
		});
	}
	merge(t) {
		return new e({
			unknownKeys: t._def.unknownKeys,
			catchall: t._def.catchall,
			shape: () => ({
				...this._def.shape(),
				...t._def.shape()
			}),
			typeName: M.ZodObject
		});
	}
	setKey(e, t) {
		return this.augment({ [e]: t });
	}
	catchall(t) {
		return new e({
			...this._def,
			catchall: t
		});
	}
	pick(t) {
		let n = {};
		for (let e of w.objectKeys(t)) t[e] && this.shape[e] && (n[e] = this.shape[e]);
		return new e({
			...this._def,
			shape: () => n
		});
	}
	omit(t) {
		let n = {};
		for (let e of w.objectKeys(this.shape)) t[e] || (n[e] = this.shape[e]);
		return new e({
			...this._def,
			shape: () => n
		});
	}
	deepPartial() {
		return Ct(this);
	}
	partial(t) {
		let n = {};
		for (let e of w.objectKeys(this.shape)) {
			let r = this.shape[e];
			n[e] = t && !t[e] ? r : r.optional();
		}
		return new e({
			...this._def,
			shape: () => n
		});
	}
	required(t) {
		let n = {};
		for (let e of w.objectKeys(this.shape)) if (t && !t[e]) n[e] = this.shape[e];
		else {
			let t = this.shape[e];
			for (; t instanceof Ht;) t = t._def.innerType;
			n[e] = t;
		}
		return new e({
			...this._def,
			shape: () => n
		});
	}
	keyof() {
		return Lt(w.objectKeys(this.shape));
	}
};
wt.create = (e, t) => new wt({
	shape: () => e,
	unknownKeys: "strip",
	catchall: bt.create(),
	typeName: M.ZodObject,
	...A(t)
}), wt.strictCreate = (e, t) => new wt({
	shape: () => e,
	unknownKeys: "strict",
	catchall: bt.create(),
	typeName: M.ZodObject,
	...A(t)
}), wt.lazycreate = (e, t) => new wt({
	shape: e,
	unknownKeys: "strip",
	catchall: bt.create(),
	typeName: M.ZodObject,
	...A(t)
});
var Tt = class extends j {
	_parse(e) {
		let { ctx: t } = this._processInputParams(e), n = this._def.options;
		function r(e) {
			for (let t of e) if (t.result.status === "valid") return t.result;
			for (let n of e) if (n.result.status === "dirty") return t.common.issues.push(...n.ctx.common.issues), n.result;
			let n = e.map((e) => new Te(e.ctx.common.issues));
			return D(t, {
				code: E.invalid_union,
				unionErrors: n
			}), O;
		}
		if (t.common.async) return Promise.all(n.map(async (e) => {
			let n = {
				...t,
				common: {
					...t.common,
					issues: []
				},
				parent: null
			};
			return {
				result: await e._parseAsync({
					data: t.data,
					path: t.path,
					parent: n
				}),
				ctx: n
			};
		})).then(r);
		{
			let e, r = [];
			for (let i of n) {
				let n = {
					...t,
					common: {
						...t.common,
						issues: []
					},
					parent: null
				}, a = i._parseSync({
					data: t.data,
					path: t.path,
					parent: n
				});
				if (a.status === "valid") return a;
				a.status === "dirty" && !e && (e = {
					result: a,
					ctx: n
				}), n.common.issues.length && r.push(n.common.issues);
			}
			if (e) return t.common.issues.push(...e.ctx.common.issues), e.result;
			let i = r.map((e) => new Te(e));
			return D(t, {
				code: E.invalid_union,
				unionErrors: i
			}), O;
		}
	}
	get options() {
		return this._def.options;
	}
};
Tt.create = (e, t) => new Tt({
	options: e,
	typeName: M.ZodUnion,
	...A(t)
});
var Et = (e) => e instanceof Ft ? Et(e.schema) : e instanceof Vt ? Et(e.innerType()) : e instanceof It ? [e.value] : e instanceof Rt ? e.options : e instanceof zt ? w.objectValues(e.enum) : e instanceof Wt ? Et(e._def.innerType) : e instanceof gt ? [void 0] : e instanceof _t ? [null] : e instanceof Ht ? [void 0, ...Et(e.unwrap())] : e instanceof Ut ? [null, ...Et(e.unwrap())] : e instanceof qt || e instanceof Yt ? Et(e.unwrap()) : e instanceof Gt ? Et(e._def.innerType) : [], Dt = class e extends j {
	_parse(e) {
		let { ctx: t } = this._processInputParams(e);
		if (t.parsedType !== T.object) return D(t, {
			code: E.invalid_type,
			expected: T.object,
			received: t.parsedType
		}), O;
		let n = this.discriminator, r = t.data[n], i = this.optionsMap.get(r);
		return i ? t.common.async ? i._parseAsync({
			data: t.data,
			path: t.path,
			parent: t
		}) : i._parseSync({
			data: t.data,
			path: t.path,
			parent: t
		}) : (D(t, {
			code: E.invalid_union_discriminator,
			options: Array.from(this.optionsMap.keys()),
			path: [n]
		}), O);
	}
	get discriminator() {
		return this._def.discriminator;
	}
	get options() {
		return this._def.options;
	}
	get optionsMap() {
		return this._def.optionsMap;
	}
	static create(t, n, r) {
		let i = /* @__PURE__ */ new Map();
		for (let e of n) {
			let n = Et(e.shape[t]);
			if (!n.length) throw Error(`A discriminator value for key \`${t}\` could not be extracted from all schema options`);
			for (let r of n) {
				if (i.has(r)) throw Error(`Discriminator property ${String(t)} has duplicate value ${String(r)}`);
				i.set(r, e);
			}
		}
		return new e({
			typeName: M.ZodDiscriminatedUnion,
			discriminator: t,
			options: n,
			optionsMap: i,
			...A(r)
		});
	}
};
function Ot(e, t) {
	let n = we(e), r = we(t);
	if (e === t) return {
		valid: !0,
		data: e
	};
	if (n === T.object && r === T.object) {
		let n = w.objectKeys(t), r = w.objectKeys(e).filter((e) => n.indexOf(e) !== -1), i = {
			...e,
			...t
		};
		for (let n of r) {
			let r = Ot(e[n], t[n]);
			if (!r.valid) return { valid: !1 };
			i[n] = r.data;
		}
		return {
			valid: !0,
			data: i
		};
	}
	if (n === T.array && r === T.array) {
		if (e.length !== t.length) return { valid: !1 };
		let n = [];
		for (let r = 0; r < e.length; r++) {
			let i = e[r], a = t[r], o = Ot(i, a);
			if (!o.valid) return { valid: !1 };
			n.push(o.data);
		}
		return {
			valid: !0,
			data: n
		};
	}
	return n === T.date && r === T.date && +e == +t ? {
		valid: !0,
		data: e
	} : { valid: !1 };
}
var kt = class extends j {
	_parse(e) {
		let { status: t, ctx: n } = this._processInputParams(e), r = (e, r) => {
			if (Ne(e) || Ne(r)) return O;
			let i = Ot(e.value, r.value);
			return i.valid ? ((Pe(e) || Pe(r)) && t.dirty(), {
				status: t.value,
				value: i.data
			}) : (D(n, { code: E.invalid_intersection_types }), O);
		};
		return n.common.async ? Promise.all([this._def.left._parseAsync({
			data: n.data,
			path: n.path,
			parent: n
		}), this._def.right._parseAsync({
			data: n.data,
			path: n.path,
			parent: n
		})]).then(([e, t]) => r(e, t)) : r(this._def.left._parseSync({
			data: n.data,
			path: n.path,
			parent: n
		}), this._def.right._parseSync({
			data: n.data,
			path: n.path,
			parent: n
		}));
	}
};
kt.create = (e, t, n) => new kt({
	left: e,
	right: t,
	typeName: M.ZodIntersection,
	...A(n)
});
var At = class e extends j {
	_parse(e) {
		let { status: t, ctx: n } = this._processInputParams(e);
		if (n.parsedType !== T.array) return D(n, {
			code: E.invalid_type,
			expected: T.array,
			received: n.parsedType
		}), O;
		if (n.data.length < this._def.items.length) return D(n, {
			code: E.too_small,
			minimum: this._def.items.length,
			inclusive: !0,
			exact: !1,
			type: "array"
		}), O;
		!this._def.rest && n.data.length > this._def.items.length && (D(n, {
			code: E.too_big,
			maximum: this._def.items.length,
			inclusive: !0,
			exact: !1,
			type: "array"
		}), t.dirty());
		let r = [...n.data].map((e, t) => {
			let r = this._def.items[t] || this._def.rest;
			return r ? r._parse(new Le(n, e, n.path, t)) : null;
		}).filter((e) => !!e);
		return n.common.async ? Promise.all(r).then((e) => Ae.mergeArray(t, e)) : Ae.mergeArray(t, r);
	}
	get items() {
		return this._def.items;
	}
	rest(t) {
		return new e({
			...this._def,
			rest: t
		});
	}
};
At.create = (e, t) => {
	if (!Array.isArray(e)) throw Error("You must pass an array of schemas to z.tuple([ ... ])");
	return new At({
		items: e,
		typeName: M.ZodTuple,
		rest: null,
		...A(t)
	});
};
var jt = class e extends j {
	get keySchema() {
		return this._def.keyType;
	}
	get valueSchema() {
		return this._def.valueType;
	}
	_parse(e) {
		let { status: t, ctx: n } = this._processInputParams(e);
		if (n.parsedType !== T.object) return D(n, {
			code: E.invalid_type,
			expected: T.object,
			received: n.parsedType
		}), O;
		let r = [], i = this._def.keyType, a = this._def.valueType;
		for (let e in n.data) r.push({
			key: i._parse(new Le(n, e, n.path, e)),
			value: a._parse(new Le(n, n.data[e], n.path, e)),
			alwaysSet: e in n.data
		});
		return n.common.async ? Ae.mergeObjectAsync(t, r) : Ae.mergeObjectSync(t, r);
	}
	get element() {
		return this._def.valueType;
	}
	static create(t, n, r) {
		return n instanceof j ? new e({
			keyType: t,
			valueType: n,
			typeName: M.ZodRecord,
			...A(r)
		}) : new e({
			keyType: lt.create(),
			valueType: t,
			typeName: M.ZodRecord,
			...A(n)
		});
	}
}, Mt = class extends j {
	get keySchema() {
		return this._def.keyType;
	}
	get valueSchema() {
		return this._def.valueType;
	}
	_parse(e) {
		let { status: t, ctx: n } = this._processInputParams(e);
		if (n.parsedType !== T.map) return D(n, {
			code: E.invalid_type,
			expected: T.map,
			received: n.parsedType
		}), O;
		let r = this._def.keyType, i = this._def.valueType, a = [...n.data.entries()].map(([e, t], a) => ({
			key: r._parse(new Le(n, e, n.path, [a, "key"])),
			value: i._parse(new Le(n, t, n.path, [a, "value"]))
		}));
		if (n.common.async) {
			let e = /* @__PURE__ */ new Map();
			return Promise.resolve().then(async () => {
				for (let n of a) {
					let r = await n.key, i = await n.value;
					if (r.status === "aborted" || i.status === "aborted") return O;
					(r.status === "dirty" || i.status === "dirty") && t.dirty(), e.set(r.value, i.value);
				}
				return {
					status: t.value,
					value: e
				};
			});
		}
		{
			let e = /* @__PURE__ */ new Map();
			for (let n of a) {
				let r = n.key, i = n.value;
				if (r.status === "aborted" || i.status === "aborted") return O;
				(r.status === "dirty" || i.status === "dirty") && t.dirty(), e.set(r.value, i.value);
			}
			return {
				status: t.value,
				value: e
			};
		}
	}
};
Mt.create = (e, t, n) => new Mt({
	valueType: t,
	keyType: e,
	typeName: M.ZodMap,
	...A(n)
});
var Nt = class e extends j {
	_parse(e) {
		let { status: t, ctx: n } = this._processInputParams(e);
		if (n.parsedType !== T.set) return D(n, {
			code: E.invalid_type,
			expected: T.set,
			received: n.parsedType
		}), O;
		let r = this._def;
		r.minSize !== null && n.data.size < r.minSize.value && (D(n, {
			code: E.too_small,
			minimum: r.minSize.value,
			type: "set",
			inclusive: !0,
			exact: !1,
			message: r.minSize.message
		}), t.dirty()), r.maxSize !== null && n.data.size > r.maxSize.value && (D(n, {
			code: E.too_big,
			maximum: r.maxSize.value,
			type: "set",
			inclusive: !0,
			exact: !1,
			message: r.maxSize.message
		}), t.dirty());
		let i = this._def.valueType;
		function a(e) {
			let n = /* @__PURE__ */ new Set();
			for (let r of e) {
				if (r.status === "aborted") return O;
				r.status === "dirty" && t.dirty(), n.add(r.value);
			}
			return {
				status: t.value,
				value: n
			};
		}
		let o = [...n.data.values()].map((e, t) => i._parse(new Le(n, e, n.path, t)));
		return n.common.async ? Promise.all(o).then((e) => a(e)) : a(o);
	}
	min(t, n) {
		return new e({
			...this._def,
			minSize: {
				value: t,
				message: k.toString(n)
			}
		});
	}
	max(t, n) {
		return new e({
			...this._def,
			maxSize: {
				value: t,
				message: k.toString(n)
			}
		});
	}
	size(e, t) {
		return this.min(e, t).max(e, t);
	}
	nonempty(e) {
		return this.min(1, e);
	}
};
Nt.create = (e, t) => new Nt({
	valueType: e,
	minSize: null,
	maxSize: null,
	typeName: M.ZodSet,
	...A(t)
});
var Pt = class e extends j {
	constructor() {
		super(...arguments), this.validate = this.implement;
	}
	_parse(e) {
		let { ctx: t } = this._processInputParams(e);
		if (t.parsedType !== T.function) return D(t, {
			code: E.invalid_type,
			expected: T.function,
			received: t.parsedType
		}), O;
		function n(e, n) {
			return ke({
				data: e,
				path: t.path,
				errorMaps: [
					t.common.contextualErrorMap,
					t.schemaErrorMap,
					Oe(),
					Ee
				].filter((e) => !!e),
				issueData: {
					code: E.invalid_arguments,
					argumentsError: n
				}
			});
		}
		function r(e, n) {
			return ke({
				data: e,
				path: t.path,
				errorMaps: [
					t.common.contextualErrorMap,
					t.schemaErrorMap,
					Oe(),
					Ee
				].filter((e) => !!e),
				issueData: {
					code: E.invalid_return_type,
					returnTypeError: n
				}
			});
		}
		let i = { errorMap: t.common.contextualErrorMap }, a = t.data;
		if (this._def.returns instanceof Bt) {
			let e = this;
			return Me(async function(...t) {
				let o = new Te([]), s = await e._def.args.parseAsync(t, i).catch((e) => {
					throw o.addIssue(n(t, e)), o;
				}), c = await Reflect.apply(a, this, s);
				return await e._def.returns._def.type.parseAsync(c, i).catch((e) => {
					throw o.addIssue(r(c, e)), o;
				});
			});
		}
		{
			let e = this;
			return Me(function(...t) {
				let o = e._def.args.safeParse(t, i);
				if (!o.success) throw new Te([n(t, o.error)]);
				let s = Reflect.apply(a, this, o.data), c = e._def.returns.safeParse(s, i);
				if (!c.success) throw new Te([r(s, c.error)]);
				return c.data;
			});
		}
	}
	parameters() {
		return this._def.args;
	}
	returnType() {
		return this._def.returns;
	}
	args(...t) {
		return new e({
			...this._def,
			args: At.create(t).rest(yt.create())
		});
	}
	returns(t) {
		return new e({
			...this._def,
			returns: t
		});
	}
	implement(e) {
		return this.parse(e);
	}
	strictImplement(e) {
		return this.parse(e);
	}
	static create(t, n, r) {
		return new e({
			args: t || At.create([]).rest(yt.create()),
			returns: n || yt.create(),
			typeName: M.ZodFunction,
			...A(r)
		});
	}
}, Ft = class extends j {
	get schema() {
		return this._def.getter();
	}
	_parse(e) {
		let { ctx: t } = this._processInputParams(e);
		return this._def.getter()._parse({
			data: t.data,
			path: t.path,
			parent: t
		});
	}
};
Ft.create = (e, t) => new Ft({
	getter: e,
	typeName: M.ZodLazy,
	...A(t)
});
var It = class extends j {
	_parse(e) {
		if (e.data !== this._def.value) {
			let t = this._getOrReturnCtx(e);
			return D(t, {
				received: t.data,
				code: E.invalid_literal,
				expected: this._def.value
			}), O;
		}
		return {
			status: "valid",
			value: e.data
		};
	}
	get value() {
		return this._def.value;
	}
};
It.create = (e, t) => new It({
	value: e,
	typeName: M.ZodLiteral,
	...A(t)
});
function Lt(e, t) {
	return new Rt({
		values: e,
		typeName: M.ZodEnum,
		...A(t)
	});
}
var Rt = class e extends j {
	_parse(e) {
		if (typeof e.data != "string") {
			let t = this._getOrReturnCtx(e), n = this._def.values;
			return D(t, {
				expected: w.joinValues(n),
				received: t.parsedType,
				code: E.invalid_type
			}), O;
		}
		if (this._cache ||= new Set(this._def.values), !this._cache.has(e.data)) {
			let t = this._getOrReturnCtx(e), n = this._def.values;
			return D(t, {
				received: t.data,
				code: E.invalid_enum_value,
				options: n
			}), O;
		}
		return Me(e.data);
	}
	get options() {
		return this._def.values;
	}
	get enum() {
		let e = {};
		for (let t of this._def.values) e[t] = t;
		return e;
	}
	get Values() {
		let e = {};
		for (let t of this._def.values) e[t] = t;
		return e;
	}
	get Enum() {
		let e = {};
		for (let t of this._def.values) e[t] = t;
		return e;
	}
	extract(t, n = this._def) {
		return e.create(t, {
			...this._def,
			...n
		});
	}
	exclude(t, n = this._def) {
		return e.create(this.options.filter((e) => !t.includes(e)), {
			...this._def,
			...n
		});
	}
};
Rt.create = Lt;
var zt = class extends j {
	_parse(e) {
		let t = w.getValidEnumValues(this._def.values), n = this._getOrReturnCtx(e);
		if (n.parsedType !== T.string && n.parsedType !== T.number) {
			let e = w.objectValues(t);
			return D(n, {
				expected: w.joinValues(e),
				received: n.parsedType,
				code: E.invalid_type
			}), O;
		}
		if (this._cache ||= new Set(w.getValidEnumValues(this._def.values)), !this._cache.has(e.data)) {
			let e = w.objectValues(t);
			return D(n, {
				received: n.data,
				code: E.invalid_enum_value,
				options: e
			}), O;
		}
		return Me(e.data);
	}
	get enum() {
		return this._def.values;
	}
};
zt.create = (e, t) => new zt({
	values: e,
	typeName: M.ZodNativeEnum,
	...A(t)
});
var Bt = class extends j {
	unwrap() {
		return this._def.type;
	}
	_parse(e) {
		let { ctx: t } = this._processInputParams(e);
		return t.parsedType !== T.promise && t.common.async === !1 ? (D(t, {
			code: E.invalid_type,
			expected: T.promise,
			received: t.parsedType
		}), O) : Me((t.parsedType === T.promise ? t.data : Promise.resolve(t.data)).then((e) => this._def.type.parseAsync(e, {
			path: t.path,
			errorMap: t.common.contextualErrorMap
		})));
	}
};
Bt.create = (e, t) => new Bt({
	type: e,
	typeName: M.ZodPromise,
	...A(t)
});
var Vt = class extends j {
	innerType() {
		return this._def.schema;
	}
	sourceType() {
		return this._def.schema._def.typeName === M.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
	}
	_parse(e) {
		let { status: t, ctx: n } = this._processInputParams(e), r = this._def.effect || null, i = {
			addIssue: (e) => {
				D(n, e), e.fatal ? t.abort() : t.dirty();
			},
			get path() {
				return n.path;
			}
		};
		if (i.addIssue = i.addIssue.bind(i), r.type === "preprocess") {
			let e = r.transform(n.data, i);
			if (n.common.async) return Promise.resolve(e).then(async (e) => {
				if (t.value === "aborted") return O;
				let r = await this._def.schema._parseAsync({
					data: e,
					path: n.path,
					parent: n
				});
				return r.status === "aborted" ? O : r.status === "dirty" || t.value === "dirty" ? je(r.value) : r;
			});
			{
				if (t.value === "aborted") return O;
				let r = this._def.schema._parseSync({
					data: e,
					path: n.path,
					parent: n
				});
				return r.status === "aborted" ? O : r.status === "dirty" || t.value === "dirty" ? je(r.value) : r;
			}
		}
		if (r.type === "refinement") {
			let e = (e) => {
				let t = r.refinement(e, i);
				if (n.common.async) return Promise.resolve(t);
				if (t instanceof Promise) throw Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
				return e;
			};
			if (n.common.async === !1) {
				let r = this._def.schema._parseSync({
					data: n.data,
					path: n.path,
					parent: n
				});
				return r.status === "aborted" ? O : (r.status === "dirty" && t.dirty(), e(r.value), {
					status: t.value,
					value: r.value
				});
			}
			return this._def.schema._parseAsync({
				data: n.data,
				path: n.path,
				parent: n
			}).then((n) => n.status === "aborted" ? O : (n.status === "dirty" && t.dirty(), e(n.value).then(() => ({
				status: t.value,
				value: n.value
			}))));
		}
		if (r.type === "transform") {
			if (n.common.async === !1) {
				let e = this._def.schema._parseSync({
					data: n.data,
					path: n.path,
					parent: n
				});
				if (!Fe(e)) return O;
				let a = r.transform(e.value, i);
				if (a instanceof Promise) throw Error("Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.");
				return {
					status: t.value,
					value: a
				};
			}
			return this._def.schema._parseAsync({
				data: n.data,
				path: n.path,
				parent: n
			}).then((e) => Fe(e) ? Promise.resolve(r.transform(e.value, i)).then((e) => ({
				status: t.value,
				value: e
			})) : O);
		}
		w.assertNever(r);
	}
};
Vt.create = (e, t, n) => new Vt({
	schema: e,
	typeName: M.ZodEffects,
	effect: t,
	...A(n)
}), Vt.createWithPreprocess = (e, t, n) => new Vt({
	schema: t,
	effect: {
		type: "preprocess",
		transform: e
	},
	typeName: M.ZodEffects,
	...A(n)
});
var Ht = class extends j {
	_parse(e) {
		return this._getType(e) === T.undefined ? Me(void 0) : this._def.innerType._parse(e);
	}
	unwrap() {
		return this._def.innerType;
	}
};
Ht.create = (e, t) => new Ht({
	innerType: e,
	typeName: M.ZodOptional,
	...A(t)
});
var Ut = class extends j {
	_parse(e) {
		return this._getType(e) === T.null ? Me(null) : this._def.innerType._parse(e);
	}
	unwrap() {
		return this._def.innerType;
	}
};
Ut.create = (e, t) => new Ut({
	innerType: e,
	typeName: M.ZodNullable,
	...A(t)
});
var Wt = class extends j {
	_parse(e) {
		let { ctx: t } = this._processInputParams(e), n = t.data;
		return t.parsedType === T.undefined && (n = this._def.defaultValue()), this._def.innerType._parse({
			data: n,
			path: t.path,
			parent: t
		});
	}
	removeDefault() {
		return this._def.innerType;
	}
};
Wt.create = (e, t) => new Wt({
	innerType: e,
	typeName: M.ZodDefault,
	defaultValue: typeof t.default == "function" ? t.default : () => t.default,
	...A(t)
});
var Gt = class extends j {
	_parse(e) {
		let { ctx: t } = this._processInputParams(e), n = {
			...t,
			common: {
				...t.common,
				issues: []
			}
		}, r = this._def.innerType._parse({
			data: n.data,
			path: n.path,
			parent: { ...n }
		});
		return Ie(r) ? r.then((e) => ({
			status: "valid",
			value: e.status === "valid" ? e.value : this._def.catchValue({
				get error() {
					return new Te(n.common.issues);
				},
				input: n.data
			})
		})) : {
			status: "valid",
			value: r.status === "valid" ? r.value : this._def.catchValue({
				get error() {
					return new Te(n.common.issues);
				},
				input: n.data
			})
		};
	}
	removeCatch() {
		return this._def.innerType;
	}
};
Gt.create = (e, t) => new Gt({
	innerType: e,
	typeName: M.ZodCatch,
	catchValue: typeof t.catch == "function" ? t.catch : () => t.catch,
	...A(t)
});
var Kt = class extends j {
	_parse(e) {
		if (this._getType(e) !== T.nan) {
			let t = this._getOrReturnCtx(e);
			return D(t, {
				code: E.invalid_type,
				expected: T.nan,
				received: t.parsedType
			}), O;
		}
		return {
			status: "valid",
			value: e.data
		};
	}
};
Kt.create = (e) => new Kt({
	typeName: M.ZodNaN,
	...A(e)
});
var qt = class extends j {
	_parse(e) {
		let { ctx: t } = this._processInputParams(e), n = t.data;
		return this._def.type._parse({
			data: n,
			path: t.path,
			parent: t
		});
	}
	unwrap() {
		return this._def.type;
	}
}, Jt = class e extends j {
	_parse(e) {
		let { status: t, ctx: n } = this._processInputParams(e);
		if (n.common.async) return (async () => {
			let e = await this._def.in._parseAsync({
				data: n.data,
				path: n.path,
				parent: n
			});
			return e.status === "aborted" ? O : e.status === "dirty" ? (t.dirty(), je(e.value)) : this._def.out._parseAsync({
				data: e.value,
				path: n.path,
				parent: n
			});
		})();
		{
			let e = this._def.in._parseSync({
				data: n.data,
				path: n.path,
				parent: n
			});
			return e.status === "aborted" ? O : e.status === "dirty" ? (t.dirty(), {
				status: "dirty",
				value: e.value
			}) : this._def.out._parseSync({
				data: e.value,
				path: n.path,
				parent: n
			});
		}
	}
	static create(t, n) {
		return new e({
			in: t,
			out: n,
			typeName: M.ZodPipeline
		});
	}
}, Yt = class extends j {
	_parse(e) {
		let t = this._def.innerType._parse(e), n = (e) => (Fe(e) && (e.value = Object.freeze(e.value)), e);
		return Ie(t) ? t.then((e) => n(e)) : n(t);
	}
	unwrap() {
		return this._def.innerType;
	}
};
Yt.create = (e, t) => new Yt({
	innerType: e,
	typeName: M.ZodReadonly,
	...A(t)
}), wt.lazycreate;
var M;
(function(e) {
	e.ZodString = "ZodString", e.ZodNumber = "ZodNumber", e.ZodNaN = "ZodNaN", e.ZodBigInt = "ZodBigInt", e.ZodBoolean = "ZodBoolean", e.ZodDate = "ZodDate", e.ZodSymbol = "ZodSymbol", e.ZodUndefined = "ZodUndefined", e.ZodNull = "ZodNull", e.ZodAny = "ZodAny", e.ZodUnknown = "ZodUnknown", e.ZodNever = "ZodNever", e.ZodVoid = "ZodVoid", e.ZodArray = "ZodArray", e.ZodObject = "ZodObject", e.ZodUnion = "ZodUnion", e.ZodDiscriminatedUnion = "ZodDiscriminatedUnion", e.ZodIntersection = "ZodIntersection", e.ZodTuple = "ZodTuple", e.ZodRecord = "ZodRecord", e.ZodMap = "ZodMap", e.ZodSet = "ZodSet", e.ZodFunction = "ZodFunction", e.ZodLazy = "ZodLazy", e.ZodLiteral = "ZodLiteral", e.ZodEnum = "ZodEnum", e.ZodEffects = "ZodEffects", e.ZodNativeEnum = "ZodNativeEnum", e.ZodOptional = "ZodOptional", e.ZodNullable = "ZodNullable", e.ZodDefault = "ZodDefault", e.ZodCatch = "ZodCatch", e.ZodPromise = "ZodPromise", e.ZodBranded = "ZodBranded", e.ZodPipeline = "ZodPipeline", e.ZodReadonly = "ZodReadonly";
})(M ||= {});
var Xt = lt.create, Zt = dt.create;
Kt.create, ft.create;
var Qt = pt.create;
mt.create, ht.create, gt.create, _t.create, vt.create, yt.create, bt.create, xt.create, St.create;
var $t = wt.create;
wt.strictCreate, Tt.create, Dt.create, kt.create, At.create, jt.create, Mt.create, Nt.create, Pt.create, Ft.create, It.create;
var en = Rt.create;
zt.create, Bt.create, Vt.create, Ht.create, Ut.create, Vt.createWithPreprocess, Jt.create, Object.freeze({ status: "aborted" });
function N(e, t, n) {
	function r(n, r) {
		var i;
		Object.defineProperty(n, "_zod", {
			value: n._zod ?? {},
			enumerable: !1
		}), (i = n._zod).traits ?? (i.traits = /* @__PURE__ */ new Set()), n._zod.traits.add(e), t(n, r);
		for (let e in o.prototype) e in n || Object.defineProperty(n, e, { value: o.prototype[e].bind(n) });
		n._zod.constr = o, n._zod.def = r;
	}
	let i = n?.Parent ?? Object;
	class a extends i {}
	Object.defineProperty(a, "name", { value: e });
	function o(e) {
		var t;
		let i = n?.Parent ? new a() : this;
		r(i, e), (t = i._zod).deferred ?? (t.deferred = []);
		for (let e of i._zod.deferred) e();
		return i;
	}
	return Object.defineProperty(o, "init", { value: r }), Object.defineProperty(o, Symbol.hasInstance, { value: (t) => n?.Parent && t instanceof n.Parent ? !0 : t?._zod?.traits?.has(e) }), Object.defineProperty(o, "name", { value: e }), o;
}
var tn = class extends Error {
	constructor() {
		super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
	}
}, nn = {};
function rn(e) {
	return e && Object.assign(nn, e), nn;
}
//#endregion
//#region node_modules/zod/v4/core/util.js
function an(e) {
	let t = Object.values(e).filter((e) => typeof e == "number");
	return Object.entries(e).filter(([e, n]) => t.indexOf(+e) === -1).map(([e, t]) => t);
}
function on(e, t) {
	return typeof t == "bigint" ? t.toString() : t;
}
function sn(e) {
	return { get value() {
		{
			let t = e();
			return Object.defineProperty(this, "value", { value: t }), t;
		}
	} };
}
function cn(e) {
	return e == null;
}
function ln(e) {
	let t = +!!e.startsWith("^"), n = e.endsWith("$") ? e.length - 1 : e.length;
	return e.slice(t, n);
}
function un(e, t) {
	let n = (e.toString().split(".")[1] || "").length, r = (t.toString().split(".")[1] || "").length, i = n > r ? n : r;
	return Number.parseInt(e.toFixed(i).replace(".", "")) % Number.parseInt(t.toFixed(i).replace(".", "")) / 10 ** i;
}
function P(e, t, n) {
	Object.defineProperty(e, t, {
		get() {
			{
				let r = n();
				return e[t] = r, r;
			}
		},
		set(n) {
			Object.defineProperty(e, t, { value: n });
		},
		configurable: !0
	});
}
function dn(e, t, n) {
	Object.defineProperty(e, t, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	});
}
function fn(e) {
	return JSON.stringify(e);
}
var pn = Error.captureStackTrace ? Error.captureStackTrace : (...e) => {};
function mn(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
var hn = sn(() => {
	if (typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare")) return !1;
	try {
		return Function(""), !0;
	} catch {
		return !1;
	}
});
function gn(e) {
	if (mn(e) === !1) return !1;
	let t = e.constructor;
	if (t === void 0) return !0;
	let n = t.prototype;
	return mn(n) !== !1 && Object.prototype.hasOwnProperty.call(n, "isPrototypeOf") !== !1;
}
var _n = /* @__PURE__ */ new Set([
	"string",
	"number",
	"symbol"
]);
function vn(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function yn(e, t, n) {
	let r = new e._zod.constr(t ?? e._zod.def);
	return (!t || n?.parent) && (r._zod.parent = e), r;
}
function F(e) {
	let t = e;
	if (!t) return {};
	if (typeof t == "string") return { error: () => t };
	if (t?.message !== void 0) {
		if (t?.error !== void 0) throw Error("Cannot specify both `message` and `error` params");
		t.error = t.message;
	}
	return delete t.message, typeof t.error == "string" ? {
		...t,
		error: () => t.error
	} : t;
}
function bn(e) {
	return Object.keys(e).filter((t) => e[t]._zod.optin === "optional" && e[t]._zod.optout === "optional");
}
var xn = {
	safeint: [-(2 ** 53 - 1), 2 ** 53 - 1],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function Sn(e, t) {
	let n = {}, r = e._zod.def;
	for (let e in t) {
		if (!(e in r.shape)) throw Error(`Unrecognized key: "${e}"`);
		t[e] && (n[e] = r.shape[e]);
	}
	return yn(e, {
		...e._zod.def,
		shape: n,
		checks: []
	});
}
function Cn(e, t) {
	let n = { ...e._zod.def.shape }, r = e._zod.def;
	for (let e in t) {
		if (!(e in r.shape)) throw Error(`Unrecognized key: "${e}"`);
		t[e] && delete n[e];
	}
	return yn(e, {
		...e._zod.def,
		shape: n,
		checks: []
	});
}
function wn(e, t) {
	if (!gn(t)) throw Error("Invalid input to extend: expected a plain object");
	return yn(e, {
		...e._zod.def,
		get shape() {
			let n = {
				...e._zod.def.shape,
				...t
			};
			return dn(this, "shape", n), n;
		},
		checks: []
	});
}
function Tn(e, t) {
	return yn(e, {
		...e._zod.def,
		get shape() {
			let n = {
				...e._zod.def.shape,
				...t._zod.def.shape
			};
			return dn(this, "shape", n), n;
		},
		catchall: t._zod.def.catchall,
		checks: []
	});
}
function En(e, t, n) {
	let r = t._zod.def.shape, i = { ...r };
	if (n) for (let t in n) {
		if (!(t in r)) throw Error(`Unrecognized key: "${t}"`);
		n[t] && (i[t] = e ? new e({
			type: "optional",
			innerType: r[t]
		}) : r[t]);
	}
	else for (let t in r) i[t] = e ? new e({
		type: "optional",
		innerType: r[t]
	}) : r[t];
	return yn(t, {
		...t._zod.def,
		shape: i,
		checks: []
	});
}
function Dn(e, t, n) {
	let r = t._zod.def.shape, i = { ...r };
	if (n) for (let t in n) {
		if (!(t in i)) throw Error(`Unrecognized key: "${t}"`);
		n[t] && (i[t] = new e({
			type: "nonoptional",
			innerType: r[t]
		}));
	}
	else for (let t in r) i[t] = new e({
		type: "nonoptional",
		innerType: r[t]
	});
	return yn(t, {
		...t._zod.def,
		shape: i,
		checks: []
	});
}
function On(e, t = 0) {
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0;
	return !1;
}
function kn(e, t) {
	return t.map((t) => {
		var n;
		return (n = t).path ?? (n.path = []), t.path.unshift(e), t;
	});
}
function An(e) {
	return typeof e == "string" ? e : e?.message;
}
function jn(e, t, n) {
	let r = {
		...e,
		path: e.path ?? []
	};
	return e.message || (r.message = An(e.inst?._zod.def?.error?.(e)) ?? An(t?.error?.(e)) ?? An(n.customError?.(e)) ?? An(n.localeError?.(e)) ?? "Invalid input"), delete r.inst, delete r.continue, t?.reportInput || delete r.input, r;
}
function Mn(e) {
	return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function Nn(...e) {
	let [t, n, r] = e;
	return typeof t == "string" ? {
		message: t,
		code: "custom",
		input: n,
		inst: r
	} : { ...t };
}
//#endregion
//#region node_modules/zod/v4/core/errors.js
var Pn = (e, t) => {
	e.name = "$ZodError", Object.defineProperty(e, "_zod", {
		value: e._zod,
		enumerable: !1
	}), Object.defineProperty(e, "issues", {
		value: t,
		enumerable: !1
	}), Object.defineProperty(e, "message", {
		get() {
			return JSON.stringify(t, on, 2);
		},
		enumerable: !0
	}), Object.defineProperty(e, "toString", {
		value: () => e.message,
		enumerable: !1
	});
}, Fn = N("$ZodError", Pn), In = N("$ZodError", Pn, { Parent: Error });
function Ln(e, t = (e) => e.message) {
	let n = {}, r = [];
	for (let i of e.issues) i.path.length > 0 ? (n[i.path[0]] = n[i.path[0]] || [], n[i.path[0]].push(t(i))) : r.push(t(i));
	return {
		formErrors: r,
		fieldErrors: n
	};
}
function Rn(e, t) {
	let n = t || function(e) {
		return e.message;
	}, r = { _errors: [] }, i = (e) => {
		for (let t of e.issues) if (t.code === "invalid_union" && t.errors.length) t.errors.map((e) => i({ issues: e }));
		else if (t.code === "invalid_key") i({ issues: t.issues });
		else if (t.code === "invalid_element") i({ issues: t.issues });
		else if (t.path.length === 0) r._errors.push(n(t));
		else {
			let e = r, i = 0;
			for (; i < t.path.length;) {
				let r = t.path[i];
				i === t.path.length - 1 ? (e[r] = e[r] || { _errors: [] }, e[r]._errors.push(n(t))) : e[r] = e[r] || { _errors: [] }, e = e[r], i++;
			}
		}
	};
	return i(e), r;
}
//#endregion
//#region node_modules/zod/v4/core/parse.js
var zn = (e) => (t, n, r, i) => {
	let a = r ? Object.assign(r, { async: !1 }) : { async: !1 }, o = t._zod.run({
		value: n,
		issues: []
	}, a);
	if (o instanceof Promise) throw new tn();
	if (o.issues.length) {
		let t = new ((i?.Err) ?? e)(o.issues.map((e) => jn(e, a, rn())));
		throw pn(t, i?.callee), t;
	}
	return o.value;
}, Bn = /* @__PURE__*/ zn(In), Vn = (e) => async (t, n, r, i) => {
	let a = r ? Object.assign(r, { async: !0 }) : { async: !0 }, o = t._zod.run({
		value: n,
		issues: []
	}, a);
	if (o instanceof Promise && (o = await o), o.issues.length) {
		let t = new ((i?.Err) ?? e)(o.issues.map((e) => jn(e, a, rn())));
		throw pn(t, i?.callee), t;
	}
	return o.value;
}, Hn = /* @__PURE__*/ Vn(In), Un = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		async: !1
	} : { async: !1 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	if (a instanceof Promise) throw new tn();
	return a.issues.length ? {
		success: !1,
		error: new (e ?? Fn)(a.issues.map((e) => jn(e, i, rn())))
	} : {
		success: !0,
		data: a.value
	};
}, Wn = /* @__PURE__*/ Un(In), Gn = (e) => async (t, n, r) => {
	let i = r ? Object.assign(r, { async: !0 }) : { async: !0 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	return a instanceof Promise && (a = await a), a.issues.length ? {
		success: !1,
		error: new e(a.issues.map((e) => jn(e, i, rn())))
	} : {
		success: !0,
		data: a.value
	};
}, Kn = /* @__PURE__*/ Gn(In), qn = /^[cC][^\s-]{8,}$/, Jn = /^[0-9a-z]+$/, Yn = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/, Xn = /^[0-9a-vA-V]{20}$/, Zn = /^[A-Za-z0-9]{27}$/, Qn = /^[a-zA-Z0-9_-]{21}$/, $n = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, er = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, tr = (e) => e ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000)$/, nr = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, rr = "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$";
function ir() {
	return new RegExp(rr, "u");
}
var ar = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, or = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})$/, sr = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, cr = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, lr = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, ur = /^[A-Za-z0-9_-]*$/, dr = /^([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$/, fr = /^\+(?:[0-9]){6,14}[0-9]$/, pr = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))", mr = /*@__PURE__*/ RegExp(`^${pr}$`);
function hr(e) {
	let t = "(?:[01]\\d|2[0-3]):[0-5]\\d";
	return typeof e.precision == "number" ? e.precision === -1 ? `${t}` : e.precision === 0 ? `${t}:[0-5]\\d` : `${t}:[0-5]\\d\\.\\d{${e.precision}}` : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function gr(e) {
	return RegExp(`^${hr(e)}$`);
}
function _r(e) {
	let t = hr({ precision: e.precision }), n = ["Z"];
	e.local && n.push(""), e.offset && n.push("([+-]\\d{2}:\\d{2})");
	let r = `${t}(?:${n.join("|")})`;
	return RegExp(`^${pr}T(?:${r})$`);
}
var vr = (e) => {
	let t = e ? `[\\s\\S]{${e?.minimum ?? 0},${e?.maximum ?? ""}}` : "[\\s\\S]*";
	return RegExp(`^${t}$`);
}, yr = /^\d+$/, br = /^-?\d+(?:\.\d+)?/i, xr = /true|false/i, Sr = /null/i, Cr = /^[^A-Z]*$/, wr = /^[^a-z]*$/, Tr = /*@__PURE__*/ N("$ZodCheck", (e, t) => {
	var n;
	e._zod ??= {}, e._zod.def = t, (n = e._zod).onattach ?? (n.onattach = []);
}), Er = {
	number: "number",
	bigint: "bigint",
	object: "date"
}, Dr = /*@__PURE__*/ N("$ZodCheckLessThan", (e, t) => {
	Tr.init(e, t);
	let n = Er[typeof t.value];
	e._zod.onattach.push((e) => {
		let n = e._zod.bag, r = (t.inclusive ? n.maximum : n.exclusiveMaximum) ?? Infinity;
		t.value < r && (t.inclusive ? n.maximum = t.value : n.exclusiveMaximum = t.value);
	}), e._zod.check = (r) => {
		(t.inclusive ? r.value <= t.value : r.value < t.value) || r.issues.push({
			origin: n,
			code: "too_big",
			maximum: t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), Or = /*@__PURE__*/ N("$ZodCheckGreaterThan", (e, t) => {
	Tr.init(e, t);
	let n = Er[typeof t.value];
	e._zod.onattach.push((e) => {
		let n = e._zod.bag, r = (t.inclusive ? n.minimum : n.exclusiveMinimum) ?? -Infinity;
		t.value > r && (t.inclusive ? n.minimum = t.value : n.exclusiveMinimum = t.value);
	}), e._zod.check = (r) => {
		(t.inclusive ? r.value >= t.value : r.value > t.value) || r.issues.push({
			origin: n,
			code: "too_small",
			minimum: t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), kr = /*@__PURE__*/ N("$ZodCheckMultipleOf", (e, t) => {
	Tr.init(e, t), e._zod.onattach.push((e) => {
		var n;
		(n = e._zod.bag).multipleOf ?? (n.multipleOf = t.value);
	}), e._zod.check = (n) => {
		if (typeof n.value != typeof t.value) throw Error("Cannot mix number and bigint in multiple_of check.");
		(typeof n.value == "bigint" ? n.value % t.value === BigInt(0) : un(n.value, t.value) === 0) || n.issues.push({
			origin: typeof n.value,
			code: "not_multiple_of",
			divisor: t.value,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Ar = /*@__PURE__*/ N("$ZodCheckNumberFormat", (e, t) => {
	Tr.init(e, t), t.format = t.format || "float64";
	let n = t.format?.includes("int"), r = n ? "int" : "number", [i, a] = xn[t.format];
	e._zod.onattach.push((e) => {
		let r = e._zod.bag;
		r.format = t.format, r.minimum = i, r.maximum = a, n && (r.pattern = yr);
	}), e._zod.check = (o) => {
		let s = o.value;
		if (n) {
			if (!Number.isInteger(s)) {
				o.issues.push({
					expected: r,
					format: t.format,
					code: "invalid_type",
					input: s,
					inst: e
				});
				return;
			}
			if (!Number.isSafeInteger(s)) {
				s > 0 ? o.issues.push({
					input: s,
					code: "too_big",
					maximum: 2 ** 53 - 1,
					note: "Integers must be within the safe integer range.",
					inst: e,
					origin: r,
					continue: !t.abort
				}) : o.issues.push({
					input: s,
					code: "too_small",
					minimum: -(2 ** 53 - 1),
					note: "Integers must be within the safe integer range.",
					inst: e,
					origin: r,
					continue: !t.abort
				});
				return;
			}
		}
		s < i && o.issues.push({
			origin: "number",
			input: s,
			code: "too_small",
			minimum: i,
			inclusive: !0,
			inst: e,
			continue: !t.abort
		}), s > a && o.issues.push({
			origin: "number",
			input: s,
			code: "too_big",
			maximum: a,
			inst: e
		});
	};
}), jr = /*@__PURE__*/ N("$ZodCheckMaxLength", (e, t) => {
	var n;
	Tr.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !cn(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag.maximum ?? Infinity;
		t.maximum < n && (e._zod.bag.maximum = t.maximum);
	}), e._zod.check = (n) => {
		let r = n.value;
		if (r.length <= t.maximum) return;
		let i = Mn(r);
		n.issues.push({
			origin: i,
			code: "too_big",
			maximum: t.maximum,
			inclusive: !0,
			input: r,
			inst: e,
			continue: !t.abort
		});
	};
}), Mr = /*@__PURE__*/ N("$ZodCheckMinLength", (e, t) => {
	var n;
	Tr.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !cn(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag.minimum ?? -Infinity;
		t.minimum > n && (e._zod.bag.minimum = t.minimum);
	}), e._zod.check = (n) => {
		let r = n.value;
		if (r.length >= t.minimum) return;
		let i = Mn(r);
		n.issues.push({
			origin: i,
			code: "too_small",
			minimum: t.minimum,
			inclusive: !0,
			input: r,
			inst: e,
			continue: !t.abort
		});
	};
}), Nr = /*@__PURE__*/ N("$ZodCheckLengthEquals", (e, t) => {
	var n;
	Tr.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !cn(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag;
		n.minimum = t.length, n.maximum = t.length, n.length = t.length;
	}), e._zod.check = (n) => {
		let r = n.value, i = r.length;
		if (i === t.length) return;
		let a = Mn(r), o = i > t.length;
		n.issues.push({
			origin: a,
			...o ? {
				code: "too_big",
				maximum: t.length
			} : {
				code: "too_small",
				minimum: t.length
			},
			inclusive: !0,
			exact: !0,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Pr = /*@__PURE__*/ N("$ZodCheckStringFormat", (e, t) => {
	var n, r;
	Tr.init(e, t), e._zod.onattach.push((e) => {
		let n = e._zod.bag;
		n.format = t.format, t.pattern && (n.patterns ??= /* @__PURE__ */ new Set(), n.patterns.add(t.pattern));
	}), t.pattern ? (n = e._zod).check ?? (n.check = (n) => {
		t.pattern.lastIndex = 0, !t.pattern.test(n.value) && n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: t.format,
			input: n.value,
			...t.pattern ? { pattern: t.pattern.toString() } : {},
			inst: e,
			continue: !t.abort
		});
	}) : (r = e._zod).check ?? (r.check = () => {});
}), Fr = /*@__PURE__*/ N("$ZodCheckRegex", (e, t) => {
	Pr.init(e, t), e._zod.check = (n) => {
		t.pattern.lastIndex = 0, !t.pattern.test(n.value) && n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: n.value,
			pattern: t.pattern.toString(),
			inst: e,
			continue: !t.abort
		});
	};
}), Ir = /*@__PURE__*/ N("$ZodCheckLowerCase", (e, t) => {
	t.pattern ??= Cr, Pr.init(e, t);
}), Lr = /*@__PURE__*/ N("$ZodCheckUpperCase", (e, t) => {
	t.pattern ??= wr, Pr.init(e, t);
}), Rr = /*@__PURE__*/ N("$ZodCheckIncludes", (e, t) => {
	Tr.init(e, t);
	let n = vn(t.includes), r = new RegExp(typeof t.position == "number" ? `^.{${t.position}}${n}` : n);
	t.pattern = r, e._zod.onattach.push((e) => {
		let t = e._zod.bag;
		t.patterns ??= /* @__PURE__ */ new Set(), t.patterns.add(r);
	}), e._zod.check = (n) => {
		n.value.includes(t.includes, t.position) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: t.includes,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), zr = /*@__PURE__*/ N("$ZodCheckStartsWith", (e, t) => {
	Tr.init(e, t);
	let n = RegExp(`^${vn(t.prefix)}.*`);
	t.pattern ??= n, e._zod.onattach.push((e) => {
		let t = e._zod.bag;
		t.patterns ??= /* @__PURE__ */ new Set(), t.patterns.add(n);
	}), e._zod.check = (n) => {
		n.value.startsWith(t.prefix) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: t.prefix,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Br = /*@__PURE__*/ N("$ZodCheckEndsWith", (e, t) => {
	Tr.init(e, t);
	let n = RegExp(`.*${vn(t.suffix)}$`);
	t.pattern ??= n, e._zod.onattach.push((e) => {
		let t = e._zod.bag;
		t.patterns ??= /* @__PURE__ */ new Set(), t.patterns.add(n);
	}), e._zod.check = (n) => {
		n.value.endsWith(t.suffix) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: t.suffix,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Vr = /*@__PURE__*/ N("$ZodCheckOverwrite", (e, t) => {
	Tr.init(e, t), e._zod.check = (e) => {
		e.value = t.tx(e.value);
	};
}), Hr = class {
	constructor(e = []) {
		this.content = [], this.indent = 0, this && (this.args = e);
	}
	indented(e) {
		this.indent += 1, e(this), --this.indent;
	}
	write(e) {
		if (typeof e == "function") {
			e(this, { execution: "sync" }), e(this, { execution: "async" });
			return;
		}
		let t = e.split("\n").filter((e) => e), n = Math.min(...t.map((e) => e.length - e.trimStart().length)), r = t.map((e) => e.slice(n)).map((e) => " ".repeat(this.indent * 2) + e);
		for (let e of r) this.content.push(e);
	}
	compile() {
		let e = Function, t = this?.args, n = [...(this?.content ?? [""]).map((e) => `  ${e}`)];
		return new e(...t, n.join("\n"));
	}
}, Ur = {
	major: 4,
	minor: 0,
	patch: 0
}, I = /*@__PURE__*/ N("$ZodType", (e, t) => {
	var n;
	e ??= {}, e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = Ur;
	let r = [...e._zod.def.checks ?? []];
	e._zod.traits.has("$ZodCheck") && r.unshift(e);
	for (let t of r) for (let n of t._zod.onattach) n(e);
	if (r.length === 0) (n = e._zod).deferred ?? (n.deferred = []), e._zod.deferred?.push(() => {
		e._zod.run = e._zod.parse;
	});
	else {
		let t = (e, t, n) => {
			let r = On(e), i;
			for (let a of t) {
				if (a._zod.def.when) {
					if (!a._zod.def.when(e)) continue;
				} else if (r) continue;
				let t = e.issues.length, o = a._zod.check(e);
				if (o instanceof Promise && n?.async === !1) throw new tn();
				if (i || o instanceof Promise) i = (i ?? Promise.resolve()).then(async () => {
					await o, e.issues.length !== t && (r ||= On(e, t));
				});
				else {
					if (e.issues.length === t) continue;
					r ||= On(e, t);
				}
			}
			return i ? i.then(() => e) : e;
		};
		e._zod.run = (n, i) => {
			let a = e._zod.parse(n, i);
			if (a instanceof Promise) {
				if (i.async === !1) throw new tn();
				return a.then((e) => t(e, r, i));
			}
			return t(a, r, i);
		};
	}
	e["~standard"] = {
		validate: (t) => {
			try {
				let n = Wn(e, t);
				return n.success ? { value: n.data } : { issues: n.error?.issues };
			} catch {
				return Kn(e, t).then((e) => e.success ? { value: e.data } : { issues: e.error?.issues });
			}
		},
		vendor: "zod",
		version: 1
	};
}), Wr = /*@__PURE__*/ N("$ZodString", (e, t) => {
	I.init(e, t), e._zod.pattern = [...e?._zod.bag?.patterns ?? []].pop() ?? vr(e._zod.bag), e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = String(n.value);
		} catch {}
		return typeof n.value == "string" || n.issues.push({
			expected: "string",
			code: "invalid_type",
			input: n.value,
			inst: e
		}), n;
	};
}), L = /*@__PURE__*/ N("$ZodStringFormat", (e, t) => {
	Pr.init(e, t), Wr.init(e, t);
}), Gr = /*@__PURE__*/ N("$ZodGUID", (e, t) => {
	t.pattern ??= er, L.init(e, t);
}), Kr = /*@__PURE__*/ N("$ZodUUID", (e, t) => {
	if (t.version) {
		let e = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[t.version];
		if (e === void 0) throw Error(`Invalid UUID version: "${t.version}"`);
		t.pattern ??= tr(e);
	} else t.pattern ??= tr();
	L.init(e, t);
}), qr = /*@__PURE__*/ N("$ZodEmail", (e, t) => {
	t.pattern ??= nr, L.init(e, t);
}), Jr = /*@__PURE__*/ N("$ZodURL", (e, t) => {
	L.init(e, t), e._zod.check = (n) => {
		try {
			let r = n.value, i = new URL(r), a = i.href;
			t.hostname && (t.hostname.lastIndex = 0, t.hostname.test(i.hostname) || n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid hostname",
				pattern: dr.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			})), t.protocol && (t.protocol.lastIndex = 0, t.protocol.test(i.protocol.endsWith(":") ? i.protocol.slice(0, -1) : i.protocol) || n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid protocol",
				pattern: t.protocol.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			})), n.value = !r.endsWith("/") && a.endsWith("/") ? a.slice(0, -1) : a;
			return;
		} catch {
			n.issues.push({
				code: "invalid_format",
				format: "url",
				input: n.value,
				inst: e,
				continue: !t.abort
			});
		}
	};
}), Yr = /*@__PURE__*/ N("$ZodEmoji", (e, t) => {
	t.pattern ??= ir(), L.init(e, t);
}), Xr = /*@__PURE__*/ N("$ZodNanoID", (e, t) => {
	t.pattern ??= Qn, L.init(e, t);
}), Zr = /*@__PURE__*/ N("$ZodCUID", (e, t) => {
	t.pattern ??= qn, L.init(e, t);
}), Qr = /*@__PURE__*/ N("$ZodCUID2", (e, t) => {
	t.pattern ??= Jn, L.init(e, t);
}), $r = /*@__PURE__*/ N("$ZodULID", (e, t) => {
	t.pattern ??= Yn, L.init(e, t);
}), ei = /*@__PURE__*/ N("$ZodXID", (e, t) => {
	t.pattern ??= Xn, L.init(e, t);
}), ti = /*@__PURE__*/ N("$ZodKSUID", (e, t) => {
	t.pattern ??= Zn, L.init(e, t);
}), ni = /*@__PURE__*/ N("$ZodISODateTime", (e, t) => {
	t.pattern ??= _r(t), L.init(e, t);
}), ri = /*@__PURE__*/ N("$ZodISODate", (e, t) => {
	t.pattern ??= mr, L.init(e, t);
}), ii = /*@__PURE__*/ N("$ZodISOTime", (e, t) => {
	t.pattern ??= gr(t), L.init(e, t);
}), ai = /*@__PURE__*/ N("$ZodISODuration", (e, t) => {
	t.pattern ??= $n, L.init(e, t);
}), oi = /*@__PURE__*/ N("$ZodIPv4", (e, t) => {
	t.pattern ??= ar, L.init(e, t), e._zod.onattach.push((e) => {
		let t = e._zod.bag;
		t.format = "ipv4";
	});
}), si = /*@__PURE__*/ N("$ZodIPv6", (e, t) => {
	t.pattern ??= or, L.init(e, t), e._zod.onattach.push((e) => {
		let t = e._zod.bag;
		t.format = "ipv6";
	}), e._zod.check = (n) => {
		try {
			new URL(`http://[${n.value}]`);
		} catch {
			n.issues.push({
				code: "invalid_format",
				format: "ipv6",
				input: n.value,
				inst: e,
				continue: !t.abort
			});
		}
	};
}), ci = /*@__PURE__*/ N("$ZodCIDRv4", (e, t) => {
	t.pattern ??= sr, L.init(e, t);
}), li = /*@__PURE__*/ N("$ZodCIDRv6", (e, t) => {
	t.pattern ??= cr, L.init(e, t), e._zod.check = (n) => {
		let [r, i] = n.value.split("/");
		try {
			if (!i) throw Error();
			let e = Number(i);
			if (`${e}` !== i || e < 0 || e > 128) throw Error();
			new URL(`http://[${r}]`);
		} catch {
			n.issues.push({
				code: "invalid_format",
				format: "cidrv6",
				input: n.value,
				inst: e,
				continue: !t.abort
			});
		}
	};
});
function ui(e) {
	if (e === "") return !0;
	if (e.length % 4 != 0) return !1;
	try {
		return atob(e), !0;
	} catch {
		return !1;
	}
}
var di = /*@__PURE__*/ N("$ZodBase64", (e, t) => {
	t.pattern ??= lr, L.init(e, t), e._zod.onattach.push((e) => {
		e._zod.bag.contentEncoding = "base64";
	}), e._zod.check = (n) => {
		ui(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
});
function fi(e) {
	if (!ur.test(e)) return !1;
	let t = e.replace(/[-_]/g, (e) => e === "-" ? "+" : "/");
	return ui(t.padEnd(Math.ceil(t.length / 4) * 4, "="));
}
var pi = /*@__PURE__*/ N("$ZodBase64URL", (e, t) => {
	t.pattern ??= ur, L.init(e, t), e._zod.onattach.push((e) => {
		e._zod.bag.contentEncoding = "base64url";
	}), e._zod.check = (n) => {
		fi(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), mi = /*@__PURE__*/ N("$ZodE164", (e, t) => {
	t.pattern ??= fr, L.init(e, t);
});
function hi(e, t = null) {
	try {
		let n = e.split(".");
		if (n.length !== 3) return !1;
		let [r] = n;
		if (!r) return !1;
		let i = JSON.parse(atob(r));
		return !("typ" in i && i?.typ !== "JWT" || !i.alg || t && (!("alg" in i) || i.alg !== t));
	} catch {
		return !1;
	}
}
var gi = /*@__PURE__*/ N("$ZodJWT", (e, t) => {
	L.init(e, t), e._zod.check = (n) => {
		hi(n.value, t.alg) || n.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), _i = /*@__PURE__*/ N("$ZodNumber", (e, t) => {
	I.init(e, t), e._zod.pattern = e._zod.bag.pattern ?? br, e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = Number(n.value);
		} catch {}
		let i = n.value;
		if (typeof i == "number" && !Number.isNaN(i) && Number.isFinite(i)) return n;
		let a = typeof i == "number" ? Number.isNaN(i) ? "NaN" : Number.isFinite(i) ? void 0 : "Infinity" : void 0;
		return n.issues.push({
			expected: "number",
			code: "invalid_type",
			input: i,
			inst: e,
			...a ? { received: a } : {}
		}), n;
	};
}), vi = /*@__PURE__*/ N("$ZodNumber", (e, t) => {
	Ar.init(e, t), _i.init(e, t);
}), yi = /*@__PURE__*/ N("$ZodBoolean", (e, t) => {
	I.init(e, t), e._zod.pattern = xr, e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = !!n.value;
		} catch {}
		let i = n.value;
		return typeof i == "boolean" || n.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input: i,
			inst: e
		}), n;
	};
}), bi = /*@__PURE__*/ N("$ZodNull", (e, t) => {
	I.init(e, t), e._zod.pattern = Sr, e._zod.values = /* @__PURE__ */ new Set([null]), e._zod.parse = (t, n) => {
		let r = t.value;
		return r === null || t.issues.push({
			expected: "null",
			code: "invalid_type",
			input: r,
			inst: e
		}), t;
	};
}), xi = /*@__PURE__*/ N("$ZodUnknown", (e, t) => {
	I.init(e, t), e._zod.parse = (e) => e;
}), Si = /*@__PURE__*/ N("$ZodNever", (e, t) => {
	I.init(e, t), e._zod.parse = (t, n) => (t.issues.push({
		expected: "never",
		code: "invalid_type",
		input: t.value,
		inst: e
	}), t);
});
function Ci(e, t, n) {
	e.issues.length && t.issues.push(...kn(n, e.issues)), t.value[n] = e.value;
}
var wi = /*@__PURE__*/ N("$ZodArray", (e, t) => {
	I.init(e, t), e._zod.parse = (n, r) => {
		let i = n.value;
		if (!Array.isArray(i)) return n.issues.push({
			expected: "array",
			code: "invalid_type",
			input: i,
			inst: e
		}), n;
		n.value = Array(i.length);
		let a = [];
		for (let e = 0; e < i.length; e++) {
			let o = i[e], s = t.element._zod.run({
				value: o,
				issues: []
			}, r);
			s instanceof Promise ? a.push(s.then((t) => Ci(t, n, e))) : Ci(s, n, e);
		}
		return a.length ? Promise.all(a).then(() => n) : n;
	};
});
function Ti(e, t, n) {
	e.issues.length && t.issues.push(...kn(n, e.issues)), t.value[n] = e.value;
}
function Ei(e, t, n, r) {
	e.issues.length ? r[n] === void 0 ? n in r ? t.value[n] = void 0 : t.value[n] = e.value : t.issues.push(...kn(n, e.issues)) : e.value === void 0 ? n in r && (t.value[n] = void 0) : t.value[n] = e.value;
}
var Di = /*@__PURE__*/ N("$ZodObject", (e, t) => {
	I.init(e, t);
	let n = sn(() => {
		let e = Object.keys(t.shape);
		for (let n of e) if (!(t.shape[n] instanceof I)) throw Error(`Invalid element at key "${n}": expected a Zod schema`);
		let n = bn(t.shape);
		return {
			shape: t.shape,
			keys: e,
			keySet: new Set(e),
			numKeys: e.length,
			optionalKeys: new Set(n)
		};
	});
	P(e._zod, "propValues", () => {
		let e = t.shape, n = {};
		for (let t in e) {
			let r = e[t]._zod;
			if (r.values) {
				n[t] ?? (n[t] = /* @__PURE__ */ new Set());
				for (let e of r.values) n[t].add(e);
			}
		}
		return n;
	});
	let r = (e) => {
		let t = new Hr([
			"shape",
			"payload",
			"ctx"
		]), r = n.value, i = (e) => {
			let t = fn(e);
			return `shape[${t}]._zod.run({ value: input[${t}], issues: [] }, ctx)`;
		};
		t.write("const input = payload.value;");
		let a = Object.create(null), o = 0;
		for (let e of r.keys) a[e] = `key_${o++}`;
		t.write("const newResult = {}");
		for (let e of r.keys) if (r.optionalKeys.has(e)) {
			let n = a[e];
			t.write(`const ${n} = ${i(e)};`);
			let r = fn(e);
			t.write(`
        if (${n}.issues.length) {
          if (input[${r}] === undefined) {
            if (${r} in input) {
              newResult[${r}] = undefined;
            }
          } else {
            payload.issues = payload.issues.concat(
              ${n}.issues.map((iss) => ({
                ...iss,
                path: iss.path ? [${r}, ...iss.path] : [${r}],
              }))
            );
          }
        } else if (${n}.value === undefined) {
          if (${r} in input) newResult[${r}] = undefined;
        } else {
          newResult[${r}] = ${n}.value;
        }
        `);
		} else {
			let n = a[e];
			t.write(`const ${n} = ${i(e)};`), t.write(`
          if (${n}.issues.length) payload.issues = payload.issues.concat(${n}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${fn(e)}, ...iss.path] : [${fn(e)}]
          })));`), t.write(`newResult[${fn(e)}] = ${n}.value`);
		}
		t.write("payload.value = newResult;"), t.write("return payload;");
		let s = t.compile();
		return (t, n) => s(e, t, n);
	}, i, a = mn, o = !nn.jitless, s = o && hn.value, c = t.catchall, l;
	e._zod.parse = (u, d) => {
		l ??= n.value;
		let f = u.value;
		if (!a(f)) return u.issues.push({
			expected: "object",
			code: "invalid_type",
			input: f,
			inst: e
		}), u;
		let p = [];
		if (o && s && d?.async === !1 && d.jitless !== !0) i ||= r(t.shape), u = i(u, d);
		else {
			u.value = {};
			let e = l.shape;
			for (let t of l.keys) {
				let n = e[t], r = n._zod.run({
					value: f[t],
					issues: []
				}, d), i = n._zod.optin === "optional" && n._zod.optout === "optional";
				r instanceof Promise ? p.push(r.then((e) => i ? Ei(e, u, t, f) : Ti(e, u, t))) : i ? Ei(r, u, t, f) : Ti(r, u, t);
			}
		}
		if (!c) return p.length ? Promise.all(p).then(() => u) : u;
		let m = [], h = l.keySet, g = c._zod, _ = g.def.type;
		for (let e of Object.keys(f)) {
			if (h.has(e)) continue;
			if (_ === "never") {
				m.push(e);
				continue;
			}
			let t = g.run({
				value: f[e],
				issues: []
			}, d);
			t instanceof Promise ? p.push(t.then((t) => Ti(t, u, e))) : Ti(t, u, e);
		}
		return m.length && u.issues.push({
			code: "unrecognized_keys",
			keys: m,
			input: f,
			inst: e
		}), p.length ? Promise.all(p).then(() => u) : u;
	};
});
function Oi(e, t, n, r) {
	for (let n of e) if (n.issues.length === 0) return t.value = n.value, t;
	return t.issues.push({
		code: "invalid_union",
		input: t.value,
		inst: n,
		errors: e.map((e) => e.issues.map((e) => jn(e, r, rn())))
	}), t;
}
var ki = /*@__PURE__*/ N("$ZodUnion", (e, t) => {
	I.init(e, t), P(e._zod, "optin", () => t.options.some((e) => e._zod.optin === "optional") ? "optional" : void 0), P(e._zod, "optout", () => t.options.some((e) => e._zod.optout === "optional") ? "optional" : void 0), P(e._zod, "values", () => {
		if (t.options.every((e) => e._zod.values)) return new Set(t.options.flatMap((e) => Array.from(e._zod.values)));
	}), P(e._zod, "pattern", () => {
		if (t.options.every((e) => e._zod.pattern)) {
			let e = t.options.map((e) => e._zod.pattern);
			return RegExp(`^(${e.map((e) => ln(e.source)).join("|")})$`);
		}
	}), e._zod.parse = (n, r) => {
		let i = !1, a = [];
		for (let e of t.options) {
			let t = e._zod.run({
				value: n.value,
				issues: []
			}, r);
			if (t instanceof Promise) a.push(t), i = !0;
			else {
				if (t.issues.length === 0) return t;
				a.push(t);
			}
		}
		return i ? Promise.all(a).then((t) => Oi(t, n, e, r)) : Oi(a, n, e, r);
	};
}), Ai = /*@__PURE__*/ N("$ZodDiscriminatedUnion", (e, t) => {
	ki.init(e, t);
	let n = e._zod.parse;
	P(e._zod, "propValues", () => {
		let e = {};
		for (let n of t.options) {
			let r = n._zod.propValues;
			if (!r || Object.keys(r).length === 0) throw Error(`Invalid discriminated union option at index "${t.options.indexOf(n)}"`);
			for (let [t, n] of Object.entries(r)) {
				e[t] || (e[t] = /* @__PURE__ */ new Set());
				for (let r of n) e[t].add(r);
			}
		}
		return e;
	});
	let r = sn(() => {
		let e = t.options, n = /* @__PURE__ */ new Map();
		for (let r of e) {
			let e = r._zod.propValues[t.discriminator];
			if (!e || e.size === 0) throw Error(`Invalid discriminated union option at index "${t.options.indexOf(r)}"`);
			for (let t of e) {
				if (n.has(t)) throw Error(`Duplicate discriminator value "${String(t)}"`);
				n.set(t, r);
			}
		}
		return n;
	});
	e._zod.parse = (i, a) => {
		let o = i.value;
		if (!mn(o)) return i.issues.push({
			code: "invalid_type",
			expected: "object",
			input: o,
			inst: e
		}), i;
		let s = r.value.get(o?.[t.discriminator]);
		return s ? s._zod.run(i, a) : t.unionFallback ? n(i, a) : (i.issues.push({
			code: "invalid_union",
			errors: [],
			note: "No matching discriminator",
			input: o,
			path: [t.discriminator],
			inst: e
		}), i);
	};
}), ji = /*@__PURE__*/ N("$ZodIntersection", (e, t) => {
	I.init(e, t), e._zod.parse = (e, n) => {
		let r = e.value, i = t.left._zod.run({
			value: r,
			issues: []
		}, n), a = t.right._zod.run({
			value: r,
			issues: []
		}, n);
		return i instanceof Promise || a instanceof Promise ? Promise.all([i, a]).then(([t, n]) => Ni(e, t, n)) : Ni(e, i, a);
	};
});
function Mi(e, t) {
	if (e === t || e instanceof Date && t instanceof Date && +e == +t) return {
		valid: !0,
		data: e
	};
	if (gn(e) && gn(t)) {
		let n = Object.keys(t), r = Object.keys(e).filter((e) => n.indexOf(e) !== -1), i = {
			...e,
			...t
		};
		for (let n of r) {
			let r = Mi(e[n], t[n]);
			if (!r.valid) return {
				valid: !1,
				mergeErrorPath: [n, ...r.mergeErrorPath]
			};
			i[n] = r.data;
		}
		return {
			valid: !0,
			data: i
		};
	}
	if (Array.isArray(e) && Array.isArray(t)) {
		if (e.length !== t.length) return {
			valid: !1,
			mergeErrorPath: []
		};
		let n = [];
		for (let r = 0; r < e.length; r++) {
			let i = e[r], a = t[r], o = Mi(i, a);
			if (!o.valid) return {
				valid: !1,
				mergeErrorPath: [r, ...o.mergeErrorPath]
			};
			n.push(o.data);
		}
		return {
			valid: !0,
			data: n
		};
	}
	return {
		valid: !1,
		mergeErrorPath: []
	};
}
function Ni(e, t, n) {
	if (t.issues.length && e.issues.push(...t.issues), n.issues.length && e.issues.push(...n.issues), On(e)) return e;
	let r = Mi(t.value, n.value);
	if (!r.valid) throw Error(`Unmergable intersection. Error path: ${JSON.stringify(r.mergeErrorPath)}`);
	return e.value = r.data, e;
}
var Pi = /*@__PURE__*/ N("$ZodRecord", (e, t) => {
	I.init(e, t), e._zod.parse = (n, r) => {
		let i = n.value;
		if (!gn(i)) return n.issues.push({
			expected: "record",
			code: "invalid_type",
			input: i,
			inst: e
		}), n;
		let a = [];
		if (t.keyType._zod.values) {
			let o = t.keyType._zod.values;
			n.value = {};
			for (let e of o) if (typeof e == "string" || typeof e == "number" || typeof e == "symbol") {
				let o = t.valueType._zod.run({
					value: i[e],
					issues: []
				}, r);
				o instanceof Promise ? a.push(o.then((t) => {
					t.issues.length && n.issues.push(...kn(e, t.issues)), n.value[e] = t.value;
				})) : (o.issues.length && n.issues.push(...kn(e, o.issues)), n.value[e] = o.value);
			}
			let s;
			for (let e in i) o.has(e) || (s ??= [], s.push(e));
			s && s.length > 0 && n.issues.push({
				code: "unrecognized_keys",
				input: i,
				inst: e,
				keys: s
			});
		} else {
			n.value = {};
			for (let o of Reflect.ownKeys(i)) {
				if (o === "__proto__") continue;
				let s = t.keyType._zod.run({
					value: o,
					issues: []
				}, r);
				if (s instanceof Promise) throw Error("Async schemas not supported in object keys currently");
				if (s.issues.length) {
					n.issues.push({
						origin: "record",
						code: "invalid_key",
						issues: s.issues.map((e) => jn(e, r, rn())),
						input: o,
						path: [o],
						inst: e
					}), n.value[s.value] = s.value;
					continue;
				}
				let c = t.valueType._zod.run({
					value: i[o],
					issues: []
				}, r);
				c instanceof Promise ? a.push(c.then((e) => {
					e.issues.length && n.issues.push(...kn(o, e.issues)), n.value[s.value] = e.value;
				})) : (c.issues.length && n.issues.push(...kn(o, c.issues)), n.value[s.value] = c.value);
			}
		}
		return a.length ? Promise.all(a).then(() => n) : n;
	};
}), Fi = /*@__PURE__*/ N("$ZodEnum", (e, t) => {
	I.init(e, t);
	let n = an(t.entries);
	e._zod.values = new Set(n), e._zod.pattern = RegExp(`^(${n.filter((e) => _n.has(typeof e)).map((e) => typeof e == "string" ? vn(e) : e.toString()).join("|")})$`), e._zod.parse = (t, r) => {
		let i = t.value;
		return e._zod.values.has(i) || t.issues.push({
			code: "invalid_value",
			values: n,
			input: i,
			inst: e
		}), t;
	};
}), Ii = /*@__PURE__*/ N("$ZodLiteral", (e, t) => {
	I.init(e, t), e._zod.values = new Set(t.values), e._zod.pattern = RegExp(`^(${t.values.map((e) => typeof e == "string" ? vn(e) : e ? e.toString() : String(e)).join("|")})$`), e._zod.parse = (n, r) => {
		let i = n.value;
		return e._zod.values.has(i) || n.issues.push({
			code: "invalid_value",
			values: t.values,
			input: i,
			inst: e
		}), n;
	};
}), Li = /*@__PURE__*/ N("$ZodTransform", (e, t) => {
	I.init(e, t), e._zod.parse = (e, n) => {
		let r = t.transform(e.value, e);
		if (n.async) return (r instanceof Promise ? r : Promise.resolve(r)).then((t) => (e.value = t, e));
		if (r instanceof Promise) throw new tn();
		return e.value = r, e;
	};
}), Ri = /*@__PURE__*/ N("$ZodOptional", (e, t) => {
	I.init(e, t), e._zod.optin = "optional", e._zod.optout = "optional", P(e._zod, "values", () => t.innerType._zod.values ? /* @__PURE__ */ new Set([...t.innerType._zod.values, void 0]) : void 0), P(e._zod, "pattern", () => {
		let e = t.innerType._zod.pattern;
		return e ? RegExp(`^(${ln(e.source)})?$`) : void 0;
	}), e._zod.parse = (e, n) => t.innerType._zod.optin === "optional" ? t.innerType._zod.run(e, n) : e.value === void 0 ? e : t.innerType._zod.run(e, n);
}), zi = /*@__PURE__*/ N("$ZodNullable", (e, t) => {
	I.init(e, t), P(e._zod, "optin", () => t.innerType._zod.optin), P(e._zod, "optout", () => t.innerType._zod.optout), P(e._zod, "pattern", () => {
		let e = t.innerType._zod.pattern;
		return e ? RegExp(`^(${ln(e.source)}|null)$`) : void 0;
	}), P(e._zod, "values", () => t.innerType._zod.values ? /* @__PURE__ */ new Set([...t.innerType._zod.values, null]) : void 0), e._zod.parse = (e, n) => e.value === null ? e : t.innerType._zod.run(e, n);
}), Bi = /*@__PURE__*/ N("$ZodDefault", (e, t) => {
	I.init(e, t), e._zod.optin = "optional", P(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => {
		if (e.value === void 0) return e.value = t.defaultValue, e;
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => Vi(e, t)) : Vi(r, t);
	};
});
function Vi(e, t) {
	return e.value === void 0 && (e.value = t.defaultValue), e;
}
var Hi = /*@__PURE__*/ N("$ZodPrefault", (e, t) => {
	I.init(e, t), e._zod.optin = "optional", P(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => (e.value === void 0 && (e.value = t.defaultValue), t.innerType._zod.run(e, n));
}), Ui = /*@__PURE__*/ N("$ZodNonOptional", (e, t) => {
	I.init(e, t), P(e._zod, "values", () => {
		let e = t.innerType._zod.values;
		return e ? new Set([...e].filter((e) => e !== void 0)) : void 0;
	}), e._zod.parse = (n, r) => {
		let i = t.innerType._zod.run(n, r);
		return i instanceof Promise ? i.then((t) => Wi(t, e)) : Wi(i, e);
	};
});
function Wi(e, t) {
	return !e.issues.length && e.value === void 0 && e.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: e.value,
		inst: t
	}), e;
}
var Gi = /*@__PURE__*/ N("$ZodCatch", (e, t) => {
	I.init(e, t), e._zod.optin = "optional", P(e._zod, "optout", () => t.innerType._zod.optout), P(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => {
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((r) => (e.value = r.value, r.issues.length && (e.value = t.catchValue({
			...e,
			error: { issues: r.issues.map((e) => jn(e, n, rn())) },
			input: e.value
		}), e.issues = []), e)) : (e.value = r.value, r.issues.length && (e.value = t.catchValue({
			...e,
			error: { issues: r.issues.map((e) => jn(e, n, rn())) },
			input: e.value
		}), e.issues = []), e);
	};
}), Ki = /*@__PURE__*/ N("$ZodPipe", (e, t) => {
	I.init(e, t), P(e._zod, "values", () => t.in._zod.values), P(e._zod, "optin", () => t.in._zod.optin), P(e._zod, "optout", () => t.out._zod.optout), e._zod.parse = (e, n) => {
		let r = t.in._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => qi(e, t, n)) : qi(r, t, n);
	};
});
function qi(e, t, n) {
	return On(e) ? e : t.out._zod.run({
		value: e.value,
		issues: e.issues
	}, n);
}
var Ji = /*@__PURE__*/ N("$ZodReadonly", (e, t) => {
	I.init(e, t), P(e._zod, "propValues", () => t.innerType._zod.propValues), P(e._zod, "values", () => t.innerType._zod.values), P(e._zod, "optin", () => t.innerType._zod.optin), P(e._zod, "optout", () => t.innerType._zod.optout), e._zod.parse = (e, n) => {
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then(Yi) : Yi(r);
	};
});
function Yi(e) {
	return e.value = Object.freeze(e.value), e;
}
var Xi = /*@__PURE__*/ N("$ZodCustom", (e, t) => {
	Tr.init(e, t), I.init(e, t), e._zod.parse = (e, t) => e, e._zod.check = (n) => {
		let r = n.value, i = t.fn(r);
		if (i instanceof Promise) return i.then((t) => Zi(t, n, r, e));
		Zi(i, n, r, e);
	};
});
function Zi(e, t, n, r) {
	if (!e) {
		let e = {
			code: "custom",
			input: n,
			inst: r,
			path: [...r._zod.def.path ?? []],
			continue: !r._zod.def.abort
		};
		r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(Nn(e));
	}
}
//#endregion
//#region node_modules/zod/v4/core/registries.js
var Qi = class {
	constructor() {
		this._map = /* @__PURE__ */ new Map(), this._idmap = /* @__PURE__ */ new Map();
	}
	add(e, ...t) {
		let n = t[0];
		if (this._map.set(e, n), n && typeof n == "object" && "id" in n) {
			if (this._idmap.has(n.id)) throw Error(`ID ${n.id} already exists in the registry`);
			this._idmap.set(n.id, e);
		}
		return this;
	}
	clear() {
		return this._map = /* @__PURE__ */ new Map(), this._idmap = /* @__PURE__ */ new Map(), this;
	}
	remove(e) {
		let t = this._map.get(e);
		return t && typeof t == "object" && "id" in t && this._idmap.delete(t.id), this._map.delete(e), this;
	}
	get(e) {
		let t = e._zod.parent;
		if (t) {
			let n = { ...this.get(t) ?? {} };
			return delete n.id, {
				...n,
				...this._map.get(e)
			};
		}
		return this._map.get(e);
	}
	has(e) {
		return this._map.has(e);
	}
};
function $i() {
	return new Qi();
}
var ea = /*@__PURE__*/ $i();
//#endregion
//#region node_modules/zod/v4/core/api.js
function ta(e, t) {
	return new e({
		type: "string",
		...F(t)
	});
}
function na(e, t) {
	return new e({
		type: "string",
		format: "email",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function ra(e, t) {
	return new e({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function ia(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function aa(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v4",
		...F(t)
	});
}
function oa(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v6",
		...F(t)
	});
}
function sa(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v7",
		...F(t)
	});
}
function ca(e, t) {
	return new e({
		type: "string",
		format: "url",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function la(e, t) {
	return new e({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function ua(e, t) {
	return new e({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function da(e, t) {
	return new e({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function fa(e, t) {
	return new e({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function pa(e, t) {
	return new e({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function ma(e, t) {
	return new e({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function ha(e, t) {
	return new e({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function ga(e, t) {
	return new e({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function _a(e, t) {
	return new e({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function va(e, t) {
	return new e({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function ya(e, t) {
	return new e({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function ba(e, t) {
	return new e({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function xa(e, t) {
	return new e({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function Sa(e, t) {
	return new e({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function Ca(e, t) {
	return new e({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: !1,
		...F(t)
	});
}
function wa(e, t) {
	return new e({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: !1,
		local: !1,
		precision: null,
		...F(t)
	});
}
function Ta(e, t) {
	return new e({
		type: "string",
		format: "date",
		check: "string_format",
		...F(t)
	});
}
function Ea(e, t) {
	return new e({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...F(t)
	});
}
function Da(e, t) {
	return new e({
		type: "string",
		format: "duration",
		check: "string_format",
		...F(t)
	});
}
function Oa(e, t) {
	return new e({
		type: "number",
		checks: [],
		...F(t)
	});
}
function ka(e, t) {
	return new e({
		type: "number",
		check: "number_format",
		abort: !1,
		format: "safeint",
		...F(t)
	});
}
function Aa(e, t) {
	return new e({
		type: "boolean",
		...F(t)
	});
}
function ja(e, t) {
	return new e({
		type: "null",
		...F(t)
	});
}
function Ma(e) {
	return new e({ type: "unknown" });
}
function Na(e, t) {
	return new e({
		type: "never",
		...F(t)
	});
}
function Pa(e, t) {
	return new Dr({
		check: "less_than",
		...F(t),
		value: e,
		inclusive: !1
	});
}
function Fa(e, t) {
	return new Dr({
		check: "less_than",
		...F(t),
		value: e,
		inclusive: !0
	});
}
function Ia(e, t) {
	return new Or({
		check: "greater_than",
		...F(t),
		value: e,
		inclusive: !1
	});
}
function La(e, t) {
	return new Or({
		check: "greater_than",
		...F(t),
		value: e,
		inclusive: !0
	});
}
function Ra(e, t) {
	return new kr({
		check: "multiple_of",
		...F(t),
		value: e
	});
}
function za(e, t) {
	return new jr({
		check: "max_length",
		...F(t),
		maximum: e
	});
}
function Ba(e, t) {
	return new Mr({
		check: "min_length",
		...F(t),
		minimum: e
	});
}
function Va(e, t) {
	return new Nr({
		check: "length_equals",
		...F(t),
		length: e
	});
}
function Ha(e, t) {
	return new Fr({
		check: "string_format",
		format: "regex",
		...F(t),
		pattern: e
	});
}
function Ua(e) {
	return new Ir({
		check: "string_format",
		format: "lowercase",
		...F(e)
	});
}
function Wa(e) {
	return new Lr({
		check: "string_format",
		format: "uppercase",
		...F(e)
	});
}
function Ga(e, t) {
	return new Rr({
		check: "string_format",
		format: "includes",
		...F(t),
		includes: e
	});
}
function Ka(e, t) {
	return new zr({
		check: "string_format",
		format: "starts_with",
		...F(t),
		prefix: e
	});
}
function qa(e, t) {
	return new Br({
		check: "string_format",
		format: "ends_with",
		...F(t),
		suffix: e
	});
}
function Ja(e) {
	return new Vr({
		check: "overwrite",
		tx: e
	});
}
function Ya(e) {
	return Ja((t) => t.normalize(e));
}
function Xa() {
	return Ja((e) => e.trim());
}
function Za() {
	return Ja((e) => e.toLowerCase());
}
function Qa() {
	return Ja((e) => e.toUpperCase());
}
function $a(e, t, n) {
	return new e({
		type: "array",
		element: t,
		...F(n)
	});
}
function eo(e, t, n) {
	let r = F(n);
	return r.abort ??= !0, new e({
		type: "custom",
		check: "custom",
		fn: t,
		...r
	});
}
function to(e, t, n) {
	return new e({
		type: "custom",
		check: "custom",
		fn: t,
		...F(n)
	});
}
//#endregion
//#region node_modules/zod/v4/core/to-json-schema.js
var no = class {
	constructor(e) {
		this.counter = 0, this.metadataRegistry = e?.metadata ?? ea, this.target = e?.target ?? "draft-2020-12", this.unrepresentable = e?.unrepresentable ?? "throw", this.override = e?.override ?? (() => {}), this.io = e?.io ?? "output", this.seen = /* @__PURE__ */ new Map();
	}
	process(e, t = {
		path: [],
		schemaPath: []
	}) {
		var n;
		let r = e._zod.def, i = {
			guid: "uuid",
			url: "uri",
			datetime: "date-time",
			json_string: "json-string",
			regex: ""
		}, a = this.seen.get(e);
		if (a) return a.count++, t.schemaPath.includes(e) && (a.cycle = t.path), a.schema;
		let o = {
			schema: {},
			count: 1,
			cycle: void 0,
			path: t.path
		};
		this.seen.set(e, o);
		let s = e._zod.toJSONSchema?.();
		if (s) o.schema = s;
		else {
			let n = {
				...t,
				schemaPath: [...t.schemaPath, e],
				path: t.path
			}, a = e._zod.parent;
			if (a) o.ref = a, this.process(a, n), this.seen.get(a).isParent = !0;
			else {
				let t = o.schema;
				switch (r.type) {
					case "string": {
						let n = t;
						n.type = "string";
						let { minimum: r, maximum: a, format: s, patterns: c, contentEncoding: l } = e._zod.bag;
						if (typeof r == "number" && (n.minLength = r), typeof a == "number" && (n.maxLength = a), s && (n.format = i[s] ?? s, n.format === "" && delete n.format), l && (n.contentEncoding = l), c && c.size > 0) {
							let e = [...c];
							e.length === 1 ? n.pattern = e[0].source : e.length > 1 && (o.schema.allOf = [...e.map((e) => ({
								...this.target === "draft-7" ? { type: "string" } : {},
								pattern: e.source
							}))]);
						}
						break;
					}
					case "number": {
						let n = t, { minimum: r, maximum: i, format: a, multipleOf: o, exclusiveMaximum: s, exclusiveMinimum: c } = e._zod.bag;
						n.type = typeof a == "string" && a.includes("int") ? "integer" : "number", typeof c == "number" && (n.exclusiveMinimum = c), typeof r == "number" && (n.minimum = r, typeof c == "number" && (c >= r ? delete n.minimum : delete n.exclusiveMinimum)), typeof s == "number" && (n.exclusiveMaximum = s), typeof i == "number" && (n.maximum = i, typeof s == "number" && (s <= i ? delete n.maximum : delete n.exclusiveMaximum)), typeof o == "number" && (n.multipleOf = o);
						break;
					}
					case "boolean": {
						let e = t;
						e.type = "boolean";
						break;
					}
					case "bigint":
						if (this.unrepresentable === "throw") throw Error("BigInt cannot be represented in JSON Schema");
						break;
					case "symbol":
						if (this.unrepresentable === "throw") throw Error("Symbols cannot be represented in JSON Schema");
						break;
					case "null":
						t.type = "null";
						break;
					case "any": break;
					case "unknown": break;
					case "undefined":
						if (this.unrepresentable === "throw") throw Error("Undefined cannot be represented in JSON Schema");
						break;
					case "void":
						if (this.unrepresentable === "throw") throw Error("Void cannot be represented in JSON Schema");
						break;
					case "never":
						t.not = {};
						break;
					case "date":
						if (this.unrepresentable === "throw") throw Error("Date cannot be represented in JSON Schema");
						break;
					case "array": {
						let i = t, { minimum: a, maximum: o } = e._zod.bag;
						typeof a == "number" && (i.minItems = a), typeof o == "number" && (i.maxItems = o), i.type = "array", i.items = this.process(r.element, {
							...n,
							path: [...n.path, "items"]
						});
						break;
					}
					case "object": {
						let e = t;
						e.type = "object", e.properties = {};
						let i = r.shape;
						for (let t in i) e.properties[t] = this.process(i[t], {
							...n,
							path: [
								...n.path,
								"properties",
								t
							]
						});
						let a = new Set(Object.keys(i)), o = new Set([...a].filter((e) => {
							let t = r.shape[e]._zod;
							return this.io === "input" ? t.optin === void 0 : t.optout === void 0;
						}));
						o.size > 0 && (e.required = Array.from(o)), r.catchall?._zod.def.type === "never" ? e.additionalProperties = !1 : r.catchall ? r.catchall && (e.additionalProperties = this.process(r.catchall, {
							...n,
							path: [...n.path, "additionalProperties"]
						})) : this.io === "output" && (e.additionalProperties = !1);
						break;
					}
					case "union": {
						let e = t;
						e.anyOf = r.options.map((e, t) => this.process(e, {
							...n,
							path: [
								...n.path,
								"anyOf",
								t
							]
						}));
						break;
					}
					case "intersection": {
						let e = t, i = this.process(r.left, {
							...n,
							path: [
								...n.path,
								"allOf",
								0
							]
						}), a = this.process(r.right, {
							...n,
							path: [
								...n.path,
								"allOf",
								1
							]
						}), o = (e) => "allOf" in e && Object.keys(e).length === 1;
						e.allOf = [...o(i) ? i.allOf : [i], ...o(a) ? a.allOf : [a]];
						break;
					}
					case "tuple": {
						let i = t;
						i.type = "array";
						let a = r.items.map((e, t) => this.process(e, {
							...n,
							path: [
								...n.path,
								"prefixItems",
								t
							]
						}));
						if (this.target === "draft-2020-12" ? i.prefixItems = a : i.items = a, r.rest) {
							let e = this.process(r.rest, {
								...n,
								path: [...n.path, "items"]
							});
							this.target === "draft-2020-12" ? i.items = e : i.additionalItems = e;
						}
						r.rest && (i.items = this.process(r.rest, {
							...n,
							path: [...n.path, "items"]
						}));
						let { minimum: o, maximum: s } = e._zod.bag;
						typeof o == "number" && (i.minItems = o), typeof s == "number" && (i.maxItems = s);
						break;
					}
					case "record": {
						let e = t;
						e.type = "object", e.propertyNames = this.process(r.keyType, {
							...n,
							path: [...n.path, "propertyNames"]
						}), e.additionalProperties = this.process(r.valueType, {
							...n,
							path: [...n.path, "additionalProperties"]
						});
						break;
					}
					case "map":
						if (this.unrepresentable === "throw") throw Error("Map cannot be represented in JSON Schema");
						break;
					case "set":
						if (this.unrepresentable === "throw") throw Error("Set cannot be represented in JSON Schema");
						break;
					case "enum": {
						let e = t, n = an(r.entries);
						n.every((e) => typeof e == "number") && (e.type = "number"), n.every((e) => typeof e == "string") && (e.type = "string"), e.enum = n;
						break;
					}
					case "literal": {
						let e = t, n = [];
						for (let e of r.values) if (e === void 0) {
							if (this.unrepresentable === "throw") throw Error("Literal `undefined` cannot be represented in JSON Schema");
						} else if (typeof e == "bigint") {
							if (this.unrepresentable === "throw") throw Error("BigInt literals cannot be represented in JSON Schema");
							n.push(Number(e));
						} else n.push(e);
						if (n.length !== 0) {
							if (n.length === 1) {
								let t = n[0];
								e.type = t === null ? "null" : typeof t, e.const = t;
							} else n.every((e) => typeof e == "number") && (e.type = "number"), n.every((e) => typeof e == "string") && (e.type = "string"), n.every((e) => typeof e == "boolean") && (e.type = "string"), n.every((e) => e === null) && (e.type = "null"), e.enum = n;
						}
						break;
					}
					case "file": {
						let n = t, r = {
							type: "string",
							format: "binary",
							contentEncoding: "binary"
						}, { minimum: i, maximum: a, mime: o } = e._zod.bag;
						i !== void 0 && (r.minLength = i), a !== void 0 && (r.maxLength = a), o ? o.length === 1 ? (r.contentMediaType = o[0], Object.assign(n, r)) : n.anyOf = o.map((e) => ({
							...r,
							contentMediaType: e
						})) : Object.assign(n, r);
						break;
					}
					case "transform":
						if (this.unrepresentable === "throw") throw Error("Transforms cannot be represented in JSON Schema");
						break;
					case "nullable":
						t.anyOf = [this.process(r.innerType, n), { type: "null" }];
						break;
					case "nonoptional":
						this.process(r.innerType, n), o.ref = r.innerType;
						break;
					case "success": {
						let e = t;
						e.type = "boolean";
						break;
					}
					case "default":
						this.process(r.innerType, n), o.ref = r.innerType, t.default = JSON.parse(JSON.stringify(r.defaultValue));
						break;
					case "prefault":
						this.process(r.innerType, n), o.ref = r.innerType, this.io === "input" && (t._prefault = JSON.parse(JSON.stringify(r.defaultValue)));
						break;
					case "catch": {
						this.process(r.innerType, n), o.ref = r.innerType;
						let e;
						try {
							e = r.catchValue(void 0);
						} catch {
							throw Error("Dynamic catch values are not supported in JSON Schema");
						}
						t.default = e;
						break;
					}
					case "nan":
						if (this.unrepresentable === "throw") throw Error("NaN cannot be represented in JSON Schema");
						break;
					case "template_literal": {
						let n = t, r = e._zod.pattern;
						if (!r) throw Error("Pattern not found in template literal");
						n.type = "string", n.pattern = r.source;
						break;
					}
					case "pipe": {
						let e = this.io === "input" ? r.in._zod.def.type === "transform" ? r.out : r.in : r.out;
						this.process(e, n), o.ref = e;
						break;
					}
					case "readonly":
						this.process(r.innerType, n), o.ref = r.innerType, t.readOnly = !0;
						break;
					case "promise":
						this.process(r.innerType, n), o.ref = r.innerType;
						break;
					case "optional":
						this.process(r.innerType, n), o.ref = r.innerType;
						break;
					case "lazy": {
						let t = e._zod.innerType;
						this.process(t, n), o.ref = t;
						break;
					}
					case "custom": if (this.unrepresentable === "throw") throw Error("Custom types cannot be represented in JSON Schema");
				}
			}
		}
		let c = this.metadataRegistry.get(e);
		return c && Object.assign(o.schema, c), this.io === "input" && io(e) && (delete o.schema.examples, delete o.schema.default), this.io === "input" && o.schema._prefault && ((n = o.schema).default ?? (n.default = o.schema._prefault)), delete o.schema._prefault, this.seen.get(e).schema;
	}
	emit(e, t) {
		let n = {
			cycles: t?.cycles ?? "ref",
			reused: t?.reused ?? "inline",
			external: t?.external ?? void 0
		}, r = this.seen.get(e);
		if (!r) throw Error("Unprocessed schema. This is a bug in Zod.");
		let i = (e) => {
			let t = this.target === "draft-2020-12" ? "$defs" : "definitions";
			if (n.external) {
				let r = n.external.registry.get(e[0])?.id, i = n.external.uri ?? ((e) => e);
				if (r) return { ref: i(r) };
				let a = e[1].defId ?? e[1].schema.id ?? `schema${this.counter++}`;
				return e[1].defId = a, {
					defId: a,
					ref: `${i("__shared")}#/${t}/${a}`
				};
			}
			if (e[1] === r) return { ref: "#" };
			let i = `#/${t}/`, a = e[1].schema.id ?? `__schema${this.counter++}`;
			return {
				defId: a,
				ref: i + a
			};
		}, a = (e) => {
			if (e[1].schema.$ref) return;
			let t = e[1], { ref: n, defId: r } = i(e);
			t.def = { ...t.schema }, r && (t.defId = r);
			let a = t.schema;
			for (let e in a) delete a[e];
			a.$ref = n;
		};
		if (n.cycles === "throw") for (let e of this.seen.entries()) {
			let t = e[1];
			if (t.cycle) throw Error(`Cycle detected: #/${t.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
		}
		for (let t of this.seen.entries()) {
			let r = t[1];
			if (e === t[0]) {
				a(t);
				continue;
			}
			if (n.external) {
				let r = n.external.registry.get(t[0])?.id;
				if (e !== t[0] && r) {
					a(t);
					continue;
				}
			}
			if (this.metadataRegistry.get(t[0])?.id) {
				a(t);
				continue;
			}
			if (r.cycle) {
				a(t);
				continue;
			}
			if (r.count > 1 && n.reused === "ref") {
				a(t);
				continue;
			}
		}
		let o = (e, t) => {
			let n = this.seen.get(e), r = n.def ?? n.schema, i = { ...r };
			if (n.ref === null) return;
			let a = n.ref;
			if (n.ref = null, a) {
				o(a, t);
				let e = this.seen.get(a).schema;
				e.$ref && t.target === "draft-7" ? (r.allOf = r.allOf ?? [], r.allOf.push(e)) : (Object.assign(r, e), Object.assign(r, i));
			}
			n.isParent || this.override({
				zodSchema: e,
				jsonSchema: r,
				path: n.path ?? []
			});
		};
		for (let e of [...this.seen.entries()].reverse()) o(e[0], { target: this.target });
		let s = {};
		if (this.target === "draft-2020-12" ? s.$schema = "https://json-schema.org/draft/2020-12/schema" : this.target === "draft-7" ? s.$schema = "http://json-schema.org/draft-07/schema#" : console.warn(`Invalid target: ${this.target}`), n.external?.uri) {
			let t = n.external.registry.get(e)?.id;
			if (!t) throw Error("Schema is missing an `id` property");
			s.$id = n.external.uri(t);
		}
		Object.assign(s, r.def);
		let c = n.external?.defs ?? {};
		for (let e of this.seen.entries()) {
			let t = e[1];
			t.def && t.defId && (c[t.defId] = t.def);
		}
		n.external || Object.keys(c).length > 0 && (this.target === "draft-2020-12" ? s.$defs = c : s.definitions = c);
		try {
			return JSON.parse(JSON.stringify(s));
		} catch {
			throw Error("Error converting schema to JSON.");
		}
	}
};
function ro(e, t) {
	if (e instanceof Qi) {
		let n = new no(t), r = {};
		for (let t of e._idmap.entries()) {
			let [e, r] = t;
			n.process(r);
		}
		let i = {}, a = {
			registry: e,
			uri: t?.uri,
			defs: r
		};
		for (let r of e._idmap.entries()) {
			let [e, o] = r;
			i[e] = n.emit(o, {
				...t,
				external: a
			});
		}
		return Object.keys(r).length > 0 && (i.__shared = { [n.target === "draft-2020-12" ? "$defs" : "definitions"]: r }), { schemas: i };
	}
	let n = new no(t);
	return n.process(e), n.emit(e, t);
}
function io(e, t) {
	let n = t ?? { seen: /* @__PURE__ */ new Set() };
	if (n.seen.has(e)) return !1;
	n.seen.add(e);
	let r = e._zod.def;
	switch (r.type) {
		case "string":
		case "number":
		case "bigint":
		case "boolean":
		case "date":
		case "symbol":
		case "undefined":
		case "null":
		case "any":
		case "unknown":
		case "never":
		case "void":
		case "literal":
		case "enum":
		case "nan":
		case "file":
		case "template_literal": return !1;
		case "array": return io(r.element, n);
		case "object":
			for (let e in r.shape) if (io(r.shape[e], n)) return !0;
			return !1;
		case "union":
			for (let e of r.options) if (io(e, n)) return !0;
			return !1;
		case "intersection": return io(r.left, n) || io(r.right, n);
		case "tuple":
			for (let e of r.items) if (io(e, n)) return !0;
			return !!(r.rest && io(r.rest, n));
		case "record": return io(r.keyType, n) || io(r.valueType, n);
		case "map": return io(r.keyType, n) || io(r.valueType, n);
		case "set": return io(r.valueType, n);
		case "promise":
		case "optional":
		case "nonoptional":
		case "nullable":
		case "readonly": return io(r.innerType, n);
		case "lazy": return io(r.getter(), n);
		case "default": return io(r.innerType, n);
		case "prefault": return io(r.innerType, n);
		case "custom": return !1;
		case "transform": return !0;
		case "pipe": return io(r.in, n) || io(r.out, n);
		case "success": return !1;
		case "catch": return !1;
	}
	throw Error(`Unknown schema type: ${r.type}`);
}
//#endregion
//#region node_modules/zod/v4/mini/schemas.js
var ao = /*@__PURE__*/ N("ZodMiniType", (e, t) => {
	if (!e._zod) throw Error("Uninitialized schema in ZodMiniType.");
	I.init(e, t), e.def = t, e.parse = (t, n) => Bn(e, t, n, { callee: e.parse }), e.safeParse = (t, n) => Wn(e, t, n), e.parseAsync = async (t, n) => Hn(e, t, n, { callee: e.parseAsync }), e.safeParseAsync = async (t, n) => Kn(e, t, n), e.check = (...n) => e.clone({
		...t,
		checks: [...t.checks ?? [], ...n.map((e) => typeof e == "function" ? { _zod: {
			check: e,
			def: { check: "custom" },
			onattach: []
		} } : e)]
	}), e.clone = (t, n) => yn(e, t, n), e.brand = () => e, e.register = ((t, n) => (t.add(e, n), e));
}), oo = /*@__PURE__*/ N("ZodMiniObject", (e, t) => {
	Di.init(e, t), ao.init(e, t), P(e, "shape", () => t.shape);
});
function so(e, t) {
	return new oo({
		type: "object",
		get shape() {
			return dn(this, "shape", { ...e }), this.shape;
		},
		...F(t)
	});
}
//#endregion
//#region node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js
function co(e) {
	return !!e._zod;
}
function lo(e) {
	let t = Object.values(e);
	if (t.length === 0) return so({});
	let n = t.every(co), r = t.every((e) => !co(e));
	if (n) return so(e);
	if (r) return $t(e);
	throw Error("Mixed Zod versions detected in object shape.");
}
function uo(e, t) {
	return co(e) ? Wn(e, t) : e.safeParse(t);
}
async function fo(e, t) {
	return co(e) ? await Kn(e, t) : await e.safeParseAsync(t);
}
function po(e) {
	if (!e) return;
	let t;
	if (t = co(e) ? e._zod?.def?.shape : e.shape, t) {
		if (typeof t == "function") try {
			return t();
		} catch {
			return;
		}
		return t;
	}
}
function mo(e) {
	if (e) {
		if (typeof e == "object") {
			let t = e, n = e;
			if (!t._def && !n._zod) {
				let t = Object.values(e);
				if (t.length > 0 && t.every((e) => typeof e == "object" && !!e && (e._def !== void 0 || e._zod !== void 0 || typeof e.parse == "function"))) return lo(e);
			}
		}
		if (co(e)) {
			let t = e._zod?.def;
			if (t && (t.type === "object" || t.shape !== void 0)) return e;
		} else if (e.shape !== void 0) return e;
	}
}
function ho(e) {
	return e.length === 0 ? "object root" : e.reduce((e, t, n) => n === 0 ? String(t) : typeof t == "number" ? `${e}[${t}]` : `${e}.${t}`, "");
}
function go(e) {
	if (e && typeof e == "object") {
		if ("issues" in e && Array.isArray(e.issues) && e.issues.length > 0) return e.issues.map((e) => e.path?.length ? `${e.message} at ${ho(e.path)}` : e.message).join("\n");
		if ("message" in e && typeof e.message == "string") return e.message;
		try {
			return JSON.stringify(e);
		} catch {
			return String(e);
		}
	}
	return String(e);
}
function _o(e) {
	return e.description;
}
function vo(e) {
	if (co(e)) return e._zod?.def?.type === "optional";
	let t = e;
	return typeof e.isOptional == "function" ? e.isOptional() : t._def?.typeName === "ZodOptional";
}
function yo(e) {
	if (co(e)) {
		let t = e._zod?.def;
		if (t) {
			if (t.value !== void 0) return t.value;
			if (Array.isArray(t.values) && t.values.length > 0) return t.values[0];
		}
	}
	let t = e._def;
	if (t) {
		if (t.value !== void 0) return t.value;
		if (Array.isArray(t.values) && t.values.length > 0) return t.values[0];
	}
	let n = e.value;
	if (n !== void 0) return n;
}
//#endregion
//#region node_modules/zod/v4/classic/iso.js
var bo = /*@__PURE__*/ N("ZodISODateTime", (e, t) => {
	ni.init(e, t), Io.init(e, t);
});
function xo(e) {
	return wa(bo, e);
}
var So = /*@__PURE__*/ N("ZodISODate", (e, t) => {
	ri.init(e, t), Io.init(e, t);
});
function Co(e) {
	return Ta(So, e);
}
var wo = /*@__PURE__*/ N("ZodISOTime", (e, t) => {
	ii.init(e, t), Io.init(e, t);
});
function To(e) {
	return Ea(wo, e);
}
var Eo = /*@__PURE__*/ N("ZodISODuration", (e, t) => {
	ai.init(e, t), Io.init(e, t);
});
function Do(e) {
	return Da(Eo, e);
}
//#endregion
//#region node_modules/zod/v4/classic/errors.js
var Oo = (e, t) => {
	Fn.init(e, t), e.name = "ZodError", Object.defineProperties(e, {
		format: { value: (t) => Rn(e, t) },
		flatten: { value: (t) => Ln(e, t) },
		addIssue: { value: (t) => e.issues.push(t) },
		addIssues: { value: (t) => e.issues.push(...t) },
		isEmpty: { get() {
			return e.issues.length === 0;
		} }
	});
};
N("ZodError", Oo);
var ko = N("ZodError", Oo, { Parent: Error }), Ao = /* @__PURE__ */ zn(ko), jo = /* @__PURE__ */ Vn(ko), Mo = /* @__PURE__ */ Un(ko), No = /* @__PURE__ */ Gn(ko), R = /*@__PURE__*/ N("ZodType", (e, t) => (I.init(e, t), e.def = t, Object.defineProperty(e, "_def", { value: t }), e.check = (...n) => e.clone({
	...t,
	checks: [...t.checks ?? [], ...n.map((e) => typeof e == "function" ? { _zod: {
		check: e,
		def: { check: "custom" },
		onattach: []
	} } : e)]
}), e.clone = (t, n) => yn(e, t, n), e.brand = () => e, e.register = ((t, n) => (t.add(e, n), e)), e.parse = (t, n) => Ao(e, t, n, { callee: e.parse }), e.safeParse = (t, n) => Mo(e, t, n), e.parseAsync = async (t, n) => jo(e, t, n, { callee: e.parseAsync }), e.safeParseAsync = async (t, n) => No(e, t, n), e.spa = e.safeParseAsync, e.refine = (t, n) => e.check(Ks(t, n)), e.superRefine = (t) => e.check(qs(t)), e.overwrite = (t) => e.check(Ja(t)), e.optional = () => Os(e), e.nullable = () => As(e), e.nullish = () => Os(As(e)), e.nonoptional = (t) => Is(e, t), e.array = () => V(e), e.or = (t) => U([e, t]), e.and = (t) => bs(e, t), e.transform = (t) => Bs(e, Es(t)), e.default = (t) => Ms(e, t), e.prefault = (t) => Ps(e, t), e.catch = (t) => Rs(e, t), e.pipe = (t) => Bs(e, t), e.readonly = () => Hs(e), e.describe = (t) => {
	let n = e.clone();
	return ea.add(n, { description: t }), n;
}, Object.defineProperty(e, "description", {
	get() {
		return ea.get(e)?.description;
	},
	configurable: !0
}), e.meta = (...t) => {
	if (t.length === 0) return ea.get(e);
	let n = e.clone();
	return ea.add(n, t[0]), n;
}, e.isOptional = () => e.safeParse(void 0).success, e.isNullable = () => e.safeParse(null).success, e)), Po = /*@__PURE__*/ N("_ZodString", (e, t) => {
	Wr.init(e, t), R.init(e, t);
	let n = e._zod.bag;
	e.format = n.format ?? null, e.minLength = n.minimum ?? null, e.maxLength = n.maximum ?? null, e.regex = (...t) => e.check(Ha(...t)), e.includes = (...t) => e.check(Ga(...t)), e.startsWith = (...t) => e.check(Ka(...t)), e.endsWith = (...t) => e.check(qa(...t)), e.min = (...t) => e.check(Ba(...t)), e.max = (...t) => e.check(za(...t)), e.length = (...t) => e.check(Va(...t)), e.nonempty = (...t) => e.check(Ba(1, ...t)), e.lowercase = (t) => e.check(Ua(t)), e.uppercase = (t) => e.check(Wa(t)), e.trim = () => e.check(Xa()), e.normalize = (...t) => e.check(Ya(...t)), e.toLowerCase = () => e.check(Za()), e.toUpperCase = () => e.check(Qa());
}), Fo = /*@__PURE__*/ N("ZodString", (e, t) => {
	Wr.init(e, t), Po.init(e, t), e.email = (t) => e.check(na(Lo, t)), e.url = (t) => e.check(ca(Bo, t)), e.jwt = (t) => e.check(Ca(ts, t)), e.emoji = (t) => e.check(la(Vo, t)), e.guid = (t) => e.check(ra(Ro, t)), e.uuid = (t) => e.check(ia(zo, t)), e.uuidv4 = (t) => e.check(aa(zo, t)), e.uuidv6 = (t) => e.check(oa(zo, t)), e.uuidv7 = (t) => e.check(sa(zo, t)), e.nanoid = (t) => e.check(ua(Ho, t)), e.guid = (t) => e.check(ra(Ro, t)), e.cuid = (t) => e.check(da(Uo, t)), e.cuid2 = (t) => e.check(fa(Wo, t)), e.ulid = (t) => e.check(pa(Go, t)), e.base64 = (t) => e.check(ba(Qo, t)), e.base64url = (t) => e.check(xa($o, t)), e.xid = (t) => e.check(ma(Ko, t)), e.ksuid = (t) => e.check(ha(qo, t)), e.ipv4 = (t) => e.check(ga(Jo, t)), e.ipv6 = (t) => e.check(_a(Yo, t)), e.cidrv4 = (t) => e.check(va(Xo, t)), e.cidrv6 = (t) => e.check(ya(Zo, t)), e.e164 = (t) => e.check(Sa(es, t)), e.datetime = (t) => e.check(xo(t)), e.date = (t) => e.check(Co(t)), e.time = (t) => e.check(To(t)), e.duration = (t) => e.check(Do(t));
});
function z(e) {
	return ta(Fo, e);
}
var Io = /*@__PURE__*/ N("ZodStringFormat", (e, t) => {
	L.init(e, t), Po.init(e, t);
}), Lo = /*@__PURE__*/ N("ZodEmail", (e, t) => {
	qr.init(e, t), Io.init(e, t);
}), Ro = /*@__PURE__*/ N("ZodGUID", (e, t) => {
	Gr.init(e, t), Io.init(e, t);
}), zo = /*@__PURE__*/ N("ZodUUID", (e, t) => {
	Kr.init(e, t), Io.init(e, t);
}), Bo = /*@__PURE__*/ N("ZodURL", (e, t) => {
	Jr.init(e, t), Io.init(e, t);
}), Vo = /*@__PURE__*/ N("ZodEmoji", (e, t) => {
	Yr.init(e, t), Io.init(e, t);
}), Ho = /*@__PURE__*/ N("ZodNanoID", (e, t) => {
	Xr.init(e, t), Io.init(e, t);
}), Uo = /*@__PURE__*/ N("ZodCUID", (e, t) => {
	Zr.init(e, t), Io.init(e, t);
}), Wo = /*@__PURE__*/ N("ZodCUID2", (e, t) => {
	Qr.init(e, t), Io.init(e, t);
}), Go = /*@__PURE__*/ N("ZodULID", (e, t) => {
	$r.init(e, t), Io.init(e, t);
}), Ko = /*@__PURE__*/ N("ZodXID", (e, t) => {
	ei.init(e, t), Io.init(e, t);
}), qo = /*@__PURE__*/ N("ZodKSUID", (e, t) => {
	ti.init(e, t), Io.init(e, t);
}), Jo = /*@__PURE__*/ N("ZodIPv4", (e, t) => {
	oi.init(e, t), Io.init(e, t);
}), Yo = /*@__PURE__*/ N("ZodIPv6", (e, t) => {
	si.init(e, t), Io.init(e, t);
}), Xo = /*@__PURE__*/ N("ZodCIDRv4", (e, t) => {
	ci.init(e, t), Io.init(e, t);
}), Zo = /*@__PURE__*/ N("ZodCIDRv6", (e, t) => {
	li.init(e, t), Io.init(e, t);
}), Qo = /*@__PURE__*/ N("ZodBase64", (e, t) => {
	di.init(e, t), Io.init(e, t);
}), $o = /*@__PURE__*/ N("ZodBase64URL", (e, t) => {
	pi.init(e, t), Io.init(e, t);
}), es = /*@__PURE__*/ N("ZodE164", (e, t) => {
	mi.init(e, t), Io.init(e, t);
}), ts = /*@__PURE__*/ N("ZodJWT", (e, t) => {
	gi.init(e, t), Io.init(e, t);
}), ns = /*@__PURE__*/ N("ZodNumber", (e, t) => {
	_i.init(e, t), R.init(e, t), e.gt = (t, n) => e.check(Ia(t, n)), e.gte = (t, n) => e.check(La(t, n)), e.min = (t, n) => e.check(La(t, n)), e.lt = (t, n) => e.check(Pa(t, n)), e.lte = (t, n) => e.check(Fa(t, n)), e.max = (t, n) => e.check(Fa(t, n)), e.int = (t) => e.check(is(t)), e.safe = (t) => e.check(is(t)), e.positive = (t) => e.check(Ia(0, t)), e.nonnegative = (t) => e.check(La(0, t)), e.negative = (t) => e.check(Pa(0, t)), e.nonpositive = (t) => e.check(Fa(0, t)), e.multipleOf = (t, n) => e.check(Ra(t, n)), e.step = (t, n) => e.check(Ra(t, n)), e.finite = () => e;
	let n = e._zod.bag;
	e.minValue = Math.max(n.minimum ?? -Infinity, n.exclusiveMinimum ?? -Infinity) ?? null, e.maxValue = Math.min(n.maximum ?? Infinity, n.exclusiveMaximum ?? Infinity) ?? null, e.isInt = (n.format ?? "").includes("int") || Number.isSafeInteger(n.multipleOf ?? .5), e.isFinite = !0, e.format = n.format ?? null;
});
function B(e) {
	return Oa(ns, e);
}
var rs = /*@__PURE__*/ N("ZodNumberFormat", (e, t) => {
	vi.init(e, t), ns.init(e, t);
});
function is(e) {
	return ka(rs, e);
}
var as = /*@__PURE__*/ N("ZodBoolean", (e, t) => {
	yi.init(e, t), R.init(e, t);
});
function os(e) {
	return Aa(as, e);
}
var ss = /*@__PURE__*/ N("ZodNull", (e, t) => {
	bi.init(e, t), R.init(e, t);
});
function cs(e) {
	return ja(ss, e);
}
var ls = /*@__PURE__*/ N("ZodUnknown", (e, t) => {
	xi.init(e, t), R.init(e, t);
});
function us() {
	return Ma(ls);
}
var ds = /*@__PURE__*/ N("ZodNever", (e, t) => {
	Si.init(e, t), R.init(e, t);
});
function fs(e) {
	return Na(ds, e);
}
var ps = /*@__PURE__*/ N("ZodArray", (e, t) => {
	wi.init(e, t), R.init(e, t), e.element = t.element, e.min = (t, n) => e.check(Ba(t, n)), e.nonempty = (t) => e.check(Ba(1, t)), e.max = (t, n) => e.check(za(t, n)), e.length = (t, n) => e.check(Va(t, n)), e.unwrap = () => e.element;
});
function V(e, t) {
	return $a(ps, e, t);
}
var ms = /*@__PURE__*/ N("ZodObject", (e, t) => {
	Di.init(e, t), R.init(e, t), P(e, "shape", () => t.shape), e.keyof = () => Cs(Object.keys(e._zod.def.shape)), e.catchall = (t) => e.clone({
		...e._zod.def,
		catchall: t
	}), e.passthrough = () => e.clone({
		...e._zod.def,
		catchall: us()
	}), e.loose = () => e.clone({
		...e._zod.def,
		catchall: us()
	}), e.strict = () => e.clone({
		...e._zod.def,
		catchall: fs()
	}), e.strip = () => e.clone({
		...e._zod.def,
		catchall: void 0
	}), e.extend = (t) => wn(e, t), e.merge = (t) => Tn(e, t), e.pick = (t) => Sn(e, t), e.omit = (t) => Cn(e, t), e.partial = (...t) => En(Ds, e, t[0]), e.required = (...t) => Dn(Fs, e, t[0]);
});
function H(e, t) {
	return new ms({
		type: "object",
		get shape() {
			return dn(this, "shape", { ...e }), this.shape;
		},
		...F(t)
	});
}
function hs(e, t) {
	return new ms({
		type: "object",
		get shape() {
			return dn(this, "shape", { ...e }), this.shape;
		},
		catchall: us(),
		...F(t)
	});
}
var gs = /*@__PURE__*/ N("ZodUnion", (e, t) => {
	ki.init(e, t), R.init(e, t), e.options = t.options;
});
function U(e, t) {
	return new gs({
		type: "union",
		options: e,
		...F(t)
	});
}
var _s = /*@__PURE__*/ N("ZodDiscriminatedUnion", (e, t) => {
	gs.init(e, t), Ai.init(e, t);
});
function vs(e, t, n) {
	return new _s({
		type: "union",
		options: t,
		discriminator: e,
		...F(n)
	});
}
var ys = /*@__PURE__*/ N("ZodIntersection", (e, t) => {
	ji.init(e, t), R.init(e, t);
});
function bs(e, t) {
	return new ys({
		type: "intersection",
		left: e,
		right: t
	});
}
var xs = /*@__PURE__*/ N("ZodRecord", (e, t) => {
	Pi.init(e, t), R.init(e, t), e.keyType = t.keyType, e.valueType = t.valueType;
});
function W(e, t, n) {
	return new xs({
		type: "record",
		keyType: e,
		valueType: t,
		...F(n)
	});
}
var Ss = /*@__PURE__*/ N("ZodEnum", (e, t) => {
	Fi.init(e, t), R.init(e, t), e.enum = t.entries, e.options = Object.values(t.entries);
	let n = new Set(Object.keys(t.entries));
	e.extract = (e, r) => {
		let i = {};
		for (let r of e) if (n.has(r)) i[r] = t.entries[r];
		else throw Error(`Key ${r} not found in enum`);
		return new Ss({
			...t,
			checks: [],
			...F(r),
			entries: i
		});
	}, e.exclude = (e, r) => {
		let i = { ...t.entries };
		for (let t of e) if (n.has(t)) delete i[t];
		else throw Error(`Key ${t} not found in enum`);
		return new Ss({
			...t,
			checks: [],
			...F(r),
			entries: i
		});
	};
});
function Cs(e, t) {
	return new Ss({
		type: "enum",
		entries: Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e,
		...F(t)
	});
}
var ws = /*@__PURE__*/ N("ZodLiteral", (e, t) => {
	Ii.init(e, t), R.init(e, t), e.values = new Set(t.values), Object.defineProperty(e, "value", { get() {
		if (t.values.length > 1) throw Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return t.values[0];
	} });
});
function G(e, t) {
	return new ws({
		type: "literal",
		values: Array.isArray(e) ? e : [e],
		...F(t)
	});
}
var Ts = /*@__PURE__*/ N("ZodTransform", (e, t) => {
	Li.init(e, t), R.init(e, t), e._zod.parse = (n, r) => {
		n.addIssue = (r) => {
			if (typeof r == "string") n.issues.push(Nn(r, n.value, t));
			else {
				let t = r;
				t.fatal && (t.continue = !1), t.code ??= "custom", t.input ??= n.value, t.inst ??= e, t.continue ??= !0, n.issues.push(Nn(t));
			}
		};
		let i = t.transform(n.value, n);
		return i instanceof Promise ? i.then((e) => (n.value = e, n)) : (n.value = i, n);
	};
});
function Es(e) {
	return new Ts({
		type: "transform",
		transform: e
	});
}
var Ds = /*@__PURE__*/ N("ZodOptional", (e, t) => {
	Ri.init(e, t), R.init(e, t), e.unwrap = () => e._zod.def.innerType;
});
function Os(e) {
	return new Ds({
		type: "optional",
		innerType: e
	});
}
var ks = /*@__PURE__*/ N("ZodNullable", (e, t) => {
	zi.init(e, t), R.init(e, t), e.unwrap = () => e._zod.def.innerType;
});
function As(e) {
	return new ks({
		type: "nullable",
		innerType: e
	});
}
var js = /*@__PURE__*/ N("ZodDefault", (e, t) => {
	Bi.init(e, t), R.init(e, t), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function Ms(e, t) {
	return new js({
		type: "default",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : t;
		}
	});
}
var Ns = /*@__PURE__*/ N("ZodPrefault", (e, t) => {
	Hi.init(e, t), R.init(e, t), e.unwrap = () => e._zod.def.innerType;
});
function Ps(e, t) {
	return new Ns({
		type: "prefault",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : t;
		}
	});
}
var Fs = /*@__PURE__*/ N("ZodNonOptional", (e, t) => {
	Ui.init(e, t), R.init(e, t), e.unwrap = () => e._zod.def.innerType;
});
function Is(e, t) {
	return new Fs({
		type: "nonoptional",
		innerType: e,
		...F(t)
	});
}
var Ls = /*@__PURE__*/ N("ZodCatch", (e, t) => {
	Gi.init(e, t), R.init(e, t), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function Rs(e, t) {
	return new Ls({
		type: "catch",
		innerType: e,
		catchValue: typeof t == "function" ? t : () => t
	});
}
var zs = /*@__PURE__*/ N("ZodPipe", (e, t) => {
	Ki.init(e, t), R.init(e, t), e.in = t.in, e.out = t.out;
});
function Bs(e, t) {
	return new zs({
		type: "pipe",
		in: e,
		out: t
	});
}
var Vs = /*@__PURE__*/ N("ZodReadonly", (e, t) => {
	Ji.init(e, t), R.init(e, t);
});
function Hs(e) {
	return new Vs({
		type: "readonly",
		innerType: e
	});
}
var Us = /*@__PURE__*/ N("ZodCustom", (e, t) => {
	Xi.init(e, t), R.init(e, t);
});
function Ws(e) {
	let t = new Tr({ check: "custom" });
	return t._zod.check = e, t;
}
function Gs(e, t) {
	return eo(Us, e ?? (() => !0), t);
}
function Ks(e, t = {}) {
	return to(Us, e, t);
}
function qs(e) {
	let t = Ws((n) => (n.addIssue = (e) => {
		if (typeof e == "string") n.issues.push(Nn(e, n.value, t._zod.def));
		else {
			let r = e;
			r.fatal && (r.continue = !1), r.code ??= "custom", r.input ??= n.value, r.inst ??= t, r.continue ??= !t._zod.def.abort, n.issues.push(Nn(r));
		}
	}, e(n.value, n)));
	return t;
}
function Js(e, t) {
	return Bs(Es(e), t);
}
//#endregion
//#region node_modules/@modelcontextprotocol/sdk/dist/esm/types.js
var Ys = "2025-11-25", Xs = [
	Ys,
	"2025-06-18",
	"2025-03-26",
	"2024-11-05",
	"2024-10-07"
], Zs = "io.modelcontextprotocol/related-task", Qs = Gs((e) => e !== null && (typeof e == "object" || typeof e == "function")), $s = U([z(), B().int()]), ec = z();
hs({
	ttl: B().optional(),
	pollInterval: B().optional()
});
var tc = H({ ttl: B().optional() }), nc = H({ taskId: z() }), rc = hs({
	progressToken: $s.optional(),
	[Zs]: nc.optional()
}), ic = H({ _meta: rc.optional() }), ac = ic.extend({ task: tc.optional() }), oc = (e) => ac.safeParse(e).success, sc = H({
	method: z(),
	params: ic.loose().optional()
}), cc = H({ _meta: rc.optional() }), lc = H({
	method: z(),
	params: cc.loose().optional()
}), uc = hs({ _meta: rc.optional() }), dc = U([z(), B().int()]), fc = H({
	jsonrpc: G("2.0"),
	id: dc,
	...sc.shape
}).strict(), pc = (e) => fc.safeParse(e).success, mc = H({
	jsonrpc: G("2.0"),
	...lc.shape
}).strict(), hc = (e) => mc.safeParse(e).success, gc = H({
	jsonrpc: G("2.0"),
	id: dc,
	result: uc
}).strict(), _c = (e) => gc.safeParse(e).success, K;
(function(e) {
	e[e.ConnectionClosed = -32e3] = "ConnectionClosed", e[e.RequestTimeout = -32001] = "RequestTimeout", e[e.ParseError = -32700] = "ParseError", e[e.InvalidRequest = -32600] = "InvalidRequest", e[e.MethodNotFound = -32601] = "MethodNotFound", e[e.InvalidParams = -32602] = "InvalidParams", e[e.InternalError = -32603] = "InternalError", e[e.UrlElicitationRequired = -32042] = "UrlElicitationRequired";
})(K ||= {});
var vc = H({
	jsonrpc: G("2.0"),
	id: dc.optional(),
	error: H({
		code: B().int(),
		message: z(),
		data: us().optional()
	})
}).strict(), yc = (e) => vc.safeParse(e).success, bc = U([
	fc,
	mc,
	gc,
	vc
]);
U([gc, vc]);
var xc = uc.strict(), Sc = cc.extend({
	requestId: dc.optional(),
	reason: z().optional()
}), Cc = lc.extend({
	method: G("notifications/cancelled"),
	params: Sc
}), wc = H({ icons: V(H({
	src: z(),
	mimeType: z().optional(),
	sizes: V(z()).optional(),
	theme: Cs(["light", "dark"]).optional()
})).optional() }), Tc = H({
	name: z(),
	title: z().optional()
}), Ec = Tc.extend({
	...Tc.shape,
	...wc.shape,
	version: z(),
	websiteUrl: z().optional(),
	description: z().optional()
}), Dc = Js((e) => e && typeof e == "object" && !Array.isArray(e) && Object.keys(e).length === 0 ? { form: {} } : e, bs(H({
	form: bs(H({ applyDefaults: os().optional() }), W(z(), us())).optional(),
	url: Qs.optional()
}), W(z(), us()).optional())), Oc = hs({
	list: Qs.optional(),
	cancel: Qs.optional(),
	requests: hs({
		sampling: hs({ createMessage: Qs.optional() }).optional(),
		elicitation: hs({ create: Qs.optional() }).optional()
	}).optional()
}), kc = hs({
	list: Qs.optional(),
	cancel: Qs.optional(),
	requests: hs({ tools: hs({ call: Qs.optional() }).optional() }).optional()
}), Ac = H({
	experimental: W(z(), Qs).optional(),
	sampling: H({
		context: Qs.optional(),
		tools: Qs.optional()
	}).optional(),
	elicitation: Dc.optional(),
	roots: H({ listChanged: os().optional() }).optional(),
	tasks: Oc.optional(),
	extensions: W(z(), Qs).optional()
}), jc = ic.extend({
	protocolVersion: z(),
	capabilities: Ac,
	clientInfo: Ec
}), Mc = sc.extend({
	method: G("initialize"),
	params: jc
}), Nc = H({
	experimental: W(z(), Qs).optional(),
	logging: Qs.optional(),
	completions: Qs.optional(),
	prompts: H({ listChanged: os().optional() }).optional(),
	resources: H({
		subscribe: os().optional(),
		listChanged: os().optional()
	}).optional(),
	tools: H({ listChanged: os().optional() }).optional(),
	tasks: kc.optional(),
	extensions: W(z(), Qs).optional()
}), Pc = uc.extend({
	protocolVersion: z(),
	capabilities: Nc,
	serverInfo: Ec,
	instructions: z().optional()
}), Fc = lc.extend({
	method: G("notifications/initialized"),
	params: cc.optional()
}), Ic = sc.extend({
	method: G("ping"),
	params: ic.optional()
}), Lc = H({
	progress: B(),
	total: Os(B()),
	message: Os(z())
}), Rc = H({
	...cc.shape,
	...Lc.shape,
	progressToken: $s
}), zc = lc.extend({
	method: G("notifications/progress"),
	params: Rc
}), Bc = ic.extend({ cursor: ec.optional() }), Vc = sc.extend({ params: Bc.optional() }), Hc = uc.extend({ nextCursor: ec.optional() }), Uc = Cs([
	"working",
	"input_required",
	"completed",
	"failed",
	"cancelled"
]), Wc = H({
	taskId: z(),
	status: Uc,
	ttl: U([B(), cs()]),
	createdAt: z(),
	lastUpdatedAt: z(),
	pollInterval: Os(B()),
	statusMessage: Os(z())
}), Gc = uc.extend({ task: Wc }), Kc = cc.merge(Wc), qc = lc.extend({
	method: G("notifications/tasks/status"),
	params: Kc
}), Jc = sc.extend({
	method: G("tasks/get"),
	params: ic.extend({ taskId: z() })
}), Yc = uc.merge(Wc), Xc = sc.extend({
	method: G("tasks/result"),
	params: ic.extend({ taskId: z() })
});
uc.loose();
var Zc = Vc.extend({ method: G("tasks/list") }), Qc = Hc.extend({ tasks: V(Wc) }), $c = sc.extend({
	method: G("tasks/cancel"),
	params: ic.extend({ taskId: z() })
}), el = uc.merge(Wc), tl = H({
	uri: z(),
	mimeType: Os(z()),
	_meta: W(z(), us()).optional()
}), nl = tl.extend({ text: z() }), rl = z().refine((e) => {
	try {
		return atob(e), !0;
	} catch {
		return !1;
	}
}, { message: "Invalid Base64 string" }), il = tl.extend({ blob: rl }), al = Cs(["user", "assistant"]), ol = H({
	audience: V(al).optional(),
	priority: B().min(0).max(1).optional(),
	lastModified: xo({ offset: !0 }).optional()
}), sl = H({
	...Tc.shape,
	...wc.shape,
	uri: z(),
	description: Os(z()),
	mimeType: Os(z()),
	size: Os(B()),
	annotations: ol.optional(),
	_meta: Os(hs({}))
}), cl = H({
	...Tc.shape,
	...wc.shape,
	uriTemplate: z(),
	description: Os(z()),
	mimeType: Os(z()),
	annotations: ol.optional(),
	_meta: Os(hs({}))
}), ll = Vc.extend({ method: G("resources/list") }), ul = Hc.extend({ resources: V(sl) }), dl = Vc.extend({ method: G("resources/templates/list") }), fl = Hc.extend({ resourceTemplates: V(cl) }), pl = ic.extend({ uri: z() }), ml = pl, hl = sc.extend({
	method: G("resources/read"),
	params: ml
}), gl = uc.extend({ contents: V(U([nl, il])) }), _l = lc.extend({
	method: G("notifications/resources/list_changed"),
	params: cc.optional()
}), vl = pl, yl = sc.extend({
	method: G("resources/subscribe"),
	params: vl
}), bl = pl, xl = sc.extend({
	method: G("resources/unsubscribe"),
	params: bl
}), Sl = cc.extend({ uri: z() }), Cl = lc.extend({
	method: G("notifications/resources/updated"),
	params: Sl
}), wl = H({
	name: z(),
	description: Os(z()),
	required: Os(os())
}), Tl = H({
	...Tc.shape,
	...wc.shape,
	description: Os(z()),
	arguments: Os(V(wl)),
	_meta: Os(hs({}))
}), El = Vc.extend({ method: G("prompts/list") }), Dl = Hc.extend({ prompts: V(Tl) }), Ol = ic.extend({
	name: z(),
	arguments: W(z(), z()).optional()
}), kl = sc.extend({
	method: G("prompts/get"),
	params: Ol
}), Al = H({
	type: G("text"),
	text: z(),
	annotations: ol.optional(),
	_meta: W(z(), us()).optional()
}), jl = H({
	type: G("image"),
	data: rl,
	mimeType: z(),
	annotations: ol.optional(),
	_meta: W(z(), us()).optional()
}), Ml = H({
	type: G("audio"),
	data: rl,
	mimeType: z(),
	annotations: ol.optional(),
	_meta: W(z(), us()).optional()
}), Nl = H({
	type: G("tool_use"),
	name: z(),
	id: z(),
	input: W(z(), us()),
	_meta: W(z(), us()).optional()
}), Pl = H({
	type: G("resource"),
	resource: U([nl, il]),
	annotations: ol.optional(),
	_meta: W(z(), us()).optional()
}), Fl = U([
	Al,
	jl,
	Ml,
	sl.extend({ type: G("resource_link") }),
	Pl
]), Il = H({
	role: al,
	content: Fl
}), Ll = uc.extend({
	description: z().optional(),
	messages: V(Il)
}), Rl = lc.extend({
	method: G("notifications/prompts/list_changed"),
	params: cc.optional()
}), zl = H({
	title: z().optional(),
	readOnlyHint: os().optional(),
	destructiveHint: os().optional(),
	idempotentHint: os().optional(),
	openWorldHint: os().optional()
}), Bl = H({ taskSupport: Cs([
	"required",
	"optional",
	"forbidden"
]).optional() }), Vl = H({
	...Tc.shape,
	...wc.shape,
	description: z().optional(),
	inputSchema: H({
		type: G("object"),
		properties: W(z(), Qs).optional(),
		required: V(z()).optional()
	}).catchall(us()),
	outputSchema: H({
		type: G("object"),
		properties: W(z(), Qs).optional(),
		required: V(z()).optional()
	}).catchall(us()).optional(),
	annotations: zl.optional(),
	execution: Bl.optional(),
	_meta: W(z(), us()).optional()
}), Hl = Vc.extend({ method: G("tools/list") }), Ul = Hc.extend({ tools: V(Vl) }), Wl = uc.extend({
	content: V(Fl).default([]),
	structuredContent: W(z(), us()).optional(),
	isError: os().optional()
});
Wl.or(uc.extend({ toolResult: us() }));
var Gl = ac.extend({
	name: z(),
	arguments: W(z(), us()).optional()
}), Kl = sc.extend({
	method: G("tools/call"),
	params: Gl
}), ql = lc.extend({
	method: G("notifications/tools/list_changed"),
	params: cc.optional()
});
H({
	autoRefresh: os().default(!0),
	debounceMs: B().int().nonnegative().default(300)
});
var Jl = Cs([
	"debug",
	"info",
	"notice",
	"warning",
	"error",
	"critical",
	"alert",
	"emergency"
]), Yl = ic.extend({ level: Jl }), Xl = sc.extend({
	method: G("logging/setLevel"),
	params: Yl
}), Zl = cc.extend({
	level: Jl,
	logger: z().optional(),
	data: us()
}), Ql = lc.extend({
	method: G("notifications/message"),
	params: Zl
}), $l = H({
	hints: V(H({ name: z().optional() })).optional(),
	costPriority: B().min(0).max(1).optional(),
	speedPriority: B().min(0).max(1).optional(),
	intelligencePriority: B().min(0).max(1).optional()
}), eu = H({ mode: Cs([
	"auto",
	"required",
	"none"
]).optional() }), tu = H({
	type: G("tool_result"),
	toolUseId: z().describe("The unique identifier for the corresponding tool call."),
	content: V(Fl).default([]),
	structuredContent: H({}).loose().optional(),
	isError: os().optional(),
	_meta: W(z(), us()).optional()
}), nu = vs("type", [
	Al,
	jl,
	Ml
]), ru = vs("type", [
	Al,
	jl,
	Ml,
	Nl,
	tu
]), iu = H({
	role: al,
	content: U([ru, V(ru)]),
	_meta: W(z(), us()).optional()
}), au = ac.extend({
	messages: V(iu),
	modelPreferences: $l.optional(),
	systemPrompt: z().optional(),
	includeContext: Cs([
		"none",
		"thisServer",
		"allServers"
	]).optional(),
	temperature: B().optional(),
	maxTokens: B().int(),
	stopSequences: V(z()).optional(),
	metadata: Qs.optional(),
	tools: V(Vl).optional(),
	toolChoice: eu.optional()
}), ou = sc.extend({
	method: G("sampling/createMessage"),
	params: au
}), su = uc.extend({
	model: z(),
	stopReason: Os(Cs([
		"endTurn",
		"stopSequence",
		"maxTokens"
	]).or(z())),
	role: al,
	content: nu
}), cu = uc.extend({
	model: z(),
	stopReason: Os(Cs([
		"endTurn",
		"stopSequence",
		"maxTokens",
		"toolUse"
	]).or(z())),
	role: al,
	content: U([ru, V(ru)])
}), lu = H({
	type: G("boolean"),
	title: z().optional(),
	description: z().optional(),
	default: os().optional()
}), uu = H({
	type: G("string"),
	title: z().optional(),
	description: z().optional(),
	minLength: B().optional(),
	maxLength: B().optional(),
	format: Cs([
		"email",
		"uri",
		"date",
		"date-time"
	]).optional(),
	default: z().optional()
}), du = H({
	type: Cs(["number", "integer"]),
	title: z().optional(),
	description: z().optional(),
	minimum: B().optional(),
	maximum: B().optional(),
	default: B().optional()
}), fu = H({
	type: G("string"),
	title: z().optional(),
	description: z().optional(),
	enum: V(z()),
	default: z().optional()
}), pu = H({
	type: G("string"),
	title: z().optional(),
	description: z().optional(),
	oneOf: V(H({
		const: z(),
		title: z()
	})),
	default: z().optional()
}), mu = U([
	U([
		H({
			type: G("string"),
			title: z().optional(),
			description: z().optional(),
			enum: V(z()),
			enumNames: V(z()).optional(),
			default: z().optional()
		}),
		U([fu, pu]),
		U([H({
			type: G("array"),
			title: z().optional(),
			description: z().optional(),
			minItems: B().optional(),
			maxItems: B().optional(),
			items: H({
				type: G("string"),
				enum: V(z())
			}),
			default: V(z()).optional()
		}), H({
			type: G("array"),
			title: z().optional(),
			description: z().optional(),
			minItems: B().optional(),
			maxItems: B().optional(),
			items: H({ anyOf: V(H({
				const: z(),
				title: z()
			})) }),
			default: V(z()).optional()
		})])
	]),
	lu,
	uu,
	du
]), hu = U([ac.extend({
	mode: G("form").optional(),
	message: z(),
	requestedSchema: H({
		type: G("object"),
		properties: W(z(), mu),
		required: V(z()).optional()
	})
}), ac.extend({
	mode: G("url"),
	message: z(),
	elicitationId: z(),
	url: z().url()
})]), gu = sc.extend({
	method: G("elicitation/create"),
	params: hu
}), _u = cc.extend({ elicitationId: z() }), vu = lc.extend({
	method: G("notifications/elicitation/complete"),
	params: _u
}), yu = uc.extend({
	action: Cs([
		"accept",
		"decline",
		"cancel"
	]),
	content: Js((e) => e === null ? void 0 : e, W(z(), U([
		z(),
		B(),
		os(),
		V(z())
	])).optional())
}), bu = H({
	type: G("ref/resource"),
	uri: z()
}), xu = H({
	type: G("ref/prompt"),
	name: z()
}), Su = ic.extend({
	ref: U([xu, bu]),
	argument: H({
		name: z(),
		value: z()
	}),
	context: H({ arguments: W(z(), z()).optional() }).optional()
}), Cu = sc.extend({
	method: G("completion/complete"),
	params: Su
});
function wu(e) {
	if (e.params.ref.type !== "ref/prompt") throw TypeError(`Expected CompleteRequestPrompt, but got ${e.params.ref.type}`);
}
function Tu(e) {
	if (e.params.ref.type !== "ref/resource") throw TypeError(`Expected CompleteRequestResourceTemplate, but got ${e.params.ref.type}`);
}
var Eu = uc.extend({ completion: hs({
	values: V(z()).max(100),
	total: Os(B().int()),
	hasMore: Os(os())
}) }), Du = H({
	uri: z().startsWith("file://"),
	name: z().optional(),
	_meta: W(z(), us()).optional()
}), Ou = sc.extend({
	method: G("roots/list"),
	params: ic.optional()
}), ku = uc.extend({ roots: V(Du) }), Au = lc.extend({
	method: G("notifications/roots/list_changed"),
	params: cc.optional()
});
U([
	Ic,
	Mc,
	Cu,
	Xl,
	kl,
	El,
	ll,
	dl,
	hl,
	yl,
	xl,
	Kl,
	Hl,
	Jc,
	Xc,
	Zc,
	$c
]), U([
	Cc,
	zc,
	Fc,
	Au,
	qc
]), U([
	xc,
	su,
	cu,
	yu,
	ku,
	Yc,
	Qc,
	Gc
]), U([
	Ic,
	ou,
	gu,
	Ou,
	Jc,
	Xc,
	Zc,
	$c
]), U([
	Cc,
	zc,
	Ql,
	Cl,
	_l,
	ql,
	Rl,
	qc,
	vu
]), U([
	xc,
	Pc,
	Eu,
	Ll,
	Dl,
	ul,
	fl,
	gl,
	Wl,
	Ul,
	Yc,
	Qc,
	Gc
]);
var q = class e extends Error {
	constructor(e, t, n) {
		super(`MCP error ${e}: ${t}`), this.code = e, this.data = n, this.name = "McpError";
	}
	static fromError(t, n, r) {
		if (t === K.UrlElicitationRequired && r) {
			let e = r;
			if (e.elicitations) return new ju(e.elicitations, n);
		}
		return new e(t, n, r);
	}
}, ju = class extends q {
	constructor(e, t = `URL elicitation${e.length > 1 ? "s" : ""} required`) {
		super(K.UrlElicitationRequired, t, { elicitations: e });
	}
	get elicitations() {
		return this.data?.elicitations ?? [];
	}
};
//#endregion
//#region node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/interfaces.js
function Mu(e) {
	return e === "completed" || e === "failed" || e === "cancelled";
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/Options.js
var Nu = Symbol("Let zodToJsonSchema decide on which parser to use"), Pu = {
	name: void 0,
	$refStrategy: "root",
	basePath: ["#"],
	effectStrategy: "input",
	pipeStrategy: "all",
	dateStrategy: "format:date-time",
	mapStrategy: "entries",
	removeAdditionalStrategy: "passthrough",
	allowedAdditionalProperties: !0,
	rejectedAdditionalProperties: !1,
	definitionPath: "definitions",
	target: "jsonSchema7",
	strictUnions: !1,
	definitions: {},
	errorMessages: !1,
	markdownDescription: !1,
	patternStrategy: "escape",
	applyRegexFlags: !1,
	emailStrategy: "format:email",
	base64Strategy: "contentEncoding:base64",
	nameStrategy: "ref",
	openAiAnyTypeName: "OpenAiAnyType"
}, Fu = (e) => typeof e == "string" ? {
	...Pu,
	name: e
} : {
	...Pu,
	...e
}, Iu = (e) => {
	let t = Fu(e), n = t.name === void 0 ? t.basePath : [
		...t.basePath,
		t.definitionPath,
		t.name
	];
	return {
		...t,
		flags: { hasReferencedOpenAiAnyType: !1 },
		currentPath: n,
		propertyPath: void 0,
		seen: new Map(Object.entries(t.definitions).map(([e, n]) => [n._def, {
			def: n._def,
			path: [
				...t.basePath,
				t.definitionPath,
				e
			],
			jsonSchema: void 0
		}]))
	};
};
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/errorMessages.js
function Lu(e, t, n, r) {
	r?.errorMessages && n && (e.errorMessage = {
		...e.errorMessage,
		[t]: n
	});
}
function J(e, t, n, r, i) {
	e[t] = n, Lu(e, t, r, i);
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/getRelativePath.js
var Ru = (e, t) => {
	let n = 0;
	for (; n < e.length && n < t.length && e[n] === t[n]; n++);
	return [(e.length - n).toString(), ...t.slice(n)].join("/");
};
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/any.js
function zu(e) {
	if (e.target !== "openAi") return {};
	let t = [
		...e.basePath,
		e.definitionPath,
		e.openAiAnyTypeName
	];
	return e.flags.hasReferencedOpenAiAnyType = !0, { $ref: e.$refStrategy === "relative" ? Ru(t, e.currentPath) : t.join("/") };
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/array.js
function Bu(e, t) {
	let n = { type: "array" };
	return e.type?._def && e.type?._def?.typeName !== M.ZodAny && (n.items = Y(e.type._def, {
		...t,
		currentPath: [...t.currentPath, "items"]
	})), e.minLength && J(n, "minItems", e.minLength.value, e.minLength.message, t), e.maxLength && J(n, "maxItems", e.maxLength.value, e.maxLength.message, t), e.exactLength && (J(n, "minItems", e.exactLength.value, e.exactLength.message, t), J(n, "maxItems", e.exactLength.value, e.exactLength.message, t)), n;
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/bigint.js
function Vu(e, t) {
	let n = {
		type: "integer",
		format: "int64"
	};
	if (!e.checks) return n;
	for (let r of e.checks) switch (r.kind) {
		case "min":
			t.target === "jsonSchema7" ? r.inclusive ? J(n, "minimum", r.value, r.message, t) : J(n, "exclusiveMinimum", r.value, r.message, t) : (r.inclusive || (n.exclusiveMinimum = !0), J(n, "minimum", r.value, r.message, t));
			break;
		case "max":
			t.target === "jsonSchema7" ? r.inclusive ? J(n, "maximum", r.value, r.message, t) : J(n, "exclusiveMaximum", r.value, r.message, t) : (r.inclusive || (n.exclusiveMaximum = !0), J(n, "maximum", r.value, r.message, t));
			break;
		case "multipleOf": J(n, "multipleOf", r.value, r.message, t);
	}
	return n;
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/boolean.js
function Hu() {
	return { type: "boolean" };
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/branded.js
function Uu(e, t) {
	return Y(e.type._def, t);
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/catch.js
var Wu = (e, t) => Y(e.innerType._def, t);
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/date.js
function Gu(e, t, n) {
	let r = n ?? t.dateStrategy;
	if (Array.isArray(r)) return { anyOf: r.map((n, r) => Gu(e, t, n)) };
	switch (r) {
		case "string":
		case "format:date-time": return {
			type: "string",
			format: "date-time"
		};
		case "format:date": return {
			type: "string",
			format: "date"
		};
		case "integer": return Ku(e, t);
	}
}
var Ku = (e, t) => {
	let n = {
		type: "integer",
		format: "unix-time"
	};
	if (t.target === "openApi3") return n;
	for (let r of e.checks) switch (r.kind) {
		case "min":
			J(n, "minimum", r.value, r.message, t);
			break;
		case "max": J(n, "maximum", r.value, r.message, t);
	}
	return n;
};
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/default.js
function qu(e, t) {
	return {
		...Y(e.innerType._def, t),
		default: e.defaultValue()
	};
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/effects.js
function Ju(e, t) {
	return t.effectStrategy === "input" ? Y(e.schema._def, t) : zu(t);
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/enum.js
function Yu(e) {
	return {
		type: "string",
		enum: Array.from(e.values)
	};
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/intersection.js
var Xu = (e) => "type" in e && e.type === "string" ? !1 : "allOf" in e;
function Zu(e, t) {
	let n = [Y(e.left._def, {
		...t,
		currentPath: [
			...t.currentPath,
			"allOf",
			"0"
		]
	}), Y(e.right._def, {
		...t,
		currentPath: [
			...t.currentPath,
			"allOf",
			"1"
		]
	})].filter((e) => !!e), r = t.target === "jsonSchema2019-09" ? { unevaluatedProperties: !1 } : void 0, i = [];
	return n.forEach((e) => {
		if (Xu(e)) i.push(...e.allOf), e.unevaluatedProperties === void 0 && (r = void 0);
		else {
			let t = e;
			if ("additionalProperties" in e && e.additionalProperties === !1) {
				let { additionalProperties: n, ...r } = e;
				t = r;
			} else r = void 0;
			i.push(t);
		}
	}), i.length ? {
		allOf: i,
		...r
	} : void 0;
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/literal.js
function Qu(e, t) {
	let n = typeof e.value;
	return n !== "bigint" && n !== "number" && n !== "boolean" && n !== "string" ? { type: Array.isArray(e.value) ? "array" : "object" } : t.target === "openApi3" ? {
		type: n === "bigint" ? "integer" : n,
		enum: [e.value]
	} : {
		type: n === "bigint" ? "integer" : n,
		const: e.value
	};
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/string.js
var $u = void 0, ed = {
	cuid: /^[cC][^\s-]{8,}$/,
	cuid2: /^[0-9a-z]+$/,
	ulid: /^[0-9A-HJKMNP-TV-Z]{26}$/,
	email: /^(?!\.)(?!.*\.\.)([a-zA-Z0-9_'+\-\.]*)[a-zA-Z0-9_+-]@([a-zA-Z0-9][a-zA-Z0-9\-]*\.)+[a-zA-Z]{2,}$/,
	emoji: () => ($u === void 0 && ($u = RegExp("^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$", "u")), $u),
	uuid: /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/,
	ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
	ipv4Cidr: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/,
	ipv6: /^(([a-f0-9]{1,4}:){7}|::([a-f0-9]{1,4}:){0,6}|([a-f0-9]{1,4}:){1}:([a-f0-9]{1,4}:){0,5}|([a-f0-9]{1,4}:){2}:([a-f0-9]{1,4}:){0,4}|([a-f0-9]{1,4}:){3}:([a-f0-9]{1,4}:){0,3}|([a-f0-9]{1,4}:){4}:([a-f0-9]{1,4}:){0,2}|([a-f0-9]{1,4}:){5}:([a-f0-9]{1,4}:){0,1})([a-f0-9]{1,4}|(((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2}))\.){3}((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2})))$/,
	ipv6Cidr: /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
	base64: /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/,
	base64url: /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/,
	nanoid: /^[a-zA-Z0-9_-]{21}$/,
	jwt: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/
};
function td(e, t) {
	let n = { type: "string" };
	if (e.checks) for (let r of e.checks) switch (r.kind) {
		case "min":
			J(n, "minLength", typeof n.minLength == "number" ? Math.max(n.minLength, r.value) : r.value, r.message, t);
			break;
		case "max":
			J(n, "maxLength", typeof n.maxLength == "number" ? Math.min(n.maxLength, r.value) : r.value, r.message, t);
			break;
		case "email":
			switch (t.emailStrategy) {
				case "format:email":
					ad(n, "email", r.message, t);
					break;
				case "format:idn-email":
					ad(n, "idn-email", r.message, t);
					break;
				case "pattern:zod": od(n, ed.email, r.message, t);
			}
			break;
		case "url":
			ad(n, "uri", r.message, t);
			break;
		case "uuid":
			ad(n, "uuid", r.message, t);
			break;
		case "regex":
			od(n, r.regex, r.message, t);
			break;
		case "cuid":
			od(n, ed.cuid, r.message, t);
			break;
		case "cuid2":
			od(n, ed.cuid2, r.message, t);
			break;
		case "startsWith":
			od(n, RegExp(`^${nd(r.value, t)}`), r.message, t);
			break;
		case "endsWith":
			od(n, RegExp(`${nd(r.value, t)}$`), r.message, t);
			break;
		case "datetime":
			ad(n, "date-time", r.message, t);
			break;
		case "date":
			ad(n, "date", r.message, t);
			break;
		case "time":
			ad(n, "time", r.message, t);
			break;
		case "duration":
			ad(n, "duration", r.message, t);
			break;
		case "length":
			J(n, "minLength", typeof n.minLength == "number" ? Math.max(n.minLength, r.value) : r.value, r.message, t), J(n, "maxLength", typeof n.maxLength == "number" ? Math.min(n.maxLength, r.value) : r.value, r.message, t);
			break;
		case "includes":
			od(n, RegExp(nd(r.value, t)), r.message, t);
			break;
		case "ip":
			r.version !== "v6" && ad(n, "ipv4", r.message, t), r.version !== "v4" && ad(n, "ipv6", r.message, t);
			break;
		case "base64url":
			od(n, ed.base64url, r.message, t);
			break;
		case "jwt":
			od(n, ed.jwt, r.message, t);
			break;
		case "cidr":
			r.version !== "v6" && od(n, ed.ipv4Cidr, r.message, t), r.version !== "v4" && od(n, ed.ipv6Cidr, r.message, t);
			break;
		case "emoji":
			od(n, ed.emoji(), r.message, t);
			break;
		case "ulid":
			od(n, ed.ulid, r.message, t);
			break;
		case "base64":
			switch (t.base64Strategy) {
				case "format:binary":
					ad(n, "binary", r.message, t);
					break;
				case "contentEncoding:base64":
					J(n, "contentEncoding", "base64", r.message, t);
					break;
				case "pattern:zod": od(n, ed.base64, r.message, t);
			}
			break;
		case "nanoid": od(n, ed.nanoid, r.message, t);
	}
	return n;
}
function nd(e, t) {
	return t.patternStrategy === "escape" ? id(e) : e;
}
var rd = /* @__PURE__ */ new Set("ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxyz0123456789");
function id(e) {
	let t = "";
	for (let n = 0; n < e.length; n++) rd.has(e[n]) || (t += "\\"), t += e[n];
	return t;
}
function ad(e, t, n, r) {
	e.format || e.anyOf?.some((e) => e.format) ? (e.anyOf ||= [], e.format && (e.anyOf.push({
		format: e.format,
		...e.errorMessage && r.errorMessages && { errorMessage: { format: e.errorMessage.format } }
	}), delete e.format, e.errorMessage && (delete e.errorMessage.format, Object.keys(e.errorMessage).length === 0 && delete e.errorMessage)), e.anyOf.push({
		format: t,
		...n && r.errorMessages && { errorMessage: { format: n } }
	})) : J(e, "format", t, n, r);
}
function od(e, t, n, r) {
	e.pattern || e.allOf?.some((e) => e.pattern) ? (e.allOf ||= [], e.pattern && (e.allOf.push({
		pattern: e.pattern,
		...e.errorMessage && r.errorMessages && { errorMessage: { pattern: e.errorMessage.pattern } }
	}), delete e.pattern, e.errorMessage && (delete e.errorMessage.pattern, Object.keys(e.errorMessage).length === 0 && delete e.errorMessage)), e.allOf.push({
		pattern: sd(t, r),
		...n && r.errorMessages && { errorMessage: { pattern: n } }
	})) : J(e, "pattern", sd(t, r), n, r);
}
function sd(e, t) {
	if (!t.applyRegexFlags || !e.flags) return e.source;
	let n = {
		i: e.flags.includes("i"),
		m: e.flags.includes("m"),
		s: e.flags.includes("s")
	}, r = n.i ? e.source.toLowerCase() : e.source, i = "", a = !1, o = !1, s = !1;
	for (let e = 0; e < r.length; e++) {
		if (a) {
			i += r[e], a = !1;
			continue;
		}
		if (n.i) {
			if (o) {
				if (r[e].match(/[a-z]/)) {
					s ? (i += r[e], i += `${r[e - 2]}-${r[e]}`.toUpperCase(), s = !1) : r[e + 1] === "-" && r[e + 2]?.match(/[a-z]/) ? (i += r[e], s = !0) : i += `${r[e]}${r[e].toUpperCase()}`;
					continue;
				}
			} else if (r[e].match(/[a-z]/)) {
				i += `[${r[e]}${r[e].toUpperCase()}]`;
				continue;
			}
		}
		if (n.m) {
			if (r[e] === "^") {
				i += "(^|(?<=[\r\n]))";
				continue;
			}
			if (r[e] === "$") {
				i += "($|(?=[\r\n]))";
				continue;
			}
		}
		if (n.s && r[e] === ".") {
			i += o ? `${r[e]}\r\n` : `[${r[e]}\r\n]`;
			continue;
		}
		i += r[e], r[e] === "\\" ? a = !0 : o && r[e] === "]" ? o = !1 : !o && r[e] === "[" && (o = !0);
	}
	try {
		new RegExp(i);
	} catch {
		return console.warn(`Could not convert regex pattern at ${t.currentPath.join("/")} to a flag-independent form! Falling back to the flag-ignorant source`), e.source;
	}
	return i;
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/record.js
function cd(e, t) {
	if (t.target === "openAi" && console.warn("Warning: OpenAI may not support records in schemas! Try an array of key-value pairs instead."), t.target === "openApi3" && e.keyType?._def.typeName === M.ZodEnum) return {
		type: "object",
		required: e.keyType._def.values,
		properties: e.keyType._def.values.reduce((n, r) => ({
			...n,
			[r]: Y(e.valueType._def, {
				...t,
				currentPath: [
					...t.currentPath,
					"properties",
					r
				]
			}) ?? zu(t)
		}), {}),
		additionalProperties: t.rejectedAdditionalProperties
	};
	let n = {
		type: "object",
		additionalProperties: Y(e.valueType._def, {
			...t,
			currentPath: [...t.currentPath, "additionalProperties"]
		}) ?? t.allowedAdditionalProperties
	};
	if (t.target === "openApi3") return n;
	if (e.keyType?._def.typeName === M.ZodString && e.keyType._def.checks?.length) {
		let { type: r, ...i } = td(e.keyType._def, t);
		return {
			...n,
			propertyNames: i
		};
	}
	if (e.keyType?._def.typeName === M.ZodEnum) return {
		...n,
		propertyNames: { enum: e.keyType._def.values }
	};
	if (e.keyType?._def.typeName === M.ZodBranded && e.keyType._def.type._def.typeName === M.ZodString && e.keyType._def.type._def.checks?.length) {
		let { type: r, ...i } = Uu(e.keyType._def, t);
		return {
			...n,
			propertyNames: i
		};
	}
	return n;
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/map.js
function ld(e, t) {
	return t.mapStrategy === "record" ? cd(e, t) : {
		type: "array",
		maxItems: 125,
		items: {
			type: "array",
			items: [Y(e.keyType._def, {
				...t,
				currentPath: [
					...t.currentPath,
					"items",
					"items",
					"0"
				]
			}) || zu(t), Y(e.valueType._def, {
				...t,
				currentPath: [
					...t.currentPath,
					"items",
					"items",
					"1"
				]
			}) || zu(t)],
			minItems: 2,
			maxItems: 2
		}
	};
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/nativeEnum.js
function ud(e) {
	let t = e.values, n = Object.keys(e.values).filter((e) => typeof t[t[e]] != "number").map((e) => t[e]), r = Array.from(new Set(n.map((e) => typeof e)));
	return {
		type: r.length === 1 ? r[0] === "string" ? "string" : "number" : ["string", "number"],
		enum: n
	};
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/never.js
function dd(e) {
	return e.target === "openAi" ? void 0 : { not: zu({
		...e,
		currentPath: [...e.currentPath, "not"]
	}) };
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/null.js
function fd(e) {
	return e.target === "openApi3" ? {
		enum: ["null"],
		nullable: !0
	} : { type: "null" };
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/union.js
var pd = {
	ZodString: "string",
	ZodNumber: "number",
	ZodBigInt: "integer",
	ZodBoolean: "boolean",
	ZodNull: "null"
};
function md(e, t) {
	if (t.target === "openApi3") return hd(e, t);
	let n = e.options instanceof Map ? Array.from(e.options.values()) : e.options;
	if (n.every((e) => e._def.typeName in pd && (!e._def.checks || !e._def.checks.length))) {
		let e = n.reduce((e, t) => {
			let n = pd[t._def.typeName];
			return n && !e.includes(n) ? [...e, n] : e;
		}, []);
		return { type: e.length > 1 ? e : e[0] };
	}
	if (n.every((e) => e._def.typeName === "ZodLiteral" && !e.description)) {
		let e = n.reduce((e, t) => {
			let n = typeof t._def.value;
			switch (n) {
				case "string":
				case "number":
				case "boolean": return [...e, n];
				case "bigint": return [...e, "integer"];
				case "object": if (t._def.value === null) return [...e, "null"];
				default: return e;
			}
		}, []);
		if (e.length === n.length) {
			let t = e.filter((e, t, n) => n.indexOf(e) === t);
			return {
				type: t.length > 1 ? t : t[0],
				enum: n.reduce((e, t) => e.includes(t._def.value) ? e : [...e, t._def.value], [])
			};
		}
	} else if (n.every((e) => e._def.typeName === "ZodEnum")) return {
		type: "string",
		enum: n.reduce((e, t) => [...e, ...t._def.values.filter((t) => !e.includes(t))], [])
	};
	return hd(e, t);
}
var hd = (e, t) => {
	let n = (e.options instanceof Map ? Array.from(e.options.values()) : e.options).map((e, n) => Y(e._def, {
		...t,
		currentPath: [
			...t.currentPath,
			"anyOf",
			`${n}`
		]
	})).filter((e) => !!e && (!t.strictUnions || typeof e == "object" && Object.keys(e).length > 0));
	return n.length ? { anyOf: n } : void 0;
};
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/nullable.js
function gd(e, t) {
	if ([
		"ZodString",
		"ZodNumber",
		"ZodBigInt",
		"ZodBoolean",
		"ZodNull"
	].includes(e.innerType._def.typeName) && (!e.innerType._def.checks || !e.innerType._def.checks.length)) return t.target === "openApi3" ? {
		type: pd[e.innerType._def.typeName],
		nullable: !0
	} : { type: [pd[e.innerType._def.typeName], "null"] };
	if (t.target === "openApi3") {
		let n = Y(e.innerType._def, {
			...t,
			currentPath: [...t.currentPath]
		});
		return n && "$ref" in n ? {
			allOf: [n],
			nullable: !0
		} : n && {
			...n,
			nullable: !0
		};
	}
	let n = Y(e.innerType._def, {
		...t,
		currentPath: [
			...t.currentPath,
			"anyOf",
			"0"
		]
	});
	return n && { anyOf: [n, { type: "null" }] };
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/number.js
function _d(e, t) {
	let n = { type: "number" };
	if (!e.checks) return n;
	for (let r of e.checks) switch (r.kind) {
		case "int":
			n.type = "integer", Lu(n, "type", r.message, t);
			break;
		case "min":
			t.target === "jsonSchema7" ? r.inclusive ? J(n, "minimum", r.value, r.message, t) : J(n, "exclusiveMinimum", r.value, r.message, t) : (r.inclusive || (n.exclusiveMinimum = !0), J(n, "minimum", r.value, r.message, t));
			break;
		case "max":
			t.target === "jsonSchema7" ? r.inclusive ? J(n, "maximum", r.value, r.message, t) : J(n, "exclusiveMaximum", r.value, r.message, t) : (r.inclusive || (n.exclusiveMaximum = !0), J(n, "maximum", r.value, r.message, t));
			break;
		case "multipleOf": J(n, "multipleOf", r.value, r.message, t);
	}
	return n;
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/object.js
function vd(e, t) {
	let n = t.target === "openAi", r = {
		type: "object",
		properties: {}
	}, i = [], a = e.shape();
	for (let e in a) {
		let o = a[e];
		if (o === void 0 || o._def === void 0) continue;
		let s = bd(o);
		s && n && (o._def.typeName === "ZodOptional" && (o = o._def.innerType), o.isNullable() || (o = o.nullable()), s = !1);
		let c = Y(o._def, {
			...t,
			currentPath: [
				...t.currentPath,
				"properties",
				e
			],
			propertyPath: [
				...t.currentPath,
				"properties",
				e
			]
		});
		c !== void 0 && (r.properties[e] = c, s || i.push(e));
	}
	i.length && (r.required = i);
	let o = yd(e, t);
	return o !== void 0 && (r.additionalProperties = o), r;
}
function yd(e, t) {
	if (e.catchall._def.typeName !== "ZodNever") return Y(e.catchall._def, {
		...t,
		currentPath: [...t.currentPath, "additionalProperties"]
	});
	switch (e.unknownKeys) {
		case "passthrough": return t.allowedAdditionalProperties;
		case "strict": return t.rejectedAdditionalProperties;
		case "strip": return t.removeAdditionalStrategy === "strict" ? t.allowedAdditionalProperties : t.rejectedAdditionalProperties;
	}
}
function bd(e) {
	try {
		return e.isOptional();
	} catch {
		return !0;
	}
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/optional.js
var xd = (e, t) => {
	if (t.currentPath.toString() === t.propertyPath?.toString()) return Y(e.innerType._def, t);
	let n = Y(e.innerType._def, {
		...t,
		currentPath: [
			...t.currentPath,
			"anyOf",
			"1"
		]
	});
	return n ? { anyOf: [{ not: zu(t) }, n] } : zu(t);
}, Sd = (e, t) => {
	if (t.pipeStrategy === "input") return Y(e.in._def, t);
	if (t.pipeStrategy === "output") return Y(e.out._def, t);
	let n = Y(e.in._def, {
		...t,
		currentPath: [
			...t.currentPath,
			"allOf",
			"0"
		]
	});
	return { allOf: [n, Y(e.out._def, {
		...t,
		currentPath: [
			...t.currentPath,
			"allOf",
			n ? "1" : "0"
		]
	})].filter((e) => e !== void 0) };
};
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/promise.js
function Cd(e, t) {
	return Y(e.type._def, t);
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/set.js
function wd(e, t) {
	let n = {
		type: "array",
		uniqueItems: !0,
		items: Y(e.valueType._def, {
			...t,
			currentPath: [...t.currentPath, "items"]
		})
	};
	return e.minSize && J(n, "minItems", e.minSize.value, e.minSize.message, t), e.maxSize && J(n, "maxItems", e.maxSize.value, e.maxSize.message, t), n;
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/tuple.js
function Td(e, t) {
	return e.rest ? {
		type: "array",
		minItems: e.items.length,
		items: e.items.map((e, n) => Y(e._def, {
			...t,
			currentPath: [
				...t.currentPath,
				"items",
				`${n}`
			]
		})).reduce((e, t) => t === void 0 ? e : [...e, t], []),
		additionalItems: Y(e.rest._def, {
			...t,
			currentPath: [...t.currentPath, "additionalItems"]
		})
	} : {
		type: "array",
		minItems: e.items.length,
		maxItems: e.items.length,
		items: e.items.map((e, n) => Y(e._def, {
			...t,
			currentPath: [
				...t.currentPath,
				"items",
				`${n}`
			]
		})).reduce((e, t) => t === void 0 ? e : [...e, t], [])
	};
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/undefined.js
function Ed(e) {
	return { not: zu(e) };
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/unknown.js
function Dd(e) {
	return zu(e);
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/readonly.js
var Od = (e, t) => Y(e.innerType._def, t), kd = (e, t, n) => {
	switch (t) {
		case M.ZodString: return td(e, n);
		case M.ZodNumber: return _d(e, n);
		case M.ZodObject: return vd(e, n);
		case M.ZodBigInt: return Vu(e, n);
		case M.ZodBoolean: return Hu();
		case M.ZodDate: return Gu(e, n);
		case M.ZodUndefined: return Ed(n);
		case M.ZodNull: return fd(n);
		case M.ZodArray: return Bu(e, n);
		case M.ZodUnion:
		case M.ZodDiscriminatedUnion: return md(e, n);
		case M.ZodIntersection: return Zu(e, n);
		case M.ZodTuple: return Td(e, n);
		case M.ZodRecord: return cd(e, n);
		case M.ZodLiteral: return Qu(e, n);
		case M.ZodEnum: return Yu(e);
		case M.ZodNativeEnum: return ud(e);
		case M.ZodNullable: return gd(e, n);
		case M.ZodOptional: return xd(e, n);
		case M.ZodMap: return ld(e, n);
		case M.ZodSet: return wd(e, n);
		case M.ZodLazy: return () => e.getter()._def;
		case M.ZodPromise: return Cd(e, n);
		case M.ZodNaN:
		case M.ZodNever: return dd(n);
		case M.ZodEffects: return Ju(e, n);
		case M.ZodAny: return zu(n);
		case M.ZodUnknown: return Dd(n);
		case M.ZodDefault: return qu(e, n);
		case M.ZodBranded: return Uu(e, n);
		case M.ZodReadonly: return Od(e, n);
		case M.ZodCatch: return Wu(e, n);
		case M.ZodPipeline: return Sd(e, n);
		case M.ZodFunction:
		case M.ZodVoid:
		case M.ZodSymbol: return;
		default: return ((e) => void 0)(t);
	}
};
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parseDef.js
function Y(e, t, n = !1) {
	let r = t.seen.get(e);
	if (t.override) {
		let i = t.override?.(e, t, r, n);
		if (i !== Nu) return i;
	}
	if (r && !n) {
		let e = Ad(r, t);
		if (e !== void 0) return e;
	}
	let i = {
		def: e,
		path: t.currentPath,
		jsonSchema: void 0
	};
	t.seen.set(e, i);
	let a = kd(e, e.typeName, t), o = typeof a == "function" ? Y(a(), t) : a;
	if (o && jd(e, t, o), t.postProcess) {
		let n = t.postProcess(o, e, t);
		return i.jsonSchema = o, n;
	}
	return i.jsonSchema = o, o;
}
var Ad = (e, t) => {
	switch (t.$refStrategy) {
		case "root": return { $ref: e.path.join("/") };
		case "relative": return { $ref: Ru(t.currentPath, e.path) };
		case "none":
		case "seen": return e.path.length < t.currentPath.length && e.path.every((e, n) => t.currentPath[n] === e) ? (console.warn(`Recursive reference detected at ${t.currentPath.join("/")}! Defaulting to any`), zu(t)) : t.$refStrategy === "seen" ? zu(t) : void 0;
	}
}, jd = (e, t, n) => (e.description && (n.description = e.description, t.markdownDescription && (n.markdownDescription = e.description)), n), Md = (e, t) => {
	let n = Iu(t), r = typeof t == "object" && t.definitions ? Object.entries(t.definitions).reduce((e, [t, r]) => ({
		...e,
		[t]: Y(r._def, {
			...n,
			currentPath: [
				...n.basePath,
				n.definitionPath,
				t
			]
		}, !0) ?? zu(n)
	}), {}) : void 0, i = typeof t == "string" ? t : t?.nameStrategy === "title" ? void 0 : t?.name, a = Y(e._def, i === void 0 ? n : {
		...n,
		currentPath: [
			...n.basePath,
			n.definitionPath,
			i
		]
	}, !1) ?? zu(n), o = typeof t == "object" && t.name !== void 0 && t.nameStrategy === "title" ? t.name : void 0;
	o !== void 0 && (a.title = o), n.flags.hasReferencedOpenAiAnyType && (r ||= {}, r[n.openAiAnyTypeName] || (r[n.openAiAnyTypeName] = {
		type: [
			"string",
			"number",
			"integer",
			"boolean",
			"array",
			"null"
		],
		items: { $ref: n.$refStrategy === "relative" ? "1" : [
			...n.basePath,
			n.definitionPath,
			n.openAiAnyTypeName
		].join("/") }
	}));
	let s = i === void 0 ? r ? {
		...a,
		[n.definitionPath]: r
	} : a : {
		$ref: [
			...n.$refStrategy === "relative" ? [] : n.basePath,
			n.definitionPath,
			i
		].join("/"),
		[n.definitionPath]: {
			...r,
			[i]: a
		}
	};
	return n.target === "jsonSchema7" ? s.$schema = "http://json-schema.org/draft-07/schema#" : (n.target === "jsonSchema2019-09" || n.target === "openAi") && (s.$schema = "https://json-schema.org/draft/2019-09/schema#"), n.target === "openAi" && ("anyOf" in s || "oneOf" in s || "allOf" in s || "type" in s && Array.isArray(s.type)) && console.warn("Warning: OpenAI may not support schemas with unions as roots! Try wrapping it in an object property."), s;
};
//#endregion
//#region node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-json-schema-compat.js
function Nd(e) {
	return !e || e === "jsonSchema7" || e === "draft-7" ? "draft-7" : e === "jsonSchema2019-09" || e === "draft-2020-12" ? "draft-2020-12" : "draft-7";
}
function Pd(e, t) {
	return co(e) ? ro(e, {
		target: Nd(t?.target),
		io: t?.pipeStrategy ?? "input"
	}) : Md(e, {
		strictUnions: t?.strictUnions ?? !0,
		pipeStrategy: t?.pipeStrategy ?? "input"
	});
}
function Fd(e) {
	let t = po(e)?.method;
	if (!t) throw Error("Schema is missing a method literal");
	let n = yo(t);
	if (typeof n != "string") throw Error("Schema method literal must be a string");
	return n;
}
function Id(e, t) {
	let n = uo(e, t);
	if (!n.success) throw n.error;
	return n.data;
}
var Ld = class {
	constructor(e) {
		this._options = e, this._requestMessageId = 0, this._requestHandlers = /* @__PURE__ */ new Map(), this._requestHandlerAbortControllers = /* @__PURE__ */ new Map(), this._notificationHandlers = /* @__PURE__ */ new Map(), this._responseHandlers = /* @__PURE__ */ new Map(), this._progressHandlers = /* @__PURE__ */ new Map(), this._timeoutInfo = /* @__PURE__ */ new Map(), this._pendingDebouncedNotifications = /* @__PURE__ */ new Set(), this._taskProgressTokens = /* @__PURE__ */ new Map(), this._requestResolvers = /* @__PURE__ */ new Map(), this.setNotificationHandler(Cc, (e) => {
			this._oncancel(e);
		}), this.setNotificationHandler(zc, (e) => {
			this._onprogress(e);
		}), this.setRequestHandler(Ic, (e) => ({})), this._taskStore = e?.taskStore, this._taskMessageQueue = e?.taskMessageQueue, this._taskStore && (this.setRequestHandler(Jc, async (e, t) => {
			let n = await this._taskStore.getTask(e.params.taskId, t.sessionId);
			if (!n) throw new q(K.InvalidParams, "Failed to retrieve task: Task not found");
			return { ...n };
		}), this.setRequestHandler(Xc, async (e, t) => {
			let n = async () => {
				let r = e.params.taskId;
				if (this._taskMessageQueue) {
					let e;
					for (; e = await this._taskMessageQueue.dequeue(r, t.sessionId);) {
						if (e.type === "response" || e.type === "error") {
							let t = e.message, n = t.id, r = this._requestResolvers.get(n);
							if (r) {
								if (this._requestResolvers.delete(n), e.type === "response") r(t);
								else {
									let e = t;
									r(new q(e.error.code, e.error.message, e.error.data));
								}
							} else {
								let t = e.type === "response" ? "Response" : "Error";
								this._onerror(/* @__PURE__ */ Error(`${t} handler missing for request ${n}`));
							}
							continue;
						}
						await this._transport?.send(e.message, { relatedRequestId: t.requestId });
					}
				}
				let i = await this._taskStore.getTask(r, t.sessionId);
				if (!i) throw new q(K.InvalidParams, `Task not found: ${r}`);
				if (!Mu(i.status)) return await this._waitForTaskUpdate(r, t.signal), await n();
				if (Mu(i.status)) {
					let e = await this._taskStore.getTaskResult(r, t.sessionId);
					return this._clearTaskQueue(r), {
						...e,
						_meta: {
							...e._meta,
							[Zs]: { taskId: r }
						}
					};
				}
				return await n();
			};
			return await n();
		}), this.setRequestHandler(Zc, async (e, t) => {
			try {
				let { tasks: n, nextCursor: r } = await this._taskStore.listTasks(e.params?.cursor, t.sessionId);
				return {
					tasks: n,
					nextCursor: r,
					_meta: {}
				};
			} catch (e) {
				throw new q(K.InvalidParams, `Failed to list tasks: ${e instanceof Error ? e.message : String(e)}`);
			}
		}), this.setRequestHandler($c, async (e, t) => {
			try {
				let n = await this._taskStore.getTask(e.params.taskId, t.sessionId);
				if (!n) throw new q(K.InvalidParams, `Task not found: ${e.params.taskId}`);
				if (Mu(n.status)) throw new q(K.InvalidParams, `Cannot cancel task in terminal status: ${n.status}`);
				await this._taskStore.updateTaskStatus(e.params.taskId, "cancelled", "Client cancelled task execution.", t.sessionId), this._clearTaskQueue(e.params.taskId);
				let r = await this._taskStore.getTask(e.params.taskId, t.sessionId);
				if (!r) throw new q(K.InvalidParams, `Task not found after cancellation: ${e.params.taskId}`);
				return {
					_meta: {},
					...r
				};
			} catch (e) {
				throw e instanceof q ? e : new q(K.InvalidRequest, `Failed to cancel task: ${e instanceof Error ? e.message : String(e)}`);
			}
		}));
	}
	async _oncancel(e) {
		e.params.requestId && this._requestHandlerAbortControllers.get(e.params.requestId)?.abort(e.params.reason);
	}
	_setupTimeout(e, t, n, r, i = !1) {
		this._timeoutInfo.set(e, {
			timeoutId: setTimeout(r, t),
			startTime: Date.now(),
			timeout: t,
			maxTotalTimeout: n,
			resetTimeoutOnProgress: i,
			onTimeout: r
		});
	}
	_resetTimeout(e) {
		let t = this._timeoutInfo.get(e);
		if (!t) return !1;
		let n = Date.now() - t.startTime;
		if (t.maxTotalTimeout && n >= t.maxTotalTimeout) throw this._timeoutInfo.delete(e), q.fromError(K.RequestTimeout, "Maximum total timeout exceeded", {
			maxTotalTimeout: t.maxTotalTimeout,
			totalElapsed: n
		});
		return clearTimeout(t.timeoutId), t.timeoutId = setTimeout(t.onTimeout, t.timeout), !0;
	}
	_cleanupTimeout(e) {
		let t = this._timeoutInfo.get(e);
		t && (clearTimeout(t.timeoutId), this._timeoutInfo.delete(e));
	}
	async connect(e) {
		if (this._transport) throw Error("Already connected to a transport. Call close() before connecting to a new transport, or use a separate Protocol instance per connection.");
		this._transport = e;
		let t = this.transport?.onclose;
		this._transport.onclose = () => {
			t?.(), this._onclose();
		};
		let n = this.transport?.onerror;
		this._transport.onerror = (e) => {
			n?.(e), this._onerror(e);
		};
		let r = this._transport?.onmessage;
		this._transport.onmessage = (e, t) => {
			r?.(e, t), _c(e) || yc(e) ? this._onresponse(e) : pc(e) ? this._onrequest(e, t) : hc(e) ? this._onnotification(e) : this._onerror(/* @__PURE__ */ Error(`Unknown message type: ${JSON.stringify(e)}`));
		}, await this._transport.start();
	}
	_onclose() {
		let e = this._responseHandlers;
		this._responseHandlers = /* @__PURE__ */ new Map(), this._progressHandlers.clear(), this._taskProgressTokens.clear(), this._pendingDebouncedNotifications.clear();
		for (let e of this._timeoutInfo.values()) clearTimeout(e.timeoutId);
		this._timeoutInfo.clear();
		for (let e of this._requestHandlerAbortControllers.values()) e.abort();
		this._requestHandlerAbortControllers.clear();
		let t = q.fromError(K.ConnectionClosed, "Connection closed");
		this._transport = void 0, this.onclose?.();
		for (let n of e.values()) n(t);
	}
	_onerror(e) {
		this.onerror?.(e);
	}
	_onnotification(e) {
		let t = this._notificationHandlers.get(e.method) ?? this.fallbackNotificationHandler;
		t !== void 0 && Promise.resolve().then(() => t(e)).catch((e) => this._onerror(/* @__PURE__ */ Error(`Uncaught error in notification handler: ${e}`)));
	}
	_onrequest(e, t) {
		let n = this._requestHandlers.get(e.method) ?? this.fallbackRequestHandler, r = this._transport, i = e.params?._meta?.[Zs]?.taskId;
		if (n === void 0) {
			let t = {
				jsonrpc: "2.0",
				id: e.id,
				error: {
					code: K.MethodNotFound,
					message: "Method not found"
				}
			};
			i && this._taskMessageQueue ? this._enqueueTaskMessage(i, {
				type: "error",
				message: t,
				timestamp: Date.now()
			}, r?.sessionId).catch((e) => this._onerror(/* @__PURE__ */ Error(`Failed to enqueue error response: ${e}`))) : r?.send(t).catch((e) => this._onerror(/* @__PURE__ */ Error(`Failed to send an error response: ${e}`)));
			return;
		}
		let a = new AbortController();
		this._requestHandlerAbortControllers.set(e.id, a);
		let o = oc(e.params) ? e.params.task : void 0, s = this._taskStore ? this.requestTaskStore(e, r?.sessionId) : void 0, c = {
			signal: a.signal,
			sessionId: r?.sessionId,
			_meta: e.params?._meta,
			sendNotification: async (t) => {
				if (a.signal.aborted) return;
				let n = { relatedRequestId: e.id };
				i && (n.relatedTask = { taskId: i }), await this.notification(t, n);
			},
			sendRequest: async (t, n, r) => {
				if (a.signal.aborted) throw new q(K.ConnectionClosed, "Request was cancelled");
				let o = {
					...r,
					relatedRequestId: e.id
				};
				i && !o.relatedTask && (o.relatedTask = { taskId: i });
				let c = o.relatedTask?.taskId ?? i;
				return c && s && await s.updateTaskStatus(c, "input_required"), await this.request(t, n, o);
			},
			authInfo: t?.authInfo,
			requestId: e.id,
			requestInfo: t?.requestInfo,
			taskId: i,
			taskStore: s,
			taskRequestedTtl: o?.ttl,
			closeSSEStream: t?.closeSSEStream,
			closeStandaloneSSEStream: t?.closeStandaloneSSEStream
		};
		Promise.resolve().then(() => {
			o && this.assertTaskHandlerCapability(e.method);
		}).then(() => n(e, c)).then(async (t) => {
			if (a.signal.aborted) return;
			let n = {
				result: t,
				jsonrpc: "2.0",
				id: e.id
			};
			i && this._taskMessageQueue ? await this._enqueueTaskMessage(i, {
				type: "response",
				message: n,
				timestamp: Date.now()
			}, r?.sessionId) : await r?.send(n);
		}, async (t) => {
			if (a.signal.aborted) return;
			let n = {
				jsonrpc: "2.0",
				id: e.id,
				error: {
					code: Number.isSafeInteger(t.code) ? t.code : K.InternalError,
					message: t.message ?? "Internal error",
					...t.data !== void 0 && { data: t.data }
				}
			};
			i && this._taskMessageQueue ? await this._enqueueTaskMessage(i, {
				type: "error",
				message: n,
				timestamp: Date.now()
			}, r?.sessionId) : await r?.send(n);
		}).catch((e) => this._onerror(/* @__PURE__ */ Error(`Failed to send response: ${e}`))).finally(() => {
			this._requestHandlerAbortControllers.get(e.id) === a && this._requestHandlerAbortControllers.delete(e.id);
		});
	}
	_onprogress(e) {
		let { progressToken: t, ...n } = e.params, r = Number(t), i = this._progressHandlers.get(r);
		if (!i) {
			this._onerror(/* @__PURE__ */ Error(`Received a progress notification for an unknown token: ${JSON.stringify(e)}`));
			return;
		}
		let a = this._responseHandlers.get(r), o = this._timeoutInfo.get(r);
		if (o && a && o.resetTimeoutOnProgress) try {
			this._resetTimeout(r);
		} catch (e) {
			this._responseHandlers.delete(r), this._progressHandlers.delete(r), this._cleanupTimeout(r), a(e);
			return;
		}
		i(n);
	}
	_onresponse(e) {
		let t = Number(e.id), n = this._requestResolvers.get(t);
		if (n) {
			this._requestResolvers.delete(t), _c(e) ? n(e) : n(new q(e.error.code, e.error.message, e.error.data));
			return;
		}
		let r = this._responseHandlers.get(t);
		if (r === void 0) {
			this._onerror(/* @__PURE__ */ Error(`Received a response for an unknown message ID: ${JSON.stringify(e)}`));
			return;
		}
		this._responseHandlers.delete(t), this._cleanupTimeout(t);
		let i = !1;
		if (_c(e) && e.result && typeof e.result == "object") {
			let n = e.result;
			if (n.task && typeof n.task == "object") {
				let e = n.task;
				typeof e.taskId == "string" && (i = !0, this._taskProgressTokens.set(e.taskId, t));
			}
		}
		i || this._progressHandlers.delete(t), _c(e) ? r(e) : r(q.fromError(e.error.code, e.error.message, e.error.data));
	}
	get transport() {
		return this._transport;
	}
	async close() {
		await this._transport?.close();
	}
	async *requestStream(e, t, n) {
		let { task: r } = n ?? {};
		if (!r) {
			try {
				yield {
					type: "result",
					result: await this.request(e, t, n)
				};
			} catch (e) {
				yield {
					type: "error",
					error: e instanceof q ? e : new q(K.InternalError, String(e))
				};
			}
			return;
		}
		let i;
		try {
			let r = await this.request(e, Gc, n);
			if (r.task) i = r.task.taskId, yield {
				type: "taskCreated",
				task: r.task
			};
			else throw new q(K.InternalError, "Task creation did not return a task");
			for (;;) {
				let e = await this.getTask({ taskId: i }, n);
				if (yield {
					type: "taskStatus",
					task: e
				}, Mu(e.status)) {
					e.status === "completed" ? yield {
						type: "result",
						result: await this.getTaskResult({ taskId: i }, t, n)
					} : e.status === "failed" ? yield {
						type: "error",
						error: new q(K.InternalError, `Task ${i} failed`)
					} : e.status === "cancelled" && (yield {
						type: "error",
						error: new q(K.InternalError, `Task ${i} was cancelled`)
					});
					return;
				}
				if (e.status === "input_required") {
					yield {
						type: "result",
						result: await this.getTaskResult({ taskId: i }, t, n)
					};
					return;
				}
				let r = e.pollInterval ?? this._options?.defaultTaskPollInterval ?? 1e3;
				await new Promise((e) => setTimeout(e, r)), n?.signal?.throwIfAborted();
			}
		} catch (e) {
			yield {
				type: "error",
				error: e instanceof q ? e : new q(K.InternalError, String(e))
			};
		}
	}
	request(e, t, n) {
		let { relatedRequestId: r, resumptionToken: i, onresumptiontoken: a, task: o, relatedTask: s } = n ?? {};
		return new Promise((c, l) => {
			let u = (e) => {
				l(e);
			};
			if (!this._transport) {
				u(/* @__PURE__ */ Error("Not connected"));
				return;
			}
			if (this._options?.enforceStrictCapabilities === !0) try {
				this.assertCapabilityForMethod(e.method), o && this.assertTaskCapability(e.method);
			} catch (e) {
				u(e);
				return;
			}
			n?.signal?.throwIfAborted();
			let d = this._requestMessageId++, f = {
				...e,
				jsonrpc: "2.0",
				id: d
			};
			n?.onprogress && (this._progressHandlers.set(d, n.onprogress), f.params = {
				...e.params,
				_meta: {
					...e.params?._meta || {},
					progressToken: d
				}
			}), o && (f.params = {
				...f.params,
				task: o
			}), s && (f.params = {
				...f.params,
				_meta: {
					...f.params?._meta || {},
					[Zs]: s
				}
			});
			let p = (e) => {
				this._responseHandlers.delete(d), this._progressHandlers.delete(d), this._cleanupTimeout(d), this._transport?.send({
					jsonrpc: "2.0",
					method: "notifications/cancelled",
					params: {
						requestId: d,
						reason: String(e)
					}
				}, {
					relatedRequestId: r,
					resumptionToken: i,
					onresumptiontoken: a
				}).catch((e) => this._onerror(/* @__PURE__ */ Error(`Failed to send cancellation: ${e}`))), l(e instanceof q ? e : new q(K.RequestTimeout, String(e)));
			};
			this._responseHandlers.set(d, (e) => {
				if (!n?.signal?.aborted) {
					if (e instanceof Error) return l(e);
					try {
						let n = uo(t, e.result);
						n.success ? c(n.data) : l(n.error);
					} catch (e) {
						l(e);
					}
				}
			}), n?.signal?.addEventListener("abort", () => {
				p(n?.signal?.reason);
			});
			let m = n?.timeout ?? 6e4;
			this._setupTimeout(d, m, n?.maxTotalTimeout, () => p(q.fromError(K.RequestTimeout, "Request timed out", { timeout: m })), n?.resetTimeoutOnProgress ?? !1);
			let h = s?.taskId;
			h ? (this._requestResolvers.set(d, (e) => {
				let t = this._responseHandlers.get(d);
				t ? t(e) : this._onerror(/* @__PURE__ */ Error(`Response handler missing for side-channeled request ${d}`));
			}), this._enqueueTaskMessage(h, {
				type: "request",
				message: f,
				timestamp: Date.now()
			}).catch((e) => {
				this._cleanupTimeout(d), l(e);
			})) : this._transport.send(f, {
				relatedRequestId: r,
				resumptionToken: i,
				onresumptiontoken: a
			}).catch((e) => {
				this._cleanupTimeout(d), l(e);
			});
		});
	}
	async getTask(e, t) {
		return this.request({
			method: "tasks/get",
			params: e
		}, Yc, t);
	}
	async getTaskResult(e, t, n) {
		return this.request({
			method: "tasks/result",
			params: e
		}, t, n);
	}
	async listTasks(e, t) {
		return this.request({
			method: "tasks/list",
			params: e
		}, Qc, t);
	}
	async cancelTask(e, t) {
		return this.request({
			method: "tasks/cancel",
			params: e
		}, el, t);
	}
	async notification(e, t) {
		if (!this._transport) throw Error("Not connected");
		this.assertNotificationCapability(e.method);
		let n = t?.relatedTask?.taskId;
		if (n) {
			let r = {
				...e,
				jsonrpc: "2.0",
				params: {
					...e.params,
					_meta: {
						...e.params?._meta || {},
						[Zs]: t.relatedTask
					}
				}
			};
			await this._enqueueTaskMessage(n, {
				type: "notification",
				message: r,
				timestamp: Date.now()
			});
			return;
		}
		if ((this._options?.debouncedNotificationMethods ?? []).includes(e.method) && !e.params && !t?.relatedRequestId && !t?.relatedTask) {
			if (this._pendingDebouncedNotifications.has(e.method)) return;
			this._pendingDebouncedNotifications.add(e.method), Promise.resolve().then(() => {
				if (this._pendingDebouncedNotifications.delete(e.method), !this._transport) return;
				let n = {
					...e,
					jsonrpc: "2.0"
				};
				t?.relatedTask && (n = {
					...n,
					params: {
						...n.params,
						_meta: {
							...n.params?._meta || {},
							[Zs]: t.relatedTask
						}
					}
				}), this._transport?.send(n, t).catch((e) => this._onerror(e));
			});
			return;
		}
		let r = {
			...e,
			jsonrpc: "2.0"
		};
		t?.relatedTask && (r = {
			...r,
			params: {
				...r.params,
				_meta: {
					...r.params?._meta || {},
					[Zs]: t.relatedTask
				}
			}
		}), await this._transport.send(r, t);
	}
	setRequestHandler(e, t) {
		let n = Fd(e);
		this.assertRequestHandlerCapability(n), this._requestHandlers.set(n, (n, r) => {
			let i = Id(e, n);
			return Promise.resolve(t(i, r));
		});
	}
	removeRequestHandler(e) {
		this._requestHandlers.delete(e);
	}
	assertCanSetRequestHandler(e) {
		if (this._requestHandlers.has(e)) throw Error(`A request handler for ${e} already exists, which would be overridden`);
	}
	setNotificationHandler(e, t) {
		let n = Fd(e);
		this._notificationHandlers.set(n, (n) => {
			let r = Id(e, n);
			return Promise.resolve(t(r));
		});
	}
	removeNotificationHandler(e) {
		this._notificationHandlers.delete(e);
	}
	_cleanupTaskProgressHandler(e) {
		let t = this._taskProgressTokens.get(e);
		t !== void 0 && (this._progressHandlers.delete(t), this._taskProgressTokens.delete(e));
	}
	async _enqueueTaskMessage(e, t, n) {
		if (!this._taskStore || !this._taskMessageQueue) throw Error("Cannot enqueue task message: taskStore and taskMessageQueue are not configured");
		let r = this._options?.maxTaskQueueSize;
		await this._taskMessageQueue.enqueue(e, t, n, r);
	}
	async _clearTaskQueue(e, t) {
		if (this._taskMessageQueue) {
			let n = await this._taskMessageQueue.dequeueAll(e, t);
			for (let t of n) if (t.type === "request" && pc(t.message)) {
				let n = t.message.id, r = this._requestResolvers.get(n);
				r ? (r(new q(K.InternalError, "Task cancelled or completed")), this._requestResolvers.delete(n)) : this._onerror(/* @__PURE__ */ Error(`Resolver missing for request ${n} during task ${e} cleanup`));
			}
		}
	}
	async _waitForTaskUpdate(e, t) {
		let n = this._options?.defaultTaskPollInterval ?? 1e3;
		try {
			let t = await this._taskStore?.getTask(e);
			t?.pollInterval && (n = t.pollInterval);
		} catch {}
		return new Promise((e, r) => {
			if (t.aborted) {
				r(new q(K.InvalidRequest, "Request cancelled"));
				return;
			}
			let i = setTimeout(e, n);
			t.addEventListener("abort", () => {
				clearTimeout(i), r(new q(K.InvalidRequest, "Request cancelled"));
			}, { once: !0 });
		});
	}
	requestTaskStore(e, t) {
		let n = this._taskStore;
		if (!n) throw Error("No task store configured");
		return {
			createTask: async (r) => {
				if (!e) throw Error("No request provided");
				return await n.createTask(r, e.id, {
					method: e.method,
					params: e.params
				}, t);
			},
			getTask: async (e) => {
				let r = await n.getTask(e, t);
				if (!r) throw new q(K.InvalidParams, "Failed to retrieve task: Task not found");
				return r;
			},
			storeTaskResult: async (e, r, i) => {
				await n.storeTaskResult(e, r, i, t);
				let a = await n.getTask(e, t);
				if (a) {
					let t = qc.parse({
						method: "notifications/tasks/status",
						params: a
					});
					await this.notification(t), Mu(a.status) && this._cleanupTaskProgressHandler(e);
				}
			},
			getTaskResult: (e) => n.getTaskResult(e, t),
			updateTaskStatus: async (e, r, i) => {
				let a = await n.getTask(e, t);
				if (!a) throw new q(K.InvalidParams, `Task "${e}" not found - it may have been cleaned up`);
				if (Mu(a.status)) throw new q(K.InvalidParams, `Cannot update task "${e}" from terminal status "${a.status}" to "${r}". Terminal states (completed, failed, cancelled) cannot transition to other states.`);
				await n.updateTaskStatus(e, r, i, t);
				let o = await n.getTask(e, t);
				if (o) {
					let t = qc.parse({
						method: "notifications/tasks/status",
						params: o
					});
					await this.notification(t), Mu(o.status) && this._cleanupTaskProgressHandler(e);
				}
			},
			listTasks: (e) => n.listTasks(e, t)
		};
	}
};
function Rd(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
function zd(e, t) {
	let n = { ...e };
	for (let e in t) {
		let r = e, i = t[r];
		if (i === void 0) continue;
		let a = n[r];
		n[r] = Rd(a) && Rd(i) ? {
			...a,
			...i
		} : i;
	}
	return n;
}
//#endregion
//#region node_modules/ajv/dist/compile/codegen/code.js
var Bd = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.regexpCode = e.getEsmExportName = e.getProperty = e.safeStringify = e.stringify = e.strConcat = e.addCodeArg = e.str = e._ = e.nil = e._Code = e.Name = e.IDENTIFIER = e._CodeOrName = void 0;
	var t = class {};
	e._CodeOrName = t, e.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
	var n = class extends t {
		constructor(t) {
			if (super(), !e.IDENTIFIER.test(t)) throw Error("CodeGen: name must be a valid identifier");
			this.str = t;
		}
		toString() {
			return this.str;
		}
		emptyStr() {
			return !1;
		}
		get names() {
			return { [this.str]: 1 };
		}
	};
	e.Name = n;
	var r = class extends t {
		constructor(e) {
			super(), this._items = typeof e == "string" ? [e] : e;
		}
		toString() {
			return this.str;
		}
		emptyStr() {
			if (this._items.length > 1) return !1;
			let e = this._items[0];
			return e === "" || e === "\"\"";
		}
		get str() {
			return this._str ??= this._items.reduce((e, t) => `${e}${t}`, "");
		}
		get names() {
			return this._names ??= this._items.reduce((e, t) => (t instanceof n && (e[t.str] = (e[t.str] || 0) + 1), e), {});
		}
	};
	e._Code = r, e.nil = new r("");
	function i(e, ...t) {
		let n = [e[0]], i = 0;
		for (; i < t.length;) s(n, t[i]), n.push(e[++i]);
		return new r(n);
	}
	e._ = i;
	var a = new r("+");
	function o(e, ...t) {
		let n = [p(e[0])], i = 0;
		for (; i < t.length;) n.push(a), s(n, t[i]), n.push(a, p(e[++i]));
		return c(n), new r(n);
	}
	e.str = o;
	function s(e, t) {
		t instanceof r ? e.push(...t._items) : t instanceof n ? e.push(t) : e.push(d(t));
	}
	e.addCodeArg = s;
	function c(e) {
		let t = 1;
		for (; t < e.length - 1;) {
			if (e[t] === a) {
				let n = l(e[t - 1], e[t + 1]);
				if (n !== void 0) {
					e.splice(t - 1, 3, n);
					continue;
				}
				e[t++] = "+";
			}
			t++;
		}
	}
	function l(e, t) {
		if (t === "\"\"") return e;
		if (e === "\"\"") return t;
		if (typeof e == "string") return t instanceof n || e[e.length - 1] !== "\"" ? void 0 : typeof t == "string" ? t[0] === "\"" ? e.slice(0, -1) + t.slice(1) : void 0 : `${e.slice(0, -1)}${t}"`;
		if (typeof t == "string" && t[0] === "\"" && !(e instanceof n)) return `"${e}${t.slice(1)}`;
	}
	function u(e, t) {
		return t.emptyStr() ? e : e.emptyStr() ? t : o`${e}${t}`;
	}
	e.strConcat = u;
	function d(e) {
		return typeof e == "number" || typeof e == "boolean" || e === null ? e : p(Array.isArray(e) ? e.join(",") : e);
	}
	function f(e) {
		return new r(p(e));
	}
	e.stringify = f;
	function p(e) {
		return JSON.stringify(e).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
	}
	e.safeStringify = p;
	function m(t) {
		return typeof t == "string" && e.IDENTIFIER.test(t) ? new r(`.${t}`) : i`[${t}]`;
	}
	e.getProperty = m;
	function h(t) {
		if (typeof t == "string" && e.IDENTIFIER.test(t)) return new r(`${t}`);
		throw Error(`CodeGen: invalid export name: ${t}, use explicit $id name mapping`);
	}
	e.getEsmExportName = h;
	function g(e) {
		return new r(e.toString());
	}
	e.regexpCode = g;
})), Vd = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.ValueScope = e.ValueScopeName = e.Scope = e.varKinds = e.UsedValueState = void 0;
	var t = Bd(), n = class extends Error {
		constructor(e) {
			super(`CodeGen: "code" for ${e} not defined`), this.value = e.value;
		}
	}, r;
	(function(e) {
		e[e.Started = 0] = "Started", e[e.Completed = 1] = "Completed";
	})(r || (e.UsedValueState = r = {})), e.varKinds = {
		const: new t.Name("const"),
		let: new t.Name("let"),
		var: new t.Name("var")
	};
	var i = class {
		constructor({ prefixes: e, parent: t } = {}) {
			this._names = {}, this._prefixes = e, this._parent = t;
		}
		toName(e) {
			return e instanceof t.Name ? e : this.name(e);
		}
		name(e) {
			return new t.Name(this._newName(e));
		}
		_newName(e) {
			let t = this._names[e] || this._nameGroup(e);
			return `${e}${t.index++}`;
		}
		_nameGroup(e) {
			if ((this._parent?._prefixes)?.has(e) || this._prefixes && !this._prefixes.has(e)) throw Error(`CodeGen: prefix "${e}" is not allowed in this scope`);
			return this._names[e] = {
				prefix: e,
				index: 0
			};
		}
	};
	e.Scope = i;
	var a = class extends t.Name {
		constructor(e, t) {
			super(t), this.prefix = e;
		}
		setValue(e, { property: n, itemIndex: r }) {
			this.value = e, this.scopePath = (0, t._)`.${new t.Name(n)}[${r}]`;
		}
	};
	e.ValueScopeName = a;
	var o = (0, t._)`\n`;
	e.ValueScope = class extends i {
		constructor(e) {
			super(e), this._values = {}, this._scope = e.scope, this.opts = {
				...e,
				_n: e.lines ? o : t.nil
			};
		}
		get() {
			return this._scope;
		}
		name(e) {
			return new a(e, this._newName(e));
		}
		value(e, t) {
			if (t.ref === void 0) throw Error("CodeGen: ref must be passed in value");
			let n = this.toName(e), { prefix: r } = n, i = t.key ?? t.ref, a = this._values[r];
			if (a) {
				let e = a.get(i);
				if (e) return e;
			} else a = this._values[r] = /* @__PURE__ */ new Map();
			a.set(i, n);
			let o = this._scope[r] || (this._scope[r] = []), s = o.length;
			return o[s] = t.ref, n.setValue(t, {
				property: r,
				itemIndex: s
			}), n;
		}
		getValue(e, t) {
			let n = this._values[e];
			if (n) return n.get(t);
		}
		scopeRefs(e, n = this._values) {
			return this._reduceValues(n, (n) => {
				if (n.scopePath === void 0) throw Error(`CodeGen: name "${n}" has no value`);
				return (0, t._)`${e}${n.scopePath}`;
			});
		}
		scopeCode(e = this._values, t, n) {
			return this._reduceValues(e, (e) => {
				if (e.value === void 0) throw Error(`CodeGen: name "${e}" has no value`);
				return e.value.code;
			}, t, n);
		}
		_reduceValues(i, a, o = {}, s) {
			let c = t.nil;
			for (let l in i) {
				let u = i[l];
				if (!u) continue;
				let d = o[l] = o[l] || /* @__PURE__ */ new Map();
				u.forEach((i) => {
					if (d.has(i)) return;
					d.set(i, r.Started);
					let o = a(i);
					if (o) {
						let n = this.opts.es5 ? e.varKinds.var : e.varKinds.const;
						c = (0, t._)`${c}${n} ${i} = ${o};${this.opts._n}`;
					} else if (o = s?.(i)) c = (0, t._)`${c}${o}${this.opts._n}`;
					else throw new n(i);
					d.set(i, r.Completed);
				});
			}
			return c;
		}
	};
})), X = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.or = e.and = e.not = e.CodeGen = e.operators = e.varKinds = e.ValueScopeName = e.ValueScope = e.Scope = e.Name = e.regexpCode = e.stringify = e.getProperty = e.nil = e.strConcat = e.str = e._ = void 0;
	var t = Bd(), n = Vd(), r = Bd();
	Object.defineProperty(e, "_", {
		enumerable: !0,
		get: function() {
			return r._;
		}
	}), Object.defineProperty(e, "str", {
		enumerable: !0,
		get: function() {
			return r.str;
		}
	}), Object.defineProperty(e, "strConcat", {
		enumerable: !0,
		get: function() {
			return r.strConcat;
		}
	}), Object.defineProperty(e, "nil", {
		enumerable: !0,
		get: function() {
			return r.nil;
		}
	}), Object.defineProperty(e, "getProperty", {
		enumerable: !0,
		get: function() {
			return r.getProperty;
		}
	}), Object.defineProperty(e, "stringify", {
		enumerable: !0,
		get: function() {
			return r.stringify;
		}
	}), Object.defineProperty(e, "regexpCode", {
		enumerable: !0,
		get: function() {
			return r.regexpCode;
		}
	}), Object.defineProperty(e, "Name", {
		enumerable: !0,
		get: function() {
			return r.Name;
		}
	});
	var i = Vd();
	Object.defineProperty(e, "Scope", {
		enumerable: !0,
		get: function() {
			return i.Scope;
		}
	}), Object.defineProperty(e, "ValueScope", {
		enumerable: !0,
		get: function() {
			return i.ValueScope;
		}
	}), Object.defineProperty(e, "ValueScopeName", {
		enumerable: !0,
		get: function() {
			return i.ValueScopeName;
		}
	}), Object.defineProperty(e, "varKinds", {
		enumerable: !0,
		get: function() {
			return i.varKinds;
		}
	}), e.operators = {
		GT: new t._Code(">"),
		GTE: new t._Code(">="),
		LT: new t._Code("<"),
		LTE: new t._Code("<="),
		EQ: new t._Code("==="),
		NEQ: new t._Code("!=="),
		NOT: new t._Code("!"),
		OR: new t._Code("||"),
		AND: new t._Code("&&"),
		ADD: new t._Code("+")
	};
	var a = class {
		optimizeNodes() {
			return this;
		}
		optimizeNames(e, t) {
			return this;
		}
	}, o = class extends a {
		constructor(e, t, n) {
			super(), this.varKind = e, this.name = t, this.rhs = n;
		}
		render({ es5: e, _n: t }) {
			let r = e ? n.varKinds.var : this.varKind, i = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
			return `${r} ${this.name}${i};` + t;
		}
		optimizeNames(e, t) {
			if (e[this.name.str]) return this.rhs &&= ae(this.rhs, e, t), this;
		}
		get names() {
			return this.rhs instanceof t._CodeOrName ? this.rhs.names : {};
		}
	}, s = class extends a {
		constructor(e, t, n) {
			super(), this.lhs = e, this.rhs = t, this.sideEffects = n;
		}
		render({ _n: e }) {
			return `${this.lhs} = ${this.rhs};` + e;
		}
		optimizeNames(e, n) {
			if (!(this.lhs instanceof t.Name && !e[this.lhs.str] && !this.sideEffects)) return this.rhs = ae(this.rhs, e, n), this;
		}
		get names() {
			return ie(this.lhs instanceof t.Name ? {} : { ...this.lhs.names }, this.rhs);
		}
	}, c = class extends s {
		constructor(e, t, n, r) {
			super(e, n, r), this.op = t;
		}
		render({ _n: e }) {
			return `${this.lhs} ${this.op}= ${this.rhs};` + e;
		}
	}, l = class extends a {
		constructor(e) {
			super(), this.label = e, this.names = {};
		}
		render({ _n: e }) {
			return `${this.label}:` + e;
		}
	}, u = class extends a {
		constructor(e) {
			super(), this.label = e, this.names = {};
		}
		render({ _n: e }) {
			return `break${this.label ? ` ${this.label}` : ""};` + e;
		}
	}, d = class extends a {
		constructor(e) {
			super(), this.error = e;
		}
		render({ _n: e }) {
			return `throw ${this.error};` + e;
		}
		get names() {
			return this.error.names;
		}
	}, f = class extends a {
		constructor(e) {
			super(), this.code = e;
		}
		render({ _n: e }) {
			return `${this.code};` + e;
		}
		optimizeNodes() {
			return `${this.code}` ? this : void 0;
		}
		optimizeNames(e, t) {
			return this.code = ae(this.code, e, t), this;
		}
		get names() {
			return this.code instanceof t._CodeOrName ? this.code.names : {};
		}
	}, p = class extends a {
		constructor(e = []) {
			super(), this.nodes = e;
		}
		render(e) {
			return this.nodes.reduce((t, n) => t + n.render(e), "");
		}
		optimizeNodes() {
			let { nodes: e } = this, t = e.length;
			for (; t--;) {
				let n = e[t].optimizeNodes();
				Array.isArray(n) ? e.splice(t, 1, ...n) : n ? e[t] = n : e.splice(t, 1);
			}
			return e.length > 0 ? this : void 0;
		}
		optimizeNames(e, t) {
			let { nodes: n } = this, r = n.length;
			for (; r--;) {
				let i = n[r];
				i.optimizeNames(e, t) || (oe(e, i.names), n.splice(r, 1));
			}
			return n.length > 0 ? this : void 0;
		}
		get names() {
			return this.nodes.reduce((e, t) => re(e, t.names), {});
		}
	}, m = class extends p {
		render(e) {
			return "{" + e._n + super.render(e) + "}" + e._n;
		}
	}, h = class extends p {}, g = class extends m {};
	g.kind = "else";
	var _ = class e extends m {
		constructor(e, t) {
			super(t), this.condition = e;
		}
		render(e) {
			let t = `if(${this.condition})` + super.render(e);
			return this.else && (t += "else " + this.else.render(e)), t;
		}
		optimizeNodes() {
			super.optimizeNodes();
			let t = this.condition;
			if (t === !0) return this.nodes;
			let n = this.else;
			if (n) {
				let e = n.optimizeNodes();
				n = this.else = Array.isArray(e) ? new g(e) : e;
			}
			if (n) return t === !1 ? n instanceof e ? n : n.nodes : this.nodes.length ? this : new e(se(t), n instanceof e ? [n] : n.nodes);
			if (!(t === !1 || !this.nodes.length)) return this;
		}
		optimizeNames(e, t) {
			if (this.else = this.else?.optimizeNames(e, t), super.optimizeNames(e, t) || this.else) return this.condition = ae(this.condition, e, t), this;
		}
		get names() {
			let e = super.names;
			return ie(e, this.condition), this.else && re(e, this.else.names), e;
		}
	};
	_.kind = "if";
	var v = class extends m {};
	v.kind = "for";
	var y = class extends v {
		constructor(e) {
			super(), this.iteration = e;
		}
		render(e) {
			return `for(${this.iteration})` + super.render(e);
		}
		optimizeNames(e, t) {
			if (super.optimizeNames(e, t)) return this.iteration = ae(this.iteration, e, t), this;
		}
		get names() {
			return re(super.names, this.iteration.names);
		}
	}, b = class extends v {
		constructor(e, t, n, r) {
			super(), this.varKind = e, this.name = t, this.from = n, this.to = r;
		}
		render(e) {
			let t = e.es5 ? n.varKinds.var : this.varKind, { name: r, from: i, to: a } = this;
			return `for(${t} ${r}=${i}; ${r}<${a}; ${r}++)` + super.render(e);
		}
		get names() {
			return ie(ie(super.names, this.from), this.to);
		}
	}, x = class extends v {
		constructor(e, t, n, r) {
			super(), this.loop = e, this.varKind = t, this.name = n, this.iterable = r;
		}
		render(e) {
			return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(e);
		}
		optimizeNames(e, t) {
			if (super.optimizeNames(e, t)) return this.iterable = ae(this.iterable, e, t), this;
		}
		get names() {
			return re(super.names, this.iterable.names);
		}
	}, S = class extends m {
		constructor(e, t, n) {
			super(), this.name = e, this.args = t, this.async = n;
		}
		render(e) {
			return `${this.async ? "async " : ""}function ${this.name}(${this.args})` + super.render(e);
		}
	};
	S.kind = "func";
	var C = class extends p {
		render(e) {
			return "return " + super.render(e);
		}
	};
	C.kind = "return";
	var ee = class extends m {
		render(e) {
			let t = "try" + super.render(e);
			return this.catch && (t += this.catch.render(e)), this.finally && (t += this.finally.render(e)), t;
		}
		optimizeNodes() {
			var e, t;
			return super.optimizeNodes(), (e = this.catch) == null || e.optimizeNodes(), (t = this.finally) == null || t.optimizeNodes(), this;
		}
		optimizeNames(e, t) {
			var n, r;
			return super.optimizeNames(e, t), (n = this.catch) == null || n.optimizeNames(e, t), (r = this.finally) == null || r.optimizeNames(e, t), this;
		}
		get names() {
			let e = super.names;
			return this.catch && re(e, this.catch.names), this.finally && re(e, this.finally.names), e;
		}
	}, te = class extends m {
		constructor(e) {
			super(), this.error = e;
		}
		render(e) {
			return `catch(${this.error})` + super.render(e);
		}
	};
	te.kind = "catch";
	var ne = class extends m {
		render(e) {
			return "finally" + super.render(e);
		}
	};
	ne.kind = "finally", e.CodeGen = class {
		constructor(e, t = {}) {
			this._values = {}, this._blockStarts = [], this._constants = {}, this.opts = {
				...t,
				_n: t.lines ? "\n" : ""
			}, this._extScope = e, this._scope = new n.Scope({ parent: e }), this._nodes = [new h()];
		}
		toString() {
			return this._root.render(this.opts);
		}
		name(e) {
			return this._scope.name(e);
		}
		scopeName(e) {
			return this._extScope.name(e);
		}
		scopeValue(e, t) {
			let n = this._extScope.value(e, t);
			return (this._values[n.prefix] || (this._values[n.prefix] = /* @__PURE__ */ new Set())).add(n), n;
		}
		getScopeValue(e, t) {
			return this._extScope.getValue(e, t);
		}
		scopeRefs(e) {
			return this._extScope.scopeRefs(e, this._values);
		}
		scopeCode() {
			return this._extScope.scopeCode(this._values);
		}
		_def(e, t, n, r) {
			let i = this._scope.toName(t);
			return n !== void 0 && r && (this._constants[i.str] = n), this._leafNode(new o(e, i, n)), i;
		}
		const(e, t, r) {
			return this._def(n.varKinds.const, e, t, r);
		}
		let(e, t, r) {
			return this._def(n.varKinds.let, e, t, r);
		}
		var(e, t, r) {
			return this._def(n.varKinds.var, e, t, r);
		}
		assign(e, t, n) {
			return this._leafNode(new s(e, t, n));
		}
		add(t, n) {
			return this._leafNode(new c(t, e.operators.ADD, n));
		}
		code(e) {
			return typeof e == "function" ? e() : e !== t.nil && this._leafNode(new f(e)), this;
		}
		object(...e) {
			let n = ["{"];
			for (let [r, i] of e) n.length > 1 && n.push(","), n.push(r), (r !== i || this.opts.es5) && (n.push(":"), (0, t.addCodeArg)(n, i));
			return n.push("}"), new t._Code(n);
		}
		if(e, t, n) {
			if (this._blockNode(new _(e)), t && n) this.code(t).else().code(n).endIf();
			else if (t) this.code(t).endIf();
			else if (n) throw Error("CodeGen: \"else\" body without \"then\" body");
			return this;
		}
		elseIf(e) {
			return this._elseNode(new _(e));
		}
		else() {
			return this._elseNode(new g());
		}
		endIf() {
			return this._endBlockNode(_, g);
		}
		_for(e, t) {
			return this._blockNode(e), t && this.code(t).endFor(), this;
		}
		for(e, t) {
			return this._for(new y(e), t);
		}
		forRange(e, t, r, i, a = this.opts.es5 ? n.varKinds.var : n.varKinds.let) {
			let o = this._scope.toName(e);
			return this._for(new b(a, o, t, r), () => i(o));
		}
		forOf(e, r, i, a = n.varKinds.const) {
			let o = this._scope.toName(e);
			if (this.opts.es5) {
				let e = r instanceof t.Name ? r : this.var("_arr", r);
				return this.forRange("_i", 0, (0, t._)`${e}.length`, (n) => {
					this.var(o, (0, t._)`${e}[${n}]`), i(o);
				});
			}
			return this._for(new x("of", a, o, r), () => i(o));
		}
		forIn(e, r, i, a = this.opts.es5 ? n.varKinds.var : n.varKinds.const) {
			if (this.opts.ownProperties) return this.forOf(e, (0, t._)`Object.keys(${r})`, i);
			let o = this._scope.toName(e);
			return this._for(new x("in", a, o, r), () => i(o));
		}
		endFor() {
			return this._endBlockNode(v);
		}
		label(e) {
			return this._leafNode(new l(e));
		}
		break(e) {
			return this._leafNode(new u(e));
		}
		return(e) {
			let t = new C();
			if (this._blockNode(t), this.code(e), t.nodes.length !== 1) throw Error("CodeGen: \"return\" should have one node");
			return this._endBlockNode(C);
		}
		try(e, t, n) {
			if (!t && !n) throw Error("CodeGen: \"try\" without \"catch\" and \"finally\"");
			let r = new ee();
			if (this._blockNode(r), this.code(e), t) {
				let e = this.name("e");
				this._currNode = r.catch = new te(e), t(e);
			}
			return n && (this._currNode = r.finally = new ne(), this.code(n)), this._endBlockNode(te, ne);
		}
		throw(e) {
			return this._leafNode(new d(e));
		}
		block(e, t) {
			return this._blockStarts.push(this._nodes.length), e && this.code(e).endBlock(t), this;
		}
		endBlock(e) {
			let t = this._blockStarts.pop();
			if (t === void 0) throw Error("CodeGen: not in self-balancing block");
			let n = this._nodes.length - t;
			if (n < 0 || e !== void 0 && n !== e) throw Error(`CodeGen: wrong number of nodes: ${n} vs ${e} expected`);
			return this._nodes.length = t, this;
		}
		func(e, n = t.nil, r, i) {
			return this._blockNode(new S(e, n, r)), i && this.code(i).endFunc(), this;
		}
		endFunc() {
			return this._endBlockNode(S);
		}
		optimize(e = 1) {
			for (; e-- > 0;) this._root.optimizeNodes(), this._root.optimizeNames(this._root.names, this._constants);
		}
		_leafNode(e) {
			return this._currNode.nodes.push(e), this;
		}
		_blockNode(e) {
			this._currNode.nodes.push(e), this._nodes.push(e);
		}
		_endBlockNode(e, t) {
			let n = this._currNode;
			if (n instanceof e || t && n instanceof t) return this._nodes.pop(), this;
			throw Error(`CodeGen: not in block "${t ? `${e.kind}/${t.kind}` : e.kind}"`);
		}
		_elseNode(e) {
			let t = this._currNode;
			if (!(t instanceof _)) throw Error("CodeGen: \"else\" without \"if\"");
			return this._currNode = t.else = e, this;
		}
		get _root() {
			return this._nodes[0];
		}
		get _currNode() {
			let e = this._nodes;
			return e[e.length - 1];
		}
		set _currNode(e) {
			let t = this._nodes;
			t[t.length - 1] = e;
		}
	};
	function re(e, t) {
		for (let n in t) e[n] = (e[n] || 0) + (t[n] || 0);
		return e;
	}
	function ie(e, n) {
		return n instanceof t._CodeOrName ? re(e, n.names) : e;
	}
	function ae(e, n, r) {
		if (e instanceof t.Name) return i(e);
		if (!a(e)) return e;
		return new t._Code(e._items.reduce((e, n) => (n instanceof t.Name && (n = i(n)), n instanceof t._Code ? e.push(...n._items) : e.push(n), e), []));
		function i(e) {
			let t = r[e.str];
			return t === void 0 || n[e.str] !== 1 ? e : (delete n[e.str], t);
		}
		function a(e) {
			return e instanceof t._Code && e._items.some((e) => e instanceof t.Name && n[e.str] === 1 && r[e.str] !== void 0);
		}
	}
	function oe(e, t) {
		for (let n in t) e[n] = (e[n] || 0) - (t[n] || 0);
	}
	function se(e) {
		return typeof e == "boolean" || typeof e == "number" || e === null ? !e : (0, t._)`!${pe(e)}`;
	}
	e.not = se;
	var ce = fe(e.operators.AND);
	function le(...e) {
		return e.reduce(ce);
	}
	e.and = le;
	var ue = fe(e.operators.OR);
	function de(...e) {
		return e.reduce(ue);
	}
	e.or = de;
	function fe(e) {
		return (n, r) => n === t.nil ? r : r === t.nil ? n : (0, t._)`${pe(n)} ${e} ${pe(r)}`;
	}
	function pe(e) {
		return e instanceof t.Name ? e : (0, t._)`(${e})`;
	}
})), Z = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.checkStrictMode = e.getErrorPath = e.Type = e.useFunc = e.setEvaluated = e.evaluatedPropsToName = e.mergeEvaluated = e.eachItem = e.unescapeJsonPointer = e.escapeJsonPointer = e.escapeFragment = e.unescapeFragment = e.schemaRefOrVal = e.schemaHasRulesButRef = e.schemaHasRules = e.checkUnknownRules = e.alwaysValidSchema = e.toHash = void 0;
	var t = X(), n = Bd();
	function r(e) {
		let t = {};
		for (let n of e) t[n] = !0;
		return t;
	}
	e.toHash = r;
	function i(e, t) {
		return typeof t == "boolean" ? t : Object.keys(t).length === 0 || (a(e, t), !o(t, e.self.RULES.all));
	}
	e.alwaysValidSchema = i;
	function a(e, t = e.schema) {
		let { opts: n, self: r } = e;
		if (!n.strictSchema || typeof t == "boolean") return;
		let i = r.RULES.keywords;
		for (let n in t) i[n] || x(e, `unknown keyword: "${n}"`);
	}
	e.checkUnknownRules = a;
	function o(e, t) {
		if (typeof e == "boolean") return !e;
		for (let n in e) if (t[n]) return !0;
		return !1;
	}
	e.schemaHasRules = o;
	function s(e, t) {
		if (typeof e == "boolean") return !e;
		for (let n in e) if (n !== "$ref" && t.all[n]) return !0;
		return !1;
	}
	e.schemaHasRulesButRef = s;
	function c({ topSchemaRef: e, schemaPath: n }, r, i, a) {
		if (!a) {
			if (typeof r == "number" || typeof r == "boolean") return r;
			if (typeof r == "string") return (0, t._)`${r}`;
		}
		return (0, t._)`${e}${n}${(0, t.getProperty)(i)}`;
	}
	e.schemaRefOrVal = c;
	function l(e) {
		return f(decodeURIComponent(e));
	}
	e.unescapeFragment = l;
	function u(e) {
		return encodeURIComponent(d(e));
	}
	e.escapeFragment = u;
	function d(e) {
		return typeof e == "number" ? `${e}` : e.replace(/~/g, "~0").replace(/\//g, "~1");
	}
	e.escapeJsonPointer = d;
	function f(e) {
		return e.replace(/~1/g, "/").replace(/~0/g, "~");
	}
	e.unescapeJsonPointer = f;
	function p(e, t) {
		if (Array.isArray(e)) for (let n of e) t(n);
		else t(e);
	}
	e.eachItem = p;
	function m({ mergeNames: e, mergeToName: n, mergeValues: r, resultToName: i }) {
		return (a, o, s, c) => {
			let l = s === void 0 ? o : s instanceof t.Name ? (o instanceof t.Name ? e(a, o, s) : n(a, o, s), s) : o instanceof t.Name ? (n(a, s, o), o) : r(o, s);
			return c === t.Name && !(l instanceof t.Name) ? i(a, l) : l;
		};
	}
	e.mergeEvaluated = {
		props: m({
			mergeNames: (e, n, r) => e.if((0, t._)`${r} !== true && ${n} !== undefined`, () => {
				e.if((0, t._)`${n} === true`, () => e.assign(r, !0), () => e.assign(r, (0, t._)`${r} || {}`).code((0, t._)`Object.assign(${r}, ${n})`));
			}),
			mergeToName: (e, n, r) => e.if((0, t._)`${r} !== true`, () => {
				n === !0 ? e.assign(r, !0) : (e.assign(r, (0, t._)`${r} || {}`), g(e, r, n));
			}),
			mergeValues: (e, t) => e === !0 || {
				...e,
				...t
			},
			resultToName: h
		}),
		items: m({
			mergeNames: (e, n, r) => e.if((0, t._)`${r} !== true && ${n} !== undefined`, () => e.assign(r, (0, t._)`${n} === true ? true : ${r} > ${n} ? ${r} : ${n}`)),
			mergeToName: (e, n, r) => e.if((0, t._)`${r} !== true`, () => e.assign(r, n === !0 || (0, t._)`${r} > ${n} ? ${r} : ${n}`)),
			mergeValues: (e, t) => e === !0 || Math.max(e, t),
			resultToName: (e, t) => e.var("items", t)
		})
	};
	function h(e, n) {
		if (n === !0) return e.var("props", !0);
		let r = e.var("props", (0, t._)`{}`);
		return n !== void 0 && g(e, r, n), r;
	}
	e.evaluatedPropsToName = h;
	function g(e, n, r) {
		Object.keys(r).forEach((r) => e.assign((0, t._)`${n}${(0, t.getProperty)(r)}`, !0));
	}
	e.setEvaluated = g;
	var _ = {};
	function v(e, t) {
		return e.scopeValue("func", {
			ref: t,
			code: _[t.code] || (_[t.code] = new n._Code(t.code))
		});
	}
	e.useFunc = v;
	var y;
	(function(e) {
		e[e.Num = 0] = "Num", e[e.Str = 1] = "Str";
	})(y || (e.Type = y = {}));
	function b(e, n, r) {
		if (e instanceof t.Name) {
			let i = n === y.Num;
			return r ? i ? (0, t._)`"[" + ${e} + "]"` : (0, t._)`"['" + ${e} + "']"` : i ? (0, t._)`"/" + ${e}` : (0, t._)`"/" + ${e}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
		}
		return r ? (0, t.getProperty)(e).toString() : "/" + d(e);
	}
	e.getErrorPath = b;
	function x(e, t, n = e.opts.strictSchema) {
		if (n) {
			if (t = `strict mode: ${t}`, n === !0) throw Error(t);
			e.self.logger.warn(t);
		}
	}
	e.checkStrictMode = x;
})), Hd = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X();
	e.default = {
		data: new t.Name("data"),
		valCxt: new t.Name("valCxt"),
		instancePath: new t.Name("instancePath"),
		parentData: new t.Name("parentData"),
		parentDataProperty: new t.Name("parentDataProperty"),
		rootData: new t.Name("rootData"),
		dynamicAnchors: new t.Name("dynamicAnchors"),
		vErrors: new t.Name("vErrors"),
		errors: new t.Name("errors"),
		this: new t.Name("this"),
		self: new t.Name("self"),
		scope: new t.Name("scope"),
		json: new t.Name("json"),
		jsonPos: new t.Name("jsonPos"),
		jsonLen: new t.Name("jsonLen"),
		jsonPart: new t.Name("jsonPart")
	};
})), Ud = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.extendErrors = e.resetErrorsCount = e.reportExtraError = e.reportError = e.keyword$DataError = e.keywordError = void 0;
	var t = X(), n = Z(), r = Hd();
	e.keywordError = { message: ({ keyword: e }) => (0, t.str)`must pass "${e}" keyword validation` }, e.keyword$DataError = { message: ({ keyword: e, schemaType: n }) => n ? (0, t.str)`"${e}" keyword must be ${n} ($data)` : (0, t.str)`"${e}" keyword is invalid ($data)` };
	function i(n, r = e.keywordError, i, a) {
		let { it: o } = n, { gen: s, compositeRule: u, allErrors: f } = o, p = d(n, r, i);
		a ?? (u || f) ? c(s, p) : l(o, (0, t._)`[${p}]`);
	}
	e.reportError = i;
	function a(t, n = e.keywordError, i) {
		let { it: a } = t, { gen: o, compositeRule: s, allErrors: u } = a;
		c(o, d(t, n, i)), s || u || l(a, r.default.vErrors);
	}
	e.reportExtraError = a;
	function o(e, n) {
		e.assign(r.default.errors, n), e.if((0, t._)`${r.default.vErrors} !== null`, () => e.if(n, () => e.assign((0, t._)`${r.default.vErrors}.length`, n), () => e.assign(r.default.vErrors, null)));
	}
	e.resetErrorsCount = o;
	function s({ gen: e, keyword: n, schemaValue: i, data: a, errsCount: o, it: s }) {
		/* istanbul ignore if */
		if (o === void 0) throw Error("ajv implementation error");
		let c = e.name("err");
		e.forRange("i", o, r.default.errors, (o) => {
			e.const(c, (0, t._)`${r.default.vErrors}[${o}]`), e.if((0, t._)`${c}.instancePath === undefined`, () => e.assign((0, t._)`${c}.instancePath`, (0, t.strConcat)(r.default.instancePath, s.errorPath))), e.assign((0, t._)`${c}.schemaPath`, (0, t.str)`${s.errSchemaPath}/${n}`), s.opts.verbose && (e.assign((0, t._)`${c}.schema`, i), e.assign((0, t._)`${c}.data`, a));
		});
	}
	e.extendErrors = s;
	function c(e, n) {
		let i = e.const("err", n);
		e.if((0, t._)`${r.default.vErrors} === null`, () => e.assign(r.default.vErrors, (0, t._)`[${i}]`), (0, t._)`${r.default.vErrors}.push(${i})`), e.code((0, t._)`${r.default.errors}++`);
	}
	function l(e, n) {
		let { gen: r, validateName: i, schemaEnv: a } = e;
		a.$async ? r.throw((0, t._)`new ${e.ValidationError}(${n})`) : (r.assign((0, t._)`${i}.errors`, n), r.return(!1));
	}
	var u = {
		keyword: new t.Name("keyword"),
		schemaPath: new t.Name("schemaPath"),
		params: new t.Name("params"),
		propertyName: new t.Name("propertyName"),
		message: new t.Name("message"),
		schema: new t.Name("schema"),
		parentSchema: new t.Name("parentSchema")
	};
	function d(e, n, r) {
		let { createErrors: i } = e.it;
		return i === !1 ? (0, t._)`{}` : f(e, n, r);
	}
	function f(e, t, n = {}) {
		let { gen: r, it: i } = e, a = [p(i, n), m(e, n)];
		return h(e, t, a), r.object(...a);
	}
	function p({ errorPath: e }, { instancePath: i }) {
		let a = i ? (0, t.str)`${e}${(0, n.getErrorPath)(i, n.Type.Str)}` : e;
		return [r.default.instancePath, (0, t.strConcat)(r.default.instancePath, a)];
	}
	function m({ keyword: e, it: { errSchemaPath: r } }, { schemaPath: i, parentSchema: a }) {
		let o = a ? r : (0, t.str)`${r}/${e}`;
		return i && (o = (0, t.str)`${o}${(0, n.getErrorPath)(i, n.Type.Str)}`), [u.schemaPath, o];
	}
	function h(e, { params: n, message: i }, a) {
		let { keyword: o, data: s, schemaValue: c, it: l } = e, { opts: d, propertyName: f, topSchemaRef: p, schemaPath: m } = l;
		a.push([u.keyword, o], [u.params, typeof n == "function" ? n(e) : n || (0, t._)`{}`]), d.messages && a.push([u.message, typeof i == "function" ? i(e) : i]), d.verbose && a.push([u.schema, c], [u.parentSchema, (0, t._)`${p}${m}`], [r.default.data, s]), f && a.push([u.propertyName, f]);
	}
})), Wd = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.boolOrEmptySchema = e.topBoolOrEmptySchema = void 0;
	var t = Ud(), n = X(), r = Hd(), i = { message: "boolean schema is false" };
	function a(e) {
		let { gen: t, schema: i, validateName: a } = e;
		i === !1 ? s(e, !1) : typeof i == "object" && i.$async === !0 ? t.return(r.default.data) : (t.assign((0, n._)`${a}.errors`, null), t.return(!0));
	}
	e.topBoolOrEmptySchema = a;
	function o(e, t) {
		let { gen: n, schema: r } = e;
		r === !1 ? (n.var(t, !1), s(e)) : n.var(t, !0);
	}
	e.boolOrEmptySchema = o;
	function s(e, n) {
		let { gen: r, data: a } = e, o = {
			gen: r,
			keyword: "false schema",
			data: a,
			schema: !1,
			schemaCode: !1,
			schemaValue: !1,
			params: {},
			it: e
		};
		(0, t.reportError)(o, i, void 0, n);
	}
})), Gd = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.getRules = e.isJSONType = void 0;
	var t = /* @__PURE__ */ new Set([
		"string",
		"number",
		"integer",
		"boolean",
		"null",
		"object",
		"array"
	]);
	function n(e) {
		return typeof e == "string" && t.has(e);
	}
	e.isJSONType = n;
	function r() {
		let e = {
			number: {
				type: "number",
				rules: []
			},
			string: {
				type: "string",
				rules: []
			},
			array: {
				type: "array",
				rules: []
			},
			object: {
				type: "object",
				rules: []
			}
		};
		return {
			types: {
				...e,
				integer: !0,
				boolean: !0,
				null: !0
			},
			rules: [
				{ rules: [] },
				e.number,
				e.string,
				e.array,
				e.object
			],
			post: { rules: [] },
			all: {},
			keywords: {}
		};
	}
	e.getRules = r;
})), Kd = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.shouldUseRule = e.shouldUseGroup = e.schemaHasRulesForType = void 0;
	function t({ schema: e, self: t }, r) {
		let i = t.RULES.types[r];
		return i && i !== !0 && n(e, i);
	}
	e.schemaHasRulesForType = t;
	function n(e, t) {
		return t.rules.some((t) => r(e, t));
	}
	e.shouldUseGroup = n;
	function r(e, t) {
		return e[t.keyword] !== void 0 || t.definition.implements?.some((t) => e[t] !== void 0);
	}
	e.shouldUseRule = r;
})), qd = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.reportTypeError = e.checkDataTypes = e.checkDataType = e.coerceAndCheckDataType = e.getJSONTypes = e.getSchemaTypes = e.DataType = void 0;
	var t = Gd(), n = Kd(), r = Ud(), i = X(), a = Z(), o;
	(function(e) {
		e[e.Correct = 0] = "Correct", e[e.Wrong = 1] = "Wrong";
	})(o || (e.DataType = o = {}));
	function s(e) {
		let t = c(e.type);
		if (t.includes("null")) {
			if (e.nullable === !1) throw Error("type: null contradicts nullable: false");
		} else {
			if (!t.length && e.nullable !== void 0) throw Error("\"nullable\" cannot be used without \"type\"");
			e.nullable === !0 && t.push("null");
		}
		return t;
	}
	e.getSchemaTypes = s;
	function c(e) {
		let n = Array.isArray(e) ? e : e ? [e] : [];
		if (n.every(t.isJSONType)) return n;
		throw Error("type must be JSONType or JSONType[]: " + n.join(","));
	}
	e.getJSONTypes = c;
	function l(e, t) {
		let { gen: r, data: i, opts: a } = e, s = d(t, a.coerceTypes), c = t.length > 0 && !(s.length === 0 && t.length === 1 && (0, n.schemaHasRulesForType)(e, t[0]));
		if (c) {
			let n = h(t, i, a.strictNumbers, o.Wrong);
			r.if(n, () => {
				s.length ? f(e, t, s) : _(e);
			});
		}
		return c;
	}
	e.coerceAndCheckDataType = l;
	var u = /* @__PURE__ */ new Set([
		"string",
		"number",
		"integer",
		"boolean",
		"null"
	]);
	function d(e, t) {
		return t ? e.filter((e) => u.has(e) || t === "array" && e === "array") : [];
	}
	function f(e, t, n) {
		let { gen: r, data: a, opts: o } = e, s = r.let("dataType", (0, i._)`typeof ${a}`), c = r.let("coerced", (0, i._)`undefined`);
		o.coerceTypes === "array" && r.if((0, i._)`${s} == 'object' && Array.isArray(${a}) && ${a}.length == 1`, () => r.assign(a, (0, i._)`${a}[0]`).assign(s, (0, i._)`typeof ${a}`).if(h(t, a, o.strictNumbers), () => r.assign(c, a))), r.if((0, i._)`${c} !== undefined`);
		for (let e of n) (u.has(e) || e === "array" && o.coerceTypes === "array") && l(e);
		r.else(), _(e), r.endIf(), r.if((0, i._)`${c} !== undefined`, () => {
			r.assign(a, c), p(e, c);
		});
		function l(e) {
			switch (e) {
				case "string":
					r.elseIf((0, i._)`${s} == "number" || ${s} == "boolean"`).assign(c, (0, i._)`"" + ${a}`).elseIf((0, i._)`${a} === null`).assign(c, (0, i._)`""`);
					return;
				case "number":
					r.elseIf((0, i._)`${s} == "boolean" || ${a} === null
              || (${s} == "string" && ${a} && ${a} == +${a})`).assign(c, (0, i._)`+${a}`);
					return;
				case "integer":
					r.elseIf((0, i._)`${s} === "boolean" || ${a} === null
              || (${s} === "string" && ${a} && ${a} == +${a} && !(${a} % 1))`).assign(c, (0, i._)`+${a}`);
					return;
				case "boolean":
					r.elseIf((0, i._)`${a} === "false" || ${a} === 0 || ${a} === null`).assign(c, !1).elseIf((0, i._)`${a} === "true" || ${a} === 1`).assign(c, !0);
					return;
				case "null":
					r.elseIf((0, i._)`${a} === "" || ${a} === 0 || ${a} === false`), r.assign(c, null);
					return;
				case "array": r.elseIf((0, i._)`${s} === "string" || ${s} === "number"
              || ${s} === "boolean" || ${a} === null`).assign(c, (0, i._)`[${a}]`);
			}
		}
	}
	function p({ gen: e, parentData: t, parentDataProperty: n }, r) {
		e.if((0, i._)`${t} !== undefined`, () => e.assign((0, i._)`${t}[${n}]`, r));
	}
	function m(e, t, n, r = o.Correct) {
		let a = r === o.Correct ? i.operators.EQ : i.operators.NEQ, s;
		switch (e) {
			case "null": return (0, i._)`${t} ${a} null`;
			case "array":
				s = (0, i._)`Array.isArray(${t})`;
				break;
			case "object":
				s = (0, i._)`${t} && typeof ${t} == "object" && !Array.isArray(${t})`;
				break;
			case "integer":
				s = c((0, i._)`!(${t} % 1) && !isNaN(${t})`);
				break;
			case "number":
				s = c();
				break;
			default: return (0, i._)`typeof ${t} ${a} ${e}`;
		}
		return r === o.Correct ? s : (0, i.not)(s);
		function c(e = i.nil) {
			return (0, i.and)((0, i._)`typeof ${t} == "number"`, e, n ? (0, i._)`isFinite(${t})` : i.nil);
		}
	}
	e.checkDataType = m;
	function h(e, t, n, r) {
		if (e.length === 1) return m(e[0], t, n, r);
		let o, s = (0, a.toHash)(e);
		if (s.array && s.object) {
			let e = (0, i._)`typeof ${t} != "object"`;
			o = s.null ? e : (0, i._)`!${t} || ${e}`, delete s.null, delete s.array, delete s.object;
		} else o = i.nil;
		s.number && delete s.integer;
		for (let e in s) o = (0, i.and)(o, m(e, t, n, r));
		return o;
	}
	e.checkDataTypes = h;
	var g = {
		message: ({ schema: e }) => `must be ${e}`,
		params: ({ schema: e, schemaValue: t }) => typeof e == "string" ? (0, i._)`{type: ${e}}` : (0, i._)`{type: ${t}}`
	};
	function _(e) {
		let t = v(e);
		(0, r.reportError)(t, g);
	}
	e.reportTypeError = _;
	function v(e) {
		let { gen: t, data: n, schema: r } = e, i = (0, a.schemaRefOrVal)(e, r, "type");
		return {
			gen: t,
			keyword: "type",
			data: n,
			schema: r.type,
			schemaCode: i,
			schemaValue: i,
			parentSchema: r,
			params: {},
			it: e
		};
	}
})), Jd = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.assignDefaults = void 0;
	var t = X(), n = Z();
	function r(e, t) {
		let { properties: n, items: r } = e.schema;
		if (t === "object" && n) for (let t in n) i(e, t, n[t].default);
		else t === "array" && Array.isArray(r) && r.forEach((t, n) => i(e, n, t.default));
	}
	e.assignDefaults = r;
	function i(e, r, i) {
		let { gen: a, compositeRule: o, data: s, opts: c } = e;
		if (i === void 0) return;
		let l = (0, t._)`${s}${(0, t.getProperty)(r)}`;
		if (o) {
			(0, n.checkStrictMode)(e, `default is ignored for: ${l}`);
			return;
		}
		let u = (0, t._)`${l} === undefined`;
		c.useDefaults === "empty" && (u = (0, t._)`${u} || ${l} === null || ${l} === ""`), a.if(u, (0, t._)`${l} = ${(0, t.stringify)(i)}`);
	}
})), Yd = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.validateUnion = e.validateArray = e.usePattern = e.callValidateCode = e.schemaProperties = e.allSchemaProperties = e.noPropertyInData = e.propertyInData = e.isOwnProperty = e.hasPropFunc = e.reportMissingProp = e.checkMissingProp = e.checkReportMissingProp = void 0;
	var t = X(), n = Z(), r = Hd(), i = Z();
	function a(e, n) {
		let { gen: r, data: i, it: a } = e;
		r.if(d(r, i, n, a.opts.ownProperties), () => {
			e.setParams({ missingProperty: (0, t._)`${n}` }, !0), e.error();
		});
	}
	e.checkReportMissingProp = a;
	function o({ gen: e, data: n, it: { opts: r } }, i, a) {
		return (0, t.or)(...i.map((i) => (0, t.and)(d(e, n, i, r.ownProperties), (0, t._)`${a} = ${i}`)));
	}
	e.checkMissingProp = o;
	function s(e, t) {
		e.setParams({ missingProperty: t }, !0), e.error();
	}
	e.reportMissingProp = s;
	function c(e) {
		return e.scopeValue("func", {
			ref: Object.prototype.hasOwnProperty,
			code: (0, t._)`Object.prototype.hasOwnProperty`
		});
	}
	e.hasPropFunc = c;
	function l(e, n, r) {
		return (0, t._)`${c(e)}.call(${n}, ${r})`;
	}
	e.isOwnProperty = l;
	function u(e, n, r, i) {
		let a = (0, t._)`${n}${(0, t.getProperty)(r)} !== undefined`;
		return i ? (0, t._)`${a} && ${l(e, n, r)}` : a;
	}
	e.propertyInData = u;
	function d(e, n, r, i) {
		let a = (0, t._)`${n}${(0, t.getProperty)(r)} === undefined`;
		return i ? (0, t.or)(a, (0, t.not)(l(e, n, r))) : a;
	}
	e.noPropertyInData = d;
	function f(e) {
		return e ? Object.keys(e).filter((e) => e !== "__proto__") : [];
	}
	e.allSchemaProperties = f;
	function p(e, t) {
		return f(t).filter((r) => !(0, n.alwaysValidSchema)(e, t[r]));
	}
	e.schemaProperties = p;
	function m({ schemaCode: e, data: n, it: { gen: i, topSchemaRef: a, schemaPath: o, errorPath: s }, it: c }, l, u, d) {
		let f = d ? (0, t._)`${e}, ${n}, ${a}${o}` : n, p = [
			[r.default.instancePath, (0, t.strConcat)(r.default.instancePath, s)],
			[r.default.parentData, c.parentData],
			[r.default.parentDataProperty, c.parentDataProperty],
			[r.default.rootData, r.default.rootData]
		];
		c.opts.dynamicRef && p.push([r.default.dynamicAnchors, r.default.dynamicAnchors]);
		let m = (0, t._)`${f}, ${i.object(...p)}`;
		return u === t.nil ? (0, t._)`${l}(${m})` : (0, t._)`${l}.call(${u}, ${m})`;
	}
	e.callValidateCode = m;
	var h = (0, t._)`new RegExp`;
	function g({ gen: e, it: { opts: n } }, r) {
		let a = n.unicodeRegExp ? "u" : "", { regExp: o } = n.code, s = o(r, a);
		return e.scopeValue("pattern", {
			key: s.toString(),
			ref: s,
			code: (0, t._)`${o.code === "new RegExp" ? h : (0, i.useFunc)(e, o)}(${r}, ${a})`
		});
	}
	e.usePattern = g;
	function _(e) {
		let { gen: r, data: i, keyword: a, it: o } = e, s = r.name("valid");
		if (o.allErrors) {
			let e = r.let("valid", !0);
			return c(() => r.assign(e, !1)), e;
		}
		return r.var(s, !0), c(() => r.break()), s;
		function c(o) {
			let c = r.const("len", (0, t._)`${i}.length`);
			r.forRange("i", 0, c, (i) => {
				e.subschema({
					keyword: a,
					dataProp: i,
					dataPropType: n.Type.Num
				}, s), r.if((0, t.not)(s), o);
			});
		}
	}
	e.validateArray = _;
	function v(e) {
		let { gen: r, schema: i, keyword: a, it: o } = e;
		/* istanbul ignore if */
		if (!Array.isArray(i)) throw Error("ajv implementation error");
		if (i.some((e) => (0, n.alwaysValidSchema)(o, e)) && !o.opts.unevaluated) return;
		let s = r.let("valid", !1), c = r.name("_valid");
		r.block(() => i.forEach((n, i) => {
			let o = e.subschema({
				keyword: a,
				schemaProp: i,
				compositeRule: !0
			}, c);
			r.assign(s, (0, t._)`${s} || ${c}`), e.mergeValidEvaluated(o, c) || r.if((0, t.not)(s));
		})), e.result(s, () => e.reset(), () => e.error(!0));
	}
	e.validateUnion = v;
})), Xd = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.validateKeywordUsage = e.validSchemaType = e.funcKeywordCode = e.macroKeywordCode = void 0;
	var t = X(), n = Hd(), r = Yd(), i = Ud();
	function a(e, n) {
		let { gen: r, keyword: i, schema: a, parentSchema: o, it: s } = e, c = n.macro.call(s.self, a, o, s), l = u(r, i, c);
		s.opts.validateSchema !== !1 && s.self.validateSchema(c, !0);
		let d = r.name("valid");
		e.subschema({
			schema: c,
			schemaPath: t.nil,
			errSchemaPath: `${s.errSchemaPath}/${i}`,
			topSchemaRef: l,
			compositeRule: !0
		}, d), e.pass(d, () => e.error(!0));
	}
	e.macroKeywordCode = a;
	function o(e, i) {
		let { gen: a, keyword: o, schema: d, parentSchema: f, $data: p, it: m } = e;
		l(m, i);
		let h = u(a, o, !p && i.compile ? i.compile.call(m.self, d, f, m) : i.validate), g = a.let("valid");
		e.block$data(g, _), e.ok(i.valid ?? g);
		function _() {
			if (i.errors === !1) b(), i.modifying && s(e), x(() => e.error());
			else {
				let t = i.async ? v() : y();
				i.modifying && s(e), x(() => c(e, t));
			}
		}
		function v() {
			let e = a.let("ruleErrs", null);
			return a.try(() => b((0, t._)`await `), (n) => a.assign(g, !1).if((0, t._)`${n} instanceof ${m.ValidationError}`, () => a.assign(e, (0, t._)`${n}.errors`), () => a.throw(n))), e;
		}
		function y() {
			let e = (0, t._)`${h}.errors`;
			return a.assign(e, null), b(t.nil), e;
		}
		function b(o = i.async ? (0, t._)`await ` : t.nil) {
			let s = m.opts.passContext ? n.default.this : n.default.self, c = !("compile" in i && !p || i.schema === !1);
			a.assign(g, (0, t._)`${o}${(0, r.callValidateCode)(e, h, s, c)}`, i.modifying);
		}
		function x(e) {
			a.if((0, t.not)(i.valid ?? g), e);
		}
	}
	e.funcKeywordCode = o;
	function s(e) {
		let { gen: n, data: r, it: i } = e;
		n.if(i.parentData, () => n.assign(r, (0, t._)`${i.parentData}[${i.parentDataProperty}]`));
	}
	function c(e, r) {
		let { gen: a } = e;
		a.if((0, t._)`Array.isArray(${r})`, () => {
			a.assign(n.default.vErrors, (0, t._)`${n.default.vErrors} === null ? ${r} : ${n.default.vErrors}.concat(${r})`).assign(n.default.errors, (0, t._)`${n.default.vErrors}.length`), (0, i.extendErrors)(e);
		}, () => e.error());
	}
	function l({ schemaEnv: e }, t) {
		if (t.async && !e.$async) throw Error("async keyword in sync schema");
	}
	function u(e, n, r) {
		if (r === void 0) throw Error(`keyword "${n}" failed to compile`);
		return e.scopeValue("keyword", typeof r == "function" ? { ref: r } : {
			ref: r,
			code: (0, t.stringify)(r)
		});
	}
	function d(e, t, n = !1) {
		return !t.length || t.some((t) => t === "array" ? Array.isArray(e) : t === "object" ? e && typeof e == "object" && !Array.isArray(e) : typeof e == t || n && e === void 0);
	}
	e.validSchemaType = d;
	function f({ schema: e, opts: t, self: n, errSchemaPath: r }, i, a) {
		/* istanbul ignore if */
		if (Array.isArray(i.keyword) ? !i.keyword.includes(a) : i.keyword !== a) throw Error("ajv implementation error");
		let o = i.dependencies;
		if (o?.some((t) => !Object.prototype.hasOwnProperty.call(e, t))) throw Error(`parent schema must have dependencies of ${a}: ${o.join(",")}`);
		if (i.validateSchema && !i.validateSchema(e[a])) {
			let e = `keyword "${a}" value is invalid at path "${r}": ` + n.errorsText(i.validateSchema.errors);
			if (t.validateSchema === "log") n.logger.error(e);
			else throw Error(e);
		}
	}
	e.validateKeywordUsage = f;
})), Zd = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.extendSubschemaMode = e.extendSubschemaData = e.getSubschema = void 0;
	var t = X(), n = Z();
	function r(e, { keyword: r, schemaProp: i, schema: a, schemaPath: o, errSchemaPath: s, topSchemaRef: c }) {
		if (r !== void 0 && a !== void 0) throw Error("both \"keyword\" and \"schema\" passed, only one allowed");
		if (r !== void 0) {
			let a = e.schema[r];
			return i === void 0 ? {
				schema: a,
				schemaPath: (0, t._)`${e.schemaPath}${(0, t.getProperty)(r)}`,
				errSchemaPath: `${e.errSchemaPath}/${r}`
			} : {
				schema: a[i],
				schemaPath: (0, t._)`${e.schemaPath}${(0, t.getProperty)(r)}${(0, t.getProperty)(i)}`,
				errSchemaPath: `${e.errSchemaPath}/${r}/${(0, n.escapeFragment)(i)}`
			};
		}
		if (a !== void 0) {
			if (o === void 0 || s === void 0 || c === void 0) throw Error("\"schemaPath\", \"errSchemaPath\" and \"topSchemaRef\" are required with \"schema\"");
			return {
				schema: a,
				schemaPath: o,
				topSchemaRef: c,
				errSchemaPath: s
			};
		}
		throw Error("either \"keyword\" or \"schema\" must be passed");
	}
	e.getSubschema = r;
	function i(e, r, { dataProp: i, dataPropType: a, data: o, dataTypes: s, propertyName: c }) {
		if (o !== void 0 && i !== void 0) throw Error("both \"data\" and \"dataProp\" passed, only one allowed");
		let { gen: l } = r;
		if (i !== void 0) {
			let { errorPath: o, dataPathArr: s, opts: c } = r;
			u(l.let("data", (0, t._)`${r.data}${(0, t.getProperty)(i)}`, !0)), e.errorPath = (0, t.str)`${o}${(0, n.getErrorPath)(i, a, c.jsPropertySyntax)}`, e.parentDataProperty = (0, t._)`${i}`, e.dataPathArr = [...s, e.parentDataProperty];
		}
		o !== void 0 && (u(o instanceof t.Name ? o : l.let("data", o, !0)), c !== void 0 && (e.propertyName = c)), s && (e.dataTypes = s);
		function u(t) {
			e.data = t, e.dataLevel = r.dataLevel + 1, e.dataTypes = [], r.definedProperties = /* @__PURE__ */ new Set(), e.parentData = r.data, e.dataNames = [...r.dataNames, t];
		}
	}
	e.extendSubschemaData = i;
	function a(e, { jtdDiscriminator: t, jtdMetadata: n, compositeRule: r, createErrors: i, allErrors: a }) {
		r !== void 0 && (e.compositeRule = r), i !== void 0 && (e.createErrors = i), a !== void 0 && (e.allErrors = a), e.jtdDiscriminator = t, e.jtdMetadata = n;
	}
	e.extendSubschemaMode = a;
})), Qd = /* @__PURE__ */ a(((e, t) => {
	t.exports = function e(t, n) {
		if (t === n) return !0;
		if (t && n && typeof t == "object" && typeof n == "object") {
			if (t.constructor !== n.constructor) return !1;
			var r, i, a;
			if (Array.isArray(t)) {
				if (r = t.length, r != n.length) return !1;
				for (i = r; i-- !== 0;) if (!e(t[i], n[i])) return !1;
				return !0;
			}
			if (t.constructor === RegExp) return t.source === n.source && t.flags === n.flags;
			if (t.valueOf !== Object.prototype.valueOf) return t.valueOf() === n.valueOf();
			if (t.toString !== Object.prototype.toString) return t.toString() === n.toString();
			if (a = Object.keys(t), r = a.length, r !== Object.keys(n).length) return !1;
			for (i = r; i-- !== 0;) if (!Object.prototype.hasOwnProperty.call(n, a[i])) return !1;
			for (i = r; i-- !== 0;) {
				var o = a[i];
				if (!e(t[o], n[o])) return !1;
			}
			return !0;
		}
		return t !== t && n !== n;
	};
})), $d = /* @__PURE__ */ a(((e, t) => {
	var n = t.exports = function(e, t, n) {
		typeof t == "function" && (n = t, t = {}), n = t.cb || n;
		var i = typeof n == "function" ? n : n.pre || function() {}, a = n.post || function() {};
		r(t, i, a, e, "", e);
	};
	n.keywords = {
		additionalItems: !0,
		items: !0,
		contains: !0,
		additionalProperties: !0,
		propertyNames: !0,
		not: !0,
		if: !0,
		then: !0,
		else: !0
	}, n.arrayKeywords = {
		items: !0,
		allOf: !0,
		anyOf: !0,
		oneOf: !0
	}, n.propsKeywords = {
		$defs: !0,
		definitions: !0,
		properties: !0,
		patternProperties: !0,
		dependencies: !0
	}, n.skipKeywords = {
		default: !0,
		enum: !0,
		const: !0,
		required: !0,
		maximum: !0,
		minimum: !0,
		exclusiveMaximum: !0,
		exclusiveMinimum: !0,
		multipleOf: !0,
		maxLength: !0,
		minLength: !0,
		pattern: !0,
		format: !0,
		maxItems: !0,
		minItems: !0,
		uniqueItems: !0,
		maxProperties: !0,
		minProperties: !0
	};
	function r(e, t, a, o, s, c, l, u, d, f) {
		if (o && typeof o == "object" && !Array.isArray(o)) {
			for (var p in t(o, s, c, l, u, d, f), o) {
				var m = o[p];
				if (Array.isArray(m)) {
					if (p in n.arrayKeywords) for (var h = 0; h < m.length; h++) r(e, t, a, m[h], s + "/" + p + "/" + h, c, s, p, o, h);
				} else if (p in n.propsKeywords) {
					if (m && typeof m == "object") for (var g in m) r(e, t, a, m[g], s + "/" + p + "/" + i(g), c, s, p, o, g);
				} else (p in n.keywords || e.allKeys && !(p in n.skipKeywords)) && r(e, t, a, m, s + "/" + p, c, s, p, o);
			}
			a(o, s, c, l, u, d, f);
		}
	}
	function i(e) {
		return e.replace(/~/g, "~0").replace(/\//g, "~1");
	}
})), ef = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.getSchemaRefs = e.resolveUrl = e.normalizeId = e._getFullPath = e.getFullPath = e.inlineRef = void 0;
	var t = Z(), n = Qd(), r = $d(), i = /* @__PURE__ */ new Set([
		"type",
		"format",
		"pattern",
		"maxLength",
		"minLength",
		"maxProperties",
		"minProperties",
		"maxItems",
		"minItems",
		"maximum",
		"minimum",
		"uniqueItems",
		"multipleOf",
		"required",
		"enum",
		"const"
	]);
	function a(e, t = !0) {
		return typeof e == "boolean" ? !0 : t === !0 ? !s(e) : t ? c(e) <= t : !1;
	}
	e.inlineRef = a;
	var o = /* @__PURE__ */ new Set([
		"$ref",
		"$recursiveRef",
		"$recursiveAnchor",
		"$dynamicRef",
		"$dynamicAnchor"
	]);
	function s(e) {
		for (let t in e) {
			if (o.has(t)) return !0;
			let n = e[t];
			if (Array.isArray(n) && n.some(s) || typeof n == "object" && s(n)) return !0;
		}
		return !1;
	}
	function c(e) {
		let n = 0;
		for (let r in e) if (r === "$ref" || (n++, !i.has(r) && (typeof e[r] == "object" && (0, t.eachItem)(e[r], (e) => n += c(e)), n === Infinity))) return Infinity;
		return n;
	}
	function l(e, t = "", n) {
		return n !== !1 && (t = f(t)), u(e, e.parse(t));
	}
	e.getFullPath = l;
	function u(e, t) {
		return e.serialize(t).split("#")[0] + "#";
	}
	e._getFullPath = u;
	var d = /#\/?$/;
	function f(e) {
		return e ? e.replace(d, "") : "";
	}
	e.normalizeId = f;
	function p(e, t, n) {
		return n = f(n), e.resolve(t, n);
	}
	e.resolveUrl = p;
	var m = /^[a-z_][-a-z0-9._]*$/i;
	function h(e, t) {
		if (typeof e == "boolean") return {};
		let { schemaId: i, uriResolver: a } = this.opts, o = f(e[i] || t), s = { "": o }, c = l(a, o, !1), u = {}, d = /* @__PURE__ */ new Set();
		return r(e, { allKeys: !0 }, (e, t, n, r) => {
			if (r === void 0) return;
			let a = c + t, o = s[r];
			typeof e[i] == "string" && (o = l.call(this, e[i])), g.call(this, e.$anchor), g.call(this, e.$dynamicAnchor), s[t] = o;
			function l(t) {
				let n = this.opts.uriResolver.resolve;
				if (t = f(o ? n(o, t) : t), d.has(t)) throw h(t);
				d.add(t);
				let r = this.refs[t];
				return typeof r == "string" && (r = this.refs[r]), typeof r == "object" ? p(e, r.schema, t) : t !== f(a) && (t[0] === "#" ? (p(e, u[t], t), u[t] = e) : this.refs[t] = a), t;
			}
			function g(e) {
				if (typeof e == "string") {
					if (!m.test(e)) throw Error(`invalid anchor "${e}"`);
					l.call(this, `#${e}`);
				}
			}
		}), u;
		function p(e, t, r) {
			if (t !== void 0 && !n(e, t)) throw h(r);
		}
		function h(e) {
			return /* @__PURE__ */ Error(`reference "${e}" resolves to more than one schema`);
		}
	}
	e.getSchemaRefs = h;
})), tf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.getData = e.KeywordCxt = e.validateFunctionCode = void 0;
	var t = Wd(), n = qd(), r = Kd(), i = qd(), a = Jd(), o = Xd(), s = Zd(), c = X(), l = Hd(), u = ef(), d = Z(), f = Ud();
	function p(e) {
		if (S(e) && (ee(e), x(e))) {
			_(e);
			return;
		}
		m(e, () => (0, t.topBoolOrEmptySchema)(e));
	}
	e.validateFunctionCode = p;
	function m({ gen: e, validateName: t, schema: n, schemaEnv: r, opts: i }, a) {
		i.code.es5 ? e.func(t, (0, c._)`${l.default.data}, ${l.default.valCxt}`, r.$async, () => {
			e.code((0, c._)`"use strict"; ${y(n, i)}`), g(e, i), e.code(a);
		}) : e.func(t, (0, c._)`${l.default.data}, ${h(i)}`, r.$async, () => e.code(y(n, i)).code(a));
	}
	function h(e) {
		return (0, c._)`{${l.default.instancePath}="", ${l.default.parentData}, ${l.default.parentDataProperty}, ${l.default.rootData}=${l.default.data}${e.dynamicRef ? (0, c._)`, ${l.default.dynamicAnchors}={}` : c.nil}}={}`;
	}
	function g(e, t) {
		e.if(l.default.valCxt, () => {
			e.var(l.default.instancePath, (0, c._)`${l.default.valCxt}.${l.default.instancePath}`), e.var(l.default.parentData, (0, c._)`${l.default.valCxt}.${l.default.parentData}`), e.var(l.default.parentDataProperty, (0, c._)`${l.default.valCxt}.${l.default.parentDataProperty}`), e.var(l.default.rootData, (0, c._)`${l.default.valCxt}.${l.default.rootData}`), t.dynamicRef && e.var(l.default.dynamicAnchors, (0, c._)`${l.default.valCxt}.${l.default.dynamicAnchors}`);
		}, () => {
			e.var(l.default.instancePath, (0, c._)`""`), e.var(l.default.parentData, (0, c._)`undefined`), e.var(l.default.parentDataProperty, (0, c._)`undefined`), e.var(l.default.rootData, l.default.data), t.dynamicRef && e.var(l.default.dynamicAnchors, (0, c._)`{}`);
		});
	}
	function _(e) {
		let { schema: t, opts: n, gen: r } = e;
		m(e, () => {
			n.$comment && t.$comment && oe(e), re(e), r.let(l.default.vErrors, null), r.let(l.default.errors, 0), n.unevaluated && v(e), te(e), se(e);
		});
	}
	function v(e) {
		let { gen: t, validateName: n } = e;
		e.evaluated = t.const("evaluated", (0, c._)`${n}.evaluated`), t.if((0, c._)`${e.evaluated}.dynamicProps`, () => t.assign((0, c._)`${e.evaluated}.props`, (0, c._)`undefined`)), t.if((0, c._)`${e.evaluated}.dynamicItems`, () => t.assign((0, c._)`${e.evaluated}.items`, (0, c._)`undefined`));
	}
	function y(e, t) {
		let n = typeof e == "object" && e[t.schemaId];
		return n && (t.code.source || t.code.process) ? (0, c._)`/*# sourceURL=${n} */` : c.nil;
	}
	function b(e, n) {
		if (S(e) && (ee(e), x(e))) {
			C(e, n);
			return;
		}
		(0, t.boolOrEmptySchema)(e, n);
	}
	function x({ schema: e, self: t }) {
		if (typeof e == "boolean") return !e;
		for (let n in e) if (t.RULES.all[n]) return !0;
		return !1;
	}
	function S(e) {
		return typeof e.schema != "boolean";
	}
	function C(e, t) {
		let { schema: n, gen: r, opts: i } = e;
		i.$comment && n.$comment && oe(e), ie(e), ae(e);
		let a = r.const("_errs", l.default.errors);
		te(e, a), r.var(t, (0, c._)`${a} === ${l.default.errors}`);
	}
	function ee(e) {
		(0, d.checkUnknownRules)(e), ne(e);
	}
	function te(e, t) {
		if (e.opts.jtd) return le(e, [], !1, t);
		let r = (0, n.getSchemaTypes)(e.schema);
		le(e, r, !(0, n.coerceAndCheckDataType)(e, r), t);
	}
	function ne(e) {
		let { schema: t, errSchemaPath: n, opts: r, self: i } = e;
		t.$ref && r.ignoreKeywordsWithRef && (0, d.schemaHasRulesButRef)(t, i.RULES) && i.logger.warn(`$ref: keywords ignored in schema at path "${n}"`);
	}
	function re(e) {
		let { schema: t, opts: n } = e;
		t.default !== void 0 && n.useDefaults && n.strictSchema && (0, d.checkStrictMode)(e, "default is ignored in the schema root");
	}
	function ie(e) {
		let t = e.schema[e.opts.schemaId];
		t && (e.baseId = (0, u.resolveUrl)(e.opts.uriResolver, e.baseId, t));
	}
	function ae(e) {
		if (e.schema.$async && !e.schemaEnv.$async) throw Error("async schema in sync schema");
	}
	function oe({ gen: e, schemaEnv: t, schema: n, errSchemaPath: r, opts: i }) {
		let a = n.$comment;
		if (i.$comment === !0) e.code((0, c._)`${l.default.self}.logger.log(${a})`);
		else if (typeof i.$comment == "function") {
			let n = (0, c.str)`${r}/$comment`, i = e.scopeValue("root", { ref: t.root });
			e.code((0, c._)`${l.default.self}.opts.$comment(${a}, ${n}, ${i}.schema)`);
		}
	}
	function se(e) {
		let { gen: t, schemaEnv: n, validateName: r, ValidationError: i, opts: a } = e;
		n.$async ? t.if((0, c._)`${l.default.errors} === 0`, () => t.return(l.default.data), () => t.throw((0, c._)`new ${i}(${l.default.vErrors})`)) : (t.assign((0, c._)`${r}.errors`, l.default.vErrors), a.unevaluated && ce(e), t.return((0, c._)`${l.default.errors} === 0`));
	}
	function ce({ gen: e, evaluated: t, props: n, items: r }) {
		n instanceof c.Name && e.assign((0, c._)`${t}.props`, n), r instanceof c.Name && e.assign((0, c._)`${t}.items`, r);
	}
	function le(e, t, n, a) {
		let { gen: o, schema: s, data: u, allErrors: f, opts: p, self: m } = e, { RULES: h } = m;
		if (s.$ref && (p.ignoreKeywordsWithRef || !(0, d.schemaHasRulesButRef)(s, h))) {
			o.block(() => be(e, "$ref", h.all.$ref.definition));
			return;
		}
		p.jtd || de(e, t), o.block(() => {
			for (let e of h.rules) g(e);
			g(h.post);
		});
		function g(d) {
			(0, r.shouldUseGroup)(s, d) && (d.type ? (o.if((0, i.checkDataType)(d.type, u, p.strictNumbers)), ue(e, d), t.length === 1 && t[0] === d.type && n && (o.else(), (0, i.reportTypeError)(e)), o.endIf()) : ue(e, d), f || o.if((0, c._)`${l.default.errors} === ${a || 0}`));
		}
	}
	function ue(e, t) {
		let { gen: n, schema: i, opts: { useDefaults: o } } = e;
		o && (0, a.assignDefaults)(e, t.type), n.block(() => {
			for (let n of t.rules) (0, r.shouldUseRule)(i, n) && be(e, n.keyword, n.definition, t.type);
		});
	}
	function de(e, t) {
		e.schemaEnv.meta || !e.opts.strictTypes || (fe(e, t), e.opts.allowUnionTypes || pe(e, t), me(e, e.dataTypes));
	}
	function fe(e, t) {
		if (t.length) {
			if (!e.dataTypes.length) {
				e.dataTypes = t;
				return;
			}
			t.forEach((t) => {
				ge(e.dataTypes, t) || ve(e, `type "${t}" not allowed by context "${e.dataTypes.join(",")}"`);
			}), _e(e, t);
		}
	}
	function pe(e, t) {
		t.length > 1 && !(t.length === 2 && t.includes("null")) && ve(e, "use allowUnionTypes to allow union type keyword");
	}
	function me(e, t) {
		let n = e.self.RULES.all;
		for (let i in n) {
			let a = n[i];
			if (typeof a == "object" && (0, r.shouldUseRule)(e.schema, a)) {
				let { type: n } = a.definition;
				n.length && !n.some((e) => he(t, e)) && ve(e, `missing type "${n.join(",")}" for keyword "${i}"`);
			}
		}
	}
	function he(e, t) {
		return e.includes(t) || t === "number" && e.includes("integer");
	}
	function ge(e, t) {
		return e.includes(t) || t === "integer" && e.includes("number");
	}
	function _e(e, t) {
		let n = [];
		for (let r of e.dataTypes) ge(t, r) ? n.push(r) : t.includes("integer") && r === "number" && n.push("integer");
		e.dataTypes = n;
	}
	function ve(e, t) {
		let n = e.schemaEnv.baseId + e.errSchemaPath;
		t += ` at "${n}" (strictTypes)`, (0, d.checkStrictMode)(e, t, e.opts.strictTypes);
	}
	var ye = class {
		constructor(e, t, n) {
			if ((0, o.validateKeywordUsage)(e, t, n), this.gen = e.gen, this.allErrors = e.allErrors, this.keyword = n, this.data = e.data, this.schema = e.schema[n], this.$data = t.$data && e.opts.$data && this.schema && this.schema.$data, this.schemaValue = (0, d.schemaRefOrVal)(e, this.schema, n, this.$data), this.schemaType = t.schemaType, this.parentSchema = e.schema, this.params = {}, this.it = e, this.def = t, this.$data) this.schemaCode = e.gen.const("vSchema", w(this.$data, e));
			else if (this.schemaCode = this.schemaValue, !(0, o.validSchemaType)(this.schema, t.schemaType, t.allowUndefined)) throw Error(`${n} value must be ${JSON.stringify(t.schemaType)}`);
			("code" in t ? t.trackErrors : t.errors !== !1) && (this.errsCount = e.gen.const("_errs", l.default.errors));
		}
		result(e, t, n) {
			this.failResult((0, c.not)(e), t, n);
		}
		failResult(e, t, n) {
			this.gen.if(e), n ? n() : this.error(), t ? (this.gen.else(), t(), this.allErrors && this.gen.endIf()) : this.allErrors ? this.gen.endIf() : this.gen.else();
		}
		pass(e, t) {
			this.failResult((0, c.not)(e), void 0, t);
		}
		fail(e) {
			if (e === void 0) {
				this.error(), this.allErrors || this.gen.if(!1);
				return;
			}
			this.gen.if(e), this.error(), this.allErrors ? this.gen.endIf() : this.gen.else();
		}
		fail$data(e) {
			if (!this.$data) return this.fail(e);
			let { schemaCode: t } = this;
			this.fail((0, c._)`${t} !== undefined && (${(0, c.or)(this.invalid$data(), e)})`);
		}
		error(e, t, n) {
			if (t) {
				this.setParams(t), this._error(e, n), this.setParams({});
				return;
			}
			this._error(e, n);
		}
		_error(e, t) {
			(e ? f.reportExtraError : f.reportError)(this, this.def.error, t);
		}
		$dataError() {
			(0, f.reportError)(this, this.def.$dataError || f.keyword$DataError);
		}
		reset() {
			if (this.errsCount === void 0) throw Error("add \"trackErrors\" to keyword definition");
			(0, f.resetErrorsCount)(this.gen, this.errsCount);
		}
		ok(e) {
			this.allErrors || this.gen.if(e);
		}
		setParams(e, t) {
			t ? Object.assign(this.params, e) : this.params = e;
		}
		block$data(e, t, n = c.nil) {
			this.gen.block(() => {
				this.check$data(e, n), t();
			});
		}
		check$data(e = c.nil, t = c.nil) {
			if (!this.$data) return;
			let { gen: n, schemaCode: r, schemaType: i, def: a } = this;
			n.if((0, c.or)((0, c._)`${r} === undefined`, t)), e !== c.nil && n.assign(e, !0), (i.length || a.validateSchema) && (n.elseIf(this.invalid$data()), this.$dataError(), e !== c.nil && n.assign(e, !1)), n.else();
		}
		invalid$data() {
			let { gen: e, schemaCode: t, schemaType: n, def: r, it: a } = this;
			return (0, c.or)(o(), s());
			function o() {
				if (n.length) {
					/* istanbul ignore if */
					if (!(t instanceof c.Name)) throw Error("ajv implementation error");
					let e = Array.isArray(n) ? n : [n];
					return (0, c._)`${(0, i.checkDataTypes)(e, t, a.opts.strictNumbers, i.DataType.Wrong)}`;
				}
				return c.nil;
			}
			function s() {
				if (r.validateSchema) {
					let n = e.scopeValue("validate$data", { ref: r.validateSchema });
					return (0, c._)`!${n}(${t})`;
				}
				return c.nil;
			}
		}
		subschema(e, t) {
			let n = (0, s.getSubschema)(this.it, e);
			(0, s.extendSubschemaData)(n, this.it, e), (0, s.extendSubschemaMode)(n, e);
			let r = {
				...this.it,
				...n,
				items: void 0,
				props: void 0
			};
			return b(r, t), r;
		}
		mergeEvaluated(e, t) {
			let { it: n, gen: r } = this;
			n.opts.unevaluated && (n.props !== !0 && e.props !== void 0 && (n.props = d.mergeEvaluated.props(r, e.props, n.props, t)), n.items !== !0 && e.items !== void 0 && (n.items = d.mergeEvaluated.items(r, e.items, n.items, t)));
		}
		mergeValidEvaluated(e, t) {
			let { it: n, gen: r } = this;
			if (n.opts.unevaluated && (n.props !== !0 || n.items !== !0)) return r.if(t, () => this.mergeEvaluated(e, c.Name)), !0;
		}
	};
	e.KeywordCxt = ye;
	function be(e, t, n, r) {
		let i = new ye(e, n, t);
		"code" in n ? n.code(i, r) : i.$data && n.validate ? (0, o.funcKeywordCode)(i, n) : "macro" in n ? (0, o.macroKeywordCode)(i, n) : (n.compile || n.validate) && (0, o.funcKeywordCode)(i, n);
	}
	var xe = /^\/(?:[^~]|~0|~1)*$/, Se = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
	function w(e, { dataLevel: t, dataNames: n, dataPathArr: r }) {
		let i, a;
		if (e === "") return l.default.rootData;
		if (e[0] === "/") {
			if (!xe.test(e)) throw Error(`Invalid JSON-pointer: ${e}`);
			i = e, a = l.default.rootData;
		} else {
			let o = Se.exec(e);
			if (!o) throw Error(`Invalid JSON-pointer: ${e}`);
			let s = +o[1];
			if (i = o[2], i === "#") {
				if (s >= t) throw Error(u("property/index", s));
				return r[t - s];
			}
			if (s > t) throw Error(u("data", s));
			if (a = n[t - s], !i) return a;
		}
		let o = a, s = i.split("/");
		for (let e of s) e && (a = (0, c._)`${a}${(0, c.getProperty)((0, d.unescapeJsonPointer)(e))}`, o = (0, c._)`${o} && ${a}`);
		return o;
		function u(e, n) {
			return `Cannot access ${e} ${n} levels up, current level is ${t}`;
		}
	}
	e.getData = w;
})), nf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.default = class extends Error {
		constructor(e) {
			super("validation failed"), this.errors = e, this.ajv = this.validation = !0;
		}
	};
})), rf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = ef();
	e.default = class extends Error {
		constructor(e, n, r, i) {
			super(i || `can't resolve reference ${r} from id ${n}`), this.missingRef = (0, t.resolveUrl)(e, n, r), this.missingSchema = (0, t.normalizeId)((0, t.getFullPath)(e, this.missingRef));
		}
	};
})), af = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.resolveSchema = e.getCompilingSchema = e.resolveRef = e.compileSchema = e.SchemaEnv = void 0;
	var t = X(), n = nf(), r = Hd(), i = ef(), a = Z(), o = tf(), s = class {
		constructor(e) {
			this.refs = {}, this.dynamicAnchors = {};
			let t;
			typeof e.schema == "object" && (t = e.schema), this.schema = e.schema, this.schemaId = e.schemaId, this.root = e.root || this, this.baseId = e.baseId ?? (0, i.normalizeId)(t?.[e.schemaId || "$id"]), this.schemaPath = e.schemaPath, this.localRefs = e.localRefs, this.meta = e.meta, this.$async = t?.$async, this.refs = {};
		}
	};
	e.SchemaEnv = s;
	function c(e) {
		let a = d.call(this, e);
		if (a) return a;
		let s = (0, i.getFullPath)(this.opts.uriResolver, e.root.baseId), { es5: c, lines: l } = this.opts.code, { ownProperties: u } = this.opts, f = new t.CodeGen(this.scope, {
			es5: c,
			lines: l,
			ownProperties: u
		}), p;
		e.$async && (p = f.scopeValue("Error", {
			ref: n.default,
			code: (0, t._)`require("ajv/dist/runtime/validation_error").default`
		}));
		let m = f.scopeName("validate");
		e.validateName = m;
		let h = {
			gen: f,
			allErrors: this.opts.allErrors,
			data: r.default.data,
			parentData: r.default.parentData,
			parentDataProperty: r.default.parentDataProperty,
			dataNames: [r.default.data],
			dataPathArr: [t.nil],
			dataLevel: 0,
			dataTypes: [],
			definedProperties: /* @__PURE__ */ new Set(),
			topSchemaRef: f.scopeValue("schema", this.opts.code.source === !0 ? {
				ref: e.schema,
				code: (0, t.stringify)(e.schema)
			} : { ref: e.schema }),
			validateName: m,
			ValidationError: p,
			schema: e.schema,
			schemaEnv: e,
			rootId: s,
			baseId: e.baseId || s,
			schemaPath: t.nil,
			errSchemaPath: e.schemaPath || (this.opts.jtd ? "" : "#"),
			errorPath: (0, t._)`""`,
			opts: this.opts,
			self: this
		}, g;
		try {
			this._compilations.add(e), (0, o.validateFunctionCode)(h), f.optimize(this.opts.code.optimize);
			let n = f.toString();
			g = `${f.scopeRefs(r.default.scope)}return ${n}`, this.opts.code.process && (g = this.opts.code.process(g, e));
			let i = Function(`${r.default.self}`, `${r.default.scope}`, g)(this, this.scope.get());
			if (this.scope.value(m, { ref: i }), i.errors = null, i.schema = e.schema, i.schemaEnv = e, e.$async && (i.$async = !0), this.opts.code.source === !0 && (i.source = {
				validateName: m,
				validateCode: n,
				scopeValues: f._values
			}), this.opts.unevaluated) {
				let { props: e, items: n } = h;
				i.evaluated = {
					props: e instanceof t.Name ? void 0 : e,
					items: n instanceof t.Name ? void 0 : n,
					dynamicProps: e instanceof t.Name,
					dynamicItems: n instanceof t.Name
				}, i.source && (i.source.evaluated = (0, t.stringify)(i.evaluated));
			}
			return e.validate = i, e;
		} catch (t) {
			throw delete e.validate, delete e.validateName, g && this.logger.error("Error compiling schema, function code:", g), t;
		} finally {
			this._compilations.delete(e);
		}
	}
	e.compileSchema = c;
	function l(e, t, n) {
		n = (0, i.resolveUrl)(this.opts.uriResolver, t, n);
		let r = e.refs[n];
		if (r) return r;
		let a = p.call(this, e, n);
		if (a === void 0) {
			let r = e.localRefs?.[n], { schemaId: i } = this.opts;
			r && (a = new s({
				schema: r,
				schemaId: i,
				root: e,
				baseId: t
			}));
		}
		if (a !== void 0) return e.refs[n] = u.call(this, a);
	}
	e.resolveRef = l;
	function u(e) {
		return (0, i.inlineRef)(e.schema, this.opts.inlineRefs) ? e.schema : e.validate ? e : c.call(this, e);
	}
	function d(e) {
		for (let t of this._compilations) if (f(t, e)) return t;
	}
	e.getCompilingSchema = d;
	function f(e, t) {
		return e.schema === t.schema && e.root === t.root && e.baseId === t.baseId;
	}
	function p(e, t) {
		let n;
		for (; typeof (n = this.refs[t]) == "string";) t = n;
		return n || this.schemas[t] || m.call(this, e, t);
	}
	function m(e, t) {
		let n = this.opts.uriResolver.parse(t), r = (0, i._getFullPath)(this.opts.uriResolver, n), a = (0, i.getFullPath)(this.opts.uriResolver, e.baseId, void 0);
		if (Object.keys(e.schema).length > 0 && r === a) return g.call(this, n, e);
		let o = (0, i.normalizeId)(r), l = this.refs[o] || this.schemas[o];
		if (typeof l == "string") {
			let t = m.call(this, e, l);
			return typeof t?.schema == "object" ? g.call(this, n, t) : void 0;
		}
		if (typeof l?.schema == "object") {
			if (l.validate || c.call(this, l), o === (0, i.normalizeId)(t)) {
				let { schema: t } = l, { schemaId: n } = this.opts, r = t[n];
				return r && (a = (0, i.resolveUrl)(this.opts.uriResolver, a, r)), new s({
					schema: t,
					schemaId: n,
					root: e,
					baseId: a
				});
			}
			return g.call(this, n, l);
		}
	}
	e.resolveSchema = m;
	var h = /* @__PURE__ */ new Set([
		"properties",
		"patternProperties",
		"enum",
		"dependencies",
		"definitions"
	]);
	function g(e, { baseId: t, schema: n, root: r }) {
		if (e.fragment?.[0] !== "/") return;
		for (let r of e.fragment.slice(1).split("/")) {
			if (typeof n == "boolean") return;
			let e = n[(0, a.unescapeFragment)(r)];
			if (e === void 0) return;
			n = e;
			let o = typeof n == "object" && n[this.opts.schemaId];
			!h.has(r) && o && (t = (0, i.resolveUrl)(this.opts.uriResolver, t, o));
		}
		let o;
		if (typeof n != "boolean" && n.$ref && !(0, a.schemaHasRulesButRef)(n, this.RULES)) {
			let e = (0, i.resolveUrl)(this.opts.uriResolver, t, n.$ref);
			o = m.call(this, r, e);
		}
		let { schemaId: c } = this.opts;
		if (o ||= new s({
			schema: n,
			schemaId: c,
			root: r,
			baseId: t
		}), o.schema !== o.root.schema) return o;
	}
})), of = /* @__PURE__ */ i({
	$id: () => sf,
	additionalProperties: () => !1,
	default: () => ff,
	description: () => cf,
	properties: () => df,
	required: () => uf,
	type: () => lf
}), sf, cf, lf, uf, df, ff, pf = n((() => {
	sf = "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#", cf = "Meta-schema for $data reference (JSON AnySchema extension proposal)", lf = "object", uf = ["$data"], df = { $data: {
		type: "string",
		anyOf: [{ format: "relative-json-pointer" }, { format: "json-pointer" }]
	} }, ff = {
		$id: sf,
		description: cf,
		type: lf,
		required: uf,
		properties: df,
		additionalProperties: !1
	};
})), mf = /* @__PURE__ */ a(((e, t) => {
	var n = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu), r = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u), i = RegExp.prototype.test.bind(/^[\da-f]{2}$/iu), a = RegExp.prototype.test.bind(/^[\da-z\-._~]$/iu), o = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:@/]$/u), s = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:@/?]$/u), c = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:]$/u), l = Array(256);
	{
		let e = "0123456789ABCDEF";
		for (let t = 0; t < 256; t++) l[t] = "%" + e[t >> 4] + e[t & 15];
	}
	function u(e) {
		return e < 2048 ? l[192 | e >> 6] + l[128 | e & 63] : e < 65536 ? l[224 | e >> 12] + l[128 | e >> 6 & 63] + l[128 | e & 63] : l[240 | e >> 18] + l[128 | e >> 12 & 63] + l[128 | e >> 6 & 63] + l[128 | e & 63];
	}
	function d(e) {
		let t = "", n = 0, r = 0;
		for (r = 0; r < e.length; r++) if (n = e[r].charCodeAt(0), n !== 48) {
			if (!(n >= 48 && n <= 57 || n >= 65 && n <= 70 || n >= 97 && n <= 102)) return "";
			t += e[r];
			break;
		}
		for (r += 1; r < e.length; r++) {
			if (n = e[r].charCodeAt(0), !(n >= 48 && n <= 57 || n >= 65 && n <= 70 || n >= 97 && n <= 102)) return "";
			t += e[r];
		}
		return t;
	}
	var f = RegExp.prototype.test.bind(/^[\dA-Fa-f]{1,4}$/), p = RegExp.prototype.test.bind(/^[vV][\dA-Fa-f]+\.[A-Za-z\d\-._~!$&'()*+,;=:]+$/), m = RegExp.prototype.test.bind(/^[A-Za-z\d\-._~]$/), h = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
	function g(e) {
		if (e.length === 0) return !1;
		for (let t = 0; t < e.length; t++) if (!m(e[t])) {
			if (e[t] === "%" && t + 2 < e.length && i(e.slice(t + 1, t + 3))) {
				t += 2;
				continue;
			}
			return !1;
		}
		return !0;
	}
	function _(e) {
		let t = -1, n = 0, r = -1, i = 0;
		for (let a = 0; a < e.length; a++) e[a] === "0" ? (r === -1 && (r = a), i++, i > n && (n = i, t = r)) : (r = -1, i = 0);
		if (n < 2) return e.join(":");
		let a = e.slice(0, t).join(":"), o = e.slice(t + n).join(":");
		return a + "::" + o;
	}
	function v(e) {
		let t = e.indexOf("::");
		if (t !== -1 && e.indexOf("::", t + 1) !== -1) return;
		let n = t === -1 ? e.split(":") : e.slice(0, t).split(":"), i = t === -1 ? [] : e.slice(t + 2).split(":");
		t !== -1 && (n.length === 1 && n[0] === "" && (n.length = 0), i.length === 1 && i[0] === "" && (i.length = 0));
		let a = n.concat(i), o = 0;
		for (let e = 0; e < a.length; e++) {
			let n = a[e];
			if (n === "") return;
			if (n.indexOf(".") !== -1) {
				if (e !== a.length - 1 || t !== -1 && i.length === 0 || !r(n)) return;
				o += 2;
				continue;
			}
			if (!f(n)) return;
			a[e] = parseInt(n, 16).toString(16), o++;
		}
		if (t === -1) return o === 8 ? _(a) : void 0;
		if (o >= 8) return;
		let s = a.slice(0, n.length);
		for (let e = o; e < 8; e++) s.push("0");
		for (let e = n.length; e < a.length; e++) s.push(a[e]);
		return _(s);
	}
	function y(e) {
		let t = e[0] === "[" && e[e.length - 1] === "]";
		if ((e[0] === "[" || e[e.length - 1] === "]") && !t) return {
			host: e,
			isIPV6: !1,
			error: !0
		};
		let n = t ? e.slice(1, -1) : e;
		if (t && p(n)) return n = n.toLowerCase(), {
			host: `[${n}]`,
			escapedHost: n,
			isIPV6: !1,
			isIPVFuture: !0
		};
		if (b(n, ":") < 2) return {
			host: e,
			isIPV6: !1,
			error: t
		};
		let r = "", i = n.indexOf("%");
		if (i !== -1) {
			let t = n.slice(i, i + 3).toLowerCase() === "%25" ? 3 : 1;
			if (r = n.slice(i + t), !g(r)) return {
				host: e,
				isIPV6: !1,
				error: !0
			};
			n = n.slice(0, i);
		}
		let a = v(n);
		return a === void 0 ? {
			host: e,
			isIPV6: !1,
			error: !0
		} : {
			host: a + (r ? "%" + r : ""),
			escapedHost: a + (r ? "%25" + r : ""),
			isIPV6: !0
		};
	}
	function b(e, t) {
		let n = 0;
		for (let r = 0; r < e.length; r++) e[r] === t && n++;
		return n;
	}
	function x(e) {
		let t = e, n = [], r = -1, i = 0;
		for (; i = t.length;) {
			if (i === 1) {
				if (t === ".") break;
				if (t === "/") {
					n.push("/");
					break;
				}
				n.push(t);
				break;
			}
			if (i === 2) {
				if (t[0] === ".") {
					if (t[1] === ".") break;
					if (t[1] === "/") {
						t = t.slice(2);
						continue;
					}
				} else if (t[0] === "/" && (t[1] === "." || t[1] === "/")) {
					n.push("/");
					break;
				}
			} else if (i === 3 && t === "/..") {
				n.length !== 0 && n.pop(), n.push("/");
				break;
			}
			if (t[0] === ".") {
				if (t[1] === ".") {
					if (t[2] === "/") {
						t = t.slice(3);
						continue;
					}
				} else if (t[1] === "/") {
					t = t.slice(2);
					continue;
				}
			} else if (t[0] === "/" && t[1] === ".") {
				if (t[2] === "/") {
					t = t.slice(2);
					continue;
				}
				if (t[2] === "." && t[3] === "/") {
					t = t.slice(3), n.length !== 0 && n.pop();
					continue;
				}
			}
			if ((r = t.indexOf("/", 1)) === -1) {
				n.push(t);
				break;
			}
			n.push(t.slice(0, r)), t = t.slice(r);
		}
		return n.join("");
	}
	var S = {
		"@": "%40",
		"/": "%2F",
		"?": "%3F",
		"#": "%23",
		":": "%3A"
	}, C = /[@/?#:]/g, ee = /[@/?#]/g;
	function te(e, t) {
		let n = t ? ee : C;
		return n.lastIndex = 0, e.replace(n, (e) => S[e]);
	}
	function ne(e, t = !1) {
		if (e.indexOf("%") === -1) return e;
		let n = "";
		for (let r = 0; r < e.length; r++) {
			if (e[r] === "%" && r + 2 < e.length) {
				let o = e.slice(r + 1, r + 3);
				if (i(o)) {
					let e = o.toUpperCase(), i = String.fromCharCode(parseInt(e, 16));
					t && a(i) ? n += i : n += "%" + e, r += 2;
					continue;
				}
			}
			n += e[r];
		}
		return n;
	}
	function re(e) {
		let t = "";
		for (let n = 0; n < e.length; n++) {
			let r = e[n];
			if (r === "%" && n + 2 < e.length) {
				let r = e.slice(n + 1, n + 3);
				if (i(r)) {
					let e = r.toUpperCase(), i = String.fromCharCode(parseInt(e, 16));
					i !== "." && a(i) ? t += i : t += "%" + e, n += 2;
					continue;
				}
			}
			if (o(r)) t += r;
			else {
				let i = e.charCodeAt(n);
				if (i < 128) t += le(i) ? r : l[i];
				else if (i < 55296 || i > 57343) t += u(i);
				else if (i <= 56319 && n + 1 < e.length) {
					let r = e.charCodeAt(n + 1);
					r >= 56320 && r <= 57343 ? (t += u(65536 + (i - 55296 << 10) + (r - 56320)), n++) : t += u(65533);
				} else t += u(65533);
			}
		}
		return t;
	}
	function ie(e, t = !1) {
		let n = "", r = t && e[0] !== "/";
		for (let t = 0; t < e.length; t++) {
			let a = e[t];
			if (a === "%" && t + 2 < e.length) {
				let r = e.slice(t + 1, t + 3);
				if (i(r)) {
					n += "%" + r.toUpperCase(), t += 2;
					continue;
				}
			}
			if (a === "/" && (r = !1), o(a) && (a !== ":" || !r)) n += a;
			else {
				let r = e.charCodeAt(t);
				if (r < 128) n += l[r];
				else if (r < 55296 || r > 57343) n += u(r);
				else if (r <= 56319 && t + 1 < e.length) {
					let i = e.charCodeAt(t + 1);
					i >= 56320 && i <= 57343 ? (n += u(65536 + (r - 55296 << 10) + (i - 56320)), t++) : n += u(65533);
				} else n += u(65533);
			}
		}
		return n;
	}
	function ae(e, t) {
		let n = "";
		for (let r = 0; r < e.length; r++) {
			let a = e[r];
			if (a === "%" && r + 2 < e.length) {
				let t = e.slice(r + 1, r + 3);
				if (i(t)) {
					n += "%" + t.toUpperCase(), r += 2;
					continue;
				}
			}
			if (t(a)) n += a;
			else {
				let t = e.charCodeAt(r);
				if (t < 128) n += l[t];
				else if (t < 55296 || t > 57343) n += u(t);
				else if (t <= 56319 && r + 1 < e.length) {
					let i = e.charCodeAt(r + 1);
					i >= 56320 && i <= 57343 ? (n += u(65536 + (t - 55296 << 10) + (i - 56320)), r++) : n += u(65533);
				} else n += u(65533);
			}
		}
		return n;
	}
	function oe(e) {
		return ae(e, c);
	}
	function se(e) {
		return ae(e, s);
	}
	function ce(e) {
		return ae(e, s);
	}
	function le(e) {
		return e >= 48 && e <= 57 || e >= 65 && e <= 90 || e >= 97 && e <= 122 || e === 42 || e === 43 || e === 45 || e === 46 || e === 47 || e === 64 || e === 95;
	}
	function ue(e) {
		let t = "";
		for (let n = 0; n < e.length; n++) {
			let r = e[n];
			if (r === "%" && n + 2 < e.length) {
				let r = e.slice(n + 1, n + 3);
				if (i(r)) {
					let e = r.toUpperCase(), i = String.fromCharCode(parseInt(e, 16));
					a(i) ? t += i : t += "%" + e, n += 2;
					continue;
				}
			}
			if (s(r)) t += r;
			else {
				let i = e.charCodeAt(n);
				if (i < 128) t += le(i) ? r : l[i];
				else if (i < 55296 || i > 57343) t += u(i);
				else if (i <= 56319 && n + 1 < e.length) {
					let r = e.charCodeAt(n + 1);
					r >= 56320 && r <= 57343 ? (t += u(65536 + (i - 55296 << 10) + (r - 56320)), n++) : t += u(65533);
				} else t += u(65533);
			}
		}
		return t;
	}
	function de(e) {
		let t = "";
		for (let n = 0; n < e.length; n++) {
			if (e[n] === "%" && n + 2 < e.length) {
				let r = e.slice(n + 1, n + 3);
				if (i(r)) {
					t += "%" + r.toUpperCase(), n += 2;
					continue;
				}
			}
			t += escape(e[n]);
		}
		return t;
	}
	function fe(e) {
		let t = [];
		if (e.userinfo !== void 0 && (t.push(oe(e.userinfo)), t.push("@")), e.host !== void 0) {
			let n = e.host;
			if (!r(n)) {
				let e = y(n);
				e.isIPV6 !== !0 && e.isIPVFuture !== !0 && (n = ne(n, !0), e = y(n)), n = e.isIPV6 === !0 || e.isIPVFuture === !0 ? `[${e.escapedHost}]` : te(n, !1);
			}
			t.push(n);
		}
		return (typeof e.port == "number" || typeof e.port == "string") && (t.push(":"), t.push(String(e.port))), t.length ? t.join("") : void 0;
	}
	t.exports = {
		nonSimpleDomain: h,
		recomposeAuthority: fe,
		reescapeHostDelimiters: te,
		normalizePercentEncoding: ne,
		normalizePathEncoding: re,
		serializePathEncoding: ie,
		normalizeQueryFragmentEncoding: ue,
		encodeUserinfo: oe,
		encodeQuery: se,
		encodeFragment: ce,
		escapePreservingEscapes: de,
		removeDotSegments: x,
		isIPv4: r,
		isUUID: n,
		normalizeIPv6: y,
		stringArrayToHexStripped: d
	};
})), hf = /* @__PURE__ */ a(((e, t) => {
	var { isUUID: n } = mf(), r = /^([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-./:;=@]|%[\da-f]{2})+)$/iu, i = [
		"http",
		"https",
		"ws",
		"wss",
		"urn",
		"urn:uuid"
	];
	function a(e) {
		return i.indexOf(e) !== -1;
	}
	function o(e) {
		return e.secure === !0 ? !0 : e.secure === !1 ? !1 : e.scheme ? e.scheme.length === 3 && (e.scheme[0] === "w" || e.scheme[0] === "W") && (e.scheme[1] === "s" || e.scheme[1] === "S") && (e.scheme[2] === "s" || e.scheme[2] === "S") : !1;
	}
	function s(e) {
		return e.host || (e.error = e.error || "HTTP URIs must have a host."), e;
	}
	function c(e) {
		let t = String(e.scheme).toLowerCase() === "https";
		return (e.port === (t ? 443 : 80) || e.port === "") && (e.port = void 0), e.path ||= "/", e;
	}
	function l(e) {
		return e.secure = o(e), e.resourceName = (e.path || "/") + (e.query ? "?" + e.query : ""), e.path = void 0, e.query = void 0, e;
	}
	function u(e) {
		if ((e.port === (o(e) ? 443 : 80) || e.port === "") && (e.port = void 0), typeof e.secure == "boolean" && (e.scheme = e.secure ? "wss" : "ws", e.secure = void 0), e.resourceName) {
			let t = e.resourceName.indexOf("?"), n = t === -1 ? e.resourceName : e.resourceName.slice(0, t);
			e.path = n && n !== "/" ? n : void 0, e.query = t === -1 ? void 0 : e.resourceName.slice(t + 1), e.resourceName = void 0;
		}
		return e.fragment = void 0, e;
	}
	function d(e, t) {
		if (!e.path) return e.error = "URN can not be parsed", e;
		let n = e.path.match(r);
		if (n && n[0] === e.path) {
			let r = t.scheme || e.scheme || "urn";
			e.nid = n[1].toLowerCase(), e.nss = n[2];
			let i = y(`${r}:${t.nid || e.nid}`);
			e.path = void 0, i && (e = i.parse(e, t));
		} else e.error = e.error || "URN can not be parsed.";
		return e;
	}
	function f(e, t) {
		if (e.nid === void 0) throw Error("URN without nid cannot be serialized");
		let n = t.scheme || e.scheme || "urn", r = e.nid.toLowerCase(), i = y(`${n}:${t.nid || r}`);
		i && (e = i.serialize(e, t));
		let a = e, o = e.nss;
		return a.path = `${r || t.nid}:${o}`, t.skipEscape = !0, a;
	}
	function p(e, t) {
		let r = e;
		return r.uuid = r.nss, r.nss = void 0, !t.tolerant && (!r.uuid || !n(r.uuid)) && (r.error = r.error || "UUID is not valid."), r;
	}
	function m(e) {
		let t = e;
		return t.nss = (e.uuid || "").toLowerCase(), t;
	}
	var h = {
		scheme: "http",
		domainHost: !0,
		parse: s,
		serialize: c
	}, g = {
		scheme: "https",
		domainHost: h.domainHost,
		parse: s,
		serialize: c
	}, _ = {
		scheme: "ws",
		domainHost: !0,
		parse: l,
		serialize: u
	}, v = {
		http: h,
		https: g,
		ws: _,
		wss: {
			scheme: "wss",
			domainHost: _.domainHost,
			parse: _.parse,
			serialize: _.serialize
		},
		urn: {
			scheme: "urn",
			parse: d,
			serialize: f,
			skipNormalize: !0
		},
		"urn:uuid": {
			scheme: "urn:uuid",
			parse: p,
			serialize: m,
			skipNormalize: !0
		}
	};
	Object.setPrototypeOf(v, null);
	function y(e) {
		return e && (v[e] || v[e.toLowerCase()]) || void 0;
	}
	t.exports = {
		wsIsSecure: o,
		SCHEMES: v,
		isValidSchemeName: a,
		getSchemeHandler: y
	};
})), gf = /* @__PURE__ */ a(((e, t) => {
	var { normalizeIPv6: n, removeDotSegments: r, recomposeAuthority: i, normalizePercentEncoding: a, normalizePathEncoding: o, serializePathEncoding: s, normalizeQueryFragmentEncoding: c, encodeQuery: l, encodeFragment: u, reescapeHostDelimiters: d, isIPv4: f, nonSimpleDomain: p } = mf(), { SCHEMES: m, getSchemeHandler: h } = hf(), g = /^[A-Za-z][A-Za-z0-9+.-]*$/u, _ = "URI scheme is malformed.";
	function v(e) {
		let t = unescape(String(e));
		if (!g.test(t)) throw TypeError(_);
		return t;
	}
	function y(e, t) {
		return typeof e == "string" ? e = le(e, t) : typeof e == "object" && (e = ce(C(e, t), t)), e;
	}
	function b(e, t, r) {
		let i = r ? Object.assign({ scheme: "null" }, r) : { scheme: "null" }, { parsed: a, malformedAuthorityOrPort: o, malformedPercentEncoding: s, malformedSchemeSpecific: c, malformedHost: l, malformedScheme: u } = se(e, i), { parsed: d, malformedAuthorityOrPort: p, malformedPercentEncoding: m, malformedSchemeSpecific: g, malformedHost: _, malformedScheme: v } = se(t, i);
		if (o || p || s || m || c || g || l || _ || u || v) throw Error(a.error || d.error || "URI is malformed.");
		let y = x(a, d, i, !0), b = h(r && r.scheme || y.scheme), S = y.host, ee = S !== void 0 && S !== "" && (f(S) || n(S).isIPV6);
		oe(y, r || {}, b, ee);
		let te = S && S.indexOf("%") !== -1 && !/\P{ASCII}/u.test(S);
		if (y.error && !te) throw Error(y.error);
		return i.skipEscape = !0, C(y, i);
	}
	function x(e, t, n, i) {
		let a = {};
		return i || (e = ce(C(e, n), n), t = ce(C(t, n), n)), n ||= {}, !n.tolerant && t.scheme ? (a.scheme = t.scheme, a.userinfo = t.userinfo, a.host = t.host, a.port = t.port, a.path = r(t.path || ""), a.query = t.query) : (t.userinfo !== void 0 || t.host !== void 0 || t.port !== void 0 ? (a.userinfo = t.userinfo, a.host = t.host, a.port = t.port, a.path = r(t.path || ""), a.query = t.query) : (t.path ? (t.path[0] === "/" ? a.path = r(t.path) : (a.path = (e.userinfo !== void 0 || e.host !== void 0 || e.port !== void 0) && !e.path ? "/" + t.path : e.path ? e.path.slice(0, e.path.lastIndexOf("/") + 1) + t.path : t.path, a.path = r(a.path)), a.query = t.query) : (a.path = e.path, a.query = t.query === void 0 ? e.query : t.query), a.userinfo = e.userinfo, a.host = e.host, a.port = e.port), a.scheme = e.scheme), a.fragment = t.fragment, a;
	}
	function S(e, t, n) {
		let r = de(e, n), i = de(t, n);
		return r !== void 0 && i !== void 0 && r === i;
	}
	function C(e, t) {
		let n = {
			host: e.host,
			scheme: e.scheme,
			userinfo: e.userinfo,
			port: e.port,
			path: e.path,
			query: e.query,
			nid: e.nid,
			nss: e.nss,
			uuid: e.uuid,
			fragment: e.fragment,
			reference: e.reference,
			resourceName: e.resourceName,
			secure: e.secure,
			error: ""
		}, o = Object.assign({}, t), c = [];
		n.scheme &&= v(n.scheme);
		let d = h(o.scheme || n.scheme);
		d && d.serialize && d.serialize(n, o);
		let f = n.userinfo !== void 0 || n.host !== void 0 || n.port !== void 0, p = !o.skipEscape && n.scheme === void 0 && !f;
		n.path !== void 0 && (n.path = o.skipEscape ? a(n.path) : s(n.path, p)), o.reference !== "suffix" && n.scheme && (n.scheme = v(n.scheme), c.push(n.scheme, ":"));
		let m = i(n);
		if (m !== void 0 && (o.reference !== "suffix" && c.push("//"), c.push(m), n.path && n.path[0] !== "/" && c.push("/")), n.path !== void 0) {
			let e = n.path;
			!o.absolutePath && (!d || !d.absolutePath) && (e = r(e)), p && (e = s(e, !0)), m === void 0 && e[0] === "/" && e[1] === "/" && (e = "/%2F" + e.slice(2)), c.push(e);
		}
		return n.query !== void 0 && c.push("?", l(n.query)), n.fragment !== void 0 && c.push("#", u(n.fragment)), c.join("");
	}
	var ee = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u, te = /^(?:[^#/:?]+:)?\/\/([^/?#]*)/, ne = /^(?:[^#/:?]+:)?([/\\\t\n\r]*)/;
	function re(e, t) {
		if (t[2] !== void 0 && e.path && e.path[0] !== "/") return "URI path must start with \"/\" when authority is present.";
		if (typeof e.port == "number" && (e.port < 0 || e.port > 65535)) return "URI port is malformed.";
	}
	function ie(e) {
		if (e === void 0) return !1;
		let t = e.indexOf("%");
		for (; t !== -1;) {
			if (t + 2 >= e.length || !/^[\da-f]{2}$/iu.test(e.slice(t + 1, t + 3))) return !0;
			t = e.indexOf("%", t + 3);
		}
		return !1;
	}
	function ae(e) {
		let t = e[4];
		return ie(e[3]) || t !== void 0 && (t[0] !== "[" || t[t.length - 1] !== "]") && ie(t) || ie(e[6]) || ie(e[7]) || ie(e[8]);
	}
	function oe(e, t, n, r) {
		if (!t.unicodeSupport && (!n || !n.unicodeSupport) && e.host && e.host[0] !== "[" && (t.domainHost || n && n.domainHost) && r === !1 && p(e.host)) try {
			e.host = new URL("http://" + e.host).hostname;
		} catch (t) {
			return e.error = e.error || "Host's domain name can not be converted to ASCII: " + t, !0;
		}
		return !1;
	}
	function se(e, t) {
		let r = Object.assign({}, t), i = {
			scheme: void 0,
			userinfo: void 0,
			host: "",
			port: void 0,
			path: "",
			query: void 0,
			fragment: void 0
		}, s = !1, l = !1, u = !1, p = !1, v = !1, y = !1, b = !1;
		r.reference === "suffix" && (e = r.scheme ? r.scheme + ":" + e : "//" + e);
		let x = e.match(te);
		x !== null && x[1].indexOf("\\") !== -1 && (i.error = "URI authority must not contain a literal backslash.", s = !0);
		let S = e.match(ne);
		if (S !== null) {
			let e = S[1], t = e.replace(/[\t\n\r]/g, "");
			t.length >= 2 && (t.slice(0, 2) === "//" ? e.length !== t.length && (i.error = i.error || "URI authority introducer must not contain whitespace.", s = !0) : (i.error = i.error || "URI authority must not contain a literal backslash.", s = !0));
		}
		let C = e.match(ee);
		if (C) {
			if (i.scheme = C[1], i.userinfo = C[3], i.host = C[4], i.port = parseInt(C[5], 10), i.path = C[6] || "", i.query = C[7], i.fragment = C[8], i.scheme !== void 0) {
				let e = unescape(i.scheme);
				g.test(e) ? i.scheme = e.toLowerCase() : (i.error = i.error || _, y = !0);
			}
			l = ae(C), l && (i.error = i.error || "URI contains malformed percent-encoding."), isNaN(i.port) && (i.port = C[5]);
			let t = re(i, C);
			if (t !== void 0 && (i.error = i.error || t, s = !0), i.host) {
				if (f(i.host) === !1) {
					let e = i.host[0] === "[" && i.host[i.host.length - 1] === "]", t = n(i.host);
					b = t.isIPV6 || t.isIPVFuture === !0, v = e && t.error === !0, i.host = b ? t.host : t.host.toLowerCase(), v && (i.error = i.error || "URI host is malformed.", s = !0);
				} else b = !0;
			}
			i.reference = i.scheme === void 0 && i.userinfo === void 0 && i.host === void 0 && i.port === void 0 && i.query === void 0 && !i.path ? "same-document" : i.scheme === void 0 ? "relative" : i.fragment === void 0 ? "absolute" : "uri", r.reference && r.reference !== "suffix" && r.reference !== i.reference && (i.error = i.error || "URI is not a " + r.reference + " reference.");
			let x = h(r.scheme || i.scheme);
			p = oe(i, r, x, b), (!x || x && !x.skipNormalize) && (e.indexOf("%") !== -1 && i.host !== void 0 && !v && (i.host = d(b ? i.host : a(i.host, !0), b)), i.path &&= o(i.path), i.query &&= c(i.query), i.fragment &&= c(i.fragment)), x && x.parse && (x.parse(i, r), x === m.urn && i.nid === void 0 && (u = !0));
		} else i.error = i.error || "URI can not be parsed.";
		return {
			parsed: i,
			malformedAuthorityOrPort: s,
			malformedPercentEncoding: l,
			malformedSchemeSpecific: u,
			malformedHost: p,
			malformedScheme: y
		};
	}
	function ce(e, t) {
		return se(e, t).parsed;
	}
	function le(e, t) {
		return ue(e, t).normalized;
	}
	function ue(e, t) {
		let { parsed: n, malformedAuthorityOrPort: r, malformedPercentEncoding: i, malformedSchemeSpecific: a, malformedHost: o, malformedScheme: s } = se(e, t);
		return {
			normalized: r || i || a || o || s ? e : C(n, t),
			malformedAuthorityOrPort: r,
			malformedPercentEncoding: i,
			malformedSchemeSpecific: a,
			malformedHost: o,
			malformedScheme: s
		};
	}
	function de(e, t) {
		if (typeof e != "string" && typeof e != "object") return;
		let n;
		try {
			n = typeof e == "string" ? e : C(e, t);
		} catch {
			return;
		}
		let { normalized: r, malformedAuthorityOrPort: i, malformedPercentEncoding: a, malformedSchemeSpecific: o, malformedHost: s, malformedScheme: c } = ue(n, t);
		return i || a || o || s || c ? void 0 : r;
	}
	var fe = {
		SCHEMES: m,
		normalize: y,
		resolve: b,
		resolveComponent: x,
		equal: S,
		serialize: C,
		parse: ce
	};
	t.exports = fe, t.exports.default = fe, t.exports.fastUri = fe;
})), _f = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = gf();
	t.code = "require(\"ajv/dist/runtime/uri\").default", e.default = t;
})), vf = /* @__PURE__ */ a(((t) => {
	Object.defineProperty(t, "__esModule", { value: !0 }), t.CodeGen = t.Name = t.nil = t.stringify = t.str = t._ = t.KeywordCxt = void 0;
	var n = tf();
	Object.defineProperty(t, "KeywordCxt", {
		enumerable: !0,
		get: function() {
			return n.KeywordCxt;
		}
	});
	var r = X();
	Object.defineProperty(t, "_", {
		enumerable: !0,
		get: function() {
			return r._;
		}
	}), Object.defineProperty(t, "str", {
		enumerable: !0,
		get: function() {
			return r.str;
		}
	}), Object.defineProperty(t, "stringify", {
		enumerable: !0,
		get: function() {
			return r.stringify;
		}
	}), Object.defineProperty(t, "nil", {
		enumerable: !0,
		get: function() {
			return r.nil;
		}
	}), Object.defineProperty(t, "Name", {
		enumerable: !0,
		get: function() {
			return r.Name;
		}
	}), Object.defineProperty(t, "CodeGen", {
		enumerable: !0,
		get: function() {
			return r.CodeGen;
		}
	});
	var i = nf(), a = rf(), o = Gd(), s = af(), c = X(), l = ef(), u = qd(), d = Z(), f = (pf(), e(of).default), p = _f(), m = (e, t) => new RegExp(e, t);
	m.code = "new RegExp";
	var h = [
		"removeAdditional",
		"useDefaults",
		"coerceTypes"
	], g = /* @__PURE__ */ new Set([
		"validate",
		"serialize",
		"parse",
		"wrapper",
		"root",
		"schema",
		"keyword",
		"pattern",
		"formats",
		"validate$data",
		"func",
		"obj",
		"Error"
	]), _ = {
		errorDataPath: "",
		format: "`validateFormats: false` can be used instead.",
		nullable: "\"nullable\" keyword is supported by default.",
		jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
		extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
		missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
		processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
		sourceCode: "Use option `code: {source: true}`",
		strictDefaults: "It is default now, see option `strict`.",
		strictKeywords: "It is default now, see option `strict`.",
		uniqueItems: "\"uniqueItems\" keyword is always validated.",
		unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
		cache: "Map is used as cache, schema object as key.",
		serialize: "Map is used as cache, schema object as key.",
		ajvErrors: "It is default now."
	}, v = {
		ignoreKeywordsWithRef: "",
		jsPropertySyntax: "",
		unicode: "\"minLength\"/\"maxLength\" account for unicode characters by default."
	}, y = 200;
	function b(e) {
		let t = e.strict, n = e.code?.optimize, r = n === !0 || n === void 0 ? 1 : n || 0, i = e.code?.regExp ?? m, a = e.uriResolver ?? p.default;
		return {
			strictSchema: e.strictSchema ?? t ?? !0,
			strictNumbers: e.strictNumbers ?? t ?? !0,
			strictTypes: e.strictTypes ?? t ?? "log",
			strictTuples: e.strictTuples ?? t ?? "log",
			strictRequired: e.strictRequired ?? t ?? !1,
			code: e.code ? {
				...e.code,
				optimize: r,
				regExp: i
			} : {
				optimize: r,
				regExp: i
			},
			loopRequired: e.loopRequired ?? y,
			loopEnum: e.loopEnum ?? y,
			meta: e.meta ?? !0,
			messages: e.messages ?? !0,
			inlineRefs: e.inlineRefs ?? !0,
			schemaId: e.schemaId ?? "$id",
			addUsedSchema: e.addUsedSchema ?? !0,
			validateSchema: e.validateSchema ?? !0,
			validateFormats: e.validateFormats ?? !0,
			unicodeRegExp: e.unicodeRegExp ?? !0,
			int32range: e.int32range ?? !0,
			uriResolver: a
		};
	}
	var x = class {
		constructor(e = {}) {
			this.schemas = {}, this.refs = {}, this.formats = Object.create(null), this._compilations = /* @__PURE__ */ new Set(), this._loading = {}, this._cache = /* @__PURE__ */ new Map(), e = this.opts = {
				...e,
				...b(e)
			};
			let { es5: t, lines: n } = this.opts.code;
			this.scope = new c.ValueScope({
				scope: {},
				prefixes: g,
				es5: t,
				lines: n
			}), this.logger = ae(e.logger);
			let r = e.validateFormats;
			e.validateFormats = !1, this.RULES = (0, o.getRules)(), S.call(this, _, e, "NOT SUPPORTED"), S.call(this, v, e, "DEPRECATED", "warn"), this._metaOpts = re.call(this), e.formats && te.call(this), this._addVocabularies(), this._addDefaultMetaSchema(), e.keywords && ne.call(this, e.keywords), typeof e.meta == "object" && this.addMetaSchema(e.meta), ee.call(this), e.validateFormats = r;
		}
		_addVocabularies() {
			this.addKeyword("$async");
		}
		_addDefaultMetaSchema() {
			let { $data: e, meta: t, schemaId: n } = this.opts, r = f;
			n === "id" && (r = { ...f }, r.id = r.$id, delete r.$id), t && e && this.addMetaSchema(r, r[n], !1);
		}
		defaultMeta() {
			let { meta: e, schemaId: t } = this.opts;
			return this.opts.defaultMeta = typeof e == "object" ? e[t] || e : void 0;
		}
		validate(e, t) {
			let n;
			if (typeof e == "string") {
				if (n = this.getSchema(e), !n) throw Error(`no schema with key or ref "${e}"`);
			} else n = this.compile(e);
			let r = n(t);
			return "$async" in n || (this.errors = n.errors), r;
		}
		compile(e, t) {
			let n = this._addSchema(e, t);
			return n.validate || this._compileSchemaEnv(n);
		}
		compileAsync(e, t) {
			if (typeof this.opts.loadSchema != "function") throw Error("options.loadSchema should be a function");
			let { loadSchema: n } = this.opts;
			return r.call(this, e, t);
			async function r(e, t) {
				await i.call(this, e.$schema);
				let n = this._addSchema(e, t);
				return n.validate || o.call(this, n);
			}
			async function i(e) {
				e && !this.getSchema(e) && await r.call(this, { $ref: e }, !0);
			}
			async function o(e) {
				try {
					return this._compileSchemaEnv(e);
				} catch (t) {
					if (!(t instanceof a.default)) throw t;
					return s.call(this, t), await c.call(this, t.missingSchema), o.call(this, e);
				}
			}
			function s({ missingSchema: e, missingRef: t }) {
				if (this.refs[e]) throw Error(`AnySchema ${e} is loaded but ${t} cannot be resolved`);
			}
			async function c(e) {
				let n = await l.call(this, e);
				this.refs[e] || await i.call(this, n.$schema), this.refs[e] || this.addSchema(n, e, t);
			}
			async function l(e) {
				let t = this._loading[e];
				if (t) return t;
				try {
					return await (this._loading[e] = n(e));
				} finally {
					delete this._loading[e];
				}
			}
		}
		addSchema(e, t, n, r = this.opts.validateSchema) {
			if (Array.isArray(e)) {
				for (let t of e) this.addSchema(t, void 0, n, r);
				return this;
			}
			let i;
			if (typeof e == "object") {
				let { schemaId: t } = this.opts;
				if (i = e[t], i !== void 0 && typeof i != "string") throw Error(`schema ${t} must be string`);
			}
			return t = (0, l.normalizeId)(t || i), this._checkUnique(t), this.schemas[t] = this._addSchema(e, n, t, r, !0), this;
		}
		addMetaSchema(e, t, n = this.opts.validateSchema) {
			return this.addSchema(e, t, !0, n), this;
		}
		validateSchema(e, t) {
			if (typeof e == "boolean") return !0;
			let n;
			if (n = e.$schema, n !== void 0 && typeof n != "string") throw Error("$schema must be a string");
			if (n = n || this.opts.defaultMeta || this.defaultMeta(), !n) return this.logger.warn("meta-schema not available"), this.errors = null, !0;
			let r = this.validate(n, e);
			if (!r && t) {
				let e = "schema is invalid: " + this.errorsText();
				if (this.opts.validateSchema === "log") this.logger.error(e);
				else throw Error(e);
			}
			return r;
		}
		getSchema(e) {
			let t;
			for (; typeof (t = C.call(this, e)) == "string";) e = t;
			if (t === void 0) {
				let { schemaId: n } = this.opts, r = new s.SchemaEnv({
					schema: {},
					schemaId: n
				});
				if (t = s.resolveSchema.call(this, r, e), !t) return;
				this.refs[e] = t;
			}
			return t.validate || this._compileSchemaEnv(t);
		}
		removeSchema(e) {
			if (e instanceof RegExp) return this._removeAllSchemas(this.schemas, e), this._removeAllSchemas(this.refs, e), this;
			switch (typeof e) {
				case "undefined": return this._removeAllSchemas(this.schemas), this._removeAllSchemas(this.refs), this._cache.clear(), this;
				case "string": {
					let t = C.call(this, e);
					return typeof t == "object" && this._cache.delete(t.schema), delete this.schemas[e], delete this.refs[e], this;
				}
				case "object": {
					let t = e;
					this._cache.delete(t);
					let n = e[this.opts.schemaId];
					return n && (n = (0, l.normalizeId)(n), delete this.schemas[n], delete this.refs[n]), this;
				}
				default: throw Error("ajv.removeSchema: invalid parameter");
			}
		}
		addVocabulary(e) {
			for (let t of e) this.addKeyword(t);
			return this;
		}
		addKeyword(e, t) {
			let n;
			if (typeof e == "string") n = e, typeof t == "object" && (this.logger.warn("these parameters are deprecated, see docs for addKeyword"), t.keyword = n);
			else if (typeof e == "object" && t === void 0) {
				if (t = e, n = t.keyword, Array.isArray(n) && !n.length) throw Error("addKeywords: keyword must be string or non-empty array");
			} else throw Error("invalid addKeywords parameters");
			if (se.call(this, n, t), !t) return (0, d.eachItem)(n, (e) => ce.call(this, e)), this;
			ue.call(this, t);
			let r = {
				...t,
				type: (0, u.getJSONTypes)(t.type),
				schemaType: (0, u.getJSONTypes)(t.schemaType)
			};
			return (0, d.eachItem)(n, r.type.length === 0 ? (e) => ce.call(this, e, r) : (e) => r.type.forEach((t) => ce.call(this, e, r, t))), this;
		}
		getKeyword(e) {
			let t = this.RULES.all[e];
			return typeof t == "object" ? t.definition : !!t;
		}
		removeKeyword(e) {
			let { RULES: t } = this;
			delete t.keywords[e], delete t.all[e];
			for (let n of t.rules) {
				let t = n.rules.findIndex((t) => t.keyword === e);
				t >= 0 && n.rules.splice(t, 1);
			}
			return this;
		}
		addFormat(e, t) {
			return typeof t == "string" && (t = new RegExp(t)), this.formats[e] = t, this;
		}
		errorsText(e = this.errors, { separator: t = ", ", dataVar: n = "data" } = {}) {
			return !e || e.length === 0 ? "No errors" : e.map((e) => `${n}${e.instancePath} ${e.message}`).reduce((e, n) => e + t + n);
		}
		$dataMetaSchema(e, t) {
			let n = this.RULES.all;
			e = JSON.parse(JSON.stringify(e));
			for (let r of t) {
				let t = r.split("/").slice(1), i = e;
				for (let e of t) i = i[e];
				for (let e in n) {
					let t = n[e];
					if (typeof t != "object") continue;
					let { $data: r } = t.definition, a = i[e];
					r && a && (i[e] = fe(a));
				}
			}
			return e;
		}
		_removeAllSchemas(e, t) {
			for (let n in e) {
				let r = e[n];
				(!t || t.test(n)) && (typeof r == "string" ? delete e[n] : r && !r.meta && (this._cache.delete(r.schema), delete e[n]));
			}
		}
		_addSchema(e, t, n, r = this.opts.validateSchema, i = this.opts.addUsedSchema) {
			let a, { schemaId: o } = this.opts;
			if (typeof e == "object") a = e[o];
			else if (this.opts.jtd) throw Error("schema must be object");
			else if (typeof e != "boolean") throw Error("schema must be object or boolean");
			let c = this._cache.get(e);
			if (c !== void 0) return c;
			n = (0, l.normalizeId)(a || n);
			let u = l.getSchemaRefs.call(this, e, n);
			return c = new s.SchemaEnv({
				schema: e,
				schemaId: o,
				meta: t,
				baseId: n,
				localRefs: u
			}), this._cache.set(c.schema, c), i && !n.startsWith("#") && (n && this._checkUnique(n), this.refs[n] = c), r && this.validateSchema(e, !0), c;
		}
		_checkUnique(e) {
			if (this.schemas[e] || this.refs[e]) throw Error(`schema with key or id "${e}" already exists`);
		}
		_compileSchemaEnv(e) {
			/* istanbul ignore if */
			if (e.meta ? this._compileMetaSchema(e) : s.compileSchema.call(this, e), !e.validate) throw Error("ajv implementation error");
			return e.validate;
		}
		_compileMetaSchema(e) {
			let t = this.opts;
			this.opts = this._metaOpts;
			try {
				s.compileSchema.call(this, e);
			} finally {
				this.opts = t;
			}
		}
	};
	x.ValidationError = i.default, x.MissingRefError = a.default, t.default = x;
	function S(e, t, n, r = "error") {
		for (let i in e) {
			let a = i;
			a in t && this.logger[r](`${n}: option ${i}. ${e[a]}`);
		}
	}
	function C(e) {
		return e = (0, l.normalizeId)(e), this.schemas[e] || this.refs[e];
	}
	function ee() {
		let e = this.opts.schemas;
		if (e) {
			if (Array.isArray(e)) this.addSchema(e);
			else for (let t in e) this.addSchema(e[t], t);
		}
	}
	function te() {
		for (let e in this.opts.formats) {
			let t = this.opts.formats[e];
			t && this.addFormat(e, t);
		}
	}
	function ne(e) {
		if (Array.isArray(e)) {
			this.addVocabulary(e);
			return;
		}
		this.logger.warn("keywords option as map is deprecated, pass array");
		for (let t in e) {
			let n = e[t];
			n.keyword ||= t, this.addKeyword(n);
		}
	}
	function re() {
		let e = { ...this.opts };
		for (let t of h) delete e[t];
		return e;
	}
	var ie = {
		log() {},
		warn() {},
		error() {}
	};
	function ae(e) {
		if (e === !1) return ie;
		if (e === void 0) return console;
		if (e.log && e.warn && e.error) return e;
		throw Error("logger must implement log, warn and error methods");
	}
	var oe = /^[a-z_$][a-z0-9_$:-]*$/i;
	function se(e, t) {
		let { RULES: n } = this;
		if ((0, d.eachItem)(e, (e) => {
			if (n.keywords[e]) throw Error(`Keyword ${e} is already defined`);
			if (!oe.test(e)) throw Error(`Keyword ${e} has invalid name`);
		}), t && t.$data && !("code" in t || "validate" in t)) throw Error("$data keyword must have \"code\" or \"validate\" function");
	}
	function ce(e, t, n) {
		var r;
		let i = t?.post;
		if (n && i) throw Error("keyword with \"post\" flag cannot have \"type\"");
		let { RULES: a } = this, o = i ? a.post : a.rules.find(({ type: e }) => e === n);
		if (o || (o = {
			type: n,
			rules: []
		}, a.rules.push(o)), a.keywords[e] = !0, !t) return;
		let s = {
			keyword: e,
			definition: {
				...t,
				type: (0, u.getJSONTypes)(t.type),
				schemaType: (0, u.getJSONTypes)(t.schemaType)
			}
		};
		t.before ? le.call(this, o, s, t.before) : o.rules.push(s), a.all[e] = s, (r = t.implements) == null || r.forEach((e) => this.addKeyword(e));
	}
	function le(e, t, n) {
		let r = e.rules.findIndex((e) => e.keyword === n);
		r >= 0 ? e.rules.splice(r, 0, t) : (e.rules.push(t), this.logger.warn(`rule ${n} is not defined`));
	}
	function ue(e) {
		let { metaSchema: t } = e;
		t !== void 0 && (e.$data && this.opts.$data && (t = fe(t)), e.validateSchema = this.compile(t, !0));
	}
	var de = { $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#" };
	function fe(e) {
		return { anyOf: [e, de] };
	}
})), yf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.default = {
		keyword: "id",
		code() {
			throw Error("NOT SUPPORTED: keyword \"id\", use \"$id\" for schema ID");
		}
	};
})), bf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.callRef = e.getValidate = void 0;
	var t = rf(), n = Yd(), r = X(), i = Hd(), a = af(), o = Z(), s = {
		keyword: "$ref",
		schemaType: "string",
		code(e) {
			let { gen: n, schema: i, it: o } = e, { baseId: s, schemaEnv: u, validateName: d, opts: f, self: p } = o, { root: m } = u;
			if ((i === "#" || i === "#/") && s === m.baseId) return g();
			let h = a.resolveRef.call(p, m, s, i);
			if (h === void 0) throw new t.default(o.opts.uriResolver, s, i);
			if (h instanceof a.SchemaEnv) return _(h);
			return v(h);
			function g() {
				if (u === m) return l(e, d, u, u.$async);
				let t = n.scopeValue("root", { ref: m });
				return l(e, (0, r._)`${t}.validate`, m, m.$async);
			}
			function _(t) {
				l(e, c(e, t), t, t.$async);
			}
			function v(t) {
				let a = n.scopeValue("schema", f.code.source === !0 ? {
					ref: t,
					code: (0, r.stringify)(t)
				} : { ref: t }), o = n.name("valid"), s = e.subschema({
					schema: t,
					dataTypes: [],
					schemaPath: r.nil,
					topSchemaRef: a,
					errSchemaPath: i
				}, o);
				e.mergeEvaluated(s), e.ok(o);
			}
		}
	};
	function c(e, t) {
		let { gen: n } = e;
		return t.validate ? n.scopeValue("validate", { ref: t.validate }) : (0, r._)`${n.scopeValue("wrapper", { ref: t })}.validate`;
	}
	e.getValidate = c;
	function l(e, t, a, s) {
		let { gen: c, it: l } = e, { allErrors: u, schemaEnv: d, opts: f } = l, p = f.passContext ? i.default.this : r.nil;
		s ? m() : h();
		function m() {
			if (!d.$async) throw Error("async schema referenced by sync schema");
			let i = c.let("valid");
			c.try(() => {
				c.code((0, r._)`await ${(0, n.callValidateCode)(e, t, p)}`), _(t), u || c.assign(i, !0);
			}, (e) => {
				c.if((0, r._)`!(${e} instanceof ${l.ValidationError})`, () => c.throw(e)), g(e), u || c.assign(i, !1);
			}), e.ok(i);
		}
		function h() {
			e.result((0, n.callValidateCode)(e, t, p), () => _(t), () => g(t));
		}
		function g(e) {
			let t = (0, r._)`${e}.errors`;
			c.assign(i.default.vErrors, (0, r._)`${i.default.vErrors} === null ? ${t} : ${i.default.vErrors}.concat(${t})`), c.assign(i.default.errors, (0, r._)`${i.default.vErrors}.length`);
		}
		function _(e) {
			if (!l.opts.unevaluated) return;
			let t = a?.validate?.evaluated;
			if (l.props !== !0) {
				if (t && !t.dynamicProps) t.props !== void 0 && (l.props = o.mergeEvaluated.props(c, t.props, l.props));
				else {
					let t = c.var("props", (0, r._)`${e}.evaluated.props`);
					l.props = o.mergeEvaluated.props(c, t, l.props, r.Name);
				}
			}
			if (l.items !== !0) {
				if (t && !t.dynamicItems) t.items !== void 0 && (l.items = o.mergeEvaluated.items(c, t.items, l.items));
				else {
					let t = c.var("items", (0, r._)`${e}.evaluated.items`);
					l.items = o.mergeEvaluated.items(c, t, l.items, r.Name);
				}
			}
		}
	}
	e.callRef = l, e.default = s;
})), xf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = yf(), n = bf();
	e.default = [
		"$schema",
		"$id",
		"$defs",
		"$vocabulary",
		{ keyword: "$comment" },
		"definitions",
		t.default,
		n.default
	];
})), Sf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X(), n = t.operators, r = {
		maximum: {
			okStr: "<=",
			ok: n.LTE,
			fail: n.GT
		},
		minimum: {
			okStr: ">=",
			ok: n.GTE,
			fail: n.LT
		},
		exclusiveMaximum: {
			okStr: "<",
			ok: n.LT,
			fail: n.GTE
		},
		exclusiveMinimum: {
			okStr: ">",
			ok: n.GT,
			fail: n.LTE
		}
	};
	e.default = {
		keyword: Object.keys(r),
		type: "number",
		schemaType: "number",
		$data: !0,
		error: {
			message: ({ keyword: e, schemaCode: n }) => (0, t.str)`must be ${r[e].okStr} ${n}`,
			params: ({ keyword: e, schemaCode: n }) => (0, t._)`{comparison: ${r[e].okStr}, limit: ${n}}`
		},
		code(e) {
			let { keyword: n, data: i, schemaCode: a } = e;
			e.fail$data((0, t._)`${i} ${r[n].fail} ${a} || isNaN(${i})`);
		}
	};
})), Cf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X();
	e.default = {
		keyword: "multipleOf",
		type: "number",
		schemaType: "number",
		$data: !0,
		error: {
			message: ({ schemaCode: e }) => (0, t.str)`must be multiple of ${e}`,
			params: ({ schemaCode: e }) => (0, t._)`{multipleOf: ${e}}`
		},
		code(e) {
			let { gen: n, data: r, schemaCode: i, it: a } = e, o = a.opts.multipleOfPrecision, s = n.let("res"), c = o ? (0, t._)`Math.abs(Math.round(${s}) - ${s}) > 1e-${o}` : (0, t._)`${s} !== parseInt(${s})`;
			e.fail$data((0, t._)`(${i} === 0 || (${s} = ${r}/${i}, ${c}))`);
		}
	};
})), wf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	function t(e) {
		let t = e.length, n = 0, r = 0, i;
		for (; r < t;) n++, i = e.charCodeAt(r++), i >= 55296 && i <= 56319 && r < t && (i = e.charCodeAt(r), (i & 64512) == 56320 && r++);
		return n;
	}
	e.default = t, t.code = "require(\"ajv/dist/runtime/ucs2length\").default";
})), Tf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X(), n = Z(), r = wf();
	e.default = {
		keyword: ["maxLength", "minLength"],
		type: "string",
		schemaType: "number",
		$data: !0,
		error: {
			message({ keyword: e, schemaCode: n }) {
				let r = e === "maxLength" ? "more" : "fewer";
				return (0, t.str)`must NOT have ${r} than ${n} characters`;
			},
			params: ({ schemaCode: e }) => (0, t._)`{limit: ${e}}`
		},
		code(e) {
			let { keyword: i, data: a, schemaCode: o, it: s } = e, c = i === "maxLength" ? t.operators.GT : t.operators.LT, l = s.opts.unicode === !1 ? (0, t._)`${a}.length` : (0, t._)`${(0, n.useFunc)(e.gen, r.default)}(${a})`;
			e.fail$data((0, t._)`${l} ${c} ${o}`);
		}
	};
})), Ef = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = Yd(), n = Z(), r = X();
	e.default = {
		keyword: "pattern",
		type: "string",
		schemaType: "string",
		$data: !0,
		error: {
			message: ({ schemaCode: e }) => (0, r.str)`must match pattern "${e}"`,
			params: ({ schemaCode: e }) => (0, r._)`{pattern: ${e}}`
		},
		code(e) {
			let { gen: i, data: a, $data: o, schema: s, schemaCode: c, it: l } = e, u = l.opts.unicodeRegExp ? "u" : "";
			if (o) {
				let { regExp: t } = l.opts.code, o = t.code === "new RegExp" ? (0, r._)`new RegExp` : (0, n.useFunc)(i, t), s = i.let("valid");
				i.try(() => i.assign(s, (0, r._)`${o}(${c}, ${u}).test(${a})`), () => i.assign(s, !1)), e.fail$data((0, r._)`!${s}`);
			} else {
				let n = (0, t.usePattern)(e, s);
				e.fail$data((0, r._)`!${n}.test(${a})`);
			}
		}
	};
})), Df = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X();
	e.default = {
		keyword: ["maxProperties", "minProperties"],
		type: "object",
		schemaType: "number",
		$data: !0,
		error: {
			message({ keyword: e, schemaCode: n }) {
				let r = e === "maxProperties" ? "more" : "fewer";
				return (0, t.str)`must NOT have ${r} than ${n} properties`;
			},
			params: ({ schemaCode: e }) => (0, t._)`{limit: ${e}}`
		},
		code(e) {
			let { keyword: n, data: r, schemaCode: i } = e, a = n === "maxProperties" ? t.operators.GT : t.operators.LT;
			e.fail$data((0, t._)`Object.keys(${r}).length ${a} ${i}`);
		}
	};
})), Of = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = Yd(), n = X(), r = Z();
	e.default = {
		keyword: "required",
		type: "object",
		schemaType: "array",
		$data: !0,
		error: {
			message: ({ params: { missingProperty: e } }) => (0, n.str)`must have required property '${e}'`,
			params: ({ params: { missingProperty: e } }) => (0, n._)`{missingProperty: ${e}}`
		},
		code(e) {
			let { gen: i, schema: a, schemaCode: o, data: s, $data: c, it: l } = e, { opts: u } = l;
			if (!c && a.length === 0) return;
			let d = a.length >= u.loopRequired;
			if (l.allErrors ? f() : p(), u.strictRequired) {
				let t = e.parentSchema.properties, { definedProperties: n } = e.it;
				for (let e of a) if (t?.[e] === void 0 && !n.has(e)) {
					let t = `required property "${e}" is not defined at "${l.schemaEnv.baseId + l.errSchemaPath}" (strictRequired)`;
					(0, r.checkStrictMode)(l, t, l.opts.strictRequired);
				}
			}
			function f() {
				if (d || c) e.block$data(n.nil, m);
				else for (let n of a) (0, t.checkReportMissingProp)(e, n);
			}
			function p() {
				let n = i.let("missing");
				if (d || c) {
					let t = i.let("valid", !0);
					e.block$data(t, () => h(n, t)), e.ok(t);
				} else i.if((0, t.checkMissingProp)(e, a, n)), (0, t.reportMissingProp)(e, n), i.else();
			}
			function m() {
				i.forOf("prop", o, (n) => {
					e.setParams({ missingProperty: n }), i.if((0, t.noPropertyInData)(i, s, n, u.ownProperties), () => e.error());
				});
			}
			function h(r, a) {
				e.setParams({ missingProperty: r }), i.forOf(r, o, () => {
					i.assign(a, (0, t.propertyInData)(i, s, r, u.ownProperties)), i.if((0, n.not)(a), () => {
						e.error(), i.break();
					});
				}, n.nil);
			}
		}
	};
})), kf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X();
	e.default = {
		keyword: ["maxItems", "minItems"],
		type: "array",
		schemaType: "number",
		$data: !0,
		error: {
			message({ keyword: e, schemaCode: n }) {
				let r = e === "maxItems" ? "more" : "fewer";
				return (0, t.str)`must NOT have ${r} than ${n} items`;
			},
			params: ({ schemaCode: e }) => (0, t._)`{limit: ${e}}`
		},
		code(e) {
			let { keyword: n, data: r, schemaCode: i } = e, a = n === "maxItems" ? t.operators.GT : t.operators.LT;
			e.fail$data((0, t._)`${r}.length ${a} ${i}`);
		}
	};
})), Af = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = Qd();
	t.code = "require(\"ajv/dist/runtime/equal\").default", e.default = t;
})), jf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = qd(), n = X(), r = Z(), i = Af();
	e.default = {
		keyword: "uniqueItems",
		type: "array",
		schemaType: "boolean",
		$data: !0,
		error: {
			message: ({ params: { i: e, j: t } }) => (0, n.str)`must NOT have duplicate items (items ## ${t} and ${e} are identical)`,
			params: ({ params: { i: e, j: t } }) => (0, n._)`{i: ${e}, j: ${t}}`
		},
		code(e) {
			let { gen: a, data: o, $data: s, schema: c, parentSchema: l, schemaCode: u, it: d } = e;
			if (!s && !c) return;
			let f = a.let("valid"), p = l.items ? (0, t.getSchemaTypes)(l.items) : [];
			e.block$data(f, m, (0, n._)`${u} === false`), e.ok(f);
			function m() {
				let t = a.let("i", (0, n._)`${o}.length`), r = a.let("j");
				e.setParams({
					i: t,
					j: r
				}), a.assign(f, !0), a.if((0, n._)`${t} > 1`, () => (h() ? g : _)(t, r));
			}
			function h() {
				return p.length > 0 && !p.some((e) => e === "object" || e === "array");
			}
			function g(r, i) {
				let s = a.name("item"), c = (0, t.checkDataTypes)(p, s, d.opts.strictNumbers, t.DataType.Wrong), l = a.const("indices", (0, n._)`{}`);
				a.for((0, n._)`;${r}--;`, () => {
					a.let(s, (0, n._)`${o}[${r}]`), a.if(c, (0, n._)`continue`), p.length > 1 && a.if((0, n._)`typeof ${s} == "string"`, (0, n._)`${s} += "_"`), a.if((0, n._)`typeof ${l}[${s}] == "number"`, () => {
						a.assign(i, (0, n._)`${l}[${s}]`), e.error(), a.assign(f, !1).break();
					}).code((0, n._)`${l}[${s}] = ${r}`);
				});
			}
			function _(t, s) {
				let c = (0, r.useFunc)(a, i.default), l = a.name("outer");
				a.label(l).for((0, n._)`;${t}--;`, () => a.for((0, n._)`${s} = ${t}; ${s}--;`, () => a.if((0, n._)`${c}(${o}[${t}], ${o}[${s}])`, () => {
					e.error(), a.assign(f, !1).break(l);
				})));
			}
		}
	};
})), Mf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X(), n = Z(), r = Af();
	e.default = {
		keyword: "const",
		$data: !0,
		error: {
			message: "must be equal to constant",
			params: ({ schemaCode: e }) => (0, t._)`{allowedValue: ${e}}`
		},
		code(e) {
			let { gen: i, data: a, $data: o, schemaCode: s, schema: c } = e;
			o || c && typeof c == "object" ? e.fail$data((0, t._)`!${(0, n.useFunc)(i, r.default)}(${a}, ${s})`) : e.fail((0, t._)`${c} !== ${a}`);
		}
	};
})), Nf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X(), n = Z(), r = Af();
	e.default = {
		keyword: "enum",
		schemaType: "array",
		$data: !0,
		error: {
			message: "must be equal to one of the allowed values",
			params: ({ schemaCode: e }) => (0, t._)`{allowedValues: ${e}}`
		},
		code(e) {
			let { gen: i, data: a, $data: o, schema: s, schemaCode: c, it: l } = e;
			if (!o && s.length === 0) throw Error("enum must have non-empty array");
			let u = s.length >= l.opts.loopEnum, d, f = () => d ??= (0, n.useFunc)(i, r.default), p;
			if (u || o) p = i.let("valid"), e.block$data(p, m);
			else {
				/* istanbul ignore if */
				if (!Array.isArray(s)) throw Error("ajv implementation error");
				let e = i.const("vSchema", c);
				p = (0, t.or)(...s.map((t, n) => h(e, n)));
			}
			e.pass(p);
			function m() {
				i.assign(p, !1), i.forOf("v", c, (e) => i.if((0, t._)`${f()}(${a}, ${e})`, () => i.assign(p, !0).break()));
			}
			function h(e, n) {
				let r = s[n];
				return typeof r == "object" && r ? (0, t._)`${f()}(${a}, ${e}[${n}])` : (0, t._)`${a} === ${r}`;
			}
		}
	};
})), Pf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = Sf(), n = Cf(), r = Tf(), i = Ef(), a = Df(), o = Of(), s = kf(), c = jf(), l = Mf(), u = Nf();
	e.default = [
		t.default,
		n.default,
		r.default,
		i.default,
		a.default,
		o.default,
		s.default,
		c.default,
		{
			keyword: "type",
			schemaType: ["string", "array"]
		},
		{
			keyword: "nullable",
			schemaType: "boolean"
		},
		l.default,
		u.default
	];
})), Ff = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.validateAdditionalItems = void 0;
	var t = X(), n = Z(), r = {
		keyword: "additionalItems",
		type: "array",
		schemaType: ["boolean", "object"],
		before: "uniqueItems",
		error: {
			message: ({ params: { len: e } }) => (0, t.str)`must NOT have more than ${e} items`,
			params: ({ params: { len: e } }) => (0, t._)`{limit: ${e}}`
		},
		code(e) {
			let { parentSchema: t, it: r } = e, { items: a } = t;
			if (!Array.isArray(a)) {
				(0, n.checkStrictMode)(r, "\"additionalItems\" is ignored when \"items\" is not an array of schemas");
				return;
			}
			i(e, a);
		}
	};
	function i(e, r) {
		let { gen: i, schema: a, data: o, keyword: s, it: c } = e;
		c.items = !0;
		let l = i.const("len", (0, t._)`${o}.length`);
		if (a === !1) e.setParams({ len: r.length }), e.pass((0, t._)`${l} <= ${r.length}`);
		else if (typeof a == "object" && !(0, n.alwaysValidSchema)(c, a)) {
			let n = i.var("valid", (0, t._)`${l} <= ${r.length}`);
			i.if((0, t.not)(n), () => u(n)), e.ok(n);
		}
		function u(a) {
			i.forRange("i", r.length, l, (r) => {
				e.subschema({
					keyword: s,
					dataProp: r,
					dataPropType: n.Type.Num
				}, a), c.allErrors || i.if((0, t.not)(a), () => i.break());
			});
		}
	}
	e.validateAdditionalItems = i, e.default = r;
})), If = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.validateTuple = void 0;
	var t = X(), n = Z(), r = Yd(), i = {
		keyword: "items",
		type: "array",
		schemaType: [
			"object",
			"array",
			"boolean"
		],
		before: "uniqueItems",
		code(e) {
			let { schema: t, it: i } = e;
			if (Array.isArray(t)) return a(e, "additionalItems", t);
			i.items = !0, !(0, n.alwaysValidSchema)(i, t) && e.ok((0, r.validateArray)(e));
		}
	};
	function a(e, r, i = e.schema) {
		let { gen: a, parentSchema: o, data: s, keyword: c, it: l } = e;
		f(o), l.opts.unevaluated && i.length && l.items !== !0 && (l.items = n.mergeEvaluated.items(a, i.length, l.items));
		let u = a.name("valid"), d = a.const("len", (0, t._)`${s}.length`);
		i.forEach((r, i) => {
			(0, n.alwaysValidSchema)(l, r) || (a.if((0, t._)`${d} > ${i}`, () => e.subschema({
				keyword: c,
				schemaProp: i,
				dataProp: i
			}, u)), e.ok(u));
		});
		function f(e) {
			let { opts: t, errSchemaPath: a } = l, o = i.length, s = o === e.minItems && (o === e.maxItems || e[r] === !1);
			if (t.strictTuples && !s) {
				let e = `"${c}" is ${o}-tuple, but minItems or maxItems/${r} are not specified or different at path "${a}"`;
				(0, n.checkStrictMode)(l, e, t.strictTuples);
			}
		}
	}
	e.validateTuple = a, e.default = i;
})), Lf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = If();
	e.default = {
		keyword: "prefixItems",
		type: "array",
		schemaType: ["array"],
		before: "uniqueItems",
		code: (e) => (0, t.validateTuple)(e, "items")
	};
})), Rf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X(), n = Z(), r = Yd(), i = Ff();
	e.default = {
		keyword: "items",
		type: "array",
		schemaType: ["object", "boolean"],
		before: "uniqueItems",
		error: {
			message: ({ params: { len: e } }) => (0, t.str)`must NOT have more than ${e} items`,
			params: ({ params: { len: e } }) => (0, t._)`{limit: ${e}}`
		},
		code(e) {
			let { schema: t, parentSchema: a, it: o } = e, { prefixItems: s } = a;
			o.items = !0, !(0, n.alwaysValidSchema)(o, t) && (s ? (0, i.validateAdditionalItems)(e, s) : e.ok((0, r.validateArray)(e)));
		}
	};
})), zf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X(), n = Z();
	e.default = {
		keyword: "contains",
		type: "array",
		schemaType: ["object", "boolean"],
		before: "uniqueItems",
		trackErrors: !0,
		error: {
			message: ({ params: { min: e, max: n } }) => n === void 0 ? (0, t.str)`must contain at least ${e} valid item(s)` : (0, t.str)`must contain at least ${e} and no more than ${n} valid item(s)`,
			params: ({ params: { min: e, max: n } }) => n === void 0 ? (0, t._)`{minContains: ${e}}` : (0, t._)`{minContains: ${e}, maxContains: ${n}}`
		},
		code(e) {
			let { gen: r, schema: i, parentSchema: a, data: o, it: s } = e, c, l, { minContains: u, maxContains: d } = a;
			s.opts.next ? (c = u === void 0 ? 1 : u, l = d) : c = 1;
			let f = r.const("len", (0, t._)`${o}.length`);
			if (e.setParams({
				min: c,
				max: l
			}), l === void 0 && c === 0) {
				(0, n.checkStrictMode)(s, "\"minContains\" == 0 without \"maxContains\": \"contains\" keyword ignored");
				return;
			}
			if (l !== void 0 && c > l) {
				(0, n.checkStrictMode)(s, "\"minContains\" > \"maxContains\" is always invalid"), e.fail();
				return;
			}
			if ((0, n.alwaysValidSchema)(s, i)) {
				let n = (0, t._)`${f} >= ${c}`;
				l !== void 0 && (n = (0, t._)`${n} && ${f} <= ${l}`), e.pass(n);
				return;
			}
			s.items = !0;
			let p = r.name("valid");
			l === void 0 && c === 1 ? h(p, () => r.if(p, () => r.break())) : c === 0 ? (r.let(p, !0), l !== void 0 && r.if((0, t._)`${o}.length > 0`, m)) : (r.let(p, !1), m()), e.result(p, () => e.reset());
			function m() {
				let e = r.name("_valid"), t = r.let("count", 0);
				h(e, () => r.if(e, () => g(t)));
			}
			function h(t, i) {
				r.forRange("i", 0, f, (r) => {
					e.subschema({
						keyword: "contains",
						dataProp: r,
						dataPropType: n.Type.Num,
						compositeRule: !0
					}, t), i();
				});
			}
			function g(e) {
				r.code((0, t._)`${e}++`), l === void 0 ? r.if((0, t._)`${e} >= ${c}`, () => r.assign(p, !0).break()) : (r.if((0, t._)`${e} > ${l}`, () => r.assign(p, !1).break()), c === 1 ? r.assign(p, !0) : r.if((0, t._)`${e} >= ${c}`, () => r.assign(p, !0)));
			}
		}
	};
})), Bf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.validateSchemaDeps = e.validatePropertyDeps = e.error = void 0;
	var t = X(), n = Z(), r = Yd();
	e.error = {
		message: ({ params: { property: e, depsCount: n, deps: r } }) => {
			let i = n === 1 ? "property" : "properties";
			return (0, t.str)`must have ${i} ${r} when property ${e} is present`;
		},
		params: ({ params: { property: e, depsCount: n, deps: r, missingProperty: i } }) => (0, t._)`{property: ${e},
    missingProperty: ${i},
    depsCount: ${n},
    deps: ${r}}`
	};
	var i = {
		keyword: "dependencies",
		type: "object",
		schemaType: "object",
		error: e.error,
		code(e) {
			let [t, n] = a(e);
			o(e, t), s(e, n);
		}
	};
	function a({ schema: e }) {
		let t = {}, n = {};
		for (let r in e) {
			if (r === "__proto__") continue;
			let i = Array.isArray(e[r]) ? t : n;
			i[r] = e[r];
		}
		return [t, n];
	}
	function o(e, n = e.schema) {
		let { gen: i, data: a, it: o } = e;
		if (Object.keys(n).length === 0) return;
		let s = i.let("missing");
		for (let c in n) {
			let l = n[c];
			if (l.length === 0) continue;
			let u = (0, r.propertyInData)(i, a, c, o.opts.ownProperties);
			e.setParams({
				property: c,
				depsCount: l.length,
				deps: l.join(", ")
			}), o.allErrors ? i.if(u, () => {
				for (let t of l) (0, r.checkReportMissingProp)(e, t);
			}) : (i.if((0, t._)`${u} && (${(0, r.checkMissingProp)(e, l, s)})`), (0, r.reportMissingProp)(e, s), i.else());
		}
	}
	e.validatePropertyDeps = o;
	function s(e, t = e.schema) {
		let { gen: i, data: a, keyword: o, it: s } = e, c = i.name("valid");
		for (let l in t) (0, n.alwaysValidSchema)(s, t[l]) || (i.if((0, r.propertyInData)(i, a, l, s.opts.ownProperties), () => {
			let t = e.subschema({
				keyword: o,
				schemaProp: l
			}, c);
			e.mergeValidEvaluated(t, c);
		}, () => i.var(c, !0)), e.ok(c));
	}
	e.validateSchemaDeps = s, e.default = i;
})), Vf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X(), n = Z();
	e.default = {
		keyword: "propertyNames",
		type: "object",
		schemaType: ["object", "boolean"],
		error: {
			message: "property name must be valid",
			params: ({ params: e }) => (0, t._)`{propertyName: ${e.propertyName}}`
		},
		code(e) {
			let { gen: r, schema: i, data: a, it: o } = e;
			if ((0, n.alwaysValidSchema)(o, i)) return;
			let s = r.name("valid");
			r.forIn("key", a, (n) => {
				e.setParams({ propertyName: n }), e.subschema({
					keyword: "propertyNames",
					data: n,
					dataTypes: ["string"],
					propertyName: n,
					compositeRule: !0
				}, s), r.if((0, t.not)(s), () => {
					e.error(!0), o.allErrors || r.break();
				});
			}), e.ok(s);
		}
	};
})), Hf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = Yd(), n = X(), r = Hd(), i = Z();
	e.default = {
		keyword: "additionalProperties",
		type: ["object"],
		schemaType: ["boolean", "object"],
		allowUndefined: !0,
		trackErrors: !0,
		error: {
			message: "must NOT have additional properties",
			params: ({ params: e }) => (0, n._)`{additionalProperty: ${e.additionalProperty}}`
		},
		code(e) {
			let { gen: a, schema: o, parentSchema: s, data: c, errsCount: l, it: u } = e;
			/* istanbul ignore if */
			if (!l) throw Error("ajv implementation error");
			let { allErrors: d, opts: f } = u;
			if (u.props = !0, f.removeAdditional !== "all" && (0, i.alwaysValidSchema)(u, o)) return;
			let p = (0, t.allSchemaProperties)(s.properties), m = (0, t.allSchemaProperties)(s.patternProperties);
			h(), e.ok((0, n._)`${l} === ${r.default.errors}`);
			function h() {
				a.forIn("key", c, (e) => {
					!p.length && !m.length ? v(e) : a.if(g(e), () => v(e));
				});
			}
			function g(r) {
				let o;
				if (p.length > 8) {
					let e = (0, i.schemaRefOrVal)(u, s.properties, "properties");
					o = (0, t.isOwnProperty)(a, e, r);
				} else o = p.length ? (0, n.or)(...p.map((e) => (0, n._)`${r} === ${e}`)) : n.nil;
				return m.length && (o = (0, n.or)(o, ...m.map((i) => (0, n._)`${(0, t.usePattern)(e, i)}.test(${r})`))), (0, n.not)(o);
			}
			function _(e) {
				a.code((0, n._)`delete ${c}[${e}]`);
			}
			function v(t) {
				if (f.removeAdditional === "all" || f.removeAdditional && o === !1) {
					_(t);
					return;
				}
				if (o === !1) {
					e.setParams({ additionalProperty: t }), e.error(), d || a.break();
					return;
				}
				if (typeof o == "object" && !(0, i.alwaysValidSchema)(u, o)) {
					let r = a.name("valid");
					f.removeAdditional === "failing" ? (y(t, r, !1), a.if((0, n.not)(r), () => {
						e.reset(), _(t);
					})) : (y(t, r), d || a.if((0, n.not)(r), () => a.break()));
				}
			}
			function y(t, n, r) {
				let a = {
					keyword: "additionalProperties",
					dataProp: t,
					dataPropType: i.Type.Str
				};
				r === !1 && Object.assign(a, {
					compositeRule: !0,
					createErrors: !1,
					allErrors: !1
				}), e.subschema(a, n);
			}
		}
	};
})), Uf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = tf(), n = Yd(), r = Z(), i = Hf();
	e.default = {
		keyword: "properties",
		type: "object",
		schemaType: "object",
		code(e) {
			let { gen: a, schema: o, parentSchema: s, data: c, it: l } = e;
			l.opts.removeAdditional === "all" && s.additionalProperties === void 0 && i.default.code(new t.KeywordCxt(l, i.default, "additionalProperties"));
			let u = (0, n.allSchemaProperties)(o);
			for (let e of u) l.definedProperties.add(e);
			l.opts.unevaluated && u.length && l.props !== !0 && (l.props = r.mergeEvaluated.props(a, (0, r.toHash)(u), l.props));
			let d = u.filter((e) => !(0, r.alwaysValidSchema)(l, o[e]));
			if (d.length === 0) return;
			let f = a.name("valid");
			for (let t of d) p(t) ? m(t) : (a.if((0, n.propertyInData)(a, c, t, l.opts.ownProperties)), m(t), l.allErrors || a.else().var(f, !0), a.endIf()), e.it.definedProperties.add(t), e.ok(f);
			function p(e) {
				return l.opts.useDefaults && !l.compositeRule && o[e].default !== void 0;
			}
			function m(t) {
				e.subschema({
					keyword: "properties",
					schemaProp: t,
					dataProp: t
				}, f);
			}
		}
	};
})), Wf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = Yd(), n = X(), r = Z(), i = Z();
	e.default = {
		keyword: "patternProperties",
		type: "object",
		schemaType: "object",
		code(e) {
			let { gen: a, schema: o, data: s, parentSchema: c, it: l } = e, { opts: u } = l, d = (0, t.allSchemaProperties)(o), f = d.filter((e) => (0, r.alwaysValidSchema)(l, o[e]));
			if (d.length === 0 || f.length === d.length && (!l.opts.unevaluated || l.props === !0)) return;
			let p = u.strictSchema && !u.allowMatchingProperties && c.properties, m = a.name("valid");
			l.props !== !0 && !(l.props instanceof n.Name) && (l.props = (0, i.evaluatedPropsToName)(a, l.props));
			let { props: h } = l;
			g();
			function g() {
				for (let e of d) p && _(e), l.allErrors ? v(e) : (a.var(m, !0), v(e), a.if(m));
			}
			function _(e) {
				for (let t in p) new RegExp(e).test(t) && (0, r.checkStrictMode)(l, `property ${t} matches pattern ${e} (use allowMatchingProperties)`);
			}
			function v(r) {
				a.forIn("key", s, (o) => {
					a.if((0, n._)`${(0, t.usePattern)(e, r)}.test(${o})`, () => {
						let t = f.includes(r);
						t || e.subschema({
							keyword: "patternProperties",
							schemaProp: r,
							dataProp: o,
							dataPropType: i.Type.Str
						}, m), l.opts.unevaluated && h !== !0 ? a.assign((0, n._)`${h}[${o}]`, !0) : !t && !l.allErrors && a.if((0, n.not)(m), () => a.break());
					});
				});
			}
		}
	};
})), Gf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = Z();
	e.default = {
		keyword: "not",
		schemaType: ["object", "boolean"],
		trackErrors: !0,
		code(e) {
			let { gen: n, schema: r, it: i } = e;
			if ((0, t.alwaysValidSchema)(i, r)) {
				e.fail();
				return;
			}
			let a = n.name("valid");
			e.subschema({
				keyword: "not",
				compositeRule: !0,
				createErrors: !1,
				allErrors: !1
			}, a), e.failResult(a, () => e.reset(), () => e.error());
		},
		error: { message: "must NOT be valid" }
	};
})), Kf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.default = {
		keyword: "anyOf",
		schemaType: "array",
		trackErrors: !0,
		code: Yd().validateUnion,
		error: { message: "must match a schema in anyOf" }
	};
})), qf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X(), n = Z();
	e.default = {
		keyword: "oneOf",
		schemaType: "array",
		trackErrors: !0,
		error: {
			message: "must match exactly one schema in oneOf",
			params: ({ params: e }) => (0, t._)`{passingSchemas: ${e.passing}}`
		},
		code(e) {
			let { gen: r, schema: i, parentSchema: a, it: o } = e;
			/* istanbul ignore if */
			if (!Array.isArray(i)) throw Error("ajv implementation error");
			if (o.opts.discriminator && a.discriminator) return;
			let s = i, c = r.let("valid", !1), l = r.let("passing", null), u = r.name("_valid");
			e.setParams({ passing: l }), r.block(d), e.result(c, () => e.reset(), () => e.error(!0));
			function d() {
				s.forEach((i, a) => {
					let s;
					(0, n.alwaysValidSchema)(o, i) ? r.var(u, !0) : s = e.subschema({
						keyword: "oneOf",
						schemaProp: a,
						compositeRule: !0
					}, u), a > 0 && r.if((0, t._)`${u} && ${c}`).assign(c, !1).assign(l, (0, t._)`[${l}, ${a}]`).else(), r.if(u, () => {
						r.assign(c, !0), r.assign(l, a), s && e.mergeEvaluated(s, t.Name);
					});
				});
			}
		}
	};
})), Jf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = Z();
	e.default = {
		keyword: "allOf",
		schemaType: "array",
		code(e) {
			let { gen: n, schema: r, it: i } = e;
			/* istanbul ignore if */
			if (!Array.isArray(r)) throw Error("ajv implementation error");
			let a = n.name("valid");
			r.forEach((n, r) => {
				if ((0, t.alwaysValidSchema)(i, n)) return;
				let o = e.subschema({
					keyword: "allOf",
					schemaProp: r
				}, a);
				e.ok(a), e.mergeEvaluated(o);
			});
		}
	};
})), Yf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X(), n = Z(), r = {
		keyword: "if",
		schemaType: ["object", "boolean"],
		trackErrors: !0,
		error: {
			message: ({ params: e }) => (0, t.str)`must match "${e.ifClause}" schema`,
			params: ({ params: e }) => (0, t._)`{failingKeyword: ${e.ifClause}}`
		},
		code(e) {
			let { gen: r, parentSchema: a, it: o } = e;
			a.then === void 0 && a.else === void 0 && (0, n.checkStrictMode)(o, "\"if\" without \"then\" and \"else\" is ignored");
			let s = i(o, "then"), c = i(o, "else");
			if (!s && !c) return;
			let l = r.let("valid", !0), u = r.name("_valid");
			if (d(), e.reset(), s && c) {
				let t = r.let("ifClause");
				e.setParams({ ifClause: t }), r.if(u, f("then", t), f("else", t));
			} else s ? r.if(u, f("then")) : r.if((0, t.not)(u), f("else"));
			e.pass(l, () => e.error(!0));
			function d() {
				let t = e.subschema({
					keyword: "if",
					compositeRule: !0,
					createErrors: !1,
					allErrors: !1
				}, u);
				e.mergeEvaluated(t);
			}
			function f(n, i) {
				return () => {
					let a = e.subschema({ keyword: n }, u);
					r.assign(l, u), e.mergeValidEvaluated(a, l), i ? r.assign(i, (0, t._)`${n}`) : e.setParams({ ifClause: n });
				};
			}
		}
	};
	function i(e, t) {
		let r = e.schema[t];
		return r !== void 0 && !(0, n.alwaysValidSchema)(e, r);
	}
	e.default = r;
})), Xf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = Z();
	e.default = {
		keyword: ["then", "else"],
		schemaType: ["object", "boolean"],
		code({ keyword: e, parentSchema: n, it: r }) {
			n.if === void 0 && (0, t.checkStrictMode)(r, `"${e}" without "if" is ignored`);
		}
	};
})), Zf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = Ff(), n = Lf(), r = If(), i = Rf(), a = zf(), o = Bf(), s = Vf(), c = Hf(), l = Uf(), u = Wf(), d = Gf(), f = Kf(), p = qf(), m = Jf(), h = Yf(), g = Xf();
	function _(e = !1) {
		let _ = [
			d.default,
			f.default,
			p.default,
			m.default,
			h.default,
			g.default,
			s.default,
			c.default,
			o.default,
			l.default,
			u.default
		];
		return e ? _.push(n.default, i.default) : _.push(t.default, r.default), _.push(a.default), _;
	}
	e.default = _;
})), Qf = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X();
	e.default = {
		keyword: "format",
		type: ["number", "string"],
		schemaType: "string",
		$data: !0,
		error: {
			message: ({ schemaCode: e }) => (0, t.str)`must match format "${e}"`,
			params: ({ schemaCode: e }) => (0, t._)`{format: ${e}}`
		},
		code(e, n) {
			let { gen: r, data: i, $data: a, schema: o, schemaCode: s, it: c } = e, { opts: l, errSchemaPath: u, schemaEnv: d, self: f } = c;
			if (!l.validateFormats) return;
			a ? p() : m();
			function p() {
				let a = r.scopeValue("formats", {
					ref: f.formats,
					code: l.code.formats
				}), o = r.const("fDef", (0, t._)`${a}[${s}]`), c = r.let("fType"), u = r.let("format");
				r.if((0, t._)`typeof ${o} == "object" && !(${o} instanceof RegExp)`, () => r.assign(c, (0, t._)`${o}.type || "string"`).assign(u, (0, t._)`${o}.validate`), () => r.assign(c, (0, t._)`"string"`).assign(u, o)), e.fail$data((0, t.or)(p(), m()));
				function p() {
					return l.strictSchema === !1 ? t.nil : (0, t._)`${s} && !${u}`;
				}
				function m() {
					let e = d.$async ? (0, t._)`(${o}.async ? await ${u}(${i}) : ${u}(${i}))` : (0, t._)`${u}(${i})`, r = (0, t._)`(typeof ${u} == "function" ? ${e} : ${u}.test(${i}))`;
					return (0, t._)`${u} && ${u} !== true && ${c} === ${n} && !${r}`;
				}
			}
			function m() {
				let a = f.formats[o];
				if (!a) {
					m();
					return;
				}
				if (a === !0) return;
				let [s, c, p] = h(a);
				s === n && e.pass(g());
				function m() {
					if (l.strictSchema === !1) {
						f.logger.warn(e());
						return;
					}
					throw Error(e());
					function e() {
						return `unknown format "${o}" ignored in schema at path "${u}"`;
					}
				}
				function h(e) {
					let n = e instanceof RegExp ? (0, t.regexpCode)(e) : l.code.formats ? (0, t._)`${l.code.formats}${(0, t.getProperty)(o)}` : void 0, i = r.scopeValue("formats", {
						key: o,
						ref: e,
						code: n
					});
					return typeof e == "object" && !(e instanceof RegExp) ? [
						e.type || "string",
						e.validate,
						(0, t._)`${i}.validate`
					] : [
						"string",
						e,
						i
					];
				}
				function g() {
					if (typeof a == "object" && !(a instanceof RegExp) && a.async) {
						if (!d.$async) throw Error("async format in sync schema");
						return (0, t._)`await ${p}(${i})`;
					}
					return typeof c == "function" ? (0, t._)`${p}(${i})` : (0, t._)`${p}.test(${i})`;
				}
			}
		}
	};
})), $f = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.default = [Qf().default];
})), ep = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.contentVocabulary = e.metadataVocabulary = void 0, e.metadataVocabulary = [
		"title",
		"description",
		"default",
		"deprecated",
		"readOnly",
		"writeOnly",
		"examples"
	], e.contentVocabulary = [
		"contentMediaType",
		"contentEncoding",
		"contentSchema"
	];
})), tp = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = xf(), n = Pf(), r = Zf(), i = $f(), a = ep();
	e.default = [
		t.default,
		n.default,
		(0, r.default)(),
		i.default,
		a.metadataVocabulary,
		a.contentVocabulary
	];
})), np = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.DiscrError = void 0;
	var t;
	(function(e) {
		e.Tag = "tag", e.Mapping = "mapping";
	})(t || (e.DiscrError = t = {}));
})), rp = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var t = X(), n = np(), r = af(), i = rf(), a = Z();
	e.default = {
		keyword: "discriminator",
		type: "object",
		schemaType: "object",
		error: {
			message: ({ params: { discrError: e, tagName: t } }) => e === n.DiscrError.Tag ? `tag "${t}" must be string` : `value of tag "${t}" must be in oneOf`,
			params: ({ params: { discrError: e, tag: n, tagName: r } }) => (0, t._)`{error: ${e}, tag: ${r}, tagValue: ${n}}`
		},
		code(e) {
			let { gen: o, data: s, schema: c, parentSchema: l, it: u } = e, { oneOf: d } = l;
			if (!u.opts.discriminator) throw Error("discriminator: requires discriminator option");
			let f = c.propertyName;
			if (typeof f != "string") throw Error("discriminator: requires propertyName");
			if (c.mapping) throw Error("discriminator: mapping is not supported");
			if (!d) throw Error("discriminator: requires oneOf keyword");
			let p = o.let("valid", !1), m = o.const("tag", (0, t._)`${s}${(0, t.getProperty)(f)}`);
			o.if((0, t._)`typeof ${m} == "string"`, () => h(), () => e.error(!1, {
				discrError: n.DiscrError.Tag,
				tag: m,
				tagName: f
			})), e.ok(p);
			function h() {
				let r = _();
				o.if(!1);
				for (let e in r) o.elseIf((0, t._)`${m} === ${e}`), o.assign(p, g(r[e]));
				o.else(), e.error(!1, {
					discrError: n.DiscrError.Mapping,
					tag: m,
					tagName: f
				}), o.endIf();
			}
			function g(n) {
				let r = o.name("valid"), i = e.subschema({
					keyword: "oneOf",
					schemaProp: n
				}, r);
				return e.mergeEvaluated(i, t.Name), r;
			}
			function _() {
				let e = {}, t = o(l), n = !0;
				for (let e = 0; e < d.length; e++) {
					let c = d[e];
					if (c?.$ref && !(0, a.schemaHasRulesButRef)(c, u.self.RULES)) {
						let e = c.$ref;
						if (c = r.resolveRef.call(u.self, u.schemaEnv.root, u.baseId, e), c instanceof r.SchemaEnv && (c = c.schema), c === void 0) throw new i.default(u.opts.uriResolver, u.baseId, e);
					}
					let l = c?.properties?.[f];
					if (typeof l != "object") throw Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${f}"`);
					n &&= t || o(c), s(l, e);
				}
				if (!n) throw Error(`discriminator: "${f}" must be required`);
				return e;
				function o({ required: e }) {
					return Array.isArray(e) && e.includes(f);
				}
				function s(e, t) {
					if (e.const) c(e.const, t);
					else if (e.enum) for (let n of e.enum) c(n, t);
					else throw Error(`discriminator: "properties/${f}" must have "const" or "enum"`);
				}
				function c(t, n) {
					if (typeof t != "string" || t in e) throw Error(`discriminator: "${f}" values must be unique strings`);
					e[t] = n;
				}
			}
		}
	};
})), ip = /* @__PURE__ */ i({
	$id: () => op,
	$schema: () => ap,
	default: () => dp,
	definitions: () => cp,
	properties: () => up,
	title: () => sp,
	type: () => lp
}), ap, op, sp, cp, lp, up, dp, fp = n((() => {
	ap = "http://json-schema.org/draft-07/schema#", op = "http://json-schema.org/draft-07/schema#", sp = "Core schema meta-schema", cp = {
		schemaArray: {
			type: "array",
			minItems: 1,
			items: { $ref: "#" }
		},
		nonNegativeInteger: {
			type: "integer",
			minimum: 0
		},
		nonNegativeIntegerDefault0: { allOf: [{ $ref: "#/definitions/nonNegativeInteger" }, { default: 0 }] },
		simpleTypes: { enum: [
			"array",
			"boolean",
			"integer",
			"null",
			"number",
			"object",
			"string"
		] },
		stringArray: {
			type: "array",
			items: { type: "string" },
			uniqueItems: !0,
			default: []
		}
	}, lp = ["object", "boolean"], up = {
		$id: {
			type: "string",
			format: "uri-reference"
		},
		$schema: {
			type: "string",
			format: "uri"
		},
		$ref: {
			type: "string",
			format: "uri-reference"
		},
		$comment: { type: "string" },
		title: { type: "string" },
		description: { type: "string" },
		default: !0,
		readOnly: {
			type: "boolean",
			default: !1
		},
		examples: {
			type: "array",
			items: !0
		},
		multipleOf: {
			type: "number",
			exclusiveMinimum: 0
		},
		maximum: { type: "number" },
		exclusiveMaximum: { type: "number" },
		minimum: { type: "number" },
		exclusiveMinimum: { type: "number" },
		maxLength: { $ref: "#/definitions/nonNegativeInteger" },
		minLength: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
		pattern: {
			type: "string",
			format: "regex"
		},
		additionalItems: { $ref: "#" },
		items: {
			anyOf: [{ $ref: "#" }, { $ref: "#/definitions/schemaArray" }],
			default: !0
		},
		maxItems: { $ref: "#/definitions/nonNegativeInteger" },
		minItems: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
		uniqueItems: {
			type: "boolean",
			default: !1
		},
		contains: { $ref: "#" },
		maxProperties: { $ref: "#/definitions/nonNegativeInteger" },
		minProperties: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
		required: { $ref: "#/definitions/stringArray" },
		additionalProperties: { $ref: "#" },
		definitions: {
			type: "object",
			additionalProperties: { $ref: "#" },
			default: {}
		},
		properties: {
			type: "object",
			additionalProperties: { $ref: "#" },
			default: {}
		},
		patternProperties: {
			type: "object",
			additionalProperties: { $ref: "#" },
			propertyNames: { format: "regex" },
			default: {}
		},
		dependencies: {
			type: "object",
			additionalProperties: { anyOf: [{ $ref: "#" }, { $ref: "#/definitions/stringArray" }] }
		},
		propertyNames: { $ref: "#" },
		const: !0,
		enum: {
			type: "array",
			items: !0,
			minItems: 1,
			uniqueItems: !0
		},
		type: { anyOf: [{ $ref: "#/definitions/simpleTypes" }, {
			type: "array",
			items: { $ref: "#/definitions/simpleTypes" },
			minItems: 1,
			uniqueItems: !0
		}] },
		format: { type: "string" },
		contentMediaType: { type: "string" },
		contentEncoding: { type: "string" },
		if: { $ref: "#" },
		then: { $ref: "#" },
		else: { $ref: "#" },
		allOf: { $ref: "#/definitions/schemaArray" },
		anyOf: { $ref: "#/definitions/schemaArray" },
		oneOf: { $ref: "#/definitions/schemaArray" },
		not: { $ref: "#" }
	}, dp = {
		$schema: ap,
		$id: op,
		title: sp,
		definitions: cp,
		type: lp,
		properties: up,
		default: !0
	};
})), pp = /* @__PURE__ */ a(((t, n) => {
	Object.defineProperty(t, "__esModule", { value: !0 }), t.MissingRefError = t.ValidationError = t.CodeGen = t.Name = t.nil = t.stringify = t.str = t._ = t.KeywordCxt = t.Ajv = void 0;
	var r = vf(), i = tp(), a = rp(), o = (fp(), e(ip).default), s = ["/properties"], c = "http://json-schema.org/draft-07/schema", l = class extends r.default {
		_addVocabularies() {
			super._addVocabularies(), i.default.forEach((e) => this.addVocabulary(e)), this.opts.discriminator && this.addKeyword(a.default);
		}
		_addDefaultMetaSchema() {
			if (super._addDefaultMetaSchema(), !this.opts.meta) return;
			let e = this.opts.$data ? this.$dataMetaSchema(o, s) : o;
			this.addMetaSchema(e, c, !1), this.refs["http://json-schema.org/schema"] = c;
		}
		defaultMeta() {
			return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(c) ? c : void 0);
		}
	};
	t.Ajv = l, n.exports = t = l, n.exports.Ajv = l, Object.defineProperty(t, "__esModule", { value: !0 }), t.default = l;
	var u = tf();
	Object.defineProperty(t, "KeywordCxt", {
		enumerable: !0,
		get: function() {
			return u.KeywordCxt;
		}
	});
	var d = X();
	Object.defineProperty(t, "_", {
		enumerable: !0,
		get: function() {
			return d._;
		}
	}), Object.defineProperty(t, "str", {
		enumerable: !0,
		get: function() {
			return d.str;
		}
	}), Object.defineProperty(t, "stringify", {
		enumerable: !0,
		get: function() {
			return d.stringify;
		}
	}), Object.defineProperty(t, "nil", {
		enumerable: !0,
		get: function() {
			return d.nil;
		}
	}), Object.defineProperty(t, "Name", {
		enumerable: !0,
		get: function() {
			return d.Name;
		}
	}), Object.defineProperty(t, "CodeGen", {
		enumerable: !0,
		get: function() {
			return d.CodeGen;
		}
	});
	var f = nf();
	Object.defineProperty(t, "ValidationError", {
		enumerable: !0,
		get: function() {
			return f.default;
		}
	});
	var p = rf();
	Object.defineProperty(t, "MissingRefError", {
		enumerable: !0,
		get: function() {
			return p.default;
		}
	});
})), mp = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.formatNames = e.fastFormats = e.fullFormats = void 0;
	function t(e, t) {
		return {
			validate: e,
			compare: t
		};
	}
	e.fullFormats = {
		date: t(a, o),
		time: t(c(!0), l),
		"date-time": t(f(!0), p),
		"iso-time": t(c(), u),
		"iso-date-time": t(f(), m),
		duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
		uri: _,
		"uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
		"uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
		url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
		email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
		hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
		ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
		ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
		regex: ne,
		uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
		"json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
		"json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
		"relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
		byte: y,
		int32: {
			type: "number",
			validate: S
		},
		int64: {
			type: "number",
			validate: C
		},
		float: {
			type: "number",
			validate: ee
		},
		double: {
			type: "number",
			validate: ee
		},
		password: !0,
		binary: !0
	}, e.fastFormats = {
		...e.fullFormats,
		date: t(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, o),
		time: t(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, l),
		"date-time": t(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, p),
		"iso-time": t(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, u),
		"iso-date-time": t(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, m),
		uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
		"uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
		email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
	}, e.formatNames = Object.keys(e.fullFormats);
	function n(e) {
		return e % 4 == 0 && (e % 100 != 0 || e % 400 == 0);
	}
	var r = /^(\d\d\d\d)-(\d\d)-(\d\d)$/, i = [
		0,
		31,
		28,
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31
	];
	function a(e) {
		let t = r.exec(e);
		if (!t) return !1;
		let a = +t[1], o = +t[2], s = +t[3];
		return o >= 1 && o <= 12 && s >= 1 && s <= (o === 2 && n(a) ? 29 : i[o]);
	}
	function o(e, t) {
		if (e && t) return e > t ? 1 : e < t ? -1 : 0;
	}
	var s = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
	function c(e) {
		return function(t) {
			let n = s.exec(t);
			if (!n) return !1;
			let r = +n[1], i = +n[2], a = +n[3], o = n[4], c = n[5] === "-" ? -1 : 1, l = +(n[6] || 0), u = +(n[7] || 0);
			if (l > 23 || u > 59 || e && !o) return !1;
			if (r <= 23 && i <= 59 && a < 60) return !0;
			let d = i - u * c, f = r - l * c - +(d < 0);
			return (f === 23 || f === -1) && (d === 59 || d === -1) && a < 61;
		};
	}
	function l(e, t) {
		if (!(e && t)) return;
		let n = (/* @__PURE__ */ new Date("2020-01-01T" + e)).valueOf(), r = (/* @__PURE__ */ new Date("2020-01-01T" + t)).valueOf();
		if (n && r) return n - r;
	}
	function u(e, t) {
		if (!(e && t)) return;
		let n = s.exec(e), r = s.exec(t);
		if (n && r) return e = n[1] + n[2] + n[3], t = r[1] + r[2] + r[3], e > t ? 1 : e < t ? -1 : 0;
	}
	var d = /t|\s/i;
	function f(e) {
		let t = c(e);
		return function(e) {
			let n = e.split(d);
			return n.length === 2 && a(n[0]) && t(n[1]);
		};
	}
	function p(e, t) {
		if (!(e && t)) return;
		let n = new Date(e).valueOf(), r = new Date(t).valueOf();
		if (n && r) return n - r;
	}
	function m(e, t) {
		if (!(e && t)) return;
		let [n, r] = e.split(d), [i, a] = t.split(d), s = o(n, i);
		if (s !== void 0) return s || l(r, a);
	}
	var h = /\/|:/, g = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
	function _(e) {
		return h.test(e) && g.test(e);
	}
	var v = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
	function y(e) {
		return v.lastIndex = 0, v.test(e);
	}
	var b = -(2 ** 31), x = 2 ** 31 - 1;
	function S(e) {
		return Number.isInteger(e) && e <= x && e >= b;
	}
	function C(e) {
		return Number.isInteger(e);
	}
	function ee() {
		return !0;
	}
	var te = /[^\\]\\Z/;
	function ne(e) {
		if (te.test(e)) return !1;
		try {
			return new RegExp(e), !0;
		} catch {
			return !1;
		}
	}
})), hp = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.formatLimitDefinition = void 0;
	var t = pp(), n = X(), r = n.operators, i = {
		formatMaximum: {
			okStr: "<=",
			ok: r.LTE,
			fail: r.GT
		},
		formatMinimum: {
			okStr: ">=",
			ok: r.GTE,
			fail: r.LT
		},
		formatExclusiveMaximum: {
			okStr: "<",
			ok: r.LT,
			fail: r.GTE
		},
		formatExclusiveMinimum: {
			okStr: ">",
			ok: r.GT,
			fail: r.LTE
		}
	};
	e.formatLimitDefinition = {
		keyword: Object.keys(i),
		type: "string",
		schemaType: "string",
		$data: !0,
		error: {
			message: ({ keyword: e, schemaCode: t }) => (0, n.str)`should be ${i[e].okStr} ${t}`,
			params: ({ keyword: e, schemaCode: t }) => (0, n._)`{comparison: ${i[e].okStr}, limit: ${t}}`
		},
		code(e) {
			let { gen: r, data: a, schemaCode: o, keyword: s, it: c } = e, { opts: l, self: u } = c;
			if (!l.validateFormats) return;
			let d = new t.KeywordCxt(c, u.RULES.all.format.definition, "format");
			d.$data ? f() : p();
			function f() {
				let t = r.scopeValue("formats", {
					ref: u.formats,
					code: l.code.formats
				}), i = r.const("fmt", (0, n._)`${t}[${d.schemaCode}]`);
				e.fail$data((0, n.or)((0, n._)`typeof ${i} != "object"`, (0, n._)`${i} instanceof RegExp`, (0, n._)`typeof ${i}.compare != "function"`, m(i)));
			}
			function p() {
				let t = d.schema, i = u.formats[t];
				if (!i || i === !0) return;
				if (typeof i != "object" || i instanceof RegExp || typeof i.compare != "function") throw Error(`"${s}": format "${t}" does not define "compare" function`);
				let a = r.scopeValue("formats", {
					key: t,
					ref: i,
					code: l.code.formats ? (0, n._)`${l.code.formats}${(0, n.getProperty)(t)}` : void 0
				});
				e.fail$data(m(a));
			}
			function m(e) {
				return (0, n._)`${e}.compare(${a}, ${o}) ${i[s].fail} 0`;
			}
		},
		dependencies: ["format"]
	}, e.default = (t) => (t.addKeyword(e.formatLimitDefinition), t);
})), gp = /* @__PURE__ */ a(((e, t) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
	var n = mp(), r = hp(), i = X(), a = new i.Name("fullFormats"), o = new i.Name("fastFormats"), s = (e, t = { keywords: !0 }) => {
		if (Array.isArray(t)) return c(e, t, n.fullFormats, a), e;
		let [i, s] = t.mode === "fast" ? [n.fastFormats, o] : [n.fullFormats, a];
		return c(e, t.formats || n.formatNames, i, s), t.keywords && (0, r.default)(e), e;
	};
	s.get = (e, t = "full") => {
		let r = (t === "fast" ? n.fastFormats : n.fullFormats)[e];
		if (!r) throw Error(`Unknown format "${e}"`);
		return r;
	};
	function c(e, t, n, r) {
		var a;
		(a = e.opts.code).formats ?? (a.formats = (0, i._)`require("ajv-formats/dist/formats").${r}`);
		for (let r of t) e.addFormat(r, n[r]);
	}
	t.exports = e = s, Object.defineProperty(e, "__esModule", { value: !0 }), e.default = s;
})), _p = /* @__PURE__ */ r(pp(), 1), vp = /* @__PURE__ */ r(gp(), 1);
function yp() {
	let e = new _p.default({
		strict: !1,
		validateFormats: !0,
		validateSchema: !1,
		allErrors: !0
	});
	return (0, vp.default)(e), e;
}
var bp = class {
	constructor(e) {
		this._ajv = e ?? yp();
	}
	getValidator(e) {
		let t = "$id" in e && typeof e.$id == "string" ? this._ajv.getSchema(e.$id) ?? this._ajv.compile(e) : this._ajv.compile(e);
		return (e) => t(e) ? {
			valid: !0,
			data: e,
			errorMessage: void 0
		} : {
			valid: !1,
			data: void 0,
			errorMessage: this._ajv.errorsText(t.errors)
		};
	}
}, xp = class {
	constructor(e) {
		this._server = e;
	}
	requestStream(e, t, n) {
		return this._server.requestStream(e, t, n);
	}
	createMessageStream(e, t) {
		let n = this._server.getClientCapabilities();
		if ((e.tools || e.toolChoice) && !n?.sampling?.tools) throw Error("Client does not support sampling tools capability.");
		if (e.messages.length > 0) {
			let t = e.messages[e.messages.length - 1], n = Array.isArray(t.content) ? t.content : [t.content], r = n.some((e) => e.type === "tool_result"), i = e.messages.length > 1 ? e.messages[e.messages.length - 2] : void 0, a = i ? Array.isArray(i.content) ? i.content : [i.content] : [], o = a.some((e) => e.type === "tool_use");
			if (r) {
				if (n.some((e) => e.type !== "tool_result")) throw Error("The last message must contain only tool_result content if any is present");
				if (!o) throw Error("tool_result blocks are not matching any tool_use from the previous message");
			}
			if (o) {
				let e = new Set(a.filter((e) => e.type === "tool_use").map((e) => e.id)), t = new Set(n.filter((e) => e.type === "tool_result").map((e) => e.toolUseId));
				if (e.size !== t.size || ![...e].every((e) => t.has(e))) throw Error("ids of tool_result blocks and tool_use blocks from previous message do not match");
			}
		}
		return this.requestStream({
			method: "sampling/createMessage",
			params: e
		}, su, t);
	}
	elicitInputStream(e, t) {
		let n = this._server.getClientCapabilities(), r = e.mode ?? "form";
		switch (r) {
			case "url":
				if (!n?.elicitation?.url) throw Error("Client does not support url elicitation.");
				break;
			case "form": if (!n?.elicitation?.form) throw Error("Client does not support form elicitation.");
		}
		let i = r === "form" && e.mode === void 0 ? {
			...e,
			mode: "form"
		} : e;
		return this.requestStream({
			method: "elicitation/create",
			params: i
		}, yu, t);
	}
	async getTask(e, t) {
		return this._server.getTask({ taskId: e }, t);
	}
	async getTaskResult(e, t, n) {
		return this._server.getTaskResult({ taskId: e }, t, n);
	}
	async listTasks(e, t) {
		return this._server.listTasks(e ? { cursor: e } : void 0, t);
	}
	async cancelTask(e, t) {
		return this._server.cancelTask({ taskId: e }, t);
	}
};
//#endregion
//#region node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/helpers.js
function Sp(e, t, n) {
	if (!e) throw Error(`${n} does not support task creation (required for ${t})`);
	if (t === "tools/call" && !e.tools?.call) throw Error(`${n} does not support task creation for tools/call (required for ${t})`);
}
function Cp(e, t, n) {
	if (!e) throw Error(`${n} does not support task creation (required for ${t})`);
	switch (t) {
		case "sampling/createMessage":
			if (!e.sampling?.createMessage) throw Error(`${n} does not support task creation for sampling/createMessage (required for ${t})`);
			break;
		case "elicitation/create": if (!e.elicitation?.create) throw Error(`${n} does not support task creation for elicitation/create (required for ${t})`);
	}
}
//#endregion
//#region node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js
var wp = class extends Ld {
	constructor(e, t) {
		super(t), this._serverInfo = e, this._loggingLevels = /* @__PURE__ */ new Map(), this.LOG_LEVEL_SEVERITY = new Map(Jl.options.map((e, t) => [e, t])), this.isMessageIgnored = (e, t) => {
			let n = this._loggingLevels.get(t);
			return n ? this.LOG_LEVEL_SEVERITY.get(e) < this.LOG_LEVEL_SEVERITY.get(n) : !1;
		}, this._capabilities = t?.capabilities ?? {}, this._instructions = t?.instructions, this._jsonSchemaValidator = t?.jsonSchemaValidator ?? new bp(), this.setRequestHandler(Mc, (e) => this._oninitialize(e)), this.setNotificationHandler(Fc, () => this.oninitialized?.()), this._capabilities.logging && this.setRequestHandler(Xl, async (e, t) => {
			let n = t.sessionId || t.requestInfo?.headers["mcp-session-id"] || void 0, { level: r } = e.params, i = Jl.safeParse(r);
			return i.success && this._loggingLevels.set(n, i.data), {};
		});
	}
	get experimental() {
		return this._experimental ||= { tasks: new xp(this) }, this._experimental;
	}
	registerCapabilities(e) {
		if (this.transport) throw Error("Cannot register capabilities after connecting to transport");
		this._capabilities = zd(this._capabilities, e);
	}
	setRequestHandler(e, t) {
		let n = po(e)?.method;
		if (!n) throw Error("Schema is missing a method literal");
		let r = yo(n);
		if (typeof r != "string") throw Error("Schema method literal must be a string");
		return r === "tools/call" ? super.setRequestHandler(e, async (e, n) => {
			let r = uo(Kl, e);
			if (!r.success) {
				let e = r.error instanceof Error ? r.error.message : String(r.error);
				throw new q(K.InvalidParams, `Invalid tools/call request: ${e}`);
			}
			let { params: i } = r.data, a = await Promise.resolve(t(e, n));
			if (i.task) {
				let e = uo(Gc, a);
				if (!e.success) {
					let t = e.error instanceof Error ? e.error.message : String(e.error);
					throw new q(K.InvalidParams, `Invalid task creation result: ${t}`);
				}
				return e.data;
			}
			let o = uo(Wl, a);
			if (!o.success) {
				let e = o.error instanceof Error ? o.error.message : String(o.error);
				throw new q(K.InvalidParams, `Invalid tools/call result: ${e}`);
			}
			return o.data;
		}) : super.setRequestHandler(e, t);
	}
	assertCapabilityForMethod(e) {
		switch (e) {
			case "sampling/createMessage":
				if (!this._clientCapabilities?.sampling) throw Error(`Client does not support sampling (required for ${e})`);
				break;
			case "elicitation/create":
				if (!this._clientCapabilities?.elicitation) throw Error(`Client does not support elicitation (required for ${e})`);
				break;
			case "roots/list": if (!this._clientCapabilities?.roots) throw Error(`Client does not support listing roots (required for ${e})`);
		}
	}
	assertNotificationCapability(e) {
		switch (e) {
			case "notifications/message":
				if (!this._capabilities.logging) throw Error(`Server does not support logging (required for ${e})`);
				break;
			case "notifications/resources/updated":
			case "notifications/resources/list_changed":
				if (!this._capabilities.resources) throw Error(`Server does not support notifying about resources (required for ${e})`);
				break;
			case "notifications/tools/list_changed":
				if (!this._capabilities.tools) throw Error(`Server does not support notifying of tool list changes (required for ${e})`);
				break;
			case "notifications/prompts/list_changed":
				if (!this._capabilities.prompts) throw Error(`Server does not support notifying of prompt list changes (required for ${e})`);
				break;
			case "notifications/elicitation/complete": if (!this._clientCapabilities?.elicitation?.url) throw Error(`Client does not support URL elicitation (required for ${e})`);
		}
	}
	assertRequestHandlerCapability(e) {
		if (this._capabilities) switch (e) {
			case "completion/complete":
				if (!this._capabilities.completions) throw Error(`Server does not support completions (required for ${e})`);
				break;
			case "logging/setLevel":
				if (!this._capabilities.logging) throw Error(`Server does not support logging (required for ${e})`);
				break;
			case "prompts/get":
			case "prompts/list":
				if (!this._capabilities.prompts) throw Error(`Server does not support prompts (required for ${e})`);
				break;
			case "resources/list":
			case "resources/templates/list":
			case "resources/read":
				if (!this._capabilities.resources) throw Error(`Server does not support resources (required for ${e})`);
				break;
			case "tools/call":
			case "tools/list":
				if (!this._capabilities.tools) throw Error(`Server does not support tools (required for ${e})`);
				break;
			case "tasks/get":
			case "tasks/list":
			case "tasks/result":
			case "tasks/cancel": if (!this._capabilities.tasks) throw Error(`Server does not support tasks capability (required for ${e})`);
		}
	}
	assertTaskCapability(e) {
		Cp(this._clientCapabilities?.tasks?.requests, e, "Client");
	}
	assertTaskHandlerCapability(e) {
		this._capabilities && Sp(this._capabilities.tasks?.requests, e, "Server");
	}
	async _oninitialize(e) {
		let t = e.params.protocolVersion;
		return this._clientCapabilities = e.params.capabilities, this._clientVersion = e.params.clientInfo, {
			protocolVersion: Xs.includes(t) ? t : Ys,
			capabilities: this.getCapabilities(),
			serverInfo: this._serverInfo,
			...this._instructions && { instructions: this._instructions }
		};
	}
	getClientCapabilities() {
		return this._clientCapabilities;
	}
	getClientVersion() {
		return this._clientVersion;
	}
	getCapabilities() {
		return this._capabilities;
	}
	async ping() {
		return this.request({ method: "ping" }, xc);
	}
	async createMessage(e, t) {
		if ((e.tools || e.toolChoice) && !this._clientCapabilities?.sampling?.tools) throw Error("Client does not support sampling tools capability.");
		if (e.messages.length > 0) {
			let t = e.messages[e.messages.length - 1], n = Array.isArray(t.content) ? t.content : [t.content], r = n.some((e) => e.type === "tool_result"), i = e.messages.length > 1 ? e.messages[e.messages.length - 2] : void 0, a = i ? Array.isArray(i.content) ? i.content : [i.content] : [], o = a.some((e) => e.type === "tool_use");
			if (r) {
				if (n.some((e) => e.type !== "tool_result")) throw Error("The last message must contain only tool_result content if any is present");
				if (!o) throw Error("tool_result blocks are not matching any tool_use from the previous message");
			}
			if (o) {
				let e = new Set(a.filter((e) => e.type === "tool_use").map((e) => e.id)), t = new Set(n.filter((e) => e.type === "tool_result").map((e) => e.toolUseId));
				if (e.size !== t.size || ![...e].every((e) => t.has(e))) throw Error("ids of tool_result blocks and tool_use blocks from previous message do not match");
			}
		}
		return e.tools ? this.request({
			method: "sampling/createMessage",
			params: e
		}, cu, t) : this.request({
			method: "sampling/createMessage",
			params: e
		}, su, t);
	}
	async elicitInput(e, t) {
		switch (e.mode ?? "form") {
			case "url": {
				if (!this._clientCapabilities?.elicitation?.url) throw Error("Client does not support url elicitation.");
				let n = e;
				return this.request({
					method: "elicitation/create",
					params: n
				}, yu, t);
			}
			case "form": {
				if (!this._clientCapabilities?.elicitation?.form) throw Error("Client does not support form elicitation.");
				let n = e.mode === "form" ? e : {
					...e,
					mode: "form"
				}, r = await this.request({
					method: "elicitation/create",
					params: n
				}, yu, t);
				if (r.action === "accept" && r.content && n.requestedSchema) try {
					let e = this._jsonSchemaValidator.getValidator(n.requestedSchema)(r.content);
					if (!e.valid) throw new q(K.InvalidParams, `Elicitation response content does not match requested schema: ${e.errorMessage}`);
				} catch (e) {
					throw e instanceof q ? e : new q(K.InternalError, `Error validating elicitation response: ${e instanceof Error ? e.message : String(e)}`);
				}
				return r;
			}
		}
	}
	createElicitationCompletionNotifier(e, t) {
		if (!this._clientCapabilities?.elicitation?.url) throw Error("Client does not support URL elicitation (required for notifications/elicitation/complete)");
		return () => this.notification({
			method: "notifications/elicitation/complete",
			params: { elicitationId: e }
		}, t);
	}
	async listRoots(e, t) {
		return this.request({
			method: "roots/list",
			params: e
		}, ku, t);
	}
	async sendLoggingMessage(e, t) {
		if (this._capabilities.logging && !this.isMessageIgnored(e.level, t)) return this.notification({
			method: "notifications/message",
			params: e
		});
	}
	async sendResourceUpdated(e) {
		return this.notification({
			method: "notifications/resources/updated",
			params: e
		});
	}
	async sendResourceListChanged() {
		return this.notification({ method: "notifications/resources/list_changed" });
	}
	async sendToolListChanged() {
		return this.notification({ method: "notifications/tools/list_changed" });
	}
	async sendPromptListChanged() {
		return this.notification({ method: "notifications/prompts/list_changed" });
	}
}, Tp = Symbol.for("mcp.completable");
function Ep(e) {
	return !!e && typeof e == "object" && Tp in e;
}
function Dp(e) {
	return e[Tp]?.complete;
}
var Op;
(function(e) {
	e.Completable = "McpCompletable";
})(Op ||= {});
//#endregion
//#region node_modules/@modelcontextprotocol/sdk/dist/esm/shared/toolNameValidation.js
var kp = /^[A-Za-z0-9._-]{1,128}$/;
function Ap(e) {
	let t = [];
	if (e.length === 0) return {
		isValid: !1,
		warnings: ["Tool name cannot be empty"]
	};
	if (e.length > 128) return {
		isValid: !1,
		warnings: [`Tool name exceeds maximum length of 128 characters (current: ${e.length})`]
	};
	if (e.includes(" ") && t.push("Tool name contains spaces, which may cause parsing issues"), e.includes(",") && t.push("Tool name contains commas, which may cause parsing issues"), (e.startsWith("-") || e.endsWith("-")) && t.push("Tool name starts or ends with a dash, which may cause parsing issues in some contexts"), (e.startsWith(".") || e.endsWith(".")) && t.push("Tool name starts or ends with a dot, which may cause parsing issues in some contexts"), !kp.test(e)) {
		let n = e.split("").filter((e) => !/[A-Za-z0-9._-]/.test(e)).filter((e, t, n) => n.indexOf(e) === t);
		return t.push(`Tool name contains invalid characters: ${n.map((e) => `"${e}"`).join(", ")}`, "Allowed characters are: A-Z, a-z, 0-9, underscore (_), dash (-), and dot (.)"), {
			isValid: !1,
			warnings: t
		};
	}
	return {
		isValid: !0,
		warnings: t
	};
}
function jp(e, t) {
	if (t.length > 0) {
		console.warn(`Tool name validation warning for "${e}":`);
		for (let e of t) console.warn(`  - ${e}`);
		console.warn("Tool registration will proceed, but this may cause compatibility issues."), console.warn("Consider updating the tool name to conform to the MCP tool naming standard."), console.warn("See SEP: Specify Format for Tool Names (https://github.com/modelcontextprotocol/modelcontextprotocol/issues/986) for more details.");
	}
}
function Mp(e) {
	let t = Ap(e);
	return jp(e, t.warnings), t.isValid;
}
//#endregion
//#region node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/mcp-server.js
var Np = class {
	constructor(e) {
		this._mcpServer = e;
	}
	registerToolTask(e, t, n) {
		let r = {
			taskSupport: "required",
			...t.execution
		};
		if (r.taskSupport === "forbidden") throw Error(`Cannot register task-based tool '${e}' with taskSupport 'forbidden'. Use registerTool() instead.`);
		return this._mcpServer._createRegisteredTool(e, t.title, t.description, t.inputSchema, t.outputSchema, t.annotations, r, t._meta, n);
	}
}, Pp = class {
	constructor(e, t) {
		this._registeredResources = {}, this._registeredResourceTemplates = {}, this._registeredTools = {}, this._registeredPrompts = {}, this._toolHandlersInitialized = !1, this._completionHandlerInitialized = !1, this._resourceHandlersInitialized = !1, this._promptHandlersInitialized = !1, this.server = new wp(e, t);
	}
	get experimental() {
		return this._experimental ||= { tasks: new Np(this) }, this._experimental;
	}
	async connect(e) {
		return await this.server.connect(e);
	}
	async close() {
		await this.server.close();
	}
	setToolRequestHandlers() {
		this._toolHandlersInitialized ||= (this.server.assertCanSetRequestHandler(Vp(Hl)), this.server.assertCanSetRequestHandler(Vp(Kl)), this.server.registerCapabilities({ tools: { listChanged: !0 } }), this.server.setRequestHandler(Hl, () => ({ tools: Object.entries(this._registeredTools).filter(([, e]) => e.enabled).map(([e, t]) => {
			let n = {
				name: e,
				title: t.title,
				description: t.description,
				inputSchema: (() => {
					let e = mo(t.inputSchema);
					return e ? Pd(e, {
						strictUnions: !0,
						pipeStrategy: "input"
					}) : Fp;
				})(),
				annotations: t.annotations,
				execution: t.execution,
				_meta: t._meta
			};
			if (t.outputSchema) {
				let e = mo(t.outputSchema);
				e && (n.outputSchema = Pd(e, {
					strictUnions: !0,
					pipeStrategy: "output"
				}));
			}
			return n;
		}) })), this.server.setRequestHandler(Kl, async (e, t) => {
			try {
				let n = this._registeredTools[e.params.name];
				if (!n) throw new q(K.InvalidParams, `Tool ${e.params.name} not found`);
				if (!n.enabled) throw new q(K.InvalidParams, `Tool ${e.params.name} disabled`);
				let r = !!e.params.task, i = n.execution?.taskSupport, a = "createTask" in n.handler;
				if ((i === "required" || i === "optional") && !a) throw new q(K.InternalError, `Tool ${e.params.name} has taskSupport '${i}' but was not registered with registerToolTask`);
				if (i === "required" && !r) throw new q(K.MethodNotFound, `Tool ${e.params.name} requires task augmentation (taskSupport: 'required')`);
				if (i === "optional" && !r && a) return await this.handleAutomaticTaskPolling(n, e, t);
				let o = await this.validateToolInput(n, e.params.arguments, e.params.name), s = await this.executeToolHandler(n, o, t);
				return r || await this.validateToolOutput(n, s, e.params.name), s;
			} catch (e) {
				if (e instanceof q && e.code === K.UrlElicitationRequired) throw e;
				return this.createToolError(e instanceof Error ? e.message : String(e));
			}
		}), !0);
	}
	createToolError(e) {
		return {
			content: [{
				type: "text",
				text: e
			}],
			isError: !0
		};
	}
	async validateToolInput(e, t, n) {
		if (!e.inputSchema) return;
		let r = await fo(mo(e.inputSchema) ?? e.inputSchema, t);
		if (!r.success) {
			let e = go("error" in r ? r.error : "Unknown error");
			throw new q(K.InvalidParams, `Input validation error: Invalid arguments for tool ${n}: ${e}`);
		}
		return r.data;
	}
	async validateToolOutput(e, t, n) {
		if (!e.outputSchema || !("content" in t) || t.isError) return;
		if (!t.structuredContent) throw new q(K.InvalidParams, `Output validation error: Tool ${n} has an output schema but no structured content was provided`);
		let r = await fo(mo(e.outputSchema), t.structuredContent);
		if (!r.success) {
			let e = go("error" in r ? r.error : "Unknown error");
			throw new q(K.InvalidParams, `Output validation error: Invalid structured content for tool ${n}: ${e}`);
		}
	}
	async executeToolHandler(e, t, n) {
		let r = e.handler;
		if ("createTask" in r) {
			if (!n.taskStore) throw Error("No task store provided.");
			let i = {
				...n,
				taskStore: n.taskStore
			};
			if (e.inputSchema) {
				let e = r;
				return await Promise.resolve(e.createTask(t, i));
			}
			{
				let e = r;
				return await Promise.resolve(e.createTask(i));
			}
		}
		if (e.inputSchema) {
			let e = r;
			return await Promise.resolve(e(t, n));
		}
		{
			let e = r;
			return await Promise.resolve(e(n));
		}
	}
	async handleAutomaticTaskPolling(e, t, n) {
		if (!n.taskStore) throw Error("No task store provided for task-capable tool.");
		let r = await this.validateToolInput(e, t.params.arguments, t.params.name), i = e.handler, a = {
			...n,
			taskStore: n.taskStore
		}, o = r ? await Promise.resolve(i.createTask(r, a)) : await Promise.resolve(i.createTask(a)), s = o.task.taskId, c = o.task, l = c.pollInterval ?? 5e3;
		for (; c.status !== "completed" && c.status !== "failed" && c.status !== "cancelled";) {
			await new Promise((e) => setTimeout(e, l));
			let e = await n.taskStore.getTask(s);
			if (!e) throw new q(K.InternalError, `Task ${s} not found during polling`);
			c = e;
		}
		return await n.taskStore.getTaskResult(s);
	}
	setCompletionRequestHandler() {
		this._completionHandlerInitialized ||= (this.server.assertCanSetRequestHandler(Vp(Cu)), this.server.registerCapabilities({ completions: {} }), this.server.setRequestHandler(Cu, async (e) => {
			switch (e.params.ref.type) {
				case "ref/prompt": return wu(e), this.handlePromptCompletion(e, e.params.ref);
				case "ref/resource": return Tu(e), this.handleResourceCompletion(e, e.params.ref);
				default: throw new q(K.InvalidParams, `Invalid completion reference: ${e.params.ref}`);
			}
		}), !0);
	}
	async handlePromptCompletion(e, t) {
		let n = this._registeredPrompts[t.name];
		if (!n) throw new q(K.InvalidParams, `Prompt ${t.name} not found`);
		if (!n.enabled) throw new q(K.InvalidParams, `Prompt ${t.name} disabled`);
		if (!n.argsSchema) return Up;
		let r = po(n.argsSchema)?.[e.params.argument.name];
		if (!Ep(r)) return Up;
		let i = Dp(r);
		return i ? Hp(await i(e.params.argument.value, e.params.context)) : Up;
	}
	async handleResourceCompletion(e, t) {
		let n = Object.values(this._registeredResourceTemplates).find((e) => e.resourceTemplate.uriTemplate.toString() === t.uri);
		if (!n) {
			if (this._registeredResources[t.uri]) return Up;
			throw new q(K.InvalidParams, `Resource template ${e.params.ref.uri} not found`);
		}
		let r = n.resourceTemplate.completeCallback(e.params.argument.name);
		return r ? Hp(await r(e.params.argument.value, e.params.context)) : Up;
	}
	setResourceRequestHandlers() {
		this._resourceHandlersInitialized ||= (this.server.assertCanSetRequestHandler(Vp(ll)), this.server.assertCanSetRequestHandler(Vp(dl)), this.server.assertCanSetRequestHandler(Vp(hl)), this.server.registerCapabilities({ resources: { listChanged: !0 } }), this.server.setRequestHandler(ll, async (e, t) => {
			let n = Object.entries(this._registeredResources).filter(([e, t]) => t.enabled).map(([e, t]) => ({
				uri: e,
				name: t.name,
				...t.metadata
			})), r = [];
			for (let e of Object.values(this._registeredResourceTemplates)) {
				if (!e.resourceTemplate.listCallback) continue;
				let n = await e.resourceTemplate.listCallback(t);
				for (let t of n.resources) r.push({
					...e.metadata,
					...t
				});
			}
			return { resources: [...n, ...r] };
		}), this.server.setRequestHandler(dl, async () => ({ resourceTemplates: Object.entries(this._registeredResourceTemplates).map(([e, t]) => ({
			name: e,
			uriTemplate: t.resourceTemplate.uriTemplate.toString(),
			...t.metadata
		})) })), this.server.setRequestHandler(hl, async (e, t) => {
			let n = new URL(e.params.uri), r = this._registeredResources[n.toString()];
			if (r) {
				if (!r.enabled) throw new q(K.InvalidParams, `Resource ${n} disabled`);
				return r.readCallback(n, t);
			}
			for (let e of Object.values(this._registeredResourceTemplates)) {
				let r = e.resourceTemplate.uriTemplate.match(n.toString());
				if (r) return e.readCallback(n, r, t);
			}
			throw new q(K.InvalidParams, `Resource ${n} not found`);
		}), !0);
	}
	setPromptRequestHandlers() {
		this._promptHandlersInitialized ||= (this.server.assertCanSetRequestHandler(Vp(El)), this.server.assertCanSetRequestHandler(Vp(kl)), this.server.registerCapabilities({ prompts: { listChanged: !0 } }), this.server.setRequestHandler(El, () => ({ prompts: Object.entries(this._registeredPrompts).filter(([, e]) => e.enabled).map(([e, t]) => ({
			name: e,
			title: t.title,
			description: t.description,
			arguments: t.argsSchema ? Bp(t.argsSchema) : void 0
		})) })), this.server.setRequestHandler(kl, async (e, t) => {
			let n = this._registeredPrompts[e.params.name];
			if (!n) throw new q(K.InvalidParams, `Prompt ${e.params.name} not found`);
			if (!n.enabled) throw new q(K.InvalidParams, `Prompt ${e.params.name} disabled`);
			if (n.argsSchema) {
				let r = await fo(mo(n.argsSchema), e.params.arguments);
				if (!r.success) {
					let t = go("error" in r ? r.error : "Unknown error");
					throw new q(K.InvalidParams, `Invalid arguments for prompt ${e.params.name}: ${t}`);
				}
				let i = r.data, a = n.callback;
				return await Promise.resolve(a(i, t));
			}
			{
				let e = n.callback;
				return await Promise.resolve(e(t));
			}
		}), !0);
	}
	resource(e, t, ...n) {
		let r;
		typeof n[0] == "object" && (r = n.shift());
		let i = n[0];
		if (typeof t == "string") {
			if (this._registeredResources[t]) throw Error(`Resource ${t} is already registered`);
			let n = this._createRegisteredResource(e, void 0, t, r, i);
			return this.setResourceRequestHandlers(), this.sendResourceListChanged(), n;
		}
		{
			if (this._registeredResourceTemplates[e]) throw Error(`Resource template ${e} is already registered`);
			let n = this._createRegisteredResourceTemplate(e, void 0, t, r, i);
			return this.setResourceRequestHandlers(), this.sendResourceListChanged(), n;
		}
	}
	registerResource(e, t, n, r) {
		if (typeof t == "string") {
			if (this._registeredResources[t]) throw Error(`Resource ${t} is already registered`);
			let i = this._createRegisteredResource(e, n.title, t, n, r);
			return this.setResourceRequestHandlers(), this.sendResourceListChanged(), i;
		}
		{
			if (this._registeredResourceTemplates[e]) throw Error(`Resource template ${e} is already registered`);
			let i = this._createRegisteredResourceTemplate(e, n.title, t, n, r);
			return this.setResourceRequestHandlers(), this.sendResourceListChanged(), i;
		}
	}
	_createRegisteredResource(e, t, n, r, i) {
		let a = {
			name: e,
			title: t,
			metadata: r,
			readCallback: i,
			enabled: !0,
			disable: () => a.update({ enabled: !1 }),
			enable: () => a.update({ enabled: !0 }),
			remove: () => a.update({ uri: null }),
			update: (e) => {
				e.uri !== void 0 && e.uri !== n && (delete this._registeredResources[n], e.uri && (this._registeredResources[e.uri] = a)), e.name !== void 0 && (a.name = e.name), e.title !== void 0 && (a.title = e.title), e.metadata !== void 0 && (a.metadata = e.metadata), e.callback !== void 0 && (a.readCallback = e.callback), e.enabled !== void 0 && (a.enabled = e.enabled), this.sendResourceListChanged();
			}
		};
		return this._registeredResources[n] = a, a;
	}
	_createRegisteredResourceTemplate(e, t, n, r, i) {
		let a = {
			resourceTemplate: n,
			title: t,
			metadata: r,
			readCallback: i,
			enabled: !0,
			disable: () => a.update({ enabled: !1 }),
			enable: () => a.update({ enabled: !0 }),
			remove: () => a.update({ name: null }),
			update: (t) => {
				t.name !== void 0 && t.name !== e && (delete this._registeredResourceTemplates[e], t.name && (this._registeredResourceTemplates[t.name] = a)), t.title !== void 0 && (a.title = t.title), t.template !== void 0 && (a.resourceTemplate = t.template), t.metadata !== void 0 && (a.metadata = t.metadata), t.callback !== void 0 && (a.readCallback = t.callback), t.enabled !== void 0 && (a.enabled = t.enabled), this.sendResourceListChanged();
			}
		};
		this._registeredResourceTemplates[e] = a;
		let o = n.uriTemplate.variableNames;
		return Array.isArray(o) && o.some((e) => !!n.completeCallback(e)) && this.setCompletionRequestHandler(), a;
	}
	_createRegisteredPrompt(e, t, n, r, i) {
		let a = {
			title: t,
			description: n,
			argsSchema: r === void 0 ? void 0 : lo(r),
			callback: i,
			enabled: !0,
			disable: () => a.update({ enabled: !1 }),
			enable: () => a.update({ enabled: !0 }),
			remove: () => a.update({ name: null }),
			update: (t) => {
				t.name !== void 0 && t.name !== e && (delete this._registeredPrompts[e], t.name && (this._registeredPrompts[t.name] = a)), t.title !== void 0 && (a.title = t.title), t.description !== void 0 && (a.description = t.description), t.argsSchema !== void 0 && (a.argsSchema = lo(t.argsSchema)), t.callback !== void 0 && (a.callback = t.callback), t.enabled !== void 0 && (a.enabled = t.enabled), this.sendPromptListChanged();
			}
		};
		return this._registeredPrompts[e] = a, r && Object.values(r).some((e) => Ep(e instanceof Ht ? e._def?.innerType : e)) && this.setCompletionRequestHandler(), a;
	}
	_createRegisteredTool(e, t, n, r, i, a, o, s, c) {
		Mp(e);
		let l = {
			title: t,
			description: n,
			inputSchema: zp(r),
			outputSchema: zp(i),
			annotations: a,
			execution: o,
			_meta: s,
			handler: c,
			enabled: !0,
			disable: () => l.update({ enabled: !1 }),
			enable: () => l.update({ enabled: !0 }),
			remove: () => l.update({ name: null }),
			update: (t) => {
				t.name !== void 0 && t.name !== e && (typeof t.name == "string" && Mp(t.name), delete this._registeredTools[e], t.name && (this._registeredTools[t.name] = l)), t.title !== void 0 && (l.title = t.title), t.description !== void 0 && (l.description = t.description), t.paramsSchema !== void 0 && (l.inputSchema = lo(t.paramsSchema)), t.outputSchema !== void 0 && (l.outputSchema = lo(t.outputSchema)), t.callback !== void 0 && (l.handler = t.callback), t.annotations !== void 0 && (l.annotations = t.annotations), t._meta !== void 0 && (l._meta = t._meta), t.enabled !== void 0 && (l.enabled = t.enabled), this.sendToolListChanged();
			}
		};
		return this._registeredTools[e] = l, this.setToolRequestHandlers(), this.sendToolListChanged(), l;
	}
	tool(e, ...t) {
		if (this._registeredTools[e]) throw Error(`Tool ${e} is already registered`);
		let n, r, i, a;
		if (typeof t[0] == "string" && (n = t.shift()), t.length > 1) {
			let n = t[0];
			if (Rp(n)) r = t.shift(), t.length > 1 && typeof t[0] == "object" && t[0] !== null && !Rp(t[0]) && (a = t.shift());
			else if (typeof n == "object" && n) {
				if (Object.values(n).some((e) => typeof e == "object" && !!e)) throw Error(`Tool ${e} expected a Zod schema or ToolAnnotations, but received an unrecognized object`);
				a = t.shift();
			}
		}
		let o = t[0];
		return this._createRegisteredTool(e, void 0, n, r, i, a, { taskSupport: "forbidden" }, void 0, o);
	}
	registerTool(e, t, n) {
		if (this._registeredTools[e]) throw Error(`Tool ${e} is already registered`);
		let { title: r, description: i, inputSchema: a, outputSchema: o, annotations: s, _meta: c } = t;
		return this._createRegisteredTool(e, r, i, a, o, s, { taskSupport: "forbidden" }, c, n);
	}
	prompt(e, ...t) {
		if (this._registeredPrompts[e]) throw Error(`Prompt ${e} is already registered`);
		let n;
		typeof t[0] == "string" && (n = t.shift());
		let r;
		t.length > 1 && (r = t.shift());
		let i = t[0], a = this._createRegisteredPrompt(e, void 0, n, r, i);
		return this.setPromptRequestHandlers(), this.sendPromptListChanged(), a;
	}
	registerPrompt(e, t, n) {
		if (this._registeredPrompts[e]) throw Error(`Prompt ${e} is already registered`);
		let { title: r, description: i, argsSchema: a } = t, o = this._createRegisteredPrompt(e, r, i, a, n);
		return this.setPromptRequestHandlers(), this.sendPromptListChanged(), o;
	}
	isConnected() {
		return this.server.transport !== void 0;
	}
	async sendLoggingMessage(e, t) {
		return this.server.sendLoggingMessage(e, t);
	}
	sendResourceListChanged() {
		this.isConnected() && this.server.sendResourceListChanged();
	}
	sendToolListChanged() {
		this.isConnected() && this.server.sendToolListChanged();
	}
	sendPromptListChanged() {
		this.isConnected() && this.server.sendPromptListChanged();
	}
}, Fp = {
	type: "object",
	properties: {}
};
function Ip(e) {
	return typeof e == "object" && !!e && "parse" in e && typeof e.parse == "function" && "safeParse" in e && typeof e.safeParse == "function";
}
function Lp(e) {
	return "_def" in e || "_zod" in e || Ip(e);
}
function Rp(e) {
	return typeof e != "object" || !e || Lp(e) ? !1 : Object.keys(e).length === 0 || Object.values(e).some(Ip);
}
function zp(e) {
	if (e) {
		if (Rp(e)) return lo(e);
		if (!Lp(e)) throw Error("inputSchema must be a Zod schema or raw shape, received an unrecognized object");
		return e;
	}
}
function Bp(e) {
	let t = po(e);
	return t ? Object.entries(t).map(([e, t]) => ({
		name: e,
		description: _o(t),
		required: !vo(t)
	})) : [];
}
function Vp(e) {
	let t = po(e)?.method;
	if (!t) throw Error("Schema is missing a method literal");
	let n = yo(t);
	if (typeof n == "string") return n;
	throw Error("Schema method literal must be a string");
}
function Hp(e) {
	return { completion: {
		values: e.slice(0, 100),
		total: e.length,
		hasMore: e.length > 100
	} };
}
var Up = { completion: {
	values: [],
	hasMore: !1
} }, Wp = /* @__PURE__ */ a(((e, t) => {
	t.exports = o, t.exports.format = s, t.exports.parse = c;
	var n = /\B(?=(\d{3})+(?!\d))/g, r = /(?:\.0*|(\.[^0]+)0+)$/, i = {
		b: 1,
		kb: 1024,
		mb: 1 << 20,
		gb: 1 << 30,
		tb: 1024 ** 4,
		pb: 1024 ** 5
	}, a = /^((-|\+)?(\d+(?:\.\d+)?)) *(kb|mb|gb|tb|pb)$/i;
	function o(e, t) {
		return typeof e == "string" ? c(e) : typeof e == "number" ? s(e, t) : null;
	}
	function s(e, t) {
		if (!Number.isFinite(e)) return null;
		var a = Math.abs(e), o = t && t.thousandsSeparator || "", s = t && t.unitSeparator || "", c = t && t.decimalPlaces !== void 0 ? t.decimalPlaces : 2, l = !!(t && t.fixedDecimals), u = t && t.unit || "";
		(!u || !i[u.toLowerCase()]) && (u = a >= i.pb ? "PB" : a >= i.tb ? "TB" : a >= i.gb ? "GB" : a >= i.mb ? "MB" : a >= i.kb ? "KB" : "B");
		var d = (e / i[u.toLowerCase()]).toFixed(c);
		return l || (d = d.replace(r, "$1")), o && (d = d.split(".").map(function(e, t) {
			return t === 0 ? e.replace(n, o) : e;
		}).join(".")), d + s + u;
	}
	function c(e) {
		if (typeof e == "number" && !isNaN(e)) return e;
		if (typeof e != "string") return null;
		var t = a.exec(e), n, r = "b";
		return t ? (n = parseFloat(t[1]), r = t[4].toLowerCase()) : (n = parseInt(e, 10), r = "b"), isNaN(n) ? null : Math.floor(i[r] * n);
	}
})), Gp = /* @__PURE__ */ a(((e, n) => {
	var r = t("path").relative;
	n.exports = l;
	var i = process.cwd();
	function a(e, t) {
		for (var n = e.split(/[ ,]+/), r = String(t).toLowerCase(), i = 0; i < n.length; i++) {
			var a = n[i];
			if (a && (a === "*" || a.toLowerCase() === r)) return !0;
		}
		return !1;
	}
	function o(e, t, n) {
		var r = Object.getOwnPropertyDescriptor(e, t), i = r.value;
		return r.get = function() {
			return i;
		}, r.writable && (r.set = function(e) {
			return i = e;
		}), delete r.value, delete r.writable, Object.defineProperty(e, t, r), r;
	}
	function s(e) {
		for (var t = "", n = 0; n < e; n++) t += ", arg" + n;
		return t.substr(2);
	}
	function c(e) {
		var t = this.name + ": " + this.namespace;
		this.message && (t += " deprecated " + this.message);
		for (var n = 0; n < e.length; n++) t += "\n    at " + e[n].toString();
		return t;
	}
	function l(e) {
		if (!e) throw TypeError("argument namespace is required");
		var t = m(y()[1])[0];
		function n(e) {
			p.call(n, e);
		}
		return n._file = t, n._ignored = d(e), n._namespace = e, n._traced = f(e), n._warned = Object.create(null), n.function = x, n.property = S, n;
	}
	function u(e, t) {
		return (typeof e.listenerCount == "function" ? e.listenerCount(t) : e.listeners(t).length) > 0;
	}
	function d(e) {
		return process.noDeprecation ? !0 : a(process.env.NO_DEPRECATION || "", e);
	}
	function f(e) {
		return process.traceDeprecation ? !0 : a(process.env.TRACE_DEPRECATION || "", e);
	}
	function p(e, t) {
		var n = u(process, "deprecation");
		if (!(!n && this._ignored)) {
			var r, i, a, o, s = 0, c = !1, l = y(), d = this._file;
			for (t ? (o = t, a = m(l[1]), a.name = o.name, d = a[0]) : (s = 2, o = m(l[s]), a = o); s < l.length; s++) if (r = m(l[s]), i = r[0], i === d) c = !0;
			else if (i === this._file) d = this._file;
			else if (c) break;
			var f = r ? o.join(":") + "__" + r.join(":") : void 0;
			if (!(f !== void 0 && f in this._warned)) {
				this._warned[f] = !0;
				var p = e;
				if (p ||= a === o || !a.name ? h(o) : h(a), n) {
					var v = C(this._namespace, p, l.slice(s));
					process.emit("deprecation", v);
					return;
				}
				var b = (process.stderr.isTTY ? _ : g).call(this, p, r, l.slice(s));
				process.stderr.write(b + "\n", "utf8");
			}
		}
	}
	function m(e) {
		var t = e.getFileName() || "<anonymous>", n = e.getLineNumber(), r = e.getColumnNumber();
		e.isEval() && (t = e.getEvalOrigin() + ", " + t);
		var i = [
			t,
			n,
			r
		];
		return i.callSite = e, i.name = e.getFunctionName(), i;
	}
	function h(e) {
		var t = e.callSite, n = e.name;
		n ||= "<anonymous@" + v(e) + ">";
		var r = t.getThis(), i = r && t.getTypeName();
		return i === "Object" && (i = void 0), i === "Function" && (i = r.name || i), i && t.getMethodName() ? i + "." + n : n;
	}
	function g(e, t, n) {
		var r = (/* @__PURE__ */ new Date()).toUTCString() + " " + this._namespace + " deprecated " + e;
		if (this._traced) {
			for (var i = 0; i < n.length; i++) r += "\n    at " + n[i].toString();
			return r;
		}
		return t && (r += " at " + v(t)), r;
	}
	function _(e, t, n) {
		var r = "\x1B[36;1m" + this._namespace + "\x1B[22;39m \x1B[33;1mdeprecated\x1B[22;39m \x1B[0m" + e + "\x1B[39m";
		if (this._traced) {
			for (var i = 0; i < n.length; i++) r += "\n    \x1B[36mat " + n[i].toString() + "\x1B[39m";
			return r;
		}
		return t && (r += " \x1B[36m" + v(t) + "\x1B[39m"), r;
	}
	function v(e) {
		return r(i, e[0]) + ":" + e[1] + ":" + e[2];
	}
	function y() {
		var e = Error.stackTraceLimit, t = {}, n = Error.prepareStackTrace;
		Error.prepareStackTrace = b, Error.stackTraceLimit = Math.max(10, e), Error.captureStackTrace(t);
		var r = t.stack.slice(1);
		return Error.prepareStackTrace = n, Error.stackTraceLimit = e, r;
	}
	function b(e, t) {
		return t;
	}
	function x(e, t) {
		if (typeof e != "function") throw TypeError("argument fn must be a function");
		var n = s(e.length), r = m(y()[1]);
		return r.name = e.name, Function("fn", "log", "deprecate", "message", "site", "\"use strict\"\nreturn function (" + n + ") {log.call(deprecate, message, site)\nreturn fn.apply(this, arguments)\n}")(e, p, this, t, r);
	}
	function S(e, t, n) {
		if (!e || typeof e != "object" && typeof e != "function") throw TypeError("argument obj must be object");
		var r = Object.getOwnPropertyDescriptor(e, t);
		if (!r) throw TypeError("must call property on owner object");
		if (!r.configurable) throw TypeError("property must be configurable");
		var i = this, a = m(y()[1]);
		a.name = t, "value" in r && (r = o(e, t, n));
		var s = r.get, c = r.set;
		typeof s == "function" && (r.get = function() {
			return p.call(i, n, a), s.apply(this, arguments);
		}), typeof c == "function" && (r.set = function() {
			return p.call(i, n, a), c.apply(this, arguments);
		}), Object.defineProperty(e, t, r);
	}
	function C(e, t, n) {
		var r = /* @__PURE__ */ Error(), i;
		return Object.defineProperty(r, "constructor", { value: C }), Object.defineProperty(r, "message", {
			configurable: !0,
			enumerable: !1,
			value: t,
			writable: !0
		}), Object.defineProperty(r, "name", {
			enumerable: !1,
			configurable: !0,
			value: "DeprecationError",
			writable: !0
		}), Object.defineProperty(r, "namespace", {
			configurable: !0,
			enumerable: !1,
			value: e,
			writable: !0
		}), Object.defineProperty(r, "stack", {
			configurable: !0,
			enumerable: !1,
			get: function() {
				return i === void 0 ? i = c.call(this, n) : i;
			},
			set: function(e) {
				i = e;
			}
		}), r;
	}
})), Kp = /* @__PURE__ */ a(((e, t) => {
	t.exports = Object.setPrototypeOf || ({ __proto__: [] } instanceof Array ? n : r);
	function n(e, t) {
		return e.__proto__ = t, e;
	}
	function r(e, t) {
		for (var n in t) Object.prototype.hasOwnProperty.call(e, n) || (e[n] = t[n]);
		return e;
	}
})), qp = /* @__PURE__ */ i({ default: () => Jp }), Jp, Yp = n((() => {
	Jp = {
		100: "Continue",
		101: "Switching Protocols",
		102: "Processing",
		103: "Early Hints",
		200: "OK",
		201: "Created",
		202: "Accepted",
		203: "Non-Authoritative Information",
		204: "No Content",
		205: "Reset Content",
		206: "Partial Content",
		207: "Multi-Status",
		208: "Already Reported",
		226: "IM Used",
		300: "Multiple Choices",
		301: "Moved Permanently",
		302: "Found",
		303: "See Other",
		304: "Not Modified",
		305: "Use Proxy",
		307: "Temporary Redirect",
		308: "Permanent Redirect",
		400: "Bad Request",
		401: "Unauthorized",
		402: "Payment Required",
		403: "Forbidden",
		404: "Not Found",
		405: "Method Not Allowed",
		406: "Not Acceptable",
		407: "Proxy Authentication Required",
		408: "Request Timeout",
		409: "Conflict",
		410: "Gone",
		411: "Length Required",
		412: "Precondition Failed",
		413: "Payload Too Large",
		414: "URI Too Long",
		415: "Unsupported Media Type",
		416: "Range Not Satisfiable",
		417: "Expectation Failed",
		418: "I'm a Teapot",
		421: "Misdirected Request",
		422: "Unprocessable Entity",
		423: "Locked",
		424: "Failed Dependency",
		425: "Too Early",
		426: "Upgrade Required",
		428: "Precondition Required",
		429: "Too Many Requests",
		431: "Request Header Fields Too Large",
		451: "Unavailable For Legal Reasons",
		500: "Internal Server Error",
		501: "Not Implemented",
		502: "Bad Gateway",
		503: "Service Unavailable",
		504: "Gateway Timeout",
		505: "HTTP Version Not Supported",
		506: "Variant Also Negotiates",
		507: "Insufficient Storage",
		508: "Loop Detected",
		509: "Bandwidth Limit Exceeded",
		510: "Not Extended",
		511: "Network Authentication Required"
	};
})), Xp = /* @__PURE__ */ a(((t, n) => {
	var r = (Yp(), e(qp).default);
	n.exports = c, c.message = r, c.code = i(r), c.codes = a(r), c.redirect = {
		300: !0,
		301: !0,
		302: !0,
		303: !0,
		305: !0,
		307: !0,
		308: !0
	}, c.empty = {
		204: !0,
		205: !0,
		304: !0
	}, c.retry = {
		502: !0,
		503: !0,
		504: !0
	};
	function i(e) {
		var t = {};
		return Object.keys(e).forEach(function(n) {
			var r = e[n], i = Number(n);
			t[r.toLowerCase()] = i;
		}), t;
	}
	function a(e) {
		return Object.keys(e).map(function(e) {
			return Number(e);
		});
	}
	function o(e) {
		var t = e.toLowerCase();
		if (!Object.prototype.hasOwnProperty.call(c.code, t)) throw Error("invalid status message: \"" + e + "\"");
		return c.code[t];
	}
	function s(e) {
		if (!Object.prototype.hasOwnProperty.call(c.message, e)) throw Error("invalid status code: " + e);
		return c.message[e];
	}
	function c(e) {
		if (typeof e == "number") return s(e);
		if (typeof e != "string") throw TypeError("code must be a number or string");
		var t = parseInt(e, 10);
		return isNaN(t) ? o(e) : s(t);
	}
})), Zp = /* @__PURE__ */ a(((e, t) => {
	t.exports = typeof Object.create == "function" ? function(e, t) {
		t && (e.super_ = t, e.prototype = Object.create(t.prototype, { constructor: {
			value: e,
			enumerable: !1,
			writable: !0,
			configurable: !0
		} }));
	} : function(e, t) {
		if (t) {
			e.super_ = t;
			var n = function() {};
			n.prototype = t.prototype, e.prototype = new n(), e.prototype.constructor = e;
		}
	};
})), Qp = /* @__PURE__ */ a(((e, n) => {
	try {
		var r = t("util");
		/* istanbul ignore next */
		if (typeof r.inherits != "function") throw "";
		n.exports = r.inherits;
	} catch {
		/* istanbul ignore next */
		n.exports = Zp();
	}
})), $p = /* @__PURE__ */ a(((e, t) => {
	t.exports = n;
	function n(e) {
		return e.split(" ").map(function(e) {
			return e.slice(0, 1).toUpperCase() + e.slice(1);
		}).join("").replace(/[^ _0-9a-z]/gi, "");
	}
})), em = /* @__PURE__ */ a(((e, t) => {
	var n = Gp()("http-errors"), r = Kp(), i = Xp(), a = Qp(), o = $p();
	t.exports = c, t.exports.HttpError = l(), t.exports.isHttpError = d(t.exports.HttpError), m(t.exports, i.codes, t.exports.HttpError);
	function s(e) {
		return Number(String(e).charAt(0) + "00");
	}
	function c() {
		for (var e, t, r = 500, a = {}, o = 0; o < arguments.length; o++) {
			var l = arguments[o], u = typeof l;
			if (u === "object" && l instanceof Error) e = l, r = e.status || e.statusCode || r;
			else if (u === "number" && o === 0) r = l;
			else if (u === "string") t = l;
			else if (u === "object") a = l;
			else throw TypeError("argument #" + (o + 1) + " unsupported type " + u);
		}
		typeof r == "number" && (r < 400 || r >= 600) && n("non-error status code; use only 4xx or 5xx status codes"), (typeof r != "number" || !i.message[r] && (r < 400 || r >= 600)) && (r = 500);
		var d = c[r] || c[s(r)];
		for (var f in e || (e = d ? new d(t) : Error(t || i.message[r]), Error.captureStackTrace(e, c)), (!d || !(e instanceof d) || e.status !== r) && (e.expose = r < 500, e.status = e.statusCode = r), a) f !== "status" && f !== "statusCode" && (e[f] = a[f]);
		return e;
	}
	function l() {
		function e() {
			throw TypeError("cannot construct abstract class");
		}
		return a(e, Error), e;
	}
	function u(e, t, n) {
		var o = h(t);
		function s(e) {
			var t = e ?? i.message[n], a = Error(t);
			return Error.captureStackTrace(a, s), r(a, s.prototype), Object.defineProperty(a, "message", {
				enumerable: !0,
				configurable: !0,
				value: t,
				writable: !0
			}), Object.defineProperty(a, "name", {
				enumerable: !1,
				configurable: !0,
				value: o,
				writable: !0
			}), a;
		}
		return a(s, e), p(s, o), s.prototype.status = n, s.prototype.statusCode = n, s.prototype.expose = !0, s;
	}
	function d(e) {
		return function(t) {
			return !t || typeof t != "object" ? !1 : t instanceof e || t instanceof Error && typeof t.expose == "boolean" && typeof t.statusCode == "number" && t.status === t.statusCode;
		};
	}
	function f(e, t, n) {
		var o = h(t);
		function s(e) {
			var t = e ?? i.message[n], a = Error(t);
			return Error.captureStackTrace(a, s), r(a, s.prototype), Object.defineProperty(a, "message", {
				enumerable: !0,
				configurable: !0,
				value: t,
				writable: !0
			}), Object.defineProperty(a, "name", {
				enumerable: !1,
				configurable: !0,
				value: o,
				writable: !0
			}), a;
		}
		return a(s, e), p(s, o), s.prototype.status = n, s.prototype.statusCode = n, s.prototype.expose = !1, s;
	}
	function p(e, t) {
		var n = Object.getOwnPropertyDescriptor(e, "name");
		n && n.configurable && (n.value = t, Object.defineProperty(e, "name", n));
	}
	function m(e, t, n) {
		t.forEach(function(t) {
			var r, a = o(i.message[t]);
			switch (s(t)) {
				case 400:
					r = u(n, a, t);
					break;
				case 500: r = f(n, a, t);
			}
			r && (e[t] = r, e[a] = r);
		});
	}
	function h(e) {
		return e.slice(-5) === "Error" ? e : e + "Error";
	}
})), tm = /* @__PURE__ */ a(((e, n) => {
	var r = t("buffer"), i = r.Buffer, a = {}, o;
	for (o in r) r.hasOwnProperty(o) && o !== "SlowBuffer" && o !== "Buffer" && (a[o] = r[o]);
	var s = a.Buffer = {};
	for (o in i) i.hasOwnProperty(o) && o !== "allocUnsafe" && o !== "allocUnsafeSlow" && (s[o] = i[o]);
	if (a.Buffer.prototype = i.prototype, (!s.from || s.from === Uint8Array.from) && (s.from = function(e, t, n) {
		if (typeof e == "number") throw TypeError("The \"value\" argument must not be of type number. Received type " + typeof e);
		if (e && e.length === void 0) throw TypeError("The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof e);
		return i(e, t, n);
	}), s.alloc ||= function(e, t, n) {
		if (typeof e != "number") throw TypeError("The \"size\" argument must be of type number. Received type " + typeof e);
		if (e < 0 || e >= 2 * (1 << 30)) throw RangeError("The value \"" + e + "\" is invalid for option \"size\"");
		var r = i(e);
		return !t || t.length === 0 ? r.fill(0) : typeof n == "string" ? r.fill(t, n) : r.fill(t), r;
	}, !a.kStringMaxLength) try {
		a.kStringMaxLength = process.binding("buffer").kStringMaxLength;
	} catch {}
	a.constants || (a.constants = { MAX_LENGTH: a.kMaxLength }, a.kStringMaxLength && (a.constants.MAX_STRING_LENGTH = a.kStringMaxLength)), n.exports = a;
})), nm = /* @__PURE__ */ a(((e) => {
	e.PrependBOM = t;
	function t(e, t) {
		this.encoder = e, this.addBOM = !0;
	}
	t.prototype.write = function(e) {
		return this.addBOM &&= (e = "﻿" + e, !1), this.encoder.write(e);
	}, t.prototype.end = function() {
		return this.encoder.end();
	}, e.StripBOM = n;
	function n(e, t) {
		this.decoder = e, this.pass = !1, this.options = t || {};
	}
	n.prototype.write = function(e) {
		var t = this.decoder.write(e);
		return this.pass || !t ? t : (t[0] === "﻿" && (t = t.slice(1), typeof this.options.stripBOM == "function" && this.options.stripBOM()), this.pass = !0, t);
	}, n.prototype.end = function() {
		return this.decoder.end();
	};
})), rm = /* @__PURE__ */ a(((e, t) => {
	var n = Object.hasOwn === void 0 ? Function.call.bind(Object.prototype.hasOwnProperty) : Object.hasOwn;
	function r(e, t) {
		for (var r in t) n(t, r) && (e[r] = t[r]);
	}
	t.exports = r;
})), im = /* @__PURE__ */ a(((e, n) => {
	var r = tm().Buffer;
	n.exports = {
		utf8: {
			type: "_internal",
			bomAware: !0
		},
		cesu8: {
			type: "_internal",
			bomAware: !0
		},
		unicode11utf8: "utf8",
		ucs2: {
			type: "_internal",
			bomAware: !0
		},
		utf16le: "ucs2",
		binary: { type: "_internal" },
		base64: { type: "_internal" },
		hex: { type: "_internal" },
		_internal: i
	};
	function i(e, t) {
		this.enc = e.encodingName, this.bomAware = e.bomAware, this.enc === "base64" ? this.encoder = c : this.enc === "utf8" ? this.encoder = d : this.enc === "cesu8" && (this.enc = "utf8", this.encoder = l, r.from("eda0bdedb2a9", "hex").toString() !== "💩" && (this.decoder = u, this.defaultCharUnicode = t.defaultCharUnicode));
	}
	i.prototype.encoder = s, i.prototype.decoder = o;
	var a = t("string_decoder").StringDecoder;
	function o(e, t) {
		this.decoder = new a(t.enc);
	}
	o.prototype.write = function(e) {
		return r.isBuffer(e) || (e = r.from(e)), this.decoder.write(e);
	}, o.prototype.end = function() {
		return this.decoder.end();
	};
	function s(e, t) {
		this.enc = t.enc;
	}
	s.prototype.write = function(e) {
		return r.from(e, this.enc);
	}, s.prototype.end = function() {};
	function c(e, t) {
		this.prevStr = "";
	}
	c.prototype.write = function(e) {
		e = this.prevStr + e;
		var t = e.length - e.length % 4;
		return this.prevStr = e.slice(t), e = e.slice(0, t), r.from(e, "base64");
	}, c.prototype.end = function() {
		return r.from(this.prevStr, "base64");
	};
	function l(e, t) {}
	l.prototype.write = function(e) {
		for (var t = r.alloc(e.length * 3), n = 0, i = 0; i < e.length; i++) {
			var a = e.charCodeAt(i);
			a < 128 ? t[n++] = a : a < 2048 ? (t[n++] = 192 + (a >>> 6), t[n++] = 128 + (a & 63)) : (t[n++] = 224 + (a >>> 12), t[n++] = 128 + (a >>> 6 & 63), t[n++] = 128 + (a & 63));
		}
		return t.slice(0, n);
	}, l.prototype.end = function() {};
	function u(e, t) {
		this.acc = 0, this.contBytes = 0, this.accBytes = 0, this.defaultCharUnicode = t.defaultCharUnicode;
	}
	u.prototype.write = function(e) {
		for (var t = this.acc, n = this.contBytes, r = this.accBytes, i = "", a = 0; a < e.length; a++) {
			var o = e[a];
			(o & 192) == 128 ? n > 0 ? (t = t << 6 | o & 63, n--, r++, n === 0 && (i += r === 2 && t < 128 && t > 0 || r === 3 && t < 2048 ? this.defaultCharUnicode : String.fromCharCode(t))) : i += this.defaultCharUnicode : (n > 0 && (i += this.defaultCharUnicode, n = 0), o < 128 ? i += String.fromCharCode(o) : o < 224 ? (t = o & 31, n = 1, r = 1) : o < 240 ? (t = o & 15, n = 2, r = 1) : i += this.defaultCharUnicode);
		}
		return this.acc = t, this.contBytes = n, this.accBytes = r, i;
	}, u.prototype.end = function() {
		var e = 0;
		return this.contBytes > 0 && (e += this.defaultCharUnicode), e;
	};
	function d(e, t) {
		this.highSurrogate = "";
	}
	d.prototype.write = function(e) {
		if (this.highSurrogate &&= (e = this.highSurrogate + e, ""), e.length > 0) {
			var t = e.charCodeAt(e.length - 1);
			t >= 55296 && t < 56320 && (this.highSurrogate = e[e.length - 1], e = e.slice(0, e.length - 1));
		}
		return r.from(e, this.enc);
	}, d.prototype.end = function() {
		if (this.highSurrogate) {
			var e = this.highSurrogate;
			return this.highSurrogate = "", r.from(e, this.enc);
		}
	};
})), am = /* @__PURE__ */ a(((e) => {
	var t = tm().Buffer;
	e._utf32 = n;
	function n(e, t) {
		this.iconv = t, this.bomAware = !0, this.isLE = e.isLE;
	}
	e.utf32le = {
		type: "_utf32",
		isLE: !0
	}, e.utf32be = {
		type: "_utf32",
		isLE: !1
	}, e.ucs4le = "utf32le", e.ucs4be = "utf32be", n.prototype.encoder = r, n.prototype.decoder = i;
	function r(e, t) {
		this.isLE = t.isLE, this.highSurrogate = 0;
	}
	r.prototype.write = function(e) {
		for (var n = t.from(e, "ucs2"), r = t.alloc(n.length * 2 + 4), i = this.isLE ? r.writeUInt32LE : r.writeUInt32BE, a = 0, o = 0; o < n.length; o += 2) {
			var s = n.readUInt16LE(o), c = s >= 55296 && s < 56320, l = s >= 56320 && s < 57344;
			if (this.highSurrogate) {
				if (c || !l) i.call(r, this.highSurrogate, a), a += 4;
				else {
					var u = (this.highSurrogate - 55296 << 10 | s - 56320) + 65536;
					i.call(r, u, a), a += 4, this.highSurrogate = 0;
					continue;
				}
			}
			c ? this.highSurrogate = s : (i.call(r, s, a), a += 4, this.highSurrogate = 0);
		}
		return a < r.length && (r = r.slice(0, a)), r;
	}, r.prototype.end = function() {
		if (this.highSurrogate) {
			var e = t.alloc(4);
			return this.isLE ? e.writeUInt32LE(this.highSurrogate, 0) : e.writeUInt32BE(this.highSurrogate, 0), this.highSurrogate = 0, e;
		}
	};
	function i(e, t) {
		this.isLE = t.isLE, this.badChar = t.iconv.defaultCharUnicode.charCodeAt(0), this.overflow = [];
	}
	i.prototype.write = function(e) {
		if (e.length === 0) return "";
		var n = 0, r = 0, i = t.alloc(e.length + 4), o = 0, s = this.isLE, c = this.overflow, l = this.badChar;
		if (c.length > 0) {
			for (; n < e.length && c.length < 4; n++) c.push(e[n]);
			c.length === 4 && (r = s ? c[0] | c[1] << 8 | c[2] << 16 | c[3] << 24 : c[3] | c[2] << 8 | c[1] << 16 | c[0] << 24, c.length = 0, o = a(i, o, r, l));
		}
		for (; n < e.length - 3; n += 4) r = s ? e[n] | e[n + 1] << 8 | e[n + 2] << 16 | e[n + 3] << 24 : e[n + 3] | e[n + 2] << 8 | e[n + 1] << 16 | e[n] << 24, o = a(i, o, r, l);
		for (; n < e.length; n++) c.push(e[n]);
		return i.slice(0, o).toString("ucs2");
	};
	function a(e, t, n, r) {
		if ((n < 0 || n > 1114111) && (n = r), n >= 65536) {
			n -= 65536;
			var i = 55296 | n >> 10;
			e[t++] = i & 255, e[t++] = i >> 8;
			var n = 56320 | n & 1023;
		}
		return e[t++] = n & 255, e[t++] = n >> 8, t;
	}
	i.prototype.end = function() {
		if (this.overflow.length !== 0) return this.overflow.length = 0, String.fromCharCode(this.badChar);
	}, e.utf32 = o, e.ucs4 = "utf32";
	function o(e, t) {
		this.iconv = t;
	}
	o.prototype.encoder = s, o.prototype.decoder = c;
	function s(e, t) {
		e ||= {}, e.addBOM === void 0 && (e.addBOM = !0), this.encoder = t.iconv.getEncoder(e.defaultEncoding || "utf-32le", e);
	}
	s.prototype.write = function(e) {
		return this.encoder.write(e);
	}, s.prototype.end = function() {
		return this.encoder.end();
	};
	function c(e, t) {
		this.decoder = null, this.initialBufs = [], this.initialBufsLen = 0, this.options = e || {}, this.iconv = t.iconv;
	}
	c.prototype.write = function(e) {
		if (!this.decoder) {
			if (this.initialBufs.push(e), this.initialBufsLen += e.length, this.initialBufsLen < 32) return "";
			var t = l(this.initialBufs, this.options.defaultEncoding);
			this.decoder = this.iconv.getDecoder(t, this.options);
			for (var n = "", r = 0; r < this.initialBufs.length; r++) n += this.decoder.write(this.initialBufs[r]);
			return this.initialBufs.length = this.initialBufsLen = 0, n;
		}
		return this.decoder.write(e);
	}, c.prototype.end = function() {
		if (!this.decoder) {
			var e = l(this.initialBufs, this.options.defaultEncoding);
			this.decoder = this.iconv.getDecoder(e, this.options);
			for (var t = "", n = 0; n < this.initialBufs.length; n++) t += this.decoder.write(this.initialBufs[n]);
			var r = this.decoder.end();
			return r && (t += r), this.initialBufs.length = this.initialBufsLen = 0, t;
		}
		return this.decoder.end();
	};
	function l(e, t) {
		var n = [], r = 0, i = 0, a = 0, o = 0, s = 0;
		outerLoop: for (var c = 0; c < e.length; c++) for (var l = e[c], u = 0; u < l.length; u++) if (n.push(l[u]), n.length === 4) {
			if (r === 0) {
				if (n[0] === 255 && n[1] === 254 && n[2] === 0 && n[3] === 0) return "utf-32le";
				if (n[0] === 0 && n[1] === 0 && n[2] === 254 && n[3] === 255) return "utf-32be";
			}
			if ((n[0] !== 0 || n[1] > 16) && a++, (n[3] !== 0 || n[2] > 16) && i++, n[0] === 0 && n[1] === 0 && (n[2] !== 0 || n[3] !== 0) && s++, (n[0] !== 0 || n[1] !== 0) && n[2] === 0 && n[3] === 0 && o++, n.length = 0, r++, r >= 100) break outerLoop;
		}
		return s - a > o - i ? "utf-32be" : s - a < o - i ? "utf-32le" : t || "utf-32le";
	}
})), om = /* @__PURE__ */ a(((e) => {
	var t = tm().Buffer;
	e.utf16be = n;
	function n() {}
	n.prototype.encoder = r, n.prototype.decoder = i, n.prototype.bomAware = !0;
	function r() {}
	r.prototype.write = function(e) {
		for (var n = t.from(e, "ucs2"), r = 0; r < n.length; r += 2) {
			var i = n[r];
			n[r] = n[r + 1], n[r + 1] = i;
		}
		return n;
	}, r.prototype.end = function() {};
	function i() {
		this.overflowByte = -1;
	}
	i.prototype.write = function(e) {
		if (e.length == 0) return "";
		var n = t.alloc(e.length + 1), r = 0, i = 0;
		for (this.overflowByte !== -1 && (n[0] = e[0], n[1] = this.overflowByte, r = 1, i = 2); r < e.length - 1; r += 2, i += 2) n[i] = e[r + 1], n[i + 1] = e[r];
		return this.overflowByte = r == e.length - 1 ? e[e.length - 1] : -1, n.slice(0, i).toString("ucs2");
	}, i.prototype.end = function() {
		this.overflowByte = -1;
	}, e.utf16 = a;
	function a(e, t) {
		this.iconv = t;
	}
	a.prototype.encoder = o, a.prototype.decoder = s;
	function o(e, t) {
		e ||= {}, e.addBOM === void 0 && (e.addBOM = !0), this.encoder = t.iconv.getEncoder("utf-16le", e);
	}
	o.prototype.write = function(e) {
		return this.encoder.write(e);
	}, o.prototype.end = function() {
		return this.encoder.end();
	};
	function s(e, t) {
		this.decoder = null, this.initialBufs = [], this.initialBufsLen = 0, this.options = e || {}, this.iconv = t.iconv;
	}
	s.prototype.write = function(e) {
		if (!this.decoder) {
			if (this.initialBufs.push(e), this.initialBufsLen += e.length, this.initialBufsLen < 16) return "";
			var t = c(this.initialBufs, this.options.defaultEncoding);
			this.decoder = this.iconv.getDecoder(t, this.options);
			for (var n = "", r = 0; r < this.initialBufs.length; r++) n += this.decoder.write(this.initialBufs[r]);
			return this.initialBufs.length = this.initialBufsLen = 0, n;
		}
		return this.decoder.write(e);
	}, s.prototype.end = function() {
		if (!this.decoder) {
			var e = c(this.initialBufs, this.options.defaultEncoding);
			this.decoder = this.iconv.getDecoder(e, this.options);
			for (var t = "", n = 0; n < this.initialBufs.length; n++) t += this.decoder.write(this.initialBufs[n]);
			var r = this.decoder.end();
			return r && (t += r), this.initialBufs.length = this.initialBufsLen = 0, t;
		}
		return this.decoder.end();
	};
	function c(e, t) {
		var n = [], r = 0, i = 0, a = 0;
		outerLoop: for (var o = 0; o < e.length; o++) for (var s = e[o], c = 0; c < s.length; c++) if (n.push(s[c]), n.length === 2) {
			if (r === 0) {
				if (n[0] === 255 && n[1] === 254) return "utf-16le";
				if (n[0] === 254 && n[1] === 255) return "utf-16be";
			}
			if (n[0] === 0 && n[1] !== 0 && a++, n[0] !== 0 && n[1] === 0 && i++, n.length = 0, r++, r >= 100) break outerLoop;
		}
		return a > i ? "utf-16be" : a < i ? "utf-16le" : t || "utf-16le";
	}
})), sm = /* @__PURE__ */ a(((e) => {
	var t = tm().Buffer;
	e.utf7 = n, e.unicode11utf7 = "utf7";
	function n(e, t) {
		this.iconv = t;
	}
	n.prototype.encoder = i, n.prototype.decoder = a, n.prototype.bomAware = !0;
	var r = /[^A-Za-z0-9'\(\),-\.\/:\? \n\r\t]+/g;
	function i(e, t) {
		this.iconv = t.iconv;
	}
	i.prototype.write = function(e) {
		return t.from(e.replace(r, function(e) {
			return "+" + (e === "+" ? "" : this.iconv.encode(e, "utf16-be").toString("base64").replace(/=+$/, "")) + "-";
		}.bind(this)));
	}, i.prototype.end = function() {};
	function a(e, t) {
		this.iconv = t.iconv, this.inBase64 = !1, this.base64Accum = "";
	}
	for (var o = /[A-Za-z0-9\/+]/, s = [], c = 0; c < 256; c++) s[c] = o.test(String.fromCharCode(c));
	var l = 43, u = 45, d = 38;
	a.prototype.write = function(e) {
		for (var n = "", r = 0, i = this.inBase64, a = this.base64Accum, o = 0; o < e.length; o++) if (!i) e[o] == l && (n += this.iconv.decode(e.slice(r, o), "ascii"), r = o + 1, i = !0);
		else if (!s[e[o]]) {
			if (o == r && e[o] == u) n += "+";
			else {
				var c = a + this.iconv.decode(e.slice(r, o), "ascii");
				n += this.iconv.decode(t.from(c, "base64"), "utf16-be");
			}
			e[o] != u && o--, r = o + 1, i = !1, a = "";
		}
		if (!i) n += this.iconv.decode(e.slice(r), "ascii");
		else {
			var c = a + this.iconv.decode(e.slice(r), "ascii"), d = c.length - c.length % 8;
			a = c.slice(d), c = c.slice(0, d), n += this.iconv.decode(t.from(c, "base64"), "utf16-be");
		}
		return this.inBase64 = i, this.base64Accum = a, n;
	}, a.prototype.end = function() {
		var e = "";
		return this.inBase64 && this.base64Accum.length > 0 && (e = this.iconv.decode(t.from(this.base64Accum, "base64"), "utf16-be")), this.inBase64 = !1, this.base64Accum = "", e;
	}, e.utf7imap = f;
	function f(e, t) {
		this.iconv = t;
	}
	f.prototype.encoder = p, f.prototype.decoder = m, f.prototype.bomAware = !0;
	function p(e, n) {
		this.iconv = n.iconv, this.inBase64 = !1, this.base64Accum = t.alloc(6), this.base64AccumIdx = 0;
	}
	p.prototype.write = function(e) {
		for (var n = this.inBase64, r = this.base64Accum, i = this.base64AccumIdx, a = t.alloc(e.length * 5 + 10), o = 0, s = 0; s < e.length; s++) {
			var c = e.charCodeAt(s);
			c >= 32 && c <= 126 ? (n &&= (i > 0 && (o += a.write(r.slice(0, i).toString("base64").replace(/\//g, ",").replace(/=+$/, ""), o), i = 0), a[o++] = u, !1), n || (a[o++] = c, c === d && (a[o++] = u))) : (n ||= (a[o++] = d, !0), n && (r[i++] = c >> 8, r[i++] = c & 255, i == r.length && (o += a.write(r.toString("base64").replace(/\//g, ","), o), i = 0)));
		}
		return this.inBase64 = n, this.base64AccumIdx = i, a.slice(0, o);
	}, p.prototype.end = function() {
		var e = t.alloc(10), n = 0;
		return this.inBase64 &&= (this.base64AccumIdx > 0 && (n += e.write(this.base64Accum.slice(0, this.base64AccumIdx).toString("base64").replace(/\//g, ",").replace(/=+$/, ""), n), this.base64AccumIdx = 0), e[n++] = u, !1), e.slice(0, n);
	};
	function m(e, t) {
		this.iconv = t.iconv, this.inBase64 = !1, this.base64Accum = "";
	}
	var h = s.slice();
	h[44] = !0, m.prototype.write = function(e) {
		for (var n = "", r = 0, i = this.inBase64, a = this.base64Accum, o = 0; o < e.length; o++) if (!i) e[o] == d && (n += this.iconv.decode(e.slice(r, o), "ascii"), r = o + 1, i = !0);
		else if (!h[e[o]]) {
			if (o == r && e[o] == u) n += "&";
			else {
				var s = a + this.iconv.decode(e.slice(r, o), "ascii").replace(/,/g, "/");
				n += this.iconv.decode(t.from(s, "base64"), "utf16-be");
			}
			e[o] != u && o--, r = o + 1, i = !1, a = "";
		}
		if (!i) n += this.iconv.decode(e.slice(r), "ascii");
		else {
			var s = a + this.iconv.decode(e.slice(r), "ascii").replace(/,/g, "/"), c = s.length - s.length % 8;
			a = s.slice(c), s = s.slice(0, c), n += this.iconv.decode(t.from(s, "base64"), "utf16-be");
		}
		return this.inBase64 = i, this.base64Accum = a, n;
	}, m.prototype.end = function() {
		var e = "";
		return this.inBase64 && this.base64Accum.length > 0 && (e = this.iconv.decode(t.from(this.base64Accum, "base64"), "utf16-be")), this.inBase64 = !1, this.base64Accum = "", e;
	};
})), cm = /* @__PURE__ */ a(((e) => {
	var t = tm().Buffer;
	e._sbcs = n;
	function n(e, n) {
		if (!e) throw Error("SBCS codec is called without the data.");
		if (!e.chars || e.chars.length !== 128 && e.chars.length !== 256) throw Error("Encoding '" + e.type + "' has incorrect 'chars' (must be of len 128 or 256)");
		if (e.chars.length === 128) {
			for (var r = "", i = 0; i < 128; i++) r += String.fromCharCode(i);
			e.chars = r + e.chars;
		}
		this.decodeBuf = t.from(e.chars, "ucs2");
		for (var a = t.alloc(65536, n.defaultCharSingleByte.charCodeAt(0)), i = 0; i < e.chars.length; i++) a[e.chars.charCodeAt(i)] = i;
		this.encodeBuf = a;
	}
	n.prototype.encoder = r, n.prototype.decoder = i;
	function r(e, t) {
		this.encodeBuf = t.encodeBuf;
	}
	r.prototype.write = function(e) {
		for (var n = t.alloc(e.length), r = 0; r < e.length; r++) n[r] = this.encodeBuf[e.charCodeAt(r)];
		return n;
	}, r.prototype.end = function() {};
	function i(e, t) {
		this.decodeBuf = t.decodeBuf;
	}
	i.prototype.write = function(e) {
		for (var n = this.decodeBuf, r = t.alloc(e.length * 2), i = 0, a = 0, o = 0; o < e.length; o++) i = e[o] * 2, a = o * 2, r[a] = n[i], r[a + 1] = n[i + 1];
		return r.toString("ucs2");
	}, i.prototype.end = function() {};
})), lm = /* @__PURE__ */ a(((e, t) => {
	t.exports = {
		10029: "maccenteuro",
		maccenteuro: {
			type: "_sbcs",
			chars: "ÄĀāÉĄÖÜáąČäčĆćéŹźĎíďĒēĖóėôöõúĚěü†°Ę£§•¶ß®©™ę¨≠ģĮįĪ≤≥īĶ∂∑łĻļĽľĹĺŅņŃ¬√ńŇ∆«»…\xA0ňŐÕőŌ–—“”‘’÷◊ōŔŕŘ‹›řŖŗŠ‚„šŚśÁŤťÍŽžŪÓÔūŮÚůŰűŲųÝýķŻŁżĢˇ"
		},
		808: "cp808",
		ibm808: "cp808",
		cp808: {
			type: "_sbcs",
			chars: "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмноп░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀рстуфхцчшщъыьэюяЁёЄєЇїЎў°∙·√№€■\xA0"
		},
		mik: {
			type: "_sbcs",
			chars: "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя└┴┬├─┼╣║╚╔╩╦╠═╬┐░▒▓│┤№§╗╝┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xA0"
		},
		cp720: {
			type: "_sbcs",
			chars: "éâàçêëèïîّْô¤ـûùءآأؤ£إئابةتثجحخدذرزسشص«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀ضطظعغفµقكلمنهوىي≡ًٌٍَُِ≈°∙·√ⁿ²■\xA0"
		},
		ascii8bit: "ascii",
		usascii: "ascii",
		ansix34: "ascii",
		ansix341968: "ascii",
		ansix341986: "ascii",
		csascii: "ascii",
		cp367: "ascii",
		ibm367: "ascii",
		isoir6: "ascii",
		iso646us: "ascii",
		iso646irv: "ascii",
		us: "ascii",
		latin1: "iso88591",
		latin2: "iso88592",
		latin3: "iso88593",
		latin4: "iso88594",
		latin5: "iso88599",
		latin6: "iso885910",
		latin7: "iso885913",
		latin8: "iso885914",
		latin9: "iso885915",
		latin10: "iso885916",
		csisolatin1: "iso88591",
		csisolatin2: "iso88592",
		csisolatin3: "iso88593",
		csisolatin4: "iso88594",
		csisolatincyrillic: "iso88595",
		csisolatinarabic: "iso88596",
		csisolatingreek: "iso88597",
		csisolatinhebrew: "iso88598",
		csisolatin5: "iso88599",
		csisolatin6: "iso885910",
		l1: "iso88591",
		l2: "iso88592",
		l3: "iso88593",
		l4: "iso88594",
		l5: "iso88599",
		l6: "iso885910",
		l7: "iso885913",
		l8: "iso885914",
		l9: "iso885915",
		l10: "iso885916",
		isoir14: "iso646jp",
		isoir57: "iso646cn",
		isoir100: "iso88591",
		isoir101: "iso88592",
		isoir109: "iso88593",
		isoir110: "iso88594",
		isoir144: "iso88595",
		isoir127: "iso88596",
		isoir126: "iso88597",
		isoir138: "iso88598",
		isoir148: "iso88599",
		isoir157: "iso885910",
		isoir166: "tis620",
		isoir179: "iso885913",
		isoir199: "iso885914",
		isoir203: "iso885915",
		isoir226: "iso885916",
		cp819: "iso88591",
		ibm819: "iso88591",
		cyrillic: "iso88595",
		arabic: "iso88596",
		arabic8: "iso88596",
		ecma114: "iso88596",
		asmo708: "iso88596",
		greek: "iso88597",
		greek8: "iso88597",
		ecma118: "iso88597",
		elot928: "iso88597",
		hebrew: "iso88598",
		hebrew8: "iso88598",
		iso88598i: "iso88598",
		iso88598e: "iso88598",
		turkish: "iso88599",
		turkish8: "iso88599",
		thai: "iso885911",
		thai8: "iso885911",
		celtic: "iso885914",
		celtic8: "iso885914",
		isoceltic: "iso885914",
		tis6200: "tis620",
		tis62025291: "tis620",
		tis62025330: "tis620",
		1e4: "macroman",
		10006: "macgreek",
		10007: "maccyrillic",
		10079: "maciceland",
		10081: "macturkish",
		cspc8codepage437: "cp437",
		cspc775baltic: "cp775",
		cspc850multilingual: "cp850",
		cspcp852: "cp852",
		cspc862latinhebrew: "cp862",
		cpgr: "cp869",
		msee: "cp1250",
		mscyrl: "cp1251",
		msansi: "cp1252",
		msgreek: "cp1253",
		msturk: "cp1254",
		mshebr: "cp1255",
		msarab: "cp1256",
		winbaltrim: "cp1257",
		cp20866: "koi8r",
		20866: "koi8r",
		ibm878: "koi8r",
		cskoi8r: "koi8r",
		cp21866: "koi8u",
		21866: "koi8u",
		ibm1168: "koi8u",
		strk10482002: "rk1048",
		tcvn5712: "tcvn",
		tcvn57121: "tcvn",
		gb198880: "iso646cn",
		cn: "iso646cn",
		csiso14jisc6220ro: "iso646jp",
		jisc62201969ro: "iso646jp",
		jp: "iso646jp",
		cshproman8: "hproman8",
		r8: "hproman8",
		roman8: "hproman8",
		xroman8: "hproman8",
		ibm1051: "hproman8",
		mac: "macintosh",
		csmacintosh: "macintosh"
	};
})), um = /* @__PURE__ */ a(((e, t) => {
	t.exports = {
		437: "cp437",
		737: "cp737",
		775: "cp775",
		850: "cp850",
		852: "cp852",
		855: "cp855",
		856: "cp856",
		857: "cp857",
		858: "cp858",
		860: "cp860",
		861: "cp861",
		862: "cp862",
		863: "cp863",
		864: "cp864",
		865: "cp865",
		866: "cp866",
		869: "cp869",
		874: "windows874",
		922: "cp922",
		1046: "cp1046",
		1124: "cp1124",
		1125: "cp1125",
		1129: "cp1129",
		1133: "cp1133",
		1161: "cp1161",
		1162: "cp1162",
		1163: "cp1163",
		1250: "windows1250",
		1251: "windows1251",
		1252: "windows1252",
		1253: "windows1253",
		1254: "windows1254",
		1255: "windows1255",
		1256: "windows1256",
		1257: "windows1257",
		1258: "windows1258",
		28591: "iso88591",
		28592: "iso88592",
		28593: "iso88593",
		28594: "iso88594",
		28595: "iso88595",
		28596: "iso88596",
		28597: "iso88597",
		28598: "iso88598",
		28599: "iso88599",
		28600: "iso885910",
		28601: "iso885911",
		28603: "iso885913",
		28604: "iso885914",
		28605: "iso885915",
		28606: "iso885916",
		windows874: {
			type: "_sbcs",
			chars: "€����…�����������‘’“”•–—��������\xA0กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮฯะัาำิีึืฺุู����฿เแโใไๅๆ็่้๊๋์ํ๎๏๐๑๒๓๔๕๖๗๘๙๚๛����"
		},
		win874: "windows874",
		cp874: "windows874",
		windows1250: {
			type: "_sbcs",
			chars: "€�‚�„…†‡�‰Š‹ŚŤŽŹ�‘’“”•–—�™š›śťžź\xA0ˇ˘Ł¤Ą¦§¨©Ş«¬­®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙"
		},
		win1250: "windows1250",
		cp1250: "windows1250",
		windows1251: {
			type: "_sbcs",
			chars: "ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—�™љ›њќћџ\xA0ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕїАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя"
		},
		win1251: "windows1251",
		cp1251: "windows1251",
		windows1252: {
			type: "_sbcs",
			chars: "€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž��‘’“”•–—˜™š›œ�žŸ\xA0¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ"
		},
		win1252: "windows1252",
		cp1252: "windows1252",
		windows1253: {
			type: "_sbcs",
			chars: "€�‚ƒ„…†‡�‰�‹�����‘’“”•–—�™�›����\xA0΅Ά£¤¥¦§¨©�«¬­®―°±²³΄µ¶·ΈΉΊ»Ό½ΎΏΐΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡ�ΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώ�"
		},
		win1253: "windows1253",
		cp1253: "windows1253",
		windows1254: {
			type: "_sbcs",
			chars: "€�‚ƒ„…†‡ˆ‰Š‹Œ����‘’“”•–—˜™š›œ��Ÿ\xA0¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏĞÑÒÓÔÕÖ×ØÙÚÛÜİŞßàáâãäåæçèéêëìíîïğñòóôõö÷øùúûüışÿ"
		},
		win1254: "windows1254",
		cp1254: "windows1254",
		windows1255: {
			type: "_sbcs",
			chars: "€�‚ƒ„…†‡ˆ‰�‹�����‘’“”•–—˜™�›����\xA0¡¢£₪¥¦§¨©×«¬­®¯°±²³´µ¶·¸¹÷»¼½¾¿ְֱֲֳִֵֶַָֹֺֻּֽ־ֿ׀ׁׂ׃װױײ׳״�������אבגדהוזחטיךכלםמןנסעףפץצקרשת��‎‏�"
		},
		win1255: "windows1255",
		cp1255: "windows1255",
		windows1256: {
			type: "_sbcs",
			chars: "€پ‚ƒ„…†‡ˆ‰ٹ‹Œچژڈگ‘’“”•–—ک™ڑ›œ‌‍ں\xA0،¢£¤¥¦§¨©ھ«¬­®¯°±²³´µ¶·¸¹؛»¼½¾؟ہءآأؤإئابةتثجحخدذرزسشصض×طظعغـفقكàلâمنهوçèéêëىيîïًٌٍَôُِ÷ّùْûü‎‏ے"
		},
		win1256: "windows1256",
		cp1256: "windows1256",
		windows1257: {
			type: "_sbcs",
			chars: "€�‚�„…†‡�‰�‹�¨ˇ¸�‘’“”•–—�™�›�¯˛�\xA0�¢£¤�¦§Ø©Ŗ«¬­®Æ°±²³´µ¶·ø¹ŗ»¼½¾æĄĮĀĆÄÅĘĒČÉŹĖĢĶĪĻŠŃŅÓŌÕÖ×ŲŁŚŪÜŻŽßąįāćäåęēčéźėģķīļšńņóōõö÷ųłśūüżž˙"
		},
		win1257: "windows1257",
		cp1257: "windows1257",
		windows1258: {
			type: "_sbcs",
			chars: "€�‚ƒ„…†‡ˆ‰�‹Œ����‘’“”•–—˜™�›œ��Ÿ\xA0¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂĂÄÅÆÇÈÉÊË̀ÍÎÏĐÑ̉ÓÔƠÖ×ØÙÚÛÜỮßàáâăäåæçèéêë́íîïđṇ̃óôơö÷øùúûüư₫ÿ"
		},
		win1258: "windows1258",
		cp1258: "windows1258",
		iso88591: {
			type: "_sbcs",
			chars: "\xA0¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ"
		},
		cp28591: "iso88591",
		iso88592: {
			type: "_sbcs",
			chars: "\xA0Ą˘Ł¤ĽŚ§¨ŠŞŤŹ­ŽŻ°ą˛ł´ľśˇ¸šşťź˝žżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙"
		},
		cp28592: "iso88592",
		iso88593: {
			type: "_sbcs",
			chars: "\xA0Ħ˘£¤�Ĥ§¨İŞĞĴ­�Ż°ħ²³´µĥ·¸ışğĵ½�żÀÁÂ�ÄĊĈÇÈÉÊËÌÍÎÏ�ÑÒÓÔĠÖ×ĜÙÚÛÜŬŜßàáâ�äċĉçèéêëìíîï�ñòóôġö÷ĝùúûüŭŝ˙"
		},
		cp28593: "iso88593",
		iso88594: {
			type: "_sbcs",
			chars: "\xA0ĄĸŖ¤ĨĻ§¨ŠĒĢŦ­Ž¯°ą˛ŗ´ĩļˇ¸šēģŧŊžŋĀÁÂÃÄÅÆĮČÉĘËĖÍÎĪĐŅŌĶÔÕÖ×ØŲÚÛÜŨŪßāáâãäåæįčéęëėíîīđņōķôõö÷øųúûüũū˙"
		},
		cp28594: "iso88594",
		iso88595: {
			type: "_sbcs",
			chars: "\xA0ЁЂЃЄЅІЇЈЉЊЋЌ­ЎЏАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя№ёђѓєѕіїјљњћќ§ўџ"
		},
		cp28595: "iso88595",
		iso88596: {
			type: "_sbcs",
			chars: "\xA0���¤�������،­�������������؛���؟�ءآأؤإئابةتثجحخدذرزسشصضطظعغ�����ـفقكلمنهوىيًٌٍَُِّْ�������������"
		},
		cp28596: "iso88596",
		iso88597: {
			type: "_sbcs",
			chars: "\xA0‘’£€₯¦§¨©ͺ«¬­�―°±²³΄΅Ά·ΈΉΊ»Ό½ΎΏΐΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡ�ΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώ�"
		},
		cp28597: "iso88597",
		iso88598: {
			type: "_sbcs",
			chars: "\xA0�¢£¤¥¦§¨©×«¬­®¯°±²³´µ¶·¸¹÷»¼½¾��������������������������������‗אבגדהוזחטיךכלםמןנסעףפץצקרשת��‎‏�"
		},
		cp28598: "iso88598",
		iso88599: {
			type: "_sbcs",
			chars: "\xA0¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏĞÑÒÓÔÕÖ×ØÙÚÛÜİŞßàáâãäåæçèéêëìíîïğñòóôõö÷øùúûüışÿ"
		},
		cp28599: "iso88599",
		iso885910: {
			type: "_sbcs",
			chars: "\xA0ĄĒĢĪĨĶ§ĻĐŠŦŽ­ŪŊ°ąēģīĩķ·ļđšŧž―ūŋĀÁÂÃÄÅÆĮČÉĘËĖÍÎÏÐŅŌÓÔÕÖŨØŲÚÛÜÝÞßāáâãäåæįčéęëėíîïðņōóôõöũøųúûüýþĸ"
		},
		cp28600: "iso885910",
		iso885911: {
			type: "_sbcs",
			chars: "\xA0กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮฯะัาำิีึืฺุู����฿เแโใไๅๆ็่้๊๋์ํ๎๏๐๑๒๓๔๕๖๗๘๙๚๛����"
		},
		cp28601: "iso885911",
		iso885913: {
			type: "_sbcs",
			chars: "\xA0”¢£¤„¦§Ø©Ŗ«¬­®Æ°±²³“µ¶·ø¹ŗ»¼½¾æĄĮĀĆÄÅĘĒČÉŹĖĢĶĪĻŠŃŅÓŌÕÖ×ŲŁŚŪÜŻŽßąįāćäåęēčéźėģķīļšńņóōõö÷ųłśūüżž’"
		},
		cp28603: "iso885913",
		iso885914: {
			type: "_sbcs",
			chars: "\xA0Ḃḃ£ĊċḊ§Ẁ©ẂḋỲ­®ŸḞḟĠġṀṁ¶ṖẁṗẃṠỳẄẅṡÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏŴÑÒÓÔÕÖṪØÙÚÛÜÝŶßàáâãäåæçèéêëìíîïŵñòóôõöṫøùúûüýŷÿ"
		},
		cp28604: "iso885914",
		iso885915: {
			type: "_sbcs",
			chars: "\xA0¡¢£€¥Š§š©ª«¬­®¯°±²³Žµ¶·ž¹º»ŒœŸ¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ"
		},
		cp28605: "iso885915",
		iso885916: {
			type: "_sbcs",
			chars: "\xA0ĄąŁ€„Š§š©Ș«Ź­źŻ°±ČłŽ”¶·žčș»ŒœŸżÀÁÂĂÄĆÆÇÈÉÊËÌÍÎÏĐŃÒÓÔŐÖŚŰÙÚÛÜĘȚßàáâăäćæçèéêëìíîïđńòóôőöśűùúûüęțÿ"
		},
		cp28606: "iso885916",
		cp437: {
			type: "_sbcs",
			chars: "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xA0"
		},
		ibm437: "cp437",
		csibm437: "cp437",
		cp737: {
			type: "_sbcs",
			chars: "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρσςτυφχψ░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀ωάέήϊίόύϋώΆΈΉΊΌΎΏ±≥≤ΪΫ÷≈°∙·√ⁿ²■\xA0"
		},
		ibm737: "cp737",
		csibm737: "cp737",
		cp775: {
			type: "_sbcs",
			chars: "ĆüéāäģåćłēŖŗīŹÄÅÉæÆōöĢ¢ŚśÖÜø£Ø×¤ĀĪóŻżź”¦©®¬½¼Ł«»░▒▓│┤ĄČĘĖ╣║╗╝ĮŠ┐└┴┬├─┼ŲŪ╚╔╩╦╠═╬Žąčęėįšųūž┘┌█▄▌▐▀ÓßŌŃõÕµńĶķĻļņĒŅ’­±“¾¶§÷„°∙·¹³²■\xA0"
		},
		ibm775: "cp775",
		csibm775: "cp775",
		cp850: {
			type: "_sbcs",
			chars: "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■\xA0"
		},
		ibm850: "cp850",
		csibm850: "cp850",
		cp852: {
			type: "_sbcs",
			chars: "ÇüéâäůćçłëŐőîŹÄĆÉĹĺôöĽľŚśÖÜŤťŁ×čáíóúĄąŽžĘę¬źČş«»░▒▓│┤ÁÂĚŞ╣║╗╝Żż┐└┴┬├─┼Ăă╚╔╩╦╠═╬¤đĐĎËďŇÍÎě┘┌█▄ŢŮ▀ÓßÔŃńňŠšŔÚŕŰýÝţ´­˝˛ˇ˘§÷¸°¨˙űŘř■\xA0"
		},
		ibm852: "cp852",
		csibm852: "cp852",
		cp855: {
			type: "_sbcs",
			chars: "ђЂѓЃёЁєЄѕЅіІїЇјЈљЉњЊћЋќЌўЎџЏюЮъЪаАбБцЦдДеЕфФгГ«»░▒▓│┤хХиИ╣║╗╝йЙ┐└┴┬├─┼кК╚╔╩╦╠═╬¤лЛмМнНоОп┘┌█▄Пя▀ЯрРсСтТуУжЖвВьЬ№­ыЫзЗшШэЭщЩчЧ§■\xA0"
		},
		ibm855: "cp855",
		csibm855: "cp855",
		cp856: {
			type: "_sbcs",
			chars: "אבגדהוזחטיךכלםמןנסעףפץצקרשת�£�×����������®¬½¼�«»░▒▓│┤���©╣║╗╝¢¥┐└┴┬├─┼��╚╔╩╦╠═╬¤���������┘┌█▄¦�▀������µ�������¯´­±‗¾¶§÷¸°¨·¹³²■\xA0"
		},
		ibm856: "cp856",
		csibm856: "cp856",
		cp857: {
			type: "_sbcs",
			chars: "ÇüéâäàåçêëèïîıÄÅÉæÆôöòûùİÖÜø£ØŞşáíóúñÑĞğ¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ºªÊËÈ�ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµ�×ÚÛÙìÿ¯´­±�¾¶§÷¸°¨·¹³²■\xA0"
		},
		ibm857: "cp857",
		csibm857: "cp857",
		cp858: {
			type: "_sbcs",
			chars: "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■\xA0"
		},
		ibm858: "cp858",
		csibm858: "cp858",
		cp860: {
			type: "_sbcs",
			chars: "ÇüéâãàÁçêÊèÍÔìÃÂÉÀÈôõòÚùÌÕÜ¢£Ù₧ÓáíóúñÑªº¿Ò¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xA0"
		},
		ibm860: "cp860",
		csibm860: "cp860",
		cp861: {
			type: "_sbcs",
			chars: "ÇüéâäàåçêëèÐðÞÄÅÉæÆôöþûÝýÖÜø£Ø₧ƒáíóúÁÍÓÚ¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xA0"
		},
		ibm861: "cp861",
		csibm861: "cp861",
		cp862: {
			type: "_sbcs",
			chars: "אבגדהוזחטיךכלםמןנסעףפץצקרשת¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xA0"
		},
		ibm862: "cp862",
		csibm862: "cp862",
		cp863: {
			type: "_sbcs",
			chars: "ÇüéâÂà¶çêëèïî‗À§ÉÈÊôËÏûù¤ÔÜ¢£ÙÛƒ¦´óú¨¸³¯Î⌐¬½¼¾«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xA0"
		},
		ibm863: "cp863",
		csibm863: "cp863",
		cp864: {
			type: "_sbcs",
			chars: "\0\x07\b	\n\v\f\r\x1B !\"#$٪&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~°·∙√▒─│┼┤┬├┴┐┌└┘β∞φ±½¼≈«»ﻷﻸ��ﻻﻼ�\xA0­ﺂ£¤ﺄ��ﺎﺏﺕﺙ،ﺝﺡﺥ٠١٢٣٤٥٦٧٨٩ﻑ؛ﺱﺵﺹ؟¢ﺀﺁﺃﺅﻊﺋﺍﺑﺓﺗﺛﺟﺣﺧﺩﺫﺭﺯﺳﺷﺻﺿﻁﻅﻋﻏ¦¬÷×ﻉـﻓﻗﻛﻟﻣﻧﻫﻭﻯﻳﺽﻌﻎﻍﻡﹽّﻥﻩﻬﻰﻲﻐﻕﻵﻶﻝﻙﻱ■�"
		},
		ibm864: "cp864",
		csibm864: "cp864",
		cp865: {
			type: "_sbcs",
			chars: "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø₧ƒáíóúñÑªº¿⌐¬½¼¡«¤░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xA0"
		},
		ibm865: "cp865",
		csibm865: "cp865",
		cp866: {
			type: "_sbcs",
			chars: "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмноп░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀рстуфхцчшщъыьэюяЁёЄєЇїЎў°∙·√№¤■\xA0"
		},
		ibm866: "cp866",
		csibm866: "cp866",
		cp869: {
			type: "_sbcs",
			chars: "������Ά�·¬¦‘’Έ―ΉΊΪΌ��ΎΫ©Ώ²³ά£έήίϊΐόύΑΒΓΔΕΖΗ½ΘΙ«»░▒▓│┤ΚΛΜΝ╣║╗╝ΞΟ┐└┴┬├─┼ΠΡ╚╔╩╦╠═╬ΣΤΥΦΧΨΩαβγ┘┌█▄δε▀ζηθικλμνξοπρσςτ΄­±υφχ§ψ΅°¨ωϋΰώ■\xA0"
		},
		ibm869: "cp869",
		csibm869: "cp869",
		cp922: {
			type: "_sbcs",
			chars: "\xA0¡¢£¤¥¦§¨©ª«¬­®‾°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏŠÑÒÓÔÕÖ×ØÙÚÛÜÝŽßàáâãäåæçèéêëìíîïšñòóôõö÷øùúûüýžÿ"
		},
		ibm922: "cp922",
		csibm922: "cp922",
		cp1046: {
			type: "_sbcs",
			chars: "ﺈ×÷ﹱ■│─┐┌└┘ﹹﹻﹽﹿﹷﺊﻰﻳﻲﻎﻏﻐﻶﻸﻺﻼ\xA0¤ﺋﺑﺗﺛﺟﺣ،­ﺧﺳ٠١٢٣٤٥٦٧٨٩ﺷ؛ﺻﺿﻊ؟ﻋءآأؤإئابةتثجحخدذرزسشصضطﻇعغﻌﺂﺄﺎﻓـفقكلمنهوىيًٌٍَُِّْﻗﻛﻟﻵﻷﻹﻻﻣﻧﻬﻩ�"
		},
		ibm1046: "cp1046",
		csibm1046: "cp1046",
		cp1124: {
			type: "_sbcs",
			chars: "\xA0ЁЂҐЄЅІЇЈЉЊЋЌ­ЎЏАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя№ёђґєѕіїјљњћќ§ўџ"
		},
		ibm1124: "cp1124",
		csibm1124: "cp1124",
		cp1125: {
			type: "_sbcs",
			chars: "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмноп░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀рстуфхцчшщъыьэюяЁёҐґЄєІіЇї·√№¤■\xA0"
		},
		ibm1125: "cp1125",
		csibm1125: "cp1125",
		cp1129: {
			type: "_sbcs",
			chars: "\xA0¡¢£¤¥¦§œ©ª«¬­®¯°±²³Ÿµ¶·Œ¹º»¼½¾¿ÀÁÂĂÄÅÆÇÈÉÊË̀ÍÎÏĐÑ̉ÓÔƠÖ×ØÙÚÛÜỮßàáâăäåæçèéêë́íîïđṇ̃óôơö÷øùúûüư₫ÿ"
		},
		ibm1129: "cp1129",
		csibm1129: "cp1129",
		cp1133: {
			type: "_sbcs",
			chars: "\xA0ກຂຄງຈສຊຍດຕຖທນບປຜຝພຟມຢຣລວຫອຮ���ຯະາຳິີຶືຸູຼັົຽ���ເແໂໃໄ່້໊໋໌ໍໆ�ໜໝ₭����������������໐໑໒໓໔໕໖໗໘໙��¢¬¦�"
		},
		ibm1133: "cp1133",
		csibm1133: "cp1133",
		cp1161: {
			type: "_sbcs",
			chars: "��������������������������������่กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮฯะัาำิีึืฺุู้๊๋€฿เแโใไๅๆ็่้๊๋์ํ๎๏๐๑๒๓๔๕๖๗๘๙๚๛¢¬¦\xA0"
		},
		ibm1161: "cp1161",
		csibm1161: "cp1161",
		cp1162: {
			type: "_sbcs",
			chars: "€…‘’“”•–—\xA0กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮฯะัาำิีึืฺุู����฿เแโใไๅๆ็่้๊๋์ํ๎๏๐๑๒๓๔๕๖๗๘๙๚๛����"
		},
		ibm1162: "cp1162",
		csibm1162: "cp1162",
		cp1163: {
			type: "_sbcs",
			chars: "\xA0¡¢£€¥¦§œ©ª«¬­®¯°±²³Ÿµ¶·Œ¹º»¼½¾¿ÀÁÂĂÄÅÆÇÈÉÊË̀ÍÎÏĐÑ̉ÓÔƠÖ×ØÙÚÛÜỮßàáâăäåæçèéêë́íîïđṇ̃óôơö÷øùúûüư₫ÿ"
		},
		ibm1163: "cp1163",
		csibm1163: "cp1163",
		maccroatian: {
			type: "_sbcs",
			chars: "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®Š™´¨≠ŽØ∞±≤≥∆µ∂∑∏š∫ªºΩžø¿¡¬√ƒ≈Ć«Č…\xA0ÀÃÕŒœĐ—“”‘’÷◊�©⁄¤‹›Æ»–·‚„‰ÂćÁčÈÍÎÏÌÓÔđÒÚÛÙıˆ˜¯πË˚¸Êæˇ"
		},
		maccyrillic: {
			type: "_sbcs",
			chars: "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ†°¢£§•¶І®©™Ђђ≠Ѓѓ∞±≤≥іµ∂ЈЄєЇїЉљЊњјЅ¬√ƒ≈∆«»…\xA0ЋћЌќѕ–—“”‘’÷„ЎўЏџ№Ёёяабвгдежзийклмнопрстуфхцчшщъыьэю¤"
		},
		macgreek: {
			type: "_sbcs",
			chars: "Ä¹²É³ÖÜ΅àâä΄¨çéèêë£™îï•½‰ôö¦­ùûü†ΓΔΘΛΞΠß®©ΣΪ§≠°·Α±≤≥¥ΒΕΖΗΙΚΜΦΫΨΩάΝ¬ΟΡ≈Τ«»…\xA0ΥΧΆΈœ–―“”‘’÷ΉΊΌΎέήίόΏύαβψδεφγηιξκλμνοπώρστθωςχυζϊϋΐΰ�"
		},
		maciceland: {
			type: "_sbcs",
			chars: "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûüÝ°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\xA0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄¤ÐðÞþý·‚„‰ÂÊÁËÈÍÎÏÌÓÔ�ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ"
		},
		macroman: {
			type: "_sbcs",
			chars: "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\xA0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄¤‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ�ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ"
		},
		macromania: {
			type: "_sbcs",
			chars: "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ĂŞ∞±≤≥¥µ∂∑∏π∫ªºΩăş¿¡¬√ƒ≈∆«»…\xA0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄¤‹›Ţţ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ�ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ"
		},
		macthai: {
			type: "_sbcs",
			chars: "«»…“”�•‘’�\xA0กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮฯะัาำิีึืฺุู﻿​–—฿เแโใไๅๆ็่้๊๋์ํ™๏๐๑๒๓๔๕๖๗๘๙®©����"
		},
		macturkish: {
			type: "_sbcs",
			chars: "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\xA0ÀÃÕŒœ–—“”‘’÷◊ÿŸĞğİıŞş‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ�ÒÚÛÙ�ˆ˜¯˘˙˚¸˝˛ˇ"
		},
		macukraine: {
			type: "_sbcs",
			chars: "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ†°Ґ£§•¶І®©™Ђђ≠Ѓѓ∞±≤≥іµґЈЄєЇїЉљЊњјЅ¬√ƒ≈∆«»…\xA0ЋћЌќѕ–—“”‘’÷„ЎўЏџ№Ёёяабвгдежзийклмнопрстуфхцчшщъыьэю¤"
		},
		koi8r: {
			type: "_sbcs",
			chars: "─│┌┐└┘├┤┬┴┼▀▄█▌▐░▒▓⌠■∙√≈≤≥\xA0⌡°²·÷═║╒ё╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡Ё╢╣╤╥╦╧╨╩╪╫╬©юабцдефгхийклмнопярстужвьызшэщчъЮАБЦДЕФГХИЙКЛМНОПЯРСТУЖВЬЫЗШЭЩЧЪ"
		},
		koi8u: {
			type: "_sbcs",
			chars: "─│┌┐└┘├┤┬┴┼▀▄█▌▐░▒▓⌠■∙√≈≤≥\xA0⌡°²·÷═║╒ёє╔ії╗╘╙╚╛ґ╝╞╟╠╡ЁЄ╣ІЇ╦╧╨╩╪Ґ╬©юабцдефгхийклмнопярстужвьызшэщчъЮАБЦДЕФГХИЙКЛМНОПЯРСТУЖВЬЫЗШЭЩЧЪ"
		},
		koi8ru: {
			type: "_sbcs",
			chars: "─│┌┐└┘├┤┬┴┼▀▄█▌▐░▒▓⌠■∙√≈≤≥\xA0⌡°²·÷═║╒ёє╔ії╗╘╙╚╛ґў╞╟╠╡ЁЄ╣ІЇ╦╧╨╩╪ҐЎ©юабцдефгхийклмнопярстужвьызшэщчъЮАБЦДЕФГХИЙКЛМНОПЯРСТУЖВЬЫЗШЭЩЧЪ"
		},
		koi8t: {
			type: "_sbcs",
			chars: "қғ‚Ғ„…†‡�‰ҳ‹ҲҷҶ�Қ‘’“”•–—�™�›�����ӯӮё¤ӣ¦§���«¬­®�°±²Ё�Ӣ¶·�№�»���©юабцдефгхийклмнопярстужвьызшэщчъЮАБЦДЕФГХИЙКЛМНОПЯРСТУЖВЬЫЗШЭЩЧЪ"
		},
		armscii8: {
			type: "_sbcs",
			chars: "\xA0�և։)(»«—.՝,-֊…՜՛՞ԱաԲբԳգԴդԵեԶզԷէԸըԹթԺժԻիԼլԽխԾծԿկՀհՁձՂղՃճՄմՅյՆնՇշՈոՉչՊպՋջՌռՍսՎվՏտՐրՑցՒւՓփՔքՕօՖֆ՚�"
		},
		rk1048: {
			type: "_sbcs",
			chars: "ЂЃ‚ѓ„…†‡€‰Љ‹ЊҚҺЏђ‘’“”•–—�™љ›њқһџ\xA0ҰұӘ¤Ө¦§Ё©Ғ«¬­®Ү°±Ііөµ¶·ё№ғ»әҢңүАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя"
		},
		tcvn: {
			type: "_sbcs",
			chars: "\0ÚỤỪỬỮ\x07\b	\n\v\f\rỨỰỲỶỸÝỴ\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ÀẢÃÁẠẶẬÈẺẼÉẸỆÌỈĨÍỊÒỎÕÓỌỘỜỞỠỚỢÙỦŨ\xA0ĂÂÊÔƠƯĐăâêôơưđẶ̀̀̉̃́àảãáạẲằẳẵắẴẮẦẨẪẤỀặầẩẫấậèỂẻẽéẹềểễếệìỉỄẾỒĩíịòỔỏõóọồổỗốộờởỡớợùỖủũúụừửữứựỳỷỹýỵỐ"
		},
		georgianacademy: {
			type: "_sbcs",
			chars: "‚ƒ„…†‡ˆ‰Š‹Œ‘’“”•–—˜™š›œŸ\xA0¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰჱჲჳჴჵჶçèéêëìíîïðñòóôõö÷øùúûüýþÿ"
		},
		georgianps: {
			type: "_sbcs",
			chars: "‚ƒ„…†‡ˆ‰Š‹Œ‘’“”•–—˜™š›œŸ\xA0¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿აბგდევზჱთიკლმნჲოპჟრსტჳუფქღყშჩცძწჭხჴჯჰჵæçèéêëìíîïðñòóôõö÷øùúûüýþÿ"
		},
		pt154: {
			type: "_sbcs",
			chars: "ҖҒӮғ„…ҶҮҲүҠӢҢҚҺҸҗ‘’“”•–—ҳҷҡӣңқһҹ\xA0ЎўЈӨҘҰ§Ё©Ә«¬ӯ®Ҝ°ұІіҙө¶·ё№ә»јҪҫҝАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя"
		},
		viscii: {
			type: "_sbcs",
			chars: "\0ẲẴẪ\x07\b	\n\v\f\rỶỸ\x1BỴ !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ẠẮẰẶẤẦẨẬẼẸẾỀỂỄỆỐỒỔỖỘỢỚỜỞỊỎỌỈỦŨỤỲÕắằặấầẩậẽẹếềểễệốồổỗỠƠộờởịỰỨỪỬơớƯÀÁÂÃẢĂẳẵÈÉÊẺÌÍĨỳĐứÒÓÔạỷừửÙÚỹỵÝỡưàáâãảăữẫèéêẻìíĩỉđựòóôõỏọụùúũủýợỮ"
		},
		iso646cn: {
			type: "_sbcs",
			chars: "\0\x07\b	\n\v\f\r\x1B !\"#¥%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}‾��������������������������������������������������������������������������������������������������������������������������������"
		},
		iso646jp: {
			type: "_sbcs",
			chars: "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[¥]^_`abcdefghijklmnopqrstuvwxyz{|}‾��������������������������������������������������������������������������������������������������������������������������������"
		},
		hproman8: {
			type: "_sbcs",
			chars: "\xA0ÀÂÈÊËÎÏ´ˋˆ¨˜ÙÛ₤¯Ýý°ÇçÑñ¡¿¤£¥§ƒ¢âêôûáéóúàèòùäëöüÅîØÆåíøæÄìÖÜÉïßÔÁÃãÐðÍÌÓÒÕõŠšÚŸÿÞþ·µ¶¾—¼½ªº«■»±�"
		},
		macintosh: {
			type: "_sbcs",
			chars: "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\xA0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄¤‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ�ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ"
		},
		ascii: {
			type: "_sbcs",
			chars: "��������������������������������������������������������������������������������������������������������������������������������"
		},
		tis620: {
			type: "_sbcs",
			chars: "���������������������������������กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮฯะัาำิีึืฺุู����฿เแโใไๅๆ็่้๊๋์ํ๎๏๐๑๒๓๔๕๖๗๘๙๚๛����"
		}
	};
})), dm = /* @__PURE__ */ a(((e) => {
	var t = tm().Buffer;
	e._dbcs = l;
	for (var n = -1, r = -2, i = -10, a = -1e3, o = Array(256), s = -1, c = 0; c < 256; c++) o[c] = n;
	function l(e, t) {
		if (this.encodingName = e.encodingName, !e) throw Error("DBCS codec is called without the data.");
		if (!e.table) throw Error("Encoding '" + this.encodingName + "' has no data.");
		var i = e.table();
		this.decodeTables = [], this.decodeTables[0] = o.slice(0), this.decodeTableSeq = [];
		for (var s = 0; s < i.length; s++) this._addDecodeChunk(i[s]);
		if (typeof e.gb18030 == "function") {
			this.gb18030 = e.gb18030();
			var c = this.decodeTables.length;
			this.decodeTables.push(o.slice(0));
			var l = this.decodeTables.length;
			this.decodeTables.push(o.slice(0));
			for (var u = this.decodeTables[0], s = 129; s <= 254; s++) for (var d = this.decodeTables[a - u[s]], f = 48; f <= 57; f++) {
				if (d[f] === n) d[f] = a - c;
				else if (d[f] > a) throw Error("gb18030 decode tables conflict at byte 2");
				for (var p = this.decodeTables[a - d[f]], m = 129; m <= 254; m++) {
					if (p[m] === n) p[m] = a - l;
					else if (p[m] === a - l) continue;
					else if (p[m] > a) throw Error("gb18030 decode tables conflict at byte 3");
					for (var h = this.decodeTables[a - p[m]], g = 48; g <= 57; g++) h[g] === n && (h[g] = r);
				}
			}
		}
		this.defaultCharUnicode = t.defaultCharUnicode, this.encodeTable = [], this.encodeTableSeq = [];
		var _ = {};
		if (e.encodeSkipVals) for (var s = 0; s < e.encodeSkipVals.length; s++) {
			var v = e.encodeSkipVals[s];
			if (typeof v == "number") _[v] = !0;
			else for (var f = v.from; f <= v.to; f++) _[f] = !0;
		}
		if (this._fillEncodeTable(0, 0, _), e.encodeAdd) for (var y in e.encodeAdd) Object.prototype.hasOwnProperty.call(e.encodeAdd, y) && this._setEncodeChar(y.charCodeAt(0), e.encodeAdd[y]);
		this.defCharSB = this.encodeTable[0][t.defaultCharSingleByte.charCodeAt(0)], this.defCharSB === n && (this.defCharSB = this.encodeTable[0]["?"]), this.defCharSB === n && (this.defCharSB = 63);
	}
	l.prototype.encoder = u, l.prototype.decoder = d, l.prototype._getDecodeTrieNode = function(e) {
		for (var t = []; e > 0; e >>>= 8) t.push(e & 255);
		t.length == 0 && t.push(0);
		for (var r = this.decodeTables[0], i = t.length - 1; i > 0; i--) {
			var s = r[t[i]];
			if (s == n) r[t[i]] = a - this.decodeTables.length, this.decodeTables.push(r = o.slice(0));
			else if (s <= a) r = this.decodeTables[a - s];
			else throw Error("Overwrite byte in " + this.encodingName + ", addr: " + e.toString(16));
		}
		return r;
	}, l.prototype._addDecodeChunk = function(e) {
		var t = parseInt(e[0], 16), n = this._getDecodeTrieNode(t);
		t &= 255;
		for (var r = 1; r < e.length; r++) {
			var a = e[r];
			if (typeof a == "string") for (var o = 0; o < a.length;) {
				var s = a.charCodeAt(o++);
				if (s >= 55296 && s < 56320) {
					var c = a.charCodeAt(o++);
					if (c >= 56320 && c < 57344) n[t++] = 65536 + (s - 55296) * 1024 + (c - 56320);
					else throw Error("Incorrect surrogate pair in " + this.encodingName + " at chunk " + e[0]);
				} else if (s > 4080 && s <= 4095) {
					for (var l = 4095 - s + 2, u = [], d = 0; d < l; d++) u.push(a.charCodeAt(o++));
					n[t++] = i - this.decodeTableSeq.length, this.decodeTableSeq.push(u);
				} else n[t++] = s;
			}
			else if (typeof a == "number") for (var f = n[t - 1] + 1, o = 0; o < a; o++) n[t++] = f++;
			else throw Error("Incorrect type '" + typeof a + "' given in " + this.encodingName + " at chunk " + e[0]);
		}
		if (t > 255) throw Error("Incorrect chunk in " + this.encodingName + " at addr " + e[0] + ": too long" + t);
	}, l.prototype._getEncodeBucket = function(e) {
		var t = e >> 8;
		return this.encodeTable[t] === void 0 && (this.encodeTable[t] = o.slice(0)), this.encodeTable[t];
	}, l.prototype._setEncodeChar = function(e, t) {
		var r = this._getEncodeBucket(e), a = e & 255;
		r[a] <= i ? this.encodeTableSeq[i - r[a]][s] = t : r[a] == n && (r[a] = t);
	}, l.prototype._setEncodeSequence = function(e, t) {
		var r = e[0], a = this._getEncodeBucket(r), o = r & 255, c;
		a[o] <= i ? c = this.encodeTableSeq[i - a[o]] : (c = {}, a[o] !== n && (c[s] = a[o]), a[o] = i - this.encodeTableSeq.length, this.encodeTableSeq.push(c));
		for (var l = 1; l < e.length - 1; l++) {
			var u = c[r];
			typeof u == "object" ? c = u : (c = c[r] = {}, u !== void 0 && (c[s] = u));
		}
		r = e[e.length - 1], c[r] = t;
	}, l.prototype._fillEncodeTable = function(e, t, n) {
		for (var r = this.decodeTables[e], o = !1, s = {}, c = 0; c < 256; c++) {
			var l = r[c], u = t + c;
			if (!n[u]) {
				if (l >= 0) this._setEncodeChar(l, u), o = !0;
				else if (l <= a) {
					var d = a - l;
					if (!s[d]) {
						var f = u << 8 >>> 0;
						this._fillEncodeTable(d, f, n) ? o = !0 : s[d] = !0;
					}
				} else l <= i && (this._setEncodeSequence(this.decodeTableSeq[i - l], u), o = !0);
			}
		}
		return o;
	};
	function u(e, t) {
		this.leadSurrogate = -1, this.seqObj = void 0, this.encodeTable = t.encodeTable, this.encodeTableSeq = t.encodeTableSeq, this.defaultCharSingleByte = t.defCharSB, this.gb18030 = t.gb18030;
	}
	u.prototype.write = function(e) {
		for (var r = t.alloc(e.length * (this.gb18030 ? 4 : 3)), a = this.leadSurrogate, o = this.seqObj, c = -1, l = 0, u = 0;;) {
			if (c === -1) {
				if (l == e.length) break;
				var d = e.charCodeAt(l++);
			} else {
				var d = c;
				c = -1;
			}
			if (d >= 55296 && d < 57344) {
				if (d < 56320) {
					if (a === -1) {
						a = d;
						continue;
					}
					a = d, d = n;
				} else a === -1 ? d = n : (d = 65536 + (a - 55296) * 1024 + (d - 56320), a = -1);
			} else a !== -1 && (c = d, d = n, a = -1);
			var p = n;
			if (o !== void 0 && d != n) {
				var m = o[d];
				if (typeof m == "object") {
					o = m;
					continue;
				}
				typeof m == "number" ? p = m : m ?? (m = o[s], m !== void 0 && (p = m, c = d)), o = void 0;
			} else if (d >= 0) {
				var h = this.encodeTable[d >> 8];
				if (h !== void 0 && (p = h[d & 255]), p <= i) {
					o = this.encodeTableSeq[i - p];
					continue;
				}
				if (p == n && this.gb18030) {
					var g = f(this.gb18030.uChars, d);
					if (g != -1) {
						var p = this.gb18030.gbChars[g] + (d - this.gb18030.uChars[g]);
						r[u++] = 129 + Math.floor(p / 12600), p %= 12600, r[u++] = 48 + Math.floor(p / 1260), p %= 1260, r[u++] = 129 + Math.floor(p / 10), p %= 10, r[u++] = 48 + p;
						continue;
					}
				}
			}
			p === n && (p = this.defaultCharSingleByte), p < 256 ? r[u++] = p : p < 65536 ? (r[u++] = p >> 8, r[u++] = p & 255) : p < 16777216 ? (r[u++] = p >> 16, r[u++] = p >> 8 & 255, r[u++] = p & 255) : (r[u++] = p >>> 24, r[u++] = p >>> 16 & 255, r[u++] = p >>> 8 & 255, r[u++] = p & 255);
		}
		return this.seqObj = o, this.leadSurrogate = a, r.slice(0, u);
	}, u.prototype.end = function() {
		if (this.leadSurrogate !== -1 || this.seqObj !== void 0) {
			var e = t.alloc(10), n = 0;
			if (this.seqObj) {
				var r = this.seqObj[s];
				r !== void 0 && (r < 256 ? e[n++] = r : (e[n++] = r >> 8, e[n++] = r & 255)), this.seqObj = void 0;
			}
			return this.leadSurrogate !== -1 && (e[n++] = this.defaultCharSingleByte, this.leadSurrogate = -1), e.slice(0, n);
		}
	}, u.prototype.findIdx = f;
	function d(e, t) {
		this.nodeIdx = 0, this.prevBytes = [], this.decodeTables = t.decodeTables, this.decodeTableSeq = t.decodeTableSeq, this.defaultCharUnicode = t.defaultCharUnicode, this.gb18030 = t.gb18030;
	}
	d.prototype.write = function(e) {
		for (var o = t.alloc(e.length * 2), s = this.nodeIdx, c = this.prevBytes, l = this.prevBytes.length, u = -this.prevBytes.length, d, p = 0, m = 0; p < e.length; p++) {
			var h = p >= 0 ? e[p] : c[p + l], d = this.decodeTables[s][h];
			if (!(d >= 0)) {
				if (d === n) d = this.defaultCharUnicode.charCodeAt(0), p = u;
				else if (d === r) {
					if (p >= 3) var g = (e[p - 3] - 129) * 12600 + (e[p - 2] - 48) * 1260 + (e[p - 1] - 129) * 10 + (h - 48);
					else var g = (c[p - 3 + l] - 129) * 12600 + ((p - 2 >= 0 ? e[p - 2] : c[p - 2 + l]) - 48) * 1260 + ((p - 1 >= 0 ? e[p - 1] : c[p - 1 + l]) - 129) * 10 + (h - 48);
					var _ = f(this.gb18030.gbChars, g);
					d = this.gb18030.uChars[_] + g - this.gb18030.gbChars[_];
				} else if (d <= a) {
					s = a - d;
					continue;
				} else if (d <= i) {
					for (var v = this.decodeTableSeq[i - d], y = 0; y < v.length - 1; y++) d = v[y], o[m++] = d & 255, o[m++] = d >> 8;
					d = v[v.length - 1];
				} else throw Error("iconv-lite internal error: invalid decoding table value " + d + " at " + s + "/" + h);
			}
			if (d >= 65536) {
				d -= 65536;
				var b = 55296 | d >> 10;
				o[m++] = b & 255, o[m++] = b >> 8, d = 56320 | d & 1023;
			}
			o[m++] = d & 255, o[m++] = d >> 8, s = 0, u = p + 1;
		}
		return this.nodeIdx = s, this.prevBytes = u >= 0 ? Array.prototype.slice.call(e, u) : c.slice(u + l).concat(Array.prototype.slice.call(e)), o.slice(0, m).toString("ucs2");
	}, d.prototype.end = function() {
		for (var e = ""; this.prevBytes.length > 0;) {
			e += this.defaultCharUnicode;
			var t = this.prevBytes.slice(1);
			this.prevBytes = [], this.nodeIdx = 0, t.length > 0 && (e += this.write(t));
		}
		return this.prevBytes = [], this.nodeIdx = 0, e;
	};
	function f(e, t) {
		if (e[0] > t) return -1;
		for (var n = 0, r = e.length; n < r - 1;) {
			var i = n + (r - n + 1 >> 1);
			e[i] <= t ? n = i : r = i;
		}
		return n;
	}
})), fm = /* @__PURE__ */ i({ default: () => pm }), pm, mm = n((() => {
	pm = /*#__PURE__*/ JSON.parse("[[\"0\",\"\\u0000\",128],[\"a1\",\"｡\",62],[\"8140\",\"　、。，．・：；？！゛゜´｀¨＾￣＿ヽヾゝゞ〃仝々〆〇ー―‐／＼～∥｜…‥‘’“”（）〔〕［］｛｝〈\",9,\"＋－±×\"],[\"8180\",\"÷＝≠＜＞≦≧∞∴♂♀°′″℃￥＄￠￡％＃＆＊＠§☆★○●◎◇◆□■△▲▽▼※〒→←↑↓〓\"],[\"81b8\",\"∈∋⊆⊇⊂⊃∪∩\"],[\"81c8\",\"∧∨￢⇒⇔∀∃\"],[\"81da\",\"∠⊥⌒∂∇≡≒≪≫√∽∝∵∫∬\"],[\"81f0\",\"Å‰♯♭♪†‡¶\"],[\"81fc\",\"◯\"],[\"824f\",\"０\",9],[\"8260\",\"Ａ\",25],[\"8281\",\"ａ\",25],[\"829f\",\"ぁ\",82],[\"8340\",\"ァ\",62],[\"8380\",\"ム\",22],[\"839f\",\"Α\",16,\"Σ\",6],[\"83bf\",\"α\",16,\"σ\",6],[\"8440\",\"А\",5,\"ЁЖ\",25],[\"8470\",\"а\",5,\"ёж\",7],[\"8480\",\"о\",17],[\"849f\",\"─│┌┐┘└├┬┤┴┼━┃┏┓┛┗┣┳┫┻╋┠┯┨┷┿┝┰┥┸╂\"],[\"8740\",\"①\",19,\"Ⅰ\",9],[\"875f\",\"㍉㌔㌢㍍㌘㌧㌃㌶㍑㍗㌍㌦㌣㌫㍊㌻㎜㎝㎞㎎㎏㏄㎡\"],[\"877e\",\"㍻\"],[\"8780\",\"〝〟№㏍℡㊤\",4,\"㈱㈲㈹㍾㍽㍼≒≡∫∮∑√⊥∠∟⊿∵∩∪\"],[\"889f\",\"亜唖娃阿哀愛挨姶逢葵茜穐悪握渥旭葦芦鯵梓圧斡扱宛姐虻飴絢綾鮎或粟袷安庵按暗案闇鞍杏以伊位依偉囲夷委威尉惟意慰易椅為畏異移維緯胃萎衣謂違遺医井亥域育郁磯一壱溢逸稲茨芋鰯允印咽員因姻引飲淫胤蔭\"],[\"8940\",\"院陰隠韻吋右宇烏羽迂雨卯鵜窺丑碓臼渦嘘唄欝蔚鰻姥厩浦瓜閏噂云運雲荏餌叡営嬰影映曳栄永泳洩瑛盈穎頴英衛詠鋭液疫益駅悦謁越閲榎厭円\"],[\"8980\",\"園堰奄宴延怨掩援沿演炎焔煙燕猿縁艶苑薗遠鉛鴛塩於汚甥凹央奥往応押旺横欧殴王翁襖鴬鴎黄岡沖荻億屋憶臆桶牡乙俺卸恩温穏音下化仮何伽価佳加可嘉夏嫁家寡科暇果架歌河火珂禍禾稼箇花苛茄荷華菓蝦課嘩貨迦過霞蚊俄峨我牙画臥芽蛾賀雅餓駕介会解回塊壊廻快怪悔恢懐戒拐改\"],[\"8a40\",\"魁晦械海灰界皆絵芥蟹開階貝凱劾外咳害崖慨概涯碍蓋街該鎧骸浬馨蛙垣柿蛎鈎劃嚇各廓拡撹格核殻獲確穫覚角赫較郭閣隔革学岳楽額顎掛笠樫\"],[\"8a80\",\"橿梶鰍潟割喝恰括活渇滑葛褐轄且鰹叶椛樺鞄株兜竃蒲釜鎌噛鴨栢茅萱粥刈苅瓦乾侃冠寒刊勘勧巻喚堪姦完官寛干幹患感慣憾換敢柑桓棺款歓汗漢澗潅環甘監看竿管簡緩缶翰肝艦莞観諌貫還鑑間閑関陥韓館舘丸含岸巌玩癌眼岩翫贋雁頑顔願企伎危喜器基奇嬉寄岐希幾忌揮机旗既期棋棄\"],[\"8b40\",\"機帰毅気汽畿祈季稀紀徽規記貴起軌輝飢騎鬼亀偽儀妓宜戯技擬欺犠疑祇義蟻誼議掬菊鞠吉吃喫桔橘詰砧杵黍却客脚虐逆丘久仇休及吸宮弓急救\"],[\"8b80\",\"朽求汲泣灸球究窮笈級糾給旧牛去居巨拒拠挙渠虚許距鋸漁禦魚亨享京供侠僑兇競共凶協匡卿叫喬境峡強彊怯恐恭挟教橋況狂狭矯胸脅興蕎郷鏡響饗驚仰凝尭暁業局曲極玉桐粁僅勤均巾錦斤欣欽琴禁禽筋緊芹菌衿襟謹近金吟銀九倶句区狗玖矩苦躯駆駈駒具愚虞喰空偶寓遇隅串櫛釧屑屈\"],[\"8c40\",\"掘窟沓靴轡窪熊隈粂栗繰桑鍬勲君薫訓群軍郡卦袈祁係傾刑兄啓圭珪型契形径恵慶慧憩掲携敬景桂渓畦稽系経継繋罫茎荊蛍計詣警軽頚鶏芸迎鯨\"],[\"8c80\",\"劇戟撃激隙桁傑欠決潔穴結血訣月件倹倦健兼券剣喧圏堅嫌建憲懸拳捲検権牽犬献研硯絹県肩見謙賢軒遣鍵険顕験鹸元原厳幻弦減源玄現絃舷言諺限乎個古呼固姑孤己庫弧戸故枯湖狐糊袴股胡菰虎誇跨鈷雇顧鼓五互伍午呉吾娯後御悟梧檎瑚碁語誤護醐乞鯉交佼侯候倖光公功効勾厚口向\"],[\"8d40\",\"后喉坑垢好孔孝宏工巧巷幸広庚康弘恒慌抗拘控攻昂晃更杭校梗構江洪浩港溝甲皇硬稿糠紅紘絞綱耕考肯肱腔膏航荒行衡講貢購郊酵鉱砿鋼閤降\"],[\"8d80\",\"項香高鴻剛劫号合壕拷濠豪轟麹克刻告国穀酷鵠黒獄漉腰甑忽惚骨狛込此頃今困坤墾婚恨懇昏昆根梱混痕紺艮魂些佐叉唆嵯左差査沙瑳砂詐鎖裟坐座挫債催再最哉塞妻宰彩才採栽歳済災采犀砕砦祭斎細菜裁載際剤在材罪財冴坂阪堺榊肴咲崎埼碕鷺作削咋搾昨朔柵窄策索錯桜鮭笹匙冊刷\"],[\"8e40\",\"察拶撮擦札殺薩雑皐鯖捌錆鮫皿晒三傘参山惨撒散桟燦珊産算纂蚕讃賛酸餐斬暫残仕仔伺使刺司史嗣四士始姉姿子屍市師志思指支孜斯施旨枝止\"],[\"8e80\",\"死氏獅祉私糸紙紫肢脂至視詞詩試誌諮資賜雌飼歯事似侍児字寺慈持時次滋治爾璽痔磁示而耳自蒔辞汐鹿式識鴫竺軸宍雫七叱執失嫉室悉湿漆疾質実蔀篠偲柴芝屡蕊縞舎写射捨赦斜煮社紗者謝車遮蛇邪借勺尺杓灼爵酌釈錫若寂弱惹主取守手朱殊狩珠種腫趣酒首儒受呪寿授樹綬需囚収周\"],[\"8f40\",\"宗就州修愁拾洲秀秋終繍習臭舟蒐衆襲讐蹴輯週酋酬集醜什住充十従戎柔汁渋獣縦重銃叔夙宿淑祝縮粛塾熟出術述俊峻春瞬竣舜駿准循旬楯殉淳\"],[\"8f80\",\"準潤盾純巡遵醇順処初所暑曙渚庶緒署書薯藷諸助叙女序徐恕鋤除傷償勝匠升召哨商唱嘗奨妾娼宵将小少尚庄床廠彰承抄招掌捷昇昌昭晶松梢樟樵沼消渉湘焼焦照症省硝礁祥称章笑粧紹肖菖蒋蕉衝裳訟証詔詳象賞醤鉦鍾鐘障鞘上丈丞乗冗剰城場壌嬢常情擾条杖浄状畳穣蒸譲醸錠嘱埴飾\"],[\"9040\",\"拭植殖燭織職色触食蝕辱尻伸信侵唇娠寝審心慎振新晋森榛浸深申疹真神秦紳臣芯薪親診身辛進針震人仁刃塵壬尋甚尽腎訊迅陣靭笥諏須酢図厨\"],[\"9080\",\"逗吹垂帥推水炊睡粋翠衰遂酔錐錘随瑞髄崇嵩数枢趨雛据杉椙菅頗雀裾澄摺寸世瀬畝是凄制勢姓征性成政整星晴棲栖正清牲生盛精聖声製西誠誓請逝醒青静斉税脆隻席惜戚斥昔析石積籍績脊責赤跡蹟碩切拙接摂折設窃節説雪絶舌蝉仙先千占宣専尖川戦扇撰栓栴泉浅洗染潜煎煽旋穿箭線\"],[\"9140\",\"繊羨腺舛船薦詮賎践選遷銭銑閃鮮前善漸然全禅繕膳糎噌塑岨措曾曽楚狙疏疎礎祖租粗素組蘇訴阻遡鼠僧創双叢倉喪壮奏爽宋層匝惣想捜掃挿掻\"],[\"9180\",\"操早曹巣槍槽漕燥争痩相窓糟総綜聡草荘葬蒼藻装走送遭鎗霜騒像増憎臓蔵贈造促側則即息捉束測足速俗属賊族続卒袖其揃存孫尊損村遜他多太汰詑唾堕妥惰打柁舵楕陀駄騨体堆対耐岱帯待怠態戴替泰滞胎腿苔袋貸退逮隊黛鯛代台大第醍題鷹滝瀧卓啄宅托択拓沢濯琢託鐸濁諾茸凧蛸只\"],[\"9240\",\"叩但達辰奪脱巽竪辿棚谷狸鱈樽誰丹単嘆坦担探旦歎淡湛炭短端箪綻耽胆蛋誕鍛団壇弾断暖檀段男談値知地弛恥智池痴稚置致蜘遅馳築畜竹筑蓄\"],[\"9280\",\"逐秩窒茶嫡着中仲宙忠抽昼柱注虫衷註酎鋳駐樗瀦猪苧著貯丁兆凋喋寵帖帳庁弔張彫徴懲挑暢朝潮牒町眺聴脹腸蝶調諜超跳銚長頂鳥勅捗直朕沈珍賃鎮陳津墜椎槌追鎚痛通塚栂掴槻佃漬柘辻蔦綴鍔椿潰坪壷嬬紬爪吊釣鶴亭低停偵剃貞呈堤定帝底庭廷弟悌抵挺提梯汀碇禎程締艇訂諦蹄逓\"],[\"9340\",\"邸鄭釘鼎泥摘擢敵滴的笛適鏑溺哲徹撤轍迭鉄典填天展店添纏甜貼転顛点伝殿澱田電兎吐堵塗妬屠徒斗杜渡登菟賭途都鍍砥砺努度土奴怒倒党冬\"],[\"9380\",\"凍刀唐塔塘套宕島嶋悼投搭東桃梼棟盗淘湯涛灯燈当痘祷等答筒糖統到董蕩藤討謄豆踏逃透鐙陶頭騰闘働動同堂導憧撞洞瞳童胴萄道銅峠鴇匿得徳涜特督禿篤毒独読栃橡凸突椴届鳶苫寅酉瀞噸屯惇敦沌豚遁頓呑曇鈍奈那内乍凪薙謎灘捺鍋楢馴縄畷南楠軟難汝二尼弐迩匂賑肉虹廿日乳入\"],[\"9440\",\"如尿韮任妊忍認濡禰祢寧葱猫熱年念捻撚燃粘乃廼之埜嚢悩濃納能脳膿農覗蚤巴把播覇杷波派琶破婆罵芭馬俳廃拝排敗杯盃牌背肺輩配倍培媒梅\"],[\"9480\",\"楳煤狽買売賠陪這蝿秤矧萩伯剥博拍柏泊白箔粕舶薄迫曝漠爆縛莫駁麦函箱硲箸肇筈櫨幡肌畑畠八鉢溌発醗髪伐罰抜筏閥鳩噺塙蛤隼伴判半反叛帆搬斑板氾汎版犯班畔繁般藩販範釆煩頒飯挽晩番盤磐蕃蛮匪卑否妃庇彼悲扉批披斐比泌疲皮碑秘緋罷肥被誹費避非飛樋簸備尾微枇毘琵眉美\"],[\"9540\",\"鼻柊稗匹疋髭彦膝菱肘弼必畢筆逼桧姫媛紐百謬俵彪標氷漂瓢票表評豹廟描病秒苗錨鋲蒜蛭鰭品彬斌浜瀕貧賓頻敏瓶不付埠夫婦富冨布府怖扶敷\"],[\"9580\",\"斧普浮父符腐膚芙譜負賦赴阜附侮撫武舞葡蕪部封楓風葺蕗伏副復幅服福腹複覆淵弗払沸仏物鮒分吻噴墳憤扮焚奮粉糞紛雰文聞丙併兵塀幣平弊柄並蔽閉陛米頁僻壁癖碧別瞥蔑箆偏変片篇編辺返遍便勉娩弁鞭保舗鋪圃捕歩甫補輔穂募墓慕戊暮母簿菩倣俸包呆報奉宝峰峯崩庖抱捧放方朋\"],[\"9640\",\"法泡烹砲縫胞芳萌蓬蜂褒訪豊邦鋒飽鳳鵬乏亡傍剖坊妨帽忘忙房暴望某棒冒紡肪膨謀貌貿鉾防吠頬北僕卜墨撲朴牧睦穆釦勃没殆堀幌奔本翻凡盆\"],[\"9680\",\"摩磨魔麻埋妹昧枚毎哩槙幕膜枕鮪柾鱒桝亦俣又抹末沫迄侭繭麿万慢満漫蔓味未魅巳箕岬密蜜湊蓑稔脈妙粍民眠務夢無牟矛霧鵡椋婿娘冥名命明盟迷銘鳴姪牝滅免棉綿緬面麺摸模茂妄孟毛猛盲網耗蒙儲木黙目杢勿餅尤戻籾貰問悶紋門匁也冶夜爺耶野弥矢厄役約薬訳躍靖柳薮鑓愉愈油癒\"],[\"9740\",\"諭輸唯佑優勇友宥幽悠憂揖有柚湧涌猶猷由祐裕誘遊邑郵雄融夕予余与誉輿預傭幼妖容庸揚揺擁曜楊様洋溶熔用窯羊耀葉蓉要謡踊遥陽養慾抑欲\"],[\"9780\",\"沃浴翌翼淀羅螺裸来莱頼雷洛絡落酪乱卵嵐欄濫藍蘭覧利吏履李梨理璃痢裏裡里離陸律率立葎掠略劉流溜琉留硫粒隆竜龍侶慮旅虜了亮僚両凌寮料梁涼猟療瞭稜糧良諒遼量陵領力緑倫厘林淋燐琳臨輪隣鱗麟瑠塁涙累類令伶例冷励嶺怜玲礼苓鈴隷零霊麗齢暦歴列劣烈裂廉恋憐漣煉簾練聯\"],[\"9840\",\"蓮連錬呂魯櫓炉賂路露労婁廊弄朗楼榔浪漏牢狼篭老聾蝋郎六麓禄肋録論倭和話歪賄脇惑枠鷲亙亘鰐詫藁蕨椀湾碗腕\"],[\"989f\",\"弌丐丕个丱丶丼丿乂乖乘亂亅豫亊舒弍于亞亟亠亢亰亳亶从仍仄仆仂仗仞仭仟价伉佚估佛佝佗佇佶侈侏侘佻佩佰侑佯來侖儘俔俟俎俘俛俑俚俐俤俥倚倨倔倪倥倅伜俶倡倩倬俾俯們倆偃假會偕偐偈做偖偬偸傀傚傅傴傲\"],[\"9940\",\"僉僊傳僂僖僞僥僭僣僮價僵儉儁儂儖儕儔儚儡儺儷儼儻儿兀兒兌兔兢竸兩兪兮冀冂囘册冉冏冑冓冕冖冤冦冢冩冪冫决冱冲冰况冽凅凉凛几處凩凭\"],[\"9980\",\"凰凵凾刄刋刔刎刧刪刮刳刹剏剄剋剌剞剔剪剴剩剳剿剽劍劔劒剱劈劑辨辧劬劭劼劵勁勍勗勞勣勦飭勠勳勵勸勹匆匈甸匍匐匏匕匚匣匯匱匳匸區卆卅丗卉卍凖卞卩卮夘卻卷厂厖厠厦厥厮厰厶參簒雙叟曼燮叮叨叭叺吁吽呀听吭吼吮吶吩吝呎咏呵咎呟呱呷呰咒呻咀呶咄咐咆哇咢咸咥咬哄哈咨\"],[\"9a40\",\"咫哂咤咾咼哘哥哦唏唔哽哮哭哺哢唹啀啣啌售啜啅啖啗唸唳啝喙喀咯喊喟啻啾喘喞單啼喃喩喇喨嗚嗅嗟嗄嗜嗤嗔嘔嗷嘖嗾嗽嘛嗹噎噐營嘴嘶嘲嘸\"],[\"9a80\",\"噫噤嘯噬噪嚆嚀嚊嚠嚔嚏嚥嚮嚶嚴囂嚼囁囃囀囈囎囑囓囗囮囹圀囿圄圉圈國圍圓團圖嗇圜圦圷圸坎圻址坏坩埀垈坡坿垉垓垠垳垤垪垰埃埆埔埒埓堊埖埣堋堙堝塲堡塢塋塰毀塒堽塹墅墹墟墫墺壞墻墸墮壅壓壑壗壙壘壥壜壤壟壯壺壹壻壼壽夂夊夐夛梦夥夬夭夲夸夾竒奕奐奎奚奘奢奠奧奬奩\"],[\"9b40\",\"奸妁妝佞侫妣妲姆姨姜妍姙姚娥娟娑娜娉娚婀婬婉娵娶婢婪媚媼媾嫋嫂媽嫣嫗嫦嫩嫖嫺嫻嬌嬋嬖嬲嫐嬪嬶嬾孃孅孀孑孕孚孛孥孩孰孳孵學斈孺宀\"],[\"9b80\",\"它宦宸寃寇寉寔寐寤實寢寞寥寫寰寶寳尅將專對尓尠尢尨尸尹屁屆屎屓屐屏孱屬屮乢屶屹岌岑岔妛岫岻岶岼岷峅岾峇峙峩峽峺峭嶌峪崋崕崗嵜崟崛崑崔崢崚崙崘嵌嵒嵎嵋嵬嵳嵶嶇嶄嶂嶢嶝嶬嶮嶽嶐嶷嶼巉巍巓巒巖巛巫已巵帋帚帙帑帛帶帷幄幃幀幎幗幔幟幢幤幇幵并幺麼广庠廁廂廈廐廏\"],[\"9c40\",\"廖廣廝廚廛廢廡廨廩廬廱廳廰廴廸廾弃弉彝彜弋弑弖弩弭弸彁彈彌彎弯彑彖彗彙彡彭彳彷徃徂彿徊很徑徇從徙徘徠徨徭徼忖忻忤忸忱忝悳忿怡恠\"],[\"9c80\",\"怙怐怩怎怱怛怕怫怦怏怺恚恁恪恷恟恊恆恍恣恃恤恂恬恫恙悁悍惧悃悚悄悛悖悗悒悧悋惡悸惠惓悴忰悽惆悵惘慍愕愆惶惷愀惴惺愃愡惻惱愍愎慇愾愨愧慊愿愼愬愴愽慂慄慳慷慘慙慚慫慴慯慥慱慟慝慓慵憙憖憇憬憔憚憊憑憫憮懌懊應懷懈懃懆憺懋罹懍懦懣懶懺懴懿懽懼懾戀戈戉戍戌戔戛\"],[\"9d40\",\"戞戡截戮戰戲戳扁扎扞扣扛扠扨扼抂抉找抒抓抖拔抃抔拗拑抻拏拿拆擔拈拜拌拊拂拇抛拉挌拮拱挧挂挈拯拵捐挾捍搜捏掖掎掀掫捶掣掏掉掟掵捫\"],[\"9d80\",\"捩掾揩揀揆揣揉插揶揄搖搴搆搓搦搶攝搗搨搏摧摯摶摎攪撕撓撥撩撈撼據擒擅擇撻擘擂擱擧舉擠擡抬擣擯攬擶擴擲擺攀擽攘攜攅攤攣攫攴攵攷收攸畋效敖敕敍敘敞敝敲數斂斃變斛斟斫斷旃旆旁旄旌旒旛旙无旡旱杲昊昃旻杳昵昶昴昜晏晄晉晁晞晝晤晧晨晟晢晰暃暈暎暉暄暘暝曁暹曉暾暼\"],[\"9e40\",\"曄暸曖曚曠昿曦曩曰曵曷朏朖朞朦朧霸朮朿朶杁朸朷杆杞杠杙杣杤枉杰枩杼杪枌枋枦枡枅枷柯枴柬枳柩枸柤柞柝柢柮枹柎柆柧檜栞框栩桀桍栲桎\"],[\"9e80\",\"梳栫桙档桷桿梟梏梭梔條梛梃檮梹桴梵梠梺椏梍桾椁棊椈棘椢椦棡椌棍棔棧棕椶椒椄棗棣椥棹棠棯椨椪椚椣椡棆楹楷楜楸楫楔楾楮椹楴椽楙椰楡楞楝榁楪榲榮槐榿槁槓榾槎寨槊槝榻槃榧樮榑榠榜榕榴槞槨樂樛槿權槹槲槧樅榱樞槭樔槫樊樒櫁樣樓橄樌橲樶橸橇橢橙橦橈樸樢檐檍檠檄檢檣\"],[\"9f40\",\"檗蘗檻櫃櫂檸檳檬櫞櫑櫟檪櫚櫪櫻欅蘖櫺欒欖鬱欟欸欷盜欹飮歇歃歉歐歙歔歛歟歡歸歹歿殀殄殃殍殘殕殞殤殪殫殯殲殱殳殷殼毆毋毓毟毬毫毳毯\"],[\"9f80\",\"麾氈氓气氛氤氣汞汕汢汪沂沍沚沁沛汾汨汳沒沐泄泱泓沽泗泅泝沮沱沾沺泛泯泙泪洟衍洶洫洽洸洙洵洳洒洌浣涓浤浚浹浙涎涕濤涅淹渕渊涵淇淦涸淆淬淞淌淨淒淅淺淙淤淕淪淮渭湮渮渙湲湟渾渣湫渫湶湍渟湃渺湎渤滿渝游溂溪溘滉溷滓溽溯滄溲滔滕溏溥滂溟潁漑灌滬滸滾漿滲漱滯漲滌\"],[\"e040\",\"漾漓滷澆潺潸澁澀潯潛濳潭澂潼潘澎澑濂潦澳澣澡澤澹濆澪濟濕濬濔濘濱濮濛瀉瀋濺瀑瀁瀏濾瀛瀚潴瀝瀘瀟瀰瀾瀲灑灣炙炒炯烱炬炸炳炮烟烋烝\"],[\"e080\",\"烙焉烽焜焙煥煕熈煦煢煌煖煬熏燻熄熕熨熬燗熹熾燒燉燔燎燠燬燧燵燼燹燿爍爐爛爨爭爬爰爲爻爼爿牀牆牋牘牴牾犂犁犇犒犖犢犧犹犲狃狆狄狎狒狢狠狡狹狷倏猗猊猜猖猝猴猯猩猥猾獎獏默獗獪獨獰獸獵獻獺珈玳珎玻珀珥珮珞璢琅瑯琥珸琲琺瑕琿瑟瑙瑁瑜瑩瑰瑣瑪瑶瑾璋璞璧瓊瓏瓔珱\"],[\"e140\",\"瓠瓣瓧瓩瓮瓲瓰瓱瓸瓷甄甃甅甌甎甍甕甓甞甦甬甼畄畍畊畉畛畆畚畩畤畧畫畭畸當疆疇畴疊疉疂疔疚疝疥疣痂疳痃疵疽疸疼疱痍痊痒痙痣痞痾痿\"],[\"e180\",\"痼瘁痰痺痲痳瘋瘍瘉瘟瘧瘠瘡瘢瘤瘴瘰瘻癇癈癆癜癘癡癢癨癩癪癧癬癰癲癶癸發皀皃皈皋皎皖皓皙皚皰皴皸皹皺盂盍盖盒盞盡盥盧盪蘯盻眈眇眄眩眤眞眥眦眛眷眸睇睚睨睫睛睥睿睾睹瞎瞋瞑瞠瞞瞰瞶瞹瞿瞼瞽瞻矇矍矗矚矜矣矮矼砌砒礦砠礪硅碎硴碆硼碚碌碣碵碪碯磑磆磋磔碾碼磅磊磬\"],[\"e240\",\"磧磚磽磴礇礒礑礙礬礫祀祠祗祟祚祕祓祺祿禊禝禧齋禪禮禳禹禺秉秕秧秬秡秣稈稍稘稙稠稟禀稱稻稾稷穃穗穉穡穢穩龝穰穹穽窈窗窕窘窖窩竈窰\"],[\"e280\",\"窶竅竄窿邃竇竊竍竏竕竓站竚竝竡竢竦竭竰笂笏笊笆笳笘笙笞笵笨笶筐筺笄筍笋筌筅筵筥筴筧筰筱筬筮箝箘箟箍箜箚箋箒箏筝箙篋篁篌篏箴篆篝篩簑簔篦篥籠簀簇簓篳篷簗簍篶簣簧簪簟簷簫簽籌籃籔籏籀籐籘籟籤籖籥籬籵粃粐粤粭粢粫粡粨粳粲粱粮粹粽糀糅糂糘糒糜糢鬻糯糲糴糶糺紆\"],[\"e340\",\"紂紜紕紊絅絋紮紲紿紵絆絳絖絎絲絨絮絏絣經綉絛綏絽綛綺綮綣綵緇綽綫總綢綯緜綸綟綰緘緝緤緞緻緲緡縅縊縣縡縒縱縟縉縋縢繆繦縻縵縹繃縷\"],[\"e380\",\"縲縺繧繝繖繞繙繚繹繪繩繼繻纃緕繽辮繿纈纉續纒纐纓纔纖纎纛纜缸缺罅罌罍罎罐网罕罔罘罟罠罨罩罧罸羂羆羃羈羇羌羔羞羝羚羣羯羲羹羮羶羸譱翅翆翊翕翔翡翦翩翳翹飜耆耄耋耒耘耙耜耡耨耿耻聊聆聒聘聚聟聢聨聳聲聰聶聹聽聿肄肆肅肛肓肚肭冐肬胛胥胙胝胄胚胖脉胯胱脛脩脣脯腋\"],[\"e440\",\"隋腆脾腓腑胼腱腮腥腦腴膃膈膊膀膂膠膕膤膣腟膓膩膰膵膾膸膽臀臂膺臉臍臑臙臘臈臚臟臠臧臺臻臾舁舂舅與舊舍舐舖舩舫舸舳艀艙艘艝艚艟艤\"],[\"e480\",\"艢艨艪艫舮艱艷艸艾芍芒芫芟芻芬苡苣苟苒苴苳苺莓范苻苹苞茆苜茉苙茵茴茖茲茱荀茹荐荅茯茫茗茘莅莚莪莟莢莖茣莎莇莊荼莵荳荵莠莉莨菴萓菫菎菽萃菘萋菁菷萇菠菲萍萢萠莽萸蔆菻葭萪萼蕚蒄葷葫蒭葮蒂葩葆萬葯葹萵蓊葢蒹蒿蒟蓙蓍蒻蓚蓐蓁蓆蓖蒡蔡蓿蓴蔗蔘蔬蔟蔕蔔蓼蕀蕣蕘蕈\"],[\"e540\",\"蕁蘂蕋蕕薀薤薈薑薊薨蕭薔薛藪薇薜蕷蕾薐藉薺藏薹藐藕藝藥藜藹蘊蘓蘋藾藺蘆蘢蘚蘰蘿虍乕虔號虧虱蚓蚣蚩蚪蚋蚌蚶蚯蛄蛆蚰蛉蠣蚫蛔蛞蛩蛬\"],[\"e580\",\"蛟蛛蛯蜒蜆蜈蜀蜃蛻蜑蜉蜍蛹蜊蜴蜿蜷蜻蜥蜩蜚蝠蝟蝸蝌蝎蝴蝗蝨蝮蝙蝓蝣蝪蠅螢螟螂螯蟋螽蟀蟐雖螫蟄螳蟇蟆螻蟯蟲蟠蠏蠍蟾蟶蟷蠎蟒蠑蠖蠕蠢蠡蠱蠶蠹蠧蠻衄衂衒衙衞衢衫袁衾袞衵衽袵衲袂袗袒袮袙袢袍袤袰袿袱裃裄裔裘裙裝裹褂裼裴裨裲褄褌褊褓襃褞褥褪褫襁襄褻褶褸襌褝襠襞\"],[\"e640\",\"襦襤襭襪襯襴襷襾覃覈覊覓覘覡覩覦覬覯覲覺覽覿觀觚觜觝觧觴觸訃訖訐訌訛訝訥訶詁詛詒詆詈詼詭詬詢誅誂誄誨誡誑誥誦誚誣諄諍諂諚諫諳諧\"],[\"e680\",\"諤諱謔諠諢諷諞諛謌謇謚諡謖謐謗謠謳鞫謦謫謾謨譁譌譏譎證譖譛譚譫譟譬譯譴譽讀讌讎讒讓讖讙讚谺豁谿豈豌豎豐豕豢豬豸豺貂貉貅貊貍貎貔豼貘戝貭貪貽貲貳貮貶賈賁賤賣賚賽賺賻贄贅贊贇贏贍贐齎贓賍贔贖赧赭赱赳趁趙跂趾趺跏跚跖跌跛跋跪跫跟跣跼踈踉跿踝踞踐踟蹂踵踰踴蹊\"],[\"e740\",\"蹇蹉蹌蹐蹈蹙蹤蹠踪蹣蹕蹶蹲蹼躁躇躅躄躋躊躓躑躔躙躪躡躬躰軆躱躾軅軈軋軛軣軼軻軫軾輊輅輕輒輙輓輜輟輛輌輦輳輻輹轅轂輾轌轉轆轎轗轜\"],[\"e780\",\"轢轣轤辜辟辣辭辯辷迚迥迢迪迯邇迴逅迹迺逑逕逡逍逞逖逋逧逶逵逹迸遏遐遑遒逎遉逾遖遘遞遨遯遶隨遲邂遽邁邀邊邉邏邨邯邱邵郢郤扈郛鄂鄒鄙鄲鄰酊酖酘酣酥酩酳酲醋醉醂醢醫醯醪醵醴醺釀釁釉釋釐釖釟釡釛釼釵釶鈞釿鈔鈬鈕鈑鉞鉗鉅鉉鉤鉈銕鈿鉋鉐銜銖銓銛鉚鋏銹銷鋩錏鋺鍄錮\"],[\"e840\",\"錙錢錚錣錺錵錻鍜鍠鍼鍮鍖鎰鎬鎭鎔鎹鏖鏗鏨鏥鏘鏃鏝鏐鏈鏤鐚鐔鐓鐃鐇鐐鐶鐫鐵鐡鐺鑁鑒鑄鑛鑠鑢鑞鑪鈩鑰鑵鑷鑽鑚鑼鑾钁鑿閂閇閊閔閖閘閙\"],[\"e880\",\"閠閨閧閭閼閻閹閾闊濶闃闍闌闕闔闖關闡闥闢阡阨阮阯陂陌陏陋陷陜陞陝陟陦陲陬隍隘隕隗險隧隱隲隰隴隶隸隹雎雋雉雍襍雜霍雕雹霄霆霈霓霎霑霏霖霙霤霪霰霹霽霾靄靆靈靂靉靜靠靤靦靨勒靫靱靹鞅靼鞁靺鞆鞋鞏鞐鞜鞨鞦鞣鞳鞴韃韆韈韋韜韭齏韲竟韶韵頏頌頸頤頡頷頽顆顏顋顫顯顰\"],[\"e940\",\"顱顴顳颪颯颱颶飄飃飆飩飫餃餉餒餔餘餡餝餞餤餠餬餮餽餾饂饉饅饐饋饑饒饌饕馗馘馥馭馮馼駟駛駝駘駑駭駮駱駲駻駸騁騏騅駢騙騫騷驅驂驀驃\"],[\"e980\",\"騾驕驍驛驗驟驢驥驤驩驫驪骭骰骼髀髏髑髓體髞髟髢髣髦髯髫髮髴髱髷髻鬆鬘鬚鬟鬢鬣鬥鬧鬨鬩鬪鬮鬯鬲魄魃魏魍魎魑魘魴鮓鮃鮑鮖鮗鮟鮠鮨鮴鯀鯊鮹鯆鯏鯑鯒鯣鯢鯤鯔鯡鰺鯲鯱鯰鰕鰔鰉鰓鰌鰆鰈鰒鰊鰄鰮鰛鰥鰤鰡鰰鱇鰲鱆鰾鱚鱠鱧鱶鱸鳧鳬鳰鴉鴈鳫鴃鴆鴪鴦鶯鴣鴟鵄鴕鴒鵁鴿鴾鵆鵈\"],[\"ea40\",\"鵝鵞鵤鵑鵐鵙鵲鶉鶇鶫鵯鵺鶚鶤鶩鶲鷄鷁鶻鶸鶺鷆鷏鷂鷙鷓鷸鷦鷭鷯鷽鸚鸛鸞鹵鹹鹽麁麈麋麌麒麕麑麝麥麩麸麪麭靡黌黎黏黐黔黜點黝黠黥黨黯\"],[\"ea80\",\"黴黶黷黹黻黼黽鼇鼈皷鼕鼡鼬鼾齊齒齔齣齟齠齡齦齧齬齪齷齲齶龕龜龠堯槇遙瑤凜熙\"],[\"ed40\",\"纊褜鍈銈蓜俉炻昱棈鋹曻彅丨仡仼伀伃伹佖侒侊侚侔俍偀倢俿倞偆偰偂傔僴僘兊兤冝冾凬刕劜劦勀勛匀匇匤卲厓厲叝﨎咜咊咩哿喆坙坥垬埈埇﨏\"],[\"ed80\",\"塚增墲夋奓奛奝奣妤妺孖寀甯寘寬尞岦岺峵崧嵓﨑嵂嵭嶸嶹巐弡弴彧德忞恝悅悊惞惕愠惲愑愷愰憘戓抦揵摠撝擎敎昀昕昻昉昮昞昤晥晗晙晴晳暙暠暲暿曺朎朗杦枻桒柀栁桄棏﨓楨﨔榘槢樰橫橆橳橾櫢櫤毖氿汜沆汯泚洄涇浯涖涬淏淸淲淼渹湜渧渼溿澈澵濵瀅瀇瀨炅炫焏焄煜煆煇凞燁燾犱\"],[\"ee40\",\"犾猤猪獷玽珉珖珣珒琇珵琦琪琩琮瑢璉璟甁畯皂皜皞皛皦益睆劯砡硎硤硺礰礼神祥禔福禛竑竧靖竫箞精絈絜綷綠緖繒罇羡羽茁荢荿菇菶葈蒴蕓蕙\"],[\"ee80\",\"蕫﨟薰蘒﨡蠇裵訒訷詹誧誾諟諸諶譓譿賰賴贒赶﨣軏﨤逸遧郞都鄕鄧釚釗釞釭釮釤釥鈆鈐鈊鈺鉀鈼鉎鉙鉑鈹鉧銧鉷鉸鋧鋗鋙鋐﨧鋕鋠鋓錥錡鋻﨨錞鋿錝錂鍰鍗鎤鏆鏞鏸鐱鑅鑈閒隆﨩隝隯霳霻靃靍靏靑靕顗顥飯飼餧館馞驎髙髜魵魲鮏鮱鮻鰀鵰鵫鶴鸙黑\"],[\"eeef\",\"ⅰ\",9,\"￢￤＇＂\"],[\"f040\",\"\",62],[\"f080\",\"\",124],[\"f140\",\"\",62],[\"f180\",\"\",124],[\"f240\",\"\",62],[\"f280\",\"\",124],[\"f340\",\"\",62],[\"f380\",\"\",124],[\"f440\",\"\",62],[\"f480\",\"\",124],[\"f540\",\"\",62],[\"f580\",\"\",124],[\"f640\",\"\",62],[\"f680\",\"\",124],[\"f740\",\"\",62],[\"f780\",\"\",124],[\"f840\",\"\",62],[\"f880\",\"\",124],[\"f940\",\"\"],[\"fa40\",\"ⅰ\",9,\"Ⅰ\",9,\"￢￤＇＂㈱№℡∵纊褜鍈銈蓜俉炻昱棈鋹曻彅丨仡仼伀伃伹佖侒侊侚侔俍偀倢俿倞偆偰偂傔僴僘兊\"],[\"fa80\",\"兤冝冾凬刕劜劦勀勛匀匇匤卲厓厲叝﨎咜咊咩哿喆坙坥垬埈埇﨏塚增墲夋奓奛奝奣妤妺孖寀甯寘寬尞岦岺峵崧嵓﨑嵂嵭嶸嶹巐弡弴彧德忞恝悅悊惞惕愠惲愑愷愰憘戓抦揵摠撝擎敎昀昕昻昉昮昞昤晥晗晙晴晳暙暠暲暿曺朎朗杦枻桒柀栁桄棏﨓楨﨔榘槢樰橫橆橳橾櫢櫤毖氿汜沆汯泚洄涇浯\"],[\"fb40\",\"涖涬淏淸淲淼渹湜渧渼溿澈澵濵瀅瀇瀨炅炫焏焄煜煆煇凞燁燾犱犾猤猪獷玽珉珖珣珒琇珵琦琪琩琮瑢璉璟甁畯皂皜皞皛皦益睆劯砡硎硤硺礰礼神\"],[\"fb80\",\"祥禔福禛竑竧靖竫箞精絈絜綷綠緖繒罇羡羽茁荢荿菇菶葈蒴蕓蕙蕫﨟薰蘒﨡蠇裵訒訷詹誧誾諟諸諶譓譿賰賴贒赶﨣軏﨤逸遧郞都鄕鄧釚釗釞釭釮釤釥鈆鈐鈊鈺鉀鈼鉎鉙鉑鈹鉧銧鉷鉸鋧鋗鋙鋐﨧鋕鋠鋓錥錡鋻﨨錞鋿錝錂鍰鍗鎤鏆鏞鏸鐱鑅鑈閒隆﨩隝隯霳霻靃靍靏靑靕顗顥飯飼餧館馞驎髙\"],[\"fc40\",\"髜魵魲鮏鮱鮻鰀鵰鵫鶴鸙黑\"]]");
})), hm = /* @__PURE__ */ i({ default: () => gm }), gm, _m = n((() => {
	gm = /*#__PURE__*/ JSON.parse("[[\"0\",\"\\u0000\",127],[\"8ea1\",\"｡\",62],[\"a1a1\",\"　、。，．・：；？！゛゜´｀¨＾￣＿ヽヾゝゞ〃仝々〆〇ー―‐／＼～∥｜…‥‘’“”（）〔〕［］｛｝〈\",9,\"＋－±×÷＝≠＜＞≦≧∞∴♂♀°′″℃￥＄￠￡％＃＆＊＠§☆★○●◎◇\"],[\"a2a1\",\"◆□■△▲▽▼※〒→←↑↓〓\"],[\"a2ba\",\"∈∋⊆⊇⊂⊃∪∩\"],[\"a2ca\",\"∧∨￢⇒⇔∀∃\"],[\"a2dc\",\"∠⊥⌒∂∇≡≒≪≫√∽∝∵∫∬\"],[\"a2f2\",\"Å‰♯♭♪†‡¶\"],[\"a2fe\",\"◯\"],[\"a3b0\",\"０\",9],[\"a3c1\",\"Ａ\",25],[\"a3e1\",\"ａ\",25],[\"a4a1\",\"ぁ\",82],[\"a5a1\",\"ァ\",85],[\"a6a1\",\"Α\",16,\"Σ\",6],[\"a6c1\",\"α\",16,\"σ\",6],[\"a7a1\",\"А\",5,\"ЁЖ\",25],[\"a7d1\",\"а\",5,\"ёж\",25],[\"a8a1\",\"─│┌┐┘└├┬┤┴┼━┃┏┓┛┗┣┳┫┻╋┠┯┨┷┿┝┰┥┸╂\"],[\"ada1\",\"①\",19,\"Ⅰ\",9],[\"adc0\",\"㍉㌔㌢㍍㌘㌧㌃㌶㍑㍗㌍㌦㌣㌫㍊㌻㎜㎝㎞㎎㎏㏄㎡\"],[\"addf\",\"㍻〝〟№㏍℡㊤\",4,\"㈱㈲㈹㍾㍽㍼≒≡∫∮∑√⊥∠∟⊿∵∩∪\"],[\"b0a1\",\"亜唖娃阿哀愛挨姶逢葵茜穐悪握渥旭葦芦鯵梓圧斡扱宛姐虻飴絢綾鮎或粟袷安庵按暗案闇鞍杏以伊位依偉囲夷委威尉惟意慰易椅為畏異移維緯胃萎衣謂違遺医井亥域育郁磯一壱溢逸稲茨芋鰯允印咽員因姻引飲淫胤蔭\"],[\"b1a1\",\"院陰隠韻吋右宇烏羽迂雨卯鵜窺丑碓臼渦嘘唄欝蔚鰻姥厩浦瓜閏噂云運雲荏餌叡営嬰影映曳栄永泳洩瑛盈穎頴英衛詠鋭液疫益駅悦謁越閲榎厭円園堰奄宴延怨掩援沿演炎焔煙燕猿縁艶苑薗遠鉛鴛塩於汚甥凹央奥往応\"],[\"b2a1\",\"押旺横欧殴王翁襖鴬鴎黄岡沖荻億屋憶臆桶牡乙俺卸恩温穏音下化仮何伽価佳加可嘉夏嫁家寡科暇果架歌河火珂禍禾稼箇花苛茄荷華菓蝦課嘩貨迦過霞蚊俄峨我牙画臥芽蛾賀雅餓駕介会解回塊壊廻快怪悔恢懐戒拐改\"],[\"b3a1\",\"魁晦械海灰界皆絵芥蟹開階貝凱劾外咳害崖慨概涯碍蓋街該鎧骸浬馨蛙垣柿蛎鈎劃嚇各廓拡撹格核殻獲確穫覚角赫較郭閣隔革学岳楽額顎掛笠樫橿梶鰍潟割喝恰括活渇滑葛褐轄且鰹叶椛樺鞄株兜竃蒲釜鎌噛鴨栢茅萱\"],[\"b4a1\",\"粥刈苅瓦乾侃冠寒刊勘勧巻喚堪姦完官寛干幹患感慣憾換敢柑桓棺款歓汗漢澗潅環甘監看竿管簡緩缶翰肝艦莞観諌貫還鑑間閑関陥韓館舘丸含岸巌玩癌眼岩翫贋雁頑顔願企伎危喜器基奇嬉寄岐希幾忌揮机旗既期棋棄\"],[\"b5a1\",\"機帰毅気汽畿祈季稀紀徽規記貴起軌輝飢騎鬼亀偽儀妓宜戯技擬欺犠疑祇義蟻誼議掬菊鞠吉吃喫桔橘詰砧杵黍却客脚虐逆丘久仇休及吸宮弓急救朽求汲泣灸球究窮笈級糾給旧牛去居巨拒拠挙渠虚許距鋸漁禦魚亨享京\"],[\"b6a1\",\"供侠僑兇競共凶協匡卿叫喬境峡強彊怯恐恭挟教橋況狂狭矯胸脅興蕎郷鏡響饗驚仰凝尭暁業局曲極玉桐粁僅勤均巾錦斤欣欽琴禁禽筋緊芹菌衿襟謹近金吟銀九倶句区狗玖矩苦躯駆駈駒具愚虞喰空偶寓遇隅串櫛釧屑屈\"],[\"b7a1\",\"掘窟沓靴轡窪熊隈粂栗繰桑鍬勲君薫訓群軍郡卦袈祁係傾刑兄啓圭珪型契形径恵慶慧憩掲携敬景桂渓畦稽系経継繋罫茎荊蛍計詣警軽頚鶏芸迎鯨劇戟撃激隙桁傑欠決潔穴結血訣月件倹倦健兼券剣喧圏堅嫌建憲懸拳捲\"],[\"b8a1\",\"検権牽犬献研硯絹県肩見謙賢軒遣鍵険顕験鹸元原厳幻弦減源玄現絃舷言諺限乎個古呼固姑孤己庫弧戸故枯湖狐糊袴股胡菰虎誇跨鈷雇顧鼓五互伍午呉吾娯後御悟梧檎瑚碁語誤護醐乞鯉交佼侯候倖光公功効勾厚口向\"],[\"b9a1\",\"后喉坑垢好孔孝宏工巧巷幸広庚康弘恒慌抗拘控攻昂晃更杭校梗構江洪浩港溝甲皇硬稿糠紅紘絞綱耕考肯肱腔膏航荒行衡講貢購郊酵鉱砿鋼閤降項香高鴻剛劫号合壕拷濠豪轟麹克刻告国穀酷鵠黒獄漉腰甑忽惚骨狛込\"],[\"baa1\",\"此頃今困坤墾婚恨懇昏昆根梱混痕紺艮魂些佐叉唆嵯左差査沙瑳砂詐鎖裟坐座挫債催再最哉塞妻宰彩才採栽歳済災采犀砕砦祭斎細菜裁載際剤在材罪財冴坂阪堺榊肴咲崎埼碕鷺作削咋搾昨朔柵窄策索錯桜鮭笹匙冊刷\"],[\"bba1\",\"察拶撮擦札殺薩雑皐鯖捌錆鮫皿晒三傘参山惨撒散桟燦珊産算纂蚕讃賛酸餐斬暫残仕仔伺使刺司史嗣四士始姉姿子屍市師志思指支孜斯施旨枝止死氏獅祉私糸紙紫肢脂至視詞詩試誌諮資賜雌飼歯事似侍児字寺慈持時\"],[\"bca1\",\"次滋治爾璽痔磁示而耳自蒔辞汐鹿式識鴫竺軸宍雫七叱執失嫉室悉湿漆疾質実蔀篠偲柴芝屡蕊縞舎写射捨赦斜煮社紗者謝車遮蛇邪借勺尺杓灼爵酌釈錫若寂弱惹主取守手朱殊狩珠種腫趣酒首儒受呪寿授樹綬需囚収周\"],[\"bda1\",\"宗就州修愁拾洲秀秋終繍習臭舟蒐衆襲讐蹴輯週酋酬集醜什住充十従戎柔汁渋獣縦重銃叔夙宿淑祝縮粛塾熟出術述俊峻春瞬竣舜駿准循旬楯殉淳準潤盾純巡遵醇順処初所暑曙渚庶緒署書薯藷諸助叙女序徐恕鋤除傷償\"],[\"bea1\",\"勝匠升召哨商唱嘗奨妾娼宵将小少尚庄床廠彰承抄招掌捷昇昌昭晶松梢樟樵沼消渉湘焼焦照症省硝礁祥称章笑粧紹肖菖蒋蕉衝裳訟証詔詳象賞醤鉦鍾鐘障鞘上丈丞乗冗剰城場壌嬢常情擾条杖浄状畳穣蒸譲醸錠嘱埴飾\"],[\"bfa1\",\"拭植殖燭織職色触食蝕辱尻伸信侵唇娠寝審心慎振新晋森榛浸深申疹真神秦紳臣芯薪親診身辛進針震人仁刃塵壬尋甚尽腎訊迅陣靭笥諏須酢図厨逗吹垂帥推水炊睡粋翠衰遂酔錐錘随瑞髄崇嵩数枢趨雛据杉椙菅頗雀裾\"],[\"c0a1\",\"澄摺寸世瀬畝是凄制勢姓征性成政整星晴棲栖正清牲生盛精聖声製西誠誓請逝醒青静斉税脆隻席惜戚斥昔析石積籍績脊責赤跡蹟碩切拙接摂折設窃節説雪絶舌蝉仙先千占宣専尖川戦扇撰栓栴泉浅洗染潜煎煽旋穿箭線\"],[\"c1a1\",\"繊羨腺舛船薦詮賎践選遷銭銑閃鮮前善漸然全禅繕膳糎噌塑岨措曾曽楚狙疏疎礎祖租粗素組蘇訴阻遡鼠僧創双叢倉喪壮奏爽宋層匝惣想捜掃挿掻操早曹巣槍槽漕燥争痩相窓糟総綜聡草荘葬蒼藻装走送遭鎗霜騒像増憎\"],[\"c2a1\",\"臓蔵贈造促側則即息捉束測足速俗属賊族続卒袖其揃存孫尊損村遜他多太汰詑唾堕妥惰打柁舵楕陀駄騨体堆対耐岱帯待怠態戴替泰滞胎腿苔袋貸退逮隊黛鯛代台大第醍題鷹滝瀧卓啄宅托択拓沢濯琢託鐸濁諾茸凧蛸只\"],[\"c3a1\",\"叩但達辰奪脱巽竪辿棚谷狸鱈樽誰丹単嘆坦担探旦歎淡湛炭短端箪綻耽胆蛋誕鍛団壇弾断暖檀段男談値知地弛恥智池痴稚置致蜘遅馳築畜竹筑蓄逐秩窒茶嫡着中仲宙忠抽昼柱注虫衷註酎鋳駐樗瀦猪苧著貯丁兆凋喋寵\"],[\"c4a1\",\"帖帳庁弔張彫徴懲挑暢朝潮牒町眺聴脹腸蝶調諜超跳銚長頂鳥勅捗直朕沈珍賃鎮陳津墜椎槌追鎚痛通塚栂掴槻佃漬柘辻蔦綴鍔椿潰坪壷嬬紬爪吊釣鶴亭低停偵剃貞呈堤定帝底庭廷弟悌抵挺提梯汀碇禎程締艇訂諦蹄逓\"],[\"c5a1\",\"邸鄭釘鼎泥摘擢敵滴的笛適鏑溺哲徹撤轍迭鉄典填天展店添纏甜貼転顛点伝殿澱田電兎吐堵塗妬屠徒斗杜渡登菟賭途都鍍砥砺努度土奴怒倒党冬凍刀唐塔塘套宕島嶋悼投搭東桃梼棟盗淘湯涛灯燈当痘祷等答筒糖統到\"],[\"c6a1\",\"董蕩藤討謄豆踏逃透鐙陶頭騰闘働動同堂導憧撞洞瞳童胴萄道銅峠鴇匿得徳涜特督禿篤毒独読栃橡凸突椴届鳶苫寅酉瀞噸屯惇敦沌豚遁頓呑曇鈍奈那内乍凪薙謎灘捺鍋楢馴縄畷南楠軟難汝二尼弐迩匂賑肉虹廿日乳入\"],[\"c7a1\",\"如尿韮任妊忍認濡禰祢寧葱猫熱年念捻撚燃粘乃廼之埜嚢悩濃納能脳膿農覗蚤巴把播覇杷波派琶破婆罵芭馬俳廃拝排敗杯盃牌背肺輩配倍培媒梅楳煤狽買売賠陪這蝿秤矧萩伯剥博拍柏泊白箔粕舶薄迫曝漠爆縛莫駁麦\"],[\"c8a1\",\"函箱硲箸肇筈櫨幡肌畑畠八鉢溌発醗髪伐罰抜筏閥鳩噺塙蛤隼伴判半反叛帆搬斑板氾汎版犯班畔繁般藩販範釆煩頒飯挽晩番盤磐蕃蛮匪卑否妃庇彼悲扉批披斐比泌疲皮碑秘緋罷肥被誹費避非飛樋簸備尾微枇毘琵眉美\"],[\"c9a1\",\"鼻柊稗匹疋髭彦膝菱肘弼必畢筆逼桧姫媛紐百謬俵彪標氷漂瓢票表評豹廟描病秒苗錨鋲蒜蛭鰭品彬斌浜瀕貧賓頻敏瓶不付埠夫婦富冨布府怖扶敷斧普浮父符腐膚芙譜負賦赴阜附侮撫武舞葡蕪部封楓風葺蕗伏副復幅服\"],[\"caa1\",\"福腹複覆淵弗払沸仏物鮒分吻噴墳憤扮焚奮粉糞紛雰文聞丙併兵塀幣平弊柄並蔽閉陛米頁僻壁癖碧別瞥蔑箆偏変片篇編辺返遍便勉娩弁鞭保舗鋪圃捕歩甫補輔穂募墓慕戊暮母簿菩倣俸包呆報奉宝峰峯崩庖抱捧放方朋\"],[\"cba1\",\"法泡烹砲縫胞芳萌蓬蜂褒訪豊邦鋒飽鳳鵬乏亡傍剖坊妨帽忘忙房暴望某棒冒紡肪膨謀貌貿鉾防吠頬北僕卜墨撲朴牧睦穆釦勃没殆堀幌奔本翻凡盆摩磨魔麻埋妹昧枚毎哩槙幕膜枕鮪柾鱒桝亦俣又抹末沫迄侭繭麿万慢満\"],[\"cca1\",\"漫蔓味未魅巳箕岬密蜜湊蓑稔脈妙粍民眠務夢無牟矛霧鵡椋婿娘冥名命明盟迷銘鳴姪牝滅免棉綿緬面麺摸模茂妄孟毛猛盲網耗蒙儲木黙目杢勿餅尤戻籾貰問悶紋門匁也冶夜爺耶野弥矢厄役約薬訳躍靖柳薮鑓愉愈油癒\"],[\"cda1\",\"諭輸唯佑優勇友宥幽悠憂揖有柚湧涌猶猷由祐裕誘遊邑郵雄融夕予余与誉輿預傭幼妖容庸揚揺擁曜楊様洋溶熔用窯羊耀葉蓉要謡踊遥陽養慾抑欲沃浴翌翼淀羅螺裸来莱頼雷洛絡落酪乱卵嵐欄濫藍蘭覧利吏履李梨理璃\"],[\"cea1\",\"痢裏裡里離陸律率立葎掠略劉流溜琉留硫粒隆竜龍侶慮旅虜了亮僚両凌寮料梁涼猟療瞭稜糧良諒遼量陵領力緑倫厘林淋燐琳臨輪隣鱗麟瑠塁涙累類令伶例冷励嶺怜玲礼苓鈴隷零霊麗齢暦歴列劣烈裂廉恋憐漣煉簾練聯\"],[\"cfa1\",\"蓮連錬呂魯櫓炉賂路露労婁廊弄朗楼榔浪漏牢狼篭老聾蝋郎六麓禄肋録論倭和話歪賄脇惑枠鷲亙亘鰐詫藁蕨椀湾碗腕\"],[\"d0a1\",\"弌丐丕个丱丶丼丿乂乖乘亂亅豫亊舒弍于亞亟亠亢亰亳亶从仍仄仆仂仗仞仭仟价伉佚估佛佝佗佇佶侈侏侘佻佩佰侑佯來侖儘俔俟俎俘俛俑俚俐俤俥倚倨倔倪倥倅伜俶倡倩倬俾俯們倆偃假會偕偐偈做偖偬偸傀傚傅傴傲\"],[\"d1a1\",\"僉僊傳僂僖僞僥僭僣僮價僵儉儁儂儖儕儔儚儡儺儷儼儻儿兀兒兌兔兢竸兩兪兮冀冂囘册冉冏冑冓冕冖冤冦冢冩冪冫决冱冲冰况冽凅凉凛几處凩凭凰凵凾刄刋刔刎刧刪刮刳刹剏剄剋剌剞剔剪剴剩剳剿剽劍劔劒剱劈劑辨\"],[\"d2a1\",\"辧劬劭劼劵勁勍勗勞勣勦飭勠勳勵勸勹匆匈甸匍匐匏匕匚匣匯匱匳匸區卆卅丗卉卍凖卞卩卮夘卻卷厂厖厠厦厥厮厰厶參簒雙叟曼燮叮叨叭叺吁吽呀听吭吼吮吶吩吝呎咏呵咎呟呱呷呰咒呻咀呶咄咐咆哇咢咸咥咬哄哈咨\"],[\"d3a1\",\"咫哂咤咾咼哘哥哦唏唔哽哮哭哺哢唹啀啣啌售啜啅啖啗唸唳啝喙喀咯喊喟啻啾喘喞單啼喃喩喇喨嗚嗅嗟嗄嗜嗤嗔嘔嗷嘖嗾嗽嘛嗹噎噐營嘴嘶嘲嘸噫噤嘯噬噪嚆嚀嚊嚠嚔嚏嚥嚮嚶嚴囂嚼囁囃囀囈囎囑囓囗囮囹圀囿圄圉\"],[\"d4a1\",\"圈國圍圓團圖嗇圜圦圷圸坎圻址坏坩埀垈坡坿垉垓垠垳垤垪垰埃埆埔埒埓堊埖埣堋堙堝塲堡塢塋塰毀塒堽塹墅墹墟墫墺壞墻墸墮壅壓壑壗壙壘壥壜壤壟壯壺壹壻壼壽夂夊夐夛梦夥夬夭夲夸夾竒奕奐奎奚奘奢奠奧奬奩\"],[\"d5a1\",\"奸妁妝佞侫妣妲姆姨姜妍姙姚娥娟娑娜娉娚婀婬婉娵娶婢婪媚媼媾嫋嫂媽嫣嫗嫦嫩嫖嫺嫻嬌嬋嬖嬲嫐嬪嬶嬾孃孅孀孑孕孚孛孥孩孰孳孵學斈孺宀它宦宸寃寇寉寔寐寤實寢寞寥寫寰寶寳尅將專對尓尠尢尨尸尹屁屆屎屓\"],[\"d6a1\",\"屐屏孱屬屮乢屶屹岌岑岔妛岫岻岶岼岷峅岾峇峙峩峽峺峭嶌峪崋崕崗嵜崟崛崑崔崢崚崙崘嵌嵒嵎嵋嵬嵳嵶嶇嶄嶂嶢嶝嶬嶮嶽嶐嶷嶼巉巍巓巒巖巛巫已巵帋帚帙帑帛帶帷幄幃幀幎幗幔幟幢幤幇幵并幺麼广庠廁廂廈廐廏\"],[\"d7a1\",\"廖廣廝廚廛廢廡廨廩廬廱廳廰廴廸廾弃弉彝彜弋弑弖弩弭弸彁彈彌彎弯彑彖彗彙彡彭彳彷徃徂彿徊很徑徇從徙徘徠徨徭徼忖忻忤忸忱忝悳忿怡恠怙怐怩怎怱怛怕怫怦怏怺恚恁恪恷恟恊恆恍恣恃恤恂恬恫恙悁悍惧悃悚\"],[\"d8a1\",\"悄悛悖悗悒悧悋惡悸惠惓悴忰悽惆悵惘慍愕愆惶惷愀惴惺愃愡惻惱愍愎慇愾愨愧慊愿愼愬愴愽慂慄慳慷慘慙慚慫慴慯慥慱慟慝慓慵憙憖憇憬憔憚憊憑憫憮懌懊應懷懈懃懆憺懋罹懍懦懣懶懺懴懿懽懼懾戀戈戉戍戌戔戛\"],[\"d9a1\",\"戞戡截戮戰戲戳扁扎扞扣扛扠扨扼抂抉找抒抓抖拔抃抔拗拑抻拏拿拆擔拈拜拌拊拂拇抛拉挌拮拱挧挂挈拯拵捐挾捍搜捏掖掎掀掫捶掣掏掉掟掵捫捩掾揩揀揆揣揉插揶揄搖搴搆搓搦搶攝搗搨搏摧摯摶摎攪撕撓撥撩撈撼\"],[\"daa1\",\"據擒擅擇撻擘擂擱擧舉擠擡抬擣擯攬擶擴擲擺攀擽攘攜攅攤攣攫攴攵攷收攸畋效敖敕敍敘敞敝敲數斂斃變斛斟斫斷旃旆旁旄旌旒旛旙无旡旱杲昊昃旻杳昵昶昴昜晏晄晉晁晞晝晤晧晨晟晢晰暃暈暎暉暄暘暝曁暹曉暾暼\"],[\"dba1\",\"曄暸曖曚曠昿曦曩曰曵曷朏朖朞朦朧霸朮朿朶杁朸朷杆杞杠杙杣杤枉杰枩杼杪枌枋枦枡枅枷柯枴柬枳柩枸柤柞柝柢柮枹柎柆柧檜栞框栩桀桍栲桎梳栫桙档桷桿梟梏梭梔條梛梃檮梹桴梵梠梺椏梍桾椁棊椈棘椢椦棡椌棍\"],[\"dca1\",\"棔棧棕椶椒椄棗棣椥棹棠棯椨椪椚椣椡棆楹楷楜楸楫楔楾楮椹楴椽楙椰楡楞楝榁楪榲榮槐榿槁槓榾槎寨槊槝榻槃榧樮榑榠榜榕榴槞槨樂樛槿權槹槲槧樅榱樞槭樔槫樊樒櫁樣樓橄樌橲樶橸橇橢橙橦橈樸樢檐檍檠檄檢檣\"],[\"dda1\",\"檗蘗檻櫃櫂檸檳檬櫞櫑櫟檪櫚櫪櫻欅蘖櫺欒欖鬱欟欸欷盜欹飮歇歃歉歐歙歔歛歟歡歸歹歿殀殄殃殍殘殕殞殤殪殫殯殲殱殳殷殼毆毋毓毟毬毫毳毯麾氈氓气氛氤氣汞汕汢汪沂沍沚沁沛汾汨汳沒沐泄泱泓沽泗泅泝沮沱沾\"],[\"dea1\",\"沺泛泯泙泪洟衍洶洫洽洸洙洵洳洒洌浣涓浤浚浹浙涎涕濤涅淹渕渊涵淇淦涸淆淬淞淌淨淒淅淺淙淤淕淪淮渭湮渮渙湲湟渾渣湫渫湶湍渟湃渺湎渤滿渝游溂溪溘滉溷滓溽溯滄溲滔滕溏溥滂溟潁漑灌滬滸滾漿滲漱滯漲滌\"],[\"dfa1\",\"漾漓滷澆潺潸澁澀潯潛濳潭澂潼潘澎澑濂潦澳澣澡澤澹濆澪濟濕濬濔濘濱濮濛瀉瀋濺瀑瀁瀏濾瀛瀚潴瀝瀘瀟瀰瀾瀲灑灣炙炒炯烱炬炸炳炮烟烋烝烙焉烽焜焙煥煕熈煦煢煌煖煬熏燻熄熕熨熬燗熹熾燒燉燔燎燠燬燧燵燼\"],[\"e0a1\",\"燹燿爍爐爛爨爭爬爰爲爻爼爿牀牆牋牘牴牾犂犁犇犒犖犢犧犹犲狃狆狄狎狒狢狠狡狹狷倏猗猊猜猖猝猴猯猩猥猾獎獏默獗獪獨獰獸獵獻獺珈玳珎玻珀珥珮珞璢琅瑯琥珸琲琺瑕琿瑟瑙瑁瑜瑩瑰瑣瑪瑶瑾璋璞璧瓊瓏瓔珱\"],[\"e1a1\",\"瓠瓣瓧瓩瓮瓲瓰瓱瓸瓷甄甃甅甌甎甍甕甓甞甦甬甼畄畍畊畉畛畆畚畩畤畧畫畭畸當疆疇畴疊疉疂疔疚疝疥疣痂疳痃疵疽疸疼疱痍痊痒痙痣痞痾痿痼瘁痰痺痲痳瘋瘍瘉瘟瘧瘠瘡瘢瘤瘴瘰瘻癇癈癆癜癘癡癢癨癩癪癧癬癰\"],[\"e2a1\",\"癲癶癸發皀皃皈皋皎皖皓皙皚皰皴皸皹皺盂盍盖盒盞盡盥盧盪蘯盻眈眇眄眩眤眞眥眦眛眷眸睇睚睨睫睛睥睿睾睹瞎瞋瞑瞠瞞瞰瞶瞹瞿瞼瞽瞻矇矍矗矚矜矣矮矼砌砒礦砠礪硅碎硴碆硼碚碌碣碵碪碯磑磆磋磔碾碼磅磊磬\"],[\"e3a1\",\"磧磚磽磴礇礒礑礙礬礫祀祠祗祟祚祕祓祺祿禊禝禧齋禪禮禳禹禺秉秕秧秬秡秣稈稍稘稙稠稟禀稱稻稾稷穃穗穉穡穢穩龝穰穹穽窈窗窕窘窖窩竈窰窶竅竄窿邃竇竊竍竏竕竓站竚竝竡竢竦竭竰笂笏笊笆笳笘笙笞笵笨笶筐\"],[\"e4a1\",\"筺笄筍笋筌筅筵筥筴筧筰筱筬筮箝箘箟箍箜箚箋箒箏筝箙篋篁篌篏箴篆篝篩簑簔篦篥籠簀簇簓篳篷簗簍篶簣簧簪簟簷簫簽籌籃籔籏籀籐籘籟籤籖籥籬籵粃粐粤粭粢粫粡粨粳粲粱粮粹粽糀糅糂糘糒糜糢鬻糯糲糴糶糺紆\"],[\"e5a1\",\"紂紜紕紊絅絋紮紲紿紵絆絳絖絎絲絨絮絏絣經綉絛綏絽綛綺綮綣綵緇綽綫總綢綯緜綸綟綰緘緝緤緞緻緲緡縅縊縣縡縒縱縟縉縋縢繆繦縻縵縹繃縷縲縺繧繝繖繞繙繚繹繪繩繼繻纃緕繽辮繿纈纉續纒纐纓纔纖纎纛纜缸缺\"],[\"e6a1\",\"罅罌罍罎罐网罕罔罘罟罠罨罩罧罸羂羆羃羈羇羌羔羞羝羚羣羯羲羹羮羶羸譱翅翆翊翕翔翡翦翩翳翹飜耆耄耋耒耘耙耜耡耨耿耻聊聆聒聘聚聟聢聨聳聲聰聶聹聽聿肄肆肅肛肓肚肭冐肬胛胥胙胝胄胚胖脉胯胱脛脩脣脯腋\"],[\"e7a1\",\"隋腆脾腓腑胼腱腮腥腦腴膃膈膊膀膂膠膕膤膣腟膓膩膰膵膾膸膽臀臂膺臉臍臑臙臘臈臚臟臠臧臺臻臾舁舂舅與舊舍舐舖舩舫舸舳艀艙艘艝艚艟艤艢艨艪艫舮艱艷艸艾芍芒芫芟芻芬苡苣苟苒苴苳苺莓范苻苹苞茆苜茉苙\"],[\"e8a1\",\"茵茴茖茲茱荀茹荐荅茯茫茗茘莅莚莪莟莢莖茣莎莇莊荼莵荳荵莠莉莨菴萓菫菎菽萃菘萋菁菷萇菠菲萍萢萠莽萸蔆菻葭萪萼蕚蒄葷葫蒭葮蒂葩葆萬葯葹萵蓊葢蒹蒿蒟蓙蓍蒻蓚蓐蓁蓆蓖蒡蔡蓿蓴蔗蔘蔬蔟蔕蔔蓼蕀蕣蕘蕈\"],[\"e9a1\",\"蕁蘂蕋蕕薀薤薈薑薊薨蕭薔薛藪薇薜蕷蕾薐藉薺藏薹藐藕藝藥藜藹蘊蘓蘋藾藺蘆蘢蘚蘰蘿虍乕虔號虧虱蚓蚣蚩蚪蚋蚌蚶蚯蛄蛆蚰蛉蠣蚫蛔蛞蛩蛬蛟蛛蛯蜒蜆蜈蜀蜃蛻蜑蜉蜍蛹蜊蜴蜿蜷蜻蜥蜩蜚蝠蝟蝸蝌蝎蝴蝗蝨蝮蝙\"],[\"eaa1\",\"蝓蝣蝪蠅螢螟螂螯蟋螽蟀蟐雖螫蟄螳蟇蟆螻蟯蟲蟠蠏蠍蟾蟶蟷蠎蟒蠑蠖蠕蠢蠡蠱蠶蠹蠧蠻衄衂衒衙衞衢衫袁衾袞衵衽袵衲袂袗袒袮袙袢袍袤袰袿袱裃裄裔裘裙裝裹褂裼裴裨裲褄褌褊褓襃褞褥褪褫襁襄褻褶褸襌褝襠襞\"],[\"eba1\",\"襦襤襭襪襯襴襷襾覃覈覊覓覘覡覩覦覬覯覲覺覽覿觀觚觜觝觧觴觸訃訖訐訌訛訝訥訶詁詛詒詆詈詼詭詬詢誅誂誄誨誡誑誥誦誚誣諄諍諂諚諫諳諧諤諱謔諠諢諷諞諛謌謇謚諡謖謐謗謠謳鞫謦謫謾謨譁譌譏譎證譖譛譚譫\"],[\"eca1\",\"譟譬譯譴譽讀讌讎讒讓讖讙讚谺豁谿豈豌豎豐豕豢豬豸豺貂貉貅貊貍貎貔豼貘戝貭貪貽貲貳貮貶賈賁賤賣賚賽賺賻贄贅贊贇贏贍贐齎贓賍贔贖赧赭赱赳趁趙跂趾趺跏跚跖跌跛跋跪跫跟跣跼踈踉跿踝踞踐踟蹂踵踰踴蹊\"],[\"eda1\",\"蹇蹉蹌蹐蹈蹙蹤蹠踪蹣蹕蹶蹲蹼躁躇躅躄躋躊躓躑躔躙躪躡躬躰軆躱躾軅軈軋軛軣軼軻軫軾輊輅輕輒輙輓輜輟輛輌輦輳輻輹轅轂輾轌轉轆轎轗轜轢轣轤辜辟辣辭辯辷迚迥迢迪迯邇迴逅迹迺逑逕逡逍逞逖逋逧逶逵逹迸\"],[\"eea1\",\"遏遐遑遒逎遉逾遖遘遞遨遯遶隨遲邂遽邁邀邊邉邏邨邯邱邵郢郤扈郛鄂鄒鄙鄲鄰酊酖酘酣酥酩酳酲醋醉醂醢醫醯醪醵醴醺釀釁釉釋釐釖釟釡釛釼釵釶鈞釿鈔鈬鈕鈑鉞鉗鉅鉉鉤鉈銕鈿鉋鉐銜銖銓銛鉚鋏銹銷鋩錏鋺鍄錮\"],[\"efa1\",\"錙錢錚錣錺錵錻鍜鍠鍼鍮鍖鎰鎬鎭鎔鎹鏖鏗鏨鏥鏘鏃鏝鏐鏈鏤鐚鐔鐓鐃鐇鐐鐶鐫鐵鐡鐺鑁鑒鑄鑛鑠鑢鑞鑪鈩鑰鑵鑷鑽鑚鑼鑾钁鑿閂閇閊閔閖閘閙閠閨閧閭閼閻閹閾闊濶闃闍闌闕闔闖關闡闥闢阡阨阮阯陂陌陏陋陷陜陞\"],[\"f0a1\",\"陝陟陦陲陬隍隘隕隗險隧隱隲隰隴隶隸隹雎雋雉雍襍雜霍雕雹霄霆霈霓霎霑霏霖霙霤霪霰霹霽霾靄靆靈靂靉靜靠靤靦靨勒靫靱靹鞅靼鞁靺鞆鞋鞏鞐鞜鞨鞦鞣鞳鞴韃韆韈韋韜韭齏韲竟韶韵頏頌頸頤頡頷頽顆顏顋顫顯顰\"],[\"f1a1\",\"顱顴顳颪颯颱颶飄飃飆飩飫餃餉餒餔餘餡餝餞餤餠餬餮餽餾饂饉饅饐饋饑饒饌饕馗馘馥馭馮馼駟駛駝駘駑駭駮駱駲駻駸騁騏騅駢騙騫騷驅驂驀驃騾驕驍驛驗驟驢驥驤驩驫驪骭骰骼髀髏髑髓體髞髟髢髣髦髯髫髮髴髱髷\"],[\"f2a1\",\"髻鬆鬘鬚鬟鬢鬣鬥鬧鬨鬩鬪鬮鬯鬲魄魃魏魍魎魑魘魴鮓鮃鮑鮖鮗鮟鮠鮨鮴鯀鯊鮹鯆鯏鯑鯒鯣鯢鯤鯔鯡鰺鯲鯱鯰鰕鰔鰉鰓鰌鰆鰈鰒鰊鰄鰮鰛鰥鰤鰡鰰鱇鰲鱆鰾鱚鱠鱧鱶鱸鳧鳬鳰鴉鴈鳫鴃鴆鴪鴦鶯鴣鴟鵄鴕鴒鵁鴿鴾鵆鵈\"],[\"f3a1\",\"鵝鵞鵤鵑鵐鵙鵲鶉鶇鶫鵯鵺鶚鶤鶩鶲鷄鷁鶻鶸鶺鷆鷏鷂鷙鷓鷸鷦鷭鷯鷽鸚鸛鸞鹵鹹鹽麁麈麋麌麒麕麑麝麥麩麸麪麭靡黌黎黏黐黔黜點黝黠黥黨黯黴黶黷黹黻黼黽鼇鼈皷鼕鼡鼬鼾齊齒齔齣齟齠齡齦齧齬齪齷齲齶龕龜龠\"],[\"f4a1\",\"堯槇遙瑤凜熙\"],[\"f9a1\",\"纊褜鍈銈蓜俉炻昱棈鋹曻彅丨仡仼伀伃伹佖侒侊侚侔俍偀倢俿倞偆偰偂傔僴僘兊兤冝冾凬刕劜劦勀勛匀匇匤卲厓厲叝﨎咜咊咩哿喆坙坥垬埈埇﨏塚增墲夋奓奛奝奣妤妺孖寀甯寘寬尞岦岺峵崧嵓﨑嵂嵭嶸嶹巐弡弴彧德\"],[\"faa1\",\"忞恝悅悊惞惕愠惲愑愷愰憘戓抦揵摠撝擎敎昀昕昻昉昮昞昤晥晗晙晴晳暙暠暲暿曺朎朗杦枻桒柀栁桄棏﨓楨﨔榘槢樰橫橆橳橾櫢櫤毖氿汜沆汯泚洄涇浯涖涬淏淸淲淼渹湜渧渼溿澈澵濵瀅瀇瀨炅炫焏焄煜煆煇凞燁燾犱\"],[\"fba1\",\"犾猤猪獷玽珉珖珣珒琇珵琦琪琩琮瑢璉璟甁畯皂皜皞皛皦益睆劯砡硎硤硺礰礼神祥禔福禛竑竧靖竫箞精絈絜綷綠緖繒罇羡羽茁荢荿菇菶葈蒴蕓蕙蕫﨟薰蘒﨡蠇裵訒訷詹誧誾諟諸諶譓譿賰賴贒赶﨣軏﨤逸遧郞都鄕鄧釚\"],[\"fca1\",\"釗釞釭釮釤釥鈆鈐鈊鈺鉀鈼鉎鉙鉑鈹鉧銧鉷鉸鋧鋗鋙鋐﨧鋕鋠鋓錥錡鋻﨨錞鋿錝錂鍰鍗鎤鏆鏞鏸鐱鑅鑈閒隆﨩隝隯霳霻靃靍靏靑靕顗顥飯飼餧館馞驎髙髜魵魲鮏鮱鮻鰀鵰鵫鶴鸙黑\"],[\"fcf1\",\"ⅰ\",9,\"￢￤＇＂\"],[\"8fa2af\",\"˘ˇ¸˙˝¯˛˚～΄΅\"],[\"8fa2c2\",\"¡¦¿\"],[\"8fa2eb\",\"ºª©®™¤№\"],[\"8fa6e1\",\"ΆΈΉΊΪ\"],[\"8fa6e7\",\"Ό\"],[\"8fa6e9\",\"ΎΫ\"],[\"8fa6ec\",\"Ώ\"],[\"8fa6f1\",\"άέήίϊΐόςύϋΰώ\"],[\"8fa7c2\",\"Ђ\",10,\"ЎЏ\"],[\"8fa7f2\",\"ђ\",10,\"ўџ\"],[\"8fa9a1\",\"ÆĐ\"],[\"8fa9a4\",\"Ħ\"],[\"8fa9a6\",\"Ĳ\"],[\"8fa9a8\",\"ŁĿ\"],[\"8fa9ab\",\"ŊØŒ\"],[\"8fa9af\",\"ŦÞ\"],[\"8fa9c1\",\"æđðħıĳĸłŀŉŋøœßŧþ\"],[\"8faaa1\",\"ÁÀÄÂĂǍĀĄÅÃĆĈČÇĊĎÉÈËÊĚĖĒĘ\"],[\"8faaba\",\"ĜĞĢĠĤÍÌÏÎǏİĪĮĨĴĶĹĽĻŃŇŅÑÓÒÖÔǑŐŌÕŔŘŖŚŜŠŞŤŢÚÙÜÛŬǓŰŪŲŮŨǗǛǙǕŴÝŸŶŹŽŻ\"],[\"8faba1\",\"áàäâăǎāąåãćĉčçċďéèëêěėēęǵĝğ\"],[\"8fabbd\",\"ġĥíìïîǐ\"],[\"8fabc5\",\"īįĩĵķĺľļńňņñóòöôǒőōõŕřŗśŝšşťţúùüûŭǔűūųůũǘǜǚǖŵýÿŷźžż\"],[\"8fb0a1\",\"丂丄丅丌丒丟丣两丨丫丮丯丰丵乀乁乄乇乑乚乜乣乨乩乴乵乹乿亍亖亗亝亯亹仃仐仚仛仠仡仢仨仯仱仳仵份仾仿伀伂伃伈伋伌伒伕伖众伙伮伱你伳伵伷伹伻伾佀佂佈佉佋佌佒佔佖佘佟佣佪佬佮佱佷佸佹佺佽佾侁侂侄\"],[\"8fb1a1\",\"侅侉侊侌侎侐侒侓侔侗侙侚侞侟侲侷侹侻侼侽侾俀俁俅俆俈俉俋俌俍俏俒俜俠俢俰俲俼俽俿倀倁倄倇倊倌倎倐倓倗倘倛倜倝倞倢倧倮倰倲倳倵偀偁偂偅偆偊偌偎偑偒偓偗偙偟偠偢偣偦偧偪偭偰偱倻傁傃傄傆傊傎傏傐\"],[\"8fb2a1\",\"傒傓傔傖傛傜傞\",4,\"傪傯傰傹傺傽僀僃僄僇僌僎僐僓僔僘僜僝僟僢僤僦僨僩僯僱僶僺僾儃儆儇儈儋儌儍儎僲儐儗儙儛儜儝儞儣儧儨儬儭儯儱儳儴儵儸儹兂兊兏兓兕兗兘兟兤兦兾冃冄冋冎冘冝冡冣冭冸冺冼冾冿凂\"],[\"8fb3a1\",\"凈减凑凒凓凕凘凞凢凥凮凲凳凴凷刁刂刅划刓刕刖刘刢刨刱刲刵刼剅剉剕剗剘剚剜剟剠剡剦剮剷剸剹劀劂劅劊劌劓劕劖劗劘劚劜劤劥劦劧劯劰劶劷劸劺劻劽勀勄勆勈勌勏勑勔勖勛勜勡勥勨勩勪勬勰勱勴勶勷匀匃匊匋\"],[\"8fb4a1\",\"匌匑匓匘匛匜匞匟匥匧匨匩匫匬匭匰匲匵匼匽匾卂卌卋卙卛卡卣卥卬卭卲卹卾厃厇厈厎厓厔厙厝厡厤厪厫厯厲厴厵厷厸厺厽叀叅叏叒叓叕叚叝叞叠另叧叵吂吓吚吡吧吨吪启吱吴吵呃呄呇呍呏呞呢呤呦呧呩呫呭呮呴呿\"],[\"8fb5a1\",\"咁咃咅咈咉咍咑咕咖咜咟咡咦咧咩咪咭咮咱咷咹咺咻咿哆哊响哎哠哪哬哯哶哼哾哿唀唁唅唈唉唌唍唎唕唪唫唲唵唶唻唼唽啁啇啉啊啍啐啑啘啚啛啞啠啡啤啦啿喁喂喆喈喎喏喑喒喓喔喗喣喤喭喲喿嗁嗃嗆嗉嗋嗌嗎嗑嗒\"],[\"8fb6a1\",\"嗓嗗嗘嗛嗞嗢嗩嗶嗿嘅嘈嘊嘍\",5,\"嘙嘬嘰嘳嘵嘷嘹嘻嘼嘽嘿噀噁噃噄噆噉噋噍噏噔噞噠噡噢噣噦噩噭噯噱噲噵嚄嚅嚈嚋嚌嚕嚙嚚嚝嚞嚟嚦嚧嚨嚩嚫嚬嚭嚱嚳嚷嚾囅囉囊囋囏囐囌囍囙囜囝囟囡囤\",4,\"囱囫园\"],[\"8fb7a1\",\"囶囷圁圂圇圊圌圑圕圚圛圝圠圢圣圤圥圩圪圬圮圯圳圴圽圾圿坅坆坌坍坒坢坥坧坨坫坭\",4,\"坳坴坵坷坹坺坻坼坾垁垃垌垔垗垙垚垜垝垞垟垡垕垧垨垩垬垸垽埇埈埌埏埕埝埞埤埦埧埩埭埰埵埶埸埽埾埿堃堄堈堉埡\"],[\"8fb8a1\",\"堌堍堛堞堟堠堦堧堭堲堹堿塉塌塍塏塐塕塟塡塤塧塨塸塼塿墀墁墇墈墉墊墌墍墏墐墔墖墝墠墡墢墦墩墱墲壄墼壂壈壍壎壐壒壔壖壚壝壡壢壩壳夅夆夋夌夒夓夔虁夝夡夣夤夨夯夰夳夵夶夿奃奆奒奓奙奛奝奞奟奡奣奫奭\"],[\"8fb9a1\",\"奯奲奵奶她奻奼妋妌妎妒妕妗妟妤妧妭妮妯妰妳妷妺妼姁姃姄姈姊姍姒姝姞姟姣姤姧姮姯姱姲姴姷娀娄娌娍娎娒娓娞娣娤娧娨娪娭娰婄婅婇婈婌婐婕婞婣婥婧婭婷婺婻婾媋媐媓媖媙媜媞媟媠媢媧媬媱媲媳媵媸媺媻媿\"],[\"8fbaa1\",\"嫄嫆嫈嫏嫚嫜嫠嫥嫪嫮嫵嫶嫽嬀嬁嬈嬗嬴嬙嬛嬝嬡嬥嬭嬸孁孋孌孒孖孞孨孮孯孼孽孾孿宁宄宆宊宎宐宑宓宔宖宨宩宬宭宯宱宲宷宺宼寀寁寍寏寖\",4,\"寠寯寱寴寽尌尗尞尟尣尦尩尫尬尮尰尲尵尶屙屚屜屢屣屧屨屩\"],[\"8fbba1\",\"屭屰屴屵屺屻屼屽岇岈岊岏岒岝岟岠岢岣岦岪岲岴岵岺峉峋峒峝峗峮峱峲峴崁崆崍崒崫崣崤崦崧崱崴崹崽崿嵂嵃嵆嵈嵕嵑嵙嵊嵟嵠嵡嵢嵤嵪嵭嵰嵹嵺嵾嵿嶁嶃嶈嶊嶒嶓嶔嶕嶙嶛嶟嶠嶧嶫嶰嶴嶸嶹巃巇巋巐巎巘巙巠巤\"],[\"8fbca1\",\"巩巸巹帀帇帍帒帔帕帘帟帠帮帨帲帵帾幋幐幉幑幖幘幛幜幞幨幪\",4,\"幰庀庋庎庢庤庥庨庪庬庱庳庽庾庿廆廌廋廎廑廒廔廕廜廞廥廫异弆弇弈弎弙弜弝弡弢弣弤弨弫弬弮弰弴弶弻弽弿彀彄彅彇彍彐彔彘彛彠彣彤彧\"],[\"8fbda1\",\"彯彲彴彵彸彺彽彾徉徍徏徖徜徝徢徧徫徤徬徯徰徱徸忄忇忈忉忋忐\",4,\"忞忡忢忨忩忪忬忭忮忯忲忳忶忺忼怇怊怍怓怔怗怘怚怟怤怭怳怵恀恇恈恉恌恑恔恖恗恝恡恧恱恾恿悂悆悈悊悎悑悓悕悘悝悞悢悤悥您悰悱悷\"],[\"8fbea1\",\"悻悾惂惄惈惉惊惋惎惏惔惕惙惛惝惞惢惥惲惵惸惼惽愂愇愊愌愐\",4,\"愖愗愙愜愞愢愪愫愰愱愵愶愷愹慁慅慆慉慞慠慬慲慸慻慼慿憀憁憃憄憋憍憒憓憗憘憜憝憟憠憥憨憪憭憸憹憼懀懁懂懎懏懕懜懝懞懟懡懢懧懩懥\"],[\"8fbfa1\",\"懬懭懯戁戃戄戇戓戕戜戠戢戣戧戩戫戹戽扂扃扄扆扌扐扑扒扔扖扚扜扤扭扯扳扺扽抍抎抏抐抦抨抳抶抷抺抾抿拄拎拕拖拚拪拲拴拼拽挃挄挊挋挍挐挓挖挘挩挪挭挵挶挹挼捁捂捃捄捆捊捋捎捒捓捔捘捛捥捦捬捭捱捴捵\"],[\"8fc0a1\",\"捸捼捽捿掂掄掇掊掐掔掕掙掚掞掤掦掭掮掯掽揁揅揈揎揑揓揔揕揜揠揥揪揬揲揳揵揸揹搉搊搐搒搔搘搞搠搢搤搥搩搪搯搰搵搽搿摋摏摑摒摓摔摚摛摜摝摟摠摡摣摭摳摴摻摽撅撇撏撐撑撘撙撛撝撟撡撣撦撨撬撳撽撾撿\"],[\"8fc1a1\",\"擄擉擊擋擌擎擐擑擕擗擤擥擩擪擭擰擵擷擻擿攁攄攈攉攊攏攓攔攖攙攛攞攟攢攦攩攮攱攺攼攽敃敇敉敐敒敔敟敠敧敫敺敽斁斅斊斒斕斘斝斠斣斦斮斲斳斴斿旂旈旉旎旐旔旖旘旟旰旲旴旵旹旾旿昀昄昈昉昍昑昒昕昖昝\"],[\"8fc2a1\",\"昞昡昢昣昤昦昩昪昫昬昮昰昱昳昹昷晀晅晆晊晌晑晎晗晘晙晛晜晠晡曻晪晫晬晾晳晵晿晷晸晹晻暀晼暋暌暍暐暒暙暚暛暜暟暠暤暭暱暲暵暻暿曀曂曃曈曌曎曏曔曛曟曨曫曬曮曺朅朇朎朓朙朜朠朢朳朾杅杇杈杌杔杕杝\"],[\"8fc3a1\",\"杦杬杮杴杶杻极构枎枏枑枓枖枘枙枛枰枱枲枵枻枼枽柹柀柂柃柅柈柉柒柗柙柜柡柦柰柲柶柷桒栔栙栝栟栨栧栬栭栯栰栱栳栻栿桄桅桊桌桕桗桘桛桫桮\",4,\"桵桹桺桻桼梂梄梆梈梖梘梚梜梡梣梥梩梪梮梲梻棅棈棌棏\"],[\"8fc4a1\",\"棐棑棓棖棙棜棝棥棨棪棫棬棭棰棱棵棶棻棼棽椆椉椊椐椑椓椖椗椱椳椵椸椻楂楅楉楎楗楛楣楤楥楦楨楩楬楰楱楲楺楻楿榀榍榒榖榘榡榥榦榨榫榭榯榷榸榺榼槅槈槑槖槗槢槥槮槯槱槳槵槾樀樁樃樏樑樕樚樝樠樤樨樰樲\"],[\"8fc5a1\",\"樴樷樻樾樿橅橆橉橊橎橐橑橒橕橖橛橤橧橪橱橳橾檁檃檆檇檉檋檑檛檝檞檟檥檫檯檰檱檴檽檾檿櫆櫉櫈櫌櫐櫔櫕櫖櫜櫝櫤櫧櫬櫰櫱櫲櫼櫽欂欃欆欇欉欏欐欑欗欛欞欤欨欫欬欯欵欶欻欿歆歊歍歒歖歘歝歠歧歫歮歰歵歽\"],[\"8fc6a1\",\"歾殂殅殗殛殟殠殢殣殨殩殬殭殮殰殸殹殽殾毃毄毉毌毖毚毡毣毦毧毮毱毷毹毿氂氄氅氉氍氎氐氒氙氟氦氧氨氬氮氳氵氶氺氻氿汊汋汍汏汒汔汙汛汜汫汭汯汴汶汸汹汻沅沆沇沉沔沕沗沘沜沟沰沲沴泂泆泍泏泐泑泒泔泖\"],[\"8fc7a1\",\"泚泜泠泧泩泫泬泮泲泴洄洇洊洎洏洑洓洚洦洧洨汧洮洯洱洹洼洿浗浞浟浡浥浧浯浰浼涂涇涑涒涔涖涗涘涪涬涴涷涹涽涿淄淈淊淎淏淖淛淝淟淠淢淥淩淯淰淴淶淼渀渄渞渢渧渲渶渹渻渼湄湅湈湉湋湏湑湒湓湔湗湜湝湞\"],[\"8fc8a1\",\"湢湣湨湳湻湽溍溓溙溠溧溭溮溱溳溻溿滀滁滃滇滈滊滍滎滏滫滭滮滹滻滽漄漈漊漌漍漖漘漚漛漦漩漪漯漰漳漶漻漼漭潏潑潒潓潗潙潚潝潞潡潢潨潬潽潾澃澇澈澋澌澍澐澒澓澔澖澚澟澠澥澦澧澨澮澯澰澵澶澼濅濇濈濊\"],[\"8fc9a1\",\"濚濞濨濩濰濵濹濼濽瀀瀅瀆瀇瀍瀗瀠瀣瀯瀴瀷瀹瀼灃灄灈灉灊灋灔灕灝灞灎灤灥灬灮灵灶灾炁炅炆炔\",4,\"炛炤炫炰炱炴炷烊烑烓烔烕烖烘烜烤烺焃\",4,\"焋焌焏焞焠焫焭焯焰焱焸煁煅煆煇煊煋煐煒煗煚煜煞煠\"],[\"8fcaa1\",\"煨煹熀熅熇熌熒熚熛熠熢熯熰熲熳熺熿燀燁燄燋燌燓燖燙燚燜燸燾爀爇爈爉爓爗爚爝爟爤爫爯爴爸爹牁牂牃牅牎牏牐牓牕牖牚牜牞牠牣牨牫牮牯牱牷牸牻牼牿犄犉犍犎犓犛犨犭犮犱犴犾狁狇狉狌狕狖狘狟狥狳狴狺狻\"],[\"8fcba1\",\"狾猂猄猅猇猋猍猒猓猘猙猞猢猤猧猨猬猱猲猵猺猻猽獃獍獐獒獖獘獝獞獟獠獦獧獩獫獬獮獯獱獷獹獼玀玁玃玅玆玎玐玓玕玗玘玜玞玟玠玢玥玦玪玫玭玵玷玹玼玽玿珅珆珉珋珌珏珒珓珖珙珝珡珣珦珧珩珴珵珷珹珺珻珽\"],[\"8fcca1\",\"珿琀琁琄琇琊琑琚琛琤琦琨\",9,\"琹瑀瑃瑄瑆瑇瑋瑍瑑瑒瑗瑝瑢瑦瑧瑨瑫瑭瑮瑱瑲璀璁璅璆璇璉璏璐璑璒璘璙璚璜璟璠璡璣璦璨璩璪璫璮璯璱璲璵璹璻璿瓈瓉瓌瓐瓓瓘瓚瓛瓞瓟瓤瓨瓪瓫瓯瓴瓺瓻瓼瓿甆\"],[\"8fcda1\",\"甒甖甗甠甡甤甧甩甪甯甶甹甽甾甿畀畃畇畈畎畐畒畗畞畟畡畯畱畹\",5,\"疁疅疐疒疓疕疙疜疢疤疴疺疿痀痁痄痆痌痎痏痗痜痟痠痡痤痧痬痮痯痱痹瘀瘂瘃瘄瘇瘈瘊瘌瘏瘒瘓瘕瘖瘙瘛瘜瘝瘞瘣瘥瘦瘩瘭瘲瘳瘵瘸瘹\"],[\"8fcea1\",\"瘺瘼癊癀癁癃癄癅癉癋癕癙癟癤癥癭癮癯癱癴皁皅皌皍皕皛皜皝皟皠皢\",6,\"皪皭皽盁盅盉盋盌盎盔盙盠盦盨盬盰盱盶盹盼眀眆眊眎眒眔眕眗眙眚眜眢眨眭眮眯眴眵眶眹眽眾睂睅睆睊睍睎睏睒睖睗睜睞睟睠睢\"],[\"8fcfa1\",\"睤睧睪睬睰睲睳睴睺睽瞀瞄瞌瞍瞔瞕瞖瞚瞟瞢瞧瞪瞮瞯瞱瞵瞾矃矉矑矒矕矙矞矟矠矤矦矪矬矰矱矴矸矻砅砆砉砍砎砑砝砡砢砣砭砮砰砵砷硃硄硇硈硌硎硒硜硞硠硡硣硤硨硪确硺硾碊碏碔碘碡碝碞碟碤碨碬碭碰碱碲碳\"],[\"8fd0a1\",\"碻碽碿磇磈磉磌磎磒磓磕磖磤磛磟磠磡磦磪磲磳礀磶磷磺磻磿礆礌礐礚礜礞礟礠礥礧礩礭礱礴礵礻礽礿祄祅祆祊祋祏祑祔祘祛祜祧祩祫祲祹祻祼祾禋禌禑禓禔禕禖禘禛禜禡禨禩禫禯禱禴禸离秂秄秇秈秊秏秔秖秚秝秞\"],[\"8fd1a1\",\"秠秢秥秪秫秭秱秸秼稂稃稇稉稊稌稑稕稛稞稡稧稫稭稯稰稴稵稸稹稺穄穅穇穈穌穕穖穙穜穝穟穠穥穧穪穭穵穸穾窀窂窅窆窊窋窐窑窔窞窠窣窬窳窵窹窻窼竆竉竌竎竑竛竨竩竫竬竱竴竻竽竾笇笔笟笣笧笩笪笫笭笮笯笰\"],[\"8fd2a1\",\"笱笴笽笿筀筁筇筎筕筠筤筦筩筪筭筯筲筳筷箄箉箎箐箑箖箛箞箠箥箬箯箰箲箵箶箺箻箼箽篂篅篈篊篔篖篗篙篚篛篨篪篲篴篵篸篹篺篼篾簁簂簃簄簆簉簋簌簎簏簙簛簠簥簦簨簬簱簳簴簶簹簺籆籊籕籑籒籓籙\",5],[\"8fd3a1\",\"籡籣籧籩籭籮籰籲籹籼籽粆粇粏粔粞粠粦粰粶粷粺粻粼粿糄糇糈糉糍糏糓糔糕糗糙糚糝糦糩糫糵紃紇紈紉紏紑紒紓紖紝紞紣紦紪紭紱紼紽紾絀絁絇絈絍絑絓絗絙絚絜絝絥絧絪絰絸絺絻絿綁綂綃綅綆綈綋綌綍綑綖綗綝\"],[\"8fd4a1\",\"綞綦綧綪綳綶綷綹緂\",4,\"緌緍緎緗緙縀緢緥緦緪緫緭緱緵緶緹緺縈縐縑縕縗縜縝縠縧縨縬縭縯縳縶縿繄繅繇繎繐繒繘繟繡繢繥繫繮繯繳繸繾纁纆纇纊纍纑纕纘纚纝纞缼缻缽缾缿罃罄罇罏罒罓罛罜罝罡罣罤罥罦罭\"],[\"8fd5a1\",\"罱罽罾罿羀羋羍羏羐羑羖羗羜羡羢羦羪羭羴羼羿翀翃翈翎翏翛翟翣翥翨翬翮翯翲翺翽翾翿耇耈耊耍耎耏耑耓耔耖耝耞耟耠耤耦耬耮耰耴耵耷耹耺耼耾聀聄聠聤聦聭聱聵肁肈肎肜肞肦肧肫肸肹胈胍胏胒胔胕胗胘胠胭胮\"],[\"8fd6a1\",\"胰胲胳胶胹胺胾脃脋脖脗脘脜脞脠脤脧脬脰脵脺脼腅腇腊腌腒腗腠腡腧腨腩腭腯腷膁膐膄膅膆膋膎膖膘膛膞膢膮膲膴膻臋臃臅臊臎臏臕臗臛臝臞臡臤臫臬臰臱臲臵臶臸臹臽臿舀舃舏舓舔舙舚舝舡舢舨舲舴舺艃艄艅艆\"],[\"8fd7a1\",\"艋艎艏艑艖艜艠艣艧艭艴艻艽艿芀芁芃芄芇芉芊芎芑芔芖芘芚芛芠芡芣芤芧芨芩芪芮芰芲芴芷芺芼芾芿苆苐苕苚苠苢苤苨苪苭苯苶苷苽苾茀茁茇茈茊茋荔茛茝茞茟茡茢茬茭茮茰茳茷茺茼茽荂荃荄荇荍荎荑荕荖荗荰荸\"],[\"8fd8a1\",\"荽荿莀莂莄莆莍莒莔莕莘莙莛莜莝莦莧莩莬莾莿菀菇菉菏菐菑菔菝荓菨菪菶菸菹菼萁萆萊萏萑萕萙莭萯萹葅葇葈葊葍葏葑葒葖葘葙葚葜葠葤葥葧葪葰葳葴葶葸葼葽蒁蒅蒒蒓蒕蒞蒦蒨蒩蒪蒯蒱蒴蒺蒽蒾蓀蓂蓇蓈蓌蓏蓓\"],[\"8fd9a1\",\"蓜蓧蓪蓯蓰蓱蓲蓷蔲蓺蓻蓽蔂蔃蔇蔌蔎蔐蔜蔞蔢蔣蔤蔥蔧蔪蔫蔯蔳蔴蔶蔿蕆蕏\",4,\"蕖蕙蕜\",6,\"蕤蕫蕯蕹蕺蕻蕽蕿薁薅薆薉薋薌薏薓薘薝薟薠薢薥薧薴薶薷薸薼薽薾薿藂藇藊藋藎薭藘藚藟藠藦藨藭藳藶藼\"],[\"8fdaa1\",\"藿蘀蘄蘅蘍蘎蘐蘑蘒蘘蘙蘛蘞蘡蘧蘩蘶蘸蘺蘼蘽虀虂虆虒虓虖虗虘虙虝虠\",4,\"虩虬虯虵虶虷虺蚍蚑蚖蚘蚚蚜蚡蚦蚧蚨蚭蚱蚳蚴蚵蚷蚸蚹蚿蛀蛁蛃蛅蛑蛒蛕蛗蛚蛜蛠蛣蛥蛧蚈蛺蛼蛽蜄蜅蜇蜋蜎蜏蜐蜓蜔蜙蜞蜟蜡蜣\"],[\"8fdba1\",\"蜨蜮蜯蜱蜲蜹蜺蜼蜽蜾蝀蝃蝅蝍蝘蝝蝡蝤蝥蝯蝱蝲蝻螃\",6,\"螋螌螐螓螕螗螘螙螞螠螣螧螬螭螮螱螵螾螿蟁蟈蟉蟊蟎蟕蟖蟙蟚蟜蟟蟢蟣蟤蟪蟫蟭蟱蟳蟸蟺蟿蠁蠃蠆蠉蠊蠋蠐蠙蠒蠓蠔蠘蠚蠛蠜蠞蠟蠨蠭蠮蠰蠲蠵\"],[\"8fdca1\",\"蠺蠼衁衃衅衈衉衊衋衎衑衕衖衘衚衜衟衠衤衩衱衹衻袀袘袚袛袜袟袠袨袪袺袽袾裀裊\",4,\"裑裒裓裛裞裧裯裰裱裵裷褁褆褍褎褏褕褖褘褙褚褜褠褦褧褨褰褱褲褵褹褺褾襀襂襅襆襉襏襒襗襚襛襜襡襢襣襫襮襰襳襵襺\"],[\"8fdda1\",\"襻襼襽覉覍覐覔覕覛覜覟覠覥覰覴覵覶覷覼觔\",4,\"觥觩觫觭觱觳觶觹觽觿訄訅訇訏訑訒訔訕訞訠訢訤訦訫訬訯訵訷訽訾詀詃詅詇詉詍詎詓詖詗詘詜詝詡詥詧詵詶詷詹詺詻詾詿誀誃誆誋誏誐誒誖誗誙誟誧誩誮誯誳\"],[\"8fdea1\",\"誶誷誻誾諃諆諈諉諊諑諓諔諕諗諝諟諬諰諴諵諶諼諿謅謆謋謑謜謞謟謊謭謰謷謼譂\",4,\"譈譒譓譔譙譍譞譣譭譶譸譹譼譾讁讄讅讋讍讏讔讕讜讞讟谸谹谽谾豅豇豉豋豏豑豓豔豗豘豛豝豙豣豤豦豨豩豭豳豵豶豻豾貆\"],[\"8fdfa1\",\"貇貋貐貒貓貙貛貜貤貹貺賅賆賉賋賏賖賕賙賝賡賨賬賯賰賲賵賷賸賾賿贁贃贉贒贗贛赥赩赬赮赿趂趄趈趍趐趑趕趞趟趠趦趫趬趯趲趵趷趹趻跀跅跆跇跈跊跎跑跔跕跗跙跤跥跧跬跰趼跱跲跴跽踁踄踅踆踋踑踔踖踠踡踢\"],[\"8fe0a1\",\"踣踦踧踱踳踶踷踸踹踽蹀蹁蹋蹍蹎蹏蹔蹛蹜蹝蹞蹡蹢蹩蹬蹭蹯蹰蹱蹹蹺蹻躂躃躉躐躒躕躚躛躝躞躢躧躩躭躮躳躵躺躻軀軁軃軄軇軏軑軔軜軨軮軰軱軷軹軺軭輀輂輇輈輏輐輖輗輘輞輠輡輣輥輧輨輬輭輮輴輵輶輷輺轀轁\"],[\"8fe1a1\",\"轃轇轏轑\",4,\"轘轝轞轥辝辠辡辤辥辦辵辶辸达迀迁迆迊迋迍运迒迓迕迠迣迤迨迮迱迵迶迻迾适逄逈逌逘逛逨逩逯逪逬逭逳逴逷逿遃遄遌遛遝遢遦遧遬遰遴遹邅邈邋邌邎邐邕邗邘邙邛邠邡邢邥邰邲邳邴邶邽郌邾郃\"],[\"8fe2a1\",\"郄郅郇郈郕郗郘郙郜郝郟郥郒郶郫郯郰郴郾郿鄀鄄鄅鄆鄈鄍鄐鄔鄖鄗鄘鄚鄜鄞鄠鄥鄢鄣鄧鄩鄮鄯鄱鄴鄶鄷鄹鄺鄼鄽酃酇酈酏酓酗酙酚酛酡酤酧酭酴酹酺酻醁醃醅醆醊醎醑醓醔醕醘醞醡醦醨醬醭醮醰醱醲醳醶醻醼醽醿\"],[\"8fe3a1\",\"釂釃釅釓釔釗釙釚釞釤釥釩釪釬\",5,\"釷釹釻釽鈀鈁鈄鈅鈆鈇鈉鈊鈌鈐鈒鈓鈖鈘鈜鈝鈣鈤鈥鈦鈨鈮鈯鈰鈳鈵鈶鈸鈹鈺鈼鈾鉀鉂鉃鉆鉇鉊鉍鉎鉏鉑鉘鉙鉜鉝鉠鉡鉥鉧鉨鉩鉮鉯鉰鉵\",4,\"鉻鉼鉽鉿銈銉銊銍銎銒銗\"],[\"8fe4a1\",\"銙銟銠銤銥銧銨銫銯銲銶銸銺銻銼銽銿\",4,\"鋅鋆鋇鋈鋋鋌鋍鋎鋐鋓鋕鋗鋘鋙鋜鋝鋟鋠鋡鋣鋥鋧鋨鋬鋮鋰鋹鋻鋿錀錂錈錍錑錔錕錜錝錞錟錡錤錥錧錩錪錳錴錶錷鍇鍈鍉鍐鍑鍒鍕鍗鍘鍚鍞鍤鍥鍧鍩鍪鍭鍯鍰鍱鍳鍴鍶\"],[\"8fe5a1\",\"鍺鍽鍿鎀鎁鎂鎈鎊鎋鎍鎏鎒鎕鎘鎛鎞鎡鎣鎤鎦鎨鎫鎴鎵鎶鎺鎩鏁鏄鏅鏆鏇鏉\",4,\"鏓鏙鏜鏞鏟鏢鏦鏧鏹鏷鏸鏺鏻鏽鐁鐂鐄鐈鐉鐍鐎鐏鐕鐖鐗鐟鐮鐯鐱鐲鐳鐴鐻鐿鐽鑃鑅鑈鑊鑌鑕鑙鑜鑟鑡鑣鑨鑫鑭鑮鑯鑱鑲钄钃镸镹\"],[\"8fe6a1\",\"镾閄閈閌閍閎閝閞閟閡閦閩閫閬閴閶閺閽閿闆闈闉闋闐闑闒闓闙闚闝闞闟闠闤闦阝阞阢阤阥阦阬阱阳阷阸阹阺阼阽陁陒陔陖陗陘陡陮陴陻陼陾陿隁隂隃隄隉隑隖隚隝隟隤隥隦隩隮隯隳隺雊雒嶲雘雚雝雞雟雩雯雱雺霂\"],[\"8fe7a1\",\"霃霅霉霚霛霝霡霢霣霨霱霳靁靃靊靎靏靕靗靘靚靛靣靧靪靮靳靶靷靸靻靽靿鞀鞉鞕鞖鞗鞙鞚鞞鞟鞢鞬鞮鞱鞲鞵鞶鞸鞹鞺鞼鞾鞿韁韄韅韇韉韊韌韍韎韐韑韔韗韘韙韝韞韠韛韡韤韯韱韴韷韸韺頇頊頙頍頎頔頖頜頞頠頣頦\"],[\"8fe8a1\",\"頫頮頯頰頲頳頵頥頾顄顇顊顑顒顓顖顗顙顚顢顣顥顦顪顬颫颭颮颰颴颷颸颺颻颿飂飅飈飌飡飣飥飦飧飪飳飶餂餇餈餑餕餖餗餚餛餜餟餢餦餧餫餱\",4,\"餹餺餻餼饀饁饆饇饈饍饎饔饘饙饛饜饞饟饠馛馝馟馦馰馱馲馵\"],[\"8fe9a1\",\"馹馺馽馿駃駉駓駔駙駚駜駞駧駪駫駬駰駴駵駹駽駾騂騃騄騋騌騐騑騖騞騠騢騣騤騧騭騮騳騵騶騸驇驁驄驊驋驌驎驑驔驖驝骪骬骮骯骲骴骵骶骹骻骾骿髁髃髆髈髎髐髒髕髖髗髛髜髠髤髥髧髩髬髲髳髵髹髺髽髿\",4],[\"8feaa1\",\"鬄鬅鬈鬉鬋鬌鬍鬎鬐鬒鬖鬙鬛鬜鬠鬦鬫鬭鬳鬴鬵鬷鬹鬺鬽魈魋魌魕魖魗魛魞魡魣魥魦魨魪\",4,\"魳魵魷魸魹魿鮀鮄鮅鮆鮇鮉鮊鮋鮍鮏鮐鮔鮚鮝鮞鮦鮧鮩鮬鮰鮱鮲鮷鮸鮻鮼鮾鮿鯁鯇鯈鯎鯐鯗鯘鯝鯟鯥鯧鯪鯫鯯鯳鯷鯸\"],[\"8feba1\",\"鯹鯺鯽鯿鰀鰂鰋鰏鰑鰖鰘鰙鰚鰜鰞鰢鰣鰦\",4,\"鰱鰵鰶鰷鰽鱁鱃鱄鱅鱉鱊鱎鱏鱐鱓鱔鱖鱘鱛鱝鱞鱟鱣鱩鱪鱜鱫鱨鱮鱰鱲鱵鱷鱻鳦鳲鳷鳹鴋鴂鴑鴗鴘鴜鴝鴞鴯鴰鴲鴳鴴鴺鴼鵅鴽鵂鵃鵇鵊鵓鵔鵟鵣鵢鵥鵩鵪鵫鵰鵶鵷鵻\"],[\"8feca1\",\"鵼鵾鶃鶄鶆鶊鶍鶎鶒鶓鶕鶖鶗鶘鶡鶪鶬鶮鶱鶵鶹鶼鶿鷃鷇鷉鷊鷔鷕鷖鷗鷚鷞鷟鷠鷥鷧鷩鷫鷮鷰鷳鷴鷾鸊鸂鸇鸎鸐鸑鸒鸕鸖鸙鸜鸝鹺鹻鹼麀麂麃麄麅麇麎麏麖麘麛麞麤麨麬麮麯麰麳麴麵黆黈黋黕黟黤黧黬黭黮黰黱黲黵\"],[\"8feda1\",\"黸黿鼂鼃鼉鼏鼐鼑鼒鼔鼖鼗鼙鼚鼛鼟鼢鼦鼪鼫鼯鼱鼲鼴鼷鼹鼺鼼鼽鼿齁齃\",4,\"齓齕齖齗齘齚齝齞齨齩齭\",4,\"齳齵齺齽龏龐龑龒龔龖龗龞龡龢龣龥\"]]");
})), vm = /* @__PURE__ */ i({ default: () => ym }), ym, bm = n((() => {
	ym = /*#__PURE__*/ JSON.parse("[[\"0\",\"\\u0000\",127,\"€\"],[\"8140\",\"丂丄丅丆丏丒丗丟丠両丣並丩丮丯丱丳丵丷丼乀乁乂乄乆乊乑乕乗乚乛乢乣乤乥乧乨乪\",5,\"乲乴\",9,\"乿\",6,\"亇亊\"],[\"8180\",\"亐亖亗亙亜亝亞亣亪亯亰亱亴亶亷亸亹亼亽亾仈仌仏仐仒仚仛仜仠仢仦仧仩仭仮仯仱仴仸仹仺仼仾伀伂\",6,\"伋伌伒\",4,\"伜伝伡伣伨伩伬伭伮伱伳伵伷伹伻伾\",4,\"佄佅佇\",5,\"佒佔佖佡佢佦佨佪佫佭佮佱佲併佷佸佹佺佽侀侁侂侅來侇侊侌侎侐侒侓侕侖侘侙侚侜侞侟価侢\"],[\"8240\",\"侤侫侭侰\",4,\"侶\",8,\"俀俁係俆俇俈俉俋俌俍俒\",4,\"俙俛俠俢俤俥俧俫俬俰俲俴俵俶俷俹俻俼俽俿\",11],[\"8280\",\"個倎倐們倓倕倖倗倛倝倞倠倢倣値倧倫倯\",10,\"倻倽倿偀偁偂偄偅偆偉偊偋偍偐\",4,\"偖偗偘偙偛偝\",7,\"偦\",5,\"偭\",8,\"偸偹偺偼偽傁傂傃傄傆傇傉傊傋傌傎\",20,\"傤傦傪傫傭\",4,\"傳\",6,\"傼\"],[\"8340\",\"傽\",17,\"僐\",5,\"僗僘僙僛\",10,\"僨僩僪僫僯僰僱僲僴僶\",4,\"僼\",9,\"儈\"],[\"8380\",\"儉儊儌\",5,\"儓\",13,\"儢\",28,\"兂兇兊兌兎兏児兒兓兗兘兙兛兝\",4,\"兣兤兦內兩兪兯兲兺兾兿冃冄円冇冊冋冎冏冐冑冓冔冘冚冝冞冟冡冣冦\",4,\"冭冮冴冸冹冺冾冿凁凂凃凅凈凊凍凎凐凒\",5],[\"8440\",\"凘凙凚凜凞凟凢凣凥\",5,\"凬凮凱凲凴凷凾刄刅刉刋刌刏刐刓刔刕刜刞刟刡刢刣別刦刧刪刬刯刱刲刴刵刼刾剄\",5,\"剋剎剏剒剓剕剗剘\"],[\"8480\",\"剙剚剛剝剟剠剢剣剤剦剨剫剬剭剮剰剱剳\",9,\"剾劀劃\",4,\"劉\",6,\"劑劒劔\",6,\"劜劤劥劦劧劮劯劰労\",9,\"勀勁勂勄勅勆勈勊勌勍勎勏勑勓勔動勗務\",5,\"勠勡勢勣勥\",10,\"勱\",7,\"勻勼勽匁匂匃匄匇匉匊匋匌匎\"],[\"8540\",\"匑匒匓匔匘匛匜匞匟匢匤匥匧匨匩匫匬匭匯\",9,\"匼匽區卂卄卆卋卌卍卐協単卙卛卝卥卨卪卬卭卲卶卹卻卼卽卾厀厁厃厇厈厊厎厏\"],[\"8580\",\"厐\",4,\"厖厗厙厛厜厞厠厡厤厧厪厫厬厭厯\",6,\"厷厸厹厺厼厽厾叀參\",4,\"収叏叐叒叓叕叚叜叝叞叡叢叧叴叺叾叿吀吂吅吇吋吔吘吙吚吜吢吤吥吪吰吳吶吷吺吽吿呁呂呄呅呇呉呌呍呎呏呑呚呝\",4,\"呣呥呧呩\",7,\"呴呹呺呾呿咁咃咅咇咈咉咊咍咑咓咗咘咜咞咟咠咡\"],[\"8640\",\"咢咥咮咰咲咵咶咷咹咺咼咾哃哅哊哋哖哘哛哠\",4,\"哫哬哯哰哱哴\",5,\"哻哾唀唂唃唄唅唈唊\",4,\"唒唓唕\",5,\"唜唝唞唟唡唥唦\"],[\"8680\",\"唨唩唫唭唲唴唵唶唸唹唺唻唽啀啂啅啇啈啋\",4,\"啑啒啓啔啗\",4,\"啝啞啟啠啢啣啨啩啫啯\",5,\"啹啺啽啿喅喆喌喍喎喐喒喓喕喖喗喚喛喞喠\",6,\"喨\",8,\"喲喴営喸喺喼喿\",4,\"嗆嗇嗈嗊嗋嗎嗏嗐嗕嗗\",4,\"嗞嗠嗢嗧嗩嗭嗮嗰嗱嗴嗶嗸\",4,\"嗿嘂嘃嘄嘅\"],[\"8740\",\"嘆嘇嘊嘋嘍嘐\",7,\"嘙嘚嘜嘝嘠嘡嘢嘥嘦嘨嘩嘪嘫嘮嘯嘰嘳嘵嘷嘸嘺嘼嘽嘾噀\",11,\"噏\",4,\"噕噖噚噛噝\",4],[\"8780\",\"噣噥噦噧噭噮噯噰噲噳噴噵噷噸噹噺噽\",7,\"嚇\",6,\"嚐嚑嚒嚔\",14,\"嚤\",10,\"嚰\",6,\"嚸嚹嚺嚻嚽\",12,\"囋\",8,\"囕囖囘囙囜団囥\",5,\"囬囮囯囲図囶囷囸囻囼圀圁圂圅圇國\",6],[\"8840\",\"園\",9,\"圝圞圠圡圢圤圥圦圧圫圱圲圴\",4,\"圼圽圿坁坃坄坅坆坈坉坋坒\",4,\"坘坙坢坣坥坧坬坮坰坱坲坴坵坸坹坺坽坾坿垀\"],[\"8880\",\"垁垇垈垉垊垍\",4,\"垔\",6,\"垜垝垞垟垥垨垪垬垯垰垱垳垵垶垷垹\",8,\"埄\",6,\"埌埍埐埑埓埖埗埛埜埞埡埢埣埥\",7,\"埮埰埱埲埳埵埶執埻埼埾埿堁堃堄堅堈堉堊堌堎堏堐堒堓堔堖堗堘堚堛堜堝堟堢堣堥\",4,\"堫\",4,\"報堲堳場堶\",7],[\"8940\",\"堾\",5,\"塅\",6,\"塎塏塐塒塓塕塖塗塙\",4,\"塟\",5,\"塦\",4,\"塭\",16,\"塿墂墄墆墇墈墊墋墌\"],[\"8980\",\"墍\",4,\"墔\",4,\"墛墜墝墠\",7,\"墪\",17,\"墽墾墿壀壂壃壄壆\",10,\"壒壓壔壖\",13,\"壥\",5,\"壭壯壱売壴壵壷壸壺\",7,\"夃夅夆夈\",4,\"夎夐夑夒夓夗夘夛夝夞夠夡夢夣夦夨夬夰夲夳夵夶夻\"],[\"8a40\",\"夽夾夿奀奃奅奆奊奌奍奐奒奓奙奛\",4,\"奡奣奤奦\",12,\"奵奷奺奻奼奾奿妀妅妉妋妌妎妏妐妑妔妕妘妚妛妜妝妟妠妡妢妦\"],[\"8a80\",\"妧妬妭妰妱妳\",5,\"妺妼妽妿\",6,\"姇姈姉姌姍姎姏姕姖姙姛姞\",4,\"姤姦姧姩姪姫姭\",11,\"姺姼姽姾娀娂娊娋娍娎娏娐娒娔娕娖娗娙娚娛娝娞娡娢娤娦娧娨娪\",6,\"娳娵娷\",4,\"娽娾娿婁\",4,\"婇婈婋\",9,\"婖婗婘婙婛\",5],[\"8b40\",\"婡婣婤婥婦婨婩婫\",8,\"婸婹婻婼婽婾媀\",17,\"媓\",6,\"媜\",13,\"媫媬\"],[\"8b80\",\"媭\",4,\"媴媶媷媹\",4,\"媿嫀嫃\",5,\"嫊嫋嫍\",4,\"嫓嫕嫗嫙嫚嫛嫝嫞嫟嫢嫤嫥嫧嫨嫪嫬\",4,\"嫲\",22,\"嬊\",11,\"嬘\",25,\"嬳嬵嬶嬸\",7,\"孁\",6],[\"8c40\",\"孈\",7,\"孒孖孞孠孡孧孨孫孭孮孯孲孴孶孷學孹孻孼孾孿宂宆宊宍宎宐宑宒宔宖実宧宨宩宬宭宮宯宱宲宷宺宻宼寀寁寃寈寉寊寋寍寎寏\"],[\"8c80\",\"寑寔\",8,\"寠寢寣實寧審\",4,\"寯寱\",6,\"寽対尀専尃尅將專尋尌對導尐尒尓尗尙尛尞尟尠尡尣尦尨尩尪尫尭尮尯尰尲尳尵尶尷屃屄屆屇屌屍屒屓屔屖屗屘屚屛屜屝屟屢層屧\",6,\"屰屲\",6,\"屻屼屽屾岀岃\",4,\"岉岊岋岎岏岒岓岕岝\",4,\"岤\",4],[\"8d40\",\"岪岮岯岰岲岴岶岹岺岻岼岾峀峂峃峅\",5,\"峌\",5,\"峓\",5,\"峚\",6,\"峢峣峧峩峫峬峮峯峱\",9,\"峼\",4],[\"8d80\",\"崁崄崅崈\",5,\"崏\",4,\"崕崗崘崙崚崜崝崟\",4,\"崥崨崪崫崬崯\",4,\"崵\",7,\"崿\",7,\"嵈嵉嵍\",10,\"嵙嵚嵜嵞\",10,\"嵪嵭嵮嵰嵱嵲嵳嵵\",12,\"嶃\",21,\"嶚嶛嶜嶞嶟嶠\"],[\"8e40\",\"嶡\",21,\"嶸\",12,\"巆\",6,\"巎\",12,\"巜巟巠巣巤巪巬巭\"],[\"8e80\",\"巰巵巶巸\",4,\"巿帀帄帇帉帊帋帍帎帒帓帗帞\",7,\"帨\",4,\"帯帰帲\",4,\"帹帺帾帿幀幁幃幆\",5,\"幍\",6,\"幖\",4,\"幜幝幟幠幣\",14,\"幵幷幹幾庁庂広庅庈庉庌庍庎庒庘庛庝庡庢庣庤庨\",4,\"庮\",4,\"庴庺庻庼庽庿\",6],[\"8f40\",\"廆廇廈廋\",5,\"廔廕廗廘廙廚廜\",11,\"廩廫\",8,\"廵廸廹廻廼廽弅弆弇弉弌弍弎弐弒弔弖弙弚弜弝弞弡弢弣弤\"],[\"8f80\",\"弨弫弬弮弰弲\",6,\"弻弽弾弿彁\",14,\"彑彔彙彚彛彜彞彟彠彣彥彧彨彫彮彯彲彴彵彶彸彺彽彾彿徃徆徍徎徏徑従徔徖徚徛徝從徟徠徢\",5,\"復徫徬徯\",5,\"徶徸徹徺徻徾\",4,\"忇忈忊忋忎忓忔忕忚忛応忞忟忢忣忥忦忨忩忬忯忰忲忳忴忶忷忹忺忼怇\"],[\"9040\",\"怈怉怋怌怐怑怓怗怘怚怞怟怢怣怤怬怭怮怰\",4,\"怶\",4,\"怽怾恀恄\",6,\"恌恎恏恑恓恔恖恗恘恛恜恞恟恠恡恥恦恮恱恲恴恵恷恾悀\"],[\"9080\",\"悁悂悅悆悇悈悊悋悎悏悐悑悓悕悗悘悙悜悞悡悢悤悥悧悩悪悮悰悳悵悶悷悹悺悽\",7,\"惇惈惉惌\",4,\"惒惓惔惖惗惙惛惞惡\",4,\"惪惱惲惵惷惸惻\",4,\"愂愃愄愅愇愊愋愌愐\",4,\"愖愗愘愙愛愜愝愞愡愢愥愨愩愪愬\",18,\"慀\",6],[\"9140\",\"慇慉態慍慏慐慒慓慔慖\",6,\"慞慟慠慡慣慤慥慦慩\",6,\"慱慲慳慴慶慸\",18,\"憌憍憏\",4,\"憕\"],[\"9180\",\"憖\",6,\"憞\",8,\"憪憫憭\",9,\"憸\",5,\"憿懀懁懃\",4,\"應懌\",4,\"懓懕\",16,\"懧\",13,\"懶\",8,\"戀\",5,\"戇戉戓戔戙戜戝戞戠戣戦戧戨戩戫戭戯戰戱戲戵戶戸\",4,\"扂扄扅扆扊\"],[\"9240\",\"扏扐払扖扗扙扚扜\",6,\"扤扥扨扱扲扴扵扷扸扺扻扽抁抂抃抅抆抇抈抋\",5,\"抔抙抜抝択抣抦抧抩抪抭抮抯抰抲抳抴抶抷抸抺抾拀拁\"],[\"9280\",\"拃拋拏拑拕拝拞拠拡拤拪拫拰拲拵拸拹拺拻挀挃挄挅挆挊挋挌挍挏挐挒挓挔挕挗挘挙挜挦挧挩挬挭挮挰挱挳\",5,\"挻挼挾挿捀捁捄捇捈捊捑捒捓捔捖\",7,\"捠捤捥捦捨捪捫捬捯捰捲捳捴捵捸捹捼捽捾捿掁掃掄掅掆掋掍掑掓掔掕掗掙\",6,\"採掤掦掫掯掱掲掵掶掹掻掽掿揀\"],[\"9340\",\"揁揂揃揅揇揈揊揋揌揑揓揔揕揗\",6,\"揟揢揤\",4,\"揫揬揮揯揰揱揳揵揷揹揺揻揼揾搃搄搆\",4,\"損搎搑搒搕\",5,\"搝搟搢搣搤\"],[\"9380\",\"搥搧搨搩搫搮\",5,\"搵\",4,\"搻搼搾摀摂摃摉摋\",6,\"摓摕摖摗摙\",4,\"摟\",7,\"摨摪摫摬摮\",9,\"摻\",6,\"撃撆撈\",8,\"撓撔撗撘撚撛撜撝撟\",4,\"撥撦撧撨撪撫撯撱撲撳撴撶撹撻撽撾撿擁擃擄擆\",6,\"擏擑擓擔擕擖擙據\"],[\"9440\",\"擛擜擝擟擠擡擣擥擧\",24,\"攁\",7,\"攊\",7,\"攓\",4,\"攙\",8],[\"9480\",\"攢攣攤攦\",4,\"攬攭攰攱攲攳攷攺攼攽敀\",4,\"敆敇敊敋敍敎敐敒敓敔敗敘敚敜敟敠敡敤敥敧敨敩敪敭敮敯敱敳敵敶數\",14,\"斈斉斊斍斎斏斒斔斕斖斘斚斝斞斠斢斣斦斨斪斬斮斱\",7,\"斺斻斾斿旀旂旇旈旉旊旍旐旑旓旔旕旘\",7,\"旡旣旤旪旫\"],[\"9540\",\"旲旳旴旵旸旹旻\",4,\"昁昄昅昇昈昉昋昍昐昑昒昖昗昘昚昛昜昞昡昢昣昤昦昩昪昫昬昮昰昲昳昷\",4,\"昽昿晀時晄\",6,\"晍晎晐晑晘\"],[\"9580\",\"晙晛晜晝晞晠晢晣晥晧晩\",4,\"晱晲晳晵晸晹晻晼晽晿暀暁暃暅暆暈暉暊暋暍暎暏暐暒暓暔暕暘\",4,\"暞\",8,\"暩\",4,\"暯\",4,\"暵暶暷暸暺暻暼暽暿\",25,\"曚曞\",7,\"曧曨曪\",5,\"曱曵曶書曺曻曽朁朂會\"],[\"9640\",\"朄朅朆朇朌朎朏朑朒朓朖朘朙朚朜朞朠\",5,\"朧朩朮朰朲朳朶朷朸朹朻朼朾朿杁杄杅杇杊杋杍杒杔杕杗\",4,\"杝杢杣杤杦杧杫杬杮東杴杶\"],[\"9680\",\"杸杹杺杻杽枀枂枃枅枆枈枊枌枍枎枏枑枒枓枔枖枙枛枟枠枡枤枦枩枬枮枱枲枴枹\",7,\"柂柅\",9,\"柕柖柗柛柟柡柣柤柦柧柨柪柫柭柮柲柵\",7,\"柾栁栂栃栄栆栍栐栒栔栕栘\",4,\"栞栟栠栢\",6,\"栫\",6,\"栴栵栶栺栻栿桇桋桍桏桒桖\",5],[\"9740\",\"桜桝桞桟桪桬\",7,\"桵桸\",8,\"梂梄梇\",7,\"梐梑梒梔梕梖梘\",9,\"梣梤梥梩梪梫梬梮梱梲梴梶梷梸\"],[\"9780\",\"梹\",6,\"棁棃\",5,\"棊棌棎棏棐棑棓棔棖棗棙棛\",4,\"棡棢棤\",9,\"棯棲棳棴棶棷棸棻棽棾棿椀椂椃椄椆\",4,\"椌椏椑椓\",11,\"椡椢椣椥\",7,\"椮椯椱椲椳椵椶椷椸椺椻椼椾楀楁楃\",16,\"楕楖楘楙楛楜楟\"],[\"9840\",\"楡楢楤楥楧楨楩楪楬業楯楰楲\",4,\"楺楻楽楾楿榁榃榅榊榋榌榎\",5,\"榖榗榙榚榝\",9,\"榩榪榬榮榯榰榲榳榵榶榸榹榺榼榽\"],[\"9880\",\"榾榿槀槂\",7,\"構槍槏槑槒槓槕\",5,\"槜槝槞槡\",11,\"槮槯槰槱槳\",9,\"槾樀\",9,\"樋\",11,\"標\",5,\"樠樢\",5,\"権樫樬樭樮樰樲樳樴樶\",6,\"樿\",4,\"橅橆橈\",7,\"橑\",6,\"橚\"],[\"9940\",\"橜\",4,\"橢橣橤橦\",10,\"橲\",6,\"橺橻橽橾橿檁檂檃檅\",8,\"檏檒\",4,\"檘\",7,\"檡\",5],[\"9980\",\"檧檨檪檭\",114,\"欥欦欨\",6],[\"9a40\",\"欯欰欱欳欴欵欶欸欻欼欽欿歀歁歂歄歅歈歊歋歍\",11,\"歚\",7,\"歨歩歫\",13,\"歺歽歾歿殀殅殈\"],[\"9a80\",\"殌殎殏殐殑殔殕殗殘殙殜\",4,\"殢\",7,\"殫\",7,\"殶殸\",6,\"毀毃毄毆\",4,\"毌毎毐毑毘毚毜\",4,\"毢\",7,\"毬毭毮毰毱毲毴毶毷毸毺毻毼毾\",6,\"氈\",4,\"氎氒気氜氝氞氠氣氥氫氬氭氱氳氶氷氹氺氻氼氾氿汃汄汅汈汋\",4,\"汑汒汓汖汘\"],[\"9b40\",\"汙汚汢汣汥汦汧汫\",4,\"汱汳汵汷汸決汻汼汿沀沄沇沊沋沍沎沑沒沕沖沗沘沚沜沝沞沠沢沨沬沯沰沴沵沶沷沺泀況泂泃泆泇泈泋泍泎泏泑泒泘\"],[\"9b80\",\"泙泚泜泝泟泤泦泧泩泬泭泲泴泹泿洀洂洃洅洆洈洉洊洍洏洐洑洓洔洕洖洘洜洝洟\",5,\"洦洨洩洬洭洯洰洴洶洷洸洺洿浀浂浄浉浌浐浕浖浗浘浛浝浟浡浢浤浥浧浨浫浬浭浰浱浲浳浵浶浹浺浻浽\",4,\"涃涄涆涇涊涋涍涏涐涒涖\",4,\"涜涢涥涬涭涰涱涳涴涶涷涹\",5,\"淁淂淃淈淉淊\"],[\"9c40\",\"淍淎淏淐淒淓淔淕淗淚淛淜淟淢淣淥淧淨淩淪淭淯淰淲淴淵淶淸淺淽\",7,\"渆渇済渉渋渏渒渓渕渘渙減渜渞渟渢渦渧渨渪測渮渰渱渳渵\"],[\"9c80\",\"渶渷渹渻\",7,\"湅\",7,\"湏湐湑湒湕湗湙湚湜湝湞湠\",10,\"湬湭湯\",14,\"満溁溂溄溇溈溊\",4,\"溑\",6,\"溙溚溛溝溞溠溡溣溤溦溨溩溫溬溭溮溰溳溵溸溹溼溾溿滀滃滄滅滆滈滉滊滌滍滎滐滒滖滘滙滛滜滝滣滧滪\",5],[\"9d40\",\"滰滱滲滳滵滶滷滸滺\",7,\"漃漄漅漇漈漊\",4,\"漐漑漒漖\",9,\"漡漢漣漥漦漧漨漬漮漰漲漴漵漷\",6,\"漿潀潁潂\"],[\"9d80\",\"潃潄潅潈潉潊潌潎\",9,\"潙潚潛潝潟潠潡潣潤潥潧\",5,\"潯潰潱潳潵潶潷潹潻潽\",6,\"澅澆澇澊澋澏\",12,\"澝澞澟澠澢\",4,\"澨\",10,\"澴澵澷澸澺\",5,\"濁濃\",5,\"濊\",6,\"濓\",10,\"濟濢濣濤濥\"],[\"9e40\",\"濦\",7,\"濰\",32,\"瀒\",7,\"瀜\",6,\"瀤\",6],[\"9e80\",\"瀫\",9,\"瀶瀷瀸瀺\",17,\"灍灎灐\",13,\"灟\",11,\"灮灱灲灳灴灷灹灺灻災炁炂炃炄炆炇炈炋炌炍炏炐炑炓炗炘炚炛炞\",12,\"炰炲炴炵炶為炾炿烄烅烆烇烉烋\",12,\"烚\"],[\"9f40\",\"烜烝烞烠烡烢烣烥烪烮烰\",6,\"烸烺烻烼烾\",10,\"焋\",4,\"焑焒焔焗焛\",10,\"焧\",7,\"焲焳焴\"],[\"9f80\",\"焵焷\",13,\"煆煇煈煉煋煍煏\",12,\"煝煟\",4,\"煥煩\",4,\"煯煰煱煴煵煶煷煹煻煼煾\",5,\"熅\",4,\"熋熌熍熎熐熑熒熓熕熖熗熚\",4,\"熡\",6,\"熩熪熫熭\",5,\"熴熶熷熸熺\",8,\"燄\",9,\"燏\",4],[\"a040\",\"燖\",9,\"燡燢燣燤燦燨\",5,\"燯\",9,\"燺\",11,\"爇\",19],[\"a080\",\"爛爜爞\",9,\"爩爫爭爮爯爲爳爴爺爼爾牀\",6,\"牉牊牋牎牏牐牑牓牔牕牗牘牚牜牞牠牣牤牥牨牪牫牬牭牰牱牳牴牶牷牸牻牼牽犂犃犅\",4,\"犌犎犐犑犓\",11,\"犠\",11,\"犮犱犲犳犵犺\",6,\"狅狆狇狉狊狋狌狏狑狓狔狕狖狘狚狛\"],[\"a1a1\",\"　、。·ˉˇ¨〃々—～‖…‘’“”〔〕〈\",7,\"〖〗【】±×÷∶∧∨∑∏∪∩∈∷√⊥∥∠⌒⊙∫∮≡≌≈∽∝≠≮≯≤≥∞∵∴♂♀°′″℃＄¤￠￡‰§№☆★○●◎◇◆□■△▲※→←↑↓〓\"],[\"a2a1\",\"ⅰ\",9],[\"a2b1\",\"⒈\",19,\"⑴\",19,\"①\",9],[\"a2e5\",\"㈠\",9],[\"a2f1\",\"Ⅰ\",11],[\"a3a1\",\"！＂＃￥％\",88,\"￣\"],[\"a4a1\",\"ぁ\",82],[\"a5a1\",\"ァ\",85],[\"a6a1\",\"Α\",16,\"Σ\",6],[\"a6c1\",\"α\",16,\"σ\",6],[\"a6e0\",\"︵︶︹︺︿﹀︽︾﹁﹂﹃﹄\"],[\"a6ee\",\"︻︼︷︸︱\"],[\"a6f4\",\"︳︴\"],[\"a7a1\",\"А\",5,\"ЁЖ\",25],[\"a7d1\",\"а\",5,\"ёж\",25],[\"a840\",\"ˊˋ˙–―‥‵℅℉↖↗↘↙∕∟∣≒≦≧⊿═\",35,\"▁\",6],[\"a880\",\"█\",7,\"▓▔▕▼▽◢◣◤◥☉⊕〒〝〞\"],[\"a8a1\",\"āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüêɑ\"],[\"a8bd\",\"ńň\"],[\"a8c0\",\"ɡ\"],[\"a8c5\",\"ㄅ\",36],[\"a940\",\"〡\",8,\"㊣㎎㎏㎜㎝㎞㎡㏄㏎㏑㏒㏕︰￢￤\"],[\"a959\",\"℡㈱\"],[\"a95c\",\"‐\"],[\"a960\",\"ー゛゜ヽヾ〆ゝゞ﹉\",9,\"﹔﹕﹖﹗﹙\",8],[\"a980\",\"﹢\",4,\"﹨﹩﹪﹫\"],[\"a996\",\"〇\"],[\"a9a4\",\"─\",75],[\"aa40\",\"狜狝狟狢\",5,\"狪狫狵狶狹狽狾狿猀猂猄\",5,\"猋猌猍猏猐猑猒猔猘猙猚猟猠猣猤猦猧猨猭猯猰猲猳猵猶猺猻猼猽獀\",8],[\"aa80\",\"獉獊獋獌獎獏獑獓獔獕獖獘\",7,\"獡\",10,\"獮獰獱\"],[\"ab40\",\"獲\",11,\"獿\",4,\"玅玆玈玊玌玍玏玐玒玓玔玕玗玘玙玚玜玝玞玠玡玣\",5,\"玪玬玭玱玴玵玶玸玹玼玽玾玿珁珃\",4],[\"ab80\",\"珋珌珎珒\",6,\"珚珛珜珝珟珡珢珣珤珦珨珪珫珬珮珯珰珱珳\",4],[\"ac40\",\"珸\",10,\"琄琇琈琋琌琍琎琑\",8,\"琜\",5,\"琣琤琧琩琫琭琯琱琲琷\",4,\"琽琾琿瑀瑂\",11],[\"ac80\",\"瑎\",6,\"瑖瑘瑝瑠\",12,\"瑮瑯瑱\",4,\"瑸瑹瑺\"],[\"ad40\",\"瑻瑼瑽瑿璂璄璅璆璈璉璊璌璍璏璑\",10,\"璝璟\",7,\"璪\",15,\"璻\",12],[\"ad80\",\"瓈\",9,\"瓓\",8,\"瓝瓟瓡瓥瓧\",6,\"瓰瓱瓲\"],[\"ae40\",\"瓳瓵瓸\",6,\"甀甁甂甃甅\",7,\"甎甐甒甔甕甖甗甛甝甞甠\",4,\"甦甧甪甮甴甶甹甼甽甿畁畂畃畄畆畇畉畊畍畐畑畒畓畕畖畗畘\"],[\"ae80\",\"畝\",7,\"畧畨畩畫\",6,\"畳畵當畷畺\",4,\"疀疁疂疄疅疇\"],[\"af40\",\"疈疉疊疌疍疎疐疓疕疘疛疜疞疢疦\",4,\"疭疶疷疺疻疿痀痁痆痋痌痎痏痐痑痓痗痙痚痜痝痟痠痡痥痩痬痭痮痯痲痳痵痶痷痸痺痻痽痾瘂瘄瘆瘇\"],[\"af80\",\"瘈瘉瘋瘍瘎瘏瘑瘒瘓瘔瘖瘚瘜瘝瘞瘡瘣瘧瘨瘬瘮瘯瘱瘲瘶瘷瘹瘺瘻瘽癁療癄\"],[\"b040\",\"癅\",6,\"癎\",5,\"癕癗\",4,\"癝癟癠癡癢癤\",6,\"癬癭癮癰\",7,\"癹発發癿皀皁皃皅皉皊皌皍皏皐皒皔皕皗皘皚皛\"],[\"b080\",\"皜\",7,\"皥\",8,\"皯皰皳皵\",9,\"盀盁盃啊阿埃挨哎唉哀皑癌蔼矮艾碍爱隘鞍氨安俺按暗岸胺案肮昂盎凹敖熬翱袄傲奥懊澳芭捌扒叭吧笆八疤巴拔跋靶把耙坝霸罢爸白柏百摆佰败拜稗斑班搬扳般颁板版扮拌伴瓣半办绊邦帮梆榜膀绑棒磅蚌镑傍谤苞胞包褒剥\"],[\"b140\",\"盄盇盉盋盌盓盕盙盚盜盝盞盠\",4,\"盦\",7,\"盰盳盵盶盷盺盻盽盿眀眂眃眅眆眊県眎\",10,\"眛眜眝眞眡眣眤眥眧眪眫\"],[\"b180\",\"眬眮眰\",4,\"眹眻眽眾眿睂睄睅睆睈\",7,\"睒\",7,\"睜薄雹保堡饱宝抱报暴豹鲍爆杯碑悲卑北辈背贝钡倍狈备惫焙被奔苯本笨崩绷甭泵蹦迸逼鼻比鄙笔彼碧蓖蔽毕毙毖币庇痹闭敝弊必辟壁臂避陛鞭边编贬扁便变卞辨辩辫遍标彪膘表鳖憋别瘪彬斌濒滨宾摈兵冰柄丙秉饼炳\"],[\"b240\",\"睝睞睟睠睤睧睩睪睭\",11,\"睺睻睼瞁瞂瞃瞆\",5,\"瞏瞐瞓\",11,\"瞡瞣瞤瞦瞨瞫瞭瞮瞯瞱瞲瞴瞶\",4],[\"b280\",\"瞼瞾矀\",12,\"矎\",8,\"矘矙矚矝\",4,\"矤病并玻菠播拨钵波博勃搏铂箔伯帛舶脖膊渤泊驳捕卜哺补埠不布步簿部怖擦猜裁材才财睬踩采彩菜蔡餐参蚕残惭惨灿苍舱仓沧藏操糙槽曹草厕策侧册测层蹭插叉茬茶查碴搽察岔差诧拆柴豺搀掺蝉馋谗缠铲产阐颤昌猖\"],[\"b340\",\"矦矨矪矯矰矱矲矴矵矷矹矺矻矼砃\",5,\"砊砋砎砏砐砓砕砙砛砞砠砡砢砤砨砪砫砮砯砱砲砳砵砶砽砿硁硂硃硄硆硈硉硊硋硍硏硑硓硔硘硙硚\"],[\"b380\",\"硛硜硞\",11,\"硯\",7,\"硸硹硺硻硽\",6,\"场尝常长偿肠厂敞畅唱倡超抄钞朝嘲潮巢吵炒车扯撤掣彻澈郴臣辰尘晨忱沉陈趁衬撑称城橙成呈乘程惩澄诚承逞骋秤吃痴持匙池迟弛驰耻齿侈尺赤翅斥炽充冲虫崇宠抽酬畴踌稠愁筹仇绸瞅丑臭初出橱厨躇锄雏滁除楚\"],[\"b440\",\"碄碅碆碈碊碋碏碐碒碔碕碖碙碝碞碠碢碤碦碨\",7,\"碵碶碷碸確碻碼碽碿磀磂磃磄磆磇磈磌磍磎磏磑磒磓磖磗磘磚\",9],[\"b480\",\"磤磥磦磧磩磪磫磭\",4,\"磳磵磶磸磹磻\",5,\"礂礃礄礆\",6,\"础储矗搐触处揣川穿椽传船喘串疮窗幢床闯创吹炊捶锤垂春椿醇唇淳纯蠢戳绰疵茨磁雌辞慈瓷词此刺赐次聪葱囱匆从丛凑粗醋簇促蹿篡窜摧崔催脆瘁粹淬翠村存寸磋撮搓措挫错搭达答瘩打大呆歹傣戴带殆代贷袋待逮\"],[\"b540\",\"礍\",5,\"礔\",9,\"礟\",4,\"礥\",14,\"礵\",4,\"礽礿祂祃祄祅祇祊\",8,\"祔祕祘祙祡祣\"],[\"b580\",\"祤祦祩祪祫祬祮祰\",6,\"祹祻\",4,\"禂禃禆禇禈禉禋禌禍禎禐禑禒怠耽担丹单郸掸胆旦氮但惮淡诞弹蛋当挡党荡档刀捣蹈倒岛祷导到稻悼道盗德得的蹬灯登等瞪凳邓堤低滴迪敌笛狄涤翟嫡抵底地蒂第帝弟递缔颠掂滇碘点典靛垫电佃甸店惦奠淀殿碉叼雕凋刁掉吊钓调跌爹碟蝶迭谍叠\"],[\"b640\",\"禓\",6,\"禛\",11,\"禨\",10,\"禴\",4,\"禼禿秂秄秅秇秈秊秌秎秏秐秓秔秖秗秙\",5,\"秠秡秢秥秨秪\"],[\"b680\",\"秬秮秱\",6,\"秹秺秼秾秿稁稄稅稇稈稉稊稌稏\",4,\"稕稖稘稙稛稜丁盯叮钉顶鼎锭定订丢东冬董懂动栋侗恫冻洞兜抖斗陡豆逗痘都督毒犊独读堵睹赌杜镀肚度渡妒端短锻段断缎堆兑队对墩吨蹲敦顿囤钝盾遁掇哆多夺垛躲朵跺舵剁惰堕蛾峨鹅俄额讹娥恶厄扼遏鄂饿恩而儿耳尔饵洱二\"],[\"b740\",\"稝稟稡稢稤\",14,\"稴稵稶稸稺稾穀\",5,\"穇\",9,\"穒\",4,\"穘\",16],[\"b780\",\"穩\",6,\"穱穲穳穵穻穼穽穾窂窅窇窉窊窋窌窎窏窐窓窔窙窚窛窞窡窢贰发罚筏伐乏阀法珐藩帆番翻樊矾钒繁凡烦反返范贩犯饭泛坊芳方肪房防妨仿访纺放菲非啡飞肥匪诽吠肺废沸费芬酚吩氛分纷坟焚汾粉奋份忿愤粪丰封枫蜂峰锋风疯烽逢冯缝讽奉凤佛否夫敷肤孵扶拂辐幅氟符伏俘服\"],[\"b840\",\"窣窤窧窩窪窫窮\",4,\"窴\",10,\"竀\",10,\"竌\",9,\"竗竘竚竛竜竝竡竢竤竧\",5,\"竮竰竱竲竳\"],[\"b880\",\"竴\",4,\"竻竼竾笀笁笂笅笇笉笌笍笎笐笒笓笖笗笘笚笜笝笟笡笢笣笧笩笭浮涪福袱弗甫抚辅俯釜斧脯腑府腐赴副覆赋复傅付阜父腹负富讣附妇缚咐噶嘎该改概钙盖溉干甘杆柑竿肝赶感秆敢赣冈刚钢缸肛纲岗港杠篙皋高膏羔糕搞镐稿告哥歌搁戈鸽胳疙割革葛格蛤阁隔铬个各给根跟耕更庚羹\"],[\"b940\",\"笯笰笲笴笵笶笷笹笻笽笿\",5,\"筆筈筊筍筎筓筕筗筙筜筞筟筡筣\",10,\"筯筰筳筴筶筸筺筼筽筿箁箂箃箄箆\",6,\"箎箏\"],[\"b980\",\"箑箒箓箖箘箙箚箛箞箟箠箣箤箥箮箯箰箲箳箵箶箷箹\",7,\"篂篃範埂耿梗工攻功恭龚供躬公宫弓巩汞拱贡共钩勾沟苟狗垢构购够辜菇咕箍估沽孤姑鼓古蛊骨谷股故顾固雇刮瓜剐寡挂褂乖拐怪棺关官冠观管馆罐惯灌贯光广逛瑰规圭硅归龟闺轨鬼诡癸桂柜跪贵刽辊滚棍锅郭国果裹过哈\"],[\"ba40\",\"篅篈築篊篋篍篎篏篐篒篔\",4,\"篛篜篞篟篠篢篣篤篧篨篩篫篬篭篯篰篲\",4,\"篸篹篺篻篽篿\",7,\"簈簉簊簍簎簐\",5,\"簗簘簙\"],[\"ba80\",\"簚\",4,\"簠\",5,\"簨簩簫\",12,\"簹\",5,\"籂骸孩海氦亥害骇酣憨邯韩含涵寒函喊罕翰撼捍旱憾悍焊汗汉夯杭航壕嚎豪毫郝好耗号浩呵喝荷菏核禾和何合盒貉阂河涸赫褐鹤贺嘿黑痕很狠恨哼亨横衡恒轰哄烘虹鸿洪宏弘红喉侯猴吼厚候后呼乎忽瑚壶葫胡蝴狐糊湖\"],[\"bb40\",\"籃\",9,\"籎\",36,\"籵\",5,\"籾\",9],[\"bb80\",\"粈粊\",6,\"粓粔粖粙粚粛粠粡粣粦粧粨粩粫粬粭粯粰粴\",4,\"粺粻弧虎唬护互沪户花哗华猾滑画划化话槐徊怀淮坏欢环桓还缓换患唤痪豢焕涣宦幻荒慌黄磺蝗簧皇凰惶煌晃幌恍谎灰挥辉徽恢蛔回毁悔慧卉惠晦贿秽会烩汇讳诲绘荤昏婚魂浑混豁活伙火获或惑霍货祸击圾基机畸稽积箕\"],[\"bc40\",\"粿糀糂糃糄糆糉糋糎\",6,\"糘糚糛糝糞糡\",6,\"糩\",5,\"糰\",7,\"糹糺糼\",13,\"紋\",5],[\"bc80\",\"紑\",14,\"紡紣紤紥紦紨紩紪紬紭紮細\",6,\"肌饥迹激讥鸡姬绩缉吉极棘辑籍集及急疾汲即嫉级挤几脊己蓟技冀季伎祭剂悸济寄寂计记既忌际妓继纪嘉枷夹佳家加荚颊贾甲钾假稼价架驾嫁歼监坚尖笺间煎兼肩艰奸缄茧检柬碱硷拣捡简俭剪减荐槛鉴践贱见键箭件\"],[\"bd40\",\"紷\",54,\"絯\",7],[\"bd80\",\"絸\",32,\"健舰剑饯渐溅涧建僵姜将浆江疆蒋桨奖讲匠酱降蕉椒礁焦胶交郊浇骄娇嚼搅铰矫侥脚狡角饺缴绞剿教酵轿较叫窖揭接皆秸街阶截劫节桔杰捷睫竭洁结解姐戒藉芥界借介疥诫届巾筋斤金今津襟紧锦仅谨进靳晋禁近烬浸\"],[\"be40\",\"継\",12,\"綧\",6,\"綯\",42],[\"be80\",\"線\",32,\"尽劲荆兢茎睛晶鲸京惊精粳经井警景颈静境敬镜径痉靖竟竞净炯窘揪究纠玖韭久灸九酒厩救旧臼舅咎就疚鞠拘狙疽居驹菊局咀矩举沮聚拒据巨具距踞锯俱句惧炬剧捐鹃娟倦眷卷绢撅攫抉掘倔爵觉决诀绝均菌钧军君峻\"],[\"bf40\",\"緻\",62],[\"bf80\",\"縺縼\",4,\"繂\",4,\"繈\",21,\"俊竣浚郡骏喀咖卡咯开揩楷凯慨刊堪勘坎砍看康慷糠扛抗亢炕考拷烤靠坷苛柯棵磕颗科壳咳可渴克刻客课肯啃垦恳坑吭空恐孔控抠口扣寇枯哭窟苦酷库裤夸垮挎跨胯块筷侩快宽款匡筐狂框矿眶旷况亏盔岿窥葵奎魁傀\"],[\"c040\",\"繞\",35,\"纃\",23,\"纜纝纞\"],[\"c080\",\"纮纴纻纼绖绤绬绹缊缐缞缷缹缻\",6,\"罃罆\",9,\"罒罓馈愧溃坤昆捆困括扩廓阔垃拉喇蜡腊辣啦莱来赖蓝婪栏拦篮阑兰澜谰揽览懒缆烂滥琅榔狼廊郎朗浪捞劳牢老佬姥酪烙涝勒乐雷镭蕾磊累儡垒擂肋类泪棱楞冷厘梨犁黎篱狸离漓理李里鲤礼莉荔吏栗丽厉励砾历利傈例俐\"],[\"c140\",\"罖罙罛罜罝罞罠罣\",4,\"罫罬罭罯罰罳罵罶罷罸罺罻罼罽罿羀羂\",7,\"羋羍羏\",4,\"羕\",4,\"羛羜羠羢羣羥羦羨\",6,\"羱\"],[\"c180\",\"羳\",4,\"羺羻羾翀翂翃翄翆翇翈翉翋翍翏\",4,\"翖翗翙\",5,\"翢翣痢立粒沥隶力璃哩俩联莲连镰廉怜涟帘敛脸链恋炼练粮凉梁粱良两辆量晾亮谅撩聊僚疗燎寥辽潦了撂镣廖料列裂烈劣猎琳林磷霖临邻鳞淋凛赁吝拎玲菱零龄铃伶羚凌灵陵岭领另令溜琉榴硫馏留刘瘤流柳六龙聋咙笼窿\"],[\"c240\",\"翤翧翨翪翫翬翭翯翲翴\",6,\"翽翾翿耂耇耈耉耊耎耏耑耓耚耛耝耞耟耡耣耤耫\",5,\"耲耴耹耺耼耾聀聁聄聅聇聈聉聎聏聐聑聓聕聖聗\"],[\"c280\",\"聙聛\",13,\"聫\",5,\"聲\",11,\"隆垄拢陇楼娄搂篓漏陋芦卢颅庐炉掳卤虏鲁麓碌露路赂鹿潞禄录陆戮驴吕铝侣旅履屡缕虑氯律率滤绿峦挛孪滦卵乱掠略抡轮伦仑沦纶论萝螺罗逻锣箩骡裸落洛骆络妈麻玛码蚂马骂嘛吗埋买麦卖迈脉瞒馒蛮满蔓曼慢漫\"],[\"c340\",\"聾肁肂肅肈肊肍\",5,\"肔肕肗肙肞肣肦肧肨肬肰肳肵肶肸肹肻胅胇\",4,\"胏\",6,\"胘胟胠胢胣胦胮胵胷胹胻胾胿脀脁脃脄脅脇脈脋\"],[\"c380\",\"脌脕脗脙脛脜脝脟\",12,\"脭脮脰脳脴脵脷脹\",4,\"脿谩芒茫盲氓忙莽猫茅锚毛矛铆卯茂冒帽貌贸么玫枚梅酶霉煤没眉媒镁每美昧寐妹媚门闷们萌蒙檬盟锰猛梦孟眯醚靡糜迷谜弥米秘觅泌蜜密幂棉眠绵冕免勉娩缅面苗描瞄藐秒渺庙妙蔑灭民抿皿敏悯闽明螟鸣铭名命谬摸\"],[\"c440\",\"腀\",5,\"腇腉腍腎腏腒腖腗腘腛\",4,\"腡腢腣腤腦腨腪腫腬腯腲腳腵腶腷腸膁膃\",4,\"膉膋膌膍膎膐膒\",5,\"膙膚膞\",4,\"膤膥\"],[\"c480\",\"膧膩膫\",7,\"膴\",5,\"膼膽膾膿臄臅臇臈臉臋臍\",6,\"摹蘑模膜磨摩魔抹末莫墨默沫漠寞陌谋牟某拇牡亩姆母墓暮幕募慕木目睦牧穆拿哪呐钠那娜纳氖乃奶耐奈南男难囊挠脑恼闹淖呢馁内嫩能妮霓倪泥尼拟你匿腻逆溺蔫拈年碾撵捻念娘酿鸟尿捏聂孽啮镊镍涅您柠狞凝宁\"],[\"c540\",\"臔\",14,\"臤臥臦臨臩臫臮\",4,\"臵\",5,\"臽臿舃與\",4,\"舎舏舑舓舕\",5,\"舝舠舤舥舦舧舩舮舲舺舼舽舿\"],[\"c580\",\"艀艁艂艃艅艆艈艊艌艍艎艐\",7,\"艙艛艜艝艞艠\",7,\"艩拧泞牛扭钮纽脓浓农弄奴努怒女暖虐疟挪懦糯诺哦欧鸥殴藕呕偶沤啪趴爬帕怕琶拍排牌徘湃派攀潘盘磐盼畔判叛乓庞旁耪胖抛咆刨炮袍跑泡呸胚培裴赔陪配佩沛喷盆砰抨烹澎彭蓬棚硼篷膨朋鹏捧碰坯砒霹批披劈琵毗\"],[\"c640\",\"艪艫艬艭艱艵艶艷艸艻艼芀芁芃芅芆芇芉芌芐芓芔芕芖芚芛芞芠芢芣芧芲芵芶芺芻芼芿苀苂苃苅苆苉苐苖苙苚苝苢苧苨苩苪苬苭苮苰苲苳苵苶苸\"],[\"c680\",\"苺苼\",4,\"茊茋茍茐茒茓茖茘茙茝\",9,\"茩茪茮茰茲茷茻茽啤脾疲皮匹痞僻屁譬篇偏片骗飘漂瓢票撇瞥拼频贫品聘乒坪苹萍平凭瓶评屏坡泼颇婆破魄迫粕剖扑铺仆莆葡菩蒲埔朴圃普浦谱曝瀑期欺栖戚妻七凄漆柒沏其棋奇歧畦崎脐齐旗祈祁骑起岂乞企启契砌器气迄弃汽泣讫掐\"],[\"c740\",\"茾茿荁荂荄荅荈荊\",4,\"荓荕\",4,\"荝荢荰\",6,\"荹荺荾\",6,\"莇莈莊莋莌莍莏莐莑莔莕莖莗莙莚莝莟莡\",6,\"莬莭莮\"],[\"c780\",\"莯莵莻莾莿菂菃菄菆菈菉菋菍菎菐菑菒菓菕菗菙菚菛菞菢菣菤菦菧菨菫菬菭恰洽牵扦钎铅千迁签仟谦乾黔钱钳前潜遣浅谴堑嵌欠歉枪呛腔羌墙蔷强抢橇锹敲悄桥瞧乔侨巧鞘撬翘峭俏窍切茄且怯窃钦侵亲秦琴勤芹擒禽寝沁青轻氢倾卿清擎晴氰情顷请庆琼穷秋丘邱球求囚酋泅趋区蛆曲躯屈驱渠\"],[\"c840\",\"菮華菳\",4,\"菺菻菼菾菿萀萂萅萇萈萉萊萐萒\",5,\"萙萚萛萞\",5,\"萩\",7,\"萲\",5,\"萹萺萻萾\",7,\"葇葈葉\"],[\"c880\",\"葊\",6,\"葒\",4,\"葘葝葞葟葠葢葤\",4,\"葪葮葯葰葲葴葷葹葻葼取娶龋趣去圈颧权醛泉全痊拳犬券劝缺炔瘸却鹊榷确雀裙群然燃冉染瓤壤攘嚷让饶扰绕惹热壬仁人忍韧任认刃妊纫扔仍日戎茸蓉荣融熔溶容绒冗揉柔肉茹蠕儒孺如辱乳汝入褥软阮蕊瑞锐闰润若弱撒洒萨腮鳃塞赛三叁\"],[\"c940\",\"葽\",4,\"蒃蒄蒅蒆蒊蒍蒏\",7,\"蒘蒚蒛蒝蒞蒟蒠蒢\",12,\"蒰蒱蒳蒵蒶蒷蒻蒼蒾蓀蓂蓃蓅蓆蓇蓈蓋蓌蓎蓏蓒蓔蓕蓗\"],[\"c980\",\"蓘\",4,\"蓞蓡蓢蓤蓧\",4,\"蓭蓮蓯蓱\",10,\"蓽蓾蔀蔁蔂伞散桑嗓丧搔骚扫嫂瑟色涩森僧莎砂杀刹沙纱傻啥煞筛晒珊苫杉山删煽衫闪陕擅赡膳善汕扇缮墒伤商赏晌上尚裳梢捎稍烧芍勺韶少哨邵绍奢赊蛇舌舍赦摄射慑涉社设砷申呻伸身深娠绅神沈审婶甚肾慎渗声生甥牲升绳\"],[\"ca40\",\"蔃\",8,\"蔍蔎蔏蔐蔒蔔蔕蔖蔘蔙蔛蔜蔝蔞蔠蔢\",8,\"蔭\",9,\"蔾\",4,\"蕄蕅蕆蕇蕋\",10],[\"ca80\",\"蕗蕘蕚蕛蕜蕝蕟\",4,\"蕥蕦蕧蕩\",8,\"蕳蕵蕶蕷蕸蕼蕽蕿薀薁省盛剩胜圣师失狮施湿诗尸虱十石拾时什食蚀实识史矢使屎驶始式示士世柿事拭誓逝势是嗜噬适仕侍释饰氏市恃室视试收手首守寿授售受瘦兽蔬枢梳殊抒输叔舒淑疏书赎孰熟薯暑曙署蜀黍鼠属术述树束戍竖墅庶数漱\"],[\"cb40\",\"薂薃薆薈\",6,\"薐\",10,\"薝\",6,\"薥薦薧薩薫薬薭薱\",5,\"薸薺\",6,\"藂\",6,\"藊\",4,\"藑藒\"],[\"cb80\",\"藔藖\",5,\"藝\",6,\"藥藦藧藨藪\",14,\"恕刷耍摔衰甩帅栓拴霜双爽谁水睡税吮瞬顺舜说硕朔烁斯撕嘶思私司丝死肆寺嗣四伺似饲巳松耸怂颂送宋讼诵搜艘擞嗽苏酥俗素速粟僳塑溯宿诉肃酸蒜算虽隋随绥髓碎岁穗遂隧祟孙损笋蓑梭唆缩琐索锁所塌他它她塔\"],[\"cc40\",\"藹藺藼藽藾蘀\",4,\"蘆\",10,\"蘒蘓蘔蘕蘗\",15,\"蘨蘪\",13,\"蘹蘺蘻蘽蘾蘿虀\"],[\"cc80\",\"虁\",11,\"虒虓處\",4,\"虛虜虝號虠虡虣\",7,\"獭挞蹋踏胎苔抬台泰酞太态汰坍摊贪瘫滩坛檀痰潭谭谈坦毯袒碳探叹炭汤塘搪堂棠膛唐糖倘躺淌趟烫掏涛滔绦萄桃逃淘陶讨套特藤腾疼誊梯剔踢锑提题蹄啼体替嚏惕涕剃屉天添填田甜恬舔腆挑条迢眺跳贴铁帖厅听烃\"],[\"cd40\",\"虭虯虰虲\",6,\"蚃\",6,\"蚎\",4,\"蚔蚖\",5,\"蚞\",4,\"蚥蚦蚫蚭蚮蚲蚳蚷蚸蚹蚻\",4,\"蛁蛂蛃蛅蛈蛌蛍蛒蛓蛕蛖蛗蛚蛜\"],[\"cd80\",\"蛝蛠蛡蛢蛣蛥蛦蛧蛨蛪蛫蛬蛯蛵蛶蛷蛺蛻蛼蛽蛿蜁蜄蜅蜆蜋蜌蜎蜏蜐蜑蜔蜖汀廷停亭庭挺艇通桐酮瞳同铜彤童桶捅筒统痛偷投头透凸秃突图徒途涂屠土吐兔湍团推颓腿蜕褪退吞屯臀拖托脱鸵陀驮驼椭妥拓唾挖哇蛙洼娃瓦袜歪外豌弯湾玩顽丸烷完碗挽晚皖惋宛婉万腕汪王亡枉网往旺望忘妄威\"],[\"ce40\",\"蜙蜛蜝蜟蜠蜤蜦蜧蜨蜪蜫蜬蜭蜯蜰蜲蜳蜵蜶蜸蜹蜺蜼蜽蝀\",6,\"蝊蝋蝍蝏蝐蝑蝒蝔蝕蝖蝘蝚\",5,\"蝡蝢蝦\",7,\"蝯蝱蝲蝳蝵\"],[\"ce80\",\"蝷蝸蝹蝺蝿螀螁螄螆螇螉螊螌螎\",4,\"螔螕螖螘\",6,\"螠\",4,\"巍微危韦违桅围唯惟为潍维苇萎委伟伪尾纬未蔚味畏胃喂魏位渭谓尉慰卫瘟温蚊文闻纹吻稳紊问嗡翁瓮挝蜗涡窝我斡卧握沃巫呜钨乌污诬屋无芜梧吾吴毋武五捂午舞伍侮坞戊雾晤物勿务悟误昔熙析西硒矽晰嘻吸锡牺\"],[\"cf40\",\"螥螦螧螩螪螮螰螱螲螴螶螷螸螹螻螼螾螿蟁\",4,\"蟇蟈蟉蟌\",4,\"蟔\",6,\"蟜蟝蟞蟟蟡蟢蟣蟤蟦蟧蟨蟩蟫蟬蟭蟯\",9],[\"cf80\",\"蟺蟻蟼蟽蟿蠀蠁蠂蠄\",5,\"蠋\",7,\"蠔蠗蠘蠙蠚蠜\",4,\"蠣稀息希悉膝夕惜熄烯溪汐犀檄袭席习媳喜铣洗系隙戏细瞎虾匣霞辖暇峡侠狭下厦夏吓掀锨先仙鲜纤咸贤衔舷闲涎弦嫌显险现献县腺馅羡宪陷限线相厢镶香箱襄湘乡翔祥详想响享项巷橡像向象萧硝霄削哮嚣销消宵淆晓\"],[\"d040\",\"蠤\",13,\"蠳\",5,\"蠺蠻蠽蠾蠿衁衂衃衆\",5,\"衎\",5,\"衕衖衘衚\",6,\"衦衧衪衭衯衱衳衴衵衶衸衹衺\"],[\"d080\",\"衻衼袀袃袆袇袉袊袌袎袏袐袑袓袔袕袗\",4,\"袝\",4,\"袣袥\",5,\"小孝校肖啸笑效楔些歇蝎鞋协挟携邪斜胁谐写械卸蟹懈泄泻谢屑薪芯锌欣辛新忻心信衅星腥猩惺兴刑型形邢行醒幸杏性姓兄凶胸匈汹雄熊休修羞朽嗅锈秀袖绣墟戌需虚嘘须徐许蓄酗叙旭序畜恤絮婿绪续轩喧宣悬旋玄\"],[\"d140\",\"袬袮袯袰袲\",4,\"袸袹袺袻袽袾袿裀裃裄裇裈裊裋裌裍裏裐裑裓裖裗裚\",4,\"裠裡裦裧裩\",6,\"裲裵裶裷裺裻製裿褀褁褃\",5],[\"d180\",\"褉褋\",4,\"褑褔\",4,\"褜\",4,\"褢褣褤褦褧褨褩褬褭褮褯褱褲褳褵褷选癣眩绚靴薛学穴雪血勋熏循旬询寻驯巡殉汛训讯逊迅压押鸦鸭呀丫芽牙蚜崖衙涯雅哑亚讶焉咽阉烟淹盐严研蜒岩延言颜阎炎沿奄掩眼衍演艳堰燕厌砚雁唁彦焰宴谚验殃央鸯秧杨扬佯疡羊洋阳氧仰痒养样漾邀腰妖瑶\"],[\"d240\",\"褸\",8,\"襂襃襅\",24,\"襠\",5,\"襧\",19,\"襼\"],[\"d280\",\"襽襾覀覂覄覅覇\",26,\"摇尧遥窑谣姚咬舀药要耀椰噎耶爷野冶也页掖业叶曳腋夜液一壹医揖铱依伊衣颐夷遗移仪胰疑沂宜姨彝椅蚁倚已乙矣以艺抑易邑屹亿役臆逸肄疫亦裔意毅忆义益溢诣议谊译异翼翌绎茵荫因殷音阴姻吟银淫寅饮尹引隐\"],[\"d340\",\"覢\",30,\"觃觍觓觔觕觗觘觙觛觝觟觠觡觢觤觧觨觩觪觬觭觮觰觱觲觴\",6],[\"d380\",\"觻\",4,\"訁\",5,\"計\",21,\"印英樱婴鹰应缨莹萤营荧蝇迎赢盈影颖硬映哟拥佣臃痈庸雍踊蛹咏泳涌永恿勇用幽优悠忧尤由邮铀犹油游酉有友右佑釉诱又幼迂淤于盂榆虞愚舆余俞逾鱼愉渝渔隅予娱雨与屿禹宇语羽玉域芋郁吁遇喻峪御愈欲狱育誉\"],[\"d440\",\"訞\",31,\"訿\",8,\"詉\",21],[\"d480\",\"詟\",25,\"詺\",6,\"浴寓裕预豫驭鸳渊冤元垣袁原援辕园员圆猿源缘远苑愿怨院曰约越跃钥岳粤月悦阅耘云郧匀陨允运蕴酝晕韵孕匝砸杂栽哉灾宰载再在咱攒暂赞赃脏葬遭糟凿藻枣早澡蚤躁噪造皂灶燥责择则泽贼怎增憎曾赠扎喳渣札轧\"],[\"d540\",\"誁\",7,\"誋\",7,\"誔\",46],[\"d580\",\"諃\",32,\"铡闸眨栅榨咋乍炸诈摘斋宅窄债寨瞻毡詹粘沾盏斩辗崭展蘸栈占战站湛绽樟章彰漳张掌涨杖丈帐账仗胀瘴障招昭找沼赵照罩兆肇召遮折哲蛰辙者锗蔗这浙珍斟真甄砧臻贞针侦枕疹诊震振镇阵蒸挣睁征狰争怔整拯正政\"],[\"d640\",\"諤\",34,\"謈\",27],[\"d680\",\"謤謥謧\",30,\"帧症郑证芝枝支吱蜘知肢脂汁之织职直植殖执值侄址指止趾只旨纸志挚掷至致置帜峙制智秩稚质炙痔滞治窒中盅忠钟衷终种肿重仲众舟周州洲诌粥轴肘帚咒皱宙昼骤珠株蛛朱猪诸诛逐竹烛煮拄瞩嘱主著柱助蛀贮铸筑\"],[\"d740\",\"譆\",31,\"譧\",4,\"譭\",25],[\"d780\",\"讇\",24,\"讬讱讻诇诐诪谉谞住注祝驻抓爪拽专砖转撰赚篆桩庄装妆撞壮状椎锥追赘坠缀谆准捉拙卓桌琢茁酌啄着灼浊兹咨资姿滋淄孜紫仔籽滓子自渍字鬃棕踪宗综总纵邹走奏揍租足卒族祖诅阻组钻纂嘴醉最罪尊遵昨左佐柞做作坐座\"],[\"d840\",\"谸\",8,\"豂豃豄豅豈豊豋豍\",7,\"豖豗豘豙豛\",5,\"豣\",6,\"豬\",6,\"豴豵豶豷豻\",6,\"貃貄貆貇\"],[\"d880\",\"貈貋貍\",6,\"貕貖貗貙\",20,\"亍丌兀丐廿卅丕亘丞鬲孬噩丨禺丿匕乇夭爻卮氐囟胤馗毓睾鼗丶亟鼐乜乩亓芈孛啬嘏仄厍厝厣厥厮靥赝匚叵匦匮匾赜卦卣刂刈刎刭刳刿剀剌剞剡剜蒯剽劂劁劐劓冂罔亻仃仉仂仨仡仫仞伛仳伢佤仵伥伧伉伫佞佧攸佚佝\"],[\"d940\",\"貮\",62],[\"d980\",\"賭\",32,\"佟佗伲伽佶佴侑侉侃侏佾佻侪佼侬侔俦俨俪俅俚俣俜俑俟俸倩偌俳倬倏倮倭俾倜倌倥倨偾偃偕偈偎偬偻傥傧傩傺僖儆僭僬僦僮儇儋仝氽佘佥俎龠汆籴兮巽黉馘冁夔勹匍訇匐凫夙兕亠兖亳衮袤亵脔裒禀嬴蠃羸冫冱冽冼\"],[\"da40\",\"贎\",14,\"贠赑赒赗赟赥赨赩赪赬赮赯赱赲赸\",8,\"趂趃趆趇趈趉趌\",4,\"趒趓趕\",9,\"趠趡\"],[\"da80\",\"趢趤\",12,\"趲趶趷趹趻趽跀跁跂跅跇跈跉跊跍跐跒跓跔凇冖冢冥讠讦讧讪讴讵讷诂诃诋诏诎诒诓诔诖诘诙诜诟诠诤诨诩诮诰诳诶诹诼诿谀谂谄谇谌谏谑谒谔谕谖谙谛谘谝谟谠谡谥谧谪谫谮谯谲谳谵谶卩卺阝阢阡阱阪阽阼陂陉陔陟陧陬陲陴隈隍隗隰邗邛邝邙邬邡邴邳邶邺\"],[\"db40\",\"跕跘跙跜跠跡跢跥跦跧跩跭跮跰跱跲跴跶跼跾\",6,\"踆踇踈踋踍踎踐踑踒踓踕\",7,\"踠踡踤\",4,\"踫踭踰踲踳踴踶踷踸踻踼踾\"],[\"db80\",\"踿蹃蹅蹆蹌\",4,\"蹓\",5,\"蹚\",11,\"蹧蹨蹪蹫蹮蹱邸邰郏郅邾郐郄郇郓郦郢郜郗郛郫郯郾鄄鄢鄞鄣鄱鄯鄹酃酆刍奂劢劬劭劾哿勐勖勰叟燮矍廴凵凼鬯厶弁畚巯坌垩垡塾墼壅壑圩圬圪圳圹圮圯坜圻坂坩垅坫垆坼坻坨坭坶坳垭垤垌垲埏垧垴垓垠埕埘埚埙埒垸埴埯埸埤埝\"],[\"dc40\",\"蹳蹵蹷\",4,\"蹽蹾躀躂躃躄躆躈\",6,\"躑躒躓躕\",6,\"躝躟\",11,\"躭躮躰躱躳\",6,\"躻\",7],[\"dc80\",\"軃\",10,\"軏\",21,\"堋堍埽埭堀堞堙塄堠塥塬墁墉墚墀馨鼙懿艹艽艿芏芊芨芄芎芑芗芙芫芸芾芰苈苊苣芘芷芮苋苌苁芩芴芡芪芟苄苎芤苡茉苷苤茏茇苜苴苒苘茌苻苓茑茚茆茔茕苠苕茜荑荛荜茈莒茼茴茱莛荞茯荏荇荃荟荀茗荠茭茺茳荦荥\"],[\"dd40\",\"軥\",62],[\"dd80\",\"輤\",32,\"荨茛荩荬荪荭荮莰荸莳莴莠莪莓莜莅荼莶莩荽莸荻莘莞莨莺莼菁萁菥菘堇萘萋菝菽菖萜萸萑萆菔菟萏萃菸菹菪菅菀萦菰菡葜葑葚葙葳蒇蒈葺蒉葸萼葆葩葶蒌蒎萱葭蓁蓍蓐蓦蒽蓓蓊蒿蒺蓠蒡蒹蒴蒗蓥蓣蔌甍蔸蓰蔹蔟蔺\"],[\"de40\",\"轅\",32,\"轪辀辌辒辝辠辡辢辤辥辦辧辪辬辭辮辯農辳辴辵辷辸辺辻込辿迀迃迆\"],[\"de80\",\"迉\",4,\"迏迒迖迗迚迠迡迣迧迬迯迱迲迴迵迶迺迻迼迾迿逇逈逌逎逓逕逘蕖蔻蓿蓼蕙蕈蕨蕤蕞蕺瞢蕃蕲蕻薤薨薇薏蕹薮薜薅薹薷薰藓藁藜藿蘧蘅蘩蘖蘼廾弈夼奁耷奕奚奘匏尢尥尬尴扌扪抟抻拊拚拗拮挢拶挹捋捃掭揶捱捺掎掴捭掬掊捩掮掼揲揸揠揿揄揞揎摒揆掾摅摁搋搛搠搌搦搡摞撄摭撖\"],[\"df40\",\"這逜連逤逥逧\",5,\"逰\",4,\"逷逹逺逽逿遀遃遅遆遈\",4,\"過達違遖遙遚遜\",5,\"遤遦遧適遪遫遬遯\",4,\"遶\",6,\"遾邁\"],[\"df80\",\"還邅邆邇邉邊邌\",4,\"邒邔邖邘邚邜邞邟邠邤邥邧邨邩邫邭邲邷邼邽邿郀摺撷撸撙撺擀擐擗擤擢攉攥攮弋忒甙弑卟叱叽叩叨叻吒吖吆呋呒呓呔呖呃吡呗呙吣吲咂咔呷呱呤咚咛咄呶呦咝哐咭哂咴哒咧咦哓哔呲咣哕咻咿哌哙哚哜咩咪咤哝哏哞唛哧唠哽唔哳唢唣唏唑唧唪啧喏喵啉啭啁啕唿啐唼\"],[\"e040\",\"郂郃郆郈郉郋郌郍郒郔郕郖郘郙郚郞郟郠郣郤郥郩郪郬郮郰郱郲郳郵郶郷郹郺郻郼郿鄀鄁鄃鄅\",19,\"鄚鄛鄜\"],[\"e080\",\"鄝鄟鄠鄡鄤\",10,\"鄰鄲\",6,\"鄺\",8,\"酄唷啖啵啶啷唳唰啜喋嗒喃喱喹喈喁喟啾嗖喑啻嗟喽喾喔喙嗪嗷嗉嘟嗑嗫嗬嗔嗦嗝嗄嗯嗥嗲嗳嗌嗍嗨嗵嗤辔嘞嘈嘌嘁嘤嘣嗾嘀嘧嘭噘嘹噗嘬噍噢噙噜噌噔嚆噤噱噫噻噼嚅嚓嚯囔囗囝囡囵囫囹囿圄圊圉圜帏帙帔帑帱帻帼\"],[\"e140\",\"酅酇酈酑酓酔酕酖酘酙酛酜酟酠酦酧酨酫酭酳酺酻酼醀\",4,\"醆醈醊醎醏醓\",6,\"醜\",5,\"醤\",5,\"醫醬醰醱醲醳醶醷醸醹醻\"],[\"e180\",\"醼\",10,\"釈釋釐釒\",9,\"針\",8,\"帷幄幔幛幞幡岌屺岍岐岖岈岘岙岑岚岜岵岢岽岬岫岱岣峁岷峄峒峤峋峥崂崃崧崦崮崤崞崆崛嵘崾崴崽嵬嵛嵯嵝嵫嵋嵊嵩嵴嶂嶙嶝豳嶷巅彳彷徂徇徉後徕徙徜徨徭徵徼衢彡犭犰犴犷犸狃狁狎狍狒狨狯狩狲狴狷猁狳猃狺\"],[\"e240\",\"釦\",62],[\"e280\",\"鈥\",32,\"狻猗猓猡猊猞猝猕猢猹猥猬猸猱獐獍獗獠獬獯獾舛夥飧夤夂饣饧\",5,\"饴饷饽馀馄馇馊馍馐馑馓馔馕庀庑庋庖庥庠庹庵庾庳赓廒廑廛廨廪膺忄忉忖忏怃忮怄忡忤忾怅怆忪忭忸怙怵怦怛怏怍怩怫怊怿怡恸恹恻恺恂\"],[\"e340\",\"鉆\",45,\"鉵\",16],[\"e380\",\"銆\",7,\"銏\",24,\"恪恽悖悚悭悝悃悒悌悛惬悻悱惝惘惆惚悴愠愦愕愣惴愀愎愫慊慵憬憔憧憷懔懵忝隳闩闫闱闳闵闶闼闾阃阄阆阈阊阋阌阍阏阒阕阖阗阙阚丬爿戕氵汔汜汊沣沅沐沔沌汨汩汴汶沆沩泐泔沭泷泸泱泗沲泠泖泺泫泮沱泓泯泾\"],[\"e440\",\"銨\",5,\"銯\",24,\"鋉\",31],[\"e480\",\"鋩\",32,\"洹洧洌浃浈洇洄洙洎洫浍洮洵洚浏浒浔洳涑浯涞涠浞涓涔浜浠浼浣渚淇淅淞渎涿淠渑淦淝淙渖涫渌涮渫湮湎湫溲湟溆湓湔渲渥湄滟溱溘滠漭滢溥溧溽溻溷滗溴滏溏滂溟潢潆潇漤漕滹漯漶潋潴漪漉漩澉澍澌潸潲潼潺濑\"],[\"e540\",\"錊\",51,\"錿\",10],[\"e580\",\"鍊\",31,\"鍫濉澧澹澶濂濡濮濞濠濯瀚瀣瀛瀹瀵灏灞宀宄宕宓宥宸甯骞搴寤寮褰寰蹇謇辶迓迕迥迮迤迩迦迳迨逅逄逋逦逑逍逖逡逵逶逭逯遄遑遒遐遨遘遢遛暹遴遽邂邈邃邋彐彗彖彘尻咫屐屙孱屣屦羼弪弩弭艴弼鬻屮妁妃妍妩妪妣\"],[\"e640\",\"鍬\",34,\"鎐\",27],[\"e680\",\"鎬\",29,\"鏋鏌鏍妗姊妫妞妤姒妲妯姗妾娅娆姝娈姣姘姹娌娉娲娴娑娣娓婀婧婊婕娼婢婵胬媪媛婷婺媾嫫媲嫒嫔媸嫠嫣嫱嫖嫦嫘嫜嬉嬗嬖嬲嬷孀尕尜孚孥孳孑孓孢驵驷驸驺驿驽骀骁骅骈骊骐骒骓骖骘骛骜骝骟骠骢骣骥骧纟纡纣纥纨纩\"],[\"e740\",\"鏎\",7,\"鏗\",54],[\"e780\",\"鐎\",32,\"纭纰纾绀绁绂绉绋绌绐绔绗绛绠绡绨绫绮绯绱绲缍绶绺绻绾缁缂缃缇缈缋缌缏缑缒缗缙缜缛缟缡\",6,\"缪缫缬缭缯\",4,\"缵幺畿巛甾邕玎玑玮玢玟珏珂珑玷玳珀珉珈珥珙顼琊珩珧珞玺珲琏琪瑛琦琥琨琰琮琬\"],[\"e840\",\"鐯\",14,\"鐿\",43,\"鑬鑭鑮鑯\"],[\"e880\",\"鑰\",20,\"钑钖钘铇铏铓铔铚铦铻锜锠琛琚瑁瑜瑗瑕瑙瑷瑭瑾璜璎璀璁璇璋璞璨璩璐璧瓒璺韪韫韬杌杓杞杈杩枥枇杪杳枘枧杵枨枞枭枋杷杼柰栉柘栊柩枰栌柙枵柚枳柝栀柃枸柢栎柁柽栲栳桠桡桎桢桄桤梃栝桕桦桁桧桀栾桊桉栩梵梏桴桷梓桫棂楮棼椟椠棹\"],[\"e940\",\"锧锳锽镃镈镋镕镚镠镮镴镵長\",7,\"門\",42],[\"e980\",\"閫\",32,\"椤棰椋椁楗棣椐楱椹楠楂楝榄楫榀榘楸椴槌榇榈槎榉楦楣楹榛榧榻榫榭槔榱槁槊槟榕槠榍槿樯槭樗樘橥槲橄樾檠橐橛樵檎橹樽樨橘橼檑檐檩檗檫猷獒殁殂殇殄殒殓殍殚殛殡殪轫轭轱轲轳轵轶轸轷轹轺轼轾辁辂辄辇辋\"],[\"ea40\",\"闌\",27,\"闬闿阇阓阘阛阞阠阣\",6,\"阫阬阭阯阰阷阸阹阺阾陁陃陊陎陏陑陒陓陖陗\"],[\"ea80\",\"陘陙陚陜陝陞陠陣陥陦陫陭\",4,\"陳陸\",12,\"隇隉隊辍辎辏辘辚軎戋戗戛戟戢戡戥戤戬臧瓯瓴瓿甏甑甓攴旮旯旰昊昙杲昃昕昀炅曷昝昴昱昶昵耆晟晔晁晏晖晡晗晷暄暌暧暝暾曛曜曦曩贲贳贶贻贽赀赅赆赈赉赇赍赕赙觇觊觋觌觎觏觐觑牮犟牝牦牯牾牿犄犋犍犏犒挈挲掰\"],[\"eb40\",\"隌階隑隒隓隕隖隚際隝\",9,\"隨\",7,\"隱隲隴隵隷隸隺隻隿雂雃雈雊雋雐雑雓雔雖\",9,\"雡\",6,\"雫\"],[\"eb80\",\"雬雭雮雰雱雲雴雵雸雺電雼雽雿霂霃霅霊霋霌霐霑霒霔霕霗\",4,\"霝霟霠搿擘耄毪毳毽毵毹氅氇氆氍氕氘氙氚氡氩氤氪氲攵敕敫牍牒牖爰虢刖肟肜肓肼朊肽肱肫肭肴肷胧胨胩胪胛胂胄胙胍胗朐胝胫胱胴胭脍脎胲胼朕脒豚脶脞脬脘脲腈腌腓腴腙腚腱腠腩腼腽腭腧塍媵膈膂膑滕膣膪臌朦臊膻\"],[\"ec40\",\"霡\",8,\"霫霬霮霯霱霳\",4,\"霺霻霼霽霿\",18,\"靔靕靗靘靚靜靝靟靣靤靦靧靨靪\",7],[\"ec80\",\"靲靵靷\",4,\"靽\",7,\"鞆\",4,\"鞌鞎鞏鞐鞓鞕鞖鞗鞙\",4,\"臁膦欤欷欹歃歆歙飑飒飓飕飙飚殳彀毂觳斐齑斓於旆旄旃旌旎旒旖炀炜炖炝炻烀炷炫炱烨烊焐焓焖焯焱煳煜煨煅煲煊煸煺熘熳熵熨熠燠燔燧燹爝爨灬焘煦熹戾戽扃扈扉礻祀祆祉祛祜祓祚祢祗祠祯祧祺禅禊禚禧禳忑忐\"],[\"ed40\",\"鞞鞟鞡鞢鞤\",6,\"鞬鞮鞰鞱鞳鞵\",46],[\"ed80\",\"韤韥韨韮\",4,\"韴韷\",23,\"怼恝恚恧恁恙恣悫愆愍慝憩憝懋懑戆肀聿沓泶淼矶矸砀砉砗砘砑斫砭砜砝砹砺砻砟砼砥砬砣砩硎硭硖硗砦硐硇硌硪碛碓碚碇碜碡碣碲碹碥磔磙磉磬磲礅磴礓礤礞礴龛黹黻黼盱眄眍盹眇眈眚眢眙眭眦眵眸睐睑睇睃睚睨\"],[\"ee40\",\"頏\",62],[\"ee80\",\"顎\",32,\"睢睥睿瞍睽瞀瞌瞑瞟瞠瞰瞵瞽町畀畎畋畈畛畲畹疃罘罡罟詈罨罴罱罹羁罾盍盥蠲钅钆钇钋钊钌钍钏钐钔钗钕钚钛钜钣钤钫钪钭钬钯钰钲钴钶\",4,\"钼钽钿铄铈\",6,\"铐铑铒铕铖铗铙铘铛铞铟铠铢铤铥铧铨铪\"],[\"ef40\",\"顯\",5,\"颋颎颒颕颙颣風\",37,\"飏飐飔飖飗飛飜飝飠\",4],[\"ef80\",\"飥飦飩\",30,\"铩铫铮铯铳铴铵铷铹铼铽铿锃锂锆锇锉锊锍锎锏锒\",4,\"锘锛锝锞锟锢锪锫锩锬锱锲锴锶锷锸锼锾锿镂锵镄镅镆镉镌镎镏镒镓镔镖镗镘镙镛镞镟镝镡镢镤\",8,\"镯镱镲镳锺矧矬雉秕秭秣秫稆嵇稃稂稞稔\"],[\"f040\",\"餈\",4,\"餎餏餑\",28,\"餯\",26],[\"f080\",\"饊\",9,\"饖\",12,\"饤饦饳饸饹饻饾馂馃馉稹稷穑黏馥穰皈皎皓皙皤瓞瓠甬鸠鸢鸨\",4,\"鸲鸱鸶鸸鸷鸹鸺鸾鹁鹂鹄鹆鹇鹈鹉鹋鹌鹎鹑鹕鹗鹚鹛鹜鹞鹣鹦\",6,\"鹱鹭鹳疒疔疖疠疝疬疣疳疴疸痄疱疰痃痂痖痍痣痨痦痤痫痧瘃痱痼痿瘐瘀瘅瘌瘗瘊瘥瘘瘕瘙\"],[\"f140\",\"馌馎馚\",10,\"馦馧馩\",47],[\"f180\",\"駙\",32,\"瘛瘼瘢瘠癀瘭瘰瘿瘵癃瘾瘳癍癞癔癜癖癫癯翊竦穸穹窀窆窈窕窦窠窬窨窭窳衤衩衲衽衿袂袢裆袷袼裉裢裎裣裥裱褚裼裨裾裰褡褙褓褛褊褴褫褶襁襦襻疋胥皲皴矜耒耔耖耜耠耢耥耦耧耩耨耱耋耵聃聆聍聒聩聱覃顸颀颃\"],[\"f240\",\"駺\",62],[\"f280\",\"騹\",32,\"颉颌颍颏颔颚颛颞颟颡颢颥颦虍虔虬虮虿虺虼虻蚨蚍蚋蚬蚝蚧蚣蚪蚓蚩蚶蛄蚵蛎蚰蚺蚱蚯蛉蛏蚴蛩蛱蛲蛭蛳蛐蜓蛞蛴蛟蛘蛑蜃蜇蛸蜈蜊蜍蜉蜣蜻蜞蜥蜮蜚蜾蝈蜴蜱蜩蜷蜿螂蜢蝽蝾蝻蝠蝰蝌蝮螋蝓蝣蝼蝤蝙蝥螓螯螨蟒\"],[\"f340\",\"驚\",17,\"驲骃骉骍骎骔骕骙骦骩\",6,\"骲骳骴骵骹骻骽骾骿髃髄髆\",4,\"髍髎髏髐髒體髕髖髗髙髚髛髜\"],[\"f380\",\"髝髞髠髢髣髤髥髧髨髩髪髬髮髰\",8,\"髺髼\",6,\"鬄鬅鬆蟆螈螅螭螗螃螫蟥螬螵螳蟋蟓螽蟑蟀蟊蟛蟪蟠蟮蠖蠓蟾蠊蠛蠡蠹蠼缶罂罄罅舐竺竽笈笃笄笕笊笫笏筇笸笪笙笮笱笠笥笤笳笾笞筘筚筅筵筌筝筠筮筻筢筲筱箐箦箧箸箬箝箨箅箪箜箢箫箴篑篁篌篝篚篥篦篪簌篾篼簏簖簋\"],[\"f440\",\"鬇鬉\",5,\"鬐鬑鬒鬔\",10,\"鬠鬡鬢鬤\",10,\"鬰鬱鬳\",7,\"鬽鬾鬿魀魆魊魋魌魎魐魒魓魕\",5],[\"f480\",\"魛\",32,\"簟簪簦簸籁籀臾舁舂舄臬衄舡舢舣舭舯舨舫舸舻舳舴舾艄艉艋艏艚艟艨衾袅袈裘裟襞羝羟羧羯羰羲籼敉粑粝粜粞粢粲粼粽糁糇糌糍糈糅糗糨艮暨羿翎翕翥翡翦翩翮翳糸絷綦綮繇纛麸麴赳趄趔趑趱赧赭豇豉酊酐酎酏酤\"],[\"f540\",\"魼\",62],[\"f580\",\"鮻\",32,\"酢酡酰酩酯酽酾酲酴酹醌醅醐醍醑醢醣醪醭醮醯醵醴醺豕鹾趸跫踅蹙蹩趵趿趼趺跄跖跗跚跞跎跏跛跆跬跷跸跣跹跻跤踉跽踔踝踟踬踮踣踯踺蹀踹踵踽踱蹉蹁蹂蹑蹒蹊蹰蹶蹼蹯蹴躅躏躔躐躜躞豸貂貊貅貘貔斛觖觞觚觜\"],[\"f640\",\"鯜\",62],[\"f680\",\"鰛\",32,\"觥觫觯訾謦靓雩雳雯霆霁霈霏霎霪霭霰霾龀龃龅\",5,\"龌黾鼋鼍隹隼隽雎雒瞿雠銎銮鋈錾鍪鏊鎏鐾鑫鱿鲂鲅鲆鲇鲈稣鲋鲎鲐鲑鲒鲔鲕鲚鲛鲞\",5,\"鲥\",4,\"鲫鲭鲮鲰\",7,\"鲺鲻鲼鲽鳄鳅鳆鳇鳊鳋\"],[\"f740\",\"鰼\",62],[\"f780\",\"鱻鱽鱾鲀鲃鲄鲉鲊鲌鲏鲓鲖鲗鲘鲙鲝鲪鲬鲯鲹鲾\",4,\"鳈鳉鳑鳒鳚鳛鳠鳡鳌\",4,\"鳓鳔鳕鳗鳘鳙鳜鳝鳟鳢靼鞅鞑鞒鞔鞯鞫鞣鞲鞴骱骰骷鹘骶骺骼髁髀髅髂髋髌髑魅魃魇魉魈魍魑飨餍餮饕饔髟髡髦髯髫髻髭髹鬈鬏鬓鬟鬣麽麾縻麂麇麈麋麒鏖麝麟黛黜黝黠黟黢黩黧黥黪黯鼢鼬鼯鼹鼷鼽鼾齄\"],[\"f840\",\"鳣\",62],[\"f880\",\"鴢\",32],[\"f940\",\"鵃\",62],[\"f980\",\"鶂\",32],[\"fa40\",\"鶣\",62],[\"fa80\",\"鷢\",32],[\"fb40\",\"鸃\",27,\"鸤鸧鸮鸰鸴鸻鸼鹀鹍鹐鹒鹓鹔鹖鹙鹝鹟鹠鹡鹢鹥鹮鹯鹲鹴\",9,\"麀\"],[\"fb80\",\"麁麃麄麅麆麉麊麌\",5,\"麔\",8,\"麞麠\",5,\"麧麨麩麪\"],[\"fc40\",\"麫\",8,\"麵麶麷麹麺麼麿\",4,\"黅黆黇黈黊黋黌黐黒黓黕黖黗黙黚點黡黣黤黦黨黫黬黭黮黰\",8,\"黺黽黿\",6],[\"fc80\",\"鼆\",4,\"鼌鼏鼑鼒鼔鼕鼖鼘鼚\",5,\"鼡鼣\",8,\"鼭鼮鼰鼱\"],[\"fd40\",\"鼲\",4,\"鼸鼺鼼鼿\",4,\"齅\",10,\"齒\",38],[\"fd80\",\"齹\",5,\"龁龂龍\",11,\"龜龝龞龡\",4,\"郎凉秊裏隣\"],[\"fe40\",\"兀嗀﨎﨏﨑﨓﨔礼﨟蘒﨡﨣﨤﨧﨨﨩\"]]");
})), xm = /* @__PURE__ */ i({ default: () => Sm }), Sm, Cm = n((() => {
	Sm = [
		[
			"a140",
			"",
			62
		],
		[
			"a180",
			"",
			32
		],
		[
			"a240",
			"",
			62
		],
		[
			"a280",
			"",
			32
		],
		[
			"a2ab",
			"",
			5
		],
		["a2e3", "€"],
		["a2ef", ""],
		["a2fd", ""],
		[
			"a340",
			"",
			62
		],
		[
			"a380",
			"",
			31,
			"　"
		],
		[
			"a440",
			"",
			62
		],
		[
			"a480",
			"",
			32
		],
		[
			"a4f4",
			"",
			10
		],
		[
			"a540",
			"",
			62
		],
		[
			"a580",
			"",
			32
		],
		[
			"a5f7",
			"",
			7
		],
		[
			"a640",
			"",
			62
		],
		[
			"a680",
			"",
			32
		],
		[
			"a6b9",
			"",
			7
		],
		[
			"a6d9",
			"",
			6
		],
		["a6ec", ""],
		["a6f3", ""],
		[
			"a6f6",
			"",
			8
		],
		[
			"a740",
			"",
			62
		],
		[
			"a780",
			"",
			32
		],
		[
			"a7c2",
			"",
			14
		],
		[
			"a7f2",
			"",
			12
		],
		[
			"a896",
			"",
			10
		],
		["a8bc", "ḿ"],
		["a8bf", "ǹ"],
		["a8c1", ""],
		[
			"a8ea",
			"",
			20
		],
		["a958", ""],
		["a95b", ""],
		["a95d", ""],
		[
			"a989",
			"〾⿰",
			11
		],
		[
			"a997",
			"",
			12
		],
		[
			"a9f0",
			"",
			14
		],
		[
			"aaa1",
			"",
			93
		],
		[
			"aba1",
			"",
			93
		],
		[
			"aca1",
			"",
			93
		],
		[
			"ada1",
			"",
			93
		],
		[
			"aea1",
			"",
			93
		],
		[
			"afa1",
			"",
			93
		],
		[
			"d7fa",
			"",
			4
		],
		[
			"f8a1",
			"",
			93
		],
		[
			"f9a1",
			"",
			93
		],
		[
			"faa1",
			"",
			93
		],
		[
			"fba1",
			"",
			93
		],
		[
			"fca1",
			"",
			93
		],
		[
			"fda1",
			"",
			93
		],
		["fe50", "⺁⺄㑳㑇⺈⺋㖞㘚㘎⺌⺗㥮㤘㧏㧟㩳㧐㭎㱮㳠⺧⺪䁖䅟⺮䌷⺳⺶⺷䎱䎬⺻䏝䓖䙡䙌"],
		[
			"fe80",
			"䜣䜩䝼䞍⻊䥇䥺䥽䦂䦃䦅䦆䦟䦛䦷䦶䲣䲟䲠䲡䱷䲢䴓",
			6,
			"䶮",
			93
		],
		["8135f437", ""]
	];
})), wm = /* @__PURE__ */ i({
	default: () => Dm,
	gbChars: () => Em,
	uChars: () => Tm
}), Tm, Em, Dm, Om = n((() => {
	Tm = [
		128,
		165,
		169,
		178,
		184,
		216,
		226,
		235,
		238,
		244,
		248,
		251,
		253,
		258,
		276,
		284,
		300,
		325,
		329,
		334,
		364,
		463,
		465,
		467,
		469,
		471,
		473,
		475,
		477,
		506,
		594,
		610,
		712,
		716,
		730,
		930,
		938,
		962,
		970,
		1026,
		1104,
		1106,
		8209,
		8215,
		8218,
		8222,
		8231,
		8241,
		8244,
		8246,
		8252,
		8365,
		8452,
		8454,
		8458,
		8471,
		8482,
		8556,
		8570,
		8596,
		8602,
		8713,
		8720,
		8722,
		8726,
		8731,
		8737,
		8740,
		8742,
		8748,
		8751,
		8760,
		8766,
		8777,
		8781,
		8787,
		8802,
		8808,
		8816,
		8854,
		8858,
		8870,
		8896,
		8979,
		9322,
		9372,
		9548,
		9588,
		9616,
		9622,
		9634,
		9652,
		9662,
		9672,
		9676,
		9680,
		9702,
		9735,
		9738,
		9793,
		9795,
		11906,
		11909,
		11913,
		11917,
		11928,
		11944,
		11947,
		11951,
		11956,
		11960,
		11964,
		11979,
		12284,
		12292,
		12312,
		12319,
		12330,
		12351,
		12436,
		12447,
		12535,
		12543,
		12586,
		12842,
		12850,
		12964,
		13200,
		13215,
		13218,
		13253,
		13263,
		13267,
		13270,
		13384,
		13428,
		13727,
		13839,
		13851,
		14617,
		14703,
		14801,
		14816,
		14964,
		15183,
		15471,
		15585,
		16471,
		16736,
		17208,
		17325,
		17330,
		17374,
		17623,
		17997,
		18018,
		18212,
		18218,
		18301,
		18318,
		18760,
		18811,
		18814,
		18820,
		18823,
		18844,
		18848,
		18872,
		19576,
		19620,
		19738,
		19887,
		40870,
		59244,
		59336,
		59367,
		59413,
		59417,
		59423,
		59431,
		59437,
		59443,
		59452,
		59460,
		59478,
		59493,
		63789,
		63866,
		63894,
		63976,
		63986,
		64016,
		64018,
		64021,
		64025,
		64034,
		64037,
		64042,
		65074,
		65093,
		65107,
		65112,
		65127,
		65132,
		65375,
		65510,
		65536
	], Em = [
		0,
		36,
		38,
		45,
		50,
		81,
		89,
		95,
		96,
		100,
		103,
		104,
		105,
		109,
		126,
		133,
		148,
		172,
		175,
		179,
		208,
		306,
		307,
		308,
		309,
		310,
		311,
		312,
		313,
		341,
		428,
		443,
		544,
		545,
		558,
		741,
		742,
		749,
		750,
		805,
		819,
		820,
		7922,
		7924,
		7925,
		7927,
		7934,
		7943,
		7944,
		7945,
		7950,
		8062,
		8148,
		8149,
		8152,
		8164,
		8174,
		8236,
		8240,
		8262,
		8264,
		8374,
		8380,
		8381,
		8384,
		8388,
		8390,
		8392,
		8393,
		8394,
		8396,
		8401,
		8406,
		8416,
		8419,
		8424,
		8437,
		8439,
		8445,
		8482,
		8485,
		8496,
		8521,
		8603,
		8936,
		8946,
		9046,
		9050,
		9063,
		9066,
		9076,
		9092,
		9100,
		9108,
		9111,
		9113,
		9131,
		9162,
		9164,
		9218,
		9219,
		11329,
		11331,
		11334,
		11336,
		11346,
		11361,
		11363,
		11366,
		11370,
		11372,
		11375,
		11389,
		11682,
		11686,
		11687,
		11692,
		11694,
		11714,
		11716,
		11723,
		11725,
		11730,
		11736,
		11982,
		11989,
		12102,
		12336,
		12348,
		12350,
		12384,
		12393,
		12395,
		12397,
		12510,
		12553,
		12851,
		12962,
		12973,
		13738,
		13823,
		13919,
		13933,
		14080,
		14298,
		14585,
		14698,
		15583,
		15847,
		16318,
		16434,
		16438,
		16481,
		16729,
		17102,
		17122,
		17315,
		17320,
		17402,
		17418,
		17859,
		17909,
		17911,
		17915,
		17916,
		17936,
		17939,
		17961,
		18664,
		18703,
		18814,
		18962,
		19043,
		33469,
		33470,
		33471,
		33484,
		33485,
		33490,
		33497,
		33501,
		33505,
		33513,
		33520,
		33536,
		33550,
		37845,
		37921,
		37948,
		38029,
		38038,
		38064,
		38065,
		38066,
		38069,
		38075,
		38076,
		38078,
		39108,
		39109,
		39113,
		39114,
		39115,
		39116,
		39265,
		39394,
		189e3
	], Dm = {
		uChars: Tm,
		gbChars: Em
	};
})), km = /* @__PURE__ */ i({ default: () => Am }), Am, jm = n((() => {
	Am = /*#__PURE__*/ JSON.parse("[[\"0\",\"\\u0000\",127],[\"8141\",\"갂갃갅갆갋\",4,\"갘갞갟갡갢갣갥\",6,\"갮갲갳갴\"],[\"8161\",\"갵갶갷갺갻갽갾갿걁\",9,\"걌걎\",5,\"걕\"],[\"8181\",\"걖걗걙걚걛걝\",18,\"걲걳걵걶걹걻\",4,\"겂겇겈겍겎겏겑겒겓겕\",6,\"겞겢\",5,\"겫겭겮겱\",6,\"겺겾겿곀곂곃곅곆곇곉곊곋곍\",7,\"곖곘\",7,\"곢곣곥곦곩곫곭곮곲곴곷\",4,\"곾곿괁괂괃괅괇\",4,\"괎괐괒괓\"],[\"8241\",\"괔괕괖괗괙괚괛괝괞괟괡\",7,\"괪괫괮\",5],[\"8261\",\"괶괷괹괺괻괽\",6,\"굆굈굊\",5,\"굑굒굓굕굖굗\"],[\"8281\",\"굙\",7,\"굢굤\",7,\"굮굯굱굲굷굸굹굺굾궀궃\",4,\"궊궋궍궎궏궑\",10,\"궞\",5,\"궥\",17,\"궸\",7,\"귂귃귅귆귇귉\",6,\"귒귔\",7,\"귝귞귟귡귢귣귥\",18],[\"8341\",\"귺귻귽귾긂\",5,\"긊긌긎\",5,\"긕\",7],[\"8361\",\"긝\",18,\"긲긳긵긶긹긻긼\"],[\"8381\",\"긽긾긿깂깄깇깈깉깋깏깑깒깓깕깗\",4,\"깞깢깣깤깦깧깪깫깭깮깯깱\",6,\"깺깾\",5,\"꺆\",5,\"꺍\",46,\"꺿껁껂껃껅\",6,\"껎껒\",5,\"껚껛껝\",8],[\"8441\",\"껦껧껩껪껬껮\",5,\"껵껶껷껹껺껻껽\",8],[\"8461\",\"꼆꼉꼊꼋꼌꼎꼏꼑\",18],[\"8481\",\"꼤\",7,\"꼮꼯꼱꼳꼵\",6,\"꼾꽀꽄꽅꽆꽇꽊\",5,\"꽑\",10,\"꽞\",5,\"꽦\",18,\"꽺\",5,\"꾁꾂꾃꾅꾆꾇꾉\",6,\"꾒꾓꾔꾖\",5,\"꾝\",26,\"꾺꾻꾽꾾\"],[\"8541\",\"꾿꿁\",5,\"꿊꿌꿏\",4,\"꿕\",6,\"꿝\",4],[\"8561\",\"꿢\",5,\"꿪\",5,\"꿲꿳꿵꿶꿷꿹\",6,\"뀂뀃\"],[\"8581\",\"뀅\",6,\"뀍뀎뀏뀑뀒뀓뀕\",6,\"뀞\",9,\"뀩\",26,\"끆끇끉끋끍끏끐끑끒끖끘끚끛끜끞\",29,\"끾끿낁낂낃낅\",6,\"낎낐낒\",5,\"낛낝낞낣낤\"],[\"8641\",\"낥낦낧낪낰낲낶낷낹낺낻낽\",6,\"냆냊\",5,\"냒\"],[\"8661\",\"냓냕냖냗냙\",6,\"냡냢냣냤냦\",10],[\"8681\",\"냱\",22,\"넊넍넎넏넑넔넕넖넗넚넞\",4,\"넦넧넩넪넫넭\",6,\"넶넺\",5,\"녂녃녅녆녇녉\",6,\"녒녓녖녗녙녚녛녝녞녟녡\",22,\"녺녻녽녾녿놁놃\",4,\"놊놌놎놏놐놑놕놖놗놙놚놛놝\"],[\"8741\",\"놞\",9,\"놩\",15],[\"8761\",\"놹\",18,\"뇍뇎뇏뇑뇒뇓뇕\"],[\"8781\",\"뇖\",5,\"뇞뇠\",7,\"뇪뇫뇭뇮뇯뇱\",7,\"뇺뇼뇾\",5,\"눆눇눉눊눍\",6,\"눖눘눚\",5,\"눡\",18,\"눵\",6,\"눽\",26,\"뉙뉚뉛뉝뉞뉟뉡\",6,\"뉪\",4],[\"8841\",\"뉯\",4,\"뉶\",5,\"뉽\",6,\"늆늇늈늊\",4],[\"8861\",\"늏늒늓늕늖늗늛\",4,\"늢늤늧늨늩늫늭늮늯늱늲늳늵늶늷\"],[\"8881\",\"늸\",15,\"닊닋닍닎닏닑닓\",4,\"닚닜닞닟닠닡닣닧닩닪닰닱닲닶닼닽닾댂댃댅댆댇댉\",6,\"댒댖\",5,\"댝\",54,\"덗덙덚덝덠덡덢덣\"],[\"8941\",\"덦덨덪덬덭덯덲덳덵덶덷덹\",6,\"뎂뎆\",5,\"뎍\"],[\"8961\",\"뎎뎏뎑뎒뎓뎕\",10,\"뎢\",5,\"뎩뎪뎫뎭\"],[\"8981\",\"뎮\",21,\"돆돇돉돊돍돏돑돒돓돖돘돚돜돞돟돡돢돣돥돦돧돩\",18,\"돽\",18,\"됑\",6,\"됙됚됛됝됞됟됡\",6,\"됪됬\",7,\"됵\",15],[\"8a41\",\"둅\",10,\"둒둓둕둖둗둙\",6,\"둢둤둦\"],[\"8a61\",\"둧\",4,\"둭\",18,\"뒁뒂\"],[\"8a81\",\"뒃\",4,\"뒉\",19,\"뒞\",5,\"뒥뒦뒧뒩뒪뒫뒭\",7,\"뒶뒸뒺\",5,\"듁듂듃듅듆듇듉\",6,\"듑듒듓듔듖\",5,\"듞듟듡듢듥듧\",4,\"듮듰듲\",5,\"듹\",26,\"딖딗딙딚딝\"],[\"8b41\",\"딞\",5,\"딦딫\",4,\"딲딳딵딶딷딹\",6,\"땂땆\"],[\"8b61\",\"땇땈땉땊땎땏땑땒땓땕\",6,\"땞땢\",8],[\"8b81\",\"땫\",52,\"떢떣떥떦떧떩떬떭떮떯떲떶\",4,\"떾떿뗁뗂뗃뗅\",6,\"뗎뗒\",5,\"뗙\",18,\"뗭\",18],[\"8c41\",\"똀\",15,\"똒똓똕똖똗똙\",4],[\"8c61\",\"똞\",6,\"똦\",5,\"똭\",6,\"똵\",5],[\"8c81\",\"똻\",12,\"뙉\",26,\"뙥뙦뙧뙩\",50,\"뚞뚟뚡뚢뚣뚥\",5,\"뚭뚮뚯뚰뚲\",16],[\"8d41\",\"뛃\",16,\"뛕\",8],[\"8d61\",\"뛞\",17,\"뛱뛲뛳뛵뛶뛷뛹뛺\"],[\"8d81\",\"뛻\",4,\"뜂뜃뜄뜆\",33,\"뜪뜫뜭뜮뜱\",6,\"뜺뜼\",7,\"띅띆띇띉띊띋띍\",6,\"띖\",9,\"띡띢띣띥띦띧띩\",6,\"띲띴띶\",5,\"띾띿랁랂랃랅\",6,\"랎랓랔랕랚랛랝랞\"],[\"8e41\",\"랟랡\",6,\"랪랮\",5,\"랶랷랹\",8],[\"8e61\",\"럂\",4,\"럈럊\",19],[\"8e81\",\"럞\",13,\"럮럯럱럲럳럵\",6,\"럾렂\",4,\"렊렋렍렎렏렑\",6,\"렚렜렞\",5,\"렦렧렩렪렫렭\",6,\"렶렺\",5,\"롁롂롃롅\",11,\"롒롔\",7,\"롞롟롡롢롣롥\",6,\"롮롰롲\",5,\"롹롺롻롽\",7],[\"8f41\",\"뢅\",7,\"뢎\",17],[\"8f61\",\"뢠\",7,\"뢩\",6,\"뢱뢲뢳뢵뢶뢷뢹\",4],[\"8f81\",\"뢾뢿룂룄룆\",5,\"룍룎룏룑룒룓룕\",7,\"룞룠룢\",5,\"룪룫룭룮룯룱\",6,\"룺룼룾\",5,\"뤅\",18,\"뤙\",6,\"뤡\",26,\"뤾뤿륁륂륃륅\",6,\"륍륎륐륒\",5],[\"9041\",\"륚륛륝륞륟륡\",6,\"륪륬륮\",5,\"륶륷륹륺륻륽\"],[\"9061\",\"륾\",5,\"릆릈릋릌릏\",15],[\"9081\",\"릟\",12,\"릮릯릱릲릳릵\",6,\"릾맀맂\",5,\"맊맋맍맓\",4,\"맚맜맟맠맢맦맧맩맪맫맭\",6,\"맶맻\",4,\"먂\",5,\"먉\",11,\"먖\",33,\"먺먻먽먾먿멁멃멄멅멆\"],[\"9141\",\"멇멊멌멏멐멑멒멖멗멙멚멛멝\",6,\"멦멪\",5],[\"9161\",\"멲멳멵멶멷멹\",9,\"몆몈몉몊몋몍\",5],[\"9181\",\"몓\",20,\"몪몭몮몯몱몳\",4,\"몺몼몾\",5,\"뫅뫆뫇뫉\",14,\"뫚\",33,\"뫽뫾뫿묁묂묃묅\",7,\"묎묐묒\",5,\"묙묚묛묝묞묟묡\",6],[\"9241\",\"묨묪묬\",7,\"묷묹묺묿\",4,\"뭆뭈뭊뭋뭌뭎뭑뭒\"],[\"9261\",\"뭓뭕뭖뭗뭙\",7,\"뭢뭤\",7,\"뭭\",4],[\"9281\",\"뭲\",21,\"뮉뮊뮋뮍뮎뮏뮑\",18,\"뮥뮦뮧뮩뮪뮫뮭\",6,\"뮵뮶뮸\",7,\"믁믂믃믅믆믇믉\",6,\"믑믒믔\",35,\"믺믻믽믾밁\"],[\"9341\",\"밃\",4,\"밊밎밐밒밓밙밚밠밡밢밣밦밨밪밫밬밮밯밲밳밵\"],[\"9361\",\"밶밷밹\",6,\"뱂뱆뱇뱈뱊뱋뱎뱏뱑\",8],[\"9381\",\"뱚뱛뱜뱞\",37,\"벆벇벉벊벍벏\",4,\"벖벘벛\",4,\"벢벣벥벦벩\",6,\"벲벶\",5,\"벾벿볁볂볃볅\",7,\"볎볒볓볔볖볗볙볚볛볝\",22,\"볷볹볺볻볽\"],[\"9441\",\"볾\",5,\"봆봈봊\",5,\"봑봒봓봕\",8],[\"9461\",\"봞\",5,\"봥\",6,\"봭\",12],[\"9481\",\"봺\",5,\"뵁\",6,\"뵊뵋뵍뵎뵏뵑\",6,\"뵚\",9,\"뵥뵦뵧뵩\",22,\"붂붃붅붆붋\",4,\"붒붔붖붗붘붛붝\",6,\"붥\",10,\"붱\",6,\"붹\",24],[\"9541\",\"뷒뷓뷖뷗뷙뷚뷛뷝\",11,\"뷪\",5,\"뷱\"],[\"9561\",\"뷲뷳뷵뷶뷷뷹\",6,\"븁븂븄븆\",5,\"븎븏븑븒븓\"],[\"9581\",\"븕\",6,\"븞븠\",35,\"빆빇빉빊빋빍빏\",4,\"빖빘빜빝빞빟빢빣빥빦빧빩빫\",4,\"빲빶\",4,\"빾빿뺁뺂뺃뺅\",6,\"뺎뺒\",5,\"뺚\",13,\"뺩\",14],[\"9641\",\"뺸\",23,\"뻒뻓\"],[\"9661\",\"뻕뻖뻙\",6,\"뻡뻢뻦\",5,\"뻭\",8],[\"9681\",\"뻶\",10,\"뼂\",5,\"뼊\",13,\"뼚뼞\",33,\"뽂뽃뽅뽆뽇뽉\",6,\"뽒뽓뽔뽖\",44],[\"9741\",\"뾃\",16,\"뾕\",8],[\"9761\",\"뾞\",17,\"뾱\",7],[\"9781\",\"뾹\",11,\"뿆\",5,\"뿎뿏뿑뿒뿓뿕\",6,\"뿝뿞뿠뿢\",89,\"쀽쀾쀿\"],[\"9841\",\"쁀\",16,\"쁒\",5,\"쁙쁚쁛\"],[\"9861\",\"쁝쁞쁟쁡\",6,\"쁪\",15],[\"9881\",\"쁺\",21,\"삒삓삕삖삗삙\",6,\"삢삤삦\",5,\"삮삱삲삷\",4,\"삾샂샃샄샆샇샊샋샍샎샏샑\",6,\"샚샞\",5,\"샦샧샩샪샫샭\",6,\"샶샸샺\",5,\"섁섂섃섅섆섇섉\",6,\"섑섒섓섔섖\",5,\"섡섢섥섨섩섪섫섮\"],[\"9941\",\"섲섳섴섵섷섺섻섽섾섿셁\",6,\"셊셎\",5,\"셖셗\"],[\"9961\",\"셙셚셛셝\",6,\"셦셪\",5,\"셱셲셳셵셶셷셹셺셻\"],[\"9981\",\"셼\",8,\"솆\",5,\"솏솑솒솓솕솗\",4,\"솞솠솢솣솤솦솧솪솫솭솮솯솱\",11,\"솾\",5,\"쇅쇆쇇쇉쇊쇋쇍\",6,\"쇕쇖쇙\",6,\"쇡쇢쇣쇥쇦쇧쇩\",6,\"쇲쇴\",7,\"쇾쇿숁숂숃숅\",6,\"숎숐숒\",5,\"숚숛숝숞숡숢숣\"],[\"9a41\",\"숤숥숦숧숪숬숮숰숳숵\",16],[\"9a61\",\"쉆쉇쉉\",6,\"쉒쉓쉕쉖쉗쉙\",6,\"쉡쉢쉣쉤쉦\"],[\"9a81\",\"쉧\",4,\"쉮쉯쉱쉲쉳쉵\",6,\"쉾슀슂\",5,\"슊\",5,\"슑\",6,\"슙슚슜슞\",5,\"슦슧슩슪슫슮\",5,\"슶슸슺\",33,\"싞싟싡싢싥\",5,\"싮싰싲싳싴싵싷싺싽싾싿쌁\",6,\"쌊쌋쌎쌏\"],[\"9b41\",\"쌐쌑쌒쌖쌗쌙쌚쌛쌝\",6,\"쌦쌧쌪\",8],[\"9b61\",\"쌳\",17,\"썆\",7],[\"9b81\",\"썎\",25,\"썪썫썭썮썯썱썳\",4,\"썺썻썾\",5,\"쎅쎆쎇쎉쎊쎋쎍\",50,\"쏁\",22,\"쏚\"],[\"9c41\",\"쏛쏝쏞쏡쏣\",4,\"쏪쏫쏬쏮\",5,\"쏶쏷쏹\",5],[\"9c61\",\"쏿\",8,\"쐉\",6,\"쐑\",9],[\"9c81\",\"쐛\",8,\"쐥\",6,\"쐭쐮쐯쐱쐲쐳쐵\",6,\"쐾\",9,\"쑉\",26,\"쑦쑧쑩쑪쑫쑭\",6,\"쑶쑷쑸쑺\",5,\"쒁\",18,\"쒕\",6,\"쒝\",12],[\"9d41\",\"쒪\",13,\"쒹쒺쒻쒽\",8],[\"9d61\",\"쓆\",25],[\"9d81\",\"쓠\",8,\"쓪\",5,\"쓲쓳쓵쓶쓷쓹쓻쓼쓽쓾씂\",9,\"씍씎씏씑씒씓씕\",6,\"씝\",10,\"씪씫씭씮씯씱\",6,\"씺씼씾\",5,\"앆앇앋앏앐앑앒앖앚앛앜앟앢앣앥앦앧앩\",6,\"앲앶\",5,\"앾앿얁얂얃얅얆얈얉얊얋얎얐얒얓얔\"],[\"9e41\",\"얖얙얚얛얝얞얟얡\",7,\"얪\",9,\"얶\"],[\"9e61\",\"얷얺얿\",4,\"엋엍엏엒엓엕엖엗엙\",6,\"엢엤엦엧\"],[\"9e81\",\"엨엩엪엫엯엱엲엳엵엸엹엺엻옂옃옄옉옊옋옍옎옏옑\",6,\"옚옝\",6,\"옦옧옩옪옫옯옱옲옶옸옺옼옽옾옿왂왃왅왆왇왉\",6,\"왒왖\",5,\"왞왟왡\",10,\"왭왮왰왲\",5,\"왺왻왽왾왿욁\",6,\"욊욌욎\",5,\"욖욗욙욚욛욝\",6,\"욦\"],[\"9f41\",\"욨욪\",5,\"욲욳욵욶욷욻\",4,\"웂웄웆\",5,\"웎\"],[\"9f61\",\"웏웑웒웓웕\",6,\"웞웟웢\",5,\"웪웫웭웮웯웱웲\"],[\"9f81\",\"웳\",4,\"웺웻웼웾\",5,\"윆윇윉윊윋윍\",6,\"윖윘윚\",5,\"윢윣윥윦윧윩\",6,\"윲윴윶윸윹윺윻윾윿읁읂읃읅\",4,\"읋읎읐읙읚읛읝읞읟읡\",6,\"읩읪읬\",7,\"읶읷읹읺읻읿잀잁잂잆잋잌잍잏잒잓잕잙잛\",4,\"잢잧\",4,\"잮잯잱잲잳잵잶잷\"],[\"a041\",\"잸잹잺잻잾쟂\",5,\"쟊쟋쟍쟏쟑\",6,\"쟙쟚쟛쟜\"],[\"a061\",\"쟞\",5,\"쟥쟦쟧쟩쟪쟫쟭\",13],[\"a081\",\"쟻\",4,\"젂젃젅젆젇젉젋\",4,\"젒젔젗\",4,\"젞젟젡젢젣젥\",6,\"젮젰젲\",5,\"젹젺젻젽젾젿졁\",6,\"졊졋졎\",5,\"졕\",26,\"졲졳졵졶졷졹졻\",4,\"좂좄좈좉좊좎\",5,\"좕\",7,\"좞좠좢좣좤\"],[\"a141\",\"좥좦좧좩\",18,\"좾좿죀죁\"],[\"a161\",\"죂죃죅죆죇죉죊죋죍\",6,\"죖죘죚\",5,\"죢죣죥\"],[\"a181\",\"죦\",14,\"죶\",5,\"죾죿줁줂줃줇\",4,\"줎　、。·‥…¨〃­―∥＼∼‘’“”〔〕〈\",9,\"±×÷≠≤≥∞∴°′″℃Å￠￡￥♂♀∠⊥⌒∂∇≡≒§※☆★○●◎◇◆□■△▲▽▼→←↑↓↔〓≪≫√∽∝∵∫∬∈∋⊆⊇⊂⊃∪∩∧∨￢\"],[\"a241\",\"줐줒\",5,\"줙\",18],[\"a261\",\"줭\",6,\"줵\",18],[\"a281\",\"쥈\",7,\"쥒쥓쥕쥖쥗쥙\",6,\"쥢쥤\",7,\"쥭쥮쥯⇒⇔∀∃´～ˇ˘˝˚˙¸˛¡¿ː∮∑∏¤℉‰◁◀▷▶♤♠♡♥♧♣⊙◈▣◐◑▒▤▥▨▧▦▩♨☏☎☜☞¶†‡↕↗↙↖↘♭♩♪♬㉿㈜№㏇™㏂㏘℡€®\"],[\"a341\",\"쥱쥲쥳쥵\",6,\"쥽\",10,\"즊즋즍즎즏\"],[\"a361\",\"즑\",6,\"즚즜즞\",16],[\"a381\",\"즯\",16,\"짂짃짅짆짉짋\",4,\"짒짔짗짘짛！\",58,\"￦］\",32,\"￣\"],[\"a441\",\"짞짟짡짣짥짦짨짩짪짫짮짲\",5,\"짺짻짽짾짿쨁쨂쨃쨄\"],[\"a461\",\"쨅쨆쨇쨊쨎\",5,\"쨕쨖쨗쨙\",12],[\"a481\",\"쨦쨧쨨쨪\",28,\"ㄱ\",93],[\"a541\",\"쩇\",4,\"쩎쩏쩑쩒쩓쩕\",6,\"쩞쩢\",5,\"쩩쩪\"],[\"a561\",\"쩫\",17,\"쩾\",5,\"쪅쪆\"],[\"a581\",\"쪇\",16,\"쪙\",14,\"ⅰ\",9],[\"a5b0\",\"Ⅰ\",9],[\"a5c1\",\"Α\",16,\"Σ\",6],[\"a5e1\",\"α\",16,\"σ\",6],[\"a641\",\"쪨\",19,\"쪾쪿쫁쫂쫃쫅\"],[\"a661\",\"쫆\",5,\"쫎쫐쫒쫔쫕쫖쫗쫚\",5,\"쫡\",6],[\"a681\",\"쫨쫩쫪쫫쫭\",6,\"쫵\",18,\"쬉쬊─│┌┐┘└├┬┤┴┼━┃┏┓┛┗┣┳┫┻╋┠┯┨┷┿┝┰┥┸╂┒┑┚┙┖┕┎┍┞┟┡┢┦┧┩┪┭┮┱┲┵┶┹┺┽┾╀╁╃\",7],[\"a741\",\"쬋\",4,\"쬑쬒쬓쬕쬖쬗쬙\",6,\"쬢\",7],[\"a761\",\"쬪\",22,\"쭂쭃쭄\"],[\"a781\",\"쭅쭆쭇쭊쭋쭍쭎쭏쭑\",6,\"쭚쭛쭜쭞\",5,\"쭥\",7,\"㎕㎖㎗ℓ㎘㏄㎣㎤㎥㎦㎙\",9,\"㏊㎍㎎㎏㏏㎈㎉㏈㎧㎨㎰\",9,\"㎀\",4,\"㎺\",5,\"㎐\",4,\"Ω㏀㏁㎊㎋㎌㏖㏅㎭㎮㎯㏛㎩㎪㎫㎬㏝㏐㏓㏃㏉㏜㏆\"],[\"a841\",\"쭭\",10,\"쭺\",14],[\"a861\",\"쮉\",18,\"쮝\",6],[\"a881\",\"쮤\",19,\"쮹\",11,\"ÆÐªĦ\"],[\"a8a6\",\"Ĳ\"],[\"a8a8\",\"ĿŁØŒºÞŦŊ\"],[\"a8b1\",\"㉠\",27,\"ⓐ\",25,\"①\",14,\"½⅓⅔¼¾⅛⅜⅝⅞\"],[\"a941\",\"쯅\",14,\"쯕\",10],[\"a961\",\"쯠쯡쯢쯣쯥쯦쯨쯪\",18],[\"a981\",\"쯽\",14,\"찎찏찑찒찓찕\",6,\"찞찟찠찣찤æđðħıĳĸŀłøœßþŧŋŉ㈀\",27,\"⒜\",25,\"⑴\",14,\"¹²³⁴ⁿ₁₂₃₄\"],[\"aa41\",\"찥찦찪찫찭찯찱\",6,\"찺찿\",4,\"챆챇챉챊챋챍챎\"],[\"aa61\",\"챏\",4,\"챖챚\",5,\"챡챢챣챥챧챩\",6,\"챱챲\"],[\"aa81\",\"챳챴챶\",29,\"ぁ\",82],[\"ab41\",\"첔첕첖첗첚첛첝첞첟첡\",6,\"첪첮\",5,\"첶첷첹\"],[\"ab61\",\"첺첻첽\",6,\"쳆쳈쳊\",5,\"쳑쳒쳓쳕\",5],[\"ab81\",\"쳛\",8,\"쳥\",6,\"쳭쳮쳯쳱\",12,\"ァ\",85],[\"ac41\",\"쳾쳿촀촂\",5,\"촊촋촍촎촏촑\",6,\"촚촜촞촟촠\"],[\"ac61\",\"촡촢촣촥촦촧촩촪촫촭\",11,\"촺\",4],[\"ac81\",\"촿\",28,\"쵝쵞쵟А\",5,\"ЁЖ\",25],[\"acd1\",\"а\",5,\"ёж\",25],[\"ad41\",\"쵡쵢쵣쵥\",6,\"쵮쵰쵲\",5,\"쵹\",7],[\"ad61\",\"춁\",6,\"춉\",10,\"춖춗춙춚춛춝춞춟\"],[\"ad81\",\"춠춡춢춣춦춨춪\",5,\"춱\",18,\"췅\"],[\"ae41\",\"췆\",5,\"췍췎췏췑\",16],[\"ae61\",\"췢\",5,\"췩췪췫췭췮췯췱\",6,\"췺췼췾\",4],[\"ae81\",\"츃츅츆츇츉츊츋츍\",6,\"츕츖츗츘츚\",5,\"츢츣츥츦츧츩츪츫\"],[\"af41\",\"츬츭츮츯츲츴츶\",19],[\"af61\",\"칊\",13,\"칚칛칝칞칢\",5,\"칪칬\"],[\"af81\",\"칮\",5,\"칶칷칹칺칻칽\",6,\"캆캈캊\",5,\"캒캓캕캖캗캙\"],[\"b041\",\"캚\",5,\"캢캦\",5,\"캮\",12],[\"b061\",\"캻\",5,\"컂\",19],[\"b081\",\"컖\",13,\"컦컧컩컪컭\",6,\"컶컺\",5,\"가각간갇갈갉갊감\",7,\"같\",4,\"갠갤갬갭갯갰갱갸갹갼걀걋걍걔걘걜거걱건걷걸걺검겁것겄겅겆겉겊겋게겐겔겜겝겟겠겡겨격겪견겯결겸겹겻겼경곁계곈곌곕곗고곡곤곧골곪곬곯곰곱곳공곶과곽관괄괆\"],[\"b141\",\"켂켃켅켆켇켉\",6,\"켒켔켖\",5,\"켝켞켟켡켢켣\"],[\"b161\",\"켥\",6,\"켮켲\",5,\"켹\",11],[\"b181\",\"콅\",14,\"콖콗콙콚콛콝\",6,\"콦콨콪콫콬괌괍괏광괘괜괠괩괬괭괴괵괸괼굄굅굇굉교굔굘굡굣구국군굳굴굵굶굻굼굽굿궁궂궈궉권궐궜궝궤궷귀귁귄귈귐귑귓규균귤그극근귿글긁금급긋긍긔기긱긴긷길긺김깁깃깅깆깊까깍깎깐깔깖깜깝깟깠깡깥깨깩깬깰깸\"],[\"b241\",\"콭콮콯콲콳콵콶콷콹\",6,\"쾁쾂쾃쾄쾆\",5,\"쾍\"],[\"b261\",\"쾎\",18,\"쾢\",5,\"쾩\"],[\"b281\",\"쾪\",5,\"쾱\",18,\"쿅\",6,\"깹깻깼깽꺄꺅꺌꺼꺽꺾껀껄껌껍껏껐껑께껙껜껨껫껭껴껸껼꼇꼈꼍꼐꼬꼭꼰꼲꼴꼼꼽꼿꽁꽂꽃꽈꽉꽐꽜꽝꽤꽥꽹꾀꾄꾈꾐꾑꾕꾜꾸꾹꾼꿀꿇꿈꿉꿋꿍꿎꿔꿜꿨꿩꿰꿱꿴꿸뀀뀁뀄뀌뀐뀔뀜뀝뀨끄끅끈끊끌끎끓끔끕끗끙\"],[\"b341\",\"쿌\",19,\"쿢쿣쿥쿦쿧쿩\"],[\"b361\",\"쿪\",5,\"쿲쿴쿶\",5,\"쿽쿾쿿퀁퀂퀃퀅\",5],[\"b381\",\"퀋\",5,\"퀒\",5,\"퀙\",19,\"끝끼끽낀낄낌낍낏낑나낙낚난낟날낡낢남납낫\",4,\"낱낳내낵낸낼냄냅냇냈냉냐냑냔냘냠냥너넉넋넌널넒넓넘넙넛넜넝넣네넥넨넬넴넵넷넸넹녀녁년녈념녑녔녕녘녜녠노녹논놀놂놈놉놋농높놓놔놘놜놨뇌뇐뇔뇜뇝\"],[\"b441\",\"퀮\",5,\"퀶퀷퀹퀺퀻퀽\",6,\"큆큈큊\",5],[\"b461\",\"큑큒큓큕큖큗큙\",6,\"큡\",10,\"큮큯\"],[\"b481\",\"큱큲큳큵\",6,\"큾큿킀킂\",18,\"뇟뇨뇩뇬뇰뇹뇻뇽누눅눈눋눌눔눕눗눙눠눴눼뉘뉜뉠뉨뉩뉴뉵뉼늄늅늉느늑는늘늙늚늠늡늣능늦늪늬늰늴니닉닌닐닒님닙닛닝닢다닥닦단닫\",4,\"닳담답닷\",4,\"닿대댁댄댈댐댑댓댔댕댜더덕덖던덛덜덞덟덤덥\"],[\"b541\",\"킕\",14,\"킦킧킩킪킫킭\",5],[\"b561\",\"킳킶킸킺\",5,\"탂탃탅탆탇탊\",5,\"탒탖\",4],[\"b581\",\"탛탞탟탡탢탣탥\",6,\"탮탲\",5,\"탹\",11,\"덧덩덫덮데덱덴델뎀뎁뎃뎄뎅뎌뎐뎔뎠뎡뎨뎬도독돈돋돌돎돐돔돕돗동돛돝돠돤돨돼됐되된될됨됩됫됴두둑둔둘둠둡둣둥둬뒀뒈뒝뒤뒨뒬뒵뒷뒹듀듄듈듐듕드득든듣들듦듬듭듯등듸디딕딘딛딜딤딥딧딨딩딪따딱딴딸\"],[\"b641\",\"턅\",7,\"턎\",17],[\"b661\",\"턠\",15,\"턲턳턵턶턷턹턻턼턽턾\"],[\"b681\",\"턿텂텆\",5,\"텎텏텑텒텓텕\",6,\"텞텠텢\",5,\"텩텪텫텭땀땁땃땄땅땋때땍땐땔땜땝땟땠땡떠떡떤떨떪떫떰떱떳떴떵떻떼떽뗀뗄뗌뗍뗏뗐뗑뗘뗬또똑똔똘똥똬똴뙈뙤뙨뚜뚝뚠뚤뚫뚬뚱뛔뛰뛴뛸뜀뜁뜅뜨뜩뜬뜯뜰뜸뜹뜻띄띈띌띔띕띠띤띨띰띱띳띵라락란랄람랍랏랐랑랒랖랗\"],[\"b741\",\"텮\",13,\"텽\",6,\"톅톆톇톉톊\"],[\"b761\",\"톋\",20,\"톢톣톥톦톧\"],[\"b781\",\"톩\",6,\"톲톴톶톷톸톹톻톽톾톿퇁\",14,\"래랙랜랠램랩랫랬랭랴략랸럇량러럭런럴럼럽럿렀렁렇레렉렌렐렘렙렛렝려력련렬렴렵렷렸령례롄롑롓로록론롤롬롭롯롱롸롼뢍뢨뢰뢴뢸룀룁룃룅료룐룔룝룟룡루룩룬룰룸룹룻룽뤄뤘뤠뤼뤽륀륄륌륏륑류륙륜률륨륩\"],[\"b841\",\"퇐\",7,\"퇙\",17],[\"b861\",\"퇫\",8,\"퇵퇶퇷퇹\",13],[\"b881\",\"툈툊\",5,\"툑\",24,\"륫륭르륵른를름릅릇릉릊릍릎리릭린릴림립릿링마막만많\",4,\"맘맙맛망맞맡맣매맥맨맬맴맵맷맸맹맺먀먁먈먕머먹먼멀멂멈멉멋멍멎멓메멕멘멜멤멥멧멨멩며멱면멸몃몄명몇몌모목몫몬몰몲몸몹못몽뫄뫈뫘뫙뫼\"],[\"b941\",\"툪툫툮툯툱툲툳툵\",6,\"툾퉀퉂\",5,\"퉉퉊퉋퉌\"],[\"b961\",\"퉍\",14,\"퉝\",6,\"퉥퉦퉧퉨\"],[\"b981\",\"퉩\",22,\"튂튃튅튆튇튉튊튋튌묀묄묍묏묑묘묜묠묩묫무묵묶문묻물묽묾뭄뭅뭇뭉뭍뭏뭐뭔뭘뭡뭣뭬뮈뮌뮐뮤뮨뮬뮴뮷므믄믈믐믓미믹민믿밀밂밈밉밋밌밍및밑바\",4,\"받\",4,\"밤밥밧방밭배백밴밸뱀뱁뱃뱄뱅뱉뱌뱍뱐뱝버벅번벋벌벎범법벗\"],[\"ba41\",\"튍튎튏튒튓튔튖\",5,\"튝튞튟튡튢튣튥\",6,\"튭\"],[\"ba61\",\"튮튯튰튲\",5,\"튺튻튽튾틁틃\",4,\"틊틌\",5],[\"ba81\",\"틒틓틕틖틗틙틚틛틝\",6,\"틦\",9,\"틲틳틵틶틷틹틺벙벚베벡벤벧벨벰벱벳벴벵벼벽변별볍볏볐병볕볘볜보복볶본볼봄봅봇봉봐봔봤봬뵀뵈뵉뵌뵐뵘뵙뵤뵨부북분붇불붉붊붐붑붓붕붙붚붜붤붰붸뷔뷕뷘뷜뷩뷰뷴뷸븀븃븅브븍븐블븜븝븟비빅빈빌빎빔빕빗빙빚빛빠빡빤\"],[\"bb41\",\"틻\",4,\"팂팄팆\",5,\"팏팑팒팓팕팗\",4,\"팞팢팣\"],[\"bb61\",\"팤팦팧팪팫팭팮팯팱\",6,\"팺팾\",5,\"퍆퍇퍈퍉\"],[\"bb81\",\"퍊\",31,\"빨빪빰빱빳빴빵빻빼빽뺀뺄뺌뺍뺏뺐뺑뺘뺙뺨뻐뻑뻔뻗뻘뻠뻣뻤뻥뻬뼁뼈뼉뼘뼙뼛뼜뼝뽀뽁뽄뽈뽐뽑뽕뾔뾰뿅뿌뿍뿐뿔뿜뿟뿡쀼쁑쁘쁜쁠쁨쁩삐삑삔삘삠삡삣삥사삭삯산삳살삵삶삼삽삿샀상샅새색샌샐샘샙샛샜생샤\"],[\"bc41\",\"퍪\",17,\"퍾퍿펁펂펃펅펆펇\"],[\"bc61\",\"펈펉펊펋펎펒\",5,\"펚펛펝펞펟펡\",6,\"펪펬펮\"],[\"bc81\",\"펯\",4,\"펵펶펷펹펺펻펽\",6,\"폆폇폊\",5,\"폑\",5,\"샥샨샬샴샵샷샹섀섄섈섐섕서\",4,\"섣설섦섧섬섭섯섰성섶세섹센셀셈셉셋셌셍셔셕션셜셤셥셧셨셩셰셴셸솅소속솎손솔솖솜솝솟송솥솨솩솬솰솽쇄쇈쇌쇔쇗쇘쇠쇤쇨쇰쇱쇳쇼쇽숀숄숌숍숏숑수숙순숟술숨숩숫숭\"],[\"bd41\",\"폗폙\",7,\"폢폤\",7,\"폮폯폱폲폳폵폶폷\"],[\"bd61\",\"폸폹폺폻폾퐀퐂\",5,\"퐉\",13],[\"bd81\",\"퐗\",5,\"퐞\",25,\"숯숱숲숴쉈쉐쉑쉔쉘쉠쉥쉬쉭쉰쉴쉼쉽쉿슁슈슉슐슘슛슝스슥슨슬슭슴습슷승시식신싣실싫심십싯싱싶싸싹싻싼쌀쌈쌉쌌쌍쌓쌔쌕쌘쌜쌤쌥쌨쌩썅써썩썬썰썲썸썹썼썽쎄쎈쎌쏀쏘쏙쏜쏟쏠쏢쏨쏩쏭쏴쏵쏸쐈쐐쐤쐬쐰\"],[\"be41\",\"퐸\",7,\"푁푂푃푅\",14],[\"be61\",\"푔\",7,\"푝푞푟푡푢푣푥\",7,\"푮푰푱푲\"],[\"be81\",\"푳\",4,\"푺푻푽푾풁풃\",4,\"풊풌풎\",5,\"풕\",8,\"쐴쐼쐽쑈쑤쑥쑨쑬쑴쑵쑹쒀쒔쒜쒸쒼쓩쓰쓱쓴쓸쓺쓿씀씁씌씐씔씜씨씩씬씰씸씹씻씽아악안앉않알앍앎앓암압앗았앙앝앞애액앤앨앰앱앳앴앵야약얀얄얇얌얍얏양얕얗얘얜얠얩어억언얹얻얼얽얾엄\",6,\"엌엎\"],[\"bf41\",\"풞\",10,\"풪\",14],[\"bf61\",\"풹\",18,\"퓍퓎퓏퓑퓒퓓퓕\"],[\"bf81\",\"퓖\",5,\"퓝퓞퓠\",7,\"퓩퓪퓫퓭퓮퓯퓱\",6,\"퓹퓺퓼에엑엔엘엠엡엣엥여역엮연열엶엷염\",5,\"옅옆옇예옌옐옘옙옛옜오옥온올옭옮옰옳옴옵옷옹옻와왁완왈왐왑왓왔왕왜왝왠왬왯왱외왹왼욀욈욉욋욍요욕욘욜욤욥욧용우욱운울욹욺움웁웃웅워웍원월웜웝웠웡웨\"],[\"c041\",\"퓾\",5,\"픅픆픇픉픊픋픍\",6,\"픖픘\",5],[\"c061\",\"픞\",25],[\"c081\",\"픸픹픺픻픾픿핁핂핃핅\",6,\"핎핐핒\",5,\"핚핛핝핞핟핡핢핣웩웬웰웸웹웽위윅윈윌윔윕윗윙유육윤율윰윱윳융윷으윽은을읊음읍읏응\",7,\"읜읠읨읫이익인일읽읾잃임입잇있잉잊잎자작잔잖잗잘잚잠잡잣잤장잦재잭잰잴잼잽잿쟀쟁쟈쟉쟌쟎쟐쟘쟝쟤쟨쟬저적전절젊\"],[\"c141\",\"핤핦핧핪핬핮\",5,\"핶핷핹핺핻핽\",6,\"햆햊햋\"],[\"c161\",\"햌햍햎햏햑\",19,\"햦햧\"],[\"c181\",\"햨\",31,\"점접젓정젖제젝젠젤젬젭젯젱져젼졀졈졉졌졍졔조족존졸졺좀좁좃종좆좇좋좌좍좔좝좟좡좨좼좽죄죈죌죔죕죗죙죠죡죤죵주죽준줄줅줆줌줍줏중줘줬줴쥐쥑쥔쥘쥠쥡쥣쥬쥰쥴쥼즈즉즌즐즘즙즛증지직진짇질짊짐집짓\"],[\"c241\",\"헊헋헍헎헏헑헓\",4,\"헚헜헞\",5,\"헦헧헩헪헫헭헮\"],[\"c261\",\"헯\",4,\"헶헸헺\",5,\"혂혃혅혆혇혉\",6,\"혒\"],[\"c281\",\"혖\",5,\"혝혞혟혡혢혣혥\",7,\"혮\",9,\"혺혻징짖짙짚짜짝짠짢짤짧짬짭짯짰짱째짹짼쨀쨈쨉쨋쨌쨍쨔쨘쨩쩌쩍쩐쩔쩜쩝쩟쩠쩡쩨쩽쪄쪘쪼쪽쫀쫄쫌쫍쫏쫑쫓쫘쫙쫠쫬쫴쬈쬐쬔쬘쬠쬡쭁쭈쭉쭌쭐쭘쭙쭝쭤쭸쭹쮜쮸쯔쯤쯧쯩찌찍찐찔찜찝찡찢찧차착찬찮찰참찹찻\"],[\"c341\",\"혽혾혿홁홂홃홄홆홇홊홌홎홏홐홒홓홖홗홙홚홛홝\",4],[\"c361\",\"홢\",4,\"홨홪\",5,\"홲홳홵\",11],[\"c381\",\"횁횂횄횆\",5,\"횎횏횑횒횓횕\",7,\"횞횠횢\",5,\"횩횪찼창찾채책챈챌챔챕챗챘챙챠챤챦챨챰챵처척천철첨첩첫첬청체첵첸첼쳄쳅쳇쳉쳐쳔쳤쳬쳰촁초촉촌촐촘촙촛총촤촨촬촹최쵠쵤쵬쵭쵯쵱쵸춈추축춘출춤춥춧충춰췄췌췐취췬췰췸췹췻췽츄츈츌츔츙츠측츤츨츰츱츳층\"],[\"c441\",\"횫횭횮횯횱\",7,\"횺횼\",7,\"훆훇훉훊훋\"],[\"c461\",\"훍훎훏훐훒훓훕훖훘훚\",5,\"훡훢훣훥훦훧훩\",4],[\"c481\",\"훮훯훱훲훳훴훶\",5,\"훾훿휁휂휃휅\",11,\"휒휓휔치칙친칟칠칡침칩칫칭카칵칸칼캄캅캇캉캐캑캔캘캠캡캣캤캥캬캭컁커컥컨컫컬컴컵컷컸컹케켁켄켈켐켑켓켕켜켠켤켬켭켯켰켱켸코콕콘콜콤콥콧콩콰콱콴콸쾀쾅쾌쾡쾨쾰쿄쿠쿡쿤쿨쿰쿱쿳쿵쿼퀀퀄퀑퀘퀭퀴퀵퀸퀼\"],[\"c541\",\"휕휖휗휚휛휝휞휟휡\",6,\"휪휬휮\",5,\"휶휷휹\"],[\"c561\",\"휺휻휽\",6,\"흅흆흈흊\",5,\"흒흓흕흚\",4],[\"c581\",\"흟흢흤흦흧흨흪흫흭흮흯흱흲흳흵\",6,\"흾흿힀힂\",5,\"힊힋큄큅큇큉큐큔큘큠크큭큰클큼큽킁키킥킨킬킴킵킷킹타탁탄탈탉탐탑탓탔탕태택탠탤탬탭탯탰탱탸턍터턱턴털턺텀텁텃텄텅테텍텐텔템텝텟텡텨텬텼톄톈토톡톤톨톰톱톳통톺톼퇀퇘퇴퇸툇툉툐투툭툰툴툼툽툿퉁퉈퉜\"],[\"c641\",\"힍힎힏힑\",6,\"힚힜힞\",5],[\"c6a1\",\"퉤튀튁튄튈튐튑튕튜튠튤튬튱트특튼튿틀틂틈틉틋틔틘틜틤틥티틱틴틸팀팁팃팅파팍팎판팔팖팜팝팟팠팡팥패팩팬팰팸팹팻팼팽퍄퍅퍼퍽펀펄펌펍펏펐펑페펙펜펠펨펩펫펭펴편펼폄폅폈평폐폘폡폣포폭폰폴폼폽폿퐁\"],[\"c7a1\",\"퐈퐝푀푄표푠푤푭푯푸푹푼푿풀풂품풉풋풍풔풩퓌퓐퓔퓜퓟퓨퓬퓰퓸퓻퓽프픈플픔픕픗피픽핀필핌핍핏핑하학한할핥함합핫항해핵핸핼햄햅햇했행햐향허헉헌헐헒험헙헛헝헤헥헨헬헴헵헷헹혀혁현혈혐협혓혔형혜혠\"],[\"c8a1\",\"혤혭호혹혼홀홅홈홉홋홍홑화확환활홧황홰홱홴횃횅회획횐횔횝횟횡효횬횰횹횻후훅훈훌훑훔훗훙훠훤훨훰훵훼훽휀휄휑휘휙휜휠휨휩휫휭휴휵휸휼흄흇흉흐흑흔흖흗흘흙흠흡흣흥흩희흰흴흼흽힁히힉힌힐힘힙힛힝\"],[\"caa1\",\"伽佳假價加可呵哥嘉嫁家暇架枷柯歌珂痂稼苛茄街袈訶賈跏軻迦駕刻却各恪慤殼珏脚覺角閣侃刊墾奸姦干幹懇揀杆柬桿澗癎看磵稈竿簡肝艮艱諫間乫喝曷渴碣竭葛褐蝎鞨勘坎堪嵌感憾戡敢柑橄減甘疳監瞰紺邯鑑鑒龕\"],[\"cba1\",\"匣岬甲胛鉀閘剛堈姜岡崗康强彊慷江畺疆糠絳綱羌腔舡薑襁講鋼降鱇介价個凱塏愷愾慨改槪漑疥皆盖箇芥蓋豈鎧開喀客坑更粳羹醵倨去居巨拒据據擧渠炬祛距踞車遽鉅鋸乾件健巾建愆楗腱虔蹇鍵騫乞傑杰桀儉劍劒檢\"],[\"cca1\",\"瞼鈐黔劫怯迲偈憩揭擊格檄激膈覡隔堅牽犬甄絹繭肩見譴遣鵑抉決潔結缺訣兼慊箝謙鉗鎌京俓倞傾儆勁勍卿坰境庚徑慶憬擎敬景暻更梗涇炅烱璟璥瓊痙硬磬竟競絅經耕耿脛莖警輕逕鏡頃頸驚鯨係啓堺契季屆悸戒桂械\"],[\"cda1\",\"棨溪界癸磎稽系繫繼計誡谿階鷄古叩告呱固姑孤尻庫拷攷故敲暠枯槁沽痼皐睾稿羔考股膏苦苽菰藁蠱袴誥賈辜錮雇顧高鼓哭斛曲梏穀谷鵠困坤崑昆梱棍滾琨袞鯤汨滑骨供公共功孔工恐恭拱控攻珙空蚣貢鞏串寡戈果瓜\"],[\"cea1\",\"科菓誇課跨過鍋顆廓槨藿郭串冠官寬慣棺款灌琯瓘管罐菅觀貫關館刮恝括适侊光匡壙廣曠洸炚狂珖筐胱鑛卦掛罫乖傀塊壞怪愧拐槐魁宏紘肱轟交僑咬喬嬌嶠巧攪敎校橋狡皎矯絞翹膠蕎蛟較轎郊餃驕鮫丘久九仇俱具勾\"],[\"cfa1\",\"區口句咎嘔坵垢寇嶇廐懼拘救枸柩構歐毆毬求溝灸狗玖球瞿矩究絿耉臼舅舊苟衢謳購軀逑邱鉤銶駒驅鳩鷗龜國局菊鞠鞫麴君窘群裙軍郡堀屈掘窟宮弓穹窮芎躬倦券勸卷圈拳捲權淃眷厥獗蕨蹶闕机櫃潰詭軌饋句晷歸貴\"],[\"d0a1\",\"鬼龜叫圭奎揆槻珪硅窺竅糾葵規赳逵閨勻均畇筠菌鈞龜橘克剋劇戟棘極隙僅劤勤懃斤根槿瑾筋芹菫覲謹近饉契今妗擒昑檎琴禁禽芩衾衿襟金錦伋及急扱汲級給亘兢矜肯企伎其冀嗜器圻基埼夔奇妓寄岐崎己幾忌技旗旣\"],[\"d1a1\",\"朞期杞棋棄機欺氣汽沂淇玘琦琪璂璣畸畿碁磯祁祇祈祺箕紀綺羈耆耭肌記譏豈起錡錤飢饑騎騏驥麒緊佶吉拮桔金喫儺喇奈娜懦懶拏拿癩\",5,\"那樂\",4,\"諾酪駱亂卵暖欄煖爛蘭難鸞捏捺南嵐枏楠湳濫男藍襤拉\"],[\"d2a1\",\"納臘蠟衲囊娘廊\",4,\"乃來內奈柰耐冷女年撚秊念恬拈捻寧寗努勞奴弩怒擄櫓爐瑙盧\",5,\"駑魯\",10,\"濃籠聾膿農惱牢磊腦賂雷尿壘\",7,\"嫩訥杻紐勒\",5,\"能菱陵尼泥匿溺多茶\"],[\"d3a1\",\"丹亶但單團壇彖斷旦檀段湍短端簞緞蛋袒鄲鍛撻澾獺疸達啖坍憺擔曇淡湛潭澹痰聃膽蕁覃談譚錟沓畓答踏遝唐堂塘幢戇撞棠當糖螳黨代垈坮大對岱帶待戴擡玳臺袋貸隊黛宅德悳倒刀到圖堵塗導屠島嶋度徒悼挑掉搗桃\"],[\"d4a1\",\"棹櫂淘渡滔濤燾盜睹禱稻萄覩賭跳蹈逃途道都鍍陶韜毒瀆牘犢獨督禿篤纛讀墩惇敦旽暾沌焞燉豚頓乭突仝冬凍動同憧東桐棟洞潼疼瞳童胴董銅兜斗杜枓痘竇荳讀豆逗頭屯臀芚遁遯鈍得嶝橙燈登等藤謄鄧騰喇懶拏癩羅\"],[\"d5a1\",\"蘿螺裸邏樂洛烙珞絡落諾酪駱丹亂卵欄欒瀾爛蘭鸞剌辣嵐擥攬欖濫籃纜藍襤覽拉臘蠟廊朗浪狼琅瑯螂郞來崍徠萊冷掠略亮倆兩凉梁樑粮粱糧良諒輛量侶儷勵呂廬慮戾旅櫚濾礪藜蠣閭驢驪麗黎力曆歷瀝礫轢靂憐戀攣漣\"],[\"d6a1\",\"煉璉練聯蓮輦連鍊冽列劣洌烈裂廉斂殮濂簾獵令伶囹寧岺嶺怜玲笭羚翎聆逞鈴零靈領齡例澧禮醴隷勞怒撈擄櫓潞瀘爐盧老蘆虜路輅露魯鷺鹵碌祿綠菉錄鹿麓論壟弄朧瀧瓏籠聾儡瀨牢磊賂賚賴雷了僚寮廖料燎療瞭聊蓼\"],[\"d7a1\",\"遼鬧龍壘婁屢樓淚漏瘻累縷蔞褸鏤陋劉旒柳榴流溜瀏琉瑠留瘤硫謬類六戮陸侖倫崙淪綸輪律慄栗率隆勒肋凜凌楞稜綾菱陵俚利厘吏唎履悧李梨浬犁狸理璃異痢籬罹羸莉裏裡里釐離鯉吝潾燐璘藺躪隣鱗麟林淋琳臨霖砬\"],[\"d8a1\",\"立笠粒摩瑪痲碼磨馬魔麻寞幕漠膜莫邈万卍娩巒彎慢挽晩曼滿漫灣瞞萬蔓蠻輓饅鰻唜抹末沫茉襪靺亡妄忘忙望網罔芒茫莽輞邙埋妹媒寐昧枚梅每煤罵買賣邁魅脈貊陌驀麥孟氓猛盲盟萌冪覓免冕勉棉沔眄眠綿緬面麵滅\"],[\"d9a1\",\"蔑冥名命明暝椧溟皿瞑茗蓂螟酩銘鳴袂侮冒募姆帽慕摸摹暮某模母毛牟牡瑁眸矛耗芼茅謀謨貌木沐牧目睦穆鶩歿沒夢朦蒙卯墓妙廟描昴杳渺猫竗苗錨務巫憮懋戊拇撫无楙武毋無珷畝繆舞茂蕪誣貿霧鵡墨默們刎吻問文\"],[\"daa1\",\"汶紊紋聞蚊門雯勿沕物味媚尾嵋彌微未梶楣渼湄眉米美薇謎迷靡黴岷悶愍憫敏旻旼民泯玟珉緡閔密蜜謐剝博拍搏撲朴樸泊珀璞箔粕縛膊舶薄迫雹駁伴半反叛拌搬攀斑槃泮潘班畔瘢盤盼磐磻礬絆般蟠返頒飯勃拔撥渤潑\"],[\"dba1\",\"發跋醱鉢髮魃倣傍坊妨尨幇彷房放方旁昉枋榜滂磅紡肪膀舫芳蒡蚌訪謗邦防龐倍俳北培徘拜排杯湃焙盃背胚裴裵褙賠輩配陪伯佰帛柏栢白百魄幡樊煩燔番磻繁蕃藩飜伐筏罰閥凡帆梵氾汎泛犯範范法琺僻劈壁擘檗璧癖\"],[\"dca1\",\"碧蘗闢霹便卞弁變辨辯邊別瞥鱉鼈丙倂兵屛幷昞昺柄棅炳甁病秉竝輧餠騈保堡報寶普步洑湺潽珤甫菩補褓譜輔伏僕匐卜宓復服福腹茯蔔複覆輹輻馥鰒本乶俸奉封峯峰捧棒烽熢琫縫蓬蜂逢鋒鳳不付俯傅剖副否咐埠夫婦\"],[\"dda1\",\"孚孵富府復扶敷斧浮溥父符簿缶腐腑膚艀芙莩訃負賦賻赴趺部釜阜附駙鳧北分吩噴墳奔奮忿憤扮昐汾焚盆粉糞紛芬賁雰不佛弗彿拂崩朋棚硼繃鵬丕備匕匪卑妃婢庇悲憊扉批斐枇榧比毖毗毘沸泌琵痺砒碑秕秘粃緋翡肥\"],[\"dea1\",\"脾臂菲蜚裨誹譬費鄙非飛鼻嚬嬪彬斌檳殯浜濱瀕牝玭貧賓頻憑氷聘騁乍事些仕伺似使俟僿史司唆嗣四士奢娑寫寺射巳師徙思捨斜斯柶査梭死沙泗渣瀉獅砂社祀祠私篩紗絲肆舍莎蓑蛇裟詐詞謝賜赦辭邪飼駟麝削數朔索\"],[\"dfa1\",\"傘刪山散汕珊産疝算蒜酸霰乷撒殺煞薩三參杉森渗芟蔘衫揷澁鈒颯上傷像償商喪嘗孀尙峠常床庠廂想桑橡湘爽牀狀相祥箱翔裳觴詳象賞霜塞璽賽嗇塞穡索色牲生甥省笙墅壻嶼序庶徐恕抒捿敍暑曙書栖棲犀瑞筮絮緖署\"],[\"e0a1\",\"胥舒薯西誓逝鋤黍鼠夕奭席惜昔晳析汐淅潟石碩蓆釋錫仙僊先善嬋宣扇敾旋渲煽琁瑄璇璿癬禪線繕羨腺膳船蘚蟬詵跣選銑鐥饍鮮卨屑楔泄洩渫舌薛褻設說雪齧剡暹殲纖蟾贍閃陝攝涉燮葉城姓宬性惺成星晟猩珹盛省筬\"],[\"e1a1\",\"聖聲腥誠醒世勢歲洗稅笹細說貰召嘯塑宵小少巢所掃搔昭梳沼消溯瀟炤燒甦疏疎瘙笑篠簫素紹蔬蕭蘇訴逍遡邵銷韶騷俗屬束涑粟續謖贖速孫巽損蓀遜飡率宋悚松淞訟誦送頌刷殺灑碎鎖衰釗修受嗽囚垂壽嫂守岫峀帥愁\"],[\"e2a1\",\"戍手授搜收數樹殊水洙漱燧狩獸琇璲瘦睡秀穗竪粹綏綬繡羞脩茱蒐蓚藪袖誰讐輸遂邃酬銖銹隋隧隨雖需須首髓鬚叔塾夙孰宿淑潚熟琡璹肅菽巡徇循恂旬栒楯橓殉洵淳珣盾瞬筍純脣舜荀蓴蕣詢諄醇錞順馴戌術述鉥崇崧\"],[\"e3a1\",\"嵩瑟膝蝨濕拾習褶襲丞乘僧勝升承昇繩蠅陞侍匙嘶始媤尸屎屍市弑恃施是時枾柴猜矢示翅蒔蓍視試詩諡豕豺埴寔式息拭植殖湜熄篒蝕識軾食飾伸侁信呻娠宸愼新晨燼申神紳腎臣莘薪藎蜃訊身辛辰迅失室實悉審尋心沁\"],[\"e4a1\",\"沈深瀋甚芯諶什十拾雙氏亞俄兒啞娥峨我牙芽莪蛾衙訝阿雅餓鴉鵝堊岳嶽幄惡愕握樂渥鄂鍔顎鰐齷安岸按晏案眼雁鞍顔鮟斡謁軋閼唵岩巖庵暗癌菴闇壓押狎鴨仰央怏昻殃秧鴦厓哀埃崖愛曖涯碍艾隘靄厄扼掖液縊腋額\"],[\"e5a1\",\"櫻罌鶯鸚也倻冶夜惹揶椰爺耶若野弱掠略約若葯蒻藥躍亮佯兩凉壤孃恙揚攘敭暘梁楊樣洋瀁煬痒瘍禳穰糧羊良襄諒讓釀陽量養圄御於漁瘀禦語馭魚齬億憶抑檍臆偃堰彦焉言諺孼蘖俺儼嚴奄掩淹嶪業円予余勵呂女如廬\"],[\"e6a1\",\"旅歟汝濾璵礖礪與艅茹輿轝閭餘驪麗黎亦力域役易曆歷疫繹譯轢逆驛嚥堧姸娟宴年延憐戀捐挻撚椽沇沿涎涓淵演漣烟然煙煉燃燕璉硏硯秊筵緣練縯聯衍軟輦蓮連鉛鍊鳶列劣咽悅涅烈熱裂說閱厭廉念捻染殮炎焰琰艶苒\"],[\"e7a1\",\"簾閻髥鹽曄獵燁葉令囹塋寧嶺嶸影怜映暎楹榮永泳渶潁濚瀛瀯煐營獰玲瑛瑩瓔盈穎纓羚聆英詠迎鈴鍈零霙靈領乂倪例刈叡曳汭濊猊睿穢芮藝蘂禮裔詣譽豫醴銳隸霓預五伍俉傲午吾吳嗚塢墺奧娛寤悟惡懊敖旿晤梧汚澳\"],[\"e8a1\",\"烏熬獒筽蜈誤鰲鼇屋沃獄玉鈺溫瑥瘟穩縕蘊兀壅擁瓮甕癰翁邕雍饔渦瓦窩窪臥蛙蝸訛婉完宛梡椀浣玩琓琬碗緩翫脘腕莞豌阮頑曰往旺枉汪王倭娃歪矮外嵬巍猥畏了僚僥凹堯夭妖姚寥寮尿嶢拗搖撓擾料曜樂橈燎燿瑤療\"],[\"e9a1\",\"窈窯繇繞耀腰蓼蟯要謠遙遼邀饒慾欲浴縟褥辱俑傭冗勇埇墉容庸慂榕涌湧溶熔瑢用甬聳茸蓉踊鎔鏞龍于佑偶優又友右宇寓尤愚憂旴牛玗瑀盂祐禑禹紆羽芋藕虞迂遇郵釪隅雨雩勖彧旭昱栯煜稶郁頊云暈橒殞澐熉耘芸蕓\"],[\"eaa1\",\"運隕雲韻蔚鬱亐熊雄元原員圓園垣媛嫄寃怨愿援沅洹湲源爰猿瑗苑袁轅遠阮院願鴛月越鉞位偉僞危圍委威尉慰暐渭爲瑋緯胃萎葦蔿蝟衛褘謂違韋魏乳侑儒兪劉唯喩孺宥幼幽庾悠惟愈愉揄攸有杻柔柚柳楡楢油洧流游溜\"],[\"eba1\",\"濡猶猷琉瑜由留癒硫紐維臾萸裕誘諛諭踰蹂遊逾遺酉釉鍮類六堉戮毓肉育陸倫允奫尹崙淪潤玧胤贇輪鈗閏律慄栗率聿戎瀜絨融隆垠恩慇殷誾銀隱乙吟淫蔭陰音飮揖泣邑凝應膺鷹依倚儀宜意懿擬椅毅疑矣義艤薏蟻衣誼\"],[\"eca1\",\"議醫二以伊利吏夷姨履已弛彛怡易李梨泥爾珥理異痍痢移罹而耳肄苡荑裏裡貽貳邇里離飴餌匿溺瀷益翊翌翼謚人仁刃印吝咽因姻寅引忍湮燐璘絪茵藺蚓認隣靭靷鱗麟一佚佾壹日溢逸鎰馹任壬妊姙恁林淋稔臨荏賃入卄\"],[\"eda1\",\"立笠粒仍剩孕芿仔刺咨姉姿子字孜恣慈滋炙煮玆瓷疵磁紫者自茨蔗藉諮資雌作勺嚼斫昨灼炸爵綽芍酌雀鵲孱棧殘潺盞岑暫潛箴簪蠶雜丈仗匠場墻壯奬將帳庄張掌暲杖樟檣欌漿牆狀獐璋章粧腸臟臧莊葬蔣薔藏裝贓醬長\"],[\"eea1\",\"障再哉在宰才材栽梓渽滓災縡裁財載齋齎爭箏諍錚佇低儲咀姐底抵杵楮樗沮渚狙猪疽箸紵苧菹著藷詛貯躇這邸雎齟勣吊嫡寂摘敵滴狄炙的積笛籍績翟荻謫賊赤跡蹟迪迹適鏑佃佺傳全典前剪塡塼奠專展廛悛戰栓殿氈澱\"],[\"efa1\",\"煎琠田甸畑癲筌箋箭篆纏詮輾轉鈿銓錢鐫電顚顫餞切截折浙癤竊節絶占岾店漸点粘霑鮎點接摺蝶丁井亭停偵呈姃定幀庭廷征情挺政整旌晶晸柾楨檉正汀淀淨渟湞瀞炡玎珽町睛碇禎程穽精綎艇訂諪貞鄭酊釘鉦鋌錠霆靖\"],[\"f0a1\",\"靜頂鼎制劑啼堤帝弟悌提梯濟祭第臍薺製諸蹄醍除際霽題齊俎兆凋助嘲弔彫措操早晁曺曹朝條棗槽漕潮照燥爪璪眺祖祚租稠窕粗糟組繰肇藻蚤詔調趙躁造遭釣阻雕鳥族簇足鏃存尊卒拙猝倧宗從悰慫棕淙琮種終綜縱腫\"],[\"f1a1\",\"踪踵鍾鐘佐坐左座挫罪主住侏做姝胄呪周嗾奏宙州廚晝朱柱株注洲湊澍炷珠疇籌紂紬綢舟蛛註誅走躊輳週酎酒鑄駐竹粥俊儁准埈寯峻晙樽浚準濬焌畯竣蠢逡遵雋駿茁中仲衆重卽櫛楫汁葺增憎曾拯烝甑症繒蒸證贈之只\"],[\"f2a1\",\"咫地址志持指摯支旨智枝枳止池沚漬知砥祉祗紙肢脂至芝芷蜘誌識贄趾遲直稙稷織職唇嗔塵振搢晉晋桭榛殄津溱珍瑨璡畛疹盡眞瞋秦縉縝臻蔯袗診賑軫辰進鎭陣陳震侄叱姪嫉帙桎瓆疾秩窒膣蛭質跌迭斟朕什執潗緝輯\"],[\"f3a1\",\"鏶集徵懲澄且侘借叉嗟嵯差次此磋箚茶蹉車遮捉搾着窄錯鑿齪撰澯燦璨瓚竄簒纂粲纘讚贊鑽餐饌刹察擦札紮僭參塹慘慙懺斬站讒讖倉倡創唱娼廠彰愴敞昌昶暢槍滄漲猖瘡窓脹艙菖蒼債埰寀寨彩採砦綵菜蔡采釵冊柵策\"],[\"f4a1\",\"責凄妻悽處倜刺剔尺慽戚拓擲斥滌瘠脊蹠陟隻仟千喘天川擅泉淺玔穿舛薦賤踐遷釧闡阡韆凸哲喆徹撤澈綴輟轍鐵僉尖沾添甛瞻簽籤詹諂堞妾帖捷牒疊睫諜貼輒廳晴淸聽菁請靑鯖切剃替涕滯締諦逮遞體初剿哨憔抄招梢\"],[\"f5a1\",\"椒楚樵炒焦硝礁礎秒稍肖艸苕草蕉貂超酢醋醮促囑燭矗蜀觸寸忖村邨叢塚寵悤憁摠總聰蔥銃撮催崔最墜抽推椎楸樞湫皺秋芻萩諏趨追鄒酋醜錐錘鎚雛騶鰍丑畜祝竺筑築縮蓄蹙蹴軸逐春椿瑃出朮黜充忠沖蟲衝衷悴膵萃\"],[\"f6a1\",\"贅取吹嘴娶就炊翠聚脆臭趣醉驟鷲側仄厠惻測層侈値嗤峙幟恥梔治淄熾痔痴癡稚穉緇緻置致蚩輜雉馳齒則勅飭親七柒漆侵寢枕沈浸琛砧針鍼蟄秤稱快他咤唾墮妥惰打拖朶楕舵陀馱駝倬卓啄坼度托拓擢晫柝濁濯琢琸託\"],[\"f7a1\",\"鐸呑嘆坦彈憚歎灘炭綻誕奪脫探眈耽貪塔搭榻宕帑湯糖蕩兌台太怠態殆汰泰笞胎苔跆邰颱宅擇澤撑攄兎吐土討慟桶洞痛筒統通堆槌腿褪退頹偸套妬投透鬪慝特闖坡婆巴把播擺杷波派爬琶破罷芭跛頗判坂板版瓣販辦鈑\"],[\"f8a1\",\"阪八叭捌佩唄悖敗沛浿牌狽稗覇貝彭澎烹膨愎便偏扁片篇編翩遍鞭騙貶坪平枰萍評吠嬖幣廢弊斃肺蔽閉陛佈包匍匏咆哺圃布怖抛抱捕暴泡浦疱砲胞脯苞葡蒲袍褒逋鋪飽鮑幅暴曝瀑爆輻俵剽彪慓杓標漂瓢票表豹飇飄驃\"],[\"f9a1\",\"品稟楓諷豊風馮彼披疲皮被避陂匹弼必泌珌畢疋筆苾馝乏逼下何厦夏廈昰河瑕荷蝦賀遐霞鰕壑學虐謔鶴寒恨悍旱汗漢澣瀚罕翰閑閒限韓割轄函含咸啣喊檻涵緘艦銜陷鹹合哈盒蛤閤闔陜亢伉姮嫦巷恒抗杭桁沆港缸肛航\"],[\"faa1\",\"行降項亥偕咳垓奚孩害懈楷海瀣蟹解該諧邂駭骸劾核倖幸杏荇行享向嚮珦鄕響餉饗香噓墟虛許憲櫶獻軒歇險驗奕爀赫革俔峴弦懸晛泫炫玄玹現眩睍絃絢縣舷衒見賢鉉顯孑穴血頁嫌俠協夾峽挾浹狹脅脇莢鋏頰亨兄刑型\"],[\"fba1\",\"形泂滎瀅灐炯熒珩瑩荊螢衡逈邢鎣馨兮彗惠慧暳蕙蹊醯鞋乎互呼壕壺好岵弧戶扈昊晧毫浩淏湖滸澔濠濩灝狐琥瑚瓠皓祜糊縞胡芦葫蒿虎號蝴護豪鎬頀顥惑或酷婚昏混渾琿魂忽惚笏哄弘汞泓洪烘紅虹訌鴻化和嬅樺火畵\"],[\"fca1\",\"禍禾花華話譁貨靴廓擴攫確碻穫丸喚奐宦幻患換歡晥桓渙煥環紈還驩鰥活滑猾豁闊凰幌徨恍惶愰慌晃晄榥況湟滉潢煌璜皇篁簧荒蝗遑隍黃匯回廻徊恢悔懷晦會檜淮澮灰獪繪膾茴蛔誨賄劃獲宖橫鐄哮嚆孝效斅曉梟涍淆\"],[\"fda1\",\"爻肴酵驍侯候厚后吼喉嗅帿後朽煦珝逅勛勳塤壎焄熏燻薰訓暈薨喧暄煊萱卉喙毁彙徽揮暉煇諱輝麾休携烋畦虧恤譎鷸兇凶匈洶胸黑昕欣炘痕吃屹紇訖欠欽歆吸恰洽翕興僖凞喜噫囍姬嬉希憙憘戱晞曦熙熹熺犧禧稀羲詰\"]]");
})), Mm = /* @__PURE__ */ i({ default: () => Nm }), Nm, Pm = n((() => {
	Nm = /*#__PURE__*/ JSON.parse("[[\"0\",\"\\u0000\",127],[\"a140\",\"　，、。．‧；：？！︰…‥﹐﹑﹒·﹔﹕﹖﹗｜–︱—︳╴︴﹏（）︵︶｛｝︷︸〔〕︹︺【】︻︼《》︽︾〈〉︿﹀「」﹁﹂『』﹃﹄﹙﹚\"],[\"a1a1\",\"﹛﹜﹝﹞‘’“”〝〞‵′＃＆＊※§〃○●△▲◎☆★◇◆□■▽▼㊣℅¯￣＿ˍ﹉﹊﹍﹎﹋﹌﹟﹠﹡＋－×÷±√＜＞＝≦≧≠∞≒≡﹢\",4,\"～∩∪⊥∠∟⊿㏒㏑∫∮∵∴♀♂⊕⊙↑↓←→↖↗↙↘∥∣／\"],[\"a240\",\"＼∕﹨＄￥〒￠￡％＠℃℉﹩﹪﹫㏕㎜㎝㎞㏎㎡㎎㎏㏄°兙兛兞兝兡兣嗧瓩糎▁\",7,\"▏▎▍▌▋▊▉┼┴┬┤├▔─│▕┌┐└┘╭\"],[\"a2a1\",\"╮╰╯═╞╪╡◢◣◥◤╱╲╳０\",9,\"Ⅰ\",9,\"〡\",8,\"十卄卅Ａ\",25,\"ａ\",21],[\"a340\",\"ｗｘｙｚΑ\",16,\"Σ\",6,\"α\",16,\"σ\",6,\"ㄅ\",10],[\"a3a1\",\"ㄐ\",25,\"˙ˉˊˇˋ\"],[\"a3e1\",\"€\"],[\"a440\",\"一乙丁七乃九了二人儿入八几刀刁力匕十卜又三下丈上丫丸凡久么也乞于亡兀刃勺千叉口土士夕大女子孑孓寸小尢尸山川工己已巳巾干廾弋弓才\"],[\"a4a1\",\"丑丐不中丰丹之尹予云井互五亢仁什仃仆仇仍今介仄元允內六兮公冗凶分切刈勻勾勿化匹午升卅卞厄友及反壬天夫太夭孔少尤尺屯巴幻廿弔引心戈戶手扎支文斗斤方日曰月木欠止歹毋比毛氏水火爪父爻片牙牛犬王丙\"],[\"a540\",\"世丕且丘主乍乏乎以付仔仕他仗代令仙仞充兄冉冊冬凹出凸刊加功包匆北匝仟半卉卡占卯卮去可古右召叮叩叨叼司叵叫另只史叱台句叭叻四囚外\"],[\"a5a1\",\"央失奴奶孕它尼巨巧左市布平幼弁弘弗必戊打扔扒扑斥旦朮本未末札正母民氐永汁汀氾犯玄玉瓜瓦甘生用甩田由甲申疋白皮皿目矛矢石示禾穴立丞丟乒乓乩亙交亦亥仿伉伙伊伕伍伐休伏仲件任仰仳份企伋光兇兆先全\"],[\"a640\",\"共再冰列刑划刎刖劣匈匡匠印危吉吏同吊吐吁吋各向名合吃后吆吒因回囝圳地在圭圬圯圩夙多夷夸妄奸妃好她如妁字存宇守宅安寺尖屹州帆并年\"],[\"a6a1\",\"式弛忙忖戎戌戍成扣扛托收早旨旬旭曲曳有朽朴朱朵次此死氖汝汗汙江池汐汕污汛汍汎灰牟牝百竹米糸缶羊羽老考而耒耳聿肉肋肌臣自至臼舌舛舟艮色艾虫血行衣西阡串亨位住佇佗佞伴佛何估佐佑伽伺伸佃佔似但佣\"],[\"a740\",\"作你伯低伶余佝佈佚兌克免兵冶冷別判利刪刨劫助努劬匣即卵吝吭吞吾否呎吧呆呃吳呈呂君吩告吹吻吸吮吵吶吠吼呀吱含吟听囪困囤囫坊坑址坍\"],[\"a7a1\",\"均坎圾坐坏圻壯夾妝妒妨妞妣妙妖妍妤妓妊妥孝孜孚孛完宋宏尬局屁尿尾岐岑岔岌巫希序庇床廷弄弟彤形彷役忘忌志忍忱快忸忪戒我抄抗抖技扶抉扭把扼找批扳抒扯折扮投抓抑抆改攻攸旱更束李杏材村杜杖杞杉杆杠\"],[\"a840\",\"杓杗步每求汞沙沁沈沉沅沛汪決沐汰沌汨沖沒汽沃汲汾汴沆汶沍沔沘沂灶灼災灸牢牡牠狄狂玖甬甫男甸皂盯矣私秀禿究系罕肖肓肝肘肛肚育良芒\"],[\"a8a1\",\"芋芍見角言谷豆豕貝赤走足身車辛辰迂迆迅迄巡邑邢邪邦那酉釆里防阮阱阪阬並乖乳事些亞享京佯依侍佳使佬供例來侃佰併侈佩佻侖佾侏侑佺兔兒兕兩具其典冽函刻券刷刺到刮制剁劾劻卒協卓卑卦卷卸卹取叔受味呵\"],[\"a940\",\"咖呸咕咀呻呷咄咒咆呼咐呱呶和咚呢周咋命咎固垃坷坪坩坡坦坤坼夜奉奇奈奄奔妾妻委妹妮姑姆姐姍始姓姊妯妳姒姅孟孤季宗定官宜宙宛尚屈居\"],[\"a9a1\",\"屆岷岡岸岩岫岱岳帘帚帖帕帛帑幸庚店府底庖延弦弧弩往征彿彼忝忠忽念忿怏怔怯怵怖怪怕怡性怩怫怛或戕房戾所承拉拌拄抿拂抹拒招披拓拔拋拈抨抽押拐拙拇拍抵拚抱拘拖拗拆抬拎放斧於旺昔易昌昆昂明昀昏昕昊\"],[\"aa40\",\"昇服朋杭枋枕東果杳杷枇枝林杯杰板枉松析杵枚枓杼杪杲欣武歧歿氓氛泣注泳沱泌泥河沽沾沼波沫法泓沸泄油況沮泗泅泱沿治泡泛泊沬泯泜泖泠\"],[\"aaa1\",\"炕炎炒炊炙爬爭爸版牧物狀狎狙狗狐玩玨玟玫玥甽疝疙疚的盂盲直知矽社祀祁秉秈空穹竺糾罔羌羋者肺肥肢肱股肫肩肴肪肯臥臾舍芳芝芙芭芽芟芹花芬芥芯芸芣芰芾芷虎虱初表軋迎返近邵邸邱邶采金長門阜陀阿阻附\"],[\"ab40\",\"陂隹雨青非亟亭亮信侵侯便俠俑俏保促侶俘俟俊俗侮俐俄係俚俎俞侷兗冒冑冠剎剃削前剌剋則勇勉勃勁匍南卻厚叛咬哀咨哎哉咸咦咳哇哂咽咪品\"],[\"aba1\",\"哄哈咯咫咱咻咩咧咿囿垂型垠垣垢城垮垓奕契奏奎奐姜姘姿姣姨娃姥姪姚姦威姻孩宣宦室客宥封屎屏屍屋峙峒巷帝帥帟幽庠度建弈弭彥很待徊律徇後徉怒思怠急怎怨恍恰恨恢恆恃恬恫恪恤扁拜挖按拼拭持拮拽指拱拷\"],[\"ac40\",\"拯括拾拴挑挂政故斫施既春昭映昧是星昨昱昤曷柿染柱柔某柬架枯柵柩柯柄柑枴柚查枸柏柞柳枰柙柢柝柒歪殃殆段毒毗氟泉洋洲洪流津洌洱洞洗\"],[\"aca1\",\"活洽派洶洛泵洹洧洸洩洮洵洎洫炫為炳炬炯炭炸炮炤爰牲牯牴狩狠狡玷珊玻玲珍珀玳甚甭畏界畎畋疫疤疥疢疣癸皆皇皈盈盆盃盅省盹相眉看盾盼眇矜砂研砌砍祆祉祈祇禹禺科秒秋穿突竿竽籽紂紅紀紉紇約紆缸美羿耄\"],[\"ad40\",\"耐耍耑耶胖胥胚胃胄背胡胛胎胞胤胝致舢苧范茅苣苛苦茄若茂茉苒苗英茁苜苔苑苞苓苟苯茆虐虹虻虺衍衫要觔計訂訃貞負赴赳趴軍軌述迦迢迪迥\"],[\"ada1\",\"迭迫迤迨郊郎郁郃酋酊重閂限陋陌降面革韋韭音頁風飛食首香乘亳倌倍倣俯倦倥俸倩倖倆值借倚倒們俺倀倔倨俱倡個候倘俳修倭倪俾倫倉兼冤冥冢凍凌准凋剖剜剔剛剝匪卿原厝叟哨唐唁唷哼哥哲唆哺唔哩哭員唉哮哪\"],[\"ae40\",\"哦唧唇哽唏圃圄埂埔埋埃堉夏套奘奚娑娘娜娟娛娓姬娠娣娩娥娌娉孫屘宰害家宴宮宵容宸射屑展屐峭峽峻峪峨峰島崁峴差席師庫庭座弱徒徑徐恙\"],[\"aea1\",\"恣恥恐恕恭恩息悄悟悚悍悔悌悅悖扇拳挈拿捎挾振捕捂捆捏捉挺捐挽挪挫挨捍捌效敉料旁旅時晉晏晃晒晌晅晁書朔朕朗校核案框桓根桂桔栩梳栗桌桑栽柴桐桀格桃株桅栓栘桁殊殉殷氣氧氨氦氤泰浪涕消涇浦浸海浙涓\"],[\"af40\",\"浬涉浮浚浴浩涌涊浹涅浥涔烊烘烤烙烈烏爹特狼狹狽狸狷玆班琉珮珠珪珞畔畝畜畚留疾病症疲疳疽疼疹痂疸皋皰益盍盎眩真眠眨矩砰砧砸砝破砷\"],[\"afa1\",\"砥砭砠砟砲祕祐祠祟祖神祝祗祚秤秣秧租秦秩秘窄窈站笆笑粉紡紗紋紊素索純紐紕級紜納紙紛缺罟羔翅翁耆耘耕耙耗耽耿胱脂胰脅胭胴脆胸胳脈能脊胼胯臭臬舀舐航舫舨般芻茫荒荔荊茸荐草茵茴荏茲茹茶茗荀茱茨荃\"],[\"b040\",\"虔蚊蚪蚓蚤蚩蚌蚣蚜衰衷袁袂衽衹記訐討訌訕訊託訓訖訏訑豈豺豹財貢起躬軒軔軏辱送逆迷退迺迴逃追逅迸邕郡郝郢酒配酌釘針釗釜釙閃院陣陡\"],[\"b0a1\",\"陛陝除陘陞隻飢馬骨高鬥鬲鬼乾偺偽停假偃偌做偉健偶偎偕偵側偷偏倏偯偭兜冕凰剪副勒務勘動匐匏匙匿區匾參曼商啪啦啄啞啡啃啊唱啖問啕唯啤唸售啜唬啣唳啁啗圈國圉域堅堊堆埠埤基堂堵執培夠奢娶婁婉婦婪婀\"],[\"b140\",\"娼婢婚婆婊孰寇寅寄寂宿密尉專將屠屜屝崇崆崎崛崖崢崑崩崔崙崤崧崗巢常帶帳帷康庸庶庵庾張強彗彬彩彫得徙從徘御徠徜恿患悉悠您惋悴惦悽\"],[\"b1a1\",\"情悻悵惜悼惘惕惆惟悸惚惇戚戛扈掠控捲掖探接捷捧掘措捱掩掉掃掛捫推掄授掙採掬排掏掀捻捩捨捺敝敖救教敗啟敏敘敕敔斜斛斬族旋旌旎晝晚晤晨晦晞曹勗望梁梯梢梓梵桿桶梱梧梗械梃棄梭梆梅梔條梨梟梡梂欲殺\"],[\"b240\",\"毫毬氫涎涼淳淙液淡淌淤添淺清淇淋涯淑涮淞淹涸混淵淅淒渚涵淚淫淘淪深淮淨淆淄涪淬涿淦烹焉焊烽烯爽牽犁猜猛猖猓猙率琅琊球理現琍瓠瓶\"],[\"b2a1\",\"瓷甜產略畦畢異疏痔痕疵痊痍皎盔盒盛眷眾眼眶眸眺硫硃硎祥票祭移窒窕笠笨笛第符笙笞笮粒粗粕絆絃統紮紹紼絀細紳組累終紲紱缽羞羚翌翎習耜聊聆脯脖脣脫脩脰脤舂舵舷舶船莎莞莘荸莢莖莽莫莒莊莓莉莠荷荻荼\"],[\"b340\",\"莆莧處彪蛇蛀蚶蛄蚵蛆蛋蚱蚯蛉術袞袈被袒袖袍袋覓規訪訝訣訥許設訟訛訢豉豚販責貫貨貪貧赧赦趾趺軛軟這逍通逗連速逝逐逕逞造透逢逖逛途\"],[\"b3a1\",\"部郭都酗野釵釦釣釧釭釩閉陪陵陳陸陰陴陶陷陬雀雪雩章竟頂頃魚鳥鹵鹿麥麻傢傍傅備傑傀傖傘傚最凱割剴創剩勞勝勛博厥啻喀喧啼喊喝喘喂喜喪喔喇喋喃喳單喟唾喲喚喻喬喱啾喉喫喙圍堯堪場堤堰報堡堝堠壹壺奠\"],[\"b440\",\"婷媚婿媒媛媧孳孱寒富寓寐尊尋就嵌嵐崴嵇巽幅帽幀幃幾廊廁廂廄弼彭復循徨惑惡悲悶惠愜愣惺愕惰惻惴慨惱愎惶愉愀愒戟扉掣掌描揀揩揉揆揍\"],[\"b4a1\",\"插揣提握揖揭揮捶援揪換摒揚揹敞敦敢散斑斐斯普晰晴晶景暑智晾晷曾替期朝棺棕棠棘棗椅棟棵森棧棹棒棲棣棋棍植椒椎棉棚楮棻款欺欽殘殖殼毯氮氯氬港游湔渡渲湧湊渠渥渣減湛湘渤湖湮渭渦湯渴湍渺測湃渝渾滋\"],[\"b540\",\"溉渙湎湣湄湲湩湟焙焚焦焰無然煮焜牌犄犀猶猥猴猩琺琪琳琢琥琵琶琴琯琛琦琨甥甦畫番痢痛痣痙痘痞痠登發皖皓皴盜睏短硝硬硯稍稈程稅稀窘\"],[\"b5a1\",\"窗窖童竣等策筆筐筒答筍筋筏筑粟粥絞結絨絕紫絮絲絡給絢絰絳善翔翕耋聒肅腕腔腋腑腎脹腆脾腌腓腴舒舜菩萃菸萍菠菅萋菁華菱菴著萊菰萌菌菽菲菊萸萎萄菜萇菔菟虛蛟蛙蛭蛔蛛蛤蛐蛞街裁裂袱覃視註詠評詞証詁\"],[\"b640\",\"詔詛詐詆訴診訶詖象貂貯貼貳貽賁費賀貴買貶貿貸越超趁跎距跋跚跑跌跛跆軻軸軼辜逮逵週逸進逶鄂郵鄉郾酣酥量鈔鈕鈣鈉鈞鈍鈐鈇鈑閔閏開閑\"],[\"b6a1\",\"間閒閎隊階隋陽隅隆隍陲隄雁雅雄集雇雯雲韌項順須飧飪飯飩飲飭馮馭黃黍黑亂傭債傲傳僅傾催傷傻傯僇剿剷剽募勦勤勢勣匯嗟嗨嗓嗦嗎嗜嗇嗑嗣嗤嗯嗚嗡嗅嗆嗥嗉園圓塞塑塘塗塚塔填塌塭塊塢塒塋奧嫁嫉嫌媾媽媼\"],[\"b740\",\"媳嫂媲嵩嵯幌幹廉廈弒彙徬微愚意慈感想愛惹愁愈慎慌慄慍愾愴愧愍愆愷戡戢搓搾搞搪搭搽搬搏搜搔損搶搖搗搆敬斟新暗暉暇暈暖暄暘暍會榔業\"],[\"b7a1\",\"楚楷楠楔極椰概楊楨楫楞楓楹榆楝楣楛歇歲毀殿毓毽溢溯滓溶滂源溝滇滅溥溘溼溺溫滑準溜滄滔溪溧溴煎煙煩煤煉照煜煬煦煌煥煞煆煨煖爺牒猷獅猿猾瑯瑚瑕瑟瑞瑁琿瑙瑛瑜當畸瘀痰瘁痲痱痺痿痴痳盞盟睛睫睦睞督\"],[\"b840\",\"睹睪睬睜睥睨睢矮碎碰碗碘碌碉硼碑碓硿祺祿禁萬禽稜稚稠稔稟稞窟窠筷節筠筮筧粱粳粵經絹綑綁綏絛置罩罪署義羨群聖聘肆肄腱腰腸腥腮腳腫\"],[\"b8a1\",\"腹腺腦舅艇蒂葷落萱葵葦葫葉葬葛萼萵葡董葩葭葆虞虜號蛹蜓蜈蜇蜀蛾蛻蜂蜃蜆蜊衙裟裔裙補裘裝裡裊裕裒覜解詫該詳試詩詰誇詼詣誠話誅詭詢詮詬詹詻訾詨豢貊貉賊資賈賄貲賃賂賅跡跟跨路跳跺跪跤跦躲較載軾輊\"],[\"b940\",\"辟農運遊道遂達逼違遐遇遏過遍遑逾遁鄒鄗酬酪酩釉鈷鉗鈸鈽鉀鈾鉛鉋鉤鉑鈴鉉鉍鉅鈹鈿鉚閘隘隔隕雍雋雉雊雷電雹零靖靴靶預頑頓頊頒頌飼飴\"],[\"b9a1\",\"飽飾馳馱馴髡鳩麂鼎鼓鼠僧僮僥僖僭僚僕像僑僱僎僩兢凳劃劂匱厭嗾嘀嘛嘗嗽嘔嘆嘉嘍嘎嗷嘖嘟嘈嘐嗶團圖塵塾境墓墊塹墅塽壽夥夢夤奪奩嫡嫦嫩嫗嫖嫘嫣孵寞寧寡寥實寨寢寤察對屢嶄嶇幛幣幕幗幔廓廖弊彆彰徹慇\"],[\"ba40\",\"愿態慷慢慣慟慚慘慵截撇摘摔撤摸摟摺摑摧搴摭摻敲斡旗旖暢暨暝榜榨榕槁榮槓構榛榷榻榫榴槐槍榭槌榦槃榣歉歌氳漳演滾漓滴漩漾漠漬漏漂漢\"],[\"baa1\",\"滿滯漆漱漸漲漣漕漫漯澈漪滬漁滲滌滷熔熙煽熊熄熒爾犒犖獄獐瑤瑣瑪瑰瑭甄疑瘧瘍瘋瘉瘓盡監瞄睽睿睡磁碟碧碳碩碣禎福禍種稱窪窩竭端管箕箋筵算箝箔箏箸箇箄粹粽精綻綰綜綽綾綠緊綴網綱綺綢綿綵綸維緒緇綬\"],[\"bb40\",\"罰翠翡翟聞聚肇腐膀膏膈膊腿膂臧臺與舔舞艋蓉蒿蓆蓄蒙蒞蒲蒜蓋蒸蓀蓓蒐蒼蓑蓊蜿蜜蜻蜢蜥蜴蜘蝕蜷蜩裳褂裴裹裸製裨褚裯誦誌語誣認誡誓誤\"],[\"bba1\",\"說誥誨誘誑誚誧豪貍貌賓賑賒赫趙趕跼輔輒輕輓辣遠遘遜遣遙遞遢遝遛鄙鄘鄞酵酸酷酴鉸銀銅銘銖鉻銓銜銨鉼銑閡閨閩閣閥閤隙障際雌雒需靼鞅韶頗領颯颱餃餅餌餉駁骯骰髦魁魂鳴鳶鳳麼鼻齊億儀僻僵價儂儈儉儅凜\"],[\"bc40\",\"劇劈劉劍劊勰厲嘮嘻嘹嘲嘿嘴嘩噓噎噗噴嘶嘯嘰墀墟增墳墜墮墩墦奭嬉嫻嬋嫵嬌嬈寮寬審寫層履嶝嶔幢幟幡廢廚廟廝廣廠彈影德徵慶慧慮慝慕憂\"],[\"bca1\",\"慼慰慫慾憧憐憫憎憬憚憤憔憮戮摩摯摹撞撲撈撐撰撥撓撕撩撒撮播撫撚撬撙撢撳敵敷數暮暫暴暱樣樟槨樁樞標槽模樓樊槳樂樅槭樑歐歎殤毅毆漿潼澄潑潦潔澆潭潛潸潮澎潺潰潤澗潘滕潯潠潟熟熬熱熨牖犛獎獗瑩璋璃\"],[\"bd40\",\"瑾璀畿瘠瘩瘟瘤瘦瘡瘢皚皺盤瞎瞇瞌瞑瞋磋磅確磊碾磕碼磐稿稼穀稽稷稻窯窮箭箱範箴篆篇篁箠篌糊締練緯緻緘緬緝編緣線緞緩綞緙緲緹罵罷羯\"],[\"bda1\",\"翩耦膛膜膝膠膚膘蔗蔽蔚蓮蔬蔭蔓蔑蔣蔡蔔蓬蔥蓿蔆螂蝴蝶蝠蝦蝸蝨蝙蝗蝌蝓衛衝褐複褒褓褕褊誼諒談諄誕請諸課諉諂調誰論諍誶誹諛豌豎豬賠賞賦賤賬賭賢賣賜質賡赭趟趣踫踐踝踢踏踩踟踡踞躺輝輛輟輩輦輪輜輞\"],[\"be40\",\"輥適遮遨遭遷鄰鄭鄧鄱醇醉醋醃鋅銻銷鋪銬鋤鋁銳銼鋒鋇鋰銲閭閱霄霆震霉靠鞍鞋鞏頡頫頜颳養餓餒餘駝駐駟駛駑駕駒駙骷髮髯鬧魅魄魷魯鴆鴉\"],[\"bea1\",\"鴃麩麾黎墨齒儒儘儔儐儕冀冪凝劑劓勳噙噫噹噩噤噸噪器噥噱噯噬噢噶壁墾壇壅奮嬝嬴學寰導彊憲憑憩憊懍憶憾懊懈戰擅擁擋撻撼據擄擇擂操撿擒擔撾整曆曉暹曄曇暸樽樸樺橙橫橘樹橄橢橡橋橇樵機橈歙歷氅濂澱澡\"],[\"bf40\",\"濃澤濁澧澳激澹澶澦澠澴熾燉燐燒燈燕熹燎燙燜燃燄獨璜璣璘璟璞瓢甌甍瘴瘸瘺盧盥瞠瞞瞟瞥磨磚磬磧禦積穎穆穌穋窺篙簑築篤篛篡篩篦糕糖縊\"],[\"bfa1\",\"縑縈縛縣縞縝縉縐罹羲翰翱翮耨膳膩膨臻興艘艙蕊蕙蕈蕨蕩蕃蕉蕭蕪蕞螃螟螞螢融衡褪褲褥褫褡親覦諦諺諫諱謀諜諧諮諾謁謂諷諭諳諶諼豫豭貓賴蹄踱踴蹂踹踵輻輯輸輳辨辦遵遴選遲遼遺鄴醒錠錶鋸錳錯錢鋼錫錄錚\"],[\"c040\",\"錐錦錡錕錮錙閻隧隨險雕霎霑霖霍霓霏靛靜靦鞘頰頸頻頷頭頹頤餐館餞餛餡餚駭駢駱骸骼髻髭鬨鮑鴕鴣鴦鴨鴒鴛默黔龍龜優償儡儲勵嚎嚀嚐嚅嚇\"],[\"c0a1\",\"嚏壕壓壑壎嬰嬪嬤孺尷屨嶼嶺嶽嶸幫彌徽應懂懇懦懋戲戴擎擊擘擠擰擦擬擱擢擭斂斃曙曖檀檔檄檢檜櫛檣橾檗檐檠歜殮毚氈濘濱濟濠濛濤濫濯澀濬濡濩濕濮濰燧營燮燦燥燭燬燴燠爵牆獰獲璩環璦璨癆療癌盪瞳瞪瞰瞬\"],[\"c140\",\"瞧瞭矯磷磺磴磯礁禧禪穗窿簇簍篾篷簌篠糠糜糞糢糟糙糝縮績繆縷縲繃縫總縱繅繁縴縹繈縵縿縯罄翳翼聱聲聰聯聳臆臃膺臂臀膿膽臉膾臨舉艱薪\"],[\"c1a1\",\"薄蕾薜薑薔薯薛薇薨薊虧蟀蟑螳蟒蟆螫螻螺蟈蟋褻褶襄褸褽覬謎謗謙講謊謠謝謄謐豁谿豳賺賽購賸賻趨蹉蹋蹈蹊轄輾轂轅輿避遽還邁邂邀鄹醣醞醜鍍鎂錨鍵鍊鍥鍋錘鍾鍬鍛鍰鍚鍔闊闋闌闈闆隱隸雖霜霞鞠韓顆颶餵騁\"],[\"c240\",\"駿鮮鮫鮪鮭鴻鴿麋黏點黜黝黛鼾齋叢嚕嚮壙壘嬸彝懣戳擴擲擾攆擺擻擷斷曜朦檳檬櫃檻檸櫂檮檯歟歸殯瀉瀋濾瀆濺瀑瀏燻燼燾燸獷獵璧璿甕癖癘\"],[\"c2a1\",\"癒瞽瞿瞻瞼礎禮穡穢穠竄竅簫簧簪簞簣簡糧織繕繞繚繡繒繙罈翹翻職聶臍臏舊藏薩藍藐藉薰薺薹薦蟯蟬蟲蟠覆覲觴謨謹謬謫豐贅蹙蹣蹦蹤蹟蹕軀轉轍邇邃邈醫醬釐鎔鎊鎖鎢鎳鎮鎬鎰鎘鎚鎗闔闖闐闕離雜雙雛雞霤鞣鞦\"],[\"c340\",\"鞭韹額顏題顎顓颺餾餿餽餮馥騎髁鬃鬆魏魎魍鯊鯉鯽鯈鯀鵑鵝鵠黠鼕鼬儳嚥壞壟壢寵龐廬懲懷懶懵攀攏曠曝櫥櫝櫚櫓瀛瀟瀨瀚瀝瀕瀘爆爍牘犢獸\"],[\"c3a1\",\"獺璽瓊瓣疇疆癟癡矇礙禱穫穩簾簿簸簽簷籀繫繭繹繩繪羅繳羶羹羸臘藩藝藪藕藤藥藷蟻蠅蠍蟹蟾襠襟襖襞譁譜識證譚譎譏譆譙贈贊蹼蹲躇蹶蹬蹺蹴轔轎辭邊邋醱醮鏡鏑鏟鏃鏈鏜鏝鏖鏢鏍鏘鏤鏗鏨關隴難霪霧靡韜韻類\"],[\"c440\",\"願顛颼饅饉騖騙鬍鯨鯧鯖鯛鶉鵡鵲鵪鵬麒麗麓麴勸嚨嚷嚶嚴嚼壤孀孃孽寶巉懸懺攘攔攙曦朧櫬瀾瀰瀲爐獻瓏癢癥礦礪礬礫竇競籌籃籍糯糰辮繽繼\"],[\"c4a1\",\"纂罌耀臚艦藻藹蘑藺蘆蘋蘇蘊蠔蠕襤覺觸議譬警譯譟譫贏贍躉躁躅躂醴釋鐘鐃鏽闡霰飄饒饑馨騫騰騷騵鰓鰍鹹麵黨鼯齟齣齡儷儸囁囀囂夔屬巍懼懾攝攜斕曩櫻欄櫺殲灌爛犧瓖瓔癩矓籐纏續羼蘗蘭蘚蠣蠢蠡蠟襪襬覽譴\"],[\"c540\",\"護譽贓躊躍躋轟辯醺鐮鐳鐵鐺鐸鐲鐫闢霸霹露響顧顥饗驅驃驀騾髏魔魑鰭鰥鶯鶴鷂鶸麝黯鼙齜齦齧儼儻囈囊囉孿巔巒彎懿攤權歡灑灘玀瓤疊癮癬\"],[\"c5a1\",\"禳籠籟聾聽臟襲襯觼讀贖贗躑躓轡酈鑄鑑鑒霽霾韃韁顫饕驕驍髒鬚鱉鰱鰾鰻鷓鷗鼴齬齪龔囌巖戀攣攫攪曬欐瓚竊籤籣籥纓纖纔臢蘸蘿蠱變邐邏鑣鑠鑤靨顯饜驚驛驗髓體髑鱔鱗鱖鷥麟黴囑壩攬灞癱癲矗罐羈蠶蠹衢讓讒\"],[\"c640\",\"讖艷贛釀鑪靂靈靄韆顰驟鬢魘鱟鷹鷺鹼鹽鼇齷齲廳欖灣籬籮蠻觀躡釁鑲鑰顱饞髖鬣黌灤矚讚鑷韉驢驥纜讜躪釅鑽鑾鑼鱷鱸黷豔鑿鸚爨驪鬱鸛鸞籲\"],[\"c940\",\"乂乜凵匚厂万丌乇亍囗兀屮彳丏冇与丮亓仂仉仈冘勼卬厹圠夃夬尐巿旡殳毌气爿丱丼仨仜仩仡仝仚刌匜卌圢圣夗夯宁宄尒尻屴屳帄庀庂忉戉扐氕\"],[\"c9a1\",\"氶汃氿氻犮犰玊禸肊阞伎优伬仵伔仱伀价伈伝伂伅伢伓伄仴伒冱刓刉刐劦匢匟卍厊吇囡囟圮圪圴夼妀奼妅奻奾奷奿孖尕尥屼屺屻屾巟幵庄异弚彴忕忔忏扜扞扤扡扦扢扙扠扚扥旯旮朾朹朸朻机朿朼朳氘汆汒汜汏汊汔汋\"],[\"ca40\",\"汌灱牞犴犵玎甪癿穵网艸艼芀艽艿虍襾邙邗邘邛邔阢阤阠阣佖伻佢佉体佤伾佧佒佟佁佘伭伳伿佡冏冹刜刞刡劭劮匉卣卲厎厏吰吷吪呔呅吙吜吥吘\"],[\"caa1\",\"吽呏呁吨吤呇囮囧囥坁坅坌坉坋坒夆奀妦妘妠妗妎妢妐妏妧妡宎宒尨尪岍岏岈岋岉岒岊岆岓岕巠帊帎庋庉庌庈庍弅弝彸彶忒忑忐忭忨忮忳忡忤忣忺忯忷忻怀忴戺抃抌抎抏抔抇扱扻扺扰抁抈扷扽扲扴攷旰旴旳旲旵杅杇\"],[\"cb40\",\"杙杕杌杈杝杍杚杋毐氙氚汸汧汫沄沋沏汱汯汩沚汭沇沕沜汦汳汥汻沎灴灺牣犿犽狃狆狁犺狅玕玗玓玔玒町甹疔疕皁礽耴肕肙肐肒肜芐芏芅芎芑芓\"],[\"cba1\",\"芊芃芄豸迉辿邟邡邥邞邧邠阰阨阯阭丳侘佼侅佽侀侇佶佴侉侄佷佌侗佪侚佹侁佸侐侜侔侞侒侂侕佫佮冞冼冾刵刲刳剆刱劼匊匋匼厒厔咇呿咁咑咂咈呫呺呾呥呬呴呦咍呯呡呠咘呣呧呤囷囹坯坲坭坫坱坰坶垀坵坻坳坴坢\"],[\"cc40\",\"坨坽夌奅妵妺姏姎妲姌姁妶妼姃姖妱妽姀姈妴姇孢孥宓宕屄屇岮岤岠岵岯岨岬岟岣岭岢岪岧岝岥岶岰岦帗帔帙弨弢弣弤彔徂彾彽忞忥怭怦怙怲怋\"],[\"cca1\",\"怴怊怗怳怚怞怬怢怍怐怮怓怑怌怉怜戔戽抭抴拑抾抪抶拊抮抳抯抻抩抰抸攽斨斻昉旼昄昒昈旻昃昋昍昅旽昑昐曶朊枅杬枎枒杶杻枘枆构杴枍枌杺枟枑枙枃杽极杸杹枔欥殀歾毞氝沓泬泫泮泙沶泔沭泧沷泐泂沺泃泆泭泲\"],[\"cd40\",\"泒泝沴沊沝沀泞泀洰泍泇沰泹泏泩泑炔炘炅炓炆炄炑炖炂炚炃牪狖狋狘狉狜狒狔狚狌狑玤玡玭玦玢玠玬玝瓝瓨甿畀甾疌疘皯盳盱盰盵矸矼矹矻矺\"],[\"cda1\",\"矷祂礿秅穸穻竻籵糽耵肏肮肣肸肵肭舠芠苀芫芚芘芛芵芧芮芼芞芺芴芨芡芩苂芤苃芶芢虰虯虭虮豖迒迋迓迍迖迕迗邲邴邯邳邰阹阽阼阺陃俍俅俓侲俉俋俁俔俜俙侻侳俛俇俖侺俀侹俬剄剉勀勂匽卼厗厖厙厘咺咡咭咥哏\"],[\"ce40\",\"哃茍咷咮哖咶哅哆咠呰咼咢咾呲哞咰垵垞垟垤垌垗垝垛垔垘垏垙垥垚垕壴复奓姡姞姮娀姱姝姺姽姼姶姤姲姷姛姩姳姵姠姾姴姭宨屌峐峘峌峗峋峛\"],[\"cea1\",\"峞峚峉峇峊峖峓峔峏峈峆峎峟峸巹帡帢帣帠帤庰庤庢庛庣庥弇弮彖徆怷怹恔恲恞恅恓恇恉恛恌恀恂恟怤恄恘恦恮扂扃拏挍挋拵挎挃拫拹挏挌拸拶挀挓挔拺挕拻拰敁敃斪斿昶昡昲昵昜昦昢昳昫昺昝昴昹昮朏朐柁柲柈枺\"],[\"cf40\",\"柜枻柸柘柀枷柅柫柤柟枵柍枳柷柶柮柣柂枹柎柧柰枲柼柆柭柌枮柦柛柺柉柊柃柪柋欨殂殄殶毖毘毠氠氡洨洴洭洟洼洿洒洊泚洳洄洙洺洚洑洀洝浂\"],[\"cfa1\",\"洁洘洷洃洏浀洇洠洬洈洢洉洐炷炟炾炱炰炡炴炵炩牁牉牊牬牰牳牮狊狤狨狫狟狪狦狣玅珌珂珈珅玹玶玵玴珫玿珇玾珃珆玸珋瓬瓮甮畇畈疧疪癹盄眈眃眄眅眊盷盻盺矧矨砆砑砒砅砐砏砎砉砃砓祊祌祋祅祄秕种秏秖秎窀\"],[\"d040\",\"穾竑笀笁籺籸籹籿粀粁紃紈紁罘羑羍羾耇耎耏耔耷胘胇胠胑胈胂胐胅胣胙胜胊胕胉胏胗胦胍臿舡芔苙苾苹茇苨茀苕茺苫苖苴苬苡苲苵茌苻苶苰苪\"],[\"d0a1\",\"苤苠苺苳苭虷虴虼虳衁衎衧衪衩觓訄訇赲迣迡迮迠郱邽邿郕郅邾郇郋郈釔釓陔陏陑陓陊陎倞倅倇倓倢倰倛俵俴倳倷倬俶俷倗倜倠倧倵倯倱倎党冔冓凊凄凅凈凎剡剚剒剞剟剕剢勍匎厞唦哢唗唒哧哳哤唚哿唄唈哫唑唅哱\"],[\"d140\",\"唊哻哷哸哠唎唃唋圁圂埌堲埕埒垺埆垽垼垸垶垿埇埐垹埁夎奊娙娖娭娮娕娏娗娊娞娳孬宧宭宬尃屖屔峬峿峮峱峷崀峹帩帨庨庮庪庬弳弰彧恝恚恧\"],[\"d1a1\",\"恁悢悈悀悒悁悝悃悕悛悗悇悜悎戙扆拲挐捖挬捄捅挶捃揤挹捋捊挼挩捁挴捘捔捙挭捇挳捚捑挸捗捀捈敊敆旆旃旄旂晊晟晇晑朒朓栟栚桉栲栳栻桋桏栖栱栜栵栫栭栯桎桄栴栝栒栔栦栨栮桍栺栥栠欬欯欭欱欴歭肂殈毦毤\"],[\"d240\",\"毨毣毢毧氥浺浣浤浶洍浡涒浘浢浭浯涑涍淯浿涆浞浧浠涗浰浼浟涂涘洯浨涋浾涀涄洖涃浻浽浵涐烜烓烑烝烋缹烢烗烒烞烠烔烍烅烆烇烚烎烡牂牸\"],[\"d2a1\",\"牷牶猀狺狴狾狶狳狻猁珓珙珥珖玼珧珣珩珜珒珛珔珝珚珗珘珨瓞瓟瓴瓵甡畛畟疰痁疻痄痀疿疶疺皊盉眝眛眐眓眒眣眑眕眙眚眢眧砣砬砢砵砯砨砮砫砡砩砳砪砱祔祛祏祜祓祒祑秫秬秠秮秭秪秜秞秝窆窉窅窋窌窊窇竘笐\"],[\"d340\",\"笄笓笅笏笈笊笎笉笒粄粑粊粌粈粍粅紞紝紑紎紘紖紓紟紒紏紌罜罡罞罠罝罛羖羒翃翂翀耖耾耹胺胲胹胵脁胻脀舁舯舥茳茭荄茙荑茥荖茿荁茦茜茢\"],[\"d3a1\",\"荂荎茛茪茈茼荍茖茤茠茷茯茩荇荅荌荓茞茬荋茧荈虓虒蚢蚨蚖蚍蚑蚞蚇蚗蚆蚋蚚蚅蚥蚙蚡蚧蚕蚘蚎蚝蚐蚔衃衄衭衵衶衲袀衱衿衯袃衾衴衼訒豇豗豻貤貣赶赸趵趷趶軑軓迾迵适迿迻逄迼迶郖郠郙郚郣郟郥郘郛郗郜郤酐\"],[\"d440\",\"酎酏釕釢釚陜陟隼飣髟鬯乿偰偪偡偞偠偓偋偝偲偈偍偁偛偊偢倕偅偟偩偫偣偤偆偀偮偳偗偑凐剫剭剬剮勖勓匭厜啵啶唼啍啐唴唪啑啢唶唵唰啒啅\"],[\"d4a1\",\"唌唲啥啎唹啈唭唻啀啋圊圇埻堔埢埶埜埴堀埭埽堈埸堋埳埏堇埮埣埲埥埬埡堎埼堐埧堁堌埱埩埰堍堄奜婠婘婕婧婞娸娵婭婐婟婥婬婓婤婗婃婝婒婄婛婈媎娾婍娹婌婰婩婇婑婖婂婜孲孮寁寀屙崞崋崝崚崠崌崨崍崦崥崏\"],[\"d540\",\"崰崒崣崟崮帾帴庱庴庹庲庳弶弸徛徖徟悊悐悆悾悰悺惓惔惏惤惙惝惈悱惛悷惊悿惃惍惀挲捥掊掂捽掽掞掭掝掗掫掎捯掇掐据掯捵掜捭掮捼掤挻掟\"],[\"d5a1\",\"捸掅掁掑掍捰敓旍晥晡晛晙晜晢朘桹梇梐梜桭桮梮梫楖桯梣梬梩桵桴梲梏桷梒桼桫桲梪梀桱桾梛梖梋梠梉梤桸桻梑梌梊桽欶欳欷欸殑殏殍殎殌氪淀涫涴涳湴涬淩淢涷淶淔渀淈淠淟淖涾淥淜淝淛淴淊涽淭淰涺淕淂淏淉\"],[\"d640\",\"淐淲淓淽淗淍淣涻烺焍烷焗烴焌烰焄烳焐烼烿焆焓焀烸烶焋焂焎牾牻牼牿猝猗猇猑猘猊猈狿猏猞玈珶珸珵琄琁珽琇琀珺珼珿琌琋珴琈畤畣痎痒痏\"],[\"d6a1\",\"痋痌痑痐皏皉盓眹眯眭眱眲眴眳眽眥眻眵硈硒硉硍硊硌砦硅硐祤祧祩祪祣祫祡离秺秸秶秷窏窔窐笵筇笴笥笰笢笤笳笘笪笝笱笫笭笯笲笸笚笣粔粘粖粣紵紽紸紶紺絅紬紩絁絇紾紿絊紻紨罣羕羜羝羛翊翋翍翐翑翇翏翉耟\"],[\"d740\",\"耞耛聇聃聈脘脥脙脛脭脟脬脞脡脕脧脝脢舑舸舳舺舴舲艴莐莣莨莍荺荳莤荴莏莁莕莙荵莔莩荽莃莌莝莛莪莋荾莥莯莈莗莰荿莦莇莮荶莚虙虖蚿蚷\"],[\"d7a1\",\"蛂蛁蛅蚺蚰蛈蚹蚳蚸蛌蚴蚻蚼蛃蚽蚾衒袉袕袨袢袪袚袑袡袟袘袧袙袛袗袤袬袌袓袎覂觖觙觕訰訧訬訞谹谻豜豝豽貥赽赻赹趼跂趹趿跁軘軞軝軜軗軠軡逤逋逑逜逌逡郯郪郰郴郲郳郔郫郬郩酖酘酚酓酕釬釴釱釳釸釤釹釪\"],[\"d840\",\"釫釷釨釮镺閆閈陼陭陫陱陯隿靪頄飥馗傛傕傔傞傋傣傃傌傎傝偨傜傒傂傇兟凔匒匑厤厧喑喨喥喭啷噅喢喓喈喏喵喁喣喒喤啽喌喦啿喕喡喎圌堩堷\"],[\"d8a1\",\"堙堞堧堣堨埵塈堥堜堛堳堿堶堮堹堸堭堬堻奡媯媔媟婺媢媞婸媦婼媥媬媕媮娷媄媊媗媃媋媩婻婽媌媜媏媓媝寪寍寋寔寑寊寎尌尰崷嵃嵫嵁嵋崿崵嵑嵎嵕崳崺嵒崽崱嵙嵂崹嵉崸崼崲崶嵀嵅幄幁彘徦徥徫惉悹惌惢惎惄愔\"],[\"d940\",\"惲愊愖愅惵愓惸惼惾惁愃愘愝愐惿愄愋扊掔掱掰揎揥揨揯揃撝揳揊揠揶揕揲揵摡揟掾揝揜揄揘揓揂揇揌揋揈揰揗揙攲敧敪敤敜敨敥斌斝斞斮旐旒\"],[\"d9a1\",\"晼晬晻暀晱晹晪晲朁椌棓椄棜椪棬棪棱椏棖棷棫棤棶椓椐棳棡椇棌椈楰梴椑棯棆椔棸棐棽棼棨椋椊椗棎棈棝棞棦棴棑椆棔棩椕椥棇欹欻欿欼殔殗殙殕殽毰毲毳氰淼湆湇渟湉溈渼渽湅湢渫渿湁湝湳渜渳湋湀湑渻渃渮湞\"],[\"da40\",\"湨湜湡渱渨湠湱湫渹渢渰湓湥渧湸湤湷湕湹湒湦渵渶湚焠焞焯烻焮焱焣焥焢焲焟焨焺焛牋牚犈犉犆犅犋猒猋猰猢猱猳猧猲猭猦猣猵猌琮琬琰琫琖\"],[\"daa1\",\"琚琡琭琱琤琣琝琩琠琲瓻甯畯畬痧痚痡痦痝痟痤痗皕皒盚睆睇睄睍睅睊睎睋睌矞矬硠硤硥硜硭硱硪确硰硩硨硞硢祴祳祲祰稂稊稃稌稄窙竦竤筊笻筄筈筌筎筀筘筅粢粞粨粡絘絯絣絓絖絧絪絏絭絜絫絒絔絩絑絟絎缾缿罥\"],[\"db40\",\"罦羢羠羡翗聑聏聐胾胔腃腊腒腏腇脽腍脺臦臮臷臸臹舄舼舽舿艵茻菏菹萣菀菨萒菧菤菼菶萐菆菈菫菣莿萁菝菥菘菿菡菋菎菖菵菉萉萏菞萑萆菂菳\"],[\"dba1\",\"菕菺菇菑菪萓菃菬菮菄菻菗菢萛菛菾蛘蛢蛦蛓蛣蛚蛪蛝蛫蛜蛬蛩蛗蛨蛑衈衖衕袺裗袹袸裀袾袶袼袷袽袲褁裉覕覘覗觝觚觛詎詍訹詙詀詗詘詄詅詒詈詑詊詌詏豟貁貀貺貾貰貹貵趄趀趉跘跓跍跇跖跜跏跕跙跈跗跅軯軷軺\"],[\"dc40\",\"軹軦軮軥軵軧軨軶軫軱軬軴軩逭逴逯鄆鄬鄄郿郼鄈郹郻鄁鄀鄇鄅鄃酡酤酟酢酠鈁鈊鈥鈃鈚鈦鈏鈌鈀鈒釿釽鈆鈄鈧鈂鈜鈤鈙鈗鈅鈖镻閍閌閐隇陾隈\"],[\"dca1\",\"隉隃隀雂雈雃雱雰靬靰靮頇颩飫鳦黹亃亄亶傽傿僆傮僄僊傴僈僂傰僁傺傱僋僉傶傸凗剺剸剻剼嗃嗛嗌嗐嗋嗊嗝嗀嗔嗄嗩喿嗒喍嗏嗕嗢嗖嗈嗲嗍嗙嗂圔塓塨塤塏塍塉塯塕塎塝塙塥塛堽塣塱壼嫇嫄嫋媺媸媱媵媰媿嫈媻嫆\"],[\"dd40\",\"媷嫀嫊媴媶嫍媹媐寖寘寙尟尳嵱嵣嵊嵥嵲嵬嵞嵨嵧嵢巰幏幎幊幍幋廅廌廆廋廇彀徯徭惷慉慊愫慅愶愲愮慆愯慏愩慀戠酨戣戥戤揅揱揫搐搒搉搠搤\"],[\"dda1\",\"搳摃搟搕搘搹搷搢搣搌搦搰搨摁搵搯搊搚摀搥搧搋揧搛搮搡搎敯斒旓暆暌暕暐暋暊暙暔晸朠楦楟椸楎楢楱椿楅楪椹楂楗楙楺楈楉椵楬椳椽楥棰楸椴楩楀楯楄楶楘楁楴楌椻楋椷楜楏楑椲楒椯楻椼歆歅歃歂歈歁殛嗀毻毼\"],[\"de40\",\"毹毷毸溛滖滈溏滀溟溓溔溠溱溹滆滒溽滁溞滉溷溰滍溦滏溲溾滃滜滘溙溒溎溍溤溡溿溳滐滊溗溮溣煇煔煒煣煠煁煝煢煲煸煪煡煂煘煃煋煰煟煐煓\"],[\"dea1\",\"煄煍煚牏犍犌犑犐犎猼獂猻猺獀獊獉瑄瑊瑋瑒瑑瑗瑀瑏瑐瑎瑂瑆瑍瑔瓡瓿瓾瓽甝畹畷榃痯瘏瘃痷痾痼痹痸瘐痻痶痭痵痽皙皵盝睕睟睠睒睖睚睩睧睔睙睭矠碇碚碔碏碄碕碅碆碡碃硹碙碀碖硻祼禂祽祹稑稘稙稒稗稕稢稓\"],[\"df40\",\"稛稐窣窢窞竫筦筤筭筴筩筲筥筳筱筰筡筸筶筣粲粴粯綈綆綀綍絿綅絺綎絻綃絼綌綔綄絽綒罭罫罧罨罬羦羥羧翛翜耡腤腠腷腜腩腛腢腲朡腞腶腧腯\"],[\"dfa1\",\"腄腡舝艉艄艀艂艅蓱萿葖葶葹蒏蒍葥葑葀蒆葧萰葍葽葚葙葴葳葝蔇葞萷萺萴葺葃葸萲葅萩菙葋萯葂萭葟葰萹葎葌葒葯蓅蒎萻葇萶萳葨葾葄萫葠葔葮葐蜋蜄蛷蜌蛺蛖蛵蝍蛸蜎蜉蜁蛶蜍蜅裖裋裍裎裞裛裚裌裐覅覛觟觥觤\"],[\"e040\",\"觡觠觢觜触詶誆詿詡訿詷誂誄詵誃誁詴詺谼豋豊豥豤豦貆貄貅賌赨赩趑趌趎趏趍趓趔趐趒跰跠跬跱跮跐跩跣跢跧跲跫跴輆軿輁輀輅輇輈輂輋遒逿\"],[\"e0a1\",\"遄遉逽鄐鄍鄏鄑鄖鄔鄋鄎酮酯鉈鉒鈰鈺鉦鈳鉥鉞銃鈮鉊鉆鉭鉬鉏鉠鉧鉯鈶鉡鉰鈱鉔鉣鉐鉲鉎鉓鉌鉖鈲閟閜閞閛隒隓隑隗雎雺雽雸雵靳靷靸靲頏頍頎颬飶飹馯馲馰馵骭骫魛鳪鳭鳧麀黽僦僔僗僨僳僛僪僝僤僓僬僰僯僣僠\"],[\"e140\",\"凘劀劁勩勫匰厬嘧嘕嘌嘒嗼嘏嘜嘁嘓嘂嗺嘝嘄嗿嗹墉塼墐墘墆墁塿塴墋塺墇墑墎塶墂墈塻墔墏壾奫嫜嫮嫥嫕嫪嫚嫭嫫嫳嫢嫠嫛嫬嫞嫝嫙嫨嫟孷寠\"],[\"e1a1\",\"寣屣嶂嶀嵽嶆嵺嶁嵷嶊嶉嶈嵾嵼嶍嵹嵿幘幙幓廘廑廗廎廜廕廙廒廔彄彃彯徶愬愨慁慞慱慳慒慓慲慬憀慴慔慺慛慥愻慪慡慖戩戧戫搫摍摛摝摴摶摲摳摽摵摦撦摎撂摞摜摋摓摠摐摿搿摬摫摙摥摷敳斠暡暠暟朅朄朢榱榶槉\"],[\"e240\",\"榠槎榖榰榬榼榑榙榎榧榍榩榾榯榿槄榽榤槔榹槊榚槏榳榓榪榡榞槙榗榐槂榵榥槆歊歍歋殞殟殠毃毄毾滎滵滱漃漥滸漷滻漮漉潎漙漚漧漘漻漒滭漊\"],[\"e2a1\",\"漶潳滹滮漭潀漰漼漵滫漇漎潃漅滽滶漹漜滼漺漟漍漞漈漡熇熐熉熀熅熂熏煻熆熁熗牄牓犗犕犓獃獍獑獌瑢瑳瑱瑵瑲瑧瑮甀甂甃畽疐瘖瘈瘌瘕瘑瘊瘔皸瞁睼瞅瞂睮瞀睯睾瞃碲碪碴碭碨硾碫碞碥碠碬碢碤禘禊禋禖禕禔禓\"],[\"e340\",\"禗禈禒禐稫穊稰稯稨稦窨窫窬竮箈箜箊箑箐箖箍箌箛箎箅箘劄箙箤箂粻粿粼粺綧綷緂綣綪緁緀緅綝緎緄緆緋緌綯綹綖綼綟綦綮綩綡緉罳翢翣翥翞\"],[\"e3a1\",\"耤聝聜膉膆膃膇膍膌膋舕蒗蒤蒡蒟蒺蓎蓂蒬蒮蒫蒹蒴蓁蓍蒪蒚蒱蓐蒝蒧蒻蒢蒔蓇蓌蒛蒩蒯蒨蓖蒘蒶蓏蒠蓗蓔蓒蓛蒰蒑虡蜳蜣蜨蝫蝀蜮蜞蜡蜙蜛蝃蜬蝁蜾蝆蜠蜲蜪蜭蜼蜒蜺蜱蜵蝂蜦蜧蜸蜤蜚蜰蜑裷裧裱裲裺裾裮裼裶裻\"],[\"e440\",\"裰裬裫覝覡覟覞觩觫觨誫誙誋誒誏誖谽豨豩賕賏賗趖踉踂跿踍跽踊踃踇踆踅跾踀踄輐輑輎輍鄣鄜鄠鄢鄟鄝鄚鄤鄡鄛酺酲酹酳銥銤鉶銛鉺銠銔銪銍\"],[\"e4a1\",\"銦銚銫鉹銗鉿銣鋮銎銂銕銢鉽銈銡銊銆銌銙銧鉾銇銩銝銋鈭隞隡雿靘靽靺靾鞃鞀鞂靻鞄鞁靿韎韍頖颭颮餂餀餇馝馜駃馹馻馺駂馽駇骱髣髧鬾鬿魠魡魟鳱鳲鳵麧僿儃儰僸儆儇僶僾儋儌僽儊劋劌勱勯噈噂噌嘵噁噊噉噆噘\"],[\"e540\",\"噚噀嘳嘽嘬嘾嘸嘪嘺圚墫墝墱墠墣墯墬墥墡壿嫿嫴嫽嫷嫶嬃嫸嬂嫹嬁嬇嬅嬏屧嶙嶗嶟嶒嶢嶓嶕嶠嶜嶡嶚嶞幩幝幠幜緳廛廞廡彉徲憋憃慹憱憰憢憉\"],[\"e5a1\",\"憛憓憯憭憟憒憪憡憍慦憳戭摮摰撖撠撅撗撜撏撋撊撌撣撟摨撱撘敶敺敹敻斲斳暵暰暩暲暷暪暯樀樆樗槥槸樕槱槤樠槿槬槢樛樝槾樧槲槮樔槷槧橀樈槦槻樍槼槫樉樄樘樥樏槶樦樇槴樖歑殥殣殢殦氁氀毿氂潁漦潾澇濆澒\"],[\"e640\",\"澍澉澌潢潏澅潚澖潶潬澂潕潲潒潐潗澔澓潝漀潡潫潽潧澐潓澋潩潿澕潣潷潪潻熲熯熛熰熠熚熩熵熝熥熞熤熡熪熜熧熳犘犚獘獒獞獟獠獝獛獡獚獙\"],[\"e6a1\",\"獢璇璉璊璆璁瑽璅璈瑼瑹甈甇畾瘥瘞瘙瘝瘜瘣瘚瘨瘛皜皝皞皛瞍瞏瞉瞈磍碻磏磌磑磎磔磈磃磄磉禚禡禠禜禢禛歶稹窲窴窳箷篋箾箬篎箯箹篊箵糅糈糌糋緷緛緪緧緗緡縃緺緦緶緱緰緮緟罶羬羰羭翭翫翪翬翦翨聤聧膣膟\"],[\"e740\",\"膞膕膢膙膗舖艏艓艒艐艎艑蔤蔻蔏蔀蔩蔎蔉蔍蔟蔊蔧蔜蓻蔫蓺蔈蔌蓴蔪蓲蔕蓷蓫蓳蓼蔒蓪蓩蔖蓾蔨蔝蔮蔂蓽蔞蓶蔱蔦蓧蓨蓰蓯蓹蔘蔠蔰蔋蔙蔯虢\"],[\"e7a1\",\"蝖蝣蝤蝷蟡蝳蝘蝔蝛蝒蝡蝚蝑蝞蝭蝪蝐蝎蝟蝝蝯蝬蝺蝮蝜蝥蝏蝻蝵蝢蝧蝩衚褅褌褔褋褗褘褙褆褖褑褎褉覢覤覣觭觰觬諏諆誸諓諑諔諕誻諗誾諀諅諘諃誺誽諙谾豍貏賥賟賙賨賚賝賧趠趜趡趛踠踣踥踤踮踕踛踖踑踙踦踧\"],[\"e840\",\"踔踒踘踓踜踗踚輬輤輘輚輠輣輖輗遳遰遯遧遫鄯鄫鄩鄪鄲鄦鄮醅醆醊醁醂醄醀鋐鋃鋄鋀鋙銶鋏鋱鋟鋘鋩鋗鋝鋌鋯鋂鋨鋊鋈鋎鋦鋍鋕鋉鋠鋞鋧鋑鋓\"],[\"e8a1\",\"銵鋡鋆銴镼閬閫閮閰隤隢雓霅霈霂靚鞊鞎鞈韐韏頞頝頦頩頨頠頛頧颲餈飺餑餔餖餗餕駜駍駏駓駔駎駉駖駘駋駗駌骳髬髫髳髲髱魆魃魧魴魱魦魶魵魰魨魤魬鳼鳺鳽鳿鳷鴇鴀鳹鳻鴈鴅鴄麃黓鼏鼐儜儓儗儚儑凞匴叡噰噠噮\"],[\"e940\",\"噳噦噣噭噲噞噷圜圛壈墽壉墿墺壂墼壆嬗嬙嬛嬡嬔嬓嬐嬖嬨嬚嬠嬞寯嶬嶱嶩嶧嶵嶰嶮嶪嶨嶲嶭嶯嶴幧幨幦幯廩廧廦廨廥彋徼憝憨憖懅憴懆懁懌憺\"],[\"e9a1\",\"憿憸憌擗擖擐擏擉撽撉擃擛擳擙攳敿敼斢曈暾曀曊曋曏暽暻暺曌朣樴橦橉橧樲橨樾橝橭橶橛橑樨橚樻樿橁橪橤橐橏橔橯橩橠樼橞橖橕橍橎橆歕歔歖殧殪殫毈毇氄氃氆澭濋澣濇澼濎濈潞濄澽澞濊澨瀄澥澮澺澬澪濏澿澸\"],[\"ea40\",\"澢濉澫濍澯澲澰燅燂熿熸燖燀燁燋燔燊燇燏熽燘熼燆燚燛犝犞獩獦獧獬獥獫獪瑿璚璠璔璒璕璡甋疀瘯瘭瘱瘽瘳瘼瘵瘲瘰皻盦瞚瞝瞡瞜瞛瞢瞣瞕瞙\"],[\"eaa1\",\"瞗磝磩磥磪磞磣磛磡磢磭磟磠禤穄穈穇窶窸窵窱窷篞篣篧篝篕篥篚篨篹篔篪篢篜篫篘篟糒糔糗糐糑縒縡縗縌縟縠縓縎縜縕縚縢縋縏縖縍縔縥縤罃罻罼罺羱翯耪耩聬膱膦膮膹膵膫膰膬膴膲膷膧臲艕艖艗蕖蕅蕫蕍蕓蕡蕘\"],[\"eb40\",\"蕀蕆蕤蕁蕢蕄蕑蕇蕣蔾蕛蕱蕎蕮蕵蕕蕧蕠薌蕦蕝蕔蕥蕬虣虥虤螛螏螗螓螒螈螁螖螘蝹螇螣螅螐螑螝螄螔螜螚螉褞褦褰褭褮褧褱褢褩褣褯褬褟觱諠\"],[\"eba1\",\"諢諲諴諵諝謔諤諟諰諈諞諡諨諿諯諻貑貒貐賵賮賱賰賳赬赮趥趧踳踾踸蹀蹅踶踼踽蹁踰踿躽輶輮輵輲輹輷輴遶遹遻邆郺鄳鄵鄶醓醐醑醍醏錧錞錈錟錆錏鍺錸錼錛錣錒錁鍆錭錎錍鋋錝鋺錥錓鋹鋷錴錂錤鋿錩錹錵錪錔錌\"],[\"ec40\",\"錋鋾錉錀鋻錖閼闍閾閹閺閶閿閵閽隩雔霋霒霐鞙鞗鞔韰韸頵頯頲餤餟餧餩馞駮駬駥駤駰駣駪駩駧骹骿骴骻髶髺髹髷鬳鮀鮅鮇魼魾魻鮂鮓鮒鮐魺鮕\"],[\"eca1\",\"魽鮈鴥鴗鴠鴞鴔鴩鴝鴘鴢鴐鴙鴟麈麆麇麮麭黕黖黺鼒鼽儦儥儢儤儠儩勴嚓嚌嚍嚆嚄嚃噾嚂噿嚁壖壔壏壒嬭嬥嬲嬣嬬嬧嬦嬯嬮孻寱寲嶷幬幪徾徻懃憵憼懧懠懥懤懨懞擯擩擣擫擤擨斁斀斶旚曒檍檖檁檥檉檟檛檡檞檇檓檎\"],[\"ed40\",\"檕檃檨檤檑橿檦檚檅檌檒歛殭氉濌澩濴濔濣濜濭濧濦濞濲濝濢濨燡燱燨燲燤燰燢獳獮獯璗璲璫璐璪璭璱璥璯甐甑甒甏疄癃癈癉癇皤盩瞵瞫瞲瞷瞶\"],[\"eda1\",\"瞴瞱瞨矰磳磽礂磻磼磲礅磹磾礄禫禨穜穛穖穘穔穚窾竀竁簅簏篲簀篿篻簎篴簋篳簂簉簃簁篸篽簆篰篱簐簊糨縭縼繂縳顈縸縪繉繀繇縩繌縰縻縶繄縺罅罿罾罽翴翲耬膻臄臌臊臅臇膼臩艛艚艜薃薀薏薧薕薠薋薣蕻薤薚薞\"],[\"ee40\",\"蕷蕼薉薡蕺蕸蕗薎薖薆薍薙薝薁薢薂薈薅蕹蕶薘薐薟虨螾螪螭蟅螰螬螹螵螼螮蟉蟃蟂蟌螷螯蟄蟊螴螶螿螸螽蟞螲褵褳褼褾襁襒褷襂覭覯覮觲觳謞\"],[\"eea1\",\"謘謖謑謅謋謢謏謒謕謇謍謈謆謜謓謚豏豰豲豱豯貕貔賹赯蹎蹍蹓蹐蹌蹇轃轀邅遾鄸醚醢醛醙醟醡醝醠鎡鎃鎯鍤鍖鍇鍼鍘鍜鍶鍉鍐鍑鍠鍭鎏鍌鍪鍹鍗鍕鍒鍏鍱鍷鍻鍡鍞鍣鍧鎀鍎鍙闇闀闉闃闅閷隮隰隬霠霟霘霝霙鞚鞡鞜\"],[\"ef40\",\"鞞鞝韕韔韱顁顄顊顉顅顃餥餫餬餪餳餲餯餭餱餰馘馣馡騂駺駴駷駹駸駶駻駽駾駼騃骾髾髽鬁髼魈鮚鮨鮞鮛鮦鮡鮥鮤鮆鮢鮠鮯鴳鵁鵧鴶鴮鴯鴱鴸鴰\"],[\"efa1\",\"鵅鵂鵃鴾鴷鵀鴽翵鴭麊麉麍麰黈黚黻黿鼤鼣鼢齔龠儱儭儮嚘嚜嚗嚚嚝嚙奰嬼屩屪巀幭幮懘懟懭懮懱懪懰懫懖懩擿攄擽擸攁攃擼斔旛曚曛曘櫅檹檽櫡櫆檺檶檷櫇檴檭歞毉氋瀇瀌瀍瀁瀅瀔瀎濿瀀濻瀦濼濷瀊爁燿燹爃燽獶\"],[\"f040\",\"璸瓀璵瓁璾璶璻瓂甔甓癜癤癙癐癓癗癚皦皽盬矂瞺磿礌礓礔礉礐礒礑禭禬穟簜簩簙簠簟簭簝簦簨簢簥簰繜繐繖繣繘繢繟繑繠繗繓羵羳翷翸聵臑臒\"],[\"f0a1\",\"臐艟艞薴藆藀藃藂薳薵薽藇藄薿藋藎藈藅薱薶藒蘤薸薷薾虩蟧蟦蟢蟛蟫蟪蟥蟟蟳蟤蟔蟜蟓蟭蟘蟣螤蟗蟙蠁蟴蟨蟝襓襋襏襌襆襐襑襉謪謧謣謳謰謵譇謯謼謾謱謥謷謦謶謮謤謻謽謺豂豵貙貘貗賾贄贂贀蹜蹢蹠蹗蹖蹞蹥蹧\"],[\"f140\",\"蹛蹚蹡蹝蹩蹔轆轇轈轋鄨鄺鄻鄾醨醥醧醯醪鎵鎌鎒鎷鎛鎝鎉鎧鎎鎪鎞鎦鎕鎈鎙鎟鎍鎱鎑鎲鎤鎨鎴鎣鎥闒闓闑隳雗雚巂雟雘雝霣霢霥鞬鞮鞨鞫鞤鞪\"],[\"f1a1\",\"鞢鞥韗韙韖韘韺顐顑顒颸饁餼餺騏騋騉騍騄騑騊騅騇騆髀髜鬈鬄鬅鬩鬵魊魌魋鯇鯆鯃鮿鯁鮵鮸鯓鮶鯄鮹鮽鵜鵓鵏鵊鵛鵋鵙鵖鵌鵗鵒鵔鵟鵘鵚麎麌黟鼁鼀鼖鼥鼫鼪鼩鼨齌齕儴儵劖勷厴嚫嚭嚦嚧嚪嚬壚壝壛夒嬽嬾嬿巃幰\"],[\"f240\",\"徿懻攇攐攍攉攌攎斄旞旝曞櫧櫠櫌櫑櫙櫋櫟櫜櫐櫫櫏櫍櫞歠殰氌瀙瀧瀠瀖瀫瀡瀢瀣瀩瀗瀤瀜瀪爌爊爇爂爅犥犦犤犣犡瓋瓅璷瓃甖癠矉矊矄矱礝礛\"],[\"f2a1\",\"礡礜礗礞禰穧穨簳簼簹簬簻糬糪繶繵繸繰繷繯繺繲繴繨罋罊羃羆羷翽翾聸臗臕艤艡艣藫藱藭藙藡藨藚藗藬藲藸藘藟藣藜藑藰藦藯藞藢蠀蟺蠃蟶蟷蠉蠌蠋蠆蟼蠈蟿蠊蠂襢襚襛襗襡襜襘襝襙覈覷覶觶譐譈譊譀譓譖譔譋譕\"],[\"f340\",\"譑譂譒譗豃豷豶貚贆贇贉趬趪趭趫蹭蹸蹳蹪蹯蹻軂轒轑轏轐轓辴酀鄿醰醭鏞鏇鏏鏂鏚鏐鏹鏬鏌鏙鎩鏦鏊鏔鏮鏣鏕鏄鏎鏀鏒鏧镽闚闛雡霩霫霬霨霦\"],[\"f3a1\",\"鞳鞷鞶韝韞韟顜顙顝顗颿颽颻颾饈饇饃馦馧騚騕騥騝騤騛騢騠騧騣騞騜騔髂鬋鬊鬎鬌鬷鯪鯫鯠鯞鯤鯦鯢鯰鯔鯗鯬鯜鯙鯥鯕鯡鯚鵷鶁鶊鶄鶈鵱鶀鵸鶆鶋鶌鵽鵫鵴鵵鵰鵩鶅鵳鵻鶂鵯鵹鵿鶇鵨麔麑黀黼鼭齀齁齍齖齗齘匷嚲\"],[\"f440\",\"嚵嚳壣孅巆巇廮廯忀忁懹攗攖攕攓旟曨曣曤櫳櫰櫪櫨櫹櫱櫮櫯瀼瀵瀯瀷瀴瀱灂瀸瀿瀺瀹灀瀻瀳灁爓爔犨獽獼璺皫皪皾盭矌矎矏矍矲礥礣礧礨礤礩\"],[\"f4a1\",\"禲穮穬穭竷籉籈籊籇籅糮繻繾纁纀羺翿聹臛臙舋艨艩蘢藿蘁藾蘛蘀藶蘄蘉蘅蘌藽蠙蠐蠑蠗蠓蠖襣襦覹觷譠譪譝譨譣譥譧譭趮躆躈躄轙轖轗轕轘轚邍酃酁醷醵醲醳鐋鐓鏻鐠鐏鐔鏾鐕鐐鐨鐙鐍鏵鐀鏷鐇鐎鐖鐒鏺鐉鏸鐊鏿\"],[\"f540\",\"鏼鐌鏶鐑鐆闞闠闟霮霯鞹鞻韽韾顠顢顣顟飁飂饐饎饙饌饋饓騲騴騱騬騪騶騩騮騸騭髇髊髆鬐鬒鬑鰋鰈鯷鰅鰒鯸鱀鰇鰎鰆鰗鰔鰉鶟鶙鶤鶝鶒鶘鶐鶛\"],[\"f5a1\",\"鶠鶔鶜鶪鶗鶡鶚鶢鶨鶞鶣鶿鶩鶖鶦鶧麙麛麚黥黤黧黦鼰鼮齛齠齞齝齙龑儺儹劘劗囃嚽嚾孈孇巋巏廱懽攛欂櫼欃櫸欀灃灄灊灈灉灅灆爝爚爙獾甗癪矐礭礱礯籔籓糲纊纇纈纋纆纍罍羻耰臝蘘蘪蘦蘟蘣蘜蘙蘧蘮蘡蘠蘩蘞蘥\"],[\"f640\",\"蠩蠝蠛蠠蠤蠜蠫衊襭襩襮襫觺譹譸譅譺譻贐贔趯躎躌轞轛轝酆酄酅醹鐿鐻鐶鐩鐽鐼鐰鐹鐪鐷鐬鑀鐱闥闤闣霵霺鞿韡顤飉飆飀饘饖騹騽驆驄驂驁騺\"],[\"f6a1\",\"騿髍鬕鬗鬘鬖鬺魒鰫鰝鰜鰬鰣鰨鰩鰤鰡鶷鶶鶼鷁鷇鷊鷏鶾鷅鷃鶻鶵鷎鶹鶺鶬鷈鶱鶭鷌鶳鷍鶲鹺麜黫黮黭鼛鼘鼚鼱齎齥齤龒亹囆囅囋奱孋孌巕巑廲攡攠攦攢欋欈欉氍灕灖灗灒爞爟犩獿瓘瓕瓙瓗癭皭礵禴穰穱籗籜籙籛籚\"],[\"f740\",\"糴糱纑罏羇臞艫蘴蘵蘳蘬蘲蘶蠬蠨蠦蠪蠥襱覿覾觻譾讄讂讆讅譿贕躕躔躚躒躐躖躗轠轢酇鑌鑐鑊鑋鑏鑇鑅鑈鑉鑆霿韣顪顩飋饔饛驎驓驔驌驏驈驊\"],[\"f7a1\",\"驉驒驐髐鬙鬫鬻魖魕鱆鱈鰿鱄鰹鰳鱁鰼鰷鰴鰲鰽鰶鷛鷒鷞鷚鷋鷐鷜鷑鷟鷩鷙鷘鷖鷵鷕鷝麶黰鼵鼳鼲齂齫龕龢儽劙壨壧奲孍巘蠯彏戁戃戄攩攥斖曫欑欒欏毊灛灚爢玂玁玃癰矔籧籦纕艬蘺虀蘹蘼蘱蘻蘾蠰蠲蠮蠳襶襴襳觾\"],[\"f840\",\"讌讎讋讈豅贙躘轤轣醼鑢鑕鑝鑗鑞韄韅頀驖驙鬞鬟鬠鱒鱘鱐鱊鱍鱋鱕鱙鱌鱎鷻鷷鷯鷣鷫鷸鷤鷶鷡鷮鷦鷲鷰鷢鷬鷴鷳鷨鷭黂黐黲黳鼆鼜鼸鼷鼶齃齏\"],[\"f8a1\",\"齱齰齮齯囓囍孎屭攭曭曮欓灟灡灝灠爣瓛瓥矕礸禷禶籪纗羉艭虃蠸蠷蠵衋讔讕躞躟躠躝醾醽釂鑫鑨鑩雥靆靃靇韇韥驞髕魙鱣鱧鱦鱢鱞鱠鸂鷾鸇鸃鸆鸅鸀鸁鸉鷿鷽鸄麠鼞齆齴齵齶囔攮斸欘欙欗欚灢爦犪矘矙礹籩籫糶纚\"],[\"f940\",\"纘纛纙臠臡虆虇虈襹襺襼襻觿讘讙躥躤躣鑮鑭鑯鑱鑳靉顲饟鱨鱮鱭鸋鸍鸐鸏鸒鸑麡黵鼉齇齸齻齺齹圞灦籯蠼趲躦釃鑴鑸鑶鑵驠鱴鱳鱱鱵鸔鸓黶鼊\"],[\"f9a1\",\"龤灨灥糷虪蠾蠽蠿讞貜躩軉靋顳顴飌饡馫驤驦驧鬤鸕鸗齈戇欞爧虌躨钂钀钁驩驨鬮鸙爩虋讟钃鱹麷癵驫鱺鸝灩灪麤齾齉龘碁銹裏墻恒粧嫺╔╦╗╠╬╣╚╩╝╒╤╕╞╪╡╘╧╛╓╥╖╟╫╢╙╨╜║═╭╮╰╯▓\"]]");
})), Fm = /* @__PURE__ */ i({ default: () => Im }), Im, Lm = n((() => {
	Im = /*#__PURE__*/ JSON.parse("[[\"8740\",\"䏰䰲䘃䖦䕸𧉧䵷䖳𧲱䳢𧳅㮕䜶䝄䱇䱀𤊿𣘗𧍒𦺋𧃒䱗𪍑䝏䗚䲅𧱬䴇䪤䚡𦬣爥𥩔𡩣𣸆𣽡晍囻\"],[\"8767\",\"綕夝𨮹㷴霴𧯯寛𡵞媤㘥𩺰嫑宷峼杮薓𩥅瑡璝㡵𡵓𣚞𦀡㻬\"],[\"87a1\",\"𥣞㫵竼龗𤅡𨤍𣇪𠪊𣉞䌊蒄龖鐯䤰蘓墖靊鈘秐稲晠権袝瑌篅枂稬剏遆㓦珄𥶹瓆鿇垳䤯呌䄱𣚎堘穲𧭥讏䚮𦺈䆁𥶙箮𢒼鿈𢓁𢓉𢓌鿉蔄𣖻䂴鿊䓡𪷿拁灮鿋\"],[\"8840\",\"㇀\",4,\"𠄌㇅𠃑𠃍㇆㇇𠃋𡿨㇈𠃊㇉㇊㇋㇌𠄎㇍㇎ĀÁǍÀĒÉĚÈŌÓǑÒ࿿Ê̄Ế࿿Ê̌ỀÊāáǎàɑēéěèīíǐìōóǒòūúǔùǖǘǚ\"],[\"88a1\",\"ǜü࿿ê̄ế࿿ê̌ềêɡ⏚⏛\"],[\"8940\",\"𪎩𡅅\"],[\"8943\",\"攊\"],[\"8946\",\"丽滝鵎釟\"],[\"894c\",\"𧜵撑会伨侨兖兴农凤务动医华发变团声处备夲头学实実岚庆总斉柾栄桥济炼电纤纬纺织经统缆缷艺苏药视设询车轧轮\"],[\"89a1\",\"琑糼緍楆竉刧\"],[\"89ab\",\"醌碸酞肼\"],[\"89b0\",\"贋胶𠧧\"],[\"89b5\",\"肟黇䳍鷉鸌䰾𩷶𧀎鸊𪄳㗁\"],[\"89c1\",\"溚舾甙\"],[\"89c5\",\"䤑马骏龙禇𨑬𡷊𠗐𢫦两亁亀亇亿仫伷㑌侽㹈倃傈㑽㒓㒥円夅凛凼刅争剹劐匧㗇厩㕑厰㕓参吣㕭㕲㚁咓咣咴咹哐哯唘唣唨㖘唿㖥㖿嗗㗅\"],[\"8a40\",\"𧶄唥\"],[\"8a43\",\"𠱂𠴕𥄫喐𢳆㧬𠍁蹆𤶸𩓥䁓𨂾睺𢰸㨴䟕𨅝𦧲𤷪擝𠵼𠾴𠳕𡃴撍蹾𠺖𠰋𠽤𢲩𨉖𤓓\"],[\"8a64\",\"𠵆𩩍𨃩䟴𤺧𢳂骲㩧𩗴㿭㔆𥋇𩟔𧣈𢵄鵮頕\"],[\"8a76\",\"䏙𦂥撴哣𢵌𢯊𡁷㧻𡁯\"],[\"8aa1\",\"𦛚𦜖𧦠擪𥁒𠱃蹨𢆡𨭌𠜱\"],[\"8aac\",\"䠋𠆩㿺塳𢶍\"],[\"8ab2\",\"𤗈𠓼𦂗𠽌𠶖啹䂻䎺\"],[\"8abb\",\"䪴𢩦𡂝膪飵𠶜捹㧾𢝵跀嚡摼㹃\"],[\"8ac9\",\"𪘁𠸉𢫏𢳉\"],[\"8ace\",\"𡃈𣧂㦒㨆𨊛㕸𥹉𢃇噒𠼱𢲲𩜠㒼氽𤸻\"],[\"8adf\",\"𧕴𢺋𢈈𪙛𨳍𠹺𠰴𦠜羓𡃏𢠃𢤹㗻𥇣𠺌𠾍𠺪㾓𠼰𠵇𡅏𠹌\"],[\"8af6\",\"𠺫𠮩𠵈𡃀𡄽㿹𢚖搲𠾭\"],[\"8b40\",\"𣏴𧘹𢯎𠵾𠵿𢱑𢱕㨘𠺘𡃇𠼮𪘲𦭐𨳒𨶙𨳊閪哌苄喹\"],[\"8b55\",\"𩻃鰦骶𧝞𢷮煀腭胬尜𦕲脴㞗卟𨂽醶𠻺𠸏𠹷𠻻㗝𤷫㘉𠳖嚯𢞵𡃉𠸐𠹸𡁸𡅈𨈇𡑕𠹹𤹐𢶤婔𡀝𡀞𡃵𡃶垜𠸑\"],[\"8ba1\",\"𧚔𨋍𠾵𠹻𥅾㜃𠾶𡆀𥋘𪊽𤧚𡠺𤅷𨉼墙剨㘚𥜽箲孨䠀䬬鼧䧧鰟鮍𥭴𣄽嗻㗲嚉丨夂𡯁屮靑𠂆乛亻㔾尣彑忄㣺扌攵歺氵氺灬爫丬犭𤣩罒礻糹罓𦉪㓁\"],[\"8bde\",\"𦍋耂肀𦘒𦥑卝衤见𧢲讠贝钅镸长门𨸏韦页风飞饣𩠐鱼鸟黄歯龜丷𠂇阝户钢\"],[\"8c40\",\"倻淾𩱳龦㷉袏𤅎灷峵䬠𥇍㕙𥴰愢𨨲辧釶熑朙玺𣊁𪄇㲋𡦀䬐磤琂冮𨜏䀉橣𪊺䈣蘏𠩯稪𩥇𨫪靕灍匤𢁾鏴盙𨧣龧矝亣俰傼丯众龨吴綋墒壐𡶶庒庙忂𢜒斋\"],[\"8ca1\",\"𣏹椙橃𣱣泿\"],[\"8ca7\",\"爀𤔅玌㻛𤨓嬕璹讃𥲤𥚕窓篬糃繬苸薗龩袐龪躹龫迏蕟駠鈡龬𨶹𡐿䁱䊢娚\"],[\"8cc9\",\"顨杫䉶圽\"],[\"8cce\",\"藖𤥻芿𧄍䲁𦵴嵻𦬕𦾾龭龮宖龯曧繛湗秊㶈䓃𣉖𢞖䎚䔶\"],[\"8ce6\",\"峕𣬚諹屸㴒𣕑嵸龲煗䕘𤃬𡸣䱷㥸㑊𠆤𦱁諌侴𠈹妿腬顖𩣺弻\"],[\"8d40\",\"𠮟\"],[\"8d42\",\"𢇁𨥭䄂䚻𩁹㼇龳𪆵䃸㟖䛷𦱆䅼𨚲𧏿䕭㣔𥒚䕡䔛䶉䱻䵶䗪㿈𤬏㙡䓞䒽䇭崾嵈嵖㷼㠏嶤嶹㠠㠸幂庽弥徃㤈㤔㤿㥍惗愽峥㦉憷憹懏㦸戬抐拥挘㧸嚱\"],[\"8da1\",\"㨃揢揻搇摚㩋擀崕嘡龟㪗斆㪽旿晓㫲暒㬢朖㭂枤栀㭘桊梄㭲㭱㭻椉楃牜楤榟榅㮼槖㯝橥橴橱檂㯬檙㯲檫檵櫔櫶殁毁毪汵沪㳋洂洆洦涁㳯涤涱渕渘温溆𨧀溻滢滚齿滨滩漤漴㵆𣽁澁澾㵪㵵熷岙㶊瀬㶑灐灔灯灿炉𠌥䏁㗱𠻘\"],[\"8e40\",\"𣻗垾𦻓焾𥟠㙎榢𨯩孴穉𥣡𩓙穥穽𥦬窻窰竂竃燑𦒍䇊竚竝竪䇯咲𥰁笋筕笩𥌎𥳾箢筯莜𥮴𦱿篐萡箒箸𥴠㶭𥱥蒒篺簆簵𥳁籄粃𤢂粦晽𤕸糉糇糦籴糳糵糎\"],[\"8ea1\",\"繧䔝𦹄絝𦻖璍綉綫焵綳緒𤁗𦀩緤㴓緵𡟹緥𨍭縝𦄡𦅚繮纒䌫鑬縧罀罁罇礶𦋐駡羗𦍑羣𡙡𠁨䕜𣝦䔃𨌺翺𦒉者耈耝耨耯𪂇𦳃耻耼聡𢜔䦉𦘦𣷣𦛨朥肧𨩈脇脚墰𢛶汿𦒘𤾸擧𡒊舘𡡞橓𤩥𤪕䑺舩𠬍𦩒𣵾俹𡓽蓢荢𦬊𤦧𣔰𡝳𣷸芪椛芳䇛\"],[\"8f40\",\"蕋苐茚𠸖𡞴㛁𣅽𣕚艻苢茘𣺋𦶣𦬅𦮗𣗎㶿茝嗬莅䔋𦶥莬菁菓㑾𦻔橗蕚㒖𦹂𢻯葘𥯤葱㷓䓤檧葊𣲵祘蒨𦮖𦹷𦹃蓞萏莑䒠蒓蓤𥲑䉀𥳀䕃蔴嫲𦺙䔧蕳䔖枿蘖\"],[\"8fa1\",\"𨘥𨘻藁𧂈蘂𡖂𧃍䕫䕪蘨㙈𡢢号𧎚虾蝱𪃸蟮𢰧螱蟚蠏噡虬桖䘏衅衆𧗠𣶹𧗤衞袜䙛袴袵揁装睷𧜏覇覊覦覩覧覼𨨥觧𧤤𧪽誜瞓釾誐𧩙竩𧬺𣾏䜓𧬸煼謌謟𥐰𥕥謿譌譍誩𤩺讐讛誯𡛟䘕衏貛𧵔𧶏貫㜥𧵓賖𧶘𧶽贒贃𡤐賛灜贑𤳉㻐起\"],[\"9040\",\"趩𨀂𡀔𤦊㭼𨆼𧄌竧躭躶軃鋔輙輭𨍥𨐒辥錃𪊟𠩐辳䤪𨧞𨔽𣶻廸𣉢迹𪀔𨚼𨔁𢌥㦀𦻗逷𨔼𧪾遡𨕬𨘋邨𨜓郄𨛦邮都酧㫰醩釄粬𨤳𡺉鈎沟鉁鉢𥖹銹𨫆𣲛𨬌𥗛\"],[\"90a1\",\"𠴱錬鍫𨫡𨯫炏嫃𨫢𨫥䥥鉄𨯬𨰹𨯿鍳鑛躼閅閦鐦閠濶䊹𢙺𨛘𡉼𣸮䧟氜陻隖䅬隣𦻕懚隶磵𨫠隽双䦡𦲸𠉴𦐐𩂯𩃥𤫑𡤕𣌊霱虂霶䨏䔽䖅𤫩灵孁霛靜𩇕靗孊𩇫靟鐥僐𣂷𣂼鞉鞟鞱鞾韀韒韠𥑬韮琜𩐳響韵𩐝𧥺䫑頴頳顋顦㬎𧅵㵑𠘰𤅜\"],[\"9140\",\"𥜆飊颷飈飇䫿𦴧𡛓喰飡飦飬鍸餹𤨩䭲𩡗𩤅駵騌騻騐驘𥜥㛄𩂱𩯕髠髢𩬅髴䰎鬔鬭𨘀倴鬴𦦨㣃𣁽魐魀𩴾婅𡡣鮎𤉋鰂鯿鰌𩹨鷔𩾷𪆒𪆫𪃡𪄣𪇟鵾鶃𪄴鸎梈\"],[\"91a1\",\"鷄𢅛𪆓𪈠𡤻𪈳鴹𪂹𪊴麐麕麞麢䴴麪麯𤍤黁㭠㧥㴝伲㞾𨰫鼂鼈䮖鐤𦶢鼗鼖鼹嚟嚊齅馸𩂋韲葿齢齩竜龎爖䮾𤥵𤦻煷𤧸𤍈𤩑玞𨯚𡣺禟𨥾𨸶鍩鏳𨩄鋬鎁鏋𨥬𤒹爗㻫睲穃烐𤑳𤏸煾𡟯炣𡢾𣖙㻇𡢅𥐯𡟸㜢𡛻𡠹㛡𡝴𡣑𥽋㜣𡛀坛𤨥𡏾𡊨\"],[\"9240\",\"𡏆𡒶蔃𣚦蔃葕𤦔𧅥𣸱𥕜𣻻𧁒䓴𣛮𩦝𦼦柹㜳㰕㷧塬𡤢栐䁗𣜿𤃡𤂋𤄏𦰡哋嚞𦚱嚒𠿟𠮨𠸍鏆𨬓鎜仸儫㠙𤐶亼𠑥𠍿佋侊𥙑婨𠆫𠏋㦙𠌊𠐔㐵伩𠋀𨺳𠉵諚𠈌亘\"],[\"92a1\",\"働儍侢伃𤨎𣺊佂倮偬傁俌俥偘僼兙兛兝兞湶𣖕𣸹𣺿浲𡢄𣺉冨凃𠗠䓝𠒣𠒒𠒑赺𨪜𠜎剙劤𠡳勡鍮䙺熌𤎌𠰠𤦬𡃤槑𠸝瑹㻞璙琔瑖玘䮎𤪼𤂍叐㖄爏𤃉喴𠍅响𠯆圝鉝雴鍦埝垍坿㘾壋媙𨩆𡛺𡝯𡜐娬妸銏婾嫏娒𥥆𡧳𡡡𤊕㛵洅瑃娡𥺃\"],[\"9340\",\"媁𨯗𠐓鏠璌𡌃焅䥲鐈𨧻鎽㞠尞岞幞幈𡦖𡥼𣫮廍孏𡤃𡤄㜁𡢠㛝𡛾㛓脪𨩇𡶺𣑲𨦨弌弎𡤧𡞫婫𡜻孄蘔𧗽衠恾𢡠𢘫忛㺸𢖯𢖾𩂈𦽳懀𠀾𠁆𢘛憙憘恵𢲛𢴇𤛔𩅍\"],[\"93a1\",\"摱𤙥𢭪㨩𢬢𣑐𩣪𢹸挷𪑛撶挱揑𤧣𢵧护𢲡搻敫楲㯴𣂎𣊭𤦉𣊫唍𣋠𡣙𩐿曎𣊉𣆳㫠䆐𥖄𨬢𥖏𡛼𥕛𥐥磮𣄃𡠪𣈴㑤𣈏𣆂𤋉暎𦴤晫䮓昰𧡰𡷫晣𣋒𣋡昞𥡲㣑𣠺𣞼㮙𣞢𣏾瓐㮖枏𤘪梶栞㯄檾㡣𣟕𤒇樳橒櫉欅𡤒攑梘橌㯗橺歗𣿀𣲚鎠鋲𨯪𨫋\"],[\"9440\",\"銉𨀞𨧜鑧涥漋𤧬浧𣽿㶏渄𤀼娽渊塇洤硂焻𤌚𤉶烱牐犇犔𤞏𤜥兹𤪤𠗫瑺𣻸𣙟𤩊𤤗𥿡㼆㺱𤫟𨰣𣼵悧㻳瓌琼鎇琷䒟𦷪䕑疃㽣𤳙𤴆㽘畕癳𪗆㬙瑨𨫌𤦫𤦎㫻\"],[\"94a1\",\"㷍𤩎㻿𤧅𤣳釺圲鍂𨫣𡡤僟𥈡𥇧睸𣈲眎眏睻𤚗𣞁㩞𤣰琸璛㺿𤪺𤫇䃈𤪖𦆮錇𥖁砞碍碈磒珐祙𧝁𥛣䄎禛蒖禥樭𣻺稺秴䅮𡛦䄲鈵秱𠵌𤦌𠊙𣶺𡝮㖗啫㕰㚪𠇔𠰍竢婙𢛵𥪯𥪜娍𠉛磰娪𥯆竾䇹籝籭䈑𥮳𥺼𥺦糍𤧹𡞰粎籼粮檲緜縇緓罎𦉡\"],[\"9540\",\"𦅜𧭈綗𥺂䉪𦭵𠤖柖𠁎𣗏埄𦐒𦏸𤥢翝笧𠠬𥫩𥵃笌𥸎駦虅驣樜𣐿㧢𤧷𦖭騟𦖠蒀𧄧𦳑䓪脷䐂胆脉腂𦞴飃𦩂艢艥𦩑葓𦶧蘐𧈛媆䅿𡡀嬫𡢡嫤𡣘蚠蜨𣶏蠭𧐢娂\"],[\"95a1\",\"衮佅袇袿裦襥襍𥚃襔𧞅𧞄𨯵𨯙𨮜𨧹㺭蒣䛵䛏㟲訽訜𩑈彍鈫𤊄旔焩烄𡡅鵭貟賩𧷜妚矃姰䍮㛔踪躧𤰉輰轊䋴汘澻𢌡䢛潹溋𡟚鯩㚵𤤯邻邗啱䤆醻鐄𨩋䁢𨫼鐧𨰝𨰻蓥訫閙閧閗閖𨴴瑅㻂𤣿𤩂𤏪㻧𣈥随𨻧𨹦𨹥㻌𤧭𤩸𣿮琒瑫㻼靁𩂰\"],[\"9640\",\"桇䨝𩂓𥟟靝鍨𨦉𨰦𨬯𦎾銺嬑譩䤼珹𤈛鞛靱餸𠼦巁𨯅𤪲頟𩓚鋶𩗗釥䓀𨭐𤩧𨭤飜𨩅㼀鈪䤥萔餻饍𧬆㷽馛䭯馪驜𨭥𥣈檏騡嫾騯𩣱䮐𩥈馼䮽䮗鍽塲𡌂堢𤦸\"],[\"96a1\",\"𡓨硄𢜟𣶸棅㵽鑘㤧慐𢞁𢥫愇鱏鱓鱻鰵鰐魿鯏𩸭鮟𪇵𪃾鴡䲮𤄄鸘䲰鴌𪆴𪃭𪃳𩤯鶥蒽𦸒𦿟𦮂藼䔳𦶤𦺄𦷰萠藮𦸀𣟗𦁤秢𣖜𣙀䤭𤧞㵢鏛銾鍈𠊿碹鉷鑍俤㑀遤𥕝砽硔碶硋𡝗𣇉𤥁㚚佲濚濙瀞瀞吔𤆵垻壳垊鴖埗焴㒯𤆬燫𦱀𤾗嬨𡞵𨩉\"],[\"9740\",\"愌嫎娋䊼𤒈㜬䭻𨧼鎻鎸𡣖𠼝葲𦳀𡐓𤋺𢰦𤏁妔𣶷𦝁綨𦅛𦂤𤦹𤦋𨧺鋥珢㻩璴𨭣𡢟㻡𤪳櫘珳珻㻖𤨾𤪔𡟙𤩦𠎧𡐤𤧥瑈𤤖炥𤥶銄珦鍟𠓾錱𨫎𨨖鎆𨯧𥗕䤵𨪂煫\"],[\"97a1\",\"𤥃𠳿嚤𠘚𠯫𠲸唂秄𡟺緾𡛂𤩐𡡒䔮鐁㜊𨫀𤦭妰𡢿𡢃𧒄媡㛢𣵛㚰鉟婹𨪁𡡢鍴㳍𠪴䪖㦊僴㵩㵌𡎜煵䋻𨈘渏𩃤䓫浗𧹏灧沯㳖𣿭𣸭渂漌㵯𠏵畑㚼㓈䚀㻚䡱姄鉮䤾轁𨰜𦯀堒埈㛖𡑒烾𤍢𤩱𢿣𡊰𢎽梹楧𡎘𣓥𧯴𣛟𨪃𣟖𣏺𤲟樚𣚭𦲷萾䓟䓎\"],[\"9840\",\"𦴦𦵑𦲂𦿞漗𧄉茽𡜺菭𦲀𧁓𡟛妉媂𡞳婡婱𡤅𤇼㜭姯𡜼㛇熎鎐暚𤊥婮娫𤊓樫𣻹𧜶𤑛𤋊焝𤉙𨧡侰𦴨峂𤓎𧹍𤎽樌𤉖𡌄炦焳𤏩㶥泟勇𤩏繥姫崯㷳彜𤩝𡟟綤萦\"],[\"98a1\",\"咅𣫺𣌀𠈔坾𠣕𠘙㿥𡾞𪊶瀃𩅛嵰玏糓𨩙𩐠俈翧狍猐𧫴猸猹𥛶獁獈㺩𧬘遬燵𤣲珡臶㻊県㻑沢国琙琞琟㻢㻰㻴㻺瓓㼎㽓畂畭畲疍㽼痈痜㿀癍㿗癴㿜発𤽜熈嘣覀塩䀝睃䀹条䁅㗛瞘䁪䁯属瞾矋売砘点砜䂨砹硇硑硦葈𥔵礳栃礲䄃\"],[\"9940\",\"䄉禑禙辻稆込䅧窑䆲窼艹䇄竏竛䇏両筢筬筻簒簛䉠䉺类粜䊌粸䊔糭输烀𠳏総緔緐緽羮羴犟䎗耠耥笹耮耱联㷌垴炠肷胩䏭脌猪脎脒畠脔䐁㬹腖腙腚\"],[\"99a1\",\"䐓堺腼膄䐥膓䐭膥埯臁臤艔䒏芦艶苊苘苿䒰荗险榊萅烵葤惣蒈䔄蒾蓡蓸蔐蔸蕒䔻蕯蕰藠䕷虲蚒蚲蛯际螋䘆䘗袮裿褤襇覑𧥧訩訸誔誴豑賔賲贜䞘塟跃䟭仮踺嗘坔蹱嗵躰䠷軎転軤軭軲辷迁迊迌逳駄䢭飠鈓䤞鈨鉘鉫銱銮銿\"],[\"9a40\",\"鋣鋫鋳鋴鋽鍃鎄鎭䥅䥑麿鐗匁鐝鐭鐾䥪鑔鑹锭関䦧间阳䧥枠䨤靀䨵鞲韂噔䫤惨颹䬙飱塄餎餙冴餜餷饂饝饢䭰駅䮝騼鬏窃魩鮁鯝鯱鯴䱭鰠㝯𡯂鵉鰺\"],[\"9aa1\",\"黾噐鶓鶽鷀鷼银辶鹻麬麱麽黆铜黢黱黸竈齄𠂔𠊷𠎠椚铃妬𠓗塀铁㞹𠗕𠘕𠙶𡚺块煳𠫂𠫍𠮿呪吆𠯋咞𠯻𠰻𠱓𠱥𠱼惧𠲍噺𠲵𠳝𠳭𠵯𠶲𠷈楕鰯螥𠸄𠸎𠻗𠾐𠼭𠹳尠𠾼帋𡁜𡁏𡁶朞𡁻𡂈𡂖㙇𡂿𡃓𡄯𡄻卤蒭𡋣𡍵𡌶讁𡕷𡘙𡟃𡟇乸炻𡠭𡥪\"],[\"9b40\",\"𡨭𡩅𡰪𡱰𡲬𡻈拃𡻕𡼕熘桕𢁅槩㛈𢉼𢏗𢏺𢜪𢡱𢥏苽𢥧𢦓𢫕覥𢫨辠𢬎鞸𢬿顇骽𢱌\"],[\"9b62\",\"𢲈𢲷𥯨𢴈𢴒𢶷𢶕𢹂𢽴𢿌𣀳𣁦𣌟𣏞徱晈暿𧩹𣕧𣗳爁𤦺矗𣘚𣜖纇𠍆墵朎\"],[\"9ba1\",\"椘𣪧𧙗𥿢𣸑𣺹𧗾𢂚䣐䪸𤄙𨪚𤋮𤌍𤀻𤌴𤎖𤩅𠗊凒𠘑妟𡺨㮾𣳿𤐄𤓖垈𤙴㦛𤜯𨗨𩧉㝢𢇃譞𨭎駖𤠒𤣻𤨕爉𤫀𠱸奥𤺥𤾆𠝹軚𥀬劏圿煱𥊙𥐙𣽊𤪧喼𥑆𥑮𦭒釔㑳𥔿𧘲𥕞䜘𥕢𥕦𥟇𤤿𥡝偦㓻𣏌惞𥤃䝼𨥈𥪮𥮉𥰆𡶐垡煑澶𦄂𧰒遖𦆲𤾚譢𦐂𦑊\"],[\"9c40\",\"嵛𦯷輶𦒄𡤜諪𤧶𦒈𣿯𦔒䯀𦖿𦚵𢜛鑥𥟡憕娧晉侻嚹𤔡𦛼乪𤤴陖涏𦲽㘘襷𦞙𦡮𦐑𦡞營𦣇筂𩃀𠨑𦤦鄄𦤹穅鷰𦧺騦𦨭㙟𦑩𠀡禃𦨴𦭛崬𣔙菏𦮝䛐𦲤画补𦶮墶\"],[\"9ca1\",\"㜜𢖍𧁋𧇍㱔𧊀𧊅銁𢅺𧊋錰𧋦𤧐氹钟𧑐𠻸蠧裵𢤦𨑳𡞱溸𤨪𡠠㦤㚹尐秣䔿暶𩲭𩢤襃𧟌𧡘囖䃟𡘊㦡𣜯𨃨𡏅熭荦𧧝𩆨婧䲷𧂯𨦫𧧽𧨊𧬋𧵦𤅺筃祾𨀉澵𪋟樃𨌘厢𦸇鎿栶靝𨅯𨀣𦦵𡏭𣈯𨁈嶅𨰰𨂃圕頣𨥉嶫𤦈斾槕叒𤪥𣾁㰑朶𨂐𨃴𨄮𡾡𨅏\"],[\"9d40\",\"𨆉𨆯𨈚𨌆𨌯𨎊㗊𨑨𨚪䣺揦𨥖砈鉕𨦸䏲𨧧䏟𨧨𨭆𨯔姸𨰉輋𨿅𩃬筑𩄐𩄼㷷𩅞𤫊运犏嚋𩓧𩗩𩖰𩖸𩜲𩣑𩥉𩥪𩧃𩨨𩬎𩵚𩶛纟𩻸𩼣䲤镇𪊓熢𪋿䶑递𪗋䶜𠲜达嗁\"],[\"9da1\",\"辺𢒰边𤪓䔉繿潖檱仪㓤𨬬𧢝㜺躀𡟵𨀤𨭬𨮙𧨾𦚯㷫𧙕𣲷𥘵𥥖亚𥺁𦉘嚿𠹭踎孭𣺈𤲞揞拐𡟶𡡻攰嘭𥱊吚𥌑㷆𩶘䱽嘢嘞罉𥻘奵𣵀蝰东𠿪𠵉𣚺脗鵞贘瘻鱅癎瞹鍅吲腈苷嘥脲萘肽嗪祢噃吖𠺝㗎嘅嗱曱𨋢㘭甴嗰喺咗啲𠱁𠲖廐𥅈𠹶𢱢\"],[\"9e40\",\"𠺢麫絚嗞𡁵抝靭咔賍燶酶揼掹揾啩𢭃鱲𢺳冚㓟𠶧冧呍唞唓癦踭𦢊疱肶蠄螆裇膶萜𡃁䓬猄𤜆宐茋𦢓噻𢛴𧴯𤆣𧵳𦻐𧊶酰𡇙鈈𣳼𪚩𠺬𠻹牦𡲢䝎𤿂𧿹𠿫䃺\"],[\"9ea1\",\"鱝攟𢶠䣳𤟠𩵼𠿬𠸊恢𧖣𠿭\"],[\"9ead\",\"𦁈𡆇熣纎鵐业丄㕷嬍沲卧㚬㧜卽㚥𤘘墚𤭮舭呋垪𥪕𠥹\"],[\"9ec5\",\"㩒𢑥獴𩺬䴉鯭𣳾𩼰䱛𤾩𩖞𩿞葜𣶶𧊲𦞳𣜠挮紥𣻷𣸬㨪逈勌㹴㙺䗩𠒎癀嫰𠺶硺𧼮墧䂿噼鮋嵴癔𪐴麅䳡痹㟻愙𣃚𤏲\"],[\"9ef5\",\"噝𡊩垧𤥣𩸆刴𧂮㖭汊鵼\"],[\"9f40\",\"籖鬹埞𡝬屓擓𩓐𦌵𧅤蚭𠴨𦴢𤫢𠵱\"],[\"9f4f\",\"凾𡼏嶎霃𡷑麁遌笟鬂峑箣扨挵髿篏鬪籾鬮籂粆鰕篼鬉鼗鰛𤤾齚啳寃俽麘俲剠㸆勑坧偖妷帒韈鶫轜呩鞴饀鞺匬愰\"],[\"9fa1\",\"椬叚鰊鴂䰻陁榀傦畆𡝭駚剳\"],[\"9fae\",\"酙隁酜\"],[\"9fb2\",\"酑𨺗捿𦴣櫊嘑醎畺抅𠏼獏籰𥰡𣳽\"],[\"9fc1\",\"𤤙盖鮝个𠳔莾衂\"],[\"9fc9\",\"届槀僭坺刟巵从氱𠇲伹咜哚劚趂㗾弌㗳\"],[\"9fdb\",\"歒酼龥鮗頮颴骺麨麄煺笔\"],[\"9fe7\",\"毺蠘罸\"],[\"9feb\",\"嘠𪙊蹷齓\"],[\"9ff0\",\"跔蹏鸜踁抂𨍽踨蹵竓𤩷稾磘泪詧瘇\"],[\"a040\",\"𨩚鼦泎蟖痃𪊲硓咢贌狢獱謭猂瓱賫𤪻蘯徺袠䒷\"],[\"a055\",\"𡠻𦸅\"],[\"a058\",\"詾𢔛\"],[\"a05b\",\"惽癧髗鵄鍮鮏蟵\"],[\"a063\",\"蠏賷猬霡鮰㗖犲䰇籑饊𦅙慙䰄麖慽\"],[\"a073\",\"坟慯抦戹拎㩜懢厪𣏵捤栂㗒\"],[\"a0a1\",\"嵗𨯂迚𨸹\"],[\"a0a6\",\"僙𡵆礆匲阸𠼻䁥\"],[\"a0ae\",\"矾\"],[\"a0b0\",\"糂𥼚糚稭聦聣絍甅瓲覔舚朌聢𧒆聛瓰脃眤覉𦟌畓𦻑螩蟎臈螌詉貭譃眫瓸蓚㘵榲趦\"],[\"a0d4\",\"覩瑨涹蟁𤀑瓧㷛煶悤憜㳑煢恷\"],[\"a0e2\",\"罱𨬭牐惩䭾删㰘𣳇𥻗𧙖𥔱𡥄𡋾𩤃𦷜𧂭峁𦆭𨨏𣙷𠃮𦡆𤼎䕢嬟𦍌齐麦𦉫\"],[\"a3c0\",\"␀\",31,\"␡\"],[\"c6a1\",\"①\",9,\"⑴\",9,\"ⅰ\",9,\"丶丿亅亠冂冖冫勹匸卩厶夊宀巛⼳广廴彐彡攴无疒癶辵隶¨ˆヽヾゝゞ〃仝々〆〇ー［］✽ぁ\",23],[\"c740\",\"す\",58,\"ァアィイ\"],[\"c7a1\",\"ゥ\",81,\"А\",5,\"ЁЖ\",4],[\"c840\",\"Л\",26,\"ёж\",25,\"⇧↸↹㇏𠃌乚𠂊刂䒑\"],[\"c8a1\",\"龰冈龱𧘇\"],[\"c8cd\",\"￢￤＇＂㈱№℡゛゜⺀⺄⺆⺇⺈⺊⺌⺍⺕⺜⺝⺥⺧⺪⺬⺮⺶⺼⺾⻆⻊⻌⻍⻏⻖⻗⻞⻣\"],[\"c8f5\",\"ʃɐɛɔɵœøŋʊɪ\"],[\"f9fe\",\"￭\"],[\"fa40\",\"𠕇鋛𠗟𣿅蕌䊵珯况㙉𤥂𨧤鍄𡧛苮𣳈砼杄拟𤤳𨦪𠊠𦮳𡌅侫𢓭倈𦴩𧪄𣘀𤪱𢔓倩𠍾徤𠎀𠍇滛𠐟偽儁㑺儎顬㝃萖𤦤𠒇兠𣎴兪𠯿𢃼𠋥𢔰𠖎𣈳𡦃宂蝽𠖳𣲙冲冸\"],[\"faa1\",\"鴴凉减凑㳜凓𤪦决凢卂凭菍椾𣜭彻刋刦刼劵剗劔効勅簕蕂勠蘍𦬓包𨫞啉滙𣾀𠥔𣿬匳卄𠯢泋𡜦栛珕恊㺪㣌𡛨燝䒢卭却𨚫卾卿𡖖𡘓矦厓𨪛厠厫厮玧𥝲㽙玜叁叅汉义埾叙㪫𠮏叠𣿫𢶣叶𠱷吓灹唫晗浛呭𦭓𠵴啝咏咤䞦𡜍𠻝㶴𠵍\"],[\"fb40\",\"𨦼𢚘啇䳭启琗喆喩嘅𡣗𤀺䕒𤐵暳𡂴嘷曍𣊊暤暭噍噏磱囱鞇叾圀囯园𨭦㘣𡉏坆𤆥汮炋坂㚱𦱾埦𡐖堃𡑔𤍣堦𤯵塜墪㕡壠壜𡈼壻寿坃𪅐𤉸鏓㖡够梦㛃湙\"],[\"fba1\",\"𡘾娤啓𡚒蔅姉𠵎𦲁𦴪𡟜姙𡟻𡞲𦶦浱𡠨𡛕姹𦹅媫婣㛦𤦩婷㜈媖瑥嫓𦾡𢕔㶅𡤑㜲𡚸広勐孶斈孼𧨎䀄䡝𠈄寕慠𡨴𥧌𠖥寳宝䴐尅𡭄尓珎尔𡲥𦬨屉䣝岅峩峯嶋𡷹𡸷崐崘嵆𡺤岺巗苼㠭𤤁𢁉𢅳芇㠶㯂帮檊幵幺𤒼𠳓厦亷廐厨𡝱帉廴𨒂\"],[\"fc40\",\"廹廻㢠廼栾鐛弍𠇁弢㫞䢮𡌺强𦢈𢏐彘𢑱彣鞽𦹮彲鍀𨨶徧嶶㵟𥉐𡽪𧃸𢙨釖𠊞𨨩怱暅𡡷㥣㷇㘹垐𢞴祱㹀悞悤悳𤦂𤦏𧩓璤僡媠慤萤慂慈𦻒憁凴𠙖憇宪𣾷\"],[\"fca1\",\"𢡟懓𨮝𩥝懐㤲𢦀𢣁怣慜攞掋𠄘担𡝰拕𢸍捬𤧟㨗搸揸𡎎𡟼撐澊𢸶頔𤂌𥜝擡擥鑻㩦携㩗敍漖𤨨𤨣斅敭敟𣁾斵𤥀䬷旑䃘𡠩无旣忟𣐀昘𣇷𣇸晄𣆤𣆥晋𠹵晧𥇦晳晴𡸽𣈱𨗴𣇈𥌓矅𢣷馤朂𤎜𤨡㬫槺𣟂杞杧杢𤇍𩃭柗䓩栢湐鈼栁𣏦𦶠桝\"],[\"fd40\",\"𣑯槡樋𨫟楳棃𣗍椁椀㴲㨁𣘼㮀枬楡𨩊䋼椶榘㮡𠏉荣傐槹𣙙𢄪橅𣜃檝㯳枱櫈𩆜㰍欝𠤣惞欵歴𢟍溵𣫛𠎵𡥘㝀吡𣭚毡𣻼毜氷𢒋𤣱𦭑汚舦汹𣶼䓅𣶽𤆤𤤌𤤀\"],[\"fda1\",\"𣳉㛥㳫𠴲鮃𣇹𢒑羏样𦴥𦶡𦷫涖浜湼漄𤥿𤂅𦹲蔳𦽴凇沜渝萮𨬡港𣸯瑓𣾂秌湏媑𣁋濸㜍澝𣸰滺𡒗𤀽䕕鏰潄潜㵎潴𩅰㴻澟𤅄濓𤂑𤅕𤀹𣿰𣾴𤄿凟𤅖𤅗𤅀𦇝灋灾炧炁烌烕烖烟䄄㷨熴熖𤉷焫煅媈煊煮岜𤍥煏鍢𤋁焬𤑚𤨧𤨢熺𨯨炽爎\"],[\"fe40\",\"鑂爕夑鑃爤鍁𥘅爮牀𤥴梽牕牗㹕𣁄栍漽犂猪猫𤠣𨠫䣭𨠄猨献珏玪𠰺𦨮珉瑉𤇢𡛧𤨤昣㛅𤦷𤦍𤧻珷琕椃𤨦琹𠗃㻗瑜𢢭瑠𨺲瑇珤瑶莹瑬㜰瑴鏱樬璂䥓𤪌\"],[\"fea1\",\"𤅟𤩹𨮏孆𨰃𡢞瓈𡦈甎瓩甞𨻙𡩋寗𨺬鎅畍畊畧畮𤾂㼄𤴓疎瑝疞疴瘂瘬癑癏癯癶𦏵皐臯㟸𦤑𦤎皡皥皷盌𦾟葢𥂝𥅽𡸜眞眦着撯𥈠睘𣊬瞯𨥤𨥨𡛁矴砉𡍶𤨒棊碯磇磓隥礮𥗠磗礴碱𧘌辸袄𨬫𦂃𢘜禆褀椂禀𥡗禝𧬹礼禩渪𧄦㺨秆𩄍秔\"]]");
})), Rm = /* @__PURE__ */ a(((t, n) => {
	n.exports = {
		shiftjis: {
			type: "_dbcs",
			table: function() {
				return mm(), e(fm).default;
			},
			encodeAdd: {
				"¥": 92,
				"‾": 126
			},
			encodeSkipVals: [{
				from: 60736,
				to: 63808
			}]
		},
		csshiftjis: "shiftjis",
		mskanji: "shiftjis",
		sjis: "shiftjis",
		windows31j: "shiftjis",
		ms31j: "shiftjis",
		xsjis: "shiftjis",
		windows932: "shiftjis",
		ms932: "shiftjis",
		932: "shiftjis",
		cp932: "shiftjis",
		eucjp: {
			type: "_dbcs",
			table: function() {
				return _m(), e(hm).default;
			},
			encodeAdd: {
				"¥": 92,
				"‾": 126
			}
		},
		gb2312: "cp936",
		gb231280: "cp936",
		gb23121980: "cp936",
		csgb2312: "cp936",
		csiso58gb231280: "cp936",
		euccn: "cp936",
		windows936: "cp936",
		ms936: "cp936",
		936: "cp936",
		cp936: {
			type: "_dbcs",
			table: function() {
				return bm(), e(vm).default;
			}
		},
		gbk: {
			type: "_dbcs",
			table: function() {
				return (bm(), e(vm).default).concat((Cm(), e(xm).default));
			}
		},
		xgbk: "gbk",
		isoir58: "gbk",
		gb18030: {
			type: "_dbcs",
			table: function() {
				return (bm(), e(vm).default).concat((Cm(), e(xm).default));
			},
			gb18030: function() {
				return Om(), e(wm).default;
			},
			encodeSkipVals: [128],
			encodeAdd: { "€": 41699 }
		},
		chinese: "gb18030",
		windows949: "cp949",
		ms949: "cp949",
		949: "cp949",
		cp949: {
			type: "_dbcs",
			table: function() {
				return jm(), e(km).default;
			}
		},
		cseuckr: "cp949",
		csksc56011987: "cp949",
		euckr: "cp949",
		isoir149: "cp949",
		korean: "cp949",
		ksc56011987: "cp949",
		ksc56011989: "cp949",
		ksc5601: "cp949",
		windows950: "cp950",
		ms950: "cp950",
		950: "cp950",
		cp950: {
			type: "_dbcs",
			table: function() {
				return Pm(), e(Mm).default;
			}
		},
		big5: "big5hkscs",
		big5hkscs: {
			type: "_dbcs",
			table: function() {
				return (Pm(), e(Mm).default).concat((Lm(), e(Fm).default));
			},
			encodeSkipVals: [
				36457,
				36463,
				36478,
				36523,
				36532,
				36557,
				36560,
				36695,
				36713,
				36718,
				36811,
				36862,
				36973,
				36986,
				37060,
				37084,
				37105,
				37311,
				37551,
				37552,
				37553,
				37554,
				37585,
				37959,
				38090,
				38361,
				38652,
				39285,
				39798,
				39800,
				39803,
				39878,
				39902,
				39916,
				39926,
				40002,
				40019,
				40034,
				40040,
				40043,
				40055,
				40124,
				40125,
				40144,
				40279,
				40282,
				40388,
				40431,
				40443,
				40617,
				40687,
				40701,
				40800,
				40907,
				41079,
				41180,
				41183,
				36812,
				37576,
				38468,
				38637,
				41636,
				41637,
				41639,
				41638,
				41676,
				41678
			]
		},
		cnbig5: "big5hkscs",
		csbig5: "big5hkscs",
		xxbig5: "big5hkscs"
	};
})), zm = /* @__PURE__ */ a(((e) => {
	for (var t = rm(), n = [
		im(),
		am(),
		om(),
		sm(),
		cm(),
		lm(),
		um(),
		dm(),
		Rm()
	], r = 0; r < n.length; r++) {
		var i = n[r];
		t(e, i);
	}
})), Bm = /* @__PURE__ */ a(((e, t) => {
	var n = tm().Buffer;
	t.exports = function(e) {
		var t = e.Transform;
		function r(e, n) {
			this.conv = e, n ||= {}, n.decodeStrings = !1, t.call(this, n);
		}
		r.prototype = Object.create(t.prototype, { constructor: { value: r } }), r.prototype._transform = function(e, t, n) {
			if (typeof e != "string") return n(/* @__PURE__ */ Error("Iconv encoding stream needs strings as its input."));
			try {
				var r = this.conv.write(e);
				r && r.length && this.push(r), n();
			} catch (e) {
				n(e);
			}
		}, r.prototype._flush = function(e) {
			try {
				var t = this.conv.end();
				t && t.length && this.push(t), e();
			} catch (t) {
				e(t);
			}
		}, r.prototype.collect = function(e) {
			var t = [];
			return this.on("error", e), this.on("data", function(e) {
				t.push(e);
			}), this.on("end", function() {
				e(null, n.concat(t));
			}), this;
		};
		function i(e, n) {
			this.conv = e, n ||= {}, n.encoding = this.encoding = "utf8", t.call(this, n);
		}
		return i.prototype = Object.create(t.prototype, { constructor: { value: i } }), i.prototype._transform = function(e, t, r) {
			if (!n.isBuffer(e) && !(e instanceof Uint8Array)) return r(/* @__PURE__ */ Error("Iconv decoding stream needs buffers as its input."));
			try {
				var i = this.conv.write(e);
				i && i.length && this.push(i, this.encoding), r();
			} catch (e) {
				r(e);
			}
		}, i.prototype._flush = function(e) {
			try {
				var t = this.conv.end();
				t && t.length && this.push(t, this.encoding), e();
			} catch (t) {
				e(t);
			}
		}, i.prototype.collect = function(e) {
			var t = "";
			return this.on("error", e), this.on("data", function(e) {
				t += e;
			}), this.on("end", function() {
				e(null, t);
			}), this;
		}, {
			IconvLiteEncoderStream: r,
			IconvLiteDecoderStream: i
		};
	};
})), Vm = /* @__PURE__ */ a(((e, n) => {
	var r = tm().Buffer, i = nm(), a = rm();
	n.exports.encodings = null, n.exports.defaultCharUnicode = "�", n.exports.defaultCharSingleByte = "?", n.exports.encode = function(e, t, i) {
		e = "" + (e || "");
		var a = n.exports.getEncoder(t, i), o = a.write(e), s = a.end();
		return s && s.length > 0 ? r.concat([o, s]) : o;
	}, n.exports.decode = function(e, t, i) {
		typeof e == "string" && (n.exports.skipDecodeWarning || (console.error("Iconv-lite warning: decode()-ing strings is deprecated. Refer to https://github.com/ashtuchkin/iconv-lite/wiki/Use-Buffers-when-decoding"), n.exports.skipDecodeWarning = !0), e = r.from("" + (e || ""), "binary"));
		var a = n.exports.getDecoder(t, i), o = a.write(e), s = a.end();
		return s ? o + s : o;
	}, n.exports.encodingExists = function(e) {
		try {
			return n.exports.getCodec(e), !0;
		} catch {
			return !1;
		}
	}, n.exports.toEncoding = n.exports.encode, n.exports.fromEncoding = n.exports.decode, n.exports._codecDataCache = { __proto__: null }, n.exports.getCodec = function(e) {
		if (!n.exports.encodings) {
			var t = zm();
			n.exports.encodings = { __proto__: null }, a(n.exports.encodings, t);
		}
		for (var r = n.exports._canonicalizeEncoding(e), i = {};;) {
			var o = n.exports._codecDataCache[r];
			if (o) return o;
			var s = n.exports.encodings[r];
			switch (typeof s) {
				case "string":
					r = s;
					break;
				case "object":
					for (var c in s) i[c] = s[c];
					i.encodingName ||= r, r = s.type;
					break;
				case "function": return i.encodingName ||= r, o = new s(i, n.exports), n.exports._codecDataCache[i.encodingName] = o, o;
				default: throw Error("Encoding not recognized: '" + e + "' (searched as: '" + r + "')");
			}
		}
	}, n.exports._canonicalizeEncoding = function(e) {
		return ("" + e).toLowerCase().replace(/:\d{4}$|[^0-9a-z]/g, "");
	}, n.exports.getEncoder = function(e, t) {
		var r = n.exports.getCodec(e), a = new r.encoder(t, r);
		return r.bomAware && t && t.addBOM && (a = new i.PrependBOM(a, t)), a;
	}, n.exports.getDecoder = function(e, t) {
		var r = n.exports.getCodec(e), a = new r.decoder(t, r);
		return r.bomAware && !(t && t.stripBOM === !1) && (a = new i.StripBOM(a, t)), a;
	}, n.exports.enableStreamingAPI = function(e) {
		if (!n.exports.supportsStreams) {
			var t = Bm()(e);
			n.exports.IconvLiteEncoderStream = t.IconvLiteEncoderStream, n.exports.IconvLiteDecoderStream = t.IconvLiteDecoderStream, n.exports.encodeStream = function(e, t) {
				return new n.exports.IconvLiteEncoderStream(n.exports.getEncoder(e, t), t);
			}, n.exports.decodeStream = function(e, t) {
				return new n.exports.IconvLiteDecoderStream(n.exports.getDecoder(e, t), t);
			}, n.exports.supportsStreams = !0;
		}
	};
	var o;
	try {
		o = t("stream");
	} catch {}
	o && o.Transform ? n.exports.enableStreamingAPI(o) : n.exports.encodeStream = n.exports.decodeStream = function() {
		throw Error("iconv-lite Streaming API is not enabled. Use iconv.enableStreamingAPI(require('stream')); to enable it.");
	};
})), Hm = /* @__PURE__ */ a(((e, t) => {
	t.exports = r;
	function n(e) {
		for (var t = e.listeners("data"), n = 0; n < t.length; n++) if (t[n].name === "ondata") return !0;
		return !1;
	}
	function r(e) {
		if (!e) throw TypeError("argument stream is required");
		if (typeof e.unpipe == "function") {
			e.unpipe();
			return;
		}
		if (n(e)) for (var t, r = e.listeners("close"), i = 0; i < r.length; i++) t = r[i], (t.name === "cleanup" || t.name === "onclose") && t.call(e);
	}
})), Um = /* @__PURE__ */ a(((e, n) => {
	var r = p(), i = Wp(), a = em(), o = Vm(), s = Hm();
	n.exports = u;
	var c = /^Encoding not recognized: /;
	function l(e) {
		if (!e) return null;
		try {
			return o.getDecoder(e);
		} catch (t) {
			throw c.test(t.message) ? a(415, "specified encoding unsupported", {
				encoding: e,
				type: "encoding.unsupported"
			}) : t;
		}
	}
	function u(e, t, n) {
		var r = n, a = t || {};
		if (e === void 0) throw TypeError("argument stream is required");
		if (typeof e != "object" || !e || typeof e.on != "function") throw TypeError("argument stream must be a stream");
		if ((t === !0 || typeof t == "string") && (a = { encoding: t }), typeof t == "function" && (r = t, a = {}), r !== void 0 && typeof r != "function") throw TypeError("argument callback must be a function");
		if (!r && !global.Promise) throw TypeError("argument callback is required");
		var o = a.encoding === !0 ? "utf-8" : a.encoding, s = i.parse(a.limit), c = a.length != null && !isNaN(a.length) ? parseInt(a.length, 10) : null;
		return r ? f(e, o, c, s, m(r)) : new Promise(function(t, n) {
			f(e, o, c, s, function(e, r) {
				if (e) return n(e);
				t(r);
			});
		});
	}
	function d(e) {
		s(e), typeof e.pause == "function" && e.pause();
	}
	function f(e, t, n, r, i) {
		var o = !1, s = !0;
		if (r !== null && n !== null && n > r) return m(a(413, "request entity too large", {
			expected: n,
			length: n,
			limit: r,
			type: "entity.too.large"
		}));
		var c = e._readableState;
		if (e._decoder || c && (c.encoding || c.decoder)) return m(a(500, "stream encoding should not be set", { type: "stream.encoding.set" }));
		if (e.readable !== void 0 && !e.readable) return m(a(500, "stream is not readable", { type: "stream.not.readable" }));
		var u = 0, f;
		try {
			f = l(t);
		} catch (e) {
			return m(e);
		}
		var p = f ? "" : [];
		e.on("aborted", h), e.on("close", v), e.on("data", g), e.on("end", _), e.on("error", _), s = !1;
		function m() {
			for (var t = Array(arguments.length), n = 0; n < t.length; n++) t[n] = arguments[n];
			o = !0, s ? process.nextTick(r) : r();
			function r() {
				v(), t[0] && d(e), i.apply(null, t);
			}
		}
		function h() {
			o || m(a(400, "request aborted", {
				code: "ECONNABORTED",
				expected: n,
				length: n,
				received: u,
				type: "request.aborted"
			}));
		}
		function g(e) {
			o || (u += e.length, r !== null && u > r ? m(a(413, "request entity too large", {
				limit: r,
				received: u,
				type: "entity.too.large"
			})) : f ? p += f.write(e) : p.push(e));
		}
		function _(e) {
			if (!o) {
				if (e) return m(e);
				n !== null && u !== n ? m(a(400, "request size did not match content length", {
					expected: n,
					length: n,
					received: u,
					type: "request.size.invalid"
				})) : m(null, f ? p + (f.end() || "") : Buffer.concat(p));
			}
		}
		function v() {
			p = null, e.removeListener("aborted", h), e.removeListener("data", g), e.removeListener("end", _), e.removeListener("error", _), e.removeListener("close", v);
		}
	}
	function p() {
		try {
			return t("async_hooks");
		} catch {
			return {};
		}
	}
	function m(e) {
		var t;
		return r.AsyncResource && (t = new r.AsyncResource(e.name || "bound-anonymous-fn")), !t || !t.runInAsyncScope ? e : t.runInAsyncScope.bind(t, e, null);
	}
})), Wm = /* @__PURE__ */ a(((e) => {
	var t = /; *([!#$%&'*+.^_`|~0-9A-Za-z-]+) *= *("(?:[\u000b\u0020\u0021\u0023-\u005b\u005d-\u007e\u0080-\u00ff]|\\[\u000b\u0020-\u00ff])*"|[!#$%&'*+.^_`|~0-9A-Za-z-]+) */g, n = /\\([\u000b\u0020-\u00ff])/g, r = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
	e.parse = i;
	function i(e) {
		if (!e) throw TypeError("argument string is required");
		var i = typeof e == "object" ? a(e) : e;
		if (typeof i != "string") throw TypeError("argument string is required to be a string");
		var s = i.indexOf(";"), c = s === -1 ? i.trim() : i.slice(0, s).trim();
		if (!r.test(c)) throw TypeError("invalid media type");
		var l = new o(c.toLowerCase());
		if (s !== -1) {
			var u, d, f;
			for (t.lastIndex = s; d = t.exec(i);) {
				if (d.index !== s) throw TypeError("invalid parameter format");
				s += d[0].length, u = d[1].toLowerCase(), f = d[2], f.charCodeAt(0) === 34 && (f = f.slice(1, -1), f.indexOf("\\") !== -1 && (f = f.replace(n, "$1"))), l.parameters[u] = f;
			}
			if (s !== i.length) throw TypeError("invalid parameter format");
		}
		return l;
	}
	function a(e) {
		var t;
		if (typeof e.getHeader == "function" ? t = e.getHeader("content-type") : typeof e.headers == "object" && (t = e.headers && e.headers["content-type"]), typeof t != "string") throw TypeError("content-type header is missing from object");
		return t;
	}
	function o(e) {
		this.parameters = Object.create(null), this.type = e;
	}
})), Gm = /* @__PURE__ */ r(Um(), 1), Km = /* @__PURE__ */ r(Wm(), 1), qm = "4mb", Jm = class {
	constructor(e, t, n) {
		this._endpoint = e, this.res = t, this._sessionId = re(), this._options = n || { enableDnsRebindingProtection: !1 };
	}
	validateRequestHeaders(e) {
		if (this._options.enableDnsRebindingProtection) {
			if (this._options.allowedHosts && this._options.allowedHosts.length > 0) {
				let t = e.headers.host;
				if (!t || !this._options.allowedHosts.includes(t)) return `Invalid Host header: ${t}`;
			}
			if (this._options.allowedOrigins && this._options.allowedOrigins.length > 0) {
				let t = e.headers.origin;
				if (t && !this._options.allowedOrigins.includes(t)) return `Invalid Origin header: ${t}`;
			}
		}
	}
	async start() {
		if (this._sseResponse) throw Error("SSEServerTransport already started! If using Server class, note that connect() calls start() automatically.");
		this.res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive"
		});
		let e = new m(this._endpoint, "http://localhost");
		e.searchParams.set("sessionId", this._sessionId);
		let t = e.pathname + e.search + e.hash;
		this.res.write(`event: endpoint\ndata: ${t}\n\n`), this._sseResponse = this.res, this.res.on("close", () => {
			this._sseResponse = void 0, this.onclose?.();
		});
	}
	async handlePostMessage(e, t, n) {
		if (!this._sseResponse) {
			let e = "SSE connection not established";
			throw t.writeHead(500).end(e), Error(e);
		}
		let r = this.validateRequestHeaders(e);
		if (r) {
			t.writeHead(403).end(r), this.onerror?.(Error(r));
			return;
		}
		let i = e.auth, a = e.headers.host, o = e.socket instanceof ie ? "https" : "http", s = a && e.url ? new m(e.url, `${o}://${a}`) : void 0, c = {
			headers: e.headers,
			url: s
		}, l;
		try {
			let t = Km.parse(e.headers["content-type"] ?? "");
			if (t.type !== "application/json") throw Error(`Unsupported content-type: ${t.type}`);
			l = n ?? await (0, Gm.default)(e, {
				limit: qm,
				encoding: t.parameters.charset ?? "utf-8"
			});
		} catch (e) {
			t.writeHead(400).end(String(e)), this.onerror?.(e);
			return;
		}
		try {
			await this.handleMessage(typeof l == "string" ? JSON.parse(l) : l, {
				requestInfo: c,
				authInfo: i
			});
		} catch {
			t.writeHead(400).end(`Invalid message: ${l}`);
			return;
		}
		t.writeHead(202).end("Accepted");
	}
	async handleMessage(e, t) {
		let n;
		try {
			n = bc.parse(e);
		} catch (e) {
			throw this.onerror?.(e), e;
		}
		this.onmessage?.(n, t);
	}
	async close() {
		this._sseResponse?.end(), this._sseResponse = void 0, this.onclose?.();
	}
	async send(e) {
		if (!this._sseResponse) throw Error("Not connected");
		this._sseResponse.write(`event: message\ndata: ${JSON.stringify(e)}\n\n`);
	}
	get sessionId() {
		return this._sessionId;
	}
}, Ym = new class {
	activeProcesses = /* @__PURE__ */ new Map();
	broadcastLog(e, t) {
		for (let n of o.getAllWindows()) n.isDestroyed() || n.webContents.send("process:logChunk", {
			processId: e,
			text: t
		});
	}
	broadcastStatus(e) {
		for (let t of o.getAllWindows()) t.isDestroyed() || t.webContents.send("process:statusChanged", e);
	}
	async startProcess(e, t, n) {
		let r = `${p.normalize(e)}::${n}`;
		if (this.activeProcesses.has(r)) {
			let e = this.activeProcesses.get(r);
			if (e.info.status === "running") return e.info;
		}
		let i = process.platform === "win32", a = y(i ? "powershell.exe" : "/bin/sh", i ? [
			"-NoProfile",
			"-Command",
			t
		] : ["-c", t], {
			cwd: e,
			env: {
				...process.env,
				FORCE_COLOR: "1"
			}
		}), o = {
			id: r,
			name: n,
			command: t,
			cwd: e,
			pid: a.pid,
			startedAt: (/* @__PURE__ */ new Date()).toISOString(),
			status: "running",
			source: "hub"
		}, s = {
			info: o,
			child: a,
			logBuffer: []
		};
		this.activeProcesses.set(r, s);
		let c = (e) => {
			let t = e.toString();
			s.logBuffer.push(t), s.logBuffer.length > 2e3 && s.logBuffer.shift(), this.broadcastLog(r, t);
		};
		return a.stdout.on("data", c), a.stderr.on("data", c), a.on("close", (e) => {
			o.status = e === 0 ? "stopped" : "failed", o.exitCode = e ?? void 0, this.broadcastStatus(o), this.broadcastLog(r, `\r\n[Process exited with code ${e}]\r\n`);
		}), a.on("error", (e) => {
			o.status = "failed", this.broadcastStatus(o), this.broadcastLog(r, `\r\n[Process error: ${e.message}]\r\n`);
		}), this.broadcastStatus(o), o;
	}
	async stopProcess(e) {
		let t = this.activeProcesses.get(e);
		return t ? !t.info.pid || new Promise((n) => {
			ae(t.info.pid, "SIGKILL", (r) => {
				r ? (console.error(`Failed to kill process tree for ${e}:`, r), n(!1)) : (t.info.status = "stopped", this.broadcastStatus(t.info), n(!0));
			});
		}) : !1;
	}
	getLogs(e) {
		return this.activeProcesses.get(e)?.logBuffer || [];
	}
	async listProcessesForProject(e) {
		let t = p.normalize(e), n = [];
		for (let [e, r] of this.activeProcesses.entries()) p.normalize(r.info.cwd) === t && n.push(r.info);
		let r = p.join(t, ".env-state", "processes.json");
		if (_(r)) try {
			let e = await g.readFile(r, "utf-8"), i = JSON.parse(e);
			for (let [e, r] of Object.entries(i)) {
				let i = `${t}::${e}`;
				if (!this.activeProcesses.has(i)) {
					let a = !1;
					if (r.pid) try {
						process.kill(r.pid, 0), a = !0;
					} catch {
						a = !1;
					}
					n.push({
						id: i,
						name: e,
						command: r.command || "",
						cwd: r.cwd || t,
						pid: r.pid,
						startedAt: r.startedAt || (/* @__PURE__ */ new Date()).toISOString(),
						status: a ? "running" : "stopped",
						source: "env-tools"
					});
				}
			}
		} catch (t) {
			console.error(`Failed to read env-tools state for ${e}:`, t);
		}
		return n;
	}
	async tailProjectLog(e, t, n = 100) {
		let r = `${p.normalize(e)}::${t}`, i = this.activeProcesses.get(r);
		if (i && i.logBuffer.length > 0) return i.logBuffer.slice(-n).join("");
		let a = p.join(e, ".env-state", "logs", `${t}.log`);
		if (_(a)) try {
			let e = await g.readFile(a, "utf-8");
			return e.charCodeAt(0) === 65279 && (e = e.slice(1)), e.split("\n").slice(-n).join("\n");
		} catch (e) {
			console.error(`Failed to tail log ${a}:`, e);
		}
		return "";
	}
	cleanupAll() {
		for (let [e, t] of this.activeProcesses.entries()) if (t.info.pid && t.info.status === "running") try {
			ae(t.info.pid, "SIGKILL");
		} catch (t) {
			console.error(`Cleanup kill failed for ${e}:`, t);
		}
	}
}(), Xm = new class {
	server = null;
	mcpServer = null;
	sseSessions = /* @__PURE__ */ new Map();
	port = 42042;
	token;
	currentAppState = {
		activeProject: null,
		activeTab: "kanban"
	};
	constructor() {
		this.token = `ph_mcp_${ne.randomBytes(12).toString("hex")}`;
	}
	setAppState(e) {
		e.activeProject !== void 0 && (this.currentAppState.activeProject = e.activeProject), e.activeTab !== void 0 && (this.currentAppState.activeTab = e.activeTab);
	}
	getStatus() {
		return {
			isRunning: !!(this.server && this.server.listening),
			port: this.port,
			activeSessions: this.sseSessions.size,
			token: this.token,
			url: `http://127.0.0.1:${this.port}/sse`
		};
	}
	regenerateToken() {
		return this.token = `ph_mcp_${ne.randomBytes(12).toString("hex")}`, this.token;
	}
	dispatchToRenderer(e) {
		for (let t of o.getAllWindows()) t.isDestroyed() || t.webContents.send("mcp:remoteAction", e);
	}
	async start(e = 42042) {
		return this.server && this.server.listening ? !0 : (this.port = e, this.initMcpServer(), new Promise((e) => {
			let t = te.createServer((e, t) => {
				this.handleHttpRequest(e, t);
			});
			t.listen(this.port, "127.0.0.1", () => {
				console.log(`[MCPServer] ProjectHub Remote MCP Server running at http://127.0.0.1:${this.port}/sse`), this.server = t, e(!0);
			}), t.on("error", (n) => {
				n.code === "EADDRINUSE" ? (console.warn(`[MCPServer] Port ${this.port} is in use, trying ${this.port + 1}...`), this.port++, t.listen(this.port, "127.0.0.1")) : (console.error("[MCPServer] Failed to start HTTP server:", n), e(!1));
			});
		}));
	}
	async stop() {
		if (!this.server) return;
		for (let [e, t] of this.sseSessions.entries()) try {
			await t.close();
		} catch {}
		this.sseSessions.clear();
		let e = this.server;
		if (this.server = null, typeof e.closeAllConnections == "function") try {
			e.closeAllConnections();
		} catch {}
		return new Promise((t) => {
			let n = setTimeout(() => {
				t();
			}, 500);
			e.close(() => {
				clearTimeout(n), console.log("[MCPServer] Remote MCP Server stopped"), t();
			});
		});
	}
	initMcpServer() {
		let e = new Pp({
			name: "projecthub-remote-control",
			version: "2.5.0"
		});
		e.registerTool("projecthub_get_app_state", {
			title: "Текущее состояние ProjectHub GUI",
			description: "Возвращает текущее состояние приложения: открытый проект, экранную вкладку и статус.",
			inputSchema: {}
		}, async () => ({ content: [{
			type: "text",
			text: JSON.stringify({
				activeProject: this.currentAppState.activeProject,
				activeTab: this.currentAppState.activeTab,
				mcpServer: this.getStatus()
			}, null, 2)
		}] })), e.registerTool("projecthub_list_projects", {
			title: "Список проектов в ProjectHub",
			description: "Возвращает реестр всех добавленных проектов с метаданными и путями на диске.",
			inputSchema: {}
		}, async () => {
			let e = await le.getConfig();
			return { content: [{
				type: "text",
				text: JSON.stringify(e.projects, null, 2)
			}] };
		}), e.registerTool("projecthub_switch_project", {
			title: "Переключить проект в окне ProjectHub",
			description: "Выбирает проект и открывает его в графическом интерфейсе приложения.",
			inputSchema: { projectPath: Xt().describe("Абсолютный путь к каталогу проекта или его имя") }
		}, async ({ projectPath: e }) => (this.dispatchToRenderer({
			type: "switch_project",
			payload: { query: e }
		}), { content: [{
			type: "text",
			text: `Команда переключения проекта на "${e}" успешно передана в интерфейс ProjectHub.`
		}] })), e.registerTool("projecthub_switch_tab", {
			title: "Переключить вкладку в ProjectHub",
			description: "Переключает видимую вкладку в приложении (ai, kanban, git, docs, terminal).",
			inputSchema: { tab: en([
				"ai",
				"kanban",
				"git",
				"docs",
				"terminal",
				"analytics"
			]).describe("Название вкладки") }
		}, async ({ tab: e }) => (this.dispatchToRenderer({
			type: "switch_tab",
			payload: { tab: e }
		}), { content: [{
			type: "text",
			text: `Вкладка приложения переключена на "${e}".`
		}] })), e.registerTool("projecthub_send_studio_prompt", {
			title: "Отправить промпт в Claude AI Studio",
			description: "Вставляет или отправляет задачу AI-агенту в Claude Studio открытого проекта.",
			inputSchema: {
				prompt: Xt().describe("Текст задачи/промпта для агента"),
				sendImmediately: Qt().optional().describe("Отправить сразу (true) или только вставить в поле ввода (false)")
			}
		}, async ({ prompt: e, sendImmediately: t = !0 }) => (this.dispatchToRenderer({
			type: "send_studio_prompt",
			payload: {
				prompt: e,
				sendImmediately: t
			}
		}), { content: [{
			type: "text",
			text: `Промпт успешно передан в Claude AI Studio (${t ? "отправлен" : "вставлен"}).`
		}] })), e.registerTool("projecthub_approve_action", {
			title: "Одобрить или отклонить действие агента",
			description: "Отвечает на активный запрос подтверждения (Human-in-the-Loop) в карточке одобрений.",
			inputSchema: {
				requestId: Xt().optional().describe("ID запроса (если опущен, берется первый активный)"),
				approved: Qt().describe("Одобрить (true) или отклонить (false)"),
				reason: Xt().optional().describe("Опциональное текстовое пояснение или выбранный вариант")
			}
		}, async ({ requestId: e, approved: t, reason: n }) => (this.dispatchToRenderer({
			type: "approve_action",
			payload: {
				requestId: e,
				approved: t,
				reason: n
			}
		}), { content: [{
			type: "text",
			text: `Решение "${t ? "Одобрено" : "Отклонено"}" отправлено агенту.`
		}] })), e.registerTool("projecthub_run_process", {
			title: "Запустить фоновый процесс",
			description: "Запускает команду (dev-сервер, тесты, сборку) с отслеживанием в Process Manager.",
			inputSchema: {
				projectPath: Xt().describe("Абсолютный путь к каталогу проекта"),
				command: Xt().describe("Строка запускаемой команды"),
				name: Xt().describe("Уникальное имя процесса (например, \"dev\", \"test\")")
			}
		}, async ({ projectPath: e, command: t, name: n }) => {
			let r = await Ym.startProcess(e, t, n);
			return { content: [{
				type: "text",
				text: JSON.stringify(r, null, 2)
			}] };
		}), e.registerTool("projecthub_stop_process", {
			title: "Остановить фоновый процесс",
			description: "Останавливает процесс по его ID или имени.",
			inputSchema: { processId: Xt().describe("ID процесса вида path::name") }
		}, async ({ processId: e }) => ({ content: [{
			type: "text",
			text: await Ym.stopProcess(e) ? `Процесс ${e} остановлен.` : `Процесс ${e} не найден.`
		}] })), e.registerTool("projecthub_get_process_logs", {
			title: "Получить логи процесса",
			description: "Возвращает буфер последних строк вывода процесса.",
			inputSchema: {
				processId: Xt().describe("ID процесса вида path::name"),
				lines: Zt().optional().describe("Количество последних строк (по умолчанию 50)")
			}
		}, async ({ processId: e, lines: t = 50 }) => ({ content: [{
			type: "text",
			text: Ym.getLogs(e).slice(-t).join("") || "Нет вывода"
		}] })), e.registerTool("projecthub_list_tasks", {
			title: "Список задач бэклога",
			description: "Возвращает список задач из папки backlog/tasks/ проекта.",
			inputSchema: {
				projectPath: Xt().describe("Путь к проекту"),
				status: Xt().optional().describe("Фильтр по статусу (To Do, In Progress, Review, Done)")
			}
		}, async ({ projectPath: e, status: t }) => {
			let n = p.join(e, "backlog", "tasks"), r = [];
			if (_(n)) {
				let e = await g.readdir(n);
				for (let i of e) if (i.endsWith(".md")) try {
					let e = await g.readFile(p.join(n, i), "utf-8"), a = b(e);
					(!t || a.data.status?.toLowerCase() === t.toLowerCase()) && r.push({
						file: i,
						id: a.data.id || i.split(" - ")[0],
						title: a.data.title,
						status: a.data.status,
						priority: a.data.priority,
						labels: a.data.labels
					});
				} catch {}
			}
			return { content: [{
				type: "text",
				text: JSON.stringify(r, null, 2)
			}] };
		}), this.mcpServer = e;
	}
	handleHttpRequest(e, t) {
		let n = e.headers.origin || "*";
		if (t.setHeader("Access-Control-Allow-Origin", n), t.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"), t.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization"), e.method === "OPTIONS") {
			t.writeHead(204).end();
			return;
		}
		let r = e.headers.host || `127.0.0.1:${this.port}`, i = new URL(e.url || "/", `http://${r}`), a = i.pathname;
		if (a === "/api/status" && e.method === "GET") {
			t.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }), t.end(JSON.stringify(this.getStatus(), null, 2));
			return;
		}
		if (a === "/api/action" && e.method === "POST") {
			let n = "";
			e.on("data", (e) => n += e), e.on("end", () => {
				try {
					let e = JSON.parse(n);
					this.dispatchToRenderer(e), t.writeHead(200, { "Content-Type": "application/json" }), t.end(JSON.stringify({ ok: !0 }));
				} catch (e) {
					t.writeHead(400, { "Content-Type": "application/json" }), t.end(JSON.stringify({ error: e.message }));
				}
			});
			return;
		}
		if (a === "/mcp.json" && e.method === "GET") {
			let e = { mcpServers: { projecthub: {
				url: `http://127.0.0.1:${this.port}/sse`,
				transport: "sse",
				headers: { Authorization: `Bearer ${this.token}` }
			} } };
			t.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }), t.end(JSON.stringify(e, null, 2));
			return;
		}
		if (a === "/sse" && e.method === "GET") {
			if (!this.mcpServer) {
				t.writeHead(500).end("MCP Server not initialized");
				return;
			}
			console.log("[MCPServer] New client connected to SSE stream");
			let e = new Jm("/message", t), n = e.sessionId;
			this.sseSessions.set(n, e), e.onclose = () => {
				console.log(`[MCPServer] SSE Session ${n} closed`), this.sseSessions.delete(n);
			}, this.mcpServer.connect(e).catch((e) => {
				console.error("[MCPServer] Error connecting transport to MCP server:", e);
			}), e.start().catch((e) => {
				console.error("[MCPServer] Error starting transport:", e);
			});
			return;
		}
		if (a === "/message" && e.method === "POST") {
			let n = i.searchParams.get("sessionId");
			if (!n) {
				t.writeHead(400).end("Missing sessionId query param");
				return;
			}
			let r = this.sseSessions.get(n);
			if (!r) {
				t.writeHead(404).end(`Session ${n} not found`);
				return;
			}
			r.handlePostMessage(e, t).catch((e) => {
				console.error("[MCPServer] Error handling POST message:", e), t.headersSent || t.writeHead(500).end(e.message);
			});
			return;
		}
		t.writeHead(404).end("Not found");
	}
}(), Zm = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.loadNativeModule = e.assign = void 0;
	function n(e) {
		return [...arguments].slice(1).forEach(function(t) {
			return Object.keys(t).forEach(function(n) {
				return e[n] = t[n];
			});
		}), e;
	}
	e.assign = n;
	function r(e) {
		for (var n = [
			"build/Release",
			"build/Debug",
			"prebuilds/" + process.platform + "-" + process.arch
		], r = ["..", "."], i, a = 0, o = n; a < o.length; a++) for (var s = o[a], c = 0, l = r; c < l.length; c++) {
			var u = l[c] + "/" + s + "/";
			try {
				return {
					dir: u,
					module: t(u + "/" + e + ".node")
				};
			} catch (e) {
				i = e;
			}
		}
		throw Error("Failed to load native module: " + e + ".node, checked: " + n.join(", ") + ": " + i);
	}
	e.loadNativeModule = r;
})), Qm = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.EventEmitter2 = void 0, e.EventEmitter2 = function() {
		function e() {
			this._listeners = [];
		}
		return Object.defineProperty(e.prototype, "event", {
			get: function() {
				var e = this;
				return this._event ||= function(t) {
					return e._listeners.push(t), { dispose: function() {
						for (var n = 0; n < e._listeners.length; n++) if (e._listeners[n] === t) {
							e._listeners.splice(n, 1);
							return;
						}
					} };
				}, this._event;
			},
			enumerable: !1,
			configurable: !0
		}), e.prototype.fire = function(e) {
			for (var t = [], n = 0; n < this._listeners.length; n++) t.push(this._listeners[n]);
			for (var n = 0; n < t.length; n++) t[n].call(void 0, e);
		}, e;
	}();
})), $m = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.Terminal = e.DEFAULT_ROWS = e.DEFAULT_COLS = void 0;
	var n = t("events"), r = Qm();
	e.DEFAULT_COLS = 80, e.DEFAULT_ROWS = 24;
	var i = "", a = "";
	e.Terminal = function() {
		function e(e) {
			this._pid = 0, this._fd = 0, this._cols = 0, this._rows = 0, this._readable = !1, this._writable = !1, this._onData = new r.EventEmitter2(), this._onExit = new r.EventEmitter2(), this._internalee = new n.EventEmitter(), this.handleFlowControl = !!e?.handleFlowControl, this._flowControlPause = e?.flowControlPause || i, this._flowControlResume = e?.flowControlResume || a, e && (this._checkType("name", e.name ? e.name : void 0, "string"), this._checkType("cols", e.cols ? e.cols : void 0, "number"), this._checkType("rows", e.rows ? e.rows : void 0, "number"), this._checkType("cwd", e.cwd ? e.cwd : void 0, "string"), this._checkType("env", e.env ? e.env : void 0, "object"), this._checkType("uid", e.uid ? e.uid : void 0, "number"), this._checkType("gid", e.gid ? e.gid : void 0, "number"), this._checkType("encoding", e.encoding ? e.encoding : void 0, "string"));
		}
		return Object.defineProperty(e.prototype, "onData", {
			get: function() {
				return this._onData.event;
			},
			enumerable: !1,
			configurable: !0
		}), Object.defineProperty(e.prototype, "onExit", {
			get: function() {
				return this._onExit.event;
			},
			enumerable: !1,
			configurable: !0
		}), Object.defineProperty(e.prototype, "pid", {
			get: function() {
				return this._pid;
			},
			enumerable: !1,
			configurable: !0
		}), Object.defineProperty(e.prototype, "cols", {
			get: function() {
				return this._cols;
			},
			enumerable: !1,
			configurable: !0
		}), Object.defineProperty(e.prototype, "rows", {
			get: function() {
				return this._rows;
			},
			enumerable: !1,
			configurable: !0
		}), e.prototype.write = function(e) {
			if (this.handleFlowControl) {
				if (e === this._flowControlPause) {
					this.pause();
					return;
				}
				if (e === this._flowControlResume) {
					this.resume();
					return;
				}
			}
			this._write(e);
		}, e.prototype._forwardEvents = function() {
			var e = this;
			this.on("data", function(t) {
				return e._onData.fire(t);
			}), this.on("exit", function(t, n) {
				return e._onExit.fire({
					exitCode: t,
					signal: n
				});
			});
		}, e.prototype._checkType = function(e, t, n, r) {
			if (r === void 0 && (r = !1), t !== void 0) {
				if (r && Array.isArray(t)) {
					t.forEach(function(t, r) {
						if (typeof t !== n) throw Error(e + "[" + r + "] must be a " + n + " (not a " + typeof t[r] + ")");
					});
					return;
				}
				if (typeof t !== n) throw Error(e + " must be a " + n + " (not a " + typeof t + ")");
			}
		}, e.prototype.end = function(e) {
			this._socket.end(e);
		}, e.prototype.pipe = function(e, t) {
			return this._socket.pipe(e, t);
		}, e.prototype.pause = function() {
			return this._socket.pause();
		}, e.prototype.resume = function() {
			return this._socket.resume();
		}, e.prototype.setEncoding = function(e) {
			this._socket._decoder && delete this._socket._decoder, e && this._socket.setEncoding(e);
		}, e.prototype.addListener = function(e, t) {
			this.on(e, t);
		}, e.prototype.on = function(e, t) {
			if (e === "close") {
				this._internalee.on("close", t);
				return;
			}
			this._socket.on(e, t);
		}, e.prototype.emit = function(e) {
			return e === "close" ? this._internalee.emit.apply(this._internalee, arguments) : this._socket.emit.apply(this._socket, arguments);
		}, e.prototype.listeners = function(e) {
			return this._socket.listeners(e);
		}, e.prototype.removeListener = function(e, t) {
			this._socket.removeListener(e, t);
		}, e.prototype.removeAllListeners = function(e) {
			this._socket.removeAllListeners(e);
		}, e.prototype.once = function(e, t) {
			this._socket.once(e, t);
		}, e.prototype._close = function() {
			this._socket.readable = !1, this.write = function() {}, this.end = function() {}, this._writable = !1, this._readable = !1;
		}, e.prototype._parseEnv = function(e) {
			for (var t = Object.keys(e || {}), n = [], r = 0; r < t.length; r++) t[r] !== void 0 && n.push(t[r] + "=" + e[t[r]]);
			return n;
		}, e;
	}();
})), eh = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.getWorkerPipeName = void 0;
	function t(e) {
		return e + "-worker";
	}
	e.getWorkerPipeName = t;
})), th = /* @__PURE__ */ a(((e) => {
	var n = e && e.__awaiter || function(e, t, n, r) {
		function i(e) {
			return e instanceof n ? e : new n(function(t) {
				t(e);
			});
		}
		return new (n ||= Promise)(function(n, a) {
			function o(e) {
				try {
					c(r.next(e));
				} catch (e) {
					a(e);
				}
			}
			function s(e) {
				try {
					c(r.throw(e));
				} catch (e) {
					a(e);
				}
			}
			function c(e) {
				e.done ? n(e.value) : i(e.value).then(o, s);
			}
			c((r = r.apply(e, t || [])).next());
		});
	}, r = e && e.__generator || function(e, t) {
		var n = {
			label: 0,
			sent: function() {
				if (a[0] & 1) throw a[1];
				return a[1];
			},
			trys: [],
			ops: []
		}, r, i, a, o;
		return o = {
			next: s(0),
			throw: s(1),
			return: s(2)
		}, typeof Symbol == "function" && (o[Symbol.iterator] = function() {
			return this;
		}), o;
		function s(e) {
			return function(t) {
				return c([e, t]);
			};
		}
		function c(o) {
			if (r) throw TypeError("Generator is already executing.");
			for (; n;) try {
				if (r = 1, i && (a = o[0] & 2 ? i.return : o[0] ? i.throw || ((a = i.return) && a.call(i), 0) : i.next) && !(a = a.call(i, o[1])).done) return a;
				switch (i = 0, a && (o = [o[0] & 2, a.value]), o[0]) {
					case 0:
					case 1:
						a = o;
						break;
					case 4: return n.label++, {
						value: o[1],
						done: !1
					};
					case 5:
						n.label++, i = o[1], o = [0];
						continue;
					case 7:
						o = n.ops.pop(), n.trys.pop();
						continue;
					default:
						if (a = n.trys, !(a = a.length > 0 && a[a.length - 1]) && (o[0] === 6 || o[0] === 2)) {
							n = 0;
							continue;
						}
						if (o[0] === 3 && (!a || o[1] > a[0] && o[1] < a[3])) {
							n.label = o[1];
							break;
						}
						if (o[0] === 6 && n.label < a[1]) {
							n.label = a[1], a = o;
							break;
						}
						if (a && n.label < a[2]) {
							n.label = a[2], n.ops.push(o);
							break;
						}
						a[2] && n.ops.pop(), n.trys.pop();
						continue;
				}
				o = t.call(e, n);
			} catch (e) {
				o = [6, e], i = 0;
			} finally {
				r = a = 0;
			}
			if (o[0] & 5) throw o[1];
			return {
				value: o[0] ? o[1] : void 0,
				done: !0
			};
		}
	};
	Object.defineProperty(e, "__esModule", { value: !0 }), e.ConoutConnection = void 0;
	var i = t("worker_threads"), a = eh(), o = t("path"), s = Qm(), c = 1e3;
	e.ConoutConnection = function() {
		function e(e, t) {
			var n = this;
			this._conoutPipeName = e, this._useConptyDll = t, this._isDisposed = !1, this._onReady = new s.EventEmitter2();
			var r = { conoutPipeName: e }, a = __dirname.replace("node_modules.asar", "node_modules.asar.unpacked");
			this._worker = new i.Worker(o.join(a, "worker/conoutSocketWorker.js"), { workerData: r }), this._worker.on("message", function(e) {
				switch (e) {
					case 1:
						n._onReady.fire();
						return;
					default: console.warn("Unexpected ConoutWorkerMessage", e);
				}
			});
		}
		return Object.defineProperty(e.prototype, "onReady", {
			get: function() {
				return this._onReady.event;
			},
			enumerable: !1,
			configurable: !0
		}), e.prototype.dispose = function() {
			!this._useConptyDll && this._isDisposed || (this._isDisposed = !0, this._drainDataAndClose());
		}, e.prototype.connectSocket = function(e) {
			e.connect(a.getWorkerPipeName(this._conoutPipeName));
		}, e.prototype._drainDataAndClose = function() {
			var e = this;
			this._drainTimeout && clearTimeout(this._drainTimeout), this._drainTimeout = setTimeout(function() {
				return e._destroySocket();
			}, c);
		}, e.prototype._destroySocket = function() {
			return n(this, void 0, void 0, function() {
				return r(this, function(e) {
					switch (e.label) {
						case 0: return [4, this._worker.terminate()];
						case 1: return e.sent(), [2];
					}
				});
			});
		}, e;
	}();
})), nh = /* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.argsToCommandLine = e.WindowsPtyAgent = void 0;
	var n = t("fs"), r = t("os"), i = t("path"), a = t("child_process"), o = t("net"), s = th(), c = Zm(), l, u, d = 1e3;
	e.WindowsPtyAgent = function() {
		function e(e, t, r, a, d, p, m, h, g, _) {
			var v = this;
			g === void 0 && (g = !1), _ === void 0 && (_ = !1), this._useConpty = h, this._useConptyDll = g, this._pid = 0, this._innerPid = 0, (this._useConpty === void 0 || this._useConpty === !0) && (this._useConpty = this._getWindowsBuildNumber() >= 18309), this._useConpty ? l ||= c.loadNativeModule("conpty").module : u ||= c.loadNativeModule("pty").module, this._ptyNative = this._useConpty ? l : u, a = i.resolve(a);
			var y = f(e, t), b;
			this._useConpty ? b = this._ptyNative.startProcess(e, d, p, m, this._generatePipeName(), _, this._useConptyDll) : (b = this._ptyNative.startProcess(e, y, r, a, d, p, m), this._pid = b.pid, this._innerPid = b.innerPid), this._fd = b.fd, this._pty = b.pty, this._outSocket = new o.Socket(), this._outSocket.setEncoding("utf8"), this._conoutSocketWorker = new s.ConoutConnection(b.conout, this._useConptyDll), this._conoutSocketWorker.onReady(function() {
				v._conoutSocketWorker.connectSocket(v._outSocket);
			}), this._outSocket.on("connect", function() {
				v._outSocket.emit("ready_datapipe");
			});
			var x = n.openSync(b.conin, "w");
			if (this._inSocket = new o.Socket({
				fd: x,
				readable: !1,
				writable: !0
			}), this._inSocket.setEncoding("utf8"), this._useConpty) {
				var S = this._ptyNative.connect(this._pty, y, a, r, this._useConptyDll, function(e) {
					return v._$onProcessExit(e);
				});
				this._innerPid = S.pid;
			}
		}
		return Object.defineProperty(e.prototype, "inSocket", {
			get: function() {
				return this._inSocket;
			},
			enumerable: !1,
			configurable: !0
		}), Object.defineProperty(e.prototype, "outSocket", {
			get: function() {
				return this._outSocket;
			},
			enumerable: !1,
			configurable: !0
		}), Object.defineProperty(e.prototype, "fd", {
			get: function() {
				return this._fd;
			},
			enumerable: !1,
			configurable: !0
		}), Object.defineProperty(e.prototype, "innerPid", {
			get: function() {
				return this._innerPid;
			},
			enumerable: !1,
			configurable: !0
		}), Object.defineProperty(e.prototype, "pty", {
			get: function() {
				return this._pty;
			},
			enumerable: !1,
			configurable: !0
		}), e.prototype.resize = function(e, t) {
			if (this._useConpty) {
				if (this._exitCode !== void 0) throw Error("Cannot resize a pty that has already exited");
				this._ptyNative.resize(this._pty, e, t, this._useConptyDll);
				return;
			}
			this._ptyNative.resize(this._pid, e, t);
		}, e.prototype.clear = function() {
			this._useConpty && this._ptyNative.clear(this._pty, this._useConptyDll);
		}, e.prototype.kill = function() {
			var e = this;
			if (this._useConpty) this._useConptyDll ? (this._inSocket.destroy(), this._ptyNative.kill(this._pty, this._useConptyDll), this._outSocket.on("data", function() {
				e._conoutSocketWorker.dispose();
			})) : (this._inSocket.readable = !1, this._outSocket.readable = !1, this._getConsoleProcessList().then(function(e) {
				e.forEach(function(e) {
					try {
						process.kill(e);
					} catch {}
				});
			}), this._ptyNative.kill(this._pty, this._useConptyDll), this._conoutSocketWorker.dispose());
			else {
				var t = this._ptyNative.getProcessList(this._pid);
				this._ptyNative.kill(this._pid, this._innerPid), t.forEach(function(e) {
					try {
						process.kill(e);
					} catch {}
				});
			}
		}, e.prototype._getConsoleProcessList = function() {
			var e = this;
			return new Promise(function(t) {
				var n = a.fork(i.join(__dirname, "conpty_console_list_agent"), [e._innerPid.toString()]);
				n.on("message", function(e) {
					clearTimeout(r), t(e.consoleProcessList);
				});
				var r = setTimeout(function() {
					n.kill(), t([e._innerPid]);
				}, 5e3);
			});
		}, Object.defineProperty(e.prototype, "exitCode", {
			get: function() {
				if (this._useConpty) return this._exitCode;
				var e = this._ptyNative.getExitCode(this._innerPid);
				return e === -1 ? void 0 : e;
			},
			enumerable: !1,
			configurable: !0
		}), e.prototype._getWindowsBuildNumber = function() {
			var e = /(\d+)\.(\d+)\.(\d+)/g.exec(r.release()), t = 0;
			return e && e.length === 4 && (t = parseInt(e[3])), t;
		}, e.prototype._generatePipeName = function() {
			return "conpty-" + Math.random() * 1e7;
		}, e.prototype._$onProcessExit = function(e) {
			var t = this;
			this._exitCode = e, this._useConptyDll || (this._flushDataAndCleanUp(), this._outSocket.on("data", function() {
				return t._flushDataAndCleanUp();
			}));
		}, e.prototype._flushDataAndCleanUp = function() {
			var e = this;
			this._useConptyDll || (this._closeTimeout && clearTimeout(this._closeTimeout), this._closeTimeout = setTimeout(function() {
				return e._cleanUpProcess();
			}, d));
		}, e.prototype._cleanUpProcess = function() {
			this._useConptyDll || (this._inSocket.readable = !1, this._outSocket.readable = !1, this._outSocket.destroy());
		}, e;
	}();
	function f(e, t) {
		if (p(t)) return t.length === 0 ? e : f(e, []) + " " + t;
		var n = [e];
		Array.prototype.push.apply(n, t);
		for (var r = "", i = 0; i < n.length; i++) {
			i > 0 && (r += " ");
			var a = n[i], o = h(a[0] !== "\"", a[a.length - 1] !== "\""), s = a[0] !== "\"" && a[a.length - 1] !== "\"", c = a === "" || (a.indexOf(" ") !== -1 || a.indexOf("	") !== -1) && a.length > 1 && (o || s);
			c && (r += "\"");
			for (var l = 0, u = 0; u < a.length; u++) {
				var d = a[u];
				d === "\\" ? l++ : d === "\"" ? (r += m("\\", l * 2 + 1), r += "\"", l = 0) : (r += m("\\", l), l = 0, r += d);
			}
			c ? (r += m("\\", l * 2), r += "\"") : r += m("\\", l);
		}
		return r;
	}
	e.argsToCommandLine = f;
	function p(e) {
		return typeof e == "string";
	}
	function m(e, t) {
		for (var n = "", r = 0; r < t; r++) n += e;
		return n;
	}
	function h(e, t) {
		return e && !t || !e && t;
	}
})), rh = /* @__PURE__ */ a(((e) => {
	var t = e && e.__extends || (function() {
		var e = function(t, n) {
			return e = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(e, t) {
				e.__proto__ = t;
			} || function(e, t) {
				for (var n in t) t.hasOwnProperty(n) && (e[n] = t[n]);
			}, e(t, n);
		};
		return function(t, n) {
			e(t, n);
			function r() {
				this.constructor = t;
			}
			t.prototype = n === null ? Object.create(n) : (r.prototype = n.prototype, new r());
		};
	})();
	Object.defineProperty(e, "__esModule", { value: !0 }), e.WindowsTerminal = void 0;
	var n = $m(), r = nh(), i = Zm(), a = "cmd.exe", o = "Windows Shell";
	e.WindowsTerminal = function(e) {
		t(s, e);
		function s(t, s, c) {
			var l = e.call(this, c) || this;
			l._checkType("args", s, "string", !0), s ||= [], t ||= a, c ||= {}, c.env = c.env || process.env, c.encoding && console.warn("Setting encoding on Windows is not supported");
			var u = i.assign({}, c.env);
			l._cols = c.cols || n.DEFAULT_COLS, l._rows = c.rows || n.DEFAULT_ROWS;
			var d = c.cwd || process.cwd(), f = c.name || u.TERM || o, p = l._parseEnv(u);
			return l._isReady = !1, l._deferreds = [], l._agent = new r.WindowsPtyAgent(t, s, p, d, l._cols, l._rows, !1, c.useConpty, c.useConptyDll, c.conptyInheritCursor), l._socket = l._agent.outSocket, l._pid = l._agent.innerPid, l._fd = l._agent.fd, l._pty = l._agent.pty, l._socket.on("ready_datapipe", function() {
				l._socket.once("data", function() {
					l._isReady || (l._isReady = !0, l._deferreds.forEach(function(e) {
						e.run();
					}), l._deferreds = []);
				}), l._socket.on("error", function(e) {
					if (l._close(), !(e.code && (~e.code.indexOf("errno 5") || ~e.code.indexOf("EIO"))) && l.listeners("error").length < 2) throw e;
				}), l._socket.on("close", function() {
					l.emit("exit", l._agent.exitCode), l._close();
				});
			}), l._file = t, l._name = f, l._readable = !0, l._writable = !0, l._forwardEvents(), l;
		}
		return s.prototype._write = function(e) {
			this._defer(this._doWrite, e);
		}, s.prototype._doWrite = function(e) {
			this._agent.inSocket.write(e);
		}, s.open = function(e) {
			throw Error("open() not supported on windows, use Fork() instead.");
		}, s.prototype.resize = function(e, t) {
			var n = this;
			if (e <= 0 || t <= 0 || isNaN(e) || isNaN(t) || e === Infinity || t === Infinity) throw Error("resizing must be done using positive cols and rows");
			this._deferNoArgs(function() {
				n._agent.resize(e, t), n._cols = e, n._rows = t;
			});
		}, s.prototype.clear = function() {
			var e = this;
			this._deferNoArgs(function() {
				e._agent.clear();
			});
		}, s.prototype.destroy = function() {
			var e = this;
			this._deferNoArgs(function() {
				e.kill();
			});
		}, s.prototype.kill = function(e) {
			var t = this;
			this._deferNoArgs(function() {
				if (e) throw Error("Signals not supported on windows.");
				t._close(), t._agent.kill();
			});
		}, s.prototype._deferNoArgs = function(e) {
			var t = this;
			if (this._isReady) {
				e.call(this);
				return;
			}
			this._deferreds.push({ run: function() {
				return e.call(t);
			} });
		}, s.prototype._defer = function(e, t) {
			var n = this;
			if (this._isReady) {
				e.call(this, t);
				return;
			}
			this._deferreds.push({ run: function() {
				return e.call(n, t);
			} });
		}, Object.defineProperty(s.prototype, "process", {
			get: function() {
				return this._name;
			},
			enumerable: !1,
			configurable: !0
		}), Object.defineProperty(s.prototype, "master", {
			get: function() {
				throw Error("master is not supported on Windows");
			},
			enumerable: !1,
			configurable: !0
		}), Object.defineProperty(s.prototype, "slave", {
			get: function() {
				throw Error("slave is not supported on Windows");
			},
			enumerable: !1,
			configurable: !0
		}), s;
	}(n.Terminal);
})), ih = /* @__PURE__ */ a(((e) => {
	var n = e && e.__extends || (function() {
		var e = function(t, n) {
			return e = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(e, t) {
				e.__proto__ = t;
			} || function(e, t) {
				for (var n in t) t.hasOwnProperty(n) && (e[n] = t[n]);
			}, e(t, n);
		};
		return function(t, n) {
			e(t, n);
			function r() {
				this.constructor = t;
			}
			t.prototype = n === null ? Object.create(n) : (r.prototype = n.prototype, new r());
		};
	})();
	Object.defineProperty(e, "__esModule", { value: !0 }), e.UnixTerminal = void 0;
	var r = t("fs"), i = t("path"), a = t("tty"), o = $m(), s = Zm(), c = s.loadNativeModule("pty"), l = c.module, u = c.dir + "/spawn-helper";
	u = i.resolve(__dirname, u), u = u.replace("app.asar", "app.asar.unpacked"), u = u.replace("node_modules.asar", "node_modules.asar.unpacked");
	var d = "sh", f = "xterm", p = 200;
	e.UnixTerminal = function(e) {
		n(t, e);
		function t(t, n, r) {
			var i = e.call(this, r) || this;
			if (i._boundClose = !1, i._emittedClose = !1, typeof n == "string") throw Error("args as a string is not supported on unix.");
			n ||= [], t ||= d, r ||= {}, r.env = r.env || process.env, i._cols = r.cols || o.DEFAULT_COLS, i._rows = r.rows || o.DEFAULT_ROWS;
			var c = r.uid ?? -1, h = r.gid ?? -1, g = s.assign({}, r.env);
			r.env === process.env && i._sanitizeEnv(g);
			var _ = r.cwd || process.cwd();
			g.PWD = _;
			var v = r.name || g.TERM || f;
			g.TERM = v;
			var y = i._parseEnv(g), b = r.encoding === void 0 ? "utf8" : r.encoding, x = l.fork(t, n, y, _, i._cols, i._rows, c, h, b === "utf8", u, function(e, t) {
				if (!i._emittedClose) {
					if (i._boundClose) return;
					i._boundClose = !0;
					var n = setTimeout(function() {
						n = null, i._socket.destroy();
					}, p);
					i.once("close", function() {
						n !== null && clearTimeout(n), i.emit("exit", e, t);
					});
					return;
				}
				i.emit("exit", e, t);
			});
			return i._socket = new a.ReadStream(x.fd), b !== null && i._socket.setEncoding(b), i._writeStream = new m(x.fd, b || void 0), i._socket.on("error", function(e) {
				if (!(e.code && ~e.code.indexOf("EAGAIN")) && (i._close(), i._emittedClose || (i._emittedClose = !0, i.emit("close")), !(e.code && (~e.code.indexOf("errno 5") || ~e.code.indexOf("EIO"))) && i.listeners("error").length < 2)) throw e;
			}), i._pid = x.pid, i._fd = x.fd, i._pty = x.pty, i._file = t, i._name = v, i._readable = !0, i._writable = !0, i._socket.on("close", function() {
				i._emittedClose || (i._emittedClose = !0, i._close(), i.emit("close"));
			}), i._forwardEvents(), i;
		}
		return Object.defineProperty(t.prototype, "master", {
			get: function() {
				return this._master;
			},
			enumerable: !1,
			configurable: !0
		}), Object.defineProperty(t.prototype, "slave", {
			get: function() {
				return this._slave;
			},
			enumerable: !1,
			configurable: !0
		}), t.prototype._write = function(e) {
			this._writeStream.write(e);
		}, Object.defineProperty(t.prototype, "fd", {
			get: function() {
				return this._fd;
			},
			enumerable: !1,
			configurable: !0
		}), Object.defineProperty(t.prototype, "ptsName", {
			get: function() {
				return this._pty;
			},
			enumerable: !1,
			configurable: !0
		}), t.open = function(e) {
			var n = Object.create(t.prototype);
			e ||= {}, arguments.length > 1 && (e = {
				cols: arguments[1],
				rows: arguments[2]
			});
			var r = e.cols || o.DEFAULT_COLS, i = e.rows || o.DEFAULT_ROWS, s = e.encoding === void 0 ? "utf8" : e.encoding, c = l.open(r, i);
			return n._master = new a.ReadStream(c.master), s !== null && n._master.setEncoding(s), n._master.resume(), n._slave = new a.ReadStream(c.slave), s !== null && n._slave.setEncoding(s), n._slave.resume(), n._socket = n._master, n._pid = -1, n._fd = c.master, n._pty = c.pty, n._file = process.argv[0] || "node", n._name = process.env.TERM || "", n._readable = !0, n._writable = !0, n._socket.on("error", function(e) {
				if (n._close(), n.listeners("error").length < 2) throw e;
			}), n._socket.on("close", function() {
				n._close();
			}), n;
		}, t.prototype.destroy = function() {
			var e = this;
			this._close(), this._socket.once("close", function() {
				e.kill("SIGHUP");
			}), this._socket.destroy(), this._writeStream.dispose();
		}, t.prototype.kill = function(e) {
			try {
				process.kill(this.pid, e || "SIGHUP");
			} catch {}
		}, Object.defineProperty(t.prototype, "process", {
			get: function() {
				if (process.platform === "darwin") {
					var e = l.process(this._fd);
					return e === "kernel_task" ? this._file : e;
				}
				return l.process(this._fd, this._pty) || this._file;
			},
			enumerable: !1,
			configurable: !0
		}), t.prototype.resize = function(e, t) {
			if (e <= 0 || t <= 0 || isNaN(e) || isNaN(t) || e === Infinity || t === Infinity) throw Error("resizing must be done using positive cols and rows");
			l.resize(this._fd, e, t), this._cols = e, this._rows = t;
		}, t.prototype.clear = function() {}, t.prototype._sanitizeEnv = function(e) {
			delete e.TMUX, delete e.TMUX_PANE, delete e.STY, delete e.WINDOW, delete e.WINDOWID, delete e.TERMCAP, delete e.COLUMNS, delete e.LINES;
		}, t;
	}(o.Terminal);
	var m = function() {
		function e(e, t) {
			this._fd = e, this._encoding = t, this._writeQueue = [];
		}
		return e.prototype.dispose = function() {
			clearImmediate(this._writeImmediate), this._writeImmediate = void 0;
		}, e.prototype.write = function(e) {
			var t = typeof e == "string" ? Buffer.from(e, this._encoding) : Buffer.from(e);
			t.byteLength !== 0 && (this._writeQueue.push({
				buffer: t,
				offset: 0
			}), this._writeQueue.length === 1 && this._processWriteQueue());
		}, e.prototype._processWriteQueue = function() {
			var e = this;
			if (this._writeImmediate = void 0, this._writeQueue.length !== 0) {
				var t = this._writeQueue[0];
				r.write(this._fd, t.buffer, t.offset, function(n, r) {
					if (n) {
						"code" in n && n.code === "EAGAIN" ? e._writeImmediate = setImmediate(function() {
							return e._processWriteQueue();
						}) : (e._writeQueue.length = 0, console.error("Unhandled pty write error", n));
						return;
					}
					t.offset += r, t.offset >= t.buffer.byteLength && e._writeQueue.shift(), e._processWriteQueue();
				});
			}
		}, e;
	}();
})), ah = /* @__PURE__ */ r((/* @__PURE__ */ a(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.native = e.open = e.createTerminal = e.fork = e.spawn = void 0;
	var t = Zm(), n = process.platform === "win32" ? rh().WindowsTerminal : ih().UnixTerminal;
	function r(e, t, r) {
		return new n(e, t, r);
	}
	e.spawn = r;
	function i(e, t, r) {
		return new n(e, t, r);
	}
	e.fork = i;
	function a(e, t, r) {
		return new n(e, t, r);
	}
	e.createTerminal = a;
	function o(e) {
		return n.open(e);
	}
	e.open = o, e.native = process.platform === "win32" ? null : t.loadNativeModule("pty").module;
})))(), 1), oh = new class {
	sessions = /* @__PURE__ */ new Map();
	broadcastData(e, t) {
		for (let n of o.getAllWindows()) n.isDestroyed() || n.webContents.send("pty:data", {
			sessionId: e,
			data: t
		});
	}
	broadcastExit(e, t) {
		for (let n of o.getAllWindows()) n.isDestroyed() || n.webContents.send("pty:exit", {
			sessionId: e,
			exitCode: t
		});
	}
	async createSession(e) {
		let t = e.sessionId || `pty-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`, n = process.platform === "win32", r = e.cols || 100, i = e.rows || 30, a = "", o = [];
		e.type === "claude" ? n ? (a = process.env.COMSPEC || "cmd.exe", o = ["/c", "claude"]) : (a = process.env.SHELL || "/bin/bash", o = [
			"-l",
			"-c",
			"claude"
		]) : n ? (a = "powershell.exe", o = ["-NoLogo"]) : (a = process.env.SHELL || "/bin/bash", o = ["-l"]);
		let s = e.projectName || p.basename(e.projectPath), c = e.title || (e.type === "claude" ? `Claude: ${s}` : `Terminal: ${s}`), l = {
			...process.env,
			TERM: "xterm-256color",
			COLORTERM: "truecolor",
			CLAUDE_CONFIG_DIR: _e
		}, u = _(e.projectPath) ? e.projectPath : process.cwd(), d = ah.spawn(a, o, {
			name: "xterm-256color",
			cols: r,
			rows: i,
			cwd: u,
			env: l
		}), f = {
			id: t,
			projectPath: e.projectPath,
			projectName: s,
			type: e.type,
			title: c,
			createdAt: Date.now(),
			status: "running"
		};
		return d.onData((e) => {
			this.broadcastData(t, e);
		}), d.onExit(({ exitCode: e }) => {
			let n = this.sessions.get(t);
			n && (n.info.status = "exited", n.info.exitCode = e), this.broadcastExit(t, e);
		}), this.sessions.set(t, {
			info: f,
			ptyProcess: d
		}), f;
	}
	write(e, t) {
		let n = this.sessions.get(e);
		if (!n || n.info.status !== "running") return !1;
		try {
			return n.ptyProcess.write(t), !0;
		} catch (t) {
			return console.error(`[PtyService] Error writing to session ${e}:`, t), !1;
		}
	}
	resize(e, t, n) {
		let r = this.sessions.get(e);
		if (!r || r.info.status !== "running") return !1;
		try {
			return r.ptyProcess.resize(Math.max(10, t), Math.max(5, n)), !0;
		} catch (t) {
			return console.error(`[PtyService] Error resizing session ${e}:`, t), !1;
		}
	}
	kill(e) {
		let t = this.sessions.get(e);
		if (!t) return !1;
		try {
			return t.ptyProcess.kill(), this.sessions.delete(e), !0;
		} catch (t) {
			return console.error(`[PtyService] Error killing session ${e}:`, t), this.sessions.delete(e), !1;
		}
	}
	listSessions() {
		return Array.from(this.sessions.values()).map((e) => e.info);
	}
	cleanupAll() {
		for (let [e, t] of this.sessions.entries()) try {
			t.ptyProcess.kill();
		} catch {}
		this.sessions.clear();
	}
}(), sh = new class {
	watchers = /* @__PURE__ */ new Map();
	debounceTimers = /* @__PURE__ */ new Map();
	broadcastGitChanged(e) {
		let t = this.debounceTimers.get(e);
		t && clearTimeout(t);
		let n = setTimeout(() => {
			this.debounceTimers.delete(e);
			for (let t of o.getAllWindows()) t.isDestroyed() || t.webContents.send("git:changed", { projectPath: e });
		}, 400);
		this.debounceTimers.set(e, n);
	}
	watchProjectGit(e) {
		let t = p.normalize(e);
		if (this.watchers.has(t)) return;
		let n = p.join(t, ".git");
		if (!_(n)) return;
		let r = [
			p.join(n, "HEAD"),
			p.join(n, "index"),
			p.join(n, "refs"),
			t
		], i = oe.watch(r, {
			ignoreInitial: !0,
			ignored: (e) => {
				let t = e.replace(/\\/g, "/");
				return t.includes("/.git/") ? !t.includes("/.git/HEAD") && !t.includes("/.git/index") && !t.includes("/.git/refs") : t.includes("/node_modules") || t.includes("/dist") || t.includes("/dist-electron") || t.includes("/release") || t.includes("/.rag-index") || t.includes("/.venv") || t.includes("/.tmp") || t.includes("/.cache");
			},
			persistent: !0,
			depth: 3
		});
		i.on("all", () => {
			this.broadcastGitChanged(t);
		}), this.watchers.set(t, i);
	}
	unwatchProjectGit(e) {
		let t = p.normalize(e), n = this.watchers.get(t);
		n && (n.close().catch(() => {}), this.watchers.delete(t));
		let r = this.debounceTimers.get(t);
		r && (clearTimeout(r), this.debounceTimers.delete(t));
	}
	cleanupAll() {
		for (let e of this.watchers.values()) try {
			e.close().catch(() => {});
		} catch {}
		this.watchers.clear();
		for (let e of this.debounceTimers.values()) clearTimeout(e);
		this.debounceTimers.clear();
	}
	async getRepoDetails(e) {
		let t = p.join(e, ".git");
		if (!_(t)) return null;
		try {
			let t = x(e);
			this.watchProjectGit(e);
			let [n, r, i, a, o] = await Promise.all([
				t.status(),
				t.branchLocal(),
				t.log({ maxCount: 50 }),
				t.tags(),
				t.stashList()
			]), s = await t.branch(["-a"]), c = r.all, l = s.all.filter((e) => e.startsWith("remotes/")), u = [
				...n.created.map((e) => ({
					path: e,
					index: "A",
					working_dir: " ",
					staged: !0
				})),
				...n.modified.map((e) => ({
					path: e,
					index: "M",
					working_dir: "M",
					staged: n.staged.includes(e)
				})),
				...n.deleted.map((e) => ({
					path: e,
					index: "D",
					working_dir: "D",
					staged: n.staged.includes(e)
				})),
				...n.not_added.map((e) => ({
					path: e,
					index: "?",
					working_dir: "?",
					staged: !1
				})),
				...n.renamed.map((e) => ({
					path: e.to,
					index: "R",
					working_dir: " ",
					staged: !0
				}))
			], d = /* @__PURE__ */ new Map();
			for (let e of u) d.set(e.path, e);
			let f = i.all.map((e) => ({
				hash: e.hash,
				date: e.date,
				message: e.message,
				author_name: e.author_name,
				author_email: e.author_email
			}));
			return {
				currentBranch: n.current || "HEAD",
				branches: c,
				remoteBranches: l,
				commits: f,
				files: Array.from(d.values()),
				stashes: o.all.map((e) => e.message),
				tags: a.all,
				isClean: n.isClean()
			};
		} catch (t) {
			return console.error(`Failed to get git details for ${e}:`, t), null;
		}
	}
	async checkoutBranch(e, t, n = !1) {
		try {
			let r = x(e);
			return n ? await r.checkoutLocalBranch(t) : await r.checkout(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to checkout ${t}:`, e), !1;
		}
	}
	async createBranch(e, t) {
		try {
			return await x(e).checkoutLocalBranch(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to create branch ${t}:`, e), !1;
		}
	}
	async stageFile(e, t) {
		try {
			return await x(e).add(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to stage ${t}:`, e), !1;
		}
	}
	async unstageFile(e, t) {
		try {
			return await x(e).reset(["HEAD", t]), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to unstage ${t}:`, e), !1;
		}
	}
	async stageAll(e) {
		try {
			return await x(e).add("."), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error("Failed to stage all:", e), !1;
		}
	}
	async commitChanges(e, t, n = !1) {
		try {
			let r = x(e);
			return n && await r.add("."), await r.commit(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error("Failed to commit:", e), !1;
		}
	}
	async deleteBranch(e, t, n = !1) {
		try {
			return await x(e).deleteLocalBranch(t, n), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to delete branch ${t}:`, e), !1;
		}
	}
	async mergeBranch(e, t) {
		try {
			return await x(e).merge([t]), this.broadcastGitChanged(e), { success: !0 };
		} catch (e) {
			return console.error(`Failed to merge ${t}:`, e), {
				success: !1,
				error: e?.message || String(e)
			};
		}
	}
	async fetchRemote(e) {
		try {
			return await x(e).fetch(), this.broadcastGitChanged(e), !0;
		} catch (t) {
			return console.error(`Failed to fetch remotes for ${e}:`, t), !1;
		}
	}
	async pullRemote(e) {
		try {
			return await x(e).pull(), this.broadcastGitChanged(e), { success: !0 };
		} catch (t) {
			return console.error(`Failed to pull for ${e}:`, t), {
				success: !1,
				error: t?.message || String(t)
			};
		}
	}
	async pushRemote(e) {
		try {
			return await x(e).push(), this.broadcastGitChanged(e), { success: !0 };
		} catch (t) {
			return console.error(`Failed to push for ${e}:`, t), {
				success: !1,
				error: t?.message || String(t)
			};
		}
	}
	async discardFileChanges(e, t) {
		try {
			let n = x(e);
			try {
				await n.reset(["HEAD", t]);
			} catch {}
			try {
				await n.checkout(["--", t]);
			} catch {
				let n = p.join(e, t);
				_(n) && await g.rm(n, {
					force: !0,
					recursive: !0
				});
			}
			return this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to discard changes for ${t}:`, e), !1;
		}
	}
	async getDiffBetween(e, t, n, r) {
		try {
			let i = x(e), a = [];
			return n ? a.push(`${t}..${n}`) : a.push(t), r && a.push("--", r), await i.diff(a);
		} catch (e) {
			return console.error(`Failed to get diff between ${t} and ${n}:`, e), "";
		}
	}
	async getFileDiff(e, t, n = !1) {
		try {
			let r = x(e);
			return n ? await r.diff(["--cached", t]) : await r.diff([t]);
		} catch (e) {
			return console.error(`Failed to get diff for ${t}:`, e), "";
		}
	}
}(), ch = new class {
	watcher = null;
	currentPath = null;
	debounceTimer = null;
	watch(e, t) {
		if (this.currentPath === e && this.watcher) return;
		this.unwatch();
		let n = p.join(e, "backlog", "tasks");
		if (!_(n)) return;
		this.currentPath = e, this.watcher = oe.watch(n, {
			ignoreInitial: !0,
			depth: 1,
			awaitWriteFinish: {
				stabilityThreshold: 150,
				pollInterval: 50
			}
		});
		let r = (n, r) => {
			!t || t.isDestroyed() || (this.debounceTimer && clearTimeout(this.debounceTimer), this.debounceTimer = setTimeout(() => {
				!t || t.isDestroyed() || t.webContents.send("backlog:tasksChanged", {
					projectPath: e,
					event: n,
					filePath: r
				});
			}, 100));
		};
		this.watcher.on("add", (e) => r("add", e)), this.watcher.on("change", (e) => r("change", e)), this.watcher.on("unlink", (e) => r("unlink", e));
	}
	unwatch() {
		this.watcher &&= (this.watcher.close(), null), this.currentPath = null;
	}
}(), lh = "F:\\ProjectTemplate", uh = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	".rag-index",
	".rag-cache",
	".env-state",
	".lightrag-index",
	".claude/scheduled_tasks.lock",
	".claude/worktrees",
	"dist",
	"dist-electron",
	"build"
]);
async function dh(e, t) {
	await g.mkdir(t, { recursive: !0 });
	let n = await g.readdir(e, { withFileTypes: !0 });
	for (let r of n) {
		let n = p.join(e, r.name), i = p.join(t, r.name), a = r.name.toLowerCase();
		uh.has(a) || (r.isDirectory() ? await dh(n, i) : r.isFile() && await g.copyFile(n, i));
	}
}
async function fh(e) {
	let t = e || lh;
	return {
		available: _(t),
		path: t
	};
}
async function ph(e) {
	let t = e.templateSource || lh;
	if (!_(t)) throw Error(`Директория шаблона не найдена: ${t}`);
	let n = p.normalize(e.targetDir);
	if (_(n)) {
		if ((await g.readdir(n)).length > 0) throw Error(`Целевая директория уже существует и не пуста: ${n}`);
	} else await g.mkdir(n, { recursive: !0 });
	await dh(t, n);
	let r = p.join(n, "package.json");
	if (_(r)) try {
		let t = await g.readFile(r, "utf-8"), n = JSON.parse(t);
		n.name = e.name.toLowerCase().replace(/[^a-z0-9-_]/g, "-"), n.version = "0.1.0", n.description = `Проект ${e.name} на базе ProjectTemplate`, await g.writeFile(r, JSON.stringify(n, null, 2), "utf-8");
	} catch (e) {
		console.error("Failed to parametrize package.json:", e);
	}
	let i = p.join(n, "infra.config.json");
	if (_(i)) try {
		let t = await g.readFile(i, "utf-8"), n = JSON.parse(t);
		n.projectRoot = ".", n.features = {
			...n.features,
			...e.features
		}, await g.writeFile(i, JSON.stringify(n, null, 2), "utf-8");
	} catch (e) {
		console.error("Failed to parametrize infra.config.json:", e);
	}
	let a = p.join(n, "backlog", "config.yml");
	if (_(a)) try {
		let t = await g.readFile(a, "utf-8");
		t = t.replace(/project_name:\s*["']?([^"'\r\n]+)["']?/, `project_name: "${e.name}"`), await g.writeFile(a, t, "utf-8");
	} catch (e) {
		console.error("Failed to parametrize backlog/config.yml:", e);
	}
	if (e.initGit) try {
		await x(n).init();
	} catch (e) {
		console.error("Failed to init git:", e);
	}
	let o = p.join(n, "scripts", "setup.mjs");
	if (_(o)) try {
		await new Promise((e) => {
			let t = y(process.execPath, [o], {
				cwd: n,
				shell: !0
			});
			t.on("close", () => e()), t.on("error", () => e());
		});
	} catch (e) {
		console.error("Setup script execution warning:", e);
	}
	await le.addProject(n, !0);
	let s = await de(n);
	if (!s) throw Error("Не удалось проинспектировать созданный проект.");
	return s;
}
//#endregion
//#region electron/services/actionConfigService.ts
var mh = ".projecthub.json", hh = new class {
	detectDefaultCommands(e) {
		let t = _(p.join(e, "package.json")), n = _(p.join(e, "Cargo.toml")), r = _(p.join(e, "pyproject.toml")) || _(p.join(e, "requirements.txt"));
		return n ? {
			run: {
				name: "Cargo Run",
				command: "cargo run"
			},
			deploy: {
				name: "Release Build",
				command: "cargo build --release",
				requiresConfirmation: !0
			},
			test: {
				name: "Cargo Test",
				command: "cargo test"
			},
			customActions: []
		} : r ? {
			run: {
				name: "Python Server",
				command: "python main.py",
				autoOpenUrl: "http://localhost:8000"
			},
			deploy: {
				name: "Deploy App",
				command: "docker compose up -d --build",
				requiresConfirmation: !0
			},
			test: {
				name: "Pytest",
				command: "pytest"
			},
			customActions: []
		} : {
			run: {
				name: "Dev Server",
				command: t ? "npm run dev" : "npm start",
				autoOpenUrl: "http://localhost:5173"
			},
			deploy: {
				name: "Production Deploy",
				command: t ? "npm run build && npm run deploy" : "npm run build",
				requiresConfirmation: !0
			},
			test: {
				name: "Unit Tests",
				command: "npm test"
			},
			customActions: []
		};
	}
	async getConfig(e) {
		let t = p.join(e, mh);
		if (_(t)) try {
			let n = await g.readFile(t, "utf-8"), r = JSON.parse(n);
			return {
				...this.detectDefaultCommands(e),
				...r
			};
		} catch (e) {
			console.error(`Failed to parse ${t}:`, e);
		}
		return this.detectDefaultCommands(e);
	}
	async saveConfig(e, t) {
		let n = p.join(e, mh);
		try {
			return await g.writeFile(n, JSON.stringify(t, null, 2), "utf-8"), !0;
		} catch (e) {
			return console.error(`Failed to save ${n}:`, e), !1;
		}
	}
}(), gh = "Xenova/all-MiniLM-L6-v2", _h = null, vh = null, yh = null;
async function bh() {
	if (!vh) try {
		vh = await import("@lancedb/lancedb");
	} catch (e) {
		return console.warn("[RAG] LanceDB native module not available, fallback to fulltext search:", e), null;
	}
	return vh;
}
async function xh() {
	if (!yh) try {
		yh = await import("./transformers.node-COFdxZ8y.js"), yh.env && (yh.env.cacheDir = p.join(process.cwd(), ".rag-cache"));
	} catch (e) {
		return console.warn("[RAG] Transformers not available:", e), null;
	}
	return yh;
}
async function Sh() {
	if (!_h) {
		let e = await xh();
		if (!e) return null;
		_h = e.pipeline("feature-extraction", gh, { dtype: "fp32" });
	}
	return _h;
}
async function Ch(e) {
	try {
		let t = await Sh();
		if (!t) return null;
		let n = await t(e, {
			pooling: "mean",
			normalize: !0
		}), r = n.dims[n.dims.length - 1], i = n.data, a = [];
		for (let t = 0; t < e.length; t++) a.push(Array.from(i.slice(t * r, (t + 1) * r)));
		return a;
	} catch (e) {
		return console.warn("[RAG] Embedding failed:", e), null;
	}
}
async function wh(e) {
	let t = [], n = [
		{
			dir: p.join(e, "backlog", "docs"),
			category: "doc"
		},
		{
			dir: p.join(e, "backlog", "decisions"),
			category: "decision"
		},
		{
			dir: p.join(e, "backlog", "tasks"),
			category: "task"
		}
	];
	for (let { dir: r, category: i } of n) if (_(r)) try {
		let n = await g.readdir(r);
		for (let a of n) if (a.endsWith(".md")) {
			let n = p.join(r, a);
			t.push({
				filePath: n,
				relative: p.relative(e, n),
				category: i
			});
		}
	} catch (e) {
		console.error(`Failed to scan dir ${r}:`, e);
	}
	let r = p.join(e, "README.md");
	return _(r) && t.push({
		filePath: r,
		relative: "README.md",
		category: "doc"
	}), t;
}
async function Th(e) {
	let t = e.query?.trim();
	if (!t) return [];
	let n = e.mode || "all", r = e.limit || 15, i = e.global ?? !1, a = [];
	a = i || !e.projectPath ? (await le.getProjects()).map((e) => ({
		name: p.basename(e.path),
		path: e.path
	})) : [{
		name: p.basename(e.projectPath),
		path: e.projectPath
	}];
	let o = [];
	for (let e of a) {
		let i = e.path;
		if (n === "vector" || n === "all") {
			let n = p.join(i, ".rag-index");
			if (_(n)) try {
				let a = await bh();
				if (a) {
					let s = await a.connect(n), c = await s.tableNames(), l = c.includes("docs") ? "docs" : c[0];
					if (l) {
						let n = await s.openTable(l), a = await Ch([t]);
						if (a && a[0]) {
							let t = await n.search(a[0]).limit(r).toArray();
							for (let n of t) {
								let t = typeof n._distance == "number" ? n._distance : .5, r = Math.max(0, Math.min(1, 1 - t / 1.5)), a = n.file || "", s = "doc";
								a.includes("decisions") ? s = "decision" : a.includes("tasks") && (s = "task"), o.push({
									projectName: e.name,
									projectPath: i,
									filePath: p.join(i, a),
									fileRelative: a,
									heading: n.heading || void 0,
									snippet: n.text || "",
									score: Math.round(r * 100) / 100,
									type: "vector",
									category: s
								});
							}
						}
					}
				}
			} catch (e) {
				console.error(`Vector search error for ${i}:`, e);
			}
		}
		if (n === "text" || n === "all") try {
			let n = await wh(i), r = t.toLowerCase();
			for (let t of n) {
				let n = await g.readFile(t.filePath, "utf-8"), a = b(n), s = a.data?.title || p.basename(t.filePath, ".md"), c = a.content, l = s.toLowerCase().includes(r), u = c.toLowerCase().indexOf(r);
				if (l || u !== -1) {
					let n = "";
					if (u !== -1) {
						let e = Math.max(0, u - 80), t = Math.min(c.length, u + r.length + 120);
						n = (e > 0 ? "..." : "") + c.slice(e, t).trim() + (t < c.length ? "..." : "");
					} else n = c.slice(0, 160).trim() + (c.length > 160 ? "..." : "");
					o.push({
						projectName: e.name,
						projectPath: i,
						filePath: t.filePath,
						fileRelative: t.relative,
						heading: s,
						snippet: n.replace(/\n+/g, " "),
						score: l ? .95 : .75,
						type: "text",
						category: t.category
					});
				}
			}
		} catch (e) {
			console.error(`Text search error for ${i}:`, e);
		}
	}
	return o.sort((e, t) => t.score - e.score), o.slice(0, r);
}
async function Eh(e) {
	let t = p.join(e, ".rag-index");
	if (!_(t)) return {
		hasIndex: !1,
		chunksCount: 0
	};
	try {
		let e = await bh();
		if (e) {
			let n = await e.connect(t), r = await n.tableNames(), i = r.includes("docs") ? "docs" : r[0];
			if (i) return {
				hasIndex: !0,
				chunksCount: await (await n.openTable(i)).countRows(),
				lastModified: (await g.stat(t)).mtime.toISOString()
			};
		}
	} catch (t) {
		console.error(`Failed to get RAG stats for ${e}:`, t);
	}
	return {
		hasIndex: !1,
		chunksCount: 0
	};
}
//#endregion
//#region electron/services/prService.ts
var Dh = se(v), Oh = new class {
	async runGh(e, t) {
		try {
			let { stdout: n } = await Dh("gh", e, {
				cwd: t,
				env: {
					...process.env,
					GH_PAGER: "cat"
				}
			});
			return n.trim();
		} catch (e) {
			throw Error(e.stderr || e.message || "Ошибка выполнения GitHub CLI");
		}
	}
	async isGhAvailable() {
		try {
			return await Dh("gh", ["--version"]), !0;
		} catch {
			return !1;
		}
	}
	async getProviderInfo(e) {
		try {
			let t = p.join(e, ".git");
			if (!_(t)) return {
				provider: "none",
				hasCli: !1,
				authenticated: !1
			};
			let n = await x(e).getRemotes(!0), r = n.find((e) => e.name === "origin") || n[0];
			if (!r || !r.refs.fetch) return {
				provider: "none",
				hasCli: !1,
				authenticated: !1
			};
			let i = r.refs.fetch, a = i.includes("github.com"), o = i.includes("gitlab.com"), s = "";
			if (a) {
				let e = i.match(/github\.com[:/](.+?)(?:\.git)?$/);
				e && (s = e[1]);
			} else if (o) {
				let e = i.match(/gitlab\.com[:/](.+?)(?:\.git)?$/);
				e && (s = e[1]);
			}
			let c = await this.isGhAvailable(), l = !1;
			if (c && a) try {
				await this.runGh(["auth", "status"], e), l = !0;
			} catch {
				l = !1;
			}
			return {
				provider: a ? "github" : o ? "gitlab" : "none",
				repo: s || void 0,
				remoteUrl: i,
				hasCli: c,
				authenticated: l
			};
		} catch (t) {
			return console.error(`Failed to get PR provider info for ${e}:`, t), {
				provider: "none",
				hasCli: !1,
				authenticated: !1
			};
		}
	}
	async listPullRequests(e, t = "open") {
		try {
			let n = await this.getProviderInfo(e);
			if (n.provider === "github" && n.hasCli) {
				let n = "open";
				t === "all" ? n = "all" : t === "closed" ? n = "closed" : t === "merged" && (n = "merged");
				let r = [
					"number",
					"title",
					"state",
					"url",
					"author",
					"createdAt",
					"updatedAt",
					"headRefName",
					"baseRefName",
					"body",
					"labels",
					"statusCheckRollup",
					"comments"
				].join(","), i = await this.runGh([
					"pr",
					"list",
					"--state",
					n,
					"--json",
					r,
					"--limit",
					"30"
				], e);
				return i ? JSON.parse(i).map((e) => {
					let t = "NONE";
					if (e.statusCheckRollup && e.statusCheckRollup.length > 0) {
						let n = e.statusCheckRollup.some((e) => e.state === "FAILURE" || e.conclusion === "FAILURE"), r = e.statusCheckRollup.some((e) => e.state === "PENDING" || e.status === "IN_PROGRESS");
						t = n ? "FAILURE" : r ? "PENDING" : "SUCCESS";
					}
					let n = "OPEN";
					return e.state === "MERGED" ? n = "MERGED" : e.state === "CLOSED" && (n = "CLOSED"), {
						id: e.number,
						number: e.number,
						title: e.title,
						state: n,
						url: e.url,
						author: e.author?.login || "unknown",
						createdAt: e.createdAt,
						updatedAt: e.updatedAt,
						sourceBranch: e.headRefName || "",
						targetBranch: e.baseRefName || "main",
						body: e.body || "",
						labels: (e.labels || []).map((e) => e.name),
						checksStatus: t,
						provider: "github",
						commentsCount: e.comments?.length || 0
					};
				}) : [];
			}
			return [];
		} catch (t) {
			return console.error(`Failed to list PRs for ${e}:`, t), [];
		}
	}
	async createPullRequest(e, t) {
		try {
			let n = await this.getProviderInfo(e);
			if (n.provider !== "github" || !n.hasCli) throw Error("Для создания Pull Request требуется GitHub репозиторий и установленный GitHub CLI (gh).");
			let r = [
				"pr",
				"create",
				"--title",
				t.title,
				"--body",
				t.body,
				"--head",
				t.sourceBranch
			];
			t.targetBranch && r.push("--base", t.targetBranch), t.draft && r.push("--draft");
			let i = (await this.runGh(r, e)).trim();
			await this.syncBacklogOnPRCreated(e, t.sourceBranch, t.title);
			let a = await this.runGh([
				"pr",
				"view",
				"--json",
				"number,title,state,url,author,createdAt,updatedAt,headRefName,baseRefName,body,labels"
			], e), o = JSON.parse(a);
			return {
				id: o.number,
				number: o.number,
				title: o.title,
				state: "OPEN",
				url: o.url || i,
				author: o.author?.login || "you",
				createdAt: o.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
				updatedAt: o.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
				sourceBranch: o.headRefName || t.sourceBranch,
				targetBranch: o.baseRefName || t.targetBranch || "main",
				body: o.body || t.body,
				labels: (o.labels || []).map((e) => e.name),
				checksStatus: "NONE",
				provider: "github"
			};
		} catch (t) {
			throw console.error(`Failed to create PR in ${e}:`, t), t;
		}
	}
	async getPRDiff(e, t) {
		try {
			return await this.runGh([
				"pr",
				"diff",
				String(t)
			], e);
		} catch (e) {
			return console.error(`Failed to get diff for PR #${t}:`, e), "";
		}
	}
	async syncBacklogOnPRCreated(e, t, n) {
		try {
			let r = p.join(e, "backlog", "tasks");
			if (!_(r)) return;
			let i = (t + " " + n).match(/task-(\d+)/i);
			if (!i) return;
			let a = `task-${i[1]}`.toLowerCase(), o = await g.readdir(r);
			for (let e of o) if (e.toLowerCase().startsWith(a) && e.endsWith(".md")) {
				let t = p.join(r, e), n = await g.readFile(t, "utf-8"), i = b(n);
				if (i.data.status !== "Review" && i.data.status !== "Done") {
					i.data.status = "Review";
					let e = b.stringify(i.content, i.data);
					await g.writeFile(t, e, "utf-8");
				}
				break;
			}
		} catch (e) {
			console.error("Failed to sync Backlog task status on PR creation:", e);
		}
	}
}();
//#endregion
//#region electron/services/docsService.ts
function kh(e) {
	return e.toLowerCase().trim().replace(/[^\w\sа-яё\-]/gi, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
}
async function Ah(e) {
	let t = [], n = p.normalize(e), r = p.join(n, "backlog", "decisions");
	if (_(r)) try {
		let e = await g.readdir(r);
		for (let i of e) if (i.endsWith(".md")) {
			let e = p.join(r, i), a = await g.stat(e), o = await g.readFile(e, "utf-8"), { data: s, content: c } = b(o), l = s.title;
			if (!l) {
				let e = c.match(/^#\s+(.+)$/m);
				l = e ? e[1].trim() : i.replace(/\.md$/, "");
			}
			t.push({
				id: `decision-${i}`,
				title: l,
				category: "decision",
				filePath: e,
				fileRelative: p.relative(n, e).replace(/\\/g, "/"),
				tags: Array.isArray(s.tags) ? s.tags : [],
				status: s.status || "Accepted",
				date: s.date ? String(s.date) : void 0,
				updatedAt: a.mtime.toISOString(),
				size: a.size
			});
		}
	} catch (e) {
		console.error("Error scanning decisions:", e);
	}
	let i = p.join(n, "backlog", "docs");
	if (_(i)) {
		async function e(r) {
			try {
				let i = await g.readdir(r, { withFileTypes: !0 });
				for (let a of i) {
					let i = p.join(r, a.name);
					if (a.isDirectory()) await e(i);
					else if (a.isFile() && a.name.endsWith(".md")) {
						let e = await g.stat(i), r = await g.readFile(i, "utf-8"), { data: o, content: s } = b(r), c = o.title;
						if (!c) {
							let e = s.match(/^#\s+(.+)$/m);
							c = e ? e[1].trim() : a.name.replace(/\.md$/, "");
						}
						t.push({
							id: `doc-${a.name}`,
							title: c,
							category: "doc",
							filePath: i,
							fileRelative: p.relative(n, i).replace(/\\/g, "/"),
							tags: Array.isArray(o.tags) ? o.tags : [],
							status: o.status,
							date: o.date ? String(o.date) : void 0,
							updatedAt: e.mtime.toISOString(),
							size: e.size
						});
					}
				}
			} catch (e) {
				console.error("Error scanning docs:", e);
			}
		}
		await e(i);
	}
	return t.sort((e, t) => e.title.localeCompare(t.title));
}
async function jh(e) {
	let t = p.normalize(e);
	if (!_(t)) throw Error(`Файл не найден: ${t}`);
	return await g.readFile(t, "utf-8");
}
async function Mh(e, t) {
	let n = p.normalize(e), r = p.dirname(n);
	return _(r) || await g.mkdir(r, { recursive: !0 }), await g.writeFile(n, t, "utf-8"), !0;
}
async function Nh(e, t) {
	let n = p.normalize(e), r = t.type || "doc", i = t.title.trim(), a = kh(i), o, s, c = t.content;
	if (r === "decision") {
		o = p.join(n, "backlog", "decisions"), await g.mkdir(o, { recursive: !0 });
		let e = 1;
		try {
			let t = await g.readdir(o);
			for (let n of t) {
				let t = n.match(/^(\d{4})/);
				if (t) {
					let n = parseInt(t[1], 10);
					n >= e && (e = n + 1);
				}
			}
		} catch {}
		let r = String(e).padStart(4, "0");
		if (s = `${r}-${a}.md`, !c) {
			let e = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
			c = `---
title: "${i}"
tags: ${t.tags && t.tags.length > 0 ? JSON.stringify(t.tags) : JSON.stringify([
				"adr",
				"decision",
				a
			])}
status: "${t.status || "Accepted"}"
date: "${e}"
---

# ${r}. ${i}

## Контекст и проблематика
Опишите контекст проблемы, технические ограничения и требования, которые привели к необходимости принятия этого архитектурного решения.

## Рассматриваемые варианты
1. **Вариант 1**: Плюсы и минусы
2. **Вариант 2**: Плюсы и минусы

## Принятое решение
Опишите выбранный подход и обоснование выбора.

## Последствия
### Положительные
- 

### Отрицательные / Риски
- 
`;
		}
	} else if (o = p.join(n, "backlog", "docs"), await g.mkdir(o, { recursive: !0 }), s = `${a}.md`, !c) {
		let e = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
		c = `---
title: "${i}"
tags: ${t.tags && t.tags.length > 0 ? JSON.stringify(t.tags) : JSON.stringify(["documentation", a])}
date: "${e}"
---

# ${i}

## Обзор
Краткое описание назначения и содержания данного документа.

## Основные разделы
### 1. Введение
Описание архитектуры или процесса.

### 2. Спецификация
Детальные спецификации, схемы или примеры использования.
`;
	}
	let l = p.join(o, s);
	await g.writeFile(l, c, "utf-8");
	let u = await g.stat(l);
	return {
		id: `${r}-${s}`,
		title: i,
		category: r,
		filePath: l,
		fileRelative: p.relative(n, l).replace(/\\/g, "/"),
		tags: t.tags || [],
		status: t.status || (r === "decision" ? "Accepted" : void 0),
		date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
		updatedAt: u.mtime.toISOString(),
		size: u.size
	};
}
//#endregion
//#region electron/services/milestoneService.ts
function Ph(e) {
	return e.toLowerCase().trim().replace(/[^\w\sа-яё\-]/gi, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "") || "milestone";
}
async function Fh(e) {
	let t = [], n = p.normalize(e), r = p.join(n, "backlog", "milestones"), i = p.join(n, "backlog", "tasks"), a = /* @__PURE__ */ new Map();
	if (_(i)) try {
		let e = await g.readdir(i);
		for (let t of e) if (t.endsWith(".md")) {
			let e = await g.readFile(p.join(i, t), "utf-8"), n = b(e), r = n.data.milestone || n.data.milestone_id, o = n.data.status || "To Do";
			if (r) {
				let e = String(r).trim().toLowerCase();
				a.has(e) || a.set(e, {
					total: 0,
					done: 0,
					inProgress: 0,
					review: 0,
					todo: 0
				});
				let t = a.get(e);
				t.total++, o === "Done" ? t.done++ : o === "In Progress" ? t.inProgress++ : o === "Review" ? t.review++ : t.todo++;
			}
		}
	} catch (e) {
		console.error("Error scanning tasks for milestones:", e);
	}
	if (_(r)) try {
		let e = await g.readdir(r);
		for (let n of e) if (n.endsWith(".md")) {
			let e = p.join(r, n), i = await g.readFile(e, "utf-8"), { data: o, content: s } = b(i), c = o.id || n.replace(/\.md$/, "").split("-")[0].trim(), l = o.title || n.replace(/\.md$/, ""), u = o.status || "Planning", d = o.target_date || o.targetDate || o.due_date || void 0, f = o.description || s.trim(), m = c.toLowerCase(), h = l.toLowerCase(), _ = a.get(m) || a.get(h) || {
				total: 0,
				done: 0,
				inProgress: 0,
				review: 0,
				todo: 0
			};
			t.push({
				id: c,
				title: l,
				description: f,
				targetDate: d ? String(d) : void 0,
				status: u,
				filePath: e,
				taskCounts: _
			});
		}
	} catch (e) {
		console.error("Error reading milestones directory:", e);
	}
	return t;
}
async function Ih(e, t) {
	let n = p.normalize(e), r = p.join(n, "backlog", "milestones");
	await g.mkdir(r, { recursive: !0 });
	let i = t.title.trim(), a = Ph(i), o = 1;
	try {
		let e = await g.readdir(r);
		for (let t of e) {
			let e = t.match(/milestone-(\d+)/i);
			if (e) {
				let t = parseInt(e[1], 10);
				t >= o && (o = t + 1);
			}
		}
	} catch {}
	let s = `milestone-${o}`, c = `${s} - ${a}.md`, l = p.join(r, c), u = {
		id: s,
		title: i,
		status: t.status || "Planning",
		created_date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
	};
	t.targetDate && (u.target_date = t.targetDate), t.description && (u.description = t.description);
	let d = `\n# ${i}\n\n${t.description || "Описание майлстоуна"}\n`, f = b.stringify(d, u);
	return await g.writeFile(l, f, "utf-8"), {
		id: s,
		title: i,
		description: t.description,
		targetDate: t.targetDate,
		status: t.status || "Planning",
		filePath: l,
		taskCounts: {
			total: 0,
			done: 0,
			inProgress: 0,
			review: 0,
			todo: 0
		}
	};
}
async function Lh(e, t) {
	let n = p.normalize(e);
	if (!_(n)) return !1;
	let r = await g.readFile(n, "utf-8"), i = b(r);
	t.title && (i.data.title = t.title), t.status && (i.data.status = t.status), t.targetDate !== void 0 && (i.data.target_date = t.targetDate), t.description !== void 0 && (i.data.description = t.description);
	let a = b.stringify(i.content, i.data);
	return await g.writeFile(n, a, "utf-8"), !0;
}
async function Rh(e) {
	let t = p.normalize(e);
	return _(t) ? (await g.unlink(t), !0) : !1;
}
var zh = new class {
	cachedUsage = null;
	lastFetchTime = 0;
	CACHE_TTL_MS = 45e3;
	async getUsage(e = !1) {
		let t = Date.now();
		if (!e && this.cachedUsage && t - this.lastFetchTime < this.CACHE_TTL_MS) return this.cachedUsage;
		try {
			let e = await this.fetchUsageFromCli(), n = await this.readStatsCacheFile(), r = this.parseUsageText(e), i = {
				planType: r.planType || "Claude Code Subscription",
				sessionLimit: r.sessionLimit,
				weeklyLimit: r.weeklyLimit,
				last24h: r.last24h,
				last7d: r.last7d,
				totalSessions: n?.totalSessions,
				totalMessages: n?.totalMessages,
				modelUsage: n?.modelUsage,
				dailyActivity: n?.dailyActivity,
				rawText: e,
				updatedAt: t,
				isFallback: !1
			};
			return this.cachedUsage = i, this.lastFetchTime = t, i;
		} catch (e) {
			console.warn("Failed to fetch usage from Claude CLI, falling back to stats-cache.json:", e.message);
			let n = await this.readStatsCacheFile();
			if (n) {
				let e = {
					planType: "Claude Code Subscription",
					totalSessions: n.totalSessions,
					totalMessages: n.totalMessages,
					modelUsage: n.modelUsage,
					dailyActivity: n.dailyActivity,
					rawText: "Данные получены из локального кэша сессий Claude Code (~/.claude/stats-cache.json)",
					updatedAt: t,
					isFallback: !0
				};
				return this.cachedUsage = e, this.lastFetchTime = t, e;
			}
			throw Error(`Не удалось получить usage данные Claude Code: ${e.message}`);
		}
	}
	fetchUsageFromCli() {
		return new Promise((e, t) => {
			let n = y("claude", ["-p", "/usage"], {
				shell: !0,
				stdio: [
					"pipe",
					"pipe",
					"pipe"
				],
				env: {
					...process.env,
					FORCE_COLOR: "0",
					CLAUDE_CONFIG_DIR: _e
				}
			});
			n.stdin.end();
			let r = "", i = "";
			n.stdout.on("data", (e) => {
				r += e.toString("utf-8");
			}), n.stderr.on("data", (e) => {
				i += e.toString("utf-8");
			});
			let a = setTimeout(() => {
				n.kill(), t(/* @__PURE__ */ Error("Превышено время ожидания ответа от claude /usage"));
			}, 12e3);
			n.on("close", (n) => {
				clearTimeout(a), n === 0 || r.trim().length > 0 ? e(r.trim()) : t(Error(i || `claude /usage завершился с кодом ${n}`));
			}), n.on("error", (e) => {
				clearTimeout(a), t(e);
			});
		});
	}
	async readStatsCacheFile() {
		let e = [p.join(S.homedir(), ".claude", "stats-cache.json"), p.join(_e, "stats-cache.json")];
		for (let t of e) if (_(t)) try {
			let e = await g.readFile(t, "utf-8");
			return JSON.parse(e);
		} catch (e) {
			console.warn(`Error reading ${t}:`, e);
		}
		return null;
	}
	parseUsageText(e) {
		let t = "Claude Code Subscription";
		e.includes("subscription") ? t = "Claude Subscription (Max Speed)" : (e.includes("usage credits") || e.includes("credits")) && (t = "Usage Credits (Pay-as-you-go)");
		let n, r = e.match(/Current session:\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^ \n\r]+(?:\s+[^ \n\r]+)*))?/i);
		r && (n = {
			percent: parseInt(r[1], 10),
			resetsAt: r[2]?.trim()
		});
		let i, a = e.match(/Current week(?:\s*\([^\)]+\))?:\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^ \n\r]+(?:\s+[^ \n\r]+)*))?/i);
		a && (i = {
			percent: parseInt(a[1], 10),
			resetsAt: a[2]?.trim()
		});
		let o = (e) => {
			let t = {}, n = e.match(/(\d+)\s+requests/i);
			n && (t.requests = parseInt(n[1], 10));
			let r = e.match(/(\d+)\s+sessions/i);
			r && (t.sessions = parseInt(r[1], 10));
			let i = e.match(/(\d+)%\s+of your usage was at >150k context/i);
			i && (t.contextAbove150kPercent = parseInt(i[1], 10));
			let a = e.match(/(\d+)%\s+of your usage came from subagent-heavy/i);
			a && (t.subagentHeavyPercent = parseInt(a[1], 10));
			let o = e.match(/(\d+)%\s+of your usage came from sessions active for 8\+\s*hours/i);
			o && (t.sessionsOver8hPercent = parseInt(o[1], 10));
			let s = (t) => {
				let n = e.match(t);
				return n ? n[1].split(",").map((e) => {
					let t = e.trim().match(/^(.+?)\s+(\d+)%$/);
					return t ? {
						name: t[1].trim(),
						percent: parseInt(t[2], 10)
					} : null;
				}).filter(Boolean) : [];
			};
			return t.topSkills = s(/Top skills:\s*([^\n\r]+)/i), t.topSubagents = s(/Top subagents:\s*([^\n\r]+)/i), t.topMcpServers = s(/Top MCP servers:\s*([^\n\r]+)/i), t;
		}, s, c, l = e.indexOf("Last 24h"), u = e.indexOf("Last 7d");
		return l !== -1 && (s = o(u === -1 ? e.slice(l) : e.slice(l, u))), u !== -1 && (c = o(e.slice(u))), {
			planType: t,
			sessionLimit: n,
			weeklyLimit: i,
			last24h: s,
			last7d: c
		};
	}
}(), Bh = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	"dist",
	"dist-electron",
	"release",
	".rag-index",
	".venv",
	"venv",
	"__pycache__",
	".next",
	".nuxt",
	".turbo",
	"coverage",
	".idea",
	".vscode"
]), Vh = new class {
	validateSafePath(e, t) {
		let n = p.resolve(e), r = p.resolve(n, t);
		if (!r.startsWith(n)) throw Error(`Access Denied: Path traversal detected outside project root (${t})`);
		return r;
	}
	async readTree(e, t = "", n = 6, r = 0) {
		let i = p.resolve(e), a = p.resolve(i, t);
		if (!a.startsWith(i) || !_(a) || r >= n) return [];
		try {
			let t = await g.readdir(a, { withFileTypes: !0 }), o = [];
			for (let s of t) {
				if (Bh.has(s.name)) continue;
				let t = p.join(a, s.name), c = p.relative(i, t).replace(/\\/g, "/");
				if (s.isDirectory()) {
					let i = await this.readTree(e, c, n, r + 1);
					o.push({
						name: s.name,
						path: t,
						relativePath: c,
						isDirectory: !0,
						children: i
					});
				} else if (s.isFile()) {
					let e = 0;
					try {
						e = (await g.stat(t)).size;
					} catch {}
					o.push({
						name: s.name,
						path: t,
						relativePath: c,
						isDirectory: !1,
						size: e,
						extension: p.extname(s.name).toLowerCase()
					});
				}
			}
			return o.sort((e, t) => e.isDirectory === t.isDirectory ? e.name.localeCompare(t.name, void 0, {
				numeric: !0,
				sensitivity: "base"
			}) : e.isDirectory ? -1 : 1), o;
		} catch (e) {
			return console.error(`Failed to read directory tree for ${a}:`, e), [];
		}
	}
	async readFileContent(e, t) {
		let n = this.validateSafePath(e, t);
		if (!_(n)) throw Error(`File not found: ${t}`);
		return await g.readFile(n, "utf-8");
	}
	async saveFileContent(e, t, n) {
		let r = this.validateSafePath(e, t), i = p.dirname(r);
		return _(i) || await g.mkdir(i, { recursive: !0 }), await g.writeFile(r, n, "utf-8"), !0;
	}
	async createFileOrFolder(e, t, n) {
		let r = this.validateSafePath(e, t);
		if (_(r)) throw Error(`Item already exists: ${t}`);
		if (n) await g.mkdir(r, { recursive: !0 });
		else {
			let e = p.dirname(r);
			_(e) || await g.mkdir(e, { recursive: !0 }), await g.writeFile(r, "", "utf-8");
		}
		return !0;
	}
	async deleteFileOrFolder(e, t) {
		let n = this.validateSafePath(e, t);
		return _(n) && await g.rm(n, {
			recursive: !0,
			force: !0
		}), !0;
	}
}();
//#endregion
//#region electron/main.ts
s.commandLine.appendSwitch("use-fake-ui-for-media-stream");
var Hh = h(import.meta.url), Uh = p.dirname(Hh);
process.env.DIST = p.join(Uh, "../dist"), process.env.VITE_PUBLIC = s.isPackaged ? process.env.DIST : p.join(Uh, "../public");
var Q = null, $ = null, Wh = process.env.VITE_DEV_SERVER_URL;
xe.on("statusChanged", (e) => {
	Q && !Q.isDestroyed() && Q.webContents.send("claudeBridge:statusChanged", e);
}), xe.on("subagentUpdated", (e) => {
	Q && !Q.isDestroyed() && Q.webContents.send("claudeBridge:subagentUpdated", e);
});
function Gh() {
	let e = p.join(Uh, "../dist"), t = p.join(e, "index.html"), n = p.join(Uh, "preload.cjs"), r = p.join(Uh, "preload.js"), i = _(n) ? n : r, a = p.join(Uh, "../public/icon.png"), c = p.join(Uh, "../build/icon.png"), l = _(a) ? a : c;
	Q = new o({
		title: "ProjectHub — Панель управления проектами",
		icon: l,
		width: 1400,
		height: 900,
		minWidth: 1024,
		minHeight: 700,
		backgroundColor: "#0f1117",
		autoHideMenuBar: !0,
		webPreferences: {
			preload: i,
			nodeIntegration: !1,
			contextIsolation: !0,
			sandbox: !1
		}
	}), Q.webContents.on("console-message", (e, t, n, r, i) => {
		console.log(`[Renderer Console: ${t}] ${n} (${i}:${r})`);
	}), Q.webContents.on("before-input-event", (e, t) => {
		(t.key === "F12" || t.control && t.shift && t.key.toLowerCase() === "i") && (Q?.webContents.toggleDevTools(), e.preventDefault());
	}), Q.webContents.on("did-fail-load", (e, t, n, r) => {
		console.error(`[Electron] Failed to load ${r}: [${t}] ${n}`);
	}), Wh ? Q.loadURL(Wh) : Q.loadFile(t), Q.on("close", (e) => {
		Jh || (e.preventDefault(), Yh(), setTimeout(() => {
			s.exit(0), process.exit(0);
		}, 1500).unref());
	}), Q.on("closed", () => {
		if (Q = null, $ && !$.isDestroyed()) {
			try {
				$.destroy();
			} catch {}
			$ = null;
		}
	});
}
function Kh() {
	if ($ && !$.isDestroyed()) return $;
	let e = p.join(Uh, "../dist"), t = p.join(e, "index.html"), n = p.join(Uh, "preload.cjs"), r = p.join(Uh, "preload.js"), i = _(n) ? n : r;
	return $ = new o({
		width: 320,
		height: 54,
		x: 24,
		y: 24,
		frame: !1,
		transparent: !0,
		alwaysOnTop: !0,
		skipTaskbar: !0,
		resizable: !1,
		show: !1,
		focusable: !1,
		hasShadow: !1,
		backgroundColor: "#00000000",
		webPreferences: {
			preload: i,
			nodeIntegration: !1,
			contextIsolation: !0,
			sandbox: !1
		}
	}), $.setAlwaysOnTop(!0, "screen-saver"), Wh ? $.loadURL(`${Wh}#/voice-overlay`) : $.loadFile(t, { hash: "/voice-overlay" }), $.on("closed", () => {
		$ = null;
	}), $;
}
s.on("window-all-closed", () => {
	process.platform !== "darwin" && (s.quit(), Q = null, $ = null);
}), s.on("activate", () => {
	o.getAllWindows().length === 0 && Gh();
}), l.on("voice:overlay-sync", (e, t) => {
	let n = !!(t?.isListening || t?.isPaused);
	n && (!$ || $.isDestroyed()) && Kh(), $ && !$.isDestroyed() && (n ? $.isVisible() || $.showInactive() : $.isVisible() && $.hide(), $.webContents.isLoading() ? $.webContents.once("did-finish-load", () => {
		$?.webContents.send("voice:overlay-update", t);
	}) : $.webContents.send("voice:overlay-update", t));
}), l.on("voice:overlay-action", (e, t) => {
	Q && !Q.isDestroyed() && Q.webContents.send("voice:external-control", t);
}), l.handle("projects:list", async () => {
	let e = await le.getProjects(), t = [];
	for (let n of e) {
		let e = await de(n.path);
		e && (e.favorite = !!n.favorite, e.addedAt = n.addedAt, t.push(e));
	}
	return t;
}), l.handle("projects:scan", async (e, t) => await fe(t?.roots && t.roots.length > 0 ? t.roots : await le.getScanRoots(), t?.depth ?? 2)), l.handle("projects:add", async (e, t) => {
	let n = await de(t);
	return n ? (await le.addProject(n.path, !1), n) : null;
}), l.handle("projects:remove", async (e, t) => await le.removeProject(t)), l.handle("projects:refresh", async (e, t) => await de(t)), l.handle("projects:toggleFavorite", async (e, t) => await le.toggleFavorite(t)), l.handle("projects:setVoiceAlias", async (e, { projectPath: t, alias: n }) => await le.setVoiceAlias(t, n)), l.handle("projects:getScanRoots", async () => await le.getScanRoots()), l.handle("projects:setScanRoots", async (e, t) => await le.setScanRoots(t)), l.handle("projects:getDetails", async (e, t) => await de(t)), l.handle("dialog:selectDirectory", async () => {
	if (!Q) return null;
	let e = await c.showOpenDialog(Q, {
		properties: ["openDirectory"],
		title: "Выберите папку проекта с Backlog.md или репозиторием"
	});
	return e.canceled || e.filePaths.length === 0 ? null : e.filePaths[0];
}), l.handle("system:openInExplorer", async (e, t) => {
	await f.openPath(t);
}), l.handle("system:openInCode", async (e, t) => {
	let n = process.platform === "win32" ? "code.cmd" : "code";
	y(n, [t], {
		shell: !0,
		detached: !0
	});
}), l.handle("system:openTerminal", async (e, t) => {
	process.platform === "win32" ? y("cmd.exe", [
		"/c",
		"start",
		"powershell.exe"
	], {
		cwd: t,
		shell: !0,
		detached: !0
	}) : y("open", [
		"-a",
		"Terminal",
		t
	], { detached: !0 });
}), l.handle("backlog:watchProject", async (e, t) => {
	ch.watch(t, Q);
});
function qh(e) {
	let t = [], n = e.split("\n"), r = !1, i = [], a = !1;
	for (let e of n) {
		let n = e.trim();
		if (n.startsWith("## Acceptance Criteria")) {
			r = !0, a = !1;
			continue;
		}
		if (n.startsWith("## Description")) {
			a = !0, r = !1;
			continue;
		}
		if ((n.startsWith("## ") || n.startsWith("# ")) && (r = !1, a = !1), r) {
			let e = n.match(/^-\s*\[([ xX])\]\s*(.*)$/);
			e && t.push({
				completed: e[1].toLowerCase() === "x",
				text: e[2].trim()
			});
		} else a && i.push(e);
	}
	return {
		criteria: t,
		description: i.join("\n").trim()
	};
}
l.handle("backlog:getTasks", async (e, t) => {
	let n = p.join(t, "backlog", "tasks");
	if (!_(n)) return [];
	ch.watch(t, Q);
	let r = [];
	try {
		let e = await g.readdir(n);
		for (let t of e) if (t.endsWith(".md")) {
			let e = p.join(n, t), i = await g.readFile(e, "utf-8"), a = b(i), { criteria: o, description: s } = qh(a.content);
			r.push({
				id: a.data.id || p.basename(t, ".md").split("-")[0].trim(),
				title: a.data.title || p.basename(t, ".md"),
				status: a.data.status || "To Do",
				labels: a.data.labels || [],
				milestone: a.data.milestone || a.data.milestone_id || void 0,
				created: a.data.created ? String(a.data.created) : void 0,
				filePath: e,
				content: a.content,
				description: s || a.content,
				acceptanceCriteria: o
			});
		}
	} catch (e) {
		console.error(`Error reading tasks from ${n}:`, e);
	}
	return r;
}), l.handle("backlog:updateTaskStatus", async (e, t, n) => {
	try {
		if (!_(t)) return !1;
		let e = await g.readFile(t, "utf-8"), r = b(e);
		r.data.status = n;
		let i = b.stringify(r.content, r.data);
		return await g.writeFile(t, i, "utf-8"), !0;
	} catch (e) {
		return console.error(`Failed to update status for ${t}:`, e), !1;
	}
}), l.handle("backlog:toggleCriterion", async (e, t, n, r) => {
	try {
		if (!_(t)) return !1;
		let e = await g.readFile(t, "utf-8"), i = 0, a = e.split("\n"), o = !1;
		for (let e = 0; e < a.length; e++) {
			let t = a[e].match(/^(\s*-\s*\[)([ xX])(\]\s*.*)$/);
			if (t) {
				if (i === n) {
					a[e] = `${t[1]}${r ? "x" : " "}${t[3]}`, o = !0;
					break;
				}
				i++;
			}
		}
		return o ? (await g.writeFile(t, a.join("\n"), "utf-8"), !0) : !1;
	} catch (e) {
		return console.error(`Failed to toggle criterion in ${t}:`, e), !1;
	}
}), l.handle("backlog:saveFullTask", async (e, t, n) => {
	try {
		if (!_(t)) return !1;
		let e = await g.readFile(t, "utf-8"), r = b(e);
		r.data.title = n.title, r.data.status = n.status, r.data.labels = n.labels, n.milestone ? r.data.milestone = n.milestone : (delete r.data.milestone, delete r.data.milestone_id);
		let i = `\n# ${r.data.id || p.basename(t, ".md").split("-")[0].trim()}: ${n.title}\n\n## Description\n${n.description || "Описание задачи"}\n\n## Acceptance Criteria\n`;
		if (n.criteria && n.criteria.length > 0) for (let e of n.criteria) i += `- [${e.completed ? "x" : " "}] ${e.text}\n`;
		else i += "- [ ] Критерий 1\n";
		let a = b.stringify(i, r.data);
		return await g.writeFile(t, a, "utf-8"), !0;
	} catch (e) {
		return console.error(`Failed to save full task ${t}:`, e), !1;
	}
}), l.handle("backlog:deleteTask", async (e, t) => {
	try {
		return _(t) ? (await g.unlink(t), !0) : !1;
	} catch (e) {
		return console.error(`Failed to delete task ${t}:`, e), !1;
	}
}), l.handle("backlog:saveTask", async (e, t, n) => {
	try {
		return await g.writeFile(t, n, "utf-8"), !0;
	} catch (e) {
		return console.error(`Failed to save task ${t}:`, e), !1;
	}
}), l.handle("backlog:createTask", async (e, t, n) => {
	try {
		let e = p.join(t, "backlog", "tasks");
		_(e) || await g.mkdir(e, { recursive: !0 });
		let r = await g.readdir(e), i = 0;
		for (let e of r) {
			let t = e.match(/task-(\d+)/i);
			if (t) {
				let e = parseInt(t[1], 10);
				e > i && (i = e);
			}
		}
		let a = `task-${i + 1}`, o = `${a} - ${n.title.replace(/[\\/:*?"<>|]/g, "-").trim()}.md`, s = p.join(e, o), c = (/* @__PURE__ */ new Date()).toISOString().split("T")[0], l = {
			id: a,
			title: n.title,
			status: "To Do",
			labels: n.labels || [],
			created: c
		}, u = `\n# ${a}: ${n.title}\n\n## Description\n${n.description || "Описание задачи"}\n\n## Acceptance Criteria\n- [ ] Критерий 1\n`, d = b.stringify(u, l);
		return await g.writeFile(s, d, "utf-8"), {
			id: a,
			title: n.title,
			status: "To Do",
			labels: n.labels || [],
			created: c,
			filePath: s,
			content: u
		};
	} catch (e) {
		return console.error("Failed to create task:", e), null;
	}
}), l.handle("template:createProject", async (e, t) => await ph(t)), l.handle("template:checkAvailable", async (e, t) => await fh(t)), l.handle("process:start", async (e, t, n, r) => await Ym.startProcess(t, n, r)), l.handle("process:stop", async (e, t) => await Ym.stopProcess(t)), l.handle("process:list", async (e, t) => await Ym.listProcessesForProject(t)), l.handle("process:tailLog", async (e, t, n, r = 100) => await Ym.tailProjectLog(t, n, r)), l.handle("actions:getConfig", async (e, t) => await hh.getConfig(t)), l.handle("actions:saveConfig", async (e, t, n) => await hh.saveConfig(t, n)), l.handle("rag:search", async (e, t) => await Th(t)), l.handle("rag:getStats", async (e, t) => await Eh(t)), l.handle("git:getLog", async (e, t, n = 30) => {
	try {
		return _(p.join(t, ".git")) ? (await x(t).log({ maxCount: n })).all.map((e) => ({
			hash: e.hash,
			date: e.date,
			message: e.message,
			author_name: e.author_name,
			author_email: e.author_email
		})) : [];
	} catch (e) {
		return console.error(`Git log error for ${t}:`, e), [];
	}
}), l.handle("git:getStatus", async (e, t) => {
	try {
		return _(p.join(t, ".git")) ? await x(t).status() : null;
	} catch (e) {
		return console.error(`Git status error for ${t}:`, e), null;
	}
}), l.handle("git:getRepoDetails", async (e, t) => await sh.getRepoDetails(t)), l.handle("git:checkout", async (e, t, n, r = !1) => await sh.checkoutBranch(t, n, r)), l.handle("git:createBranch", async (e, t, n) => await sh.createBranch(t, n)), l.handle("git:stageFile", async (e, t, n) => await sh.stageFile(t, n)), l.handle("git:unstageFile", async (e, t, n) => await sh.unstageFile(t, n)), l.handle("git:stageAll", async (e, t) => await sh.stageAll(t)), l.handle("git:commit", async (e, t, n, r = !1) => await sh.commitChanges(t, n, r)), l.handle("git:getFileDiff", async (e, t, n, r = !1) => await sh.getFileDiff(t, n, r)), l.handle("git:deleteBranch", async (e, t, n, r = !1) => await sh.deleteBranch(t, n, r)), l.handle("git:mergeBranch", async (e, t, n) => await sh.mergeBranch(t, n)), l.handle("git:fetchRemote", async (e, t) => await sh.fetchRemote(t)), l.handle("git:pullRemote", async (e, t) => await sh.pullRemote(t)), l.handle("git:pushRemote", async (e, t) => await sh.pushRemote(t)), l.handle("git:discardFileChanges", async (e, t, n) => await sh.discardFileChanges(t, n)), l.handle("git:getDiffBetween", async (e, t, n, r, i) => await sh.getDiffBetween(t, n, r, i)), l.handle("pr:getProviderInfo", async (e, t) => await Oh.getProviderInfo(t)), l.handle("pr:list", async (e, t, n) => await Oh.listPullRequests(t, n)), l.handle("pr:create", async (e, t, n) => await Oh.createPullRequest(t, n)), l.handle("pr:getDiff", async (e, t, n) => await Oh.getPRDiff(t, n)), l.handle("docs:list", async (e, t) => await Ah(t)), l.handle("docs:read", async (e, t) => await jh(t)), l.handle("docs:save", async (e, t, n) => await Mh(t, n)), l.handle("docs:create", async (e, t, n) => await Nh(t, n)), l.handle("milestones:list", async (e, t) => await Fh(t)), l.handle("milestones:create", async (e, t, n) => await Ih(t, n)), l.handle("milestones:save", async (e, t, n) => await Lh(t, n)), l.handle("milestones:delete", async (e, t) => await Rh(t)), l.handle("pty:create", async (e, t) => await oh.createSession(t)), l.handle("pty:write", async (e, t, n) => oh.write(t, n)), l.handle("pty:resize", async (e, t, n, r) => oh.resize(t, n, r)), l.handle("pty:kill", async (e, t) => oh.kill(t)), l.handle("pty:list", async () => oh.listSessions()), l.handle("ai:getConfig", async () => await ye.getConfig()), l.handle("ai:saveConfig", async (e, t) => await ye.saveConfig(t)), l.handle("ai:getClaudeAuthStatus", async () => await ye.getClaudeAuthStatus()), l.handle("ai:startClaudeLogin", async () => {
	try {
		return process.platform === "win32" ? y("cmd.exe", [
			"/c",
			"start",
			"cmd.exe",
			"/k",
			"claude auth login"
		], {
			detached: !0,
			shell: !0,
			env: {
				...process.env,
				CLAUDE_CONFIG_DIR: _e
			}
		}) : y("claude", ["auth", "login"], {
			detached: !0,
			shell: !0,
			env: {
				...process.env,
				CLAUDE_CONFIG_DIR: _e
			}
		}), !0;
	} catch (e) {
		return console.error("Failed to start claude auth login process:", e), f.openExternal("https://claude.ai/login"), !1;
	}
}), l.handle("ai:claudeLogout", async () => await ye.claudeLogout()), l.handle("ai:abortStream", async (e, t) => (ye.abortStream(t), xe.abortSession(t), !0)), l.handle("ai:applyDiff", async (e, t, n, r) => await ye.applyDiff(t, n, r)), l.handle("ai:streamChat", async (e, t) => {
	if (!Q) return;
	let n = Q;
	xe.runAgentTask(t, (e) => {
		n.isDestroyed() || n.webContents.send(`ai:chunk:${t.sessionId}`, e);
	}, (e) => {
		n.isDestroyed() || n.webContents.send(`ai:complete:${t.sessionId}`, e);
	}, (e) => {
		n.isDestroyed() || n.webContents.send(`ai:error:${t.sessionId}`, e);
	});
}), l.handle("claudeBridge:getAllProjectStatuses", async () => xe.getAllProjectStatuses()), l.handle("claudeBridge:getProjectStatus", async (e, t) => xe.getProjectStatus(t)), l.handle("claudeBridge:sendApprovalResponse", async (e, t, n) => xe.sendApprovalResponse(t, n)), l.handle("claudeBridge:getSubagents", async (e, t) => xe.getSubagents(t)), l.handle("claudeBridge:getAvailableModels", async () => xe.getAvailableModels()), l.handle("claudeBridge:getUsage", async (e, t = !1) => await zh.getUsage(t)), l.handle("files:readTree", async (e, t, n = "", r = 6) => await Vh.readTree(t, n, r)), l.handle("files:readContent", async (e, t, n) => await Vh.readFileContent(t, n)), l.handle("files:saveContent", async (e, t, n, r) => await Vh.saveFileContent(t, n, r)), l.handle("files:create", async (e, t, n, r = !1) => await Vh.createFileOrFolder(t, n, r)), l.handle("files:delete", async (e, t, n) => await Vh.deleteFileOrFolder(t, n)), l.handle("file:readFile", async (e, t, n) => await Vh.readFileContent(t, n)), l.handle("file:writeFile", async (e, t, n, r) => await Vh.saveFileContent(t, n, r)), l.handle("file:listFiles", async (e, t, n) => (await Vh.readTree(t, n || "", 1)).map((e) => ({
	name: e.name,
	isDirectory: e.isDirectory,
	relativePath: e.relativePath
}))), l.handle("voice:transcribeLocal", async (e, { audioData: t, language: n }) => await Se.transcribe(t, n)), l.handle("voice:getLocalWhisperStatus", async () => Se.getState()), l.handle("system:getPlatform", async () => process.platform), l.handle("secrets:isEncryptionAvailable", async () => ge.isEncryptionAvailable()), l.handle("secrets:encrypt", async (e, t) => ge.encrypt(t)), l.handle("secrets:decrypt", async (e, t) => ge.decrypt(t)), l.handle("secrets:setSecret", async (e, { key: t, value: n }) => (await ge.setSecret(t, n), !0)), l.handle("secrets:getSecret", async (e, t) => await ge.getSecret(t)), l.handle("secrets:deleteSecret", async (e, t) => await ge.deleteSecret(t)), l.handle("mcp:getStatus", async () => Xm.getStatus()), l.handle("mcp:toggleServer", async (e, t) => (t ? await Xm.start() : await Xm.stop(), Xm.getStatus())), l.handle("mcp:regenerateToken", async () => Xm.regenerateToken()), l.handle("mcp:setAppState", async (e, t) => (Xm.setAppState(t), !0));
var Jh = !1;
async function Yh() {
	if (!Jh) {
		if (Jh = !0, console.log("[Main] Performing graceful shutdown of all processes and resources..."), $ && !$.isDestroyed()) {
			try {
				$.destroy();
			} catch {}
			$ = null;
		}
		try {
			sh.cleanupAll();
		} catch (e) {
			console.warn("[Main] Error cleaning up git watchers:", e);
		}
		try {
			Ym.cleanupAll();
		} catch (e) {
			console.warn("[Main] Error cleaning up processes:", e);
		}
		try {
			oh.cleanupAll();
		} catch (e) {
			console.warn("[Main] Error cleaning up pty:", e);
		}
		try {
			await Se.dispose();
		} catch (e) {
			console.warn("[Main] Error disposing whisper service:", e);
		}
		try {
			await Xm.stop();
		} catch (e) {
			console.warn("[Main] Error stopping MCP server:", e);
		}
		console.log("[Main] Graceful shutdown completed successfully."), s.exit(0), process.exit(0);
	}
}
s.on("before-quit", (e) => {
	Jh || (e.preventDefault(), Yh(), setTimeout(() => {
		console.warn("[Main] Force exiting after 1.5s shutdown timeout."), s.exit(0), process.exit(0);
	}, 1500).unref());
}), s.whenReady().then(() => {
	d.defaultSession.setPermissionRequestHandler((e, t, n) => {
		n(!0);
	}), d.defaultSession.setPermissionCheckHandler((e, t) => !0), Gh(), Se.initBackground(), Xm.start().catch((e) => {
		console.error("[Main] Failed to auto-start Remote MCP server:", e);
	});
});
//#endregion
export {};
