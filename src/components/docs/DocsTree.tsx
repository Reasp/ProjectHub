import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileText, Folder, FolderOpen, ShieldCheck } from 'lucide-react';
import { ancestorKeys, buildDocTree, type DocTreeFolder, type DocTreeNode } from '../../utils/docTree';
import type { DocItem } from '../../types/electron';

const EXPANDED_KEY = 'projecthub.docsTree.expanded';
const ROOT_KEYS: Array<DocItem['category']> = ['decision', 'doc'];

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return new Set(parsed.filter((key): key is string => typeof key === 'string'));
  } catch {
    // повреждённое значение — раскрываем только корневые группы
  }
  return new Set(ROOT_KEYS);
}

function statusClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'accepted':
      return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
    case 'proposed':
      return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
    default:
      return 'bg-rose-500/10 text-rose-300 border-rose-500/30';
  }
}

function collectFolderKeys(nodes: Array<DocTreeNode<DocItem>>, keys: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind !== 'folder') continue;
    keys.push(node.key);
    collectFolderKeys(node.children, keys);
  }
  return keys;
}

interface DocsTreeProps {
  docs: DocItem[];
  selectedPath?: string;
  onSelect: (doc: DocItem) => void;
  /** Раскрыть всё дерево независимо от сохранённого состояния — при активном поиске. */
  forceExpanded: boolean;
  labels: { decisions: string; docs: string; expandAll: string; collapseAll: string };
}

/**
 * Дерево документации (TASK-121, decision-68): группы «Решения» и «Документы», внутри разделы
 * из поля `section` или вложенных папок. Раскрытые узлы запоминаются между запусками.
 */
export const DocsTree: React.FC<DocsTreeProps> = ({ docs, selectedPath, onSelect, forceExpanded, labels }) => {
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const selectedRef = useRef<HTMLDivElement | null>(null);

  const tree = useMemo(
    () =>
      buildDocTree(docs, [
        { category: 'decision', name: labels.decisions },
        { category: 'doc', name: labels.docs }
      ]),
    [docs, labels.decisions, labels.docs]
  );

  const update = (next: Set<string>) => {
    setExpanded(next);
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // хранилище недоступно — состояние живёт до закрытия вкладки
    }
  };

  // Выбранный документ (в том числе открытый по ссылке) должен быть виден: раскрываем его ветку.
  const selectedDoc = docs.find((doc) => doc.filePath === selectedPath);
  const selectedBranch = selectedDoc ? ancestorKeys(selectedDoc).join('\n') : '';
  useEffect(() => {
    if (!selectedBranch) return;
    const keys = selectedBranch.split('\n');
    setExpanded((prev) => {
      if (keys.every((key) => prev.has(key))) return prev;
      const next = new Set(prev);
      keys.forEach((key) => next.add(key));
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // см. update()
      }
      return next;
    });
  }, [selectedBranch, selectedPath]);

  // Прокрутка к выбранному — после того как его ветка раскрылась; обычное сворачивание узлов её не вызывает.
  const selectedVisible =
    forceExpanded || (selectedBranch !== '' && selectedBranch.split('\n').every((key) => expanded.has(key)));
  useEffect(() => {
    if (selectedVisible) selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedPath, selectedVisible]);

  const toggle = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update(next);
  };

  const renderFolder = (folder: DocTreeFolder<DocItem>, depth: number): React.ReactNode => {
    const isOpen = forceExpanded || expanded.has(folder.key);
    const isRoot = depth === 0;
    return (
      <div key={folder.key} role="treeitem" aria-expanded={isOpen} data-testid="docs-tree-folder" data-key={folder.key}>
        <button
          type="button"
          onClick={() => toggle(folder.key)}
          style={{ paddingLeft: 6 + depth * 14 }}
          className={`w-full flex items-center gap-1.5 pr-2 py-1.5 rounded-lg text-left transition hover:bg-[#181c2d] ${
            isRoot ? 'text-[11px] font-semibold uppercase tracking-wider text-slate-300' : 'text-xs font-medium text-slate-300'
          }`}
        >
          <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          {!isRoot &&
            (isOpen ? (
              <FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-400/80" />
            ) : (
              <Folder className="w-3.5 h-3.5 shrink-0 text-amber-400/80" />
            ))}
          <span className="truncate flex-1">{folder.name}</span>
          <span className="text-[10px] font-mono text-slate-500 shrink-0">{folder.count}</span>
        </button>
        {isOpen && <div role="group">{folder.children.map((child) => renderNode(child, depth + 1))}</div>}
      </div>
    );
  };

  const renderNode = (node: DocTreeNode<DocItem>, depth: number): React.ReactNode => {
    if (node.kind === 'folder') return renderFolder(node, depth);
    const doc = node.doc;
    const isSelected = doc.filePath === selectedPath;
    const isDecision = doc.category === 'decision';
    // «accepted» — обычное состояние решения; значком отмечаем только отличающиеся статусы.
    const showStatus = doc.status && doc.status.toLowerCase() !== 'accepted';
    return (
      <div
        key={node.key}
        ref={isSelected ? selectedRef : undefined}
        role="treeitem"
        aria-selected={isSelected}
        data-testid="docs-tree-doc"
        data-doc-id={doc.id}
        onClick={() => {
          // Документ, выбранный из результатов поиска, остаётся виден и после очистки поиска.
          update(new Set([...expanded, ...ancestorKeys(doc)]));
          onSelect(doc);
        }}
        title={`${doc.id} · ${doc.title}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        className={`flex items-start gap-2 pr-2 py-1.5 rounded-lg border cursor-pointer transition ${
          isSelected
            ? 'bg-indigo-600/15 border-indigo-500/50 text-white'
            : 'border-transparent text-slate-300 hover:bg-[#181c2d]'
        }`}
      >
        {isDecision ? (
          <ShieldCheck className="w-3.5 h-3.5 mt-0.5 text-indigo-400 shrink-0" />
        ) : (
          <FileText className="w-3.5 h-3.5 mt-0.5 text-sky-400 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs leading-snug line-clamp-2">{doc.title}</div>
          <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-500">
            <span className="font-mono">{doc.id}</span>
            {doc.date && <span>{doc.date.slice(0, 10)}</span>}
            {showStatus && (
              <span className={`px-1 rounded font-mono border ${statusClass(doc.status!)}`}>{doc.status}</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const allKeys = collectFolderKeys(tree);
  const hasSections = allKeys.length > tree.length;

  return (
    <div role="tree" data-testid="docs-tree" className="space-y-0.5">
      {hasSections && !forceExpanded && (
        <div className="flex items-center justify-end gap-3 px-1 pb-1 text-[10px] text-slate-500">
          <button type="button" onClick={() => update(new Set(allKeys))} className="hover:text-slate-200 transition">
            {labels.expandAll}
          </button>
          <button type="button" onClick={() => update(new Set(ROOT_KEYS))} className="hover:text-slate-200 transition">
            {labels.collapseAll}
          </button>
        </div>
      )}
      {tree.map((root) => renderFolder(root, 0))}
    </div>
  );
};
