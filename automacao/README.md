# Ápse · Operação comercial no n8n

Primeira máquina comercial da Ápse. O n8n orquestra, uma planilha Google é a base única e o Juan aprova cada contato antes de ele sair.

Não altera os sites deste repositório, não usa IA paga e não contrata nada. A qualificação e as mensagens vêm de regras explicáveis em `n8n/lib/comercial.js`.

## O que o fluxo faz

```
Leads (planilha) ─► 1 · Rotina diária (dias úteis, 08h)
                     ├─ qualifica todos (pontuação 0–100, faixa A/B/C/X, justificativa)
                     ├─ escolhe os 5 melhores e escreve a abordagem no idioma de cada um
                     ├─ cria follow-ups (3, 7 e 14 dias sem resposta)
                     └─ manda o resumo do dia para o seu e-mail
                                │
          você revisa na aba Abordagens e escreve SIM em "aprovado"
                                │
                    2 · Enviar aprovadas (a cada 30 min)
                     ├─ e-mail → envia pelo seu Gmail (limite diário)
                     └─ WhatsApp / Instagram → você cola e envia; o fluxo só registra
                                │
                    3 · Respostas (Gmail, a cada 5 min)
                     ├─ casa a resposta com o lead, classifica a intenção
                     ├─ atualiza a etapa e registra em Interacoes
                     ├─ deixa uma resposta sugerida (PENDENTE) em Abordagens
                     └─ lead quente → alerta no seu e-mail
```

**Etapas do lead (`apse_etapa`):** NOVO → QUALIFICADO → AGUARDANDO_APROVACAO → CONTATADO → RESPONDEU → REUNIAO → PROPOSTA → NEGOCIACAO → GANHO / PERDIDO / NAO_CONTATAR. Você pode mudar a etapa à mão na planilha; o fluxo respeita.

**Idiomas:** pt, en, es, fr, de, it. O idioma vem, nesta ordem, da coluna Idioma, do país, do DDI do telefone ou do domínio do e-mail ou site. Se nada disso existir, usa `idioma_padrao`.

**Pontuação:** cada ponto vem marcado como *Fatos* (o que está na planilha), *Estimativas* (inferências) ou *Não verificado* (pendências). Ela considera verificação do perfil, canal de contato público, nicho, ausência de site próprio (link de bio conta como "sem site"), atividade recente, anúncios, origem do lead, intenção na mensagem, orçamento e prazo. Número de seguidores não entra na conta. Perfis marcados como inelegíveis ficam fora; quem pediu para não ser contatado também.

## O que já funciona e o que depende de você

| Parte | Estado | Depende de |
|---|---|---|
| Lógica de qualificação, top 5, mensagens em 6 idiomas, follow-ups, classificação de respostas | **Pronta e testada** (`node --test automacao/n8n/lib/comercial.test.mjs`) | nada |
| Os 3 fluxos do n8n (JSON prontos para importar) | **Gerados e simulados de ponta a ponta** (`node automacao/n8n/simular.mjs`) | uma instância n8n |
| Ler e gravar na planilha | Pronto no fluxo | credencial **Google Sheets OAuth2** no n8n + planilha no Google Sheets |
| Resumo diário, alertas, envio de e-mail aprovado, leitura de respostas | Pronto no fluxo | credencial **Gmail OAuth2** no n8n |
| WhatsApp e Instagram | Mensagem pronta + link `wa.me` para colar; o envio é manual | nada (API oficial do WhatsApp e da Meta fica para depois, e tem custo e aprovação) |
| Respostas por WhatsApp/Instagram | Manual: você muda `apse_etapa` na planilha | API oficial (futuro) |
| Jev / TypeSafe | **Não integrado** (decisão: sem novos custos agora) | conta, API key e preço confirmados |
| Conector n8n do Claude | **Com erro 404** (ver abaixo) | ajuste na instância n8n ou no conector |

Nenhum dos itens acima tem custo próprio. O Google Sheets, o Gmail e o n8n self-hosted (Community) são gratuitos. O n8n Cloud é pago depois do período de teste.

## Como colocar no ar

1. **Planilha base.** A planilha do Codex (`Plano-comercial-Apse.xlsx`) não está no Google Drive nem neste ambiente. Suba-a no Drive e abra com Google Sheets (*Arquivo → Salvar como Planilhas Google*). Na aba de perfis:
   - renomeie a aba para **Leads**;
   - a primeira linha precisa ser o cabeçalho.

   Cabeçalhos em pt, en ou es são reconhecidos (Nome/Name/Nombre, País/Country, Contato comercial público, Última atividade verificada, Verificação etc.); a lista completa está em `ALIASES` dentro de `n8n/lib/comercial.js`. Não precisa apagar nem renomear colunas: o fluxo só **acrescenta** colunas `apse_*` no fim.
2. Crie as abas **Config**, **Abordagens** e **Interacoes** importando os CSV de `automacao/planilha/` (*Arquivo → Importar → Inserir nova(s) página(s)*). Em Config, preencha pelo menos `responsavel_email` e `planilha_url`.
3. Gere os fluxos já apontando para a planilha:
   ```bash
   node automacao/n8n/build.mjs --planilha "https://docs.google.com/spreadsheets/d/SEU_ID/edit"
   ```
   Com `--planilha`, os arquivos vão para `automacao/n8n/_local/`, que o git ignora (o repositório é público). Sem o parâmetro, use os de `workflows/` e troque o ID em cada nó Google Sheets.
