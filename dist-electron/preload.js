import { contextBridge as e, ipcRenderer as t } from "electron";
//#region electron/preload.ts
e.exposeInMainWorld("api", {
	listProjects: () => t.invoke("projects:list"),
	scanProjects: (e) => t.invoke("projects:scan", e),
	addProject: (e) => t.invoke("projects:add", e),
	removeProject: (e) => t.invoke("projects:remove", e),
	refreshProject: (e) => t.invoke("projects:refresh", e),
	toggleFavorite: (e) => t.invoke("projects:toggleFavorite", e),
	getScanRoots: () => t.invoke("projects:getScanRoots"),
	setScanRoots: (e) => t.invoke("projects:setScanRoots", e),
	getProjectDetails: (e) => t.invoke("projects:getDetails", e),
	listDocs: (e) => t.invoke("docs:list", e),
	readDoc: (e) => t.invoke("docs:read", e),
	saveDoc: (e, n) => t.invoke("docs:save", e, n),
	createDoc: (e, n) => t.invoke("docs:create", e, n),
	createProjectFromTemplate: (e) => t.invoke("template:createProject", e),
	checkTemplateAvailable: (e) => t.invoke("template:checkAvailable", e),
	startProcess: (e, n, r) => t.invoke("process:start", e, n, r),
	stopProcess: (e) => t.invoke("process:stop", e),
	listProcesses: (e) => t.invoke("process:list", e),
	tailProcessLog: (e, n, r) => t.invoke("process:tailLog", e, n, r),
	onProcessLogChunk: (e) => {
		let n = (t, n) => e(n);
		return t.on("process:logChunk", n), () => {
			t.removeListener("process:logChunk", n);
		};
	},
	onProcessStatusChanged: (e) => {
		let n = (t, n) => e(n);
		return t.on("process:statusChanged", n), () => {
			t.removeListener("process:statusChanged", n);
		};
	},
	searchDocs: (e) => t.invoke("rag:search", e),
	getRagStats: (e) => t.invoke("rag:getStats", e),
	selectDirectory: () => t.invoke("dialog:selectDirectory"),
	openInExplorer: (e) => t.invoke("system:openInExplorer", e),
	openInCode: (e) => t.invoke("system:openInCode", e),
	openTerminal: (e) => t.invoke("system:openTerminal", e),
	getTasks: (e) => t.invoke("backlog:getTasks", e),
	updateTaskStatus: (e, n) => t.invoke("backlog:updateTaskStatus", e, n),
	saveTask: (e, n) => t.invoke("backlog:saveTask", e, n),
	saveFullTask: (e, n) => t.invoke("backlog:saveFullTask", e, n),
	toggleCriterion: (e, n, r) => t.invoke("backlog:toggleCriterion", e, n, r),
	createTask: (e, n) => t.invoke("backlog:createTask", e, n),
	deleteTask: (e) => t.invoke("backlog:deleteTask", e),
	watchProjectTasks: (e) => t.invoke("backlog:watchProject", e),
	onTasksChanged: (e) => {
		let n = (t, n) => e(n);
		return t.on("backlog:tasksChanged", n), () => {
			t.removeListener("backlog:tasksChanged", n);
		};
	},
	getGitLog: (e, n) => t.invoke("git:getLog", e, n),
	getGitStatus: (e) => t.invoke("git:getStatus", e),
	getGitRepoDetails: (e) => t.invoke("git:getRepoDetails", e),
	checkoutBranch: (e, n, r) => t.invoke("git:checkout", e, n, r),
	createBranch: (e, n) => t.invoke("git:createBranch", e, n),
	stageFile: (e, n) => t.invoke("git:stageFile", e, n),
	unstageFile: (e, n) => t.invoke("git:unstageFile", e, n),
	stageAll: (e) => t.invoke("git:stageAll", e),
	commitChanges: (e, n, r) => t.invoke("git:commit", e, n, r),
	getFileDiff: (e, n, r) => t.invoke("git:getFileDiff", e, n, r),
	onGitChanged: (e) => {
		let n = (t, n) => e(n);
		return t.on("git:changed", n), () => {
			t.removeListener("git:changed", n);
		};
	},
	getPRProviderInfo: (e) => t.invoke("pr:getProviderInfo", e),
	listPullRequests: (e, n) => t.invoke("pr:list", e, n),
	createPullRequest: (e, n) => t.invoke("pr:create", e, n),
	getPRDiff: (e, n) => t.invoke("pr:getDiff", e, n),
	getPlatform: () => t.invoke("system:getPlatform")
});
//#endregion
export {};
