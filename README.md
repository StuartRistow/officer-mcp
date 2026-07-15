# officer-mcp

Servidor **MCP (Model Context Protocol)** para a plataforma **Officer EQI** — a ponte que permite conversar com o Claude sobre o seu pipeline de oportunidades e pedir para ele consultar, cadastrar e atualizar tudo por você.

> **Em uma frase:** você exporta o backup JSON do site, aponta este servidor para o arquivo, e passa a poder dizer coisas como *"quais são os negócios quentes da semana?"* ou *"mova a vertical Crédito da empresa X para Proposta"* diretamente no Claude.

## O que ele faz

O servidor expõe estas ferramentas para o Claude:

| Ferramenta | O que faz |
|---|---|
| `listar_empresas` | Lista/filtra empresas por texto, assessor, escritório, vertical ou status |
| `detalhar_empresa` | Mostra a ficha completa de uma empresa e a situação de cada vertical |
| `resumo_pipeline` | KPIs: totais por status, funil por fase, ranking de verticais, taxa de conversão |
| `hot_list` | Lista os negócios marcados como quentes, com urgência e notas |
| `pipe_week` | Lista os itens marcados para a revisão semanal |
| `criar_empresa` | Cadastra uma nova empresa (com as 15 verticais padrão em Pré R1) |
| `atualizar_empresa` | Altera dados cadastrais, agenda/realiza R1, notas |
| `atualizar_vertical` | Move verticais no funil (Pré R1 → R2 → Proposta → Negociação → Fechado), marca Hot List / Pipe Week |
| `excluir_empresa` | Exclui uma empresa (exige ID exato + confirmação) |
| `listar_sugestoes` | Lista as sugestões de melhoria da plataforma, por votos ou status |
| `criar_sugestao` | Registra uma nova sugestão (Interface, Funcionalidade, Relatório…) |
| `atualizar_sugestao` | Muda o status de uma sugestão (aberta → em análise → implementada) |
| `importar_backup` | Carrega um backup JSON exportado pelo site |
| `exportar_backup` | Gera um backup JSON pronto para importar de volta no site |

Os dados ficam num arquivo JSON **no mesmo formato do backup da plataforma** (`officer_eqi_full_backup`), então o ciclo site → Claude → site funciona sem conversões.

## Requisitos

- [Node.js](https://nodejs.org) 18 ou superior

## Instalação

```bash
git clone https://github.com/StuartRistow/officer-mcp.git
cd officer-mcp
npm install
npm run build
```

## Como conectar ao Claude

### Claude Desktop

Adicione ao arquivo de configuração (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "officer": {
      "command": "node",
      "args": ["/caminho/para/officer-mcp/dist/index.js"],
      "env": {
        "OFFICER_DATA_FILE": "/caminho/para/meus-dados/officer.json",
        "OFFICER_USER": "seu.email@eqi.com.br"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add officer -e OFFICER_DATA_FILE=/caminho/officer.json -- node /caminho/para/officer-mcp/dist/index.js
```

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `OFFICER_DATA_FILE` | `~/.officer-mcp/data.json` | Onde os dados ficam salvos |
| `OFFICER_USER` | `officer-mcp` | Seu e-mail, gravado como autor das alterações |

## Fluxo de uso com o site

1. No Officer EQI (site), use **Exportar backup JSON** e salve o arquivo.
2. No Claude, peça: *"importe o backup do Officer que está em /caminho/arquivo.json"*.
3. Converse: consulte o pipeline, atualize verticais, marque hot list…
4. Peça: *"exporte um backup para /caminho/officer_atualizado.json"*.
5. No site, use **Importar backup** com o arquivo gerado.

## Desenvolvimento

```bash
npm run build   # compila TypeScript para dist/
npm run dev     # compila em modo watch
```

Estrutura:

- `src/model.ts` — tipos e rótulos do domínio (empresa, vertical, status, fases), espelhando o formato de backup v2/v19 da plataforma
- `src/store.ts` — persistência em arquivo JSON compatível com import/export do site
- `src/index.ts` — servidor MCP (stdio) com as ferramentas

## Segurança

- **Leia o [SECURITY.md](SECURITY.md)** — o site publicado expõe dados de clientes e senhas no código-fonte; o script `scripts/sanitize-site.mjs` gera uma versão limpa para republicar.
- **Nunca commite arquivos de dados reais** — o `.gitignore` já bloqueia `data/` e `*backup*.json`.
- Os dados podem conter informações de clientes; trate o arquivo `OFFICER_DATA_FILE` como confidencial.
