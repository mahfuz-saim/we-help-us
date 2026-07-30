/**
 * Cloudinary configuration.
 *
 * Module 1.4 starts exercising this for the user-avatar upload. The SDK
 * is configured once at boot if CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET
 * are all present. If not, the server still boots — uploads become a
 * clean 503 with a friendly message. Routes that need Cloudinary should
 * call `isCloudinaryConfigured()` before invoking the SDK.
 */

const cloudinary = require('cloudinary').v2;

let configured = false;

function configureCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    // Don't throw — uploads are not exercised by the health route and the
    // app should still boot. Routes that need Cloudinary will fail clearly
    // when they try to upload without it configured.
    return false;
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });

  configured = true;
  return true;
}

function isCloudinaryConfigured() {
  return configured;
}

module.exports = { cloudinary, configureCloudinary, isCloudinaryConfigured };
