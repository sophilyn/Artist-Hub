// Highlights the current page in the navigation bar.

document.addEventListener("DOMContentLoaded", () => {
  const currentPage = document.body.dataset.page;
  const navLinks = document.querySelectorAll(".nav nav a[data-p]");

  navLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.p === currentPage);
  });
});