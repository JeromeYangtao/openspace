/**
 * Avatar 组件
 *
 * MVP 本地版简化（见 docs/ui-reference/local-adaptations.md）：
 *   - Agent: 青色/蓝色方块 + 像素风格字母（不支持自定义上传）
 *   - User:  紫色方块 + 字母
 *   - System: 简单灰色图标（在消息列表里 system message 不渲染头像）
 */

import { cn } from '../lib/cn';

type Size = 'sm' | 'md' | 'lg';

const SIZE_CLS: Record<Size, string> = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-base',
  lg: 'w-16 h-16 text-2xl',
};

interface Props {
  name: string;
  kind?: 'agent' | 'user';
  size?: Size;
  className?: string;
}

const AGENT_COLORS = [
  'bg-accent-teal',
  'bg-accent-cyan',
  'bg-[#9dc3e6]',
  'bg-[#b3e5a8]',
  'bg-[#ffd9a8]',
  'bg-[#f7c6e0]',
];

export function Avatar({ name, kind = 'agent', size = 'md', className }: Props) {
  const initial = name.trim().slice(0, 2).toUpperCase();
  // 根据名字取一个稳定的颜色索引
  const colorIdx =
    kind === 'user'
      ? -1
      : Array.from(name).reduce((acc, c) => acc + c.charCodeAt(0), 0) % AGENT_COLORS.length;
  const bg = kind === 'user' ? 'bg-accent-purple' : AGENT_COLORS[colorIdx];

  return (
    <div
      className={cn(
        'inline-flex items-center justify-center overflow-hidden whitespace-nowrap border-2 border-black rounded font-bold font-mono leading-none select-none flex-shrink-0',
        SIZE_CLS[size],
        bg,
        className,
      )}
      title={name}
    >
      {initial}
    </div>
  );
}
