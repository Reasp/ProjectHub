import type { IpcContext } from './types';
import { registerProjectsIpc } from './projectsIpc';
import { registerBacklogIpc } from './backlogIpc';
import { registerGitIpc } from './gitIpc';
import { registerAiIpc } from './aiIpc';
import { registerFilesIpc } from './filesIpc';
import { registerVoiceIpc } from './voiceIpc';
import { registerMcpIpc } from './mcpIpc';
import { registerProcessIpc } from './processIpc';
import { registerHitlIpc } from './hitlIpc';
import { registerRolesIpc } from './rolesIpc';
import { registerSkillsIpc } from './skillsIpc';
import { registerDiagnosticsIpc } from './diagnosticsIpc';
import { registerNotificationsIpc } from './notificationsIpc';
import { registerFederationIpc } from './federationIpc';
import { registerComputerUseIpc } from './computerUseIpc';
import { registerTtsIpc } from './ttsIpc';
import { registerMemoryIpc } from './memoryIpc';
import { registerAutomationsIpc } from './automationsIpc';
import { registerPrReviewIpc } from './prReviewIpc';
import { registerSecurityIpc } from './securityIpc';

export type { IpcContext } from './types';

export function registerAllIpc(ctx: IpcContext) {
  registerProjectsIpc(ctx);
  registerBacklogIpc(ctx);
  registerGitIpc();
  registerAiIpc(ctx);
  registerFilesIpc();
  registerVoiceIpc(ctx);
  registerTtsIpc(ctx);
  registerMcpIpc();
  registerProcessIpc();
  registerHitlIpc(ctx);
  registerRolesIpc();
  registerSkillsIpc();
  registerDiagnosticsIpc();
  registerNotificationsIpc();
  registerFederationIpc();
  registerComputerUseIpc();
  registerMemoryIpc();
  registerAutomationsIpc(ctx);
  registerPrReviewIpc(ctx);
  registerSecurityIpc();
}