4. No n8n: *Workflows → Import from File* com os três arquivos gerados. Em cada nó Google Sheets e Gmail, selecione ou crie a credencial (Google Sheets OAuth2 e Gmail OAuth2 da conta que vai enviar).
5. Rode **1 · Rotina diária** com *Execute workflow*. Confira as colunas `apse_*` em Leads e as 5 linhas em Abordagens.
6. Só então ative os três fluxos (chave *Active*). Até você escrever SIM em `aprovado`, nenhum e-mail sai para lead.

### Antes de ativar o envio
- Contato frio por e-mail tem regras por país (LGPD, GDPR na Europa, CAN-SPAM nos EUA, CASL no Canadá). As mensagens frias já trazem a opção de remoção, e quem pede remoção vira NAO_CONTATAR automaticamente. Para a Europa e o Canadá, prefira leads que tenham contato comercial público e ligação clara com o serviço oferecido.
- O limite `max_envios_dia` (padrão 20) protege a reputação do seu Gmail.

## Conector n8n do Claude: diagnóstico

O erro é um **HTTP 404 vindo do endereço do servidor MCP configurado no conector n8n do claude.ai**. O Claude chega até a URL, mas não existe servidor MCP nela. Este ambiente não mostra a URL (ela fica oculta), então a correção é sua:

1. **MCP da instância desativado.** Em instâncias recentes do n8n, ative em *Settings → MCP Access* (ou "Instance-level MCP") e copie a URL e o token que o n8n mostra ali. Ela não é a URL do painel.
2. **Se o conector aponta para um workflow com "MCP Server Trigger":** o workflow precisa estar **ativo**, e a URL deve ser a de produção (`/mcp/...`), não a de teste (`/mcp-test/...`), que só responde enquanto o editor está escutando.
3. **Instância local (localhost ou rede de casa):** a nuvem do Claude não alcança. Seria preciso um endereço público.

Depois de corrigir, reconecte em https://claude.ai/customize/connectors e abra uma **nova sessão** (os conectores são lidos no início da sessão). Os fluxos daqui não dependem desse conector: eles são importados como arquivo. O conector só serviria para o Claude operar o n8n diretamente.

## Jev / TypeSafe

O plugin `typesafe@typesafe-ai` 0.5.7 foi instalado na sessão do Claude e contém só a documentação, nada executa. A instalação some quando a sessão termina. Desta sessão, o acesso a `typesafe.ai` e `docs.typesafe.ai` está **bloqueado pela política de rede** do ambiente, então preço, limites e API não puderam ser confirmados.

Quando houver autorização para usar a API, os pontos de troca são exatamente duas funções:
- `qualificar()`: o Jev daria a probabilidade de compra e o "fit" a partir dos fatos do lead;
- `classificarResposta()`: o Jev escolheria a intenção da resposta.

O fluxo continuaria igual. A API key ficaria só na credencial do n8n (nunca no repositório nem no navegador), e as regras atuais seguiriam como plano B se a API falhar.

## Arquivos

```
automacao/
├─ README.md                    este guia
├─ planilha/                    cabeçalhos das abas Config, Abordagens, Interacoes e modelo de Leads
└─ n8n/
   ├─ lib/comercial.js          toda a lógica (funções puras, sem rede)
   ├─ lib/comercial.test.mjs    testes: node --test automacao/n8n/lib/comercial.test.mjs
   ├─ build.mjs                 gera workflows/*.json embutindo a lógica nos nós Code
   ├─ simular.mjs               roda os 3 fluxos com planilha e Gmail simulados
   ├─ workflows/                JSON para importar (gerados, com o ID da planilha em branco)
   └─ _local/                   JSON com o ID real da planilha (ignorado pelo git)
```

Para mudar regras ou textos, edite `lib/comercial.js`, rode os testes e o `build.mjs` e reimporte. Ajustes do dia a dia (top N, ticket, cadência, nichos) ficam na aba **Config**, sem mexer em código.

## Coordenação entre agentes (Codex, Claude)

- **Base única:** a planilha Google. O Codex, o Claude (via conector Google Drive) e o n8n leem a mesma fonte. O `.xlsx` local do Codex deixa de ser a referência depois de importado.
- **Divisão de arquivos:** o Claude mantém `automacao/` na branch `claude/cool-wright-u2indo`. Antes de editar algo aqui, o Codex deve trabalhar numa branch própria e abrir PR. Ninguém altera `index.html`, `nutricionista/` ou `assets/` sem pedido do Juan.
- **Próximo trabalho que não conflita:** o Codex completa ou corrige na planilha as colunas *Última atividade verificada*, *Site*, *Verificação* e *Contato comercial público* dos 14 perfis pendentes. Cada coluna preenchida sobe ou derruba a pontuação na rotina seguinte.
- Este repositório é **público**. Nunca coloque aqui dados de leads, tokens ou a URL da planilha.
