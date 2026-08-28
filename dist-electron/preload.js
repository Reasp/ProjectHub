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
	selectDirectory: () => t.invoke("dialog:selectDirectory"),
	openInExplorer: (e) => t.invoke("system:openInExplorer", e),
	openInCode: (e) => t.invoke("system:openInCode", e),
	openTerminal: (e) => t.invoke("system:openTerminal", e),
	getTasks: (e) => t.invoke("backlog:getTasks", e),
	updateTaskStatus: (e, n) => t.invoke("backlog:updateTaskStatus", e, n),
	saveTask: (e, n) => t.invoke("backlog:saveTask", e, n),
	createTask: (e, n) => t.invoke("backlog:createTask", e, n),
	getGitLog: (e, n) => t.invoke("git:getLog", e, n),
	getGitStatus: (e) => t.invoke("git:getStatus", e),
	getPlatform: () => t.invoke("system:getPlatform")
});
//#endregion
export {};
