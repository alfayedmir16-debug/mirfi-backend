-- Get existing users to use as followers
-- Add 1000 followers using real existing user IDs

INSERT INTO "Follow" ("id", "followerId", "followingId", "status", "createdAt")
SELECT 
  gen_random_uuid(),
  u.id as followerId,
  '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' as followingId,
  'accepted' as status,
  NOW() - (random() * 30 || ' days')::interval as createdAt
FROM "User" u 
WHERE u.id != '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58'
LIMIT 1000
ON CONFLICT DO NOTHING;

-- Add 15000 views to posts (last 30 days)
INSERT INTO "PostView" ("id", "postId", "userId", "createdAt")
SELECT 
  gen_random_uuid(),
  p.id,
  CASE 
    WHEN random() > 0.3 THEN NULL 
    ELSE (SELECT id FROM "User" WHERE id != '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' ORDER BY random() LIMIT 1)
  END,
  NOW() - (random() * 30 || ' days')::interval
FROM "Post" p
WHERE p."userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58'
LIMIT 15000
ON CONFLICT DO NOTHING;

-- Verify the results
SELECT 
  'Followers Count' as metric,
  (SELECT COUNT(*) FROM "Follow" WHERE "followingId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' AND "status" = 'accepted') as count

UNION ALL

SELECT 
  'Views Last 30 Days' as metric,
  (SELECT COUNT(*) FROM "PostView" pv 
   JOIN "Post" p ON pv."postId" = p.id 
   WHERE p."userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' 
   AND pv."createdAt" >= NOW() - INTERVAL '30 days') as count;
