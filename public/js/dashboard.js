/** Seletor do fliperama: prepara a captura sem fingir uma conexão LIVE. */
document.addEventListener("DOMContentLoaded", () => {
  const usernameInput = document.getElementById("username");
  const generateBtn = document.getElementById("generateBtn");
  const outputSection = document.getElementById("outputSection");
  const outputUrl = document.getElementById("outputUrl");
  const openOverlay = document.getElementById("openOverlay");
  const copyBtn = document.getElementById("copyBtn");
  const toast = document.getElementById("toast");
  const demoLink = document.getElementById("demoLink");
  const gameCards = Array.from(document.querySelectorAll(".game-card[data-game]"));
  let selectedCard = gameCards.find((card) => card.classList.contains("selected")) || gameCards[0];
  let toastTimer;

  const instructions = {
    "horse-racing": [
      "A torcida acelera cada cavalo.",
      "Comente 1–5", "Escolha seu cavalo e entre na disputa.",
      "Envie rosas ou presentes", "Impulsione o cavalo que você escolheu.",
      "Curta a live", "Cada sequência de curtidas dá um impulso leve."
    ],
    "tug-of-war": [
      "Escolha um lado. Puxe até vencer.",
      "Comente azul ou vermelho", "Escolha seu time. Outros comentários entram no lado com menos gente.",
      "Envie rosas ou presentes", "Dê uma puxada forte para sua equipe.",
      "Curta a live", "Cada tap ajuda o seu lado com um pequeno impulso."
    ],
    "kite-championship": [
      "Suba sua pipa. Cruze a linha rival.",
      "Comente para entrar", "Seu @ ganha uma pipa e uma barra de vida.",
      "Envie rosas ou presentes", "A rosa é o ataque de corte; presentes aumentam a força.",
      "Curta a live", "Sua linha pressiona a rival com um ataque mais fraco."
    ],
    "roses-vs-hearts": [
      "Rosas enfrentam corações no X1.",
      "Comente para entrar", "Seu @ aparece no confronto e no ranking.",
      "Envie rosas ou presentes", "Ataque pelo lado das rosas e avance a barra.",
      "Curta a live", "Ataque pelo lado dos corações a cada tap."
    ],
    "top-coins-vs-taps": [
      "Dois rankings. Uma batalha pelo topo.",
      "Entre no ranking", "Seu @ aparece após curtir ou enviar presente.",
      "Envie rosas ou presentes", "Some o valor dos presentes no Top Moedas.",
      "Curta a live", "Cada tap aumenta o Top Taps da comunidade."
    ]
  };

  function selectGame(card) {
    for (const option of gameCards) {
      const active = option === card;
      option.classList.toggle("selected", active);
      option.setAttribute("aria-pressed", String(active));
    }
    selectedCard = card;
    const game = card.dataset.game;
    const copy = instructions[game] || instructions["horse-racing"];
    for (const [index, id] of ["howTitle", "rule1Title", "rule1Text", "rule2Title", "rule2Text", "rule3Title", "rule3Text"].entries()) {
      document.getElementById(id).textContent = copy[index];
    }
    demoLink.href = new URL(`/games/${game}/${card.dataset.entry || "index.html"}?demo=1`, window.location.origin).href;
    outputSection.classList.remove("visible");
    outputUrl.value = "";
  }

  for (const card of gameCards) {
    card.addEventListener("click", () => selectGame(card));
  }

  function notify(message, error = false) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.style.borderColor = error ? "#ff7184" : "#ff8b23";
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
  }

  function generate() {
    const username = usernameInput.value.trim().toLowerCase().replace(/^@+/, "");
    if (!username) {
      notify("Digite o @ do perfil que está ao vivo.", true);
      usernameInput.focus();
      return;
    }
    if (!/^[a-z0-9_.]+$/.test(username)) {
      notify("Use apenas letras, números, ponto ou sublinhado no @.", true);
      usernameInput.focus();
      return;
    }

    const game = selectedCard.dataset.game;
    const entry = selectedCard.dataset.entry || "index.html";
    const param = selectedCard.dataset.param || "id";
    const overlayUrl = new URL("/games/" + game + "/" + entry, window.location.origin);
    overlayUrl.searchParams.set(param, username);

    outputUrl.value = overlayUrl.href;
    openOverlay.href = overlayUrl.href;
    outputSection.classList.add("visible");
    outputSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    notify("Link pronto. Abra a arena para verificar a conexão com sua live.");
  }

  generateBtn.addEventListener("click", generate);
  usernameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") generate();
  });

  copyBtn.addEventListener("click", async () => {
    if (!outputUrl.value) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API indisponível");
      await navigator.clipboard.writeText(outputUrl.value);
      notify("Link copiado.");
    } catch {
      outputUrl.focus();
      outputUrl.select();
      const copied = document.execCommand("copy");
      notify(copied ? "Link copiado." : "Selecione o link e copie manualmente.", !copied);
    }
  });
});
