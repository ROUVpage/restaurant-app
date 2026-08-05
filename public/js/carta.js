(async function initGenericMenu() {
  setupNav();
  const products = await apiCached('/api/products', { ttlMs: 120000 });
  renderProducts(products);
})();

function renderProducts(products) {
  for (const [cat, items] of Object.entries(products)) {
    const grid = document.getElementById(`grid-${cat}`);
    if (!grid) continue;
    grid.innerHTML = items.map((p) => `
      <div class="product-card">
        <div class="product-name">${p.name}</div>
        <div class="product-price">${fmt(p.price)}</div>
        <div class="product-desc">${p.description}</div>
      </div>
    `).join('');
  }
}

function setupNav() {
  const area = document.getElementById('productsArea');
  const btns = document.querySelectorAll('.cat-btn');
  const sections = document.querySelectorAll('.products-section');

  area?.classList.add('section-paged');

  const activateSection = (cat) => {
    btns.forEach((b) => b.classList.toggle('active', b.dataset.cat === cat));
    sections.forEach((s) => s.classList.toggle('active', s.id === cat));
  };

  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      activateSection(btn.dataset.cat);
    });
  });

  const initiallyActive = document.querySelector('.cat-btn.active')?.dataset.cat || sections[0]?.id;
  if (initiallyActive) activateSection(initiallyActive);
}
