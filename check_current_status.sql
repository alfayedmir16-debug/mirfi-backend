-- Check current status
SELECT 
  'Followers' as metric,
  (SELECT COUNT(*) FROM "Follow" WHERE "followingId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' AND "status" = 'accepted') as count

UNION ALL

SELECT 
  'Posts' as metric,
  (SELECT COUNT(*) FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58') as count

UNION ALL

SELECT 
  'Views (30 days)' as metric,
  (SELECT COUNT(*) FROM "PostView" pv 
   JOIN "Post" p ON pv."postId" = p.id 
   WHERE p."userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' 
   AND pv."createdAt" >= NOW() - INTERVAL '30 days') as count;
