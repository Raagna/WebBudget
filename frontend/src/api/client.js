import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const client = axios.create({ baseURL: BASE_URL });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('finance_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// A 401 means the token is missing/expired - clear it and bounce to login
// rather than letting the app sit in a broken authenticated-looking state.
// This app uses HashRouter (for GitHub Pages compatibility - see App.jsx),
// so the current route lives in window.location.hash ("#/transactions"),
// not the path. And on GitHub Pages the app is served from a subpath
// (e.g. https://you.github.io/repo-name/), so an ABSOLUTE redirect like
// `window.location.href = '/login'` would send the browser to the domain
// root instead of back into the app - a 404, not a login screen. Setting
// the hash instead keeps the redirect inside the app regardless of what
// subpath it's deployed under.
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('finance_token');
      localStorage.removeItem('finance_user');
      if (!window.location.hash.startsWith('#/login')) {
        window.location.hash = '#/login';
      }
    }
    return Promise.reject(err);
  }
);

export default client;
