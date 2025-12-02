import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import mysql from 'mysql2';
import { uploadToCloudinary, uploadMultipleToCloudinary } from './cloudinary.js';

const app = express();
const PORT =  8080;

// Middleware
app.use(cors({
  origin: ["https://admin.greyinsaat.com", "https://greyinsaat.com"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
// Increase JSON and URL-encoded body size limits to accommodate larger payloads (images, attachments)
app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));

// Database Connection Pool
const db = mysql.createPool({
    host:  '86.107.77.205',
    user:  'almubara_greyinsaat',
    password: 'Candd4611@',
    database:  'almubara_greyinsaat',
    port:3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
}).promise(); // Use promise-based API

// Test DB Connection
db.getConnection()
    .then(connection => {
        console.log('✅ Connected to MySQL Database');
        connection.release();
    })
    .catch(err => {
        console.error('❌ Database connection failed:', err.message);
    });

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'No authorization token provided' });
    }

    // Simple token validation (in production, use JWT)
    const token = authHeader.replace('Bearer ', '');

    try {
        // Extract user ID from token (simplified - use JWT in production)
        const userId = parseInt(token.split('-')[1]);

        const [users] = await db.execute('SELECT id, name, email, role FROM staff WHERE id = ? AND is_active = TRUE', [userId]);

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }

        req.user = users[0];
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid token format' });
    }
};

// Role-based authorization
const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Insufficient permissions' });
        }
        next();
    };
};

// ============================================
// AUTH ROUTES
// ============================================

// Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    try {
        const [users] = await db.execute(
            'SELECT * FROM staff WHERE email = ? AND is_active = TRUE',
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        const user = users[0];

        // Check password (use bcrypt in production)
        if (user.password !== password) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        // Update last login
        await db.execute('UPDATE staff SET last_login = NOW() WHERE id = ?', [user.id]);

        // Generate token (use JWT in production)
        const token = `token-${user.id}-${Date.now()}`;

        res.json({
            success: true,
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                avatar_url: user.avatar_url,
                department: user.department,
                position: user.position,
                token
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Get current user
app.get('/api/auth/me', authenticateUser, (req, res) => {
    res.json({
        success: true,
        user: req.user
    });
});

// ============================================
// PROJECT ROUTES
// ============================================

// Get all projects (PUBLIC - no auth required)
app.get('/api/projects', async (req, res) => {
    try {
        const { status, type, search, sort = 'created_at', order = 'DESC' } = req.query;

        let query = 'SELECT * FROM projects WHERE 1=1';
        const params = [];

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        if (type) {
            query += ' AND type = ?';
            params.push(type);
        }

        if (search) {
            query += ' AND (name LIKE ? OR description LIKE ? OR location LIKE ?)';
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }

        const validSortColumns = ['name', 'created_at', 'start_date', 'completion_percentage'];
        const sortColumn = validSortColumns.includes(sort) ? sort : 'created_at';
        const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        query += ` ORDER BY ${sortColumn} ${sortOrder}`;

        const [projects] = await db.execute(query, params);

        res.json({
            success: true,
            count: projects.length,
            projects
        });
    } catch (error) {
        console.error('Get projects error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch projects' });
    }
});

// Get single project by ID (PUBLIC - no auth required)
app.get('/api/projects/:id', async (req, res) => {
    try {
        const [projects] = await db.execute('SELECT * FROM projects WHERE id = ?', [req.params.id]);

        if (projects.length === 0) {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }

        res.json({
            success: true,
            project: projects[0]
        });
    } catch (error) {
        console.error('Get project error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch project' });
    }
});

// Create new project
app.post('/api/projects', authenticateUser, async (req, res) => {
    try {
        const {
            name, type, status, client, description, location, address,
            start_date, end_date, total_budget, spent_budget, completion_percentage,
            project_manager, team_members, images, milestones
        } = req.body;

        // Validation
        if (!name || !type || !client || !location || !start_date || !end_date || !total_budget || !project_manager) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        const query = `
            INSERT INTO projects (
                name, type, status, client, description, location, address,
                start_date, end_date, total_budget, spent_budget, completion_percentage,
                project_manager, team_members, images, milestones, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const milestonesJson = milestones ? JSON.stringify(milestones) : null;
        const imagesJson = images ? JSON.stringify(images) : null;

        // Helper to format date for MySQL
        const formatDateForMySQL = (isoDate) => {
            if (!isoDate) return null;
            return new Date(isoDate).toISOString().slice(0, 19).replace('T', ' ');
        };

        const formattedStartDate = formatDateForMySQL(start_date);
        const formattedEndDate = formatDateForMySQL(end_date);

        const [result] = await db.execute(query, [
            name, type, status || 'Planning', client, description, location, address,
            formattedStartDate, formattedEndDate, total_budget, spent_budget || 0, completion_percentage || 0,
            project_manager, team_members, imagesJson, milestonesJson, req.user.id
        ]);

        res.status(201).json({
            success: true,
            message: 'Project created successfully',
            projectId: result.insertId
        });
    } catch (error) {
        console.error('Create project error:', error);
        res.status(500).json({ success: false, message: 'Failed to create project' });
    }
});

// Update project
app.put('/api/projects/:id', authenticateUser, async (req, res) => {
    try {
        const {
            name, type, status, client, description, location, address,
            start_date, end_date, total_budget, spent_budget, completion_percentage,
            project_manager, team_members, images, milestones
        } = req.body;

        // Helper to format date for MySQL
        const formatDateForMySQL = (isoDate) => {
            if (!isoDate) return null;
            return new Date(isoDate).toISOString().slice(0, 19).replace('T', ' ');
        };

        const formattedStartDate = formatDateForMySQL(start_date);
        const formattedEndDate = formatDateForMySQL(end_date);

        const query = `
            UPDATE projects SET
                name = ?, type = ?, status = ?, client = ?, description = ?,
                location = ?, address = ?, start_date = ?, end_date = ?,
                total_budget = ?, spent_budget = ?, completion_percentage = ?,
                project_manager = ?, team_members = ?, images = ?, milestones = ?
            WHERE id = ?
        `;

        const milestonesJson = milestones ? JSON.stringify(milestones) : null;
        const imagesJson = images ? JSON.stringify(images) : null;

        const [result] = await db.execute(query, [
            name, type, status, client, description, location, address,
            formattedStartDate, formattedEndDate, total_budget, spent_budget, completion_percentage,
            project_manager, team_members, imagesJson, milestonesJson, req.params.id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }

        res.json({
            success: true,
            message: 'Project updated successfully'
        });
    } catch (error) {
        console.error('Update project error:', error);
        res.status(500).json({ success: false, message: 'Failed to update project' });
    }
});

// Delete project
app.delete('/api/projects/:id', authenticateUser, async (req, res) => {
    try {
        const [result] = await db.execute('DELETE FROM projects WHERE id = ?', [req.params.id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }

        res.json({
            success: true,
            message: 'Project deleted successfully'
        });
    } catch (error) {
        console.error('Delete project error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete project' });
    }
});

// ============================================
// DASHBOARD ROUTES
// ============================================

// Get dashboard statistics
app.get('/api/dashboard/stats', authenticateUser, async (req, res) => {
    try {
        // Get project statistics
        const [projectStats] = await db.execute(`
            SELECT
                COUNT(*) as total_projects,
                SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) as active_projects,
                SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed_projects,
                SUM(CASE WHEN status = 'Planning' THEN 1 ELSE 0 END) as planning_projects,
                SUM(total_budget) as total_budget,
                SUM(spent_budget) as total_spent,
                AVG(completion_percentage) as avg_completion
            FROM projects
        `);

        // Get staff count
        const [staffStats] = await db.execute('SELECT COUNT(*) as total_staff FROM staff WHERE is_active = TRUE');

        // Get projects by type
        const [projectsByType] = await db.execute(`
            SELECT type, COUNT(*) as count
            FROM projects
            GROUP BY type
        `);

        // Get projects by status
        const [projectsByStatus] = await db.execute(`
            SELECT status, COUNT(*) as count
            FROM projects
            GROUP BY status
        `);

        // Get recent projects
        const [recentProjects] = await db.execute(`
            SELECT id, name, type, status, start_date, completion_percentage
            FROM projects
            ORDER BY created_at DESC
            LIMIT 5
        `);

        res.json({
            success: true,
            stats: {
                ...projectStats[0],
                total_staff: staffStats[0].total_staff,
                projects_by_type: projectsByType,
                projects_by_status: projectsByStatus,
                recent_projects: recentProjects
            }
        });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard statistics' });
    }
});

// ============================================
// STAFF ROUTES (Super-Admin Only)
// ============================================

// Get all staff
app.get('/api/staff', authenticateUser, requireRole('super-admin'), async (req, res) => {
    try {
        const [staff] = await db.execute(`
            SELECT id, name, email, role, phone, department, position, avatar_url, is_active, last_login, created_at
            FROM staff
            ORDER BY created_at DESC
        `);

        res.json({
            success: true,
            count: staff.length,
            staff
        });
    } catch (error) {
        console.error('Get staff error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch staff' });
    }
});

// Get single staff member
app.get('/api/staff/:id', authenticateUser, async (req, res) => {
    try {
        const [staff] = await db.execute(`
            SELECT id, name, email, role, phone, department, position, avatar_url, is_active, last_login
            FROM staff
            WHERE id = ?
        `, [req.params.id]);

        if (staff.length === 0) {
            return res.status(404).json({ success: false, message: 'Staff member not found' });
        }

        res.json({
            success: true,
            staff: staff[0]
        });
    } catch (error) {
        console.error('Get staff member error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch staff member' });
    }
});

// Create new staff member (super-admin only)
app.post('/api/staff', authenticateUser, requireRole('super-admin'), async (req, res) => {
    try {
        const { name, email, password, role, phone, department, position, avatar_url } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
        }

        const query = `
            INSERT INTO staff (name, email, password, role, phone, department, position, avatar_url, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const [result] = await db.execute(query, [
            name, email, password, role || 'viewer', phone, department, position, avatar_url, req.user.id
        ]);

        res.status(201).json({
            success: true,
            message: 'Staff member created successfully',
            staffId: result.insertId
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'Email already exists' });
        }
        console.error('Create staff error:', error);
        res.status(500).json({ success: false, message: 'Failed to create staff member' });
    }
});

