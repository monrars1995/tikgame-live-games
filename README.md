# TikGame Live Games · Fliperama para TikTok LIVE

Fork de [vamnguyen/tiktok-live-games](https://github.com/vamnguyen/tiktok-live-games) adaptado pela Gold Neuron para lives em português. A versão **1.4.0** oferece cinco mini-games verticais que reagem a comentários, curtidas e presentes. O streamer abre a arena no navegador e a captura como fonte de navegador no OBS ou no TikTok LIVE Studio.

| Mini-game | Entrada e ação principal | Duração |
| --- | --- | --- |
| **Corrida do Povo** | Comente 1–5 para escolher um cavalo; curtidas dão impulso leve e presentes aceleram. | Até a chegada ou expirar o tempo |
| **Cabo de Guerra** | Comente azul/vermelho ou qualquer texto para entrar em um time; likes puxam pouco, rosas e outros presentes puxam mais. | 60 s ou vitória pela corda |
| **Céu de Corte** (Campeonato de Pipas) | Comente para soltar uma pipa; as linhas cruzam antes do corte. Rosa causa 25 de dano, curtida 0,55; presente de 50+ ativa golpe especial. | 60 s |
| **Rosas × Corações** | Comente para entrar na torcida; presentes atacam pelo lado das rosas e taps pelo lado dos corações. | 60 s |
| **Top Moedas × Taps** | Dois rankings Top 10, maior presente e maior combo. Presentes somam valor; curtidas somam taps. | 120 s |

O **Top Moedas × Taps** segue a hierarquia visual de confronto com cronômetro, área para câmera do streamer e duas colunas de ranking. A área superior é transparente na captura real: no OBS, posicione a fonte de câmera **atrás** do overlay. Na demonstração, uma silhueta ocupa esse espaço. O valor exibido em “moedas” é o `diamondCount`/`giftValue` informado pelo conector, usado como pontuação do jogo; **não representa receita ou saldo financeiro**. Para comparar forças na rodada, um ponto de valor de presente equivale a 20 taps, regra mostrada no overlay.

## Instalar e abrir

Requer Node.js **20+** e npm. Para conectar a uma live real, o perfil precisa estar transmitindo e acessível ao conector.

```bash
git clone https://github.com/monrars1995/tikgame-live-games.git
cd tikgame-live-games
npm ci
PORT=3100 npm start
```

Abra [http://localhost:3100](http://localhost:3100), informe o @ que está transmitindo, escolha o jogo e gere o link da arena. Configure a fonte de navegador em **450 × 800** (9:16). O servidor usa `127.0.0.1` por padrão e porta 3000 se `PORT` não for definida; 3100 evita conflito com uma instalação local anterior do TikGame na porta 8080.

Cada jogo também tem uma **demonstração** no painel. O link `?demo=1` cria eventos fictícios, marca a tela como “DEMONSTRAÇÃO” e não requer live. No Céu de Corte, `?demo=1&participants=1000` permite conferir o limite visual de 1.000 pipas sem depender da live. Use a prévia para revisar layout e movimento; use o link com `?id=perfil` para a captura real. A página `/debug.html` monitora os eventos recebidos do TikTok. Antes de testar presentes pagos, confirme um comentário e curtidas reais no monitor e na arena.

Abra a arena pela URL `http://127.0.0.1:3100/...` com o servidor em execução. Se o arquivo `public/games/kite-championship/index.html` for aberto diretamente por `file://`, ele redireciona para a prévia local no servidor; sem um @ na URL, abre em modo demonstração.

| Arena | Prévia local |
| --- | --- |
| Corrida do Povo | `/games/horse-racing/index.html?demo=1` |
| Cabo de Guerra | `/games/tug-of-war/index.html?demo=1` |
| Céu de Corte | `/games/kite-championship/index.html?demo=1` |
| Rosas × Corações | `/games/roses-vs-hearts/index.html?demo=1` |
| Top Moedas × Taps | `/games/top-coins-vs-taps/index.html?demo=1` |

## Regras e conexão

O backend compartilha uma conexão por @ entre páginas na mesma sala Socket.io, tenta reconectar em falhas e libera a conexão quando a última página sai. O contrato `tiktok_chat`, `tiktok_like`, `tiktok_gift` e `tiktok_share` foi preservado. Os jogos novos compartilham um utilitário que conta apenas as **unidades adicionais** de combos cumulativos de presentes e deduplica mensagens repetidas. Os rankings são limitados por rodada; efeitos transitórios são removidos do DOM.

Se o Céu de Corte permanecer em “Reconectando”, confira `http://127.0.0.1:3100/api/health`: `rooms` mostra quantas páginas aguardam a sala e `roomDiagnostics` distingue `connecting`, `connected`, `reconnecting` e `failed`, com o motivo e a tentativa atual. A arena também mostra o @, a causa e o limite de tentativas. `LIVE_OFFLINE` indica que o perfil ou a live não estão acessíveis; `CONNECTOR_ACCESS` indica recusa de acesso; `RATE_LIMITED` e `NETWORK_ERROR` podem se recuperar após nova tentativa. Confirme que o link da fonte usa o perfil que **está transmitindo**, por exemplo `/games/kite-championship/index.html?id=seu_perfil`, e recarregue a fonte após corrigir o problema.

A consulta opcional de metadados estendidos de presentes fica desativada: ela pode falhar antes de a conexão com a live abrir. Eventos de presentes continuam sendo recebidos, mas a pontuação depende dos campos de valor disponibilizados pelo conector. Use `/debug.html` para conferir o valor real de uma Rosa e de presentes maiores antes de homologar regras de 50+ moedas.

Na Corrida do Povo, nomes de cavalo e números 1–5 escolhem a raia; outros comentários distribuem o jogador automaticamente. A escolha fica fixa durante a corrida. Curtidas valem 0,2 por tap, até 100 por evento; o primeiro comentário inicia a contagem. A fórmula de impulso por presente é `min(140, round(8 × valor^0,55))` por unidade, com chegada em 300 pontos. Veja [config.js](public/games/horse-racing/config.js).

No Cabo de Guerra, comentários de texto livre são equilibrados entre azul e vermelho. O time do jogador fica fixo na rodada. No Céu de Corte, há até **1.000 pipas de espectadores ativas**, fila de espera, vida por pipa e troféus, além de três pipas NPC que mantêm o céu movimentado e servem de adversários para quem entra sozinho. Os NPCs não ocupam vagas de espectadores nem aparecem no pódio, e seus nomes não são mostrados na arena. Vento em rajadas, inclinação e caudas animadas tornam o voo mais orgânico; curtidas, Rosas e presentes especiais fazem investidas com curvas e durações diferentes. Em salas cheias, o desenho reduz o tamanho das pipas, destaca as linhas durante ataques e mantém os nomes dos espectadores nos avisos e no pódio; a vida e a colisão continuam sendo calculadas individualmente. Um ataque só causa dano se as linhas cruzarem geometricamente; Rosas são o ataque padrão de corte e curtidas são muito mais fracas. No X1, cada interação aumenta o ranking correspondente e afeta a barra de vida do lado oposto. As regras numéricas estão nos motores de cada jogo.

## Arquitetura e validação

```text
TikTok LIVE → TikTokLiveConnection → TikTokService → salas Socket.io
                                                     ↓
                                            tiktok-bridge.js
                                                     ↓
                                      cinco mini-games (Canvas/DOM)
```

O servidor fica em `src/`; o seletor e monitor ficam em `public/`; os jogos ficam em `public/games/`; e os testes estão em `tests/`. O navegador não precisa de chave ou conta TikTok. Para uma instalação em outra máquina, defina `HOST=0.0.0.0` somente em uma rede controlada.

```bash
npm test
npm audit --omit=dev
```

Os testes e as demonstrações verificam regras e renderização local. **Eles não comprovam recepção de eventos de uma live real.** Para homologar, confirme no `/debug.html` que comentário, sequência de curtidas, Rosa e presente de maior valor chegaram com usuário, valor e contagem corretos; confira o mesmo efeito no overlay. O acesso ao protocolo TikTok pode variar conforme a live e a plataforma.

## Origem, licença e contato

Baseado no projeto [TikTok Live Games de @vamnguyen](https://github.com/vamnguyen/tiktok-live-games), licenciado em MIT. Este fork inclui [LICENSE](LICENSE) com a atribuição preservada. A API e as regras do TikTok não fazem parte dessa licença.

Gold Neuron · Instagram [@monrars](https://instagram.com/monrars) · [goldneuron.io](https://goldneuron.io) · GitHub [@monrars1995](https://github.com/monrars1995).
