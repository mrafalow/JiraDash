'use strict';

/** In-memory DScribe session only — never written to disk by this module. */
let memoryCookie = (process.env.DSCRIBE_COOKIE || '').trim() || null;

const DSCRIBE_BASE = 'https://dpep-dscribe-production.tridion.sdlproducts.com';

function getCookie() {
  return memoryCookie;
}

function setCookie(raw) {
  const c = (raw || '').trim();
  memoryCookie = c || null;
  return !!memoryCookie;
}

function clearCookie() {
  memoryCookie = null;
}

function cookieFromEnvOnBoot() {
  const c = (process.env.DSCRIBE_COOKIE || '').trim();
  if (c) memoryCookie = c;
}

cookieFromEnvOnBoot();

function validateCookie(cookie) {
  const c = (cookie || memoryCookie || '').trim();
  if (!c) {
    return Promise.resolve({ ok: false, status: 0, error: 'No DScribe cookie configured.' });
  }
  if (!/UserSessionID=/i.test(c)) {
    return Promise.resolve({ ok: false, status: 0, error: 'Cookie must include UserSessionID.' });
  }
  return fetch(DSCRIBE_BASE + '/ui/account/user', {
    method: 'GET',
    headers: {
      Cookie: c,
      Accept: 'application/json',
      'request-client': 'experience-space',
      'x-csrf': '1'
    }
  }).then((res) => ({
    ok: res.status === 200,
    status: res.status,
    error: res.status === 200 ? null : 'DScribe session invalid or expired (HTTP ' + res.status + ').'
  })).catch((err) => ({
    ok: false,
    status: 0,
    error: err && err.message ? err.message : String(err)
  }));
}

module.exports = {
  DSCRIBE_BASE,
  getCookie,
  setCookie,
  clearCookie,
  validateCookie
};
