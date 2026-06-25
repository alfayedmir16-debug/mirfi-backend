"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmAccountDeletion = exports.requestAccountDeletion = exports.googleLogin = exports.resetPassword = exports.forgotPassword = exports.updateProfile = exports.getMe = exports.login = exports.register = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../db");
const emailService_1 = require("../services/emailService");
const JWT_SECRET = process.env.JWT_SECRET || 'mirfi_super_secret_jwt_token_2026_key_abc123';
const register = async (req, res) => {
    const { username, email, password, displayName } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password are required.' });
    }
    // Password validation: at least 8 chars, 1 uppercase, 1 number, 1 special char
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({
            error: 'Password must be at least 8 characters with uppercase letter, number, and special character (!@#$%^&*).'
        });
    }
    try {
        // 1. Check if user already exists
        const existingUser = await db_1.prisma.user.findFirst({
            where: {
                OR: [
                    { email: email.toLowerCase().trim() },
                    { username: username.toLowerCase().trim() }
                ]
            }
        });
        if (existingUser) {
            return res.status(400).json({ error: 'Username or Email is already registered.' });
        }
        // 2. Hash Password
        const salt = await bcryptjs_1.default.genSalt(10);
        const passwordHash = await bcryptjs_1.default.hash(password, salt);
        // 3. Create User in PostgreSQL
        const user = await db_1.prisma.user.create({
            data: {
                username: username.toLowerCase().trim(),
                email: email.toLowerCase().trim(),
                passwordHash,
                displayName: displayName || username,
                profilePicture: `https://api.dicebear.com/7.x/adventurer/svg?seed=${username}`
            }
        });
        // 4. Generate Token
        const token = jsonwebtoken_1.default.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                displayName: user.displayName,
                profilePicture: user.profilePicture
            }
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.register = register;
const login = async (req, res) => {
    const { loginIdentifier, password } = req.body;
    if (!loginIdentifier || !password) {
        return res.status(400).json({ error: 'Login identifier and password are required.' });
    }
    try {
        // 1. Find User by Username or Email
        const user = await db_1.prisma.user.findFirst({
            where: {
                OR: [
                    { email: loginIdentifier.toLowerCase().trim() },
                    { username: loginIdentifier.toLowerCase().trim() }
                ]
            }
        });
        if (!user) {
            return res.status(400).json({ error: 'Invalid username or password.' });
        }
        // 2. Validate Password
        const isMatch = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid username or password.' });
        }
        // 3. Generate Token
        const token = jsonwebtoken_1.default.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
        res.status(200).json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                displayName: user.displayName,
                profilePicture: user.profilePicture
            }
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.login = login;
const getMe = async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }
    try {
        const user = await db_1.prisma.user.findUnique({
            where: { id: req.user.id },
            include: {
                _count: {
                    select: {
                        posts: true,
                        followers: true,
                        following: true
                    }
                }
            }
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }
        res.status(200).json({
            id: user.id,
            username: user.username,
            email: user.email,
            displayName: user.displayName,
            profilePicture: user.profilePicture,
            bio: user.bio,
            gender: user.gender,
            showGender: user.showGender,
            isPrivate: user.isPrivate,
            isVerified: user.isVerified,
            stats: {
                postsCount: user._count.posts,
                followersCount: user._count.followers,
                followingCount: user._count.following
            }
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.getMe = getMe;
const updateProfile = async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }
    const { displayName, username, bio, gender, showGender, profilePicture, isPrivate, currentPassword, newPassword } = req.body;
    try {
        // 1. If username changed, check uniqueness
        if (username) {
            const sanitizedUsername = username.toLowerCase().trim();
            const existingUser = await db_1.prisma.user.findFirst({
                where: {
                    username: sanitizedUsername,
                    NOT: { id: req.user.id }
                }
            });
            if (existingUser) {
                return res.status(400).json({ error: 'Username is already taken.' });
            }
        }
        // 2. Hash and update password if newPassword is provided
        let updatedPasswordHash = undefined;
        if (newPassword) {
            const user = await db_1.prisma.user.findUnique({
                where: { id: req.user.id }
            });
            if (!user) {
                return res.status(404).json({ error: 'User not found.' });
            }
            if (!currentPassword) {
                return res.status(400).json({ error: 'Current password is required to change password.' });
            }
            const isMatch = await bcryptjs_1.default.compare(currentPassword, user.passwordHash);
            if (!isMatch) {
                return res.status(400).json({ error: 'Incorrect current password.' });
            }
            const salt = await bcryptjs_1.default.genSalt(10);
            updatedPasswordHash = await bcryptjs_1.default.hash(newPassword, salt);
        }
        // 3. Update user
        const updatedUser = await db_1.prisma.user.update({
            where: { id: req.user.id },
            data: {
                displayName: displayName || undefined,
                username: username ? username.toLowerCase().trim() : undefined,
                bio: bio !== undefined ? bio : undefined,
                gender: gender !== undefined ? gender : undefined,
                showGender: showGender !== undefined ? showGender : undefined,
                profilePicture: profilePicture || undefined,
                isPrivate: isPrivate !== undefined ? isPrivate : undefined,
                passwordHash: updatedPasswordHash || undefined
            }
        });
        res.status(200).json({
            id: updatedUser.id,
            username: updatedUser.username,
            email: updatedUser.email,
            displayName: updatedUser.displayName,
            profilePicture: updatedUser.profilePicture,
            bio: updatedUser.bio,
            gender: updatedUser.gender,
            showGender: updatedUser.showGender,
            isPrivate: updatedUser.isPrivate
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.updateProfile = updateProfile;
const forgotPassword = async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email address is required.' });
    }
    try {
        const user = await db_1.prisma.user.findUnique({
            where: { email: email.toLowerCase().trim() }
        });
        if (!user) {
            return res.status(404).json({ error: 'This email address is not registered.' });
        }
        // Generate secure 6-digit numeric reset code
        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        const resetCodeExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins expiry
        await db_1.prisma.user.update({
            where: { id: user.id },
            data: {
                resetCode,
                resetCodeExpires
            }
        });
        // Send real email via SMTP
        try {
            await (0, emailService_1.sendResetCodeEmail)(user.email, resetCode);
        }
        catch (emailError) {
            console.error('Email sending error:', emailError);
            return res.status(400).json({
                error: emailError.message || 'Failed to send verification email. Please ensure your SMTP server config in .env is correct.'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Password reset code has been sent to your email.'
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.forgotPassword = forgotPassword;
const resetPassword = async (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
        return res.status(400).json({ error: 'Email, code, and new password are required.' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    try {
        const user = await db_1.prisma.user.findUnique({
            where: { email: email.toLowerCase().trim() }
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }
        if (!user.resetCode || user.resetCode !== code.trim()) {
            return res.status(400).json({ error: 'Invalid or incorrect reset code.' });
        }
        if (user.resetCodeExpires && user.resetCodeExpires < new Date()) {
            return res.status(400).json({ error: 'Reset code has expired.' });
        }
        // Hash the new password
        const salt = await bcryptjs_1.default.genSalt(10);
        const passwordHash = await bcryptjs_1.default.hash(newPassword, salt);
        // Save and clear reset fields
        await db_1.prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash,
                resetCode: null,
                resetCodeExpires: null
            }
        });
        res.status(200).json({
            success: true,
            message: 'Password has been reset successfully! You can now log in.'
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.resetPassword = resetPassword;
const googleLogin = async (req, res) => {
    const { email, displayName, profilePicture } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Google email is required.' });
    }
    try {
        // 1. Check if user already exists
        let user = await db_1.prisma.user.findUnique({
            where: { email: email.toLowerCase().trim() }
        });
        if (!user) {
            // 2. If they don't exist, register them automatically!
            // Generate a unique, safe username from email prefix
            const emailPrefix = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            let username = emailPrefix;
            // Ensure username uniqueness
            let usernameExists = await db_1.prisma.user.findUnique({ where: { username } });
            let counter = 1;
            while (usernameExists) {
                username = `${emailPrefix}${counter}`;
                usernameExists = await db_1.prisma.user.findUnique({ where: { username } });
                counter++;
            }
            // Generate a secure random password for this OAuth user
            const randomPassword = Math.random().toString(36).slice(-16);
            const salt = await bcryptjs_1.default.genSalt(10);
            const passwordHash = await bcryptjs_1.default.hash(randomPassword, salt);
            user = await db_1.prisma.user.create({
                data: {
                    email: email.toLowerCase().trim(),
                    username,
                    displayName: displayName || emailPrefix,
                    profilePicture: profilePicture || 'https://via.placeholder.com/150',
                    passwordHash
                }
            });
        }
        // 3. Generate JWT Token
        const token = jsonwebtoken_1.default.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.status(200).json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                displayName: user.displayName,
                profilePicture: user.profilePicture,
                bio: user.bio,
                gender: user.gender,
                isPrivate: user.isPrivate
            }
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.googleLogin = googleLogin;
// Request account deletion with email verification
const requestAccountDeletion = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        // Find user and verify password
        const user = await db_1.prisma.user.findUnique({
            where: { email: email.toLowerCase().trim() }
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const isPasswordValid = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        // Generate 6-digit verification code
        const deletionCode = Math.floor(100000 + Math.random() * 900000).toString();
        const codeExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        // Store deletion code in database
        await db_1.prisma.user.update({
            where: { id: user.id },
            data: {
                deletionCode,
                deletionCodeExpiry: codeExpiry
            }
        });
        // Send deletion code via email
        await (0, emailService_1.sendResetCodeEmail)(email, deletionCode, 'delete');
        res.json({
            message: 'Deletion code sent to your email',
            email: email.replace(/(.{2}).*(@)/, '$1***$2') // Mask email for privacy
        });
    }
    catch (error) {
        console.error('Request account deletion error:', error);
        res.status(500).json({ error: 'Failed to process deletion request' });
    }
};
exports.requestAccountDeletion = requestAccountDeletion;
// Confirm account deletion with verification code
const confirmAccountDeletion = async (req, res) => {
    try {
        const { email, deletionCode } = req.body;
        if (!email || !deletionCode) {
            return res.status(400).json({ error: 'Email and verification code are required' });
        }
        // Find user and verify code
        const user = await db_1.prisma.user.findUnique({
            where: { email: email.toLowerCase().trim() }
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (!user.deletionCode || !user.deletionCodeExpiry) {
            return res.status(400).json({ error: 'No deletion request found' });
        }
        if (user.deletionCode !== deletionCode) {
            return res.status(401).json({ error: 'Invalid verification code' });
        }
        if (new Date() > user.deletionCodeExpiry) {
            return res.status(401).json({ error: 'Verification code expired' });
        }
        // Delete user and all related data (sequential approach to avoid transaction issues)
        try {
            // Delete user's posts first
            await db_1.prisma.post.deleteMany({ where: { userId: user.id } });
            await db_1.prisma.like.deleteMany({ where: { userId: user.id } });
            await db_1.prisma.comment.deleteMany({ where: { userId: user.id } });
            await db_1.prisma.follow.deleteMany({
                where: {
                    OR: [
                        { followerId: user.id },
                        { followingId: user.id }
                    ]
                }
            });
            await db_1.prisma.message.deleteMany({ where: { senderId: user.id } });
            await db_1.prisma.notification.deleteMany({ where: { userId: user.id } });
            await db_1.prisma.postView.deleteMany({ where: { userId: user.id } });
            await db_1.prisma.save.deleteMany({ where: { userId: user.id } });
            // Finally delete the user
            await db_1.prisma.user.delete({ where: { id: user.id } });
        }
        catch (deleteError) {
            console.error('Error during deletion process:', deleteError);
            throw deleteError;
        }
        res.json({
            message: 'Account deleted successfully',
            success: true
        });
    }
    catch (error) {
        console.error('Confirm account deletion error:', error);
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: error.message || 'Failed to delete account' });
    }
};
exports.confirmAccountDeletion = confirmAccountDeletion;
