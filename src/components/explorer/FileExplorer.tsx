import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder,
  FolderOpen,
  File,
  FileCode,
  FileText,
  FileJson,
  Image,
  Plus,
  RefreshCw,
  FolderPlus,
  Search,
  ChevronRight,
  ChevronDown,
  Save,
  Trash2,
  ExternalLink,
  RotateCcw,
  FileDiff,
  Code2,
  Check,
  AlertCircle
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { useDialog } from '../../hooks/useDialog';
import { useTimeoutState } from '../../hooks/useTimeoutState';
import type { FileTreeNode } from '../../types/electron';
import { SplitDiffViewer } from '../git/SplitDiffViewer';

// ─── File Icon Helper ──────────────────────────────────────────────────────────

const getFileIcon = (fileName: string, isDirectory: boolean, isOpen = false) => {
  if (isDirectory) {
    return isOpen ? (
      <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
    ) : (
      <Folder className="w-4 h-4 text-amber-400 shrink-0" />
    );
  }

  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return <FileCode className="w-4 h-4 text-cyan-400 shrink-0" />;
    case 'js':
    case 'jsx':
    case 'mjs':
      return <FileCode className="w-4 h-4 text-yellow-400 shrink-0" />;
    case 'json':
      return <FileJson className="w-4 h-4 text-emerald-400 shrink-0" />;
    case 'md':
      return <FileText className="w-4 h-4 text-indigo-400 shrink-0" />;
    case 'css':
    case 'scss':
      return <FileCode className="w-4 h-4 text-pink-400 shrink-0" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
    case 'ico':
      return <Image className="w-4 h-4 text-purple-400 shrink-0" />;
    default:
      return <File className="w-4 h-4 text-slate-400 shrink-0" />;
  }
};

// ─── Git Status Map Helper ───────────────────────────────────────────────────

interface GitStatusInfo {
  status: 'M' | 'A' | 'D' | 'R' | '?';
  staged: boolean;
}

const statusBadgeStyles: Record<string, string> = {
  M: 'text-amber-400 bg-amber-950/60 border-amber-700/50',
  A: 'text-emerald-400 bg-emerald-950/60 border-emerald-700/50',
  D: 'text-rose-400 bg-rose-950/60 border-rose-700/50',
  R: 'text-purple-400 bg-purple-950/60 border-purple-700/50',
  '?': 'text-cyan-400 bg-cyan-950/60 border-cyan-700/50'
};

