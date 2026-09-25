/** Dashboard da Corrida do Povo: prepara o link de captura sem fingir uma conexão LIVE. */
document.addEventListener("DOMContentLoaded", () => {
  const usernameInput = document.getElementById("username");
  const generateBtn = document.getElementById("generateBtn");
  const outputSection = document.getElementById("outputSection");
  const outputUrl = document.getElementById("outputUrl");
  const openOverlay = document.getElementById("openOverlay");
  const copyBtn = document.getElementById("copyBtn");
  const toast = document.getElementById("toast");
  const gameCards = Array.from(document.querySelectorAll(".game-card[data-game]"));
  let selectedCard = gameCards.find((card) => card.classList.contains("selected")) || gameCards[0];
  let toastTimer;

  for (const card of gameCards) {
    card.addEventListener("click", () => {
      for (const option of gameCards) {
        const active = option === card;
        option.classList.toggle("selected", active);
        option.setAttribute("aria-pressed", String(active));
      }
      selectedCard = card;
    });
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
