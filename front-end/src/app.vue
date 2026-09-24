<script setup lang="ts">
import { appName } from '~/constants'

useHead({ title: appName, htmlAttrs: { lang: 'en' } })
</script>

<template>
  <NuxtLayout><NuxtPage /></NuxtLayout>
</template>

<style>
@font-face {
  font-family: 'DM Sans';
  src: url('/assets/fonts/dmsans-7c37c8a6.woff2') format('woff2');
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: 'DM Serif';
  src: url('/assets/fonts/dmserifdisplay-b6206db2.woff2') format('woff2');
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
* {
  box-sizing: border-box;
}
html,
body,
#__nuxt {
  min-height: 100%;
  margin: 0;
  padding: 0;
}
html,
html.dark {
  font-family: 'DM Sans', sans-serif;
  color: #eef0e9;
  background: #131916;
  color-scheme: dark;
}
body {
  color: inherit;
  background: inherit;
}
button,
input,
select {
  font: inherit;
}
button,
a,
input,
select {
  -webkit-tap-highlight-color: transparent;
}
button,
a {
  touch-action: manipulation;
}
button {
  cursor: pointer;
}
button:disabled {
  cursor: wait;
  opacity: 0.55;
}
a {
  color: inherit;
}
button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 3px solid #8db5a2;
  outline-offset: 4px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.wordmark {
  font-family: 'DM Serif', Georgia, serif;
  text-decoration: none;
  font-size: 2.25rem;
  letter-spacing: -0.06em;
  line-height: 1;
}
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid #ffffff30;
  border-radius: 50%;
  background: transparent;
  color: inherit;
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
