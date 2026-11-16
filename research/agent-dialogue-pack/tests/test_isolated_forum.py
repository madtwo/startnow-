"""No-model deterministic tests for the toy backend. Run: python3 -m unittest discover -s tests -v"""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'demo'))
from isolated_forum_demo import ForumBackend, NotVisible, WrongOwner, Memory

class IsolationTests(unittest.TestCase):
    def setUp(self):
        self.b = ForumBackend(('yanggao','weini','shenmo','miaoze'), 'rules-v1')
        self.y = self.b.agent_session('yanggao')
        self.w = self.b.agent_session('weini')
        self.s = self.b.agent_session('shenmo')
        self.m = self.b.agent_session('miaoze')

    def test_public_not_automatically_visible(self):
        event = self.y.publish('今天忙学费材料')
        with self.assertRaises(NotVisible): self.w.read_event(event.event_id)
        self.b.platform_deliver('weini', event.event_id)
        self.assertEqual(self.w.read_event(event.event_id), event)
        with self.assertRaises(NotVisible): self.m.read_event(event.event_id)

    def test_private_dm_only_participants(self):
        e=self.s.dm('miaoze','私聊：不对其他代理透露')
        self.assertEqual(self.s.read_event(e.event_id),e)
        self.assertEqual(self.m.read_event(e.event_id),e)
        for other in (self.w, self.y):
            with self.assertRaises(NotVisible): other.read_event(e.event_id)
        with self.assertRaises(NotVisible): self.b.platform_deliver('weini',e.event_id)

    def test_memories_separated_not_bulk_updated(self):
        e=self.y.publish('我的帖子')
        self.b.platform_deliver('weini',e.event_id)
        self.w.observe(e.event_id,'我看到杨槔的帖子')
        self.w.believe(e.event_id,'她可能很累',confidence=0.3)
        self.assertEqual(len(self.w.memories()),2)
        self.assertEqual(len(self.y.memories()),0)
        self.assertEqual(len(self.s.memories()),0)
        self.assertEqual(len(self.m.memories()),0)
        with self.assertRaises(WrongOwner): self.m.suspicious_cross_read('weini')
        self.b.update_shared_policy('rules-v2')
        self.assertEqual(len(self.w.memories()),2)
        self.assertEqual(len(self.m.memories()),0)
        self.assertEqual(self.b.shared_policy,'rules-v2')

    def test_no_source_no_memory(self):
        e=self.y.publish('未看到的内容')
        with self.assertRaises(NotVisible): self.m.observe(e.event_id,'我知道了')
        with self.assertRaises(NotVisible): self.w.believe(e.event_id,'可能如此')

    def test_relations_are_owner_specific(self):
        e=self.y.publish('大家好')
        self.b.platform_deliver('weini',e.event_id)
        self.w.set_impression('yanggao',e.event_id,'觉得她热情')
        self.assertEqual(self.w.impression('yanggao'),'觉得她热情')
        self.assertIsNone(self.m.impression('yanggao'))
        self.assertIsNone(self.y.impression('weini'))

    def test_cannot_reply_to_unseen_post(self):
        e=self.y.publish('发帖')
        with self.assertRaises(NotVisible): self.w.publish('回复',reply_to=e.event_id)
        self.b.platform_deliver('weini',e.event_id)
        r=self.w.publish('现在看到了',reply_to=e.event_id)
        with self.assertRaises(NotVisible): self.y.read_event(r.event_id)
        self.b.platform_deliver('yanggao',r.event_id)
        self.assertEqual(self.y.read_event(r.event_id),r)

    def test_no_duplicate_memory_or_exposure(self):
        e=self.y.publish('发布')
        self.b.platform_deliver('weini',e.event_id)
        self.b.platform_deliver('weini',e.event_id)
        self.w.observe(e.event_id,'已看到')
        self.w.observe(e.event_id,'已看到')
        self.assertEqual(len(self.w.memories()),1)

    def test_nonexistent_agent_fails(self):
        with self.assertRaises(WrongOwner): self.b.agent_session('evil')
        e=self.y.publish('发帖')
        with self.assertRaises(WrongOwner): self.b.platform_deliver('evil',e.event_id)

    def test_invalid_confidence_rejected(self):
        e=self.y.publish('消息')
        self.b.platform_deliver('weini',e.event_id)
        with self.assertRaises(ValueError): self.w.believe(e.event_id,'不合法',confidence=1.5)

if __name__ == '__main__': unittest.main()
