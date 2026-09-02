import { i as e, o as t, t as n } from "./rolldown-runtime-CJfroGDQ.js";
import { BrowserWindow as r, app as i, dialog as a, ipcMain as o, shell as s } from "electron";
import c from "node:path";
import { fileURLToPath as l } from "node:url";
import u from "node:fs/promises";
import { existsSync as d } from "node:fs";
import { execFile as f, spawn as p } from "node:child_process";
import m from "gray-matter";
import { simpleGit as h } from "simple-git";
import g from "node:os";
import { EventEmitter as _ } from "node:events";
import v from "chokidar";
import y from "tree-kill";
import { promisify as b } from "node:util";
//#region electron/services/projectRegistry.ts
var x = {
	version: 1,
	scanRoots: (process.platform === "win32" ? [
		"F:\\",
		"D:\\",
		c.join(g.homedir(), "Projects")
	] : [c.join(g.homedir(), "Projects"), c.join(g.homedir(), "Developer")]).filter((e) => d(e)),
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
}, S = new class {
	configPath;
	cachedConfig = null;
	constructor() {
		let e = g.homedir(), t = c.join(e, ".projecthub");
		this.configPath = c.join(t, "projects.json");
	}
	async ensureConfigFile() {
		try {
			let e = c.dirname(this.configPath);
			return d(e) || await u.mkdir(e, { recursive: !0 }), d(this.configPath) || await u.writeFile(this.configPath, JSON.stringify(x, null, 2), "utf-8"), this.configPath;
		} catch {
			let e = i ? i.getPath("userData") : c.join(g.tmpdir(), ".projecthub");
			return d(e) || await u.mkdir(e, { recursive: !0 }), this.configPath = c.join(e, "projects.json"), d(this.configPath) || await u.writeFile(this.configPath, JSON.stringify(x, null, 2), "utf-8"), this.configPath;
		}
	}
	async getConfig() {
		if (this.cachedConfig) return this.cachedConfig;
		await this.ensureConfigFile();
		try {
			let e = await u.readFile(this.configPath, "utf-8"), t = JSON.parse(e);
			return this.cachedConfig = {
				...x,
				...t,
				projects: t.projects || [],
				scanRoots: t.scanRoots || x.scanRoots,
				settings: {
					...x.settings,
					...t.settings
				}
			}, this.cachedConfig;
		} catch (e) {
			return console.error("Failed to parse projects.json, restoring default config:", e), this.cachedConfig = x, await this.saveConfig(this.cachedConfig), this.cachedConfig;
		}
	}
	async saveConfig(e) {
		this.cachedConfig = e, await this.ensureConfigFile();
		try {
			await u.writeFile(this.configPath, JSON.stringify(e, null, 2), "utf-8");
		} catch (e) {
			console.error("Failed to save project registry:", e);
		}
	}
	async getScanRoots() {
		return (await this.getConfig()).scanRoots;
	}
	async setScanRoots(e) {
		let t = await this.getConfig();
		return t.scanRoots = Array.from(new Set(e.map((e) => c.normalize(e)))), await this.saveConfig(t), !0;
	}
	async getProjects() {
		return (await this.getConfig()).projects;
	}
	async addProject(e, t = !1) {
		let n = c.normalize(e), r = await this.getConfig(), i = r.projects.findIndex((e) => c.normalize(e.path).toLowerCase() === n.toLowerCase());
		return i >= 0 ? r.projects[i].favorite = t || r.projects[i].favorite : r.projects.unshift({
			path: n,
			addedAt: (/* @__PURE__ */ new Date()).toISOString(),
			favorite: t,
			tags: []
		}), await this.saveConfig(r), !0;
	}
	async removeProject(e) {
		let t = c.normalize(e).toLowerCase(), n = await this.getConfig(), r = n.projects.length;
		return n.projects = n.projects.filter((e) => c.normalize(e.path).toLowerCase() !== t), n.projects.length !== r && (await this.saveConfig(n), !0);
	}
	async toggleFavorite(e) {
		let t = c.normalize(e).toLowerCase(), n = await this.getConfig(), r = n.projects.find((e) => c.normalize(e.path).toLowerCase() === t);
		return r ? (r.favorite = !r.favorite, await this.saveConfig(n), r.favorite) : !1;
	}
	async isFavorite(e) {
		let t = c.normalize(e).toLowerCase();
		return !!(await this.getConfig()).projects.find((e) => c.normalize(e.path).toLowerCase() === t)?.favorite;
	}
}(), C = /* @__PURE__ */ new Set([
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
async function w(e) {
	try {
		let t = c.normalize(e);
		if (!d(t) || !(await u.stat(t)).isDirectory()) return null;
		let n = d(c.join(t, "backlog")), r = d(c.join(t, "infra.config.json")), i = d(c.join(t, ".git")), a = d(c.join(t, "package.json"));
		if (!n && !r && !(i && a)) return null;
		let o = c.basename(t), s, l, f;
		if (r) try {
			let e = await u.readFile(c.join(t, "infra.config.json"), "utf-8");
			f = JSON.parse(e).features;
		} catch {}
		if (a) try {
			let e = await u.readFile(c.join(t, "package.json"), "utf-8"), n = JSON.parse(e);
			n.name && (o = n.name), n.description && (s = n.description), n.version && (l = n.version);
		} catch {}
		if (n && d(c.join(t, "backlog", "config.yml"))) try {
			let e = (await u.readFile(c.join(t, "backlog", "config.yml"), "utf-8")).match(/project_name:\s*["']?([^"'\r\n]+)["']?/);
			e && e[1] && (o = e[1].trim());
		} catch {}
		let p = {
			total: 0,
			todo: 0,
			inProgress: 0,
			review: 0,
			done: 0
		};
		if (n && d(c.join(t, "backlog", "tasks"))) try {
			let e = await u.readdir(c.join(t, "backlog", "tasks"));
			for (let n of e) if (n.endsWith(".md")) {
				p.total++;
				try {
					let e = await u.readFile(c.join(t, "backlog", "tasks", n), "utf-8"), { data: r } = m(e), i = r.status || "To Do";
					i === "To Do" ? p.todo++ : i === "In Progress" ? p.inProgress++ : i === "Review" ? p.review++ : i === "Done" && p.done++;
				} catch {
					p.todo++;
				}
			}
		} catch {}
		let g, _, v = 0, y = 0, b = 0, x;
		if (i) try {
			let e = h(t), n = await e.status();
			g = n.current || "detached", _ = n.isClean(), v = n.files.length, y = n.ahead || 0, b = n.behind || 0;
			let r = await e.log({ maxCount: 1 });
			r.latest && (x = {
				hash: r.latest.hash,
				message: r.latest.message,
				date: r.latest.date,
				author: r.latest.author_name
			});
		} catch {}
		let C, w = c.join(t, ".rag-index", "meta.json");
		if (d(w)) try {
			let e = await u.readFile(w, "utf-8"), t = JSON.parse(e);
			C = {
				ready: !0,
				chunksCount: t.chunks || 0,
				filesCount: t.files?.length || 0,
				builtAt: t.builtAt,
				model: t.model
			};
		} catch {
			C = { ready: !0 };
		}
		else (d(c.join(t, "scripts", "rag")) || f && f.docsRag) && (C = { ready: !1 });
		let T = {
			runningCount: 0,
			processes: []
		}, E = c.join(t, ".env-state", "processes.json");
		if (d(E)) try {
			let e = await u.readFile(E, "utf-8"), t = JSON.parse(e), n = [];
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
			T = {
				runningCount: n.length,
				processes: n
			};
		} catch {}
		let D = await S.isFavorite(t);
		return {
			name: o,
			path: t,
			description: s,
			version: l,
			favorite: D,
			hasBacklog: n,
			hasInfraConfig: r,
			hasGit: i,
			gitBranch: g,
			gitClean: _,
			gitAhead: y,
			gitBehind: b,
			uncommittedCount: v,
			lastCommit: x,
			taskCounts: p,
			ragStatus: C,
			processStatus: T,
			features: f,
			lastScannedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	} catch (t) {
		return console.error(`Error inspecting project at ${e}:`, t), null;
	}
}
async function T(e, t = 2) {
	let n = /* @__PURE__ */ new Map();
	async function r(e, i) {
		if (!(i > t)) try {
			if (!d(e) || !(await u.stat(e)).isDirectory()) return;
			let t = await w(e);
			if (t && (n.set(c.normalize(t.path).toLowerCase(), t), i > 0)) return;
			let a = await u.readdir(e, { withFileTypes: !0 });
			for (let t of a) if (t.isDirectory()) {
				let n = t.name.toLowerCase();
				if (C.has(n) || n.startsWith(".")) continue;
				await r(c.join(e, t.name), i + 1);
			}
		} catch {}
	}
	for (let t of e) await r(c.normalize(t), 0);
	for (let e of n.values()) await S.addProject(e.path, !!e.favorite);
	return Array.from(n.values());
}
//#endregion
//#region electron/services/aiAgentService.ts
var E = c.join(g.homedir(), ".projecthub", "claude_config"), D = c.join(g.homedir(), ".projecthub", "ai-config.json"), O = new class {
	activeControllers = /* @__PURE__ */ new Map();
	constructor() {
		this.ensureConfigDir();
	}
	ensureConfigDir() {
		let e = c.dirname(D);
		if (!d(e)) try {
			u.mkdir(e, { recursive: !0 });
		} catch (e) {
			console.error("Failed to create config dir:", e);
		}
		if (!d(E)) try {
			u.mkdir(E, { recursive: !0 });
		} catch (e) {
			console.error("Failed to create claude config dir:", e);
		}
	}
	async getClaudeAuthStatus() {
		let e = [c.join(E, ".claude.json"), c.join(g.homedir(), ".claude.json")];
		for (let t of e) if (d(t)) try {
			let e = await u.readFile(t, "utf-8"), n = JSON.parse(e);
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
		let e = [c.join(E, ".claude.json"), c.join(g.homedir(), ".claude.json")];
		for (let t of e) if (d(t)) try {
			let e = await u.readFile(t, "utf-8"), n = JSON.parse(e);
			n.oauthAccount && (delete n.oauthAccount, delete n.primaryApiKey, await u.writeFile(t, JSON.stringify(n, null, 2), "utf-8"));
		} catch (e) {
			console.warn(`Failed to clean oauthAccount from ${t}:`, e);
		}
		try {
			let e = c.join(E, ".credentials.json");
			d(e) && await u.unlink(e);
		} catch {}
		try {
			process.platform === "win32" ? p("cmd.exe", ["/c", "claude auth logout"], { env: {
				...process.env,
				CLAUDE_CONFIG_DIR: E
			} }) : p("claude", ["auth", "logout"], { env: {
				...process.env,
				CLAUDE_CONFIG_DIR: E
			} });
		} catch (e) {
			console.warn("Failed to spawn claude auth logout:", e);
		}
		return !0;
	}
	async getConfig() {
		try {
			if (d(D)) {
				let e = await u.readFile(D, "utf-8");
				return JSON.parse(e);
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
		this.ensureConfigDir(), await u.writeFile(D, JSON.stringify(e, null, 2), "utf-8");
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
		let r = c.isAbsolute(t) ? t : c.join(e, t), i = c.dirname(r);
		return await u.mkdir(i, { recursive: !0 }), await u.writeFile(r, n, "utf-8"), !0;
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
		})), l = e.mode === "agent" ? this.getAnthropicTools() : void 0, f = {
			model: e.config.model || "claude-3-7-sonnet-20250219",
			max_tokens: 4096,
			system: t,
			messages: s,
			stream: !0
		};
		l && l.length > 0 && (f.tools = l), e.config.thinkingBudget && e.config.thinkingBudget > 0 && e.config.model.includes("3-7") ? f.thinking = {
			type: "enabled",
			budget_tokens: e.config.thinkingBudget
		} : f.temperature = e.config.temperature ?? .7;
		let p = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"x-api-key": o,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json"
			},
			body: JSON.stringify(f),
			signal: n
		});
		if (!p.ok) {
			let e = await p.text();
			throw Error(`Anthropic API Error (${p.status}): ${e}`);
		}
		let m = "", h = "", g = [], _ = null, v = p.body?.getReader();
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
							m += e, r({ text: e });
						} else if (t.delta?.type === "thinking_delta") {
							let e = t.delta.thinking;
							h += e, r({ thought: e });
						} else t.delta?.type === "input_json_delta" && _ && (_.argsStr += t.delta.partial_json);
					} else if (t.type === "content_block_start") t.content_block?.type === "tool_use" && (_ = {
						id: t.content_block.id,
						name: t.content_block.name,
						argsStr: ""
					});
					else if (t.type === "content_block_stop" && _) {
						let t = {};
						try {
							t = JSON.parse(_.argsStr || "{}");
						} catch (e) {
							console.error("Failed to parse tool args:", e);
						}
						let n = {
							id: _.id,
							name: _.name,
							args: t,
							status: "pending"
						};
						if (_.name === "write_file" && t.filePath && t.content) {
							let r = c.isAbsolute(t.filePath) ? t.filePath : c.join(e.projectPath, t.filePath), i = "";
							d(r) && (i = await u.readFile(r, "utf-8").catch(() => "")), n.diff = {
								filePath: t.filePath,
								oldContent: i,
								newContent: t.content,
								patch: this.generateDiff(i, t.content, t.filePath)
							};
						}
						g.push(n), r({ toolCall: n }), _ = null;
					}
				} catch {}
			}
		}
		i({
			id: `msg-${Date.now()}`,
			role: "assistant",
			content: m,
			thought: h || void 0,
			toolCalls: g.length > 0 ? g.map((e) => ({
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
}(), ee = [
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
], k = new class extends _ {
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
			projectName: c.basename(e),
			status: "idle",
			updatedAt: Date.now()
		};
	}
	getAllProjectStatuses() {
		return Array.from(this.projectStatuses.values());
	}
	getAvailableModels() {
		return ee;
	}
	setProjectStatus(e, t, n, r) {
		let i = (this.activeSubagents.get(e) || []).filter((e) => e.status === "running").length, a = {
			projectPath: e,
			projectName: c.basename(e),
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
		O.abortStream(e);
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
		let n = e.replace(/\\/g, "/").toLowerCase(), r = c.basename(n);
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
		let { sessionId: i, projectPath: a } = e, o = !!e.config.autoApprove, s = e.config.autoApproveRules, l = o && (!s || s.allowCommands !== !1), f = o && (!s || s.allowFileWrite !== !1);
		if (s && s.allowFileRead, o && s && s.allowSubagents, this.setProjectStatus(a, "running", "Агент анализирует задачу..."), e.config.provider === "anthropic" && (!e.config.apiKey || !e.config.apiKey.trim())) return this.runClaudeCliTask(e, t, n, r);
		try {
			await O.streamChat(e, async (e) => {
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
						if (l && !r) {
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
						if (f && !o) await O.applyDiff(a, e, r), n.status = "accepted", n.result = `Файл ${e} успешно записан`, t({ toolCall: n });
						else {
							let s = "", l = c.isAbsolute(e) ? e : c.join(a, e);
							if (d(l)) try {
								s = await u.readFile(l, "utf-8");
							} catch {}
							let f = O.generateDiff(s, r, e);
							n.diff = {
								filePath: e,
								oldContent: s,
								newContent: r,
								patch: f
							};
							let p = {
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
								approvalRequest: p,
								toolCall: n
							});
							let m = await this.requestApproval(p);
							m.approved ? (await O.applyDiff(a, e, r), n.status = "accepted", n.result = `Файл ${e} успешно сохранен`, t({ toolCall: n })) : (n.status = "rejected", n.result = `Отклонено пользователем: ${m.text || "Без комментария"}`, t({ toolCall: n }));
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
		let u = p("claude", l, {
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
				CLAUDE_CONFIG_DIR: E
			}
		});
		this.activeProcesses.set(i, u), u.stdin.write(s, "utf-8"), u.stdin.end();
		let d = "", f = "", m = [], h = "";
		u.stdout.on("data", async (n) => {
			h += n.toString("utf-8");
			let r = h.split("\n");
			h = r.pop() || "";
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
							if (m.push(n), t({ toolCall: n }), r.name === "AskUserQuestion" || r.name === "ask_question" || r.name === "ask_user") {
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
		let g = "";
		u.stderr.on("data", (e) => {
			let n = e.toString();
			g += n, (n.includes("rate limit") || n.includes("429 Too Many")) && t({ rateLimitWarning: {
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
					toolCalls: m.map((e) => ({
						...e,
						status: e.status || "done"
					})),
					timestamp: (/* @__PURE__ */ new Date()).toISOString()
				};
				this.setProjectStatus(a, "done", "Задача успешно выполнена"), n(e);
			} else {
				let t = g || `Claude Code завершился с кодом ${e}`;
				this.setProjectStatus(a, "error", t), r(t);
			}
		}), u.on("error", (e) => {
			this.activeProcesses.delete(i), this.setProjectStatus(a, "error", e.message), r(e.message);
		});
	}
	executeSubprocess(e, t, n) {
		return new Promise((r, i) => {
			let a = process.platform === "win32", o = p(a ? "powershell.exe" : "/bin/bash", a ? [
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
}(), A = new class {
	status = "unloaded";
	modelName = "Xenova/whisper-base";
	cacheDir;
	pipelinePromise = null;
	asrPipeline = null;
	errorMessage;
	loadStartTime = 0;
	loadTimeMs;
	constructor() {
		this.cacheDir = c.join(g.homedir(), ".cache", "projecthub", "whisper");
	}
	getState() {
		return {
			status: this.status,
			model: this.modelName,
			cacheDir: this.cacheDir,
			error: this.errorMessage,
			loadTimeMs: this.loadTimeMs
		};
	}
	initBackground() {
		this.status !== "loading" && this.status !== "ready" && (this.status = "loading", this.loadStartTime = Date.now(), console.log(`[LocalWhisper] Starting background initialization for model: ${this.modelName}`), this.getPipeline().then(() => {
			this.status = "ready", this.loadTimeMs = Date.now() - this.loadStartTime, console.log(`[LocalWhisper] Model is ready in background (${this.loadTimeMs}ms)`);
		}).catch((e) => {
			this.status = "error", this.errorMessage = e?.message || String(e), console.warn("[LocalWhisper] Background model pre-load error:", e);
		}));
	}
	async getPipeline() {
		return this.asrPipeline ? this.asrPipeline : (this.pipelinePromise ||= (async () => {
			try {
				await u.mkdir(this.cacheDir, { recursive: !0 });
				let e = await import("./transformers.node-COFdxZ8y.js");
				e.env && (e.env.cacheDir = this.cacheDir, e.env.allowLocalModels = !0), console.log(`[LocalWhisper] Loading pipeline with cache at ${this.cacheDir}...`);
				let t = await e.pipeline("automatic-speech-recognition", this.modelName, { dtype: "fp32" });
				return this.asrPipeline = t, t;
			} catch (e) {
				throw this.pipelinePromise = null, e;
			}
		})(), this.pipelinePromise);
	}
	async transcribe(e, t = "ru") {
		let n = Date.now();
		try {
			let r = await this.getPipeline();
			this.status = "ready";
			let i = e instanceof Float32Array ? e : new Float32Array(e);
			if (i.length < 1600) return {
				text: "",
				timeMs: Date.now() - n
			};
			console.log(`[LocalWhisper] Transcribing ${i.length} samples (${(i.length / 16e3).toFixed(2)}s) in language: ${t}...`);
			let a = ((await r(i, {
				language: t === "en" ? "english" : "russian",
				task: "transcribe",
				chunk_length_s: 30,
				stride_length_s: 5
			}))?.text || "").trim(), o = Date.now() - n;
			return console.log(`[LocalWhisper] Transcription completed in ${o}ms: "${a}"`), {
				text: a,
				timeMs: o
			};
		} catch (e) {
			throw console.error("[LocalWhisper] Transcription error:", e), this.status = "error", this.errorMessage = e?.message || String(e), e;
		}
	}
}(), j = new class {
	watcher = null;
	currentPath = null;
	debounceTimer = null;
	watch(e, t) {
		if (this.currentPath === e && this.watcher) return;
		this.unwatch();
		let n = c.join(e, "backlog", "tasks");
		if (!d(n)) return;
		this.currentPath = e, this.watcher = v.watch(n, {
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
}(), M = "F:\\ProjectTemplate", te = /* @__PURE__ */ new Set([
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
async function N(e, t) {
	await u.mkdir(t, { recursive: !0 });
	let n = await u.readdir(e, { withFileTypes: !0 });
	for (let r of n) {
		let n = c.join(e, r.name), i = c.join(t, r.name), a = r.name.toLowerCase();
		te.has(a) || (r.isDirectory() ? await N(n, i) : r.isFile() && await u.copyFile(n, i));
	}
}
async function ne(e) {
	let t = e || M;
	return {
		available: d(t),
		path: t
	};
}
async function re(e) {
	let t = e.templateSource || M;
	if (!d(t)) throw Error(`Директория шаблона не найдена: ${t}`);
	let n = c.normalize(e.targetDir);
	if (d(n)) {
		if ((await u.readdir(n)).length > 0) throw Error(`Целевая директория уже существует и не пуста: ${n}`);
	} else await u.mkdir(n, { recursive: !0 });
	await N(t, n);
	let r = c.join(n, "package.json");
	if (d(r)) try {
		let t = await u.readFile(r, "utf-8"), n = JSON.parse(t);
		n.name = e.name.toLowerCase().replace(/[^a-z0-9-_]/g, "-"), n.version = "0.1.0", n.description = `Проект ${e.name} на базе ProjectTemplate`, await u.writeFile(r, JSON.stringify(n, null, 2), "utf-8");
	} catch (e) {
		console.error("Failed to parametrize package.json:", e);
	}
	let i = c.join(n, "infra.config.json");
	if (d(i)) try {
		let t = await u.readFile(i, "utf-8"), n = JSON.parse(t);
		n.projectRoot = ".", n.features = {
			...n.features,
			...e.features
		}, await u.writeFile(i, JSON.stringify(n, null, 2), "utf-8");
	} catch (e) {
		console.error("Failed to parametrize infra.config.json:", e);
	}
	let a = c.join(n, "backlog", "config.yml");
	if (d(a)) try {
		let t = await u.readFile(a, "utf-8");
		t = t.replace(/project_name:\s*["']?([^"'\r\n]+)["']?/, `project_name: "${e.name}"`), await u.writeFile(a, t, "utf-8");
	} catch (e) {
		console.error("Failed to parametrize backlog/config.yml:", e);
	}
	if (e.initGit) try {
		await h(n).init();
	} catch (e) {
		console.error("Failed to init git:", e);
	}
	let o = c.join(n, "scripts", "setup.mjs");
	if (d(o)) try {
		await new Promise((e) => {
			let t = p(process.execPath, [o], {
				cwd: n,
				shell: !0
			});
			t.on("close", () => e()), t.on("error", () => e());
		});
	} catch (e) {
		console.error("Setup script execution warning:", e);
	}
	await S.addProject(n, !0);
	let s = await w(n);
	if (!s) throw Error("Не удалось проинспектировать созданный проект.");
	return s;
}
var P = new class {
	activeProcesses = /* @__PURE__ */ new Map();
	broadcastLog(e, t) {
		for (let n of r.getAllWindows()) n.isDestroyed() || n.webContents.send("process:logChunk", {
			processId: e,
			text: t
		});
	}
	broadcastStatus(e) {
		for (let t of r.getAllWindows()) t.isDestroyed() || t.webContents.send("process:statusChanged", e);
	}
	async startProcess(e, t, n) {
		let r = `${c.normalize(e)}::${n}`;
		if (this.activeProcesses.has(r)) {
			let e = this.activeProcesses.get(r);
			if (e.info.status === "running") return e.info;
		}
		let i = process.platform === "win32", a = p(i ? "powershell.exe" : "/bin/sh", i ? [
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
		let l = (e) => {
			let t = e.toString();
			s.logBuffer.push(t), s.logBuffer.length > 2e3 && s.logBuffer.shift(), this.broadcastLog(r, t);
		};
		return a.stdout.on("data", l), a.stderr.on("data", l), a.on("close", (e) => {
			o.status = e === 0 ? "stopped" : "failed", o.exitCode = e ?? void 0, this.broadcastStatus(o), this.broadcastLog(r, `\r\n[Process exited with code ${e}]\r\n`);
		}), a.on("error", (e) => {
			o.status = "failed", this.broadcastStatus(o), this.broadcastLog(r, `\r\n[Process error: ${e.message}]\r\n`);
		}), this.broadcastStatus(o), o;
	}
	async stopProcess(e) {
		let t = this.activeProcesses.get(e);
		return t ? !t.info.pid || new Promise((n) => {
			y(t.info.pid, "SIGKILL", (r) => {
				r ? (console.error(`Failed to kill process tree for ${e}:`, r), n(!1)) : (t.info.status = "stopped", this.broadcastStatus(t.info), n(!0));
			});
		}) : !1;
	}
	getLogs(e) {
		return this.activeProcesses.get(e)?.logBuffer || [];
	}
	async listProcessesForProject(e) {
		let t = c.normalize(e), n = [];
		for (let [e, r] of this.activeProcesses.entries()) c.normalize(r.info.cwd) === t && n.push(r.info);
		let r = c.join(t, ".env-state", "processes.json");
		if (d(r)) try {
			let e = await u.readFile(r, "utf-8"), i = JSON.parse(e);
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
		let r = `${c.normalize(e)}::${t}`, i = this.activeProcesses.get(r);
		if (i && i.logBuffer.length > 0) return i.logBuffer.slice(-n).join("");
		let a = c.join(e, ".env-state", "logs", `${t}.log`);
		if (d(a)) try {
			let e = await u.readFile(a, "utf-8");
			return e.charCodeAt(0) === 65279 && (e = e.slice(1)), e.split("\n").slice(-n).join("\n");
		} catch (e) {
			console.error(`Failed to tail log ${a}:`, e);
		}
		return "";
	}
	cleanupAll() {
		for (let [e, t] of this.activeProcesses.entries()) if (t.info.pid && t.info.status === "running") try {
			y(t.info.pid, "SIGKILL");
		} catch (t) {
			console.error(`Cleanup kill failed for ${e}:`, t);
		}
	}
}(), F = ".projecthub.json", I = new class {
	detectDefaultCommands(e) {
		let t = d(c.join(e, "package.json")), n = d(c.join(e, "Cargo.toml")), r = d(c.join(e, "pyproject.toml")) || d(c.join(e, "requirements.txt"));
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
		let t = c.join(e, F);
		if (d(t)) try {
			let n = await u.readFile(t, "utf-8"), r = JSON.parse(n);
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
		let n = c.join(e, F);
		try {
			return await u.writeFile(n, JSON.stringify(t, null, 2), "utf-8"), !0;
		} catch (e) {
			return console.error(`Failed to save ${n}:`, e), !1;
		}
	}
}(), ie = "Xenova/all-MiniLM-L6-v2", L = null, R = null, z = null;
async function B() {
	if (!R) try {
		R = await import("@lancedb/lancedb");
	} catch (e) {
		return console.warn("[RAG] LanceDB native module not available, fallback to fulltext search:", e), null;
	}
	return R;
}
async function ae() {
	if (!z) try {
		z = await import("./transformers.node-COFdxZ8y.js"), z.env && (z.env.cacheDir = c.join(process.cwd(), ".rag-cache"));
	} catch (e) {
		return console.warn("[RAG] Transformers not available:", e), null;
	}
	return z;
}
async function oe() {
	if (!L) {
		let e = await ae();
		if (!e) return null;
		L = e.pipeline("feature-extraction", ie, { dtype: "fp32" });
	}
	return L;
}
async function se(e) {
	try {
		let t = await oe();
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
async function ce(e) {
	let t = [], n = [
		{
			dir: c.join(e, "backlog", "docs"),
			category: "doc"
		},
		{
			dir: c.join(e, "backlog", "decisions"),
			category: "decision"
		},
		{
			dir: c.join(e, "backlog", "tasks"),
			category: "task"
		}
	];
	for (let { dir: r, category: i } of n) if (d(r)) try {
		let n = await u.readdir(r);
		for (let a of n) if (a.endsWith(".md")) {
			let n = c.join(r, a);
			t.push({
				filePath: n,
				relative: c.relative(e, n),
				category: i
			});
		}
	} catch (e) {
		console.error(`Failed to scan dir ${r}:`, e);
	}
	let r = c.join(e, "README.md");
	return d(r) && t.push({
		filePath: r,
		relative: "README.md",
		category: "doc"
	}), t;
}
async function le(e) {
	let t = e.query?.trim();
	if (!t) return [];
	let n = e.mode || "all", r = e.limit || 15, i = e.global ?? !1, a = [];
	a = i || !e.projectPath ? (await S.getProjects()).map((e) => ({
		name: c.basename(e.path),
		path: e.path
	})) : [{
		name: c.basename(e.projectPath),
		path: e.projectPath
	}];
	let o = [];
	for (let e of a) {
		let i = e.path;
		if (n === "vector" || n === "all") {
			let n = c.join(i, ".rag-index");
			if (d(n)) try {
				let a = await B();
				if (a) {
					let s = await a.connect(n), l = await s.tableNames(), u = l.includes("docs") ? "docs" : l[0];
					if (u) {
						let n = await s.openTable(u), a = await se([t]);
						if (a && a[0]) {
							let t = await n.search(a[0]).limit(r).toArray();
							for (let n of t) {
								let t = typeof n._distance == "number" ? n._distance : .5, r = Math.max(0, Math.min(1, 1 - t / 1.5)), a = n.file || "", s = "doc";
								a.includes("decisions") ? s = "decision" : a.includes("tasks") && (s = "task"), o.push({
									projectName: e.name,
									projectPath: i,
									filePath: c.join(i, a),
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
			let n = await ce(i), r = t.toLowerCase();
			for (let t of n) {
				let n = await u.readFile(t.filePath, "utf-8"), a = m(n), s = a.data?.title || c.basename(t.filePath, ".md"), l = a.content, d = s.toLowerCase().includes(r), f = l.toLowerCase().indexOf(r);
				if (d || f !== -1) {
					let n = "";
					if (f !== -1) {
						let e = Math.max(0, f - 80), t = Math.min(l.length, f + r.length + 120);
						n = (e > 0 ? "..." : "") + l.slice(e, t).trim() + (t < l.length ? "..." : "");
					} else n = l.slice(0, 160).trim() + (l.length > 160 ? "..." : "");
					o.push({
						projectName: e.name,
						projectPath: i,
						filePath: t.filePath,
						fileRelative: t.relative,
						heading: s,
						snippet: n.replace(/\n+/g, " "),
						score: d ? .95 : .75,
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
async function ue(e) {
	let t = c.join(e, ".rag-index");
	if (!d(t)) return {
		hasIndex: !1,
		chunksCount: 0
	};
	try {
		let e = await B();
		if (e) {
			let n = await e.connect(t), r = await n.tableNames(), i = r.includes("docs") ? "docs" : r[0];
			if (i) return {
				hasIndex: !0,
				chunksCount: await (await n.openTable(i)).countRows(),
				lastModified: (await u.stat(t)).mtime.toISOString()
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
var V = new class {
	watchers = /* @__PURE__ */ new Map();
	broadcastGitChanged(e) {
		for (let t of r.getAllWindows()) t.isDestroyed() || t.webContents.send("git:changed", { projectPath: e });
	}
	watchProjectGit(e) {
		let t = c.normalize(e);
		if (this.watchers.has(t)) return;
		let n = c.join(t, ".git");
		if (!d(n)) return;
		let r = [
			t,
			c.join(n, "HEAD"),
			c.join(n, "index"),
			c.join(n, "refs")
		], i = v.watch(r, {
			ignoreInitial: !0,
			ignored: [
				"**/node_modules/**",
				"**/.git/**",
				"**/dist/**",
				"**/dist-electron/**",
				"**/release/**",
				"**/.rag-index/**",
				"**/.venv/**",
				"**/.tmp/**"
			],
			awaitWriteFinish: {
				stabilityThreshold: 300,
				pollInterval: 100
			}
		});
		i.on("all", () => {
			this.broadcastGitChanged(t);
		}), this.watchers.set(t, i);
	}
	async getRepoDetails(e) {
		let t = c.join(e, ".git");
		if (!d(t)) return null;
		try {
			let t = h(e);
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
			let r = h(e);
			return n ? await r.checkoutLocalBranch(t) : await r.checkout(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to checkout ${t}:`, e), !1;
		}
	}
	async createBranch(e, t) {
		try {
			return await h(e).checkoutLocalBranch(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to create branch ${t}:`, e), !1;
		}
	}
	async stageFile(e, t) {
		try {
			return await h(e).add(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to stage ${t}:`, e), !1;
		}
	}
	async unstageFile(e, t) {
		try {
			return await h(e).reset(["HEAD", t]), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to unstage ${t}:`, e), !1;
		}
	}
	async stageAll(e) {
		try {
			return await h(e).add("."), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error("Failed to stage all:", e), !1;
		}
	}
	async commitChanges(e, t, n = !1) {
		try {
			let r = h(e);
			return n && await r.add("."), await r.commit(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error("Failed to commit:", e), !1;
		}
	}
	async deleteBranch(e, t, n = !1) {
		try {
			return await h(e).deleteLocalBranch(t, n), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to delete branch ${t}:`, e), !1;
		}
	}
	async mergeBranch(e, t) {
		try {
			return await h(e).merge([t]), this.broadcastGitChanged(e), { success: !0 };
		} catch (e) {
			return console.error(`Failed to merge ${t}:`, e), {
				success: !1,
				error: e?.message || String(e)
			};
		}
	}
	async fetchRemote(e) {
		try {
			return await h(e).fetch(), this.broadcastGitChanged(e), !0;
		} catch (t) {
			return console.error(`Failed to fetch remotes for ${e}:`, t), !1;
		}
	}
	async pullRemote(e) {
		try {
			return await h(e).pull(), this.broadcastGitChanged(e), { success: !0 };
		} catch (t) {
			return console.error(`Failed to pull for ${e}:`, t), {
				success: !1,
				error: t?.message || String(t)
			};
		}
	}
	async pushRemote(e) {
		try {
			return await h(e).push(), this.broadcastGitChanged(e), { success: !0 };
		} catch (t) {
			return console.error(`Failed to push for ${e}:`, t), {
				success: !1,
				error: t?.message || String(t)
			};
		}
	}
	async discardFileChanges(e, t) {
		try {
			let n = h(e);
			try {
				await n.reset(["HEAD", t]);
			} catch {}
			try {
				await n.checkout(["--", t]);
			} catch {
				let n = c.join(e, t);
				d(n) && await u.rm(n, {
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
			let i = h(e), a = [];
			return n ? a.push(`${t}..${n}`) : a.push(t), r && a.push("--", r), await i.diff(a);
		} catch (e) {
			return console.error(`Failed to get diff between ${t} and ${n}:`, e), "";
		}
	}
	async getFileDiff(e, t, n = !1) {
		try {
			let r = h(e);
			return n ? await r.diff(["--cached", t]) : await r.diff([t]);
		} catch (e) {
			return console.error(`Failed to get diff for ${t}:`, e), "";
		}
	}
}(), H = b(f), U = new class {
	async runGh(e, t) {
		try {
			let { stdout: n } = await H("gh", e, {
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
			return await H("gh", ["--version"]), !0;
		} catch {
			return !1;
		}
	}
	async getProviderInfo(e) {
		try {
			let t = c.join(e, ".git");
			if (!d(t)) return {
				provider: "none",
				hasCli: !1,
				authenticated: !1
			};
			let n = await h(e).getRemotes(!0), r = n.find((e) => e.name === "origin") || n[0];
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
			let l = await this.isGhAvailable(), u = !1;
			if (l && a) try {
				await this.runGh(["auth", "status"], e), u = !0;
			} catch {
				u = !1;
			}
			return {
				provider: a ? "github" : o ? "gitlab" : "none",
				repo: s || void 0,
				remoteUrl: i,
				hasCli: l,
				authenticated: u
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
			let r = c.join(e, "backlog", "tasks");
			if (!d(r)) return;
			let i = (t + " " + n).match(/task-(\d+)/i);
			if (!i) return;
			let a = `task-${i[1]}`.toLowerCase(), o = await u.readdir(r);
			for (let e of o) if (e.toLowerCase().startsWith(a) && e.endsWith(".md")) {
				let t = c.join(r, e), n = await u.readFile(t, "utf-8"), i = m(n);
				if (i.data.status !== "Review" && i.data.status !== "Done") {
					i.data.status = "Review";
					let e = m.stringify(i.content, i.data);
					await u.writeFile(t, e, "utf-8");
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
function de(e) {
	return e.toLowerCase().trim().replace(/[^\w\sа-яё\-]/gi, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
}
async function fe(e) {
	let t = [], n = c.normalize(e), r = c.join(n, "backlog", "decisions");
	if (d(r)) try {
		let e = await u.readdir(r);
		for (let i of e) if (i.endsWith(".md")) {
			let e = c.join(r, i), a = await u.stat(e), o = await u.readFile(e, "utf-8"), { data: s, content: l } = m(o), d = s.title;
			if (!d) {
				let e = l.match(/^#\s+(.+)$/m);
				d = e ? e[1].trim() : i.replace(/\.md$/, "");
			}
			t.push({
				id: `decision-${i}`,
				title: d,
				category: "decision",
				filePath: e,
				fileRelative: c.relative(n, e).replace(/\\/g, "/"),
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
	let i = c.join(n, "backlog", "docs");
	if (d(i)) {
		async function e(r) {
			try {
				let i = await u.readdir(r, { withFileTypes: !0 });
				for (let a of i) {
					let i = c.join(r, a.name);
					if (a.isDirectory()) await e(i);
					else if (a.isFile() && a.name.endsWith(".md")) {
						let e = await u.stat(i), r = await u.readFile(i, "utf-8"), { data: o, content: s } = m(r), l = o.title;
						if (!l) {
							let e = s.match(/^#\s+(.+)$/m);
							l = e ? e[1].trim() : a.name.replace(/\.md$/, "");
						}
						t.push({
							id: `doc-${a.name}`,
							title: l,
							category: "doc",
							filePath: i,
							fileRelative: c.relative(n, i).replace(/\\/g, "/"),
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
async function pe(e) {
	let t = c.normalize(e);
	if (!d(t)) throw Error(`Файл не найден: ${t}`);
	return await u.readFile(t, "utf-8");
}
async function me(e, t) {
	let n = c.normalize(e), r = c.dirname(n);
	return d(r) || await u.mkdir(r, { recursive: !0 }), await u.writeFile(n, t, "utf-8"), !0;
}
async function he(e, t) {
	let n = c.normalize(e), r = t.type || "doc", i = t.title.trim(), a = de(i), o, s, l = t.content;
	if (r === "decision") {
		o = c.join(n, "backlog", "decisions"), await u.mkdir(o, { recursive: !0 });
		let e = 1;
		try {
			let t = await u.readdir(o);
			for (let n of t) {
				let t = n.match(/^(\d{4})/);
				if (t) {
					let n = parseInt(t[1], 10);
					n >= e && (e = n + 1);
				}
			}
		} catch {}
		let r = String(e).padStart(4, "0");
		if (s = `${r}-${a}.md`, !l) {
			let e = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
			l = `---
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
	} else if (o = c.join(n, "backlog", "docs"), await u.mkdir(o, { recursive: !0 }), s = `${a}.md`, !l) {
		let e = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
		l = `---
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
	let d = c.join(o, s);
	await u.writeFile(d, l, "utf-8");
	let f = await u.stat(d);
	return {
		id: `${r}-${s}`,
		title: i,
		category: r,
		filePath: d,
		fileRelative: c.relative(n, d).replace(/\\/g, "/"),
		tags: t.tags || [],
		status: t.status || (r === "decision" ? "Accepted" : void 0),
		date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
		updatedAt: f.mtime.toISOString(),
		size: f.size
	};
}
//#endregion
//#region electron/services/milestoneService.ts
function ge(e) {
	return e.toLowerCase().trim().replace(/[^\w\sа-яё\-]/gi, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "") || "milestone";
}
async function _e(e) {
	let t = [], n = c.normalize(e), r = c.join(n, "backlog", "milestones"), i = c.join(n, "backlog", "tasks"), a = /* @__PURE__ */ new Map();
	if (d(i)) try {
		let e = await u.readdir(i);
		for (let t of e) if (t.endsWith(".md")) {
			let e = await u.readFile(c.join(i, t), "utf-8"), n = m(e), r = n.data.milestone || n.data.milestone_id, o = n.data.status || "To Do";
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
	if (d(r)) try {
		let e = await u.readdir(r);
		for (let n of e) if (n.endsWith(".md")) {
			let e = c.join(r, n), i = await u.readFile(e, "utf-8"), { data: o, content: s } = m(i), l = o.id || n.replace(/\.md$/, "").split("-")[0].trim(), d = o.title || n.replace(/\.md$/, ""), f = o.status || "Planning", p = o.target_date || o.targetDate || o.due_date || void 0, h = o.description || s.trim(), g = l.toLowerCase(), _ = d.toLowerCase(), v = a.get(g) || a.get(_) || {
				total: 0,
				done: 0,
				inProgress: 0,
				review: 0,
				todo: 0
			};
			t.push({
				id: l,
				title: d,
				description: h,
				targetDate: p ? String(p) : void 0,
				status: f,
				filePath: e,
				taskCounts: v
			});
		}
	} catch (e) {
		console.error("Error reading milestones directory:", e);
	}
	return t;
}
async function ve(e, t) {
	let n = c.normalize(e), r = c.join(n, "backlog", "milestones");
	await u.mkdir(r, { recursive: !0 });
	let i = t.title.trim(), a = ge(i), o = 1;
	try {
		let e = await u.readdir(r);
		for (let t of e) {
			let e = t.match(/milestone-(\d+)/i);
			if (e) {
				let t = parseInt(e[1], 10);
				t >= o && (o = t + 1);
			}
		}
	} catch {}
	let s = `milestone-${o}`, l = `${s} - ${a}.md`, d = c.join(r, l), f = {
		id: s,
		title: i,
		status: t.status || "Planning",
		created_date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
	};
	t.targetDate && (f.target_date = t.targetDate), t.description && (f.description = t.description);
	let p = `\n# ${i}\n\n${t.description || "Описание майлстоуна"}\n`, h = m.stringify(p, f);
	return await u.writeFile(d, h, "utf-8"), {
		id: s,
		title: i,
		description: t.description,
		targetDate: t.targetDate,
		status: t.status || "Planning",
		filePath: d,
		taskCounts: {
			total: 0,
			done: 0,
			inProgress: 0,
			review: 0,
			todo: 0
		}
	};
}
async function W(e, t) {
	let n = c.normalize(e);
	if (!d(n)) return !1;
	let r = await u.readFile(n, "utf-8"), i = m(r);
	t.title && (i.data.title = t.title), t.status && (i.data.status = t.status), t.targetDate !== void 0 && (i.data.target_date = t.targetDate), t.description !== void 0 && (i.data.description = t.description);
	let a = m.stringify(i.content, i.data);
	return await u.writeFile(n, a, "utf-8"), !0;
}
async function ye(e) {
	let t = c.normalize(e);
	return d(t) ? (await u.unlink(t), !0) : !1;
}
//#endregion
//#region node_modules/node-pty/lib/utils.js
var G = /* @__PURE__ */ n(((t) => {
	Object.defineProperty(t, "__esModule", { value: !0 }), t.loadNativeModule = t.assign = void 0;
	function n(e) {
		return [...arguments].slice(1).forEach(function(t) {
			return Object.keys(t).forEach(function(n) {
				return e[n] = t[n];
			});
		}), e;
	}
	t.assign = n;
	function r(t) {
		for (var n = [
			"build/Release",
			"build/Debug",
			"prebuilds/" + process.platform + "-" + process.arch
		], r = ["..", "."], i, a = 0, o = n; a < o.length; a++) for (var s = o[a], c = 0, l = r; c < l.length; c++) {
			var u = l[c] + "/" + s + "/";
			try {
				return {
					dir: u,
					module: e(u + "/" + t + ".node")
				};
			} catch (e) {
				i = e;
			}
		}
		throw Error("Failed to load native module: " + t + ".node, checked: " + n.join(", ") + ": " + i);
	}
	t.loadNativeModule = r;
})), K = /* @__PURE__ */ n(((e) => {
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
})), q = /* @__PURE__ */ n(((t) => {
	Object.defineProperty(t, "__esModule", { value: !0 }), t.Terminal = t.DEFAULT_ROWS = t.DEFAULT_COLS = void 0;
	var n = e("events"), r = K();
	t.DEFAULT_COLS = 80, t.DEFAULT_ROWS = 24;
	var i = "", a = "";
	t.Terminal = function() {
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
})), be = /* @__PURE__ */ n(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.getWorkerPipeName = void 0;
	function t(e) {
		return e + "-worker";
	}
	e.getWorkerPipeName = t;
})), xe = /* @__PURE__ */ n(((t) => {
	var n = t && t.__awaiter || function(e, t, n, r) {
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
	}, r = t && t.__generator || function(e, t) {
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
	Object.defineProperty(t, "__esModule", { value: !0 }), t.ConoutConnection = void 0;
	var i = e("worker_threads"), a = be(), o = e("path"), s = K(), c = 1e3;
	t.ConoutConnection = function() {
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
})), Se = /* @__PURE__ */ n(((t) => {
	Object.defineProperty(t, "__esModule", { value: !0 }), t.argsToCommandLine = t.WindowsPtyAgent = void 0;
	var n = e("fs"), r = e("os"), i = e("path"), a = e("child_process"), o = e("net"), s = xe(), c = G(), l, u, d = 1e3;
	t.WindowsPtyAgent = function() {
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
	t.argsToCommandLine = f;
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
})), Ce = /* @__PURE__ */ n(((e) => {
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
	var n = q(), r = Se(), i = G(), a = "cmd.exe", o = "Windows Shell";
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
})), we = /* @__PURE__ */ n(((t) => {
	var n = t && t.__extends || (function() {
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
	Object.defineProperty(t, "__esModule", { value: !0 }), t.UnixTerminal = void 0;
	var r = e("fs"), i = e("path"), a = e("tty"), o = q(), s = G(), c = s.loadNativeModule("pty"), l = c.module, u = c.dir + "/spawn-helper";
	u = i.resolve(__dirname, u), u = u.replace("app.asar", "app.asar.unpacked"), u = u.replace("node_modules.asar", "node_modules.asar.unpacked");
	var d = "sh", f = "xterm", p = 200;
	t.UnixTerminal = function(e) {
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
})), Te = /* @__PURE__ */ t((/* @__PURE__ */ n(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.native = e.open = e.createTerminal = e.fork = e.spawn = void 0;
	var t = G(), n = process.platform === "win32" ? Ce().WindowsTerminal : we().UnixTerminal;
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
})))(), 1), J = new class {
	sessions = /* @__PURE__ */ new Map();
	broadcastData(e, t) {
		for (let n of r.getAllWindows()) n.isDestroyed() || n.webContents.send("pty:data", {
			sessionId: e,
			data: t
		});
	}
	broadcastExit(e, t) {
		for (let n of r.getAllWindows()) n.isDestroyed() || n.webContents.send("pty:exit", {
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
		let s = e.projectName || c.basename(e.projectPath), l = e.title || (e.type === "claude" ? `Claude: ${s}` : `Terminal: ${s}`), u = {
			...process.env,
			TERM: "xterm-256color",
			COLORTERM: "truecolor",
			CLAUDE_CONFIG_DIR: E
		}, f = d(e.projectPath) ? e.projectPath : process.cwd(), p = Te.spawn(a, o, {
			name: "xterm-256color",
			cols: r,
			rows: i,
			cwd: f,
			env: u
		}), m = {
			id: t,
			projectPath: e.projectPath,
			projectName: s,
			type: e.type,
			title: l,
			createdAt: Date.now(),
			status: "running"
		};
		return p.onData((e) => {
			this.broadcastData(t, e);
		}), p.onExit(({ exitCode: e }) => {
			let n = this.sessions.get(t);
			n && (n.info.status = "exited", n.info.exitCode = e), this.broadcastExit(t, e);
		}), this.sessions.set(t, {
			info: m,
			ptyProcess: p
		}), m;
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
}(), Ee = /* @__PURE__ */ new Set([
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
]), Y = new class {
	validateSafePath(e, t) {
		let n = c.resolve(e), r = c.resolve(n, t);
		if (!r.startsWith(n)) throw Error(`Access Denied: Path traversal detected outside project root (${t})`);
		return r;
	}
	async readTree(e, t = "", n = 6, r = 0) {
		let i = c.resolve(e), a = c.resolve(i, t);
		if (!a.startsWith(i) || !d(a) || r >= n) return [];
		try {
			let t = await u.readdir(a, { withFileTypes: !0 }), o = [];
			for (let s of t) {
				if (Ee.has(s.name)) continue;
				let t = c.join(a, s.name), l = c.relative(i, t).replace(/\\/g, "/");
				if (s.isDirectory()) {
					let i = await this.readTree(e, l, n, r + 1);
					o.push({
						name: s.name,
						path: t,
						relativePath: l,
						isDirectory: !0,
						children: i
					});
				} else if (s.isFile()) {
					let e = 0;
					try {
						e = (await u.stat(t)).size;
					} catch {}
					o.push({
						name: s.name,
						path: t,
						relativePath: l,
						isDirectory: !1,
						size: e,
						extension: c.extname(s.name).toLowerCase()
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
		if (!d(n)) throw Error(`File not found: ${t}`);
		return await u.readFile(n, "utf-8");
	}
	async saveFileContent(e, t, n) {
		let r = this.validateSafePath(e, t), i = c.dirname(r);
		return d(i) || await u.mkdir(i, { recursive: !0 }), await u.writeFile(r, n, "utf-8"), !0;
	}
	async createFileOrFolder(e, t, n) {
		let r = this.validateSafePath(e, t);
		if (d(r)) throw Error(`Item already exists: ${t}`);
		if (n) await u.mkdir(r, { recursive: !0 });
		else {
			let e = c.dirname(r);
			d(e) || await u.mkdir(e, { recursive: !0 }), await u.writeFile(r, "", "utf-8");
		}
		return !0;
	}
	async deleteFileOrFolder(e, t) {
		let n = this.validateSafePath(e, t);
		return d(n) && await u.rm(n, {
			recursive: !0,
			force: !0
		}), !0;
	}
}(), De = l(import.meta.url), X = c.dirname(De);
process.env.DIST = c.join(X, "../dist"), process.env.VITE_PUBLIC = i.isPackaged ? process.env.DIST : c.join(X, "../public");
var Z = null, Q = process.env.VITE_DEV_SERVER_URL;
k.on("statusChanged", (e) => {
	Z && !Z.isDestroyed() && Z.webContents.send("claudeBridge:statusChanged", e);
}), k.on("subagentUpdated", (e) => {
	Z && !Z.isDestroyed() && Z.webContents.send("claudeBridge:subagentUpdated", e);
});
function $() {
	let e = c.join(X, "../dist"), t = c.join(e, "index.html"), n = c.join(X, "preload.cjs"), i = c.join(X, "preload.js"), a = d(n) ? n : i, o = c.join(X, "../public/icon.png"), s = c.join(X, "../build/icon.png"), l = d(o) ? o : s;
	Z = new r({
		title: "ProjectHub — Панель управления проектами",
		icon: l,
		width: 1400,
		height: 900,
		minWidth: 1024,
		minHeight: 700,
		backgroundColor: "#0f1117",
		autoHideMenuBar: !0,
		webPreferences: {
			preload: a,
			nodeIntegration: !1,
			contextIsolation: !0,
			sandbox: !1
		}
	}), Z.webContents.on("console-message", (e, t, n, r, i) => {
		console.log(`[Renderer Console: ${t}] ${n} (${i}:${r})`);
	}), Z.webContents.on("before-input-event", (e, t) => {
		(t.key === "F12" || t.control && t.shift && t.key.toLowerCase() === "i") && (Z?.webContents.toggleDevTools(), e.preventDefault());
	}), Z.webContents.on("did-fail-load", (e, t, n, r) => {
		console.error(`[Electron] Failed to load ${r}: [${t}] ${n}`);
	}), Q ? Z.loadURL(Q) : Z.loadFile(t);
}
i.on("window-all-closed", () => {
	process.platform !== "darwin" && (i.quit(), Z = null);
}), i.on("activate", () => {
	r.getAllWindows().length === 0 && $();
}), o.handle("projects:list", async () => {
	let e = await S.getProjects(), t = [];
	for (let n of e) {
		let e = await w(n.path);
		e && (e.favorite = !!n.favorite, e.addedAt = n.addedAt, t.push(e));
	}
	return t;
}), o.handle("projects:scan", async (e, t) => await T(t?.roots && t.roots.length > 0 ? t.roots : await S.getScanRoots(), t?.depth ?? 2)), o.handle("projects:add", async (e, t) => {
	let n = await w(t);
	return n ? (await S.addProject(n.path, !1), n) : null;
}), o.handle("projects:remove", async (e, t) => await S.removeProject(t)), o.handle("projects:refresh", async (e, t) => await w(t)), o.handle("projects:toggleFavorite", async (e, t) => await S.toggleFavorite(t)), o.handle("projects:getScanRoots", async () => await S.getScanRoots()), o.handle("projects:setScanRoots", async (e, t) => await S.setScanRoots(t)), o.handle("projects:getDetails", async (e, t) => await w(t)), o.handle("dialog:selectDirectory", async () => {
	if (!Z) return null;
	let e = await a.showOpenDialog(Z, {
		properties: ["openDirectory"],
		title: "Выберите папку проекта с Backlog.md или репозиторием"
	});
	return e.canceled || e.filePaths.length === 0 ? null : e.filePaths[0];
}), o.handle("system:openInExplorer", async (e, t) => {
	await s.openPath(t);
}), o.handle("system:openInCode", async (e, t) => {
	let n = process.platform === "win32" ? "code.cmd" : "code";
	p(n, [t], {
		shell: !0,
		detached: !0
	});
}), o.handle("system:openTerminal", async (e, t) => {
	process.platform === "win32" ? p("cmd.exe", [
		"/c",
		"start",
		"powershell.exe"
	], {
		cwd: t,
		shell: !0,
		detached: !0
	}) : p("open", [
		"-a",
		"Terminal",
		t
	], { detached: !0 });
}), o.handle("backlog:watchProject", async (e, t) => {
	j.watch(t, Z);
});
function Oe(e) {
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
o.handle("backlog:getTasks", async (e, t) => {
	let n = c.join(t, "backlog", "tasks");
	if (!d(n)) return [];
	j.watch(t, Z);
	let r = [];
	try {
		let e = await u.readdir(n);
		for (let t of e) if (t.endsWith(".md")) {
			let e = c.join(n, t), i = await u.readFile(e, "utf-8"), a = m(i), { criteria: o, description: s } = Oe(a.content);
			r.push({
				id: a.data.id || c.basename(t, ".md").split("-")[0].trim(),
				title: a.data.title || c.basename(t, ".md"),
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
}), o.handle("backlog:updateTaskStatus", async (e, t, n) => {
	try {
		if (!d(t)) return !1;
		let e = await u.readFile(t, "utf-8"), r = m(e);
		r.data.status = n;
		let i = m.stringify(r.content, r.data);
		return await u.writeFile(t, i, "utf-8"), !0;
	} catch (e) {
		return console.error(`Failed to update status for ${t}:`, e), !1;
	}
}), o.handle("backlog:toggleCriterion", async (e, t, n, r) => {
	try {
		if (!d(t)) return !1;
		let e = await u.readFile(t, "utf-8"), i = 0, a = e.split("\n"), o = !1;
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
		return o ? (await u.writeFile(t, a.join("\n"), "utf-8"), !0) : !1;
	} catch (e) {
		return console.error(`Failed to toggle criterion in ${t}:`, e), !1;
	}
}), o.handle("backlog:saveFullTask", async (e, t, n) => {
	try {
		if (!d(t)) return !1;
		let e = await u.readFile(t, "utf-8"), r = m(e);
		r.data.title = n.title, r.data.status = n.status, r.data.labels = n.labels, n.milestone ? r.data.milestone = n.milestone : (delete r.data.milestone, delete r.data.milestone_id);
		let i = `\n# ${r.data.id || c.basename(t, ".md").split("-")[0].trim()}: ${n.title}\n\n## Description\n${n.description || "Описание задачи"}\n\n## Acceptance Criteria\n`;
		if (n.criteria && n.criteria.length > 0) for (let e of n.criteria) i += `- [${e.completed ? "x" : " "}] ${e.text}\n`;
		else i += "- [ ] Критерий 1\n";
		let a = m.stringify(i, r.data);
		return await u.writeFile(t, a, "utf-8"), !0;
	} catch (e) {
		return console.error(`Failed to save full task ${t}:`, e), !1;
	}
}), o.handle("backlog:deleteTask", async (e, t) => {
	try {
		return d(t) ? (await u.unlink(t), !0) : !1;
	} catch (e) {
		return console.error(`Failed to delete task ${t}:`, e), !1;
	}
}), o.handle("backlog:saveTask", async (e, t, n) => {
	try {
		return await u.writeFile(t, n, "utf-8"), !0;
	} catch (e) {
		return console.error(`Failed to save task ${t}:`, e), !1;
	}
}), o.handle("backlog:createTask", async (e, t, n) => {
	try {
		let e = c.join(t, "backlog", "tasks");
		d(e) || await u.mkdir(e, { recursive: !0 });
		let r = await u.readdir(e), i = 0;
		for (let e of r) {
			let t = e.match(/task-(\d+)/i);
			if (t) {
				let e = parseInt(t[1], 10);
				e > i && (i = e);
			}
		}
		let a = `task-${i + 1}`, o = `${a} - ${n.title.replace(/[\\/:*?"<>|]/g, "-").trim()}.md`, s = c.join(e, o), l = (/* @__PURE__ */ new Date()).toISOString().split("T")[0], f = {
			id: a,
			title: n.title,
			status: "To Do",
			labels: n.labels || [],
			created: l
		}, p = `\n# ${a}: ${n.title}\n\n## Description\n${n.description || "Описание задачи"}\n\n## Acceptance Criteria\n- [ ] Критерий 1\n`, h = m.stringify(p, f);
		return await u.writeFile(s, h, "utf-8"), {
			id: a,
			title: n.title,
			status: "To Do",
			labels: n.labels || [],
			created: l,
			filePath: s,
			content: p
		};
	} catch (e) {
		return console.error("Failed to create task:", e), null;
	}
}), o.handle("template:createProject", async (e, t) => await re(t)), o.handle("template:checkAvailable", async (e, t) => await ne(t)), o.handle("process:start", async (e, t, n, r) => await P.startProcess(t, n, r)), o.handle("process:stop", async (e, t) => await P.stopProcess(t)), o.handle("process:list", async (e, t) => await P.listProcessesForProject(t)), o.handle("process:tailLog", async (e, t, n, r = 100) => await P.tailProjectLog(t, n, r)), o.handle("actions:getConfig", async (e, t) => await I.getConfig(t)), o.handle("actions:saveConfig", async (e, t, n) => await I.saveConfig(t, n)), o.handle("rag:search", async (e, t) => await le(t)), o.handle("rag:getStats", async (e, t) => await ue(t)), o.handle("git:getLog", async (e, t, n = 30) => {
	try {
		return d(c.join(t, ".git")) ? (await h(t).log({ maxCount: n })).all.map((e) => ({
			hash: e.hash,
			date: e.date,
			message: e.message,
			author_name: e.author_name,
			author_email: e.author_email
		})) : [];
	} catch (e) {
		return console.error(`Git log error for ${t}:`, e), [];
	}
}), o.handle("git:getStatus", async (e, t) => {
	try {
		return d(c.join(t, ".git")) ? await h(t).status() : null;
	} catch (e) {
		return console.error(`Git status error for ${t}:`, e), null;
	}
}), o.handle("git:getRepoDetails", async (e, t) => await V.getRepoDetails(t)), o.handle("git:checkout", async (e, t, n, r = !1) => await V.checkoutBranch(t, n, r)), o.handle("git:createBranch", async (e, t, n) => await V.createBranch(t, n)), o.handle("git:stageFile", async (e, t, n) => await V.stageFile(t, n)), o.handle("git:unstageFile", async (e, t, n) => await V.unstageFile(t, n)), o.handle("git:stageAll", async (e, t) => await V.stageAll(t)), o.handle("git:commit", async (e, t, n, r = !1) => await V.commitChanges(t, n, r)), o.handle("git:getFileDiff", async (e, t, n, r = !1) => await V.getFileDiff(t, n, r)), o.handle("git:deleteBranch", async (e, t, n, r = !1) => await V.deleteBranch(t, n, r)), o.handle("git:mergeBranch", async (e, t, n) => await V.mergeBranch(t, n)), o.handle("git:fetchRemote", async (e, t) => await V.fetchRemote(t)), o.handle("git:pullRemote", async (e, t) => await V.pullRemote(t)), o.handle("git:pushRemote", async (e, t) => await V.pushRemote(t)), o.handle("git:discardFileChanges", async (e, t, n) => await V.discardFileChanges(t, n)), o.handle("git:getDiffBetween", async (e, t, n, r, i) => await V.getDiffBetween(t, n, r, i)), o.handle("pr:getProviderInfo", async (e, t) => await U.getProviderInfo(t)), o.handle("pr:list", async (e, t, n) => await U.listPullRequests(t, n)), o.handle("pr:create", async (e, t, n) => await U.createPullRequest(t, n)), o.handle("pr:getDiff", async (e, t, n) => await U.getPRDiff(t, n)), o.handle("docs:list", async (e, t) => await fe(t)), o.handle("docs:read", async (e, t) => await pe(t)), o.handle("docs:save", async (e, t, n) => await me(t, n)), o.handle("docs:create", async (e, t, n) => await he(t, n)), o.handle("milestones:list", async (e, t) => await _e(t)), o.handle("milestones:create", async (e, t, n) => await ve(t, n)), o.handle("milestones:save", async (e, t, n) => await W(t, n)), o.handle("milestones:delete", async (e, t) => await ye(t)), o.handle("pty:create", async (e, t) => await J.createSession(t)), o.handle("pty:write", async (e, t, n) => J.write(t, n)), o.handle("pty:resize", async (e, t, n, r) => J.resize(t, n, r)), o.handle("pty:kill", async (e, t) => J.kill(t)), o.handle("pty:list", async () => J.listSessions()), o.handle("ai:getConfig", async () => await O.getConfig()), o.handle("ai:saveConfig", async (e, t) => await O.saveConfig(t)), o.handle("ai:getClaudeAuthStatus", async () => await O.getClaudeAuthStatus()), o.handle("ai:startClaudeLogin", async () => {
	try {
		return process.platform === "win32" ? p("cmd.exe", [
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
				CLAUDE_CONFIG_DIR: E
			}
		}) : p("claude", ["auth", "login"], {
			detached: !0,
			shell: !0,
			env: {
				...process.env,
				CLAUDE_CONFIG_DIR: E
			}
		}), !0;
	} catch (e) {
		return console.error("Failed to start claude auth login process:", e), s.openExternal("https://claude.ai/login"), !1;
	}
}), o.handle("ai:claudeLogout", async () => await O.claudeLogout()), o.handle("ai:abortStream", async (e, t) => (O.abortStream(t), k.abortSession(t), !0)), o.handle("ai:applyDiff", async (e, t, n, r) => await O.applyDiff(t, n, r)), o.handle("ai:streamChat", async (e, t) => {
	if (!Z) return;
	let n = Z;
	k.runAgentTask(t, (e) => {
		n.isDestroyed() || n.webContents.send(`ai:chunk:${t.sessionId}`, e);
	}, (e) => {
		n.isDestroyed() || n.webContents.send(`ai:complete:${t.sessionId}`, e);
	}, (e) => {
		n.isDestroyed() || n.webContents.send(`ai:error:${t.sessionId}`, e);
	});
}), o.handle("claudeBridge:getAllProjectStatuses", async () => k.getAllProjectStatuses()), o.handle("claudeBridge:getProjectStatus", async (e, t) => k.getProjectStatus(t)), o.handle("claudeBridge:sendApprovalResponse", async (e, t, n) => k.sendApprovalResponse(t, n)), o.handle("claudeBridge:getSubagents", async (e, t) => k.getSubagents(t)), o.handle("claudeBridge:getAvailableModels", async () => k.getAvailableModels()), o.handle("files:readTree", async (e, t, n = "", r = 6) => await Y.readTree(t, n, r)), o.handle("files:readContent", async (e, t, n) => await Y.readFileContent(t, n)), o.handle("files:saveContent", async (e, t, n, r) => await Y.saveFileContent(t, n, r)), o.handle("files:create", async (e, t, n, r = !1) => await Y.createFileOrFolder(t, n, r)), o.handle("files:delete", async (e, t, n) => await Y.deleteFileOrFolder(t, n)), o.handle("file:readFile", async (e, t, n) => await Y.readFileContent(t, n)), o.handle("file:writeFile", async (e, t, n, r) => await Y.saveFileContent(t, n, r)), o.handle("file:listFiles", async (e, t, n) => (await Y.readTree(t, n || "", 1)).map((e) => ({
	name: e.name,
	isDirectory: e.isDirectory,
	relativePath: e.relativePath
}))), o.handle("voice:transcribeLocal", async (e, { audioData: t, language: n }) => await A.transcribe(t, n)), o.handle("voice:getLocalWhisperStatus", async () => A.getState()), o.handle("system:getPlatform", async () => process.platform), i.on("before-quit", () => {
	P.cleanupAll(), J.cleanupAll();
}), i.whenReady().then(() => {
	$(), A.initBackground();
});
//#endregion
export {};
