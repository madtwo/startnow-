import { useEffect, useMemo, useRef, useState } from 'react';
import ArchivePanel from './ArchivePanel';
import ChatRoom from './ChatRoom';
import CrisisCard from './CrisisCard';
import RoomPanel from './RoomPanel';
import StepPanel from './StepPanel';
import { configLabel, isMock, isReady } from '../config/providers';
import { pickCast } from '../lib/personas';
import {
  tryAddStep,
  catchUpRoom,
  tryCompleteStep,
  commitRoomOperation,
  discardArchive,
  dropStep,
  ensureRoomTitle,
  MAX_ARCHIVES,
  newRoom,
  postPlayerMessage,
  renameRoom,
  requestStep as askStep,
  rerollRoom,
  restoreArchive,
  shrinkStep,
  tickRoom,
  usedToday,
} from '../lib/room';
import { findCrisis } from '../lib/safety';
import {
  captureStorageSession,
  loadArchives,
  loadRoom,
  loadRoomSettings,
  roomStorageBlocked,
  archiveStorageBlocked,
  saveArchives,
  saveRoom,
  saveRoomSettings,
  reserveRoomRequest,
  withRoomUsageFloor,
} from '../lib/store';
import type { Identity, LlmConfig, Room, RoomSettings } from '../types';

const TICK_MS = 4000;

type Panel = 'none' | 'steps' | 'room' | 'archive';

interface Props {
  identity: Identity;
  config: LlmConfig;
  onOpenApi: () => void;
  blocked?: boolean;
}