// Update staff member
app.put('/api/staff/:id', authenticateUser, async (req, res) => {
    try {
        const { name, email, role, phone, department, position, avatar_url, is_active, password } = req.body;
        const staffId = parseInt(req.params.id);

        // Users can only update their own profile unless they're super-admin
        if (req.user.role !== 'super-admin' && staffId !== req.user.id) {
            return res.status(403).json({ 
                success: false, 
                message: 'You can only update your own profile' 
            });
        }

        // Only super-admin can change roles or active status
        if ((role !== undefined || is_active !== undefined) && req.user.role !== 'super-admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Only super-admin can change role or status' 
            });
        }

        // Check if staff member exists
        const [existingStaff] = await db.execute('SELECT id FROM staff WHERE id = ?', [staffId]);
        if (existingStaff.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Staff member not found' 
            });
        }

        // Build dynamic query based on provided fields
        const updates = [];
        const params = [];

        if (name !== undefined && name !== null && name.trim() !== '') {
            updates.push('name = ?');
            params.push(name.trim());
        }
        if (email !== undefined && email !== null && email.trim() !== '') {
            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email.trim())) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Invalid email format' 
                });
            }
            updates.push('email = ?');
            params.push(email.trim());
        }
        if (phone !== undefined && phone !== null) {
            updates.push('phone = ?');
            params.push(phone);
        }
        if (department !== undefined && department !== null) {
            updates.push('department = ?');
            params.push(department);
        }
        if (position !== undefined && position !== null) {
            updates.push('position = ?');
            params.push(position);
        }
        if (avatar_url !== undefined && avatar_url !== null) {
            // Allow empty string to clear avatar
            updates.push('avatar_url = ?');
            params.push(avatar_url);
        }

        // Super-admin only fields
        if (req.user.role === 'super-admin') {
            if (role !== undefined && role !== null) {
                const validRoles = ['super-admin', 'admin', 'viewer'];
                if (!validRoles.includes(role)) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'Invalid role. Must be super-admin, admin, or viewer' 
                    });
                }
                updates.push('role = ?');
                params.push(role);
            }
            if (is_active !== undefined && is_active !== null) {
                updates.push('is_active = ?');
                params.push(is_active ? 1 : 0);
            }
        }

        if (password !== undefined && password !== null && password.trim() !== '') {
            if (password.length < 6) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Password must be at least 6 characters' 
                });
            }
            updates.push('password = ?');
            params.push(password);
        }

        if (updates.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'No valid fields to update' 
            });
        }

        const query = `UPDATE staff SET ${updates.join(', ')} WHERE id = ?`;
        params.push(staffId);

        const [result] = await db.execute(query, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Staff member not found or no changes made' 
            });
        }

        // Fetch updated staff data to return
        const [updatedStaff] = await db.execute(
            'SELECT id, name, email, role, phone, department, position, avatar_url, is_active, last_login FROM staff WHERE id = ?',
            [staffId]
        );

        res.json({
            success: true,
            message: 'Staff member updated successfully',
            staff: updatedStaff[0]
        });
    } catch (error) {
        console.error('Update staff error:', error);
        
        // Handle duplicate email error
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ 
                success: false, 
                message: 'Email already exists. Please use a different email.' 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update staff member: ' + (error.message || 'Internal server error') 
        });
    }
});

