/**
 * @format
 */
import { describe, expect, it, beforeEach } from '@jest/globals';

// AsyncStorage is mocked globally in jest.setup.js so the zustand `persist`
// middleware can hydrate synchronously in tests.

import { useAppStore } from '../src/store/appStore';

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      sessions: [],
      currentSessionId: null,
      messages: [],
      llmConnection: { apiBaseUrl: '', apiKey: '', model: '' },
      runtimeConnected: false,
      endpoint: 'cloud',
    });
  });

  describe('createSession', () => {
    it('appends a session, sets currentSessionId, and returns a non-empty id', () => {
      const before = useAppStore.getState().sessions.length;
      const id = useAppStore.getState().createSession('My chat');
      const state = useAppStore.getState();

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(state.sessions.length).toBe(before + 1);

      const session = state.sessions.find((s) => s.id === id);
      expect(session).toBeDefined();
      expect(session?.title).toBe('My chat');
      expect(session?.createdAt).toBeGreaterThan(0);
      expect(state.currentSessionId).toBe(id);
    });

    it('falls back to the default title when given an empty string', () => {
      const id = useAppStore.getState().createSession('');
      const session = useAppStore.getState().sessions.find((s) => s.id === id);
      expect(session?.title).toBe('新会话');
    });

    it('does not collide ids across two creations', () => {
      const a = useAppStore.getState().createSession('A');
      const b = useAppStore.getState().createSession('B');
      expect(a).not.toBe(b);
      expect(useAppStore.getState().sessions).toHaveLength(2);
      expect(useAppStore.getState().currentSessionId).toBe(b);
    });
  });

  describe('appendMessage', () => {
    it('appends messages tagged with the session id, role, and text', () => {
      const sessionId = useAppStore.getState().createSession('S');
      useAppStore.getState().appendMessage({ sessionId, role: 'user', text: 'hi' });
      useAppStore.getState().appendMessage({ sessionId, role: 'assistant', text: 'yo' });

      const msgs = useAppStore.getState().messages.filter((m) => m.sessionId === sessionId);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe('user');
      expect(msgs[0].text).toBe('hi');
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[1].text).toBe('yo');
      expect(msgs[0].id).not.toBe(msgs[1].id);
      expect(msgs[0].createdAt).toBeGreaterThan(0);
    });

    it('keeps messages isolated per session', () => {
      const a = useAppStore.getState().createSession('A');
      const b = useAppStore.getState().createSession('B');
      useAppStore.getState().appendMessage({ sessionId: a, role: 'user', text: 'in-a' });
      useAppStore.getState().appendMessage({ sessionId: b, role: 'user', text: 'in-b' });

      const inA = useAppStore.getState().messages.filter((m) => m.sessionId === a);
      const inB = useAppStore.getState().messages.filter((m) => m.sessionId === b);
      expect(inA).toHaveLength(1);
      expect(inA[0].text).toBe('in-a');
      expect(inB).toHaveLength(1);
      expect(inB[0].text).toBe('in-b');
    });
  });

  describe('setLlmConnection', () => {
    it('merges partial fields into llmConnection without dropping the others', () => {
      expect(useAppStore.getState().llmConnection).toEqual({
        apiBaseUrl: '',
        apiKey: '',
        model: '',
      });

      useAppStore.getState().setLlmConnection({ apiBaseUrl: 'https://api.x/v1' });
      const afterFirst = useAppStore.getState().llmConnection;
      expect(afterFirst.apiBaseUrl).toBe('https://api.x/v1');
      expect(afterFirst.apiKey).toBe('');
      expect(afterFirst.model).toBe('');

      useAppStore.getState().setLlmConnection({ apiKey: 'sk-1', model: 'gpt-4o' });
      expect(useAppStore.getState().llmConnection).toEqual({
        apiBaseUrl: 'https://api.x/v1',
        apiKey: 'sk-1',
        model: 'gpt-4o',
      });
    });

    it('overwrites a field when the same key is set again', () => {
      useAppStore.getState().setLlmConnection({ model: 'gpt-4o' });
      useAppStore.getState().setLlmConnection({ model: 'claude' });
      expect(useAppStore.getState().llmConnection.model).toBe('claude');
    });
  });
});