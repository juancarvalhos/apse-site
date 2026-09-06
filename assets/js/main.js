(() => {
  "use strict";

  const CONFIG = {
    whatsappNumber: "5511964525638",
  };

  const WHATSAPP_BASE = `https://wa.me/${CONFIG.whatsappNumber}`;
  const DIRECT_MESSAGE = "Oi, conheci o site e quero conversar sobre um projeto.";
  const FINAL_CTA_MESSAGE = "Oi, conheci o site da Ápse e quero contar uma ideia de projeto.";
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

  function wireWhatsappLinks() {
    const directUrl = `${WHATSAPP_BASE}?text=${encodeURIComponent(DIRECT_MESSAGE)}`;
    const finalCtaUrl = `${WHATSAPP_BASE}?text=${encodeURIComponent(FINAL_CTA_MESSAGE)}`;
    document.querySelectorAll("[data-whatsapp-link]").forEach((link) => {
      link.setAttribute("href", link.dataset.cta === "cta_final" ? finalCtaUrl : directUrl);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noreferrer");
    });
  }

  wireWhatsappLinks();

  /* ==========================================================
     Rodapé: ano atual
     ========================================================== */
  document.querySelectorAll("[data-current-year]").forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });

  /* ==========================================================
     FAQ: sanfona exclusiva (uma pergunta aberta por vez)
     ========================================================== */
  const faqQuestions = document.querySelectorAll(".faq-question");
  faqQuestions.forEach((btn) => {
    btn.addEventListener("click", () => {
      const expanded = btn.getAttribute("aria-expanded") === "true";
      faqQuestions.forEach((other) => {
        other.setAttribute("aria-expanded", "false");
        other.closest(".faq-row")?.classList.remove("is-open");
      });
      if (!expanded) {
        btn.setAttribute("aria-expanded", "true");
        btn.closest(".faq-row")?.classList.add("is-open");
      }
    });
  });

  /* ==========================================================
     Projetos: faixa contínua e infinita (mobile) + destaque
     alternado (desktop)
     ========================================================== */
  initProjetosMarquee();
  initProjetosSpotlight();

  function initProjetosMarquee() {
    const track = document.querySelector("[data-projetos-track]");
    if (!track) return;

    const MOBILE_QUERY = window.matchMedia("(max-width: 899px)");
    const SPEED_PX_PER_SEC = 20;
    const RESUME_DELAY_MS = 1500;

    const originals = Array.from(track.children);
    if (originals.length < 2) return;

    const clones = originals.map((card) => {
      const clone = card.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      clone
        .querySelectorAll('a[href], button, [tabindex]')
        .forEach((el) => el.setAttribute("tabindex", "-1"));
      return clone;
    });
    clones.forEach((clone) => track.appendChild(clone));

    let setWidth = 0;
    function measure() {
      setWidth = clones[0].offsetLeft - originals[0].offsetLeft;
    }
    measure();
    window.addEventListener("resize", measure);

    let hovered = false;
    let focused = false;
    let dragging = false;
    let recentInteraction = false;
    let pageHidden = document.hidden;
    let inView = true;
    let resumeTimer = null;

    function markInteraction() {
      recentInteraction = true;
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        recentInteraction = false;
      }, RESUME_DELAY_MS);
    }

    track.addEventListener("pointerdown", () => {
      dragging = true;
      markInteraction();
    });
    window.addEventListener("pointerup", () => { dragging = false; });
    window.addEventListener("pointercancel", () => { dragging = false; });
    track.addEventListener("touchstart", markInteraction, { passive: true });
    track.addEventListener("wheel", markInteraction, { passive: true });
    track.addEventListener("mouseenter", () => { hovered = true; });
    track.addEventListener("mouseleave", () => { hovered = false; });
    track.addEventListener("focusin", () => { focused = true; });
    track.addEventListener("focusout", () => {
      window.requestAnimationFrame(() => {
        focused = track.contains(document.activeElement);
      });
    });
    document.addEventListener("visibilitychange", () => {
      pageHidden = document.hidden;
    });

    if ("IntersectionObserver" in window) {
      const sectionObserver = new IntersectionObserver(
        ([entry]) => { inView = entry.isIntersecting; },
        { threshold: 0 },
      );
      sectionObserver.observe(track.closest(".projetos") || track);
    }

    function shouldAutoplay() {
      return (
        MOBILE_QUERY.matches &&
        !REDUCED_MOTION.matches &&
        !hovered &&
        !focused &&
        !dragging &&
        !recentInteraction &&
        !pageHidden &&
        inView &&
        setWidth > 0
      );
    }

    /* scrollLeft is rounded to an integer pixel by the browser on every
       read, so accumulating sub-pixel increments straight into
       track.scrollLeft loses the fractional remainder every frame and
       the marquee can stall permanently on high refresh-rate displays.
       Keep the running position in a float and only write it out. */
    let scrollPos = track.scrollLeft;
    let lastTime = null;
    function tick(now) {
      if (lastTime !== null && shouldAutoplay()) {
        const dt = (now - lastTime) / 1000;
        scrollPos += SPEED_PX_PER_SEC * dt;
        if (scrollPos >= setWidth) {
          scrollPos -= setWidth;
        }
        track.scrollLeft = scrollPos;
      } else {
        scrollPos = track.scrollLeft;
      }
      lastTime = now;
      window.requestAnimationFrame(tick);
    }
    window.requestAnimationFrame(tick);
  }

  function initProjetosSpotlight() {
    const track = document.querySelector("[data-projetos-track]");
    if (!track) return;

    const DESKTOP_QUERY = window.matchMedia("(min-width: 900px)");
    const ROTATE_MS = 7000;
    const SWAP_MS = 380;

    const cards = Array.from(track.children).filter((card) => !card.hasAttribute("aria-hidden"));
    if (cards.length < 2) return;

    let index = Math.max(0, cards.findIndex((c) => c.classList.contains("projeto-card--featured")));
    let hovered = false;
    let focused = false;
    let timer = null;

    function shouldRotate() {
      return DESKTOP_QUERY.matches && !REDUCED_MOTION.matches && !hovered && !focused;
    }

    function advance() {
      if (!shouldRotate()) return;
      const nextIndex = (index + 1) % cards.length;
      track.classList.add("is-swapping");
      window.setTimeout(() => {
        cards[index].classList.remove("projeto-card--featured");
        cards[nextIndex].classList.add("projeto-card--featured");
        index = nextIndex;
        track.classList.remove("is-swapping");
      }, SWAP_MS);
    }

    track.addEventListener("mouseenter", () => { hovered = true; });
    track.addEventListener("mouseleave", () => { hovered = false; });
    track.addEventListener("focusin", () => { focused = true; });
    track.addEventListener("focusout", () => {
      window.requestAnimationFrame(() => {
        focused = track.contains(document.activeElement);
      });
    });

    window.setInterval(advance, ROTATE_MS);
  }

  /* ==========================================================
     Radar de projeto
     ========================================================== */
  const QUESTIONS = [
    {
      id: "direciona",
      label: "Etapa 1 de 3",
      text: "Quando alguém se interessa pelo seu trabalho, para onde você manda essa pessoa?",
      options: [
        { value: "redes", text: "Para minhas redes sociais" },
        { value: "site", text: "Para um site que já existe" },
        { value: "whatsapp", text: "Direto para o WhatsApp" },
        { value: "sem-lugar", text: "Estou começando a construir esse lugar" },
      ],
    },
    {
      id: "precisa",
      label: "Etapa 2 de 3",
      text: "O que essa pessoa precisa encontrar?",
      options: [
        { value: "quem-sou", text: "Quem eu sou, o que faço e como entrar em contato" },
        { value: "oferta", text: "Uma oferta, serviço ou lançamento específico" },
        { value: "trabalhos", text: "Meus trabalhos antes de falar comigo" },
        { value: "nao-sei", text: "Quero encontrar a direção certa" },
      ],
    },
    {
      id: "origem",
      label: "Etapa 3 de 3",
      text: "De onde essas pessoas costumam chegar?",
      options: [
        { value: "indicacao", text: "Indicação ou busca pelo meu nome" },
        { value: "redes-sociais", text: "Redes sociais ou conteúdos" },
        { value: "anuncios", text: "Anúncios ou campanhas" },
        { value: "varios", text: "Vários lugares diferentes" },
      ],
    },
  ];

  function labelFor(questionId, value) {
    const question = QUESTIONS.find((q) => q.id === questionId);
    const option = question?.options.find((o) => o.value === value);
    return option ? option.text : "";
  }

  function getRecommendation(answers) {
    if (answers.precisa === "oferta") {
      return {
        title: "Uma página focada na sua oferta.",
        copy: "Uma landing page mantém a atenção em um serviço, campanha ou lançamento e conduz até uma ação principal.",
      };
    }
    if (answers.precisa === "trabalhos") {
      return {
        title: "Um site com seus projetos no centro.",
        copy: "Organize trabalhos, contexto e serviços para que quem chega entenda o que você cria antes de entrar em contato.",
      };
    }
    if (answers.precisa === "nao-sei") {
      return {
        title: "Antes da página, vale organizar o caminho.",
        copy: "Vale entender primeiro o que precisa ser apresentado e qual papel essa página terá, antes de escolher um formato.",
      };
    }
    if (answers.direciona === "site") {
      return {
        title: "Seu site já existe. Agora ele precisa representar melhor o negócio.",
        copy: "O próximo passo é rever a mensagem, a estrutura e o caminho até o contato.",
      };
    }
    return {
      title: "Um site para ser sua base.",
      copy: "Reúna seu negócio em um lugar próprio, apresente o que você faz e deixe claro como continuar a conversa.",
    };
  }

  function buildResultMessage(answers, recommendation) {
    return [
      "Oi, respondi ao radar do site.",
      "",
      `Hoje direciono as pessoas para: ${labelFor("direciona", answers.direciona)}`,
      "",
      `Elas precisam encontrar: ${labelFor("precisa", answers.precisa)}`,
      "",
      `Costumam conhecer meu trabalho por: ${labelFor("origem", answers.origem)}`,
      "",
      `O caminho indicado foi: ${recommendation.title}`,
      "",
      "Quero entender como isso pode virar um projeto.",
    ].join("\n");
  }

  const root = document.querySelector("[data-diagnostico]");
  if (!root) return;

  const closedView = root.querySelector('[data-diag-view="closed"]');
  const openView = root.querySelector('[data-diag-view="open"]');
  const questionArea = root.querySelector("[data-diag-question-area]");
  const progressFill = root.querySelector("[data-diag-progress-fill]");
  const progressBar = root.querySelector(".diagnostico-progress");
  const backBtn = root.querySelector("[data-diag-back]");
  const startBtn = root.querySelector("[data-diag-start]");
  const startLabel = root.querySelector("[data-diag-start-label]");
  const closeBtn = root.querySelector("[data-diag-close]");
  const miniRadar = root.querySelector(".diag-emblem--mini");
  const handleEl = document.querySelector("[data-diag-handle]");
  const panelEl = root;

  const SHEET_QUERY = window.matchMedia("(max-width: 899px)");
  const state = { index: 0, answers: {}, view: "closed" };
  let savedScrollY = 0;

  function lockBodyScroll() {
    savedScrollY = window.scrollY;
    document.body.classList.add("diag-sheet-open");
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
  }

  function unlockBodyScroll() {
    document.body.classList.remove("diag-sheet-open");
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    window.scrollTo(0, savedScrollY);
  }

  function getFocusable() {
    return Array.from(
      panelEl.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.offsetParent !== null);
  }

  function trapFocus(event) {
    if (event.key !== "Tab") return;
    const focusable = getFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function setProgress(step, total) {
    const pct = Math.round((step / total) * 100);
    progressFill.style.width = `${pct}%`;
    progressBar.setAttribute("aria-valuenow", String(step));
    progressBar.setAttribute("aria-valuemax", String(total));
  }

  function pingMiniRadar() {
    if (!miniRadar) return;
    miniRadar.classList.remove("is-pinged");
    void miniRadar.offsetWidth;
    miniRadar.classList.add("is-pinged");
    window.setTimeout(() => miniRadar.classList.remove("is-pinged"), 420);
  }

  function playQuestionAreaTransition(variant) {
    questionArea.classList.remove("diag-animate-0", "diag-animate-1", "diag-animate-2", "diag-animate-3");
    void questionArea.offsetWidth;
    questionArea.classList.add(`diag-animate-${variant}`);
  }

  function renderQuestion() {
    const q = QUESTIONS[state.index];
    setProgress(state.index + 1, QUESTIONS.length);

    questionArea.innerHTML = "";

    const stepLabel = document.createElement("p");
    stepLabel.className = "diag-step-label";
    stepLabel.textContent = q.label;

    const heading = document.createElement("h3");
    heading.className = "diag-question";
    heading.id = "diag-question-heading";
    heading.textContent = q.text;
    heading.setAttribute("tabindex", "-1");

    const optionsWrap = document.createElement("div");
    optionsWrap.className = "diag-options";
    optionsWrap.setAttribute("role", "group");
    optionsWrap.setAttribute("aria-labelledby", "diag-question-heading");

    q.options.forEach((opt) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "diag-chip";
      chip.dataset.value = opt.value;

      const mark = document.createElement("span");
      mark.className = "diag-chip-mark";
      mark.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.textContent = opt.text;

      chip.append(mark, label);
      chip.addEventListener("click", () => {
        if (chip.classList.contains("is-selected")) return;
        optionsWrap.querySelectorAll(".diag-chip").forEach((c) => c.classList.remove("is-selected"));
        chip.classList.add("is-selected");
        pingMiniRadar();
        const delay = REDUCED_MOTION.matches ? 60 : 400;
        window.setTimeout(() => selectAnswer(q.id, opt.value), delay);
      });
      optionsWrap.appendChild(chip);
    });

    questionArea.append(stepLabel, heading, optionsWrap);
    backBtn.hidden = state.index === 0;
    playQuestionAreaTransition(state.index % 3);
    heading.focus({ preventScroll: true });
  }

  function renderResult() {
    setProgress(QUESTIONS.length, QUESTIONS.length);
    const recommendation = getRecommendation(state.answers);
    const message = buildResultMessage(state.answers, recommendation);
    const url = `${WHATSAPP_BASE}?text=${encodeURIComponent(message)}`;

    questionArea.innerHTML = "";

    const label = document.createElement("p");
    label.className = "diag-result-label";
    label.textContent = "Seu próximo passo";

    const title = document.createElement("h3");
    title.className = "diag-result-title";
    title.textContent = recommendation.title;
    title.setAttribute("tabindex", "-1");

    const copy = document.createElement("p");
    copy.className = "diag-result-copy";
    copy.textContent = recommendation.copy;

    const actions = document.createElement("div");
    actions.className = "diag-result-actions";

    const sendLink = document.createElement("a");
    sendLink.className = "btn btn-dark";
    sendLink.href = url;
    sendLink.target = "_blank";
    sendLink.rel = "noreferrer";
    const sendLabel = document.createTextNode("Conversar sobre este caminho ");
    const sendArrow = document.createElement("span");
    sendArrow.className = "btn-arrow";
    sendArrow.setAttribute("aria-hidden", "true");
    sendArrow.textContent = "→";
    sendLink.append(sendLabel, sendArrow);

    const restartBtn = document.createElement("button");
    restartBtn.type = "button";
    restartBtn.className = "btn-text";
    restartBtn.textContent = "Refazer radar";
    restartBtn.addEventListener("click", resetDiagnostico);

    actions.append(sendLink, restartBtn);
    questionArea.append(label, title, copy, actions);
    backBtn.hidden = false;
    playQuestionAreaTransition(3);
    title.focus({ preventScroll: true });
  }

  function selectAnswer(questionId, value) {
    state.answers[questionId] = value;
    if (state.index < QUESTIONS.length - 1) {
      state.index += 1;
      renderQuestion();
    } else {
      state.index = QUESTIONS.length;
      renderResult();
    }
  }

  function resetDiagnostico() {
    state.index = 0;
    state.answers = {};
    renderQuestion();
  }

  function openDiagnostico() {
    state.view = "open";
    closedView.hidden = true;
    openView.hidden = false;

    if (SHEET_QUERY.matches) {
      lockBodyScroll();
      handleEl.hidden = false;
      document.addEventListener("keydown", trapFocus);
    }

    if (state.index >= QUESTIONS.length) {
      renderResult();
    } else {
      renderQuestion();
    }
  }

  function closeDiagnostico({ restoreFocus = true } = {}) {
    state.view = "closed";
    openView.hidden = true;
    closedView.hidden = false;
    startLabel.textContent = "Começar";

    if (document.body.classList.contains("diag-sheet-open")) {
      unlockBodyScroll();
    }
    if (handleEl) handleEl.hidden = true;
    document.removeEventListener("keydown", trapFocus);

    if (restoreFocus) startBtn.focus({ preventScroll: true });
  }

  startBtn.addEventListener("click", openDiagnostico);
  closeBtn.addEventListener("click", () => closeDiagnostico());
  if (handleEl) handleEl.addEventListener("click", () => closeDiagnostico());

  backBtn.addEventListener("click", () => {
    if (state.index > 0) {
      state.index -= 1;
      renderQuestion();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.view === "open") {
      closeDiagnostico();
    }
  });

  document.querySelectorAll("[data-diagnostico-scroll]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      root.scrollIntoView({ behavior: "smooth", block: "start" });
      if (state.view !== "open") openDiagnostico();
    });
  });

  /* ==========================================================
     Ícone fixo de WhatsApp: só aparece depois que o primeiro
     quadro inteiro (hero + radar) sai de vista, para nunca
     competir com o radar, e some de novo quando o card final
     entra em tela (ele já traz a ação principal).
     ========================================================== */
  const stickyBar = document.querySelector(".sticky-whatsapp");
  const firstQuadro = document.querySelector(".diagnostico-wrap");
  const ctaFinal = document.querySelector("#contato");

  if (stickyBar && firstQuadro && "IntersectionObserver" in window) {
    let heroPassed = false;
    let ctaInView = false;

    function updateStickyVisibility() {
      stickyBar.classList.toggle("is-visible", heroPassed && !ctaInView);
    }

    const heroObserver = new IntersectionObserver(
      ([entry]) => {
        heroPassed = !entry.isIntersecting;
        updateStickyVisibility();
      },
      { threshold: 0 },
    );
    heroObserver.observe(firstQuadro);

    if (ctaFinal) {
      const ctaObserver = new IntersectionObserver(
        ([entry]) => {
          ctaInView = entry.isIntersecting;
          updateStickyVisibility();
        },
        { threshold: 0.15 },
      );
      ctaObserver.observe(ctaFinal);
    }
  } else if (stickyBar) {
    stickyBar.classList.add("is-visible");
  }
})();
