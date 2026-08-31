import { createRequire as e } from "node:module";
import { BrowserWindow as t, app as n, dialog as r, ipcMain as i, shell as a } from "electron";
import * as o from "node:path";
import s from "node:path";
import c from "node:fs/promises";
import * as l from "node:fs";
import { existsSync as u } from "node:fs";
import { execFile as d, spawn as f } from "node:child_process";
import p from "gray-matter";
import { simpleGit as m } from "simple-git";
import h from "node:os";
import g from "chokidar";
import _ from "tree-kill";
import { connect as v } from "@lancedb/lancedb";
import * as y from "node:url";
import { promisify as b } from "node:util";
//#region \0rolldown/runtime.js
var x = Object.create, S = Object.defineProperty, C = Object.getOwnPropertyDescriptor, w = Object.getOwnPropertyNames, T = Object.getPrototypeOf, E = Object.prototype.hasOwnProperty, D = (e, t, n) => () => {
	if (n) throw n[0];
	try {
		return e && (t = e(e = 0)), t;
	} catch (e) {
		throw n = [e], e;
	}
}, O = (e, t) => () => (t || (e((t = { exports: {} }).exports, t), e = null), t.exports), k = (e, t) => {
	let n = {};
	for (var r in e) S(n, r, {
		get: e[r],
		enumerable: !0
	});
	return t || S(n, Symbol.toStringTag, { value: "Module" }), n;
}, A = (e, t, n, r) => {
	if (t && typeof t == "object" || typeof t == "function") for (var i = w(t), a = 0, o = i.length, s; a < o; a++) s = i[a], !E.call(e, s) && s !== n && S(e, s, {
		get: ((e) => t[e]).bind(null, s),
		enumerable: !(r = C(t, s)) || r.enumerable
	});
	return e;
}, ee = (e, t, n) => (n = e == null ? {} : x(T(e)), A(t || !e || !e.__esModule || !E.call(e, "default") ? S(n, "default", {
	value: e,
	enumerable: !0
}) : n, e)), te = (e) => E.call(e, "module.exports") ? e["module.exports"] : A(S({}, "__esModule", { value: !0 }), e), j = /* @__PURE__ */ e(import.meta.url), M = {
	version: 1,
	scanRoots: (process.platform === "win32" ? [
		"F:\\",
		"D:\\",
		s.join(h.homedir(), "Projects")
	] : [s.join(h.homedir(), "Projects"), s.join(h.homedir(), "Developer")]).filter((e) => u(e)),
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
}, N = new class {
	configPath;
	cachedConfig = null;
	constructor() {
		let e = h.homedir(), t = s.join(e, ".projecthub");
		this.configPath = s.join(t, "projects.json");
	}
	async ensureConfigFile() {
		try {
			let e = s.dirname(this.configPath);
			return u(e) || await c.mkdir(e, { recursive: !0 }), u(this.configPath) || await c.writeFile(this.configPath, JSON.stringify(M, null, 2), "utf-8"), this.configPath;
		} catch {
			let e = n ? n.getPath("userData") : s.join(h.tmpdir(), ".projecthub");
			return u(e) || await c.mkdir(e, { recursive: !0 }), this.configPath = s.join(e, "projects.json"), u(this.configPath) || await c.writeFile(this.configPath, JSON.stringify(M, null, 2), "utf-8"), this.configPath;
		}
	}
	async getConfig() {
		if (this.cachedConfig) return this.cachedConfig;
		await this.ensureConfigFile();
		try {
			let e = await c.readFile(this.configPath, "utf-8"), t = JSON.parse(e);
			return this.cachedConfig = {
				...M,
				...t,
				projects: t.projects || [],
				scanRoots: t.scanRoots || M.scanRoots,
				settings: {
					...M.settings,
					...t.settings
				}
			}, this.cachedConfig;
		} catch (e) {
			return console.error("Failed to parse projects.json, restoring default config:", e), this.cachedConfig = M, await this.saveConfig(this.cachedConfig), this.cachedConfig;
		}
	}
	async saveConfig(e) {
		this.cachedConfig = e, await this.ensureConfigFile();
		try {
			await c.writeFile(this.configPath, JSON.stringify(e, null, 2), "utf-8");
		} catch (e) {
			console.error("Failed to save project registry:", e);
		}
	}
	async getScanRoots() {
		return (await this.getConfig()).scanRoots;
	}
	async setScanRoots(e) {
		let t = await this.getConfig();
		return t.scanRoots = Array.from(new Set(e.map((e) => s.normalize(e)))), await this.saveConfig(t), !0;
	}
	async getProjects() {
		return (await this.getConfig()).projects;
	}
	async addProject(e, t = !1) {
		let n = s.normalize(e), r = await this.getConfig(), i = r.projects.findIndex((e) => s.normalize(e.path).toLowerCase() === n.toLowerCase());
		return i >= 0 ? r.projects[i].favorite = t || r.projects[i].favorite : r.projects.unshift({
			path: n,
			addedAt: (/* @__PURE__ */ new Date()).toISOString(),
			favorite: t,
			tags: []
		}), await this.saveConfig(r), !0;
	}
	async removeProject(e) {
		let t = s.normalize(e).toLowerCase(), n = await this.getConfig(), r = n.projects.length;
		return n.projects = n.projects.filter((e) => s.normalize(e.path).toLowerCase() !== t), n.projects.length !== r && (await this.saveConfig(n), !0);
	}
	async toggleFavorite(e) {
		let t = s.normalize(e).toLowerCase(), n = await this.getConfig(), r = n.projects.find((e) => s.normalize(e.path).toLowerCase() === t);
		return r ? (r.favorite = !r.favorite, await this.saveConfig(n), r.favorite) : !1;
	}
	async isFavorite(e) {
		let t = s.normalize(e).toLowerCase();
		return !!(await this.getConfig()).projects.find((e) => s.normalize(e.path).toLowerCase() === t)?.favorite;
	}
}(), ne = /* @__PURE__ */ new Set([
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
async function P(e) {
	try {
		let t = s.normalize(e);
		if (!u(t) || !(await c.stat(t)).isDirectory()) return null;
		let n = u(s.join(t, "backlog")), r = u(s.join(t, "infra.config.json")), i = u(s.join(t, ".git")), a = u(s.join(t, "package.json"));
		if (!n && !r && !(i && a)) return null;
		let o = s.basename(t), l, d, f;
		if (r) try {
			let e = await c.readFile(s.join(t, "infra.config.json"), "utf-8");
			f = JSON.parse(e).features;
		} catch {}
		if (a) try {
			let e = await c.readFile(s.join(t, "package.json"), "utf-8"), n = JSON.parse(e);
			n.name && (o = n.name), n.description && (l = n.description), n.version && (d = n.version);
		} catch {}
		if (n && u(s.join(t, "backlog", "config.yml"))) try {
			let e = (await c.readFile(s.join(t, "backlog", "config.yml"), "utf-8")).match(/project_name:\s*["']?([^"'\r\n]+)["']?/);
			e && e[1] && (o = e[1].trim());
		} catch {}
		let h = {
			total: 0,
			todo: 0,
			inProgress: 0,
			review: 0,
			done: 0
		};
		if (n && u(s.join(t, "backlog", "tasks"))) try {
			let e = await c.readdir(s.join(t, "backlog", "tasks"));
			for (let n of e) if (n.endsWith(".md")) {
				h.total++;
				try {
					let e = await c.readFile(s.join(t, "backlog", "tasks", n), "utf-8"), { data: r } = p(e), i = r.status || "To Do";
					i === "To Do" ? h.todo++ : i === "In Progress" ? h.inProgress++ : i === "Review" ? h.review++ : i === "Done" && h.done++;
				} catch {
					h.todo++;
				}
			}
		} catch {}
		let g, _, v = 0, y = 0, b = 0, x;
		if (i) try {
			let e = m(t), n = await e.status();
			g = n.current || "detached", _ = n.isClean(), v = n.files.length, y = n.ahead || 0, b = n.behind || 0;
			let r = await e.log({ maxCount: 1 });
			r.latest && (x = {
				hash: r.latest.hash,
				message: r.latest.message,
				date: r.latest.date,
				author: r.latest.author_name
			});
		} catch {}
		let S, C = s.join(t, ".rag-index", "meta.json");
		if (u(C)) try {
			let e = await c.readFile(C, "utf-8"), t = JSON.parse(e);
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
		else (u(s.join(t, "scripts", "rag")) || f && f.docsRag) && (S = { ready: !1 });
		let w = {
			runningCount: 0,
			processes: []
		}, T = s.join(t, ".env-state", "processes.json");
		if (u(T)) try {
			let e = await c.readFile(T, "utf-8"), t = JSON.parse(e), n = [];
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
			w = {
				runningCount: n.length,
				processes: n
			};
		} catch {}
		let E = await N.isFavorite(t);
		return {
			name: o,
			path: t,
			description: l,
			version: d,
			favorite: E,
			hasBacklog: n,
			hasInfraConfig: r,
			hasGit: i,
			gitBranch: g,
			gitClean: _,
			gitAhead: y,
			gitBehind: b,
			uncommittedCount: v,
			lastCommit: x,
			taskCounts: h,
			ragStatus: S,
			processStatus: w,
			features: f,
			lastScannedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	} catch (t) {
		return console.error(`Error inspecting project at ${e}:`, t), null;
	}
}
async function F(e, t = 2) {
	let n = /* @__PURE__ */ new Map();
	async function r(e, i) {
		if (!(i > t)) try {
			if (!u(e) || !(await c.stat(e)).isDirectory()) return;
			let t = await P(e);
			if (t && (n.set(s.normalize(t.path).toLowerCase(), t), i > 0)) return;
			let a = await c.readdir(e, { withFileTypes: !0 });
			for (let t of a) if (t.isDirectory()) {
				let n = t.name.toLowerCase();
				if (ne.has(n) || n.startsWith(".")) continue;
				await r(s.join(e, t.name), i + 1);
			}
		} catch {}
	}
	for (let t of e) await r(s.normalize(t), 0);
	for (let e of n.values()) await N.addProject(e.path, !!e.favorite);
	return Array.from(n.values());
}
var re = new class {
	watcher = null;
	currentPath = null;
	debounceTimer = null;
	watch(e, t) {
		if (this.currentPath === e && this.watcher) return;
		this.unwatch();
		let n = s.join(e, "backlog", "tasks");
		if (!u(n)) return;
		this.currentPath = e, this.watcher = g.watch(n, {
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
}(), ie = "F:\\ProjectTemplate", I = /* @__PURE__ */ new Set([
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
async function L(e, t) {
	await c.mkdir(t, { recursive: !0 });
	let n = await c.readdir(e, { withFileTypes: !0 });
	for (let r of n) {
		let n = s.join(e, r.name), i = s.join(t, r.name), a = r.name.toLowerCase();
		I.has(a) || (r.isDirectory() ? await L(n, i) : r.isFile() && await c.copyFile(n, i));
	}
}
async function ae(e) {
	let t = e || ie;
	return {
		available: u(t),
		path: t
	};
}
async function oe(e) {
	let t = e.templateSource || ie;
	if (!u(t)) throw Error(`Директория шаблона не найдена: ${t}`);
	let n = s.normalize(e.targetDir);
	if (u(n)) {
		if ((await c.readdir(n)).length > 0) throw Error(`Целевая директория уже существует и не пуста: ${n}`);
	} else await c.mkdir(n, { recursive: !0 });
	await L(t, n);
	let r = s.join(n, "package.json");
	if (u(r)) try {
		let t = await c.readFile(r, "utf-8"), n = JSON.parse(t);
		n.name = e.name.toLowerCase().replace(/[^a-z0-9-_]/g, "-"), n.version = "0.1.0", n.description = `Проект ${e.name} на базе ProjectTemplate`, await c.writeFile(r, JSON.stringify(n, null, 2), "utf-8");
	} catch (e) {
		console.error("Failed to parametrize package.json:", e);
	}
	let i = s.join(n, "infra.config.json");
	if (u(i)) try {
		let t = await c.readFile(i, "utf-8"), n = JSON.parse(t);
		n.projectRoot = ".", n.features = {
			...n.features,
			...e.features
		}, await c.writeFile(i, JSON.stringify(n, null, 2), "utf-8");
	} catch (e) {
		console.error("Failed to parametrize infra.config.json:", e);
	}
	let a = s.join(n, "backlog", "config.yml");
	if (u(a)) try {
		let t = await c.readFile(a, "utf-8");
		t = t.replace(/project_name:\s*["']?([^"'\r\n]+)["']?/, `project_name: "${e.name}"`), await c.writeFile(a, t, "utf-8");
	} catch (e) {
		console.error("Failed to parametrize backlog/config.yml:", e);
	}
	if (e.initGit) try {
		await m(n).init();
	} catch (e) {
		console.error("Failed to init git:", e);
	}
	let o = s.join(n, "scripts", "setup.mjs");
	if (u(o)) try {
		await new Promise((e) => {
			let t = f(process.execPath, [o], {
				cwd: n,
				shell: !0
			});
			t.on("close", () => e()), t.on("error", () => e());
		});
	} catch (e) {
		console.error("Setup script execution warning:", e);
	}
	await N.addProject(n, !0);
	let l = await P(n);
	if (!l) throw Error("Не удалось проинспектировать созданный проект.");
	return l;
}
var se = new class {
	activeProcesses = /* @__PURE__ */ new Map();
	broadcastLog(e, n) {
		for (let r of t.getAllWindows()) r.isDestroyed() || r.webContents.send("process:logChunk", {
			processId: e,
			text: n
		});
	}
	broadcastStatus(e) {
		for (let n of t.getAllWindows()) n.isDestroyed() || n.webContents.send("process:statusChanged", e);
	}
	async startProcess(e, t, n) {
		let r = `${s.normalize(e)}::${n}`;
		if (this.activeProcesses.has(r)) {
			let e = this.activeProcesses.get(r);
			if (e.info.status === "running") return e.info;
		}
		let i = process.platform === "win32", a = f(i ? "powershell.exe" : "/bin/sh", i ? [
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
		}, c = {
			info: o,
			child: a,
			logBuffer: []
		};
		this.activeProcesses.set(r, c);
		let l = (e) => {
			let t = e.toString();
			c.logBuffer.push(t), c.logBuffer.length > 2e3 && c.logBuffer.shift(), this.broadcastLog(r, t);
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
			_(t.info.pid, "SIGKILL", (r) => {
				r ? (console.error(`Failed to kill process tree for ${e}:`, r), n(!1)) : (t.info.status = "stopped", this.broadcastStatus(t.info), n(!0));
			});
		}) : !1;
	}
	getLogs(e) {
		return this.activeProcesses.get(e)?.logBuffer || [];
	}
	async listProcessesForProject(e) {
		let t = s.normalize(e), n = [];
		for (let [e, r] of this.activeProcesses.entries()) s.normalize(r.info.cwd) === t && n.push(r.info);
		let r = s.join(t, ".env-state", "processes.json");
		if (u(r)) try {
			let e = await c.readFile(r, "utf-8"), i = JSON.parse(e);
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
		let r = `${s.normalize(e)}::${t}`, i = this.activeProcesses.get(r);
		if (i && i.logBuffer.length > 0) return i.logBuffer.slice(-n).join("");
		let a = s.join(e, ".env-state", "logs", `${t}.log`);
		if (u(a)) try {
			let e = await c.readFile(a, "utf-8");
			return e.charCodeAt(0) === 65279 && (e = e.slice(1)), e.split("\n").slice(-n).join("\n");
		} catch (e) {
			console.error(`Failed to tail log ${a}:`, e);
		}
		return "";
	}
	cleanupAll() {
		for (let [e, t] of this.activeProcesses.entries()) if (t.info.pid && t.info.status === "running") try {
			_(t.info.pid, "SIGKILL");
		} catch (t) {
			console.error(`Cleanup kill failed for ${e}:`, t);
		}
	}
}(), ce = /* @__PURE__ */ new Map(), R = [], z = (e, t, n) => {
	if (t && typeof t.init == "function" && typeof t.createInferenceSessionHandler == "function") {
		let r = ce.get(e);
		if (r === void 0) ce.set(e, {
			backend: t,
			priority: n
		});
		else if (r.priority > n) return;
		else if (r.priority === n && r.backend !== t) throw Error(`cannot register backend "${e}" using priority ${n}`);
		if (n >= 0) {
			let t = R.indexOf(e);
			t !== -1 && R.splice(t, 1);
			for (let t = 0; t < R.length; t++) if (ce.get(R[t]).priority <= n) {
				R.splice(t, 0, e);
				return;
			}
			R.push(e);
		}
		return;
	}
	throw TypeError("not a valid backend");
}, le = async (e) => {
	let t = ce.get(e);
	if (!t) return "backend not found.";
	if (t.initialized) return t.backend;
	if (t.aborted) return t.error;
	{
		let n = !!t.initPromise;
		try {
			return n || (t.initPromise = t.backend.init(e)), await t.initPromise, t.initialized = !0, t.backend;
		} catch (e) {
			return n || (t.error = `${e}`, t.aborted = !0), t.error;
		} finally {
			delete t.initPromise;
		}
	}
}, ue = async (e) => {
	let t = e.executionProviders || [], n = t.map((e) => typeof e == "string" ? e : e.name), r = n.length === 0 ? R : n, i, a = [], o = /* @__PURE__ */ new Set();
	for (let e of r) {
		let t = await le(e);
		typeof t == "string" ? a.push({
			name: e,
			err: t
		}) : (i ||= t, i === t && o.add(e));
	}
	if (!i) throw Error(`no available backend found. ERR: ${a.map((e) => `[${e.name}] ${e.err}`).join(", ")}`);
	for (let { name: e, err: t } of a) n.includes(e) && console.warn(`removing requested execution provider "${e}" from session options because it is not available: ${t}`);
	let s = t.filter((e) => o.has(typeof e == "string" ? e : e.name));
	return [i, new Proxy(e, { get: (e, t) => t === "executionProviders" ? s : Reflect.get(e, t) })];
}, de = "1.21.0", fe = "warning", B = {
	wasm: {},
	webgl: {},
	webgpu: {},
	versions: { common: de },
	set logLevel(e) {
		if (e !== void 0) {
			if (typeof e != "string" || [
				"verbose",
				"info",
				"warning",
				"error",
				"fatal"
			].indexOf(e) === -1) throw Error(`Unsupported logging level: ${e}`);
			fe = e;
		}
	},
	get logLevel() {
		return fe;
	}
};
Object.defineProperty(B, "logLevel", { enumerable: !0 });
//#endregion
//#region node_modules/onnxruntime-common/dist/esm/env.js
var V = B, H = (e, t) => {
	let n = typeof document < "u" ? document.createElement("canvas") : new OffscreenCanvas(1, 1);
	n.width = e.dims[3], n.height = e.dims[2];
	let r = n.getContext("2d");
	if (r != null) {
		let i, a;
		t?.tensorLayout !== void 0 && t.tensorLayout === "NHWC" ? (i = e.dims[2], a = e.dims[3]) : (i = e.dims[3], a = e.dims[2]);
		let o = t?.format === void 0 ? "RGB" : t.format, s = t?.norm, c, l;
		s === void 0 || s.mean === void 0 ? c = [
			255,
			255,
			255,
			255
		] : typeof s.mean == "number" ? c = [
			s.mean,
			s.mean,
			s.mean,
			s.mean
		] : (c = [
			s.mean[0],
			s.mean[1],
			s.mean[2],
			0
		], s.mean[3] !== void 0 && (c[3] = s.mean[3])), s === void 0 || s.bias === void 0 ? l = [
			0,
			0,
			0,
			0
		] : typeof s.bias == "number" ? l = [
			s.bias,
			s.bias,
			s.bias,
			s.bias
		] : (l = [
			s.bias[0],
			s.bias[1],
			s.bias[2],
			0
		], s.bias[3] !== void 0 && (l[3] = s.bias[3]));
		let u = a * i, d = 0, f = u, p = u * 2, m = -1;
		o === "RGBA" ? (d = 0, f = u, p = u * 2, m = u * 3) : o === "RGB" ? (d = 0, f = u, p = u * 2) : o === "RBG" && (d = 0, p = u, f = u * 2);
		for (let t = 0; t < a; t++) for (let n = 0; n < i; n++) {
			let i = (e.data[d++] - l[0]) * c[0], a = (e.data[f++] - l[1]) * c[1], o = (e.data[p++] - l[2]) * c[2], s = m === -1 ? 255 : (e.data[m++] - l[3]) * c[3];
			r.fillStyle = "rgba(" + i + "," + a + "," + o + "," + s + ")", r.fillRect(n, t, 1, 1);
		}
		if ("toDataURL" in n) return n.toDataURL();
		throw Error("toDataURL is not supported");
	}
	throw Error("Can not access image data");
}, U = (e, t) => {
	let n = typeof document < "u" ? document.createElement("canvas").getContext("2d") : new OffscreenCanvas(1, 1).getContext("2d"), r;
	if (n != null) {
		let i, a, o;
		t?.tensorLayout !== void 0 && t.tensorLayout === "NHWC" ? (i = e.dims[2], a = e.dims[1], o = e.dims[3]) : (i = e.dims[3], a = e.dims[2], o = e.dims[1]);
		let s = t === void 0 || t.format === void 0 ? "RGB" : t.format, c = t?.norm, l, u;
		c === void 0 || c.mean === void 0 ? l = [
			255,
			255,
			255,
			255
		] : typeof c.mean == "number" ? l = [
			c.mean,
			c.mean,
			c.mean,
			c.mean
		] : (l = [
			c.mean[0],
			c.mean[1],
			c.mean[2],
			255
		], c.mean[3] !== void 0 && (l[3] = c.mean[3])), c === void 0 || c.bias === void 0 ? u = [
			0,
			0,
			0,
			0
		] : typeof c.bias == "number" ? u = [
			c.bias,
			c.bias,
			c.bias,
			c.bias
		] : (u = [
			c.bias[0],
			c.bias[1],
			c.bias[2],
			0
		], c.bias[3] !== void 0 && (u[3] = c.bias[3]));
		let d = a * i;
		if (t !== void 0 && (t.format !== void 0 && o === 4 && t.format !== "RGBA" || o === 3 && t.format !== "RGB" && t.format !== "BGR")) throw Error("Tensor format doesn't match input tensor dims");
		let f = 0, p = 1, m = 2, h = 3, g = 0, _ = d, v = d * 2, y = -1;
		s === "RGBA" ? (g = 0, _ = d, v = d * 2, y = d * 3) : s === "RGB" ? (g = 0, _ = d, v = d * 2) : s === "RBG" && (g = 0, v = d, _ = d * 2), r = n.createImageData(i, a);
		for (let t = 0; t < a * i; f += 4, p += 4, m += 4, h += 4, t++) r.data[f] = (e.data[g++] - u[0]) * l[0], r.data[p] = (e.data[_++] - u[1]) * l[1], r.data[m] = (e.data[v++] - u[2]) * l[2], r.data[h] = y === -1 ? 255 : (e.data[y++] - u[3]) * l[3];
	} else throw Error("Can not access image data");
	return r;
}, W = (e, t) => {
	if (e === void 0) throw Error("Image buffer must be defined");
	if (t.height === void 0 || t.width === void 0) throw Error("Image height and width must be defined");
	if (t.tensorLayout === "NHWC") throw Error("NHWC Tensor layout is not supported yet");
	let { height: n, width: r } = t, i = t.norm ?? {
		mean: 255,
		bias: 0
	}, a, o;
	a = typeof i.mean == "number" ? [
		i.mean,
		i.mean,
		i.mean,
		i.mean
	] : [
		i.mean[0],
		i.mean[1],
		i.mean[2],
		i.mean[3] ?? 255
	], o = typeof i.bias == "number" ? [
		i.bias,
		i.bias,
		i.bias,
		i.bias
	] : [
		i.bias[0],
		i.bias[1],
		i.bias[2],
		i.bias[3] ?? 0
	];
	let s = t.format === void 0 ? "RGBA" : t.format, c = t.tensorFormat === void 0 || t.tensorFormat === void 0 ? "RGB" : t.tensorFormat, l = n * r, u = c === "RGBA" ? new Float32Array(l * 4) : new Float32Array(l * 3), d = 4, f = 0, p = 1, m = 2, h = 3, g = 0, _ = l, v = l * 2, y = -1;
	s === "RGB" && (d = 3, f = 0, p = 1, m = 2, h = -1), c === "RGBA" ? y = l * 3 : c === "RBG" ? (g = 0, v = l, _ = l * 2) : c === "BGR" && (v = 0, _ = l, g = l * 2);
	for (let t = 0; t < l; t++, f += d, m += d, p += d, h += d) u[g++] = (e[f] + o[0]) / a[0], u[_++] = (e[p] + o[1]) / a[1], u[v++] = (e[m] + o[2]) / a[2], y !== -1 && h !== -1 && (u[y++] = (e[h] + o[3]) / a[3]);
	return c === "RGBA" ? new xe("float32", u, [
		1,
		4,
		n,
		r
	]) : new xe("float32", u, [
		1,
		3,
		n,
		r
	]);
}, pe = async (e, t) => {
	let n = typeof HTMLImageElement < "u" && e instanceof HTMLImageElement, r = typeof ImageData < "u" && e instanceof ImageData, i = typeof ImageBitmap < "u" && e instanceof ImageBitmap, a = typeof e == "string", o, s = t ?? {}, c = () => {
		if (typeof document < "u") return document.createElement("canvas");
		if (typeof OffscreenCanvas < "u") return new OffscreenCanvas(1, 1);
		throw Error("Canvas is not supported");
	}, l = (e) => typeof HTMLCanvasElement < "u" && e instanceof HTMLCanvasElement || e instanceof OffscreenCanvas ? e.getContext("2d") : null;
	if (n) {
		let n = c();
		n.width = e.width, n.height = e.height;
		let r = l(n);
		if (r != null) {
			let n = e.height, i = e.width;
			if (t !== void 0 && t.resizedHeight !== void 0 && t.resizedWidth !== void 0 && (n = t.resizedHeight, i = t.resizedWidth), t !== void 0) {
				if (s = t, t.tensorFormat !== void 0) throw Error("Image input config format must be RGBA for HTMLImageElement");
				s.tensorFormat = "RGBA", s.height = n, s.width = i;
			} else s.tensorFormat = "RGBA", s.height = n, s.width = i;
			r.drawImage(e, 0, 0), o = r.getImageData(0, 0, i, n).data;
		} else throw Error("Can not access image data");
	} else if (r) {
		let n, r;
		if (t !== void 0 && t.resizedWidth !== void 0 && t.resizedHeight !== void 0 ? (n = t.resizedHeight, r = t.resizedWidth) : (n = e.height, r = e.width), t !== void 0 && (s = t), s.format = "RGBA", s.height = n, s.width = r, t !== void 0) {
			let t = c();
			t.width = r, t.height = n;
			let i = l(t);
			if (i != null) i.putImageData(e, 0, 0), o = i.getImageData(0, 0, r, n).data;
			else throw Error("Can not access image data");
		} else o = e.data;
	} else if (i) {
		if (t === void 0) throw Error("Please provide image config with format for Imagebitmap");
		let n = c();
		n.width = e.width, n.height = e.height;
		let r = l(n);
		if (r != null) {
			let t = e.height, n = e.width;
			return r.drawImage(e, 0, 0, n, t), o = r.getImageData(0, 0, n, t).data, s.height = t, s.width = n, W(o, s);
		}
		throw Error("Can not access image data");
	} else if (a) return new Promise((t, n) => {
		let r = c(), i = l(r);
		if (!e || !i) return n();
		let a = new Image();
		a.crossOrigin = "Anonymous", a.src = e, a.onload = () => {
			r.width = a.width, r.height = a.height, i.drawImage(a, 0, 0, r.width, r.height);
			let e = i.getImageData(0, 0, r.width, r.height);
			s.height = r.height, s.width = r.width, t(W(e.data, s));
		};
	});
	else throw Error("Input data provided is not supported - aborted tensor creation");
	if (o !== void 0) return W(o, s);
	throw Error("Input data provided is not supported - aborted tensor creation");
}, G = (e, t) => {
	let { width: n, height: r, download: i, dispose: a } = t;
	return new xe({
		location: "texture",
		type: "float32",
		texture: e,
		dims: [
			1,
			r,
			n,
			4
		],
		download: i,
		dispose: a
	});
}, me = (e, t) => {
	let { dataType: n, dims: r, download: i, dispose: a } = t;
	return new xe({
		location: "gpu-buffer",
		type: n ?? "float32",
		gpuBuffer: e,
		dims: r,
		download: i,
		dispose: a
	});
}, K = (e, t) => {
	let { dataType: n, dims: r, download: i, dispose: a } = t;
	return new xe({
		location: "ml-tensor",
		type: n ?? "float32",
		mlTensor: e,
		dims: r,
		download: i,
		dispose: a
	});
}, he = (e, t, n) => new xe({
	location: "cpu-pinned",
	type: e,
	data: t,
	dims: n ?? [t.length]
}), q = /* @__PURE__ */ new Map([
	["float32", Float32Array],
	["uint8", Uint8Array],
	["int8", Int8Array],
	["uint16", Uint16Array],
	["int16", Int16Array],
	["int32", Int32Array],
	["bool", Uint8Array],
	["float64", Float64Array],
	["uint32", Uint32Array],
	["int4", Uint8Array],
	["uint4", Uint8Array]
]), ge = /* @__PURE__ */ new Map([
	[Float32Array, "float32"],
	[Uint8Array, "uint8"],
	[Int8Array, "int8"],
	[Uint16Array, "uint16"],
	[Int16Array, "int16"],
	[Int32Array, "int32"],
	[Float64Array, "float64"],
	[Uint32Array, "uint32"]
]), _e = !1, ve = () => {
	if (!_e) {
		_e = !0;
		let e = typeof BigInt64Array < "u" && BigInt64Array.from, t = typeof BigUint64Array < "u" && BigUint64Array.from, n = globalThis.Float16Array, r = n !== void 0 && n.from;
		e && (q.set("int64", BigInt64Array), ge.set(BigInt64Array, "int64")), t && (q.set("uint64", BigUint64Array), ge.set(BigUint64Array, "uint64")), r ? (q.set("float16", n), ge.set(n, "float16")) : q.set("float16", Uint16Array);
	}
}, ye = (e) => {
	let t = 1;
	for (let n = 0; n < e.length; n++) {
		let r = e[n];
		if (typeof r != "number" || !Number.isSafeInteger(r)) throw TypeError(`dims[${n}] must be an integer, got: ${r}`);
		if (r < 0) throw RangeError(`dims[${n}] must be a non-negative integer, got: ${r}`);
		t *= r;
	}
	return t;
}, be = (e, t) => {
	switch (e.location) {
		case "cpu": return new xe(e.type, e.data, t);
		case "cpu-pinned": return new xe({
			location: "cpu-pinned",
			data: e.data,
			type: e.type,
			dims: t
		});
		case "texture": return new xe({
			location: "texture",
			texture: e.texture,
			type: e.type,
			dims: t
		});
		case "gpu-buffer": return new xe({
			location: "gpu-buffer",
			gpuBuffer: e.gpuBuffer,
			type: e.type,
			dims: t
		});
		case "ml-tensor": return new xe({
			location: "ml-tensor",
			mlTensor: e.mlTensor,
			type: e.type,
			dims: t
		});
		default: throw Error(`tensorReshape: tensor location ${e.location} is not supported`);
	}
}, xe = class {
	constructor(e, t, n) {
		ve();
		let r, i;
		if (typeof e == "object" && "location" in e) switch (this.dataLocation = e.location, r = e.type, i = e.dims, e.location) {
			case "cpu-pinned": {
				let t = q.get(r);
				if (!t) throw TypeError(`unsupported type "${r}" to create tensor from pinned buffer`);
				if (!(e.data instanceof t)) throw TypeError(`buffer should be of type ${t.name}`);
				this.cpuData = e.data;
				break;
			}
			case "texture":
				if (r !== "float32") throw TypeError(`unsupported type "${r}" to create tensor from texture`);
				this.gpuTextureData = e.texture, this.downloader = e.download, this.disposer = e.dispose;
				break;
			case "gpu-buffer":
				if (r !== "float32" && r !== "float16" && r !== "int32" && r !== "int64" && r !== "uint32" && r !== "uint8" && r !== "bool" && r !== "uint4" && r !== "int4") throw TypeError(`unsupported type "${r}" to create tensor from gpu buffer`);
				this.gpuBufferData = e.gpuBuffer, this.downloader = e.download, this.disposer = e.dispose;
				break;
			case "ml-tensor":
				if (r !== "float32" && r !== "float16" && r !== "int32" && r !== "int64" && r !== "uint32" && r !== "uint64" && r !== "int8" && r !== "uint8" && r !== "bool" && r !== "uint4" && r !== "int4") throw TypeError(`unsupported type "${r}" to create tensor from MLTensor`);
				this.mlTensorData = e.mlTensor, this.downloader = e.download, this.disposer = e.dispose;
				break;
			default: throw Error(`Tensor constructor: unsupported location '${this.dataLocation}'`);
		}
		else {
			let a, o;
			if (typeof e == "string") {
				if (r = e, o = n, e === "string") {
					if (!Array.isArray(t)) throw TypeError("A string tensor's data must be a string array.");
					a = t;
				} else {
					let n = q.get(e);
					if (n === void 0) throw TypeError(`Unsupported tensor type: ${e}.`);
					if (Array.isArray(t)) {
						if (e === "float16" && n === Uint16Array || e === "uint4" || e === "int4") throw TypeError(`Creating a ${e} tensor from number array is not supported. Please use ${n.name} as data.`);
						a = e === "uint64" || e === "int64" ? n.from(t, BigInt) : n.from(t);
					} else if (t instanceof n) a = t;
					else if (t instanceof Uint8ClampedArray) {
						if (e === "uint8") a = Uint8Array.from(t);
						else throw TypeError("A Uint8ClampedArray tensor's data must be type of uint8");
					} else if (e === "float16" && t instanceof Uint16Array && n !== Uint16Array) a = new globalThis.Float16Array(t.buffer, t.byteOffset, t.length);
					else throw TypeError(`A ${r} tensor's data must be type of ${n}`);
				}
			} else if (o = t, Array.isArray(e)) {
				if (e.length === 0) throw TypeError("Tensor type cannot be inferred from an empty array.");
				let t = typeof e[0];
				if (t === "string") r = "string", a = e;
				else if (t === "boolean") r = "bool", a = Uint8Array.from(e);
				else throw TypeError(`Invalid element type of data array: ${t}.`);
			} else if (e instanceof Uint8ClampedArray) r = "uint8", a = Uint8Array.from(e);
			else {
				let t = ge.get(e.constructor);
				if (t === void 0) throw TypeError(`Unsupported type for tensor data: ${e.constructor}.`);
				r = t, a = e;
			}
			if (o === void 0) o = [a.length];
			else if (!Array.isArray(o)) throw TypeError("A tensor's dims must be a number array");
			i = o, this.cpuData = a, this.dataLocation = "cpu";
		}
		let a = ye(i);
		if (this.cpuData && a !== this.cpuData.length && (r !== "uint4" && r !== "int4" || Math.ceil(a / 2) !== this.cpuData.length)) throw Error(`Tensor's size(${a}) does not match data length(${this.cpuData.length}).`);
		this.type = r, this.dims = i, this.size = a;
	}
	static async fromImage(e, t) {
		return pe(e, t);
	}
	static fromTexture(e, t) {
		return G(e, t);
	}
	static fromGpuBuffer(e, t) {
		return me(e, t);
	}
	static fromMLTensor(e, t) {
		return K(e, t);
	}
	static fromPinnedBuffer(e, t, n) {
		return he(e, t, n);
	}
	toDataURL(e) {
		return H(this, e);
	}
	toImageData(e) {
		return U(this, e);
	}
	get data() {
		if (this.ensureValid(), !this.cpuData) throw Error("The data is not on CPU. Use `getData()` to download GPU data to CPU, or use `texture` or `gpuBuffer` property to access the GPU data directly.");
		return this.cpuData;
	}
	get location() {
		return this.dataLocation;
	}
	get texture() {
		if (this.ensureValid(), !this.gpuTextureData) throw Error("The data is not stored as a WebGL texture.");
		return this.gpuTextureData;
	}
	get gpuBuffer() {
		if (this.ensureValid(), !this.gpuBufferData) throw Error("The data is not stored as a WebGPU buffer.");
		return this.gpuBufferData;
	}
	get mlTensor() {
		if (this.ensureValid(), !this.mlTensorData) throw Error("The data is not stored as a WebNN MLTensor.");
		return this.mlTensorData;
	}
	async getData(e) {
		switch (this.ensureValid(), this.dataLocation) {
			case "cpu":
			case "cpu-pinned": return this.data;
			case "texture":
			case "gpu-buffer":
			case "ml-tensor":
				if (!this.downloader) throw Error("The current tensor is not created with a specified data downloader.");
				if (this.isDownloading) throw Error("The current tensor is being downloaded.");
				try {
					this.isDownloading = !0;
					let t = await this.downloader();
					return this.downloader = void 0, this.dataLocation = "cpu", this.cpuData = t, e && this.disposer && (this.disposer(), this.disposer = void 0), t;
				} finally {
					this.isDownloading = !1;
				}
			default: throw Error(`cannot get data from location: ${this.dataLocation}`);
		}
	}
	dispose() {
		if (this.isDownloading) throw Error("The current tensor is being downloaded.");
		this.disposer &&= (this.disposer(), void 0), this.cpuData = void 0, this.gpuTextureData = void 0, this.gpuBufferData = void 0, this.mlTensorData = void 0, this.downloader = void 0, this.isDownloading = void 0, this.dataLocation = "none";
	}
	ensureValid() {
		if (this.dataLocation === "none") throw Error("The tensor is disposed.");
	}
	reshape(e) {
		if (this.ensureValid(), this.downloader || this.disposer) throw Error("Cannot reshape a tensor that owns GPU resource.");
		return be(this, e);
	}
}, Se = xe, Ce = (e, t) => {
	(B.trace === void 0 ? !B.wasm.trace : !B.trace) || console.timeStamp(`${e}::ORT::${t}`);
}, we = (e, t) => {
	let n = (/* @__PURE__ */ Error()).stack?.split(/\r\n|\r|\n/g) || [], r = !1;
	for (let i = 0; i < n.length; i++) {
		if (r && !n[i].includes("TRACE_FUNC")) {
			let r = `FUNC_${e}::${n[i].trim().split(" ")[1]}`;
			t && (r += `::${t}`), Ce("CPU", r);
			return;
		}
		n[i].includes("TRACE_FUNC") && (r = !0);
	}
}, Te = (e) => {
	(B.trace === void 0 ? !B.wasm.trace : !B.trace) || we("BEGIN", e);
}, Ee = (e) => {
	(B.trace === void 0 ? !B.wasm.trace : !B.trace) || we("END", e);
}, De = class e {
	constructor(e) {
		this.handler = e;
	}
	async run(e, t, n) {
		Te();
		let r = {}, i = {};
		if (typeof e != "object" || !e || e instanceof Se || Array.isArray(e)) throw TypeError("'feeds' must be an object that use input names as keys and OnnxValue as corresponding values.");
		let a = !0;
		if (typeof t == "object") {
			if (t === null) throw TypeError("Unexpected argument[1]: cannot be null.");
			if (t instanceof Se) throw TypeError("'fetches' cannot be a Tensor");
			if (Array.isArray(t)) {
				if (t.length === 0) throw TypeError("'fetches' cannot be an empty array.");
				a = !1;
				for (let e of t) {
					if (typeof e != "string") throw TypeError("'fetches' must be a string array or an object.");
					if (this.outputNames.indexOf(e) === -1) throw RangeError(`'fetches' contains invalid output name: ${e}.`);
					r[e] = null;
				}
				if (typeof n == "object" && n) i = n;
				else if (n !== void 0) throw TypeError("'options' must be an object.");
			} else {
				let e = !1, o = Object.getOwnPropertyNames(t);
				for (let n of this.outputNames) if (o.indexOf(n) !== -1) {
					let i = t[n];
					(i === null || i instanceof Se) && (e = !0, a = !1, r[n] = i);
				}
				if (e) {
					if (typeof n == "object" && n) i = n;
					else if (n !== void 0) throw TypeError("'options' must be an object.");
				} else i = t;
			}
		} else if (t !== void 0) throw TypeError("Unexpected argument[1]: must be 'fetches' or 'options'.");
		for (let t of this.inputNames) if (e[t] === void 0) throw Error(`input '${t}' is missing in 'feeds'.`);
		if (a) for (let e of this.outputNames) r[e] = null;
		let o = await this.handler.run(e, r, i), s = {};
		for (let e in o) if (Object.hasOwnProperty.call(o, e)) {
			let t = o[e];
			s[e] = t instanceof Se ? t : new Se(t.type, t.data, t.dims);
		}
		return Ee(), s;
	}
	async release() {
		return this.handler.dispose();
	}
	static async create(t, n, r, i) {
		Te();
		let a, o = {};
		if (typeof t == "string") {
			if (a = t, typeof n == "object" && n) o = n;
			else if (n !== void 0) throw TypeError("'options' must be an object.");
		} else if (t instanceof Uint8Array) {
			if (a = t, typeof n == "object" && n) o = n;
			else if (n !== void 0) throw TypeError("'options' must be an object.");
		} else if (t instanceof ArrayBuffer || typeof SharedArrayBuffer < "u" && t instanceof SharedArrayBuffer) {
			let e = t, s = 0, c = t.byteLength;
			if (typeof n == "object" && n) o = n;
			else if (typeof n == "number") {
				if (s = n, !Number.isSafeInteger(s)) throw RangeError("'byteOffset' must be an integer.");
				if (s < 0 || s >= e.byteLength) throw RangeError(`'byteOffset' is out of range [0, ${e.byteLength}).`);
				if (c = t.byteLength - s, typeof r == "number") {
					if (c = r, !Number.isSafeInteger(c)) throw RangeError("'byteLength' must be an integer.");
					if (c <= 0 || s + c > e.byteLength) throw RangeError(`'byteLength' is out of range (0, ${e.byteLength - s}].`);
					if (typeof i == "object" && i) o = i;
					else if (i !== void 0) throw TypeError("'options' must be an object.");
				} else if (r !== void 0) throw TypeError("'byteLength' must be a number.");
			} else if (n !== void 0) throw TypeError("'options' must be an object.");
			a = new Uint8Array(e, s, c);
		} else throw TypeError("Unexpected argument[0]: must be 'path' or 'buffer'.");
		let [s, c] = await ue(o), l = await s.createInferenceSessionHandler(a, c);
		return Ee(), new e(l);
	}
	startProfiling() {
		this.handler.startProfiling();
	}
	endProfiling() {
		this.handler.endProfiling();
	}
	get inputNames() {
		return this.handler.inputNames;
	}
	get outputNames() {
		return this.handler.outputNames;
	}
}, Oe = /* @__PURE__ */ k({
	InferenceSession: () => De,
	TRACE: () => Ce,
	TRACE_FUNC_BEGIN: () => Te,
	TRACE_FUNC_END: () => Ee,
	Tensor: () => Se,
	env: () => V,
	registerBackend: () => z
}), ke = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.resolveBackendAndExecutionProviders = e.registerBackend = void 0;
	var t = /* @__PURE__ */ new Map(), n = [];
	e.registerBackend = (e, r, i) => {
		if (r && typeof r.init == "function" && typeof r.createInferenceSessionHandler == "function") {
			let a = t.get(e);
			if (a === void 0) t.set(e, {
				backend: r,
				priority: i
			});
			else if (a.priority > i) return;
			else if (a.priority === i && a.backend !== r) throw Error(`cannot register backend "${e}" using priority ${i}`);
			if (i >= 0) {
				let r = n.indexOf(e);
				r !== -1 && n.splice(r, 1);
				for (let r = 0; r < n.length; r++) if (t.get(n[r]).priority <= i) {
					n.splice(r, 0, e);
					return;
				}
				n.push(e);
			}
			return;
		}
		throw TypeError("not a valid backend");
	};
	var r = async (e) => {
		let n = t.get(e);
		if (!n) return "backend not found.";
		if (n.initialized) return n.backend;
		if (n.aborted) return n.error;
		{
			let t = !!n.initPromise;
			try {
				return t || (n.initPromise = n.backend.init(e)), await n.initPromise, n.initialized = !0, n.backend;
			} catch (e) {
				return t || (n.error = `${e}`, n.aborted = !0), n.error;
			} finally {
				delete n.initPromise;
			}
		}
	};
	e.resolveBackendAndExecutionProviders = async (e) => {
		let t = e.executionProviders || [], i = t.map((e) => typeof e == "string" ? e : e.name), a = i.length === 0 ? n : i, o, s = [], c = /* @__PURE__ */ new Set();
		for (let e of a) {
			let t = await r(e);
			typeof t == "string" ? s.push({
				name: e,
				err: t
			}) : (o ||= t, o === t && c.add(e));
		}
		if (!o) throw Error(`no available backend found. ERR: ${s.map((e) => `[${e.name}] ${e.err}`).join(", ")}`);
		for (let { name: e, err: t } of s) i.includes(e) && console.warn(`removing requested execution provider "${e}" from session options because it is not available: ${t}`);
		let l = t.filter((e) => c.has(typeof e == "string" ? e : e.name));
		return [o, new Proxy(e, { get: (e, t) => t === "executionProviders" ? l : Reflect.get(e, t) })];
	};
})), Ae = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.registerBackend = void 0;
	var t = ke();
	Object.defineProperty(e, "registerBackend", {
		enumerable: !0,
		get: function() {
			return t.registerBackend;
		}
	});
})), je = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.version = void 0, e.version = "1.21.0";
})), Me = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.env = void 0;
	var t = je(), n = "warning";
	e.env = {
		wasm: {},
		webgl: {},
		webgpu: {},
		versions: { common: t.version },
		set logLevel(e) {
			if (e !== void 0) {
				if (typeof e != "string" || [
					"verbose",
					"info",
					"warning",
					"error",
					"fatal"
				].indexOf(e) === -1) throw Error(`Unsupported logging level: ${e}`);
				n = e;
			}
		},
		get logLevel() {
			return n;
		}
	}, Object.defineProperty(e.env, "logLevel", { enumerable: !0 });
})), J = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.env = void 0, e.env = Me().env;
})), Ne = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.tensorToImageData = e.tensorToDataURL = void 0, e.tensorToDataURL = (e, t) => {
		let n = typeof document < "u" ? document.createElement("canvas") : new OffscreenCanvas(1, 1);
		n.width = e.dims[3], n.height = e.dims[2];
		let r = n.getContext("2d");
		if (r != null) {
			let i, a;
			t?.tensorLayout !== void 0 && t.tensorLayout === "NHWC" ? (i = e.dims[2], a = e.dims[3]) : (i = e.dims[3], a = e.dims[2]);
			let o = t?.format === void 0 ? "RGB" : t.format, s = t?.norm, c, l;
			s === void 0 || s.mean === void 0 ? c = [
				255,
				255,
				255,
				255
			] : typeof s.mean == "number" ? c = [
				s.mean,
				s.mean,
				s.mean,
				s.mean
			] : (c = [
				s.mean[0],
				s.mean[1],
				s.mean[2],
				0
			], s.mean[3] !== void 0 && (c[3] = s.mean[3])), s === void 0 || s.bias === void 0 ? l = [
				0,
				0,
				0,
				0
			] : typeof s.bias == "number" ? l = [
				s.bias,
				s.bias,
				s.bias,
				s.bias
			] : (l = [
				s.bias[0],
				s.bias[1],
				s.bias[2],
				0
			], s.bias[3] !== void 0 && (l[3] = s.bias[3]));
			let u = a * i, d = 0, f = u, p = u * 2, m = -1;
			o === "RGBA" ? (d = 0, f = u, p = u * 2, m = u * 3) : o === "RGB" ? (d = 0, f = u, p = u * 2) : o === "RBG" && (d = 0, p = u, f = u * 2);
			for (let t = 0; t < a; t++) for (let n = 0; n < i; n++) {
				let i = (e.data[d++] - l[0]) * c[0], a = (e.data[f++] - l[1]) * c[1], o = (e.data[p++] - l[2]) * c[2], s = m === -1 ? 255 : (e.data[m++] - l[3]) * c[3];
				r.fillStyle = "rgba(" + i + "," + a + "," + o + "," + s + ")", r.fillRect(n, t, 1, 1);
			}
			if ("toDataURL" in n) return n.toDataURL();
			throw Error("toDataURL is not supported");
		}
		throw Error("Can not access image data");
	}, e.tensorToImageData = (e, t) => {
		let n = typeof document < "u" ? document.createElement("canvas").getContext("2d") : new OffscreenCanvas(1, 1).getContext("2d"), r;
		if (n != null) {
			let i, a, o;
			t?.tensorLayout !== void 0 && t.tensorLayout === "NHWC" ? (i = e.dims[2], a = e.dims[1], o = e.dims[3]) : (i = e.dims[3], a = e.dims[2], o = e.dims[1]);
			let s = t === void 0 || t.format === void 0 ? "RGB" : t.format, c = t?.norm, l, u;
			c === void 0 || c.mean === void 0 ? l = [
				255,
				255,
				255,
				255
			] : typeof c.mean == "number" ? l = [
				c.mean,
				c.mean,
				c.mean,
				c.mean
			] : (l = [
				c.mean[0],
				c.mean[1],
				c.mean[2],
				255
			], c.mean[3] !== void 0 && (l[3] = c.mean[3])), c === void 0 || c.bias === void 0 ? u = [
				0,
				0,
				0,
				0
			] : typeof c.bias == "number" ? u = [
				c.bias,
				c.bias,
				c.bias,
				c.bias
			] : (u = [
				c.bias[0],
				c.bias[1],
				c.bias[2],
				0
			], c.bias[3] !== void 0 && (u[3] = c.bias[3]));
			let d = a * i;
			if (t !== void 0 && (t.format !== void 0 && o === 4 && t.format !== "RGBA" || o === 3 && t.format !== "RGB" && t.format !== "BGR")) throw Error("Tensor format doesn't match input tensor dims");
			let f = 0, p = 1, m = 2, h = 3, g = 0, _ = d, v = d * 2, y = -1;
			s === "RGBA" ? (g = 0, _ = d, v = d * 2, y = d * 3) : s === "RGB" ? (g = 0, _ = d, v = d * 2) : s === "RBG" && (g = 0, v = d, _ = d * 2), r = n.createImageData(i, a);
			for (let t = 0; t < a * i; f += 4, p += 4, m += 4, h += 4, t++) r.data[f] = (e.data[g++] - u[0]) * l[0], r.data[p] = (e.data[_++] - u[1]) * l[1], r.data[m] = (e.data[v++] - u[2]) * l[2], r.data[h] = y === -1 ? 255 : (e.data[y++] - u[3]) * l[3];
		} else throw Error("Can not access image data");
		return r;
	};
})), Pe = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.tensorFromPinnedBuffer = e.tensorFromMLTensor = e.tensorFromGpuBuffer = e.tensorFromTexture = e.tensorFromImage = e.bufferToTensor = void 0;
	var t = Y();
	e.bufferToTensor = (e, n) => {
		if (e === void 0) throw Error("Image buffer must be defined");
		if (n.height === void 0 || n.width === void 0) throw Error("Image height and width must be defined");
		if (n.tensorLayout === "NHWC") throw Error("NHWC Tensor layout is not supported yet");
		let { height: r, width: i } = n, a = n.norm ?? {
			mean: 255,
			bias: 0
		}, o, s;
		o = typeof a.mean == "number" ? [
			a.mean,
			a.mean,
			a.mean,
			a.mean
		] : [
			a.mean[0],
			a.mean[1],
			a.mean[2],
			a.mean[3] ?? 255
		], s = typeof a.bias == "number" ? [
			a.bias,
			a.bias,
			a.bias,
			a.bias
		] : [
			a.bias[0],
			a.bias[1],
			a.bias[2],
			a.bias[3] ?? 0
		];
		let c = n.format === void 0 ? "RGBA" : n.format, l = n.tensorFormat === void 0 || n.tensorFormat === void 0 ? "RGB" : n.tensorFormat, u = r * i, d = l === "RGBA" ? new Float32Array(u * 4) : new Float32Array(u * 3), f = 4, p = 0, m = 1, h = 2, g = 3, _ = 0, v = u, y = u * 2, b = -1;
		c === "RGB" && (f = 3, p = 0, m = 1, h = 2, g = -1), l === "RGBA" ? b = u * 3 : l === "RBG" ? (_ = 0, y = u, v = u * 2) : l === "BGR" && (y = 0, v = u, _ = u * 2);
		for (let t = 0; t < u; t++, p += f, h += f, m += f, g += f) d[_++] = (e[p] + s[0]) / o[0], d[v++] = (e[m] + s[1]) / o[1], d[y++] = (e[h] + s[2]) / o[2], b !== -1 && g !== -1 && (d[b++] = (e[g] + s[3]) / o[3]);
		return l === "RGBA" ? new t.Tensor("float32", d, [
			1,
			4,
			r,
			i
		]) : new t.Tensor("float32", d, [
			1,
			3,
			r,
			i
		]);
	}, e.tensorFromImage = async (t, n) => {
		let r = typeof HTMLImageElement < "u" && t instanceof HTMLImageElement, i = typeof ImageData < "u" && t instanceof ImageData, a = typeof ImageBitmap < "u" && t instanceof ImageBitmap, o = typeof t == "string", s, c = n ?? {}, l = () => {
			if (typeof document < "u") return document.createElement("canvas");
			if (typeof OffscreenCanvas < "u") return new OffscreenCanvas(1, 1);
			throw Error("Canvas is not supported");
		}, u = (e) => typeof HTMLCanvasElement < "u" && e instanceof HTMLCanvasElement || e instanceof OffscreenCanvas ? e.getContext("2d") : null;
		if (r) {
			let e = l();
			e.width = t.width, e.height = t.height;
			let r = u(e);
			if (r != null) {
				let e = t.height, i = t.width;
				if (n !== void 0 && n.resizedHeight !== void 0 && n.resizedWidth !== void 0 && (e = n.resizedHeight, i = n.resizedWidth), n !== void 0) {
					if (c = n, n.tensorFormat !== void 0) throw Error("Image input config format must be RGBA for HTMLImageElement");
					c.tensorFormat = "RGBA", c.height = e, c.width = i;
				} else c.tensorFormat = "RGBA", c.height = e, c.width = i;
				r.drawImage(t, 0, 0), s = r.getImageData(0, 0, i, e).data;
			} else throw Error("Can not access image data");
		} else if (i) {
			let e, r;
			if (n !== void 0 && n.resizedWidth !== void 0 && n.resizedHeight !== void 0 ? (e = n.resizedHeight, r = n.resizedWidth) : (e = t.height, r = t.width), n !== void 0 && (c = n), c.format = "RGBA", c.height = e, c.width = r, n !== void 0) {
				let n = l();
				n.width = r, n.height = e;
				let i = u(n);
				if (i != null) i.putImageData(t, 0, 0), s = i.getImageData(0, 0, r, e).data;
				else throw Error("Can not access image data");
			} else s = t.data;
		} else if (a) {
			if (n === void 0) throw Error("Please provide image config with format for Imagebitmap");
			let r = l();
			r.width = t.width, r.height = t.height;
			let i = u(r);
			if (i != null) {
				let n = t.height, r = t.width;
				return i.drawImage(t, 0, 0, r, n), s = i.getImageData(0, 0, r, n).data, c.height = n, c.width = r, (0, e.bufferToTensor)(s, c);
			}
			throw Error("Can not access image data");
		} else if (o) return new Promise((n, r) => {
			let i = l(), a = u(i);
			if (!t || !a) return r();
			let o = new Image();
			o.crossOrigin = "Anonymous", o.src = t, o.onload = () => {
				i.width = o.width, i.height = o.height, a.drawImage(o, 0, 0, i.width, i.height);
				let t = a.getImageData(0, 0, i.width, i.height);
				c.height = i.height, c.width = i.width, n((0, e.bufferToTensor)(t.data, c));
			};
		});
		else throw Error("Input data provided is not supported - aborted tensor creation");
		if (s !== void 0) return (0, e.bufferToTensor)(s, c);
		throw Error("Input data provided is not supported - aborted tensor creation");
	}, e.tensorFromTexture = (e, n) => {
		let { width: r, height: i, download: a, dispose: o } = n, s = [
			1,
			i,
			r,
			4
		];
		return new t.Tensor({
			location: "texture",
			type: "float32",
			texture: e,
			dims: s,
			download: a,
			dispose: o
		});
	}, e.tensorFromGpuBuffer = (e, n) => {
		let { dataType: r, dims: i, download: a, dispose: o } = n;
		return new t.Tensor({
			location: "gpu-buffer",
			type: r ?? "float32",
			gpuBuffer: e,
			dims: i,
			download: a,
			dispose: o
		});
	}, e.tensorFromMLTensor = (e, n) => {
		let { dataType: r, dims: i, download: a, dispose: o } = n;
		return new t.Tensor({
			location: "ml-tensor",
			type: r ?? "float32",
			mlTensor: e,
			dims: i,
			download: a,
			dispose: o
		});
	}, e.tensorFromPinnedBuffer = (e, n, r) => new t.Tensor({
		location: "cpu-pinned",
		type: e,
		data: n,
		dims: r ?? [n.length]
	});
})), Fe = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.checkTypedArray = e.NUMERIC_TENSOR_TYPEDARRAY_TO_TYPE_MAP = e.NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP = void 0, e.NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP = /* @__PURE__ */ new Map([
		["float32", Float32Array],
		["uint8", Uint8Array],
		["int8", Int8Array],
		["uint16", Uint16Array],
		["int16", Int16Array],
		["int32", Int32Array],
		["bool", Uint8Array],
		["float64", Float64Array],
		["uint32", Uint32Array],
		["int4", Uint8Array],
		["uint4", Uint8Array]
	]), e.NUMERIC_TENSOR_TYPEDARRAY_TO_TYPE_MAP = /* @__PURE__ */ new Map([
		[Float32Array, "float32"],
		[Uint8Array, "uint8"],
		[Int8Array, "int8"],
		[Uint16Array, "uint16"],
		[Int16Array, "int16"],
		[Int32Array, "int32"],
		[Float64Array, "float64"],
		[Uint32Array, "uint32"]
	]);
	var t = !1;
	e.checkTypedArray = () => {
		if (!t) {
			t = !0;
			let n = typeof BigInt64Array < "u" && BigInt64Array.from, r = typeof BigUint64Array < "u" && BigUint64Array.from, i = globalThis.Float16Array, a = i !== void 0 && i.from;
			n && (e.NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP.set("int64", BigInt64Array), e.NUMERIC_TENSOR_TYPEDARRAY_TO_TYPE_MAP.set(BigInt64Array, "int64")), r && (e.NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP.set("uint64", BigUint64Array), e.NUMERIC_TENSOR_TYPEDARRAY_TO_TYPE_MAP.set(BigUint64Array, "uint64")), a ? (e.NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP.set("float16", i), e.NUMERIC_TENSOR_TYPEDARRAY_TO_TYPE_MAP.set(i, "float16")) : e.NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP.set("float16", Uint16Array);
		}
	};
})), Ie = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.tensorReshape = e.calculateSize = void 0;
	var t = Y();
	e.calculateSize = (e) => {
		let t = 1;
		for (let n = 0; n < e.length; n++) {
			let r = e[n];
			if (typeof r != "number" || !Number.isSafeInteger(r)) throw TypeError(`dims[${n}] must be an integer, got: ${r}`);
			if (r < 0) throw RangeError(`dims[${n}] must be a non-negative integer, got: ${r}`);
			t *= r;
		}
		return t;
	}, e.tensorReshape = (e, n) => {
		switch (e.location) {
			case "cpu": return new t.Tensor(e.type, e.data, n);
			case "cpu-pinned": return new t.Tensor({
				location: "cpu-pinned",
				data: e.data,
				type: e.type,
				dims: n
			});
			case "texture": return new t.Tensor({
				location: "texture",
				texture: e.texture,
				type: e.type,
				dims: n
			});
			case "gpu-buffer": return new t.Tensor({
				location: "gpu-buffer",
				gpuBuffer: e.gpuBuffer,
				type: e.type,
				dims: n
			});
			case "ml-tensor": return new t.Tensor({
				location: "ml-tensor",
				mlTensor: e.mlTensor,
				type: e.type,
				dims: n
			});
			default: throw Error(`tensorReshape: tensor location ${e.location} is not supported`);
		}
	};
})), Y = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.Tensor = void 0;
	var t = Ne(), n = Pe(), r = Fe(), i = Ie();
	e.Tensor = class {
		constructor(e, t, n) {
			(0, r.checkTypedArray)();
			let a, o;
			if (typeof e == "object" && "location" in e) switch (this.dataLocation = e.location, a = e.type, o = e.dims, e.location) {
				case "cpu-pinned": {
					let t = r.NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP.get(a);
					if (!t) throw TypeError(`unsupported type "${a}" to create tensor from pinned buffer`);
					if (!(e.data instanceof t)) throw TypeError(`buffer should be of type ${t.name}`);
					this.cpuData = e.data;
					break;
				}
				case "texture":
					if (a !== "float32") throw TypeError(`unsupported type "${a}" to create tensor from texture`);
					this.gpuTextureData = e.texture, this.downloader = e.download, this.disposer = e.dispose;
					break;
				case "gpu-buffer":
					if (a !== "float32" && a !== "float16" && a !== "int32" && a !== "int64" && a !== "uint32" && a !== "uint8" && a !== "bool" && a !== "uint4" && a !== "int4") throw TypeError(`unsupported type "${a}" to create tensor from gpu buffer`);
					this.gpuBufferData = e.gpuBuffer, this.downloader = e.download, this.disposer = e.dispose;
					break;
				case "ml-tensor":
					if (a !== "float32" && a !== "float16" && a !== "int32" && a !== "int64" && a !== "uint32" && a !== "uint64" && a !== "int8" && a !== "uint8" && a !== "bool" && a !== "uint4" && a !== "int4") throw TypeError(`unsupported type "${a}" to create tensor from MLTensor`);
					this.mlTensorData = e.mlTensor, this.downloader = e.download, this.disposer = e.dispose;
					break;
				default: throw Error(`Tensor constructor: unsupported location '${this.dataLocation}'`);
			}
			else {
				let i, s;
				if (typeof e == "string") {
					if (a = e, s = n, e === "string") {
						if (!Array.isArray(t)) throw TypeError("A string tensor's data must be a string array.");
						i = t;
					} else {
						let n = r.NUMERIC_TENSOR_TYPE_TO_TYPEDARRAY_MAP.get(e);
						if (n === void 0) throw TypeError(`Unsupported tensor type: ${e}.`);
						if (Array.isArray(t)) {
							if (e === "float16" && n === Uint16Array || e === "uint4" || e === "int4") throw TypeError(`Creating a ${e} tensor from number array is not supported. Please use ${n.name} as data.`);
							i = e === "uint64" || e === "int64" ? n.from(t, BigInt) : n.from(t);
						} else if (t instanceof n) i = t;
						else if (t instanceof Uint8ClampedArray) {
							if (e === "uint8") i = Uint8Array.from(t);
							else throw TypeError("A Uint8ClampedArray tensor's data must be type of uint8");
						} else if (e === "float16" && t instanceof Uint16Array && n !== Uint16Array) i = new globalThis.Float16Array(t.buffer, t.byteOffset, t.length);
						else throw TypeError(`A ${a} tensor's data must be type of ${n}`);
					}
				} else if (s = t, Array.isArray(e)) {
					if (e.length === 0) throw TypeError("Tensor type cannot be inferred from an empty array.");
					let t = typeof e[0];
					if (t === "string") a = "string", i = e;
					else if (t === "boolean") a = "bool", i = Uint8Array.from(e);
					else throw TypeError(`Invalid element type of data array: ${t}.`);
				} else if (e instanceof Uint8ClampedArray) a = "uint8", i = Uint8Array.from(e);
				else {
					let t = r.NUMERIC_TENSOR_TYPEDARRAY_TO_TYPE_MAP.get(e.constructor);
					if (t === void 0) throw TypeError(`Unsupported type for tensor data: ${e.constructor}.`);
					a = t, i = e;
				}
				if (s === void 0) s = [i.length];
				else if (!Array.isArray(s)) throw TypeError("A tensor's dims must be a number array");
				o = s, this.cpuData = i, this.dataLocation = "cpu";
			}
			let s = (0, i.calculateSize)(o);
			if (this.cpuData && s !== this.cpuData.length && (a !== "uint4" && a !== "int4" || Math.ceil(s / 2) !== this.cpuData.length)) throw Error(`Tensor's size(${s}) does not match data length(${this.cpuData.length}).`);
			this.type = a, this.dims = o, this.size = s;
		}
		static async fromImage(e, t) {
			return (0, n.tensorFromImage)(e, t);
		}
		static fromTexture(e, t) {
			return (0, n.tensorFromTexture)(e, t);
		}
		static fromGpuBuffer(e, t) {
			return (0, n.tensorFromGpuBuffer)(e, t);
		}
		static fromMLTensor(e, t) {
			return (0, n.tensorFromMLTensor)(e, t);
		}
		static fromPinnedBuffer(e, t, r) {
			return (0, n.tensorFromPinnedBuffer)(e, t, r);
		}
		toDataURL(e) {
			return (0, t.tensorToDataURL)(this, e);
		}
		toImageData(e) {
			return (0, t.tensorToImageData)(this, e);
		}
		get data() {
			if (this.ensureValid(), !this.cpuData) throw Error("The data is not on CPU. Use `getData()` to download GPU data to CPU, or use `texture` or `gpuBuffer` property to access the GPU data directly.");
			return this.cpuData;
		}
		get location() {
			return this.dataLocation;
		}
		get texture() {
			if (this.ensureValid(), !this.gpuTextureData) throw Error("The data is not stored as a WebGL texture.");
			return this.gpuTextureData;
		}
		get gpuBuffer() {
			if (this.ensureValid(), !this.gpuBufferData) throw Error("The data is not stored as a WebGPU buffer.");
			return this.gpuBufferData;
		}
		get mlTensor() {
			if (this.ensureValid(), !this.mlTensorData) throw Error("The data is not stored as a WebNN MLTensor.");
			return this.mlTensorData;
		}
		async getData(e) {
			switch (this.ensureValid(), this.dataLocation) {
				case "cpu":
				case "cpu-pinned": return this.data;
				case "texture":
				case "gpu-buffer":
				case "ml-tensor":
					if (!this.downloader) throw Error("The current tensor is not created with a specified data downloader.");
					if (this.isDownloading) throw Error("The current tensor is being downloaded.");
					try {
						this.isDownloading = !0;
						let t = await this.downloader();
						return this.downloader = void 0, this.dataLocation = "cpu", this.cpuData = t, e && this.disposer && (this.disposer(), this.disposer = void 0), t;
					} finally {
						this.isDownloading = !1;
					}
				default: throw Error(`cannot get data from location: ${this.dataLocation}`);
			}
		}
		dispose() {
			if (this.isDownloading) throw Error("The current tensor is being downloaded.");
			this.disposer &&= (this.disposer(), void 0), this.cpuData = void 0, this.gpuTextureData = void 0, this.gpuBufferData = void 0, this.mlTensorData = void 0, this.downloader = void 0, this.isDownloading = void 0, this.dataLocation = "none";
		}
		ensureValid() {
			if (this.dataLocation === "none") throw Error("The tensor is disposed.");
		}
		reshape(e) {
			if (this.ensureValid(), this.downloader || this.disposer) throw Error("Cannot reshape a tensor that owns GPU resource.");
			return (0, i.tensorReshape)(this, e);
		}
	};
})), Le = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.Tensor = void 0, e.Tensor = Y().Tensor;
})), Re = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.TRACE_FUNC_END = e.TRACE_FUNC_BEGIN = e.TRACE = void 0;
	var t = Me();
	e.TRACE = (e, n) => {
		(t.env.trace === void 0 ? !t.env.wasm.trace : !t.env.trace) || console.timeStamp(`${e}::ORT::${n}`);
	};
	var n = (t, n) => {
		let r = (/* @__PURE__ */ Error()).stack?.split(/\r\n|\r|\n/g) || [], i = !1;
		for (let a = 0; a < r.length; a++) {
			if (i && !r[a].includes("TRACE_FUNC")) {
				let i = `FUNC_${t}::${r[a].trim().split(" ")[1]}`;
				n && (i += `::${n}`), (0, e.TRACE)("CPU", i);
				return;
			}
			r[a].includes("TRACE_FUNC") && (i = !0);
		}
	};
	e.TRACE_FUNC_BEGIN = (e) => {
		(t.env.trace === void 0 ? !t.env.wasm.trace : !t.env.trace) || n("BEGIN", e);
	}, e.TRACE_FUNC_END = (e) => {
		(t.env.trace === void 0 ? !t.env.wasm.trace : !t.env.trace) || n("END", e);
	};
})), ze = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.InferenceSession = void 0;
	var t = ke(), n = Le(), r = Re();
	e.InferenceSession = class e {
		constructor(e) {
			this.handler = e;
		}
		async run(e, t, i) {
			(0, r.TRACE_FUNC_BEGIN)();
			let a = {}, o = {};
			if (typeof e != "object" || !e || e instanceof n.Tensor || Array.isArray(e)) throw TypeError("'feeds' must be an object that use input names as keys and OnnxValue as corresponding values.");
			let s = !0;
			if (typeof t == "object") {
				if (t === null) throw TypeError("Unexpected argument[1]: cannot be null.");
				if (t instanceof n.Tensor) throw TypeError("'fetches' cannot be a Tensor");
				if (Array.isArray(t)) {
					if (t.length === 0) throw TypeError("'fetches' cannot be an empty array.");
					s = !1;
					for (let e of t) {
						if (typeof e != "string") throw TypeError("'fetches' must be a string array or an object.");
						if (this.outputNames.indexOf(e) === -1) throw RangeError(`'fetches' contains invalid output name: ${e}.`);
						a[e] = null;
					}
					if (typeof i == "object" && i) o = i;
					else if (i !== void 0) throw TypeError("'options' must be an object.");
				} else {
					let e = !1, r = Object.getOwnPropertyNames(t);
					for (let i of this.outputNames) if (r.indexOf(i) !== -1) {
						let r = t[i];
						(r === null || r instanceof n.Tensor) && (e = !0, s = !1, a[i] = r);
					}
					if (e) {
						if (typeof i == "object" && i) o = i;
						else if (i !== void 0) throw TypeError("'options' must be an object.");
					} else o = t;
				}
			} else if (t !== void 0) throw TypeError("Unexpected argument[1]: must be 'fetches' or 'options'.");
			for (let t of this.inputNames) if (e[t] === void 0) throw Error(`input '${t}' is missing in 'feeds'.`);
			if (s) for (let e of this.outputNames) a[e] = null;
			let c = await this.handler.run(e, a, o), l = {};
			for (let e in c) if (Object.hasOwnProperty.call(c, e)) {
				let t = c[e];
				l[e] = t instanceof n.Tensor ? t : new n.Tensor(t.type, t.data, t.dims);
			}
			return (0, r.TRACE_FUNC_END)(), l;
		}
		async release() {
			return this.handler.dispose();
		}
		static async create(n, i, a, o) {
			(0, r.TRACE_FUNC_BEGIN)();
			let s, c = {};
			if (typeof n == "string") {
				if (s = n, typeof i == "object" && i) c = i;
				else if (i !== void 0) throw TypeError("'options' must be an object.");
			} else if (n instanceof Uint8Array) {
				if (s = n, typeof i == "object" && i) c = i;
				else if (i !== void 0) throw TypeError("'options' must be an object.");
			} else if (n instanceof ArrayBuffer || typeof SharedArrayBuffer < "u" && n instanceof SharedArrayBuffer) {
				let e = n, t = 0, r = n.byteLength;
				if (typeof i == "object" && i) c = i;
				else if (typeof i == "number") {
					if (t = i, !Number.isSafeInteger(t)) throw RangeError("'byteOffset' must be an integer.");
					if (t < 0 || t >= e.byteLength) throw RangeError(`'byteOffset' is out of range [0, ${e.byteLength}).`);
					if (r = n.byteLength - t, typeof a == "number") {
						if (r = a, !Number.isSafeInteger(r)) throw RangeError("'byteLength' must be an integer.");
						if (r <= 0 || t + r > e.byteLength) throw RangeError(`'byteLength' is out of range (0, ${e.byteLength - t}].`);
						if (typeof o == "object" && o) c = o;
						else if (o !== void 0) throw TypeError("'options' must be an object.");
					} else if (a !== void 0) throw TypeError("'byteLength' must be a number.");
				} else if (i !== void 0) throw TypeError("'options' must be an object.");
				s = new Uint8Array(e, t, r);
			} else throw TypeError("Unexpected argument[0]: must be 'path' or 'buffer'.");
			let [l, u] = await (0, t.resolveBackendAndExecutionProviders)(c), d = await l.createInferenceSessionHandler(s, u);
			return (0, r.TRACE_FUNC_END)(), new e(d);
		}
		startProfiling() {
			this.handler.startProfiling();
		}
		endProfiling() {
			this.handler.endProfiling();
		}
		get inputNames() {
			return this.handler.inputNames;
		}
		get outputNames() {
			return this.handler.outputNames;
		}
	};
})), Be = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.InferenceSession = void 0, e.InferenceSession = ze().InferenceSession;
})), Ve = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
})), He = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
})), Ue = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
})), We = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 });
})), Ge = /* @__PURE__ */ O(((e) => {
	var t = e && e.__createBinding || (Object.create ? (function(e, t, n, r) {
		r === void 0 && (r = n);
		var i = Object.getOwnPropertyDescriptor(t, n);
		(!i || ("get" in i ? !t.__esModule : i.writable || i.configurable)) && (i = {
			enumerable: !0,
			get: function() {
				return t[n];
			}
		}), Object.defineProperty(e, r, i);
	}) : (function(e, t, n, r) {
		r === void 0 && (r = n), e[r] = t[n];
	})), n = e && e.__exportStar || function(e, n) {
		for (var r in e) r !== "default" && !Object.prototype.hasOwnProperty.call(n, r) && t(n, e, r);
	};
	Object.defineProperty(e, "__esModule", { value: !0 }), n(Ae(), e), n(J(), e), n(Be(), e), n(Le(), e), n(Ve(), e), n(He(), e), n(Re(), e), n(Ue(), e), n(We(), e);
})), Ke = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.initOrt = e.binding = void 0;
	var t = Ge();
	e.binding = j(`../bin/napi-v3/${process.platform}/${process.arch}/onnxruntime_binding.node`);
	var n = !1;
	e.initOrt = () => {
		if (!n) {
			n = !0;
			let r = 2;
			if (t.env.logLevel) switch (t.env.logLevel) {
				case "verbose":
					r = 0;
					break;
				case "info":
					r = 1;
					break;
				case "warning":
					r = 2;
					break;
				case "error":
					r = 3;
					break;
				case "fatal":
					r = 4;
					break;
				default: throw Error(`Unsupported log level: ${t.env.logLevel}`);
			}
			e.binding.initOrtOnce(r, t.Tensor);
		}
	};
})), qe = /* @__PURE__ */ O(((e) => {
	var t = e && e.__classPrivateFieldSet || function(e, t, n, r, i) {
		if (r === "m") throw TypeError("Private method is not writable");
		if (r === "a" && !i) throw TypeError("Private accessor was defined without a setter");
		if (typeof t == "function" ? e !== t || !i : !t.has(e)) throw TypeError("Cannot write private member to an object whose class did not declare it");
		return r === "a" ? i.call(e, n) : i ? i.value = n : t.set(e, n), n;
	}, n = e && e.__classPrivateFieldGet || function(e, t, n, r) {
		if (n === "a" && !r) throw TypeError("Private accessor was defined without a getter");
		if (typeof t == "function" ? e !== t || !r : !t.has(e)) throw TypeError("Cannot read private member from an object whose class did not declare it");
		return n === "m" ? r : n === "a" ? r.call(e) : r ? r.value : t.get(e);
	}, r;
	Object.defineProperty(e, "__esModule", { value: !0 }), e.listSupportedBackends = e.onnxruntimeBackend = void 0;
	var i = Ke(), a = class {
		constructor(e, a) {
			r.set(this, void 0), (0, i.initOrt)(), t(this, r, new i.binding.InferenceSession(), "f"), typeof e == "string" ? n(this, r, "f").loadModel(e, a) : n(this, r, "f").loadModel(e.buffer, e.byteOffset, e.byteLength, a), this.inputNames = n(this, r, "f").inputNames, this.outputNames = n(this, r, "f").outputNames;
		}
		async dispose() {
			n(this, r, "f").dispose();
		}
		startProfiling() {}
		endProfiling() {
			n(this, r, "f").endProfiling();
		}
		async run(e, t, i) {
			return new Promise((a, o) => {
				setImmediate(() => {
					try {
						a(n(this, r, "f").run(e, t, i));
					} catch (e) {
						o(e);
					}
				});
			});
		}
	};
	r = /* @__PURE__ */ new WeakMap(), e.onnxruntimeBackend = new class {
		async init() {
			return Promise.resolve();
		}
		async createInferenceSessionHandler(e, t) {
			return new Promise((n, r) => {
				setImmediate(() => {
					try {
						n(new a(e, t || {}));
					} catch (e) {
						r(e);
					}
				});
			});
		}
	}(), e.listSupportedBackends = i.binding.listSupportedBackends;
})), Je = /* @__PURE__ */ O(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.version = void 0, e.version = "1.21.0";
})), Ye = /* @__PURE__ */ O(((e) => {
	var t = e && e.__createBinding || (Object.create ? (function(e, t, n, r) {
		r === void 0 && (r = n);
		var i = Object.getOwnPropertyDescriptor(t, n);
		(!i || ("get" in i ? !t.__esModule : i.writable || i.configurable)) && (i = {
			enumerable: !0,
			get: function() {
				return t[n];
			}
		}), Object.defineProperty(e, r, i);
	}) : (function(e, t, n, r) {
		r === void 0 && (r = n), e[r] = t[n];
	})), n = e && e.__exportStar || function(e, n) {
		for (var r in e) r !== "default" && !Object.prototype.hasOwnProperty.call(n, r) && t(n, e, r);
	};
	Object.defineProperty(e, "__esModule", { value: !0 }), e.listSupportedBackends = void 0, n(Ge(), e);
	var r = qe();
	Object.defineProperty(e, "listSupportedBackends", {
		enumerable: !0,
		get: function() {
			return r.listSupportedBackends;
		}
	});
	var i = Ge(), a = Je(), o = qe(), s = (0, o.listSupportedBackends)();
	for (let e of s) (0, i.registerBackend)(e.name, o.onnxruntimeBackend, 100);
	Object.defineProperty(i.env.versions, "node", {
		value: a.version,
		enumerable: !0
	});
})), Xe = /* @__PURE__ */ O(((e, t) => {
	var n = (e) => e != null;
	t.exports = {
		defined: n,
		object: (e) => typeof e == "object",
		plainObject: (e) => Object.prototype.toString.call(e) === "[object Object]",
		fn: (e) => typeof e == "function",
		bool: (e) => typeof e == "boolean",
		buffer: (e) => e instanceof Buffer,
		typedArray: (e) => {
			if (n(e)) switch (e.constructor) {
				case Uint8Array:
				case Uint8ClampedArray:
				case Int8Array:
				case Uint16Array:
				case Int16Array:
				case Uint32Array:
				case Int32Array:
				case Float32Array:
				case Float64Array: return !0;
			}
			return !1;
		},
		arrayBuffer: (e) => e instanceof ArrayBuffer,
		string: (e) => typeof e == "string" && e.length > 0,
		number: (e) => typeof e == "number" && !Number.isNaN(e),
		integer: (e) => Number.isInteger(e),
		inRange: (e, t, n) => e >= t && e <= n,
		inArray: (e, t) => t.includes(e),
		invalidParameterError: (e, t, n) => /* @__PURE__ */ Error(`Expected ${t} for ${e} but received ${n} of type ${typeof n}`),
		nativeError: (e, t) => (t.message = e.message, t)
	};
})), Ze = /* @__PURE__ */ O(((e, t) => {
	var n = () => process.platform === "linux", r = null;
	t.exports = {
		isLinux: n,
		getReport: () => {
			if (!r) {
				/* istanbul ignore next */
				if (n() && process.report) {
					let e = process.report.excludeNetwork;
					process.report.excludeNetwork = !0, r = process.report.getReport(), process.report.excludeNetwork = e;
				} else r = {};
			}
			return r;
		}
	};
})), Qe = /* @__PURE__ */ O(((e, t) => {
	var n = j("fs"), r = "/usr/bin/ldd", i = "/proc/self/exe", a = 2048;
	t.exports = {
		LDD_PATH: r,
		SELF_PATH: i,
		readFileSync: (e) => {
			let t = n.openSync(e, "r"), r = Buffer.alloc(a), i = n.readSync(t, r, 0, a, 0);
			return n.close(t, () => {}), r.subarray(0, i);
		},
		readFile: (e) => new Promise((t, r) => {
			n.open(e, "r", (e, i) => {
				if (e) r(e);
				else {
					let e = Buffer.alloc(a);
					n.read(i, e, 0, a, 0, (r, a) => {
						t(e.subarray(0, a)), n.close(i, () => {});
					});
				}
			});
		})
	};
})), $e = /* @__PURE__ */ O(((e, t) => {
	t.exports = { interpreterPath: (e) => {
		if (e.length < 64 || e.readUInt32BE(0) !== 2135247942 || e.readUInt8(4) !== 2 || e.readUInt8(5) !== 1) return null;
		let t = e.readUInt32LE(32), n = e.readUInt16LE(54), r = e.readUInt16LE(56);
		for (let i = 0; i < r; i++) {
			let r = t + i * n;
			if (e.readUInt32LE(r) === 3) {
				let t = e.readUInt32LE(r + 8), n = e.readUInt32LE(r + 32);
				return e.subarray(t, t + n).toString().replace(/\0.*$/g, "");
			}
		}
		return null;
	} };
})), et = /* @__PURE__ */ O(((e, t) => {
	var n = j("child_process"), { isLinux: r, getReport: i } = Ze(), { LDD_PATH: a, SELF_PATH: o, readFile: s, readFileSync: c } = Qe(), { interpreterPath: l } = $e(), u, d, f, p = "getconf GNU_LIBC_VERSION 2>&1 || true; ldd --version 2>&1 || true", m = "", h = () => m || new Promise((e) => {
		n.exec(p, (t, n) => {
			m = t ? " " : n, e(m);
		});
	}), g = () => {
		if (!m) try {
			m = n.execSync(p, { encoding: "utf8" });
		} catch {
			m = " ";
		}
		return m;
	}, _ = "glibc", v = /LIBC[a-z0-9 \-).]*?(\d+\.\d+)/i, y = "musl", b = (e) => e.includes("libc.musl-") || e.includes("ld-musl-"), x = () => {
		let e = i();
		return e.header && e.header.glibcVersionRuntime ? _ : Array.isArray(e.sharedObjects) && e.sharedObjects.some(b) ? y : null;
	}, S = (e) => {
		let [t, n] = e.split(/[\r\n]+/);
		return t && t.includes(_) ? _ : n && n.includes(y) ? y : null;
	}, C = (e) => {
		if (e) {
			if (e.includes("/ld-musl-")) return y;
			if (e.includes("/ld-linux-")) return _;
		}
		return null;
	}, w = (e) => (e = e.toString(), e.includes("musl") ? y : e.includes("GNU C Library") ? _ : null), T = async () => {
		if (d !== void 0) return d;
		d = null;
		try {
			d = w(await s(a));
		} catch {}
		return d;
	}, E = () => {
		if (d !== void 0) return d;
		d = null;
		try {
			d = w(c(a));
		} catch {}
		return d;
	}, D = async () => {
		if (u !== void 0) return u;
		u = null;
		try {
			u = C(l(await s(o)));
		} catch {}
		return u;
	}, O = () => {
		if (u !== void 0) return u;
		u = null;
		try {
			u = C(l(c(o)));
		} catch {}
		return u;
	}, k = async () => {
		let e = null;
		return r() && (e = await D(), e || (e = await T(), e ||= x(), e ||= S(await h()))), e;
	}, A = () => {
		let e = null;
		return r() && (e = O(), e || (e = E(), e ||= x(), e ||= S(g()))), e;
	}, ee = async () => r() && await k() !== _, te = () => r() && A() !== _, M = async () => {
		if (f !== void 0) return f;
		f = null;
		try {
			let e = (await s(a)).match(v);
			e && (f = e[1]);
		} catch {}
		return f;
	}, N = () => {
		if (f !== void 0) return f;
		f = null;
		try {
			let e = c(a).match(v);
			e && (f = e[1]);
		} catch {}
		return f;
	}, ne = () => {
		let e = i();
		return e.header && e.header.glibcVersionRuntime ? e.header.glibcVersionRuntime : null;
	}, P = (e) => e.trim().split(/\s+/)[1], F = (e) => {
		let [t, n, r] = e.split(/[\r\n]+/);
		return t && t.includes(_) ? P(t) : n && r && n.includes(y) ? P(r) : null;
	};
	t.exports = {
		GLIBC: _,
		MUSL: y,
		family: k,
		familySync: A,
		isNonGlibcLinux: ee,
		isNonGlibcLinuxSync: te,
		version: async () => {
			let e = null;
			return r() && (e = await M(), e ||= ne(), e ||= F(await h())), e;
		},
		versionSync: () => {
			let e = null;
			return r() && (e = N(), e ||= ne(), e ||= F(g())), e;
		}
	};
})), tt = /* @__PURE__ */ O(((e, t) => {
	t.exports = typeof process == "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...e) => console.error("SEMVER", ...e) : () => {};
})), nt = /* @__PURE__ */ O(((e, t) => {
	t.exports = {
		MAX_LENGTH: 256,
		MAX_SAFE_COMPONENT_LENGTH: 16,
		MAX_SAFE_BUILD_LENGTH: 250,
		MAX_SAFE_INTEGER: 2 ** 53 - 1 || 
		/* istanbul ignore next */ 9007199254740991,
		RELEASE_TYPES: [
			"major",
			"premajor",
			"minor",
			"preminor",
			"patch",
			"prepatch",
			"prerelease"
		],
		SEMVER_SPEC_VERSION: "2.0.0",
		FLAG_INCLUDE_PRERELEASE: 1,
		FLAG_LOOSE: 2
	};
})), rt = /* @__PURE__ */ O(((e, t) => {
	var { MAX_SAFE_COMPONENT_LENGTH: n, MAX_SAFE_BUILD_LENGTH: r, MAX_LENGTH: i } = nt(), a = tt();
	e = t.exports = {};
	var o = e.re = [], s = e.safeRe = [], c = e.src = [], l = e.safeSrc = [], u = e.t = {}, d = 0, f = "[a-zA-Z0-9-]", p = [
		["\\s", 1],
		["\\d", i],
		[f, r]
	], m = (e) => {
		for (let [t, n] of p) e = e.split(`${t}*`).join(`${t}{0,${n}}`).split(`${t}+`).join(`${t}{1,${n}}`);
		return e;
	}, h = (e, t, n) => {
		let r = m(t), i = d++;
		a(e, i, t), u[e] = i, c[i] = t, l[i] = r, o[i] = new RegExp(t, n ? "g" : void 0), s[i] = new RegExp(r, n ? "g" : void 0);
	};
	h("NUMERICIDENTIFIER", "0|[1-9]\\d*"), h("NUMERICIDENTIFIERLOOSE", "\\d+"), h("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${f}*`), h("MAINVERSION", `(${c[u.NUMERICIDENTIFIER]})\\.(${c[u.NUMERICIDENTIFIER]})\\.(${c[u.NUMERICIDENTIFIER]})`), h("MAINVERSIONLOOSE", `(${c[u.NUMERICIDENTIFIERLOOSE]})\\.(${c[u.NUMERICIDENTIFIERLOOSE]})\\.(${c[u.NUMERICIDENTIFIERLOOSE]})`), h("PRERELEASEIDENTIFIER", `(?:${c[u.NONNUMERICIDENTIFIER]}|${c[u.NUMERICIDENTIFIER]})`), h("PRERELEASEIDENTIFIERLOOSE", `(?:${c[u.NONNUMERICIDENTIFIER]}|${c[u.NUMERICIDENTIFIERLOOSE]})`), h("PRERELEASE", `(?:-(${c[u.PRERELEASEIDENTIFIER]}(?:\\.${c[u.PRERELEASEIDENTIFIER]})*))`), h("PRERELEASELOOSE", `(?:-?(${c[u.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${c[u.PRERELEASEIDENTIFIERLOOSE]})*))`), h("BUILDIDENTIFIER", `${f}+`), h("BUILD", `(?:\\+(${c[u.BUILDIDENTIFIER]}(?:\\.${c[u.BUILDIDENTIFIER]})*))`), h("FULLPLAIN", `v?${c[u.MAINVERSION]}${c[u.PRERELEASE]}?${c[u.BUILD]}?`), h("FULL", `^${c[u.FULLPLAIN]}$`), h("LOOSEPLAIN", `[v=\\s]*${c[u.MAINVERSIONLOOSE]}${c[u.PRERELEASELOOSE]}?${c[u.BUILD]}?`), h("LOOSE", `^${c[u.LOOSEPLAIN]}$`), h("GTLT", "((?:<|>)?=?)"), h("XRANGEIDENTIFIERLOOSE", `${c[u.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`), h("XRANGEIDENTIFIER", `${c[u.NUMERICIDENTIFIER]}|x|X|\\*`), h("XRANGEPLAIN", `[v=\\s]*(${c[u.XRANGEIDENTIFIER]})(?:\\.(${c[u.XRANGEIDENTIFIER]})(?:\\.(${c[u.XRANGEIDENTIFIER]})(?:${c[u.PRERELEASE]})?${c[u.BUILD]}?)?)?`), h("XRANGEPLAINLOOSE", `[v=\\s]*(${c[u.XRANGEIDENTIFIERLOOSE]})(?:\\.(${c[u.XRANGEIDENTIFIERLOOSE]})(?:\\.(${c[u.XRANGEIDENTIFIERLOOSE]})(?:${c[u.PRERELEASELOOSE]})?${c[u.BUILD]}?)?)?`), h("XRANGE", `^${c[u.GTLT]}\\s*${c[u.XRANGEPLAIN]}$`), h("XRANGELOOSE", `^${c[u.GTLT]}\\s*${c[u.XRANGEPLAINLOOSE]}$`), h("COERCEPLAIN", `(^|[^\\d])(\\d{1,${n}})(?:\\.(\\d{1,${n}}))?(?:\\.(\\d{1,${n}}))?`), h("COERCE", `${c[u.COERCEPLAIN]}(?:$|[^\\d])`), h("COERCEFULL", c[u.COERCEPLAIN] + `(?:${c[u.PRERELEASE]})?(?:${c[u.BUILD]})?(?:$|[^\\d])`), h("COERCERTL", c[u.COERCE], !0), h("COERCERTLFULL", c[u.COERCEFULL], !0), h("LONETILDE", "(?:~>?)"), h("TILDETRIM", `(\\s*)${c[u.LONETILDE]}\\s+`, !0), e.tildeTrimReplace = "$1~", h("TILDE", `^${c[u.LONETILDE]}${c[u.XRANGEPLAIN]}$`), h("TILDELOOSE", `^${c[u.LONETILDE]}${c[u.XRANGEPLAINLOOSE]}$`), h("LONECARET", "(?:\\^)"), h("CARETTRIM", `(\\s*)${c[u.LONECARET]}\\s+`, !0), e.caretTrimReplace = "$1^", h("CARET", `^${c[u.LONECARET]}${c[u.XRANGEPLAIN]}$`), h("CARETLOOSE", `^${c[u.LONECARET]}${c[u.XRANGEPLAINLOOSE]}$`), h("COMPARATORLOOSE", `^${c[u.GTLT]}\\s*(${c[u.LOOSEPLAIN]})$|^$`), h("COMPARATOR", `^${c[u.GTLT]}\\s*(${c[u.FULLPLAIN]})$|^$`), h("COMPARATORTRIM", `(\\s*)${c[u.GTLT]}\\s*(${c[u.LOOSEPLAIN]}|${c[u.XRANGEPLAIN]})`, !0), e.comparatorTrimReplace = "$1$2$3", h("HYPHENRANGE", `^\\s*(${c[u.XRANGEPLAIN]})\\s+-\\s+(${c[u.XRANGEPLAIN]})\\s*$`), h("HYPHENRANGELOOSE", `^\\s*(${c[u.XRANGEPLAINLOOSE]})\\s+-\\s+(${c[u.XRANGEPLAINLOOSE]})\\s*$`), h("STAR", "(<|>)?=?\\s*\\*"), h("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$"), h("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
})), it = /* @__PURE__ */ O(((e, t) => {
	var n = Object.freeze({ loose: !0 }), r = Object.freeze({});
	t.exports = (e) => e ? typeof e == "object" ? e : n : r;
})), at = /* @__PURE__ */ O(((e, t) => {
	var n = /^[0-9]+$/, r = (e, t) => {
		if (typeof e == "number" && typeof t == "number") return e === t ? 0 : e < t ? -1 : 1;
		let r = n.test(e), i = n.test(t);
		return r && i && (e = +e, t = +t), e === t ? 0 : r && !i ? -1 : i && !r ? 1 : e < t ? -1 : 1;
	};
	t.exports = {
		compareIdentifiers: r,
		rcompareIdentifiers: (e, t) => r(t, e)
	};
})), ot = /* @__PURE__ */ O(((e, t) => {
	var n = tt(), { MAX_LENGTH: r, MAX_SAFE_INTEGER: i } = nt(), { safeRe: a, t: o } = rt(), s = it(), { compareIdentifiers: c } = at(), l = (e, t) => {
		let n = t.split(".");
		if (n.length > e.length) return !1;
		for (let t = 0; t < n.length; t++) if (c(e[t], n[t]) !== 0) return !1;
		return !0;
	};
	t.exports = class e {
		constructor(t, c) {
			if (c = s(c), t instanceof e) {
				if (t.loose === !!c.loose && t.includePrerelease === !!c.includePrerelease) return t;
				t = t.version;
			} else if (typeof t != "string") throw TypeError(`Invalid version. Must be a string. Got type "${typeof t}".`);
			if (t.length > r) throw TypeError(`version is longer than ${r} characters`);
			n("SemVer", t, c), this.options = c, this.loose = !!c.loose, this.includePrerelease = !!c.includePrerelease;
			let l = t.trim().match(c.loose ? a[o.LOOSE] : a[o.FULL]);
			if (!l) throw TypeError(`Invalid Version: ${t}`);
			if (this.raw = t, this.major = +l[1], this.minor = +l[2], this.patch = +l[3], this.major > i || this.major < 0) throw TypeError("Invalid major version");
			if (this.minor > i || this.minor < 0) throw TypeError("Invalid minor version");
			if (this.patch > i || this.patch < 0) throw TypeError("Invalid patch version");
			this.prerelease = l[4] ? l[4].split(".").map((e) => {
				if (/^[0-9]+$/.test(e)) {
					let t = +e;
					if (t >= 0 && t < i) return t;
				}
				return e;
			}) : [], this.build = l[5] ? l[5].split(".") : [], this.format();
		}
		format() {
			return this.version = `${this.major}.${this.minor}.${this.patch}`, this.prerelease.length && (this.version += `-${this.prerelease.join(".")}`), this.version;
		}
		toString() {
			return this.version;
		}
		compare(t) {
			if (n("SemVer.compare", this.version, this.options, t), !(t instanceof e)) {
				if (typeof t == "string" && t === this.version) return 0;
				t = new e(t, this.options);
			}
			return t.version === this.version ? 0 : this.compareMain(t) || this.comparePre(t);
		}
		compareMain(t) {
			return t instanceof e || (t = new e(t, this.options)), this.major < t.major ? -1 : this.major > t.major ? 1 : this.minor < t.minor ? -1 : this.minor > t.minor ? 1 : this.patch < t.patch ? -1 : +(this.patch > t.patch);
		}
		comparePre(t) {
			if (t instanceof e || (t = new e(t, this.options)), this.prerelease.length && !t.prerelease.length) return -1;
			if (!this.prerelease.length && t.prerelease.length) return 1;
			if (!this.prerelease.length && !t.prerelease.length) return 0;
			let r = 0;
			do {
				let e = this.prerelease[r], i = t.prerelease[r];
				if (n("prerelease compare", r, e, i), e === void 0 && i === void 0) return 0;
				if (i === void 0) return 1;
				if (e === void 0) return -1;
				if (e !== i) return c(e, i);
			} while (++r);
		}
		compareBuild(t) {
			t instanceof e || (t = new e(t, this.options));
			let r = 0;
			do {
				let e = this.build[r], i = t.build[r];
				if (n("build compare", r, e, i), e === void 0 && i === void 0) return 0;
				if (i === void 0) return 1;
				if (e === void 0) return -1;
				if (e !== i) return c(e, i);
			} while (++r);
		}
		inc(e, t, n) {
			if (e.startsWith("pre")) {
				if (!t && n === !1) throw Error("invalid increment argument: identifier is empty");
				if (t) {
					let e = `-${t}`.match(this.options.loose ? a[o.PRERELEASELOOSE] : a[o.PRERELEASE]);
					if (!e || e[1] !== t) throw Error(`invalid identifier: ${t}`);
				}
			}
			switch (e) {
				case "premajor":
					this.prerelease.length = 0, this.patch = 0, this.minor = 0, this.major++, this.inc("pre", t, n);
					break;
				case "preminor":
					this.prerelease.length = 0, this.patch = 0, this.minor++, this.inc("pre", t, n);
					break;
				case "prepatch":
					this.prerelease.length = 0, this.inc("patch", t, n), this.inc("pre", t, n);
					break;
				case "prerelease":
					this.prerelease.length === 0 && this.inc("patch", t, n), this.inc("pre", t, n);
					break;
				case "release":
					if (this.prerelease.length === 0) throw Error(`version ${this.raw} is not a prerelease`);
					this.prerelease.length = 0;
					break;
				case "major":
					(this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) && this.major++, this.minor = 0, this.patch = 0, this.prerelease = [];
					break;
				case "minor":
					(this.patch !== 0 || this.prerelease.length === 0) && this.minor++, this.patch = 0, this.prerelease = [];
					break;
				case "patch":
					this.prerelease.length === 0 && this.patch++, this.prerelease = [];
					break;
				case "pre": {
					let e = +!!Number(n);
					if (this.prerelease.length === 0) this.prerelease = [e];
					else {
						let r = this.prerelease.length;
						for (; --r >= 0;) typeof this.prerelease[r] == "number" && (this.prerelease[r]++, r = -2);
						if (r === -1) {
							if (t === this.prerelease.join(".") && n === !1) throw Error("invalid increment argument: identifier already exists");
							this.prerelease.push(e);
						}
					}
					if (t) {
						let r = [t, e];
						if (n === !1 && (r = [t]), l(this.prerelease, t)) {
							let e = this.prerelease[t.split(".").length];
							isNaN(e) && (this.prerelease = r);
						} else this.prerelease = r;
					}
					break;
				}
				default: throw Error(`invalid increment argument: ${e}`);
			}
			return this.raw = this.format(), this.build.length && (this.raw += `+${this.build.join(".")}`), this;
		}
	};
})), st = /* @__PURE__ */ O(((e, t) => {
	var n = ot();
	t.exports = (e, t, r = !1) => {
		if (e instanceof n) return e;
		try {
			return new n(e, t);
		} catch (e) {
			if (!r) return null;
			throw e;
		}
	};
})), ct = /* @__PURE__ */ O(((e, t) => {
	var n = ot(), r = st(), { safeRe: i, t: a } = rt();
	t.exports = (e, t) => {
		if (e instanceof n) return e;
		if (typeof e == "number" && (e = String(e)), typeof e != "string") return null;
		t ||= {};
		let o = null;
		if (!t.rtl) o = e.match(t.includePrerelease ? i[a.COERCEFULL] : i[a.COERCE]);
		else {
			let n = t.includePrerelease ? i[a.COERCERTLFULL] : i[a.COERCERTL], r;
			for (; (r = n.exec(e)) && (!o || o.index + o[0].length !== e.length);) (!o || r.index + r[0].length !== o.index + o[0].length) && (o = r), n.lastIndex = r.index + r[1].length + r[2].length;
			n.lastIndex = -1;
		}
		if (o === null) return null;
		let s = o[2];
		return r(`${s}.${o[3] || "0"}.${o[4] || "0"}${t.includePrerelease && o[5] ? `-${o[5]}` : ""}${t.includePrerelease && o[6] ? `+${o[6]}` : ""}`, t);
	};
})), lt = /* @__PURE__ */ O(((e, t) => {
	var n = ot();
	t.exports = (e, t, r) => new n(e, r).compare(new n(t, r));
})), ut = /* @__PURE__ */ O(((e, t) => {
	var n = lt();
	t.exports = (e, t, r) => n(e, t, r) >= 0;
})), dt = /* @__PURE__ */ O(((e, t) => {
	t.exports = class {
		constructor() {
			this.max = 1e3, this.map = /* @__PURE__ */ new Map();
		}
		get(e) {
			let t = this.map.get(e);
			if (t !== void 0) return this.map.delete(e), this.map.set(e, t), t;
		}
		delete(e) {
			return this.map.delete(e);
		}
		set(e, t) {
			if (!this.delete(e) && t !== void 0) {
				if (this.map.size >= this.max) {
					let e = this.map.keys().next().value;
					this.delete(e);
				}
				this.map.set(e, t);
			}
			return this;
		}
	};
})), ft = /* @__PURE__ */ O(((e, t) => {
	var n = lt();
	t.exports = (e, t, r) => n(e, t, r) === 0;
})), pt = /* @__PURE__ */ O(((e, t) => {
	var n = lt();
	t.exports = (e, t, r) => n(e, t, r) !== 0;
})), mt = /* @__PURE__ */ O(((e, t) => {
	var n = lt();
	t.exports = (e, t, r) => n(e, t, r) > 0;
})), ht = /* @__PURE__ */ O(((e, t) => {
	var n = lt();
	t.exports = (e, t, r) => n(e, t, r) < 0;
})), gt = /* @__PURE__ */ O(((e, t) => {
	var n = lt();
	t.exports = (e, t, r) => n(e, t, r) <= 0;
})), _t = /* @__PURE__ */ O(((e, t) => {
	var n = ft(), r = pt(), i = mt(), a = ut(), o = ht(), s = gt();
	t.exports = (e, t, c, l) => {
		switch (t) {
			case "===": return typeof e == "object" && (e = e.version), typeof c == "object" && (c = c.version), e === c;
			case "!==": return typeof e == "object" && (e = e.version), typeof c == "object" && (c = c.version), e !== c;
			case "":
			case "=":
			case "==": return n(e, c, l);
			case "!=": return r(e, c, l);
			case ">": return i(e, c, l);
			case ">=": return a(e, c, l);
			case "<": return o(e, c, l);
			case "<=": return s(e, c, l);
			default: throw TypeError(`Invalid operator: ${t}`);
		}
	};
})), vt = /* @__PURE__ */ O(((e, t) => {
	var n = Symbol("SemVer ANY");
	t.exports = class e {
		static get ANY() {
			return n;
		}
		constructor(t, i) {
			if (i = r(i), t instanceof e) {
				if (t.loose === !!i.loose) return t;
				t = t.value;
			}
			t = t.trim().split(/\s+/).join(" "), s("comparator", t, i), this.options = i, this.loose = !!i.loose, this.parse(t), this.value = this.semver === n ? "" : this.operator + this.semver.version, s("comp", this);
		}
		parse(e) {
			let t = this.options.loose ? i[a.COMPARATORLOOSE] : i[a.COMPARATOR], r = e.match(t);
			if (!r) throw TypeError(`Invalid comparator: ${e}`);
			this.operator = r[1] === void 0 ? "" : r[1], this.operator === "=" && (this.operator = ""), this.semver = r[2] ? new c(r[2], this.options.loose) : n;
		}
		toString() {
			return this.value;
		}
		test(e) {
			if (s("Comparator.test", e, this.options.loose), this.semver === n || e === n) return !0;
			if (typeof e == "string") try {
				e = new c(e, this.options);
			} catch {
				return !1;
			}
			return o(e, this.operator, this.semver, this.options);
		}
		intersects(t, n) {
			if (!(t instanceof e)) throw TypeError("a Comparator is required");
			return this.operator === "" ? this.value === "" || new l(t.value, n).test(this.value) : t.operator === "" ? t.value === "" || new l(this.value, n).test(t.semver) : (n = r(n), n.includePrerelease && (this.value === "<0.0.0-0" || t.value === "<0.0.0-0") || !n.includePrerelease && (this.value.startsWith("<0.0.0") || t.value.startsWith("<0.0.0")) ? !1 : !!(this.operator.startsWith(">") && t.operator.startsWith(">") || this.operator.startsWith("<") && t.operator.startsWith("<") || this.semver.version === t.semver.version && this.operator.includes("=") && t.operator.includes("=") || o(this.semver, "<", t.semver, n) && this.operator.startsWith(">") && t.operator.startsWith("<") || o(this.semver, ">", t.semver, n) && this.operator.startsWith("<") && t.operator.startsWith(">")));
		}
	};
	var r = it(), { safeRe: i, t: a } = rt(), o = _t(), s = tt(), c = ot(), l = yt();
})), yt = /* @__PURE__ */ O(((e, t) => {
	var n = /\s+/g;
	t.exports = class e {
		constructor(t, r) {
			if (r = i(r), t instanceof e) return t.loose === !!r.loose && t.includePrerelease === !!r.includePrerelease ? t : new e(t.raw, r);
			if (t instanceof a) return this.raw = t.value, this.set = [[t]], this.formatted = void 0, this;
			if (this.options = r, this.loose = !!r.loose, this.includePrerelease = !!r.includePrerelease, this.raw = t.trim().replace(n, " "), this.set = this.raw.split("||").map((e) => this.parseRange(e.trim())).filter((e) => e.length), !this.set.length) throw TypeError(`Invalid SemVer Range: ${this.raw}`);
			if (this.set.length > 1) {
				let e = this.set[0];
				if (this.set = this.set.filter((e) => !_(e[0])), this.set.length === 0) this.set = [e];
				else if (this.set.length > 1) {
					for (let e of this.set) if (e.length === 1 && v(e[0])) {
						this.set = [e];
						break;
					}
				}
			}
			this.formatted = void 0;
		}
		get range() {
			if (this.formatted === void 0) {
				this.formatted = "";
				for (let e = 0; e < this.set.length; e++) {
					e > 0 && (this.formatted += "||");
					let t = this.set[e];
					for (let e = 0; e < t.length; e++) e > 0 && (this.formatted += " "), this.formatted += t[e].toString().trim();
				}
			}
			return this.formatted;
		}
		format() {
			return this.range;
		}
		toString() {
			return this.range;
		}
		parseRange(e) {
			e = e.replace(g, "");
			let t = ((this.options.includePrerelease && m) | (this.options.loose && h)) + ":" + e, n = r.get(t);
			if (n) return n;
			let i = this.options.loose, s = i ? c[u.HYPHENRANGELOOSE] : c[u.HYPHENRANGE];
			e = e.replace(s, ee(this.options.includePrerelease)), o("hyphen replace", e), e = e.replace(c[u.COMPARATORTRIM], d), o("comparator trim", e), e = e.replace(c[u.TILDETRIM], f), o("tilde trim", e), e = e.replace(c[u.CARETTRIM], p), o("caret trim", e);
			let l = e.split(" ").map((e) => b(e, this.options)).join(" ").split(/\s+/).map((e) => A(e, this.options));
			i && (l = l.filter((e) => (o("loose invalid filter", e, this.options), !!e.match(c[u.COMPARATORLOOSE])))), o("range list", l);
			let v = /* @__PURE__ */ new Map(), y = l.map((e) => new a(e, this.options));
			for (let e of y) {
				if (_(e)) return [e];
				v.set(e.value, e);
			}
			v.size > 1 && v.has("") && v.delete("");
			let x = [...v.values()];
			return r.set(t, x), x;
		}
		intersects(t, n) {
			if (!(t instanceof e)) throw TypeError("a Range is required");
			return this.set.some((e) => y(e, n) && t.set.some((t) => y(t, n) && e.every((e) => t.every((t) => e.intersects(t, n)))));
		}
		test(e) {
			if (!e) return !1;
			if (typeof e == "string") try {
				e = new s(e, this.options);
			} catch {
				return !1;
			}
			for (let t = 0; t < this.set.length; t++) if (te(this.set[t], e, this.options)) return !0;
			return !1;
		}
	};
	var r = new (dt())(), i = it(), a = vt(), o = tt(), s = ot(), { safeRe: c, src: l, t: u, comparatorTrimReplace: d, tildeTrimReplace: f, caretTrimReplace: p } = rt(), { FLAG_INCLUDE_PRERELEASE: m, FLAG_LOOSE: h } = nt(), g = new RegExp(l[u.BUILD], "g"), _ = (e) => e.value === "<0.0.0-0", v = (e) => e.value === "", y = (e, t) => {
		let n = !0, r = e.slice(), i = r.pop();
		for (; n && r.length;) n = r.every((e) => i.intersects(e, t)), i = r.pop();
		return n;
	}, b = (e, t) => (e = e.replace(c[u.BUILD], ""), o("comp", e, t), e = T(e, t), o("caret", e), e = C(e, t), o("tildes", e), e = D(e, t), o("xrange", e), e = k(e, t), o("stars", e), e), x = (e) => !e || e.toLowerCase() === "x" || e === "*", S = (e, t, n) => x(e) && !x(t) || x(t) && n && !x(n), C = (e, t) => e.trim().split(/\s+/).map((e) => w(e, t)).join(" "), w = (e, t) => {
		let n = t.loose ? c[u.TILDELOOSE] : c[u.TILDE], r = t.includePrerelease ? "-0" : "";
		return e.replace(n, (t, n, i, a, s) => {
			o("tilde", e, t, n, i, a, s);
			let c;
			return x(n) ? c = "" : x(i) ? c = `>=${n}.0.0${r} <${+n + 1}.0.0-0` : x(a) ? c = `>=${n}.${i}.0${r} <${n}.${+i + 1}.0-0` : s ? (o("replaceTilde pr", s), c = `>=${n}.${i}.${a}-${s} <${n}.${+i + 1}.0-0`) : c = `>=${n}.${i}.${a} <${n}.${+i + 1}.0-0`, o("tilde return", c), c;
		});
	}, T = (e, t) => e.trim().split(/\s+/).map((e) => E(e, t)).join(" "), E = (e, t) => {
		o("caret", e, t);
		let n = t.loose ? c[u.CARETLOOSE] : c[u.CARET], r = t.includePrerelease ? "-0" : "";
		return e.replace(n, (t, n, i, a, s) => {
			o("caret", e, t, n, i, a, s);
			let c;
			return x(n) ? c = "" : x(i) ? c = `>=${n}.0.0${r} <${+n + 1}.0.0-0` : x(a) ? c = n === "0" ? `>=${n}.${i}.0${r} <${n}.${+i + 1}.0-0` : `>=${n}.${i}.0${r} <${+n + 1}.0.0-0` : s ? (o("replaceCaret pr", s), c = n === "0" ? i === "0" ? `>=${n}.${i}.${a}-${s} <${n}.${i}.${+a + 1}-0` : `>=${n}.${i}.${a}-${s} <${n}.${+i + 1}.0-0` : `>=${n}.${i}.${a}-${s} <${+n + 1}.0.0-0`) : (o("no pr"), c = n === "0" ? i === "0" ? `>=${n}.${i}.${a} <${n}.${i}.${+a + 1}-0` : `>=${n}.${i}.${a} <${n}.${+i + 1}.0-0` : `>=${n}.${i}.${a} <${+n + 1}.0.0-0`), o("caret return", c), c;
		});
	}, D = (e, t) => (o("replaceXRanges", e, t), e.split(/\s+/).map((e) => O(e, t)).join(" ")), O = (e, t) => {
		e = e.trim();
		let n = t.loose ? c[u.XRANGELOOSE] : c[u.XRANGE];
		return e.replace(n, (n, r, i, a, s, c) => {
			if (o("xRange", e, n, r, i, a, s, c), S(i, a, s)) return e;
			let l = x(i), u = l || x(a), d = u || x(s), f = d;
			return r === "=" && f && (r = ""), c = t.includePrerelease ? "-0" : "", l ? n = r === ">" || r === "<" ? "<0.0.0-0" : "*" : r && f ? (u && (a = 0), s = 0, r === ">" ? (r = ">=", u ? (i = +i + 1, a = 0, s = 0) : (a = +a + 1, s = 0)) : r === "<=" && (r = "<", u ? i = +i + 1 : a = +a + 1), r === "<" && (c = "-0"), n = `${r + i}.${a}.${s}${c}`) : u ? n = `>=${i}.0.0${c} <${+i + 1}.0.0-0` : d && (n = `>=${i}.${a}.0${c} <${i}.${+a + 1}.0-0`), o("xRange return", n), n;
		});
	}, k = (e, t) => (o("replaceStars", e, t), e.trim().replace(c[u.STAR], "")), A = (e, t) => (o("replaceGTE0", e, t), e.trim().replace(c[t.includePrerelease ? u.GTE0PRE : u.GTE0], "")), ee = (e) => (t, n, r, i, a, o, s, c, l, u, d, f) => (n = x(r) ? "" : x(i) ? `>=${r}.0.0${e ? "-0" : ""}` : x(a) ? `>=${r}.${i}.0${e ? "-0" : ""}` : o ? `>=${n}` : `>=${n}${e ? "-0" : ""}`, c = x(l) ? "" : x(u) ? `<${+l + 1}.0.0-0` : x(d) ? `<${l}.${+u + 1}.0-0` : f ? `<=${l}.${u}.${d}-${f}` : e ? `<${l}.${u}.${+d + 1}-0` : `<=${c}`, `${n} ${c}`.trim()), te = (e, t, n) => {
		for (let n = 0; n < e.length; n++) if (!e[n].test(t)) return !1;
		if (t.prerelease.length && !n.includePrerelease) {
			for (let n = 0; n < e.length; n++) if (o(e[n].semver), e[n].semver !== a.ANY && e[n].semver.prerelease.length > 0) {
				let r = e[n].semver;
				if (r.major === t.major && r.minor === t.minor && r.patch === t.patch) return !0;
			}
			return !1;
		}
		return !0;
	};
})), bt = /* @__PURE__ */ O(((e, t) => {
	var n = yt();
	t.exports = (e, t, r) => {
		try {
			t = new n(t, r);
		} catch {
			return !1;
		}
		return t.test(e);
	};
})), xt = /* @__PURE__ */ k({
	author: () => Tt,
	config: () => Bt,
	contributors: () => Dt,
	default: () => Ht,
	dependencies: () => Ft,
	description: () => Ct,
	devDependencies: () => Lt,
	engines: () => zt,
	files: () => Mt,
	funding: () => Vt,
	homepage: () => Et,
	keywords: () => Pt,
	license: () => Rt,
	main: () => At,
	name: () => St,
	optionalDependencies: () => It,
	repository: () => Nt,
	scripts: () => Ot,
	type: () => kt,
	types: () => jt,
	version: () => wt
}), St, Ct, wt, Tt, Et, Dt, Ot, kt, At, jt, Mt, Nt, Pt, Ft, It, Lt, Rt, zt, Bt, Vt, Ht, Ut = D((() => {
	St = "sharp", Ct = "High performance Node.js image processing, the fastest module to resize JPEG, PNG, WebP, GIF, AVIF and TIFF images", wt = "0.34.5", Tt = "Lovell Fuller <npm@lovell.info>", Et = "https://sharp.pixelplumbing.com", Dt = /* @__PURE__ */ "Pierre Inglebert <pierre.inglebert@gmail.com>,Jonathan Ong <jonathanrichardong@gmail.com>,Chanon Sajjamanochai <chanon.s@gmail.com>,Juliano Julio <julianojulio@gmail.com>,Daniel Gasienica <daniel@gasienica.ch>,Julian Walker <julian@fiftythree.com>,Amit Pitaru <pitaru.amit@gmail.com>,Brandon Aaron <hello.brandon@aaron.sh>,Andreas Lind <andreas@one.com>,Maurus Cuelenaere <mcuelenaere@gmail.com>,Linus Unnebäck <linus@folkdatorn.se>,Victor Mateevitsi <mvictoras@gmail.com>,Alaric Holloway <alaric.holloway@gmail.com>,Bernhard K. Weisshuhn <bkw@codingforce.com>,Chris Riley <criley@primedia.com>,David Carley <dacarley@gmail.com>,John Tobin <john@limelightmobileinc.com>,Kenton Gray <kentongray@gmail.com>,Felix Bünemann <Felix.Buenemann@gmail.com>,Samy Al Zahrani <samyalzahrany@gmail.com>,Chintan Thakkar <lemnisk8@gmail.com>,F. Orlando Galashan <frulo@gmx.de>,Kleis Auke Wolthuizen <info@kleisauke.nl>,Matt Hirsch <mhirsch@media.mit.edu>,Matthias Thoemmes <thoemmes@gmail.com>,Patrick Paskaris <patrick@paskaris.gr>,Jérémy Lal <kapouer@melix.org>,Rahul Nanwani <r.nanwani@gmail.com>,Alice Monday <alice0meta@gmail.com>,Kristo Jorgenson <kristo.jorgenson@gmail.com>,YvesBos <yves_bos@outlook.com>,Guy Maliar <guy@tailorbrands.com>,Nicolas Coden <nicolas@ncoden.fr>,Matt Parrish <matt.r.parrish@gmail.com>,Marcel Bretschneider <marcel.bretschneider@gmail.com>,Matthew McEachen <matthew+github@mceachen.org>,Jarda Kotěšovec <jarda.kotesovec@gmail.com>,Kenric D'Souza <kenric.dsouza@gmail.com>,Oleh Aleinyk <oleg.aleynik@gmail.com>,Marcel Bretschneider <marcel.bretschneider@gmail.com>,Andrea Bianco <andrea.bianco@unibas.ch>,Rik Heywood <rik@rik.org>,Thomas Parisot <hi@oncletom.io>,Nathan Graves <nathanrgraves+github@gmail.com>,Tom Lokhorst <tom@lokhorst.eu>,Espen Hovlandsdal <espen@hovlandsdal.com>,Sylvain Dumont <sylvain.dumont35@gmail.com>,Alun Davies <alun.owain.davies@googlemail.com>,Aidan Hoolachan <ajhoolachan21@gmail.com>,Axel Eirola <axel.eirola@iki.fi>,Freezy <freezy@xbmc.org>,Daiz <taneli.vatanen@gmail.com>,Julian Aubourg <j@ubourg.net>,Keith Belovay <keith@picthrive.com>,Michael B. Klein <mbklein@gmail.com>,Jordan Prudhomme <jordan@raboland.fr>,Ilya Ovdin <iovdin@gmail.com>,Andargor <andargor@yahoo.com>,Paul Neave <paul.neave@gmail.com>,Brendan Kennedy <brenwken@gmail.com>,Brychan Bennett-Odlum <git@brychan.io>,Edward Silverton <e.silverton@gmail.com>,Roman Malieiev <aromaleev@gmail.com>,Tomas Szabo <tomas.szabo@deftomat.com>,Robert O'Rourke <robert@o-rourke.org>,Guillermo Alfonso Varela Chouciño <guillevch@gmail.com>,Christian Flintrup <chr@gigahost.dk>,Manan Jadhav <manan@motionden.com>,Leon Radley <leon@radley.se>,alza54 <alza54@thiocod.in>,Jacob Smith <jacob@frende.me>,Michael Nutt <michael@nutt.im>,Brad Parham <baparham@gmail.com>,Taneli Vatanen <taneli.vatanen@gmail.com>,Joris Dugué <zaruike10@gmail.com>,Chris Banks <christopher.bradley.banks@gmail.com>,Ompal Singh <ompal.hitm09@gmail.com>,Brodan <christopher.hranj@gmail.com>,Ankur Parihar <ankur.github@gmail.com>,Brahim Ait elhaj <brahima@gmail.com>,Mart Jansink <m.jansink@gmail.com>,Lachlan Newman <lachnewman007@gmail.com>,Dennis Beatty <dennis@dcbeatty.com>,Ingvar Stepanyan <me@rreverser.com>,Don Denton <don@happycollision.com>".split(","), Ot = {
		build: "node install/build.js",
		install: "node install/check.js || npm run build",
		clean: "rm -rf src/build/ .nyc_output/ coverage/ test/fixtures/output.*",
		test: "npm run lint && npm run test-unit",
		lint: "npm run lint-cpp && npm run lint-js && npm run lint-types",
		"lint-cpp": "cpplint --quiet src/*.h src/*.cc",
		"lint-js": "biome lint",
		"lint-types": "tsd --files ./test/types/sharp.test-d.ts",
		"test-leak": "./test/leak/leak.sh",
		"test-unit": "node --experimental-test-coverage test/unit.mjs",
		"package-from-local-build": "node npm/from-local-build.js",
		"package-release-notes": "node npm/release-notes.js",
		"docs-build": "node docs/build.mjs",
		"docs-serve": "cd docs && npm start",
		"docs-publish": "cd docs && npm run build && npx firebase-tools deploy --project pixelplumbing --only hosting:pixelplumbing-sharp"
	}, kt = "commonjs", At = "lib/index.js", jt = "lib/index.d.ts", Mt = [
		"install",
		"lib",
		"src/*.{cc,h,gyp}"
	], Nt = {
		type: "git",
		url: "git://github.com/lovell/sharp.git"
	}, Pt = [
		"jpeg",
		"png",
		"webp",
		"avif",
		"tiff",
		"gif",
		"svg",
		"jp2",
		"dzi",
		"image",
		"resize",
		"thumbnail",
		"crop",
		"embed",
		"libvips",
		"vips"
	], Ft = {
		"@img/colour": "^1.0.0",
		"detect-libc": "^2.1.2",
		semver: "^7.7.3"
	}, It = {
		"@img/sharp-darwin-arm64": "0.34.5",
		"@img/sharp-darwin-x64": "0.34.5",
		"@img/sharp-libvips-darwin-arm64": "1.2.4",
		"@img/sharp-libvips-darwin-x64": "1.2.4",
		"@img/sharp-libvips-linux-arm": "1.2.4",
		"@img/sharp-libvips-linux-arm64": "1.2.4",
		"@img/sharp-libvips-linux-ppc64": "1.2.4",
		"@img/sharp-libvips-linux-riscv64": "1.2.4",
		"@img/sharp-libvips-linux-s390x": "1.2.4",
		"@img/sharp-libvips-linux-x64": "1.2.4",
		"@img/sharp-libvips-linuxmusl-arm64": "1.2.4",
		"@img/sharp-libvips-linuxmusl-x64": "1.2.4",
		"@img/sharp-linux-arm": "0.34.5",
		"@img/sharp-linux-arm64": "0.34.5",
		"@img/sharp-linux-ppc64": "0.34.5",
		"@img/sharp-linux-riscv64": "0.34.5",
		"@img/sharp-linux-s390x": "0.34.5",
		"@img/sharp-linux-x64": "0.34.5",
		"@img/sharp-linuxmusl-arm64": "0.34.5",
		"@img/sharp-linuxmusl-x64": "0.34.5",
		"@img/sharp-wasm32": "0.34.5",
		"@img/sharp-win32-arm64": "0.34.5",
		"@img/sharp-win32-ia32": "0.34.5",
		"@img/sharp-win32-x64": "0.34.5"
	}, Lt = {
		"@biomejs/biome": "^2.3.4",
		"@cpplint/cli": "^0.1.0",
		"@emnapi/runtime": "^1.7.0",
		"@img/sharp-libvips-dev": "1.2.4",
		"@img/sharp-libvips-dev-wasm32": "1.2.4",
		"@img/sharp-libvips-win32-arm64": "1.2.4",
		"@img/sharp-libvips-win32-ia32": "1.2.4",
		"@img/sharp-libvips-win32-x64": "1.2.4",
		"@types/node": "*",
		emnapi: "^1.7.0",
		"exif-reader": "^2.0.2",
		"extract-zip": "^2.0.1",
		icc: "^3.0.0",
		"jsdoc-to-markdown": "^9.1.3",
		"node-addon-api": "^8.5.0",
		"node-gyp": "^11.5.0",
		"tar-fs": "^3.1.1",
		tsd: "^0.33.0"
	}, Rt = "Apache-2.0", zt = { node: "^18.17.0 || ^20.3.0 || >=21.0.0" }, Bt = { libvips: ">=8.17.3" }, Vt = { url: "https://opencollective.com/libvips" }, Ht = {
		name: St,
		description: Ct,
		version: wt,
		author: Tt,
		homepage: Et,
		contributors: Dt,
		scripts: Ot,
		type: kt,
		main: At,
		types: jt,
		files: Mt,
		repository: Nt,
		keywords: Pt,
		dependencies: Ft,
		optionalDependencies: It,
		devDependencies: Lt,
		license: Rt,
		engines: zt,
		config: Bt,
		funding: Vt
	};
})), Wt = /* @__PURE__ */ O(((e, t) => {
	var { spawnSync: n } = j("node:child_process"), { createHash: r } = j("node:crypto"), i = ct(), a = ut(), o = bt(), s = et(), { config: c, engines: l, optionalDependencies: u } = (Ut(), te(xt).default), d = i(process.env.npm_package_config_libvips || c.libvips).version, f = [
		"darwin-arm64",
		"darwin-x64",
		"linux-arm",
		"linux-arm64",
		"linux-ppc64",
		"linux-riscv64",
		"linux-s390x",
		"linux-x64",
		"linuxmusl-arm64",
		"linuxmusl-x64",
		"win32-arm64",
		"win32-ia32",
		"win32-x64"
	], p = {
		encoding: "utf8",
		shell: !0
	}, m = (e) => {
		e instanceof Error ? console.error(`sharp: Installation error: ${e.message}`) : console.log(`sharp: ${e}`);
	}, h = () => s.isNonGlibcLinuxSync() ? s.familySync() : "", g = () => `${process.platform}${h()}-${process.arch}`, _ = () => {
		/* node:coverage ignore next 3 */
		if (S()) return "wasm32";
		let { npm_config_arch: e, npm_config_platform: t, npm_config_libc: n } = process.env, r = typeof n == "string" ? n : h();
		return `${t || process.platform}${r}-${e || process.arch}`;
	}, v = () => {
		try {
			return j(`@img/sharp-libvips-dev-${_()}/include`);
		} catch {
			/* node:coverage ignore next 5 */
			try {
				return j("@img/sharp-libvips-dev/include");
			} catch {}
		}
		return "";
	}, y = () => {
		/* node:coverage ignore next 4 */
		try {
			return j("@img/sharp-libvips-dev/cplusplus");
		} catch {}
		return "";
	}, b = () => {
		try {
			return j(`@img/sharp-libvips-dev-${_()}/lib`);
		} catch {
			/* node:coverage ignore next 5 */
			try {
				return j(`@img/sharp-libvips-${_()}/lib`);
			} catch {}
		}
		return "";
	}, x = () => {
		if (process.release?.name === "node" && process.versions && !o(process.versions.node, l.node)) return {
			found: process.versions.node,
			expected: l.node
		};
	}, S = () => {
		let { CC: e } = process.env;
		return !!e?.endsWith("/emcc");
	}, C = () => process.platform === "darwin" && process.arch === "x64" && (n("sysctl sysctl.proc_translated", p).stdout || "").trim() === "sysctl.proc_translated: 1", w = (e) => r("sha512").update(e).digest("hex"), T = () => {
		try {
			let e = w(`imgsharp-libvips-${_()}`), t = i(u[`@img/sharp-libvips-${_()}`], { includePrerelease: !0 }).version;
			return w(`${e}npm:${t}`).slice(0, 10);
		} catch {}
		return "";
	}, E = () => n(`node-gyp rebuild --directory=src ${S() ? "--nodedir=emscripten" : ""}`, {
		...p,
		stdio: "inherit"
	}).status, D = () => process.platform === "win32" ? "" : (n("pkg-config --modversion vips-cpp", {
		...p,
		env: {
			...process.env,
			PKG_CONFIG_PATH: O()
		}
	}).stdout || "").trim(), O = () => process.platform === "win32" ? "" : [
		(n("which brew >/dev/null 2>&1 && brew environment --plain | grep PKG_CONFIG_LIBDIR | cut -d\" \" -f2", p).stdout || "").trim(),
		process.env.PKG_CONFIG_PATH,
		"/usr/local/lib/pkgconfig",
		"/usr/lib/pkgconfig",
		"/usr/local/libdata/pkgconfig",
		"/usr/libdata/pkgconfig"
	].filter(Boolean).join(":"), k = (e, t, n) => (n && n(`Detected ${t}, skipping search for globally-installed libvips`), e);
	t.exports = {
		minimumLibvipsVersion: d,
		prebuiltPlatforms: f,
		buildPlatformArch: _,
		buildSharpLibvipsIncludeDir: v,
		buildSharpLibvipsCPlusPlusDir: y,
		buildSharpLibvipsLibDir: b,
		isUnsupportedNodeRuntime: x,
		runtimePlatformArch: g,
		log: m,
		yarnLocator: T,
		spawnRebuild: E,
		globalLibvipsVersion: D,
		pkgConfigPath: O,
		useGlobalLibvips: (e) => {
			if (process.env.SHARP_IGNORE_GLOBAL_LIBVIPS) return k(!1, "SHARP_IGNORE_GLOBAL_LIBVIPS", e);
			if (process.env.SHARP_FORCE_GLOBAL_LIBVIPS) return k(!0, "SHARP_FORCE_GLOBAL_LIBVIPS", e);
			/* node:coverage ignore next 3 */
			if (C()) return k(!1, "Rosetta", e);
			let t = D();
			/* node:coverage ignore next */
			return !!t && a(t, d);
		}
	};
})), Gt = /* @__PURE__ */ O(((e, t) => {
	var { familySync: n, versionSync: r } = et(), { runtimePlatformArch: i, isUnsupportedNodeRuntime: a, prebuiltPlatforms: o, minimumLibvipsVersion: s } = Wt(), c = i(), l = [
		`../src/build/Release/sharp-${c}.node`,
		"../src/build/Release/sharp-wasm32.node",
		`@img/sharp-${c}/sharp.node`,
		"@img/sharp-wasm32/sharp.node"
	], u, d, f = [];
	for (u of l) try {
		d = j(u);
		break;
	} catch (e) {
		f.push(e);
	}
	if (d && u.startsWith("@img/sharp-linux-x64") && !d._isUsingX64V2()) {
		let e = /* @__PURE__ */ Error("Prebuilt binaries for linux-x64 require v2 microarchitecture");
		e.code = "Unsupported CPU", f.push(e), d = null;
	}
	if (d) t.exports = d;
	else {
		let [e, t, i] = [
			"linux",
			"darwin",
			"win32"
		].map((e) => c.startsWith(e)), l = [`Could not load the "sharp" module using the ${c} runtime`];
		f.forEach((e) => {
			e.code !== "MODULE_NOT_FOUND" && l.push(`${e.code}: ${e.message}`);
		});
		let u = f.map((e) => e.message).join(" ");
		if (l.push("Possible solutions:"), a()) {
			let { found: e, expected: t } = a();
			l.push("- Please upgrade Node.js:", `    Found ${e}`, `    Requires ${t}`);
		} else if (o.includes(c)) {
			let [e, t] = c.split("-"), n = e.endsWith("musl") ? " --libc=musl" : "";
			l.push("- Ensure optional dependencies can be installed:", "    npm install --include=optional sharp", "- Ensure your package manager supports multi-platform installation:", "    See https://sharp.pixelplumbing.com/install#cross-platform", "- Add platform-specific dependencies:", `    npm install --os=${e.replace("musl", "")}${n} --cpu=${t} sharp`);
		} else l.push(`- Manually install libvips >= ${s}`, "- Add experimental WebAssembly-based dependencies:", "    npm install --cpu=wasm32 sharp", "    npm install @img/sharp-wasm32");
		if (e && /(symbol not found|CXXABI_)/i.test(u)) try {
			let { config: e } = j(`@img/sharp-libvips-${c}/package`), t = `${n()} ${r()}`, i = `${e.musl ? "musl" : "glibc"} ${e.musl || e.glibc}`;
			l.push("- Update your OS:", `    Found ${t}`, `    Requires ${i}`);
		} catch {}
		throw e && /\/snap\/core[0-9]{2}/.test(u) && l.push("- Remove the Node.js Snap, which does not support native modules", "    snap remove node"), t && /Incompatible library version/.test(u) && l.push("- Update Homebrew:", "    brew update && brew upgrade vips"), f.some((e) => e.code === "ERR_DLOPEN_DISABLED") && l.push("- Run Node.js without using the --no-addons flag"), i && /The specified procedure could not be found/.test(u) && l.push("- Using the canvas package on Windows?", "    See https://sharp.pixelplumbing.com/install#canvas-and-windows", "- Check for outdated versions of sharp in the dependency tree:", "    npm ls sharp"), l.push("- Consult the installation documentation:", "    See https://sharp.pixelplumbing.com/install"), Error(l.join("\n"));
	}
})), Kt = /* @__PURE__ */ O(((e, t) => {
	var n = j("node:util"), r = j("node:stream"), i = Xe();
	Gt();
	var a = n.debuglog("sharp"), o = (e) => {
		s.queue.emit("change", e);
	}, s = function(e, t) {
		if (arguments.length === 1 && !i.defined(e)) throw Error("Invalid input");
		return this instanceof s ? (r.Duplex.call(this), this.options = {
			topOffsetPre: -1,
			leftOffsetPre: -1,
			widthPre: -1,
			heightPre: -1,
			topOffsetPost: -1,
			leftOffsetPost: -1,
			widthPost: -1,
			heightPost: -1,
			width: -1,
			height: -1,
			canvas: "crop",
			position: 0,
			resizeBackground: [
				0,
				0,
				0,
				255
			],
			angle: 0,
			rotationAngle: 0,
			rotationBackground: [
				0,
				0,
				0,
				255
			],
			rotateBefore: !1,
			orientBefore: !1,
			flip: !1,
			flop: !1,
			extendTop: 0,
			extendBottom: 0,
			extendLeft: 0,
			extendRight: 0,
			extendBackground: [
				0,
				0,
				0,
				255
			],
			extendWith: "background",
			withoutEnlargement: !1,
			withoutReduction: !1,
			affineMatrix: [],
			affineBackground: [
				0,
				0,
				0,
				255
			],
			affineIdx: 0,
			affineIdy: 0,
			affineOdx: 0,
			affineOdy: 0,
			affineInterpolator: this.constructor.interpolators.bilinear,
			kernel: "lanczos3",
			fastShrinkOnLoad: !0,
			tint: [
				-1,
				0,
				0,
				0
			],
			flatten: !1,
			flattenBackground: [
				0,
				0,
				0
			],
			unflatten: !1,
			negate: !1,
			negateAlpha: !0,
			medianSize: 0,
			blurSigma: 0,
			precision: "integer",
			minAmpl: .2,
			sharpenSigma: 0,
			sharpenM1: 1,
			sharpenM2: 2,
			sharpenX1: 2,
			sharpenY2: 10,
			sharpenY3: 20,
			threshold: 0,
			thresholdGrayscale: !0,
			trimBackground: [],
			trimThreshold: -1,
			trimLineArt: !1,
			dilateWidth: 0,
			erodeWidth: 0,
			gamma: 0,
			gammaOut: 0,
			greyscale: !1,
			normalise: !1,
			normaliseLower: 1,
			normaliseUpper: 99,
			claheWidth: 0,
			claheHeight: 0,
			claheMaxSlope: 3,
			brightness: 1,
			saturation: 1,
			hue: 0,
			lightness: 0,
			booleanBufferIn: null,
			booleanFileIn: "",
			joinChannelIn: [],
			extractChannel: -1,
			removeAlpha: !1,
			ensureAlpha: -1,
			colourspace: "srgb",
			colourspacePipeline: "last",
			composite: [],
			fileOut: "",
			formatOut: "input",
			streamOut: !1,
			keepMetadata: 0,
			withMetadataOrientation: -1,
			withMetadataDensity: 0,
			withIccProfile: "",
			withExif: {},
			withExifMerge: !0,
			withXmp: "",
			resolveWithObject: !1,
			loop: -1,
			delay: [],
			jpegQuality: 80,
			jpegProgressive: !1,
			jpegChromaSubsampling: "4:2:0",
			jpegTrellisQuantisation: !1,
			jpegOvershootDeringing: !1,
			jpegOptimiseScans: !1,
			jpegOptimiseCoding: !0,
			jpegQuantisationTable: 0,
			pngProgressive: !1,
			pngCompressionLevel: 6,
			pngAdaptiveFiltering: !1,
			pngPalette: !1,
			pngQuality: 100,
			pngEffort: 7,
			pngBitdepth: 8,
			pngDither: 1,
			jp2Quality: 80,
			jp2TileHeight: 512,
			jp2TileWidth: 512,
			jp2Lossless: !1,
			jp2ChromaSubsampling: "4:4:4",
			webpQuality: 80,
			webpAlphaQuality: 100,
			webpLossless: !1,
			webpNearLossless: !1,
			webpSmartSubsample: !1,
			webpSmartDeblock: !1,
			webpPreset: "default",
			webpEffort: 4,
			webpMinSize: !1,
			webpMixed: !1,
			gifBitdepth: 8,
			gifEffort: 7,
			gifDither: 1,
			gifInterFrameMaxError: 0,
			gifInterPaletteMaxError: 3,
			gifKeepDuplicateFrames: !1,
			gifReuse: !0,
			gifProgressive: !1,
			tiffQuality: 80,
			tiffCompression: "jpeg",
			tiffBigtiff: !1,
			tiffPredictor: "horizontal",
			tiffPyramid: !1,
			tiffMiniswhite: !1,
			tiffBitdepth: 8,
			tiffTile: !1,
			tiffTileHeight: 256,
			tiffTileWidth: 256,
			tiffXres: 1,
			tiffYres: 1,
			tiffResolutionUnit: "inch",
			heifQuality: 50,
			heifLossless: !1,
			heifCompression: "av1",
			heifEffort: 4,
			heifChromaSubsampling: "4:4:4",
			heifBitdepth: 8,
			jxlDistance: 1,
			jxlDecodingTier: 0,
			jxlEffort: 7,
			jxlLossless: !1,
			rawDepth: "uchar",
			tileSize: 256,
			tileOverlap: 0,
			tileContainer: "fs",
			tileLayout: "dz",
			tileFormat: "last",
			tileDepth: "last",
			tileAngle: 0,
			tileSkipBlanks: -1,
			tileBackground: [
				255,
				255,
				255,
				255
			],
			tileCentre: !1,
			tileId: "https://example.com/iiif",
			tileBasename: "",
			timeoutSeconds: 0,
			linearA: [],
			linearB: [],
			pdfBackground: [
				255,
				255,
				255,
				255
			],
			debuglog: (e) => {
				this.emit("warning", e), a(e);
			},
			queueListener: o
		}, this.options.input = this._createInputDescriptor(e, t, { allowStream: !0 }), this) : new s(e, t);
	};
	Object.setPrototypeOf(s.prototype, r.Duplex.prototype), Object.setPrototypeOf(s, r.Duplex);
	function c() {
		let e = this.constructor.call(), { debuglog: t, queueListener: n, ...r } = this.options;
		return e.options = structuredClone(r), e.options.debuglog = t, e.options.queueListener = n, this._isStreamInput() && this.on("finish", () => {
			this._flattenBufferIn(), e.options.input.buffer = this.options.input.buffer, e.emit("finish");
		}), e;
	}
	Object.assign(s.prototype, { clone: c }), t.exports = s;
})), qt = /* @__PURE__ */ O(((e, t) => {
	var n = Xe(), r = Gt(), i = {
		left: "low",
		top: "low",
		low: "low",
		center: "centre",
		centre: "centre",
		right: "high",
		bottom: "high",
		high: "high"
	}, a = [
		"failOn",
		"limitInputPixels",
		"unlimited",
		"animated",
		"autoOrient",
		"density",
		"ignoreIcc",
		"page",
		"pages",
		"sequentialRead",
		"jp2",
		"openSlide",
		"pdf",
		"raw",
		"svg",
		"tiff",
		"failOnError",
		"openSlideLevel",
		"pdfBackground",
		"tiffSubifd"
	];
	function o(e) {
		let t = a.filter((t) => n.defined(e[t])).map((t) => [t, e[t]]);
		return t.length ? Object.fromEntries(t) : void 0;
	}
	function s(e, t, r) {
		let i = {
			autoOrient: !1,
			failOn: "warning",
			limitInputPixels: 16383 ** 2,
			ignoreIcc: !1,
			unlimited: !1,
			sequentialRead: !0
		};
		if (n.string(e)) i.file = e;
		else if (n.buffer(e)) {
			if (e.length === 0) throw Error("Input Buffer is empty");
			i.buffer = e;
		} else if (n.arrayBuffer(e)) {
			if (e.byteLength === 0) throw Error("Input bit Array is empty");
			i.buffer = Buffer.from(e, 0, e.byteLength);
		} else if (n.typedArray(e)) {
			if (e.length === 0) throw Error("Input Bit Array is empty");
			i.buffer = Buffer.from(e.buffer, e.byteOffset, e.byteLength);
		} else if (n.plainObject(e) && !n.defined(t)) t = e, o(t) && (i.buffer = []);
		else if (!n.defined(e) && !n.defined(t) && n.object(r) && r.allowStream) i.buffer = [];
		else if (Array.isArray(e)) {
			if (e.length > 1) {
				if (!this.options.joining) this.options.joining = !0, this.options.join = e.map((e) => this._createInputDescriptor(e));
				else throw Error("Recursive join is unsupported");
			} else throw Error("Expected at least two images to join");
		} else throw Error(`Unsupported input '${e}' of type ${typeof e}${n.defined(t) ? ` when also providing options of type ${typeof t}` : ""}`);
		if (n.object(t)) {
			if (n.defined(t.failOnError)) {
				if (n.bool(t.failOnError)) i.failOn = t.failOnError ? "warning" : "none";
				else throw n.invalidParameterError("failOnError", "boolean", t.failOnError);
			}
			if (n.defined(t.failOn)) {
				if (n.string(t.failOn) && n.inArray(t.failOn, [
					"none",
					"truncated",
					"error",
					"warning"
				])) i.failOn = t.failOn;
				else throw n.invalidParameterError("failOn", "one of: none, truncated, error, warning", t.failOn);
			}
			if (n.defined(t.autoOrient)) {
				if (n.bool(t.autoOrient)) i.autoOrient = t.autoOrient;
				else throw n.invalidParameterError("autoOrient", "boolean", t.autoOrient);
			}
			if (n.defined(t.density)) {
				if (n.inRange(t.density, 1, 1e5)) i.density = t.density;
				else throw n.invalidParameterError("density", "number between 1 and 100000", t.density);
			}
			if (n.defined(t.ignoreIcc)) {
				if (n.bool(t.ignoreIcc)) i.ignoreIcc = t.ignoreIcc;
				else throw n.invalidParameterError("ignoreIcc", "boolean", t.ignoreIcc);
			}
			if (n.defined(t.limitInputPixels)) {
				if (n.bool(t.limitInputPixels)) i.limitInputPixels = t.limitInputPixels ? 16383 ** 2 : 0;
				else if (n.integer(t.limitInputPixels) && n.inRange(t.limitInputPixels, 0, 2 ** 53 - 1)) i.limitInputPixels = t.limitInputPixels;
				else throw n.invalidParameterError("limitInputPixels", "positive integer", t.limitInputPixels);
			}
			if (n.defined(t.unlimited)) {
				if (n.bool(t.unlimited)) i.unlimited = t.unlimited;
				else throw n.invalidParameterError("unlimited", "boolean", t.unlimited);
			}
			if (n.defined(t.sequentialRead)) {
				if (n.bool(t.sequentialRead)) i.sequentialRead = t.sequentialRead;
				else throw n.invalidParameterError("sequentialRead", "boolean", t.sequentialRead);
			}
			if (n.defined(t.raw)) {
				if (n.object(t.raw) && n.integer(t.raw.width) && t.raw.width > 0 && n.integer(t.raw.height) && t.raw.height > 0 && n.integer(t.raw.channels) && n.inRange(t.raw.channels, 1, 4)) switch (i.rawWidth = t.raw.width, i.rawHeight = t.raw.height, i.rawChannels = t.raw.channels, e.constructor) {
					case Uint8Array:
					case Uint8ClampedArray:
						i.rawDepth = "uchar";
						break;
					case Int8Array:
						i.rawDepth = "char";
						break;
					case Uint16Array:
						i.rawDepth = "ushort";
						break;
					case Int16Array:
						i.rawDepth = "short";
						break;
					case Uint32Array:
						i.rawDepth = "uint";
						break;
					case Int32Array:
						i.rawDepth = "int";
						break;
					case Float32Array:
						i.rawDepth = "float";
						break;
					case Float64Array:
						i.rawDepth = "double";
						break;
					default: i.rawDepth = "uchar";
				}
				else throw Error("Expected width, height and channels for raw pixel input");
				if (i.rawPremultiplied = !1, n.defined(t.raw.premultiplied)) {
					if (n.bool(t.raw.premultiplied)) i.rawPremultiplied = t.raw.premultiplied;
					else throw n.invalidParameterError("raw.premultiplied", "boolean", t.raw.premultiplied);
				}
				if (i.rawPageHeight = 0, n.defined(t.raw.pageHeight)) {
					if (n.integer(t.raw.pageHeight) && t.raw.pageHeight > 0 && t.raw.pageHeight <= t.raw.height) {
						if (t.raw.height % t.raw.pageHeight !== 0) throw Error(`Expected raw.height ${t.raw.height} to be a multiple of raw.pageHeight ${t.raw.pageHeight}`);
						i.rawPageHeight = t.raw.pageHeight;
					} else throw n.invalidParameterError("raw.pageHeight", "positive integer", t.raw.pageHeight);
				}
			}
			if (n.defined(t.animated)) {
				if (n.bool(t.animated)) i.pages = t.animated ? -1 : 1;
				else throw n.invalidParameterError("animated", "boolean", t.animated);
			}
			if (n.defined(t.pages)) {
				if (n.integer(t.pages) && n.inRange(t.pages, -1, 1e5)) i.pages = t.pages;
				else throw n.invalidParameterError("pages", "integer between -1 and 100000", t.pages);
			}
			if (n.defined(t.page)) {
				if (n.integer(t.page) && n.inRange(t.page, 0, 1e5)) i.page = t.page;
				else throw n.invalidParameterError("page", "integer between 0 and 100000", t.page);
			}
			if (n.object(t.openSlide) && n.defined(t.openSlide.level)) {
				if (n.integer(t.openSlide.level) && n.inRange(t.openSlide.level, 0, 256)) i.openSlideLevel = t.openSlide.level;
				else throw n.invalidParameterError("openSlide.level", "integer between 0 and 256", t.openSlide.level);
			} else if (n.defined(t.level)) {
				if (n.integer(t.level) && n.inRange(t.level, 0, 256)) i.openSlideLevel = t.level;
				else throw n.invalidParameterError("level", "integer between 0 and 256", t.level);
			}
			if (n.object(t.tiff) && n.defined(t.tiff.subifd)) {
				if (n.integer(t.tiff.subifd) && n.inRange(t.tiff.subifd, -1, 1e5)) i.tiffSubifd = t.tiff.subifd;
				else throw n.invalidParameterError("tiff.subifd", "integer between -1 and 100000", t.tiff.subifd);
			} else if (n.defined(t.subifd)) {
				if (n.integer(t.subifd) && n.inRange(t.subifd, -1, 1e5)) i.tiffSubifd = t.subifd;
				else throw n.invalidParameterError("subifd", "integer between -1 and 100000", t.subifd);
			}
			if (n.object(t.svg)) {
				if (n.defined(t.svg.stylesheet)) {
					if (n.string(t.svg.stylesheet)) i.svgStylesheet = t.svg.stylesheet;
					else throw n.invalidParameterError("svg.stylesheet", "string", t.svg.stylesheet);
				}
				if (n.defined(t.svg.highBitdepth)) {
					if (n.bool(t.svg.highBitdepth)) i.svgHighBitdepth = t.svg.highBitdepth;
					else throw n.invalidParameterError("svg.highBitdepth", "boolean", t.svg.highBitdepth);
				}
			}
			if (n.object(t.pdf) && n.defined(t.pdf.background) ? i.pdfBackground = this._getBackgroundColourOption(t.pdf.background) : n.defined(t.pdfBackground) && (i.pdfBackground = this._getBackgroundColourOption(t.pdfBackground)), n.object(t.jp2) && n.defined(t.jp2.oneshot)) {
				if (n.bool(t.jp2.oneshot)) i.jp2Oneshot = t.jp2.oneshot;
				else throw n.invalidParameterError("jp2.oneshot", "boolean", t.jp2.oneshot);
			}
			if (n.defined(t.create)) {
				if (n.object(t.create) && n.integer(t.create.width) && t.create.width > 0 && n.integer(t.create.height) && t.create.height > 0 && n.integer(t.create.channels)) {
					if (i.createWidth = t.create.width, i.createHeight = t.create.height, i.createChannels = t.create.channels, i.createPageHeight = 0, n.defined(t.create.pageHeight)) {
						if (n.integer(t.create.pageHeight) && t.create.pageHeight > 0 && t.create.pageHeight <= t.create.height) {
							if (t.create.height % t.create.pageHeight !== 0) throw Error(`Expected create.height ${t.create.height} to be a multiple of create.pageHeight ${t.create.pageHeight}`);
							i.createPageHeight = t.create.pageHeight;
						} else throw n.invalidParameterError("create.pageHeight", "positive integer", t.create.pageHeight);
					}
					if (n.defined(t.create.noise)) {
						if (!n.object(t.create.noise)) throw Error("Expected noise to be an object");
						if (t.create.noise.type !== "gaussian") throw Error("Only gaussian noise is supported at the moment");
						if (i.createNoiseType = t.create.noise.type, !n.inRange(t.create.channels, 1, 4)) throw n.invalidParameterError("create.channels", "number between 1 and 4", t.create.channels);
						if (i.createNoiseMean = 128, n.defined(t.create.noise.mean)) {
							if (n.number(t.create.noise.mean) && n.inRange(t.create.noise.mean, 0, 1e4)) i.createNoiseMean = t.create.noise.mean;
							else throw n.invalidParameterError("create.noise.mean", "number between 0 and 10000", t.create.noise.mean);
						}
						if (i.createNoiseSigma = 30, n.defined(t.create.noise.sigma)) {
							if (n.number(t.create.noise.sigma) && n.inRange(t.create.noise.sigma, 0, 1e4)) i.createNoiseSigma = t.create.noise.sigma;
							else throw n.invalidParameterError("create.noise.sigma", "number between 0 and 10000", t.create.noise.sigma);
						}
					} else if (n.defined(t.create.background)) {
						if (!n.inRange(t.create.channels, 3, 4)) throw n.invalidParameterError("create.channels", "number between 3 and 4", t.create.channels);
						i.createBackground = this._getBackgroundColourOption(t.create.background);
					} else throw Error("Expected valid noise or background to create a new input image");
					delete i.buffer;
				} else throw Error("Expected valid width, height and channels to create a new input image");
			}
			if (n.defined(t.text)) {
				if (n.object(t.text) && n.string(t.text.text)) {
					if (i.textValue = t.text.text, n.defined(t.text.height) && n.defined(t.text.dpi)) throw Error("Expected only one of dpi or height");
					if (n.defined(t.text.font)) {
						if (n.string(t.text.font)) i.textFont = t.text.font;
						else throw n.invalidParameterError("text.font", "string", t.text.font);
					}
					if (n.defined(t.text.fontfile)) {
						if (n.string(t.text.fontfile)) i.textFontfile = t.text.fontfile;
						else throw n.invalidParameterError("text.fontfile", "string", t.text.fontfile);
					}
					if (n.defined(t.text.width)) {
						if (n.integer(t.text.width) && t.text.width > 0) i.textWidth = t.text.width;
						else throw n.invalidParameterError("text.width", "positive integer", t.text.width);
					}
					if (n.defined(t.text.height)) {
						if (n.integer(t.text.height) && t.text.height > 0) i.textHeight = t.text.height;
						else throw n.invalidParameterError("text.height", "positive integer", t.text.height);
					}
					if (n.defined(t.text.align)) {
						if (n.string(t.text.align) && n.string(this.constructor.align[t.text.align])) i.textAlign = this.constructor.align[t.text.align];
						else throw n.invalidParameterError("text.align", "valid alignment", t.text.align);
					}
					if (n.defined(t.text.justify)) {
						if (n.bool(t.text.justify)) i.textJustify = t.text.justify;
						else throw n.invalidParameterError("text.justify", "boolean", t.text.justify);
					}
					if (n.defined(t.text.dpi)) {
						if (n.integer(t.text.dpi) && n.inRange(t.text.dpi, 1, 1e6)) i.textDpi = t.text.dpi;
						else throw n.invalidParameterError("text.dpi", "integer between 1 and 1000000", t.text.dpi);
					}
					if (n.defined(t.text.rgba)) {
						if (n.bool(t.text.rgba)) i.textRgba = t.text.rgba;
						else throw n.invalidParameterError("text.rgba", "bool", t.text.rgba);
					}
					if (n.defined(t.text.spacing)) {
						if (n.integer(t.text.spacing) && n.inRange(t.text.spacing, -1e6, 1e6)) i.textSpacing = t.text.spacing;
						else throw n.invalidParameterError("text.spacing", "integer between -1000000 and 1000000", t.text.spacing);
					}
					if (n.defined(t.text.wrap)) {
						if (n.string(t.text.wrap) && n.inArray(t.text.wrap, [
							"word",
							"char",
							"word-char",
							"none"
						])) i.textWrap = t.text.wrap;
						else throw n.invalidParameterError("text.wrap", "one of: word, char, word-char, none", t.text.wrap);
					}
					delete i.buffer;
				} else throw Error("Expected a valid string to create an image with text.");
			}
			if (n.defined(t.join)) {
				if (n.defined(this.options.join)) {
					if (n.defined(t.join.animated)) {
						if (n.bool(t.join.animated)) i.joinAnimated = t.join.animated;
						else throw n.invalidParameterError("join.animated", "boolean", t.join.animated);
					}
					if (n.defined(t.join.across)) {
						if (n.integer(t.join.across) && n.inRange(t.join.across, 1, 1e6)) i.joinAcross = t.join.across;
						else throw n.invalidParameterError("join.across", "integer between 1 and 100000", t.join.across);
					}
					if (n.defined(t.join.shim)) {
						if (n.integer(t.join.shim) && n.inRange(t.join.shim, 0, 1e6)) i.joinShim = t.join.shim;
						else throw n.invalidParameterError("join.shim", "integer between 0 and 100000", t.join.shim);
					}
					if (n.defined(t.join.background) && (i.joinBackground = this._getBackgroundColourOption(t.join.background)), n.defined(t.join.halign)) {
						if (n.string(t.join.halign) && n.string(this.constructor.align[t.join.halign])) i.joinHalign = this.constructor.align[t.join.halign];
						else throw n.invalidParameterError("join.halign", "valid alignment", t.join.halign);
					}
					if (n.defined(t.join.valign)) {
						if (n.string(t.join.valign) && n.string(this.constructor.align[t.join.valign])) i.joinValign = this.constructor.align[t.join.valign];
						else throw n.invalidParameterError("join.valign", "valid alignment", t.join.valign);
					}
				} else throw Error("Expected input to be an array of images to join");
			}
		} else if (n.defined(t)) throw Error(`Invalid input options ${t}`);
		return i;
	}
	function c(e, t, r) {
		Array.isArray(this.options.input.buffer) ? n.buffer(e) ? (this.options.input.buffer.length === 0 && this.on("finish", () => {
			this.streamInFinished = !0;
		}), this.options.input.buffer.push(e), r()) : r(/* @__PURE__ */ Error("Non-Buffer data on Writable Stream")) : r(/* @__PURE__ */ Error("Unexpected data on Writable Stream"));
	}
	function l() {
		this._isStreamInput() && (this.options.input.buffer = Buffer.concat(this.options.input.buffer));
	}
	function u() {
		return Array.isArray(this.options.input.buffer);
	}
	function d(e) {
		let t = Error();
		return n.fn(e) ? (this._isStreamInput() ? this.on("finish", () => {
			this._flattenBufferIn(), r.metadata(this.options, (r, i) => {
				r ? e(n.nativeError(r, t)) : e(null, i);
			});
		}) : r.metadata(this.options, (r, i) => {
			r ? e(n.nativeError(r, t)) : e(null, i);
		}), this) : this._isStreamInput() ? new Promise((e, i) => {
			let a = () => {
				this._flattenBufferIn(), r.metadata(this.options, (r, a) => {
					r ? i(n.nativeError(r, t)) : e(a);
				});
			};
			this.writableFinished ? a() : this.once("finish", a);
		}) : new Promise((e, i) => {
			r.metadata(this.options, (r, a) => {
				r ? i(n.nativeError(r, t)) : e(a);
			});
		});
	}
	function f(e) {
		let t = Error();
		return n.fn(e) ? (this._isStreamInput() ? this.on("finish", () => {
			this._flattenBufferIn(), r.stats(this.options, (r, i) => {
				r ? e(n.nativeError(r, t)) : e(null, i);
			});
		}) : r.stats(this.options, (r, i) => {
			r ? e(n.nativeError(r, t)) : e(null, i);
		}), this) : this._isStreamInput() ? new Promise((e, i) => {
			this.on("finish", function() {
				this._flattenBufferIn(), r.stats(this.options, (r, a) => {
					r ? i(n.nativeError(r, t)) : e(a);
				});
			});
		}) : new Promise((e, i) => {
			r.stats(this.options, (r, a) => {
				r ? i(n.nativeError(r, t)) : e(a);
			});
		});
	}
	t.exports = (e) => {
		Object.assign(e.prototype, {
			_inputOptionsFromObject: o,
			_createInputDescriptor: s,
			_write: c,
			_flattenBufferIn: l,
			_isStreamInput: u,
			metadata: d,
			stats: f
		}), e.align = i;
	};
})), Jt = /* @__PURE__ */ O(((e, t) => {
	var n = Xe(), r = {
		center: 0,
		centre: 0,
		north: 1,
		east: 2,
		south: 3,
		west: 4,
		northeast: 5,
		southeast: 6,
		southwest: 7,
		northwest: 8
	}, i = {
		top: 1,
		right: 2,
		bottom: 3,
		left: 4,
		"right top": 5,
		"right bottom": 6,
		"left bottom": 7,
		"left top": 8
	}, a = {
		background: "background",
		copy: "copy",
		repeat: "repeat",
		mirror: "mirror"
	}, o = {
		entropy: 16,
		attention: 17
	}, s = {
		nearest: "nearest",
		linear: "linear",
		cubic: "cubic",
		mitchell: "mitchell",
		lanczos2: "lanczos2",
		lanczos3: "lanczos3",
		mks2013: "mks2013",
		mks2021: "mks2021"
	}, c = {
		contain: "contain",
		cover: "cover",
		fill: "fill",
		inside: "inside",
		outside: "outside"
	}, l = {
		contain: "embed",
		cover: "crop",
		fill: "ignore_aspect",
		inside: "max",
		outside: "min"
	};
	function u(e) {
		return e.angle % 360 != 0 || e.rotationAngle !== 0;
	}
	function d(e) {
		return e.width !== -1 || e.height !== -1;
	}
	function f(e, t, a) {
		if (d(this.options) && this.options.debuglog("ignoring previous resize options"), this.options.widthPost !== -1 && this.options.debuglog("operation order will be: extract, resize, extract"), n.defined(e)) {
			if (n.object(e) && !n.defined(a)) a = e;
			else if (n.integer(e) && e > 0) this.options.width = e;
			else throw n.invalidParameterError("width", "positive integer", e);
		} else this.options.width = -1;
		if (n.defined(t)) {
			if (n.integer(t) && t > 0) this.options.height = t;
			else throw n.invalidParameterError("height", "positive integer", t);
		} else this.options.height = -1;
		if (n.object(a)) {
			if (n.defined(a.width)) {
				if (n.integer(a.width) && a.width > 0) this.options.width = a.width;
				else throw n.invalidParameterError("width", "positive integer", a.width);
			}
			if (n.defined(a.height)) {
				if (n.integer(a.height) && a.height > 0) this.options.height = a.height;
				else throw n.invalidParameterError("height", "positive integer", a.height);
			}
			if (n.defined(a.fit)) {
				let e = l[a.fit];
				if (n.string(e)) this.options.canvas = e;
				else throw n.invalidParameterError("fit", "valid fit", a.fit);
			}
			if (n.defined(a.position)) {
				let e = n.integer(a.position) ? a.position : o[a.position] || i[a.position] || r[a.position];
				if (n.integer(e) && (n.inRange(e, 0, 8) || n.inRange(e, 16, 17))) this.options.position = e;
				else throw n.invalidParameterError("position", "valid position/gravity/strategy", a.position);
			}
			if (this._setBackgroundColourOption("resizeBackground", a.background), n.defined(a.kernel)) {
				if (n.string(s[a.kernel])) this.options.kernel = s[a.kernel];
				else throw n.invalidParameterError("kernel", "valid kernel name", a.kernel);
			}
			n.defined(a.withoutEnlargement) && this._setBooleanOption("withoutEnlargement", a.withoutEnlargement), n.defined(a.withoutReduction) && this._setBooleanOption("withoutReduction", a.withoutReduction), n.defined(a.fastShrinkOnLoad) && this._setBooleanOption("fastShrinkOnLoad", a.fastShrinkOnLoad);
		}
		return u(this.options) && d(this.options) && (this.options.rotateBefore = !0), this;
	}
	function p(e) {
		if (n.integer(e) && e > 0) this.options.extendTop = e, this.options.extendBottom = e, this.options.extendLeft = e, this.options.extendRight = e;
		else if (n.object(e)) {
			if (n.defined(e.top)) {
				if (n.integer(e.top) && e.top >= 0) this.options.extendTop = e.top;
				else throw n.invalidParameterError("top", "positive integer", e.top);
			}
			if (n.defined(e.bottom)) {
				if (n.integer(e.bottom) && e.bottom >= 0) this.options.extendBottom = e.bottom;
				else throw n.invalidParameterError("bottom", "positive integer", e.bottom);
			}
			if (n.defined(e.left)) {
				if (n.integer(e.left) && e.left >= 0) this.options.extendLeft = e.left;
				else throw n.invalidParameterError("left", "positive integer", e.left);
			}
			if (n.defined(e.right)) {
				if (n.integer(e.right) && e.right >= 0) this.options.extendRight = e.right;
				else throw n.invalidParameterError("right", "positive integer", e.right);
			}
			if (this._setBackgroundColourOption("extendBackground", e.background), n.defined(e.extendWith)) {
				if (n.string(a[e.extendWith])) this.options.extendWith = a[e.extendWith];
				else throw n.invalidParameterError("extendWith", "one of: background, copy, repeat, mirror", e.extendWith);
			}
		} else throw n.invalidParameterError("extend", "integer or object", e);
		return this;
	}
	function m(e) {
		let t = d(this.options) || this.options.widthPre !== -1 ? "Post" : "Pre";
		return this.options[`width${t}`] !== -1 && this.options.debuglog("ignoring previous extract options"), [
			"left",
			"top",
			"width",
			"height"
		].forEach(function(r) {
			let i = e[r];
			if (n.integer(i) && i >= 0) this.options[r + (r === "left" || r === "top" ? "Offset" : "") + t] = i;
			else throw n.invalidParameterError(r, "integer", i);
		}, this), u(this.options) && !d(this.options) && (this.options.widthPre === -1 || this.options.widthPost === -1) && (this.options.rotateBefore = !0), this.options.input.autoOrient && (this.options.orientBefore = !0), this;
	}
	function h(e) {
		if (this.options.trimThreshold = 10, n.defined(e)) {
			if (n.object(e)) {
				if (n.defined(e.background) && this._setBackgroundColourOption("trimBackground", e.background), n.defined(e.threshold)) {
					if (n.number(e.threshold) && e.threshold >= 0) this.options.trimThreshold = e.threshold;
					else throw n.invalidParameterError("threshold", "positive number", e.threshold);
				}
				n.defined(e.lineArt) && this._setBooleanOption("trimLineArt", e.lineArt);
			} else throw n.invalidParameterError("trim", "object", e);
		}
		return u(this.options) && (this.options.rotateBefore = !0), this;
	}
	t.exports = (e) => {
		Object.assign(e.prototype, {
			resize: f,
			extend: p,
			extract: m,
			trim: h
		}), e.gravity = r, e.strategy = o, e.kernel = s, e.fit = c, e.position = i;
	};
})), Yt = /* @__PURE__ */ O(((e, t) => {
	var n = Xe(), r = {
		clear: "clear",
		source: "source",
		over: "over",
		in: "in",
		out: "out",
		atop: "atop",
		dest: "dest",
		"dest-over": "dest-over",
		"dest-in": "dest-in",
		"dest-out": "dest-out",
		"dest-atop": "dest-atop",
		xor: "xor",
		add: "add",
		saturate: "saturate",
		multiply: "multiply",
		screen: "screen",
		overlay: "overlay",
		darken: "darken",
		lighten: "lighten",
		"colour-dodge": "colour-dodge",
		"color-dodge": "colour-dodge",
		"colour-burn": "colour-burn",
		"color-burn": "colour-burn",
		"hard-light": "hard-light",
		"soft-light": "soft-light",
		difference: "difference",
		exclusion: "exclusion"
	};
	function i(e) {
		if (!Array.isArray(e)) throw n.invalidParameterError("images to composite", "array", e);
		return this.options.composite = e.map((e) => {
			if (!n.object(e)) throw n.invalidParameterError("image to composite", "object", e);
			let t = this._inputOptionsFromObject(e), i = {
				input: this._createInputDescriptor(e.input, t, { allowStream: !1 }),
				blend: "over",
				tile: !1,
				left: 0,
				top: 0,
				hasOffset: !1,
				gravity: 0,
				premultiplied: !1
			};
			if (n.defined(e.blend)) {
				if (n.string(r[e.blend])) i.blend = r[e.blend];
				else throw n.invalidParameterError("blend", "valid blend name", e.blend);
			}
			if (n.defined(e.tile)) {
				if (n.bool(e.tile)) i.tile = e.tile;
				else throw n.invalidParameterError("tile", "boolean", e.tile);
			}
			if (n.defined(e.left)) {
				if (n.integer(e.left)) i.left = e.left;
				else throw n.invalidParameterError("left", "integer", e.left);
			}
			if (n.defined(e.top)) {
				if (n.integer(e.top)) i.top = e.top;
				else throw n.invalidParameterError("top", "integer", e.top);
			}
			if (n.defined(e.top) !== n.defined(e.left)) throw Error("Expected both left and top to be set");
			if (i.hasOffset = n.integer(e.top) && n.integer(e.left), n.defined(e.gravity)) {
				if (n.integer(e.gravity) && n.inRange(e.gravity, 0, 8)) i.gravity = e.gravity;
				else if (n.string(e.gravity) && n.integer(this.constructor.gravity[e.gravity])) i.gravity = this.constructor.gravity[e.gravity];
				else throw n.invalidParameterError("gravity", "valid gravity", e.gravity);
			}
			if (n.defined(e.premultiplied)) {
				if (n.bool(e.premultiplied)) i.premultiplied = e.premultiplied;
				else throw n.invalidParameterError("premultiplied", "boolean", e.premultiplied);
			}
			return i;
		}), this;
	}
	t.exports = (e) => {
		e.prototype.composite = i, e.blend = r;
	};
})), Xt = /* @__PURE__ */ O(((e, t) => {
	var n = Xe(), r = {
		integer: "integer",
		float: "float",
		approximate: "approximate"
	};
	function i(e, t) {
		if (!n.defined(e)) return this.autoOrient();
		if ((this.options.angle || this.options.rotationAngle) && (this.options.debuglog("ignoring previous rotate options"), this.options.angle = 0, this.options.rotationAngle = 0), n.integer(e) && !(e % 90)) this.options.angle = e;
		else if (n.number(e)) this.options.rotationAngle = e, n.object(t) && t.background && this._setBackgroundColourOption("rotationBackground", t.background);
		else throw n.invalidParameterError("angle", "numeric", e);
		return this;
	}
	function a() {
		return this.options.input.autoOrient = !0, this;
	}
	function o(e) {
		return this.options.flip = !n.bool(e) || e, this;
	}
	function s(e) {
		return this.options.flop = !n.bool(e) || e, this;
	}
	function c(e, t) {
		let r = [].concat(...e);
		if (r.length === 4 && r.every(n.number)) this.options.affineMatrix = r;
		else throw n.invalidParameterError("matrix", "1x4 or 2x2 array", e);
		if (n.defined(t)) {
			if (n.object(t)) {
				if (this._setBackgroundColourOption("affineBackground", t.background), n.defined(t.idx)) {
					if (n.number(t.idx)) this.options.affineIdx = t.idx;
					else throw n.invalidParameterError("options.idx", "number", t.idx);
				}
				if (n.defined(t.idy)) {
					if (n.number(t.idy)) this.options.affineIdy = t.idy;
					else throw n.invalidParameterError("options.idy", "number", t.idy);
				}
				if (n.defined(t.odx)) {
					if (n.number(t.odx)) this.options.affineOdx = t.odx;
					else throw n.invalidParameterError("options.odx", "number", t.odx);
				}
				if (n.defined(t.ody)) {
					if (n.number(t.ody)) this.options.affineOdy = t.ody;
					else throw n.invalidParameterError("options.ody", "number", t.ody);
				}
				if (n.defined(t.interpolator)) {
					if (n.inArray(t.interpolator, Object.values(this.constructor.interpolators))) this.options.affineInterpolator = t.interpolator;
					else throw n.invalidParameterError("options.interpolator", "valid interpolator name", t.interpolator);
				}
			} else throw n.invalidParameterError("options", "object", t);
		}
		return this;
	}
	function l(e, t, r) {
		if (!n.defined(e)) this.options.sharpenSigma = -1;
		else if (n.bool(e)) this.options.sharpenSigma = e ? -1 : 0;
		else if (n.number(e) && n.inRange(e, .01, 1e4)) {
			if (this.options.sharpenSigma = e, n.defined(t)) {
				if (n.number(t) && n.inRange(t, 0, 1e4)) this.options.sharpenM1 = t;
				else throw n.invalidParameterError("flat", "number between 0 and 10000", t);
			}
			if (n.defined(r)) {
				if (n.number(r) && n.inRange(r, 0, 1e4)) this.options.sharpenM2 = r;
				else throw n.invalidParameterError("jagged", "number between 0 and 10000", r);
			}
		} else if (n.plainObject(e)) {
			if (n.number(e.sigma) && n.inRange(e.sigma, 1e-6, 10)) this.options.sharpenSigma = e.sigma;
			else throw n.invalidParameterError("options.sigma", "number between 0.000001 and 10", e.sigma);
			if (n.defined(e.m1)) {
				if (n.number(e.m1) && n.inRange(e.m1, 0, 1e6)) this.options.sharpenM1 = e.m1;
				else throw n.invalidParameterError("options.m1", "number between 0 and 1000000", e.m1);
			}
			if (n.defined(e.m2)) {
				if (n.number(e.m2) && n.inRange(e.m2, 0, 1e6)) this.options.sharpenM2 = e.m2;
				else throw n.invalidParameterError("options.m2", "number between 0 and 1000000", e.m2);
			}
			if (n.defined(e.x1)) {
				if (n.number(e.x1) && n.inRange(e.x1, 0, 1e6)) this.options.sharpenX1 = e.x1;
				else throw n.invalidParameterError("options.x1", "number between 0 and 1000000", e.x1);
			}
			if (n.defined(e.y2)) {
				if (n.number(e.y2) && n.inRange(e.y2, 0, 1e6)) this.options.sharpenY2 = e.y2;
				else throw n.invalidParameterError("options.y2", "number between 0 and 1000000", e.y2);
			}
			if (n.defined(e.y3)) {
				if (n.number(e.y3) && n.inRange(e.y3, 0, 1e6)) this.options.sharpenY3 = e.y3;
				else throw n.invalidParameterError("options.y3", "number between 0 and 1000000", e.y3);
			}
		} else throw n.invalidParameterError("sigma", "number between 0.01 and 10000", e);
		return this;
	}
	function u(e) {
		if (!n.defined(e)) this.options.medianSize = 3;
		else if (n.integer(e) && n.inRange(e, 1, 1e3)) this.options.medianSize = e;
		else throw n.invalidParameterError("size", "integer between 1 and 1000", e);
		return this;
	}
	function d(e) {
		let t;
		if (n.number(e)) t = e;
		else if (n.plainObject(e)) {
			if (!n.number(e.sigma)) throw n.invalidParameterError("options.sigma", "number between 0.3 and 1000", t);
			if (t = e.sigma, "precision" in e) {
				if (n.string(r[e.precision])) this.options.precision = r[e.precision];
				else throw n.invalidParameterError("precision", "one of: integer, float, approximate", e.precision);
			}
			if ("minAmplitude" in e) {
				if (n.number(e.minAmplitude) && n.inRange(e.minAmplitude, .001, 1)) this.options.minAmpl = e.minAmplitude;
				else throw n.invalidParameterError("minAmplitude", "number between 0.001 and 1", e.minAmplitude);
			}
		}
		if (!n.defined(e)) this.options.blurSigma = -1;
		else if (n.bool(e)) this.options.blurSigma = e ? -1 : 0;
		else if (n.number(t) && n.inRange(t, .3, 1e3)) this.options.blurSigma = t;
		else throw n.invalidParameterError("sigma", "number between 0.3 and 1000", t);
		return this;
	}
	function f(e) {
		if (!n.defined(e)) this.options.dilateWidth = 1;
		else if (n.integer(e) && e > 0) this.options.dilateWidth = e;
		else throw n.invalidParameterError("dilate", "positive integer", f);
		return this;
	}
	function p(e) {
		if (!n.defined(e)) this.options.erodeWidth = 1;
		else if (n.integer(e) && e > 0) this.options.erodeWidth = e;
		else throw n.invalidParameterError("erode", "positive integer", p);
		return this;
	}
	function m(e) {
		return this.options.flatten = !n.bool(e) || e, n.object(e) && this._setBackgroundColourOption("flattenBackground", e.background), this;
	}
	function h() {
		return this.options.unflatten = !0, this;
	}
	function g(e, t) {
		if (!n.defined(e)) this.options.gamma = 2.2;
		else if (n.number(e) && n.inRange(e, 1, 3)) this.options.gamma = e;
		else throw n.invalidParameterError("gamma", "number between 1.0 and 3.0", e);
		if (!n.defined(t)) this.options.gammaOut = this.options.gamma;
		else if (n.number(t) && n.inRange(t, 1, 3)) this.options.gammaOut = t;
		else throw n.invalidParameterError("gammaOut", "number between 1.0 and 3.0", t);
		return this;
	}
	function _(e) {
		if (this.options.negate = !n.bool(e) || e, n.plainObject(e) && "alpha" in e) {
			if (n.bool(e.alpha)) this.options.negateAlpha = e.alpha;
			else throw n.invalidParameterError("alpha", "should be boolean value", e.alpha);
		}
		return this;
	}
	function v(e) {
		if (n.plainObject(e)) {
			if (n.defined(e.lower)) {
				if (n.number(e.lower) && n.inRange(e.lower, 0, 99)) this.options.normaliseLower = e.lower;
				else throw n.invalidParameterError("lower", "number between 0 and 99", e.lower);
			}
			if (n.defined(e.upper)) {
				if (n.number(e.upper) && n.inRange(e.upper, 1, 100)) this.options.normaliseUpper = e.upper;
				else throw n.invalidParameterError("upper", "number between 1 and 100", e.upper);
			}
		}
		if (this.options.normaliseLower >= this.options.normaliseUpper) throw n.invalidParameterError("range", "lower to be less than upper", `${this.options.normaliseLower} >= ${this.options.normaliseUpper}`);
		return this.options.normalise = !0, this;
	}
	function y(e) {
		return this.normalise(e);
	}
	function b(e) {
		if (n.plainObject(e)) {
			if (n.integer(e.width) && e.width > 0) this.options.claheWidth = e.width;
			else throw n.invalidParameterError("width", "integer greater than zero", e.width);
			if (n.integer(e.height) && e.height > 0) this.options.claheHeight = e.height;
			else throw n.invalidParameterError("height", "integer greater than zero", e.height);
			if (n.defined(e.maxSlope)) {
				if (n.integer(e.maxSlope) && n.inRange(e.maxSlope, 0, 100)) this.options.claheMaxSlope = e.maxSlope;
				else throw n.invalidParameterError("maxSlope", "integer between 0 and 100", e.maxSlope);
			}
		} else throw n.invalidParameterError("options", "plain object", e);
		return this;
	}
	function x(e) {
		if (!n.object(e) || !Array.isArray(e.kernel) || !n.integer(e.width) || !n.integer(e.height) || !n.inRange(e.width, 3, 1001) || !n.inRange(e.height, 3, 1001) || e.height * e.width !== e.kernel.length) throw Error("Invalid convolution kernel");
		return n.integer(e.scale) || (e.scale = e.kernel.reduce((e, t) => e + t, 0)), e.scale < 1 && (e.scale = 1), n.integer(e.offset) || (e.offset = 0), this.options.convKernel = e, this;
	}
	function S(e, t) {
		if (!n.defined(e)) this.options.threshold = 128;
		else if (n.bool(e)) this.options.threshold = e ? 128 : 0;
		else if (n.integer(e) && n.inRange(e, 0, 255)) this.options.threshold = e;
		else throw n.invalidParameterError("threshold", "integer between 0 and 255", e);
		return !n.object(t) || t.greyscale === !0 || t.grayscale === !0 ? this.options.thresholdGrayscale = !0 : this.options.thresholdGrayscale = !1, this;
	}
	function C(e, t, r) {
		if (this.options.boolean = this._createInputDescriptor(e, r), n.string(t) && n.inArray(t, [
			"and",
			"or",
			"eor"
		])) this.options.booleanOp = t;
		else throw n.invalidParameterError("operator", "one of: and, or, eor", t);
		return this;
	}
	function w(e, t) {
		if (!n.defined(e) && n.number(t) ? e = 1 : n.number(e) && !n.defined(t) && (t = 0), !n.defined(e)) this.options.linearA = [];
		else if (n.number(e)) this.options.linearA = [e];
		else if (Array.isArray(e) && e.length && e.every(n.number)) this.options.linearA = e;
		else throw n.invalidParameterError("a", "number or array of numbers", e);
		if (!n.defined(t)) this.options.linearB = [];
		else if (n.number(t)) this.options.linearB = [t];
		else if (Array.isArray(t) && t.length && t.every(n.number)) this.options.linearB = t;
		else throw n.invalidParameterError("b", "number or array of numbers", t);
		if (this.options.linearA.length !== this.options.linearB.length) throw Error("Expected a and b to be arrays of the same length");
		return this;
	}
	function T(e) {
		if (!Array.isArray(e)) throw n.invalidParameterError("inputMatrix", "array", e);
		if (e.length !== 3 && e.length !== 4) throw n.invalidParameterError("inputMatrix", "3x3 or 4x4 array", e.length);
		let t = e.flat().map(Number);
		if (t.length !== 9 && t.length !== 16) throw n.invalidParameterError("inputMatrix", "cardinality of 9 or 16", t.length);
		return this.options.recombMatrix = t, this;
	}
	function E(e) {
		if (!n.plainObject(e)) throw n.invalidParameterError("options", "plain object", e);
		if ("brightness" in e) {
			if (n.number(e.brightness) && e.brightness >= 0) this.options.brightness = e.brightness;
			else throw n.invalidParameterError("brightness", "number above zero", e.brightness);
		}
		if ("saturation" in e) {
			if (n.number(e.saturation) && e.saturation >= 0) this.options.saturation = e.saturation;
			else throw n.invalidParameterError("saturation", "number above zero", e.saturation);
		}
		if ("hue" in e) {
			if (n.integer(e.hue)) this.options.hue = e.hue % 360;
			else throw n.invalidParameterError("hue", "number", e.hue);
		}
		if ("lightness" in e) {
			if (n.number(e.lightness)) this.options.lightness = e.lightness;
			else throw n.invalidParameterError("lightness", "number", e.lightness);
		}
		return this;
	}
	t.exports = (e) => {
		Object.assign(e.prototype, {
			autoOrient: a,
			rotate: i,
			flip: o,
			flop: s,
			affine: c,
			sharpen: l,
			erode: p,
			dilate: f,
			median: u,
			blur: d,
			flatten: m,
			unflatten: h,
			gamma: g,
			negate: _,
			normalise: v,
			normalize: y,
			clahe: b,
			convolve: x,
			threshold: S,
			boolean: C,
			linear: w,
			recomb: T,
			modulate: E
		});
	};
})), Zt = /* @__PURE__ */ O(((e, t) => {
	var n = Object.defineProperty, r = Object.getOwnPropertyDescriptor, i = Object.getOwnPropertyNames, a = Object.prototype.hasOwnProperty, o = (e, t) => {
		for (var r in t) n(e, r, {
			get: t[r],
			enumerable: !0
		});
	}, s = (e, t, o, s) => {
		if (t && typeof t == "object" || typeof t == "function") for (let c of i(t)) !a.call(e, c) && c !== o && n(e, c, {
			get: () => t[c],
			enumerable: !(s = r(t, c)) || s.enumerable
		});
		return e;
	}, c = (e) => s(n({}, "__esModule", { value: !0 }), e), l = {};
	o(l, { default: () => se }), t.exports = c(l);
	var u = {
		aliceblue: [
			240,
			248,
			255
		],
		antiquewhite: [
			250,
			235,
			215
		],
		aqua: [
			0,
			255,
			255
		],
		aquamarine: [
			127,
			255,
			212
		],
		azure: [
			240,
			255,
			255
		],
		beige: [
			245,
			245,
			220
		],
		bisque: [
			255,
			228,
			196
		],
		black: [
			0,
			0,
			0
		],
		blanchedalmond: [
			255,
			235,
			205
		],
		blue: [
			0,
			0,
			255
		],
		blueviolet: [
			138,
			43,
			226
		],
		brown: [
			165,
			42,
			42
		],
		burlywood: [
			222,
			184,
			135
		],
		cadetblue: [
			95,
			158,
			160
		],
		chartreuse: [
			127,
			255,
			0
		],
		chocolate: [
			210,
			105,
			30
		],
		coral: [
			255,
			127,
			80
		],
		cornflowerblue: [
			100,
			149,
			237
		],
		cornsilk: [
			255,
			248,
			220
		],
		crimson: [
			220,
			20,
			60
		],
		cyan: [
			0,
			255,
			255
		],
		darkblue: [
			0,
			0,
			139
		],
		darkcyan: [
			0,
			139,
			139
		],
		darkgoldenrod: [
			184,
			134,
			11
		],
		darkgray: [
			169,
			169,
			169
		],
		darkgreen: [
			0,
			100,
			0
		],
		darkgrey: [
			169,
			169,
			169
		],
		darkkhaki: [
			189,
			183,
			107
		],
		darkmagenta: [
			139,
			0,
			139
		],
		darkolivegreen: [
			85,
			107,
			47
		],
		darkorange: [
			255,
			140,
			0
		],
		darkorchid: [
			153,
			50,
			204
		],
		darkred: [
			139,
			0,
			0
		],
		darksalmon: [
			233,
			150,
			122
		],
		darkseagreen: [
			143,
			188,
			143
		],
		darkslateblue: [
			72,
			61,
			139
		],
		darkslategray: [
			47,
			79,
			79
		],
		darkslategrey: [
			47,
			79,
			79
		],
		darkturquoise: [
			0,
			206,
			209
		],
		darkviolet: [
			148,
			0,
			211
		],
		deeppink: [
			255,
			20,
			147
		],
		deepskyblue: [
			0,
			191,
			255
		],
		dimgray: [
			105,
			105,
			105
		],
		dimgrey: [
			105,
			105,
			105
		],
		dodgerblue: [
			30,
			144,
			255
		],
		firebrick: [
			178,
			34,
			34
		],
		floralwhite: [
			255,
			250,
			240
		],
		forestgreen: [
			34,
			139,
			34
		],
		fuchsia: [
			255,
			0,
			255
		],
		gainsboro: [
			220,
			220,
			220
		],
		ghostwhite: [
			248,
			248,
			255
		],
		gold: [
			255,
			215,
			0
		],
		goldenrod: [
			218,
			165,
			32
		],
		gray: [
			128,
			128,
			128
		],
		green: [
			0,
			128,
			0
		],
		greenyellow: [
			173,
			255,
			47
		],
		grey: [
			128,
			128,
			128
		],
		honeydew: [
			240,
			255,
			240
		],
		hotpink: [
			255,
			105,
			180
		],
		indianred: [
			205,
			92,
			92
		],
		indigo: [
			75,
			0,
			130
		],
		ivory: [
			255,
			255,
			240
		],
		khaki: [
			240,
			230,
			140
		],
		lavender: [
			230,
			230,
			250
		],
		lavenderblush: [
			255,
			240,
			245
		],
		lawngreen: [
			124,
			252,
			0
		],
		lemonchiffon: [
			255,
			250,
			205
		],
		lightblue: [
			173,
			216,
			230
		],
		lightcoral: [
			240,
			128,
			128
		],
		lightcyan: [
			224,
			255,
			255
		],
		lightgoldenrodyellow: [
			250,
			250,
			210
		],
		lightgray: [
			211,
			211,
			211
		],
		lightgreen: [
			144,
			238,
			144
		],
		lightgrey: [
			211,
			211,
			211
		],
		lightpink: [
			255,
			182,
			193
		],
		lightsalmon: [
			255,
			160,
			122
		],
		lightseagreen: [
			32,
			178,
			170
		],
		lightskyblue: [
			135,
			206,
			250
		],
		lightslategray: [
			119,
			136,
			153
		],
		lightslategrey: [
			119,
			136,
			153
		],
		lightsteelblue: [
			176,
			196,
			222
		],
		lightyellow: [
			255,
			255,
			224
		],
		lime: [
			0,
			255,
			0
		],
		limegreen: [
			50,
			205,
			50
		],
		linen: [
			250,
			240,
			230
		],
		magenta: [
			255,
			0,
			255
		],
		maroon: [
			128,
			0,
			0
		],
		mediumaquamarine: [
			102,
			205,
			170
		],
		mediumblue: [
			0,
			0,
			205
		],
		mediumorchid: [
			186,
			85,
			211
		],
		mediumpurple: [
			147,
			112,
			219
		],
		mediumseagreen: [
			60,
			179,
			113
		],
		mediumslateblue: [
			123,
			104,
			238
		],
		mediumspringgreen: [
			0,
			250,
			154
		],
		mediumturquoise: [
			72,
			209,
			204
		],
		mediumvioletred: [
			199,
			21,
			133
		],
		midnightblue: [
			25,
			25,
			112
		],
		mintcream: [
			245,
			255,
			250
		],
		mistyrose: [
			255,
			228,
			225
		],
		moccasin: [
			255,
			228,
			181
		],
		navajowhite: [
			255,
			222,
			173
		],
		navy: [
			0,
			0,
			128
		],
		oldlace: [
			253,
			245,
			230
		],
		olive: [
			128,
			128,
			0
		],
		olivedrab: [
			107,
			142,
			35
		],
		orange: [
			255,
			165,
			0
		],
		orangered: [
			255,
			69,
			0
		],
		orchid: [
			218,
			112,
			214
		],
		palegoldenrod: [
			238,
			232,
			170
		],
		palegreen: [
			152,
			251,
			152
		],
		paleturquoise: [
			175,
			238,
			238
		],
		palevioletred: [
			219,
			112,
			147
		],
		papayawhip: [
			255,
			239,
			213
		],
		peachpuff: [
			255,
			218,
			185
		],
		peru: [
			205,
			133,
			63
		],
		pink: [
			255,
			192,
			203
		],
		plum: [
			221,
			160,
			221
		],
		powderblue: [
			176,
			224,
			230
		],
		purple: [
			128,
			0,
			128
		],
		rebeccapurple: [
			102,
			51,
			153
		],
		red: [
			255,
			0,
			0
		],
		rosybrown: [
			188,
			143,
			143
		],
		royalblue: [
			65,
			105,
			225
		],
		saddlebrown: [
			139,
			69,
			19
		],
		salmon: [
			250,
			128,
			114
		],
		sandybrown: [
			244,
			164,
			96
		],
		seagreen: [
			46,
			139,
			87
		],
		seashell: [
			255,
			245,
			238
		],
		sienna: [
			160,
			82,
			45
		],
		silver: [
			192,
			192,
			192
		],
		skyblue: [
			135,
			206,
			235
		],
		slateblue: [
			106,
			90,
			205
		],
		slategray: [
			112,
			128,
			144
		],
		slategrey: [
			112,
			128,
			144
		],
		snow: [
			255,
			250,
			250
		],
		springgreen: [
			0,
			255,
			127
		],
		steelblue: [
			70,
			130,
			180
		],
		tan: [
			210,
			180,
			140
		],
		teal: [
			0,
			128,
			128
		],
		thistle: [
			216,
			191,
			216
		],
		tomato: [
			255,
			99,
			71
		],
		turquoise: [
			64,
			224,
			208
		],
		violet: [
			238,
			130,
			238
		],
		wheat: [
			245,
			222,
			179
		],
		white: [
			255,
			255,
			255
		],
		whitesmoke: [
			245,
			245,
			245
		],
		yellow: [
			255,
			255,
			0
		],
		yellowgreen: [
			154,
			205,
			50
		]
	};
	for (let e in u) Object.freeze(u[e]);
	var d = Object.freeze(u), f = /* @__PURE__ */ Object.create(null);
	for (let e in d) Object.hasOwn(d, e) && (f[d[e]] = e);
	var p = {
		to: {},
		get: {}
	};
	p.get = function(e) {
		let t = e.slice(0, 3).toLowerCase(), n, r;
		switch (t) {
			case "hsl":
				n = p.get.hsl(e), r = "hsl";
				break;
			case "hwb":
				n = p.get.hwb(e), r = "hwb";
				break;
			default: n = p.get.rgb(e), r = "rgb";
		}
		return n ? {
			model: r,
			value: n
		} : null;
	}, p.get.rgb = function(e) {
		if (!e) return null;
		let t = /^#([a-f\d]{3,4})$/i, n = /^#([a-f\d]{6})([a-f\d]{2})?$/i, r = /^rgba?\(\s*([+-]?(?:\d*\.)?\d+(?:e\d+)?)(?=[\s,])\s*(?:,\s*)?([+-]?(?:\d*\.)?\d+(?:e\d+)?)(?=[\s,])\s*(?:,\s*)?([+-]?(?:\d*\.)?\d+(?:e\d+)?)\s*(?:[\s,|/]\s*([+-]?(?:\d*\.)?\d+(?:e\d+)?)(%?)\s*)?\)$/i, i = /^rgba?\(\s*([+-]?[\d.]+)%\s*,?\s*([+-]?[\d.]+)%\s*,?\s*([+-]?[\d.]+)%\s*(?:[\s,|/]\s*([+-]?[\d.]+)(%?)\s*)?\)$/i, a = /^(\w+)$/, o = [
			0,
			0,
			0,
			1
		], s, c, l;
		if (s = e.match(n)) {
			for (l = s[2], s = s[1], c = 0; c < 3; c++) {
				let e = c * 2;
				o[c] = Number.parseInt(s.slice(e, e + 2), 16);
			}
			l && (o[3] = Number.parseInt(l, 16) / 255);
		} else if (s = e.match(t)) {
			for (s = s[1], l = s[3], c = 0; c < 3; c++) o[c] = Number.parseInt(s[c] + s[c], 16);
			l && (o[3] = Number.parseInt(l + l, 16) / 255);
		} else if (s = e.match(r)) {
			for (c = 0; c < 3; c++) o[c] = Number.parseFloat(s[c + 1]);
			s[4] && (o[3] = s[5] ? Number.parseFloat(s[4]) * .01 : Number.parseFloat(s[4]));
		} else if (s = e.match(i)) {
			for (c = 0; c < 3; c++) o[c] = Math.round(Number.parseFloat(s[c + 1]) * 2.55);
			s[4] && (o[3] = s[5] ? Number.parseFloat(s[4]) * .01 : Number.parseFloat(s[4]));
		} else if (s = e.toLowerCase().match(a)) return s[1] === "transparent" ? [
			0,
			0,
			0,
			0
		] : Object.hasOwn(d, s[1]) ? (o = d[s[1]].slice(), o[3] = 1, o) : null;
		else return null;
		for (c = 0; c < 3; c++) o[c] = m(o[c], 0, 255);
		return o[3] = m(o[3], 0, 1), o;
	}, p.get.hsl = function(e) {
		if (!e) return null;
		let t = e.match(/^hsla?\(\s*([+-]?(?:\d{0,3}\.)?\d+)(?:deg)?\s*,?\s*([+-]?[\d.]+)%\s*,?\s*([+-]?[\d.]+)%\s*(?:[,|/]\s*([+-]?(?=\.\d|\d)(?:0|[1-9]\d*)?(?:\.\d*)?(?:e[+-]?\d+)?)\s*)?\)$/i);
		if (t) {
			let e = Number.parseFloat(t[4]);
			return [
				(Number.parseFloat(t[1]) % 360 + 360) % 360,
				m(Number.parseFloat(t[2]), 0, 100),
				m(Number.parseFloat(t[3]), 0, 100),
				m(Number.isNaN(e) ? 1 : e, 0, 1)
			];
		}
		return null;
	}, p.get.hwb = function(e) {
		if (!e) return null;
		let t = e.match(/^hwb\(\s*([+-]?\d{0,3}(?:\.\d+)?)(?:deg)?\s*[\s,]\s*([+-]?[\d.]+)%\s*[\s,]\s*([+-]?[\d.]+)%\s*(?:[\s,]\s*([+-]?(?=\.\d|\d)(?:0|[1-9]\d*)?(?:\.\d*)?(?:e[+-]?\d+)?)\s*)?\)$/i);
		if (t) {
			let e = Number.parseFloat(t[4]);
			return [
				(Number.parseFloat(t[1]) % 360 + 360) % 360,
				m(Number.parseFloat(t[2]), 0, 100),
				m(Number.parseFloat(t[3]), 0, 100),
				m(Number.isNaN(e) ? 1 : e, 0, 1)
			];
		}
		return null;
	}, p.to.hex = function(...e) {
		return "#" + h(e[0]) + h(e[1]) + h(e[2]) + (e[3] < 1 ? h(Math.round(e[3] * 255)) : "");
	}, p.to.rgb = function(...e) {
		return e.length < 4 || e[3] === 1 ? "rgb(" + Math.round(e[0]) + ", " + Math.round(e[1]) + ", " + Math.round(e[2]) + ")" : "rgba(" + Math.round(e[0]) + ", " + Math.round(e[1]) + ", " + Math.round(e[2]) + ", " + e[3] + ")";
	}, p.to.rgb.percent = function(...e) {
		let t = Math.round(e[0] / 255 * 100), n = Math.round(e[1] / 255 * 100), r = Math.round(e[2] / 255 * 100);
		return e.length < 4 || e[3] === 1 ? "rgb(" + t + "%, " + n + "%, " + r + "%)" : "rgba(" + t + "%, " + n + "%, " + r + "%, " + e[3] + ")";
	}, p.to.hsl = function(...e) {
		return e.length < 4 || e[3] === 1 ? "hsl(" + e[0] + ", " + e[1] + "%, " + e[2] + "%)" : "hsla(" + e[0] + ", " + e[1] + "%, " + e[2] + "%, " + e[3] + ")";
	}, p.to.hwb = function(...e) {
		let t = "";
		return e.length >= 4 && e[3] !== 1 && (t = ", " + e[3]), "hwb(" + e[0] + ", " + e[1] + "%, " + e[2] + "%" + t + ")";
	}, p.to.keyword = function(...e) {
		return f[e.slice(0, 3)];
	};
	function m(e, t, n) {
		return Math.min(Math.max(t, e), n);
	}
	function h(e) {
		let t = Math.round(e).toString(16).toUpperCase();
		return t.length < 2 ? "0" + t : t;
	}
	var g = p, _ = {};
	for (let e of Object.keys(d)) _[d[e]] = e;
	var v = {
		rgb: {
			channels: 3,
			labels: "rgb"
		},
		hsl: {
			channels: 3,
			labels: "hsl"
		},
		hsv: {
			channels: 3,
			labels: "hsv"
		},
		hwb: {
			channels: 3,
			labels: "hwb"
		},
		cmyk: {
			channels: 4,
			labels: "cmyk"
		},
		xyz: {
			channels: 3,
			labels: "xyz"
		},
		lab: {
			channels: 3,
			labels: "lab"
		},
		oklab: {
			channels: 3,
			labels: [
				"okl",
				"oka",
				"okb"
			]
		},
		lch: {
			channels: 3,
			labels: "lch"
		},
		oklch: {
			channels: 3,
			labels: [
				"okl",
				"okc",
				"okh"
			]
		},
		hex: {
			channels: 1,
			labels: ["hex"]
		},
		keyword: {
			channels: 1,
			labels: ["keyword"]
		},
		ansi16: {
			channels: 1,
			labels: ["ansi16"]
		},
		ansi256: {
			channels: 1,
			labels: ["ansi256"]
		},
		hcg: {
			channels: 3,
			labels: [
				"h",
				"c",
				"g"
			]
		},
		apple: {
			channels: 3,
			labels: [
				"r16",
				"g16",
				"b16"
			]
		},
		gray: {
			channels: 1,
			labels: ["gray"]
		}
	}, y = v, b = (6 / 29) ** 3;
	function x(e) {
		let t = e > .0031308 ? 1.055 * e ** (1 / 2.4) - .055 : e * 12.92;
		return Math.min(Math.max(0, t), 1);
	}
	function S(e) {
		return e > .04045 ? ((e + .055) / 1.055) ** 2.4 : e / 12.92;
	}
	for (let e of Object.keys(v)) {
		if (!("channels" in v[e])) throw Error("missing channels property: " + e);
		if (!("labels" in v[e])) throw Error("missing channel labels property: " + e);
		if (v[e].labels.length !== v[e].channels) throw Error("channel and label counts mismatch: " + e);
		let { channels: t, labels: n } = v[e];
		delete v[e].channels, delete v[e].labels, Object.defineProperty(v[e], "channels", { value: t }), Object.defineProperty(v[e], "labels", { value: n });
	}
	v.rgb.hsl = function(e) {
		let t = e[0] / 255, n = e[1] / 255, r = e[2] / 255, i = Math.min(t, n, r), a = Math.max(t, n, r), o = a - i, s, c;
		switch (a) {
			case i:
				s = 0;
				break;
			case t:
				s = (n - r) / o;
				break;
			case n:
				s = 2 + (r - t) / o;
				break;
			case r: s = 4 + (t - n) / o;
		}
		s = Math.min(s * 60, 360), s < 0 && (s += 360);
		let l = (i + a) / 2;
		return c = a === i ? 0 : l <= .5 ? o / (a + i) : o / (2 - a - i), [
			s,
			c * 100,
			l * 100
		];
	}, v.rgb.hsv = function(e) {
		let t, n, r, i, a, o = e[0] / 255, s = e[1] / 255, c = e[2] / 255, l = Math.max(o, s, c), u = l - Math.min(o, s, c), d = function(e) {
			return (l - e) / 6 / u + 1 / 2;
		};
		if (u === 0) i = 0, a = 0;
		else {
			switch (a = u / l, t = d(o), n = d(s), r = d(c), l) {
				case o:
					i = r - n;
					break;
				case s:
					i = 1 / 3 + t - r;
					break;
				case c: i = 2 / 3 + n - t;
			}
			i < 0 ? i += 1 : i > 1 && --i;
		}
		return [
			i * 360,
			a * 100,
			l * 100
		];
	}, v.rgb.hwb = function(e) {
		let t = e[0], n = e[1], r = e[2], i = v.rgb.hsl(e)[0], a = 1 / 255 * Math.min(t, Math.min(n, r));
		return r = 1 - 1 / 255 * Math.max(t, Math.max(n, r)), [
			i,
			a * 100,
			r * 100
		];
	}, v.rgb.oklab = function(e) {
		let t = S(e[0] / 255), n = S(e[1] / 255), r = S(e[2] / 255), i = Math.cbrt(.4122214708 * t + .5363325363 * n + .0514459929 * r), a = Math.cbrt(.2119034982 * t + .6806995451 * n + .1073969566 * r), o = Math.cbrt(.0883024619 * t + .2817188376 * n + .6299787005 * r), s = .2104542553 * i + .793617785 * a - .0040720468 * o, c = 1.9779984951 * i - 2.428592205 * a + .4505937099 * o, l = .0259040371 * i + .7827717662 * a - .808675766 * o;
		return [
			s * 100,
			c * 100,
			l * 100
		];
	}, v.rgb.cmyk = function(e) {
		let t = e[0] / 255, n = e[1] / 255, r = e[2] / 255, i = Math.min(1 - t, 1 - n, 1 - r), a = (1 - t - i) / (1 - i) || 0, o = (1 - n - i) / (1 - i) || 0, s = (1 - r - i) / (1 - i) || 0;
		return [
			a * 100,
			o * 100,
			s * 100,
			i * 100
		];
	};
	function C(e, t) {
		return (e[0] - t[0]) ** 2 + (e[1] - t[1]) ** 2 + (e[2] - t[2]) ** 2;
	}
	v.rgb.keyword = function(e) {
		let t = _[e];
		if (t) return t;
		let n = Infinity, r;
		for (let t of Object.keys(d)) {
			let i = d[t], a = C(e, i);
			a < n && (n = a, r = t);
		}
		return r;
	}, v.keyword.rgb = function(e) {
		return [...d[e]];
	}, v.rgb.xyz = function(e) {
		let t = S(e[0] / 255), n = S(e[1] / 255), r = S(e[2] / 255), i = t * .4124564 + n * .3575761 + r * .1804375, a = t * .2126729 + n * .7151522 + r * .072175, o = t * .0193339 + n * .119192 + r * .9503041;
		return [
			i * 100,
			a * 100,
			o * 100
		];
	}, v.rgb.lab = function(e) {
		let t = v.rgb.xyz(e), n = t[0], r = t[1], i = t[2];
		return n /= 95.047, r /= 100, i /= 108.883, n = n > b ? n ** (1 / 3) : 7.787 * n + 16 / 116, r = r > b ? r ** (1 / 3) : 7.787 * r + 16 / 116, i = i > b ? i ** (1 / 3) : 7.787 * i + 16 / 116, [
			116 * r - 16,
			500 * (n - r),
			200 * (r - i)
		];
	}, v.hsl.rgb = function(e) {
		let t = e[0] / 360, n = e[1] / 100, r = e[2] / 100, i, a;
		if (n === 0) return a = r * 255, [
			a,
			a,
			a
		];
		let o = r < .5 ? r * (1 + n) : r + n - r * n, s = 2 * r - o, c = [
			0,
			0,
			0
		];
		for (let e = 0; e < 3; e++) i = t + 1 / 3 * -(e - 1), i < 0 && i++, i > 1 && i--, a = 6 * i < 1 ? s + (o - s) * 6 * i : 2 * i < 1 ? o : 3 * i < 2 ? s + (o - s) * (2 / 3 - i) * 6 : s, c[e] = a * 255;
		return c;
	}, v.hsl.hsv = function(e) {
		let t = e[0], n = e[1] / 100, r = e[2] / 100, i = n, a = Math.max(r, .01);
		r *= 2, n *= r <= 1 ? r : 2 - r, i *= a <= 1 ? a : 2 - a;
		let o = (r + n) / 2;
		return [
			t,
			(r === 0 ? 2 * i / (a + i) : 2 * n / (r + n)) * 100,
			o * 100
		];
	}, v.hsv.rgb = function(e) {
		let t = e[0] / 60, n = e[1] / 100, r = e[2] / 100, i = Math.floor(t) % 6, a = t - Math.floor(t), o = 255 * r * (1 - n), s = 255 * r * (1 - n * a), c = 255 * r * (1 - n * (1 - a));
		switch (r *= 255, i) {
			case 0: return [
				r,
				c,
				o
			];
			case 1: return [
				s,
				r,
				o
			];
			case 2: return [
				o,
				r,
				c
			];
			case 3: return [
				o,
				s,
				r
			];
			case 4: return [
				c,
				o,
				r
			];
			case 5: return [
				r,
				o,
				s
			];
		}
	}, v.hsv.hsl = function(e) {
		let t = e[0], n = e[1] / 100, r = e[2] / 100, i = Math.max(r, .01), a, o;
		o = (2 - n) * r;
		let s = (2 - n) * i;
		return a = n * i, a /= s <= 1 ? s : 2 - s, a ||= 0, o /= 2, [
			t,
			a * 100,
			o * 100
		];
	}, v.hwb.rgb = function(e) {
		let t = e[0] / 360, n = e[1] / 100, r = e[2] / 100, i = n + r, a;
		i > 1 && (n /= i, r /= i);
		let o = Math.floor(6 * t), s = 1 - r;
		a = 6 * t - o, o & 1 && (a = 1 - a);
		let c = n + a * (s - n), l, u, d;
		switch (o) {
			default:
			case 6:
			case 0:
				l = s, u = c, d = n;
				break;
			case 1:
				l = c, u = s, d = n;
				break;
			case 2:
				l = n, u = s, d = c;
				break;
			case 3:
				l = n, u = c, d = s;
				break;
			case 4:
				l = c, u = n, d = s;
				break;
			case 5: l = s, u = n, d = c;
		}
		return [
			l * 255,
			u * 255,
			d * 255
		];
	}, v.cmyk.rgb = function(e) {
		let t = e[0] / 100, n = e[1] / 100, r = e[2] / 100, i = e[3] / 100, a = 1 - Math.min(1, t * (1 - i) + i), o = 1 - Math.min(1, n * (1 - i) + i), s = 1 - Math.min(1, r * (1 - i) + i);
		return [
			a * 255,
			o * 255,
			s * 255
		];
	}, v.xyz.rgb = function(e) {
		let t = e[0] / 100, n = e[1] / 100, r = e[2] / 100, i, a, o;
		return i = t * 3.2404542 + n * -1.5371385 + r * -.4985314, a = t * -.969266 + n * 1.8760108 + r * .041556, o = t * .0556434 + n * -.2040259 + r * 1.0572252, i = x(i), a = x(a), o = x(o), [
			i * 255,
			a * 255,
			o * 255
		];
	}, v.xyz.lab = function(e) {
		let t = e[0], n = e[1], r = e[2];
		return t /= 95.047, n /= 100, r /= 108.883, t = t > b ? t ** (1 / 3) : 7.787 * t + 16 / 116, n = n > b ? n ** (1 / 3) : 7.787 * n + 16 / 116, r = r > b ? r ** (1 / 3) : 7.787 * r + 16 / 116, [
			116 * n - 16,
			500 * (t - n),
			200 * (n - r)
		];
	}, v.xyz.oklab = function(e) {
		let t = e[0] / 100, n = e[1] / 100, r = e[2] / 100, i = Math.cbrt(.8189330101 * t + .3618667424 * n - .1288597137 * r), a = Math.cbrt(.0329845436 * t + .9293118715 * n + .0361456387 * r), o = Math.cbrt(.0482003018 * t + .2643662691 * n + .633851707 * r), s = .2104542553 * i + .793617785 * a - .0040720468 * o, c = 1.9779984951 * i - 2.428592205 * a + .4505937099 * o, l = .0259040371 * i + .7827717662 * a - .808675766 * o;
		return [
			s * 100,
			c * 100,
			l * 100
		];
	}, v.oklab.oklch = function(e) {
		return v.lab.lch(e);
	}, v.oklab.xyz = function(e) {
		let t = e[0] / 100, n = e[1] / 100, r = e[2] / 100, i = (.999999998 * t + .396337792 * n + .215803758 * r) ** 3, a = (1.000000008 * t - .105561342 * n - .063854175 * r) ** 3, o = (1.000000055 * t - .089484182 * n - 1.291485538 * r) ** 3, s = 1.227013851 * i - .55779998 * a + .281256149 * o, c = -.040580178 * i + 1.11225687 * a - .071676679 * o, l = -.076381285 * i - .421481978 * a + 1.58616322 * o;
		return [
			s * 100,
			c * 100,
			l * 100
		];
	}, v.oklab.rgb = function(e) {
		let t = e[0] / 100, n = e[1] / 100, r = e[2] / 100, i = (t + .3963377774 * n + .2158037573 * r) ** 3, a = (t - .1055613458 * n - .0638541728 * r) ** 3, o = (t - .0894841775 * n - 1.291485548 * r) ** 3, s = x(4.0767416621 * i - 3.3077115913 * a + .2309699292 * o), c = x(-1.2684380046 * i + 2.6097574011 * a - .3413193965 * o), l = x(-.0041960863 * i - .7034186147 * a + 1.707614701 * o);
		return [
			s * 255,
			c * 255,
			l * 255
		];
	}, v.oklch.oklab = function(e) {
		return v.lch.lab(e);
	}, v.lab.xyz = function(e) {
		let t = e[0], n = e[1], r = e[2], i, a, o;
		a = (t + 16) / 116, i = n / 500 + a, o = a - r / 200;
		let s = a ** 3, c = i ** 3, l = o ** 3;
		return a = s > b ? s : (a - 16 / 116) / 7.787, i = c > b ? c : (i - 16 / 116) / 7.787, o = l > b ? l : (o - 16 / 116) / 7.787, i *= 95.047, a *= 100, o *= 108.883, [
			i,
			a,
			o
		];
	}, v.lab.lch = function(e) {
		let t = e[0], n = e[1], r = e[2], i;
		return i = Math.atan2(r, n) * 360 / 2 / Math.PI, i < 0 && (i += 360), [
			t,
			Math.sqrt(n * n + r * r),
			i
		];
	}, v.lch.lab = function(e) {
		let t = e[0], n = e[1], r = e[2] / 360 * 2 * Math.PI;
		return [
			t,
			n * Math.cos(r),
			n * Math.sin(r)
		];
	}, v.rgb.ansi16 = function(e, t = null) {
		let [n, r, i] = e, a = t === null ? v.rgb.hsv(e)[2] : t;
		if (a = Math.round(a / 50), a === 0) return 30;
		let o = 30 + (Math.round(i / 255) << 2 | Math.round(r / 255) << 1 | Math.round(n / 255));
		return a === 2 && (o += 60), o;
	}, v.hsv.ansi16 = function(e) {
		return v.rgb.ansi16(v.hsv.rgb(e), e[2]);
	}, v.rgb.ansi256 = function(e) {
		let t = e[0], n = e[1], r = e[2];
		return t >> 4 == n >> 4 && n >> 4 == r >> 4 ? t < 8 ? 16 : t > 248 ? 231 : Math.round((t - 8) / 247 * 24) + 232 : 16 + 36 * Math.round(t / 255 * 5) + 6 * Math.round(n / 255 * 5) + Math.round(r / 255 * 5);
	}, v.ansi16.rgb = function(e) {
		e = e[0];
		let t = e % 10;
		if (t === 0 || t === 7) return e > 50 && (t += 3.5), t = t / 10.5 * 255, [
			t,
			t,
			t
		];
		let n = (Math.trunc(e > 50) + 1) * .5;
		return [
			(t & 1) * n * 255,
			(t >> 1 & 1) * n * 255,
			(t >> 2 & 1) * n * 255
		];
	}, v.ansi256.rgb = function(e) {
		if (e = e[0], e >= 232) {
			let t = (e - 232) * 10 + 8;
			return [
				t,
				t,
				t
			];
		}
		e -= 16;
		let t;
		return [
			Math.floor(e / 36) / 5 * 255,
			Math.floor((t = e % 36) / 6) / 5 * 255,
			t % 6 / 5 * 255
		];
	}, v.rgb.hex = function(e) {
		let t = (((Math.round(e[0]) & 255) << 16) + ((Math.round(e[1]) & 255) << 8) + (Math.round(e[2]) & 255)).toString(16).toUpperCase();
		return "000000".slice(t.length) + t;
	}, v.hex.rgb = function(e) {
		let t = e.toString(16).match(/[a-f\d]{6}|[a-f\d]{3}/i);
		if (!t) return [
			0,
			0,
			0
		];
		let n = t[0];
		t[0].length === 3 && (n = [...n].map((e) => e + e).join(""));
		let r = Number.parseInt(n, 16);
		return [
			r >> 16 & 255,
			r >> 8 & 255,
			r & 255
		];
	}, v.rgb.hcg = function(e) {
		let t = e[0] / 255, n = e[1] / 255, r = e[2] / 255, i = Math.max(Math.max(t, n), r), a = Math.min(Math.min(t, n), r), o = i - a, s, c = o < 1 ? a / (1 - o) : 0;
		return s = o <= 0 ? 0 : i === t ? (n - r) / o % 6 : i === n ? 2 + (r - t) / o : 4 + (t - n) / o, s /= 6, s %= 1, [
			s * 360,
			o * 100,
			c * 100
		];
	}, v.hsl.hcg = function(e) {
		let t = e[1] / 100, n = e[2] / 100, r = n < .5 ? 2 * t * n : 2 * t * (1 - n), i = 0;
		return r < 1 && (i = (n - .5 * r) / (1 - r)), [
			e[0],
			r * 100,
			i * 100
		];
	}, v.hsv.hcg = function(e) {
		let t = e[1] / 100, n = e[2] / 100, r = t * n, i = 0;
		return r < 1 && (i = (n - r) / (1 - r)), [
			e[0],
			r * 100,
			i * 100
		];
	}, v.hcg.rgb = function(e) {
		let t = e[0] / 360, n = e[1] / 100, r = e[2] / 100;
		if (n === 0) return [
			r * 255,
			r * 255,
			r * 255
		];
		let i = [
			0,
			0,
			0
		], a = t % 1 * 6, o = a % 1, s = 1 - o, c = 0;
		switch (Math.floor(a)) {
			case 0:
				i[0] = 1, i[1] = o, i[2] = 0;
				break;
			case 1:
				i[0] = s, i[1] = 1, i[2] = 0;
				break;
			case 2:
				i[0] = 0, i[1] = 1, i[2] = o;
				break;
			case 3:
				i[0] = 0, i[1] = s, i[2] = 1;
				break;
			case 4:
				i[0] = o, i[1] = 0, i[2] = 1;
				break;
			default: i[0] = 1, i[1] = 0, i[2] = s;
		}
		return c = (1 - n) * r, [
			(n * i[0] + c) * 255,
			(n * i[1] + c) * 255,
			(n * i[2] + c) * 255
		];
	}, v.hcg.hsv = function(e) {
		let t = e[1] / 100, n = t + e[2] / 100 * (1 - t), r = 0;
		return n > 0 && (r = t / n), [
			e[0],
			r * 100,
			n * 100
		];
	}, v.hcg.hsl = function(e) {
		let t = e[1] / 100, n = e[2] / 100 * (1 - t) + .5 * t, r = 0;
		return n > 0 && n < .5 ? r = t / (2 * n) : n >= .5 && n < 1 && (r = t / (2 * (1 - n))), [
			e[0],
			r * 100,
			n * 100
		];
	}, v.hcg.hwb = function(e) {
		let t = e[1] / 100, n = t + e[2] / 100 * (1 - t);
		return [
			e[0],
			(n - t) * 100,
			(1 - n) * 100
		];
	}, v.hwb.hcg = function(e) {
		let t = e[1] / 100, n = 1 - e[2] / 100, r = n - t, i = 0;
		return r < 1 && (i = (n - r) / (1 - r)), [
			e[0],
			r * 100,
			i * 100
		];
	}, v.apple.rgb = function(e) {
		return [
			e[0] / 65535 * 255,
			e[1] / 65535 * 255,
			e[2] / 65535 * 255
		];
	}, v.rgb.apple = function(e) {
		return [
			e[0] / 255 * 65535,
			e[1] / 255 * 65535,
			e[2] / 255 * 65535
		];
	}, v.gray.rgb = function(e) {
		return [
			e[0] / 100 * 255,
			e[0] / 100 * 255,
			e[0] / 100 * 255
		];
	}, v.gray.hsl = function(e) {
		return [
			0,
			0,
			e[0]
		];
	}, v.gray.hsv = v.gray.hsl, v.gray.hwb = function(e) {
		return [
			0,
			100,
			e[0]
		];
	}, v.gray.cmyk = function(e) {
		return [
			0,
			0,
			0,
			e[0]
		];
	}, v.gray.lab = function(e) {
		return [
			e[0],
			0,
			0
		];
	}, v.gray.hex = function(e) {
		let t = Math.round(e[0] / 100 * 255) & 255, n = ((t << 16) + (t << 8) + t).toString(16).toUpperCase();
		return "000000".slice(n.length) + n;
	}, v.rgb.gray = function(e) {
		return [(e[0] + e[1] + e[2]) / 3 / 255 * 100];
	};
	function w() {
		let e = {}, t = Object.keys(y);
		for (let { length: n } = t, r = 0; r < n; r++) e[t[r]] = {
			distance: -1,
			parent: null
		};
		return e;
	}
	function T(e) {
		let t = w(), n = [e];
		for (t[e].distance = 0; n.length > 0;) {
			let e = n.pop(), r = Object.keys(y[e]);
			for (let { length: i } = r, a = 0; a < i; a++) {
				let i = r[a], o = t[i];
				o.distance === -1 && (o.distance = t[e].distance + 1, o.parent = e, n.unshift(i));
			}
		}
		return t;
	}
	function E(e, t) {
		return function(n) {
			return t(e(n));
		};
	}
	function D(e, t) {
		let n = [t[e].parent, e], r = y[t[e].parent][e], i = t[e].parent;
		for (; t[i].parent;) n.unshift(t[i].parent), r = E(y[t[i].parent][i], r), i = t[i].parent;
		return r.conversion = n, r;
	}
	function O(e) {
		let t = T(e), n = {}, r = Object.keys(t);
		for (let { length: e } = r, i = 0; i < e; i++) {
			let e = r[i];
			t[e].parent !== null && (n[e] = D(e, t));
		}
		return n;
	}
	var k = O, A = {}, ee = Object.keys(y);
	function te(e) {
		let t = function(...t) {
			let n = t[0];
			return n == null ? n : (n.length > 1 && (t = n), e(t));
		};
		return "conversion" in e && (t.conversion = e.conversion), t;
	}
	function j(e) {
		let t = function(...t) {
			let n = t[0];
			if (n == null) return n;
			n.length > 1 && (t = n);
			let r = e(t);
			if (typeof r == "object") for (let { length: e } = r, t = 0; t < e; t++) r[t] = Math.round(r[t]);
			return r;
		};
		return "conversion" in e && (t.conversion = e.conversion), t;
	}
	for (let e of ee) {
		A[e] = {}, Object.defineProperty(A[e], "channels", { value: y[e].channels }), Object.defineProperty(A[e], "labels", { value: y[e].labels });
		let t = k(e), n = Object.keys(t);
		for (let r of n) {
			let n = t[r];
			A[e][r] = j(n), A[e][r].raw = te(n);
		}
	}
	var M = A, N = [
		"keyword",
		"gray",
		"hex"
	], ne = {};
	for (let e of Object.keys(M)) ne[[...M[e].labels].sort().join("")] = e;
	var P = {};
	function F(e, t) {
		if (!(this instanceof F)) return new F(e, t);
		if (t && t in N && (t = null), t && !(t in M)) throw Error("Unknown model: " + t);
		let n, r;
		if (e == null) this.model = "rgb", this.color = [
			0,
			0,
			0
		], this.valpha = 1;
		else if (e instanceof F) this.model = e.model, this.color = [...e.color], this.valpha = e.valpha;
		else if (typeof e == "string") {
			let t = g.get(e);
			if (t === null) throw Error("Unable to parse color from string: " + e);
			this.model = t.model, r = M[this.model].channels, this.color = t.value.slice(0, r), this.valpha = typeof t.value[r] == "number" ? t.value[r] : 1;
		} else if (e.length > 0) {
			this.model = t || "rgb", r = M[this.model].channels;
			let n = Array.prototype.slice.call(e, 0, r);
			this.color = oe(n, r), this.valpha = typeof e[r] == "number" ? e[r] : 1;
		} else if (typeof e == "number") this.model = "rgb", this.color = [
			e >> 16 & 255,
			e >> 8 & 255,
			e & 255
		], this.valpha = 1;
		else {
			this.valpha = 1;
			let t = Object.keys(e);
			"alpha" in e && (t.splice(t.indexOf("alpha"), 1), this.valpha = typeof e.alpha == "number" ? e.alpha : 0);
			let r = t.sort().join("");
			if (!(r in ne)) throw Error("Unable to parse color from object: " + JSON.stringify(e));
			this.model = ne[r];
			let { labels: i } = M[this.model], a = [];
			for (n = 0; n < i.length; n++) a.push(e[i[n]]);
			this.color = oe(a);
		}
		if (P[this.model]) for (r = M[this.model].channels, n = 0; n < r; n++) {
			let e = P[this.model][n];
			e && (this.color[n] = e(this.color[n]));
		}
		this.valpha = Math.max(0, Math.min(1, this.valpha)), Object.freeze && Object.freeze(this);
	}
	F.prototype = {
		toString() {
			return this.string();
		},
		toJSON() {
			return this[this.model]();
		},
		string(e) {
			let t = this.model in g.to ? this : this.rgb();
			t = t.round(typeof e == "number" ? e : 1);
			let n = t.valpha === 1 ? t.color : [...t.color, this.valpha];
			return g.to[t.model](...n);
		},
		percentString(e) {
			let t = this.rgb().round(typeof e == "number" ? e : 1), n = t.valpha === 1 ? t.color : [...t.color, this.valpha];
			return g.to.rgb.percent(...n);
		},
		array() {
			return this.valpha === 1 ? [...this.color] : [...this.color, this.valpha];
		},
		object() {
			let e = {}, { channels: t } = M[this.model], { labels: n } = M[this.model];
			for (let r = 0; r < t; r++) e[n[r]] = this.color[r];
			return this.valpha !== 1 && (e.alpha = this.valpha), e;
		},
		unitArray() {
			let e = this.rgb().color;
			return e[0] /= 255, e[1] /= 255, e[2] /= 255, this.valpha !== 1 && e.push(this.valpha), e;
		},
		unitObject() {
			let e = this.rgb().object();
			return e.r /= 255, e.g /= 255, e.b /= 255, this.valpha !== 1 && (e.alpha = this.valpha), e;
		},
		round(e) {
			return e = Math.max(e || 0, 0), new F([...this.color.map(ie(e)), this.valpha], this.model);
		},
		alpha(e) {
			return e === void 0 ? this.valpha : new F([...this.color, Math.max(0, Math.min(1, e))], this.model);
		},
		red: I("rgb", 0, L(255)),
		green: I("rgb", 1, L(255)),
		blue: I("rgb", 2, L(255)),
		hue: I([
			"hsl",
			"hsv",
			"hsl",
			"hwb",
			"hcg"
		], 0, (e) => (e % 360 + 360) % 360),
		saturationl: I("hsl", 1, L(100)),
		lightness: I("hsl", 2, L(100)),
		saturationv: I("hsv", 1, L(100)),
		value: I("hsv", 2, L(100)),
		chroma: I("hcg", 1, L(100)),
		gray: I("hcg", 2, L(100)),
		white: I("hwb", 1, L(100)),
		wblack: I("hwb", 2, L(100)),
		cyan: I("cmyk", 0, L(100)),
		magenta: I("cmyk", 1, L(100)),
		yellow: I("cmyk", 2, L(100)),
		black: I("cmyk", 3, L(100)),
		x: I("xyz", 0, L(95.047)),
		y: I("xyz", 1, L(100)),
		z: I("xyz", 2, L(108.833)),
		l: I("lab", 0, L(100)),
		a: I("lab", 1),
		b: I("lab", 2),
		keyword(e) {
			return e === void 0 ? M[this.model].keyword(this.color) : new F(e);
		},
		hex(e) {
			return e === void 0 ? g.to.hex(...this.rgb().round().color) : new F(e);
		},
		hexa(e) {
			if (e !== void 0) return new F(e);
			let t = this.rgb().round().color, n = Math.round(this.valpha * 255).toString(16).toUpperCase();
			return n.length === 1 && (n = "0" + n), g.to.hex(...t) + n;
		},
		rgbNumber() {
			let e = this.rgb().color;
			return (e[0] & 255) << 16 | (e[1] & 255) << 8 | e[2] & 255;
		},
		luminosity() {
			let e = this.rgb().color, t = [];
			for (let [n, r] of e.entries()) {
				let e = r / 255;
				t[n] = e <= .04045 ? e / 12.92 : ((e + .055) / 1.055) ** 2.4;
			}
			return .2126 * t[0] + .7152 * t[1] + .0722 * t[2];
		},
		contrast(e) {
			let t = this.luminosity(), n = e.luminosity();
			return t > n ? (t + .05) / (n + .05) : (n + .05) / (t + .05);
		},
		level(e) {
			let t = this.contrast(e);
			return t >= 7 ? "AAA" : t >= 4.5 ? "AA" : "";
		},
		isDark() {
			let e = this.rgb().color;
			return (e[0] * 2126 + e[1] * 7152 + e[2] * 722) / 1e4 < 128;
		},
		isLight() {
			return !this.isDark();
		},
		negate() {
			let e = this.rgb();
			for (let t = 0; t < 3; t++) e.color[t] = 255 - e.color[t];
			return e;
		},
		lighten(e) {
			let t = this.hsl();
			return t.color[2] += t.color[2] * e, t;
		},
		darken(e) {
			let t = this.hsl();
			return t.color[2] -= t.color[2] * e, t;
		},
		saturate(e) {
			let t = this.hsl();
			return t.color[1] += t.color[1] * e, t;
		},
		desaturate(e) {
			let t = this.hsl();
			return t.color[1] -= t.color[1] * e, t;
		},
		whiten(e) {
			let t = this.hwb();
			return t.color[1] += t.color[1] * e, t;
		},
		blacken(e) {
			let t = this.hwb();
			return t.color[2] += t.color[2] * e, t;
		},
		grayscale() {
			let e = this.rgb().color, t = e[0] * .3 + e[1] * .59 + e[2] * .11;
			return F.rgb(t, t, t);
		},
		fade(e) {
			return this.alpha(this.valpha - this.valpha * e);
		},
		opaquer(e) {
			return this.alpha(this.valpha + this.valpha * e);
		},
		rotate(e) {
			let t = this.hsl(), n = t.color[0];
			return n = (n + e) % 360, n = n < 0 ? 360 + n : n, t.color[0] = n, t;
		},
		mix(e, t) {
			if (!e || !e.rgb) throw Error("Argument to \"mix\" was not a Color instance, but rather an instance of " + typeof e);
			let n = e.rgb(), r = this.rgb(), i = t === void 0 ? .5 : t, a = 2 * i - 1, o = n.alpha() - r.alpha(), s = ((a * o === -1 ? a : (a + o) / (1 + a * o)) + 1) / 2, c = 1 - s;
			return F.rgb(s * n.red() + c * r.red(), s * n.green() + c * r.green(), s * n.blue() + c * r.blue(), n.alpha() * i + r.alpha() * (1 - i));
		}
	};
	for (let e of Object.keys(M)) {
		if (N.includes(e)) continue;
		let { channels: t } = M[e];
		F.prototype[e] = function(...t) {
			return this.model === e ? new F(this) : t.length > 0 ? new F(t, e) : new F([...ae(M[this.model][e].raw(this.color)), this.valpha], e);
		}, F[e] = function(...n) {
			let r = n[0];
			return typeof r == "number" && (r = oe(n, t)), new F(r, e);
		};
	}
	function re(e, t) {
		return Number(e.toFixed(t));
	}
	function ie(e) {
		return function(t) {
			return re(t, e);
		};
	}
	function I(e, t, n) {
		e = Array.isArray(e) ? e : [e];
		for (let r of e) (P[r] ||= [])[t] = n;
		return e = e[0], function(r) {
			let i;
			return r === void 0 ? (i = this[e]().color[t], n && (i = n(i)), i) : (n && (r = n(r)), i = this[e](), i.color[t] = r, i);
		};
	}
	function L(e) {
		return function(t) {
			return Math.max(0, Math.min(e, t));
		};
	}
	function ae(e) {
		return Array.isArray(e) ? e : [e];
	}
	function oe(e, t) {
		for (let n = 0; n < t; n++) typeof e[n] != "number" && (e[n] = 0);
		return e;
	}
	var se = F;
})), Qt = /* @__PURE__ */ O(((e, t) => {
	t.exports = Zt().default;
})), $t = /* @__PURE__ */ O(((e, t) => {
	var n = Qt(), r = Xe(), i = {
		multiband: "multiband",
		"b-w": "b-w",
		bw: "b-w",
		cmyk: "cmyk",
		srgb: "srgb"
	};
	function a(e) {
		return this._setBackgroundColourOption("tint", e), this;
	}
	function o(e) {
		return this.options.greyscale = !r.bool(e) || e, this;
	}
	function s(e) {
		return this.greyscale(e);
	}
	function c(e) {
		if (!r.string(e)) throw r.invalidParameterError("colourspace", "string", e);
		return this.options.colourspacePipeline = e, this;
	}
	function l(e) {
		return this.pipelineColourspace(e);
	}
	function u(e) {
		if (!r.string(e)) throw r.invalidParameterError("colourspace", "string", e);
		return this.options.colourspace = e, this;
	}
	function d(e) {
		return this.toColourspace(e);
	}
	function f(e) {
		if (r.object(e) || r.string(e) && e.length >= 3 && e.length <= 200) {
			let t = n(e);
			return [
				t.red(),
				t.green(),
				t.blue(),
				Math.round(t.alpha() * 255)
			];
		}
		throw r.invalidParameterError("background", "object or string", e);
	}
	function p(e, t) {
		r.defined(t) && (this.options[e] = f(t));
	}
	t.exports = (e) => {
		Object.assign(e.prototype, {
			tint: a,
			greyscale: o,
			grayscale: s,
			pipelineColourspace: c,
			pipelineColorspace: l,
			toColourspace: u,
			toColorspace: d,
			_getBackgroundColourOption: f,
			_setBackgroundColourOption: p
		}), e.colourspace = i, e.colorspace = i;
	};
})), en = /* @__PURE__ */ O(((e, t) => {
	var n = Xe(), r = {
		and: "and",
		or: "or",
		eor: "eor"
	};
	function i() {
		return this.options.removeAlpha = !0, this;
	}
	function a(e) {
		if (n.defined(e)) {
			if (n.number(e) && n.inRange(e, 0, 1)) this.options.ensureAlpha = e;
			else throw n.invalidParameterError("alpha", "number between 0 and 1", e);
		} else this.options.ensureAlpha = 1;
		return this;
	}
	function o(e) {
		let t = {
			red: 0,
			green: 1,
			blue: 2,
			alpha: 3
		};
		if (Object.keys(t).includes(e) && (e = t[e]), n.integer(e) && n.inRange(e, 0, 4)) this.options.extractChannel = e;
		else throw n.invalidParameterError("channel", "integer or one of: red, green, blue, alpha", e);
		return this;
	}
	function s(e, t) {
		return Array.isArray(e) ? e.forEach(function(e) {
			this.options.joinChannelIn.push(this._createInputDescriptor(e, t));
		}, this) : this.options.joinChannelIn.push(this._createInputDescriptor(e, t)), this;
	}
	function c(e) {
		if (n.string(e) && n.inArray(e, [
			"and",
			"or",
			"eor"
		])) this.options.bandBoolOp = e;
		else throw n.invalidParameterError("boolOp", "one of: and, or, eor", e);
		return this;
	}
	t.exports = (e) => {
		Object.assign(e.prototype, {
			removeAlpha: i,
			ensureAlpha: a,
			extractChannel: o,
			joinChannel: s,
			bandbool: c
		}), e.bool = r;
	};
})), tn = /* @__PURE__ */ O(((e, t) => {
	var n = j("node:path"), r = Xe(), i = Gt(), a = /* @__PURE__ */ new Map([
		["heic", "heif"],
		["heif", "heif"],
		["avif", "avif"],
		["jpeg", "jpeg"],
		["jpg", "jpeg"],
		["jpe", "jpeg"],
		["tile", "tile"],
		["dz", "tile"],
		["png", "png"],
		["raw", "raw"],
		["tiff", "tiff"],
		["tif", "tiff"],
		["webp", "webp"],
		["gif", "gif"],
		["jp2", "jp2"],
		["jpx", "jp2"],
		["j2k", "jp2"],
		["j2c", "jp2"],
		["jxl", "jxl"]
	]), o = /\.(jp[2x]|j2[kc])$/i, s = () => /* @__PURE__ */ Error("JP2 output requires libvips with support for OpenJPEG"), c = (e) => 1 << 31 - Math.clz32(Math.ceil(Math.log2(e)));
	function l(e, t) {
		let i;
		if (r.string(e) ? r.string(this.options.input.file) && n.resolve(this.options.input.file) === n.resolve(e) ? i = /* @__PURE__ */ Error("Cannot use same file for input and output") : o.test(n.extname(e)) && !this.constructor.format.jp2k.output.file && (i = s()) : i = /* @__PURE__ */ Error("Missing output file path"), i) {
			if (r.fn(t)) t(i);
			else return Promise.reject(i);
		} else {
			this.options.fileOut = e;
			let n = Error();
			return this._pipeline(t, n);
		}
		return this;
	}
	function u(e, t) {
		r.object(e) ? this._setBooleanOption("resolveWithObject", e.resolveWithObject) : this.options.resolveWithObject && (this.options.resolveWithObject = !1), this.options.fileOut = "";
		let n = Error();
		return this._pipeline(r.fn(e) ? e : t, n);
	}
	function d() {
		return this.options.keepMetadata |= 1, this;
	}
	function f(e) {
		if (r.object(e)) for (let [t, n] of Object.entries(e)) if (r.object(n)) for (let [e, i] of Object.entries(n)) if (r.string(i)) this.options.withExif[`exif-${t.toLowerCase()}-${e}`] = i;
		else throw r.invalidParameterError(`${t}.${e}`, "string", i);
		else throw r.invalidParameterError(t, "object", n);
		else throw r.invalidParameterError("exif", "object", e);
		return this.options.withExifMerge = !1, this.keepExif();
	}
	function p(e) {
		return this.withExif(e), this.options.withExifMerge = !0, this;
	}
	function m() {
		return this.options.keepMetadata |= 8, this;
	}
	function h(e, t) {
		if (r.string(e)) this.options.withIccProfile = e;
		else throw r.invalidParameterError("icc", "string", e);
		if (this.keepIccProfile(), r.object(t) && r.defined(t.attach)) {
			if (r.bool(t.attach)) t.attach || (this.options.keepMetadata &= -9);
			else throw r.invalidParameterError("attach", "boolean", t.attach);
		}
		return this;
	}
	function g() {
		return this.options.keepMetadata |= 2, this;
	}
	function _(e) {
		if (r.string(e) && e.length > 0) this.options.withXmp = e, this.options.keepMetadata |= 2;
		else throw r.invalidParameterError("xmp", "non-empty string", e);
		return this;
	}
	function v() {
		return this.options.keepMetadata = 31, this;
	}
	function y(e) {
		if (this.keepMetadata(), this.withIccProfile("srgb"), r.object(e)) {
			if (r.defined(e.orientation)) {
				if (r.integer(e.orientation) && r.inRange(e.orientation, 1, 8)) this.options.withMetadataOrientation = e.orientation;
				else throw r.invalidParameterError("orientation", "integer between 1 and 8", e.orientation);
			}
			if (r.defined(e.density)) {
				if (r.number(e.density) && e.density > 0) this.options.withMetadataDensity = e.density;
				else throw r.invalidParameterError("density", "positive number", e.density);
			}
			r.defined(e.icc) && this.withIccProfile(e.icc), r.defined(e.exif) && this.withExifMerge(e.exif);
		}
		return this;
	}
	function b(e, t) {
		let n = a.get((r.object(e) && r.string(e.id) ? e.id : e).toLowerCase());
		if (!n) throw r.invalidParameterError("format", `one of: ${[...a.keys()].join(", ")}`, e);
		return this[n](t);
	}
	function x(e) {
		if (r.object(e)) {
			if (r.defined(e.quality)) {
				if (r.integer(e.quality) && r.inRange(e.quality, 1, 100)) this.options.jpegQuality = e.quality;
				else throw r.invalidParameterError("quality", "integer between 1 and 100", e.quality);
			}
			if (r.defined(e.progressive) && this._setBooleanOption("jpegProgressive", e.progressive), r.defined(e.chromaSubsampling)) {
				if (r.string(e.chromaSubsampling) && r.inArray(e.chromaSubsampling, ["4:2:0", "4:4:4"])) this.options.jpegChromaSubsampling = e.chromaSubsampling;
				else throw r.invalidParameterError("chromaSubsampling", "one of: 4:2:0, 4:4:4", e.chromaSubsampling);
			}
			let t = r.bool(e.optimizeCoding) ? e.optimizeCoding : e.optimiseCoding;
			if (r.defined(t) && this._setBooleanOption("jpegOptimiseCoding", t), r.defined(e.mozjpeg)) {
				if (r.bool(e.mozjpeg)) e.mozjpeg && (this.options.jpegTrellisQuantisation = !0, this.options.jpegOvershootDeringing = !0, this.options.jpegOptimiseScans = !0, this.options.jpegProgressive = !0, this.options.jpegQuantisationTable = 3);
				else throw r.invalidParameterError("mozjpeg", "boolean", e.mozjpeg);
			}
			let n = r.bool(e.trellisQuantization) ? e.trellisQuantization : e.trellisQuantisation;
			r.defined(n) && this._setBooleanOption("jpegTrellisQuantisation", n), r.defined(e.overshootDeringing) && this._setBooleanOption("jpegOvershootDeringing", e.overshootDeringing);
			let i = r.bool(e.optimizeScans) ? e.optimizeScans : e.optimiseScans;
			r.defined(i) && (this._setBooleanOption("jpegOptimiseScans", i), i && (this.options.jpegProgressive = !0));
			let a = r.number(e.quantizationTable) ? e.quantizationTable : e.quantisationTable;
			if (r.defined(a)) {
				if (r.integer(a) && r.inRange(a, 0, 8)) this.options.jpegQuantisationTable = a;
				else throw r.invalidParameterError("quantisationTable", "integer between 0 and 8", a);
			}
		}
		return this._updateFormatOut("jpeg", e);
	}
	function S(e) {
		if (r.object(e)) {
			if (r.defined(e.progressive) && this._setBooleanOption("pngProgressive", e.progressive), r.defined(e.compressionLevel)) {
				if (r.integer(e.compressionLevel) && r.inRange(e.compressionLevel, 0, 9)) this.options.pngCompressionLevel = e.compressionLevel;
				else throw r.invalidParameterError("compressionLevel", "integer between 0 and 9", e.compressionLevel);
			}
			r.defined(e.adaptiveFiltering) && this._setBooleanOption("pngAdaptiveFiltering", e.adaptiveFiltering);
			let t = e.colours || e.colors;
			if (r.defined(t)) {
				if (r.integer(t) && r.inRange(t, 2, 256)) this.options.pngBitdepth = c(t);
				else throw r.invalidParameterError("colours", "integer between 2 and 256", t);
			}
			if (r.defined(e.palette) ? this._setBooleanOption("pngPalette", e.palette) : [
				e.quality,
				e.effort,
				e.colours,
				e.colors,
				e.dither
			].some(r.defined) && this._setBooleanOption("pngPalette", !0), this.options.pngPalette) {
				if (r.defined(e.quality)) {
					if (r.integer(e.quality) && r.inRange(e.quality, 0, 100)) this.options.pngQuality = e.quality;
					else throw r.invalidParameterError("quality", "integer between 0 and 100", e.quality);
				}
				if (r.defined(e.effort)) {
					if (r.integer(e.effort) && r.inRange(e.effort, 1, 10)) this.options.pngEffort = e.effort;
					else throw r.invalidParameterError("effort", "integer between 1 and 10", e.effort);
				}
				if (r.defined(e.dither)) {
					if (r.number(e.dither) && r.inRange(e.dither, 0, 1)) this.options.pngDither = e.dither;
					else throw r.invalidParameterError("dither", "number between 0.0 and 1.0", e.dither);
				}
			}
		}
		return this._updateFormatOut("png", e);
	}
	function C(e) {
		if (r.object(e)) {
			if (r.defined(e.quality)) {
				if (r.integer(e.quality) && r.inRange(e.quality, 1, 100)) this.options.webpQuality = e.quality;
				else throw r.invalidParameterError("quality", "integer between 1 and 100", e.quality);
			}
			if (r.defined(e.alphaQuality)) {
				if (r.integer(e.alphaQuality) && r.inRange(e.alphaQuality, 0, 100)) this.options.webpAlphaQuality = e.alphaQuality;
				else throw r.invalidParameterError("alphaQuality", "integer between 0 and 100", e.alphaQuality);
			}
			if (r.defined(e.lossless) && this._setBooleanOption("webpLossless", e.lossless), r.defined(e.nearLossless) && this._setBooleanOption("webpNearLossless", e.nearLossless), r.defined(e.smartSubsample) && this._setBooleanOption("webpSmartSubsample", e.smartSubsample), r.defined(e.smartDeblock) && this._setBooleanOption("webpSmartDeblock", e.smartDeblock), r.defined(e.preset)) {
				if (r.string(e.preset) && r.inArray(e.preset, [
					"default",
					"photo",
					"picture",
					"drawing",
					"icon",
					"text"
				])) this.options.webpPreset = e.preset;
				else throw r.invalidParameterError("preset", "one of: default, photo, picture, drawing, icon, text", e.preset);
			}
			if (r.defined(e.effort)) {
				if (r.integer(e.effort) && r.inRange(e.effort, 0, 6)) this.options.webpEffort = e.effort;
				else throw r.invalidParameterError("effort", "integer between 0 and 6", e.effort);
			}
			r.defined(e.minSize) && this._setBooleanOption("webpMinSize", e.minSize), r.defined(e.mixed) && this._setBooleanOption("webpMixed", e.mixed);
		}
		return E(e, this.options), this._updateFormatOut("webp", e);
	}
	function w(e) {
		if (r.object(e)) {
			r.defined(e.reuse) && this._setBooleanOption("gifReuse", e.reuse), r.defined(e.progressive) && this._setBooleanOption("gifProgressive", e.progressive);
			let t = e.colours || e.colors;
			if (r.defined(t)) {
				if (r.integer(t) && r.inRange(t, 2, 256)) this.options.gifBitdepth = c(t);
				else throw r.invalidParameterError("colours", "integer between 2 and 256", t);
			}
			if (r.defined(e.effort)) {
				if (r.number(e.effort) && r.inRange(e.effort, 1, 10)) this.options.gifEffort = e.effort;
				else throw r.invalidParameterError("effort", "integer between 1 and 10", e.effort);
			}
			if (r.defined(e.dither)) {
				if (r.number(e.dither) && r.inRange(e.dither, 0, 1)) this.options.gifDither = e.dither;
				else throw r.invalidParameterError("dither", "number between 0.0 and 1.0", e.dither);
			}
			if (r.defined(e.interFrameMaxError)) {
				if (r.number(e.interFrameMaxError) && r.inRange(e.interFrameMaxError, 0, 32)) this.options.gifInterFrameMaxError = e.interFrameMaxError;
				else throw r.invalidParameterError("interFrameMaxError", "number between 0.0 and 32.0", e.interFrameMaxError);
			}
			if (r.defined(e.interPaletteMaxError)) {
				if (r.number(e.interPaletteMaxError) && r.inRange(e.interPaletteMaxError, 0, 256)) this.options.gifInterPaletteMaxError = e.interPaletteMaxError;
				else throw r.invalidParameterError("interPaletteMaxError", "number between 0.0 and 256.0", e.interPaletteMaxError);
			}
			if (r.defined(e.keepDuplicateFrames)) {
				if (r.bool(e.keepDuplicateFrames)) this._setBooleanOption("gifKeepDuplicateFrames", e.keepDuplicateFrames);
				else throw r.invalidParameterError("keepDuplicateFrames", "boolean", e.keepDuplicateFrames);
			}
		}
		return E(e, this.options), this._updateFormatOut("gif", e);
	}
	function T(e) {
		/* node:coverage ignore next 41 */
		if (!this.constructor.format.jp2k.output.buffer) throw s();
		if (r.object(e)) {
			if (r.defined(e.quality)) {
				if (r.integer(e.quality) && r.inRange(e.quality, 1, 100)) this.options.jp2Quality = e.quality;
				else throw r.invalidParameterError("quality", "integer between 1 and 100", e.quality);
			}
			if (r.defined(e.lossless)) {
				if (r.bool(e.lossless)) this.options.jp2Lossless = e.lossless;
				else throw r.invalidParameterError("lossless", "boolean", e.lossless);
			}
			if (r.defined(e.tileWidth)) {
				if (r.integer(e.tileWidth) && r.inRange(e.tileWidth, 1, 32768)) this.options.jp2TileWidth = e.tileWidth;
				else throw r.invalidParameterError("tileWidth", "integer between 1 and 32768", e.tileWidth);
			}
			if (r.defined(e.tileHeight)) {
				if (r.integer(e.tileHeight) && r.inRange(e.tileHeight, 1, 32768)) this.options.jp2TileHeight = e.tileHeight;
				else throw r.invalidParameterError("tileHeight", "integer between 1 and 32768", e.tileHeight);
			}
			if (r.defined(e.chromaSubsampling)) {
				if (r.string(e.chromaSubsampling) && r.inArray(e.chromaSubsampling, ["4:2:0", "4:4:4"])) this.options.jp2ChromaSubsampling = e.chromaSubsampling;
				else throw r.invalidParameterError("chromaSubsampling", "one of: 4:2:0, 4:4:4", e.chromaSubsampling);
			}
		}
		return this._updateFormatOut("jp2", e);
	}
	function E(e, t) {
		if (r.object(e) && r.defined(e.loop)) {
			if (r.integer(e.loop) && r.inRange(e.loop, 0, 65535)) t.loop = e.loop;
			else throw r.invalidParameterError("loop", "integer between 0 and 65535", e.loop);
		}
		if (r.object(e) && r.defined(e.delay)) {
			if (r.integer(e.delay) && r.inRange(e.delay, 0, 65535)) t.delay = [e.delay];
			else if (Array.isArray(e.delay) && e.delay.every(r.integer) && e.delay.every((e) => r.inRange(e, 0, 65535))) t.delay = e.delay;
			else throw r.invalidParameterError("delay", "integer or an array of integers between 0 and 65535", e.delay);
		}
	}
	function D(e) {
		if (r.object(e)) {
			if (r.defined(e.quality)) {
				if (r.integer(e.quality) && r.inRange(e.quality, 1, 100)) this.options.tiffQuality = e.quality;
				else throw r.invalidParameterError("quality", "integer between 1 and 100", e.quality);
			}
			if (r.defined(e.bitdepth)) {
				if (r.integer(e.bitdepth) && r.inArray(e.bitdepth, [
					1,
					2,
					4,
					8
				])) this.options.tiffBitdepth = e.bitdepth;
				else throw r.invalidParameterError("bitdepth", "1, 2, 4 or 8", e.bitdepth);
			}
			if (r.defined(e.tile) && this._setBooleanOption("tiffTile", e.tile), r.defined(e.tileWidth)) {
				if (r.integer(e.tileWidth) && e.tileWidth > 0) this.options.tiffTileWidth = e.tileWidth;
				else throw r.invalidParameterError("tileWidth", "integer greater than zero", e.tileWidth);
			}
			if (r.defined(e.tileHeight)) {
				if (r.integer(e.tileHeight) && e.tileHeight > 0) this.options.tiffTileHeight = e.tileHeight;
				else throw r.invalidParameterError("tileHeight", "integer greater than zero", e.tileHeight);
			}
			if (r.defined(e.miniswhite) && this._setBooleanOption("tiffMiniswhite", e.miniswhite), r.defined(e.pyramid) && this._setBooleanOption("tiffPyramid", e.pyramid), r.defined(e.xres)) {
				if (r.number(e.xres) && e.xres > 0) this.options.tiffXres = e.xres;
				else throw r.invalidParameterError("xres", "number greater than zero", e.xres);
			}
			if (r.defined(e.yres)) {
				if (r.number(e.yres) && e.yres > 0) this.options.tiffYres = e.yres;
				else throw r.invalidParameterError("yres", "number greater than zero", e.yres);
			}
			if (r.defined(e.compression)) {
				if (r.string(e.compression) && r.inArray(e.compression, [
					"none",
					"jpeg",
					"deflate",
					"packbits",
					"ccittfax4",
					"lzw",
					"webp",
					"zstd",
					"jp2k"
				])) this.options.tiffCompression = e.compression;
				else throw r.invalidParameterError("compression", "one of: none, jpeg, deflate, packbits, ccittfax4, lzw, webp, zstd, jp2k", e.compression);
			}
			if (r.defined(e.bigtiff) && this._setBooleanOption("tiffBigtiff", e.bigtiff), r.defined(e.predictor)) {
				if (r.string(e.predictor) && r.inArray(e.predictor, [
					"none",
					"horizontal",
					"float"
				])) this.options.tiffPredictor = e.predictor;
				else throw r.invalidParameterError("predictor", "one of: none, horizontal, float", e.predictor);
			}
			if (r.defined(e.resolutionUnit)) {
				if (r.string(e.resolutionUnit) && r.inArray(e.resolutionUnit, ["inch", "cm"])) this.options.tiffResolutionUnit = e.resolutionUnit;
				else throw r.invalidParameterError("resolutionUnit", "one of: inch, cm", e.resolutionUnit);
			}
		}
		return this._updateFormatOut("tiff", e);
	}
	function O(e) {
		return this.heif({
			...e,
			compression: "av1"
		});
	}
	function k(e) {
		if (r.object(e)) {
			if (r.string(e.compression) && r.inArray(e.compression, ["av1", "hevc"])) this.options.heifCompression = e.compression;
			else throw r.invalidParameterError("compression", "one of: av1, hevc", e.compression);
			if (r.defined(e.quality)) {
				if (r.integer(e.quality) && r.inRange(e.quality, 1, 100)) this.options.heifQuality = e.quality;
				else throw r.invalidParameterError("quality", "integer between 1 and 100", e.quality);
			}
			if (r.defined(e.lossless)) {
				if (r.bool(e.lossless)) this.options.heifLossless = e.lossless;
				else throw r.invalidParameterError("lossless", "boolean", e.lossless);
			}
			if (r.defined(e.effort)) {
				if (r.integer(e.effort) && r.inRange(e.effort, 0, 9)) this.options.heifEffort = e.effort;
				else throw r.invalidParameterError("effort", "integer between 0 and 9", e.effort);
			}
			if (r.defined(e.chromaSubsampling)) {
				if (r.string(e.chromaSubsampling) && r.inArray(e.chromaSubsampling, ["4:2:0", "4:4:4"])) this.options.heifChromaSubsampling = e.chromaSubsampling;
				else throw r.invalidParameterError("chromaSubsampling", "one of: 4:2:0, 4:4:4", e.chromaSubsampling);
			}
			if (r.defined(e.bitdepth)) {
				if (r.integer(e.bitdepth) && r.inArray(e.bitdepth, [
					8,
					10,
					12
				])) {
					if (e.bitdepth !== 8 && this.constructor.versions.heif) throw r.invalidParameterError("bitdepth when using prebuilt binaries", 8, e.bitdepth);
					this.options.heifBitdepth = e.bitdepth;
				} else throw r.invalidParameterError("bitdepth", "8, 10 or 12", e.bitdepth);
			}
		} else throw r.invalidParameterError("options", "Object", e);
		return this._updateFormatOut("heif", e);
	}
	function A(e) {
		if (r.object(e)) {
			if (r.defined(e.quality)) {
				if (r.integer(e.quality) && r.inRange(e.quality, 1, 100)) this.options.jxlDistance = e.quality >= 30 ? .1 + (100 - e.quality) * .09 : 53 / 3e3 * e.quality * e.quality - 23 / 20 * e.quality + 25;
				else throw r.invalidParameterError("quality", "integer between 1 and 100", e.quality);
			} else if (r.defined(e.distance)) {
				if (r.number(e.distance) && r.inRange(e.distance, 0, 15)) this.options.jxlDistance = e.distance;
				else throw r.invalidParameterError("distance", "number between 0.0 and 15.0", e.distance);
			}
			if (r.defined(e.decodingTier)) {
				if (r.integer(e.decodingTier) && r.inRange(e.decodingTier, 0, 4)) this.options.jxlDecodingTier = e.decodingTier;
				else throw r.invalidParameterError("decodingTier", "integer between 0 and 4", e.decodingTier);
			}
			if (r.defined(e.lossless)) {
				if (r.bool(e.lossless)) this.options.jxlLossless = e.lossless;
				else throw r.invalidParameterError("lossless", "boolean", e.lossless);
			}
			if (r.defined(e.effort)) {
				if (r.integer(e.effort) && r.inRange(e.effort, 1, 9)) this.options.jxlEffort = e.effort;
				else throw r.invalidParameterError("effort", "integer between 1 and 9", e.effort);
			}
		}
		return E(e, this.options), this._updateFormatOut("jxl", e);
	}
	function ee(e) {
		if (r.object(e) && r.defined(e.depth)) {
			if (r.string(e.depth) && r.inArray(e.depth, [
				"char",
				"uchar",
				"short",
				"ushort",
				"int",
				"uint",
				"float",
				"complex",
				"double",
				"dpcomplex"
			])) this.options.rawDepth = e.depth;
			else throw r.invalidParameterError("depth", "one of: char, uchar, short, ushort, int, uint, float, complex, double, dpcomplex", e.depth);
		}
		return this._updateFormatOut("raw");
	}
	function te(e) {
		if (r.object(e)) {
			if (r.defined(e.size)) {
				if (r.integer(e.size) && r.inRange(e.size, 1, 8192)) this.options.tileSize = e.size;
				else throw r.invalidParameterError("size", "integer between 1 and 8192", e.size);
			}
			if (r.defined(e.overlap)) {
				if (r.integer(e.overlap) && r.inRange(e.overlap, 0, 8192)) {
					if (e.overlap > this.options.tileSize) throw r.invalidParameterError("overlap", `<= size (${this.options.tileSize})`, e.overlap);
					this.options.tileOverlap = e.overlap;
				} else throw r.invalidParameterError("overlap", "integer between 0 and 8192", e.overlap);
			}
			if (r.defined(e.container)) {
				if (r.string(e.container) && r.inArray(e.container, ["fs", "zip"])) this.options.tileContainer = e.container;
				else throw r.invalidParameterError("container", "one of: fs, zip", e.container);
			}
			if (r.defined(e.layout)) {
				if (r.string(e.layout) && r.inArray(e.layout, [
					"dz",
					"google",
					"iiif",
					"iiif3",
					"zoomify"
				])) this.options.tileLayout = e.layout;
				else throw r.invalidParameterError("layout", "one of: dz, google, iiif, iiif3, zoomify", e.layout);
			}
			if (r.defined(e.angle)) {
				if (r.integer(e.angle) && !(e.angle % 90)) this.options.tileAngle = e.angle;
				else throw r.invalidParameterError("angle", "positive/negative multiple of 90", e.angle);
			}
			if (this._setBackgroundColourOption("tileBackground", e.background), r.defined(e.depth)) {
				if (r.string(e.depth) && r.inArray(e.depth, [
					"onepixel",
					"onetile",
					"one"
				])) this.options.tileDepth = e.depth;
				else throw r.invalidParameterError("depth", "one of: onepixel, onetile, one", e.depth);
			}
			if (r.defined(e.skipBlanks)) {
				if (r.integer(e.skipBlanks) && r.inRange(e.skipBlanks, -1, 65535)) this.options.tileSkipBlanks = e.skipBlanks;
				else throw r.invalidParameterError("skipBlanks", "integer between -1 and 255/65535", e.skipBlanks);
			} else r.defined(e.layout) && e.layout === "google" && (this.options.tileSkipBlanks = 5);
			let t = r.bool(e.center) ? e.center : e.centre;
			if (r.defined(t) && this._setBooleanOption("tileCentre", t), r.defined(e.id)) {
				if (r.string(e.id)) this.options.tileId = e.id;
				else throw r.invalidParameterError("id", "string", e.id);
			}
			if (r.defined(e.basename)) {
				if (r.string(e.basename)) this.options.tileBasename = e.basename;
				else throw r.invalidParameterError("basename", "string", e.basename);
			}
		}
		if (r.inArray(this.options.formatOut, [
			"jpeg",
			"png",
			"webp"
		])) this.options.tileFormat = this.options.formatOut;
		else if (this.options.formatOut !== "input") throw r.invalidParameterError("format", "one of: jpeg, png, webp", this.options.formatOut);
		return this._updateFormatOut("dz");
	}
	function M(e) {
		if (!r.plainObject(e)) throw r.invalidParameterError("options", "object", e);
		if (r.integer(e.seconds) && r.inRange(e.seconds, 0, 3600)) this.options.timeoutSeconds = e.seconds;
		else throw r.invalidParameterError("seconds", "integer between 0 and 3600", e.seconds);
		return this;
	}
	function N(e, t) {
		return r.object(t) && t.force === !1 || (this.options.formatOut = e), this;
	}
	function ne(e, t) {
		if (r.bool(t)) this.options[e] = t;
		else throw r.invalidParameterError(e, "boolean", t);
	}
	function P() {
		if (!this.options.streamOut) {
			this.options.streamOut = !0;
			let e = Error();
			this._pipeline(void 0, e);
		}
	}
	function F(e, t) {
		return typeof e == "function" ? (this._isStreamInput() ? this.on("finish", () => {
			this._flattenBufferIn(), i.pipeline(this.options, (n, i, a) => {
				n ? e(r.nativeError(n, t)) : e(null, i, a);
			});
		}) : i.pipeline(this.options, (n, i, a) => {
			n ? e(r.nativeError(n, t)) : e(null, i, a);
		}), this) : this.options.streamOut ? (this._isStreamInput() ? (this.once("finish", () => {
			this._flattenBufferIn(), i.pipeline(this.options, (e, n, i) => {
				e ? this.emit("error", r.nativeError(e, t)) : (this.emit("info", i), this.push(n)), this.push(null), this.on("end", () => this.emit("close"));
			});
		}), this.streamInFinished && this.emit("finish")) : i.pipeline(this.options, (e, n, i) => {
			e ? this.emit("error", r.nativeError(e, t)) : (this.emit("info", i), this.push(n)), this.push(null), this.on("end", () => this.emit("close"));
		}), this) : this._isStreamInput() ? new Promise((e, n) => {
			this.once("finish", () => {
				this._flattenBufferIn(), i.pipeline(this.options, (i, a, o) => {
					i ? n(r.nativeError(i, t)) : this.options.resolveWithObject ? e({
						data: a,
						info: o
					}) : e(a);
				});
			});
		}) : new Promise((e, n) => {
			i.pipeline(this.options, (i, a, o) => {
				i ? n(r.nativeError(i, t)) : this.options.resolveWithObject ? e({
					data: a,
					info: o
				}) : e(a);
			});
		});
	}
	t.exports = (e) => {
		Object.assign(e.prototype, {
			toFile: l,
			toBuffer: u,
			keepExif: d,
			withExif: f,
			withExifMerge: p,
			keepIccProfile: m,
			withIccProfile: h,
			keepXmp: g,
			withXmp: _,
			keepMetadata: v,
			withMetadata: y,
			toFormat: b,
			jpeg: x,
			jp2: T,
			png: S,
			webp: C,
			tiff: D,
			avif: O,
			heif: k,
			jxl: A,
			gif: w,
			raw: ee,
			tile: te,
			timeout: M,
			_updateFormatOut: N,
			_setBooleanOption: ne,
			_read: P,
			_pipeline: F
		});
	};
})), nn = /* @__PURE__ */ O(((e, t) => {
	var n = j("node:events"), r = et(), i = Xe(), { runtimePlatformArch: a } = Wt(), o = Gt(), s = a(), c = o.libvipsVersion(), l = o.format();
	l.heif.output.alias = ["avif", "heic"], l.jpeg.output.alias = ["jpe", "jpg"], l.tiff.output.alias = ["tif"], l.jp2k.output.alias = [
		"j2c",
		"j2k",
		"jp2",
		"jpx"
	];
	var u = {
		nearest: "nearest",
		bilinear: "bilinear",
		bicubic: "bicubic",
		locallyBoundedBicubic: "lbb",
		nohalo: "nohalo",
		vertexSplitQuadraticBasisSpline: "vsqbs"
	}, d = { vips: c.semver };
	/* node:coverage ignore next 15 */
	if (!c.isGlobal) {
		if (c.isWasm) try {
			d = j("@img/sharp-wasm32/versions");
		} catch {}
		else try {
			d = j(`@img/sharp-${s}/versions`);
		} catch {
			try {
				d = j(`@img/sharp-libvips-${s}/versions`);
			} catch {}
		}
	}
	/* node:coverage ignore next 5 */
	d.sharp = (Ut(), te(xt).default).version, d.heif && l.heif && (l.heif.input.fileSuffix = [".avif"], l.heif.output.alias = ["avif"]);
	function f(e) {
		return i.bool(e) ? e ? o.cache(50, 20, 100) : o.cache(0, 0, 0) : i.object(e) ? o.cache(e.memory, e.files, e.items) : o.cache();
	}
	f(!0);
	function p(e) {
		return o.concurrency(i.integer(e) ? e : null);
	}
	/* node:coverage ignore next 7 */
	r.familySync() === r.GLIBC && !o._isUsingJemalloc() ? o.concurrency(1) : r.familySync() === r.MUSL && o.concurrency() === 1024 && o.concurrency(j("node:os").availableParallelism());
	var m = new n.EventEmitter();
	function h() {
		return o.counters();
	}
	function g(e) {
		return o.simd(i.bool(e) ? e : null);
	}
	function _(e) {
		if (i.object(e)) {
			if (Array.isArray(e.operation) && e.operation.every(i.string)) o.block(e.operation, !0);
			else throw i.invalidParameterError("operation", "Array<string>", e.operation);
		} else throw i.invalidParameterError("options", "object", e);
	}
	function v(e) {
		if (i.object(e)) {
			if (Array.isArray(e.operation) && e.operation.every(i.string)) o.block(e.operation, !1);
			else throw i.invalidParameterError("operation", "Array<string>", e.operation);
		} else throw i.invalidParameterError("options", "object", e);
	}
	t.exports = (e) => {
		e.cache = f, e.concurrency = p, e.counters = h, e.simd = g, e.format = l, e.interpolators = u, e.versions = d, e.queue = m, e.block = _, e.unblock = v;
	};
})), rn = /* @__PURE__ */ O(((e, t) => {
	var n = Kt();
	qt()(n), Jt()(n), Yt()(n), Xt()(n), $t()(n), en()(n), tn()(n), nn()(n), t.exports = n;
})), an = /* @__PURE__ */ ee(Ye(), 1), on = /* @__PURE__ */ ee(rn(), 1), sn = {
	"node:fs": ((e) => {
		e.exports = l;
	}),
	"node:path": ((e) => {
		e.exports = o;
	}),
	"node:url": ((e) => {
		e.exports = y;
	}),
	"onnxruntime-common": ((e) => {
		e.exports = Oe;
	}),
	"onnxruntime-node": ((e) => {
		e.exports = an;
	}),
	sharp: ((e) => {
		e.exports = on;
	}),
	"?8b6b": (() => {}),
	"./node_modules/@huggingface/jinja/dist/index.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			Environment: () => ve,
			Interpreter: () => Se,
			Template: () => Le,
			parse: () => ae,
			tokenize: () => d
		});
		var r = Object.freeze({
			Text: "Text",
			NumericLiteral: "NumericLiteral",
			StringLiteral: "StringLiteral",
			Identifier: "Identifier",
			Equals: "Equals",
			OpenParen: "OpenParen",
			CloseParen: "CloseParen",
			OpenStatement: "OpenStatement",
			CloseStatement: "CloseStatement",
			OpenExpression: "OpenExpression",
			CloseExpression: "CloseExpression",
			OpenSquareBracket: "OpenSquareBracket",
			CloseSquareBracket: "CloseSquareBracket",
			OpenCurlyBracket: "OpenCurlyBracket",
			CloseCurlyBracket: "CloseCurlyBracket",
			Comma: "Comma",
			Dot: "Dot",
			Colon: "Colon",
			Pipe: "Pipe",
			CallOperator: "CallOperator",
			AdditiveBinaryOperator: "AdditiveBinaryOperator",
			MultiplicativeBinaryOperator: "MultiplicativeBinaryOperator",
			ComparisonBinaryOperator: "ComparisonBinaryOperator",
			UnaryOperator: "UnaryOperator",
			Comment: "Comment"
		}), i = class {
			constructor(e, t) {
				this.value = e, this.type = t;
			}
		};
		function a(e) {
			return /\w/.test(e);
		}
		function o(e) {
			return /[0-9]/.test(e);
		}
		function s(e) {
			return /\s/.test(e);
		}
		var c = [
			["{%", r.OpenStatement],
			["%}", r.CloseStatement],
			["{{", r.OpenExpression],
			["}}", r.CloseExpression],
			["(", r.OpenParen],
			[")", r.CloseParen],
			["{", r.OpenCurlyBracket],
			["}", r.CloseCurlyBracket],
			["[", r.OpenSquareBracket],
			["]", r.CloseSquareBracket],
			[",", r.Comma],
			[".", r.Dot],
			[":", r.Colon],
			["|", r.Pipe],
			["<=", r.ComparisonBinaryOperator],
			[">=", r.ComparisonBinaryOperator],
			["==", r.ComparisonBinaryOperator],
			["!=", r.ComparisonBinaryOperator],
			["<", r.ComparisonBinaryOperator],
			[">", r.ComparisonBinaryOperator],
			["+", r.AdditiveBinaryOperator],
			["-", r.AdditiveBinaryOperator],
			["~", r.AdditiveBinaryOperator],
			["*", r.MultiplicativeBinaryOperator],
			["/", r.MultiplicativeBinaryOperator],
			["%", r.MultiplicativeBinaryOperator],
			["=", r.Equals]
		], l = /* @__PURE__ */ new Map([
			["n", "\n"],
			["t", "	"],
			["r", "\r"],
			["b", "\b"],
			["f", "\f"],
			["v", "\v"],
			["'", "'"],
			["\"", "\""],
			["\\", "\\"]
		]);
		function u(e, t = {}) {
			return e.endsWith("\n") && (e = e.slice(0, -1)), t.lstrip_blocks && (e = e.replace(/^[ \t]*({[#%-])/gm, "$1")), t.trim_blocks && (e = e.replace(/([#%-]})\n/g, "$1")), e.replace(/{%\s*(end)?generation\s*%}/gs, "");
		}
		function d(e, t = {}) {
			let n = [], d = u(e, t), f = 0, p = 0, m = (e) => {
				let t = "";
				for (; e(d[f]);) {
					if (d[f] === "\\") {
						if (++f, f >= d.length) throw SyntaxError("Unexpected end of input");
						let e = d[f++], n = l.get(e);
						if (n === void 0) throw SyntaxError(`Unexpected escaped character: ${e}`);
						t += n;
						continue;
					}
					if (t += d[f++], f >= d.length) throw SyntaxError("Unexpected end of input");
				}
				return t;
			}, h = () => {
				let e = n.at(-1);
				e && e.type === r.Text && (e.value = e.value.trimEnd(), e.value === "" && n.pop());
			}, g = () => {
				for (; f < d.length && s(d[f]);) ++f;
			};
			main: for (; f < d.length;) {
				let e = n.at(-1)?.type;
				if (e === void 0 || e === r.CloseStatement || e === r.CloseExpression || e === r.Comment) {
					let e = "";
					for (; f < d.length && (d[f] !== "{" || d[f + 1] !== "%" && d[f + 1] !== "{" && d[f + 1] !== "#");) e += d[f++];
					if (e.length > 0) {
						n.push(new i(e, r.Text));
						continue;
					}
				}
				if (d[f] === "{" && d[f + 1] === "#") {
					f += 2;
					let e = d[f] === "-";
					e && ++f;
					let t = "";
					for (; d[f] !== "#" || d[f + 1] !== "}";) {
						if (f + 2 >= d.length) throw SyntaxError("Missing end of comment tag");
						t += d[f++];
					}
					let a = t.endsWith("-");
					a && (t = t.slice(0, -1)), e && h(), n.push(new i(t, r.Comment)), f += 2, a && g();
					continue;
				}
				if (d.slice(f, f + 3) === "{%-") {
					h(), n.push(new i("{%", r.OpenStatement)), f += 3;
					continue;
				}
				if (d.slice(f, f + 3) === "{{-") {
					h(), n.push(new i("{{", r.OpenExpression)), p = 0, f += 3;
					continue;
				}
				if (m(s), d.slice(f, f + 3) === "-%}") {
					n.push(new i("%}", r.CloseStatement)), f += 3, g();
					continue;
				}
				if (d.slice(f, f + 3) === "-}}") {
					n.push(new i("}}", r.CloseExpression)), f += 3, g();
					continue;
				}
				let t = d[f];
				if (t === "-" || t === "+") {
					let e = n.at(-1)?.type;
					if (e === r.Text || e === void 0) throw SyntaxError(`Unexpected character: ${t}`);
					switch (e) {
						case r.Identifier:
						case r.NumericLiteral:
						case r.StringLiteral:
						case r.CloseParen:
						case r.CloseSquareBracket: break;
						default: {
							++f;
							let e = m(o);
							n.push(new i(`${t}${e}`, e.length > 0 ? r.NumericLiteral : r.UnaryOperator));
							continue;
						}
					}
				}
				for (let [e, t] of c) if (!(e === "}}" && p > 0) && d.slice(f, f + e.length) === e) {
					n.push(new i(e, t)), t === r.OpenExpression ? p = 0 : t === r.OpenCurlyBracket ? ++p : t === r.CloseCurlyBracket && --p, f += e.length;
					continue main;
				}
				if (t === "'" || t === "\"") {
					++f;
					let e = m((e) => e !== t);
					n.push(new i(e, r.StringLiteral)), ++f;
					continue;
				}
				if (o(t)) {
					let e = m(o);
					if (d[f] === "." && o(d[f + 1])) {
						++f;
						let t = m(o);
						e = `${e}.${t}`;
					}
					n.push(new i(e, r.NumericLiteral));
					continue;
				}
				if (a(t)) {
					let e = m(a);
					n.push(new i(e, r.Identifier));
					continue;
				}
				throw SyntaxError(`Unexpected character: ${t}`);
			}
			return n;
		}
		var f = class {
			type = "Statement";
		}, p = class extends f {
			constructor(e) {
				super(), this.body = e;
			}
			type = "Program";
		}, m = class extends f {
			constructor(e, t, n) {
				super(), this.test = e, this.body = t, this.alternate = n;
			}
			type = "If";
		}, h = class extends f {
			constructor(e, t, n, r) {
				super(), this.loopvar = e, this.iterable = t, this.body = n, this.defaultBlock = r;
			}
			type = "For";
		}, g = class extends f {
			type = "Break";
		}, _ = class extends f {
			type = "Continue";
		}, v = class extends f {
			constructor(e, t, n) {
				super(), this.assignee = e, this.value = t, this.body = n;
			}
			type = "Set";
		}, y = class extends f {
			constructor(e, t, n) {
				super(), this.name = e, this.args = t, this.body = n;
			}
			type = "Macro";
		}, b = class extends f {
			constructor(e) {
				super(), this.value = e;
			}
			type = "Comment";
		}, x = class extends f {
			type = "Expression";
		}, S = class extends x {
			constructor(e, t, n) {
				super(), this.object = e, this.property = t, this.computed = n;
			}
			type = "MemberExpression";
		}, C = class extends x {
			constructor(e, t) {
				super(), this.callee = e, this.args = t;
			}
			type = "CallExpression";
		}, w = class extends x {
			constructor(e) {
				super(), this.value = e;
			}
			type = "Identifier";
		}, T = class extends x {
			constructor(e) {
				super(), this.value = e;
			}
			type = "Literal";
		}, E = class extends T {
			type = "IntegerLiteral";
		}, D = class extends T {
			type = "FloatLiteral";
		}, O = class extends T {
			type = "StringLiteral";
		}, k = class extends T {
			type = "ArrayLiteral";
		}, A = class extends T {
			type = "TupleLiteral";
		}, ee = class extends T {
			type = "ObjectLiteral";
		}, te = class extends x {
			constructor(e, t, n) {
				super(), this.operator = e, this.left = t, this.right = n;
			}
			type = "BinaryExpression";
		}, j = class extends x {
			constructor(e, t) {
				super(), this.operand = e, this.filter = t;
			}
			type = "FilterExpression";
		}, M = class extends f {
			constructor(e, t) {
				super(), this.filter = e, this.body = t;
			}
			type = "FilterStatement";
		}, N = class extends x {
			constructor(e, t) {
				super(), this.lhs = e, this.test = t;
			}
			type = "SelectExpression";
		}, ne = class extends x {
			constructor(e, t, n) {
				super(), this.operand = e, this.negate = t, this.test = n;
			}
			type = "TestExpression";
		}, P = class extends x {
			constructor(e, t) {
				super(), this.operator = e, this.argument = t;
			}
			type = "UnaryExpression";
		}, F = class extends x {
			constructor(e = void 0, t = void 0, n = void 0) {
				super(), this.start = e, this.stop = t, this.step = n;
			}
			type = "SliceExpression";
		}, re = class extends x {
			constructor(e, t) {
				super(), this.key = e, this.value = t;
			}
			type = "KeywordArgumentExpression";
		}, ie = class extends x {
			constructor(e) {
				super(), this.argument = e;
			}
			type = "SpreadExpression";
		}, I = class extends f {
			constructor(e, t, n) {
				super(), this.call = e, this.callerArgs = t, this.body = n;
			}
			type = "CallStatement";
		}, L = class extends x {
			constructor(e, t, n) {
				super(), this.condition = e, this.trueExpr = t, this.falseExpr = n;
			}
			type = "Ternary";
		};
		function ae(e) {
			let t = new p([]), n = 0;
			function a(t, r) {
				let i = e[n++];
				if (!i || i.type !== t) throw Error(`Parser Error: ${r}. ${i.type} !== ${t}.`);
				return i;
			}
			function o(e) {
				if (!u(e)) throw SyntaxError(`Expected ${e}`);
				++n;
			}
			function s() {
				switch (e[n].type) {
					case r.Comment: return new b(e[n++].value);
					case r.Text: return d();
					case r.OpenStatement: return f();
					case r.OpenExpression: return x();
					default: throw SyntaxError(`Unexpected token type: ${e[n].type}`);
				}
			}
			function c(...t) {
				return n + t.length <= e.length && t.every((t, r) => t === e[n + r].type);
			}
			function l(...t) {
				return e[n]?.type === r.OpenStatement && e[n + 1]?.type === r.Identifier && t.includes(e[n + 1]?.value);
			}
			function u(...t) {
				return n + t.length <= e.length && t.every((t, r) => e[n + r].type === "Identifier" && t === e[n + r].value);
			}
			function d() {
				return new O(a(r.Text, "Expected text token").value);
			}
			function f() {
				if (a(r.OpenStatement, "Expected opening statement token"), e[n].type !== r.Identifier) throw SyntaxError(`Unknown statement, got ${e[n].type}`);
				let t = e[n].value, i;
				switch (t) {
					case "set":
						++n, i = T();
						break;
					case "if":
						++n, i = ae(), a(r.OpenStatement, "Expected {% token"), o("endif"), a(r.CloseStatement, "Expected %} token");
						break;
					case "macro":
						++n, i = oe(), a(r.OpenStatement, "Expected {% token"), o("endmacro"), a(r.CloseStatement, "Expected %} token");
						break;
					case "for":
						++n, i = ce(), a(r.OpenStatement, "Expected {% token"), o("endfor"), a(r.CloseStatement, "Expected %} token");
						break;
					case "call": {
						++n;
						let e = null;
						c(r.OpenParen) && (e = U());
						let t = q();
						if (t.type !== "Identifier") throw SyntaxError("Expected identifier following call statement");
						let u = U();
						a(r.CloseStatement, "Expected closing statement token");
						let d = [];
						for (; !l("endcall");) d.push(s());
						a(r.OpenStatement, "Expected '{%'"), o("endcall"), a(r.CloseStatement, "Expected closing statement token"), i = new I(new C(t, u), e, d);
						break;
					}
					case "break":
						++n, a(r.CloseStatement, "Expected closing statement token"), i = new g();
						break;
					case "continue":
						++n, a(r.CloseStatement, "Expected closing statement token"), i = new _();
						break;
					case "filter": {
						++n;
						let e = q();
						e instanceof w && c(r.OpenParen) && (e = H(e)), a(r.CloseStatement, "Expected closing statement token");
						let t = [];
						for (; !l("endfilter");) t.push(s());
						a(r.OpenStatement, "Expected '{%'"), o("endfilter"), a(r.CloseStatement, "Expected '%}'"), i = new M(e, t);
						break;
					}
					default: throw SyntaxError(`Unknown statement type: ${t}`);
				}
				return i;
			}
			function x() {
				a(r.OpenExpression, "Expected opening expression token");
				let e = R();
				return a(r.CloseExpression, "Expected closing expression token"), e;
			}
			function T() {
				let e = se(), t = null, i = [];
				if (c(r.Equals)) ++n, t = se();
				else {
					for (a(r.CloseStatement, "Expected %} token"); !l("endset");) i.push(s());
					a(r.OpenStatement, "Expected {% token"), o("endset");
				}
				return a(r.CloseStatement, "Expected closing statement token"), new v(e, t, i);
			}
			function ae() {
				let e = R();
				a(r.CloseStatement, "Expected closing statement token");
				let t = [], i = [];
				for (; !l("elif", "else", "endif");) t.push(s());
				if (l("elif")) {
					++n, ++n;
					let e = ae();
					i.push(e);
				} else if (l("else")) for (++n, ++n, a(r.CloseStatement, "Expected closing statement token"); !l("endif");) i.push(s());
				return new m(e, t, i);
			}
			function oe() {
				let e = q();
				if (e.type !== "Identifier") throw SyntaxError("Expected identifier following macro statement");
				let t = U();
				a(r.CloseStatement, "Expected closing statement token");
				let n = [];
				for (; !l("endmacro");) n.push(s());
				return new y(e, t, n);
			}
			function se(e = !1) {
				let t = e ? q : R, i = [t()], a = c(r.Comma);
				for (; a && (++n, i.push(t()), c(r.Comma)););
				return a ? new A(i) : i[0];
			}
			function ce() {
				let e = se(!0);
				if (!(e instanceof w || e instanceof A)) throw SyntaxError(`Expected identifier/tuple for the loop variable, got ${e.type} instead`);
				if (!u("in")) throw SyntaxError("Expected `in` keyword following loop variable");
				++n;
				let t = R();
				a(r.CloseStatement, "Expected closing statement token");
				let i = [];
				for (; !l("endfor", "else");) i.push(s());
				let o = [];
				if (l("else")) for (++n, ++n, a(r.CloseStatement, "Expected closing statement token"); !l("endfor");) o.push(s());
				return new h(e, t, i, o);
			}
			function R() {
				return z();
			}
			function z() {
				let e = le();
				if (u("if")) {
					++n;
					let t = le();
					return u("else") ? (++n, new L(t, e, z())) : new N(e, t);
				}
				return e;
			}
			function le() {
				let t = ue();
				for (; u("or");) {
					let r = e[n];
					++n;
					let i = ue();
					t = new te(r, t, i);
				}
				return t;
			}
			function ue() {
				let t = de();
				for (; u("and");) {
					let r = e[n];
					++n;
					let i = de();
					t = new te(r, t, i);
				}
				return t;
			}
			function de() {
				let t;
				for (; u("not");) {
					let r = e[n];
					++n, t = new P(r, de());
				}
				return t ?? fe();
			}
			function fe() {
				let t = B();
				for (;;) {
					let a;
					if (u("not", "in")) a = new i("not in", r.Identifier), n += 2;
					else if (u("in")) a = e[n++];
					else if (c(r.ComparisonBinaryOperator)) a = e[n++];
					else break;
					let o = B();
					t = new te(a, t, o);
				}
				return t;
			}
			function B() {
				let t = me();
				for (; c(r.AdditiveBinaryOperator);) {
					let r = e[n];
					++n;
					let i = me();
					t = new te(r, t, i);
				}
				return t;
			}
			function V() {
				let e = G(q());
				return c(r.OpenParen) ? H(e) : e;
			}
			function H(e) {
				let t = new C(e, U());
				return t = G(t), c(r.OpenParen) && (t = H(t)), t;
			}
			function U() {
				a(r.OpenParen, "Expected opening parenthesis for arguments list");
				let e = W();
				return a(r.CloseParen, "Expected closing parenthesis for arguments list"), e;
			}
			function W() {
				let t = [];
				for (; !c(r.CloseParen);) {
					let i;
					if (e[n].type === r.MultiplicativeBinaryOperator && e[n].value === "*") ++n, i = new ie(R());
					else if (i = R(), c(r.Equals)) {
						if (++n, !(i instanceof w)) throw SyntaxError("Expected identifier for keyword argument");
						let e = R();
						i = new re(i, e);
					}
					t.push(i), c(r.Comma) && ++n;
				}
				return t;
			}
			function pe() {
				let e = [], t = !1;
				for (; !c(r.CloseSquareBracket);) c(r.Colon) ? (e.push(void 0), ++n, t = !0) : (e.push(R()), c(r.Colon) && (++n, t = !0));
				if (e.length === 0) throw SyntaxError("Expected at least one argument for member/slice expression");
				if (t) {
					if (e.length > 3) throw SyntaxError("Expected 0-3 arguments for slice expression");
					return new F(...e);
				}
				return e[0];
			}
			function G(t) {
				for (; c(r.Dot) || c(r.OpenSquareBracket);) {
					let i = e[n];
					++n;
					let o, s = i.type === r.OpenSquareBracket;
					if (s) o = pe(), a(r.CloseSquareBracket, "Expected closing square bracket");
					else if (o = q(), o.type !== "Identifier") throw SyntaxError("Expected identifier following dot operator");
					t = new S(t, o, s);
				}
				return t;
			}
			function me() {
				let t = K();
				for (; c(r.MultiplicativeBinaryOperator);) {
					let r = e[n++], i = K();
					t = new te(r, t, i);
				}
				return t;
			}
			function K() {
				let e = he();
				for (; u("is");) {
					++n;
					let t = u("not");
					t && ++n;
					let r = q();
					if (!(r instanceof w)) throw SyntaxError("Expected identifier for the test");
					e = new ne(e, t, r);
				}
				return e;
			}
			function he() {
				let e = V();
				for (; c(r.Pipe);) {
					++n;
					let t = q();
					if (!(t instanceof w)) throw SyntaxError("Expected identifier for the filter");
					c(r.OpenParen) && (t = H(t)), e = new j(e, t);
				}
				return e;
			}
			function q() {
				let t = e[n++];
				switch (t.type) {
					case r.NumericLiteral: {
						let e = t.value;
						return e.includes(".") ? new D(Number(e)) : new E(Number(e));
					}
					case r.StringLiteral: {
						let i = t.value;
						for (; c(r.StringLiteral);) i += e[n++].value;
						return new O(i);
					}
					case r.Identifier: return new w(t.value);
					case r.OpenParen: {
						let e = se();
						return a(r.CloseParen, "Expected closing parenthesis, got ${tokens[current].type} instead."), e;
					}
					case r.OpenSquareBracket: {
						let e = [];
						for (; !c(r.CloseSquareBracket);) e.push(R()), c(r.Comma) && ++n;
						return ++n, new k(e);
					}
					case r.OpenCurlyBracket: {
						let e = /* @__PURE__ */ new Map();
						for (; !c(r.CloseCurlyBracket);) {
							let t = R();
							a(r.Colon, "Expected colon between key and value in object literal");
							let i = R();
							e.set(t, i), c(r.Comma) && ++n;
						}
						return ++n, new ee(e);
					}
					default: throw SyntaxError(`Unexpected token: ${t.type}`);
				}
			}
			for (; n < e.length;) t.body.push(s());
			return t;
		}
		function oe(e, t, n = 1) {
			t === void 0 && (t = e, e = 0);
			let r = [];
			for (let i = e; i < t; i += n) r.push(i);
			return r;
		}
		function se(e, t, n, r = 1) {
			let i = Math.sign(r);
			i >= 0 ? (t = (t ??= 0) < 0 ? Math.max(e.length + t, 0) : Math.min(t, e.length), n = (n ??= e.length) < 0 ? Math.max(e.length + n, 0) : Math.min(n, e.length)) : (t = (t ??= e.length - 1) < 0 ? Math.max(e.length + t, -1) : Math.min(t, e.length - 1), n = (n ??= -1) < -1 ? Math.max(e.length + n, -1) : Math.min(n, e.length - 1));
			let a = [];
			for (let o = t; i * o < i * n; o += r) a.push(e[o]);
			return a;
		}
		function ce(e) {
			return e.replace(/\b\w/g, (e) => e.toUpperCase());
		}
		function R(e) {
			return z(/* @__PURE__ */ new Date(), e);
		}
		function z(e, t) {
			let n = new Intl.DateTimeFormat(void 0, { month: "long" }), r = new Intl.DateTimeFormat(void 0, { month: "short" }), i = (e) => e < 10 ? "0" + e : e.toString();
			return t.replace(/%[YmdbBHM%]/g, (t) => {
				switch (t) {
					case "%Y": return e.getFullYear().toString();
					case "%m": return i(e.getMonth() + 1);
					case "%d": return i(e.getDate());
					case "%b": return r.format(e);
					case "%B": return n.format(e);
					case "%H": return i(e.getHours());
					case "%M": return i(e.getMinutes());
					case "%%": return "%";
					default: return t;
				}
			});
		}
		function le(e) {
			return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
		function ue(e, t, n, r) {
			if (r === 0) return e;
			let i = r == null || r < 0 ? Infinity : r, a = t.length === 0 ? /* @__PURE__ */ RegExp("(?=)", "gu") : new RegExp(le(t), "gu");
			return e.replaceAll(a, (e) => i > 0 ? (--i, n) : e);
		}
		var de = class extends Error {}, fe = class extends Error {}, B = class {
			type = "RuntimeValue";
			value;
			builtins = /* @__PURE__ */ new Map();
			constructor(e = void 0) {
				this.value = e;
			}
			__bool__() {
				return new W(!!this.value);
			}
			toString() {
				return String(this.value);
			}
		}, V = class extends B {
			type = "IntegerValue";
		}, H = class extends B {
			type = "FloatValue";
			toString() {
				return this.value % 1 == 0 ? this.value.toFixed(1) : this.value.toString();
			}
		}, U = class extends B {
			type = "StringValue";
			builtins = /* @__PURE__ */ new Map([
				["upper", new q(() => new U(this.value.toUpperCase()))],
				["lower", new q(() => new U(this.value.toLowerCase()))],
				["strip", new q(() => new U(this.value.trim()))],
				["title", new q(() => new U(ce(this.value)))],
				["capitalize", new q(() => new U(this.value.charAt(0).toUpperCase() + this.value.slice(1)))],
				["length", new V(this.value.length)],
				["rstrip", new q(() => new U(this.value.trimEnd()))],
				["lstrip", new q(() => new U(this.value.trimStart()))],
				["startswith", new q((e) => {
					if (e.length === 0) throw Error("startswith() requires at least one argument");
					let t = e[0];
					if (t instanceof U) return new W(this.value.startsWith(t.value));
					if (t instanceof K) {
						for (let e of t.value) {
							if (!(e instanceof U)) throw Error("startswith() tuple elements must be strings");
							if (this.value.startsWith(e.value)) return new W(!0);
						}
						return new W(!1);
					}
					throw Error("startswith() argument must be a string or tuple of strings");
				})],
				["endswith", new q((e) => {
					if (e.length === 0) throw Error("endswith() requires at least one argument");
					let t = e[0];
					if (t instanceof U) return new W(this.value.endsWith(t.value));
					if (t instanceof K) {
						for (let e of t.value) {
							if (!(e instanceof U)) throw Error("endswith() tuple elements must be strings");
							if (this.value.endsWith(e.value)) return new W(!0);
						}
						return new W(!1);
					}
					throw Error("endswith() argument must be a string or tuple of strings");
				})],
				["split", new q((e) => {
					let t = e[0] ?? new ge();
					if (!(t instanceof U || t instanceof ge)) throw Error("sep argument must be a string or null");
					let n = e[1] ?? new V(-1);
					if (!(n instanceof V)) throw Error("maxsplit argument must be a number");
					let r = [];
					if (t instanceof ge) {
						let e = this.value.trimStart();
						for (let { 0: t, index: i } of e.matchAll(/\S+/g)) {
							if (n.value !== -1 && r.length >= n.value && i !== void 0) {
								r.push(t + e.slice(i + t.length));
								break;
							}
							r.push(t);
						}
					} else {
						if (t.value === "") throw Error("empty separator");
						r = this.value.split(t.value), n.value !== -1 && r.length > n.value && r.push(r.splice(n.value).join(t.value));
					}
					return new K(r.map((e) => new U(e)));
				})],
				["replace", new q((e) => {
					if (e.length < 2) throw Error("replace() requires at least two arguments");
					let t = e[0], n = e[1];
					if (!(t instanceof U && n instanceof U)) throw Error("replace() arguments must be strings");
					let r;
					if (r = e.length > 2 ? e[2].type === "KeywordArgumentsValue" ? e[2].value.get("count") ?? new ge() : e[2] : new ge(), !(r instanceof V || r instanceof ge)) throw Error("replace() count argument must be a number or null");
					return new U(ue(this.value, t.value, n.value, r.value));
				})]
			]);
		}, W = class extends B {
			type = "BooleanValue";
		};
		function pe(e, t, n, r = !0) {
			let i = n ?? 0;
			switch (e.type) {
				case "NullValue": return "null";
				case "UndefinedValue": return r ? "null" : "undefined";
				case "IntegerValue":
				case "FloatValue":
				case "StringValue":
				case "BooleanValue": return JSON.stringify(e.value);
				case "ArrayValue":
				case "ObjectValue": {
					let n = t ? " ".repeat(t) : "", a = "\n" + n.repeat(i), o = a + n;
					if (e.type === "ArrayValue") {
						let n = e.value.map((e) => pe(e, t, i + 1, r));
						return t ? `[${o}${n.join(`,${o}`)}${a}]` : `[${n.join(", ")}]`;
					}
					{
						let n = Array.from(e.value.entries()).map(([e, n]) => {
							let a = `"${e}": ${pe(n, t, i + 1, r)}`;
							return t ? `${o}${a}` : a;
						});
						return t ? `{${n.join(",")}${a}}` : `{${n.join(", ")}}`;
					}
				}
				default: throw Error(`Cannot convert to JSON: ${e.type}`);
			}
		}
		var G = class extends B {
			type = "ObjectValue";
			__bool__() {
				return new W(this.value.size > 0);
			}
			builtins = /* @__PURE__ */ new Map([
				["get", new q(([e, t]) => {
					if (!(e instanceof U)) throw Error(`Object key must be a string: got ${e.type}`);
					return this.value.get(e.value) ?? t ?? new ge();
				})],
				["items", new q(() => this.items())],
				["keys", new q(() => this.keys())],
				["values", new q(() => this.values())],
				["dictsort", new q((e) => {
					let t = /* @__PURE__ */ new Map(), n = e.filter((e) => e instanceof me ? (t = e.value, !1) : !0), r = n.at(0) ?? t.get("case_sensitive") ?? new W(!1);
					if (!(r instanceof W)) throw Error("case_sensitive must be a boolean");
					let i = n.at(1) ?? t.get("by") ?? new U("key");
					if (!(i instanceof U)) throw Error("by must be a string");
					if (!["key", "value"].includes(i.value)) throw Error("by must be either 'key' or 'value'");
					let a = n.at(2) ?? t.get("reverse") ?? new W(!1);
					if (!(a instanceof W)) throw Error("reverse must be a boolean");
					return new K(Array.from(this.value.entries()).map(([e, t]) => new K([new U(e), t])).sort((e, t) => {
						let n = i.value === "key" ? 0 : 1, o = e.value[n], s = t.value[n], c = xe(o, s, r.value);
						return a.value ? -c : c;
					}));
				})]
			]);
			items() {
				return new K(Array.from(this.value.entries()).map(([e, t]) => new K([new U(e), t])));
			}
			keys() {
				return new K(Array.from(this.value.keys()).map((e) => new U(e)));
			}
			values() {
				return new K(Array.from(this.value.values()));
			}
			toString() {
				return pe(this, null, 0, !1);
			}
		}, me = class extends G {
			type = "KeywordArgumentsValue";
		}, K = class extends B {
			type = "ArrayValue";
			builtins = /* @__PURE__ */ new Map([["length", new V(this.value.length)]]);
			__bool__() {
				return new W(this.value.length > 0);
			}
			toString() {
				return pe(this, null, 0, !1);
			}
		}, he = class extends K {
			type = "TupleValue";
		}, q = class extends B {
			type = "FunctionValue";
		}, ge = class extends B {
			type = "NullValue";
		}, _e = class extends B {
			type = "UndefinedValue";
		}, ve = class {
			constructor(e) {
				this.parent = e;
			}
			variables = /* @__PURE__ */ new Map([["namespace", new q((e) => {
				if (e.length === 0) return new G(/* @__PURE__ */ new Map());
				if (e.length !== 1 || !(e[0] instanceof G)) throw Error("`namespace` expects either zero arguments or a single object argument");
				return e[0];
			})]]);
			tests = /* @__PURE__ */ new Map([
				["boolean", (e) => e.type === "BooleanValue"],
				["callable", (e) => e instanceof q],
				["odd", (e) => {
					if (!(e instanceof V)) throw Error(`cannot odd on ${e.type}`);
					return e.value % 2 != 0;
				}],
				["even", (e) => {
					if (!(e instanceof V)) throw Error(`cannot even on ${e.type}`);
					return e.value % 2 == 0;
				}],
				["false", (e) => e.type === "BooleanValue" && !e.value],
				["true", (e) => e.type === "BooleanValue" && e.value],
				["none", (e) => e.type === "NullValue"],
				["string", (e) => e.type === "StringValue"],
				["number", (e) => e instanceof V || e instanceof H],
				["integer", (e) => e instanceof V],
				["iterable", (e) => e.type === "ArrayValue" || e.type === "StringValue"],
				["mapping", (e) => e.type === "ObjectValue"],
				["lower", (e) => {
					let t = e.value;
					return e.type === "StringValue" && t === t.toLowerCase();
				}],
				["upper", (e) => {
					let t = e.value;
					return e.type === "StringValue" && t === t.toUpperCase();
				}],
				["none", (e) => e.type === "NullValue"],
				["defined", (e) => e.type !== "UndefinedValue"],
				["undefined", (e) => e.type === "UndefinedValue"],
				["equalto", (e, t) => e.value === t.value],
				["eq", (e, t) => e.value === t.value]
			]);
			set(e, t) {
				return this.declareVariable(e, Ce(t));
			}
			declareVariable(e, t) {
				if (this.variables.has(e)) throw SyntaxError(`Variable already declared: ${e}`);
				return this.variables.set(e, t), t;
			}
			setVariable(e, t) {
				return this.variables.set(e, t), t;
			}
			resolve(e) {
				if (this.variables.has(e)) return this;
				if (this.parent) return this.parent.resolve(e);
				throw Error(`Unknown variable: ${e}`);
			}
			lookupVariable(e) {
				try {
					return this.resolve(e).variables.get(e) ?? new _e();
				} catch {
					return new _e();
				}
			}
		};
		function ye(e) {
			e.set("false", !1), e.set("true", !0), e.set("none", null), e.set("raise_exception", (e) => {
				throw Error(e);
			}), e.set("range", oe), e.set("strftime_now", R), e.set("True", !0), e.set("False", !1), e.set("None", null);
		}
		function be(e, t) {
			let n = t.split("."), r = e;
			for (let e of n) if (r instanceof G) r = r.value.get(e) ?? new _e();
			else if (r instanceof K) {
				let t = parseInt(e, 10);
				if (!isNaN(t) && t >= 0 && t < r.value.length) r = r.value[t];
				else return new _e();
			} else return new _e();
			return r;
		}
		function xe(e, t, n = !1) {
			if (e instanceof ge && t instanceof ge) return 0;
			if (e instanceof ge || t instanceof ge) throw Error(`Cannot compare ${e.type} with ${t.type}`);
			if (e instanceof _e && t instanceof _e) return 0;
			if (e instanceof _e || t instanceof _e) throw Error(`Cannot compare ${e.type} with ${t.type}`);
			let r = (e) => e instanceof V || e instanceof H || e instanceof W, i = (e) => e instanceof W ? +!!e.value : e.value;
			if (r(e) && r(t)) {
				let n = i(e), r = i(t);
				return n < r ? -1 : +(n > r);
			}
			if (e.type !== t.type) throw Error(`Cannot compare different types: ${e.type} and ${t.type}`);
			switch (e.type) {
				case "StringValue": {
					let r = e.value, i = t.value;
					return n || (r = r.toLowerCase(), i = i.toLowerCase()), r < i ? -1 : +(r > i);
				}
				default: throw Error(`Cannot compare type: ${e.type}`);
			}
		}
		var Se = class {
			global;
			constructor(e) {
				this.global = e ?? new ve();
			}
			run(e) {
				return this.evaluate(e, this.global);
			}
			evaluateBinaryExpression(e, t) {
				let n = this.evaluate(e.left, t);
				switch (e.operator.value) {
					case "and": return n.__bool__().value ? this.evaluate(e.right, t) : n;
					case "or": return n.__bool__().value ? n : this.evaluate(e.right, t);
				}
				let r = this.evaluate(e.right, t);
				switch (e.operator.value) {
					case "==": return new W(n.value == r.value);
					case "!=": return new W(n.value != r.value);
				}
				if (n instanceof _e || r instanceof _e) {
					if (r instanceof _e && ["in", "not in"].includes(e.operator.value)) return new W(e.operator.value === "not in");
					throw Error(`Cannot perform operation ${e.operator.value} on undefined values`);
				}
				if (n instanceof ge || r instanceof ge) throw Error("Cannot perform operation on null values");
				if (e.operator.value === "~") return new U(n.value.toString() + r.value.toString());
				if ((n instanceof V || n instanceof H) && (r instanceof V || r instanceof H)) {
					let t = n.value, i = r.value;
					switch (e.operator.value) {
						case "+":
						case "-":
						case "*": {
							let a = e.operator.value === "+" ? t + i : e.operator.value === "-" ? t - i : t * i;
							return n instanceof H || r instanceof H ? new H(a) : new V(a);
						}
						case "/": return new H(t / i);
						case "%": {
							let e = t % i;
							return n instanceof H || r instanceof H ? new H(e) : new V(e);
						}
						case "<": return new W(t < i);
						case ">": return new W(t > i);
						case ">=": return new W(t >= i);
						case "<=": return new W(t <= i);
					}
				} else if (n instanceof K && r instanceof K) switch (e.operator.value) {
					case "+": return new K(n.value.concat(r.value));
				}
				else if (r instanceof K) {
					let t = r.value.find((e) => e.value === n.value) !== void 0;
					switch (e.operator.value) {
						case "in": return new W(t);
						case "not in": return new W(!t);
					}
				}
				if (n instanceof U || r instanceof U) switch (e.operator.value) {
					case "+": return new U(n.value.toString() + r.value.toString());
				}
				if (n instanceof U && r instanceof U) switch (e.operator.value) {
					case "in": return new W(r.value.includes(n.value));
					case "not in": return new W(!r.value.includes(n.value));
				}
				if (n instanceof U && r instanceof G) switch (e.operator.value) {
					case "in": return new W(r.value.has(n.value));
					case "not in": return new W(!r.value.has(n.value));
				}
				throw SyntaxError(`Unknown operator "${e.operator.value}" between ${n.type} and ${r.type}`);
			}
			evaluateArguments(e, t) {
				let n = [], r = /* @__PURE__ */ new Map();
				for (let i of e) if (i.type === "SpreadExpression") {
					let e = i, r = this.evaluate(e.argument, t);
					if (!(r instanceof K)) throw Error(`Cannot unpack non-iterable type: ${r.type}`);
					for (let e of r.value) n.push(e);
				} else if (i.type === "KeywordArgumentExpression") {
					let e = i;
					r.set(e.key.value, this.evaluate(e.value, t));
				} else {
					if (r.size > 0) throw Error("Positional arguments must come before keyword arguments");
					n.push(this.evaluate(i, t));
				}
				return [n, r];
			}
			applyFilter(e, t, n) {
				if (t.type === "Identifier") {
					let r = t;
					if (r.value === "tojson") return new U(pe(e));
					if (e instanceof K) switch (r.value) {
						case "list": return e;
						case "first": return e.value[0];
						case "last": return e.value[e.value.length - 1];
						case "length": return new V(e.value.length);
						case "reverse": return new K(e.value.slice().reverse());
						case "sort": return new K(e.value.slice().sort((e, t) => xe(e, t, !1)));
						case "join": return new U(e.value.map((e) => e.value).join(""));
						case "string": return new U(pe(e, null, 0, !1));
						case "unique": {
							let t = /* @__PURE__ */ new Set(), n = [];
							for (let r of e.value) t.has(r.value) || (t.add(r.value), n.push(r));
							return new K(n);
						}
						default: throw Error(`Unknown ArrayValue filter: ${r.value}`);
					}
					else if (e instanceof U) switch (r.value) {
						case "length":
						case "upper":
						case "lower":
						case "title":
						case "capitalize": {
							let t = e.builtins.get(r.value);
							if (t instanceof q) return t.value([], n);
							if (t instanceof V) return t;
							throw Error(`Unknown StringValue filter: ${r.value}`);
						}
						case "trim": return new U(e.value.trim());
						case "indent": return new U(e.value.split("\n").map((e, t) => t === 0 || e.length === 0 ? e : "    " + e).join("\n"));
						case "join":
						case "string": return e;
						case "int": {
							let t = parseInt(e.value, 10);
							return new V(isNaN(t) ? 0 : t);
						}
						case "float": {
							let t = parseFloat(e.value);
							return new H(isNaN(t) ? 0 : t);
						}
						default: throw Error(`Unknown StringValue filter: ${r.value}`);
					}
					else if (e instanceof V || e instanceof H) switch (r.value) {
						case "abs": return e instanceof V ? new V(Math.abs(e.value)) : new H(Math.abs(e.value));
						case "int": return new V(Math.floor(e.value));
						case "float": return new H(e.value);
						default: throw Error(`Unknown NumericValue filter: ${r.value}`);
					}
					else if (e instanceof G) switch (r.value) {
						case "items": return new K(Array.from(e.value.entries()).map(([e, t]) => new K([new U(e), t])));
						case "length": return new V(e.value.size);
						default: {
							let t = e.builtins.get(r.value);
							if (t) return t instanceof q ? t.value([], n) : t;
							throw Error(`Unknown ObjectValue filter: ${r.value}`);
						}
					}
					else if (e instanceof W) switch (r.value) {
						case "bool": return new W(e.value);
						case "int": return new V(+!!e.value);
						case "float": return new H(+!!e.value);
						case "string": return new U(e.value ? "true" : "false");
						default: throw Error(`Unknown BooleanValue filter: ${r.value}`);
					}
					throw Error(`Cannot apply filter "${r.value}" to type: ${e.type}`);
				}
				if (t.type === "CallExpression") {
					let r = t;
					if (r.callee.type !== "Identifier") throw Error(`Unknown filter: ${r.callee.type}`);
					let i = r.callee.value;
					if (i === "tojson") {
						let [, t] = this.evaluateArguments(r.args, n), i = t.get("indent") ?? new ge();
						if (!(i instanceof V || i instanceof ge)) throw Error("If set, indent must be a number");
						return new U(pe(e, i.value));
					}
					if (i === "join") {
						let t;
						if (e instanceof U) t = Array.from(e.value);
						else if (e instanceof K) t = e.value.map((e) => e.value);
						else throw Error(`Cannot apply filter "${i}" to type: ${e.type}`);
						let [a, o] = this.evaluateArguments(r.args, n), s = a.at(0) ?? o.get("separator") ?? new U("");
						if (!(s instanceof U)) throw Error("separator must be a string");
						return new U(t.join(s.value));
					}
					if (i === "int" || i === "float") {
						let [t, a] = this.evaluateArguments(r.args, n), o = t.at(0) ?? a.get("default") ?? (i === "int" ? new V(0) : new H(0));
						if (e instanceof U) {
							let t = i === "int" ? parseInt(e.value, 10) : parseFloat(e.value);
							return isNaN(t) ? o : i === "int" ? new V(t) : new H(t);
						}
						if (e instanceof V || e instanceof H) return e;
						if (e instanceof W) return i === "int" ? new V(+!!e.value) : new H(+!!e.value);
						throw Error(`Cannot apply filter "${i}" to type: ${e.type}`);
					}
					if (i === "default") {
						let [t, i] = this.evaluateArguments(r.args, n), a = t[0] ?? new U(""), o = t[1] ?? i.get("boolean") ?? new W(!1);
						if (!(o instanceof W)) throw Error("`default` filter flag must be a boolean");
						return e instanceof _e || o.value && !e.__bool__().value ? a : e;
					}
					if (e instanceof K) {
						switch (i) {
							case "sort": {
								let [t, i] = this.evaluateArguments(r.args, n), a = t.at(0) ?? i.get("reverse") ?? new W(!1);
								if (!(a instanceof W)) throw Error("reverse must be a boolean");
								let o = t.at(1) ?? i.get("case_sensitive") ?? new W(!1);
								if (!(o instanceof W)) throw Error("case_sensitive must be a boolean");
								let s = t.at(2) ?? i.get("attribute") ?? new ge();
								if (!(s instanceof U || s instanceof V || s instanceof ge)) throw Error("attribute must be a string, integer, or null");
								let c = (e) => s instanceof ge ? e : be(e, s instanceof V ? String(s.value) : s.value);
								return new K(e.value.slice().sort((e, t) => {
									let n = xe(c(e), c(t), o.value);
									return a.value ? -n : n;
								}));
							}
							case "selectattr":
							case "rejectattr": {
								let t = i === "selectattr";
								if (e.value.some((e) => !(e instanceof G))) throw Error(`\`${i}\` can only be applied to array of objects`);
								if (r.args.some((e) => e.type !== "StringLiteral")) throw Error(`arguments of \`${i}\` must be strings`);
								let [a, o, s] = r.args.map((e) => this.evaluate(e, n)), c;
								if (o) {
									let e = n.tests.get(o.value);
									if (!e) throw Error(`Unknown test: ${o.value}`);
									c = e;
								} else c = (...e) => e[0].__bool__().value;
								return new K(e.value.filter((e) => {
									let n = e.value.get(a.value), r = n ? c(n, s) : !1;
									return t ? r : !r;
								}));
							}
							case "map": {
								let [, t] = this.evaluateArguments(r.args, n);
								if (t.has("attribute")) {
									let n = t.get("attribute");
									if (!(n instanceof U)) throw Error("attribute must be a string");
									let r = t.get("default");
									return new K(e.value.map((e) => {
										if (!(e instanceof G)) throw Error("items in map must be an object");
										let t = be(e, n.value);
										return t instanceof _e ? r ?? new _e() : t;
									}));
								}
								throw Error("`map` expressions without `attribute` set are not currently supported.");
							}
						}
						throw Error(`Unknown ArrayValue filter: ${i}`);
					}
					if (e instanceof U) {
						switch (i) {
							case "indent": {
								let [t, i] = this.evaluateArguments(r.args, n), a = t.at(0) ?? i.get("width") ?? new V(4);
								if (!(a instanceof V)) throw Error("width must be a number");
								let o = t.at(1) ?? i.get("first") ?? new W(!1), s = t.at(2) ?? i.get("blank") ?? new W(!1), c = e.value.split("\n"), l = " ".repeat(a.value);
								return new U(c.map((e, t) => !o.value && t === 0 || !s.value && e.length === 0 ? e : l + e).join("\n"));
							}
							case "replace": {
								let t = e.builtins.get("replace");
								if (!(t instanceof q)) throw Error("replace filter not available");
								let [i, a] = this.evaluateArguments(r.args, n);
								return t.value([...i, new me(a)], n);
							}
						}
						throw Error(`Unknown StringValue filter: ${i}`);
					}
					if (e instanceof G) {
						let t = e.builtins.get(i);
						if (t && t instanceof q) {
							let [e, i] = this.evaluateArguments(r.args, n);
							return i.size > 0 && e.push(new me(i)), t.value(e, n);
						}
						throw Error(`Unknown ObjectValue filter: ${i}`);
					}
					throw Error(`Cannot apply filter "${i}" to type: ${e.type}`);
				}
				throw Error(`Unknown filter: ${t.type}`);
			}
			evaluateFilterExpression(e, t) {
				let n = this.evaluate(e.operand, t);
				return this.applyFilter(n, e.filter, t);
			}
			evaluateTestExpression(e, t) {
				let n = this.evaluate(e.operand, t), r = t.tests.get(e.test.value);
				if (!r) throw Error(`Unknown test: ${e.test.value}`);
				let i = r(n);
				return new W(e.negate ? !i : i);
			}
			evaluateSelectExpression(e, t) {
				return this.evaluate(e.test, t).__bool__().value ? this.evaluate(e.lhs, t) : new _e();
			}
			evaluateUnaryExpression(e, t) {
				let n = this.evaluate(e.argument, t);
				switch (e.operator.value) {
					case "not": return new W(!n.value);
					default: throw SyntaxError(`Unknown operator: ${e.operator.value}`);
				}
			}
			evaluateTernaryExpression(e, t) {
				return this.evaluate(e.condition, t).__bool__().value ? this.evaluate(e.trueExpr, t) : this.evaluate(e.falseExpr, t);
			}
			evalProgram(e, t) {
				return this.evaluateBlock(e.body, t);
			}
			evaluateBlock(e, t) {
				let n = "";
				for (let r of e) {
					let e = this.evaluate(r, t);
					e.type !== "NullValue" && e.type !== "UndefinedValue" && (n += e.toString());
				}
				return new U(n);
			}
			evaluateIdentifier(e, t) {
				return t.lookupVariable(e.value);
			}
			evaluateCallExpression(e, t) {
				let [n, r] = this.evaluateArguments(e.args, t);
				r.size > 0 && n.push(new me(r));
				let i = this.evaluate(e.callee, t);
				if (i.type !== "FunctionValue") throw Error(`Cannot call something that is not a function: got ${i.type}`);
				return i.value(n, t);
			}
			evaluateSliceExpression(e, t, n) {
				if (!(e instanceof K || e instanceof U)) throw Error("Slice object must be an array or string");
				let r = this.evaluate(t.start, n), i = this.evaluate(t.stop, n), a = this.evaluate(t.step, n);
				if (!(r instanceof V || r instanceof _e)) throw Error("Slice start must be numeric or undefined");
				if (!(i instanceof V || i instanceof _e)) throw Error("Slice stop must be numeric or undefined");
				if (!(a instanceof V || a instanceof _e)) throw Error("Slice step must be numeric or undefined");
				return e instanceof K ? new K(se(e.value, r.value, i.value, a.value)) : new U(se(Array.from(e.value), r.value, i.value, a.value).join(""));
			}
			evaluateMemberExpression(e, t) {
				let n = this.evaluate(e.object, t), r;
				if (e.computed) {
					if (e.property.type === "SliceExpression") return this.evaluateSliceExpression(n, e.property, t);
					r = this.evaluate(e.property, t);
				} else r = new U(e.property.value);
				let i;
				if (n instanceof G) {
					if (!(r instanceof U)) throw Error(`Cannot access property with non-string: got ${r.type}`);
					i = n.value.get(r.value) ?? n.builtins.get(r.value);
				} else if (n instanceof K || n instanceof U) {
					if (r instanceof V) i = n.value.at(r.value), n instanceof U && (i = new U(n.value.at(r.value)));
					else if (r instanceof U) i = n.builtins.get(r.value);
					else throw Error(`Cannot access property with non-string/non-number: got ${r.type}`);
				} else {
					if (!(r instanceof U)) throw Error(`Cannot access property with non-string: got ${r.type}`);
					i = n.builtins.get(r.value);
				}
				return i instanceof B ? i : new _e();
			}
			evaluateSet(e, t) {
				let n = e.value ? this.evaluate(e.value, t) : this.evaluateBlock(e.body, t);
				if (e.assignee.type === "Identifier") {
					let r = e.assignee.value;
					t.setVariable(r, n);
				} else if (e.assignee.type === "TupleLiteral") {
					let r = e.assignee;
					if (!(n instanceof K)) throw Error(`Cannot unpack non-iterable type in set: ${n.type}`);
					let i = n.value;
					if (i.length !== r.value.length) throw Error(`Too ${r.value.length > i.length ? "few" : "many"} items to unpack in set`);
					for (let e = 0; e < r.value.length; ++e) {
						let n = r.value[e];
						if (n.type !== "Identifier") throw Error(`Cannot unpack to non-identifier in set: ${n.type}`);
						t.setVariable(n.value, i[e]);
					}
				} else if (e.assignee.type === "MemberExpression") {
					let r = e.assignee, i = this.evaluate(r.object, t);
					if (!(i instanceof G)) throw Error("Cannot assign to member of non-object");
					if (r.property.type !== "Identifier") throw Error("Cannot assign to member with non-identifier property");
					i.value.set(r.property.value, n);
				} else throw Error(`Invalid LHS inside assignment expression: ${JSON.stringify(e.assignee)}`);
				return new ge();
			}
			evaluateIf(e, t) {
				let n = this.evaluate(e.test, t);
				return this.evaluateBlock(n.__bool__().value ? e.body : e.alternate, t);
			}
			evaluateFor(e, t) {
				let n = new ve(t), r, i;
				if (e.iterable.type === "SelectExpression") {
					let t = e.iterable;
					i = this.evaluate(t.lhs, n), r = t.test;
				} else i = this.evaluate(e.iterable, n);
				if (!(i instanceof K || i instanceof G)) throw Error(`Expected iterable or object type in for loop: got ${i.type}`);
				i instanceof G && (i = i.keys());
				let a = [], o = [];
				for (let t = 0; t < i.value.length; ++t) {
					let s = new ve(n), c = i.value[t], l;
					if (e.loopvar.type === "Identifier") l = (t) => t.setVariable(e.loopvar.value, c);
					else if (e.loopvar.type === "TupleLiteral") {
						let t = e.loopvar;
						if (c.type !== "ArrayValue") throw Error(`Cannot unpack non-iterable type: ${c.type}`);
						let n = c;
						if (t.value.length !== n.value.length) throw Error(`Too ${t.value.length > n.value.length ? "few" : "many"} items to unpack`);
						l = (e) => {
							for (let r = 0; r < t.value.length; ++r) {
								if (t.value[r].type !== "Identifier") throw Error(`Cannot unpack non-identifier type: ${t.value[r].type}`);
								e.setVariable(t.value[r].value, n.value[r]);
							}
						};
					} else throw Error(`Invalid loop variable(s): ${e.loopvar.type}`);
					r && (l(s), !this.evaluate(r, s).__bool__().value) || (a.push(c), o.push(l));
				}
				let s = "", c = !0;
				for (let t = 0; t < a.length; ++t) {
					let r = /* @__PURE__ */ new Map([
						["index", new V(t + 1)],
						["index0", new V(t)],
						["revindex", new V(a.length - t)],
						["revindex0", new V(a.length - t - 1)],
						["first", new W(t === 0)],
						["last", new W(t === a.length - 1)],
						["length", new V(a.length)],
						["previtem", t > 0 ? a[t - 1] : new _e()],
						["nextitem", t < a.length - 1 ? a[t + 1] : new _e()]
					]);
					n.setVariable("loop", new G(r)), o[t](n);
					try {
						let t = this.evaluateBlock(e.body, n);
						s += t.value;
					} catch (e) {
						if (e instanceof fe) continue;
						if (e instanceof de) break;
						throw e;
					}
					c = !1;
				}
				if (c) {
					let t = this.evaluateBlock(e.defaultBlock, n);
					s += t.value;
				}
				return new U(s);
			}
			evaluateMacro(e, t) {
				return t.setVariable(e.name.value, new q((t, n) => {
					let r = new ve(n);
					t = t.slice();
					let i;
					t.at(-1)?.type === "KeywordArgumentsValue" && (i = t.pop());
					for (let n = 0; n < e.args.length; ++n) {
						let a = e.args[n], o = t[n];
						if (a.type === "Identifier") {
							let e = a;
							if (!o) throw Error(`Missing positional argument: ${e.value}`);
							r.setVariable(e.value, o);
						} else if (a.type === "KeywordArgumentExpression") {
							let e = a, t = o ?? i?.value.get(e.key.value) ?? this.evaluate(e.value, r);
							r.setVariable(e.key.value, t);
						} else throw Error(`Unknown argument type: ${a.type}`);
					}
					return this.evaluateBlock(e.body, r);
				})), new ge();
			}
			evaluateCallStatement(e, t) {
				let n = new q((t, n) => {
					let r = new ve(n);
					if (e.callerArgs) for (let n = 0; n < e.callerArgs.length; ++n) {
						let i = e.callerArgs[n];
						if (i.type !== "Identifier") throw Error(`Caller parameter must be an identifier, got ${i.type}`);
						r.setVariable(i.value, t[n] ?? new _e());
					}
					return this.evaluateBlock(e.body, r);
				}), [r, i] = this.evaluateArguments(e.call.args, t);
				r.push(new me(i));
				let a = this.evaluate(e.call.callee, t);
				if (a.type !== "FunctionValue") throw Error(`Cannot call something that is not a function: got ${a.type}`);
				let o = new ve(t);
				return o.setVariable("caller", n), a.value(r, o);
			}
			evaluateFilterStatement(e, t) {
				let n = this.evaluateBlock(e.body, t);
				return this.applyFilter(n, e.filter, t);
			}
			evaluate(e, t) {
				if (!e) return new _e();
				switch (e.type) {
					case "Program": return this.evalProgram(e, t);
					case "Set": return this.evaluateSet(e, t);
					case "If": return this.evaluateIf(e, t);
					case "For": return this.evaluateFor(e, t);
					case "Macro": return this.evaluateMacro(e, t);
					case "CallStatement": return this.evaluateCallStatement(e, t);
					case "Break": throw new de();
					case "Continue": throw new fe();
					case "IntegerLiteral": return new V(e.value);
					case "FloatLiteral": return new H(e.value);
					case "StringLiteral": return new U(e.value);
					case "ArrayLiteral": return new K(e.value.map((e) => this.evaluate(e, t)));
					case "TupleLiteral": return new he(e.value.map((e) => this.evaluate(e, t)));
					case "ObjectLiteral": {
						let n = /* @__PURE__ */ new Map();
						for (let [r, i] of e.value) {
							let e = this.evaluate(r, t);
							if (!(e instanceof U)) throw Error(`Object keys must be strings: got ${e.type}`);
							n.set(e.value, this.evaluate(i, t));
						}
						return new G(n);
					}
					case "Identifier": return this.evaluateIdentifier(e, t);
					case "CallExpression": return this.evaluateCallExpression(e, t);
					case "MemberExpression": return this.evaluateMemberExpression(e, t);
					case "UnaryExpression": return this.evaluateUnaryExpression(e, t);
					case "BinaryExpression": return this.evaluateBinaryExpression(e, t);
					case "FilterExpression": return this.evaluateFilterExpression(e, t);
					case "FilterStatement": return this.evaluateFilterStatement(e, t);
					case "TestExpression": return this.evaluateTestExpression(e, t);
					case "SelectExpression": return this.evaluateSelectExpression(e, t);
					case "Ternary": return this.evaluateTernaryExpression(e, t);
					case "Comment": return new ge();
					default: throw SyntaxError(`Unknown node type: ${e.type}`);
				}
			}
		};
		function Ce(e) {
			switch (typeof e) {
				case "number": return Number.isInteger(e) ? new V(e) : new H(e);
				case "string": return new U(e);
				case "boolean": return new W(e);
				case "undefined": return new _e();
				case "object": return e === null ? new ge() : Array.isArray(e) ? new K(e.map(Ce)) : new G(new Map(Object.entries(e).map(([e, t]) => [e, Ce(t)])));
				case "function": return new q((t, n) => Ce(e(...t.map((e) => e.value)) ?? null));
				default: throw Error(`Cannot convert to runtime value: ${e}`);
			}
		}
		var we = "\n", Te = "{%- ", Ee = " -%}";
		function De(e) {
			switch (e.operator.type) {
				case "MultiplicativeBinaryOperator": return 4;
				case "AdditiveBinaryOperator": return 3;
				case "ComparisonBinaryOperator": return 2;
				case "Identifier": return e.operator.value === "and" ? 1 : e.operator.value === "in" || e.operator.value === "not in" ? 2 : 0;
			}
			return 0;
		}
		function Oe(e, t = "	") {
			let n = typeof t == "number" ? " ".repeat(t) : t;
			return Ae(e.body, 0, n).replace(/\n$/, "");
		}
		function ke(...e) {
			return Te + e.join(" ") + Ee;
		}
		function Ae(e, t, n) {
			return e.map((e) => je(e, t, n)).join(we);
		}
		function je(e, t, n) {
			let r = n.repeat(t);
			switch (e.type) {
				case "Program": return Ae(e.body, t, n);
				case "If": return Me(e, t, n);
				case "For": return J(e, t, n);
				case "Set": return Ne(e, t, n);
				case "Macro": return Pe(e, t, n);
				case "Break": return r + ke("break");
				case "Continue": return r + ke("continue");
				case "CallStatement": return Fe(e, t, n);
				case "FilterStatement": return Ie(e, t, n);
				case "Comment": return r + "{# " + e.value + " #}";
				default: return r + "{{- " + Y(e) + " -}}";
			}
		}
		function Me(e, t, n) {
			let r = n.repeat(t), i = [], a = e;
			for (; a && (i.push({
				test: a.test,
				body: a.body
			}), a.alternate.length === 1 && a.alternate[0].type === "If");) a = a.alternate[0];
			let o = r + ke("if", Y(i[0].test)) + we + Ae(i[0].body, t + 1, n);
			for (let e = 1; e < i.length; ++e) o += we + r + ke("elif", Y(i[e].test)) + we + Ae(i[e].body, t + 1, n);
			return a && a.alternate.length > 0 && (o += we + r + ke("else") + we + Ae(a.alternate, t + 1, n)), o += we + r + ke("endif"), o;
		}
		function J(e, t, n) {
			let r = n.repeat(t), i = "";
			if (e.iterable.type === "SelectExpression") {
				let t = e.iterable;
				i = `${Y(t.lhs)} if ${Y(t.test)}`;
			} else i = Y(e.iterable);
			let a = r + ke("for", Y(e.loopvar), "in", i) + we + Ae(e.body, t + 1, n);
			return e.defaultBlock.length > 0 && (a += we + r + ke("else") + we + Ae(e.defaultBlock, t + 1, n)), a += we + r + ke("endfor"), a;
		}
		function Ne(e, t, n) {
			let r = n.repeat(t), i = Y(e.assignee), a = e.value ? Y(e.value) : "", o = r + ke("set", `${i}${e.value ? " = " + a : ""}`);
			return e.body.length === 0 ? o : o + we + Ae(e.body, t + 1, n) + we + r + ke("endset");
		}
		function Pe(e, t, n) {
			let r = n.repeat(t), i = e.args.map(Y).join(", ");
			return r + ke("macro", `${e.name.value}(${i})`) + we + Ae(e.body, t + 1, n) + we + r + ke("endmacro");
		}
		function Fe(e, t, n) {
			let r = n.repeat(t), i = e.callerArgs && e.callerArgs.length > 0 ? `(${e.callerArgs.map(Y).join(", ")})` : "", a = Y(e.call), o = r + ke(`call${i}`, a) + we;
			return o += Ae(e.body, t + 1, n) + we, o += r + ke("endcall"), o;
		}
		function Ie(e, t, n) {
			let r = n.repeat(t), i = r + ke("filter", e.filter.type === "Identifier" ? e.filter.value : Y(e.filter)) + we;
			return i += Ae(e.body, t + 1, n) + we, i += r + ke("endfilter"), i;
		}
		function Y(e, t = -1) {
			switch (e.type) {
				case "SpreadExpression": return `*${Y(e.argument)}`;
				case "Identifier": return e.value;
				case "IntegerLiteral": return `${e.value}`;
				case "FloatLiteral": return `${e.value}`;
				case "StringLiteral": return JSON.stringify(e.value);
				case "BinaryExpression": {
					let n = e, r = De(n), i = Y(n.left, r), a = Y(n.right, r + 1), o = `${i} ${n.operator.value} ${a}`;
					return r < t ? `(${o})` : o;
				}
				case "UnaryExpression": {
					let t = e;
					return t.operator.value + (t.operator.value === "not" ? " " : "") + Y(t.argument, Infinity);
				}
				case "CallExpression": {
					let t = e, n = t.args.map(Y).join(", ");
					return `${Y(t.callee)}(${n})`;
				}
				case "MemberExpression": {
					let t = e, n = Y(t.object);
					[
						"Identifier",
						"MemberExpression",
						"CallExpression",
						"StringLiteral",
						"IntegerLiteral",
						"FloatLiteral",
						"ArrayLiteral",
						"TupleLiteral",
						"ObjectLiteral"
					].includes(t.object.type) || (n = `(${n})`);
					let r = Y(t.property);
					return !t.computed && t.property.type !== "Identifier" && (r = `(${r})`), t.computed ? `${n}[${r}]` : `${n}.${r}`;
				}
				case "FilterExpression": {
					let t = e, n = Y(t.operand, Infinity);
					return t.filter.type === "CallExpression" ? `${n} | ${Y(t.filter)}` : `${n} | ${t.filter.value}`;
				}
				case "SelectExpression": {
					let t = e;
					return `${Y(t.lhs)} if ${Y(t.test)}`;
				}
				case "TestExpression": {
					let t = e;
					return `${Y(t.operand)} is${t.negate ? " not" : ""} ${t.test.value}`;
				}
				case "ArrayLiteral":
				case "TupleLiteral": {
					let t = e.value.map(Y), n = e.type === "ArrayLiteral" ? "[]" : "()";
					return `${n[0]}${t.join(", ")}${n[1]}`;
				}
				case "ObjectLiteral": return `{${Array.from(e.value.entries()).map(([e, t]) => `${Y(e)}: ${Y(t)}`).join(", ")}}`;
				case "SliceExpression": {
					let t = e;
					return `${t.start ? Y(t.start) : ""}:${t.stop ? Y(t.stop) : ""}${t.step ? `:${Y(t.step)}` : ""}`;
				}
				case "KeywordArgumentExpression": {
					let t = e;
					return `${t.key.value}=${Y(t.value)}`;
				}
				case "Ternary": {
					let n = e, r = `${Y(n.trueExpr)} if ${Y(n.condition, 0)} else ${Y(n.falseExpr)}`;
					return t > -1 ? `(${r})` : r;
				}
				default: throw Error(`Unknown expression type: ${e.type}`);
			}
		}
		var Le = class {
			parsed;
			constructor(e) {
				let t = d(e, {
					lstrip_blocks: !0,
					trim_blocks: !0
				});
				this.parsed = ae(t);
			}
			render(e) {
				let t = new ve();
				if (ye(t), e) for (let [n, r] of Object.entries(e)) t.set(n, r);
				return new Se(t).run(this.parsed).value;
			}
			format(e) {
				return Oe(this.parsed, e?.indent || "	");
			}
		};
	}),
	"./src/backends/onnx.js": ((e, t, n) => {
		var r;
		n.r(t), n.d(t, {
			Tensor: () => s.Tensor,
			createInferenceSession: () => g,
			deviceToExecutionProviders: () => m,
			isONNXProxy: () => S,
			isONNXTensor: () => b,
			runInferenceSession: () => y
		});
		var i = n("./src/env.js"), a = n("onnxruntime-node"), o = n("?8b6b"), s = n("onnxruntime-common");
		let c = Object.freeze({
			auto: null,
			gpu: null,
			cpu: "cpu",
			wasm: "wasm",
			webgpu: "webgpu",
			cuda: "cuda",
			dml: "dml",
			webnn: {
				name: "webnn",
				deviceType: "cpu"
			},
			"webnn-npu": {
				name: "webnn",
				deviceType: "npu"
			},
			"webnn-gpu": {
				name: "webnn",
				deviceType: "gpu"
			},
			"webnn-cpu": {
				name: "webnn",
				deviceType: "cpu"
			}
		}), l = [], u, d, f = Symbol.for("onnxruntime");
		if (f in globalThis) d = globalThis[f];
		else if (i.apis.IS_NODE_ENV) {
			switch (d = a.default ?? a, process.platform) {
				case "win32":
					l.push("dml");
					break;
				case "linux": process.arch === "x64" && l.push("cuda");
			}
			l.push("cpu"), u = ["cpu"];
		} else d = r ||= n.t(o, 2), i.apis.IS_WEBNN_AVAILABLE && l.push("webnn-npu", "webnn-gpu", "webnn-cpu", "webnn"), i.apis.IS_WEBGPU_AVAILABLE && l.push("webgpu"), l.push("wasm"), u = ["wasm"];
		let p = d.InferenceSession;
		function m(e = null) {
			if (!e) return u;
			switch (e) {
				case "auto": return l;
				case "gpu": return l.filter((e) => [
					"webgpu",
					"cuda",
					"dml",
					"webnn-gpu"
				].includes(e));
			}
			if (l.includes(e)) return [c[e] ?? e];
			throw Error(`Unsupported device: "${e}". Should be one of: ${l.join(", ")}.`);
		}
		let h = null;
		async function g(e, t, n) {
			h && await h;
			let r = p.create(e, t);
			h ??= r;
			let i = await r;
			return i.config = n, i;
		}
		let _ = Promise.resolve(), v = i.apis.IS_BROWSER_ENV || i.apis.IS_WEBWORKER_ENV;
		async function y(e, t) {
			let n = () => e.run(t);
			return await (v ? _ = _.then(n) : n());
		}
		function b(e) {
			return e instanceof d.Tensor;
		}
		let x = d?.env;
		x?.wasm && (!(typeof ServiceWorkerGlobalScope < "u" && self instanceof ServiceWorkerGlobalScope) && !x.wasm.wasmPaths && (x.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${i.env.version}/dist/`), x.wasm.proxy = !1), x?.webgpu && (x.webgpu.powerPreference = "high-performance");
		function S() {
			return x?.wasm?.proxy;
		}
		i.env.backends.onnx = x;
	}),
	"./src/base/feature_extraction_utils.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			FeatureExtractor: () => o,
			validate_audio_inputs: () => s
		});
		var r = n("./src/utils/constants.js"), i = n("./src/utils/generic.js"), a = n("./src/utils/hub.js");
		class o extends i.Callable {
			constructor(e) {
				super(), this.config = e;
			}
			static async from_pretrained(e, t = {}) {
				let n = await (0, a.getModelJSON)(e, r.FEATURE_EXTRACTOR_NAME, !0, t);
				return new this(n);
			}
		}
		function s(e, t) {
			if (!(e instanceof Float32Array || e instanceof Float64Array)) throw Error(`${t} expects input to be a Float32Array or a Float64Array, but got ${e?.constructor?.name ?? typeof e} instead. If using the feature extractor directly, remember to use \`read_audio(url, sampling_rate)\` to obtain the raw audio data of the file/url.`);
		}
	}),
	"./src/base/image_processors_utils.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			ImageProcessor: () => b,
			center_to_corners_format: () => d,
			post_process_instance_segmentation: () => y,
			post_process_object_detection: () => f,
			post_process_panoptic_segmentation: () => v,
			post_process_semantic_segmentation: () => p
		});
		var r = n("./src/utils/generic.js"), i = n("./src/utils/tensor.js"), a = n("./src/utils/maths.js");
		n("./src/utils/image.js");
		var o = n("./src/utils/core.js"), s = n("./src/utils/hub.js"), c = n("./src/utils/constants.js");
		function l(e, t, n = 0, r = null) {
			let i = e / t, o = (0, a.bankers_round)(i) * t;
			return r !== null && o > r && (o = Math.floor(i) * t), o < n && (o = Math.ceil(i) * t), o;
		}
		function u([e, t], n) {
			return [Math.max(Math.floor(e / n), 1) * n, Math.max(Math.floor(t / n), 1) * n];
		}
		function d([e, t, n, r]) {
			return [
				e - n / 2,
				t - r / 2,
				e + n / 2,
				t + r / 2
			];
		}
		function f(e, t = .5, n = null, r = !1) {
			let i = e.logits, o = e.pred_boxes, [s, c, l] = i.dims;
			if (n !== null && n.length !== s) throw Error("Make sure that you pass in as many target sizes as the batch dimension of the logits");
			let u = [];
			for (let e = 0; e < s; ++e) {
				let s = n === null ? null : n[e], f = {
					boxes: [],
					classes: [],
					scores: []
				}, p = i[e], m = o[e];
				for (let e = 0; e < c; ++e) {
					let n = p[e], i = [], o;
					if (r) {
						o = n.sigmoid().data;
						for (let e = 0; e < o.length; ++e) o[e] > t && i.push(e);
					} else {
						let e = (0, a.max)(n.data)[1];
						if (e === l - 1 || (o = (0, a.softmax)(n.data), o[e] < t)) continue;
						i.push(e);
					}
					for (let t of i) {
						let n = m[e].data;
						n = d(n), s !== null && (n = n.map((e, t) => e * s[(t + 1) % 2])), f.boxes.push(n), f.classes.push(t), f.scores.push(o[t]);
					}
				}
				u.push(f);
			}
			return u;
		}
		function p(e, t = null) {
			let n = e.logits, r = n.dims[0];
			if (t !== null && t.length !== r) throw Error("Make sure that you pass in as many target sizes as the batch dimension of the logits");
			let a = [];
			for (let e = 0; e < r; ++e) {
				let r = t === null ? null : t[e], o = n[e];
				r !== null && (o = (0, i.interpolate)(o, r, "bilinear", !1));
				let [s, c] = r ?? o.dims.slice(-2), l = new i.Tensor("int32", new Int32Array(s * c), [s, c]), u = o[0].data, d = l.data;
				for (let e = 1; e < o.dims[0]; ++e) {
					let t = o[e].data;
					for (let n = 0; n < t.length; ++n) t[n] > u[n] && (u[n] = t[n], d[n] = e);
				}
				let f = Array(o.dims[0]);
				for (let e = 0; e < d.length; ++e) {
					let t = d[e];
					f[t] = t;
				}
				let p = f.filter((e) => e !== void 0);
				a.push({
					segmentation: l,
					labels: p
				});
			}
			return a;
		}
		function m(e, t, n, r) {
			let i = [], o = [], s = [];
			for (let c = 0; c < e.dims[0]; ++c) {
				let l = e[c], u = t[c], d = (0, a.max)(l.data)[1];
				if (d === r) continue;
				let f = (0, a.softmax)(l.data)[d];
				f > n && (i.push(u), o.push(f), s.push(d));
			}
			return [
				i,
				o,
				s
			];
		}
		function h(e, t, n, r = .5, i = .8) {
			let a = [], o = 0, s = 0, c = t[n].data;
			for (let t = 0; t < e.length; ++t) e[t] === n && (a.push(t), ++o), c[t] >= r && ++s;
			let l = o > 0 && s > 0;
			return l &&= o / s > i, [l, a];
		}
		function g(e, t, n, r, a, o = null, s = null) {
			let [c, l] = s ?? e[0].dims, u = new i.Tensor("int32", new Int32Array(c * l), [c, l]), d = [];
			if (s !== null) for (let t = 0; t < e.length; ++t) e[t] = (0, i.interpolate)(e[t], s, "bilinear", !1);
			let f = new Int32Array(e[0].data.length), p = new Float32Array(e[0].data.length);
			for (let n = 0; n < e.length; ++n) {
				let r = t[n], i = e[n].data;
				for (let e = 0; e < i.length; ++e) i[e] *= r, i[e] > p[e] && (f[e] = n, p[e] = i[e]);
			}
			let m = 0, g = u.data;
			for (let i = 0; i < n.length; ++i) {
				let o = n[i], [s, c] = h(f, e, i, r, a);
				if (s) {
					++m;
					for (let e of c) g[e] = m;
					d.push({
						id: m,
						label_id: o,
						score: t[i]
					});
				}
			}
			return [u, d];
		}
		function _(e, t, n = 28, r = 3136, i = 1003520) {
			if (e < n || t < n) throw Error(`height:${e} or width:${t} must be larger than factor:${n}`);
			if (Math.max(e, t) / Math.min(e, t) > 200) throw Error(`absolute aspect ratio must be smaller than 200, got ${Math.max(e, t) / Math.min(e, t)}`);
			let a = Math.round(e / n) * n, o = Math.round(t / n) * n;
			if (a * o > i) {
				let r = Math.sqrt(e * t / i);
				a = Math.floor(e / r / n) * n, o = Math.floor(t / r / n) * n;
			} else if (a * o < r) {
				let i = Math.sqrt(r / (e * t));
				a = Math.ceil(e * i / n) * n, o = Math.ceil(t * i / n) * n;
			}
			return [a, o];
		}
		function v(e, t = .5, n = .5, r = .8, a = null, o = null) {
			a === null && (console.warn("`label_ids_to_fuse` unset. No instance will be fused."), a = /* @__PURE__ */ new Set());
			let s = e.class_queries_logits ?? e.logits, c = (e.masks_queries_logits ?? e.pred_masks).sigmoid(), [l, u, d] = s.dims;
			if (--d, o !== null && o.length !== l) throw Error("Make sure that you pass in as many target sizes as the batch dimension of the logits");
			let f = [];
			for (let e = 0; e < l; ++e) {
				let l = o === null ? null : o[e], u = s[e], p = c[e], [h, _, v] = m(u, p, t, d);
				if (v.length === 0) {
					let [e, t] = l ?? p.dims.slice(-2), n = new i.Tensor("int32", new Int32Array(e * t).fill(-1), [e, t]);
					f.push({
						segmentation: n,
						segments_info: []
					});
					continue;
				}
				let [y, b] = g(h, _, v, n, r, a, l);
				f.push({
					segmentation: y,
					segments_info: b
				});
			}
			return f;
		}
		function y(e, t = .5, n = null) {
			throw Error("`post_process_instance_segmentation` is not yet implemented.");
		}
		class b extends r.Callable {
			constructor(e) {
				super(), this.image_mean = e.image_mean ?? e.mean, this.image_std = e.image_std ?? e.std, this.resample = e.resample ?? 2, this.do_rescale = e.do_rescale ?? !0, this.rescale_factor = e.rescale_factor ?? 1 / 255, this.do_normalize = e.do_normalize, this.do_thumbnail = e.do_thumbnail, this.size = e.size ?? e.image_size, this.do_resize = e.do_resize ?? this.size !== void 0, this.size_divisibility = e.size_divisibility ?? e.size_divisor, this.do_center_crop = e.do_center_crop, this.crop_size = e.crop_size, this.do_convert_rgb = e.do_convert_rgb ?? !0, this.do_crop_margin = e.do_crop_margin, this.pad_size = e.pad_size, this.do_pad = e.do_pad, this.min_pixels = e.min_pixels, this.max_pixels = e.max_pixels, this.do_pad && !this.pad_size && this.size && this.size.width !== void 0 && this.size.height !== void 0 && (this.pad_size = this.size), this.do_flip_channel_order = e.do_flip_channel_order ?? !1, this.config = e;
			}
			async thumbnail(e, t, n = 2) {
				let r = e.height, i = e.width, a = t.height, o = t.width, s = Math.min(r, a), c = Math.min(i, o);
				return s === r && c === i ? e : (r > i ? c = Math.floor(i * s / r) : i > r && (s = Math.floor(r * c / i)), await e.resize(c, s, { resample: n }));
			}
			async crop_margin(e, t = 200) {
				let n = e.clone().grayscale(), r = (0, a.min)(n.data)[0], i = (0, a.max)(n.data)[0] - r;
				if (i === 0) return e;
				let o = t / 255, s = n.width, c = n.height, l = 0, u = 0, d = n.data;
				for (let e = 0; e < n.height; ++e) {
					let t = e * n.width;
					for (let a = 0; a < n.width; ++a) (d[t + a] - r) / i < o && (s = Math.min(s, a), c = Math.min(c, e), l = Math.max(l, a), u = Math.max(u, e));
				}
				return e = await e.crop([
					s,
					c,
					l,
					u
				]), e;
			}
			pad_image(e, t, n, { mode: r = "constant", center: i = !1, constant_values: a = 0 } = {}) {
				let [s, c, l] = t, u, d;
				if (typeof n == "number" ? (u = n, d = n) : n === "square" ? u = d = Math.max(s, c) : (u = n.width, d = n.height), u !== c || d !== s) {
					let n = new Float32Array(u * d * l);
					if (Array.isArray(a)) for (let e = 0; e < n.length; ++e) n[e] = a[e % l];
					else a !== 0 && n.fill(a);
					let [f, p] = i ? [Math.floor((u - c) / 2), Math.floor((d - s) / 2)] : [0, 0];
					for (let t = 0; t < s; ++t) {
						let r = (t + p) * u, i = t * c;
						for (let t = 0; t < c; ++t) {
							let a = (r + t + f) * l, o = (i + t) * l;
							for (let t = 0; t < l; ++t) n[a + t] = e[o + t];
						}
					}
					if (r === "symmetric") {
						if (i) throw Error("`center` padding is not supported when `mode` is set to `symmetric`.");
						let t = s - 1, r = c - 1;
						for (let i = 0; i < d; ++i) {
							let a = i * u, d = (0, o.calculateReflectOffset)(i, t) * c;
							for (let t = 0; t < u; ++t) {
								if (i < s && t < c) continue;
								let u = (a + t) * l, f = (d + (0, o.calculateReflectOffset)(t, r)) * l;
								for (let t = 0; t < l; ++t) n[u + t] = e[f + t];
							}
						}
					}
					e = n, t = [
						d,
						u,
						l
					];
				}
				return [e, t];
			}
			rescale(e) {
				for (let t = 0; t < e.length; ++t) e[t] = this.rescale_factor * e[t];
			}
			get_resize_output_image_size(e, t) {
				let [n, r] = e.size, i, a;
				if (this.do_thumbnail) {
					let { height: e, width: n } = t;
					i = Math.min(e, n);
				} else Number.isInteger(t) ? (i = t, a = this.config.max_size ?? i) : t !== void 0 && (i = t.shortest_edge, a = t.longest_edge);
				if (i !== void 0 || a !== void 0) {
					let e = i === void 0 ? 1 : Math.max(i / n, i / r), t = n * e, o = r * e, s = a === void 0 ? 1 : Math.min(a / t, a / o), c = Math.floor(Number((t * s).toFixed(2))), l = Math.floor(Number((o * s).toFixed(2)));
					return this.size_divisibility !== void 0 && ([c, l] = u([c, l], this.size_divisibility)), [c, l];
				}
				if (t !== void 0 && t.width !== void 0 && t.height !== void 0) {
					let e = t.width, i = t.height;
					if (this.config.keep_aspect_ratio && this.config.ensure_multiple_of) {
						let t = i / r, a = e / n;
						Math.abs(1 - a) < Math.abs(1 - t) ? t = a : a = t, i = l(t * r, this.config.ensure_multiple_of), e = l(a * n, this.config.ensure_multiple_of);
					}
					return [e, i];
				}
				if (this.size_divisibility !== void 0) return u([n, r], this.size_divisibility);
				if (this.min_pixels !== void 0 && this.max_pixels !== void 0) return _(r, n, this.config.patch_size * this.config.merge_size, this.min_pixels, this.max_pixels);
				throw Error(`Could not resize image due to unsupported \`this.size\` option in config: ${JSON.stringify(t)}`);
			}
			async resize(e) {
				let [t, n] = this.get_resize_output_image_size(e, this.size);
				return await e.resize(t, n, { resample: this.resample });
			}
			async preprocess(e, { do_normalize: t = null, do_pad: n = null, do_convert_rgb: r = null, do_convert_grayscale: a = null, do_flip_channel_order: o = null } = {}) {
				this.do_crop_margin && (e = await this.crop_margin(e));
				let [s, c] = e.size;
				if (r ?? this.do_convert_rgb ? e = e.rgb() : a && (e = e.grayscale()), this.do_resize && (e = await this.resize(e)), this.do_thumbnail && (e = await this.thumbnail(e, this.size, this.resample)), this.do_center_crop) {
					let t, n;
					Number.isInteger(this.crop_size) ? (t = this.crop_size, n = this.crop_size) : (t = this.crop_size.width, n = this.crop_size.height), e = await e.center_crop(t, n);
				}
				let l = [e.height, e.width], d = Float32Array.from(e.data), f = [
					e.height,
					e.width,
					e.channels
				];
				if (this.do_rescale && this.rescale(d), t ?? this.do_normalize) {
					let t = this.image_mean;
					Array.isArray(this.image_mean) || (t = Array(e.channels).fill(t));
					let n = this.image_std;
					if (Array.isArray(this.image_std) || (n = Array(e.channels).fill(n)), t.length !== e.channels || n.length !== e.channels) throw Error(`When set to arrays, the length of \`image_mean\` (${t.length}) and \`image_std\` (${n.length}) must match the number of channels in the image (${e.channels}).`);
					for (let r = 0; r < d.length; r += e.channels) for (let i = 0; i < e.channels; ++i) d[r + i] = (d[r + i] - t[i]) / n[i];
				}
				if (n ?? this.do_pad) {
					if (this.pad_size) {
						let t = this.pad_image(d, [
							e.height,
							e.width,
							e.channels
						], this.pad_size);
						[d, f] = t;
					} else if (this.size_divisibility) {
						let [e, t] = u([f[1], f[0]], this.size_divisibility);
						[d, f] = this.pad_image(d, f, {
							width: e,
							height: t
						});
					}
				}
				if (o ?? this.do_flip_channel_order) {
					if (f[2] !== 3) throw Error("Flipping channel order is only supported for RGB images.");
					for (let e = 0; e < d.length; e += 3) {
						let t = d[e];
						d[e] = d[e + 2], d[e + 2] = t;
					}
				}
				let p = new i.Tensor("float32", d, f).permute(2, 0, 1);
				return {
					original_size: [c, s],
					reshaped_input_size: l,
					pixel_values: p
				};
			}
			async _call(e, ...t) {
				Array.isArray(e) || (e = [e]);
				let n = await Promise.all(e.map((e) => this.preprocess(e)));
				return {
					pixel_values: (0, i.stack)(n.map((e) => e.pixel_values), 0),
					original_sizes: n.map((e) => e.original_size),
					reshaped_input_sizes: n.map((e) => e.reshaped_input_size)
				};
			}
			static async from_pretrained(e, t = {}) {
				let n = await (0, s.getModelJSON)(e, c.IMAGE_PROCESSOR_NAME, !0, t);
				return new this(n);
			}
		}
	}),
	"./src/base/processing_utils.js": ((e, t, n) => {
		n.r(t), n.d(t, { Processor: () => o });
		var r = n("./src/utils/constants.js"), i = n("./src/utils/generic.js"), a = n("./src/utils/hub.js");
		class o extends i.Callable {
			static classes = [
				"image_processor_class",
				"tokenizer_class",
				"feature_extractor_class"
			];
			static uses_processor_config = !1;
			static uses_chat_template_file = !1;
			constructor(e, t, n) {
				super(), this.config = e, this.components = t, this.chat_template = n;
			}
			get image_processor() {
				return this.components.image_processor;
			}
			get tokenizer() {
				return this.components.tokenizer;
			}
			get feature_extractor() {
				return this.components.feature_extractor;
			}
			apply_chat_template(e, t = {}) {
				if (!this.tokenizer) throw Error("Unable to apply chat template without a tokenizer.");
				return this.tokenizer.apply_chat_template(e, {
					tokenize: !1,
					chat_template: this.chat_template ?? void 0,
					...t
				});
			}
			batch_decode(...e) {
				if (!this.tokenizer) throw Error("Unable to decode without a tokenizer.");
				return this.tokenizer.batch_decode(...e);
			}
			decode(...e) {
				if (!this.tokenizer) throw Error("Unable to decode without a tokenizer.");
				return this.tokenizer.decode(...e);
			}
			async _call(e, ...t) {
				for (let n of [
					this.image_processor,
					this.feature_extractor,
					this.tokenizer
				]) if (n) return n(e, ...t);
				throw Error("No image processor, feature extractor, or tokenizer found.");
			}
			static async from_pretrained(e, t = {}) {
				let [n, i, o] = await Promise.all([
					this.uses_processor_config ? (0, a.getModelJSON)(e, r.PROCESSOR_NAME, !0, t) : {},
					Promise.all(this.classes.filter((e) => e in this).map(async (n) => {
						let r = await this[n].from_pretrained(e, t);
						return [n.replace(/_class$/, ""), r];
					})).then(Object.fromEntries),
					this.uses_chat_template_file ? (0, a.getModelText)(e, r.CHAT_TEMPLATE_NAME, !0, t) : null
				]);
				return new this(n, i, o);
			}
		}
	}),
	"./src/configs.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			AutoConfig: () => u,
			PretrainedConfig: () => l,
			getCacheShapes: () => s
		});
		var r = n("./src/utils/core.js"), i = n("./src/utils/hub.js");
		async function a(e, t) {
			return await (0, i.getModelJSON)(e, "config.json", !0, t);
		}
		function o(e) {
			let t = {}, n = {};
			switch (e.model_type) {
				case "llava":
				case "paligemma":
				case "gemma3":
				case "florence2":
				case "llava_onevision":
				case "idefics3":
				case "ultravox":
				case "voxtral":
				case "smolvlm":
				case "gemma3n":
				case "mistral3":
					n = o(e.text_config);
					break;
				case "moondream1":
					n = o(e.phi_config);
					break;
				case "musicgen":
					n = o(e.decoder);
					break;
				case "multi_modality":
					n = o(e.language_config);
					break;
				case "gpt2":
				case "gptj":
				case "jais":
				case "codegen":
				case "gpt_bigcode":
					t.num_heads = "n_head", t.num_layers = "n_layer", t.hidden_size = "n_embd";
					break;
				case "gpt_neox":
				case "stablelm":
				case "opt":
				case "falcon":
				case "modernbert-decoder":
					t.num_heads = "num_attention_heads", t.num_layers = "num_hidden_layers", t.hidden_size = "hidden_size";
					break;
				case "llama":
				case "llama4_text":
				case "nanochat":
				case "arcee":
				case "lfm2":
				case "smollm3":
				case "olmo":
				case "olmo2":
				case "mobilellm":
				case "granite":
				case "granitemoehybrid":
				case "cohere":
				case "mistral":
				case "starcoder2":
				case "qwen2":
				case "qwen2_vl":
				case "phi":
				case "phi3":
				case "phi3_v":
				case "llava_qwen2":
					t.num_heads = "num_key_value_heads", t.num_layers = "num_hidden_layers", t.hidden_size = "hidden_size", t.num_attention_heads = "num_attention_heads", t.dim_kv = "head_dim";
					break;
				case "qwen3":
				case "gemma":
				case "gemma2":
				case "vaultgemma":
				case "gemma3_text":
				case "gemma3n_text":
				case "glm":
				case "helium":
				case "ernie4_5":
				case "ministral":
				case "ministral3":
					t.num_heads = "num_key_value_heads", t.num_layers = "num_hidden_layers", t.dim_kv = "head_dim";
					break;
				case "openelm":
					t.num_heads = "num_kv_heads", t.num_layers = "num_transformer_layers", t.dim_kv = "head_dim";
					break;
				case "gpt_neo":
				case "donut-swin":
					t.num_heads = "num_heads", t.num_layers = "num_layers", t.hidden_size = "hidden_size";
					break;
				case "bloom":
					t.num_heads = "n_head", t.num_layers = "n_layer", t.hidden_size = "hidden_size";
					break;
				case "mpt":
					t.num_heads = "n_heads", t.num_layers = "n_layers", t.hidden_size = "d_model";
					break;
				case "exaone":
					t.num_heads = "num_key_value_heads", t.num_layers = "num_layers", t.dim_kv = "head_dim", t.num_attention_heads = "num_attention_heads";
					break;
				case "t5":
				case "mt5":
				case "longt5":
					t.num_decoder_layers = "num_decoder_layers", t.num_decoder_heads = "num_heads", t.decoder_dim_kv = "d_kv", t.num_encoder_layers = "num_layers", t.num_encoder_heads = "num_heads", t.encoder_dim_kv = "d_kv";
					break;
				case "bart":
				case "mbart":
				case "marian":
				case "whisper":
				case "lite-whisper":
				case "m2m_100":
				case "blenderbot":
				case "blenderbot-small":
				case "florence2_language":
					t.num_decoder_layers = "decoder_layers", t.num_decoder_heads = "decoder_attention_heads", t.decoder_hidden_size = "d_model", t.num_encoder_layers = "encoder_layers", t.num_encoder_heads = "encoder_attention_heads", t.encoder_hidden_size = "d_model";
					break;
				case "speecht5":
					t.num_decoder_layers = "decoder_layers", t.num_decoder_heads = "decoder_attention_heads", t.decoder_hidden_size = "hidden_size", t.num_encoder_layers = "encoder_layers", t.num_encoder_heads = "encoder_attention_heads", t.encoder_hidden_size = "hidden_size";
					break;
				case "trocr":
					t.num_encoder_layers = t.num_decoder_layers = "decoder_layers", t.num_encoder_heads = t.num_decoder_heads = "decoder_attention_heads", t.encoder_hidden_size = t.decoder_hidden_size = "d_model";
					break;
				case "musicgen_decoder":
					t.num_encoder_layers = t.num_decoder_layers = "num_hidden_layers", t.num_encoder_heads = t.num_decoder_heads = "num_attention_heads", t.encoder_hidden_size = t.decoder_hidden_size = "hidden_size";
					break;
				case "moonshine":
					t.num_decoder_layers = "decoder_num_hidden_layers", t.num_decoder_heads = "decoder_num_key_value_heads", t.num_encoder_layers = "encoder_num_hidden_layers", t.num_encoder_heads = "encoder_num_key_value_heads", t.encoder_hidden_size = t.decoder_hidden_size = "hidden_size";
					break;
				case "vision-encoder-decoder":
					let i = o(e.decoder), a = "num_decoder_layers" in i, s = (0, r.pick)(e, ["model_type", "is_encoder_decoder"]);
					return a ? (s.num_decoder_layers = i.num_decoder_layers, s.num_decoder_heads = i.num_decoder_heads, s.decoder_hidden_size = i.decoder_hidden_size, s.num_encoder_layers = i.num_encoder_layers, s.num_encoder_heads = i.num_encoder_heads, s.encoder_hidden_size = i.encoder_hidden_size) : (s.num_layers = i.num_layers, s.num_heads = i.num_heads, s.hidden_size = i.hidden_size), s;
			}
			let i = {
				...n,
				...(0, r.pick)(e, [
					"model_type",
					"multi_query",
					"is_encoder_decoder"
				])
			};
			for (let n in t) i[n] = e[t[n]];
			return i;
		}
		function s(e, t) {
			if (e.model_type === "lfm2") {
				let n = t?.prefix ?? "past_key_values", r = n === "present" ? "present" : "past", i = {}, { layer_types: a, num_attention_heads: o, num_key_value_heads: s, hidden_size: c, conv_L_cache: l } = e, u = c / o, d = t?.batch_size ?? 1;
				for (let e = 0; e < a.length; ++e) if (a[e] === "full_attention") for (let t of ["key", "value"]) i[`${n}.${e}.${t}`] = [
					d,
					s,
					0,
					u
				];
				else if (a[e] === "conv") i[`${r}_conv.${e}`] = [
					d,
					c,
					l
				];
				else throw Error(`Unsupported layer type: ${a[e]}`);
				return i;
			}
			return c(e, t);
		}
		function c(e, { prefix: t = "past_key_values", batch_size: n = 1 } = {}) {
			let r = {}, i = e.normalized_config;
			if (i.is_encoder_decoder && "num_encoder_heads" in i && "num_decoder_heads" in i) {
				let e = i.encoder_dim_kv ?? i.encoder_hidden_size / i.num_encoder_heads, a = i.decoder_dim_kv ?? i.decoder_hidden_size / i.num_decoder_heads, o = [
					n,
					i.num_encoder_heads,
					0,
					e
				], s = [
					n,
					i.num_decoder_heads,
					0,
					a
				];
				for (let e = 0; e < i.num_decoder_layers; ++e) r[`${t}.${e}.encoder.key`] = o, r[`${t}.${e}.encoder.value`] = o, r[`${t}.${e}.decoder.key`] = s, r[`${t}.${e}.decoder.value`] = s;
			} else {
				let e = i.num_heads, a = i.num_layers, o = i.dim_kv ?? i.hidden_size / (i.num_attention_heads ?? e);
				if (i.model_type === "falcon") {
					let i = [
						n * e,
						0,
						o
					];
					for (let e = 0; e < a; ++e) r[`${t}.${e}.key`] = i, r[`${t}.${e}.value`] = i;
				} else if (i.multi_query) {
					let i = [
						n * e,
						0,
						2 * o
					];
					for (let e = 0; e < a; ++e) r[`${t}.${e}.key_value`] = i;
				} else if (i.model_type === "bloom") {
					let i = [
						n * e,
						o,
						0
					], s = [
						n * e,
						0,
						o
					];
					for (let e = 0; e < a; ++e) r[`${t}.${e}.key`] = i, r[`${t}.${e}.value`] = s;
				} else if (i.model_type === "openelm") for (let i = 0; i < a; ++i) {
					let a = [
						n,
						e[i],
						0,
						o
					];
					r[`${t}.${i}.key`] = a, r[`${t}.${i}.value`] = a;
				}
				else {
					let i = [
						n,
						e,
						0,
						o
					];
					for (let e = 0; e < a; ++e) r[`${t}.${e}.key`] = i, r[`${t}.${e}.value`] = i;
				}
			}
			return r;
		}
		class l {
			model_type = null;
			is_encoder_decoder = !1;
			max_position_embeddings;
			"transformers.js_config";
			constructor(e) {
				Object.assign(this, e), this.normalized_config = o(this);
			}
			static async from_pretrained(e, { progress_callback: t = null, config: n = null, cache_dir: r = null, local_files_only: i = !1, revision: o = "main" } = {}) {
				n && !(n instanceof l) && (n = new l(n));
				let s = n ?? await a(e, {
					progress_callback: t,
					config: n,
					cache_dir: r,
					local_files_only: i,
					revision: o
				});
				return new this(s);
			}
		}
		class u {
			static async from_pretrained(...e) {
				return l.from_pretrained(...e);
			}
		}
	}),
	"./src/env.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			apis: () => g,
			env: () => S
		});
		var r = n("node:fs"), i = n("node:path"), a = n("node:url");
		let o = typeof window < "u" && window.document !== void 0, s = typeof self < "u" && [
			"DedicatedWorkerGlobalScope",
			"ServiceWorkerGlobalScope",
			"SharedWorkerGlobalScope"
		].includes(self.constructor?.name), c = typeof self < "u" && "caches" in self, l = typeof navigator < "u" && "gpu" in navigator, u = typeof navigator < "u" && "ml" in navigator, d = typeof process < "u", f = d && process?.release?.name === "node", p = !C(r.default), m = !C(i.default), h = globalThis.Deno !== void 0;
		globalThis.Bun;
		let g = Object.freeze({
			IS_BROWSER_ENV: o,
			IS_WEBWORKER_ENV: s,
			IS_WEB_CACHE_AVAILABLE: c,
			IS_WEBGPU_AVAILABLE: l,
			IS_WEBNN_AVAILABLE: u,
			IS_PROCESS_AVAILABLE: d,
			IS_NODE_ENV: f,
			IS_FS_AVAILABLE: p,
			IS_PATH_AVAILABLE: m
		}), _ = p && m, v = "./";
		if (_) {
			let e = Object(import.meta).url;
			e ? v = i.default.dirname(i.default.dirname(a.default.fileURLToPath(e))) : typeof __dirname < "u" && (v = i.default.dirname(__dirname));
		}
		let y = _ ? i.default.join(v, "/.cache/") : null, b = "/models/", x = _ ? i.default.join(v, b) : b, S = {
			version: "3.8.1",
			backends: { onnx: {} },
			allowRemoteModels: !0,
			remoteHost: "https://huggingface.co/",
			remotePathTemplate: "{model}/resolve/{revision}/",
			allowLocalModels: !(o || s),
			localModelPath: x,
			useFS: p,
			useBrowserCache: c && !h,
			useFSCache: p,
			cacheDir: y,
			useCustomCache: !1,
			customCache: null
		};
		function C(e) {
			return Object.keys(e).length === 0;
		}
	}),
	"./src/generation/configuration_utils.js": ((e, t, n) => {
		n.r(t), n.d(t, { GenerationConfig: () => i });
		var r = n("./src/utils/core.js");
		class i {
			max_length = 20;
			max_new_tokens = null;
			min_length = 0;
			min_new_tokens = null;
			early_stopping = !1;
			max_time = null;
			do_sample = !1;
			num_beams = 1;
			num_beam_groups = 1;
			penalty_alpha = null;
			use_cache = !0;
			temperature = 1;
			top_k = 50;
			top_p = 1;
			typical_p = 1;
			epsilon_cutoff = 0;
			eta_cutoff = 0;
			diversity_penalty = 0;
			repetition_penalty = 1;
			encoder_repetition_penalty = 1;
			length_penalty = 1;
			no_repeat_ngram_size = 0;
			bad_words_ids = null;
			force_words_ids = null;
			renormalize_logits = !1;
			constraints = null;
			forced_bos_token_id = null;
			forced_eos_token_id = null;
			remove_invalid_values = !1;
			exponential_decay_length_penalty = null;
			suppress_tokens = null;
			streamer = null;
			begin_suppress_tokens = null;
			forced_decoder_ids = null;
			guidance_scale = null;
			num_return_sequences = 1;
			output_attentions = !1;
			output_hidden_states = !1;
			output_scores = !1;
			return_dict_in_generate = !1;
			pad_token_id = null;
			bos_token_id = null;
			eos_token_id = null;
			encoder_no_repeat_ngram_size = 0;
			decoder_start_token_id = null;
			generation_kwargs = {};
			constructor(e) {
				Object.assign(this, (0, r.pick)(e, Object.getOwnPropertyNames(this)));
			}
		}
	}),
	"./src/generation/logits_process.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			ClassifierFreeGuidanceLogitsProcessor: () => _,
			ForcedBOSTokenLogitsProcessor: () => c,
			ForcedEOSTokenLogitsProcessor: () => l,
			LogitsProcessor: () => a,
			LogitsProcessorList: () => s,
			LogitsWarper: () => o,
			MinLengthLogitsProcessor: () => m,
			MinNewTokensLengthLogitsProcessor: () => h,
			NoBadWordsLogitsProcessor: () => g,
			NoRepeatNGramLogitsProcessor: () => f,
			RepetitionPenaltyLogitsProcessor: () => p,
			SuppressTokensAtBeginLogitsProcessor: () => u,
			TemperatureLogitsWarper: () => v,
			TopKLogitsWarper: () => b,
			TopPLogitsWarper: () => y,
			WhisperTimeStampLogitsProcessor: () => d
		});
		var r = n("./src/utils/generic.js");
		n("./src/utils/tensor.js");
		var i = n("./src/utils/maths.js");
		class a extends r.Callable {
			_call(e, t) {
				throw Error("`_call` should be implemented in a subclass");
			}
		}
		class o extends r.Callable {
			_call(e, t) {
				throw Error("`_call` should be implemented in a subclass");
			}
		}
		class s extends r.Callable {
			constructor() {
				super(), this.processors = [];
			}
			push(e) {
				this.processors.push(e);
			}
			extend(e) {
				this.processors.push(...e);
			}
			_call(e, t) {
				let n = t;
				for (let t of this.processors) n = t(e, n);
				return n;
			}
			[Symbol.iterator]() {
				return this.processors.values();
			}
		}
		class c extends a {
			constructor(e) {
				super(), this.bos_token_id = e;
			}
			_call(e, t) {
				for (let n = 0; n < e.length; ++n) if (e[n].length === 1) {
					let e = t[n].data;
					e.fill(-Infinity), e[this.bos_token_id] = 0;
				}
				return t;
			}
		}
		class l extends a {
			constructor(e, t) {
				super(), this.max_length = e, this.eos_token_id = Array.isArray(t) ? t : [t];
			}
			_call(e, t) {
				for (let n = 0; n < e.length; ++n) if (e[n].length === this.max_length - 1) {
					let e = t[n].data;
					e.fill(-Infinity);
					for (let t of this.eos_token_id) e[t] = 0;
				}
				return t;
			}
		}
		class u extends a {
			constructor(e, t) {
				super(), this.begin_suppress_tokens = e, this.begin_index = t;
			}
			_call(e, t) {
				for (let n = 0; n < e.length; ++n) if (e[n].length === this.begin_index) {
					let e = t[n].data;
					for (let t of this.begin_suppress_tokens) e[t] = -Infinity;
				}
				return t;
			}
		}
		class d extends a {
			constructor(e, t) {
				super(), this.eos_token_id = Array.isArray(e.eos_token_id) ? e.eos_token_id[0] : e.eos_token_id, this.no_timestamps_token_id = e.no_timestamps_token_id, this.timestamp_begin = this.no_timestamps_token_id + 1, this.begin_index = t.length, t.at(-1) === this.no_timestamps_token_id && --this.begin_index, this.max_initial_timestamp_index = e.max_initial_timestamp_index;
			}
			_call(e, t) {
				for (let n = 0; n < e.length; ++n) {
					let r = t[n].data;
					if (r[this.no_timestamps_token_id] = -Infinity, e[n].length === this.begin_index - 1) {
						r.fill(-Infinity), r[this.timestamp_begin] = 0;
						continue;
					}
					let a = e[n].slice(this.begin_index), o = a.length >= 1 && a[a.length - 1] >= this.timestamp_begin, s = a.length < 2 || a[a.length - 2] >= this.timestamp_begin;
					if (o && (s ? r.subarray(this.timestamp_begin).fill(-Infinity) : r.subarray(0, this.eos_token_id).fill(-Infinity)), e[n].length === this.begin_index && this.max_initial_timestamp_index !== null) {
						let e = this.timestamp_begin + this.max_initial_timestamp_index;
						r.subarray(e + 1).fill(-Infinity);
					}
					let c = (0, i.log_softmax)(r);
					Math.log(c.subarray(this.timestamp_begin).map(Math.exp).reduce((e, t) => e + t)) > (0, i.max)(c.subarray(0, this.timestamp_begin))[0] && r.subarray(0, this.timestamp_begin).fill(-Infinity);
				}
				return t;
			}
		}
		class f extends a {
			constructor(e) {
				super(), this.no_repeat_ngram_size = e;
			}
			getNgrams(e) {
				let t = e.length, n = [];
				for (let r = 0; r < t + 1 - this.no_repeat_ngram_size; ++r) {
					let t = [];
					for (let n = 0; n < this.no_repeat_ngram_size; ++n) t.push(e[r + n]);
					n.push(t.map(Number));
				}
				let r = /* @__PURE__ */ new Map();
				for (let e of n) {
					let t = e.slice(0, e.length - 1), n = JSON.stringify(t), i = r.get(n) ?? [];
					i.push(e[e.length - 1]), r.set(n, i);
				}
				return r;
			}
			getGeneratedNgrams(e, t) {
				let n = t.slice(t.length + 1 - this.no_repeat_ngram_size, t.length);
				return e.get(JSON.stringify(n.map(Number))) ?? [];
			}
			calcBannedNgramTokens(e) {
				let t = [];
				if (e.length + 1 < this.no_repeat_ngram_size) return t;
				{
					let t = this.getNgrams(e);
					return this.getGeneratedNgrams(t, e);
				}
			}
			_call(e, t) {
				for (let n = 0; n < e.length; ++n) {
					let r = t[n].data, i = this.calcBannedNgramTokens(e[n]);
					for (let e of i) r[e] = -Infinity;
				}
				return t;
			}
		}
		class p extends a {
			constructor(e) {
				super(), this.penalty = e;
			}
			_call(e, t) {
				for (let n = 0; n < e.length; ++n) {
					let r = t[n].data;
					for (let t of new Set(e[n])) {
						let e = Number(t);
						r[e] < 0 ? r[e] *= this.penalty : r[e] /= this.penalty;
					}
				}
				return t;
			}
		}
		class m extends a {
			constructor(e, t) {
				super(), this.min_length = e, this.eos_token_id = Array.isArray(t) ? t : [t];
			}
			_call(e, t) {
				for (let n = 0; n < e.length; ++n) if (e[n].length < this.min_length) {
					let e = t[n].data;
					for (let t of this.eos_token_id) e[t] = -Infinity;
				}
				return t;
			}
		}
		class h extends a {
			constructor(e, t, n) {
				super(), this.prompt_length_to_skip = e, this.min_new_tokens = t, this.eos_token_id = Array.isArray(n) ? n : [n];
			}
			_call(e, t) {
				for (let n = 0; n < e.length; ++n) if (e[n].length - this.prompt_length_to_skip < this.min_new_tokens) {
					let e = t[n].data;
					for (let t of this.eos_token_id) e[t] = -Infinity;
				}
				return t;
			}
		}
		class g extends a {
			constructor(e, t) {
				super(), this.bad_words_ids = e, this.eos_token_id = Array.isArray(t) ? t : [t];
			}
			_call(e, t) {
				for (let n = 0; n < e.length; ++n) {
					let r = t[n].data, i = e[n];
					for (let e of this.bad_words_ids) {
						if (i.length < e.length - 1) continue;
						let t = !0;
						for (let n = 1; n <= e.length - 1; ++n) if (e.at(-n - 1) != i.at(-n)) {
							t = !1;
							break;
						}
						t && (r[e.at(-1)] = -Infinity);
					}
				}
				return t;
			}
		}
		class _ extends a {
			constructor(e) {
				if (super(), e <= 1) throw Error(`Require guidance scale >1 to use the classifier free guidance processor, got guidance scale ${e}.`);
				this.guidance_scale = e;
			}
			_call(e, t) {
				if (t.dims[0] !== 2 * e.length) throw Error(`Logits should have twice the batch size of the input ids, the first half of batches corresponding to the conditional inputs, and the second half of batches corresponding to the unconditional inputs. Got batch size ${t.dims[0]} for the logits and ${e.length} for the input ids.`);
				let n = e.length, r = t.slice([0, n], null), i = t.slice([n, t.dims[0]], null);
				for (let e = 0; e < i.data.length; ++e) i.data[e] += (r.data[e] - i.data[e]) * this.guidance_scale;
				return i;
			}
		}
		class v extends o {
			constructor(e) {
				if (super(), typeof e != "number" || e <= 0) {
					let t = `\`temperature\` (=${e}) must be a strictly positive float, otherwise your next token scores will be invalid.`;
					e === 0 && (t += " If you're looking for greedy decoding strategies, set `do_sample=false`.");
				}
				this.temperature = e;
			}
			_call(e, t) {
				let n = t.data;
				for (let e = 0; e < n.length; ++e) n[e] /= this.temperature;
				return t;
			}
		}
		class y extends o {
			constructor(e, { filter_value: t = -Infinity, min_tokens_to_keep: n = 1 } = {}) {
				if (super(), e < 0 || e > 1) throw Error(`\`top_p\` must be a float > 0 and < 1, but is ${e}`);
				if (!Number.isInteger(n) || n < 1) throw Error(`\`min_tokens_to_keep\` must be a positive integer, but is ${n}`);
				this.top_p = e, this.filter_value = t, this.min_tokens_to_keep = n;
			}
		}
		class b extends o {
			constructor(e, { filter_value: t = -Infinity, min_tokens_to_keep: n = 1 } = {}) {
				if (super(), !Number.isInteger(e) || e < 0) throw Error(`\`top_k\` must be a positive integer, but is ${e}`);
				this.top_k = Math.max(e, n), this.filter_value = t;
			}
		}
	}),
	"./src/generation/logits_sampler.js": ((e, t, n) => {
		n.r(t), n.d(t, { LogitsSampler: () => o });
		var r = n("./src/utils/generic.js"), i = n("./src/utils/tensor.js"), a = n("./src/utils/maths.js");
		n("./src/generation/configuration_utils.js");
		class o extends r.Callable {
			constructor(e) {
				super(), this.generation_config = e;
			}
			async _call(e) {
				return this.sample(e);
			}
			async sample(e) {
				throw Error("sample should be implemented in subclasses.");
			}
			getLogits(e, t) {
				let n = e.dims.at(-1), r = e.data;
				if (t === -1) r = r.slice(-n);
				else {
					let e = t * n;
					r = r.slice(e, e + n);
				}
				return r;
			}
			randomSelect(e) {
				let t = 0;
				for (let n = 0; n < e.length; ++n) t += e[n];
				let n = Math.random() * t;
				for (let t = 0; t < e.length; ++t) if (n -= e[t], n <= 0) return t;
				return 0;
			}
			static getSampler(e) {
				if (e.do_sample) return new c(e);
				if (e.num_beams > 1) return new l(e);
				if (e.num_return_sequences > 1) throw Error(`num_return_sequences has to be 1 when doing greedy search, but is ${e.num_return_sequences}.`);
				return new s(e);
			}
		}
		class s extends o {
			async sample(e) {
				let t = (0, a.max)(e.data)[1];
				return [[BigInt(t), 0]];
			}
		}
		class c extends o {
			async sample(e) {
				let t = e.dims.at(-1);
				this.generation_config.top_k > 0 && (t = Math.min(this.generation_config.top_k, t));
				let [n, r] = await (0, i.topk)(e, t), o = (0, a.softmax)(n.data);
				return Array.from({ length: this.generation_config.num_beams }, () => {
					let e = this.randomSelect(o);
					return [r.data[e], Math.log(o[e])];
				});
			}
		}
		class l extends o {
			async sample(e) {
				let t = e.dims.at(-1);
				this.generation_config.top_k > 0 && (t = Math.min(this.generation_config.top_k, t));
				let [n, r] = await (0, i.topk)(e, t), o = (0, a.softmax)(n.data);
				return Array.from({ length: this.generation_config.num_beams }, (e, t) => [r.data[t], Math.log(o[t])]);
			}
		}
	}),
	"./src/generation/stopping_criteria.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			EosTokenCriteria: () => s,
			InterruptableStoppingCriteria: () => c,
			MaxLengthCriteria: () => o,
			StoppingCriteria: () => i,
			StoppingCriteriaList: () => a
		});
		var r = n("./src/utils/generic.js");
		class i extends r.Callable {
			_call(e, t) {
				throw Error("StoppingCriteria needs to be subclassed");
			}
		}
		class a extends r.Callable {
			constructor() {
				super(), this.criteria = [];
			}
			push(e) {
				this.criteria.push(e);
			}
			extend(e) {
				e instanceof a ? e = e.criteria : e instanceof i && (e = [e]), this.criteria.push(...e);
			}
			_call(e, t) {
				let n = Array(e.length).fill(!1);
				for (let r of this.criteria) {
					let i = r(e, t);
					for (let e = 0; e < n.length; ++e) n[e] ||= i[e];
				}
				return n;
			}
			[Symbol.iterator]() {
				return this.criteria.values();
			}
		}
		class o extends i {
			constructor(e, t = null) {
				super(), this.max_length = e, this.max_position_embeddings = t;
			}
			_call(e) {
				return e.map((e) => e.length >= this.max_length);
			}
		}
		class s extends i {
			constructor(e) {
				super(), Array.isArray(e) || (e = [e]), this.eos_token_id = e;
			}
			_call(e, t) {
				return e.map((e) => {
					let t = e.at(-1);
					return this.eos_token_id.some((e) => t == e);
				});
			}
		}
		class c extends i {
			constructor() {
				super(), this.interrupted = !1;
			}
			interrupt() {
				this.interrupted = !0;
			}
			reset() {
				this.interrupted = !1;
			}
			_call(e, t) {
				return Array(e.length).fill(this.interrupted);
			}
		}
	}),
	"./src/generation/streamers.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			BaseStreamer: () => o,
			TextStreamer: () => c,
			WhisperTextStreamer: () => l
		});
		var r = n("./src/utils/core.js"), i = n("./src/tokenizers.js"), a = n("./src/env.js");
		class o {
			put(e) {
				throw Error("Not implemented");
			}
			end() {
				throw Error("Not implemented");
			}
		}
		let s = a.apis.IS_PROCESS_AVAILABLE ? (e) => process.stdout.write(e) : (e) => console.log(e);
		class c extends o {
			constructor(e, { skip_prompt: t = !1, callback_function: n = null, token_callback_function: r = null, skip_special_tokens: i = !0, decode_kwargs: a = {}, ...o } = {}) {
				super(), this.tokenizer = e, this.skip_prompt = t, this.callback_function = n ?? s, this.token_callback_function = r, this.decode_kwargs = {
					skip_special_tokens: i,
					...a,
					...o
				}, this.token_cache = [], this.print_len = 0, this.next_tokens_are_prompt = !0;
			}
			put(e) {
				if (e.length > 1) throw Error("TextStreamer only supports batch size of 1");
				let t = this.next_tokens_are_prompt;
				if (t && (this.next_tokens_are_prompt = !1, this.skip_prompt)) return;
				let n = e[0];
				this.token_callback_function?.(n), this.token_cache = (0, r.mergeArrays)(this.token_cache, n);
				let a = this.tokenizer.decode(this.token_cache, this.decode_kwargs), o;
				t || a.endsWith("\n") ? (o = a.slice(this.print_len), this.token_cache = [], this.print_len = 0) : a.length > 0 && (0, i.is_chinese_char)(a.charCodeAt(a.length - 1)) ? (o = a.slice(this.print_len), this.print_len += o.length) : (o = a.slice(this.print_len, a.lastIndexOf(" ") + 1), this.print_len += o.length), this.on_finalized_text(o, !1);
			}
			end() {
				let e;
				this.token_cache.length > 0 ? (e = this.tokenizer.decode(this.token_cache, this.decode_kwargs).slice(this.print_len), this.token_cache = [], this.print_len = 0) : e = "", this.next_tokens_are_prompt = !0, this.on_finalized_text(e, !0);
			}
			on_finalized_text(e, t) {
				e.length > 0 && this.callback_function?.(e), t && this.callback_function === s && a.apis.IS_PROCESS_AVAILABLE && this.callback_function?.("\n");
			}
		}
		class l extends c {
			constructor(e, { skip_prompt: t = !1, callback_function: n = null, token_callback_function: r = null, on_chunk_start: i = null, on_chunk_end: a = null, on_finalize: o = null, time_precision: s = .02, skip_special_tokens: c = !0, decode_kwargs: l = {} } = {}) {
				super(e, {
					skip_prompt: t,
					skip_special_tokens: c,
					callback_function: n,
					token_callback_function: r,
					decode_kwargs: l
				}), this.timestamp_begin = e.timestamp_begin, this.on_chunk_start = i, this.on_chunk_end = a, this.on_finalize = o, this.time_precision = s, this.waiting_for_timestamp = !1;
			}
			put(e) {
				if (e.length > 1) throw Error("WhisperTextStreamer only supports batch size of 1");
				let t = e[0];
				if (t.length === 1) {
					let e = Number(t[0]) - this.timestamp_begin;
					if (e >= 0) {
						let n = e * this.time_precision;
						this.waiting_for_timestamp ? this.on_chunk_end?.(n) : this.on_chunk_start?.(n), this.waiting_for_timestamp = !this.waiting_for_timestamp, this.token_callback_function?.(t);
						return;
					}
				}
				return super.put(e);
			}
			end() {
				super.end(), this.on_finalize?.();
			}
		}
	}),
	"./src/models.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			ASTForAudioClassification: () => En,
			ASTModel: () => Tn,
			ASTPreTrainedModel: () => wn,
			AlbertForMaskedLM: () => It,
			AlbertForQuestionAnswering: () => Ft,
			AlbertForSequenceClassification: () => Pt,
			AlbertModel: () => Nt,
			AlbertPreTrainedModel: () => Mt,
			ArceeForCausalLM: () => Jr,
			ArceeModel: () => qr,
			ArceePreTrainedModel: () => Kr,
			AutoModel: () => Qu,
			AutoModelForAudioClassification: () => _d,
			AutoModelForAudioFrameClassification: () => yd,
			AutoModelForAudioTextToText: () => Od,
			AutoModelForCTC: () => gd,
			AutoModelForCausalLM: () => ad,
			AutoModelForDepthEstimation: () => Cd,
			AutoModelForDocumentQuestionAnswering: () => bd,
			AutoModelForImageClassification: () => ld,
			AutoModelForImageFeatureExtraction: () => Ed,
			AutoModelForImageMatting: () => xd,
			AutoModelForImageSegmentation: () => ud,
			AutoModelForImageTextToText: () => Dd,
			AutoModelForImageToImage: () => Sd,
			AutoModelForMaskGeneration: () => hd,
			AutoModelForMaskedLM: () => od,
			AutoModelForNormalEstimation: () => wd,
			AutoModelForObjectDetection: () => pd,
			AutoModelForPoseEstimation: () => Td,
			AutoModelForQuestionAnswering: () => sd,
			AutoModelForSemanticSegmentation: () => dd,
			AutoModelForSeq2SeqLM: () => td,
			AutoModelForSequenceClassification: () => $u,
			AutoModelForSpeechSeq2Seq: () => nd,
			AutoModelForTextToSpectrogram: () => rd,
			AutoModelForTextToWaveform: () => id,
			AutoModelForTokenClassification: () => ed,
			AutoModelForUniversalSegmentation: () => fd,
			AutoModelForVision2Seq: () => cd,
			AutoModelForXVector: () => vd,
			AutoModelForZeroShotObjectDetection: () => md,
			BartForConditionalGeneration: () => Jt,
			BartForSequenceClassification: () => Yt,
			BartModel: () => qt,
			BartPretrainedModel: () => Kt,
			BaseModelOutput: () => ue,
			BeitForImageClassification: () => Ya,
			BeitModel: () => Ja,
			BeitPreTrainedModel: () => qa,
			BertForMaskedLM: () => B,
			BertForQuestionAnswering: () => U,
			BertForSequenceClassification: () => V,
			BertForTokenClassification: () => H,
			BertModel: () => fe,
			BertPreTrainedModel: () => de,
			BlenderbotForConditionalGeneration: () => rn,
			BlenderbotModel: () => nn,
			BlenderbotPreTrainedModel: () => tn,
			BlenderbotSmallForConditionalGeneration: () => sn,
			BlenderbotSmallModel: () => on,
			BlenderbotSmallPreTrainedModel: () => an,
			BloomForCausalLM: () => aa,
			BloomModel: () => ia,
			BloomPreTrainedModel: () => ra,
			CLIPModel: () => $n,
			CLIPPreTrainedModel: () => Qn,
			CLIPSegForImageSegmentation: () => gr,
			CLIPSegModel: () => hr,
			CLIPSegPreTrainedModel: () => mr,
			CLIPTextModel: () => er,
			CLIPTextModelWithProjection: () => tr,
			CLIPVisionModel: () => nr,
			CLIPVisionModelWithProjection: () => rr,
			CamembertForMaskedLM: () => Ue,
			CamembertForQuestionAnswering: () => Ke,
			CamembertForSequenceClassification: () => We,
			CamembertForTokenClassification: () => Ge,
			CamembertModel: () => He,
			CamembertPreTrainedModel: () => Ve,
			CausalLMOutput: () => Pd,
			CausalLMOutputWithPast: () => Fd,
			ChineseCLIPModel: () => lr,
			ChineseCLIPPreTrainedModel: () => cr,
			ClapAudioModelWithProjection: () => nl,
			ClapModel: () => el,
			ClapPreTrainedModel: () => $c,
			ClapTextModelWithProjection: () => tl,
			CodeGenForCausalLM: () => Lr,
			CodeGenModel: () => Ir,
			CodeGenPreTrainedModel: () => Fr,
			CohereForCausalLM: () => Di,
			CohereModel: () => Ei,
			CoherePreTrainedModel: () => Ti,
			ConvBertForMaskedLM: () => J,
			ConvBertForQuestionAnswering: () => Fe,
			ConvBertForSequenceClassification: () => Ne,
			ConvBertForTokenClassification: () => Pe,
			ConvBertModel: () => Me,
			ConvBertPreTrainedModel: () => je,
			ConvNextForImageClassification: () => ls,
			ConvNextModel: () => cs,
			ConvNextPreTrainedModel: () => ss,
			ConvNextV2ForImageClassification: () => fs,
			ConvNextV2Model: () => ds,
			ConvNextV2PreTrainedModel: () => us,
			DFineForObjectDetection: () => _o,
			DFineModel: () => go,
			DFinePreTrainedModel: () => ho,
			DINOv3ConvNextModel: () => Ss,
			DINOv3ConvNextPreTrainedModel: () => xs,
			DINOv3ViTModel: () => bs,
			DINOv3ViTPreTrainedModel: () => ys,
			DPTForDepthEstimation: () => Bo,
			DPTModel: () => zo,
			DPTPreTrainedModel: () => Ro,
			DacDecoderModel: () => cu,
			DacDecoderOutput: () => au,
			DacEncoderModel: () => su,
			DacEncoderOutput: () => iu,
			DacModel: () => ou,
			DacPreTrainedModel: () => ru,
			DebertaForMaskedLM: () => Ye,
			DebertaForQuestionAnswering: () => Qe,
			DebertaForSequenceClassification: () => Xe,
			DebertaForTokenClassification: () => Ze,
			DebertaModel: () => Je,
			DebertaPreTrainedModel: () => qe,
			DebertaV2ForMaskedLM: () => tt,
			DebertaV2ForQuestionAnswering: () => it,
			DebertaV2ForSequenceClassification: () => nt,
			DebertaV2ForTokenClassification: () => rt,
			DebertaV2Model: () => et,
			DebertaV2PreTrainedModel: () => $e,
			DecisionTransformerModel: () => Il,
			DecisionTransformerPreTrainedModel: () => Fl,
			DeiTForImageClassification: () => wo,
			DeiTModel: () => Co,
			DeiTPreTrainedModel: () => So,
			DepthAnythingForDepthEstimation: () => Ho,
			DepthAnythingPreTrainedModel: () => Vo,
			DepthProForDepthEstimation: () => Jo,
			DepthProPreTrainedModel: () => qo,
			DetrForObjectDetection: () => Qa,
			DetrForSegmentation: () => $a,
			DetrModel: () => Za,
			DetrObjectDetectionOutput: () => eo,
			DetrPreTrainedModel: () => Xa,
			DetrSegmentationOutput: () => to,
			Dinov2ForImageClassification: () => hs,
			Dinov2Model: () => ms,
			Dinov2PreTrainedModel: () => ps,
			Dinov2WithRegistersForImageClassification: () => vs,
			Dinov2WithRegistersModel: () => _s,
			Dinov2WithRegistersPreTrainedModel: () => gs,
			DistilBertForMaskedLM: () => ut,
			DistilBertForQuestionAnswering: () => lt,
			DistilBertForSequenceClassification: () => st,
			DistilBertForTokenClassification: () => ct,
			DistilBertModel: () => ot,
			DistilBertPreTrainedModel: () => at,
			DonutSwinModel: () => os,
			DonutSwinPreTrainedModel: () => as,
			EdgeTamModel: () => Fs,
			EfficientNetForImageClassification: () => ml,
			EfficientNetModel: () => pl,
			EfficientNetPreTrainedModel: () => fl,
			ElectraForMaskedLM: () => Le,
			ElectraForQuestionAnswering: () => Be,
			ElectraForSequenceClassification: () => Re,
			ElectraForTokenClassification: () => ze,
			ElectraModel: () => Y,
			ElectraPreTrainedModel: () => Ie,
			Ernie4_5ForCausalLM: () => Kc,
			Ernie4_5Model: () => Gc,
			Ernie4_5PreTrainedModel: () => Wc,
			EsmForMaskedLM: () => pt,
			EsmForSequenceClassification: () => mt,
			EsmForTokenClassification: () => ht,
			EsmModel: () => ft,
			EsmPreTrainedModel: () => dt,
			ExaoneForCausalLM: () => li,
			ExaoneModel: () => ci,
			ExaonePreTrainedModel: () => si,
			FalconForCausalLM: () => Qc,
			FalconModel: () => Zc,
			FalconPreTrainedModel: () => Xc,
			FastViTForImageClassification: () => Ma,
			FastViTModel: () => ja,
			FastViTPreTrainedModel: () => Aa,
			Florence2ForConditionalGeneration: () => Bn,
			Florence2PreTrainedModel: () => zn,
			GLPNForDepthEstimation: () => is,
			GLPNModel: () => rs,
			GLPNPreTrainedModel: () => ns,
			GPT2LMHeadModel: () => yr,
			GPT2Model: () => vr,
			GPT2PreTrainedModel: () => _r,
			GPTBigCodeForCausalLM: () => Pr,
			GPTBigCodeModel: () => Nr,
			GPTBigCodePreTrainedModel: () => Mr,
			GPTJForCausalLM: () => jr,
			GPTJModel: () => Ar,
			GPTJPreTrainedModel: () => kr,
			GPTNeoForCausalLM: () => Tr,
			GPTNeoModel: () => wr,
			GPTNeoPreTrainedModel: () => Cr,
			GPTNeoXForCausalLM: () => Or,
			GPTNeoXModel: () => Dr,
			GPTNeoXPreTrainedModel: () => Er,
			Gemma2ForCausalLM: () => Ni,
			Gemma2Model: () => Mi,
			Gemma2PreTrainedModel: () => ji,
			Gemma3ForCausalLM: () => zi,
			Gemma3Model: () => Ri,
			Gemma3PreTrainedModel: () => Li,
			Gemma3nForConditionalGeneration: () => Kn,
			Gemma3nPreTrainedModel: () => Gn,
			GemmaForCausalLM: () => Ai,
			GemmaModel: () => ki,
			GemmaPreTrainedModel: () => Oi,
			GlmForCausalLM: () => oi,
			GlmModel: () => ai,
			GlmPreTrainedModel: () => ii,
			GraniteForCausalLM: () => xi,
			GraniteModel: () => bi,
			GraniteMoeHybridForCausalLM: () => wi,
			GraniteMoeHybridModel: () => Ci,
			GraniteMoeHybridPreTrainedModel: () => Si,
			GranitePreTrainedModel: () => yi,
			GroundingDinoForObjectDetection: () => ws,
			GroundingDinoPreTrainedModel: () => Cs,
			GroupViTModel: () => ka,
			GroupViTPreTrainedModel: () => Oa,
			HeliumForCausalLM: () => ri,
			HeliumModel: () => ni,
			HeliumPreTrainedModel: () => ti,
			HieraForImageClassification: () => Do,
			HieraModel: () => Eo,
			HieraPreTrainedModel: () => To,
			HubertForCTC: () => gc,
			HubertForSequenceClassification: () => _c,
			HubertModel: () => hc,
			HubertPreTrainedModel: () => mc,
			IJepaForImageClassification: () => _a,
			IJepaModel: () => ga,
			IJepaPreTrainedModel: () => ha,
			Idefics3ForConditionalGeneration: () => Jn,
			Idefics3PreTrainedModel: () => qn,
			ImageMattingOutput: () => Id,
			JAISLMHeadModel: () => Sr,
			JAISModel: () => xr,
			JAISPreTrainedModel: () => br,
			JinaCLIPModel: () => dr,
			JinaCLIPPreTrainedModel: () => ur,
			JinaCLIPTextModel: () => fr,
			JinaCLIPVisionModel: () => pr,
			Lfm2ForCausalLM: () => Zr,
			Lfm2Model: () => Xr,
			Lfm2PreTrainedModel: () => Yr,
			LiteWhisperForConditionalGeneration: () => An,
			Llama4ForCausalLM: () => Hr,
			Llama4PreTrainedModel: () => Vr,
			LlamaForCausalLM: () => Br,
			LlamaModel: () => zr,
			LlamaPreTrainedModel: () => Rr,
			LlavaForConditionalGeneration: () => In,
			LlavaOnevisionForConditionalGeneration: () => Ln,
			LlavaPreTrainedModel: () => Fn,
			LlavaQwen2ForCausalLM: () => Un,
			LongT5ForConditionalGeneration: () => Ht,
			LongT5Model: () => Vt,
			LongT5PreTrainedModel: () => Bt,
			M2M100ForConditionalGeneration: () => Hs,
			M2M100Model: () => Vs,
			M2M100PreTrainedModel: () => Bs,
			MBartForCausalLM: () => en,
			MBartForConditionalGeneration: () => Qt,
			MBartForSequenceClassification: () => $t,
			MBartModel: () => Zt,
			MBartPreTrainedModel: () => Xt,
			MPNetForMaskedLM: () => Ct,
			MPNetForQuestionAnswering: () => Et,
			MPNetForSequenceClassification: () => wt,
			MPNetForTokenClassification: () => Tt,
			MPNetModel: () => St,
			MPNetPreTrainedModel: () => xt,
			MT5ForConditionalGeneration: () => Gt,
			MT5Model: () => Wt,
			MT5PreTrainedModel: () => Ut,
			MarianMTModel: () => zs,
			MarianModel: () => Rs,
			MarianPreTrainedModel: () => Ls,
			MaskFormerForInstanceSegmentation: () => ts,
			MaskFormerModel: () => es,
			MaskFormerPreTrainedModel: () => $o,
			MaskedLMOutput: () => Md,
			Metric3DForDepthEstimation: () => Xo,
			Metric3DPreTrainedModel: () => Yo,
			Metric3Dv2ForDepthEstimation: () => Qo,
			Metric3Dv2PreTrainedModel: () => Zo,
			MgpstrForSceneTextRecognition: () => Vl,
			MgpstrModelOutput: () => zl,
			MgpstrPreTrainedModel: () => Bl,
			MimiDecoderModel: () => nu,
			MimiDecoderOutput: () => $l,
			MimiEncoderModel: () => tu,
			MimiEncoderOutput: () => Ql,
			MimiModel: () => eu,
			MimiPreTrainedModel: () => Zl,
			Ministral3ForCausalLM: () => Uc,
			Ministral3Model: () => Hc,
			Ministral3PreTrainedModel: () => Vc,
			MinistralForCausalLM: () => Bc,
			MinistralModel: () => zc,
			MinistralPreTrainedModel: () => Rc,
			Mistral3ForConditionalGeneration: () => Wn,
			MistralForCausalLM: () => Lc,
			MistralModel: () => Ic,
			MistralPreTrainedModel: () => Fc,
			MobileBertForMaskedLM: () => vt,
			MobileBertForQuestionAnswering: () => bt,
			MobileBertForSequenceClassification: () => yt,
			MobileBertModel: () => _t,
			MobileBertPreTrainedModel: () => gt,
			MobileLLMForCausalLM: () => fi,
			MobileLLMModel: () => di,
			MobileLLMPreTrainedModel: () => ui,
			MobileNetV1ForImageClassification: () => xl,
			MobileNetV1ForSemanticSegmentation: () => Sl,
			MobileNetV1Model: () => bl,
			MobileNetV1PreTrainedModel: () => yl,
			MobileNetV2ForImageClassification: () => Tl,
			MobileNetV2ForSemanticSegmentation: () => El,
			MobileNetV2Model: () => wl,
			MobileNetV2PreTrainedModel: () => Cl,
			MobileNetV3ForImageClassification: () => kl,
			MobileNetV3ForSemanticSegmentation: () => Al,
			MobileNetV3Model: () => Ol,
			MobileNetV3PreTrainedModel: () => Dl,
			MobileNetV4ForImageClassification: () => Nl,
			MobileNetV4ForSemanticSegmentation: () => Pl,
			MobileNetV4Model: () => Ml,
			MobileNetV4PreTrainedModel: () => jl,
			MobileViTForImageClassification: () => La,
			MobileViTModel: () => Ia,
			MobileViTPreTrainedModel: () => Fa,
			MobileViTV2ForImageClassification: () => Ba,
			MobileViTV2Model: () => za,
			MobileViTV2PreTrainedModel: () => Ra,
			ModelOutput: () => le,
			ModernBertDecoderForCausalLM: () => Se,
			ModernBertDecoderModel: () => xe,
			ModernBertDecoderPreTrainedModel: () => be,
			ModernBertForMaskedLM: () => _e,
			ModernBertForSequenceClassification: () => ve,
			ModernBertForTokenClassification: () => ye,
			ModernBertModel: () => ge,
			ModernBertPreTrainedModel: () => q,
			Moondream1ForConditionalGeneration: () => Rn,
			MoonshineForConditionalGeneration: () => Nn,
			MoonshineModel: () => Mn,
			MoonshinePreTrainedModel: () => jn,
			MptForCausalLM: () => ca,
			MptModel: () => sa,
			MptPreTrainedModel: () => oa,
			MultiModalityCausalLM: () => Rl,
			MultiModalityPreTrainedModel: () => Ll,
			MusicgenForCausalLM: () => _l,
			MusicgenForConditionalGeneration: () => vl,
			MusicgenModel: () => gl,
			MusicgenPreTrainedModel: () => hl,
			NanoChatForCausalLM: () => Gr,
			NanoChatModel: () => Wr,
			NanoChatPreTrainedModel: () => Ur,
			NeoBertForMaskedLM: () => G,
			NeoBertForQuestionAnswering: () => he,
			NeoBertForSequenceClassification: () => me,
			NeoBertForTokenClassification: () => K,
			NeoBertModel: () => pe,
			NeoBertPreTrainedModel: () => W,
			NomicBertModel: () => we,
			NomicBertPreTrainedModel: () => Ce,
			OPTForCausalLM: () => da,
			OPTModel: () => ua,
			OPTPreTrainedModel: () => la,
			Olmo2ForCausalLM: () => vi,
			Olmo2Model: () => _i,
			Olmo2PreTrainedModel: () => gi,
			OlmoForCausalLM: () => hi,
			OlmoModel: () => mi,
			OlmoPreTrainedModel: () => pi,
			OpenELMForCausalLM: () => Hi,
			OpenELMModel: () => Vi,
			OpenELMPreTrainedModel: () => Bi,
			OwlViTForObjectDetection: () => Ua,
			OwlViTModel: () => Ha,
			OwlViTPreTrainedModel: () => Va,
			Owlv2ForObjectDetection: () => Ka,
			Owlv2Model: () => Ga,
			Owlv2PreTrainedModel: () => Wa,
			PaliGemmaForConditionalGeneration: () => Hn,
			PaliGemmaPreTrainedModel: () => Vn,
			ParakeetForCTC: () => Ys,
			ParakeetPreTrainedModel: () => Js,
			PatchTSMixerForPrediction: () => ql,
			PatchTSMixerModel: () => Kl,
			PatchTSMixerPreTrainedModel: () => Gl,
			PatchTSTForPrediction: () => Wl,
			PatchTSTModel: () => Ul,
			PatchTSTPreTrainedModel: () => Hl,
			Phi3ForCausalLM: () => na,
			Phi3Model: () => ta,
			Phi3PreTrainedModel: () => ea,
			Phi3VForCausalLM: () => Zn,
			Phi3VPreTrainedModel: () => Xn,
			PhiForCausalLM: () => $i,
			PhiModel: () => Qi,
			PhiPreTrainedModel: () => Zi,
			PreTrainedModel: () => z,
			PretrainedMixin: () => Q,
			PvtForImageClassification: () => Sa,
			PvtModel: () => xa,
			PvtPreTrainedModel: () => ba,
			PyAnnoteForAudioFrameClassification: () => Qs,
			PyAnnoteModel: () => Zs,
			PyAnnotePreTrainedModel: () => Xs,
			QuestionAnsweringModelOutput: () => Nd,
			Qwen2ForCausalLM: () => Gi,
			Qwen2Model: () => Wi,
			Qwen2PreTrainedModel: () => Ui,
			Qwen2VLForConditionalGeneration: () => Xi,
			Qwen2VLPreTrainedModel: () => Yi,
			Qwen3ForCausalLM: () => Ji,
			Qwen3Model: () => qi,
			Qwen3PreTrainedModel: () => Ki,
			RFDetrForObjectDetection: () => po,
			RFDetrModel: () => fo,
			RFDetrObjectDetectionOutput: () => mo,
			RFDetrPreTrainedModel: () => uo,
			RTDetrForObjectDetection: () => io,
			RTDetrModel: () => ro,
			RTDetrObjectDetectionOutput: () => ao,
			RTDetrPreTrainedModel: () => no,
			RTDetrV2ForObjectDetection: () => co,
			RTDetrV2Model: () => so,
			RTDetrV2ObjectDetectionOutput: () => lo,
			RTDetrV2PreTrainedModel: () => oo,
			ResNetForImageClassification: () => Ao,
			ResNetModel: () => ko,
			ResNetPreTrainedModel: () => Oo,
			RoFormerForMaskedLM: () => De,
			RoFormerForQuestionAnswering: () => Ae,
			RoFormerForSequenceClassification: () => Oe,
			RoFormerForTokenClassification: () => ke,
			RoFormerModel: () => Ee,
			RoFormerPreTrainedModel: () => Te,
			RobertaForMaskedLM: () => Z,
			RobertaForQuestionAnswering: () => dn,
			RobertaForSequenceClassification: () => ln,
			RobertaForTokenClassification: () => un,
			RobertaModel: () => X,
			RobertaPreTrainedModel: () => cn,
			Sam2ImageSegmentationOutput: () => Ms,
			Sam2Model: () => Ps,
			Sam2PreTrainedModel: () => Ns,
			Sam3TrackerModel: () => Is,
			SamImageSegmentationOutput: () => js,
			SamModel: () => As,
			SamPreTrainedModel: () => ks,
			SapiensForDepthEstimation: () => Go,
			SapiensForNormalEstimation: () => Ko,
			SapiensForSemanticSegmentation: () => Wo,
			SapiensPreTrainedModel: () => Uo,
			SegformerForImageClassification: () => sl,
			SegformerForSemanticSegmentation: () => cl,
			SegformerModel: () => ol,
			SegformerPreTrainedModel: () => al,
			Seq2SeqLMOutput: () => kd,
			SequenceClassifierOutput: () => $,
			SiglipModel: () => ar,
			SiglipPreTrainedModel: () => ir,
			SiglipTextModel: () => or,
			SiglipVisionModel: () => sr,
			SmolLM3ForCausalLM: () => ei,
			SmolLM3Model: () => $r,
			SmolLM3PreTrainedModel: () => Qr,
			SmolVLMForConditionalGeneration: () => Yn,
			SnacDecoderModel: () => fu,
			SnacEncoderModel: () => du,
			SnacModel: () => uu,
			SnacPreTrainedModel: () => lu,
			SpeechT5ForSpeechToText: () => Oc,
			SpeechT5ForTextToSpeech: () => kc,
			SpeechT5HifiGan: () => Ac,
			SpeechT5Model: () => Dc,
			SpeechT5PreTrainedModel: () => Ec,
			SqueezeBertForMaskedLM: () => kt,
			SqueezeBertForQuestionAnswering: () => jt,
			SqueezeBertForSequenceClassification: () => At,
			SqueezeBertModel: () => Ot,
			SqueezeBertPreTrainedModel: () => Dt,
			StableLmForCausalLM: () => dl,
			StableLmModel: () => ul,
			StableLmPreTrainedModel: () => ll,
			Starcoder2ForCausalLM: () => Yc,
			Starcoder2Model: () => Jc,
			Starcoder2PreTrainedModel: () => qc,
			StyleTextToSpeech2Model: () => Tc,
			StyleTextToSpeech2PreTrainedModel: () => wc,
			SupertonicForConditionalGeneration: () => Mc,
			SupertonicPreTrainedModel: () => jc,
			Swin2SRForImageSuperResolution: () => Lo,
			Swin2SRModel: () => Io,
			Swin2SRPreTrainedModel: () => Fo,
			SwinForImageClassification: () => No,
			SwinForSemanticSegmentation: () => Po,
			SwinModel: () => Mo,
			SwinPreTrainedModel: () => jo,
			T5ForConditionalGeneration: () => zt,
			T5Model: () => Rt,
			T5PreTrainedModel: () => Lt,
			TableTransformerForObjectDetection: () => bo,
			TableTransformerModel: () => yo,
			TableTransformerObjectDetectionOutput: () => xo,
			TableTransformerPreTrainedModel: () => vo,
			TokenClassifierOutput: () => jd,
			TrOCRForCausalLM: () => Pc,
			TrOCRPreTrainedModel: () => Nc,
			UltravoxModel: () => Yl,
			UltravoxPreTrainedModel: () => Jl,
			UniSpeechForCTC: () => rc,
			UniSpeechForSequenceClassification: () => ic,
			UniSpeechModel: () => nc,
			UniSpeechPreTrainedModel: () => tc,
			UniSpeechSatForAudioFrameClassification: () => lc,
			UniSpeechSatForCTC: () => sc,
			UniSpeechSatForSequenceClassification: () => cc,
			UniSpeechSatModel: () => oc,
			UniSpeechSatPreTrainedModel: () => ac,
			VaultGemmaForCausalLM: () => Ii,
			VaultGemmaModel: () => Fi,
			VaultGemmaPreTrainedModel: () => Pi,
			ViTForImageClassification: () => ma,
			ViTMAEModel: () => wa,
			ViTMAEPreTrainedModel: () => Ca,
			ViTMSNForImageClassification: () => Da,
			ViTMSNModel: () => Ea,
			ViTMSNPreTrainedModel: () => Ta,
			ViTModel: () => pa,
			ViTPreTrainedModel: () => fa,
			VisionEncoderDecoderModel: () => Pn,
			VitMatteForImageMatting: () => Pa,
			VitMattePreTrainedModel: () => Na,
			VitPoseForPoseEstimation: () => ya,
			VitPosePreTrainedModel: () => va,
			VitsModel: () => il,
			VitsModelOutput: () => Ld,
			VitsPreTrainedModel: () => rl,
			VoxtralForConditionalGeneration: () => Xl,
			Wav2Vec2BertForCTC: () => fc,
			Wav2Vec2BertForSequenceClassification: () => pc,
			Wav2Vec2BertModel: () => dc,
			Wav2Vec2BertPreTrainedModel: () => uc,
			Wav2Vec2ForAudioFrameClassification: () => qs,
			Wav2Vec2ForCTC: () => Gs,
			Wav2Vec2ForSequenceClassification: () => Ks,
			Wav2Vec2Model: () => Ws,
			Wav2Vec2PreTrainedModel: () => Us,
			WavLMForAudioFrameClassification: () => Cc,
			WavLMForCTC: () => bc,
			WavLMForSequenceClassification: () => xc,
			WavLMForXVector: () => Sc,
			WavLMModel: () => yc,
			WavLMPreTrainedModel: () => vc,
			WeSpeakerResNetModel: () => ec,
			WeSpeakerResNetPreTrainedModel: () => $s,
			WhisperForConditionalGeneration: () => kn,
			WhisperModel: () => On,
			WhisperPreTrainedModel: () => Dn,
			XLMForQuestionAnswering: () => _n,
			XLMForSequenceClassification: () => hn,
			XLMForTokenClassification: () => gn,
			XLMModel: () => pn,
			XLMPreTrainedModel: () => fn,
			XLMRobertaForMaskedLM: () => bn,
			XLMRobertaForQuestionAnswering: () => Cn,
			XLMRobertaForSequenceClassification: () => xn,
			XLMRobertaForTokenClassification: () => Sn,
			XLMRobertaModel: () => yn,
			XLMRobertaPreTrainedModel: () => vn,
			XLMWithLMHeadModel: () => mn,
			XVectorOutput: () => Ad,
			YolosForObjectDetection: () => Ds,
			YolosModel: () => Es,
			YolosObjectDetectionOutput: () => Os,
			YolosPreTrainedModel: () => Ts
		});
		var r = n("./src/configs.js"), i = n("./src/backends/onnx.js"), a = n("./src/utils/dtypes.js"), o = n("./src/utils/generic.js"), s = n("./src/utils/core.js"), c = n("./src/utils/hub.js"), l = n("./src/utils/constants.js"), u = n("./src/generation/logits_process.js"), d = n("./src/generation/configuration_utils.js"), f = n("./src/utils/tensor.js"), p = n("./src/utils/image.js"), m = n("./src/utils/maths.js"), h = n("./src/generation/stopping_criteria.js"), g = n("./src/generation/logits_sampler.js"), _ = n("./src/env.js"), v = n("./src/models/whisper/generation_whisper.js"), y = n("./src/models/whisper/common_whisper.js");
		let b = {
			EncoderOnly: 0,
			EncoderDecoder: 1,
			Seq2Seq: 2,
			Vision2Seq: 3,
			DecoderOnly: 4,
			MaskGeneration: 5,
			ImageTextToText: 6,
			Musicgen: 7,
			MultiModality: 8,
			Phi3V: 9,
			AudioTextToText: 10,
			AutoEncoder: 11,
			ImageAudioTextToText: 12,
			Supertonic: 13
		}, x = /* @__PURE__ */ new Map(), S = /* @__PURE__ */ new Map(), C = /* @__PURE__ */ new Map();
		async function w(e, t, n) {
			let o = n.config?.["transformers.js_config"] ?? {}, s = n.device ?? o.device;
			s && typeof s != "string" && (s.hasOwnProperty(t) ? s = s[t] : (console.warn(`device not specified for "${t}". Using the default device.`), s = null));
			let l = s ?? (_.apis.IS_NODE_ENV ? "cpu" : "wasm"), u = (0, i.deviceToExecutionProviders)(l), d = o.device_config ?? {};
			d.hasOwnProperty(l) && (o = {
				...o,
				...d[l]
			});
			let f = n.dtype ?? o.dtype;
			if (typeof f != "string" && (f && f.hasOwnProperty(t) ? f = f[t] : (f = a.DEFAULT_DEVICE_DTYPE_MAPPING[l] ?? a.DATA_TYPES.fp32, console.warn(`dtype not specified for "${t}". Using the default dtype (${f}) for this device (${l}).`))), f === a.DATA_TYPES.auto) {
				let e = o.dtype;
				typeof e != "string" && (e = e?.[t]), f = e && e !== a.DATA_TYPES.auto && a.DATA_TYPES.hasOwnProperty(e) ? e : a.DEFAULT_DEVICE_DTYPE_MAPPING[l] ?? a.DATA_TYPES.fp32;
			}
			let p = f;
			if (!a.DEFAULT_DTYPE_SUFFIX_MAPPING.hasOwnProperty(p)) throw Error(`Invalid dtype: ${p}. Should be one of: ${Object.keys(a.DATA_TYPES).join(", ")}`);
			if (p === a.DATA_TYPES.fp16 && l === "webgpu" && !await (0, a.isWebGpuFp16Supported)()) throw Error(`The device (${l}) does not support fp16.`);
			let m = o.kv_cache_dtype, h = m ? typeof m == "string" ? m : m[p] ?? "float32" : void 0;
			if (h && !["float32", "float16"].includes(h)) throw Error(`Invalid kv_cache_dtype: ${h}. Should be one of: float32, float16`);
			let g = {
				dtype: p,
				kv_cache_dtype: h,
				device: l
			}, v = `${t}${a.DEFAULT_DTYPE_SUFFIX_MAPPING[p]}.onnx`, y = `${n.subfolder ?? ""}/${v}`, b = { ...n.session_options };
			b.executionProviders ??= u;
			let x = o.free_dimension_overrides;
			x ? b.freeDimensionOverrides ??= x : l.startsWith("webnn") && !b.freeDimensionOverrides && console.warn(`WebNN does not currently support dynamic shapes and requires 'free_dimension_overrides' to be set in config.json, preferably as a field within config["transformers.js_config"]["device_config"]["${l}"]. When 'free_dimension_overrides' is not set, you may experience significant performance degradation.`);
			let S = _.apis.IS_NODE_ENV && _.env.useFSCache, C = (0, c.getModelFile)(e, y, !0, n, S), w = n.use_external_data_format ?? o.use_external_data_format, T = [];
			if (w) {
				let r;
				r = typeof w == "object" ? w.hasOwnProperty(v) ? w[v] : w.hasOwnProperty(t) ? w[t] : !1 : w;
				let i = +r;
				if (i > c.MAX_EXTERNAL_DATA_CHUNKS) throw Error(`The number of external data chunks (${i}) exceeds the maximum allowed value (${c.MAX_EXTERNAL_DATA_CHUNKS}).`);
				for (let t = 0; t < i; ++t) {
					let r = `${v}_data${t === 0 ? "" : "_" + t}`, i = `${n.subfolder ?? ""}/${r}`;
					T.push(new Promise(async (t, a) => {
						let o = await (0, c.getModelFile)(e, i, !0, n, S);
						t(o instanceof Uint8Array ? {
							path: r,
							data: o
						} : r);
					}));
				}
			} else b.externalData !== void 0 && (T = b.externalData.map(async (t) => {
				if (typeof t.data == "string") {
					let r = await (0, c.getModelFile)(e, t.data, !0, n);
					return {
						...t,
						data: r
					};
				}
				return t;
			}));
			if (T.length > 0) {
				let e = await Promise.all(T);
				_.apis.IS_NODE_ENV || (b.externalData = e);
			}
			if (l === "webgpu") {
				let e = (0, r.getCacheShapes)(n.config, { prefix: "present" });
				if (Object.keys(e).length > 0 && !(0, i.isONNXProxy)()) {
					let t = {};
					for (let n in e) t[n] = "gpu-buffer";
					b.preferredOutputLocation = t;
				}
			}
			return {
				buffer_or_path: await C,
				session_options: b,
				session_config: g
			};
		}
		async function T(e, t, n) {
			return Object.fromEntries(await Promise.all(Object.keys(t).map(async (r) => {
				let { buffer_or_path: a, session_options: o, session_config: s } = await w(e, t[r], n);
				return [r, await (0, i.createInferenceSession)(a, o, s)];
			})));
		}
		async function E(e, t, n) {
			return Object.fromEntries(await Promise.all(Object.keys(t).map(async (r) => [r, await (0, c.getModelJSON)(e, t[r], !1, n)])));
		}
		function D(e, t) {
			let n = Object.create(null), r = [];
			for (let a of e.inputNames) {
				let e = t[a];
				if (!(e instanceof f.Tensor)) {
					r.push(a);
					continue;
				}
				n[a] = (0, i.isONNXProxy)() ? e.clone() : e;
			}
			if (r.length > 0) throw Error(`An error occurred during model execution: "Missing the following inputs: ${r.join(", ")}.`);
			let a = Object.keys(t).length, o = e.inputNames.length;
			if (a > o) {
				let n = Object.keys(t).filter((t) => !e.inputNames.includes(t));
				console.warn(`WARNING: Too many inputs were provided (${a} > ${o}). The following inputs will be ignored: "${n.join(", ")}".`);
			}
			return n;
		}
		async function O(e, t) {
			let n = D(e, t);
			try {
				let t = Object.fromEntries(Object.entries(n).map(([e, t]) => [e, t.ort_tensor]));
				return k(await (0, i.runInferenceSession)(e, t));
			} catch (e) {
				let t = Object.fromEntries(Object.entries(n).map(([e, t]) => {
					let n = {
						type: t.type,
						dims: t.dims,
						location: t.location
					};
					return n.location !== "gpu-buffer" && (n.data = t.data), [e, n];
				}));
				throw console.error(`An error occurred during model execution: "${e}".`), console.error("Inputs given to model:", t), e;
			}
		}
		function k(e) {
			for (let t in e) (0, i.isONNXTensor)(e[t]) ? e[t] = new f.Tensor(e[t]) : typeof e[t] == "object" && k(e[t]);
			return e;
		}
		function A(e) {
			if (e instanceof f.Tensor) return e;
			if (e.length === 0) throw Error("items must be non-empty");
			if (Array.isArray(e[0])) {
				if (e.some((t) => t.length !== e[0].length)) throw Error("Unable to create tensor, you should probably activate truncation and/or padding with 'padding=True' and/or 'truncation=True' to have batched tensors with the same length.");
				return new f.Tensor("int64", BigInt64Array.from(e.flat().map((e) => BigInt(e))), [e.length, e[0].length]);
			}
			return new f.Tensor("int64", BigInt64Array.from(e.map((e) => BigInt(e))), [1, e.length]);
		}
		function ee(e) {
			return new f.Tensor("bool", [e], [1]);
		}
		async function te(e, t) {
			let { encoder_outputs: n, input_ids: r, decoder_input_ids: i, ...a } = t;
			return n ||= (await j(e, (0, s.pick)(t, e.sessions.model.inputNames))).last_hidden_state, a.input_ids = i, a.encoder_hidden_states = n, e.sessions.decoder_model_merged.inputNames.includes("encoder_attention_mask") && (a.encoder_attention_mask = t.attention_mask), await N(e, a, !0);
		}
		async function j(e, t) {
			let n = e.sessions.model, r = (0, s.pick)(t, n.inputNames);
			if (n.inputNames.includes("inputs_embeds") && !r.inputs_embeds) {
				if (!t.input_ids) throw Error("Both `input_ids` and `inputs_embeds` are missing in the model inputs.");
				r.inputs_embeds = await e.encode_text({ input_ids: t.input_ids });
			}
			if (n.inputNames.includes("token_type_ids") && !r.token_type_ids) {
				if (!r.input_ids) throw Error("Both `input_ids` and `token_type_ids` are missing in the model inputs.");
				r.token_type_ids = (0, f.zeros_like)(r.input_ids);
			}
			if (n.inputNames.includes("pixel_mask") && !r.pixel_mask) {
				if (!r.pixel_values) throw Error("Both `pixel_values` and `pixel_mask` are missing in the model inputs.");
				let e = r.pixel_values.dims;
				r.pixel_mask = (0, f.ones)([
					e[0],
					e[2],
					e[3]
				]);
			}
			return await O(n, r);
		}
		async function M(e, t) {
			let n = await e.encode(t);
			return await e.decode(n);
		}
		async function N(e, t, n = !1) {
			let r = e.sessions[n ? "decoder_model_merged" : "model"], { past_key_values: i, ...a } = t;
			return r.inputNames.includes("use_cache_branch") && (a.use_cache_branch = ee(!!i)), r.inputNames.includes("position_ids") && a.attention_mask && !a.position_ids && (a.position_ids = ae(a, i, +!![
				"paligemma",
				"gemma3_text",
				"gemma3"
			].includes(e.config.model_type))), e.addPastKeyValues(a, i), await O(r, (0, s.pick)(a, r.inputNames));
		}
		function ne({ modality_token_id: e, inputs_embeds: t, modality_features: n, input_ids: r, attention_mask: i }) {
			let a = r.tolist().map((t) => t.reduce((t, n, r) => (n == e && t.push(r), t), [])), o = a.reduce((e, t) => e + t.length, 0), s = n.dims[0];
			if (o !== s) throw Error(`Number of tokens and features do not match: tokens: ${o}, features ${s}`);
			let c = 0;
			for (let e = 0; e < a.length; ++e) {
				let r = a[e], i = t[e];
				for (let e = 0; e < r.length; ++e) i[r[e]].data.set(n[c++].data);
			}
			return {
				inputs_embeds: t,
				attention_mask: i
			};
		}
		function P({ image_token_id: e, inputs_embeds: t, image_features: n, input_ids: r, attention_mask: i }) {
			return ne({
				modality_token_id: e,
				inputs_embeds: t,
				modality_features: n,
				input_ids: r,
				attention_mask: i
			});
		}
		function F({ audio_token_id: e, inputs_embeds: t, audio_features: n, input_ids: r, attention_mask: i }) {
			return ne({
				modality_token_id: e,
				inputs_embeds: t,
				modality_features: n,
				input_ids: r,
				attention_mask: i
			});
		}
		async function re(e, { encode_function: t, merge_function: n, modality_input_name: r, modality_output_name: i, input_ids: a = null, attention_mask: o = null, position_ids: s = null, inputs_embeds: c = null, past_key_values: l = null, generation_config: u = null, logits_processor: d = null, ...p }) {
			let m = p[r];
			if (!c) {
				if (c = await e.encode_text({
					input_ids: a,
					...p
				}), m && a.dims[1] !== 1) {
					let e = await t({
						[r]: m,
						...p
					});
					({inputs_embeds: c, attention_mask: o} = n({
						[i]: e,
						inputs_embeds: c,
						input_ids: a,
						attention_mask: o
					}));
				} else if (l && m && a.dims[1] === 1) {
					let e = a.dims[1], t = Object.values(l)[0].dims.at(-2);
					o = (0, f.cat)([(0, f.ones)([a.dims[0], t]), o.slice(null, [o.dims[1] - e, o.dims[1]])], 1);
				}
			}
			if (!s && e.config.model_type === "qwen2_vl") {
				let { image_grid_thw: t, video_grid_thw: n } = p;
				[s] = e.get_rope_index(a, t, n, o);
			}
			return await N(e, {
				inputs_embeds: c,
				past_key_values: l,
				attention_mask: o,
				position_ids: s,
				generation_config: u,
				logits_processor: d
			}, !0);
		}
		async function ie(e, t) {
			return await re(e, {
				...t,
				modality_input_name: "audio_values",
				modality_output_name: "audio_features",
				encode_function: e.encode_audio.bind(e),
				merge_function: e._merge_input_ids_with_audio_features.bind(e)
			});
		}
		async function I(e, t) {
			return await re(e, {
				...t,
				modality_input_name: "pixel_values",
				modality_output_name: "image_features",
				encode_function: e.encode_image.bind(e),
				merge_function: e._merge_input_ids_with_image_features.bind(e)
			});
		}
		function L(e, t = 0) {
			let [n, r] = e.dims, i = e.data, a = new BigInt64Array(i.length);
			for (let e = 0; e < n; ++e) {
				let n = e * r, o = BigInt(t);
				for (let e = 0; e < r; ++e) {
					let t = n + e;
					i[t] === 0n ? a[t] = BigInt(1) : (a[t] = o, o += i[t]);
				}
			}
			return {
				data: a,
				dims: e.dims
			};
		}
		function ae(e, t = null, n = 0) {
			let { input_ids: r, inputs_embeds: i, attention_mask: a } = e, { data: o, dims: s } = L(a, n), c = new f.Tensor("int64", o, s);
			if (t) {
				let e = -(r ?? i).dims.at(1);
				c = c.slice(null, [e, null]);
			}
			return c;
		}
		function oe(e, t, n, r) {
			let i = n.past_key_values ? Object.values(n.past_key_values)[0].dims.at(-2) : 0;
			if (!n.attention_mask) {
				let e;
				for (let t of [
					"input_ids",
					"inputs_embeds",
					"position_ids"
				]) if (n[t]) {
					e = n[t].dims;
					break;
				}
				if (!e) throw Error("attention_mask is not provided, and unable to infer its shape from model inputs.");
				n.attention_mask = (0, f.ones)([e[0], i + e[1]]);
			}
			if (n.past_key_values) {
				let { input_ids: e, attention_mask: t } = n;
				t && t.dims[1] > e.dims[1] || i < e.dims[1] && (n.input_ids = e.slice(null, [i, null]));
			}
			return n;
		}
		function se(e, t, n, r) {
			return n.past_key_values && (t = t.map((e) => [e.at(-1)])), {
				...n,
				decoder_input_ids: A(t)
			};
		}
		function ce(e, ...t) {
			return e.config.is_encoder_decoder ? se(e, ...t) : oe(e, ...t);
		}
		function R(e, t, n, r) {
			let i = !!n.past_key_values;
			return r.guidance_scale !== null && r.guidance_scale > 1 && (i ? n.input_ids = (0, f.cat)([n.input_ids, n.input_ids], 0) : (n.input_ids = (0, f.cat)([n.input_ids, (0, f.full_like)(n.input_ids, BigInt(r.pad_token_id))], 0), n.attention_mask = (0, f.cat)([n.attention_mask, (0, f.full_like)(n.attention_mask, 0n)], 0))), (i || !n.pixel_values) && (n.pixel_values = (0, f.full)([
				0,
				0,
				3,
				384,
				384
			], 1)), i && (n.images_seq_mask = new f.Tensor("bool", [,].fill(!0).fill(!1, 0, 1), [1, 1]), n.images_emb_mask = new f.Tensor("bool", [].fill(!1), [
				1,
				1,
				0
			])), n;
		}
		class z extends o.Callable {
			main_input_name = "input_ids";
			forward_params = ["input_ids", "attention_mask"];
			constructor(e, t, n) {
				super(), this.config = e, this.sessions = t, this.configs = n;
				let r = C.get(this.constructor), i = x.get(r);
				switch (this.can_generate = !1, this._forward = null, this._prepare_inputs_for_generation = null, i) {
					case b.DecoderOnly:
						this.can_generate = !0, this._forward = N, this._prepare_inputs_for_generation = oe;
						break;
					case b.Seq2Seq:
					case b.Vision2Seq:
					case b.Musicgen:
						this.can_generate = !0, this._forward = te, this._prepare_inputs_for_generation = se;
						break;
					case b.EncoderDecoder:
						this._forward = te;
						break;
					case b.ImageTextToText:
						this.can_generate = !0, this._forward = I, this._prepare_inputs_for_generation = ce;
						break;
					case b.AudioTextToText:
						this.can_generate = !0, this._forward = ie, this._prepare_inputs_for_generation = ce;
						break;
					case b.Phi3V:
					case b.ImageAudioTextToText:
						this.can_generate = !0, this._prepare_inputs_for_generation = ce;
						break;
					case b.MultiModality:
						this.can_generate = !0, this._prepare_inputs_for_generation = R;
						break;
					case b.AutoEncoder:
						this._forward = M;
						break;
					default: this._forward = j;
				}
				this.can_generate && this.forward_params.push("past_key_values"), this.custom_config = this.config["transformers.js_config"] ?? {};
			}
			async dispose() {
				let e = [];
				for (let t of Object.values(this.sessions)) t?.handler?.dispose && e.push(t.handler.dispose());
				return await Promise.all(e);
			}
			static async from_pretrained(e, { progress_callback: t = null, config: n = null, cache_dir: i = null, local_files_only: a = !1, revision: o = "main", model_file_name: s = null, subfolder: c = "onnx", device: u = null, dtype: d = null, use_external_data_format: f = null, session_options: p = {} } = {}) {
				let m = {
					progress_callback: t,
					config: n,
					cache_dir: i,
					local_files_only: a,
					revision: o,
					model_file_name: s,
					subfolder: c,
					device: u,
					dtype: d,
					use_external_data_format: f,
					session_options: p
				}, h = C.get(this), g = x.get(h);
				n = m.config = await r.AutoConfig.from_pretrained(e, m);
				let _;
				if (g === b.DecoderOnly) _ = await Promise.all([T(e, { model: m.model_file_name ?? "model" }, m), E(e, { generation_config: "generation_config.json" }, m)]);
				else if (g === b.Seq2Seq || g === b.Vision2Seq) _ = await Promise.all([T(e, {
					model: "encoder_model",
					decoder_model_merged: "decoder_model_merged"
				}, m), E(e, { generation_config: "generation_config.json" }, m)]);
				else if (g === b.MaskGeneration) _ = await Promise.all([T(e, {
					model: "vision_encoder",
					prompt_encoder_mask_decoder: "prompt_encoder_mask_decoder"
				}, m)]);
				else if (g === b.EncoderDecoder) _ = await Promise.all([T(e, {
					model: "encoder_model",
					decoder_model_merged: "decoder_model_merged"
				}, m)]);
				else if (g === b.ImageTextToText) {
					let t = {
						embed_tokens: "embed_tokens",
						vision_encoder: "vision_encoder",
						decoder_model_merged: "decoder_model_merged"
					};
					n.is_encoder_decoder && (t.model = "encoder_model"), _ = await Promise.all([T(e, t, m), E(e, { generation_config: "generation_config.json" }, m)]);
				} else if (g === b.AudioTextToText) _ = await Promise.all([T(e, {
					embed_tokens: "embed_tokens",
					audio_encoder: "audio_encoder",
					decoder_model_merged: "decoder_model_merged"
				}, m), E(e, { generation_config: "generation_config.json" }, m)]);
				else if (g === b.ImageAudioTextToText) _ = await Promise.all([T(e, {
					embed_tokens: "embed_tokens",
					audio_encoder: "audio_encoder",
					vision_encoder: "vision_encoder",
					decoder_model_merged: "decoder_model_merged"
				}, m), E(e, { generation_config: "generation_config.json" }, m)]);
				else if (g === b.Musicgen) _ = await Promise.all([T(e, {
					model: "text_encoder",
					decoder_model_merged: "decoder_model_merged",
					encodec_decode: "encodec_decode"
				}, m), E(e, { generation_config: "generation_config.json" }, m)]);
				else if (g === b.MultiModality) _ = await Promise.all([T(e, {
					prepare_inputs_embeds: "prepare_inputs_embeds",
					model: "language_model",
					lm_head: "lm_head",
					gen_head: "gen_head",
					gen_img_embeds: "gen_img_embeds",
					image_decode: "image_decode"
				}, m), E(e, { generation_config: "generation_config.json" }, m)]);
				else if (g === b.Phi3V) _ = await Promise.all([T(e, {
					prepare_inputs_embeds: "prepare_inputs_embeds",
					model: "model",
					vision_encoder: "vision_encoder"
				}, m), E(e, { generation_config: "generation_config.json" }, m)]);
				else if (g === b.AutoEncoder) _ = await Promise.all([T(e, {
					encoder_model: "encoder_model",
					decoder_model: "decoder_model"
				}, m)]);
				else if (g === b.Supertonic) _ = await Promise.all([T(e, {
					text_encoder: "text_encoder",
					latent_denoiser: "latent_denoiser",
					voice_decoder: "voice_decoder"
				}, m)]);
				else {
					if (g !== b.EncoderOnly) {
						let e = h ?? n?.model_type;
						e !== "custom" && console.warn(`Model type for '${e}' not found, assuming encoder-only architecture. Please report this at ${l.GITHUB_ISSUE_URL}.`);
					}
					_ = await Promise.all([T(e, { model: m.model_file_name ?? "model" }, m)]);
				}
				return new this(n, ..._);
			}
			async _call(e) {
				return await this.forward(e);
			}
			async forward(e) {
				return await this._forward(this, e);
			}
			get generation_config() {
				return this.configs?.generation_config ?? null;
			}
			_get_logits_processor(e, t, n = null) {
				let r = new u.LogitsProcessorList();
				if (e.repetition_penalty !== null && e.repetition_penalty !== 1 && r.push(new u.RepetitionPenaltyLogitsProcessor(e.repetition_penalty)), e.no_repeat_ngram_size !== null && e.no_repeat_ngram_size > 0 && r.push(new u.NoRepeatNGramLogitsProcessor(e.no_repeat_ngram_size)), e.bad_words_ids !== null && r.push(new u.NoBadWordsLogitsProcessor(e.bad_words_ids, e.eos_token_id)), e.min_length !== null && e.eos_token_id !== null && e.min_length > 0 && r.push(new u.MinLengthLogitsProcessor(e.min_length, e.eos_token_id)), e.min_new_tokens !== null && e.eos_token_id !== null && e.min_new_tokens > 0 && r.push(new u.MinNewTokensLengthLogitsProcessor(t, e.min_new_tokens, e.eos_token_id)), e.forced_bos_token_id !== null && r.push(new u.ForcedBOSTokenLogitsProcessor(e.forced_bos_token_id)), e.forced_eos_token_id !== null && r.push(new u.ForcedEOSTokenLogitsProcessor(e.max_length, e.forced_eos_token_id)), e.begin_suppress_tokens !== null) {
					let n = t > 1 || e.forced_bos_token_id === null ? t : t + 1;
					r.push(new u.SuppressTokensAtBeginLogitsProcessor(e.begin_suppress_tokens, n));
				}
				return e.guidance_scale !== null && e.guidance_scale > 1 && r.push(new u.ClassifierFreeGuidanceLogitsProcessor(e.guidance_scale)), e.temperature === 0 && e.do_sample && (console.warn("`do_sample` changed to false because `temperature: 0` implies greedy sampling (always selecting the most likely token), which is incompatible with `do_sample: true`."), e.do_sample = !1), e.do_sample && e.temperature !== null && e.temperature !== 1 && r.push(new u.TemperatureLogitsWarper(e.temperature)), n !== null && r.extend(n), r;
			}
			_prepare_generation_config(e, t, n = d.GenerationConfig) {
				let r = { ...this.config };
				for (let e of [
					"decoder",
					"generator",
					"text_config"
				]) e in r && Object.assign(r, r[e]);
				let i = new n(r);
				return Object.assign(i, this.generation_config ?? {}), e && Object.assign(i, e), t && Object.assign(i, (0, s.pick)(t, Object.getOwnPropertyNames(i))), i;
			}
			_get_stopping_criteria(e, t = null) {
				let n = new h.StoppingCriteriaList();
				return e.max_length !== null && n.push(new h.MaxLengthCriteria(e.max_length, this.config.max_position_embeddings ?? null)), e.eos_token_id !== null && n.push(new h.EosTokenCriteria(e.eos_token_id)), t && n.extend(t), n;
			}
			_validate_model_class() {
				if (!this.can_generate) {
					let e = [
						Cu,
						Du,
						Su,
						_u
					], t = C.get(this.constructor), n = /* @__PURE__ */ new Set(), r = this.config.model_type;
					for (let t of e) {
						let e = t.get(r);
						e && n.add(e[0]);
					}
					let i = `The current model class (${t}) is not compatible with \`.generate()\`, as it doesn't have a language model head.`;
					throw n.size > 0 && (i += ` Please use the following class instead: ${[...n].join(", ")}`), Error(i);
				}
			}
			prepare_inputs_for_generation(...e) {
				return this._prepare_inputs_for_generation(this, ...e);
			}
			_update_model_kwargs_for_generation({ generated_input_ids: e, outputs: t, model_inputs: n, is_encoder_decoder: r }) {
				return n.past_key_values = this.getPastKeyValues(t, n.past_key_values), n.input_ids = new f.Tensor("int64", e.flat(), [e.length, 1]), r ? "decoder_attention_mask" in n : n.attention_mask = (0, f.cat)([n.attention_mask, (0, f.ones)([n.attention_mask.dims[0], 1])], 1), n.position_ids = null, n;
			}
			_prepare_model_inputs({ inputs: e, bos_token_id: t, model_kwargs: n }) {
				let r = (0, s.pick)(n, this.forward_params), i = this.main_input_name;
				if (i in r) {
					if (e) throw Error("`inputs`: {inputs}` were passed alongside {input_name} which is not allowed. Make sure to either pass {inputs} or {input_name}=...");
				} else r[i] = e;
				return {
					inputs_tensor: r[i],
					model_inputs: r,
					model_input_name: i
				};
			}
			async _prepare_encoder_decoder_kwargs_for_generation({ inputs_tensor: e, model_inputs: t, model_input_name: n, generation_config: r }) {
				if (this.sessions.model.inputNames.includes("inputs_embeds") && !t.inputs_embeds && "_prepare_inputs_embeds" in this) {
					let { input_ids: e, pixel_values: n, attention_mask: r, ...i } = t, a = await this._prepare_inputs_embeds(t);
					t = {
						...i,
						...(0, s.pick)(a, ["inputs_embeds", "attention_mask"])
					};
				}
				let { last_hidden_state: i } = await j(this, t);
				if (r.guidance_scale !== null && r.guidance_scale > 1) i = (0, f.cat)([i, (0, f.full_like)(i, 0)], 0), "attention_mask" in t && (t.attention_mask = (0, f.cat)([t.attention_mask, (0, f.zeros_like)(t.attention_mask)], 0));
				else if (t.decoder_input_ids) {
					let e = A(t.decoder_input_ids).dims[0];
					if (e !== i.dims[0]) {
						if (i.dims[0] !== 1) throw Error(`The encoder outputs have a different batch size (${i.dims[0]}) than the decoder inputs (${e}).`);
						i = (0, f.cat)(Array.from({ length: e }, () => i), 0);
					}
				}
				return t.encoder_outputs = i, t;
			}
			_prepare_decoder_input_ids_for_generation({ batch_size: e, model_input_name: t, model_kwargs: n, decoder_start_token_id: r, bos_token_id: i, generation_config: a }) {
				let { decoder_input_ids: o, ...s } = n;
				if (!(o instanceof f.Tensor)) {
					if (o) Array.isArray(o[0]) || (o = Array.from({ length: e }, () => o));
					else if (r ??= i, this.config.model_type === "musicgen") o = Array.from({ length: e * this.config.decoder.num_codebooks }, () => [r]);
					else if (Array.isArray(r)) {
						if (r.length !== e) throw Error(`\`decoder_start_token_id\` expcted to have length ${e} but got ${r.length}`);
						o = r;
					} else o = Array.from({ length: e }, () => [r]);
					o = A(o);
				}
				return n.decoder_attention_mask = (0, f.ones_like)(o), {
					input_ids: o,
					model_inputs: s
				};
			}
			async generate({ inputs: e = null, generation_config: t = null, logits_processor: n = null, stopping_criteria: r = null, streamer: i = null, ...a }) {
				this._validate_model_class(), t = this._prepare_generation_config(t, a);
				let { inputs_tensor: o, model_inputs: s, model_input_name: c } = this._prepare_model_inputs({
					inputs: e,
					model_kwargs: a
				}), l = this.config.is_encoder_decoder;
				l && ("encoder_outputs" in s || (s = await this._prepare_encoder_decoder_kwargs_for_generation({
					inputs_tensor: o,
					model_inputs: s,
					model_input_name: c,
					generation_config: t
				})));
				let u;
				l ? {input_ids: u, model_inputs: s} = this._prepare_decoder_input_ids_for_generation({
					batch_size: s[c].dims.at(0),
					model_input_name: c,
					model_kwargs: s,
					decoder_start_token_id: t.decoder_start_token_id,
					bos_token_id: t.bos_token_id,
					generation_config: t
				}) : u = s[c];
				let d = u.dims.at(-1);
				t.max_new_tokens !== null && (t.max_length = d + t.max_new_tokens);
				let p = this._get_logits_processor(t, d, n), m = this._get_stopping_criteria(t, r), h = s[c].dims.at(0), _ = g.LogitsSampler.getSampler(t), v = Array(h).fill(0), y = u.tolist();
				i && i.put(y);
				let b, x = {};
				for (;;) {
					if (s = this.prepare_inputs_for_generation(y, s, t), b = await this.forward(s), t.output_attentions && t.return_dict_in_generate) {
						let e = this.getAttentions(b);
						for (let t in e) t in x || (x[t] = []), x[t].push(e[t]);
					}
					let e = p(y, b.logits.slice(null, -1, null)), n = [];
					for (let t = 0; t < e.dims.at(0); ++t) {
						let r = e[t], i = await _(r);
						for (let [e, r] of i) {
							let i = BigInt(e);
							v[t] += r, y[t].push(i), n.push([i]);
							break;
						}
					}
					if (i && i.put(n), m(y).every((e) => e)) break;
					s = this._update_model_kwargs_for_generation({
						generated_input_ids: n,
						outputs: b,
						model_inputs: s,
						is_encoder_decoder: l
					});
				}
				i && i.end();
				let S = this.getPastKeyValues(b, s.past_key_values, !0), C = new f.Tensor("int64", y.flat(), [y.length, y[0].length]);
				if (t.return_dict_in_generate) return {
					sequences: C,
					past_key_values: S,
					...x
				};
				for (let e of Object.values(b)) e.location === "gpu-buffer" && e.dispose();
				return C;
			}
			getPastKeyValues(e, t, n = !1) {
				let r = Object.create(null);
				for (let i in e) if (i.startsWith("present")) {
					let a = i.replace("present_conv", "past_conv").replace("present", "past_key_values"), o = i.includes("encoder");
					if (r[a] = o && t ? t[a] : e[i], t && (!o || n)) {
						let e = t[a];
						e.location === "gpu-buffer" && e.dispose();
					}
				}
				return r;
			}
			getAttentions(e) {
				let t = {};
				for (let n of [
					"cross_attentions",
					"encoder_attentions",
					"decoder_attentions"
				]) for (let r in e) r.startsWith(n) && (n in t || (t[n] = []), t[n].push(e[r]));
				return t;
			}
			addPastKeyValues(e, t) {
				if (t) Object.assign(e, t);
				else {
					let t = this.sessions.decoder_model_merged ?? this.sessions.model, n = (e[this.main_input_name] ?? e.attention_mask)?.dims?.[0] ?? 1, i = t?.config?.kv_cache_dtype ?? "float32", a = i === "float16" ? f.DataTypeMap.float16 : f.DataTypeMap.float32, o = (0, r.getCacheShapes)(this.config, { batch_size: n });
					for (let t in o) {
						let n = o[t].reduce((e, t) => e * t, 1);
						e[t] = new f.Tensor(i, new a(n), o[t]);
					}
				}
			}
			async encode_image({ pixel_values: e }) {
				return (await O(this.sessions.vision_encoder, { pixel_values: e })).image_features;
			}
			async encode_text({ input_ids: e }) {
				return (await O(this.sessions.embed_tokens, { input_ids: e })).inputs_embeds;
			}
			async encode_audio({ audio_values: e }) {
				return (await O(this.sessions.audio_encoder, { audio_values: e })).audio_features;
			}
		}
		class le {}
		class ue extends le {
			constructor({ last_hidden_state: e, hidden_states: t = null, attentions: n = null }) {
				super(), this.last_hidden_state = e, this.hidden_states = t, this.attentions = n;
			}
		}
		class de extends z {}
		class fe extends de {}
		class B extends de {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class V extends de {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class H extends de {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class U extends de {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class W extends z {}
		class pe extends W {}
		class G extends W {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class me extends W {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class K extends W {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class he extends W {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class q extends z {}
		class ge extends q {}
		class _e extends q {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class ve extends q {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class ye extends q {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class be extends z {}
		class xe extends be {}
		class Se extends be {}
		class Ce extends z {}
		class we extends Ce {}
		class Te extends z {}
		class Ee extends Te {}
		class De extends Te {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class Oe extends Te {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class ke extends Te {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class Ae extends Te {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class je extends z {}
		class Me extends je {}
		class J extends je {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class Ne extends je {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Pe extends je {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class Fe extends je {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class Ie extends z {}
		class Y extends Ie {}
		class Le extends Ie {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class Re extends Ie {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class ze extends Ie {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class Be extends Ie {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class Ve extends z {}
		class He extends Ve {}
		class Ue extends Ve {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class We extends Ve {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Ge extends Ve {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class Ke extends Ve {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class qe extends z {}
		class Je extends qe {}
		class Ye extends qe {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class Xe extends qe {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Ze extends qe {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class Qe extends qe {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class $e extends z {}
		class et extends $e {}
		class tt extends $e {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class nt extends $e {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class rt extends $e {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class it extends $e {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class at extends z {}
		class ot extends at {}
		class st extends at {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class ct extends at {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class lt extends at {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class ut extends at {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class dt extends z {}
		class ft extends dt {}
		class pt extends dt {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class mt extends dt {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class ht extends dt {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class gt extends z {}
		class _t extends gt {}
		class vt extends gt {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class yt extends gt {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class bt extends gt {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class xt extends z {}
		class St extends xt {}
		class Ct extends xt {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class wt extends xt {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Tt extends xt {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class Et extends xt {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class Dt extends z {}
		class Ot extends Dt {}
		class kt extends Dt {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class At extends Dt {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class jt extends Dt {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class Mt extends z {}
		class Nt extends Mt {}
		class Pt extends Mt {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Ft extends Mt {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class It extends Mt {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class Lt extends z {
			forward_params = [
				"input_ids",
				"attention_mask",
				"encoder_outputs",
				"decoder_input_ids",
				"decoder_attention_mask",
				"past_key_values"
			];
		}
		class Rt extends Lt {}
		class zt extends Lt {}
		class Bt extends z {}
		class Vt extends Bt {}
		class Ht extends Bt {}
		class Ut extends z {}
		class Wt extends Ut {}
		class Gt extends Ut {}
		class Kt extends z {}
		class qt extends Kt {}
		class Jt extends Kt {}
		class Yt extends Kt {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Xt extends z {}
		class Zt extends Xt {}
		class Qt extends Xt {}
		class $t extends Xt {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class en extends Xt {}
		class tn extends z {}
		class nn extends tn {}
		class rn extends tn {}
		class an extends z {}
		class on extends an {}
		class sn extends an {}
		class cn extends z {}
		class X extends cn {}
		class Z extends cn {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class ln extends cn {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class un extends cn {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class dn extends cn {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class fn extends z {}
		class pn extends fn {}
		class mn extends fn {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class hn extends fn {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class gn extends fn {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class _n extends fn {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class vn extends z {}
		class yn extends vn {}
		class bn extends vn {
			async _call(e) {
				return new Md(await super._call(e));
			}
		}
		class xn extends vn {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Sn extends vn {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class Cn extends vn {
			async _call(e) {
				return new Nd(await super._call(e));
			}
		}
		class wn extends z {}
		class Tn extends wn {}
		class En extends wn {}
		class Dn extends z {
			requires_attention_mask = !1;
			main_input_name = "input_features";
			forward_params = [
				"input_features",
				"attention_mask",
				"decoder_input_ids",
				"decoder_attention_mask",
				"past_key_values"
			];
		}
		class On extends Dn {}
		class kn extends Dn {
			_prepare_generation_config(e, t) {
				return super._prepare_generation_config(e, t, v.WhisperGenerationConfig);
			}
			_retrieve_init_tokens(e) {
				let t = [e.decoder_start_token_id], n = e.language, r = e.task;
				if (e.is_multilingual) {
					n ||= (console.warn("No language specified - defaulting to English (en)."), "en");
					let i = `<|${(0, y.whisper_language_to_code)(n)}|>`;
					t.push(e.lang_to_id[i]), t.push(e.task_to_id[r ?? "transcribe"]);
				} else if (n || r) throw Error("Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config.");
				return !e.return_timestamps && e.no_timestamps_token_id && t.at(-1) !== e.no_timestamps_token_id ? t.push(e.no_timestamps_token_id) : e.return_timestamps && t.at(-1) === e.no_timestamps_token_id && (console.warn("<|notimestamps|> prompt token is removed from generation_config since `return_timestamps` is set to `true`."), t.pop()), t.filter((e) => e != null);
			}
			async generate({ inputs: e = null, generation_config: t = null, logits_processor: n = null, stopping_criteria: r = null, ...i }) {
				t = this._prepare_generation_config(t, i);
				let a = i.decoder_input_ids ?? this._retrieve_init_tokens(t);
				if (t.return_timestamps && (n ??= new u.LogitsProcessorList(), n.push(new u.WhisperTimeStampLogitsProcessor(t, a))), t.begin_suppress_tokens && (n ??= new u.LogitsProcessorList(), n.push(new u.SuppressTokensAtBeginLogitsProcessor(t.begin_suppress_tokens, a.length))), t.return_token_timestamps) {
					if (!t.alignment_heads) throw Error("Model generation config has no `alignment_heads`, token-level timestamps not available. See https://gist.github.com/hollance/42e32852f24243b748ae6bc1f985b13a on how to add this property to the generation config.");
					t.task === "translate" && console.warn("Token-level timestamps may not be reliable for task 'translate'."), t.output_attentions = !0, t.return_dict_in_generate = !0;
				}
				let o = await super.generate({
					inputs: e,
					generation_config: t,
					logits_processor: n,
					decoder_input_ids: a,
					...i
				});
				return t.return_token_timestamps && (o.token_timestamps = this._extract_token_timestamps(o, t.alignment_heads, t.num_frames)), o;
			}
			_extract_token_timestamps(e, t, n = null, r = .02) {
				if (!e.cross_attentions) throw Error("Model outputs must contain cross attentions to extract timestamps. This is most likely because the model was not exported with `output_attentions=True`.");
				n ?? console.warn("`num_frames` has not been set, meaning the entire audio will be analyzed. This may lead to inaccurate token-level timestamps for short audios (< 30 seconds).");
				let i = this.config.median_filter_width;
				i === void 0 && (console.warn("Model config has no `median_filter_width`, using default value of 7."), i = 7);
				let a = e.cross_attentions, o = Array.from({ length: this.config.decoder_layers }, (e, t) => (0, f.cat)(a.map((e) => e[t]), 2)), c = (0, f.stack)(t.map(([e, t]) => {
					if (e >= o.length) throw Error(`Layer index ${e} is out of bounds for cross attentions (length ${o.length}).`);
					return n ? o[e].slice(null, t, null, [0, n]) : o[e].slice(null, t);
				})).transpose(1, 0, 2, 3), [l, u] = (0, f.std_mean)(c, -2, 0, !0), d = c.clone();
				for (let e = 0; e < d.dims[0]; ++e) {
					let t = d[e];
					for (let n = 0; n < t.dims[0]; ++n) {
						let r = t[n], a = l[e][n][0].data, o = u[e][n][0].data;
						for (let e = 0; e < r.dims[0]; ++e) {
							let t = r[e].data;
							for (let e = 0; e < t.length; ++e) t[e] = (t[e] - o[e]) / a[e];
							t.set((0, m.medianFilter)(t, i));
						}
					}
				}
				let p = [(0, f.mean)(d, 1)], h = e.sequences.dims, g = new f.Tensor("float32", new Float32Array(h[0] * h[1]), h);
				for (let e = 0; e < h[0]; ++e) {
					let t = p[e].neg().squeeze_(0), [n, i] = (0, m.dynamic_time_warping)(t.tolist()), a = Array.from({ length: n.length - 1 }, (e, t) => n[t + 1] - n[t]), o = (0, s.mergeArrays)([1], a).map((e) => !!e), c = [];
					for (let e = 0; e < o.length; ++e) o[e] && c.push(i[e] * r);
					g[e].data.set(c, 1);
				}
				return g;
			}
		}
		class An extends kn {}
		class jn extends z {
			requires_attention_mask = !1;
			main_input_name = "input_values";
			forward_params = [
				"input_values",
				"decoder_input_ids",
				"past_key_values"
			];
		}
		class Mn extends jn {}
		class Nn extends jn {}
		class Pn extends z {
			main_input_name = "pixel_values";
			forward_params = [
				"pixel_values",
				"decoder_input_ids",
				"encoder_hidden_states",
				"past_key_values"
			];
		}
		class Fn extends z {
			forward_params = [
				"input_ids",
				"attention_mask",
				"pixel_values",
				"position_ids",
				"past_key_values"
			];
		}
		class In extends Fn {
			_merge_input_ids_with_image_features(e) {
				let t = e.image_features.dims.at(-1), n = e.image_features.view(-1, t);
				return P({
					image_token_id: this.config.image_token_index,
					...e,
					image_features: n
				});
			}
		}
		class Ln extends In {}
		class Rn extends In {}
		class zn extends z {
			forward_params = [
				"input_ids",
				"inputs_embeds",
				"attention_mask",
				"pixel_values",
				"encoder_outputs",
				"decoder_input_ids",
				"decoder_inputs_embeds",
				"decoder_attention_mask",
				"past_key_values"
			];
			main_input_name = "inputs_embeds";
		}
		class Bn extends zn {
			_merge_input_ids_with_image_features({ inputs_embeds: e, image_features: t, input_ids: n, attention_mask: r }) {
				return {
					inputs_embeds: (0, f.cat)([t, e], 1),
					attention_mask: (0, f.cat)([(0, f.ones)(t.dims.slice(0, 2)), r], 1)
				};
			}
			async _prepare_inputs_embeds({ input_ids: e, pixel_values: t, inputs_embeds: n, attention_mask: r }) {
				if (!e && !t) throw Error("Either `input_ids` or `pixel_values` should be provided.");
				let i, a;
				return e && (i = await this.encode_text({ input_ids: e })), t && (a = await this.encode_image({ pixel_values: t })), i && a ? {inputs_embeds: n, attention_mask: r} = this._merge_input_ids_with_image_features({
					inputs_embeds: i,
					image_features: a,
					input_ids: e,
					attention_mask: r
				}) : n = i || a, {
					inputs_embeds: n,
					attention_mask: r
				};
			}
			async forward({ input_ids: e, pixel_values: t, attention_mask: n, decoder_input_ids: r, decoder_attention_mask: i, encoder_outputs: a, past_key_values: o, inputs_embeds: s, decoder_inputs_embeds: c }) {
				if (s || ({inputs_embeds: s, attention_mask: n} = await this._prepare_inputs_embeds({
					input_ids: e,
					pixel_values: t,
					inputs_embeds: s,
					attention_mask: n
				})), !a) {
					let { last_hidden_state: e } = await j(this, {
						inputs_embeds: s,
						attention_mask: n
					});
					a = e;
				}
				if (!c) {
					if (!r) throw Error("Either `decoder_input_ids` or `decoder_inputs_embeds` should be provided.");
					c = await this.encode_text({ input_ids: r });
				}
				let l = {
					inputs_embeds: c,
					attention_mask: i,
					encoder_attention_mask: n,
					encoder_hidden_states: a,
					past_key_values: o
				};
				return await N(this, l, !0);
			}
		}
		class Vn extends z {
			forward_params = [
				"input_ids",
				"attention_mask",
				"pixel_values",
				"position_ids",
				"past_key_values"
			];
		}
		class Hn extends Vn {
			_merge_input_ids_with_image_features(e) {
				let t = e.image_features.dims.at(-1), n = e.image_features.view(-1, t);
				return P({
					image_token_id: this.config.image_token_index,
					...e,
					image_features: n
				});
			}
		}
		class Un extends Fn {
			_merge_input_ids_with_image_features(e) {
				let t = e.image_features.dims.at(-1), n = e.image_features.view(-1, t);
				return P({
					image_token_id: this.config.image_token_index,
					...e,
					image_features: n
				});
			}
		}
		class Wn extends Un {}
		class Gn extends z {
			forward_params = [
				"input_ids",
				"attention_mask",
				"inputs_embeds",
				"per_layer_inputs",
				"position_ids",
				"pixel_values",
				"input_features",
				"input_features_mask",
				"past_key_values"
			];
		}
		class Kn extends Gn {
			async forward({ input_ids: e = null, attention_mask: t = null, pixel_values: n = null, input_features: r = null, input_features_mask: i = null, position_ids: a = null, inputs_embeds: o = null, per_layer_inputs: s = null, past_key_values: c = null, generation_config: l = null, logits_processor: u = null, ...d }) {
				if ((!o || !s) && ({inputs_embeds: o, per_layer_inputs: s} = await O(this.sessions.embed_tokens, { input_ids: e }), e.dims[1] !== 1)) {
					if (n) {
						let { image_features: r } = await O(this.sessions.vision_encoder, { pixel_values: n });
						({inputs_embeds: o, attention_mask: t} = this._merge_input_ids_with_image_features({
							image_features: r,
							inputs_embeds: o,
							input_ids: e,
							attention_mask: t
						}));
					}
					if (r) {
						let { audio_features: n } = await O(this.sessions.audio_encoder, {
							input_features: r,
							input_features_mask: i
						});
						({inputs_embeds: o, attention_mask: t} = this._merge_input_ids_with_audio_features({
							audio_features: n,
							inputs_embeds: o,
							input_ids: e,
							attention_mask: t
						}));
					}
				}
				return await N(this, {
					inputs_embeds: o,
					per_layer_inputs: s,
					past_key_values: c,
					attention_mask: t,
					position_ids: a,
					generation_config: l,
					logits_processor: u
				}, !0);
			}
			_merge_input_ids_with_image_features(e) {
				let t = e.image_features.dims.at(-1), n = e.image_features.view(-1, t);
				return P({
					image_token_id: this.config.image_token_id,
					...e,
					image_features: n
				});
			}
			_merge_input_ids_with_audio_features(e) {
				let t = e.audio_features.dims.at(-1), n = e.audio_features.view(-1, t);
				return F({
					audio_token_id: this.config.audio_token_id,
					...e,
					audio_features: n
				});
			}
		}
		class qn extends z {
			forward_params = [
				"input_ids",
				"attention_mask",
				"pixel_values",
				"pixel_attention_mask",
				"position_ids",
				"past_key_values"
			];
		}
		class Jn extends qn {
			async encode_image({ pixel_values: e, pixel_attention_mask: t }) {
				return (await O(this.sessions.vision_encoder, {
					pixel_values: e,
					pixel_attention_mask: t
				})).image_features;
			}
			_merge_input_ids_with_image_features(e) {
				let t = e.image_features.dims.at(-1), n = e.image_features.view(-1, t);
				return P({
					image_token_id: this.config.image_token_id,
					...e,
					image_features: n
				});
			}
		}
		class Yn extends Jn {}
		class Xn extends z {
			forward_params = [
				"input_ids",
				"inputs_embeds",
				"attention_mask",
				"position_ids",
				"pixel_values",
				"image_sizes",
				"past_key_values"
			];
		}
		class Zn extends Xn {
			async forward({ input_ids: e = null, attention_mask: t = null, pixel_values: n = null, image_sizes: r = null, position_ids: i = null, inputs_embeds: a = null, past_key_values: o = null, generation_config: s = null, logits_processor: c = null, ...l }) {
				if (!a) {
					let t;
					if (n && e.dims[1] !== 1) {
						if (!r) throw Error("`image_sizes` must be provided when `pixel_values` is provided.");
						({image_features: t} = await O(this.sessions.vision_encoder, {
							pixel_values: n,
							image_sizes: r
						}));
					} else {
						let e = this.config.normalized_config.hidden_size;
						t = new f.Tensor("float32", [], [0, e]);
					}
					({inputs_embeds: a} = await O(this.sessions.prepare_inputs_embeds, {
						input_ids: e,
						image_features: t
					}));
				}
				return await N(this, {
					inputs_embeds: a,
					past_key_values: o,
					attention_mask: t,
					position_ids: i,
					generation_config: s,
					logits_processor: c
				}, !1);
			}
		}
		class Qn extends z {}
		class $n extends Qn {}
		class er extends Qn {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "text_model"
				});
			}
		}
		class tr extends Qn {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "text_model"
				});
			}
		}
		class nr extends Qn {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "vision_model"
				});
			}
		}
		class rr extends Qn {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "vision_model"
				});
			}
		}
		class ir extends z {}
		class ar extends ir {}
		class or extends ir {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "text_model"
				});
			}
		}
		class sr extends Qn {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "vision_model"
				});
			}
		}
		class cr extends z {}
		class lr extends cr {}
		class ur extends z {}
		class dr extends ur {
			async forward(e) {
				let t = !e.input_ids, n = !e.pixel_values;
				if (t && n) throw Error("Either `input_ids` or `pixel_values` should be provided.");
				if (t && (e.input_ids = (0, f.ones)([e.pixel_values.dims[0], 1])), n) {
					let { image_size: t } = this.config.vision_config;
					e.pixel_values = (0, f.full)([
						0,
						3,
						t,
						t
					], 0);
				}
				let { text_embeddings: r, image_embeddings: i, l2norm_text_embeddings: a, l2norm_image_embeddings: o } = await super.forward(e), s = {};
				return t || (s.text_embeddings = r, s.l2norm_text_embeddings = a), n || (s.image_embeddings = i, s.l2norm_image_embeddings = o), s;
			}
		}
		class fr extends ur {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "text_model"
				});
			}
		}
		class pr extends ur {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "vision_model"
				});
			}
		}
		class mr extends z {}
		class hr extends mr {}
		class gr extends mr {}
		class _r extends z {}
		class vr extends _r {}
		class yr extends _r {}
		class br extends z {}
		class xr extends br {}
		class Sr extends br {}
		class Cr extends z {}
		class wr extends Cr {}
		class Tr extends Cr {}
		class Er extends z {}
		class Dr extends Er {}
		class Or extends Er {}
		class kr extends z {}
		class Ar extends kr {}
		class jr extends kr {}
		class Mr extends z {}
		class Nr extends Mr {}
		class Pr extends Mr {}
		class Fr extends z {}
		class Ir extends Fr {}
		class Lr extends Fr {}
		class Rr extends z {}
		class zr extends Rr {}
		class Br extends Rr {}
		class Vr extends z {}
		class Hr extends Vr {}
		class Ur extends z {}
		class Wr extends Ur {}
		class Gr extends Ur {}
		class Kr extends z {}
		class qr extends Kr {}
		class Jr extends Kr {}
		class Yr extends z {}
		class Xr extends Yr {}
		class Zr extends Yr {}
		class Qr extends z {}
		class $r extends Qr {}
		class ei extends Qr {}
		class ti extends z {}
		class ni extends ti {}
		class ri extends ti {}
		class ii extends z {}
		class ai extends ii {}
		class oi extends ii {}
		class si extends z {}
		class ci extends si {}
		class li extends si {}
		class ui extends z {}
		class di extends ui {}
		class fi extends ui {}
		class pi extends z {}
		class mi extends pi {}
		class hi extends pi {}
		class gi extends z {}
		class _i extends gi {}
		class vi extends gi {}
		class yi extends z {}
		class bi extends yi {}
		class xi extends yi {}
		class Si extends z {}
		class Ci extends Si {}
		class wi extends Si {}
		class Ti extends z {}
		class Ei extends Ti {}
		class Di extends Ti {}
		class Oi extends z {}
		class ki extends Oi {}
		class Ai extends Oi {}
		class ji extends z {}
		class Mi extends ji {}
		class Ni extends ji {}
		class Pi extends z {}
		class Fi extends Pi {}
		class Ii extends Pi {}
		class Li extends z {}
		class Ri extends Li {}
		class zi extends Li {}
		class Bi extends z {}
		class Vi extends Bi {}
		class Hi extends Bi {}
		class Ui extends z {}
		class Wi extends Ui {}
		class Gi extends Ui {}
		class Ki extends z {}
		class qi extends Ki {}
		class Ji extends Ki {}
		class Yi extends z {
			forward_params = [
				"input_ids",
				"attention_mask",
				"position_ids",
				"past_key_values",
				"pixel_values",
				"image_grid_thw"
			];
		}
		class Xi extends Yi {
			get_rope_index(e, t, n, r) {
				let { vision_config: i, image_token_id: a, video_token_id: o, vision_start_token_id: s } = this.config, c = i.spatial_merge_size ?? 2, l = [];
				if (t || n) {
					let i = e.tolist();
					r ||= (0, f.ones_like)(e);
					let u = r.tolist(), d = Array.from({ length: 3 }, (t) => Array.from({ length: e.dims[0] }, (t) => Array.from({ length: e.dims[1] }, (e) => 1))), p = t ? t.tolist() : [], h = n ? n.tolist() : [], g = 0, _ = 0;
					for (let e = 0; e < i.length; ++e) {
						let t = i[e].filter((t, n) => u[e][n] == 1), n = t.reduce((e, t, n) => (t == s && e.push(n), e), []).map((e) => t[e + 1]), r = n.filter((e) => e == a).length, f = n.filter((e) => e == o).length, v = [], y = 0, b = r, x = f;
						for (let e = 0; e < n.length; ++e) {
							let e = t.findIndex((e, t) => t > y && e == a), n = t.findIndex((e, t) => t > y && e == o), r = b > 0 && e !== -1 ? e : t.length + 1, i = x > 0 && n !== -1 ? n : t.length + 1, s, l, u, d;
							r < i ? ([l, u, d] = p[g], ++g, --b, s = r) : ([l, u, d] = h[_], ++_, --x, s = i);
							let [f, S, C] = [
								Number(l),
								Math.floor(Number(u) / c),
								Math.floor(Number(d) / c)
							], w = s - y, T = v.length > 0 ? (0, m.max)(v.at(-1))[0] + 1 : 0;
							v.push(Array.from({ length: 3 * w }, (e, t) => T + t % w));
							let E = w + T, D = f * S * C, O = Array.from({ length: D }, (e, t) => E + Math.floor(t / (S * C))), k = Array.from({ length: D }, (e, t) => E + Math.floor(t / C) % S), A = Array.from({ length: D }, (e, t) => E + t % C);
							v.push([
								O,
								k,
								A
							].flat()), y = s + D;
						}
						if (y < t.length) {
							let e = v.length > 0 ? (0, m.max)(v.at(-1))[0] + 1 : 0, n = t.length - y;
							v.push(Array.from({ length: 3 * n }, (t, r) => e + r % n));
						}
						let S = v.reduce((e, t) => e + t.length, 0), C = Array(S), w = 0;
						for (let e = 0; e < 3; ++e) for (let t = 0; t < v.length; ++t) {
							let n = v[t], r = n.length / 3;
							for (let t = e * r; t < (e + 1) * r; ++t) C[w++] = n[t];
						}
						let T = 0, E = u[e];
						for (let t = 0; t < E.length; ++t) if (E[t] == 1) {
							for (let n = 0; n < 3; ++n) d[n][e][t] = C[n * S / 3 + T];
							++T;
						}
						let D = (0, m.max)(C)[0];
						l.push(D + 1 - i[e].length);
					}
					return [new f.Tensor("int64", d.flat(Infinity), [
						3,
						e.dims[0],
						e.dims[1]
					]), new f.Tensor("int64", l, [l.length, 1])];
				}
				if (r) {
					let { data: e, dims: t } = L(r), n = BigInt64Array.from({ length: 3 * e.length }, (t, n) => e[n % e.length]), i = Array.from({ length: t[0] }, (n, r) => (0, m.max)(e.subarray(t[1] * r, t[1] * (r + 1)))[0] + 1n + BigInt(t[1]));
					return [new f.Tensor("int64", n, [3, ...t]), new f.Tensor("int64", i, [i.length, 1])];
				}
				{
					let [t, n] = e.dims, r = BigInt64Array.from({ length: 3 * t * n }, (e, r) => BigInt(Math.floor(r % n / t)));
					return [new f.Tensor("int64", r, [3, ...e.dims]), (0, f.zeros)([t, 1])];
				}
			}
			async encode_image({ pixel_values: e, image_grid_thw: t }) {
				return (await O(this.sessions.vision_encoder, {
					pixel_values: e,
					grid_thw: t
				})).image_features;
			}
			_merge_input_ids_with_image_features(e) {
				return P({
					image_token_id: this.config.image_token_id,
					...e
				});
			}
			prepare_inputs_for_generation(e, t, n) {
				if (t.attention_mask && !t.position_ids) {
					if (!t.past_key_values) [t.position_ids, t.rope_deltas] = this.get_rope_index(t.input_ids, t.image_grid_thw, t.video_grid_thw, t.attention_mask);
					else {
						t.pixel_values = null;
						let e = BigInt(Object.values(t.past_key_values)[0].dims.at(-2)), n = t.rope_deltas.map((t) => e + t);
						t.position_ids = (0, f.stack)([
							n,
							n,
							n
						], 0);
					}
				}
				return t;
			}
		}
		class Zi extends z {}
		class Qi extends Zi {}
		class $i extends Zi {}
		class ea extends z {}
		class ta extends ea {}
		class na extends ea {}
		class ra extends z {}
		class ia extends ra {}
		class aa extends ra {}
		class oa extends z {}
		class sa extends oa {}
		class ca extends oa {}
		class la extends z {}
		class ua extends la {}
		class da extends la {}
		class fa extends z {}
		class pa extends fa {}
		class ma extends fa {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class ha extends z {}
		class ga extends ha {}
		class _a extends ha {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class va extends z {}
		class ya extends va {}
		class ba extends z {}
		class xa extends ba {}
		class Sa extends ba {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Ca extends z {}
		class wa extends Ca {}
		class Ta extends z {}
		class Ea extends Ta {}
		class Da extends Ta {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Oa extends z {}
		class ka extends Oa {}
		class Aa extends z {}
		class ja extends Aa {}
		class Ma extends Aa {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Na extends z {}
		class Pa extends Na {
			async _call(e) {
				return new Id(await super._call(e));
			}
		}
		class Fa extends z {}
		class Ia extends Fa {}
		class La extends Fa {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Ra extends z {}
		class za extends Ra {}
		class Ba extends Ra {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Va extends z {}
		class Ha extends Va {}
		class Ua extends Va {}
		class Wa extends z {}
		class Ga extends Wa {}
		class Ka extends Wa {}
		class qa extends z {}
		class Ja extends qa {}
		class Ya extends qa {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Xa extends z {}
		class Za extends Xa {}
		class Qa extends Xa {
			async _call(e) {
				return new eo(await super._call(e));
			}
		}
		class $a extends Xa {
			async _call(e) {
				return new to(await super._call(e));
			}
		}
		class eo extends le {
			constructor({ logits: e, pred_boxes: t }) {
				super(), this.logits = e, this.pred_boxes = t;
			}
		}
		class to extends le {
			constructor({ logits: e, pred_boxes: t, pred_masks: n }) {
				super(), this.logits = e, this.pred_boxes = t, this.pred_masks = n;
			}
		}
		class no extends z {}
		class ro extends no {}
		class io extends no {
			async _call(e) {
				return new ao(await super._call(e));
			}
		}
		class ao extends le {
			constructor({ logits: e, pred_boxes: t }) {
				super(), this.logits = e, this.pred_boxes = t;
			}
		}
		class oo extends z {}
		class so extends oo {}
		class co extends oo {
			async _call(e) {
				return new lo(await super._call(e));
			}
		}
		class lo extends ao {}
		class uo extends z {}
		class fo extends uo {}
		class po extends uo {
			async _call(e) {
				return new mo(await super._call(e));
			}
		}
		class mo extends ao {}
		class ho extends z {}
		class go extends ho {}
		class _o extends ho {
			async _call(e) {
				return new ao(await super._call(e));
			}
		}
		class vo extends z {}
		class yo extends vo {}
		class bo extends vo {
			async _call(e) {
				return new xo(await super._call(e));
			}
		}
		class xo extends eo {}
		class So extends z {}
		class Co extends So {}
		class wo extends So {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class To extends z {}
		class Eo extends To {}
		class Do extends To {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Oo extends z {}
		class ko extends Oo {}
		class Ao extends Oo {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class jo extends z {}
		class Mo extends jo {}
		class No extends jo {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Po extends jo {}
		class Fo extends z {}
		class Io extends Fo {}
		class Lo extends Fo {}
		class Ro extends z {}
		class zo extends Ro {}
		class Bo extends Ro {}
		class Vo extends z {}
		class Ho extends Vo {}
		class Uo extends z {}
		class Wo extends Uo {}
		class Go extends Uo {}
		class Ko extends Uo {}
		class qo extends z {}
		class Jo extends qo {}
		class Yo extends z {}
		class Xo extends Yo {}
		class Zo extends z {}
		class Qo extends Zo {}
		class $o extends z {}
		class es extends $o {}
		class ts extends $o {}
		class ns extends z {}
		class rs extends ns {}
		class is extends ns {}
		class as extends z {}
		class os extends as {}
		class ss extends z {}
		class cs extends ss {}
		class ls extends ss {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class us extends z {}
		class ds extends us {}
		class fs extends us {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class ps extends z {}
		class ms extends ps {}
		class hs extends ps {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class gs extends z {}
		class _s extends gs {}
		class vs extends gs {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class ys extends z {}
		class bs extends ys {}
		class xs extends z {}
		class Ss extends xs {}
		class Cs extends z {}
		class ws extends Cs {}
		class Ts extends z {}
		class Es extends Ts {}
		class Ds extends Ts {
			async _call(e) {
				return new Os(await super._call(e));
			}
		}
		class Os extends le {
			constructor({ logits: e, pred_boxes: t }) {
				super(), this.logits = e, this.pred_boxes = t;
			}
		}
		class ks extends z {}
		class As extends ks {
			async get_image_embeddings({ pixel_values: e }) {
				return await j(this, { pixel_values: e });
			}
			async forward(e) {
				e = !e.image_embeddings || !e.image_positional_embeddings ? {
					...e,
					...await this.get_image_embeddings(e)
				} : { ...e }, e.input_labels ??= (0, f.ones)(e.input_points.dims.slice(0, -1));
				let t = {
					image_embeddings: e.image_embeddings,
					image_positional_embeddings: e.image_positional_embeddings
				};
				return e.input_points && (t.input_points = e.input_points), e.input_labels && (t.input_labels = e.input_labels), e.input_boxes && (t.input_boxes = e.input_boxes), await O(this.sessions.prompt_encoder_mask_decoder, t);
			}
			async _call(e) {
				return new js(await super._call(e));
			}
		}
		class js extends le {
			constructor({ iou_scores: e, pred_masks: t }) {
				super(), this.iou_scores = e, this.pred_masks = t;
			}
		}
		class Ms extends le {
			constructor({ iou_scores: e, pred_masks: t, object_score_logits: n }) {
				super(), this.iou_scores = e, this.pred_masks = t, this.object_score_logits = n;
			}
		}
		class Ns extends z {}
		class Ps extends Ns {
			async get_image_embeddings({ pixel_values: e }) {
				return await j(this, { pixel_values: e });
			}
			async forward(e) {
				let { num_feature_levels: t } = this.config.vision_config;
				if (e = Array.from({ length: t }, (e, t) => `image_embeddings.${t}`).some((t) => !e[t]) ? {
					...e,
					...await this.get_image_embeddings(e)
				} : { ...e }, e.input_points) {
					if (e.input_boxes && e.input_boxes.dims[1] !== 1) throw Error("When both `input_points` and `input_boxes` are provided, the number of boxes per image must be 1.");
					let t = e.input_points.dims;
					e.input_labels ??= (0, f.ones)(t.slice(0, -1)), e.input_boxes ??= (0, f.full)([
						t[0],
						0,
						4
					], 0);
				} else if (e.input_boxes) {
					let t = e.input_boxes.dims;
					e.input_labels = (0, f.full)([
						t[0],
						t[1],
						0
					], -1n), e.input_points = (0, f.full)([
						t[0],
						1,
						0,
						2
					], 0);
				} else throw Error("At least one of `input_points` or `input_boxes` must be provided.");
				let n = this.sessions.prompt_encoder_mask_decoder;
				return await O(n, (0, s.pick)(e, n.inputNames));
			}
			async _call(e) {
				return new Ms(await super._call(e));
			}
		}
		class Fs extends Ps {}
		class Is extends Ps {}
		class Ls extends z {}
		class Rs extends Ls {}
		class zs extends Ls {}
		class Bs extends z {}
		class Vs extends Bs {}
		class Hs extends Bs {}
		class Us extends z {}
		class Ws extends Us {}
		class Gs extends Us {
			async _call(e) {
				return new Pd(await super._call(e));
			}
		}
		class Ks extends Us {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class qs extends Us {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class Js extends z {}
		class Ys extends Js {
			async _call(e) {
				return new Pd(await super._call(e));
			}
		}
		class Xs extends z {}
		class Zs extends Xs {}
		class Qs extends Xs {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class $s extends z {}
		class ec extends $s {}
		class tc extends z {}
		class nc extends tc {}
		class rc extends tc {
			async _call(e) {
				return new Pd(await super._call(e));
			}
		}
		class ic extends tc {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class ac extends z {}
		class oc extends ac {}
		class sc extends ac {
			async _call(e) {
				return new Pd(await super._call(e));
			}
		}
		class cc extends ac {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class lc extends ac {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class uc extends z {}
		class dc extends uc {}
		class fc extends uc {
			async _call(e) {
				return new Pd(await super._call(e));
			}
		}
		class pc extends uc {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class mc extends z {}
		class hc extends Us {}
		class gc extends Us {
			async _call(e) {
				return new Pd(await super._call(e));
			}
		}
		class _c extends Us {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class vc extends z {}
		class yc extends vc {}
		class bc extends vc {
			async _call(e) {
				return new Pd(await super._call(e));
			}
		}
		class xc extends vc {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Sc extends vc {
			async _call(e) {
				return new Ad(await super._call(e));
			}
		}
		class Cc extends vc {
			async _call(e) {
				return new jd(await super._call(e));
			}
		}
		class wc extends z {}
		class Tc extends wc {}
		class Ec extends z {}
		class Dc extends Ec {}
		class Oc extends Ec {}
		class kc extends Ec {
			async generate_speech(e, t, { threshold: n = .5, minlenratio: r = 0, maxlenratio: i = 20, vocoder: a = null } = {}) {
				let o = { input_ids: e }, { encoder_outputs: s, encoder_attention_mask: c } = await j(this, o), l = s.dims[1] / this.config.reduction_factor, u = Math.floor(l * i), d = Math.floor(l * r), p = this.config.num_mel_bins, m = [], h = null, g = null, _ = 0;
				for (;;) {
					++_;
					let e = ee(!!g), r;
					r = g ? g.output_sequence_out : new f.Tensor("float32", new Float32Array(p), [
						1,
						1,
						p
					]);
					let i = {
						use_cache_branch: e,
						output_sequence: r,
						encoder_attention_mask: c,
						speaker_embeddings: t,
						encoder_hidden_states: s
					};
					this.addPastKeyValues(i, h), g = await O(this.sessions.decoder_model_merged, i), h = this.getPastKeyValues(g, h);
					let { prob: a, spectrum: o } = g;
					if (m.push(o), _ >= d && (Array.from(a.data).filter((e) => e >= n).length > 0 || _ >= u)) break;
				}
				let v = (0, f.cat)(m), { waveform: y } = await O(a.sessions.model, { spectrogram: v });
				return {
					spectrogram: v,
					waveform: y
				};
			}
		}
		class Ac extends z {
			main_input_name = "spectrogram";
		}
		class jc extends z {}
		class Mc extends jc {
			async generate_speech({ input_ids: e, attention_mask: t, style: n, num_inference_steps: r = 5, speed: i = 1.05 }) {
				let { sampling_rate: a, chunk_compress_factor: o, base_chunk_size: s, latent_dim: c } = this.config, { last_hidden_state: l, durations: u } = await O(this.sessions.text_encoder, {
					input_ids: e,
					attention_mask: t,
					style: n
				});
				u.div_(i);
				let d = u.max().item() * a, p = s * o, m = Math.floor((d + p - 1) / p), h = e.dims[0], g = (0, f.ones)([h, m]), _ = (0, f.full)([h], r), v = (0, f.randn)([
					h,
					c * o,
					m
				]);
				for (let e = 0; e < r; ++e) {
					let r = (0, f.full)([h], e);
					({denoised_latents: v} = await O(this.sessions.latent_denoiser, {
						style: n,
						noisy_latents: v,
						latent_mask: g,
						encoder_outputs: l,
						attention_mask: t,
						timestep: r,
						num_inference_steps: _
					}));
				}
				let { waveform: y } = await O(this.sessions.voice_decoder, { latents: v });
				return {
					waveform: y,
					durations: u
				};
			}
		}
		class Nc extends z {}
		class Pc extends Nc {}
		class Fc extends z {}
		class Ic extends Fc {}
		class Lc extends Fc {}
		class Rc extends z {}
		class zc extends Rc {}
		class Bc extends Rc {}
		class Vc extends z {}
		class Hc extends Vc {}
		class Uc extends Vc {}
		class Wc extends z {}
		class Gc extends Wc {}
		class Kc extends Wc {}
		class qc extends z {}
		class Jc extends qc {}
		class Yc extends qc {}
		class Xc extends z {}
		class Zc extends Xc {}
		class Qc extends Xc {}
		class $c extends z {}
		class el extends $c {}
		class tl extends $c {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "text_model"
				});
			}
		}
		class nl extends $c {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "audio_model"
				});
			}
		}
		class rl extends z {}
		class il extends rl {
			async _call(e) {
				return new Ld(await super._call(e));
			}
		}
		class al extends z {}
		class ol extends al {}
		class sl extends al {}
		class cl extends al {}
		class ll extends z {}
		class ul extends ll {}
		class dl extends ll {}
		class fl extends z {}
		class pl extends fl {}
		class ml extends fl {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class hl extends z {}
		class gl extends hl {}
		class _l extends hl {}
		class vl extends z {
			forward_params = [
				"input_ids",
				"attention_mask",
				"encoder_outputs",
				"decoder_input_ids",
				"decoder_attention_mask",
				"past_key_values"
			];
			_apply_and_filter_by_delay_pattern_mask(e) {
				let [t, n] = e.dims, r = this.config.decoder.num_codebooks, i = n - r, a = 0;
				for (let t = 0; t < e.size; ++t) {
					if (e.data[t] === this.config.decoder.pad_token_id) continue;
					let o = t % n - Math.floor(t / n) % r;
					o > 0 && o <= i && (e.data[a++] = e.data[t]);
				}
				let o = Math.floor(t / r), s = a / (o * r);
				return new f.Tensor(e.type, e.data.slice(0, a), [
					o,
					r,
					s
				]);
			}
			prepare_inputs_for_generation(e, t, n) {
				let r = structuredClone(e);
				for (let e = 0; e < r.length; ++e) for (let t = 0; t < r[e].length; ++t) e % this.config.decoder.num_codebooks >= t && (r[e][t] = BigInt(this.config.decoder.pad_token_id));
				return n.guidance_scale !== null && n.guidance_scale > 1 && (r = r.concat(r)), super.prepare_inputs_for_generation(r, t, n);
			}
			async generate(e) {
				let t = await super.generate(e), n = this._apply_and_filter_by_delay_pattern_mask(t).unsqueeze_(0), { audio_values: r } = await O(this.sessions.encodec_decode, { audio_codes: n });
				return r;
			}
		}
		class yl extends z {}
		class bl extends yl {}
		class xl extends yl {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Sl extends yl {}
		class Cl extends z {}
		class wl extends Cl {}
		class Tl extends Cl {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class El extends Cl {}
		class Dl extends z {}
		class Ol extends Dl {}
		class kl extends Dl {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Al extends Dl {}
		class jl extends z {}
		class Ml extends jl {}
		class Nl extends jl {
			async _call(e) {
				return new $(await super._call(e));
			}
		}
		class Pl extends jl {}
		class Fl extends z {}
		class Il extends Fl {}
		class Ll extends z {}
		class Rl extends Ll {
			forward_params = [
				"input_ids",
				"pixel_values",
				"images_seq_mask",
				"images_emb_mask",
				"attention_mask",
				"position_ids",
				"past_key_values"
			];
			constructor(...e) {
				super(...e), this._generation_mode = "text";
			}
			async forward(e) {
				let t = this._generation_mode ?? "text", n;
				if (t === "text" || !e.past_key_values) {
					let t = this.sessions.prepare_inputs_embeds;
					n = await O(t, (0, s.pick)(e, t.inputNames));
				} else {
					let t = this.sessions.gen_img_embeds;
					n = await O(t, (0, s.pick)({ image_ids: e.input_ids }, t.inputNames));
				}
				let r = {
					...e,
					...n
				}, i = await N(this, r), a = this.sessions[t === "text" ? "lm_head" : "gen_head"];
				if (!a) throw Error(`Unable to find "${a}" generation head`);
				let o = await O(a, (0, s.pick)(i, a.inputNames));
				return {
					...n,
					...i,
					...o
				};
			}
			async generate(e) {
				return this._generation_mode = "text", super.generate(e);
			}
			async generate_images(e) {
				this._generation_mode = "image";
				let t = (e.inputs ?? e[this.main_input_name]).dims[1], n = (await super.generate(e)).slice(null, [t, null]), r = this.sessions.image_decode, { decoded_image: i } = await O(r, { generated_tokens: n }), a = i.add_(1).mul_(255 / 2).clamp_(0, 255).to("uint8"), o = [];
				for (let e of a) {
					let t = p.RawImage.fromTensor(e);
					o.push(t);
				}
				return o;
			}
		}
		class zl extends le {
			constructor({ char_logits: e, bpe_logits: t, wp_logits: n }) {
				super(), this.char_logits = e, this.bpe_logits = t, this.wp_logits = n;
			}
			get logits() {
				return [
					this.char_logits,
					this.bpe_logits,
					this.wp_logits
				];
			}
		}
		class Bl extends z {}
		class Vl extends Bl {
			async _call(e) {
				return new zl(await super._call(e));
			}
		}
		class Hl extends z {}
		class Ul extends Hl {}
		class Wl extends Hl {}
		class Gl extends z {}
		class Kl extends Gl {}
		class ql extends Gl {}
		class Jl extends z {
			forward_params = [
				"input_ids",
				"attention_mask",
				"position_ids",
				"audio_values",
				"past_key_values"
			];
		}
		class Yl extends Jl {
			_merge_input_ids_with_audio_features(e) {
				let t = e.audio_features.dims.at(-1), n = e.audio_features.view(-1, t);
				return F({
					audio_token_id: this.config.ignore_index ?? this.config.audio_token_id,
					...e,
					audio_features: n
				});
			}
		}
		class Xl extends Yl {}
		class Zl extends z {
			main_input_name = "input_values";
			forward_params = ["input_values"];
		}
		class Ql extends le {
			constructor({ audio_codes: e }) {
				super(), this.audio_codes = e;
			}
		}
		class $l extends le {
			constructor({ audio_values: e }) {
				super(), this.audio_values = e;
			}
		}
		class eu extends Zl {
			async encode(e) {
				return new Ql(await O(this.sessions.encoder_model, e));
			}
			async decode(e) {
				return new $l(await O(this.sessions.decoder_model, e));
			}
		}
		class tu extends Zl {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "encoder_model"
				});
			}
		}
		class nu extends Zl {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "decoder_model"
				});
			}
		}
		class ru extends z {
			main_input_name = "input_values";
			forward_params = ["input_values"];
		}
		class iu extends le {
			constructor({ audio_codes: e }) {
				super(), this.audio_codes = e;
			}
		}
		class au extends le {
			constructor({ audio_values: e }) {
				super(), this.audio_values = e;
			}
		}
		class ou extends ru {
			async encode(e) {
				return new iu(await O(this.sessions.encoder_model, e));
			}
			async decode(e) {
				return new au(await O(this.sessions.decoder_model, e));
			}
		}
		class su extends ru {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "encoder_model"
				});
			}
		}
		class cu extends ru {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "decoder_model"
				});
			}
		}
		class lu extends z {
			main_input_name = "input_values";
			forward_params = ["input_values"];
		}
		class uu extends lu {
			async encode(e) {
				return await O(this.sessions.encoder_model, e);
			}
			async decode(e) {
				return await O(this.sessions.decoder_model, e);
			}
		}
		class du extends lu {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "encoder_model"
				});
			}
		}
		class fu extends lu {
			static async from_pretrained(e, t = {}) {
				return super.from_pretrained(e, {
					...t,
					model_file_name: t.model_file_name ?? "decoder_model"
				});
			}
		}
		class Q {
			static MODEL_CLASS_MAPPINGS = null;
			static BASE_IF_FAIL = !1;
			static async from_pretrained(e, { progress_callback: t = null, config: n = null, cache_dir: i = null, local_files_only: a = !1, revision: o = "main", model_file_name: s = null, subfolder: c = "onnx", device: l = null, dtype: u = null, use_external_data_format: d = null, session_options: f = {} } = {}) {
				let p = {
					progress_callback: t,
					config: n,
					cache_dir: i,
					local_files_only: a,
					revision: o,
					model_file_name: s,
					subfolder: c,
					device: l,
					dtype: u,
					use_external_data_format: d,
					session_options: f
				};
				if (p.config = await r.AutoConfig.from_pretrained(e, p), !this.MODEL_CLASS_MAPPINGS) throw Error("`MODEL_CLASS_MAPPINGS` not implemented for this type of `AutoClass`: " + this.name);
				let m = p.config.model_type;
				for (let t of this.MODEL_CLASS_MAPPINGS) {
					let n = t.get(m);
					if (!n) {
						for (let e of t.values()) if (e[0] === m) {
							n = e;
							break;
						}
						if (!n) continue;
					}
					return await n[1].from_pretrained(e, p);
				}
				if (this.BASE_IF_FAIL) return Zu.has(m) || console.warn(`Unknown model class "${m}", attempting to construct from base class.`), await z.from_pretrained(e, p);
				throw Error(`Unsupported model type: ${m}`);
			}
		}
		let pu = /* @__PURE__ */ new Map([
			["bert", ["BertModel", fe]],
			["neobert", ["NeoBertModel", pe]],
			["modernbert", ["ModernBertModel", ge]],
			["nomic_bert", ["NomicBertModel", we]],
			["roformer", ["RoFormerModel", Ee]],
			["electra", ["ElectraModel", Y]],
			["esm", ["EsmModel", ft]],
			["convbert", ["ConvBertModel", Me]],
			["camembert", ["CamembertModel", He]],
			["deberta", ["DebertaModel", Je]],
			["deberta-v2", ["DebertaV2Model", et]],
			["mpnet", ["MPNetModel", St]],
			["albert", ["AlbertModel", Nt]],
			["distilbert", ["DistilBertModel", ot]],
			["roberta", ["RobertaModel", X]],
			["xlm", ["XLMModel", pn]],
			["xlm-roberta", ["XLMRobertaModel", yn]],
			["clap", ["ClapModel", el]],
			["clip", ["CLIPModel", $n]],
			["clipseg", ["CLIPSegModel", hr]],
			["chinese_clip", ["ChineseCLIPModel", lr]],
			["siglip", ["SiglipModel", ar]],
			["jina_clip", ["JinaCLIPModel", dr]],
			["mobilebert", ["MobileBertModel", _t]],
			["squeezebert", ["SqueezeBertModel", Ot]],
			["wav2vec2", ["Wav2Vec2Model", Ws]],
			["wav2vec2-bert", ["Wav2Vec2BertModel", dc]],
			["unispeech", ["UniSpeechModel", nc]],
			["unispeech-sat", ["UniSpeechSatModel", oc]],
			["hubert", ["HubertModel", hc]],
			["wavlm", ["WavLMModel", yc]],
			["audio-spectrogram-transformer", ["ASTModel", Tn]],
			["vits", ["VitsModel", il]],
			["pyannote", ["PyAnnoteModel", Zs]],
			["wespeaker-resnet", ["WeSpeakerResNetModel", ec]],
			["detr", ["DetrModel", Za]],
			["rt_detr", ["RTDetrModel", ro]],
			["rt_detr_v2", ["RTDetrV2Model", so]],
			["rf_detr", ["RFDetrModel", fo]],
			["d_fine", ["DFineModel", go]],
			["table-transformer", ["TableTransformerModel", yo]],
			["vit", ["ViTModel", pa]],
			["ijepa", ["IJepaModel", ga]],
			["pvt", ["PvtModel", xa]],
			["vit_msn", ["ViTMSNModel", Ea]],
			["vit_mae", ["ViTMAEModel", wa]],
			["groupvit", ["GroupViTModel", ka]],
			["fastvit", ["FastViTModel", ja]],
			["mobilevit", ["MobileViTModel", Ia]],
			["mobilevitv2", ["MobileViTV2Model", za]],
			["owlvit", ["OwlViTModel", Ha]],
			["owlv2", ["Owlv2Model", Ga]],
			["beit", ["BeitModel", Ja]],
			["deit", ["DeiTModel", Co]],
			["hiera", ["HieraModel", Eo]],
			["convnext", ["ConvNextModel", cs]],
			["convnextv2", ["ConvNextV2Model", ds]],
			["dinov2", ["Dinov2Model", ms]],
			["dinov2_with_registers", ["Dinov2WithRegistersModel", _s]],
			["dinov3_vit", ["DINOv3ViTModel", bs]],
			["dinov3_convnext", ["DINOv3ConvNextModel", Ss]],
			["resnet", ["ResNetModel", ko]],
			["swin", ["SwinModel", Mo]],
			["swin2sr", ["Swin2SRModel", Io]],
			["donut-swin", ["DonutSwinModel", os]],
			["yolos", ["YolosModel", Es]],
			["dpt", ["DPTModel", zo]],
			["glpn", ["GLPNModel", rs]],
			["hifigan", ["SpeechT5HifiGan", Ac]],
			["efficientnet", ["EfficientNetModel", pl]],
			["decision_transformer", ["DecisionTransformerModel", Il]],
			["patchtst", ["PatchTSTForPrediction", Ul]],
			["patchtsmixer", ["PatchTSMixerForPrediction", Kl]],
			["mobilenet_v1", ["MobileNetV1Model", bl]],
			["mobilenet_v2", ["MobileNetV2Model", wl]],
			["mobilenet_v3", ["MobileNetV3Model", Ol]],
			["mobilenet_v4", ["MobileNetV4Model", Ml]],
			["maskformer", ["MaskFormerModel", es]],
			["mgp-str", ["MgpstrForSceneTextRecognition", Vl]],
			["style_text_to_speech_2", ["StyleTextToSpeech2Model", Tc]]
		]), mu = /* @__PURE__ */ new Map([
			["t5", ["T5Model", Rt]],
			["longt5", ["LongT5Model", Vt]],
			["mt5", ["MT5Model", Wt]],
			["bart", ["BartModel", qt]],
			["mbart", ["MBartModel", Zt]],
			["marian", ["MarianModel", Rs]],
			["whisper", ["WhisperModel", On]],
			["m2m_100", ["M2M100Model", Vs]],
			["blenderbot", ["BlenderbotModel", nn]],
			["blenderbot-small", ["BlenderbotSmallModel", on]]
		]), hu = /* @__PURE__ */ new Map([
			["mimi", ["MimiModel", eu]],
			["dac", ["DacModel", ou]],
			["snac", ["SnacModel", uu]]
		]), gu = /* @__PURE__ */ new Map([
			["bloom", ["BloomModel", ia]],
			["jais", ["JAISModel", xr]],
			["gpt2", ["GPT2Model", vr]],
			["gptj", ["GPTJModel", Ar]],
			["gpt_bigcode", ["GPTBigCodeModel", Nr]],
			["gpt_neo", ["GPTNeoModel", wr]],
			["gpt_neox", ["GPTNeoXModel", Dr]],
			["codegen", ["CodeGenModel", Ir]],
			["llama", ["LlamaModel", zr]],
			["nanochat", ["NanoChatModel", Wr]],
			["arcee", ["ArceeModel", qr]],
			["lfm2", ["Lfm2Model", Xr]],
			["smollm3", ["SmolLM3Model", $r]],
			["exaone", ["ExaoneModel", ci]],
			["olmo", ["OlmoModel", mi]],
			["olmo2", ["Olmo2Model", _i]],
			["mobilellm", ["MobileLLMModel", di]],
			["granite", ["GraniteModel", bi]],
			["granitemoehybrid", ["GraniteMoeHybridModel", Ci]],
			["cohere", ["CohereModel", Ei]],
			["gemma", ["GemmaModel", ki]],
			["gemma2", ["Gemma2Model", Mi]],
			["vaultgemma", ["VaultGemmaModel", Fi]],
			["gemma3_text", ["Gemma3Model", Ri]],
			["helium", ["HeliumModel", ni]],
			["glm", ["GlmModel", ai]],
			["openelm", ["OpenELMModel", Vi]],
			["qwen2", ["Qwen2Model", Wi]],
			["qwen3", ["Qwen3Model", qi]],
			["phi", ["PhiModel", Qi]],
			["phi3", ["Phi3Model", ta]],
			["mpt", ["MptModel", sa]],
			["opt", ["OPTModel", ua]],
			["mistral", ["MistralModel", Ic]],
			["ministral", ["MinistralModel", zc]],
			["ministral3", ["Ministral3Model", Hc]],
			["ernie4_5", ["Ernie4_5Model", Gc]],
			["starcoder2", ["Starcoder2Model", Jc]],
			["falcon", ["FalconModel", Zc]],
			["stablelm", ["StableLmModel", ul]],
			["modernbert-decoder", ["ModernBertDecoderModel", xe]]
		]), _u = /* @__PURE__ */ new Map([
			["speecht5", ["SpeechT5ForSpeechToText", Oc]],
			["whisper", ["WhisperForConditionalGeneration", kn]],
			["lite-whisper", ["LiteWhisperForConditionalGeneration", An]],
			["moonshine", ["MoonshineForConditionalGeneration", Nn]]
		]), vu = /* @__PURE__ */ new Map([["speecht5", ["SpeechT5ForTextToSpeech", kc]]]), yu = /* @__PURE__ */ new Map([
			["vits", ["VitsModel", il]],
			["musicgen", ["MusicgenForConditionalGeneration", vl]],
			["supertonic", ["SupertonicForConditionalGeneration", Mc]]
		]), bu = /* @__PURE__ */ new Map([
			["bert", ["BertForSequenceClassification", V]],
			["neobert", ["NeoBertForSequenceClassification", me]],
			["modernbert", ["ModernBertForSequenceClassification", ve]],
			["roformer", ["RoFormerForSequenceClassification", Oe]],
			["electra", ["ElectraForSequenceClassification", Re]],
			["esm", ["EsmForSequenceClassification", mt]],
			["convbert", ["ConvBertForSequenceClassification", Ne]],
			["camembert", ["CamembertForSequenceClassification", We]],
			["deberta", ["DebertaForSequenceClassification", Xe]],
			["deberta-v2", ["DebertaV2ForSequenceClassification", nt]],
			["mpnet", ["MPNetForSequenceClassification", wt]],
			["albert", ["AlbertForSequenceClassification", Pt]],
			["distilbert", ["DistilBertForSequenceClassification", st]],
			["roberta", ["RobertaForSequenceClassification", ln]],
			["xlm", ["XLMForSequenceClassification", hn]],
			["xlm-roberta", ["XLMRobertaForSequenceClassification", xn]],
			["bart", ["BartForSequenceClassification", Yt]],
			["mbart", ["MBartForSequenceClassification", $t]],
			["mobilebert", ["MobileBertForSequenceClassification", yt]],
			["squeezebert", ["SqueezeBertForSequenceClassification", At]]
		]), xu = /* @__PURE__ */ new Map([
			["bert", ["BertForTokenClassification", H]],
			["neobert", ["NeoBertForTokenClassification", K]],
			["modernbert", ["ModernBertForTokenClassification", ye]],
			["roformer", ["RoFormerForTokenClassification", ke]],
			["electra", ["ElectraForTokenClassification", ze]],
			["esm", ["EsmForTokenClassification", ht]],
			["convbert", ["ConvBertForTokenClassification", Pe]],
			["camembert", ["CamembertForTokenClassification", Ge]],
			["deberta", ["DebertaForTokenClassification", Ze]],
			["deberta-v2", ["DebertaV2ForTokenClassification", rt]],
			["mpnet", ["MPNetForTokenClassification", Tt]],
			["distilbert", ["DistilBertForTokenClassification", ct]],
			["roberta", ["RobertaForTokenClassification", un]],
			["xlm", ["XLMForTokenClassification", gn]],
			["xlm-roberta", ["XLMRobertaForTokenClassification", Sn]]
		]), Su = /* @__PURE__ */ new Map([
			["t5", ["T5ForConditionalGeneration", zt]],
			["longt5", ["LongT5ForConditionalGeneration", Ht]],
			["mt5", ["MT5ForConditionalGeneration", Gt]],
			["bart", ["BartForConditionalGeneration", Jt]],
			["mbart", ["MBartForConditionalGeneration", Qt]],
			["marian", ["MarianMTModel", zs]],
			["m2m_100", ["M2M100ForConditionalGeneration", Hs]],
			["blenderbot", ["BlenderbotForConditionalGeneration", rn]],
			["blenderbot-small", ["BlenderbotSmallForConditionalGeneration", sn]]
		]), Cu = /* @__PURE__ */ new Map([
			["bloom", ["BloomForCausalLM", aa]],
			["gpt2", ["GPT2LMHeadModel", yr]],
			["jais", ["JAISLMHeadModel", Sr]],
			["gptj", ["GPTJForCausalLM", jr]],
			["gpt_bigcode", ["GPTBigCodeForCausalLM", Pr]],
			["gpt_neo", ["GPTNeoForCausalLM", Tr]],
			["gpt_neox", ["GPTNeoXForCausalLM", Or]],
			["codegen", ["CodeGenForCausalLM", Lr]],
			["llama", ["LlamaForCausalLM", Br]],
			["nanochat", ["NanoChatForCausalLM", Gr]],
			["llama4_text", ["Llama4ForCausalLM", Hr]],
			["arcee", ["ArceeForCausalLM", Jr]],
			["lfm2", ["Lfm2ForCausalLM", Zr]],
			["smollm3", ["SmolLM3ForCausalLM", ei]],
			["exaone", ["ExaoneForCausalLM", li]],
			["olmo", ["OlmoForCausalLM", hi]],
			["olmo2", ["Olmo2ForCausalLM", vi]],
			["mobilellm", ["MobileLLMForCausalLM", fi]],
			["granite", ["GraniteForCausalLM", xi]],
			["granitemoehybrid", ["GraniteMoeHybridForCausalLM", wi]],
			["cohere", ["CohereForCausalLM", Di]],
			["gemma", ["GemmaForCausalLM", Ai]],
			["gemma2", ["Gemma2ForCausalLM", Ni]],
			["vaultgemma", ["VaultGemmaForCausalLM", Ii]],
			["gemma3_text", ["Gemma3ForCausalLM", zi]],
			["helium", ["HeliumForCausalLM", ri]],
			["glm", ["GlmForCausalLM", oi]],
			["openelm", ["OpenELMForCausalLM", Hi]],
			["qwen2", ["Qwen2ForCausalLM", Gi]],
			["qwen3", ["Qwen3ForCausalLM", Ji]],
			["phi", ["PhiForCausalLM", $i]],
			["phi3", ["Phi3ForCausalLM", na]],
			["mpt", ["MptForCausalLM", ca]],
			["opt", ["OPTForCausalLM", da]],
			["mbart", ["MBartForCausalLM", en]],
			["mistral", ["MistralForCausalLM", Lc]],
			["ministral", ["MinistralForCausalLM", Bc]],
			["ministral3", ["Ministral3ForCausalLM", Uc]],
			["ernie4_5", ["Ernie4_5ForCausalLM", Kc]],
			["starcoder2", ["Starcoder2ForCausalLM", Yc]],
			["falcon", ["FalconForCausalLM", Qc]],
			["trocr", ["TrOCRForCausalLM", Pc]],
			["stablelm", ["StableLmForCausalLM", dl]],
			["modernbert-decoder", ["ModernBertDecoderForCausalLM", Se]],
			["phi3_v", ["Phi3VForCausalLM", Zn]]
		]), wu = /* @__PURE__ */ new Map([["multi_modality", ["MultiModalityCausalLM", Rl]]]), Tu = /* @__PURE__ */ new Map([
			["bert", ["BertForMaskedLM", B]],
			["neobert", ["NeoBertForMaskedLM", G]],
			["modernbert", ["ModernBertForMaskedLM", _e]],
			["roformer", ["RoFormerForMaskedLM", De]],
			["electra", ["ElectraForMaskedLM", Le]],
			["esm", ["EsmForMaskedLM", pt]],
			["convbert", ["ConvBertForMaskedLM", J]],
			["camembert", ["CamembertForMaskedLM", Ue]],
			["deberta", ["DebertaForMaskedLM", Ye]],
			["deberta-v2", ["DebertaV2ForMaskedLM", tt]],
			["mpnet", ["MPNetForMaskedLM", Ct]],
			["albert", ["AlbertForMaskedLM", It]],
			["distilbert", ["DistilBertForMaskedLM", ut]],
			["roberta", ["RobertaForMaskedLM", Z]],
			["xlm", ["XLMWithLMHeadModel", mn]],
			["xlm-roberta", ["XLMRobertaForMaskedLM", bn]],
			["mobilebert", ["MobileBertForMaskedLM", vt]],
			["squeezebert", ["SqueezeBertForMaskedLM", kt]]
		]), Eu = /* @__PURE__ */ new Map([
			["bert", ["BertForQuestionAnswering", U]],
			["neobert", ["NeoBertForQuestionAnswering", he]],
			["roformer", ["RoFormerForQuestionAnswering", Ae]],
			["electra", ["ElectraForQuestionAnswering", Be]],
			["convbert", ["ConvBertForQuestionAnswering", Fe]],
			["camembert", ["CamembertForQuestionAnswering", Ke]],
			["deberta", ["DebertaForQuestionAnswering", Qe]],
			["deberta-v2", ["DebertaV2ForQuestionAnswering", it]],
			["mpnet", ["MPNetForQuestionAnswering", Et]],
			["albert", ["AlbertForQuestionAnswering", Ft]],
			["distilbert", ["DistilBertForQuestionAnswering", lt]],
			["roberta", ["RobertaForQuestionAnswering", dn]],
			["xlm", ["XLMForQuestionAnswering", _n]],
			["xlm-roberta", ["XLMRobertaForQuestionAnswering", Cn]],
			["mobilebert", ["MobileBertForQuestionAnswering", bt]],
			["squeezebert", ["SqueezeBertForQuestionAnswering", jt]]
		]), Du = /* @__PURE__ */ new Map([
			["vision-encoder-decoder", ["VisionEncoderDecoderModel", Pn]],
			["idefics3", ["Idefics3ForConditionalGeneration", Jn]],
			["smolvlm", ["SmolVLMForConditionalGeneration", Yn]]
		]), Ou = /* @__PURE__ */ new Map([
			["llava", ["LlavaForConditionalGeneration", In]],
			["llava_onevision", ["LlavaOnevisionForConditionalGeneration", Ln]],
			["moondream1", ["Moondream1ForConditionalGeneration", Rn]],
			["florence2", ["Florence2ForConditionalGeneration", Bn]],
			["qwen2-vl", ["Qwen2VLForConditionalGeneration", Xi]],
			["idefics3", ["Idefics3ForConditionalGeneration", Jn]],
			["smolvlm", ["SmolVLMForConditionalGeneration", Yn]],
			["paligemma", ["PaliGemmaForConditionalGeneration", Hn]],
			["llava_qwen2", ["LlavaQwen2ForCausalLM", Un]],
			["gemma3n", ["Gemma3nForConditionalGeneration", Kn]],
			["mistral3", ["Mistral3ForConditionalGeneration", Wn]]
		]), ku = /* @__PURE__ */ new Map([["ultravox", ["UltravoxModel", Yl]], ["voxtral", ["VoxtralForConditionalGeneration", Xl]]]), Au = /* @__PURE__ */ new Map([["vision-encoder-decoder", ["VisionEncoderDecoderModel", Pn]]]), ju = /* @__PURE__ */ new Map([
			["vit", ["ViTForImageClassification", ma]],
			["ijepa", ["IJepaForImageClassification", _a]],
			["pvt", ["PvtForImageClassification", Sa]],
			["vit_msn", ["ViTMSNForImageClassification", Da]],
			["fastvit", ["FastViTForImageClassification", Ma]],
			["mobilevit", ["MobileViTForImageClassification", La]],
			["mobilevitv2", ["MobileViTV2ForImageClassification", Ba]],
			["beit", ["BeitForImageClassification", Ya]],
			["deit", ["DeiTForImageClassification", wo]],
			["hiera", ["HieraForImageClassification", Do]],
			["convnext", ["ConvNextForImageClassification", ls]],
			["convnextv2", ["ConvNextV2ForImageClassification", fs]],
			["dinov2", ["Dinov2ForImageClassification", hs]],
			["dinov2_with_registers", ["Dinov2WithRegistersForImageClassification", vs]],
			["resnet", ["ResNetForImageClassification", Ao]],
			["swin", ["SwinForImageClassification", No]],
			["segformer", ["SegformerForImageClassification", sl]],
			["efficientnet", ["EfficientNetForImageClassification", ml]],
			["mobilenet_v1", ["MobileNetV1ForImageClassification", xl]],
			["mobilenet_v2", ["MobileNetV2ForImageClassification", Tl]],
			["mobilenet_v3", ["MobileNetV3ForImageClassification", kl]],
			["mobilenet_v4", ["MobileNetV4ForImageClassification", Nl]]
		]), Mu = /* @__PURE__ */ new Map([
			["detr", ["DetrForObjectDetection", Qa]],
			["rt_detr", ["RTDetrForObjectDetection", io]],
			["rt_detr_v2", ["RTDetrV2ForObjectDetection", co]],
			["rf_detr", ["RFDetrForObjectDetection", po]],
			["d_fine", ["DFineForObjectDetection", _o]],
			["table-transformer", ["TableTransformerForObjectDetection", bo]],
			["yolos", ["YolosForObjectDetection", Ds]]
		]), Nu = /* @__PURE__ */ new Map([
			["owlvit", ["OwlViTForObjectDetection", Ua]],
			["owlv2", ["Owlv2ForObjectDetection", Ka]],
			["grounding-dino", ["GroundingDinoForObjectDetection", ws]]
		]), Pu = /* @__PURE__ */ new Map([["detr", ["DetrForSegmentation", $a]], ["clipseg", ["CLIPSegForImageSegmentation", gr]]]), Fu = /* @__PURE__ */ new Map([
			["segformer", ["SegformerForSemanticSegmentation", cl]],
			["sapiens", ["SapiensForSemanticSegmentation", Wo]],
			["swin", ["SwinForSemanticSegmentation", Po]],
			["mobilenet_v1", ["MobileNetV1ForSemanticSegmentation", Sl]],
			["mobilenet_v2", ["MobileNetV2ForSemanticSegmentation", El]],
			["mobilenet_v3", ["MobileNetV3ForSemanticSegmentation", Al]],
			["mobilenet_v4", ["MobileNetV4ForSemanticSegmentation", Pl]]
		]), Iu = /* @__PURE__ */ new Map([["detr", ["DetrForSegmentation", $a]], ["maskformer", ["MaskFormerForInstanceSegmentation", ts]]]), Lu = /* @__PURE__ */ new Map([
			["sam", ["SamModel", As]],
			["sam2", ["Sam2Model", Ps]],
			["edgetam", ["EdgeTamModel", Fs]],
			["sam3_tracker", ["Sam3TrackerModel", Is]]
		]), Ru = /* @__PURE__ */ new Map([
			["wav2vec2", ["Wav2Vec2ForCTC", Gs]],
			["wav2vec2-bert", ["Wav2Vec2BertForCTC", fc]],
			["unispeech", ["UniSpeechForCTC", rc]],
			["unispeech-sat", ["UniSpeechSatForCTC", sc]],
			["wavlm", ["WavLMForCTC", bc]],
			["hubert", ["HubertForCTC", gc]],
			["parakeet_ctc", ["ParakeetForCTC", Ys]]
		]), zu = /* @__PURE__ */ new Map([
			["wav2vec2", ["Wav2Vec2ForSequenceClassification", Ks]],
			["wav2vec2-bert", ["Wav2Vec2BertForSequenceClassification", pc]],
			["unispeech", ["UniSpeechForSequenceClassification", ic]],
			["unispeech-sat", ["UniSpeechSatForSequenceClassification", cc]],
			["wavlm", ["WavLMForSequenceClassification", xc]],
			["hubert", ["HubertForSequenceClassification", _c]],
			["audio-spectrogram-transformer", ["ASTForAudioClassification", En]]
		]), Bu = /* @__PURE__ */ new Map([["wavlm", ["WavLMForXVector", Sc]]]), Vu = /* @__PURE__ */ new Map([
			["unispeech-sat", ["UniSpeechSatForAudioFrameClassification", lc]],
			["wavlm", ["WavLMForAudioFrameClassification", Cc]],
			["wav2vec2", ["Wav2Vec2ForAudioFrameClassification", qs]],
			["pyannote", ["PyAnnoteForAudioFrameClassification", Qs]]
		]), Hu = /* @__PURE__ */ new Map([["vitmatte", ["VitMatteForImageMatting", Pa]]]), Uu = /* @__PURE__ */ new Map([["patchtst", ["PatchTSTForPrediction", Wl]], ["patchtsmixer", ["PatchTSMixerForPrediction", ql]]]), Wu = /* @__PURE__ */ new Map([["swin2sr", ["Swin2SRForImageSuperResolution", Lo]]]), Gu = /* @__PURE__ */ new Map([
			["dpt", ["DPTForDepthEstimation", Bo]],
			["depth_anything", ["DepthAnythingForDepthEstimation", Ho]],
			["glpn", ["GLPNForDepthEstimation", is]],
			["sapiens", ["SapiensForDepthEstimation", Go]],
			["depth_pro", ["DepthProForDepthEstimation", Jo]],
			["metric3d", ["Metric3DForDepthEstimation", Xo]],
			["metric3dv2", ["Metric3Dv2ForDepthEstimation", Qo]]
		]), Ku = /* @__PURE__ */ new Map([["sapiens", ["SapiensForNormalEstimation", Ko]]]), qu = /* @__PURE__ */ new Map([["vitpose", ["VitPoseForPoseEstimation", ya]]]), Ju = /* @__PURE__ */ new Map([
			["clip", ["CLIPVisionModelWithProjection", rr]],
			["siglip", ["SiglipVisionModel", sr]],
			["jina_clip", ["JinaCLIPVisionModel", pr]]
		]), Yu = [
			[pu, b.EncoderOnly],
			[mu, b.EncoderDecoder],
			[gu, b.DecoderOnly],
			[hu, b.AutoEncoder],
			[bu, b.EncoderOnly],
			[xu, b.EncoderOnly],
			[Su, b.Seq2Seq],
			[_u, b.Seq2Seq],
			[Cu, b.DecoderOnly],
			[wu, b.MultiModality],
			[Tu, b.EncoderOnly],
			[Eu, b.EncoderOnly],
			[Du, b.Vision2Seq],
			[Ou, b.ImageTextToText],
			[ku, b.AudioTextToText],
			[ju, b.EncoderOnly],
			[Pu, b.EncoderOnly],
			[Iu, b.EncoderOnly],
			[Fu, b.EncoderOnly],
			[Hu, b.EncoderOnly],
			[Uu, b.EncoderOnly],
			[Wu, b.EncoderOnly],
			[Gu, b.EncoderOnly],
			[Ku, b.EncoderOnly],
			[qu, b.EncoderOnly],
			[Mu, b.EncoderOnly],
			[Nu, b.EncoderOnly],
			[Lu, b.MaskGeneration],
			[Ru, b.EncoderOnly],
			[zu, b.EncoderOnly],
			[vu, b.Seq2Seq],
			[yu, b.EncoderOnly],
			[Bu, b.EncoderOnly],
			[Vu, b.EncoderOnly],
			[Ju, b.EncoderOnly]
		];
		for (let [e, t] of Yu) for (let [n, r] of e.values()) x.set(n, t), C.set(r, n), S.set(n, r);
		let Xu = [
			[
				"MusicgenForConditionalGeneration",
				vl,
				b.Musicgen
			],
			[
				"Phi3VForCausalLM",
				Zn,
				b.Phi3V
			],
			[
				"CLIPTextModelWithProjection",
				tr,
				b.EncoderOnly
			],
			[
				"SiglipTextModel",
				or,
				b.EncoderOnly
			],
			[
				"JinaCLIPTextModel",
				fr,
				b.EncoderOnly
			],
			[
				"ClapTextModelWithProjection",
				tl,
				b.EncoderOnly
			],
			[
				"ClapAudioModelWithProjection",
				nl,
				b.EncoderOnly
			],
			[
				"DacEncoderModel",
				su,
				b.EncoderOnly
			],
			[
				"DacDecoderModel",
				cu,
				b.EncoderOnly
			],
			[
				"MimiEncoderModel",
				tu,
				b.EncoderOnly
			],
			[
				"MimiDecoderModel",
				nu,
				b.EncoderOnly
			],
			[
				"SnacEncoderModel",
				du,
				b.EncoderOnly
			],
			[
				"SnacDecoderModel",
				fu,
				b.EncoderOnly
			],
			[
				"Gemma3nForConditionalGeneration",
				Kn,
				b.ImageAudioTextToText
			],
			[
				"SupertonicForConditionalGeneration",
				Mc,
				b.Supertonic
			]
		];
		for (let [e, t, n] of Xu) x.set(e, n), C.set(t, e), S.set(e, t);
		let Zu = /* @__PURE__ */ new Map([
			["modnet", Pu],
			["birefnet", Pu],
			["isnet", Pu],
			["ben", Pu]
		]);
		for (let [e, t] of Zu.entries()) t.set(e, ["PreTrainedModel", z]), x.set(e, b.EncoderOnly), C.set(z, e), S.set(e, z);
		class Qu extends Q {
			static MODEL_CLASS_MAPPINGS = Yu.map((e) => e[0]);
			static BASE_IF_FAIL = !0;
		}
		class $u extends Q {
			static MODEL_CLASS_MAPPINGS = [bu];
		}
		class ed extends Q {
			static MODEL_CLASS_MAPPINGS = [xu];
		}
		class td extends Q {
			static MODEL_CLASS_MAPPINGS = [Su];
		}
		class nd extends Q {
			static MODEL_CLASS_MAPPINGS = [_u];
		}
		class rd extends Q {
			static MODEL_CLASS_MAPPINGS = [vu];
		}
		class id extends Q {
			static MODEL_CLASS_MAPPINGS = [yu];
		}
		class ad extends Q {
			static MODEL_CLASS_MAPPINGS = [Cu];
		}
		class od extends Q {
			static MODEL_CLASS_MAPPINGS = [Tu];
		}
		class sd extends Q {
			static MODEL_CLASS_MAPPINGS = [Eu];
		}
		class cd extends Q {
			static MODEL_CLASS_MAPPINGS = [Du];
		}
		class ld extends Q {
			static MODEL_CLASS_MAPPINGS = [ju];
		}
		class ud extends Q {
			static MODEL_CLASS_MAPPINGS = [Pu];
		}
		class dd extends Q {
			static MODEL_CLASS_MAPPINGS = [Fu];
		}
		class fd extends Q {
			static MODEL_CLASS_MAPPINGS = [Iu];
		}
		class pd extends Q {
			static MODEL_CLASS_MAPPINGS = [Mu];
		}
		class md extends Q {
			static MODEL_CLASS_MAPPINGS = [Nu];
		}
		class hd extends Q {
			static MODEL_CLASS_MAPPINGS = [Lu];
		}
		class gd extends Q {
			static MODEL_CLASS_MAPPINGS = [Ru];
		}
		class _d extends Q {
			static MODEL_CLASS_MAPPINGS = [zu];
		}
		class vd extends Q {
			static MODEL_CLASS_MAPPINGS = [Bu];
		}
		class yd extends Q {
			static MODEL_CLASS_MAPPINGS = [Vu];
		}
		class bd extends Q {
			static MODEL_CLASS_MAPPINGS = [Au];
		}
		class xd extends Q {
			static MODEL_CLASS_MAPPINGS = [Hu];
		}
		class Sd extends Q {
			static MODEL_CLASS_MAPPINGS = [Wu];
		}
		class Cd extends Q {
			static MODEL_CLASS_MAPPINGS = [Gu];
		}
		class wd extends Q {
			static MODEL_CLASS_MAPPINGS = [Ku];
		}
		class Td extends Q {
			static MODEL_CLASS_MAPPINGS = [qu];
		}
		class Ed extends Q {
			static MODEL_CLASS_MAPPINGS = [Ju];
		}
		class Dd extends Q {
			static MODEL_CLASS_MAPPINGS = [Ou];
		}
		class Od extends Q {
			static MODEL_CLASS_MAPPINGS = [ku];
		}
		class kd extends le {
			constructor({ logits: e, past_key_values: t, encoder_outputs: n, decoder_attentions: r = null, cross_attentions: i = null }) {
				super(), this.logits = e, this.past_key_values = t, this.encoder_outputs = n, this.decoder_attentions = r, this.cross_attentions = i;
			}
		}
		class $ extends le {
			constructor({ logits: e, ...t }) {
				super(), this.logits = e;
				let n = Object.values(t);
				n.length > 0 && (this.attentions = n);
			}
		}
		class Ad extends le {
			constructor({ logits: e, embeddings: t }) {
				super(), this.logits = e, this.embeddings = t;
			}
		}
		class jd extends le {
			constructor({ logits: e }) {
				super(), this.logits = e;
			}
		}
		class Md extends le {
			constructor({ logits: e }) {
				super(), this.logits = e;
			}
		}
		class Nd extends le {
			constructor({ start_logits: e, end_logits: t }) {
				super(), this.start_logits = e, this.end_logits = t;
			}
		}
		class Pd extends le {
			constructor({ logits: e }) {
				super(), this.logits = e;
			}
		}
		class Fd extends le {
			constructor({ logits: e, past_key_values: t }) {
				super(), this.logits = e, this.past_key_values = t;
			}
		}
		class Id extends le {
			constructor({ alphas: e }) {
				super(), this.alphas = e;
			}
		}
		class Ld extends le {
			constructor({ waveform: e, spectrogram: t }) {
				super(), this.waveform = e, this.spectrogram = t;
			}
		}
	}),
	"./src/models/audio_spectrogram_transformer/feature_extraction_audio_spectrogram_transformer.js": ((e, t, n) => {
		n.r(t), n.d(t, { ASTFeatureExtractor: () => a });
		var r = n("./src/base/feature_extraction_utils.js");
		n("./src/utils/tensor.js");
		var i = n("./src/utils/audio.js");
		class a extends r.FeatureExtractor {
			constructor(e) {
				super(e);
				let t = this.config.sampling_rate, n = (0, i.mel_filter_bank)(257, this.config.num_mel_bins, 20, Math.floor(t / 2), t, null, "kaldi", !0);
				this.mel_filters = n, this.window = (0, i.window_function)(400, "hann", { periodic: !1 }), this.mean = this.config.mean, this.std = this.config.std;
			}
			async _extract_fbank_features(e, t) {
				return (0, i.spectrogram)(e, this.window, 400, 160, {
					fft_length: 512,
					power: 2,
					center: !1,
					preemphasis: .97,
					mel_filters: this.mel_filters,
					log_mel: "log",
					mel_floor: 1.192092955078125e-7,
					remove_dc_offset: !0,
					max_num_frames: t,
					transpose: !0
				});
			}
			async _call(e) {
				(0, r.validate_audio_inputs)(e, "ASTFeatureExtractor");
				let t = await this._extract_fbank_features(e, this.config.max_length);
				if (this.config.do_normalize) {
					let e = this.std * 2, n = t.data;
					for (let t = 0; t < n.length; ++t) n[t] = (n[t] - this.mean) / e;
				}
				return { input_values: t.unsqueeze_(0) };
			}
		}
	}),
	"./src/models/auto/feature_extraction_auto.js": ((e, t, n) => {
		n.r(t), n.d(t, { AutoFeatureExtractor: () => o });
		var r = n("./src/utils/constants.js"), i = n("./src/utils/hub.js");
		n("./src/base/feature_extraction_utils.js");
		var a = n("./src/models/feature_extractors.js");
		class o {
			static async from_pretrained(e, t = {}) {
				let n = await (0, i.getModelJSON)(e, r.FEATURE_EXTRACTOR_NAME, !0, t), o = n.feature_extractor_type, s = a[o];
				if (!s) throw Error(`Unknown feature_extractor_type: '${o}'. Please report this at ${r.GITHUB_ISSUE_URL}.`);
				return new s(n);
			}
		}
	}),
	"./src/models/auto/image_processing_auto.js": ((e, t, n) => {
		n.r(t), n.d(t, { AutoImageProcessor: () => s });
		var r = n("./src/utils/constants.js"), i = n("./src/utils/hub.js"), a = n("./src/base/image_processors_utils.js"), o = n("./src/models/image_processors.js");
		class s {
			static async from_pretrained(e, t = {}) {
				let n = await (0, i.getModelJSON)(e, r.IMAGE_PROCESSOR_NAME, !0, t), s = n.image_processor_type ?? n.feature_extractor_type, c = o[s?.replace(/Fast$/, "")];
				return c ||= (s !== void 0 && console.warn(`Image processor type '${s}' not found, assuming base ImageProcessor. Please report this at ${r.GITHUB_ISSUE_URL}.`), a.ImageProcessor), new c(n);
			}
		}
	}),
	"./src/models/auto/processing_auto.js": ((e, t, n) => {
		n.r(t), n.d(t, { AutoProcessor: () => l });
		var r = n("./src/utils/constants.js"), i = n("./src/utils/hub.js"), a = n("./src/base/processing_utils.js"), o = n("./src/models/processors.js"), s = n("./src/models/image_processors.js"), c = n("./src/models/feature_extractors.js");
		class l {
			static async from_pretrained(e, t = {}) {
				let n = await (0, i.getModelJSON)(e, r.IMAGE_PROCESSOR_NAME, !0, t), { image_processor_type: l, feature_extractor_type: u, processor_class: d } = n;
				if (d && o[d]) return o[d].from_pretrained(e, t);
				if (!l && !u) throw Error("No `image_processor_type` or `feature_extractor_type` found in the config.");
				let f = {};
				if (l) {
					let e = s[l.replace(/Fast$/, "")];
					if (!e) throw Error(`Unknown image_processor_type: '${l}'.`);
					f.image_processor = new e(n);
				}
				if (u) {
					let e = s[u];
					if (e) f.image_processor = new e(n);
					else {
						let e = c[u];
						if (!e) throw Error(`Unknown feature_extractor_type: '${u}'.`);
						f.feature_extractor = new e(n);
					}
				}
				return new a.Processor({}, f, null);
			}
		}
	}),
	"./src/models/beit/image_processing_beit.js": ((e, t, n) => {
		n.r(t), n.d(t, { BeitFeatureExtractor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
	}),
	"./src/models/bit/image_processing_bit.js": ((e, t, n) => {
		n.r(t), n.d(t, { BitImageProcessor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
	}),
	"./src/models/chinese_clip/image_processing_chinese_clip.js": ((e, t, n) => {
		n.r(t), n.d(t, { ChineseCLIPFeatureExtractor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
	}),
	"./src/models/clap/feature_extraction_clap.js": ((e, t, n) => {
		n.r(t), n.d(t, { ClapFeatureExtractor: () => a });
		var r = n("./src/base/feature_extraction_utils.js");
		n("./src/utils/tensor.js");
		var i = n("./src/utils/audio.js");
		class a extends r.FeatureExtractor {
			constructor(e) {
				super(e), this.mel_filters = (0, i.mel_filter_bank)(this.config.nb_frequency_bins, this.config.feature_size, this.config.frequency_min, this.config.frequency_max, this.config.sampling_rate, null, "htk"), this.mel_filters_slaney = (0, i.mel_filter_bank)(this.config.nb_frequency_bins, this.config.feature_size, this.config.frequency_min, this.config.frequency_max, this.config.sampling_rate, "slaney", "slaney"), this.window = (0, i.window_function)(this.config.fft_window_size, "hann");
			}
			async _get_input_mel(e, t, n, r) {
				let i, a = e.length - t;
				if (a > 0) {
					if (n === "rand_trunc") {
						let n = Math.floor(Math.random() * (a + 1));
						e = e.subarray(n, n + t), i = await this._extract_fbank_features(e, this.mel_filters_slaney, this.config.nb_max_samples);
					} else throw Error(`Truncation strategy "${n}" not implemented`);
				} else {
					if (a < 0) {
						let n = new Float64Array(t);
						if (n.set(e), r === "repeat") for (let r = e.length; r < t; r += e.length) n.set(e.subarray(0, Math.min(e.length, t - r)), r);
						else if (r === "repeatpad") for (let t = e.length; t < -a; t += e.length) n.set(e, t);
						e = n;
					}
					if (n === "fusion") throw Error(`Truncation strategy "${n}" not implemented`);
					i = await this._extract_fbank_features(e, this.mel_filters_slaney, this.config.nb_max_samples);
				}
				return i.unsqueeze_(0);
			}
			async _extract_fbank_features(e, t, n = null) {
				return (0, i.spectrogram)(e, this.window, this.config.fft_window_size, this.config.hop_length, {
					power: 2,
					mel_filters: t,
					log_mel: "dB",
					max_num_frames: n,
					do_pad: !1,
					transpose: !0
				});
			}
			async _call(e, { max_length: t = null } = {}) {
				return (0, r.validate_audio_inputs)(e, "ClapFeatureExtractor"), { input_features: (await this._get_input_mel(e, t ?? this.config.nb_max_samples, this.config.truncation, this.config.padding)).unsqueeze_(0) };
			}
		}
	}),
	"./src/models/clip/image_processing_clip.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			CLIPFeatureExtractor: () => a,
			CLIPImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
		class a extends i {}
	}),
	"./src/models/convnext/image_processing_convnext.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			ConvNextFeatureExtractor: () => a,
			ConvNextImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {
			constructor(e) {
				super(e), this.crop_pct = this.config.crop_pct ?? 224 / 256;
			}
			async resize(e) {
				let t = this.size?.shortest_edge;
				if (t === void 0) throw Error("Size dictionary must contain 'shortest_edge' key.");
				if (t < 384) {
					let n = Math.floor(t / this.crop_pct), [r, i] = this.get_resize_output_image_size(e, { shortest_edge: n });
					e = await e.resize(r, i, { resample: this.resample }), e = await e.center_crop(t, t);
				} else e = await e.resize(t, t, { resample: this.resample });
				return e;
			}
		}
		class a extends i {}
	}),
	"./src/models/dac/feature_extraction_dac.js": ((e, t, n) => {
		n.r(t), n.d(t, { DacFeatureExtractor: () => i });
		var r = n("./src/models/encodec/feature_extraction_encodec.js");
		class i extends r.EncodecFeatureExtractor {}
	}),
	"./src/models/deit/image_processing_deit.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			DeiTFeatureExtractor: () => a,
			DeiTImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
		class a extends i {}
	}),
	"./src/models/detr/image_processing_detr.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			DetrFeatureExtractor: () => o,
			DetrImageProcessor: () => a
		});
		var r = n("./src/base/image_processors_utils.js"), i = n("./src/utils/tensor.js");
		class a extends r.ImageProcessor {
			async _call(e) {
				let t = await super._call(e), n = [
					t.pixel_values.dims[0],
					64,
					64
				], r = (0, i.full)(n, 1n);
				return {
					...t,
					pixel_mask: r
				};
			}
			post_process_object_detection(...e) {
				return (0, r.post_process_object_detection)(...e);
			}
			post_process_panoptic_segmentation(...e) {
				return (0, r.post_process_panoptic_segmentation)(...e);
			}
			post_process_instance_segmentation(...e) {
				return (0, r.post_process_instance_segmentation)(...e);
			}
		}
		class o extends a {}
	}),
	"./src/models/dinov3_vit/image_processing_dinov3_vit.js": ((e, t, n) => {
		n.r(t), n.d(t, { DINOv3ViTImageProcessor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
	}),
	"./src/models/donut/image_processing_donut.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			DonutFeatureExtractor: () => a,
			DonutImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {
			pad_image(e, t, n, r = {}) {
				let [i, a, o] = t, s = this.image_mean;
				Array.isArray(this.image_mean) || (s = Array(o).fill(s));
				let c = this.image_std;
				Array.isArray(c) || (c = Array(o).fill(s));
				let l = s.map((e, t) => -e / c[t]);
				return super.pad_image(e, t, n, {
					center: !0,
					constant_values: l,
					...r
				});
			}
		}
		class a extends i {}
	}),
	"./src/models/dpt/image_processing_dpt.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			DPTFeatureExtractor: () => a,
			DPTImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
		class a extends i {}
	}),
	"./src/models/efficientnet/image_processing_efficientnet.js": ((e, t, n) => {
		n.r(t), n.d(t, { EfficientNetImageProcessor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {
			constructor(e) {
				super(e), this.include_top = this.config.include_top ?? !0, this.include_top && (this.image_std = this.image_std.map((e) => e * e));
			}
		}
	}),
	"./src/models/encodec/feature_extraction_encodec.js": ((e, t, n) => {
		n.r(t), n.d(t, { EncodecFeatureExtractor: () => a });
		var r = n("./src/base/feature_extraction_utils.js"), i = n("./src/utils/tensor.js");
		class a extends r.FeatureExtractor {
			async _call(e) {
				(0, r.validate_audio_inputs)(e, "EncodecFeatureExtractor"), e instanceof Float64Array && (e = new Float32Array(e));
				let t = this.config.feature_size;
				if (e.length % t !== 0) throw Error(`The length of the audio data must be a multiple of the number of channels (${t}).`);
				let n = [
					1,
					t,
					e.length / t
				];
				return { input_values: new i.Tensor("float32", e, n) };
			}
		}
	}),
	"./src/models/feature_extractors.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			ASTFeatureExtractor: () => r.ASTFeatureExtractor,
			ClapFeatureExtractor: () => a.ClapFeatureExtractor,
			DacFeatureExtractor: () => o.DacFeatureExtractor,
			EncodecFeatureExtractor: () => i.EncodecFeatureExtractor,
			Gemma3nAudioFeatureExtractor: () => s.Gemma3nAudioFeatureExtractor,
			ImageFeatureExtractor: () => _.ImageProcessor,
			MoonshineFeatureExtractor: () => c.MoonshineFeatureExtractor,
			ParakeetFeatureExtractor: () => l.ParakeetFeatureExtractor,
			PyAnnoteFeatureExtractor: () => u.PyAnnoteFeatureExtractor,
			SeamlessM4TFeatureExtractor: () => d.SeamlessM4TFeatureExtractor,
			SnacFeatureExtractor: () => f.SnacFeatureExtractor,
			SpeechT5FeatureExtractor: () => p.SpeechT5FeatureExtractor,
			Wav2Vec2FeatureExtractor: () => m.Wav2Vec2FeatureExtractor,
			WeSpeakerFeatureExtractor: () => h.WeSpeakerFeatureExtractor,
			WhisperFeatureExtractor: () => g.WhisperFeatureExtractor
		});
		var r = n("./src/models/audio_spectrogram_transformer/feature_extraction_audio_spectrogram_transformer.js"), i = n("./src/models/encodec/feature_extraction_encodec.js"), a = n("./src/models/clap/feature_extraction_clap.js"), o = n("./src/models/dac/feature_extraction_dac.js"), s = n("./src/models/gemma3n/feature_extraction_gemma3n.js"), c = n("./src/models/moonshine/feature_extraction_moonshine.js"), l = n("./src/models/parakeet/feature_extraction_parakeet.js"), u = n("./src/models/pyannote/feature_extraction_pyannote.js"), d = n("./src/models/seamless_m4t/feature_extraction_seamless_m4t.js"), f = n("./src/models/snac/feature_extraction_snac.js"), p = n("./src/models/speecht5/feature_extraction_speecht5.js"), m = n("./src/models/wav2vec2/feature_extraction_wav2vec2.js"), h = n("./src/models/wespeaker/feature_extraction_wespeaker.js"), g = n("./src/models/whisper/feature_extraction_whisper.js"), _ = n("./src/base/image_processors_utils.js");
	}),
	"./src/models/florence2/processing_florence2.js": ((e, t, n) => {
		n.r(t), n.d(t, { Florence2Processor: () => o });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/auto/image_processing_auto.js"), a = n("./src/tokenizers.js");
		class o extends r.Processor {
			static tokenizer_class = a.AutoTokenizer;
			static image_processor_class = i.AutoImageProcessor;
			constructor(e, t, n) {
				super(e, t, n);
				let { tasks_answer_post_processing_type: r, task_prompts_without_inputs: i, task_prompts_with_input: a } = this.image_processor.config;
				this.tasks_answer_post_processing_type = new Map(Object.entries(r ?? {})), this.task_prompts_without_inputs = new Map(Object.entries(i ?? {})), this.task_prompts_with_input = new Map(Object.entries(a ?? {})), this.regexes = {
					quad_boxes: /(.+?)<loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)>/gm,
					bboxes: /([^<]+)?<loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)>/gm
				}, this.size_per_bin = 1e3;
			}
			construct_prompts(e) {
				typeof e == "string" && (e = [e]);
				let t = [];
				for (let n of e) if (this.task_prompts_without_inputs.has(n)) t.push(this.task_prompts_without_inputs.get(n));
				else {
					for (let [e, r] of this.task_prompts_with_input) if (n.includes(e)) {
						t.push(r.replaceAll("{input}", n).replaceAll(e, ""));
						break;
					}
					t.length !== e.length && t.push(n);
				}
				return t;
			}
			post_process_generation(e, t, n) {
				let r = this.tasks_answer_post_processing_type.get(t) ?? "pure_text";
				e = e.replaceAll("<s>", "").replaceAll("</s>", "");
				let i;
				switch (r) {
					case "pure_text":
						i = e;
						break;
					case "description_with_bboxes":
					case "bboxes":
					case "phrase_grounding":
					case "ocr":
						let a = r === "ocr" ? "quad_boxes" : "bboxes", o = e.matchAll(this.regexes[a]), s = [], c = [];
						for (let [e, t, ...r] of o) s.push(t ? t.trim() : s.at(-1) ?? ""), c.push(r.map((e, t) => (Number(e) + .5) / this.size_per_bin * n[t % 2]));
						i = {
							labels: s,
							[a]: c
						};
						break;
					default: throw Error(`Task "${t}" (of type "${r}") not yet implemented.`);
				}
				return { [t]: i };
			}
			async _call(e, t = null, n = {}) {
				if (!e && !t) throw Error("Either text or images must be provided");
				let r = await this.image_processor(e, n), i = t ? this.tokenizer(this.construct_prompts(t), n) : {};
				return {
					...r,
					...i
				};
			}
		}
	}),
	"./src/models/gemma3n/feature_extraction_gemma3n.js": ((e, t, n) => {
		n.r(t), n.d(t, { Gemma3nAudioFeatureExtractor: () => o });
		var r = n("./src/base/feature_extraction_utils.js"), i = n("./src/utils/tensor.js"), a = n("./src/utils/audio.js");
		class o extends r.FeatureExtractor {
			constructor(e) {
				super(e);
				let { fft_length: t, feature_size: n, min_frequency: r, max_frequency: i, sampling_rate: o, frame_length: s } = this.config, c = (0, a.mel_filter_bank)(Math.floor(1 + t / 2), n, r, i, o, null, "htk", !1);
				this.mel_filters = c, this.window = (0, a.window_function)(s, "hann");
			}
			async _extract_fbank_features(e, t) {
				return (0, a.spectrogram)(e, this.window, this.config.frame_length, this.config.hop_length, {
					fft_length: this.config.fft_length,
					center: !1,
					onesided: !0,
					preemphasis: this.config.preemphasis,
					preemphasis_htk_flavor: this.config.preemphasis_htk_flavor,
					mel_filters: this.mel_filters,
					log_mel: "log",
					mel_floor: this.config.mel_floor,
					remove_dc_offset: !1,
					transpose: !0
				});
			}
			async _call(e, { max_length: t = 48e4, truncation: n = !0, padding: a = !0, pad_to_multiple_of: o = 128 } = {}) {
				if ((0, r.validate_audio_inputs)(e, "Gemma3nAudioFeatureExtractor"), n && e.length > t && (e = e.slice(0, t)), a && e.length % o !== 0) {
					let t = o - e.length % o, n = new Float64Array(e.length + t);
					n.set(e), this.config.padding_value !== 0 && n.fill(this.config.padding_value, e.length), e = n;
				}
				let s = await this._extract_fbank_features(e, this.config.max_length), c = (0, i.full)([1, s.dims[0]], !0);
				return {
					input_features: s.unsqueeze_(0),
					input_features_mask: c
				};
			}
		}
	}),
	"./src/models/gemma3n/processing_gemma3n.js": ((e, t, n) => {
		n.r(t), n.d(t, { Gemma3nProcessor: () => s });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/auto/image_processing_auto.js"), a = n("./src/models/auto/feature_extraction_auto.js"), o = n("./src/tokenizers.js");
		n("./src/utils/image.js"), n("./src/utils/audio.js");
		class s extends r.Processor {
			static image_processor_class = i.AutoImageProcessor;
			static feature_extractor_class = a.AutoFeatureExtractor;
			static tokenizer_class = o.AutoTokenizer;
			static uses_processor_config = !0;
			static uses_chat_template_file = !0;
			constructor(e, t, n) {
				super(e, t, n), this.audio_seq_length = this.config.audio_seq_length, this.image_seq_length = this.config.image_seq_length;
				let { audio_token_id: r, boa_token: i, audio_token: a, eoa_token: o, image_token_id: s, boi_token: c, image_token: l, eoi_token: u } = this.tokenizer.config;
				this.audio_token_id = r, this.boa_token = i, this.audio_token = a;
				let d = a.repeat(this.audio_seq_length);
				this.full_audio_sequence = `\n\n${i}${d}${o}\n\n`, this.image_token_id = s, this.boi_token = c, this.image_token = l;
				let f = l.repeat(this.image_seq_length);
				this.full_image_sequence = `\n\n${c}${f}${u}\n\n`;
			}
			async _call(e, t = null, n = null, r = {}) {
				typeof e == "string" && (e = [e]);
				let i;
				n && (i = await this.feature_extractor(n, r), e = e.map((e) => e.replaceAll(this.audio_token, this.full_audio_sequence)));
				let a;
				return t && (a = await this.image_processor(t, r), e = e.map((e) => e.replaceAll(this.image_token, this.full_image_sequence))), {
					...this.tokenizer(e, r),
					...a,
					...i
				};
			}
		}
	}),
	"./src/models/glpn/image_processing_glpn.js": ((e, t, n) => {
		n.r(t), n.d(t, { GLPNFeatureExtractor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
	}),
	"./src/models/grounding_dino/image_processing_grounding_dino.js": ((e, t, n) => {
		n.r(t), n.d(t, { GroundingDinoImageProcessor: () => a });
		var r = n("./src/base/image_processors_utils.js"), i = n("./src/utils/tensor.js");
		class a extends r.ImageProcessor {
			async _call(e) {
				let t = await super._call(e), n = t.pixel_values.dims, r = (0, i.ones)([
					n[0],
					n[2],
					n[3]
				]);
				return {
					...t,
					pixel_mask: r
				};
			}
		}
	}),
	"./src/models/grounding_dino/processing_grounding_dino.js": ((e, t, n) => {
		n.r(t), n.d(t, { GroundingDinoProcessor: () => c });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/auto/image_processing_auto.js"), a = n("./src/tokenizers.js"), o = n("./src/base/image_processors_utils.js");
		function s(e, t) {
			let n = e.dims.at(-1) - 1, r = e.tolist();
			r.fill(!1, 0, 1), r.fill(!1, n);
			let i = t.tolist();
			return r.map((e, t) => e ? t : null).filter((e) => e !== null).map((e) => i[e]);
		}
		class c extends r.Processor {
			static tokenizer_class = a.AutoTokenizer;
			static image_processor_class = i.AutoImageProcessor;
			async _call(e, t, n = {}) {
				let r = e ? await this.image_processor(e, n) : {};
				return {
					...t ? this.tokenizer(t, n) : {},
					...r
				};
			}
			post_process_grounded_object_detection(e, t, { box_threshold: n = .25, text_threshold: r = .25, target_sizes: i = null } = {}) {
				let { logits: a, pred_boxes: c } = e, l = a.dims[0];
				if (i !== null && i.length !== l) throw Error("Make sure that you pass in as many target sizes as the batch dimension of the logits");
				let u = a.dims.at(1), d = a.sigmoid(), f = d.max(-1).tolist(), p = c.tolist().map((e) => e.map((e) => (0, o.center_to_corners_format)(e))), m = [];
				for (let e = 0; e < l; ++e) {
					let a = i === null ? null : i[e];
					a !== null && (p[e] = p[e].map((e) => e.map((e, t) => e * a[(t + 1) % 2])));
					let o = f[e], c = [], l = [], h = [];
					for (let i = 0; i < u; ++i) {
						let a = o[i];
						if (a <= n) continue;
						let u = p[e][i], f = d[e][i];
						c.push(a), h.push(u);
						let m = s(f.gt(r), t[e]);
						l.push(m);
					}
					m.push({
						scores: c,
						boxes: h,
						labels: this.batch_decode(l)
					});
				}
				return m;
			}
		}
	}),
	"./src/models/idefics3/image_processing_idefics3.js": ((e, t, n) => {
		n.r(t), n.d(t, { Idefics3ImageProcessor: () => a });
		var r = n("./src/base/image_processors_utils.js"), i = n("./src/utils/tensor.js");
		class a extends r.ImageProcessor {
			constructor(e) {
				super(e), this.do_image_splitting = e.do_image_splitting ?? !0, this.max_image_size = e.max_image_size;
			}
			get_resize_for_vision_encoder(e, t) {
				let [n, r] = e.dims.slice(-2), i = r / n;
				return r >= n ? (r = Math.ceil(r / t) * t, n = Math.floor(r / i), n = Math.ceil(n / t) * t) : (n = Math.ceil(n / t) * t, r = Math.floor(n * i), r = Math.ceil(r / t) * t), {
					height: n,
					width: r
				};
			}
			async _call(e, { do_image_splitting: t = null, return_row_col_info: n = !1 } = {}) {
				let r;
				if (!Array.isArray(e)) r = [[e]];
				else {
					if (e.length === 0 || !e[0]) throw Error("No images provided.");
					r = Array.isArray(e[0]) ? e : [e];
				}
				let a = [], o = [], s = [], c = [], l = [];
				for (let e of r) {
					let n = await Promise.all(e.map((e) => this.preprocess(e)));
					c.push(...n.map((e) => e.original_size)), l.push(...n.map((e) => e.reshaped_input_size)), n.forEach((e) => e.pixel_values.unsqueeze_(0));
					let { longest_edge: r } = this.max_image_size, u;
					if (t ?? this.do_image_splitting) {
						let e = Array(n.length), t = Array(n.length);
						u = await Promise.all(n.map(async (n, a) => {
							let o = this.get_resize_for_vision_encoder(n.pixel_values, r), s = await (0, i.interpolate_4d)(n.pixel_values, { size: [o.height, o.width] }), { frames: c, num_splits_h: l, num_splits_w: u } = await this.split_image(s, this.max_image_size);
							return e[a] = l, t[a] = u, (0, i.cat)(c, 0);
						})), o.push(e), s.push(t);
					} else {
						let e = [r, r];
						u = await Promise.all(n.map((t) => (0, i.interpolate_4d)(t.pixel_values, { size: e }))), o.push(Array(n.length).fill(0)), s.push(Array(n.length).fill(0));
					}
					a.push((0, i.cat)(u, 0));
				}
				let u = a.length, [d, f, p, m] = a[0].dims, h, g;
				if (u === 1) h = a[0].unsqueeze_(0), g = (0, i.full)([
					u,
					d,
					p,
					m
				], !0);
				else {
					let e = Math.max(...a.map((e) => e.dims.at(0)));
					g = (0, i.full)([
						u,
						e,
						p,
						m
					], !0);
					let t = g.data, n = e * p * m;
					for (let r = 0; r < u; ++r) {
						let o = a[r].dims[0];
						if (o < e) {
							a[r] = (0, i.cat)([a[r], (0, i.full)([
								e - o,
								f,
								p,
								m
							], 0)], 0);
							let s = r * n + o * p * m, c = (r + 1) * n;
							t.fill(!1, s, c);
						}
					}
					h = (0, i.stack)(a, 0);
				}
				return {
					pixel_values: h,
					pixel_attention_mask: g,
					original_sizes: c,
					reshaped_input_sizes: l,
					...n ? {
						rows: o,
						cols: s
					} : {}
				};
			}
			async split_image(e, { longest_edge: t }) {
				let n = t, r = t, a = [], [o, s] = e.dims.slice(-2), c = 0, l = 0;
				if (o > n || s > r) {
					c = Math.ceil(o / n), l = Math.ceil(s / r);
					let t = Math.ceil(o / c), u = Math.ceil(s / l);
					for (let n = 0; n < c; ++n) for (let r = 0; r < l; ++r) {
						let d, f, p, m;
						n === c - 1 ? (f = o - t, m = o) : (f = n * t, m = (n + 1) * t), r === l - 1 ? (d = s - u, p = s) : (d = r * u, p = (r + 1) * u);
						let h = [f, d], g = [m, p], _ = await (0, i.slice)(e, h, g, [2, 3]);
						a.push(_);
					}
					let d = n, f = r;
					(o !== d || s !== f) && (e = await (0, i.interpolate_4d)(e, { size: [d, f] }));
				}
				return a.push(e), {
					frames: a,
					num_splits_h: c,
					num_splits_w: l
				};
			}
		}
	}),
	"./src/models/idefics3/processing_idefics3.js": ((e, t, n) => {
		n.r(t), n.d(t, { Idefics3Processor: () => u });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/auto/image_processing_auto.js"), a = n("./src/tokenizers.js");
		n("./src/utils/image.js");
		var o = n("./src/utils/core.js");
		function s(e, t, n, r, i, a) {
			let o = "";
			for (let a = 0; a < t; ++a) {
				for (let t = 0; t < n; ++t) o += r + `<row_${a + 1}_col_${t + 1}>` + i.repeat(e);
				o += "\n";
			}
			return o += `\n${r}${a}` + i.repeat(e) + `${r}`, o;
		}
		function c(e, t, n, r) {
			return `${t}${r}` + n.repeat(e) + `${t}`;
		}
		function l(e, t, n, r, i, a) {
			return e === 0 && t === 0 ? c(n, r, i, a) : s(n, e, t, r, i, a);
		}
		class u extends r.Processor {
			static image_processor_class = i.AutoImageProcessor;
			static tokenizer_class = a.AutoTokenizer;
			static uses_processor_config = !0;
			fake_image_token = "<fake_token_around_image>";
			image_token = "<image>";
			global_img_token = "<global-img>";
			async _call(e, t = null, n = {}) {
				n.return_row_col_info ??= !0;
				let r;
				t && (r = await this.image_processor(t, n)), Array.isArray(e) || (e = [e]);
				let i = r.rows ?? [Array(e.length).fill(0)], a = r.cols ?? [Array(e.length).fill(0)], s = this.config.image_seq_len, c = [], u = [];
				for (let t = 0; t < e.length; ++t) {
					let n = e[t], r = i[t], d = a[t];
					c.push((0, o.count)(n, this.image_token));
					let f = r.map((e, t) => l(e, d[t], s, this.fake_image_token, this.image_token, this.global_img_token)), p = n.split(this.image_token);
					if (p.length === 0) throw Error("The image token should be present in the text.");
					let m = p[0];
					for (let e = 0; e < f.length; ++e) m += f[e] + p[e + 1];
					u.push(m);
				}
				return {
					...this.tokenizer(u),
					...r
				};
			}
		}
	}),
	"./src/models/image_processors.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			BeitFeatureExtractor: () => r.BeitFeatureExtractor,
			BitImageProcessor: () => i.BitImageProcessor,
			CLIPFeatureExtractor: () => o.CLIPFeatureExtractor,
			CLIPImageProcessor: () => o.CLIPImageProcessor,
			ChineseCLIPFeatureExtractor: () => a.ChineseCLIPFeatureExtractor,
			ConvNextFeatureExtractor: () => s.ConvNextFeatureExtractor,
			ConvNextImageProcessor: () => s.ConvNextImageProcessor,
			DINOv3ViTImageProcessor: () => u.DINOv3ViTImageProcessor,
			DPTFeatureExtractor: () => f.DPTFeatureExtractor,
			DPTImageProcessor: () => f.DPTImageProcessor,
			DeiTFeatureExtractor: () => c.DeiTFeatureExtractor,
			DeiTImageProcessor: () => c.DeiTImageProcessor,
			DetrFeatureExtractor: () => l.DetrFeatureExtractor,
			DetrImageProcessor: () => l.DetrImageProcessor,
			DonutFeatureExtractor: () => d.DonutFeatureExtractor,
			DonutImageProcessor: () => d.DonutImageProcessor,
			EfficientNetImageProcessor: () => p.EfficientNetImageProcessor,
			GLPNFeatureExtractor: () => m.GLPNFeatureExtractor,
			GroundingDinoImageProcessor: () => h.GroundingDinoImageProcessor,
			Idefics3ImageProcessor: () => g.Idefics3ImageProcessor,
			JinaCLIPImageProcessor: () => v.JinaCLIPImageProcessor,
			LlavaOnevisionImageProcessor: () => y.LlavaOnevisionImageProcessor,
			Mask2FormerImageProcessor: () => b.Mask2FormerImageProcessor,
			MaskFormerFeatureExtractor: () => x.MaskFormerFeatureExtractor,
			MaskFormerImageProcessor: () => x.MaskFormerImageProcessor,
			MobileNetV1FeatureExtractor: () => S.MobileNetV1FeatureExtractor,
			MobileNetV1ImageProcessor: () => S.MobileNetV1ImageProcessor,
			MobileNetV2FeatureExtractor: () => C.MobileNetV2FeatureExtractor,
			MobileNetV2ImageProcessor: () => C.MobileNetV2ImageProcessor,
			MobileNetV3FeatureExtractor: () => w.MobileNetV3FeatureExtractor,
			MobileNetV3ImageProcessor: () => w.MobileNetV3ImageProcessor,
			MobileNetV4FeatureExtractor: () => T.MobileNetV4FeatureExtractor,
			MobileNetV4ImageProcessor: () => T.MobileNetV4ImageProcessor,
			MobileViTFeatureExtractor: () => E.MobileViTFeatureExtractor,
			MobileViTImageProcessor: () => E.MobileViTImageProcessor,
			NougatImageProcessor: () => D.NougatImageProcessor,
			OwlViTFeatureExtractor: () => k.OwlViTFeatureExtractor,
			OwlViTImageProcessor: () => k.OwlViTImageProcessor,
			Owlv2ImageProcessor: () => O.Owlv2ImageProcessor,
			Phi3VImageProcessor: () => A.Phi3VImageProcessor,
			PixtralImageProcessor: () => ee.PixtralImageProcessor,
			PvtImageProcessor: () => te.PvtImageProcessor,
			Qwen2VLImageProcessor: () => j.Qwen2VLImageProcessor,
			RTDetrImageProcessor: () => M.RTDetrImageProcessor,
			Sam2ImageProcessor: () => ne.Sam2ImageProcessor,
			Sam3ImageProcessor: () => P.Sam3ImageProcessor,
			SamImageProcessor: () => N.SamImageProcessor,
			SegformerFeatureExtractor: () => F.SegformerFeatureExtractor,
			SegformerImageProcessor: () => F.SegformerImageProcessor,
			SiglipImageProcessor: () => re.SiglipImageProcessor,
			SmolVLMImageProcessor: () => ie.SmolVLMImageProcessor,
			Swin2SRImageProcessor: () => I.Swin2SRImageProcessor,
			VLMImageProcessor: () => _.VLMImageProcessor,
			ViTFeatureExtractor: () => L.ViTFeatureExtractor,
			ViTImageProcessor: () => L.ViTImageProcessor,
			VitMatteImageProcessor: () => ae.VitMatteImageProcessor,
			VitPoseImageProcessor: () => oe.VitPoseImageProcessor,
			YolosFeatureExtractor: () => se.YolosFeatureExtractor,
			YolosImageProcessor: () => se.YolosImageProcessor
		});
		var r = n("./src/models/beit/image_processing_beit.js"), i = n("./src/models/bit/image_processing_bit.js"), a = n("./src/models/chinese_clip/image_processing_chinese_clip.js"), o = n("./src/models/clip/image_processing_clip.js"), s = n("./src/models/convnext/image_processing_convnext.js"), c = n("./src/models/deit/image_processing_deit.js"), l = n("./src/models/detr/image_processing_detr.js"), u = n("./src/models/dinov3_vit/image_processing_dinov3_vit.js"), d = n("./src/models/donut/image_processing_donut.js"), f = n("./src/models/dpt/image_processing_dpt.js"), p = n("./src/models/efficientnet/image_processing_efficientnet.js"), m = n("./src/models/glpn/image_processing_glpn.js"), h = n("./src/models/grounding_dino/image_processing_grounding_dino.js"), g = n("./src/models/idefics3/image_processing_idefics3.js"), _ = n("./src/models/janus/image_processing_janus.js"), v = n("./src/models/jina_clip/image_processing_jina_clip.js"), y = n("./src/models/llava_onevision/image_processing_llava_onevision.js"), b = n("./src/models/mask2former/image_processing_mask2former.js"), x = n("./src/models/maskformer/image_processing_maskformer.js"), S = n("./src/models/mobilenet_v1/image_processing_mobilenet_v1.js"), C = n("./src/models/mobilenet_v2/image_processing_mobilenet_v2.js"), w = n("./src/models/mobilenet_v3/image_processing_mobilenet_v3.js"), T = n("./src/models/mobilenet_v4/image_processing_mobilenet_v4.js"), E = n("./src/models/mobilevit/image_processing_mobilevit.js"), D = n("./src/models/nougat/image_processing_nougat.js"), O = n("./src/models/owlv2/image_processing_owlv2.js"), k = n("./src/models/owlvit/image_processing_owlvit.js"), A = n("./src/models/phi3_v/image_processing_phi3_v.js"), ee = n("./src/models/pixtral/image_processing_pixtral.js"), te = n("./src/models/pvt/image_processing_pvt.js"), j = n("./src/models/qwen2_vl/image_processing_qwen2_vl.js"), M = n("./src/models/rt_detr/image_processing_rt_detr.js"), N = n("./src/models/sam/image_processing_sam.js"), ne = n("./src/models/sam2/image_processing_sam2.js"), P = n("./src/models/sam3/image_processing_sam3.js"), F = n("./src/models/segformer/image_processing_segformer.js"), re = n("./src/models/siglip/image_processing_siglip.js"), ie = n("./src/models/smolvlm/image_processing_smolvlm.js"), I = n("./src/models/swin2sr/image_processing_swin2sr.js"), L = n("./src/models/vit/image_processing_vit.js"), ae = n("./src/models/vitmatte/image_processing_vitmatte.js"), oe = n("./src/models/vitpose/image_processing_vitpose.js"), se = n("./src/models/yolos/image_processing_yolos.js");
	}),
	"./src/models/janus/image_processing_janus.js": ((e, t, n) => {
		n.r(t), n.d(t, { VLMImageProcessor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {
			constructor(e) {
				super({
					do_pad: !0,
					pad_size: {
						width: e.image_size,
						height: e.image_size
					},
					...e
				}), this.constant_values = this.config.background_color.map((e) => e * this.rescale_factor);
			}
			pad_image(e, t, n, r) {
				return super.pad_image(e, t, n, {
					constant_values: this.constant_values,
					center: !0,
					...r
				});
			}
		}
	}),
	"./src/models/janus/processing_janus.js": ((e, t, n) => {
		n.r(t), n.d(t, { VLChatProcessor: () => l });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/auto/image_processing_auto.js"), a = n("./src/tokenizers.js"), o = n("./src/utils/core.js"), s = n("./src/utils/tensor.js"), c = n("./src/utils/image.js");
		class l extends r.Processor {
			static image_processor_class = i.AutoImageProcessor;
			static tokenizer_class = a.AutoTokenizer;
			static uses_processor_config = !0;
			constructor(e, t, n) {
				super(e, t, n), this.image_tag = this.config.image_tag, this.image_start_tag = this.config.image_start_tag, this.image_end_tag = this.config.image_end_tag, this.num_image_tokens = this.config.num_image_tokens;
			}
			async _call(e, { images: t = null, chat_template: n = "default" } = {}) {
				t ? Array.isArray(t) || (t = [t]) : t = await Promise.all(e.filter((e) => e.images).flatMap((e) => e.images).map((e) => c.RawImage.read(e)));
				let r = this.tokenizer, i = r.apply_chat_template(e, {
					tokenize: !1,
					add_generation_prompt: !0,
					chat_template: n
				}), a = (e) => r.encode(e, { add_special_tokens: !1 }), l = i.split(this.image_tag), u = l.length - 1;
				if (t.length !== u) throw Error(`Number of images provided (${t.length}) does not match number of "${this.image_tag}" image tags (${u})`);
				let [d, f, p] = r.model.convert_tokens_to_ids([
					this.image_tag,
					this.image_start_tag,
					this.image_end_tag
				]), m = a(l[0]), h = Array(m.length).fill(!1);
				for (let e = 1; e < l.length; ++e) {
					let t = Array(this.num_image_tokens).fill(d), n = a(l[e]);
					m = (0, o.mergeArrays)(m, [f], t, [p], n);
					let r = Array(this.num_image_tokens).fill(!0);
					h = (0, o.mergeArrays)(h, [!1], r, [!1], Array(n.length).fill(!1));
				}
				let g = [1, m.length], _ = {
					input_ids: new s.Tensor("int64", m, g),
					attention_mask: new s.Tensor("int64", Array(m.length).fill(1), g),
					images_seq_mask: new s.Tensor("bool", h, g),
					images_emb_mask: new s.Tensor("bool", Array(u * this.num_image_tokens).fill(!0), [
						1,
						u,
						this.num_image_tokens
					])
				};
				if (t && t.length > 0) {
					let e = await this.image_processor(t);
					return e.pixel_values.unsqueeze_(0), {
						..._,
						...e
					};
				}
				return _;
			}
		}
	}),
	"./src/models/jina_clip/image_processing_jina_clip.js": ((e, t, n) => {
		n.r(t), n.d(t, { JinaCLIPImageProcessor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {
			constructor(e) {
				let { resize_mode: t, fill_color: n, interpolation: r, size: i, ...a } = e, o = t === "squash" ? {
					width: i,
					height: i
				} : t === "shortest" ? { shortest_edge: i } : { longest_edge: i }, s = r === "bicubic" ? 3 : 2;
				super({
					...a,
					size: o,
					resample: s,
					do_center_crop: !0,
					crop_size: i,
					do_normalize: !0
				});
			}
		}
	}),
	"./src/models/jina_clip/processing_jina_clip.js": ((e, t, n) => {
		n.r(t), n.d(t, { JinaCLIPProcessor: () => o });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/auto/image_processing_auto.js"), a = n("./src/tokenizers.js");
		class o extends r.Processor {
			static tokenizer_class = a.AutoTokenizer;
			static image_processor_class = i.AutoImageProcessor;
			async _call(e = null, t = null, n = {}) {
				if (!e && !t) throw Error("Either text or images must be provided");
				let r = e ? this.tokenizer(e, n) : {}, i = t ? await this.image_processor(t, n) : {};
				return {
					...r,
					...i
				};
			}
		}
	}),
	"./src/models/llava/processing_llava.js": ((e, t, n) => {
		n.r(t), n.d(t, { LlavaProcessor: () => o });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/auto/image_processing_auto.js"), a = n("./src/tokenizers.js");
		class o extends r.Processor {
			static tokenizer_class = a.AutoTokenizer;
			static image_processor_class = i.AutoImageProcessor;
			static uses_processor_config = !0;
			async _call(e, t = null, n = {}) {
				let r = await this.image_processor(e, n);
				if (t) {
					let [e, n] = r.pixel_values.dims.slice(-2), { image_token: i, patch_size: a, num_additional_image_tokens: o } = this.config, s = Math.floor(e / a) * Math.floor(n / a) + o;
					t = structuredClone(t), Array.isArray(t) || (t = [t]);
					for (let e = 0; e < t.length; ++e) t[e] = t[e].replace(i, i.repeat(s));
				}
				let i = t ? this.tokenizer(t, n) : {};
				return {
					...r,
					...i
				};
			}
		}
	}),
	"./src/models/llava_onevision/image_processing_llava_onevision.js": ((e, t, n) => {
		n.r(t), n.d(t, { LlavaOnevisionImageProcessor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
	}),
	"./src/models/mask2former/image_processing_mask2former.js": ((e, t, n) => {
		n.r(t), n.d(t, { Mask2FormerImageProcessor: () => i });
		var r = n("./src/models/maskformer/image_processing_maskformer.js");
		class i extends r.MaskFormerImageProcessor {}
	}),
	"./src/models/maskformer/image_processing_maskformer.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			MaskFormerFeatureExtractor: () => a,
			MaskFormerImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {
			post_process_panoptic_segmentation(...e) {
				return (0, r.post_process_panoptic_segmentation)(...e);
			}
			post_process_instance_segmentation(...e) {
				return (0, r.post_process_instance_segmentation)(...e);
			}
		}
		class a extends i {}
	}),
	"./src/models/mgp_str/processing_mgp_str.js": ((e, t, n) => {
		n.r(t), n.d(t, { MgpstrProcessor: () => c });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/auto/image_processing_auto.js"), a = n("./src/tokenizers.js"), o = n("./src/utils/maths.js");
		let s = {
			char: ["char_decode", 1],
			bpe: ["bpe_decode", 2],
			wp: ["wp_decode", 102]
		};
		class c extends r.Processor {
			static tokenizer_class = a.AutoTokenizer;
			static image_processor_class = i.AutoImageProcessor;
			get char_tokenizer() {
				return this.components.char_tokenizer;
			}
			get bpe_tokenizer() {
				return this.components.bpe_tokenizer;
			}
			get wp_tokenizer() {
				return this.components.wp_tokenizer;
			}
			_decode_helper(e, t) {
				if (!s.hasOwnProperty(t)) throw Error(`Format ${t} is not supported.`);
				let [n, r] = s[t], i = this[n].bind(this), [a, c] = e.dims, l = [], u = [], d = e.tolist();
				for (let e = 0; e < a; ++e) {
					let t = d[e], n = [], i = [];
					for (let e = 1; e < c; ++e) {
						let [a, s] = (0, o.max)((0, o.softmax)(t[e]));
						if (i.push(a), s == r) break;
						n.push(s);
					}
					let a = i.length > 0 ? i.reduce((e, t) => e * t, 1) : 0;
					u.push(n), l.push(a);
				}
				return [i(u), l];
			}
			char_decode(e) {
				return this.char_tokenizer.batch_decode(e).map((e) => e.replaceAll(" ", ""));
			}
			bpe_decode(e) {
				return this.bpe_tokenizer.batch_decode(e);
			}
			wp_decode(e) {
				return this.wp_tokenizer.batch_decode(e).map((e) => e.replaceAll(" ", ""));
			}
			batch_decode([e, t, n]) {
				let [r, i] = this._decode_helper(e, "char"), [a, s] = this._decode_helper(t, "bpe"), [c, l] = this._decode_helper(n, "wp"), u = [], d = [];
				for (let e = 0; e < r.length; ++e) {
					let [t, n] = (0, o.max)([
						i[e],
						s[e],
						l[e]
					]);
					u.push([
						r[e],
						a[e],
						c[e]
					][n]), d.push(t);
				}
				return {
					generated_text: u,
					scores: d,
					char_preds: r,
					bpe_preds: a,
					wp_preds: c
				};
			}
			static async from_pretrained(...e) {
				let t = await super.from_pretrained(...e), n = await a.AutoTokenizer.from_pretrained("Xenova/gpt2"), r = await a.AutoTokenizer.from_pretrained("Xenova/bert-base-uncased");
				return t.components = {
					image_processor: t.image_processor,
					char_tokenizer: t.tokenizer,
					bpe_tokenizer: n,
					wp_tokenizer: r
				}, t;
			}
			async _call(e, t = null) {
				let n = await this.image_processor(e);
				return t && (n.labels = this.tokenizer(t).input_ids), n;
			}
		}
	}),
	"./src/models/mobilenet_v1/image_processing_mobilenet_v1.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			MobileNetV1FeatureExtractor: () => a,
			MobileNetV1ImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
		class a extends i {}
	}),
	"./src/models/mobilenet_v2/image_processing_mobilenet_v2.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			MobileNetV2FeatureExtractor: () => a,
			MobileNetV2ImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
		class a extends i {}
	}),
	"./src/models/mobilenet_v3/image_processing_mobilenet_v3.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			MobileNetV3FeatureExtractor: () => a,
			MobileNetV3ImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
		class a extends i {}
	}),
	"./src/models/mobilenet_v4/image_processing_mobilenet_v4.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			MobileNetV4FeatureExtractor: () => a,
			MobileNetV4ImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
		class a extends i {}
	}),
	"./src/models/mobilevit/image_processing_mobilevit.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			MobileViTFeatureExtractor: () => a,
			MobileViTImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
		class a extends i {}
	}),
	"./src/models/moonshine/feature_extraction_moonshine.js": ((e, t, n) => {
		n.r(t), n.d(t, { MoonshineFeatureExtractor: () => a });
		var r = n("./src/base/feature_extraction_utils.js"), i = n("./src/utils/tensor.js");
		class a extends r.FeatureExtractor {
			async _call(e) {
				(0, r.validate_audio_inputs)(e, "MoonshineFeatureExtractor"), e instanceof Float64Array && (e = new Float32Array(e));
				let t = [1, e.length];
				return { input_values: new i.Tensor("float32", e, t) };
			}
		}
	}),
	"./src/models/moonshine/processing_moonshine.js": ((e, t, n) => {
		n.r(t), n.d(t, { MoonshineProcessor: () => o });
		var r = n("./src/models/auto/feature_extraction_auto.js"), i = n("./src/tokenizers.js"), a = n("./src/base/processing_utils.js");
		class o extends a.Processor {
			static tokenizer_class = i.AutoTokenizer;
			static feature_extractor_class = r.AutoFeatureExtractor;
			async _call(e) {
				return await this.feature_extractor(e);
			}
		}
	}),
	"./src/models/nougat/image_processing_nougat.js": ((e, t, n) => {
		n.r(t), n.d(t, { NougatImageProcessor: () => i });
		var r = n("./src/models/donut/image_processing_donut.js");
		class i extends r.DonutImageProcessor {}
	}),
	"./src/models/owlv2/image_processing_owlv2.js": ((e, t, n) => {
		n.r(t), n.d(t, { Owlv2ImageProcessor: () => i });
		var r = n("./src/models/owlvit/image_processing_owlvit.js");
		class i extends r.OwlViTImageProcessor {}
	}),
	"./src/models/owlvit/image_processing_owlvit.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			OwlViTFeatureExtractor: () => a,
			OwlViTImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {
			post_process_object_detection(...e) {
				return (0, r.post_process_object_detection)(...e);
			}
		}
		class a extends i {}
	}),
	"./src/models/owlvit/processing_owlvit.js": ((e, t, n) => {
		n.r(t), n.d(t, { OwlViTProcessor: () => o });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/auto/image_processing_auto.js"), a = n("./src/tokenizers.js");
		class o extends r.Processor {
			static tokenizer_class = a.AutoTokenizer;
			static image_processor_class = i.AutoImageProcessor;
		}
	}),
	"./src/models/paligemma/processing_paligemma.js": ((e, t, n) => {
		n.r(t), n.d(t, { PaliGemmaProcessor: () => c });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/auto/image_processing_auto.js"), a = n("./src/tokenizers.js");
		let o = "<image>";
		function s(e, t, n, r, i) {
			return `${r.repeat(n * i)}${t}${e}\n`;
		}
		class c extends r.Processor {
			static tokenizer_class = a.AutoTokenizer;
			static image_processor_class = i.AutoImageProcessor;
			static uses_processor_config = !1;
			async _call(e, t = null, n = {}) {
				t ||= (console.warn("You are using PaliGemma without a text prefix. It will perform as a picture-captioning model."), ""), Array.isArray(e) || (e = [e]), Array.isArray(t) || (t = [t]);
				let r = this.tokenizer.bos_token, i = this.image_processor.config.image_seq_length, a;
				t.some((e) => e.includes(o)) ? a = t.map((e) => {
					let t = e.replaceAll(o, o.repeat(i)), n = t.lastIndexOf(o), a = n === -1 ? 0 : n + 7;
					return t.slice(0, a) + r + t.slice(a) + "\n";
				}) : (console.warn("You are passing both `text` and `images` to `PaliGemmaProcessor`. The processor expects special image tokens in the text, as many tokens as there are images per each text. It is recommended to add `<image>` tokens in the very beginning of your text. For this call, we will infer how many images each text has and add special tokens."), a = t.map((t) => s(t, r, i, o, e.length)));
				let c = this.tokenizer(a, n);
				return {
					...await this.image_processor(e, n),
					...c
				};
			}
		}
	}),
	"./src/models/parakeet/feature_extraction_parakeet.js": ((e, t, n) => {
		n.r(t), n.d(t, { ParakeetFeatureExtractor: () => o });
		var r = n("./src/base/feature_extraction_utils.js"), i = n("./src/utils/tensor.js"), a = n("./src/utils/audio.js");
		class o extends r.FeatureExtractor {
			constructor(e) {
				super(e), this.config.mel_filters ??= (0, a.mel_filter_bank)(Math.floor(1 + this.config.n_fft / 2), this.config.feature_size, 0, this.config.sampling_rate / 2, this.config.sampling_rate, "slaney", "slaney");
				let t = (0, a.window_function)(this.config.win_length, "hann", { periodic: !1 });
				this.window = new Float64Array(this.config.n_fft);
				let n = Math.floor((this.config.n_fft - this.config.win_length) / 2);
				this.window.set(t, n);
			}
			async _extract_fbank_features(e) {
				let t = this.config.preemphasis;
				e = new Float64Array(e);
				for (let n = e.length - 1; n >= 1; --n) e[n] -= t * e[n - 1];
				return await (0, a.spectrogram)(e, this.window, this.window.length, this.config.hop_length, {
					fft_length: this.config.n_fft,
					power: 2,
					mel_filters: this.config.mel_filters,
					log_mel: "log",
					mel_floor: -Infinity,
					pad_mode: "constant",
					center: !0,
					transpose: !0,
					mel_offset: 2 ** -24
				});
			}
			async _call(e) {
				(0, r.validate_audio_inputs)(e, "ParakeetFeatureExtractor");
				let t = await this._extract_fbank_features(e), n = Math.floor((e.length + Math.floor(this.config.n_fft / 2) * 2 - this.config.n_fft) / this.config.hop_length), a = t.data;
				a.fill(0, n * t.dims[1]);
				let [o, s] = t.dims, c = new Float64Array(s), l = new Float64Array(s);
				for (let e = 0; e < n; ++e) {
					let t = e * s;
					for (let e = 0; e < s; ++e) {
						let n = a[t + e];
						c[e] += n, l[e] += n * n;
					}
				}
				let u = n > 1 ? n - 1 : 1;
				for (let e = 0; e < s; ++e) {
					let t = c[e] / n, r = (l[e] - n * t * t) / u, i = 1 / (Math.sqrt(r) + 1e-5);
					for (let r = 0; r < n; ++r) {
						let n = r * s + e;
						a[n] = (a[n] - t) * i;
					}
				}
				let d = new BigInt64Array(o);
				return d.fill(1n, 0, n), {
					input_features: t.unsqueeze_(0),
					attention_mask: new i.Tensor("int64", d, [1, o])
				};
			}
		}
	}),
	"./src/models/phi3_v/image_processing_phi3_v.js": ((e, t, n) => {
		n.r(t), n.d(t, { Phi3VImageProcessor: () => l });
		var r = n("./src/base/image_processors_utils.js"), i = n("./src/utils/tensor.js");
		let a = [2, 3], { ceil: o, floor: s, sqrt: c } = Math;
		class l extends r.ImageProcessor {
			constructor(e) {
				super({
					...e,
					do_normalize: !0,
					do_pad: !0,
					pad_size: "custom",
					do_convert_rgb: !0,
					do_resize: !0
				}), this._num_crops = e.num_crops;
			}
			calc_num_image_tokens_from_image_size(e, t) {
				let { num_img_tokens: n } = this.config;
				return s((s(t / 336) * s(e / 336) + 1) * n + 1 + (s(t / 336) + 1) * c(n));
			}
			get_resize_output_image_size(e, t) {
				let n = this._num_crops, [r, i] = e.size, a = r / i, o = 1;
				for (; o * Math.ceil(o / a) <= n;) o += 1;
				--o;
				let s = Math.floor(o * 336);
				return [s, Math.floor(s / a)];
			}
			pad_image(e, t, n, r = {}) {
				let [i, a] = t, s = 336 * o(i / 336), c = 336 * o(a / 336), l = [
					1,
					1,
					1
				].map((e, t) => (e - this.image_mean[t]) / this.image_std[t]);
				return super.pad_image(e, t, {
					width: c,
					height: s
				}, {
					center: !0,
					constant_values: l,
					...r
				});
			}
			async _call(e, { num_crops: t = null } = {}) {
				if (this._num_crops = t ??= this.config.num_crops, t < 4 || c(t) % 1 != 0) throw Error("num_crops must be a square number >= 4");
				Array.isArray(e) || (e = [e]);
				let n = e.length, r = await Promise.all(e.map((e) => this.preprocess(e))), l = r.map((e) => e.original_size), u = r.map((e) => e.reshaped_input_size), d = [];
				for (let { pixel_values: e } of r) {
					e.unsqueeze_(0);
					let [n, r] = e.dims.slice(-2), o = await (0, i.interpolate_4d)(e, {
						size: [336, 336],
						mode: "bicubic"
					});
					if (t > 0) {
						let l = [], u = c(t), f = s(r / u), p = s(n / u);
						for (let t = 0; t < u; ++t) for (let o = 0; o < u; ++o) {
							let s, c, d, m;
							t === u - 1 ? (c = n - p, m = n) : (c = t * p, m = (t + 1) * p), o === u - 1 ? (s = r - f, d = r) : (s = o * f, d = (o + 1) * f);
							let h = [c, s], g = [m, d], _ = await (0, i.slice)(e, h, g, a);
							l.push(_);
						}
						let m = await (0, i.interpolate_4d)((0, i.cat)(l, 0), {
							size: [336, 336],
							mode: "bicubic"
						});
						d.push((0, i.cat)([o, m], 0));
					} else d.push(o);
				}
				let f = (0, i.stack)(d, 0), p = u.map((e) => e.map((e) => 336 * o(e / 336)));
				return {
					pixel_values: f,
					original_sizes: l,
					reshaped_input_sizes: u,
					image_sizes: new i.Tensor("int64", p.flat(), [n, 2]),
					num_img_tokens: p.map(([e, t]) => this.calc_num_image_tokens_from_image_size(t, e))
				};
			}
		}
	}),
	"./src/models/phi3_v/processing_phi3_v.js": ((e, t, n) => {
		n.r(t), n.d(t, { Phi3VProcessor: () => c });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/auto/image_processing_auto.js"), a = n("./src/tokenizers.js");
		n("./src/utils/image.js");
		let o = "<|image|>", s = /<\|image_\d+\|>/g;
		class c extends r.Processor {
			static image_processor_class = i.AutoImageProcessor;
			static tokenizer_class = a.AutoTokenizer;
			async _call(e, t = null, { padding: n = !0, truncation: r = !0, num_crops: i = null } = {}) {
				Array.isArray(e) || (e = [e]);
				let a, c;
				if (t) {
					c = await this.image_processor(t, { num_crops: i });
					let { num_img_tokens: l } = c, u = e.map((e, t) => e.split(s).join(o.repeat(l[t])));
					a = this.tokenizer(u, {
						padding: n,
						truncation: r
					});
					let d = this.tokenizer.model.convert_tokens_to_ids([o])[0];
					a.input_ids.map_((e) => e == d ? -e : e);
				} else a = this.tokenizer(e);
				return {
					...a,
					...c
				};
			}
		}
	}),
	"./src/models/pixtral/image_processing_pixtral.js": ((e, t, n) => {
		n.r(t), n.d(t, { PixtralImageProcessor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {
			get_resize_output_image_size(e, t) {
				let { longest_edge: n } = t;
				if (n === void 0) throw Error("size must contain 'longest_edge'");
				let [r, i] = e.size, a = Math.max(r, i) / n, o = r, s = i;
				a > 1 && (o = Math.floor(r / a), s = Math.floor(i / a));
				let { patch_size: c, spatial_merge_size: l } = this.config;
				if (!l) throw Error("config must contain 'spatial_merge_size'");
				let u = c * l, d = Math.floor((o - 1) / u) + 1, f = Math.floor((s - 1) / u) + 1;
				return [d * u, f * u];
			}
		}
	}),
	"./src/models/pixtral/processing_pixtral.js": ((e, t, n) => {
		n.r(t), n.d(t, { PixtralProcessor: () => o });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/auto/image_processing_auto.js"), a = n("./src/tokenizers.js");
		class o extends r.Processor {
			static tokenizer_class = a.AutoTokenizer;
			static image_processor_class = i.AutoImageProcessor;
			static uses_processor_config = !0;
			async _call(e, t = null, n = {}) {
				let r = await this.image_processor(e, n);
				if (t) {
					let [e, n] = r.pixel_values.dims.slice(-2), { image_token: i, image_break_token: a, image_end_token: o, patch_size: s, spatial_merge_size: c } = this.config, l = s * c, u = Math.floor(e / l), d = Math.floor(n / l);
					t = structuredClone(t), Array.isArray(t) || (t = [t]);
					for (let e = 0; e < t.length; ++e) {
						let n = i.repeat(d), r = n + a, s = n + o, c = r.repeat(u - 1) + s;
						t[e] = t[e].replace(i, c);
					}
				}
				let i = t ? this.tokenizer(t, n) : {};
				return {
					...r,
					...i
				};
			}
		}
	}),
	"./src/models/processors.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			Florence2Processor: () => r.Florence2Processor,
			Gemma3nProcessor: () => i.Gemma3nProcessor,
			GroundingDinoProcessor: () => a.GroundingDinoProcessor,
			Idefics3Processor: () => o.Idefics3Processor,
			JinaCLIPProcessor: () => c.JinaCLIPProcessor,
			LlavaProcessor: () => l.LlavaProcessor,
			MgpstrProcessor: () => u.MgpstrProcessor,
			MoonshineProcessor: () => d.MoonshineProcessor,
			OwlViTProcessor: () => f.OwlViTProcessor,
			PaliGemmaProcessor: () => p.PaliGemmaProcessor,
			Phi3VProcessor: () => m.Phi3VProcessor,
			PixtralProcessor: () => h.PixtralProcessor,
			PyAnnoteProcessor: () => g.PyAnnoteProcessor,
			Qwen2VLProcessor: () => _.Qwen2VLProcessor,
			Sam2Processor: () => y.Sam2Processor,
			Sam2VideoProcessor: () => y.Sam2VideoProcessor,
			SamProcessor: () => v.SamProcessor,
			SmolVLMProcessor: () => b.SmolVLMProcessor,
			SpeechT5Processor: () => x.SpeechT5Processor,
			UltravoxProcessor: () => S.UltravoxProcessor,
			VLChatProcessor: () => s.VLChatProcessor,
			VoxtralProcessor: () => C.VoxtralProcessor,
			Wav2Vec2Processor: () => w.Wav2Vec2Processor,
			Wav2Vec2ProcessorWithLM: () => T.Wav2Vec2ProcessorWithLM,
			WhisperProcessor: () => E.WhisperProcessor
		});
		var r = n("./src/models/florence2/processing_florence2.js"), i = n("./src/models/gemma3n/processing_gemma3n.js"), a = n("./src/models/grounding_dino/processing_grounding_dino.js"), o = n("./src/models/idefics3/processing_idefics3.js"), s = n("./src/models/janus/processing_janus.js"), c = n("./src/models/jina_clip/processing_jina_clip.js"), l = n("./src/models/llava/processing_llava.js"), u = n("./src/models/mgp_str/processing_mgp_str.js"), d = n("./src/models/moonshine/processing_moonshine.js"), f = n("./src/models/owlvit/processing_owlvit.js"), p = n("./src/models/paligemma/processing_paligemma.js"), m = n("./src/models/phi3_v/processing_phi3_v.js"), h = n("./src/models/pixtral/processing_pixtral.js"), g = n("./src/models/pyannote/processing_pyannote.js"), _ = n("./src/models/qwen2_vl/processing_qwen2_vl.js"), v = n("./src/models/sam/processing_sam.js"), y = n("./src/models/sam2/processing_sam2.js"), b = n("./src/models/smolvlm/processing_smolvlm.js"), x = n("./src/models/speecht5/processing_speecht5.js"), S = n("./src/models/ultravox/processing_ultravox.js"), C = n("./src/models/voxtral/processing_voxtral.js"), w = n("./src/models/wav2vec2/processing_wav2vec2.js"), T = n("./src/models/wav2vec2_with_lm/processing_wav2vec2_with_lm.js"), E = n("./src/models/whisper/processing_whisper.js");
	}),
	"./src/models/pvt/image_processing_pvt.js": ((e, t, n) => {
		n.r(t), n.d(t, { PvtImageProcessor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
	}),
	"./src/models/pyannote/feature_extraction_pyannote.js": ((e, t, n) => {
		n.r(t), n.d(t, { PyAnnoteFeatureExtractor: () => o });
		var r = n("./src/base/feature_extraction_utils.js"), i = n("./src/utils/tensor.js"), a = n("./src/utils/maths.js");
		class o extends r.FeatureExtractor {
			async _call(e) {
				(0, r.validate_audio_inputs)(e, "PyAnnoteFeatureExtractor"), e instanceof Float64Array && (e = new Float32Array(e));
				let t = [
					1,
					1,
					e.length
				];
				return { input_values: new i.Tensor("float32", e, t) };
			}
			samples_to_frames(e) {
				return (e - this.config.offset) / this.config.step;
			}
			post_process_speaker_diarization(e, t) {
				let n = t / this.samples_to_frames(t) / this.config.sampling_rate, r = [];
				for (let t of e.tolist()) {
					let e = [], i = -1;
					for (let n = 0; n < t.length; ++n) {
						let r = (0, a.softmax)(t[n]), [o, s] = (0, a.max)(r), [c, l] = [n, n + 1];
						s === i ? (e.at(-1).end = l, e.at(-1).score += o) : (i = s, e.push({
							id: s,
							start: c,
							end: l,
							score: o
						}));
					}
					r.push(e.map(({ id: e, start: t, end: r, score: i }) => ({
						id: e,
						start: t * n,
						end: r * n,
						confidence: i / (r - t)
					})));
				}
				return r;
			}
		}
	}),
	"./src/models/pyannote/processing_pyannote.js": ((e, t, n) => {
		n.r(t), n.d(t, { PyAnnoteProcessor: () => a });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/pyannote/feature_extraction_pyannote.js");
		class a extends r.Processor {
			static feature_extractor_class = i.PyAnnoteFeatureExtractor;
			async _call(e) {
				return await this.feature_extractor(e);
			}
			post_process_speaker_diarization(...e) {
				return this.feature_extractor.post_process_speaker_diarization(...e);
			}
			get sampling_rate() {
				return this.feature_extractor.config.sampling_rate;
			}
		}
	}),
	"./src/models/qwen2_vl/image_processing_qwen2_vl.js": ((e, t, n) => {
		n.r(t), n.d(t, { Qwen2VLImageProcessor: () => a });
		var r = n("./src/base/image_processors_utils.js"), i = n("./src/utils/tensor.js");
		class a extends r.ImageProcessor {
			async _call(e, ...t) {
				let { pixel_values: n, original_sizes: r, reshaped_input_sizes: a } = await super._call(e, ...t), o = n, { temporal_patch_size: s, merge_size: c, patch_size: l } = this.config;
				o.dims[0] === 1 && (o = (0, i.cat)(Array.from({ length: s }, () => o), 0));
				let u = o.dims[0] / s, d = o.dims[1], f = Math.floor(o.dims[2] / l), p = Math.floor(o.dims[3] / l);
				return {
					pixel_values: o.view(u, s, d, Math.floor(f / c), c, l, Math.floor(p / c), c, l).permute(0, 3, 6, 4, 7, 2, 1, 5, 8).view(u * f * p, d * s * l * l),
					image_grid_thw: new i.Tensor("int64", [
						u,
						f,
						p
					], [1, 3]),
					original_sizes: r,
					reshaped_input_sizes: a
				};
			}
		}
	}),
	"./src/models/qwen2_vl/processing_qwen2_vl.js": ((e, t, n) => {
		n.r(t), n.d(t, { Qwen2VLProcessor: () => o });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/auto/image_processing_auto.js"), a = n("./src/tokenizers.js");
		n("./src/utils/image.js");
		class o extends r.Processor {
			static image_processor_class = i.AutoImageProcessor;
			static tokenizer_class = a.AutoTokenizer;
			async _call(e, t = null, ...n) {
				Array.isArray(e) || (e = [e]);
				let r, i;
				if (t && (r = await this.image_processor(t), i = r.image_grid_thw), i) {
					let t = this.image_processor.config.merge_size ** 2, n = 0, r = i.tolist();
					e = e.map((e) => {
						for (; e.includes("<|image_pad|>");) {
							let i = Number(r[n++].reduce((e, t) => e * t, 1n));
							e = e.replace("<|image_pad|>", "<|placeholder|>".repeat(Math.floor(i / t)));
						}
						return e.replaceAll("<|placeholder|>", "<|image_pad|>");
					});
				}
				return {
					...this.tokenizer(e),
					...r
				};
			}
		}
	}),
	"./src/models/rt_detr/image_processing_rt_detr.js": ((e, t, n) => {
		n.r(t), n.d(t, { RTDetrImageProcessor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {
			post_process_object_detection(...e) {
				return (0, r.post_process_object_detection)(...e);
			}
		}
	}),
	"./src/models/sam/image_processing_sam.js": ((e, t, n) => {
		n.r(t), n.d(t, { SamImageProcessor: () => o });
		var r = n("./src/base/image_processors_utils.js"), i = n("./src/utils/core.js"), a = n("./src/utils/tensor.js");
		class o extends r.ImageProcessor {
			reshape_input_points(e, t, n, r = !1) {
				e = structuredClone(e);
				let o = (0, i.calculateDimensions)(e);
				if (o.length === 3) r || (o = [1, ...o]), e = [e];
				else if (o.length !== 4) throw Error("The input_points must be a 4D tensor of shape `batch_size`, `point_batch_size`, `nb_points_per_image`, `2`.");
				for (let r = 0; r < e.length; ++r) {
					let [i, a] = t[r], [o, s] = n[r], c = [s / a, o / i];
					for (let t = 0; t < e[r].length; ++t) for (let n = 0; n < e[r][t].length; ++n) for (let i = 0; i < e[r][t][n].length; ++i) e[r][t][n][i] *= c[i % 2];
				}
				return new a.Tensor("float32", Float32Array.from(e.flat(Infinity)), o);
			}
			add_input_labels(e, t) {
				let n = (0, i.calculateDimensions)(e);
				if (n.length === 2) n = [1, ...n], e = [e];
				else if (n.length !== 3) throw Error("The input_points must be a 4D tensor of shape `batch_size`, `point_batch_size`, `nb_points_per_image`, `2`.");
				if (n.some((e, n) => e !== t.dims[n])) throw Error(`The first ${n.length} dimensions of 'input_points' and 'input_labels' must be the same.`);
				return new a.Tensor("int64", e.flat(Infinity).map(BigInt), n);
			}
			async _call(e, { input_points: t = null, input_labels: n = null, input_boxes: r = null } = {}) {
				let i = await super._call(e);
				if (t && (i.input_points = this.reshape_input_points(t, i.original_sizes, i.reshaped_input_sizes)), n) {
					if (!i.input_points) throw Error("`input_points` must be provided if `input_labels` are provided.");
					i.input_labels = this.add_input_labels(n, i.input_points);
				}
				return r && (i.input_boxes = this.reshape_input_points(r, i.original_sizes, i.reshaped_input_sizes, !0)), i;
			}
			async post_process_masks(e, t, n, { mask_threshold: r = 0, binarize: i = !0, pad_size: o = null } = {}) {
				let s = [];
				o = o ?? this.pad_size ?? this.size;
				let c = [o.height, o.width];
				for (let o = 0; o < t.length; ++o) {
					let l = t[o], u = n[o], d = await (0, a.interpolate_4d)(e[o], {
						mode: "bilinear",
						size: c
					});
					if (d = d.slice(null, null, [0, u[0]], [0, u[1]]), d = await (0, a.interpolate_4d)(d, {
						mode: "bilinear",
						size: l
					}), i) {
						let e = d.data, t = new Uint8Array(e.length);
						for (let n = 0; n < e.length; ++n) e[n] > r && (t[n] = 1);
						d = new a.Tensor("bool", t, d.dims);
					}
					s.push(d);
				}
				return s;
			}
			generate_crop_boxes(e, t, { crop_n_layers: n = 0, overlap_ratio: r = 512 / 1500, points_per_crop: i = 32, crop_n_points_downscale_factor: a = 1 } = {}) {}
		}
	}),
	"./src/models/sam/processing_sam.js": ((e, t, n) => {
		n.r(t), n.d(t, { SamProcessor: () => a });
		var r = n("./src/base/processing_utils.js"), i = n("./src/models/auto/image_processing_auto.js");
		class a extends r.Processor {
			static image_processor_class = i.AutoImageProcessor;
			async _call(...e) {
				return await this.image_processor(...e);
			}
			post_process_masks(...e) {
				return this.image_processor.post_process_masks(...e);
			}
			reshape_input_points(...e) {
				return this.image_processor.reshape_input_points(...e);
			}
		}
	}),
	"./src/models/sam2/image_processing_sam2.js": ((e, t, n) => {
		n.r(t), n.d(t, { Sam2ImageProcessor: () => r.SamImageProcessor });
		var r = n("./src/models/sam/image_processing_sam.js");
	}),
	"./src/models/sam2/processing_sam2.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			Sam2Processor: () => i,
			Sam2VideoProcessor: () => a
		});
		var r = n("./src/models/sam/processing_sam.js");
		class i extends r.SamProcessor {}
		class a extends i {}
	}),
	"./src/models/sam3/image_processing_sam3.js": ((e, t, n) => {
		n.r(t), n.d(t, { Sam3ImageProcessor: () => r.Sam2ImageProcessor });
		var r = n("./src/models/sam2/image_processing_sam2.js");
	}),
	"./src/models/seamless_m4t/feature_extraction_seamless_m4t.js": ((e, t, n) => {
		n.r(t), n.d(t, { SeamlessM4TFeatureExtractor: () => o });
		var r = n("./src/base/feature_extraction_utils.js"), i = n("./src/utils/tensor.js"), a = n("./src/utils/audio.js");
		class o extends r.FeatureExtractor {
			constructor(e) {
				super(e);
				let t = this.config.sampling_rate, n = (0, a.mel_filter_bank)(257, this.config.num_mel_bins, 20, Math.floor(t / 2), t, null, "kaldi", !0);
				this.mel_filters = n, this.window = (0, a.window_function)(400, "povey", { periodic: !1 });
			}
			async _extract_fbank_features(e, t) {
				return e = e.map((e) => e * 32768), (0, a.spectrogram)(e, this.window, 400, 160, {
					fft_length: 512,
					power: 2,
					center: !1,
					preemphasis: .97,
					mel_filters: this.mel_filters,
					log_mel: "log",
					mel_floor: 1.192092955078125e-7,
					remove_dc_offset: !0,
					max_num_frames: t,
					transpose: !0
				});
			}
			async _call(e, { padding: t = !0, pad_to_multiple_of: n = 2, do_normalize_per_mel_bins: a = !0, return_attention_mask: o = !0 } = {}) {
				(0, r.validate_audio_inputs)(e, "SeamlessM4TFeatureExtractor");
				let s = await this._extract_fbank_features(e, this.config.max_length);
				if (a) {
					let [e, t] = s.dims, n = s.data;
					for (let r = 0; r < t; ++r) {
						let i = 0;
						for (let a = 0; a < e; ++a) i += n[a * t + r];
						let a = i / e, o = 0;
						for (let i = 0; i < e; ++i) o += (n[i * t + r] - a) ** 2;
						o /= e - 1;
						let s = Math.sqrt(o + 1e-7);
						for (let i = 0; i < e; ++i) {
							let e = i * t + r;
							n[e] = (n[e] - a) / s;
						}
					}
				}
				let c;
				if (t) {
					let [e, t] = s.dims, r = s.data, a = e % n;
					if (a > 0) {
						let n = new Float32Array(t * (e + a));
						n.set(r), n.fill(this.config.padding_value, r.length);
						let l = e + a;
						s = new i.Tensor(s.type, n, [l, t]), o && (c = new i.Tensor("int64", new BigInt64Array(l), [1, l]), c.data.fill(1n, 0, e));
					}
				}
				let [l, u] = s.dims, d = this.config.stride;
				if (l % d !== 0) throw Error(`The number of frames (${l}) must be a multiple of the stride (${d}).`);
				let f = s.view(1, Math.floor(l / d), u * d), p = { input_features: f };
				if (o) {
					let e = f.dims[1], t = new BigInt64Array(e);
					if (c) {
						let e = c.data;
						for (let n = 1, r = 0; n < l; n += d, ++r) t[r] = e[n];
					} else t.fill(1n);
					p.attention_mask = new i.Tensor("int64", t, [1, e]);
				}
				return p;
			}
		}
	}),
	"./src/models/segformer/image_processing_segformer.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			SegformerFeatureExtractor: () => a,
			SegformerImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {
			post_process_semantic_segmentation(...e) {
				return (0, r.post_process_semantic_segmentation)(...e);
			}
		}
		class a extends i {}
	}),
	"./src/models/siglip/image_processing_siglip.js": ((e, t, n) => {
		n.r(t), n.d(t, { SiglipImageProcessor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
	}),
	"./src/models/smolvlm/image_processing_smolvlm.js": ((e, t, n) => {
		n.r(t), n.d(t, { SmolVLMImageProcessor: () => r.Idefics3ImageProcessor });
		var r = n("./src/models/idefics3/image_processing_idefics3.js");
	}),
	"./src/models/smolvlm/processing_smolvlm.js": ((e, t, n) => {
		n.r(t), n.d(t, { SmolVLMProcessor: () => r.Idefics3Processor });
		var r = n("./src/models/idefics3/processing_idefics3.js");
	}),
	"./src/models/snac/feature_extraction_snac.js": ((e, t, n) => {
		n.r(t), n.d(t, { SnacFeatureExtractor: () => i });
		var r = n("./src/models/dac/feature_extraction_dac.js");
		class i extends r.DacFeatureExtractor {}
	}),
	"./src/models/speecht5/feature_extraction_speecht5.js": ((e, t, n) => {
		n.r(t), n.d(t, { SpeechT5FeatureExtractor: () => i });
		var r = n("./src/base/feature_extraction_utils.js");
		class i extends r.FeatureExtractor {}
	}),
	"./src/models/speecht5/processing_speecht5.js": ((e, t, n) => {
		n.r(t), n.d(t, { SpeechT5Processor: () => o });
		var r = n("./src/base/processing_utils.js"), i = n("./src/tokenizers.js"), a = n("./src/models/auto/feature_extraction_auto.js");
		class o extends r.Processor {
			static tokenizer_class = i.AutoTokenizer;
			static feature_extractor_class = a.AutoFeatureExtractor;
			async _call(e) {
				return await this.feature_extractor(e);
			}
		}
	}),
	"./src/models/swin2sr/image_processing_swin2sr.js": ((e, t, n) => {
		n.r(t), n.d(t, { Swin2SRImageProcessor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {
			pad_image(e, t, n, r = {}) {
				let [i, a, o] = t;
				return super.pad_image(e, t, {
					width: a + (n - a % n) % n,
					height: i + (n - i % n) % n
				}, {
					mode: "symmetric",
					center: !1,
					constant_values: -1,
					...r
				});
			}
		}
	}),
	"./src/models/ultravox/processing_ultravox.js": ((e, t, n) => {
		n.r(t), n.d(t, { UltravoxProcessor: () => o });
		var r = n("./src/models/auto/feature_extraction_auto.js"), i = n("./src/tokenizers.js"), a = n("./src/base/processing_utils.js");
		class o extends a.Processor {
			static tokenizer_class = i.AutoTokenizer;
			static feature_extractor_class = r.AutoFeatureExtractor;
			static uses_processor_config = !0;
			async _call(e, t = null, n = {}) {
				if (Array.isArray(e)) throw Error("Batched inputs are not supported yet.");
				let r = {};
				if (t) {
					let i = t.length, { input_features: a } = await this.feature_extractor(t, {
						...n,
						max_length: i
					}), o = Math.round(i / this.config.encoder_ds_factor + 1e-4), s = 1 + Math.ceil(o / this.config.stack_factor);
					r.audio_token_len = [s], r.audio_values = a;
					let c = this.config.audio_placeholder;
					if (!e.includes(c)) throw Error(`The input text does not contain the image token ${c}.`);
					e = e.replaceAll(c, c.repeat(s));
				}
				return {
					...this.tokenizer(e, {
						add_special_tokens: !1,
						...n
					}),
					...r
				};
			}
		}
	}),
	"./src/models/vit/image_processing_vit.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			ViTFeatureExtractor: () => a,
			ViTImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {}
		class a extends i {}
	}),
	"./src/models/vitmatte/image_processing_vitmatte.js": ((e, t, n) => {
		n.r(t), n.d(t, { VitMatteImageProcessor: () => a });
		var r = n("./src/base/image_processors_utils.js"), i = n("./src/utils/tensor.js");
		class a extends r.ImageProcessor {
			async _call(e, t) {
				Array.isArray(e) || (e = [e]), Array.isArray(t) || (t = [t]);
				let n = await Promise.all(e.map((e) => this.preprocess(e))), r = await Promise.all(t.map((e) => this.preprocess(e, {
					do_normalize: !1,
					do_convert_rgb: !1,
					do_convert_grayscale: !0
				})));
				return {
					pixel_values: (0, i.stack)(n.map((e, t) => (0, i.cat)([e.pixel_values, r[t].pixel_values], 0)), 0),
					original_sizes: n.map((e) => e.original_size),
					reshaped_input_sizes: n.map((e) => e.reshaped_input_size)
				};
			}
		}
	}),
	"./src/models/vitpose/image_processing_vitpose.js": ((e, t, n) => {
		n.r(t), n.d(t, { VitPoseImageProcessor: () => i });
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {
			post_process_pose_estimation(e, t, { threshold: n = null } = {}) {
				let r = e.tolist(), [i, a, o, s] = e.dims, c = [];
				for (let e = 0; e < i; ++e) {
					let i = r[e], a = t[e], l = [];
					for (let e = 0; e < a.length; ++e) {
						let t = a[e], r = [], c = [], u = [], d = t.at(-2) / s, f = t.at(-1) / o;
						for (let e = 0; e < i.length; ++e) {
							let [t, a] = [0, 0], o = 0, s = -Infinity, l = i[e];
							for (let e = 0; e < l.length; ++e) {
								let n = l[e];
								for (let r = 0; r < n.length; ++r) {
									let i = n[r];
									o += i, s = Math.max(s, i), t += (r + .5) * i, a += e * i;
								}
							}
							if (n != null && s < n) continue;
							let p = [d * t / o, f * a / o];
							r.push(p), u.push(e), c.push(s);
						}
						l.push({
							bbox: t,
							scores: c,
							labels: u,
							keypoints: r
						});
					}
					c.push(l);
				}
				return c;
			}
		}
	}),
	"./src/models/voxtral/processing_voxtral.js": ((e, t, n) => {
		n.r(t), n.d(t, { VoxtralProcessor: () => l });
		var r = n("./src/models/auto/feature_extraction_auto.js"), i = n("./src/tokenizers.js"), a = n("./src/base/processing_utils.js"), o = n("./src/utils/tensor.js");
		let s = "[AUDIO]";
		function c(e, t) {
			let n = [];
			for (let r = 0; r < e.length; r += t) n.push(e.subarray(r, Math.min(r + t, e.length)));
			return n;
		}
		class l extends a.Processor {
			static tokenizer_class = i.AutoTokenizer;
			static feature_extractor_class = r.AutoFeatureExtractor;
			static uses_processor_config = !1;
			async _call(e, t = null, n = {}) {
				if (Array.isArray(e)) throw Error("Batched inputs are not supported yet.");
				let r = {};
				if (t) {
					if (!e.includes(s)) throw Error(`The input text does not contain the audio token ${s}.`);
					Array.isArray(t) || (t = [t]);
					let i = e.split(s), a = i.length - 1;
					if (a !== t.length) throw Error(`The number of audio inputs (${t.length}) does not match the number of audio tokens in the text (${a}).`);
					let l = this.feature_extractor.config.n_samples, u = t.map((e) => c(e, l)), d = u.map((e) => e.length), f = u.flat(), p = (await Promise.all(f.map((e) => this.feature_extractor(e, n)))).map((e) => e.input_features);
					r.audio_values = p.length > 1 ? (0, o.cat)(p, 0) : p[0];
					let m = i[0];
					for (let e = 0; e < d.length; ++e) {
						m += "[BEGIN_AUDIO]";
						for (let t = 0; t < d[e]; ++t) m += s.repeat(375);
						m += i[e + 1];
					}
					e = m;
				}
				return {
					...this.tokenizer(e, {
						add_special_tokens: !1,
						...n
					}),
					...r
				};
			}
		}
	}),
	"./src/models/wav2vec2/feature_extraction_wav2vec2.js": ((e, t, n) => {
		n.r(t), n.d(t, { Wav2Vec2FeatureExtractor: () => a });
		var r = n("./src/base/feature_extraction_utils.js"), i = n("./src/utils/tensor.js");
		class a extends r.FeatureExtractor {
			_zero_mean_unit_var_norm(e) {
				let t = e.reduce((e, t) => e + t, 0) / e.length, n = e.reduce((e, n) => e + (n - t) ** 2, 0) / e.length;
				return e.map((e) => (e - t) / Math.sqrt(n + 1e-7));
			}
			async _call(e) {
				(0, r.validate_audio_inputs)(e, "Wav2Vec2FeatureExtractor"), e instanceof Float64Array && (e = new Float32Array(e));
				let t = e;
				this.config.do_normalize && (t = this._zero_mean_unit_var_norm(t));
				let n = [1, t.length];
				return {
					input_values: new i.Tensor("float32", t, n),
					attention_mask: new i.Tensor("int64", new BigInt64Array(t.length).fill(1n), n)
				};
			}
		}
	}),
	"./src/models/wav2vec2/processing_wav2vec2.js": ((e, t, n) => {
		n.r(t), n.d(t, { Wav2Vec2Processor: () => o });
		var r = n("./src/tokenizers.js"), i = n("./src/models/auto/feature_extraction_auto.js"), a = n("./src/base/processing_utils.js");
		class o extends a.Processor {
			static tokenizer_class = r.AutoTokenizer;
			static feature_extractor_class = i.AutoFeatureExtractor;
			async _call(e) {
				return await this.feature_extractor(e);
			}
		}
	}),
	"./src/models/wav2vec2_with_lm/processing_wav2vec2_with_lm.js": ((e, t, n) => {
		n.r(t), n.d(t, { Wav2Vec2ProcessorWithLM: () => o });
		var r = n("./src/tokenizers.js"), i = n("./src/models/auto/feature_extraction_auto.js"), a = n("./src/base/processing_utils.js");
		class o extends a.Processor {
			static tokenizer_class = r.AutoTokenizer;
			static feature_extractor_class = i.AutoFeatureExtractor;
			async _call(e) {
				return await this.feature_extractor(e);
			}
		}
	}),
	"./src/models/wespeaker/feature_extraction_wespeaker.js": ((e, t, n) => {
		n.r(t), n.d(t, { WeSpeakerFeatureExtractor: () => a });
		var r = n("./src/base/feature_extraction_utils.js");
		n("./src/utils/tensor.js");
		var i = n("./src/utils/audio.js");
		class a extends r.FeatureExtractor {
			constructor(e) {
				super(e);
				let t = this.config.sampling_rate, n = (0, i.mel_filter_bank)(257, this.config.num_mel_bins, 20, Math.floor(t / 2), t, null, "kaldi", !0);
				this.mel_filters = n, this.window = (0, i.window_function)(400, "hamming", { periodic: !1 }), this.min_num_frames = this.config.min_num_frames;
			}
			async _extract_fbank_features(e) {
				return e = e.map((e) => e * 32768), (0, i.spectrogram)(e, this.window, 400, 160, {
					fft_length: 512,
					power: 2,
					center: !1,
					preemphasis: .97,
					mel_filters: this.mel_filters,
					log_mel: "log",
					mel_floor: 1.192092955078125e-7,
					remove_dc_offset: !0,
					transpose: !0,
					min_num_frames: this.min_num_frames
				});
			}
			async _call(e) {
				(0, r.validate_audio_inputs)(e, "WeSpeakerFeatureExtractor");
				let t = (await this._extract_fbank_features(e)).unsqueeze_(0);
				if (this.config.fbank_centering_span === null) {
					let e = t.mean(1).data, n = t.data, [r, i, a] = t.dims;
					for (let t = 0; t < r; ++t) {
						let r = t * i * a, o = t * a;
						for (let t = 0; t < i; ++t) {
							let i = r + t * a;
							for (let t = 0; t < a; ++t) n[i + t] -= e[o + t];
						}
					}
				}
				return { input_features: t };
			}
		}
	}),
	"./src/models/whisper/common_whisper.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			WHISPER_LANGUAGE_MAPPING: () => i,
			WHISPER_TO_LANGUAGE_CODE_MAPPING: () => a,
			whisper_language_to_code: () => o
		});
		let r = [
			["en", "english"],
			["zh", "chinese"],
			["de", "german"],
			["es", "spanish"],
			["ru", "russian"],
			["ko", "korean"],
			["fr", "french"],
			["ja", "japanese"],
			["pt", "portuguese"],
			["tr", "turkish"],
			["pl", "polish"],
			["ca", "catalan"],
			["nl", "dutch"],
			["ar", "arabic"],
			["sv", "swedish"],
			["it", "italian"],
			["id", "indonesian"],
			["hi", "hindi"],
			["fi", "finnish"],
			["vi", "vietnamese"],
			["he", "hebrew"],
			["uk", "ukrainian"],
			["el", "greek"],
			["ms", "malay"],
			["cs", "czech"],
			["ro", "romanian"],
			["da", "danish"],
			["hu", "hungarian"],
			["ta", "tamil"],
			["no", "norwegian"],
			["th", "thai"],
			["ur", "urdu"],
			["hr", "croatian"],
			["bg", "bulgarian"],
			["lt", "lithuanian"],
			["la", "latin"],
			["mi", "maori"],
			["ml", "malayalam"],
			["cy", "welsh"],
			["sk", "slovak"],
			["te", "telugu"],
			["fa", "persian"],
			["lv", "latvian"],
			["bn", "bengali"],
			["sr", "serbian"],
			["az", "azerbaijani"],
			["sl", "slovenian"],
			["kn", "kannada"],
			["et", "estonian"],
			["mk", "macedonian"],
			["br", "breton"],
			["eu", "basque"],
			["is", "icelandic"],
			["hy", "armenian"],
			["ne", "nepali"],
			["mn", "mongolian"],
			["bs", "bosnian"],
			["kk", "kazakh"],
			["sq", "albanian"],
			["sw", "swahili"],
			["gl", "galician"],
			["mr", "marathi"],
			["pa", "punjabi"],
			["si", "sinhala"],
			["km", "khmer"],
			["sn", "shona"],
			["yo", "yoruba"],
			["so", "somali"],
			["af", "afrikaans"],
			["oc", "occitan"],
			["ka", "georgian"],
			["be", "belarusian"],
			["tg", "tajik"],
			["sd", "sindhi"],
			["gu", "gujarati"],
			["am", "amharic"],
			["yi", "yiddish"],
			["lo", "lao"],
			["uz", "uzbek"],
			["fo", "faroese"],
			["ht", "haitian creole"],
			["ps", "pashto"],
			["tk", "turkmen"],
			["nn", "nynorsk"],
			["mt", "maltese"],
			["sa", "sanskrit"],
			["lb", "luxembourgish"],
			["my", "myanmar"],
			["bo", "tibetan"],
			["tl", "tagalog"],
			["mg", "malagasy"],
			["as", "assamese"],
			["tt", "tatar"],
			["haw", "hawaiian"],
			["ln", "lingala"],
			["ha", "hausa"],
			["ba", "bashkir"],
			["jw", "javanese"],
			["su", "sundanese"]
		], i = new Map(r), a = new Map([
			...r.map(([e, t]) => [t, e]),
			["burmese", "my"],
			["valencian", "ca"],
			["flemish", "nl"],
			["haitian", "ht"],
			["letzeburgesch", "lb"],
			["pushto", "ps"],
			["panjabi", "pa"],
			["moldavian", "ro"],
			["moldovan", "ro"],
			["sinhalese", "si"],
			["castilian", "es"]
		]);
		function o(e) {
			e = e.toLowerCase();
			let t = a.get(e);
			if (t === void 0) {
				let n = e.match(/^<\|([a-z]{2})\|>$/);
				if (n && (e = n[1]), i.has(e)) t = e;
				else {
					let t = e.length === 2 ? i.keys() : i.values();
					throw Error(`Language "${e}" is not supported. Must be one of: ${JSON.stringify(Array.from(t))}`);
				}
			}
			return t;
		}
	}),
	"./src/models/whisper/feature_extraction_whisper.js": ((e, t, n) => {
		n.r(t), n.d(t, { WhisperFeatureExtractor: () => o });
		var r = n("./src/base/feature_extraction_utils.js");
		n("./src/utils/tensor.js");
		var i = n("./src/utils/audio.js"), a = n("./src/utils/maths.js");
		class o extends r.FeatureExtractor {
			constructor(e) {
				super(e), this.config.mel_filters ??= (0, i.mel_filter_bank)(Math.floor(1 + this.config.n_fft / 2), this.config.feature_size, 0, 8e3, this.config.sampling_rate, "slaney", "slaney"), this.window = (0, i.window_function)(this.config.n_fft, "hann");
			}
			async _extract_fbank_features(e) {
				let t = await (0, i.spectrogram)(e, this.window, this.config.n_fft, this.config.hop_length, {
					power: 2,
					mel_filters: this.config.mel_filters,
					log_mel: "log10",
					max_num_frames: Math.min(Math.floor(e.length / this.config.hop_length), this.config.nb_max_frames)
				}), n = t.data, r = (0, a.max)(n)[0];
				for (let e = 0; e < n.length; ++e) n[e] = (Math.max(n[e], r - 8) + 4) / 4;
				return t;
			}
			async _call(e, { max_length: t = null } = {}) {
				(0, r.validate_audio_inputs)(e, "WhisperFeatureExtractor");
				let n, i = t ?? this.config.n_samples;
				return e.length > i ? (e.length > this.config.n_samples && console.warn("Attempting to extract features for audio longer than 30 seconds. If using a pipeline to extract transcript from a long audio clip, remember to specify `chunk_length_s` and/or `stride_length_s`."), n = e.slice(0, i)) : (n = new Float32Array(i), n.set(e)), { input_features: (await this._extract_fbank_features(n)).unsqueeze_(0) };
			}
		}
	}),
	"./src/models/whisper/generation_whisper.js": ((e, t, n) => {
		n.r(t), n.d(t, { WhisperGenerationConfig: () => i });
		var r = n("./src/generation/configuration_utils.js");
		class i extends r.GenerationConfig {
			return_timestamps = null;
			return_token_timestamps = null;
			num_frames = null;
			alignment_heads = null;
			task = null;
			language = null;
			no_timestamps_token_id = null;
			prompt_ids = null;
			is_multilingual = null;
			lang_to_id = null;
			task_to_id = null;
			max_initial_timestamp_index = 1;
		}
	}),
	"./src/models/whisper/processing_whisper.js": ((e, t, n) => {
		n.r(t), n.d(t, { WhisperProcessor: () => o });
		var r = n("./src/models/auto/feature_extraction_auto.js"), i = n("./src/tokenizers.js"), a = n("./src/base/processing_utils.js");
		class o extends a.Processor {
			static tokenizer_class = i.AutoTokenizer;
			static feature_extractor_class = r.AutoFeatureExtractor;
			async _call(e) {
				return await this.feature_extractor(e);
			}
		}
	}),
	"./src/models/yolos/image_processing_yolos.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			YolosFeatureExtractor: () => a,
			YolosImageProcessor: () => i
		});
		var r = n("./src/base/image_processors_utils.js");
		class i extends r.ImageProcessor {
			post_process_object_detection(...e) {
				return (0, r.post_process_object_detection)(...e);
			}
		}
		class a extends i {}
	}),
	"./src/ops/registry.js": ((e, t, n) => {
		n.r(t), n.d(t, { TensorOpRegistry: () => o });
		var r = n("./src/backends/onnx.js"), i = n("./src/utils/tensor.js");
		let a = async (e, t, n) => {
			let a = await (0, r.createInferenceSession)(new Uint8Array(e), t);
			return (async (e) => {
				let t = (0, r.isONNXProxy)(), o = Object.fromEntries(Object.entries(e).map(([e, n]) => [e, (t ? n.clone() : n).ort_tensor])), s = await (0, r.runInferenceSession)(a, o);
				return Array.isArray(n) ? n.map((e) => new i.Tensor(s[e])) : new i.Tensor(s[n]);
			});
		};
		class o {
			static session_options = {};
			static get nearest_interpolate_4d() {
				return this._nearest_interpolate_4d ||= a([
					8,
					10,
					18,
					0,
					58,
					129,
					1,
					10,
					41,
					10,
					1,
					120,
					10,
					0,
					10,
					0,
					10,
					1,
					115,
					18,
					1,
					121,
					34,
					6,
					82,
					101,
					115,
					105,
					122,
					101,
					42,
					18,
					10,
					4,
					109,
					111,
					100,
					101,
					34,
					7,
					110,
					101,
					97,
					114,
					101,
					115,
					116,
					160,
					1,
					3,
					18,
					1,
					114,
					90,
					31,
					10,
					1,
					120,
					18,
					26,
					10,
					24,
					8,
					1,
					18,
					20,
					10,
					3,
					18,
					1,
					98,
					10,
					3,
					18,
					1,
					99,
					10,
					3,
					18,
					1,
					104,
					10,
					3,
					18,
					1,
					119,
					90,
					15,
					10,
					1,
					115,
					18,
					10,
					10,
					8,
					8,
					7,
					18,
					4,
					10,
					2,
					8,
					4,
					98,
					31,
					10,
					1,
					121,
					18,
					26,
					10,
					24,
					8,
					1,
					18,
					20,
					10,
					3,
					18,
					1,
					98,
					10,
					3,
					18,
					1,
					99,
					10,
					3,
					18,
					1,
					104,
					10,
					3,
					18,
					1,
					119,
					66,
					2,
					16,
					21
				], this.session_options, "y"), this._nearest_interpolate_4d;
			}
			static get bilinear_interpolate_4d() {
				return this._bilinear_interpolate_4d ||= a([
					8,
					9,
					18,
					0,
					58,
					128,
					1,
					10,
					40,
					10,
					1,
					120,
					10,
					0,
					10,
					0,
					10,
					1,
					115,
					18,
					1,
					121,
					34,
					6,
					82,
					101,
					115,
					105,
					122,
					101,
					42,
					17,
					10,
					4,
					109,
					111,
					100,
					101,
					34,
					6,
					108,
					105,
					110,
					101,
					97,
					114,
					160,
					1,
					3,
					18,
					1,
					114,
					90,
					31,
					10,
					1,
					120,
					18,
					26,
					10,
					24,
					8,
					1,
					18,
					20,
					10,
					3,
					18,
					1,
					98,
					10,
					3,
					18,
					1,
					99,
					10,
					3,
					18,
					1,
					104,
					10,
					3,
					18,
					1,
					119,
					90,
					15,
					10,
					1,
					115,
					18,
					10,
					10,
					8,
					8,
					7,
					18,
					4,
					10,
					2,
					8,
					4,
					98,
					31,
					10,
					1,
					121,
					18,
					26,
					10,
					24,
					8,
					1,
					18,
					20,
					10,
					3,
					18,
					1,
					98,
					10,
					3,
					18,
					1,
					99,
					10,
					3,
					18,
					1,
					104,
					10,
					3,
					18,
					1,
					119,
					66,
					2,
					16,
					20
				], this.session_options, "y"), this._bilinear_interpolate_4d;
			}
			static get bicubic_interpolate_4d() {
				return this._bicubic_interpolate_4d ||= a([
					8,
					9,
					18,
					0,
					58,
					127,
					10,
					39,
					10,
					1,
					120,
					10,
					0,
					10,
					0,
					10,
					1,
					115,
					18,
					1,
					121,
					34,
					6,
					82,
					101,
					115,
					105,
					122,
					101,
					42,
					16,
					10,
					4,
					109,
					111,
					100,
					101,
					34,
					5,
					99,
					117,
					98,
					105,
					99,
					160,
					1,
					3,
					18,
					1,
					114,
					90,
					31,
					10,
					1,
					120,
					18,
					26,
					10,
					24,
					8,
					1,
					18,
					20,
					10,
					3,
					18,
					1,
					98,
					10,
					3,
					18,
					1,
					99,
					10,
					3,
					18,
					1,
					104,
					10,
					3,
					18,
					1,
					119,
					90,
					15,
					10,
					1,
					115,
					18,
					10,
					10,
					8,
					8,
					7,
					18,
					4,
					10,
					2,
					8,
					4,
					98,
					31,
					10,
					1,
					121,
					18,
					26,
					10,
					24,
					8,
					1,
					18,
					20,
					10,
					3,
					18,
					1,
					98,
					10,
					3,
					18,
					1,
					99,
					10,
					3,
					18,
					1,
					104,
					10,
					3,
					18,
					1,
					119,
					66,
					2,
					16,
					20
				], this.session_options, "y"), this._bicubic_interpolate_4d;
			}
			static get matmul() {
				return this._matmul ||= a([
					8,
					9,
					18,
					0,
					58,
					55,
					10,
					17,
					10,
					1,
					97,
					10,
					1,
					98,
					18,
					1,
					99,
					34,
					6,
					77,
					97,
					116,
					77,
					117,
					108,
					18,
					1,
					114,
					90,
					9,
					10,
					1,
					97,
					18,
					4,
					10,
					2,
					8,
					1,
					90,
					9,
					10,
					1,
					98,
					18,
					4,
					10,
					2,
					8,
					1,
					98,
					9,
					10,
					1,
					99,
					18,
					4,
					10,
					2,
					8,
					1,
					66,
					2,
					16,
					20
				], this.session_options, "c"), this._matmul;
			}
			static get stft() {
				return this._stft ||= a([
					8,
					7,
					18,
					0,
					58,
					148,
					1,
					10,
					38,
					10,
					1,
					115,
					10,
					1,
					106,
					10,
					1,
					119,
					10,
					1,
					108,
					18,
					1,
					111,
					34,
					4,
					83,
					84,
					70,
					84,
					42,
					15,
					10,
					8,
					111,
					110,
					101,
					115,
					105,
					100,
					101,
					100,
					24,
					1,
					160,
					1,
					2,
					18,
					1,
					115,
					90,
					26,
					10,
					1,
					115,
					18,
					21,
					10,
					19,
					8,
					1,
					18,
					15,
					10,
					3,
					18,
					1,
					98,
					10,
					3,
					18,
					1,
					115,
					10,
					3,
					18,
					1,
					99,
					90,
					11,
					10,
					1,
					106,
					18,
					6,
					10,
					4,
					8,
					7,
					18,
					0,
					90,
					16,
					10,
					1,
					119,
					18,
					11,
					10,
					9,
					8,
					1,
					18,
					5,
					10,
					3,
					18,
					1,
					119,
					90,
					11,
					10,
					1,
					108,
					18,
					6,
					10,
					4,
					8,
					7,
					18,
					0,
					98,
					31,
					10,
					1,
					111,
					18,
					26,
					10,
					24,
					8,
					1,
					18,
					20,
					10,
					3,
					18,
					1,
					98,
					10,
					3,
					18,
					1,
					102,
					10,
					3,
					18,
					1,
					100,
					10,
					3,
					18,
					1,
					99,
					66,
					2,
					16,
					17
				], this.session_options, "o"), this._stft;
			}
			static get rfft() {
				return this._rfft ||= a([
					8,
					9,
					18,
					0,
					58,
					97,
					10,
					33,
					10,
					1,
					120,
					10,
					0,
					10,
					1,
					97,
					18,
					1,
					121,
					34,
					3,
					68,
					70,
					84,
					42,
					15,
					10,
					8,
					111,
					110,
					101,
					115,
					105,
					100,
					101,
					100,
					24,
					1,
					160,
					1,
					2,
					18,
					1,
					100,
					90,
					21,
					10,
					1,
					120,
					18,
					16,
					10,
					14,
					8,
					1,
					18,
					10,
					10,
					3,
					18,
					1,
					115,
					10,
					3,
					18,
					1,
					99,
					90,
					11,
					10,
					1,
					97,
					18,
					6,
					10,
					4,
					8,
					7,
					18,
					0,
					98,
					21,
					10,
					1,
					121,
					18,
					16,
					10,
					14,
					8,
					1,
					18,
					10,
					10,
					3,
					18,
					1,
					115,
					10,
					3,
					18,
					1,
					99,
					66,
					2,
					16,
					20
				], this.session_options, "y"), this._rfft;
			}
			static get top_k() {
				return this._top_k ||= a([
					8,
					10,
					18,
					0,
					58,
					73,
					10,
					18,
					10,
					1,
					120,
					10,
					1,
					107,
					18,
					1,
					118,
					18,
					1,
					105,
					34,
					4,
					84,
					111,
					112,
					75,
					18,
					1,
					116,
					90,
					9,
					10,
					1,
					120,
					18,
					4,
					10,
					2,
					8,
					1,
					90,
					15,
					10,
					1,
					107,
					18,
					10,
					10,
					8,
					8,
					7,
					18,
					4,
					10,
					2,
					8,
					1,
					98,
					9,
					10,
					1,
					118,
					18,
					4,
					10,
					2,
					8,
					1,
					98,
					9,
					10,
					1,
					105,
					18,
					4,
					10,
					2,
					8,
					7,
					66,
					2,
					16,
					21
				], this.session_options, ["v", "i"]), this._top_k;
			}
			static get slice() {
				return this._slice ||= a([
					8,
					7,
					18,
					0,
					58,
					96,
					10,
					25,
					10,
					1,
					120,
					10,
					1,
					115,
					10,
					1,
					101,
					10,
					1,
					97,
					10,
					1,
					116,
					18,
					1,
					121,
					34,
					5,
					83,
					108,
					105,
					99,
					101,
					18,
					1,
					114,
					90,
					9,
					10,
					1,
					120,
					18,
					4,
					10,
					2,
					8,
					1,
					90,
					9,
					10,
					1,
					115,
					18,
					4,
					10,
					2,
					8,
					7,
					90,
					9,
					10,
					1,
					101,
					18,
					4,
					10,
					2,
					8,
					7,
					90,
					9,
					10,
					1,
					97,
					18,
					4,
					10,
					2,
					8,
					7,
					90,
					9,
					10,
					1,
					116,
					18,
					4,
					10,
					2,
					8,
					7,
					98,
					9,
					10,
					1,
					121,
					18,
					4,
					10,
					2,
					8,
					1,
					66,
					2,
					16,
					13
				], this.session_options, "y"), this._slice;
			}
		}
	}),
	"./src/pipelines.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			AudioClassificationPipeline: () => O,
			AutomaticSpeechRecognitionPipeline: () => A,
			BackgroundRemovalPipeline: () => M,
			DepthEstimationPipeline: () => I,
			DocumentQuestionAnsweringPipeline: () => F,
			FeatureExtractionPipeline: () => E,
			FillMaskPipeline: () => y,
			ImageClassificationPipeline: () => te,
			ImageFeatureExtractionPipeline: () => D,
			ImageSegmentationPipeline: () => j,
			ImageToImagePipeline: () => ie,
			ImageToTextPipeline: () => ee,
			ObjectDetectionPipeline: () => ne,
			Pipeline: () => h,
			QuestionAnsweringPipeline: () => v,
			SummarizationPipeline: () => x,
			Text2TextGenerationPipeline: () => b,
			TextClassificationPipeline: () => g,
			TextGenerationPipeline: () => w,
			TextToAudioPipeline: () => re,
			TokenClassificationPipeline: () => _,
			TranslationPipeline: () => S,
			ZeroShotAudioClassificationPipeline: () => k,
			ZeroShotClassificationPipeline: () => T,
			ZeroShotImageClassificationPipeline: () => N,
			ZeroShotObjectDetectionPipeline: () => P,
			pipeline: () => oe
		});
		var r = n("./src/tokenizers.js"), i = n("./src/models.js"), a = n("./src/models/auto/processing_auto.js");
		n("./src/base/processing_utils.js");
		var o = n("./src/utils/generic.js"), s = n("./src/utils/core.js"), c = n("./src/utils/maths.js"), l = n("./src/utils/audio.js"), u = n("./src/utils/tensor.js"), d = n("./src/utils/image.js");
		async function f(e) {
			return Array.isArray(e) || (e = [e]), await Promise.all(e.map((e) => d.RawImage.read(e)));
		}
		async function p(e, t) {
			return Array.isArray(e) || (e = [e]), await Promise.all(e.map((e) => typeof e == "string" || e instanceof URL ? (0, l.read_audio)(e, t) : e instanceof Float64Array ? new Float32Array(e) : e));
		}
		function m(e, t) {
			t && (e = e.map((e) => e | 0));
			let [n, r, i, a] = e;
			return {
				xmin: n,
				ymin: r,
				xmax: i,
				ymax: a
			};
		}
		class h extends o.Callable {
			constructor({ task: e, model: t, tokenizer: n = null, processor: r = null }) {
				super(), this.task = e, this.model = t, this.tokenizer = n, this.processor = r;
			}
			async dispose() {
				await this.model.dispose();
			}
		}
		class g extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, { top_k: t = 1 } = {}) {
				let n = this.tokenizer(e, {
					padding: !0,
					truncation: !0
				}), r = await this.model(n), i = this.model.config.problem_type === "multi_label_classification" ? (e) => e.sigmoid() : (e) => new u.Tensor("float32", (0, c.softmax)(e.data), e.dims), a = this.model.config.id2label, o = [];
				for (let e of r.logits) {
					let n = i(e), r = await (0, u.topk)(n, t), s = r[0].tolist(), c = r[1].tolist().map((e, t) => ({
						label: a ? a[e] : `LABEL_${e}`,
						score: s[t]
					}));
					t === 1 ? o.push(...c) : o.push(c);
				}
				return Array.isArray(e) || t === 1 ? o : o[0];
			}
		}
		class _ extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, { ignore_labels: t = ["O"] } = {}) {
				let n = Array.isArray(e), r = this.tokenizer(n ? e : [e], {
					padding: !0,
					truncation: !0
				}), i = (await this.model(r)).logits, a = this.model.config.id2label, o = [];
				for (let e = 0; e < i.dims[0]; ++e) {
					let n = r.input_ids[e], s = i[e], l = [];
					for (let e = 0; e < s.dims[0]; ++e) {
						let r = s[e], i = (0, c.max)(r.data)[1], o = a ? a[i] : `LABEL_${i}`;
						if (t.includes(o)) continue;
						let u = this.tokenizer.decode([n[e].item()], { skip_special_tokens: !0 });
						if (u === "") continue;
						let d = (0, c.softmax)(r.data);
						l.push({
							entity: o,
							score: d[i],
							index: e,
							word: u
						});
					}
					o.push(l);
				}
				return n ? o : o[0];
			}
		}
		class v extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, t, { top_k: n = 1 } = {}) {
				let r = this.tokenizer(e, {
					text_pair: t,
					padding: !0,
					truncation: !0
				}), { start_logits: i, end_logits: a } = await this.model(r), o = r.input_ids.tolist(), l = r.attention_mask.tolist(), u = this.tokenizer.all_special_ids, d = [];
				for (let e = 0; e < i.dims[0]; ++e) {
					let t = o[e], r = t.findIndex((e) => e == this.tokenizer.sep_token_id);
					l[e].map((e, n) => e == 1 && (n === 0 || n > r && u.findIndex((e) => e == t[n]) === -1));
					let f = i[e].tolist(), p = a[e].tolist();
					for (let n = 1; n < f.length; ++n) (l[e] == 0 || n <= r || u.findIndex((e) => e == t[n]) !== -1) && (f[n] = -Infinity, p[n] = -Infinity);
					let m = (0, c.softmax)(f).map((e, t) => [e, t]), h = (0, c.softmax)(p).map((e, t) => [e, t]);
					m[0][0] = 0, h[0][0] = 0;
					let g = (0, s.product)(m, h).filter((e) => e[0][1] <= e[1][1]).map((e) => [
						e[0][1],
						e[1][1],
						e[0][0] * e[1][0]
					]).sort((e, t) => t[2] - e[2]);
					for (let e = 0; e < Math.min(g.length, n); ++e) {
						let [n, r, i] = g[e], a = t.slice(n, r + 1), o = this.tokenizer.decode(a, { skip_special_tokens: !0 });
						d.push({
							answer: o,
							score: i
						});
					}
				}
				return n === 1 ? d[0] : d;
			}
		}
		class y extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, { top_k: t = 5 } = {}) {
				let n = this.tokenizer(e, {
					padding: !0,
					truncation: !0
				}), { logits: r } = await this.model(n), i = [], a = n.input_ids.tolist();
				for (let e = 0; e < a.length; ++e) {
					let n = a[e], o = n.findIndex((e) => e == this.tokenizer.mask_token_id);
					if (o === -1) throw Error(`Mask token (${this.tokenizer.mask_token}) not found in text.`);
					let s = r[e][o], l = await (0, u.topk)(new u.Tensor("float32", (0, c.softmax)(s.data), s.dims), t), d = l[0].tolist(), f = l[1].tolist();
					i.push(f.map((e, t) => {
						let r = n.slice();
						return r[o] = e, {
							score: d[t],
							token: Number(e),
							token_str: this.tokenizer.decode([e]),
							sequence: this.tokenizer.decode(r, { skip_special_tokens: !0 })
						};
					}));
				}
				return Array.isArray(e) ? i : i[0];
			}
		}
		class b extends h {
			_key = "generated_text";
			constructor(e) {
				super(e);
			}
			async _call(e, t = {}) {
				Array.isArray(e) || (e = [e]), this.model.config.prefix && (e = e.map((e) => this.model.config.prefix + e));
				let n = this.model.config.task_specific_params;
				n && n[this.task] && n[this.task].prefix && (e = e.map((e) => n[this.task].prefix + e));
				let r = this.tokenizer, i = {
					padding: !0,
					truncation: !0
				}, a;
				a = this instanceof S && "_build_translation_inputs" in r ? r._build_translation_inputs(e, i, t) : r(e, i);
				let o = await this.model.generate({
					...a,
					...t
				});
				return r.batch_decode(o, { skip_special_tokens: !0 }).map((e) => ({ [this._key]: e }));
			}
		}
		class x extends b {
			_key = "summary_text";
			constructor(e) {
				super(e);
			}
		}
		class S extends b {
			_key = "translation_text";
			constructor(e) {
				super(e);
			}
		}
		function C(e) {
			return Array.isArray(e) && e.every((e) => "role" in e && "content" in e);
		}
		class w extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, t = {}) {
				let n = !1, r = !1, i = t.add_special_tokens ?? (this.tokenizer.add_bos_token || this.tokenizer.add_eos_token) ?? !1, a;
				if (typeof e == "string") a = e = [e];
				else if (Array.isArray(e) && e.every((e) => typeof e == "string")) n = !0, a = e;
				else {
					if (C(e)) e = [e];
					else if (Array.isArray(e) && e.every(C)) n = !0;
					else throw Error("Input must be a string, an array of strings, a Chat, or an array of Chats");
					r = !0, a = e.map((e) => this.tokenizer.apply_chat_template(e, {
						tokenize: !1,
						add_generation_prompt: !0
					})), i = !1;
				}
				let o = r ? !1 : t.return_full_text ?? !0;
				this.tokenizer.padding_side = "left";
				let s = this.tokenizer(a, {
					add_special_tokens: i,
					padding: !0,
					truncation: !0
				}), c = await this.model.generate({
					...s,
					...t
				}), l = this.tokenizer.batch_decode(c, { skip_special_tokens: !0 }), u;
				!o && s.input_ids.dims.at(-1) > 0 && (u = this.tokenizer.batch_decode(s.input_ids, { skip_special_tokens: !0 }).map((e) => e.length));
				let d = Array.from({ length: e.length }, (e) => []);
				for (let t = 0; t < l.length; ++t) {
					let n = Math.floor(t / c.dims[0] * e.length);
					u && (l[t] = l[t].slice(u[n])), d[n].push({ generated_text: r ? [...e[n], {
						role: "assistant",
						content: l[t]
					}] : l[t] });
				}
				return !n && d.length === 1 ? d[0] : d;
			}
		}
		class T extends h {
			constructor(e) {
				super(e), this.label2id = Object.fromEntries(Object.entries(this.model.config.label2id).map(([e, t]) => [e.toLowerCase(), t])), this.entailment_id = this.label2id.entailment, this.entailment_id === void 0 && (console.warn("Could not find 'entailment' in label2id mapping. Using 2 as entailment_id."), this.entailment_id = 2), this.contradiction_id = this.label2id.contradiction ?? this.label2id.not_entailment, this.contradiction_id === void 0 && (console.warn("Could not find 'contradiction' in label2id mapping. Using 0 as contradiction_id."), this.contradiction_id = 0);
			}
			async _call(e, t, { hypothesis_template: n = "This example is {}.", multi_label: r = !1 } = {}) {
				let i = Array.isArray(e);
				i || (e = [e]), Array.isArray(t) || (t = [t]);
				let a = t.map((e) => n.replace("{}", e)), o = r || t.length === 1, s = [];
				for (let n of e) {
					let e = [];
					for (let t of a) {
						let r = this.tokenizer(n, {
							text_pair: t,
							padding: !0,
							truncation: !0
						}), i = await this.model(r);
						o ? e.push([i.logits.data[this.contradiction_id], i.logits.data[this.entailment_id]]) : e.push(i.logits.data[this.entailment_id]);
					}
					let r = (o ? e.map((e) => (0, c.softmax)(e)[1]) : (0, c.softmax)(e)).map((e, t) => [e, t]).sort((e, t) => t[0] - e[0]);
					s.push({
						sequence: n,
						labels: r.map((e) => t[e[1]]),
						scores: r.map((e) => e[0])
					});
				}
				return i ? s : s[0];
			}
		}
		class E extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, { pooling: t = "none", normalize: n = !1, quantize: r = !1, precision: i = "binary" } = {}) {
				let a = this.tokenizer(e, {
					padding: !0,
					truncation: !0
				}), o = await this.model(a), s = o.last_hidden_state ?? o.logits ?? o.token_embeddings;
				switch (t) {
					case "none": break;
					case "mean":
						s = (0, u.mean_pooling)(s, a.attention_mask);
						break;
					case "first_token":
					case "cls":
						s = s.slice(null, 0);
						break;
					case "last_token":
					case "eos":
						s = s.slice(null, -1);
						break;
					default: throw Error(`Pooling method '${t}' not supported.`);
				}
				return n && (s = s.normalize(2, -1)), r && (s = (0, u.quantize_embeddings)(s, i)), s;
			}
		}
		class D extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, { pool: t = null } = {}) {
				let n = await f(e), { pixel_values: r } = await this.processor(n), i = await this.model({ pixel_values: r }), a;
				if (t) {
					if (!("pooler_output" in i)) throw Error("No pooled output was returned. Make sure the model has a 'pooler' layer when using the 'pool' option.");
					a = i.pooler_output;
				} else a = i.last_hidden_state ?? i.logits ?? i.image_embeds;
				return a;
			}
		}
		class O extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, { top_k: t = 5 } = {}) {
				let n = this.processor.feature_extractor.config.sampling_rate, r = await p(e, n), i = this.model.config.id2label, a = [];
				for (let e of r) {
					let n = await this.processor(e), r = (await this.model(n)).logits[0], o = await (0, u.topk)(new u.Tensor("float32", (0, c.softmax)(r.data), r.dims), t), s = o[0].tolist(), l = o[1].tolist().map((e, t) => ({
						label: i ? i[e] : `LABEL_${e}`,
						score: s[t]
					}));
					a.push(l);
				}
				return Array.isArray(e) ? a : a[0];
			}
		}
		class k extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, t, { hypothesis_template: n = "This is a sound of {}." } = {}) {
				let r = !Array.isArray(e);
				r && (e = [e]);
				let i = t.map((e) => n.replace("{}", e)), a = this.tokenizer(i, {
					padding: !0,
					truncation: !0
				}), o = this.processor.feature_extractor.config.sampling_rate, s = await p(e, o), l = [];
				for (let e of s) {
					let n = await this.processor(e), r = await this.model({
						...a,
						...n
					}), i = (0, c.softmax)(r.logits_per_audio.data);
					l.push([...i].map((e, n) => ({
						score: e,
						label: t[n]
					})));
				}
				return r ? l[0] : l;
			}
		}
		class A extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, t = {}) {
				switch (this.model.config.model_type) {
					case "whisper":
					case "lite-whisper": return this._call_whisper(e, t);
					case "wav2vec2":
					case "wav2vec2-bert":
					case "unispeech":
					case "unispeech-sat":
					case "hubert":
					case "parakeet_ctc": return this._call_wav2vec2(e, t);
					case "moonshine": return this._call_moonshine(e, t);
					default: throw Error(`AutomaticSpeechRecognitionPipeline does not support model type '${this.model.config.model_type}'.`);
				}
			}
			async _call_wav2vec2(e, t) {
				t.language && console.warn("`language` parameter is not yet supported for `wav2vec2` models, defaulting to \"English\"."), t.task && console.warn("`task` parameter is not yet supported for `wav2vec2` models, defaulting to \"transcribe\".");
				let n = !Array.isArray(e);
				n && (e = [e]);
				let r = this.processor.feature_extractor.config.sampling_rate, i = await p(e, r), a = [];
				for (let e of i) {
					let t = await this.processor(e), n = (await this.model(t)).logits[0], r = [];
					for (let e of n) r.push((0, c.max)(e.data)[1]);
					let i = this.tokenizer.decode(r, { skip_special_tokens: !0 }).trim();
					a.push({ text: i });
				}
				return n ? a[0] : a;
			}
			async _call_whisper(e, t) {
				let n = t.return_timestamps ?? !1, r = t.chunk_length_s ?? 0, i = t.force_full_sequences ?? !1, a = t.stride_length_s ?? null, o = { ...t };
				n === "word" && (o.return_token_timestamps = !0, o.return_timestamps = !1);
				let s = !Array.isArray(e);
				s && (e = [e]);
				let l = this.processor.feature_extractor.config.chunk_length / this.model.config.max_source_positions, u = this.processor.feature_extractor.config.hop_length, d = this.processor.feature_extractor.config.sampling_rate, f = await p(e, d), m = [];
				for (let e of f) {
					let t = [];
					if (r > 0) {
						if (a === null) a = r / 6;
						else if (r <= a) throw Error("`chunk_length_s` must be larger than `stride_length_s`.");
						let n = d * r, i = d * a, o = n - 2 * i, s = 0;
						for (;;) {
							let r = s + n, a = e.subarray(s, r), c = await this.processor(a), l = s === 0, u = r >= e.length;
							if (t.push({
								stride: [
									a.length,
									l ? 0 : i,
									u ? 0 : i
								],
								input_features: c.input_features,
								is_last: u
							}), u) break;
							s += o;
						}
					} else t = [{
						stride: [
							e.length,
							0,
							0
						],
						input_features: (await this.processor(e)).input_features,
						is_last: !0
					}];
					for (let e of t) {
						o.num_frames = Math.floor(e.stride[0] / u);
						let t = await this.model.generate({
							inputs: e.input_features,
							...o
						});
						n === "word" ? (e.tokens = t.sequences.tolist()[0], e.token_timestamps = t.token_timestamps.tolist()[0].map((e) => (0, c.round)(e, 2))) : e.tokens = t[0].tolist(), e.stride = e.stride.map((e) => e / d);
					}
					let [s, f] = this.tokenizer._decode_asr(t, {
						time_precision: l,
						return_timestamps: n,
						force_full_sequences: i
					});
					m.push({
						text: s,
						...f
					});
				}
				return s ? m[0] : m;
			}
			async _call_moonshine(e, t) {
				let n = !Array.isArray(e);
				n && (e = [e]);
				let r = this.processor.feature_extractor.config.sampling_rate, i = await p(e, r), a = [];
				for (let e of i) {
					let n = await this.processor(e), i = Math.floor(e.length / r) * 6, o = await this.model.generate({
						max_new_tokens: i,
						...t,
						...n
					}), s = this.processor.batch_decode(o, { skip_special_tokens: !0 })[0];
					a.push({ text: s });
				}
				return n ? a[0] : a;
			}
		}
		class ee extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, t = {}) {
				let n = Array.isArray(e), r = await f(e), { pixel_values: i } = await this.processor(r), a = [];
				for (let e of i) {
					e.dims = [1, ...e.dims];
					let n = await this.model.generate({
						inputs: e,
						...t
					}), r = this.tokenizer.batch_decode(n, { skip_special_tokens: !0 }).map((e) => ({ generated_text: e.trim() }));
					a.push(r);
				}
				return n ? a : a[0];
			}
		}
		class te extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, { top_k: t = 5 } = {}) {
				let n = await f(e), { pixel_values: r } = await this.processor(n), i = await this.model({ pixel_values: r }), a = this.model.config.id2label, o = [];
				for (let e of i.logits) {
					let n = await (0, u.topk)(new u.Tensor("float32", (0, c.softmax)(e.data), e.dims), t), r = n[0].tolist(), i = n[1].tolist().map((e, t) => ({
						label: a ? a[e] : `LABEL_${e}`,
						score: r[t]
					}));
					o.push(i);
				}
				return Array.isArray(e) ? o : o[0];
			}
		}
		class j extends h {
			constructor(e) {
				super(e), this.subtasks_mapping = {
					panoptic: "post_process_panoptic_segmentation",
					instance: "post_process_instance_segmentation",
					semantic: "post_process_semantic_segmentation"
				};
			}
			async _call(e, { threshold: t = .5, mask_threshold: n = .5, overlap_mask_area_threshold: r = .8, label_ids_to_fuse: i = null, target_sizes: a = null, subtask: o = null } = {}) {
				if (Array.isArray(e) && e.length !== 1) throw Error("Image segmentation pipeline currently only supports a batch size of 1.");
				let s = await f(e), c = s.map((e) => [e.height, e.width]), l = await this.processor(s), { inputNames: u, outputNames: p } = this.model.sessions.model;
				if (!u.includes("pixel_values")) {
					if (u.length !== 1) throw Error(`Expected a single input name, but got ${u.length} inputs: ${u}.`);
					let e = u[0];
					if (e in l) throw Error(`Input name ${e} already exists in the inputs.`);
					l[e] = l.pixel_values;
				}
				let m = await this.model(l), h = null;
				if (o !== null) h = this.subtasks_mapping[o];
				else if (this.processor.image_processor) {
					for (let [e, t] of Object.entries(this.subtasks_mapping)) if (t in this.processor.image_processor) {
						h = this.processor.image_processor[t].bind(this.processor.image_processor), o = e;
						break;
					}
				}
				let g = this.model.config.id2label, _ = [];
				if (!o) {
					let e = m[p[0]];
					for (let t = 0; t < c.length; ++t) {
						let n = c[t], r = e[t];
						r.data.some((e) => e < -1e-5 || e > 1.00001) && r.sigmoid_();
						let i = await d.RawImage.fromTensor(r.mul_(255).to("uint8")).resize(n[1], n[0]);
						_.push({
							label: null,
							score: null,
							mask: i
						});
					}
				} else if (o === "panoptic" || o === "instance") {
					let e = h(m, t, n, r, i, a ?? c)[0], o = e.segmentation;
					for (let t of e.segments_info) {
						let e = new Uint8ClampedArray(o.data.length);
						for (let n = 0; n < o.data.length; ++n) o.data[n] === t.id && (e[n] = 255);
						let n = new d.RawImage(e, o.dims[1], o.dims[0], 1);
						_.push({
							score: t.score,
							label: g[t.label_id],
							mask: n
						});
					}
				} else if (o === "semantic") {
					let { segmentation: e, labels: t } = h(m, a ?? c)[0];
					for (let n of t) {
						let t = new Uint8ClampedArray(e.data.length);
						for (let r = 0; r < e.data.length; ++r) e.data[r] === n && (t[r] = 255);
						let r = new d.RawImage(t, e.dims[1], e.dims[0], 1);
						_.push({
							score: null,
							label: g[n],
							mask: r
						});
					}
				} else throw Error(`Subtask ${o} not supported.`);
				return _;
			}
		}
		class M extends j {
			constructor(e) {
				super(e);
			}
			async _call(e, t = {}) {
				if (Array.isArray(e) && e.length !== 1) throw Error("Background removal pipeline currently only supports a batch size of 1.");
				let n = await f(e), r = await super._call(e, t);
				return n.map((e, t) => {
					let n = e.clone();
					return n.putAlpha(r[t].mask), n;
				});
			}
		}
		class N extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, t, { hypothesis_template: n = "This is a photo of {}" } = {}) {
				let r = Array.isArray(e), i = await f(e), a = t.map((e) => n.replace("{}", e)), o = this.tokenizer(a, {
					padding: this.model.config.model_type !== "siglip" || "max_length",
					truncation: !0
				}), { pixel_values: s } = await this.processor(i), l = await this.model({
					...o,
					pixel_values: s
				}), u = this.model.config.model_type === "siglip" ? (e) => e.sigmoid().data : (e) => (0, c.softmax)(e.data), d = [];
				for (let e of l.logits_per_image) {
					let n = [...u(e)].map((e, n) => ({
						score: e,
						label: t[n]
					}));
					n.sort((e, t) => t.score - e.score), d.push(n);
				}
				return r ? d : d[0];
			}
		}
		class ne extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, { threshold: t = .9, percentage: n = !1 } = {}) {
				let r = Array.isArray(e);
				if (r && e.length !== 1) throw Error("Object detection pipeline currently only supports a batch size of 1.");
				let i = await f(e), a = n ? null : i.map((e) => [e.height, e.width]), { pixel_values: o, pixel_mask: s } = await this.processor(i), c = await this.model({
					pixel_values: o,
					pixel_mask: s
				}), l = this.processor.image_processor.post_process_object_detection(c, t, a), u = this.model.config.id2label, d = l.map((e) => e.boxes.map((t, r) => ({
					score: e.scores[r],
					label: u[e.classes[r]],
					box: m(t, !n)
				})));
				return r ? d : d[0];
			}
		}
		class P extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, t, { threshold: n = .1, top_k: r = null, percentage: i = !1 } = {}) {
				let a = Array.isArray(e), o = await f(e), s = this.tokenizer(t, {
					padding: !0,
					truncation: !0
				}), c = await this.processor(o), l = [];
				for (let e = 0; e < o.length; ++e) {
					let a = o[e], u = i ? null : [[a.height, a.width]], d = c.pixel_values[e].unsqueeze_(0), f = await this.model({
						...s,
						pixel_values: d
					}), p;
					if ("post_process_grounded_object_detection" in this.processor) {
						let e = this.processor.post_process_grounded_object_detection(f, s.input_ids, {
							box_threshold: n,
							text_threshold: n,
							target_sizes: u
						})[0];
						p = e.boxes.map((t, n) => ({
							score: e.scores[n],
							label: e.labels[n],
							box: m(t, !i)
						}));
					} else {
						let e = this.processor.image_processor.post_process_object_detection(f, n, u, !0)[0];
						p = e.boxes.map((n, r) => ({
							score: e.scores[r],
							label: t[e.classes[r]],
							box: m(n, !i)
						}));
					}
					p.sort((e, t) => t.score - e.score), r !== null && (p = p.slice(0, r)), l.push(p);
				}
				return a ? l : l[0];
			}
		}
		class F extends h {
			constructor(e) {
				super(e);
			}
			async _call(e, t, n = {}) {
				let r = (await f(e))[0], { pixel_values: i } = await this.processor(r), a = `<s_docvqa><s_question>${t}</s_question><s_answer>`, o = this.tokenizer(a, {
					add_special_tokens: !1,
					padding: !0,
					truncation: !0
				}).input_ids, s = await this.model.generate({
					inputs: i,
					max_length: this.model.config.decoder.max_position_embeddings,
					decoder_input_ids: o,
					...n
				}), c = this.tokenizer.batch_decode(s)[0].match(/<s_answer>(.*?)<\/s_answer>/), l = null;
				return c && c.length >= 2 && (l = c[1].trim()), [{ answer: l }];
			}
		}
		class re extends h {
			DEFAULT_VOCODER_ID = "Xenova/speecht5_hifigan";
			constructor(e) {
				super(e), this.vocoder = e.vocoder ?? null;
			}
			async _prepare_speaker_embeddings(e) {
				if ((typeof e == "string" || e instanceof URL) && (e = new Float32Array(await (await fetch(e)).arrayBuffer())), e instanceof Float32Array) e = new u.Tensor("float32", e, [e.length]);
				else if (!(e instanceof u.Tensor)) throw Error("Speaker embeddings must be a `Tensor`, `Float32Array`, `string`, or `URL`.");
				return e;
			}
			async _call(e, { speaker_embeddings: t = null, num_inference_steps: n, speed: r } = {}) {
				return this.processor ? this._call_text_to_spectrogram(e, { speaker_embeddings: t }) : this.model.config.model_type === "supertonic" ? this._call_supertonic(e, {
					speaker_embeddings: t,
					num_inference_steps: n,
					speed: r
				}) : this._call_text_to_waveform(e);
			}
			async _call_supertonic(e, { speaker_embeddings: t, num_inference_steps: n, speed: r }) {
				if (!t) throw Error("Speaker embeddings must be provided for Supertonic models.");
				t = await this._prepare_speaker_embeddings(t);
				let { sampling_rate: i, style_dim: a } = this.model.config;
				t = t.view(1, -1, a);
				let o = this.tokenizer(e, {
					padding: !0,
					truncation: !0
				}), { waveform: s } = await this.model.generate_speech({
					...o,
					style: t,
					num_inference_steps: n,
					speed: r
				});
				return new l.RawAudio(s.data, i);
			}
			async _call_text_to_waveform(e) {
				let t = this.tokenizer(e, {
					padding: !0,
					truncation: !0
				}), { waveform: n } = await this.model(t), r = this.model.config.sampling_rate;
				return new l.RawAudio(n.data, r);
			}
			async _call_text_to_spectrogram(e, { speaker_embeddings: t }) {
				this.vocoder ||= (console.log("No vocoder specified, using default HifiGan vocoder."), await i.AutoModel.from_pretrained(this.DEFAULT_VOCODER_ID, { dtype: "fp32" }));
				let { input_ids: n } = this.tokenizer(e, {
					padding: !0,
					truncation: !0
				});
				t = await this._prepare_speaker_embeddings(t), t = t.view(1, -1);
				let { waveform: r } = await this.model.generate_speech(n, t, { vocoder: this.vocoder }), a = this.processor.feature_extractor.config.sampling_rate;
				return new l.RawAudio(r.data, a);
			}
		}
		class ie extends h {
			constructor(e) {
				super(e);
			}
			async _call(e) {
				let t = await f(e), n = await this.processor(t), r = await this.model(n), i = [];
				for (let e of r.reconstruction) {
					let t = e.squeeze().clamp_(0, 1).mul_(255).round_().to("uint8");
					i.push(d.RawImage.fromTensor(t));
				}
				return i.length > 1 ? i : i[0];
			}
		}
		class I extends h {
			constructor(e) {
				super(e);
			}
			async _call(e) {
				let t = await f(e), n = await this.processor(t), { predicted_depth: r } = await this.model(n), i = [];
				for (let e = 0; e < t.length; ++e) {
					let n = r[e], [a, o] = n.dims.slice(-2), [s, c] = t[e].size, l = (await (0, u.interpolate_4d)(n.view(1, 1, a, o), {
						size: [c, s],
						mode: "bilinear"
					})).view(c, s), f = l.min().item(), p = l.max().item(), m = l.sub(f).div_(p - f).mul_(255).to("uint8").unsqueeze(0), h = d.RawImage.fromTensor(m);
					i.push({
						predicted_depth: l,
						depth: h
					});
				}
				return i.length > 1 ? i : i[0];
			}
		}
		let L = Object.freeze({
			"text-classification": {
				tokenizer: r.AutoTokenizer,
				pipeline: g,
				model: i.AutoModelForSequenceClassification,
				default: { model: "Xenova/distilbert-base-uncased-finetuned-sst-2-english" },
				type: "text"
			},
			"token-classification": {
				tokenizer: r.AutoTokenizer,
				pipeline: _,
				model: i.AutoModelForTokenClassification,
				default: { model: "Xenova/bert-base-multilingual-cased-ner-hrl" },
				type: "text"
			},
			"question-answering": {
				tokenizer: r.AutoTokenizer,
				pipeline: v,
				model: i.AutoModelForQuestionAnswering,
				default: { model: "Xenova/distilbert-base-cased-distilled-squad" },
				type: "text"
			},
			"fill-mask": {
				tokenizer: r.AutoTokenizer,
				pipeline: y,
				model: i.AutoModelForMaskedLM,
				default: { model: "Xenova/bert-base-uncased" },
				type: "text"
			},
			summarization: {
				tokenizer: r.AutoTokenizer,
				pipeline: x,
				model: i.AutoModelForSeq2SeqLM,
				default: { model: "Xenova/distilbart-cnn-6-6" },
				type: "text"
			},
			translation: {
				tokenizer: r.AutoTokenizer,
				pipeline: S,
				model: i.AutoModelForSeq2SeqLM,
				default: { model: "Xenova/t5-small" },
				type: "text"
			},
			"text2text-generation": {
				tokenizer: r.AutoTokenizer,
				pipeline: b,
				model: i.AutoModelForSeq2SeqLM,
				default: { model: "Xenova/flan-t5-small" },
				type: "text"
			},
			"text-generation": {
				tokenizer: r.AutoTokenizer,
				pipeline: w,
				model: i.AutoModelForCausalLM,
				default: { model: "Xenova/gpt2" },
				type: "text"
			},
			"zero-shot-classification": {
				tokenizer: r.AutoTokenizer,
				pipeline: T,
				model: i.AutoModelForSequenceClassification,
				default: { model: "Xenova/distilbert-base-uncased-mnli" },
				type: "text"
			},
			"audio-classification": {
				pipeline: O,
				model: i.AutoModelForAudioClassification,
				processor: a.AutoProcessor,
				default: { model: "Xenova/wav2vec2-base-superb-ks" },
				type: "audio"
			},
			"zero-shot-audio-classification": {
				tokenizer: r.AutoTokenizer,
				pipeline: k,
				model: i.AutoModel,
				processor: a.AutoProcessor,
				default: { model: "Xenova/clap-htsat-unfused" },
				type: "multimodal"
			},
			"automatic-speech-recognition": {
				tokenizer: r.AutoTokenizer,
				pipeline: A,
				model: [i.AutoModelForSpeechSeq2Seq, i.AutoModelForCTC],
				processor: a.AutoProcessor,
				default: { model: "Xenova/whisper-tiny.en" },
				type: "multimodal"
			},
			"text-to-audio": {
				tokenizer: r.AutoTokenizer,
				pipeline: re,
				model: [i.AutoModelForTextToWaveform, i.AutoModelForTextToSpectrogram],
				processor: [a.AutoProcessor, null],
				default: { model: "Xenova/speecht5_tts" },
				type: "text"
			},
			"image-to-text": {
				tokenizer: r.AutoTokenizer,
				pipeline: ee,
				model: i.AutoModelForVision2Seq,
				processor: a.AutoProcessor,
				default: { model: "Xenova/vit-gpt2-image-captioning" },
				type: "multimodal"
			},
			"image-classification": {
				pipeline: te,
				model: i.AutoModelForImageClassification,
				processor: a.AutoProcessor,
				default: { model: "Xenova/vit-base-patch16-224" },
				type: "multimodal"
			},
			"image-segmentation": {
				pipeline: j,
				model: [
					i.AutoModelForImageSegmentation,
					i.AutoModelForSemanticSegmentation,
					i.AutoModelForUniversalSegmentation
				],
				processor: a.AutoProcessor,
				default: { model: "Xenova/detr-resnet-50-panoptic" },
				type: "multimodal"
			},
			"background-removal": {
				pipeline: M,
				model: [
					i.AutoModelForImageSegmentation,
					i.AutoModelForSemanticSegmentation,
					i.AutoModelForUniversalSegmentation
				],
				processor: a.AutoProcessor,
				default: { model: "Xenova/modnet" },
				type: "image"
			},
			"zero-shot-image-classification": {
				tokenizer: r.AutoTokenizer,
				pipeline: N,
				model: i.AutoModel,
				processor: a.AutoProcessor,
				default: { model: "Xenova/clip-vit-base-patch32" },
				type: "multimodal"
			},
			"object-detection": {
				pipeline: ne,
				model: i.AutoModelForObjectDetection,
				processor: a.AutoProcessor,
				default: { model: "Xenova/detr-resnet-50" },
				type: "multimodal"
			},
			"zero-shot-object-detection": {
				tokenizer: r.AutoTokenizer,
				pipeline: P,
				model: i.AutoModelForZeroShotObjectDetection,
				processor: a.AutoProcessor,
				default: { model: "Xenova/owlvit-base-patch32" },
				type: "multimodal"
			},
			"document-question-answering": {
				tokenizer: r.AutoTokenizer,
				pipeline: F,
				model: i.AutoModelForDocumentQuestionAnswering,
				processor: a.AutoProcessor,
				default: { model: "Xenova/donut-base-finetuned-docvqa" },
				type: "multimodal"
			},
			"image-to-image": {
				pipeline: ie,
				model: i.AutoModelForImageToImage,
				processor: a.AutoProcessor,
				default: { model: "Xenova/swin2SR-classical-sr-x2-64" },
				type: "image"
			},
			"depth-estimation": {
				pipeline: I,
				model: i.AutoModelForDepthEstimation,
				processor: a.AutoProcessor,
				default: { model: "Xenova/dpt-large" },
				type: "image"
			},
			"feature-extraction": {
				tokenizer: r.AutoTokenizer,
				pipeline: E,
				model: i.AutoModel,
				default: { model: "Xenova/all-MiniLM-L6-v2" },
				type: "text"
			},
			"image-feature-extraction": {
				processor: a.AutoProcessor,
				pipeline: D,
				model: [i.AutoModelForImageFeatureExtraction, i.AutoModel],
				default: { model: "Xenova/vit-base-patch16-224-in21k" },
				type: "image"
			}
		}), ae = Object.freeze({
			"sentiment-analysis": "text-classification",
			ner: "token-classification",
			asr: "automatic-speech-recognition",
			"text-to-speech": "text-to-audio",
			embeddings: "feature-extraction"
		});
		async function oe(e, t = null, { progress_callback: n = null, config: r = null, cache_dir: i = null, local_files_only: a = !1, revision: o = "main", device: c = null, dtype: l = null, subfolder: u = "onnx", use_external_data_format: d = null, model_file_name: f = null, session_options: p = {} } = {}) {
			e = ae[e] ?? e;
			let m = L[e.split("_", 1)[0]];
			if (!m) throw Error(`Unsupported pipeline: ${e}. Must be one of [${Object.keys(L)}]`);
			t || (t = m.default.model, console.log(`No model specified. Using default model: "${t}".`));
			let h = {
				progress_callback: n,
				config: r,
				cache_dir: i,
				local_files_only: a,
				revision: o,
				device: c,
				dtype: l,
				subfolder: u,
				use_external_data_format: d,
				model_file_name: f,
				session_options: p
			}, g = await se(/* @__PURE__ */ new Map([
				["tokenizer", m.tokenizer],
				["model", m.model],
				["processor", m.processor]
			]), t, h);
			g.task = e, (0, s.dispatchCallback)(n, {
				status: "ready",
				task: e,
				model: t
			});
			let _ = m.pipeline;
			return new _(g);
		}
		async function se(e, t, n) {
			let r = Object.create(null), i = [];
			for (let [a, o] of e.entries()) {
				if (!o) continue;
				let e;
				e = Array.isArray(o) ? new Promise(async (e, r) => {
					let i;
					for (let a of o) {
						if (a === null) {
							e(null);
							return;
						}
						try {
							e(await a.from_pretrained(t, n));
							return;
						} catch (e) {
							if (e.message?.includes("Unsupported model type")) i = e;
							else if (e.message?.includes("Could not locate file")) i = e;
							else {
								r(e);
								return;
							}
						}
					}
					r(i);
				}) : o.from_pretrained(t, n), r[a] = e, i.push(e);
			}
			await Promise.all(i);
			for (let [e, t] of Object.entries(r)) r[e] = await t;
			return r;
		}
	}),
	"./src/tokenizers.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			AlbertTokenizer: () => Pe,
			AutoTokenizer: () => wt,
			BartTokenizer: () => qe,
			BertTokenizer: () => Ne,
			BlenderbotSmallTokenizer: () => vt,
			BlenderbotTokenizer: () => _t,
			BloomTokenizer: () => Ze,
			CLIPTokenizer: () => pt,
			CamembertTokenizer: () => He,
			CodeGenTokenizer: () => ft,
			CodeLlamaTokenizer: () => $e,
			CohereTokenizer: () => St,
			ConvBertTokenizer: () => ze,
			DebertaTokenizer: () => Y,
			DebertaV2Tokenizer: () => Le,
			DistilBertTokenizer: () => Ve,
			ElectraTokenizer: () => We,
			EsmTokenizer: () => it,
			FalconTokenizer: () => nt,
			GPT2Tokenizer: () => Ke,
			GPTNeoXTokenizer: () => rt,
			GemmaTokenizer: () => ot,
			Grok1Tokenizer: () => st,
			HerbertTokenizer: () => Re,
			LlamaTokenizer: () => Qe,
			M2M100Tokenizer: () => ut,
			MBart50Tokenizer: () => Ye,
			MBartTokenizer: () => Je,
			MPNetTokenizer: () => tt,
			MarianTokenizer: () => ht,
			MgpstrTokenizer: () => Ct,
			MobileBertTokenizer: () => Fe,
			NllbTokenizer: () => lt,
			NougatTokenizer: () => bt,
			PreTrainedTokenizer: () => J,
			Qwen2Tokenizer: () => at,
			RoFormerTokenizer: () => Be,
			RobertaTokenizer: () => Xe,
			SiglipTokenizer: () => mt,
			SpeechT5Tokenizer: () => yt,
			SqueezeBertTokenizer: () => Ie,
			T5Tokenizer: () => Ge,
			TokenizerModel: () => D,
			VitsTokenizer: () => xt,
			Wav2Vec2CTCTokenizer: () => gt,
			WhisperTokenizer: () => dt,
			XLMRobertaTokenizer: () => et,
			XLMTokenizer: () => Ue,
			is_chinese_char: () => y
		});
		var r = n("./src/utils/generic.js"), i = n("./src/utils/core.js"), a = n("./src/utils/hub.js"), o = n("./src/utils/maths.js"), s = n("./src/utils/tensor.js"), c = n("./src/utils/data-structures.js"), l = n("./node_modules/@huggingface/jinja/dist/index.js"), u = n("./src/models/whisper/common_whisper.js");
		async function d(e, t) {
			let n = await Promise.all([(0, a.getModelJSON)(e, "tokenizer.json", !0, t), (0, a.getModelJSON)(e, "tokenizer_config.json", !0, t)]);
			return t.legacy !== null && (n[1].legacy = t.legacy), n;
		}
		function f(e, t) {
			let n = [], r = 0;
			for (let i of e.matchAll(t)) {
				let t = i[0];
				r < i.index && n.push(e.slice(r, i.index)), t.length > 0 && n.push(t), r = i.index + t.length;
			}
			return r < e.length && n.push(e.slice(r)), n;
		}
		function p(e, t = !0) {
			if (e.Regex !== void 0) {
				let t = e.Regex.replace(/\\([#&~])/g, "$1");
				for (let [e, n] of T) t = t.replaceAll(e, n);
				return new RegExp(t, "gu");
			}
			if (e.String !== void 0) {
				let n = (0, i.escapeRegExp)(e.String);
				return new RegExp(t ? n : `(${n})`, "gu");
			}
			return console.warn("Unknown pattern type:", e), null;
		}
		function m(e) {
			return new Map(Object.entries(e));
		}
		function h(e) {
			let t = e.dims;
			switch (t.length) {
				case 1: return e.tolist();
				case 2:
					if (t[0] !== 1) throw Error("Unable to decode tensor with `batch size !== 1`. Use `tokenizer.batch_decode(...)` for batched inputs.");
					return e.tolist()[0];
				default: throw Error(`Expected tensor to have 1-2 dimensions, got ${t.length}.`);
			}
		}
		function g(e) {
			return e.replace(/ \./g, ".").replace(/ \?/g, "?").replace(/ \!/g, "!").replace(/ ,/g, ",").replace(/ \' /g, "'").replace(/ n\'t/g, "n't").replace(/ \'m/g, "'m").replace(/ \'s/g, "'s").replace(/ \'ve/g, "'ve").replace(/ \'re/g, "'re");
		}
		function _(e) {
			return e.replace(/\p{M}/gu, "");
		}
		function v(e) {
			return _(e.toLowerCase());
		}
		function y(e) {
			return e >= 19968 && e <= 40959 || e >= 13312 && e <= 19903 || e >= 131072 && e <= 173791 || e >= 173824 && e <= 177983 || e >= 177984 && e <= 178207 || e >= 178208 && e <= 183983 || e >= 63744 && e <= 64255 || e >= 194560 && e <= 195103;
		}
		function b(e, t, n) {
			let r = [], i = 0;
			for (; i < e.length;) {
				if (r.push(e[i]), (t.get(e[i]) ?? n) !== n) {
					++i;
					continue;
				}
				for (; ++i < e.length && (t.get(e[i]) ?? n) === n;) t.get(r.at(-1)) !== n && (r[r.length - 1] += e[i]);
			}
			return r;
		}
		function x(e) {
			return e.match(/\S+/g) || [];
		}
		let S = "\\p{P}\\u0021-\\u002F\\u003A-\\u0040\\u005B-\\u0060\\u007B-\\u007E", C = RegExp(`^[${S}]+$`, "gu"), w = ".,!?…。，、।۔،", T = /* @__PURE__ */ new Map([
			["(?i:'s|'t|'re|'ve|'m|'ll|'d)", "(?:'([sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD]))"],
			["(?i:[sdmt]|ll|ve|re)", "(?:[sS]|[dD]|[mM]|[tT]|[lL][lL]|[vV][eE]|[rR][eE])"],
			["[^\\r\\n\\p{L}\\p{N}]?+", "[^\\r\\n\\p{L}\\p{N}]?"],
			["[^\\s\\p{L}\\p{N}]++", "[^\\s\\p{L}\\p{N}]+"],
			[` ?[^(\\s|[${w}])]+`, ` ?[^\\s${w}]+`]
		]);
		class E {
			constructor(e) {
				this.content = e.content, this.id = e.id, this.single_word = e.single_word ?? !1, this.lstrip = e.lstrip ?? !1, this.rstrip = e.rstrip ?? !1, this.special = e.special ?? !1, this.normalized = e.normalized ?? null;
			}
		}
		class D extends r.Callable {
			constructor(e) {
				super(), this.config = e, this.vocab = [], this.tokens_to_ids = /* @__PURE__ */ new Map(), this.unk_token_id = void 0, this.unk_token = void 0, this.end_of_word_suffix = void 0, this.fuse_unk = this.config.fuse_unk ?? !1;
			}
			static fromConfig(e, ...t) {
				switch (e.type) {
					case "WordPiece": return new O(e);
					case "Unigram": return new k(e, ...t);
					case "BPE": return new te(e);
					default:
						if (e.vocab) return Array.isArray(e.vocab) ? new k(e, ...t) : Object.hasOwn(e, "continuing_subword_prefix") && Object.hasOwn(e, "unk_token") ? Object.hasOwn(e, "merges") ? new te(e) : new O(e) : new j(e, ...t);
						throw Error(`Unknown TokenizerModel type: ${e.type}`);
				}
			}
			_call(e) {
				return e = this.encode(e), this.fuse_unk && (e = b(e, this.tokens_to_ids, this.unk_token_id)), e;
			}
			encode(e) {
				throw Error("encode should be implemented in subclass.");
			}
			convert_tokens_to_ids(e) {
				return e.map((e) => this.tokens_to_ids.get(e) ?? this.unk_token_id);
			}
			convert_ids_to_tokens(e) {
				return e.map((e) => this.vocab[e] ?? this.unk_token);
			}
		}
		class O extends D {
			constructor(e) {
				super(e), this.tokens_to_ids = m(e.vocab), this.unk_token_id = this.tokens_to_ids.get(e.unk_token), this.unk_token = e.unk_token, this.max_input_chars_per_word = e.max_input_chars_per_word ?? 100, this.vocab = Array(this.tokens_to_ids.size);
				for (let [e, t] of this.tokens_to_ids) this.vocab[t] = e;
			}
			encode(e) {
				let t = [];
				for (let n of e) {
					let e = [...n];
					if (e.length > this.max_input_chars_per_word) {
						t.push(this.unk_token);
						continue;
					}
					let r = !1, i = 0, a = [];
					for (; i < e.length;) {
						let t = e.length, n = null;
						for (; i < t;) {
							let r = e.slice(i, t).join("");
							if (i > 0 && (r = this.config.continuing_subword_prefix + r), this.tokens_to_ids.has(r)) {
								n = r;
								break;
							}
							--t;
						}
						if (n === null) {
							r = !0;
							break;
						}
						a.push(n), i = t;
					}
					r ? t.push(this.unk_token) : t.push(...a);
				}
				return t;
			}
		}
		class k extends D {
			constructor(e, t) {
				super(e);
				let n = e.vocab.length;
				this.vocab = Array(n), this.scores = Array(n);
				for (let t = 0; t < n; ++t) [this.vocab[t], this.scores[t]] = e.vocab[t];
				this.unk_token_id = e.unk_id, this.unk_token = this.vocab[e.unk_id], this.tokens_to_ids = new Map(this.vocab.map((e, t) => [e, t])), this.bos_token = " ", this.bos_token_id = this.tokens_to_ids.get(this.bos_token), this.eos_token = t.eos_token, this.eos_token_id = this.tokens_to_ids.get(this.eos_token), this.unk_token = this.vocab[this.unk_token_id], this.minScore = (0, o.min)(this.scores)[0], this.unk_score = this.minScore - 10, this.scores[this.unk_token_id] = this.unk_score, this.trie = new c.CharTrie(), this.trie.extend(this.vocab), this.fuse_unk = !0;
			}
			populateNodes(e) {
				let t = e.chars, n = 0;
				for (; n < t.length;) {
					let r = !1, a = [], o = t.slice(n).join(""), s = this.trie.commonPrefixSearch(o);
					for (let t of s) {
						a.push(t);
						let o = this.tokens_to_ids.get(t), s = this.scores[o], c = (0, i.len)(t);
						e.insert(n, c, s, o), !r && c === 1 && (r = !0);
					}
					r || e.insert(n, 1, this.unk_score, this.unk_token_id), n += 1;
				}
			}
			tokenize(e) {
				let t = new c.TokenLattice(e, this.bos_token_id, this.eos_token_id);
				return this.populateNodes(t), t.tokens();
			}
			encode(e) {
				let t = [];
				for (let n of e) {
					let e = this.tokenize(n);
					t.push(...e);
				}
				return t;
			}
		}
		let A = (() => {
			let e = [
				...Array.from({ length: 94 }, (e, t) => t + 33),
				...Array.from({ length: 12 }, (e, t) => t + 161),
				...Array.from({ length: 82 }, (e, t) => t + 174)
			], t = e.slice(), n = 0;
			for (let r = 0; r < 256; ++r) e.includes(r) || (e.push(r), t.push(256 + n), n += 1);
			let r = t.map((e) => String.fromCharCode(e));
			return Object.fromEntries(e.map((e, t) => [e, r[t]]));
		})(), ee = (0, i.reverseDictionary)(A);
		class te extends D {
			constructor(e) {
				super(e), this.tokens_to_ids = m(e.vocab), this.unk_token_id = this.tokens_to_ids.get(e.unk_token), this.unk_token = e.unk_token, this.vocab = Array(this.tokens_to_ids.size);
				for (let [e, t] of this.tokens_to_ids) this.vocab[t] = e;
				let t = Array.isArray(e.merges[0]);
				this.merges = t ? e.merges : e.merges.map((e) => e.split(" ", 2)), this.bpe_ranks = new Map(this.merges.map((e, t) => [JSON.stringify(e), t])), this.end_of_word_suffix = e.end_of_word_suffix, this.continuing_subword_suffix = e.continuing_subword_suffix ?? null, this.byte_fallback = this.config.byte_fallback ?? !1, this.byte_fallback && (this.text_encoder = new TextEncoder()), this.ignore_merges = this.config.ignore_merges ?? !1, this.max_length_to_cache = 256, this.cache_capacity = 1e4, this.cache = new c.LRUCache(this.cache_capacity);
			}
			clear_cache() {
				this.cache.clear();
			}
			bpe(e) {
				if (e.length === 0) return [];
				let t = this.cache.get(e);
				if (t !== void 0) return t;
				let n = Array.from(e);
				this.end_of_word_suffix && (n[n.length - 1] += this.end_of_word_suffix);
				let r = [];
				if (n.length > 1) {
					let e = new c.PriorityQueue((e, t) => e.score < t.score), t = {
						token: n[0],
						bias: 0,
						prev: null,
						next: null
					}, i = t;
					for (let t = 1; t < n.length; ++t) {
						let r = {
							bias: t / n.length,
							token: n[t],
							prev: i,
							next: null
						};
						i.next = r, this._add_node(e, i), i = r;
					}
					for (; !e.isEmpty();) {
						let n = e.pop();
						if (n.deleted || !n.next || n.next.deleted) continue;
						if (n.deleted = !0, n.next.deleted = !0, n.prev) {
							let e = { ...n.prev };
							n.prev.deleted = !0, n.prev = e, e.prev ? e.prev.next = e : t = e;
						}
						let r = {
							token: n.token + n.next.token,
							bias: n.bias,
							prev: n.prev,
							next: n.next.next
						};
						r.prev ? (r.prev.next = r, this._add_node(e, r.prev)) : t = r, r.next && (r.next.prev = r, this._add_node(e, r));
					}
					for (let e = t; e !== null; e = e.next) r.push(e.token);
				} else r = n;
				if (this.continuing_subword_suffix) for (let e = 0; e < r.length - 1; ++e) r[e] += this.continuing_subword_suffix;
				return e.length < this.max_length_to_cache && this.cache.put(e, r), r;
			}
			_add_node(e, t) {
				let n = this.bpe_ranks.get(JSON.stringify([t.token, t.next.token]));
				n !== void 0 && (t.score = n + t.bias, e.push(t));
			}
			encode(e) {
				let t = [];
				for (let n of e) {
					if (this.ignore_merges && this.tokens_to_ids.has(n)) {
						t.push(n);
						continue;
					}
					let e = this.bpe(n);
					for (let n of e) if (this.tokens_to_ids.has(n)) t.push(n);
					else if (this.byte_fallback) {
						let e = Array.from(this.text_encoder.encode(n)).map((e) => `<0x${e.toString(16).toUpperCase().padStart(2, "0")}>`);
						e.every((e) => this.tokens_to_ids.has(e)) ? t.push(...e) : t.push(this.unk_token);
					} else t.push(this.unk_token);
				}
				return t;
			}
		}
		class j extends D {
			constructor(e, t) {
				super(e), this.tokens_to_ids = m(t.target_lang ? e.vocab[t.target_lang] : e.vocab), this.bos_token = t.bos_token, this.bos_token_id = this.tokens_to_ids.get(this.bos_token), this.eos_token = t.eos_token, this.eos_token_id = this.tokens_to_ids.get(this.eos_token), this.pad_token = t.pad_token, this.pad_token_id = this.tokens_to_ids.get(this.pad_token), this.unk_token = t.unk_token, this.unk_token_id = this.tokens_to_ids.get(this.unk_token), this.vocab = Array(this.tokens_to_ids.size);
				for (let [e, t] of this.tokens_to_ids) this.vocab[t] = e;
			}
			encode(e) {
				return e;
			}
		}
		class M extends r.Callable {
			constructor(e) {
				super(), this.config = e;
			}
			static fromConfig(e) {
				if (e === null) return null;
				switch (e.type) {
					case "BertNormalizer": return new ce(e);
					case "Precompiled": return new we(e);
					case "Sequence": return new se(e);
					case "Replace": return new N(e);
					case "NFC": return new P(e);
					case "NFD": return new F(e);
					case "NFKC": return new re(e);
					case "NFKD": return new ie(e);
					case "Strip": return new I(e);
					case "StripAccents": return new L(e);
					case "Lowercase": return new ae(e);
					case "Prepend": return new oe(e);
					default: throw Error(`Unknown Normalizer type: ${e.type}`);
				}
			}
			normalize(e) {
				throw Error("normalize should be implemented in subclass.");
			}
			_call(e) {
				return this.normalize(e);
			}
		}
		class N extends M {
			normalize(e) {
				let t = p(this.config.pattern);
				return t === null ? e : e.replaceAll(t, this.config.content);
			}
		}
		class ne extends M {
			form = void 0;
			normalize(e) {
				return e = e.normalize(this.form), e;
			}
		}
		class P extends ne {
			form = "NFC";
		}
		class F extends ne {
			form = "NFD";
		}
		class re extends ne {
			form = "NFKC";
		}
		class ie extends ne {
			form = "NFKD";
		}
		class I extends M {
			normalize(e) {
				return this.config.strip_left && this.config.strip_right ? e = e.trim() : (this.config.strip_left && (e = e.trimStart()), this.config.strip_right && (e = e.trimEnd())), e;
			}
		}
		class L extends M {
			normalize(e) {
				return e = _(e), e;
			}
		}
		class ae extends M {
			normalize(e) {
				return e = e.toLowerCase(), e;
			}
		}
		class oe extends M {
			normalize(e) {
				return e = this.config.prepend + e, e;
			}
		}
		class se extends M {
			constructor(e) {
				super(e), this.normalizers = e.normalizers.map((e) => M.fromConfig(e));
			}
			normalize(e) {
				return this.normalizers.reduce((e, t) => t.normalize(e), e);
			}
		}
		class ce extends M {
			_tokenize_chinese_chars(e) {
				let t = [];
				for (let n = 0; n < e.length; ++n) {
					let r = e[n];
					y(r.charCodeAt(0)) ? (t.push(" "), t.push(r), t.push(" ")) : t.push(r);
				}
				return t.join("");
			}
			stripAccents(e) {
				return e.normalize("NFD").replace(/\p{Mn}/gu, "");
			}
			_is_control(e) {
				switch (e) {
					case "	":
					case "\n":
					case "\r": return !1;
					default: return /^\p{Cc}|\p{Cf}|\p{Co}|\p{Cs}$/u.test(e);
				}
			}
			_clean_text(e) {
				let t = [];
				for (let n of e) {
					let e = n.charCodeAt(0);
					e === 0 || e === 65533 || this._is_control(n) || (/^\s$/.test(n) ? t.push(" ") : t.push(n));
				}
				return t.join("");
			}
			normalize(e) {
				return this.config.clean_text && (e = this._clean_text(e)), this.config.handle_chinese_chars && (e = this._tokenize_chinese_chars(e)), this.config.lowercase ? (e = e.toLowerCase(), this.config.strip_accents !== !1 && (e = this.stripAccents(e))) : this.config.strip_accents && (e = this.stripAccents(e)), e;
			}
		}
		class R extends r.Callable {
			static fromConfig(e) {
				if (e === null) return null;
				switch (e.type) {
					case "BertPreTokenizer": return new z(e);
					case "Sequence": return new Te(e);
					case "Whitespace": return new Ee(e);
					case "WhitespaceSplit": return new De(e);
					case "Metaspace": return new Se(e);
					case "ByteLevel": return new le(e);
					case "Split": return new ue(e);
					case "Punctuation": return new de(e);
					case "Digits": return new fe(e);
					case "Replace": return new Oe(e);
					case "FixedLength": return new ke(e);
					default: throw Error(`Unknown PreTokenizer type: ${e.type}`);
				}
			}
			pre_tokenize_text(e, t) {
				throw Error("pre_tokenize_text should be implemented in subclass.");
			}
			pre_tokenize(e, t) {
				return (Array.isArray(e) ? e.map((e) => this.pre_tokenize_text(e, t)) : this.pre_tokenize_text(e, t)).flat();
			}
			_call(e, t) {
				return this.pre_tokenize(e, t);
			}
		}
		class z extends R {
			constructor(e) {
				super(), this.pattern = RegExp(`[^\\s${S}]+|[${S}]`, "gu");
			}
			pre_tokenize_text(e, t) {
				return e.trim().match(this.pattern) || [];
			}
		}
		class le extends R {
			constructor(e) {
				super(), this.config = e, this.add_prefix_space = this.config.add_prefix_space, this.trim_offsets = this.config.trim_offsets, this.use_regex = this.config.use_regex ?? !0, this.pattern = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu, this.byte_encoder = A, this.text_encoder = new TextEncoder();
			}
			pre_tokenize_text(e, t) {
				return this.add_prefix_space && !e.startsWith(" ") && (e = " " + e), (this.use_regex ? e.match(this.pattern) || [] : [e]).map((e) => Array.from(this.text_encoder.encode(e), (e) => this.byte_encoder[e]).join(""));
			}
		}
		class ue extends R {
			constructor(e) {
				super(), this.config = e, this.pattern = p(this.config.pattern, this.config.invert);
			}
			pre_tokenize_text(e, t) {
				return this.pattern === null ? [] : this.config.invert ? e.match(this.pattern) || [] : this.config.behavior?.toLowerCase() === "removed" ? e.split(this.pattern).filter((e) => e) : f(e, this.pattern);
			}
		}
		class de extends R {
			constructor(e) {
				super(), this.config = e, this.pattern = RegExp(`[^${S}]+|[${S}]+`, "gu");
			}
			pre_tokenize_text(e, t) {
				return e.match(this.pattern) || [];
			}
		}
		class fe extends R {
			constructor(e) {
				super(), this.config = e;
				let t = `[^\\d]+|\\d${this.config.individual_digits ? "" : "+"}`;
				this.pattern = new RegExp(t, "gu");
			}
			pre_tokenize_text(e, t) {
				return e.match(this.pattern) || [];
			}
		}
		class B extends r.Callable {
			constructor(e) {
				super(), this.config = e;
			}
			static fromConfig(e) {
				if (e === null) return null;
				switch (e.type) {
					case "TemplateProcessing": return new U(e);
					case "ByteLevel": return new W(e);
					case "RobertaProcessing": return new H(e);
					case "BertProcessing": return new V(e);
					case "Sequence": return new pe(e);
					default: throw Error(`Unknown PostProcessor type: ${e.type}`);
				}
			}
			post_process(e, ...t) {
				throw Error("post_process should be implemented in subclass.");
			}
			_call(e, ...t) {
				return this.post_process(e, ...t);
			}
		}
		class V extends B {
			constructor(e) {
				super(e), this.cls = e.cls[0], this.sep = e.sep[0];
			}
			post_process(e, t = null, { add_special_tokens: n = !0 } = {}) {
				n && (e = (0, i.mergeArrays)([this.cls], e, [this.sep]));
				let r = Array(e.length).fill(0);
				if (t !== null) {
					let a = n && this instanceof H ? [this.sep] : [], o = n ? [this.sep] : [];
					e = (0, i.mergeArrays)(e, a, t, o), r = (0, i.mergeArrays)(r, Array(t.length + a.length + o.length).fill(1));
				}
				return {
					tokens: e,
					token_type_ids: r
				};
			}
		}
		class H extends V {}
		class U extends B {
			constructor(e) {
				super(e), this.single = e.single, this.pair = e.pair;
			}
			post_process(e, t = null, { add_special_tokens: n = !0 } = {}) {
				let r = t === null ? this.single : this.pair, a = [], o = [];
				for (let s of r) "SpecialToken" in s ? n && (a.push(s.SpecialToken.id), o.push(s.SpecialToken.type_id)) : "Sequence" in s && (s.Sequence.id === "A" ? (a = (0, i.mergeArrays)(a, e), o = (0, i.mergeArrays)(o, Array(e.length).fill(s.Sequence.type_id))) : s.Sequence.id === "B" && (a = (0, i.mergeArrays)(a, t), o = (0, i.mergeArrays)(o, Array(t.length).fill(s.Sequence.type_id))));
				return {
					tokens: a,
					token_type_ids: o
				};
			}
		}
		class W extends B {
			post_process(e, t = null) {
				return t && (e = (0, i.mergeArrays)(e, t)), { tokens: e };
			}
		}
		class pe extends B {
			constructor(e) {
				super(e), this.processors = e.processors.map((e) => B.fromConfig(e));
			}
			post_process(e, t = null, n = {}) {
				let r;
				for (let i of this.processors) if (i instanceof W) e = i.post_process(e).tokens, t &&= i.post_process(t).tokens;
				else {
					let a = i.post_process(e, t, n);
					e = a.tokens, r = a.token_type_ids;
				}
				return {
					tokens: e,
					token_type_ids: r
				};
			}
		}
		class G extends r.Callable {
			constructor(e) {
				super(), this.config = e, this.added_tokens = [], this.end_of_word_suffix = null, this.trim_offsets = e.trim_offsets;
			}
			static fromConfig(e) {
				if (e === null) return null;
				switch (e.type) {
					case "WordPiece": return new ge(e);
					case "Metaspace": return new Ce(e);
					case "ByteLevel": return new _e(e);
					case "Replace": return new me(e);
					case "ByteFallback": return new K(e);
					case "Fuse": return new he(e);
					case "Strip": return new q(e);
					case "Sequence": return new ye(e);
					case "CTC": return new ve(e);
					case "BPEDecoder": return new be(e);
					default: throw Error(`Unknown Decoder type: ${e.type}`);
				}
			}
			_call(e) {
				return this.decode(e);
			}
			decode(e) {
				return this.decode_chain(e).join("");
			}
			decode_chain(e) {
				throw Error("`decode_chain` should be implemented in subclass.");
			}
		}
		class me extends G {
			decode_chain(e) {
				let t = p(this.config.pattern);
				return t === null ? e : e.map((e) => e.replaceAll(t, this.config.content));
			}
		}
		class K extends G {
			constructor(e) {
				super(e), this.text_decoder = new TextDecoder();
			}
			decode_chain(e) {
				let t = [], n = [];
				for (let r of e) {
					let e = null;
					if (r.length === 6 && r.startsWith("<0x") && r.endsWith(">")) {
						let t = parseInt(r.slice(3, 5), 16);
						isNaN(t) || (e = t);
					}
					if (e !== null) n.push(e);
					else {
						if (n.length > 0) {
							let e = this.text_decoder.decode(Uint8Array.from(n));
							t.push(e), n = [];
						}
						t.push(r);
					}
				}
				if (n.length > 0) {
					let e = this.text_decoder.decode(Uint8Array.from(n));
					t.push(e), n = [];
				}
				return t;
			}
		}
		class he extends G {
			decode_chain(e) {
				return [e.join("")];
			}
		}
		class q extends G {
			constructor(e) {
				super(e), this.content = this.config.content, this.start = this.config.start, this.stop = this.config.stop;
			}
			decode_chain(e) {
				return e.map((e) => {
					let t = 0;
					for (let n = 0; n < this.start && e[n] === this.content; ++n) t = n + 1;
					let n = e.length;
					for (let t = 0; t < this.stop; ++t) {
						let r = e.length - t - 1;
						if (e[r] === this.content) {
							n = r;
							continue;
						}
						break;
					}
					return e.slice(t, n);
				});
			}
		}
		class ge extends G {
			constructor(e) {
				super(e), this.cleanup = e.cleanup;
			}
			decode_chain(e) {
				return e.map((e, t) => (t !== 0 && (e = e.startsWith(this.config.prefix) ? e.replace(this.config.prefix, "") : " " + e), this.cleanup && (e = g(e)), e));
			}
		}
		class _e extends G {
			constructor(e) {
				super(e), this.byte_decoder = ee, this.text_decoder = new TextDecoder("utf-8", {
					fatal: !1,
					ignoreBOM: !0
				}), this.end_of_word_suffix = null;
			}
			convert_tokens_to_string(e) {
				let t = e.join(""), n = new Uint8Array([...t].map((e) => this.byte_decoder[e]));
				return this.text_decoder.decode(n);
			}
			decode_chain(e) {
				let t = [], n = [];
				for (let r of e) this.added_tokens.find((e) => e.content === r) === void 0 ? n.push(r) : (n.length > 0 && (t.push(this.convert_tokens_to_string(n)), n = []), t.push(r));
				return n.length > 0 && t.push(this.convert_tokens_to_string(n)), t;
			}
		}
		class ve extends G {
			constructor(e) {
				super(e), this.pad_token = this.config.pad_token, this.word_delimiter_token = this.config.word_delimiter_token, this.cleanup = this.config.cleanup;
			}
			convert_tokens_to_string(e) {
				if (e.length === 0) return "";
				let t = [e[0]];
				for (let n = 1; n < e.length; ++n) e[n] !== t.at(-1) && t.push(e[n]);
				let n = t.filter((e) => e !== this.pad_token).join("");
				return this.cleanup && (n = g(n).replaceAll(this.word_delimiter_token, " ").trim()), n;
			}
			decode_chain(e) {
				return [this.convert_tokens_to_string(e)];
			}
		}
		class ye extends G {
			constructor(e) {
				super(e), this.decoders = e.decoders.map((e) => G.fromConfig(e));
			}
			decode_chain(e) {
				return this.decoders.reduce((e, t) => t.decode_chain(e), e);
			}
		}
		class be extends G {
			constructor(e) {
				super(e), this.suffix = this.config.suffix;
			}
			decode_chain(e) {
				return e.map((t, n) => t.replaceAll(this.suffix, n === e.length - 1 ? "" : " "));
			}
		}
		class xe extends G {
			decode_chain(e) {
				let t = "";
				for (let n = 1; n < e.length; n += 2) t += e[n];
				return [t];
			}
		}
		class Se extends R {
			constructor(e) {
				super(), this.replacement = e.replacement, this.strRep = e.str_rep || this.replacement, this.prepend_scheme = e.prepend_scheme ?? "always";
			}
			pre_tokenize_text(e, { section_index: t = void 0 } = {}) {
				let n = e.replaceAll(" ", this.strRep);
				return !n.startsWith(this.replacement) && (this.prepend_scheme === "always" || this.prepend_scheme === "first" && t === 0) && (n = this.strRep + n), [n];
			}
		}
		class Ce extends G {
			constructor(e) {
				super(e), this.replacement = e.replacement;
			}
			decode_chain(e) {
				let t = [];
				for (let n = 0; n < e.length; ++n) {
					let r = e[n].replaceAll(this.replacement, " ");
					n == 0 && r.startsWith(" ") && (r = r.substring(1)), t.push(r);
				}
				return t;
			}
		}
		class we extends M {
			constructor(e) {
				super(e), this.charsmap = e.precompiled_charsmap;
			}
			normalize(e) {
				return e = e.replace(/[\u0001-\u0008\u000B\u000E-\u001F\u007F\u008F\u009F]/gm, ""), e = e.replace(/[\u0009\u000A\u000C\u000D\u00A0\u1680\u2000-\u200F\u2028\u2029\u202F\u205F\u2581\u3000\uFEFF\uFFFD]/gm, " "), e = e.includes("～") ? e.split("～").map((e) => e.normalize("NFKC")).join("～") : e.normalize("NFKC"), e;
			}
		}
		class Te extends R {
			constructor(e) {
				super(), this.tokenizers = e.pretokenizers.map((e) => R.fromConfig(e));
			}
			pre_tokenize_text(e, t) {
				return this.tokenizers.reduce((e, n) => n.pre_tokenize(e, t), [e]);
			}
		}
		class Ee extends R {
			constructor(e) {
				super();
			}
			pre_tokenize_text(e, t) {
				return e.match(/\w+|[^\w\s]+/g) || [];
			}
		}
		class De extends R {
			constructor(e) {
				super();
			}
			pre_tokenize_text(e, t) {
				return x(e);
			}
		}
		class Oe extends R {
			constructor(e) {
				super(), this.config = e, this.pattern = p(this.config.pattern), this.content = this.config.content;
			}
			pre_tokenize_text(e, t) {
				return this.pattern === null ? [e] : [e.replaceAll(this.pattern, this.config.content)];
			}
		}
		class ke extends R {
			constructor(e) {
				super(), this._length = e.length;
			}
			pre_tokenize_text(e, t) {
				let n = [];
				for (let t = 0; t < e.length; t += this._length) n.push(e.slice(t, t + this._length));
				return n;
			}
		}
		let Ae = [
			"bos_token",
			"eos_token",
			"unk_token",
			"sep_token",
			"pad_token",
			"cls_token",
			"mask_token"
		];
		function je(e, t, n, r) {
			for (let a of Object.keys(e)) {
				let o = t - e[a].length, s = n(a), c = Array(o).fill(s);
				e[a] = r === "right" ? (0, i.mergeArrays)(e[a], c) : (0, i.mergeArrays)(c, e[a]);
			}
		}
		function Me(e, t) {
			for (let n of Object.keys(e)) e[n].length = t;
		}
		class J extends r.Callable {
			return_token_type_ids = !1;
			padding_side = "right";
			constructor(e, t) {
				super(), this.config = t, this.normalizer = M.fromConfig(e.normalizer), this.pre_tokenizer = R.fromConfig(e.pre_tokenizer), this.model = D.fromConfig(e.model, t), this.post_processor = B.fromConfig(e.post_processor), this.decoder = G.fromConfig(e.decoder), this.special_tokens = [], this.all_special_ids = [], this.added_tokens = [];
				for (let t of e.added_tokens) {
					let e = new E(t);
					this.added_tokens.push(e), this.model.tokens_to_ids.set(e.content, e.id), this.model.vocab[e.id] = e.content, e.special && (this.special_tokens.push(e.content), this.all_special_ids.push(e.id));
				}
				if (this.additional_special_tokens = t.additional_special_tokens ?? [], this.special_tokens.push(...this.additional_special_tokens), this.special_tokens = [...new Set(this.special_tokens)], this.decoder && (this.decoder.added_tokens = this.added_tokens, this.decoder.end_of_word_suffix = this.model.end_of_word_suffix), this.added_tokens_splitter = new c.DictionarySplitter(this.added_tokens.map((e) => e.content)), this.added_tokens_map = new Map(this.added_tokens.map((e) => [e.content, e])), this.mask_token = this.getToken("mask_token"), this.mask_token_id = this.model.tokens_to_ids.get(this.mask_token), this.pad_token = this.getToken("pad_token", "eos_token"), this.pad_token_id = this.model.tokens_to_ids.get(this.pad_token), this.sep_token = this.getToken("sep_token"), this.sep_token_id = this.model.tokens_to_ids.get(this.sep_token), this.unk_token = this.getToken("unk_token"), this.unk_token_id = this.model.tokens_to_ids.get(this.unk_token), this.bos_token = this.getToken("bos_token"), this.bos_token_id = this.model.tokens_to_ids.get(this.bos_token), this.eos_token = this.getToken("eos_token"), this.eos_token_id = this.model.tokens_to_ids.get(this.eos_token), this.model_max_length = t.model_max_length, this.remove_space = t.remove_space, this.clean_up_tokenization_spaces = t.clean_up_tokenization_spaces ?? !0, this.do_lowercase_and_remove_accent = t.do_lowercase_and_remove_accent ?? !1, t.padding_side && (this.padding_side = t.padding_side), this.add_bos_token = t.add_bos_token, this.add_eos_token = t.add_eos_token, this.legacy = !1, this.chat_template = t.chat_template ?? null, Array.isArray(this.chat_template)) {
					let e = Object.create(null);
					for (let { name: t, template: n } of this.chat_template) {
						if (typeof t != "string" || typeof n != "string") throw Error("Chat template must be a list of objects with \"name\" and \"template\" properties");
						e[t] = n;
					}
					this.chat_template = e;
				}
				this._compiled_template_cache = /* @__PURE__ */ new Map();
			}
			getToken(...e) {
				for (let t of e) {
					let e = this.config[t];
					if (e) {
						if (typeof e == "object") {
							if (e.__type === "AddedToken") return e.content;
							throw Error(`Unknown token: ${e}`);
						}
						return e;
					}
				}
				return null;
			}
			static async from_pretrained(e, { progress_callback: t = null, config: n = null, cache_dir: r = null, local_files_only: i = !1, revision: a = "main", legacy: o = null } = {}) {
				let s = await d(e, {
					progress_callback: t,
					config: n,
					cache_dir: r,
					local_files_only: i,
					revision: a,
					legacy: o
				});
				return new this(...s);
			}
			_call(e, { text_pair: t = null, add_special_tokens: n = !0, padding: r = !1, truncation: i = null, max_length: a = null, return_tensor: c = !0, return_token_type_ids: l = null } = {}) {
				let u = Array.isArray(e), d;
				if (u) {
					if (e.length === 0) throw Error("text array must be non-empty");
					if (t !== null) {
						if (!Array.isArray(t)) throw Error("text_pair must also be an array");
						if (e.length !== t.length) throw Error("text and text_pair must have the same length");
						d = e.map((e, r) => this._encode_plus(e, {
							text_pair: t[r],
							add_special_tokens: n,
							return_token_type_ids: l
						}));
					} else d = e.map((e) => this._encode_plus(e, {
						add_special_tokens: n,
						return_token_type_ids: l
					}));
				} else {
					if (e == null) throw Error("text may not be null or undefined");
					if (Array.isArray(t)) throw Error("When specifying `text_pair`, since `text` is a string, `text_pair` must also be a string (i.e., not an array).");
					d = [this._encode_plus(e, {
						text_pair: t,
						add_special_tokens: n,
						return_token_type_ids: l
					})];
				}
				if (a === null ? a = this.model_max_length : i === null && (r === !0 ? (console.warn("`max_length` is ignored when `padding: true` and there is no truncation strategy. To pad to max length, use `padding: 'max_length'`."), a = this.model_max_length) : r === !1 && (console.warn("Truncation was not explicitly activated but `max_length` is provided a specific value, please use `truncation: true` to explicitly truncate examples to max length."), i = !0)), r === !0 && (a = Math.min((0, o.max)(d.map((e) => e.input_ids.length))[0], a ?? Infinity)), a = Math.min(a, this.model_max_length ?? Infinity), r || i) for (let e = 0; e < d.length; ++e) if (d[e].input_ids.length === a) continue;
				else d[e].input_ids.length > a ? i && Me(d[e], a) : r && je(d[e], a, (e) => e === "input_ids" ? this.pad_token_id : 0, this.padding_side);
				let f = {};
				if (c) {
					if (!(r && i) && d.some((e) => {
						for (let t of Object.keys(e)) if (e[t].length !== d[0][t]?.length) return !0;
						return !1;
					})) throw Error("Unable to create tensor, you should probably activate truncation and/or padding with 'padding=true' and 'truncation=true' to have batched tensors with the same length.");
					let e = [d.length, d[0].input_ids.length];
					for (let t of Object.keys(d[0])) f[t] = new s.Tensor("int64", BigInt64Array.from(d.flatMap((e) => e[t]).map(BigInt)), e);
				} else {
					for (let e of Object.keys(d[0])) f[e] = d.map((t) => t[e]);
					if (!u) for (let e of Object.keys(f)) f[e] = f[e][0];
				}
				return f;
			}
			_encode_text(e) {
				if (e === null) return null;
				let t = this.added_tokens_splitter.split(e);
				for (let e = 0; e < t.length; ++e) {
					let n = this.added_tokens_map.get(t[e]);
					n && (n.lstrip && e > 0 && (t[e - 1] = t[e - 1].trimEnd()), n.rstrip && e < t.length - 1 && (t[e + 1] = t[e + 1].trimStart()));
				}
				return t.flatMap((e, t) => {
					if (e.length === 0) return [];
					if (this.added_tokens_map.has(e)) return [e];
					if (this.remove_space === !0 && (e = e.trim().split(/\s+/).join(" ")), this.do_lowercase_and_remove_accent && (e = v(e)), this.normalizer !== null && (e = this.normalizer(e)), e.length === 0) return [];
					let n = this.pre_tokenizer === null ? [e] : this.pre_tokenizer(e, { section_index: t });
					return this.model(n);
				});
			}
			_encode_plus(e, { text_pair: t = null, add_special_tokens: n = !0, return_token_type_ids: r = null } = {}) {
				let { tokens: i, token_type_ids: a } = this._tokenize_helper(e, {
					pair: t,
					add_special_tokens: n
				}), o = this.model.convert_tokens_to_ids(i), s = {
					input_ids: o,
					attention_mask: Array(o.length).fill(1)
				};
				return (r ?? this.return_token_type_ids) && a && (s.token_type_ids = a), s;
			}
			_tokenize_helper(e, { pair: t = null, add_special_tokens: n = !1 } = {}) {
				let r = this._encode_text(e), a = this._encode_text(t);
				return this.post_processor ? this.post_processor(r, a, { add_special_tokens: n }) : { tokens: (0, i.mergeArrays)(r ?? [], a ?? []) };
			}
			tokenize(e, { pair: t = null, add_special_tokens: n = !1 } = {}) {
				return this._tokenize_helper(e, {
					pair: t,
					add_special_tokens: n
				}).tokens;
			}
			encode(e, { text_pair: t = null, add_special_tokens: n = !0, return_token_type_ids: r = null } = {}) {
				return this._encode_plus(e, {
					text_pair: t,
					add_special_tokens: n,
					return_token_type_ids: r
				}).input_ids;
			}
			batch_decode(e, t = {}) {
				return e instanceof s.Tensor && (e = e.tolist()), e.map((e) => this.decode(e, t));
			}
			decode(e, t = {}) {
				if (e instanceof s.Tensor && (e = h(e)), !Array.isArray(e) || e.length === 0 || !(0, i.isIntegralNumber)(e[0])) throw Error("token_ids must be a non-empty array of integers.");
				return this.decode_single(e, t);
			}
			decode_single(e, { skip_special_tokens: t = !1, clean_up_tokenization_spaces: n = null }) {
				let r = this.model.convert_ids_to_tokens(e);
				t && (r = r.filter((e) => !this.special_tokens.includes(e)));
				let i = this.decoder ? this.decoder(r) : r.join(" ");
				return this.decoder && this.decoder.end_of_word_suffix && (i = i.replaceAll(this.decoder.end_of_word_suffix, " "), t && (i = i.trim())), (n ?? this.clean_up_tokenization_spaces) && (i = g(i)), i;
			}
			get_chat_template({ chat_template: e = null, tools: t = null } = {}) {
				if (this.chat_template && typeof this.chat_template == "object") {
					let n = this.chat_template;
					if (e !== null && Object.hasOwn(n, e)) e = n[e];
					else if (e === null) {
						if (t !== null && "tool_use" in n) e = n.tool_use;
						else if ("default" in n) e = n.default;
						else throw Error(`This model has multiple chat templates with no default specified! Please either pass a chat template or the name of the template you wish to use to the 'chat_template' argument. Available template names are ${Object.keys(n).sort()}.`);
					}
				} else if (e === null) {
					if (this.chat_template) e = this.chat_template;
					else throw Error("Cannot use apply_chat_template() because tokenizer.chat_template is not set and no template argument was passed! For information about writing templates and setting the tokenizer.chat_template attribute, please see the documentation at https://huggingface.co/docs/transformers/main/en/chat_templating");
				}
				return e;
			}
			apply_chat_template(e, { tools: t = null, documents: n = null, chat_template: r = null, add_generation_prompt: i = !1, tokenize: a = !0, padding: o = !1, truncation: s = !1, max_length: c = null, return_tensor: u = !0, return_dict: d = !1, tokenizer_kwargs: f = {}, ...p } = {}) {
				if (r = this.get_chat_template({
					chat_template: r,
					tools: t
				}), typeof r != "string") throw Error(`chat_template must be a string, but got ${typeof r}`);
				let m = this._compiled_template_cache.get(r);
				m === void 0 && (m = new l.Template(r), this._compiled_template_cache.set(r, m));
				let h = Object.create(null);
				for (let e of Ae) {
					let t = this.getToken(e);
					t && (h[e] = t);
				}
				let g = m.render({
					messages: e,
					add_generation_prompt: i,
					tools: t,
					documents: n,
					...h,
					...p
				});
				if (a) {
					let e = this._call(g, {
						add_special_tokens: !1,
						padding: o,
						truncation: s,
						max_length: c,
						return_tensor: u,
						...f
					});
					return d ? e : e.input_ids;
				}
				return g;
			}
		}
		class Ne extends J {
			return_token_type_ids = !0;
		}
		class Pe extends J {
			return_token_type_ids = !0;
		}
		class Fe extends J {
			return_token_type_ids = !0;
		}
		class Ie extends J {
			return_token_type_ids = !0;
		}
		class Y extends J {
			return_token_type_ids = !0;
		}
		class Le extends J {
			return_token_type_ids = !0;
		}
		class Re extends J {
			return_token_type_ids = !0;
		}
		class ze extends J {
			return_token_type_ids = !0;
		}
		class Be extends J {
			return_token_type_ids = !0;
		}
		class Ve extends J {}
		class He extends J {}
		class Ue extends J {
			return_token_type_ids = !0;
			constructor(e, t) {
				super(e, t), console.warn("WARNING: `XLMTokenizer` is not yet supported by Hugging Face's \"fast\" tokenizers library. Therefore, you may experience slightly inaccurate results.");
			}
		}
		class We extends J {
			return_token_type_ids = !0;
		}
		class Ge extends J {}
		class Ke extends J {}
		class qe extends J {}
		class Je extends J {
			constructor(e, t) {
				super(e, t), this.languageRegex = /^[a-z]{2}_[A-Z]{2}$/, this.language_codes = this.special_tokens.filter((e) => this.languageRegex.test(e)), this.lang_to_token = (e) => e;
			}
			_build_translation_inputs(e, t, n) {
				return ct(this, e, t, n);
			}
		}
		class Ye extends Je {}
		class Xe extends J {}
		class Ze extends J {}
		class Qe extends J {
			padding_side = "left";
			constructor(e, t) {
				super(e, t), this.legacy = t.legacy ?? !0, this.legacy || (this.normalizer = null, this.pre_tokenizer = new Se({
					replacement: "▁",
					prepend_scheme: "first"
				}));
			}
			_encode_text(e) {
				if (e === null) return null;
				if (this.legacy || e.length === 0) return super._encode_text(e);
				let t = super._encode_text("▁" + e.replaceAll("▁", " "));
				return t.length > 1 && t[0] === "▁" && this.special_tokens.includes(t[1]) && (t = t.slice(1)), t;
			}
		}
		class $e extends J {}
		class et extends J {}
		class tt extends J {}
		class nt extends J {}
		class rt extends J {}
		class it extends J {}
		class at extends J {}
		class ot extends J {}
		class st extends J {}
		function ct(e, t, n, r) {
			if (!("language_codes" in e) || !Array.isArray(e.language_codes)) throw Error("Tokenizer must have `language_codes` attribute set and it should be an array of language ids.");
			if (!("languageRegex" in e) || !(e.languageRegex instanceof RegExp)) throw Error("Tokenizer must have `languageRegex` attribute set and it should be a regular expression.");
			if (!("lang_to_token" in e) || typeof e.lang_to_token != "function") throw Error("Tokenizer must have `lang_to_token` attribute set and it should be a function.");
			let i = r.src_lang, a = r.tgt_lang;
			if (!e.language_codes.includes(a)) throw Error(`Target language code "${a}" is not valid. Must be one of: {${e.language_codes.join(", ")}}`);
			if (i !== void 0) {
				if (!e.language_codes.includes(i)) throw Error(`Source language code "${i}" is not valid. Must be one of: {${e.language_codes.join(", ")}}`);
				for (let t of e.post_processor.config.single) if ("SpecialToken" in t && e.languageRegex.test(t.SpecialToken.id)) {
					t.SpecialToken.id = e.lang_to_token(i);
					break;
				}
			}
			return r.forced_bos_token_id = e.model.convert_tokens_to_ids([e.lang_to_token(a)])[0], e._call(t, n);
		}
		class lt extends J {
			constructor(e, t) {
				super(e, t), this.languageRegex = /^[a-z]{3}_[A-Z][a-z]{3}$/, this.language_codes = this.special_tokens.filter((e) => this.languageRegex.test(e)), this.lang_to_token = (e) => e;
			}
			_build_translation_inputs(e, t, n) {
				return ct(this, e, t, n);
			}
		}
		class ut extends J {
			constructor(e, t) {
				super(e, t), this.languageRegex = /^__[a-z]{2,3}__$/, this.language_codes = this.special_tokens.filter((e) => this.languageRegex.test(e)).map((e) => e.slice(2, -2)), this.lang_to_token = (e) => `__${e}__`;
			}
			_build_translation_inputs(e, t, n) {
				return ct(this, e, t, n);
			}
		}
		class dt extends J {
			get timestamp_begin() {
				return this.model.convert_tokens_to_ids(["<|notimestamps|>"])[0] + 1;
			}
			_decode_asr(e, { return_timestamps: t = !1, return_language: n = !1, time_precision: r = null, force_full_sequences: i = !0 } = {}) {
				if (r === null) throw Error("Must specify time_precision");
				let a = null, s = t === "word";
				function c() {
					return {
						language: a,
						timestamp: [null, null],
						text: ""
					};
				}
				let l = [], d = c(), f = 0, p = this.timestamp_begin, m = p + 1500, h = [], g = [], _ = !1, v = null, y = new Set(this.all_special_ids);
				for (let n of e) {
					let e = n.tokens, i = s ? n.token_timestamps : null, b = null, x = p;
					if ("stride" in n) {
						let [t, i, a] = n.stride;
						if (f -= i, v = t - a, i && (x = i / r + p), a) for (let t = e.length - 1; t >= 0; --t) {
							let n = Number(e[t]);
							if (n >= p) {
								if (b !== null && (n - p) * r < v) break;
								b = n;
							}
						}
					}
					let S = [], w = [];
					for (let n = 0; n < e.length; ++n) {
						let v = Number(e[n]);
						if (y.has(v)) {
							let e = this.decode([v]), n = u.WHISPER_LANGUAGE_MAPPING.get(e.slice(2, -2));
							if (n !== void 0) {
								if (a !== null && n !== a && !t) {
									h.push(S);
									let e = this.findLongestCommonSequence(h)[0], t = this.decode(e);
									d.text = t, l.push(d), h = [], S = [], d = c();
								}
								a = d.language = n;
							}
						} else if (v >= p && v <= m) {
							let e = (v - p) * r + f, t = (0, o.round)(e, 2);
							if (b !== null && v >= b) _ = !0;
							else if (_ || h.length > 0 && v < x) _ = !1;
							else if (d.timestamp[0] === null) d.timestamp[0] = t;
							else if (t !== d.timestamp[0]) {
								d.timestamp[1] = t, h.push(S), s && g.push(w);
								let [e, n] = this.findLongestCommonSequence(h, g), r = this.decode(e);
								d.text = r, s && (d.words = this.collateWordTimestamps(e, n, a)), l.push(d), h = [], S = [], g = [], w = [], d = c();
							}
						} else if (S.push(v), s) {
							let e = (0, o.round)(i[n] + f, 2), t;
							if (n + 1 < i.length) {
								t = (0, o.round)(i[n + 1] + f, 2);
								let a = this.decode([v]);
								C.test(a) && (t = (0, o.round)(Math.min(e + r, t), 2));
							} else t = null;
							w.push([e, t]);
						}
					}
					if ("stride" in n) {
						let [e, t, r] = n.stride;
						f += e - r;
					}
					S.length > 0 ? (h.push(S), s && g.push(w)) : h.every((e) => e.length === 0) && (d = c(), h = [], S = [], g = [], w = []);
				}
				if (h.length > 0) {
					if (i && t) throw Error("Whisper did not predict an ending timestamp, which can happen if audio is cut off in the middle of a word. Also make sure WhisperTimeStampLogitsProcessor was used during generation.");
					let [e, n] = this.findLongestCommonSequence(h, g), r = this.decode(e);
					d.text = r, s && (d.words = this.collateWordTimestamps(e, n, a)), l.push(d);
				}
				let b = Object.create(null), x = l.map((e) => e.text).join("");
				if (t || n) {
					for (let e = 0; e < l.length; ++e) {
						let r = l[e];
						t || delete r.timestamp, n || delete r.language;
					}
					if (s) {
						let e = [];
						for (let t of l) for (let n of t.words) e.push(n);
						b = { chunks: e };
					} else b = { chunks: l };
				}
				return [x, b];
			}
			findLongestCommonSequence(e, t = null) {
				let n = e[0], r = n.length, i = [], a = Array.isArray(t) && t.length > 0, o = a ? [] : null, s = a ? t[0] : null;
				for (let c = 1; c < e.length; ++c) {
					let l = e[c], u = 0, d = [
						r,
						r,
						0,
						0
					], f = l.length;
					for (let e = 1; e < r + f; ++e) {
						let i = Math.max(0, r - e), o = Math.min(r, r + f - e), p = n.slice(i, o), m = Math.max(0, e - r), h = Math.min(f, e), g = l.slice(m, h);
						if (p.length !== g.length) throw Error("There is a bug within whisper `decode_asr` function, please report it. Dropping to prevent bad inference.");
						let _;
						_ = a ? p.filter((e, n) => e === g[n] && s[i + n] <= t[c][m + n]).length : p.filter((e, t) => e === g[t]).length;
						let v = e / 1e4, y = _ / e + v;
						_ > 1 && y > u && (u = y, d = [
							i,
							o,
							m,
							h
						]);
					}
					let [p, m, h, g] = d, _ = Math.floor((m + p) / 2), v = Math.floor((g + h) / 2);
					i.push(...n.slice(0, _)), n = l.slice(v), r = n.length, a && (o.push(...s.slice(0, _)), s = t[c].slice(v));
				}
				return i.push(...n), a ? (o.push(...s), [i, o]) : [i, []];
			}
			collateWordTimestamps(e, t, n) {
				let [r, i, a] = this.combineTokensIntoWords(e, n), o = [];
				for (let e = 0; e < r.length; ++e) {
					let n = a[e];
					o.push({
						text: r[e],
						timestamp: [t[n.at(0)][0], t[n.at(-1)][1]]
					});
				}
				return o;
			}
			combineTokensIntoWords(e, t, n = "\"'“¡¿([{-", r = "\"'.。,，!！?？:：”)]}、") {
				t ??= "english";
				let i, a, o;
				return [
					"chinese",
					"japanese",
					"thai",
					"lao",
					"myanmar"
				].includes(t) ? [i, a, o] = this.splitTokensOnUnicode(e) : [i, a, o] = this.splitTokensOnSpaces(e), this.mergePunctuations(i, a, o, n, r);
			}
			decode(e, t) {
				let n;
				return t?.decode_with_timestamps ? (e instanceof s.Tensor && (e = h(e)), n = this.decodeWithTimestamps(e, t)) : n = super.decode(e, t), n;
			}
			decodeWithTimestamps(e, t) {
				let n = t?.time_precision ?? .02, r = Array.from(this.all_special_ids).at(-1) + 1, i = [[]];
				for (let t of e) if (t = Number(t), t >= r) {
					let e = ((t - r) * n).toFixed(2);
					i.push(`<|${e}|>`), i.push([]);
				} else i[i.length - 1].push(t);
				return i = i.map((e) => typeof e == "string" ? e : super.decode(e, t)), i.join("");
			}
			splitTokensOnUnicode(e) {
				let t = this.decode(e, { decode_with_timestamps: !0 }), n = [], r = [], i = [], a = [], o = [], s = 0;
				for (let c = 0; c < e.length; ++c) {
					let l = e[c];
					a.push(l), o.push(c);
					let u = this.decode(a, { decode_with_timestamps: !0 });
					(!u.includes("�") || t[s + u.indexOf("�")] === "�") && (n.push(u), r.push(a), i.push(o), a = [], o = [], s += u.length);
				}
				return [
					n,
					r,
					i
				];
			}
			splitTokensOnSpaces(e) {
				let [t, n, r] = this.splitTokensOnUnicode(e), i = [], a = [], o = [], s = RegExp(`^[${S}]$`, "gu");
				for (let e = 0; e < t.length; ++e) {
					let c = t[e], l = n[e], u = r[e], d = l[0] >= this.model.tokens_to_ids.get("<|endoftext|>"), f = c.startsWith(" "), p = c.trim(), m = s.test(p);
					if (d || f || m || i.length === 0) i.push(c), a.push(l), o.push(u);
					else {
						let e = i.length - 1;
						i[e] += c, a[e].push(...l), o[e].push(...u);
					}
				}
				return [
					i,
					a,
					o
				];
			}
			mergePunctuations(e, t, n, r, a) {
				let o = structuredClone(e), s = structuredClone(t), c = structuredClone(n), l = o.length - 2, u = o.length - 1;
				for (; l >= 0;) o[l].startsWith(" ") && r.includes(o[l].trim()) ? (o[u] = o[l] + o[u], s[u] = (0, i.mergeArrays)(s[l], s[u]), c[u] = (0, i.mergeArrays)(c[l], c[u]), o[l] = "", s[l] = [], c[l] = []) : u = l, --l;
				for (l = 0, u = 1; u < o.length;) !o[l].endsWith(" ") && a.includes(o[u]) ? (o[l] += o[u], s[l] = (0, i.mergeArrays)(s[l], s[u]), c[l] = (0, i.mergeArrays)(c[l], c[u]), o[u] = "", s[u] = [], c[u] = []) : l = u, ++u;
				return [
					o.filter((e) => e),
					s.filter((e) => e.length > 0),
					c.filter((e) => e.length > 0)
				];
			}
		}
		class ft extends J {}
		class pt extends J {}
		class mt extends J {}
		class ht extends J {
			constructor(e, t) {
				super(e, t), this.languageRegex = /^(>>\w+<<)\s*/g, this.supported_language_codes = this.model.vocab.filter((e) => this.languageRegex.test(e)), console.warn("WARNING: `MarianTokenizer` is not yet supported by Hugging Face's \"fast\" tokenizers library. Therefore, you may experience slightly inaccurate results.");
			}
			_encode_text(e) {
				if (e === null) return null;
				let [t, ...n] = e.trim().split(this.languageRegex);
				if (n.length === 0) return super._encode_text(t);
				if (n.length === 2) {
					let [e, t] = n;
					return this.supported_language_codes.includes(e) || console.warn(`Unsupported language code "${e}" detected, which may lead to unexpected behavior. Should be one of: ${JSON.stringify(this.supported_language_codes)}`), (0, i.mergeArrays)([e], super._encode_text(t));
				}
			}
		}
		class gt extends J {}
		class _t extends J {}
		class vt extends J {}
		class yt extends J {}
		class bt extends J {}
		class xt extends J {
			constructor(e, t) {
				super(e, t), this.decoder = new xe({});
			}
		}
		class St extends J {}
		class Ct extends J {}
		class wt {
			static TOKENIZER_CLASS_MAPPING = {
				T5Tokenizer: Ge,
				DistilBertTokenizer: Ve,
				CamembertTokenizer: He,
				DebertaTokenizer: Y,
				DebertaV2Tokenizer: Le,
				BertTokenizer: Ne,
				HerbertTokenizer: Re,
				ConvBertTokenizer: ze,
				RoFormerTokenizer: Be,
				XLMTokenizer: Ue,
				ElectraTokenizer: We,
				MobileBertTokenizer: Fe,
				SqueezeBertTokenizer: Ie,
				AlbertTokenizer: Pe,
				GPT2Tokenizer: Ke,
				BartTokenizer: qe,
				MBartTokenizer: Je,
				MBart50Tokenizer: Ye,
				RobertaTokenizer: Xe,
				WhisperTokenizer: dt,
				CodeGenTokenizer: ft,
				CLIPTokenizer: pt,
				SiglipTokenizer: mt,
				MarianTokenizer: ht,
				BloomTokenizer: Ze,
				NllbTokenizer: lt,
				M2M100Tokenizer: ut,
				LlamaTokenizer: Qe,
				CodeLlamaTokenizer: $e,
				XLMRobertaTokenizer: et,
				MPNetTokenizer: tt,
				FalconTokenizer: nt,
				GPTNeoXTokenizer: rt,
				EsmTokenizer: it,
				Wav2Vec2CTCTokenizer: gt,
				BlenderbotTokenizer: _t,
				BlenderbotSmallTokenizer: vt,
				SpeechT5Tokenizer: yt,
				NougatTokenizer: bt,
				VitsTokenizer: xt,
				Qwen2Tokenizer: at,
				GemmaTokenizer: ot,
				Grok1Tokenizer: st,
				CohereTokenizer: St,
				MgpstrTokenizer: Ct,
				PreTrainedTokenizer: J
			};
			static async from_pretrained(e, { progress_callback: t = null, config: n = null, cache_dir: r = null, local_files_only: i = !1, revision: a = "main", legacy: o = null } = {}) {
				let [s, c] = await d(e, {
					progress_callback: t,
					config: n,
					cache_dir: r,
					local_files_only: i,
					revision: a,
					legacy: o
				}), l = c.tokenizer_class?.replace(/Fast$/, "") ?? "PreTrainedTokenizer", u = this.TOKENIZER_CLASS_MAPPING[l];
				return u ||= (console.warn(`Unknown tokenizer class "${l}", attempting to construct from base class.`), J), new u(s, c);
			}
		}
	}),
	"./src/utils/audio.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			RawAudio: () => O,
			hamming: () => f,
			hanning: () => d,
			mel_filter_bank: () => y,
			read_audio: () => l,
			spectrogram: () => w,
			window_function: () => T
		});
		var r = n("./src/utils/hub.js"), i = n("./src/utils/maths.js"), a = n("./src/utils/core.js"), o = n("./src/env.js"), s = n("./src/utils/tensor.js"), c = n("node:fs");
		async function l(e, t) {
			if (typeof AudioContext > "u") throw Error("Unable to load audio from path/URL since `AudioContext` is not available in your environment. Instead, audio data should be passed directly to the pipeline/processor. For more information and some example code, see https://huggingface.co/docs/transformers.js/guides/node-audio-processing.");
			let n = await (await (0, r.getFile)(e)).arrayBuffer(), i = new AudioContext({ sampleRate: t });
			t === void 0 && console.warn(`No sampling rate provided, using default of ${i.sampleRate}Hz.`);
			let a = await i.decodeAudioData(n), o;
			if (a.numberOfChannels === 2) {
				let e = Math.sqrt(2), t = a.getChannelData(0), n = a.getChannelData(1);
				o = new Float32Array(t.length);
				for (let r = 0; r < a.length; ++r) o[r] = e * (t[r] + n[r]) / 2;
			} else o = a.getChannelData(0);
			return o;
		}
		function u(e, t) {
			if (e < 1) return /* @__PURE__ */ new Float64Array();
			if (e === 1) return new Float64Array([1]);
			let n = 1 - t, r = 2 * Math.PI / (e - 1), i = new Float64Array(e);
			for (let a = 0; a < e; ++a) i[a] = t - n * Math.cos(a * r);
			return i;
		}
		function d(e) {
			return u(e, .5);
		}
		function f(e) {
			return u(e, .54);
		}
		let p = {
			htk: (e) => 2595 * Math.log10(1 + e / 700),
			kaldi: (e) => 1127 * Math.log(1 + e / 700),
			slaney: (e, t = 1e3, n = 15, r = 27 / Math.log(6.4)) => e >= t ? n + Math.log(e / t) * r : 3 * e / 200
		};
		function m(e, t = "htk") {
			let n = p[t];
			if (!n) throw Error("mel_scale should be one of \"htk\", \"slaney\" or \"kaldi\".");
			return typeof e == "number" ? n(e) : e.map((e) => n(e));
		}
		let h = {
			htk: (e) => 700 * (10 ** (e / 2595) - 1),
			kaldi: (e) => 700 * (Math.exp(e / 1127) - 1),
			slaney: (e, t = 1e3, n = 15, r = Math.log(6.4) / 27) => e >= n ? t * Math.exp(r * (e - n)) : 200 * e / 3
		};
		function g(e, t = "htk") {
			let n = h[t];
			if (!n) throw Error("mel_scale should be one of \"htk\", \"slaney\" or \"kaldi\".");
			return typeof e == "number" ? n(e) : e.map((e) => n(e));
		}
		function _(e, t) {
			let n = Float64Array.from({ length: t.length - 1 }, (e, n) => t[n + 1] - t[n]), r = Array.from({ length: e.length }, () => Array(t.length));
			for (let n = 0; n < e.length; ++n) {
				let i = r[n];
				for (let r = 0; r < t.length; ++r) i[r] = t[r] - e[n];
			}
			let i = t.length - 2, a = Array.from({ length: i }, () => Array(e.length));
			for (let t = 0; t < e.length; ++t) {
				let e = r[t];
				for (let r = 0; r < i; ++r) {
					let i = -e[r] / n[r], o = e[r + 2] / n[r + 1];
					a[r][t] = Math.max(0, Math.min(i, o));
				}
			}
			return a;
		}
		function v(e, t, n) {
			let r = (t - e) / (n - 1);
			return Float64Array.from({ length: n }, (t, n) => e + r * n);
		}
		function y(e, t, n, r, i, a = null, o = "htk", s = !1) {
			if (a !== null && a !== "slaney") throw Error("norm must be one of null or \"slaney\"");
			if (e < 2) throw Error(`Require num_frequency_bins: ${e} >= 2`);
			if (n > r) throw Error(`Require min_frequency: ${n} <= max_frequency: ${r}`);
			let c = v(m(n, o), m(r, o), t + 2), l = g(c, o), u;
			if (s) {
				let t = i / ((e - 1) * 2);
				u = m(Float64Array.from({ length: e }, (e, n) => n * t), o), l = c;
			} else u = v(0, Math.floor(i / 2), e);
			let d = _(u, l);
			if (a !== null && a === "slaney") for (let n = 0; n < t; ++n) {
				let t = d[n], r = 2 / (l[n + 2] - l[n]);
				for (let n = 0; n < e; ++n) t[n] *= r;
			}
			return d;
		}
		function b(e, t, n) {
			let r = new e.constructor(e.length + t + n), i = e.length - 1;
			for (let n = 0; n < e.length; ++n) r[t + n] = e[n];
			for (let n = 1; n <= t; ++n) r[t - n] = e[(0, a.calculateReflectOffset)(n, i)];
			for (let o = 1; o <= n; ++o) r[i + t + o] = e[(0, a.calculateReflectOffset)(i - o, i)];
			return r;
		}
		function x(e, t, n, r, a) {
			if (n <= 0) throw Error("reference must be greater than zero");
			if (r <= 0) throw Error("min_value must be greater than zero");
			n = Math.max(r, n);
			let o = Math.log10(n);
			for (let n = 0; n < e.length; ++n) e[n] = t * Math.log10(Math.max(r, e[n]) - o);
			if (a !== null) {
				if (a <= 0) throw Error("db_range must be greater than zero");
				let t = (0, i.max)(e)[0] - a;
				for (let n = 0; n < e.length; ++n) e[n] = Math.max(e[n], t);
			}
			return e;
		}
		function S(e, t = 1, n = 1e-5, r = null) {
			return x(e, 20, t, n, r);
		}
		function C(e, t = 1, n = 1e-10, r = null) {
			return x(e, 10, t, n, r);
		}
		async function w(e, t, n, r, { fft_length: a = null, power: o = 1, center: c = !0, pad_mode: l = "reflect", onesided: u = !0, preemphasis: d = null, preemphasis_htk_flavor: f = !0, mel_filters: p = null, mel_floor: m = 1e-10, log_mel: h = null, reference: g = 1, min_value: _ = 1e-10, db_range: v = null, remove_dc_offset: y = null, min_num_frames: x = null, max_num_frames: w = null, do_pad: T = !0, transpose: E = !1, mel_offset: D = 0 } = {}) {
			let O = t.length;
			if (a === null && (a = n), n > a) throw Error(`frame_length (${n}) may not be larger than fft_length (${a})`);
			if (O !== n) throw Error(`Length of the window (${O}) must equal frame_length (${n})`);
			if (r <= 0) throw Error("hop_length must be greater than zero");
			if (o === null && p !== null) throw Error("You have provided `mel_filters` but `power` is `None`. Mel spectrogram computation is not yet supported for complex-valued spectrogram. Specify `power` to fix this issue.");
			if (!f) throw Error("`preemphasis_htk_flavor=false` is not currently supported.");
			if (c) switch (l) {
				case "reflect": {
					let t = Math.floor((a - 1) / 2) + 1;
					e = b(e, t, t);
					break;
				}
				case "constant": {
					let t = Math.floor(a / 2), n = new e.constructor(e.length + 2 * t);
					n.set(e, t), e = n;
					break;
				}
				default: throw Error(`pad_mode="${l}" not implemented yet.`);
			}
			let k = Math.floor(1 + Math.floor((e.length - n) / r));
			x !== null && k < x && (k = x);
			let A = u ? Math.floor(a / 2) + 1 : a, ee = k, te = k;
			w !== null && (w > k ? T && (te = w) : te = ee = w);
			let j = new i.FFT(a), M = new Float64Array(a), N = new Float64Array(j.outputBufferSize), ne = new Float32Array(A * te);
			for (let i = 0; i < ee; ++i) {
				let a = i * r, o = Math.min(e.length - a, n);
				o !== n && M.fill(0, 0, n);
				for (let t = 0; t < o; ++t) M[t] = e[a + t];
				if (y) {
					let e = 0;
					for (let t = 0; t < o; ++t) e += M[t];
					let t = e / o;
					for (let e = 0; e < o; ++e) M[e] -= t;
				}
				if (d !== null) {
					for (let e = o - 1; e >= 1; --e) M[e] -= d * M[e - 1];
					M[0] *= 1 - d;
				}
				for (let e = 0; e < t.length; ++e) M[e] *= t[e];
				j.realTransform(N, M);
				for (let e = 0; e < A; ++e) {
					let t = e << 1;
					ne[e * te + i] = N[t] ** 2 + N[t + 1] ** 2;
				}
			}
			if (o !== null && o !== 2) {
				let e = o / 2;
				for (let t = 0; t < ne.length; ++t) ne[t] **= e;
			}
			let P = p.length, F = await (0, s.matmul)(new s.Tensor("float32", p.flat(), [P, A]), new s.Tensor("float32", ne, [A, te]));
			E && (F = F.transpose(1, 0));
			let re = F.data;
			for (let e = 0; e < re.length; ++e) re[e] = D + Math.max(m, re[e]);
			if (o !== null && h !== null) {
				let e = Math.min(re.length, ee * P);
				switch (h) {
					case "log":
						for (let t = 0; t < e; ++t) re[t] = Math.log(re[t]);
						break;
					case "log10":
						for (let t = 0; t < e; ++t) re[t] = Math.log10(re[t]);
						break;
					case "dB":
						if (o === 1) S(re, g, _, v);
						else if (o === 2) C(re, g, _, v);
						else throw Error(`Cannot use log_mel option '${h}' with power ${o}`);
						break;
					default: throw Error(`log_mel must be one of null, 'log', 'log10' or 'dB'. Got '${h}'`);
				}
			}
			return F;
		}
		function T(e, t, { periodic: n = !0, frame_length: r = null, center: i = !0 } = {}) {
			let a = n ? e + 1 : e, o;
			switch (t) {
				case "boxcar":
					o = new Float64Array(a).fill(1);
					break;
				case "hann":
				case "hann_window":
					o = d(a);
					break;
				case "hamming":
					o = f(a);
					break;
				case "povey":
					o = d(a).map((e) => e ** .85);
					break;
				default: throw Error(`Unknown window type ${t}.`);
			}
			if (n && (o = o.subarray(0, e)), r === null) return o;
			if (e > r) throw Error(`Length of the window (${e}) may not be larger than frame_length (${r})`);
			return o;
		}
		function E(e, t) {
			let n = 44, r = new ArrayBuffer(n + e.length * 4), i = new DataView(r);
			D(i, 0, "RIFF"), i.setUint32(4, 36 + e.length * 4, !0), D(i, 8, "WAVE"), D(i, 12, "fmt "), i.setUint32(16, 16, !0), i.setUint16(20, 3, !0), i.setUint16(22, 1, !0), i.setUint32(24, t, !0), i.setUint32(28, t * 4, !0), i.setUint16(32, 4, !0), i.setUint16(34, 32, !0), D(i, 36, "data"), i.setUint32(40, e.length * 4, !0);
			for (let t = 0; t < e.length; ++t, n += 4) i.setFloat32(n, e[t], !0);
			return r;
		}
		function D(e, t, n) {
			for (let r = 0; r < n.length; ++r) e.setUint8(t + r, n.charCodeAt(r));
		}
		class O {
			constructor(e, t) {
				this.audio = e, this.sampling_rate = t;
			}
			toWav() {
				return E(this.audio, this.sampling_rate);
			}
			toBlob() {
				let e = this.toWav();
				return new Blob([e], { type: "audio/wav" });
			}
			async save(e) {
				let t;
				if (o.apis.IS_BROWSER_ENV) {
					if (o.apis.IS_WEBWORKER_ENV) throw Error("Unable to save a file from a Web Worker.");
					t = a.saveBlob;
				} else if (o.apis.IS_FS_AVAILABLE) t = async (e, t) => {
					let n = await t.arrayBuffer();
					c.default.writeFileSync(e, Buffer.from(n));
				};
				else throw Error("Unable to save because filesystem is disabled in this environment.");
				await t(e, this.toBlob());
			}
		}
	}),
	"./src/utils/constants.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			CHAT_TEMPLATE_NAME: () => c,
			CONFIG_NAME: () => i,
			FEATURE_EXTRACTOR_NAME: () => a,
			GENERATION_CONFIG_NAME: () => l,
			GITHUB_ISSUE_URL: () => r,
			IMAGE_PROCESSOR_NAME: () => o,
			PROCESSOR_NAME: () => s
		});
		let r = "https://github.com/huggingface/transformers.js/issues/new/choose", i = "config.json", a = "preprocessor_config.json", o = a, s = "processor_config.json", c = "chat_template.jinja", l = "generation_config.json";
	}),
	"./src/utils/core.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			calculateDimensions: () => l,
			calculateReflectOffset: () => p,
			count: () => _,
			dispatchCallback: () => r,
			escapeRegExp: () => a,
			isIntegralNumber: () => s,
			isNullishDimension: () => c,
			isTypedArray: () => o,
			len: () => g,
			mergeArrays: () => d,
			pick: () => h,
			pop: () => u,
			product: () => f,
			reverseDictionary: () => i,
			saveBlob: () => m
		});
		function r(e, t) {
			e && e(t);
		}
		function i(e) {
			return Object.fromEntries(Object.entries(e).map(([e, t]) => [t, e]));
		}
		function a(e) {
			return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
		function o(e) {
			return e?.prototype?.__proto__?.constructor?.name === "TypedArray";
		}
		function s(e) {
			return Number.isInteger(e) || typeof e == "bigint";
		}
		function c(e) {
			return e == null || e === -1;
		}
		function l(e) {
			let t = [], n = e;
			for (; Array.isArray(n);) t.push(n.length), n = n[0];
			return t;
		}
		function u(e, t, n = void 0) {
			let r = e[t];
			if (r !== void 0) return delete e[t], r;
			if (n === void 0) throw Error(`Key ${t} does not exist in object.`);
			return n;
		}
		function d(...e) {
			return Array.prototype.concat.apply([], e);
		}
		function f(...e) {
			return e.reduce((e, t) => e.flatMap((e) => t.map((t) => [e, t])));
		}
		function p(e, t) {
			return Math.abs((e + t) % (2 * t) - t);
		}
		function m(e, t) {
			let n = URL.createObjectURL(t), r = document.createElement("a");
			r.href = n, r.download = e, r.click(), r.remove(), URL.revokeObjectURL(n);
		}
		function h(e, t) {
			return Object.assign({}, ...t.map((t) => {
				if (e[t] !== void 0) return { [t]: e[t] };
			}));
		}
		function g(e) {
			let t = 0;
			for (let n of e) ++t;
			return t;
		}
		function _(e, t) {
			let n = 0;
			for (let r of e) r === t && ++n;
			return n;
		}
	}),
	"./src/utils/data-structures.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			CharTrie: () => i,
			DictionarySplitter: () => c,
			LRUCache: () => l,
			PriorityQueue: () => r,
			TokenLattice: () => o
		});
		class r {
			constructor(e = (e, t) => e > t, t = Infinity) {
				this._heap = [], this._comparator = e, this._maxSize = t;
			}
			get size() {
				return this._heap.length;
			}
			isEmpty() {
				return this.size === 0;
			}
			peek() {
				return this._heap[0];
			}
			push(...e) {
				return this.extend(e);
			}
			extend(e) {
				for (let t of e) if (this.size < this._maxSize) this._heap.push(t), this._siftUp();
				else {
					let e = this._smallest();
					this._comparator(t, this._heap[e]) && (this._heap[e] = t, this._siftUpFrom(e));
				}
				return this.size;
			}
			pop() {
				let e = this.peek(), t = this.size - 1;
				return t > 0 && this._swap(0, t), this._heap.pop(), this._siftDown(), e;
			}
			replace(e) {
				let t = this.peek();
				return this._heap[0] = e, this._siftDown(), t;
			}
			_parent(e) {
				return (e + 1 >>> 1) - 1;
			}
			_left(e) {
				return (e << 1) + 1;
			}
			_right(e) {
				return e + 1 << 1;
			}
			_greater(e, t) {
				return this._comparator(this._heap[e], this._heap[t]);
			}
			_swap(e, t) {
				let n = this._heap[e];
				this._heap[e] = this._heap[t], this._heap[t] = n;
			}
			_siftUp() {
				this._siftUpFrom(this.size - 1);
			}
			_siftUpFrom(e) {
				for (; e > 0 && this._greater(e, this._parent(e));) this._swap(e, this._parent(e)), e = this._parent(e);
			}
			_siftDown() {
				let e = 0;
				for (; this._left(e) < this.size && this._greater(this._left(e), e) || this._right(e) < this.size && this._greater(this._right(e), e);) {
					let t = this._right(e) < this.size && this._greater(this._right(e), this._left(e)) ? this._right(e) : this._left(e);
					this._swap(e, t), e = t;
				}
			}
			_smallest() {
				return 2 ** Math.floor(Math.log2(this.size)) - 1;
			}
		}
		class i {
			constructor() {
				this.root = a.default();
			}
			extend(e) {
				for (let t of e) this.push(t);
			}
			push(e) {
				let t = this.root;
				for (let n of e) {
					let e = t.children.get(n);
					e === void 0 && (e = a.default(), t.children.set(n, e)), t = e;
				}
				t.isLeaf = !0;
			}
			*commonPrefixSearch(e) {
				let t = this.root;
				if (t === void 0) return;
				let n = "";
				for (let r of e) {
					if (n += r, t = t.children.get(r), t === void 0) return;
					t.isLeaf && (yield n);
				}
			}
		}
		class a {
			constructor(e, t) {
				this.isLeaf = e, this.children = t;
			}
			static default() {
				return new a(!1, /* @__PURE__ */ new Map());
			}
		}
		class o {
			constructor(e, t, n) {
				this.chars = Array.from(e), this.len = this.chars.length, this.bosTokenId = t, this.eosTokenId = n, this.nodes = [], this.beginNodes = Array.from({ length: this.len + 1 }, () => []), this.endNodes = Array.from({ length: this.len + 1 }, () => []);
				let r = new s(this.bosTokenId, 0, 0, 0, 0), i = new s(this.eosTokenId, 1, this.len, 0, 0);
				this.nodes.push(r.clone()), this.nodes.push(i.clone()), this.beginNodes[this.len].push(i), this.endNodes[0].push(r);
			}
			insert(e, t, n, r) {
				let i = this.nodes.length, a = new s(r, i, e, t, n);
				this.beginNodes[e].push(a), this.endNodes[e + t].push(a), this.nodes.push(a);
			}
			viterbi() {
				let e = this.len, t = 0;
				for (; t <= e;) {
					if (this.beginNodes[t].length == 0) return [];
					for (let e of this.beginNodes[t]) {
						e.prev = null;
						let n = 0, r = null;
						for (let i of this.endNodes[t]) {
							let t = i.backtraceScore + e.score;
							(r === null || t > n) && (r = i.clone(), n = t);
						}
						if (r !== null) e.prev = r, e.backtraceScore = n;
						else return [];
					}
					++t;
				}
				let n = [], r = this.beginNodes[e][0].prev;
				if (r === null) return [];
				let i = r.clone();
				for (; i.prev !== null;) n.push(i.clone()), i = i.clone().prev.clone();
				return n.reverse(), n;
			}
			piece(e) {
				return this.chars.slice(e.pos, e.pos + e.length).join("");
			}
			tokens() {
				return this.viterbi().map((e) => this.piece(e));
			}
			tokenIds() {
				return this.viterbi().map((e) => e.tokenId);
			}
		}
		class s {
			constructor(e, t, n, r, i) {
				this.tokenId = e, this.nodeId = t, this.pos = n, this.length = r, this.score = i, this.prev = null, this.backtraceScore = 0;
			}
			clone() {
				let e = new s(this.tokenId, this.nodeId, this.pos, this.length, this.score);
				return e.prev = this.prev, e.backtraceScore = this.backtraceScore, e;
			}
		}
		class c {
			constructor(e) {
				this.trie = this._buildTrie(e);
			}
			_buildTrie(e) {
				let t = Object.create(null);
				for (let n of e) {
					let e = t;
					for (let t = 0; t < n.length; ++t) e = e[n[t]] ??= Object.create(null);
					e.end = n;
				}
				return t;
			}
			split(e) {
				let t = [], n = e.length, r = 0, i = 0;
				for (; i < n;) {
					let a = this.trie, o = null, s = i;
					for (; s < n && (a = a[e[s]]);) a.end && (o = a.end), ++s;
					o ? (i > r && t.push(e.slice(r, i)), t.push(o), i += o.length, r = i) : ++i;
				}
				return r < n && t.push(e.slice(r)), t;
			}
		}
		class l {
			constructor(e) {
				this.capacity = e, this.cache = /* @__PURE__ */ new Map();
			}
			get(e) {
				if (!this.cache.has(e)) return;
				let t = this.cache.get(e);
				return this.cache.delete(e), this.cache.set(e, t), t;
			}
			put(e, t) {
				this.cache.has(e) && this.cache.delete(e), this.cache.set(e, t), this.cache.size > this.capacity && this.cache.delete(this.cache.keys().next().value);
			}
			clear() {
				this.cache.clear();
			}
		}
	}),
	"./src/utils/devices.js": ((e, t, n) => {
		n.r(t), n.d(t, { DEVICE_TYPES: () => r });
		let r = Object.freeze({
			auto: "auto",
			gpu: "gpu",
			cpu: "cpu",
			wasm: "wasm",
			webgpu: "webgpu",
			cuda: "cuda",
			dml: "dml",
			webnn: "webnn",
			"webnn-npu": "webnn-npu",
			"webnn-gpu": "webnn-gpu",
			"webnn-cpu": "webnn-cpu"
		});
	}),
	"./src/utils/dtypes.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			DATA_TYPES: () => o,
			DEFAULT_DEVICE_DTYPE_MAPPING: () => s,
			DEFAULT_DTYPE_SUFFIX_MAPPING: () => c,
			isWebGpuFp16Supported: () => a
		});
		var r = n("./src/env.js"), i = n("./src/utils/devices.js");
		let a = (function() {
			let e;
			return async function() {
				if (e === void 0) {
					if (!r.apis.IS_WEBGPU_AVAILABLE) e = !1;
					else try {
						e = (await navigator.gpu.requestAdapter()).features.has("shader-f16");
					} catch {
						e = !1;
					}
				}
				return e;
			};
		})(), o = Object.freeze({
			auto: "auto",
			fp32: "fp32",
			fp16: "fp16",
			q8: "q8",
			int8: "int8",
			uint8: "uint8",
			q4: "q4",
			bnb4: "bnb4",
			q4f16: "q4f16"
		}), s = Object.freeze({ [i.DEVICE_TYPES.wasm]: o.q8 }), c = Object.freeze({
			[o.fp32]: "",
			[o.fp16]: "_fp16",
			[o.int8]: "_int8",
			[o.uint8]: "_uint8",
			[o.q8]: "_quantized",
			[o.q4]: "_q4",
			[o.q4f16]: "_q4f16",
			[o.bnb4]: "_bnb4"
		});
	}),
	"./src/utils/generic.js": ((e, t, n) => {
		n.r(t), n.d(t, { Callable: () => r });
		let r = class {
			constructor() {
				let e = function(...t) {
					return e._call(...t);
				};
				return Object.setPrototypeOf(e, new.target.prototype);
			}
			_call(...e) {
				throw Error("Must implement _call method in subclass");
			}
		};
	}),
	"./src/utils/hub.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			MAX_EXTERNAL_DATA_CHUNKS: () => s,
			getFile: () => p,
			getModelFile: () => v,
			getModelJSON: () => b,
			getModelText: () => y
		});
		var r = n("node:fs"), i = n("node:path"), a = n("./src/env.js"), o = n("./src/utils/core.js");
		let s = 100, c = {
			txt: "text/plain",
			html: "text/html",
			css: "text/css",
			js: "text/javascript",
			json: "application/json",
			png: "image/png",
			jpg: "image/jpeg",
			jpeg: "image/jpeg",
			gif: "image/gif"
		};
		class l {
			constructor(e) {
				if (this.filePath = e, this.headers = new Headers(), this.exists = r.default.existsSync(e), this.exists) {
					this.status = 200, this.statusText = "OK";
					let t = r.default.statSync(e);
					this.headers.set("content-length", t.size.toString()), this.updateContentType();
					let n = r.default.createReadStream(e);
					this.body = new ReadableStream({
						start(e) {
							n.on("data", (t) => e.enqueue(t)), n.on("end", () => e.close()), n.on("error", (t) => e.error(t));
						},
						cancel() {
							n.destroy();
						}
					});
				} else this.status = 404, this.statusText = "Not Found", this.body = null;
			}
			updateContentType() {
				let e = this.filePath.toString().split(".").pop().toLowerCase();
				this.headers.set("content-type", c[e] ?? "application/octet-stream");
			}
			clone() {
				let e = new l(this.filePath);
				return e.exists = this.exists, e.status = this.status, e.statusText = this.statusText, e.headers = new Headers(this.headers), e;
			}
			async arrayBuffer() {
				return (await r.default.promises.readFile(this.filePath)).buffer;
			}
			async blob() {
				let e = await r.default.promises.readFile(this.filePath);
				return new Blob([e], { type: this.headers.get("content-type") });
			}
			async text() {
				return await r.default.promises.readFile(this.filePath, "utf8");
			}
			async json() {
				return JSON.parse(await this.text());
			}
		}
		function u(e, t = null, n = null) {
			let r;
			try {
				r = new URL(e);
			} catch {
				return !1;
			}
			return !(t && !t.includes(r.protocol) || n && !n.includes(r.hostname));
		}
		let d = /^(\b[\w\-.]+\b\/)?\b[\w\-.]{1,96}\b$/;
		function f(e) {
			return !(!d.test(e) || e.includes("..") || e.includes("--") || e.endsWith(".git") || e.endsWith(".ipynb"));
		}
		async function p(e) {
			if (a.env.useFS && !u(e, [
				"http:",
				"https:",
				"blob:"
			])) return new l(e instanceof URL ? e.protocol === "file:" ? e.pathname : e.toString() : e);
			if (typeof process < "u" && process?.release?.name === "node") {
				let t = !!process.env?.TESTING_REMOTELY, n = a.env.version, r = new Headers();
				if (r.set("User-Agent", `transformers.js/${n}; is_ci/${t};`), u(e, ["http:", "https:"], ["huggingface.co", "hf.co"])) {
					let e = process.env?.HF_TOKEN ?? process.env?.HF_ACCESS_TOKEN;
					e && r.set("Authorization", `Bearer ${e}`);
				}
				return fetch(e, { headers: r });
			}
			return fetch(e);
		}
		let m = {
			400: "Bad request error occurred while trying to load file",
			401: "Unauthorized access to file",
			403: "Forbidden access to file",
			404: "Could not locate file",
			408: "Request timeout error occurred while trying to load file",
			500: "Internal server error error occurred while trying to load file",
			502: "Bad gateway error occurred while trying to load file",
			503: "Service unavailable error occurred while trying to load file",
			504: "Gateway timeout error occurred while trying to load file"
		};
		function h(e, t, n) {
			if (!n) return null;
			let r = m[e] ?? `Error (${e}) occurred while trying to load file`;
			throw Error(`${r}: "${t}".`);
		}
		class g {
			constructor(e) {
				this.path = e;
			}
			async match(e) {
				let t = i.default.join(this.path, e), n = new l(t);
				if (n.exists) return n;
			}
			async put(e, t, n = void 0) {
				let a = i.default.join(this.path, e);
				try {
					let e = t.headers.get("Content-Length"), o = parseInt(e ?? "0"), s = 0;
					await r.default.promises.mkdir(i.default.dirname(a), { recursive: !0 });
					let c = r.default.createWriteStream(a), l = t.body.getReader();
					for (;;) {
						let { done: e, value: t } = await l.read();
						if (e) break;
						await new Promise((e, n) => {
							c.write(t, (t) => {
								if (t) {
									n(t);
									return;
								}
								e();
							});
						}), s += t.length;
						let r = o ? s / o * 100 : 0;
						n?.({
							progress: r,
							loaded: s,
							total: o
						});
					}
					c.close();
				} catch (e) {
					try {
						await r.default.promises.unlink(a);
					} catch {}
					throw e;
				}
			}
		}
		async function _(e, ...t) {
			for (let n of t) try {
				let t = await e.match(n);
				if (t) return t;
			} catch {
				continue;
			}
		}
		async function v(e, t, n = !0, r = {}, i = !1) {
			if (!a.env.allowLocalModels) {
				if (r.local_files_only) throw Error("Invalid configuration detected: local models are disabled (`env.allowLocalModels=false`) but you have requested to only use local models (`local_files_only=true`).");
				if (!a.env.allowRemoteModels) throw Error("Invalid configuration detected: both local and remote models are disabled. Fix by setting `env.allowLocalModels` or `env.allowRemoteModels` to `true`.");
			}
			(0, o.dispatchCallback)(r.progress_callback, {
				status: "initiate",
				name: e,
				file: t
			});
			let s;
			if (!s && a.env.useCustomCache) {
				if (!a.env.customCache) throw Error("`env.useCustomCache=true`, but `env.customCache` is not defined.");
				if (!a.env.customCache.match || !a.env.customCache.put) throw Error("`env.customCache` must be an object which implements the `match` and `put` functions of the Web Cache API. For more information, see https://developer.mozilla.org/en-US/docs/Web/API/Cache");
				s = a.env.customCache;
			}
			if (!s && a.env.useBrowserCache) {
				if (typeof caches > "u") throw Error("Browser cache is not available in this environment.");
				try {
					s = await caches.open("transformers-cache");
				} catch (e) {
					console.warn("An error occurred while opening the browser cache:", e);
				}
			}
			if (!s && a.env.useFSCache) {
				if (!a.apis.IS_FS_AVAILABLE) throw Error("File System Cache is not available in this environment.");
				s = new g(r.cache_dir ?? a.env.cacheDir);
			}
			let c = r.revision ?? "main", d = S(e, t), m = f(e), v = m ? S(a.env.localModelPath, d) : d, y = S(a.env.remoteHost, a.env.remotePathTemplate.replaceAll("{model}", e).replaceAll("{revision}", encodeURIComponent(c)), t), b, C = s instanceof g ? c === "main" ? d : S(e, c, t) : y, w = !1, T;
			s && (T = await _(s, v, C));
			let E = T !== void 0;
			if (T === void 0) {
				if (a.env.allowLocalModels) {
					if (!u(d, ["http:", "https:"])) try {
						T = await p(v), b = v;
					} catch (e) {
						console.warn(`Unable to load from local path "${v}": "${e}"`);
					}
					else if (r.local_files_only) throw Error(`\`local_files_only=true\`, but attempted to load a remote file from: ${d}.`);
					else if (!a.env.allowRemoteModels) throw Error(`\`env.allowRemoteModels=false\`, but attempted to load a remote file from: ${d}.`);
				}
				if (T === void 0 || T.status === 404) {
					if (r.local_files_only || !a.env.allowRemoteModels) {
						if (n) throw Error(`\`local_files_only=true\` or \`env.allowRemoteModels=false\` and file was not found locally at "${v}".`);
						return null;
					}
					if (!m) throw Error(`Local file missing at "${v}" and download aborted due to invalid model ID "${e}".`);
					if (T = await p(y), T.status !== 200) return h(T.status, y, n);
					b = C;
				}
				w = s && typeof Response < "u" && T instanceof Response && T.status === 200;
			}
			(0, o.dispatchCallback)(r.progress_callback, {
				status: "download",
				name: e,
				file: t
			});
			let D;
			if (!(a.apis.IS_NODE_ENV && i)) {
				let n;
				r.progress_callback ? E && typeof navigator < "u" && /firefox/i.test(navigator.userAgent) ? (n = new Uint8Array(await T.arrayBuffer()), (0, o.dispatchCallback)(r.progress_callback, {
					status: "progress",
					name: e,
					file: t,
					progress: 100,
					loaded: n.length,
					total: n.length
				})) : n = await x(T, (n) => {
					(0, o.dispatchCallback)(r.progress_callback, {
						status: "progress",
						name: e,
						file: t,
						...n
					});
				}) : n = new Uint8Array(await T.arrayBuffer()), D = n;
			}
			if (w && b && await s.match(b) === void 0) {
				if (D) await s.put(b, new Response(D, { headers: T.headers })).catch((e) => {
					console.warn(`Unable to add response to browser cache: ${e}.`);
				});
				else {
					let n = r.progress_callback ? (n) => (0, o.dispatchCallback)(r.progress_callback, {
						status: "progress",
						name: e,
						file: t,
						...n
					}) : void 0;
					await s.put(b, T, n);
				}
			}
			if ((0, o.dispatchCallback)(r.progress_callback, {
				status: "done",
				name: e,
				file: t
			}), D) {
				if (!a.apis.IS_NODE_ENV && i) throw Error("Cannot return path in a browser environment.");
				return D;
			}
			if (T instanceof l) return T.filePath;
			let O = await s?.match(b);
			if (O instanceof l) return O.filePath;
			if (O instanceof Response) return new Uint8Array(await O.arrayBuffer());
			if (typeof O == "string") return O;
			throw Error("Unable to get model file path or buffer.");
		}
		async function y(e, t, n = !0, r = {}) {
			let i = await v(e, t, n, r, !1);
			return i === null ? null : new TextDecoder("utf-8").decode(i);
		}
		async function b(e, t, n = !0, r = {}) {
			let i = await y(e, t, n, r);
			return i === null ? {} : JSON.parse(i);
		}
		async function x(e, t) {
			let n = e.headers.get("Content-Length");
			n === null && console.warn("Unable to determine content-length from response headers. Will expand buffer when needed.");
			let r = parseInt(n ?? "0"), i = new Uint8Array(r), a = 0, o = e.body.getReader();
			async function s() {
				let { done: e, value: n } = await o.read();
				if (e) return;
				let c = a + n.length;
				if (c > r) {
					r = c;
					let e = new Uint8Array(r);
					e.set(i), i = e;
				}
				return i.set(n, a), a = c, t({
					progress: a / r * 100,
					loaded: a,
					total: r
				}), s();
			}
			return await s(), i;
		}
		function S(...e) {
			return e = e.map((t, n) => (n && (t = t.replace(/* @__PURE__ */ RegExp("^/"), "")), n !== e.length - 1 && (t = t.replace(/* @__PURE__ */ RegExp("/$"), "")), t)), e.join("/");
		}
	}),
	"./src/utils/image.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			RawImage: () => m,
			load_image: () => h
		});
		var r = n("./src/utils/core.js"), i = n("./src/utils/hub.js"), a = n("./src/env.js"), o = n("./src/utils/tensor.js"), s = n("sharp");
		let c, l, u, d = a.apis.IS_BROWSER_ENV || a.apis.IS_WEBWORKER_ENV;
		if (d) c = (e, t) => {
			if (!self.OffscreenCanvas) throw Error("OffscreenCanvas not supported by this browser.");
			return new self.OffscreenCanvas(e, t);
		}, u = self.createImageBitmap, l = self.ImageData;
		else if (s.default) u = async (e) => {
			let t = (await e.metadata()).channels, { data: n, info: r } = await e.rotate().raw().toBuffer({ resolveWithObject: !0 }), i = new m(new Uint8ClampedArray(n), r.width, r.height, r.channels);
			return t !== void 0 && t !== r.channels && i.convert(t), i;
		};
		else throw Error("Unable to load image processing library.");
		let f = {
			0: "nearest",
			1: "lanczos",
			2: "bilinear",
			3: "bicubic",
			4: "box",
			5: "hamming"
		}, p = /* @__PURE__ */ new Map([
			["png", "image/png"],
			["jpg", "image/jpeg"],
			["jpeg", "image/jpeg"],
			["gif", "image/gif"]
		]);
		class m {
			constructor(e, t, n, r) {
				this.data = e, this.width = t, this.height = n, this.channels = r;
			}
			get size() {
				return [this.width, this.height];
			}
			static async read(e) {
				if (e instanceof m) return e;
				if (typeof e == "string" || e instanceof URL) return await this.fromURL(e);
				if (e instanceof Blob) return await this.fromBlob(e);
				if (typeof HTMLCanvasElement < "u" && e instanceof HTMLCanvasElement || typeof OffscreenCanvas < "u" && e instanceof OffscreenCanvas) return this.fromCanvas(e);
				throw Error(`Unsupported input type: ${typeof e}`);
			}
			static fromCanvas(e) {
				if (!d) throw Error("fromCanvas() is only supported in browser environments.");
				let t = e.getContext("2d").getImageData(0, 0, e.width, e.height).data;
				return new m(t, e.width, e.height, 4);
			}
			static async fromURL(e) {
				let t = await (0, i.getFile)(e);
				if (t.status !== 200) throw Error(`Unable to read image from "${e}" (${t.status} ${t.statusText})`);
				let n = await t.blob();
				return this.fromBlob(n);
			}
			static async fromBlob(e) {
				if (d) {
					let t = await u(e), n = c(t.width, t.height).getContext("2d");
					return n.drawImage(t, 0, 0), new this(n.getImageData(0, 0, t.width, t.height).data, t.width, t.height, 4);
				}
				{
					let t = (0, s.default)(await e.arrayBuffer());
					return await u(t);
				}
			}
			static fromTensor(e, t = "CHW") {
				if (e.dims.length !== 3) throw Error(`Tensor should have 3 dimensions, but has ${e.dims.length} dimensions.`);
				if (t === "CHW") e = e.transpose(1, 2, 0);
				else if (t !== "HWC") throw Error(`Unsupported channel format: ${t}`);
				if (!(e.data instanceof Uint8ClampedArray || e.data instanceof Uint8Array)) throw Error(`Unsupported tensor type: ${e.type}`);
				switch (e.dims[2]) {
					case 1:
					case 2:
					case 3:
					case 4: return new m(e.data, e.dims[1], e.dims[0], e.dims[2]);
					default: throw Error(`Unsupported number of channels: ${e.dims[2]}`);
				}
			}
			grayscale() {
				if (this.channels === 1) return this;
				let e = new Uint8ClampedArray(this.width * this.height * 1);
				switch (this.channels) {
					case 3:
					case 4:
						for (let t = 0, n = 0; t < this.data.length; t += this.channels) {
							let r = this.data[t], i = this.data[t + 1], a = this.data[t + 2];
							e[n++] = Math.round(.2989 * r + .587 * i + .114 * a);
						}
						break;
					default: throw Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
				}
				return this._update(e, this.width, this.height, 1);
			}
			rgb() {
				if (this.channels === 3) return this;
				let e = new Uint8ClampedArray(this.width * this.height * 3);
				switch (this.channels) {
					case 1:
						for (let t = 0, n = 0; t < this.data.length; ++t) e[n++] = this.data[t], e[n++] = this.data[t], e[n++] = this.data[t];
						break;
					case 4:
						for (let t = 0, n = 0; t < this.data.length; t += 4) e[n++] = this.data[t], e[n++] = this.data[t + 1], e[n++] = this.data[t + 2];
						break;
					default: throw Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
				}
				return this._update(e, this.width, this.height, 3);
			}
			rgba() {
				if (this.channels === 4) return this;
				let e = new Uint8ClampedArray(this.width * this.height * 4);
				switch (this.channels) {
					case 1:
						for (let t = 0, n = 0; t < this.data.length; ++t) e[n++] = this.data[t], e[n++] = this.data[t], e[n++] = this.data[t], e[n++] = 255;
						break;
					case 3:
						for (let t = 0, n = 0; t < this.data.length; t += 3) e[n++] = this.data[t], e[n++] = this.data[t + 1], e[n++] = this.data[t + 2], e[n++] = 255;
						break;
					default: throw Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
				}
				return this._update(e, this.width, this.height, 4);
			}
			putAlpha(e) {
				if (e.width !== this.width || e.height !== this.height) throw Error(`Expected mask size to be ${this.width}x${this.height}, but got ${e.width}x${e.height}`);
				if (e.channels !== 1) throw Error(`Expected mask to have 1 channel, but got ${e.channels}`);
				let t = this.data, n = e.data, r = this.width * this.height;
				if (this.channels === 3) {
					let e = new Uint8ClampedArray(r * 4);
					for (let i = 0, a = 0, o = 0; i < r; ++i) e[o++] = t[a++], e[o++] = t[a++], e[o++] = t[a++], e[o++] = n[i];
					return this._update(e, this.width, this.height, 4);
				}
				if (this.channels === 4) {
					for (let e = 0; e < r; ++e) t[4 * e + 3] = n[e];
					return this;
				}
				throw Error(`Expected image to have 3 or 4 channels, but got ${this.channels}`);
			}
			async resize(e, t, { resample: n = 2 } = {}) {
				if (this.width === e && this.height === t) return this;
				let i = f[n] ?? n, a = (0, r.isNullishDimension)(e), o = (0, r.isNullishDimension)(t);
				if (a && o) return this;
				if (a ? e = t / this.height * this.width : o && (t = e / this.width * this.height), d) {
					let n = this.channels, r = this.toCanvas(), i = c(e, t).getContext("2d");
					return i.drawImage(r, 0, 0, e, t), new m(i.getImageData(0, 0, e, t).data, e, t, 4).convert(n);
				}
				{
					let n = this.toSharp();
					switch (i) {
						case "box":
						case "hamming": (i === "box" || i === "hamming") && (console.warn(`Resampling method ${i} is not yet supported. Using bilinear instead.`), i = "bilinear");
						case "nearest":
						case "bilinear":
						case "bicubic":
							n = n.affine([
								e / this.width,
								0,
								0,
								t / this.height
							], { interpolator: i });
							break;
						case "lanczos":
							n = n.resize({
								width: e,
								height: t,
								fit: "fill",
								kernel: "lanczos3"
							});
							break;
						default: throw Error(`Resampling method ${i} is not supported.`);
					}
					return await u(n);
				}
			}
			async pad([e, t, n, r]) {
				if (e = Math.max(e, 0), t = Math.max(t, 0), n = Math.max(n, 0), r = Math.max(r, 0), e === 0 && t === 0 && n === 0 && r === 0) return this;
				if (d) {
					let i = this.channels, a = this.toCanvas(), o = this.width + e + t, s = this.height + n + r, l = c(o, s).getContext("2d");
					return l.drawImage(a, 0, 0, this.width, this.height, e, n, this.width, this.height), new m(l.getImageData(0, 0, o, s).data, o, s, 4).convert(i);
				}
				{
					let i = this.toSharp().extend({
						left: e,
						right: t,
						top: n,
						bottom: r
					});
					return await u(i);
				}
			}
			async crop([e, t, n, r]) {
				if (e = Math.max(e, 0), t = Math.max(t, 0), n = Math.min(n, this.width - 1), r = Math.min(r, this.height - 1), e === 0 && t === 0 && n === this.width - 1 && r === this.height - 1) return this;
				let i = n - e + 1, a = r - t + 1;
				if (d) {
					let n = this.channels, r = this.toCanvas(), o = c(i, a).getContext("2d");
					return o.drawImage(r, e, t, i, a, 0, 0, i, a), new m(o.getImageData(0, 0, i, a).data, i, a, 4).convert(n);
				}
				{
					let n = this.toSharp().extract({
						left: e,
						top: t,
						width: i,
						height: a
					});
					return await u(n);
				}
			}
			async center_crop(e, t) {
				if (this.width === e && this.height === t) return this;
				let n = (this.width - e) / 2, r = (this.height - t) / 2;
				if (d) {
					let i = this.channels, a = this.toCanvas(), o = c(e, t).getContext("2d"), s = 0, l = 0, u = 0, d = 0;
					return n >= 0 ? s = n : u = -n, r >= 0 ? l = r : d = -r, o.drawImage(a, s, l, e, t, u, d, e, t), new m(o.getImageData(0, 0, e, t).data, e, t, 4).convert(i);
				}
				{
					let i = this.toSharp();
					if (n >= 0 && r >= 0) i = i.extract({
						left: Math.floor(n),
						top: Math.floor(r),
						width: e,
						height: t
					});
					else if (n <= 0 && r <= 0) {
						let a = Math.floor(-r), o = Math.floor(-n);
						i = i.extend({
							top: a,
							left: o,
							right: e - this.width - o,
							bottom: t - this.height - a
						});
					} else {
						let a = [0, 0], o = 0;
						r < 0 ? (a[0] = Math.floor(-r), a[1] = t - this.height - a[0]) : o = Math.floor(r);
						let s = [0, 0], c = 0;
						n < 0 ? (s[0] = Math.floor(-n), s[1] = e - this.width - s[0]) : c = Math.floor(n), i = i.extend({
							top: a[0],
							bottom: a[1],
							left: s[0],
							right: s[1]
						}).extract({
							left: c,
							top: o,
							width: e,
							height: t
						});
					}
					return await u(i);
				}
			}
			async toBlob(e = "image/png", t = 1) {
				if (!d) throw Error("toBlob() is only supported in browser environments.");
				return await this.toCanvas().convertToBlob({
					type: e,
					quality: t
				});
			}
			toTensor(e = "CHW") {
				let t = new o.Tensor("uint8", new Uint8Array(this.data), [
					this.height,
					this.width,
					this.channels
				]);
				if (e !== "HWC") {
					if (e === "CHW") t = t.permute(2, 0, 1);
					else throw Error(`Unsupported channel format: ${e}`);
				}
				return t;
			}
			toCanvas() {
				if (!d) throw Error("toCanvas() is only supported in browser environments.");
				let e = this.clone().rgba(), t = c(e.width, e.height), n = new l(e.data, e.width, e.height);
				return t.getContext("2d").putImageData(n, 0, 0), t;
			}
			split() {
				let { data: e, width: t, height: n, channels: r } = this, i = e.constructor, a = e.length / r, o = Array.from({ length: r }, () => new i(a));
				for (let t = 0; t < a; ++t) {
					let n = r * t;
					for (let i = 0; i < r; ++i) o[i][t] = e[n + i];
				}
				return o.map((e) => new m(e, t, n, 1));
			}
			_update(e, t, n, r = null) {
				return this.data = e, this.width = t, this.height = n, r !== null && (this.channels = r), this;
			}
			clone() {
				return new m(this.data.slice(), this.width, this.height, this.channels);
			}
			convert(e) {
				if (this.channels === e) return this;
				switch (e) {
					case 1:
						this.grayscale();
						break;
					case 3:
						this.rgb();
						break;
					case 4:
						this.rgba();
						break;
					default: throw Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
				}
				return this;
			}
			async save(e) {
				if (d) {
					if (a.apis.IS_WEBWORKER_ENV) throw Error("Unable to save an image from a Web Worker.");
					let t = e.split(".").pop().toLowerCase(), n = p.get(t) ?? "image/png", i = await this.toBlob(n);
					(0, r.saveBlob)(e, i);
				} else if (a.apis.IS_FS_AVAILABLE) return await this.toSharp().toFile(e);
				else throw Error("Unable to save the image because filesystem is disabled in this environment.");
			}
			toSharp() {
				if (d) throw Error("toSharp() is only supported in server-side environments.");
				return (0, s.default)(this.data, { raw: {
					width: this.width,
					height: this.height,
					channels: this.channels
				} });
			}
		}
		let h = m.read.bind(m);
	}),
	"./src/utils/maths.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			FFT: () => h,
			bankers_round: () => v,
			cos_sim: () => c,
			dot: () => s,
			dynamic_time_warping: () => y,
			interpolate_data: () => r,
			log_softmax: () => o,
			magnitude: () => l,
			max: () => d,
			medianFilter: () => g,
			min: () => u,
			permute_data: () => i,
			round: () => _,
			softmax: () => a
		});
		function r(e, [t, n, r], [i, a], o = "bilinear", s = !1) {
			let c = a / r, l = i / n, u = new e.constructor(i * a * t), d = n * r, f = i * a;
			for (let o = 0; o < i; ++o) for (let i = 0; i < a; ++i) {
				let s = o * a + i, p = (i + .5) / c - .5, m = (o + .5) / l - .5, h = Math.floor(p), g = Math.floor(m), _ = Math.min(h + 1, r - 1), v = Math.min(g + 1, n - 1);
				h = Math.max(h, 0), g = Math.max(g, 0);
				let y = p - h, b = m - g, x = (1 - y) * (1 - b), S = y * (1 - b), C = (1 - y) * b, w = y * b, T = g * r, E = v * r, D = T + h, O = T + _, k = E + h, A = E + _;
				for (let n = 0; n < t; ++n) {
					let t = n * d;
					u[n * f + s] = x * e[t + D] + S * e[t + O] + C * e[t + k] + w * e[t + A];
				}
			}
			return u;
		}
		function i(e, t, n) {
			let r = Array(n.length), i = Array(n.length);
			for (let e = n.length - 1, a = 1; e >= 0; --e) i[e] = a, r[e] = t[n[e]], a *= r[e];
			let a = n.map((e, t) => i[n.indexOf(t)]), o = new e.constructor(e.length);
			for (let n = 0; n < e.length; ++n) {
				let r = 0;
				for (let e = t.length - 1, i = n; e >= 0; --e) r += i % t[e] * a[e], i = Math.floor(i / t[e]);
				o[r] = e[n];
			}
			return [o, r];
		}
		function a(e) {
			let t = d(e)[0], n = e.map((e) => Math.exp(e - t)), r = n.reduce((e, t) => e + t, 0);
			return n.map((e) => e / r);
		}
		function o(e) {
			let t = d(e)[0], n = 0;
			for (let r = 0; r < e.length; ++r) n += Math.exp(e[r] - t);
			let r = Math.log(n);
			return e.map((e) => e - t - r);
		}
		function s(e, t) {
			let n = 0;
			for (let r = 0; r < e.length; ++r) n += e[r] * t[r];
			return n;
		}
		function c(e, t) {
			return s(e, t) / (l(e) * l(t));
		}
		function l(e) {
			return Math.sqrt(e.reduce((e, t) => e + t * t, 0));
		}
		function u(e) {
			if (e.length === 0) throw Error("Array must not be empty");
			let t = e[0], n = 0;
			for (let r = 1; r < e.length; ++r) e[r] < t && (t = e[r], n = r);
			return [t, n];
		}
		function d(e) {
			if (e.length === 0) throw Error("Array must not be empty");
			let t = e[0], n = 0;
			for (let r = 1; r < e.length; ++r) e[r] > t && (t = e[r], n = r);
			return [t, n];
		}
		function f(e) {
			return e > 0 && !(e & e - 1);
		}
		class p {
			constructor(e) {
				if (this.size = e | 0, this.size <= 1 || !f(this.size)) throw Error("FFT size must be a power of two larger than 1");
				this._csize = e << 1, this.table = new Float64Array(this.size * 2);
				for (let e = 0; e < this.table.length; e += 2) {
					let t = Math.PI * e / this.size;
					this.table[e] = Math.cos(t), this.table[e + 1] = -Math.sin(t);
				}
				let t = 0;
				for (let e = 1; this.size > e; e <<= 1) ++t;
				this._width = t % 2 == 0 ? t - 1 : t, this._bitrev = new Int32Array(1 << this._width);
				for (let e = 0; e < this._bitrev.length; ++e) {
					this._bitrev[e] = 0;
					for (let t = 0; t < this._width; t += 2) {
						let n = this._width - t - 2;
						this._bitrev[e] |= (e >>> t & 3) << n;
					}
				}
			}
			createComplexArray() {
				return new Float64Array(this._csize);
			}
			fromComplexArray(e, t) {
				let n = t || Array(e.length >>> 1);
				for (let t = 0; t < e.length; t += 2) n[t >>> 1] = e[t];
				return n;
			}
			toComplexArray(e, t) {
				let n = t || this.createComplexArray();
				for (let t = 0; t < n.length; t += 2) n[t] = e[t >>> 1], n[t + 1] = 0;
				return n;
			}
			transform(e, t) {
				if (e === t) throw Error("Input and output buffers must be different");
				this._transform4(e, t, 1);
			}
			realTransform(e, t) {
				if (e === t) throw Error("Input and output buffers must be different");
				this._realTransform4(e, t, 1);
			}
			inverseTransform(e, t) {
				if (e === t) throw Error("Input and output buffers must be different");
				this._transform4(e, t, -1);
				for (let t = 0; t < e.length; ++t) e[t] /= this.size;
			}
			_transform4(e, t, n) {
				let r = this._csize, i = 1 << this._width, a = r / i << 1, o, s, c = this._bitrev;
				if (a === 4) for (o = 0, s = 0; o < r; o += a, ++s) {
					let n = c[s];
					this._singleTransform2(t, e, o, n, i);
				}
				else for (o = 0, s = 0; o < r; o += a, ++s) {
					let r = c[s];
					this._singleTransform4(t, e, o, r, i, n);
				}
				let l = this.table;
				for (i >>= 2; i >= 2; i >>= 2) {
					a = r / i << 1;
					let t = a >>> 2;
					for (o = 0; o < r; o += a) {
						let r = o + t - 1;
						for (let a = o, s = 0; a < r; a += 2, s += i) {
							let r = a, i = r + t, o = i + t, c = o + t, u = e[r], d = e[r + 1], f = e[i], p = e[i + 1], m = e[o], h = e[o + 1], g = e[c], _ = e[c + 1], v = l[s], y = n * l[s + 1], b = f * v - p * y, x = f * y + p * v, S = l[2 * s], C = n * l[2 * s + 1], w = m * S - h * C, T = m * C + h * S, E = l[3 * s], D = n * l[3 * s + 1], O = g * E - _ * D, k = g * D + _ * E, A = u + w, ee = d + T, te = u - w, j = d - T, M = b + O, N = x + k, ne = n * (b - O), P = n * (x - k);
							e[r] = A + M, e[r + 1] = ee + N, e[i] = te + P, e[i + 1] = j - ne, e[o] = A - M, e[o + 1] = ee - N, e[c] = te - P, e[c + 1] = j + ne;
						}
					}
				}
			}
			_singleTransform2(e, t, n, r, i) {
				let a = e[r], o = e[r + 1], s = e[r + i], c = e[r + i + 1];
				t[n] = a + s, t[n + 1] = o + c, t[n + 2] = a - s, t[n + 3] = o - c;
			}
			_singleTransform4(e, t, n, r, i, a) {
				let o = i * 2, s = i * 3, c = e[r], l = e[r + 1], u = e[r + i], d = e[r + i + 1], f = e[r + o], p = e[r + o + 1], m = e[r + s], h = e[r + s + 1], g = c + f, _ = l + p, v = c - f, y = l - p, b = u + m, x = d + h, S = a * (u - m), C = a * (d - h);
				t[n] = g + b, t[n + 1] = _ + x, t[n + 2] = v + C, t[n + 3] = y - S, t[n + 4] = g - b, t[n + 5] = _ - x, t[n + 6] = v - C, t[n + 7] = y + S;
			}
			_realTransform4(e, t, n) {
				let r = this._csize, i = 1 << this._width, a = r / i << 1, o, s, c = this._bitrev;
				if (a === 4) for (o = 0, s = 0; o < r; o += a, ++s) {
					let n = c[s];
					this._singleRealTransform2(t, e, o, n >>> 1, i >>> 1);
				}
				else for (o = 0, s = 0; o < r; o += a, ++s) {
					let r = c[s];
					this._singleRealTransform4(t, e, o, r >>> 1, i >>> 1, n);
				}
				let l = this.table;
				for (i >>= 2; i >= 2; i >>= 2) {
					a = r / i << 1;
					let t = a >>> 1, s = t >>> 1, c = s >>> 1;
					for (o = 0; o < r; o += a) for (let r = 0, a = 0; r <= c; r += 2, a += i) {
						let i = o + r, u = i + s, d = u + s, f = d + s, p = e[i], m = e[i + 1], h = e[u], g = e[u + 1], _ = e[d], v = e[d + 1], y = e[f], b = e[f + 1], x = p, S = m, C = l[a], w = n * l[a + 1], T = h * C - g * w, E = h * w + g * C, D = l[2 * a], O = n * l[2 * a + 1], k = _ * D - v * O, A = _ * O + v * D, ee = l[3 * a], te = n * l[3 * a + 1], j = y * ee - b * te, M = y * te + b * ee, N = x + k, ne = S + A, P = x - k, F = S - A, re = T + j, ie = E + M, I = n * (T - j), L = n * (E - M);
						if (e[i] = N + re, e[i + 1] = ne + ie, e[u] = P + L, e[u + 1] = F - I, r === 0) {
							e[d] = N - re, e[d + 1] = ne - ie;
							continue;
						}
						if (r === c) continue;
						let ae = o + s - r, oe = o + t - r;
						e[ae] = P - n * L, e[ae + 1] = -F - n * I, e[oe] = N - n * re, e[oe + 1] = -ne + n * ie;
					}
				}
				let u = r >>> 1;
				for (let t = 2; t < u; t += 2) e[r - t] = e[t], e[r - t + 1] = -e[t + 1];
			}
			_singleRealTransform2(e, t, n, r, i) {
				let a = e[r], o = e[r + i];
				t[n] = a + o, t[n + 1] = 0, t[n + 2] = a - o, t[n + 3] = 0;
			}
			_singleRealTransform4(e, t, n, r, i, a) {
				let o = i * 2, s = i * 3, c = e[r], l = e[r + i], u = e[r + o], d = e[r + s], f = c + u, p = c - u, m = l + d, h = a * (l - d);
				t[n] = f + m, t[n + 1] = 0, t[n + 2] = p, t[n + 3] = -h, t[n + 4] = f - m, t[n + 5] = 0, t[n + 6] = p, t[n + 7] = h;
			}
		}
		class m {
			constructor(e) {
				let t = 2 * (e - 1), n = 2 * (2 * e - 1), r = 2 ** Math.ceil(Math.log2(n));
				this.bufferSize = r, this._a = t;
				let i = new Float64Array(n), a = new Float64Array(r);
				this._chirpBuffer = new Float64Array(r), this._buffer1 = new Float64Array(r), this._buffer2 = new Float64Array(r), this._outBuffer1 = new Float64Array(r), this._outBuffer2 = new Float64Array(r);
				let o = -2 * Math.PI / e, s = Math.cos(o), c = Math.sin(o);
				for (let t = 0; t < n >> 1; ++t) {
					let n = (t + 1 - e) ** 2 / 2, r = Math.sqrt(s ** 2 + c ** 2) ** n, o = n * Math.atan2(c, s), l = 2 * t;
					i[l] = r * Math.cos(o), i[l + 1] = r * Math.sin(o), a[l] = i[l], a[l + 1] = -i[l + 1];
				}
				this._slicedChirpBuffer = i.subarray(t, n), this._f = new p(r >> 1), this._f.transform(this._chirpBuffer, a);
			}
			_transform(e, t, n) {
				let r = this._buffer1, i = this._buffer2, a = this._outBuffer1, o = this._outBuffer2, s = this._chirpBuffer, c = this._slicedChirpBuffer, l = this._a;
				if (n) for (let e = 0; e < c.length; e += 2) {
					let n = e + 1, i = t[e >> 1];
					r[e] = i * c[e], r[n] = i * c[n];
				}
				else for (let e = 0; e < c.length; e += 2) {
					let n = e + 1;
					r[e] = t[e] * c[e] - t[n] * c[n], r[n] = t[e] * c[n] + t[n] * c[e];
				}
				this._f.transform(a, r);
				for (let e = 0; e < s.length; e += 2) {
					let t = e + 1;
					i[e] = a[e] * s[e] - a[t] * s[t], i[t] = a[e] * s[t] + a[t] * s[e];
				}
				this._f.inverseTransform(o, i);
				for (let t = 0; t < o.length; t += 2) {
					let n = o[t + l], r = o[t + l + 1], i = c[t], a = c[t + 1];
					e[t] = n * i - r * a, e[t + 1] = n * a + r * i;
				}
			}
			transform(e, t) {
				this._transform(e, t, !1);
			}
			realTransform(e, t) {
				this._transform(e, t, !0);
			}
		}
		class h {
			constructor(e) {
				this.fft_length = e, this.isPowerOfTwo = f(e), this.isPowerOfTwo ? (this.fft = new p(e), this.outputBufferSize = 2 * e) : (this.fft = new m(e), this.outputBufferSize = this.fft.bufferSize);
			}
			realTransform(e, t) {
				this.fft.realTransform(e, t);
			}
			transform(e, t) {
				this.fft.transform(e, t);
			}
		}
		function g(e, t) {
			if (t % 2 == 0 || t <= 0) throw Error("Window size must be a positive odd number");
			let n = new e.constructor(e.length), r = new e.constructor(t), i = Math.floor(t / 2);
			for (let t = 0; t < e.length; ++t) {
				let a = 0;
				for (let n = -i; n <= i; ++n) {
					let i = t + n;
					i < 0 ? i = Math.abs(i) : i >= e.length && (i = 2 * (e.length - 1) - i), r[a++] = e[i];
				}
				r.sort(), n[t] = r[i];
			}
			return n;
		}
		function _(e, t) {
			let n = 10 ** t;
			return Math.round(e * n) / n;
		}
		function v(e) {
			let t = Math.round(e);
			return Math.abs(e) % 1 == .5 ? t % 2 == 0 ? t : t - 1 : t;
		}
		function y(e) {
			let t = e.length, n = e[0].length, r = [t + 1, n + 1], i = Array.from({ length: r[0] }, () => Array(r[1]).fill(Infinity));
			i[0][0] = 0;
			let a = Array.from({ length: r[0] }, () => Array(r[1]).fill(-1));
			for (let t = 1; t < r[1]; ++t) for (let n = 1; n < r[0]; ++n) {
				let r = i[n - 1][t - 1], o = i[n - 1][t], s = i[n][t - 1], c, l;
				r < o && r < s ? (c = r, l = 0) : o < r && o < s ? (c = o, l = 1) : (c = s, l = 2), i[n][t] = e[n - 1][t - 1] + c, a[n][t] = l;
			}
			for (let e = 0; e < r[1]; ++e) a[0][e] = 2;
			for (let e = 0; e < r[0]; ++e) a[e][0] = 1;
			let o = t, s = n, c = [], l = [];
			for (; o > 0 || s > 0;) switch (c.push(o - 1), l.push(s - 1), a[o][s]) {
				case 0:
					--o, --s;
					break;
				case 1:
					--o;
					break;
				case 2:
					--s;
					break;
				default: throw Error(`Internal error in dynamic time warping. Unexpected trace[${o}, ${s}]. Please file a bug report.`);
			}
			return c.reverse(), l.reverse(), [c, l];
		}
	}),
	"./src/utils/tensor.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			DataTypeMap: () => o,
			Tensor: () => s,
			cat: () => S,
			full: () => k,
			full_like: () => A,
			interpolate: () => u,
			interpolate_4d: () => d,
			layer_norm: () => v,
			matmul: () => f,
			mean: () => E,
			mean_pooling: () => _,
			ones: () => ee,
			ones_like: () => te,
			permute: () => l,
			quantize_embeddings: () => P,
			rand: () => N,
			randn: () => ne,
			rfft: () => p,
			slice: () => g,
			stack: () => C,
			std_mean: () => T,
			topk: () => m,
			zeros: () => j,
			zeros_like: () => M
		});
		var r = n("./src/utils/maths.js"), i = n("./src/backends/onnx.js"), a = n("./src/ops/registry.js");
		let o = Object.freeze({
			float32: Float32Array,
			float16: typeof Float16Array < "u" ? Float16Array : Uint16Array,
			float64: Float64Array,
			string: Array,
			int8: Int8Array,
			uint8: Uint8Array,
			int16: Int16Array,
			uint16: Uint16Array,
			int32: Int32Array,
			uint32: Uint32Array,
			int64: BigInt64Array,
			uint64: BigUint64Array,
			bool: Uint8Array,
			uint4: Uint8Array,
			int4: Int8Array
		});
		class s {
			get dims() {
				return this.ort_tensor.dims;
			}
			set dims(e) {
				this.ort_tensor.dims = e;
			}
			get type() {
				return this.ort_tensor.type;
			}
			get data() {
				return this.ort_tensor.data;
			}
			get size() {
				return this.ort_tensor.size;
			}
			get location() {
				return this.ort_tensor.location;
			}
			ort_tensor;
			constructor(...e) {
				return this.ort_tensor = (0, i.isONNXTensor)(e[0]) ? e[0] : new i.Tensor(e[0], e[1], e[2]), new Proxy(this, {
					get: (e, t) => {
						if (typeof t == "string") {
							let n = Number(t);
							if (Number.isInteger(n)) return e._getitem(n);
						}
						return e[t];
					},
					set: (e, t, n) => e[t] = n
				});
			}
			dispose() {
				this.ort_tensor.dispose();
			}
			*[Symbol.iterator]() {
				let [e, ...t] = this.dims;
				if (t.length > 0) {
					let n = t.reduce((e, t) => e * t);
					for (let r = 0; r < e; ++r) yield this._subarray(r, n, t);
				} else yield* this.data;
			}
			_getitem(e) {
				let [t, ...n] = this.dims;
				if (e = x(e, t), n.length > 0) {
					let t = n.reduce((e, t) => e * t);
					return this._subarray(e, t, n);
				}
				return new s(this.type, [this.data[e]], n);
			}
			indexOf(e) {
				let t = this.data;
				for (let n = 0; n < t.length; ++n) if (t[n] == e) return n;
				return -1;
			}
			_subarray(e, t, n) {
				let r = e * t, i = (e + 1) * t, a = "subarray" in this.data ? this.data.subarray(r, i) : this.data.slice(r, i);
				return new s(this.type, a, n);
			}
			item() {
				let e = this.data;
				if (e.length !== 1) throw Error(`a Tensor with ${e.length} elements cannot be converted to Scalar`);
				return e[0];
			}
			tolist() {
				return c(this.data, this.dims);
			}
			sigmoid() {
				return this.clone().sigmoid_();
			}
			sigmoid_() {
				let e = this.data;
				for (let t = 0; t < e.length; ++t) e[t] = 1 / (1 + Math.exp(-e[t]));
				return this;
			}
			map(e) {
				return this.clone().map_(e);
			}
			map_(e) {
				let t = this.data;
				for (let n = 0; n < t.length; ++n) t[n] = e(t[n], n, t);
				return this;
			}
			mul(e) {
				return this.clone().mul_(e);
			}
			mul_(e) {
				let t = this.data;
				for (let n = 0; n < t.length; ++n) t[n] *= e;
				return this;
			}
			div(e) {
				return this.clone().div_(e);
			}
			div_(e) {
				let t = this.data;
				for (let n = 0; n < t.length; ++n) t[n] /= e;
				return this;
			}
			add(e) {
				return this.clone().add_(e);
			}
			add_(e) {
				let t = this.data;
				for (let n = 0; n < t.length; ++n) t[n] += e;
				return this;
			}
			sub(e) {
				return this.clone().sub_(e);
			}
			sub_(e) {
				let t = this.data;
				for (let n = 0; n < t.length; ++n) t[n] -= e;
				return this;
			}
			clone() {
				return new s(this.type, this.data.slice(), this.dims.slice());
			}
			slice(...e) {
				let t = [], n = [];
				for (let r = 0; r < this.dims.length; ++r) {
					let i = e[r];
					if (i == null) n.push([0, this.dims[r]]), t.push(this.dims[r]);
					else if (typeof i == "number") i = x(i, this.dims[r], r), n.push([i, i + 1]);
					else if (Array.isArray(i) && i.length === 2) {
						let [e, a] = i;
						if (e = e === null ? 0 : x(e, this.dims[r], r, !1), a = a === null ? this.dims[r] : x(a, this.dims[r], r, !1), e > a) throw Error(`Invalid slice: ${i}`);
						let o = [Math.max(e, 0), Math.min(a, this.dims[r])];
						n.push(o), t.push(o[1] - o[0]);
					} else throw Error(`Invalid slice: ${i}`);
				}
				let r = n.map(([e, t]) => t - e), i = r.reduce((e, t) => e * t), a = this.data, o = new a.constructor(i), c = this.stride(), l = !0;
				for (let e = 1; e < r.length; ++e) if (n[e][0] !== 0 || n[e][1] !== this.dims[e]) {
					l = !1;
					break;
				}
				if (l) {
					let e = n[0][0] * c[0], t = n[0][1] * c[0];
					if (ArrayBuffer.isView(a)) o.set(a.subarray(e, t));
					else if (Array.isArray(a)) {
						let n = a.slice(e, t);
						for (let e = 0; e < n.length; ++e) o[e] = n[e];
					} else throw Error("Unsupported data type for slicing");
				} else for (let e = 0; e < i; ++e) {
					let t = 0;
					for (let i = r.length - 1, a = e; i >= 0; --i) {
						let e = r[i];
						t += (a % e + n[i][0]) * c[i], a = Math.floor(a / e);
					}
					o[e] = a[t];
				}
				return new s(this.type, o, t);
			}
			permute(...e) {
				return l(this, e);
			}
			transpose(...e) {
				return this.permute(...e);
			}
			sum(e = null, t = !1) {
				return this.norm(1, e, t);
			}
			norm(e = "fro", t = null, n = !1) {
				if (e === "fro") e = 2;
				else if (typeof e == "string") throw Error(`Unsupported norm: ${e}`);
				let r = this.data, i = (t, n) => t + n ** e;
				if (t === null) {
					let t = r.reduce(i, 0) ** (1 / e);
					return new s(this.type, [t], []);
				}
				let [a, o, c] = w(i, this, t, n);
				if (e !== 1) for (let t = 0; t < o.length; ++t) o[t] = o[t] ** (1 / e);
				return new s(a, o, c);
			}
			normalize_(e = 2, t = 1) {
				t = x(t, this.dims.length);
				let n = this.norm(e, t, !0), r = this.data, i = n.data;
				for (let e = 0; e < r.length; ++e) {
					let n = 0;
					for (let r = this.dims.length - 1, i = e, a = 1; r >= 0; --r) {
						let e = this.dims[r];
						if (r !== t) {
							let t = i % e;
							n += t * a, a *= this.dims[r];
						}
						i = Math.floor(i / e);
					}
					r[e] /= i[n];
				}
				return this;
			}
			normalize(e = 2, t = 1) {
				return this.clone().normalize_(e, t);
			}
			stride() {
				return D(this.dims);
			}
			squeeze(e = null) {
				return new s(this.type, this.data, y(this.dims, e));
			}
			squeeze_(e = null) {
				return this.dims = y(this.dims, e), this;
			}
			unsqueeze(e = null) {
				return new s(this.type, this.data, b(this.dims, e));
			}
			unsqueeze_(e = null) {
				return this.dims = b(this.dims, e), this;
			}
			flatten_(e = 0, t = -1) {
				t = (t + this.dims.length) % this.dims.length;
				let n = this.dims.slice(0, e), r = this.dims.slice(e, t + 1), i = this.dims.slice(t + 1);
				return this.dims = [
					...n,
					r.reduce((e, t) => e * t, 1),
					...i
				], this;
			}
			flatten(e = 0, t = -1) {
				return this.clone().flatten_(e, t);
			}
			view(...e) {
				let t = -1;
				for (let n = 0; n < e.length; ++n) if (e[n] === -1) {
					if (t !== -1) throw Error("Only one dimension can be inferred");
					t = n;
				}
				let n = this.data;
				if (t !== -1) {
					let r = e.reduce((e, n, r) => r === t ? e : e * n, 1);
					e[t] = n.length / r;
				}
				return new s(this.type, n, e);
			}
			neg_() {
				let e = this.data;
				for (let t = 0; t < e.length; ++t) e[t] = -e[t];
				return this;
			}
			neg() {
				return this.clone().neg_();
			}
			gt(e) {
				let t = new Uint8Array(this.data.length), n = this.data;
				for (let r = 0; r < n.length; ++r) t[r] = +(n[r] > e);
				return new s("bool", t, this.dims);
			}
			lt(e) {
				let t = new Uint8Array(this.data.length), n = this.data;
				for (let r = 0; r < n.length; ++r) t[r] = +(n[r] < e);
				return new s("bool", t, this.dims);
			}
			clamp_(e, t) {
				let n = this.data;
				for (let r = 0; r < n.length; ++r) n[r] = Math.min(Math.max(n[r], e), t);
				return this;
			}
			clamp(e, t) {
				return this.clone().clamp_(e, t);
			}
			round_() {
				let e = this.data;
				for (let t = 0; t < e.length; ++t) e[t] = Math.round(e[t]);
				return this;
			}
			round() {
				return this.clone().round_();
			}
			mean(e = null, t = !1) {
				return E(this, e, t);
			}
			min(e = null, t = !1) {
				if (e === null) {
					let e = (0, r.min)(this.data)[0];
					return new s(this.type, [e], []);
				}
				let [n, i, a] = w((e, t) => Math.min(e, t), this, e, t, Infinity);
				return new s(n, i, a);
			}
			max(e = null, t = !1) {
				if (e === null) {
					let e = (0, r.max)(this.data)[0];
					return new s(this.type, [e], []);
				}
				let [n, i, a] = w((e, t) => Math.max(e, t), this, e, t, -Infinity);
				return new s(n, i, a);
			}
			argmin(e = null, t = !1) {
				if (e !== null) throw Error("`dim !== null` not yet implemented.");
				let n = (0, r.min)(this.data)[1];
				return new s("int64", [BigInt(n)], []);
			}
			argmax(e = null, t = !1) {
				if (e !== null) throw Error("`dim !== null` not yet implemented.");
				let n = (0, r.max)(this.data)[1];
				return new s("int64", [BigInt(n)], []);
			}
			to(e) {
				if (this.type === e) return this;
				if (!o.hasOwnProperty(e)) throw Error(`Unsupported type: ${e}`);
				let t, n = ["int64", "uint64"].includes(this.type), r = ["int64", "uint64"].includes(e);
				return n && !r ? t = Number : !n && r && (t = [
					"float16",
					"float32",
					"float64"
				].includes(this.type) ? (e) => BigInt(Math.floor(e)) : BigInt), new s(e, o[e].from(this.data, t), this.dims);
			}
		}
		function c(e, t) {
			let n = e.length;
			if (n !== t.reduce((e, t) => e * t)) throw Error(`cannot reshape array of size ${n} into shape (${t})`);
			let r = e;
			for (let e = t.length - 1; e >= 0; e--) r = r.reduce((n, r) => {
				let i = n[n.length - 1];
				return i.length < t[e] ? i.push(r) : n.push([r]), n;
			}, [[]]);
			return r[0];
		}
		function l(e, t) {
			let [n, i] = (0, r.permute_data)(e.data, e.dims, t);
			return new s(e.type, n, i);
		}
		function u(e, [t, n], i = "bilinear", a = !1) {
			let o = e.dims.at(-3) ?? 1, c = e.dims.at(-2), l = e.dims.at(-1), u = (0, r.interpolate_data)(e.data, [
				o,
				c,
				l
			], [t, n], i, a);
			return new s(e.type, u, [
				o,
				t,
				n
			]);
		}
		async function d(e, { size: t = null, mode: n = "bilinear" } = {}) {
			if (e.dims.length !== 4) throw Error("`interpolate_4d` currently only supports 4D input.");
			if (!t) throw Error("`interpolate_4d` requires a `size` argument.");
			let r;
			if (t.length === 2) r = [...e.dims.slice(0, 2), ...t];
			else if (t.length === 3) r = [e.dims[0], ...t];
			else if (t.length === 4) r = t;
			else throw Error("`size` must be of length 2, 3, or 4.");
			let i;
			if (n === "nearest") i = await a.TensorOpRegistry.nearest_interpolate_4d;
			else if (n === "bilinear") i = await a.TensorOpRegistry.bilinear_interpolate_4d;
			else if (n === "bicubic") i = await a.TensorOpRegistry.bicubic_interpolate_4d;
			else throw Error(`Unsupported mode: ${n}`);
			let o = new s("int64", new BigInt64Array(r.map(BigInt)), [r.length]);
			return await i({
				x: e,
				s: o
			});
		}
		async function f(e, t) {
			return await (await a.TensorOpRegistry.matmul)({
				a: e,
				b: t
			});
		}
		async function p(e, t) {
			return await (await a.TensorOpRegistry.rfft)({
				x: e,
				a: t
			});
		}
		async function m(e, t) {
			let n = await a.TensorOpRegistry.top_k;
			return t = t == null ? e.dims.at(-1) : Math.min(t, e.dims.at(-1)), await n({
				x: e,
				k: new s("int64", [BigInt(t)], [1])
			});
		}
		let h = (e) => new s("int64", e, [e.length]);
		async function g(e, t, n, r, i) {
			return await (await a.TensorOpRegistry.slice)({
				x: e,
				s: h(t),
				e: h(n),
				a: h(r),
				t: h(i ?? Array(r.length).fill(1))
			});
		}
		function _(e, t) {
			let n = e.data, r = t.data, i = [e.dims[0], e.dims[2]], a = new n.constructor(i[0] * i[1]), [o, c, l] = e.dims, u = 0;
			for (let e = 0; e < o; ++e) {
				let t = e * l * c;
				for (let i = 0; i < l; ++i) {
					let o = 0, s = 0, d = e * c, f = t + i;
					for (let e = 0; e < c; ++e) {
						let t = Number(r[d + e]);
						s += t, o += n[f + e * l] * t;
					}
					let p = o / s;
					a[u++] = p;
				}
			}
			return new s(e.type, a, i);
		}
		function v(e, t, { eps: n = 1e-5 } = {}) {
			if (e.dims.length !== 2) throw Error("`layer_norm` currently only supports 2D input.");
			let [r, i] = e.dims;
			if (t.length !== 1 && t[0] !== i) throw Error("`normalized_shape` must be a 1D array with shape `[input.dims[1]]`.");
			let [a, o] = T(e, 1, 0, !0), c = a.data, l = o.data, u = e.data, d = new u.constructor(u.length);
			for (let e = 0; e < r; ++e) {
				let t = e * i;
				for (let r = 0; r < i; ++r) {
					let i = t + r;
					d[i] = (u[i] - l[e]) / (c[e] + n);
				}
			}
			return new s(e.type, d, e.dims);
		}
		function y(e, t) {
			return e = e.slice(), t === null ? e = e.filter((e) => e !== 1) : typeof t == "number" ? e[t] === 1 && e.splice(t, 1) : Array.isArray(t) && (e = e.filter((e, n) => e !== 1 || !t.includes(n))), e;
		}
		function b(e, t) {
			return t = x(t, e.length + 1), e = e.slice(), e.splice(t, 0, 1), e;
		}
		function x(e, t, n = null, r = !0) {
			if (e < -t || e >= t) {
				if (r) throw Error(`IndexError: index ${e} is out of bounds for dimension${n === null ? "" : " " + n} with size ${t}`);
				return e < -t ? 0 : t;
			}
			return e < 0 && (e = (e % t + t) % t), e;
		}
		function S(e, t = 0) {
			t = x(t, e[0].dims.length);
			let n = e[0].dims.slice();
			n[t] = e.reduce((e, n) => e + n.dims[t], 0);
			let r = n.reduce((e, t) => e * t, 1), i = new e[0].data.constructor(r), a = e[0].type;
			if (t === 0) {
				let t = 0;
				for (let n of e) {
					let e = n.data;
					i.set(e, t), t += e.length;
				}
			} else {
				let r = 0;
				for (let a = 0; a < e.length; ++a) {
					let { data: o, dims: s } = e[a];
					for (let e = 0; e < o.length; ++e) {
						let a = 0;
						for (let i = s.length - 1, o = e, c = 1; i >= 0; --i) {
							let e = s[i], l = o % e;
							i === t && (l += r), a += l * c, c *= n[i], o = Math.floor(o / e);
						}
						i[a] = o[e];
					}
					r += s[t];
				}
			}
			return new s(a, i, n);
		}
		function C(e, t = 0) {
			return S(e.map((e) => e.unsqueeze(t)), t);
		}
		function w(e, t, n = null, r = !1, i = null) {
			let a = t.data, o = t.dims;
			n = x(n, o.length);
			let s = o.slice();
			s[n] = 1;
			let c = new a.constructor(a.length / o[n]);
			i !== null && c.fill(i);
			for (let t = 0; t < a.length; ++t) {
				let r = 0;
				for (let e = o.length - 1, i = t, a = 1; e >= 0; --e) {
					let t = o[e];
					if (e !== n) {
						let n = i % t;
						r += n * a, a *= s[e];
					}
					i = Math.floor(i / t);
				}
				c[r] = e(c[r], a[t], t, r);
			}
			return r || s.splice(n, 1), [
				t.type,
				c,
				s
			];
		}
		function T(e, t = null, n = 1, r = !1) {
			let i = e.data, a = e.dims;
			if (t === null) {
				let t = i.reduce((e, t) => e + t, 0) / i.length, r = Math.sqrt(i.reduce((e, n) => e + (n - t) ** 2, 0) / (i.length - n)), a = new s(e.type, [t], []);
				return [new s(e.type, [r], []), a];
			}
			t = x(t, a.length);
			let o = E(e, t, r), c = o.data, [l, u, d] = w((e, t, n, r) => e + (t - c[r]) ** 2, e, t, r);
			for (let e = 0; e < u.length; ++e) u[e] = Math.sqrt(u[e] / (a[t] - n));
			return [new s(l, u, d), o];
		}
		function E(e, t = null, n = !1) {
			let r = e.dims, i = e.data;
			if (t === null) {
				let t = i.reduce((e, t) => e + t, 0);
				return new s(e.type, [t / i.length], []);
			}
			t = x(t, r.length);
			let [a, o, c] = w((e, t) => e + t, e, t, n);
			if (r[t] !== 1) for (let e = 0; e < o.length; ++e) o[e] /= r[t];
			return new s(a, o, c);
		}
		function D(e) {
			let t = Array(e.length);
			for (let n = e.length - 1, r = 1; n >= 0; --n) t[n] = r, r *= e[n];
			return t;
		}
		function O(e, t, n, r) {
			let i = e.reduce((e, t) => e * t, 1);
			return new s(n, new r(i).fill(t), e);
		}
		function k(e, t) {
			let n, r;
			if (typeof t == "number") n = "float32", r = Float32Array;
			else if (typeof t == "bigint") n = "int64", r = BigInt64Array;
			else if (typeof t == "boolean") n = "bool", r = Uint8Array;
			else throw Error(`Unsupported data type: ${typeof t}`);
			return O(e, t, n, r);
		}
		function A(e, t) {
			return k(e.dims, t);
		}
		function ee(e) {
			return O(e, 1n, "int64", BigInt64Array);
		}
		function te(e) {
			return ee(e.dims);
		}
		function j(e) {
			return O(e, 0n, "int64", BigInt64Array);
		}
		function M(e) {
			return j(e.dims);
		}
		function N(e) {
			let t = e.reduce((e, t) => e * t, 1);
			return new s("float32", Float32Array.from({ length: t }, () => Math.random()), e);
		}
		function ne(e) {
			let t = e.reduce((e, t) => e * t, 1);
			function n() {
				let e = 1 - Math.random(), t = 1 - Math.random();
				return Math.sqrt(-2 * Math.log(e)) * Math.cos(2 * Math.PI * t);
			}
			return new s("float32", Float32Array.from({ length: t }, () => n()), e);
		}
		function P(e, t) {
			if (e.dims.length !== 2) throw Error("The tensor must have 2 dimensions");
			if (e.dims.at(-1) % 8 != 0) throw Error("The last dimension of the tensor must be a multiple of 8");
			if (!["binary", "ubinary"].includes(t)) throw Error("The precision must be either 'binary' or 'ubinary'");
			let n = t === "binary", r = n ? "int8" : "uint8", i = n ? Int8Array : Uint8Array, a = e.data, o = new i(a.length / 8);
			for (let e = 0; e < a.length; ++e) {
				let t = +(a[e] > 0), r = Math.floor(e / 8), i = e % 8;
				o[r] |= t << 7 - i, n && i === 0 && (o[r] -= 128);
			}
			return new s(r, o, [e.dims[0], e.dims[1] / 8]);
		}
	}),
	"./src/utils/video.js": ((e, t, n) => {
		n.r(t), n.d(t, {
			RawVideo: () => o,
			RawVideoFrame: () => a,
			load_video: () => s
		});
		var r = n("./src/utils/image.js"), i = n("./src/env.js");
		class a {
			constructor(e, t) {
				this.image = e, this.timestamp = t;
			}
		}
		class o {
			constructor(e, t) {
				e.length > 0 && e[0] instanceof r.RawImage && (e = e.map((n, r) => new a(n, (r + 1) / (e.length + 1) * t))), this.frames = e, this.duration = t;
			}
			get width() {
				return this.frames[0].image.width;
			}
			get height() {
				return this.frames[0].image.height;
			}
			get fps() {
				return this.frames.length / this.duration;
			}
		}
		async function s(e, { num_frames: t = null, fps: n = null } = {}) {
			if (!i.apis.IS_BROWSER_ENV) throw Error("`load_video` is currently only supported in browser environments.");
			if (t == null && n == null) throw Error("Either num_frames or fps must be provided.");
			let s = [], c = document.createElement("video");
			if (c.crossOrigin = "anonymous", c.muted = !0, typeof e == "string") c.src = e;
			else if (e instanceof Blob) c.src = URL.createObjectURL(e);
			else if (e instanceof HTMLVideoElement) c.src = e.src;
			else throw Error("Invalid URL or video element provided.");
			if (await new Promise((e) => c.onloadedmetadata = e), c.seekable.start(0) === c.seekable.end(0)) {
				let e = await (await fetch(c.src)).blob();
				c.src = URL.createObjectURL(e), await new Promise((e) => c.onloadedmetadata = e);
			}
			let l = c.duration, u, d;
			t == null ? (d = 1 / n, u = Math.floor(l / d)) : (u = t, d = t === 1 ? 0 : l / (t - 1));
			let f = [];
			for (let e = 0; e < u; ++e) f.push(t === 1 ? l / 2 : e * d);
			let p = document.createElement("canvas");
			p.width = c.videoWidth, p.height = c.videoHeight;
			let m = p.getContext("2d", { willReadFrequently: !0 });
			for (let e of f) {
				c.currentTime = e, await new Promise((e) => {
					c.onseeked = e;
				}), m.drawImage(c, 0, 0, p.width, p.height);
				let t = m.getImageData(0, 0, p.width, p.height), n = new r.RawImage(t.data, p.width, p.height, 4), i = new a(n, e);
				s.push(i);
			}
			return c.remove(), new o(s, l);
		}
	})
}, cn = {};
function X(e) {
	var t = cn[e];
	if (t !== void 0) return t.exports;
	var n = cn[e] = { exports: {} };
	return sn[e](n, n.exports, X), n.exports;
}
(() => {
	var e = Object.getPrototypeOf ? (e) => Object.getPrototypeOf(e) : (e) => e.__proto__, t;
	X.t = function(n, r) {
		if (r & 1 && (n = this(n)), r & 8 || typeof n == "object" && n && (r & 4 && n.__esModule || r & 16 && typeof n.then == "function")) return n;
		var i = Object.create(null);
		X.r(i);
		var a = {};
		t ||= [
			null,
			e({}),
			e([]),
			e(e)
		];
		for (var o = r & 2 && n; typeof o == "object" && !~t.indexOf(o); o = e(o)) Object.getOwnPropertyNames(o).forEach((e) => a[e] = () => n[e]);
		return a.default = () => n, X.d(i, a), i;
	};
})(), X.d = (e, t) => {
	for (var n in t) X.o(t, n) && !X.o(e, n) && Object.defineProperty(e, n, {
		enumerable: !0,
		get: t[n]
	});
}, X.o = (e, t) => Object.prototype.hasOwnProperty.call(e, t), X.r = (e) => {
	typeof Symbol < "u" && Symbol.toStringTag && Object.defineProperty(e, Symbol.toStringTag, { value: "Module" }), Object.defineProperty(e, "__esModule", { value: !0 });
};
var Z = {};
(() => {
	X.r(Z), X.d(Z, {
		ASTFeatureExtractor: () => d.ASTFeatureExtractor,
		ASTForAudioClassification: () => n.ASTForAudioClassification,
		ASTModel: () => n.ASTModel,
		ASTPreTrainedModel: () => n.ASTPreTrainedModel,
		AlbertForMaskedLM: () => n.AlbertForMaskedLM,
		AlbertForQuestionAnswering: () => n.AlbertForQuestionAnswering,
		AlbertForSequenceClassification: () => n.AlbertForSequenceClassification,
		AlbertModel: () => n.AlbertModel,
		AlbertPreTrainedModel: () => n.AlbertPreTrainedModel,
		AlbertTokenizer: () => r.AlbertTokenizer,
		ArceeForCausalLM: () => n.ArceeForCausalLM,
		ArceeModel: () => n.ArceeModel,
		ArceePreTrainedModel: () => n.ArceePreTrainedModel,
		AudioClassificationPipeline: () => t.AudioClassificationPipeline,
		AutoConfig: () => i.AutoConfig,
		AutoFeatureExtractor: () => f.AutoFeatureExtractor,
		AutoImageProcessor: () => h.AutoImageProcessor,
		AutoModel: () => n.AutoModel,
		AutoModelForAudioClassification: () => n.AutoModelForAudioClassification,
		AutoModelForAudioFrameClassification: () => n.AutoModelForAudioFrameClassification,
		AutoModelForAudioTextToText: () => n.AutoModelForAudioTextToText,
		AutoModelForCTC: () => n.AutoModelForCTC,
		AutoModelForCausalLM: () => n.AutoModelForCausalLM,
		AutoModelForDepthEstimation: () => n.AutoModelForDepthEstimation,
		AutoModelForDocumentQuestionAnswering: () => n.AutoModelForDocumentQuestionAnswering,
		AutoModelForImageClassification: () => n.AutoModelForImageClassification,
		AutoModelForImageFeatureExtraction: () => n.AutoModelForImageFeatureExtraction,
		AutoModelForImageMatting: () => n.AutoModelForImageMatting,
		AutoModelForImageSegmentation: () => n.AutoModelForImageSegmentation,
		AutoModelForImageTextToText: () => n.AutoModelForImageTextToText,
		AutoModelForImageToImage: () => n.AutoModelForImageToImage,
		AutoModelForMaskGeneration: () => n.AutoModelForMaskGeneration,
		AutoModelForMaskedLM: () => n.AutoModelForMaskedLM,
		AutoModelForNormalEstimation: () => n.AutoModelForNormalEstimation,
		AutoModelForObjectDetection: () => n.AutoModelForObjectDetection,
		AutoModelForPoseEstimation: () => n.AutoModelForPoseEstimation,
		AutoModelForQuestionAnswering: () => n.AutoModelForQuestionAnswering,
		AutoModelForSemanticSegmentation: () => n.AutoModelForSemanticSegmentation,
		AutoModelForSeq2SeqLM: () => n.AutoModelForSeq2SeqLM,
		AutoModelForSequenceClassification: () => n.AutoModelForSequenceClassification,
		AutoModelForSpeechSeq2Seq: () => n.AutoModelForSpeechSeq2Seq,
		AutoModelForTextToSpectrogram: () => n.AutoModelForTextToSpectrogram,
		AutoModelForTextToWaveform: () => n.AutoModelForTextToWaveform,
		AutoModelForTokenClassification: () => n.AutoModelForTokenClassification,
		AutoModelForUniversalSegmentation: () => n.AutoModelForUniversalSegmentation,
		AutoModelForVision2Seq: () => n.AutoModelForVision2Seq,
		AutoModelForXVector: () => n.AutoModelForXVector,
		AutoModelForZeroShotObjectDetection: () => n.AutoModelForZeroShotObjectDetection,
		AutoProcessor: () => v.AutoProcessor,
		AutoTokenizer: () => r.AutoTokenizer,
		AutomaticSpeechRecognitionPipeline: () => t.AutomaticSpeechRecognitionPipeline,
		BackgroundRemovalPipeline: () => t.BackgroundRemovalPipeline,
		BartForConditionalGeneration: () => n.BartForConditionalGeneration,
		BartForSequenceClassification: () => n.BartForSequenceClassification,
		BartModel: () => n.BartModel,
		BartPretrainedModel: () => n.BartPretrainedModel,
		BartTokenizer: () => r.BartTokenizer,
		BaseModelOutput: () => n.BaseModelOutput,
		BaseStreamer: () => y.BaseStreamer,
		BeitFeatureExtractor: () => m.BeitFeatureExtractor,
		BeitForImageClassification: () => n.BeitForImageClassification,
		BeitModel: () => n.BeitModel,
		BeitPreTrainedModel: () => n.BeitPreTrainedModel,
		BertForMaskedLM: () => n.BertForMaskedLM,
		BertForQuestionAnswering: () => n.BertForQuestionAnswering,
		BertForSequenceClassification: () => n.BertForSequenceClassification,
		BertForTokenClassification: () => n.BertForTokenClassification,
		BertModel: () => n.BertModel,
		BertPreTrainedModel: () => n.BertPreTrainedModel,
		BertTokenizer: () => r.BertTokenizer,
		BitImageProcessor: () => m.BitImageProcessor,
		BlenderbotForConditionalGeneration: () => n.BlenderbotForConditionalGeneration,
		BlenderbotModel: () => n.BlenderbotModel,
		BlenderbotPreTrainedModel: () => n.BlenderbotPreTrainedModel,
		BlenderbotSmallForConditionalGeneration: () => n.BlenderbotSmallForConditionalGeneration,
		BlenderbotSmallModel: () => n.BlenderbotSmallModel,
		BlenderbotSmallPreTrainedModel: () => n.BlenderbotSmallPreTrainedModel,
		BlenderbotSmallTokenizer: () => r.BlenderbotSmallTokenizer,
		BlenderbotTokenizer: () => r.BlenderbotTokenizer,
		BloomForCausalLM: () => n.BloomForCausalLM,
		BloomModel: () => n.BloomModel,
		BloomPreTrainedModel: () => n.BloomPreTrainedModel,
		BloomTokenizer: () => r.BloomTokenizer,
		CLIPFeatureExtractor: () => m.CLIPFeatureExtractor,
		CLIPImageProcessor: () => m.CLIPImageProcessor,
		CLIPModel: () => n.CLIPModel,
		CLIPPreTrainedModel: () => n.CLIPPreTrainedModel,
		CLIPSegForImageSegmentation: () => n.CLIPSegForImageSegmentation,
		CLIPSegModel: () => n.CLIPSegModel,
		CLIPSegPreTrainedModel: () => n.CLIPSegPreTrainedModel,
		CLIPTextModel: () => n.CLIPTextModel,
		CLIPTextModelWithProjection: () => n.CLIPTextModelWithProjection,
		CLIPTokenizer: () => r.CLIPTokenizer,
		CLIPVisionModel: () => n.CLIPVisionModel,
		CLIPVisionModelWithProjection: () => n.CLIPVisionModelWithProjection,
		CamembertForMaskedLM: () => n.CamembertForMaskedLM,
		CamembertForQuestionAnswering: () => n.CamembertForQuestionAnswering,
		CamembertForSequenceClassification: () => n.CamembertForSequenceClassification,
		CamembertForTokenClassification: () => n.CamembertForTokenClassification,
		CamembertModel: () => n.CamembertModel,
		CamembertPreTrainedModel: () => n.CamembertPreTrainedModel,
		CamembertTokenizer: () => r.CamembertTokenizer,
		CausalLMOutput: () => n.CausalLMOutput,
		CausalLMOutputWithPast: () => n.CausalLMOutputWithPast,
		ChineseCLIPFeatureExtractor: () => m.ChineseCLIPFeatureExtractor,
		ChineseCLIPModel: () => n.ChineseCLIPModel,
		ChineseCLIPPreTrainedModel: () => n.ChineseCLIPPreTrainedModel,
		ClapAudioModelWithProjection: () => n.ClapAudioModelWithProjection,
		ClapFeatureExtractor: () => d.ClapFeatureExtractor,
		ClapModel: () => n.ClapModel,
		ClapPreTrainedModel: () => n.ClapPreTrainedModel,
		ClapTextModelWithProjection: () => n.ClapTextModelWithProjection,
		ClassifierFreeGuidanceLogitsProcessor: () => x.ClassifierFreeGuidanceLogitsProcessor,
		CodeGenForCausalLM: () => n.CodeGenForCausalLM,
		CodeGenModel: () => n.CodeGenModel,
		CodeGenPreTrainedModel: () => n.CodeGenPreTrainedModel,
		CodeGenTokenizer: () => r.CodeGenTokenizer,
		CodeLlamaTokenizer: () => r.CodeLlamaTokenizer,
		CohereForCausalLM: () => n.CohereForCausalLM,
		CohereModel: () => n.CohereModel,
		CoherePreTrainedModel: () => n.CoherePreTrainedModel,
		CohereTokenizer: () => r.CohereTokenizer,
		ConvBertForMaskedLM: () => n.ConvBertForMaskedLM,
		ConvBertForQuestionAnswering: () => n.ConvBertForQuestionAnswering,
		ConvBertForSequenceClassification: () => n.ConvBertForSequenceClassification,
		ConvBertForTokenClassification: () => n.ConvBertForTokenClassification,
		ConvBertModel: () => n.ConvBertModel,
		ConvBertPreTrainedModel: () => n.ConvBertPreTrainedModel,
		ConvBertTokenizer: () => r.ConvBertTokenizer,
		ConvNextFeatureExtractor: () => m.ConvNextFeatureExtractor,
		ConvNextForImageClassification: () => n.ConvNextForImageClassification,
		ConvNextImageProcessor: () => m.ConvNextImageProcessor,
		ConvNextModel: () => n.ConvNextModel,
		ConvNextPreTrainedModel: () => n.ConvNextPreTrainedModel,
		ConvNextV2ForImageClassification: () => n.ConvNextV2ForImageClassification,
		ConvNextV2Model: () => n.ConvNextV2Model,
		ConvNextV2PreTrainedModel: () => n.ConvNextV2PreTrainedModel,
		DFineForObjectDetection: () => n.DFineForObjectDetection,
		DFineModel: () => n.DFineModel,
		DFinePreTrainedModel: () => n.DFinePreTrainedModel,
		DINOv3ConvNextModel: () => n.DINOv3ConvNextModel,
		DINOv3ConvNextPreTrainedModel: () => n.DINOv3ConvNextPreTrainedModel,
		DINOv3ViTImageProcessor: () => m.DINOv3ViTImageProcessor,
		DINOv3ViTModel: () => n.DINOv3ViTModel,
		DINOv3ViTPreTrainedModel: () => n.DINOv3ViTPreTrainedModel,
		DPTFeatureExtractor: () => m.DPTFeatureExtractor,
		DPTForDepthEstimation: () => n.DPTForDepthEstimation,
		DPTImageProcessor: () => m.DPTImageProcessor,
		DPTModel: () => n.DPTModel,
		DPTPreTrainedModel: () => n.DPTPreTrainedModel,
		DacDecoderModel: () => n.DacDecoderModel,
		DacDecoderOutput: () => n.DacDecoderOutput,
		DacEncoderModel: () => n.DacEncoderModel,
		DacEncoderOutput: () => n.DacEncoderOutput,
		DacFeatureExtractor: () => d.DacFeatureExtractor,
		DacModel: () => n.DacModel,
		DacPreTrainedModel: () => n.DacPreTrainedModel,
		DataTypeMap: () => c.DataTypeMap,
		DebertaForMaskedLM: () => n.DebertaForMaskedLM,
		DebertaForQuestionAnswering: () => n.DebertaForQuestionAnswering,
		DebertaForSequenceClassification: () => n.DebertaForSequenceClassification,
		DebertaForTokenClassification: () => n.DebertaForTokenClassification,
		DebertaModel: () => n.DebertaModel,
		DebertaPreTrainedModel: () => n.DebertaPreTrainedModel,
		DebertaTokenizer: () => r.DebertaTokenizer,
		DebertaV2ForMaskedLM: () => n.DebertaV2ForMaskedLM,
		DebertaV2ForQuestionAnswering: () => n.DebertaV2ForQuestionAnswering,
		DebertaV2ForSequenceClassification: () => n.DebertaV2ForSequenceClassification,
		DebertaV2ForTokenClassification: () => n.DebertaV2ForTokenClassification,
		DebertaV2Model: () => n.DebertaV2Model,
		DebertaV2PreTrainedModel: () => n.DebertaV2PreTrainedModel,
		DebertaV2Tokenizer: () => r.DebertaV2Tokenizer,
		DecisionTransformerModel: () => n.DecisionTransformerModel,
		DecisionTransformerPreTrainedModel: () => n.DecisionTransformerPreTrainedModel,
		DeiTFeatureExtractor: () => m.DeiTFeatureExtractor,
		DeiTForImageClassification: () => n.DeiTForImageClassification,
		DeiTImageProcessor: () => m.DeiTImageProcessor,
		DeiTModel: () => n.DeiTModel,
		DeiTPreTrainedModel: () => n.DeiTPreTrainedModel,
		DepthAnythingForDepthEstimation: () => n.DepthAnythingForDepthEstimation,
		DepthAnythingPreTrainedModel: () => n.DepthAnythingPreTrainedModel,
		DepthEstimationPipeline: () => t.DepthEstimationPipeline,
		DepthProForDepthEstimation: () => n.DepthProForDepthEstimation,
		DepthProPreTrainedModel: () => n.DepthProPreTrainedModel,
		DetrFeatureExtractor: () => m.DetrFeatureExtractor,
		DetrForObjectDetection: () => n.DetrForObjectDetection,
		DetrForSegmentation: () => n.DetrForSegmentation,
		DetrImageProcessor: () => m.DetrImageProcessor,
		DetrModel: () => n.DetrModel,
		DetrObjectDetectionOutput: () => n.DetrObjectDetectionOutput,
		DetrPreTrainedModel: () => n.DetrPreTrainedModel,
		DetrSegmentationOutput: () => n.DetrSegmentationOutput,
		Dinov2ForImageClassification: () => n.Dinov2ForImageClassification,
		Dinov2Model: () => n.Dinov2Model,
		Dinov2PreTrainedModel: () => n.Dinov2PreTrainedModel,
		Dinov2WithRegistersForImageClassification: () => n.Dinov2WithRegistersForImageClassification,
		Dinov2WithRegistersModel: () => n.Dinov2WithRegistersModel,
		Dinov2WithRegistersPreTrainedModel: () => n.Dinov2WithRegistersPreTrainedModel,
		DistilBertForMaskedLM: () => n.DistilBertForMaskedLM,
		DistilBertForQuestionAnswering: () => n.DistilBertForQuestionAnswering,
		DistilBertForSequenceClassification: () => n.DistilBertForSequenceClassification,
		DistilBertForTokenClassification: () => n.DistilBertForTokenClassification,
		DistilBertModel: () => n.DistilBertModel,
		DistilBertPreTrainedModel: () => n.DistilBertPreTrainedModel,
		DistilBertTokenizer: () => r.DistilBertTokenizer,
		DocumentQuestionAnsweringPipeline: () => t.DocumentQuestionAnsweringPipeline,
		DonutFeatureExtractor: () => m.DonutFeatureExtractor,
		DonutImageProcessor: () => m.DonutImageProcessor,
		DonutSwinModel: () => n.DonutSwinModel,
		DonutSwinPreTrainedModel: () => n.DonutSwinPreTrainedModel,
		EdgeTamModel: () => n.EdgeTamModel,
		EfficientNetForImageClassification: () => n.EfficientNetForImageClassification,
		EfficientNetImageProcessor: () => m.EfficientNetImageProcessor,
		EfficientNetModel: () => n.EfficientNetModel,
		EfficientNetPreTrainedModel: () => n.EfficientNetPreTrainedModel,
		ElectraForMaskedLM: () => n.ElectraForMaskedLM,
		ElectraForQuestionAnswering: () => n.ElectraForQuestionAnswering,
		ElectraForSequenceClassification: () => n.ElectraForSequenceClassification,
		ElectraForTokenClassification: () => n.ElectraForTokenClassification,
		ElectraModel: () => n.ElectraModel,
		ElectraPreTrainedModel: () => n.ElectraPreTrainedModel,
		ElectraTokenizer: () => r.ElectraTokenizer,
		EncodecFeatureExtractor: () => d.EncodecFeatureExtractor,
		EosTokenCriteria: () => b.EosTokenCriteria,
		Ernie4_5ForCausalLM: () => n.Ernie4_5ForCausalLM,
		Ernie4_5Model: () => n.Ernie4_5Model,
		Ernie4_5PreTrainedModel: () => n.Ernie4_5PreTrainedModel,
		EsmForMaskedLM: () => n.EsmForMaskedLM,
		EsmForSequenceClassification: () => n.EsmForSequenceClassification,
		EsmForTokenClassification: () => n.EsmForTokenClassification,
		EsmModel: () => n.EsmModel,
		EsmPreTrainedModel: () => n.EsmPreTrainedModel,
		EsmTokenizer: () => r.EsmTokenizer,
		ExaoneForCausalLM: () => n.ExaoneForCausalLM,
		ExaoneModel: () => n.ExaoneModel,
		ExaonePreTrainedModel: () => n.ExaonePreTrainedModel,
		FFT: () => l.FFT,
		FalconForCausalLM: () => n.FalconForCausalLM,
		FalconModel: () => n.FalconModel,
		FalconPreTrainedModel: () => n.FalconPreTrainedModel,
		FalconTokenizer: () => r.FalconTokenizer,
		FastViTForImageClassification: () => n.FastViTForImageClassification,
		FastViTModel: () => n.FastViTModel,
		FastViTPreTrainedModel: () => n.FastViTPreTrainedModel,
		FeatureExtractionPipeline: () => t.FeatureExtractionPipeline,
		FeatureExtractor: () => u.FeatureExtractor,
		FillMaskPipeline: () => t.FillMaskPipeline,
		Florence2ForConditionalGeneration: () => n.Florence2ForConditionalGeneration,
		Florence2PreTrainedModel: () => n.Florence2PreTrainedModel,
		Florence2Processor: () => _.Florence2Processor,
		ForcedBOSTokenLogitsProcessor: () => x.ForcedBOSTokenLogitsProcessor,
		ForcedEOSTokenLogitsProcessor: () => x.ForcedEOSTokenLogitsProcessor,
		GLPNFeatureExtractor: () => m.GLPNFeatureExtractor,
		GLPNForDepthEstimation: () => n.GLPNForDepthEstimation,
		GLPNModel: () => n.GLPNModel,
		GLPNPreTrainedModel: () => n.GLPNPreTrainedModel,
		GPT2LMHeadModel: () => n.GPT2LMHeadModel,
		GPT2Model: () => n.GPT2Model,
		GPT2PreTrainedModel: () => n.GPT2PreTrainedModel,
		GPT2Tokenizer: () => r.GPT2Tokenizer,
		GPTBigCodeForCausalLM: () => n.GPTBigCodeForCausalLM,
		GPTBigCodeModel: () => n.GPTBigCodeModel,
		GPTBigCodePreTrainedModel: () => n.GPTBigCodePreTrainedModel,
		GPTJForCausalLM: () => n.GPTJForCausalLM,
		GPTJModel: () => n.GPTJModel,
		GPTJPreTrainedModel: () => n.GPTJPreTrainedModel,
		GPTNeoForCausalLM: () => n.GPTNeoForCausalLM,
		GPTNeoModel: () => n.GPTNeoModel,
		GPTNeoPreTrainedModel: () => n.GPTNeoPreTrainedModel,
		GPTNeoXForCausalLM: () => n.GPTNeoXForCausalLM,
		GPTNeoXModel: () => n.GPTNeoXModel,
		GPTNeoXPreTrainedModel: () => n.GPTNeoXPreTrainedModel,
		GPTNeoXTokenizer: () => r.GPTNeoXTokenizer,
		Gemma2ForCausalLM: () => n.Gemma2ForCausalLM,
		Gemma2Model: () => n.Gemma2Model,
		Gemma2PreTrainedModel: () => n.Gemma2PreTrainedModel,
		Gemma3ForCausalLM: () => n.Gemma3ForCausalLM,
		Gemma3Model: () => n.Gemma3Model,
		Gemma3PreTrainedModel: () => n.Gemma3PreTrainedModel,
		Gemma3nAudioFeatureExtractor: () => d.Gemma3nAudioFeatureExtractor,
		Gemma3nForConditionalGeneration: () => n.Gemma3nForConditionalGeneration,
		Gemma3nPreTrainedModel: () => n.Gemma3nPreTrainedModel,
		Gemma3nProcessor: () => _.Gemma3nProcessor,
		GemmaForCausalLM: () => n.GemmaForCausalLM,
		GemmaModel: () => n.GemmaModel,
		GemmaPreTrainedModel: () => n.GemmaPreTrainedModel,
		GemmaTokenizer: () => r.GemmaTokenizer,
		GlmForCausalLM: () => n.GlmForCausalLM,
		GlmModel: () => n.GlmModel,
		GlmPreTrainedModel: () => n.GlmPreTrainedModel,
		GraniteForCausalLM: () => n.GraniteForCausalLM,
		GraniteModel: () => n.GraniteModel,
		GraniteMoeHybridForCausalLM: () => n.GraniteMoeHybridForCausalLM,
		GraniteMoeHybridModel: () => n.GraniteMoeHybridModel,
		GraniteMoeHybridPreTrainedModel: () => n.GraniteMoeHybridPreTrainedModel,
		GranitePreTrainedModel: () => n.GranitePreTrainedModel,
		Grok1Tokenizer: () => r.Grok1Tokenizer,
		GroundingDinoForObjectDetection: () => n.GroundingDinoForObjectDetection,
		GroundingDinoImageProcessor: () => m.GroundingDinoImageProcessor,
		GroundingDinoPreTrainedModel: () => n.GroundingDinoPreTrainedModel,
		GroundingDinoProcessor: () => _.GroundingDinoProcessor,
		GroupViTModel: () => n.GroupViTModel,
		GroupViTPreTrainedModel: () => n.GroupViTPreTrainedModel,
		HeliumForCausalLM: () => n.HeliumForCausalLM,
		HeliumModel: () => n.HeliumModel,
		HeliumPreTrainedModel: () => n.HeliumPreTrainedModel,
		HerbertTokenizer: () => r.HerbertTokenizer,
		HieraForImageClassification: () => n.HieraForImageClassification,
		HieraModel: () => n.HieraModel,
		HieraPreTrainedModel: () => n.HieraPreTrainedModel,
		HubertForCTC: () => n.HubertForCTC,
		HubertForSequenceClassification: () => n.HubertForSequenceClassification,
		HubertModel: () => n.HubertModel,
		HubertPreTrainedModel: () => n.HubertPreTrainedModel,
		IJepaForImageClassification: () => n.IJepaForImageClassification,
		IJepaModel: () => n.IJepaModel,
		IJepaPreTrainedModel: () => n.IJepaPreTrainedModel,
		Idefics3ForConditionalGeneration: () => n.Idefics3ForConditionalGeneration,
		Idefics3ImageProcessor: () => m.Idefics3ImageProcessor,
		Idefics3PreTrainedModel: () => n.Idefics3PreTrainedModel,
		Idefics3Processor: () => _.Idefics3Processor,
		ImageClassificationPipeline: () => t.ImageClassificationPipeline,
		ImageFeatureExtractionPipeline: () => t.ImageFeatureExtractionPipeline,
		ImageFeatureExtractor: () => d.ImageFeatureExtractor,
		ImageMattingOutput: () => n.ImageMattingOutput,
		ImageProcessor: () => p.ImageProcessor,
		ImageSegmentationPipeline: () => t.ImageSegmentationPipeline,
		ImageToImagePipeline: () => t.ImageToImagePipeline,
		ImageToTextPipeline: () => t.ImageToTextPipeline,
		InterruptableStoppingCriteria: () => b.InterruptableStoppingCriteria,
		JAISLMHeadModel: () => n.JAISLMHeadModel,
		JAISModel: () => n.JAISModel,
		JAISPreTrainedModel: () => n.JAISPreTrainedModel,
		JinaCLIPImageProcessor: () => m.JinaCLIPImageProcessor,
		JinaCLIPModel: () => n.JinaCLIPModel,
		JinaCLIPPreTrainedModel: () => n.JinaCLIPPreTrainedModel,
		JinaCLIPProcessor: () => _.JinaCLIPProcessor,
		JinaCLIPTextModel: () => n.JinaCLIPTextModel,
		JinaCLIPVisionModel: () => n.JinaCLIPVisionModel,
		Lfm2ForCausalLM: () => n.Lfm2ForCausalLM,
		Lfm2Model: () => n.Lfm2Model,
		Lfm2PreTrainedModel: () => n.Lfm2PreTrainedModel,
		LiteWhisperForConditionalGeneration: () => n.LiteWhisperForConditionalGeneration,
		Llama4ForCausalLM: () => n.Llama4ForCausalLM,
		Llama4PreTrainedModel: () => n.Llama4PreTrainedModel,
		LlamaForCausalLM: () => n.LlamaForCausalLM,
		LlamaModel: () => n.LlamaModel,
		LlamaPreTrainedModel: () => n.LlamaPreTrainedModel,
		LlamaTokenizer: () => r.LlamaTokenizer,
		LlavaForConditionalGeneration: () => n.LlavaForConditionalGeneration,
		LlavaOnevisionForConditionalGeneration: () => n.LlavaOnevisionForConditionalGeneration,
		LlavaOnevisionImageProcessor: () => m.LlavaOnevisionImageProcessor,
		LlavaPreTrainedModel: () => n.LlavaPreTrainedModel,
		LlavaProcessor: () => _.LlavaProcessor,
		LlavaQwen2ForCausalLM: () => n.LlavaQwen2ForCausalLM,
		LogitsProcessor: () => x.LogitsProcessor,
		LogitsProcessorList: () => x.LogitsProcessorList,
		LogitsWarper: () => x.LogitsWarper,
		LongT5ForConditionalGeneration: () => n.LongT5ForConditionalGeneration,
		LongT5Model: () => n.LongT5Model,
		LongT5PreTrainedModel: () => n.LongT5PreTrainedModel,
		M2M100ForConditionalGeneration: () => n.M2M100ForConditionalGeneration,
		M2M100Model: () => n.M2M100Model,
		M2M100PreTrainedModel: () => n.M2M100PreTrainedModel,
		M2M100Tokenizer: () => r.M2M100Tokenizer,
		MBart50Tokenizer: () => r.MBart50Tokenizer,
		MBartForCausalLM: () => n.MBartForCausalLM,
		MBartForConditionalGeneration: () => n.MBartForConditionalGeneration,
		MBartForSequenceClassification: () => n.MBartForSequenceClassification,
		MBartModel: () => n.MBartModel,
		MBartPreTrainedModel: () => n.MBartPreTrainedModel,
		MBartTokenizer: () => r.MBartTokenizer,
		MPNetForMaskedLM: () => n.MPNetForMaskedLM,
		MPNetForQuestionAnswering: () => n.MPNetForQuestionAnswering,
		MPNetForSequenceClassification: () => n.MPNetForSequenceClassification,
		MPNetForTokenClassification: () => n.MPNetForTokenClassification,
		MPNetModel: () => n.MPNetModel,
		MPNetPreTrainedModel: () => n.MPNetPreTrainedModel,
		MPNetTokenizer: () => r.MPNetTokenizer,
		MT5ForConditionalGeneration: () => n.MT5ForConditionalGeneration,
		MT5Model: () => n.MT5Model,
		MT5PreTrainedModel: () => n.MT5PreTrainedModel,
		MarianMTModel: () => n.MarianMTModel,
		MarianModel: () => n.MarianModel,
		MarianPreTrainedModel: () => n.MarianPreTrainedModel,
		MarianTokenizer: () => r.MarianTokenizer,
		Mask2FormerImageProcessor: () => m.Mask2FormerImageProcessor,
		MaskFormerFeatureExtractor: () => m.MaskFormerFeatureExtractor,
		MaskFormerForInstanceSegmentation: () => n.MaskFormerForInstanceSegmentation,
		MaskFormerImageProcessor: () => m.MaskFormerImageProcessor,
		MaskFormerModel: () => n.MaskFormerModel,
		MaskFormerPreTrainedModel: () => n.MaskFormerPreTrainedModel,
		MaskedLMOutput: () => n.MaskedLMOutput,
		MaxLengthCriteria: () => b.MaxLengthCriteria,
		Metric3DForDepthEstimation: () => n.Metric3DForDepthEstimation,
		Metric3DPreTrainedModel: () => n.Metric3DPreTrainedModel,
		Metric3Dv2ForDepthEstimation: () => n.Metric3Dv2ForDepthEstimation,
		Metric3Dv2PreTrainedModel: () => n.Metric3Dv2PreTrainedModel,
		MgpstrForSceneTextRecognition: () => n.MgpstrForSceneTextRecognition,
		MgpstrModelOutput: () => n.MgpstrModelOutput,
		MgpstrPreTrainedModel: () => n.MgpstrPreTrainedModel,
		MgpstrProcessor: () => _.MgpstrProcessor,
		MgpstrTokenizer: () => r.MgpstrTokenizer,
		MimiDecoderModel: () => n.MimiDecoderModel,
		MimiDecoderOutput: () => n.MimiDecoderOutput,
		MimiEncoderModel: () => n.MimiEncoderModel,
		MimiEncoderOutput: () => n.MimiEncoderOutput,
		MimiModel: () => n.MimiModel,
		MimiPreTrainedModel: () => n.MimiPreTrainedModel,
		MinLengthLogitsProcessor: () => x.MinLengthLogitsProcessor,
		MinNewTokensLengthLogitsProcessor: () => x.MinNewTokensLengthLogitsProcessor,
		Ministral3ForCausalLM: () => n.Ministral3ForCausalLM,
		Ministral3Model: () => n.Ministral3Model,
		Ministral3PreTrainedModel: () => n.Ministral3PreTrainedModel,
		MinistralForCausalLM: () => n.MinistralForCausalLM,
		MinistralModel: () => n.MinistralModel,
		MinistralPreTrainedModel: () => n.MinistralPreTrainedModel,
		Mistral3ForConditionalGeneration: () => n.Mistral3ForConditionalGeneration,
		MistralForCausalLM: () => n.MistralForCausalLM,
		MistralModel: () => n.MistralModel,
		MistralPreTrainedModel: () => n.MistralPreTrainedModel,
		MobileBertForMaskedLM: () => n.MobileBertForMaskedLM,
		MobileBertForQuestionAnswering: () => n.MobileBertForQuestionAnswering,
		MobileBertForSequenceClassification: () => n.MobileBertForSequenceClassification,
		MobileBertModel: () => n.MobileBertModel,
		MobileBertPreTrainedModel: () => n.MobileBertPreTrainedModel,
		MobileBertTokenizer: () => r.MobileBertTokenizer,
		MobileLLMForCausalLM: () => n.MobileLLMForCausalLM,
		MobileLLMModel: () => n.MobileLLMModel,
		MobileLLMPreTrainedModel: () => n.MobileLLMPreTrainedModel,
		MobileNetV1FeatureExtractor: () => m.MobileNetV1FeatureExtractor,
		MobileNetV1ForImageClassification: () => n.MobileNetV1ForImageClassification,
		MobileNetV1ForSemanticSegmentation: () => n.MobileNetV1ForSemanticSegmentation,
		MobileNetV1ImageProcessor: () => m.MobileNetV1ImageProcessor,
		MobileNetV1Model: () => n.MobileNetV1Model,
		MobileNetV1PreTrainedModel: () => n.MobileNetV1PreTrainedModel,
		MobileNetV2FeatureExtractor: () => m.MobileNetV2FeatureExtractor,
		MobileNetV2ForImageClassification: () => n.MobileNetV2ForImageClassification,
		MobileNetV2ForSemanticSegmentation: () => n.MobileNetV2ForSemanticSegmentation,
		MobileNetV2ImageProcessor: () => m.MobileNetV2ImageProcessor,
		MobileNetV2Model: () => n.MobileNetV2Model,
		MobileNetV2PreTrainedModel: () => n.MobileNetV2PreTrainedModel,
		MobileNetV3FeatureExtractor: () => m.MobileNetV3FeatureExtractor,
		MobileNetV3ForImageClassification: () => n.MobileNetV3ForImageClassification,
		MobileNetV3ForSemanticSegmentation: () => n.MobileNetV3ForSemanticSegmentation,
		MobileNetV3ImageProcessor: () => m.MobileNetV3ImageProcessor,
		MobileNetV3Model: () => n.MobileNetV3Model,
		MobileNetV3PreTrainedModel: () => n.MobileNetV3PreTrainedModel,
		MobileNetV4FeatureExtractor: () => m.MobileNetV4FeatureExtractor,
		MobileNetV4ForImageClassification: () => n.MobileNetV4ForImageClassification,
		MobileNetV4ForSemanticSegmentation: () => n.MobileNetV4ForSemanticSegmentation,
		MobileNetV4ImageProcessor: () => m.MobileNetV4ImageProcessor,
		MobileNetV4Model: () => n.MobileNetV4Model,
		MobileNetV4PreTrainedModel: () => n.MobileNetV4PreTrainedModel,
		MobileViTFeatureExtractor: () => m.MobileViTFeatureExtractor,
		MobileViTForImageClassification: () => n.MobileViTForImageClassification,
		MobileViTImageProcessor: () => m.MobileViTImageProcessor,
		MobileViTModel: () => n.MobileViTModel,
		MobileViTPreTrainedModel: () => n.MobileViTPreTrainedModel,
		MobileViTV2ForImageClassification: () => n.MobileViTV2ForImageClassification,
		MobileViTV2Model: () => n.MobileViTV2Model,
		MobileViTV2PreTrainedModel: () => n.MobileViTV2PreTrainedModel,
		ModelOutput: () => n.ModelOutput,
		ModernBertDecoderForCausalLM: () => n.ModernBertDecoderForCausalLM,
		ModernBertDecoderModel: () => n.ModernBertDecoderModel,
		ModernBertDecoderPreTrainedModel: () => n.ModernBertDecoderPreTrainedModel,
		ModernBertForMaskedLM: () => n.ModernBertForMaskedLM,
		ModernBertForSequenceClassification: () => n.ModernBertForSequenceClassification,
		ModernBertForTokenClassification: () => n.ModernBertForTokenClassification,
		ModernBertModel: () => n.ModernBertModel,
		ModernBertPreTrainedModel: () => n.ModernBertPreTrainedModel,
		Moondream1ForConditionalGeneration: () => n.Moondream1ForConditionalGeneration,
		MoonshineFeatureExtractor: () => d.MoonshineFeatureExtractor,
		MoonshineForConditionalGeneration: () => n.MoonshineForConditionalGeneration,
		MoonshineModel: () => n.MoonshineModel,
		MoonshinePreTrainedModel: () => n.MoonshinePreTrainedModel,
		MoonshineProcessor: () => _.MoonshineProcessor,
		MptForCausalLM: () => n.MptForCausalLM,
		MptModel: () => n.MptModel,
		MptPreTrainedModel: () => n.MptPreTrainedModel,
		MultiModalityCausalLM: () => n.MultiModalityCausalLM,
		MultiModalityPreTrainedModel: () => n.MultiModalityPreTrainedModel,
		MusicgenForCausalLM: () => n.MusicgenForCausalLM,
		MusicgenForConditionalGeneration: () => n.MusicgenForConditionalGeneration,
		MusicgenModel: () => n.MusicgenModel,
		MusicgenPreTrainedModel: () => n.MusicgenPreTrainedModel,
		NanoChatForCausalLM: () => n.NanoChatForCausalLM,
		NanoChatModel: () => n.NanoChatModel,
		NanoChatPreTrainedModel: () => n.NanoChatPreTrainedModel,
		NeoBertForMaskedLM: () => n.NeoBertForMaskedLM,
		NeoBertForQuestionAnswering: () => n.NeoBertForQuestionAnswering,
		NeoBertForSequenceClassification: () => n.NeoBertForSequenceClassification,
		NeoBertForTokenClassification: () => n.NeoBertForTokenClassification,
		NeoBertModel: () => n.NeoBertModel,
		NeoBertPreTrainedModel: () => n.NeoBertPreTrainedModel,
		NllbTokenizer: () => r.NllbTokenizer,
		NoBadWordsLogitsProcessor: () => x.NoBadWordsLogitsProcessor,
		NoRepeatNGramLogitsProcessor: () => x.NoRepeatNGramLogitsProcessor,
		NomicBertModel: () => n.NomicBertModel,
		NomicBertPreTrainedModel: () => n.NomicBertPreTrainedModel,
		NougatImageProcessor: () => m.NougatImageProcessor,
		NougatTokenizer: () => r.NougatTokenizer,
		OPTForCausalLM: () => n.OPTForCausalLM,
		OPTModel: () => n.OPTModel,
		OPTPreTrainedModel: () => n.OPTPreTrainedModel,
		ObjectDetectionPipeline: () => t.ObjectDetectionPipeline,
		Olmo2ForCausalLM: () => n.Olmo2ForCausalLM,
		Olmo2Model: () => n.Olmo2Model,
		Olmo2PreTrainedModel: () => n.Olmo2PreTrainedModel,
		OlmoForCausalLM: () => n.OlmoForCausalLM,
		OlmoModel: () => n.OlmoModel,
		OlmoPreTrainedModel: () => n.OlmoPreTrainedModel,
		OpenELMForCausalLM: () => n.OpenELMForCausalLM,
		OpenELMModel: () => n.OpenELMModel,
		OpenELMPreTrainedModel: () => n.OpenELMPreTrainedModel,
		OwlViTFeatureExtractor: () => m.OwlViTFeatureExtractor,
		OwlViTForObjectDetection: () => n.OwlViTForObjectDetection,
		OwlViTImageProcessor: () => m.OwlViTImageProcessor,
		OwlViTModel: () => n.OwlViTModel,
		OwlViTPreTrainedModel: () => n.OwlViTPreTrainedModel,
		OwlViTProcessor: () => _.OwlViTProcessor,
		Owlv2ForObjectDetection: () => n.Owlv2ForObjectDetection,
		Owlv2ImageProcessor: () => m.Owlv2ImageProcessor,
		Owlv2Model: () => n.Owlv2Model,
		Owlv2PreTrainedModel: () => n.Owlv2PreTrainedModel,
		PaliGemmaForConditionalGeneration: () => n.PaliGemmaForConditionalGeneration,
		PaliGemmaPreTrainedModel: () => n.PaliGemmaPreTrainedModel,
		PaliGemmaProcessor: () => _.PaliGemmaProcessor,
		ParakeetFeatureExtractor: () => d.ParakeetFeatureExtractor,
		ParakeetForCTC: () => n.ParakeetForCTC,
		ParakeetPreTrainedModel: () => n.ParakeetPreTrainedModel,
		PatchTSMixerForPrediction: () => n.PatchTSMixerForPrediction,
		PatchTSMixerModel: () => n.PatchTSMixerModel,
		PatchTSMixerPreTrainedModel: () => n.PatchTSMixerPreTrainedModel,
		PatchTSTForPrediction: () => n.PatchTSTForPrediction,
		PatchTSTModel: () => n.PatchTSTModel,
		PatchTSTPreTrainedModel: () => n.PatchTSTPreTrainedModel,
		Phi3ForCausalLM: () => n.Phi3ForCausalLM,
		Phi3Model: () => n.Phi3Model,
		Phi3PreTrainedModel: () => n.Phi3PreTrainedModel,
		Phi3VForCausalLM: () => n.Phi3VForCausalLM,
		Phi3VImageProcessor: () => m.Phi3VImageProcessor,
		Phi3VPreTrainedModel: () => n.Phi3VPreTrainedModel,
		Phi3VProcessor: () => _.Phi3VProcessor,
		PhiForCausalLM: () => n.PhiForCausalLM,
		PhiModel: () => n.PhiModel,
		PhiPreTrainedModel: () => n.PhiPreTrainedModel,
		Pipeline: () => t.Pipeline,
		PixtralImageProcessor: () => m.PixtralImageProcessor,
		PixtralProcessor: () => _.PixtralProcessor,
		PreTrainedModel: () => n.PreTrainedModel,
		PreTrainedTokenizer: () => r.PreTrainedTokenizer,
		PretrainedConfig: () => i.PretrainedConfig,
		PretrainedMixin: () => n.PretrainedMixin,
		Processor: () => g.Processor,
		PvtForImageClassification: () => n.PvtForImageClassification,
		PvtImageProcessor: () => m.PvtImageProcessor,
		PvtModel: () => n.PvtModel,
		PvtPreTrainedModel: () => n.PvtPreTrainedModel,
		PyAnnoteFeatureExtractor: () => d.PyAnnoteFeatureExtractor,
		PyAnnoteForAudioFrameClassification: () => n.PyAnnoteForAudioFrameClassification,
		PyAnnoteModel: () => n.PyAnnoteModel,
		PyAnnotePreTrainedModel: () => n.PyAnnotePreTrainedModel,
		PyAnnoteProcessor: () => _.PyAnnoteProcessor,
		QuestionAnsweringModelOutput: () => n.QuestionAnsweringModelOutput,
		QuestionAnsweringPipeline: () => t.QuestionAnsweringPipeline,
		Qwen2ForCausalLM: () => n.Qwen2ForCausalLM,
		Qwen2Model: () => n.Qwen2Model,
		Qwen2PreTrainedModel: () => n.Qwen2PreTrainedModel,
		Qwen2Tokenizer: () => r.Qwen2Tokenizer,
		Qwen2VLForConditionalGeneration: () => n.Qwen2VLForConditionalGeneration,
		Qwen2VLImageProcessor: () => m.Qwen2VLImageProcessor,
		Qwen2VLPreTrainedModel: () => n.Qwen2VLPreTrainedModel,
		Qwen2VLProcessor: () => _.Qwen2VLProcessor,
		Qwen3ForCausalLM: () => n.Qwen3ForCausalLM,
		Qwen3Model: () => n.Qwen3Model,
		Qwen3PreTrainedModel: () => n.Qwen3PreTrainedModel,
		RFDetrForObjectDetection: () => n.RFDetrForObjectDetection,
		RFDetrModel: () => n.RFDetrModel,
		RFDetrObjectDetectionOutput: () => n.RFDetrObjectDetectionOutput,
		RFDetrPreTrainedModel: () => n.RFDetrPreTrainedModel,
		RTDetrForObjectDetection: () => n.RTDetrForObjectDetection,
		RTDetrImageProcessor: () => m.RTDetrImageProcessor,
		RTDetrModel: () => n.RTDetrModel,
		RTDetrObjectDetectionOutput: () => n.RTDetrObjectDetectionOutput,
		RTDetrPreTrainedModel: () => n.RTDetrPreTrainedModel,
		RTDetrV2ForObjectDetection: () => n.RTDetrV2ForObjectDetection,
		RTDetrV2Model: () => n.RTDetrV2Model,
		RTDetrV2ObjectDetectionOutput: () => n.RTDetrV2ObjectDetectionOutput,
		RTDetrV2PreTrainedModel: () => n.RTDetrV2PreTrainedModel,
		RawAudio: () => a.RawAudio,
		RawImage: () => o.RawImage,
		RawVideo: () => s.RawVideo,
		RawVideoFrame: () => s.RawVideoFrame,
		RepetitionPenaltyLogitsProcessor: () => x.RepetitionPenaltyLogitsProcessor,
		ResNetForImageClassification: () => n.ResNetForImageClassification,
		ResNetModel: () => n.ResNetModel,
		ResNetPreTrainedModel: () => n.ResNetPreTrainedModel,
		RoFormerForMaskedLM: () => n.RoFormerForMaskedLM,
		RoFormerForQuestionAnswering: () => n.RoFormerForQuestionAnswering,
		RoFormerForSequenceClassification: () => n.RoFormerForSequenceClassification,
		RoFormerForTokenClassification: () => n.RoFormerForTokenClassification,
		RoFormerModel: () => n.RoFormerModel,
		RoFormerPreTrainedModel: () => n.RoFormerPreTrainedModel,
		RoFormerTokenizer: () => r.RoFormerTokenizer,
		RobertaForMaskedLM: () => n.RobertaForMaskedLM,
		RobertaForQuestionAnswering: () => n.RobertaForQuestionAnswering,
		RobertaForSequenceClassification: () => n.RobertaForSequenceClassification,
		RobertaForTokenClassification: () => n.RobertaForTokenClassification,
		RobertaModel: () => n.RobertaModel,
		RobertaPreTrainedModel: () => n.RobertaPreTrainedModel,
		RobertaTokenizer: () => r.RobertaTokenizer,
		Sam2ImageProcessor: () => m.Sam2ImageProcessor,
		Sam2ImageSegmentationOutput: () => n.Sam2ImageSegmentationOutput,
		Sam2Model: () => n.Sam2Model,
		Sam2PreTrainedModel: () => n.Sam2PreTrainedModel,
		Sam2Processor: () => _.Sam2Processor,
		Sam2VideoProcessor: () => _.Sam2VideoProcessor,
		Sam3ImageProcessor: () => m.Sam3ImageProcessor,
		Sam3TrackerModel: () => n.Sam3TrackerModel,
		SamImageProcessor: () => m.SamImageProcessor,
		SamImageSegmentationOutput: () => n.SamImageSegmentationOutput,
		SamModel: () => n.SamModel,
		SamPreTrainedModel: () => n.SamPreTrainedModel,
		SamProcessor: () => _.SamProcessor,
		SapiensForDepthEstimation: () => n.SapiensForDepthEstimation,
		SapiensForNormalEstimation: () => n.SapiensForNormalEstimation,
		SapiensForSemanticSegmentation: () => n.SapiensForSemanticSegmentation,
		SapiensPreTrainedModel: () => n.SapiensPreTrainedModel,
		SeamlessM4TFeatureExtractor: () => d.SeamlessM4TFeatureExtractor,
		SegformerFeatureExtractor: () => m.SegformerFeatureExtractor,
		SegformerForImageClassification: () => n.SegformerForImageClassification,
		SegformerForSemanticSegmentation: () => n.SegformerForSemanticSegmentation,
		SegformerImageProcessor: () => m.SegformerImageProcessor,
		SegformerModel: () => n.SegformerModel,
		SegformerPreTrainedModel: () => n.SegformerPreTrainedModel,
		Seq2SeqLMOutput: () => n.Seq2SeqLMOutput,
		SequenceClassifierOutput: () => n.SequenceClassifierOutput,
		SiglipImageProcessor: () => m.SiglipImageProcessor,
		SiglipModel: () => n.SiglipModel,
		SiglipPreTrainedModel: () => n.SiglipPreTrainedModel,
		SiglipTextModel: () => n.SiglipTextModel,
		SiglipTokenizer: () => r.SiglipTokenizer,
		SiglipVisionModel: () => n.SiglipVisionModel,
		SmolLM3ForCausalLM: () => n.SmolLM3ForCausalLM,
		SmolLM3Model: () => n.SmolLM3Model,
		SmolLM3PreTrainedModel: () => n.SmolLM3PreTrainedModel,
		SmolVLMForConditionalGeneration: () => n.SmolVLMForConditionalGeneration,
		SmolVLMImageProcessor: () => m.SmolVLMImageProcessor,
		SmolVLMProcessor: () => _.SmolVLMProcessor,
		SnacDecoderModel: () => n.SnacDecoderModel,
		SnacEncoderModel: () => n.SnacEncoderModel,
		SnacFeatureExtractor: () => d.SnacFeatureExtractor,
		SnacModel: () => n.SnacModel,
		SnacPreTrainedModel: () => n.SnacPreTrainedModel,
		SpeechT5FeatureExtractor: () => d.SpeechT5FeatureExtractor,
		SpeechT5ForSpeechToText: () => n.SpeechT5ForSpeechToText,
		SpeechT5ForTextToSpeech: () => n.SpeechT5ForTextToSpeech,
		SpeechT5HifiGan: () => n.SpeechT5HifiGan,
		SpeechT5Model: () => n.SpeechT5Model,
		SpeechT5PreTrainedModel: () => n.SpeechT5PreTrainedModel,
		SpeechT5Processor: () => _.SpeechT5Processor,
		SpeechT5Tokenizer: () => r.SpeechT5Tokenizer,
		SqueezeBertForMaskedLM: () => n.SqueezeBertForMaskedLM,
		SqueezeBertForQuestionAnswering: () => n.SqueezeBertForQuestionAnswering,
		SqueezeBertForSequenceClassification: () => n.SqueezeBertForSequenceClassification,
		SqueezeBertModel: () => n.SqueezeBertModel,
		SqueezeBertPreTrainedModel: () => n.SqueezeBertPreTrainedModel,
		SqueezeBertTokenizer: () => r.SqueezeBertTokenizer,
		StableLmForCausalLM: () => n.StableLmForCausalLM,
		StableLmModel: () => n.StableLmModel,
		StableLmPreTrainedModel: () => n.StableLmPreTrainedModel,
		Starcoder2ForCausalLM: () => n.Starcoder2ForCausalLM,
		Starcoder2Model: () => n.Starcoder2Model,
		Starcoder2PreTrainedModel: () => n.Starcoder2PreTrainedModel,
		StoppingCriteria: () => b.StoppingCriteria,
		StoppingCriteriaList: () => b.StoppingCriteriaList,
		StyleTextToSpeech2Model: () => n.StyleTextToSpeech2Model,
		StyleTextToSpeech2PreTrainedModel: () => n.StyleTextToSpeech2PreTrainedModel,
		SummarizationPipeline: () => t.SummarizationPipeline,
		SupertonicForConditionalGeneration: () => n.SupertonicForConditionalGeneration,
		SupertonicPreTrainedModel: () => n.SupertonicPreTrainedModel,
		SuppressTokensAtBeginLogitsProcessor: () => x.SuppressTokensAtBeginLogitsProcessor,
		Swin2SRForImageSuperResolution: () => n.Swin2SRForImageSuperResolution,
		Swin2SRImageProcessor: () => m.Swin2SRImageProcessor,
		Swin2SRModel: () => n.Swin2SRModel,
		Swin2SRPreTrainedModel: () => n.Swin2SRPreTrainedModel,
		SwinForImageClassification: () => n.SwinForImageClassification,
		SwinForSemanticSegmentation: () => n.SwinForSemanticSegmentation,
		SwinModel: () => n.SwinModel,
		SwinPreTrainedModel: () => n.SwinPreTrainedModel,
		T5ForConditionalGeneration: () => n.T5ForConditionalGeneration,
		T5Model: () => n.T5Model,
		T5PreTrainedModel: () => n.T5PreTrainedModel,
		T5Tokenizer: () => r.T5Tokenizer,
		TableTransformerForObjectDetection: () => n.TableTransformerForObjectDetection,
		TableTransformerModel: () => n.TableTransformerModel,
		TableTransformerObjectDetectionOutput: () => n.TableTransformerObjectDetectionOutput,
		TableTransformerPreTrainedModel: () => n.TableTransformerPreTrainedModel,
		TemperatureLogitsWarper: () => x.TemperatureLogitsWarper,
		Tensor: () => c.Tensor,
		Text2TextGenerationPipeline: () => t.Text2TextGenerationPipeline,
		TextClassificationPipeline: () => t.TextClassificationPipeline,
		TextGenerationPipeline: () => t.TextGenerationPipeline,
		TextStreamer: () => y.TextStreamer,
		TextToAudioPipeline: () => t.TextToAudioPipeline,
		TokenClassificationPipeline: () => t.TokenClassificationPipeline,
		TokenClassifierOutput: () => n.TokenClassifierOutput,
		TokenizerModel: () => r.TokenizerModel,
		TopKLogitsWarper: () => x.TopKLogitsWarper,
		TopPLogitsWarper: () => x.TopPLogitsWarper,
		TrOCRForCausalLM: () => n.TrOCRForCausalLM,
		TrOCRPreTrainedModel: () => n.TrOCRPreTrainedModel,
		TranslationPipeline: () => t.TranslationPipeline,
		UltravoxModel: () => n.UltravoxModel,
		UltravoxPreTrainedModel: () => n.UltravoxPreTrainedModel,
		UltravoxProcessor: () => _.UltravoxProcessor,
		UniSpeechForCTC: () => n.UniSpeechForCTC,
		UniSpeechForSequenceClassification: () => n.UniSpeechForSequenceClassification,
		UniSpeechModel: () => n.UniSpeechModel,
		UniSpeechPreTrainedModel: () => n.UniSpeechPreTrainedModel,
		UniSpeechSatForAudioFrameClassification: () => n.UniSpeechSatForAudioFrameClassification,
		UniSpeechSatForCTC: () => n.UniSpeechSatForCTC,
		UniSpeechSatForSequenceClassification: () => n.UniSpeechSatForSequenceClassification,
		UniSpeechSatModel: () => n.UniSpeechSatModel,
		UniSpeechSatPreTrainedModel: () => n.UniSpeechSatPreTrainedModel,
		VLChatProcessor: () => _.VLChatProcessor,
		VLMImageProcessor: () => m.VLMImageProcessor,
		VaultGemmaForCausalLM: () => n.VaultGemmaForCausalLM,
		VaultGemmaModel: () => n.VaultGemmaModel,
		VaultGemmaPreTrainedModel: () => n.VaultGemmaPreTrainedModel,
		ViTFeatureExtractor: () => m.ViTFeatureExtractor,
		ViTForImageClassification: () => n.ViTForImageClassification,
		ViTImageProcessor: () => m.ViTImageProcessor,
		ViTMAEModel: () => n.ViTMAEModel,
		ViTMAEPreTrainedModel: () => n.ViTMAEPreTrainedModel,
		ViTMSNForImageClassification: () => n.ViTMSNForImageClassification,
		ViTMSNModel: () => n.ViTMSNModel,
		ViTMSNPreTrainedModel: () => n.ViTMSNPreTrainedModel,
		ViTModel: () => n.ViTModel,
		ViTPreTrainedModel: () => n.ViTPreTrainedModel,
		VisionEncoderDecoderModel: () => n.VisionEncoderDecoderModel,
		VitMatteForImageMatting: () => n.VitMatteForImageMatting,
		VitMatteImageProcessor: () => m.VitMatteImageProcessor,
		VitMattePreTrainedModel: () => n.VitMattePreTrainedModel,
		VitPoseForPoseEstimation: () => n.VitPoseForPoseEstimation,
		VitPoseImageProcessor: () => m.VitPoseImageProcessor,
		VitPosePreTrainedModel: () => n.VitPosePreTrainedModel,
		VitsModel: () => n.VitsModel,
		VitsModelOutput: () => n.VitsModelOutput,
		VitsPreTrainedModel: () => n.VitsPreTrainedModel,
		VitsTokenizer: () => r.VitsTokenizer,
		VoxtralForConditionalGeneration: () => n.VoxtralForConditionalGeneration,
		VoxtralProcessor: () => _.VoxtralProcessor,
		Wav2Vec2BertForCTC: () => n.Wav2Vec2BertForCTC,
		Wav2Vec2BertForSequenceClassification: () => n.Wav2Vec2BertForSequenceClassification,
		Wav2Vec2BertModel: () => n.Wav2Vec2BertModel,
		Wav2Vec2BertPreTrainedModel: () => n.Wav2Vec2BertPreTrainedModel,
		Wav2Vec2CTCTokenizer: () => r.Wav2Vec2CTCTokenizer,
		Wav2Vec2FeatureExtractor: () => d.Wav2Vec2FeatureExtractor,
		Wav2Vec2ForAudioFrameClassification: () => n.Wav2Vec2ForAudioFrameClassification,
		Wav2Vec2ForCTC: () => n.Wav2Vec2ForCTC,
		Wav2Vec2ForSequenceClassification: () => n.Wav2Vec2ForSequenceClassification,
		Wav2Vec2Model: () => n.Wav2Vec2Model,
		Wav2Vec2PreTrainedModel: () => n.Wav2Vec2PreTrainedModel,
		Wav2Vec2Processor: () => _.Wav2Vec2Processor,
		Wav2Vec2ProcessorWithLM: () => _.Wav2Vec2ProcessorWithLM,
		WavLMForAudioFrameClassification: () => n.WavLMForAudioFrameClassification,
		WavLMForCTC: () => n.WavLMForCTC,
		WavLMForSequenceClassification: () => n.WavLMForSequenceClassification,
		WavLMForXVector: () => n.WavLMForXVector,
		WavLMModel: () => n.WavLMModel,
		WavLMPreTrainedModel: () => n.WavLMPreTrainedModel,
		WeSpeakerFeatureExtractor: () => d.WeSpeakerFeatureExtractor,
		WeSpeakerResNetModel: () => n.WeSpeakerResNetModel,
		WeSpeakerResNetPreTrainedModel: () => n.WeSpeakerResNetPreTrainedModel,
		WhisperFeatureExtractor: () => d.WhisperFeatureExtractor,
		WhisperForConditionalGeneration: () => n.WhisperForConditionalGeneration,
		WhisperModel: () => n.WhisperModel,
		WhisperPreTrainedModel: () => n.WhisperPreTrainedModel,
		WhisperProcessor: () => _.WhisperProcessor,
		WhisperTextStreamer: () => y.WhisperTextStreamer,
		WhisperTimeStampLogitsProcessor: () => x.WhisperTimeStampLogitsProcessor,
		WhisperTokenizer: () => r.WhisperTokenizer,
		XLMForQuestionAnswering: () => n.XLMForQuestionAnswering,
		XLMForSequenceClassification: () => n.XLMForSequenceClassification,
		XLMForTokenClassification: () => n.XLMForTokenClassification,
		XLMModel: () => n.XLMModel,
		XLMPreTrainedModel: () => n.XLMPreTrainedModel,
		XLMRobertaForMaskedLM: () => n.XLMRobertaForMaskedLM,
		XLMRobertaForQuestionAnswering: () => n.XLMRobertaForQuestionAnswering,
		XLMRobertaForSequenceClassification: () => n.XLMRobertaForSequenceClassification,
		XLMRobertaForTokenClassification: () => n.XLMRobertaForTokenClassification,
		XLMRobertaModel: () => n.XLMRobertaModel,
		XLMRobertaPreTrainedModel: () => n.XLMRobertaPreTrainedModel,
		XLMRobertaTokenizer: () => r.XLMRobertaTokenizer,
		XLMTokenizer: () => r.XLMTokenizer,
		XLMWithLMHeadModel: () => n.XLMWithLMHeadModel,
		XVectorOutput: () => n.XVectorOutput,
		YolosFeatureExtractor: () => m.YolosFeatureExtractor,
		YolosForObjectDetection: () => n.YolosForObjectDetection,
		YolosImageProcessor: () => m.YolosImageProcessor,
		YolosModel: () => n.YolosModel,
		YolosObjectDetectionOutput: () => n.YolosObjectDetectionOutput,
		YolosPreTrainedModel: () => n.YolosPreTrainedModel,
		ZeroShotAudioClassificationPipeline: () => t.ZeroShotAudioClassificationPipeline,
		ZeroShotClassificationPipeline: () => t.ZeroShotClassificationPipeline,
		ZeroShotImageClassificationPipeline: () => t.ZeroShotImageClassificationPipeline,
		ZeroShotObjectDetectionPipeline: () => t.ZeroShotObjectDetectionPipeline,
		bankers_round: () => l.bankers_round,
		cat: () => c.cat,
		cos_sim: () => l.cos_sim,
		dot: () => l.dot,
		dynamic_time_warping: () => l.dynamic_time_warping,
		env: () => e.env,
		full: () => c.full,
		full_like: () => c.full_like,
		getCacheShapes: () => i.getCacheShapes,
		hamming: () => a.hamming,
		hanning: () => a.hanning,
		interpolate: () => c.interpolate,
		interpolate_4d: () => c.interpolate_4d,
		interpolate_data: () => l.interpolate_data,
		is_chinese_char: () => r.is_chinese_char,
		layer_norm: () => c.layer_norm,
		load_image: () => o.load_image,
		load_video: () => s.load_video,
		log_softmax: () => l.log_softmax,
		magnitude: () => l.magnitude,
		matmul: () => c.matmul,
		max: () => l.max,
		mean: () => c.mean,
		mean_pooling: () => c.mean_pooling,
		medianFilter: () => l.medianFilter,
		mel_filter_bank: () => a.mel_filter_bank,
		min: () => l.min,
		ones: () => c.ones,
		ones_like: () => c.ones_like,
		permute: () => c.permute,
		permute_data: () => l.permute_data,
		pipeline: () => t.pipeline,
		quantize_embeddings: () => c.quantize_embeddings,
		rand: () => c.rand,
		randn: () => c.randn,
		read_audio: () => a.read_audio,
		rfft: () => c.rfft,
		round: () => l.round,
		slice: () => c.slice,
		softmax: () => l.softmax,
		spectrogram: () => a.spectrogram,
		stack: () => c.stack,
		std_mean: () => c.std_mean,
		topk: () => c.topk,
		window_function: () => a.window_function,
		zeros: () => c.zeros,
		zeros_like: () => c.zeros_like
	});
	var e = X("./src/env.js"), t = X("./src/pipelines.js"), n = X("./src/models.js"), r = X("./src/tokenizers.js"), i = X("./src/configs.js"), a = X("./src/utils/audio.js"), o = X("./src/utils/image.js"), s = X("./src/utils/video.js"), c = X("./src/utils/tensor.js"), l = X("./src/utils/maths.js"), u = X("./src/base/feature_extraction_utils.js"), d = X("./src/models/feature_extractors.js"), f = X("./src/models/auto/feature_extraction_auto.js"), p = X("./src/base/image_processors_utils.js"), m = X("./src/models/image_processors.js"), h = X("./src/models/auto/image_processing_auto.js"), g = X("./src/base/processing_utils.js"), _ = X("./src/models/processors.js"), v = X("./src/models/auto/processing_auto.js"), y = X("./src/generation/streamers.js"), b = X("./src/generation/stopping_criteria.js"), x = X("./src/generation/logits_process.js");
})(), Z.ASTFeatureExtractor, Z.ASTForAudioClassification, Z.ASTModel, Z.ASTPreTrainedModel, Z.AlbertForMaskedLM, Z.AlbertForQuestionAnswering, Z.AlbertForSequenceClassification, Z.AlbertModel, Z.AlbertPreTrainedModel, Z.AlbertTokenizer, Z.ArceeForCausalLM, Z.ArceeModel, Z.ArceePreTrainedModel, Z.AudioClassificationPipeline, Z.AutoConfig, Z.AutoFeatureExtractor, Z.AutoImageProcessor, Z.AutoModel, Z.AutoModelForAudioClassification, Z.AutoModelForAudioFrameClassification, Z.AutoModelForAudioTextToText, Z.AutoModelForCTC, Z.AutoModelForCausalLM, Z.AutoModelForDepthEstimation, Z.AutoModelForDocumentQuestionAnswering, Z.AutoModelForImageClassification, Z.AutoModelForImageFeatureExtraction, Z.AutoModelForImageMatting, Z.AutoModelForImageSegmentation, Z.AutoModelForImageTextToText, Z.AutoModelForImageToImage, Z.AutoModelForMaskGeneration, Z.AutoModelForMaskedLM, Z.AutoModelForNormalEstimation, Z.AutoModelForObjectDetection, Z.AutoModelForPoseEstimation, Z.AutoModelForQuestionAnswering, Z.AutoModelForSemanticSegmentation, Z.AutoModelForSeq2SeqLM, Z.AutoModelForSequenceClassification, Z.AutoModelForSpeechSeq2Seq, Z.AutoModelForTextToSpectrogram, Z.AutoModelForTextToWaveform, Z.AutoModelForTokenClassification, Z.AutoModelForUniversalSegmentation, Z.AutoModelForVision2Seq, Z.AutoModelForXVector, Z.AutoModelForZeroShotObjectDetection, Z.AutoProcessor, Z.AutoTokenizer, Z.AutomaticSpeechRecognitionPipeline, Z.BackgroundRemovalPipeline, Z.BartForConditionalGeneration, Z.BartForSequenceClassification, Z.BartModel, Z.BartPretrainedModel, Z.BartTokenizer, Z.BaseModelOutput, Z.BaseStreamer, Z.BeitFeatureExtractor, Z.BeitForImageClassification, Z.BeitModel, Z.BeitPreTrainedModel, Z.BertForMaskedLM, Z.BertForQuestionAnswering, Z.BertForSequenceClassification, Z.BertForTokenClassification, Z.BertModel, Z.BertPreTrainedModel, Z.BertTokenizer, Z.BitImageProcessor, Z.BlenderbotForConditionalGeneration, Z.BlenderbotModel, Z.BlenderbotPreTrainedModel, Z.BlenderbotSmallForConditionalGeneration, Z.BlenderbotSmallModel, Z.BlenderbotSmallPreTrainedModel, Z.BlenderbotSmallTokenizer, Z.BlenderbotTokenizer, Z.BloomForCausalLM, Z.BloomModel, Z.BloomPreTrainedModel, Z.BloomTokenizer, Z.CLIPFeatureExtractor, Z.CLIPImageProcessor, Z.CLIPModel, Z.CLIPPreTrainedModel, Z.CLIPSegForImageSegmentation, Z.CLIPSegModel, Z.CLIPSegPreTrainedModel, Z.CLIPTextModel, Z.CLIPTextModelWithProjection, Z.CLIPTokenizer, Z.CLIPVisionModel, Z.CLIPVisionModelWithProjection, Z.CamembertForMaskedLM, Z.CamembertForQuestionAnswering, Z.CamembertForSequenceClassification, Z.CamembertForTokenClassification, Z.CamembertModel, Z.CamembertPreTrainedModel, Z.CamembertTokenizer, Z.CausalLMOutput, Z.CausalLMOutputWithPast, Z.ChineseCLIPFeatureExtractor, Z.ChineseCLIPModel, Z.ChineseCLIPPreTrainedModel, Z.ClapAudioModelWithProjection, Z.ClapFeatureExtractor, Z.ClapModel, Z.ClapPreTrainedModel, Z.ClapTextModelWithProjection, Z.ClassifierFreeGuidanceLogitsProcessor, Z.CodeGenForCausalLM, Z.CodeGenModel, Z.CodeGenPreTrainedModel, Z.CodeGenTokenizer, Z.CodeLlamaTokenizer, Z.CohereForCausalLM, Z.CohereModel, Z.CoherePreTrainedModel, Z.CohereTokenizer, Z.ConvBertForMaskedLM, Z.ConvBertForQuestionAnswering, Z.ConvBertForSequenceClassification, Z.ConvBertForTokenClassification, Z.ConvBertModel, Z.ConvBertPreTrainedModel, Z.ConvBertTokenizer, Z.ConvNextFeatureExtractor, Z.ConvNextForImageClassification, Z.ConvNextImageProcessor, Z.ConvNextModel, Z.ConvNextPreTrainedModel, Z.ConvNextV2ForImageClassification, Z.ConvNextV2Model, Z.ConvNextV2PreTrainedModel, Z.DFineForObjectDetection, Z.DFineModel, Z.DFinePreTrainedModel, Z.DINOv3ConvNextModel, Z.DINOv3ConvNextPreTrainedModel, Z.DINOv3ViTImageProcessor, Z.DINOv3ViTModel, Z.DINOv3ViTPreTrainedModel, Z.DPTFeatureExtractor, Z.DPTForDepthEstimation, Z.DPTImageProcessor, Z.DPTModel, Z.DPTPreTrainedModel, Z.DacDecoderModel, Z.DacDecoderOutput, Z.DacEncoderModel, Z.DacEncoderOutput, Z.DacFeatureExtractor, Z.DacModel, Z.DacPreTrainedModel, Z.DataTypeMap, Z.DebertaForMaskedLM, Z.DebertaForQuestionAnswering, Z.DebertaForSequenceClassification, Z.DebertaForTokenClassification, Z.DebertaModel, Z.DebertaPreTrainedModel, Z.DebertaTokenizer, Z.DebertaV2ForMaskedLM, Z.DebertaV2ForQuestionAnswering, Z.DebertaV2ForSequenceClassification, Z.DebertaV2ForTokenClassification, Z.DebertaV2Model, Z.DebertaV2PreTrainedModel, Z.DebertaV2Tokenizer, Z.DecisionTransformerModel, Z.DecisionTransformerPreTrainedModel, Z.DeiTFeatureExtractor, Z.DeiTForImageClassification, Z.DeiTImageProcessor, Z.DeiTModel, Z.DeiTPreTrainedModel, Z.DepthAnythingForDepthEstimation, Z.DepthAnythingPreTrainedModel, Z.DepthEstimationPipeline, Z.DepthProForDepthEstimation, Z.DepthProPreTrainedModel, Z.DetrFeatureExtractor, Z.DetrForObjectDetection, Z.DetrForSegmentation, Z.DetrImageProcessor, Z.DetrModel, Z.DetrObjectDetectionOutput, Z.DetrPreTrainedModel, Z.DetrSegmentationOutput, Z.Dinov2ForImageClassification, Z.Dinov2Model, Z.Dinov2PreTrainedModel, Z.Dinov2WithRegistersForImageClassification, Z.Dinov2WithRegistersModel, Z.Dinov2WithRegistersPreTrainedModel, Z.DistilBertForMaskedLM, Z.DistilBertForQuestionAnswering, Z.DistilBertForSequenceClassification, Z.DistilBertForTokenClassification, Z.DistilBertModel, Z.DistilBertPreTrainedModel, Z.DistilBertTokenizer, Z.DocumentQuestionAnsweringPipeline, Z.DonutFeatureExtractor, Z.DonutImageProcessor, Z.DonutSwinModel, Z.DonutSwinPreTrainedModel, Z.EdgeTamModel, Z.EfficientNetForImageClassification, Z.EfficientNetImageProcessor, Z.EfficientNetModel, Z.EfficientNetPreTrainedModel, Z.ElectraForMaskedLM, Z.ElectraForQuestionAnswering, Z.ElectraForSequenceClassification, Z.ElectraForTokenClassification, Z.ElectraModel, Z.ElectraPreTrainedModel, Z.ElectraTokenizer, Z.EncodecFeatureExtractor, Z.EosTokenCriteria, Z.Ernie4_5ForCausalLM, Z.Ernie4_5Model, Z.Ernie4_5PreTrainedModel, Z.EsmForMaskedLM, Z.EsmForSequenceClassification, Z.EsmForTokenClassification, Z.EsmModel, Z.EsmPreTrainedModel, Z.EsmTokenizer, Z.ExaoneForCausalLM, Z.ExaoneModel, Z.ExaonePreTrainedModel, Z.FFT, Z.FalconForCausalLM, Z.FalconModel, Z.FalconPreTrainedModel, Z.FalconTokenizer, Z.FastViTForImageClassification, Z.FastViTModel, Z.FastViTPreTrainedModel, Z.FeatureExtractionPipeline, Z.FeatureExtractor, Z.FillMaskPipeline, Z.Florence2ForConditionalGeneration, Z.Florence2PreTrainedModel, Z.Florence2Processor, Z.ForcedBOSTokenLogitsProcessor, Z.ForcedEOSTokenLogitsProcessor, Z.GLPNFeatureExtractor, Z.GLPNForDepthEstimation, Z.GLPNModel, Z.GLPNPreTrainedModel, Z.GPT2LMHeadModel, Z.GPT2Model, Z.GPT2PreTrainedModel, Z.GPT2Tokenizer, Z.GPTBigCodeForCausalLM, Z.GPTBigCodeModel, Z.GPTBigCodePreTrainedModel, Z.GPTJForCausalLM, Z.GPTJModel, Z.GPTJPreTrainedModel, Z.GPTNeoForCausalLM, Z.GPTNeoModel, Z.GPTNeoPreTrainedModel, Z.GPTNeoXForCausalLM, Z.GPTNeoXModel, Z.GPTNeoXPreTrainedModel, Z.GPTNeoXTokenizer, Z.Gemma2ForCausalLM, Z.Gemma2Model, Z.Gemma2PreTrainedModel, Z.Gemma3ForCausalLM, Z.Gemma3Model, Z.Gemma3PreTrainedModel, Z.Gemma3nAudioFeatureExtractor, Z.Gemma3nForConditionalGeneration, Z.Gemma3nPreTrainedModel, Z.Gemma3nProcessor, Z.GemmaForCausalLM, Z.GemmaModel, Z.GemmaPreTrainedModel, Z.GemmaTokenizer, Z.GlmForCausalLM, Z.GlmModel, Z.GlmPreTrainedModel, Z.GraniteForCausalLM, Z.GraniteModel, Z.GraniteMoeHybridForCausalLM, Z.GraniteMoeHybridModel, Z.GraniteMoeHybridPreTrainedModel, Z.GranitePreTrainedModel, Z.Grok1Tokenizer, Z.GroundingDinoForObjectDetection, Z.GroundingDinoImageProcessor, Z.GroundingDinoPreTrainedModel, Z.GroundingDinoProcessor, Z.GroupViTModel, Z.GroupViTPreTrainedModel, Z.HeliumForCausalLM, Z.HeliumModel, Z.HeliumPreTrainedModel, Z.HerbertTokenizer, Z.HieraForImageClassification, Z.HieraModel, Z.HieraPreTrainedModel, Z.HubertForCTC, Z.HubertForSequenceClassification, Z.HubertModel, Z.HubertPreTrainedModel, Z.IJepaForImageClassification, Z.IJepaModel, Z.IJepaPreTrainedModel, Z.Idefics3ForConditionalGeneration, Z.Idefics3ImageProcessor, Z.Idefics3PreTrainedModel, Z.Idefics3Processor, Z.ImageClassificationPipeline, Z.ImageFeatureExtractionPipeline, Z.ImageFeatureExtractor, Z.ImageMattingOutput, Z.ImageProcessor, Z.ImageSegmentationPipeline, Z.ImageToImagePipeline, Z.ImageToTextPipeline, Z.InterruptableStoppingCriteria, Z.JAISLMHeadModel, Z.JAISModel, Z.JAISPreTrainedModel, Z.JinaCLIPImageProcessor, Z.JinaCLIPModel, Z.JinaCLIPPreTrainedModel, Z.JinaCLIPProcessor, Z.JinaCLIPTextModel, Z.JinaCLIPVisionModel, Z.Lfm2ForCausalLM, Z.Lfm2Model, Z.Lfm2PreTrainedModel, Z.LiteWhisperForConditionalGeneration, Z.Llama4ForCausalLM, Z.Llama4PreTrainedModel, Z.LlamaForCausalLM, Z.LlamaModel, Z.LlamaPreTrainedModel, Z.LlamaTokenizer, Z.LlavaForConditionalGeneration, Z.LlavaOnevisionForConditionalGeneration, Z.LlavaOnevisionImageProcessor, Z.LlavaPreTrainedModel, Z.LlavaProcessor, Z.LlavaQwen2ForCausalLM, Z.LogitsProcessor, Z.LogitsProcessorList, Z.LogitsWarper, Z.LongT5ForConditionalGeneration, Z.LongT5Model, Z.LongT5PreTrainedModel, Z.M2M100ForConditionalGeneration, Z.M2M100Model, Z.M2M100PreTrainedModel, Z.M2M100Tokenizer, Z.MBart50Tokenizer, Z.MBartForCausalLM, Z.MBartForConditionalGeneration, Z.MBartForSequenceClassification, Z.MBartModel, Z.MBartPreTrainedModel, Z.MBartTokenizer, Z.MPNetForMaskedLM, Z.MPNetForQuestionAnswering, Z.MPNetForSequenceClassification, Z.MPNetForTokenClassification, Z.MPNetModel, Z.MPNetPreTrainedModel, Z.MPNetTokenizer, Z.MT5ForConditionalGeneration, Z.MT5Model, Z.MT5PreTrainedModel, Z.MarianMTModel, Z.MarianModel, Z.MarianPreTrainedModel, Z.MarianTokenizer, Z.Mask2FormerImageProcessor, Z.MaskFormerFeatureExtractor, Z.MaskFormerForInstanceSegmentation, Z.MaskFormerImageProcessor, Z.MaskFormerModel, Z.MaskFormerPreTrainedModel, Z.MaskedLMOutput, Z.MaxLengthCriteria, Z.Metric3DForDepthEstimation, Z.Metric3DPreTrainedModel, Z.Metric3Dv2ForDepthEstimation, Z.Metric3Dv2PreTrainedModel, Z.MgpstrForSceneTextRecognition, Z.MgpstrModelOutput, Z.MgpstrPreTrainedModel, Z.MgpstrProcessor, Z.MgpstrTokenizer, Z.MimiDecoderModel, Z.MimiDecoderOutput, Z.MimiEncoderModel, Z.MimiEncoderOutput, Z.MimiModel, Z.MimiPreTrainedModel, Z.MinLengthLogitsProcessor, Z.MinNewTokensLengthLogitsProcessor, Z.Ministral3ForCausalLM, Z.Ministral3Model, Z.Ministral3PreTrainedModel, Z.MinistralForCausalLM, Z.MinistralModel, Z.MinistralPreTrainedModel, Z.Mistral3ForConditionalGeneration, Z.MistralForCausalLM, Z.MistralModel, Z.MistralPreTrainedModel, Z.MobileBertForMaskedLM, Z.MobileBertForQuestionAnswering, Z.MobileBertForSequenceClassification, Z.MobileBertModel, Z.MobileBertPreTrainedModel, Z.MobileBertTokenizer, Z.MobileLLMForCausalLM, Z.MobileLLMModel, Z.MobileLLMPreTrainedModel, Z.MobileNetV1FeatureExtractor, Z.MobileNetV1ForImageClassification, Z.MobileNetV1ForSemanticSegmentation, Z.MobileNetV1ImageProcessor, Z.MobileNetV1Model, Z.MobileNetV1PreTrainedModel, Z.MobileNetV2FeatureExtractor, Z.MobileNetV2ForImageClassification, Z.MobileNetV2ForSemanticSegmentation, Z.MobileNetV2ImageProcessor, Z.MobileNetV2Model, Z.MobileNetV2PreTrainedModel, Z.MobileNetV3FeatureExtractor, Z.MobileNetV3ForImageClassification, Z.MobileNetV3ForSemanticSegmentation, Z.MobileNetV3ImageProcessor, Z.MobileNetV3Model, Z.MobileNetV3PreTrainedModel, Z.MobileNetV4FeatureExtractor, Z.MobileNetV4ForImageClassification, Z.MobileNetV4ForSemanticSegmentation, Z.MobileNetV4ImageProcessor, Z.MobileNetV4Model, Z.MobileNetV4PreTrainedModel, Z.MobileViTFeatureExtractor, Z.MobileViTForImageClassification, Z.MobileViTImageProcessor, Z.MobileViTModel, Z.MobileViTPreTrainedModel, Z.MobileViTV2ForImageClassification, Z.MobileViTV2Model, Z.MobileViTV2PreTrainedModel, Z.ModelOutput, Z.ModernBertDecoderForCausalLM, Z.ModernBertDecoderModel, Z.ModernBertDecoderPreTrainedModel, Z.ModernBertForMaskedLM, Z.ModernBertForSequenceClassification, Z.ModernBertForTokenClassification, Z.ModernBertModel, Z.ModernBertPreTrainedModel, Z.Moondream1ForConditionalGeneration, Z.MoonshineFeatureExtractor, Z.MoonshineForConditionalGeneration, Z.MoonshineModel, Z.MoonshinePreTrainedModel, Z.MoonshineProcessor, Z.MptForCausalLM, Z.MptModel, Z.MptPreTrainedModel, Z.MultiModalityCausalLM, Z.MultiModalityPreTrainedModel, Z.MusicgenForCausalLM, Z.MusicgenForConditionalGeneration, Z.MusicgenModel, Z.MusicgenPreTrainedModel, Z.NanoChatForCausalLM, Z.NanoChatModel, Z.NanoChatPreTrainedModel, Z.NeoBertForMaskedLM, Z.NeoBertForQuestionAnswering, Z.NeoBertForSequenceClassification, Z.NeoBertForTokenClassification, Z.NeoBertModel, Z.NeoBertPreTrainedModel, Z.NllbTokenizer, Z.NoBadWordsLogitsProcessor, Z.NoRepeatNGramLogitsProcessor, Z.NomicBertModel, Z.NomicBertPreTrainedModel, Z.NougatImageProcessor, Z.NougatTokenizer, Z.OPTForCausalLM, Z.OPTModel, Z.OPTPreTrainedModel, Z.ObjectDetectionPipeline, Z.Olmo2ForCausalLM, Z.Olmo2Model, Z.Olmo2PreTrainedModel, Z.OlmoForCausalLM, Z.OlmoModel, Z.OlmoPreTrainedModel, Z.OpenELMForCausalLM, Z.OpenELMModel, Z.OpenELMPreTrainedModel, Z.OwlViTFeatureExtractor, Z.OwlViTForObjectDetection, Z.OwlViTImageProcessor, Z.OwlViTModel, Z.OwlViTPreTrainedModel, Z.OwlViTProcessor, Z.Owlv2ForObjectDetection, Z.Owlv2ImageProcessor, Z.Owlv2Model, Z.Owlv2PreTrainedModel, Z.PaliGemmaForConditionalGeneration, Z.PaliGemmaPreTrainedModel, Z.PaliGemmaProcessor, Z.ParakeetFeatureExtractor, Z.ParakeetForCTC, Z.ParakeetPreTrainedModel, Z.PatchTSMixerForPrediction, Z.PatchTSMixerModel, Z.PatchTSMixerPreTrainedModel, Z.PatchTSTForPrediction, Z.PatchTSTModel, Z.PatchTSTPreTrainedModel, Z.Phi3ForCausalLM, Z.Phi3Model, Z.Phi3PreTrainedModel, Z.Phi3VForCausalLM, Z.Phi3VImageProcessor, Z.Phi3VPreTrainedModel, Z.Phi3VProcessor, Z.PhiForCausalLM, Z.PhiModel, Z.PhiPreTrainedModel, Z.Pipeline, Z.PixtralImageProcessor, Z.PixtralProcessor, Z.PreTrainedModel, Z.PreTrainedTokenizer, Z.PretrainedConfig, Z.PretrainedMixin, Z.Processor, Z.PvtForImageClassification, Z.PvtImageProcessor, Z.PvtModel, Z.PvtPreTrainedModel, Z.PyAnnoteFeatureExtractor, Z.PyAnnoteForAudioFrameClassification, Z.PyAnnoteModel, Z.PyAnnotePreTrainedModel, Z.PyAnnoteProcessor, Z.QuestionAnsweringModelOutput, Z.QuestionAnsweringPipeline, Z.Qwen2ForCausalLM, Z.Qwen2Model, Z.Qwen2PreTrainedModel, Z.Qwen2Tokenizer, Z.Qwen2VLForConditionalGeneration, Z.Qwen2VLImageProcessor, Z.Qwen2VLPreTrainedModel, Z.Qwen2VLProcessor, Z.Qwen3ForCausalLM, Z.Qwen3Model, Z.Qwen3PreTrainedModel, Z.RFDetrForObjectDetection, Z.RFDetrModel, Z.RFDetrObjectDetectionOutput, Z.RFDetrPreTrainedModel, Z.RTDetrForObjectDetection, Z.RTDetrImageProcessor, Z.RTDetrModel, Z.RTDetrObjectDetectionOutput, Z.RTDetrPreTrainedModel, Z.RTDetrV2ForObjectDetection, Z.RTDetrV2Model, Z.RTDetrV2ObjectDetectionOutput, Z.RTDetrV2PreTrainedModel, Z.RawAudio, Z.RawImage, Z.RawVideo, Z.RawVideoFrame, Z.RepetitionPenaltyLogitsProcessor, Z.ResNetForImageClassification, Z.ResNetModel, Z.ResNetPreTrainedModel, Z.RoFormerForMaskedLM, Z.RoFormerForQuestionAnswering, Z.RoFormerForSequenceClassification, Z.RoFormerForTokenClassification, Z.RoFormerModel, Z.RoFormerPreTrainedModel, Z.RoFormerTokenizer, Z.RobertaForMaskedLM, Z.RobertaForQuestionAnswering, Z.RobertaForSequenceClassification, Z.RobertaForTokenClassification, Z.RobertaModel, Z.RobertaPreTrainedModel, Z.RobertaTokenizer, Z.Sam2ImageProcessor, Z.Sam2ImageSegmentationOutput, Z.Sam2Model, Z.Sam2PreTrainedModel, Z.Sam2Processor, Z.Sam2VideoProcessor, Z.Sam3ImageProcessor, Z.Sam3TrackerModel, Z.SamImageProcessor, Z.SamImageSegmentationOutput, Z.SamModel, Z.SamPreTrainedModel, Z.SamProcessor, Z.SapiensForDepthEstimation, Z.SapiensForNormalEstimation, Z.SapiensForSemanticSegmentation, Z.SapiensPreTrainedModel, Z.SeamlessM4TFeatureExtractor, Z.SegformerFeatureExtractor, Z.SegformerForImageClassification, Z.SegformerForSemanticSegmentation, Z.SegformerImageProcessor, Z.SegformerModel, Z.SegformerPreTrainedModel, Z.Seq2SeqLMOutput, Z.SequenceClassifierOutput, Z.SiglipImageProcessor, Z.SiglipModel, Z.SiglipPreTrainedModel, Z.SiglipTextModel, Z.SiglipTokenizer, Z.SiglipVisionModel, Z.SmolLM3ForCausalLM, Z.SmolLM3Model, Z.SmolLM3PreTrainedModel, Z.SmolVLMForConditionalGeneration, Z.SmolVLMImageProcessor, Z.SmolVLMProcessor, Z.SnacDecoderModel, Z.SnacEncoderModel, Z.SnacFeatureExtractor, Z.SnacModel, Z.SnacPreTrainedModel, Z.SpeechT5FeatureExtractor, Z.SpeechT5ForSpeechToText, Z.SpeechT5ForTextToSpeech, Z.SpeechT5HifiGan, Z.SpeechT5Model, Z.SpeechT5PreTrainedModel, Z.SpeechT5Processor, Z.SpeechT5Tokenizer, Z.SqueezeBertForMaskedLM, Z.SqueezeBertForQuestionAnswering, Z.SqueezeBertForSequenceClassification, Z.SqueezeBertModel, Z.SqueezeBertPreTrainedModel, Z.SqueezeBertTokenizer, Z.StableLmForCausalLM, Z.StableLmModel, Z.StableLmPreTrainedModel, Z.Starcoder2ForCausalLM, Z.Starcoder2Model, Z.Starcoder2PreTrainedModel, Z.StoppingCriteria, Z.StoppingCriteriaList, Z.StyleTextToSpeech2Model, Z.StyleTextToSpeech2PreTrainedModel, Z.SummarizationPipeline, Z.SupertonicForConditionalGeneration, Z.SupertonicPreTrainedModel, Z.SuppressTokensAtBeginLogitsProcessor, Z.Swin2SRForImageSuperResolution, Z.Swin2SRImageProcessor, Z.Swin2SRModel, Z.Swin2SRPreTrainedModel, Z.SwinForImageClassification, Z.SwinForSemanticSegmentation, Z.SwinModel, Z.SwinPreTrainedModel, Z.T5ForConditionalGeneration, Z.T5Model, Z.T5PreTrainedModel, Z.T5Tokenizer, Z.TableTransformerForObjectDetection, Z.TableTransformerModel, Z.TableTransformerObjectDetectionOutput, Z.TableTransformerPreTrainedModel, Z.TemperatureLogitsWarper, Z.Tensor, Z.Text2TextGenerationPipeline, Z.TextClassificationPipeline, Z.TextGenerationPipeline, Z.TextStreamer, Z.TextToAudioPipeline, Z.TokenClassificationPipeline, Z.TokenClassifierOutput, Z.TokenizerModel, Z.TopKLogitsWarper, Z.TopPLogitsWarper, Z.TrOCRForCausalLM, Z.TrOCRPreTrainedModel, Z.TranslationPipeline, Z.UltravoxModel, Z.UltravoxPreTrainedModel, Z.UltravoxProcessor, Z.UniSpeechForCTC, Z.UniSpeechForSequenceClassification, Z.UniSpeechModel, Z.UniSpeechPreTrainedModel, Z.UniSpeechSatForAudioFrameClassification, Z.UniSpeechSatForCTC, Z.UniSpeechSatForSequenceClassification, Z.UniSpeechSatModel, Z.UniSpeechSatPreTrainedModel, Z.VLChatProcessor, Z.VLMImageProcessor, Z.VaultGemmaForCausalLM, Z.VaultGemmaModel, Z.VaultGemmaPreTrainedModel, Z.ViTFeatureExtractor, Z.ViTForImageClassification, Z.ViTImageProcessor, Z.ViTMAEModel, Z.ViTMAEPreTrainedModel, Z.ViTMSNForImageClassification, Z.ViTMSNModel, Z.ViTMSNPreTrainedModel, Z.ViTModel, Z.ViTPreTrainedModel, Z.VisionEncoderDecoderModel, Z.VitMatteForImageMatting, Z.VitMatteImageProcessor, Z.VitMattePreTrainedModel, Z.VitPoseForPoseEstimation, Z.VitPoseImageProcessor, Z.VitPosePreTrainedModel, Z.VitsModel, Z.VitsModelOutput, Z.VitsPreTrainedModel, Z.VitsTokenizer, Z.VoxtralForConditionalGeneration, Z.VoxtralProcessor, Z.Wav2Vec2BertForCTC, Z.Wav2Vec2BertForSequenceClassification, Z.Wav2Vec2BertModel, Z.Wav2Vec2BertPreTrainedModel, Z.Wav2Vec2CTCTokenizer, Z.Wav2Vec2FeatureExtractor, Z.Wav2Vec2ForAudioFrameClassification, Z.Wav2Vec2ForCTC, Z.Wav2Vec2ForSequenceClassification, Z.Wav2Vec2Model, Z.Wav2Vec2PreTrainedModel, Z.Wav2Vec2Processor, Z.Wav2Vec2ProcessorWithLM, Z.WavLMForAudioFrameClassification, Z.WavLMForCTC, Z.WavLMForSequenceClassification, Z.WavLMForXVector, Z.WavLMModel, Z.WavLMPreTrainedModel, Z.WeSpeakerFeatureExtractor, Z.WeSpeakerResNetModel, Z.WeSpeakerResNetPreTrainedModel, Z.WhisperFeatureExtractor, Z.WhisperForConditionalGeneration, Z.WhisperModel, Z.WhisperPreTrainedModel, Z.WhisperProcessor, Z.WhisperTextStreamer, Z.WhisperTimeStampLogitsProcessor, Z.WhisperTokenizer, Z.XLMForQuestionAnswering, Z.XLMForSequenceClassification, Z.XLMForTokenClassification, Z.XLMModel, Z.XLMPreTrainedModel, Z.XLMRobertaForMaskedLM, Z.XLMRobertaForQuestionAnswering, Z.XLMRobertaForSequenceClassification, Z.XLMRobertaForTokenClassification, Z.XLMRobertaModel, Z.XLMRobertaPreTrainedModel, Z.XLMRobertaTokenizer, Z.XLMTokenizer, Z.XLMWithLMHeadModel, Z.XVectorOutput, Z.YolosFeatureExtractor, Z.YolosForObjectDetection, Z.YolosImageProcessor, Z.YolosModel, Z.YolosObjectDetectionOutput, Z.YolosPreTrainedModel, Z.ZeroShotAudioClassificationPipeline, Z.ZeroShotClassificationPipeline, Z.ZeroShotImageClassificationPipeline, Z.ZeroShotObjectDetectionPipeline, Z.bankers_round, Z.cat, Z.cos_sim, Z.dot, Z.dynamic_time_warping;
var ln = Z.env;
Z.full, Z.full_like, Z.getCacheShapes, Z.hamming, Z.hanning, Z.interpolate, Z.interpolate_4d, Z.interpolate_data, Z.is_chinese_char, Z.layer_norm, Z.load_image, Z.load_video, Z.log_softmax, Z.magnitude, Z.matmul, Z.max, Z.mean, Z.mean_pooling, Z.medianFilter, Z.mel_filter_bank, Z.min, Z.ones, Z.ones_like, Z.permute, Z.permute_data;
var un = Z.pipeline;
//#endregion
//#region electron/services/ragSearch.ts
Z.quantize_embeddings, Z.rand, Z.randn, Z.read_audio, Z.rfft, Z.round, Z.slice, Z.softmax, Z.spectrogram, Z.stack, Z.std_mean, Z.topk, Z.window_function, Z.zeros, Z.zeros_like, ln.cacheDir = s.join(process.cwd(), ".rag-cache");
var dn = "Xenova/all-MiniLM-L6-v2", fn = null;
function pn() {
	return fn ||= un("feature-extraction", dn, { dtype: "fp32" }), fn;
}
async function mn(e) {
	let t = await (await pn())(e, {
		pooling: "mean",
		normalize: !0
	}), n = t.dims[t.dims.length - 1], r = t.data, i = [];
	for (let t = 0; t < e.length; t++) i.push(Array.from(r.slice(t * n, (t + 1) * n)));
	return i;
}
async function hn(e) {
	let t = [], n = [
		{
			dir: s.join(e, "backlog", "docs"),
			category: "doc"
		},
		{
			dir: s.join(e, "backlog", "decisions"),
			category: "decision"
		},
		{
			dir: s.join(e, "backlog", "tasks"),
			category: "task"
		}
	];
	for (let { dir: r, category: i } of n) if (u(r)) try {
		let n = await c.readdir(r);
		for (let a of n) if (a.endsWith(".md")) {
			let n = s.join(r, a);
			t.push({
				filePath: n,
				relative: s.relative(e, n),
				category: i
			});
		}
	} catch (e) {
		console.error(`Failed to scan dir ${r}:`, e);
	}
	let r = s.join(e, "README.md");
	return u(r) && t.push({
		filePath: r,
		relative: "README.md",
		category: "doc"
	}), t;
}
async function gn(e) {
	let t = e.query?.trim();
	if (!t) return [];
	let n = e.mode || "all", r = e.limit || 15, i = e.global ?? !1, a = [];
	a = i || !e.projectPath ? (await N.getProjects()).map((e) => ({
		name: s.basename(e.path),
		path: e.path
	})) : [{
		name: s.basename(e.projectPath),
		path: e.projectPath
	}];
	let o = [];
	for (let e of a) {
		let i = e.path;
		if (n === "vector" || n === "all") {
			let n = s.join(i, ".rag-index");
			if (u(n)) try {
				let a = await v(n);
				if ((await a.tableNames()).includes("docs")) {
					let n = await a.openTable("docs"), [c] = await mn([t]), l = await n.search(c).limit(r).toArray();
					for (let t of l) {
						let n = typeof t._distance == "number" ? t._distance : .5, r = Math.max(0, Math.min(1, 1 - n / 1.5)), a = t.file || "", c = "doc";
						a.includes("decisions") ? c = "decision" : a.includes("tasks") && (c = "task"), o.push({
							projectName: e.name,
							projectPath: i,
							filePath: s.join(i, a),
							fileRelative: a,
							heading: t.heading || void 0,
							snippet: t.text || "",
							score: Math.round(r * 100) / 100,
							type: "vector",
							category: c
						});
					}
				}
			} catch (e) {
				console.error(`Vector search error for ${i}:`, e);
			}
		}
		if (n === "text" || n === "all") try {
			let n = await hn(i), r = t.toLowerCase();
			for (let t of n) {
				let n = await c.readFile(t.filePath, "utf-8"), a = p(n), l = a.data?.title || s.basename(t.filePath, ".md"), u = a.content, d = l.toLowerCase().includes(r), f = u.toLowerCase().indexOf(r);
				if (d || f !== -1) {
					let n = "";
					if (f !== -1) {
						let e = Math.max(0, f - 80), t = Math.min(u.length, f + r.length + 120);
						n = (e > 0 ? "..." : "") + u.slice(e, t).trim() + (t < u.length ? "..." : "");
					} else n = u.slice(0, 160).trim() + (u.length > 160 ? "..." : "");
					o.push({
						projectName: e.name,
						projectPath: i,
						filePath: t.filePath,
						fileRelative: t.relative,
						heading: l,
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
async function _n(e) {
	let t = s.join(e, ".rag-index");
	if (!u(t)) return {
		hasIndex: !1,
		chunksCount: 0
	};
	try {
		let e = await v(t);
		if ((await e.tableNames()).includes("docs")) return {
			hasIndex: !0,
			chunksCount: await (await e.openTable("docs")).countRows(),
			lastModified: (await c.stat(t)).mtime.toISOString()
		};
	} catch (t) {
		console.error(`Failed to get RAG stats for ${e}:`, t);
	}
	return {
		hasIndex: !1,
		chunksCount: 0
	};
}
var vn = new class {
	watchers = /* @__PURE__ */ new Map();
	broadcastGitChanged(e) {
		for (let n of t.getAllWindows()) n.isDestroyed() || n.webContents.send("git:changed", { projectPath: e });
	}
	watchProjectGit(e) {
		let t = s.normalize(e);
		if (this.watchers.has(t)) return;
		let n = s.join(t, ".git");
		if (!u(n)) return;
		let r = [
			s.join(n, "HEAD"),
			s.join(n, "index"),
			s.join(n, "refs")
		], i = g.watch(r, {
			ignoreInitial: !0,
			awaitWriteFinish: {
				stabilityThreshold: 200,
				pollInterval: 50
			}
		});
		i.on("all", () => {
			this.broadcastGitChanged(t);
		}), this.watchers.set(t, i);
	}
	async getRepoDetails(e) {
		let t = s.join(e, ".git");
		if (!u(t)) return null;
		try {
			let t = m(e);
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
			let r = m(e);
			return n ? await r.checkoutLocalBranch(t) : await r.checkout(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to checkout ${t}:`, e), !1;
		}
	}
	async createBranch(e, t) {
		try {
			return await m(e).checkoutLocalBranch(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to create branch ${t}:`, e), !1;
		}
	}
	async stageFile(e, t) {
		try {
			return await m(e).add(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to stage ${t}:`, e), !1;
		}
	}
	async unstageFile(e, t) {
		try {
			return await m(e).reset(["HEAD", t]), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to unstage ${t}:`, e), !1;
		}
	}
	async stageAll(e) {
		try {
			return await m(e).add("."), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error("Failed to stage all:", e), !1;
		}
	}
	async commitChanges(e, t, n = !1) {
		try {
			let r = m(e);
			return n && await r.add("."), await r.commit(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error("Failed to commit:", e), !1;
		}
	}
	async getFileDiff(e, t, n = !1) {
		try {
			let r = m(e);
			return n ? await r.diff(["--cached", t]) : await r.diff([t]);
		} catch (e) {
			return console.error(`Failed to get diff for ${t}:`, e), "";
		}
	}
}(), yn = b(d), bn = new class {
	async runGh(e, t) {
		try {
			let { stdout: n } = await yn("gh", e, {
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
			return await yn("gh", ["--version"]), !0;
		} catch {
			return !1;
		}
	}
	async getProviderInfo(e) {
		try {
			let t = s.join(e, ".git");
			if (!u(t)) return {
				provider: "none",
				hasCli: !1,
				authenticated: !1
			};
			let n = await m(e).getRemotes(!0), r = n.find((e) => e.name === "origin") || n[0];
			if (!r || !r.refs.fetch) return {
				provider: "none",
				hasCli: !1,
				authenticated: !1
			};
			let i = r.refs.fetch, a = i.includes("github.com"), o = i.includes("gitlab.com"), c = "";
			if (a) {
				let e = i.match(/github\.com[:/](.+?)(?:\.git)?$/);
				e && (c = e[1]);
			} else if (o) {
				let e = i.match(/gitlab\.com[:/](.+?)(?:\.git)?$/);
				e && (c = e[1]);
			}
			let l = await this.isGhAvailable(), d = !1;
			if (l && a) try {
				await this.runGh(["auth", "status"], e), d = !0;
			} catch {
				d = !1;
			}
			return {
				provider: a ? "github" : o ? "gitlab" : "none",
				repo: c || void 0,
				remoteUrl: i,
				hasCli: l,
				authenticated: d
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
			let r = s.join(e, "backlog", "tasks");
			if (!u(r)) return;
			let i = (t + " " + n).match(/task-(\d+)/i);
			if (!i) return;
			let a = `task-${i[1]}`.toLowerCase(), o = await c.readdir(r);
			for (let e of o) if (e.toLowerCase().startsWith(a) && e.endsWith(".md")) {
				let t = s.join(r, e), n = await c.readFile(t, "utf-8"), i = p(n);
				if (i.data.status !== "Review" && i.data.status !== "Done") {
					i.data.status = "Review";
					let e = p.stringify(i.content, i.data);
					await c.writeFile(t, e, "utf-8");
				}
				break;
			}
		} catch (e) {
			console.error("Failed to sync Backlog task status on PR creation:", e);
		}
	}
}();
process.env.DIST = s.join(__dirname, "../dist"), process.env.VITE_PUBLIC = n.isPackaged ? process.env.DIST : s.join(__dirname, "../public");
var xn = null, Sn = process.env.VITE_DEV_SERVER_URL;
function Cn() {
	xn = new t({
		width: 1400,
		height: 900,
		minWidth: 1024,
		minHeight: 700,
		backgroundColor: "#0f1117",
		titleBarStyle: "hidden",
		titleBarOverlay: {
			color: "#0f1117",
			symbolColor: "#94a3b8",
			height: 38
		},
		webPreferences: {
			preload: s.join(__dirname, "preload.js"),
			nodeIntegration: !1,
			contextIsolation: !0
		}
	}), xn.webContents.on("did-finish-load", () => {
		xn?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
	}), Sn ? xn.loadURL(Sn) : xn.loadFile(s.join(process.env.DIST ?? s.join(__dirname, "../dist"), "index.html"));
}
n.on("window-all-closed", () => {
	process.platform !== "darwin" && (n.quit(), xn = null);
}), n.on("activate", () => {
	t.getAllWindows().length === 0 && Cn();
}), i.handle("projects:list", async () => {
	let e = await N.getProjects(), t = [];
	for (let n of e) {
		let e = await P(n.path);
		e && (e.favorite = !!n.favorite, e.addedAt = n.addedAt, t.push(e));
	}
	return t;
}), i.handle("projects:scan", async (e, t) => await F(t?.roots && t.roots.length > 0 ? t.roots : await N.getScanRoots(), t?.depth ?? 2)), i.handle("projects:add", async (e, t) => {
	let n = await P(t);
	return n ? (await N.addProject(n.path, !1), n) : null;
}), i.handle("projects:remove", async (e, t) => await N.removeProject(t)), i.handle("projects:refresh", async (e, t) => await P(t)), i.handle("projects:toggleFavorite", async (e, t) => await N.toggleFavorite(t)), i.handle("projects:getScanRoots", async () => await N.getScanRoots()), i.handle("projects:setScanRoots", async (e, t) => await N.setScanRoots(t)), i.handle("projects:getDetails", async (e, t) => await P(t)), i.handle("dialog:selectDirectory", async () => {
	if (!xn) return null;
	let e = await r.showOpenDialog(xn, {
		properties: ["openDirectory"],
		title: "Выберите папку проекта с Backlog.md или репозиторием"
	});
	return e.canceled || e.filePaths.length === 0 ? null : e.filePaths[0];
}), i.handle("system:openInExplorer", async (e, t) => {
	await a.openPath(t);
}), i.handle("system:openInCode", async (e, t) => {
	let n = process.platform === "win32" ? "code.cmd" : "code";
	f(n, [t], {
		shell: !0,
		detached: !0
	});
}), i.handle("system:openTerminal", async (e, t) => {
	process.platform === "win32" ? f("cmd.exe", [
		"/c",
		"start",
		"powershell.exe"
	], {
		cwd: t,
		shell: !0,
		detached: !0
	}) : f("open", [
		"-a",
		"Terminal",
		t
	], { detached: !0 });
}), i.handle("backlog:watchProject", async (e, t) => {
	re.watch(t, xn);
});
function wn(e) {
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
i.handle("backlog:getTasks", async (e, t) => {
	let n = s.join(t, "backlog", "tasks");
	if (!u(n)) return [];
	re.watch(t, xn);
	let r = [];
	try {
		let e = await c.readdir(n);
		for (let t of e) if (t.endsWith(".md")) {
			let e = s.join(n, t), i = await c.readFile(e, "utf-8"), a = p(i), { criteria: o, description: l } = wn(a.content);
			r.push({
				id: a.data.id || s.basename(t, ".md").split("-")[0].trim(),
				title: a.data.title || s.basename(t, ".md"),
				status: a.data.status || "To Do",
				labels: a.data.labels || [],
				created: a.data.created ? String(a.data.created) : void 0,
				filePath: e,
				content: a.content,
				description: l || a.content,
				acceptanceCriteria: o
			});
		}
	} catch (e) {
		console.error(`Error reading tasks from ${n}:`, e);
	}
	return r;
}), i.handle("backlog:updateTaskStatus", async (e, t, n) => {
	try {
		if (!u(t)) return !1;
		let e = await c.readFile(t, "utf-8"), r = p(e);
		r.data.status = n;
		let i = p.stringify(r.content, r.data);
		return await c.writeFile(t, i, "utf-8"), !0;
	} catch (e) {
		return console.error(`Failed to update status for ${t}:`, e), !1;
	}
}), i.handle("backlog:toggleCriterion", async (e, t, n, r) => {
	try {
		if (!u(t)) return !1;
		let e = await c.readFile(t, "utf-8"), i = 0, a = e.split("\n"), o = !1;
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
		return o ? (await c.writeFile(t, a.join("\n"), "utf-8"), !0) : !1;
	} catch (e) {
		return console.error(`Failed to toggle criterion in ${t}:`, e), !1;
	}
}), i.handle("backlog:saveFullTask", async (e, t, n) => {
	try {
		if (!u(t)) return !1;
		let e = await c.readFile(t, "utf-8"), r = p(e);
		r.data.title = n.title, r.data.status = n.status, r.data.labels = n.labels;
		let i = `\n# ${r.data.id || s.basename(t, ".md").split("-")[0].trim()}: ${n.title}\n\n## Description\n${n.description || "Описание задачи"}\n\n## Acceptance Criteria\n`;
		if (n.criteria && n.criteria.length > 0) for (let e of n.criteria) i += `- [${e.completed ? "x" : " "}] ${e.text}\n`;
		else i += "- [ ] Критерий 1\n";
		let a = p.stringify(i, r.data);
		return await c.writeFile(t, a, "utf-8"), !0;
	} catch (e) {
		return console.error(`Failed to save full task ${t}:`, e), !1;
	}
}), i.handle("backlog:deleteTask", async (e, t) => {
	try {
		return u(t) ? (await c.unlink(t), !0) : !1;
	} catch (e) {
		return console.error(`Failed to delete task ${t}:`, e), !1;
	}
}), i.handle("backlog:saveTask", async (e, t, n) => {
	try {
		return await c.writeFile(t, n, "utf-8"), !0;
	} catch (e) {
		return console.error(`Failed to save task ${t}:`, e), !1;
	}
}), i.handle("backlog:createTask", async (e, t, n) => {
	try {
		let e = s.join(t, "backlog", "tasks");
		u(e) || await c.mkdir(e, { recursive: !0 });
		let r = await c.readdir(e), i = 0;
		for (let e of r) {
			let t = e.match(/task-(\d+)/i);
			if (t) {
				let e = parseInt(t[1], 10);
				e > i && (i = e);
			}
		}
		let a = `task-${i + 1}`, o = `${a} - ${n.title.replace(/[\\/:*?"<>|]/g, "-").trim()}.md`, l = s.join(e, o), d = (/* @__PURE__ */ new Date()).toISOString().split("T")[0], f = {
			id: a,
			title: n.title,
			status: "To Do",
			labels: n.labels || [],
			created: d
		}, m = `\n# ${a}: ${n.title}\n\n## Description\n${n.description || "Описание задачи"}\n\n## Acceptance Criteria\n- [ ] Критерий 1\n`, h = p.stringify(m, f);
		return await c.writeFile(l, h, "utf-8"), {
			id: a,
			title: n.title,
			status: "To Do",
			labels: n.labels || [],
			created: d,
			filePath: l,
			content: m
		};
	} catch (e) {
		return console.error("Failed to create task:", e), null;
	}
}), i.handle("template:createProject", async (e, t) => await oe(t)), i.handle("template:checkAvailable", async (e, t) => await ae(t)), i.handle("process:start", async (e, t, n, r) => await se.startProcess(t, n, r)), i.handle("process:stop", async (e, t) => await se.stopProcess(t)), i.handle("process:list", async (e, t) => await se.listProcessesForProject(t)), i.handle("process:tailLog", async (e, t, n, r = 100) => await se.tailProjectLog(t, n, r)), i.handle("rag:search", async (e, t) => await gn(t)), i.handle("rag:getStats", async (e, t) => await _n(t)), i.handle("git:getLog", async (e, t, n = 30) => {
	try {
		return u(s.join(t, ".git")) ? (await m(t).log({ maxCount: n })).all.map((e) => ({
			hash: e.hash,
			date: e.date,
			message: e.message,
			author_name: e.author_name,
			author_email: e.author_email
		})) : [];
	} catch (e) {
		return console.error(`Git log error for ${t}:`, e), [];
	}
}), i.handle("git:getStatus", async (e, t) => {
	try {
		return u(s.join(t, ".git")) ? await m(t).status() : null;
	} catch (e) {
		return console.error(`Git status error for ${t}:`, e), null;
	}
}), i.handle("git:getRepoDetails", async (e, t) => await vn.getRepoDetails(t)), i.handle("git:checkout", async (e, t, n, r = !1) => await vn.checkoutBranch(t, n, r)), i.handle("git:createBranch", async (e, t, n) => await vn.createBranch(t, n)), i.handle("git:stageFile", async (e, t, n) => await vn.stageFile(t, n)), i.handle("git:unstageFile", async (e, t, n) => await vn.unstageFile(t, n)), i.handle("git:stageAll", async (e, t) => await vn.stageAll(t)), i.handle("git:commit", async (e, t, n, r = !1) => await vn.commitChanges(t, n, r)), i.handle("git:getFileDiff", async (e, t, n, r = !1) => await vn.getFileDiff(t, n, r)), i.handle("pr:getProviderInfo", async (e, t) => await bn.getProviderInfo(t)), i.handle("pr:list", async (e, t, n) => await bn.listPullRequests(t, n)), i.handle("pr:create", async (e, t, n) => await bn.createPullRequest(t, n)), i.handle("pr:getDiff", async (e, t, n) => await bn.getPRDiff(t, n)), i.handle("system:getPlatform", async () => process.platform), n.on("before-quit", () => {
	se.cleanupAll();
}), n.whenReady().then(Cn);
//#endregion
export {};
