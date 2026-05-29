/**
 * 代码块高亮组件（基于 shiki）
 */

import { useEffect, useState } from 'react';
import { highlight } from '../lib/highlight';

interface Props {
  code: string;
  lang?: string;
}

export function CodeBlock({ code, lang }: Props) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void highlight(code, lang).then((h) => {
      if (!cancelled) setHtml(h);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (!html) {
    // 首次渲染 fallback：纯 pre 避免布局跳动
    return (
      <pre className="bg-bg-card border-2 border-black rounded p-3 my-2 overflow-x-auto font-mono text-sm">
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div
      className="openspace-code-block border-2 border-black rounded my-2 overflow-x-auto font-mono text-sm"
      // shiki 返回带背景色的 pre，覆盖其 padding/margin
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
