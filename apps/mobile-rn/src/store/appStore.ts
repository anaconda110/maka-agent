import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
}

export interface AppState {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  runtimeConnected: boolean;
  endpoint: string;
  createSession: (title: string) => string;
  setActiveSession: (id: string | null) => void;
  setRuntimeConnected: (connected: boolean) => void;
  setEndpoint: (endpoint: string) => void;
}

const newId = () =>
  `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sessions: [],
      activeSessionId: null,
      runtimeConnected: false,
      endpoint: 'cloud',
      createSession: (title) => {
        const session: SessionMeta = {
          id: newId(),
          title,
          createdAt: Date.now(),
        };
        set((state) => ({
          sessions: [...state.sessions, session],
          activeSessionId: session.id,
        }));
        return session.id;
      },
      setActiveSession: (id) => set({ activeSessionId: id }),
      setRuntimeConnected: (connected) => set({ runtimeConnected: connected }),
      setEndpoint: (endpoint) => set({ endpoint }),
    }),
    {
      name: 'maka-mobile-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        sessions: state.sessions,
        endpoint: state.endpoint,
      }),
    },
  ),
);