export const FileExplorer: React.FC = () => {
  const { t } = useTranslation();
  const dialog = useDialog();
  const { selectedProject, gitRepoDetails, gitDiscardFileChanges, loadGitRepoDetails, workspaceRoot } = useProjectStore();
  // Проводник и редактор открывают файлы активного рабочего дерева (TASK-62, decision-15).
  const rootPath = workspaceRoot || selectedProject?.path || '';

  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['src', 'electron', 'backlog', 'scripts']));
  const [searchQuery, setSearchQuery] = useState('');

  // Selected file & Editor
  const [selectedFile, setSelectedFile] = useState<FileTreeNode | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [fileDiff, setFileDiff] = useState<string>('');
  const [activePaneTab, setActivePaneTab] = useState<'editor' | 'diff'>('editor');
  const [isSaving, setIsSaving] = useState(false);
  // Индикатор сохранения гаснет сам; таймер снимается при размонтировании (TASK-50)
  const [saveSuccess, showSaveSuccess] = useTimeoutState(false, 2000);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // New Item Modal
  const [showNewModal, setShowNewModal] = useState<{ isDir: boolean; parentRel: string } | null>(null);
  const [newItemName, setNewItemName] = useState('');

  // Build Git Map: normalized relative path -> GitStatusInfo
  const gitMap = useMemo(() => {
    const map = new Map<string, GitStatusInfo>();
    if (!gitRepoDetails?.files) return map;

    for (const f of gitRepoDetails.files) {
      const norm = f.path.replace(/\\/g, '/');
      const st = f.staged ? (f.index in statusBadgeStyles ? f.index : 'A') : (f.working_dir in statusBadgeStyles ? f.working_dir : '?');
      map.set(norm, {
        status: st as any,
        staged: Boolean(f.staged)
      });
    }
    return map;
  }, [gitRepoDetails?.files]);

  // Count changed files in a directory subtree
  const countChangedChildren = (node: FileTreeNode): number => {
    if (!node.isDirectory) {
      return gitMap.has(node.relativePath) ? 1 : 0;
    }
    let count = 0;
    if (node.children) {
      for (const child of node.children) {
        count += countChangedChildren(child);
      }
    }
    return count;
  };

  const loadTree = async () => {
    if (!selectedProject || !window.api) return;
    setIsLoading(true);
    try {
      const nodes = await window.api.readDirectoryTree(rootPath, '', 6);
      setTree(nodes);
    } catch (e: any) {
      console.error('Failed to load file tree:', e);
      setErrorMsg(t.explorer.loadTreeError);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTree();
    setSelectedFile(null);
    setFileContent('');
    setFileDiff('');
  }, [rootPath]);

  const toggleExpand = (relPath: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };

  const handleSelectFile = async (node: FileTreeNode) => {
    if (node.isDirectory || !selectedProject || !window.api) return;
    setSelectedFile(node);
    try {
      const content = await window.api.readFileContent(rootPath, node.relativePath);
      setFileContent(content);
      setOriginalContent(content);

      // Check if git diff exists
      if (gitMap.has(node.relativePath)) {
        const diff = await window.api.getFileDiff(rootPath, node.relativePath, false);
        setFileDiff(diff);
        if (diff) {
          setActivePaneTab('editor');
        }
      } else {
        setFileDiff('');
        setActivePaneTab('editor');
      }
    } catch (e: any) {
      console.error('Failed to read file:', e);
      setErrorMsg(t.explorer.readFileError.replace('{file}', node.name));
    }
  };

  const handleSave = async () => {
    if (!selectedFile || !selectedProject || !window.api) return;
    setIsSaving(true);
    try {
      await window.api.saveFileContent(rootPath, selectedFile.relativePath, fileContent);
      setOriginalContent(fileContent);
      showSaveSuccess(true);

      // Refresh git & diff
      if (loadGitRepoDetails) await loadGitRepoDetails(selectedProject);
      const diff = await window.api.getFileDiff(rootPath, selectedFile.relativePath, false);
      setFileDiff(diff);
    } catch (e: any) {
      console.error('Failed to save file:', e);
      setErrorMsg(t.explorer.saveError.replace('{error}', e?.message || String(e)));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscardChanges = async () => {
    if (!selectedFile || !selectedProject || !window.api) return;
    const confirmed = await dialog.confirm({
      message: t.explorer.confirmDiscard.replace('{file}', selectedFile.relativePath),
      danger: true
    });
    if (confirmed) {
      await gitDiscardFileChanges(selectedFile.relativePath);
      await handleSelectFile(selectedFile);
    }
  };

  const handleDeleteItem = async (node: FileTreeNode) => {
    if (!selectedProject || !window.api) return;
    const confirmMsg = node.isDirectory
      ? t.explorer.confirmDeleteFolder.replace('{path}', node.relativePath)
      : t.explorer.confirmDeleteFile.replace('{path}', node.relativePath);
    const confirmed = await dialog.confirm({
      message: confirmMsg,
      danger: true
    });
    if (confirmed) {
      try {
        await window.api.deleteFileOrFolder(rootPath, node.relativePath);
        if (selectedFile?.relativePath === node.relativePath) {
          setSelectedFile(null);
          setFileContent('');
        }
        await loadTree();
        if (loadGitRepoDetails) await loadGitRepoDetails(selectedProject);
      } catch (e: any) {
        setErrorMsg(t.explorer.deleteError.replace('{error}', e?.message || String(e)));
      }
    }
  };

  const handleCreateNew = async () => {
    if (!showNewModal || !newItemName.trim() || !selectedProject || !window.api) return;
    const rel = showNewModal.parentRel
      ? `${showNewModal.parentRel}/${newItemName.trim()}`
      : newItemName.trim();

    try {
      await window.api.createFileOrFolder(rootPath, rel, showNewModal.isDir);
      setShowNewModal(null);
      setNewItemName('');
      await loadTree();
    } catch (e: any) {
      setErrorMsg(t.explorer.createError.replace('{error}', e?.message || String(e)));
    }
  };

  // Recursive Tree Node Renderer
  const renderTreeNode = (node: FileTreeNode, depth = 0) => {
    const isExpanded = expandedPaths.has(node.relativePath);
    const isSelected = selectedFile?.relativePath === node.relativePath;
    const gitInfo = gitMap.get(node.relativePath);
    const changedCount = node.isDirectory ? countChangedChildren(node) : 0;

    // Filter by search
    if (searchQuery && !node.isDirectory && !node.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return null;
    }

    return (
      <div key={node.relativePath} className="select-none">
        <div
          onClick={() => (node.isDirectory ? toggleExpand(node.relativePath) : handleSelectFile(node))}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          className={`flex items-center gap-1.5 py-1 pr-2 rounded-md cursor-pointer transition group text-xs ${
            isSelected
              ? 'bg-indigo-600/30 text-white border border-indigo-500/40'
              : 'hover:bg-slate-800/60 text-slate-300'
          }`}
        >
          {node.isDirectory ? (
            <span className="text-slate-500 hover:text-slate-300">
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </span>
          ) : (
            <span className="w-3.5" />
          )}

          {getFileIcon(node.name, node.isDirectory, isExpanded)}

          <span
            className={`truncate flex-1 font-mono text-[11.5px] ${
              gitInfo
                ? gitInfo.status === 'M'
                  ? 'text-amber-300 font-medium'
                  : gitInfo.status === 'A'
                  ? 'text-emerald-300 font-medium'
                  : gitInfo.status === 'D'
                  ? 'text-rose-300 line-through'
                  : 'text-cyan-300'
                : 'text-slate-300'
            }`}
            title={node.relativePath}
          >
            {node.name}
          </span>

          {/* Git Badge for File */}
          {gitInfo && (
            <span
              className={`text-[10px] font-mono font-bold px-1 py-0.2 rounded border shrink-0 ${
                statusBadgeStyles[gitInfo.status] || statusBadgeStyles['?']
              }`}
              title={gitInfo.staged ? 'Staged' : 'Unstaged'}
            >
              {gitInfo.status}
            </span>
          )}

          {/* Changed Count Badge for Directory */}
          {node.isDirectory && changedCount > 0 && (
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-amber-950/80 border border-amber-700/60 text-amber-400 font-bold shrink-0">
              {changedCount}
            </span>
          )}

          {/* Action on Hover: Delete / Add in folder */}
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0">
            {node.isDirectory && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  setShowNewModal({ isDir: false, parentRel: node.relativePath });
                }}
                className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white"
                title={t.explorer.createFileHere}
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={e => {
                e.stopPropagation();
                handleDeleteItem(node);
              }}
              className="p-0.5 rounded hover:bg-rose-950 text-slate-500 hover:text-rose-400"
              title={t.explorer.delete}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Children */}
        {node.isDirectory && isExpanded && node.children && (
          <div>{node.children.map(child => renderTreeNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  const isDirty = fileContent !== originalContent;

  return (
    <div className="flex-1 flex overflow-hidden bg-[#0c0e16]">
      {/* ─── LEFT PANE: FILE TREE ─── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-slate-800 bg-[#0e111a] overflow-hidden">
        {/* Tree Toolbar */}
        <div className="p-3 border-b border-slate-800/80 space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-indigo-400" />
              {t.explorer.projectFiles}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowNewModal({ isDir: false, parentRel: '' })}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
                title={t.explorer.newFile}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setShowNewModal({ isDir: true, parentRel: '' })}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
                title={t.explorer.newFolder}
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={loadTree}
                disabled={isLoading}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
                title={t.explorer.refreshTree}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
              </button>
            </div>
          </div>

          {/* Search Box */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950/70 border border-slate-800 text-xs">
            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t.explorer.searchPlaceholder}
              className="bg-transparent text-xs text-slate-200 placeholder-slate-500 outline-none w-full font-mono"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-[10px] text-slate-500 hover:text-slate-300">
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Tree Nodes List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {tree.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-8 italic">
              {isLoading ? t.explorer.loading : t.explorer.folderEmpty}
            </div>
          ) : (
            tree.map(node => renderTreeNode(node))
          )}
        </div>
      </div>

      {/* ─── RIGHT PANE: EDITOR & DIFF ─── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#090b11]">
        {selectedFile ? (
          <>
            {/* Editor Header Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/80 text-xs shrink-0 select-none">
              <div className="flex items-center gap-2 overflow-hidden">
                {getFileIcon(selectedFile.name, false)}
                <span className="font-mono text-slate-200 font-semibold truncate" title={selectedFile.relativePath}>
                  {selectedFile.relativePath}
                </span>
                {isDirty && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title={t.explorer.unsavedChanges} />
                )}
                {gitMap.has(selectedFile.relativePath) && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                      statusBadgeStyles[gitMap.get(selectedFile.relativePath)!.status]
                    }`}
                  >
                    Git: {gitMap.get(selectedFile.relativePath)!.status}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Pane Tab: Editor vs Diff */}
                {fileDiff && (
                  <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700/60">
                    <button
                      onClick={() => setActivePaneTab('editor')}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition ${
                        activePaneTab === 'editor'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Code2 className="w-3 h-3" />
                      <span>{t.explorer.codeTab}</span>
                    </button>
                    <button
                      onClick={() => setActivePaneTab('diff')}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition ${
                        activePaneTab === 'diff'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <FileDiff className="w-3 h-3" />
                      <span>Diff</span>
                    </button>
                  </div>
                )}

                {/* Discard changes if modified in Git */}
                {gitMap.has(selectedFile.relativePath) && (
                  <button
                    onClick={handleDiscardChanges}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-rose-950/40 hover:bg-rose-950/80 border border-rose-800/40 text-rose-300 text-xs transition"
                    title={t.explorer.discardFileTooltip}
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Discard</span>
                  </button>
                )}

                {/* Save Button */}
                <button
                  onClick={handleSave}
                  disabled={!isDirty || isSaving}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium transition shadow-sm"
                >
                  {isSaving ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : saveSuccess ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Save className="w-3 h-3" />
                  )}
                  <span>{saveSuccess ? t.explorer.saved : t.explorer.saveShortcut}</span>
                </button>

                {/* Open In VS Code */}
                {window.api?.openInCode && selectedProject && (
                  <button
                    onClick={() => window.api.openInCode(`${rootPath}/${selectedFile.relativePath}`)}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition"
                    title={t.explorer.openInVsCodeTooltip}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Error banner */}
            {errorMsg && (
              <div className="mx-4 mt-2 flex items-center gap-2 p-2 rounded-lg bg-rose-950/70 border border-rose-700/60 text-rose-300 text-xs">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Editor Body */}
            <div className="flex-1 overflow-hidden">
              {activePaneTab === 'diff' && fileDiff ? (
                <SplitDiffViewer diff={fileDiff} filePath={selectedFile.relativePath} defaultMode="split" />
              ) : (
                <div className="flex h-full font-mono text-[12px] bg-[#090b11]">
                  {/* Line numbers gutter */}
                  <div className="w-12 py-3 bg-[#0a0d14] text-slate-600 text-right pr-3 select-none border-r border-slate-800/80 overflow-hidden shrink-0">
                    {fileContent.split('\n').map((_, idx) => (
                      <div key={idx} className="leading-5">
                        {idx + 1}
                      </div>
                    ))}
                  </div>

                  {/* Code textarea */}
                  <textarea
                    value={fileContent}
                    onChange={e => setFileContent(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleSave();
                      }
                    }}
                    className="flex-1 p-3 bg-transparent text-slate-200 outline-none resize-none leading-5 font-mono overflow-auto whitespace-pre selection:bg-indigo-900/60"
                    spellCheck={false}
                  />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
            <FileCode className="w-14 h-14 text-slate-800 mb-3" />
            <h3 className="text-sm font-semibold text-slate-300 mb-1">{t.explorer.explorerTitle}</h3>
            <p className="text-xs text-slate-500 max-w-sm">
              {t.explorer.explorerSubtitle}
            </p>
          </div>
        )}
      </div>

      {/* ─── MODAL: NEW FILE / FOLDER ─── */}
      {showNewModal &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              {showNewModal.isDir ? <FolderPlus className="w-4 h-4 text-amber-400" /> : <Plus className="w-4 h-4 text-indigo-400" />}
              {showNewModal.isDir ? t.explorer.createNewFolderTitle : t.explorer.createNewFileTitle}
            </h3>
            {showNewModal.parentRel && (
              <p className="text-xs text-slate-400 font-mono">
                {t.explorer.inDirectory} <span className="text-indigo-300">{showNewModal.parentRel}/</span>
              </p>
            )}

            <input
              autoFocus
              value={newItemName}
              onChange={e => setNewItemName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateNew()}
              placeholder={showNewModal.isDir ? t.explorer.newFolderPlaceholder : t.explorer.newFilePlaceholder}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 font-mono"
            />

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setShowNewModal(null);
                  setNewItemName('');
                }}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white"
              >
                {t.explorer.cancel}
              </button>
              <button
                onClick={handleCreateNew}
                disabled={!newItemName.trim()}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium"
              >
                {t.explorer.create}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
