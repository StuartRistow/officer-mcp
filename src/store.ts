/**
 * Persistência em arquivo JSON no formato de backup da plataforma.
 *
 * O arquivo apontado por OFFICER_DATA_FILE é lido/escrito no mesmo formato
 * que o Officer EQI exporta e importa, então o fluxo é:
 *   site → "Exportar backup JSON" → arquivo → officer-mcp → editar via Claude
 *   → arquivo → "Importar backup" no site.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Backup, Company, emptyBackup } from './model.js';

const DEFAULT_DIR = path.join(os.homedir(), '.officer-mcp');
const DEFAULT_FILE = path.join(DEFAULT_DIR, 'data.json');

export class Store {
  readonly file: string;
  private backup: Backup;

  constructor(file?: string) {
    this.file = file ?? process.env.OFFICER_DATA_FILE ?? DEFAULT_FILE;
    this.backup = this.load();
  }

  private load(): Backup {
    if (!fs.existsSync(this.file)) return emptyBackup();
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
    if (raw?.type !== 'officer_eqi_full_backup' || !Array.isArray(raw.data)) {
      throw new Error(
        `O arquivo ${this.file} não é um backup válido do Officer EQI ` +
          `(esperado type="officer_eqi_full_backup" com campo "data").`
      );
    }
    return raw as Backup;
  }

  /** Recarrega do disco (caso o usuário tenha substituído o arquivo). */
  reload(): void {
    this.backup = this.load();
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.backup.exportedAt = new Date().toISOString();
    this.backup.exportedBy = process.env.OFFICER_USER ?? 'officer-mcp';
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.backup, null, 2), 'utf-8');
    fs.renameSync(tmp, this.file);
  }

  get companies(): Company[] {
    return this.backup.data;
  }

  nextId(): number {
    const id = this.backup.nid ?? 1;
    this.backup.nid = id + 1;
    return id;
  }

  findCompany(ref: string | number): Company | undefined {
    const byId = this.companies.find((c) => String(c.id) === String(ref));
    if (byId) return byId;
    const q = String(ref).toLowerCase().trim();
    const matches = this.companies.filter((c) =>
      (c.name ?? '').toLowerCase().includes(q)
    );
    if (matches.length === 1) return matches[0];
    // nome exato desempata múltiplos resultados
    return matches.find((c) => (c.name ?? '').toLowerCase() === q);
  }

  searchCompanies(q: string): Company[] {
    const needle = q.toLowerCase().trim();
    return this.companies.filter((c) =>
      [c.name, c.contact, c.assessor, c.escritorio]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(needle))
    );
  }

  addCompany(c: Company): void {
    this.backup.data.push(c);
  }

  removeCompany(id: number): boolean {
    const before = this.backup.data.length;
    this.backup.data = this.backup.data.filter((c) => c.id !== id);
    return this.backup.data.length < before;
  }

  /** Substitui todo o conteúdo pelo backup importado (validado). */
  importBackup(raw: unknown): { companies: number } {
    const b = raw as Backup;
    if (b?.type !== 'officer_eqi_full_backup' || !Array.isArray(b.data)) {
      throw new Error(
        'JSON inválido: esperado um backup completo do Officer EQI ' +
          '(type="officer_eqi_full_backup" com campo "data").'
      );
    }
    this.backup = b;
    this.save();
    return { companies: b.data.length };
  }

  exportBackup(): Backup {
    return this.backup;
  }
}
