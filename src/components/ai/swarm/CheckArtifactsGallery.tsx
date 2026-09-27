import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileArchive, FolderOpen, ImageOff, X } from 'lucide-react';
import { useTranslation } from '../../../i18n/useTranslation';
import type { CheckArtifact } from '../../../types/electron';

/**
 * Скриншоты и trace проверки `ui-smoke` (TASK-78, decision-55 п. 6): миниатюры, просмотр в модалке
 * и «показать в папке». Картинки отдаёт main-процесс только из `<userData>/visual`.
 */

/** Кэш data URL по relPath: миниатюра и просмотр не читают файл дважды. */
const imageCache = new Map<string, Promise<string | { error: string }>>();

function loadImage(relPath: string): Promise<string | { error: string }> {
  let pending = imageCache.get(relPath);
  if (!pending) {
    pending = window.api
      .readVisualArtifact(relPath)
      .then((res) => ('dataUrl' in res ? res.dataUrl : { error: res.error }))
      .catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
    imageCache.set(relPath, pending);
    // Ошибку не кэшируем навсегда: файл мог появиться позже (проверка ещё идёт).
    void pending.then((v) => {
      if (typeof v !== 'string') imageCache.delete(relPath);
    });
  }
  return pending;
}

function useArtifactImage(relPath: string): { src?: string; error?: string } {
  const [state, setState] = useState<{ src?: string; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    setState({});
    void loadImage(relPath).then((v) => {
      if (!cancelled) setState(typeof v === 'string' ? { src: v } : { error: v.error });
    });
    return () => {
      cancelled = true;
    };
  }, [relPath]);
  return state;
}

const Thumbnail: React.FC<{ artifact: CheckArtifact; size: 'sm' | 'md'; onOpen: () => void }> = ({ artifact, size, onOpen }) => {
  const { src, error } = useArtifactImage(artifact.relPath);
  const box = size === 'sm' ? 'w-20 h-14' : 'w-32 h-20';
  return (
    <button
      type="button"
      onClick={onOpen}
      title={error ? `${artifact.name}: ${error}` : artifact.name}
      className={`${box} shrink-0 rounded-md border border-border/70 bg-secondary/30 overflow-hidden flex items-center justify-center hover:border-primary/60 transition-colors`}
    >
      {src ? (
        <img src={src} alt={artifact.name} className="w-full h-full object-contain" />
      ) : error ? (
        <ImageOff className="w-4 h-4 text-muted-foreground" />
      ) : (
        <span className="w-3 h-3 rounded-full bg-muted-foreground/30 animate-pulse" />
      )}
    </button>
  );
};

const ArtifactViewer: React.FC<{ artifact: CheckArtifact; onClose: () => void }> = ({ artifact, onClose }) => {
  const { t } = useTranslation();
  const a = t.judge;
  const { src, error } = useArtifactImage(artifact.relPath);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="max-w-[92vw] max-h-[92vh] flex flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground truncate font-mono">{artifact.name}</h2>
          <span className="text-[10px] text-muted-foreground">{(artifact.bytes / 1024).toFixed(0)} KB</span>
          <button
            type="button"
            onClick={() => void window.api.revealVisualArtifact(artifact.relPath)}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <FolderOpen className="w-3.5 h-3.5" /> {a.artifactReveal}
          </button>
          <button type="button" onClick={onClose} title={a.artifactClose} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-auto bg-secondary/20 flex items-center justify-center min-w-[320px] min-h-[200px]">
          {src ? (
            <img src={src} alt={artifact.name} className="max-w-full max-h-[80vh] object-contain" />
          ) : error ? (
            <div className="p-6 text-xs text-rose-400">{a.artifactLoadError.replace('{error}', error)}</div>
          ) : (
            <div className="p-6 text-xs text-muted-foreground">…</div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export const CheckArtifactsGallery: React.FC<{
  artifacts?: CheckArtifact[];
  truncated?: boolean;
  size?: 'sm' | 'md';
}> = ({ artifacts, truncated, size = 'md' }) => {
  const { t } = useTranslation();
  const a = t.judge;
  const [open, setOpen] = useState<CheckArtifact | null>(null);
  if (!artifacts || artifacts.length === 0) return null;
  const shots = artifacts.filter((x) => x.kind === 'screenshot');
  const traces = artifacts.filter((x) => x.kind === 'trace');

  return (
    <div className="space-y-1.5">
      {shots.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {shots.map((s) => (
            <Thumbnail key={s.relPath} artifact={s} size={size} onOpen={() => setOpen(s)} />
          ))}
        </div>
      )}
      {traces.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {traces.map((tr) => (
            <button
              key={tr.relPath}
              type="button"
              onClick={() => void window.api.revealVisualArtifact(tr.relPath)}
              title={a.artifactReveal}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border/70 text-[10px] font-mono text-muted-foreground hover:text-foreground"
            >
              <FileArchive className="w-3 h-3" /> {tr.name}
            </button>
          ))}
        </div>
      )}
      {truncated && <div className="text-[10px] text-amber-400/90">{a.artifactsTruncated}</div>}
      {open && <ArtifactViewer artifact={open} onClose={() => setOpen(null)} />}
    </div>
  );
};
