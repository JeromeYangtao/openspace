/**
 * 使用 shiki 做代码高亮（懒加载 + 结果缓存）
 */

import type { Highlighter } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;
const cache = new Map<string, string>();

async function getHighlighter(): Promise<Highlighter> {
  if (highlighterPromise) return highlighterPromise;
  highlighterPromise = import('shiki').then((shiki) =>
    shiki.createHighlighter({
      themes: ['github-light'],
      langs: [
        'bash',
        'shell',
        'javascript',
        'typescript',
        'tsx',
        'jsx',
        'json',
        'yaml',
        'python',
        'rust',
        'go',
        'java',
        'sql',
        'html',
        'css',
        'markdown',
      ],
    }),
  );
  return highlighterPromise;
}

/**
 * 将代码字符串渲染为 HTML（内联样式），同步从缓存读，如果没有先返回原始 escape 版本并异步更新缓存
 */
export function highlight(code: string, lang: string | undefined): Promise<string> {
  const key = `${lang ?? ''}::${code}`;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);

  return getHighlighter()
    .then((h) => {
      const langId = (lang ?? 'text').toLowerCase();
      const supported = h.getLoadedLanguages().includes(langId as never);
      const html = h.codeToHtml(code, {
        lang: supported ? langId : 'text',
        theme: 'github-light',
      });
      cache.set(key, html);
      return html;
    })
    .catch(() => {
      // 回退：手工 escape
      const esc = code.replace(/[&<>]/g, (c) =>
        c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;',
      );
      const fallback = `<pre><code>${esc}</code></pre>`;
      cache.set(key, fallback);
      return fallback;
    });
}
