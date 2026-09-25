# TikGame Live Games · Corrida do Povo

Fork de `vamnguyen/tiktok-live-games` para lives TikTok em português. Execute este projeto no checkout `tikgame-live-games`; ele é separado do `tikgame-live` local.

## Estrutura

- `src/server.js`: servidor Express e salas Socket.io por streamer.
- `src/services/TikTokService.js`: conexão compartilhada, retry e limpeza.
- `src/lib/tiktokEventNormalizer.js`: contrato de chat, curtida, presente e compartilhamento.
- `public/lib/tiktok-bridge.js`: cliente do Socket.io consumido pelos jogos.
- `public/games/horse-racing/`: configuração, motor de corrida, Canvas e HUD.
- `public/index.html`: dashboard; `public/debug.html`: monitor de eventos.
- `tests/`: verificações de conexão, bridge, normalização e regras do jogo.

## Ambiente e comandos

Node.js 20+, npm, `npm ci`, `npm test`, `PORT=3100 npm start`. O servidor escuta em `127.0.0.1` por padrão. A versão é definida em `package.json` e deve corresponder à tag Git.

## Regras de interação

Um comentário escolhe o cavalo por 1–5 ou nome; qualquer outro texto distribui o usuário. A escolha fica fixa até a próxima corrida. Curtidas são fracas; presentes aceleram conforme moedas; combos cumulativos contam apenas novas unidades. O primeiro a chegar vence ou, ao expirar o tempo, o mais avançado.

## Limites de alteração

Preserve os nomes de evento `tiktok_chat`, `tiktok_gift`, `tiktok_like`, `tiktok_share` e a API pública do bridge. Não versione `.env` nem `node_modules`. Execute `npm test`, `npm audit --omit=dev` e revisão visual em 450 × 800 antes de marcar uma versão. Testes locais não provam entrega de eventos de uma live real.

O projeto usa MIT com atribuição ao upstream. O README deve manter Instagram `@monrars`, site `goldneuron.io` e GitHub `@monrars1995`.
