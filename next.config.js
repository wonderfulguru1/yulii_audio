/** @type {import('next').NextConfig} */
const nextConfig = {
  api: {
    bodyParser: false, // Required: we handle multipart/form-data manually
  },
};

module.exports = nextConfig;
