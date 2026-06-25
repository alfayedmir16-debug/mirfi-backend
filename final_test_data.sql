-- Add 1000 followers for user: 6cb3d3ac-1295-42f1-b2d9-f6cd99609b58
WITH follower_data AS (
  SELECT 
    gen_random_uuid() as id,
    'follower_' || generate_series(1, 1000)::text as followerId,
    '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' as followingId,
    'accepted' as status,
    NOW() - (random() * 30 || ' days')::interval as createdAt
)
INSERT INTO "Follow" ("id", "followerId", "followingId", "status", "createdAt")
SELECT * FROM follower_data
ON CONFLICT DO NOTHING;

-- Add 15000 views to posts (last 30 days)
INSERT INTO "PostView" ("id", "postId", "userId", "createdAt")
SELECT 
  gen_random_uuid(),
  p.id,
  CASE 
    WHEN random() > 0.3 THEN NULL 
    ELSE 'viewer_' || generate_series(1, 500)::text
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
