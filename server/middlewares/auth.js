/**
 * Auth middleware stubs.
 *
 * These are placeholders that will be implemented in Module 1.2
 * (Authentication APIs). They're declared here so route files can
 * `require('../middlewares/auth')` and grow into real middleware
 * without restructuring imports later.
 *
 * Public registration rule (KEY DESIGN REMINDER): only OWNER and
 * VOLUNTEER roles can self-register. MODERATOR and ADMIN must be
 * created via the protected admin route.
 */

function protect(_req, _res, next) {
  return next(
    Object.assign(new Error('protect() not implemented yet — see Module 1.2'), {
      statusCode: 501,
    })
  );
}

function authorize(..._roles) {
  return function (_req, _res, next) {
    return next(
      Object.assign(
        new Error('authorize() not implemented yet — see Module 1.2'),
        { statusCode: 501 }
      )
    );
  };
}

module.exports = { protect, authorize };