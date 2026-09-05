import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  AIProviderConfig,
  AIMessage,
  AIToolCall,
  AIStreamRequest,
  ClaudeAuthStatus,
  ApprovalRequest,
  SubagentInfo,
  RateLimitWarning,
  ProjectAgentStatus,
  AutoApproveRules
} from '../types/electron';

export interface AISession {
  id: string;
  title: string;
  createdAt: number;
  messages: AIMessage[];
  claudeCliSessionId?: string;
}

interface AIStudioState {
  sessions: Record<string, AISession[]>; // projectPath -> list of sessions
  activeSessionId: Record<string, string>; // projectPath -> active sessionId
  lastActiveSessionId: Record<string, string>; // projectPath -> previous active sessionId
  isStreaming: boolean;
  activeStreamSessionId: string | null;
  config: AIProviderConfig;
  mode: 'chat' | 'agent' | 'architect';
  isSettingsOpen: boolean;
  claudeAuth: ClaudeAuthStatus | null;

  // Subagents & Human Approvals & Rate Limits
  pendingApprovals: Record<string, ApprovalRequest[]>; // projectPath -> active requests
  subagents: Record<string, SubagentInfo[]>; // projectPath -> active subagents
  rateLimitWarnings: Record<string, RateLimitWarning | null>; // projectPath -> active warning
  projectStatuses: Record<string, ProjectAgentStatus>; // projectPath -> status
  liveOutputs: Record<string, string>; // projectPath -> console output string
  isSubagentsPanelOpen: boolean;
  isActivitySidebarOpen: boolean;
  setIsSubagentsPanelOpen: (open: boolean) => void;
  setIsActivitySidebarOpen: (open: boolean) => void;
  clearLiveOutput: (projectPath: string) => void;
  sendApprovalResponse: (projectPath: string, requestId: string, approved: boolean, text?: string) => Promise<void>;
  fetchSubagents: (projectPath: string) => Promise<void>;
  dismissRateLimitWarning: (projectPath: string) => void;

  // Actions
  fetchConfig: () => Promise<void>;
  saveConfig: (config: AIProviderConfig) => Promise<void>;
  fetchClaudeAuth: () => Promise<void>;
  startClaudeLogin: () => Promise<void>;
  claudeLogout: () => Promise<void>;
  setMode: (mode: 'chat' | 'agent' | 'architect') => void;
  setIsSettingsOpen: (open: boolean) => void;
  createSession: (projectPath: string, initialTitle?: string) => string;
  switchSession: (projectPath: string, sessionId: string) => void;
  switchSessionByIndex: (projectPath: string, index: number) => void;
  switchToNextSession: (projectPath: string) => void;
  switchToPrevSession: (projectPath: string) => void;
  switchToLastActiveSession: (projectPath: string) => void;
  closeSession: (projectPath: string, sessionId: string) => void;
  closeCurrentSession: (projectPath: string) => void;
  renameSession: (projectPath: string, sessionId: string, newTitle: string) => void;
  clearSession: (projectPath: string, sessionId?: string) => void;
  sendMessage: (projectPath: string, text: string) => Promise<void>;
  abortStream: () => Promise<void>;
  acceptDiff: (projectPath: string, messageId: string, toolId: string, filePath: string, newContent: string) => Promise<void>;
  rejectDiff: (projectPath: string, messageId: string, toolId: string) => void;
}

export const DEFAULT_AUTO_APPROVE_RULES: AutoApproveRules = {
  enabled: true,
  allowCommands: true,
  allowFileWrite: true,
  allowFileRead: true,
  allowSubagents: true,
  writeExcludePatterns: ['.env*', '**/*.key', '**/*.pem', 'infra.config.json'],
  readExcludePatterns: ['.env*', '**/*.key', '**/*.pem', '**/id_rsa*'],
  commandDenyList: ['rm -rf', 'git push', 'git reset --hard', 'del /f /s /q']
};

