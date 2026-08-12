"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWithdrawal = exports.getCreatorEarnings = void 0;
const db_1 = __importDefault(require("../config/db"));
// Country-based RPM (Revenue Per Mille / per 1000 views) in INR
const COUNTRY_RPM = {
    // High RPM countries - ₹25/1000 views
    'United States': 25,
    'United Kingdom': 25,
    'Canada': 25,
    'Australia': 25,
    'Germany': 25,
    // Medium RPM countries - ₹18/1000 views
    'United Arab Emirates': 18,
    'Saudi Arabia': 18,
    'Singapore': 18,
    // India - ₹5/1000 views
    'India': 5,
    // Low RPM countries - ₹4/1000 views
    'Bangladesh': 4,
    'Pakistan': 4,
    'Nepal': 4,
};
const DEFAULT_RPM = 6; // ₹6/1000 views for other countries
const INR_TO_USD = 0.012; // Approximate conversion rate (1 INR = $0.012)
function getRPM(country) {
    if (!country)
        return DEFAULT_RPM;
    return COUNTRY_RPM[country] || DEFAULT_RPM;
}
/**
 * Calculate earnings from paid views grouped by country
 */
function calculateEarningsFromViews(viewsByCountry) {
    let totalINR = 0;
    for (const { country, count } of viewsByCountry) {
        const rpm = getRPM(country);
        totalINR += (count / 1000) * rpm;
    }
    return totalINR * INR_TO_USD; // Convert to USD
}
/**
 * Check if user is a monetized creator
 */
async function isMonetized(userId) {
    const application = await db_1.default.monetizationApplication.findFirst({
        where: { userId, status: 'approved' },
    });
    return !!application;
}
/**
 * GET /api/creator/earnings
 * Returns current balance, lifetime earnings, monthly earnings, and country breakdown
 */
const getCreatorEarnings = async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthorized.' });
    const userId = req.user.id;
    try {
        // Check if user is monetized
        const monetized = await isMonetized(userId);
        if (!monetized) {
            return res.status(200).json({ isMonetized: false });
        }
        // Get the date when the user was approved for monetization
        const application = await db_1.default.monetizationApplication.findFirst({
            where: { userId, status: 'approved' },
            select: { updatedAt: true, paymentMethod: true, paymentDetails: true },
        });
        const approvedDate = application?.updatedAt || new Date(0);
        // Lifetime paid views grouped by country (only after approval)
        const lifetimeViewsByCountry = await db_1.default.$queryRawUnsafe(`SELECT COALESCE(pv.country, 'Unknown') as country, COUNT(*) as count
       FROM "PostView" pv
       WHERE pv."postId" IN (SELECT id FROM "Post" WHERE "userId" = $1)
         AND pv."isPaidView" = true
         AND pv."createdAt" >= $2
       GROUP BY COALESCE(pv.country, 'Unknown')`, userId, approvedDate);
        const lifetimeEarnings = calculateEarningsFromViews(lifetimeViewsByCountry.map((v) => ({ country: v.country === 'Unknown' ? null : v.country, count: Number(v.count) })));
        // This month paid views grouped by country
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const monthViewsByCountry = await db_1.default.$queryRawUnsafe(`SELECT COALESCE(pv.country, 'Unknown') as country, COUNT(*) as count
       FROM "PostView" pv
       WHERE pv."postId" IN (SELECT id FROM "Post" WHERE "userId" = $1)
         AND pv."isPaidView" = true
         AND pv."createdAt" >= $2
       GROUP BY COALESCE(pv.country, 'Unknown')`, userId, monthStart);
        const monthEarnings = calculateEarningsFromViews(monthViewsByCountry.map((v) => ({ country: v.country === 'Unknown' ? null : v.country, count: Number(v.count) })));
        // Get total withdrawn amount (completed withdrawals)
        const withdrawnResult = await db_1.default.$queryRawUnsafe(`SELECT COALESCE(SUM(amount), 0) as total
       FROM "WithdrawalRequest"
       WHERE "userId" = $1 AND status = 'completed'`, userId);
        const totalWithdrawn = Number(withdrawnResult[0]?.total || 0);
        // Get pending withdrawal amount
        const pendingResult = await db_1.default.$queryRawUnsafe(`SELECT COALESCE(SUM(amount), 0) as total
       FROM "WithdrawalRequest"
       WHERE "userId" = $1 AND status IN ('pending', 'processing')`, userId);
        const pendingWithdrawal = Number(pendingResult[0]?.total || 0);
        // Current balance = lifetime earnings - withdrawn - pending
        const currentBalance = Math.max(0, lifetimeEarnings - totalWithdrawn - pendingWithdrawal);
        // Country breakdown for display
        const countryBreakdown = lifetimeViewsByCountry.map((v) => {
            const country = v.country === 'Unknown' ? 'Other' : v.country;
            const count = Number(v.count);
            const rpm = getRPM(country === 'Other' ? null : country);
            const earnings = (count / 1000) * rpm * INR_TO_USD;
            return { country, views: count, rpm, earningsUSD: Number(earnings.toFixed(4)) };
        }).sort((a, b) => b.views - a.views);
        // Withdrawal history
        const withdrawals = await db_1.default.$queryRawUnsafe(`SELECT id, amount, status, "paymentMethod", "adminNotes", "createdAt"
       FROM "WithdrawalRequest"
       WHERE "userId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 20`, userId);
        res.status(200).json({
            isMonetized: true,
            currentBalance: Number(currentBalance.toFixed(2)),
            lifetimeEarnings: Number(lifetimeEarnings.toFixed(2)),
            monthEarnings: Number(monthEarnings.toFixed(2)),
            totalWithdrawn: Number(totalWithdrawn.toFixed(2)),
            pendingWithdrawal: Number(pendingWithdrawal.toFixed(2)),
            paymentMethod: application?.paymentMethod || null,
            paymentDetails: application?.paymentDetails || null,
            countryBreakdown,
            withdrawals: withdrawals.map((w) => ({
                id: w.id,
                amount: w.amount,
                status: w.status,
                paymentMethod: w.paymentMethod,
                adminNotes: w.adminNotes,
                createdAt: w.createdAt,
            })),
            canWithdraw: currentBalance >= 10,
            minimumWithdrawal: 10,
        });
    }
    catch (error) {
        console.error('Earnings error:', error);
        res.status(500).json({ error: error.message });
    }
};
exports.getCreatorEarnings = getCreatorEarnings;
/**
 * POST /api/creator/withdraw
 * Create a withdrawal request
 */
