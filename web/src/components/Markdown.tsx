import { useMemo } from 'react';
import { useApp } from '../state';
import { renderMarkdown } from '../util';
import { navigate } from '../router';

export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  const { data } = useApp();
  const html = useMemo(() => (data ? renderMarkdown(source, data) : ''), [source, data?.users, data?.issues.length]);
  return (
    <div
      className={`markdown ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a.issue-ref');
        if (a) { e.preventDefault(); e.stopPropagation(); navigate(a.getAttribute('href')!); }
      }}
    />
  );
}
