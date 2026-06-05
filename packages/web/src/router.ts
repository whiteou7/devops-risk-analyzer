import { createRouter, createWebHistory } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import ResultsPage from './pages/ResultsPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomePage },
    {
      path: '/results/:jobId',
      component: ResultsPage,
      props: (route) => ({
        jobId: route.params.jobId as string,
        timelineJobId: route.query.timeline as string | undefined,
      }),
    },
  ],
});
