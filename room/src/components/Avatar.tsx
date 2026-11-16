import { AvatarMark } from '../lib/avatars';

interface Props {
  avatarKey: string;
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

export default function Avatar({ avatarKey, color, size = 'md', className = '' }: Props) {
  return (
    <span
      className={`avatar ${size} ${className}`.trim()}
      style={color ? { background: color } : undefined}
      aria-hidden="true"
    >
      <AvatarMark avatarKey={avatarKey} className="avatar-mark" />
    </span>
  );
}
