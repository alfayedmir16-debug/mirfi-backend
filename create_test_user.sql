-- First, let's create a test user if needed, or use existing
-- This will show us what users exist
SELECT id, username, email, 
       (SELECT COUNT(*) FROM "Follow" WHERE "followingId" = "User"."id" AND "status" = 'accepted') as followers,
       (SELECT COUNT(*) FROM "PostView" pv JOIN "Post" p ON pv."postId" = p.id 
        WHERE p."userId" = "User"."id" AND pv."createdAt" >= NOW() - INTERVAL '30 days') as views_30_days
FROM "User" 
ORDER BY "createdAt" DESC 
LIMIT 5;
