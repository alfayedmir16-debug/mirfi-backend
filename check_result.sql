-- Check if we can see the latest user
SELECT 'Latest User:' as info, id, username, email FROM "User" ORDER BY "createdAt" DESC LIMIT 1;
