/**
 * Modelo de dados do Officer EQI, espelhando exatamente o formato do
 * backup JSON exportado/importado pela plataforma (officer_eqi_full_backup v2,
 * appDataVersion v19). Campos desconhecidos são preservados em round-trip.
 */

export type VerticalStatus = 'pre' | 'r2ag' | 'funil' | 'won' | 'lost';

export const STATUS_LABELS: Record<VerticalStatus, string> = {
  pre: 'Pré R1',
  r2ag: 'R2 Agendada',
  funil: 'No funil',
  won: 'Ganha',
  lost: 'Perdida',
};

/** Fases do funil quando status = 'funil' (índice = valor de `phase`). */
export const PHASE_LABELS = [
  'R2 Agendada',
  'R2 Realizada',
  'Proposta',
  'Negociação',
  'Fechado',
] as const;

export const DEFAULT_VERTICALS = [
  'Banking',
  'Crédito',
  'Câmbio',
  'Energia',
  'Tax',
  'Seguros',
  'Benefícios',
  'Consórcio',
  'M&A',
  'IB',
  'Save Water',
  'Ecoreduz',
  'TI - Telecom',
  'Supply',
  'Effitax',
] as const;

export interface Vertical {
  vid: number;
  name: string;
  order: number;
  note: string;
  status: VerticalStatus;
  phase: number;
  won: boolean | null;
  specialist: string;
  r2Date: string;
  active: boolean;
  hotlist?: boolean;
  hlNote?: string;
  hlUrgency?: string;
  hlDate?: string;
  hlAddedAt?: string;
  hlAddedBy?: string;
  pipeWeek?: boolean;
  pwNote?: string;
  funnelDate?: string;
  statusChangedAt?: string;
  [extra: string]: unknown;
}

export interface Company {
  id: number;
  name: string;
  contact: string;
  assessor: string;
  assessorEmail?: string;
  escritorio?: string;
  email?: string;
  phone?: string;
  r1Date: string;
  r1Notes: string;
  r1NotesPost?: string;
  r1Realizada?: boolean;
  r1RealizadaAt?: string;
  r1RealizadaBy?: string;
  indicacao?: string;
  indicacaoTipo?: string;
  createdBy?: string;
  createdAt?: string;
  verticals: Vertical[];
  [extra: string]: unknown;
}

export type SugestaoStatus = 'aberta' | 'analise' | 'implementada' | 'descartada';

export const SUG_STATUS_LABELS: Record<SugestaoStatus, string> = {
  aberta: 'Aberta',
  analise: 'Em análise',
  implementada: 'Implementada',
  descartada: 'Descartada',
};

export const SUG_CATEGORIES = [
  'Interface',
  'Funcionalidade',
  'Relatório',
  'Integração',
  'Outro',
] as const;

export interface Sugestao {
  id: string;
  text: string;
  cat: string;
  status: SugestaoStatus;
  votes: number;
  voters: number[];
  author: string;
  authorId?: number;
  date: string;
  [extra: string]: unknown;
}

/** Formato do arquivo de backup completo exportado pela plataforma. */
export interface Backup {
  type: 'officer_eqi_full_backup';
  version: string;
  appDataVersion: string;
  exportedAt: string;
  exportedBy: string;
  data: Company[];
  nid: number;
  users?: unknown[];
  sugestoes?: Sugestao[];
  stickyNotes?: Record<string, unknown>;
  [extra: string]: unknown;
}

export function phaseLabel(phase: number): string {
  return PHASE_LABELS[phase] ?? 'sem fase definida';
}

export function statusLabel(v: Vertical): string {
  if (v.status === 'funil') return `No funil — ${phaseLabel(v.phase)}`;
  return STATUS_LABELS[v.status] ?? v.status;
}

export function newVerticals(): Vertical[] {
  return DEFAULT_VERTICALS.map((name, i) => ({
    vid: i + 1,
    name,
    order: i,
    note: '',
    status: 'pre',
    phase: 0,
    won: null,
    specialist: '',
    r2Date: '',
    active: true,
  }));
}

export function emptyBackup(): Backup {
  return {
    type: 'officer_eqi_full_backup',
    version: 'v2',
    appDataVersion: 'v19',
    exportedAt: new Date().toISOString(),
    exportedBy: 'officer-mcp',
    data: [],
    nid: 1,
    users: [],
    sugestoes: [],
    stickyNotes: {},
  };
}
