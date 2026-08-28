import { BrowserWindow as e, app as t, dialog as n, ipcMain as r, shell as i } from "electron";
import a from "node:path";
import o from "node:fs/promises";
import { existsSync as s } from "node:fs";
import { spawn as c } from "node:child_process";
import l from "gray-matter";
import { simpleGit as u } from "simple-git";
import d from "node:os";
//#region electron/services/projectRegistry.ts
var f = {
	version: 1,
	scanRoots: (process.platform === "win32" ? [
		"F:\\",
		"D:\\",
		a.join(d.homedir(), "Projects")
	] : [a.join(d.homedir(), "Projects"), a.join(d.homedir(), "Developer")]).filter((e) => s(e)),
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
}, p = new class {
	configPath;
	cachedConfig = null;
	constructor() {
		let e = d.homedir(), t = a.join(e, ".projecthub");
		this.configPath = a.join(t, "projects.json");
	}
	async ensureConfigFile() {
		try {
			let e = a.dirname(this.configPath);
			return s(e) || await o.mkdir(e, { recursive: !0 }), s(this.configPath) || await o.writeFile(this.configPath, JSON.stringify(f, null, 2), "utf-8"), this.configPath;
		} catch {
			let e = t ? t.getPath("userData") : a.join(d.tmpdir(), ".projecthub");
			return s(e) || await o.mkdir(e, { recursive: !0 }), this.configPath = a.join(e, "projects.json"), s(this.configPath) || await o.writeFile(this.configPath, JSON.stringify(f, null, 2), "utf-8"), this.configPath;
		}
	}
	async getConfig() {
		if (this.cachedConfig) return this.cachedConfig;
		await this.ensureConfigFile();
		try {
			let e = await o.readFile(this.configPath, "utf-8"), t = JSON.parse(e);
			return this.cachedConfig = {
				...f,
				...t,
				projects: t.projects || [],
				scanRoots: t.scanRoots || f.scanRoots,
				settings: {
					...f.settings,
					...t.settings
				}
			}, this.cachedConfig;
		} catch (e) {
			return console.error("Failed to parse projects.json, restoring default config:", e), this.cachedConfig = f, await this.saveConfig(this.cachedConfig), this.cachedConfig;
		}
	}
	async saveConfig(e) {
		this.cachedConfig = e, await this.ensureConfigFile();
		try {
			await o.writeFile(this.configPath, JSON.stringify(e, null, 2), "utf-8");
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
}(), m = /* @__PURE__ */ new Set([
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
async function h(e) {
	try {
		let t = a.normalize(e);
		if (!s(t) || !(await o.stat(t)).isDirectory()) return null;
		let n = s(a.join(t, "backlog")), r = s(a.join(t, "infra.config.json")), i = s(a.join(t, ".git")), c = s(a.join(t, "package.json"));
		if (!n && !r && !(i && c)) return null;
		let d = a.basename(t), f, m, h;
		if (r) try {
			let e = await o.readFile(a.join(t, "infra.config.json"), "utf-8");
			h = JSON.parse(e).features;
		} catch {}
		if (c) try {
			let e = await o.readFile(a.join(t, "package.json"), "utf-8"), n = JSON.parse(e);
			n.name && (d = n.name), n.description && (f = n.description), n.version && (m = n.version);
		} catch {}
		if (n && s(a.join(t, "backlog", "config.yml"))) try {
			let e = (await o.readFile(a.join(t, "backlog", "config.yml"), "utf-8")).match(/project_name:\s*["']?([^"'\r\n]+)["']?/);
			e && e[1] && (d = e[1].trim());
		} catch {}
		let g = {
			total: 0,
			todo: 0,
			inProgress: 0,
			review: 0,
			done: 0
		};
		if (n && s(a.join(t, "backlog", "tasks"))) try {
			let e = await o.readdir(a.join(t, "backlog", "tasks"));
			for (let n of e) if (n.endsWith(".md")) {
				g.total++;
				try {
					let e = await o.readFile(a.join(t, "backlog", "tasks", n), "utf-8"), { data: r } = l(e), i = r.status || "To Do";
					i === "To Do" ? g.todo++ : i === "In Progress" ? g.inProgress++ : i === "Review" ? g.review++ : i === "Done" && g.done++;
				} catch {
					g.todo++;
				}
			}
		} catch {}
		let _, v, y = 0, b = 0, x = 0, S;
		if (i) try {
			let e = u(t), n = await e.status();
			_ = n.current || "detached", v = n.isClean(), y = n.files.length, b = n.ahead || 0, x = n.behind || 0;
			let r = await e.log({ maxCount: 1 });
			r.latest && (S = {
				hash: r.latest.hash,
				message: r.latest.message,
				date: r.latest.date,
				author: r.latest.author_name
			});
		} catch {}
		let C, w = a.join(t, ".rag-index", "meta.json");
		if (s(w)) try {
			let e = await o.readFile(w, "utf-8"), t = JSON.parse(e);
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
		else (s(a.join(t, "scripts", "rag")) || h && h.docsRag) && (C = { ready: !1 });
		let T = {
			runningCount: 0,
			processes: []
		}, E = a.join(t, ".env-state", "processes.json");
		if (s(E)) try {
			let e = await o.readFile(E, "utf-8"), t = JSON.parse(e), n = [];
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
		let D = await p.isFavorite(t);
		return {
			name: d,
			path: t,
			description: f,
			version: m,
			favorite: D,
			hasBacklog: n,
			hasInfraConfig: r,
			hasGit: i,
			gitBranch: _,
			gitClean: v,
			gitAhead: b,
			gitBehind: x,
			uncommittedCount: y,
			lastCommit: S,
			taskCounts: g,
			ragStatus: C,
			processStatus: T,
			features: h,
			lastScannedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	} catch (t) {
		return console.error(`Error inspecting project at ${e}:`, t), null;
	}
}
async function g(e, t = 2) {
	let n = /* @__PURE__ */ new Map();
	async function r(e, i) {
		if (!(i > t)) try {
			if (!s(e) || !(await o.stat(e)).isDirectory()) return;
			let t = await h(e);
			if (t && (n.set(a.normalize(t.path).toLowerCase(), t), i > 0)) return;
			let c = await o.readdir(e, { withFileTypes: !0 });
			for (let t of c) if (t.isDirectory()) {
				let n = t.name.toLowerCase();
				if (m.has(n) || n.startsWith(".")) continue;
				await r(a.join(e, t.name), i + 1);
			}
		} catch {}
	}
	for (let t of e) await r(a.normalize(t), 0);
	for (let e of n.values()) await p.addProject(e.path, !!e.favorite);
	return Array.from(n.values());
}
process.env.DIST = a.join(__dirname, "../dist"), process.env.VITE_PUBLIC = t.isPackaged ? process.env.DIST : a.join(__dirname, "../public");
var _ = null, v = process.env.VITE_DEV_SERVER_URL;
function y() {
	_ = new e({
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
			preload: a.join(__dirname, "preload.js"),
			nodeIntegration: !1,
			contextIsolation: !0
		}
	}), _.webContents.on("did-finish-load", () => {
		_?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
	}), v ? _.loadURL(v) : _.loadFile(a.join(process.env.DIST ?? a.join(__dirname, "../dist"), "index.html"));
}
t.on("window-all-closed", () => {
	process.platform !== "darwin" && (t.quit(), _ = null);
}), t.on("activate", () => {
	e.getAllWindows().length === 0 && y();
}), r.handle("projects:list", async () => {
	let e = await p.getProjects(), t = [];
	for (let n of e) {
		let e = await h(n.path);
		e && (e.favorite = !!n.favorite, e.addedAt = n.addedAt, t.push(e));
	}
	return t;
}), r.handle("projects:scan", async (e, t) => await g(t?.roots && t.roots.length > 0 ? t.roots : await p.getScanRoots(), t?.depth ?? 2)), r.handle("projects:add", async (e, t) => {
	let n = await h(t);
	return n ? (await p.addProject(n.path, !1), n) : null;
}), r.handle("projects:remove", async (e, t) => await p.removeProject(t)), r.handle("projects:refresh", async (e, t) => await h(t)), r.handle("projects:toggleFavorite", async (e, t) => await p.toggleFavorite(t)), r.handle("projects:getScanRoots", async () => await p.getScanRoots()), r.handle("projects:setScanRoots", async (e, t) => await p.setScanRoots(t)), r.handle("projects:getDetails", async (e, t) => await h(t)), r.handle("dialog:selectDirectory", async () => {
	if (!_) return null;
	let e = await n.showOpenDialog(_, {
		properties: ["openDirectory"],
		title: "Выберите папку проекта с Backlog.md или репозиторием"
	});
	return e.canceled || e.filePaths.length === 0 ? null : e.filePaths[0];
}), r.handle("system:openInExplorer", async (e, t) => {
	await i.openPath(t);
}), r.handle("system:openInCode", async (e, t) => {
	let n = process.platform === "win32" ? "code.cmd" : "code";
	c(n, [t], {
		shell: !0,
		detached: !0
	});
}), r.handle("system:openTerminal", async (e, t) => {
	process.platform === "win32" ? c("cmd.exe", [
		"/c",
		"start",
		"powershell.exe"
	], {
		cwd: t,
		shell: !0,
		detached: !0
	}) : c("open", [
		"-a",
		"Terminal",
		t
	], { detached: !0 });
}), r.handle("backlog:getTasks", async (e, t) => {
	let n = a.join(t, "backlog", "tasks");
	if (!s(n)) return [];
	let r = [];
	try {
		let e = await o.readdir(n);
		for (let t of e) if (t.endsWith(".md")) {
			let e = a.join(n, t), i = await o.readFile(e, "utf-8"), s = l(i);
			r.push({
				id: s.data.id || a.basename(t, ".md").split("-")[0].trim(),
				title: s.data.title || a.basename(t, ".md"),
				status: s.data.status || "To Do",
				labels: s.data.labels || [],
				created: s.data.created ? String(s.data.created) : void 0,
				filePath: e,
				content: s.content
			});
		}
	} catch (e) {
		console.error(`Error reading tasks from ${n}:`, e);
	}
	return r;
}), r.handle("backlog:updateTaskStatus", async (e, t, n) => {
	try {
		if (!s(t)) return !1;
		let e = await o.readFile(t, "utf-8"), r = l(e);
		r.data.status = n;
		let i = l.stringify(r.content, r.data);
		return await o.writeFile(t, i, "utf-8"), !0;
	} catch (e) {
		return console.error(`Failed to update status for ${t}:`, e), !1;
	}
}), r.handle("backlog:saveTask", async (e, t, n) => {
	try {
		return await o.writeFile(t, n, "utf-8"), !0;
	} catch (e) {
		return console.error(`Failed to save task ${t}:`, e), !1;
	}
}), r.handle("backlog:createTask", async (e, t, n) => {
	try {
		let e = a.join(t, "backlog", "tasks");
		s(e) || await o.mkdir(e, { recursive: !0 });
		let r = await o.readdir(e), i = 0;
		for (let e of r) {
			let t = e.match(/task-(\d+)/i);
			if (t) {
				let e = parseInt(t[1], 10);
				e > i && (i = e);
			}
		}
		let c = `task-${i + 1}`, u = `${c} - ${n.title.replace(/[\\/:*?"<>|]/g, "-").trim()}.md`, d = a.join(e, u), f = (/* @__PURE__ */ new Date()).toISOString().split("T")[0], p = {
			id: c,
			title: n.title,
			status: "To Do",
			labels: n.labels || [],
			created: f
		}, m = `\n# ${c}: ${n.title}\n\n## Description\n${n.description || "Описание задачи"}\n\n## Acceptance Criteria\n- [ ] Критерий 1\n`, h = l.stringify(m, p);
		return await o.writeFile(d, h, "utf-8"), {
			id: c,
			title: n.title,
			status: "To Do",
			labels: n.labels || [],
			created: f,
			filePath: d,
			content: m
		};
	} catch (e) {
		return console.error("Failed to create task:", e), null;
	}
}), r.handle("git:getLog", async (e, t, n = 30) => {
	try {
		return s(a.join(t, ".git")) ? (await u(t).log({ maxCount: n })).all.map((e) => ({
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
		return s(a.join(t, ".git")) ? await u(t).status() : null;
	} catch (e) {
		return console.error(`Git status error for ${t}:`, e), null;
	}
}), r.handle("system:getPlatform", async () => process.platform), t.whenReady().then(y);
//#endregion
export {};
