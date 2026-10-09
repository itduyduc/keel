export type StatusType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

export interface Status { id: number; name: string; type: StatusType; color: string; position: number }

export interface User {
  id: number; email: string; name: string; handle: string; gitHandle: string; avatarUrl: string | null;
  role: 'admin' | 'member'; active: boolean; joined: boolean; createdAt: string; lastSeenAt: string | null;
}

export interface Label { id: number; name: string; color: string; description: string | null; archived: boolean }

export interface Project { id: number; name: string; icon: string; color: string; description: string | null; archived: boolean; createdAt: string }

export interface PullRequest {
  id: number; repo: string; number: number; title: string; url: string; branch: string | null; author: string | null;
  state: 'open' | 'closed' | 'merged'; draft: boolean; openedAt: string | null; mergedAt: string | null; closedAt: string | null;
}

export interface Issue {
  id: number; teamId: number; number: number; identifier: string; title: string; description: string;
  statusId: number; priority: number; assigneeId: number | null; creatorId: number | null; projectId: number | null;
  cycle: number | null; parentId: number | null; estimate: number | null; dueDate: string | null;
  labelIds: number[]; prs: PullRequest[];
  createdAt: string; updatedAt: string; startedAt: string | null; completedAt: string | null; canceledAt: string | null;
}

export interface Cycle { number: number; startDate: string; endDate: string; startsAt: string; endsAt: string; isCurrent: boolean; isPast: boolean; isFuture: boolean }

export interface EstimateScale { label: string; values: number[]; names?: string[] }

// what every team shares
export interface Workspace {
  name: string;
  cycle: { anchor: string; tz: string; lengthDays: number };
  estimateScale: string; estimateScales: Record<string, EstimateScale>;
  defaultStatusId: number; prOpenStatusId: number | null; prMergedStatusId: number | null; projectIcons: string[];
}

// each team owns its key (PIC), its issue numbers, whether it runs cycles, and who sees it:
// everyone, or only memberIds when private. canSee is false only in an admin's Settings list.
export interface Team {
  id: number; key: string; name: string; color: string; cyclesEnabled: boolean; createdAt: string;
  private: boolean; memberIds: number[]; canSee: boolean;
}

export interface Reaction { emoji: string; userIds: number[] }

export interface Comment {
  id: number; issueId: number; userId: number; body: string; createdAt: string; updatedAt: string; editedAt: string | null; reactions: Reaction[];
}

export interface Activity {
  id: number; issueId: number; actorKind: 'user' | 'github' | 'system'; actorId: number | null; actorName: string | null;
  kind: string; from: string | null; to: string | null; meta: { title?: string; url?: string; repo?: string; number?: number } | null; createdAt: string;
}

export interface Bootstrap {
  version: string; me: User; workspace: Workspace; teams: Team[]; statuses: Status[]; users: User[]; labels: Label[]; projects: Project[];
  cycles: { current: number; cycles: Cycle[] }; issues: Issue[];
}

// teamId only counts when creating: an issue stays in its team
export type IssuePatch = Partial<Pick<Issue, 'teamId' | 'title' | 'description' | 'statusId' | 'priority' | 'assigneeId' | 'projectId' | 'cycle' | 'parentId' | 'estimate' | 'dueDate' | 'labelIds'>>;