const DEFAULT_CONFIG: AIProviderConfig = {
  provider: 'anthropic',
  model: 'default',
  temperature: 0.7,
  thinkingBudget: 2048,
  autoApprove: false,
  autoApproveRules: DEFAULT_AUTO_APPROVE_RULES
};

/**
 * Сообщает main-процессу, что сессия закрыта/очищена: там отклоняются ожидающие одобрения,
 * убиваются процессы сессии и забывается resume-id Claude CLI (TASK-33).
 */
function releaseSessionInMain(sessionId: string): void {
  window.api?.clearAISession?.(sessionId).catch((err: unknown) => {
    console.error('Failed to clear AI session in main:', err);
  });
}

/** Сброс состояния стрима и ожидающих одобрений, относящихся к закрываемой/очищаемой сессии. */
function sessionResetPatch(
  state: Pick<AIStudioState, 'activeStreamSessionId' | 'pendingApprovals'>,
  projectPath: string,
  sessionId: string | undefined
): Partial<Pick<AIStudioState, 'isStreaming' | 'activeStreamSessionId' | 'pendingApprovals'>> {
  if (!sessionId) return {};
  const patch: Partial<Pick<AIStudioState, 'isStreaming' | 'activeStreamSessionId' | 'pendingApprovals'>> = {};
  if (state.activeStreamSessionId === sessionId) {
    patch.isStreaming = false;
    patch.activeStreamSessionId = null;
  }
  const current = state.pendingApprovals[projectPath] || [];
  if (current.some((r) => r.sessionId === sessionId)) {
    patch.pendingApprovals = {
      ...state.pendingApprovals,
      [projectPath]: current.filter((r) => r.sessionId !== sessionId)
    };
  }
  return patch;
}

function createInitialSession(): AISession {
  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    title: 'Новый диалог',
    createdAt: Date.now(),
    messages: []
  };
}

