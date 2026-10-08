import type { ReactNode } from 'react';
import type { Label, Project, User } from '../types';
import { avatarColor, initials } from '../util';
import { ProjectIcon } from '../icons';

export function Avatar({ user, size = 18 }: { user: User | null | undefined; size?: number }) {
  if (!user) {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" style={{ flexShrink: 0 }} aria-label="Unassigned">
        <circle cx="9" cy="9" r="8" fill="none" stroke="#6e6e73" strokeWidth="1.2" strokeDasharray="2.2 2" />
        <circle cx="9" cy="7.2" r="2.4" fill="none" stroke="#6e6e73" strokeWidth="1.2" />
        <path d="M4.8 13.8c.7-1.6 2.3-2.5 4.2-2.5s3.5.9 4.2 2.5" fill="none" stroke="#6e6e73" strokeWidth="1.2" />
      </svg>
    );
  }
  if (user.avatarUrl) {
    return <img className="avatar" src={user.avatarUrl} alt="" width={size} height={size} style={{ width: size, height: size }} referrerPolicy="no-referrer" title={user.name} />;
  }
  return (
    <span className="avatar avatar-initials" title={user.name} style={{ width: size, height: size, fontSize: Math.max(7, size * 0.42), background: avatarColor(user.email) }}>
      {initials(user.name)}
    </span>
  );
}

export function LabelDot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="label-dot" style={{ background: color, width: size, height: size }} />;
}

export function Chip({ children, onClick, title, className = '' }: { children: ReactNode; onClick?: (e: React.MouseEvent) => void; title?: string; className?: string }) {
  return (
    <span className={`chip ${onClick ? 'clickable' : ''} ${className}`} onClick={onClick} title={title}>
      {children}
    </span>
  );
}

export function LabelChip({ label, onClick }: { label: Label; onClick?: (e: React.MouseEvent) => void }) {
  return <Chip onClick={onClick} title={label.description || label.name}><LabelDot color={label.color} /><span>{label.name}</span></Chip>;
}

export function ProjectChip({ project, onClick }: { project: Project; onClick?: (e: React.MouseEvent) => void }) {
  return <Chip onClick={onClick}><ProjectIcon icon={project.icon} color={project.color} size={14} /><span>{project.name}</span></Chip>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
