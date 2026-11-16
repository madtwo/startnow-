import { AvatarMark } from '../lib/avatars';

interface Props {
  avatarKey: string;
  name?: string;
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

export default function Avatar({ avatarKey, name, color, size = 'md', className = '' }: Props) {
  const initial = name ? Array.from(name.trim())[0] : '';
  return (
    <span
      className={`avatar ${size} ${className}`.trim()}
      style={color ? { background: color } : undefined}
      aria-hidden="true"
    >
      {initial ? (
        <span className="avatar-initial">{initial}</span>
      ) : (
        <AvatarMark avatarKey={avatarKey} className="avatar-mark" />
      )}
    </span>
  );
}
