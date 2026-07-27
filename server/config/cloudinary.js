/**
 * Cloudinary configuration.
 *
 * Actual upload helpers are wired up in later modules (Resource Registration,
 * User Profile). For Module 0.2 this just configures the SDK with env values
 * so it's ready to use, and exposes the configured instance.
 */

const cloudinary = require('cloudinary').v2;

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

  return true;
}

module.exports = { cloudinary, configureCloudinary };
