(() => {
  const media = matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";
  try { preference = localStorage.getItem("opentrial.appearance") || "system"; } catch {}
  if (!["light", "dark", "system"].includes(preference)) preference = "system";
  function apply(value) {
    preference = value;
    document.documentElement.dataset.theme = value === "system" ? (media.matches ? "dark" : "light") : value;
    document.querySelectorAll("[data-appearance]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.appearance === value));
    });
  }
  apply(preference);
  media.addEventListener("change", () => apply(preference));
  document.addEventListener("DOMContentLoaded", () => {
    apply(preference);
    document.querySelectorAll("[data-appearance]").forEach(button => button.addEventListener("click", () => {
      apply(button.dataset.appearance);
      try { localStorage.setItem("opentrial.appearance", preference); } catch {}
    }));
    document.addEventListener("click", event => {
      const menu = document.querySelector(".appearance");
      if (menu && !menu.contains(event.target)) menu.open = false;
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        const menu = document.querySelector(".appearance");
        if (menu?.open) { menu.open = false; menu.querySelector("summary").focus(); }
      }
    });
  });
})();
