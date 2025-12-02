import { v2 as cloudinary } from 'cloudinary';
import dns from 'dns';

// Prefer environment variables for credentials. If not provided, fallback to existing values (not recommended).
const CLOUDINARY_CONFIG = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dghi878zc',
    api_key: process.env.CLOUDINARY_API_KEY || '277613325993397',
    api_secret: process.env.CLOUDINARY_API_SECRET || '0S7_eBHFqnnKMxYG8nk6KuwS938'
};

cloudinary.config(CLOUDINARY_CONFIG);

// Helper: quick DNS check for api.cloudinary.com to give clearer diagnostics
const checkCloudinaryDns = () => new Promise((resolve) => {
    dns.resolve4('api.cloudinary.com', (err, addresses) => {
        if (err) return resolve({ ok: false, error: err });
        return resolve({ ok: true, addresses });
    });
});

/**
 * Upload image to Cloudinary
 * @param {string} base64Image - Base64 encoded image string
 * @param {string} folder - Cloudinary folder name (e.g., 'projects', 'profiles', 'emails')
 * @returns {Promise<string>} - Cloudinary URL of uploaded image
 */
export const uploadToCloudinary = async (base64Image, folder = 'greyinsaat') => {
    const maxRetries = 2;
    let attempt = 0;

    // If credentials appear missing, warn early
    if (!CLOUDINARY_CONFIG.cloud_name || !CLOUDINARY_CONFIG.api_key || !CLOUDINARY_CONFIG.api_secret) {
        console.warn('Cloudinary credentials appear missing. Check CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET environment variables.');
    }

    while (attempt <= maxRetries) {
        try {
            const result = await cloudinary.uploader.upload(base64Image, {
                folder: folder,
                resource_type: 'auto',
                transformation: [
                    { width: 1920, height: 1080, crop: 'limit' },
                    { quality: 'auto:good' }
                ]
            });

            return result.secure_url;
        } catch (error) {
            // Diagnostic for DNS/network errors
            if (error && error.code === 'ENOTFOUND') {
                console.error('Cloudinary DNS lookup failed for api.cloudinary.com — possible network/DNS/proxy issue:', error);
                const dnsCheck = await checkCloudinaryDns();
                if (!dnsCheck.ok) {
                    console.error('DNS check for api.cloudinary.com failed:', dnsCheck.error && dnsCheck.error.message ? dnsCheck.error.message : dnsCheck.error);
                    console.error('Suggestions:');
                    console.error('- Ensure the server has internet access.');
                    console.error('- Check DNS resolution (try `nslookup api.cloudinary.com` or `dig api.cloudinary.com`).');
                    console.error('- If you are behind a proxy, set HTTP(S)_PROXY / http_proxy environment variables.');
                    console.error('- Ensure firewall or antivirus is not blocking outbound requests.');
                } else {
                    console.error('DNS resolved api.cloudinary.com to:', dnsCheck.addresses);
                }
                // Do not retry on ENOTFOUND — it's a local network/DNS issue
                throw error;
            }

            // For other transient network errors, attempt a small number of retries
            attempt += 1;
            console.error(`Cloudinary upload attempt ${attempt} failed:`, error && error.message ? error.message : error);
            if (attempt > maxRetries) {
                console.error('Exceeded Cloudinary upload retries.');
                throw new Error('Failed to upload image to Cloudinary');
            }
            // small delay before retry
            await new Promise(r => setTimeout(r, 500 * attempt));
        }
    }
};

/**
 * Upload multiple images to Cloudinary
 * @param {Array<string>} base64Images - Array of base64 encoded images
 * @param {string} folder - Cloudinary folder name
 * @returns {Promise<Array<string>>} - Array of Cloudinary URLs
 */
export const uploadMultipleToCloudinary = async (base64Images, folder = 'greyinsaat') => {
    try {
        const uploadPromises = base64Images.map(img => uploadToCloudinary(img, folder));
        return await Promise.all(uploadPromises);
    } catch (error) {
        console.error('Multiple upload error:', error);
        throw new Error('Failed to upload images to Cloudinary');
    }
};

/**
 * Delete image from Cloudinary
 * @param {string} imageUrl - Cloudinary URL to delete
 * @returns {Promise<boolean>} - Success status
 */
export const deleteFromCloudinary = async (imageUrl) => {
    try {
        // Extract public_id from URL
        const parts = imageUrl.split('/');
        const filename = parts[parts.length - 1].split('.')[0];
        const folder = parts[parts.length - 2];
        const publicId = `${folder}/${filename}`;
        
        await cloudinary.uploader.destroy(publicId);
        return true;
    } catch (error) {
        console.error('Cloudinary delete error:', error);
        return false;
    }
};

export default cloudinary;