// Delete staff member (super-admin only)
app.delete('/api/staff/:id', authenticateUser, requireRole('super-admin'), async (req, res) => {
    try {
        // Prevent deleting yourself
        if (parseInt(req.params.id) === req.user.id) {
            return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
        }

        const [result] = await db.execute('DELETE FROM staff WHERE id = ?', [req.params.id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Staff member not found' });
        }

        res.json({
            success: true,
            message: 'Staff member deleted successfully'
        });
    } catch (error) {
        console.error('Delete staff error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete staff member' });
    }
});

// ============================================
// IMAGE UPLOAD ROUTES (Cloudinary)
// ============================================

// Upload single image
app.post('/api/upload/image', authenticateUser, async (req, res) => {
    try {
        const { image, folder } = req.body;

        if (!image) {
            return res.status(400).json({ success: false, message: 'Image data is required' });
        }

        const imageUrl = await uploadToCloudinary(image, folder || 'greyinsaat');

        res.json({
            success: true,
            imageUrl
        });
    } catch (error) {
        console.error('Image upload error:', error);
        res.status(500).json({ success: false, message: 'Failed to upload image' });
    }
});

// Upload multiple images
app.post('/api/upload/images', authenticateUser, async (req, res) => {
    try {
        const { images, folder } = req.body;

        if (!images || !Array.isArray(images) || images.length === 0) {
            return res.status(400).json({ success: false, message: 'Images array is required' });
        }

        if (images.length > 7) {
            return res.status(400).json({ success: false, message: 'Maximum 7 images allowed' });
        }

        const imageUrls = await uploadMultipleToCloudinary(images, folder || 'greyinsaat/projects');

        res.json({
            success: true,
            imageUrls
        });
    } catch (error) {
        console.error('Multiple images upload error:', error);
        res.status(500).json({ success: false, message: 'Failed to upload images' });
    }
});

// ============================================
// EMAIL ROUTES
// ============================================

import fs from 'fs';
import nodemailer from 'nodemailer';
import { google } from 'googleapis';

// Load Gmail credentials dynamically
const loadGmailCredentials = () => {
    try {
        const tokenPath = './myToken.json';
        if (fs.existsSync(tokenPath)) {
            const credentials = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
            console.log('✅ Gmail credentials loaded');
            return credentials;
        } else {
            console.warn('⚠️ myToken.json not found. Email features will be limited.');
            return null;
        }
    } catch (error) {
        console.error('❌ Failed to load Gmail credentials:', error);
        return null;
    }
};

