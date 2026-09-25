# TikGame Live Games · Corrida do Povo 🏇

Fork de [vamnguyen/tiktok-live-games](https://github.com/vamnguyen/tiktok-live-games) adaptado pela Gold Neuron para lives em português. A primeira versão própria transforma a corrida de cavalos em uma disputa vertical para OBS e TikTok LIVE Studio: comentários escolhem os cavalos, curtidas dão impulso leve e presentes aceleram a equipe escolhida.

**Estado:** versão `1.1.0`. Fluxos de jogo e do servidor têm testes automatizados. A recepção de eventos reais ainda precisa ser confirmada em uma live ativa, pois depende do acesso do conector ao TikTok.

## Como jogar na live

- Comente **1, 2, 3, 4 ou 5** para escolher um cavalo. O nome do cavalo também funciona. Qualquer outro comentário entra automaticamente no próximo cavalo disponível.
- O primeiro comentário inicia a contagem regressiva. Outros comentários dão um impulso pequeno, limitado a um por usuário a cada 15 segundos.
- **Curtidas** movimentam o cavalo do usuário, com força de **0,2 por curtida**. Um evento tem limite de 100 curtidas para evitar saltos anormais.
- **Rosas e outros presentes** dão impulso conforme o valor em moedas. Um combo de cinco Rosas soma cinco unidades, sem contar os eventos parciais duas vezes. Um presente de 50 moedas supera o impulso de cinco Rosas.
- Se alguém enviar curtida ou presente antes de comentar, entra automaticamente em um cavalo. O cavalo fica fixo até a próxima corrida.
- O primeiro a cruzar a chegada vence. Se o tempo terminar, ganha o cavalo mais avançado. A corrida reinicia automaticamente.

A fórmula de impulso de um presente é `min(140, round(8 × moedas^0,55))` por unidade; a chegada está em 300 pontos. Esses valores ficam em [config.js](public/games/horse-racing/config.js).

## Instalar e usar

Requer Node.js **20+** e npm. Use uma live TikTok em andamento e um perfil que o conector consiga acessar.

```bash
git clone https://github.com/monrars1995/tikgame-live-games.git
cd tikgame-live-games
npm ci
PORT=3100 npm start
```

Abra [http://localhost:3100](http://localhost:3100), informe o @ da live sem `@`, selecione **Corrida do Povo** e gere o link. Abra o overlay em 450 × 800 (9:16) no OBS ou no TikTok LIVE Studio como fonte de navegador. A página de diagnóstico em `/debug.html` mostra os eventos recebidos e ajuda a verificar nomes e valores dos presentes. O servidor usa a porta 3000 por padrão; 3100 evita conflito com a instância local do TikGame que usa 8080.

A conexão depende do TikTok manter a live acessível e pode sofrer restrições fora do controle do jogo. Antes de usar presentes pagos, teste primeiro com um comentário e verifique a chegada do evento no debugger. O overlay não deve ser apresentado como validado com eventos reais apenas porque os testes locais passaram.

Por padrão o servidor escuta apenas em `127.0.0.1`. Para uma instalação em outra máquina, defina `HOST=0.0.0.0` e proteja a rede e o acesso à sala antes de expor a porta publicamente.

## Arquitetura

```text
TikTok LIVE → TikTokLiveConnection → TikTokService → salas Socket.io
                                                     ↓
                                            tiktok-bridge.js
                                                     ↓
                                      Corrida do Povo (Canvas + HUD)
```

Cada @ gera uma sala. O backend compartilha a conexão entre espectadores da mesma live, reconecta em caso de falha e libera a conexão após a saída da última página. O contrato de eventos `tiktok_chat`, `tiktok_like`, `tiktok_gift` e `tiktok_share` foi preservado. A normalização aceita campos aninhados do conector 2.x.

O projeto usa Express, Socket.io, JavaScript moderno e Canvas 2D. Os arquivos principais são `src/server.js`, `src/services/TikTokService.js`, `src/lib/tiktokEventNormalizer.js` e `public/games/horse-racing/`. Não é necessária uma conta ou chave TikTok no navegador.

## Desenvolvimento e validação

```bash
npm test
npm run dev
```

Os testes cobrem seleção por comentário, limites de chat e curtida, combo de Rosas, chegada, normalização dos eventos, concorrência de conexão e contagem de salas. Para homologar na transmissão, confirme no `/debug.html` que um comentário, dez curtidas, uma Rosa e um presente de maior valor chegaram com usuário, valor e contagem corretos; confira o mesmo efeito no overlay. Isso requer uma live real e não é substituído por simulação local.

## Origem, licença e contato

Baseado no projeto [TikTok Live Games de @vamnguyen](https://github.com/vamnguyen/tiktok-live-games), que declara a licença MIT no README e no `package.json`. O repositório de origem não incluía um arquivo `LICENSE` no commit usado para o fork; este fork inclui o texto MIT e preserva a atribuição. A API e as regras da plataforma TikTok não fazem parte desta licença.

Gold Neuron · Instagram [@monrars](https://instagram.com/monrars) · [goldneuron.io](https://goldneuron.io) · GitHub [@monrars1995](https://github.com/monrars1995).
