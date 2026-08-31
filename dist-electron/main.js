import { BrowserWindow as e, app as t, dialog as n, ipcMain as r, shell as i } from "electron";
import a from "node:path";
import { fileURLToPath as o } from "node:url";
import s from "node:fs/promises";
import { existsSync as c } from "node:fs";
import { execFile as l, spawn as u } from "node:child_process";
import d from "gray-matter";
import { simpleGit as f } from "simple-git";
import p from "node:os";
import m from "chokidar";
import h from "tree-kill";
import { promisify as g } from "node:util";
//#region electron/services/projectRegistry.ts
var _ = {
	version: 1,
	scanRoots: (process.platform === "win32" ? [
		"F:\\",
		"D:\\",
		a.join(p.homedir(), "Projects")
	] : [a.join(p.homedir(), "Projects"), a.join(p.homedir(), "Developer")]).filter((e) => c(e)),
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
}, v = new class {
	configPath;
	cachedConfig = null;
	constructor() {
		let e = p.homedir(), t = a.join(e, ".projecthub");
		this.configPath = a.join(t, "projects.json");
	}
	async ensureConfigFile() {
		try {
			let e = a.dirname(this.configPath);
			return c(e) || await s.mkdir(e, { recursive: !0 }), c(this.configPath) || await s.writeFile(this.configPath, JSON.stringify(_, null, 2), "utf-8"), this.configPath;
		} catch {
			let e = t ? t.getPath("userData") : a.join(p.tmpdir(), ".projecthub");
			return c(e) || await s.mkdir(e, { recursive: !0 }), this.configPath = a.join(e, "projects.json"), c(this.configPath) || await s.writeFile(this.configPath, JSON.stringify(_, null, 2), "utf-8"), this.configPath;
		}
	}
	async getConfig() {
		if (this.cachedConfig) return this.cachedConfig;
		await this.ensureConfigFile();
		try {
			let e = await s.readFile(this.configPath, "utf-8"), t = JSON.parse(e);
			return this.cachedConfig = {
				..._,
				...t,
				projects: t.projects || [],
				scanRoots: t.scanRoots || _.scanRoots,
				settings: {
					..._.settings,
					...t.settings
				}
			}, this.cachedConfig;
		} catch (e) {
			return console.error("Failed to parse projects.json, restoring default config:", e), this.cachedConfig = _, await this.saveConfig(this.cachedConfig), this.cachedConfig;
		}
	}
	async saveConfig(e) {
		this.cachedConfig = e, await this.ensureConfigFile();
		try {
			await s.writeFile(this.configPath, JSON.stringify(e, null, 2), "utf-8");
		} catch (e) {
			console.error("Failed to save project registry:", e);
		}
	}
	async getScanRoots() {
		return (await this.getConfig()).scanRoots;
	}
	async setScanRoots(e) {
		let t = await this.getConfig();
		return t.scanRoots = Array.from(new Set(e.map((e) => a.normalize(e)))), await this.saveConfig(t), !0;
	}
	async getProjects() {
		return (await this.getConfig()).projects;
	}
	async addProject(e, t = !1) {
		let n = a.normalize(e), r = await this.getConfig(), i = r.projects.findIndex((e) => a.normalize(e.path).toLowerCase() === n.toLowerCase());
		return i >= 0 ? r.projects[i].favorite = t || r.projects[i].favorite : r.projects.unshift({
			path: n,
			addedAt: (/* @__PURE__ */ new Date()).toISOString(),
			favorite: t,
			tags: []
		}), await this.saveConfig(r), !0;
	}
	async removeProject(e) {
		let t = a.normalize(e).toLowerCase(), n = await this.getConfig(), r = n.projects.length;
		return n.projects = n.projects.filter((e) => a.normalize(e.path).toLowerCase() !== t), n.projects.length !== r && (await this.saveConfig(n), !0);
	}
	async toggleFavorite(e) {
		let t = a.normalize(e).toLowerCase(), n = await this.getConfig(), r = n.projects.find((e) => a.normalize(e.path).toLowerCase() === t);
		return r ? (r.favorite = !r.favorite, await this.saveConfig(n), r.favorite) : !1;
	}
	async isFavorite(e) {
		let t = a.normalize(e).toLowerCase();
		return !!(await this.getConfig()).projects.find((e) => a.normalize(e.path).toLowerCase() === t)?.favorite;
	}
}(), y = /* @__PURE__ */ new Set([
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
async function b(e) {
	try {
		let t = a.normalize(e);
		if (!c(t) || !(await s.stat(t)).isDirectory()) return null;
		let n = c(a.join(t, "backlog")), r = c(a.join(t, "infra.config.json")), i = c(a.join(t, ".git")), o = c(a.join(t, "package.json"));
		if (!n && !r && !(i && o)) return null;
		let l = a.basename(t), u, p, m;
		if (r) try {
			let e = await s.readFile(a.join(t, "infra.config.json"), "utf-8");
			m = JSON.parse(e).features;
		} catch {}
		if (o) try {
			let e = await s.readFile(a.join(t, "package.json"), "utf-8"), n = JSON.parse(e);
			n.name && (l = n.name), n.description && (u = n.description), n.version && (p = n.version);
		} catch {}
		if (n && c(a.join(t, "backlog", "config.yml"))) try {
			let e = (await s.readFile(a.join(t, "backlog", "config.yml"), "utf-8")).match(/project_name:\s*["']?([^"'\r\n]+)["']?/);
			e && e[1] && (l = e[1].trim());
		} catch {}
		let h = {
			total: 0,
			todo: 0,
			inProgress: 0,
			review: 0,
			done: 0
		};
		if (n && c(a.join(t, "backlog", "tasks"))) try {
			let e = await s.readdir(a.join(t, "backlog", "tasks"));
			for (let n of e) if (n.endsWith(".md")) {
				h.total++;
				try {
					let e = await s.readFile(a.join(t, "backlog", "tasks", n), "utf-8"), { data: r } = d(e), i = r.status || "To Do";
					i === "To Do" ? h.todo++ : i === "In Progress" ? h.inProgress++ : i === "Review" ? h.review++ : i === "Done" && h.done++;
				} catch {
					h.todo++;
				}
			}
		} catch {}
		let g, _, y = 0, b = 0, x = 0, S;
		if (i) try {
			let e = f(t), n = await e.status();
			g = n.current || "detached", _ = n.isClean(), y = n.files.length, b = n.ahead || 0, x = n.behind || 0;
			let r = await e.log({ maxCount: 1 });
			r.latest && (S = {
				hash: r.latest.hash,
				message: r.latest.message,
				date: r.latest.date,
				author: r.latest.author_name
			});
		} catch {}
		let C, w = a.join(t, ".rag-index", "meta.json");
		if (c(w)) try {
			let e = await s.readFile(w, "utf-8"), t = JSON.parse(e);
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
		else (c(a.join(t, "scripts", "rag")) || m && m.docsRag) && (C = { ready: !1 });
		let T = {
			runningCount: 0,
			processes: []
		}, E = a.join(t, ".env-state", "processes.json");
		if (c(E)) try {
			let e = await s.readFile(E, "utf-8"), t = JSON.parse(e), n = [];
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
		let D = await v.isFavorite(t);
		return {
			name: l,
			path: t,
			description: u,
			version: p,
			favorite: D,
			hasBacklog: n,
			hasInfraConfig: r,
			hasGit: i,
			gitBranch: g,
			gitClean: _,
			gitAhead: b,
			gitBehind: x,
			uncommittedCount: y,
			lastCommit: S,
			taskCounts: h,
			ragStatus: C,
			processStatus: T,
			features: m,
			lastScannedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	} catch (t) {
		return console.error(`Error inspecting project at ${e}:`, t), null;
	}
}
async function x(e, t = 2) {
	let n = /* @__PURE__ */ new Map();
	async function r(e, i) {
		if (!(i > t)) try {
			if (!c(e) || !(await s.stat(e)).isDirectory()) return;
			let t = await b(e);
			if (t && (n.set(a.normalize(t.path).toLowerCase(), t), i > 0)) return;
			let o = await s.readdir(e, { withFileTypes: !0 });
			for (let t of o) if (t.isDirectory()) {
				let n = t.name.toLowerCase();
				if (y.has(n) || n.startsWith(".")) continue;
				await r(a.join(e, t.name), i + 1);
			}
		} catch {}
	}
	for (let t of e) await r(a.normalize(t), 0);
	for (let e of n.values()) await v.addProject(e.path, !!e.favorite);
	return Array.from(n.values());
}
var S = new class {
	watcher = null;
	currentPath = null;
	debounceTimer = null;
	watch(e, t) {
		if (this.currentPath === e && this.watcher) return;
		this.unwatch();
		let n = a.join(e, "backlog", "tasks");
		if (!c(n)) return;
		this.currentPath = e, this.watcher = m.watch(n, {
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
}(), C = "F:\\ProjectTemplate", w = /* @__PURE__ */ new Set([
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
async function T(e, t) {
	await s.mkdir(t, { recursive: !0 });
	let n = await s.readdir(e, { withFileTypes: !0 });
	for (let r of n) {
		let n = a.join(e, r.name), i = a.join(t, r.name), o = r.name.toLowerCase();
		w.has(o) || (r.isDirectory() ? await T(n, i) : r.isFile() && await s.copyFile(n, i));
	}
}
async function E(e) {
	let t = e || C;
	return {
		available: c(t),
		path: t
	};
}
async function D(e) {
	let t = e.templateSource || C;
	if (!c(t)) throw Error(`Директория шаблона не найдена: ${t}`);
	let n = a.normalize(e.targetDir);
	if (c(n)) {
		if ((await s.readdir(n)).length > 0) throw Error(`Целевая директория уже существует и не пуста: ${n}`);
	} else await s.mkdir(n, { recursive: !0 });
	await T(t, n);
	let r = a.join(n, "package.json");
	if (c(r)) try {
		let t = await s.readFile(r, "utf-8"), n = JSON.parse(t);
		n.name = e.name.toLowerCase().replace(/[^a-z0-9-_]/g, "-"), n.version = "0.1.0", n.description = `Проект ${e.name} на базе ProjectTemplate`, await s.writeFile(r, JSON.stringify(n, null, 2), "utf-8");
	} catch (e) {
		console.error("Failed to parametrize package.json:", e);
	}
	let i = a.join(n, "infra.config.json");
	if (c(i)) try {
		let t = await s.readFile(i, "utf-8"), n = JSON.parse(t);
		n.projectRoot = ".", n.features = {
			...n.features,
			...e.features
		}, await s.writeFile(i, JSON.stringify(n, null, 2), "utf-8");
	} catch (e) {
		console.error("Failed to parametrize infra.config.json:", e);
	}
	let o = a.join(n, "backlog", "config.yml");
	if (c(o)) try {
		let t = await s.readFile(o, "utf-8");
		t = t.replace(/project_name:\s*["']?([^"'\r\n]+)["']?/, `project_name: "${e.name}"`), await s.writeFile(o, t, "utf-8");
	} catch (e) {
		console.error("Failed to parametrize backlog/config.yml:", e);
	}
	if (e.initGit) try {
		await f(n).init();
	} catch (e) {
		console.error("Failed to init git:", e);
	}
	let l = a.join(n, "scripts", "setup.mjs");
	if (c(l)) try {
		await new Promise((e) => {
			let t = u(process.execPath, [l], {
				cwd: n,
				shell: !0
			});
			t.on("close", () => e()), t.on("error", () => e());
		});
	} catch (e) {
		console.error("Setup script execution warning:", e);
	}
	await v.addProject(n, !0);
	let d = await b(n);
	if (!d) throw Error("Не удалось проинспектировать созданный проект.");
	return d;
}
var O = new class {
	activeProcesses = /* @__PURE__ */ new Map();
	broadcastLog(t, n) {
		for (let r of e.getAllWindows()) r.isDestroyed() || r.webContents.send("process:logChunk", {
			processId: t,
			text: n
		});
	}
	broadcastStatus(t) {
		for (let n of e.getAllWindows()) n.isDestroyed() || n.webContents.send("process:statusChanged", t);
	}
	async startProcess(e, t, n) {
		let r = `${a.normalize(e)}::${n}`;
		if (this.activeProcesses.has(r)) {
			let e = this.activeProcesses.get(r);
			if (e.info.status === "running") return e.info;
		}
		let i = process.platform === "win32", o = u(i ? "powershell.exe" : "/bin/sh", i ? [
			"-NoProfile",
			"-Command",
			t
		] : ["-c", t], {
			cwd: e,
			env: {
				...process.env,
				FORCE_COLOR: "1"
			}
		}), s = {
			id: r,
			name: n,
			command: t,
			cwd: e,
			pid: o.pid,
			startedAt: (/* @__PURE__ */ new Date()).toISOString(),
			status: "running",
			source: "hub"
		}, c = {
			info: s,
			child: o,
			logBuffer: []
		};
		this.activeProcesses.set(r, c);
		let l = (e) => {
			let t = e.toString();
			c.logBuffer.push(t), c.logBuffer.length > 2e3 && c.logBuffer.shift(), this.broadcastLog(r, t);
		};
		return o.stdout.on("data", l), o.stderr.on("data", l), o.on("close", (e) => {
			s.status = e === 0 ? "stopped" : "failed", s.exitCode = e ?? void 0, this.broadcastStatus(s), this.broadcastLog(r, `\r\n[Process exited with code ${e}]\r\n`);
		}), o.on("error", (e) => {
			s.status = "failed", this.broadcastStatus(s), this.broadcastLog(r, `\r\n[Process error: ${e.message}]\r\n`);
		}), this.broadcastStatus(s), s;
	}
	async stopProcess(e) {
		let t = this.activeProcesses.get(e);
		return t ? !t.info.pid || new Promise((n) => {
			h(t.info.pid, "SIGKILL", (r) => {
				r ? (console.error(`Failed to kill process tree for ${e}:`, r), n(!1)) : (t.info.status = "stopped", this.broadcastStatus(t.info), n(!0));
			});
		}) : !1;
	}
	getLogs(e) {
		return this.activeProcesses.get(e)?.logBuffer || [];
	}
	async listProcessesForProject(e) {
		let t = a.normalize(e), n = [];
		for (let [e, r] of this.activeProcesses.entries()) a.normalize(r.info.cwd) === t && n.push(r.info);
		let r = a.join(t, ".env-state", "processes.json");
		if (c(r)) try {
			let e = await s.readFile(r, "utf-8"), i = JSON.parse(e);
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
		let r = `${a.normalize(e)}::${t}`, i = this.activeProcesses.get(r);
		if (i && i.logBuffer.length > 0) return i.logBuffer.slice(-n).join("");
		let o = a.join(e, ".env-state", "logs", `${t}.log`);
		if (c(o)) try {
			let e = await s.readFile(o, "utf-8");
			return e.charCodeAt(0) === 65279 && (e = e.slice(1)), e.split("\n").slice(-n).join("\n");
		} catch (e) {
			console.error(`Failed to tail log ${o}:`, e);
		}
		return "";
	}
	cleanupAll() {
		for (let [e, t] of this.activeProcesses.entries()) if (t.info.pid && t.info.status === "running") try {
			h(t.info.pid, "SIGKILL");
		} catch (t) {
			console.error(`Cleanup kill failed for ${e}:`, t);
		}
	}
}(), ee = "Xenova/all-MiniLM-L6-v2", k = null, A = null, j = null;
async function M() {
	if (!A) try {
		A = await import("@lancedb/lancedb");
	} catch (e) {
		return console.warn("[RAG] LanceDB native module not available, fallback to fulltext search:", e), null;
	}
	return A;
}
async function N() {
	if (!j) try {
		j = await import("./transformers.node-BXgGVZFl.js"), j.env && (j.env.cacheDir = a.join(process.cwd(), ".rag-cache"));
	} catch (e) {
		return console.warn("[RAG] Transformers not available:", e), null;
	}
	return j;
}
async function P() {
	if (!k) {
		let e = await N();
		if (!e) return null;
		k = e.pipeline("feature-extraction", ee, { dtype: "fp32" });
	}
	return k;
}
async function F(e) {
	try {
		let t = await P();
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
async function I(e) {
	let t = [], n = [
		{
			dir: a.join(e, "backlog", "docs"),
			category: "doc"
		},
		{
			dir: a.join(e, "backlog", "decisions"),
			category: "decision"
		},
		{
			dir: a.join(e, "backlog", "tasks"),
			category: "task"
		}
	];
	for (let { dir: r, category: i } of n) if (c(r)) try {
		let n = await s.readdir(r);
		for (let o of n) if (o.endsWith(".md")) {
			let n = a.join(r, o);
			t.push({
				filePath: n,
				relative: a.relative(e, n),
				category: i
			});
		}
	} catch (e) {
		console.error(`Failed to scan dir ${r}:`, e);
	}
	let r = a.join(e, "README.md");
	return c(r) && t.push({
		filePath: r,
		relative: "README.md",
		category: "doc"
	}), t;
}
async function L(e) {
	let t = e.query?.trim();
	if (!t) return [];
	let n = e.mode || "all", r = e.limit || 15, i = e.global ?? !1, o = [];
	o = i || !e.projectPath ? (await v.getProjects()).map((e) => ({
		name: a.basename(e.path),
		path: e.path
	})) : [{
		name: a.basename(e.projectPath),
		path: e.projectPath
	}];
	let l = [];
	for (let e of o) {
		let i = e.path;
		if (n === "vector" || n === "all") {
			let n = a.join(i, ".rag-index");
			if (c(n)) try {
				let o = await M();
				if (o) {
					let s = await o.connect(n);
					if ((await s.tableNames()).includes("docs")) {
						let n = await s.openTable("docs"), o = await F([t]);
						if (o && o[0]) {
							let t = await n.search(o[0]).limit(r).toArray();
							for (let n of t) {
								let t = typeof n._distance == "number" ? n._distance : .5, r = Math.max(0, Math.min(1, 1 - t / 1.5)), o = n.file || "", s = "doc";
								o.includes("decisions") ? s = "decision" : o.includes("tasks") && (s = "task"), l.push({
									projectName: e.name,
									projectPath: i,
									filePath: a.join(i, o),
									fileRelative: o,
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
			let n = await I(i), r = t.toLowerCase();
			for (let t of n) {
				let n = await s.readFile(t.filePath, "utf-8"), o = d(n), c = o.data?.title || a.basename(t.filePath, ".md"), u = o.content, f = c.toLowerCase().includes(r), p = u.toLowerCase().indexOf(r);
				if (f || p !== -1) {
					let n = "";
					if (p !== -1) {
						let e = Math.max(0, p - 80), t = Math.min(u.length, p + r.length + 120);
						n = (e > 0 ? "..." : "") + u.slice(e, t).trim() + (t < u.length ? "..." : "");
					} else n = u.slice(0, 160).trim() + (u.length > 160 ? "..." : "");
					l.push({
						projectName: e.name,
						projectPath: i,
						filePath: t.filePath,
						fileRelative: t.relative,
						heading: c,
						snippet: n.replace(/\n+/g, " "),
						score: f ? .95 : .75,
						type: "text",
						category: t.category
					});
				}
			}
		} catch (e) {
			console.error(`Text search error for ${i}:`, e);
		}
	}
	return l.sort((e, t) => t.score - e.score), l.slice(0, r);
}
async function R(e) {
	let t = a.join(e, ".rag-index");
	if (!c(t)) return {
		hasIndex: !1,
		chunksCount: 0
	};
	try {
		let e = await M();
		if (e) {
			let n = await e.connect(t);
			if ((await n.tableNames()).includes("docs")) return {
				hasIndex: !0,
				chunksCount: await (await n.openTable("docs")).countRows(),
				lastModified: (await s.stat(t)).mtime.toISOString()
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
var z = new class {
	watchers = /* @__PURE__ */ new Map();
	broadcastGitChanged(t) {
		for (let n of e.getAllWindows()) n.isDestroyed() || n.webContents.send("git:changed", { projectPath: t });
	}
	watchProjectGit(e) {
		let t = a.normalize(e);
		if (this.watchers.has(t)) return;
		let n = a.join(t, ".git");
		if (!c(n)) return;
		let r = [
			a.join(n, "HEAD"),
			a.join(n, "index"),
			a.join(n, "refs")
		], i = m.watch(r, {
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
		let t = a.join(e, ".git");
		if (!c(t)) return null;
		try {
			let t = f(e);
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
			let p = i.all.map((e) => ({
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
				commits: p,
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
			let r = f(e);
			return n ? await r.checkoutLocalBranch(t) : await r.checkout(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to checkout ${t}:`, e), !1;
		}
	}
	async createBranch(e, t) {
		try {
			return await f(e).checkoutLocalBranch(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to create branch ${t}:`, e), !1;
		}
	}
	async stageFile(e, t) {
		try {
			return await f(e).add(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to stage ${t}:`, e), !1;
		}
	}
	async unstageFile(e, t) {
		try {
			return await f(e).reset(["HEAD", t]), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error(`Failed to unstage ${t}:`, e), !1;
		}
	}
	async stageAll(e) {
		try {
			return await f(e).add("."), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error("Failed to stage all:", e), !1;
		}
	}
	async commitChanges(e, t, n = !1) {
		try {
			let r = f(e);
			return n && await r.add("."), await r.commit(t), this.broadcastGitChanged(e), !0;
		} catch (e) {
			return console.error("Failed to commit:", e), !1;
		}
	}
	async getFileDiff(e, t, n = !1) {
		try {
			let r = f(e);
			return n ? await r.diff(["--cached", t]) : await r.diff([t]);
		} catch (e) {
			return console.error(`Failed to get diff for ${t}:`, e), "";
		}
	}
}(), B = g(l), V = new class {
	async runGh(e, t) {
		try {
			let { stdout: n } = await B("gh", e, {
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
			return await B("gh", ["--version"]), !0;
		} catch {
			return !1;
		}
	}
	async getProviderInfo(e) {
		try {
			let t = a.join(e, ".git");
			if (!c(t)) return {
				provider: "none",
				hasCli: !1,
				authenticated: !1
			};
			let n = await f(e).getRemotes(!0), r = n.find((e) => e.name === "origin") || n[0];
			if (!r || !r.refs.fetch) return {
				provider: "none",
				hasCli: !1,
				authenticated: !1
			};
			let i = r.refs.fetch, o = i.includes("github.com"), s = i.includes("gitlab.com"), l = "";
			if (o) {
				let e = i.match(/github\.com[:/](.+?)(?:\.git)?$/);
				e && (l = e[1]);
			} else if (s) {
				let e = i.match(/gitlab\.com[:/](.+?)(?:\.git)?$/);
				e && (l = e[1]);
			}
			let u = await this.isGhAvailable(), d = !1;
			if (u && o) try {
				await this.runGh(["auth", "status"], e), d = !0;
			} catch {
				d = !1;
			}
			return {
				provider: o ? "github" : s ? "gitlab" : "none",
				repo: l || void 0,
				remoteUrl: i,
				hasCli: u,
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
			let r = a.join(e, "backlog", "tasks");
			if (!c(r)) return;
			let i = (t + " " + n).match(/task-(\d+)/i);
			if (!i) return;
			let o = `task-${i[1]}`.toLowerCase(), l = await s.readdir(r);
			for (let e of l) if (e.toLowerCase().startsWith(o) && e.endsWith(".md")) {
				let t = a.join(r, e), n = await s.readFile(t, "utf-8"), i = d(n);
				if (i.data.status !== "Review" && i.data.status !== "Done") {
					i.data.status = "Review";
					let e = d.stringify(i.content, i.data);
					await s.writeFile(t, e, "utf-8");
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
function H(e) {
	return e.toLowerCase().trim().replace(/[^\w\sа-яё\-]/gi, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
}
async function U(e) {
	let t = [], n = a.normalize(e), r = a.join(n, "backlog", "decisions");
	if (c(r)) try {
		let e = await s.readdir(r);
		for (let i of e) if (i.endsWith(".md")) {
			let e = a.join(r, i), o = await s.stat(e), c = await s.readFile(e, "utf-8"), { data: l, content: u } = d(c), f = l.title;
			if (!f) {
				let e = u.match(/^#\s+(.+)$/m);
				f = e ? e[1].trim() : i.replace(/\.md$/, "");
			}
			t.push({
				id: `decision-${i}`,
				title: f,
				category: "decision",
				filePath: e,
				fileRelative: a.relative(n, e).replace(/\\/g, "/"),
				tags: Array.isArray(l.tags) ? l.tags : [],
				status: l.status || "Accepted",
				date: l.date ? String(l.date) : void 0,
				updatedAt: o.mtime.toISOString(),
				size: o.size
			});
		}
	} catch (e) {
		console.error("Error scanning decisions:", e);
	}
	let i = a.join(n, "backlog", "docs");
	if (c(i)) {
		async function e(r) {
			try {
				let i = await s.readdir(r, { withFileTypes: !0 });
				for (let o of i) {
					let i = a.join(r, o.name);
					if (o.isDirectory()) await e(i);
					else if (o.isFile() && o.name.endsWith(".md")) {
						let e = await s.stat(i), r = await s.readFile(i, "utf-8"), { data: c, content: l } = d(r), u = c.title;
						if (!u) {
							let e = l.match(/^#\s+(.+)$/m);
							u = e ? e[1].trim() : o.name.replace(/\.md$/, "");
						}
						t.push({
							id: `doc-${o.name}`,
							title: u,
							category: "doc",
							filePath: i,
							fileRelative: a.relative(n, i).replace(/\\/g, "/"),
							tags: Array.isArray(c.tags) ? c.tags : [],
							status: c.status,
							date: c.date ? String(c.date) : void 0,
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
async function W(e) {
	let t = a.normalize(e);
	if (!c(t)) throw Error(`Файл не найден: ${t}`);
	return await s.readFile(t, "utf-8");
}
async function G(e, t) {
	let n = a.normalize(e), r = a.dirname(n);
	return c(r) || await s.mkdir(r, { recursive: !0 }), await s.writeFile(n, t, "utf-8"), !0;
}
async function K(e, t) {
	let n = a.normalize(e), r = t.type || "doc", i = t.title.trim(), o = H(i), c, l, u = t.content;
	if (r === "decision") {
		c = a.join(n, "backlog", "decisions"), await s.mkdir(c, { recursive: !0 });
		let e = 1;
		try {
			let t = await s.readdir(c);
			for (let n of t) {
				let t = n.match(/^(\d{4})/);
				if (t) {
					let n = parseInt(t[1], 10);
					n >= e && (e = n + 1);
				}
			}
		} catch {}
		let r = String(e).padStart(4, "0");
		if (l = `${r}-${o}.md`, !u) {
			let e = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
			u = `---
title: "${i}"
tags: ${t.tags && t.tags.length > 0 ? JSON.stringify(t.tags) : JSON.stringify([
				"adr",
				"decision",
				o
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
	} else if (c = a.join(n, "backlog", "docs"), await s.mkdir(c, { recursive: !0 }), l = `${o}.md`, !u) {
		let e = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
		u = `---
title: "${i}"
tags: ${t.tags && t.tags.length > 0 ? JSON.stringify(t.tags) : JSON.stringify(["documentation", o])}
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
	let d = a.join(c, l);
	await s.writeFile(d, u, "utf-8");
	let f = await s.stat(d);
	return {
		id: `${r}-${l}`,
		title: i,
		category: r,
		filePath: d,
		fileRelative: a.relative(n, d).replace(/\\/g, "/"),
		tags: t.tags || [],
		status: t.status || (r === "decision" ? "Accepted" : void 0),
		date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
		updatedAt: f.mtime.toISOString(),
		size: f.size
	};
}
//#endregion
//#region electron/services/milestoneService.ts
function q(e) {
	return e.toLowerCase().trim().replace(/[^\w\sа-яё\-]/gi, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "") || "milestone";
}
async function J(e) {
	let t = [], n = a.normalize(e), r = a.join(n, "backlog", "milestones"), i = a.join(n, "backlog", "tasks"), o = /* @__PURE__ */ new Map();
	if (c(i)) try {
		let e = await s.readdir(i);
		for (let t of e) if (t.endsWith(".md")) {
			let e = await s.readFile(a.join(i, t), "utf-8"), n = d(e), r = n.data.milestone || n.data.milestone_id, c = n.data.status || "To Do";
			if (r) {
				let e = String(r).trim().toLowerCase();
				o.has(e) || o.set(e, {
					total: 0,
					done: 0,
					inProgress: 0,
					review: 0,
					todo: 0
				});
				let t = o.get(e);
				t.total++, c === "Done" ? t.done++ : c === "In Progress" ? t.inProgress++ : c === "Review" ? t.review++ : t.todo++;
			}
		}
	} catch (e) {
		console.error("Error scanning tasks for milestones:", e);
	}
	if (c(r)) try {
		let e = await s.readdir(r);
		for (let n of e) if (n.endsWith(".md")) {
			let e = a.join(r, n), i = await s.readFile(e, "utf-8"), { data: c, content: l } = d(i), u = c.id || n.replace(/\.md$/, "").split("-")[0].trim(), f = c.title || n.replace(/\.md$/, ""), p = c.status || "Planning", m = c.target_date || c.targetDate || c.due_date || void 0, h = c.description || l.trim(), g = u.toLowerCase(), _ = f.toLowerCase(), v = o.get(g) || o.get(_) || {
				total: 0,
				done: 0,
				inProgress: 0,
				review: 0,
				todo: 0
			};
			t.push({
				id: u,
				title: f,
				description: h,
				targetDate: m ? String(m) : void 0,
				status: p,
				filePath: e,
				taskCounts: v
			});
		}
	} catch (e) {
		console.error("Error reading milestones directory:", e);
	}
	return t;
}
async function Y(e, t) {
	let n = a.normalize(e), r = a.join(n, "backlog", "milestones");
	await s.mkdir(r, { recursive: !0 });
	let i = t.title.trim(), o = q(i), c = 1;
	try {
		let e = await s.readdir(r);
		for (let t of e) {
			let e = t.match(/milestone-(\d+)/i);
			if (e) {
				let t = parseInt(e[1], 10);
				t >= c && (c = t + 1);
			}
		}
	} catch {}
	let l = `milestone-${c}`, u = `${l} - ${o}.md`, f = a.join(r, u), p = {
		id: l,
		title: i,
		status: t.status || "Planning",
		created_date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
	};
	t.targetDate && (p.target_date = t.targetDate), t.description && (p.description = t.description);
	let m = `\n# ${i}\n\n${t.description || "Описание майлстоуна"}\n`, h = d.stringify(m, p);
	return await s.writeFile(f, h, "utf-8"), {
		id: l,
		title: i,
		description: t.description,
		targetDate: t.targetDate,
		status: t.status || "Planning",
		filePath: f,
		taskCounts: {
			total: 0,
			done: 0,
			inProgress: 0,
			review: 0,
			todo: 0
		}
	};
}
async function te(e, t) {
	let n = a.normalize(e);
	if (!c(n)) return !1;
	let r = await s.readFile(n, "utf-8"), i = d(r);
	t.title && (i.data.title = t.title), t.status && (i.data.status = t.status), t.targetDate !== void 0 && (i.data.target_date = t.targetDate), t.description !== void 0 && (i.data.description = t.description);
	let o = d.stringify(i.content, i.data);
	return await s.writeFile(n, o, "utf-8"), !0;
}
async function ne(e) {
	let t = a.normalize(e);
	return c(t) ? (await s.unlink(t), !0) : !1;
}
//#endregion
//#region electron/main.ts
var re = o(import.meta.url), X = a.dirname(re);
process.env.DIST = a.join(X, "../dist"), process.env.VITE_PUBLIC = t.isPackaged ? process.env.DIST : a.join(X, "../public");
var Z = null, Q = process.env.VITE_DEV_SERVER_URL;
function $() {
	let t = a.join(X, "../dist"), n = a.join(t, "index.html"), r = a.join(X, "preload.cjs"), i = a.join(X, "preload.js"), o = c(r) ? r : i, s = a.join(X, "../public/icon.png"), l = a.join(X, "../build/icon.png"), u = c(s) ? s : l;
	Z = new e({
		title: "ProjectHub — Панель управления проектами",
		icon: u,
		width: 1400,
		height: 900,
		minWidth: 1024,
		minHeight: 700,
		backgroundColor: "#0f1117",
		autoHideMenuBar: !0,
		webPreferences: {
			preload: o,
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
	}), Q ? Z.loadURL(Q) : Z.loadFile(n);
}
t.on("window-all-closed", () => {
	process.platform !== "darwin" && (t.quit(), Z = null);
}), t.on("activate", () => {
	e.getAllWindows().length === 0 && $();
}), r.handle("projects:list", async () => {
	let e = await v.getProjects(), t = [];
	for (let n of e) {
		let e = await b(n.path);
		e && (e.favorite = !!n.favorite, e.addedAt = n.addedAt, t.push(e));
	}
	return t;
}), r.handle("projects:scan", async (e, t) => await x(t?.roots && t.roots.length > 0 ? t.roots : await v.getScanRoots(), t?.depth ?? 2)), r.handle("projects:add", async (e, t) => {
	let n = await b(t);
	return n ? (await v.addProject(n.path, !1), n) : null;
}), r.handle("projects:remove", async (e, t) => await v.removeProject(t)), r.handle("projects:refresh", async (e, t) => await b(t)), r.handle("projects:toggleFavorite", async (e, t) => await v.toggleFavorite(t)), r.handle("projects:getScanRoots", async () => await v.getScanRoots()), r.handle("projects:setScanRoots", async (e, t) => await v.setScanRoots(t)), r.handle("projects:getDetails", async (e, t) => await b(t)), r.handle("dialog:selectDirectory", async () => {
	if (!Z) return null;
	let e = await n.showOpenDialog(Z, {
		properties: ["openDirectory"],
		title: "Выберите папку проекта с Backlog.md или репозиторием"
	});
	return e.canceled || e.filePaths.length === 0 ? null : e.filePaths[0];
}), r.handle("system:openInExplorer", async (e, t) => {
	await i.openPath(t);
}), r.handle("system:openInCode", async (e, t) => {
	let n = process.platform === "win32" ? "code.cmd" : "code";
	u(n, [t], {
		shell: !0,
		detached: !0
	});
}), r.handle("system:openTerminal", async (e, t) => {
	process.platform === "win32" ? u("cmd.exe", [
		"/c",
		"start",
		"powershell.exe"
	], {
		cwd: t,
		shell: !0,
		detached: !0
	}) : u("open", [
		"-a",
		"Terminal",
		t
	], { detached: !0 });
}), r.handle("backlog:watchProject", async (e, t) => {
	S.watch(t, Z);
});
function ie(e) {
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
r.handle("backlog:getTasks", async (e, t) => {
	let n = a.join(t, "backlog", "tasks");
	if (!c(n)) return [];
	S.watch(t, Z);
	let r = [];
	try {
		let e = await s.readdir(n);
		for (let t of e) if (t.endsWith(".md")) {
			let e = a.join(n, t), i = await s.readFile(e, "utf-8"), o = d(i), { criteria: c, description: l } = ie(o.content);
			r.push({
				id: o.data.id || a.basename(t, ".md").split("-")[0].trim(),
				title: o.data.title || a.basename(t, ".md"),
				status: o.data.status || "To Do",
				labels: o.data.labels || [],
				milestone: o.data.milestone || o.data.milestone_id || void 0,
				created: o.data.created ? String(o.data.created) : void 0,
				filePath: e,
				content: o.content,
				description: l || o.content,
				acceptanceCriteria: c
			});
		}
	} catch (e) {
		console.error(`Error reading tasks from ${n}:`, e);
	}
	return r;
}), r.handle("backlog:updateTaskStatus", async (e, t, n) => {
	try {
		if (!c(t)) return !1;
		let e = await s.readFile(t, "utf-8"), r = d(e);
		r.data.status = n;
		let i = d.stringify(r.content, r.data);
		return await s.writeFile(t, i, "utf-8"), !0;
	} catch (e) {
		return console.error(`Failed to update status for ${t}:`, e), !1;
	}
}), r.handle("backlog:toggleCriterion", async (e, t, n, r) => {
	try {
		if (!c(t)) return !1;
		let e = await s.readFile(t, "utf-8"), i = 0, a = e.split("\n"), o = !1;
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
		return o ? (await s.writeFile(t, a.join("\n"), "utf-8"), !0) : !1;
	} catch (e) {
		return console.error(`Failed to toggle criterion in ${t}:`, e), !1;
	}
}), r.handle("backlog:saveFullTask", async (e, t, n) => {
	try {
		if (!c(t)) return !1;
		let e = await s.readFile(t, "utf-8"), r = d(e);
		r.data.title = n.title, r.data.status = n.status, r.data.labels = n.labels, n.milestone ? r.data.milestone = n.milestone : (delete r.data.milestone, delete r.data.milestone_id);
		let i = `\n# ${r.data.id || a.basename(t, ".md").split("-")[0].trim()}: ${n.title}\n\n## Description\n${n.description || "Описание задачи"}\n\n## Acceptance Criteria\n`;
		if (n.criteria && n.criteria.length > 0) for (let e of n.criteria) i += `- [${e.completed ? "x" : " "}] ${e.text}\n`;
		else i += "- [ ] Критерий 1\n";
		let o = d.stringify(i, r.data);
		return await s.writeFile(t, o, "utf-8"), !0;
	} catch (e) {
		return console.error(`Failed to save full task ${t}:`, e), !1;
	}
}), r.handle("backlog:deleteTask", async (e, t) => {
	try {
		return c(t) ? (await s.unlink(t), !0) : !1;
	} catch (e) {
		return console.error(`Failed to delete task ${t}:`, e), !1;
	}
}), r.handle("backlog:saveTask", async (e, t, n) => {
	try {
		return await s.writeFile(t, n, "utf-8"), !0;
	} catch (e) {
		return console.error(`Failed to save task ${t}:`, e), !1;
	}
}), r.handle("backlog:createTask", async (e, t, n) => {
	try {
		let e = a.join(t, "backlog", "tasks");
		c(e) || await s.mkdir(e, { recursive: !0 });
		let r = await s.readdir(e), i = 0;
		for (let e of r) {
			let t = e.match(/task-(\d+)/i);
			if (t) {
				let e = parseInt(t[1], 10);
				e > i && (i = e);
			}
		}
		let o = `task-${i + 1}`, l = `${o} - ${n.title.replace(/[\\/:*?"<>|]/g, "-").trim()}.md`, u = a.join(e, l), f = (/* @__PURE__ */ new Date()).toISOString().split("T")[0], p = {
			id: o,
			title: n.title,
			status: "To Do",
			labels: n.labels || [],
			created: f
		}, m = `\n# ${o}: ${n.title}\n\n## Description\n${n.description || "Описание задачи"}\n\n## Acceptance Criteria\n- [ ] Критерий 1\n`, h = d.stringify(m, p);
		return await s.writeFile(u, h, "utf-8"), {
			id: o,
			title: n.title,
			status: "To Do",
			labels: n.labels || [],
			created: f,
			filePath: u,
			content: m
		};
	} catch (e) {
		return console.error("Failed to create task:", e), null;
	}
}), r.handle("template:createProject", async (e, t) => await D(t)), r.handle("template:checkAvailable", async (e, t) => await E(t)), r.handle("process:start", async (e, t, n, r) => await O.startProcess(t, n, r)), r.handle("process:stop", async (e, t) => await O.stopProcess(t)), r.handle("process:list", async (e, t) => await O.listProcessesForProject(t)), r.handle("process:tailLog", async (e, t, n, r = 100) => await O.tailProjectLog(t, n, r)), r.handle("rag:search", async (e, t) => await L(t)), r.handle("rag:getStats", async (e, t) => await R(t)), r.handle("git:getLog", async (e, t, n = 30) => {
	try {
		return c(a.join(t, ".git")) ? (await f(t).log({ maxCount: n })).all.map((e) => ({
			hash: e.hash,
			date: e.date,
			message: e.message,
			author_name: e.author_name,
			author_email: e.author_email
		})) : [];
	} catch (e) {
		return console.error(`Git log error for ${t}:`, e), [];
	}
}), r.handle("git:getStatus", async (e, t) => {
	try {
		return c(a.join(t, ".git")) ? await f(t).status() : null;
	} catch (e) {
		return console.error(`Git status error for ${t}:`, e), null;
	}
}), r.handle("git:getRepoDetails", async (e, t) => await z.getRepoDetails(t)), r.handle("git:checkout", async (e, t, n, r = !1) => await z.checkoutBranch(t, n, r)), r.handle("git:createBranch", async (e, t, n) => await z.createBranch(t, n)), r.handle("git:stageFile", async (e, t, n) => await z.stageFile(t, n)), r.handle("git:unstageFile", async (e, t, n) => await z.unstageFile(t, n)), r.handle("git:stageAll", async (e, t) => await z.stageAll(t)), r.handle("git:commit", async (e, t, n, r = !1) => await z.commitChanges(t, n, r)), r.handle("git:getFileDiff", async (e, t, n, r = !1) => await z.getFileDiff(t, n, r)), r.handle("pr:getProviderInfo", async (e, t) => await V.getProviderInfo(t)), r.handle("pr:list", async (e, t, n) => await V.listPullRequests(t, n)), r.handle("pr:create", async (e, t, n) => await V.createPullRequest(t, n)), r.handle("pr:getDiff", async (e, t, n) => await V.getPRDiff(t, n)), r.handle("docs:list", async (e, t) => await U(t)), r.handle("docs:read", async (e, t) => await W(t)), r.handle("docs:save", async (e, t, n) => await G(t, n)), r.handle("docs:create", async (e, t, n) => await K(t, n)), r.handle("milestones:list", async (e, t) => await J(t)), r.handle("milestones:create", async (e, t, n) => await Y(t, n)), r.handle("milestones:save", async (e, t, n) => await te(t, n)), r.handle("milestones:delete", async (e, t) => await ne(t)), r.handle("system:getPlatform", async () => process.platform), t.on("before-quit", () => {
	O.cleanupAll();
}), t.whenReady().then($);
//#endregion
export {};
