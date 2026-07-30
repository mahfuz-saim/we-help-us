/**
 * Multer upload middleware.
 *
 * Enforces the project-wide photo upload rules (KEY DESIGN REMINDERS):
 *   - Max 5 files per request (applies to multi-file uploads only —
 *     `uploadAvatar` is a single-file endpoint and inherits the same
 *     per-file size + mime constraints)
 *   - Max 5 MB per file
 *   - Image mime types only (jpeg, jpg, png, webp, gif)
 *
 * Routes that accept photos should use `upload.array('photos', 5)`.
 * Field name is `photos` by convention — the registration form uses
 * the same name in Module 3.4.
 *
 * Routes that accept a single avatar should use `uploadAvatar('avatar')`
 * (added in Module 1.4 for the user-profile endpoint).
 */

const multer = require('multer');
const ApiError = require('../utils/apiError');

const MAX_FILES = 5;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const storage = multer.memoryStorage();

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(
      new ApiError(
        400,
        `Unsupported file type: ${file.mimetype}. Allowed: jpeg, jpg, png, webp, gif.`
      )
    );
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: MAX_FILES,
  },
});

/**
 * Hard guard around multer's array() so we can surface a clean ApiError
 * when the client exceeds the 5-file or 5MB-per-file limits — multer
 * raises MulterError / LimiterError otherwise.
 */
function uploadPhotos(fieldName = 'photos') {
  const handler = upload.array(fieldName, MAX_FILES);
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new ApiError(400, `Each photo must be under 5 MB.`)
          );
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return next(
            new ApiError(400, `You can upload at most ${MAX_FILES} photos.`)
          );
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(
            new ApiError(400, `Unexpected file field: ${err.field}`)
          );
        }
        return next(new ApiError(400, err.message));
      }
      return next(err);
    });
  };
}

/**
 * Single-file variant for the avatar endpoint (Module 1.4).
 *
 * Same 5 MB cap and image mime filter as `uploadPhotos` — the fileFilter
 * and limits live on the underlying multer instance, so we inherit them
 * automatically.
 */
function uploadAvatar(fieldName = 'avatar') {
  const handler = upload.single(fieldName);
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new ApiError(400, `Avatar must be under 5 MB.`)
          );
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(
            new ApiError(400, `Unexpected file field: ${err.field}`)
          );
        }
        return next(new ApiError(400, err.message));
      }
      return next(err);
    });
  };
}

module.exports = {
  upload,
  uploadPhotos,
  uploadAvatar,
  MAX_FILES,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES: Array.from(ALLOWED_MIME_TYPES),
};
