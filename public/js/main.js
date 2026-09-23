const menuButton = document.getElementById("mobile-menu-button");
const mobileMenu = document.getElementById("mobile-menu");
const menuIcon = document.getElementById("menu-icon");
const closeIcon = document.getElementById("close-icon");

if (menuButton && mobileMenu) {
  menuButton.addEventListener("click", () => {
    const isOpen =
      menuButton.getAttribute("aria-expanded") === "true";

    menuButton.setAttribute(
      "aria-expanded",
      String(!isOpen)
    );

    mobileMenu.classList.toggle("hidden");

    menuIcon?.classList.toggle("hidden");
    closeIcon?.classList.toggle("hidden");

    menuButton.setAttribute(
      "aria-label",
      isOpen ? "Buka menu" : "Tutup menu"
    );
  });
}

// ========================================
// THEME
// ========================================

const themeToggles = document.querySelectorAll(".theme-toggle");

function updateThemeUI() {
  const isDark = document.documentElement.classList.contains("dark");

  document.querySelectorAll(".theme-icon-moon").forEach((icon) => {
    icon.classList.toggle("hidden", !isDark);
  });

  document.querySelectorAll(".theme-icon-sun").forEach((icon) => {
    icon.classList.toggle("hidden", isDark);
  });

  document.querySelectorAll(".theme-label").forEach((label) => {
    label.textContent = isDark ? "Gelap" : "Terang";
  });

  themeToggles.forEach((button) => {
    button.setAttribute(
      "aria-label",
      isDark ? "Gunakan tema terang" : "Gunakan tema gelap"
    );
  });
}

themeToggles.forEach((button) => {
  button.addEventListener("click", () => {
    const isDark =
      document.documentElement.classList.contains("dark");

    document.documentElement.classList.toggle("dark", !isDark);

    try {
      localStorage.setItem(
        "alfath-theme",
        isDark ? "light" : "dark"
      );
    } catch (_) {}

    updateThemeUI();
  });
});

updateThemeUI();
