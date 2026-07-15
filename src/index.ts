#!/usr/bin/env node
/**
 * officer-mcp — servidor MCP para a plataforma Officer EQI.
 *
 * Expõe o pipeline de oportunidades (empresas, verticais, Hot List,
 * Pipe Week) como ferramentas MCP, operando sobre um arquivo JSON no
 * mesmo formato do backup que a plataforma exporta/importa.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'node:fs';
import {
  Company,
  PHASE_LABELS,
  STATUS_LABELS,
  SUG_CATEGORIES,
  SUG_STATUS_LABELS,
  Sugestao,
  Vertical,
  VerticalStatus,
  newVerticals,
  phaseLabel,
  statusLabel,
} from './model.js';
import { Store } from './store.js';

const store = new Store();

const server = new McpServer({
  name: 'officer-mcp',
  version: '0.1.0',
});

// ---------- helpers ----------

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function fail(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

function activeVerticals(c: Company): Vertical[] {
  return (c.verticals ?? []).filter((v) => v.active !== false);
}

function companySummary(c: Company): string {
  const verts = activeVerticals(c)
    .filter((v) => v.status !== 'pre')
    .map((v) => `${v.name}: ${statusLabel(v)}`)
    .join('; ');
  const parts = [
    `#${c.id} ${c.name}`,
    c.assessor ? `assessor: ${c.assessor}` : '',
    c.escritorio ? `escritório: ${c.escritorio}` : '',
    verts ? `verticais em andamento → ${verts}` : 'nenhuma vertical em andamento',
  ].filter(Boolean);
  return parts.join(' | ');
}

function companyDetail(c: Company): string {
  const lines = [
    `Empresa #${c.id}: ${c.name}`,
    c.contact ? `Contato: ${c.contact}` : '',
    c.email ? `E-mail: ${c.email}` : '',
    c.phone ? `Telefone: ${c.phone}` : '',
    c.assessor ? `Assessor: ${c.assessor}${c.assessorEmail ? ` <${c.assessorEmail}>` : ''}` : '',
    c.escritorio ? `Escritório: ${c.escritorio}` : '',
    c.indicacao ? `Indicação: ${c.indicacao}${c.indicacaoTipo ? ` (${c.indicacaoTipo})` : ''}` : '',
    `R1: ${c.r1Realizada ? `realizada${c.r1RealizadaAt ? ` em ${c.r1RealizadaAt}` : ''}` : c.r1Date ? `agendada para ${c.r1Date}` : 'não agendada'}`,
    c.r1Notes ? `Notas pré-R1: ${c.r1Notes}` : '',
    c.r1NotesPost ? `Notas pós-R1: ${c.r1NotesPost}` : '',
    '',
    'Verticais:',
    ...activeVerticals(c).map((v) => {
      const extra = [
        v.specialist ? `especialista: ${v.specialist}` : '',
        v.r2Date ? `R2: ${v.r2Date}` : '',
        v.hotlist ? `🔥 HOT LIST${v.hlUrgency ? ` (${v.hlUrgency})` : ''}${v.hlNote ? ` — ${v.hlNote}` : ''}` : '',
        v.pipeWeek ? `📌 Pipe Week${v.pwNote ? ` — ${v.pwNote}` : ''}` : '',
        v.note ? `nota: ${v.note}` : '',
      ]
        .filter(Boolean)
        .join(' | ');
      return `  - ${v.name}: ${statusLabel(v)}${extra ? ` (${extra})` : ''}`;
    }),
  ];
  return lines.filter((l) => l !== '').join('\n');
}

function requireCompany(ref: string) {
  const c = store.findCompany(ref);
  if (!c) {
    const near = store.searchCompanies(ref).slice(0, 5);
    throw new Error(
      `Empresa "${ref}" não encontrada.` +
        (near.length
          ? ` Você quis dizer: ${near.map((n) => `#${n.id} ${n.name}`).join(', ')}?`
          : '')
    );
  }
  return c;
}

function requireVertical(c: Company, name: string): Vertical {
  const q = name.toLowerCase().trim();
  const v =
    (c.verticals ?? []).find((x) => x.name.toLowerCase() === q) ??
    (c.verticals ?? []).find((x) => x.name.toLowerCase().includes(q));
  if (!v) {
    throw new Error(
      `Vertical "${name}" não existe em ${c.name}. Disponíveis: ` +
        (c.verticals ?? []).map((x) => x.name).join(', ')
    );
  }
  return v;
}

const statusEnum = z.enum(['pre', 'r2ag', 'funil', 'won', 'lost']);
const phaseEnum = z.enum(['R2 Agendada', 'R2 Realizada', 'Proposta', 'Negociação', 'Fechado']);

function phaseIndex(label: string): number {
  const i = PHASE_LABELS.findIndex((p) => p === label);
  return i >= 0 ? i : 0;
}

// ---------- tools: consulta ----------

server.tool(
  'listar_empresas',
  'Lista empresas do pipeline, com filtros opcionais por texto, assessor, escritório, vertical e status.',
  {
    busca: z.string().optional().describe('Texto para buscar em nome/contato/assessor'),
    assessor: z.string().optional().describe('Filtrar por nome do assessor'),
    escritorio: z.string().optional().describe('Filtrar por escritório'),
    vertical: z.string().optional().describe('Somente empresas com esta vertical em andamento (status diferente de Pré R1)'),
    status: statusEnum.optional().describe('Filtrar por status de vertical: pre, r2ag, funil, won, lost'),
    limite: z.number().int().positive().max(200).optional().describe('Máximo de resultados (padrão 50)'),
  },
  async ({ busca, assessor, escritorio, vertical, status, limite }) => {
    store.reload();
    let list = busca ? store.searchCompanies(busca) : [...store.companies];
    if (assessor) list = list.filter((c) => (c.assessor ?? '').toLowerCase().includes(assessor.toLowerCase()));
    if (escritorio) list = list.filter((c) => (c.escritorio ?? '').toLowerCase().includes(escritorio.toLowerCase()));
    if (vertical || status) {
      list = list.filter((c) =>
        activeVerticals(c).some(
          (v) =>
            (!vertical || v.name.toLowerCase().includes(vertical.toLowerCase())) &&
            (status ? v.status === status : v.status !== 'pre')
        )
      );
    }
    const max = limite ?? 50;
    const shown = list.slice(0, max);
    if (!shown.length) return ok('Nenhuma empresa encontrada com esses filtros.');
    const header = `${list.length} empresa(s) encontrada(s)${list.length > max ? `, mostrando ${max}` : ''}:`;
    return ok([header, ...shown.map(companySummary)].join('\n'));
  }
);

server.tool(
  'detalhar_empresa',
  'Mostra todos os dados de uma empresa: contato, assessor, R1 e situação de cada vertical.',
  {
    empresa: z.string().describe('ID numérico ou nome (ou parte do nome) da empresa'),
  },
  async ({ empresa }) => {
    store.reload();
    return ok(companyDetail(requireCompany(empresa)));
  }
);

server.tool(
  'resumo_pipeline',
  'Resumo executivo do pipeline: totais por status, funil por fase, ranking de verticais e Hot List.',
  {},
  async () => {
    store.reload();
    const cs = store.companies;
    const byStatus: Record<string, number> = {};
    const byPhase: Record<string, number> = {};
    const byVertical: Record<string, number> = {};
    let hot = 0;
    let pw = 0;
    for (const c of cs) {
      for (const v of activeVerticals(c)) {
        byStatus[v.status] = (byStatus[v.status] ?? 0) + 1;
        if (v.status === 'funil') {
          const label = phaseLabel(v.phase);
          byPhase[label] = (byPhase[label] ?? 0) + 1;
        }
        if (v.status !== 'pre') byVertical[v.name] = (byVertical[v.name] ?? 0) + 1;
        if (v.hotlist) hot++;
        if (v.pipeWeek) pw++;
      }
    }
    const won = byStatus['won'] ?? 0;
    const lost = byStatus['lost'] ?? 0;
    const winRate = won + lost ? Math.round((won / (won + lost)) * 100) : null;
    const lines = [
      `Pipeline Officer EQI — ${cs.length} empresas cadastradas`,
      '',
      'Verticais por status:',
      ...Object.entries(byStatus)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => `  - ${STATUS_LABELS[s as VerticalStatus] ?? s}: ${n}`),
      '',
      'Funil por fase:',
      ...(Object.keys(byPhase).length
        ? Object.entries(byPhase).map(([p, n]) => `  - ${p}: ${n}`)
        : ['  (nenhuma vertical no funil)']),
      '',
      'Verticais em andamento (top 10):',
      ...Object.entries(byVertical)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([v, n]) => `  - ${v}: ${n}`),
      '',
      `🔥 Hot List: ${hot} item(ns) | 📌 Pipe Week: ${pw} item(ns)` +
        (winRate !== null ? ` | Taxa de conversão (ganhas/perdidas): ${winRate}%` : ''),
    ];
    return ok(lines.join('\n'));
  }
);

server.tool(
  'hot_list',
  'Lista todos os itens marcados como Hot List (negócios quentes), com urgência e notas.',
  {},
  async () => {
    store.reload();
    const items: string[] = [];
    for (const c of store.companies) {
      for (const v of activeVerticals(c)) {
        if (v.hotlist) {
          items.push(
            `- ${c.name} / ${v.name}: ${statusLabel(v)}` +
              (v.hlUrgency ? ` | urgência: ${v.hlUrgency}` : '') +
              (v.hlNote ? ` | ${v.hlNote}` : '') +
              (v.hlDate ? ` | desde ${v.hlDate}` : '')
          );
        }
      }
    }
    return ok(items.length ? `🔥 Hot List (${items.length}):\n${items.join('\n')}` : 'A Hot List está vazia.');
  }
);

server.tool(
  'pipe_week',
  'Lista todos os itens marcados para o Pipe Week (revisão semanal do pipeline).',
  {},
  async () => {
    store.reload();
    const items: string[] = [];
    for (const c of store.companies) {
      for (const v of activeVerticals(c)) {
        if (v.pipeWeek) {
          items.push(
            `- ${c.name} / ${v.name}: ${statusLabel(v)}` + (v.pwNote ? ` | ${v.pwNote}` : '')
          );
        }
      }
    }
    return ok(items.length ? `📌 Pipe Week (${items.length}):\n${items.join('\n')}` : 'Nenhum item marcado para o Pipe Week.');
  }
);

// ---------- tools: escrita ----------

server.tool(
  'criar_empresa',
  'Cadastra uma nova empresa no pipeline com todas as verticais padrão em Pré R1.',
  {
    nome: z.string().min(1).describe('Nome da empresa'),
    contato: z.string().optional().describe('Nome da pessoa de contato'),
    assessor: z.string().optional().describe('Nome do assessor responsável'),
    assessorEmail: z.string().optional().describe('E-mail do assessor'),
    escritorio: z.string().optional().describe('Escritório (ex: EQI)'),
    email: z.string().optional().describe('E-mail da empresa/contato'),
    telefone: z.string().optional().describe('Telefone/WhatsApp'),
    r1Date: z.string().optional().describe('Data agendada da R1 (AAAA-MM-DD)'),
    notas: z.string().optional().describe('Notas iniciais (pré-R1)'),
  },
  async ({ nome, contato, assessor, assessorEmail, escritorio, email, telefone, r1Date, notas }) => {
    store.reload();
    const dup = store.companies.find((c) => (c.name ?? '').toLowerCase() === nome.toLowerCase());
    if (dup) return fail(`Já existe uma empresa "${dup.name}" (#${dup.id}). Use atualizar_empresa se quiser alterá-la.`);
    const company: Company = {
      id: store.nextId(),
      name: nome,
      contact: contato ?? '',
      assessor: assessor ?? '',
      assessorEmail: assessorEmail ?? '',
      escritorio: escritorio ?? '',
      email: email ?? '',
      phone: telefone ?? '',
      r1Date: r1Date ?? '',
      r1Notes: notas ?? '',
      r1Realizada: false,
      createdBy: process.env.OFFICER_USER ?? 'officer-mcp',
      createdAt: new Date().toISOString(),
      verticals: newVerticals(),
    };
    store.addCompany(company);
    store.save();
    return ok(`Empresa criada: #${company.id} ${company.name}, com ${company.verticals.length} verticais em Pré R1.`);
  }
);

server.tool(
  'atualizar_empresa',
  'Atualiza dados cadastrais de uma empresa (contato, assessor, R1, notas). Só altera os campos informados.',
  {
    empresa: z.string().describe('ID ou nome da empresa'),
    nome: z.string().optional(),
    contato: z.string().optional(),
    assessor: z.string().optional(),
    assessorEmail: z.string().optional(),
    escritorio: z.string().optional(),
    email: z.string().optional(),
    telefone: z.string().optional(),
    r1Date: z.string().optional().describe('Data da R1 (AAAA-MM-DD)'),
    r1Realizada: z.boolean().optional().describe('Marcar a R1 como realizada (true) ou não (false)'),
    notas: z.string().optional().describe('Notas pré-R1 (substitui as existentes)'),
    notasPosR1: z.string().optional().describe('Notas pós-R1 (substitui as existentes)'),
  },
  async (args) => {
    store.reload();
    const c = requireCompany(args.empresa);
    const changes: string[] = [];
    const set = (field: keyof Company, value: unknown, label: string) => {
      if (value !== undefined) {
        (c as Record<string, unknown>)[field] = value;
        changes.push(label);
      }
    };
    set('name', args.nome, 'nome');
    set('contact', args.contato, 'contato');
    set('assessor', args.assessor, 'assessor');
    set('assessorEmail', args.assessorEmail, 'e-mail do assessor');
    set('escritorio', args.escritorio, 'escritório');
    set('email', args.email, 'e-mail');
    set('phone', args.telefone, 'telefone');
    set('r1Date', args.r1Date, 'data da R1');
    set('r1Notes', args.notas, 'notas pré-R1');
    set('r1NotesPost', args.notasPosR1, 'notas pós-R1');
    if (args.r1Realizada !== undefined) {
      c.r1Realizada = args.r1Realizada;
      if (args.r1Realizada) {
        c.r1RealizadaAt = new Date().toISOString();
        c.r1RealizadaBy = process.env.OFFICER_USER ?? 'officer-mcp';
      }
      changes.push('R1 realizada');
    }
    if (!changes.length) return fail('Nenhum campo para atualizar foi informado.');
    store.save();
    return ok(`Empresa #${c.id} ${c.name} atualizada (${changes.join(', ')}).`);
  }
);

server.tool(
  'atualizar_vertical',
  'Atualiza a situação de uma vertical de uma empresa: status, fase do funil, especialista, data de R2, nota, Hot List e Pipe Week.',
  {
    empresa: z.string().describe('ID ou nome da empresa'),
    vertical: z.string().describe('Nome da vertical (ex: Crédito, Energia, M&A)'),
    status: statusEnum.optional().describe('pre = Pré R1, r2ag = R2 Agendada, funil = No funil, won = Ganha, lost = Perdida'),
    fase: phaseEnum.optional().describe('Fase do funil (usada quando status = funil)'),
    especialista: z.string().optional().describe('Nome do especialista responsável'),
    r2Date: z.string().optional().describe('Data da R2 (AAAA-MM-DD)'),
    nota: z.string().optional().describe('Nota da vertical (substitui a existente)'),
    hotlist: z.boolean().optional().describe('Adicionar (true) ou remover (false) da Hot List'),
    hotlistUrgencia: z.string().optional().describe('Urgência na Hot List (ex: Alta, Média, Baixa)'),
    hotlistNota: z.string().optional().describe('Nota da Hot List'),
    pipeWeek: z.boolean().optional().describe('Adicionar (true) ou remover (false) do Pipe Week'),
    pipeWeekNota: z.string().optional().describe('Nota do Pipe Week'),
  },
  async (args) => {
    store.reload();
    const c = requireCompany(args.empresa);
    const v = requireVertical(c, args.vertical);
    const changes: string[] = [];
    if (args.status !== undefined) {
      v.status = args.status;
      v.statusChangedAt = new Date().toISOString();
      if (args.status === 'funil' && !v.funnelDate) v.funnelDate = new Date().toISOString().slice(0, 10);
      if (args.status === 'won') v.won = true;
      if (args.status === 'lost') v.won = false;
      changes.push(`status → ${STATUS_LABELS[args.status]}`);
    }
    if (args.fase !== undefined) {
      v.phase = phaseIndex(args.fase);
      changes.push(`fase → ${args.fase}`);
    }
    if (args.especialista !== undefined) {
      v.specialist = args.especialista;
      changes.push('especialista');
    }
    if (args.r2Date !== undefined) {
      v.r2Date = args.r2Date;
      changes.push('data da R2');
    }
    if (args.nota !== undefined) {
      v.note = args.nota;
      changes.push('nota');
    }
    if (args.hotlist !== undefined) {
      v.hotlist = args.hotlist;
      if (args.hotlist) {
        v.hlAddedAt = new Date().toISOString();
        v.hlAddedBy = process.env.OFFICER_USER ?? 'officer-mcp';
        v.hlDate = new Date().toISOString().slice(0, 10);
      }
      changes.push(args.hotlist ? 'adicionada à Hot List' : 'removida da Hot List');
    }
    if (args.hotlistUrgencia !== undefined) {
      v.hlUrgency = args.hotlistUrgencia;
      changes.push('urgência da Hot List');
    }
    if (args.hotlistNota !== undefined) {
      v.hlNote = args.hotlistNota;
      changes.push('nota da Hot List');
    }
    if (args.pipeWeek !== undefined) {
      v.pipeWeek = args.pipeWeek;
      changes.push(args.pipeWeek ? 'adicionada ao Pipe Week' : 'removida do Pipe Week');
    }
    if (args.pipeWeekNota !== undefined) {
      v.pwNote = args.pipeWeekNota;
      changes.push('nota do Pipe Week');
    }
    if (!changes.length) return fail('Nenhum campo para atualizar foi informado.');
    store.save();
    return ok(`${c.name} / ${v.name}: ${changes.join(', ')}. Situação atual: ${statusLabel(v)}.`);
  }
);

server.tool(
  'excluir_empresa',
  'Exclui uma empresa do pipeline. Exige o ID numérico exato para evitar exclusões acidentais.',
  {
    id: z.number().int().describe('ID numérico exato da empresa (veja em listar_empresas)'),
    confirmar: z.literal(true).describe('Deve ser true para confirmar a exclusão'),
  },
  async ({ id }) => {
    store.reload();
    const c = store.companies.find((x) => x.id === id);
    if (!c) return fail(`Empresa com ID ${id} não encontrada.`);
    store.removeCompany(id);
    store.save();
    return ok(`Empresa #${id} ${c.name} excluída do pipeline.`);
  }
);

// ---------- tools: sugestões ----------

const sugStatusEnum = z.enum(['aberta', 'analise', 'implementada', 'descartada']);

server.tool(
  'listar_sugestoes',
  'Lista as sugestões de melhoria da plataforma, ordenadas por votos, com filtro opcional por status.',
  {
    status: sugStatusEnum.optional().describe('aberta, analise (em análise), implementada ou descartada'),
  },
  async ({ status }) => {
    store.reload();
    let sugs = [...store.sugestoes].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));
    if (status) sugs = sugs.filter((s) => s.status === status);
    if (!sugs.length) return ok('Nenhuma sugestão encontrada.');
    return ok(
      `${sugs.length} sugestão(ões):\n` +
        sugs
          .map(
            (s) =>
              `- [${s.id}] (${SUG_STATUS_LABELS[s.status] ?? s.status}, ▲${s.votes ?? 0}) ${s.cat}: ${s.text}` +
              (s.author ? ` — por ${s.author}${s.date ? ` em ${s.date}` : ''}` : '')
          )
          .join('\n')
    );
  }
);

server.tool(
  'criar_sugestao',
  'Registra uma nova sugestão de melhoria da plataforma.',
  {
    texto: z.string().min(1).describe('Descrição da sugestão ou melhoria'),
    categoria: z.enum(SUG_CATEGORIES).describe('Interface, Funcionalidade, Relatório, Integração ou Outro'),
    autor: z.string().optional().describe('Nome de quem sugeriu (padrão: OFFICER_USER)'),
  },
  async ({ texto, categoria, autor }) => {
    store.reload();
    const sug: Sugestao = {
      id: 's' + Date.now(),
      text: texto,
      cat: categoria,
      status: 'aberta',
      votes: 0,
      voters: [],
      author: autor ?? process.env.OFFICER_USER ?? 'officer-mcp',
      date: new Date().toISOString().slice(0, 10),
    };
    store.sugestoes.push(sug);
    store.save();
    return ok(`Sugestão registrada: [${sug.id}] ${sug.cat}: ${sug.text}`);
  }
);

server.tool(
  'atualizar_sugestao',
  'Muda o status de uma sugestão (aberta → em análise → implementada/descartada).',
  {
    id: z.string().describe('ID da sugestão (veja em listar_sugestoes)'),
    status: sugStatusEnum.describe('Novo status'),
  },
  async ({ id, status }) => {
    store.reload();
    const s = store.sugestoes.find((x) => x.id === id);
    if (!s) return fail(`Sugestão "${id}" não encontrada.`);
    s.status = status;
    store.save();
    return ok(`Sugestão [${id}] agora está: ${SUG_STATUS_LABELS[status]}.`);
  }
);

// ---------- tools: backup / integração com o site ----------

server.tool(
  'importar_backup',
  'Importa um arquivo de backup JSON exportado pela plataforma Officer EQI (substitui os dados atuais do servidor MCP).',
  {
    caminho: z.string().describe('Caminho do arquivo .json exportado pelo site (botão "Exportar backup")'),
  },
  async ({ caminho }) => {
    if (!fs.existsSync(caminho)) return fail(`Arquivo não encontrado: ${caminho}`);
    const raw = JSON.parse(fs.readFileSync(caminho, 'utf-8'));
    const { companies } = store.importBackup(raw);
    return ok(`Backup importado com sucesso: ${companies} empresas carregadas. Dados salvos em ${store.file}.`);
  }
);

server.tool(
  'exportar_backup',
  'Exporta os dados atuais como backup JSON compatível com a plataforma (para importar de volta no site).',
  {
    caminho: z.string().describe('Caminho do arquivo .json a criar (ex: /caminho/officer_backup.json)'),
  },
  async ({ caminho }) => {
    store.reload();
    const b = store.exportBackup();
    b.exportedAt = new Date().toISOString();
    fs.writeFileSync(caminho, JSON.stringify(b, null, 2), 'utf-8');
    return ok(
      `Backup exportado para ${caminho} (${b.data.length} empresas). ` +
        `No site, use a opção de importar backup JSON para carregar esses dados.`
    );
  }
);

// ---------- start ----------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`officer-mcp iniciado. Arquivo de dados: ${store.file}`);
