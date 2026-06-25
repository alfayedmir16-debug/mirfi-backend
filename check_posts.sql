-- Check if you have posts
SELECT id, "viewCount", "createdAt", caption FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58';

-- Check current views count
SELECT 
  COUNT(*) as total_views_last_30_days 
FROM "PostView" pv 
JOIN "Post" p ON pv."postId" = p.id 
WHERE p."userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' 
AND pv."createdAt" >= NOW() - INTERVAL '30 days';
