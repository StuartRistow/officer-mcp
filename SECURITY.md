# ⚠️ Alerta de segurança — Officer EQI (site publicado)

**Resumo em uma linha:** qualquer pessoa na internet consegue ver os dados de clientes e as senhas dos usuários abrindo o código-fonte da página em `firstof.netlify.app`.

## O que está exposto

Ao inspecionar o arquivo HTML publicado (algo que qualquer navegador permite fazer, sem precisar de login), encontramos:

1. **Um backup completo embutido no código** (`window._RODRIGO_BACKUP`): 121 empresas com nomes de clientes, contatos, notas de reuniões, e-mails de assessores — e a lista de usuários **com senhas em texto puro**.
2. **Usuários "semente" escritos no código** em pelo menos 3 pontos, também com senhas em texto puro (incluindo contas de administrador).
3. Como o site guarda tudo no navegador (localStorage), a tela de login é apenas cosmética: ela não protege os dados de quem examinar o código.

## O que fazer agora (em ordem de urgência)

1. **Troque imediatamente qualquer senha pessoal que apareça no código e seja usada em outros serviços** (e-mail, banco, redes sociais). Senhas expostas devem ser consideradas comprometidas.
2. **Limpe o arquivo do site** com o script deste repositório:

   ```bash
   # baixe o index.html atual do site (ou use sua cópia local)
   curl -sL https://firstof.netlify.app/ -o index.html

   # remove o backup embutido (correção segura, não muda o login)
   node scripts/sanitize-site.mjs index.html index.limpo.html

   # opcional: também substitui todas as senhas do código por "TROCAR@123"
   node scripts/sanitize-site.mjs index.html index.limpo.html --redact-passwords
   ```

3. **Republique no Netlify**: renomeie `index.limpo.html` para `index.html`, e no painel do Netlify arraste a pasta contendo o arquivo para fazer um novo deploy.
4. **Avise os usuários** para redefinirem as senhas dentro da plataforma.
5. Se alguma **chave de API da Anthropic** já foi digitada na plataforma em computador compartilhado, revogue-a em [console.anthropic.com](https://console.anthropic.com) e gere outra.

## Efeito colateral de remover o backup embutido

O backup embutido servia como "auto-restauração" quando alguém abria o site num navegador vazio. Sem ele, um navegador novo começa sem dados — basta usar **Importar backup JSON** (ou o `officer-mcp`) para carregar os dados. O código do site já tolera a ausência do backup (a correção troca o valor por `null`, que os guards `?.` e `try/catch` existentes tratam).

## A correção definitiva

Enquanto a plataforma for 100% "front-end + localStorage", **qualquer dado ou senha embutido no site é público por definição**. A solução real é um backend (servidor + banco de dados) com autenticação de verdade, onde:

- os dados ficam no servidor, não no navegador;
- senhas são armazenadas com hash (nunca em texto puro);
- cada usuário só enxerga o que seu perfil permite;
- o time inteiro compartilha a mesma base (resolve também a perda de dados ao trocar de máquina).

Esse backend pode ser um próximo passo natural deste repositório.
