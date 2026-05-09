import { create } from 'zustand';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

type CopilotoState = {
  isOpen: boolean;
  messages: Message[];
  open: () => void;
  close: () => void;
  toggle: () => void;
  addMessage: (m: Omit<Message, 'timestamp'>) => void;
  clearMessages: () => void;
};

export const useCopilotoStore = create<CopilotoState>((set) => ({
  isOpen: false,
  messages: [],
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  addMessage: (m) => set((s) => ({ messages: [...s.messages, { ...m, timestamp: Date.now() }] })),
  clearMessages: () => set({ messages: [] }),
}));
