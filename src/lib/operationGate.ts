/**
 * 单机 App 任务门闩：同一时间只允许一个会修改卡片/角色的异步任务。
 * 同步用户操作应调用 change()，即使 React 还没完成下一次 render 也能使旧结果失效。
 * 注意：只协调当前标签页，不是多标签页事务锁。
 */
export type OperationKind = 'tick' | 'advice' | 'advance';
export interface OperationTicket { id: number; kind: OperationKind }

export function createOperationGate() {
  let revision = 0;
  let serial = 0;
  let active: OperationTicket | null = null;
  return {
    change(): number { return ++revision; },
    revision(): number { return revision; },
    start(kind: OperationKind): OperationTicket | null {
      if (active) return null;
      active = { id: ++serial, kind };
      return active;
    },
    isCurrent(ticket: OperationTicket, atRevision: number): boolean {
      return active?.id === ticket.id && revision === atRevision;
    },
    finish(ticket: OperationTicket): void {
      if (active?.id === ticket.id) active = null;
    },
    running(): OperationKind | null { return active?.kind ?? null; },
  };
}
