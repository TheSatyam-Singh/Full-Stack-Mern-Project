const multer = require('multer');
const path = require('path');

const storage = multer.memoryStorage();
const parseS5Url = () => {
    if (!process.env.S5_URL || !process.env.S5_KEY || !process.env.S5_BUCKET) {
        throw new Error('S5_URL, S5_KEY, and S5_BUCKET must be configured for image uploads');
    }

    return process.env.S5_URL.replace(/\/$/, '');
};

const uploadToS5 = (fieldName, directory) => {
    const parseMultipart = multer({ storage }).single(fieldName);

    return (req, res, next) => {
        parseMultipart(req, res, async (error) => {
            if (error) {
                return next(error);
            }

            if (!req.file) {
                return next(new Error(`Missing uploaded file: ${fieldName}`));
            }

            try {
                const s5Url = parseS5Url();
                const key = `${directory}/${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(req.file.originalname)}`;
                const headers = {
                    Authorization: `Bearer ${process.env.S5_KEY}`,
                    'content-type': req.file.mimetype,
                };
                const uploadResponse = await fetch(`${s5Url}/${process.env.S5_BUCKET}/${key}`, {
                    method: 'PUT',
                    headers,
                    body: req.file.buffer,
                });

                if (!uploadResponse.ok) {
                    throw new Error(`S5 upload failed with status ${uploadResponse.status}`);
                }

                const presignResponse = await fetch(`${s5Url}/api/buckets/${process.env.S5_BUCKET}/presign`, {
                    method: 'POST',
                    headers: {
                        ...headers,
                        'content-type': 'application/json',
                    },
                    body: JSON.stringify({ key, method: 'GET', expiresIn: 3600 }),
                });

                if (!presignResponse.ok) {
                    throw new Error(`S5 presign failed with status ${presignResponse.status}`);
                }

                const { url } = await presignResponse.json();
                if (!url) {
                    throw new Error('S5 presign response did not contain a URL');
                }

                req.file.location = url;
                req.file.s5Key = key;
                return next();
            } catch (s5Error) {
                return next(s5Error);
            }
        });
    };
};

exports.uploadAvatar = uploadToS5('avatar', 'profiles');
exports.uploadPost = uploadToS5('post', 'posts');

exports.deleteFile = async (fileUrl) => {
    const s5Url = parseS5Url();
    const bucketPrefix = `/${process.env.S5_BUCKET}/`;
    const pathStart = new URL(fileUrl).pathname.indexOf(bucketPrefix);
    if (pathStart === -1) {
        throw new Error('Unable to determine S5 object key from URL');
    }

    const key = new URL(fileUrl).pathname.slice(pathStart + bucketPrefix.length);
    const response = await fetch(`${s5Url}/${process.env.S5_BUCKET}/${key}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${process.env.S5_KEY}` },
    });

    if (!response.ok) {
        throw new Error(`S5 delete failed with status ${response.status}`);
    }
};