const createWithdrawal = async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthorized.' });
    const userId = req.user.id;
    const { amount, paymentMethod, paymentDetails } = req.body;
    try {
        // Check if user is monetized
        const monetized = await isMonetized(userId);
        if (!monetized) {
            return res.status(403).json({ error: 'You are not a monetized creator.' });
        }
        // Validate amount
        if (!amount || amount < 10) {
            return res.status(400).json({ error: 'Minimum withdrawal amount is $10.' });
        }
        if (!paymentMethod || !paymentDetails) {
            return res.status(400).json({ error: 'Payment method and details are required.' });
        }
        // Calculate available balance
        const application = await db_1.default.monetizationApplication.findFirst({
            where: { userId, status: 'approved' },
            select: { updatedAt: true },
        });
        const approvedDate = application?.updatedAt || new Date(0);
        const lifetimeViewsByCountry = await db_1.default.$queryRawUnsafe(`SELECT COALESCE(pv.country, 'Unknown') as country, COUNT(*) as count
       FROM "PostView" pv
       WHERE pv."postId" IN (SELECT id FROM "Post" WHERE "userId" = $1)
         AND pv."isPaidView" = true
         AND pv."createdAt" >= $2
       GROUP BY COALESCE(pv.country, 'Unknown')`, userId, approvedDate);
        const lifetimeEarnings = calculateEarningsFromViews(lifetimeViewsByCountry.map((v) => ({ country: v.country === 'Unknown' ? null : v.country, count: Number(v.count) })));
        const withdrawnResult = await db_1.default.$queryRawUnsafe(`SELECT COALESCE(SUM(amount), 0) as total
       FROM "WithdrawalRequest"
       WHERE "userId" = $1 AND status IN ('completed', 'pending', 'processing')`, userId);
        const totalCommitted = Number(withdrawnResult[0]?.total || 0);
        const availableBalance = lifetimeEarnings - totalCommitted;
        if (amount > availableBalance) {
            return res.status(400).json({ error: `Insufficient balance. Available: $${availableBalance.toFixed(2)}` });
        }
        // Create withdrawal request
        const withdrawal = await db_1.default.withdrawalRequest.create({
            data: {
                userId,
                amount,
                status: 'pending',
                paymentMethod,
                paymentDetails,
            },
        });
        res.status(201).json({
            success: true,
            withdrawal: {
                id: withdrawal.id,
                amount: withdrawal.amount,
                status: withdrawal.status,
                paymentMethod: withdrawal.paymentMethod,
                createdAt: withdrawal.createdAt,
            },
        });
    }
    catch (error) {
        console.error('Withdrawal error:', error);
        res.status(500).json({ error: error.message });
    }
};
exports.createWithdrawal = createWithdrawal;
