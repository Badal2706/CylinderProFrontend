// A production bundle must never talk to a local machine.
//
// On 25 Sep 2026 a bundle built on a PC without `.env.production` fell back to the development API
// address (`http://localhost:3001/api`, the default in src/App.jsx) and was published. Every
// browser then tried to reach its OWN computer: the whole app showed "Network error" while the
// server was perfectly healthy, and no server-side check could see it.
//
// This plugin makes such a bundle impossible to build, on any machine (the PC or the droplet):
//   1. before building — VITE_API_URL must be set, and must not point at a local address;
//   2. after bundling, before anything is written — no emitted file may contain a local address,
//      however it got there (a hardcoded URL, a new env variable, a library default).
// Either failure stops `npm run build` with a non-zero exit, so nothing new reaches dist/ and a
// chained publish (`npm run build && …`) never runs. `npm run dev` is not affected.

const LOCAL = /\blocalhost\b|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/;

export function refuseLocalApiBuild() {
  return {
    name: 'refuse-local-api-build',
    apply: 'build',

    configResolved(config) {
      const api = config.env.VITE_API_URL;
      if (!api) {
        throw new Error(
          '\n\nRefusing to build: VITE_API_URL is not set, so the app would fall back to ' +
          'http://localhost:3001/api and every browser would call its own computer.\n' +
          'Create .env.production next to package.json containing:  VITE_API_URL=/api\n' +
          '(the droplet has one: ~/CylinderProFrontend/.env.production)\n');
      }
      if (LOCAL.test(api)) {
        throw new Error(
          `\n\nRefusing to build: VITE_API_URL is "${api}", a local address. A published bundle ` +
          'would make every browser call its own computer.\n' +
          'Production uses the same-origin path:  VITE_API_URL=/api  (in .env.production)\n');
      }
    },

    generateBundle(_options, bundle) {
      const offenders = [];
      for (const [fileName, item] of Object.entries(bundle)) {
        const text = item.type === 'chunk' ? item.code
          : (typeof item.source === 'string' ? item.source : Buffer.from(item.source).toString('utf8'));
        const m = LOCAL.exec(text);
        if (m) {
          const at = Math.max(0, m.index - 40);
          offenders.push(`  ${fileName}: …${text.slice(at, m.index + 40).replace(/\s+/g, ' ')}…`);
        }
      }
      if (offenders.length) {
        this.error(
          '\n\nRefusing to write this bundle: it contains a local address, which in production ' +
          'would point every browser at its own computer.\n' + offenders.join('\n') + '\n');
      }
    }
  };
}
