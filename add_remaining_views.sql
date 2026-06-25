-- Add 5000 more views to reach 15,000 total
INSERT INTO "PostView" ("id", "postId", "userId", "createdAt")
SELECT 
  gen_random_uuid(),
  p.id,
  NULL,
  NOW() - (floor(random() * 30) || ' days')::interval
FROM "Post" p, generate_series(1, 500)
WHERE p."userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58'
LIMIT 5000
ON CONFLICT DO NOTHING;

-- Check final count
SELECT 
  COUNT(*) as total_views_last_30_days
FROM "PostView" pv 
JOIN "Post" p ON pv."postId" = p.id 
WHERE p."userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' 
AND pv."createdAt" >= NOW() - INTERVAL '30 days';