// Create Transporter with proper OAuth2 token refresh
const createTransporter = async () => {
    // Reload credentials each time to get fresh tokens
    const gmailCredentials = loadGmailCredentials();
    
    if (!gmailCredentials) {
        throw new Error('Gmail credentials not available');
    }

    const { client_id, client_secret, refresh_token, user_email } = gmailCredentials;

    if (!client_id || !client_secret || !refresh_token || !user_email) {
        throw new Error('Missing required Gmail credentials. Please check myToken.json has client_id, client_secret, refresh_token, and user_email.');
    }

    // Use OAuth2 from googleapis (compatible with v166)
    const OAuth2 = google.auth.OAuth2;
    const oauth2Client = new OAuth2(
        client_id,
        client_secret,
        "https://developers.google.com/oauthplayground"
    );

    // Set credentials with refresh token
    oauth2Client.setCredentials({
        refresh_token: refresh_token
    });

    // Get access token using callback method (most reliable)
    let accessToken;
    try {
        accessToken = await new Promise((resolve, reject) => {
            oauth2Client.getAccessToken((err, token) => {
                if (err) {
                    console.error('OAuth2 getAccessToken error:', err);
                    if (err.response) {
                        console.error('Error response:', err.response.data || err.response);
                    }
                    reject(err);
                } else if (!token) {
                    reject(new Error('Access token is null or undefined'));
                } else {
                    resolve(token);
                }
            });
        });
        
        // Save updated access token back to file for future use
        try {
            const updatedCredentials = {
                ...gmailCredentials,
                access_token: accessToken,
                expiry_date: Date.now() + (3599 * 1000) // 1 hour from now
            };
            fs.writeFileSync('./myToken.json', JSON.stringify(updatedCredentials, null, 2));
            console.log('✅ Access token obtained and saved successfully');
        } catch (saveError) {
            console.warn('⚠️ Could not save updated token to file:', saveError.message);
            console.log('✅ Access token obtained successfully');
        }
    } catch (error) {
        console.error('❌ OAuth2 token refresh failed:', error);
        
        // Provide detailed error message
        let errorDetails = '';
        if (error.response) {
            errorDetails = `Response: ${JSON.stringify(error.response.data || error.response)}`;
        } else if (error.message) {
            errorDetails = error.message;
        } else {
            errorDetails = JSON.stringify(error);
        }
        
        const detailedMsg = `Failed to refresh access token. ${errorDetails}\n\n` +
            `Troubleshooting steps:\n` +
            `1. Verify refresh_token is valid and not expired\n` +
            `2. Check client_id and client_secret match Google Cloud Console\n` +
            `3. Ensure Gmail API is enabled in Google Cloud Console\n` +
            `4. Verify OAuth consent screen is configured\n` +
            `5. Make sure user_email (${user_email}) matches the account that authorized the app\n` +
            `6. Try regenerating tokens: Run "node test.js" and update myToken.json`;
        
        throw new Error(detailedMsg);
    }

    // Create nodemailer transporter
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            type: 'OAuth2',
            user: user_email,
            clientId: client_id,
            clientSecret: client_secret,
            refreshToken: refresh_token,
            accessToken: accessToken
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    return transporter;
};

// Test email credentials endpoint (for debugging)
app.get('/api/email/test-credentials', authenticateUser, async (req, res) => {
    try {
        const gmailCredentials = loadGmailCredentials();
        
        if (!gmailCredentials) {
            return res.status(500).json({
                success: false,
                message: 'Gmail credentials not found'
            });
        }

        const { client_id, client_secret, refresh_token, user_email } = gmailCredentials;

        // Test OAuth2 connection
        const OAuth2 = google.auth.OAuth2;
        const oauth2Client = new OAuth2(
            client_id,
            client_secret,
            "https://developers.google.com/oauthplayground"
        );

        oauth2Client.setCredentials({
            refresh_token: refresh_token
        });

        const accessToken = await new Promise((resolve, reject) => {
            oauth2Client.getAccessToken((err, token) => {
                if (err) reject(err);
                else resolve(token);
            });
        });

        res.json({
            success: true,
            message: 'Credentials are valid',
            hasAccessToken: !!accessToken,
            userEmail: user_email,
            hasClientId: !!client_id,
            hasClientSecret: !!client_secret,
            hasRefreshToken: !!refresh_token
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Credential test failed',
            error: error.message || error.toString()
        });
    }
});

