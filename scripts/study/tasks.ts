/**
 * Study tasks. Semantics are identical on both stacks; only the implementation
 * shape differs. Declared before any run so the acceptance criteria cannot drift.
 */

export interface StudyTask {
  id: string;
  title: string;
  acceptance: string[];
}

export const STUDY_TASKS: StudyTask[] = [
  {
    id: 'T1',
    title: 'prioridade máxima 3 com código INVALID_PRIORITY',
    acceptance: [
      'prioridade 4 ou 5 retorna INVALID_PRIORITY (não o código genérico de schema)',
      'prioridade 1..3 continua criando o chamado',
      'um invariante/teste cobre os dois lados'
    ]
  },
  {
    id: 'T2',
    title: 'chamado duplicado (mesmo assunto e solicitante) retorna DUPLICATE_TICKET',
    acceptance: [
      'o segundo POST com o mesmo subject+requesterEmail retorna DUPLICATE_TICKET',
      'a restrição existe também no banco (índice/chave), não só no código',
      'um invariante/teste cobre o duplicado'
    ]
  },
  {
    id: 'T3',
    title: 'fechar chamado com papel support, erro ALREADY_CLOSED',
    acceptance: [
      'nova capacidade de fechar um chamado existente',
      'exige o papel support; sem sessão UNAUTHORIZED, sem o papel FORBIDDEN',
      'fechar duas vezes retorna ALREADY_CLOSED',
      'um invariante/teste cobre o caminho felizes e o duplicado'
    ]
  }
];

export type StudyStack = 'slices' | 'conventional';

export interface StackConfig {
  app: string;
  gates: string[][];
}

export const STACKS: Record<StudyStack, StackConfig> = {
  slices: {
    app: 'examples/helpdesk-slices',
    gates: [
      ['bun', 'run', 'check'],
      ['bun', 'run', 'test']
    ]
  },
  conventional: {
    app: 'examples/helpdesk-conventional',
    gates: [
      ['bun', 'run', 'check'],
      ['bun', 'run', 'test']
    ]
  }
};