export default function RoomView({ identity, config, onOpenApi, blocked = false }: Props) {
  const [session] = useState(captureStorageSession);
  const [roomSettings, setRoomSettings] = useState<RoomSettings>(() => loadRoomSettings());
  const [archives, setArchives] = useState<Room[]>(() => loadArchives());
  const [room, setRoom] = useState<Room>(() => {
    const saved = loadRoom();
    return saved ? ensureRoomTitle(saved, identity.name) : withRoomUsageFloor(newRoom(pickCast(4), Date.now(), identity.name));
  });
  const [panel, setPanel] = useState<Panel>('none');
  const [working, setWorking] = useState(false);
  const [toast, setToast] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [crisis, setCrisis] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const ready = isReady(config);
  const busy = useRef(false);
  const active = useRef(true);
  const pendingOperation = useRef<AbortController | null>(null);
  const caughtUp = useRef(false);
  const roomRef = useRef(room);
  const latest = useRef({ room, roomSettings, config, blocked });
  latest.current = { room, roomSettings, config, blocked };
  roomRef.current = room;

  /* ---- UI 时钟：只为了「正在输入」和用量数字 ---- */
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  /* ---- 落盘 ---- */
  useEffect(() => {
    const id = window.setTimeout(() => { if (!saveRoom(roomRef.current, session)) setSaveFailed(true); }, 500);
    return () => window.clearTimeout(id);
  }, [room]);
  useEffect(() => { if (!saveArchives(archives, session)) setSaveFailed(true); }, [archives, session]);
  useEffect(() => { if (!saveRoomSettings(roomSettings, session)) setSaveFailed(true); }, [roomSettings, session]);
  useEffect(() => () => { saveRoom(roomRef.current, session); }, [session]);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; pendingOperation.current?.abort(); };
  }, []);
  useEffect(() => {
    if (blocked || roomStorageBlocked(session)) pendingOperation.current?.abort();
  }, [blocked, session, now]);

  const runRoomOperation = async (mode: 'tick' | 'catch-up' | 'manual') => {
    const cur = latest.current;
    if (busy.current || !active.current || cur.blocked || roomStorageBlocked(session) || !isReady(cur.config)) return false;
    const operationRoom = withRoomUsageFloor(cur.room);
    if (roomStorageBlocked(session) || usedToday(operationRoom) >= cur.roomSettings.dailyMessages) {
      if (mode === 'manual') setToast('今天的群聊额度已用尽');
      return false;
    }
    const controller = new AbortController();
    pendingOperation.current = controller;
    busy.current = true;
    if (mode === 'manual') setWorking(true);
    try {
      const args = { room: operationRoom, settings: cur.roomSettings, config: cur.config, signal: controller.signal,
        reserveAttempt: () => {
          const live = latest.current;
          return active.current && !controller.signal.aborted && !live.blocked && live.room.id === cur.room.id &&
            live.config === cur.config && reserveRoomRequest(live.room, live.roomSettings.dailyMessages, Date.now(), session);
        },
      };
      const out = mode === 'manual' ? await askStep(operationRoom, args) :
        mode === 'tick' ? await tickRoom(args) : await catchUpRoom(args);
      if (!active.current || latest.current.blocked || roomStorageBlocked(session)) return false;
      if (controller.signal.aborted || latest.current.config !== cur.config) {
        // The independent ledger already reserved paid attempts. Never commit
        // stale content; refresh usage on the still-live room only.
        commitPlayerRoom(withRoomUsageFloor(latest.current.room));
        if (mode === 'manual') setToast('群聊或模型设置已改变，本次结果未采用');
        return false;
      }
      const settled = withRoomUsageFloor(out.room);
      const live = latest.current.room;
      const merged = commitRoomOperation(live, cur.room, settled);
      if (!commitPlayerRoom(merged)) {
        if (mode === 'manual') setToast('本次生成未能保存，未创建下一步');
        return false;
      }
      if (mode === 'catch-up') caughtUp.current = true;
      if (mode === 'manual') setToast(merged.steps.some(step => !live.steps.some(old => old.id === step.id))
        ? '有人给了一个下一步' : out.logs[0] || '暂时没有生成下一步');
      else if (out.logs.length) setToast(out.logs[0]);
      return true;
    } catch {
      if (active.current && !controller.signal.aborted) setToast(mode === 'manual' ? '这次未能生成下一步' : '这次群聊生成未成功');
      return false;
    } finally {
      if (pendingOperation.current === controller) pendingOperation.current = null;
      busy.current = false;
      if (active.current && mode === 'manual') setWorking(false);
    }
  };

  /* ---- Catch up before the first tick. A busy/aborted attempt does not
   * mark catch-up as complete; the next visible interval retries it. ---- */
  const pump = () => runRoomOperation(caughtUp.current ? 'tick' : 'catch-up');
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void pump();
    }, TICK_MS);
    if (document.visibilityState === 'visible') void pump();
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (!roomStorageBlocked(session)) commitPlayerRoom({ ...latest.current.room, lastSeenAt: Date.now() });
      } else if (isReady(latest.current.config)) {
        caughtUp.current = false;
        void pump();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  /* ---- 玩家动作 ---- */
  const roomWritable = (): boolean => {
    if (!roomStorageBlocked(session)) return true;
    setSaveFailed(true);
    setToast('群聊存档已锁定，未保存本次修改。请备份并刷新。');
    return false;
  };
  const commitPlayerRoom = (next: Room): boolean => {
    if (!roomWritable()) return false;
    next = withRoomUsageFloor(next);
    if (!saveRoom(next, session)) { setSaveFailed(true); return false; }
    roomRef.current = next;
    latest.current = { ...latest.current, room: next };
    setRoom(next);
    return true;
  };
  const send = (text: string, mentions: string[], replyTo?: string) => {
    if (findCrisis(text)) {
      setCrisis(text);
      return false;
    }
    if (!roomWritable()) return false;
    const at = Date.now();
    // 演示模式的台词是模板，一条消息一个人接就够了，免得显得吵
    const cap = isMock(latest.current.config) ? 1 : undefined;
    return commitPlayerRoom(
      postPlayerMessage(
        latest.current.room,
        text,
        identity,
        mentions,
        replyTo,
        at,
        latest.current.roomSettings.liveliness,
        cap,
      ),
    );
  };

  const requestOne = async () => {
    if (working) return;
    if (!ready) {
      setToast('先接入一个模型，或者切到演示模式。');
      onOpenApi();
      return;
    }
    if (busy.current) { setToast('群聊正在回应，稍后再试'); return; }
    if (latest.current.blocked || roomStorageBlocked(session)) { setToast('群聊已暂停或存档需要恢复'); return; }
    await runRoomOperation('manual');
  };

  const finish = (id: string) => {
    if (!roomWritable()) return;
    const current = latest.current.room;
    const result = tryCompleteStep(current, id, Date.now(), latest.current.roomSettings.liveliness);
    if (!result.ok) { setToast(result.reason); return; }
    if (commitPlayerRoom(result.room)) setToast('做完了。群里会看到。');
  };
  const add = (text: string, group: string): boolean => {
    if (!roomWritable()) return false;
    const current = latest.current.room;
    const result = tryAddStep(current, text, group, identity, Date.now());
    if (!result.ok) { setToast(result.reason); return false; }
    return commitPlayerRoom(result.room);
  };

  const rename = (title: string) => commitPlayerRoom(renameRoom(latest.current.room, title));

  const reroll = () => {
    if (archiveStorageBlocked(session)) { setToast('旧群聊存档需要先备份并恢复，暂不能换群。'); return; }
    if (archives.length >= MAX_ARCHIVES) {
      setToast('旧群聊已经满了，先去「旧群聊」里舍弃一个再换人。');
      setPanel('archive');
      return;
    }
    if (!window.confirm('这 4 位会离开，聊天记录会收进「旧群聊」，之后还能放回当下。继续？')) return;
    pendingOperation.current?.abort();
    const { room: next, archived } = rerollRoom(latest.current.room, identity.name, Date.now());
    const nextArchives = [archived, ...archives].slice(0, MAX_ARCHIVES);
    if (!saveArchives(nextArchives, session) || !commitPlayerRoom(next)) { setSaveFailed(true); return; }
    setArchives(nextArchives);
    setPanel('none');
    setToast('换了一批群友');
  };

  const restore = (id: string) => {
    if (archiveStorageBlocked(session)) { setToast('旧群聊存档需要先恢复'); return; }
    const out = restoreArchive(latest.current.room, archives, id, Date.now());
    if (!out) {
      setToast('这个群聊找不到了。');
      return;
    }
    pendingOperation.current?.abort();
    if (!saveArchives(out.archives, session) || !commitPlayerRoom(out.room)) { setSaveFailed(true); return; }
    setArchives(out.archives);
    setPanel('none');
    setToast('把这个群聊放回了当下');
  };

  const discard = (id: string) => {
    if (archiveStorageBlocked(session)) { setToast('旧群聊存档需要先恢复'); return; }
    if (!window.confirm('舍弃之后就找不回来了，确定吗？')) return;
    const next = discardArchive(archives, id);
    if (!saveArchives(next, session)) { setSaveFailed(true); return; }
    setArchives(next);
    setToast('已经舍弃');
  };

  /* ---- 派生 ---- */
  const typingName = useMemo(() => {
    const due = room.scheduled
      .filter((s) => s.at > now && s.at - now < 3_000)
      .sort((a, b) => a.at - b.at)[0];
    if (!due) return '';
    return room.cast.find((p) => p.id === due.personaId)?.name ?? '';
  }, [room.scheduled, room.cast, now]);

  const stepCount = room.steps.filter((s) => s.ownerId === 'me' && !s.doneAt).length;
  const used = usedToday(room, now);

  return (
    <div className="room-view">
      {saveFailed && <div className="banner" role="alert">群聊保存未成功，最近的修改可能尚未落盘。请先备份原始存档，再刷新恢复。</div>}
      {roomStorageBlocked(session) && <div className="banner" role="alert">群聊存档不可安全读取或当前页面只读。已停止相关写入和模型调用；请先备份原始浏览器数据，再刷新。</div>}
      {archiveStorageBlocked(session) && !roomStorageBlocked(session) && <div className="banner" role="alert">旧群聊存档已隔离；当前群聊仍可使用。请先备份和恢复旧群聊，再执行换群或恢复。</div>}
      {!ready && (
        <div className="banner">
          <p>还没接入模型。点「未接入 API」，选「演示模式」也能完整走一遍。</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={onOpenApi}>
            去接入
          </button>
        </div>
      )}

      {crisis && (
        <div className="crisis-layer">
          <CrisisCard onClose={() => setCrisis('')} />
        </div>
      )}

      <ChatRoom
        room={room}
        identity={identity}
        typingName={typingName}
        busy={working}
        stepCount={stepCount}
        usage={{ used, limit: roomSettings.dailyMessages }}
        apiLabel={configLabel(config)}
        apiReady={ready}
        onSend={send}
        onRename={rename}
        onOpenSteps={() => setPanel('steps')}
        onOpenRoom={() => setPanel('room')}
        onOpenArchive={() => setPanel('archive')}
        onOpenApi={onOpenApi}
      />

      {panel !== 'none' && (
        <div
          className="scrim scrim-side"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPanel('none');
          }}
        >
          {panel === 'steps' && (
            <StepPanel
              room={room}
              busy={working}
              ready={ready}
              onClose={() => setPanel('none')}
              onAdd={add}
              onComplete={finish}
              onDrop={(id) => { commitPlayerRoom(dropStep(latest.current.room, id)); }}
              onShrink={(id) => { commitPlayerRoom(shrinkStep(latest.current.room, id)); }}
              onRequest={() => void requestOne()}
            />
          )}
          {panel === 'room' && (
            <RoomPanel
              settings={roomSettings}
              used={used}
              onChange={(next) => { if (roomWritable() && saveRoomSettings(next, session)) setRoomSettings(next); else setSaveFailed(true); }}
              onReroll={reroll}
              onOpenApi={onOpenApi}
              onClose={() => setPanel('none')}
            />
          )}
          {panel === 'archive' && (
            <ArchivePanel
              archives={archives}
              onRestore={restore}
              onDiscard={discard}
              onClose={() => setPanel('none')}
            />
          )}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
