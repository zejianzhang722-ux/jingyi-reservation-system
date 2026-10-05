const express = require('express');
const path = require('path');
const config = require('../config');
const secureUploadService = require('../services/secureUploadService');

const router = express.Router();
const uploadRoot = path.resolve(__dirname, '..', '..', config.upload.dir);

router.get('/:filename', function(req, res) {
  const filename = String(req.params.filename || '');
  if (!secureUploadService.safePublicFilename(filename)) {
    return res.status(404).end();
  }
  const filePath = path.resolve(uploadRoot, filename);
  if (path.dirname(filePath) !== uploadRoot) return res.status(404).end();

  const extension = path.extname(filename).toLowerCase();
  res.setHeader('Content-Type', extension === '.png' ? 'image/png' : 'image/jpeg');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; sandbox");
  // 小程序的 WebView 与接口服务器并非同站点；头像是公开的已净化图片，允许跨站嵌入。
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Disposition', 'inline; filename="' + filename + '"');
  res.sendFile(filePath, { dotfiles: 'deny' }, function(err) {
    if (err && !res.headersSent) res.status(err.statusCode || 404).end();
  });
});

module.exports = router;
