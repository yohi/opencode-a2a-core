import { A2A_PROTOCOL_VERSION } from '../core/a2a-types.js';
import type { A2APluginInterface, A2APluginSkill } from '../core/plugin-interface.js';

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  protocolVersion: string;
  url: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2APluginSkill[];
  securitySchemes: {
    bearer: {
      type: 'http';
      scheme: 'bearer';
    };
  };
  security: [{ bearer: [] }];
}

export interface CreateAgentCardOptions {
  plugins: A2APluginInterface[];
  publicUrl: string;
}

export function createAgentCard(options: CreateAgentCardOptions): AgentCard {
  return {
    name: 'opencode-a2a-core',
    description: 'Thin wrapper agent delegating to CLI backends',
    version: '0.1.0',
    protocolVersion: A2A_PROTOCOL_VERSION,
    url: options.publicUrl,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: options.plugins.map((p) => p.metadata().skill),
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer' },
    },
    security: [{ bearer: [] }],
  };
}