// Send email
app.post('/api/email/send', authenticateUser, async (req, res) => {
    try {
        const { to, subject, body, attachments } = req.body;

        if (!to || !subject || !body) {
            return res.status(400).json({ success: false, message: 'To, subject, and body are required' });
        }

        // Parse recipients (comma separated)
        const recipients = to.split(',').map(email => email.trim()).filter(email => email);

        // Construct Modern Professional HTML Email Template
        const htmlTemplate = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="X-UA-Compatible" content="IE=edge">
            <title>${subject}</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    padding: 40px 20px;
                    line-height: 1.6;
                    color: #334155;
                }
                .email-wrapper {
                    max-width: 600px;
                    margin: 0 auto;
                    background: #ffffff;
                    border-radius: 16px;
                    overflow: hidden;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
                }
                .email-header {
                    background: linear-gradient(135deg, #5563DE 0%, #764ba2 100%);
                    padding: 40px 30px;
                    text-align: center;
                    position: relative;
                    overflow: hidden;
                }
                .email-header::before {
                    content: '';
                    position: absolute;
                    top: -50%;
                    right: -50%;
                    width: 200%;
                    height: 200%;
                    background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
                    animation: pulse 4s ease-in-out infinite;
                }
                @keyframes pulse {
                    0%, 100% { transform: scale(1); opacity: 0.5; }
                    50% { transform: scale(1.1); opacity: 0.8; }
                }
                .logo {
                    font-size: 32px;
                    font-weight: 800;
                    color: #ffffff;
                    letter-spacing: 2px;
                    margin-bottom: 8px;
                    position: relative;
                    z-index: 1;
                    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
                }
                .tagline {
                    color: rgba(255, 255, 255, 0.9);
                    font-size: 14px;
                    font-weight: 500;
                    position: relative;
                    z-index: 1;
                }
                .email-content {
                    padding: 50px 40px;
                    background: #ffffff;
                }
                .email-body {
                    font-size: 16px;
                    color: #334155;
                    line-height: 1.8;
                    white-space: pre-wrap;
                }
                .email-body p {
                    margin-bottom: 16px;
                }
                .divider {
                    height: 1px;
                    background: linear-gradient(90deg, transparent, #e2e8f0, transparent);
                    margin: 30px 0;
                }
                .email-footer {
                    background: #f8fafc;
                    padding: 30px;
                    text-align: center;
                    border-top: 1px solid #e2e8f0;
                }
                .footer-text {
                    color: #64748b;
                    font-size: 13px;
                    margin-bottom: 8px;
                }
                .footer-company {
                    color: #5563DE;
                    font-weight: 700;
                    font-size: 14px;
                    margin-top: 12px;
                }
                .footer-location {
                    color: #94a3b8;
                    font-size: 12px;
                    margin-top: 8px;
                }
                .social-links {
                    margin-top: 20px;
                    padding-top: 20px;
                    border-top: 1px solid #e2e8f0;
                }
                .social-link {
                    display: inline-block;
                    margin: 0 8px;
                    color: #5563DE;
                    text-decoration: none;
                    font-size: 12px;
                    font-weight: 600;
                }
                .social-link:hover {
                    color: #764ba2;
                }
                @media only screen and (max-width: 600px) {
                    body { padding: 20px 10px; }
                    .email-content { padding: 30px 20px; }
                    .email-header { padding: 30px 20px; }
                    .logo { font-size: 26px; }
                    .email-body { font-size: 15px; }
                }
            </style>
        </head>
        <body>
            <div class="email-wrapper">
                <div class="email-header">
                    <div class="logo">GREY INSAAT</div>
                    <div class="tagline">Professional Civil Engineering & Project Management</div>
                </div>
                <div class="email-content">
                    <div class="email-body">
                        ${body.replace(/\n/g, '<br>')}
                    </div>
                    <div class="divider"></div>
                </div>
                <div class="email-footer">
                    <p class="footer-text">&copy; ${new Date().getFullYear()} Grey Insaat Limited. All rights reserved.</p>
                    <p class="footer-company">Grey Insaat Limited</p>
                    <p class="footer-location">📍 Abuja, Nigeria</p>
                    <div class="social-links">
                        <a href="#" class="social-link">Website</a> |
                        <a href="#" class="social-link">Contact</a> |
                        <a href="#" class="social-link">Projects</a>
                    </div>
                </div>
            </div>
        </body>
        </html>
        `;

        // Process attachments - convert base64 to nodemailer format
        let processedAttachments = [];
        if (attachments && Array.isArray(attachments) && attachments.length > 0) {
            processedAttachments = attachments.map(att => {
                // If attachment has base64 content, convert it
                if (att.content && att.encoding === 'base64') {
                    return {
                        filename: att.filename || 'attachment',
                        content: att.content,
                        encoding: 'base64'
                    };
                }
                // If it's already in nodemailer format, use as is
                return att;
            });
        }

        // Load credentials for email sending
        const gmailCredentials = loadGmailCredentials();
        const senderEmail = gmailCredentials?.user_email || 'noreply@greyinsaat.com';

        // Prepare mail options
        const mailOptions = {
            from: `Grey Insaat <${senderEmail}>`,
            to: recipients,
            subject: subject,
            html: htmlTemplate,
            attachments: processedAttachments
        };

        if (gmailCredentials) {
            try {
                // Create transporter
                const transporter = await createTransporter();
                
                // Send email
                const info = await transporter.sendMail(mailOptions);
                
                console.log(`📧 Email sent successfully to ${recipients.length} recipient(s)`);
                console.log(`📧 Message ID: ${info.messageId}`);

                // Save to database
                try {
                    await db.execute(
                        'INSERT INTO sent_emails (sender_id, recipients, subject, body, attachments, status) VALUES (?, ?, ?, ?, ?, ?)',
                        [req.user.id, to, subject, body, JSON.stringify(attachments || []), 'sent']
                    );
                } catch (dbError) {
                    console.error('Failed to save email to database:', dbError);
                    // Don't fail the request if DB save fails
                }
            } catch (emailError) {
                console.error('Email sending error:', emailError);
                throw emailError; // Re-throw to be caught by outer catch
            }
        } else {
            console.log('📧 MOCK EMAIL (No Credentials):', mailOptions);
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Save mock email to database
            await db.execute(
                'INSERT INTO sent_emails (sender_id, recipients, subject, body, attachments, status) VALUES (?, ?, ?, ?, ?, ?)',
                [req.user.id, to, subject, body, JSON.stringify(attachments || []), 'sent']
            );
        }

        res.json({
            success: true,
            message: `Email sent successfully to ${recipients.length} recipient(s)`
        });
    } catch (error) {
        console.error('Send email error:', error);

        // Normalize error message (handle cases where error is a string)
        let errorMessage = 'Unknown error occurred';
        if (error && error.message) {
            errorMessage = error.message;
        } else if (error) {
            errorMessage = String(error);
        }

        // Truncate error message if too long
        if (errorMessage.length > 500) {
            errorMessage = errorMessage.substring(0, 500) + '...';
        }

        // Save failed email to database
        try {
            await db.execute(
                'INSERT INTO sent_emails (sender_id, recipients, subject, body, attachments, status, error_message) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [req.user && req.user.id ? req.user.id : null, req.body.to || null, req.body.subject || null, req.body.body || null, JSON.stringify(req.body.attachments || []), 'failed', errorMessage]
            );
        } catch (dbError) {
            console.error('Failed to save error email to database:', dbError);
        }

        // Always send a response, even on error
        if (!res.headersSent) {
            res.status(500).json({ 
                success: false, 
                message: 'Failed to send email: ' + errorMessage 
            });
        }
    }
});

// Get sent emails
app.get('/api/email/sent', authenticateUser, async (req, res) => {
    try {
        const [emails] = await db.execute(`
            SELECT e.*, s.name as sender_name, s.email as sender_email
            FROM sent_emails e
            JOIN staff s ON e.sender_id = s.id
            ORDER BY e.sent_at DESC
            LIMIT 50
        `);

        res.json({
            success: true,
            emails
        });
    } catch (error) {
        console.error('Get sent emails error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch sent emails' });
    }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Grey Insaat API is running',
        version: '2.0.0'
    });
});

// Global error handler
// Global error handler (handle large payloads explicitly)
app.use((err, req, res, next) => {
    console.error('Global error:', err);

    // raw-body / body-parser uses `type === 'entity.too.large'` for payload too large
    if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
        return res.status(413).json({
            success: false,
            message: 'Payload too large. Increase server body size limit or send a smaller payload.'
        });
    }

    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

// Start Server
app.listen(8080, () => {
    console.log(`📊 Database: ${process.env.DB_NAME || 'greyinsaat_db'}`);
});
