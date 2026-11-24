import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 16, fieldSize: 16 * 1024 },
});

export const paymentProof = field => (req, res, next) => {
  upload.single(field)(req, res, error => {
    if (!error) return next();
    if (!(error instanceof multer.MulterError)) return next(error);
    return res.status(422).json({ error: 'Upload one JPG, PNG, or WebP proof image up to 5 MB.' });
  });
};
