const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let cachedClient = null;

function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME
  );
}

function getR2Client() {
  if (!isR2Configured()) {
    throw new Error('Cloudflare R2 is not configured on this server.');
  }
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(),
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim(),
      },
    });
  }
  return cachedClient;
}

function getBucketName() {
  return (process.env.R2_BUCKET_NAME || '').trim();
}

/**
 * Generate a 15-minute Presigned PUT URL for direct client -> R2 uploads.
 */
async function createPresignedUploadUrl({ key, contentType }) {
  const client = getR2Client();
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });
  return getSignedUrl(client, command, { expiresIn: 15 * 60 });
}

/**
 * Generate a 4-hour Presigned GET URL for direct streaming or offline download.
 */
async function createPresignedStreamUrl({ key }) {
  const client = getR2Client();
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: 4 * 60 * 60 });
}

/**
 * Delete an object from Cloudflare R2 to free bucket storage.
 */
async function deleteR2Object({ key }) {
  const client = getR2Client();
  const command = new DeleteObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });
  return client.send(command);
}

module.exports = {
  isR2Configured,
  createPresignedUploadUrl,
  createPresignedStreamUrl,
  deleteR2Object,
};
