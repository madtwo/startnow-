import { useEffect, useMemo, useRef, useState } from 'react';
import ArchivePanel from './ArchivePanel';
import ChatRoom from './ChatRoom';
import CrisisCard from './CrisisCard';
import RoomPanel from './RoomPanel';
import StepPanel from './StepPanel';
import { configLabel, isReady } from '../config/providers';
import { pickCast } from '../lib/personas';
import {
  addStep,
  catchUpRoom,
  completeStep,
  discardArchive,
  dropStep,
  MAX_ARCHIVES,
  newRoom,
  postPlayerMessage,
  requestStep as askStep,
  rerollRoom,
  restoreArchive,
  shrinkStep,
  tickRoom,
  usedToday,
} from '../lib/room';
import { findCrisis } from '../lib/safety';
import {
  loadArchives,
  loadRoom,
  loadRoomSettings,
  saveArchives,
  saveRoom,
  saveRoomSettings,
} from '../lib/store';
import type { Identity, LlmConfig, Room, RoomSettings } from '../types';

const TICK_MS = 4000;

type Panel = 'none' | 'steps' | 'room' | 'archive';

interface Props {
  identity: Identity;
  config: LlmConfig;
  onOpenApi: () => void;
}

export default function RoomView({ identity, config, onOpenApi }: Props) {
  const [roomSettings, setRoomSettings] = useState<RoomSettings>(() => loadRoomSettings());
  const [archives, setArchives] = useState<Room[]>(() => loadArchives());
  const [room, setRoom] = useState<Room>(() => loadRoom() ?? newRoom(pickCast(4)));
  const [panel, setPanel] = useState<Panel>('none');
  const [working, setWorking] = useState(false);
  const [toast, setToast] = useState('');
  const [crisis, setCrisis] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const ready = isReady(config);
  const busy = useRef(false);
  const caughtUp = useRef(false);
  const roomRef = useRef(room);
  const latest = useRef({ room, roomSettings, config });
  latest.current = { room, roomSettings, config };
  roomRef.current = room;

  /* ---- UI 时钟：只为了「正在输入」和用量数字 ---- */
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  /* ---- 落盘 ---- */
  useEffect(() => {
    const id = window.setTimeout(() => saveRoom(room), 500);
    return () => window.clearTimeout(id);
  }, [room]);
  useEffect(() => saveArchives(archives), [archives]);
  useEffect(() => saveRoomSettings(roomSettings), [roomSettings]);
  useEffect(() => () => saveRoom(roomRef.current), []);

  /* ---- 一次 tick ---- */
  const tick = async () => {
    if (busy.current) return;
    const cur = latest.current;
    if (!isReady(cur.config)) return;
    if (usedToday(cur.room) >= cur.roomSettings.dailyMessages) return;
    busy.current = true;
    try {
      const out = await tickRoom({
        room: cur.room,
        settings: cur.roomSettings,
        config: cur.config,
      });
      setRoom(out.room);
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void tick();
    }, TICK_MS);
    void tick();
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  /* ---- 回来时补算 ---- */
  const runCatchUp = async () => {
    const cur = latest.current;
    if (!isReady(cur.config)) return;
    const out = await catchUpRoom({
      room: cur.room,
      settings: cur.roomSettings,
      config: cur.config,
    });
    setRoom(out.room);
  };

  useEffect(() => {
    if (!ready) return;
    // StrictMode 会把 effect 跑两遍，这里只补一次
    if (caughtUp.current) return;
    caughtUp.current = true;
    void runCatchUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setRoom((prev) => ({ ...prev, lastSeenAt: Date.now() }));
      } else if (isReady(latest.current.config)) {
        void runCatchUp();
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
  const send = (text: string, mentions: string[], replyTo?: string) => {
    if (findCrisis(text)) {
      setCrisis(text);
      return;
    }
    const at = Date.now();
    setRoom((prev) =>
      postPlayerMessage(prev, text, identity, mentions, replyTo, at, latest.current.roomSettings.liveliness),
    );
  };

  const requestOne = async () => {
    if (working) return;
    if (!ready) {
      setToast('先接入一个模型，或者切到演示模式。');
      onOpenApi();
      return;
    }
    setWorking(true);
    try {
      const out = await askStep(latest.current.room, { config: latest.current.config });
      setRoom(out.room);
      setToast('有人给了一个下一步');
    } finally {
      setWorking(false);
    }
  };

  const finish = (id: string) => {
    setRoom((prev) => completeStep(prev, id, Date.now(), latest.current.roomSettings.liveliness));
    setToast('做完了。群里会看到。');
  };

  const reroll = () => {
    if (archives.length >= MAX_ARCHIVES) {
      setToast('旧群聊已经满了，先去「旧群聊」里舍弃一个再换人。');
      setPanel('archive');
      return;
    }
    if (!window.confirm('这 4 位会离开，聊天记录会收进「旧群聊」，之后还能放回当下。继续？')) return;
    const { room: next, archived } = rerollRoom(latest.current.room, Date.now());
    setRoom(next);
    setArchives((prev) => [archived, ...prev].slice(0, MAX_ARCHIVES));
    setPanel('none');
    setToast('换了一批群友');
  };

  const restore = (id: string) => {
    const out = restoreArchive(latest.current.room, archives, id, Date.now());
    if (!out) {
      setToast('这个群聊找不到了。');
      return;
    }
    setRoom(out.room);
    setArchives(out.archives);
    setPanel('none');
    setToast('把这个群聊放回了当下');
  };

  const discard = (id: string) => {
    if (!window.confirm('舍弃之后就找不回来了，确定吗？')) return;
    setArchives((prev) => discardArchive(prev, id));
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
              onAdd={(text, group) =>
                setRoom((prev) => addStep(prev, text, group, identity, Date.now()))
              }
              onComplete={finish}
              onDrop={(id) => setRoom((prev) => dropStep(prev, id))}
              onShrink={(id) => setRoom((prev) => shrinkStep(prev, id))}
              onRequest={() => void requestOne()}
            />
          )}
          {panel === 'room' && (
            <RoomPanel
              settings={roomSettings}
              used={used}
              onChange={setRoomSettings}
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
