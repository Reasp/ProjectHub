import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

// Initialize mermaid with rich dark theme aesthetics
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    darkMode: true,
    background: '#111422',
    primaryColor: '#4f46e5',
    primaryTextColor: '#f8fafc',
    primaryBorderColor: '#6366f1',
    lineColor: '#38bdf8',
    secondaryColor: '#ec4899',
    tertiaryColor: '#1e293b',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '13px'
  },
  securityLevel: 'loose'
});

interface MermaidDiagramProps {
  chart: string;
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ chart }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const renderChart = async () => {
      if (!chart.trim()) return;
      try {
        const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
        const { svg: renderedSvg } = await mermaid.render(id, chart);
        if (isMounted) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err: any) {
        console.error('Mermaid render error:', err);
        if (isMounted) {
          setError(err.message || 'Ошибка синтаксиса диаграммы Mermaid');
        }
      }
    };

    renderChart();
    return () => {
      isMounted = false;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="my-4 p-4 rounded-xl bg-red-950/40 border border-red-800/50 text-red-300 text-xs font-mono">
        <div className="font-semibold mb-1">Ошибка рендеринга Mermaid диаграммы:</div>
        <div className="text-red-400 whitespace-pre-wrap">{error}</div>
        <pre className="mt-2 p-2 rounded bg-black/40 text-slate-400 overflow-x-auto text-[11px]">{chart}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-4 p-6 rounded-2xl bg-[#0e111d] border border-slate-800 flex items-center justify-center text-xs text-slate-500 animate-pulse">
        Построение диаграммы Mermaid...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-5 p-5 rounded-2xl bg-[#0e111d] border border-slate-800 shadow-xl overflow-x-auto flex justify-center items-center transition-all hover:border-indigo-500/40"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
