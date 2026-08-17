# Fazenda Belphegor

Painel de farm da Fazenda Belphegor. Site estático (HTML + CSS + JavaScript puro, sem build)
que lê os dados **ao vivo** da planilha pública do Google Sheets.

## Estrutura

```
index.html          página única (as 4 telas são renderizadas por JS)
assets/styles.css   visual
assets/app.js       leitura da planilha + telas
.nojekyll           impede o GitHub Pages de processar os arquivos com Jekyll
```

## Telas

| Aba | URL | O que mostra |
|---|---|---|
| Visão geral | `#/dash` | KPIs, Top 1, perseguidores, pendentes, últimos registros |
| Registros | `#/registros` | Tabela completa com busca, filtro de tipo e Pago/Pendente |
| Ranking | `#/ranking` | Ranking por total farmado, com barra de progresso |
| Membro | `#/membro/<discord-id>` | Perfil do membro, KPIs e histórico dele |

As URLs usam hash, então dá para mandar link direto de um membro no Discord.

## Publicar no GitHub Pages (grátis)

1. Crie um repositório no GitHub (pode ser público ou privado — Pages em repositório
   privado exige conta Pro; no público é grátis).
2. Na pasta do projeto:

   ```bash
   git init
   git add .
   git commit -m "Painel Fazenda Belphegor"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/SEU-REPO.git
   git push -u origin main
   ```

3. No GitHub: **Settings → Pages → Build and deployment**
   - Source: `Deploy from a branch`
   - Branch: `main` / pasta `/ (root)` → **Save**
4. Em ~1 minuto o site sai em `https://SEU-USUARIO.github.io/SEU-REPO/`.

Cada `git push` novo republica o site automaticamente.

## A planilha

Fonte: aba **`Registros`**, colunas `A:K`, dados a partir da linha 2.

| Coluna | Obrigatória | Observações |
|---|---|---|
| Discord ID | recomendada | Usada para agrupar o membro. Sem ela, agrupa pelo Nome |
| Nome | **sim** | |
| Tipo | não | Alimenta o filtro de tipos |
| Quantidade | não | |
| Total | **sim** | Base do ranking e dos totais |
| Data | não | Aceita `14/08/2026`, `2026-08-14` ou data real do Sheets |
| Aprovado por | não | |
| Pago | não | Aceita `TRUE`, `Sim`, `Pago`, `x`, `1` — o resto vira Pendente |
| Cargo | não | |
| Pagamento | não | Se estiver vazio, é calculado como `Total × % do cargo` |
| % do cargo | não | Aceita `35%`, `0,35` ou `35` |

Valores com `R$`, `$`, ponto de milhar ou vírgula decimal são interpretados corretamente.
Linhas totalmente vazias são ignoradas. A ordem das colunas é detectada pelo cabeçalho,
então dá para reordenar sem quebrar o site.

**Requisito:** a planilha precisa estar compartilhada como
*"Qualquer pessoa com o link — Leitor"*. Não é preciso publicar na web nem usar chave de API.

> A planilha é lida direto pelo navegador de quem visita. Não coloque nela nada que
> não possa ser público.

## Configuração

Tudo fica no topo de [`assets/app.js`](assets/app.js):

```js
const CONFIG = {
  SHEET_ID: '1Yuynmq_...',   // ID da planilha (parte da URL entre /d/ e /edit)
  SHEET_NAME: 'Registros',   // nome exato da aba
  SHEET_LABEL: 'Planilha Belphegor',
  RANKING_SIZE: 20,          // quantos membros aparecem no ranking
  AUTO_REFRESH_MS: 5 * 60 * 1000  // recarrega sozinho a cada 5 min (0 desliga)
};
```

## Rodar localmente

Precisa de um servidor (abrir o arquivo direto com `file://` bloqueia o `fetch`):

```bash
npx serve .
# ou
python -m http.server 8000
```

## Modo demonstração

`https://.../?demo=1` carrega dados de exemplo, sem tocar na planilha — útil para
conferir o layout enquanto a planilha ainda está vazia. Um aviso aparece no topo
para não confundir com dado real.