export const useAIStudioStore = create<AIStudioState>()(
  persist(
    (set, get) => ({
      sessions: {},
      activeSessionId: {},
      lastActiveSessionId: {},
      isStreaming: false,
      activeStreamSessionId: null,
      config: DEFAULT_CONFIG,
      mode: 'agent',
      isSettingsOpen: false,
      claudeAuth: null,
      pendingApprovals: {},
      subagents: {},
      rateLimitWarnings: {},
      projectStatuses: {},
      liveOutputs: {},
      isSubagentsPanelOpen: false,
      isActivitySidebarOpen: false,

      setIsSubagentsPanelOpen: (isSubagentsPanelOpen) => set({ isSubagentsPanelOpen }),
      setIsActivitySidebarOpen: (isActivitySidebarOpen) => set({ isActivitySidebarOpen }),

      clearLiveOutput: (projectPath: string) => {
        set((state) => ({
          liveOutputs: {
            ...state.liveOutputs,
            [projectPath]: ''
          }
        }));
      },

      dismissRateLimitWarning: (projectPath: string) => {
        set((state) => ({
          rateLimitWarnings: {
            ...state.rateLimitWarnings,
            [projectPath]: null
          }
        }));
      },

      fetchSubagents: async (projectPath: string) => {
        if (window.api?.getSubagents) {
          try {
            const list = await window.api.getSubagents(projectPath);
            set((state) => ({
              subagents: {
                ...state.subagents,
                [projectPath]: list
              }
            }));
          } catch (e) {
            console.error('Failed to fetch subagents:', e);
          }
        }
      },

      sendApprovalResponse: async (projectPath: string, requestId: string, approved: boolean, text?: string) => {
        if (window.api?.sendApprovalResponse) {
          try {
            await window.api.sendApprovalResponse(requestId, { approved, text });
            set((state) => {
              const current = state.pendingApprovals[projectPath] || [];
              return {
                pendingApprovals: {
                  ...state.pendingApprovals,
                  [projectPath]: current.filter((r) => r.id !== requestId)
                }
              };
            });
          } catch (e) {
            console.error('Failed to send approval response:', e);
          }
        }
      },

      fetchConfig: async () => {
        if (window.api?.getAIConfig) {
          try {
            const loaded = await window.api.getAIConfig();
            if (loaded) {
              set((state) => ({
                config: {
                  ...state.config,
                  ...loaded
                }
              }));
            }
          } catch (err) {
            console.error('Failed to fetch AI config:', err);
          }
        }
      },

      fetchClaudeAuth: async () => {
        if (window.api?.getClaudeAuthStatus) {
          try {
            const auth = await window.api.getClaudeAuthStatus();
            set({ claudeAuth: auth });
          } catch (err) {
            console.error('Failed to fetch Claude auth status:', err);
          }
        }
      },

      startClaudeLogin: async () => {
        if (window.api?.startClaudeLogin) {
          try {
            await window.api.startClaudeLogin();
          } catch (err) {
            console.error('Failed to start Claude login:', err);
          }
        }
      },

      claudeLogout: async () => {
        if (window.api?.claudeLogout) {
          try {
            await window.api.claudeLogout();
            set({ claudeAuth: { isLoggedIn: false } });
          } catch (err) {
            console.error('Failed to log out from Claude:', err);
          }
        }
      },

      saveConfig: async (config: AIProviderConfig) => {
        set({ config });
        if (window.api?.saveAIConfig) {
          try {
            await window.api.saveAIConfig(config);
          } catch (err) {
            console.error('Failed to save AI config:', err);
          }
        }
      },

      setMode: (mode) => set({ mode }),
      setIsSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),

      createSession: (projectPath: string, initialTitle?: string) => {
        const existing = get().sessions[projectPath] || [];
        const newSession: AISession = {
          id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title: initialTitle || `Диалог ${existing.length + 1}`,
          createdAt: Date.now(),
          messages: []
        };

        set((state) => {
          const current = state.sessions[projectPath] || [];
          return {
            sessions: {
              ...state.sessions,
              [projectPath]: [...current, newSession]
            },
            activeSessionId: {
              ...state.activeSessionId,
              [projectPath]: newSession.id
            }
          };
        });

        return newSession.id;
      },

      switchSession: (projectPath: string, sessionId: string) => {
        const cur = get().activeSessionId[projectPath];
        set((state) => ({
          lastActiveSessionId: cur && cur !== sessionId
            ? { ...state.lastActiveSessionId, [projectPath]: cur }
            : state.lastActiveSessionId,
          activeSessionId: {
            ...state.activeSessionId,
            [projectPath]: sessionId
          }
        }));
      },

      switchSessionByIndex: (projectPath: string, index: number) => {
        const sessions = get().sessions[projectPath] || [];
        if (index >= 0 && index < sessions.length) {
          get().switchSession(projectPath, sessions[index].id);
        }
      },

      switchToNextSession: (projectPath: string) => {
        const sessions = get().sessions[projectPath] || [];
        if (sessions.length <= 1) return;
        const curId = get().activeSessionId[projectPath];
        const curIdx = sessions.findIndex((s) => s.id === curId);
        const nextIdx = (curIdx + 1) % sessions.length;
        get().switchSession(projectPath, sessions[nextIdx].id);
      },

      switchToPrevSession: (projectPath: string) => {
        const sessions = get().sessions[projectPath] || [];
        if (sessions.length <= 1) return;
        const curId = get().activeSessionId[projectPath];
        const curIdx = sessions.findIndex((s) => s.id === curId);
        const prevIdx = (curIdx - 1 + sessions.length) % sessions.length;
        get().switchSession(projectPath, sessions[prevIdx].id);
      },

      switchToLastActiveSession: (projectPath: string) => {
        const lastId = get().lastActiveSessionId[projectPath];
        const sessions = get().sessions[projectPath] || [];
        if (lastId && sessions.some((s) => s.id === lastId)) {
          get().switchSession(projectPath, lastId);
        } else {
          get().switchToPrevSession(projectPath);
        }
      },

      closeCurrentSession: (projectPath: string) => {
        const curId = get().activeSessionId[projectPath];
        if (curId) {
          get().closeSession(projectPath, curId);
        }
      },

      renameSession: (projectPath: string, sessionId: string, newTitle: string) => {
        const cleanTitle = newTitle.trim();
        if (!cleanTitle) return;
        set((state) => {
          const projectSessions = state.sessions[projectPath] || [];
          return {
            sessions: {
              ...state.sessions,
              [projectPath]: projectSessions.map((s) =>
                s.id === sessionId ? { ...s, title: cleanTitle } : s
              )
            }
          };
        });
      },

      closeSession: (projectPath: string, sessionId: string) => {
        releaseSessionInMain(sessionId);
        set((state) => {
          const existing = state.sessions[projectPath] || [];
          const filtered = existing.filter((s) => s.id !== sessionId);

          if (filtered.length === 0) {
            const fresh = createInitialSession();
            return {
              sessions: {
                ...state.sessions,
                [projectPath]: [fresh]
              },
              activeSessionId: {
                ...state.activeSessionId,
                [projectPath]: fresh.id
              }
            };
          }

          let currentActive = state.activeSessionId[projectPath];
          if (currentActive === sessionId) {
            currentActive = filtered[filtered.length - 1].id;
          }

          return {
            sessions: {
              ...state.sessions,
              [projectPath]: filtered
            },
            activeSessionId: {
              ...state.activeSessionId,
              [projectPath]: currentActive
            },
            ...sessionResetPatch(state, projectPath, sessionId)
          };
        });
      },

      clearSession: (projectPath: string, sessionId?: string) => {
        const targetSessionId = sessionId || get().activeSessionId[projectPath];
        if (targetSessionId) releaseSessionInMain(targetSessionId);
        set((state) => {
          const existing = state.sessions[projectPath] || [];

          const updated = existing.map((s) =>
            s.id === targetSessionId
              ? { ...s, messages: [], title: 'Новый диалог', claudeCliSessionId: undefined }
              : s
          );

          return {
            sessions: {
              ...state.sessions,
              [projectPath]: updated
            },
            ...sessionResetPatch(state, projectPath, targetSessionId)
          };
        });
      },

      abortStream: async () => {
        const { activeStreamSessionId } = get();
        if (activeStreamSessionId && window.api?.abortAIStream) {
          await window.api.abortAIStream(activeStreamSessionId);
          set({ isStreaming: false, activeStreamSessionId: null });
        }
      },

      sendMessage: async (projectPath: string, text: string) => {
        if (!text.trim() || get().isStreaming || !window.api?.streamAIChat) return;

        let activeSessionId = get().activeSessionId[projectPath];
        let projectSessions = get().sessions[projectPath] || [];

        if (!activeSessionId || !projectSessions.some((s) => s.id === activeSessionId)) {
          activeSessionId = get().createSession(projectPath);
          projectSessions = get().sessions[projectPath] || [];
        }

        const currentSession = projectSessions.find((s) => s.id === activeSessionId)!;
        const currentMessages = currentSession.messages || [];

        const userMsg: AIMessage = {
          id: `msg-${Date.now()}`,
          role: 'user',
          content: text.trim(),
          timestamp: new Date().toISOString()
        };

        const assistantMsgId = `asst-${Date.now() + 1}`;
        const initialAssistantMsg: AIMessage = {
          id: assistantMsgId,
          role: 'assistant',
          content: '',
          thought: '',
          toolCalls: [],
          timestamp: new Date().toISOString()
        };

        const updatedMessages = [...currentMessages, userMsg, initialAssistantMsg];

        // Derive auto-title if session was 'Новый диалог' or 'Диалог X'
        let sessionTitle = currentSession.title;
        if (sessionTitle === 'Новый диалог' || sessionTitle.startsWith('Диалог ')) {
          const cleaned = text.replace(/[\n\r]+/g, ' ').trim();
          sessionTitle = cleaned.length > 28 ? `${cleaned.slice(0, 26)}...` : cleaned;
        }

        set((state) => {
          const pSessions = state.sessions[projectPath] || [];
          const updated = pSessions.map((s) =>
            s.id === activeSessionId
              ? { ...s, title: sessionTitle, messages: updatedMessages }
              : s
          );

          return {
            sessions: {
              ...state.sessions,
              [projectPath]: updated
            },
            isStreaming: true,
            activeStreamSessionId: activeSessionId
          };
        });

        const streamId = activeSessionId;

        // Listen to streaming events
        const unsubChunk = window.api.onAIChunk(streamId, (chunk) => {
          set((state) => {
            const pSessions = state.sessions[projectPath] || [];
            const sIdx = pSessions.findIndex((s) => s.id === activeSessionId);
            if (sIdx === -1) return state;

            const targetSession = { ...pSessions[sIdx] };
            if (chunk.claudeCliSessionId) {
              targetSession.claudeCliSessionId = chunk.claudeCliSessionId;
            }

            const msgs = [...targetSession.messages];
            const mIdx = msgs.findIndex((m) => m.id === assistantMsgId);
            if (mIdx === -1) return state;

            const target = { ...msgs[mIdx] };
            if (chunk.text) {
              target.content = (target.content || '') + chunk.text;
            }
            if (chunk.thought) {
              target.thought = (target.thought || '') + chunk.thought;
            }
            if (chunk.toolCall) {
              target.toolCalls = [...(target.toolCalls || []), chunk.toolCall];
            }

            msgs[mIdx] = target;
            targetSession.messages = msgs;

            const newSessions = [...pSessions];
            newSessions[sIdx] = targetSession;

            let newPendingApprovals = state.pendingApprovals;
            if (chunk.approvalRequest) {
              const currentList = state.pendingApprovals[projectPath] || [];
              if (!currentList.some((r) => r.id === chunk.approvalRequest!.id)) {
                newPendingApprovals = {
                  ...state.pendingApprovals,
                  [projectPath]: [...currentList, chunk.approvalRequest]
                };
              }
            }

            let newSubagents = state.subagents;
            if (chunk.subagent) {
              const currentSub = state.subagents[projectPath] || [];
              const idx = currentSub.findIndex((s) => s.id === chunk.subagent!.id);
              const updated = [...currentSub];
              if (idx >= 0) {
                updated[idx] = chunk.subagent;
              } else {
                updated.push(chunk.subagent);
              }
              newSubagents = {
                ...state.subagents,
                [projectPath]: updated
              };
            }

            let newRateLimitWarnings = state.rateLimitWarnings;
            if (chunk.rateLimitWarning) {
              newRateLimitWarnings = {
                ...state.rateLimitWarnings,
                [projectPath]: chunk.rateLimitWarning
              };
            }

            let newLiveOutputs = state.liveOutputs;
            if (chunk.toolCall?.result && typeof chunk.toolCall.result === 'string') {
              newLiveOutputs = {
                ...state.liveOutputs,
                [projectPath]: chunk.toolCall.result
              };
            }

            return {
              sessions: {
                ...state.sessions,
                [projectPath]: newSessions
              },
              pendingApprovals: newPendingApprovals,
              subagents: newSubagents,
              rateLimitWarnings: newRateLimitWarnings,
              liveOutputs: newLiveOutputs
            };
          });
        });

        const unsubComplete = window.api.onAIComplete(streamId, (completedMsg) => {
          set((state) => {
            const pSessions = state.sessions[projectPath] || [];
            const sIdx = pSessions.findIndex((s) => s.id === activeSessionId);
            if (sIdx === -1) return state;

            const targetSession = { ...pSessions[sIdx] };
            const msgs = [...targetSession.messages];
            const mIdx = msgs.findIndex((m) => m.id === assistantMsgId);
            if (mIdx === -1) return state;

            const finalTools = (completedMsg.toolCalls || msgs[mIdx].toolCalls || []).map((tc) => ({
              ...tc,
              status: tc.status === 'running' || !tc.status ? (tc.diff ? 'pending' : 'done') : tc.status
            }));

            msgs[mIdx] = {
              ...completedMsg,
              id: assistantMsgId,
              toolCalls: finalTools.length > 0 ? finalTools : undefined
            };

            targetSession.messages = msgs;

            const newSessions = [...pSessions];
            newSessions[sIdx] = targetSession;

            return {
              sessions: {
                ...state.sessions,
                [projectPath]: newSessions
              },
              isStreaming: false,
              activeStreamSessionId: null
            };
          });

          cleanup();
        });

        const unsubError = window.api.onAIError(streamId, (err) => {
          set((state) => {
            const pSessions = state.sessions[projectPath] || [];
            const sIdx = pSessions.findIndex((s) => s.id === activeSessionId);
            if (sIdx === -1) return state;

            const targetSession = { ...pSessions[sIdx] };
            const msgs = [...targetSession.messages];
            const mIdx = msgs.findIndex((m) => m.id === assistantMsgId);
            if (mIdx === -1) return state;

            const target = { ...msgs[mIdx] };
            target.content = `${target.content || ''}\n\n⚠️ **Ошибка**: ${err}`;

            msgs[mIdx] = target;
            targetSession.messages = msgs;

            const newSessions = [...pSessions];
            newSessions[sIdx] = targetSession;

            return {
              sessions: {
                ...state.sessions,
                [projectPath]: newSessions
              },
              isStreaming: false,
              activeStreamSessionId: null
            };
          });

          cleanup();
        });

        const cleanup = () => {
          unsubChunk();
          unsubComplete();
          unsubError();
        };

        const streamReq: AIStreamRequest = {
          sessionId: streamId,
          projectPath,
          messages: [...currentMessages, userMsg],
          config: get().config,
          mode: get().mode,
          claudeCliSessionId: currentSession.claudeCliSessionId
        };

        try {
          await window.api.streamAIChat(streamReq);
        } catch (err: any) {
          console.error('streamAIChat invocation error:', err);
          set({ isStreaming: false, activeStreamSessionId: null });
          cleanup();
        }
      },

      acceptDiff: async (projectPath: string, messageId: string, toolId: string, filePath: string, newContent: string) => {
        if (window.api?.applyAIDiff) {
          try {
            await window.api.applyAIDiff(projectPath, filePath, newContent);

            set((state) => {
              const activeSessionId = state.activeSessionId[projectPath];
              const pSessions = state.sessions[projectPath] || [];

              const updated = pSessions.map((s) => {
                if (s.id === activeSessionId) {
                  return {
                    ...s,
                    messages: s.messages.map((m) => {
                      if (m.id === messageId && m.toolCalls) {
                        return {
                          ...m,
                          toolCalls: m.toolCalls.map((tc) =>
                            tc.id === toolId ? { ...tc, status: 'accepted' as const } : tc
                          )
                        };
                      }
                      return m;
                    })
                  };
                }
                return s;
              });

              return {
                sessions: {
                  ...state.sessions,
                  [projectPath]: updated
                }
              };
            });
          } catch (e) {
            console.error('Failed to apply diff:', e);
          }
        }
      },

      rejectDiff: (projectPath: string, messageId: string, toolId: string) => {
        set((state) => {
          const activeSessionId = state.activeSessionId[projectPath];
          const pSessions = state.sessions[projectPath] || [];

          const updated = pSessions.map((s) => {
            if (s.id === activeSessionId) {
              return {
                ...s,
                messages: s.messages.map((m) => {
                  if (m.id === messageId && m.toolCalls) {
                    return {
                      ...m,
                      toolCalls: m.toolCalls.map((tc) =>
                        tc.id === toolId ? { ...tc, status: 'rejected' as const } : tc
                      )
                    };
                  }
                  return m;
                })
              };
            }
            return s;
          });

          return {
            sessions: {
              ...state.sessions,
              [projectPath]: updated
            }
          };
        });
      }
    }),
    {
      name: 'projecthub-ai-studio-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        config: {
          ...state.config,
          apiKey: undefined // Не сохраняем API-ключ в открытом виде в localStorage — защищено через safeStorage (DPAPI)
        },
        mode: state.mode
      })
    }
  )
);
