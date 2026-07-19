<template>
  <span class="brand-logo" aria-label="JamaAI">
    <img class="brand-logo__image" src="/logo.jpg" alt="" />
    <span class="brand-logo__name">JamaAI</span>
  </span>
</template>

<style scoped>
.brand-logo {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  white-space: nowrap;
}

.brand-logo__image {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9px;
  background: #101010;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.28);
  object-fit: cover;
  object-position: center 32%;
}

.brand-logo__name {
  color: #f4f4f5;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1;
}

:global(html.light) .brand-logo__image {
  border-color: rgba(24, 24, 27, 0.12);
  box-shadow: 0 3px 12px rgba(24, 24, 27, 0.14);
}

:global(html.light) .brand-logo__name {
  color: #18181b;
}
</style>
