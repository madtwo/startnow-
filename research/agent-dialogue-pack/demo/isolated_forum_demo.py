"""StartNow minimal standard-library isolation demonstration.

This is NOT an LLM, authentication server, privacy certification or full forum.
The private capability issuance in ForumBackend.agent_session is intended to be
called only after authentication/authorization by a real production server.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Tuple, Optional, List
from types import MappingProxyType


class NotVisible(PermissionError):
    pass


class WrongOwner(PermissionError):
    pass


@dataclass(frozen=True)
class Event:
    event_id: str
    author: str
    channel: str  # public | dm
    content: str
    recipient: Optional[str] = None
    reply_to: Optional[str] = None


@dataclass(frozen=True)
class Memory:
    owner: str
    kind: str  # observation | belief | preference
    note: str
    source_event: str
    confidence: float = 1.0


@dataclass
class _State:
    events: Dict[str, Event] = field(default_factory=dict)
    seen: Dict[str, set[str]] = field(default_factory=dict)
    memories: Dict[str, List[Memory]] = field(default_factory=dict)
    relations: Dict[Tuple[str, str], str] = field(default_factory=dict)
    next_id: int = 1


class AgentSession:
    """Owner-scoped facade: no API method accepts a different memory owner."""

    def __init__(self, backend: "ForumBackend", agent_id: str):
        self.__backend = backend
        self.__agent_id = agent_id

    @property
    def agent_id(self) -> str:
        return self.__agent_id

    def read_event(self, event_id: str) -> Event:
        return self.__backend._read_event(self.__agent_id, event_id)

    def memories(self) -> tuple[Memory, ...]:
        return self.__backend._memories_for(self.__agent_id)

    def observe(self, event_id: str, note: str) -> Memory:
        event = self.read_event(event_id)
        mem = Memory(self.__agent_id, "observation", note, event.event_id)
        return self.__backend._save_memory(self.__agent_id, mem)

    def believe(self, event_id: str, note: str, confidence: float = 0.5) -> Memory:
        self.read_event(event_id)
        if not (0 <= confidence <= 1):
            raise ValueError("confidence must be between 0 and 1")
        mem = Memory(self.__agent_id, "belief", note, event_id, confidence)
        return self.__backend._save_memory(self.__agent_id, mem)

    def set_impression(self, person_id: str, source_event_id: str, text: str) -> None:
        self.read_event(source_event_id)
        self.__backend._set_relation(self.__agent_id, person_id, text)

    def impression(self, person_id: str) -> Optional[str]:
        return self.__backend._get_relation(self.__agent_id, person_id)

    def publish(self, content: str, reply_to: Optional[str] = None) -> Event:
        if reply_to is not None:
            # The responder must have actually seen the event being replied to.
            self.read_event(reply_to)
        return self.__backend._publish(self.__agent_id, "public", content, reply_to=reply_to)

    def dm(self, recipient: str, content: str) -> Event:
        return self.__backend._publish(self.__agent_id, "dm", content, recipient=recipient)

    def suspicious_cross_read(self, other_agent_id: str) -> tuple[Memory, ...]:
        """A deliberately guarded misuse example, not a production API."""
        if other_agent_id != self.__agent_id:
            raise WrongOwner("other agents' private memories are not readable")
        return self.memories()


class ForumBackend:
    """Toy trusted backend. A real system must authenticate BEFORE issuing sessions.

    The state is private by API convention, not cryptographic or OS isolation.
    Direct Python introspection can reach it; this is not a production security boundary.
    """

    def __init__(self, agent_ids: tuple[str, ...], policy: str):
        self.__ids = frozenset(agent_ids)
        self.__state = _State()
        self.__policy = policy
        for agent in agent_ids:
            self.__state.seen[agent] = set()
            self.__state.memories[agent] = []

    @property
    def shared_policy(self) -> str:
        return self.__policy

    def update_shared_policy(self, policy: str) -> None:
        # An admin-only operation in production; it changes rules, not memories.
        self.__policy = policy

    def agent_session(self, authenticated_agent_id: str) -> AgentSession:
        """Trust boundary: only server auth code should call this method.

        DO NOT expose agent_session to the public API and accept arbitrary IDs.
        """
        self._require_known(authenticated_agent_id)
        return AgentSession(self, authenticated_agent_id)

    def platform_deliver(self, recipient: str, event_id: str) -> None:
        """Called by trusted feed routing when content is ACTUALLY shown to agent."""
        self._require_known(recipient)
        event = self.__state.events[event_id]
        if event.channel != "public":
            raise NotVisible("only public events can be delivered by a feed")
        self.__state.seen[recipient].add(event_id)

    def _require_known(self, agent: str) -> None:
        if agent not in self.__ids:
            raise WrongOwner("invalid authenticated agent")

    def _read_event(self, agent: str, event_id: str) -> Event:
        self._require_known(agent)
        event = self.__state.events[event_id]
        if event_id not in self.__state.seen[agent]:
            raise NotVisible("event was not exposed to this agent")
        if event.channel == "dm" and agent not in (event.author, event.recipient):
            raise NotVisible("private DM outside participant set")
        return event

    def _save_memory(self, agent: str, memory: Memory) -> Memory:
        self._require_known(agent)
        if memory.owner != agent:
            raise WrongOwner("cannot write another agent's memory")
        self._read_event(agent, memory.source_event)
        if memory not in self.__state.memories[agent]:
            self.__state.memories[agent].append(memory)
        return memory

    def _memories_for(self, agent: str) -> tuple[Memory, ...]:
        self._require_known(agent)
        return tuple(self.__state.memories[agent])

    def _set_relation(self, agent: str, subject: str, impression: str) -> None:
        self._require_known(agent)
        self.__state.relations[agent, subject] = impression

    def _get_relation(self, agent: str, subject: str) -> Optional[str]:
        self._require_known(agent)
        return self.__state.relations.get((agent, subject))

    def _publish(self, author: str, channel: str, content: str,
                 recipient: Optional[str] = None, reply_to: Optional[str] = None) -> Event:
        self._require_known(author)
        if channel == "dm":
            if recipient is None:
                raise ValueError("dm recipient required")
            self._require_known(recipient)
        elif channel != "public":
            raise ValueError("unknown channel")
        eid = f"ev_{self.__state.next_id:03d}"
        self.__state.next_id += 1
        event = Event(eid, author, channel, content, recipient, reply_to)
        self.__state.events[eid] = event
        self.__state.seen[author].add(eid)
        if channel == "dm":
            self.__state.seen[recipient].add(eid)
        # Public post only appears to OTHERS after actual feed delivery.
        return event


def example_run() -> None:
    b = ForumBackend(("yanggao", "weini", "miaoze", "shenmo"),
                     "共同规则：尊重、隐私、安全、网上交流；不共享记忆。")
    yang = b.agent_session("yanggao")
    wei = b.agent_session("weini")
    miao = b.agent_session("miaoze")
    shen = b.agent_session("shenmo")

    e = yang.publish("资助窗口要盖好几个章，唉。"); print("公开帖子：", e.content)
    b.platform_deliver("weini", e.event_id)
    wei.observe(e.event_id, "看见杨槔公开说材料麻烦")
    wei.believe(e.event_id, "她可能不想一直说家里的事", confidence=0.4)
    print("魏霓可见记忆：", [x.note for x in wei.memories()])
    print("苗泽可见记忆：", [x.note for x in miao.memories()])
    try:
        miao.read_event(e.event_id)
    except NotVisible:
        print("通过：苗泽没刷到，不能读取杨槔帖子。")

    response = wei.publish("啊……你还好吗？", reply_to=e.event_id)
    try:
        yang.read_event(response.event_id)
    except NotVisible:
        print("通过：杨槔在打开评论前也未自动获得魏霓的回应。")
    b.platform_deliver("yanggao", response.event_id)
    yang.observe(response.event_id, "魏霓在评论区问我还好吗")
    yang.set_impression("weini", response.event_id, "她好像挺细心")
    print("杨槔对魏霓的印象：", yang.impression("weini"))
    print("沈默对魏霓的印象：", shen.impression("weini"))

    dm = shen.dm("miaoze", "我今天复习快背吐了，这话只跟你说")
    try:
        wei.read_event(dm.event_id)
    except NotVisible:
        print("通过：魏霓不能读取沈默与苗泽的私聊。")
    shen.observe(dm.event_id, "自己跟苗泽抱怨了复习")
    print("沈默私聊记忆条数：", len(shen.memories()))
    print("魏霓私聊记忆不会增加：", len(wei.memories()))
    b.update_shared_policy("新共同规则：隐私安全；更克制的主动回复。")
    print("更新共同规则后各角色记忆条数：", {a.agent_id: len(a.memories()) for a in (yang, wei, miao, shen)})


if __name__ == "__main__":
    example_run()
