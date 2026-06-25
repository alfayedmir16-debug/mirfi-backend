-- Get latest user (likely your account)
SELECT id, username, email FROM "User" ORDER BY "createdAt" DESC LIMIT 1;
