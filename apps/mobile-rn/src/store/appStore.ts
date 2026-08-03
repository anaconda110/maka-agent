import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadApiKey, saveApiKey } from '../services/keychainStorage';

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
}

export interface MessageMeta {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  createdAt: number;
}

export interface LlmConnectionConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

export interface AppState {
  sessions: SessionMeta[];
  currentSessionId: string | null;
  messages: MessageMeta[];
  llmConnection: LlmConnectionConfig;
  runtimeConnected: boolean;
  endpoint: string;
  createSession: (title: string) => string;
  deleteSession: (id: string) => void;
  setCurrentSession: (id: string | null) => void;
  appendMessage: (input: { sessionId: string; role: MessageMeta['role']; text: string }) => void;
  setLlmConnection: (input: Partial<LlmConnectionConfig>) => void;
  loadApiKeyFromKeychain: () => Promise<void>;
  setRuntimeConnected: (connected: boolean) => void;
  setEndpoint: (endpoint: string) => void;
}

const newId = () =>
  `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const newMessageId = () =>
  `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const DEFAULT_LLM_CONNECTION: LlmConnectionConfig = {
  apiBaseUrl: '',
  apiKey: '',
  model: '',
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sessions: [],
      currentSessionId: null,
      messages: [],
      llmConnection: { ...DEFAULT_LLM_CONNECTION },
      runtimeConnected: false,
      endpoint: 'cloud',
      createSession: (title) => {
        const session: SessionMeta = {
          id: newId(),
          title: title.length > 0 ? title : '新会话',
          createdAt: Date.now(),
        };
        set((state) => ({
          sessions: [...state.sessions, session],
          currentSessionId: session.id,
        }));
        return session.id;
      },
      deleteSession: (id) =>
        set((state) => ({
          sessions: state.sessions.filter((session) => session.id !== id),
          messages: state.messages.filter((message) => message.sessionId !== id),
          currentSessionId:
            state.currentSessionId === id ? null : state.currentSessionId,
        })),
      setCurrentSession: (id) => set({ currentSessionId: id }),
      appendMessage: ({ sessionId, role, text }) =>
        set((state) => ({
          messages: [
            ...state.messages,
            {
              id: newMessageId(),
              sessionId,
              role,
              text,
              createdAt: Date.now(),
            },
          ],
        })),
      setLlmConnection: (input) =>
        set((state) => {
          const next = { ...state.llmConnection, ...input };
          if (input.apiKey !== undefined) {
            void saveApiKey(input.apiKey);
          }
          return { llmConnection: next };
        }),
      loadApiKeyFromKeychain: async () => {
        const apiKey = await loadApiKey();
        set((state) => ({
          llmConnection: { ...state.llmConnection, apiKey },
        }));
      },
      setRuntimeConnected: (connected) => set({ runtimeConnected: connected }),
      setEndpoint: (endpoint) => set({ endpoint }),
    }),
    {
      name: 'maka-mobile-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        sessions: state.sessions,
        currentSessionId: state.currentSessionId,
        messages: state.messages,
        llmConnection: {
          apiBaseUrl: state.llmConnection.apiBaseUrl,
          apiKey: '',
          model: state.llmConnection.model,
        },
        endpoint: state.endpoint,
      }),
    },
  ),
);