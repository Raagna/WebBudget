// HTTPS for `npm run preview:lan`, so a phone on the same Wi-Fi gets a
// secure origin and the service worker / install flow can run on it.
//
// Clicking through a self-signed-certificate warning is not enough: Chrome
// refuses to register a service worker, and won't offer a real install, on
// an origin with a certificate error. The phone has to trust the
// certificate. So, like mkcert, this keeps a small local certificate
// authority in frontend/.lan-https/ (gitignored) that the phone installs
// once, and signs a server certificate with it for this PC's LAN IP
// addresses. The CA outlives `npm ci` and IP changes; the server
// certificate is reissued whenever the PC's addresses change.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';

const { pki } = forge;
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.lan-https');
const DAY = 24 * 60 * 60 * 1000;
export const CA_PATH = '/lan-ca.crt';

// IPv4 addresses other devices can reach this PC on (Wi-Fi, Ethernet).
export function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address)
    .sort();
}

function issue({ subject, issuer = subject, publicKey, signingKey, days, extensions }) {
  const cert = pki.createCertificate();
  cert.publicKey = publicKey;
  // Positive 128-bit serial: a leading 00 byte keeps the DER integer unsigned.
  cert.serialNumber = '00' + forge.util.bytesToHex(forge.random.getBytesSync(16));
  cert.validity.notBefore = new Date(Date.now() - DAY);
  cert.validity.notAfter = new Date(Date.now() + days * DAY);
  cert.setSubject(subject);
  cert.setIssuer(issuer);
  cert.setExtensions(extensions);
  cert.sign(signingKey, forge.md.sha256.create());
  return cert;
}

function read(file) {
  try {
    return fs.readFileSync(path.join(DIR, file), 'utf8');
  } catch {
    return null;
  }
}

function write(file, contents) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, file), contents);
}

function loadCa() {
  const certPem = read('ca.crt');
  const keyPem = read('ca.key');
  if (certPem && keyPem) {
    const cert = pki.certificateFromPem(certPem);
    if (cert.validity.notAfter.getTime() > Date.now() + 30 * DAY) {
      return { cert, key: pki.privateKeyFromPem(keyPem), pem: certPem };
    }
  }
  const keys = pki.rsa.generateKeyPair(2048);
  const subject = [
    { name: 'commonName', value: `WebBudget LAN dev CA (${os.hostname()})` },
    { name: 'organizationName', value: 'WebBudget local development' },
  ];
  const cert = issue({
    subject,
    publicKey: keys.publicKey,
    signingKey: keys.privateKey,
    days: 3650,
    extensions: [
      { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ],
  });
  const pem = pki.certificateToPem(cert);
  write('ca.key', pki.privateKeyToPem(keys.privateKey));
  write('ca.crt', pem);
  // A new CA means the old server certificate no longer chains to it.
  fs.rmSync(path.join(DIR, 'server.crt'), { force: true });
  return { cert, key: keys.privateKey, pem };
}

// Returns { key, cert } for Vite's `https` option plus the CA (PEM) the
// phone installs, and the addresses the certificate covers.
export function lanCertificate() {
  const ca = loadCa();
  const ips = lanAddresses();
  const names = ['localhost', ...ips, '127.0.0.1'];

  const certPem = read('server.crt');
  const keyPem = read('server.key');
  if (certPem && keyPem) {
    const cert = pki.certificateFromPem(certPem);
    const san = cert.getExtension('subjectAltName');
    const covered = san ? san.altNames.map((n) => n.ip || n.value) : [];
    if (
      names.every((n) => covered.includes(n)) &&
      cert.validity.notAfter.getTime() > Date.now() + 30 * DAY &&
      ca.cert.verify(cert)
    ) {
      return { key: keyPem, cert: certPem, caPem: ca.pem, ips };
    }
  }

  const keys = pki.rsa.generateKeyPair(2048);
  const cert = issue({
    subject: [{ name: 'commonName', value: ips[0] || 'localhost' }],
    issuer: ca.cert.subject.attributes,
    publicKey: keys.publicKey,
    signingKey: ca.key,
    // Apple rejects TLS server certificates valid for more than 825 days.
    days: 397,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        // An IP has to be listed as an IP entry (type 7); browsers don't
        // match an IP host against a DNS name.
        altNames: names.map((n) => (/^[\d.]+$/.test(n) ? { type: 7, ip: n } : { type: 2, value: n })),
      },
      { name: 'subjectKeyIdentifier' },
      { name: 'authorityKeyIdentifier', keyIdentifier: ca.cert.generateSubjectKeyIdentifier().getBytes() },
    ],
  });
  const key = pki.privateKeyToPem(keys.privateKey);
  const pem = pki.certificateToPem(cert);
  write('server.key', key);
  write('server.crt', pem);
  return { key, cert: pem, caPem: ca.pem, ips };
}

// Vite plugin: active only with `--mode lan` (see the preview:lan script),
// so `npm run dev`, `dev:lan` and normal builds are untouched.
export function lanHttps() {
  let cert;
  return {
    name: 'webbudget:lan-https',
    config(_, { mode, command }) {
      if (mode !== 'lan' || command !== 'serve') return;
      cert = lanCertificate();
      const https = { key: cert.key, cert: cert.cert };
      return { server: { https }, preview: { https } };
    },
    configurePreviewServer(server) {
      if (!cert) return;
      // The phone downloads the CA from here once (after clicking through
      // the warning a single time) and installs it; see README.
      server.middlewares.use(CA_PATH, (req, res) => {
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        res.setHeader('Content-Disposition', 'attachment; filename="webbudget-lan-ca.crt"');
        res.end(cert.caPem);
      });
      const port = server.config.preview.port ?? 4173;
      return () => {
        const where = cert.ips.map((ip) => `https://${ip}:${port}${CA_PATH}`).join(', ');
        server.config.logger.info(`  Phone, first time only: install the CA from ${where || `<this PC>:${port}${CA_PATH}`}`);
      };
    },
  };
}
