window.__ATE__ = window.__ATE__ || {};
window.__ATE__.adapters = window.__ATE__.adapters || {};

window.__ATE__.getAdapter = () => {
  const host = window.location.hostname;
  for (const key in window.__ATE__.adapters) {
    if (window.__ATE__.adapters[key].matches(host)) {
      return window.__ATE__.adapters[key];
    }
  }
  return null;
};