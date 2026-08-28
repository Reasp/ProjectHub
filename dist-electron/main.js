import { BrowserWindow as e, app as t, dialog as n, ipcMain as r, shell as i } from "electron";
import a from "node:path";
import o from "node:fs/promises";
import { existsSync as s } from "node:fs";
import { spawn as c } from "node:child_process";
import l from "gray-matter";
import { simpleGit as u } from "simple-git";
process.env.DIST = a.join(__dirname, "../dist"), process.env.VITE_PUBLIC = t.isPackaged ? process.env.DIST : a.join(__dirname, "../public");
var d = null, f = process.env.VITE_DEV_SERVER_URL;
function p() {
	d = new e({
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
	}), d.webContents.on("did-finish-load", () => {
		d?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
	}), f ? d.loadURL(f) : d.loadFile(a.join(process.env.DIST ?? a.join(__dirname, "../dist"), "index.html"));
}
t.on("window-all-closed", () => {
	process.platform !== "darwin" && (t.quit(), d = null);
}), t.on("activate", () => {
	e.getAllWindows().length === 0 && p();
});
async function m(e) {
	try {
		let t = s(a.join(e, "backlog")), n = s(a.join(e, "infra.config.json")), r = s(a.join(e, ".git"));
		if (!t && !n && !r) return null;
		let i = a.basename(e), c;
		if (n) try {
			let t = await o.readFile(a.join(e, "infra.config.json"), "utf-8");
			c = JSON.parse(t).features;
		} catch {}
		if (t && s(a.join(e, "backlog", "config.yml"))) try {
			let t = (await o.readFile(a.join(e, "backlog", "config.yml"), "utf-8")).match(/project_name:\s*["']?([^"'\r\n]+)["']?/);
			t && t[1] && (i = t[1]);
		} catch {}
		let d = {
			total: 0,
			todo: 0,
			inProgress: 0,
			review: 0,
			done: 0
		};
		if (t && s(a.join(e, "backlog", "tasks"))) try {
			let t = await o.readdir(a.join(e, "backlog", "tasks"));
			for (let n of t) if (n.endsWith(".md")) {
				d.total++;
				try {
					let t = await o.readFile(a.join(e, "backlog", "tasks", n), "utf-8"), { data: r } = l(t), i = r.status || "To Do";
					i === "To Do" ? d.todo++ : i === "In Progress" ? d.inProgress++ : i === "Review" ? d.review++ : i === "Done" && d.done++;
				} catch {
					d.todo++;
				}
			}
		} catch {}
		let f, p = !0, m = 0;
		if (r) try {
			let t = await u(e).status();
			f = t.current || "unknown", p = t.isClean(), m = t.files.length;
		} catch {}
		return {
			name: i,
			path: e,
			hasBacklog: t,
			hasInfraConfig: n,
			hasGit: r,
			gitBranch: f,
			gitClean: p,
			uncommittedCount: m,
			taskCounts: d,
			features: c
		};
	} catch (t) {
		return console.error(`Error inspecting ${e}:`, t), null;
	}
}
r.handle("projects:scan", async (e, t) => {
	let n = t && t.length > 0 ? t : [
		"F:\\",
		"D:\\",
		process.cwd()
	], r = [];
	for (let e of n) try {
		if (!s(e) || !(await o.stat(e)).isDirectory()) continue;
		let t = await m(e);
		t && r.push(t);
		let n = await o.readdir(e, { withFileTypes: !0 });
		for (let t of n) if (t.isDirectory() && !t.name.startsWith(".") && t.name !== "node_modules" && t.name !== "$RECYCLE.BIN" && t.name !== "System Volume Information") {
			let n = await m(a.join(e, t.name));
			n && r.push(n);
		}
	} catch (t) {
		console.error(`Failed to scan root: ${e}`, t);
	}
	let i = /* @__PURE__ */ new Map();
	for (let e of r) i.set(a.normalize(e.path).toLowerCase(), e);
	return Array.from(i.values());
}), r.handle("projects:getDetails", async (e, t) => m(t)), r.handle("dialog:selectDirectory", async () => {
	if (!d) return null;
	let e = await n.showOpenDialog(d, { properties: ["openDirectory"] });
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
}), r.handle("system:getPlatform", async () => process.platform), t.whenReady().then(p);
//#endregion
export {};
