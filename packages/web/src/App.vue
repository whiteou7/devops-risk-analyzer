<template>
  <div class="min-h-screen bg-slate-950">
    <header class="border-b border-slate-800 px-6 py-4">
      <RouterLink to="/" class="text-xl font-semibold text-white tracking-tight hover:text-slate-300 transition-colors">
        DevOps Risk Analyzer
      </RouterLink>
    </header>
    <main class="px-6 py-8 max-w-7xl mx-auto">
      <RouterView />
    </main>
  </div>
</template>
