/**
 * JWT helpers.
 *
 * These are placeholders. The real implementations land in Module 1.2
 * (Authentication APIs). They're stubbed here so `sockets/index.js` and
 * later modules can `require('../utils/jwt')` without restructuring.
 *
 * For now, sign/verify throw so any accidental use is loud.
 */

function signJwt(_payload, _options) {
  throw new Error('signJwt() not implemented yet — see Module 1.2');
}

function verifyJwt(_token) {
  throw new Error('verifyJwt() not implemented yet — see Module 1.2');
}

module.exports = { signJwt, verifyJwt };