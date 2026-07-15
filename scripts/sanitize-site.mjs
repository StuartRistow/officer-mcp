#!/usr/bin/env node
/**
 * Remove dados sensíveis do index.html publicado do Officer EQI.
 *
 * O arquivo do site contém, embutidos no código:
 *   1. Um backup completo (window._RODRIGO_BACKUP) com todas as empresas,
 *      clientes, e-mails de assessores e usuários com senhas em texto puro.
 *   2. Listas de usuários "semente" com senhas em texto puro.
 *
 * Uso:
 *   node scripts/sanitize-site.mjs <index.html> [saida.html] [--redact-passwords]
 *
 * Sem --redact-passwords, apenas o backup embutido é removido (correção
 * segura, não muda o comportamento de login). Com a flag, todas as senhas
 * literais no código são trocadas por "TROCAR@123" — os usuários precisarão
 * redefinir a senha no primeiro acesso em navegadores novos.
 */
import * as fs from 'node:fs';

const [, , input, maybeOut, ...rest] = process.argv;
const flags = [maybeOut, ...rest].filter((a) => a?.startsWith('--'));
const output = [maybeOut, ...rest].find((a) => a && !a.startsWith('--')) ?? input?.replace(/\.html$/, '.sanitizado.html');
const redactPasswords = flags.includes('--redact-passwords');

if (!input || !fs.existsSync(input)) {
  console.error('Uso: node scripts/sanitize-site.mjs <index.html> [saida.html] [--redact-passwords]');
  process.exit(1);
}

let html = fs.readFileSync(input, 'utf-8');
const originalSize = html.length;
const report = [];

// 1) Backup completo embutido: window._RODRIGO_BACKUP = {...};
// O objeto ocupa uma única linha gigante; o código que o usa já é tolerante
// a null (usa ?. e try/catch), então substituir por null é seguro.
const backupRe = /window\._RODRIGO_BACKUP\s*=\s*\{"type":\s*"officer_eqi_full_backup"[^\n]*/g;
const backupMatches = html.match(backupRe) ?? [];
if (backupMatches.length) {
  html = html.replace(backupRe, 'window._RODRIGO_BACKUP = null; // backup embutido removido por segurança');
  report.push(`✔ Backup embutido removido (${backupMatches.length} ocorrência(s), ~${Math.round(backupMatches.join('').length / 1024)} KB de dados de clientes).`);
} else {
  report.push('• Nenhum backup embutido (window._RODRIGO_BACKUP) encontrado — talvez já tenha sido removido.');
}

// 2) Senhas literais no código (usuários semente).
// Primeiro captura os valores em campos password:"...", depois substitui
// esses mesmos valores em QUALQUER outro ponto do arquivo (mapas de reset,
// textos de interface, diálogos de confirmação).
const passRe = /(password\s*:\s*)(['"])(?!TROCAR@123)((?:(?!\2).)+)\2/g;
const passValues = new Set(
  [...html.matchAll(passRe)].map((m) => m[3]).filter((v) => !v.includes('$') && v.length >= 4)
);
const passCount = (html.match(passRe) ?? []).length;
if (redactPasswords) {
  html = html.replace(passRe, '$1"TROCAR@123"');
  let extra = 0;
  for (const value of passValues) {
    const esc = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc.replace(/@/g, '(?:@|\\\\?@)'), 'g');
    extra += (html.match(re) ?? []).length;
    html = html.replace(re, 'TROCAR@123');
  }
  report.push(
    `✔ ${passCount} senha(s) literal(is) substituída(s) por "TROCAR@123"` +
      (extra ? ` (+${extra} ocorrência(s) das mesmas senhas em textos e mapas de reset).` : '.')
  );
} else if (passCount) {
  report.push(
    `⚠ Ainda restam ${passCount} senha(s) em texto puro no código (usuários semente). ` +
      'Rode novamente com --redact-passwords para substituí-las, e avise os usuários para redefinirem a senha.'
  );
}

// 3) Checagens informativas.
if (/sk-ant-[A-Za-z0-9\-_]{10,}/.test(html)) {
  report.push('🚨 ATENÇÃO: há uma chave de API da Anthropic no arquivo! Revogue-a em console.anthropic.com e remova manualmente.');
}
const emailCount = (html.match(/[a-z0-9._%+-]+@eqi\.com(\.br)?/gi) ?? []).length;
if (emailCount) report.push(`• ${emailCount} e-mail(s) @eqi ainda presentes (esperado para usuários semente).`);

fs.writeFileSync(output, html, 'utf-8');
console.log(report.join('\n'));
console.log(`\nArquivo limpo salvo em: ${output}`);
console.log(`Tamanho: ${Math.round(originalSize / 1024)} KB → ${Math.round(html.length / 1024)} KB`);
console.log('\nPróximo passo: publique este arquivo no Netlify (arraste a pasta no painel do site).');
