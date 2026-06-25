-- Create test posts for the user first
INSERT INTO "Post" ("id", "userId", "type", "mediaUrl", "thumbnailUrl", "caption", "viewCount", "createdAt")
SELECT 
  gen_random_uuid(),
  '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58',
  'image',
  'https://picsum.photos/800/600?random=' || generate_series(1, 10),
  'https://picsum.photos/200/200?random=' || generate_series(1, 10),
  'Test post ' || generate_series(1, 10),
  floor(random() * 1000),
  NOW() - (generate_series(1, 10) || ' days')::interval
ON CONFLICT DO NOTHING;

-- Now add 15000 views to these posts
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

-- Verify results
SELECT 
  'Posts Count' as metric,
  (SELECT COUNT(*) FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58') as count

UNION ALL

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
