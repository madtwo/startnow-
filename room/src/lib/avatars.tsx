import type { ReactNode } from 'react';

export const AVATAR_KEYS = [
  'moon',
  'leaf',
  'spiral',
  'waves',
  'pebble',
  'lamp',
  'kite',
  'window',
  'cup',
  'petal',
] as const;

export type AvatarKey = (typeof AVATAR_KEYS)[number];

export const AVATAR_LABELS: Record<string, string> = {
  moon: '月牙',
  leaf: '枝叶',
  spiral: '回环',
  waves: '水纹',
  pebble: '卵石',
  lamp: '台灯',
  kite: '纸鸢',
  window: '窗格',
  cup: '热茶',
  petal: '花瓣',
};

const marks: Record<string, ReactNode> = {
  moon: <path d="M20.5 5.5a10 10 0 1 0 6.2 17.6 12 12 0 0 1-6.2-17.6Z" />,
  leaf: (
    <>
      <path d="M10.5 24c0-8 4-14 11-16" />
      <path d="M11.4 19.6c-3.2-2-4.2-5.2-3.2-8.4 3.2 0 5.2 2.2 5.2 5.2" />
      <path d="M16.6 13.2c4-.6 6.6 1.4 7.4 4.6-3 .8-5.8-.4-7.4-4.6Z" />
    </>
  ),
  spiral: (
    <>
      <path d="M22.6 9.4a8 8 0 1 0 1.4 9.6" />
      <path d="M19 12.6a4.4 4.4 0 1 0 .8 5.4" />
    </>
  ),
  waves: (
    <>
      <path d="M6.5 12c2.4-2.2 4.8-2.2 7.2 0s4.8 2.2 7.2 0 4.6-2 5.6-1" />
      <path d="M6.5 18c2.4-2.2 4.8-2.2 7.2 0s4.8 2.2 7.2 0 4.6-2 5.6-1" opacity=".55" />
    </>
  ),
  pebble: (
    <>
      <path d="M10 22.5c-2.6 0-4.2-1.7-4.2-3.9 0-2.4 2.6-4.1 6-4.1h3.4" />
      <path d="M8.4 22.5h11.8" />
      <ellipse cx="16.4" cy="15.6" rx="5.2" ry="3.9" />
      <ellipse cx="18.6" cy="9.6" rx="3.8" ry="2.9" />
    </>
  ),
  lamp: (
    <>
      <path d="M12.5 8.5h7l3 8h-13z" />
      <path d="M16 16.5v6.5M12.5 24.5h7" />
      <path d="M11.2 11.6 8.4 10M20.8 11.6l2.8-1.6" opacity=".55" />
    </>
  ),
  kite: (
    <>
      <path d="M16 5.5 23 13l-7 8.5L9 13z" />
      <path d="M16 5.5v16M9 13h14" opacity=".5" />
      <path d="M16 21.5c0 2-2.4 2.6-2.4 4.4 0 1 .9 1.6 1.8 1.6" />
    </>
  ),
  window: (
    <>
      <rect x="7.5" y="7.5" width="17" height="17" rx="1.6" />
      <path d="M16 7.5v17M7.5 16h17" opacity=".6" />
      <path d="M9.8 9.8h4.4v4.4H9.8z" opacity=".28" />
    </>
  ),
  cup: (
    <>
      <path d="M9 15h11v5.4a4.6 4.6 0 0 1-4.6 4.6h-1.8A4.6 4.6 0 0 1 9 20.4z" />
      <path d="M20 16.4h1.8a2.6 2.6 0 0 1 0 5.2H20" />
      <path d="M13.4 11.6c-1-1.2-1-2.4 0-3.6M16.8 11.6c-1-1.2-1-2.4 0-3.6" opacity=".55" />
    </>
  ),
  petal: (
    <>
      <ellipse cx="16" cy="9.6" rx="2.8" ry="4.4" />
      <ellipse cx="16" cy="22.4" rx="2.8" ry="4.4" />
      <ellipse cx="9.6" cy="16" rx="4.4" ry="2.8" />
      <ellipse cx="22.4" cy="16" rx="4.4" ry="2.8" />
      <circle cx="16" cy="16" r="1.4" />
    </>
  ),
};

export function AvatarMark({ avatarKey, className }: { avatarKey: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {marks[avatarKey] ?? marks.moon}
    </svg>
  );
}
